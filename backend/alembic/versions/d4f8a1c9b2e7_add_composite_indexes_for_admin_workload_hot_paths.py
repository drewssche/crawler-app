"""add composite indexes for admin workload hot paths

Revision ID: d4f8a1c9b2e7
Revises: a3c1e8f4b7d2
Create Date: 2026-02-24 00:00:00.000000
"""

from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "d4f8a1c9b2e7"
down_revision: Union[str, Sequence[str], None] = "a3c1e8f4b7d2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_index(
        op.f("ix_login_history_user_created_id"),
        "login_history",
        ["user_id", "created_at", "id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_trusted_devices_user_revoked_last_used_created_id"),
        "trusted_devices",
        ["user_id", "revoked_at", "last_used_at", "created_at", "id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_admin_audit_logs_target_created_id"),
        "admin_audit_logs",
        ["target_user_id", "created_at", "id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_admin_audit_logs_target_created_id"), table_name="admin_audit_logs")
    op.drop_index(op.f("ix_trusted_devices_user_revoked_last_used_created_id"), table_name="trusted_devices")
    op.drop_index(op.f("ix_login_history_user_created_id"), table_name="login_history")
