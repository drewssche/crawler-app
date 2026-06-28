import os
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
from playwright.sync_api import sync_playwright


class ManagedLoginCaptureUnavailable(RuntimeError):
    pass


@dataclass(frozen=True)
class ManagedLoginCaptureResult:
    storage_state: dict
    final_url: str
    page_title: str


@dataclass
class ManagedLoginSession:
    session_id: str
    login_url: str
    status: str
    created_at: datetime
    expires_at: datetime
    final_url: str = ""
    page_title: str = ""
    error_message: str = ""
    playwright: Any = None
    browser: Any = None
    context: Any = None
    page: Any = None


_SESSIONS: dict[str, ManagedLoginSession] = {}


def managed_login_capture_available() -> bool:
    return os.getenv("CRAWL_PERSONA_MANAGED_LOGIN_CAPTURE_ENABLED", "").strip().lower() in {"1", "true", "yes", "on"}


def _headless() -> bool:
    return os.getenv("CRAWL_PERSONA_MANAGED_LOGIN_CAPTURE_HEADLESS", "1").strip().lower() not in {
        "0",
        "false",
        "no",
        "off",
    }


def _close_session(session: ManagedLoginSession) -> None:
    for resource_name in ("context", "browser"):
        resource = getattr(session, resource_name, None)
        if resource is None:
            continue
        try:
            resource.close()
        except Exception:
            pass
    if session.playwright is not None:
        try:
            session.playwright.stop()
        except Exception:
            pass


def _expire_sessions() -> None:
    now = datetime.utcnow()
    for session_id, session in list(_SESSIONS.items()):
        if session.expires_at > now:
            continue
        session.status = "EXPIRED"
        _close_session(session)
        _SESSIONS.pop(session_id, None)


def _session_public_payload(session: ManagedLoginSession) -> dict:
    return {
        "session_id": session.session_id,
        "status": session.status,
        "login_url": session.login_url,
        "final_url": session.final_url or None,
        "page_title": session.page_title or None,
        "created_at": session.created_at.isoformat(),
        "expires_at": session.expires_at.isoformat(),
        "error_message": session.error_message or None,
        "values_exposed": False,
        "instructions": (
            "Откройте управляемое окно, войдите нужной ролью и пройдите MFA. "
            "После этого нажмите «Сохранить сессию» — backend заберёт storageState без показа cookies/tokens в UI."
        ),
    }


def start_managed_login_session(login_url: str, *, ttl_minutes: int = 30) -> dict:
    if not managed_login_capture_available():
        raise ManagedLoginCaptureUnavailable(
            "Managed browser login capture is not enabled. Set CRAWL_PERSONA_MANAGED_LOGIN_CAPTURE_ENABLED=1."
        )
    _expire_sessions()
    session_id = secrets.token_urlsafe(24)
    session = ManagedLoginSession(
        session_id=session_id,
        login_url=login_url,
        status="OPENING",
        created_at=datetime.utcnow(),
        expires_at=datetime.utcnow() + timedelta(minutes=max(5, min(ttl_minutes, 180))),
    )
    try:
        session.playwright = sync_playwright().start()
        session.browser = session.playwright.chromium.launch(headless=_headless())
        session.context = session.browser.new_context(ignore_https_errors=True)
        session.page = session.context.new_page()
        session.page.goto(login_url, wait_until="domcontentloaded", timeout=60_000)
        session.final_url = session.page.url
        session.page_title = session.page.title()
        session.status = "WAITING_FOR_LOGIN"
    except Exception as exc:
        session.status = "FAILED"
        session.error_message = str(exc)
        _close_session(session)
        raise
    _SESSIONS[session_id] = session
    return _session_public_payload(session)


def get_managed_login_session(session_id: str) -> dict:
    _expire_sessions()
    session = _SESSIONS.get(session_id)
    if session is None:
        raise KeyError(session_id)
    try:
        if session.page is not None:
            session.final_url = session.page.url
            session.page_title = session.page.title()
    except Exception:
        pass
    return _session_public_payload(session)


def capture_managed_login_session_state(session_id: str) -> ManagedLoginCaptureResult:
    _expire_sessions()
    session = _SESSIONS.get(session_id)
    if session is None:
        raise KeyError(session_id)
    if session.context is None or session.page is None:
        raise ManagedLoginCaptureUnavailable("Managed browser session is not active.")
    try:
        storage_state = session.context.storage_state()
        session.final_url = session.page.url
        session.page_title = session.page.title()
        session.status = "CAPTURED"
        return ManagedLoginCaptureResult(
            storage_state=storage_state,
            final_url=session.final_url,
            page_title=session.page_title,
        )
    finally:
        _close_session(session)
        _SESSIONS.pop(session_id, None)


def cancel_managed_login_session(session_id: str) -> dict:
    _expire_sessions()
    session = _SESSIONS.pop(session_id, None)
    if session is None:
        raise KeyError(session_id)
    session.status = "CANCELLED"
    _close_session(session)
    return _session_public_payload(session)


def capture_managed_login_state(login_url: str, *, wait_seconds: int = 0) -> ManagedLoginCaptureResult:
    if not managed_login_capture_available():
        raise ManagedLoginCaptureUnavailable(
            "Managed browser login capture is not enabled. Set CRAWL_PERSONA_MANAGED_LOGIN_CAPTURE_ENABLED=1."
        )

    wait_ms = max(0, min(wait_seconds, 120)) * 1000
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=_headless())
        context = browser.new_context(ignore_https_errors=True)
        page = context.new_page()
        page.goto(login_url, wait_until="domcontentloaded", timeout=60_000)
        if wait_ms:
            try:
                page.wait_for_load_state("networkidle", timeout=min(wait_ms, 10_000))
            except PlaywrightTimeoutError:
                pass
            page.wait_for_timeout(wait_ms)
        storage_state = context.storage_state()
        result = ManagedLoginCaptureResult(
            storage_state=storage_state,
            final_url=page.url,
            page_title=page.title(),
        )
        context.close()
        browser.close()
        return result
