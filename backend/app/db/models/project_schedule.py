from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class ProjectSchedule(Base):
    __tablename__ = "project_schedules"
    __table_args__ = (
        UniqueConstraint("project_id", name="uq_project_schedules_project_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    created_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    updated_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)

    is_enabled: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    frequency: Mapped[str] = mapped_column(String(20), default="daily")
    time_of_day: Mapped[str] = mapped_column(String(5), default="09:00")
    weekdays_csv: Mapped[str] = mapped_column(String(20), default="")
    timezone: Mapped[str] = mapped_column(String(80), default="UTC")
    next_run_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    last_run_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    paused_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_skip_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
