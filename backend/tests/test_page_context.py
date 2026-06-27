from datetime import datetime

from sqlalchemy.orm import Session

from app.db.models.page import Page
from app.db.models.page_retry_attempt import PageRetryAttempt
from app.db.models.project import Project
from app.db.models.run import Run
from app.services.page_context import build_page_context
from app.services.project_sites import create_primary_site_for_project


def test_page_context_builds_links_assets_and_explainable_seo_score(db_session: Session):
    project = Project(
        name="SEO",
        start_url="https://seo.test",
        allowed_domains_csv="seo.test",
    )
    db_session.add(project)
    db_session.flush()
    site = create_primary_site_for_project(db_session, project)
    db_session.flush()
    run = Run(
        project_id=project.id,
        project_site_id=site.id,
        status="FINISHED",
        started_at=datetime.utcnow(),
        finished_at=datetime.utcnow(),
        pages_total=2,
        pages_changed=2,
    )
    db_session.add(run)
    db_session.flush()
    page = Page(
        run_id=run.id,
        url="https://seo.test/",
        status_code=200,
        content_type="text/html",
        html="""
        <html lang="ru">
          <head>
            <title>Полезная страница продукта</title>
            <meta name="description" content="Подробное описание продукта, его возможностей, преимуществ и вариантов использования для клиентов компании.">
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <link rel="canonical" href="https://seo.test/">
            <link rel="stylesheet" href="/app.css">
          </head>
          <body>
            <h1>Продукт компании</h1>
            <h2>Возможности</h2>
            <a href="/broken">Не работает</a>
            <a href="https://external.test/">Внешняя ссылка</a>
            <img src="/hero.jpg" alt="Интерфейс продукта">
            <script src="/app.js"></script>
          </body>
        </html>
        """,
        html_hash="current",
    )
    broken = Page(
        run_id=run.id,
        url="https://seo.test/broken",
        status_code=404,
        content_type="text/html",
        html="",
        html_hash="",
    )
    db_session.add_all([page, broken])
    db_session.flush()

    context = build_page_context(db_session, run, page)

    assert context["links"]["total"] == 2
    assert context["links"]["known_broken"] == 1
    assert context["assets"]["images"]["total"] == 1
    assert context["assets"]["images"]["missing_alt"] == 0
    assert context["assets"]["scripts"]["total"] == 1
    assert context["assets"]["styles"]["total"] == 1
    assert context["seo"]["score"] >= 90
    assert all(item["status"] == "pass" for item in context["seo"]["checklist"])


def test_page_context_seo_score_explains_missing_fields(db_session: Session):
    project = Project(name="Weak SEO", start_url="https://weak.test")
    db_session.add(project)
    db_session.flush()
    site = create_primary_site_for_project(db_session, project)
    db_session.flush()
    run = Run(
        project_id=project.id,
        project_site_id=site.id,
        status="FINISHED",
        started_at=datetime.utcnow(),
        finished_at=datetime.utcnow(),
        pages_total=1,
        pages_changed=1,
    )
    db_session.add(run)
    db_session.flush()
    page = Page(
        run_id=run.id,
        url="https://weak.test/",
        status_code=200,
        content_type="text/html",
        html="<html><body><img src='/photo.jpg'><h3>Сразу H3</h3></body></html>",
        html_hash="weak",
    )
    db_session.add(page)
    db_session.flush()

    context = build_page_context(db_session, run, page)
    failed_keys = {
        item["key"]
        for item in context["seo"]["checklist"]
        if item["status"] == "fail"
    }

    assert context["seo"]["score"] < 40
    assert {"title", "description", "h1", "canonical", "lang", "viewport", "image_alt"} <= failed_keys


