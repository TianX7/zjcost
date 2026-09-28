from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class PaymentCertificate(Base):
    __tablename__ = "payment_certificates"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    # 外键关联 projects，级联删除 + 索引（section 5 & 6）
    project_id: Mapped[int] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    period_label: Mapped[str] = mapped_column(String(100), nullable=False, default="")
    gross_amount: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    prepayment_deduction: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    retention: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    net_payable: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    paid_amount: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    status: Mapped[str] = mapped_column(String(50), nullable=False, default="issued")
    # 统一使用 DateTime(timezone=True)
    issued_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True,
    )
    # 补充审计字段（section 2 & 3），nullable=True 保持向后兼容
    created_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=True,
    )
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), server_default=func.now(),
        onupdate=func.now(), nullable=True,
    )
