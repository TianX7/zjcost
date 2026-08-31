"""Drawing recognition API: upload a drawing, then poll for parsed results."""

from __future__ import annotations

import logging
import threading
import io
import math
import os
import re
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, File, HTTPException, Query, UploadFile
from fastapi.responses import StreamingResponse
from starlette.concurrency import run_in_threadpool
import openpyxl
from openpyxl.styles import Alignment, Font, PatternFill
from pydantic import BaseModel, Field

from app.db.session import session_scope
from app.schemas.calc_result import ProjectCalcSummary
from app.services.drawing_recognition_service import (
    components_to_boq_suggestions,
    recognize_drawing,
)
from app.services.drawing_valuation_service import create_valuation_from_drawing
from app.services.dxf_analysis_service import analyze_dxf_bytes
from app.services.dwg_conversion_service import convert_dxf_to_dwg_bytes, get_converter_status
from app.services.task_store import load_background_task, save_background_task
from app.utils.datetime import parse_datetime
from app.utils.headers import build_attachment_disposition, sanitize_filename

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/drawing-recognition", tags=["drawing-recognition"])

_tasks: dict[str, dict] = {}
_tasks_lock = threading.Lock()
_drawing_valuation_slots = threading.BoundedSemaphore(value=1)
_UPLOAD_READ_CHUNK_SIZE = 1024 * 1024
_TASK_TYPE = "drawing_recognition"
# 内存中任务缓存 TTL：7 天，避免 _tasks 字典无限增长
_TASK_TTL_SECONDS = 7 * 24 * 60 * 60


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        return default


def _max_upload_bytes() -> int:
    if "DRAWING_MAX_UPLOAD_MB" in os.environ:
        return max(1, _env_int("DRAWING_MAX_UPLOAD_MB", 100)) * 1024 * 1024
    return max(1, _env_int("MAX_UPLOAD_SIZE", 100 * 1024 * 1024))


def _max_auto_valuation_suggestions() -> int:
    return max(1, _env_int("DRAWING_MAX_AUTO_VALUATION_SUGGESTIONS", 1200))


def _reject_if_too_large(file_bytes: bytes) -> None:
    max_bytes = _max_upload_bytes()
    if len(file_bytes) > max_bytes:
        limit_mb = max_bytes // (1024 * 1024)
        raise HTTPException(status_code=413, detail=f"图纸文件超过 {limit_mb}MB 上限，请压缩或拆分后再上传")


async def _read_upload_bytes_limited(file: UploadFile) -> bytes:
    max_bytes = _max_upload_bytes()
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = await file.read(_UPLOAD_READ_CHUNK_SIZE)
        if not chunk:
            break
        total += len(chunk)
        if total > max_bytes:
            limit_mb = max_bytes // (1024 * 1024)
            raise HTTPException(
                status_code=413,
                detail=(
                    f"\u56fe\u7eb8\u6587\u4ef6\u8d85\u8fc7 {limit_mb}MB "
                    "\u4e0a\u9650\uff0c\u8bf7\u538b\u7f29\u6216\u62c6\u5206\u540e\u518d\u4e0a\u4f20"
                ),
            )
        chunks.append(chunk)
    return b"".join(chunks)


class ComponentOut(BaseModel):
    id: str
    type: str
    count: int
    spec: str
    confidence: float
    material: str = ""
    unit: str = ""
    quantity_estimate: float = 0.0
    length_m: float = 0.0
    area_m2: float = 0.0
    layers: list[str] = Field(default_factory=list)
    calc_note: str = ""


class BoqSuggestionOut(BaseModel):
    source_component_id: str
    suggested_code: str
    suggested_name: str
    suggested_unit: str
    suggested_quantity: float
    characteristics: str
    confidence: float
    material: str = ""
    component_count: int = 0


class LayerSummaryOut(BaseModel):
    layer: str
    count: int
    classified_as: str = ""
    entity_types: dict[str, int] = Field(default_factory=dict)


