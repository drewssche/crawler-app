from datetime import datetime, timedelta
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.exc import IntegrityError
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.api_response import success_response_payload
from app.core.security import require_permission
from app.crawler.login_capture import (
    ManagedLoginCaptureUnavailable,
    cancel_managed_login_session,
    capture_managed_login_session_state,
    capture_managed_login_state,
    get_managed_login_session,
    managed_login_capture_available,
    start_managed_login_session,
)
from app.db.models.project import Project
from app.db.models.crawl_persona import CrawlPersona
from app.db.models.crawl_persona_login_capture import CrawlPersonaLoginCapture
from app.db.models.project_site import ProjectSite
from app.db.models.run import Run
from app.db.models.user import User
from app.db.session import get_db
from app.schemas.project_site import ProjectSiteCreate, ProjectSiteOut, ProjectSiteUpdate
from app.services.crawl_personas import ensure_guest_persona
from app.services.persona_secrets import decrypt_session_bundle, encrypt_session_bundle, summarize_session_bundle
from app.services.project_sites import build_project_site
from app.services.site_anomalies import evaluate_project_site_anomalies

router = APIRouter(prefix="/projects/{project_id}/sites", tags=["project-sites"])


class CrawlPersonaCreate(BaseModel):
    key: str = Field(min_length=2, max_length=80, pattern=r"^[a-z0-9][a-z0-9_-]*$")
    label: str = Field(min_length=1, max_length=160)
    kind: str = Field(default="authenticated", min_length=2, max_length=40)
    description: str = Field(default="", max_length=1000)
    is_default: bool = False
    is_enabled: bool = True


class PersonaSessionBundleIn(BaseModel):
    bundle: dict = Field(default_factory=dict)
    expires_at: datetime | None = None


class PersonaLoginCaptureCreate(BaseModel):
    login_url: str | None = Field(default=None, max_length=2048)
    ttl_minutes: int = Field(default=30, ge=5, le=180)


class PersonaLoginCaptureComplete(BaseModel):
    storage_state: dict = Field(default_factory=dict)
    session_storage: dict | None = None
    extra_http_headers: dict | None = None
    expires_at: datetime | None = None


class PersonaLoginCaptureManagedComplete(BaseModel):
    wait_seconds: int = Field(default=0, ge=0, le=120)
    expires_at: datetime | None = None


class PersonaLoginCaptureManagedSessionCreate(BaseModel):
    ttl_minutes: int = Field(default=30, ge=5, le=180)


class PersonaLoginCaptureManagedSessionSave(BaseModel):
    session_id: str = Field(min_length=12, max_length=160)
    expires_at: datetime | None = None
    force: bool = False


def _capture_payload(capture: CrawlPersonaLoginCapture) -> dict:
    managed_available = managed_login_capture_available()
    return {
        "id": capture.id,
        "crawl_persona_id": capture.crawl_persona_id,
        "project_site_id": capture.project_site_id,
        "status": capture.status,
        "mode": "managed_browser" if managed_available else "manual_storage_state",
        "managed_browser_available": managed_available,
        "managed_browser_status": "available" if managed_available else "planned",
        "login_url": capture.login_url,
        "expires_at": capture.expires_at.isoformat() if capture.expires_at else None,
        "completed_at": capture.completed_at.isoformat() if capture.completed_at else None,
        "cancelled_at": capture.cancelled_at.isoformat() if capture.cancelled_at else None,
        "created_at": capture.created_at.isoformat() if capture.created_at else None,
        "instructions": (
            "Откройте login_url, войдите как нужная роль и сохраните сессию. "
            "Если managed browser включён, backend заберёт storageState из управляемой сессии; "
            "иначе используйте ручную вставку Playwright storageState. Значения cookies/tokens не возвращаются в UI "
            "и после complete хранятся encrypted-at-rest."
        ),
    }


def _expire_pending_login_captures(db: Session, *, persona_id: int | None = None) -> int:
    query = db.query(CrawlPersonaLoginCapture).filter(
        CrawlPersonaLoginCapture.status == "PENDING",
        CrawlPersonaLoginCapture.expires_at <= datetime.utcnow(),
    )
    if persona_id is not None:
        query = query.filter(CrawlPersonaLoginCapture.crawl_persona_id == persona_id)
    rows = query.all()
    for row in rows:
        row.status = "EXPIRED"
    if rows:
        db.flush()
    return len(rows)


