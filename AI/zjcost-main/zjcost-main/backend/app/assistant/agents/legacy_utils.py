"""Legacy utility functions relocated from v1 handler files.

These utility functions are still actively used by routes and services.
They do NOT use the v2 BaseHandler framework.
"""

from __future__ import annotations

import json
import logging
import re
import sys
from dataclasses import dataclass
from typing import Any

from sqlalchemy.orm import Session

from app.assistant.prompts import load_prompt
from app.assistant.providers import ZhProviderError, get_zh_provider as _default_get_zh_provider
from app.assistant.schemas.boq import ZhBoqGenerateOutput
from app.assistant.schemas.query import ZhQueryIntentOutput
from app.assistant.schemas.quota_match import ZhQuotaRerankOutput
from app.db.session import get_db
from app.models.boq_item import BoqItem
from app.models.project import Project
from app.services.boq_generate_service import BoqSuggestion, generate_boq_items, _detect_floors

logger = logging.getLogger(__name__)


def _get_zh_provider(handler_module: str | None = None):
    if handler_module:
        module = sys.modules.get(f"app.assistant.agents.{handler_module}")
        provider_factory = getattr(module, "get_zh_provider", None) if module else None
        if provider_factory is not None:
            return provider_factory()
    return _default_get_zh_provider()

# ──────────────────────────────────────────────────────────────
# query_handler utilities
# ──────────────────────────────────────────────────────────────

_INTENT_QUERY_MAP = {
    "unbound": "未绑定",
    "issues": "异常",
    "dirty": "待重算",
}

_DEFAULT_QUERY_PROMPT = "你是查询路由助手，把 query 分类为 unbound/issues/dirty/keyword，并输出 JSON。"


def normalize_query_for_router(query: str) -> str:
    """Convert arbitrary NL query to the route's canonical query tokens."""
    q = query.strip()
    if not q:
        return q

    provider = _get_zh_provider("query_handler")
    if not provider.is_enabled() or not provider.is_configured():
        return q

    try:
        system_prompt = load_prompt("query_intent.txt")
    except OSError:
        system_prompt = _DEFAULT_QUERY_PROMPT

    try:
        result = provider.generate_structured(
            task="query_intent",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": json.dumps({"query": q}, ensure_ascii=False)},
            ],
            schema_model=ZhQueryIntentOutput,
        )
    except ZhProviderError:
        return q

    if result.intent == "keyword":
        keyword = (result.keyword or q).strip()
        return keyword or q

    return _INTENT_QUERY_MAP.get(result.intent, q)


# ──────────────────────────────────────────────────────────────
# insight_handler utilities
# ──────────────────────────────────────────────────────────────

VALID_CONTEXT_TYPES = {"scan", "match", "calc", "validation", "provenance", "dashboard"}

_DEFAULT_INSIGHT_PROMPT = "你是工程计价 辅助 分析助手。根据给定的项目数据，提供简洁专业的中文分析。"


def generate_insight(
    *,
    context_type: str,
    context_data: dict[str, Any],
) -> str | None:
    """Generate 辅助 insight text for the given context.

    Returns None if 辅助 is not available (caller should use static fallback).
    """
    provider = _get_zh_provider("insight_handler")
    if not provider.is_enabled() or not provider.is_configured():
        return None

    try:
        system_prompt = load_prompt("insight_analyze.txt")
    except OSError:
        system_prompt = _DEFAULT_INSIGHT_PROMPT

    user_content = json.dumps(
        {"context_type": context_type, "data": context_data},
        ensure_ascii=False,
    )

    try:
        return provider.generate_text(
            task=f"insight_{context_type}",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_content},
            ],
        )
    except ZhProviderError:
        return None


# ──────────────────────────────────────────────────────────────
# quota_match_handler utilities
# ──────────────────────────────────────────────────────────────

_DEFAULT_RERANK_PROMPT = "你是定额匹配重排助手。请对候选定额按相关性重排并输出 JSON。"


