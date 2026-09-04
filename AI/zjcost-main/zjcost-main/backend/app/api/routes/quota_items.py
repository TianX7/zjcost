from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.cache import _cache as cache
from app.db.session import get_db
from app.models.quota_item import QuotaItem
from app.services.quota_import_service import VALID_DISCIPLINES
from app.services.quota_match_service import clear_quota_match_cache

router = APIRouter(tags=["quota-items"])

QUOTA_CACHE_TTL = 300  # 5 minutes

DISCIPLINE_ORDER = {
    "土建": 1,
    "给排水": 2,
    "电气": 3,
    "暖通消防": 4,
    "仿古": 5,
    "光伏": 6,
    "水利灌溉": 7,
    "旧材料": 8,
    "补充定额": 9,
}


def _chapter_sort_key(row: tuple[str, int]) -> tuple[int, str]:
    chapter = row[0] or ""
    digits = ""
    for ch in chapter:
        if ch.isdigit():
            digits += ch
        elif digits:
            break
    return (int(digits) if digits else 9999, chapter)


def _discipline_sort_key(row: tuple[str, int]) -> tuple[int, str]:
    discipline = row[0] or "土建"
    return (DISCIPLINE_ORDER.get(discipline, 99), discipline)


@router.get("/quota-items")
def list_quota_items(
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=200),
    discipline: str | None = None,
    chapter: str | None = None,
    keyword: str | None = None,
    acquisition_method: str | None = Query(
        None,
        description="过滤获取方式：recycle=当地回收 / reproduce=原材料复现",
    ),
    db: Session = Depends(get_db),
):
    cache_key = f"quota:list:{skip}:{limit}:{discipline}:{chapter}:{keyword}:{acquisition_method}"
    cached = cache.get(cache_key)
    if cached is not None:
        return cached

    q = db.query(QuotaItem).filter(QuotaItem.discipline.in_(VALID_DISCIPLINES))
    if discipline:
        q = q.filter(QuotaItem.discipline == discipline)
    if chapter:
        q = q.filter(QuotaItem.chapter == chapter)
    if keyword:
        q = q.filter(
            (QuotaItem.name.contains(keyword))
            | (QuotaItem.quota_code.contains(keyword))
        )
    if acquisition_method:
        q = q.filter(QuotaItem.acquisition_method == acquisition_method)

    total = q.count()
    items = q.offset(skip).limit(limit).all()
    result = {
        "total": total,
        "items": [_quota_item_to_dict(it) for it in items],
    }
    cache.set(cache_key, result, QUOTA_CACHE_TTL)
    return result


def _quota_item_to_dict(it: QuotaItem) -> dict:
    return {
        "id": it.id,
        "quota_code": it.quota_code,
        "discipline": it.discipline,
        "name": it.name,
        "unit": it.unit,
        "chapter": it.chapter,
        "labor_qty": it.labor_qty,
        "material_qty": it.material_qty,
        "machine_qty": it.machine_qty,
        "base_price": it.base_price,
        # 旧材料扩展字段（普通定额为空）
        "acquisition_method": getattr(it, "acquisition_method", "") or "",
        "origin_note": getattr(it, "origin_note", "") or "",
        "heritage_site": getattr(it, "heritage_site", "") or "",
        "relic_level": getattr(it, "relic_level", "") or "",
        "repair_part": getattr(it, "repair_part", "") or "",
        "condition_grade": getattr(it, "condition_grade", "") or "",
        "batch_no": getattr(it, "batch_no", "") or "",
        "inspection_report_no": getattr(it, "inspection_report_no", "") or "",
    }


