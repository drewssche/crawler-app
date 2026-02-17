import os
import csv
import io
from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from openpyxl import Workbook
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.admin_sync import (
    get_runtime_admin_emails,
    is_root_admin_email,
    parse_admin_emails,
    sync_admin_users,
    validate_admin_emails,
    write_admin_emails_to_env_file,
)
from app.core.security import (
    LOGIN_CODE_EXPIRE_MINUTES,
    generate_login_code,
    hash_login_code,
    require_admin_user,
)
from app.core.utils import send_auth_code_email
from app.db.models.admin_audit_log import AdminAuditLog
from app.db.models.auth_attempt import AuthAttempt
from app.db.models.login_code import LoginCode
from app.db.models.trusted_device import TrustedDevice
from app.db.models.user import User
from app.db.session import get_db

router = APIRouter(prefix="/admin", tags=["admin"])

TRUST_POLICIES = {"strict", "standard", "extended", "permanent"}
SECURITY_ACTIONS = {
    "block",
    "unblock",
    "revoke_sessions",
    "revoke_trusted_devices",
    "send_code",
    "update_admin_emails",
}


class ApproveUserIn(BaseModel):
    role: Literal["editor", "viewer"]


class BulkUsersIn(BaseModel):
    user_ids: list[int]
    action: Literal[
        "approve",
        "remove_approve",
        "block",
        "unblock",
        "revoke_sessions",
        "revoke_trusted_devices",
        "send_code",
        "set_trust_policy",
    ]
    role: Literal["editor", "viewer"] | None = None
    trust_policy: Literal["strict", "standard", "extended", "permanent"] | None = None
    reason: str | None = None


class AdminEmailsIn(BaseModel):
    emails: list[str]
    reason: str


def _utc_now_naive() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _client_ip(request: Request) -> str | None:
    forwarded = request.headers.get("x-forwarded-for", "")
    if forwarded:
        return forwarded.split(",")[0].strip()[:64]
    if request.client and request.client.host:
        return request.client.host[:64]
    return None


def _require_root_admin(current_user: User) -> None:
    if not is_root_admin_email(current_user.email):
        raise HTTPException(status_code=403, detail="Root admin access required")


def _log_admin_action(
    db: Session,
    request: Request,
    actor: User,
    action: str,
    target_user_id: int | None = None,
    meta_json: dict | None = None,
    ) -> None:
    db.add(
        AdminAuditLog(
            actor_user_id=actor.id,
            target_user_id=target_user_id,
            action=action,
            meta_json=meta_json,
            ip=_client_ip(request),
            user_agent=request.headers.get("user-agent", "")[:255] or None,
            created_at=_utc_now_naive(),
        )
    )


def _require_reason(reason: str | None) -> str:
    value = (reason or "").strip()
    if not value:
        raise HTTPException(status_code=400, detail="Reason is required for this action")
    return value


def _send_login_code_for_user(db: Session, user: User) -> dict:
    code = generate_login_code()
    challenge = LoginCode(
        user_id=user.id,
        code_hash=hash_login_code(code),
        expires_at=_utc_now_naive() + timedelta(minutes=LOGIN_CODE_EXPIRE_MINUTES),
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


def _calc_trusted_days_left(db: Session, user_id: int) -> float | None:
    now = _utc_now_naive()
    devices = (
        db.query(TrustedDevice)
        .filter(
            TrustedDevice.user_id == user_id,
            TrustedDevice.revoked_at.is_(None),
        )
        .all()
    )
    if not devices:
        return None

    if any(d.expires_at is None for d in devices):
        return -1.0

    max_exp = max(d.expires_at for d in devices if d.expires_at is not None)
    delta_days = (max_exp - now).total_seconds() / 86400
    return round(max(delta_days, 0), 1)


def _collect_audit_items(
    db: Session,
    action: str,
    actor_email: str,
    target_email: str,
    security_only: bool,
    date_from: str,
    date_to: str,
    sort_dir: Literal["desc", "asc"],
) -> list[dict]:
    logs = db.query(AdminAuditLog).order_by(AdminAuditLog.created_at.desc(), AdminAuditLog.id.desc()).all()
    users = db.query(User).all()
    id_to_email = {u.id: u.email for u in users}

    actor_filter = actor_email.strip().lower()
    target_filter = target_email.strip().lower()
    action_filter = action.strip().lower()
    from_dt = None
    to_dt = None
    if date_from.strip():
        try:
            from_dt = datetime.fromisoformat(date_from.strip())
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="Invalid date_from format (use ISO)") from exc
    if date_to.strip():
        try:
            to_dt = datetime.fromisoformat(date_to.strip())
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="Invalid date_to format (use ISO)") from exc

    result = []

    for log in logs:
        actor = id_to_email.get(log.actor_user_id, "system") if log.actor_user_id else "system"
        target = id_to_email.get(log.target_user_id, "-") if log.target_user_id else "-"
        log_action = log.action or ""

        if security_only and log_action not in SECURITY_ACTIONS:
            continue
        if action_filter and action_filter not in log_action.lower():
            continue
        if actor_filter and actor_filter not in actor.lower():
            continue
        if target_filter and target_filter not in target.lower():
            continue
        if from_dt and log.created_at < from_dt:
            continue
        if to_dt and log.created_at > to_dt:
            continue

        result.append(
            {
                "id": log.id,
                "created_at": log.created_at.isoformat(),
                "action": log_action,
                "actor_email": actor,
                "target_email": target,
                "ip": log.ip,
                "meta": log.meta_json,
            }
        )
    if sort_dir == "asc":
        result.reverse()
    return result