def rerank_quota_candidates_with_agent(
    *,
    boq_code: str,
    boq_name: str,
    boq_unit: str,
    candidates: list[dict[str, Any]],
    top_n: int,
) -> list[dict[str, Any]]:
    """Rerank quota candidates using model when enabled, otherwise return original order."""
    if not candidates:
        return []

    fallback = candidates[:top_n]
    provider = _get_zh_provider("quota_match_handler")
    if not provider.is_enabled() or not provider.is_configured():
        return fallback

    try:
        system_prompt = load_prompt("quota_rerank.txt")
    except OSError:
        system_prompt = _DEFAULT_RERANK_PROMPT

    limited_candidates = candidates[:20]
    payload = {
        "boq_item": {
            "code": boq_code,
            "name": boq_name,
            "unit": boq_unit,
        },
        "candidates": limited_candidates,
        "top_n": top_n,
    }

    try:
        result = provider.generate_structured(
            task="quota_rerank",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
            ],
            schema_model=ZhQuotaRerankOutput,
        )
    except ZhProviderError:
        return fallback

    by_id = {int(c["quota_item_id"]): c for c in limited_candidates}
    ordered: list[dict[str, Any]] = []
    used_ids: set[int] = set()

    for ranked in result.candidates:
        rid = int(ranked.quota_item_id)
        if rid in used_ids:
            continue
        src = by_id.get(rid)
        if src is None:
            continue
        item = dict(src)
        item["confidence"] = round(float(ranked.confidence), 3)
        if ranked.reasons:
            item["reasons"] = ranked.reasons
        ordered.append(item)
        used_ids.add(rid)
        if len(ordered) >= top_n:
            break

    for src in limited_candidates:
        rid = int(src["quota_item_id"])
        if rid in used_ids:
            continue
        ordered.append(dict(src))
        if len(ordered) >= top_n:
            break

    return ordered


# ──────────────────────────────────────────────────────────────
# rate_suggestion_handler utilities
# ──────────────────────────────────────────────────────────────

@dataclass
class RateSuggestion:
    boq_item_id: int
    suggested_rate: float
    rate_low: float
    rate_high: float
    currency: str
    reasoning: str
    confidence: float


_HK_RATE_RANGES: dict[str, tuple[float, float]] = {
    "Preliminaries": (0, 0),
    "Demolition": (50, 500),
    "Earthworks": (80, 600),
    "Piling": (500, 5000),
    "Concrete Work": (800, 4000),
    "Masonry": (200, 1200),
    "Structural Steelwork": (5000, 25000),
    "Waterproofing": (100, 800),
    "Roofing": (200, 1500),
    "Carpentry": (300, 2000),
    "Joinery": (500, 5000),
    "Ironmongery": (50, 2000),
    "Structural Glazing": (800, 5000),
    "Plastering": (100, 600),
    "Tiling": (200, 1200),
    "Painting": (30, 200),
    "Plumbing": (200, 3000),
    "Drainage": (300, 2000),
    "Electrical": (200, 5000),
    "Fire Services": (300, 3000),
    "HVAC": (500, 8000),
    "Lift & Escalator": (50000, 500000),
    "External Works": (100, 2000),
}


def suggest_rate(*, boq_item_id: int) -> RateSuggestion:
    """Suggest a rate for an HKSMM4 BOQ item."""
    db: Session = next(get_db())
    try:
        return _suggest(db, boq_item_id)
    finally:
        db.close()


def _suggest(db: Session, boq_item_id: int) -> RateSuggestion:
    boq = db.query(BoqItem).filter(BoqItem.id == boq_item_id).first()
    if not boq:
        return RateSuggestion(
            boq_item_id=boq_item_id, suggested_rate=0, rate_low=0, rate_high=0,
            currency="HKD", reasoning="BOQ item not found", confidence=0,
        )

    project = db.query(Project).filter(Project.id == boq.project_id).first()
    currency = project.currency if project else "HKD"
    trade = boq.trade_section or ""

    similar_items = (
        db.query(BoqItem)
        .filter(
            BoqItem.project_id == boq.project_id,
            BoqItem.trade_section == trade,
            BoqItem.rate > 0,
            BoqItem.id != boq.id,
        )
        .all()
    )
    hist_rates = [i.rate for i in similar_items if i.rate > 0]

    zh_result = _zh_suggest_rate(boq, trade, currency, hist_rates)
    if zh_result:
        return zh_result

    rate_range = _HK_RATE_RANGES.get(trade, (100, 2000))
    mid = (rate_range[0] + rate_range[1]) / 2

    if hist_rates:
        avg_hist = sum(hist_rates) / len(hist_rates)
        mid = avg_hist
        rate_range = (min(hist_rates) * 0.8, max(hist_rates) * 1.2)

    return RateSuggestion(
        boq_item_id=boq_item_id,
        suggested_rate=round(mid, 2),
        rate_low=round(rate_range[0], 2),
        rate_high=round(rate_range[1], 2),
        currency=currency,
        reasoning=f"Based on {trade} trade section typical range"
        + (f" and {len(hist_rates)} similar items in project" if hist_rates else ""),
        confidence=0.5 if not hist_rates else 0.7,
    )


