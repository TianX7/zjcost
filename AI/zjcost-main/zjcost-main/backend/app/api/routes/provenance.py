from dataclasses import asdict

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.assistant.agents.legacy_utils import generate_insight
from app.db.session import get_db
from app.models.boq_item import BoqItem
from app.models.calc_result import CalcResult
from app.models.line_item_quota_binding import LineItemQuotaBinding
from app.models.project import Project
from app.models.quota_item import QuotaItem
from app.schemas.provenance import (
    BindingRef,
    CalcBreakdown,
    CalcProvenance,
    PriceSnapshot,
    QuotaRef,
)
from app.services.pricing_engine import _r2, calculate_line_item
from app.services.project_calc_service import (
    _bound_quotas,
    _compose_quota_base_price,
    _compose_quota_quantities,
    _lookup_price,
    _resolve_fee_config,
    _should_use_base_price_first,
)

import logging

logger = logging.getLogger(__name__)

router = APIRouter(tags=["provenance"])


@router.get(
    "/calc-results/{boq_item_id}/provenance",
    response_model=CalcProvenance,
)
def get_provenance(
    boq_item_id: int,
    db: Session = Depends(get_db),
) -> CalcProvenance:
    """Return full provenance for a BOQ item's calculation result."""
    boq = db.query(BoqItem).filter(BoqItem.id == boq_item_id).first()
    if not boq:
        raise HTTPException(status_code=404, detail="BOQ item not found")

    bindings = (
        db.query(LineItemQuotaBinding)
        .filter(LineItemQuotaBinding.boq_item_id == boq_item_id)
        .all()
    )
    project = db.query(Project).filter(Project.id == boq.project_id).first()
    project_region = project.region if project else ""
    fee_config = _resolve_fee_config(project_id=boq.project_id, db=db)
    labor_price = _lookup_price(db, category="人工费", region=project_region)
    material_price = _lookup_price(db, category="材料费", region=project_region)
    machine_price = _lookup_price(db, category="机械费", region=project_region)
    # _lookup_price 找不到价格时返回 None，后续乘法需要 float，统一降级为 0.0
    labor_price = labor_price if labor_price is not None else 0.0
    material_price = material_price if material_price is not None else 0.0
    machine_price = machine_price if machine_price is not None else 0.0

    quota_ids = {b.quota_item_id for b in bindings}
    quota_by_id = {
        q.id: q for q in db.query(QuotaItem).filter(QuotaItem.id.in_(quota_ids)).all()
    } if quota_ids else {}

    binding_refs: list[BindingRef] = []
    if bindings:
        # 与计价引擎保持一致：无资源明细且基价>0 时按定额基价计算直接费，
        # 否则按人材机消耗量×市场价计算，避免溯源金额与计价结果不一致。
        bound_quotas = _bound_quotas(bindings, quota_by_id)
        composed_base_price = _compose_quota_base_price(bindings, quota_by_id)
        use_base_price = _should_use_base_price_first(bound_quotas, composed_base_price)
    else:
        bound_quotas = []
        composed_base_price = 0.0
        use_base_price = False
    for b in bindings:
        q = quota_by_id.get(b.quota_item_id)
        if q:
            if use_base_price:
                binding_direct_cost = _r2(
                    (q.base_price or 0.0) * boq.quantity * (b.coefficient or 1.0)
                )
            else:
                binding_direct_cost = _r2(
                    (
                        q.labor_qty * labor_price
                        + q.material_qty * material_price
                        + q.machine_qty * machine_price
                    )
                    * boq.quantity
                    * b.coefficient
                )
            binding_refs.append(
                BindingRef(
                    binding_id=b.id,
                    coefficient=b.coefficient,
                    direct_cost=binding_direct_cost,
                    quota=QuotaRef(
                        quota_code=q.quota_code,
                        quota_name=q.name,
                        unit=q.unit,
                        labor_qty=q.labor_qty,
                        material_qty=q.material_qty,
                        machine_qty=q.machine_qty,
                    ),
                )
            )

    composed_result = None
    if bindings:
        labor_qty, material_qty, machine_qty = _compose_quota_quantities(bindings, quota_by_id)
        if labor_qty or material_qty or machine_qty:
            composed_result = calculate_line_item(
                labor_qty=labor_qty,
                labor_price=labor_price,
                material_qty=material_qty,
                material_price=material_price,
                machine_qty=machine_qty,
                machine_price=machine_price,
                quantity=boq.quantity,
                fee_config=fee_config,
            )

    calc = db.query(CalcResult).filter(CalcResult.boq_item_id == boq_item_id).first()
    calc_total = calc.total_cost if calc else (composed_result.total if composed_result else None)

    # Breakdown prefers the stored CalcResult so it matches the pricing table;
    # only fall back to recomputation when no cached result exists.
    if calc is not None:
        breakdown_source = CalcBreakdown(
            direct_cost=calc.direct_cost,
            management_fee=calc.management_fee,
            profit=calc.profit,
            regulatory_fee=calc.regulatory_fee,
            pre_tax_total=calc.pre_tax_total,
            tax=calc.tax,
            total=calc.total_cost,
        )
    elif composed_result is not None:
        breakdown_source = CalcBreakdown(
            direct_cost=composed_result.direct_cost,
            management_fee=composed_result.management_fee,
            profit=composed_result.profit,
            regulatory_fee=composed_result.regulatory_fee,
            pre_tax_total=composed_result.pre_tax_total,
            tax=composed_result.tax,
            total=composed_result.total,
        )
    else:
        breakdown_source = None
    unit_price = _r2(calc_total / boq.quantity) if calc_total is not None and boq.quantity > 0 else None

    explanation_parts = [
        f"清单项 [{boq.code}] {boq.name}，数量 {boq.quantity} {boq.unit}。",
    ]
    if binding_refs:
        explanation_parts.append(
            f"共绑定 {len(binding_refs)} 条定额，按系数组合计算。"
        )
    else:
        explanation_parts.append("⚠ 尚未绑定定额。")

    if calc_total is not None:
        explanation_parts.append(f"计算结果合计：{calc_total} 元。")
    else:
        explanation_parts.append("⚠ 尚未执行计算。")

    # Try 辅助-enhanced explanation
    static_explanation = " ".join(explanation_parts)
    zh_explanation = None
    if binding_refs:
        # generate_insight 调用添加 try/except 降级，避免辅助服务异常导致整个接口失败
        try:
            zh_explanation = generate_insight(
                context_type="provenance",
                context_data={
                    "boq_code": boq.code,
                    "boq_name": boq.name,
                    "boq_unit": boq.unit,
                    "boq_quantity": boq.quantity,
                    "bindings": [
                        {
                            "quota_code": br.quota.quota_code,
                            "quota_name": br.quota.quota_name,
                            "coefficient": br.coefficient,
                            "labor_qty": br.quota.labor_qty,
                            "material_qty": br.quota.material_qty,
                            "machine_qty": br.quota.machine_qty,
                        }
                        for br in binding_refs
                    ],
                    "calc_total": calc_total,
                    "unit_price": unit_price,
                },
            )
        except Exception:
            # 辅助服务异常时降级为静态说明
            logger.exception("generate_insight failed, fallback to static explanation")

    return CalcProvenance(
        boq_item_id=boq.id,
        boq_code=boq.code,
        boq_name=boq.name,
        boq_unit=boq.unit,
        boq_quantity=boq.quantity,
        bindings=binding_refs,
        price_snapshot=PriceSnapshot(
            labor_price=labor_price,
            material_price=material_price,
            machine_price=machine_price,
        ),
        calc_breakdown=breakdown_source,
        unit_price=unit_price,
        calc_total=calc_total,
        fee_config_snapshot=asdict(fee_config),
        explanation=zh_explanation or static_explanation,
    )
