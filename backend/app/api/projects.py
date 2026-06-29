from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.security import get_user_role, require_permission
from app.core.api_response import success_response_payload
from app.core.paging import build_paged_response, paginate_query
from app.core.site_scope import canonicalize_site_scope
from app.db.session import get_db
from app.db.models.project import Project
from app.db.models.page import Page
from app.db.models.run import Run
from app.db.models.user import User
from app.db.models.crawl_persona import CrawlPersona
from app.db.models.project_membership import ProjectMembership
from app.schemas.project import ProjectCreate, ProjectOut
from app.db.models.project_site import ProjectSite
from app.services.project_sites import create_primary_site_for_project
from app.services.project_memberships import (
    ensure_project_owner,
    ensure_can_change_owner_membership,
    normalize_membership_role,
    require_project_read,
    require_project_owner,
    require_project_write,
    visible_projects_query,
)
from app.services.project_quotas import enforce_project_create_quota, enforce_site_settings_quota
from app.services.scan_retention import delete_rendered_snapshot_artifacts_for_project

router = APIRouter(prefix="/projects", tags=["projects"])


class ProjectMemberPayload(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    role: str = "viewer"


class ProjectMemberRolePayload(BaseModel):
    role: str


def _project_out(project: Project, site: ProjectSite | None = None) -> dict:
    return {
        "id": project.id,
        "name": project.name,
        "start_url": site.start_url if site else "",
        "allowed_domains_csv": site.allowed_domains_csv if site else "",
    }


def _member_out(membership: ProjectMembership, user: User, current_user: User) -> dict:
    return {
        "id": membership.id,
        "project_id": membership.project_id,
        "user_id": user.id,
        "email": user.email,
        "user_role": get_user_role(user),
        "role": membership.role,
        "created_at": membership.created_at,
        "is_current_user": user.id == current_user.id,
        "is_approved": bool(user.is_approved),
        "is_blocked": bool(user.is_blocked),
    }


def _find_active_user_by_email(db: Session, email: str) -> User:
    normalized_email = email.strip().lower()
    user = (
        db.query(User)
        .filter(func.lower(User.email) == normalized_email, User.is_deleted.is_(False))
        .first()
    )
    if not user:
        raise HTTPException(
            status_code=404,
            detail={
                "code": "user_not_found",
                "message": "Пользователь с таким email не найден.",
            },
        )
    return user


@router.get("")
def list_projects(
    page: int | None = None,
    page_size: int = 20,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("data.view")),
):
    query = visible_projects_query(db, current_user).order_by(Project.id.desc())
    paged = paginate_query(query, page=page, page_size=page_size)
    if page is None:
        return paged
    items, total, safe_page, safe_page_size = paged
    return build_paged_response(items=items, total=total, page=safe_page, page_size=safe_page_size)


@router.post("", response_model=ProjectOut)
def create_project(
    payload: ProjectCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("projects.edit")),
):
    role = get_user_role(current_user)
    enforce_project_create_quota(db, role=role)
    enforce_site_settings_quota(role=role, max_pages=payload.max_pages, concurrency=payload.concurrency)
    try:
        primary_scope = canonicalize_site_scope(
            str(payload.start_url),
            scope_mode=payload.scope_mode,
            path_prefix=payload.path_prefix,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
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
    ensure_project_owner(db, project_id=obj.id, user_id=current_user.id)
    db.commit()
    db.refresh(obj)
    db.refresh(site)
    return _project_out(obj, site)


@router.get("/summary")
def list_projects_summary(
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("data.view")),
):
    visible_project_ids = visible_projects_query(db, current_user).with_entities(Project.id).subquery()
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
            ProjectSite.id.label("site_id"),
            ProjectSite.name.label("site_name"),
            ProjectSite.start_url.label("start_url"),
            ProjectSite.allowed_domains_csv.label("allowed_domains_csv"),
            ProjectSite.scope_mode.label("site_scope_mode"),
            ProjectSite.path_prefix.label("site_path_prefix"),
            ProjectSite.role.label("site_role"),
            ProjectSite.is_enabled.label("site_is_enabled"),
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
        .filter(Project.id.in_(db.query(visible_project_ids.c.id)))
        .order_by(Project.id.desc(), ProjectSite.sort_order.asc(), ProjectSite.id.asc())
        .all()
    )
    project_items: dict[int, dict] = {}
    data: list[dict] = []
    for row in rows:
        item = project_items.get(row.id)
        if item is None:
            item = {
                "id": row.id,
                "name": row.name,
                # Compatibility fields for older clients. New UI should use sites[].
                "start_url": row.start_url,
                "allowed_domains_csv": row.allowed_domains_csv,
                "sites": [],
                "site_count": 0,
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
            project_items[row.id] = item
            data.append(item)
        if row.site_id is not None:
            item["sites"].append(
                {
                    "id": row.site_id,
                    "name": row.site_name,
                    "start_url": row.start_url,
                    "scope_mode": row.site_scope_mode,
                    "path_prefix": row.site_path_prefix,
                    "role": row.site_role,
                    "is_enabled": bool(row.site_is_enabled),
                }
            )
            item["site_count"] = len(item["sites"])
    return success_response_payload(request, data=data)


@router.get("/{project_id}", response_model=ProjectOut)
def get_project(
    project_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("data.view")),
):
    obj = db.get(Project, project_id)
    if not obj:
        raise HTTPException(status_code=404, detail="Project not found")
    require_project_read(db, project_id=project_id, user=current_user)
    site = (
        db.query(ProjectSite)
        .filter(ProjectSite.project_id == project_id)
        .order_by(ProjectSite.sort_order.asc(), ProjectSite.id.asc())
        .first()
    )
    return _project_out(obj, site)


