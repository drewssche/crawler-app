import hashlib
import os
import tempfile
import threading
import time
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
from app.db.models.crawler_run_job import CrawlerRunJob
from app.db.models.event_feed import EventFeed
from app.db.models.login_history import LoginHistory
from app.db.models.project import Project
from app.db.models.project_membership import ProjectMembership
from app.db.models.project_schedule import ProjectSchedule
from app.db.models.project_site import ProjectSite
from app.db.models.page import Page
from app.db.models.page_retry_attempt import PageRetryAttempt
from app.db.models.run import Run
from app.db.models.trusted_device import TrustedDevice
from app.db.models.user import User
from app.db.session import get_db
from app.main import app
from app.services.crawl_personas import ensure_guest_persona
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


def _grant_project_role_by_email(db: Session, project: Project, email: str, role: str = "owner") -> None:
    if project.id is None:
        db.flush()
    user = db.query(User).filter(User.email == email).one()
    db.add(ProjectMembership(project_id=project.id, user_id=user.id, role=role))
    db.flush()


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


def test_event_state_actions_are_scoped_to_visible_events():
    engine, SessionLocal = _get_session_factory()
    app.router.on_startup.clear()
    app.router.on_shutdown.clear()
    app.dependency_overrides[get_db] = _override_get_db(SessionLocal)

    with SessionLocal() as db:
        owner = _make_user(email="events-owner@test.local", role="admin", is_admin=True, is_approved=True)
        other = _make_user(email="events-other@test.local", role="admin", is_admin=True, is_approved=True)
        db.add_all([owner, other])
        db.commit()
        db.refresh(owner)
        event = EventFeed(
            event_type="targeted.test",
            channel="notification",
            severity="info",
            title="Private target event",
            body="Only the target user should see this.",
            target_path="/events",
            target_ref="targeted:test",
            actor_user_id=None,
            target_user_id=owner.id,
            meta_json={},
            created_at=datetime.utcnow(),
        )
        db.add(event)
        db.commit()
        event_id = event.id

    client = TestClient(app)
    owner_headers = _auth_header("events-owner@test.local", role="admin")
    other_headers = _auth_header("events-other@test.local", role="admin")

    for action in ["read", "dismiss", "handled"]:
        hidden = client.post(f"/events/{event_id}/{action}", json={"value": True}, headers=other_headers)
        assert hidden.status_code == 404

    other_feed = client.get("/events/feed", headers=other_headers)
    assert other_feed.status_code == 200
    assert all(item["id"] != event_id for item in _extract_success_data(other_feed)["items"])

    owner_feed = client.get("/events/feed", headers=owner_headers)
    assert owner_feed.status_code == 200
    assert any(item["id"] == event_id for item in _extract_success_data(owner_feed)["items"])
    owner_read = client.post(f"/events/{event_id}/read", json={"value": True}, headers=owner_headers)
    assert owner_read.status_code == 200
    assert _extract_success_data(owner_read)["is_read"] is True

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
        _grant_project_role_by_email(db, project, "project-viewer@test.local", role="viewer")
        _grant_project_role_by_email(db, project, "project-editor@test.local", role="editor")
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
            html=(
                "<html><head><title>Protected title</title>"
                "<meta name=\"description\" content=\"Protected description\"></head>"
                "<body><h1>Protected H1</h1></body></html>"
            ),
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
    assert client.post(f"/runs/{run_id}/cancel").status_code == 401

    assert client.get(f"/projects/{project_id}", headers=viewer_headers).status_code == 200
    assert client.get(f"/runs/by-project/{project_id}", headers=viewer_headers).status_code == 200
    pages_response = client.get(f"/runs/{run_id}/pages", headers=viewer_headers)
    assert pages_response.status_code == 200
    assert pages_response.json()[0]["title"] == "Protected title"
    assert pages_response.json()[0]["description"] == "Protected description"
    assert pages_response.json()[0]["h1"] == "Protected H1"
    page_context = client.get(
        f"/runs/{run_id}/page-context",
        params={"url": "https://protected.test/"},
        headers=viewer_headers,
    )
    assert page_context.status_code == 200
    assert page_context.json()["seo"]["score"] < 100
    snapshot = client.get(
        f"/runs/{run_id}/snapshot",
        params={"url": "https://protected.test/"},
        headers=viewer_headers,
    )
    assert snapshot.status_code == 200
    assert snapshot.json()["html"] == (
        "<html><head><title>Protected title</title>"
        "<meta name=\"description\" content=\"Protected description\"></head>"
        "<body><h1>Protected H1</h1></body></html>"
    )
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
    assert client.post(f"/runs/{run_id}/cancel", headers=viewer_headers).status_code == 403
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
        client.get(f"/projects/{project_id}/sites", headers=editor_headers)
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


def test_created_project_is_visible_only_to_members_and_admins():
    engine, SessionLocal = _get_session_factory()
    app.router.on_startup.clear()
    app.router.on_shutdown.clear()
    app.dependency_overrides[get_db] = _override_get_db(SessionLocal)

    with SessionLocal() as db:
        owner = _make_user(email="member-owner@test.local", role="editor", is_approved=True)
        outsider = _make_user(email="member-outsider@test.local", role="viewer", is_approved=True)
        admin = _make_user(email="member-admin@test.local", role="admin", is_admin=True, is_approved=True)
        db.add_all([owner, outsider, admin])
        db.commit()
        owner_id = owner.id

    client = TestClient(app)
    created = client.post(
        "/projects",
        json={
            "name": "Private project",
            "start_url": "https://private-project.test/",
            "allowed_domains_csv": "private-project.test",
            "max_pages": 1,
        },
        headers=_auth_header("member-owner@test.local", role="editor"),
    )
    assert created.status_code == 200
    project_id = created.json()["id"]

    with SessionLocal() as db:
        membership = (
            db.query(ProjectMembership)
            .filter(ProjectMembership.project_id == project_id, ProjectMembership.user_id == owner_id)
            .one()
        )
        assert membership.role == "owner"

    owner_view = client.get(f"/projects/{project_id}", headers=_auth_header("member-owner@test.local", role="editor"))
    assert owner_view.status_code == 200
    outsider_view = client.get(f"/projects/{project_id}", headers=_auth_header("member-outsider@test.local", role="viewer"))
    assert outsider_view.status_code == 404
    outsider_summary = client.get("/projects/summary", headers=_auth_header("member-outsider@test.local", role="viewer"))
    assert outsider_summary.status_code == 200
    assert all(row["id"] != project_id for row in outsider_summary.json()["data"])
    admin_view = client.get(f"/projects/{project_id}", headers=_auth_header("member-admin@test.local", role="admin"))
    assert admin_view.status_code == 200

    app.dependency_overrides.clear()
    Base.metadata.drop_all(bind=engine)
    engine.dispose()


def test_project_members_management_enforces_roles_and_last_owner():
    engine, SessionLocal = _get_session_factory()
    app.router.on_startup.clear()
    app.router.on_shutdown.clear()
    app.dependency_overrides[get_db] = _override_get_db(SessionLocal)

    with SessionLocal() as db:
        owner = _make_user(email="members-owner@test.local", role="editor", is_approved=True)
        teammate = _make_user(email="members-teammate@test.local", role="editor", is_approved=True)
        outsider = _make_user(email="members-outsider@test.local", role="editor", is_approved=True)
        db.add_all([owner, teammate, outsider])
        db.commit()

    client = TestClient(app)
    owner_headers = _auth_header("members-owner@test.local", role="editor")
    teammate_headers = _auth_header("members-teammate@test.local", role="editor")
    outsider_headers = _auth_header("members-outsider@test.local", role="editor")
    created = client.post(
        "/projects",
        json={
            "name": "Project with members",
            "start_url": "https://members-project.test/",
            "allowed_domains_csv": "members-project.test",
            "max_pages": 1,
        },
        headers=owner_headers,
    )
    assert created.status_code == 200
    project_id = created.json()["id"]

    members = client.get(f"/projects/{project_id}/members", headers=owner_headers)
    assert members.status_code == 200
    members_payload = members.json()
    assert len(members_payload) == 1
    owner_member_id = members_payload[0]["id"]
    assert members_payload[0]["role"] == "owner"

    outsider_add = client.post(
        f"/projects/{project_id}/members",
        json={"email": "members-teammate@test.local", "role": "viewer"},
        headers=outsider_headers,
    )
    assert outsider_add.status_code == 404

    added = client.post(
        f"/projects/{project_id}/members",
        json={"email": "members-teammate@test.local", "role": "viewer"},
        headers=owner_headers,
    )
    assert added.status_code == 200
    teammate_member = added.json()
    teammate_member_id = teammate_member["id"]
    assert teammate_member["role"] == "viewer"

    denied_site = client.post(
        f"/projects/{project_id}/sites",
        json={
            "name": "Denied",
            "start_url": "https://denied-members-project.test/",
            "scope_mode": "whole_site",
            "path_prefix": "/",
        },
        headers=teammate_headers,
    )
    assert denied_site.status_code == 403
    assert _extract_error_payload(denied_site)["error"]["code"] == "project_membership_required"

    promoted_editor = client.patch(
        f"/projects/{project_id}/members/{teammate_member_id}",
        json={"role": "editor"},
        headers=owner_headers,
    )
    assert promoted_editor.status_code == 200
    assert promoted_editor.json()["role"] == "editor"

    allowed_site = client.post(
        f"/projects/{project_id}/sites",
        json={
            "name": "Allowed",
            "start_url": "https://allowed-members-project.test/",
            "scope_mode": "whole_site",
            "path_prefix": "/",
        },
        headers=teammate_headers,
    )
    assert allowed_site.status_code == 200

    last_owner_delete = client.delete(f"/projects/{project_id}/members/{owner_member_id}", headers=owner_headers)
    assert last_owner_delete.status_code == 409
    assert _extract_error_payload(last_owner_delete)["error"]["code"] == "last_project_owner"

    promoted_owner = client.patch(
        f"/projects/{project_id}/members/{teammate_member_id}",
        json={"role": "owner"},
        headers=owner_headers,
    )
    assert promoted_owner.status_code == 200
    assert promoted_owner.json()["role"] == "owner"

    removed_owner = client.delete(f"/projects/{project_id}/members/{owner_member_id}", headers=owner_headers)
    assert removed_owner.status_code == 200

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


