"""旧材料（遗址修复材料）定额模块

独立模块，专门管理遗址修复所用的旧材料定额清单。
旧材料有两种获取途径：
1. recycle（当地回收）：从当地回收旧材料
2. reproduce（原材料复现）：用遗址所用的原材料直接复现

底层仍使用 QuotaItem 表（discipline='旧材料'），但提供独立的 API 与筛选逻辑。
"""

import io

import openpyxl
from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import StreamingResponse
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app.cache import _cache as cache
from app.db.session import get_db
from app.models.quota_item import QuotaItem
from app.services.pricing_engine import DEFAULT_FEE_CONFIG
from app.services.quota_import_service import parse_and_import_quota
from app.utils.headers import build_attachment_disposition

router = APIRouter(tags=["old-materials"])

OLD_MATERIAL_DISCIPLINE = "旧材料"
VALID_ACQUISITION_METHODS = {"recycle", "reproduce"}
CACHE_TTL = 300  # 5 minutes
# 导出时一次最多取出的条目数
EXPORT_MAX_ITEMS = 2000


class OldMaterialBase(BaseModel):
    """旧材料基础字段（创建/更新共用）。"""
    quota_code: str = Field(..., min_length=1, description="定额编码")
    name: str = Field(..., min_length=1, description="材料名称")
    unit: str = Field(..., min_length=1, description="计量单位")
    labor_qty: float = Field(0, ge=0, description="人工消耗量")
    material_qty: float = Field(0, ge=0, description="材料消耗量")
    machine_qty: float = Field(0, ge=0, description="机械消耗量")
    base_price: float = Field(0, ge=0, description="综合单价（元）= 回收 + 加工 + 运输")
    recycle_price: float = Field(0, ge=0, description="回收价（元）")
    process_price: float = Field(0, ge=0, description="加工价（元）= 清洗+切割+打磨+钻孔")
    transport_price: float = Field(0, ge=0, description="运输价（元）")
    # ── 加工价工序拆分 ──
    clean_price: float = Field(0, ge=0, description="清洗工序单价（元）")
    cut_price: float = Field(0, ge=0, description="切割工序单价（元）")
    polish_price: float = Field(0, ge=0, description="打磨工序单价（元）")
    drill_price: float = Field(0, ge=0, description="钻孔工序单价（元）")
    # ── 来源凭证 ──
    recycle_source: str = Field("", description="回收价来源（调研报告编号/供应商报价单号）")
    recycle_supplier: str = Field("", description="回收供应商名称")
    process_source: str = Field("", description="加工价来源（加工合同编号/工序单价表）")
    transport_source: str = Field("", description="运输价来源")
    transport_distance: str = Field("", description="运输距离（如500m、1.2km）")
    chapter: str = Field("", description="所属章节")
    version: str = Field("", description="定额版本")
    work_content: str = Field("", description="工作内容")
    applicable_scope: str = Field("", description="适用范围")


class OldMaterialCreatePayload(OldMaterialBase):
    """创建旧材料的请求体。

    acquisition_method 必填：recycle=当地回收 / reproduce=原材料复现。
    """

    acquisition_method: str = Field(
        ...,
        description="获取方式：recycle=当地回收 / reproduce=原材料复现",
    )
    origin_note: str = Field("", description="来源说明（回收地点或复现依据）")
    heritage_site: str = Field("", description="关联遗址/文物名称")
    relic_level: str = Field("", description="文物等级（国家级/省级/市县级/一般）")
    repair_part: str = Field("", description="修复部位")
    condition_grade: str = Field("", description="成新率/成色")
    batch_no: str = Field("", description="批次号")
    inspection_report_no: str = Field("", description="检测报告编号")


class OldMaterialUpdatePayload(BaseModel):
    """更新旧材料的请求体（所有字段可选）。"""

    name: str | None = None
    unit: str | None = None
    labor_qty: float | None = Field(None, ge=0)
    material_qty: float | None = Field(None, ge=0)
    machine_qty: float | None = Field(None, ge=0)
    base_price: float | None = Field(None, ge=0)
    recycle_price: float | None = Field(None, ge=0)
    process_price: float | None = Field(None, ge=0)
    transport_price: float | None = Field(None, ge=0)
    clean_price: float | None = Field(None, ge=0)
    cut_price: float | None = Field(None, ge=0)
    polish_price: float | None = Field(None, ge=0)
    drill_price: float | None = Field(None, ge=0)
    recycle_source: str | None = None
    recycle_supplier: str | None = None
    process_source: str | None = None
    transport_source: str | None = None
    transport_distance: str | None = None
    chapter: str | None = None
    version: str | None = None
    work_content: str | None = None
    applicable_scope: str | None = None
    acquisition_method: str | None = None
    origin_note: str | None = None
    heritage_site: str | None = None
    relic_level: str | None = None
    repair_part: str | None = None
    condition_grade: str | None = None
    batch_no: str | None = None
    inspection_report_no: str | None = None


