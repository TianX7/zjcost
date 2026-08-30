"""DXF drawing analysis and lightweight preview rendering."""

from __future__ import annotations

import html
import logging
import math
import os
import re
import tempfile
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Iterable

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class ComponentRule:
    key: str
    type_name: str
    code: str
    boq_name: str
    unit: str
    keywords: tuple[str, ...]
    metric: str
    default_spec: str
    default_width_m: float = 0.0
    default_height_m: float = 0.0
    confidence: float = 90.0


@dataclass(frozen=True)
class SpecCandidate:
    spec: str
    score: float


@dataclass(frozen=True)
class AnnotationProfile:
    specs_by_rule: dict[str, tuple[SpecCandidate, ...]]
    story_height_m: float | None = None

    def candidates_for(self, rule: ComponentRule) -> tuple[SpecCandidate, ...]:
        return self.specs_by_rule.get(rule.key, ())


DxfProgressCallback = Callable[[dict[str, Any]], None]


COMPONENT_RULES: tuple[ComponentRule, ...] = (
    ComponentRule(
        key="column",
        type_name="框架柱",
        code="010402001",
        boq_name="现浇混凝土柱",
        unit="m³",
        keywords=("COLU", "COLUMN", "砼柱", "混凝土柱", "柱填充", "柱", "KZ", "GZ", "HZ"),
        metric="area_volume",
        default_spec="600×600",
        default_height_m=3.0,
        confidence=92.0,
    ),
    ComponentRule(
        key="beam",
        type_name="框架梁",
        code="010403001",
        boq_name="现浇混凝土梁",
        unit="m³",
        keywords=("BEAM", "砼梁", "混凝土梁", "梁__实线", "框架梁", "连梁", "梁"),
        metric="length_volume",
        default_spec="300×600",
        default_width_m=0.3,
        default_height_m=0.6,
        confidence=92.0,
    ),
    ComponentRule(
        key="wall",
        type_name="剪力墙",
        code="010404001",
        boq_name="现浇混凝土墙",
        unit="m³",
        keywords=("WALL", "PUB_WALL", "剪力墙", "砼墙", "混凝土墙", "砖墙", "墙"),
        metric="length_volume",
        default_spec="T=250",
        default_width_m=0.25,
        default_height_m=3.0,
        confidence=90.0,
    ),
    ComponentRule(
        key="slab",
        type_name="楼板",
        code="010405001",
        boq_name="现浇混凝土板",
        unit="m³",
        keywords=("FLOOR", "SLAB", "楼板", "板洞", "板筋", "板"),
        metric="area_volume",
        default_spec="H=120",
        default_height_m=0.12,
        confidence=86.0,
    ),
    ComponentRule(
        key="foundation",
        type_name="基础",
        code="010401001",
        boq_name="现浇混凝土基础",
        unit="m³",
        keywords=("BASE", "FOUND", "独立基础", "基础", "DJ", "JC"),
        metric="area_volume",
        default_spec="1200×1200×400",
        default_height_m=0.4,
        confidence=90.0,
    ),
    ComponentRule(
        key="stair",
        type_name="楼梯",
        code="010406001",
        boq_name="现浇混凝土楼梯",
        unit="m²",
        keywords=("STAIR", "楼梯", "梯段", "踏步"),
        metric="area",
        default_spec="综合楼梯",
        confidence=82.0,
    ),
    ComponentRule(
        key="door",
        type_name="门",
        code="010802001",
        boq_name="门",
        unit="樘",
        keywords=("DOOR", "DOOR_FIRE", "防火门", "门", "FM", "M"),
        metric="count",
        default_spec="综合门",
        confidence=78.0,
    ),
    ComponentRule(
        key="window",
        type_name="窗",
        code="010807001",
        boq_name="窗",
        unit="樘",
        keywords=("WINDOW", "WINDW", "E_WINDOW", "窗", "C"),
        metric="count",
        default_spec="综合窗",
        confidence=78.0,
    ),
    ComponentRule(
        key="rebar",
        type_name="钢筋",
        code="010407001",
        boq_name="钢筋工程",
        unit="t",
        keywords=("REIN", "REBAR", "钢筋", "纵筋", "箍筋", "负筋", "正筋"),
        metric="rebar_weight",
        default_spec="综合钢筋",
        confidence=84.0,
    ),
    ComponentRule(
        key="fire_pipe",
        type_name="消防管道",
        code="030901001",
        boq_name="消防管道安装",
        unit="m",
        keywords=("FIRE_PIPE", "SPRINKLER_PIPE", "HYDRANT_PIPE", "消火栓管", "喷淋管", "消防管", "消防给水", "喷淋管道", "消火栓管道"),
        metric="length",
        default_spec="DN100",
        confidence=86.0,
    ),
    ComponentRule(
        key="fire_device",
        type_name="消防设备器具",
        code="030904001",
        boq_name="消防设备器具安装",
        unit="个",
        keywords=("FIRE_ALARM", "SMOKE", "SPRINKLER_HEAD", "ALARM", "烟感", "温感", "喷头", "报警", "模块", "消防箱", "灭火器"),
        metric="count",
        default_spec="综合消防设备",
        confidence=82.0,
    ),
    ComponentRule(
        key="plumbing_pipe",
        type_name="给排水管道",
        code="031001001",
        boq_name="给排水管道安装",
        unit="m",
        keywords=("PLUMB", "WATER", "DRAIN", "SEWER", "给水", "排水", "雨水", "污水", "废水", "冷水", "热水", "PPR", "HDPE", "UPVC", "PVC-U", "管道", "水管"),
        metric="length",
        default_spec="DN50",
        confidence=86.0,
    ),
    ComponentRule(
        key="valve",
        type_name="阀门",
        code="031003001",
        boq_name="阀门安装",
        unit="个",
        keywords=("VALVE", "阀门", "闸阀", "截止阀", "蝶阀", "球阀", "止回阀", "减压阀"),
        metric="count",
        default_spec="综合阀门",
        confidence=82.0,
    ),
    ComponentRule(
        key="sanitary_fixture",
        type_name="卫生洁具",
        code="031004001",
        boq_name="卫生洁具安装",
        unit="套",
        keywords=("SANITARY", "FIXTURE", "TOILET", "BASIN", "洁具", "卫生器具", "坐便器", "蹲便器", "洗脸盆", "小便器", "地漏"),
        metric="count",
        default_spec="综合卫生洁具",
        confidence=80.0,
    ),
    ComponentRule(
        key="electrical_conduit",
        type_name="电气配管",
        code="030411001",
        boq_name="电气配管",
        unit="m",
        keywords=("ELEC_CONDUIT", "CONDUIT", "电气配管", "电线管", "线管", "配管", "JDG", "KBG", "SC", "PC"),
        metric="length",
        default_spec="SC20",
        confidence=86.0,
    ),
    ComponentRule(
        key="cable",
        type_name="电缆电线",
        code="030408001",
        boq_name="电缆电线敷设",
        unit="m",
        keywords=("CABLE", "WIRE", "电缆", "电线", "线缆", "YJV", "BV", "WDZ", "WDZN", "NH", "KVV"),
        metric="length",
        default_spec="综合线缆",
        confidence=84.0,
    ),
    ComponentRule(
        key="cable_tray",
        type_name="电缆桥架",
        code="030404001",
        boq_name="电缆桥架安装",
        unit="m",
        keywords=("CABLETRAY", "TRAY", "桥架", "线槽", "母线槽"),
        metric="length",
        default_spec="200×100",
        confidence=84.0,
    ),
    ComponentRule(
        key="electrical_device",
        type_name="电气设备器具",
        code="030412001",
        boq_name="电气设备器具安装",
        unit="个",
        keywords=("DB", "AL", "AP", "配电箱", "动力箱", "照明箱", "灯具", "开关", "插座", "照明灯", "应急灯", "应急照明", "吸顶灯", "筒灯", "射灯", "LIGHT", "LIGHTING", "LAMP", "SOCKET", "RECEPTACLE", "LUMIN"),
        metric="count",
        default_spec="综合电气设备器具",
        confidence=80.0,
    ),
    ComponentRule(
        key="hvac_duct",
        type_name="通风风管",
        code="030701001",
        boq_name="通风风管制作安装",
        unit="m²",
        keywords=("HVAC_DUCT", "DUCT", "风管", "送风", "回风", "排风", "新风", "防排烟", "通风"),
        metric="duct_area",
        default_spec="500×320",
        default_width_m=0.5,
        confidence=84.0,
    ),
    ComponentRule(
        key="hvac_equipment",
        type_name="暖通设备",
        code="030702001",
        boq_name="暖通设备安装",
        unit="台",
        keywords=("HVAC_EQUIP", "AHU", "FCU", "FAN", "空调机组", "风机盘管", "风机", "新风机", "排风机", "散热器", "空调设备"),
        metric="count",
        default_spec="综合暖通设备",
        confidence=80.0,
    ),
    # ── 扩展构件（工业级覆盖） ──
    ComponentRule(
        key="ring_beam",
        type_name="圈梁",
        code="010403002",
        boq_name="圈梁",
        unit="m³",
        keywords=("RING_BEAM", "圈梁", "QL", "腰梁", "过梁", "GL"),
        metric="length_volume",
        default_spec="240×240",
        default_width_m=0.24,
        default_height_m=0.24,
        confidence=85.0,
    ),
    ComponentRule(
        key="constructional_column",
        type_name="构造柱",
        code="010402002",
        boq_name="构造柱",
        unit="m³",
        keywords=("GZ_COLUMN", "构造柱", "GZ", "芯柱", "抗震柱"),
        metric="area_volume",
        default_spec="240×240",
        default_height_m=3.0,
        confidence=85.0,
    ),
    ComponentRule(
        key="balcony",
        type_name="阳台",
        code="010505008",
        boq_name="阳台板",
        unit="m³",
        keywords=("BALCONY", "阳台", "露台", "YT", "LT"),
        metric="area_volume",
        default_spec="H=120",
        default_height_m=0.12,
        confidence=83.0,
    ),
    ComponentRule(
        key="canopy",
        type_name="雨篷",
        code="010505009",
        boq_name="雨篷板",
        unit="m³",
        keywords=("CANOPY", "雨篷", "雨棚", "YP", "遮阳板"),
        metric="area_volume",
        default_spec="H=120",
        default_height_m=0.12,
        confidence=82.0,
    ),
    ComponentRule(
        key="waterproof",
        type_name="防水层",
        code="010903001",
        boq_name="墙面防水层",
        unit="m²",
        keywords=("WATERPROOF", "防水", "SBS", "APP", "卷材", "涂膜", "防水层", "JS", "聚氨酯防水"),
        metric="area",
        default_spec="综合防水层",
        confidence=84.0,
    ),
    ComponentRule(
        key="insulation",
        type_name="保温隔热层",
        code="011001001",
        boq_name="保温隔热层",
        unit="m²",
        keywords=("INSULATION", "保温", "隔热", "EPS", "XPS", "岩棉", "挤塑板", "聚苯板", "保温层"),
        metric="area",
        default_spec="综合保温层",
        confidence=83.0,
    ),
    ComponentRule(
        key="coating",
        type_name="涂料",
        code="011407001",
        boq_name="墙面涂料",
        unit="m²",
        keywords=("COATING", "PAINT", "涂料", "乳胶漆", "油漆", "喷漆", "刷漆", "真石漆", "氟碳漆"),
        metric="area",
        default_spec="综合涂料",
        confidence=80.0,
    ),
    ComponentRule(
        key="ceiling",
        type_name="吊顶",
        code="011304001",
        boq_name="吊顶",
        unit="m²",
        keywords=("CEILING", "SUSPENDED_CEILING", "吊顶", "天棚", "石膏板", "铝扣板", "矿棉板", "顶棚"),
        metric="area",
        default_spec="综合吊顶",
        confidence=82.0,
    ),
    ComponentRule(
        key="ground_paving",
        type_name="楼地面",
        code="011102001",
        boq_name="楼地面工程",
        unit="m²",
        keywords=("GROUND", "FLOORING", "PAVING", "楼地面", "地面", "地砖", "地板", "石材", "找平层", "垫层"),
        metric="area",
        default_spec="综合楼地面",
        confidence=82.0,
    ),
    ComponentRule(
        key="wall_finish",
        type_name="墙面抹灰",
        code="011201001",
        boq_name="墙面抹灰",
        unit="m²",
        keywords=("PLASTER", "RENDER", "抹灰", "粉刷", "批荡", "砂浆面", "水泥砂浆", "混合砂浆"),
        metric="area",
        default_spec="综合抹灰",
        confidence=80.0,
    ),
    ComponentRule(
        key="lightning_protection",
        type_name="防雷接地",
        code="030414001",
        boq_name="防雷及接地装置",
        unit="m",
        keywords=("LIGHTNING", "GROUNDING", "EARTH", "防雷", "接地", "避雷", "均压环", "接闪带", "引下线", "接地极"),
        metric="length",
        default_spec="综合防雷接地",
        confidence=84.0,
    ),
    ComponentRule(
        key="weak_current",
        type_name="弱电系统",
        code="030408002",
        boq_name="弱电线路",
        unit="m",
        keywords=("WEAK_CURRENT", "ELV", "弱电", "综合布线", "网络", "电话", "电视", "监控", "对讲", "广播", "门禁", "安防"),
        metric="length",
        default_spec="综合弱电",
        confidence=82.0,
    ),
    ComponentRule(
        key="sprinkler",
        type_name="喷淋头",
        code="030901003",
        boq_name="喷淋头安装",
        unit="个",
        keywords=("SPRINKLER_HEAD", "喷淋头", "喷头", "下喷", "上喷", "侧喷", "隐蔽式喷头"),
        metric="count",
        default_spec="综合喷淋头",
        confidence=85.0,
    ),
    ComponentRule(
        key="hydrant",
        type_name="消火栓",
        code="030901002",
        boq_name="消火栓安装",
        unit="套",
        keywords=("HYDRANT", "消火栓", "消防栓", "室内消火栓", "室外消火栓", "XFH", "XHS"),
        metric="count",
        default_spec="综合消火栓",
        confidence=86.0,
    ),
    ComponentRule(
        key="duct_fitting",
        type_name="风管部件",
        code="030703001",
        boq_name="风管部件制作安装",
        unit="个",
        keywords=("DUCT_FITTING", "DAMPER", "DIFFUSER", "REGISTER", "风阀", "风口", "散流器", "调节阀", "防火阀", "百叶"),
        metric="count",
        default_spec="综合风管部件",
        confidence=82.0,
    ),
    ComponentRule(
        key="pipe_support",
        type_name="管道支架",
        code="031002001",
        boq_name="管道支架制作安装",
        unit="kg",
        keywords=("PIPE_SUPPORT", "SUPPORT", "BRACKET", "支架", "吊架", "托架", "管卡", "支吊架"),
        metric="count",
        default_spec="综合支架",
        confidence=80.0,
    ),
    ComponentRule(
        key="earthwork",
        type_name="土方工程",
        code="010101002",
        boq_name="土方开挖",
        unit="m³",
        keywords=("EARTHWORK", "EXCAVATION", "土方", "开挖", "回填", "基坑", "沟槽", "挖土", "填土"),
        metric="area_volume",
        default_spec="综合土方",
        default_height_m=1.5,
        confidence=82.0,
    ),
    ComponentRule(
        key="scaffold",
        type_name="脚手架",
        code="011702001",
        boq_name="脚手架",
        unit="m²",
        keywords=("SCAFFOLD", "脚手架", "满堂架", "外架", "内架", "吊篮"),
        metric="area",
        default_spec="综合脚手架",
        confidence=80.0,
    ),
    ComponentRule(
        key="formwork",
        type_name="模板工程",
        code="011701001",
        boq_name="模板工程",
        unit="m²",
        keywords=("FORMWORK", "模板", "木模", "钢模", "胶合板模板", "支撑体系"),
        metric="area",
        default_spec="综合模板",
        confidence=80.0,
    ),
)

