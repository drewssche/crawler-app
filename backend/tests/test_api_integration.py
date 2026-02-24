import os
import tempfile
from collections.abc import Generator
from datetime import datetime

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.security import create_access_token
from app.db import models  # noqa: F401
from app.db.base import Base
from app.db.models.admin_audit_log import AdminAuditLog
from app.db.models.event_feed import EventFeed
from app.db.models.login_history import LoginHistory
from app.db.models.trusted_device import TrustedDevice
from app.db.models.user import User
from app.db.session import get_db
from app.main import app


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
