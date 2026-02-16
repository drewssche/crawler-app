from sqlalchemy import ForeignKey, Integer, String, Text
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