ANNOTATION_KEYWORDS = (
    "TEXT",
    "标注",
    "文字",
    "说明",
    "DIM",
    "尺寸",
    "引线",
    "编号",
    "名称",
    "集中",
    "原位",
    "AXIS",
    "轴线",
    "图框",
    "图名",
    "比例",
    "图号",
)

PREVIEW_COLORS = {
    "column": "#2563eb",
    "beam": "#059669",
    "wall": "#d97706",
    "slab": "#7c3aed",
    "foundation": "#db2777",
    "stair": "#0d9488",
    "door": "#f97316",
    "window": "#38bdf8",
    "rebar": "#dc2626",
    "fire_pipe": "#dc2626",
    "fire_device": "#f43f5e",
    "plumbing_pipe": "#0ea5e9",
    "valve": "#0284c7",
    "sanitary_fixture": "#14b8a6",
    "electrical_conduit": "#f59e0b",
    "cable": "#eab308",
    "cable_tray": "#d97706",
    "electrical_device": "#fb923c",
    "hvac_duct": "#6366f1",
    "hvac_equipment": "#8b5cf6",
    "ring_beam": "#16a34a",
    "constructional_column": "#2563eb",
    "balcony": "#a855f7",
    "canopy": "#c084fc",
    "waterproof": "#0891b2",
    "insulation": "#0d9488",
    "coating": "#eab308",
    "ceiling": "#a3a3a3",
    "ground_paving": "#78716c",
    "wall_finish": "#d6d3d1",
    "lightning_protection": "#facc15",
    "weak_current": "#fbbf24",
    "sprinkler": "#ef4444",
    "hydrant": "#dc2626",
    "duct_fitting": "#6366f1",
    "pipe_support": "#64748b",
    "earthwork": "#92400e",
    "scaffold": "#78350f",
    "formwork": "#854d0e",
    "other": "#64748b",
}

DRAWABLE_TYPES = {
    "LINE",
    "LWPOLYLINE",
    "POLYLINE",
    "CIRCLE",
    "ARC",
    "ELLIPSE",
    "SPLINE",
    "HATCH",
    "SOLID",
    "TRACE",
    "TEXT",
    "MTEXT",
}

PREVIEW_SCREEN_STROKE_WIDTH = 1.6
PREVIEW_HD_STROKE_WIDTH = 2.0
PREVIEW_TEXT_COLOR = "#dbeafe"
PREVIEW_PRIMARY_LINE = "#f1f7ff"
PREVIEW_SECONDARY_LINE = "#b6d7f0"
PREVIEW_MAX_RENDERED_ENTITIES = 5200
PREVIEW_HD_RENDERED_ENTITIES = 18000
PREVIEW_COLLECTION_LIMIT = 24000
PREVIEW_MAX_POINTS_PER_ENTITY = 140
PREVIEW_HD_MAX_POINTS_PER_ENTITY = 400
PREVIEW_MAX_TEXT_ENTITIES = 450
PREVIEW_HD_TEXT_ENTITIES = 3500
PREVIEW_PATH_CHUNK_LENGTH = 120000
PREVIEW_MAX_HIGHLIGHT_BOXES = 1600
PREVIEW_HIGHLIGHT_RULES = frozenset(rule.key for rule in COMPONENT_RULES)

CANDIDATE_UNIT_SCALES: tuple[tuple[float, str], ...] = (
    (0.001, "毫米"),
    (0.01, "厘米"),
    (0.0254, "英寸"),
    (0.3048, "英尺"),
    (1.0, "米"),
)


def _read_text(entity: Any) -> str:
    try:
        if entity.dxftype() == "MTEXT":
            return str(entity.text).strip()
        return str(entity.dxf.text).strip()
    except Exception:
        return ""


def _layer(entity: Any) -> str:
    try:
        return str(entity.dxf.layer)
    except Exception:
        return ""


def _name(entity: Any) -> str:
    try:
        return str(entity.dxf.name)
    except Exception:
        return ""


def _normalized_tokens(value: str) -> list[str]:
    raw = value.upper()
    return [token for token in re.split(r"[^0-9A-Z\u4e00-\u9fff]+", raw) if token]


def _matches_rule(value: str, rule: ComponentRule) -> bool:
    upper = value.upper()
    tokens = set(_normalized_tokens(value))
    for keyword in rule.keywords:
        key = keyword.upper()
        if len(key) <= 2 and re.fullmatch(r"[A-Z0-9]+", key):
            if key in tokens:
                return True
            continue
        if key in upper:
            return True
    return False


def _is_annotation_layer(layer: str) -> bool:
    upper = layer.upper()
    return any(keyword.upper() in upper for keyword in ANNOTATION_KEYWORDS)


def _classify_text(*values: str) -> ComponentRule | None:
    joined = " ".join(value for value in values if value)
    for rule in COMPONENT_RULES:
        if _matches_rule(joined, rule):
            return rule
    return None


def _classify_entity(entity: Any, inherited_rule: ComponentRule | None = None) -> ComponentRule | None:
    if inherited_rule is not None:
        return inherited_rule
    return _classify_text(_layer(entity), _name(entity))


def _as_xy(value: Any) -> tuple[float, float] | None:
    try:
        return _finite_xy(float(value.x), float(value.y))
    except Exception:
        pass
    try:
        return _finite_xy(float(value[0]), float(value[1]))
    except Exception:
        return None


def _finite_number(value: float, default: float = 0.0) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError, OverflowError):
        return default
    return number if math.isfinite(number) else default


def _finite_xy(x: float, y: float) -> tuple[float, float] | None:
    if not math.isfinite(x) or not math.isfinite(y):
        return None
    return x, y


def _finite_points(points: Iterable[tuple[float, float]]) -> list[tuple[float, float]]:
    return [(x, y) for x, y in points if math.isfinite(x) and math.isfinite(y)]


def _hatch_points(entity: Any) -> list[tuple[float, float]]:
    points: list[tuple[float, float]] = []
    try:
        paths = entity.paths
    except Exception:
        return points

    for path in paths:
        vertices = getattr(path, "vertices", None)
        if vertices:
            for vertex in vertices:
                xy = _as_xy(vertex)
                if xy:
                    points.append(xy)
        edges = getattr(path, "edges", None)
        if edges:
            for edge in edges:
                for attr in ("start", "end", "center"):
                    xy = _as_xy(getattr(edge, attr, None))
                    if xy:
                        points.append(xy)
    return points


def _points_from_entity(entity: Any) -> list[tuple[float, float]]:
    kind = entity.dxftype()
    try:
        if kind == "LINE":
            return _finite_points([
                (float(entity.dxf.start.x), float(entity.dxf.start.y)),
                (float(entity.dxf.end.x), float(entity.dxf.end.y)),
            ])
        if kind == "LWPOLYLINE":
            return _finite_points((float(p[0]), float(p[1])) for p in entity.get_points())
        if kind == "POLYLINE":
            return _finite_points((float(v.dxf.location.x), float(v.dxf.location.y)) for v in entity.vertices)
        if kind == "CIRCLE":
            center = entity.dxf.center
            radius = float(entity.dxf.radius)
            return _finite_points([
                (float(center.x - radius), float(center.y - radius)),
                (float(center.x + radius), float(center.y + radius)),
            ])
        if kind == "ARC":
            center = entity.dxf.center
            radius = float(entity.dxf.radius)
            start_deg = float(entity.dxf.start_angle)
            end_deg = float(entity.dxf.end_angle)
            sweep = (end_deg - start_deg) % 360
            if sweep == 0:
                sweep = 360
            segments = max(8, min(48, int(sweep / 8)))
            points = []
            for idx in range(segments + 1):
                angle = math.radians(start_deg + sweep * idx / segments)
                points.append((
                    float(center.x + radius * math.cos(angle)),
                    float(center.y + radius * math.sin(angle)),
                ))
            return _finite_points(points)
        if kind in {"ELLIPSE", "SPLINE"}:
            return _finite_points(tuple(map(float, p[:2])) for p in entity.flattening(0.01))
        if kind in {"SOLID", "TRACE"}:
            return [
                xy for attr in ("vtx0", "vtx1", "vtx2", "vtx3")
                if (xy := _as_xy(getattr(entity.dxf, attr, None)))
            ]
        if kind == "HATCH":
            return _hatch_points(entity)
        if kind in {"TEXT", "MTEXT"}:
            insert = entity.dxf.insert
            return _finite_points([(float(insert.x), float(insert.y))])
    except Exception:
        return []
    return []


