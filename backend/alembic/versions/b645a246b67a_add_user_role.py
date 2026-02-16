"""add user role

Revision ID: b645a246b67a
Revises: b1e9670eb006
Create Date: 2026-02-16 00:35:17.577353

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b645a246b67a'
down_revision: Union[str, Sequence[str], None] = 'b1e9670eb006'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "users",
        sa.Column("role", sa.String(length=20), nullable=False, server_default="viewer"),
    )
    op.alter_column("users", "role", server_default=None)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("users", "role")
