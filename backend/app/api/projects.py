from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.security import require_permission
from app.core.api_response import success_response_payload
from app.core.paging import build_paged_response, paginate_query
from app.core.site_scope import canonicalize_site_scope
from app.db.session import get_db
from app.db.models.project import Project
from app.db.models.page import Page
from app.db.models.run import Run
from app.db.models.user import User
from app.db.models.crawl_persona import CrawlPersona
from app.schemas.project import ProjectCreate, ProjectOut
from app.db.models.project_site import ProjectSite
from app.services.project_sites import create_primary_site_for_project
from app.services.scan_retention import delete_rendered_snapshot_artifacts_for_project

router = APIRouter(prefix="/projects", tags=["projects"])


def _canonical_project_scope(start_url: str, allowed_domains_csv: str) -> tuple[str, tuple[str, ...]]:
    parsed = urlparse(str(start_url).strip())
    scheme = (parsed.scheme or "https").lower()
    host = (parsed.hostname or "").lower()
    path = parsed.path or "/"
    normalized_path = "/" if path == "/" else f"/{path.strip('/')}"
    normalized_start = f"{scheme}://{host}{normalized_path}"
    domains = tuple(sorted({part.strip().lower() for part in (allowed_domains_csv or "").split(",") if part.strip()}))
    if not domains and host:
        domains = (host,)
    return normalized_start, domains


def _project_out(project: Project, site: ProjectSite | None = None) -> dict:
    return {
        "id": project.id,
        "name": project.name,
        "start_url": site.start_url if site else "",
        "allowed_domains_csv": site.allowed_domains_csv if site else "",
    }


@router.get("")
def list_projects(
    page: int | None = None,
    page_size: int = 20,
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_permission("data.view")),
):
    query = db.query(Project).order_by(Project.id.desc())
    paged = paginate_query(query, page=page, page_size=page_size)
    if page is None:
        return paged
    items, total, safe_page, safe_page_size = paged
    return build_paged_response(items=items, total=total, page=safe_page, page_size=safe_page_size)


@router.post("", response_model=ProjectOut)
def create_project(
    payload: ProjectCreate,
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_permission("projects.edit")),
):
    try:
        primary_scope = canonicalize_site_scope(
            str(payload.start_url),
            scope_mode=payload.scope_mode,
            path_prefix=payload.path_prefix,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    requested_scope = _canonical_project_scope(primary_scope.start_url, payload.allowed_domains_csv)
    existing_sites = (
        db.query(Project, ProjectSite)
        .join(ProjectSite, ProjectSite.project_id == Project.id)
        .all()
    )
    for existing_project, existing_site in existing_sites:
        if _canonical_project_scope(existing_site.start_url, existing_site.allowed_domains_csv) == requested_scope:
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "project_scope_conflict",
                    "message": f'Проект для этого адреса уже существует: «{existing_project.name}».',
                    "existing_project": {
                        "id": existing_project.id,
                        "name": existing_project.name,
                        "start_url": existing_site.start_url,
                    },
                },
            )
    obj = Project(name=payload.name)
    db.add(obj)
    db.flush()
    try:
        site = create_primary_site_for_project(
            db,
            obj,
            start_url=primary_scope.start_url,
            site_name=payload.site_name,
            scope_mode=payload.scope_mode,
            path_prefix=payload.path_prefix,
            allowed_domains_csv=payload.allowed_domains_csv,
            exclude_paths_csv=payload.exclude_paths_csv,
            exclude_ext_csv=payload.exclude_ext_csv,
            respect_robots=payload.respect_robots,
            max_pages=payload.max_pages,
            concurrency=payload.concurrency,
            is_enabled=payload.is_enabled,
        )
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    db.commit()
    db.refresh(obj)
    db.refresh(site)
    return _project_out(obj, site)


@router.get("/summary")
def list_projects_summary(
    request: Request,
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_permission("data.view")),
):
    last_run_sq = (
        db.query(
            Run.project_id.label("project_id"),
            func.max(Run.id).label("last_run_id"),
        )
        .group_by(Run.project_id)
        .subquery()
    )
    runs_count_sq = (
        db.query(
            Run.project_id.label("project_id"),
            func.count(Run.id).label("runs_total"),
        )
        .group_by(Run.project_id)
        .subquery()
    )
    rows = (
        db.query(
            Project.id.label("id"),
            Project.name.label("name"),
            ProjectSite.start_url.label("start_url"),
            ProjectSite.allowed_domains_csv.label("allowed_domains_csv"),
            Run.id.label("last_run_id"),
            Run.status.label("last_run_status"),
            Run.crawl_runtime.label("last_run_crawl_runtime"),
            Run.started_at.label("last_run_started_at"),
            Run.finished_at.label("last_run_finished_at"),
            Run.pages_total.label("last_run_pages_total"),
            Run.pages_changed.label("last_run_pages_changed"),
            func.coalesce(runs_count_sq.c.runs_total, 0).label("runs_total"),
        )
        .outerjoin(ProjectSite, ProjectSite.project_id == Project.id)
        .outerjoin(last_run_sq, last_run_sq.c.project_id == Project.id)
        .outerjoin(Run, Run.id == last_run_sq.c.last_run_id)
        .outerjoin(runs_count_sq, runs_count_sq.c.project_id == Project.id)
        .order_by(Project.id.desc(), ProjectSite.sort_order.asc(), ProjectSite.id.asc())
        .all()
    )
    seen_projects: set[int] = set()
    data = [
        {
            "id": row.id,
            "name": row.name,
            "start_url": row.start_url,
            "allowed_domains_csv": row.allowed_domains_csv,
            "runs_total": int(row.runs_total or 0),
            "last_run": None
            if row.last_run_id is None
            else {
                "id": row.last_run_id,
                "status": row.last_run_status,
                "crawl_runtime": row.last_run_crawl_runtime,
                "started_at": row.last_run_started_at,
                "finished_at": row.last_run_finished_at,
                "pages_total": int(row.last_run_pages_total or 0),
                "pages_changed": int(row.last_run_pages_changed or 0),
            },
        }
        for row in rows
        if row.id not in seen_projects and not seen_projects.add(row.id)
    ]
    return success_response_payload(request, data=data)


@router.get("/{project_id}", response_model=ProjectOut)
def get_project(
    project_id: int,
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_permission("data.view")),
):
    obj = db.get(Project, project_id)
    if not obj:
        raise HTTPException(status_code=404, detail="Project not found")
    site = (
        db.query(ProjectSite)
        .filter(ProjectSite.project_id == project_id)
        .order_by(ProjectSite.sort_order.asc(), ProjectSite.id.asc())
        .first()
    )
    return _project_out(obj, site)


@router.delete("/{project_id}")
def delete_project(
    project_id: int,
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_permission("projects.edit")),
):
    obj = db.get(Project, project_id)
    if not obj:
        raise HTTPException(status_code=404, detail="Project not found")
    delete_rendered_snapshot_artifacts_for_project(db, project_id=project_id)
    run_ids = db.query(Run.id).filter(Run.project_id == project_id)
    db.query(Page).filter(Page.run_id.in_(run_ids)).delete(synchronize_session=False)
    db.query(Run).filter(Run.project_id == project_id).delete(synchronize_session=False)
    site_ids = db.query(ProjectSite.id).filter(ProjectSite.project_id == project_id)
    db.query(CrawlPersona).filter(CrawlPersona.project_site_id.in_(site_ids)).delete(synchronize_session=False)
    db.query(ProjectSite).filter(ProjectSite.project_id == project_id).delete(synchronize_session=False)
    db.delete(obj)
    db.commit()
    return {"ok": True}
