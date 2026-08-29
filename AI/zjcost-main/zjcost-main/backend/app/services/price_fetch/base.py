"""Abstract base adapter for price source fetching."""

from __future__ import annotations

import time
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any


@dataclass
class FetchedPrice:
    code: str = ""
    name: str = ""
    spec: str = ""
    unit: str = ""
    unit_price: float = 0.0
    region: str = ""
    effective_date: str = ""
    source: str = ""
    url: str = ""
    raw_data: dict[str, Any] = field(default_factory=dict)


class BasePriceFetcher(ABC):
    @property
    @abstractmethod
    def source_name(self) -> str:
        ...

    @property
    @abstractmethod
    def display_name(self) -> str:
        ...

    @abstractmethod
    def fetch(
        self,
        query: str | None = None,
        region: str = "",
        category: str = "",
        page: int = 1,
        page_size: int = 500,
    ) -> list[FetchedPrice]:
        ...

    def is_available(self, timeout: float = 5.0) -> bool:
        try:
            start = time.time()
            ok = self._health_check(timeout)
            elapsed = time.time() - start
            return ok and elapsed < timeout
        except Exception:
            return False

    def _health_check(self, timeout: float = 5.0) -> bool:
        return True

    def health_check(self) -> dict[str, Any]:
        start = time.time()
        ok = False
        error = ""
        try:
            ok = self._health_check(5.0)
        except Exception as e:
            error = str(e)
        return {
            "ok": ok,
            "latency_ms": int((time.time() - start) * 1000),
            "error": error,
        }

    @property
    def supported_regions(self) -> list[str]:
        return []

    @property
    def supported_categories(self) -> list[str]:
        return []