@router.get("/quota-items/stats")
def quota_stats(db: Session = Depends(get_db)):
    cache_key = "quota:stats"
    cached = cache.get(cache_key)
    if cached is not None:
        return cached

    base_query = db.query(QuotaItem).filter(QuotaItem.discipline.in_(VALID_DISCIPLINES))
    total = base_query.count()
    disciplines = (
        db.query(QuotaItem.discipline, func.count())
        .filter(QuotaItem.discipline.in_(VALID_DISCIPLINES))
        .group_by(QuotaItem.discipline)
        .all()
    )
    disciplines = sorted(disciplines, key=_discipline_sort_key)

    chapters = (
        db.query(QuotaItem.discipline, QuotaItem.chapter, func.count())
        .filter(QuotaItem.discipline.in_(VALID_DISCIPLINES))
        .group_by(QuotaItem.discipline, QuotaItem.chapter)
        .all()
    )
    chapters = sorted(
        chapters,
        key=lambda row: (_discipline_sort_key((row[0], row[2])), _chapter_sort_key((row[1], row[2]))),
    )
    result = {
        "total": total,
        "disciplines": [{"discipline": discipline or "土建", "count": count} for discipline, count in disciplines],
        "chapters": [
            {"discipline": discipline or "土建", "chapter": chapter, "count": count}
            for discipline, chapter, count in chapters
        ],
    }
    cache.set(cache_key, result, QUOTA_CACHE_TTL)
    return result


@router.post("/quota-items/restore-reference")
def restore_reference_quota_items(request: Request, force: bool = Query(False)):
    restore = getattr(request.app.state, "restore_reference_seed_data", None)
    restored = restore(force=force) if callable(restore) else {}
    cache.invalidate("quota:")
    clear_quota_match_cache()
    return {
        "ok": True,
        "restored": restored,
        "message": "基础库已恢复" if restored else "基础库已有数据，无需恢复",
    }


# ── 旧材料（遗址修复材料）单条创建/更新接口 ──

VALID_ACQUISITION_METHODS = {"", "recycle", "reproduce"}


class QuotaItemCreatePayload(BaseModel):
    """创建/更新单条定额（支持旧材料扩展字段）。"""

    quota_code: str = Field(..., min_length=1, description="定额编码")
    discipline: str = Field("土建", description="专业，旧材料请填 '旧材料'")
    name: str = Field(..., min_length=1)
    unit: str = Field(..., min_length=1)
    labor_qty: float = Field(0, ge=0)
    material_qty: float = Field(0, ge=0)
    machine_qty: float = Field(0, ge=0)
    work_content: str = ""
    applicable_scope: str = ""
    chapter: str = ""
    version: str = ""
    base_price: float = Field(0, ge=0)
    # 旧材料扩展字段
    acquisition_method: str = Field(
        "",
        description="获取方式：recycle=当地回收 / reproduce=原材料复现 / 空字符串=普通定额",
    )
    origin_note: str = ""
    heritage_site: str = ""
    relic_level: str = ""
    repair_part: str = ""
    condition_grade: str = ""
    batch_no: str = ""
    inspection_report_no: str = ""


@router.post("/quota-items")
def create_quota_item(
    payload: QuotaItemCreatePayload,
    db: Session = Depends(get_db),
):
    """创建或更新单条定额（按 (discipline, quota_code) 唯一约束 upsert）。

    主要用于添加旧材料（遗址修复材料）定额条目：
    - acquisition_method='recycle'：当地回收旧材料
    - acquisition_method='reproduce'：用遗址所用原材料直接复现
    """
    if payload.discipline not in VALID_DISCIPLINES:
        raise HTTPException(
            status_code=400,
            detail=f"无效的专业：{payload.discipline}，可选：{sorted(VALID_DISCIPLINES)}",
        )
    if payload.acquisition_method and payload.acquisition_method not in VALID_ACQUISITION_METHODS:
        raise HTTPException(
            status_code=400,
            detail=f"无效的获取方式：{payload.acquisition_method}，可选：recycle / reproduce",
        )

    existing = (
        db.query(QuotaItem)
        .filter(
            QuotaItem.discipline == payload.discipline,
            QuotaItem.quota_code == payload.quota_code,
        )
        .first()
    )

    data = payload.model_dump()
    if existing is None:
        item = QuotaItem(**data)
        db.add(item)
        action = "created"
    else:
        for key, value in data.items():
            setattr(existing, key, value)
        item = existing
        action = "updated"

    db.commit()
    db.refresh(item)
    cache.invalidate("quota:")
    return {"ok": True, "action": action, "item": _quota_item_to_dict(item)}
