from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class CrawlPersonaLoginCapture(Base):
    __tablename__ = "crawl_persona_login_captures"

    id: Mapped[int] = mapped_column(primary_key=True)
    crawl_persona_id: Mapped[int] = mapped_column(ForeignKey("crawl_personas.id"), index=True)
    project_site_id: Mapped[int] = mapped_column(ForeignKey("project_sites.id"), index=True)
    created_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    status: Mapped[str] = mapped_column(String(24), default="PENDING", index=True)
    login_url: Mapped[str] = mapped_column(String(2048))
    expires_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
