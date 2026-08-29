"""KnowledgeNote — Markdown notes attached to any entity.

Captures domain expertise, construction tips, cost analysis remarks, etc.
Each note is linked to a specific entity via (entity_type, entity_id).
"""

from datetime import datetime

from sqlalchemy import DateTime, Index, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class KnowledgeNote(Base):
    __tablename__ = "knowledge_notes"
    __table_args__ = (
        Index("ix_kn_entity", "entity_type", "entity_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    entity_type: Mapped[str] = mapped_column(String(50), nullable=False)
    entity_id: Mapped[int] = mapped_column(Integer, nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    content: Mapped[str] = mapped_column(Text, nullable=False, default="")  # Markdown
    # 统一使用 DateTime(timezone=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(),
        onupdate=func.now(), nullable=False,
    )
