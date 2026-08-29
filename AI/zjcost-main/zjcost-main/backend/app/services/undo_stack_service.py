"""Undo stack service.

Provides batch operation undo by restoring project state from snapshots.
Each batch operation (e.g., bulk quota binding) creates a snapshot before execution,
allowing the user to roll back if needed.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.orm import Session

from app.models.snapshot import Snapshot
from app.models.boq_item import BoqItem
from app.models.line_item_quota_binding import LineItemQuotaBinding


# Maximum undo depth per project
MAX_UNDO_DEPTH = 20


def push_undo_snapshot(
    project_id: int,
    label: str,
    db: Session,
) -> Snapshot:
    """Create a snapshot before a batch operation, tagged as an undo point.
    
    The label should describe the operation, e.g., "批量绑定定额 x12"
    """
    from app.services.snapshot_service import create_snapshot
    snap = create_snapshot(project_id=project_id, label=f"[undo] {label}", db=db)
    
    # Trim old undo snapshots to MAX_UNDO_DEPTH
    undo_snaps = (
        db.query(Snapshot)
        .filter(Snapshot.project_id == project_id, Snapshot.label.like("[undo]%"))
        .order_by(Snapshot.created_at.desc())
        .all()
    )
    for old in undo_snaps[MAX_UNDO_DEPTH:]:
        db.delete(old)
    db.commit()
    
    return snap


def restore_from_snapshot(
    project_id: int,
    snapshot_id: int,
    db: Session,
) -> dict[str, Any]:
    """Restore BOQ items and bindings from a snapshot.
    
    Returns a summary of what was restored.
    """
    snap = db.query(Snapshot).filter(
        Snapshot.id == snapshot_id,
        Snapshot.project_id == project_id,
    ).first()
    
    if not snap:
        return {"error": "Snapshot not found"}
    
    data = json.loads(snap.data_json)
    line_data = data.get("lines", [])
    
    restored_items = 0
    restored_bindings = 0
    
    for line in line_data:
        boq_id = line.get("boq_item_id")
        if not boq_id:
            continue
        
        # Restore BOQ item fields
        boq = db.query(BoqItem).filter(BoqItem.id == boq_id).first()
        if boq:
            for field in ("name", "description", "unit", "quantity", "specialty", "chapter"):
                if field in line:
                    setattr(boq, field, line[field])
            restored_items += 1
        
        # Restore bindings from snapshot
        bindings_data = line.get("bindings", [])
        if bindings_data:
            # Remove current bindings for this BOQ item
            db.query(LineItemQuotaBinding).filter(
                LineItemQuotaBinding.boq_item_id == boq_id
            ).delete()
            
            for bd in bindings_data:
                new_binding = LineItemQuotaBinding(
                    boq_item_id=boq_id,
                    quota_item_id=bd.get("quota_item_id"),
                    coefficient=bd.get("coefficient", 1.0),
                )
                db.add(new_binding)
                restored_bindings += 1
    
    db.commit()
    
    return {
        "snapshot_id": snapshot_id,
        "label": snap.label,
        "restored_items": restored_items,
        "restored_bindings": restored_bindings,
        "snapshot_time": snap.created_at.isoformat() if snap.created_at else None,
    }


def list_undo_snapshots(
    project_id: int,
    db: Session,
) -> list[dict[str, Any]]:
    """List available undo snapshots for a project."""
    snaps = (
        db.query(Snapshot)
        .filter(Snapshot.project_id == project_id, Snapshot.label.like("[undo]%"))
        .order_by(Snapshot.created_at.desc())
        .limit(MAX_UNDO_DEPTH)
        .all()
    )
    
    return [
        {
            "id": s.id,
            "label": s.label.replace("[undo] ", ""),
            "created_at": s.created_at.isoformat() if s.created_at else None,
            "grand_total": s.grand_total,
        }
        for s in snaps
    ]
