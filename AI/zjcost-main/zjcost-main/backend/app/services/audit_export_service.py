"""Audit report PDF export service.

Generates a professional PDF report of audit logs for a project,
suitable for submission during price negotiation or audit review.
"""

from __future__ import annotations

import io
from datetime import datetime, timezone
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
from sqlalchemy.orm import Session

from app.models.audit_log import AuditLog
from app.models.project import Project


def export_audit_report_pdf(
    project_id: int,
    db: Session,
) -> bytes:
    """Generate an audit report PDF for the given project.
    
    Returns the PDF file content as bytes.
    """
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise ValueError(f"Project {project_id} not found")
    
    logs = (
        db.query(AuditLog)
        .filter(AuditLog.project_id == project_id)
        .order_by(AuditLog.created_at.desc())
        .limit(500)
        .all()
    )
    
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=A4,
        leftMargin=20 * mm,
        rightMargin=20 * mm,
        topMargin=20 * mm,
        bottomMargin=20 * mm,
    )
    
    styles = getSampleStyleSheet()
    
    # Custom styles
    title_style = ParagraphStyle(
        "AuditTitle",
        parent=styles["Title"],
        fontSize=18,
        spaceAfter=6 * mm,
        textColor=colors.HexColor("#1a3a5c"),
    )
    subtitle_style = ParagraphStyle(
        "AuditSubtitle",
        parent=styles["Normal"],
        fontSize=10,
        textColor=colors.grey,
        spaceAfter=10 * mm,
    )
    section_style = ParagraphStyle(
        "SectionHeader",
        parent=styles["Heading2"],
        fontSize=13,
        textColor=colors.HexColor("#2d5f8a"),
        spaceBefore=8 * mm,
        spaceAfter=4 * mm,
    )
    
    elements = []
    
    # Title
    elements.append(Paragraph("审计追溯报告", title_style))
    elements.append(Paragraph(
        f"项目：{project.name}  |  生成时间：{datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}",
        subtitle_style,
    ))
    
    # Summary table
    summary_data = [
        ["指标", "数值"],
        ["项目名称", project.name or "—"],
        ["地区/规则包", getattr(project, "region", "—") or "—"],
        ["审计日志条数", str(len(logs))],
        ["创建时间", project.created_at.strftime("%Y-%m-%d") if project.created_at else "—"],
    ]
    summary_table = Table(summary_data, colWidths=[45 * mm, 100 * mm])
    summary_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#2d5f8a")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#cccccc")),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f5f8fc")]),
    ]))
    elements.append(summary_table)
    elements.append(Spacer(1, 8 * mm))
    
    # Detailed audit logs
    elements.append(Paragraph("操作审计明细", section_style))
    
    if logs:
        # Build table data
        header = ["时间", "操作者", "操作", "对象", "变更前", "变更后"]
        table_data = [header]
        
        for log in logs[:200]:  # Cap at 200 rows for PDF readability
            row = [
                log.created_at.strftime("%m-%d %H:%M") if log.created_at else "—",
                str(getattr(log, "user_id", "") or "系统"),
                str(getattr(log, "action", "") or "")[:20],
                str(getattr(log, "target_type", "") or "")[:15],
                str(getattr(log, "old_value", "") or "")[:30],
                str(getattr(log, "new_value", "") or "")[:30],
            ]
            table_data.append(row)
        
        log_table = Table(table_data, colWidths=[22 * mm, 18 * mm, 28 * mm, 22 * mm, 32 * mm, 32 * mm])
        log_table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#2d5f8a")),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTSIZE", (0, 0), (-1, -1), 7),
            ("GRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#cccccc")),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#fafafa")]),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ]))
        elements.append(log_table)
    else:
        elements.append(Paragraph("暂无审计日志记录。", styles["Normal"]))
    
    # Footer note
    elements.append(Spacer(1, 10 * mm))
    footer_style = ParagraphStyle("Footer", parent=styles["Normal"], fontSize=8, textColor=colors.grey)
    elements.append(Paragraph(
        "本报告由筑衡(zjcost)系统自动生成，用于造价审计追溯参考。",
        footer_style,
    ))
    
    doc.build(elements)
    return buf.getvalue()
