from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.exc import IntegrityError
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.api_response import success_response_payload
from app.core.security import require_permission
from app.db.models.project import Project
from app.db.models.crawl_persona import CrawlPersona
from app.db.models.project_site import ProjectSite
from app.db.models.run import Run
from app.db.models.user import User
from app.db.session import get_db
from app.schemas.project_site import ProjectSiteCreate, ProjectSiteOut, ProjectSiteUpdate
from app.services.crawl_personas import ensure_guest_persona
from app.services.project_sites import build_project_site
from app.services.site_anomalies import evaluate_project_site_anomalies

router = APIRouter(prefix="/projects/{project_id}/sites", tags=["project-sites"])


def _get_project_or_404(db: Session, project_id: int) -> Project:
    project = db.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


def _get_site_or_404(db: Session, project_id: int, site_id: int) -> ProjectSite:
    site = (
        db.query(ProjectSite)
        .filter(ProjectSite.id == site_id, ProjectSite.project_id == project_id)
        .first()
    )
    if not site:
        raise HTTPException(status_code=404, detail="Project site not found")
    return site


def _scope_conflict() -> HTTPException:
    return HTTPException(
        status_code=409,
        detail={
            "code": "project_site_scope_conflict",
            "message": "Сайт с такой областью сканирования уже добавлен в проект.",
        },
    )


@router.get("")
def list_project_sites(
    project_id: int,
    request: Request,
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_permission("data.view")),
):
    _get_project_or_404(db, project_id)
    rows = (
        db.query(ProjectSite)
        .filter(ProjectSite.project_id == project_id)
        .order_by(ProjectSite.sort_order.asc(), ProjectSite.id.asc())
        .all()
    )
    data = [ProjectSiteOut.model_validate(row).model_dump() for row in rows]
    return success_response_payload(request, data=data)


@router.get("/summary")
def list_project_sites_summary(
    project_id: int,
    request: Request,
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_permission("data.view")),
):
    _get_project_or_404(db, project_id)
    last_run_sq = (
        db.query(
            Run.project_site_id.label("project_site_id"),
            func.max(Run.id).label("last_run_id"),
        )
        .group_by(Run.project_site_id)
        .subquery()
    )
    runs_count_sq = (
        db.query(
            Run.project_site_id.label("project_site_id"),
            func.count(Run.id).label("runs_total"),
        )
        .group_by(Run.project_site_id)
        .subquery()
    )
    rows = (
        db.query(
            ProjectSite,
            Run.id.label("last_run_id"),
            Run.status.label("last_run_status"),
            Run.started_at.label("last_run_started_at"),
            Run.finished_at.label("last_run_finished_at"),
            Run.pages_total.label("last_run_pages_total"),
            Run.pages_changed.label("last_run_pages_changed"),
            Run.failure_code.label("last_run_failure_code"),
            Run.failure_message.label("last_run_failure_message"),
            CrawlPersona.id.label("last_run_persona_id"),
            CrawlPersona.key.label("last_run_persona_key"),
            CrawlPersona.label.label("last_run_persona_label"),
            CrawlPersona.kind.label("last_run_persona_kind"),
            func.coalesce(runs_count_sq.c.runs_total, 0).label("runs_total"),
        )
        .outerjoin(last_run_sq, last_run_sq.c.project_site_id == ProjectSite.id)
        .outerjoin(Run, Run.id == last_run_sq.c.last_run_id)
        .outerjoin(CrawlPersona, CrawlPersona.id == Run.crawl_persona_id)
        .outerjoin(runs_count_sq, runs_count_sq.c.project_site_id == ProjectSite.id)
        .filter(ProjectSite.project_id == project_id)
        .order_by(ProjectSite.sort_order.asc(), ProjectSite.id.asc())
        .all()
    )
    anomalies_by_site = evaluate_project_site_anomalies(
        db,
        [row.ProjectSite.id for row in rows],
    )
    default_personas = {
        persona.project_site_id: persona
        for persona in (
            db.query(CrawlPersona)
            .filter(
                CrawlPersona.project_site_id.in_([row.ProjectSite.id for row in rows]),
                CrawlPersona.is_default.is_(True),
            )
            .all()
        )
    }
    data = []
    for row in rows:
        default_persona = default_personas.get(row.ProjectSite.id)
        site_data = ProjectSiteOut.model_validate(row.ProjectSite).model_dump()
        site_data["runs_total"] = int(row.runs_total or 0)
        site_data["default_persona"] = (
            None
            if default_persona is None
            else {
                "id": default_persona.id,
                "key": default_persona.key,
                "label": default_persona.label,
                "kind": default_persona.kind,
                "has_secrets": default_persona.has_secrets,
            }
        )
        site_data["anomaly"] = anomalies_by_site.get(row.ProjectSite.id)
        site_data["last_run"] = (
            None
            if row.last_run_id is None
            else {
                "id": row.last_run_id,
                "status": row.last_run_status,
                "started_at": row.last_run_started_at,
                "finished_at": row.last_run_finished_at,
                "pages_total": int(row.last_run_pages_total or 0),
                "pages_changed": int(row.last_run_pages_changed or 0),
                "failure_code": row.last_run_failure_code,
                "failure_message": row.last_run_failure_message,
                "crawl_persona_id": row.last_run_persona_id,
                "persona": (
                    None
                    if row.last_run_persona_id is None
                    else {
                        "id": row.last_run_persona_id,
                        "key": row.last_run_persona_key,
                        "label": row.last_run_persona_label,
                        "kind": row.last_run_persona_kind,
                    }
                ),
            }
        )
        data.append(site_data)
    return success_response_payload(request, data=data)


