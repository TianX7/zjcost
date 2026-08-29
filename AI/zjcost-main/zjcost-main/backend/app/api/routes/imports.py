import io
import os

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from sqlalchemy.orm import Session

from app.cache import _cache as cache
from app.db.session import get_db
from app.schemas.boq_import import BoqImportResult, BoqItemOut
from app.schemas.quota import (
    QuotaImportResult,
    QuotaItemOut,
    QuotaWorkbookInspectResult,
    QuotaWorkbookSheetOut,
)
from app.services.boq_import_service import parse_and_import
from app.services.quota_import_service import parse_and_import_resource_details
from app.services.quota_workbook_service import (
    AUTO_DISCIPLINE,
    VALID_DISCIPLINES,
    inspect_quota_workbook,
    parse_and_import_quota_with_sheets,
)

router = APIRouter(prefix="/imports", tags=["imports"])


def _max_upload_bytes() -> int:
    try:
        return max(1, int(os.getenv("MAX_UPLOAD_SIZE", str(100 * 1024 * 1024))))
    except (TypeError, ValueError):
        return 100 * 1024 * 1024


def _validate_excel_extension(filename: str | None) -> None:
    """校验上传文件扩展名必须为 .xlsx，避免处理非 Excel 文件。"""
    if not filename or not filename.lower().endswith(".xlsx"):
        raise HTTPException(
            status_code=400,
            detail="仅支持 .xlsx 格式的 Excel 文件",
        )


async def _read_limited_upload(file: UploadFile) -> bytes:
    max_bytes = _max_upload_bytes()
    contents = io.BytesIO()
    total = 0
    while True:
        chunk = await file.read(1024 * 1024)
        if not chunk:
            break
        total += len(chunk)
        if total > max_bytes:
            limit_mb = max_bytes // (1024 * 1024)
            raise HTTPException(
                status_code=413,
                detail=f"导入文件超过 {limit_mb}MB 上限，请压缩或拆分后再上传",
            )
        contents.write(chunk)
    return contents.getvalue()


@router.post("/boq", response_model=BoqImportResult)
async def import_boq(
    project_id: int = Query(..., description="Target project ID"),
    file: UploadFile = File(..., description="Excel (.xlsx) BOQ file"),
    db: Session = Depends(get_db),
) -> BoqImportResult:
    _validate_excel_extension(file.filename)
    contents = await _read_limited_upload(file)
    stats = parse_and_import(file_bytes=contents, project_id=project_id, db=db)
    items_out = [
        BoqItemOut(
            id=item.id,
            project_id=item.project_id,
            code=item.code,
            name=item.name,
            unit=item.unit,
            quantity=item.quantity,
        )
        for item in stats.items
    ]
    return BoqImportResult(imported=stats.imported, skipped=stats.skipped, items=items_out)


@router.post("/quota", response_model=QuotaImportResult)
async def import_quota(
    discipline: str = Query(
        AUTO_DISCIPLINE,
        description="Quota import mode. Use AUTO to classify by sheet name, or specify a discipline explicitly.",
    ),
    sheet_names: list[str] | None = Query(None, description="Import only the selected sheet names"),
    file: UploadFile = File(..., description="Excel (.xlsx) quota file"),
    db: Session = Depends(get_db),
) -> QuotaImportResult:
    normalized_discipline = discipline if discipline in VALID_DISCIPLINES else AUTO_DISCIPLINE
    _validate_excel_extension(file.filename)
    contents = await _read_limited_upload(file)
    stats = parse_and_import_quota_with_sheets(
        file_bytes=contents,
        db=db,
        discipline=normalized_discipline,
        sheet_names=sheet_names,
    )
    items_out = [
        QuotaItemOut(
            id=item.id,
            quota_code=item.quota_code,
            discipline=item.discipline,
            name=item.name,
            unit=item.unit,
            chapter=item.chapter,
            labor_qty=item.labor_qty,
            material_qty=item.material_qty,
            machine_qty=item.machine_qty,
            base_price=item.base_price,
        )
        for item in stats.items
    ]
    cache.invalidate("quota:")
    return QuotaImportResult(
        imported=stats.imported,
        skipped=stats.skipped,
        items=items_out,
        created=stats.created,
        updated=stats.updated,
        discipline=normalized_discipline,
    )


@router.post("/quota/sheets", response_model=QuotaWorkbookInspectResult)
async def inspect_quota_sheets(
    file: UploadFile = File(..., description="Excel (.xlsx) quota file"),
) -> QuotaWorkbookInspectResult:
    _validate_excel_extension(file.filename)
    contents = await _read_limited_upload(file)
    sheets = inspect_quota_workbook(contents)
    sheet_out = [
        QuotaWorkbookSheetOut(
            name=str(sheet["name"]),
            index=int(sheet["index"]),
            rows=int(sheet["rows"]),
            columns=int(sheet["columns"]),
            importable=bool(sheet["importable"]),
            matched_headers=list(sheet.get("matched_headers", [])),
            inferred_discipline=str(sheet.get("inferred_discipline", "土建")),
        )
        for sheet in sheets
    ]
    return QuotaWorkbookInspectResult(
        total_sheets=len(sheet_out),
        importable_sheets=sum(1 for sheet in sheet_out if sheet.importable),
        sheets=sheet_out,
    )


@router.post("/quota-resource-details")
async def import_quota_resource_details(
    file: UploadFile = File(..., description="Excel (.xlsx) quota resource detail file"),
    db: Session = Depends(get_db),
):
    _validate_excel_extension(file.filename)
    contents = await _read_limited_upload(file)
    stats = parse_and_import_resource_details(file_bytes=contents, db=db)
    return {
        "imported": stats.imported,
        "skipped": stats.skipped,
        "quotas_updated": stats.quotas_updated,
        "replaced": stats.replaced,
    }
