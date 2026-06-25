"""add page retry attempts

Revision ID: d8f5b3c0e241
Revises: c7e4a2b9d130
Create Date: 2026-06-25 00:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "d8f5b3c0e241"
down_revision: Union[str, Sequence[str], None] = "c7e4a2b9d130"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "page_retry_attempts",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("run_id", sa.Integer(), nullable=False),
        sa.Column("page_id", sa.Integer(), nullable=False),
        sa.Column("attempt_no", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=30), nullable=False),
        sa.Column("started_at", sa.DateTime(), nullable=False),
        sa.Column("finished_at", sa.DateTime(), nullable=False),
        sa.Column("status_code", sa.Integer(), nullable=True),
        sa.Column("final_url", sa.Text(), nullable=True),
        sa.Column("final_status_code", sa.Integer(), nullable=True),
        sa.Column("redirect_chain_json", sa.JSON(), nullable=True),
        sa.Column("fetch_error_code", sa.String(length=50), nullable=True),
        sa.Column("fetch_error_message", sa.Text(), nullable=True),
        sa.Column("response_time_ms", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(["page_id"], ["pages.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["run_id"], ["runs.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("page_id", "attempt_no", name="uq_page_retry_attempt_number"),
    )
    op.create_index(
        op.f("ix_page_retry_attempts_page_id"),
        "page_retry_attempts",
        ["page_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_page_retry_attempts_run_id"),
        "page_retry_attempts",
        ["run_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_page_retry_attempts_run_id"), table_name="page_retry_attempts")
    op.drop_index(op.f("ix_page_retry_attempts_page_id"), table_name="page_retry_attempts")
    op.drop_table("page_retry_attempts")