def _active_login_capture(db: Session, *, persona_id: int) -> CrawlPersonaLoginCapture | None:
    _expire_pending_login_captures(db, persona_id=persona_id)
    return (
        db.query(CrawlPersonaLoginCapture)
        .filter(
            CrawlPersonaLoginCapture.crawl_persona_id == persona_id,
            CrawlPersonaLoginCapture.status == "PENDING",
        )
        .order_by(CrawlPersonaLoginCapture.created_at.desc(), CrawlPersonaLoginCapture.id.desc())
        .first()
    )


def _safe_login_url(site: ProjectSite, raw_url: str | None) -> str:
    login_url = (raw_url or site.start_url or "").strip()
    parsed = urlparse(login_url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise HTTPException(status_code=422, detail="Login URL must be an absolute http(s) URL.")
    allowed = {x.strip().lower() for x in (site.allowed_domains_csv or "").split(",") if x.strip()}
    if not allowed:
        host = (urlparse(site.start_url).hostname or "").lower()
        allowed = {host} if host else set()
    host = (parsed.hostname or "").lower()
    if allowed and not any(host == domain or host.endswith(f".{domain}") for domain in allowed):
        raise HTTPException(
            status_code=422,
            detail={
                "code": "login_url_outside_site_scope",
                "message": "Login URL должен находиться в домене выбранного сайта.",
            },
        )
    return login_url


def _browser_capture_bundle(payload: PersonaLoginCaptureComplete) -> dict:
    state = payload.storage_state or {}
    cookies = state.get("cookies") if isinstance(state, dict) else []
    origins = state.get("origins") if isinstance(state, dict) else []
    bundle = {
        "source": "browser_login_capture",
        "captured_at": datetime.utcnow().isoformat(),
        "cookies": cookies if isinstance(cookies, list) else [],
        "origins": origins if isinstance(origins, list) else [],
    }
    if payload.session_storage:
        bundle["sessionStorage"] = payload.session_storage
    if payload.extra_http_headers:
        bundle["headers"] = payload.extra_http_headers
    return bundle


def _managed_browser_capture_bundle(storage_state: dict, *, result: dict | None = None) -> dict:
    state = storage_state or {}
    cookies = state.get("cookies") if isinstance(state, dict) else []
    origins = state.get("origins") if isinstance(state, dict) else []
    bundle = {
        "source": "managed_browser_login_capture",
        "captured_at": datetime.utcnow().isoformat(),
        "cookies": cookies if isinstance(cookies, list) else [],
        "origins": origins if isinstance(origins, list) else [],
    }
    if result:
        bundle["capture_metadata"] = result
    return bundle


def _empty_session_summary(status: str) -> dict:
    return {
        "status": status,
        "expiry_status": "none",
        "expires_in_days": None,
        "http_applicable": False,
        "browser_state_stored": False,
        "cookies_count": 0,
        "headers_count": 0,
        "local_storage_count": 0,
        "session_storage_count": 0,
        "applied_now": [],
        "stored_for_browser": [],
        "values_exposed": False,
    }


def _session_expiry_summary(expires_at: datetime | None) -> dict:
    if expires_at is None:
        return {"expiry_status": "none", "expires_in_days": None}
    now = datetime.now(expires_at.tzinfo) if expires_at.tzinfo else datetime.utcnow()
    if expires_at <= now:
        return {"expiry_status": "expired", "expires_in_days": 0}
    delta = expires_at - now
    expires_in_days = max(1, int(delta.total_seconds() // 86_400) + 1)
    if expires_at <= now + timedelta(days=7):
        return {"expiry_status": "expiring", "expires_in_days": expires_in_days}
    return {"expiry_status": "active", "expires_in_days": expires_in_days}


def _persona_session_bundle_summary(persona: CrawlPersona) -> dict:
    if persona.kind == "guest":
        return _empty_session_summary("not_required")
    if not persona.has_secrets or not persona.encrypted_session_bundle:
        return _empty_session_summary("missing")
    try:
        return {
            **summarize_session_bundle(decrypt_session_bundle(persona.encrypted_session_bundle)),
            **_session_expiry_summary(persona.session_bundle_expires_at),
        }
    except ValueError:
        return _empty_session_summary("unavailable")


def _persona_payload(persona: CrawlPersona) -> dict:
    return {
        "id": persona.id,
        "project_site_id": persona.project_site_id,
        "key": persona.key,
        "label": persona.label,
        "kind": persona.kind,
        "description": persona.description,
        "is_default": persona.is_default,
        "is_enabled": persona.is_enabled,
        "has_secrets": persona.has_secrets,
        "session_bundle_updated_at": persona.session_bundle_updated_at,
        "session_bundle_expires_at": persona.session_bundle_expires_at,
        "session_bundle_summary": _persona_session_bundle_summary(persona),
        "secret_version": persona.secret_version,
    }


def _get_project_or_404(db: Session, project_id: int) -> Project:
    project = db.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


def _get_site_or_404(db: Session, project_id: int, site_id: int) -> ProjectSite:
    site = (
        db.query(ProjectSite)
        .filter(ProjectSite.id == site_id, ProjectSite.project_id == project_id)
        .first()
    )
    if not site:
        raise HTTPException(status_code=404, detail="Project site not found")
    return site


def _pending_login_capture_or_404(
    db: Session,
    *,
    site_id: int,
    persona_id: int,
    capture_id: int,
) -> CrawlPersonaLoginCapture:
    capture = (
        db.query(CrawlPersonaLoginCapture)
        .filter(
            CrawlPersonaLoginCapture.id == capture_id,
            CrawlPersonaLoginCapture.project_site_id == site_id,
            CrawlPersonaLoginCapture.crawl_persona_id == persona_id,
        )
        .first()
    )
    if capture is None:
        raise HTTPException(status_code=404, detail="Login capture not found")
    if capture.status != "PENDING":
        raise HTTPException(
            status_code=409,
            detail={
                "code": "login_capture_not_pending",
                "message": "Этот сеанс подключения уже завершён, отменён или истёк.",
            },
        )
    if capture.expires_at <= datetime.utcnow():
        capture.status = "EXPIRED"
        db.commit()
        raise HTTPException(
            status_code=409,
            detail={
                "code": "login_capture_expired",
                "message": "Сеанс подключения истёк. Запустите подключение сессии заново.",
            },
        )
    return capture


def _complete_login_capture_with_bundle(
    db: Session,
    *,
    capture: CrawlPersonaLoginCapture,
    persona: CrawlPersona,
    bundle: dict,
    expires_at: datetime | None,
) -> None:
    try:
        encrypted, fingerprint = encrypt_session_bundle(bundle)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    persona.encrypted_session_bundle = encrypted
    persona.session_bundle_fingerprint = fingerprint
    persona.session_bundle_updated_at = datetime.utcnow()
    persona.session_bundle_expires_at = expires_at
    persona.secret_version = int(persona.secret_version or 0) + 1
    persona.has_secrets = True
    capture.status = "COMPLETED"
    capture.completed_at = datetime.utcnow()


def _managed_capture_complete_payload(
    db: Session,
    *,
    request: Request,
    capture: CrawlPersonaLoginCapture,
    persona: CrawlPersona,
    result,
    expires_at: datetime | None,
    force: bool = False,
) -> dict:
    readiness = getattr(result, "readiness", None) or {}
    if readiness and not readiness.get("ready") and not force:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "managed_login_session_not_ready",
                "message": "Похоже, вход ещё не завершён. Проверьте управляемое окно или сохраните принудительно, если это ожидаемое состояние.",
                "readiness": readiness,
            },
        )
    _complete_login_capture_with_bundle(
        db,
        capture=capture,
        persona=persona,
        bundle=_managed_browser_capture_bundle(
            result.storage_state,
            result={
                "final_url": result.final_url,
                "page_title": result.page_title,
                "readiness": readiness,
                "values_exposed": False,
            },
        ),
        expires_at=expires_at,
    )
    db.commit()
    db.refresh(persona)
    db.refresh(capture)
    return success_response_payload(
        request,
        data={
            "capture": _capture_payload(capture),
            "persona": _persona_payload(persona),
        },
    )


def _scope_conflict() -> HTTPException:
    return HTTPException(
        status_code=409,
        detail={
            "code": "project_site_scope_conflict",
            "message": "Сайт с такой областью сканирования уже добавлен в проект.",
        },
    )


@router.get("")
def list_project_sites(
    project_id: int,
    request: Request,
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_permission("data.view")),
):
    _get_project_or_404(db, project_id)
    rows = (
        db.query(ProjectSite)
        .filter(ProjectSite.project_id == project_id)
        .order_by(ProjectSite.sort_order.asc(), ProjectSite.id.asc())
        .all()
    )
    data = [ProjectSiteOut.model_validate(row).model_dump() for row in rows]
    return success_response_payload(request, data=data)


