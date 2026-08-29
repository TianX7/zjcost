"""add_background_tasks

Revision ID: c4d5e6f7a2b3
Revises: b3c4d5e6f7a2
Create Date: 2026-06-15 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "c4d5e6f7a2b3"
down_revision: Union[str, Sequence[str], None] = "b3c4d5e6f7a2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "background_tasks",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("task_type", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="processing"),
        sa.Column("payload_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_background_tasks_task_type", "background_tasks", ["task_type"])
    op.create_index("ix_background_tasks_status", "background_tasks", ["status"])


def downgrade() -> None:
    op.drop_index("ix_background_tasks_status", table_name="background_tasks")
    op.drop_index("ix_background_tasks_task_type", table_name="background_tasks")
    op.drop_table("background_tasks")
