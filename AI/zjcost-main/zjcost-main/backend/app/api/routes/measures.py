from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.measure_item import MeasureItem
from app.models.project import Project
from app.schemas.measure import MeasureItemCreate, MeasureItemOut

router = APIRouter(tags=["measures"])


def _must_get_project(project_id: int, db: Session) -> Project:
    """校验项目存在性，不存在则抛 404。"""
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


@router.post("/projects/{project_id}/measures", response_model=MeasureItemOut)
def create_measure(
    project_id: int,
    payload: MeasureItemCreate,
    db: Session = Depends(get_db),
) -> MeasureItemOut:
    # 校验项目存在
    _must_get_project(project_id, db)
    m = MeasureItem(
        project_id=project_id,
        name=payload.name,
        calc_base=payload.calc_base,
        rate=payload.rate,
        amount=payload.amount,
        is_fixed=int(payload.is_fixed),
    )
    db.add(m)
    db.commit()
    db.refresh(m)
    return _to_out(m)


@router.get("/projects/{project_id}/measures", response_model=list[MeasureItemOut])
def list_measures(
    project_id: int,
    db: Session = Depends(get_db),
) -> list[MeasureItemOut]:
    rows = db.query(MeasureItem).filter(MeasureItem.project_id == project_id).all()
    return [_to_out(r) for r in rows]


@router.delete("/projects/{project_id}/measures/{measure_id}")
def delete_measure(
    project_id: int,
    measure_id: int,
    db: Session = Depends(get_db),
):
    row = db.query(MeasureItem).filter(
        MeasureItem.id == measure_id, MeasureItem.project_id == project_id,
    ).first()
    if not row:
        raise HTTPException(status_code=404, detail="Measure item not found")
    db.delete(row)
    db.commit()
    return {"ok": True}


def _to_out(m: MeasureItem) -> MeasureItemOut:
    return MeasureItemOut(
        id=m.id,
        project_id=m.project_id,
        name=m.name,
        calc_base=m.calc_base,
        rate=m.rate,
        amount=m.amount,
        is_fixed=bool(m.is_fixed),
    )
