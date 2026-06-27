from sqlalchemy.orm import Session

from app.db.models.crawl_persona import CrawlPersona
from app.db.models.project_site import ProjectSite


GUEST_PERSONA_KEY = "guest"
GUEST_PERSONA_LABEL = "Гость"


def ensure_guest_persona(db: Session, site: ProjectSite) -> CrawlPersona:
    if site.id is None:
        db.flush()
    persona = (
        db.query(CrawlPersona)
        .filter(CrawlPersona.project_site_id == site.id, CrawlPersona.key == GUEST_PERSONA_KEY)
        .first()
    )
    if persona is not None:
        return persona
    persona = CrawlPersona(
        project_site_id=site.id,
        key=GUEST_PERSONA_KEY,
        label=GUEST_PERSONA_LABEL,
        kind="guest",
        description="Неавторизованный посетитель без cookies/session secrets.",
        is_default=True,
        is_enabled=True,
        has_secrets=False,
    )
    db.add(persona)
    db.flush()
    return persona


def get_default_persona(db: Session, site: ProjectSite) -> CrawlPersona:
    persona = (
        db.query(CrawlPersona)
        .filter(
            CrawlPersona.project_site_id == site.id,
            CrawlPersona.is_default.is_(True),
            CrawlPersona.is_enabled.is_(True),
        )
        .order_by(CrawlPersona.id.asc())
        .first()
    )
    if persona is not None:
        return persona
    return ensure_guest_persona(db, site)
