from datetime import datetime

from sqlalchemy import DateTime, Float, Index, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class MaterialPrice(Base):
    __tablename__ = "material_prices"
    __table_args__ = (
        Index("ix_material_price_lookup", "name", "region", "effective_date"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    code: Mapped[str] = mapped_column(String(100), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    spec: Mapped[str] = mapped_column(String(255), nullable=True, default="")
    unit: Mapped[str] = mapped_column(String(50), nullable=False)
    unit_price: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    source: Mapped[str] = mapped_column(String(100), nullable=False, default="manual")
    region: Mapped[str] = mapped_column(String(100), nullable=False, default="")
    # 修复默认值：从 "1970-01-01" 改为 None（section 9），nullable=True
    effective_date: Mapped[str | None] = mapped_column(
        String(20), nullable=True, default=None,
    )
    # 修复：nullable=True（section 9）
    fetched_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, default=None,
    )
    # 补充审计字段（section 3），nullable=True 保持向后兼容
    created_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=True,
    )
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), server_default=func.now(),
        onupdate=func.now(), nullable=True,
    )
