"""Service that orchestrates a full project calculation from DB data."""

from __future__ import annotations
import logging
from collections import defaultdict

from sqlalchemy import case, or_
from sqlalchemy.orm import Session

from app.models.boq_item import BoqItem
from app.models.calc_result import CalcResult
from app.models.line_item_quota_binding import LineItemQuotaBinding
from app.models.material_price import MaterialPrice
from app.models.measure_item import MeasureItem
from app.models.project import Project
from app.models.quota_item import QuotaItem
from app.models.quota_resource_detail import QuotaResourceDetail
from app.models.quota_resource_material_mapping import QuotaResourceMaterialMapping
from app.models.rule_package import RulePackage
from app.services.pricing_engine import (
    DEFAULT_FEE_CONFIG,
    DetailedLineItemResult,
    FeeConfig,
    LineItemResult,
    ProjectSummary,
    ResourceLine,
    calculate_line_item,
    calculate_line_item_detailed,
    _r2,
)

logger = logging.getLogger(__name__)


def _compose_quota_quantities(
    bindings: list[LineItemQuotaBinding],
    quota_by_id: dict[int, QuotaItem],
) -> tuple[float, float, float]:
    """Aggregate multiple quota bindings (with coefficients) into one composed line."""
    labor_qty = 0.0
    material_qty = 0.0
    machine_qty = 0.0
    for binding in bindings:
        quota = quota_by_id.get(binding.quota_item_id)
        if not quota:
            continue
        factor = binding.coefficient if binding.coefficient is not None else 1.0
        labor_qty += quota.labor_qty * factor
        material_qty += quota.material_qty * factor
        machine_qty += quota.machine_qty * factor
    return labor_qty, material_qty, machine_qty


def _compose_quota_base_price(
    bindings: list[LineItemQuotaBinding],
    quota_by_id: dict[int, QuotaItem],
) -> float:
    """Aggregate quota base prices for imported libraries without resource quantities."""
    base_price = 0.0
    for binding in bindings:
        quota = quota_by_id.get(binding.quota_item_id)
        if not quota:
            continue
        factor = binding.coefficient if binding.coefficient is not None else 1.0
        base_price += (quota.base_price or 0.0) * factor
    return _r2(base_price)


def _bound_quotas(
    bindings: list[LineItemQuotaBinding],
    quota_by_id: dict[int, QuotaItem],
) -> list[QuotaItem]:
    return [quota for binding in bindings if (quota := quota_by_id.get(binding.quota_item_id))]


def _should_use_base_price_first(quotas: list[QuotaItem], base_price: float) -> bool:
    """Prefer imported quota base prices when no reliable resource detail exists.

    Many workbook imports store labor/material/machine fee columns in the
    aggregate quantity fields. Treating those as resource quantities and then
    multiplying by market-price fallbacks can inflate drawing auto valuations by
    two orders of magnitude. If a quota has no resource detail rows, its
    imported base price is the safer authoritative rate.
    """
    return base_price > 0 and bool(quotas) and all(not quota.has_resource_details for quota in quotas)


def _base_price_line_result(base_price: float, quantity: float, fee_config: FeeConfig | None = None) -> LineItemResult:
    base_total = _r2(base_price * quantity)
    fee = fee_config or DEFAULT_FEE_CONFIG
    # Apply standard fee rates on top of the imported quota base price,
    # so management/profit/regulatory/tax are no longer all zero.
    management_fee = _r2(base_total * fee.management_rate)
    profit = _r2(base_total * fee.profit_rate)
    regulatory_fee = _r2(base_total * fee.regulatory_rate)
    pre_tax_total = _r2(base_total + management_fee + profit + regulatory_fee)
    tax = _r2(pre_tax_total * fee.tax_rate)
    total = _r2(pre_tax_total + tax)
    return LineItemResult(
        labor_cost=0,
        material_cost=base_total,
        machine_cost=0,
        direct_cost=base_total,
        management_fee=management_fee,
        profit=profit,
        regulatory_fee=regulatory_fee,
        pre_tax_total=pre_tax_total,
        tax=tax,
        total=total,
        provenance={
            "mode": "quota_base_price",
            "formula": "sum(quota.base_price * coefficient) * boq.quantity, then apply fee rates",
            "inputs": {
                "base_price": base_price,
                "quantity": quantity,
                "management_rate": fee.management_rate,
                "profit_rate": fee.profit_rate,
                "regulatory_rate": fee.regulatory_rate,
                "tax_rate": fee.tax_rate,
            },
        },
    )


