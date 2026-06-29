import os
from dataclasses import dataclass

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.db.models.crawler_run_job import CrawlerRunJob
from app.db.models.project import Project
from app.db.models.project_site import ProjectSite
from app.services.crawler_jobs import JOB_ACTIVE_STATUSES, recover_expired_crawler_jobs


@dataclass(frozen=True)
class RoleQuota:
    max_projects: int
    max_sites_per_project: int
    max_pages_per_site: int
    max_concurrency_per_site: int
    max_active_jobs_per_user: int
    max_bulk_sites_per_run: int


DEFAULT_ROLE_QUOTAS: dict[str, RoleQuota] = {
    "viewer": RoleQuota(0, 0, 0, 0, 0, 0),
    "editor": RoleQuota(50, 20, 5_000, 3, 3, 10),
    "admin": RoleQuota(500, 100, 10_000, 10, 20, 50),
    "root-admin": RoleQuota(5_000, 500, 10_000, 20, 100, 200),
}


def _role_env_key(role: str) -> str:
    return role.upper().replace("-", "_")


def _bounded_env_int(name: str, *, default: int, minimum: int = 0, maximum: int = 1_000_000) -> int:
    raw = os.getenv(name, "").strip()
    if not raw:
        return default
    try:
        value = int(raw)
    except ValueError:
        return default
    return max(minimum, min(value, maximum))


def quota_for_role(role: str | None) -> RoleQuota:
    normalized = (role or "viewer").strip().lower()
    base = DEFAULT_ROLE_QUOTAS.get(normalized, DEFAULT_ROLE_QUOTAS["viewer"])
    env_role = _role_env_key(normalized)
    return RoleQuota(
        max_projects=_bounded_env_int(f"QUOTA_{env_role}_MAX_PROJECTS", default=base.max_projects),
        max_sites_per_project=_bounded_env_int(
            f"QUOTA_{env_role}_MAX_SITES_PER_PROJECT",
            default=base.max_sites_per_project,
        ),
        max_pages_per_site=_bounded_env_int(
            f"QUOTA_{env_role}_MAX_PAGES_PER_SITE",
            default=base.max_pages_per_site,
            minimum=0,
            maximum=10_000,
        ),
        max_concurrency_per_site=_bounded_env_int(
            f"QUOTA_{env_role}_MAX_CONCURRENCY_PER_SITE",
            default=base.max_concurrency_per_site,
            minimum=0,
            maximum=100,
        ),
        max_active_jobs_per_user=_bounded_env_int(
            f"QUOTA_{env_role}_MAX_ACTIVE_JOBS_PER_USER",
            default=base.max_active_jobs_per_user,
        ),
        max_bulk_sites_per_run=_bounded_env_int(
            f"QUOTA_{env_role}_MAX_BULK_SITES_PER_RUN",
            default=base.max_bulk_sites_per_run,
        ),
    )


def _quota_error(*, quota: str, message: str, limit: int, current: int = 0, requested: int = 1) -> HTTPException:
    return HTTPException(
        status_code=409,
        detail={
            "code": "quota_exceeded",
            "quota": quota,
            "limit": limit,
            "current": current,
            "requested": requested,
            "message": message,
        },
    )


def enforce_project_create_quota(db: Session, *, role: str) -> None:
    quota = quota_for_role(role)
    current = db.query(Project).count()
    if current >= quota.max_projects:
        raise _quota_error(
            quota="max_projects",
            limit=quota.max_projects,
            current=current,
            message=f"Достигнут лимит проектов для роли {role}: {quota.max_projects}.",
        )


def enforce_project_site_create_quota(db: Session, *, project_id: int, role: str) -> None:
    quota = quota_for_role(role)
    current = db.query(ProjectSite).filter(ProjectSite.project_id == project_id).count()
    if current >= quota.max_sites_per_project:
        raise _quota_error(
            quota="max_sites_per_project",
            limit=quota.max_sites_per_project,
            current=current,
            message=f"Достигнут лимит сайтов в проекте для роли {role}: {quota.max_sites_per_project}.",
        )


def enforce_site_settings_quota(*, role: str, max_pages: int, concurrency: int) -> None:
    quota = quota_for_role(role)
    if max_pages > quota.max_pages_per_site:
        raise _quota_error(
            quota="max_pages_per_site",
            limit=quota.max_pages_per_site,
            requested=max_pages,
            message=f"Лимит страниц для роли {role}: {quota.max_pages_per_site}. Уменьшите max pages.",
        )
    if concurrency > quota.max_concurrency_per_site:
        raise _quota_error(
            quota="max_concurrency_per_site",
            limit=quota.max_concurrency_per_site,
            requested=concurrency,
            message=f"Лимит параллельности для роли {role}: {quota.max_concurrency_per_site}.",
        )


def enforce_actor_active_job_quota(
    db: Session,
    *,
    actor_user_id: int | None,
    role: str,
    requested_jobs: int = 1,
) -> None:
    quota = quota_for_role(role)
    if actor_user_id is None:
        return
    recover_expired_crawler_jobs(db)
    current = (
        db.query(CrawlerRunJob)
        .filter(
            CrawlerRunJob.created_by_user_id == actor_user_id,
            CrawlerRunJob.status.in_(JOB_ACTIVE_STATUSES),
        )
        .count()
    )
    if current + requested_jobs > quota.max_active_jobs_per_user:
        raise _quota_error(
            quota="max_active_jobs_per_user",
            limit=quota.max_active_jobs_per_user,
            current=current,
            requested=requested_jobs,
            message=(
                f"У пользователя уже есть активные задачи crawler: {current}. "
                f"Лимит для роли {role}: {quota.max_active_jobs_per_user}."
            ),
        )


def enforce_bulk_run_quota(*, role: str, sites_count: int) -> None:
    quota = quota_for_role(role)
    if sites_count > quota.max_bulk_sites_per_run:
        raise _quota_error(
            quota="max_bulk_sites_per_run",
            limit=quota.max_bulk_sites_per_run,
            requested=sites_count,
            message=(
                f"За один общий запуск можно поставить в очередь не больше "
                f"{quota.max_bulk_sites_per_run} сайтов для роли {role}."
            ),
        )
