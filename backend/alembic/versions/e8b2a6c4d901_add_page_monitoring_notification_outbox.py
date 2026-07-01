"""add page monitoring notification outbox

Revision ID: e8b2a6c4d901
Revises: d6f4b9e2a731
Create Date: 2026-07-01
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "e8b2a6c4d901"
down_revision: Union[str, Sequence[str], None] = "d6f4b9e2a731"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "page_monitoring_target_subscriptions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("target_id", sa.Integer(), nullable=False),
        sa.Column("project_id", sa.Integer(), nullable=False),
        sa.Column("created_by_user_id", sa.Integer(), nullable=True),
        sa.Column("channel_type", sa.String(length=40), nullable=False),
        sa.Column("destination", sa.String(length=500), nullable=False),
        sa.Column("statuses_json", sa.JSON(), nullable=True),
        sa.Column("min_interval_minutes", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("last_enqueued_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["target_id"], ["page_monitoring_targets.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_page_monitoring_target_subscriptions_target_id", "page_monitoring_target_subscriptions", ["target_id"])
    op.create_index("ix_page_monitoring_target_subscriptions_project_id", "page_monitoring_target_subscriptions", ["project_id"])
    op.create_index("ix_page_monitoring_target_subscriptions_created_by_user_id", "page_monitoring_target_subscriptions", ["created_by_user_id"])
    op.create_index("ix_page_monitoring_target_subscriptions_channel_type", "page_monitoring_target_subscriptions", ["channel_type"])
    op.create_index("ix_page_monitoring_target_subscriptions_is_active", "page_monitoring_target_subscriptions", ["is_active"])
    op.create_index("ix_page_monitoring_target_subscriptions_last_enqueued_at", "page_monitoring_target_subscriptions", ["last_enqueued_at"])
    op.create_index(
        "ix_page_monitoring_target_subscriptions_target_active",
        "page_monitoring_target_subscriptions",
        ["target_id", "is_active"],
    )
    op.alter_column("page_monitoring_target_subscriptions", "min_interval_minutes", server_default=None)
    op.alter_column("page_monitoring_target_subscriptions", "is_active", server_default=None)
    op.alter_column("page_monitoring_target_subscriptions", "created_at", server_default=None)
    op.alter_column("page_monitoring_target_subscriptions", "updated_at", server_default=None)

    op.create_table(
        "page_monitoring_notification_outbox",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("subscription_id", sa.Integer(), nullable=True),
        sa.Column("target_id", sa.Integer(), nullable=False),
        sa.Column("target_check_id", sa.Integer(), nullable=False),
        sa.Column("project_id", sa.Integer(), nullable=False),
        sa.Column("channel_type", sa.String(length=40), nullable=False),
        sa.Column("destination", sa.String(length=500), nullable=False),
        sa.Column("event_status", sa.String(length=30), nullable=False),
        sa.Column("delivery_status", sa.String(length=30), nullable=False, server_default="queued"),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("payload_json", sa.JSON(), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("sent_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["subscription_id"], ["page_monitoring_target_subscriptions.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["target_check_id"], ["page_monitoring_target_checks.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["target_id"], ["page_monitoring_targets.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_page_monitoring_notification_outbox_subscription_id", "page_monitoring_notification_outbox", ["subscription_id"])
    op.create_index("ix_page_monitoring_notification_outbox_target_id", "page_monitoring_notification_outbox", ["target_id"])
    op.create_index("ix_page_monitoring_notification_outbox_target_check_id", "page_monitoring_notification_outbox", ["target_check_id"])
    op.create_index("ix_page_monitoring_notification_outbox_project_id", "page_monitoring_notification_outbox", ["project_id"])
    op.create_index("ix_page_monitoring_notification_outbox_channel_type", "page_monitoring_notification_outbox", ["channel_type"])
    op.create_index("ix_page_monitoring_notification_outbox_event_status", "page_monitoring_notification_outbox", ["event_status"])
    op.create_index("ix_page_monitoring_notification_outbox_delivery_status", "page_monitoring_notification_outbox", ["delivery_status"])
    op.create_index("ix_page_monitoring_notification_outbox_created_at", "page_monitoring_notification_outbox", ["created_at"])
    op.create_index("ix_page_monitoring_notification_outbox_sent_at", "page_monitoring_notification_outbox", ["sent_at"])
    op.create_index(
        "ix_page_monitoring_notification_outbox_delivery_queue",
        "page_monitoring_notification_outbox",
        ["delivery_status", "created_at"],
    )
    op.alter_column("page_monitoring_notification_outbox", "delivery_status", server_default=None)
    op.alter_column("page_monitoring_notification_outbox", "attempts", server_default=None)
    op.alter_column("page_monitoring_notification_outbox", "last_error", server_default=None)
    op.alter_column("page_monitoring_notification_outbox", "created_at", server_default=None)


def downgrade() -> None:
    op.drop_index("ix_page_monitoring_notification_outbox_delivery_queue", table_name="page_monitoring_notification_outbox")
    op.drop_index("ix_page_monitoring_notification_outbox_sent_at", table_name="page_monitoring_notification_outbox")
    op.drop_index("ix_page_monitoring_notification_outbox_created_at", table_name="page_monitoring_notification_outbox")
    op.drop_index("ix_page_monitoring_notification_outbox_delivery_status", table_name="page_monitoring_notification_outbox")
    op.drop_index("ix_page_monitoring_notification_outbox_event_status", table_name="page_monitoring_notification_outbox")
    op.drop_index("ix_page_monitoring_notification_outbox_channel_type", table_name="page_monitoring_notification_outbox")
    op.drop_index("ix_page_monitoring_notification_outbox_project_id", table_name="page_monitoring_notification_outbox")
    op.drop_index("ix_page_monitoring_notification_outbox_target_check_id", table_name="page_monitoring_notification_outbox")
    op.drop_index("ix_page_monitoring_notification_outbox_target_id", table_name="page_monitoring_notification_outbox")
    op.drop_index("ix_page_monitoring_notification_outbox_subscription_id", table_name="page_monitoring_notification_outbox")
    op.drop_table("page_monitoring_notification_outbox")

    op.drop_index("ix_page_monitoring_target_subscriptions_target_active", table_name="page_monitoring_target_subscriptions")
    op.drop_index("ix_page_monitoring_target_subscriptions_last_enqueued_at", table_name="page_monitoring_target_subscriptions")
    op.drop_index("ix_page_monitoring_target_subscriptions_is_active", table_name="page_monitoring_target_subscriptions")
    op.drop_index("ix_page_monitoring_target_subscriptions_channel_type", table_name="page_monitoring_target_subscriptions")
    op.drop_index("ix_page_monitoring_target_subscriptions_created_by_user_id", table_name="page_monitoring_target_subscriptions")
    op.drop_index("ix_page_monitoring_target_subscriptions_project_id", table_name="page_monitoring_target_subscriptions")
    op.drop_index("ix_page_monitoring_target_subscriptions_target_id", table_name="page_monitoring_target_subscriptions")
    op.drop_table("page_monitoring_target_subscriptions")
