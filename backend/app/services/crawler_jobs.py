import os
from datetime import datetime, timedelta

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db.models.crawl_persona import CrawlPersona
from app.db.models.crawler_run_job import CrawlerRunJob
from app.db.models.project_site import ProjectSite
from app.db.models.run import Run


JOB_TERMINAL_STATUSES = {"SUCCEEDED", "FAILED", "CANCELLED"}
JOB_ACTIVE_STATUSES = {"QUEUED", "RUNNING", "CANCEL_REQUESTED"}
SYNC_LEASE_OWNER = "sync-backend"


def crawler_worker_enabled() -> bool:
    return os.getenv("CRAWLER_WORKER_ENABLED", "").strip().lower() in {"1", "true", "yes", "on"}


def crawler_job_lease_seconds() -> int:
    raw = os.getenv("CRAWLER_JOB_LEASE_SECONDS", "").strip()
    if not raw:
        return 5 * 60
    try:
        value = int(raw)
    except ValueError:
        return 5 * 60
    return max(30, min(value, 24 * 60 * 60))


def enqueue_site_run_job(
    db: Session,
    *,
    site: ProjectSite,
    persona: CrawlPersona | None,
    actor_user_id: int | None,
    status: str = "QUEUED",
) -> CrawlerRunJob:
    now = datetime.utcnow()
    job = CrawlerRunJob(
        project_id=site.project_id,
        project_site_id=site.id,
        crawl_persona_id=persona.id if persona else None,
        created_by_user_id=actor_user_id,
        kind="site_run",
        status=status,
        scheduled_at=now,
        created_at=now,
        updated_at=now,
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    return job


def mark_job_running(
    db: Session,
    *,
    job: CrawlerRunJob,
    run: Run,
    lease_owner: str = SYNC_LEASE_OWNER,
) -> CrawlerRunJob:
    now = datetime.utcnow()
    job.run_id = run.id
    job.status = "RUNNING"
    job.lease_owner = lease_owner
    job.lease_expires_at = now + timedelta(seconds=crawler_job_lease_seconds())
    job.attempts += 1
    job.started_at = job.started_at or now
    job.heartbeat_at = now
    job.updated_at = now
    db.commit()
    db.refresh(job)
    return job


def heartbeat_job(db: Session, *, job: CrawlerRunJob | None) -> None:
    if job is None or job.status not in JOB_ACTIVE_STATUSES:
        return
    now = datetime.utcnow()
    job.heartbeat_at = now
    job.lease_expires_at = now + timedelta(seconds=crawler_job_lease_seconds())
    job.updated_at = now
    db.commit()


def finish_job_from_run(db: Session, *, job: CrawlerRunJob | None, run: Run) -> None:
    if job is None or job.status in JOB_TERMINAL_STATUSES:
        return
    now = datetime.utcnow()
    if run.status == "FINISHED":
        job.status = "SUCCEEDED"
    elif run.status == "CANCELLED":
        job.status = "CANCELLED"
    else:
        job.status = "FAILED"
    job.failure_code = run.failure_code
    job.failure_message = run.failure_message
    job.finished_at = now
    job.heartbeat_at = now
    job.lease_expires_at = None
    job.updated_at = now
    db.commit()


def fail_job(
    db: Session,
    *,
    job: CrawlerRunJob | None,
    failure_code: str,
    failure_message: str,
) -> None:
    if job is None or job.status in JOB_TERMINAL_STATUSES:
        return
    now = datetime.utcnow()
    job.status = "FAILED"
    job.failure_code = failure_code
    job.failure_message = failure_message
    job.finished_at = now
    job.heartbeat_at = now
    job.lease_expires_at = None
    job.updated_at = now
    db.commit()


def crawler_job_status_counts(db: Session) -> dict[str, int]:
    return {
        str(status): int(count or 0)
        for status, count in db.query(CrawlerRunJob.status, func.count(CrawlerRunJob.id))
        .group_by(CrawlerRunJob.status)
        .all()
    }


def active_crawler_jobs_sample(db: Session, *, limit: int = 10) -> list[dict]:
    jobs = (
        db.query(CrawlerRunJob)
        .filter(CrawlerRunJob.status.in_(JOB_ACTIVE_STATUSES))
        .order_by(CrawlerRunJob.scheduled_at.asc(), CrawlerRunJob.id.asc())
        .limit(limit)
        .all()
    )
    return [
        {
            "job_id": job.id,
            "run_id": job.run_id,
            "project_id": job.project_id,
            "project_site_id": job.project_site_id,
            "crawl_persona_id": job.crawl_persona_id,
            "status": job.status,
            "kind": job.kind,
            "lease_owner": job.lease_owner,
            "lease_expires_at": job.lease_expires_at.isoformat() if job.lease_expires_at else None,
            "attempts": job.attempts,
            "scheduled_at": job.scheduled_at.isoformat() if job.scheduled_at else None,
            "heartbeat_at": job.heartbeat_at.isoformat() if job.heartbeat_at else None,
        }
        for job in jobs
    ]
