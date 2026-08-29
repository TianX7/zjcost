"""辅助 settings management routes (read + update multi-provider config)."""

from __future__ import annotations

import os
from time import perf_counter

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.assistant.config import (
    ZhSettings,
    ZH_SUPPORTED_PROVIDERS,
    ZH_VALID_PROVIDERS,
    _DEFAULT_BASE_URLS,
    _DEFAULT_MODELS,
    get_zh_settings_payload,
)
from app.assistant.providers.model_compat import ModelCompatProvider
from app.db.session import get_db
from app.models.system_setting import SystemSetting
from app.schemas.zh_settings import ZhSettingsPayload

router = APIRouter(tags=["zh-settings"])


def _validate_zh_settings_payload(data: dict) -> ZhSettingsPayload:
    if hasattr(ZhSettingsPayload, "model_validate"):
        return ZhSettingsPayload.model_validate(data)  # type: ignore[attr-defined]
    return ZhSettingsPayload.parse_obj(data)


@router.get("/assistant/settings", response_model=ZhSettingsPayload)
def get_settings() -> ZhSettingsPayload:
    return _validate_zh_settings_payload(get_zh_settings_payload())


@router.put("/assistant/settings", response_model=ZhSettingsPayload)
def update_settings(
    payload: ZhSettingsPayload,
    db: Session = Depends(get_db),
) -> ZhSettingsPayload:
    provider = payload.provider.strip().lower()
    if provider not in ZH_VALID_PROVIDERS:
        raise HTTPException(status_code=400, detail="unsupported provider")

    values = _flatten_payload(payload, db)
    _upsert_settings(db, values)

    # Mirror into process env for immediate effect in current worker.
    for key, value in values.items():
        os.environ[key] = value

    return _validate_zh_settings_payload(get_zh_settings_payload())


class ZhTestConnectionRequest(BaseModel):
    provider: str = Field(..., description="Provider key, e.g. provider_a/provider_b/provider_c/provider_d/compatible")
    api_key: str = ""
    use_saved_key: bool = False
    base_url: str = ""
    model: str = ""
    timeout_seconds: float | None = None


class ZhTestConnectionResponse(BaseModel):
    success: bool = False
    latency_ms: int = 0
    reply: str = ""
    error: str = ""


@router.post("/assistant/test-connection", response_model=ZhTestConnectionResponse)
def test_zh_connection(payload: ZhTestConnectionRequest) -> ZhTestConnectionResponse:
    """Test connectivity/auth for a specific provider config (without saving)."""
    if os.getenv("ZJCOST_OFFLINE", "").strip().lower() in {"1", "true", "yes", "on"}:
        return ZhTestConnectionResponse(success=False, error="离线版已禁用外部 辅助 连接测试")

    provider_key = payload.provider.strip().lower()
    if provider_key not in ZH_SUPPORTED_PROVIDERS:
        raise HTTPException(status_code=400, detail="unsupported provider")

    api_key = payload.api_key.strip()
    if not api_key and payload.use_saved_key:
        upper = provider_key.upper()
        api_key = os.getenv(f"ZH_{upper}_API_KEY", "").strip()
        if provider_key == os.getenv("ZH_PROVIDER", "").strip().lower() and not api_key:
            api_key = os.getenv("ZH_API_KEY", "").strip()
    if not api_key:
        return ZhTestConnectionResponse(success=False, error="API Key 为空")

    base_url = payload.base_url.strip() or _DEFAULT_BASE_URLS.get(provider_key, "")
    if not base_url:
        return ZhTestConnectionResponse(success=False, error="Base URL 为空")

    model = payload.model.strip() or _DEFAULT_MODELS.get(provider_key, "")
    if not model:
        return ZhTestConnectionResponse(success=False, error="模型名称为空")

    timeout = float(payload.timeout_seconds) if payload.timeout_seconds else 10.0

    settings = ZhSettings(
        provider=provider_key,
        api_key=api_key,
        base_url=base_url,
        model=model,
        timeout_seconds=timeout,
    )
    provider = ModelCompatProvider(settings=settings)

    started = perf_counter()
    try:
        reply = provider.generate_text(
            task="test_connection",
            messages=[
                {"role": "system", "content": "You are a connectivity test."},
                {"role": "user", "content": "请回复“连接成功”即可。"},
            ],
        )
        latency_ms = int((perf_counter() - started) * 1000)
        return ZhTestConnectionResponse(
            success=True,
            latency_ms=latency_ms,
            reply=(reply or "")[:200],
        )
    except Exception as exc:
        latency_ms = int((perf_counter() - started) * 1000)
        err = str(exc) or exc.__class__.__name__
        # Defensive: avoid leaking key in error text
        if api_key and api_key in err:
            err = err.replace(api_key, "***")
        return ZhTestConnectionResponse(
            success=False,
            latency_ms=latency_ms,
            error=err[:300],
        )


def _stored_setting(db: Session, key: str) -> str:
    row = db.query(SystemSetting).filter(SystemSetting.key == key).first()
    if row is not None:
        return row.value or ""
    return os.getenv(key, "").strip()


def _persist_zh_api_keys() -> bool:
    return os.getenv("ZJCOST_PERSIST_ZH_API_KEYS", "").strip().lower() in {"1", "true", "yes", "on"}


def _flatten_payload(payload: ZhSettingsPayload, db: Session) -> dict[str, str]:
    values: dict[str, str] = {
        "ZH_PROVIDER": payload.provider.strip().lower(),
        "ZH_TIMEOUT_SECONDS": str(payload.timeout_seconds),
        "ZH_ENABLE_AUDIT_LOGS": "true" if payload.enable_audit_logs else "false",
    }
    for provider in ZH_SUPPORTED_PROVIDERS:
        cfg = getattr(payload.providers, provider)
        upper = provider.upper()
        api_key = cfg.api_key.strip()
        if not api_key and cfg.api_key_set:
            api_key = _stored_setting(db, f"ZH_{upper}_API_KEY")
            if provider == payload.provider.strip().lower() and not api_key:
                api_key = os.getenv("ZH_API_KEY", "").strip()
        values[f"ZH_{upper}_API_KEY"] = api_key
        values[f"ZH_{upper}_BASE_URL"] = cfg.base_url.strip()
        values[f"ZH_{upper}_MODEL"] = cfg.model.strip()
    return values


def _upsert_settings(db: Session, values: dict[str, str]) -> None:
    existing = {
        row.key: row
        for row in db.query(SystemSetting).filter(SystemSetting.key.in_(list(values.keys()))).all()
    }
    for key, value in values.items():
        row = existing.get(key)
        if key.endswith("_API_KEY") and not _persist_zh_api_keys():
            if row is not None:
                db.delete(row)
            continue
        if row is None:
            db.add(SystemSetting(key=key, value=value))
        else:
            row.value = value
    db.commit()