@router.get("/summary")
def list_project_sites_summary(
    project_id: int,
    request: Request,
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_permission("data.view")),
):
    _get_project_or_404(db, project_id)
    last_run_sq = (
        db.query(
            Run.project_site_id.label("project_site_id"),
            func.max(Run.id).label("last_run_id"),
        )
        .group_by(Run.project_site_id)
        .subquery()
    )
    runs_count_sq = (
        db.query(
            Run.project_site_id.label("project_site_id"),
            func.count(Run.id).label("runs_total"),
        )
        .group_by(Run.project_site_id)
        .subquery()
    )
    rows = (
        db.query(
            ProjectSite,
            Run.id.label("last_run_id"),
            Run.status.label("last_run_status"),
            Run.crawl_runtime.label("last_run_crawl_runtime"),
            Run.started_at.label("last_run_started_at"),
            Run.finished_at.label("last_run_finished_at"),
            Run.pages_total.label("last_run_pages_total"),
            Run.pages_changed.label("last_run_pages_changed"),
            Run.failure_code.label("last_run_failure_code"),
            Run.failure_message.label("last_run_failure_message"),
            CrawlPersona.id.label("last_run_persona_id"),
            CrawlPersona.key.label("last_run_persona_key"),
            CrawlPersona.label.label("last_run_persona_label"),
            CrawlPersona.kind.label("last_run_persona_kind"),
            func.coalesce(runs_count_sq.c.runs_total, 0).label("runs_total"),
        )
        .outerjoin(last_run_sq, last_run_sq.c.project_site_id == ProjectSite.id)
        .outerjoin(Run, Run.id == last_run_sq.c.last_run_id)
        .outerjoin(CrawlPersona, CrawlPersona.id == Run.crawl_persona_id)
        .outerjoin(runs_count_sq, runs_count_sq.c.project_site_id == ProjectSite.id)
        .filter(ProjectSite.project_id == project_id)
        .order_by(ProjectSite.sort_order.asc(), ProjectSite.id.asc())
        .all()
    )
    anomalies_by_site = evaluate_project_site_anomalies(
        db,
        [row.ProjectSite.id for row in rows],
    )
    default_personas = {
        persona.project_site_id: persona
        for persona in (
            db.query(CrawlPersona)
            .filter(
                CrawlPersona.project_site_id.in_([row.ProjectSite.id for row in rows]),
                CrawlPersona.is_default.is_(True),
            )
            .all()
        )
    }
    data = []
    for row in rows:
        default_persona = default_personas.get(row.ProjectSite.id)
        site_data = ProjectSiteOut.model_validate(row.ProjectSite).model_dump()
        site_data["runs_total"] = int(row.runs_total or 0)
        site_data["default_persona"] = (
            None
            if default_persona is None
            else {
                "id": default_persona.id,
                "key": default_persona.key,
                "label": default_persona.label,
                "kind": default_persona.kind,
                "has_secrets": default_persona.has_secrets,
            }
        )
        site_data["anomaly"] = anomalies_by_site.get(row.ProjectSite.id)
        site_data["last_run"] = (
            None
            if row.last_run_id is None
            else {
                "id": row.last_run_id,
                "status": row.last_run_status,
                "crawl_runtime": row.last_run_crawl_runtime,
                "started_at": row.last_run_started_at,
                "finished_at": row.last_run_finished_at,
                "pages_total": int(row.last_run_pages_total or 0),
                "pages_changed": int(row.last_run_pages_changed or 0),
                "failure_code": row.last_run_failure_code,
                "failure_message": row.last_run_failure_message,
                "crawl_persona_id": row.last_run_persona_id,
                "persona": (
                    None
                    if row.last_run_persona_id is None
                    else {
                        "id": row.last_run_persona_id,
                        "key": row.last_run_persona_key,
                        "label": row.last_run_persona_label,
                        "kind": row.last_run_persona_kind,
                    }
                ),
            }
        )
        data.append(site_data)
    return success_response_payload(request, data=data)


