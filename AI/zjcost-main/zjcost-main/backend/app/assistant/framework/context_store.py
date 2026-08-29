"""Handler Memory System (Phase H3).

Persistent memory layer for agents.

## Scopes

- **global**: shared across all users and projects (e.g. "HKSMM4 uses m3 for concrete")
- **user**: per-user preferences (e.g. "user prefers unit rate breakdowns")
- **project**: per-project facts (e.g. "this project uses 区域版2018定额")

## Usage

```python
store: ContextStore = SQLAlchemyContextStore(db)
store.save(scope="project", scope_id=42, key="region_pricing_basis",
           content="本项目按区域版2018建筑定额计价", importance=4,
           created_by_agent="cost_execute")
results = store.search(scope="project", scope_id=42, query="定额")
```

## Design

- Memories are keyed by (scope, scope_id, key) — upsert semantics.
- `importance` is 1-5; higher memories are surfaced first for context injection.
- `tags` enable category filtering without full text search.
- Keeping it simple: no embeddings/vector search yet (Phase H5 candidate).
"""

from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Literal

logger = logging.getLogger(__name__)


# ───────────────────────────────────────────────────────────────────
# Types
# ───────────────────────────────────────────────────────────────────

MemoryScope = Literal["global", "user", "project"]
VALID_SCOPES: set[str] = {"global", "user", "project"}


@dataclass
class HandlerMemory:
    """A single memory entry."""
    scope: MemoryScope
    scope_id: int | None  # None for global; user_id or project_id otherwise
    key: str
    content: str
    tags: list[str] = field(default_factory=list)
    importance: int = 3  # 1-5
    created_by_agent: str = ""
    created_at: str = ""
    updated_at: str = ""
    accessed_count: int = 0
    id: int | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "scope": self.scope,
            "scope_id": self.scope_id,
            "key": self.key,
            "content": self.content,
            "tags": list(self.tags),
            "importance": self.importance,
            "created_by_agent": self.created_by_agent,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "accessed_count": self.accessed_count,
        }


class MemoryValidationError(ValueError):
    """Raised for invalid scope, importance, etc."""


def _validate_inputs(
    *,
    scope: str,
    scope_id: int | None,
    key: str | None = None,
    importance: int | None = None,
) -> None:
    if scope not in VALID_SCOPES:
        raise MemoryValidationError(
            f"invalid scope '{scope}', expected one of {sorted(VALID_SCOPES)}"
        )
    if scope == "global" and scope_id is not None:
        raise MemoryValidationError("global scope must have scope_id=None")
    if scope != "global" and scope_id is None:
        raise MemoryValidationError(f"scope '{scope}' requires scope_id")
    if key is not None:
        if not key or len(key) > 100 or not key.replace("_", "").replace("-", "").isalnum():
            raise MemoryValidationError(
                "key must be alphanumeric (plus _ / -), 1-100 chars"
            )
    if importance is not None and not (1 <= importance <= 5):
        raise MemoryValidationError("importance must be in range 1..5")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _now() -> datetime:
    """返回带时区的 datetime 对象，用于 DateTime 类型的 DB 字段。"""
    return datetime.now(timezone.utc)


# ───────────────────────────────────────────────────────────────────
# Abstract base
# ───────────────────────────────────────────────────────────────────


