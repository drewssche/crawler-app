from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Run(Base):
    __tablename__ = "runs"

    id: Mapped[int] = mapped_column(primary_key=True)
    profile_id: Mapped[int] = mapped_column(ForeignKey("profiles.id"), index=True)
    project_site_id: Mapped[int] = mapped_column(
        ForeignKey("project_sites.id"),
        index=True,
    )
    crawl_persona_id: Mapped[int | None] = mapped_column(
        ForeignKey("crawl_personas.id"),
        index=True,
        nullable=True,
    )

    status: Mapped[str] = mapped_column(String(30), default="CREATED")
    started_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    pages_total: Mapped[int] = mapped_column(Integer, default=0)
    pages_changed: Mapped[int] = mapped_column(Integer, default=0)
    pages_discovered: Mapped[int] = mapped_column(Integer, default=0)
    current_batch_no: Mapped[int] = mapped_column(Integer, default=0)
    current_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    progress_updated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    failure_code: Mapped[str | None] = mapped_column(String(50), nullable=True)
    failure_message: Mapped[str | None] = mapped_column(Text, nullable=True)
