"""Compatibility wrapper for the legacy query handler import path."""

from app.assistant.agents.legacy_utils import normalize_query_for_router
from app.assistant.providers import get_zh_provider

__all__ = ["normalize_query_for_router", "get_zh_provider"]
