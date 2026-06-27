"""add persona login captures

Revision ID: f3a9c7d2e4b1
Revises: e2b4f6d8a901
Create Date: 2026-06-28
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "f3a9c7d2e4b1"
down_revision: Union[str, Sequence[str], None] = "e2b4f6d8a901"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "crawl_persona_login_captures",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("crawl_persona_id", sa.Integer(), nullable=False),
        sa.Column("project_site_id", sa.Integer(), nullable=False),
        sa.Column("created_by_user_id", sa.Integer(), nullable=True),
        sa.Column("status", sa.String(length=24), nullable=False),
        sa.Column("login_url", sa.String(length=2048), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
        sa.Column("cancelled_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["crawl_persona_id"], ["crawl_personas.id"]),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["project_site_id"], ["project_sites.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_crawl_persona_login_captures_crawl_persona_id", "crawl_persona_login_captures", ["crawl_persona_id"])
    op.create_index("ix_crawl_persona_login_captures_project_site_id", "crawl_persona_login_captures", ["project_site_id"])
    op.create_index("ix_crawl_persona_login_captures_created_by_user_id", "crawl_persona_login_captures", ["created_by_user_id"])
    op.create_index("ix_crawl_persona_login_captures_status", "crawl_persona_login_captures", ["status"])
    op.create_index("ix_crawl_persona_login_captures_expires_at", "crawl_persona_login_captures", ["expires_at"])
    op.create_index("ix_crawl_persona_login_captures_created_at", "crawl_persona_login_captures", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_crawl_persona_login_captures_created_at", table_name="crawl_persona_login_captures")
    op.drop_index("ix_crawl_persona_login_captures_expires_at", table_name="crawl_persona_login_captures")
    op.drop_index("ix_crawl_persona_login_captures_status", table_name="crawl_persona_login_captures")
    op.drop_index("ix_crawl_persona_login_captures_created_by_user_id", table_name="crawl_persona_login_captures")
    op.drop_index("ix_crawl_persona_login_captures_project_site_id", table_name="crawl_persona_login_captures")
    op.drop_index("ix_crawl_persona_login_captures_crawl_persona_id", table_name="crawl_persona_login_captures")
    op.drop_table("crawl_persona_login_captures")
