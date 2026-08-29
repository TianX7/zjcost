"""旧材料（遗址修复材料）定额模块

独立模块，专门管理遗址修复所用的旧材料定额清单。
旧材料有两种获取途径：
1. recycle（当地回收）：从当地回收旧材料
2. reproduce（原材料复现）：用遗址所用的原材料直接复现

底层仍使用 QuotaItem 表（discipline='旧材料'），但提供独立的 API 与筛选逻辑。
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.cache import _cache as cache
from app.db.session import get_db
from app.models.quota_item import QuotaItem

router = APIRouter(tags=["old-materials"])

OLD_MATERIAL_DISCIPLINE = "旧材料"
VALID_ACQUISITION_METHODS = {"recycle", "reproduce"}
CACHE_TTL = 300  # 5 minutes


class OldMaterialBase(BaseModel):
    """旧材料定额基础字段。"""

    quota_code: str = Field(..., min_length=1, description="定额编码")
    name: str = Field(..., min_length=1, description="材料名称")
    unit: str = Field(..., min_length=1, description="计量单位")
    labor_qty: float = Field(0, ge=0, description="人工消耗量")
    material_qty: float = Field(0, ge=0, description="材料消耗量")
    machine_qty: float = Field(0, ge=0, description="机械消耗量")
    base_price: float = Field(0, ge=0, description="基价（元）")
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
