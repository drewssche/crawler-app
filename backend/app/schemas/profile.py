from pydantic import BaseModel, HttpUrl, Field


class ProfileCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    start_url: HttpUrl
    allowed_domains_csv: str = ""

    exclude_paths_csv: str = "/bitrix/,/upload/,/local/"
    exclude_ext_csv: str = ".css,.js,.png,.jpg,.jpeg,.webp,.svg,.woff,.woff2,.ttf,.eot,.map"

    respect_robots: bool = True
    max_pages: int = 5000
    concurrency: int = 3
    is_enabled: bool = True


class ProfileOut(ProfileCreate):
    id: int

    class Config:
        from_attributes = True