@router.get("/users")
def list_users(
    status: Literal["all", "pending", "approved"] = "pending",
    q: str = "",
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin_user),
):
    query = db.query(User)
    if status == "pending":
        query = query.filter(User.is_approved.is_(False))
    elif status == "approved":
        query = query.filter(User.is_approved.is_(True))

    if q.strip():
        query = query.filter(User.email.ilike(f"%{q.strip()}%"))

    users = query.order_by(User.id.asc()).all()
    attempts = (
        db.query(AuthAttempt)
        .filter(AuthAttempt.action == "request_access")
        .order_by(AuthAttempt.created_at.desc(), AuthAttempt.id.desc())
        .all()
    )
    pending_requested_at_by_email: dict[str, str] = {}
    for at in attempts:
        email_key = (at.email or "").strip().lower()
        if email_key and email_key not in pending_requested_at_by_email:
            pending_requested_at_by_email[email_key] = at.created_at.isoformat()

    return [
        {
            "id": u.id,
            "email": u.email,
            "role": u.role,
            "is_root_admin": is_root_admin_email(u.email),
            "pending_requested_at": pending_requested_at_by_email.get(u.email.lower()),
            "is_approved": u.is_approved,
            "is_admin": u.is_admin,
            "is_blocked": u.is_blocked,
            "trust_policy": u.trust_policy,
            "trusted_days_left": _calc_trusted_days_left(db, u.id),
        }
        for u in users
    ]


@router.get("/settings/admin-emails")
def get_admin_emails_settings(
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin_user),
):
    _require_root_admin(admin)
    runtime = get_runtime_admin_emails()
    db_admins = [u.email for u in db.query(User).filter(User.is_admin.is_(True)).order_by(User.email.asc()).all()]
    return {
        "admin_emails": runtime,
        "db_admins": db_admins,
        "is_root_admin": True,
    }


@router.post("/settings/admin-emails")
def update_admin_emails_settings(
    payload: AdminEmailsIn,
    request: Request,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin_user),
):
    _require_root_admin(admin)

    normalized = sorted(set(parse_admin_emails(",".join(payload.emails))))
    if not normalized:
        raise HTTPException(status_code=400, detail="At least one admin email is required")
    validate_admin_emails(normalized)
    reason = _require_reason(payload.reason)

    current_runtime = get_runtime_admin_emails()
    if admin.email.lower() not in set(normalized):
        raise HTTPException(status_code=400, detail="You cannot remove your own root-admin email")

    write_admin_emails_to_env_file(normalized)
    sync_result = sync_admin_users(db, normalized, admin_password=os.getenv("ADMIN_PASSWORD"))

    _log_admin_action(
        db,
        request,
        admin,
        "update_admin_emails",
        target_user_id=None,
        meta_json={
            "old_admin_emails": current_runtime,
            "new_admin_emails": normalized,
            "created": sync_result.created,
            "promoted": sync_result.promoted,
            "demoted": sync_result.demoted,
            "skipped_create_without_password": sync_result.skipped_create_without_password,
            "reason": reason,
        },
    )
    db.commit()

    return {
        "ok": True,
        "admin_emails": normalized,
        "sync": {
            "created": sync_result.created,
            "promoted": sync_result.promoted,
            "demoted": sync_result.demoted,
            "skipped_create_without_password": sync_result.skipped_create_without_password,
        },
        "note": "New admin emails are saved to .env and synced immediately.",
    }


