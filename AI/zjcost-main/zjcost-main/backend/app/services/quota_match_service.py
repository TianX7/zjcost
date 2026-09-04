"""辅助 quota matching service.

Enhanced strategy:
  1. Recall: keyword phrase extraction + synonym expansion + unit filter
  2. Re-rank: weighted score (phrase match + char similarity + unit + keyword overlap)
  3. 辅助 rerank: optional LLM reranking for top candidates
  4. Output: TopN candidates with confidence + reason codes
"""

from __future__ import annotations

import logging
import re
import time
from dataclasses import dataclass, field
from difflib import SequenceMatcher

from sqlalchemy.orm import Session
from app.assistant.agents.legacy_utils import rerank_quota_candidates_with_agent

from app.models.boq_item import BoqItem
from app.models.quota_item import QuotaItem

logger = logging.getLogger(__name__)

# ── 匹配用缓存 ────────────────────────────────────────────────
# 缓存纯数据对象（不绑定 Session），避免 ORM 实例跨请求复用触发
# DetachedInstanceError（首次可用、后续 500 的根因）。
@dataclass(frozen=True)
class _CachedQuota:
    id: int
    quota_code: str
    name: str
    unit: str
    chapter: str
    discipline: str


_quota_cache: dict[str, list[_CachedQuota]] = {}
_quota_cache_ts: float = 0.0
_quota_cache_ttl: float = 300.0  # 缓存有效期 5 分钟
_quota_cache_lock = __import__("threading").Lock()


def _load_quotas_cached(db: Session) -> list[_CachedQuota]:
    """加载全部定额列（纯数据）并缓存，配合 TTL 控制有效期。"""
    global _quota_cache_ts
    now = time.time()
    with _quota_cache_lock:
        if _quota_cache and (now - _quota_cache_ts) < _quota_cache_ttl:
            return _quota_cache.get("all", [])
        # 重新加载：只需匹配用到的字段，且不持有 ORM 实例
        rows = db.query(
            QuotaItem.id,
            QuotaItem.quota_code,
            QuotaItem.name,
            QuotaItem.unit,
            QuotaItem.chapter,
            QuotaItem.discipline,
        ).all()
        _quota_cache.clear()
        _quota_cache["all"] = [_CachedQuota(*row) for row in rows]
        _quota_cache_ts = now
        return _quota_cache["all"]


def _prefilter_quotas(
    quotas: list[_CachedQuota],
    *,
    discipline: str | None = None,
    unit: str | None = None,
) -> list[_CachedQuota]:
    """按 discipline / unit 预过滤候选集，缩小相似度计算范围。"""
    candidates = quotas
    if discipline:
        filtered = [
            q for q in candidates
            if q.discipline and discipline in q.discipline
        ]
        if filtered:
            candidates = filtered
    if unit:
        filtered = [
            q for q in candidates
            if _units_compatible(unit, q.unit)
        ]
        if filtered:
            candidates = filtered
    return candidates


@dataclass
class MatchCandidate:
    quota_item_id: int
    quota_code: str
    quota_name: str
    unit: str
    confidence: float  # 0.0 ~ 1.0
    reasons: list[str] = field(default_factory=list)


