from datetime import datetime

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class PageMonitoringNotificationOutbox(Base):
    __tablename__ = "page_monitoring_notification_outbox"

    id: Mapped[int] = mapped_column(primary_key=True)
    subscription_id: Mapped[int | None] = mapped_column(
        ForeignKey("page_monitoring_target_subscriptions.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    target_id: Mapped[int] = mapped_column(ForeignKey("page_monitoring_targets.id", ondelete="CASCADE"), index=True)
    target_check_id: Mapped[int] = mapped_column(ForeignKey("page_monitoring_target_checks.id", ondelete="CASCADE"), index=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)

    channel_type: Mapped[str] = mapped_column(String(40), index=True)
    destination: Mapped[str] = mapped_column(String(500))
    event_status: Mapped[str] = mapped_column(String(30), index=True)
    delivery_status: Mapped[str] = mapped_column(String(30), default="queued", index=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    max_attempts: Mapped[int] = mapped_column(Integer, default=5)
    next_attempt_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    payload_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    last_error: Mapped[str] = mapped_column(Text, default="")

    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), index=True)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
