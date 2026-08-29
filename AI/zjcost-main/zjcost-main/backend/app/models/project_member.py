from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class ProjectMember(Base):
    __tablename__ = "project_members"
    # 唯一约束：同一项目下用户名唯一（section 7）
    __table_args__ = (
        UniqueConstraint("project_id", "user_name", name="uq_project_member_project_user"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    # 外键关联 projects，级联删除 + 索引（section 5 & 6）
    project_id: Mapped[int] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    user_name: Mapped[str] = mapped_column(String(100), nullable=False)
    role: Mapped[str] = mapped_column(String(50), nullable=False, default="viewer")  # owner/editor/viewer
    # 补充审计字段（section 3），nullable=True 保持向后兼容
    created_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=True,
    )