class ContextStore(ABC):
    """Abstract context store. Two implementations: in-memory and SQLAlchemy."""

    # embedding 缓存：key 为 "{m.key}: {m.content}"，value 为向量。
    # 懒初始化（避免在 __init__ 中强制子类调用 super().__init__()）。
    _embedding_cache: dict[str, list[float]] | None = None

    def _get_embedding_cache(self) -> dict[str, list[float]]:
        """获取（必要时创建）embedding 缓存。"""
        cache = self._embedding_cache
        if cache is None:
            cache = {}
            self._embedding_cache = cache
        return cache

    def _invalidate_embedding_cache(self) -> None:
        """清除 embedding 缓存（记忆内容变更时调用）。"""
        self._embedding_cache = {}

    @abstractmethod
    def save(
        self,
        *,
        scope: MemoryScope,
        scope_id: int | None,
        key: str,
        content: str,
        tags: list[str] | None = None,
        importance: int = 3,
        created_by_agent: str = "",
    ) -> HandlerMemory:
        """Upsert a memory. Returns the saved entry."""

    @abstractmethod
    def get(
        self, *, scope: MemoryScope, scope_id: int | None, key: str,
    ) -> HandlerMemory | None:
        """Fetch one memory by (scope, scope_id, key). Increments access count."""

    @abstractmethod
    def search(
        self,
        *,
        scope: MemoryScope,
        scope_id: int | None,
        query: str | None = None,
        tags: list[str] | None = None,
        min_importance: int = 1,
        limit: int = 10,
    ) -> list[HandlerMemory]:
        """Search memories by content substring and/or tags, ordered by importance desc."""

    @abstractmethod
    def list(
        self,
        *,
        scope: MemoryScope,
        scope_id: int | None,
        limit: int = 20,
    ) -> list[HandlerMemory]:
        """List memories in a scope, ordered by importance desc then updated_at desc."""

    @abstractmethod
    def delete(
        self, *, scope: MemoryScope, scope_id: int | None, key: str,
    ) -> bool:
        """Delete by (scope, scope_id, key). Returns True if deleted."""

    @abstractmethod
    def forget(self, memory_id: int) -> bool:
        """Delete by id. Returns True if deleted."""

    # ── Semantic search (Phase H5) ──

    def search_semantic(
        self,
        *,
        scope: MemoryScope,
        scope_id: int | None,
        query: str,
        limit: int = 10,
        min_similarity: float = 0.0,
        provider: Any = None,
    ) -> list[tuple[float, HandlerMemory]]:
        """Embedding-based semantic search within a scope.

        Returns (similarity, memory) pairs sorted by similarity descending.

        Args:
            scope / scope_id: memory partition to search.
            query: natural language query.
            limit: max results returned.
            min_similarity: discard results with cosine similarity below this.
            provider: optional EmbedProvider; falls back to
                      `get_embed_provider()` when None.

        性能优化：使用 embedding 缓存，避免每次查询都重新 embed 所有记忆。
        记忆内容变更时（save/delete/forget）会自动清除缓存。
        """
        from app.assistant.framework.embed_provider import get_embed_provider
        from app.assistant.framework.vector_utils import dot, top_k

        if not query:
            return []

        emb = provider or get_embed_provider()

        # Pull *all* memories in the scope — we apply min_importance=1 by default.
        # list() already sorts by importance; here we need full set for ranking.
        candidates = self.list(scope=scope, scope_id=scope_id, limit=10_000)
        if not candidates:
            return []

        q_vec = emb.embed(query)
        cache = self._get_embedding_cache()

        # 收集未缓存的文本，批量 embed（保留原有的批量 embed 优化）
        texts = [f"{m.key}: {m.content}" for m in candidates]
        uncached_indices = [i for i, t in enumerate(texts) if t not in cache]
        if uncached_indices:
            uncached_texts = [texts[i] for i in uncached_indices]
            uncached_vecs = emb.embed_many(uncached_texts)
            for t, vec in zip(uncached_texts, uncached_vecs):
                cache[t] = vec

        # 使用缓存的向量计算相似度
        scored: list[tuple[float, HandlerMemory]] = []
        for mem, text in zip(candidates, texts):
            vec = cache[text]
            # Both vectors are L2-normalized → dot product == cosine similarity
            scored.append((dot(q_vec, vec), mem))

        return top_k(scored, limit, min_score=min_similarity)

    # ── Context injection helper ──

    def collect_relevant(
        self,
        *,
        user_id: int | None,
        project_id: int | None,
        limit_per_scope: int = 5,
    ) -> list[HandlerMemory]:
        """Gather the top memories across global, user, and project scopes.

        Useful for BaseHandler to inject into the system/user prompt before a run.
        """
        out: list[HandlerMemory] = []
        out.extend(self.list(
            scope="global", scope_id=None, limit=limit_per_scope,
        ))
        if user_id is not None:
            out.extend(self.list(
                scope="user", scope_id=user_id, limit=limit_per_scope,
            ))
        if project_id is not None:
            out.extend(self.list(
                scope="project", scope_id=project_id, limit=limit_per_scope,
            ))
        # Stable sort: importance desc, then updated_at desc (already pre-sorted per scope)
        # 修正：importance 降序 + updated_at 降序（最新在前）
        out.sort(key=lambda m: (m.importance, m.updated_at), reverse=True)
        return out


# ───────────────────────────────────────────────────────────────────
# In-memory implementation (for tests / lightweight deployments)
# ───────────────────────────────────────────────────────────────────


