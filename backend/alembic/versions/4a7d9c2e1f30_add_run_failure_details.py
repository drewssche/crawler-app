"""add run failure details

Revision ID: 4a7d9c2e1f30
Revises: e7c2d5a1f4b9
Create Date: 2026-06-22 00:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "4a7d9c2e1f30"
down_revision: Union[str, Sequence[str], None] = "e7c2d5a1f4b9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("runs", sa.Column("failure_code", sa.String(length=50), nullable=True))
    op.add_column("runs", sa.Column("failure_message", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("runs", "failure_message")
    op.drop_column("runs", "failure_code")
