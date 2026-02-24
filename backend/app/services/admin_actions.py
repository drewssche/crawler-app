from datetime import timedelta
from app.core.admin_sync import is_root_admin_email
from app.core.security import (
    LOGIN_CODE_EXPIRE_MINUTES,
    generate_login_code,
    get_user_role,
    hash_login_code,
)
from app.db.models.user import User


def is_bulk_action_allowed_for_actor(
    *,
    actor: User,
    user: User,
    action: str,
    role: str | None = None,
) -> tuple[bool, str | None]:
    actor_role = get_user_role(actor)
    is_root_actor = actor_role == "root-admin"
    root_admin_allowed_for_admin_user = {
        "remove_approve",
        "block",
        "unblock",
        "revoke_sessions",
        "revoke_trusted_devices",
        "send_code",
        "set_trust_policy",
        "set_role",
        "delete_soft",
        "restore",
        "delete_hard",
    }

    if action == "set_role":
        if not user.is_approved or user.is_deleted:
            return False, "Role can be changed only for active approved users"
        if user.id == actor.id and role in {"viewer", "editor"}:
            return False, "Cannot downgrade your own role"
        if is_root_admin_email(user.email):
            return False, "Cannot change role for root-admin"
        if user.is_admin and not is_root_actor:
            return False, "Only root-admin can change role for admin user"
        if role == "admin" and not is_root_actor:
            return False, "Only root-admin can assign admin role"
        return True, None

    if action == "approve" and role == "admin" and not is_root_actor:
        return False, "Only root-admin can assign admin role"

    if action == "delete_hard" and not is_root_actor:
        return False, "Only root-admin can perform this action"

    if action == "delete_hard":
        if user.id == actor.id:
            return False, "Cannot hard delete yourself"
        if is_root_admin_email(user.email):
            return False, "Cannot hard delete root-admin"
        return True, None

    if user.is_admin:
        if is_root_admin_email(user.email):
            return False, "Cannot apply this action to root-admin"
        if is_root_actor and action in root_admin_allowed_for_admin_user:
            return True, None
        return False, "Admin user is skipped"

    return True, None


from fastapi import HTTPException, Request
from sqlalchemy.orm import Session

from app.core.event_catalog import admin_action_event_meta
from app.core.events import emit_event, utc_now_naive
from app.core.metrics import increment_counter
from app.core.observability import log_business_event
from app.core.utils import send_auth_code_email
from app.db.models.admin_audit_log import AdminAuditLog
from app.db.models.login_code import LoginCode


def _client_ip(request: Request) -> str | None:
    forwarded = request.headers.get("x-forwarded-for", "")
    if forwarded:
        return forwarded.split(",")[0].strip()[:64]
    if request.client and request.client.host:
        return request.client.host[:64]
    return None


def log_admin_action(
    *,
    db: Session,
    request: Request,
    actor: User,
    action: str,
    security_actions: set[str],
    logger,
    target_user_id: int | None = None,
    meta_json: dict | None = None,
    created_at,
) -> None:
    log_entry = AdminAuditLog(
        actor_user_id=actor.id,
        target_user_id=target_user_id,
        action=action,
        meta_json=meta_json,
        ip=_client_ip(request),
        user_agent=request.headers.get("user-agent", "")[:255] or None,
        created_at=created_at,
    )
    db.add(log_entry)
    db.flush()

    target_user = db.get(User, target_user_id) if target_user_id else None
    event_meta = admin_action_event_meta(action)
    target_email = target_user.email if target_user else "-"

    emit_event(
        db,
        event_type=event_meta["event_type"],
        channel=event_meta["channel"],
        severity=event_meta["severity"],
        title=event_meta["title"],
        body=f"{actor.email} -> {target_email}",
        target_path=None,
        target_ref=f"log_id:{log_entry.id}",
        actor_user_id=actor.id,
        target_user_id=target_user_id,
        meta_json={
            "action": action,
            "audit_log_id": log_entry.id,
            "target_email": target_email,
            "security": action in security_actions,
            "related_target_path": f"/users?highlight_user_id={target_user_id}" if target_user_id else None,
            **(meta_json or {}),
        },
    )
    increment_counter("admin_action_total", action=action)
    log_business_event(
        logger,
        request,
        event="admin.action",
        action=action,
        actor_email=actor.email,
        target_email=target_email,
    )



def require_reason(reason: str | None) -> str:
    value = (reason or "").strip()
    if not value:
        raise HTTPException(status_code=400, detail="Reason is required for this action")
    return value


def send_login_code_for_user(db: Session, user: User) -> dict:
    code = generate_login_code()
    challenge = LoginCode(
        user_id=user.id,
        code_hash=hash_login_code(code),
        expires_at=utc_now_naive() + timedelta(minutes=LOGIN_CODE_EXPIRE_MINUTES),
        used_at=None,
        attempts=0,
    )
    db.add(challenge)
    db.commit()
    db.refresh(challenge)

    sent = send_auth_code_email(user.email, code)
    return {
        "user_id": user.id,
        "email": user.email,
        "sent": sent,
        "challenge_id": challenge.id,
    }
