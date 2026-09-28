"""Create BOQ items, match quotas, and calculate price from drawing results."""

from __future__ import annotations

import json
import re
from datetime import datetime
from difflib import SequenceMatcher
from typing import Any, Callable

from sqlalchemy.orm import Session

from app.models.boq_item import BoqItem
from app.models.calc_result import CalcResult
from app.models.line_item_quota_binding import LineItemQuotaBinding
from app.models.project import Project
from app.models.quota_item import QuotaItem
from app.schemas.calc_result import LineCalcResultOut, ProjectCalcSummary
from app.services.audit_service import write_audit_log
from app.services.project_calc_service import run_project_calculation
from app.services.quota_match_service import _name_similarity, _tokenize, _units_compatible

ProgressCallback = Callable[[str], None]

VALID_MATCH_DISCIPLINES = {"土建", "给排水", "电气", "暖通消防"}
BUILDING_BOQ_PREFIXES = ("010", "011", "012")
PLUMBING_BOQ_PREFIXES = ("0310",)
ELECTRICAL_BOQ_PREFIXES = ("0304",)
HVAC_FIRE_BOQ_PREFIXES = ("0307", "0309")
INSTALLATION_DISCIPLINES = {"给排水", "电气", "暖通消防"}

DISCIPLINE_KEYWORDS: dict[str, tuple[str, ...]] = {
    "给排水": ("给水", "排水", "雨水", "污水", "废水", "卫生洁具", "阀门", "管道安装", "水管", "PPR", "PVC", "HDPE"),
    "电气": ("电气", "配管", "电缆", "电线", "桥架", "线槽", "配电箱", "灯具", "开关", "插座", "照明"),
    "暖通消防": ("暖通", "通风", "风管", "空调", "风机", "新风", "排风", "防排烟", "消防", "喷淋", "消火栓", "报警", "烟感", "温感"),
    "土建": ("混凝土", "钢筋", "柱", "梁", "板", "墙", "基础", "楼梯", "门", "窗", "砌筑", "砖", "屋面", "防水", "抹灰", "地面", "天棚"),
}

INSTALLATION_NOISE_KEYWORDS = (
    "消防", "喷淋", "消火栓", "报警", "烟感", "温感", "灭火器", "给水", "排水", "雨水", "污水", "废水",
    "卫生洁具", "阀门", "管道安装", "电气", "配管", "电缆", "电线", "桥架", "线槽", "配电箱", "灯具",
    "开关", "插座", "暖通", "通风", "风管", "空调", "风机", "防排烟",
)

OUTLIER_UNIT_RATE_LIMITS = {
    "m3": 8000.0,
    "m2": 2500.0,
    "m": 2000.0,
    "t": 20000.0,
    "kg": 20.0,
    "个": 30000.0,
    "套": 50000.0,
    "台": 80000.0,
    "樘": 30000.0,
}

REVIEW_TOTAL_WARNING = 30_000_000.0
REVIEW_TOTAL_CRITICAL = 100_000_000.0
REVIEW_ITEM_TOTAL_WARNING = 10_000_000.0
REVIEW_ITEM_TOTAL_CRITICAL = 50_000_000.0


def _text(value: Any, default: str = "") -> str:
    if value is None:
        return default
    return str(value).strip() or default


