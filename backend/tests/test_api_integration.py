import os
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
