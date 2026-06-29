import os
from pathlib import Path

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.crawler.renderer import snapshot_root
from app.db.models.page import Page
from app.db.models.project import Project
from app.db.models.run import Run
from app.services.scan_retention import raw_artifact_runs_to_keep

DEFAULT_STORAGE_BUDGET_MB = 1024
MIN_STORAGE_BUDGET_MB = 1
MAX_STORAGE_BUDGET_MB = 1024 * 1024


def _bounded_env_int(name: str, *, default: int, minimum: int, maximum: int) -> int:
    raw = os.getenv(name, "").strip()
    if not raw:
        return default
    try:
        value = int(raw)
    except ValueError:
        return default
    return max(minimum, min(value, maximum))


def storage_budget_mb() -> int:
    return _bounded_env_int(
        "SCAN_STORAGE_BUDGET_MB",
        default=DEFAULT_STORAGE_BUDGET_MB,
        minimum=MIN_STORAGE_BUDGET_MB,
        maximum=MAX_STORAGE_BUDGET_MB,
    )


def _directory_size_bytes(path: Path) -> int:
    if not path.exists():
        return 0
    total = 0
    for child in path.rglob("*"):
        try:
            if child.is_file():
                total += child.stat().st_size
        except OSError:
            continue
    return total


def _to_mb(value: int) -> float:
    return round(value / 1024 / 1024, 2)


def build_storage_budget_payload(db: Session) -> dict:
    raw_html_bytes = int(db.query(func.coalesce(func.sum(func.length(Page.html)), 0)).scalar() or 0)
    rendered_snapshot_bytes = _directory_size_bytes(snapshot_root())
    used_bytes = raw_html_bytes + rendered_snapshot_bytes
    budget_mb = storage_budget_mb()
    budget_bytes = budget_mb * 1024 * 1024
    usage_percent = round((used_bytes / budget_bytes) * 100, 1) if budget_bytes > 0 else 0.0
    status = "over_budget" if used_bytes > budget_bytes else "warning" if usage_percent >= 80 else "ok"

    project_rows = (
        db.query(
            Project.id,
            Project.name,
            func.count(func.distinct(Run.id)).label("runs_count"),
            func.count(Page.id).label("pages_count"),
            func.coalesce(func.sum(func.length(Page.html)), 0).label("raw_html_bytes"),
        )
        .outerjoin(Run, Run.project_id == Project.id)
        .outerjoin(Page, Page.run_id == Run.id)
        .group_by(Project.id, Project.name)
        .order_by(func.coalesce(func.sum(func.length(Page.html)), 0).desc(), Project.id.asc())
        .limit(5)
        .all()
    )

    return {
        "source_ok": True,
        "status": status,
        "budget_mb": budget_mb,
        "used_mb": _to_mb(used_bytes),
        "usage_percent": usage_percent,
        "raw_html_mb": _to_mb(raw_html_bytes),
        "rendered_snapshots_mb": _to_mb(rendered_snapshot_bytes),
        "retention": {
            "raw_artifact_runs_to_keep": raw_artifact_runs_to_keep(),
            "source": "SCAN_RAW_ARTIFACT_RUNS_TO_KEEP",
        },
        "source": "SCAN_STORAGE_BUDGET_MB",
        "totals": {
            "projects": int(db.query(Project).count()),
            "runs": int(db.query(Run).count()),
            "pages": int(db.query(Page).count()),
            "pages_with_raw_html": int(db.query(Page).filter(Page.html != "").count()),
        },
        "top_projects": [
            {
                "project_id": row.id,
                "name": row.name,
                "runs": int(row.runs_count or 0),
                "pages": int(row.pages_count or 0),
                "raw_html_mb": _to_mb(int(row.raw_html_bytes or 0)),
            }
            for row in project_rows
        ],
    }