def _clear_cached_result(db: Session, cached_results: dict[int, CalcResult], boq_id: int) -> None:
    cached = cached_results.pop(boq_id, None)
    if cached is not None:
        db.delete(cached)


def _resolve_fee_config(project_id: int, db: Session) -> FeeConfig:
    """Build FeeConfig from the project's bound rule package, or default."""
    project = db.query(Project).filter(Project.id == project_id).first()
    if project and project.rule_package_id:
        rp = db.query(RulePackage).filter(RulePackage.id == project.rule_package_id).first()
        if rp:
            return FeeConfig(
                management_rate=rp.management_rate,
                profit_rate=rp.profit_rate,
                regulatory_rate=rp.regulatory_rate,
                tax_rate=rp.tax_rate,
            )
    return DEFAULT_FEE_CONFIG


def _lookup_price(
    db: Session,
    *,
    category: str,
    region: str | None,
    as_of_date: str | None = None,
) -> float | None:
    """Look up latest effective material price with region fallback.

    找不到价格时返回 None 并记录 warning，避免使用默认值 1.0 掩盖错误。
    """
    q = db.query(MaterialPrice).filter(MaterialPrice.name == category)
    if region:
        q = q.filter(or_(MaterialPrice.region == region, MaterialPrice.region == ""))
    if as_of_date:
        q = q.filter(MaterialPrice.effective_date <= as_of_date)

    mp = (
        q.order_by(
            case((MaterialPrice.region == (region or ""), 1), else_=0).desc(),
            MaterialPrice.effective_date.desc(),
            MaterialPrice.id.desc(),
        )
        .first()
    )
    if mp is None:
        logger.warning(
            "未找到材料价格记录: category=%s, region=%s, as_of_date=%s",
            category, region, as_of_date,
        )
        return None
    return mp.unit_price