@router.get("/audit")
def list_audit_logs(
    page: int = 1,
    page_size: int = 50,
    action: str = "",
    actor_email: str = "",
    target_email: str = "",
    security_only: bool = False,
    date_from: str = "",
    date_to: str = "",
    sort_dir: Literal["desc", "asc"] = "desc",
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin_user),
):
    safe_page = max(1, page)
    safe_page_size = max(1, min(page_size, 200))
    all_items = _collect_audit_items(
        db=db,
        action=action,
        actor_email=actor_email,
        target_email=target_email,
        security_only=security_only,
        date_from=date_from,
        date_to=date_to,
        sort_dir=sort_dir,
    )
    total = len(all_items)
    start = (safe_page - 1) * safe_page_size
    end = start + safe_page_size
    return {
        "items": all_items[start:end],
        "total": total,
        "page": safe_page,
        "page_size": safe_page_size,
    }


@router.get("/audit/export.csv")
def export_audit_logs_csv(
    action: str = "",
    actor_email: str = "",
    target_email: str = "",
    security_only: bool = False,
    date_from: str = "",
    date_to: str = "",
    sort_dir: Literal["desc", "asc"] = "desc",
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin_user),
):
    items = _collect_audit_items(
        db=db,
        action=action,
        actor_email=actor_email,
        target_email=target_email,
        security_only=security_only,
        date_from=date_from,
        date_to=date_to,
        sort_dir=sort_dir,
    )
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["id", "created_at", "action", "actor_email", "target_email", "ip", "reason"])
    for row in items:
        meta = row.get("meta") or {}
        writer.writerow(
            [
                row.get("id"),
                row.get("created_at"),
                row.get("action"),
                row.get("actor_email"),
                row.get("target_email"),
                row.get("ip") or "",
                meta.get("reason", "") if isinstance(meta, dict) else "",
            ]
        )
    return Response(
        content=buf.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": "attachment; filename=admin_audit_logs.csv"},
    )


@router.get("/audit/export.xlsx")
def export_audit_logs_xlsx(
    action: str = "",
    actor_email: str = "",
    target_email: str = "",
    security_only: bool = False,
    date_from: str = "",
    date_to: str = "",
    sort_dir: Literal["desc", "asc"] = "desc",
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin_user),
):
    items = _collect_audit_items(
        db=db,
        action=action,
        actor_email=actor_email,
        target_email=target_email,
        security_only=security_only,
        date_from=date_from,
        date_to=date_to,
        sort_dir=sort_dir,
    )
    wb = Workbook()
    ws = wb.active
    ws.title = "Audit"
    ws.append(["id", "created_at", "action", "actor_email", "target_email", "ip", "reason"])
    for row in items:
        meta = row.get("meta") or {}
        ws.append(
            [
                row.get("id"),
                row.get("created_at"),
                row.get("action"),
                row.get("actor_email"),
                row.get("target_email"),
                row.get("ip") or "",
                meta.get("reason", "") if isinstance(meta, dict) else "",
            ]
        )

    out = io.BytesIO()
    wb.save(out)
    out.seek(0)
    return Response(
        content=out.getvalue(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=admin_audit_logs.xlsx"},
    )


@router.post("/users/{user_id}/approve")
def approve_user(
    user_id: int,
    payload: ApproveUserIn,
    request: Request,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin_user),
):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if user.is_admin:
        raise HTTPException(status_code=400, detail="Cannot modify admin via this endpoint")

    previous_role = user.role
    user.role = payload.role
    user.is_approved = True
    user.is_blocked = False

    _log_admin_action(
        db,
        request,
        admin,
        "approve",
        target_user_id=user.id,
        meta_json={"old_role": previous_role, "new_role": payload.role},
    )
    db.commit()
    return {"ok": True, "id": user.id, "role": user.role, "is_approved": user.is_approved}


