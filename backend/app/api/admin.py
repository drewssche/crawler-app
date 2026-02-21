import os
import logging
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Literal

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import and_, func
from sqlalchemy.orm import Session, aliased

from app.core.admin_sync import (
    get_runtime_admin_emails,
    is_root_admin_email,
    parse_admin_emails,
    sync_admin_users,
    validate_admin_emails,
    write_admin_emails_to_env_file,
)
from app.core.api_response import success_response_payload
from app.core.event_catalog import SECURITY_ADMIN_ACTIONS, admin_action_event_meta, audit_action_catalog_payload
from app.core.events import emit_event, ensure_event_states
from app.core.export_utils import csv_attachment_response, xlsx_attachment_response
from app.core.metrics import increment_counter
from app.core.monitoring_cache import (
    get_cached,
    get_monitoring_history_ttl_seconds,
    invalidate_cache_prefix,
    set_cached,
)
from app.core.monitoring_settings import get_monitoring_settings, update_monitoring_settings
from app.core.observability import log_business_event
from app.core.security import (
    LOGIN_CODE_EXPIRE_MINUTES,
    generate_login_code,
    get_user_role,
    hash_login_code,
    require_permission,
)
from app.core.utils import send_auth_code_email
from app.core.trust_policies import trust_policy_catalog_payload
from app.db.models.admin_audit_log import AdminAuditLog
from app.db.models.auth_attempt import AuthAttempt
from app.db.models.login_code import LoginCode
from app.db.models.event_feed import EventFeed
from app.db.models.login_history import LoginHistory
from app.db.models.trusted_device import TrustedDevice
from app.db.models.user import User
from app.db.session import get_db
from app.services.admin_bulk import (
    BulkActionPayload,
    available_actions_for_user,
    available_actions_for_users,
    bulk_action_catalog_payload,
    execute_bulk_action_for_user,
)

router = APIRouter(prefix="/admin", tags=["admin"])
logger = logging.getLogger(__name__)

SECURITY_ACTIONS = {
    *SECURITY_ADMIN_ACTIONS,
    "update_admin_emails",
}

class ApproveUserIn(BaseModel):
    role: Literal["editor", "viewer", "admin"]


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
        "set_role",
        "delete_soft",
        "restore",
        "delete_hard",
    ]
    role: Literal["editor", "viewer", "admin"] | None = None
    trust_policy: Literal["strict", "standard", "extended", "permanent"] | None = None
    reason: str | None = None


class AdminEmailsIn(BaseModel):
    emails: list[str]
    reason: str


class AvailableActionsIn(BaseModel):
    user_ids: list[int]


class MonitoringSettingsIn(BaseModel):
    warn_error_delta: float
    warn_error_rate: float
    crit_error_delta: float
    crit_error_rate: float


class TrustedDeviceRevokeIn(BaseModel):
    reason: str | None = None


class TrustedDeviceRevokeExceptIn(BaseModel):
    keep_device_id: int | None = None
    reason: str | None = None