def run_project_calculation(
    project_id: int,
    db: Session,
    fee_config: FeeConfig | None = None,
    incremental: bool = False,
) -> tuple[ProjectSummary, list[tuple[BoqItem, LineItemResult]]]:
    """Read all bound BOQ items for a project, calculate, persist results.

    When *incremental* is True, only recalculates items whose is_dirty flag is
    set.  Clean items reuse their cached CalcResult.
    """
    if fee_config is None:
        fee_config = _resolve_fee_config(project_id, db)

    project = db.query(Project).filter(Project.id == project_id).first()
    project_region = project.region if project else ""

    boq_items = db.query(BoqItem).filter(BoqItem.project_id == project_id).all()
    boq_ids = [b.id for b in boq_items]

    bindings_by_boq: dict[int, list[LineItemQuotaBinding]] = defaultdict(list)
    quota_by_id: dict[int, QuotaItem] = {}
    cached_results: dict[int, CalcResult] = {}

    if boq_ids:
        binding_rows = (
            db.query(LineItemQuotaBinding)
            .filter(LineItemQuotaBinding.boq_item_id.in_(boq_ids))
            .all()
        )
        for row in binding_rows:
            bindings_by_boq[row.boq_item_id].append(row)

        quota_ids = {b.quota_item_id for b in binding_rows}
        if quota_ids:
            quota_by_id = {
                q.id: q
                for q in db.query(QuotaItem).filter(QuotaItem.id.in_(quota_ids)).all()
            }

        cached_rows = (
            db.query(CalcResult)
            .filter(CalcResult.boq_item_id.in_(boq_ids))
            .order_by(CalcResult.id.asc())
            .all()
        )
        for row in cached_rows:
            if row.boq_item_id in cached_results:
                db.delete(row)
            else:
                cached_results[row.boq_item_id] = row

    labor_price = _lookup_price(db, category="人工费", region=project_region)
    material_price = _lookup_price(db, category="材料费", region=project_region)
    machine_price = _lookup_price(db, category="机械费", region=project_region)
    # 价格缺失时使用 0（_lookup_price 已记录 warning），避免使用默认值 1.0 掩盖错误
    labor_price = labor_price if labor_price is not None else 0.0
    material_price = material_price if material_price is not None else 0.0
    machine_price = machine_price if machine_price is not None else 0.0

    # Pre-load resource details for quotas that have them
    resource_details_by_quota = _load_resource_details(db, set(quota_by_id.keys()))
    # Pre-load material mappings for resource-detail pricing
    material_mappings = _load_material_mappings(db, resource_details_by_quota)

    line_results: list[tuple[BoqItem, LineItemResult]] = []
    for boq in boq_items:
        bindings = bindings_by_boq.get(boq.id, [])
        if not bindings:
            _clear_cached_result(db, cached_results, boq.id)
            continue

        if incremental and not boq.is_dirty:
            cached = cached_results.get(boq.id)
            if cached:
                line_results.append(
                    (
                        boq,
                        LineItemResult(
                            labor_cost=cached.labor_cost,
                            material_cost=cached.material_cost,
                            machine_cost=cached.machine_cost,
                            direct_cost=cached.direct_cost,
                            management_fee=cached.management_fee,
                            profit=cached.profit,
                            regulatory_fee=cached.regulatory_fee,
                            pre_tax_total=cached.pre_tax_total,
                            tax=cached.tax,
                            total=cached.total_cost,
                        ),
                    )
                )
                continue

        bound_quotas = _bound_quotas(bindings, quota_by_id)
        base_price = _compose_quota_base_price(bindings=bindings, quota_by_id=quota_by_id)

        if _should_use_base_price_first(bound_quotas, base_price):
            result = _base_price_line_result(base_price, boq.quantity, fee_config)
        else:
            # Try resource-detail mode first
            result = _try_detailed_calc(
                bindings=bindings,
                quota_by_id=quota_by_id,
                resource_details_by_quota=resource_details_by_quota,
                material_mappings=material_mappings,
                boq_quantity=boq.quantity,
                fee_config=fee_config,
                labor_price_fallback=labor_price,
                material_price_fallback=material_price,
                machine_price_fallback=machine_price,
            )

        if result is None:
            # Fallback to aggregate mode
            composed_labor_qty, composed_material_qty, composed_machine_qty = _compose_quota_quantities(
                bindings=bindings,
                quota_by_id=quota_by_id,
            )
            if composed_labor_qty == 0 and composed_material_qty == 0 and composed_machine_qty == 0:
                if base_price <= 0:
                    _clear_cached_result(db, cached_results, boq.id)
                    continue
                result = _base_price_line_result(base_price, boq.quantity, fee_config)
            else:
                result = calculate_line_item(
                    labor_qty=composed_labor_qty,
                    labor_price=labor_price,
                    material_qty=composed_material_qty,
                    material_price=material_price,
                    machine_qty=composed_machine_qty,
                    machine_price=machine_price,
                    quantity=boq.quantity,
                    fee_config=fee_config,
                )

        existing = cached_results.get(boq.id)
        if existing:
            existing.total_cost = result.total
            existing.labor_cost = result.labor_cost
            existing.material_cost = result.material_cost
            existing.machine_cost = result.machine_cost
            existing.direct_cost = result.direct_cost
            existing.management_fee = result.management_fee
            existing.profit = result.profit
            existing.regulatory_fee = result.regulatory_fee
            existing.pre_tax_total = result.pre_tax_total
            existing.tax = result.tax
        else:
            new_row = CalcResult(
                boq_item_id=boq.id,
                total_cost=result.total,
                labor_cost=result.labor_cost,
                material_cost=result.material_cost,
                machine_cost=result.machine_cost,
                direct_cost=result.direct_cost,
                management_fee=result.management_fee,
                profit=result.profit,
                regulatory_fee=result.regulatory_fee,
                pre_tax_total=result.pre_tax_total,
                tax=result.tax,
            )
            db.add(new_row)
            db.flush()
            cached_results[boq.id] = new_row

        boq.is_dirty = 0
        line_results.append((boq, result))

    db.commit()

    total_direct = _r2(sum(r.direct_cost for _, r in line_results))
    total_pre_tax = _r2(sum(r.pre_tax_total for _, r in line_results))

    # Calculate measures
    measures = db.query(MeasureItem).filter(MeasureItem.project_id == project_id).all()
    total_measures = 0.0
    for m in measures:
        if m.is_fixed:
            total_measures += m.amount
        else:
            base = total_direct if m.calc_base == "direct" else total_pre_tax
            total_measures += _r2(base * m.rate)
    total_measures = _r2(total_measures)

    line_grand = _r2(sum(r.total for _, r in line_results))

    summary = ProjectSummary(
        line_results=[r for _, r in line_results],
        total_direct=total_direct,
        total_management=_r2(sum(r.management_fee for _, r in line_results)),
        total_profit=_r2(sum(r.profit for _, r in line_results)),
        total_regulatory=_r2(sum(r.regulatory_fee for _, r in line_results)),
        total_pre_tax=total_pre_tax,
        total_tax=_r2(sum(r.tax for _, r in line_results)),
        total_measures=total_measures,
        grand_total=_r2(line_grand + total_measures),
    )

    return summary, line_results


