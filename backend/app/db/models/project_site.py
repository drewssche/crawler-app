from sqlalchemy import Boolean, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class ProjectSite(Base):
    __tablename__ = "project_sites"
    __table_args__ = (
        UniqueConstraint(
            "profile_id",
            "canonical_origin",
            "path_prefix",
            name="uq_project_sites_profile_scope",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    profile_id: Mapped[int] = mapped_column(
        ForeignKey("profiles.id", ondelete="CASCADE"),
        index=True,
    )
    name: Mapped[str] = mapped_column(String(200))
    start_url: Mapped[str] = mapped_column(Text)
    canonical_origin: Mapped[str] = mapped_column(String(500))
    scope_mode: Mapped[str] = mapped_column(String(30), default="whole_site")
    path_prefix: Mapped[str] = mapped_column(String(1000), default="/")
    role: Mapped[str] = mapped_column(String(30), default="primary")
    allowed_domains_csv: Mapped[str] = mapped_column(Text, default="")
    exclude_paths_csv: Mapped[str] = mapped_column(Text, default="")
    exclude_ext_csv: Mapped[str] = mapped_column(Text, default="")
    respect_robots: Mapped[bool] = mapped_column(Boolean, default=True)
    max_pages: Mapped[int] = mapped_column(Integer, default=5000)
    concurrency: Mapped[int] = mapped_column(Integer, default=3)
    is_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
