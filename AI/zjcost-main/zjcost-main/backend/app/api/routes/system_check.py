"""Lightweight system self-check endpoint for packaged and local builds."""

from __future__ import annotations

import importlib
import os
import re
from typing import Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.assistant.assistant_config import get_zh_settings
from app.db.session import DATABASE_URL, get_db
from app.models.boq_item import BoqItem
from app.models.boq_standard_code import BoqStandardCode
from app.models.material_price import MaterialPrice
from app.models.project import Project
from app.models.quota_item import QuotaItem
from app.services.dwg_conversion_service import get_converter_status

router = APIRouter(prefix="/system-check", tags=["system-check"])

CheckStatus = Literal["ok", "warning", "error"]


class SystemCheckItem(BaseModel):
    key: str
    label: str
    status: CheckStatus
    message: str
    details: dict[str, object] = {}


class SystemCheckResponse(BaseModel):
    status: CheckStatus
    checks: list[SystemCheckItem]
    counts: dict[str, int]
    zh_provider: str
    offline_mode: bool
    database_url: str


def _item(
    key: str,
    label: str,
    status: CheckStatus,
    message: str,
    details: dict[str, object] | None = None,
) -> SystemCheckItem:
    return SystemCheckItem(
        key=key,
        label=label,
        status=status,
        message=message,
        details=details or {},
    )


def _overall(checks: list[SystemCheckItem]) -> CheckStatus:
    if any(item.status == "error" for item in checks):
        return "error"
    if any(item.status == "warning" for item in checks):
        return "warning"
    return "ok"


def _mask_database_url(url: str) -> str:
    """脱敏数据库连接串中的密码部分，例如 postgresql://user:***@host/db。

    仅处理含 用户名:密码@ 的连接串；sqlite 等无密码串原样返回。
    """
    return re.sub(r"(://[^:/@]+:)([^@]*)(@)", r"\1***\3", url)


@router.get("", response_model=SystemCheckResponse)
def run_system_check(db: Session = Depends(get_db)) -> SystemCheckResponse:
    checks: list[SystemCheckItem] = []
    counts: dict[str, int] = {
        "projects": 0,
        "boq_items": 0,
        "quota_items": 0,
        "material_prices": 0,
        "standard_codes": 0,
    }

    try:
        db.execute(text("SELECT 1")).scalar_one()
        counts = {
            "projects": db.query(Project).count(),
            "boq_items": db.query(BoqItem).count(),
            "quota_items": db.query(QuotaItem).count(),
            "material_prices": db.query(MaterialPrice).count(),
            "standard_codes": db.query(BoqStandardCode).count(),
        }
        checks.append(_item("database", "数据库", "ok", "数据库连接正常。"))
    except Exception as exc:
        checks.append(_item("database", "数据库", "error", f"数据库不可用：{exc}"))

    quota_count = counts.get("quota_items", 0)
    checks.append(_item(
        "quota_library",
        "定额库",
        "ok" if quota_count >= 1000 else "error",
        f"当前定额 {quota_count} 条。",
        {"count": quota_count},
    ))

    material_count = counts.get("material_prices", 0)
    checks.append(_item(
        "material_prices",
        "材料价",
        "ok" if material_count > 0 else "warning",
        "材料价可用。" if material_count > 0 else "未检测到材料价，离线计价会使用内置默认价格。",
        {"count": material_count},
    ))

    standard_count = counts.get("standard_codes", 0)
    checks.append(_item(
        "standard_codes",
        "清单规范",
        "ok" if standard_count > 0 else "warning",
        "清单规范库可用。" if standard_count > 0 else "未检测到清单规范库，自动识别解释会减少。",
        {"count": standard_count},
    ))

    try:
        importlib.import_module("ifcopenshell")
        checks.append(_item("ifc_parser", "IFC解析", "ok", "IFC解析库可用。"))
    except Exception as exc:
        checks.append(_item("ifc_parser", "IFC解析", "error", f"IFC解析库不可用：{exc}"))

    converter = get_converter_status()
    checks.append(_item(
        "cad_converter",
        "CAD转换",
        "ok" if converter.get("dxf_to_dwg") or converter.get("dwg_to_dxf") else "warning",
        "检测到CAD转换器。" if converter.get("dxf_to_dwg") or converter.get("dwg_to_dxf") else "未检测到DWG/DXF转换器，DXF图纸仍可直接识别，DWG转换能力受限。",
        {
            "dxf_to_dwg": bool(converter.get("dxf_to_dwg")),
            "dwg_to_dxf": bool(converter.get("dwg_to_dxf")),
            "timeout_seconds": converter.get("timeout_seconds"),
        },
    ))

    zhConf = get_zh_settings()
    zh_ready = zhConf.provider != "disabled" and bool(zhConf.api_key)
    checks.append(_item(
        "zh_provider",
        "在线模型",
        "ok" if zh_ready else "warning",
        f"当前模型供应商：{zhConf.provider}。" if zh_ready else "未启用在线模型，系统会使用本地规则和示例数据兜底。",
        {"provider": zhConf.provider, "has_api_key": bool(zhConf.api_key)},
    ))

    return SystemCheckResponse(
        status=_overall(checks),
        checks=checks,
        counts=counts,
        zh_provider=zhConf.provider,
        offline_mode=os.getenv("ZJCOST_OFFLINE", "").strip().lower() in {"1", "true", "yes", "on"},
        database_url=_mask_database_url(DATABASE_URL),
    )