def test_crawler_readiness_reports_active_runs_and_recovers_stale(monkeypatch):
    monkeypatch.setenv("CRAWL_STALE_RUNNING_SECONDS", "60")
    engine, SessionLocal = _get_session_factory()
    app.router.on_startup.clear()
    app.router.on_shutdown.clear()
    app.dependency_overrides[get_db] = _override_get_db(SessionLocal)

    with SessionLocal() as db:
        db.add_all(
            [
                _make_user(email="crawler-ready-admin@test.local", role="admin", is_admin=True, is_approved=True),
                _make_user(email="crawler-ready-viewer@test.local", role="viewer", is_approved=True),
            ]
        )
        fresh_project = Project(name="Fresh", start_url="https://fresh.test", allowed_domains_csv="fresh.test")
        stale_project = Project(name="Stale readiness", start_url="https://stale-ready.test", allowed_domains_csv="stale-ready.test")
        db.add_all([fresh_project, stale_project])
        db.commit()
        db.refresh(fresh_project)
        db.refresh(stale_project)
        fresh_site = _add_primary_site(db, fresh_project)
        stale_site = _add_primary_site(db, stale_project)
        fresh_run = Run(
            project_id=fresh_project.id,
            project_site_id=fresh_site.id,
            status="RUNNING",
            started_at=datetime.utcnow(),
            progress_updated_at=datetime.utcnow(),
            current_url="https://fresh.test/",
        )
        stale_run = Run(
            project_id=stale_project.id,
            project_site_id=stale_site.id,
            status="RUNNING",
            started_at=datetime.utcnow() - timedelta(hours=2),
            progress_updated_at=datetime.utcnow() - timedelta(hours=2),
            current_url="https://stale-ready.test/hanging",
        )
        db.add_all([fresh_run, stale_run])
        db.commit()
        fresh_run_id = fresh_run.id
        stale_run_id = stale_run.id

    client = TestClient(app)
    viewer = client.get(
        "/crawler/readiness",
        headers=_auth_header("crawler-ready-viewer@test.local", role="viewer"),
    )
    assert viewer.status_code == 403

    admin = client.get(
        "/crawler/readiness",
        headers=_auth_header("crawler-ready-admin@test.local", role="admin"),
    )
    assert admin.status_code == 200
    data = _extract_success_data(admin)
    assert data["ready"] is True
    assert data["mode"] == "synchronous"
    assert data["worker"]["enabled"] is False
    assert data["jobs"]["total_active"] == 0
    assert data["jobs"]["queued"] == 0
    assert data["jobs"]["running"] == 0
    assert data["jobs"]["sample"] == []
    assert data["stale_recovery"]["threshold_seconds"] == 60
    assert data["stale_recovery"]["recovered_runs"] == 1
    assert data["active"]["running"] == 1
    assert data["active"]["cancel_requested"] == 0
    assert [row["run_id"] for row in data["active"]["sample"]] == [fresh_run_id]
    assert data["active"]["sample"][0]["current_url"] == "https://fresh.test/"

    with SessionLocal() as db:
        recovered = db.get(Run, stale_run_id)
        assert recovered.status == "FAILED"
        assert recovered.failure_code == "stale_run_recovered"
        assert recovered.current_url is None

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
        db.add_all([
            ProjectMembership(project_id=p1.id, user_id=viewer.id, role="viewer"),
            ProjectMembership(project_id=p2.id, user_id=viewer.id, role="viewer"),
        ])
        db.refresh(p1)
        db.refresh(p2)
        p1_site = _add_primary_site(db, p1)
        p1_reference_site = build_project_site(
            project_id=p1.id,
            start_url="https://reference-a.test/",
            name="Reference A",
            scope_mode="whole_site",
            path_prefix="/",
            role="reference",
            allowed_domains_csv="",
            exclude_paths_csv="",
            exclude_ext_csv="",
            respect_robots=True,
            max_pages=100,
            concurrency=1,
            is_enabled=True,
            sort_order=1,
        )
        db.add(p1_reference_site)
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
    assert by_name["A"]["site_count"] == 2
    assert [site["start_url"] for site in by_name["A"]["sites"]] == [
        "https://a.test/",
        "https://reference-a.test/",
    ]
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
        _grant_project_role_by_email(db, project, "runs-multi@test.local")
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
    assert summaries_by_id[primary_id]["default_persona"]["session_bundle_summary"]["status"] == "not_required"
    assert summaries_by_id[primary_id]["last_run"]["id"] == primary_run_id
    assert summaries_by_id[primary_id]["last_run"]["persona"]["label"] == "Гость"
    assert summaries_by_id[primary_id]["anomaly"]["status"] == "insufficient_data"
    assert summaries_by_id[secondary_id]["runs_total"] == 1
    assert summaries_by_id[secondary_id]["last_run"]["id"] == secondary_response.json()["run_id"]
    with SessionLocal() as db:
        jobs = db.query(CrawlerRunJob).order_by(CrawlerRunJob.id.asc()).all()
        assert len(jobs) == 2
        assert [job.project_site_id for job in jobs] == [primary_id, secondary_id]
        assert [job.run_id for job in jobs] == [primary_run_id, secondary_response.json()["run_id"]]
        assert [job.status for job in jobs] == ["SUCCEEDED", "SUCCEEDED"]
        assert all(job.lease_owner == "sync-backend" for job in jobs)
        assert all(job.lease_expires_at is None for job in jobs)
        assert all(job.heartbeat_at is not None for job in jobs)
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


def test_worker_enabled_queues_and_tick_executes_site_run(monkeypatch):
    from app.api import runs as runs_api

    engine, SessionLocal = _get_session_factory()
    app.router.on_startup.clear()
    app.router.on_shutdown.clear()
    app.dependency_overrides[get_db] = _override_get_db(SessionLocal)

    with SessionLocal() as db:
        db.add(_make_user(email="worker-flow@test.local", role="admin", is_admin=True, is_approved=True))
        project = Project(name="Worker", start_url="https://worker.test", allowed_domains_csv="worker.test", max_pages=1)
        db.add(project)
        db.commit()
        db.refresh(project)
        site = _add_primary_site(db, project)
        db.commit()
        site_id = site.id

    class FakeResponse:
        def __init__(self, url: str):
            self.url = url
            self.status_code = 200
            self.headers = {"content-type": "text/html; charset=utf-8"}
            self.text = "<html><body><h1>worker ok</h1></body></html>"
            self.history = []

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
    headers = _auth_header("worker-flow@test.local", role="admin")

    disabled_tick = client.post("/runs/worker/tick", headers=headers)
    assert disabled_tick.status_code == 409
    assert _extract_error_payload(disabled_tick)["error"]["code"] == "crawler_worker_disabled"

    monkeypatch.setenv("CRAWLER_WORKER_ENABLED", "1")
    queued = client.post(f"/runs/start-site/{site_id}", headers=headers)
    assert queued.status_code == 200
    queued_payload = queued.json()
    assert queued_payload["queued"] is True
    assert queued_payload["run_id"] is None
    assert queued_payload["job_status"] == "QUEUED"
    job_id = queued_payload["job_id"]

    readiness = _extract_success_data(client.get("/crawler/readiness", headers=headers))
    assert readiness["mode"] == "worker"
    assert readiness["worker"]["enabled"] is True
    assert readiness["jobs"]["queued"] == 1
    assert readiness["jobs"]["sample"][0]["job_id"] == job_id

    active_job = client.get(f"/runs/active-job/by-site/{site_id}", headers=headers)
    assert active_job.status_code == 200
    active_job_payload = active_job.json()
    assert active_job_payload["active"] is True
    assert active_job_payload["job"]["id"] == job_id
    assert active_job_payload["job"]["status"] == "QUEUED"
    assert active_job_payload["job"]["site"]["id"] == site_id
    assert active_job_payload["site"]["id"] == site_id

    blocked = client.post(f"/runs/start-site/{site_id}", headers=headers)
    assert blocked.status_code == 409
    assert _extract_error_payload(blocked)["error"]["code"] == "site_run_already_active"

    tick = client.post("/runs/worker/tick", headers=headers)
    assert tick.status_code == 200
    tick_payload = tick.json()
    assert tick_payload["processed"] is True
    assert tick_payload["job_id"] == job_id
    assert tick_payload["status"] == "SUCCEEDED"
    assert tick_payload["run_status"] == "FINISHED"
    assert tick_payload["run_id"] is not None

    with SessionLocal() as db:
        job = db.get(CrawlerRunJob, job_id)
        assert job.status == "SUCCEEDED"
        assert job.run_id == tick_payload["run_id"]
        assert job.lease_owner == "crawler-worker"
        assert job.lease_expires_at is None
        run = db.get(Run, tick_payload["run_id"])
        assert run.status == "FINISHED"
        assert run.project_site_id == site_id

    empty_tick = client.post("/runs/worker/tick", headers=headers)
    assert empty_tick.status_code == 200
    assert empty_tick.json()["processed"] is False

    inactive_job = client.get(f"/runs/active-job/by-site/{site_id}", headers=headers)
    assert inactive_job.status_code == 200
    assert inactive_job.json()["active"] is False

    app.dependency_overrides.clear()
    Base.metadata.drop_all(bind=engine)
    engine.dispose()


