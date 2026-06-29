"""add project memberships

Revision ID: f6a1d3c8e902
Revises: ab12c9d4e701
Create Date: 2026-06-29
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "f6a1d3c8e902"
down_revision: Union[str, Sequence[str], None] = "ab12c9d4e701"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "project_memberships",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("project_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("role", sa.String(length=30), nullable=False, server_default="viewer"),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("project_id", "user_id", name="uq_project_memberships_project_user"),
    )
    op.create_index("ix_project_memberships_project_id", "project_memberships", ["project_id"])
    op.create_index("ix_project_memberships_user_id", "project_memberships", ["user_id"])
    op.create_index(
        "ix_project_memberships_user_project",
        "project_memberships",
        ["user_id", "project_id"],
    )
    op.alter_column("project_memberships", "role", server_default=None)
    op.alter_column("project_memberships", "created_at", server_default=None)

    bind = op.get_bind()
    owner_user_id = bind.execute(
        sa.text(
            """
            SELECT id
            FROM users
            WHERE is_deleted IS FALSE
              AND is_blocked IS FALSE
              AND is_approved IS TRUE
              AND (role IN ('admin', 'root-admin') OR is_admin IS TRUE)
            ORDER BY id ASC
            LIMIT 1
            """
        )
    ).scalar()
    if owner_user_id is not None:
        bind.execute(
            sa.text(
                """
                INSERT INTO project_memberships (project_id, user_id, role, created_at)
                SELECT p.id, :owner_user_id, 'owner', NOW()
                FROM projects p
                WHERE NOT EXISTS (
                    SELECT 1
                    FROM project_memberships pm
                    WHERE pm.project_id = p.id AND pm.user_id = :owner_user_id
                )
                """
            ),
            {"owner_user_id": owner_user_id},
        )


def downgrade() -> None:
    op.drop_index("ix_project_memberships_user_project", table_name="project_memberships")
    op.drop_index("ix_project_memberships_user_id", table_name="project_memberships")
    op.drop_index("ix_project_memberships_project_id", table_name="project_memberships")
    op.drop_table("project_memberships")