def _is_bulk_action_allowed_for_actor(
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


def _prometheus_base_url() -> str:
    return os.getenv("PROMETHEUS_URL", "http://prometheus:9090").rstrip("/")


def _query_prometheus_range(
    *,
    query: str,
    start_ts: int,
    end_ts: int,
    step_seconds: int,
) -> list[dict[str, float]]:
    url = f"{_prometheus_base_url()}/api/v1/query_range"
    with httpx.Client(timeout=8.0) as client:
        response = client.get(
            url,
            params={
                "query": query,
                "start": str(start_ts),
                "end": str(end_ts),
                "step": str(step_seconds),
            },
        )
        response.raise_for_status()
        payload = response.json()

    data = payload.get("data", {})
    results = data.get("result", [])
    if not results:
        return []

    values: list[list[Any]] = results[0].get("values", [])
    points: list[dict[str, float]] = []
    for item in values:
        if not isinstance(item, list) or len(item) != 2:
            continue
        try:
            ts = float(item[0])
            val = float(item[1])
        except (TypeError, ValueError):
            continue
        points.append({"ts": ts, "value": val})
    return points


def _prometheus_escape_label_value(value: str) -> str:
    return value.replace("\\", "\\\\").replace('"', '\\"')


def _utc_now_naive() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _client_ip(request: Request) -> str | None:
    forwarded = request.headers.get("x-forwarded-for", "")
    if forwarded:
        return forwarded.split(",")[0].strip()[:64]
    if request.client and request.client.host:
        return request.client.host[:64]
    return None


def _log_admin_action(
    db: Session,
    request: Request,
    actor: User,
    action: str,
    target_user_id: int | None = None,
    meta_json: dict | None = None,
) -> None:
    created_at = _utc_now_naive()
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
            "security": action in SECURITY_ACTIONS,
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


def _build_last_login_map(db: Session, user_ids: list[int]) -> dict[int, LoginHistory]:
    last_login_by_user_id: dict[int, LoginHistory] = {}
    if not user_ids:
        return last_login_by_user_id
    subq = (
        db.query(
            LoginHistory.user_id.label("user_id"),
            func.max(LoginHistory.id).label("max_id"),
        )
        .filter(LoginHistory.user_id.in_(user_ids))
        .group_by(LoginHistory.user_id)
        .subquery()
    )
    rows = (
        db.query(LoginHistory)
        .join(subq, and_(LoginHistory.user_id == subq.c.user_id, LoginHistory.id == subq.c.max_id))
        .all()
    )
    for row in rows:
        if row.user_id is None:
            continue
        if row.user_id not in last_login_by_user_id:
            last_login_by_user_id[row.user_id] = row
    return last_login_by_user_id


def _build_trust_summary_map(db: Session, user_ids: list[int]) -> dict[int, dict[str, float | int | None]]:
    summary: dict[int, dict[str, float | int | None]] = {}
    if not user_ids:
        return summary

    now = _utc_now_naive()
    rows = (
        db.query(TrustedDevice)
        .filter(TrustedDevice.user_id.in_(user_ids), TrustedDevice.revoked_at.is_(None))
        .all()
    )
    max_exp_by_user: dict[int, datetime] = {}
    permanent_by_user: set[int] = set()
    for row in rows:
        if row.user_id is None:
            continue
        entry = summary.setdefault(row.user_id, {"trusted_days_left": None, "trusted_devices_count": 0})
        entry["trusted_devices_count"] = int(entry["trusted_devices_count"] or 0) + 1

        if row.expires_at is None:
            permanent_by_user.add(row.user_id)
            continue
        current_max = max_exp_by_user.get(row.user_id)
        if current_max is None or row.expires_at > current_max:
            max_exp_by_user[row.user_id] = row.expires_at

    for uid, entry in summary.items():
        if uid in permanent_by_user:
            entry["trusted_days_left"] = -1.0
            continue
        max_exp = max_exp_by_user.get(uid)
        if max_exp is None:
            entry["trusted_days_left"] = None
            continue
        delta_days = (max_exp - now).total_seconds() / 86400
        entry["trusted_days_left"] = round(max(delta_days, 0), 1)
    return summary


def _build_user_profile_snapshot(
    *,
    user: User,
    last_login: LoginHistory | None,
    trust_summary: dict[str, float | int | None] | None = None,
) -> dict:
    summary = trust_summary or {}
    return {
        "id": user.id,
        "email": user.email,
        "role": get_user_role(user),
        "is_approved": user.is_approved,
        "is_blocked": user.is_blocked,
        "is_deleted": user.is_deleted,
        "trust_policy": user.trust_policy,
        "trusted_days_left": summary.get("trusted_days_left"),
        "trusted_devices_count": int(summary.get("trusted_devices_count") or 0),
        "last_activity_at": last_login.created_at.isoformat() if last_login else None,
        "last_ip": last_login.ip if last_login else None,
        "last_user_agent": last_login.user_agent if last_login else None,
    }


def _serialize_trusted_devices(db: Session, user_id: int) -> list[dict]:
    now = _utc_now_naive()
    history_rows = (
        db.query(LoginHistory)
        .filter(LoginHistory.user_id == user_id)
        .order_by(LoginHistory.created_at.desc(), LoginHistory.id.desc())
        .limit(200)
        .all()
    )

    def detect_device_label(user_agent: str | None) -> str:
        ua = (user_agent or "").lower()
        browser = "Unknown browser"
        platform = "Unknown OS"

        if "edg/" in ua:
            browser = "Edge"
        elif "chrome/" in ua and "edg/" not in ua:
            browser = "Chrome"
        elif "firefox/" in ua:
            browser = "Firefox"
        elif "safari/" in ua and "chrome/" not in ua:
            browser = "Safari"

        if "windows" in ua:
            platform = "Windows"
        elif "mac os" in ua or "macintosh" in ua:
            platform = "macOS"
        elif "linux" in ua:
            platform = "Linux"
        elif "android" in ua:
            platform = "Android"
        elif "iphone" in ua or "ios" in ua:
            platform = "iOS"

        return f"{browser} / {platform}"

    def nearest_history_for_device(device: TrustedDevice) -> LoginHistory | None:
        if not history_rows:
            return None

        candidates = [
            h
            for h in history_rows
            if h.result == "success" and h.source in {"verify_code", "trusted_device"}
        ]
        if not candidates:
            return None

        # Match device creation with nearest success login event.
        return min(
            candidates,
            key=lambda h: abs((h.created_at - device.created_at).total_seconds()),
        )

    devices = (
        db.query(TrustedDevice)
        .filter(TrustedDevice.user_id == user_id)
        .order_by(TrustedDevice.created_at.desc(), TrustedDevice.id.desc())
        .limit(30)
        .all()
    )
    result: list[dict] = []
    for device in devices:
        hint = nearest_history_for_device(device)
        hint_ua = hint.user_agent if hint else None
        hint_ip = hint.ip if hint else None
        hint_source = hint.source if hint else None
        hint_seen_at = hint.created_at.isoformat() if hint else None
        hint_label = detect_device_label(hint_ua)

        if device.revoked_at is not None:
            status = "revoked"
            days_left = None
        elif device.expires_at is None:
            status = "permanent"
            days_left = -1.0
        else:
            delta_days = (device.expires_at - now).total_seconds() / 86400
            days_left = round(max(delta_days, 0), 1)
            status = "expiring_soon" if days_left <= 3 else "active"
            if delta_days <= 0:
                status = "expired"
        result.append(
            {
                "id": device.id,
                "policy": device.policy,
                "created_at": device.created_at.isoformat(),
                "expires_at": device.expires_at.isoformat() if device.expires_at else None,
                "last_used_at": device.last_used_at.isoformat() if device.last_used_at else None,
                "revoked_at": device.revoked_at.isoformat() if device.revoked_at else None,
                "status": status,
                "days_left": days_left,
                "device_label": hint_label,
                "device_ip": hint_ip,
                "device_user_agent": hint_ua,
                "device_source": hint_source,
                "device_seen_at": hint_seen_at,
            }
        )
    return result


def _estimate_jwt_expiry(last_success_login: LoginHistory | None) -> tuple[str | None, int | None]:
    if not last_success_login:
        return None, None
    ttl_minutes = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "60"))
    exp_at = last_success_login.created_at + timedelta(minutes=ttl_minutes)
    left_seconds = int((exp_at - _utc_now_naive()).total_seconds())
    return exp_at.isoformat(), max(left_seconds, 0)


