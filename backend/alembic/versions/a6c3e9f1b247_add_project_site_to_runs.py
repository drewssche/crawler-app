"""add project site to runs

Revision ID: a6c3e9f1b247
Revises: 8f2b1c4d6e90
Create Date: 2026-06-24 00:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "a6c3e9f1b247"
down_revision: Union[str, Sequence[str], None] = "8f2b1c4d6e90"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("runs", sa.Column("project_site_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "fk_runs_project_site_id_project_sites",
        "runs",
        "project_sites",
        ["project_site_id"],
        ["id"],
    )
    op.create_index(op.f("ix_runs_project_site_id"), "runs", ["project_site_id"], unique=False)

    op.execute(
        sa.text(
            """
            UPDATE runs
            SET project_site_id = selected_site.id
            FROM (
                SELECT DISTINCT ON (profile_id) id, profile_id
                FROM project_sites
                ORDER BY profile_id, sort_order ASC, id ASC
            ) AS selected_site
            WHERE runs.profile_id = selected_site.profile_id
              AND runs.project_site_id IS NULL
            """
        )
    )

    connection = op.get_bind()
    missing = connection.execute(
        sa.text("SELECT COUNT(*) FROM runs WHERE project_site_id IS NULL")
    ).scalar_one()
    if missing:
        raise RuntimeError(f"Cannot backfill project_site_id for {missing} runs")

    op.alter_column("runs", "project_site_id", existing_type=sa.Integer(), nullable=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_runs_project_site_id"), table_name="runs")
    op.drop_constraint("fk_runs_project_site_id_project_sites", "runs", type_="foreignkey")
    op.drop_column("runs", "project_site_id")
