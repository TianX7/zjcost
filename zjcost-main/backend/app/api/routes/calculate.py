from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.boq_item import BoqItem
from app.models.calc_result import CalcResult
from app.models.line_item_quota_binding import LineItemQuotaBinding
from app.models.project import Project
from app.schemas.calc_result import LineCalcResultOut, ProjectCalcSummary
from app.schemas.calculate import CalculateRequest, CalculateResponse
from app.services.pricing_engine import calculate_line_item_total
from app.services.project_calc_service import run_project_calculation

router = APIRouter(tags=["calculate"])


# --- Lightweight read-only cached summary ----------------------------------

@router.get("/projects/{project_id}/calc-summary", response_model=ProjectCalcSummary)
def get_calc_summary(
    project_id: int,
    db: Session = Depends(get_db),
) -> ProjectCalcSummary:
    """Return cached calculation totals without re-running the calculation."""
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    latest_calc_ids = (
        db.query(func.max(CalcResult.id).label("id"))
        .join(BoqItem, CalcResult.boq_item_id == BoqItem.id)
        .join(LineItemQuotaBinding, LineItemQuotaBinding.boq_item_id == BoqItem.id)
        .filter(BoqItem.project_id == project_id)
        .group_by(CalcResult.boq_item_id)
        .subquery()
    )
    rows = (
        db.query(CalcResult, BoqItem)
        .join(latest_calc_ids, CalcResult.id == latest_calc_ids.c.id)
        .join(BoqItem, CalcResult.boq_item_id == BoqItem.id)
        .all()
    )

    # total_cost 可能为 None，使用 or 0 兜底
    grand_total = sum(r.CalcResult.total_cost or 0 for r in rows)

    line_results = [
        LineCalcResultOut(
            boq_item_id=r.CalcResult.boq_item_id,
            boq_code=r.BoqItem.code,
            boq_name=r.BoqItem.name,
            labor_cost=r.CalcResult.labor_cost,
            material_cost=r.CalcResult.material_cost,
            machine_cost=r.CalcResult.machine_cost,
            direct_cost=r.CalcResult.direct_cost,
            management_fee=r.CalcResult.management_fee,
            profit=r.CalcResult.profit,
            regulatory_fee=r.CalcResult.regulatory_fee,
            pre_tax_total=r.CalcResult.pre_tax_total,
            tax=r.CalcResult.tax,
            total=r.CalcResult.total_cost,
        )
        for r in rows
    ]

    return ProjectCalcSummary(
        total_direct=sum(r.direct_cost for r in line_results),
        total_management=sum(r.management_fee for r in line_results),
        total_profit=sum(r.profit for r in line_results),
        total_regulatory=sum(r.regulatory_fee for r in line_results),
        total_pre_tax=sum(r.pre_tax_total for r in line_results),
        total_tax=sum(r.tax for r in line_results),
        total_measures=0,
        grand_total=grand_total,
        line_results=line_results,
    )


# --- Legacy simple endpoint (kept for quick testing) -----------------------

@router.post("/calculate/run", response_model=CalculateResponse)
def run_calculate(payload: CalculateRequest) -> CalculateResponse:
    total = calculate_line_item_total(
        labor_qty=payload.labor_qty,
        labor_price=payload.labor_price,
        material_qty=payload.material_qty,
        material_price=payload.material_price,
        machine_qty=payload.machine_qty,
        machine_price=payload.machine_price,
    )
    return CalculateResponse(total=total, currency="CNY")


# --- Real project calculation ----------------------------------------------

@router.post("/projects/{project_id}/calculate:dirty", response_model=ProjectCalcSummary)
def calculate_dirty_items(
    project_id: int,
    db: Session = Depends(get_db),
) -> ProjectCalcSummary:
    """Incremental recalc — only recompute BOQ items with is_dirty=1."""
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    dirty_count = (
        db.query(BoqItem)
        .filter(BoqItem.project_id == project_id, BoqItem.is_dirty == 1)
        .count()
    )
    summary, line_results = run_project_calculation(
        project_id=project_id, db=db, incremental=True,
    )

    lines_out = [
        LineCalcResultOut(
            boq_item_id=boq.id, boq_code=boq.code, boq_name=boq.name,
            labor_cost=result.labor_cost, material_cost=result.material_cost,
            machine_cost=result.machine_cost, direct_cost=result.direct_cost,
            management_fee=result.management_fee, profit=result.profit,
            regulatory_fee=result.regulatory_fee,
            pre_tax_total=result.pre_tax_total, tax=result.tax, total=result.total,
        )
        for boq, result in line_results
    ]
    return ProjectCalcSummary(
        total_direct=summary.total_direct, total_management=summary.total_management,
        total_profit=summary.total_profit, total_regulatory=summary.total_regulatory,
        total_pre_tax=summary.total_pre_tax, total_tax=summary.total_tax,
        total_measures=summary.total_measures, grand_total=summary.grand_total,
        line_results=lines_out,
    )


@router.post("/projects/{project_id}/calculate", response_model=ProjectCalcSummary)
def calculate_project(
    project_id: int,
    db: Session = Depends(get_db),
) -> ProjectCalcSummary:
    """Run full calculation for all bound BOQ items in a project."""
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    summary, line_results = run_project_calculation(project_id=project_id, db=db)

    lines_out = [
        LineCalcResultOut(
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
        for boq, result in line_results
    ]

    return ProjectCalcSummary(
        total_direct=summary.total_direct,
        total_management=summary.total_management,
        total_profit=summary.total_profit,
        total_regulatory=summary.total_regulatory,
        total_pre_tax=summary.total_pre_tax,
        total_tax=summary.total_tax,
        total_measures=summary.total_measures,
        grand_total=summary.grand_total,
        line_results=lines_out,
    )
