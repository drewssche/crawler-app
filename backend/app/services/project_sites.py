from typing import cast

from sqlalchemy.orm import Session

from app.core.site_scope import ScopeMode, canonicalize_site_scope
from app.db.models.project import Project
from app.db.models.project_site import ProjectSite
from app.services.crawl_personas import ensure_guest_persona


def build_project_site(
    *,
    project_id: int,
    name: str,
    start_url: str,
    scope_mode: str,
    path_prefix: str | None,
    role: str,
    allowed_domains_csv: str,
    exclude_paths_csv: str,
    exclude_ext_csv: str,
    respect_robots: bool,
    max_pages: int,
    concurrency: int,
    is_enabled: bool,
    sort_order: int = 0,
) -> ProjectSite:
    scope = canonicalize_site_scope(
        start_url,
        scope_mode=cast(ScopeMode, scope_mode),
        path_prefix=path_prefix,
    )
    technical_domains = allowed_domains_csv.strip() or scope.hostname
    return ProjectSite(
        project_id=project_id,
        name=name.strip(),
        start_url=scope.start_url,
        canonical_origin=scope.canonical_origin,
        scope_mode=scope.scope_mode,
        path_prefix=scope.path_prefix,
        role=role,
        allowed_domains_csv=technical_domains,
        exclude_paths_csv=exclude_paths_csv,
        exclude_ext_csv=exclude_ext_csv,
        respect_robots=respect_robots,
        max_pages=max_pages,
        concurrency=concurrency,
        is_enabled=is_enabled,
        sort_order=sort_order,
    )


def create_primary_site_for_project(
    db: Session,
    project: Project,
    *,
    site_name: str | None = None,
    scope_mode: str = "whole_site",
    path_prefix: str | None = "/",
) -> ProjectSite:
    site = build_project_site(
        project_id=project.id,
        name=site_name or project.name,
        start_url=project.start_url,
        scope_mode=scope_mode,
        path_prefix=path_prefix,
        role="primary",
        allowed_domains_csv=project.allowed_domains_csv,
        exclude_paths_csv=project.exclude_paths_csv,
        exclude_ext_csv=project.exclude_ext_csv,
        respect_robots=project.respect_robots,
        max_pages=project.max_pages,
        concurrency=project.concurrency,
        is_enabled=project.is_enabled,
    )
    db.add(site)
    db.flush()
    ensure_guest_persona(db, site)
    return site