@router.get("/{site_id}/anomaly")
def get_project_site_anomaly(
    project_id: int,
    site_id: int,
    request: Request,
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_permission("data.view")),
):
    _get_site_or_404(db, project_id, site_id)
    anomaly = evaluate_project_site_anomalies(db, [site_id])[site_id]
    return success_response_payload(request, data=anomaly)


@router.post("")
def create_project_site(
    project_id: int,
    payload: ProjectSiteCreate,
    request: Request,
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_permission("projects.edit")),
):
    _get_project_or_404(db, project_id)
    next_order = (
        db.query(ProjectSite)
        .filter(ProjectSite.project_id == project_id)
        .count()
    )
    try:
        site = build_project_site(
            project_id=project_id,
            name=payload.name,
            start_url=str(payload.start_url),
            scope_mode=payload.scope_mode,
            path_prefix=payload.path_prefix,
            role=payload.role,
            allowed_domains_csv=payload.allowed_domains_csv,
            exclude_paths_csv=payload.exclude_paths_csv,
            exclude_ext_csv=payload.exclude_ext_csv,
            respect_robots=payload.respect_robots,
            max_pages=payload.max_pages,
            concurrency=payload.concurrency,
            is_enabled=payload.is_enabled,
            sort_order=next_order,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    db.add(site)
    try:
        db.flush()
        ensure_guest_persona(db, site)
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise _scope_conflict() from exc
    db.refresh(site)
    return success_response_payload(
        request,
        data=ProjectSiteOut.model_validate(site).model_dump(),
    )


@router.patch("/{site_id}")
def update_project_site(
    project_id: int,
    site_id: int,
    payload: ProjectSiteUpdate,
    request: Request,
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_permission("projects.edit")),
):
    site = _get_site_or_404(db, project_id, site_id)
    changes = payload.model_dump(exclude_unset=True)
    nullable_fields = {
        key
        for key, value in changes.items()
        if value is None and key != "path_prefix"
    }
    if nullable_fields:
        raise HTTPException(
            status_code=422,
            detail=f"Fields cannot be null: {', '.join(sorted(nullable_fields))}",
        )
    start_url = str(changes.pop("start_url", site.start_url))
    scope_mode = changes.pop("scope_mode", site.scope_mode)
    path_prefix = changes.pop("path_prefix", site.path_prefix)
    if "path_prefix" in payload.model_fields_set and "start_url" not in payload.model_fields_set:
        start_url = site.canonical_origin
    if {"start_url", "scope_mode", "path_prefix"} & payload.model_fields_set:
        try:
            normalized = build_project_site(
                project_id=project_id,
                name=str(changes.get("name", site.name)),
                start_url=start_url,
                scope_mode=str(scope_mode),
                path_prefix=str(path_prefix) if path_prefix is not None else None,
                role=str(changes.get("role", site.role)),
                allowed_domains_csv=str(changes.get("allowed_domains_csv", site.allowed_domains_csv)),
                exclude_paths_csv=str(changes.get("exclude_paths_csv", site.exclude_paths_csv)),
                exclude_ext_csv=str(changes.get("exclude_ext_csv", site.exclude_ext_csv)),
                respect_robots=bool(changes.get("respect_robots", site.respect_robots)),
                max_pages=int(changes.get("max_pages", site.max_pages)),
                concurrency=int(changes.get("concurrency", site.concurrency)),
                is_enabled=bool(changes.get("is_enabled", site.is_enabled)),
                sort_order=site.sort_order,
            )
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        site.start_url = normalized.start_url
        site.canonical_origin = normalized.canonical_origin
        site.scope_mode = normalized.scope_mode
        site.path_prefix = normalized.path_prefix

    for key, value in changes.items():
        setattr(site, key, value)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise _scope_conflict() from exc
    db.refresh(site)
    return success_response_payload(
        request,
        data=ProjectSiteOut.model_validate(site).model_dump(),
    )


@router.delete("/{site_id}")
def delete_project_site(
    project_id: int,
    site_id: int,
    request: Request,
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_permission("projects.edit")),
):
    site = _get_site_or_404(db, project_id, site_id)
    runs_count = db.query(Run).filter(Run.project_site_id == site_id).count()
    if runs_count:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "project_site_has_runs",
                "message": "У сайта уже есть история запусков. Отключите сайт вместо удаления.",
                "runs_count": runs_count,
            },
        )
    site_count = db.query(ProjectSite).filter(ProjectSite.project_id == project_id).count()
    if site_count <= 1:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "project_requires_site",
                "message": "В проекте должен оставаться хотя бы один сайт.",
            },
        )
    db.query(CrawlPersona).filter(CrawlPersona.project_site_id == site_id).delete(synchronize_session=False)
    db.delete(site)
    db.commit()
    return success_response_payload(request, data={"deleted": True, "site_id": site_id})
