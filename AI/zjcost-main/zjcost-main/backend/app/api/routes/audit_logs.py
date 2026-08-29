from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.audit_log import AuditLog
from app.schemas.audit_log import AuditLogOut

router = APIRouter(tags=["audit-logs"])


@router.get("/projects/{project_id}/audit-logs", response_model=list[AuditLogOut])
def list_audit_logs(
    project_id: int,
    page: int = Query(1, ge=1, description="页码，从 1 开始"),
    page_size: int = Query(50, ge=1, le=500, description="每页条数，最大 500"),
    db: Session = Depends(get_db),
) -> list[AuditLogOut]:
    # 添加分页参数，避免一次性返回过多记录
    rows = (
        db.query(AuditLog)
        .filter(AuditLog.project_id == project_id)
        .order_by(AuditLog.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return [
        AuditLogOut(
            id=r.id,
            project_id=r.project_id,
            actor=r.actor,
            action=r.action,
            resource_type=r.resource_type,
            resource_id=r.resource_id,
            before_json=r.before_json,
            after_json=r.after_json,
            timestamp=r.timestamp,
        )
        for r in rows
    ]



@router.get("/projects/{project_id}/audit-logs.pdf")
def export_audit_pdf(project_id: int, db: Session = Depends(get_db)):
    """Export audit logs as a PDF report for the project."""
    from fastapi.responses import Response
    from app.services.audit_export_service import export_audit_report_pdf

    try:
        pdf_bytes = export_audit_report_pdf(project_id, db)
    except ValueError:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Project not found")

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f"attachment; filename=audit_report_project_{project_id}.pdf"
        },
    )