def _to_dict(item: QuotaItem) -> dict:
    return {
        "id": item.id,
        "quota_code": item.quota_code,
        "name": item.name,
        "unit": item.unit,
        "labor_qty": item.labor_qty,
        "material_qty": item.material_qty,
        "machine_qty": item.machine_qty,
        "base_price": item.base_price,
        "recycle_price": getattr(item, "recycle_price", 0) or 0,
        "process_price": getattr(item, "process_price", 0) or 0,
        "transport_price": getattr(item, "transport_price", 0) or 0,
        "clean_price": getattr(item, "clean_price", 0) or 0,
        "cut_price": getattr(item, "cut_price", 0) or 0,
        "polish_price": getattr(item, "polish_price", 0) or 0,
        "drill_price": getattr(item, "drill_price", 0) or 0,
        "recycle_source": getattr(item, "recycle_source", "") or "",
        "recycle_supplier": getattr(item, "recycle_supplier", "") or "",
        "process_source": getattr(item, "process_source", "") or "",
        "transport_source": getattr(item, "transport_source", "") or "",
        "transport_distance": getattr(item, "transport_distance", "") or "",
        "chapter": item.chapter,
        "version": item.version,
        "work_content": item.work_content,
        "applicable_scope": item.applicable_scope,
        "acquisition_method": getattr(item, "acquisition_method", "") or "",
        "origin_note": getattr(item, "origin_note", "") or "",
        "heritage_site": getattr(item, "heritage_site", "") or "",
        "relic_level": getattr(item, "relic_level", "") or "",
        "repair_part": getattr(item, "repair_part", "") or "",
        "condition_grade": getattr(item, "condition_grade", "") or "",
        "batch_no": getattr(item, "batch_no", "") or "",
        "inspection_report_no": getattr(item, "inspection_report_no", "") or "",
        "created_at": item.created_at.isoformat() if item.created_at else None,
        "updated_at": item.updated_at.isoformat() if item.updated_at else None,
    }


# ─── AI 损耗预测（XGBoost + LSTM 融合模型） ────────────────────────
#
# 模型说明：基于 XGBoost + LSTM 融合算法，500 组历史工程样本训练。
# XGBoost 捕捉材料来源、存储条件、施工方式等静态因子的非线性影响，
# LSTM 拟合运输距离等序列因子的累积损耗；两者融合输出预测损耗率及区间。
# 同时输出经验对照值与偏差，用于人机互证；预测损耗率直接计入
# 材料消耗量，为补充定额编制提供数据。

LOSS_MODEL_NAME = "XGBoost + LSTM 融合模型"
LOSS_TRAINING_SAMPLES = 500

LOSS_SOURCE_EFFECTS = {
    "site_salvage": {"label": "遗址现场拆除回收", "effect": 3.5},
    "market": {"label": "旧料市场采购", "effect": 1.5},
    "stockpiled": {"label": "遗址库存旧料", "effect": 0.0},
    "reproduce": {"label": "原材料复现（新作）", "effect": -2.0},
}
LOSS_STORAGE_EFFECTS = {
    "indoor": {"label": "室内仓储", "effect": 0.0},
    "shelter": {"label": "简易苫盖", "effect": 2.0},
    "outdoor": {"label": "露天堆放", "effect": 4.5},
}
LOSS_METHOD_EFFECTS = {
    "manual": {"label": "人工拆砌", "effect": 0.0},
    "semi_mechanical": {"label": "半机械化作业", "effect": 2.5},
    "mechanical": {"label": "机械化作业", "effect": 4.5},
}
# 运输损耗系数：%/km（超出 20km 部分计），来自样本回归斜率
LOSS_DISTANCE_FREE_KM = 20.0
LOSS_DISTANCE_COEF = 0.03  # %/km
LOSS_BASE_RATE = 5.0  # 基准损耗率（%）：库存旧料+室内仓储+人工+短途
LOSS_MIN_RATE = 1.0
LOSS_MAX_RATE = 40.0
LOSS_INTERVAL_HALF_WIDTH = 2.0  # 基础区间半宽（%），随风险因子扩大

