from datetime import datetime

from sqlalchemy.orm import Session

from app.db.models.page import Page
from app.db.models.project import Project
from app.db.models.project_site import ProjectSite
from app.db.models.run import Run
from app.services.crawl_personas import ensure_guest_persona
from app.services.project_sites import create_primary_site_for_project
from app.services.site_anomalies import evaluate_project_site_anomalies


def _site(db: Session) -> ProjectSite:
    project = Project(
        name="Anomaly project",
        start_url="https://anomaly.test",
        allowed_domains_csv="anomaly.test",
    )
    db.add(project)
    db.flush()
    site = create_primary_site_for_project(db, project)
    db.flush()
    return site


def _finished_run(
    db: Session,
    site: ProjectSite,
    *,
    pages_total: int,
    pages_changed: int,
    error_pages: int = 0,
) -> Run:
    persona = ensure_guest_persona(db, site)
    run = Run(
        project_id=site.project_id,
        project_site_id=site.id,
        crawl_persona_id=persona.id,
        status="FINISHED",
        started_at=datetime.utcnow(),
        finished_at=datetime.utcnow(),
        pages_total=pages_total,
        pages_changed=pages_changed,
    )
    db.add(run)
    db.flush()
    for index in range(pages_total):
        db.add(
            Page(
                run_id=run.id,
                url=f"https://anomaly.test/page-{run.id}-{index}",
                status_code=500 if index < error_pages else 200,
                content_type="text/html",
                html="<html></html>",
                html_hash=f"hash-{run.id}-{index}",
            )
        )
    db.flush()
    return run


def test_anomaly_requires_three_previous_successful_runs(db_session: Session):
    site = _site(db_session)
    for _ in range(3):
        _finished_run(db_session, site, pages_total=100, pages_changed=5)

    result = evaluate_project_site_anomalies(db_session, [site.id])[site.id]

    assert result["status"] == "insufficient_data"
    assert result["successful_runs"] == 3
    assert result["baseline_runs_required"] == 3


def test_anomaly_reports_normal_when_latest_matches_baseline(db_session: Session):
    site = _site(db_session)
    for _ in range(3):
        _finished_run(db_session, site, pages_total=100, pages_changed=5)
    latest = _finished_run(db_session, site, pages_total=98, pages_changed=6)

    result = evaluate_project_site_anomalies(db_session, [site.id])[site.id]

    assert result["status"] == "normal"
    assert result["severity"] == "info"
    assert result["latest"]["run_id"] == latest.id
    assert result["reasons"] == []


def test_anomaly_explains_coverage_drop_and_http_error_growth(db_session: Session):
    site = _site(db_session)
    for _ in range(3):
        _finished_run(db_session, site, pages_total=100, pages_changed=5)
    _finished_run(db_session, site, pages_total=40, pages_changed=4, error_pages=15)

    result = evaluate_project_site_anomalies(db_session, [site.id])[site.id]
    reason_codes = {reason["code"] for reason in result["reasons"]}

    assert result["status"] == "anomaly"
    assert result["severity"] == "danger"
    assert reason_codes == {"coverage_drop", "http_errors_growth"}
