"""add indexes for event_user_state and event_feed

Revision ID: a3c1e8f4b7d2
Revises: f9b3c1e8a2d4
Create Date: 2026-02-21 00:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "a3c1e8f4b7d2"
down_revision: Union[str, Sequence[str], None] = "f9b3c1e8a2d4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_index(
        op.f("ix_event_user_state_user_read_event"),
        "event_user_state",
        ["user_id", "is_read", "event_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_event_feed_channel_severity_created_id"),
        "event_feed",
        ["channel", "severity", "created_at", "id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_event_feed_channel_severity_created_id"), table_name="event_feed")
    op.drop_index(op.f("ix_event_user_state_user_read_event"), table_name="event_user_state")
