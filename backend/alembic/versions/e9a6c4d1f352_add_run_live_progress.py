"""add run live progress

Revision ID: e9a6c4d1f352
Revises: d8f5b3c0e241
Create Date: 2026-06-25 00:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "e9a6c4d1f352"
down_revision: Union[str, Sequence[str], None] = "d8f5b3c0e241"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("runs", sa.Column("current_url", sa.Text(), nullable=True))
    op.add_column("runs", sa.Column("progress_updated_at", sa.DateTime(), nullable=True))


def downgrade() -> None:
    op.drop_column("runs", "progress_updated_at")
    op.drop_column("runs", "current_url")
