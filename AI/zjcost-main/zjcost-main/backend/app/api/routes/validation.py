"""Validation API — rule checks and audit report export."""

import io

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.schemas.validation import ValidationIssueOut, ValidationReport
from app.services.validation_service import Severity, validate_project
from app.utils.headers import build_attachment_disposition

router = APIRouter(tags=["validation"])


@router.get(
    "/projects/{project_id}/validation-issues",
    response_model=ValidationReport,
)
def get_validation_issues(
    project_id: int,
    db: Session = Depends(get_db),
) -> ValidationReport:
    """Run validation rules and return all issues for a project."""
    issues = validate_project(project_id=project_id, db=db)
    return ValidationReport(
        project_id=project_id,
        total_issues=len(issues),
        errors=sum(1 for i in issues if i.severity == Severity.ERROR),
        warnings=sum(1 for i in issues if i.severity == Severity.WARNING),
        issues=[
            ValidationIssueOut(
                code=i.code,
                severity=i.severity.value,
                boq_item_id=i.boq_item_id,
                message=i.message,
                suggestion=i.suggestion,
            )
            for i in issues
        ],
    )


@router.get("/projects/{project_id}/audit-report/export")
def export_audit_report(
    project_id: int,
    format: str = Query("pdf", description="Export format: pdf or excel"),
    db: Session = Depends(get_db),
):
    """导出复核审计报告（规则问题 + 计价审查 + 计价标准），支持 pdf / excel。"""
    from app.services.audit_report_export_service import (
        export_audit_report_excel,
        export_audit_report_pdf,
    )

    from app.models.project import Project

    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    if format == "excel":
        file_bytes = export_audit_report_excel(project_id=project_id, db=db)
        filename = f"audit_report_{project_id}.xlsx"
        media_type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    elif format == "pdf":
        file_bytes = export_audit_report_pdf(project_id=project_id, db=db)
        filename = f"audit_report_{project_id}.pdf"
        media_type = "application/pdf"
    else:
        raise HTTPException(status_code=400, detail=f"Unsupported format: {format}")

    return StreamingResponse(
        io.BytesIO(file_bytes),
        media_type=media_type,
        headers={"Content-Disposition": build_attachment_disposition(filename)},
    )
