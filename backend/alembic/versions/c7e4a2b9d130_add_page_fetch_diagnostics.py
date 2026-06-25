"""add page fetch diagnostics

Revision ID: c7e4a2b9d130
Revises: a6c3e9f1b247
Create Date: 2026-06-25 00:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "c7e4a2b9d130"
down_revision: Union[str, Sequence[str], None] = "a6c3e9f1b247"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("pages", sa.Column("final_url", sa.Text(), nullable=True))
    op.add_column("pages", sa.Column("final_status_code", sa.Integer(), nullable=True))
    op.add_column("pages", sa.Column("redirect_chain_json", sa.JSON(), nullable=True))
    op.add_column("pages", sa.Column("fetch_error_code", sa.String(length=50), nullable=True))
    op.add_column("pages", sa.Column("fetch_error_message", sa.Text(), nullable=True))
    op.add_column("pages", sa.Column("response_time_ms", sa.Integer(), nullable=True))
    op.execute(
        sa.text(
            """
            UPDATE pages
            SET final_url = url,
                final_status_code = status_code
            WHERE final_url IS NULL
            """
        )
    )


def downgrade() -> None:
    op.drop_column("pages", "response_time_ms")
    op.drop_column("pages", "fetch_error_message")
    op.drop_column("pages", "fetch_error_code")
    op.drop_column("pages", "redirect_chain_json")
    op.drop_column("pages", "final_status_code")
    op.drop_column("pages", "final_url")
