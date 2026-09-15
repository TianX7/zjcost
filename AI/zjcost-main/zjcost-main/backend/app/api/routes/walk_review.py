from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.walk_review import WalkReview

router = APIRouter(tags=["walk-reviews"])


class WalkReviewCreatePayload(BaseModel):
    scene_title: str = ""
    element_count: int = 0
    result: str = "passed"  # passed / needs_fix
    note: str = ""


def _review_to_dict(record: WalkReview) -> dict:
    return {
        "id": record.id,
        "scene_title": record.scene_title,
        "element_count": record.element_count,
        "result": record.result,
        "note": record.note,
        "created_at": record.created_at.isoformat() if record.created_at else "",
    }


@router.get("/walk-reviews")
def list_walk_reviews(limit: int = Query(20, ge=1, le=100), db: Session = Depends(get_db)):
    """返回模型漫游复核留痕（最近优先）。"""
    rows = (
        db.query(WalkReview)
        .order_by(WalkReview.id.desc())
        .limit(limit)
        .all()
    )
    return {"total": len(rows), "items": [_review_to_dict(row) for row in rows]}


@router.post("/walk-reviews")
def create_walk_review(payload: WalkReviewCreatePayload, db: Session = Depends(get_db)):
    """保存一次漫游复核结论（核查通过 / 待整改）。"""
    result = payload.result if payload.result in ("passed", "needs_fix") else "passed"
    record = WalkReview(
        scene_title=payload.scene_title,
        element_count=payload.element_count,
        result=result,
        note=payload.note,
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return {"ok": True, "item": _review_to_dict(record)}


@router.delete("/walk-reviews/{review_id}")
def delete_walk_review(review_id: int, db: Session = Depends(get_db)):
    """删除一条复核记录。"""
    record = db.query(WalkReview).filter(WalkReview.id == review_id).first()
    if record is None:
        raise HTTPException(status_code=404, detail=f"复核记录不存在：id={review_id}")
    db.delete(record)
    db.commit()
    return {"ok": True, "message": f"复核记录 #{review_id} 已删除"}