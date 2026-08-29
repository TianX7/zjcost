from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, Integer, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class CalcResult(Base):
    __tablename__ = "calc_results"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    # 外键关联 boq_items，级联删除 + 索引（section 5 & 6）
    boq_item_id: Mapped[int] = mapped_column(
        ForeignKey("boq_items.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    total_cost: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    labor_cost: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    material_cost: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    machine_cost: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    direct_cost: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    management_fee: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    profit: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    regulatory_fee: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    pre_tax_total: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    tax: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    # 补充审计字段（section 3），nullable=True 保持向后兼容
    created_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=True,
    )
