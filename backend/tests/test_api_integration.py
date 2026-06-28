import hashlib
import os
import tempfile
from collections.abc import Generator
from datetime import datetime, timedelta
from types import SimpleNamespace

import httpx
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.security import create_access_token
from app.db import models  # noqa: F401
from app.db.base import Base
from app.db.models.admin_audit_log import AdminAuditLog
from app.db.models.crawl_persona import CrawlPersona
from app.db.models.crawl_persona_login_capture import CrawlPersonaLoginCapture
from app.db.models.event_feed import EventFeed
from app.db.models.login_history import LoginHistory
from app.db.models.project import Project
from app.db.models.project_site import ProjectSite
from app.db.models.page import Page
from app.db.models.page_retry_attempt import PageRetryAttempt
from app.db.models.run import Run
from app.db.models.trusted_device import TrustedDevice
from app.db.models.user import User
from app.db.session import get_db
from app.main import app
from app.services.project_sites import build_project_site, create_primary_site_for_project


def _make_user(
    *,
    email: str,
    role: str = "viewer",
    is_admin: bool = False,
    is_approved: bool = True,
    is_blocked: bool = False,
    token_version: int = 0,
) -> User:
    return User(
        email=email,
        hashed_password="x",
        role=role,
        trust_policy="standard",
        is_admin=is_admin,
        is_approved=is_approved,
        is_blocked=is_blocked,
        is_deleted=False,
        token_version=token_version,
    )


def _auth_header(email: str, role: str = "viewer", token_version: int = 0) -> dict[str, str]:
    token = create_access_token({"sub": email, "role": role, "tv": token_version})
    return {"Authorization": f"Bearer {token}"}


def _add_primary_site(db: Session, project: Project) -> ProjectSite:
    if project.id is None:
        db.flush()
    site = create_primary_site_for_project(db, project)
    db.flush()
    return site


def _extract_error_payload(response):
    payload = response.json()
    assert payload["ok"] is False
    assert "error" in payload
    assert "request_id" in payload
    return payload


def _extract_success_data(response):
    payload = response.json()
    assert payload["ok"] is True
    assert "data" in payload
    assert "request_id" in payload
    return payload["data"]


def _get_session_factory():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    return engine, sessionmaker(bind=engine, autocommit=False, autoflush=False)


def _override_get_db(session_factory):
    def _get_db() -> Generator[Session, None, None]:
        db = session_factory()
        try:
            yield db
        finally:
            db.close()

    return _get_db


def test_admin_endpoint_forbidden_for_viewer():
    engine, SessionLocal = _get_session_factory()
    app.router.on_startup.clear()
    app.router.on_shutdown.clear()
    app.dependency_overrides[get_db] = _override_get_db(SessionLocal)

    with SessionLocal() as db:
        db.add(_make_user(email="viewer@test.local", role="viewer", is_approved=True))
        db.commit()

    client = TestClient(app)
    response = client.get("/admin/users?status=all", headers=_auth_header("viewer@test.local", role="viewer"))
    assert response.status_code == 403
    payload = _extract_error_payload(response)
    assert payload["error"]["code"] == "http_403"

    app.dependency_overrides.clear()
    Base.metadata.drop_all(bind=engine)
    engine.dispose()


def test_event_center_forbidden_for_viewer():
    engine, SessionLocal = _get_session_factory()
    app.router.on_startup.clear()
    app.router.on_shutdown.clear()
    app.dependency_overrides[get_db] = _override_get_db(SessionLocal)

    with SessionLocal() as db:
        db.add(_make_user(email="viewer-events@test.local", role="viewer", is_approved=True))
        db.commit()

    client = TestClient(app)
    response = client.get(
        "/events/center",
        headers=_auth_header("viewer-events@test.local", role="viewer"),
    )
    assert response.status_code == 403
    payload = _extract_error_payload(response)
    assert payload["error"]["code"] == "http_403"

    app.dependency_overrides.clear()
    Base.metadata.drop_all(bind=engine)
    engine.dispose()


def test_project_and_run_endpoints_enforce_role_permissions():
    engine, SessionLocal = _get_session_factory()
    app.router.on_startup.clear()
    app.router.on_shutdown.clear()
    app.dependency_overrides[get_db] = _override_get_db(SessionLocal)

    with SessionLocal() as db:
        viewer = _make_user(email="project-viewer@test.local", role="viewer", is_approved=True)
        editor = _make_user(email="project-editor@test.local", role="editor", is_approved=True)
        project = Project(name="Protected", start_url="https://protected.test", allowed_domains_csv="protected.test")
        db.add_all([viewer, editor, project])
        db.commit()
        db.refresh(project)
        site = _add_primary_site(db, project)
        run = Run(
            project_id=project.id,
            project_site_id=site.id,
            status="RUNNING",
            started_at=datetime.utcnow(),
        )
        db.add(run)
        db.commit()
        db.refresh(run)
        page = Page(
            run_id=run.id,
            url="https://protected.test/",
            status_code=200,
            content_type="text/html",
            html="<html><head><title>Protected title</title></head><body></body></html>",
            html_hash="hash",
        )
        db.add(page)
        db.commit()
        project_id = project.id
        site_id = site.id
        run_id = run.id

    client = TestClient(app)
    viewer_headers = _auth_header("project-viewer@test.local", role="viewer")
    editor_headers = _auth_header("project-editor@test.local", role="editor")

    assert client.get(f"/projects/{project_id}").status_code == 401
    assert client.get(f"/runs/by-project/{project_id}").status_code == 401
    assert client.get(f"/runs/{run_id}/pages").status_code == 401
    assert client.get(
        f"/runs/{run_id}/page-context",
        params={"url": "https://protected.test/"},
    ).status_code == 401
    assert client.post(f"/runs/start-site/{site_id}").status_code == 401
    assert client.post(f"/runs/{run_id}/retry-pages", json={}).status_code == 401

    assert client.get(f"/projects/{project_id}", headers=viewer_headers).status_code == 200
    assert client.get(f"/runs/by-project/{project_id}", headers=viewer_headers).status_code == 200
    assert client.get(f"/runs/{run_id}/pages", headers=viewer_headers).status_code == 200
    page_context = client.get(
        f"/runs/{run_id}/page-context",
        params={"url": "https://protected.test/"},
        headers=viewer_headers,
    )
    assert page_context.status_code == 200
    assert page_context.json()["seo"]["score"] < 50
    snapshot = client.get(
        f"/runs/{run_id}/snapshot",
        params={"url": "https://protected.test/"},
        headers=viewer_headers,
    )
    assert snapshot.status_code == 200
    assert snapshot.json()["html"] == "<html><head><title>Protected title</title></head><body></body></html>"
    assert snapshot.json()["rendered_snapshot"]["available"] is False
    catalog = client.get(f"/runs/{run_id}/page-catalog", headers=viewer_headers)
    assert catalog.status_code == 200
    assert catalog.json()[0]["title"] == "Protected title"
    assert client.post(f"/runs/start-site/{site_id}", headers=viewer_headers).status_code == 403
    assert client.post(
        f"/runs/{run_id}/retry-pages",
        json={},
        headers=viewer_headers,
    ).status_code == 403
    assert client.post(
        "/projects",
        json={"name": "Denied", "start_url": "https://denied.test", "allowed_domains_csv": "denied.test"},
        headers=viewer_headers,
    ).status_code == 403
    assert client.delete(f"/projects/{project_id}", headers=viewer_headers).status_code == 403

    assert client.post(f"/runs/start-site/{site_id}", headers=editor_headers).status_code == 409
    created = client.post(
        "/projects",
        json={"name": "Allowed", "start_url": "https://allowed.test", "allowed_domains_csv": "allowed.test"},
        headers=editor_headers,
    )
    assert created.status_code == 200
    assert client.delete(f"/projects/{created.json()['id']}", headers=editor_headers).status_code == 200

    app.dependency_overrides.clear()
    Base.metadata.drop_all(bind=engine)
    engine.dispose()


def test_project_sites_are_created_canonically_and_enforce_role_permissions():
    engine, SessionLocal = _get_session_factory()
    app.router.on_startup.clear()
    app.router.on_shutdown.clear()
    app.dependency_overrides[get_db] = _override_get_db(SessionLocal)

    with SessionLocal() as db:
        db.add_all(
            [
                _make_user(email="site-viewer@test.local", role="viewer", is_approved=True),
                _make_user(email="site-editor@test.local", role="editor", is_approved=True),
            ]
        )
        db.commit()

    client = TestClient(app)
    viewer_headers = _auth_header("site-viewer@test.local", role="viewer")
    editor_headers = _auth_header("site-editor@test.local", role="editor")

    created_project = client.post(
        "/projects",
        json={
            "name": "Multi-site project",
            "start_url": "https://primary.example.test/",
            "allowed_domains_csv": "",
        },
        headers=editor_headers,
    )
    assert created_project.status_code == 200
    project_id = created_project.json()["id"]

    primary_rows = _extract_success_data(
        client.get(f"/projects/{project_id}/sites", headers=viewer_headers)
    )
    assert len(primary_rows) == 1
    assert primary_rows[0]["role"] == "primary"
    assert primary_rows[0]["canonical_origin"] == "https://primary.example.test"
    assert primary_rows[0]["allowed_domains_csv"] == "primary.example.test"
    primary_id = primary_rows[0]["id"]

    denied = client.post(
        f"/projects/{project_id}/sites",
        json={"name": "Denied", "start_url": "https://denied.example.test"},
        headers=viewer_headers,
    )
    assert denied.status_code == 403

    created_site = client.post(
        f"/projects/{project_id}/sites",
        json={
            "name": "Documentation",
            "start_url": "https://reference.example.test",
            "scope_mode": "path_prefix",
            "path_prefix": "/docs",
            "role": "reference",
        },
        headers=editor_headers,
    )
    assert created_site.status_code == 200
    site = _extract_success_data(created_site)
    assert site["start_url"] == "https://reference.example.test/docs"
    assert site["path_prefix"] == "/docs/"
    assert site["allowed_domains_csv"] == "reference.example.test"

    duplicate = client.post(
        f"/projects/{project_id}/sites",
        json={
            "name": "Duplicate docs",
            "start_url": "https://reference.example.test/docs/",
            "scope_mode": "path_prefix",
            "role": "peer",
        },
        headers=editor_headers,
    )
    assert duplicate.status_code == 409
    assert _extract_error_payload(duplicate)["error"]["code"] == "project_site_scope_conflict"

    updated = client.patch(
        f"/projects/{project_id}/sites/{site['id']}",
        json={"path_prefix": "/help"},
        headers=editor_headers,
    )
    assert updated.status_code == 200
    updated_site = _extract_success_data(updated)
    assert updated_site["start_url"] == "https://reference.example.test/help"
    assert updated_site["path_prefix"] == "/help/"

    assert client.delete(
        f"/projects/{project_id}/sites/{site['id']}",
        headers=editor_headers,
    ).status_code == 200
    last_site = client.delete(
        f"/projects/{project_id}/sites/{primary_id}",
        headers=editor_headers,
    )
    assert last_site.status_code == 409
    assert _extract_error_payload(last_site)["error"]["code"] == "project_requires_site"

    with SessionLocal() as db:
        assert db.query(ProjectSite).filter(ProjectSite.project_id == project_id).count() == 1

    app.dependency_overrides.clear()
    Base.metadata.drop_all(bind=engine)
    engine.dispose()


