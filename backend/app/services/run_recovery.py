import os
from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from app.db.models.run import Run


STALE_RUNNING_RUN_DEFAULT_SECONDS = 30 * 60
STALE_RUNNING_RUN_MIN_SECONDS = 60
STALE_RUNNING_RUN_MAX_SECONDS = 24 * 60 * 60


def stale_running_run_seconds() -> int:
    raw = os.getenv("CRAWL_STALE_RUNNING_SECONDS", "").strip()
    if not raw:
        return STALE_RUNNING_RUN_DEFAULT_SECONDS
    try:
        value = int(raw)
    except ValueError:
        return STALE_RUNNING_RUN_DEFAULT_SECONDS
    return max(STALE_RUNNING_RUN_MIN_SECONDS, min(value, STALE_RUNNING_RUN_MAX_SECONDS))


def mark_stale_running_runs_failed(
    db: Session,
    *,
    project_id: int | None = None,
    project_site_id: int | None = None,
    now: datetime | None = None,
) -> int:
    """Fail RUNNING runs that stopped reporting progress.

    This is a conservative recovery guard for the current synchronous crawler.
    A healthy run refreshes ``progress_updated_at`` while processing pages and
    when it finishes. If the API process dies mid-run, the row can otherwise
    remain RUNNING forever and block future starts for the same site.
    """

    current_time = now or datetime.utcnow()
    cutoff = current_time - timedelta(seconds=stale_running_run_seconds())

    query = db.query(Run).filter(Run.status == "RUNNING")
    if project_id is not None:
        query = query.filter(Run.project_id == project_id)
    if project_site_id is not None:
        query = query.filter(Run.project_site_id == project_site_id)

    stale_runs = [
        run
        for run in query.all()
        if (run.progress_updated_at or run.started_at) < cutoff
    ]
    if not stale_runs:
        return 0

    for run in stale_runs:
        run.status = "FAILED"
        run.finished_at = current_time
        run.current_url = None
        run.progress_updated_at = current_time
        run.failure_code = run.failure_code or "stale_run_recovered"
        run.failure_message = (
            run.failure_message
            or "Прогон долго не обновлял состояние и был автоматически остановлен. Можно запустить сайт повторно."
        )

    db.commit()
    return len(stale_runs)