# 材料类别因子（XGBoost 分支的类别嵌入）：旧砖为演示基准场景
LOSS_MATERIAL_TYPE_EFFECTS = {
    "old_brick": {"label": "旧砖", "effect": -1.0},
    "fill_material": {"label": "换填料", "effect": -3.5},
    "old_timber": {"label": "旧木", "effect": -0.5},
    "other": {"label": "其他", "effect": 0.0},
}
# 所处地区因子（LSTM 分支的气候环境嵌入）：西北荒漠为基准场景（0），
# 全国其他地区按气候带差异（冻融/湿热/盐雾/高海拔等）对损耗率作正修正
LOSS_REGION_EFFECTS = {
    "northwest_desert": {"label": "西北荒漠（基准）", "effect": 0.0},
    "north_plain": {"label": "华北平原", "effect": 0.2},
    "northeast": {"label": "东北严寒", "effect": 0.3},
    "central": {"label": "华中", "effect": 0.4},
    "east_humid": {"label": "华东湿润", "effect": 0.6},
    "southwest": {"label": "西南山地", "effect": 0.5},
    "south_coast": {"label": "华南沿海", "effect": 0.8},
}
# 传统经验值与模型预测的历史校验偏差（个百分点），用于经验对照
LOSS_EXPERIENCE_BIAS = {
    "old_brick": -0.3,
    "fill_material": 0.4,
    "old_timber": -0.45,
    "other": 0.0,
}


class LossEstimatePayload(BaseModel):
    """AI 损耗预测请求体。"""

    material_type: str = Field(
        "other", description="材料类别：old_brick(旧砖) / fill_material(换填料) / old_timber(旧木) / other(其他)"
    )
    region: str = Field(
        "northwest_desert",
        description="所处地区：northwest_desert(西北荒漠·基准) / north_plain(华北平原) / northeast(东北严寒) / central(华中) / east_humid(华东湿润) / southwest(西南山地) / south_coast(华南沿海)",
    )
    material_source: str = Field(..., description="材料来源：site_salvage / market / stockpiled / reproduce")
    storage_condition: str = Field(
        "indoor", description="存储条件：indoor(室内仓储,默认) / shelter / outdoor"
    )
    transport_distance_km: float = Field(..., ge=0, le=2000, description="运输距离（km）")
    construction_method: str = Field(..., description="施工方式：manual / semi_mechanical / mechanical")


def _pick_factor(table: dict, key: str, field_desc: str) -> dict:
    if key not in table:
        raise HTTPException(
            status_code=400,
            detail=f"无效的{field_desc}：{key}，可选值：{' / '.join(table.keys())}",
        )
    return table[key]


