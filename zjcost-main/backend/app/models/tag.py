"""Tag model for the universal tagging system.

Tags can be attached to any entity (project, boq_item, quota_item, material_price, etc.)
via the EntityTag junction table, enabling flexible cross-dimensional aggregation.
"""

from datetime import datetime

from sqlalchemy import DateTime, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Tag(Base):
    __tablename__ = "tags"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False, unique=True)
    color: Mapped[str] = mapped_column(String(20), nullable=False, default="#3b82f6")  # hex color
    category: Mapped[str] = mapped_column(String(100), nullable=False, default="")  # e.g. "地区", "建筑类型", "时间"
    # 统一使用 DateTime(timezone=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False,
    )
