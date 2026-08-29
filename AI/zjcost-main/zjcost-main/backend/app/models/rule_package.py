from datetime import datetime

from sqlalchemy import DateTime, Float, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class RulePackage(Base):
    __tablename__ = "rule_packages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    region: Mapped[str] = mapped_column(String(100), nullable=False, default="")
    management_rate: Mapped[float] = mapped_column(Float, nullable=False, default=0.08)
    profit_rate: Mapped[float] = mapped_column(Float, nullable=False, default=0.05)
    regulatory_rate: Mapped[float] = mapped_column(Float, nullable=False, default=0.03)
    tax_rate: Mapped[float] = mapped_column(Float, nullable=False, default=0.09)
    rounding_rule: Mapped[str] = mapped_column(String(50), nullable=False, default="ROUND_HALF_UP")
    version: Mapped[str] = mapped_column(String(50), nullable=False, default="1.0")
    # 补充审计字段（section 3），nullable=True 保持向后兼容
    created_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=True,
    )
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), server_default=func.now(),
        onupdate=func.now(), nullable=True,
    )