def test_page_context_explains_redirect_status_in_friendly_language(db_session: Session):
    project = Project(name="Redirect", start_url="https://redirect-context.test/old")
    db_session.add(project)
    db_session.flush()
    site = create_primary_site_for_project(db_session, project)
    db_session.flush()
    run = Run(
        project_id=project.id,
        project_site_id=site.id,
        status="FINISHED",
        started_at=datetime.utcnow(),
        finished_at=datetime.utcnow(),
        pages_total=1,
        pages_changed=1,
    )
    db_session.add(run)
    db_session.flush()
    page = Page(
        run_id=run.id,
        url="https://redirect-context.test/old",
        status_code=301,
        final_url="https://redirect-context.test/new",
        final_status_code=200,
        redirect_chain_json=[
            {
                "url": "https://redirect-context.test/old",
                "status_code": 301,
                "location": "/new",
            },
            {
                "url": "https://redirect-context.test/new",
                "status_code": 200,
                "location": None,
            },
        ],
        content_type="text/html",
        html="<html><body>new</body></html>",
        html_hash="redirect",
    )
    db_session.add(page)
    db_session.flush()

    context = build_page_context(db_session, run, page)

    assert context["page"]["redirect"]["hops"] == 1
    assert context["page"]["redirect"]["target_url"] == "https://redirect-context.test/new"
    assert "Постоянное перенаправление" in context["page"]["redirect"]["explanation"]


def test_page_context_includes_retry_history_without_overwriting_original(db_session: Session):
    project = Project(name="Retry context", start_url="https://retry-context.test/")
    db_session.add(project)
    db_session.flush()
    site = create_primary_site_for_project(db_session, project)
    db_session.flush()
    run = Run(
        project_id=project.id,
        project_site_id=site.id,
        status="FINISHED",
        started_at=datetime.utcnow(),
        finished_at=datetime.utcnow(),
        pages_total=1,
        pages_changed=1,
    )
    db_session.add(run)
    db_session.flush()
    page = Page(
        run_id=run.id,
        url="https://retry-context.test/missing",
        status_code=404,
        final_status_code=404,
        content_type="text/html",
        html="",
        html_hash="",
    )
    db_session.add(page)
    db_session.flush()
    db_session.add(
        PageRetryAttempt(
            run_id=run.id,
            page_id=page.id,
            attempt_no=1,
            status="SUCCEEDED",
            started_at=datetime.utcnow(),
            finished_at=datetime.utcnow(),
            status_code=200,
            final_url=page.url,
            final_status_code=200,
            redirect_chain_json=[],
            response_time_ms=125,
        )
    )
    db_session.flush()

    context = build_page_context(db_session, run, page)

    assert context["page"]["status_code"] == 404
    assert context["page"]["retry_attempts"][0]["status"] == "SUCCEEDED"
    assert context["page"]["retry_attempts"][0]["final_status_code"] == 200
    assert context["page"]["can_retry"] is False


def test_page_context_builds_safe_tracking_cookie_and_consent_inventory(db_session: Session):
    project = Project(name="Tracking", start_url="https://tracking.test/")
    db_session.add(project)
    db_session.flush()
    site = create_primary_site_for_project(db_session, project)
    db_session.flush()
    run = Run(
        project_id=project.id,
        project_site_id=site.id,
        status="FINISHED",
        started_at=datetime.utcnow(),
        finished_at=datetime.utcnow(),
        pages_total=1,
        pages_changed=1,
    )
    db_session.add(run)
    db_session.flush()
    page = Page(
        run_id=run.id,
        url="https://tracking.test/",
        status_code=200,
        final_status_code=200,
        content_type="text/html",
        html="""
        <html>
          <head>
            <script src="https://www.googletagmanager.com/gtm.js?id=GTM-ABC123&token=must-not-leak"></script>
            <script type="text/plain" data-cookieconsent="statistics">
              gtag('config', 'G-ABCDE12345');
              document.cookie = "analytics_consent=yes; path=/";
            </script>
            <script>
              gtag('config', 'AW-123456789');
              const secret = "token-value-must-not-be-returned";
            </script>
            <script src="https://consent.cookiebot.com/uc.js"></script>
          </head>
        </html>
        """,
        html_hash="tracking",
    )
    db_session.add(page)
    db_session.flush()

    tracking = build_page_context(db_session, run, page)["tracking"]
    identifiers = {item["id"] for item in tracking["identifiers"]}

    assert {"GTM-ABC123", "G-ABCDE12345", "AW-123456789"} <= identifiers
    assert tracking["cookies"]["names"] == ["analytics_consent"]
    assert tracking["cookies"]["values_exposed"] is False
    assert tracking["consent"]["frameworks"] == ["Cookiebot"]
    assert tracking["consent"]["runtime_audit"] == "not_run"
    assert any(
        item["consent_state"] == "blocked_until_consent"
        for item in tracking["scripts"]["items"]
    )
    assert all("token=" not in (item["source"] or "") for item in tracking["scripts"]["items"])
    assert "token-value-must-not-be-returned" not in str(tracking)