def test_project_creation_supports_atomic_section_primary_site():
    engine, SessionLocal = _get_session_factory()
    app.router.on_startup.clear()
    app.router.on_shutdown.clear()
    app.dependency_overrides[get_db] = _override_get_db(SessionLocal)

    with SessionLocal() as db:
        db.add(_make_user(email="section-create@test.local", role="editor", is_approved=True))
        db.commit()

    client = TestClient(app)
    created = client.post(
        "/projects",
        json={
            "name": "Documentation monitoring",
            "site_name": "Public docs",
            "start_url": "https://docs.example.test",
            "scope_mode": "path_prefix",
            "path_prefix": "/manual",
            "allowed_domains_csv": "",
        },
        headers=_auth_header("section-create@test.local", role="editor"),
    )

    assert created.status_code == 200
    project_id = created.json()["id"]
    sites = _extract_success_data(
        client.get(
            f"/projects/{project_id}/sites",
            headers=_auth_header("section-create@test.local", role="editor"),
        )
    )
    assert len(sites) == 1
    assert sites[0]["name"] == "Public docs"
    assert sites[0]["start_url"] == "https://docs.example.test/manual"
    assert sites[0]["scope_mode"] == "path_prefix"
    assert sites[0]["path_prefix"] == "/manual/"

    another_section = client.post(
        "/projects",
        json={
            "name": "API monitoring",
            "start_url": "https://docs.example.test",
            "scope_mode": "path_prefix",
            "path_prefix": "/api",
        },
        headers=_auth_header("section-create@test.local", role="editor"),
    )
    assert another_section.status_code == 200

    duplicate_section = client.post(
        "/projects",
        json={
            "name": "Duplicate manual",
            "start_url": "https://docs.example.test/manual/",
            "scope_mode": "path_prefix",
            "path_prefix": "/manual",
        },
        headers=_auth_header("section-create@test.local", role="editor"),
    )
    assert duplicate_section.status_code == 409

    app.dependency_overrides.clear()
    Base.metadata.drop_all(bind=engine)
    engine.dispose()


def test_ui_debug_capabilities_require_admin_and_non_production_flags(monkeypatch):
    engine, SessionLocal = _get_session_factory()
    app.router.on_startup.clear()
    app.router.on_shutdown.clear()
    app.dependency_overrides[get_db] = _override_get_db(SessionLocal)

    with SessionLocal() as db:
        db.add_all(
            [
                _make_user(email="debug-viewer@test.local", role="viewer", is_approved=True),
                _make_user(email="debug-admin@test.local", role="admin", is_admin=True, is_approved=True),
            ]
        )
        db.commit()

    client = TestClient(app)
    viewer_headers = _auth_header("debug-viewer@test.local", role="viewer")
    admin_headers = _auth_header("debug-admin@test.local", role="admin")

    assert client.get("/auth/ui-debug-capabilities", headers=viewer_headers).status_code == 403

    monkeypatch.setenv("UI_DEBUG_ENABLED", "true")
    monkeypatch.setenv("APP_ENV", "development")
    enabled = client.get("/auth/ui-debug-capabilities", headers=admin_headers)
    assert enabled.status_code == 200
    enabled_data = _extract_success_data(enabled)
    assert enabled_data["enabled"] is True
    assert enabled_data["fixture_only"] is True

    monkeypatch.setenv("APP_ENV", "production")
    production = client.get("/auth/ui-debug-capabilities", headers=admin_headers)
    assert production.status_code == 200
    assert _extract_success_data(production)["enabled"] is False

    app.dependency_overrides.clear()
    Base.metadata.drop_all(bind=engine)
    engine.dispose()


def test_http_errors_metric_includes_404_status():
    engine, SessionLocal = _get_session_factory()
    app.router.on_startup.clear()
    app.router.on_shutdown.clear()
    app.dependency_overrides[get_db] = _override_get_db(SessionLocal)

    with SessionLocal() as db:
        db.add(_make_user(email="admin-metrics@test.local", role="admin", is_admin=True, is_approved=True))
        db.commit()

    client = TestClient(app)
    not_found = client.get("/__missing_route__")
    assert not_found.status_code == 404

    metrics = client.get("/metrics", headers=_auth_header("admin-metrics@test.local", role="admin"))
    assert metrics.status_code == 200
    data = _extract_success_data(metrics)
    error_rows = data["counters"].get("http_errors_total", [])
    assert any(
        row.get("labels", {}).get("path") == "/__missing_route__"
        and row.get("labels", {}).get("status") == "404"
        for row in error_rows
    )

    app.dependency_overrides.clear()
    Base.metadata.drop_all(bind=engine)
    engine.dispose()


def test_projects_summary_returns_last_run_and_totals():
    engine, SessionLocal = _get_session_factory()
    app.router.on_startup.clear()
    app.router.on_shutdown.clear()
    app.dependency_overrides[get_db] = _override_get_db(SessionLocal)

    with SessionLocal() as db:
        viewer = _make_user(email="summary@test.local", role="viewer", is_approved=True)
        p1 = Project(name="A", start_url="https://a.test", allowed_domains_csv="a.test")
        p2 = Project(name="B", start_url="https://b.test", allowed_domains_csv="b.test")
        db.add_all([viewer, p1, p2])
        db.commit()
        db.refresh(p1)
        db.refresh(p2)
        p1_site = _add_primary_site(db, p1)
        _add_primary_site(db, p2)

        db.add_all(
            [
                Run(
                    project_id=p1.id,
                    project_site_id=p1_site.id,
                    status="FINISHED",
                    started_at=datetime(2026, 1, 1, 10, 0, 0),
                    finished_at=datetime(2026, 1, 1, 10, 1, 0),
                    pages_total=12,
                    pages_changed=3,
                ),
                Run(
                    project_id=p1.id,
                    project_site_id=p1_site.id,
                    status="RUNNING",
                    started_at=datetime(2026, 1, 2, 11, 0, 0),
                    finished_at=None,
                    pages_total=7,
                    pages_changed=0,
                ),
            ]
        )
        db.commit()

    client = TestClient(app)
    response = client.get("/projects/summary", headers=_auth_header("summary@test.local", role="viewer"))
    assert response.status_code == 200
    data = _extract_success_data(response)
    by_name = {row["name"]: row for row in data}
    assert by_name["A"]["runs_total"] == 2
    assert by_name["A"]["last_run"]["status"] == "RUNNING"
    assert by_name["A"]["last_run"]["pages_total"] == 7
    assert by_name["B"]["runs_total"] == 0
    assert by_name["B"]["last_run"] is None

    app.dependency_overrides.clear()
    Base.metadata.drop_all(bind=engine)
    engine.dispose()


def test_site_runs_keep_allowed_domains_as_technical_allowlist(monkeypatch):
    from app.api import runs as runs_api

    engine, SessionLocal = _get_session_factory()
    app.router.on_startup.clear()
    app.router.on_shutdown.clear()
    app.dependency_overrides[get_db] = _override_get_db(SessionLocal)

    with SessionLocal() as db:
        db.add(_make_user(email="runs-multi@test.local", role="editor", is_approved=True))
        project = Project(
            name="Multi",
            start_url="https://a.test",
            allowed_domains_csv="a.test,b.test",
            max_pages=10,
        )
        db.add(project)
        db.commit()
        db.refresh(project)
        primary = _add_primary_site(db, project)
        secondary = build_project_site(
            project_id=project.id,
            name="B",
            start_url="https://b.test",
            scope_mode="whole_site",
            path_prefix="/",
            role="peer",
            allowed_domains_csv="b.test",
            exclude_paths_csv="",
            exclude_ext_csv="",
            respect_robots=True,
            max_pages=10,
            concurrency=1,
            is_enabled=True,
            sort_order=1,
        )
        db.add(secondary)
        db.commit()
        db.refresh(primary)
        db.refresh(secondary)
        project_id = project.id
        primary_id = primary.id
        secondary_id = secondary.id

    calls: list[str] = []

    class FakeResponse:
        def __init__(self, url: str):
            self.url = url
            self.status_code = 200
            self.headers = {"content-type": "text/html; charset=utf-8"}
            self.text = "<html><body><h1>ok</h1></body></html>"

    class FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def get(self, url: str):
            calls.append(url)
            return FakeResponse(url)

    monkeypatch.setattr(runs_api.httpx, "Client", FakeClient)

    client = TestClient(app)
    editor_headers = _auth_header("runs-multi@test.local", role="editor")
    response = client.post(f"/runs/start-site/{primary_id}", headers=editor_headers)
    assert response.status_code == 200
    primary_run_id = response.json()["run_id"]
    assert response.json()["project_site_id"] == primary_id
    assert response.json()["persona"]["key"] == "guest"

    pages_response = client.get(f"/runs/{primary_run_id}/pages", headers=editor_headers)
    assert pages_response.status_code == 200
    pages = pages_response.json()
    urls = {row["url"] for row in pages}
    assert "https://a.test" in urls or "https://a.test/" in urls
    assert any("a.test" in url for url in calls)
    assert not any("b.test" in url for url in calls)

    secondary_response = client.post(
        f"/runs/start-site/{secondary_id}",
        headers=editor_headers,
    )
    assert secondary_response.status_code == 200
    assert secondary_response.json()["project_site_id"] == secondary_id
    assert secondary_response.json()["persona"]["label"] == "Гость"
    assert any("b.test" in url for url in calls)

    primary_runs = client.get(f"/runs/by-site/{primary_id}", headers=editor_headers)
    secondary_runs = client.get(f"/runs/by-site/{secondary_id}", headers=editor_headers)
    assert [row["id"] for row in primary_runs.json()] == [primary_run_id]
    assert primary_runs.json()[0]["persona"]["key"] == "guest"
    assert [row["id"] for row in secondary_runs.json()] == [secondary_response.json()["run_id"]]
    summaries = _extract_success_data(
        client.get(f"/projects/{project_id}/sites/summary", headers=editor_headers)
    )
    summaries_by_id = {row["id"]: row for row in summaries}
    assert summaries_by_id[primary_id]["runs_total"] == 1
    assert summaries_by_id[primary_id]["default_persona"]["key"] == "guest"
    assert summaries_by_id[primary_id]["last_run"]["id"] == primary_run_id
    assert summaries_by_id[primary_id]["last_run"]["persona"]["label"] == "Гость"
    assert summaries_by_id[primary_id]["anomaly"]["status"] == "insufficient_data"
    assert summaries_by_id[secondary_id]["runs_total"] == 1
    assert summaries_by_id[secondary_id]["last_run"]["id"] == secondary_response.json()["run_id"]
    anomaly_response = client.get(
        f"/projects/{project_id}/sites/{primary_id}/anomaly",
        headers=editor_headers,
    )
    assert anomaly_response.status_code == 200
    assert _extract_success_data(anomaly_response)["status"] == "insufficient_data"
    delete_with_history = client.delete(
        f"/projects/{project_id}/sites/{secondary_id}",
        headers=editor_headers,
    )
    assert delete_with_history.status_code == 409
    assert _extract_error_payload(delete_with_history)["error"]["code"] == "project_site_has_runs"

    assert client.delete(f"/projects/{project_id}", headers=editor_headers).status_code == 200
    with SessionLocal() as db:
        assert db.query(CrawlPersona).filter(CrawlPersona.project_site_id.in_([primary_id, secondary_id])).count() == 0
        assert db.query(ProjectSite).filter(ProjectSite.project_id == project_id).count() == 0
        assert db.query(Run).filter(Run.project_id == project_id).count() == 0
        assert db.query(Page).filter(Page.run_id.in_([primary_run_id, secondary_response.json()["run_id"]])).count() == 0

    app.dependency_overrides.clear()
    Base.metadata.drop_all(bind=engine)
    engine.dispose()


