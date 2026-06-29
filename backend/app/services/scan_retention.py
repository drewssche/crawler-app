import os

from sqlalchemy.orm import Session

from app.crawler.renderer import delete_rendered_snapshot_artifacts_for_run
from app.db.models.page import Page
from app.db.models.run import Run


RAW_ARTIFACT_RUNS_TO_KEEP_DEFAULT = 2
RAW_ARTIFACT_RUNS_TO_KEEP_MIN = 1
RAW_ARTIFACT_RUNS_TO_KEEP_MAX = 20


def raw_artifact_runs_to_keep() -> int:
    raw = os.getenv("SCAN_RAW_ARTIFACT_RUNS_TO_KEEP", "").strip()
    if not raw:
        return RAW_ARTIFACT_RUNS_TO_KEEP_DEFAULT
    try:
        value = int(raw)
    except ValueError:
        return RAW_ARTIFACT_RUNS_TO_KEEP_DEFAULT
    return max(RAW_ARTIFACT_RUNS_TO_KEEP_MIN, min(value, RAW_ARTIFACT_RUNS_TO_KEEP_MAX))


def prune_site_persona_raw_artifacts(
    db: Session,
    *,
    project_site_id: int,
    crawl_persona_id: int | None,
    keep_successful_runs: int | None = None,
) -> dict:
    keep = keep_successful_runs if keep_successful_runs is not None else raw_artifact_runs_to_keep()
    keep = max(RAW_ARTIFACT_RUNS_TO_KEEP_MIN, min(int(keep), RAW_ARTIFACT_RUNS_TO_KEEP_MAX))
    successful_run_ids = [
        row[0]
        for row in (
            db.query(Run.id)
            .filter(
                Run.project_site_id == project_site_id,
                Run.crawl_persona_id == crawl_persona_id,
                Run.status == "FINISHED",
            )
            .order_by(Run.id.desc())
            .all()
        )
    ]
    prune_run_ids = successful_run_ids[keep:]
    if not prune_run_ids:
        return {"pruned_runs": 0, "pruned_pages": 0, "kept_runs": min(len(successful_run_ids), keep)}

    pruned_pages = (
        db.query(Page)
        .filter(Page.run_id.in_(prune_run_ids), Page.html != "")
        .update({Page.html: ""}, synchronize_session=False)
    )
    for run_id in prune_run_ids:
        delete_rendered_snapshot_artifacts_for_run(int(run_id))
    return {
        "pruned_runs": len(prune_run_ids),
        "pruned_pages": int(pruned_pages or 0),
        "kept_runs": min(len(successful_run_ids), keep),
    }


def delete_rendered_snapshot_artifacts_for_project(db: Session, *, project_id: int) -> int:
    run_ids = [row[0] for row in db.query(Run.id).filter(Run.project_id == project_id).all()]
    for run_id in run_ids:
        delete_rendered_snapshot_artifacts_for_run(int(run_id))
    return len(run_ids)