# ── Synonym / keyword expansion tables ──────────────────────────────
_SYNONYMS: dict[str, set[str]] = {
    "混凝土": {"砼", "混凝土", "现浇"},
    "砼": {"混凝土", "砼", "现浇"},
    "钢筋": {"钢筋", "配筋", "HRB"},
    "抹灰": {"抹灰", "粉刷", "抹面"},
    "粉刷": {"抹灰", "粉刷"},
    "涂料": {"涂料", "乳胶漆", "刷漆", "涂刷"},
    "乳胶漆": {"涂料", "乳胶漆", "涂刷"},
    "防水": {"防水", "防潮", "止水"},
    "防潮": {"防水", "防潮"},
    "管道": {"管道", "管线", "配管", "给水", "排水", "消防管", "空调水管"},
    "配管": {"管道", "配管", "管线", "电线管", "线管", "JDG", "KBG", "SC", "PC"},
    "给水": {"给水", "上水", "供水", "生活给水", "PPR", "PE", "管道"},
    "排水": {"排水", "下水", "污水", "废水", "雨水", "PVC", "UPVC", "HDPE", "管道"},
    "模板": {"模板", "支模"},
    "脚手架": {"脚手架", "架子"},
    "回填": {"回填", "填方", "填土"},
    "开挖": {"开挖", "挖方", "挖土", "土方开挖"},
    "土方": {"土方", "土石方", "挖土", "填土"},
    "砌体": {"砌体", "砌筑", "砌墙", "砖墙"},
    "砌筑": {"砌体", "砌筑"},
    "吊顶": {"吊顶", "天棚", "天花"},
    "天棚": {"天棚", "吊顶", "天花"},
    "门窗": {"门窗", "门", "窗"},
    "塑钢窗": {"塑钢窗", "窗", "门窗"},
    "铝合金窗": {"铝合金窗", "窗", "门窗"},
    "消防": {"消防", "灭火", "喷淋", "消火栓", "消防管", "消防报警", "烟感", "温感", "喷头", "灭火器"},
    "喷淋": {"喷淋", "消防", "喷头", "湿式报警", "水流指示器"},
    "消火栓": {"消火栓", "消防箱", "消防管", "消防"},
    "报警": {"报警", "消防报警", "烟感", "温感", "模块", "广播", "消防电话"},
    "照明": {"照明", "灯具", "灯"},
    "灯具": {"照明", "灯具", "灯"},
    "配电箱": {"配电箱", "配电柜", "电箱", "动力箱", "照明箱", "控制箱"},
    "电气配管": {"电气配管", "配管", "电线管", "线管", "JDG", "KBG", "SC", "PC"},
    "电缆": {"电缆", "电线", "线缆", "YJV", "BV", "BVR", "WDZ", "WDZN", "NH"},
    "桥架": {"桥架", "电缆桥架", "线槽", "母线槽"},
    "开关插座": {"开关插座", "开关", "插座", "面板"},
    "阀门": {"阀门", "闸阀", "截止阀", "蝶阀", "球阀", "止回阀", "减压阀"},
    "卫生洁具": {"卫生洁具", "洁具", "坐便器", "蹲便器", "洗脸盆", "小便器", "地漏"},
    "风管": {"风管", "通风管道", "防排烟", "送风", "回风", "排风", "新风", "镀锌钢板"},
    "暖通": {"暖通", "通风", "空调", "风机盘管", "空调机组", "风机", "散热器"},
    "空调": {"空调", "空调水", "冷冻水", "冷凝水", "风机盘管", "空调机组"},
    "地砖": {"地砖", "地面砖", "瓷砖"},
    "找平": {"找平", "找平层", "地面找平"},
    "基础": {"基础", "地基", "底板"},
    "柱": {"柱", "框架柱", "矩形柱", "异形柱", "立柱"},
    "框架柱": {"柱", "框架柱", "矩形柱", "现浇柱"},
    "矩形柱": {"柱", "框架柱", "矩形柱", "现浇柱"},
    "梁": {"梁", "框架梁", "矩形梁", "过梁"},
    "框架梁": {"梁", "框架梁", "矩形梁", "现浇梁"},
    "矩形梁": {"梁", "框架梁", "矩形梁", "现浇梁"},
    "楼板": {"楼板", "板", "有梁板", "无梁板", "现浇板"},
    "有梁板": {"楼板", "板", "有梁板", "现浇板"},
    "楼梯": {"楼梯", "梯段"},
    "墙": {"墙", "墙体", "砌体", "填充墙"},
    # ── 扩展同义词（工业级覆盖） ──
    "圈梁": {"圈梁", "腰梁", "过梁", "QL", "GL"},
    "构造柱": {"构造柱", "芯柱", "抗震柱", "GZ"},
    "剪力墙": {"剪力墙", "砼墙", "混凝土墙", "承重墙"},
    "阳台": {"阳台", "露台", "YT", "LT"},
    "雨篷": {"雨篷", "雨棚", "遮阳板", "YP"},
    "保温": {"保温", "隔热", "EPS", "XPS", "岩棉", "挤塑板", "聚苯板", "保温层"},
    "隔热": {"保温", "隔热", "保温层"},
    "防水层": {"防水层", "SBS", "APP", "卷材", "涂膜", "JS", "聚氨酯防水"},
    "卷材": {"卷材", "SBS", "APP", "防水卷材"},
    "涂膜": {"涂膜", "JS", "聚氨酯防水", "防水涂膜"},
    "真石漆": {"真石漆", "氟碳漆", "外墙涂料", "喷涂"},
    "石膏板": {"石膏板", "纸面石膏板", "吊顶石膏板"},
    "铝扣板": {"铝扣板", "铝合金扣板", "铝板吊顶"},
    "矿棉板": {"矿棉板", "矿棉吸音板", "矿棉吊顶"},
    "楼地面": {"楼地面", "地面", "地坪", "面层"},
    "找平层": {"找平层", "找平", "砂浆找平"},
    "垫层": {"垫层", "碎石垫层", "混凝土垫层", "灰土垫层"},
    "防雷": {"防雷", "避雷", "接闪", "均压环", "引下线", "接地极"},
    "接地": {"接地", "接地极", "接地母线", "防雷接地"},
    "弱电": {"弱电", "综合布线", "网络", "电话", "电视", "监控", "对讲", "广播", "门禁", "安防"},
    "喷淋头": {"喷淋头", "喷头", "下喷", "上喷", "侧喷"},
    "消火栓": {"消火栓", "消防栓", "室内消火栓", "室外消火栓", "XFH", "XHS"},
    "风阀": {"风阀", "调节阀", "防火阀", "蝶阀"},
    "风口": {"风口", "散流器", "百叶", "送风口", "回风口"},
    "支架": {"支架", "吊架", "托架", "管卡", "支吊架"},
    "土方": {"土方", "土石方", "挖土", "填土", "开挖", "回填"},
    "脚手架": {"脚手架", "满堂架", "外架", "内架", "吊篮", "架子"},
    "模板": {"模板", "木模", "钢模", "胶合板模板", "支模", "支撑体系"},
    "钢筋笼": {"钢筋笼", "桩钢筋笼", "桩钢筋"},
    "预应力": {"预应力", "预应力钢筋", "钢绞线", "锚具"},
    "砌体钢筋": {"砌体钢筋", "砌体内钢筋", "拉结筋"},
}

