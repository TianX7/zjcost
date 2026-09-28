"""add_calc_result_breakdown_fields

Revision ID: b3c4d5e6f7a2
Revises: a2b3c4d5e6f7
Create Date: 2026-06-12 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b3c4d5e6f7a2'
down_revision: Union[str, Sequence[str], None] = 'a2b3c4d5e6f7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('calc_results', sa.Column('labor_cost', sa.Float(), nullable=False, server_default='0'))
    op.add_column('calc_results', sa.Column('material_cost', sa.Float(), nullable=False, server_default='0'))
    op.add_column('calc_results', sa.Column('machine_cost', sa.Float(), nullable=False, server_default='0'))
    op.add_column('calc_results', sa.Column('direct_cost', sa.Float(), nullable=False, server_default='0'))
    op.add_column('calc_results', sa.Column('management_fee', sa.Float(), nullable=False, server_default='0'))
    op.add_column('calc_results', sa.Column('profit', sa.Float(), nullable=False, server_default='0'))
    op.add_column('calc_results', sa.Column('regulatory_fee', sa.Float(), nullable=False, server_default='0'))
    op.add_column('calc_results', sa.Column('pre_tax_total', sa.Float(), nullable=False, server_default='0'))
    op.add_column('calc_results', sa.Column('tax', sa.Float(), nullable=False, server_default='0'))


def downgrade() -> None:
    op.drop_column('calc_results', 'tax')
    op.drop_column('calc_results', 'pre_tax_total')
    op.drop_column('calc_results', 'regulatory_fee')
    op.drop_column('calc_results', 'profit')
    op.drop_column('calc_results', 'management_fee')
    op.drop_column('calc_results', 'direct_cost')
    op.drop_column('calc_results', 'machine_cost')
    op.drop_column('calc_results', 'material_cost')
    op.drop_column('calc_results', 'labor_cost')
