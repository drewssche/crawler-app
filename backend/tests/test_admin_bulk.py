from datetime import datetime, timezone

from app.db.models.trusted_device import TrustedDevice
from app.db.models.user import User
from app.services.admin_bulk import (
    ACTION_CATALOG,
    BulkActionPayload,
    available_actions_for_user,
    available_actions_for_users,
    execute_bulk_action_for_user,
)


def _now_naive():
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _make_user(
    *,
    email: str,
    is_admin: bool = False,
    is_approved: bool = False,
    is_blocked: bool = False,
    role: str = "viewer",
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
        token_version=0,
    )


def test_available_actions_for_pending_user():
    user = _make_user(email="pending@example.com", is_approved=False, is_blocked=False)
    assert available_actions_for_user(user) == {"approve", "block", "delete_soft", "delete_hard"}


def test_available_actions_for_approved_user():
    user = _make_user(email="approved@example.com", is_approved=True, is_blocked=False)
    assert available_actions_for_user(user) == {
        "remove_approve",
        "revoke_sessions",
        "revoke_trusted_devices",
        "set_trust_policy",
        "set_role",
        "send_code",
        "block",
        "delete_soft",
        "delete_hard",
    }


def test_available_actions_for_deleted_user():
    user = _make_user(email="deleted@example.com", is_approved=False)
    user.is_deleted = True
    assert available_actions_for_user(user) == {"restore", "delete_hard"}


def test_available_actions_for_admin_user():
    user = _make_user(email="admin@example.com", is_admin=True, is_approved=True, role="admin")
    assert "set_role" in available_actions_for_user(user)


def test_available_actions_for_users_union_order():
    pending = _make_user(email="p@example.com", is_approved=False)
    approved = _make_user(email="a@example.com", is_approved=True)
    actions = available_actions_for_users([pending, approved])
    expected_order = [a for a in ACTION_CATALOG.keys() if a in set(actions)]
    assert actions == expected_order
    assert "approve" in actions
    assert "send_code" in actions


def test_execute_approve_persists_reason_meta():
    user = _make_user(email="u@example.com", is_approved=False)
    logs: list[tuple[str, dict | None]] = []

    def log_action(action: str, _: User, meta: dict | None):
        logs.append((action, meta))

    result = execute_bulk_action_for_user(
        db=None,  # type: ignore[arg-type]
        user=user,
        payload=BulkActionPayload(action="approve", role="editor", reason="Проверен вручную"),
        log_action=log_action,
        send_login_code=lambda *_: {"challenge_id": 1, "sent": True},
    )

    assert result["ok"] is True
    assert user.is_approved is True
    assert user.role == "editor"
    assert logs[0][0] == "approve"
    assert logs[0][1]["reason"] == "Проверен вручную"


def test_execute_send_code_for_pending_user_is_rejected():
    user = _make_user(email="u@example.com", is_approved=False, is_blocked=False)
    logs: list[tuple[str, dict | None]] = []

    result = execute_bulk_action_for_user(
        db=None,  # type: ignore[arg-type]
        user=user,
        payload=BulkActionPayload(action="send_code"),
        log_action=lambda action, u, meta: logs.append((action, meta)),
        send_login_code=lambda *_: {"challenge_id": 1, "sent": True},
    )

    assert result["ok"] is False
    assert "allowed" in result["detail"]
    assert logs == []


def test_execute_revoke_trusted_devices_updates_rows_and_reason(db_session):
    user = _make_user(email="u@example.com", is_approved=True)
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)

    db_session.add_all(
        [
            TrustedDevice(
                user_id=user.id,
                token_hash="h1",
                policy="standard",
                created_at=_now_naive(),
                expires_at=None,
                last_used_at=None,
                revoked_at=None,
            ),
            TrustedDevice(
                user_id=user.id,
                token_hash="h2",
                policy="extended",
                created_at=_now_naive(),
                expires_at=None,
                last_used_at=None,
                revoked_at=None,
            ),
        ]
    )
    db_session.commit()

    logs: list[tuple[str, dict | None]] = []
    result = execute_bulk_action_for_user(
        db=db_session,
        user=user,
        payload=BulkActionPayload(action="revoke_trusted_devices", reason="Сброс устройств"),
        log_action=lambda action, u, meta: logs.append((action, meta)),
        send_login_code=lambda *_: {"challenge_id": 1, "sent": True},
    )
    db_session.commit()

    assert result["ok"] is True
    assert result["action"] == "revoke_trusted_devices"
    assert logs[0][1]["reason"] == "Сброс устройств"
    assert logs[0][1]["revoked_count"] == 2
