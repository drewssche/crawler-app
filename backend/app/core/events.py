from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.db.models.event_feed import EventFeed
from app.db.models.event_user_state import EventUserState

EVENT_CHANNEL_NOTIFICATION = "notification"
EVENT_CHANNEL_ACTION = "action"
EVENT_SEVERITY_INFO = "info"
EVENT_SEVERITY_WARNING = "warning"
EVENT_SEVERITY_DANGER = "danger"


def _resolve_default_target_path(event_type: str, channel: str, meta_json: dict | None) -> str | None:
    meta = meta_json or {}
    if channel == EVENT_CHANNEL_ACTION:
        audit_log_id = meta.get("audit_log_id")
        if isinstance(audit_log_id, int):
            return f"/logs?highlight_log_id={audit_log_id}"
        return "/logs"

    if event_type == "auth.request_access":
        email = meta.get("email")
        if isinstance(email, str) and email.strip():
            return f"/users?tab=pending&highlight_email={email.strip().lower()}"
        return "/users?tab=pending"

    if channel == EVENT_CHANNEL_NOTIFICATION:
        return "/events"

    return None


def utc_now_naive() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def emit_event(
    db: Session,
    *,
    event_type: str,
    channel: str,
    title: str,
    body: str | None = None,
    severity: str = EVENT_SEVERITY_INFO,
    target_path: str | None = None,
    target_ref: str | None = None,
    actor_user_id: int | None = None,
    target_user_id: int | None = None,
    meta_json: dict | None = None,
) -> EventFeed:
    resolved_target_path = target_path or _resolve_default_target_path(event_type, channel, meta_json)
    event = EventFeed(
        event_type=event_type,
        channel=channel,
        severity=severity,
        title=title,
        body=body,
        target_path=resolved_target_path,
        target_ref=target_ref,
        actor_user_id=actor_user_id,
        target_user_id=target_user_id,
        meta_json=meta_json,
        created_at=utc_now_naive(),
    )
    db.add(event)
    db.flush()
    return event


def ensure_event_states(db: Session, *, user_id: int, event_ids: list[int]) -> dict[int, EventUserState]:
    if not event_ids:
        return {}
    states = (
        db.query(EventUserState)
        .filter(EventUserState.user_id == user_id, EventUserState.event_id.in_(event_ids))
        .all()
    )
    by_event_id = {s.event_id: s for s in states}

    now = utc_now_naive()
    created_any = False
    for event_id in event_ids:
        if event_id in by_event_id:
            continue
        st = EventUserState(
            event_id=event_id,
            user_id=user_id,
            is_read=False,
            read_at=None,
            is_dismissed=False,
            dismissed_at=None,
            is_handled=False,
            handled_at=None,
            created_at=now,
            updated_at=now,
        )
        db.add(st)
        by_event_id[event_id] = st
        created_any = True

    if created_any:
        db.flush()
    return by_event_id


def mark_event_read(db: Session, *, user_id: int, event_id: int) -> EventUserState | None:
    event = db.get(EventFeed, event_id)
    if not event:
        return None
    states = ensure_event_states(db, user_id=user_id, event_ids=[event_id])
    st = states[event_id]
    if not st.is_read:
        st.is_read = True
        st.read_at = utc_now_naive()
        st.updated_at = st.read_at
        db.flush()
    return st


def set_event_dismissed(db: Session, *, user_id: int, event_id: int, dismissed: bool) -> EventUserState | None:
    event = db.get(EventFeed, event_id)
    if not event:
        return None
    states = ensure_event_states(db, user_id=user_id, event_ids=[event_id])
    st = states[event_id]
    now = utc_now_naive()
    st.is_dismissed = dismissed
    st.dismissed_at = now if dismissed else None
    st.updated_at = now
    if dismissed and not st.is_read:
        st.is_read = True
        st.read_at = now
    db.flush()
    return st


def set_event_handled(db: Session, *, user_id: int, event_id: int, handled: bool) -> EventUserState | None:
    event = db.get(EventFeed, event_id)
    if not event:
        return None
    states = ensure_event_states(db, user_id=user_id, event_ids=[event_id])
    st = states[event_id]
    now = utc_now_naive()
    st.is_handled = handled
    st.handled_at = now if handled else None
    st.updated_at = now
    if handled and not st.is_read:
        st.is_read = True
        st.read_at = now
    db.flush()
    return st
