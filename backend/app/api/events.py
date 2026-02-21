from typing import Literal
import logging

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import and_, or_, func

from app.core.api_response import success_response_payload
from app.core.events import ensure_event_states, mark_event_read, set_event_dismissed, set_event_handled, utc_now_naive
from app.core.metrics import increment_counter
from app.core.observability import log_business_event
from app.core.security import require_permission
from app.db.models.event_feed import EventFeed
from app.db.models.event_user_state import EventUserState
from app.db.models.user import User
from app.db.session import get_db

router = APIRouter(prefix="/events", tags=["events"])
logger = logging.getLogger(__name__)


def _serialize_event(event: EventFeed, state) -> dict:
    return {
        "id": event.id,
        "event_type": event.event_type,
        "channel": event.channel,
        "severity": event.severity,
        "title": event.title,
        "body": event.body,
        "target_path": event.target_path,
        "target_ref": event.target_ref,
        "actor_user_id": event.actor_user_id,
        "target_user_id": event.target_user_id,
        "meta": event.meta_json,
        "created_at": event.created_at.isoformat(),
        "is_read": bool(state.is_read),
        "read_at": state.read_at.isoformat() if state.read_at else None,
        "is_dismissed": bool(state.is_dismissed),
        "dismissed_at": state.dismissed_at.isoformat() if state.dismissed_at else None,
        "is_handled": bool(state.is_handled),
        "handled_at": state.handled_at.isoformat() if state.handled_at else None,
    }


def _fetch_events_with_state(
    db: Session,
    *,
    current_user: User,
    channel: str | None = None,
    include_dismissed: bool = False,
    security_only: bool = False,
    page: int = 1,
    page_size: int = 20,
) -> tuple[list[dict], int]:
    q = db.query(EventFeed)
    if channel:
        q = q.filter(EventFeed.channel == channel)
    if security_only:
        q = q.filter(EventFeed.severity.in_(["warning", "danger"]))

    q = q.order_by(EventFeed.created_at.desc(), EventFeed.id.desc())
    total = q.count()
    events = q.offset((page - 1) * page_size).limit(page_size).all()
    event_ids = [e.id for e in events]
    states = ensure_event_states(db, user_id=current_user.id, event_ids=event_ids)

    items: list[dict] = []
    for e in events:
        st = states[e.id]
        # Own actions are treated as already read for the actor.
        if e.actor_user_id == current_user.id and not st.is_read:
            now = utc_now_naive()
            st.is_read = True
            st.read_at = now
            st.updated_at = now
        if not include_dismissed and st.is_dismissed:
            continue
        items.append(_serialize_event(e, st))
    return items, total


def _count_unread_events(
    db: Session,
    *,
    current_user: User,
    channel: str | None = None,
    security_only: bool = False,
) -> int:
    q = db.query(func.count(EventFeed.id)).outerjoin(
        EventUserState,
        and_(EventUserState.event_id == EventFeed.id, EventUserState.user_id == current_user.id),
    )
    if channel:
        q = q.filter(EventFeed.channel == channel)
    if security_only:
        q = q.filter(EventFeed.severity.in_(["warning", "danger"]))
    q = q.filter(or_(EventFeed.actor_user_id.is_(None), EventFeed.actor_user_id != current_user.id))
    q = q.filter(or_(EventUserState.id.is_(None), EventUserState.is_dismissed.is_(False)))
    q = q.filter(or_(EventUserState.id.is_(None), EventUserState.is_read.is_(False)))
    value = q.scalar()
    return int(value or 0)


@router.get("/center")
def get_center_events(
    notifications_limit: int = 20,
    actions_limit: int = 20,
    actions_security_only: bool = False,
    request: Request = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("events.view")),
):
    increment_counter("events_center_total")
    n_limit = max(1, min(notifications_limit, 100))
    a_limit = max(1, min(actions_limit, 100))

    notifications, _ = _fetch_events_with_state(
        db,
        current_user=current_user,
        channel="notification",
        include_dismissed=False,
        page=1,
        page_size=n_limit,
    )
    actions, _ = _fetch_events_with_state(
        db,
        current_user=current_user,
        channel="action",
        include_dismissed=False,
        security_only=actions_security_only,
        page=1,
        page_size=a_limit,
    )
    notifications_unread = _count_unread_events(
        db,
        current_user=current_user,
        channel="notification",
        security_only=False,
    )
    actions_unread = _count_unread_events(
        db,
        current_user=current_user,
        channel="action",
        security_only=actions_security_only,
    )
    db.commit()
    log_business_event(
        logger,
        request,
        event="events.center",
        notifications=len(notifications),
        actions=len(actions),
        security_only=actions_security_only,
    )
    return success_response_payload(request, data={
        "notifications": notifications,
        "actions": actions,
        "notifications_unread": notifications_unread,
        "actions_unread": actions_unread,
    })


