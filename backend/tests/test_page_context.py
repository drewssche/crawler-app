from datetime import datetime

from sqlalchemy.orm import Session

from app.db.models.page import Page
from app.db.models.profile import Profile
from app.db.models.run import Run
from app.services.page_context import build_page_context
from app.services.project_sites import create_primary_site_for_profile


def test_page_context_builds_links_assets_and_explainable_seo_score(db_session: Session):
    profile = Profile(
        name="SEO",
        start_url="https://seo.test",
        allowed_domains_csv="seo.test",
    )
    db_session.add(profile)
    db_session.flush()
    site = create_primary_site_for_profile(db_session, profile)
    db_session.flush()
    run = Run(
        profile_id=profile.id,
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
    profile = Profile(name="Weak SEO", start_url="https://weak.test")
    db_session.add(profile)
    db_session.flush()
    site = create_primary_site_for_profile(db_session, profile)
    db_session.flush()
    run = Run(
        profile_id=profile.id,
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
