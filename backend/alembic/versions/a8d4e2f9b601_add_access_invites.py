"""add access invites

Revision ID: a8d4e2f9b601
Revises: f2c9a7e8d104
Create Date: 2026-07-02
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "a8d4e2f9b601"
down_revision: Union[str, Sequence[str], None] = "f2c9a7e8d104"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "access_invites",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("email", sa.String(length=320), nullable=False),
        sa.Column("role", sa.String(length=20), nullable=False, server_default="viewer"),
        sa.Column("token_hash", sa.String(length=128), nullable=False),
        sa.Column("created_by_user_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("sent_at", sa.DateTime(), nullable=True),
        sa.Column("accepted_at", sa.DateTime(), nullable=True),
        sa.Column("revoked_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token_hash"),
    )
    op.create_index("ix_access_invites_email", "access_invites", ["email"])
    op.create_index("ix_access_invites_token_hash", "access_invites", ["token_hash"])
    op.create_index("ix_access_invites_created_at", "access_invites", ["created_at"])
    op.create_index("ix_access_invites_expires_at", "access_invites", ["expires_at"])
    op.alter_column("access_invites", "role", server_default=None)


def downgrade() -> None:
    op.drop_index("ix_access_invites_expires_at", table_name="access_invites")
    op.drop_index("ix_access_invites_created_at", table_name="access_invites")
    op.drop_index("ix_access_invites_token_hash", table_name="access_invites")
    op.drop_index("ix_access_invites_email", table_name="access_invites")
    op.drop_table("access_invites")
