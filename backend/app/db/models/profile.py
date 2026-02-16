from sqlalchemy import String, Integer, Boolean, Text
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base


class Profile(Base):
    __tablename__ = "profiles"

    id: Mapped[int] = mapped_column(primary_key=True)

    name: Mapped[str] = mapped_column(String(200), index=True)
    start_url: Mapped[str] = mapped_column(Text)
    allowed_domains_csv: Mapped[str] = mapped_column(
        Text, default="")  # "bitrix24.ru,bitrix24.by"

    exclude_paths_csv: Mapped[str] = mapped_column(
        Text, default="/bitrix/,/upload/,/local/")
    exclude_ext_csv: Mapped[str] = mapped_column(
        Text, default=".css,.js,.png,.jpg,.jpeg,.webp,.svg,.woff,.woff2,.ttf,.eot,.map")

    respect_robots: Mapped[bool] = mapped_column(Boolean, default=True)
    max_pages: Mapped[int] = mapped_column(Integer, default=5000)
    concurrency: Mapped[int] = mapped_column(Integer, default=3)
    is_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
