from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class BoqItem(Base):
    __tablename__ = "boq_items"
    # 唯一约束：同一项目下清单编码唯一（section 7）
    __table_args__ = (
        UniqueConstraint("project_id", "code", name="uq_boq_item_project_code"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    # 外键关联 projects，级联删除（section 5）
    project_id: Mapped[int] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    # 常用查询字段添加索引（section 6）
    code: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    unit: Mapped[str] = mapped_column(String(50), nullable=False)
    quantity: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    characteristics: Mapped[str] = mapped_column(String(500), nullable=False, default="")  # 项目特征
    division: Mapped[str] = mapped_column(String(100), nullable=False, default="")  # 分部名称
    is_dirty: Mapped[int] = mapped_column(Integer, nullable=False, default=1)  # 1=needs recalc
    # ── Ordering & HK-style fields ──
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    item_ref: Mapped[str] = mapped_column(String(50), nullable=False, default="")  # HKSMM ref e.g. "A/1"
    trade_section: Mapped[str] = mapped_column(String(100), nullable=False, default="")  # HKSMM trade
    description_en: Mapped[str] = mapped_column(Text, nullable=False, default="")  # English description
    rate: Mapped[float] = mapped_column(Float, nullable=False, default=0)  # HK rate-based pricing
    amount: Mapped[float] = mapped_column(Float, nullable=False, default=0)  # rate × quantity
    remark: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    # 补充审计字段（section 3），nullable=True 保持向后兼容
    created_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=True,
    )
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), server_default=func.now(),
        onupdate=func.now(), nullable=True,
    )