def _distance(a: tuple[float, float], b: tuple[float, float]) -> float:
    return math.hypot(b[0] - a[0], b[1] - a[1])


def _polyline_length(points: list[tuple[float, float]], closed: bool) -> float:
    if len(points) < 2:
        return 0.0
    total = sum(_distance(a, b) for a, b in zip(points, points[1:]))
    if closed:
        total += _distance(points[-1], points[0])
    return total


def _polygon_area(points: list[tuple[float, float]]) -> float:
    if len(points) < 3:
        return 0.0
    area = 0.0
    for a, b in zip(points, points[1:] + points[:1]):
        area += a[0] * b[1] - b[0] * a[1]
    return abs(area) / 2.0


def _is_closed(entity: Any, points: list[tuple[float, float]]) -> bool:
    try:
        if bool(entity.closed):
            return True
    except Exception:
        pass
    return len(points) > 2 and _distance(points[0], points[-1]) < 1e-6


def _bbox_from_points(points: Iterable[tuple[float, float]]) -> tuple[float, float, float, float] | None:
    pts = list(points)
    if not pts:
        return None
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    return min(xs), min(ys), max(xs), max(ys)


def _bbox_area_mm2(bbox: tuple[float, float, float, float] | None) -> float:
    if bbox is None:
        return 0.0
    min_x, min_y, max_x, max_y = bbox
    return max(max_x - min_x, 0.0) * max(max_y - min_y, 0.0)


def _entity_length_mm(entity: Any) -> float:
    kind = entity.dxftype()
    points = _points_from_entity(entity)
    try:
        if kind == "LINE" and len(points) == 2:
            return _distance(points[0], points[1])
        if kind in {"LWPOLYLINE", "POLYLINE", "SPLINE", "ELLIPSE"}:
            return _polyline_length(points, _is_closed(entity, points))
        if kind == "CIRCLE":
            return 2 * math.pi * float(entity.dxf.radius)
        if kind == "ARC":
            angle = (float(entity.dxf.end_angle) - float(entity.dxf.start_angle)) % 360
            if abs(angle) < 1e-9:
                angle = 360.0
            return 2 * math.pi * float(entity.dxf.radius) * angle / 360
    except Exception:
        return 0.0
    return 0.0


def _entity_area_mm2(entity: Any) -> float:
    kind = entity.dxftype()
    points = _points_from_entity(entity)
    try:
        if kind in {"LWPOLYLINE", "POLYLINE", "SPLINE", "ELLIPSE"} and _is_closed(entity, points):
            return _polygon_area(points)
        if kind == "CIRCLE":
            return math.pi * float(entity.dxf.radius) ** 2
        if kind == "HATCH":
            return _polygon_area(points)
        if kind in {"SOLID", "TRACE"}:
            return _polygon_area(points)
    except Exception:
        return 0.0
    return 0.0


def _round(value: float, digits: int = 3) -> float:
    value = _finite_number(value)
    if abs(value) < 1e-9:
        return 0.0
    return round(value, digits)


def _rect_dims_from_spec(spec: str) -> tuple[float, ...]:
    nums = [float(n) / 1000.0 for n in re.findall(r"\d{2,4}", spec)]
    return tuple(nums[:3])


def _is_plausible_dimension(value: float, minimum: float, maximum: float) -> bool:
    return minimum <= value <= maximum


def _dimension_score(observed: float, target: float) -> float:
    if observed <= 0 or target <= 0:
        return 0.0
    ratio = observed / target
    if ratio <= 0:
        return 0.0
    return max(0.0, 1.0 - min(abs(math.log(ratio)), 3.0) / 3.0)


def _sample_score(rule: ComponentRule, dims_m: tuple[float, float], scale_name: str) -> float:
    short_dim, long_dim = sorted(dims_m)
    score = 0.0

    if rule.key in {"column", "beam", "foundation"}:
        spec_dims = [dim for dim in _rect_dims_from_spec(rule.default_spec) if dim > 0]
        if len(spec_dims) >= 2:
            target_dims = sorted(spec_dims[:2])
            score += _dimension_score(short_dim, target_dims[0])
            score += _dimension_score(long_dim, target_dims[1])
            if rule.key == "foundation" and len(spec_dims) >= 3:
                score += _dimension_score(min(dims_m), spec_dims[2])
    elif rule.key in {"wall", "slab"}:
        thickness = _rect_dims_from_spec(rule.default_spec)[:1]
        if thickness:
            score += _dimension_score(short_dim, thickness[0])
        if rule.key == "wall":
            score += 0.25 if _is_plausible_dimension(long_dim, 1.0, 30.0) else -0.25
        else:
            score += 0.25 if _is_plausible_dimension(long_dim, 1.0, 500.0) else -0.25
    elif rule.key in {"door", "window"}:
        score += 0.25 if _is_plausible_dimension(short_dim, 0.3, 2.5) else -0.25
        score += 0.25 if _is_plausible_dimension(long_dim, 0.6, 4.0) else -0.25
    else:
        score += 0.1 if _is_plausible_dimension(long_dim, 0.1, 20.0) else 0.0

    if scale_name == "header":
        score += 0.05
    return score


def _infer_unit_scale(
    doc: Any,
    stats: dict[str, dict[str, Any]],
    fallback_scale: float,
) -> tuple[float, str]:
    try:
        insunits = int(doc.header.get("$INSUNITS", 0))
    except Exception:
        insunits = 0

    header_scale_map = {
        1: (0.0254, "英寸"),
        2: (0.3048, "英尺"),
        4: (0.001, "毫米"),
        5: (0.01, "厘米"),
        6: (1.0, "米"),
    }
    header_scale, header_label = header_scale_map.get(insunits, (fallback_scale, "未知单位"))

    best_scale = header_scale
    best_score = float("-inf")
    best_label = header_label

    for scale, label in CANDIDATE_UNIT_SCALES:
        score = 0.0
        for rule_key, bucket in stats.items():
            rule = bucket["rule"]
            samples: list[tuple[float, float]] = bucket.get("size_samples", [])
            if not samples:
                continue
            for raw_w, raw_h in samples:
                score += _sample_score(rule, (raw_w * scale, raw_h * scale), label)
        if abs(scale - header_scale) < 1e-9:
            score += 0.5
        if score > best_score:
            best_score = score
            best_scale = scale
            best_label = label

    if insunits in header_scale_map and abs(best_scale - header_scale) > 1e-9:
        return best_scale, f"图纸单位声明为{header_label}，但构件尺寸更接近{best_label}，已自动按{best_label}换算"
    if insunits in header_scale_map:
        return best_scale, f"根据 CAD INSUNITS={insunits} 按{best_label}换算"
    return best_scale, f"图纸单位未声明，按{best_label}换算"


def _thickness_from_spec(spec: str, default_m: float) -> float:
    nums = _rect_dims_from_spec(spec)
    if not nums:
        return default_m
    value = nums[0]
    if 0.03 <= value <= 1.5:
        return value
    return default_m


def _rebar_weight_tonnes(spec: str, length_m: float) -> tuple[float, str]:
    match = re.search(r"(?:%%C|[ΦφDd])?\s*(\d{1,2})(?:\s*@\s*(\d{2,4}))?", spec)
    if not match:
        return _round(length_m * 0.000888), "按综合理论重量 0.888kg/m 粗估"

    diameter = float(match.group(1))
    kg_per_m = 0.00617 * diameter * diameter
    return _round(length_m * kg_per_m / 1000.0), f"按 Φ{diameter:g} 理论重量 {kg_per_m:.3f}kg/m 粗估"


def _normalize_annotation_text(text: str) -> str:
    value = str(text or "")
    value = value.replace("\\P", " ").replace("\r", " ").replace("\n", " ")
    value = re.sub(r"\\[A-Za-z]\d*;", " ", value)
    value = value.replace("{", " ").replace("}", " ")
    return re.sub(r"\s+", " ", value).strip()


def _component_context_score(text: str, rule: ComponentRule) -> float:
    value = _normalize_annotation_text(text)
    upper = value.upper()
    score = 0.0
    if _matches_rule(value, rule):
        score += 4.0

    patterns = {
        "beam": (
            r"\b(?:KL|WKL|LL|XL|JZL|KLL|DL)\s*[-_]?\d*",
            r"\bL\s*\d+",
        ),
        "column": (
            r"\b(?:KZ|GZ|HZ|LZ|QZ|YBZ|GBZ|AZ|BZ|KZZ)\s*[-_]?\d*",
        ),
        "wall": (
            r"(?:剪力墙|墙厚|墙身|WALL)",
            r"(?<![A-Z0-9])T\s*[=:：]\s*\d{2,4}",
            r"\b(?:Q|YQ|DQ)\s*\d+",
        ),
        "slab": (
            r"(?:楼板|板厚|SLAB)",
            r"(?<![A-Z0-9])H\s*[=:：]\s*\d{2,4}",
            r"\b(?:LB|XB|WB|B)\s*\d+",
        ),
        "foundation": (
            r"(?:基础|承台|FOUND)",
            r"\b(?:DJ|JC|CT)\s*\d+",
        ),
        "rebar": (
            r"(?:钢筋|REBAR|%%C|Φ|φ)",
            r"\bD\s*\d{1,2}\s*@",
        ),
        "door": (
            r"(?:防火门|DOOR)",
            r"\b(?:FM|M)\s*\d{3,4}",
        ),
        "window": (
            r"(?:WINDOW)",
            r"\bC\s*\d{3,4}",
        ),
        "fire_pipe": (
            r"(?:FIRE|SPRINKLER|HYDRANT|消防|喷淋|消火栓)",
            r"\bDN\s*\d{2,4}",
        ),
        "fire_device": (
            r"(?:烟感|温感|喷头|报警|消防箱|灭火器|SMOKE|ALARM|SPRINKLER)",
        ),
        "plumbing_pipe": (
            r"(?:给水|排水|雨水|污水|废水|冷水|热水|PPR|HDPE|UPVC|PVC-U|PLUMB|WATER|DRAIN)",
            r"\bD[NE]?\s*\d{2,4}",
        ),
        "valve": (
            r"(?:阀门|闸阀|截止阀|蝶阀|球阀|止回阀|VALVE)",
        ),
        "sanitary_fixture": (
            r"(?:洁具|卫生器具|坐便器|蹲便器|洗脸盆|小便器|地漏|TOILET|BASIN)",
        ),
        "electrical_conduit": (
            r"(?:电气配管|电线管|线管|配管|CONDUIT|JDG|KBG)",
            r"\b(?:SC|PC|JDG|KBG)\s*\d{1,3}",
        ),
        "cable": (
            r"(?:电缆|电线|线缆|CABLE|WIRE|YJV|BV|WDZ|WDZN|NH)",
        ),
        "cable_tray": (
            r"(?:桥架|线槽|母线槽|TRAY|CABLETRAY)",
        ),
        "electrical_device": (
            r"(?:配电箱|动力箱|照明箱|灯具|开关|插座|应急灯)",
            r"\b(?:DB|AL|AP)\s*[-_]?\d*",
        ),
        "hvac_duct": (
            r"(?:风管|送风|回风|排风|新风|防排烟|通风|DUCT|HVAC)",
            r"\d{3,4}\s*[xX×*]\s*\d{2,4}",
        ),
        "hvac_equipment": (
            r"(?:空调机组|风机盘管|风机|新风机|排风机|散热器|空调设备|AHU|FCU|FAN)",
        ),
    }
    for pattern in patterns.get(rule.key, ()):
        if re.search(pattern, upper, re.IGNORECASE):
            score += 3.0
            break
    return score