class DrawingValuationItemOut(BaseModel):
    boq_item_id: int
    code: str
    name: str
    unit: str
    quantity: float
    quota_item_id: int | None = None
    quota_code: str = ""
    quota_name: str = ""
    match_confidence: float = 0.0
    match_reason: str = ""
    match_reasons: list[str] = Field(default_factory=list)
    status: str = "skipped"
    total: float = 0.0


class DrawingValuationReviewItemOut(BaseModel):
    severity: str = "warning"
    category: str = ""
    message: str = ""
    suggestion: str = ""
    boq_item_id: int | None = None
    code: str = ""
    name: str = ""


class DrawingValuationOut(BaseModel):
    project_id: int | None = None
    project_name: str = ""
    boq_items_created: int = 0
    matched: int = 0
    skipped: int = 0
    grand_total: float = 0.0
    total_direct: float = 0.0
    items: list[DrawingValuationItemOut] = Field(default_factory=list)
    calc_summary: ProjectCalcSummary | None = None
    review_items: list[DrawingValuationReviewItemOut] = Field(default_factory=list)
    review_summary: dict[str, int] = Field(default_factory=dict)
    error: Optional[str] = None


class TaskStatusResponse(BaseModel):
    taskId: str
    status: str
    drawing_type: str = ""
    summary: str = ""
    components: list[ComponentOut] = Field(default_factory=list)
    boq_suggestions: list[BoqSuggestionOut] = Field(default_factory=list)
    diagnostics: list[str] = Field(default_factory=list)
    layer_summary: list[LayerSummaryOut] = Field(default_factory=list)
    disciplines: list[dict] = Field(default_factory=list)
    quality_score: Optional[dict] = None
    preview_svg: str = ""
    preview_svg_hd: str = ""
    valuation: DrawingValuationOut | None = None
    valuation_status: str = "idle"
    valuation_progress: str = ""
    valuation_progress_percent: int = 0
    valuation_error: Optional[str] = None
    progress: str = ""
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
    error: Optional[str] = None


class ConverterCandidateOut(BaseModel):
    name: str
    kind: str
    source: str
    bundled: bool = False


class ConverterStatusResponse(BaseModel):
    dxf_to_dwg: bool
    dwg_to_dxf: bool
    candidates: dict[str, list[ConverterCandidateOut]]
    bundled_dirs: list[str] = Field(default_factory=list)
    timeout_seconds: int = 0
    instructions: str = ""


def _dump_model(model: BaseModel) -> dict:
    if hasattr(model, "model_dump"):
        return model.model_dump()
    return model.dict()


