from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class ProjectValuationConfig(Base):
    __tablename__ = "project_valuation_configs"
    __table_args__ = (
        UniqueConstraint("project_id", name="uq_project_valuation_config_project_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    # 外键关联 projects，级联删除（section 5）
    project_id: Mapped[int] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
    )
    standard_code: Mapped[str] = mapped_column(
        String(100), nullable=False, default="GB/T50500-2024"
    )
    standard_name: Mapped[str] = mapped_column(
        String(255), nullable=False, default="建设工程工程量清单计价标准"
    )
    effective_date: Mapped[str] = mapped_column(String(20), nullable=False, default="2025-09-01")
    # 统一使用 DateTime(timezone=True)
    locked_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, default=None,
    )
    # 补充 created_at 审计字段（section 2 & 3），nullable=True 保持向后兼容
    created_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=True,
    )
    # 统一使用 DateTime(timezone=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(),
        onupdate=func.now(), nullable=False,
    )
