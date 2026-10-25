"""Undo stack service.

Provides batch operation undo by restoring project state from snapshots.
Each batch operation (e.g., bulk quota binding) creates a snapshot before execution,
allowing the user to roll back if needed.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.snapshot import Snapshot
from app.models.boq_item import BoqItem
from app.models.line_item_quota_binding import LineItemQuotaBinding
from app.models.quota_item import QuotaItem


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
        return {"error": "Snapshot not found", "status": 404}
    
    data = json.loads(snap.data_json)
    line_data = data.get("lines", [])
    
    # 快照里的 bindings 只记录了 quota_code，恢复时需要反查当前的定额主键
    code_to_quota_id = {
        code: quota_id
        for quota_id, code in db.query(QuotaItem.id, QuotaItem.quota_code).all()
    }
    
    restored_items = 0
    restored_bindings = 0
    skipped_bindings = 0
    
    for line in line_data:
        boq_id = line.get("boq_item_id")
        if not boq_id:
            continue
        
        # Restore BOQ item fields
        boq = (
            db.query(BoqItem)
            .filter(BoqItem.id == boq_id, BoqItem.project_id == project_id)
            .first()
        )
        if boq:
            for field in ("code", "name", "unit", "quantity"):
                if field in line:
                    setattr(boq, field, line[field])
            restored_items += 1
        
        # Restore bindings from snapshot
        if "bindings" in line:
            # Remove current bindings for this BOQ item
            db.query(LineItemQuotaBinding).filter(
                LineItemQuotaBinding.boq_item_id == boq_id
            ).delete()
            
            seen_quota_ids: set[int] = set()
            for bd in line.get("bindings") or []:
                quota_item_id = bd.get("quota_item_id") or code_to_quota_id.get(bd.get("quota_code"))
                if not quota_item_id:
                    # 定额已被删除或编码不存在，跳过该绑定而不是让整次恢复失败
                    skipped_bindings += 1
                    continue
                if quota_item_id in seen_quota_ids:
                    # 同一清单项重复绑定同一定额会触发唯一约束
                    skipped_bindings += 1
                    continue
                seen_quota_ids.add(quota_item_id)
                new_binding = LineItemQuotaBinding(
                    boq_item_id=boq_id,
                    quota_item_id=quota_item_id,
                    coefficient=bd.get("coefficient", 1.0),
                )
                db.add(new_binding)
                restored_bindings += 1
    
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        return {"error": f"恢复失败：数据冲突（{exc.orig}）", "status": 409}
    
    return {
        "snapshot_id": snapshot_id,
        "label": snap.label,
        "restored_items": restored_items,
        "restored_bindings": restored_bindings,
        "skipped_bindings": skipped_bindings,
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
