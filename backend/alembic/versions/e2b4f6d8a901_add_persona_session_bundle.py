"""add persona session bundle

Revision ID: e2b4f6d8a901
Revises: d1a7e3c9b5f2
Create Date: 2026-06-28
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "e2b4f6d8a901"
down_revision: Union[str, Sequence[str], None] = "d1a7e3c9b5f2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("crawl_personas") as batch_op:
        batch_op.add_column(sa.Column("encrypted_session_bundle", sa.Text(), nullable=True))
        batch_op.add_column(sa.Column("session_bundle_fingerprint", sa.String(length=64), nullable=True))
        batch_op.add_column(sa.Column("session_bundle_updated_at", sa.DateTime(), nullable=True))
        batch_op.add_column(sa.Column("session_bundle_expires_at", sa.DateTime(), nullable=True))
        batch_op.add_column(sa.Column("secret_version", sa.Integer(), nullable=False, server_default="1"))


def downgrade() -> None:
    with op.batch_alter_table("crawl_personas") as batch_op:
        batch_op.drop_column("secret_version")
        batch_op.drop_column("session_bundle_expires_at")
        batch_op.drop_column("session_bundle_updated_at")
        batch_op.drop_column("session_bundle_fingerprint")
        batch_op.drop_column("encrypted_session_bundle")
