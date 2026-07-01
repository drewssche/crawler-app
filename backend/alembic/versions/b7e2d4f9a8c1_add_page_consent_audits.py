"""add page consent audits

Revision ID: b7e2d4f9a8c1
Revises: aa47d2e9c301
Create Date: 2026-07-01
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "b7e2d4f9a8c1"
down_revision: Union[str, Sequence[str], None] = "aa47d2e9c301"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "page_consent_audits",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("project_id", sa.Integer(), nullable=False),
        sa.Column("project_site_id", sa.Integer(), nullable=True),
        sa.Column("run_id", sa.Integer(), nullable=False),
        sa.Column("page_id", sa.Integer(), nullable=False),
        sa.Column("crawl_persona_id", sa.Integer(), nullable=True),
        sa.Column("created_by_user_id", sa.Integer(), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="COMPLETED"),
        sa.Column("source", sa.String(length=80), nullable=False, server_default="stored_html_live_scripts"),
        sa.Column("result_json", sa.JSON(), nullable=True),
        sa.Column("error_code", sa.String(length=80), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("requested_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("started_at", sa.DateTime(), nullable=True),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["crawl_persona_id"], ["crawl_personas.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["page_id"], ["pages.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["project_site_id"], ["project_sites.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["run_id"], ["runs.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_page_consent_audits_project_id", "page_consent_audits", ["project_id"])
    op.create_index("ix_page_consent_audits_project_site_id", "page_consent_audits", ["project_site_id"])
    op.create_index("ix_page_consent_audits_run_id", "page_consent_audits", ["run_id"])
    op.create_index("ix_page_consent_audits_page_id", "page_consent_audits", ["page_id"])
    op.create_index("ix_page_consent_audits_crawl_persona_id", "page_consent_audits", ["crawl_persona_id"])
    op.create_index("ix_page_consent_audits_created_by_user_id", "page_consent_audits", ["created_by_user_id"])
    op.create_index("ix_page_consent_audits_status", "page_consent_audits", ["status"])
    op.create_index("ix_page_consent_audits_requested_at", "page_consent_audits", ["requested_at"])
    op.create_index("ix_page_consent_audits_page_recent", "page_consent_audits", ["page_id", "requested_at"])
    op.alter_column("page_consent_audits", "status", server_default=None)
    op.alter_column("page_consent_audits", "source", server_default=None)
    op.alter_column("page_consent_audits", "requested_at", server_default=None)


def downgrade() -> None:
    op.drop_index("ix_page_consent_audits_page_recent", table_name="page_consent_audits")
    op.drop_index("ix_page_consent_audits_requested_at", table_name="page_consent_audits")
    op.drop_index("ix_page_consent_audits_status", table_name="page_consent_audits")
    op.drop_index("ix_page_consent_audits_created_by_user_id", table_name="page_consent_audits")
    op.drop_index("ix_page_consent_audits_crawl_persona_id", table_name="page_consent_audits")
    op.drop_index("ix_page_consent_audits_page_id", table_name="page_consent_audits")
    op.drop_index("ix_page_consent_audits_run_id", table_name="page_consent_audits")
    op.drop_index("ix_page_consent_audits_project_site_id", table_name="page_consent_audits")
    op.drop_index("ix_page_consent_audits_project_id", table_name="page_consent_audits")
    op.drop_table("page_consent_audits")
