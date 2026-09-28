"""add_old_material_quota_fields

为 quota_items 添加旧材料（遗址修复材料）扩展字段：
- acquisition_method: 获取方式 recycle=当地回收 / reproduce=原材料复现
- origin_note: 来源说明
- heritage_site: 关联遗址/文物名称
- relic_level: 文物等级
- repair_part: 修复部位
- condition_grade: 成新率/成色
- batch_no: 批次号
- inspection_report_no: 检测报告编号

Revision ID: d5e6f7a8b9c0
Revises: c4d5e6f7a2b3
Create Date: 2026-08-24 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "d5e6f7a8b9c0"
down_revision: Union[str, Sequence[str], None] = "c4d5e6f7a2b3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("quota_items") as batch_op:
        batch_op.add_column(
            sa.Column("acquisition_method", sa.String(length=20), nullable=False, server_default="")
        )
        batch_op.add_column(
            sa.Column("origin_note", sa.Text(), nullable=False, server_default="")
        )
        batch_op.add_column(
            sa.Column("heritage_site", sa.String(length=255), nullable=False, server_default="")
        )
        batch_op.add_column(
            sa.Column("relic_level", sa.String(length=50), nullable=False, server_default="")
        )
        batch_op.add_column(
            sa.Column("repair_part", sa.String(length=255), nullable=False, server_default="")
        )
        batch_op.add_column(
            sa.Column("condition_grade", sa.String(length=50), nullable=False, server_default="")
        )
        batch_op.add_column(
            sa.Column("batch_no", sa.String(length=100), nullable=False, server_default="")
        )
        batch_op.add_column(
            sa.Column("inspection_report_no", sa.String(length=100), nullable=False, server_default="")
        )
    op.create_index(
        "ix_quota_items_acquisition_method",
        "quota_items",
        ["acquisition_method"],
    )


def downgrade() -> None:
    op.drop_index("ix_quota_items_acquisition_method", table_name="quota_items")
    with op.batch_alter_table("quota_items") as batch_op:
        batch_op.drop_column("inspection_report_no")
        batch_op.drop_column("batch_no")
        batch_op.drop_column("condition_grade")
        batch_op.drop_column("repair_part")
        batch_op.drop_column("relic_level")
        batch_op.drop_column("heritage_site")
        batch_op.drop_column("origin_note")
        batch_op.drop_column("acquisition_method")
