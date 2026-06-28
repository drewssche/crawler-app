"""add run crawl runtime

Revision ID: 9a4f2c7d8b31
Revises: f3a9c7d2e4b1
Create Date: 2026-06-28 00:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "9a4f2c7d8b31"
down_revision: Union[str, Sequence[str], None] = "f3a9c7d2e4b1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("runs", sa.Column("crawl_runtime", sa.String(length=30), nullable=False, server_default="http"))


def downgrade() -> None:
    op.drop_column("runs", "crawl_runtime")
