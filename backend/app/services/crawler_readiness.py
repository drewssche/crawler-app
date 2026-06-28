from datetime import datetime

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db.models.run import Run
from app.services.run_recovery import mark_stale_running_runs_failed, stale_running_run_seconds


ACTIVE_RUN_STATUSES = ("RUNNING", "CANCEL_REQUESTED")


def build_crawler_readiness(db: Session) -> dict:
    recovered_stale_runs = mark_stale_running_runs_failed(db)
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

    return {
        "ready": True,
        "status": "ok",
        "mode": "synchronous",
        "worker": {
            "enabled": False,
            "message": "Durable worker/queue ещё не включены; crawler выполняется в backend request lifecycle.",
        },
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