class InMemoryContextStore(ContextStore):
    """Non-persistent store backed by a Python dict. Useful for tests."""

    def __init__(self) -> None:
        # key: (scope, scope_id, key) → HandlerMemory
        self._data: dict[tuple[str, int | None, str], HandlerMemory] = {}
        self._next_id = 1

    def save(
        self,
        *,
        scope: MemoryScope,
        scope_id: int | None,
        key: str,
        content: str,
        tags: list[str] | None = None,
        importance: int = 3,
        created_by_agent: str = "",
    ) -> HandlerMemory:
        _validate_inputs(scope=scope, scope_id=scope_id, key=key,
                         importance=importance)
        idx = (scope, scope_id, key)
        now = _now_iso()
        existing = self._data.get(idx)
        if existing is not None:
            existing.content = content
            existing.tags = list(tags or [])
            existing.importance = importance
            existing.updated_at = now
            if created_by_agent:
                existing.created_by_agent = created_by_agent
            # 记忆内容变更，清除 embedding 缓存
            self._invalidate_embedding_cache()
            return existing

        entry = HandlerMemory(
            id=self._next_id,
            scope=scope,
            scope_id=scope_id,
            key=key,
            content=content,
            tags=list(tags or []),
            importance=importance,
            created_by_agent=created_by_agent,
            created_at=now,
            updated_at=now,
            accessed_count=0,
        )
        self._next_id += 1
        self._data[idx] = entry
        # 新增记忆，清除 embedding 缓存
        self._invalidate_embedding_cache()
        return entry

    def get(
        self, *, scope: MemoryScope, scope_id: int | None, key: str,
    ) -> HandlerMemory | None:
        _validate_inputs(scope=scope, scope_id=scope_id, key=key)
        entry = self._data.get((scope, scope_id, key))
        if entry is not None:
            entry.accessed_count += 1
        return entry

    def search(
        self,
        *,
        scope: MemoryScope,
        scope_id: int | None,
        query: str | None = None,
        tags: list[str] | None = None,
        min_importance: int = 1,
        limit: int = 10,
    ) -> list[HandlerMemory]:
        _validate_inputs(scope=scope, scope_id=scope_id)
        tag_set = set(tags or [])
        q_lower = (query or "").lower()
        matches = [
            m for (s, sid, _), m in self._data.items()
            if s == scope and sid == scope_id
            and m.importance >= min_importance
            and (not q_lower or q_lower in m.content.lower() or q_lower in m.key.lower())
            and (not tag_set or tag_set.issubset(set(m.tags)))
        ]
        # 修正：importance 降序 + updated_at 降序（最新在前）
        matches.sort(key=lambda m: (m.importance, m.updated_at), reverse=True)
        return matches[:limit]

    def list(
        self,
        *,
        scope: MemoryScope,
        scope_id: int | None,
        limit: int = 20,
    ) -> list[HandlerMemory]:
        _validate_inputs(scope=scope, scope_id=scope_id)
        matches = [
            m for (s, sid, _), m in self._data.items()
            if s == scope and sid == scope_id
        ]
        # 修正：importance 降序 + updated_at 降序（最新在前）
        matches.sort(key=lambda m: (m.importance, m.updated_at), reverse=True)
        return matches[:limit]

    def delete(
        self, *, scope: MemoryScope, scope_id: int | None, key: str,
    ) -> bool:
        _validate_inputs(scope=scope, scope_id=scope_id, key=key)
        removed = self._data.pop((scope, scope_id, key), None) is not None
        if removed:
            # 记忆被删除，清除 embedding 缓存
            self._invalidate_embedding_cache()
        return removed

    def forget(self, memory_id: int) -> bool:
        for idx, entry in list(self._data.items()):
            if entry.id == memory_id:
                del self._data[idx]
                # 记忆被删除，清除 embedding 缓存
                self._invalidate_embedding_cache()
                return True
        return False


# ───────────────────────────────────────────────────────────────────
# SQLAlchemy implementation
# ───────────────────────────────────────────────────────────────────


