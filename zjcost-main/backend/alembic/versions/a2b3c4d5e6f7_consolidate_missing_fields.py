"""consolidate missing fields from dev migration

Revision ID: a2b3c4d5e6f7
Revises: a1b2c3d4e5f6
Create Date: 2026-06-01 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'a2b3c4d5e6f7'
down_revision: Union[str, Sequence[str], None] = 'a1b2c3d4e5f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _dialect_name() -> str:
    return op.get_bind().dialect.name


def upgrade() -> None:
    conn = op.get_bind()

    # --- projects: standard_type / language / currency ---
    existing = {row[1] for row in conn.execute(sa.text("PRAGMA table_info('projects')"))} if _dialect_name() == "sqlite" else {
        row.column_name for row in conn.execute(
            sa.text("SELECT column_name FROM information_schema.columns WHERE table_name='projects'")
        )
    }
    def _add_if_missing(col_name, col):
        if col_name not in existing:
            op.add_column('projects', col)

    _add_if_missing('standard_type', sa.Column('standard_type', sa.String(50), nullable=False, server_default='GB50500'))
    _add_if_missing('language', sa.Column('language', sa.String(20), nullable=False, server_default='zh'))
    _add_if_missing('currency', sa.Column('currency', sa.String(10), nullable=False, server_default='CNY'))

    # --- quota_items: discipline + unique index ---
    if "quota_items" in {row[0] for row in conn.execute(sa.text("SELECT name FROM sqlite_master WHERE type='table'"))} if _dialect_name() == "sqlite" else set():
        quota_cols = {row[1] for row in conn.execute(sa.text("PRAGMA table_info('quota_items')"))} if _dialect_name() == "sqlite" else {
            row.column_name for row in conn.execute(
                sa.text("SELECT column_name FROM information_schema.columns WHERE table_name='quota_items'")
            )
        }
        if "discipline" not in quota_cols:
            op.add_column('quota_items', sa.Column('discipline', sa.String(50), nullable=False, server_default='土建'))

    if _dialect_name() == "sqlite":
        op.execute("CREATE UNIQUE INDEX IF NOT EXISTS uq_quota_items_discipline_code ON quota_items (discipline, quota_code)")
    else:
        op.create_unique_constraint("uq_quota_items_discipline_code", "quota_items", ["discipline", "quota_code"])

    # --- line_item_quota_bindings: coefficient ---
    if "line_item_quota_bindings" in {row[0] for row in conn.execute(sa.text("SELECT name FROM sqlite_master WHERE type='table'"))} if _dialect_name() == "sqlite" else set():
        bind_cols = {row[1] for row in conn.execute(sa.text("PRAGMA table_info('line_item_quota_bindings')"))} if _dialect_name() == "sqlite" else {
            row.column_name for row in conn.execute(
                sa.text("SELECT column_name FROM information_schema.columns WHERE table_name='line_item_quota_bindings'")
            )
        }
        if "coefficient" not in bind_cols:
            if _dialect_name() == "sqlite":
                op.add_column('line_item_quota_bindings', sa.Column('coefficient', sa.Float(), nullable=False, server_default='1.0'))
            else:
                op.add_column('line_item_quota_bindings', sa.Column('coefficient', sa.Double(), nullable=False, server_default='1.0'))

    # --- material_prices: fetched_at ---
    if "material_prices" in {row[0] for row in conn.execute(sa.text("SELECT name FROM sqlite_master WHERE type='table'"))} if _dialect_name() == "sqlite" else set():
        mat_cols = {row[1] for row in conn.execute(sa.text("PRAGMA table_info('material_prices')"))} if _dialect_name() == "sqlite" else {
            row.column_name for row in conn.execute(
                sa.text("SELECT column_name FROM information_schema.columns WHERE table_name='material_prices'")
            )
        }
        if "fetched_at" not in mat_cols:
            op.add_column('material_prices', sa.Column('fetched_at', sa.String(20), nullable=True))

    # --- boq_items: index on project_id ---
    op.create_index('ix_boq_items_project_id', 'boq_items', ['project_id'])


def downgrade() -> None:
    op.drop_index('ix_boq_items_project_id', table_name='boq_items')
    op.drop_column('material_prices', 'fetched_at')
    op.drop_column('line_item_quota_bindings', 'coefficient')
    if _dialect_name() == "sqlite":
        op.execute("DROP INDEX IF EXISTS uq_quota_items_discipline_code")
    else:
        op.drop_constraint("uq_quota_items_discipline_code", "quota_items", type_="unique")
    op.drop_column('quota_items', 'discipline')
    op.drop_column('projects', 'currency')
    op.drop_column('projects', 'language')
    op.drop_column('projects', 'standard_type')