def _collect_login_history_items(
    db: Session,
    *,
    user_id: int | None,
    email: str,
    ip: str,
    result: str,
    source: str,
    date_from: str,
    date_to: str,
    sort_dir: Literal["desc", "asc"],
) -> list[dict]:
    query = _build_login_history_query(
        db=db,
        user_id=user_id,
        email=email,
        ip=ip,
        result=result,
        source=source,
        date_from=date_from,
        date_to=date_to,
        sort_dir=sort_dir,
    )
    return _serialize_login_history_rows(query.all())


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
    query = _build_audit_rows_query(
        db=db,
        action=action,
        actor_email=actor_email,
        target_email=target_email,
        security_only=security_only,
        date_from=date_from,
        date_to=date_to,
        sort_dir=sort_dir,
    )
    return _serialize_audit_rows(query.all())


def _build_login_history_query(
    db: Session,
    *,
    user_id: int | None,
    email: str,
    ip: str,
    result: str,
    source: str,
    date_from: str,
    date_to: str,
    sort_dir: Literal["desc", "asc"],
):
    query = db.query(LoginHistory)
    if user_id is not None:
        query = query.filter(LoginHistory.user_id == user_id)
    if email.strip():
        query = query.filter(LoginHistory.email.ilike(f"%{email.strip()}%"))
    if ip.strip():
        query = query.filter(LoginHistory.ip.ilike(f"%{ip.strip()}%"))
    if result.strip():
        query = query.filter(LoginHistory.result == result.strip())
    if source.strip():
        query = query.filter(LoginHistory.source == source.strip())
    if date_from.strip():
        try:
            from_dt = datetime.fromisoformat(date_from.strip())
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="Invalid date_from format (use ISO)") from exc
        query = query.filter(LoginHistory.created_at >= from_dt)
    if date_to.strip():
        try:
            to_dt = datetime.fromisoformat(date_to.strip())
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="Invalid date_to format (use ISO)") from exc
        query = query.filter(LoginHistory.created_at <= to_dt)

    order_created = LoginHistory.created_at.desc() if sort_dir == "desc" else LoginHistory.created_at.asc()
    order_id = LoginHistory.id.desc() if sort_dir == "desc" else LoginHistory.id.asc()
    return query.order_by(order_created, order_id)


def _serialize_login_history_rows(rows: list[LoginHistory]) -> list[dict]:
    return [
        {
            "id": row.id,
            "user_id": row.user_id,
            "email": row.email,
            "ip": row.ip,
            "user_agent": row.user_agent,
            "result": row.result,
            "source": row.source,
            "created_at": row.created_at.isoformat(),
        }
        for row in rows
    ]


def _serialize_audit_rows(rows) -> list[dict]:
    return [
        {
            "id": row.id,
            "created_at": row.created_at.isoformat(),
            "action": row.action or "",
            "actor_email": row.actor_email,
            "target_email": row.target_email,
            "ip": row.ip,
            "meta": row.meta,
        }
        for row in rows
    ]


def _build_audit_rows_query(
    db: Session,
    *,
    action: str,
    actor_email: str,
    target_email: str,
    security_only: bool,
    date_from: str,
    date_to: str,
    sort_dir: Literal["desc", "asc"],
):
    actor_user = aliased(User)
    target_user = aliased(User)

    actor_expr = func.coalesce(actor_user.email, "system")
    target_expr = func.coalesce(target_user.email, "-")

    query = (
        db.query(
            AdminAuditLog.id.label("id"),
            AdminAuditLog.created_at.label("created_at"),
            AdminAuditLog.action.label("action"),
            actor_expr.label("actor_email"),
            target_expr.label("target_email"),
            AdminAuditLog.ip.label("ip"),
            AdminAuditLog.meta_json.label("meta"),
        )
        .outerjoin(actor_user, actor_user.id == AdminAuditLog.actor_user_id)
        .outerjoin(target_user, target_user.id == AdminAuditLog.target_user_id)
    )

    action_filter = action.strip()
    actor_filter = actor_email.strip()
    target_filter = target_email.strip()

    if security_only:
        query = query.filter(AdminAuditLog.action.in_(list(SECURITY_ACTIONS)))
    if action_filter:
        query = query.filter(AdminAuditLog.action.ilike(f"%{action_filter}%"))
    if actor_filter:
        query = query.filter(actor_expr.ilike(f"%{actor_filter}%"))
    if target_filter:
        query = query.filter(target_expr.ilike(f"%{target_filter}%"))
    if date_from.strip():
        try:
            from_dt = datetime.fromisoformat(date_from.strip())
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="Invalid date_from format (use ISO)") from exc
        query = query.filter(AdminAuditLog.created_at >= from_dt)
    if date_to.strip():
        try:
            to_dt = datetime.fromisoformat(date_to.strip())
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="Invalid date_to format (use ISO)") from exc
        query = query.filter(AdminAuditLog.created_at <= to_dt)

    order_created = AdminAuditLog.created_at.desc() if sort_dir == "desc" else AdminAuditLog.created_at.asc()
    order_id = AdminAuditLog.id.desc() if sort_dir == "desc" else AdminAuditLog.id.asc()
    return query.order_by(order_created, order_id)


