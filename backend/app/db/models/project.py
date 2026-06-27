from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[int] = mapped_column(primary_key=True)

    name: Mapped[str] = mapped_column(String(200), index=True)

    def __init__(self, name: str, **site_seed):
        allowed_seed_keys = {
            "start_url",
            "allowed_domains_csv",
            "exclude_paths_csv",
            "exclude_ext_csv",
            "respect_robots",
            "max_pages",
            "concurrency",
            "is_enabled",
        }
        unknown = set(site_seed) - allowed_seed_keys
        if unknown:
            raise TypeError(f"Invalid Project seed fields: {', '.join(sorted(unknown))}")
        self.name = name
        self._primary_site_seed = site_seed