@router.get("/{site_id}/anomaly")
def get_project_site_anomaly(
    project_id: int,
    site_id: int,
    request: Request,
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_permission("data.view")),
):
    _get_site_or_404(db, project_id, site_id)
    anomaly = evaluate_project_site_anomalies(db, [site_id])[site_id]
    return success_response_payload(request, data=anomaly)


@router.get("/{site_id}/personas")
def list_project_site_personas(
    project_id: int,
    site_id: int,
    request: Request,
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_permission("data.view")),
):
    site = _get_site_or_404(db, project_id, site_id)
    ensure_guest_persona(db, site)
    rows = (
        db.query(CrawlPersona)
        .filter(CrawlPersona.project_site_id == site_id)
        .order_by(CrawlPersona.is_default.desc(), CrawlPersona.id.asc())
        .all()
    )
    return success_response_payload(request, data=[_persona_payload(row) for row in rows])


@router.post("/{site_id}/personas")
def create_project_site_persona(
    project_id: int,
    site_id: int,
    payload: CrawlPersonaCreate,
    request: Request,
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_permission("projects.edit")),
):
    _get_site_or_404(db, project_id, site_id)
    if payload.key == "guest" and payload.kind != "guest":
        raise HTTPException(status_code=422, detail="Reserved key guest must use kind guest.")
    if payload.is_default:
        db.query(CrawlPersona).filter(CrawlPersona.project_site_id == site_id).update(
            {CrawlPersona.is_default: False},
            synchronize_session=False,
        )
    persona = CrawlPersona(
        project_site_id=site_id,
        key=payload.key,
        label=payload.label.strip(),
        kind=payload.kind.strip(),
        description=payload.description.strip(),
        is_default=payload.is_default,
        is_enabled=payload.is_enabled,
        has_secrets=False,
    )
    db.add(persona)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail={
                "code": "crawl_persona_key_conflict",
                "message": "Персона с таким ключом уже есть у сайта.",
            },
        ) from exc
    db.refresh(persona)
    return success_response_payload(request, data=_persona_payload(persona))


