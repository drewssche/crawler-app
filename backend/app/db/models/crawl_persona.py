from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class CrawlPersona(Base):
    __tablename__ = "crawl_personas"
    __table_args__ = (
        UniqueConstraint("project_site_id", "key", name="uq_crawl_personas_site_key"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    project_site_id: Mapped[int] = mapped_column(
        ForeignKey("project_sites.id", ondelete="CASCADE"),
        index=True,
    )
    key: Mapped[str] = mapped_column(String(80))
    label: Mapped[str] = mapped_column(String(160))
    kind: Mapped[str] = mapped_column(String(40), default="guest")
    description: Mapped[str] = mapped_column(Text, default="")
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)
    is_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    has_secrets: Mapped[bool] = mapped_column(Boolean, default=False)
    encrypted_session_bundle: Mapped[str | None] = mapped_column(Text, nullable=True)
    session_bundle_fingerprint: Mapped[str | None] = mapped_column(String(64), nullable=True)
    session_bundle_updated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    session_bundle_expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    secret_version: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
