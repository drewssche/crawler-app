"""add page monitoring target checks

Revision ID: d6f4b9e2a731
Revises: c9a2e7d4b6f1
Create Date: 2026-07-01
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "d6f4b9e2a731"
down_revision: Union[str, Sequence[str], None] = "c9a2e7d4b6f1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "page_monitoring_target_checks",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("target_id", sa.Integer(), nullable=False),
        sa.Column("project_id", sa.Integer(), nullable=False),
        sa.Column("project_site_id", sa.Integer(), nullable=True),
        sa.Column("run_id", sa.Integer(), nullable=False),
        sa.Column("page_id", sa.Integer(), nullable=True),
        sa.Column("status", sa.String(length=30), nullable=False),
        sa.Column("message", sa.Text(), nullable=False, server_default=""),
        sa.Column("result_json", sa.JSON(), nullable=True),
        sa.Column("checked_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["page_id"], ["pages.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["project_site_id"], ["project_sites.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["run_id"], ["runs.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["target_id"], ["page_monitoring_targets.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_page_monitoring_target_checks_target_id", "page_monitoring_target_checks", ["target_id"])
    op.create_index("ix_page_monitoring_target_checks_project_id", "page_monitoring_target_checks", ["project_id"])
    op.create_index("ix_page_monitoring_target_checks_project_site_id", "page_monitoring_target_checks", ["project_site_id"])
    op.create_index("ix_page_monitoring_target_checks_run_id", "page_monitoring_target_checks", ["run_id"])
    op.create_index("ix_page_monitoring_target_checks_page_id", "page_monitoring_target_checks", ["page_id"])
    op.create_index("ix_page_monitoring_target_checks_status", "page_monitoring_target_checks", ["status"])
    op.create_index("ix_page_monitoring_target_checks_checked_at", "page_monitoring_target_checks", ["checked_at"])
    op.create_index("ix_page_monitoring_target_checks_target_recent", "page_monitoring_target_checks", ["target_id", "checked_at"])
    op.alter_column("page_monitoring_target_checks", "message", server_default=None)
    op.alter_column("page_monitoring_target_checks", "checked_at", server_default=None)


def downgrade() -> None:
    op.drop_index("ix_page_monitoring_target_checks_target_recent", table_name="page_monitoring_target_checks")
    op.drop_index("ix_page_monitoring_target_checks_checked_at", table_name="page_monitoring_target_checks")
    op.drop_index("ix_page_monitoring_target_checks_status", table_name="page_monitoring_target_checks")
    op.drop_index("ix_page_monitoring_target_checks_page_id", table_name="page_monitoring_target_checks")
    op.drop_index("ix_page_monitoring_target_checks_run_id", table_name="page_monitoring_target_checks")
    op.drop_index("ix_page_monitoring_target_checks_project_site_id", table_name="page_monitoring_target_checks")
    op.drop_index("ix_page_monitoring_target_checks_project_id", table_name="page_monitoring_target_checks")
    op.drop_index("ix_page_monitoring_target_checks_target_id", table_name="page_monitoring_target_checks")
    op.drop_table("page_monitoring_target_checks")
