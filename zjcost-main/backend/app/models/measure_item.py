from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class MeasureItem(Base):
    __tablename__ = "measure_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    # 外键关联 projects，级联删除 + 索引（section 5 & 6）
    project_id: Mapped[int] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    calc_base: Mapped[str] = mapped_column(String(50), nullable=False, default="direct")  # "direct" | "pre_tax"
    rate: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    amount: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    is_fixed: Mapped[int] = mapped_column(Integer, nullable=False, default=0)  # 1=fixed amount, 0=rate-based
    # 补充审计字段（section 3），nullable=True 保持向后兼容
    created_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=True,
    )
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), server_default=func.now(),
        onupdate=func.now(), nullable=True,
    )