@router.post("/users/bulk")
def bulk_users(
    payload: BulkUsersIn,
    request: Request,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin_user),
):
    if not payload.user_ids:
        raise HTTPException(status_code=400, detail="No users selected")

    users = db.query(User).filter(User.id.in_(payload.user_ids)).all()
    user_map = {u.id: u for u in users}
    reason = payload.reason.strip() if payload.reason else None

    results = []
    changed = False

    for uid in payload.user_ids:
        user = user_map.get(uid)
        if not user:
            results.append({"user_id": uid, "ok": False, "detail": "User not found"})
            continue

        if user.is_admin:
            results.append({"user_id": uid, "ok": False, "detail": "Admin user is skipped"})
            continue

        if payload.action == "approve":
            if payload.role is None:
                results.append({"user_id": uid, "ok": False, "detail": "Role is required for approve"})
                continue
            old_role = user.role
            user.role = payload.role
            user.is_approved = True
            user.is_blocked = False
            _log_admin_action(
                db,
                request,
                admin,
                "approve",
                target_user_id=user.id,
                meta_json={"old_role": old_role, "new_role": user.role},
            )
            changed = True
            results.append({"user_id": uid, "ok": True, "action": "approve", "role": user.role})

        elif payload.action == "remove_approve":
            user.is_approved = False
            _log_admin_action(
                db,
                request,
                admin,
                "remove_approve",
                target_user_id=user.id,
                meta_json={"reason": reason},
            )
            changed = True
            results.append({"user_id": uid, "ok": True, "action": "remove_approve"})

        elif payload.action == "block":
            user.is_blocked = True
            user.token_version = int(user.token_version) + 1
            _log_admin_action(
                db,
                request,
                admin,
                "block",
                target_user_id=user.id,
                meta_json={"reason": reason},
            )
            changed = True
            results.append({"user_id": uid, "ok": True, "action": "block"})

        elif payload.action == "unblock":
            user.is_blocked = False
            _log_admin_action(db, request, admin, "unblock", target_user_id=user.id)
            changed = True
            results.append({"user_id": uid, "ok": True, "action": "unblock"})

        elif payload.action == "revoke_sessions":
            user.token_version = int(user.token_version) + 1
            _log_admin_action(
                db,
                request,
                admin,
                "revoke_sessions",
                target_user_id=user.id,
                meta_json={"reason": reason},
            )
            changed = True
            results.append({"user_id": uid, "ok": True, "action": "revoke_sessions"})

        elif payload.action == "revoke_trusted_devices":
            now = _utc_now_naive()
            revoked_count = (
                db.query(TrustedDevice)
                .filter(TrustedDevice.user_id == user.id, TrustedDevice.revoked_at.is_(None))
                .update({TrustedDevice.revoked_at: now}, synchronize_session=False)
            )
            _log_admin_action(
                db,
                request,
                admin,
                "revoke_trusted_devices",
                target_user_id=user.id,
                meta_json={"revoked_count": int(revoked_count), "reason": reason},
            )
            changed = True
            results.append({"user_id": uid, "ok": True, "action": "revoke_trusted_devices"})

        elif payload.action == "send_code":
            if not user.is_approved or user.is_blocked:
                results.append({"user_id": uid, "ok": False, "detail": "User is not allowed to login"})
                continue
            send_result = _send_login_code_for_user(db, user)
            _log_admin_action(
                db,
                request,
                admin,
                "send_code",
                target_user_id=user.id,
                meta_json={"challenge_id": send_result["challenge_id"], "sent": send_result["sent"]},
            )
            changed = True
            results.append({"user_id": uid, "ok": True, "action": "send_code", **send_result})

        elif payload.action == "set_trust_policy":
            if payload.trust_policy is None or payload.trust_policy not in TRUST_POLICIES:
                results.append({"user_id": uid, "ok": False, "detail": "trust_policy is required"})
                continue
            old_policy = user.trust_policy
            user.trust_policy = payload.trust_policy
            _log_admin_action(
                db,
                request,
                admin,
                "set_trust_policy",
                target_user_id=user.id,
                meta_json={"old_policy": old_policy, "new_policy": user.trust_policy},
            )
            changed = True
            results.append({"user_id": uid, "ok": True, "action": "set_trust_policy", "trust_policy": user.trust_policy})

    if changed:
        db.commit()

    return {"ok": True, "results": results}