def _json_safe(value):
    if isinstance(value, float):
        return value if math.isfinite(value) else 0.0
    if isinstance(value, dict):
        return {str(k): _json_safe(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_json_safe(item) for item in value]
    if isinstance(value, tuple):
        return [_json_safe(item) for item in value]
    return value


def _cleanup_expired_tasks() -> None:
    """清理内存中超过 TTL 的已完成/失败任务，避免无限增长。"""
    cutoff = datetime.now(timezone.utc).timestamp() - _TASK_TTL_SECONDS
    with _tasks_lock:
        expired = [
            task_id
            for task_id, task in _tasks.items()
            if task.get("status") in ("completed", "failed")
            and (parse_datetime(task.get("updated_at", task.get("created_at"))) or datetime(1970, 1, 1, tzinfo=timezone.utc)).timestamp() < cutoff
        ]
        for task_id in expired:
            _tasks.pop(task_id, None)


def _store_result(task_id: str, payload: dict) -> None:
    _cleanup_expired_tasks()
    with _tasks_lock:
        if task_id not in _tasks:
            return
        payload["updated_at"] = datetime.now(timezone.utc).isoformat()
        _tasks[task_id].update(_json_safe(payload))
        snapshot = dict(_tasks[task_id])
    save_background_task(task_id, _TASK_TYPE, snapshot)


def _get_task(task_id: str) -> dict | None:
    _cleanup_expired_tasks()
    with _tasks_lock:
        task = _tasks.get(task_id)
        if task is not None:
            return dict(task)

    task = load_background_task(task_id, _TASK_TYPE)
    if task is None:
        return None
    with _tasks_lock:
        _tasks[task_id] = dict(task)
    return dict(task)


def _valuation_progress_percent(message: str) -> int:
    if "完成" in message:
        return 100
    if "计算项目造价" in message:
        return 90
    if "整理结果" in message:
        return 95
    match = re.search(r"写入清单项\s+(\d+)/(\d+)", message)
    if match:
        current, total = int(match.group(1)), max(int(match.group(2)), 1)
        return min(35, 8 + round(current / total * 27))
    match = re.search(r"匹配定额\s+(\d+)/(\d+)", message)
    if match:
        current, total = int(match.group(1)), max(int(match.group(2)), 1)
        return min(88, 40 + round(current / total * 48))
    if "读取定额库" in message:
        return 38
    if "创建计价项目" in message:
        return 8
    return 5


def _safe_report_filename(task_id: str, suffix: str) -> str:
    safe_id = "".join(ch for ch in task_id if ch.isalnum() or ch == "-")[:36] or "drawing"
    return f"drawing_quantities_{safe_id}.{suffix}"


def _auto_valuate_suggestions(task_id: str, suggestions: list[dict], progress_callback=None) -> dict:
    try:
        with session_scope() as db:
            return create_valuation_from_drawing(
                db=db,
                boq_suggestions=suggestions,
                task_id=task_id,
                progress_callback=progress_callback,
            )
    except Exception as exc:
        logger.exception("Drawing auto valuation failed task_id=%s: %s", task_id, exc)
        return {
            "project_id": None,
            "project_name": "",
            "boq_items_created": 0,
            "matched": 0,
            "skipped": 0,
            "grand_total": 0.0,
            "total_direct": 0.0,
            "items": [],
            "calc_summary": None,
            "error": f"自动计价失败: {exc}",
        }


def _run_drawing_valuation(task_id: str) -> None:
    acquired = _drawing_valuation_slots.acquire(blocking=False)
    if not acquired:
        _store_result(task_id, {
            "valuation_status": "error",
            "valuation_error": "已有自动计价任务正在运行，识别结果已保留。请稍后在项目中重新计价或重新上传。",
            "valuation_progress": "等待计价资源失败",
            "valuation_progress_percent": 0,
        })
        return

    try:
        with _tasks_lock:
            task = _tasks.get(task_id)
            suggestions = list(task.get("boq_suggestions", [])) if task else []

        if not suggestions:
            _store_result(task_id, {
                "valuation_status": "skipped",
                "valuation_error": "没有可计价的清单建议。",
                "valuation_progress": "未生成可计价清单",
                "valuation_progress_percent": 0,
            })
            return

        limit = _max_auto_valuation_suggestions()
        if len(suggestions) > limit:
            error = f"清单建议 {len(suggestions)} 条，超过自动计价上限 {limit} 条。请先导出筛选，或保存项目后分批计价。"
            _store_result(task_id, {
                "valuation_status": "error",
                "valuation_error": error,
                "valuation_progress": "自动计价已跳过",
                "valuation_progress_percent": 0,
            })
            return

        def _progress(message: str) -> None:
            _store_result(task_id, {
                "valuation_status": "processing",
                "valuation_progress": message,
                "valuation_progress_percent": _valuation_progress_percent(message),
            })

        _store_result(task_id, {
            "valuation_status": "processing",
            "valuation_error": None,
            "valuation_progress": "正在创建计价项目并匹配定额...",
            "valuation_progress_percent": 5,
        })
        valuation = _auto_valuate_suggestions(task_id, suggestions, _progress)
        valuation_error = valuation.get("error")
        has_project = bool(valuation.get("project_id"))
        _store_result(task_id, {
            "valuation": valuation,
            "valuation_status": "done" if has_project else "error",
            "valuation_error": valuation_error,
            "valuation_progress": "自动计价完成" if has_project else (valuation_error or "自动计价未生成项目"),
            "valuation_progress_percent": 100 if has_project else 0,
        })
    except Exception as exc:
        logger.exception("Drawing valuation task failed task_id=%s: %s", task_id, exc)
        _store_result(task_id, {
            "valuation_status": "error",
            "valuation_error": f"自动计价失败: {exc}",
            "valuation_progress": "自动计价失败",
            "valuation_progress_percent": 0,
        })
    finally:
        _drawing_valuation_slots.release()


def _start_drawing_valuation(task_id: str) -> None:
    threading.Thread(target=_run_drawing_valuation, args=(task_id,), daemon=True).start()


def _export_task_excel(task_id: str, task: dict) -> bytes:
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "工程量识别"

    header_fill = PatternFill(start_color="D9EAF7", end_color="D9EAF7", fill_type="solid")
    title_font = Font(bold=True, size=14)
    header_font = Font(bold=True)
    center = Alignment(horizontal="center", vertical="center")
    wrap = Alignment(vertical="top", wrap_text=True)

    ws.merge_cells("A1:L1")
    ws["A1"] = "图纸解析工程量报表"
    ws["A1"].font = title_font
    ws["A1"].alignment = center
    ws["A2"] = "任务编号"
    ws["B2"] = task_id
    ws["A3"] = "生成时间"
    ws["B3"] = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    ws["A4"] = "解析摘要"
    ws["B4"] = task.get("summary", "")
    ws["B4"].alignment = wrap

    headers = [
        "编号", "构件类型", "图元数", "主规格", "单位", "工程量",
        "线长(m)", "面积(m²)", "置信度", "材料", "来源图层", "计算说明",
    ]
    for col, header in enumerate(headers, 1):
        cell = ws.cell(row=6, column=col, value=header)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = center

    for row_idx, item in enumerate(task.get("components", []), 7):
        ws.cell(row=row_idx, column=1, value=item.get("id", ""))
        ws.cell(row=row_idx, column=2, value=item.get("type", ""))
        ws.cell(row=row_idx, column=3, value=item.get("count", 0))
        ws.cell(row=row_idx, column=4, value=item.get("spec", ""))
        ws.cell(row=row_idx, column=5, value=item.get("unit", ""))
        ws.cell(row=row_idx, column=6, value=item.get("quantity_estimate", 0))
        ws.cell(row=row_idx, column=7, value=item.get("length_m", 0))
        ws.cell(row=row_idx, column=8, value=item.get("area_m2", 0))
        ws.cell(row=row_idx, column=9, value=item.get("confidence", 0))
        ws.cell(row=row_idx, column=10, value=item.get("material", ""))
        ws.cell(row=row_idx, column=11, value="、".join(item.get("layers", [])))
        ws.cell(row=row_idx, column=12, value=item.get("calc_note", ""))
        ws.cell(row=row_idx, column=12).alignment = wrap

    widths = [10, 14, 10, 16, 8, 12, 12, 12, 10, 12, 24, 42]
    for idx, width in enumerate(widths, 1):
        ws.column_dimensions[openpyxl.utils.get_column_letter(idx)].width = width

    ws2 = wb.create_sheet("清单建议")
    suggestion_headers = ["源构件", "清单编码", "清单名称", "单位", "建议工程量", "项目特征", "置信度", "材料", "构件数"]
    for col, header in enumerate(suggestion_headers, 1):
        cell = ws2.cell(row=1, column=col, value=header)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = center
    for row_idx, item in enumerate(task.get("boq_suggestions", []), 2):
        ws2.cell(row=row_idx, column=1, value=item.get("source_component_id", ""))
        ws2.cell(row=row_idx, column=2, value=item.get("suggested_code", ""))
        ws2.cell(row=row_idx, column=3, value=item.get("suggested_name", ""))
        ws2.cell(row=row_idx, column=4, value=item.get("suggested_unit", ""))
        ws2.cell(row=row_idx, column=5, value=item.get("suggested_quantity", 0))
        ws2.cell(row=row_idx, column=6, value=item.get("characteristics", ""))
        ws2.cell(row=row_idx, column=7, value=item.get("confidence", 0))
        ws2.cell(row=row_idx, column=8, value=item.get("material", ""))
        ws2.cell(row=row_idx, column=9, value=item.get("component_count", 0))
        ws2.cell(row=row_idx, column=6).alignment = wrap
    for idx, width in enumerate([12, 14, 28, 8, 12, 44, 10, 12, 10], 1):
        ws2.column_dimensions[openpyxl.utils.get_column_letter(idx)].width = width

    ws3 = wb.create_sheet("图层证据")
    layer_headers = ["图层", "图元数", "归类", "图元类型"]
    for col, header in enumerate(layer_headers, 1):
        cell = ws3.cell(row=1, column=col, value=header)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = center
    for row_idx, item in enumerate(task.get("layer_summary", []), 2):
        entity_types = item.get("entity_types", {})
        ws3.cell(row=row_idx, column=1, value=item.get("layer", ""))
        ws3.cell(row=row_idx, column=2, value=item.get("count", 0))
        ws3.cell(row=row_idx, column=3, value=item.get("classified_as", ""))
        ws3.cell(
            row=row_idx,
            column=4,
            value="、".join(f"{k}:{v}" for k, v in entity_types.items()),
        )
    for idx, width in enumerate([26, 10, 14, 38], 1):
        ws3.column_dimensions[openpyxl.utils.get_column_letter(idx)].width = width

    ws4 = wb.create_sheet("诊断信息")
    ws4.cell(row=1, column=1, value="诊断信息").font = header_font
    for row_idx, item in enumerate(task.get("diagnostics", []), 2):
        ws4.cell(row=row_idx, column=1, value=item)
        ws4.cell(row=row_idx, column=1).alignment = wrap
    ws4.column_dimensions["A"].width = 80

    valuation = task.get("valuation") or {}
    if valuation:
        ws5 = wb.create_sheet("自动计价")
        ws5.merge_cells("A1:J1")
        ws5["A1"] = "图纸解析自动计价结果"
        ws5["A1"].font = title_font
        ws5["A1"].alignment = center
        ws5["A2"] = "项目编号"
        ws5["B2"] = valuation.get("project_id") or ""
        ws5["C2"] = "项目名称"
        ws5["D2"] = valuation.get("project_name") or ""
        ws5["A3"] = "清单项"
        ws5["B3"] = valuation.get("boq_items_created", 0)
        ws5["C3"] = "已匹配定额"
        ws5["D3"] = valuation.get("matched", 0)
        ws5["E3"] = "未匹配"
        ws5["F3"] = valuation.get("skipped", 0)
        ws5["G3"] = "总价"
        ws5["H3"] = valuation.get("grand_total", 0)
        if valuation.get("error"):
            ws5["A4"] = "提示"
            ws5["B4"] = valuation.get("error")

        valuation_headers = [
            "清单ID", "清单编码", "清单名称", "单位", "工程量",
            "定额编码", "定额名称", "匹配度", "状态", "合价",
        ]
        for col, header in enumerate(valuation_headers, 1):
            cell = ws5.cell(row=6, column=col, value=header)
            cell.font = header_font
            cell.fill = header_fill
            cell.alignment = center
        for row_idx, item in enumerate(valuation.get("items", []), 7):
            ws5.cell(row=row_idx, column=1, value=item.get("boq_item_id", ""))
            ws5.cell(row=row_idx, column=2, value=item.get("code", ""))
            ws5.cell(row=row_idx, column=3, value=item.get("name", ""))
            ws5.cell(row=row_idx, column=4, value=item.get("unit", ""))
            ws5.cell(row=row_idx, column=5, value=item.get("quantity", 0))
            ws5.cell(row=row_idx, column=6, value=item.get("quota_code", ""))
            ws5.cell(row=row_idx, column=7, value=item.get("quota_name", ""))
            ws5.cell(row=row_idx, column=8, value=item.get("match_confidence", 0))
            ws5.cell(row=row_idx, column=9, value=item.get("status", ""))
            ws5.cell(row=row_idx, column=10, value=item.get("total", 0))
            ws5.cell(row=row_idx, column=3).alignment = wrap
            ws5.cell(row=row_idx, column=7).alignment = wrap
        for idx, width in enumerate([10, 14, 30, 8, 12, 16, 32, 10, 10, 14], 1):
            ws5.column_dimensions[openpyxl.utils.get_column_letter(idx)].width = width

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def _run_recognition(
    task_id: str,
    file_bytes: bytes,
    filename: str,
    content_type: str,
    project_context: str,
) -> None:
    try:
        is_cad = (
            filename.lower().endswith((".dxf", ".dwg"))
            or "dxf" in content_type.lower()
            or "dwg" in content_type.lower()
        )

        if is_cad:
            _store_result(task_id, {"progress": "正在解析 CAD 图层和图元..."})

            def _cad_progress(payload: dict) -> None:
                _store_result(task_id, payload)

            raw = analyze_dxf_bytes(file_bytes, filename, progress_callback=_cad_progress)
            components = [_dump_model(ComponentOut(**item)) for item in raw.get("components", [])]
            suggestions = [_dump_model(BoqSuggestionOut(**item)) for item in raw.get("boq_suggestions", [])]
            has_error = bool(raw.get("error"))
            _store_result(task_id, {
                "status": "error" if has_error else "done",
                "drawing_type": raw.get("drawing_type", ""),
                "summary": raw.get("summary", ""),
                "components": components,
                "boq_suggestions": suggestions,
                "diagnostics": raw.get("diagnostics", []),
                "layer_summary": raw.get("layer_summary", []),
                "disciplines": raw.get("disciplines", []),
                "quality_score": raw.get("quality_score"),
                "preview_svg": raw.get("preview_svg", ""),
                "preview_svg_hd": raw.get("preview_svg_hd", ""),
                "valuation": None,
                "valuation_status": "processing" if suggestions and not has_error else "skipped",
                "valuation_progress": "识别完成，正在准备自动计价..." if suggestions and not has_error else "未生成可计价清单",
                "valuation_progress_percent": 0,
                "valuation_error": None,
                "progress": "解析完成" if not has_error else "解析失败",
                "error": raw.get("error"),
            })
            if suggestions and not has_error:
                _start_drawing_valuation(task_id)
            return

        _store_result(task_id, {"progress": "正在调用 辅助识别图纸..."})
        result = recognize_drawing(
            image_bytes=file_bytes,
            content_type=content_type,
            project_context=project_context,
        )
        components = [
            _dump_model(ComponentOut(
                id=c.id,
                type=c.type,
                count=c.count,
                spec=c.spec,
                confidence=c.confidence,
                material=c.material,
                unit=c.unit,
                quantity_estimate=c.quantity_estimate,
                calc_note="辅助 视觉识别结果，工程量由模型估算",
            ))
            for c in (result.components or [])
        ]
        suggestions = [
            _dump_model(BoqSuggestionOut(**item))
            for item in (components_to_boq_suggestions(result.components) if result.components else [])
        ]
        has_error = bool(result.error)
        _store_result(task_id, {
            "status": "error" if has_error else "done",
            "drawing_type": result.drawing_type,
            "summary": result.summary,
            "components": components,
            "boq_suggestions": suggestions,
            "diagnostics": [],
            "layer_summary": [],
            "preview_svg": "",
            "preview_svg_hd": "",
            "valuation": None,
            "valuation_status": "processing" if suggestions and not has_error else "skipped",
            "valuation_progress": "识别完成，正在准备自动计价..." if suggestions and not has_error else "未生成可计价清单",
            "valuation_progress_percent": 0,
            "valuation_error": None,
            "progress": "解析完成" if not has_error else "解析失败",
            "error": result.error,
        })
        if suggestions and not has_error:
            _start_drawing_valuation(task_id)
    except Exception as exc:
        logger.exception("Drawing recognition failed task_id=%s: %s", task_id, exc)
        _store_result(task_id, {
            "status": "error",
            "preview_svg": "",
            "preview_svg_hd": "",
            "valuation": None,
            "valuation_status": "error",
            "valuation_progress": "识别任务异常，自动计价未执行",
            "valuation_progress_percent": 0,
            "valuation_error": f"识别任务异常: {exc}",
            "progress": "识别任务异常",
            "error": f"识别任务异常: {exc}",
        })


@router.post("", summary="上传图纸，返回任务 ID")
async def upload_drawing(
    file: UploadFile = File(..., description="图纸文件 (PNG/JPG/PDF/DXF/DWG)"),
    project_context: str = Query("", description="可选：项目背景描述，提升识别精度"),
):
    task_id = str(uuid.uuid4())
    try:
        file_bytes = await _read_upload_bytes_limited(file)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Drawing upload failed before task creation: %s", exc)
        raise HTTPException(status_code=400, detail=f"读取图纸文件失败: {exc}") from exc
    filename = file.filename or "drawing"
    content_type = file.content_type or "application/octet-stream"

    with _tasks_lock:
        now = datetime.now(timezone.utc).isoformat()
        _tasks[task_id] = {
            "status": "processing",
            "drawing_type": "",
            "summary": "",
            "components": [],
            "boq_suggestions": [],
            "diagnostics": [],
            "layer_summary": [],
            "preview_svg": "",
            "preview_svg_hd": "",
            "valuation": None,
            "valuation_status": "idle",
            "valuation_progress": "",
            "valuation_progress_percent": 0,
            "valuation_error": None,
            "progress": "正在读取图纸文件...",
            "created_at": now,
            "updated_at": now,
            "error": None,
        }
        initial_task = dict(_tasks[task_id])
    save_background_task(task_id, _TASK_TYPE, initial_task)

    thread = threading.Thread(
        target=_run_recognition,
        args=(task_id, file_bytes, filename, content_type, project_context),
        daemon=True,
    )
    thread.start()

    return {"taskId": task_id}


@router.post("/convert/dxf-to-dwg", summary="将 DXF 转换为 DWG")
async def convert_dxf_to_dwg(
    file: UploadFile = File(..., description="DXF 图纸文件"),
):
    filename = file.filename or "drawing.dxf"
    if not filename.lower().endswith(".dxf"):
        raise HTTPException(status_code=400, detail="请上传 DXF 文件")

    file_bytes = await _read_upload_bytes_limited(file)
    # 外部转换器子进程最长可跑数分钟，放线程池执行，避免阻塞事件循环
    result = await run_in_threadpool(convert_dxf_to_dwg_bytes, file_bytes, filename)
    if result.error or result.dwg_bytes is None:
        raise HTTPException(
            status_code=400,
            detail={
                "error": result.error or "dxf_to_dwg_failed",
                "diagnostics": result.diagnostics,
            },
        )

    raw_stem = filename.rsplit(".", 1)[0]
    safe_stem = sanitize_filename(raw_stem) or "drawing"
    out_name = f"{safe_stem}.dwg"
    return StreamingResponse(
        io.BytesIO(result.dwg_bytes),
        media_type="application/acad",
        headers={"Content-Disposition": build_attachment_disposition(out_name)},
    )


@router.get("/convert/status", response_model=ConverterStatusResponse, summary="查询 CAD 转换器状态")
async def get_cad_converter_status():
    # 状态探测含磁盘扫描，放线程池执行
    status = await run_in_threadpool(get_converter_status)
    return ConverterStatusResponse(**status)


@router.get("/{task_id}", response_model=TaskStatusResponse, summary="查询识别结果")
async def get_recognition_result(task_id: str, include_svg: bool = Query(True)):
    task = _get_task(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail=f"任务不存在: {task_id}")

    if not include_svg or task.get("status") == "processing":
        # 预览 SVG 可达数 MB：解析阶段前端用不到，轮询反复传输会把页面拖卡，
        # 仅在终态且显式请求时返回
        task = {**task, "preview_svg": "", "preview_svg_hd": ""}

    return TaskStatusResponse(taskId=task_id, **task)


@router.get("/{task_id}/export", summary="导出图纸解析工程量 Excel")
async def export_recognition_result(task_id: str):
    task = _get_task(task_id) or {}
    if not task:
        raise HTTPException(status_code=404, detail=f"任务不存在: {task_id}")
    if task.get("status") == "processing":
        raise HTTPException(status_code=409, detail="图纸仍在解析中，请稍后再导出")

    # openpyxl 生成 Excel 是重同步操作，放线程池执行
    file_bytes = await run_in_threadpool(_export_task_excel, task_id, task)
    return StreamingResponse(
        io.BytesIO(file_bytes),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{_safe_report_filename(task_id, "xlsx")}"'},
    )
