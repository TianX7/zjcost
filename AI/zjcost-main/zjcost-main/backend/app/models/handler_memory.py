"""HandlerMemory — persistent cross-session memory for agents.

Each row is one memory entry keyed by (scope, scope_id, key).

See app/assistant/framework/context_store.py for the high-level API.
"""

from datetime import datetime

from sqlalchemy import DateTime, Index, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class HandlerMemory(Base):
    __tablename__ = "handler_memories"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)

    # ── Scoping ──
    # scope ∈ {"global", "user", "project"}
    scope: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    # scope_id: user_id / project_id; NULL for global scope
    scope_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    key: Mapped[str] = mapped_column(String(100), nullable=False)

    # ── Payload ──
    content: Mapped[str] = mapped_column(Text, nullable=False)
    tags: Mapped[str | None] = mapped_column(String(500), nullable=True)
    importance: Mapped[int] = mapped_column(Integer, nullable=False, default=3)

    # ── Provenance ──
    created_by_agent: Mapped[str | None] = mapped_column(String(100), nullable=True)

    # ── Timestamps ──
    # 统一使用 DateTime(timezone=True)，由数据库 server_default 自动填充
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(),
        onupdate=func.now(), nullable=False,
    )
    last_accessed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True,
    )

    # ── Usage stats ──
    accessed_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    __table_args__ = (
        UniqueConstraint("scope", "scope_id", "key", name="uq_handler_memory_scope_key"),
        Index("idx_handler_memory_scope_importance", "scope", "scope_id", "importance"),
    )
