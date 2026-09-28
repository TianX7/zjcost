from datetime import datetime

from sqlalchemy import DateTime, MetaData, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


# 统一约束命名约定：确保 Alembic/SQLite 批处理迁移能正确识别并操作约束
NAMING_CONVENTION = {
    "ix": "ix_%(table_name)s_%(column_0_N_name)s",
    "uq": "uq_%(table_name)s_%(column_0_N_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_N_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING_CONVENTION)


class TimestampMixin:
    """统一的审计时间戳混入。

    为模型提供 created_at / updated_at 两个字段：
    - created_at: 记录创建时间，由数据库 server_default=func.now() 自动填充
    - updated_at: 记录更新时间，每次 UPDATE 时由 onupdate=func.now() 自动刷新

    使用方式：
        class MyModel(Base, TimestampMixin):
            ...
    """

    # 创建时间：数据库侧默认值，保证旧数据迁移时也能自动填充
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    # 更新时间：每次更新时自动刷新
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
