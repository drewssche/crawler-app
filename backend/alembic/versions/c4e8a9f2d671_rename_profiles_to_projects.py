"""rename profiles to projects

Revision ID: c4e8a9f2d671
Revises: b2f8d9e4c6a1
Create Date: 2026-06-28
"""

from typing import Sequence, Union

from alembic import op


revision: str = "c4e8a9f2d671"
down_revision: Union[str, Sequence[str], None] = "b2f8d9e4c6a1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _rename_constraint(table: str, old: str, new: str) -> None:
    op.execute(
        f"""
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1
                FROM pg_constraint c
                JOIN pg_class t ON t.oid = c.conrelid
                WHERE t.relname = '{table}' AND c.conname = '{old}'
            ) THEN
                ALTER TABLE {table} RENAME CONSTRAINT {old} TO {new};
            END IF;
        END $$;
        """
    )


def _rename_index(old: str, new: str) -> None:
    op.execute(
        f"""
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM pg_class WHERE relkind = 'i' AND relname = '{old}') THEN
                ALTER INDEX {old} RENAME TO {new};
            END IF;
        END $$;
        """
    )


def upgrade() -> None:
    dialect = op.get_bind().dialect.name

    op.rename_table("profiles", "projects")
    op.alter_column("project_sites", "profile_id", new_column_name="project_id")
    op.alter_column("runs", "profile_id", new_column_name="project_id")

    if dialect == "postgresql":
        _rename_index("ix_profiles_name", "ix_projects_name")
        _rename_index("ix_project_sites_profile_id", "ix_project_sites_project_id")
        _rename_index("ix_runs_profile_id", "ix_runs_project_id")
        _rename_constraint("project_sites", "project_sites_profile_id_fkey", "project_sites_project_id_fkey")
        _rename_constraint("runs", "runs_profile_id_fkey", "runs_project_id_fkey")
        _rename_constraint("project_sites", "uq_project_sites_profile_scope", "uq_project_sites_project_scope")


def downgrade() -> None:
    dialect = op.get_bind().dialect.name

    if dialect == "postgresql":
        _rename_constraint("project_sites", "uq_project_sites_project_scope", "uq_project_sites_profile_scope")
        _rename_constraint("runs", "runs_project_id_fkey", "runs_profile_id_fkey")
        _rename_constraint("project_sites", "project_sites_project_id_fkey", "project_sites_profile_id_fkey")
        _rename_index("ix_runs_project_id", "ix_runs_profile_id")
        _rename_index("ix_project_sites_project_id", "ix_project_sites_profile_id")
        _rename_index("ix_projects_name", "ix_profiles_name")

    op.alter_column("runs", "project_id", new_column_name="profile_id")
    op.alter_column("project_sites", "project_id", new_column_name="profile_id")
    op.rename_table("projects", "profiles")