@router.put("/{site_id}/personas/{persona_id}/session-bundle")
def update_project_site_persona_session_bundle(
    project_id: int,
    site_id: int,
    persona_id: int,
    payload: PersonaSessionBundleIn,
    request: Request,
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_permission("projects.edit")),
):
    _get_site_or_404(db, project_id, site_id)
    persona = (
        db.query(CrawlPersona)
        .filter(CrawlPersona.id == persona_id, CrawlPersona.project_site_id == site_id)
        .first()
    )
    if persona is None:
        raise HTTPException(status_code=404, detail="Crawl persona not found")
    if persona.kind == "guest":
        raise HTTPException(
            status_code=409,
            detail={
                "code": "guest_persona_cannot_store_session",
                "message": "Гостевой контекст не должен содержать cookies/session secrets.",
            },
        )
    try:
        encrypted, fingerprint = encrypt_session_bundle(payload.bundle)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    persona.encrypted_session_bundle = encrypted
    persona.session_bundle_fingerprint = fingerprint
    persona.session_bundle_updated_at = datetime.utcnow()
    persona.session_bundle_expires_at = payload.expires_at
    persona.secret_version = int(persona.secret_version or 0) + 1
    persona.has_secrets = True
    db.commit()
    db.refresh(persona)
    return success_response_payload(request, data=_persona_payload(persona))


@router.delete("/{site_id}/personas/{persona_id}/session-bundle")
def delete_project_site_persona_session_bundle(
    project_id: int,
    site_id: int,
    persona_id: int,
    request: Request,
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_permission("projects.edit")),
):
    _get_site_or_404(db, project_id, site_id)
    persona = (
        db.query(CrawlPersona)
        .filter(CrawlPersona.id == persona_id, CrawlPersona.project_site_id == site_id)
        .first()
    )
    if persona is None:
        raise HTTPException(status_code=404, detail="Crawl persona not found")
    persona.encrypted_session_bundle = None
    persona.session_bundle_fingerprint = None
    persona.session_bundle_updated_at = None
    persona.session_bundle_expires_at = None
    persona.has_secrets = False
    persona.secret_version = int(persona.secret_version or 0) + 1
    db.commit()
    db.refresh(persona)
    return success_response_payload(request, data=_persona_payload(persona))


@router.post("/{site_id}/personas/{persona_id}/login-captures")
def create_project_site_persona_login_capture(
    project_id: int,
    site_id: int,
    persona_id: int,
    payload: PersonaLoginCaptureCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("projects.edit")),
):
    site = _get_site_or_404(db, project_id, site_id)
    persona = (
        db.query(CrawlPersona)
        .filter(CrawlPersona.id == persona_id, CrawlPersona.project_site_id == site_id)
        .first()
    )
    if persona is None:
        raise HTTPException(status_code=404, detail="Crawl persona not found")
    if persona.kind == "guest":
        raise HTTPException(
            status_code=409,
            detail={
                "code": "guest_persona_cannot_capture_login",
                "message": "Гостевой контекст не должен содержать login/session state.",
            },
        )
    active_capture = _active_login_capture(db, persona_id=persona.id)
    if active_capture is not None:
        db.commit()
        raise HTTPException(
            status_code=409,
            detail={
                "code": "login_capture_already_active",
                "message": "Для этой персоны уже открыт сеанс подключения. Завершите или отмените его перед новым запуском.",
                "capture": _capture_payload(active_capture),
            },
        )
    capture = CrawlPersonaLoginCapture(
        crawl_persona_id=persona.id,
        project_site_id=site.id,
        created_by_user_id=current_user.id,
        status="PENDING",
        login_url=_safe_login_url(site, payload.login_url),
        expires_at=datetime.utcnow() + timedelta(minutes=payload.ttl_minutes),
        created_at=datetime.utcnow(),
    )
    db.add(capture)
    db.commit()
    db.refresh(capture)
    return success_response_payload(request, data=_capture_payload(capture))


