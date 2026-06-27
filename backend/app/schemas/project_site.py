from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, field_validator


SiteScopeMode = Literal["whole_site", "path_prefix"]
SiteRole = Literal["primary", "reference", "target", "peer"]


class ProjectSiteCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    start_url: HttpUrl
    scope_mode: SiteScopeMode = "whole_site"
    path_prefix: str | None = None
    role: SiteRole = "peer"
    allowed_domains_csv: str = ""
    exclude_paths_csv: str = "/bitrix/,/upload/,/local/"
    exclude_ext_csv: str = ".css,.js,.png,.jpg,.jpeg,.webp,.svg,.woff,.woff2,.ttf,.eot,.map"
    respect_robots: bool = True
    max_pages: int = Field(default=5000, ge=1, le=10000)
    concurrency: int = Field(default=3, ge=1, le=20)
    is_enabled: bool = True

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("Site name cannot be empty")
        return normalized


class ProjectSiteUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    start_url: HttpUrl | None = None
    scope_mode: SiteScopeMode | None = None
    path_prefix: str | None = None
    role: SiteRole | None = None
    allowed_domains_csv: str | None = None
    exclude_paths_csv: str | None = None
    exclude_ext_csv: str | None = None
    respect_robots: bool | None = None
    max_pages: int | None = Field(default=None, ge=1, le=10000)
    concurrency: int | None = Field(default=None, ge=1, le=20)
    is_enabled: bool | None = None

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str | None) -> str | None:
        if value is None:
            return value
        normalized = value.strip()
        if not normalized:
            raise ValueError("Site name cannot be empty")
        return normalized


class ProjectSiteOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    project_id: int
    name: str
    start_url: str
    canonical_origin: str
    scope_mode: SiteScopeMode
    path_prefix: str
    role: SiteRole
    allowed_domains_csv: str
    exclude_paths_csv: str
    exclude_ext_csv: str
    respect_robots: bool
    max_pages: int
    concurrency: int
    is_enabled: bool
    sort_order: int
