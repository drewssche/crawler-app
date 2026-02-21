"""add event feed tables

Revision ID: e6c4a7f6a2d1
Revises: 97f0111bd116
Create Date: 2026-02-17 17:20:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "e6c4a7f6a2d1"
down_revision: Union[str, Sequence[str], None] = "97f0111bd116"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "event_feed",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("event_type", sa.String(length=64), nullable=False),
        sa.Column("channel", sa.String(length=20), nullable=False),
        sa.Column("severity", sa.String(length=20), nullable=False),
        sa.Column("title", sa.String(length=160), nullable=False),
        sa.Column("body", sa.Text(), nullable=True),
        sa.Column("target_path", sa.String(length=255), nullable=True),
        sa.Column("target_ref", sa.String(length=255), nullable=True),
        sa.Column("actor_user_id", sa.Integer(), nullable=True),
        sa.Column("target_user_id", sa.Integer(), nullable=True),
        sa.Column("meta_json", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["actor_user_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["target_user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_event_feed_event_type"), "event_feed", ["event_type"], unique=False)
    op.create_index(op.f("ix_event_feed_channel"), "event_feed", ["channel"], unique=False)
    op.create_index(op.f("ix_event_feed_severity"), "event_feed", ["severity"], unique=False)
    op.create_index(op.f("ix_event_feed_actor_user_id"), "event_feed", ["actor_user_id"], unique=False)
    op.create_index(op.f("ix_event_feed_target_user_id"), "event_feed", ["target_user_id"], unique=False)
    op.create_index(op.f("ix_event_feed_created_at"), "event_feed", ["created_at"], unique=False)

    op.create_table(
        "event_user_state",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("event_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("is_read", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("read_at", sa.DateTime(), nullable=True),
        sa.Column("is_dismissed", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("dismissed_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["event_id"], ["event_feed.id"]),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("event_id", "user_id", name="uq_event_user_state_event_user"),
    )
    op.create_index(op.f("ix_event_user_state_event_id"), "event_user_state", ["event_id"], unique=False)
    op.create_index(op.f("ix_event_user_state_user_id"), "event_user_state", ["user_id"], unique=False)
    op.create_index(op.f("ix_event_user_state_is_read"), "event_user_state", ["is_read"], unique=False)
    op.create_index(op.f("ix_event_user_state_is_dismissed"), "event_user_state", ["is_dismissed"], unique=False)
    op.create_index(op.f("ix_event_user_state_created_at"), "event_user_state", ["created_at"], unique=False)
    op.create_index(op.f("ix_event_user_state_updated_at"), "event_user_state", ["updated_at"], unique=False)

    op.alter_column("event_user_state", "is_read", server_default=None)
    op.alter_column("event_user_state", "is_dismissed", server_default=None)


def downgrade() -> None:
    op.drop_index(op.f("ix_event_user_state_updated_at"), table_name="event_user_state")
    op.drop_index(op.f("ix_event_user_state_created_at"), table_name="event_user_state")
    op.drop_index(op.f("ix_event_user_state_is_dismissed"), table_name="event_user_state")
    op.drop_index(op.f("ix_event_user_state_is_read"), table_name="event_user_state")
    op.drop_index(op.f("ix_event_user_state_user_id"), table_name="event_user_state")
    op.drop_index(op.f("ix_event_user_state_event_id"), table_name="event_user_state")
    op.drop_table("event_user_state")

    op.drop_index(op.f("ix_event_feed_created_at"), table_name="event_feed")
    op.drop_index(op.f("ix_event_feed_target_user_id"), table_name="event_feed")
    op.drop_index(op.f("ix_event_feed_actor_user_id"), table_name="event_feed")
    op.drop_index(op.f("ix_event_feed_severity"), table_name="event_feed")
    op.drop_index(op.f("ix_event_feed_channel"), table_name="event_feed")
    op.drop_index(op.f("ix_event_feed_event_type"), table_name="event_feed")
    op.drop_table("event_feed")