def _classify_annotation_rule(*values: str) -> ComponentRule | None:
    joined = _normalize_annotation_text(" ".join(value for value in values if value))
    if not joined:
        return None

    direct = _classify_text(joined)
    if direct is not None:
        return direct

    scored = [
        (score, rule)
        for rule in COMPONENT_RULES
        if (score := _component_context_score(joined, rule)) >= 2.0
    ]
    if not scored:
        return None

    scored.sort(key=lambda item: item[0], reverse=True)
    if len(scored) > 1 and abs(scored[0][0] - scored[1][0]) < 1e-9:
        return None
    return scored[0][1]


def _iter_text_spec_candidates(text: str, rule: ComponentRule) -> Iterable[tuple[str, float]]:
    value = _normalize_annotation_text(text)
    if not value:
        return

    rect_pattern = r"(?<!\d)(\d{2,4})\s*[xX×*]\s*(\d{2,4})(?:\s*[xX×*]\s*(\d{2,4}))?(?!\d)"

    if rule.key in {"beam", "column", "foundation"}:
        for match in re.finditer(rect_pattern, value):
            values = [int(item) for item in match.groups() if item]
            if rule.key == "foundation":
                if len(values) >= 2 and all(_validated_dimension(rule, item) for item in values):
                    yield "×".join(str(item) for item in values[:3]), 1.0 + min(len(values), 3) * 0.2
                continue

            if len(values) >= 2:
                a, b = values[:2]
                if _validated_dimension(rule, a) and _validated_dimension(rule, b):
                    yield f"{a}×{b}", 1.0

    if rule.key in {"wall", "slab"}:
        prefix = "T" if rule.key == "wall" else "H"
        if rule.key == "wall":
            patterns = (
                r"(?:墙厚|墙身厚|剪力墙厚|WALL\s*T|WT|THK)\s*[=:：]?\s*(\d{2,4})",
                r"(?<![A-Z0-9])T\s*[=:：]\s*(\d{2,4})",
            )
        else:
            patterns = (
                r"(?:板厚|楼板厚|板\s*厚|SLAB\s*H|BH|THK)\s*[=:：]?\s*(\d{2,4})",
                r"(?<![A-Z0-9])H\s*[=:：]\s*(\d{2,4})",
            )
        for pattern in patterns:
            for match in re.finditer(pattern, value, re.IGNORECASE):
                dimension = int(match.group(1))
                if _validated_dimension(rule, dimension):
                    yield f"{prefix}={dimension}", 1.2

    if rule.key == "rebar":
        pattern = r"((?:[ABC]\s*)?(?:%%C|[ΦφDd])?\s*\d{1,2}\s*@\s*\d{2,4}|(?:%%C|[ΦφDd])\s*\d{1,2})"
        for match in re.finditer(pattern, value, re.IGNORECASE):
            spec = re.sub(r"\s+", "", match.group(1)).replace("%%C", "Φ")
            yield spec, 1.0

    if rule.key in {"door", "window"}:
        match = re.search(r"\b([A-Z]{0,4}\d{3,4})\b", value.upper())
        if match:
            yield match.group(1), 0.8

    if rule.key in {"plumbing_pipe", "fire_pipe", "valve"}:
        patterns = (
            r"\b(DN\s*\d{2,4})\b",
            r"\b(DE\s*\d{2,4})\b",
            r"\b(D\s*\d{2,4})\b",
        )
        for pattern in patterns:
            for match in re.finditer(pattern, value, re.IGNORECASE):
                yield re.sub(r"\s+", "", match.group(1)).upper(), 1.0

    if rule.key == "electrical_conduit":
        for match in re.finditer(r"\b((?:SC|PC|JDG|KBG|MT|CT)\s*\d{1,3})\b", value, re.IGNORECASE):
            yield re.sub(r"\s+", "", match.group(1)).upper(), 1.0

    if rule.key == "cable":
        cable_pattern = r"\b((?:WDZN?|NH|ZR)?-?(?:YJV|VV|BV|BVR|KVV)[A-Z0-9\-]*(?:\s*\d+\s*[xX×*]\s*\d+(?:\.\d+)?)?)\b"
        for match in re.finditer(cable_pattern, value, re.IGNORECASE):
            yield re.sub(r"\s+", "", match.group(1)).upper(), 1.0

    if rule.key in {"cable_tray", "hvac_duct"}:
        for match in re.finditer(rect_pattern, value):
            values = [int(item) for item in match.groups() if item]
            if len(values) >= 2 and all(50 <= item <= 3000 for item in values[:2]):
                yield f"{values[0]}×{values[1]}", 1.0

    if rule.key in {"fire_device", "sanitary_fixture", "electrical_device", "hvac_equipment"}:
        match = re.search(r"\b([A-Z]{1,6}\s*[-_]?\s*\d{0,4})\b", value.upper())
        if match and len(match.group(1).strip()) >= 2:
            yield re.sub(r"\s+", "", match.group(1)), 0.6


def _collect_spec_candidates(
    texts: Iterable[str],
    rule: ComponentRule,
    *,
    base_score: float,
    require_context: bool,
) -> list[SpecCandidate]:
    candidates: list[SpecCandidate] = []
    for text in texts:
        normalized = _normalize_annotation_text(text)
        if not normalized:
            continue
        context_score = _component_context_score(normalized, rule)
        if require_context and context_score <= 0:
            continue
        for spec, quality in _iter_text_spec_candidates(normalized, rule):
            candidates.append(SpecCandidate(spec=spec, score=base_score + context_score + quality))
    return candidates


def _ranked_spec(candidates: Iterable[SpecCandidate], default_spec: str) -> str:
    aggregate: dict[str, list[float]] = {}
    for candidate in candidates:
        if not candidate.spec:
            continue
        count, score = aggregate.setdefault(candidate.spec, [0.0, 0.0])
        aggregate[candidate.spec] = [count + 1.0, score + candidate.score]

    if not aggregate:
        return default_spec

    return max(
        aggregate.items(),
        key=lambda item: (item[1][1], item[1][0], item[0] == default_spec, item[0]),
    )[0]


def _height_value_to_m(raw_value: str, unit: str | None) -> float | None:
    try:
        value = float(raw_value)
    except ValueError:
        return None

    unit_text = (unit or "").lower()
    if unit_text in {"m", "米"}:
        height = value
    elif unit_text in {"mm", "毫米"} or value > 20:
        height = value / 1000.0
    else:
        height = value

    if 2.4 <= height <= 6.5:
        return _round(height, 3)
    return None


def _extract_story_height_m(texts: Iterable[str]) -> float | None:
    patterns = (
        r"(?:结构层高|建筑层高|楼层高度|层高|净高|CH)\s*[=:：]?\s*(\d+(?:\.\d+)?)\s*(mm|毫米|m|米)?",
        r"\b(?:STOREY|STORY)\s*HEIGHT\s*[=:：]?\s*(\d+(?:\.\d+)?)\s*(mm|m)?",
    )
    heights: Counter[float] = Counter()
    for text in texts:
        normalized = _normalize_annotation_text(text)
        for pattern in patterns:
            for match in re.finditer(pattern, normalized, re.IGNORECASE):
                height = _height_value_to_m(match.group(1), match.group(2))
                if height is not None:
                    heights[height] += 1
    if not heights:
        return None
    return heights.most_common(1)[0][0]


def _build_annotation_profile(texts: Iterable[str]) -> AnnotationProfile:
    normalized_texts = [_normalize_annotation_text(text) for text in texts if _normalize_annotation_text(text)]
    specs_by_rule = {
        rule.key: tuple(_collect_spec_candidates(normalized_texts, rule, base_score=1.0, require_context=True))
        for rule in COMPONENT_RULES
    }
    return AnnotationProfile(
        specs_by_rule=specs_by_rule,
        story_height_m=_extract_story_height_m(normalized_texts),
    )


# ── 专业自动检测 ──────────────────────────────────────────────
DISCIPLINE_KEYWORDS: dict[str, tuple[str, ...]] = {
    "civil": ("柱", "梁", "墙", "板", "基础", "楼梯", "阳台", "雨篷", "COLUMN", "BEAM", "WALL", "SLAB", "FOUNDATION", "STAIR", "KZ", "KL", "Q", "LB"),
    "water": ("给水", "排水", "雨水", "污水", "废水", "PPR", "HDPE", "UPVC", "PVC", "PLUMB", "WATER", "DRAIN", "SEWER", "DN", "洁具", "阀门"),
    "electrical": ("电缆", "电线", "配电", "桥架", "YJV", "BV", "WDZ", "JDG", "KBG", "SC", "CABLE", "WIRE", "CONDUIT", "ELEC", "照明", "开关", "插座", "灯具", "LIGHT", "LIGHTING", "LAMP", "SOCKET", "RECEPTACLE", "LUMIN", "POWER"),
    "hvac": ("风管", "空调", "风机", "通风", "AHU", "FCU", "DUCT", "HVAC", "送风", "回风", "排风", "新风", "防排烟"),
    "fire": ("消防", "喷淋", "消火栓", "FIRE", "SPRINKLER", "HYDRANT", "烟感", "温感", "报警"),
    "decoration": ("涂料", "抹灰", "吊顶", "楼地面", "PAINT", "PLASTER", "CEILING", "COATING", "地砖", "地板", "石材"),
}

DISCIPLINE_LABELS: dict[str, str] = {
    "civil": "土建结构",
    "water": "给排水",
    "electrical": "电气",
    "hvac": "暖通",
    "fire": "消防",
    "decoration": "装饰装修",
}


