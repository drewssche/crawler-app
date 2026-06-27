from typing import Literal

from pydantic import BaseModel, ConfigDict, HttpUrl, Field


class ProjectBase(BaseModel):
    name: str = Field(min_length=1, max_length=200)


class ProjectSiteSeed(BaseModel):
    start_url: HttpUrl
    allowed_domains_csv: str = ""

    exclude_paths_csv: str = "/bitrix/,/upload/,/local/"
    exclude_ext_csv: str = ".css,.js,.png,.jpg,.jpeg,.webp,.svg,.woff,.woff2,.ttf,.eot,.map"

    respect_robots: bool = True
    max_pages: int = 5000
    concurrency: int = 3
    is_enabled: bool = True


class ProjectCreate(ProjectBase, ProjectSiteSeed):
    site_name: str | None = Field(default=None, min_length=1, max_length=200)
    scope_mode: Literal["whole_site", "path_prefix"] = "whole_site"
    path_prefix: str | None = None


class ProjectOut(ProjectBase):
    id: int
    start_url: str = ""
    allowed_domains_csv: str = ""

    model_config = ConfigDict(from_attributes=True)