@router.get("/users")
def list_users(
    status: Literal["all", "pending", "approved", "deleted"] = "pending",
    q: str = "",
    include_deleted: bool = False,
    sort_by: Literal["id", "email", "role", "created"] = "id",
    sort_dir: Literal["asc", "desc"] = "asc",
    page: int | None = None,
    page_size: int = 20,
    request: Request = None,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_permission("users.manage")),
):
    query = db.query(User)
    if status == "pending":
        query = query.filter(User.is_approved.is_(False), User.is_deleted.is_(False))
    elif status == "approved":
        query = query.filter(User.is_approved.is_(True), User.is_deleted.is_(False))
    elif status == "deleted":
        query = query.filter(User.is_deleted.is_(True))
    else:
        if not include_deleted:
            query = query.filter(User.is_deleted.is_(False))

    if q.strip():
        query = query.filter(User.email.ilike(f"%{q.strip()}%"))

    sort_field = {
        "id": User.id,
        "email": User.email,
        "role": User.role,
        "created": User.id,
    }.get(sort_by, User.id)
    order_expr = sort_field.desc() if sort_dir == "desc" else sort_field.asc()
    query = query.order_by(order_expr, User.id.asc())

    total = query.count()
    safe_page = max(1, page or 1)
    safe_page_size = max(1, min(page_size, 200))
    if page is not None:
        users = query.offset((safe_page - 1) * safe_page_size).limit(safe_page_size).all()
    else:
        users = query.all()

    user_emails = [u.email for u in users if (u.email or "").strip()]
    lower_emails = [email.strip().lower() for email in user_emails if email.strip()]
    attempts = []
    if lower_emails:
        attempts_subq = (
            db.query(
                func.lower(AuthAttempt.email).label("email"),
                func.max(AuthAttempt.id).label("max_id"),
            )
            .filter(AuthAttempt.action == "request_access", func.lower(AuthAttempt.email).in_(lower_emails))
            .group_by(func.lower(AuthAttempt.email))
            .subquery()
        )
        attempts = (
            db.query(AuthAttempt)
            .join(
                attempts_subq,
                and_(
                    func.lower(AuthAttempt.email) == attempts_subq.c.email,
                    AuthAttempt.id == attempts_subq.c.max_id,
                ),
            )
            .all()
        )
    pending_requested_at_by_email: dict[str, str] = {}
    for at in attempts:
        email_key = (at.email or "").strip().lower()
        if email_key and email_key not in pending_requested_at_by_email:
            pending_requested_at_by_email[email_key] = at.created_at.isoformat()

    user_ids = [u.id for u in users]
    last_login_by_user_id = _build_last_login_map(db, user_ids)
    trust_summary_by_user_id = _build_trust_summary_map(db, user_ids)

    pending_unread_by_user_id: dict[int, bool] = {}
    pending_event_id_by_user_id: dict[int, int | None] = {}
    if user_ids:
        pending_events_subq = (
            db.query(
                EventFeed.target_user_id.label("user_id"),
                func.max(EventFeed.id).label("max_id"),
            )
            .filter(
                EventFeed.event_type == "auth.request_access",
                EventFeed.target_user_id.in_(user_ids),
            )
            .group_by(EventFeed.target_user_id)
            .subquery()
        )
        pending_events = (
            db.query(EventFeed)
            .join(
                pending_events_subq,
                and_(
                    EventFeed.target_user_id == pending_events_subq.c.user_id,
                    EventFeed.id == pending_events_subq.c.max_id,
                ),
            )
            .all()
        )
        if pending_events:
            state_map = ensure_event_states(db, user_id=_admin.id, event_ids=[e.id for e in pending_events])
            for event in pending_events:
                if event.target_user_id is None:
                    continue
                if event.target_user_id not in pending_event_id_by_user_id:
                    pending_event_id_by_user_id[event.target_user_id] = event.id
                state = state_map.get(event.id)
                if state and (not state.is_read) and (not state.is_dismissed):
                    pending_unread_by_user_id[event.target_user_id] = True

    items = []
    for u in users:
        base = _build_user_profile_snapshot(
            user=u,
            last_login=last_login_by_user_id.get(u.id),
            trust_summary=trust_summary_by_user_id.get(u.id),
        )
        base.update(
            {
                "is_root_admin": is_root_admin_email(u.email),
                "pending_requested_at": pending_requested_at_by_email.get(u.email.lower()),
                "is_admin": u.is_admin,
                "pending_unread": bool(pending_unread_by_user_id.get(u.id, False)),
                "pending_event_id": pending_event_id_by_user_id.get(u.id),
            }
        )
        items.append(base)

    if page is not None:
        return success_response_payload(
            request,
            data={
                "items": items,
                "total": total,
                "page": safe_page,
                "page_size": safe_page_size,
            },
        )

    return success_response_payload(request, data=items)


@router.get("/users/actions/catalog")
def users_actions_catalog(
    request: Request,
    admin: User = Depends(require_permission("users.manage")),
):
    return success_response_payload(
        request,
        data=bulk_action_catalog_payload(include_admin_role=get_user_role(admin) == "root-admin"),
    )


@router.get("/users/trust-policies/catalog")
def users_trust_policies_catalog(
    request: Request,
    _admin: User = Depends(require_permission("users.manage")),
):
    return success_response_payload(request, data=trust_policy_catalog_payload())


@router.get("/audit/actions/catalog")
def audit_actions_catalog(
    request: Request,
    _admin: User = Depends(require_permission("audit.view")),
):
    return success_response_payload(request, data=audit_action_catalog_payload())


@router.get("/monitoring/settings")
def get_monitoring_settings_api(
    request: Request,
    _admin: User = Depends(require_permission("audit.view")),
):
    return success_response_payload(request, data=get_monitoring_settings())