# Unit aliases
_UNIT_ALIASES: dict[str, set[str]] = {
    "m³": {"m³", "m3", "立方米", "立方"},
    "m3": {"m³", "m3", "立方米"},
    "m²": {"m²", "m2", "平方米", "平米", "平方"},
    "m2": {"m²", "m2", "平方米"},
    "m": {"m", "米", "延米"},
    "t": {"t", "吨", "T"},
    "台": {"台", "臺"},
    "套": {"套", "组", "个"},
    "个": {"个", "只", "套", "台", "点", "处"},
    "点": {"点", "个", "处"},
    "组": {"组", "套"},
    "樘": {"樘"},
}
_UNIT_ALIASES.update({
    "m鲁": _UNIT_ALIASES.get("m鲁", set()) | {"m3", "m³", "m^3", "立方米", "立方"},
    "m3": _UNIT_ALIASES.get("m3", set()) | {"m鲁", "m³", "m^3", "立方米", "立方"},
    "m³": {"m鲁", "m3", "m³", "m^3", "立方米", "立方"},
    "m虏": _UNIT_ALIASES.get("m虏", set()) | {"m2", "m²", "m^2", "㎡", "平方米", "平米", "平方", "10m2", "10m²", "10㎡"},
    "m2": _UNIT_ALIASES.get("m2", set()) | {"m虏", "m²", "m^2", "㎡", "平方米", "平米", "平方", "10m2", "10m²", "10㎡"},
    "m²": {"m虏", "m2", "m²", "m^2", "㎡", "平方米", "平米", "平方", "10m2", "10m²", "10㎡"},
    "m": _UNIT_ALIASES.get("m", set()) | {"10m", "米", "延米"},
    "10m": {"m", "10m", "米", "延米"},
    "10m2": {"m虏", "m2", "m²", "10m2", "10m²", "10㎡", "㎡", "平方米"},
    "10m²": {"m虏", "m2", "m²", "10m2", "10m²", "10㎡", "㎡", "平方米"},
})