@router.get("/{site_id}/personas/{persona_id}/login-captures/{capture_id}")
def get_project_site_persona_login_capture(
    project_id: int,
    site_id: int,
    persona_id: int,
    capture_id: int,
    request: Request,
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_permission("projects.edit")),
):
    _get_site_or_404(db, project_id, site_id)
    capture = (
        db.query(CrawlPersonaLoginCapture)
        .filter(
            CrawlPersonaLoginCapture.id == capture_id,
            CrawlPersonaLoginCapture.project_site_id == site_id,
            CrawlPersonaLoginCapture.crawl_persona_id == persona_id,
        )
        .first()
    )
    if capture is None:
        raise HTTPException(status_code=404, detail="Login capture not found")
    if capture.status == "PENDING":
        _expire_pending_login_captures(db, persona_id=persona_id)
        db.commit()
        db.refresh(capture)
    return success_response_payload(request, data=_capture_payload(capture))


@router.post("/{site_id}/personas/{persona_id}/login-captures/{capture_id}/complete")
def complete_project_site_persona_login_capture(
    project_id: int,
    site_id: int,
    persona_id: int,
    capture_id: int,
    payload: PersonaLoginCaptureComplete,
    request: Request,
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_permission("projects.edit")),
):
    _get_site_or_404(db, project_id, site_id)
    capture = _pending_login_capture_or_404(db, site_id=site_id, persona_id=persona_id, capture_id=capture_id)
    persona = db.get(CrawlPersona, persona_id)
    if persona is None or persona.project_site_id != site_id:
        raise HTTPException(status_code=404, detail="Crawl persona not found")
    _complete_login_capture_with_bundle(
        db,
        capture=capture,
        persona=persona,
        bundle=_browser_capture_bundle(payload),
        expires_at=payload.expires_at,
    )
    db.commit()
    db.refresh(persona)
    db.refresh(capture)
    return success_response_payload(
        request,
        data={
            "capture": _capture_payload(capture),
            "persona": _persona_payload(persona),
        },
    )


@router.post("/{site_id}/personas/{persona_id}/login-captures/{capture_id}/capture-managed")
def capture_project_site_persona_login_managed_state(
    project_id: int,
    site_id: int,
    persona_id: int,
    capture_id: int,
    payload: PersonaLoginCaptureManagedComplete,
    request: Request,
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_permission("projects.edit")),
):
    _get_site_or_404(db, project_id, site_id)
    capture = _pending_login_capture_or_404(db, site_id=site_id, persona_id=persona_id, capture_id=capture_id)
    persona = db.get(CrawlPersona, persona_id)
    if persona is None or persona.project_site_id != site_id:
        raise HTTPException(status_code=404, detail="Crawl persona not found")
    try:
        result = capture_managed_login_state(capture.login_url, wait_seconds=payload.wait_seconds)
    except ManagedLoginCaptureUnavailable as exc:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "managed_login_capture_unavailable",
                "message": (
                    "Автоматический захват сессии из управляемого браузера ещё не включён. "
                    "Используйте ручную вставку Playwright storageState или включите managed capture на backend."
                ),
            },
        ) from exc
    return _managed_capture_complete_payload(
        db,
        request=request,
        capture=capture,
        persona=persona,
        result=result,
        expires_at=payload.expires_at,
        force=True,
    )


