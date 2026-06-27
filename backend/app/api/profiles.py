from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.security import require_permission
from app.core.api_response import success_response_payload
from app.core.paging import build_paged_response, paginate_query
from app.core.site_scope import canonicalize_site_scope
from app.db.session import get_db
from app.db.models.profile import Profile
from app.db.models.page import Page
from app.db.models.run import Run
from app.db.models.user import User
from app.db.models.crawl_persona import CrawlPersona
from app.schemas.profile import ProfileOut, ProjectCreate
from app.db.models.project_site import ProjectSite
from app.services.project_sites import create_primary_site_for_profile

router = APIRouter(prefix="/profiles", tags=["profiles"])


def _canonical_profile_scope(start_url: str, allowed_domains_csv: str) -> tuple[str, tuple[str, ...]]:
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


@router.get("")
def list_profiles(
    page: int | None = None,
    page_size: int = 20,
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_permission("data.view")),
):
    query = db.query(Profile).order_by(Profile.id.desc())
    paged = paginate_query(query, page=page, page_size=page_size)
    if page is None:
        return paged
    items, total, safe_page, safe_page_size = paged
    return build_paged_response(items=items, total=total, page=safe_page, page_size=safe_page_size)


@router.post("", response_model=ProfileOut)
def create_profile(
    payload: ProjectCreate,
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_permission("profiles.edit")),
):
    try:
        primary_scope = canonicalize_site_scope(
            str(payload.start_url),
            scope_mode=payload.scope_mode,
            path_prefix=payload.path_prefix,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    requested_scope = _canonical_profile_scope(primary_scope.start_url, payload.allowed_domains_csv)
    for existing in db.query(Profile).all():
        if _canonical_profile_scope(existing.start_url, existing.allowed_domains_csv) == requested_scope:
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "profile_scope_conflict",
                    "message": f'Проект для этого адреса уже существует: «{existing.name}».',
                    "existing_project": {
                        "id": existing.id,
                        "name": existing.name,
                        "start_url": existing.start_url,
                    },
                },
            )
    profile_data = payload.model_dump(
        mode="json",
        exclude={"site_name", "scope_mode", "path_prefix"},
    )
    profile_data["start_url"] = primary_scope.start_url
    obj = Profile(**profile_data)
    db.add(obj)
    db.flush()
    try:
        create_primary_site_for_profile(
            db,
            obj,
            site_name=payload.site_name,
            scope_mode=payload.scope_mode,
            path_prefix=payload.path_prefix,
        )
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    db.commit()
    db.refresh(obj)
    return obj


@router.get("/summary")
def list_profiles_summary(
    request: Request,
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_permission("data.view")),
):
    last_run_sq = (
        db.query(
            Run.profile_id.label("profile_id"),
            func.max(Run.id).label("last_run_id"),
        )
        .group_by(Run.profile_id)
        .subquery()
    )
    runs_count_sq = (
        db.query(
            Run.profile_id.label("profile_id"),
            func.count(Run.id).label("runs_total"),
        )
        .group_by(Run.profile_id)
        .subquery()
    )
    rows = (
        db.query(
            Profile.id.label("id"),
            Profile.name.label("name"),
            Profile.start_url.label("start_url"),
            Profile.allowed_domains_csv.label("allowed_domains_csv"),
            Run.id.label("last_run_id"),
            Run.status.label("last_run_status"),
            Run.started_at.label("last_run_started_at"),
            Run.finished_at.label("last_run_finished_at"),
            Run.pages_total.label("last_run_pages_total"),
            Run.pages_changed.label("last_run_pages_changed"),
            func.coalesce(runs_count_sq.c.runs_total, 0).label("runs_total"),
        )
        .outerjoin(last_run_sq, last_run_sq.c.profile_id == Profile.id)
        .outerjoin(Run, Run.id == last_run_sq.c.last_run_id)
        .outerjoin(runs_count_sq, runs_count_sq.c.profile_id == Profile.id)
        .order_by(Profile.id.desc())
        .all()
    )
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
                "started_at": row.last_run_started_at,
                "finished_at": row.last_run_finished_at,
                "pages_total": int(row.last_run_pages_total or 0),
                "pages_changed": int(row.last_run_pages_changed or 0),
            },
        }
        for row in rows
    ]
    return success_response_payload(request, data=data)


@router.get("/{profile_id}", response_model=ProfileOut)
def get_profile(
    profile_id: int,
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_permission("data.view")),
):
    obj = db.get(Profile, profile_id)
    if not obj:
        raise HTTPException(status_code=404, detail="Profile not found")
    return obj


@router.delete("/{profile_id}")
def delete_profile(
    profile_id: int,
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_permission("profiles.edit")),
):
    obj = db.get(Profile, profile_id)
    if not obj:
        raise HTTPException(status_code=404, detail="Profile not found")
    run_ids = db.query(Run.id).filter(Run.profile_id == profile_id)
    db.query(Page).filter(Page.run_id.in_(run_ids)).delete(synchronize_session=False)
    db.query(Run).filter(Run.profile_id == profile_id).delete(synchronize_session=False)
    site_ids = db.query(ProjectSite.id).filter(ProjectSite.profile_id == profile_id)
    db.query(CrawlPersona).filter(CrawlPersona.project_site_id.in_(site_ids)).delete(synchronize_session=False)
    db.query(ProjectSite).filter(ProjectSite.profile_id == profile_id).delete(synchronize_session=False)
    db.delete(obj)
    db.commit()
    return {"ok": True}
