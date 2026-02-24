import os
import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Request
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
from app.core.api_response import success_response_payload
from app.core.event_catalog import SECURITY_ADMIN_ACTIONS, audit_action_catalog_payload
from app.core.events import ensure_event_states
from app.core.export_utils import csv_attachment_response, xlsx_attachment_response
from app.core.metrics import increment_counter
from app.core.monitoring_cache import invalidate_cache_prefix
from app.core.observability import log_business_event
from app.core.security import (
    get_user_role,
    require_permission,
)
from app.core.trust_policies import trust_policy_catalog_payload
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
from app.services.admin_monitoring import (
    get_monitoring_focus_history_payload,
    get_monitoring_history_payload,
    get_monitoring_settings_payload,
    update_monitoring_settings_payload,
)
from app.services.admin_actions import (
    is_bulk_action_allowed_for_actor,
    log_admin_action as svc_log_admin_action,
    require_reason,
    send_login_code_for_user,
)
from app.services.admin_queries import (
    build_audit_rows_query,
    build_last_login_map,
    build_login_history_query,
    build_trust_summary_map,
    count_login_history_ip_occurrences,
    count_login_history_result_since,
    load_active_trusted_devices_for_user,
    load_latest_pending_access_events_for_users,
    load_latest_request_access_requested_at_by_email,
    load_recent_admin_audit_for_user,
    load_recent_login_history_for_user,
    load_users_by_email_map,
)
from app.services.admin_serializers import (
    build_user_details_anomalies,
    build_user_profile_snapshot,
    iter_audit_export_rows,
    iter_login_history_export_rows,
    serialize_audit_rows,
    serialize_login_history_rows,
    serialize_trusted_devices,
    serialize_user_details_admin_actions,
    serialize_user_details_login_history,
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


def _utc_now_naive() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _log_admin_action(
    db: Session,
    request: Request,
    actor: User,
    action: str,
    target_user_id: int | None = None,
    meta_json: dict | None = None,
) -> None:
    svc_log_admin_action(
        db=db,
        request=request,
        actor=actor,
        action=action,
        target_user_id=target_user_id,
        meta_json=meta_json,
        security_actions=SECURITY_ACTIONS,
        logger=logger,
        created_at=_utc_now_naive(),
    )

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


def _estimate_jwt_expiry(last_success_login: LoginHistory | None) -> tuple[str | None, int | None]:
    if not last_success_login:
        return None, None
    ttl_minutes = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "60"))
    exp_at = last_success_login.created_at + timedelta(minutes=ttl_minutes)
    left_seconds = int((exp_at - _utc_now_naive()).total_seconds())
    return exp_at.isoformat(), max(left_seconds, 0)


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
    pending_requested_at_by_email = load_latest_request_access_requested_at_by_email(db, user_emails)

    user_ids = [u.id for u in users]
    last_login_by_user_id = build_last_login_map(db, user_ids)
    trust_summary_by_user_id = build_trust_summary_map(db, user_ids)

    pending_unread_by_user_id: dict[int, bool] = {}
    pending_event_id_by_user_id: dict[int, int | None] = {}
    if user_ids:
        pending_events = load_latest_pending_access_events_for_users(db, user_ids)
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
        base = build_user_profile_snapshot(
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
    return success_response_payload(request, data=get_monitoring_settings_payload())


@router.post("/monitoring/settings")
def update_monitoring_settings_api(
    payload: MonitoringSettingsIn,
    request: Request,
    admin: User = Depends(require_permission("audit.view")),
):
    try:
        data = update_monitoring_settings_payload(
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
    payload = get_monitoring_history_payload(
        range_minutes=range_minutes,
        step_seconds=step_seconds,
        force_refresh=force_refresh,
    )
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
    try:
        payload = get_monitoring_focus_history_payload(
            metric_name=metric_name,
            metric_path=metric_path,
            range_minutes=range_minutes,
            step_seconds=step_seconds,
            force_refresh=force_refresh,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
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
            can_apply, _ = is_bulk_action_allowed_for_actor(actor=admin, user=user, action=action)
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

    login_rows = load_recent_login_history_for_user(db, user.id, limit=20)
    last_login = login_rows[0] if login_rows else None
    last_success_login = next((row for row in login_rows if row.result == "success"), None)
    estimated_jwt_expires_at, estimated_jwt_left_seconds = _estimate_jwt_expiry(last_success_login)

    admin_logs = load_recent_admin_audit_for_user(db, user.id, limit=10)
    trusted_devices = serialize_trusted_devices(
        devices=load_active_trusted_devices_for_user(db, user.id),
        history_rows=load_recent_login_history_for_user(db, user.id, limit=200),
        now=_utc_now_naive(),
    )

    known_ips = sorted({row.ip for row in login_rows if row.ip})
    invalid_code_24h = count_login_history_result_since(
        db,
        user.id,
        result="invalid_code",
        since=_utc_now_naive() - timedelta(hours=24),
    )
    latest_row = login_rows[0] if login_rows else None
    latest_ip_is_new = False
    if latest_row and latest_row.ip:
        latest_ip_count = count_login_history_ip_occurrences(db, user.id, ip=latest_row.ip)
        latest_ip_is_new = latest_ip_count <= 1
    anomalies = build_user_details_anomalies(
        login_rows=login_rows,
        invalid_code_24h=invalid_code_24h,
        latest_ip_is_new=latest_ip_is_new,
    )

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
            "login_history": serialize_user_details_login_history(login_rows),
            "admin_actions": serialize_user_details_admin_actions(admin_logs),
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

    can_apply, reason = is_bulk_action_allowed_for_actor(actor=admin, user=user, action="revoke_trusted_devices")
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

    can_apply, reason = is_bulk_action_allowed_for_actor(actor=admin, user=user, action="revoke_trusted_devices")
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
        users_by_email = load_users_by_email_map(db, page_emails)
        user_ids = [u.id for u in users_by_email.values()]
        last_login_by_user_id = build_last_login_map(db, user_ids)
        trust_summary_by_user_id = build_trust_summary_map(db, user_ids)

        for email in page_emails:
            hit = users_by_email.get((email or "").lower())
            if not hit:
                continue
            snap = build_user_profile_snapshot(
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
    reason = require_reason(payload.reason)

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
    query = build_audit_rows_query(
        db=db,
        action=action,
        actor_email=actor_email,
        target_email=target_email,
        security_only=security_only,
        date_from=date_from,
        date_to=date_to,
        sort_dir=sort_dir,
        security_actions=SECURITY_ACTIONS,
    )
    total = query.count()
    start = (safe_page - 1) * safe_page_size
    rows = query.offset(start).limit(safe_page_size).all()
    items = serialize_audit_rows(rows)
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
    query = build_login_history_query(
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
    items = serialize_login_history_rows(rows)
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
    query = build_login_history_query(
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
    items = serialize_login_history_rows(query.all())
    return csv_attachment_response(
        filename="login_history.csv",
        header=["id", "created_at", "email", "result", "source", "ip", "user_agent"],
        rows=iter_login_history_export_rows(items),
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
    query = build_login_history_query(
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
    items = serialize_login_history_rows(query.all())
    return xlsx_attachment_response(
        filename="login_history.xlsx",
        sheet_name="LoginHistory",
        header=["id", "created_at", "email", "result", "source", "ip", "user_agent"],
        rows=iter_login_history_export_rows(items),
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
    query = build_audit_rows_query(
        db=db,
        action=action,
        actor_email=actor_email,
        target_email=target_email,
        security_only=security_only,
        date_from=date_from,
        date_to=date_to,
        sort_dir=sort_dir,
        security_actions=SECURITY_ACTIONS,
    )
    items = serialize_audit_rows(query.all())
    return csv_attachment_response(
        filename="admin_audit_logs.csv",
        header=["id", "created_at", "action", "actor_email", "target_email", "ip", "reason"],
        rows=iter_audit_export_rows(items),
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
    query = build_audit_rows_query(
        db=db,
        action=action,
        actor_email=actor_email,
        target_email=target_email,
        security_only=security_only,
        date_from=date_from,
        date_to=date_to,
        sort_dir=sort_dir,
        security_actions=SECURITY_ACTIONS,
    )
    items = serialize_audit_rows(query.all())
    return xlsx_attachment_response(
        filename="admin_audit_logs.xlsx",
        sheet_name="Audit",
        header=["id", "created_at", "action", "actor_email", "target_email", "ip", "reason"],
        rows=iter_audit_export_rows(items),
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

        can_apply, reason = is_bulk_action_allowed_for_actor(
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
            send_login_code=send_login_code_for_user,
        )
        if outcome.get("ok"):
            changed = True
        results.append({"user_id": uid, **outcome})

    if changed:
        db.commit()
    increment_counter("admin_bulk_result_total", action=payload.action, changed=str(changed).lower())

    return success_response_payload(request, data={"ok": True, "results": results})





