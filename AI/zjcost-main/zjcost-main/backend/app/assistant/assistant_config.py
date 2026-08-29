"""辅助 settings loaded from environment variables (with multi-provider support).

Resolution order:
1. Per-provider env vars: ZH_{PROVIDER}_API_KEY / ZH_{PROVIDER}_BASE_URL / ZH_{PROVIDER}_MODEL
2. Generic fallback: ZH_API_KEY / ZH_BASE_URL / ZH_MODEL
3. Built-in defaults (per provider)
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any

# Supported model providers that the user can configure.
ZH_SUPPORTED_PROVIDERS = ["provider_a", "provider_b", "provider_c", "provider_d", "compatible"]

# Valid values for ZH_PROVIDER env var (includes "disabled").
ZH_VALID_PROVIDERS = {"disabled"} | set(ZH_SUPPORTED_PROVIDERS)

# Default base_url per provider (used when none is supplied).
_DEFAULT_BASE_URLS: dict[str, str] = {
    "provider_a": "https://api.provider-a.example.com",
    "provider_b": "https://api.provider-b.example.com/v1",
    "provider_c": "https://api.provider-c.example.com/v1",
    "provider_d": "https://api.provider-d.example.com/v4",
    "compatible": "https://api.compatible.com/v1",
}

# Default model name per provider.
_DEFAULT_MODELS: dict[str, str] = {
    "provider_a": "model-a",
    "provider_b": "model-b",
    "provider_c": "model-c",
    "provider_d": "model-d",
    "compatible": "model-a-mini",
}


def _to_bool(raw: str | None, default: bool = False) -> bool:
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _to_float(raw: str | None, default: float) -> float:
    if raw is None or not raw.strip():
        return default
    try:
        return float(raw)
    except ValueError:
        return default


@dataclass(frozen=True)
class ZhSettings:
    provider: str = "disabled"
    api_key: str | None = None
    base_url: str | None = None
    model: str | None = None
    # OPT-4: optional per-tier overrides; fall back to ``model`` when None.
    model_fast: str | None = None
    model_powerful: str | None = None
    timeout_seconds: float = 20.0
    enable_audit_logs: bool = False

    def is_enabled(self) -> bool:
        return self.provider != "disabled" and self.is_configured()

    def is_configured(self) -> bool:
        return bool(self.api_key and self.model)

    def resolve_model_for_tier(self, tier_level: int) -> str:
        """OPT-4: Map tier level (1=fast / 2=balanced / 3=powerful) → model name.

        Falls back to ``self.model`` (the balanced default) when a tier override
        is not configured. Callers can safely pass level=2 to get the default.
        """
        if tier_level <= 1 and self.model_fast:
            return self.model_fast
        if tier_level >= 3 and self.model_powerful:
            return self.model_powerful
        return self.model or ""


def _env(key: str, default: str = "") -> str:
    return os.getenv(key, default).strip()


def _offline_mode() -> bool:
    return _to_bool(os.getenv("ZJCOST_OFFLINE"), default=False)


def get_zh_settings() -> ZhSettings:
    """Build runtime ZhSettings by resolving per-provider env vars → generic fallback."""
    if _offline_mode():
        return ZhSettings(provider="disabled")

    provider = _env("ZH_PROVIDER", "disabled").lower()
    if provider not in ZH_VALID_PROVIDERS:
        provider = "disabled"

    upper = provider.upper()

    # Per-provider env takes precedence, then generic env, then built-in default.
    api_key = (
        _env(f"ZH_{upper}_API_KEY")
        or _env("ZH_API_KEY")
        or None
    )
    base_url = (
        _env(f"ZH_{upper}_BASE_URL")
        or _env("ZH_BASE_URL")
        or _DEFAULT_BASE_URLS.get(provider, "")
        or None
    )
    model = (
        _env(f"ZH_{upper}_MODEL")
        or _env("ZH_MODEL")
        or _DEFAULT_MODELS.get(provider, "")
        or None
    )
    # OPT-4: Optional per-tier overrides. Per-provider takes precedence.
    # e.g. ZH_PROVIDER_A_MODEL_FAST, ZH_MODEL_POWERFUL.
    model_fast = (
        _env(f"ZH_{upper}_MODEL_FAST")
        or _env("ZH_MODEL_FAST")
        or None
    )
    model_powerful = (
        _env(f"ZH_{upper}_MODEL_POWERFUL")
        or _env("ZH_MODEL_POWERFUL")
        or None
    )

    timeout_seconds = _to_float(os.getenv("ZH_TIMEOUT_SECONDS"), 20.0)
    enable_audit_logs = _to_bool(os.getenv("ZH_ENABLE_AUDIT_LOGS"), default=False)

    return ZhSettings(
        provider=provider,
        api_key=api_key,
        base_url=base_url,
        model=model,
        model_fast=model_fast,
        model_powerful=model_powerful,
        timeout_seconds=timeout_seconds,
        enable_audit_logs=enable_audit_logs,
    )


# ───────────────────────────────────────────────────────────────────
# Phase H8: Memory / Embedding production settings
# ───────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class MemorySettings:
    """Runtime settings for the Memory + Embedding subsystem."""

    # "" = auto-detect (compatible if key available, else hash fallback)
    # "hash" / "compatible" = force
    embedding_backend: str
    # Default for orchestrate API when request doesn't override it.
    auto_save_memory_default: bool
    # Extractor budget (max memory items persisted per run).
    context_extractor_max_items: int


def get_memory_settings() -> MemorySettings:
    """Build MemorySettings from environment variables."""
    backend = _env("EMBEDDING_BACKEND", "").strip().lower()
    if backend not in ("", "hash", "compatible"):
        backend = ""

    max_items_raw = _env("ZH_MEMORY_EXTRACTOR_MAX_ITEMS", "").strip()
    try:
        max_items = int(max_items_raw) if max_items_raw else 3
    except ValueError:
        max_items = 3
    if max_items < 1:
        max_items = 1

    return MemorySettings(
        embedding_backend=backend,
        auto_save_memory_default=_to_bool(
            os.getenv("ZH_AUTO_SAVE_MEMORY"), default=False
        ),
        context_extractor_max_items=max_items,
    )


def get_zh_settings_payload(mask_api_keys: bool = True) -> dict[str, Any]:
    """Return the full multi-provider config dict used by the settings API."""
    provider = "disabled" if _offline_mode() else _env("ZH_PROVIDER", "disabled").lower()
    if provider not in ZH_VALID_PROVIDERS:
        provider = "disabled"

    providers: dict[str, dict[str, Any]] = {}
    for p in ZH_SUPPORTED_PROVIDERS:
        upper = p.upper()
        provider_key = _env(f"ZH_{upper}_API_KEY")
        if p == provider and not provider_key:
            provider_key = _env("ZH_API_KEY")
        providers[p] = {
            "api_key": "" if mask_api_keys and provider_key else provider_key,
            "api_key_set": bool(provider_key),
            "base_url": _env(f"ZH_{upper}_BASE_URL") or _DEFAULT_BASE_URLS.get(p, ""),
            "model": _env(f"ZH_{upper}_MODEL") or _DEFAULT_MODELS.get(p, ""),
        }

    return {
        "provider": provider,
        "timeout_seconds": _to_float(os.getenv("ZH_TIMEOUT_SECONDS"), 20.0),
        "enable_audit_logs": _to_bool(os.getenv("ZH_ENABLE_AUDIT_LOGS"), default=False),
        "providers": providers,
    }