def _number(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _boq_text(boq: BoqItem) -> str:
    return f"{boq.code or ''} {boq.name or ''} {boq.characteristics or ''} {boq.division or ''}"


def _infer_boq_discipline(code: str, name: str, characteristics: str = "", division: str = "") -> str:
    joined = f"{code} {name} {characteristics} {division}"
    if code.startswith(BUILDING_BOQ_PREFIXES):
        return "土建"
    if code.startswith(PLUMBING_BOQ_PREFIXES):
        return "给排水"
    if code.startswith("0308"):
        return "暖通消防"
    if code.startswith(ELECTRICAL_BOQ_PREFIXES):
        return "电气"
    if code.startswith(HVAC_FIRE_BOQ_PREFIXES):
        return "暖通消防"
    for discipline in ("给排水", "电气", "暖通消防", "土建"):
        if any(keyword in joined for keyword in DISCIPLINE_KEYWORDS[discipline]):
            return discipline
    return "土建"


def _normalize_quota_discipline(quota: QuotaItem) -> str:
    code = quota.quota_code or ""
    code_stripped = code.strip()
    code_match = re.match(r"^(借)?(?:[A-Za-z])?\s*(\d{1,2})\s*[-－—]", code_stripped)
    borrowed_prefix = bool(code_match and code_match.group(1))
    code_prefix = int(code_match.group(2)) if code_match else None
    boq_like_prefix = code_stripped[:4]
    if boq_like_prefix == "0310":
        return "给排水"
    if boq_like_prefix == "0304":
        return "电气"
    if boq_like_prefix in {"0307", "0308", "0309"}:
        return "暖通消防"
    if code_prefix == 10:
        return "给排水"

    text = _quota_search_text(quota)
    if borrowed_prefix:
        borrowed_chapter = int(code_match.group(2))
        if borrowed_chapter == 10:
            return "给排水"
        if borrowed_chapter == 4 and any(token in text for token in ("桥架", "电缆", "电线", "配管", "电气", "照明", "配电")):
            return "电气"
        if borrowed_chapter in {7, 8, 9} and any(token in text for token in DISCIPLINE_KEYWORDS["暖通消防"]):
            return "暖通消防"

    raw = (getattr(quota, "discipline", "") or "").strip()
    if raw in VALID_MATCH_DISCIPLINES:
        return raw

    for discipline in ("给排水", "电气", "暖通消防", "土建"):
        if any(keyword in text for keyword in DISCIPLINE_KEYWORDS[discipline]):
            return discipline

    if any(token in text for token in ("电气", "第四册", "0304")):
        return "电气"
    if any(token in text for token in ("给排水", "给水", "排水", "第十册", "0310")):
        return "给排水"
    if any(token in text for token in ("暖通", "消防", "通风", "空调", "第七册", "第八册", "第九册", "0307", "0309")):
        return "暖通消防"

    if code_prefix is not None and 1 <= code_prefix <= 16:
        return "土建"

    return "土建"


def _quota_matches_boq_discipline(boq: BoqItem, quota: QuotaItem) -> bool:
    boq_discipline = _infer_boq_discipline(boq.code or "", boq.name or "", boq.characteristics or "", boq.division or "")
    return _normalize_quota_discipline(quota) == boq_discipline


def _filter_suggestions_by_drawing_major(suggestions: list[dict[str, Any]]) -> list[dict[str, Any]]:
    disciplines = [
        _infer_boq_discipline(
            _text(item.get("suggested_code")),
            _text(item.get("suggested_name")),
            _text(item.get("characteristics")),
        )
        for item in suggestions
    ]
    building_count = sum(1 for discipline in disciplines if discipline == "土建")
    installation_count = sum(1 for discipline in disciplines if discipline in INSTALLATION_DISCIPLINES)
    if building_count < max(3, installation_count * 3):
        return suggestions

    filtered: list[dict[str, Any]] = []
    for suggestion, discipline in zip(suggestions, disciplines):
        text = " ".join(
            _text(suggestion.get(key))
            for key in ("suggested_code", "suggested_name", "characteristics", "source_component_id")
        )
        if discipline in INSTALLATION_DISCIPLINES or any(keyword in text for keyword in INSTALLATION_NOISE_KEYWORDS):
            continue
        filtered.append(suggestion)
    return filtered or suggestions


def _normalized_unit_key(unit: str) -> str:
    normalized = _normalize_unit_for_scale(unit)
    if normalized in {"m2", "平方米", "平米", "平方"}:
        return "m2"
    if normalized in {"m3", "立方", "方"}:
        return "m3"
    if normalized in {"米", "延米"}:
        return "m"
    return normalized


def _unit_rate_limit(unit: str) -> float | None:
    return OUTLIER_UNIT_RATE_LIMITS.get(_normalized_unit_key(unit))


def _emit(progress_callback: ProgressCallback | None, message: str) -> None:
    if not progress_callback:
        return
    try:
        progress_callback(message)
    except Exception:
        pass


def _project_name(source_type: str = "drawing") -> str:
    prefix = "IFC自动套定额" if source_type == "ifc" else "图纸自动套定额"
    return f"{prefix}-{datetime.now().strftime('%m%d%H%M%S')}"


def division_for_boq(code: str, name: str) -> str:
    joined = f"{code} {name}"
    if code.startswith("0309") or any(token in joined for token in ("消防", "喷淋", "消火栓", "报警", "烟感", "温感", "灭火器")):
        return "消防工程"
    if code.startswith("0310") or any(token in joined for token in ("给水", "排水", "雨水", "污水", "废水", "卫生洁具", "阀门", "水管", "管道安装")):
        return "给排水工程"
    if code.startswith(("0304", "0308")) or any(token in joined for token in ("电气", "配管", "电缆", "电线", "桥架", "线槽", "配电箱", "灯具", "开关", "插座")):
        return "电气工程"
    if code.startswith("0307") or any(token in joined for token in ("暖通", "通风", "风管", "空调", "风机", "新风", "排风", "防排烟")):
        return "暖通空调工程"
    if code.startswith("0104") or any(token in joined for token in ("混凝土", "钢筋", "柱", "梁", "板", "墙", "基础", "楼梯")):
        return "混凝土及钢筋工程"
    if code.startswith("0108") or any(token in joined for token in ("门", "窗")):
        return "门窗工程"
    if any(token in joined for token in ("砌筑", "砖", "墙体")):
        return "砌筑工程"
    return "图纸识别工程"


IFC_QUOTA_HINTS: tuple[dict[str, Any], ...] = (
    {"boq_prefixes": ("010401",), "quota_prefixes": ("5-",), "required_any": ("基础",), "preferred_any": ("独立基础", "条形基础", "杯形基础", "筏形基础", "基础"), "excluded_any": ("模板", "砖", "石砌体", "喷射", "地下连续墙", "换填", "基础连系梁")},
    {"boq_prefixes": ("010402",), "quota_prefixes": ("5-",), "required_any": ("柱",), "preferred_any": ("矩形柱", "构造柱", "圆形柱", "异形柱"), "excluded_any": ("模板", "砖", "石砌体", "抹灰", "镶贴", "装饰")},
    {"boq_prefixes": ("010403",), "quota_prefixes": ("5-",), "required_any": ("梁",), "preferred_any": ("矩形梁", "基础连系梁", "过梁", "圈梁"), "excluded_any": ("模板", "有梁板", "砖", "抹灰", "镶贴", "钢结构")},
    {"boq_prefixes": ("010404",), "quota_prefixes": ("5-",), "required_any": ("墙",), "preferred_any": ("直形墙", "电梯井壁", "弧形墙"), "excluded_any": ("模板", "地下连续墙", "砖", "砌体", "抹灰", "涂料", "保温")},
    {"boq_prefixes": ("010405",), "quota_prefixes": ("5-",), "required_any": ("板",), "preferred_any": ("平板", "有梁板", "无梁板", "斜板", "坡屋面板"), "excluded_any": ("模板", "钢板桩", "挡土板", "天棚", "面层")},
    {"boq_prefixes": ("010406",), "quota_prefixes": ("5-",), "required_any": ("楼梯",), "preferred_any": ("楼梯 直形", "现浇混凝土 楼梯"), "excluded_any": ("模板", "钢楼梯", "木", "弧形", "螺旋")},
    {"boq_prefixes": ("010407",), "quota_prefixes": ("5-",), "required_any": ("钢筋",), "preferred_any": ("现浇构件钢筋", "钢筋制作", "钢筋安装", "HRB400", "HPB300"), "excluded_any": ("钢筋笼", "桩", "预应力", "砌体钢筋")},
    {"boq_prefixes": ("010801",), "quota_prefixes": ("8-",), "required_any": ("门",), "preferred_any": ("木门", "木质", "套装木门", "门安装"), "excluded_any": ("窗", "门窗框", "模板", "锁门管", "防水板")},
    {"boq_prefixes": ("010803",), "quota_prefixes": ("8-",), "required_any": ("窗",), "preferred_any": ("铝合金窗", "金属窗", "普通窗", "窗安装"), "excluded_any": ("门", "门窗框", "模板", "防水板", "飘窗板", "混凝土")},
    {"boq_prefixes": ("010901",), "quota_prefixes": ("7-", "9-", "5-"), "required_any": ("屋面",), "preferred_any": ("屋面板", "坡屋面板", "屋面"), "excluded_any": ("模板", "防水板")},
    {"boq_prefixes": ("010902",), "quota_prefixes": ("7-", "9-"), "required_any": ("防水",), "preferred_any": ("SBS", "卷材", "涂膜", "防水层", "聚氨酯"), "excluded_any": ("模板", "混凝土", "钢筋")},
    {"boq_prefixes": ("010903", "010904",), "quota_prefixes": ("7-", "9-"), "required_any": ("防水",), "preferred_any": ("墙面防水", "楼地面防水", "卷材", "涂膜", "JS", "聚氨酯"), "excluded_any": ("模板", "屋面")},
    {"boq_prefixes": ("011001",), "quota_prefixes": ("15-",), "required_any": ("保温", "隔热"), "preferred_any": ("保温", "隔热", "EPS", "XPS", "挤塑板", "聚苯板", "岩棉"), "excluded_any": ("涂料", "抹灰", "防水")},
    {"boq_prefixes": ("011102",), "quota_prefixes": ("11-",), "required_any": ("楼地面", "地面"), "preferred_any": ("地砖", "石材", "地板", "找平层", "垫层", "楼地面"), "excluded_any": ("墙面", "天棚", "屋面")},
    {"boq_prefixes": ("011201",), "quota_prefixes": ("12-",), "required_any": ("抹灰", "粉刷"), "preferred_any": ("墙面抹灰", "一般抹灰", "水泥砂浆", "混合砂浆"), "excluded_any": ("涂料", "防水", "保温")},
    {"boq_prefixes": ("011304",), "quota_prefixes": ("13-",), "required_any": ("吊顶", "天棚"), "preferred_any": ("吊顶", "天棚", "石膏板", "铝扣板", "矿棉板"), "excluded_any": ("墙面", "楼地面")},
    {"boq_prefixes": ("011407",), "quota_prefixes": ("14-",), "required_any": ("涂料", "油漆"), "preferred_any": ("乳胶漆", "油漆", "喷涂", "刷漆", "真石漆", "氟碳漆"), "excluded_any": ("抹灰", "防水", "保温")},
    {"boq_prefixes": ("011701",), "quota_prefixes": ("17-",), "required_any": ("模板",), "preferred_any": ("组合钢模", "复合木模", "胶合板", "模板"), "excluded_any": ("混凝土", "钢筋", "砌体")},
    {"boq_prefixes": ("011702",), "quota_prefixes": ("17-",), "required_any": ("脚手架",), "preferred_any": ("综合脚手架", "满堂脚手架", "外脚手架", "里脚手架"), "excluded_any": ("混凝土", "模板")},
    {"boq_prefixes": ("010101", "010102",), "quota_prefixes": ("1-",), "required_any": ("土方", "开挖", "回填"), "preferred_any": ("人工挖土", "机械挖土", "回填", "土方"), "excluded_any": ("混凝土", "模板", "钢筋")},
    {"boq_prefixes": ("031001",), "quota_prefixes": ("借10-1", "10-1"), "required_any": ("管道",), "preferred_any": ("给排水管道", "管道", "PPR", "PVC", "HDPE"), "excluded_any": ("支架", "保温", "刷油", "消防")},
    {"boq_prefixes": ("031003",), "quota_prefixes": ("借10-1", "10-1"), "required_any": ("阀门",), "preferred_any": ("阀门安装", "闸阀", "截止阀", "蝶阀", "球阀"), "excluded_any": ("管道", "支架", "保温")},
    {"boq_prefixes": ("031004",), "quota_prefixes": ("借10-1", "10-1"), "required_any": ("洁具", "卫生器具"), "preferred_any": ("坐便器", "蹲便器", "洗脸盆", "小便器", "地漏", "卫生洁具"), "excluded_any": ("管道", "阀门")},
    {"boq_prefixes": ("031002",), "quota_prefixes": ("借10-1", "10-1"), "required_any": ("支架",), "preferred_any": ("管道支架", "支吊架", "管卡"), "excluded_any": ("管道安装", "阀门")},
    {"boq_prefixes": ("030411",), "quota_prefixes": ("借4-1", "4-1"), "required_any": ("配管", "线管"), "preferred_any": ("电气配管", "电线管", "JDG", "KBG", "SC", "PC"), "excluded_any": ("电缆", "桥架", "灯具")},
    {"boq_prefixes": ("030408",), "quota_prefixes": ("借4-8", "4-8"), "required_any": ("电缆", "电线"), "preferred_any": ("电缆敷设", "YJV", "BV", "WDZ", "NH", "电线"), "excluded_any": ("配管", "桥架", "灯具")},
    {"boq_prefixes": ("030404",), "quota_prefixes": ("借4-9", "4-9"), "required_any": ("桥架",), "preferred_any": ("钢制桥架", "槽式桥架", "桥架安装"), "excluded_any": ("支架", "电缆")},
    {"boq_prefixes": ("030412",), "quota_prefixes": ("借4-12", "4-12"), "required_any": ("灯具", "开关", "插座"), "preferred_any": ("灯具安装", "开关安装", "插座安装", "应急灯", "照明"), "excluded_any": ("电缆", "配管", "桥架")},
    {"boq_prefixes": ("030414",), "quota_prefixes": ("借4-14", "4-14"), "required_any": ("防雷", "接地"), "preferred_any": ("避雷网", "引下线", "接地极", "均压环", "接地母线"), "excluded_any": ("电缆", "配管")},
    {"boq_prefixes": ("030701",), "quota_prefixes": ("9-",), "required_any": ("风管",), "preferred_any": ("镀锌薄钢板", "矩形风管", "圆形风管", "风管"), "excluded_any": ("防水板",)},
    {"boq_prefixes": ("030702",), "quota_prefixes": ("9-",), "required_any": ("空调", "风机"), "preferred_any": ("空调机组", "风机盘管", "新风机", "排风机", "风机安装"), "excluded_any": ("风管", "水管")},
    {"boq_prefixes": ("030703",), "quota_prefixes": ("9-",), "required_any": ("风阀", "风口"), "preferred_any": ("风阀", "风口", "散流器", "调节阀", "防火阀"), "excluded_any": ("风管", "风机")},
    {"boq_prefixes": ("030901",), "quota_prefixes": ("借7-1", "7-1", "9-"), "required_any": ("消防", "喷淋", "消火栓"), "preferred_any": ("消防管道", "喷淋管", "消火栓管", "镀锌钢管"), "excluded_any": ("给排水", "PPR", "PVC")},
    {"boq_prefixes": ("030902",), "quota_prefixes": ("借7-1", "7-1"), "required_any": ("消火栓",), "preferred_any": ("室内消火栓", "室外消火栓", "消火栓安装"), "excluded_any": ("喷淋", "管道")},
    {"boq_prefixes": ("030903",), "quota_prefixes": ("借7-1", "7-1"), "required_any": ("喷淋", "喷头"), "preferred_any": ("喷淋头", "喷头安装", "下喷", "上喷"), "excluded_any": ("消火栓", "管道")},
    {"boq_prefixes": ("030904",), "quota_prefixes": ("借7-1", "7-1"), "required_any": ("报警", "烟感", "温感"), "preferred_any": ("烟感", "温感", "报警按钮", "模块", "探测器"), "excluded_any": ("管道", "喷头")},
)


def _hint_for_boq(boq: BoqItem) -> dict[str, Any] | None:
    code = boq.code or ""
    for hint in IFC_QUOTA_HINTS:
        if any(code.startswith(prefix) for prefix in hint["boq_prefixes"]):
            return hint
    return None


def _quota_code_matches_prefix(quota: QuotaItem, prefixes: tuple[str, ...]) -> bool:
    code = quota.quota_code or ""
    return any(code.startswith(prefix) for prefix in prefixes)


def _quota_search_text(quota: QuotaItem) -> str:
    return " ".join(
        str(value or "")
        for value in (
            quota.quota_code,
            quota.name,
            getattr(quota, "discipline", ""),
            getattr(quota, "chapter", ""),
            getattr(quota, "applicable_scope", ""),
        )
    )


def _contains_any(text: str, terms: tuple[str, ...]) -> bool:
    return any(term and term in text for term in terms)


def _preferred_term_score(text: str, terms: tuple[str, ...]) -> float:
    total = len(terms)
    if total == 0:
        return 0.0
    for index, term in enumerate(terms):
        if term and term in text:
            return (total - index) / total
    return 0.0


def _semantic_hint_score(quota: QuotaItem, hint: dict[str, Any] | None) -> float:
    if not hint:
        return 0.0
    text = _quota_search_text(quota)
    score = 0.0
    if _quota_code_matches_prefix(quota, hint.get("quota_prefixes", ())):
        score += 0.36
    if _contains_any(text, hint.get("required_any", ())):
        score += 0.34
    score += _preferred_term_score(text, hint.get("preferred_any", ())) * 0.22
    if _contains_any(text, hint.get("excluded_any", ())):
        score -= 0.45
    return max(0.0, min(1.0, score))


def _narrow_quota_candidates(boq: BoqItem, quotas: list[QuotaItem]) -> list[QuotaItem]:
    discipline_matches = [q for q in quotas if _quota_matches_boq_discipline(boq, q)]
    quota_pool = discipline_matches or quotas
    hint = _hint_for_boq(boq)
    if not hint:
        prefix = (boq.code or "")[:4]
        if prefix and len(quota_pool) > 300:
            prefix_matches = [q for q in quota_pool if (q.quota_code or "").startswith(prefix)]
            if prefix_matches:
                return prefix_matches
        return quota_pool

    candidates = [q for q in quota_pool if _quota_code_matches_prefix(q, hint.get("quota_prefixes", ()))]
    if not candidates:
        candidates = quota_pool

    required = hint.get("required_any", ())
    if required:
        required_matches = [q for q in candidates if _contains_any(_quota_search_text(q), required)]
        if required_matches:
            candidates = required_matches

    excluded = hint.get("excluded_any", ())
    clean = [q for q in candidates if not _contains_any(_quota_search_text(q), excluded)]
    return clean or candidates


def _normalize_unit_for_scale(unit: str) -> str:
    return (
        (unit or "")
        .strip()
        .lower()
        .replace("㎡", "m2")
        .replace("m²", "m2")
        .replace("m^2", "m2")
        .replace("立方米", "m3")
        .replace("m³", "m3")
        .replace("m^3", "m3")
        .replace("千克", "kg")
        .replace("公斤", "kg")
    )


def _base_units_compatible(boq_unit: str, quota_base_unit: str) -> bool:
    if _units_compatible(boq_unit, quota_base_unit):
        return True

    boq = _normalize_unit_for_scale(boq_unit)
    quota = _normalize_unit_for_scale(quota_base_unit)
    if boq == quota:
        return True

    families = (
        {"m", "米", "延米"},
        {"m2", "平方米", "平米", "平方"},
        {"m3", "立方", "方"},
        {"kg"},
        {"t", "吨"},
        {"个", "只", "件", "套", "台", "组", "点", "处", "座", "樘", "副", "块", "片", "根", "口", "孔", "箱"},
    )
    return any(boq in family and quota in family for family in families)


def _scaled_units_compatible(boq_unit: str, quota_unit: str) -> bool:
    if _units_compatible(boq_unit, quota_unit):
        return True

    quota = _normalize_unit_for_scale(quota_unit)
    boq = _normalize_unit_for_scale(boq_unit)
    if boq == "m" and quota == "km":
        return True
    if boq == "kg" and quota in {"t", "吨"}:
        return True

    match = re.match(r"^(1000|100|10)\s*(.+)$", quota)
    return bool(match and _base_units_compatible(boq_unit, match.group(2).strip()))


def binding_coefficient_for_units(boq_unit: str, quota_unit: str) -> float:
    quota = _normalize_unit_for_scale(quota_unit)
    boq = _normalize_unit_for_scale(boq_unit)

    if boq == "m" and quota == "km":
        return 0.001
    if boq == "kg" and quota in {"t", "吨"}:
        return 0.001

    match = re.match(r"^(1000|100|10)\s*(.+)$", quota)
    if match and _base_units_compatible(boq_unit, match.group(2).strip()):
        return 1.0 / float(match.group(1))

    return 1.0


def _extract_spec_markers(text: str) -> set[str]:
    """从文本中提取规格等级标记（如 C30、HRB400、DN100、SC20）。"""
    markers: set[str] = set()
    if not text:
        return markers
    # 混凝土强度等级
    for m in re.finditer(r"[Cc](\d{2,3})", text):
        markers.add(f"C{m.group(1)}")
    # 钢筋牌号
    for m in re.finditer(r"[Hh][Pp][BbRr]?(\d{3,4})", text):
        markers.add(f"HPB{m.group(1)}")
    for m in re.finditer(r"[Hh][Rr][Bb]?(\d{3,4})", text):
        markers.add(f"HRB{m.group(1)}")
    # 管径
    for m in re.finditer(r"[Dd][Nn](\d{1,4})", text):
        markers.add(f"DN{m.group(1)}")
    for m in re.finditer(r"[Dd][Ee](\d{1,4})", text):
        markers.add(f"DE{m.group(1)}")
    # 管材规格
    for m in re.finditer(r"\b(SC|PC|JDG|KBG|RC)(\d{1,3})\b", text, re.IGNORECASE):
        markers.add(f"{m.group(1).upper()}{m.group(2)}")
    # 电缆型号
    for m in re.finditer(r"\b(YJV|BV|BVR|WDZ[N]?|NH|KVV)([-/]?\w*)", text, re.IGNORECASE):
        markers.add(m.group(1).upper())
    # 截面尺寸
    for m in re.finditer(r"(\d{2,4})\s*[×xX*]\s*(\d{2,4})", text):
        markers.add(f"{m.group(1)}x{m.group(2)}")
    # 厚度
    for m in re.finditer(r"[TtHhDd][=＝](\d{2,4})", text):
        markers.add(f"T={m.group(1)}")
    return markers


def _structure_category(text: str) -> str | None:
    """推断文本所属的结构类别（用于跨构件惩罚）。"""
    if not text:
        return None
    text_lower = text.lower()
    # 按优先级匹配，避免"有梁板"被误判为梁
    if any(k in text for k in ("有梁板", "无梁板", "平板", "楼板", "坡屋面板", "斜板")):
        return "板"
    if any(k in text for k in ("框架柱", "矩形柱", "构造柱", "异形柱", "圆柱", "芯柱")):
        return "柱"
    if any(k in text for k in ("框架梁", "矩形梁", "过梁", "圈梁", "连梁", "基础梁")):
        return "梁"
    if any(k in text for k in ("剪力墙", "直形墙", "弧形墙", "挡土墙", "电梯井")):
        return "墙"
    if any(k in text for k in ("独立基础", "条形基础", "杯形基础", "筏板", "承台", "垫层")):
        return "基础"
    if any(k in text for k in ("楼梯", "梯段")):
        return "楼梯"
    if any(k in text for k in ("门",)) and "窗" not in text:
        return "门"
    if any(k in text for k in ("窗",)) and "门" not in text:
        return "窗"
    if any(k in text for k in ("管道", "给水", "排水", "PPR", "PVC", "HDPE")):
        return "管道"
    if any(k in text for k in ("电缆", "电线", "YJV", "BV", "WDZ")):
        return "电缆"
    if any(k in text for k in ("桥架",)) :
        return "桥架"
    if any(k in text for k in ("风管", "送风", "回风", "排风")):
        return "风管"
    if any(k in text for k in ("消防", "喷淋", "消火栓")):
        return "消防"
    if any(k in text for k in ("防水", "卷材", "涂膜", "SBS")):
        return "防水"
    if any(k in text for k in ("保温", "隔热", "EPS", "XPS")):
        return "保温"
    if any(k in text for k in ("涂料", "乳胶漆", "油漆")):
        return "涂料"
    if any(k in text for k in ("抹灰", "粉刷")):
        return "抹灰"
    if any(k in text for k in ("吊顶", "天棚")):
        return "吊顶"
    if any(k in text for k in ("模板", "脚手架")):
        return "措施"
    return None


def match_quota_for_boq(boq: BoqItem, quotas: list[QuotaItem]) -> tuple[QuotaItem | None, float]:
    best: QuotaItem | None = None
    best_score = 0.0
    hint = _hint_for_boq(boq)
    candidates = _narrow_quota_candidates(boq, quotas)
    prefix = (boq.code or "")[:4]

    if not hint and prefix and len(quotas) > 300:
        prefix_matches = [q for q in quotas if (q.quota_code or "").startswith(prefix)]
        if prefix_matches:
            candidates = prefix_matches

    if len(candidates) > 180:
        boq_tokens = _tokenize(f"{boq.code} {boq.name}")
        recalled: list[tuple[float, QuotaItem]] = []
        for quota in candidates:
            quota_tokens = _tokenize(f"{quota.quota_code} {quota.name}")
            overlap = len(boq_tokens & quota_tokens) / max(len(boq_tokens), 1)
            unit_bonus = 0.35 if _scaled_units_compatible(boq.unit, quota.unit) else 0.0
            prefix_bonus = 0.35 if prefix and (quota.quota_code or "").startswith(prefix) else 0.0
            hint_bonus = _semantic_hint_score(quota, hint) * 0.7
            code_score = SequenceMatcher(None, boq.code or "", quota.quota_code or "").ratio() * 0.2
            recalled.append((overlap + unit_bonus + prefix_bonus + hint_bonus + code_score, quota))
        recalled.sort(key=lambda item: item[0], reverse=True)
        candidates = [quota for _score, quota in recalled[:180]]

    # 预提取 BOQ 的规格标记和结构类别
    boq_full_text = f"{boq.code} {boq.name} {boq.characteristics or ''}"
    boq_markers = _extract_spec_markers(boq_full_text)
    boq_category = _structure_category(f"{boq.name} {boq.characteristics or ''}")

    for quota in candidates:
        if not _quota_matches_boq_discipline(boq, quota):
            continue
        name_score = _name_similarity(boq.name, quota.name)
        unit_score = 1.0 if _scaled_units_compatible(boq.unit, quota.unit) else 0.0
        code_score = SequenceMatcher(None, boq.code or "", quota.quota_code or "").ratio()
        prefix_bonus = 0.08 if boq.code and quota.quota_code and quota.quota_code.startswith(boq.code[:4]) else 0.0
        semantic_score = _semantic_hint_score(quota, hint)

        # 规格等级匹配（新增）
        quota_full_text = f"{quota.quota_code} {quota.name} {getattr(quota, 'applicable_scope', '') or ''}"
        quota_markers = _extract_spec_markers(quota_full_text)
        if boq_markers and quota_markers:
            marker_overlap = len(boq_markers & quota_markers) / len(boq_markers)
            spec_score = marker_overlap
        else:
            spec_score = 0.5  # 无规格信息时中性分

        # 结构类别匹配（新增，跨构件惩罚）
        quota_category = _structure_category(quota_full_text)
        if boq_category and quota_category:
            if boq_category == quota_category:
                category_bonus = 0.05  # 同类别加分
            else:
                category_bonus = -0.15  # 跨类别强扣
        else:
            category_bonus = 0.0

        # 增强加权：名称 0.35 + 单位 0.20 + 编码 0.06 + 语义 0.25 + 规格 0.10 + 类别 + 前缀
        score = min(
            1.0,
            name_score * 0.35
            + unit_score * 0.20
            + code_score * 0.06
            + semantic_score * 0.25
            + spec_score * 0.10
            + category_bonus
            + prefix_bonus,
        )
        # 单位不一致额外惩罚
        if unit_score == 0.0:
            score -= 0.10

        if score > best_score:
            best = quota
            best_score = score

    return best, round(max(0.0, best_score), 3)


def _line_calc_out(boq: BoqItem, result: Any) -> LineCalcResultOut:
    return LineCalcResultOut(
        boq_item_id=boq.id,
        boq_code=boq.code,
        boq_name=boq.name,
        labor_cost=result.labor_cost,
        material_cost=result.material_cost,
        machine_cost=result.machine_cost,
        direct_cost=result.direct_cost,
        management_fee=result.management_fee,
        profit=result.profit,
        regulatory_fee=result.regulatory_fee,
        pre_tax_total=result.pre_tax_total,
        tax=result.tax,
        total=result.total,
    )


def _summary_out(summary: Any, line_results: list[tuple[BoqItem, Any]]) -> ProjectCalcSummary:
    return ProjectCalcSummary(
        total_direct=summary.total_direct,
        total_management=summary.total_management,
        total_profit=summary.total_profit,
        total_regulatory=summary.total_regulatory,
        total_pre_tax=summary.total_pre_tax,
        total_tax=summary.total_tax,
        total_measures=summary.total_measures,
        grand_total=summary.grand_total,
        line_results=[_line_calc_out(boq, result) for boq, result in line_results],
    )


def _dump_model(model: Any) -> dict[str, Any]:
    if hasattr(model, "model_dump"):
        return model.model_dump()
    if hasattr(model, "dict"):
        return model.dict()
    return dict(model)


def _apply_base_price_fallback(
    *,
    db: Session,
    calc_summary: ProjectCalcSummary,
    item_outputs: list[dict[str, Any]],
    boq_by_id: dict[int, BoqItem],
    quota_by_boq_id: dict[int, QuotaItem],
) -> None:
    line_by_boq = {line.boq_item_id: line for line in calc_summary.line_results}
    changed = False

    for output in item_outputs:
        boq_id = int(output.get("boq_item_id") or 0)
        if output.get("status") != "matched" or _number(output.get("total")) > 0:
            continue

        quota = quota_by_boq_id.get(boq_id)
        boq = boq_by_id.get(boq_id)
        if not quota or not boq or quota.base_price <= 0:
            continue

        total = round(boq.quantity * quota.base_price, 2)
        if total <= 0:
            continue

        output["total"] = total
        line = line_by_boq.get(boq_id)
        if line is None:
            line = LineCalcResultOut(
                boq_item_id=boq.id,
                boq_code=boq.code,
                boq_name=boq.name,
                labor_cost=0.0,
                material_cost=0.0,
                machine_cost=0.0,
                direct_cost=total,
                management_fee=0.0,
                profit=0.0,
                regulatory_fee=0.0,
                pre_tax_total=total,
                tax=0.0,
                total=total,
            )
            calc_summary.line_results.append(line)
            line_by_boq[boq_id] = line
        else:
            line.direct_cost = total
            line.pre_tax_total = total
            line.total = total

        row = db.query(CalcResult).filter(CalcResult.boq_item_id == boq_id).first()
        if row:
            row.total_cost = total
        else:
            db.add(CalcResult(boq_item_id=boq_id, total_cost=total))
        boq.is_dirty = 0
        changed = True

    if not changed:
        return

    calc_summary.total_direct = round(sum(line.direct_cost for line in calc_summary.line_results), 2)
    calc_summary.total_management = round(sum(line.management_fee for line in calc_summary.line_results), 2)
    calc_summary.total_profit = round(sum(line.profit for line in calc_summary.line_results), 2)
    calc_summary.total_regulatory = round(sum(line.regulatory_fee for line in calc_summary.line_results), 2)
    calc_summary.total_pre_tax = round(sum(line.pre_tax_total for line in calc_summary.line_results), 2)
    calc_summary.total_tax = round(sum(line.tax for line in calc_summary.line_results), 2)
    calc_summary.grand_total = round(sum(line.total for line in calc_summary.line_results) + calc_summary.total_measures, 2)
    db.commit()


def _clamp_auto_valuation_outliers(
    *,
    db: Session,
    calc_summary: ProjectCalcSummary,
    item_outputs: list[dict[str, Any]],
    boq_by_id: dict[int, BoqItem],
    quota_by_boq_id: dict[int, QuotaItem],
) -> None:
    line_by_boq = {line.boq_item_id: line for line in calc_summary.line_results}
    changed = False

    for output in item_outputs:
        boq_id = int(output.get("boq_item_id") or 0)
        if output.get("status") != "matched":
            continue

        boq = boq_by_id.get(boq_id)
        quota = quota_by_boq_id.get(boq_id)
        line = line_by_boq.get(boq_id)
        if not boq or not quota or not line or boq.quantity <= 0 or quota.base_price <= 0:
            continue

        limit = _unit_rate_limit(boq.unit)
        unit_rate = line.total / boq.quantity
        base_total = round(boq.quantity * quota.base_price * binding_coefficient_for_units(boq.unit, quota.unit), 2)
        if limit is None or unit_rate <= limit or base_total <= 0:
            continue

        line.labor_cost = 0.0
        line.material_cost = base_total
        line.machine_cost = 0.0
        line.direct_cost = base_total
        line.management_fee = 0.0
        line.profit = 0.0
        line.regulatory_fee = 0.0
        line.pre_tax_total = base_total
        line.tax = 0.0
        line.total = base_total
        output["total"] = base_total
        output["rate_guard"] = "base_price_fallback"

        row = db.query(CalcResult).filter(CalcResult.boq_item_id == boq_id).first()
        if row:
            row.total_cost = base_total
        else:
            db.add(CalcResult(boq_item_id=boq_id, total_cost=base_total))
        changed = True

    if not changed:
        return

    calc_summary.total_direct = round(sum(line.direct_cost for line in calc_summary.line_results), 2)
    calc_summary.total_management = round(sum(line.management_fee for line in calc_summary.line_results), 2)
    calc_summary.total_profit = round(sum(line.profit for line in calc_summary.line_results), 2)
    calc_summary.total_regulatory = round(sum(line.regulatory_fee for line in calc_summary.line_results), 2)
    calc_summary.total_pre_tax = round(sum(line.pre_tax_total for line in calc_summary.line_results), 2)
    calc_summary.total_tax = round(sum(line.tax for line in calc_summary.line_results), 2)
    calc_summary.grand_total = round(sum(line.total for line in calc_summary.line_results) + calc_summary.total_measures, 2)
    db.commit()


def _match_explanation(
    *,
    boq: BoqItem,
    quota: QuotaItem | None,
    confidence: float,
    source_component_id: str,
) -> tuple[str, list[str]]:
    boq_discipline = _infer_boq_discipline(boq.code or "", boq.name or "", boq.characteristics or "", boq.division or "")
    reasons = [
        f"来源构件: {source_component_id or '-'}",
        f"清单专业: {boq_discipline}",
        f"匹配置信度: {round(confidence * 100)}%",
    ]
    if not quota:
        reasons.append("未找到专业、单位、名称同时接近的定额")
        return "；".join(reasons), reasons

    quota_discipline = _normalize_quota_discipline(quota)
    reasons.extend([
        f"定额: {quota.quota_code} {quota.name}",
        f"定额专业: {quota_discipline}",
        f"单位: 清单{boq.unit or '-'} / 定额{quota.unit or '-'}",
    ])
    if boq_discipline != quota_discipline:
        reasons.append("提示: 清单和定额专业不一致，需人工复核")
    if not _units_compatible(boq.unit or "", quota.unit or ""):
        reasons.append("提示: 单位不完全一致，已按换算系数处理")
    return "；".join(reasons), reasons


def _review_item(
    *,
    severity: str,
    category: str,
    message: str,
    suggestion: str,
    boq_item_id: int | None = None,
    code: str = "",
    name: str = "",
) -> dict[str, Any]:
    return {
        "severity": severity,
        "category": category,
        "message": message,
        "suggestion": suggestion,
        "boq_item_id": boq_item_id,
        "code": code,
        "name": name,
    }


def _build_valuation_review(
    *,
    source_type: str,
    grand_total: float,
    item_outputs: list[dict[str, Any]],
    boq_by_id: dict[int, BoqItem],
    quota_by_boq_id: dict[int, QuotaItem],
) -> list[dict[str, Any]]:
    review: list[dict[str, Any]] = []

    if grand_total >= REVIEW_TOTAL_CRITICAL:
        review.append(_review_item(
            severity="error",
            category="total_outlier",
            message=f"自动计价总价达到 {grand_total:,.2f} 元，明显偏高。",
            suggestion="请先核查图纸/IFC工程量单位、定额单价和是否重复识别；不要直接作为最终价。",
        ))
    elif grand_total >= REVIEW_TOTAL_WARNING:
        review.append(_review_item(
            severity="warning",
            category="total_outlier",
            message=f"自动计价总价为 {grand_total:,.2f} 元，建议复核。",
            suggestion="请重点检查大额清单、单位换算和跨专业匹配。",
        ))

    unmatched = [item for item in item_outputs if item.get("status") != "matched"]
    if unmatched:
        review.append(_review_item(
            severity="warning",
            category="unmatched",
            message=f"{len(unmatched)} 条清单未匹配到定额。",
            suggestion="请在项目明细中手工补套定额，避免漏项。",
        ))

    for output in item_outputs:
        boq_id = int(output.get("boq_item_id") or 0)
        boq = boq_by_id.get(boq_id)
        quota = quota_by_boq_id.get(boq_id)
        if not boq:
            continue
        total = _number(output.get("total"))
        confidence = _number(output.get("match_confidence"))

        if 0 < confidence < 0.55 and output.get("status") == "matched":
            review.append(_review_item(
                severity="warning",
                category="low_confidence",
                message=f"{boq.name} 匹配置信度偏低（{round(confidence * 100)}%）。",
                suggestion="建议人工确认定额名称、章节和单位是否正确。",
                boq_item_id=boq.id,
                code=boq.code or "",
                name=boq.name or "",
            ))

        if total >= REVIEW_ITEM_TOTAL_CRITICAL:
            review.append(_review_item(
                severity="error",
                category="item_outlier",
                message=f"{boq.name} 单项金额达到 {total:,.2f} 元。",
                suggestion="请核查该项工程量是否重复、单位是否为 m/m2/m3 混用、定额是否套错。",
                boq_item_id=boq.id,
                code=boq.code or "",
                name=boq.name or "",
            ))
        elif total >= REVIEW_ITEM_TOTAL_WARNING:
            review.append(_review_item(
                severity="warning",
                category="item_outlier",
                message=f"{boq.name} 单项金额为 {total:,.2f} 元。",
                suggestion="请优先复核该项工程量和定额单价。",
                boq_item_id=boq.id,
                code=boq.code or "",
                name=boq.name or "",
            ))

        if quota:
            boq_discipline = _infer_boq_discipline(boq.code or "", boq.name or "", boq.characteristics or "", boq.division or "")
            quota_discipline = _normalize_quota_discipline(quota)
            if boq_discipline != quota_discipline:
                review.append(_review_item(
                    severity="error" if source_type == "drawing" and boq_discipline == "土建" else "warning",
                    category="discipline_mismatch",
                    message=f"{boq.name} 的清单专业为{boq_discipline}，但匹配到{quota_discipline}定额。",
                    suggestion="请改套同专业定额；土建图纸不应批量套安装定额。",
                    boq_item_id=boq.id,
                    code=boq.code or "",
                    name=boq.name or "",
                ))

            if boq.quantity > 0 and total > 0:
                limit = _unit_rate_limit(boq.unit)
                unit_rate = total / boq.quantity
                if limit is not None and unit_rate > limit:
                    review.append(_review_item(
                        severity="error",
                        category="unit_rate_outlier",
                        message=f"{boq.name} 综合单价约 {unit_rate:,.2f} 元/{boq.unit}，超过经验上限。",
                        suggestion="请检查单位换算、定额基价和工程量识别是否异常。",
                        boq_item_id=boq.id,
                        code=boq.code or "",
                        name=boq.name or "",
                    ))

    return review[:80]


def create_valuation_from_drawing(
    *,
    db: Session,
    boq_suggestions: list[dict[str, Any]],
    task_id: str,
    source_type: str = "drawing",
    progress_callback: ProgressCallback | None = None,
) -> dict[str, Any]:
    """Persist drawing suggestions as a local project, bind quotas, and calculate."""

    valid_suggestions = [
        item for item in boq_suggestions
        if _number(item.get("suggested_quantity")) > 0
    ]
    if source_type == "drawing":
        valid_suggestions = _filter_suggestions_by_drawing_major(valid_suggestions)
    if not valid_suggestions:
        return {
            "project_id": None,
            "project_name": "",
            "boq_items_created": 0,
            "matched": 0,
            "skipped": 0,
            "grand_total": 0.0,
            "total_direct": 0.0,
            "items": [],
            "calc_summary": None,
            "review_items": [_review_item(
                severity="warning",
                category="no_quantity",
                message="未生成有效工程量，无法自动计价。",
                suggestion="请检查图纸比例、图层分类或IFC构件属性后重新上传。",
            )],
            "review_summary": {"errors": 0, "warnings": 1, "total": 1},
            "error": "未生成有效工程量，无法自动计价。",
        }

    try:
        _emit(progress_callback, "正在创建计价项目...")
        project = Project(
            name=_project_name(source_type),
            description="由IFC模型自动套定额生成。" if source_type == "ifc" else "由上传图纸自动解析生成。",
            region="默认区域",
            project_type="住宅",
            status="draft",
            standard_type="GB50500",
            language="zh",
            currency="CNY",
        )
        db.add(project)
        db.flush()

        # Merge suggestions with the same code to avoid UNIQUE constraint violations
        merged: dict[str, dict[str, Any]] = {}
        for suggestion in valid_suggestions:
            code = _text(suggestion.get("suggested_code"), "")
            if not code:
                code = f"TZ{len(merged) + 1:03d}"
            if code in merged:
                merged[code]["suggested_quantity"] = _number(merged[code]["suggested_quantity"]) + _number(suggestion.get("suggested_quantity"))
                merged[code]["component_count"] += int(suggestion.get("component_count") or 0)
                existing_sources = merged[code]["_sources"]
                new_source = _text(suggestion.get("source_component_id"), "-")
                if new_source not in existing_sources:
                    existing_sources.append(new_source)
            else:
                merged[code] = {
                    **suggestion,
                    "suggested_code": code,
                    "suggested_quantity": _number(suggestion.get("suggested_quantity")),
                    "component_count": int(suggestion.get("component_count") or 0),
                    "_sources": [_text(suggestion.get("source_component_id"), "-")],
                }
        merged_suggestions = list(merged.values())

        rows: list[BoqItem] = []
        item_outputs: list[dict[str, Any]] = []
        for index, suggestion in enumerate(merged_suggestions, start=1):
            if index == 1 or index % 40 == 0 or index == len(merged_suggestions):
                _emit(progress_callback, f"正在写入清单项 {index}/{len(merged_suggestions)}...")
            code = _text(suggestion.get("suggested_code"), f"TZ{index:03d}")
            name = _text(suggestion.get("suggested_name"), "图纸识别清单项")
            unit = _text(suggestion.get("suggested_unit"), "项")
            quantity = _number(suggestion.get("suggested_quantity"))
            characteristics = _text(suggestion.get("characteristics"))
            sources = suggestion.get("_sources", [])
            item = BoqItem(
                project_id=project.id,
                code=code,
                name=name,
                unit=unit,
                quantity=quantity,
                characteristics=characteristics[:500],
                division=division_for_boq(code, name),
                sort_order=index * 10,
                is_dirty=1,
                remark=f"来源构件: {', '.join(sources)}",
            )
            db.add(item)
            db.flush()
            rows.append(item)
            item_outputs.append({
                "boq_item_id": item.id,
                "code": item.code,
                "name": item.name,
                "unit": item.unit,
                "quantity": item.quantity,
                "quota_item_id": None,
                "quota_code": "",
                "quota_name": "",
                "match_confidence": 0.0,
                "match_reason": "",
                "match_reasons": [],
                "status": "skipped",
                "total": 0.0,
            })

        # Release the write transaction before quota matching, which can be CPU-heavy
        # for large IFC/drawing results. This keeps read-only pages responsive.
        db.commit()

        _emit(progress_callback, "正在读取定额库...")
        quotas = db.query(QuotaItem).all()
        boq_by_id = {item.id: item for item in rows}
        quota_by_boq_id: dict[int, QuotaItem] = {}
        matched = 0
        skipped = 0
        total_rows = len(rows)
        for index, (item, output) in enumerate(zip(rows, item_outputs), start=1):
            if index == 1 or index % 20 == 0 or index == total_rows:
                _emit(progress_callback, f"正在匹配定额 {index}/{total_rows}...")
            quota, confidence = match_quota_for_boq(item, quotas)
            if quota and confidence >= 0.3:
                match_reason, match_reasons = _match_explanation(
                    boq=item,
                    quota=quota,
                    confidence=confidence,
                    source_component_id=_text(item.remark).replace("来源构件:", "").strip(),
                )
                db.add(LineItemQuotaBinding(
                    boq_item_id=item.id,
                    quota_item_id=quota.id,
                    coefficient=binding_coefficient_for_units(item.unit, quota.unit),
                ))
                output.update({
                    "quota_item_id": quota.id,
                    "quota_code": quota.quota_code,
                    "quota_name": quota.name,
                    "match_confidence": confidence,
                    "match_reason": match_reason,
                    "match_reasons": match_reasons,
                    "status": "matched",
                })
                quota_by_boq_id[item.id] = quota
                matched += 1
            else:
                match_reason, match_reasons = _match_explanation(
                    boq=item,
                    quota=None,
                    confidence=confidence,
                    source_component_id=_text(item.remark).replace("来源构件:", "").strip(),
                )
                output["match_confidence"] = confidence
                output["match_reason"] = match_reason
                output["match_reasons"] = match_reasons
                skipped += 1

        db.commit()

        calc_summary: ProjectCalcSummary | None = None
        calc_error = ""
        if matched:
            try:
                _emit(progress_callback, "正在计算项目造价...")
                summary, line_results = run_project_calculation(project_id=project.id, db=db)
                calc_summary = _summary_out(summary, line_results)
                totals_by_boq = {line.boq_item_id: line.total for line in calc_summary.line_results}
                for output in item_outputs:
                    output["total"] = totals_by_boq.get(output["boq_item_id"], 0.0)
                _apply_base_price_fallback(
                    db=db,
                    calc_summary=calc_summary,
                    item_outputs=item_outputs,
                    boq_by_id=boq_by_id,
                    quota_by_boq_id=quota_by_boq_id,
                )
                _clamp_auto_valuation_outliers(
                    db=db,
                    calc_summary=calc_summary,
                    item_outputs=item_outputs,
                    boq_by_id=boq_by_id,
                    quota_by_boq_id=quota_by_boq_id,
                )
            except Exception as exc:  # keep the parsed quantities usable
                db.rollback()
                calc_error = f"计价计算失败: {exc}"
        else:
            _emit(progress_callback, "未匹配到可计算定额，正在整理结果...")

        try:
            write_audit_log(
                db=db,
                project_id=project.id,
                action="drawing_auto_valuation",
                resource_type="project",
                resource_id=project.id,
                after_json=json.dumps(
                    {
                        "task_id": task_id,
                        "boq_items_created": len(rows),
                        "matched": matched,
                        "skipped": skipped,
                    },
                    ensure_ascii=False,
                ),
            )
        except Exception:
            pass

        _emit(progress_callback, "自动计价完成")
        grand_total = calc_summary.grand_total if calc_summary else 0.0
        total_direct = calc_summary.total_direct if calc_summary else 0.0
        review_items = _build_valuation_review(
            source_type=source_type,
            grand_total=grand_total,
            item_outputs=item_outputs,
            boq_by_id=boq_by_id,
            quota_by_boq_id=quota_by_boq_id,
        )
        review_summary = {
            "errors": sum(1 for item in review_items if item.get("severity") == "error"),
            "warnings": sum(1 for item in review_items if item.get("severity") == "warning"),
            "total": len(review_items),
        }
        review_error = (
            "自动计价存在高风险复核项，暂不能直接作为最终造价。"
            if review_summary["errors"] > 0 else None
        )
        return {
            "project_id": project.id,
            "project_name": project.name,
            "boq_items_created": len(rows),
            "matched": matched,
            "skipped": skipped,
            "grand_total": grand_total,
            "total_direct": total_direct,
            "items": item_outputs,
            "calc_summary": _dump_model(calc_summary) if calc_summary else None,
            "review_items": review_items,
            "review_summary": review_summary,
            "error": calc_error or review_error,
        }
    except Exception:
        db.rollback()
        raise