_STRUCTURE_TERMS = {
    "柱": ("柱", "框架柱", "矩形柱", "异形柱", "构造柱", "圆柱", "芯柱"),
    "梁": ("梁", "框架梁", "矩形梁", "异形梁", "过梁", "圈梁", "连梁", "基础梁"),
    "板": ("板", "楼板", "有梁板", "无梁板", "平板", "斜板", "阳台板", "雨篷板"),
    "墙": ("墙", "剪力墙", "挡土墙", "墙体", "填充墙", "承重墙", "电梯井壁"),
    "基础": ("基础", "承台", "筏板", "垫层", "独立基础", "条形基础", "杯形基础"),
    "楼梯": ("楼梯", "梯段", "踏步"),
    "桩": ("桩", "灌注桩", "预制桩", "桩钢筋笼"),
    "门窗": ("门", "窗", "木门", "钢门", "铝合金窗", "塑钢窗", "防火门"),
    "防水": ("防水", "卷材", "涂膜", "SBS", "聚氨酯", "防水层"),
    "保温": ("保温", "隔热", "EPS", "XPS", "岩棉", "挤塑板"),
    "装饰": ("涂料", "抹灰", "吊顶", "楼地面", "地砖", "石材", "乳胶漆"),
    "机电": ("管道", "电缆", "桥架", "配管", "风管", "灯具", "阀门", "洁具"),
    "消防": ("消防", "喷淋", "消火栓", "报警", "烟感", "温感"),
    "措施": ("模板", "脚手架", "支架", "土方", "开挖", "回填"),
}


def clear_quota_match_cache() -> None:
    """Clear cached quota rows after restoring/importing quota data."""
    global _quota_cache_ts
    with _quota_cache_lock:
        _quota_cache.clear()
        _quota_cache_ts = 0.0


def _normalize_unit(unit: str | None) -> str:
    text = (unit or "").strip().lower()
    text = text.replace(" ", "").replace("　", "").replace("Â", "")
    text = text.replace("³", "3").replace("²", "2").replace("鲁", "3").replace("虏", "2")
    text = text.replace("㎥", "m3").replace("m^3", "m3").replace("m³", "m3")
    text = text.replace("㎡", "m2").replace("m^2", "m2").replace("m²", "m2")
    if text in {"立方米", "立方", "方"}:
        return "m3"
    if text in {"平方米", "平米", "平方"}:
        return "m2"
    if text in {"米", "延米"}:
        return "m"
    if text in {"吨", "t"}:
        return "t"
    if re.fullmatch(r"10m2|10㎡", text):
        return "m2"
    if re.fullmatch(r"10m3", text):
        return "m3"
    if re.fullmatch(r"10m", text):
        return "m"
    return text


def _infer_discipline(text: str) -> str | None:
    if any(k in text for k in ("电气", "配电", "电缆", "电线", "桥架", "照明", "开关", "插座", "防雷", "接地")):
        return "电气"
    if any(k in text for k in ("给水", "排水", "管道", "阀门", "洁具", "地漏", "水泵")):
        return "给排水"
    if any(k in text for k in ("消防", "喷淋", "消火栓", "报警", "风管", "通风", "空调", "暖通")):
        return "暖通消防"
    if any(k in text for k in ("仿古", "青砖", "青瓦", "斗拱", "古建")):
        return "仿古"
    if any(k in text for k in ("光伏", "组件", "逆变器", "汇流箱")):
        return "光伏"
    if any(k in text for k in ("灌溉", "渠道", "古渠", "闸门", "渠槽")):
        return "水利灌溉"
    if any(k in text for k in ("混凝土", "钢筋", "模板", "砌筑", "土方", "防水", "门窗", "抹灰", "楼地面")):
        return "土建"
    return None


def _extract_spec_markers(text: str) -> set[str]:
    markers: set[str] = set()
    for grade in re.findall(r"\bC\s*(\d{2})\b", text, flags=re.IGNORECASE):
        markers.add(f"C{grade}")
    for grade in re.findall(r"\b(HRB|HPB|CRB)\s*([0-9]{3,4})\b", text, flags=re.IGNORECASE):
        markers.add(f"{grade[0].upper()}{grade[1]}")
    return markers


def _structure_terms(text: str) -> set[str]:
    result: set[str] = set()
    for term, words in _STRUCTURE_TERMS.items():
        if any(word in text for word in words):
            result.add(term)
    return result


