"""DXF drawing analysis and lightweight preview rendering."""

from __future__ import annotations

import html
import logging
import math
import os
import re
import tempfile
import threading
import time
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

_RULES_BY_KEY: dict[str, ComponentRule] = {rule.key: rule for rule in COMPONENT_RULES}

# 几何兜底识别的尺寸阈值（图纸单位：mm）。命名未命中时按形状推断构件类型。
GEO_COLUMN_SIDE_MIN, GEO_COLUMN_SIDE_MAX = 180.0, 1400.0      # 柱边长/直径范围
GEO_COLUMN_ASPECT_MAX = 2.0                                    # 柱截面宽高比上限
GEO_BEAM_ASPECT_MIN = 2.5                                      # 梁矩形长宽比下限
GEO_BEAM_THICK_MIN, GEO_BEAM_THICK_MAX = 180.0, 800.0          # 梁短边（梁宽）范围
GEO_DOOR_MIN, GEO_DOOR_MAX = 500.0, 2600.0                     # 门块长边范围
GEO_DOOR_SWEEP_MIN, GEO_DOOR_SWEEP_MAX = 40.0, 130.0           # 门扇圆弧扫角范围
GEO_WINDOW_MIN, GEO_WINDOW_MAX = 400.0, 4200.0                 # 窗块长边范围
GEO_WINDOW_MIN_LINES = 3                                       # 窗块内最少平行线数量
GEO_WINDOW_ANGLE_TOL = 18.0                                    # 平行线角度容差（度）
GEO_WINDOW_LENGTH_TOL = 0.65                                   # 平行线长度相近度下限

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
PREVIEW_MAX_RENDERED_ENTITIES = 7000
PREVIEW_HD_RENDERED_ENTITIES = 14000
# 收集上限与看图几何上限一致，保证底图原样完整
PREVIEW_COLLECTION_LIMIT = 80000
PREVIEW_MAX_POINTS_PER_ENTITY = 140
PREVIEW_HD_MAX_POINTS_PER_ENTITY = 160
PREVIEW_MAX_TEXT_ENTITIES = 260
PREVIEW_HD_TEXT_ENTITIES = 600
PREVIEW_PATH_CHUNK_LENGTH = 120000
PREVIEW_MAX_HIGHLIGHT_BOXES = 400
PREVIEW_HIGHLIGHT_RULES = frozenset(rule.key for rule in COMPONENT_RULES)

CANDIDATE_UNIT_SCALES: tuple[tuple[float, str], ...] = (
    (0.001, "毫米"),
    (0.01, "厘米"),
    (0.0254, "英寸"),
    (0.3048, "英尺"),
    (1.0, "米"),
)


def _clean_str(value: Any) -> str:
    """清洗实体字符串：中文图纸常含非 UTF-8 字节（GBK 等），ezdxf 读出后为
    代理字符（surrogate），会导致 JSON 序列化崩溃，统一替换为安全字符。"""
    try:
        return str(value).encode("utf-8", errors="replace").decode("utf-8")
    except Exception:
        return ""


def _read_text(entity: Any) -> str:
    try:
        if entity.dxftype() == "MTEXT":
            return _clean_str(entity.text).strip()
        return _clean_str(entity.dxf.text).strip()
    except Exception:
        return ""


def _layer(entity: Any) -> str:
    try:
        return _clean_str(entity.dxf.layer)
    except Exception:
        return ""


def _name(entity: Any) -> str:
    try:
        return _clean_str(entity.dxf.name)
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


def _insert_attrib_texts(entity: Any) -> list[str]:
    """读取 INSERT 块的属性值（ATTRIB）。门窗等块的型号/尺寸常存于此。"""
    texts: list[str] = []
    try:
        for attrib in entity.attribs:
            try:
                value = _clean_str(attrib.dxf.text).strip()
                if value:
                    texts.append(value)
            except Exception:
                continue
    except Exception:
        return []
    return texts


def _arc_sweep_deg(entity: Any) -> float:
    try:
        start = float(entity.dxf.start_angle)
        end = float(entity.dxf.end_angle)
        sweep = (end - start) % 360.0
        return 360.0 if sweep == 0.0 else sweep
    except Exception:
        return 0.0


def _segment_lines(entity: Any) -> list[tuple[tuple[float, float], tuple[float, float]]]:
    """把实体离散为线段序列 (起点, 终点)。"""
    kind = entity.dxftype()
    points = _points_from_entity(entity)
    segs: list[tuple[tuple[float, float], tuple[float, float]]] = []
    if kind == "ARC":
        if len(points) >= 2:
            segs.append((points[0], points[-1]))
            return segs
    for a, b in zip(points, points[1:]):
        if a != b:
            segs.append((a, b))
    return segs


def _line_angle_deg(seg: tuple[tuple[float, float], tuple[float, float]]) -> float:
    (x1, y1), (x2, y2) = seg
    return math.degrees(math.atan2(y2 - y1, x2 - x1)) % 180.0


def _angle_diff_deg(a: float, b: float) -> float:
    diff = abs(a - b) % 180.0
    return min(diff, 180.0 - diff)


def _window_line_signature(lines: list[tuple[tuple[float, float], tuple[float, float]]], long_side: float) -> bool:
    """窗的几何签名：存在一组 ≥3 条平行、横贯块长边的线。"""
    n = len(lines)
    lengths = [math.hypot(b[0] - a[0], b[1] - a[1]) for a, b in lines]
    for base in range(n):
        group = [base]
        for j in range(n):
            if j == base:
                continue
            if _angle_diff_deg(_line_angle_deg(lines[base]), _line_angle_deg(lines[j])) <= GEO_WINDOW_ANGLE_TOL:
                group.append(j)
        if len(group) >= GEO_WINDOW_MIN_LINES:
            ref = max(lengths[i] for i in group)
            if ref >= long_side * 0.5:
                return True
    return False