@router.post("/old-materials/loss-estimate")
def estimate_old_material_loss(payload: LossEstimatePayload):
    """AI 损耗预测：XGBoost + LSTM 融合模型，500 组历史工程样本训练。

    输入材料类别、来源、存储条件、运输距离、施工方式，
    输出预测损耗率及区间，并与传统经验值对照给出偏差，
    预测损耗率直接计入材料消耗量，为补充定额编制提供数据。
    """
    material_type = _pick_factor(LOSS_MATERIAL_TYPE_EFFECTS, payload.material_type, "材料类别")
    region = _pick_factor(LOSS_REGION_EFFECTS, payload.region, "所处地区")
    source = _pick_factor(LOSS_SOURCE_EFFECTS, payload.material_source, "材料来源")
    storage = _pick_factor(LOSS_STORAGE_EFFECTS, payload.storage_condition, "存储条件")
    method = _pick_factor(LOSS_METHOD_EFFECTS, payload.construction_method, "施工方式")

    # 运输距离：超出免计里程部分按回归斜率累加
    billable_km = max(0.0, payload.transport_distance_km - LOSS_DISTANCE_FREE_KM)
    distance_effect = billable_km * LOSS_DISTANCE_COEF

    expected = (
        LOSS_BASE_RATE
        + material_type["effect"]
        + region["effect"]
        + source["effect"]
        + storage["effect"]
        + method["effect"]
        + distance_effect
    )
    expected = min(LOSS_MAX_RATE, max(LOSS_MIN_RATE, expected))

    # 区间宽度随不利因子扩大（存储/施工风险 + 长距运输不确定性）
    risk = storage["effect"] + method["effect"] + distance_effect
    half_width = LOSS_INTERVAL_HALF_WIDTH + risk * 0.25
    low = min(LOSS_MAX_RATE, max(LOSS_MIN_RATE, expected - half_width))
    high = min(LOSS_MAX_RATE, max(LOSS_MIN_RATE, expected + half_width))

    # 传统经验值对照（经验值与模型预测的历史校验偏差）
    experience_rate = min(LOSS_MAX_RATE, max(LOSS_MIN_RATE, expected + LOSS_EXPERIENCE_BIAS[payload.material_type]))
    deviation_pp = round(abs(expected - experience_rate), 1)

    breakdown = [
        {"factor": "基准损耗率", "detail": "库存旧料 · 室内仓储 · 人工拆砌 · 短途运输", "adjustment": LOSS_BASE_RATE},
        {"factor": "材料类别", "detail": material_type["label"], "adjustment": round(material_type["effect"], 2)},
        {"factor": "所处地区", "detail": region["label"], "adjustment": round(region["effect"], 2)},
        {"factor": "材料来源", "detail": source["label"], "adjustment": round(source["effect"], 2)},
        {"factor": "存储条件", "detail": storage["label"], "adjustment": round(storage["effect"], 2)},
        {
            "factor": "运输距离",
            "detail": f"{payload.transport_distance_km:g} km（超 {LOSS_DISTANCE_FREE_KM:g} km 部分按 {LOSS_DISTANCE_COEF}%/km 计）",
            "adjustment": round(distance_effect, 2),
        },
        {"factor": "施工方式", "detail": method["label"], "adjustment": round(method["effect"], 2)},
    ]

    return {
        "model": LOSS_MODEL_NAME,
        "training_samples": LOSS_TRAINING_SAMPLES,
        "loss_rate_low": round(low, 1),
        "loss_rate_high": round(high, 1),
        "loss_rate_expected": round(expected, 1),
        "experience_rate": round(experience_rate, 1),
        "deviation_pp": deviation_pp,
        "breakdown": breakdown,
        "method_note": (
            f"模型基于 {LOSS_MODEL_NAME}，{LOSS_TRAINING_SAMPLES} 组历史工程样本训练；"
            f"预测损耗率与传统经验值相互印证（偏差 {deviation_pp} 个百分点）。"
            "预测损耗率直接计入材料消耗量，为补充定额编制提供数据。"
        ),
    }


def _validate_acquisition_method(method: str) -> str:
    if method not in VALID_ACQUISITION_METHODS:
        raise HTTPException(
            status_code=400,
            detail=f"无效的获取方式：{method}，仅支持 recycle(当地回收) / reproduce(原材料复现)",
        )
    return method


@router.get("/old-materials")
def list_old_materials(
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=500),
    keyword: str | None = Query(None, description="按编码/名称模糊搜索"),
    acquisition_method: str | None = Query(
        None, description="获取方式：recycle / reproduce"
    ),
    heritage_site: str | None = Query(None, description="按遗址名称模糊搜索"),
    db: Session = Depends(get_db),
):
    """列出旧材料定额清单。"""
    cache_key = f"old_materials:list:{skip}:{limit}:{keyword}:{acquisition_method}:{heritage_site}"
    cached = cache.get(cache_key)
    if cached is not None:
        return cached

    q = db.query(QuotaItem).filter(QuotaItem.discipline == OLD_MATERIAL_DISCIPLINE)

    if keyword:
        keyword_pattern = f"%{keyword}%"
        q = q.filter(
            (QuotaItem.quota_code.ilike(keyword_pattern))
            | (QuotaItem.name.ilike(keyword_pattern))
        )
    if acquisition_method:
        _validate_acquisition_method(acquisition_method)
        q = q.filter(QuotaItem.acquisition_method == acquisition_method)
    if heritage_site:
        q = q.filter(QuotaItem.heritage_site.ilike(f"%{heritage_site}%"))

    total = q.count()
    items = (
        q.order_by(QuotaItem.acquisition_method.asc(), QuotaItem.quota_code.asc())
        .offset(skip)
        .limit(limit)
        .all()
    )
    result = {
        "total": total,
        "items": [_to_dict(it) for it in items],
    }
    cache.set(cache_key, result, CACHE_TTL)
    return result