def test_crawler_readiness_recovers_expired_jobs_and_reports_stale_queue(monkeypatch):
    engine, SessionLocal = _get_session_factory()
    app.router.on_startup.clear()
    app.router.on_shutdown.clear()
    app.dependency_overrides[get_db] = _override_get_db(SessionLocal)
    monkeypatch.setenv("CRAWLER_WORKER_ENABLED", "1")
    monkeypatch.setenv("CRAWLER_JOB_STALE_QUEUED_SECONDS", "60")

    now = datetime.utcnow()
    with SessionLocal() as db:
        db.add(_make_user(email="worker-readiness@test.local", role="admin", is_admin=True, is_approved=True))
        project = Project(name="Worker readiness", start_url="https://worker-readiness.test", allowed_domains_csv="worker-readiness.test")
        db.add(project)
        db.commit()
        db.refresh(project)
        site = _add_primary_site(db, project)
        run = Run(
            project_id=project.id,
            project_site_id=site.id,
            status="RUNNING",
            started_at=now - timedelta(minutes=5),
            progress_updated_at=now - timedelta(minutes=5),
            current_url=site.start_url,
        )
        db.add(run)
        db.flush()
        stale_queued = CrawlerRunJob(
            project_id=project.id,
            project_site_id=site.id,
            kind="site_run",
            status="QUEUED",
            scheduled_at=now - timedelta(minutes=3),
            created_at=now - timedelta(minutes=3),
            updated_at=now - timedelta(minutes=3),
        )
        expired_running = CrawlerRunJob(
            project_id=project.id,
            project_site_id=site.id,
            run_id=run.id,
            kind="site_run",
            status="RUNNING",
            lease_owner="crawler-worker",
            lease_expires_at=now - timedelta(seconds=30),
            attempts=1,
            scheduled_at=now - timedelta(minutes=5),
            started_at=now - timedelta(minutes=5),
            heartbeat_at=now - timedelta(minutes=5),
            created_at=now - timedelta(minutes=5),
            updated_at=now - timedelta(minutes=5),
        )
        db.add_all([stale_queued, expired_running])
        db.commit()
        run_id = run.id
        stale_queued_id = stale_queued.id
        expired_running_id = expired_running.id

    client = TestClient(app)
    headers = _auth_header("worker-readiness@test.local", role="admin")
    readiness = _extract_success_data(client.get("/crawler/readiness", headers=headers))

    assert readiness["ready"] is False
    assert readiness["status"] == "degraded"
    assert readiness["mode"] == "worker"
    assert readiness["jobs"]["recovered_expired_jobs"] == 1
    assert readiness["jobs"]["queued"] == 1
    assert readiness["jobs"]["failed"] == 1
    assert readiness["jobs"]["diagnostics"]["stale_queued"] == 1
    assert readiness["jobs"]["diagnostics"]["stale_queued_sample"][0]["job_id"] == stale_queued_id
    assert {issue["code"] for issue in readiness["issues"]} == {
        "crawler_jobs_stale_queued",
        "crawler_jobs_expired_recovered",
    }

    with SessionLocal() as db:
        run = db.get(Run, run_id)
        expired_job = db.get(CrawlerRunJob, expired_running_id)
        stale_job = db.get(CrawlerRunJob, stale_queued_id)
        assert run.status == "FAILED"
        assert run.failure_code == "crawler_job_lease_expired"
        assert run.current_url is None
        assert expired_job.status == "FAILED"
        assert expired_job.lease_expires_at is None
        assert stale_job.status == "QUEUED"

    app.dependency_overrides.clear()
    Base.metadata.drop_all(bind=engine)
    engine.dispose()


def test_worker_retries_transient_job_failure_with_backoff(monkeypatch):
    from app.api import runs as runs_api

    engine, SessionLocal = _get_session_factory()
    app.router.on_startup.clear()
    app.router.on_shutdown.clear()
    app.dependency_overrides[get_db] = _override_get_db(SessionLocal)
    monkeypatch.setenv("CRAWLER_WORKER_ENABLED", "1")
    monkeypatch.setenv("CRAWLER_JOB_MAX_ATTEMPTS", "2")
    monkeypatch.setenv("CRAWLER_JOB_RETRY_BACKOFF_SECONDS", "0")

    with SessionLocal() as db:
        db.add(_make_user(email="worker-retry@test.local", role="admin", is_admin=True, is_approved=True))
        project = Project(name="Worker retry", start_url="https://worker-retry.test", allowed_domains_csv="worker-retry.test", max_pages=1)
        db.add(project)
        db.commit()
        db.refresh(project)
        site = _add_primary_site(db, project)
        db.commit()
        site_id = site.id

    calls = {"count": 0}

    class FakeResponse:
        def __init__(self, url: str):
            self.url = url
            self.status_code = 200
            self.headers = {"content-type": "text/html; charset=utf-8"}
            self.text = "<html><body><h1>retry ok</h1></body></html>"
            self.history = []

    class FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def get(self, url: str):
            calls["count"] += 1
            if calls["count"] == 1:
                raise httpx.TimeoutException("temporary timeout")
            return FakeResponse(url)

    monkeypatch.setattr(runs_api.httpx, "Client", FakeClient)
    client = TestClient(app)
    headers = _auth_header("worker-retry@test.local", role="admin")

    queued = client.post(f"/runs/start-site/{site_id}", headers=headers)
    assert queued.status_code == 200
    job_id = queued.json()["job_id"]

    first_tick = client.post("/runs/worker/tick", headers=headers)
    assert first_tick.status_code == 200
    first_payload = first_tick.json()
    assert first_payload["processed"] is True
    assert first_payload["job_id"] == job_id
    assert first_payload["status"] == "QUEUED"
    assert first_payload["failure_code"] == "timeout"
    assert first_payload["retry"]["scheduled"] is True
    assert first_payload["retry"]["attempts"] == 1
    assert first_payload["retry"]["max_attempts"] == 2

    with SessionLocal() as db:
        job = db.get(CrawlerRunJob, job_id)
        assert job.status == "QUEUED"
        assert job.attempts == 1
        assert job.failure_code == "timeout"
        assert job.lease_expires_at is None
        failed_run = db.get(Run, first_payload["run_id"])
        assert failed_run.status == "FAILED"
        assert failed_run.failure_code == "timeout"

    second_tick = client.post("/runs/worker/tick", headers=headers)
    assert second_tick.status_code == 200
    second_payload = second_tick.json()
    assert second_payload["processed"] is True
    assert second_payload["job_id"] == job_id
    assert second_payload["status"] == "SUCCEEDED"
    assert second_payload["run_status"] == "FINISHED"

    with SessionLocal() as db:
        job = db.get(CrawlerRunJob, job_id)
        assert job.status == "SUCCEEDED"
        assert job.attempts == 2
        assert job.run_id == second_payload["run_id"]
        run = db.get(Run, second_payload["run_id"])
        assert run.status == "FINISHED"

    app.dependency_overrides.clear()
    Base.metadata.drop_all(bind=engine)
    engine.dispose()


def test_project_active_jobs_lists_all_site_jobs(monkeypatch):
    engine, SessionLocal = _get_session_factory()
    app.router.on_startup.clear()
    app.router.on_shutdown.clear()
    app.dependency_overrides[get_db] = _override_get_db(SessionLocal)
    monkeypatch.setenv("CRAWLER_WORKER_ENABLED", "1")

    with SessionLocal() as db:
        db.add(_make_user(email="project-jobs@test.local", role="admin", is_admin=True, is_approved=True))
        project = Project(name="Project jobs", start_url="https://project-jobs-a.test", allowed_domains_csv="project-jobs-a.test", max_pages=1)
        db.add(project)
        db.commit()
        db.refresh(project)
        first_site = _add_primary_site(db, project)
        second_site = build_project_site(
            project_id=project.id,
            name="Second",
            start_url="https://project-jobs-b.test/",
            scope_mode="whole_site",
            path_prefix="/",
            role="peer",
            allowed_domains_csv="project-jobs-b.test",
            exclude_paths_csv="",
            exclude_ext_csv="",
            respect_robots=True,
            max_pages=1,
            concurrency=1,
            is_enabled=True,
            sort_order=1,
        )
        db.add(second_site)
        db.commit()
        project_id = project.id
        first_site_id = first_site.id
        second_site_id = second_site.id

    client = TestClient(app)
    headers = _auth_header("project-jobs@test.local", role="admin")

    first = client.post(f"/runs/start-site/{first_site_id}", headers=headers)
    second = client.post(f"/runs/start-site/{second_site_id}", headers=headers)
    assert first.status_code == 200
    assert second.status_code == 200

    active = client.get(f"/runs/active-jobs/by-project/{project_id}", headers=headers)
    assert active.status_code == 200
    payload = active.json()
    assert payload["active"] is True
    assert payload["project_id"] == project_id
    assert payload["total"] == 2
    assert {job["project_site_id"] for job in payload["jobs"]} == {first_site_id, second_site_id}
    assert {job["status"] for job in payload["jobs"]} == {"QUEUED"}
    assert all(job["site"]["name"] for job in payload["jobs"])
    assert all(job["persona"]["label"] == "Гость" for job in payload["jobs"])

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
        _grant_project_role_by_email(db, project, "persona-editor@test.local")
        _grant_project_role_by_email(db, project, "persona-viewer@test.local", role="viewer")
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
    partner_runs_response = client.get(
        f"/runs/by-site/{site_id}?crawl_persona_id={partner['id']}",
        headers=editor_headers,
    )
    assert partner_runs_response.status_code == 200
    partner_runs = partner_runs_response.json()
    assert len(partner_runs) == 1
    assert partner_runs[0]["crawl_persona_id"] == partner["id"]
    guest_runs_response = client.get(
        f"/runs/by-site/{site_id}?crawl_persona_id={personas[0]['id']}",
        headers=editor_headers,
    )
    assert guest_runs_response.status_code == 200
    assert guest_runs_response.json() == []

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

    interactive_persona_response = client.post(
        f"/projects/{project_id}/sites/{site_id}/personas",
        json={"key": "interactive", "label": "Interactive user", "kind": "authenticated"},
        headers=editor_headers,
    )
    assert interactive_persona_response.status_code == 200
    interactive_persona = _extract_success_data(interactive_persona_response)
    interactive_capture_response = client.post(
        f"/projects/{project_id}/sites/{site_id}/personas/{interactive_persona['id']}/login-captures",
        json={"login_url": "https://persona.test/login"},
        headers=editor_headers,
    )
    assert interactive_capture_response.status_code == 200
    interactive_capture = _extract_success_data(interactive_capture_response)

    interactive_unavailable = client.post(
        f"/projects/{project_id}/sites/{site_id}/personas/{interactive_persona['id']}/login-captures/{interactive_capture['id']}/managed-session",
        json={"ttl_minutes": 30},
        headers=editor_headers,
    )
    assert interactive_unavailable.status_code == 409
    assert _extract_error_payload(interactive_unavailable)["error"]["code"] == "managed_login_capture_unavailable"

    fake_session = {
        "session_id": "session_test_123456",
        "status": "WAITING_FOR_LOGIN",
        "login_url": "https://persona.test/login",
        "final_url": "https://persona.test/account",
        "page_title": "Account",
        "created_at": datetime.utcnow().isoformat(),
        "expires_at": (datetime.utcnow() + timedelta(minutes=30)).isoformat(),
        "error_message": None,
        "values_exposed": False,
        "instructions": "Login manually.",
    }
    monkeypatch.setattr(project_sites_api, "start_managed_login_session", lambda login_url, ttl_minutes=30: fake_session)
    monkeypatch.setattr(project_sites_api, "get_managed_login_session", lambda session_id: fake_session)
    monkeypatch.setattr(
        project_sites_api,
        "capture_managed_login_session_state",
        lambda session_id: SimpleNamespace(
            storage_state={
                "cookies": [{"name": "interactive_sid", "value": "interactive-secret", "domain": "persona.test", "path": "/"}],
                "origins": [
                    {
                        "origin": "https://persona.test",
                        "localStorage": [{"name": "role", "value": "interactive-role-secret"}],
                    }
                ],
            },
            final_url="https://persona.test/account",
            page_title="Account",
        ),
    )
    interactive_session_response = client.post(
        f"/projects/{project_id}/sites/{site_id}/personas/{interactive_persona['id']}/login-captures/{interactive_capture['id']}/managed-session",
        json={"ttl_minutes": 30},
        headers=editor_headers,
    )
    assert interactive_session_response.status_code == 200
    interactive_session = _extract_success_data(interactive_session_response)
    assert interactive_session["session"]["session_id"] == "session_test_123456"
    assert interactive_session["session"]["values_exposed"] is False

    interactive_status_response = client.get(
        f"/projects/{project_id}/sites/{site_id}/personas/{interactive_persona['id']}/login-captures/{interactive_capture['id']}/managed-session/session_test_123456",
        headers=editor_headers,
    )
    assert interactive_status_response.status_code == 200
    assert _extract_success_data(interactive_status_response)["status"] == "WAITING_FOR_LOGIN"

    interactive_save_response = client.post(
        f"/projects/{project_id}/sites/{site_id}/personas/{interactive_persona['id']}/login-captures/{interactive_capture['id']}/managed-session/save",
        json={"session_id": "session_test_123456"},
        headers=editor_headers,
    )
    assert interactive_save_response.status_code == 200
    interactive_saved = _extract_success_data(interactive_save_response)
    assert interactive_saved["capture"]["status"] == "COMPLETED"
    assert interactive_saved["persona"]["has_secrets"] is True
    assert interactive_saved["persona"]["session_bundle_summary"]["cookies_count"] == 1
    assert interactive_saved["persona"]["session_bundle_summary"]["local_storage_count"] == 1
    assert "interactive-secret" not in str(interactive_saved)
    assert "interactive-role-secret" not in str(interactive_saved)

    not_ready_persona_response = client.post(
        f"/projects/{project_id}/sites/{site_id}/personas",
        json={"key": "notready", "label": "Not ready user", "kind": "authenticated"},
        headers=editor_headers,
    )
    assert not_ready_persona_response.status_code == 200
    not_ready_persona = _extract_success_data(not_ready_persona_response)
    not_ready_capture_response = client.post(
        f"/projects/{project_id}/sites/{site_id}/personas/{not_ready_persona['id']}/login-captures",
        json={"login_url": "https://persona.test/login"},
        headers=editor_headers,
    )
    assert not_ready_capture_response.status_code == 200
    not_ready_capture = _extract_success_data(not_ready_capture_response)
    monkeypatch.setattr(
        project_sites_api,
        "capture_managed_login_session_state",
        lambda session_id: SimpleNamespace(
            storage_state={"cookies": [], "origins": []},
            final_url="https://persona.test/login",
            page_title="Login",
            readiness={
                "ready": False,
                "cookies_count": 0,
                "local_storage_count": 0,
                "still_login_like": True,
                "same_host": True,
                "warnings": ["В browser state нет cookies/localStorage."],
                "values_exposed": False,
            },
        ),
    )
    not_ready_save_response = client.post(
        f"/projects/{project_id}/sites/{site_id}/personas/{not_ready_persona['id']}/login-captures/{not_ready_capture['id']}/managed-session/save",
        json={"session_id": "session_test_123456"},
        headers=editor_headers,
    )
    assert not_ready_save_response.status_code == 409
    not_ready_payload = _extract_error_payload(not_ready_save_response)
    assert not_ready_payload["error"]["code"] == "managed_login_session_not_ready"
    assert not_ready_payload["error"]["details"]["readiness"]["values_exposed"] is False

    force_save_response = client.post(
        f"/projects/{project_id}/sites/{site_id}/personas/{not_ready_persona['id']}/login-captures/{not_ready_capture['id']}/managed-session/save",
        json={"session_id": "session_test_123456", "force": True},
        headers=editor_headers,
    )
    assert force_save_response.status_code == 200
    force_saved = _extract_success_data(force_save_response)
    assert force_saved["capture"]["status"] == "COMPLETED"
    assert "В browser state нет cookies/localStorage." not in str(force_saved)

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
        _grant_project_role_by_email(db, project, "section-run@test.local")
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
        _grant_project_role_by_email(db, project, "project-run@test.local")
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