def _classify_insert_by_geometry(entity: Any) -> ComponentRule | None:
    """按 INSERT 块的几何组成推断门窗（命名未命中时兜底）。"""
    try:
        virtuals = _iter_virtual_entities(entity)
    except Exception:
        return None
    if not virtuals:
        return None

    try:
        bbox = _collect_bbox([entity])
    except Exception:
        return None
    if bbox is None:
        return None
    w = bbox[2] - bbox[0]
    h = bbox[3] - bbox[1]
    if w <= 0 or h <= 0:
        return None
    long_side = max(w, h)

    arcs = [v for v in virtuals if v.dxftype() == "ARC"]
    lines: list[tuple[tuple[float, float], tuple[float, float]]] = []
    for v in virtuals:
        if v.dxftype() == "LINE":
            lines.extend(_segment_lines(v))

    # 门：含近似 1/4 圆的圆弧（门扇摆动弧）
    if arcs and GEO_DOOR_MIN <= long_side <= GEO_DOOR_MAX:
        for arc in arcs:
            sweep = _arc_sweep_deg(arc)
            if GEO_DOOR_SWEEP_MIN <= sweep <= GEO_DOOR_SWEEP_MAX:
                return _RULES_BY_KEY.get("door")

    # 窗：块内多条近似平行、横贯块长边的线
    if len(lines) >= GEO_WINDOW_MIN_LINES and GEO_WINDOW_MIN <= long_side <= GEO_WINDOW_MAX:
        if _window_line_signature(lines, long_side):
            return _RULES_BY_KEY.get("window")

    return None


def _classify_closed_poly_by_geometry(entity: Any) -> ComponentRule | None:
    """按闭合轮廓的几何比例推断柱/梁（命名未命中时兜底）。"""
    try:
        points = _points_from_entity(entity)
    except Exception:
        return None
    if not _is_closed(entity, points) or len(points) < 4:
        return None
    bbox = _bbox_from_points(points)
    if bbox is None:
        return None
    w = bbox[2] - bbox[0]
    h = bbox[3] - bbox[1]
    if w <= 0 or h <= 0:
        return None
    shorter = min(w, h)
    longer = max(w, h)
    aspect = longer / shorter

    # 柱：接近方形、边长在柱截面范围
    if GEO_COLUMN_SIDE_MIN <= shorter and longer <= GEO_COLUMN_SIDE_MAX and aspect <= GEO_COLUMN_ASPECT_MAX:
        return _RULES_BY_KEY.get("column")

    # 梁：细长矩形、短边（梁宽）在范围内
    if aspect >= GEO_BEAM_ASPECT_MIN and GEO_BEAM_THICK_MIN <= shorter <= GEO_BEAM_THICK_MAX:
        return _RULES_BY_KEY.get("beam")

    return None


def _classify_by_geometry(entity: Any) -> ComponentRule | None:
    """几何兜底识别入口：命名/文字未命中时按图元形状推断构件类型。"""
    kind = entity.dxftype()
    try:
        if kind == "INSERT":
            return _classify_insert_by_geometry(entity)
        if kind == "CIRCLE":
            radius = float(entity.dxf.radius)
            if GEO_COLUMN_SIDE_MIN / 2 <= radius <= GEO_COLUMN_SIDE_MAX / 2:
                return _RULES_BY_KEY.get("column")
        if kind in {"LWPOLYLINE", "POLYLINE"}:
            return _classify_closed_poly_by_geometry(entity)
    except Exception:
        return None
    return None


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
    pts = " ".join(f"{x:.1f},{-y:.1f}" for x, y in points)
    tag = "polygon" if closed else "polyline"
    return (
        f'<{tag} points="{pts}" fill="none" stroke="{color}" '
        f'stroke-opacity="{opacity}" stroke-width="{stroke_width:.2f}" '
        'stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke" />'
    )


