"""Audit log helper."""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.models.audit_log import AuditLog

logger = logging.getLogger(__name__)


def write_audit_log(
    db: Session,
    *,
    project_id: int,
    action: str,
    resource_type: str,
    resource_id: int | None = None,
    actor: str = "system",
    before_json: str | None = None,
    after_json: str | None = None,
) -> AuditLog:
    log = AuditLog(
        project_id=project_id,
        actor=actor,
        action=action,
        resource_type=resource_type,
        resource_id=resource_id,
        before_json=before_json,
        after_json=after_json,
        # timestamp 字段为 DateTime 类型，需传入 datetime 对象而非 isoformat 字符串
        timestamp=datetime.now(timezone.utc),
    )
    db.add(log)
    try:
        # 仅 flush 让调用方控制事务提交，避免污染调用方未完成的事务
        db.flush()
        db.refresh(log)
    except Exception:
        db.rollback()
        raise
    return log
