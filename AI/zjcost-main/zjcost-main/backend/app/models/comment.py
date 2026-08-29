from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Comment(Base):
    __tablename__ = "comments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    # 外键关联 projects，添加索引（section 6）
    project_id: Mapped[int] = mapped_column(
        ForeignKey("projects.id"),
        nullable=False, index=True,
    )
    # 外键关联 boq_items，级联删除（section 4 & 5 & 6）
    boq_item_id: Mapped[int | None] = mapped_column(
        ForeignKey("boq_items.id", ondelete="CASCADE"),
        nullable=True, default=None, index=True,
    )
    author: Mapped[str] = mapped_column(String(100), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    # 统一使用 DateTime(timezone=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False,
    )
