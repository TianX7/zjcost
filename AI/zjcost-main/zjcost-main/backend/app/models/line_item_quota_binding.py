from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, Index, Integer, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class LineItemQuotaBinding(Base):
    __tablename__ = "line_item_quota_bindings"
    __table_args__ = (
        UniqueConstraint("boq_item_id", "quota_item_id", name="uq_boq_quota_binding"),
        Index("ix_binding_boq_item_id", "boq_item_id"),
        Index("ix_binding_quota_item_id", "quota_item_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    # 外键关联 boq_items，级联删除（section 5）
    boq_item_id: Mapped[int] = mapped_column(
        ForeignKey("boq_items.id", ondelete="CASCADE"), nullable=False,
    )
    # 外键关联 quota_items，级联删除（section 5）
    quota_item_id: Mapped[int] = mapped_column(
        ForeignKey("quota_items.id", ondelete="CASCADE"), nullable=False,
    )
    coefficient: Mapped[float] = mapped_column(Float, nullable=False, default=1.0)
    # 补充审计字段（section 3），nullable=True 保持向后兼容
    created_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=True,
    )
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), server_default=func.now(),
        onupdate=func.now(), nullable=True,
    )
