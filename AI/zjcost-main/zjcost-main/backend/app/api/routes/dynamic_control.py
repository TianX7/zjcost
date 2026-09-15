import json

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.risk_simulation import RiskSimulation

router = APIRouter(tags=["dynamic-control"])


class RiskSimulationCreatePayload(BaseModel):
    weather: str = "calm"
    price: str = "flat"
    schedule: str = "normal"
    peak: float = 0
    after: float = 0
    level: str = "low"
    touched: list[str] = []
    advice: list[str] = []


def _simulation_to_dict(record: RiskSimulation) -> dict:
    touched: list[str] = []
    advice: list[str] = []
    try:
        touched = json.loads(record.touched) if record.touched else []
    except (json.JSONDecodeError, TypeError):
        touched = []
    try:
        advice = json.loads(record.advice) if record.advice else []
    except (json.JSONDecodeError, TypeError):
        advice = []
    return {
        "id": record.id,
        "weather": record.weather,
        "price": record.price,
        "schedule": record.schedule,
        "peak": record.peak,
        "after": record.after,
        "level": record.level,
        "touched": touched,
        "advice": advice,
        "created_at": record.created_at.isoformat() if record.created_at else "",
    }


@router.get("/control/simulations")
def list_simulations(limit: int = Query(20, ge=1, le=100), db: Session = Depends(get_db)):
    """返回风险模拟历史（最近优先）。"""
    rows = (
        db.query(RiskSimulation)
        .order_by(RiskSimulation.id.desc())
        .limit(limit)
        .all()
    )
    return {"total": len(rows), "items": [_simulation_to_dict(row) for row in rows]}


@router.post("/control/simulations")
def create_simulation(payload: RiskSimulationCreatePayload, db: Session = Depends(get_db)):
    """保存一轮风险模拟结果，用于留痕与回看。"""
    record = RiskSimulation(
        weather=payload.weather,
        price=payload.price,
        schedule=payload.schedule,
        peak=payload.peak,
        after=payload.after,
        level=payload.level,
        touched=json.dumps(payload.touched, ensure_ascii=False),
        advice=json.dumps(payload.advice, ensure_ascii=False),
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return {"ok": True, "item": _simulation_to_dict(record)}


@router.delete("/control/simulations/{simulation_id}")
def delete_simulation(simulation_id: int, db: Session = Depends(get_db)):
    """删除一条模拟历史记录。"""
    record = db.query(RiskSimulation).filter(RiskSimulation.id == simulation_id).first()
    if record is None:
        raise HTTPException(status_code=404, detail=f"模拟记录不存在：id={simulation_id}")
    db.delete(record)
    db.commit()
    return {"ok": True, "message": f"模拟记录 #{simulation_id} 已删除"}