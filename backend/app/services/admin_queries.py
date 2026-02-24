from datetime import datetime, timezone
from typing import Literal

from fastapi import HTTPException
from sqlalchemy import and_, func
from sqlalchemy.orm import Session, aliased

from app.core.events import utc_now_naive
from app.db.models.auth_attempt import AuthAttempt
from app.db.models.admin_audit_log import AdminAuditLog
from app.db.models.event_feed import EventFeed
from app.db.models.login_history import LoginHistory
from app.db.models.trusted_device import TrustedDevice
from app.db.models.user import User


def build_login_history_query(
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
            raise HTTPException(
                status_code=400, detail="Invalid date_from format (use ISO)") from exc
        query = query.filter(LoginHistory.created_at >= from_dt)
    if date_to.strip():
        try:
            to_dt = datetime.fromisoformat(date_to.strip())
        except ValueError as exc:
            raise HTTPException(
                status_code=400, detail="Invalid date_to format (use ISO)") from exc
        query = query.filter(LoginHistory.created_at <= to_dt)

    order_created = LoginHistory.created_at.desc(
    ) if sort_dir == "desc" else LoginHistory.created_at.asc()
    order_id = LoginHistory.id.desc() if sort_dir == "desc" else LoginHistory.id.asc()
    return query.order_by(order_created, order_id)


def build_audit_rows_query(
    db: Session,
    *,
    action: str,
    actor_email: str,
    target_email: str,
    security_only: bool,
    date_from: str,
    date_to: str,
    sort_dir: Literal["desc", "asc"],
    security_actions: set[str],
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
        query = query.filter(AdminAuditLog.action.in_(list(security_actions)))
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
            raise HTTPException(
                status_code=400, detail="Invalid date_from format (use ISO)") from exc
        query = query.filter(AdminAuditLog.created_at >= from_dt)
    if date_to.strip():
        try:
            to_dt = datetime.fromisoformat(date_to.strip())
        except ValueError as exc:
            raise HTTPException(
                status_code=400, detail="Invalid date_to format (use ISO)") from exc
        query = query.filter(AdminAuditLog.created_at <= to_dt)

    order_created = AdminAuditLog.created_at.desc(
    ) if sort_dir == "desc" else AdminAuditLog.created_at.asc()
    order_id = AdminAuditLog.id.desc() if sort_dir == "desc" else AdminAuditLog.id.asc()
    return query.order_by(order_created, order_id)


def build_last_login_map(db: Session, user_ids: list[int]) -> dict[int, LoginHistory]:
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


def build_trust_summary_map(db: Session, user_ids: list[int]) -> dict[int, dict[str, float | int | None]]:
    summary: dict[int, dict[str, float | int | None]] = {}
    if not user_ids:
        return summary

    now = utc_now_naive()
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
        entry = summary.setdefault(
            row.user_id, {"trusted_days_left": None, "trusted_devices_count": 0})
        entry["trusted_devices_count"] = int(
            entry["trusted_devices_count"] or 0) + 1

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


def load_active_trusted_devices_for_user(db: Session, user_id: int) -> list[TrustedDevice]:
    return (
        db.query(TrustedDevice)
        .filter(TrustedDevice.user_id == user_id, TrustedDevice.revoked_at.is_(None))
        .order_by(TrustedDevice.last_used_at.desc(), TrustedDevice.created_at.desc(), TrustedDevice.id.desc())
        .all()
    )


def load_recent_login_history_for_user(db: Session, user_id: int, *, limit: int = 200) -> list[LoginHistory]:
    return (
        db.query(LoginHistory)
        .filter(LoginHistory.user_id == user_id)
        .order_by(LoginHistory.created_at.desc(), LoginHistory.id.desc())
        .limit(limit)
        .all()
    )

def count_login_history_result_since(
    db: Session,
    user_id: int,
    *,
    result: str,
    since: datetime,
) -> int:
    return int(
        db.query(LoginHistory)
        .filter(
            LoginHistory.user_id == user_id,
            LoginHistory.result == result,
            LoginHistory.created_at >= since,
        )
        .count()
    )


def count_login_history_ip_occurrences(db: Session, user_id: int, *, ip: str) -> int:
    return int(
        db.query(LoginHistory)
        .filter(LoginHistory.user_id == user_id, LoginHistory.ip == ip)
        .count()
    )


def load_trusted_devices_for_user(db: Session, user_id: int, *, limit: int = 30) -> list[TrustedDevice]:
    return (
        db.query(TrustedDevice)
        .filter(TrustedDevice.user_id == user_id)
        .order_by(TrustedDevice.created_at.desc(), TrustedDevice.id.desc())
        .limit(limit)
        .all()
    )


def load_recent_admin_audit_for_user(db: Session, user_id: int, *, limit: int = 10) -> list[AdminAuditLog]:
    return (
        db.query(AdminAuditLog)
        .filter(AdminAuditLog.target_user_id == user_id)
        .order_by(AdminAuditLog.created_at.desc(), AdminAuditLog.id.desc())
        .limit(limit)
        .all()
    )


def load_latest_request_access_requested_at_by_email(
    db: Session,
    emails: list[str],
) -> dict[str, str]:
    lower_emails = [email.strip().lower()
                    for email in emails if (email or "").strip()]
    if not lower_emails:
        return {}

    attempts_subq = (
        db.query(
            func.lower(AuthAttempt.email).label("email"),
            func.max(AuthAttempt.id).label("max_id"),
        )
        .filter(
            AuthAttempt.action == "request_access",
            func.lower(AuthAttempt.email).in_(lower_emails),
        )
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
    requested_at_by_email: dict[str, str] = {}
    for row in attempts:
        email_key = (row.email or "").strip().lower()
        if email_key and email_key not in requested_at_by_email:
            requested_at_by_email[email_key] = row.created_at.isoformat()
    return requested_at_by_email


def load_latest_pending_access_events_for_users(db: Session, user_ids: list[int]) -> list[EventFeed]:
    if not user_ids:
        return []

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
    return (
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


def load_users_by_email_map(db: Session, emails: list[str]) -> dict[str, User]:
    lower_emails = [email.strip().lower()
                    for email in emails if (email or "").strip()]
    if not lower_emails:
        return {}
    users = db.query(User).filter(
        func.lower(User.email).in_(lower_emails)).all()
    return {
        (user.email or "").strip().lower(): user
        for user in users
        if (user.email or "").strip()
    }