@router.post("/monitoring/settings")
def update_monitoring_settings_api(
    payload: MonitoringSettingsIn,
    request: Request,
    admin: User = Depends(require_permission("audit.view")),
):
    try:
        data = update_monitoring_settings(
            warn_error_delta=payload.warn_error_delta,
            warn_error_rate=payload.warn_error_rate,
            crit_error_delta=payload.crit_error_delta,
            crit_error_rate=payload.crit_error_rate,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    log_business_event(
        logger,
        request,
        event="monitoring.settings.update",
        actor_email=admin.email,
    )
    # Invalidate monitoring time-series cache after settings update to avoid stale context.
    invalidate_cache_prefix("monitoring:")
    return success_response_payload(request, data=data)


@router.get("/monitoring/history")
def get_monitoring_history_api(
    request: Request,
    range_minutes: int = 60,
    step_seconds: int = 30,
    force_refresh: bool = False,
    _admin: User = Depends(require_permission("audit.view")),
):
    safe_range = max(5, min(range_minutes, 24 * 60))
    safe_step = max(10, min(step_seconds, 600))
    end_ts = int(time.time())
    start_ts = end_ts - safe_range * 60

    queries = {
        "http_requests": "(sum(http_requests_total) or vector(0))",
        "http_errors": "(sum(http_errors_total) or vector(0))",
        "auth_starts": "(sum(auth_start_total) or vector(0))",
        "admin_actions": "(sum(admin_action_total) or vector(0))",
        "events_center": "(sum(events_center_total) or vector(0))",
        "invalid_code": '(sum(auth_verify_result_total{result="invalid_code"}) or vector(0))',
    }

    cache_key = f"monitoring:history:v1:range={safe_range}:step={safe_step}"
    if not force_refresh:
        cached = get_cached(cache_key)
        if cached is not None:
            return success_response_payload(request, data=cached)

    try:
        series = {
            key: _query_prometheus_range(
                query=query,
                start_ts=start_ts,
                end_ts=end_ts,
                step_seconds=safe_step,
            )
            for key, query in queries.items()
        }
        payload = {
            "enabled": True,
            "source": "prometheus",
            "range_minutes": safe_range,
            "step_seconds": safe_step,
            "series": series,
        }
        set_cached(cache_key, payload, get_monitoring_history_ttl_seconds())
        return success_response_payload(request, data=payload)
    except Exception as exc:
        payload = {
            "enabled": False,
            "source": "prometheus",
            "range_minutes": safe_range,
            "step_seconds": safe_step,
            "series": {k: [] for k in queries.keys()},
            "error": str(exc),
        }
        set_cached(cache_key, payload, max(1, get_monitoring_history_ttl_seconds() // 2))
        return success_response_payload(request, data=payload)


@router.get("/monitoring/history/focus")
def get_monitoring_focus_history_api(
    request: Request,
    metric_name: str,
    metric_path: str | None = None,
    range_minutes: int = 60,
    step_seconds: int = 30,
    force_refresh: bool = False,
    _admin: User = Depends(require_permission("audit.view")),
):
    safe_range = max(5, min(range_minutes, 24 * 60))
    safe_step = max(10, min(step_seconds, 600))
    end_ts = int(time.time())
    start_ts = end_ts - safe_range * 60

    safe_metric_name = metric_name.strip()
    if not safe_metric_name:
        raise HTTPException(status_code=400, detail="metric_name is required")

    label_filter = ""
    if metric_path and metric_path.strip():
        esc_path = _prometheus_escape_label_value(metric_path.strip())
        label_filter = f'{{path="{esc_path}"}}'

    promql = f"sum({safe_metric_name}{label_filter})"
    path_key = (metric_path or "").strip()
    cache_key = f"monitoring:focus:v1:metric={safe_metric_name}:path={path_key}:range={safe_range}:step={safe_step}"
    if not force_refresh:
        cached = get_cached(cache_key)
        if cached is not None:
            return success_response_payload(request, data=cached)

    try:
        points = _query_prometheus_range(
            query=promql,
            start_ts=start_ts,
            end_ts=end_ts,
            step_seconds=safe_step,
        )
        payload = {
            "enabled": True,
            "source": "prometheus",
            "range_minutes": safe_range,
            "step_seconds": safe_step,
            "query": promql,
            "series": points,
        }
        set_cached(cache_key, payload, get_monitoring_history_ttl_seconds())
        return success_response_payload(request, data=payload)
    except Exception as exc:
        payload = {
            "enabled": False,
            "source": "prometheus",
            "range_minutes": safe_range,
            "step_seconds": safe_step,
            "query": promql,
            "series": [],
            "error": str(exc),
        }
        set_cached(cache_key, payload, max(1, get_monitoring_history_ttl_seconds() // 2))
        return success_response_payload(request, data=payload)


@router.post("/users/actions/available")
def users_actions_available(
    payload: AvailableActionsIn,
    request: Request,
    db: Session = Depends(get_db),
    admin: User = Depends(require_permission("users.manage")),
):
    if not payload.user_ids:
        return success_response_payload(request, data={"actions": []})
    users = db.query(User).filter(User.id.in_(payload.user_ids)).all()
    actions = []
    for action in available_actions_for_users(users):
        for user in users:
            allowed_set = available_actions_for_user(user)
            if action not in allowed_set:
                continue
            can_apply, _ = _is_bulk_action_allowed_for_actor(actor=admin, user=user, action=action)
            if can_apply:
                actions.append(action)
                break
    return success_response_payload(request, data={"actions": actions})


@router.get("/users/{user_id}/details")
def user_details(
    user_id: int,
    request: Request,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_permission("users.manage")),
):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    login_rows = (
        db.query(LoginHistory)
        .filter(LoginHistory.user_id == user.id)
        .order_by(LoginHistory.created_at.desc(), LoginHistory.id.desc())
        .limit(20)
        .all()
    )
    last_login = login_rows[0] if login_rows else None
    last_success_login = next((row for row in login_rows if row.result == "success"), None)
    estimated_jwt_expires_at, estimated_jwt_left_seconds = _estimate_jwt_expiry(last_success_login)

    admin_logs = (
        db.query(AdminAuditLog)
        .filter(AdminAuditLog.target_user_id == user.id)
        .order_by(AdminAuditLog.created_at.desc(), AdminAuditLog.id.desc())
        .limit(10)
        .all()
    )
    trusted_devices = _serialize_trusted_devices(db, user.id)

    known_ips = sorted({row.ip for row in login_rows if row.ip})
    invalid_code_24h = (
        db.query(LoginHistory)
        .filter(
            LoginHistory.user_id == user.id,
            LoginHistory.result == "invalid_code",
            LoginHistory.created_at >= _utc_now_naive() - timedelta(hours=24),
        )
        .count()
    )
    latest_row = login_rows[0] if login_rows else None
    latest_ip_is_new = False
    if latest_row and latest_row.ip:
        latest_ip_count = (
            db.query(LoginHistory)
            .filter(LoginHistory.user_id == user.id, LoginHistory.ip == latest_row.ip)
            .count()
        )
        latest_ip_is_new = latest_ip_count <= 1
    success_rows = [row for row in login_rows if row.result == "success" and row.user_agent]
    ua_changed_recently = len(success_rows) >= 2 and success_rows[0].user_agent != success_rows[1].user_agent
    anomalies = {
        "invalid_code_24h": int(invalid_code_24h),
        "frequent_invalid_code": int(invalid_code_24h) >= 5,
        "latest_ip_is_new": latest_ip_is_new,
        "ua_changed_recently": ua_changed_recently,
    }

    return success_response_payload(
        request,
        data={
            "user": {
                "id": user.id,
                "email": user.email,
                "role": get_user_role(user),
                "is_root_admin": is_root_admin_email(user.email),
                "is_approved": user.is_approved,
                "is_admin": user.is_admin,
                "is_blocked": user.is_blocked,
                "is_deleted": user.is_deleted,
                "trust_policy": user.trust_policy,
                "trusted_days_left": _calc_trusted_days_left(db, user.id),
                "token_version": int(user.token_version),
                "last_activity_at": last_login.created_at.isoformat() if last_login else None,
                "last_ip": last_login.ip if last_login else None,
                "last_user_agent": last_login.user_agent if last_login else None,
                "known_ips": known_ips,
            },
            "session": {
                "jwt_ttl_minutes": int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "60")),
                "estimated_jwt_expires_at": estimated_jwt_expires_at,
                "estimated_jwt_left_seconds": estimated_jwt_left_seconds,
            },
            "trusted_devices": trusted_devices,
            "login_history": [
                {
                    "id": row.id,
                    "created_at": row.created_at.isoformat(),
                    "ip": row.ip,
                    "user_agent": row.user_agent,
                    "result": row.result,
                    "source": row.source,
                }
                for row in login_rows
            ],
            "admin_actions": [
                {
                    "id": row.id,
                    "created_at": row.created_at.isoformat(),
                    "action": row.action,
                    "meta": row.meta_json,
                    "ip": row.ip,
                }
                for row in admin_logs
            ],
            "anomalies": anomalies,
        },
    )


@router.post("/users/{user_id}/trusted-devices/{device_id}/revoke")
def revoke_trusted_device(
    user_id: int,
    device_id: int,
    payload: TrustedDeviceRevokeIn,
    request: Request,
    db: Session = Depends(get_db),
    admin: User = Depends(require_permission("users.manage")),
):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    can_apply, reason = _is_bulk_action_allowed_for_actor(actor=admin, user=user, action="revoke_trusted_devices")
    if not can_apply:
        raise HTTPException(status_code=403, detail=reason or "Action is forbidden")

    device = (
        db.query(TrustedDevice)
        .filter(TrustedDevice.id == device_id, TrustedDevice.user_id == user_id)
        .first()
    )
    if not device:
        raise HTTPException(status_code=404, detail="Trusted device not found")

    if device.revoked_at is not None:
        return success_response_payload(
            request,
            data={"ok": True, "already_revoked": True, "device_id": device.id},
        )

    now = _utc_now_naive()
    device.revoked_at = now
    _log_admin_action(
        db,
        request,
        admin,
        "revoke_trusted_device",
        target_user_id=user.id,
        meta_json={
            "device_id": device.id,
            "policy": device.policy,
            "reason": (payload.reason or "").strip() or None,
        },
    )
    db.commit()
    return success_response_payload(
        request,
        data={"ok": True, "device_id": device.id, "revoked_at": now.isoformat()},
    )


@router.post("/users/{user_id}/trusted-devices/revoke-except")
def revoke_trusted_devices_except_one(
    user_id: int,
    payload: TrustedDeviceRevokeExceptIn,
    request: Request,
    db: Session = Depends(get_db),
    admin: User = Depends(require_permission("users.manage")),
):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    can_apply, reason = _is_bulk_action_allowed_for_actor(actor=admin, user=user, action="revoke_trusted_devices")
    if not can_apply:
        raise HTTPException(status_code=403, detail=reason or "Action is forbidden")

    active_devices = (
        db.query(TrustedDevice)
        .filter(TrustedDevice.user_id == user.id, TrustedDevice.revoked_at.is_(None))
        .order_by(TrustedDevice.last_used_at.desc(), TrustedDevice.created_at.desc(), TrustedDevice.id.desc())
        .all()
    )
    if not active_devices:
        return success_response_payload(request, data={"ok": True, "revoked_count": 0, "keep_device_id": None})

    keep_device_id = payload.keep_device_id
    if keep_device_id is None:
        keep_device_id = active_devices[0].id

    if not any(d.id == keep_device_id for d in active_devices):
        raise HTTPException(status_code=400, detail="keep_device_id is not active for this user")

    now = _utc_now_naive()
    revoked_count = (
        db.query(TrustedDevice)
        .filter(
            TrustedDevice.user_id == user.id,
            TrustedDevice.revoked_at.is_(None),
            TrustedDevice.id != keep_device_id,
        )
        .update({TrustedDevice.revoked_at: now}, synchronize_session=False)
    )

    _log_admin_action(
        db,
        request,
        admin,
        "revoke_trusted_devices_except_one",
        target_user_id=user.id,
        meta_json={
            "keep_device_id": keep_device_id,
            "revoked_count": int(revoked_count),
            "reason": (payload.reason or "").strip() or None,
        },
    )
    db.commit()
    return success_response_payload(
        request,
        data={"ok": True, "revoked_count": int(revoked_count), "keep_device_id": keep_device_id},
    )


@router.get("/settings/admin-emails")
def get_admin_emails_settings(
    request: Request,
    q: str = "",
    page: int | None = None,
    page_size: int = 20,
    db: Session = Depends(get_db),
    admin: User = Depends(require_permission("root_admins.manage")),
):
    runtime = get_runtime_admin_emails()
    q_norm = q.strip().lower()
    filtered_runtime = [email for email in runtime if not q_norm or q_norm in email.lower()]
    total = len(filtered_runtime)
    safe_page = max(1, page or 1)
    safe_page_size = max(1, min(page_size, 200))
    page_emails = (
        filtered_runtime[(safe_page - 1) * safe_page_size : (safe_page - 1) * safe_page_size + safe_page_size]
        if page is not None
        else filtered_runtime
    )

    db_profiles: dict[str, dict] = {}
    if page_emails:
        lower_emails = [email.strip().lower() for email in page_emails if email.strip()]
        users_by_email = {
            (u.email or "").lower(): u
            for u in db.query(User).filter(func.lower(User.email).in_(lower_emails)).all()
            if (u.email or "").strip()
        }
        user_ids = [u.id for u in users_by_email.values()]
        last_login_by_user_id = _build_last_login_map(db, user_ids)
        trust_summary_by_user_id = _build_trust_summary_map(db, user_ids)

        for email in page_emails:
            hit = users_by_email.get((email or "").lower())
            if not hit:
                continue
            snap = _build_user_profile_snapshot(
                user=hit,
                last_login=last_login_by_user_id.get(hit.id),
                trust_summary=trust_summary_by_user_id.get(hit.id),
            )
            snap.pop("trusted_devices_count", None)
            db_profiles[email] = snap
    if page is not None:
        items = [
            {
                "email": email,
                "in_db": email in db_profiles,
                "profile": db_profiles.get(email),
            }
            for email in page_emails
        ]
        return success_response_payload(
            request,
            data={
                "items": items,
                "total": total,
                "total_all": len(runtime),
                "page": safe_page,
                "page_size": safe_page_size,
                "is_root_admin": True,
            },
        )

    db_admin_rows = db.query(User.email).filter(User.is_admin.is_(True)).order_by(User.email.asc()).all()
    db_admins = [row[0] for row in db_admin_rows if row and row[0]]
    return success_response_payload(
        request,
        data={
            "admin_emails": runtime,
            "db_admins": db_admins,
            "db_profiles": db_profiles,
            "is_root_admin": True,
        },
    )


@router.post("/settings/admin-emails")
def update_admin_emails_settings(
    payload: AdminEmailsIn,
    request: Request,
    db: Session = Depends(get_db),
    admin: User = Depends(require_permission("root_admins.manage")),
):
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

    return success_response_payload(request, data={
        "ok": True,
        "admin_emails": normalized,
        "sync": {
            "created": sync_result.created,
            "promoted": sync_result.promoted,
            "demoted": sync_result.demoted,
            "skipped_create_without_password": sync_result.skipped_create_without_password,
        },
        "note": "New admin emails are saved to .env and synced immediately.",
    })


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
    request: Request = None,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_permission("audit.view")),
):
    safe_page = max(1, page)
    safe_page_size = max(1, min(page_size, 200))
    query = _build_audit_rows_query(
        db=db,
        action=action,
        actor_email=actor_email,
        target_email=target_email,
        security_only=security_only,
        date_from=date_from,
        date_to=date_to,
        sort_dir=sort_dir,
    )
    total = query.count()
    start = (safe_page - 1) * safe_page_size
    rows = query.offset(start).limit(safe_page_size).all()
    items = _serialize_audit_rows(rows)
    return success_response_payload(request, data={
        "items": items,
        "total": total,
        "page": safe_page,
        "page_size": safe_page_size,
    })