def test_crawl_persona_session_bundle_is_masked_encrypted_and_selectable(monkeypatch):
    from app.api import project_sites as project_sites_api
    from app.api import runs as runs_api

    engine, SessionLocal = _get_session_factory()
    app.router.on_startup.clear()
    app.router.on_shutdown.clear()
    app.dependency_overrides[get_db] = _override_get_db(SessionLocal)

    with SessionLocal() as db:
        db.add(_make_user(email="persona-editor@test.local", role="editor", is_approved=True))
        db.add(_make_user(email="persona-viewer@test.local", role="viewer", is_approved=True))
        project = Project(name="Persona", start_url="https://persona.test", allowed_domains_csv="persona.test")
        db.add(project)
        db.flush()
        site = _add_primary_site(db, project)
        db.commit()
        project_id = project.id
        site_id = site.id

    class FakeResponse:
        url = "https://persona.test"
        status_code = 200
        headers = {"content-type": "text/html"}
        text = "<html><body>persona</body></html>"

    client_contexts = []

    class FakeCookieJar:
        def __init__(self):
            self.rows = []

        def set(self, name: str, value: str, **kwargs):
            self.rows.append({"name": name, "value": value, **kwargs})

    class FakeClient:
        def __init__(self, *args, **kwargs):
            self.headers = kwargs.get("headers") or {}
            self.cookies = FakeCookieJar()
            client_contexts.append(self)

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def get(self, url: str):
            return FakeResponse()

    monkeypatch.setattr(runs_api.httpx, "Client", FakeClient)

    client = TestClient(app)
    editor_headers = _auth_header("persona-editor@test.local", role="editor")
    viewer_headers = _auth_header("persona-viewer@test.local", role="viewer")

    personas_response = client.get(f"/projects/{project_id}/sites/{site_id}/personas", headers=viewer_headers)
    assert personas_response.status_code == 200
    personas = _extract_success_data(personas_response)
    assert personas[0]["key"] == "guest"
    assert personas[0]["has_secrets"] is False
    assert "encrypted_session_bundle" not in personas[0]

    create_response = client.post(
        f"/projects/{project_id}/sites/{site_id}/personas",
        json={"key": "partner", "label": "Партнёр", "kind": "partner"},
        headers=editor_headers,
    )
    assert create_response.status_code == 200
    partner = _extract_success_data(create_response)
    assert partner["key"] == "partner"
    assert partner["has_secrets"] is False

    denied_response = client.put(
        f"/projects/{project_id}/sites/{site_id}/personas/{partner['id']}/session-bundle",
        json={"bundle": {"cookies": [{"name": "sid", "value": "viewer-secret"}]}},
        headers=viewer_headers,
    )
    assert denied_response.status_code == 403

    save_response = client.put(
        f"/projects/{project_id}/sites/{site_id}/personas/{partner['id']}/session-bundle",
        json={
            "bundle": {
                "cookies": [{"name": "sid", "value": "super-secret", "domain": "persona.test", "path": "/"}],
                "headers": {"X-Partner-Mode": "enabled"},
                "localStorage": [],
            },
            "expires_at": (datetime.utcnow() + timedelta(days=3)).isoformat(),
        },
        headers=editor_headers,
    )
    assert save_response.status_code == 200
    saved = _extract_success_data(save_response)
    assert saved["has_secrets"] is True
    assert saved["session_bundle_updated_at"]
    assert saved["session_bundle_summary"]["http_applicable"] is True
    assert saved["session_bundle_summary"]["cookies_count"] == 1
    assert saved["session_bundle_summary"]["headers_count"] == 1
    assert saved["session_bundle_summary"]["local_storage_count"] == 0
    assert saved["session_bundle_summary"]["expiry_status"] == "expiring"
    assert saved["session_bundle_summary"]["expires_in_days"] in {3, 4}
    assert saved["session_bundle_summary"]["values_exposed"] is False
    assert "super-secret" not in str(saved)

    with SessionLocal() as db:
        stored = db.get(CrawlPersona, partner["id"])
        assert stored is not None
        assert stored.encrypted_session_bundle
        assert "super-secret" not in stored.encrypted_session_bundle
        assert stored.session_bundle_fingerprint

    run_response = client.post(
        f"/runs/start-site/{site_id}",
        json={"crawl_persona_id": partner["id"]},
        headers=editor_headers,
    )
    assert run_response.status_code == 200
    assert run_response.json()["persona"]["key"] == "partner"
    assert client_contexts[-1].headers["X-Partner-Mode"] == "enabled"
    assert client_contexts[-1].cookies.rows == [
        {"name": "sid", "value": "super-secret", "domain": "persona.test", "path": "/"}
    ]

    denied_capture = client.post(
        f"/projects/{project_id}/sites/{site_id}/personas/{partner['id']}/login-captures",
        json={"login_url": "https://persona.test/login"},
        headers=viewer_headers,
    )
    assert denied_capture.status_code == 403

    capture_response = client.post(
        f"/projects/{project_id}/sites/{site_id}/personas/{partner['id']}/login-captures",
        json={"login_url": "https://persona.test/login", "ttl_minutes": 10},
        headers=editor_headers,
    )
    assert capture_response.status_code == 200
    capture = _extract_success_data(capture_response)
    assert capture["status"] == "PENDING"
    assert capture["login_url"] == "https://persona.test/login"
    assert capture["mode"] == "manual_storage_state"
    assert capture["managed_browser_available"] is False
    assert "secret" not in str(capture).lower()

    duplicate_capture = client.post(
        f"/projects/{project_id}/sites/{site_id}/personas/{partner['id']}/login-captures",
        json={"login_url": "https://persona.test/login"},
        headers=editor_headers,
    )
    assert duplicate_capture.status_code == 409
    duplicate_payload = _extract_error_payload(duplicate_capture)
    assert duplicate_payload["error"]["code"] == "login_capture_already_active"
    assert duplicate_payload["error"]["details"]["capture"]["id"] == capture["id"]

    managed_unavailable = client.post(
        f"/projects/{project_id}/sites/{site_id}/personas/{partner['id']}/login-captures/{capture['id']}/capture-managed",
        json={"wait_seconds": 0},
        headers=editor_headers,
    )
    assert managed_unavailable.status_code == 409
    managed_unavailable_payload = _extract_error_payload(managed_unavailable)
    assert managed_unavailable_payload["error"]["code"] == "managed_login_capture_unavailable"

    complete_response = client.post(
        f"/projects/{project_id}/sites/{site_id}/personas/{partner['id']}/login-captures/{capture['id']}/complete",
        json={
            "storage_state": {
                "cookies": [{"name": "browser_sid", "value": "browser-secret", "domain": "persona.test", "path": "/"}],
                "origins": [
                    {
                        "origin": "https://persona.test",
                        "localStorage": [{"name": "role", "value": "partner-secret"}],
                    }
                ],
            },
            "session_storage": {"https://persona.test": [{"name": "tab", "value": "tab-secret"}]},
        },
        headers=editor_headers,
    )
    assert complete_response.status_code == 200
    completed = _extract_success_data(complete_response)
    assert completed["capture"]["status"] == "COMPLETED"
    assert completed["persona"]["has_secrets"] is True
    assert completed["persona"]["session_bundle_summary"]["cookies_count"] == 1
    assert completed["persona"]["session_bundle_summary"]["local_storage_count"] == 1
    assert completed["persona"]["session_bundle_summary"]["session_storage_count"] == 1
    assert "browser-secret" not in str(completed)
    assert "partner-secret" not in str(completed)

    with SessionLocal() as db:
        stored = db.get(CrawlPersona, partner["id"])
        assert stored is not None
        assert stored.encrypted_session_bundle
        assert "browser-secret" not in stored.encrypted_session_bundle
        capture_row = db.get(CrawlPersonaLoginCapture, capture["id"])
        assert capture_row is not None
        assert capture_row.status == "COMPLETED"

    delete_response = client.delete(
        f"/projects/{project_id}/sites/{site_id}/personas/{partner['id']}/session-bundle",
        headers=editor_headers,
    )
    assert delete_response.status_code == 200
    deleted = _extract_success_data(delete_response)
    assert deleted["has_secrets"] is False
    assert deleted["session_bundle_summary"]["status"] == "missing"

    managed_persona_response = client.post(
        f"/projects/{project_id}/sites/{site_id}/personas",
        json={"key": "managed", "label": "Managed user", "kind": "authenticated"},
        headers=editor_headers,
    )
    assert managed_persona_response.status_code == 200
    managed_persona = _extract_success_data(managed_persona_response)
    managed_capture_response = client.post(
        f"/projects/{project_id}/sites/{site_id}/personas/{managed_persona['id']}/login-captures",
        json={"login_url": "https://persona.test/login"},
        headers=editor_headers,
    )
    assert managed_capture_response.status_code == 200
    managed_capture = _extract_success_data(managed_capture_response)

    monkeypatch.setattr(
        project_sites_api,
        "capture_managed_login_state",
        lambda login_url, wait_seconds=0: SimpleNamespace(
            storage_state={
                "cookies": [{"name": "managed_sid", "value": "managed-secret", "domain": "persona.test", "path": "/"}],
                "origins": [
                    {
                        "origin": "https://persona.test",
                        "localStorage": [{"name": "role", "value": "managed-role-secret"}],
                    }
                ],
            },
            final_url=login_url,
            page_title="Managed login",
        ),
    )
    managed_complete_response = client.post(
        f"/projects/{project_id}/sites/{site_id}/personas/{managed_persona['id']}/login-captures/{managed_capture['id']}/capture-managed",
        json={"wait_seconds": 0},
        headers=editor_headers,
    )
    assert managed_complete_response.status_code == 200
    managed_completed = _extract_success_data(managed_complete_response)
    assert managed_completed["capture"]["status"] == "COMPLETED"
    assert managed_completed["persona"]["has_secrets"] is True
    assert managed_completed["persona"]["session_bundle_summary"]["cookies_count"] == 1
    assert managed_completed["persona"]["session_bundle_summary"]["local_storage_count"] == 1
    assert "managed-secret" not in str(managed_completed)
    assert "managed-role-secret" not in str(managed_completed)

    app.dependency_overrides.clear()
    Base.metadata.drop_all(bind=engine)
    engine.dispose()


