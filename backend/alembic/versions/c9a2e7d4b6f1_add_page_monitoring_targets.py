"""add page monitoring targets

Revision ID: c9a2e7d4b6f1
Revises: b7e2d4f9a8c1
Create Date: 2026-07-01
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "c9a2e7d4b6f1"
down_revision: Union[str, Sequence[str], None] = "b7e2d4f9a8c1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "page_monitoring_targets",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("project_id", sa.Integer(), nullable=False),
        sa.Column("project_site_id", sa.Integer(), nullable=True),
        sa.Column("run_id", sa.Integer(), nullable=False),
        sa.Column("page_id", sa.Integer(), nullable=False),
        sa.Column("crawl_persona_id", sa.Integer(), nullable=True),
        sa.Column("created_by_user_id", sa.Integer(), nullable=True),
        sa.Column("name", sa.String(length=240), nullable=False),
        sa.Column("page_url", sa.Text(), nullable=False),
        sa.Column("selector", sa.Text(), nullable=False),
        sa.Column("tag", sa.String(length=80), nullable=False),
        sa.Column("element_text", sa.Text(), nullable=False, server_default=""),
        sa.Column("element_html", sa.Text(), nullable=False, server_default=""),
        sa.Column("element_rect_json", sa.JSON(), nullable=True),
        sa.Column("fingerprint_hash", sa.String(length=64), nullable=False),
        sa.Column("fingerprint_json", sa.JSON(), nullable=True),
        sa.Column("source", sa.String(length=60), nullable=False, server_default="rendered_snapshot"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["crawl_persona_id"], ["crawl_personas.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["page_id"], ["pages.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["project_site_id"], ["project_sites.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["run_id"], ["runs.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_page_monitoring_targets_project_id", "page_monitoring_targets", ["project_id"])
    op.create_index("ix_page_monitoring_targets_project_site_id", "page_monitoring_targets", ["project_site_id"])
    op.create_index("ix_page_monitoring_targets_run_id", "page_monitoring_targets", ["run_id"])
    op.create_index("ix_page_monitoring_targets_page_id", "page_monitoring_targets", ["page_id"])
    op.create_index("ix_page_monitoring_targets_crawl_persona_id", "page_monitoring_targets", ["crawl_persona_id"])
    op.create_index("ix_page_monitoring_targets_created_by_user_id", "page_monitoring_targets", ["created_by_user_id"])
    op.create_index("ix_page_monitoring_targets_fingerprint_hash", "page_monitoring_targets", ["fingerprint_hash"])
    op.create_index("ix_page_monitoring_targets_is_active", "page_monitoring_targets", ["is_active"])
    op.create_index("ix_page_monitoring_targets_created_at", "page_monitoring_targets", ["created_at"])
    op.create_index("ix_page_monitoring_targets_project_active", "page_monitoring_targets", ["project_id", "is_active", "created_at"])
    op.alter_column("page_monitoring_targets", "element_text", server_default=None)
    op.alter_column("page_monitoring_targets", "element_html", server_default=None)
    op.alter_column("page_monitoring_targets", "source", server_default=None)
    op.alter_column("page_monitoring_targets", "is_active", server_default=None)
    op.alter_column("page_monitoring_targets", "created_at", server_default=None)
    op.alter_column("page_monitoring_targets", "updated_at", server_default=None)


def downgrade() -> None:
    op.drop_index("ix_page_monitoring_targets_project_active", table_name="page_monitoring_targets")
    op.drop_index("ix_page_monitoring_targets_created_at", table_name="page_monitoring_targets")
    op.drop_index("ix_page_monitoring_targets_is_active", table_name="page_monitoring_targets")
    op.drop_index("ix_page_monitoring_targets_fingerprint_hash", table_name="page_monitoring_targets")
    op.drop_index("ix_page_monitoring_targets_created_by_user_id", table_name="page_monitoring_targets")
    op.drop_index("ix_page_monitoring_targets_crawl_persona_id", table_name="page_monitoring_targets")
    op.drop_index("ix_page_monitoring_targets_page_id", table_name="page_monitoring_targets")
    op.drop_index("ix_page_monitoring_targets_run_id", table_name="page_monitoring_targets")
    op.drop_index("ix_page_monitoring_targets_project_site_id", table_name="page_monitoring_targets")
    op.drop_index("ix_page_monitoring_targets_project_id", table_name="page_monitoring_targets")
    op.drop_table("page_monitoring_targets")
