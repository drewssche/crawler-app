"""add project schedules

Revision ID: aa47d2e9c301
Revises: f6a1d3c8e902
Create Date: 2026-06-30
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "aa47d2e9c301"
down_revision: Union[str, Sequence[str], None] = "f6a1d3c8e902"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "project_schedules",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("project_id", sa.Integer(), nullable=False),
        sa.Column("created_by_user_id", sa.Integer(), nullable=True),
        sa.Column("updated_by_user_id", sa.Integer(), nullable=True),
        sa.Column("is_enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("frequency", sa.String(length=20), nullable=False, server_default="daily"),
        sa.Column("time_of_day", sa.String(length=5), nullable=False, server_default="09:00"),
        sa.Column("weekdays_csv", sa.String(length=20), nullable=False, server_default=""),
        sa.Column("timezone", sa.String(length=80), nullable=False, server_default="UTC"),
        sa.Column("next_run_at", sa.DateTime(), nullable=True),
        sa.Column("last_run_at", sa.DateTime(), nullable=True),
        sa.Column("paused_at", sa.DateTime(), nullable=True),
        sa.Column("last_skip_reason", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["updated_by_user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("project_id", name="uq_project_schedules_project_id"),
    )
    op.create_index("ix_project_schedules_project_id", "project_schedules", ["project_id"])
    op.create_index("ix_project_schedules_created_by_user_id", "project_schedules", ["created_by_user_id"])
    op.create_index("ix_project_schedules_updated_by_user_id", "project_schedules", ["updated_by_user_id"])
    op.create_index("ix_project_schedules_is_enabled", "project_schedules", ["is_enabled"])
    op.create_index("ix_project_schedules_next_run_at", "project_schedules", ["next_run_at"])
    op.create_index("ix_project_schedules_due", "project_schedules", ["is_enabled", "next_run_at", "id"])
    op.alter_column("project_schedules", "is_enabled", server_default=None)
    op.alter_column("project_schedules", "frequency", server_default=None)
    op.alter_column("project_schedules", "time_of_day", server_default=None)
    op.alter_column("project_schedules", "weekdays_csv", server_default=None)
    op.alter_column("project_schedules", "timezone", server_default=None)
    op.alter_column("project_schedules", "created_at", server_default=None)
    op.alter_column("project_schedules", "updated_at", server_default=None)


def downgrade() -> None:
    op.drop_index("ix_project_schedules_due", table_name="project_schedules")
    op.drop_index("ix_project_schedules_next_run_at", table_name="project_schedules")
    op.drop_index("ix_project_schedules_is_enabled", table_name="project_schedules")
    op.drop_index("ix_project_schedules_updated_by_user_id", table_name="project_schedules")
    op.drop_index("ix_project_schedules_created_by_user_id", table_name="project_schedules")
    op.drop_index("ix_project_schedules_project_id", table_name="project_schedules")
    op.drop_table("project_schedules")
