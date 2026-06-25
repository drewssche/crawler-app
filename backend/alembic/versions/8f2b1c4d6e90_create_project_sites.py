"""create project sites

Revision ID: 8f2b1c4d6e90
Revises: 4a7d9c2e1f30
Create Date: 2026-06-24 00:00:00.000000
"""

from typing import Sequence, Union
from urllib.parse import urlparse, urlunparse

import sqlalchemy as sa
from alembic import op


revision: str = "8f2b1c4d6e90"
down_revision: Union[str, Sequence[str], None] = "4a7d9c2e1f30"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _canonical_site(start_url: str) -> tuple[str, str, str]:
    parsed = urlparse(str(start_url).strip())
    scheme = parsed.scheme.lower()
    hostname = (parsed.hostname or "").lower().rstrip(".")
    if scheme not in {"http", "https"} or not hostname:
        raise ValueError(f"Invalid profile start_url: {start_url!r}")
    port = parsed.port
    default_port = (scheme == "http" and port == 80) or (scheme == "https" and port == 443)
    netloc = hostname if port is None or default_port else f"{hostname}:{port}"
    path_parts = [part for part in (parsed.path or "/").split("/") if part]
    path = "/" if not path_parts else f"/{'/'.join(path_parts)}"
    return urlunparse((scheme, netloc, path, "", "", "")), f"{scheme}://{netloc}", hostname


def upgrade() -> None:
    project_sites = op.create_table(
        "project_sites",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("profile_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("start_url", sa.Text(), nullable=False),
        sa.Column("canonical_origin", sa.String(length=500), nullable=False),
        sa.Column("scope_mode", sa.String(length=30), nullable=False),
        sa.Column("path_prefix", sa.String(length=1000), nullable=False),
        sa.Column("role", sa.String(length=30), nullable=False),
        sa.Column("allowed_domains_csv", sa.Text(), nullable=False),
        sa.Column("exclude_paths_csv", sa.Text(), nullable=False),
        sa.Column("exclude_ext_csv", sa.Text(), nullable=False),
        sa.Column("respect_robots", sa.Boolean(), nullable=False),
        sa.Column("max_pages", sa.Integer(), nullable=False),
        sa.Column("concurrency", sa.Integer(), nullable=False),
        sa.Column("is_enabled", sa.Boolean(), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["profile_id"], ["profiles.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "profile_id",
            "canonical_origin",
            "path_prefix",
            name="uq_project_sites_profile_scope",
        ),
    )
    op.create_index(op.f("ix_project_sites_profile_id"), "project_sites", ["profile_id"], unique=False)

    connection = op.get_bind()
    profiles = connection.execute(
        sa.text(
            """
            SELECT id, name, start_url, allowed_domains_csv, exclude_paths_csv,
                   exclude_ext_csv, respect_robots, max_pages, concurrency, is_enabled
            FROM profiles
            ORDER BY id
            """
        )
    ).mappings()
    rows = []
    for profile in profiles:
        start_url, origin, hostname = _canonical_site(profile["start_url"])
        rows.append(
            {
                "profile_id": profile["id"],
                "name": profile["name"],
                "start_url": start_url,
                "canonical_origin": origin,
                "scope_mode": "whole_site",
                "path_prefix": "/",
                "role": "primary",
                "allowed_domains_csv": (profile["allowed_domains_csv"] or "").strip() or hostname,
                "exclude_paths_csv": profile["exclude_paths_csv"] or "",
                "exclude_ext_csv": profile["exclude_ext_csv"] or "",
                "respect_robots": bool(profile["respect_robots"]),
                "max_pages": profile["max_pages"] or 5000,
                "concurrency": profile["concurrency"] or 3,
                "is_enabled": bool(profile["is_enabled"]),
                "sort_order": 0,
            }
        )
    if rows:
        op.bulk_insert(project_sites, rows)


def downgrade() -> None:
    op.drop_index(op.f("ix_project_sites_profile_id"), table_name="project_sites")
    op.drop_table("project_sites")
