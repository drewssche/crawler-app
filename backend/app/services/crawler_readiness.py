from datetime import datetime

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db.models.run import Run
from app.services.crawler_jobs import (
    active_crawler_jobs_sample,
    crawler_job_operational_diagnostics,
    crawler_job_status_counts,
    crawler_worker_enabled,
    recover_expired_crawler_jobs,
)
from app.services.run_recovery import mark_stale_running_runs_failed, stale_running_run_seconds


ACTIVE_RUN_STATUSES = ("RUNNING", "CANCEL_REQUESTED")


def build_crawler_readiness(db: Session) -> dict:
    recovered_stale_runs = mark_stale_running_runs_failed(db)
    recovered_expired_jobs = recover_expired_crawler_jobs(db)
    now = datetime.utcnow()

    status_counts = dict(
        db.query(Run.status, func.count(Run.id))
        .filter(Run.status.in_(ACTIVE_RUN_STATUSES))
        .group_by(Run.status)
        .all()
    )
    active_runs = (
        db.query(Run)
        .filter(Run.status.in_(ACTIVE_RUN_STATUSES))
        .order_by(Run.progress_updated_at.asc().nullsfirst(), Run.started_at.asc())
        .limit(10)
        .all()
    )
    job_counts = crawler_job_status_counts(db)
    worker_enabled = crawler_worker_enabled()
    job_diagnostics = crawler_job_operational_diagnostics(db, now=now)
    issues = []
    if worker_enabled and job_diagnostics["stale_queued"] > 0:
        issues.append(
            {
                "code": "crawler_jobs_stale_queued",
                "severity": "warning",
                "message": "В очереди есть crawler-задачи, которые ждут дольше допустимого порога. Проверьте worker и нагрузку.",
                "count": job_diagnostics["stale_queued"],
            }
        )
    if recovered_expired_jobs > 0:
        issues.append(
            {
                "code": "crawler_jobs_expired_recovered",
                "severity": "warning",
                "message": "Readiness закрыла crawler-задачи с истёкшей lease. Сайт можно запускать повторно.",
                "count": recovered_expired_jobs,
            }
        )
    if job_diagnostics["expired_leases"] > 0:
        issues.append(
            {
                "code": "crawler_jobs_expired_leases",
                "severity": "critical",
                "message": "Есть crawler-задачи с истёкшей lease. Readiness восстановит их при следующем чтении.",
                "count": job_diagnostics["expired_leases"],
            }
        )
    ready = not any(issue["severity"] == "critical" for issue in issues) and not (
        worker_enabled and job_diagnostics["stale_queued"] > 0
    ) and (
        recovered_expired_jobs == 0
    )

    return {
        "ready": ready,
        "status": "ok" if ready else "degraded",
        "mode": "worker" if worker_enabled else "synchronous",
        "worker": {
            "enabled": worker_enabled,
            "message": (
                "Durable worker включён через CRAWLER_WORKER_ENABLED."
                if worker_enabled
                else "Durable job boundary уже пишет crawler_run_jobs, но execution пока выполняется в backend request lifecycle."
            ),
        },
        "jobs": {
            "total_active": sum(job_counts.get(status, 0) for status in ("QUEUED", "RUNNING", "CANCEL_REQUESTED")),
            "queued": job_counts.get("QUEUED", 0),
            "running": job_counts.get("RUNNING", 0),
            "cancel_requested": job_counts.get("CANCEL_REQUESTED", 0),
            "succeeded": job_counts.get("SUCCEEDED", 0),
            "failed": job_counts.get("FAILED", 0),
            "cancelled": job_counts.get("CANCELLED", 0),
            "sample": active_crawler_jobs_sample(db),
            "diagnostics": job_diagnostics,
            "recovered_expired_jobs": recovered_expired_jobs,
        },
        "issues": issues,
        "stale_recovery": {
            "threshold_seconds": stale_running_run_seconds(),
            "recovered_runs": recovered_stale_runs,
        },
        "active": {
            "total": sum(int(value or 0) for value in status_counts.values()),
            "running": int(status_counts.get("RUNNING") or 0),
            "cancel_requested": int(status_counts.get("CANCEL_REQUESTED") or 0),
            "sample": [
                {
                    "run_id": run.id,
                    "project_id": run.project_id,
                    "project_site_id": run.project_site_id,
                    "crawl_persona_id": run.crawl_persona_id,
                    "status": run.status,
                    "crawl_runtime": run.crawl_runtime,
                    "started_at": run.started_at.isoformat() if run.started_at else None,
                    "progress_updated_at": run.progress_updated_at.isoformat() if run.progress_updated_at else None,
                    "age_seconds": max(0, round((now - run.started_at).total_seconds())) if run.started_at else None,
                    "idle_seconds": (
                        max(0, round((now - (run.progress_updated_at or run.started_at)).total_seconds()))
                        if run.started_at
                        else None
                    ),
                    "current_url": run.current_url,
                }
                for run in active_runs
            ],
        },
    }
