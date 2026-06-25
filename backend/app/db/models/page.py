from sqlalchemy import JSON, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Page(Base):
    __tablename__ = "pages"

    id: Mapped[int] = mapped_column(primary_key=True)
    run_id: Mapped[int] = mapped_column(ForeignKey("runs.id"), index=True)

    url: Mapped[str] = mapped_column(Text)
    status_code: Mapped[int] = mapped_column(Integer)
    content_type: Mapped[str] = mapped_column(String(200), default="")
    html: Mapped[str] = mapped_column(Text, default="")
    html_hash: Mapped[str] = mapped_column(String(64), default="")
    final_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    final_status_code: Mapped[int | None] = mapped_column(Integer, nullable=True)
    redirect_chain_json: Mapped[list | None] = mapped_column(JSON, nullable=True)
    fetch_error_code: Mapped[str | None] = mapped_column(String(50), nullable=True)
    fetch_error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    response_time_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    crawl_batch_no: Mapped[int | None] = mapped_column(Integer, nullable=True)