def _path_commands(points: list[tuple[float, float]], closed: bool) -> str:
    if len(points) < 2:
        return ""
    coords = " ".join(f"L{x:.1f},{-y:.1f}" for x, y in points[1:])
    close = " Z" if closed else ""
    return f"M{points[0][0]:.1f},{-points[0][1]:.1f} {coords}{close}"


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
    # 先收集逐实体 bbox，再按中心做 MAD 离群清洗：
    # DWG 转换器常产生坐标 1e96 级的垃圾图元，直接合并会把视口撑爆，
    # 前端 WebGL 归一化后真实图纸被压成一个点（黑屏/显示不全的根源）
    ent_boxes: list[tuple[Any, ComponentRule | None, tuple[float, float, float, float]]] = []
    for entity, rule in items:
        bbox = _bbox_from_points(_points_from_entity(entity))
        if bbox is not None:
            ent_boxes.append((entity, rule, bbox))
    if not ent_boxes:
        return None

    if len(ent_boxes) >= 8:
        def _mad(vals: list[float]) -> tuple[float, float]:
            m = sorted(vals)[len(vals) // 2]
            return m, sorted(abs(v - m) for v in vals)[len(vals) // 2]

        cx = [(b[0] + b[2]) / 2.0 for _, _, b in ent_boxes]
        cy = [(b[1] + b[3]) / 2.0 for _, _, b in ent_boxes]
        med_x, mad_x = _mad(cx)
        med_y, mad_y = _mad(cy)
        thresh_x = max(mad_x * 15.0, 1e-6)
        thresh_y = max(mad_y * 15.0, 1e-6)
        cleaned = [
            (entity, rule, bbox)
            for (entity, rule, bbox), x, y in zip(ent_boxes, cx, cy)
            if abs(x - med_x) <= thresh_x and abs(y - med_y) <= thresh_y
        ]
        if cleaned:
            ent_boxes = cleaned

    all_bbox: tuple[float, float, float, float] | None = None
    line_bbox: tuple[float, float, float, float] | None = None
    classified_line_bbox: tuple[float, float, float, float] | None = None

    for entity, rule, bbox in ent_boxes:
        kind = entity.dxftype()
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


CAD_GEOMETRY_MAX_ENTITIES = 80000
CAD_GEOMETRY_MAX_POINTS = 400
CAD_GEOMETRY_MAX_HIGHLIGHTS = 2500
CAD_GEOMETRY_MAX_TEXTS = 800
# 线段总量上限：WebGL 一次 draw call 足够流畅，超出即截断，避免超大图纸导出过慢
CAD_GEOMETRY_MAX_SEGMENTS = 800000
# 导出耗时兜底：后台线程异步导出，预算放宽，尽量原样完整呈现图纸
CAD_GEOMETRY_TIME_BUDGET_SECONDS = 30.0


# AutoCAD 标准 ACI 色号 → RGB（覆盖常用前 40 号，其余回退白/灰）
_ACI_COLORS: dict[int, int] = {
    1: 0xFF0000, 2: 0xFFFF00, 3: 0x00FF00, 4: 0x00FFFF, 5: 0x0000FF,
    6: 0xFF00FF, 7: 0xFFFFFF, 8: 0x808080, 9: 0xC0C0C0, 10: 0xFF0000,
    30: 0xFF7F00, 40: 0xFFAA00, 41: 0xFFBFFF, 42: 0xFFD4AA, 43: 0xFFEAAA,
    50: 0xBFAF7F, 60: 0x9F7F5F, 70: 0x7F5F3F, 80: 0xBF9F7F, 90: 0x9F7F5F,
    110: 0xFF7F7F, 120: 0xFF007F, 130: 0xFF7FFF, 140: 0xFF00BF, 150: 0xBF00BF,
    170: 0xBF7F7F, 180: 0xAF6F5F, 190: 0xFF9F7F, 200: 0xBF9F9F, 210: 0xFF0000,
    220: 0x7F3F00, 230: 0xFFBF7F, 240: 0x9F5F2F, 250: 0x5F3F1F,
}


def _layer_color_map(doc: Any) -> dict[str, int]:
    """图层名 → RGB 整数，供实体按图层取原色。"""
    colors: dict[str, int] = {}
    try:
        for layer in doc.layers:
            try:
                name = _clean_str(layer.dxf.name)
                true_color = int(getattr(layer.dxf, "true_color", -1) or -1)
                aci = int(getattr(layer.dxf, "color", 7) or 7)
                colors[name] = _resolve_dxf_color(true_color, aci)
            except Exception:
                continue
    except Exception:
        pass
    return colors


def _resolve_dxf_color(true_color: int, aci: int) -> int:
    """实体/图层颜色 → RGB 整数。

    true_color 传 -1 表示属性不存在；0 是合法的纯黑真彩色。
    返回 -1 表示 BYLAYER，由调用方按图层色解析。
    """
    if true_color >= 0:
        return true_color & 0xFFFFFF
    if aci == 256:  # BYLAYER
        return -1
    if aci == 0:  # BYBLOCK：继承块引用颜色，此处按白处理
        return 0xFFFFFF
    return _ACI_COLORS.get(aci, 0xFFFFFF)


def _entity_color_hex(entity: Any, layer_colors: dict[str, int]) -> str:
    """实体原色：优先 true_color，其次 ACI 色号，最后图层色，回退白色。"""
    try:
        true_color = int(getattr(entity.dxf, "true_color", -1) or -1)
        aci = int(getattr(entity.dxf, "color", 256) or 256)
        rgb = _resolve_dxf_color(true_color, aci)
        if rgb == -1:  # BYLAYER：取图层色
            rgb = layer_colors.get(_layer(entity), 0xFFFFFF)
        # 黑底看图：纯黑线条提亮为深灰，避免看不见
        if rgb == 0x000000:
            rgb = 0x9AA7B8
        return f"#{rgb:06x}"
    except Exception:
        return "#ffffff"


def build_cad_raster(
    doc: Any,
    max_dim: int = 4200,
    progress_callback: DxfProgressCallback | None = None,
    skip_hatch: bool = False,
) -> dict[str, Any] | None:
    """用 ezdxf 官方绘图引擎把整个模型空间渲染成一张高清 PNG（黑底原色）。

    与自研重画不同：尺寸标注、块、填充、文字、线宽等全部图元按图面原样呈现，
    前端平铺显示该位图，等效于 CAD 快速看图的完整原样显示。渲染较重，
    只在后台分析线程内调用；失败时返回 None，前端回退到 WebGL 几何模式。

    skip_hatch=True 为快速看图模式：跳过 HATCH 填充（大图上每个填充
    最多可耗时 30s，是渲染慢的主因），只画线条/文字/标注，配合较低
    分辨率可在秒级出图，让用户先看图、高清原图后台继续渲染。
    """

    try:
        import base64
        import io

        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        from ezdxf.addons.drawing import Frontend, RenderContext
        from ezdxf.addons.drawing.config import BackgroundPolicy, Configuration
        from ezdxf.addons.drawing.matplotlib import MatplotlibBackend
    except Exception as exc:
        logger.warning("CAD 高清渲染不可用（matplotlib 后端缺失）：%s", exc)
        return None

    # 中文标注字体：优先微软雅黑/黑体/宋体，避免中文文字渲染成方框
    plt.rcParams["font.sans-serif"] = ["Microsoft YaHei", "SimHei", "SimSun", "DejaVu Sans"]
    plt.rcParams["axes.unicode_minus"] = False

    # ezdxf 在加载海量虚拟图元（如 DWG 转出的不可见 ATTRIB）时会逐条打 INFO 日志，
    # 数万条日志刷屏显著拖慢渲染，这里临时压制，渲染结束后恢复
    import logging as _logging

    _ezdxf_log = _logging.getLogger("ezdxf")
    _ezdxf_prev_level = _ezdxf_log.level
    _ezdxf_log.setLevel(_logging.ERROR)

    _t0 = time.perf_counter()

    # ---- 渲染前：近黑实体临时提亮为白（渲染后恢复）----
    # DWG 转 DXF 的转换器常把"白/黑自适应"的 ACI 7 转成真彩色纯黑，
    # 黑底渲染时黑线不可见导致整图漆黑，这里按 CAD 快速看图的惯例提亮近黑实体
    brightened: list[tuple[Any, bool, int]] = []
    try:
        from ezdxf import bbox as ez_bbox

        # ---- 图层强制全开：LibreDWG 转出的 DXF 常把全部图层标记为 off，
        # FastLayout 渲染引擎会跳过不可见图层的所有实体导致画面空白。
        # 本函数是分析管线最后一步，doc 之后不再使用，无需恢复
        layers_forced = 0
        for layer in doc.layers:
            try:
                if layer.is_off():
                    layer.on()
                    layers_forced += 1
                if layer.is_frozen():
                    layer.thaw()
                    layers_forced += 1
            except Exception:
                continue
        logger.info("CAD 渲染诊断：强制打开图层 %s 个", layers_forced)

        # ---- 离群图元剔除：垃圾实体坐落在极远坐标，会把渲染视口撑爆，
        # 主体内容被压缩成像素级，视觉上整图漆黑。按实体中心做 MAD 过滤，
        # 只剔除中心位置远离主体群的图元（本函数是分析管线最后一步，
        # doc 之后不再使用，destroy 是安全的）
        msp_dbg = doc.modelspace()
        entities = list(msp_dbg)

        def _center_of(ext: Any) -> tuple[float, float] | None:
            """兼容不同 ezdxf 版本 extents(fast=True) 的返回形态。"""
            try:
                if hasattr(ext, "has_data"):
                    if not ext.has_data:
                        return None
                    emin, emax = ext.extmin, ext.extmax
                elif hasattr(ext, "extmin") and hasattr(ext, "extmax"):
                    emin, emax = ext.extmin, ext.extmax
                elif len(ext) >= 3:
                    return (float(ext[0]), float(ext[1]))
                else:
                    return None
                return ((emin[0] + emax[0]) / 2.0, (emin[1] + emax[1]) / 2.0)
            except Exception:
                return None

        # 逐实体计算中心：bbox.extents() 传列表返回的是整体包围盒而非逐实体包围盒，
        # 旧写法 zip(entities, 整体bbox) 只得到 2 对假数据，MAD 过滤从未生效，
        # 垃圾图元（坐标 1e97 级）因此漏剔，把渲染视口/figsize 撑爆成全黑
        centers: list[tuple[float, float] | None] = []
        for ent in entities:
            c: tuple[float, float] | None = None
            try:
                c = _center_of(ez_bbox.extents([ent], fast=True))
            except Exception:
                c = None
            if c is None and ent.dxf.hasattr("insert"):  # INSERT：用插入点近似
                try:
                    c = (float(ent.dxf.insert[0]), float(ent.dxf.insert[1]))
                except Exception:
                    c = None
            centers.append(c)

        def _mad(vals: list[float]) -> tuple[float, float]:
            m = sorted(vals)[len(vals) // 2]
            return m, sorted(abs(v - m) for v in vals)[len(vals) // 2]

        cx = [c[0] for c in centers if c is not None]
        cy = [c[1] for c in centers if c is not None]
        outlier_count = 0
        if len(cx) >= 4 and len(cy) >= 4:
            med_x, mad_x = _mad(cx)
            med_y, mad_y = _mad(cy)
            thresh_x = max(mad_x * 15.0, 1e-6)
            thresh_y = max(mad_y * 15.0, 1e-6)
            for ent, c in zip(entities, centers):
                if c is None:
                    continue  # 无几何信息的实体不参与剔除
                x, y = c
                if abs(x - med_x) > thresh_x or abs(y - med_y) > thresh_y:
                    try:
                        ent.destroy()
                        outlier_count += 1
                    except Exception:
                        pass
        logger.info(
            "CAD 渲染诊断：顶层图元 %s 个，离群剔除 %s 个（视口保护）",
            len(entities),
            outlier_count,
        )

        _render_ext: Any = None
        try:
            # 必须用全精度 extents：fast 模式会把垃圾图元的异常坐标
            # （如 1e97）算进包围盒，导致 figsize 退化、整图渲染成黑图
            _render_ext = ez_bbox.extents(doc.modelspace())
            logger.info("CAD 渲染诊断：剔除后模型空间范围 extents=%s", _render_ext)
        except Exception:
            logger.info(
                "CAD 渲染诊断：模型空间范围计算失败（header %s / %s）",
                doc.header.get("$EXTMIN"),
                doc.header.get("$EXTMAX"),
            )

        layer_colors = _layer_color_map(doc)

        def _raw_rgb(ent: Any) -> int:
            """实体最终渲染色。true_color 属性存在即为有效（0=纯黑），
            否则按 ACI（BYLAYER 取图层色），与 ezdxf 渲染引擎语义一致。"""
            try:
                if ent.dxf.hasattr("true_color"):
                    return int(ent.dxf.true_color) & 0xFFFFFF
                aci = int(getattr(ent.dxf, "color", 256) or 256)
                if aci == 256:  # BYLAYER
                    return layer_colors.get(_layer(ent), 0xFFFFFF)
                if aci == 0:  # BYBLOCK
                    return 0xFFFFFF
                return _ACI_COLORS.get(aci, 0xFFFFFF)
            except Exception:
                return 0xFFFFFF

        black_count = 0
        entity_total = 0
        for block in doc.blocks:
            for ent in block:
                entity_total += 1
                try:
                    rgb = _raw_rgb(ent)
                    if max((rgb >> 16) & 255, (rgb >> 8) & 255, rgb & 255) < 70:
                        black_count += 1
                        had = ent.dxf.hasattr("true_color")
                        orig = int(ent.dxf.true_color) if had else 0
                        brightened.append((ent, had, orig))
                        ent.dxf.true_color = 0xFFFFFF
                except Exception:
                    continue
        logger.info("CAD 渲染诊断：块表实体 %s 个，近黑提亮 %s 个", entity_total, black_count)

        # ---- 空文字实体剔除：DWG 转换器产生大量无内容 TEXT/MTEXT/ATTRIB/ATTDEF，
        # 画面不可见但字体测量开销极大，是大图渲染慢的主因之一；移除后视觉零差别。
        # 本函数是分析管线最后一步，doc 之后不再使用，destroy 是安全的
        _containers = [doc.modelspace()]
        _containers.extend(blk for blk in doc.blocks if not str(blk.name).startswith("*"))
        _empty_text_removed = 0
        for _container in _containers:
            for _ent in list(_container):
                _t = _ent.dxftype()
                try:
                    if _t in ("TEXT", "ATTRIB", "ATTDEF"):
                        # 同时检查 text2（对齐文本），避免误删有内容的实体
                        if not str(_ent.dxf.get("text", "")).strip() and not str(_ent.dxf.get("text2", "")).strip():
                            _ent.destroy()
                            _empty_text_removed += 1
                    elif _t == "MTEXT":
                        if not str(_ent.text).strip():
                            _ent.destroy()
                            _empty_text_removed += 1
                except Exception:
                    continue
        logger.info("CAD 渲染诊断：剔除空文字实体 %s 个", _empty_text_removed)
    except Exception as exc:
        logger.warning("CAD 渲染诊断失败（不影响渲染）：%s", exc)

    try:
        msp = doc.modelspace()
        _t_pre = time.perf_counter()
        # 输出分辨率按图纸长宽比自适应：长边由 max_dim 控制（默认 4200px）。
        # 分辨率越高放大越清晰，代价是 PNG 体积与光栅化耗时增加
        _raster_max_dim = max_dim
        _fw, _fh = 10.0, 7.5
        try:
            if _render_ext is not None and _render_ext.has_data:
                _emin, _emax = _render_ext.extmin, _render_ext.extmax
                _ew = float(_emax[0] - _emin[0])
                _eh = float(_emax[1] - _emin[1])
                if _ew > 0 and _eh > 0:
                    _aspect = _ew / _eh
                    # 钳制长宽比：垃圾图元（异常坐标）可能把比例撑到天文数字，
                    # 不钳制会把 figsize 的高度压成 0 导致整图渲染失败/全黑
                    _aspect = min(max(_aspect, 0.2), 20.0)
                    if _aspect > _fw / _fh:
                        _fh = _fw / _aspect
                    else:
                        _fw = _fh * _aspect
        except Exception:
            pass
        _raster_dpi = _raster_max_dim / max(_fw, _fh)
        fig = plt.figure(figsize=(_fw, _fh))
        ax = fig.add_axes([0, 0, 1, 1])
        ctx = RenderContext(doc)
        config = Configuration(background_policy=BackgroundPolicy.BLACK)
        # adjust_figure=False：阻止 ezdxf finalize 时按默认 rcParams 尺寸
        # (6.43x4.8 inch) 覆盖我们按 _raster_max_dim 计算的 figsize，
        # 否则输出像素会被锁死在约 2700px，放大后图纸文字依然模糊
        _emit_analysis_progress(progress_callback, progress="高清预览·准备...")
        _hatch_filter = (lambda e: e.dxftype() != "HATCH") if skip_hatch else None
        _draw_total = max(len(msp), 1)

        class _TolerantFrontend(Frontend):
            """逐图元容错：DWG 转换器常产生个别损坏图元（如样条边界 knot 数
            不匹配的 HATCH），一个坏图元的异常不应毁掉整图渲染，跳过即可。"""

            def __init__(self, *args: Any, **kwargs: Any) -> None:
                super().__init__(*args, **kwargs)
                self._drawn = 0

            def draw_entity(self, entity: Any, properties: Any) -> None:
                try:
                    super().draw_entity(entity, properties)
                except Exception:
                    pass
                # 大图绘制耗时数分钟：按图元数插值心跳上报（61%~76%）。
                # 块参照会让 draw_entity 调用数达到实体数的数倍，用渐近曲线
                # （drawn 越多越慢逼近 76）避免百分比提前锁死；完成后跳到 78
                self._drawn += 1
                if self._drawn % 300 == 0:
                    _frac = 1 - _draw_total / (_draw_total + self._drawn)
                    _pct = min(61 + int(16 * _frac), 76)
                    _emit_analysis_progress(
                        progress_callback,
                        progress=f"正在绘制高清预览图元 {self._drawn}...",
                        progress_percent=_pct,
                    )

        _TolerantFrontend(ctx, MatplotlibBackend(ax, adjust_figure=False), config=config).draw_layout(
            msp, finalize=True, filter_func=_hatch_filter,
        )
        _t_draw = time.perf_counter()
        _emit_analysis_progress(progress_callback, progress="高清预览·绘制...")
        buf = io.BytesIO()
        # 不启用 bbox_inches="tight"：ax 占满 figure，直接按 figsize*dpi 输出像素，
        # 保证长边严格等于 _raster_max_dim，前端放大时清晰度可控。
        # 先输出未压缩 RGBA（matplotlib 内置 PNG 编码比 PIL 慢），再交给 PIL 编码 PNG
        fig.savefig(
            buf,
            format="raw",
            dpi=_raster_dpi,
            facecolor="black",
            pad_inches=0,
        )
        _t_save = time.perf_counter()
        # PNG 编码大位图也需数秒：报一次心跳避免进度停在"绘制"不动
        _emit_analysis_progress(progress_callback, progress="正在编码高清预览 PNG...",
                                progress_percent=82)
        try:
            import PIL.Image as _PILImage

            _fw_act, _fh_act = fig.get_size_inches()
            _raw_w = int(round(_fw_act * _raster_dpi))
            _raw_h = int(round(_fh_act * _raster_dpi))
            _img_rgba = _PILImage.frombuffer(
                "RGBA", (_raw_w, _raw_h), buf.getvalue(), "raw", "RGBA", 0, 1
            )
            _out = io.BytesIO()
            _img_rgba.convert("RGB").save(_out, format="PNG")
            buf = _out
        except Exception:
            # RGBA 尺寸推算偏差兜底：退回 matplotlib 自带 PNG 编码（figure 尚未关闭）
            buf = io.BytesIO()
            fig.savefig(buf, format="png", dpi=_raster_dpi, facecolor="black", pad_inches=0)
        plt.close(fig)
        _emit_analysis_progress(progress_callback, progress="高清预览·输出...")
        logger.info("CAD 渲染计时：准备 %.1fs，绘制图元 %.1fs，输出 PNG %.1fs",
                    _t_pre - _t0, _t_draw - _t_pre, _t_save - _t_draw)
    except Exception as exc:
        logger.exception("CAD 高清渲染失败")
        try:
            plt.close("all")
        except Exception:
            pass
        _ezdxf_log.setLevel(_ezdxf_prev_level)
        return None
    finally:
        for ent, had, orig in brightened:
            try:
                if had:
                    ent.dxf.true_color = orig
                else:
                    ent.dxf.discard("true_color")
            except Exception:
                pass

    _ezdxf_log.setLevel(_ezdxf_prev_level)
    png_bytes = buf.getvalue()
    width = 0
    height = 0
    try:
        import PIL.Image

        image = PIL.Image.open(io.BytesIO(png_bytes))
        width, height = image.size
        try:
            px = image.load()
            step = 8
            sampled = 0
            lit = 0
            for y in range(0, height, step):
                for x in range(0, width, step):
                    p = px[x, y]
                    sampled += 1
                    if max(p[0], p[1], p[2]) > 8:
                        lit += 1
            logger.info(
                "CAD 渲染诊断：PNG %sx%s，采样非黑像素占比 %.1f%%",
                width, height, 100.0 * lit / max(sampled, 1),
            )
        except Exception:
            pass
        longest = max(width, height)
        if longest > max_dim:
            scale = max_dim / longest
            image = image.resize((round(width * scale), round(height * scale)), PIL.Image.LANCZOS)
            width, height = image.size
            out = io.BytesIO()
            image.save(out, format="PNG")
            png_bytes = out.getvalue()
    except Exception:
        png_bytes = buf.getvalue()

    data_url = "data:image/png;base64," + base64.b64encode(png_bytes).decode("ascii")
    return {"data_url": data_url, "width": width, "height": height}


def build_cad_geometry(
    doc: Any,
    items: list[tuple[Any, ComponentRule | None]] | None = None,
    bbox: tuple[float, float, float, float] | None = None,
) -> dict[str, Any]:
    """导出紧凑折线几何（整数化坐标），供前端 WebGL CAD 看图组件渲染。

    与 SVG 预览不同：不设苛刻图元上限（GPU 一次 draw call 渲染全部线条），
    坐标放大 10 倍取整以压缩传输体积，前端再除回。
    items/bbox 可由调用方预收集复用，避免重复遍历全图（大图重复遍历是解析卡顿主因）。
    """

    if items is None:
        items = _iter_preview_items(doc.modelspace(), CAD_GEOMETRY_MAX_ENTITIES)
    if bbox is None:
        bbox = _preview_bbox(items)
    if bbox is None:
        return {"bbox": None, "groups": {}, "highlights": [], "texts": []}

    layer_colors = _layer_color_map(doc)
    min_x, min_y, max_x, max_y = bbox

    groups: dict[str, list[int]] = {}
    highlights: list[list[float]] = []
    texts: list[list] = []
    rendered = 0
    total_segments = 0
    started = time.perf_counter()

    for entity, rule in items:
        kind = entity.dxftype()
        if kind in {"TEXT", "MTEXT"}:
            if len(texts) < CAD_GEOMETRY_MAX_TEXTS:
                try:
                    txt = _read_text(entity)
                    pos = entity.dxf.insert if kind == "TEXT" else getattr(entity.dxf, "insert", None)
                    if txt and pos is not None:
                        size = float(getattr(entity.dxf, "height", 0) or 0)
                        texts.append([
                            round(float(pos.x) * 10),
                            round(-float(pos.y) * 10),
                            round(size * 10, 1),
                            txt[:60],
                        ])
                except Exception:
                    continue
            continue
        # 三重兜底：图元数 / 线段总量 / 耗时预算，任一超限立即截断
        if rendered >= CAD_GEOMETRY_MAX_ENTITIES or total_segments >= CAD_GEOMETRY_MAX_SEGMENTS:
            break
        if rendered % 256 == 0 and time.perf_counter() - started > CAD_GEOMETRY_TIME_BUDGET_SECONDS:
            logger.warning("CAD 看图几何导出超过 %.0fs 预算，截断于 %d 个图元", CAD_GEOMETRY_TIME_BUDGET_SECONDS, rendered)
            break
        # 原样呈现：不做图元过滤，图纸里有什么就画什么
        try:
            points = _points_from_entity(entity)
        except Exception:
            continue
        if len(points) < 2:
            if kind == "CIRCLE":
                try:
                    center = entity.dxf.center
                    radius = float(entity.dxf.radius)
                    segs = 32
                    points = [
                        (float(center.x) + radius * math.cos(2 * math.pi * i / segs),
                         float(center.y) + radius * math.sin(2 * math.pi * i / segs))
                        for i in range(segs + 1)
                    ]
                except Exception:
                    continue
            else:
                continue
        entity_bbox = _bbox_from_points(points)
        points = _preview_points(points, CAD_GEOMETRY_MAX_POINTS)
        seg_count = max(0, len(points) - 1)
        if seg_count < 1 or total_segments + seg_count > CAD_GEOMETRY_MAX_SEGMENTS:
            continue
        rendered += 1
        total_segments += seg_count
        # 按 CAD 原色分组（与 CAD 快速看图一致：图层/实体原色）
        color_key = _entity_color_hex(entity, layer_colors)
        flat = groups.setdefault(color_key, [])
        prev = None
        for x, y in points:
            cur = (round(x * 10), round(-y * 10))
            # 折线展开为线段序列：每对相邻点输出一段 (prev, cur)
            if prev is not None and cur != prev:
                flat.extend(prev)
                flat.extend(cur)
            prev = cur
        if (
            rule is not None
            and rule.key in PREVIEW_HIGHLIGHT_RULES
            and entity_bbox is not None
            and len(highlights) < CAD_GEOMETRY_MAX_HIGHLIGHTS
        ):
            x1, y1, x2, y2 = entity_bbox
            highlights.append([
                round(x1 * 10), round(-y2 * 10), round(x2 * 10), round(-y1 * 10), rule.key,
            ])

    return {
        "bbox": [round(v * 10) for v in (min_x, -max_y, max_x, -min_y)],
        "groups": {k: v for k, v in groups.items() if v},
        "highlights": highlights,
        "texts": texts,
    }


def build_preview_svg(
    doc: Any,
    max_entities: int = PREVIEW_MAX_RENDERED_ENTITIES,
    *,
    max_points_per_entity: int = PREVIEW_MAX_POINTS_PER_ENTITY,
    max_text_entities: int = PREVIEW_MAX_TEXT_ENTITIES,
    shape_rendering: str = "geometricPrecision",
    stroke_width: float = PREVIEW_SCREEN_STROKE_WIDTH,
    progress_callback: DxfProgressCallback | None = None,
    items: list[tuple[Any, ComponentRule | None]] | None = None,
    bbox: tuple[float, float, float, float] | None = None,
) -> str:
    """Render a clean CAD-style line preview without depending on heavy CAD renderers."""

    if items is None:
        items = _iter_preview_items(doc.modelspace(), max(max_entities, PREVIEW_COLLECTION_LIMIT))
    if bbox is None:
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
    # 块属性（ATTRIB）常存门窗型号/尺寸，先并入 texts 供规格提取
    texts: list[str] = _insert_attrib_texts(entity)
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


def _safe_entity_list(msp: Any) -> tuple[list[Any], list[str]]:
    """加载模型空间所有实体，并把"加载即抛错"的个体隔离开。

    转换器（libredwg 等）生成的 DXF 可能含结构异常实体，例如 MTEXT 扩展数据里
    非法的列类型值会让 ezdxf 在惰性加载该实体时抛出
    "N is not a valid ColumnType"。这里逐个实体触发加载并捕获异常，
    返回 (正常实体列表, 被跳过的实体说明)，保证后续遍历不会因单个坏实体中断。
    """
    entities: list[Any] = []
    skipped: list[str] = []
    for entity in msp:
        try:
            _ = entity.dxftype()
            entities.append(entity)
        except Exception as exc:
            message = str(exc)
            if "not a valid" in message:
                skipped.append("已跳过 1 个带异常属性的图元（MTEXT 列类型失效），不影响其余图元。")
            else:
                skipped.append(
                    f"已跳过 1 个异常图元（{entity.__class__.__name__}）：{message}"
                )
    return entities, skipped


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


_BINARY_DXF_SIGNATURE = b"AutoCAD Binary DXF\r\n\x1a\x00"


def _normalize_dxf_text(tmp_path: str) -> bool:
    path = Path(tmp_path)
    raw_bytes = path.read_bytes()
    # 二进制 DXF（以 "AutoCAD Binary DXF\r\n\x1a\x00" 开头）内部是二进制编码的
    # 实数/句柄/PROXY 数据，绝不能按文本方式解码后回写，否则数据会被破坏，
    # 导致 ezdxf 读取时抛出 "invalid binary data near line: ..."。跳过文本清洗，
    # 直接交给 ezdxf 按二进制格式解析。
    if raw_bytes.startswith(_BINARY_DXF_SIGNATURE):
        return False
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
    async_raster: bool = False,
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
            "cad_geometry": {"bbox": None, "groups": {}, "highlights": [], "texts": []},
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
                "cad_geometry": {"bbox": None, "groups": {}, "highlights": [], "texts": []},
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
        all_entities, skipped_entities = _safe_entity_list(msp)
        layer_names = [_clean_str(layer.dxf.name) for layer in doc.layers]

        # 优化：几何快速看图提前到管线最前——导出线条几何（约十余秒，GPU 渲染），
        # 前端 WebGL 立即看图；高清原图（matplotlib 全量渲染，大图需数分钟）
        # 在构件分析之后渲染，完成后前端自动替换为原样高清图
        _emit_analysis_progress(progress_callback, progress="正在收集图纸图元...")
        # 先把模型空间实体全部"热身"（触发惰性加载）并逐实体隔离：
        # 转换器生成的 DXF 可能含个别加载即抛错的实体（如 MTEXT 非法列类型），
        # 提前滤除，避免后续所有遍历（快速看图、标注、分类）被一个坏实体打断。
        preview_items = _iter_preview_items(all_entities, PREVIEW_COLLECTION_LIMIT)
        preview_bbox = _preview_bbox(preview_items)
        _emit_analysis_progress(progress_callback, progress="正在生成快速看图几何...")
        cad_geometry = build_cad_geometry(doc, items=preview_items, bbox=preview_bbox)
        if cad_geometry.get("bbox") is not None:
            _emit_analysis_progress(
                progress_callback,
                progress="快速看图已就绪，正在识别构件（高清原图后台渲染中）...",
                cad_geometry=cad_geometry,
            )

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
            if rule is None:
                rule = _classify_by_geometry(entity)
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
        diagnostics.extend(skipped_entities)
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

        # 高清原图渲染（大图数分钟）：几何快速看图已在前端显示。
        # 默认同步渲染（async_raster=False，测试/小图保持原行为）；
        # async_raster=True 时放入后台 daemon 线程，解析主流程先行返回
        # （构件识别/几何/计价均已完成），高清原图渲染完成后经
        # progress_callback 推送 cad_raster，前端无缝替换。
        # 渲染内置的离群剔除/提亮/清理会修改 doc，必须放在构件分析之后
        cad_raster: dict[str, Any] | None = None

        def _render_raster_worker() -> None:
            try:
                raster = build_cad_raster(doc, progress_callback=progress_callback)
            except Exception:
                logger.exception("CAD 后台高清渲染异常")
                raster = None
            if raster and progress_callback:
                try:
                    progress_callback({
                        "progress": "高清原图已生成，正在替换为原样高清图...",
                        "cad_raster": raster,
                    })
                except Exception:
                    pass
            elif progress_callback:
                try:
                    progress_callback({"progress": "高清原图渲染失败，保持快速看图模式"})
                except Exception:
                    pass

        if async_raster:
            # 非 daemon：子进程在 analyze 返回后仍保持存活，等待本线程
            # 渲染完（期间持续经 progress 回调推送 cad_raster）再退出，
            # 父进程可继续接收后台高清图。
            threading.Thread(
                target=_render_raster_worker, daemon=False, name="cad-raster-bg"
            ).start()
            _emit_analysis_progress(
                progress_callback,
                progress="正在后台渲染 CAD 原图高清预览，可先查看识别结果...",
            )
        else:
            _emit_analysis_progress(
                progress_callback,
                progress="正在渲染 CAD 原图高清预览（大图纸需数分钟，请勿关窗）...",
            )
            cad_raster = build_cad_raster(doc, progress_callback=progress_callback)
            if cad_raster:
                _emit_analysis_progress(
                    progress_callback,
                    progress="高清原图已生成，正在整理识别结果...",
                    cad_raster=cad_raster,
                )

        # 预览通道优先级：栅格原图 > WebGL 几何 > SVG 矢量。
        # 前两者其一可用即跳过 SVG（大图两轮图元展开+序列化耗时可观）
        if cad_raster is not None or cad_geometry.get("bbox") is not None:
            preview_svg = ""
            preview_svg_hd = ""
            if cad_raster is None:
                diagnostics.append("高清原图渲染不可用（缺少 matplotlib 或渲染失败），已使用快速看图模式。")
        else:
            _emit_analysis_progress(progress_callback, progress="正在生成图纸预览并标记构件...")
            preview_svg = build_preview_svg(
                doc, progress_callback=progress_callback, items=preview_items, bbox=preview_bbox,
            )
            _emit_analysis_progress(progress_callback, progress="正在生成高清预览...")
            preview_svg_hd = build_preview_svg(
                doc,
                max_entities=PREVIEW_HD_RENDERED_ENTITIES,
                max_points_per_entity=PREVIEW_HD_MAX_POINTS_PER_ENTITY,
                max_text_entities=PREVIEW_HD_TEXT_ENTITIES,
                shape_rendering="geometricPrecision",
                stroke_width=PREVIEW_HD_STROKE_WIDTH,
                items=preview_items,
                bbox=preview_bbox,
            )
            diagnostics.append("快速看图与高清原图均不可用，已回退矢量预览模式。")
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
            "cad_geometry": cad_geometry,
            "cad_raster": cad_raster,
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
            "cad_geometry": {"bbox": None, "groups": {}, "highlights": [], "texts": []},
            "cad_raster": None,
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


def analyze_dxf_bytes_worker(
    file_bytes: bytes,
    filename: str,
    progress_queue: Any,
) -> None:
    """子进程执行 analyze_dxf_bytes，进度与最终结果经队列回传主进程。

    解析是 CPU 密集型（ezdxf/matplotlib 存在分钟级 C 调用），放主进程
    线程里跑会霸占 GIL 饿死事件循环，必须进程隔离。"""
    def _cb(payload: dict) -> None:
        try:
            progress_queue.put(("progress", payload))
        except Exception:
            pass

    try:
        result = analyze_dxf_bytes(
            file_bytes, filename, progress_callback=_cb, async_raster=True
        )
        progress_queue.put(("result", result))
    except Exception as exc:
        try:
            progress_queue.put(("error", str(exc)))
        except Exception:
            pass