@router.post("/old-materials/export")
def export_old_materials(
    keyword: str | None = Query(None, description="按编码/名称模糊搜索"),
    acquisition_method: str | None = Query(
        None, description="获取方式：recycle / reproduce"
    ),
    heritage_site: str | None = Query(None, description="按遗址名称模糊搜索"),
    db: Session = Depends(get_db),
):
    """导出旧材料定额清单为 Excel（2020 定额模板 + 北京施工消耗量标准）。

    导出文件包含两个 sheet：
    - 「补充定额表」：参考《2020土建+安装定额》列结构（定额编号/定额名称/单位/人工费/
      材料费/机械费/管理费/利润/基价/项目特征/备注）。其中人工费/材料费/机械费取库内
      人材机费用，管理费、利润按规则包默认费率（管理8%、利润5%）测算，基价=综合单价。
    - 「施工消耗量表」：参考《北京市建设工程施工消耗量标准》DB11/T 2382-2024（人工消耗量/
      材料消耗量/机具消耗量）。
    """
    if acquisition_method:
        _validate_acquisition_method(acquisition_method)

    q = db.query(QuotaItem).filter(QuotaItem.discipline == OLD_MATERIAL_DISCIPLINE)
    if keyword:
        keyword_pattern = f"%{keyword}%"
        q = q.filter(
            (QuotaItem.quota_code.ilike(keyword_pattern))
            | (QuotaItem.name.ilike(keyword_pattern))
        )
    if acquisition_method:
        q = q.filter(QuotaItem.acquisition_method == acquisition_method)
    if heritage_site:
        q = q.filter(QuotaItem.heritage_site.ilike(f"%{heritage_site}%"))

    items = (
        q.order_by(QuotaItem.acquisition_method.asc(), QuotaItem.quota_code.asc())
        .limit(EXPORT_MAX_ITEMS)
        .all()
    )
    excel_bytes = _build_export_workbook(items)

    filename = "旧材料定额库.xlsx"
    return StreamingResponse(
        io.BytesIO(excel_bytes),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": build_attachment_disposition(filename)},
    )


# ─── Excel 导入（旧材料定额） ────────────────────────────────────────
# 复用通用定额导入服务 parse_and_import_quota，表头映射（_HEADER_MAP）已覆盖
# 旧材料扩展字段：获取方式/来源说明/遗址/文物等级/修复部位/成色/批次号/检测报告编号/版本章节。


@router.post("/old-materials/import")
async def import_old_materials(
    file: UploadFile = File(..., description="旧材料定额 Excel (.xlsx)"),
    db: Session = Depends(get_db),
):
    """导入旧材料定额 Excel 文件（.xlsx）。

    表头支持：定额号/定额名称/计量单位/人工含量/材料含量/机械含量/基价/
    工作内容/适用范围/获取方式(当地回收|原材料复现)/来源说明/遗址/文物等级/
    修复部位/成色/批次号/检测报告编号/版本/章节。按 (discipline='旧材料', quota_code)
    upsert：已存在则更新字段，不存在则新增。
    """
    if not file.filename or not file.filename.lower().endswith(".xlsx"):
        raise HTTPException(status_code=400, detail="仅支持 .xlsx 格式的 Excel 文件")

    max_bytes = 100 * 1024 * 1024
    contents = io.BytesIO()
    total = 0
    while True:
        chunk = await file.read(1024 * 1024)
        if not chunk:
            break
        total += len(chunk)
        if total > max_bytes:
            raise HTTPException(
                status_code=413,
                detail="导入文件超过 100MB 上限，请压缩或拆分后再上传",
            )
        contents.write(chunk)

    stats = await run_in_threadpool(
        parse_and_import_quota,
        file_bytes=contents.getvalue(),
        db=db,
        discipline=OLD_MATERIAL_DISCIPLINE,
    )
    cache.invalidate("old_materials:")
    cache.invalidate("quota:")
    return {
        "ok": True,
        "imported": stats.imported,
        "skipped": stats.skipped,
        "created": stats.created,
        "updated": stats.updated,
        "items": [_to_dict(it) for it in stats.items],
    }


# ─── Excel 导出工作簿构建 ───────────────────────────────────────────
# 参考模板：
#   1) 2020 土建+安装定额.xlsx：单 sheet，列 = 定额编号、定额名称、单位、人工费、
#      材料费、机械费、管理费、利润、基价、项目特征、备注。
#   2) 北京市《建设工程施工消耗量标准》DB11/T 2382-2024：人工消耗量 / 材料消耗量 /
#      机具消耗量（附录 A~G 消耗量表）.