# ---------------------------------------------------------------------------
# Resource-detail helpers
# ---------------------------------------------------------------------------

def _load_resource_details(
    db: Session,
    quota_ids: set[int],
) -> dict[int, list[QuotaResourceDetail]]:
    """Load all resource details grouped by quota_item_id."""
    if not quota_ids:
        return {}
    rows = (
        db.query(QuotaResourceDetail)
        .filter(QuotaResourceDetail.quota_item_id.in_(quota_ids))
        .all()
    )
    by_quota: dict[int, list[QuotaResourceDetail]] = defaultdict(list)
    for r in rows:
        by_quota[r.quota_item_id].append(r)
    return dict(by_quota)


def _load_material_mappings(
    db: Session,
    resource_details_by_quota: dict[int, list[QuotaResourceDetail]],
) -> dict[int, float]:
    """Load material price mappings: resource_detail_id -> resolved market price."""
    all_detail_ids: set[int] = set()
    for details in resource_details_by_quota.values():
        for d in details:
            if d.is_main_material:
                all_detail_ids.add(d.id)
    if not all_detail_ids:
        return {}

    mappings = (
        db.query(QuotaResourceMaterialMapping)
        .filter(QuotaResourceMaterialMapping.resource_detail_id.in_(all_detail_ids))
        .all()
    )
    mp_ids = {m.material_price_id for m in mappings}
    if not mp_ids:
        return {}
    prices = {
        mp.id: mp.unit_price
        for mp in db.query(MaterialPrice).filter(MaterialPrice.id.in_(mp_ids)).all()
    }
    result: dict[int, float] = {}
    for m in mappings:
        if m.material_price_id in prices:
            result[m.resource_detail_id] = prices[m.material_price_id]
    return result


def _try_detailed_calc(
    *,
    bindings: list[LineItemQuotaBinding],
    quota_by_id: dict[int, QuotaItem],
    resource_details_by_quota: dict[int, list[QuotaResourceDetail]],
    material_mappings: dict[int, float],
    boq_quantity: float,
    fee_config: FeeConfig,
    labor_price_fallback: float,
    material_price_fallback: float,
    machine_price_fallback: float,
) -> LineItemResult | None:
    """Attempt resource-detail calculation. Returns None if any bound quota lacks details."""
    all_resource_lines: list[ResourceLine] = []

    for binding in bindings:
        quota = quota_by_id.get(binding.quota_item_id)
        if not quota or not quota.has_resource_details:
            return None  # fallback to aggregate mode
        details = resource_details_by_quota.get(binding.quota_item_id)
        if not details:
            return None

        coeff = binding.coefficient if binding.coefficient is not None else 1.0
        for d in details:
            # Resolve price: mapped market price > quota base price > category fallback
            if d.is_main_material and d.id in material_mappings:
                price = material_mappings[d.id]
                source = "信息价"
            elif d.unit_price > 0:
                price = d.unit_price
                source = "定额基价"
            else:
                # Category fallback
                if d.category == "人工":
                    price = labor_price_fallback
                elif d.category == "材料":
                    price = material_price_fallback
                else:
                    price = machine_price_fallback
                source = "类别默认价"

            all_resource_lines.append(ResourceLine(
                category=d.category,
                resource_name=d.resource_name,
                spec=d.spec,
                unit=d.unit,
                quantity=d.quantity * coeff,
                unit_price=price,
                price_source=source,
            ))

    if not all_resource_lines:
        return None

    detailed = calculate_line_item_detailed(
        resource_lines=all_resource_lines,
        quantity=boq_quantity,
        fee_config=fee_config,
    )

    # Convert to LineItemResult for backward compatibility
    return LineItemResult(
        labor_cost=detailed.labor_cost,
        material_cost=detailed.material_cost,
        machine_cost=detailed.machine_cost,
        direct_cost=detailed.direct_cost,
        management_fee=detailed.management_fee,
        profit=detailed.profit,
        regulatory_fee=detailed.regulatory_fee,
        pre_tax_total=detailed.pre_tax_total,
        tax=detailed.tax,
        total=detailed.total,
        provenance=detailed.provenance,
    )
