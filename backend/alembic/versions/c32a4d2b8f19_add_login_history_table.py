"""add login history table

Revision ID: c32a4d2b8f19
Revises: 7b6f1d2a9c31
Create Date: 2026-02-18 00:30:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "c32a4d2b8f19"
down_revision: Union[str, Sequence[str], None] = "7b6f1d2a9c31"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "login_history",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=True),
        sa.Column("email", sa.String(length=320), nullable=False),
        sa.Column("ip", sa.String(length=64), nullable=True),
        sa.Column("user_agent", sa.String(length=255), nullable=True),
        sa.Column("result", sa.String(length=40), nullable=False),
        sa.Column("source", sa.String(length=30), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_login_history_user_id"), "login_history", ["user_id"], unique=False)
    op.create_index(op.f("ix_login_history_email"), "login_history", ["email"], unique=False)
    op.create_index(op.f("ix_login_history_ip"), "login_history", ["ip"], unique=False)
    op.create_index(op.f("ix_login_history_result"), "login_history", ["result"], unique=False)
    op.create_index(op.f("ix_login_history_source"), "login_history", ["source"], unique=False)
    op.create_index(op.f("ix_login_history_created_at"), "login_history", ["created_at"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_login_history_created_at"), table_name="login_history")
    op.drop_index(op.f("ix_login_history_source"), table_name="login_history")
    op.drop_index(op.f("ix_login_history_result"), table_name="login_history")
    op.drop_index(op.f("ix_login_history_ip"), table_name="login_history")
    op.drop_index(op.f("ix_login_history_email"), table_name="login_history")
    op.drop_index(op.f("ix_login_history_user_id"), table_name="login_history")
    op.drop_table("login_history")
