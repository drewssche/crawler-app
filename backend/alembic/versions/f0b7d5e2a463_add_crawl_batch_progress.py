"""add crawl batch progress

Revision ID: f0b7d5e2a463
Revises: e9a6c4d1f352
Create Date: 2026-06-25 00:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "f0b7d5e2a463"
down_revision: Union[str, Sequence[str], None] = "e9a6c4d1f352"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("runs", sa.Column("pages_discovered", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("runs", sa.Column("current_batch_no", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("pages", sa.Column("crawl_batch_no", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("pages", "crawl_batch_no")
    op.drop_column("runs", "current_batch_no")
    op.drop_column("runs", "pages_discovered")
