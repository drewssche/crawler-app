"""add handled state to event_user_state

Revision ID: f9b3c1e8a2d4
Revises: e6c4a7f6a2d1
Create Date: 2026-02-20 00:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "f9b3c1e8a2d4"
down_revision: Union[str, Sequence[str], None] = "c32a4d2b8f19"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "event_user_state",
        sa.Column("is_handled", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column("event_user_state", sa.Column("handled_at", sa.DateTime(), nullable=True))
    op.create_index(op.f("ix_event_user_state_is_handled"), "event_user_state", ["is_handled"], unique=False)
    op.alter_column("event_user_state", "is_handled", server_default=None)


def downgrade() -> None:
    op.drop_index(op.f("ix_event_user_state_is_handled"), table_name="event_user_state")
    op.drop_column("event_user_state", "handled_at")
    op.drop_column("event_user_state", "is_handled")
