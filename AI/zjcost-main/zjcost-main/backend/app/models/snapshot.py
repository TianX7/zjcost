from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Snapshot(Base):
    __tablename__ = "snapshots"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    # 外键关联 projects，级联删除 + 索引（section 5 & 6）
    project_id: Mapped[int] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    label: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    # 统一使用 DateTime(timezone=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False,
    )
    grand_total: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    data_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
