from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class PriceAdjustment(Base):
    __tablename__ = "price_adjustments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    # 外键关联 projects，添加索引（section 6）
    project_id: Mapped[int] = mapped_column(
        ForeignKey("projects.id"),
        nullable=False, index=True,
    )
    # 外键关联 boq_items，级联删除 + 索引（section 4 & 5 & 6）
    boq_item_id: Mapped[int | None] = mapped_column(
        ForeignKey("boq_items.id", ondelete="CASCADE"),
        nullable=True, default=None, index=True,
    )
    adjustment_type: Mapped[str] = mapped_column(String(100), nullable=False, default="change_order")
    amount: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    status: Mapped[str] = mapped_column(String(50), nullable=False, default="draft")
    reason: Mapped[str] = mapped_column(Text, nullable=False, default="")
    # 统一使用 DateTime(timezone=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False,
    )
    # 补充 updated_at 审计字段（section 3），nullable=True 保持向后兼容
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), server_default=func.now(),
        onupdate=func.now(), nullable=True,
    )