def _zh_suggest_rate(
    boq: BoqItem, trade: str, currency: str, hist_rates: list[float],
) -> RateSuggestion | None:
    provider = _get_zh_provider("rate_suggestion_handler")
    if not provider.is_enabled() or not provider.is_configured():
        return None

    context = {
        "trade_section": trade,
        "description": boq.description_en or boq.name,
        "unit": boq.unit,
        "quantity": boq.quantity,
        "currency": currency,
        "historical_rates": hist_rates[:10],
    }

    prompt = (
        "You are an expert quantity surveyor for an alternate measurement standard. "
        f"Suggest a unit rate for the following HKSMM4 BOQ item:\n"
        f"{json.dumps(context, ensure_ascii=False, indent=2)}\n\n"
        "Reply in JSON format:\n"
        '{"suggested_rate": <number>, "rate_low": <number>, "rate_high": <number>, '
        '"reasoning": "<brief explanation>", "confidence": <0.0-1.0>}'
    )

    try:
        text = provider.generate_text(
            task="rate_suggestion",
            messages=[
                {"role": "system", "content": "You are a QS rate estimation expert. Reply only with valid JSON."},
                {"role": "user", "content": prompt},
            ],
        )

        json_match = re.search(r"\{[^{}]+\}", text)
        if not json_match:
            return None
        data = json.loads(json_match.group())

        return RateSuggestion(
            boq_item_id=boq.id,
            suggested_rate=float(data.get("suggested_rate", 0)),
            rate_low=float(data.get("rate_low", 0)),
            rate_high=float(data.get("rate_high", 0)),
            currency=currency,
            reasoning=data.get("reasoning", "辅助 suggestion"),
            confidence=float(data.get("confidence", 0.6)),
        )
    except (ZhProviderError, json.JSONDecodeError, Exception) as exc:
        logger.warning("辅助 rate suggestion failed: %s", exc)
        return None


# ──────────────────────────────────────────────────────────────
# boq_handler utilities
# ──────────────────────────────────────────────────────────────

_DEFAULT_BOQ_PROMPT = "你是工程计价助手。输出 BOQ 建议 JSON，不输出金额，不输出额外文本。"

_HKSMM4_TEMPLATES: list[dict] = [
    {"ref": "A/1", "trade": "Preliminaries", "name_en": "Insurance", "name_zh": "保险", "unit": "Item", "qty": 1},
    {"ref": "A/2", "trade": "Preliminaries", "name_en": "Temporary Works", "name_zh": "临时工程", "unit": "Item", "qty": 1},
    {"ref": "B/1", "trade": "Demolition", "name_en": "Demolition of existing structure", "name_zh": "拆除现有结构", "unit": "m2", "qty": 500},
    {"ref": "C/1", "trade": "Earthworks", "name_en": "Excavation to reduce levels", "name_zh": "减低场地挖方", "unit": "m3", "qty": 800},
    {"ref": "C/2", "trade": "Earthworks", "name_en": "Backfilling", "name_zh": "回填", "unit": "m3", "qty": 300},
    {"ref": "E/1", "trade": "Concrete Work", "name_en": "Reinforced concrete to foundations", "name_zh": "基础钢筋混凝土", "unit": "m3", "qty": 200},
    {"ref": "E/2", "trade": "Concrete Work", "name_en": "Reinforced concrete to columns", "name_zh": "柱钢筋混凝土", "unit": "m3", "qty": 120},
    {"ref": "E/3", "trade": "Concrete Work", "name_en": "Reinforced concrete to beams", "name_zh": "梁钢筋混凝土", "unit": "m3", "qty": 180},
    {"ref": "E/4", "trade": "Concrete Work", "name_en": "Reinforced concrete to slabs", "name_zh": "楼板钢筋混凝土", "unit": "m3", "qty": 300},
    {"ref": "E/5", "trade": "Concrete Work", "name_en": "Formwork", "name_zh": "模板", "unit": "m2", "qty": 2000},
    {"ref": "E/6", "trade": "Concrete Work", "name_en": "Reinforcement", "name_zh": "钢筋", "unit": "t", "qty": 50},
    {"ref": "F/1", "trade": "Masonry", "name_en": "Blockwork walls", "name_zh": "砖墙", "unit": "m2", "qty": 600},
    {"ref": "H/1", "trade": "Waterproofing", "name_en": "Waterproof membrane", "name_zh": "防水层", "unit": "m2", "qty": 400},
    {"ref": "L/1", "trade": "Plastering", "name_en": "Cement render to walls", "name_zh": "墙面水泥抓", "unit": "m2", "qty": 2000},
    {"ref": "M/1", "trade": "Tiling", "name_en": "Floor tiling", "name_zh": "地砖", "unit": "m2", "qty": 600},
    {"ref": "N/1", "trade": "Painting", "name_en": "Emulsion paint to walls", "name_zh": "墙面乳胶漆", "unit": "m2", "qty": 3000},
    {"ref": "P/1", "trade": "Plumbing", "name_en": "Water supply pipework", "name_zh": "给水管道", "unit": "m", "qty": 300},
    {"ref": "Q/1", "trade": "Drainage", "name_en": "Drainage pipework", "name_zh": "排水管道", "unit": "m", "qty": 200},
    {"ref": "R/1", "trade": "Electrical", "name_en": "Electrical installation", "name_zh": "电气安装", "unit": "m", "qty": 500},
]


