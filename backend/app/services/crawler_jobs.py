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
WORKER_LEASE_OWNER = "crawler-worker"
STALE_QUEUED_JOB_DEFAULT_SECONDS = 10 * 60
STALE_QUEUED_JOB_MIN_SECONDS = 60
STALE_QUEUED_JOB_MAX_SECONDS = 24 * 60 * 60


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


def stale_queued_job_seconds() -> int:
    raw = os.getenv("CRAWLER_JOB_STALE_QUEUED_SECONDS", "").strip()
    if not raw:
        return STALE_QUEUED_JOB_DEFAULT_SECONDS
    try:
        value = int(raw)
    except ValueError:
        return STALE_QUEUED_JOB_DEFAULT_SECONDS
    return max(STALE_QUEUED_JOB_MIN_SECONDS, min(value, STALE_QUEUED_JOB_MAX_SECONDS))


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


def find_active_site_job(db: Session, *, project_site_id: int) -> CrawlerRunJob | None:
    recover_expired_crawler_jobs(db, project_site_id=project_site_id)
    return (
        db.query(CrawlerRunJob)
        .filter(
            CrawlerRunJob.project_site_id == project_site_id,
            CrawlerRunJob.status.in_(JOB_ACTIVE_STATUSES),
        )
        .order_by(CrawlerRunJob.id.desc())
        .first()
    )


def claim_next_queued_job(
    db: Session,
    *,
    lease_owner: str = WORKER_LEASE_OWNER,
) -> CrawlerRunJob | None:
    recover_expired_crawler_jobs(db)
    now = datetime.utcnow()
    job = (
        db.query(CrawlerRunJob)
        .filter(CrawlerRunJob.status == "QUEUED", CrawlerRunJob.scheduled_at <= now)
        .order_by(CrawlerRunJob.scheduled_at.asc(), CrawlerRunJob.id.asc())
        .first()
    )
    if job is None:
        return None
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
    job.lease_owner = job.lease_owner or lease_owner
    job.lease_expires_at = now + timedelta(seconds=crawler_job_lease_seconds())
    if job.attempts <= 0:
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


def recover_expired_crawler_jobs(
    db: Session,
    *,
    project_site_id: int | None = None,
    now: datetime | None = None,
) -> int:
    """Terminalize active jobs whose worker lease expired.

    A running job with an expired lease means no healthy worker has refreshed
    the job in time. We do not silently re-run it because the previous worker
    may have written partial page results. Instead the linked run is closed
    with a friendly failure/cancel state and the user can start a clean retry.
    """

    current_time = now or datetime.utcnow()
    query = db.query(CrawlerRunJob).filter(
        CrawlerRunJob.status.in_(("RUNNING", "CANCEL_REQUESTED")),
        CrawlerRunJob.lease_expires_at.isnot(None),
        CrawlerRunJob.lease_expires_at < current_time,
    )
    if project_site_id is not None:
        query = query.filter(CrawlerRunJob.project_site_id == project_site_id)

    expired_jobs = query.order_by(CrawlerRunJob.lease_expires_at.asc(), CrawlerRunJob.id.asc()).all()
    if not expired_jobs:
        return 0

    for job in expired_jobs:
        cancel_requested = job.status == "CANCEL_REQUESTED"
        job.status = "CANCELLED" if cancel_requested else "FAILED"
        job.failure_code = "crawler_job_cancel_lease_expired" if cancel_requested else "crawler_job_lease_expired"
        job.failure_message = (
            "Crawler worker не подтвердил остановку вовремя. Задача закрыта автоматически."
            if cancel_requested
            else "Crawler worker перестал обновлять задачу. Задача закрыта автоматически, сайт можно запустить повторно."
        )
        job.finished_at = current_time
        job.heartbeat_at = current_time
        job.lease_expires_at = None
        job.updated_at = current_time

        if job.run_id:
            run = db.get(Run, job.run_id)
            if run and run.status in {"RUNNING", "CANCEL_REQUESTED"}:
                run.status = "CANCELLED" if cancel_requested else "FAILED"
                run.finished_at = current_time
                run.current_url = None
                run.progress_updated_at = current_time
                run.failure_code = job.failure_code
                run.failure_message = job.failure_message

    db.commit()
    return len(expired_jobs)


def crawler_job_operational_diagnostics(db: Session, *, now: datetime | None = None, sample_limit: int = 10) -> dict:
    current_time = now or datetime.utcnow()
    stale_cutoff = current_time - timedelta(seconds=stale_queued_job_seconds())

    stale_queued_query = db.query(CrawlerRunJob).filter(
        CrawlerRunJob.status == "QUEUED",
        CrawlerRunJob.scheduled_at <= stale_cutoff,
    )
    stale_queued_count = stale_queued_query.count()
    oldest_queued = (
        db.query(CrawlerRunJob)
        .filter(CrawlerRunJob.status == "QUEUED")
        .order_by(CrawlerRunJob.scheduled_at.asc(), CrawlerRunJob.id.asc())
        .first()
    )
    expired_lease_query = db.query(CrawlerRunJob).filter(
        CrawlerRunJob.status.in_(("RUNNING", "CANCEL_REQUESTED")),
        CrawlerRunJob.lease_expires_at.isnot(None),
        CrawlerRunJob.lease_expires_at < current_time,
    )
    expired_lease_count = expired_lease_query.count()

    def _job_payload(job: CrawlerRunJob) -> dict:
        age_seconds = max(0, round((current_time - job.scheduled_at).total_seconds())) if job.scheduled_at else None
        lease_expired_seconds = (
            max(0, round((current_time - job.lease_expires_at).total_seconds()))
            if job.lease_expires_at and job.lease_expires_at < current_time
            else None
        )
        return {
            "job_id": job.id,
            "run_id": job.run_id,
            "project_id": job.project_id,
            "project_site_id": job.project_site_id,
            "crawl_persona_id": job.crawl_persona_id,
            "status": job.status,
            "lease_owner": job.lease_owner,
            "lease_expires_at": job.lease_expires_at.isoformat() if job.lease_expires_at else None,
            "lease_expired_seconds": lease_expired_seconds,
            "attempts": job.attempts,
            "scheduled_at": job.scheduled_at.isoformat() if job.scheduled_at else None,
            "age_seconds": age_seconds,
            "heartbeat_at": job.heartbeat_at.isoformat() if job.heartbeat_at else None,
        }

    stale_samples = (
        stale_queued_query.order_by(CrawlerRunJob.scheduled_at.asc(), CrawlerRunJob.id.asc()).limit(sample_limit).all()
    )
    expired_samples = (
        expired_lease_query.order_by(CrawlerRunJob.lease_expires_at.asc(), CrawlerRunJob.id.asc())
        .limit(sample_limit)
        .all()
    )

    return {
        "stale_queued_threshold_seconds": stale_queued_job_seconds(),
        "stale_queued": stale_queued_count,
        "expired_leases": expired_lease_count,
        "oldest_queued_age_seconds": (
            max(0, round((current_time - oldest_queued.scheduled_at).total_seconds())) if oldest_queued else None
        ),
        "stale_queued_sample": [_job_payload(job) for job in stale_samples],
        "expired_lease_sample": [_job_payload(job) for job in expired_samples],
    }


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