def test_section_site_run_never_queues_urls_outside_path_scope(monkeypatch):
    from app.api import runs as runs_api

    engine, SessionLocal = _get_session_factory()
    app.router.on_startup.clear()
    app.router.on_shutdown.clear()
    app.dependency_overrides[get_db] = _override_get_db(SessionLocal)

    with SessionLocal() as db:
        db.add(_make_user(email="section-run@test.local", role="editor", is_approved=True))
        project = Project(
            name="Section",
            start_url="https://scope.test/docs",
            allowed_domains_csv="scope.test",
            max_pages=10,
        )
        db.add(project)
        db.flush()
        site = build_project_site(
            project_id=project.id,
            name="Docs",
            start_url="https://scope.test/docs",
            scope_mode="path_prefix",
            path_prefix="/docs",
            role="primary",
            allowed_domains_csv="scope.test",
            exclude_paths_csv="",
            exclude_ext_csv="",
            respect_robots=True,
            max_pages=10,
            concurrency=1,
            is_enabled=True,
        )
        db.add(site)
        db.commit()
        db.refresh(site)
        site_id = site.id

    calls: list[str] = []

    class FakeResponse:
        def __init__(self, url: str):
            self.url = url
            self.status_code = 200
            self.headers = {"content-type": "text/html"}
            self.text = (
                '<a href="/docs/inside">inside</a>'
                '<a href="/docs-old/outside">outside</a>'
                '<a href="/docs/%2e%2e/admin">traversal</a>'
                '<a href="https://other.test/docs/remote">remote</a>'
            )

    class FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def get(self, url: str):
            calls.append(url)
            return FakeResponse(url)

    monkeypatch.setattr(runs_api.httpx, "Client", FakeClient)
    client = TestClient(app)
    response = client.post(
        f"/runs/start-site/{site_id}",
        headers=_auth_header("section-run@test.local", role="editor"),
    )

    assert response.status_code == 200
    assert calls == ["https://scope.test/docs", "https://scope.test/docs/inside"]

    app.dependency_overrides.clear()
    Base.metadata.drop_all(bind=engine)
    engine.dispose()