class SQLAlchemyContextStore(ContextStore):
    """SQLAlchemy-backed store — persists to the `handler_memories` table."""

    def __init__(self, db: Any) -> None:
        self._db = db

    def _row_to_memory(self, row: Any) -> HandlerMemory:
        # DB 中 created_at/updated_at 为 DateTime 对象，转为 isoformat 字符串以兼容 dataclass
        created_at = row.created_at
        updated_at = row.updated_at
        if isinstance(created_at, datetime):
            created_at = created_at.isoformat()
        if isinstance(updated_at, datetime):
            updated_at = updated_at.isoformat()
        return HandlerMemory(
            id=row.id,
            scope=row.scope,  # type: ignore[arg-type]
            scope_id=row.scope_id,
            key=row.key,
            content=row.content,
            tags=[t for t in (row.tags or "").split(",") if t],
            importance=row.importance,
            created_by_agent=row.created_by_agent or "",
            created_at=created_at or "",
            updated_at=updated_at or "",
            accessed_count=row.accessed_count or 0,
        )

    def save(
        self,
        *,
        scope: MemoryScope,
        scope_id: int | None,
        key: str,
        content: str,
        tags: list[str] | None = None,
        importance: int = 3,
        created_by_agent: str = "",
    ) -> HandlerMemory:
        _validate_inputs(scope=scope, scope_id=scope_id, key=key,
                         importance=importance)
        from app.models.handler_memory import HandlerMemory as Row

        # DB 的 created_at/updated_at 为 DateTime 类型，需传入 datetime 对象
        now = _now()
        tags_str = ",".join(tags or [])

        row = (
            self._db.query(Row)
            .filter(Row.scope == scope, Row.scope_id == scope_id, Row.key == key)
            .one_or_none()
        )
        if row is None:
            row = Row(
                scope=scope,
                scope_id=scope_id,
                key=key,
                content=content,
                tags=tags_str,
                importance=importance,
                created_by_agent=created_by_agent,
                created_at=now,
                updated_at=now,
                accessed_count=0,
            )
            self._db.add(row)
        else:
            row.content = content
            row.tags = tags_str
            row.importance = importance
            row.updated_at = now
            if created_by_agent:
                row.created_by_agent = created_by_agent

        self._db.commit()
        self._db.refresh(row)
        # 记忆内容变更（新增或更新），清除 embedding 缓存
        self._invalidate_embedding_cache()
        return self._row_to_memory(row)

    def get(
        self, *, scope: MemoryScope, scope_id: int | None, key: str,
    ) -> HandlerMemory | None:
        _validate_inputs(scope=scope, scope_id=scope_id, key=key)
        from app.models.handler_memory import HandlerMemory as Row

        row = (
            self._db.query(Row)
            .filter(Row.scope == scope, Row.scope_id == scope_id, Row.key == key)
            .one_or_none()
        )
        if row is None:
            return None
        row.accessed_count = (row.accessed_count or 0) + 1
        # last_accessed_at 为 DateTime 类型，需传入 datetime 对象
        row.last_accessed_at = _now()
        self._db.commit()
        return self._row_to_memory(row)

    def search(
        self,
        *,
        scope: MemoryScope,
        scope_id: int | None,
        query: str | None = None,
        tags: list[str] | None = None,
        min_importance: int = 1,
        limit: int = 10,
    ) -> list[HandlerMemory]:
        _validate_inputs(scope=scope, scope_id=scope_id)
        from app.models.handler_memory import HandlerMemory as Row

        q = (
            self._db.query(Row)
            .filter(Row.scope == scope, Row.scope_id == scope_id)
            .filter(Row.importance >= min_importance)
        )
        if query:
            like = f"%{query}%"
            q = q.filter((Row.content.ilike(like)) | (Row.key.ilike(like)))
        if tags:
            # Require all tags to appear in the comma-separated list
            for t in tags:
                q = q.filter(Row.tags.ilike(f"%{t}%"))
        rows = q.order_by(Row.importance.desc(), Row.updated_at.desc()).limit(limit).all()
        return [self._row_to_memory(r) for r in rows]

    def list(
        self,
        *,
        scope: MemoryScope,
        scope_id: int | None,
        limit: int = 20,
    ) -> list[HandlerMemory]:
        _validate_inputs(scope=scope, scope_id=scope_id)
        from app.models.handler_memory import HandlerMemory as Row

        rows = (
            self._db.query(Row)
            .filter(Row.scope == scope, Row.scope_id == scope_id)
            .order_by(Row.importance.desc(), Row.updated_at.desc())
            .limit(limit)
            .all()
        )
        return [self._row_to_memory(r) for r in rows]

    def delete(
        self, *, scope: MemoryScope, scope_id: int | None, key: str,
    ) -> bool:
        _validate_inputs(scope=scope, scope_id=scope_id, key=key)
        from app.models.handler_memory import HandlerMemory as Row

        row = (
            self._db.query(Row)
            .filter(Row.scope == scope, Row.scope_id == scope_id, Row.key == key)
            .one_or_none()
        )
        if row is None:
            return False
        self._db.delete(row)
        self._db.commit()
        # 记忆被删除，清除 embedding 缓存
        self._invalidate_embedding_cache()
        return True

    def forget(self, memory_id: int) -> bool:
        from app.models.handler_memory import HandlerMemory as Row

        row = self._db.query(Row).filter(Row.id == memory_id).one_or_none()
        if row is None:
            return False
        self._db.delete(row)
        self._db.commit()
        # 记忆被删除，清除 embedding 缓存
        self._invalidate_embedding_cache()
        return True