@router.post("/{site_id}/personas/{persona_id}/login-captures/{capture_id}/managed-session")
def start_project_site_persona_login_managed_session(
    project_id: int,
    site_id: int,
    persona_id: int,
    capture_id: int,
    payload: PersonaLoginCaptureManagedSessionCreate,
    request: Request,
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_permission("projects.edit")),
):
    _get_site_or_404(db, project_id, site_id)
    capture = _pending_login_capture_or_404(db, site_id=site_id, persona_id=persona_id, capture_id=capture_id)
    try:
        session = start_managed_login_session(capture.login_url, ttl_minutes=payload.ttl_minutes)
    except ManagedLoginCaptureUnavailable as exc:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "managed_login_capture_unavailable",
                "message": (
                    "Управляемая browser-сессия ещё не включена на backend. "
                    "Используйте ручную вставку Playwright storageState."
                ),
            },
        ) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail={
                "code": "managed_login_session_failed",
                "message": "Не удалось открыть управляемую browser-сессию для входа.",
            },
        ) from exc
    return success_response_payload(request, data={"capture": _capture_payload(capture), "session": session})


@router.get("/{site_id}/personas/{persona_id}/login-captures/{capture_id}/managed-session/{session_id}")
def get_project_site_persona_login_managed_session(
    project_id: int,
    site_id: int,
    persona_id: int,
    capture_id: int,
    session_id: str,
    request: Request,
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_permission("projects.edit")),
):
    _get_site_or_404(db, project_id, site_id)
    _pending_login_capture_or_404(db, site_id=site_id, persona_id=persona_id, capture_id=capture_id)
    try:
        session = get_managed_login_session(session_id)
    except KeyError as exc:
        raise HTTPException(
            status_code=404,
            detail={
                "code": "managed_login_session_not_found",
                "message": "Управляемая browser-сессия не найдена или уже истекла.",
            },
        ) from exc
    return success_response_payload(request, data=session)


@router.post("/{site_id}/personas/{persona_id}/login-captures/{capture_id}/managed-session/save")
def save_project_site_persona_login_managed_session(
    project_id: int,
    site_id: int,
    persona_id: int,
    capture_id: int,
    payload: PersonaLoginCaptureManagedSessionSave,
    request: Request,
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_permission("projects.edit")),
):
    _get_site_or_404(db, project_id, site_id)
    capture = _pending_login_capture_or_404(db, site_id=site_id, persona_id=persona_id, capture_id=capture_id)
    persona = db.get(CrawlPersona, persona_id)
    if persona is None or persona.project_site_id != site_id:
        raise HTTPException(status_code=404, detail="Crawl persona not found")
    try:
        result = capture_managed_login_session_state(payload.session_id)
    except KeyError as exc:
        raise HTTPException(
            status_code=404,
            detail={
                "code": "managed_login_session_not_found",
                "message": "Управляемая browser-сессия не найдена или уже истекла.",
            },
        ) from exc
    except ManagedLoginCaptureUnavailable as exc:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "managed_login_capture_unavailable",
                "message": "Управляемая browser-сессия уже не активна. Запустите подключение заново.",
            },
        ) from exc
    return _managed_capture_complete_payload(
        db,
        request=request,
        capture=capture,
        persona=persona,
        result=result,
        expires_at=payload.expires_at,
        force=payload.force,
    )


@router.post("/{site_id}/personas/{persona_id}/login-captures/{capture_id}/managed-session/{session_id}/cancel")
def cancel_project_site_persona_login_managed_session(
    project_id: int,
    site_id: int,
    persona_id: int,
    capture_id: int,
    session_id: str,
    request: Request,
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_permission("projects.edit")),
):
    _get_site_or_404(db, project_id, site_id)
    _pending_login_capture_or_404(db, site_id=site_id, persona_id=persona_id, capture_id=capture_id)
    try:
        session = cancel_managed_login_session(session_id)
    except KeyError as exc:
        raise HTTPException(
            status_code=404,
            detail={
                "code": "managed_login_session_not_found",
                "message": "Управляемая browser-сессия не найдена или уже истекла.",
            },
        ) from exc
    return success_response_payload(request, data=session)


@router.post("/{site_id}/personas/{persona_id}/login-captures/{capture_id}/cancel")
def cancel_project_site_persona_login_capture(
    project_id: int,
    site_id: int,
    persona_id: int,
    capture_id: int,
    request: Request,
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_permission("projects.edit")),
):
    _get_site_or_404(db, project_id, site_id)
    capture = (
        db.query(CrawlPersonaLoginCapture)
        .filter(
            CrawlPersonaLoginCapture.id == capture_id,
            CrawlPersonaLoginCapture.project_site_id == site_id,
            CrawlPersonaLoginCapture.crawl_persona_id == persona_id,
        )
        .first()
    )
    if capture is None:
        raise HTTPException(status_code=404, detail="Login capture not found")
    if capture.status == "PENDING":
        capture.status = "CANCELLED"
        capture.cancelled_at = datetime.utcnow()
        db.commit()
        db.refresh(capture)
    return success_response_payload(request, data=_capture_payload(capture))