def test_project_run_continues_after_one_site_fails(monkeypatch):
    from app.api import runs as runs_api

    engine, SessionLocal = _get_session_factory()
    app.router.on_startup.clear()
    app.router.on_shutdown.clear()
    app.dependency_overrides[get_db] = _override_get_db(SessionLocal)

    with SessionLocal() as db:
        db.add(_make_user(email="project-run@test.local", role="editor", is_approved=True))
        project = Project(
            name="Two sites",
            start_url="https://good.test",
            allowed_domains_csv="good.test",
            max_pages=1,
        )
        db.add(project)
        db.flush()
        good_site = _add_primary_site(db, project)
        bad_site = build_project_site(
            project_id=project.id,
            name="Unavailable",
            start_url="https://bad.test",
            scope_mode="whole_site",
            path_prefix="/",
            role="peer",
            allowed_domains_csv="bad.test",
            exclude_paths_csv="",
            exclude_ext_csv="",
            respect_robots=True,
            max_pages=1,
            concurrency=1,
            is_enabled=True,
            sort_order=1,
        )
        db.add(bad_site)
        db.commit()
        db.refresh(good_site)
        db.refresh(bad_site)
        project_id = project.id
        good_site_id = good_site.id
        bad_site_id = bad_site.id

    class FakeResponse:
        url = "https://good.test/"
        status_code = 200
        headers = {"content-type": "text/html"}
        text = "<html><body>ok</body></html>"

    class FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def get(self, url: str):
            if "bad.test" in url:
                raise httpx.ReadTimeout("timed out", request=httpx.Request("GET", url))
            return FakeResponse()

    monkeypatch.setattr(runs_api.httpx, "Client", FakeClient)
    client = TestClient(app)
    response = client.post(
        f"/runs/start-project/{project_id}",
        headers=_auth_header("project-run@test.local", role="editor"),
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["sites_total"] == 2
    assert payload["finished"] == 1
    assert payload["failed"] == 1
    by_site = {row["project_site_id"]: row for row in payload["results"]}
    assert by_site[good_site_id]["status"] == "FINISHED"
    assert by_site[bad_site_id]["status"] == "FAILED"
    assert by_site[bad_site_id]["failure_code"] == "timeout"

    with SessionLocal() as db:
        good_run = db.query(Run).filter(Run.project_site_id == good_site_id).one()
        bad_run = db.query(Run).filter(Run.project_site_id == bad_site_id).one()
        assert good_run.status == "FINISHED"
        assert bad_run.status == "FAILED"

    app.dependency_overrides.clear()
    Base.metadata.drop_all(bind=engine)
    engine.dispose()


def test_create_profile_rejects_duplicate_canonical_scope():
    engine, SessionLocal = _get_session_factory()
    app.router.on_startup.clear()
    app.router.on_shutdown.clear()
    app.dependency_overrides[get_db] = _override_get_db(SessionLocal)

    with SessionLocal() as db:
        db.add(_make_user(email="projects@test.local", role="editor", is_approved=True))
        existing = Project(name="Existing", start_url="https://example.test/", allowed_domains_csv="example.test")
        db.add(existing)
        db.flush()
        _add_primary_site(db, existing)
        db.commit()

    client = TestClient(app)
    response = client.post(
        "/projects",
        json={
            "name": "Duplicate",
            "start_url": "https://example.test",
            "allowed_domains_csv": "example.test",
        },
        headers=_auth_header("projects@test.local", role="editor"),
    )
    assert response.status_code == 409
    payload = _extract_error_payload(response)
    assert payload["error"]["code"] == "project_scope_conflict"
    assert "Existing" in payload["error"]["message"]
    assert payload["error"]["details"]["existing_project"]["name"] == "Existing"

    distinct_path = client.post(
        "/projects",
        json={
            "name": "Section",
            "start_url": "https://example.test/docs",
            "allowed_domains_csv": "example.test",
        },
        headers=_auth_header("projects@test.local", role="editor"),
    )
    assert distinct_path.status_code == 200

    app.dependency_overrides.clear()
    Base.metadata.drop_all(bind=engine)
    engine.dispose()


def test_run_lock_is_scoped_to_project(monkeypatch):
    from app.api import runs as runs_api

    engine, SessionLocal = _get_session_factory()
    app.router.on_startup.clear()
    app.router.on_shutdown.clear()
    app.dependency_overrides[get_db] = _override_get_db(SessionLocal)

    with SessionLocal() as db:
        db.add(_make_user(email="runs-lock@test.local", role="editor", is_approved=True))
        first = Project(name="First", start_url="https://first.test", allowed_domains_csv="first.test", max_pages=1)
        second = Project(name="Second", start_url="https://second.test", allowed_domains_csv="second.test", max_pages=1)
        db.add_all([first, second])
        db.commit()
        db.refresh(first)
        db.refresh(second)
        first_site = _add_primary_site(db, first)
        second_site = _add_primary_site(db, second)
        db.add(
            Run(
                project_id=first.id,
                project_site_id=first_site.id,
                status="RUNNING",
                started_at=datetime.utcnow(),
            )
        )
        db.commit()
        first_site_id = first_site.id
        second_site_id = second_site.id

    class FakeResponse:
        def __init__(self, url: str):
            self.url = url
            self.status_code = 200
            self.headers = {"content-type": "text/html"}
            self.text = "<html><body>ok</body></html>"

    class FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def get(self, url: str):
            return FakeResponse(url)

    monkeypatch.setattr(runs_api.httpx, "Client", FakeClient)
    client = TestClient(app)

    editor_headers = _auth_header("runs-lock@test.local", role="editor")
    blocked = client.post(f"/runs/start-site/{first_site_id}", headers=editor_headers)
    assert blocked.status_code == 409
    assert _extract_error_payload(blocked)["error"]["code"] == "site_run_already_active"
    allowed = client.post(f"/runs/start-site/{second_site_id}", headers=editor_headers)
    assert allowed.status_code == 200

    app.dependency_overrides.clear()
    Base.metadata.drop_all(bind=engine)
    engine.dispose()


def test_empty_crawl_marks_run_failed(monkeypatch):
    from app.api import runs as runs_api

    engine, SessionLocal = _get_session_factory()
    app.router.on_startup.clear()
    app.router.on_shutdown.clear()
    app.dependency_overrides[get_db] = _override_get_db(SessionLocal)

    with SessionLocal() as db:
        db.add(_make_user(email="runs-empty@test.local", role="editor", is_approved=True))
        project = Project(name="Empty", start_url="https://empty.test", allowed_domains_csv="empty.test", max_pages=1)
        db.add(project)
        db.commit()
        db.refresh(project)
        site = _add_primary_site(db, project)
        db.commit()
        project_id = project.id
        site_id = site.id

    class FailingClient:
        def __init__(self, *args, **kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def get(self, url: str):
            raise httpx.ReadTimeout("timed out", request=httpx.Request("GET", url))

    monkeypatch.setattr(runs_api.httpx, "Client", FailingClient)
    client = TestClient(app)
    response = client.post(
        f"/runs/start-site/{site_id}",
        headers=_auth_header("runs-empty@test.local", role="editor"),
    )
    assert response.status_code == 502

    with SessionLocal() as db:
        run = db.query(Run).filter(Run.project_id == project_id).one()
        assert run.status == "FAILED"
        assert run.finished_at is not None
        assert run.pages_total == 1
        assert run.failure_code == "timeout"
        assert run.failure_message == "Сайт не ответил за отведенное время."
        failed_page = db.query(Page).filter(Page.run_id == run.id).one()
        assert failed_page.url == "https://empty.test/"
        assert failed_page.status_code == 0
        assert failed_page.fetch_error_code == "timeout"
        assert failed_page.fetch_error_message == "Сайт не ответил за отведенное время."

    app.dependency_overrides.clear()
    Base.metadata.drop_all(bind=engine)
    engine.dispose()


def test_redirect_chain_is_saved_as_friendly_page_result(monkeypatch):
    from app.api import runs as runs_api

    engine, SessionLocal = _get_session_factory()
    app.router.on_startup.clear()
    app.router.on_shutdown.clear()
    app.dependency_overrides[get_db] = _override_get_db(SessionLocal)

    with SessionLocal() as db:
        db.add(_make_user(email="redirect@test.local", role="editor", is_approved=True))
        project = Project(
            name="Redirect",
            start_url="https://redirect.test/old",
            allowed_domains_csv="redirect.test",
            max_pages=2,
        )
        db.add(project)
        db.commit()
        db.refresh(project)
        site = _add_primary_site(db, project)
        db.commit()
        project_id = project.id
        site_id = site.id

    class Hop:
        url = "https://redirect.test/old"
        status_code = 301
        headers = {"location": "/new"}

    class FinalResponse:
        url = "https://redirect.test/new"
        status_code = 200
        headers = {"content-type": "text/html"}
        text = "<html><body>new</body></html>"
        history = [Hop()]

    class FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def get(self, url: str):
            return FinalResponse()

    monkeypatch.setattr(runs_api.httpx, "Client", FakeClient)
    client = TestClient(app)
    response = client.post(
        f"/runs/start-site/{site_id}",
        headers=_auth_header("redirect@test.local", role="editor"),
    )
    assert response.status_code == 200

    with SessionLocal() as db:
        run = db.query(Run).filter(Run.project_id == project_id).one()
        page = db.query(Page).filter(Page.run_id == run.id).one()
        assert run.status == "FINISHED"
        assert page.url == "https://redirect.test/old"
        assert page.status_code == 301
        assert page.final_url == "https://redirect.test/new"
        assert page.final_status_code == 200
        assert [hop["status_code"] for hop in page.redirect_chain_json] == [301, 200]
        event = db.query(EventFeed).filter(EventFeed.event_type == "crawler.run.finished").one()
        assert event.target_user_id is None
        assert event.target_path == f"/projects/{project_id}"
        assert event.meta_json["run_id"] == run.id
        assert event.meta_json["pages_total"] == 1
        assert event.meta_json["suppress_toast"] is True

    app.dependency_overrides.clear()
    Base.metadata.drop_all(bind=engine)
    engine.dispose()


def test_page_network_failure_does_not_fail_run_with_successful_html(monkeypatch):
    from app.api import runs as runs_api

    engine, SessionLocal = _get_session_factory()
    app.router.on_startup.clear()
    app.router.on_shutdown.clear()
    app.dependency_overrides[get_db] = _override_get_db(SessionLocal)

    with SessionLocal() as db:
        db.add(_make_user(email="partial-failure@test.local", role="editor", is_approved=True))
        project = Project(
            name="Partial",
            start_url="https://partial.test/",
            allowed_domains_csv="partial.test",
            max_pages=3,
        )
        db.add(project)
        db.commit()
        db.refresh(project)
        site = _add_primary_site(db, project)
        db.commit()
        project_id = project.id
        site_id = site.id

    class SuccessResponse:
        def __init__(self, url: str):
            self.url = url
            self.status_code = 200
            self.headers = {"content-type": "text/html"}
            self.text = '<html><body><a href="/timeout">timeout</a></body></html>'
            self.history = []

    class FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def get(self, url: str):
            if url.endswith("/timeout"):
                with SessionLocal() as progress_db:
                    live_run = progress_db.query(Run).filter(Run.project_id == project_id).one()
                    persisted_pages = progress_db.query(Page).filter(Page.run_id == live_run.id).all()
                    assert live_run.status == "RUNNING"
                    assert live_run.pages_total == 1
                    assert live_run.pages_discovered == 2
                    assert live_run.current_batch_no == 1
                    assert live_run.current_url == "https://partial.test/timeout"
                    assert live_run.progress_updated_at is not None
                    assert [page.url for page in persisted_pages] == ["https://partial.test/"]
                    assert persisted_pages[0].crawl_batch_no == 1
                raise httpx.ReadTimeout("timed out", request=httpx.Request("GET", url))
            return SuccessResponse(url)

    monkeypatch.setattr(runs_api.httpx, "Client", FakeClient)
    client = TestClient(app)
    response = client.post(
        f"/runs/start-site/{site_id}",
        headers=_auth_header("partial-failure@test.local", role="editor"),
    )
    assert response.status_code == 200

    with SessionLocal() as db:
        run = db.query(Run).filter(Run.project_id == project_id).one()
        pages = db.query(Page).filter(Page.run_id == run.id).order_by(Page.id).all()
        assert run.status == "FINISHED"
        assert run.pages_total == 2
        assert run.pages_discovered == 2
        assert run.current_batch_no == 2
        assert run.current_url is None
        assert run.progress_updated_at is not None
        assert pages[0].fetch_error_code is None
        assert pages[1].url == "https://partial.test/timeout"
        assert pages[1].fetch_error_code == "timeout"

    app.dependency_overrides.clear()
    Base.metadata.drop_all(bind=engine)
    engine.dispose()


def test_fetch_failure_codes_are_stable_and_safe():
    from app.api.runs import _classify_fetch_failure

    request = httpx.Request("GET", "https://example.test")
    assert _classify_fetch_failure(httpx.ReadTimeout("secret timeout details", request=request))[0] == "timeout"
    assert _classify_fetch_failure(httpx.ConnectError("dns lookup failed", request=request))[0] == "connection_error"
    assert _classify_fetch_failure(httpx.ConnectError("TLS certificate rejected", request=request))[0] == "tls_error"
    code, message = _classify_fetch_failure(RuntimeError("secret stack value"))
    assert code == "unknown_error"
    assert "secret" not in message


def test_retry_problem_page_preserves_original_result_and_records_attempt(monkeypatch):
    from app.api import runs as runs_api

    engine, SessionLocal = _get_session_factory()
    app.router.on_startup.clear()
    app.router.on_shutdown.clear()
    app.dependency_overrides[get_db] = _override_get_db(SessionLocal)

    with SessionLocal() as db:
        db.add(_make_user(email="retry-page@test.local", role="editor", is_approved=True))
        project = Project(
            name="Retry",
            start_url="https://retry.test/",
            allowed_domains_csv="retry.test",
        )
        db.add(project)
        db.flush()
        site = _add_primary_site(db, project)
        run = Run(
            project_id=project.id,
            project_site_id=site.id,
            status="FINISHED",
            started_at=datetime.utcnow(),
            finished_at=datetime.utcnow(),
            pages_total=1,
            pages_changed=1,
        )
        db.add(run)
        db.flush()
        page = Page(
            run_id=run.id,
            url="https://retry.test/missing",
            status_code=404,
            final_url="https://retry.test/missing",
            final_status_code=404,
            content_type="text/html",
            html="",
            html_hash="",
        )
        db.add(page)
        db.commit()
        run_id = run.id
        page_id = page.id

    class SuccessResponse:
        url = "https://retry.test/missing"
        status_code = 200
        headers = {"content-type": "text/html"}
        text = "<html><body>restored</body></html>"
        history = []

    class FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def get(self, url: str):
            assert url == "https://retry.test/missing"
            return SuccessResponse()

    monkeypatch.setattr(runs_api.httpx, "Client", FakeClient)
    client = TestClient(app)
    response = client.post(
        f"/runs/{run_id}/retry-pages",
        json={"urls": ["https://retry.test/missing"]},
        headers=_auth_header("retry-page@test.local", role="editor"),
    )

    assert response.status_code == 200
    result = response.json()
    assert result["succeeded"] == 1
    assert result["failed"] == 0
    assert result["results"][0]["attempt_no"] == 1

    with SessionLocal() as db:
        original = db.get(Page, page_id)
        attempt = db.query(PageRetryAttempt).filter(PageRetryAttempt.page_id == page_id).one()
        assert original.status_code == 404
        assert original.final_status_code == 404
        assert attempt.status == "SUCCEEDED"
        assert attempt.final_status_code == 200

    app.dependency_overrides.clear()
    Base.metadata.drop_all(bind=engine)
    engine.dispose()


def test_pages_changed_counts_deleted_urls(monkeypatch):
    from app.api import runs as runs_api

    engine, SessionLocal = _get_session_factory()
    app.router.on_startup.clear()
    app.router.on_shutdown.clear()
    app.dependency_overrides[get_db] = _override_get_db(SessionLocal)

    with SessionLocal() as db:
        db.add(_make_user(email="runs-diff@test.local", role="editor", is_approved=True))
        project = Project(name="Diff", start_url="https://diff.test", allowed_domains_csv="diff.test", max_pages=1)
        db.add(project)
        db.commit()
        db.refresh(project)
        site = _add_primary_site(db, project)
        previous = Run(
            project_id=project.id,
            project_site_id=site.id,
            status="FINISHED",
            started_at=datetime.utcnow(),
            finished_at=datetime.utcnow(),
        )
        db.add(previous)
        db.commit()
        db.refresh(previous)
        db.add_all(
            [
                Page(
                    run_id=previous.id,
                    url="https://diff.test/",
                    status_code=200,
                    content_type="text/html",
                    html="same",
                    html_hash=hashlib.sha256(b"same").hexdigest(),
                ),
                Page(run_id=previous.id, url="https://diff.test/deleted", status_code=200, content_type="text/html", html="gone", html_hash="gone"),
            ]
        )
        db.commit()
        project_id = project.id
        site_id = site.id

    class FakeResponse:
        url = "https://diff.test/"
        status_code = 200
        headers = {"content-type": "text/html"}
        text = "same"

    class FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def get(self, url: str):
            return FakeResponse()

    monkeypatch.setattr(runs_api.httpx, "Client", FakeClient)
    client = TestClient(app)
    response = client.post(
        f"/runs/start-site/{site_id}",
        headers=_auth_header("runs-diff@test.local", role="editor"),
    )
    assert response.status_code == 200

    with SessionLocal() as db:
        latest = db.query(Run).filter(Run.project_id == project_id).order_by(Run.id.desc()).first()
        assert latest is not None
        assert latest.pages_changed == 1

    app.dependency_overrides.clear()
    Base.metadata.drop_all(bind=engine)
    engine.dispose()


def test_available_bulk_available_consistency():
    engine, SessionLocal = _get_session_factory()
    app.router.on_startup.clear()
    app.router.on_shutdown.clear()
    app.dependency_overrides[get_db] = _override_get_db(SessionLocal)

    with SessionLocal() as db:
        admin = _make_user(email="admin@test.local", role="admin", is_admin=True, is_approved=True)
        target = _make_user(email="pending@test.local", role="viewer", is_approved=False)
        db.add_all([admin, target])
        db.commit()
        db.refresh(target)
        target_id = target.id

    client = TestClient(app)
    available_before = client.post(
        "/admin/users/actions/available",
        json={"user_ids": [target_id]},
        headers=_auth_header("admin@test.local", role="admin"),
    )
    assert available_before.status_code == 200
    data_before = _extract_success_data(available_before)
    assert "approve" in data_before["actions"]

    bulk_response = client.post(
        "/admin/users/bulk",
        json={"user_ids": [target_id], "action": "approve", "role": "viewer", "reason": "Проверен"},
        headers=_auth_header("admin@test.local", role="admin"),
    )
    assert bulk_response.status_code == 200
    bulk_data = _extract_success_data(bulk_response)
    assert bulk_data["ok"] is True

    with SessionLocal() as db:
        updated = db.get(User, target_id)
        assert updated is not None
        assert updated.is_approved is True
        assert updated.role == "viewer"

    available_after = client.post(
        "/admin/users/actions/available",
        json={"user_ids": [target_id]},
        headers=_auth_header("admin@test.local", role="admin"),
    )
    assert available_after.status_code == 200
    data_after = _extract_success_data(available_after)
    assert "approve" not in data_after["actions"]
    assert "send_code" in data_after["actions"]

    app.dependency_overrides.clear()
    Base.metadata.drop_all(bind=engine)
    engine.dispose()


def test_root_admin_can_set_role_to_admin_via_bulk():
    prev_admin_emails = os.environ.get("ADMIN_EMAILS")
    os.environ["ADMIN_EMAILS"] = "root@test.local"
    try:
        engine, SessionLocal = _get_session_factory()
        app.router.on_startup.clear()
        app.router.on_shutdown.clear()
        app.dependency_overrides[get_db] = _override_get_db(SessionLocal)

        with SessionLocal() as db:
            root = _make_user(email="root@test.local", role="admin", is_admin=True, is_approved=True)
            target = _make_user(email="user@test.local", role="viewer", is_admin=False, is_approved=True)
            db.add_all([root, target])
            db.commit()
            db.refresh(target)
            target_id = target.id

        client = TestClient(app)
        available = client.post(
            "/admin/users/actions/available",
            json={"user_ids": [target_id]},
            headers=_auth_header("root@test.local", role="root-admin"),
        )
        assert available.status_code == 200
        available_data = _extract_success_data(available)
        assert "set_role" in available_data["actions"]

        response = client.post(
            "/admin/users/bulk",
            json={"user_ids": [target_id], "action": "set_role", "role": "admin", "reason": "Назначение администратора"},
            headers=_auth_header("root@test.local", role="root-admin"),
        )
        assert response.status_code == 200
        data = _extract_success_data(response)
        assert data["ok"] is True
        assert data["results"][0]["ok"] is True

        with SessionLocal() as db:
            updated = db.get(User, target_id)
            assert updated is not None
            assert updated.is_admin is True
            assert updated.role == "admin"
            role_log = (
                db.query(AdminAuditLog)
                .filter(AdminAuditLog.action == "set_role", AdminAuditLog.target_user_id == target_id)
                .order_by(AdminAuditLog.id.desc())
                .first()
            )
            assert role_log is not None
            assert (role_log.meta_json or {}).get("reason") == "Назначение администратора"
            role_event = (
                db.query(EventFeed)
                .filter(EventFeed.event_type == "admin.set_role", EventFeed.target_user_id == target_id)
                .order_by(EventFeed.id.desc())
                .first()
            )
            assert role_event is not None
            assert (role_event.meta_json or {}).get("action") == "set_role"
            assert (role_event.meta_json or {}).get("security") is True

        app.dependency_overrides.clear()
        Base.metadata.drop_all(bind=engine)
        engine.dispose()
    finally:
        if prev_admin_emails is None:
            os.environ.pop("ADMIN_EMAILS", None)
        else:
            os.environ["ADMIN_EMAILS"] = prev_admin_emails


def test_admin_cannot_set_role_to_admin_via_bulk():
    engine, SessionLocal = _get_session_factory()
    app.router.on_startup.clear()
    app.router.on_shutdown.clear()
    app.dependency_overrides[get_db] = _override_get_db(SessionLocal)

    with SessionLocal() as db:
        admin = _make_user(email="admin2@test.local", role="admin", is_admin=True, is_approved=True)
        target = _make_user(email="user2@test.local", role="viewer", is_admin=False, is_approved=True)
        db.add_all([admin, target])
        db.commit()
        db.refresh(target)
        target_id = target.id

    client = TestClient(app)
    available = client.post(
        "/admin/users/actions/available",
        json={"user_ids": [target_id]},
        headers=_auth_header("admin2@test.local", role="admin"),
    )
    assert available.status_code == 200
    available_data = _extract_success_data(available)
    assert "set_role" in available_data["actions"]

    response = client.post(
        "/admin/users/bulk",
        json={"user_ids": [target_id], "action": "set_role", "role": "admin", "reason": "Попытка без root"},
        headers=_auth_header("admin2@test.local", role="admin"),
    )
    assert response.status_code == 200
    data = _extract_success_data(response)
    assert data["ok"] is True
    assert data["results"][0]["ok"] is False
    assert "Only root-admin" in data["results"][0]["detail"]

    app.dependency_overrides.clear()
    Base.metadata.drop_all(bind=engine)
    engine.dispose()


def test_user_details_contains_security_context():
    engine, SessionLocal = _get_session_factory()
    app.router.on_startup.clear()
    app.router.on_shutdown.clear()
    app.dependency_overrides[get_db] = _override_get_db(SessionLocal)

    with SessionLocal() as db:
        admin = _make_user(email="admin-details@test.local", role="admin", is_admin=True, is_approved=True)
        target = _make_user(email="target-details@test.local", role="viewer", is_admin=False, is_approved=True)
        db.add_all([admin, target])
        db.commit()
        db.refresh(target)
        db.add(
            LoginHistory(
                user_id=target.id,
                email=target.email,
                ip="127.0.0.1",
                user_agent="pytest-agent",
                result="success",
                source="verify_code",
                created_at=datetime.utcnow(),
            )
        )
        db.add(
            TrustedDevice(
                user_id=target.id,
                token_hash="token-hash",
                policy="standard",
                created_at=datetime.utcnow(),
                expires_at=None,
                last_used_at=datetime.utcnow(),
                revoked_at=None,
            )
        )
        db.commit()
        target_id = target.id

    client = TestClient(app)
    response = client.get(
        f"/admin/users/{target_id}/details",
        headers=_auth_header("admin-details@test.local", role="admin"),
    )
    assert response.status_code == 200
    data = _extract_success_data(response)
    assert data["user"]["email"] == "target-details@test.local"
    assert data["user"]["last_ip"] == "127.0.0.1"
    assert isinstance(data["login_history"], list)
    assert len(data["login_history"]) >= 1
    assert isinstance(data["trusted_devices"], list)
    assert len(data["trusted_devices"]) >= 1

    app.dependency_overrides.clear()
    Base.metadata.drop_all(bind=engine)
    engine.dispose()


def test_user_sanity_endpoint_reports_exact_counts():
    engine, SessionLocal = _get_session_factory()
    app.router.on_startup.clear()
    app.router.on_shutdown.clear()
    app.dependency_overrides[get_db] = _override_get_db(SessionLocal)

    with SessionLocal() as db:
        admin = _make_user(email="admin-sanity@test.local", role="admin", is_admin=True, is_approved=True)
        target = _make_user(email="target-sanity@test.local", role="viewer", is_admin=False, is_approved=True)
        db.add_all([admin, target])
        db.commit()
        db.refresh(target)

        db.add(
            LoginHistory(
                user_id=target.id,
                email=target.email,
                ip="10.0.0.10",
                user_agent="pytest-agent-sanity",
                result="success",
                source="verify_code",
                created_at=datetime.utcnow(),
            )
        )
        db.add(
            TrustedDevice(
                user_id=target.id,
                token_hash="token-a",
                policy="standard",
                created_at=datetime.utcnow(),
                expires_at=None,
                last_used_at=datetime.utcnow(),
                revoked_at=None,
            )
        )
        db.add(
            TrustedDevice(
                user_id=target.id,
                token_hash="token-b",
                policy="standard",
                created_at=datetime.utcnow(),
                expires_at=None,
                last_used_at=datetime.utcnow(),
                revoked_at=datetime.utcnow(),
            )
        )
        db.commit()
        target_id = target.id

    client = TestClient(app)
    response = client.get(
        f"/admin/users/{target_id}/sanity",
        headers=_auth_header("admin-sanity@test.local", role="admin"),
    )
    assert response.status_code == 200
    data = _extract_success_data(response)
    assert data["user_id"] == target_id
    assert data["sources"]["trusted_devices_active_count"] == 1
    assert data["sources"]["trusted_devices_revoked_count"] == 1
    assert data["sources"]["trusted_devices_total_count"] == 2
    assert data["sources"]["login_history_total"] >= 1
    assert data["snapshot"]["trusted_devices_count"] == 1
    assert data["matches"]["trusted_devices_count"] is True

    app.dependency_overrides.clear()
    Base.metadata.drop_all(bind=engine)
    engine.dispose()


def test_settings_summary_endpoint_returns_domains():
    engine, SessionLocal = _get_session_factory()
    app.router.on_startup.clear()
    app.router.on_shutdown.clear()
    app.dependency_overrides[get_db] = _override_get_db(SessionLocal)

    with SessionLocal() as db:
        admin = _make_user(email="admin-summary@test.local", role="admin", is_admin=True, is_approved=True)
        pending = _make_user(email="pending-summary@test.local", role="viewer", is_admin=False, is_approved=False)
        db.add_all([admin, pending])
        db.commit()

    client = TestClient(app)
    response = client.get(
        "/admin/settings/summary",
        headers=_auth_header("admin-summary@test.local", role="admin"),
    )
    assert response.status_code == 200
    data = _extract_success_data(response)
    assert "pending_users" in data
    assert "root_admins" in data
    assert "events_unread" in data
    assert "audit24h" in data
    assert "monitoring" in data
    assert data["pending_users"]["source_ok"] in {True, False}
    assert data["root_admins"]["source_ok"] in {True, False}
    assert data["events_unread"]["source_ok"] in {True, False}
    assert data["audit24h"]["source_ok"] in {True, False}
    assert data["monitoring"]["source_ok"] in {True, False}

    app.dependency_overrides.clear()
    Base.metadata.drop_all(bind=engine)
    engine.dispose()


def test_settings_summary_monitoring_state_uses_history_thresholds(monkeypatch):
    from app.api import admin as admin_api

    engine, SessionLocal = _get_session_factory()
    app.router.on_startup.clear()
    app.router.on_shutdown.clear()
    app.dependency_overrides[get_db] = _override_get_db(SessionLocal)

    with SessionLocal() as db:
        db.add(_make_user(email="admin-mon-state@test.local", role="admin", is_admin=True, is_approved=True))
        db.commit()

    monkeypatch.setattr(
        admin_api,
        "get_monitoring_settings_payload",
        lambda: {
            "warn_error_delta": 1.0,
            "warn_error_rate": 5.0,
            "crit_error_delta": 3.0,
            "crit_error_rate": 15.0,
        },
    )
    monkeypatch.setattr(
        admin_api,
        "get_monitoring_history_payload",
        lambda **_: {
            "enabled": True,
            "series": {
                "http_requests": [{"ts": 1, "value": 10.0}, {"ts": 2, "value": 20.0}],
                "http_errors": [{"ts": 1, "value": 0.0}, {"ts": 2, "value": 5.0}],
            },
        },
    )

    client = TestClient(app)
    response = client.get(
        "/admin/settings/summary",
        headers=_auth_header("admin-mon-state@test.local", role="admin"),
    )
    assert response.status_code == 200
    data = _extract_success_data(response)
    assert data["monitoring"]["source_ok"] is True
    assert data["monitoring"]["state"] == "критично"

    app.dependency_overrides.clear()
    Base.metadata.drop_all(bind=engine)
    engine.dispose()


def test_users_list_include_total_false_returns_null_total():
    engine, SessionLocal = _get_session_factory()
    app.router.on_startup.clear()
    app.router.on_shutdown.clear()
    app.dependency_overrides[get_db] = _override_get_db(SessionLocal)

    with SessionLocal() as db:
        admin = _make_user(email="admin-users-total@test.local", role="admin", is_admin=True, is_approved=True)
        user = _make_user(email="user-users-total@test.local", role="viewer", is_admin=False, is_approved=True)
        db.add_all([admin, user])
        db.commit()

    client = TestClient(app)
    response = client.get(
        "/admin/users?status=all&page=1&page_size=20&include_total=false",
        headers=_auth_header("admin-users-total@test.local", role="admin"),
    )
    assert response.status_code == 200
    data = _extract_success_data(response)
    assert data["page"] == 1
    assert data["page_size"] == 20
    assert data["total"] is None
    assert isinstance(data["items"], list)
    assert len(data["items"]) >= 1

    app.dependency_overrides.clear()
    Base.metadata.drop_all(bind=engine)
    engine.dispose()


def test_audit_list_include_total_false_returns_null_total():
    engine, SessionLocal = _get_session_factory()
    app.router.on_startup.clear()
    app.router.on_shutdown.clear()
    app.dependency_overrides[get_db] = _override_get_db(SessionLocal)

    with SessionLocal() as db:
        admin = _make_user(email="admin-audit-total@test.local", role="admin", is_admin=True, is_approved=True)
        db.add(admin)
        db.commit()
        db.refresh(admin)
        db.add(
            AdminAuditLog(
                actor_user_id=admin.id,
                target_user_id=None,
                action="test_action",
                ip="127.0.0.1",
                created_at=datetime.utcnow(),
                meta_json={"reason": "integration"},
            )
        )
        db.commit()

    client = TestClient(app)
    response = client.get(
        "/admin/audit?page=1&page_size=20&include_total=false",
        headers=_auth_header("admin-audit-total@test.local", role="admin"),
    )
    assert response.status_code == 200
    data = _extract_success_data(response)
    assert data["page"] == 1
    assert data["page_size"] == 20
    assert data["total"] is None
    assert isinstance(data["items"], list)
    assert len(data["items"]) >= 1

    app.dependency_overrides.clear()
    Base.metadata.drop_all(bind=engine)
    engine.dispose()


def test_login_history_include_total_false_returns_null_total():
    engine, SessionLocal = _get_session_factory()
    app.router.on_startup.clear()
    app.router.on_shutdown.clear()
    app.dependency_overrides[get_db] = _override_get_db(SessionLocal)

    with SessionLocal() as db:
        admin = _make_user(email="admin-login-total@test.local", role="admin", is_admin=True, is_approved=True)
        db.add(admin)
        db.commit()
        db.refresh(admin)
        db.add(
            LoginHistory(
                user_id=admin.id,
                email=admin.email,
                ip="127.0.0.2",
                user_agent="pytest-login-total",
                result="success",
                source="verify_code",
                created_at=datetime.utcnow(),
            )
        )
        db.commit()

    client = TestClient(app)
    response = client.get(
        "/admin/login-history?page=1&page_size=20&include_total=false",
        headers=_auth_header("admin-login-total@test.local", role="admin"),
    )
    assert response.status_code == 200
    data = _extract_success_data(response)
    assert data["page"] == 1
    assert data["page_size"] == 20
    assert data["total"] is None
    assert isinstance(data["items"], list)
    assert len(data["items"]) >= 1

    app.dependency_overrides.clear()
    Base.metadata.drop_all(bind=engine)
    engine.dispose()


def test_users_and_root_admins_pages_have_parity_for_trusted_devices_count():
    prev_admin_emails = os.environ.get("ADMIN_EMAILS")
    os.environ["ADMIN_EMAILS"] = "root-parity@test.local"
    try:
        engine, SessionLocal = _get_session_factory()
        app.router.on_startup.clear()
        app.router.on_shutdown.clear()
        app.dependency_overrides[get_db] = _override_get_db(SessionLocal)

        with SessionLocal() as db:
            root = _make_user(email="root-parity@test.local", role="admin", is_admin=True, is_approved=True)
            db.add(root)
            db.commit()
            db.refresh(root)
            db.add(
                LoginHistory(
                    user_id=root.id,
                    email=root.email,
                    ip="10.0.0.50",
                    user_agent="pytest-root-parity",
                    result="success",
                    source="verify_code",
                    created_at=datetime.utcnow(),
                )
            )
            db.add(
                TrustedDevice(
                    user_id=root.id,
                    token_hash="root-parity-active",
                    policy="standard",
                    created_at=datetime.utcnow(),
                    expires_at=None,
                    last_used_at=datetime.utcnow(),
                    revoked_at=None,
                )
            )
            db.commit()

        client = TestClient(app)
        users_resp = client.get(
            "/admin/users?status=all&q=root-parity@test.local&page=1&page_size=20&include_total=true",
            headers=_auth_header("root-parity@test.local", role="root-admin"),
        )
        assert users_resp.status_code == 200
        users_data = _extract_success_data(users_resp)
        user_row = next((row for row in users_data["items"] if row.get("email") == "root-parity@test.local"), None)
        assert user_row is not None

        root_admins_resp = client.get(
            "/admin/settings/admin-emails?page=1&page_size=20&q=root-parity@test.local",
            headers=_auth_header("root-parity@test.local", role="root-admin"),
        )
        assert root_admins_resp.status_code == 200
        root_admins_data = _extract_success_data(root_admins_resp)
        root_row = next((row for row in root_admins_data["items"] if row.get("email") == "root-parity@test.local"), None)
        assert root_row is not None
        assert isinstance(root_row.get("profile"), dict)

        assert (root_row["profile"] or {}).get("trusted_devices_count") == user_row.get("trusted_devices_count")

        app.dependency_overrides.clear()
        Base.metadata.drop_all(bind=engine)
        engine.dispose()
    finally:
        if prev_admin_emails is None:
            os.environ.pop("ADMIN_EMAILS", None)
        else:
            os.environ["ADMIN_EMAILS"] = prev_admin_emails


def test_root_admin_can_set_role_from_admin_to_viewer_with_audit_and_event():
    prev_admin_emails = os.environ.get("ADMIN_EMAILS")
    os.environ["ADMIN_EMAILS"] = "root@test.local"
    try:
        engine, SessionLocal = _get_session_factory()
        app.router.on_startup.clear()
        app.router.on_shutdown.clear()
        app.dependency_overrides[get_db] = _override_get_db(SessionLocal)

        with SessionLocal() as db:
            root = _make_user(email="root@test.local", role="admin", is_admin=True, is_approved=True)
            target = _make_user(email="managed-admin@test.local", role="admin", is_admin=True, is_approved=True)
            db.add_all([root, target])
            db.commit()
            db.refresh(target)
            target_id = target.id

        client = TestClient(app)
        available = client.post(
            "/admin/users/actions/available",
            json={"user_ids": [target_id]},
            headers=_auth_header("root@test.local", role="root-admin"),
        )
        assert available.status_code == 200
        available_data = _extract_success_data(available)
        assert "set_role" in available_data["actions"]

        response = client.post(
            "/admin/users/bulk",
            json={"user_ids": [target_id], "action": "set_role", "role": "viewer", "reason": "Снятие повышенных прав"},
            headers=_auth_header("root@test.local", role="root-admin"),
        )
        assert response.status_code == 200
        data = _extract_success_data(response)
        assert data["ok"] is True
        assert data["results"][0]["ok"] is True

        with SessionLocal() as db:
            updated = db.get(User, target_id)
            assert updated is not None
            assert updated.is_admin is False
            assert updated.role == "viewer"
            revoke_log = (
                db.query(AdminAuditLog)
                .filter(AdminAuditLog.action == "set_role", AdminAuditLog.target_user_id == target_id)
                .order_by(AdminAuditLog.id.desc())
                .first()
            )
            assert revoke_log is not None
            assert (revoke_log.meta_json or {}).get("reason") == "Снятие повышенных прав"
            revoke_event = (
                db.query(EventFeed)
                .filter(EventFeed.event_type == "admin.set_role", EventFeed.target_user_id == target_id)
                .order_by(EventFeed.id.desc())
                .first()
            )
            assert revoke_event is not None
            assert (revoke_event.meta_json or {}).get("action") == "set_role"
            assert (revoke_event.meta_json or {}).get("security") is True

        app.dependency_overrides.clear()
        Base.metadata.drop_all(bind=engine)
        engine.dispose()
    finally:
        if prev_admin_emails is None:
            os.environ.pop("ADMIN_EMAILS", None)
        else:
            os.environ["ADMIN_EMAILS"] = prev_admin_emails


def test_error_envelope_for_missing_event():
    engine, SessionLocal = _get_session_factory()
    app.router.on_startup.clear()
    app.router.on_shutdown.clear()
    app.dependency_overrides[get_db] = _override_get_db(SessionLocal)

    with SessionLocal() as db:
        db.add(_make_user(email="admin-events@test.local", role="admin", is_admin=True, is_approved=True))
        db.commit()

    client = TestClient(app)
    response = client.post(
        "/events/999/read",
        json={"value": True},
        headers=_auth_header("admin-events@test.local", role="admin"),
    )
    assert response.status_code == 404
    payload = _extract_error_payload(response)
    assert payload["error"]["code"] == "http_404"
    assert "Event not found" in payload["error"]["message"]

    app.dependency_overrides.clear()
    Base.metadata.drop_all(bind=engine)
    engine.dispose()


def test_success_envelope_for_auth_me():
    engine, SessionLocal = _get_session_factory()
    app.router.on_startup.clear()
    app.router.on_shutdown.clear()
    app.dependency_overrides[get_db] = _override_get_db(SessionLocal)

    with SessionLocal() as db:
        db.add(_make_user(email="me@test.local", role="editor", is_approved=True))
        db.commit()

    client = TestClient(app)
    response = client.get("/auth/me", headers=_auth_header("me@test.local", role="editor"))
    assert response.status_code == 200
    data = _extract_success_data(response)
    assert data["email"] == "me@test.local"
    assert data["role"] == "editor"

    app.dependency_overrides.clear()
    Base.metadata.drop_all(bind=engine)
    engine.dispose()


def test_set_role_allows_empty_reason():
    prev_admin_emails = os.environ.get("ADMIN_EMAILS")
    os.environ["ADMIN_EMAILS"] = "root@test.local"
    try:
        engine, SessionLocal = _get_session_factory()
        app.router.on_startup.clear()
        app.router.on_shutdown.clear()
        app.dependency_overrides[get_db] = _override_get_db(SessionLocal)

        with SessionLocal() as db:
            root = _make_user(email="root@test.local", role="admin", is_admin=True, is_approved=True)
            target = _make_user(email="set-role-target@test.local", role="viewer", is_admin=False, is_approved=True)
            db.add_all([root, target])
            db.commit()
            db.refresh(target)
            target_id = target.id

        client = TestClient(app)
        response = client.post(
            "/admin/users/bulk",
            json={"user_ids": [target_id], "action": "set_role", "role": "editor"},
            headers=_auth_header("root@test.local", role="root-admin"),
        )
        assert response.status_code == 200
        data = _extract_success_data(response)
        assert data["ok"] is True
        assert data["results"][0]["ok"] is True

        with SessionLocal() as db:
            updated = db.get(User, target_id)
            assert updated is not None
            assert updated.role == "editor"

        app.dependency_overrides.clear()
        Base.metadata.drop_all(bind=engine)
        engine.dispose()
    finally:
        if prev_admin_emails is None:
            os.environ.pop("ADMIN_EMAILS", None)
        else:
            os.environ["ADMIN_EMAILS"] = prev_admin_emails


def test_remove_approve_does_not_require_reason():
    engine, SessionLocal = _get_session_factory()
    app.router.on_startup.clear()
    app.router.on_shutdown.clear()
    app.dependency_overrides[get_db] = _override_get_db(SessionLocal)

    with SessionLocal() as db:
        admin = _make_user(email="admin-remove@test.local", role="admin", is_admin=True, is_approved=True)
        target = _make_user(email="approved-remove@test.local", role="viewer", is_admin=False, is_approved=True)
        db.add_all([admin, target])
        db.commit()
        db.refresh(target)
        target_id = target.id

    client = TestClient(app)
    response = client.post(
        "/admin/users/bulk",
        json={"user_ids": [target_id], "action": "remove_approve"},
        headers=_auth_header("admin-remove@test.local", role="admin"),
    )
    assert response.status_code == 200
    data = _extract_success_data(response)
    assert data["ok"] is True
    assert data["results"][0]["ok"] is True

    with SessionLocal() as db:
        updated = db.get(User, target_id)
        assert updated is not None
        assert updated.is_approved is False

    app.dependency_overrides.clear()
    Base.metadata.drop_all(bind=engine)
    engine.dispose()


def test_update_admin_emails_remove_other_root_requires_reason():
    prev_admin_emails = os.environ.get("ADMIN_EMAILS")
    prev_admin_password = os.environ.get("ADMIN_PASSWORD")
    prev_env_file_path = os.environ.get("ENV_FILE_PATH")
    os.environ["ADMIN_EMAILS"] = "root@test.local,root2@test.local"
    os.environ["ADMIN_PASSWORD"] = "test-password"
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", delete=False) as tmp:
            tmp.write("ADMIN_EMAILS=root@test.local,root2@test.local\n")
            env_path = tmp.name
        os.environ["ENV_FILE_PATH"] = env_path

        engine, SessionLocal = _get_session_factory()
        app.router.on_startup.clear()
        app.router.on_shutdown.clear()
        app.dependency_overrides[get_db] = _override_get_db(SessionLocal)

        with SessionLocal() as db:
            root = _make_user(email="root@test.local", role="admin", is_admin=True, is_approved=True)
            root2 = _make_user(email="root2@test.local", role="admin", is_admin=True, is_approved=True)
            db.add_all([root, root2])
            db.commit()

        client = TestClient(app)
        response = client.post(
            "/admin/settings/admin-emails",
            json={"emails": ["root@test.local"], "reason": "   "},
            headers=_auth_header("root@test.local", role="root-admin"),
        )
        assert response.status_code == 400
        payload = _extract_error_payload(response)
        assert payload["error"]["code"] == "http_400"
        assert "Reason is required" in payload["error"]["message"]

        app.dependency_overrides.clear()
        Base.metadata.drop_all(bind=engine)
        engine.dispose()
    finally:
        if prev_admin_emails is None:
            os.environ.pop("ADMIN_EMAILS", None)
        else:
            os.environ["ADMIN_EMAILS"] = prev_admin_emails
        if prev_admin_password is None:
            os.environ.pop("ADMIN_PASSWORD", None)
        else:
            os.environ["ADMIN_PASSWORD"] = prev_admin_password
        if prev_env_file_path is None:
            os.environ.pop("ENV_FILE_PATH", None)
        else:
            os.environ["ENV_FILE_PATH"] = prev_env_file_path
        if "env_path" in locals() and os.path.exists(env_path):
            os.remove(env_path)


def test_update_admin_emails_noop_allows_empty_reason():
    prev_admin_emails = os.environ.get("ADMIN_EMAILS")
    prev_admin_password = os.environ.get("ADMIN_PASSWORD")
    prev_env_file_path = os.environ.get("ENV_FILE_PATH")
    os.environ["ADMIN_EMAILS"] = "root@test.local"
    os.environ["ADMIN_PASSWORD"] = "test-password"
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", delete=False) as tmp:
            tmp.write("ADMIN_EMAILS=root@test.local\n")
            env_path = tmp.name
        os.environ["ENV_FILE_PATH"] = env_path

        engine, SessionLocal = _get_session_factory()
        app.router.on_startup.clear()
        app.router.on_shutdown.clear()
        app.dependency_overrides[get_db] = _override_get_db(SessionLocal)

        with SessionLocal() as db:
            root = _make_user(email="root@test.local", role="admin", is_admin=True, is_approved=True)
            db.add(root)
            db.commit()

        client = TestClient(app)
        response = client.post(
            "/admin/settings/admin-emails",
            json={"emails": ["root@test.local"], "reason": "   "},
            headers=_auth_header("root@test.local", role="root-admin"),
        )
        assert response.status_code == 200
        data = _extract_success_data(response)
        assert data["ok"] is True
        assert data.get("reason_mode") == "optional"

        app.dependency_overrides.clear()
        Base.metadata.drop_all(bind=engine)
        engine.dispose()
    finally:
        if prev_admin_emails is None:
            os.environ.pop("ADMIN_EMAILS", None)
        else:
            os.environ["ADMIN_EMAILS"] = prev_admin_emails
        if prev_admin_password is None:
            os.environ.pop("ADMIN_PASSWORD", None)
        else:
            os.environ["ADMIN_PASSWORD"] = prev_admin_password
        if prev_env_file_path is None:
            os.environ.pop("ENV_FILE_PATH", None)
        else:
            os.environ["ENV_FILE_PATH"] = prev_env_file_path
        if "env_path" in locals() and os.path.exists(env_path):
            os.remove(env_path)