@router.get("/{project_id}/members")
def list_project_members(
    project_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("data.view")),
):
    obj = db.get(Project, project_id)
    if not obj:
        raise HTTPException(status_code=404, detail="Project not found")
    require_project_read(db, project_id=project_id, user=current_user)
    rows = (
        db.query(ProjectMembership, User)
        .join(User, User.id == ProjectMembership.user_id)
        .filter(ProjectMembership.project_id == project_id, User.is_deleted.is_(False))
        .order_by(
            ProjectMembership.role.asc(),
            User.email.asc(),
            ProjectMembership.id.asc(),
        )
        .all()
    )
    return [_member_out(membership, user, current_user) for membership, user in rows]


@router.post("/{project_id}/members")
def add_project_member(
    project_id: int,
    payload: ProjectMemberPayload,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("projects.edit")),
):
    obj = db.get(Project, project_id)
    if not obj:
        raise HTTPException(status_code=404, detail="Project not found")
    require_project_owner(db, project_id=project_id, user=current_user)
    role = normalize_membership_role(payload.role)
    user = _find_active_user_by_email(db, payload.email)
    membership = (
        db.query(ProjectMembership)
        .filter(ProjectMembership.project_id == project_id, ProjectMembership.user_id == user.id)
        .first()
    )
    if membership is None:
        membership = ProjectMembership(project_id=project_id, user_id=user.id, role=role)
        db.add(membership)
    else:
        ensure_can_change_owner_membership(db, membership=membership, next_role=role)
        membership.role = role
    db.commit()
    db.refresh(membership)
    return _member_out(membership, user, current_user)


@router.patch("/{project_id}/members/{membership_id}")
def update_project_member(
    project_id: int,
    membership_id: int,
    payload: ProjectMemberRolePayload,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("projects.edit")),
):
    obj = db.get(Project, project_id)
    if not obj:
        raise HTTPException(status_code=404, detail="Project not found")
    require_project_owner(db, project_id=project_id, user=current_user)
    role = normalize_membership_role(payload.role)
    row = (
        db.query(ProjectMembership, User)
        .join(User, User.id == ProjectMembership.user_id)
        .filter(ProjectMembership.id == membership_id, ProjectMembership.project_id == project_id)
        .first()
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Member not found")
    membership, user = row
    ensure_can_change_owner_membership(db, membership=membership, next_role=role)
    membership.role = role
    db.commit()
    db.refresh(membership)
    return _member_out(membership, user, current_user)


@router.delete("/{project_id}/members/{membership_id}")
def delete_project_member(
    project_id: int,
    membership_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("projects.edit")),
):
    obj = db.get(Project, project_id)
    if not obj:
        raise HTTPException(status_code=404, detail="Project not found")
    require_project_owner(db, project_id=project_id, user=current_user)
    membership = (
        db.query(ProjectMembership)
        .filter(ProjectMembership.id == membership_id, ProjectMembership.project_id == project_id)
        .first()
    )
    if membership is None:
        raise HTTPException(status_code=404, detail="Member not found")
    ensure_can_change_owner_membership(db, membership=membership, deleting=True)
    db.delete(membership)
    db.commit()
    return {"ok": True}


@router.delete("/{project_id}")
def delete_project(
    project_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("projects.edit")),
):
    obj = db.get(Project, project_id)
    if not obj:
        raise HTTPException(status_code=404, detail="Project not found")
    require_project_write(db, project_id=project_id, user=current_user)
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