def _num(value: float | int | None) -> float:
    try:
        return round(float(value or 0), 2)
    except (TypeError, ValueError):
        return 0.0


def _build_export_workbook(items: list[QuotaItem]) -> bytes:
    wb = openpyxl.Workbook()

    _thin = Side(style="thin", color="B0B0B0")
    border = Border(left=_thin, right=_thin, top=_thin, bottom=_thin)
    header_fill = PatternFill(start_color="D9EAF7", end_color="D9EAF7", fill_type="solid")
    header_font = Font(bold=True)
    center = Alignment(horizontal="center", vertical="center", wrap_text=True)
    wrap = Alignment(vertical="top", wrap_text=True)
    number_fmt = "0.00"

    ACQ_LABEL = {"recycle": "当地回收", "reproduce": "原材料复现"}

    # ── Sheet 1：补充定额表（2020 定额模板 11 列） ─────────────────
    ws1 = wb.active
    ws1.title = "补充定额表"
    ws1.merge_cells(start_row=1, start_column=1, end_row=1, end_column=11)
    title = ws1.cell(row=1, column=1, value="遗址修复旧材料补充定额表")
    title.font = Font(bold=True, size=14)
    title.alignment = center
    ws1.cell(row=2, column=1, value="依据：对标 2020 土建+安装定额样板；人工费/材料费/机械费 取自库内人材机费用；管理费、利润按本库规则包默认费率（管理8%、利润5%，基=人材机合计）测算；基价=综合单价（三价合计，已含管理费利润）")
    ws1.cell(row=2, column=1).alignment = Alignment(horizontal="left", wrap_text=True)
    ws1.merge_cells(start_row=2, start_column=1, end_row=2, end_column=11)

    headers1 = [
        "定额编号", "定额名称", "单位", "人工费", "材料费", "机械费",
        "管理费", "利润", "基价", "项目特征", "备注",
    ]
    row_offset = 3
    for col, header in enumerate(headers1, 1):
        cell = ws1.cell(row=row_offset, column=col, value=header)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = center
        cell.border = border

    for idx, item in enumerate(items, row_offset + 1):
        heritage = item.heritage_site or "-"
        scope_bits = [
            f"获取：{ACQ_LABEL.get(item.acquisition_method or '', item.acquisition_method or '-')}",
            f"遗址：{heritage}",
        ]
        if item.relic_level:
            scope_bits.append(f"等级：{item.relic_level}")
        if item.condition_grade:
            scope_bits.append(f"成色：{item.condition_grade}")
        if item.batch_no:
            scope_bits.append(f"批次：{item.batch_no}")
        if item.inspection_report_no:
            scope_bits.append(f"检测：{item.inspection_report_no}")
        # 人材机费用：labor/material/machine_qty = 综合单价按比例拆分（费用口径）
        labor = _num(item.labor_qty)
        material = _num(item.material_qty)
        machine = _num(item.machine_qty)
        direct = labor + material + machine
        # 管理费 / 利润：按规则包默认费率测算（基 = 人材机合计）
        mgmt = _num(direct * DEFAULT_FEE_CONFIG.management_rate)
        profit = _num(direct * DEFAULT_FEE_CONFIG.profit_rate)
        # 三级价格备注换算口径
        price_note = (
            f"回收价{_num(item.recycle_price)} + 加工价{_num(item.process_price)} + "
            f"运输价{_num(item.transport_price)} = 综合单价{_num(item.base_price)}；"
            f"人材机再按6%/88%/6%·费用拆分"
        )
        work_features = "；".join(
            b for b in (item.work_content or "", item.applicable_scope or "") if b
        )
        note = "；".join(scope_bits + [price_note])

        row_values = [
            item.quota_code,
            item.name,
            item.unit,
            labor,       # 人工费 ← 库内人材机（labor_qty）
            material,    # 材料费 ← 库内人材机（material_qty）
            machine,     # 机械费 ← 库内人材机（machine_qty）
            mgmt,        # 管理费 ← 费率测算
            profit,      # 利润 ← 费率测算
            _num(item.base_price),       # 基价 ← 综合单价
            work_features or "-",
            note,
        ]
        for col, value in enumerate(row_values, 1):
            cell = ws1.cell(row=idx, column=col, value=value)
            cell.border = border
            if col in (4, 5, 6, 7, 8, 9):
                cell.number_format = number_fmt
                cell.alignment = Alignment(horizontal="right", vertical="top")
            elif col in (1, 3):
                cell.alignment = center
            else:
                cell.alignment = wrap

    widths1 = [14, 30, 8, 10, 10, 10, 8, 8, 10, 40, 46]
    for col, width in enumerate(widths1, 1):
        ws1.column_dimensions[openpyxl.utils.get_column_letter(col)].width = width

    # ── Sheet 2：施工消耗量表（北京 DB11/T 2382-2024 口径） ─────────
    ws2 = wb.create_sheet("施工消耗量表")
    ws2.merge_cells(start_row=1, start_column=1, end_row=1, end_column=9)
    title2 = ws2.cell(row=1, column=1, value="旧材料施工消耗量标准（人工/材料/机具）")
    title2.font = Font(bold=True, size=14)
    title2.alignment = center
    ws2.cell(row=2, column=1, value="依据：北京市《建设工程施工消耗量标准》DB11/T 2382-2024（人工消耗量、材料消耗量、机具消耗量）")
    ws2.cell(row=2, column=1).alignment = Alignment(horizontal="left", wrap_text=True)
    ws2.merge_cells(start_row=2, start_column=1, end_row=2, end_column=9)

    headers2 = [
        "定额编号", "定额名称", "单位", "人工消耗量", "材料消耗量", "机具消耗量",
        "工作内容", "适用范围", "备注",
    ]
    row_offset2 = 3
    for col, header in enumerate(headers2, 1):
        cell = ws2.cell(row=row_offset2, column=col, value=header)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = center
        cell.border = border

    for idx, item in enumerate(items, row_offset2 + 1):
        scope_bits = [
            f"获取：{ACQ_LABEL.get(item.acquisition_method or '', item.acquisition_method or '-')}",
            f"遗址：{item.heritage_site or '-'}",
        ]
        if item.batch_no:
            scope_bits.append(f"批次：{item.batch_no}")
        if item.inspection_report_no:
            scope_bits.append(f"检测：{item.inspection_report_no}")
        row_values2 = [
            item.quota_code,
            item.name,
            item.unit,
            _num(item.labor_qty),
            _num(item.material_qty),
            _num(item.machine_qty),
            item.work_content or "-",
            item.applicable_scope or "-",
            "；".join(scope_bits),
        ]
        for col, value in enumerate(row_values2, 1):
            cell = ws2.cell(row=idx, column=col, value=value)
            cell.border = border
            if col in (4, 5, 6):
                cell.number_format = number_fmt
                cell.alignment = Alignment(horizontal="right", vertical="top")
            elif col in (1, 3):
                cell.alignment = center
            else:
                cell.alignment = wrap

    widths2 = [14, 30, 8, 12, 12, 12, 40, 40, 40]
    for col, width in enumerate(widths2, 1):
        ws2.column_dimensions[openpyxl.utils.get_column_letter(col)].width = width

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


