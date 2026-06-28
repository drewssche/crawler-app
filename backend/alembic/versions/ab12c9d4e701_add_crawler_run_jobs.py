"""add crawler run jobs

Revision ID: ab12c9d4e701
Revises: 9a4f2c7d8b31
Create Date: 2026-06-28
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "ab12c9d4e701"
down_revision: Union[str, Sequence[str], None] = "9a4f2c7d8b31"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "crawler_run_jobs",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("project_id", sa.Integer(), nullable=False),
        sa.Column("project_site_id", sa.Integer(), nullable=False),
        sa.Column("crawl_persona_id", sa.Integer(), nullable=True),
        sa.Column("run_id", sa.Integer(), nullable=True),
        sa.Column("created_by_user_id", sa.Integer(), nullable=True),
        sa.Column("kind", sa.String(length=40), nullable=False, server_default="site_run"),
        sa.Column("status", sa.String(length=30), nullable=False, server_default="QUEUED"),
        sa.Column("lease_owner", sa.String(length=120), nullable=True),
        sa.Column("lease_expires_at", sa.DateTime(), nullable=True),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("max_attempts", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("scheduled_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("started_at", sa.DateTime(), nullable=True),
        sa.Column("finished_at", sa.DateTime(), nullable=True),
        sa.Column("heartbeat_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("failure_code", sa.String(length=80), nullable=True),
        sa.Column("failure_message", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["crawl_persona_id"], ["crawl_personas.id"]),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["project_site_id"], ["project_sites.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["run_id"], ["runs.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_crawler_run_jobs_project_id", "crawler_run_jobs", ["project_id"])
    op.create_index("ix_crawler_run_jobs_project_site_id", "crawler_run_jobs", ["project_site_id"])
    op.create_index("ix_crawler_run_jobs_crawl_persona_id", "crawler_run_jobs", ["crawl_persona_id"])
    op.create_index("ix_crawler_run_jobs_run_id", "crawler_run_jobs", ["run_id"])
    op.create_index("ix_crawler_run_jobs_created_by_user_id", "crawler_run_jobs", ["created_by_user_id"])
    op.create_index("ix_crawler_run_jobs_status", "crawler_run_jobs", ["status"])
    op.create_index("ix_crawler_run_jobs_lease_expires_at", "crawler_run_jobs", ["lease_expires_at"])
    op.create_index("ix_crawler_run_jobs_scheduled_at", "crawler_run_jobs", ["scheduled_at"])
    op.create_index("ix_crawler_run_jobs_heartbeat_at", "crawler_run_jobs", ["heartbeat_at"])
    op.create_index("ix_crawler_run_jobs_created_at", "crawler_run_jobs", ["created_at"])
    op.create_index(
        "ix_crawler_run_jobs_claim_order",
        "crawler_run_jobs",
        ["status", "scheduled_at", "id"],
    )
    op.alter_column("crawler_run_jobs", "kind", server_default=None)
    op.alter_column("crawler_run_jobs", "status", server_default=None)
    op.alter_column("crawler_run_jobs", "attempts", server_default=None)
    op.alter_column("crawler_run_jobs", "max_attempts", server_default=None)
    op.alter_column("crawler_run_jobs", "scheduled_at", server_default=None)
    op.alter_column("crawler_run_jobs", "created_at", server_default=None)
    op.alter_column("crawler_run_jobs", "updated_at", server_default=None)


def downgrade() -> None:
    op.drop_index("ix_crawler_run_jobs_claim_order", table_name="crawler_run_jobs")
    op.drop_index("ix_crawler_run_jobs_created_at", table_name="crawler_run_jobs")
    op.drop_index("ix_crawler_run_jobs_heartbeat_at", table_name="crawler_run_jobs")
    op.drop_index("ix_crawler_run_jobs_scheduled_at", table_name="crawler_run_jobs")
    op.drop_index("ix_crawler_run_jobs_lease_expires_at", table_name="crawler_run_jobs")
    op.drop_index("ix_crawler_run_jobs_status", table_name="crawler_run_jobs")
    op.drop_index("ix_crawler_run_jobs_created_by_user_id", table_name="crawler_run_jobs")
    op.drop_index("ix_crawler_run_jobs_run_id", table_name="crawler_run_jobs")
    op.drop_index("ix_crawler_run_jobs_crawl_persona_id", table_name="crawler_run_jobs")
    op.drop_index("ix_crawler_run_jobs_project_site_id", table_name="crawler_run_jobs")
    op.drop_index("ix_crawler_run_jobs_project_id", table_name="crawler_run_jobs")
    op.drop_table("crawler_run_jobs")
