"""add monitoring notification retry policy

Revision ID: f2c9a7e8d104
Revises: e8b2a6c4d901
Create Date: 2026-07-01
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "f2c9a7e8d104"
down_revision: Union[str, Sequence[str], None] = "e8b2a6c4d901"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("page_monitoring_notification_outbox", sa.Column("max_attempts", sa.Integer(), nullable=False, server_default="5"))
    op.add_column("page_monitoring_notification_outbox", sa.Column("next_attempt_at", sa.DateTime(), nullable=True))
    op.create_index("ix_page_monitoring_notification_outbox_next_attempt_at", "page_monitoring_notification_outbox", ["next_attempt_at"])
    op.create_index(
        "ix_page_monitoring_notification_outbox_retry_ready",
        "page_monitoring_notification_outbox",
        ["delivery_status", "next_attempt_at"],
    )
    op.alter_column("page_monitoring_notification_outbox", "max_attempts", server_default=None)


def downgrade() -> None:
    op.drop_index("ix_page_monitoring_notification_outbox_retry_ready", table_name="page_monitoring_notification_outbox")
    op.drop_index("ix_page_monitoring_notification_outbox_next_attempt_at", table_name="page_monitoring_notification_outbox")
    op.drop_column("page_monitoring_notification_outbox", "next_attempt_at")
    op.drop_column("page_monitoring_notification_outbox", "max_attempts")