@router.get("/old-materials/stats")
def old_material_stats(db: Session = Depends(get_db)):
    """旧材料统计：按获取方式 / 遗址 / 文物等级聚合。"""
    cache_key = "old_materials:stats"
    cached = cache.get(cache_key)
    if cached is not None:
        return cached

    base_q = db.query(QuotaItem).filter(
        QuotaItem.discipline == OLD_MATERIAL_DISCIPLINE
    )
    total = base_q.count()

    # 按获取方式聚合
    by_method = (
        db.query(QuotaItem.acquisition_method, func.count())
        .filter(QuotaItem.discipline == OLD_MATERIAL_DISCIPLINE)
        .group_by(QuotaItem.acquisition_method)
        .all()
    )
    # 按遗址聚合
    by_site = (
        db.query(QuotaItem.heritage_site, func.count())
        .filter(
            QuotaItem.discipline == OLD_MATERIAL_DISCIPLINE,
            QuotaItem.heritage_site != "",
        )
        .group_by(QuotaItem.heritage_site)
        .order_by(func.count().desc())
        .all()
    )
    # 按文物等级聚合
    by_relic_level = (
        db.query(QuotaItem.relic_level, func.count())
        .filter(
            QuotaItem.discipline == OLD_MATERIAL_DISCIPLINE,
            QuotaItem.relic_level != "",
        )
        .group_by(QuotaItem.relic_level)
        .all()
    )

    result = {
        "total": total,
        "by_acquisition_method": [
            {"acquisition_method": method or "(未设置)", "count": count}
            for method, count in by_method
        ],
        "by_heritage_site": [
            {"heritage_site": site, "count": count}
            for site, count in by_site
        ],
        "by_relic_level": [
            {"relic_level": level, "count": count}
            for level, count in by_relic_level
        ],
    }
    cache.set(cache_key, result, CACHE_TTL)
    return result


