from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class EventUserState(Base):
    __tablename__ = "event_user_state"
    __table_args__ = (UniqueConstraint("event_id", "user_id", name="uq_event_user_state_event_user"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    event_id: Mapped[int] = mapped_column(ForeignKey("event_feed.id"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    is_read: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    read_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    is_dismissed: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    dismissed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    is_handled: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    handled_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, index=True)