def _detect_disciplines(
    layer_names: list[str],
    annotation_texts: list[str],
    components: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """检测图纸涉及的专业及其占比。"""
    combined_text = " ".join(layer_names + annotation_texts).upper()
    component_keys = {c.get("type", "") for c in components}
    # 把构件类型也加入文本用于匹配
    for ctype in component_keys:
        combined_text += f" {ctype}"

    scores: dict[str, float] = {}
    for discipline, keywords in DISCIPLINE_KEYWORDS.items():
        score = 0.0
        for kw in keywords:
            if kw.upper() in combined_text:
                score += 1.0
        scores[discipline] = score

    total = sum(scores.values()) or 1.0
    result = []
    for discipline, score in sorted(scores.items(), key=lambda x: -x[1]):
        if score <= 0:
            continue
        result.append({
            "key": discipline,
            "name": DISCIPLINE_LABELS.get(discipline, discipline),
            "ratio": round(score / total, 2),
            "component_count": sum(
                1 for c in components
                if any(kw.upper() in (c.get("type", "") + " ".join(c.get("layers", []))).upper()
                       for kw in DISCIPLINE_KEYWORDS.get(discipline, ()))
            ),
        })
    return result


# ── 增强置信度计算（多因子加权 + 交叉验证） ────────────────────
# 经验比例：典型住宅项目中各构件工程量的合理区间（用于交叉验证）
_CROSS_VALIDATION_RATIOS: dict[str, tuple[float, float]] = {
    # key: (min_ratio, max_ratio) 相对总建筑面积或总量
    "column": (0.02, 0.15),    # 柱体积占混凝土 2-15%
    "beam": (0.10, 0.45),      # 梁体积占混凝土 10-45%
    "wall": (0.15, 0.60),      # 墙体积占混凝土 15-60%
    "slab": (0.15, 0.55),      # 板体积占混凝土 15-55%
    "foundation": (0.05, 0.40),
    "rebar": (0.01, 0.20),     # 钢筋重量相对混凝土体积 kg/m³
}


def _enhanced_confidence(
    rule: ComponentRule,
    *,
    base_confidence: float,
    count: int,
    length_m: float,
    area_m2: float,
    quantity: float,
    spec: str,
    virtual_entity_count: int,
    layer_count: int,
    text_count: int,
    total_concrete_volume: float,
) -> tuple[float, list[str]]:
    """多因子加权置信度计算，返回 (confidence, 诊断信息列表)。"""
    notes: list[str] = []
    confidence = base_confidence

    # 1. 几何数据丰富度 (+0~8)
    geo_score = 0
    if count > 0:
        geo_score += 3
    if area_m2 > 0 or length_m > 0:
        geo_score += 2
    if quantity > 0:
        geo_score += 3
    confidence += geo_score

    # 2. 规格提取质量 (+0~5)
    if spec and spec != rule.default_spec:
        confidence += 5  # 提取到非默认规格，置信度更高
        notes.append(f"规格已从图纸标注提取: {spec}")
    elif spec == rule.default_spec:
        confidence -= 2  # 使用默认规格，降低置信度

    # 3. 图块展开 (+0~2)
    if virtual_entity_count:
        confidence += 2

    # 4. 图层多样性 (+0~3)
    if layer_count >= 3:
        confidence += 3
    elif layer_count >= 2:
        confidence += 1

    # 5. 文字标注丰富度 (+0~2)
    if text_count >= 5:
        confidence += 2
    elif text_count >= 1:
        confidence += 1

    # 6. 交叉验证：工程量合理性 (-10~+5)
    if rule.key in _CROSS_VALIDATION_RATIOS and total_concrete_volume > 0:
        min_ratio, max_ratio = _CROSS_VALIDATION_RATIOS[rule.key]
        actual_ratio = quantity / total_concrete_volume if total_concrete_volume > 0 else 0
        if actual_ratio < min_ratio * 0.3:
            confidence -= 8
            notes.append(f"工程量占比偏低({actual_ratio:.1%})，可能存在漏识别")
        elif actual_ratio < min_ratio:
            confidence -= 3
            notes.append(f"工程量占比略低({actual_ratio:.1%})")
        elif actual_ratio > max_ratio * 2.0:
            confidence -= 8
            notes.append(f"工程量占比偏高({actual_ratio:.1%})，可能存在重复识别")
        elif actual_ratio > max_ratio:
            confidence -= 3
            notes.append(f"工程量占比略高({actual_ratio:.1%})")
        else:
            confidence += 5
            notes.append(f"工程量占比合理({actual_ratio:.1%})")

    # 7. 工程量为零的严重惩罚
    if quantity <= 0 and rule.metric not in {"count", "area"}:
        confidence -= 15
        notes.append("工程量为 0，缺少闭合轮廓或尺寸标注")

    # 8. 计数类构件的合理范围校验
    if rule.metric == "count" and count > 500:
        confidence -= 5
        notes.append(f"识别数量异常多({count})，建议人工复核")

    confidence = max(30.0, min(98.0, confidence))
    return confidence, notes


def _compute_quality_score(
    components: list[dict[str, Any]],
    total_entities: int,
    classified_entities: int,
    disciplines: list[dict[str, Any]],
) -> dict[str, Any]:
    """计算图纸解析整体质量评分。"""
    if not components:
        return {"score": 0, "level": "F", "issues": ["未识别到任何构件"]}

    issues: list[str] = []
    scores: list[float] = []

    # 1. 识别覆盖率 (30分)
    coverage_ratio = classified_entities / max(total_entities, 1)
    coverage_score = min(30, coverage_ratio * 100)
    if coverage_ratio < 0.08:
        issues.append("可识别图层占比极低，建议规范图层命名")
        coverage_score *= 0.3
    elif coverage_ratio < 0.20:
        issues.append("可识别图层占比较低，部分构件可能遗漏")
    scores.append(coverage_score)

    # 2. 平均置信度 (25分)
    avg_conf = sum(c.get("confidence", 0) for c in components) / len(components)
    conf_score = (avg_conf / 98.0) * 25
    if avg_conf < 60:
        issues.append(f"平均置信度偏低({avg_conf:.0f}%)，建议人工复核")
    scores.append(conf_score)

    # 3. 工程量完整度 (25分)
    zero_qty = sum(1 for c in components if c.get("quantity_estimate", 0) <= 0)
    completeness = (len(components) - zero_qty) / len(components)
    qty_score = completeness * 25
    if zero_qty > 0:
        issues.append(f"{zero_qty} 类构件工程量为 0")
    scores.append(qty_score)

    # 4. 专业覆盖度 (10分)
    disc_count = len(disciplines)
    disc_score = min(10, disc_count * 2.5)
    scores.append(disc_score)

    # 5. 规格提取率 (10分)
    specs_extracted = sum(
        1 for c in components
        if c.get("spec") and "综合" not in c.get("spec", "")
    )
    spec_ratio = specs_extracted / len(components)
    spec_score = spec_ratio * 10
    scores.append(spec_score)

    total_score = round(sum(scores))
    if total_score >= 85:
        level = "A"
    elif total_score >= 70:
        level = "B"
    elif total_score >= 55:
        level = "C"
    elif total_score >= 40:
        level = "D"
    else:
        level = "F"

    return {
        "score": total_score,
        "level": level,
        "coverage": round(coverage_ratio, 2),
        "avg_confidence": round(avg_conf, 1),
        "completeness": round(completeness, 2),
        "discipline_count": disc_count,
        "spec_extraction_rate": round(spec_ratio, 2),
        "issues": issues,
    }


def _metric_quantity(
    rule: ComponentRule,
    *,
    length_m: float,
    area_m2: float,
    count: int,
    spec: str,
    story_height_m: float | None = None,
) -> tuple[float, str]:
    if rule.metric == "count":
        return float(count), f"按识别到的 {count} 个图块/图元计数"

    if rule.metric == "area":
        if area_m2 > 0:
            return _round(area_m2), f"按闭合轮廓面积 {area_m2:.2f}m² 估算"
        return float(count), f"未提取到面积，暂按 {count} 处计数"

    if rule.metric == "length":
        if length_m > 0:
            return _round(length_m), f"按识别到的管线/线缆/桥架中心线长度 {length_m:.2f}m 估算"
        return float(count), f"未提取到线长，暂按 {count} 处计数"

    if rule.metric == "duct_area":
        if area_m2 > 0:
            return _round(area_m2), f"按闭合风管轮廓展开/投影面积 {area_m2:.2f}m² 估算"
        dims = _rect_dims_from_spec(spec)
        width = dims[0] if len(dims) >= 1 and 0.05 <= dims[0] <= 3.0 else rule.default_width_m
        if length_m > 0:
            area = length_m * width
            return _round(area), f"按风管长度 {length_m:.2f}m × 规格宽度 {width:.2f}m 粗估面积"
        return float(count), f"未提取到风管线长/面积，暂按 {count} 处计数"

    if rule.metric == "length_volume":
        dims = _rect_dims_from_spec(spec)
        width = dims[0] if len(dims) >= 1 and 0.03 <= dims[0] <= 2.0 else rule.default_width_m
        height = dims[1] if len(dims) >= 2 and 0.03 <= dims[1] <= 3.0 else rule.default_height_m
        if rule.key == "wall" and story_height_m is not None:
            height = story_height_m
        volume = length_m * width * height
        story_note = "，层高取图纸标注" if rule.key == "wall" and story_height_m is not None else ""
        return _round(volume), (
            f"按中心线/边线长度 {length_m:.2f}m × 截面/厚度 {width:.2f}m × 高度 {height:.2f}m 估算{story_note}"
        )

    if rule.metric == "area_volume":
        dims = _rect_dims_from_spec(spec)
        if rule.key == "column":
            height = story_height_m or rule.default_height_m
        elif rule.key == "foundation" and len(dims) >= 3:
            height = dims[2]
        elif rule.key == "foundation":
            height = rule.default_height_m
        else:
            height = _thickness_from_spec(spec, rule.default_height_m)
        if area_m2 > 0:
            volume = area_m2 * height
            story_note = "，层高取图纸标注" if rule.key == "column" and story_height_m is not None else ""
            return _round(volume), f"按闭合轮廓面积 {area_m2:.2f}m² × 高度/厚度 {height:.2f}m 估算{story_note}"
        if rule.key == "column":
            width = dims[0] if len(dims) >= 1 else 0.6
            depth = dims[1] if len(dims) >= 2 else width
            height = story_height_m or rule.default_height_m
            volume = count * width * depth * height
            return _round(volume), f"未找到闭合柱轮廓，按 {count} 个 × {width:.2f}m × {depth:.2f}m × {height:.2f}m 估算"
        return 0.0, "未找到可计算面积的闭合轮廓"

    if rule.metric == "rebar_weight":
        quantity, note = _rebar_weight_tonnes(spec, length_m)
        return quantity, f"按钢筋线长 {length_m:.2f}m；{note}"

    return 0.0, ""


def _validated_dimension(rule: ComponentRule, value: int) -> bool:
    if rule.key == "wall":
        return 100 <= value <= 600
    if rule.key == "slab":
        return 70 <= value <= 350
    if rule.key in {"beam", "column"}:
        return 100 <= value <= 2500
    if rule.key == "foundation":
        return 100 <= value <= 5000
    return True


def _extract_specs(
    texts: Iterable[str],
    rule: ComponentRule,
    area_m2: float,
    count: int,
    *,
    annotation_profile: AnnotationProfile | None = None,
) -> str:
    candidates = _collect_spec_candidates(texts, rule, base_score=4.0, require_context=False)
    if annotation_profile is not None:
        candidates.extend(annotation_profile.candidates_for(rule))

    spec = _ranked_spec(candidates, rule.default_spec)
    if spec != rule.default_spec:
        return spec

    if rule.key in {"door", "window"} and area_m2 > 0 and count > 0:
        each_area = area_m2 / max(count, 1)
        return f"单樘投影约 {each_area:.2f}m²"

    return spec


def _iter_virtual_entities(entity: Any) -> list[Any]:
    try:
        return list(entity.virtual_entities())
    except Exception:
        return []


def _collect_bbox(entities: Iterable[Any]) -> tuple[float, float, float, float] | None:
    points: list[tuple[float, float]] = []
    for entity in entities:
        if entity.dxftype() == "INSERT":
            for virtual in _iter_virtual_entities(entity):
                points.extend(_points_from_entity(virtual))
        else:
            points.extend(_points_from_entity(entity))
    return _bbox_from_points(points)


def _bbox_area_units(bbox: tuple[float, float, float, float] | None) -> float:
    if bbox is None:
        return 0.0
    return max(bbox[2] - bbox[0], 0.0) * max(bbox[3] - bbox[1], 0.0)


def _bbox_intersects(
    a: tuple[float, float, float, float] | None,
    b: tuple[float, float, float, float] | None,
) -> bool:
    if a is None or b is None:
        return False
    return not (a[2] < b[0] or a[0] > b[2] or a[3] < b[1] or a[1] > b[3])


def _expand_bbox(
    bbox: tuple[float, float, float, float],
    ratio: float,
) -> tuple[float, float, float, float]:
    min_x, min_y, max_x, max_y = bbox
    span = max(max_x - min_x, max_y - min_y, 1.0)
    pad = span * ratio
    return min_x - pad, min_y - pad, max_x + pad, max_y + pad


def _merge_bbox(
    a: tuple[float, float, float, float] | None,
    b: tuple[float, float, float, float] | None,
) -> tuple[float, float, float, float] | None:
    if a is None:
        return b
    if b is None:
        return a
    return min(a[0], b[0]), min(a[1], b[1]), max(a[2], b[2]), max(a[3], b[3])


def _svg_polyline(
    points: list[tuple[float, float]],
    closed: bool,
    color: str,
    stroke_width: float,
    opacity: str,
) -> str:
    if len(points) < 2:
        return ""
    pts = " ".join(f"{x:.2f},{-y:.2f}" for x, y in points)
    tag = "polygon" if closed else "polyline"
    return (
        f'<{tag} points="{pts}" fill="none" stroke="{color}" '
        f'stroke-opacity="{opacity}" stroke-width="{stroke_width:.2f}" '
        'stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke" />'
    )


def _path_commands(points: list[tuple[float, float]], closed: bool) -> str:
    if len(points) < 2:
        return ""
    coords = " ".join(f"L{x:.2f},{-y:.2f}" for x, y in points[1:])
    close = " Z" if closed else ""
    return f"M{points[0][0]:.2f},{-points[0][1]:.2f} {coords}{close}"


def _append_path_chunk(
    parts: list[str],
    commands: list[str],
    *,
    color: str,
    stroke_width: float,
    opacity: str,
) -> None:
    if not commands:
        return
    parts.append(
        f'<path d="{" ".join(commands)}" fill="none" stroke="{color}" '
        f'stroke-opacity="{opacity}" stroke-width="{stroke_width:.2f}" '
        'stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke" />'
    )
    commands.clear()


def _emit_analysis_progress(callback: DxfProgressCallback | None, **payload: Any) -> None:
    if callback is None:
        return
    try:
        callback(payload)
    except Exception:
        pass


def _svg_highlight_rect(
    bbox: tuple[float, float, float, float],
    view_span: float,
    label: str,
    color: str,
    *,
    index: int,
    rule_key: str,
) -> str:
    min_x, min_y, max_x, max_y = bbox
    element_span = max(max_x - min_x, max_y - min_y, view_span * 0.0005, 1e-6)
    pad = max(element_span * 0.12, view_span * 0.0015)
    x = min_x - pad
    y = -(max_y + pad)
    width = max(max_x - min_x, 0.0) + pad * 2
    height = max(max_y - min_y, 0.0) + pad * 2
    stroke_width = PREVIEW_SCREEN_STROKE_WIDTH
    title = html.escape(label)
    safe_rule_key = html.escape(rule_key)
    return (
        f'<g class="dr-recognition-highlight" aria-label="{title}" '
        f'data-recognition-index="{index}" data-component-type="{safe_rule_key}">'
        f'<rect class="dr-recognition-highlight-glow" x="{x:.2f}" y="{y:.2f}" '
        f'width="{width:.2f}" height="{height:.2f}" rx="{pad * 0.22:.2f}" '
        f'fill="{color}" fill-opacity="0.06" stroke="{color}" stroke-opacity="0.30" '
        f'stroke-width="{stroke_width * 5.0:.2f}" vector-effect="non-scaling-stroke" />'
        f'<rect class="dr-recognition-highlight-outline" x="{x:.2f}" y="{y:.2f}" '
        f'width="{width:.2f}" height="{height:.2f}" rx="{pad * 0.22:.2f}" '
        f'fill="{color}" fill-opacity="0.08" stroke="{color}" stroke-opacity="0.98" '
        f'stroke-width="{stroke_width * 1.9:.2f}" stroke-dasharray="10 6" '
        f'vector-effect="non-scaling-stroke" />'
        "</g>"
    )


def _preview_points(points: list[tuple[float, float]], max_points: int) -> list[tuple[float, float]]:
    if len(points) <= max_points:
        return points
    step = max(1, math.ceil(len(points) / max_points))
    sampled = points[::step]
    if sampled[-1] != points[-1]:
        sampled.append(points[-1])
    return sampled


def _iter_preview_items(msp: Any, max_items: int) -> list[tuple[Any, ComponentRule | None]]:
    items: list[tuple[Any, ComponentRule | None]] = []
    for entity in msp:
        if len(items) >= max_items:
            break
        kind = entity.dxftype()
        rule = _classify_entity(entity)
        if kind == "INSERT":
            virtuals = _iter_virtual_entities(entity)
            if not virtuals:
                continue
            for virtual in virtuals:
                if len(items) >= max_items:
                    break
                if virtual.dxftype() in DRAWABLE_TYPES:
                    items.append((virtual, rule or _classify_entity(virtual)))
            continue
        if kind in DRAWABLE_TYPES:
            items.append((entity, rule))
    return items


def _preview_bbox(items: list[tuple[Any, ComponentRule | None]]) -> tuple[float, float, float, float] | None:
    all_bbox: tuple[float, float, float, float] | None = None
    line_bbox: tuple[float, float, float, float] | None = None
    classified_line_bbox: tuple[float, float, float, float] | None = None

    for entity, rule in items:
        kind = entity.dxftype()
        bbox = _bbox_from_points(_points_from_entity(entity))
        all_bbox = _merge_bbox(all_bbox, bbox)
        if kind not in {"HATCH", "SOLID", "TRACE", "TEXT", "MTEXT"}:
            line_bbox = _merge_bbox(line_bbox, bbox)
            if rule:
                classified_line_bbox = _merge_bbox(classified_line_bbox, bbox)

    if all_bbox is None:
        return None
    all_area = _bbox_area_units(all_bbox)
    classified_area = _bbox_area_units(classified_line_bbox)
    if classified_line_bbox and classified_area > 0 and classified_area >= all_area * 0.01:
        return _expand_bbox(classified_line_bbox, 0.12)
    if line_bbox:
        return _expand_bbox(line_bbox, 0.04)
    return _expand_bbox(all_bbox, 0.03)


def _should_render_preview_item(
    entity: Any,
    rule: ComponentRule | None,
    bbox: tuple[float, float, float, float] | None,
    view_bbox: tuple[float, float, float, float],
    view_area: float,
) -> bool:
    kind = entity.dxftype()
    if bbox is None or not _bbox_intersects(bbox, view_bbox):
        return False
    if kind in {"HATCH", "SOLID", "TRACE"}:
        return False
    if kind in {"TEXT", "MTEXT"}:
        return bool(_read_text(entity))
    if kind in {"CIRCLE", "ARC", "ELLIPSE"}:
        item_area = _bbox_area_units(bbox)
        if item_area > view_area * 0.08:
            return False
    return True


def sanitize_preview_svg(svg: str) -> str:
    if not svg:
        return ""
    sanitized = re.sub(r"<\s*(script|foreignObject)\b[^>]*>.*?<\s*/\s*\1\s*>", "", svg, flags=re.IGNORECASE | re.DOTALL)
    sanitized = re.sub(r"<\s*(script|foreignObject)\b[^>]*/\s*>", "", sanitized, flags=re.IGNORECASE)
    sanitized = re.sub(r"\s+on[a-zA-Z]+\s*=\s*(\"[^\"]*\"|'[^']*'|[^\s>]+)", "", sanitized)
    sanitized = re.sub(r"\s+(?:href|xlink:href)\s*=\s*(['\"]?)\s*(?:javascript:|data:|https?://)[^'\"\s>]*\1", "", sanitized, flags=re.IGNORECASE)
    return sanitized


def _preview_svg_snapshot(
    parts: list[str],
    path_commands_by_style: dict[tuple[str, str], list[str]],
    highlight_rects: list[str],
    *,
    stroke_width: float,
) -> str:
    snapshot = list(parts)
    for (color, opacity), commands in path_commands_by_style.items():
        if not commands:
            continue
        snapshot.append(
            f'<path d="{" ".join(commands)}" fill="none" stroke="{color}" '
            f'stroke-opacity="{opacity}" stroke-width="{stroke_width:.2f}" '
            'stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke" />'
        )
    if highlight_rects:
        snapshot.append('<g class="dr-preview-highlights">')
        snapshot.extend(highlight_rects)
        snapshot.append("</g>")
    snapshot.append("</g></svg>")
    return sanitize_preview_svg("".join(snapshot))


def build_preview_svg(
    doc: Any,
    max_entities: int = PREVIEW_MAX_RENDERED_ENTITIES,
    *,
    max_points_per_entity: int = PREVIEW_MAX_POINTS_PER_ENTITY,
    max_text_entities: int = PREVIEW_MAX_TEXT_ENTITIES,
    shape_rendering: str = "geometricPrecision",
    stroke_width: float = PREVIEW_SCREEN_STROKE_WIDTH,
    progress_callback: DxfProgressCallback | None = None,
) -> str:
    """Render a clean CAD-style line preview without depending on heavy CAD renderers."""

    msp = doc.modelspace()
    items = _iter_preview_items(msp, max(max_entities, PREVIEW_COLLECTION_LIMIT))
    bbox = _preview_bbox(items)
    if bbox is None:
        return ""

    min_x, min_y, max_x, max_y = bbox
    width = max(max_x - min_x, 1)
    height = max(max_y - min_y, 1)
    view_box = f"{min_x:.2f} {-max_y:.2f} {width:.2f} {height:.2f}"
    view_area = width * height

    parts = [
        (
            '<svg xmlns="http://www.w3.org/2000/svg" class="dr-preview-svg" '
            f'viewBox="{view_box}" preserveAspectRatio="xMidYMid meet" '
            f'role="img" aria-label="图纸预览" shape-rendering="{shape_rendering}">'
        ),
        f'<rect x="{min_x:.2f}" y="{-max_y:.2f}" width="{width:.2f}" height="{height:.2f}" fill="#08111f" />',
        '<g>',
    ]

    geometry_rendered = 0
    text_rendered = 0
    skipped = 0
    path_commands_by_style: dict[tuple[str, str], list[str]] = {}
    path_lengths_by_style: dict[tuple[str, str], int] = {}
    highlight_rects: list[str] = []
    last_progress_highlight_count = 0

    def add_path_command(color: str, opacity: str, command: str) -> None:
        style = (color, opacity)
        commands = path_commands_by_style.setdefault(style, [])
        commands.append(command)
        path_lengths_by_style[style] = path_lengths_by_style.get(style, 0) + len(command)
        if path_lengths_by_style[style] >= PREVIEW_PATH_CHUNK_LENGTH:
            _append_path_chunk(parts, commands, color=color, stroke_width=stroke_width, opacity=opacity)
            path_lengths_by_style[style] = 0

    def emit_preview_progress(force: bool = False) -> None:
        nonlocal last_progress_highlight_count
        highlight_count = len(highlight_rects)
        if progress_callback is None or highlight_count <= 0:
            return
        if not force and highlight_count - last_progress_highlight_count < 48:
            return
        last_progress_highlight_count = highlight_count
        partial_svg = _preview_svg_snapshot(
            parts,
            path_commands_by_style,
            highlight_rects,
            stroke_width=stroke_width,
        )
        _emit_analysis_progress(
            progress_callback,
            progress=f"正在标记构件 {highlight_count} 处...",
            preview_svg=partial_svg,
        )

    for entity, rule in sorted(items, key=lambda item: (0 if item[1] else 1, item[0].dxftype() in {"TEXT", "MTEXT"})):
        kind = entity.dxftype()
        if kind in {"TEXT", "MTEXT"}:
            continue
        if geometry_rendered >= max_entities:
            break
        entity_bbox = _bbox_from_points(_points_from_entity(entity))
        if not _should_render_preview_item(entity, rule, entity_bbox, bbox, view_area):
            skipped += 1
            continue
        if (
            rule is not None
            and rule.key in PREVIEW_HIGHLIGHT_RULES
            and entity_bbox is not None
            and len(highlight_rects) < PREVIEW_MAX_HIGHLIGHT_BOXES
        ):
            highlight_color = PREVIEW_COLORS.get(rule.key, PREVIEW_PRIMARY_LINE)
            highlight_rects.append(
                _svg_highlight_rect(
                    entity_bbox,
                    max(width, height),
                    rule.type_name,
                    highlight_color,
                    index=len(highlight_rects) + 1,
                    rule_key=rule.key,
                )
            )
            emit_preview_progress(force=len(highlight_rects) == 1)
        color = PREVIEW_COLORS.get(rule.key, PREVIEW_PRIMARY_LINE) if rule else PREVIEW_SECONDARY_LINE
        opacity = "0.98" if rule else "0.62"
        try:
            if kind == "LINE":
                points = _points_from_entity(entity)
                if len(points) == 2:
                    add_path_command(color, opacity, _path_commands(points, False))
                    geometry_rendered += 1
            elif kind in {"LWPOLYLINE", "POLYLINE", "SPLINE", "ELLIPSE", "ARC"}:
                points = _preview_points(_points_from_entity(entity), max_points_per_entity)
                command = _path_commands(points, _is_closed(entity, points))
                if command:
                    add_path_command(color, opacity, command)
                    geometry_rendered += 1
            elif kind == "CIRCLE":
                center = entity.dxf.center
                parts.append(
                    f'<circle cx="{float(center.x):.2f}" cy="{-float(center.y):.2f}" '
                    f'r="{float(entity.dxf.radius):.2f}" fill="none" stroke="{color}" '
                    f'stroke-opacity="{opacity}" stroke-width="{stroke_width:.2f}" vector-effect="non-scaling-stroke" />'
                )
                geometry_rendered += 1
        except Exception:
            continue

    for (color, opacity), commands in path_commands_by_style.items():
        _append_path_chunk(parts, commands, color=color, stroke_width=stroke_width, opacity=opacity)

    emit_preview_progress(force=True)

    if highlight_rects:
        parts.append('<g class="dr-preview-highlights">')
        parts.extend(highlight_rects)
        parts.append("</g>")

    min_text_size = max(width, height) / 4200
    for entity, rule in sorted(items, key=lambda item: (0 if item[1] else 1, item[0].dxftype())):
        if text_rendered >= max_text_entities:
            break
        if entity.dxftype() not in {"TEXT", "MTEXT"}:
            continue
        entity_bbox = _bbox_from_points(_points_from_entity(entity))
        if not _should_render_preview_item(entity, rule, entity_bbox, bbox, view_area):
            skipped += 1
            continue
        text = html.escape(_normalize_annotation_text(_read_text(entity))[:80])
        if not text:
            continue
        try:
            insert = entity.dxf.insert
            raw_size = float(getattr(entity.dxf, "height", 250.0) or 250.0)
            size = max(raw_size, min_text_size)
            rotation = float(getattr(entity.dxf, "rotation", 0.0) or 0.0)
            transform = (
                f' transform="rotate({-rotation:.2f} {float(insert.x):.2f} {-float(insert.y):.2f})"'
                if abs(rotation) > 0.01 else ""
            )
            parts.append(
                f'<text x="{float(insert.x):.2f}" y="{-float(insert.y):.2f}"{transform} '
                f'font-family="Arial, Microsoft YaHei, sans-serif" font-size="{size:.2f}" '
                f'fill="{PREVIEW_TEXT_COLOR}" fill-opacity="0.92" paint-order="stroke" '
                f'stroke="#08111f" stroke-width="{max(size * 0.08, 0.6):.2f}" stroke-opacity="0.8">{text}</text>'
            )
            text_rendered += 1
        except Exception:
            continue

    rendered_total = geometry_rendered + text_rendered
    if len(items) > rendered_total + skipped:
        skipped += len(items) - rendered_total - skipped
    parts.append("</g></svg>")
    return sanitize_preview_svg("".join(parts))


def _unit_scale_to_m(doc: Any, bbox: tuple[float, float, float, float] | None) -> tuple[float, str]:
    try:
        insunits = int(doc.header.get("$INSUNITS", 0))
    except Exception:
        insunits = 0

    unit_map = {
        1: (0.0254, "英寸"),
        2: (0.3048, "英尺"),
        4: (0.001, "毫米"),
        5: (0.01, "厘米"),
        6: (1.0, "米"),
    }
    if insunits in unit_map:
        scale, label = unit_map[insunits]
        return scale, f"根据 CAD INSUNITS={insunits} 按{label}换算"

    if bbox is not None:
        span = max(bbox[2] - bbox[0], bbox[3] - bbox[1])
        if span > 10000:
            return 0.001, "图纸单位未声明，按常见建筑 CAD 毫米单位换算"
        if span > 1000:
            return 0.01, "图纸单位未声明，按厘米单位粗略换算"

    return 1.0, "图纸单位未声明，按米单位换算"


def _new_bucket(rule: ComponentRule) -> dict[str, Any]:
    return {
        "rule": rule,
        "entity_count": 0,
        "physical_count": 0,
        "virtual_entity_count": 0,
        "length_raw": 0.0,
        "area_raw": 0.0,
        "bbox": None,
        "layers": set(),
        "texts": [],
        "type_counts": Counter(),
        "size_samples": [],
    }


def _add_measurement(
    bucket: dict[str, Any],
    *,
    entity: Any,
    layer: str,
    length_raw: float,
    area_raw: float,
    bbox: tuple[float, float, float, float] | None,
    physical_count: int,
    virtual_count: int = 0,
) -> None:
    bucket["entity_count"] += 1
    bucket["physical_count"] += physical_count
    bucket["virtual_entity_count"] += virtual_count
    bucket["length_raw"] += length_raw
    bucket["area_raw"] += area_raw
    bucket["bbox"] = _merge_bbox(bucket["bbox"], bbox)
    bucket["layers"].add(layer)
    bucket["type_counts"][entity.dxftype()] += 1
    if bbox is not None and entity.dxftype() not in {"LINE", "INSERT", "TEXT", "MTEXT"}:
        width = bbox[2] - bbox[0]
        height = bbox[3] - bbox[1]
        if width > 0 and height > 0:
            bucket["size_samples"].append((width, height))
    text = _read_text(entity)
    if text:
        bucket["texts"].append(text)


def _analyze_insert(entity: Any, bucket: dict[str, Any]) -> None:
    inherited_layer = _layer(entity)
    virtuals = _iter_virtual_entities(entity)
    points: list[tuple[float, float]] = []
    length_raw = 0.0
    area_raw = 0.0
    texts: list[str] = []
    type_counts: Counter[str] = Counter()

    for virtual in virtuals:
        points.extend(_points_from_entity(virtual))
        length_raw += _entity_length_mm(virtual)
        area_raw += _entity_area_mm2(virtual)
        text = _read_text(virtual)
        if text:
            texts.append(text)
        type_counts[virtual.dxftype()] += 1

    bbox = _bbox_from_points(points)
    if bbox is not None:
        bucket["size_samples"].append((bbox[2] - bbox[0], bbox[3] - bbox[1]))
    rule: ComponentRule = bucket["rule"]
    if area_raw <= 0 and rule.key in {"column", "wall", "slab", "foundation", "stair", "door", "window"}:
        area_raw = _bbox_area_mm2(bbox)

    _add_measurement(
        bucket,
        entity=entity,
        layer=inherited_layer,
        length_raw=length_raw,
        area_raw=area_raw,
        bbox=bbox,
        physical_count=1,
        virtual_count=len(virtuals),
    )
    bucket["texts"].extend(texts)
    bucket["type_counts"].update(type_counts)


def _component_id(rule: ComponentRule, index: int) -> str:
    prefixes = {
        "column": "C",
        "beam": "B",
        "wall": "W",
        "slab": "S",
        "foundation": "F",
        "stair": "T",
        "door": "D",
        "window": "N",
        "rebar": "R",
        "fire_pipe": "FP",
        "fire_device": "FD",
        "plumbing_pipe": "P",
        "valve": "V",
        "sanitary_fixture": "SF",
        "electrical_conduit": "EC",
        "cable": "EL",
        "cable_tray": "TR",
        "electrical_device": "ED",
        "hvac_duct": "HD",
        "hvac_equipment": "HE",
    }
    return f"{prefixes.get(rule.key, rule.key[:1].upper())}-{index}"


def _default_material(rule: ComponentRule, spec: str) -> str:
    if rule.key == "rebar":
        return "HRB400"
    if rule.metric.endswith("volume"):
        return "C30混凝土"
    if rule.key in {"plumbing_pipe", "fire_pipe", "valve"}:
        upper = spec.upper()
        if "PPR" in upper:
            return "PPR"
        if "PVC" in upper or "UPVC" in upper:
            return "UPVC"
        if "PE" in upper or "HDPE" in upper:
            return "HDPE"
        return "综合管材"
    if rule.key in {"electrical_conduit", "cable", "cable_tray"}:
        return "综合电气材料"
    if rule.key == "hvac_duct":
        return "镀锌钢板"
    return ""


def _read_dxf_document(ezdxf: Any, tmp_path: str) -> tuple[Any, list[str]]:
    cleanup_diagnostics: list[str] = []
    if _normalize_dxf_text(tmp_path):
        cleanup_diagnostics.append("已标准化转换器生成的 DXF 文本。")
    try:
        return ezdxf.readfile(tmp_path), cleanup_diagnostics
    except Exception as exc:
        if "Invalid handle 0" in str(exc):
            removed = _remove_zero_handle_pairs(tmp_path)
            if removed:
                cleanup_diagnostics.append(f"已清理 {removed} 个转换器生成的非法 DXF 句柄。")
                try:
                    return ezdxf.readfile(tmp_path), cleanup_diagnostics
                except Exception:
                    pass

        from ezdxf import recover  # type: ignore
        doc, auditor = recover.readfile(tmp_path)
        diagnostics = [*cleanup_diagnostics, f"DXF 标准读取失败，已启用恢复模式：{exc}"]
        fixed_count = len(getattr(auditor, "fixes", []) or [])
        error_count = len(getattr(auditor, "errors", []) or [])
        if fixed_count:
            diagnostics.append(f"恢复模式已修复 {fixed_count} 个 DXF 结构问题。")
        if error_count:
            diagnostics.append(f"恢复模式仍发现 {error_count} 个 DXF 结构问题，预览和识别结果可能不完整。")
        return doc, diagnostics


def _remove_zero_handle_pairs(tmp_path: str) -> int:
    path = Path(tmp_path)
    raw = path.read_text(encoding="utf-8", errors="ignore")
    line_ending = "\r\n" if "\r\n" in raw else "\n"
    lines = raw.splitlines()
    cleaned: list[str] = []
    removed = 0
    i = 0
    while i < len(lines):
        is_handle_code = lines[i].strip() == "5" and len(lines[i].rstrip()) <= 3
        if i + 1 < len(lines) and is_handle_code and lines[i + 1].strip() == "0":
            removed += 1
            i += 2
            continue
        cleaned.append(lines[i])
        i += 1
    if removed:
        path.write_text(line_ending.join(cleaned) + line_ending, encoding="utf-8", errors="ignore")
    return removed


def _normalize_dxf_text(tmp_path: str) -> bool:
    path = Path(tmp_path)
    raw_bytes = path.read_bytes()
    normalized = raw_bytes.replace(b"\r\r\n", b"\r\n")
    raw = normalized.decode("utf-8", errors="ignore")
    lines = raw.splitlines()
    had_libredwg_comment = len(lines) >= 2 and lines[0].strip() == "999" and "libredwg" in lines[1].lower()
    if len(lines) >= 2 and lines[0].strip() == "999":
        lines = lines[2:]
    fixed_lines, fixed_subclasses = _repair_missing_subclass_group_codes(lines) if had_libredwg_comment else (lines, 0)
    if fixed_subclasses:
        lines = fixed_lines
    if fixed_subclasses or len(lines) >= 2:
        raw = "\r\n".join(lines) + "\r\n"
        normalized = raw.encode("utf-8")

    changed = normalized != raw_bytes
    if changed:
        path.write_bytes(normalized)
    return changed


def _repair_missing_subclass_group_codes(lines: list[str]) -> tuple[list[str], int]:
    fixed: list[str] = []
    repairs = 0
    for index, line in enumerate(lines):
        stripped = line.strip()
        previous = lines[index - 1].strip() if index > 0 else ""
        if stripped.startswith("AcDb") and previous.startswith("AcDb"):
            fixed.append("100")
            repairs += 1
        fixed.append(line)
    return fixed, repairs


def analyze_dxf_bytes(
    file_bytes: bytes,
    filename: str,
    progress_callback: DxfProgressCallback | None = None,
) -> dict[str, Any]:
    """Analyze DXF bytes and return components, BOQ suggestions, diagnostics, and preview SVG."""

    try:
        import ezdxf  # type: ignore
    except ImportError as exc:
        detail = str(exc) or exc.__class__.__name__
        return {
            "drawing_type": "unknown",
            "summary": "服务器未安装 ezdxf，无法解析 DXF 文件。请安装 ezdxf 后重试。",
            "components": [],
            "boq_suggestions": [],
            "preview_svg": "",
            "preview_svg_hd": "",
            "diagnostics": [f"缺少 DXF 解析依赖 ezdxf：{detail}"],
            "layer_summary": [],
            "error": "ezdxf_not_installed",
        }

    source_format = "DXF"
    conversion_diagnostics: list[str] = []
    if filename.lower().endswith(".dwg"):
        from app.services.dwg_conversion_service import convert_dwg_to_dxf_bytes

        _emit_analysis_progress(progress_callback, progress="正在转换 DWG 为 DXF...")
        conversion = convert_dwg_to_dxf_bytes(file_bytes, filename)
        conversion_diagnostics = conversion.diagnostics
        if conversion.error or conversion.dxf_bytes is None:
            return {
                "drawing_type": "CAD 图纸（DWG）",
                "summary": "DWG 需要先转换为 DXF 后解析，但当前本机转换未完成。",
                "components": [],
                "boq_suggestions": [],
                "preview_svg": "",
                "preview_svg_hd": "",
                "diagnostics": conversion_diagnostics,
                "layer_summary": [],
                "error": conversion.error or "dwg_conversion_failed",
            }
        file_bytes = conversion.dxf_bytes
        filename = f"{os.path.splitext(os.path.basename(filename))[0]}.dxf"
        source_format = "DWG"

    _emit_analysis_progress(progress_callback, progress="正在读取 CAD 文件...")
    with tempfile.NamedTemporaryFile(suffix=".dxf", delete=False) as tmp:
        tmp.write(file_bytes)
        tmp_path = tmp.name

    try:
        _emit_analysis_progress(progress_callback, progress="正在解析 CAD 图层和模型空间...")
        doc, recover_diagnostics = _read_dxf_document(ezdxf, tmp_path)
        msp = doc.modelspace()
        layer_names = [layer.dxf.name for layer in doc.layers]
        all_entities = list(msp)
        entity_total = len(all_entities)
        _emit_analysis_progress(
            progress_callback,
            progress=f"已读取 {entity_total} 个图元，正在分类构件...",
        )
        drawable_bbox = _collect_bbox(all_entities)
        header_scale, _ = _unit_scale_to_m(doc, drawable_bbox)

        annotation_texts = [
            " ".join(part for part in (_layer(e), _name(e), _read_text(e)) if part)
            for e in all_entities
            if e.dxftype() in {"TEXT", "MTEXT"} and _read_text(e)
        ]
        layer_entity_counts: Counter[str] = Counter(_layer(e) for e in all_entities)
        layer_type_counts: dict[str, Counter[str]] = {}
        for entity in all_entities:
            layer = _layer(entity)
            layer_type_counts.setdefault(layer, Counter())[entity.dxftype()] += 1

        stats: dict[str, dict[str, Any]] = {rule.key: _new_bucket(rule) for rule in COMPONENT_RULES}
        classified_entities = 0
        progress_step = max(200, entity_total // 8) if entity_total else 200

        for entity_index, entity in enumerate(all_entities, start=1):
            if entity_index == entity_total or entity_index % progress_step == 0:
                _emit_analysis_progress(
                    progress_callback,
                    progress=f"正在分类图元 {entity_index}/{entity_total}...",
                )
            layer = _layer(entity)
            rule = _classify_entity(entity)
            text = _read_text(entity)
            if rule is None and text:
                rule = _classify_annotation_rule(layer, _name(entity), text)
            if not rule:
                continue

            bucket = stats[rule.key]
            classified_entities += 1

            if entity.dxftype() == "INSERT":
                _analyze_insert(entity, bucket)
                continue

            if text:
                bucket["texts"].append(text)
                bucket["layers"].add(layer)
                bucket["entity_count"] += 1
                bucket["type_counts"][entity.dxftype()] += 1
                continue

            if _is_annotation_layer(layer):
                bucket["entity_count"] += 1
                bucket["layers"].add(layer)
                bucket["type_counts"][entity.dxftype()] += 1
                continue

            points = _points_from_entity(entity)
            bbox = _bbox_from_points(points)
            area_raw = _entity_area_mm2(entity)
            if area_raw <= 0 and entity.dxftype() == "HATCH":
                area_raw = _bbox_area_mm2(bbox)
            _add_measurement(
                bucket,
                entity=entity,
                layer=layer,
                length_raw=_entity_length_mm(entity),
                area_raw=area_raw,
                bbox=bbox,
                physical_count=1,
            )

        annotation_profile = _build_annotation_profile(annotation_texts)
        unit_scale, unit_note = _infer_unit_scale(doc, stats, header_scale)
        area_scale = unit_scale * unit_scale
        components: list[dict[str, Any]] = []
        suggestions: list[dict[str, Any]] = []
        diagnostics: list[str] = [*conversion_diagnostics, *recover_diagnostics, unit_note]
        if annotation_profile.story_height_m is not None:
            diagnostics.append(f"已从标注中识别层高 {annotation_profile.story_height_m:.2f}m")

        for index, rule in enumerate(COMPONENT_RULES, start=1):
            if index == 1 or index % 5 == 0 or index == len(COMPONENT_RULES):
                _emit_analysis_progress(
                    progress_callback,
                    progress=f"正在汇总构件 {index}/{len(COMPONENT_RULES)}...",
                )
            bucket = stats[rule.key]
            if bucket["entity_count"] == 0:
                continue

            length_m = bucket["length_raw"] * unit_scale
            area_m2 = bucket["area_raw"] * area_scale
            count = int(bucket["physical_count"] or bucket["entity_count"])
            spec = _extract_specs(
                bucket["texts"],
                rule,
                area_m2,
                count,
                annotation_profile=annotation_profile,
            )
            quantity, calc_note = _metric_quantity(
                rule,
                length_m=length_m,
                area_m2=area_m2,
                count=count,
                spec=spec,
                story_height_m=annotation_profile.story_height_m,
            )

            confidence = rule.confidence
            if count:
                confidence += 4
            if area_m2 > 0 or length_m > 0:
                confidence += 2
            if bucket["virtual_entity_count"]:
                confidence += 1
            if quantity <= 0 and rule.metric not in {"count", "area"}:
                confidence -= 10
            confidence = max(35.0, min(98.0, confidence))

            if quantity <= 0:
                diagnostics.append(f"{rule.type_name} 已识别但工程量为 0，通常是图层缺少闭合轮廓或尺寸标注。")
            layer_sample = sorted(bucket["layers"])
            component = {
                "id": _component_id(rule, index),
                "type": rule.type_name,
                "count": count,
                "spec": spec,
                "confidence": _round(confidence, 1),
                "material": _default_material(rule, spec),
                "unit": rule.unit,
                "quantity_estimate": quantity,
                "length_m": _round(length_m),
                "area_m2": _round(area_m2),
                "layers": layer_sample[:16],
                "calc_note": calc_note,
            }
            components.append(component)
            suggestions.append({
                "source_component_id": component["id"],
                "suggested_code": rule.code,
                "suggested_name": f"{rule.boq_name} {spec}".strip(),
                "suggested_unit": rule.unit,
                "suggested_quantity": quantity,
                "characteristics": (
                    f"构件类型: {rule.type_name}, 规格: {spec}; "
                    f"来源图层: {'、'.join(layer_sample[:6])}; {calc_note}"
                ),
                "confidence": component["confidence"],
                "material": component["material"],
                "component_count": count,
            })

        layer_summary = []
        for layer, count in layer_entity_counts.most_common(18):
            layer_rule = _classify_text(layer)
            layer_summary.append({
                "layer": layer,
                "count": count,
                "classified_as": layer_rule.type_name if layer_rule else "",
                "entity_types": dict(layer_type_counts.get(layer, Counter()).most_common(5)),
            })

        classified_ratio = classified_entities / max(len(all_entities), 1)
        if classified_ratio < 0.08:
            diagnostics.append("可识别图层占比较低，建议统一梁/柱/墙/板/门窗等图层命名或导出含构件语义的 DXF。")
        if any(e.dxftype() == "INSERT" for e in all_entities):
            diagnostics.append("已展开 CAD 图块参与识别，门窗、墙柱等块参照会计入结果。")
        if len(all_entities) > PREVIEW_MAX_RENDERED_ENTITIES:
            diagnostics.append("图纸预览提供流畅和高清两档，工程量统计仍按完整图元计算。")

        _emit_analysis_progress(progress_callback, progress="正在生成图纸预览并标记构件...")
        preview_svg = build_preview_svg(doc, progress_callback=progress_callback)
        _emit_analysis_progress(progress_callback, progress="正在生成高清预览...")
        preview_svg_hd = build_preview_svg(
            doc,
            max_entities=PREVIEW_HD_RENDERED_ENTITIES,
            max_points_per_entity=PREVIEW_HD_MAX_POINTS_PER_ENTITY,
            max_text_entities=PREVIEW_HD_TEXT_ENTITIES,
            shape_rendering="geometricPrecision",
            stroke_width=PREVIEW_HD_STROKE_WIDTH,
        )
        _emit_analysis_progress(progress_callback, progress="正在整理识别结果...")
        source_label = "DWG 已转换为 DXF 并解析完成" if source_format == "DWG" else "DXF 文件解析完成"
        summary = (
            f"{source_label}。共 {len(layer_names)} 个图层、{len(all_entities)} 个模型空间图元，"
            f"识别到 {len(components)} 类构件，提取文字标注 {len(annotation_texts)} 处。"
        )
        if not components:
            summary += " 未识别到结构构件，请检查图层命名是否包含梁、柱、墙、基础、钢筋、门窗等关键字。"

        # 专业自动检测
        disciplines = _detect_disciplines(layer_names, annotation_texts, components)
        if disciplines:
            disc_names = "、".join(d["name"] for d in disciplines[:4])
            summary += f" 检测到专业：{disc_names}。"

        # 整体质量评分
        quality_score = _compute_quality_score(
            components, len(all_entities), classified_entities, disciplines,
        )
        if quality_score.get("issues"):
            diagnostics.extend(quality_score["issues"])
        summary += f" 解析质量评级：{quality_score['level']} 级（{quality_score['score']} 分）。"

        return {
            "drawing_type": "CAD 图纸（DWG 已转 DXF）" if source_format == "DWG" else "CAD 图纸（DXF）",
            "summary": summary,
            "components": components,
            "boq_suggestions": suggestions,
            "preview_svg": preview_svg,
            "preview_svg_hd": preview_svg_hd,
            "diagnostics": diagnostics,
            "layer_summary": layer_summary,
            "disciplines": disciplines,
            "quality_score": quality_score,
            "error": None,
        }
    except Exception as exc:
        # 记录完整堆栈，避免丢失异常信息
        logger.exception("DXF 解析失败")
        return {
            "drawing_type": "unknown",
            "summary": "",
            "components": [],
            "boq_suggestions": [],
            "preview_svg": "",
            "preview_svg_hd": "",
            "diagnostics": [f"解析异常: {exc}"],
            "layer_summary": [],
            "disciplines": [],
            "quality_score": {"score": 0, "level": "F", "issues": ["解析异常"]},
            "error": f"DXF 解析失败: {exc}",
        }
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
