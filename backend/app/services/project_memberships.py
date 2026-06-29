from fastapi import HTTPException
from sqlalchemy import exists, or_
from sqlalchemy.orm import Query, Session

from app.core.security import get_user_role
from app.db.models.project import Project
from app.db.models.project_membership import ProjectMembership
from app.db.models.user import User


WRITE_MEMBERSHIP_ROLES = {"owner", "editor"}
MEMBERSHIP_ROLES = {"owner", "editor", "viewer"}


def user_has_global_project_access(user: User) -> bool:
    return get_user_role(user) in {"admin", "root-admin"}


def ensure_project_owner(db: Session, *, project_id: int, user_id: int) -> ProjectMembership:
    existing = (
        db.query(ProjectMembership)
        .filter(ProjectMembership.project_id == project_id, ProjectMembership.user_id == user_id)
        .first()
    )
    if existing is not None:
        if existing.role != "owner":
            existing.role = "owner"
        return existing
    membership = ProjectMembership(project_id=project_id, user_id=user_id, role="owner")
    db.add(membership)
    return membership


def project_has_memberships(db: Session, *, project_id: int) -> bool:
    return db.query(ProjectMembership.id).filter(ProjectMembership.project_id == project_id).first() is not None


def get_project_membership(db: Session, *, project_id: int, user_id: int) -> ProjectMembership | None:
    return (
        db.query(ProjectMembership)
        .filter(ProjectMembership.project_id == project_id, ProjectMembership.user_id == user_id)
        .first()
    )


def can_read_project(db: Session, *, project_id: int, user: User) -> bool:
    if user_has_global_project_access(user):
        return True
    if not project_has_memberships(db, project_id=project_id):
        return True
    return get_project_membership(db, project_id=project_id, user_id=user.id) is not None


def can_write_project(db: Session, *, project_id: int, user: User) -> bool:
    if user_has_global_project_access(user):
        return True
    if not project_has_memberships(db, project_id=project_id):
        return True
    membership = get_project_membership(db, project_id=project_id, user_id=user.id)
    return bool(membership and membership.role in WRITE_MEMBERSHIP_ROLES)


def require_project_read(db: Session, *, project_id: int, user: User) -> None:
    if not can_read_project(db, project_id=project_id, user=user):
        raise HTTPException(status_code=404, detail="Project not found")


def require_project_write(db: Session, *, project_id: int, user: User) -> None:
    if not can_write_project(db, project_id=project_id, user=user):
        raise HTTPException(
            status_code=403,
            detail={
                "code": "project_membership_required",
                "message": "Недостаточно прав в этом проекте.",
                "project_id": project_id,
            },
        )


def require_project_owner(db: Session, *, project_id: int, user: User) -> None:
    if not can_read_project(db, project_id=project_id, user=user):
        raise HTTPException(status_code=404, detail="Project not found")
    if user_has_global_project_access(user):
        return
    if not project_has_memberships(db, project_id=project_id):
        return
    membership = get_project_membership(db, project_id=project_id, user_id=user.id)
    if membership and membership.role == "owner":
        return
    raise HTTPException(
        status_code=403,
        detail={
            "code": "project_owner_required",
            "message": "Управлять участниками может только владелец проекта.",
            "project_id": project_id,
        },
    )


def normalize_membership_role(role: str) -> str:
    normalized = str(role or "").strip().lower()
    if normalized not in MEMBERSHIP_ROLES:
        raise HTTPException(
            status_code=422,
            detail={
                "code": "invalid_project_role",
                "message": "Роль участника должна быть owner, editor или viewer.",
            },
        )
    return normalized


def count_project_owners(db: Session, *, project_id: int) -> int:
    return (
        db.query(ProjectMembership)
        .filter(ProjectMembership.project_id == project_id, ProjectMembership.role == "owner")
        .count()
    )


def ensure_can_change_owner_membership(
    db: Session,
    *,
    membership: ProjectMembership,
    next_role: str | None = None,
    deleting: bool = False,
) -> None:
    keeps_owner = not deleting and next_role == "owner"
    if membership.role != "owner" or keeps_owner:
        return
    if count_project_owners(db, project_id=membership.project_id) <= 1:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "last_project_owner",
                "message": "В проекте должен оставаться хотя бы один владелец.",
                "project_id": membership.project_id,
            },
        )


def visible_projects_query(db: Session, user: User) -> Query:
    query = db.query(Project)
    if user_has_global_project_access(user):
        return query
    member_project_ids = db.query(ProjectMembership.project_id).filter(ProjectMembership.user_id == user.id)
    membership_exists = exists().where(ProjectMembership.project_id == Project.id)
    return query.filter(or_(Project.id.in_(member_project_ids), ~membership_exists))
