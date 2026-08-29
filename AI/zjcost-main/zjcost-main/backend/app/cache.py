"""Simple TTL cache for read-heavy database queries.

Cache invalidation strategy: manual — write operations in route files
should call ``cache.invalidate(scope)`` to clear stale entries.
"""

from __future__ import annotations

import threading
import time
from functools import wraps
from typing import Any, Callable


class TTLCache:
    """Thread-safe cache with per-key TTL expiration and LRU eviction."""

    def __init__(self, maxsize: int = 1024) -> None:
        self._store: dict[str, tuple[float, Any]] = {}
        self._access: list[str] = []
        self._maxsize = maxsize
        self._lock = threading.Lock()

    def get(self, key: str) -> Any | None:
        with self._lock:
            entry = self._store.get(key)
            if entry is None:
                return None
            expiry, value = entry
            if time.monotonic() > expiry:
                del self._store[key]
                self._access.remove(key)
                return None
            self._access.remove(key)
            self._access.append(key)
            return value

    def set(self, key: str, value: Any, ttl_seconds: int = 300) -> None:
        with self._lock:
            if key not in self._store and len(self._store) >= self._maxsize:
                oldest = self._access.pop(0)
                del self._store[oldest]
            self._store[key] = (time.monotonic() + ttl_seconds, value)
            if key not in self._access:
                self._access.append(key)

    def invalidate(self, scope: str | None = None) -> int:
        """Remove entries whose key starts with ``scope``.  ``None`` clears all."""
        with self._lock:
            if scope is None:
                count = len(self._store)
                self._store.clear()
                return count
            to_delete = [k for k in self._store if k.startswith(scope)]
            for k in to_delete:
                del self._store[k]
            return len(to_delete)


_cache = TTLCache()


def cached_result(ttl_seconds: int = 300):
    """Decorator: cache function return value by (*args, **kwargs) key."""

    def decorator(func: Callable) -> Callable:
        @wraps(func)
        def wrapper(*args: Any, **kwargs: Any) -> Any:
            key_parts = [func.__name__]
            for a in args:
                key_parts.append(str(a))
            for k in sorted(kwargs):
                key_parts.append(f"{k}={kwargs[k]}")
            key = ":".join(key_parts)

            cached = _cache.get(key)
            if cached is not None:
                return cached

            result = func(*args, **kwargs)
            _cache.set(key, result, ttl_seconds)
            return result

        return wrapper

    return decorator


def invalidate_scope(scope: str) -> int:
    """Invalidate all cached entries under ``scope`` (e.g. 'quota', 'material_prices')."""
    return _cache.invalidate(scope)