def _primary_structure_term(text: str) -> str | None:
    """Infer the dominant structural object to avoid beam/slab/column cross matches."""
    checks: list[tuple[str, tuple[str, ...], tuple[str, ...]]] = [
        ("普通钢筋", ("现浇构件钢筋", "现浇构件带肋钢筋", "钢筋制作", "钢筋安装"), ("钢筋笼", "桩")),
        ("桩", ("灌注桩", "预制桩", "钢筋笼"), ()),
        ("柱", ("框架柱", "矩形柱", "异形柱", "构造柱", "现浇柱"), ()),
        ("板", ("有梁板", "无梁板", "楼板", "平板", "现浇板", "筏板"), ()),
        ("梁", ("框架梁", "矩形梁", "过梁", "圈梁", "连梁", "现浇梁"), ("有梁板", "无梁板")),
        ("墙", ("剪力墙", "挡土墙", "墙体", "现浇墙", "直形墙"), ()),
        ("基础", ("独立基础", "条形基础", "满堂基础", "基础", "承台", "垫层"), ()),
    ]
    for term, include, exclude in checks:
        if any(word in text for word in include) and not any(word in text for word in exclude):
            return term
    return None


def _tokenize(text: str) -> set[str]:
    """Split on non-word chars, keep Chinese chars individually."""
    tokens: set[str] = set()
    for w in re.findall(r"[a-zA-Z0-9]+", text):
        tokens.add(w.lower())
    for ch in text:
        if "\u4e00" <= ch <= "\u9fff":
            tokens.add(ch)
    return tokens


def _extract_phrases(text: str) -> list[str]:
    """Extract Chinese word phrases (2-4 chars) for better matching."""
    phrases: list[str] = []
    # Extract known keyword phrases
    for kw in _SYNONYMS:
        if kw in text:
            phrases.append(kw)
    # Also extract all 2-char, 3-char, 4-char substrings of Chinese text
    cn = re.sub(r"[^\u4e00-\u9fff]", "", text)
    for length in (4, 3, 2):
        for i in range(len(cn) - length + 1):
            phrases.append(cn[i:i + length])
    return phrases


def _expand_keywords(text: str) -> set[str]:
    """Expand text keywords with synonyms."""
    expanded: set[str] = set()
    for kw, syns in _SYNONYMS.items():
        if kw in text:
            expanded.update(syns)
    expanded.update(_tokenize(text))
    return expanded


def _units_compatible(u1: str, u2: str) -> bool:
    """Check if two units are compatible (exact or alias match)."""
    n1 = _normalize_unit(u1)
    n2 = _normalize_unit(u2)
    if n1 == n2:
        return True
    aliases1 = {_normalize_unit(unit) for unit in _UNIT_ALIASES.get(u1.strip(), {u1.strip()})}
    aliases2 = {_normalize_unit(unit) for unit in _UNIT_ALIASES.get(u2.strip(), {u2.strip()})}
    return bool(aliases1 & aliases2)


def _name_similarity(a: str, b: str) -> float:
    """Enhanced similarity: phrase match + sequence match + keyword overlap."""
    # Sequence similarity
    seq_score = SequenceMatcher(None, a, b).ratio()

    # Character-level Jaccard
    tokens_a = _tokenize(a)
    tokens_b = _tokenize(b)
    if tokens_a and tokens_b:
        jaccard = len(tokens_a & tokens_b) / len(tokens_a | tokens_b)
    else:
        jaccard = 0.0

    # Phrase overlap bonus
    phrases_a = set(_extract_phrases(a))
    phrases_b = set(_extract_phrases(b))
    if phrases_a and phrases_b:
        phrase_overlap = len(phrases_a & phrases_b) / max(len(phrases_a), len(phrases_b))
    else:
        phrase_overlap = 0.0

    # Synonym-expanded keyword overlap
    kw_a = _expand_keywords(a)
    kw_b = _expand_keywords(b)
    if kw_a and kw_b:
        kw_overlap = len(kw_a & kw_b) / len(kw_a | kw_b)
    else:
        kw_overlap = 0.0

    return 0.35 * seq_score + 0.25 * jaccard + 0.25 * phrase_overlap + 0.15 * kw_overlap