@router.get("/login-history")
def list_login_history(
    user_id: int | None = None,
    email: str = "",
    ip: str = "",
    result: str = "",
    source: str = "",
    date_from: str = "",
    date_to: str = "",
    sort_dir: Literal["desc", "asc"] = "desc",
    page: int = 1,
    page_size: int = 50,
    request: Request = None,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_permission("audit.view")),
):
    safe_page = max(1, page)
    safe_page_size = max(1, min(page_size, 200))
    query = _build_login_history_query(
        db=db,
        user_id=user_id,
        email=email,
        ip=ip,
        result=result,
        source=source,
        date_from=date_from,
        date_to=date_to,
        sort_dir=sort_dir,
    )
    total = query.count()
    start = (safe_page - 1) * safe_page_size
    rows = query.offset(start).limit(safe_page_size).all()
    items = _serialize_login_history_rows(rows)
    return success_response_payload(
        request,
        data={
            "items": items,
            "total": total,
            "page": safe_page,
            "page_size": safe_page_size,
        },
    )


@router.get("/login-history/export.csv")
def export_login_history_csv(
    user_id: int | None = None,
    email: str = "",
    ip: str = "",
    result: str = "",
    source: str = "",
    date_from: str = "",
    date_to: str = "",
    sort_dir: Literal["desc", "asc"] = "desc",
    db: Session = Depends(get_db),
    _admin: User = Depends(require_permission("audit.view")),
):
    items = _collect_login_history_items(
        db,
        user_id=user_id,
        email=email,
        ip=ip,
        result=result,
        source=source,
        date_from=date_from,
        date_to=date_to,
        sort_dir=sort_dir,
    )
    return csv_attachment_response(
        filename="login_history.csv",
        header=["id", "created_at", "email", "result", "source", "ip", "user_agent"],
        rows=(
            [
                row.get("id"),
                row.get("created_at"),
                row.get("email"),
                row.get("result"),
                row.get("source"),
                row.get("ip") or "",
                row.get("user_agent") or "",
            ]
            for row in items
        ),
    )


