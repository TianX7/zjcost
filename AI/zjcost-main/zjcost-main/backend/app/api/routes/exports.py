from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.project import Project
from app.models.snapshot import Snapshot
from app.services.export_service import export_diff_report, export_valuation_report
from app.utils.headers import build_attachment_disposition

import io
import re

router = APIRouter(prefix="/exports", tags=["exports"])


def _sanitize_filename(name: str) -> str:
    """净化文件名：移除/替换文件系统与 HTTP 头中的特殊字符。"""
    if not name:
        return "unknown"
    # 替换路径分隔符、控制字符及其他不安全字符
    safe = re.sub(r'[\\/:*?"<>|\r\n\t]', "_", name)
    # 折叠连续下划线并去除首尾空白
    safe = re.sub(r"_+", "_", safe).strip("_")
    return safe or "unknown"


@router.post("/valuation-report")
def download_valuation_report(
    project_id: int,
    db: Session = Depends(get_db),
):
    """Generate and download a valuation report Excel file."""
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    file_bytes = export_valuation_report(project_id=project_id, db=db)
    # 净化 project.name 中的特殊字符，避免破坏 Content-Disposition 头
    safe_name = _sanitize_filename(project.name)
    filename = f"valuation_report_{safe_name}_{project_id}.xlsx"

    return StreamingResponse(
        io.BytesIO(file_bytes),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": build_attachment_disposition(filename)},
    )


@router.post("/diff-report")
def download_diff_report(
    snapshot_a_id: int,
    snapshot_b_id: int,
    db: Session = Depends(get_db),
):
    """Generate and download a diff report Excel file."""
    snap_a = db.query(Snapshot).filter(Snapshot.id == snapshot_a_id).first()
    snap_b = db.query(Snapshot).filter(Snapshot.id == snapshot_b_id).first()
    if not snap_a or not snap_b:
        raise HTTPException(status_code=404, detail="Snapshot not found")

    file_bytes = export_diff_report(snap_a, snap_b)
    filename = f"diff_report_{snapshot_a_id}_vs_{snapshot_b_id}.xlsx"

    return StreamingResponse(
        io.BytesIO(file_bytes),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
