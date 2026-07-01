import os
from datetime import datetime, timedelta
from typing import Any

import httpx
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.core.utils import send_plain_email
from app.db.models.page_monitoring_notification_outbox import PageMonitoringNotificationOutbox


def monitoring_notification_max_attempts() -> int:
    try:
        return max(1, int(os.getenv("MONITORING_NOTIFICATION_MAX_ATTEMPTS", "5")))
    except ValueError:
        return 5


def monitoring_notification_retry_backoff_seconds(attempts_used: int) -> int:
    raw = os.getenv("MONITORING_NOTIFICATION_RETRY_BACKOFF_SECONDS", "60,300,900,1800,3600")
    values: list[int] = []
    for chunk in raw.split(","):
        try:
            value = int(chunk.strip())
        except ValueError:
            continue
        if value > 0:
            values.append(value)
    if not values:
        values = [60, 300, 900, 1800, 3600]
    index = max(0, min(attempts_used - 1, len(values) - 1))
    return values[index]


def monitoring_delivery_diagnostics(db: Session) -> dict[str, Any]:
    now = datetime.utcnow()
    counts = {
        "queued": db.query(PageMonitoringNotificationOutbox).filter(PageMonitoringNotificationOutbox.delivery_status == "queued").count(),
        "failed_waiting": db.query(PageMonitoringNotificationOutbox).filter(
            PageMonitoringNotificationOutbox.delivery_status == "failed",
            PageMonitoringNotificationOutbox.next_attempt_at.isnot(None),
            PageMonitoringNotificationOutbox.next_attempt_at > now,
        ).count(),
        "retry_ready": db.query(PageMonitoringNotificationOutbox).filter(
            PageMonitoringNotificationOutbox.delivery_status == "failed",
            or_(PageMonitoringNotificationOutbox.next_attempt_at.is_(None), PageMonitoringNotificationOutbox.next_attempt_at <= now),
        ).count(),
        "sent": db.query(PageMonitoringNotificationOutbox).filter(PageMonitoringNotificationOutbox.delivery_status == "sent").count(),
        "dead": db.query(PageMonitoringNotificationOutbox).filter(PageMonitoringNotificationOutbox.delivery_status == "dead").count(),
    }
    return {
        "smtp_configured": bool(os.getenv("SMTP_HOST") and os.getenv("SMTP_USER") and os.getenv("SMTP_PASSWORD")),
        "telegram_configured": bool(os.getenv("TELEGRAM_BOT_TOKEN", "").strip()),
        "max_attempts": monitoring_notification_max_attempts(),
        "retry_backoff_seconds": [
            monitoring_notification_retry_backoff_seconds(index + 1)
            for index in range(5)
        ],
        "counts": counts,
        "total": sum(counts.values()),
    }


def build_monitoring_notification_message(payload: dict[str, Any]) -> tuple[str, str]:
    target_name = str(payload.get("target_name") or "Цель мониторинга")
    status = str(payload.get("status") or "changed")
    message = str(payload.get("message") or "")
    page_url = str(payload.get("page_url") or "")
    target_path = str(payload.get("target_path") or "")
    subject = f"Crawler: цель мониторинга — {status}"
    body = "\n".join(
        line
        for line in [
            f"Цель: {target_name}",
            f"Статус: {status}",
            f"Страница: {page_url}" if page_url else "",
            f"Сообщение: {message}" if message else "",
            f"Открыть в Crawler: {target_path}" if target_path else "",
        ]
        if line
    )
    return subject, body


def _deliver_email(row: PageMonitoringNotificationOutbox) -> tuple[bool, str]:
    subject, body = build_monitoring_notification_message(row.payload_json or {})
    if send_plain_email(row.destination, subject=subject, body=body):
        return True, ""
    return False, "SMTP не настроен."


def _deliver_telegram(row: PageMonitoringNotificationOutbox) -> tuple[bool, str]:
    token = os.getenv("TELEGRAM_BOT_TOKEN", "").strip()
    if not token:
        return False, "TELEGRAM_BOT_TOKEN не настроен."
    _subject, body = build_monitoring_notification_message(row.payload_json or {})
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    try:
        with httpx.Client(timeout=10) as client:
            response = client.post(
                url,
                json={
                    "chat_id": row.destination,
                    "text": body[:4096],
                    "disable_web_page_preview": True,
                },
            )
            response.raise_for_status()
    except Exception as exc:
        return False, str(exc)[:1000]
    return True, ""


def deliver_outbox_row(db: Session, row: PageMonitoringNotificationOutbox) -> PageMonitoringNotificationOutbox:
    if row.delivery_status not in {"queued", "failed"}:
        return row
    now = datetime.utcnow()
    if row.delivery_status == "failed" and row.next_attempt_at and row.next_attempt_at > now:
        return row
    max_attempts = int(row.max_attempts or monitoring_notification_max_attempts())
    if int(row.attempts or 0) >= max_attempts:
        row.delivery_status = "dead"
        row.last_error = row.last_error or "Лимит попыток доставки исчерпан."
        db.flush()
        return row
    row.attempts = int(row.attempts or 0) + 1
    row.max_attempts = max_attempts
    if row.channel_type == "email":
        ok, error = _deliver_email(row)
    elif row.channel_type == "telegram_chat":
        ok, error = _deliver_telegram(row)
    else:
        ok, error = False, f"Unsupported channel_type: {row.channel_type}"

    if ok:
        row.delivery_status = "sent"
        row.sent_at = now
        row.next_attempt_at = None
        row.last_error = ""
    else:
        if int(row.attempts or 0) >= max_attempts:
            row.delivery_status = "dead"
            row.next_attempt_at = None
            row.last_error = error or "Лимит попыток доставки исчерпан."
        else:
            row.delivery_status = "failed"
            row.next_attempt_at = now + timedelta(seconds=monitoring_notification_retry_backoff_seconds(int(row.attempts or 0)))
            row.last_error = error
    db.flush()
    return row


def deliver_queued_outbox(db: Session, *, limit: int = 20) -> list[PageMonitoringNotificationOutbox]:
    rows = (
        db.query(PageMonitoringNotificationOutbox)
        .filter(
            PageMonitoringNotificationOutbox.delivery_status.in_(["queued", "failed"]),
            or_(
                PageMonitoringNotificationOutbox.next_attempt_at.is_(None),
                PageMonitoringNotificationOutbox.next_attempt_at <= datetime.utcnow(),
            ),
        )
        .order_by(PageMonitoringNotificationOutbox.created_at.asc(), PageMonitoringNotificationOutbox.id.asc())
        .limit(limit)
        .all()
    )
    for row in rows:
        deliver_outbox_row(db, row)
    db.commit()
    return rows