@router.get("/login-history/export.xlsx")
def export_login_history_xlsx(
    user_id: int | None = None,
    email: str = "",
    ip: str = "",
    result: str = "",
    source: str = "",
    date_from: str = "",
    date_to: str = "",
    sort_dir: Literal["desc", "asc"] = "desc",
    db: Session = Depends(get_db),
    _admin: User = Depends(require_permission("audit.view")),
):
    items = _collect_login_history_items(
        db,
        user_id=user_id,
        email=email,
        ip=ip,
        result=result,
        source=source,
        date_from=date_from,
        date_to=date_to,
        sort_dir=sort_dir,
    )
    return xlsx_attachment_response(
        filename="login_history.xlsx",
        sheet_name="LoginHistory",
        header=["id", "created_at", "email", "result", "source", "ip", "user_agent"],
        rows=(
            [
                row.get("id"),
                row.get("created_at"),
                row.get("email"),
                row.get("result"),
                row.get("source"),
                row.get("ip") or "",
                row.get("user_agent") or "",
            ]
            for row in items
        ),
    )


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
    _admin: User = Depends(require_permission("audit.view")),
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
    return csv_attachment_response(
        filename="admin_audit_logs.csv",
        header=["id", "created_at", "action", "actor_email", "target_email", "ip", "reason"],
        rows=(
            [
                row.get("id"),
                row.get("created_at"),
                row.get("action"),
                row.get("actor_email"),
                row.get("target_email"),
                row.get("ip") or "",
                (row.get("meta") or {}).get("reason", "") if isinstance(row.get("meta"), dict) else "",
            ]
            for row in items
        ),
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
    _admin: User = Depends(require_permission("audit.view")),
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
    return xlsx_attachment_response(
        filename="admin_audit_logs.xlsx",
        sheet_name="Audit",
        header=["id", "created_at", "action", "actor_email", "target_email", "ip", "reason"],
        rows=(
            [
                row.get("id"),
                row.get("created_at"),
                row.get("action"),
                row.get("actor_email"),
                row.get("target_email"),
                row.get("ip") or "",
                (row.get("meta") or {}).get("reason", "") if isinstance(row.get("meta"), dict) else "",
            ]
            for row in items
        ),
    )


@router.post("/users/{user_id}/approve")
def approve_user(
    user_id: int,
    payload: ApproveUserIn,
    request: Request,
    db: Session = Depends(get_db),
    admin: User = Depends(require_permission("users.manage")),
):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if user.is_admin:
        raise HTTPException(status_code=400, detail="Cannot modify admin via this endpoint")
    if payload.role == "admin" and get_user_role(admin) != "root-admin":
        raise HTTPException(status_code=403, detail="Only root-admin can assign admin role")

    previous_role = user.role
    user.role = payload.role
    user.is_admin = payload.role == "admin"
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
    return success_response_payload(
        request,
        data={"ok": True, "id": user.id, "role": user.role, "is_approved": user.is_approved},
    )


@router.post("/users/bulk")
def bulk_users(
    payload: BulkUsersIn,
    request: Request,
    db: Session = Depends(get_db),
    admin: User = Depends(require_permission("users.manage")),
):
    increment_counter("admin_bulk_total")
    if not payload.user_ids:
        raise HTTPException(status_code=400, detail="No users selected")

    users = db.query(User).filter(User.id.in_(payload.user_ids)).all()
    user_map = {u.id: u for u in users}
    action_payload = BulkActionPayload(
        action=payload.action,
        role=payload.role,
        trust_policy=payload.trust_policy,
        reason=payload.reason.strip() if payload.reason else None,
    )

    results = []
    changed = False

    for uid in payload.user_ids:
        user = user_map.get(uid)
        if not user:
            results.append({"user_id": uid, "ok": False, "detail": "User not found"})
            continue

        allowed = available_actions_for_user(user)
        if payload.action not in allowed:
            results.append({"user_id": uid, "ok": False, "detail": f"Action {payload.action} is not applicable for this user"})
            continue

        can_apply, reason = _is_bulk_action_allowed_for_actor(
            actor=admin,
            user=user,
            action=payload.action,
            role=payload.role,
        )
        if not can_apply:
            results.append({"user_id": uid, "ok": False, "detail": reason or "Action is forbidden"})
            continue

        outcome = execute_bulk_action_for_user(
            db=db,
            user=user,
            payload=action_payload,
            log_action=lambda action, target_user, meta: _log_admin_action(
                db,
                request,
                admin,
                action,
                target_user_id=target_user.id,
                meta_json=meta,
            ),
            send_login_code=_send_login_code_for_user,
        )
        if outcome.get("ok"):
            changed = True
        results.append({"user_id": uid, **outcome})

    if changed:
        db.commit()
    increment_counter("admin_bulk_result_total", action=payload.action, changed=str(changed).lower())

    return success_response_payload(request, data={"ok": True, "results": results})