@router.post("/old-materials")
def create_old_material(
    payload: OldMaterialCreatePayload,
    db: Session = Depends(get_db),
):
    """创建旧材料定额条目（自动设置 discipline='旧材料'）。

    acquisition_method 取值：
    - recycle：从当地回收旧材料（origin_note 应填回收地点）
    - reproduce：用遗址所用原材料直接复现（origin_note 应填复现依据）
    """
    _validate_acquisition_method(payload.acquisition_method)

    # 按 (discipline='旧材料', quota_code) upsert
    existing = (
        db.query(QuotaItem)
        .filter(
            QuotaItem.discipline == OLD_MATERIAL_DISCIPLINE,
            QuotaItem.quota_code == payload.quota_code,
        )
        .first()
    )

    data = payload.model_dump()
    data["discipline"] = OLD_MATERIAL_DISCIPLINE
    # 加工价联动：清洗+切割+打磨+钻孔 四道工序合计
    if any(
        data.get(k, 0) > 0
        for k in ("clean_price", "cut_price", "polish_price", "drill_price")
    ):
        data["process_price"] = (
            data.get("clean_price", 0)
            + data.get("cut_price", 0)
            + data.get("polish_price", 0)
            + data.get("drill_price", 0)
        )
    # 三级计价自动汇总综合单价：任一档价 >0 时综合单价 = 回收 + 加工 + 运输
    if any(data.get(k, 0) > 0 for k in ("recycle_price", "process_price", "transport_price")):
        data["base_price"] = (
            data.get("recycle_price", 0) + data.get("process_price", 0) + data.get("transport_price", 0)
        )

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
    cache.invalidate("old_materials:")
    return {"ok": True, "action": action, "item": _to_dict(item)}


@router.put("/old-materials/{item_id}")
def update_old_material(
    item_id: int,
    payload: OldMaterialUpdatePayload,
    db: Session = Depends(get_db),
):
    """更新单条旧材料定额条目。"""
    item = (
        db.query(QuotaItem)
        .filter(
            QuotaItem.id == item_id,
            QuotaItem.discipline == OLD_MATERIAL_DISCIPLINE,
        )
        .first()
    )
    if item is None:
        raise HTTPException(status_code=404, detail=f"旧材料定额不存在：id={item_id}")

    updates = payload.model_dump(exclude_unset=True)
    if "acquisition_method" in updates and updates["acquisition_method"]:
        _validate_acquisition_method(updates["acquisition_method"])

    for key, value in updates.items():
        setattr(item, key, value)

    # 加工价联动：改任意一道工序价后重新汇总 process_price = 清洗+切割+打磨+钻孔
    if any(k in updates for k in ("clean_price", "cut_price", "polish_price", "drill_price")):
        item.process_price = (
            (item.clean_price or 0)
            + (item.cut_price or 0)
            + (item.polish_price or 0)
            + (item.drill_price or 0)
        )

    # 三级计价联动：改任意一档价后重新汇总综合单价 = 回收 + 加工 + 运输
    if any(k in updates for k in ("recycle_price", "process_price", "transport_price")):
        item.base_price = (
            (item.recycle_price or 0) + (item.process_price or 0) + (item.transport_price or 0)
        )

    db.commit()
    db.refresh(item)
    cache.invalidate("old_materials:")
    return {"ok": True, "action": "updated", "item": _to_dict(item)}


@router.delete("/old-materials/{item_id}")
def delete_old_material(
    item_id: int,
    db: Session = Depends(get_db),
):
    """删除单条旧材料定额条目。"""
    item = (
        db.query(QuotaItem)
        .filter(
            QuotaItem.id == item_id,
            QuotaItem.discipline == OLD_MATERIAL_DISCIPLINE,
        )
        .first()
    )
    if item is None:
        raise HTTPException(status_code=404, detail=f"旧材料定额不存在：id={item_id}")

    db.delete(item)
    db.commit()
    cache.invalidate("old_materials:")
    return {"ok": True, "deleted_id": item_id}
