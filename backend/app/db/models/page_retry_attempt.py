from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, JSON, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class PageRetryAttempt(Base):
    __tablename__ = "page_retry_attempts"
    __table_args__ = (
        UniqueConstraint("page_id", "attempt_no", name="uq_page_retry_attempt_number"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    run_id: Mapped[int] = mapped_column(ForeignKey("runs.id", ondelete="CASCADE"), index=True)
    page_id: Mapped[int] = mapped_column(ForeignKey("pages.id", ondelete="CASCADE"), index=True)
    attempt_no: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(30))
    started_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    finished_at: Mapped[datetime] = mapped_column(DateTime)
    status_code: Mapped[int | None] = mapped_column(Integer, nullable=True)
    final_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    final_status_code: Mapped[int | None] = mapped_column(Integer, nullable=True)
    redirect_chain_json: Mapped[list | None] = mapped_column(JSON, nullable=True)
    fetch_error_code: Mapped[str | None] = mapped_column(String(50), nullable=True)
    fetch_error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    response_time_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
