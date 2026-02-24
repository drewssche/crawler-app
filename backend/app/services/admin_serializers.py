from collections.abc import Iterable, Iterator
from typing import Any

from app.core.security import get_user_role
from app.db.models.login_history import LoginHistory
from app.db.models.trusted_device import TrustedDevice
from app.db.models.user import User


def _serialize_login_history_row(row: LoginHistory) -> dict[str, Any]:
    return {
        "id": row.id,
        "user_id": row.user_id,
        "email": row.email,
        "ip": row.ip,
        "user_agent": row.user_agent,
        "result": row.result,
        "source": row.source,
        "created_at": row.created_at.isoformat(),
    }


def _serialize_audit_row(row: Any) -> dict[str, Any]:
    return {
        "id": row.id,
        "created_at": row.created_at.isoformat(),
        "action": row.action or "",
        "actor_email": row.actor_email,
        "target_email": row.target_email,
        "ip": row.ip,
        "meta": row.meta,
    }


def serialize_login_history_rows(rows: Iterable[LoginHistory]) -> list[dict[str, Any]]:
    return [_serialize_login_history_row(row) for row in rows]


def serialize_audit_rows(rows: Iterable[Any]) -> list[dict[str, Any]]:
    return [_serialize_audit_row(row) for row in rows]


def iter_serialized_login_history_rows(rows: Iterable[LoginHistory]) -> Iterator[dict[str, Any]]:
    for row in rows:
        yield _serialize_login_history_row(row)


def iter_serialized_audit_rows(rows: Iterable[Any]) -> Iterator[dict[str, Any]]:
    for row in rows:
        yield _serialize_audit_row(row)


def build_user_profile_snapshot(
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


def _detect_device_label(user_agent: str | None) -> str:
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


def _nearest_history_for_device(device: TrustedDevice, history_rows: list[LoginHistory]) -> LoginHistory | None:
    if not history_rows:
        return None
    candidates = [
        h
        for h in history_rows
        if h.result == "success" and h.source in {"verify_code", "trusted_device"}
    ]
    if not candidates:
        return None
    return min(candidates, key=lambda h: abs((h.created_at - device.created_at).total_seconds()))




def serialize_user_details_login_history(rows: Iterable[LoginHistory]) -> list[dict[str, Any]]:
    return [
        {
            "id": row.id,
            "created_at": row.created_at.isoformat(),
            "ip": row.ip,
            "user_agent": row.user_agent,
            "result": row.result,
            "source": row.source,
        }
        for row in rows
    ]


def serialize_user_details_admin_actions(rows: Iterable[Any]) -> list[dict[str, Any]]:
    return [
        {
            "id": row.id,
            "created_at": row.created_at.isoformat(),
            "action": row.action,
            "meta": row.meta_json,
            "ip": row.ip,
        }
        for row in rows
    ]


def build_user_details_anomalies(
    *,
    login_rows: list[LoginHistory],
    invalid_code_24h: int,
    latest_ip_is_new: bool,
) -> dict[str, Any]:
    success_rows = [row for row in login_rows if row.result == "success" and row.user_agent]
    ua_changed_recently = len(success_rows) >= 2 and success_rows[0].user_agent != success_rows[1].user_agent
    return {
        "invalid_code_24h": int(invalid_code_24h),
        "frequent_invalid_code": int(invalid_code_24h) >= 5,
        "latest_ip_is_new": bool(latest_ip_is_new),
        "ua_changed_recently": ua_changed_recently,
    }

def serialize_trusted_devices(
    *,
    devices: Iterable[TrustedDevice],
    history_rows: list[LoginHistory],
    now,
) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for device in devices:
        hint = _nearest_history_for_device(device, history_rows)
        hint_ua = hint.user_agent if hint else None
        hint_ip = hint.ip if hint else None
        hint_source = hint.source if hint else None
        hint_seen_at = hint.created_at.isoformat() if hint else None
        hint_label = _detect_device_label(hint_ua)

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


def iter_login_history_export_rows(items: Iterable[dict[str, Any]]) -> Iterator[list[Any]]:
    for row in items:
        yield [
            row.get("id"),
            row.get("created_at"),
            row.get("email"),
            row.get("result"),
            row.get("source"),
            row.get("ip") or "",
            row.get("user_agent") or "",
        ]


def iter_audit_export_rows(items: Iterable[dict[str, Any]]) -> Iterator[list[Any]]:
    for row in items:
        meta = row.get("meta")
        reason = meta.get("reason", "") if isinstance(meta, dict) else ""
        yield [
            row.get("id"),
            row.get("created_at"),
            row.get("action"),
            row.get("actor_email"),
            row.get("target_email"),
            row.get("ip") or "",
            reason,
        ]
