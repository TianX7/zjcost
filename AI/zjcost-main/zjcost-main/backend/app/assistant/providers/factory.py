"""Factory for selecting configured 辅助 provider implementation."""

from __future__ import annotations

from app.assistant.config import ZH_SUPPORTED_PROVIDERS, get_zh_settings
from app.assistant.providers.base import BaseZhProvider, DisabledZhProvider
from app.assistant.providers.model_compat import ModelCompatProvider

# All supported providers use the model-compatible protocol.
_MODEL_COMPAT_COMPAT_PROVIDERS = set(ZH_SUPPORTED_PROVIDERS)


def get_zh_provider() -> BaseZhProvider:
    settings = get_zh_settings()
    if not settings.is_enabled():
        return DisabledZhProvider()

    if settings.provider in _MODEL_COMPAT_COMPAT_PROVIDERS:
        return ModelCompatProvider(settings=settings)

    return DisabledZhProvider()