def test_project_run_skips_default_persona_without_session(monkeypatch):
    from app.api import runs as runs_api

    engine, SessionLocal = _get_session_factory()
    app.router.on_startup.clear()
    app.router.on_shutdown.clear()
    app.dependency_overrides[get_db] = _override_get_db(SessionLocal)

    with SessionLocal() as db:
        db.add(_make_user(email="project-persona-run@test.local", role="editor", is_approved=True))
        project = Project(
            name="Persona bulk",
            start_url="https://persona-bulk.test",
            allowed_domains_csv="persona-bulk.test",
            max_pages=1,
        )
        db.add(project)
        db.flush()
        _grant_project_role_by_email(db, project, "project-persona-run@test.local")
        site = _add_primary_site(db, project)
        guest = (
            db.query(CrawlPersona)
            .filter(CrawlPersona.project_site_id == site.id, CrawlPersona.key == "guest")
            .one()
        )
        guest.is_default = False
        partner = CrawlPersona(
            project_site_id=site.id,
            key="partner",
            label="Партнёр",
            kind="partner",
            is_default=True,
            is_enabled=True,
            has_secrets=False,
        )
        db.add(partner)
        db.commit()
        project_id = project.id
        site_id = site.id
        partner_id = partner.id

    class FakeClient:
        def __init__(self, *args, **kwargs):
            raise AssertionError("crawler must not fetch when default persona session is missing")

    monkeypatch.setattr(runs_api.httpx, "Client", FakeClient)
    client = TestClient(app)
    response = client.post(
        f"/runs/start-project/{project_id}",
        headers=_auth_header("project-persona-run@test.local", role="editor"),
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["sites_total"] == 1
    assert payload["finished"] == 0
    assert payload["skipped"] == 1
    result = payload["results"][0]
    assert result["project_site_id"] == site_id
    assert result["crawl_persona_id"] == partner_id
    assert result["persona_label"] == "Партнёр"
    assert result["session_required"] is True
    assert result["session_status"] == "missing"
    assert result["status"] == "SKIPPED"
    assert result["failure_code"] == "persona_session_missing"
    assert "не подключена" in result["failure_message"]

    with SessionLocal() as db:
        assert db.query(Run).filter(Run.project_site_id == site_id).count() == 0

    app.dependency_overrides.clear()
    Base.metadata.drop_all(bind=engine)
    engine.dispose()


def test_project_run_uses_browser_client_for_persona_browser_storage(monkeypatch):
    from app.api import runs as runs_api

    engine, SessionLocal = _get_session_factory()
    app.router.on_startup.clear()
    app.router.on_shutdown.clear()
    app.dependency_overrides[get_db] = _override_get_db(SessionLocal)

    with SessionLocal() as db:
        db.add(_make_user(email="browser-persona@test.local", role="editor", is_approved=True))
        project = Project(name="Browser persona", start_url="https://browser-persona.test", allowed_domains_csv="browser-persona.test")
        db.add(project)
        db.flush()
        _grant_project_role_by_email(db, project, "browser-persona@test.local")
        site = _add_primary_site(db, project)
        db.commit()
        project_id = project.id
        site_id = site.id

    class ForbiddenHttpClient:
        def __init__(self, *args, **kwargs):
            raise AssertionError("HTTP-only crawler must not be used when persona has browser storage")

    browser_states = []

    class FakeBrowserResponse:
        url = "https://browser-persona.test/account"
        status_code = 200
        headers = {"content-type": "text/html"}
        text = "<html><body>browser persona account</body></html>"
        history = []

    class FakeBrowserClient:
        def __init__(self, persona_browser_state, *args, **kwargs):
            browser_states.append(persona_browser_state)

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def get(self, url: str):
            assert url in {"https://browser-persona.test", "https://browser-persona.test/"}
            return FakeBrowserResponse()

    monkeypatch.setattr(runs_api.httpx, "Client", ForbiddenHttpClient)
    monkeypatch.setattr(runs_api, "BrowserPersonaClient", FakeBrowserClient)

    client = TestClient(app)
    editor_headers = _auth_header("browser-persona@test.local", role="editor")
    create_response = client.post(
        f"/projects/{project_id}/sites/{site_id}/personas",
        json={"key": "auth", "label": "Авторизованный", "kind": "authenticated"},
        headers=editor_headers,
    )
    assert create_response.status_code == 200
    persona = _extract_success_data(create_response)

    save_response = client.put(
        f"/projects/{project_id}/sites/{site_id}/personas/{persona['id']}/session-bundle",
        json={
            "bundle": {
                "cookies": [{"name": "sid", "value": "secret", "domain": "browser-persona.test", "path": "/"}],
                "localStorage": {"role": "partner"},
                "sessionStorage": {"tab": "private"},
            },
            "expires_at": (datetime.utcnow() + timedelta(days=1)).isoformat(),
        },
        headers=editor_headers,
    )
    assert save_response.status_code == 200

    run_response = client.post(
        f"/runs/start-site/{site_id}",
        json={"crawl_persona_id": persona["id"]},
        headers=editor_headers,
    )

    assert run_response.status_code == 200
    assert run_response.json()["persona"]["key"] == "auth"
    assert run_response.json()["crawl_runtime"] == "browser"
    assert browser_states
    assert browser_states[0]["summary"]["local_storage_count"] == 1
    assert browser_states[0]["summary"]["session_storage_count"] == 1
    assert browser_states[0]["summary"]["values_exposed"] is False

    app.dependency_overrides.clear()
    Base.metadata.drop_all(bind=engine)
    engine.dispose()


def test_project_run_reports_browser_runtime_unavailable(monkeypatch):
    from app.api import runs as runs_api
    from app.crawler.browser_fetcher import BrowserCrawlerError

    engine, SessionLocal = _get_session_factory()
    app.router.on_startup.clear()
    app.router.on_shutdown.clear()
    app.dependency_overrides[get_db] = _override_get_db(SessionLocal)

    with SessionLocal() as db:
        db.add(_make_user(email="browser-runtime@test.local", role="editor", is_approved=True))
        project = Project(name="Browser runtime", start_url="https://browser-runtime.test", allowed_domains_csv="browser-runtime.test")
        db.add(project)
        db.flush()
        _grant_project_role_by_email(db, project, "browser-runtime@test.local")
        site = _add_primary_site(db, project)
        db.commit()
        project_id = project.id
        site_id = site.id

    class BrokenBrowserClient:
        def __init__(self, *args, **kwargs):
            pass

        def __enter__(self):
            raise BrowserCrawlerError(
                "browser_runtime_unavailable",
                "Не удалось запустить browser runtime для авторизованного обхода.",
                technical_message="chromium executable missing",
            )

        def __exit__(self, exc_type, exc, tb):
            return False

    monkeypatch.setattr(runs_api, "BrowserPersonaClient", BrokenBrowserClient)

    client = TestClient(app)
    editor_headers = _auth_header("browser-runtime@test.local", role="editor")
    create_response = client.post(
        f"/projects/{project_id}/sites/{site_id}/personas",
        json={"key": "auth", "label": "Авторизованный", "kind": "authenticated"},
        headers=editor_headers,
    )
    assert create_response.status_code == 200
    persona = _extract_success_data(create_response)

    save_response = client.put(
        f"/projects/{project_id}/sites/{site_id}/personas/{persona['id']}/session-bundle",
        json={
            "bundle": {"localStorage": {"role": "partner"}},
            "expires_at": (datetime.utcnow() + timedelta(days=1)).isoformat(),
        },
        headers=editor_headers,
    )
    assert save_response.status_code == 200

    response = client.post(
        f"/runs/start-site/{site_id}",
        json={"crawl_persona_id": persona["id"]},
        headers=editor_headers,
    )

    assert response.status_code == 502
    payload = _extract_error_payload(response)
    assert payload["error"]["code"] == "browser_runtime_unavailable"
    assert payload["error"]["details"]["runtime"] == "browser"
    assert "browser runtime" in payload["error"]["message"]
    assert "chromium executable missing" not in str(payload)

    with SessionLocal() as db:
        run = db.query(Run).filter(Run.project_site_id == site_id).one()
        assert run.crawl_runtime == "browser"
        assert run.status == "FAILED"
        assert run.failure_code == "browser_runtime_unavailable"
        assert "browser runtime" in run.failure_message

    app.dependency_overrides.clear()
    Base.metadata.drop_all(bind=engine)
    engine.dispose()


def test_browser_crawl_respects_browser_page_limit(monkeypatch):
    from app.api import runs as runs_api

    engine, SessionLocal = _get_session_factory()
    app.router.on_startup.clear()
    app.router.on_shutdown.clear()
    app.dependency_overrides[get_db] = _override_get_db(SessionLocal)
    monkeypatch.setenv("CRAWL_BROWSER_MAX_PAGES", "1")

    with SessionLocal() as db:
        db.add(_make_user(email="browser-limit@test.local", role="editor", is_approved=True))
        project = Project(
            name="Browser limit",
            start_url="https://browser-limit.test",
            allowed_domains_csv="browser-limit.test",
            max_pages=10,
        )
        db.add(project)
        db.flush()
        _grant_project_role_by_email(db, project, "browser-limit@test.local")
        site = _add_primary_site(db, project)
        db.commit()
        project_id = project.id
        site_id = site.id

    class ForbiddenHttpClient:
        def __init__(self, *args, **kwargs):
            raise AssertionError("HTTP-only crawler must not be used when persona has browser storage")

    class FakeBrowserResponse:
        url = "https://browser-limit.test/"
        status_code = 200
        headers = {"content-type": "text/html"}
        text = '<html><body><a href="/a">A</a><a href="/b">B</a></body></html>'
        history = []

    class FakeBrowserClient:
        def __init__(self, *args, **kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def get(self, url: str):
            return FakeBrowserResponse()

    monkeypatch.setattr(runs_api.httpx, "Client", ForbiddenHttpClient)
    monkeypatch.setattr(runs_api, "BrowserPersonaClient", FakeBrowserClient)

    client = TestClient(app)
    editor_headers = _auth_header("browser-limit@test.local", role="editor")
    create_response = client.post(
        f"/projects/{project_id}/sites/{site_id}/personas",
        json={"key": "auth", "label": "Авторизованный", "kind": "authenticated"},
        headers=editor_headers,
    )
    assert create_response.status_code == 200
    persona = _extract_success_data(create_response)
    save_response = client.put(
        f"/projects/{project_id}/sites/{site_id}/personas/{persona['id']}/session-bundle",
        json={
            "bundle": {"localStorage": {"role": "auth"}},
            "expires_at": (datetime.utcnow() + timedelta(days=1)).isoformat(),
        },
        headers=editor_headers,
    )
    assert save_response.status_code == 200

    response = client.post(
        f"/runs/start-site/{site_id}",
        json={"crawl_persona_id": persona["id"]},
        headers=editor_headers,
    )

    assert response.status_code == 200
    with SessionLocal() as db:
        run = db.query(Run).filter(Run.project_site_id == site_id).one()
        pages = db.query(Page).filter(Page.run_id == run.id).all()
        assert run.crawl_runtime == "browser"
        assert run.pages_total == 1
        assert len(pages) == 1

    app.dependency_overrides.clear()
    Base.metadata.drop_all(bind=engine)
    engine.dispose()


def test_create_project_allows_same_scope_in_different_projects():
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
    duplicate = client.post(
        "/projects",
        json={
            "name": "Duplicate",
            "start_url": "https://example.test",
            "allowed_domains_csv": "example.test",
        },
        headers=_auth_header("projects@test.local", role="editor"),
    )
    assert duplicate.status_code == 200
    assert duplicate.json()["name"] == "Duplicate"

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


def test_editor_project_site_settings_are_limited_by_role_quota(monkeypatch):
    engine, SessionLocal = _get_session_factory()
    app.router.on_startup.clear()
    app.router.on_shutdown.clear()
    app.dependency_overrides[get_db] = _override_get_db(SessionLocal)
    monkeypatch.setenv("QUOTA_EDITOR_MAX_PAGES_PER_SITE", "2")
    monkeypatch.setenv("QUOTA_EDITOR_MAX_CONCURRENCY_PER_SITE", "1")

    with SessionLocal() as db:
        db.add(_make_user(email="quota-editor@test.local", role="editor", is_approved=True))
        project = Project(name="Quota", start_url="https://quota.test", allowed_domains_csv="quota.test", max_pages=1)
        db.add(project)
        db.commit()
        db.refresh(project)
        _grant_project_role_by_email(db, project, "quota-editor@test.local")
        _add_primary_site(db, project)
        db.commit()
        project_id = project.id

    headers = _auth_header("quota-editor@test.local", role="editor")
    client = TestClient(app)

    rejected_project = client.post(
        "/projects",
        json={
            "name": "Too big",
            "start_url": "https://too-big.test/",
            "allowed_domains_csv": "too-big.test",
            "max_pages": 3,
            "concurrency": 1,
        },
        headers=headers,
    )
    assert rejected_project.status_code == 409
    assert _extract_error_payload(rejected_project)["error"]["code"] == "quota_exceeded"

    rejected_site = client.post(
        f"/projects/{project_id}/sites",
        json={
            "name": "Too concurrent",
            "start_url": "https://quota-two.test/",
            "allowed_domains_csv": "quota-two.test",
            "max_pages": 2,
            "concurrency": 2,
        },
        headers=headers,
    )
    assert rejected_site.status_code == 409
    error = _extract_error_payload(rejected_site)["error"]
    assert error["code"] == "quota_exceeded"
    assert error["details"]["quota"] == "max_concurrency_per_site"

    app.dependency_overrides.clear()
    Base.metadata.drop_all(bind=engine)
    engine.dispose()


def test_editor_active_crawler_jobs_are_limited_by_role_quota(monkeypatch):
    engine, SessionLocal = _get_session_factory()
    app.router.on_startup.clear()
    app.router.on_shutdown.clear()
    app.dependency_overrides[get_db] = _override_get_db(SessionLocal)
    monkeypatch.setenv("QUOTA_EDITOR_MAX_ACTIVE_JOBS_PER_USER", "1")
    monkeypatch.setenv("CRAWLER_WORKER_ENABLED", "1")

    with SessionLocal() as db:
        user = _make_user(email="quota-runner@test.local", role="editor", is_approved=True)
        db.add(user)
        project = Project(name="Quota jobs", start_url="https://quota-jobs-a.test", allowed_domains_csv="quota-jobs-a.test", max_pages=1)
        db.add(project)
        db.commit()
        db.refresh(project)
        _grant_project_role_by_email(db, project, "quota-runner@test.local")
        first_site = _add_primary_site(db, project)
        second_site = build_project_site(
            project_id=project.id,
            name="Second",
            start_url="https://quota-jobs-b.test/",
            scope_mode="whole_site",
            path_prefix=None,
            role="peer",
            allowed_domains_csv="quota-jobs-b.test",
            exclude_paths_csv="",
            exclude_ext_csv="",
            respect_robots=True,
            max_pages=1,
            concurrency=1,
            is_enabled=True,
            sort_order=1,
        )
        db.add(second_site)
        db.flush()
        ensure_guest_persona(db, second_site)
        db.commit()
        first_site_id = first_site.id
        second_site_id = second_site.id

    headers = _auth_header("quota-runner@test.local", role="editor")
    client = TestClient(app)
    first = client.post(f"/runs/start-site/{first_site_id}", headers=headers)
    assert first.status_code == 200
    assert first.json()["queued"] is True

    second = client.post(f"/runs/start-site/{second_site_id}", headers=headers)
    assert second.status_code == 409
    error = _extract_error_payload(second)["error"]
    assert error["code"] == "quota_exceeded"
    assert error["details"]["quota"] == "max_active_jobs_per_user"

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
        _grant_project_role_by_email(db, first, "runs-lock@test.local")
        _grant_project_role_by_email(db, second, "runs-lock@test.local")
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


def test_stale_running_run_is_recovered_before_new_start(monkeypatch):
    from app.api import runs as runs_api

    monkeypatch.setenv("CRAWL_STALE_RUNNING_SECONDS", "60")
    engine, SessionLocal = _get_session_factory()
    app.router.on_startup.clear()
    app.router.on_shutdown.clear()
    app.dependency_overrides[get_db] = _override_get_db(SessionLocal)

    with SessionLocal() as db:
        db.add(_make_user(email="runs-stale@test.local", role="editor", is_approved=True))
        project = Project(name="Stale", start_url="https://stale.test", allowed_domains_csv="stale.test", max_pages=1)
        db.add(project)
        db.commit()
        db.refresh(project)
        _grant_project_role_by_email(db, project, "runs-stale@test.local")
        site = _add_primary_site(db, project)
        stale_run = Run(
            project_id=project.id,
            project_site_id=site.id,
            status="RUNNING",
            started_at=datetime.utcnow() - timedelta(hours=2),
            progress_updated_at=datetime.utcnow() - timedelta(hours=2),
            current_url="https://stale.test/hanging",
        )
        db.add(stale_run)
        db.commit()
        site_id = site.id
        stale_run_id = stale_run.id

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
    headers = _auth_header("runs-stale@test.local", role="editor")

    listed = client.get(f"/runs/by-site/{site_id}", headers=headers)
    assert listed.status_code == 200
    stale_payload = next(row for row in listed.json() if row["id"] == stale_run_id)
    assert stale_payload["status"] == "FAILED"
    assert stale_payload["failure_code"] == "stale_run_recovered"
    assert stale_payload["current_url"] is None

    started = client.post(f"/runs/start-site/{site_id}", headers=headers)
    assert started.status_code == 200

    with SessionLocal() as db:
        recovered = db.get(Run, stale_run_id)
        assert recovered.status == "FAILED"
        assert recovered.finished_at is not None
        assert recovered.failure_code == "stale_run_recovered"
        assert recovered.current_url is None
        latest = db.query(Run).filter(Run.project_site_id == site_id).order_by(Run.id.desc()).first()
        assert latest.id != stale_run_id
        assert latest.status == "FINISHED"

    app.dependency_overrides.clear()
    Base.metadata.drop_all(bind=engine)
    engine.dispose()


def test_cancel_run_marks_active_run_cancel_requested():
    engine, SessionLocal = _get_session_factory()
    app.router.on_startup.clear()
    app.router.on_shutdown.clear()
    app.dependency_overrides[get_db] = _override_get_db(SessionLocal)

    with SessionLocal() as db:
        db.add(_make_user(email="runs-cancel@test.local", role="editor", is_approved=True))
        project = Project(name="Cancel", start_url="https://cancel.test", allowed_domains_csv="cancel.test", max_pages=1)
        db.add(project)
        db.commit()
        db.refresh(project)
        _grant_project_role_by_email(db, project, "runs-cancel@test.local")
        site = _add_primary_site(db, project)
        run = Run(
            project_id=project.id,
            project_site_id=site.id,
            status="RUNNING",
            started_at=datetime.utcnow(),
            progress_updated_at=datetime.utcnow(),
            current_url="https://cancel.test/slow",
        )
        db.add(run)
        db.commit()
        site_id = site.id
        run_id = run.id

    client = TestClient(app)
    headers = _auth_header("runs-cancel@test.local", role="editor")

    cancelled = client.post(f"/runs/{run_id}/cancel", headers=headers)
    assert cancelled.status_code == 200
    payload = cancelled.json()
    assert payload["ok"] is True
    assert payload["run"]["status"] == "CANCEL_REQUESTED"
    assert payload["run"]["failure_code"] == "cancel_requested"
    assert "завершит текущую страницу" in payload["message"]

    repeated = client.post(f"/runs/{run_id}/cancel", headers=headers)
    assert repeated.status_code == 200
    assert repeated.json()["run"]["status"] == "CANCEL_REQUESTED"

    retry = client.post(f"/runs/{run_id}/retry-pages", json={}, headers=headers)
    assert retry.status_code == 409
    assert _extract_error_payload(retry)["error"]["code"] == "run_still_active"

    blocked_start = client.post(f"/runs/start-site/{site_id}", headers=headers)
    assert blocked_start.status_code == 409
    assert _extract_error_payload(blocked_start)["error"]["code"] == "site_run_already_active"

    app.dependency_overrides.clear()
    Base.metadata.drop_all(bind=engine)
    engine.dispose()


def test_site_run_honors_cancel_requested_between_pages(monkeypatch):
    from app.api import runs as runs_api

    engine, SessionLocal = _get_session_factory()
    app.router.on_startup.clear()
    app.router.on_shutdown.clear()
    app.dependency_overrides[get_db] = _override_get_db(SessionLocal)

    with SessionLocal() as db:
        db.add(_make_user(email="runs-cancel-loop@test.local", role="editor", is_approved=True))
        project = Project(name="Cancel loop", start_url="https://cancel-loop.test", allowed_domains_csv="cancel-loop.test", max_pages=5)
        db.add(project)
        db.commit()
        db.refresh(project)
        _grant_project_role_by_email(db, project, "runs-cancel-loop@test.local")
        site = _add_primary_site(db, project)
        db.commit()
        site_id = site.id

    class FakeResponse:
        def __init__(self, url: str):
            self.url = url
            self.status_code = 200
            self.headers = {"content-type": "text/html"}
            self.text = '<html><body><a href="/next">next</a></body></html>'

    class FakeClient:
        def __init__(self, *args, **kwargs):
            self.calls = 0

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def get(self, url: str):
            self.calls += 1
            if self.calls == 1:
                with SessionLocal() as db:
                    run = db.query(Run).filter(Run.project_site_id == site_id, Run.status == "RUNNING").one()
                    run.status = "CANCEL_REQUESTED"
                    run.failure_code = "cancel_requested"
                    run.failure_message = "Остановка запрошена."
                    run.progress_updated_at = datetime.utcnow()
                    db.commit()
            return FakeResponse(url)

    monkeypatch.setattr(runs_api.httpx, "Client", FakeClient)
    client = TestClient(app)
    response = client.post(
        f"/runs/start-site/{site_id}",
        headers=_auth_header("runs-cancel-loop@test.local", role="editor"),
    )
    assert response.status_code == 200
    run_id = response.json()["run_id"]

    with SessionLocal() as db:
        run = db.get(Run, run_id)
        assert run.status == "CANCELLED"
        assert run.failure_code == "cancelled_by_user"
        assert run.finished_at is not None
        assert run.current_url is None
        assert db.query(Page).filter(Page.run_id == run_id).count() == 1

    app.dependency_overrides.clear()
    Base.metadata.drop_all(bind=engine)
    engine.dispose()


def test_site_run_interrupts_inflight_fetch_after_cancel(monkeypatch):
    from app.api import runs as runs_api

    engine, SessionLocal = _get_session_factory()
    app.router.on_startup.clear()
    app.router.on_shutdown.clear()
    app.dependency_overrides[get_db] = _override_get_db(SessionLocal)
    monkeypatch.setattr(runs_api, "SessionLocal", SessionLocal)

    with SessionLocal() as db:
        db.add(_make_user(email="runs-cancel-fetch@test.local", role="editor", is_approved=True))
        project = Project(name="Cancel fetch", start_url="https://cancel-fetch.test", allowed_domains_csv="cancel-fetch.test", max_pages=5)
        db.add(project)
        db.commit()
        db.refresh(project)
        _grant_project_role_by_email(db, project, "runs-cancel-fetch@test.local")
        site = _add_primary_site(db, project)
        db.commit()
        site_id = site.id

    class BlockingClient:
        def __init__(self, *args, **kwargs):
            self.closed = threading.Event()
            self.cancel_started = False

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def close(self):
            self.closed.set()

        def get(self, url: str):
            if not self.cancel_started:
                self.cancel_started = True

                def request_cancel():
                    time.sleep(0.1)
                    with SessionLocal() as db:
                        run = db.query(Run).filter(Run.project_site_id == site_id, Run.status == "RUNNING").one()
                        run.status = "CANCEL_REQUESTED"
                        run.failure_code = "cancel_requested"
                        run.failure_message = "Остановка запрошена."
                        run.progress_updated_at = datetime.utcnow()
                        db.commit()

                threading.Thread(target=request_cancel, daemon=True).start()
            if not self.closed.wait(timeout=2.0):
                raise httpx.ReadTimeout("timed out", request=httpx.Request("GET", url))
            raise httpx.ReadError("client closed", request=httpx.Request("GET", url))

    monkeypatch.setattr(runs_api.httpx, "Client", BlockingClient)
    client = TestClient(app)
    response = client.post(
        f"/runs/start-site/{site_id}",
        headers=_auth_header("runs-cancel-fetch@test.local", role="editor"),
    )
    assert response.status_code == 200
    run_id = response.json()["run_id"]

    with SessionLocal() as db:
        run = db.get(Run, run_id)
        assert run.status == "CANCELLED"
        assert run.failure_code == "cancelled_by_user"
        assert run.finished_at is not None
        assert run.current_url is None
        assert db.query(Page).filter(Page.run_id == run_id).count() == 0

    app.dependency_overrides.clear()
    Base.metadata.drop_all(bind=engine)
    engine.dispose()


def test_scan_retention_keeps_latest_and_previous_raw_artifacts(monkeypatch, tmp_path):
    from app.services.scan_retention import prune_site_persona_raw_artifacts

    engine, SessionLocal = _get_session_factory()
    app.router.on_startup.clear()
    app.router.on_shutdown.clear()
    monkeypatch.setenv("RENDERED_SNAPSHOT_DIR", str(tmp_path))

    with SessionLocal() as db:
        project = Project(name="Retention", start_url="https://retention.test", allowed_domains_csv="retention.test")
        db.add(project)
        db.commit()
        db.refresh(project)
        site = _add_primary_site(db, project)
        persona = db.query(CrawlPersona).filter(CrawlPersona.project_site_id == site.id).first()
        run_ids = []
        page_ids = []
        for index in range(3):
            run = Run(
                project_id=project.id,
                project_site_id=site.id,
                crawl_persona_id=persona.id if persona else None,
                status="FINISHED",
                pages_total=1,
                pages_changed=index + 1,
                pages_discovered=1,
                finished_at=datetime.utcnow() + timedelta(seconds=index),
            )
            db.add(run)
            db.flush()
            page = Page(
                run_id=run.id,
                url=f"https://retention.test/{index}",
                status_code=200,
                content_type="text/html",
                html=f"<html><body>run {index}</body></html>",
                html_hash=f"hash-{index}",
            )
            db.add(page)
            db.flush()
            run_ids.append(run.id)
            page_ids.append(page.id)
            artifact_dir = tmp_path / str(run.id)
            artifact_dir.mkdir()
            (artifact_dir / "snapshot.jpeg").write_bytes(b"jpeg")
            (artifact_dir / "snapshot.json").write_text("{}", encoding="utf-8")
        db.commit()

        result = prune_site_persona_raw_artifacts(
            db,
            project_site_id=site.id,
            crawl_persona_id=persona.id if persona else None,
            keep_successful_runs=2,
        )
        db.commit()

        assert result == {"pruned_runs": 1, "pruned_pages": 1, "kept_runs": 2}
        oldest_page = db.get(Page, page_ids[0])
        middle_page = db.get(Page, page_ids[1])
        latest_page = db.get(Page, page_ids[2])
        assert oldest_page.html == ""
        assert oldest_page.html_hash == "hash-0"
        assert middle_page.html == "<html><body>run 1</body></html>"
        assert latest_page.html == "<html><body>run 2</body></html>"
        assert db.get(Run, run_ids[0]).pages_total == 1
        assert db.get(Run, run_ids[0]).pages_changed == 1
        assert not (tmp_path / str(run_ids[0])).exists()
        assert (tmp_path / str(run_ids[1])).exists()
        assert (tmp_path / str(run_ids[2])).exists()

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
        _grant_project_role_by_email(db, project, "runs-empty@test.local")
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
        _grant_project_role_by_email(db, project, "redirect@test.local")
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
        _grant_project_role_by_email(db, project, "partial-failure@test.local")
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


def test_managed_login_session_payload_explains_headless_bridge(monkeypatch):
    from app.crawler.login_capture import ManagedLoginSession, _session_public_payload

    monkeypatch.setenv("CRAWL_PERSONA_MANAGED_LOGIN_CAPTURE_HEADLESS", "1")
    session = ManagedLoginSession(
        session_id="session_headless",
        login_url="https://example.test/login",
        status="WAITING_FOR_LOGIN",
        created_at=datetime.utcnow(),
        expires_at=datetime.utcnow() + timedelta(minutes=30),
        launch_mode="headless",
    )

    payload = _session_public_payload(session)

    assert payload["interactive_window_available"] is False
    assert payload["environment"]["launch_mode"] == "headless"
    assert payload["environment"]["recommended_env"]["CRAWL_PERSONA_MANAGED_LOGIN_CAPTURE_HEADLESS"] == "0"
    assert "MFA/2FA" in payload["instructions"]
    assert "cookies" in payload["instructions"]
    assert payload["values_exposed"] is False


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
        _grant_project_role_by_email(db, project, "retry-page@test.local")
        site = _add_primary_site(db, project)
        guest = (
            db.query(CrawlPersona)
            .filter(CrawlPersona.project_site_id == site.id, CrawlPersona.key == "guest")
            .one()
        )
        run = Run(
            project_id=project.id,
            project_site_id=site.id,
            crawl_persona_id=guest.id,
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
    assert result["persona"]["key"] == "guest"
    assert result["session_status"] == "not_required"
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


def test_retry_problem_page_requires_active_persona_session(monkeypatch):
    from app.api import runs as runs_api

    engine, SessionLocal = _get_session_factory()
    app.router.on_startup.clear()
    app.router.on_shutdown.clear()
    app.dependency_overrides[get_db] = _override_get_db(SessionLocal)

    with SessionLocal() as db:
        db.add(_make_user(email="retry-persona@test.local", role="editor", is_approved=True))
        project = Project(
            name="Retry persona",
            start_url="https://retry-persona.test/",
            allowed_domains_csv="retry-persona.test",
        )
        db.add(project)
        db.flush()
        _grant_project_role_by_email(db, project, "retry-persona@test.local")
        site = _add_primary_site(db, project)
        partner = CrawlPersona(
            project_site_id=site.id,
            key="partner",
            label="Партнёр",
            kind="partner",
            is_default=False,
            is_enabled=True,
            has_secrets=False,
        )
        db.add(partner)
        db.flush()
        run = Run(
            project_id=project.id,
            project_site_id=site.id,
            crawl_persona_id=partner.id,
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
            url="https://retry-persona.test/partner-only",
            status_code=403,
            final_url="https://retry-persona.test/partner-only",
            final_status_code=403,
            content_type="text/html",
            html="",
            html_hash="",
        )
        db.add(page)
        db.commit()
        run_id = run.id
        page_id = page.id
        persona_id = partner.id

    class FakeClient:
        def __init__(self, *args, **kwargs):
            raise AssertionError("retry must not fetch when persona session is missing")

    monkeypatch.setattr(runs_api.httpx, "Client", FakeClient)
    client = TestClient(app)
    response = client.post(
        f"/runs/{run_id}/retry-pages",
        json={"urls": ["https://retry-persona.test/partner-only"]},
        headers=_auth_header("retry-persona@test.local", role="editor"),
    )

    assert response.status_code == 409
    payload = _extract_error_payload(response)
    assert payload["error"]["code"] == "persona_session_missing"
    assert payload["error"]["details"]["crawl_persona_id"] == persona_id
    assert payload["error"]["details"]["persona_label"] == "Партнёр"
    assert payload["error"]["details"]["session_status"] == "missing"

    with SessionLocal() as db:
        assert db.query(PageRetryAttempt).filter(PageRetryAttempt.page_id == page_id).count() == 0

    app.dependency_overrides.clear()
    Base.metadata.drop_all(bind=engine)
    engine.dispose()


def test_retry_problem_page_uses_browser_runtime_for_browser_persona(monkeypatch):
    from app.api import runs as runs_api

    engine, SessionLocal = _get_session_factory()
    app.router.on_startup.clear()
    app.router.on_shutdown.clear()
    app.dependency_overrides[get_db] = _override_get_db(SessionLocal)

    with SessionLocal() as db:
        db.add(_make_user(email="retry-browser@test.local", role="editor", is_approved=True))
        project = Project(
            name="Retry browser",
            start_url="https://retry-browser.test/",
            allowed_domains_csv="retry-browser.test",
        )
        db.add(project)
        db.flush()
        _grant_project_role_by_email(db, project, "retry-browser@test.local")
        site = _add_primary_site(db, project)
        db.commit()
        project_id = project.id
        site_id = site.id

    class ForbiddenHttpClient:
        def __init__(self, *args, **kwargs):
            raise AssertionError("retry must use browser client when persona has browser storage")

    browser_urls = []

    class FakeBrowserResponse:
        url = "https://retry-browser.test/private"
        status_code = 200
        headers = {"content-type": "text/html"}
        text = "<html><body>restored in browser</body></html>"
        history = []

    class FakeBrowserClient:
        def __init__(self, persona_browser_state, *args, **kwargs):
            assert persona_browser_state["summary"]["local_storage_count"] == 1

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def get(self, url: str):
            browser_urls.append(url)
            return FakeBrowserResponse()

    monkeypatch.setattr(runs_api.httpx, "Client", ForbiddenHttpClient)
    monkeypatch.setattr(runs_api, "BrowserPersonaClient", FakeBrowserClient)

    client = TestClient(app)
    editor_headers = _auth_header("retry-browser@test.local", role="editor")
    create_response = client.post(
        f"/projects/{project_id}/sites/{site_id}/personas",
        json={"key": "auth", "label": "Авторизованный", "kind": "authenticated"},
        headers=editor_headers,
    )
    assert create_response.status_code == 200
    persona = _extract_success_data(create_response)
    save_response = client.put(
        f"/projects/{project_id}/sites/{site_id}/personas/{persona['id']}/session-bundle",
        json={
            "bundle": {"localStorage": {"role": "auth"}},
            "expires_at": (datetime.utcnow() + timedelta(days=1)).isoformat(),
        },
        headers=editor_headers,
    )
    assert save_response.status_code == 200

    with SessionLocal() as db:
        run = Run(
            project_id=project_id,
            project_site_id=site_id,
            crawl_persona_id=persona["id"],
            crawl_runtime="browser",
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
            url="https://retry-browser.test/private",
            status_code=500,
            final_url="https://retry-browser.test/private",
            final_status_code=500,
            content_type="text/html",
            html="",
            html_hash="",
        )
        db.add(page)
        db.commit()
        run_id = run.id
        page_id = page.id

    response = client.post(
        f"/runs/{run_id}/retry-pages",
        json={"urls": ["https://retry-browser.test/private"]},
        headers=editor_headers,
    )

    assert response.status_code == 200
    result = response.json()
    assert result["crawl_runtime"] == "browser"
    assert result["succeeded"] == 1
    assert browser_urls == ["https://retry-browser.test/private"]

    with SessionLocal() as db:
        attempt = db.query(PageRetryAttempt).filter(PageRetryAttempt.page_id == page_id).one()
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
        _grant_project_role_by_email(db, project, "runs-diff@test.local")
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
    assert "quota_overview" in data
    assert "storage_budget" in data
    assert data["pending_users"]["source_ok"] in {True, False}
    assert data["root_admins"]["source_ok"] in {True, False}
    assert data["events_unread"]["source_ok"] in {True, False}
    assert data["audit24h"]["source_ok"] in {True, False}
    assert data["monitoring"]["source_ok"] in {True, False}
    assert data["quota_overview"]["source_ok"] is True
    quota_roles = {row["role"]: row for row in data["quota_overview"]["roles"]}
    assert {"viewer", "editor", "admin", "root-admin"} <= set(quota_roles)
    assert quota_roles["editor"]["max_projects"] >= 1
    assert data["storage_budget"]["source_ok"] is True
    assert data["storage_budget"]["retention"]["raw_artifact_runs_to_keep"] >= 1
    assert data["storage_budget"]["totals"]["projects"] >= 0

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


def test_emergency_root_admin_is_runtime_protected_and_hidden_from_default_users_list():
    prev_admin_emails = os.environ.get("ADMIN_EMAILS")
    prev_emergency_email = os.environ.get("EMERGENCY_ROOT_ADMIN_EMAIL")
    prev_admin_password = os.environ.get("ADMIN_PASSWORD")
    prev_env_file_path = os.environ.get("ENV_FILE_PATH")
    os.environ["ADMIN_EMAILS"] = "root@test.local"
    os.environ["EMERGENCY_ROOT_ADMIN_EMAIL"] = "breakglass@test.local"
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
            emergency = _make_user(email="breakglass@test.local", role="admin", is_admin=True, is_approved=True)
            regular = _make_user(email="regular@test.local", role="viewer", is_approved=True)
            db.add_all([root, emergency, regular])
            db.commit()

        client = TestClient(app)

        settings = client.get(
            "/admin/settings/admin-emails?page=1&page_size=20",
            headers=_auth_header("root@test.local", role="root-admin"),
        )
        assert settings.status_code == 200
        settings_data = _extract_success_data(settings)
        rows = {row["email"]: row for row in settings_data["items"]}
        assert rows["breakglass@test.local"]["is_emergency"] is True

        default_users = client.get(
            "/admin/users?status=all",
            headers=_auth_header("root@test.local", role="root-admin"),
        )
        assert default_users.status_code == 200
        assert "breakglass@test.local" not in [row["email"] for row in _extract_success_data(default_users)]

        direct_lookup = client.get(
            "/admin/users?status=all&q=breakglass@test.local",
            headers=_auth_header("root@test.local", role="root-admin"),
        )
        assert direct_lookup.status_code == 200
        lookup_rows = _extract_success_data(direct_lookup)
        assert lookup_rows[0]["email"] == "breakglass@test.local"
        assert lookup_rows[0]["is_emergency_root_admin"] is True

        remove_attempt = client.post(
            "/admin/settings/admin-emails",
            json={"emails": ["root@test.local"], "reason": "Проверка защиты аварийного доступа"},
            headers=_auth_header("root@test.local", role="root-admin"),
        )
        assert remove_attempt.status_code == 400
        payload = _extract_error_payload(remove_attempt)
        assert payload["error"]["code"] == "emergency_root_admin_protected"

        with open(env_path, encoding="utf-8") as fh:
            assert "breakglass@test.local" not in fh.read()

        app.dependency_overrides.clear()
        Base.metadata.drop_all(bind=engine)
        engine.dispose()
    finally:
        if prev_admin_emails is None:
            os.environ.pop("ADMIN_EMAILS", None)
        else:
            os.environ["ADMIN_EMAILS"] = prev_admin_emails
        if prev_emergency_email is None:
            os.environ.pop("EMERGENCY_ROOT_ADMIN_EMAIL", None)
        else:
            os.environ["EMERGENCY_ROOT_ADMIN_EMAIL"] = prev_emergency_email
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


def test_project_schedule_contract_save_pause_resume_and_validate():
    engine, SessionLocal = _get_session_factory()
    app.router.on_startup.clear()
    app.router.on_shutdown.clear()
    app.dependency_overrides[get_db] = _override_get_db(SessionLocal)

    with SessionLocal() as db:
        db.add(_make_user(email="schedule-owner@test.local", role="editor", is_approved=True))
        project = Project(name="Scheduled project", start_url="https://scheduled.test")
        db.add(project)
        db.flush()
        _grant_project_role_by_email(db, project, "schedule-owner@test.local")
        _add_primary_site(db, project)
        db.commit()
        project_id = project.id

    client = TestClient(app)
    headers = _auth_header("schedule-owner@test.local", role="editor")

    empty = client.get(f"/projects/{project_id}/schedule", headers=headers)
    assert empty.status_code == 200
    assert empty.json()["is_enabled"] is False
    assert empty.json()["next_run_at"] is None

    saved = client.put(
        f"/projects/{project_id}/schedule",
        json={
            "is_enabled": True,
            "frequency": "weekly",
            "time_of_day": "10:30",
            "weekdays": [0, 2, 4],
            "timezone": "Europe/Minsk",
        },
        headers=headers,
    )
    assert saved.status_code == 200
    schedule = saved.json()
    assert schedule["is_enabled"] is True
    assert schedule["frequency"] == "weekly"
    assert schedule["time_of_day"] == "10:30"
    assert schedule["weekdays"] == [0, 2, 4]
    assert schedule["timezone"] == "Europe/Minsk"
    assert schedule["next_run_at"] is not None

    invalid = client.put(
        f"/projects/{project_id}/schedule",
        json={
            "is_enabled": True,
            "frequency": "weekly",
            "time_of_day": "10:30",
            "weekdays": [],
            "timezone": "Mars/Base",
        },
        headers=headers,
    )
    assert invalid.status_code == 422

    paused = client.post(f"/projects/{project_id}/schedule/pause", headers=headers)
    assert paused.status_code == 200
    assert paused.json()["is_enabled"] is False
    assert paused.json()["next_run_at"] is None
    assert paused.json()["paused_at"] is not None

    resumed = client.post(f"/projects/{project_id}/schedule/resume", headers=headers)
    assert resumed.status_code == 200
    assert resumed.json()["is_enabled"] is True
    assert resumed.json()["next_run_at"] is not None

    app.dependency_overrides.clear()
    Base.metadata.drop_all(bind=engine)
    engine.dispose()


def test_due_project_schedule_enqueues_jobs_once_and_moves_next_run():
    engine, SessionLocal = _get_session_factory()
    app.router.on_startup.clear()
    app.router.on_shutdown.clear()
    app.dependency_overrides[get_db] = _override_get_db(SessionLocal)

    with SessionLocal() as db:
        db.add(_make_user(email="schedule-run@test.local", role="admin", is_approved=True))
        project = Project(name="Due schedule", start_url="https://due-schedule.test")
        db.add(project)
        db.flush()
        _grant_project_role_by_email(db, project, "schedule-run@test.local")
        site = _add_primary_site(db, project)
        due_at = datetime.utcnow() - timedelta(minutes=1)
        db.add(
            ProjectSchedule(
                project_id=project.id,
                is_enabled=True,
                frequency="daily",
                time_of_day="09:00",
                timezone="UTC",
                next_run_at=due_at,
                updated_by_user_id=db.query(User).filter(User.email == "schedule-run@test.local").one().id,
            )
        )
        db.commit()
        project_id = project.id
        site_id = site.id

    client = TestClient(app)
    response = client.post(
        "/projects/schedules/run-due",
        headers=_auth_header("schedule-run@test.local", role="admin"),
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["checked"] == 1
    assert payload["results"][0]["enqueued"] == 1
    assert payload["results"][0]["skipped"] is None

    with SessionLocal() as db:
        jobs = db.query(CrawlerRunJob).filter(CrawlerRunJob.project_site_id == site_id).all()
        assert len(jobs) == 1
        assert jobs[0].status == "QUEUED"
        schedule = db.query(ProjectSchedule).filter(ProjectSchedule.project_id == project_id).one()
        assert schedule.next_run_at is not None
        assert schedule.next_run_at > due_at

    duplicate = client.post(
        "/projects/schedules/run-due",
        headers=_auth_header("schedule-run@test.local", role="admin"),
    )
    assert duplicate.status_code == 200
    assert duplicate.json()["checked"] == 0

    app.dependency_overrides.clear()
    Base.metadata.drop_all(bind=engine)
    engine.dispose()


def test_due_project_schedule_skips_when_project_has_active_job():
    engine, SessionLocal = _get_session_factory()
    app.router.on_startup.clear()
    app.router.on_shutdown.clear()
    app.dependency_overrides[get_db] = _override_get_db(SessionLocal)

    with SessionLocal() as db:
        db.add(_make_user(email="schedule-skip@test.local", role="admin", is_approved=True))
        project = Project(name="Skip active", start_url="https://skip-active.test")
        db.add(project)
        db.flush()
        _grant_project_role_by_email(db, project, "schedule-skip@test.local")
        site = _add_primary_site(db, project)
        due_at = datetime.utcnow() - timedelta(minutes=1)
        db.add(
            CrawlerRunJob(
                project_id=project.id,
                project_site_id=site.id,
                kind="site_run",
                status="QUEUED",
                scheduled_at=due_at,
                created_at=due_at,
                updated_at=due_at,
            )
        )
        db.add(
            ProjectSchedule(
                project_id=project.id,
                is_enabled=True,
                frequency="daily",
                time_of_day="09:00",
                timezone="UTC",
                next_run_at=due_at,
            )
        )
        db.commit()
        project_id = project.id
        site_id = site.id

    client = TestClient(app)
    response = client.post(
        "/projects/schedules/run-due",
        headers=_auth_header("schedule-skip@test.local", role="admin"),
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["checked"] == 1
    assert payload["results"][0]["enqueued"] == 0
    assert payload["results"][0]["skipped"] == "active_run_or_job"

    with SessionLocal() as db:
        assert db.query(CrawlerRunJob).filter(CrawlerRunJob.project_site_id == site_id).count() == 1
        schedule = db.query(ProjectSchedule).filter(ProjectSchedule.project_id == project_id).one()
        assert schedule.last_skip_reason == "active_run_or_job"
        assert schedule.next_run_at > due_at

    app.dependency_overrides.clear()
    Base.metadata.drop_all(bind=engine)
    engine.dispose()


def test_worker_schedule_tick_enqueues_due_project_schedule(monkeypatch):
    from app.worker.crawler_worker import maybe_run_due_schedules

    engine, SessionLocal = _get_session_factory()
    app.router.on_startup.clear()
    app.router.on_shutdown.clear()
    app.dependency_overrides[get_db] = _override_get_db(SessionLocal)
    monkeypatch.setenv("CRAWLER_SCHEDULES_ENABLED", "true")
    monkeypatch.setenv("CRAWLER_SCHEDULE_POLL_SECONDS", "30")

    with SessionLocal() as db:
        db.add(_make_user(email="schedule-worker@test.local", role="admin", is_approved=True))
        project = Project(name="Worker due schedule", start_url="https://worker-schedule.test")
        db.add(project)
        db.flush()
        _grant_project_role_by_email(db, project, "schedule-worker@test.local")
        site = _add_primary_site(db, project)
        due_at = datetime.utcnow() - timedelta(minutes=1)
        db.add(
            ProjectSchedule(
                project_id=project.id,
                is_enabled=True,
                frequency="daily",
                time_of_day="09:00",
                timezone="UTC",
                next_run_at=due_at,
            )
        )
        db.commit()
        site_id = site.id

    with SessionLocal() as db:
        last_checked, result = maybe_run_due_schedules(db, last_schedule_check_at=0.0, now_monotonic=100.0)
        assert last_checked == 100.0
        assert result is not None
        assert result["checked"] == 1

    with SessionLocal() as db:
        assert db.query(CrawlerRunJob).filter(CrawlerRunJob.project_site_id == site_id).count() == 1
        last_checked, skipped = maybe_run_due_schedules(db, last_schedule_check_at=100.0, now_monotonic=110.0)
        assert last_checked == 100.0
        assert skipped is None

    app.dependency_overrides.clear()
    Base.metadata.drop_all(bind=engine)
    engine.dispose()