def _generate_hksmm4_items(description: str) -> list[BoqSuggestion]:
    floors = _detect_floors(description)
    items: list[BoqSuggestion] = []
    for t in _HKSMM4_TEMPLATES:
        qty = t["qty"]
        if floors > 1 and t["trade"] not in ("Preliminaries",):
            qty = round(qty * (0.5 + 0.5 * floors), 1)
        items.append(BoqSuggestion(
            code=t["ref"],
            name=t["name_zh"],
            unit=t["unit"],
            quantity=qty,
            division=t["trade"],
            reason=f"HKSMM4 {t['trade']} standard item",
            characteristics=t["name_en"],
        ))
    return items


def generate_boq_items_with_agent(
    description: str, standard_type: str = "GB50500",
) -> list[BoqSuggestion]:
    """Generate BOQ suggestions using model when enabled, otherwise deterministic fallback."""
    if standard_type == "HKSMM4":
        fallback = _generate_hksmm4_items(description)
    else:
        fallback = generate_boq_items(description)

    provider = _get_zh_provider("boq_handler")
    if not provider.is_enabled() or not provider.is_configured():
        return fallback

    try:
        system_prompt = load_prompt("boq_generate.txt")
    except OSError:
        system_prompt = _DEFAULT_BOQ_PROMPT

    if standard_type == "HKSMM4":
        system_prompt = (
            "You are an expert quantity surveyor for an alternate measurement standard. Generate BOQ items following HKSMM4 standard. "
            "Each item must have: ref (e.g. A/1), trade section, English description, Chinese name, unit, quantity. "
            "Output JSON suggestions array. Do not output amounts."
        )

    fallback_context = [
        {
            "code": s.code,
            "name": s.name,
            "characteristics": s.characteristics,
            "unit": s.unit,
            "quantity": s.quantity,
            "division": s.division,
            "reason": s.reason,
        }
        for s in fallback
    ]

    user_payload = {
        "description": description,
        "standard_type": standard_type,
        "fallback_suggestions": fallback_context,
    }

    try:
        result = provider.generate_structured(
            task="boq_generate",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": json.dumps(user_payload, ensure_ascii=False)},
            ],
            schema_model=ZhBoqGenerateOutput,
        )
    except ZhProviderError:
        return fallback

    if not result.suggestions:
        return fallback

    output: list[BoqSuggestion] = []
    seen_codes: set[str] = set()

    for row in result.suggestions:
        if row.code in seen_codes:
            continue
        seen_codes.add(row.code)
        output.append(
            BoqSuggestion(
                code=row.code,
                name=row.name,
                unit=row.unit,
                quantity=row.quantity,
                division=row.division,
                reason=f"辅助推荐 ({row.reason})",
                characteristics=row.characteristics,
            )
        )

    return output or fallback
