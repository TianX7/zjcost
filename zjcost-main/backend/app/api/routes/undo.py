"""Undo stack API routes.

Provides endpoints for listing, restoring, and creating undo snapshots.
"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.services.undo_stack_service import (
    list_undo_snapshots,
    push_undo_snapshot,
    restore_from_snapshot,
)

router = APIRouter(prefix="/undo", tags=["undo"])


class UndoSnapshotCreate(BaseModel):
    label: str


class UndoRestoreResponse(BaseModel):
    snapshot_id: int
    label: str
    restored_items: int
    restored_bindings: int
    snapshot_time: str | None = None


@router.get("/projects/{project_id}/snapshots")
def get_undo_snapshots(project_id: int, db: Session = Depends(get_db)):
    """List available undo snapshots for a project."""
    return list_undo_snapshots(project_id, db)


@router.post("/projects/{project_id}/snapshots")
def create_undo_snapshot(
    project_id: int,
    body: UndoSnapshotCreate,
    db: Session = Depends(get_db),
):
    """Create an undo point before a batch operation."""
    snap = push_undo_snapshot(project_id=project_id, label=body.label, db=db)
    return {"id": snap.id, "label": snap.label, "created_at": snap.created_at.isoformat() if snap.created_at else None}


@router.post("/projects/{project_id}/restore/{snapshot_id}", response_model=UndoRestoreResponse)
def restore_undo_snapshot(
    project_id: int,
    snapshot_id: int,
    db: Session = Depends(get_db),
):
    """Restore project state from an undo snapshot."""
    result = restore_from_snapshot(project_id, snapshot_id, db)
    if "error" in result:
        raise HTTPException(status_code=404, detail=result["error"])
    return result
