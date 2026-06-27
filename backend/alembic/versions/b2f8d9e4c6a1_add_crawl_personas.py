"""add crawl personas

Revision ID: b2f8d9e4c6a1
Revises: f0b7d5e2a463
Create Date: 2026-06-27 00:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "b2f8d9e4c6a1"
down_revision: Union[str, Sequence[str], None] = "f0b7d5e2a463"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "crawl_personas",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("project_site_id", sa.Integer(), nullable=False),
        sa.Column("key", sa.String(length=80), nullable=False),
        sa.Column("label", sa.String(length=160), nullable=False),
        sa.Column("kind", sa.String(length=40), nullable=False, server_default="guest"),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("is_default", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("is_enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("has_secrets", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["project_site_id"], ["project_sites.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("project_site_id", "key", name="uq_crawl_personas_site_key"),
    )
    op.create_index(op.f("ix_crawl_personas_project_site_id"), "crawl_personas", ["project_site_id"], unique=False)

    op.execute(
        sa.text(
            """
            INSERT INTO crawl_personas (
                project_site_id, key, label, kind, description,
                is_default, is_enabled, has_secrets, created_at
            )
            SELECT
                id,
                'guest',
                'Гость',
                'guest',
                'Неавторизованный посетитель без cookies/session secrets.',
                TRUE,
                TRUE,
                FALSE,
                CURRENT_TIMESTAMP
            FROM project_sites
            """
        )
    )

    op.add_column("runs", sa.Column("crawl_persona_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "fk_runs_crawl_persona_id_crawl_personas",
        "runs",
        "crawl_personas",
        ["crawl_persona_id"],
        ["id"],
    )
    op.create_index(op.f("ix_runs_crawl_persona_id"), "runs", ["crawl_persona_id"], unique=False)
    op.execute(
        sa.text(
            """
            UPDATE runs
            SET crawl_persona_id = (
                SELECT guest_persona.id
                FROM crawl_personas AS guest_persona
                WHERE guest_persona.project_site_id = runs.project_site_id
                  AND guest_persona.key = 'guest'
                LIMIT 1
            )
            WHERE runs.crawl_persona_id IS NULL
            """
        )
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_runs_crawl_persona_id"), table_name="runs")
    op.drop_constraint("fk_runs_crawl_persona_id_crawl_personas", "runs", type_="foreignkey")
    op.drop_column("runs", "crawl_persona_id")
    op.drop_index(op.f("ix_crawl_personas_project_site_id"), table_name="crawl_personas")
    op.drop_table("crawl_personas")