def find_candidates(
    boq_item_id: int,
    db: Session,
    top_n: int = 5,
) -> list[MatchCandidate]:
    """Return top-N quota candidates for a given BOQ item."""

    boq = db.query(BoqItem).filter(BoqItem.id == boq_item_id).first()
    if not boq:
        return []

    # 使用缓存加载全部定额，避免每次全表扫描
    all_quotas = _load_quotas_cached(db)
    if not all_quotas:
        return []

    # 预过滤：按 discipline / unit 缩小候选集
    context_text = " ".join(
        str(value or "")
        for value in (boq.name, boq.characteristics, boq.division, boq.trade_section)
    )
    discipline = _infer_discipline(context_text)
    quotas = _prefilter_quotas(
        all_quotas,
        discipline=discipline,
        unit=boq.unit if boq.unit else None,
    )
    # 若预过滤后候选集为空，则回退到全量
    if not quotas:
        quotas = all_quotas

    scored: list[tuple[float, _CachedQuota, list[str]]] = []

    boq_markers = _extract_spec_markers(context_text)
    boq_structures = _structure_terms(context_text)
    boq_primary_structure = _primary_structure_term(context_text)

    for q in quotas:
        reasons: list[str] = []
        score = 0.0
        quota_text = " ".join(str(value or "") for value in (q.name, q.chapter, q.discipline))
        quota_markers = _extract_spec_markers(quota_text)
        quota_structures = _structure_terms(quota_text)
        quota_primary_structure = _primary_structure_term(quota_text)

        # --- Name similarity (weight 0.55) ---
        name_sim = _name_similarity(boq.name, q.name)
        score += name_sim * 0.55
        if name_sim > 0.5:
            reasons.append(f"名称相似度 {name_sim:.0%}")
        elif name_sim > 0.3:
            reasons.append(f"名称部分匹配 {name_sim:.0%}")

        # --- Unit match (weight 0.30) ---
        if _units_compatible(boq.unit, q.unit):
            score += 0.30
            reasons.append("单位一致")
        else:
            reasons.append("⚠ 单位不一致")

        if boq_markers and quota_markers:
            if boq_markers & quota_markers:
                score += 0.10
                reasons.append("规格等级一致")
            else:
                score -= 0.18
                reasons.append("⚠ 规格等级不一致")

        if boq_structures and quota_structures:
            if boq_structures & quota_structures:
                score += 0.08
                reasons.append("构件类型一致")
            else:
                score -= 0.10
                reasons.append("⚠ 构件类型不一致")

        if boq_primary_structure and quota_primary_structure:
            if boq_primary_structure == quota_primary_structure:
                score += 0.16
                reasons.append(f"主构件一致：{boq_primary_structure}")
            else:
                score -= 0.24
                reasons.append(f"⚠ 主构件不一致：{boq_primary_structure}/{quota_primary_structure}")

        if boq_primary_structure == "普通钢筋" and "钢筋笼" in quota_text:
            score -= 0.20
            reasons.append("⚠ 普通构件钢筋不套桩钢筋笼")

        # --- Code prefix overlap (weight 0.15) ---
        code_sim = SequenceMatcher(None, boq.code, q.quota_code).ratio()
        score += code_sim * 0.15
        if code_sim > 0.3:
            reasons.append(f"编码相似 {code_sim:.0%}")

        scored.append((score, q, reasons))

    # Sort descending by score
    scored.sort(key=lambda x: x[0], reverse=True)
    # Recall more candidates, then optionally rerank via 处理器.
    recall_n = min(len(scored), max(top_n * 3, 15))
    recalled: list[dict] = []
    for score, q, reasons in scored[:recall_n]:
        recalled.append(
            {
                "quota_item_id": q.id,
                "quota_code": q.quota_code,
                "quota_name": q.name,
                "unit": q.unit,
                "confidence": round(min(score, 1.0), 3),
                "reasons": reasons,
            }
        )

    reranked = rerank_quota_candidates_with_agent(
        boq_code=boq.code,
        boq_name=boq.name,
        boq_unit=boq.unit,
        candidates=recalled,
        top_n=top_n,
    )

    return [
        MatchCandidate(
            quota_item_id=int(c["quota_item_id"]),
            quota_code=str(c["quota_code"]),
            quota_name=str(c["quota_name"]),
            unit=str(c["unit"]),
            confidence=float(c["confidence"]),
            reasons=[str(r) for r in c.get("reasons", [])],
        )
        for c in reranked
    ]
