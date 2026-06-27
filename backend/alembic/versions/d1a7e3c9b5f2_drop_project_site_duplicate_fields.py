"""drop duplicate site fields from projects

Revision ID: d1a7e3c9b5f2
Revises: c4e8a9f2d671
Create Date: 2026-06-28
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "d1a7e3c9b5f2"
down_revision: Union[str, Sequence[str], None] = "c4e8a9f2d671"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("projects") as batch_op:
        batch_op.drop_column("is_enabled")
        batch_op.drop_column("concurrency")
        batch_op.drop_column("max_pages")
        batch_op.drop_column("respect_robots")
        batch_op.drop_column("exclude_ext_csv")
        batch_op.drop_column("exclude_paths_csv")
        batch_op.drop_column("allowed_domains_csv")
        batch_op.drop_column("start_url")


def downgrade() -> None:
    with op.batch_alter_table("projects") as batch_op:
        batch_op.add_column(sa.Column("start_url", sa.Text(), nullable=False, server_default=""))
        batch_op.add_column(sa.Column("allowed_domains_csv", sa.Text(), nullable=False, server_default=""))
        batch_op.add_column(sa.Column("exclude_paths_csv", sa.Text(), nullable=False, server_default="/bitrix/,/upload/,/local/"))
        batch_op.add_column(sa.Column("exclude_ext_csv", sa.Text(), nullable=False, server_default=".css,.js,.png,.jpg,.jpeg,.webp,.svg,.woff,.woff2,.ttf,.eot,.map"))
        batch_op.add_column(sa.Column("respect_robots", sa.Boolean(), nullable=False, server_default=sa.text("true")))
        batch_op.add_column(sa.Column("max_pages", sa.Integer(), nullable=False, server_default="5000"))
        batch_op.add_column(sa.Column("concurrency", sa.Integer(), nullable=False, server_default="3"))
        batch_op.add_column(sa.Column("is_enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")))
