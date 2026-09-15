from datetime import datetime

from sqlalchemy import DateTime, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class WalkReview(Base):
    """模型漫游复核留痕：保存每次漫游核查的结论（通过 / 待整改）与整改说明。"""

    __tablename__ = "walk_reviews"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    scene_title: Mapped[str] = mapped_column(String(200), nullable=False, default="")  # 复核场景名称
    element_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)      # 复核构件数
    result: Mapped[str] = mapped_column(String(20), nullable=False, default="passed")   # passed / needs_fix
    note: Mapped[str] = mapped_column(Text, nullable=False, default="")                 # 复核备注 / 整改说明
    # 统一审计字段
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False,
    )