@router.post("")
def create_project_site(
    project_id: int,
    payload: ProjectSiteCreate,
    request: Request,
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_permission("projects.edit")),
):
    _get_project_or_404(db, project_id)
    next_order = (
        db.query(ProjectSite)
        .filter(ProjectSite.project_id == project_id)
        .count()
    )
    try:
        site = build_project_site(
            project_id=project_id,
            name=payload.name,
            start_url=str(payload.start_url),
            scope_mode=payload.scope_mode,
            path_prefix=payload.path_prefix,
            role=payload.role,
            allowed_domains_csv=payload.allowed_domains_csv,
            exclude_paths_csv=payload.exclude_paths_csv,
            exclude_ext_csv=payload.exclude_ext_csv,
            respect_robots=payload.respect_robots,
            max_pages=payload.max_pages,
            concurrency=payload.concurrency,
            is_enabled=payload.is_enabled,
            sort_order=next_order,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    db.add(site)
    try:
        db.flush()
        ensure_guest_persona(db, site)
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise _scope_conflict() from exc
    db.refresh(site)
    return success_response_payload(
        request,
        data=ProjectSiteOut.model_validate(site).model_dump(),
    )


@router.patch("/{site_id}")
def update_project_site(
    project_id: int,
    site_id: int,
    payload: ProjectSiteUpdate,
    request: Request,
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_permission("projects.edit")),
):
    site = _get_site_or_404(db, project_id, site_id)
    changes = payload.model_dump(exclude_unset=True)
    nullable_fields = {
        key
        for key, value in changes.items()
        if value is None and key != "path_prefix"
    }
    if nullable_fields:
        raise HTTPException(
            status_code=422,
            detail=f"Fields cannot be null: {', '.join(sorted(nullable_fields))}",
        )
    start_url = str(changes.pop("start_url", site.start_url))
    scope_mode = changes.pop("scope_mode", site.scope_mode)
    path_prefix = changes.pop("path_prefix", site.path_prefix)
    if "path_prefix" in payload.model_fields_set and "start_url" not in payload.model_fields_set:
        start_url = site.canonical_origin
    if {"start_url", "scope_mode", "path_prefix"} & payload.model_fields_set:
        try:
            normalized = build_project_site(
                project_id=project_id,
                name=str(changes.get("name", site.name)),
                start_url=start_url,
                scope_mode=str(scope_mode),
                path_prefix=str(path_prefix) if path_prefix is not None else None,
                role=str(changes.get("role", site.role)),
                allowed_domains_csv=str(changes.get("allowed_domains_csv", site.allowed_domains_csv)),
                exclude_paths_csv=str(changes.get("exclude_paths_csv", site.exclude_paths_csv)),
                exclude_ext_csv=str(changes.get("exclude_ext_csv", site.exclude_ext_csv)),
                respect_robots=bool(changes.get("respect_robots", site.respect_robots)),
                max_pages=int(changes.get("max_pages", site.max_pages)),
                concurrency=int(changes.get("concurrency", site.concurrency)),
                is_enabled=bool(changes.get("is_enabled", site.is_enabled)),
                sort_order=site.sort_order,
            )
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        site.start_url = normalized.start_url
        site.canonical_origin = normalized.canonical_origin
        site.scope_mode = normalized.scope_mode
        site.path_prefix = normalized.path_prefix

    for key, value in changes.items():
        setattr(site, key, value)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise _scope_conflict() from exc
    db.refresh(site)
    return success_response_payload(
        request,
        data=ProjectSiteOut.model_validate(site).model_dump(),
    )


@router.delete("/{site_id}")
def delete_project_site(
    project_id: int,
    site_id: int,
    request: Request,
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_permission("projects.edit")),
):
    site = _get_site_or_404(db, project_id, site_id)
    runs_count = db.query(Run).filter(Run.project_site_id == site_id).count()
    if runs_count:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "project_site_has_runs",
                "message": "У сайта уже есть история запусков. Отключите сайт вместо удаления.",
                "runs_count": runs_count,
            },
        )
    site_count = db.query(ProjectSite).filter(ProjectSite.project_id == project_id).count()
    if site_count <= 1:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "project_requires_site",
                "message": "В проекте должен оставаться хотя бы один сайт.",
            },
        )
    db.query(CrawlPersona).filter(CrawlPersona.project_site_id == site_id).delete(synchronize_session=False)
    db.delete(site)
    db.commit()
    return success_response_payload(request, data={"deleted": True, "site_id": site_id})
