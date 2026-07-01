from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class PageMonitoringTarget(Base):
    __tablename__ = "page_monitoring_targets"

    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    project_site_id: Mapped[int | None] = mapped_column(ForeignKey("project_sites.id", ondelete="SET NULL"), nullable=True, index=True)
    run_id: Mapped[int] = mapped_column(ForeignKey("runs.id", ondelete="CASCADE"), index=True)
    page_id: Mapped[int] = mapped_column(ForeignKey("pages.id", ondelete="CASCADE"), index=True)
    crawl_persona_id: Mapped[int | None] = mapped_column(ForeignKey("crawl_personas.id", ondelete="SET NULL"), nullable=True, index=True)
    created_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)

    name: Mapped[str] = mapped_column(String(240))
    page_url: Mapped[str] = mapped_column(Text)
    selector: Mapped[str] = mapped_column(Text)
    tag: Mapped[str] = mapped_column(String(80))
    element_text: Mapped[str] = mapped_column(Text, default="")
    element_html: Mapped[str] = mapped_column(Text, default="")
    element_rect_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    fingerprint_hash: Mapped[str] = mapped_column(String(64), index=True)
    fingerprint_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    source: Mapped[str] = mapped_column(String(60), default="rendered_snapshot")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=datetime.utcnow)
