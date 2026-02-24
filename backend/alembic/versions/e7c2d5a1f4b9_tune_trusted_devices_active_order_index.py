"""tune trusted_devices active-order index

Revision ID: e7c2d5a1f4b9
Revises: d4f8a1c9b2e7
Create Date: 2026-02-24 00:00:00.000000
"""

from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "e7c2d5a1f4b9"
down_revision: Union[str, Sequence[str], None] = "d4f8a1c9b2e7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Replace broad mixed-order index with a partial ordered index matching active-device hot path.
    op.execute("DROP INDEX IF EXISTS ix_trusted_devices_user_revoked_last_used_created_id")
    op.execute("DROP INDEX IF EXISTS ix_trusted_devices_active_user_last_used_desc_created_desc_id_d")
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_td_active_user_lu_ca_id_desc "
        "ON trusted_devices (user_id, last_used_at DESC, created_at DESC, id DESC) "
        "WHERE revoked_at IS NULL"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_td_active_user_lu_ca_id_desc")
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_trusted_devices_user_revoked_last_used_created_id "
        "ON trusted_devices (user_id, revoked_at, last_used_at, created_at, id)"
    )