@router.get("/feed")
def get_events_feed(
    channel: Literal["all", "notification", "action"] = "all",
    include_dismissed: bool = True,
    only_unread: bool = False,
    security_only: bool = False,
    page: int = 1,
    page_size: int = 30,
    request: Request = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("events.view")),
):
    increment_counter("events_feed_total", channel=channel, only_unread=str(only_unread).lower())
    safe_page = max(1, page)
    safe_page_size = max(1, min(page_size, 200))
    ch = None if channel == "all" else channel
    items, total = _fetch_events_with_state(
        db,
        current_user=current_user,
        channel=ch,
        include_dismissed=include_dismissed,
        security_only=security_only,
        page=safe_page,
        page_size=safe_page_size,
    )
    if only_unread:
        items = [x for x in items if not x["is_read"]]
    db.commit()
    return success_response_payload(
        request,
        data={"items": items, "total": total, "page": safe_page, "page_size": safe_page_size},
    )


class EventStateIn(BaseModel):
    value: bool = True


@router.post("/{event_id}/read")
def set_read(
    event_id: int,
    payload: EventStateIn,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("events.view")),
):
    increment_counter("events_read_total", state=str(payload.value).lower())
    if not payload.value:
        event = db.get(EventFeed, event_id)
        if not event:
            raise HTTPException(status_code=404, detail="Event not found")
        st = ensure_event_states(db, user_id=current_user.id, event_ids=[event_id])[event_id]
        st.is_read = False
        st.read_at = None
        st.updated_at = utc_now_naive()
        db.commit()
        return success_response_payload(request, data={"is_read": False})
    st = mark_event_read(db, user_id=current_user.id, event_id=event_id)
    if not st:
        raise HTTPException(status_code=404, detail="Event not found")
    db.commit()
    log_business_event(logger, request, event="events.read", event_id=event_id, value=payload.value)
    return success_response_payload(request, data={"is_read": True})


@router.post("/{event_id}/dismiss")
def set_dismiss(
    event_id: int,
    payload: EventStateIn,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("events.view")),
):
    increment_counter("events_dismiss_total", state=str(payload.value).lower())
    st = set_event_dismissed(db, user_id=current_user.id, event_id=event_id, dismissed=payload.value)
    if not st:
        raise HTTPException(status_code=404, detail="Event not found")
    db.commit()
    log_business_event(logger, request, event="events.dismiss", event_id=event_id, value=payload.value)
    return success_response_payload(request, data={"is_dismissed": bool(st.is_dismissed)})


@router.post("/{event_id}/handled")
def set_handled(
    event_id: int,
    payload: EventStateIn,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("events.view")),
):
    st = set_event_handled(db, user_id=current_user.id, event_id=event_id, handled=payload.value)
    if not st:
        raise HTTPException(status_code=404, detail="Event not found")
    db.commit()
    log_business_event(logger, request, event="events.handled", event_id=event_id, value=payload.value)
    return success_response_payload(request, data={"is_handled": bool(st.is_handled)})


class ReadAllIn(BaseModel):
    channel: Literal["all", "notification", "action"] = "all"
    security_only: bool = False


@router.post("/read-all")
def read_all(
    payload: ReadAllIn,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("events.view")),
):
    q = db.query(EventFeed.id)
    if payload.channel != "all":
        q = q.filter(EventFeed.channel == payload.channel)
    if payload.security_only:
        q = q.filter(EventFeed.severity.in_(["warning", "danger"]))
    event_ids = [row[0] for row in q.all()]
    if not event_ids:
        return success_response_payload(request, data={"updated": 0})

    states = ensure_event_states(db, user_id=current_user.id, event_ids=event_ids)
    now = utc_now_naive()
    updated = 0
    for event_id in event_ids:
        st = states[event_id]
        if st.is_read:
            continue
        st.is_read = True
        st.read_at = now
        st.updated_at = now
        updated += 1
    db.commit()
    increment_counter("events_read_total", state="bulk")
    log_business_event(
        logger,
        request,
        event="events.read_all",
        updated=updated,
        channel=payload.channel,
        security_only=payload.security_only,
    )
    return success_response_payload(request, data={"updated": updated})
