from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.db.models.auth_attempt import AuthAttempt


def _utc_now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def check_rate_limit(db: Session, email: str, action: str, limit: int, window_minutes: int) -> None:
    since = _utc_now() - timedelta(minutes=window_minutes)
    attempts = (
        db.query(AuthAttempt)
        .filter(AuthAttempt.email == email, AuthAttempt.action == action, AuthAttempt.created_at >= since)
        .count()
    )
    if attempts >= limit:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many requests. Try again later.",
        )


def record_attempt(db: Session, email: str, action: str) -> None:
    db.add(
        AuthAttempt(
            email=email,
            action=action,
            created_at=_utc_now(),
        )
    )
    db.commit()
