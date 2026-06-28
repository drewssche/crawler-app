import hashlib
import math
import os
import time
from collections import deque
from contextlib import contextmanager
from datetime import datetime
from typing import Any
from urllib.parse import urldefrag, urljoin, urlparse

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from bs4 import BeautifulSoup
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.paging import build_paged_response, paginate_query
from app.core.site_scope import CanonicalSiteScope, canonicalize_site_scope, is_url_in_site_scope
from app.db.models.page import Page
from app.db.models.page_retry_attempt import PageRetryAttempt
from app.db.models.project import Project
from app.db.models.crawl_persona import CrawlPersona
from app.db.models.crawler_run_job import CrawlerRunJob
from app.db.models.project_site import ProjectSite
from app.db.models.run import Run
from app.db.models.user import User
from app.db.session import get_db
from app.core.security import require_permission
from app.core.events import (
    EVENT_CHANNEL_NOTIFICATION,
    EVENT_SEVERITY_DANGER,
    EVENT_SEVERITY_INFO,
    emit_event,
)
from app.services.crawl_personas import get_default_persona
from app.services.crawler_jobs import (
    claim_next_queued_job,
    crawler_worker_enabled,
    enqueue_site_run_job,
    fail_job,
    find_active_site_job,
    finish_job_from_run,
    heartbeat_job,
    mark_job_running,
)
from app.services.page_context import build_page_context
from app.services.persona_secrets import decrypt_session_bundle
from app.services.persona_browser_state import build_browser_persona_state
from app.services.run_recovery import mark_stale_running_runs_failed
from app.crawler.browser_fetcher import BrowserCrawlerError, BrowserPersonaClient, browser_state_requires_runtime
from app.crawler.renderer import (
    get_rendered_snapshot_metadata,
    render_page_snapshot,
    rendered_snapshot_file,
)
from app.crawler.consent_audit import run_consent_audit

router = APIRouter(prefix="/runs", tags=["runs"])

MAX_RETRY_PAGES = 50
MAX_RETRY_ATTEMPTS = 3
RETRY_BACKOFF_SECONDS = (0, 5, 15)
CRAWL_PROGRESS_BATCH_SIZE = 5
BROWSER_CRAWL_MAX_PAGES_DEFAULT = 500
BROWSER_CRAWL_MAX_SECONDS_DEFAULT = 600
SESSION_HEADER_BLOCKLIST = {
    "connection",
    "content-length",
    "cookie",
    "host",
    "transfer-encoding",
    "upgrade",
}


def _bounded_int_env(name: str, *, default: int, minimum: int, maximum: int) -> int:
    raw = os.getenv(name, "").strip()
    if not raw:
        return default
    try:
        value = int(raw)
    except ValueError:
        return default
    return max(minimum, min(value, maximum))


class RetryPagesIn(BaseModel):
    urls: list[str] | None = Field(default=None, max_length=MAX_RETRY_PAGES)


class StartSiteRunIn(BaseModel):
    crawl_persona_id: int | None = None


def _extract_html_title(html: str | None) -> str:
    if not html:
        return ""
    title = BeautifulSoup(html, "html.parser").title
    if not title or not title.string:
        return ""
    return title.string.strip()


def _serialize_run(run: Run, persona: CrawlPersona | None = None) -> dict:
    return {
        "id": run.id,
        "project_id": run.project_id,
        "project_site_id": run.project_site_id,
        "crawl_persona_id": run.crawl_persona_id,
        "persona": (
            None
            if persona is None
            else {
                "id": persona.id,
                "key": persona.key,
                "label": persona.label,
                "kind": persona.kind,
                "has_secrets": persona.has_secrets,
            }
        ),
        "status": run.status,
        "crawl_runtime": run.crawl_runtime,
        "started_at": run.started_at,
        "finished_at": run.finished_at,
        "pages_total": run.pages_total,
        "pages_changed": run.pages_changed,
        "pages_discovered": run.pages_discovered,
        "current_batch_no": run.current_batch_no,
        "current_url": run.current_url,
        "progress_updated_at": run.progress_updated_at,
        "failure_code": run.failure_code,
        "failure_message": run.failure_message,
    }


def _string_value(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)


def _session_headers_from_bundle(bundle: dict[str, Any]) -> dict[str, str]:
    raw_headers = bundle.get("headers") or bundle.get("httpHeaders") or {}
    if not isinstance(raw_headers, dict):
        return {}
    headers: dict[str, str] = {}
    for key, value in raw_headers.items():
        name = str(key).strip()
        if not name or name.lower() in SESSION_HEADER_BLOCKLIST:
            continue
        header_value = _string_value(value).strip()
        if not header_value:
            continue
        headers[name] = header_value
    return headers


def _session_cookies_from_bundle(bundle: dict[str, Any]) -> list[dict[str, str]]:
    raw_cookies = bundle.get("cookies") or []
    cookies: list[dict[str, str]] = []
    if isinstance(raw_cookies, dict):
        for name, value in raw_cookies.items():
            cookie_name = str(name).strip()
            cookie_value = _string_value(value)
            if cookie_name:
                cookies.append({"name": cookie_name, "value": cookie_value})
        return cookies
    if not isinstance(raw_cookies, list):
        return cookies
    for item in raw_cookies:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or "").strip()
        if not name:
            continue
        cookie = {
            "name": name,
            "value": _string_value(item.get("value")),
        }
        domain = str(item.get("domain") or "").strip()
        path = str(item.get("path") or "").strip()
        if domain:
            cookie["domain"] = domain.lstrip(".")
        if path:
            cookie["path"] = path
        cookies.append(cookie)
    return cookies


def _persona_http_state(persona: CrawlPersona | None) -> tuple[dict[str, str], list[dict[str, str]]]:
    if persona is None or not persona.has_secrets or not persona.encrypted_session_bundle:
        return {}, []
    try:
        bundle = decrypt_session_bundle(persona.encrypted_session_bundle)
    except ValueError as exc:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "persona_session_unavailable",
                "message": "Сессию выбранной персоны не удалось расшифровать. Подключите session bundle заново.",
            },
        ) from exc
    return _session_headers_from_bundle(bundle), _session_cookies_from_bundle(bundle)


def _persona_browser_state_for_run(persona: CrawlPersona | None, *, document_url: str) -> dict[str, Any] | None:
    if persona is None or not persona.has_secrets or not persona.encrypted_session_bundle:
        return None
    try:
        bundle = decrypt_session_bundle(persona.encrypted_session_bundle)
    except ValueError as exc:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "persona_session_unavailable",
                "message": "Сессию выбранной персоны не удалось расшифровать. Подключите session bundle заново.",
            },
        ) from exc
    return build_browser_persona_state(bundle, document_url=document_url)


def _persona_crawl_runtime(persona: CrawlPersona | None, *, document_url: str) -> str:
    browser_state = _persona_browser_state_for_run(persona, document_url=document_url)
    return "browser" if browser_state_requires_runtime(browser_state) else "http"


def _persona_session_status(persona: CrawlPersona | None) -> dict[str, Any]:
    if persona is None:
        return {
            "session_required": False,
            "session_status": "missing_persona",
            "message": "Контекст просмотра не найден.",
        }
    if persona.kind == "guest":
        return {
            "session_required": False,
            "session_status": "not_required",
            "message": "Гость запускается без cookies и авторизации.",
        }
    if not persona.has_secrets or not persona.encrypted_session_bundle:
        return {
            "session_required": True,
            "session_status": "missing",
            "message": f"Для контекста «{persona.label}» не подключена сессия.",
        }
    expires_at = persona.session_bundle_expires_at
    if expires_at is not None:
        now = datetime.now(expires_at.tzinfo) if expires_at.tzinfo else datetime.utcnow()
        if expires_at <= now:
            return {
                "session_required": True,
                "session_status": "expired",
                "message": f"Сессия контекста «{persona.label}» истекла. Подключите её заново.",
            }
    try:
        decrypt_session_bundle(persona.encrypted_session_bundle)
    except ValueError:
        return {
            "session_required": True,
            "session_status": "unavailable",
            "message": f"Сессию контекста «{persona.label}» не удалось расшифровать. Подключите её заново.",
        }
    return {
        "session_required": True,
        "session_status": "connected",
        "message": f"Контекст «{persona.label}» будет запущен с подключённой сессией.",
    }


def _persona_payload(persona: CrawlPersona | None) -> dict[str, Any] | None:
    if persona is None:
        return None
    return {"id": persona.id, "key": persona.key, "label": persona.label, "kind": persona.kind}


def _assert_persona_ready_for_run(persona: CrawlPersona) -> dict[str, Any]:
    session = _persona_session_status(persona)
    if session["session_required"] and session["session_status"] != "connected":
        raise HTTPException(
            status_code=409,
            detail={
                "code": f"persona_session_{session['session_status']}",
                "message": session["message"],
                "crawl_persona_id": persona.id,
                "persona_label": persona.label,
                "session_status": session["session_status"],
            },
        )
    return session


def _apply_session_cookies(client: httpx.Client, cookies: list[dict[str, str]]) -> None:
    jar = getattr(client, "cookies", None)
    if jar is None:
        return
    for cookie in cookies:
        kwargs = {}
        if cookie.get("domain"):
            kwargs["domain"] = cookie["domain"]
        if cookie.get("path"):
            kwargs["path"] = cookie["path"]
        jar.set(cookie["name"], cookie["value"], **kwargs)


@contextmanager
def _persona_http_client(persona: CrawlPersona | None):
    headers, cookies = _persona_http_state(persona)
    with httpx.Client(follow_redirects=True, timeout=20, headers=headers) as client:
        _apply_session_cookies(client, cookies)
        yield client


@contextmanager
def _persona_crawl_client(persona: CrawlPersona | None, *, document_url: str):
    browser_state = _persona_browser_state_for_run(persona, document_url=document_url)
    if browser_state_requires_runtime(browser_state):
        with BrowserPersonaClient(browser_state or {}) as client:
            yield client
        return
    with _persona_http_client(persona) as client:
        yield client


def _classify_fetch_failure(exc: Exception) -> tuple[str, str]:
    if isinstance(exc, BrowserCrawlerError):
        return exc.code, exc.user_message
    message = str(exc).lower()
    if isinstance(exc, httpx.TimeoutException):
        return "timeout", "Сайт не ответил за отведенное время."
    if "ssl" in message or "certificate" in message or "tls" in message:
        return "tls_error", "Не удалось установить защищенное соединение с сайтом."
    if isinstance(exc, httpx.ConnectError):
        return "connection_error", "Не удалось подключиться к сайту. Проверьте адрес и доступность домена."
    if isinstance(exc, httpx.TooManyRedirects):
        return "redirect_error", "Сайт перенаправляет запросы по кругу."
    if isinstance(exc, httpx.RequestError):
        return "request_error", "Не удалось получить ответ от сайта."
    return "unknown_error", "Во время прогона произошла непредвиденная ошибка."


def _parse_allowed_domains(site: ProjectSite) -> set[str]:
    raw = (site.allowed_domains_csv or "").strip()
    if not raw:
        host = (urlparse(site.start_url).hostname or "").lower().strip()
        return {host} if host else set()
    return {x.strip().lower() for x in raw.split(",") if x.strip()}


def _parse_excluded_ext(site: ProjectSite) -> tuple[str, ...]:
    raw = (site.exclude_ext_csv or "").strip()
    if not raw:
        return ()
    return tuple(x.strip().lower() for x in raw.split(",") if x.strip())


def _normalize_url(url: str) -> str:
    clean, _frag = urldefrag(url)
    return clean.strip()


def _redirect_chain(response) -> list[dict]:
    chain = []
    for item in [*getattr(response, "history", []), response]:
        chain.append(
            {
                "url": _normalize_url(str(item.url)),
                "status_code": int(item.status_code),
                "location": item.headers.get("location"),
            }
        )
    return chain


def _is_allowed_url(
    url: str,
    *,
    scope: CanonicalSiteScope,
    allowed_domains: set[str],
    excluded_ext: tuple[str, ...],
) -> bool:
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"}:
        return False
    host = (parsed.hostname or "").lower()
    if not host:
        return False
    if allowed_domains:
        allowed = any(host == d or host.endswith(f".{d}") for d in allowed_domains)
        if not allowed:
            return False
    if not is_url_in_site_scope(url, scope):
        return False
    path = (parsed.path or "").lower()
    if excluded_ext and any(path.endswith(ext) for ext in excluded_ext):
        return False
    return True


def _is_problem_page(page: Page) -> bool:
    return bool(page.fetch_error_code) or (page.final_status_code or page.status_code) >= 400


def _retry_page(
    client: httpx.Client,
    *,
    run: Run,
    page: Page,
    site: ProjectSite,
    attempt_no: int,
) -> PageRetryAttempt:
    started_at = datetime.utcnow()
    started_fetch = time.monotonic()
    status = "FAILED"
    status_code = None
    final_url = None
    final_status_code = None
    redirect_chain = []
    fetch_error_code = None
    fetch_error_message = None

    try:
        response = client.get(page.url)
        response_time_ms = round((time.monotonic() - started_fetch) * 1000)
        final_url = _normalize_url(str(response.url))
        redirect_chain = _redirect_chain(response)
        status_code = (
            redirect_chain[0]["status_code"]
            if len(redirect_chain) > 1
            else int(response.status_code)
        )
        final_status_code = int(response.status_code)
        scope = canonicalize_site_scope(
            site.start_url,
            scope_mode=site.scope_mode,
            path_prefix=site.path_prefix,
        )
        if not _is_allowed_url(
            final_url,
            scope=scope,
            allowed_domains=_parse_allowed_domains(site),
            excluded_ext=_parse_excluded_ext(site),
        ):
            fetch_error_code = "scope_redirect"
            fetch_error_message = "Перенаправление вышло за пределы области мониторинга."
        elif final_status_code >= 400:
            fetch_error_code = "http_error"
            fetch_error_message = f"Сайт снова ответил HTTP {final_status_code}."
        else:
            status = "SUCCEEDED"
    except Exception as exc:
        response_time_ms = round((time.monotonic() - started_fetch) * 1000)
        fetch_error_code, fetch_error_message = _classify_fetch_failure(exc)

    return PageRetryAttempt(
        run_id=run.id,
        page_id=page.id,
        attempt_no=attempt_no,
        status=status,
        started_at=started_at,
        finished_at=datetime.utcnow(),
        status_code=status_code,
        final_url=final_url,
        final_status_code=final_status_code,
        redirect_chain_json=redirect_chain,
        fetch_error_code=fetch_error_code,
        fetch_error_message=fetch_error_message,
        response_time_ms=response_time_ms,
    )


def _assert_no_active_site_run(db: Session, site: ProjectSite) -> None:
    mark_stale_running_runs_failed(db, project_site_id=site.id)
    active_job = find_active_site_job(db, project_site_id=site.id)
    if active_job is not None:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "site_run_already_active",
                "message": f"Для сайта «{site.name}» уже есть активная задача crawler.",
                "job_id": active_job.id,
                "run_id": active_job.run_id,
                "project_site_id": site.id,
            },
        )
    active_run = (
        db.query(Run)
        .filter(Run.project_site_id == site.id, Run.status.in_(["RUNNING", "CANCEL_REQUESTED"]))
        .order_by(Run.id.desc())
        .first()
    )
    if active_run is not None:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "site_run_already_active",
                "message": f"Для сайта «{site.name}» уже выполняется или останавливается прогон.",
                "run_id": active_run.id,
                "project_site_id": site.id,
            },
        )


class RunCancelled(Exception):
    pass


def _queued_run_response(
    *,
    job: CrawlerRunJob,
    site: ProjectSite,
    persona: CrawlPersona | None,
    session: dict[str, Any],
) -> dict:
    return {
        "ok": True,
        "queued": True,
        "job_id": job.id,
        "job_status": job.status,
        "run_id": None,
        "project_site_id": site.id,
        "crawl_persona_id": persona.id if persona else None,
        "crawl_runtime": None,
        "persona": _persona_payload(persona),
        "persona_label": persona.label if persona else None,
        "persona_key": persona.key if persona else None,
        "session_required": session["session_required"],
        "session_status": session["session_status"],
        "session_message": session["message"],
        "message": "Задача поставлена в очередь crawler worker.",
    }


def _emit_run_completion_event(
    db: Session,
    *,
    run: Run,
    site: ProjectSite,
    persona: CrawlPersona | None,
    actor_user_id: int | None,
) -> None:
    succeeded = run.status == "FINISHED"
    cancelled = run.status == "CANCELLED"
    emit_event(
        db,
        event_type="crawler.run.finished" if succeeded else "crawler.run.cancelled" if cancelled else "crawler.run.failed",
        channel=EVENT_CHANNEL_NOTIFICATION,
        severity=EVENT_SEVERITY_INFO if succeeded or cancelled else EVENT_SEVERITY_DANGER,
        title=(
            f"Прогон сайта «{site.name}» завершён"
            if succeeded
            else f"Прогон сайта «{site.name}» остановлен"
            if cancelled
            else f"Прогон сайта «{site.name}» завершился ошибкой"
        ),
        body=(
            f"Найдено страниц: {run.pages_total}. Изменений: {run.pages_changed}."
            if succeeded
            else run.failure_message or "Crawler остановил прогон по запросу пользователя."
            if cancelled
            else run.failure_message or "Crawler не смог завершить прогон."
        ),
        target_path=f"/projects/{site.project_id}",
        target_ref=f"run:{run.id}",
        actor_user_id=actor_user_id,
        target_user_id=None,
        meta_json={
            "run_id": run.id,
            "project_id": site.project_id,
            "project_site_id": site.id,
            "crawl_persona_id": run.crawl_persona_id,
            "persona_key": persona.key if persona else None,
            "persona_label": persona.label if persona else None,
            "status": run.status,
            "crawl_runtime": run.crawl_runtime,
            "pages_total": run.pages_total,
            "pages_changed": run.pages_changed,
            "failure_code": run.failure_code,
            "suppress_toast": True,
        },
    )


def _finalize_cancelled_run(
    db: Session,
    *,
    run: Run,
    site: ProjectSite,
    persona: CrawlPersona | None,
    actor_user_id: int | None,
    job: CrawlerRunJob | None = None,
) -> None:
    run.status = "CANCELLED"
    run.failure_code = "cancelled_by_user"
    run.failure_message = "Прогон остановлен по запросу пользователя. Уже сохранённые страницы остаются доступными в истории."
    run.finished_at = datetime.utcnow()
    run.current_url = None
    run.progress_updated_at = run.finished_at
    _emit_run_completion_event(
        db,
        run=run,
        site=site,
        persona=persona,
        actor_user_id=actor_user_id,
    )
    db.commit()
    finish_job_from_run(db, job=job, run=run)


def _execute_site_run(
    db: Session,
    site: ProjectSite,
    *,
    persona: CrawlPersona | None = None,
    actor_user_id: int | None = None,
    job: CrawlerRunJob | None = None,
) -> Run:
    persona = persona or get_default_persona(db, site)
    _assert_persona_ready_for_run(persona)
    scope = canonicalize_site_scope(
        site.start_url,
        scope_mode=site.scope_mode,
        path_prefix=site.path_prefix,
    )
    run = Run(
        project_id=site.project_id,
        project_site_id=site.id,
        crawl_persona_id=persona.id,
        crawl_runtime=_persona_crawl_runtime(persona, document_url=site.start_url),
        status="RUNNING",
        started_at=datetime.utcnow(),
        pages_discovered=1,
        current_batch_no=1,
    )
    db.add(run)
    db.commit()
    db.refresh(run)
    if job is not None:
        mark_job_running(db, job=job, run=run)

    allowed_domains = _parse_allowed_domains(site)
    excluded_ext = _parse_excluded_ext(site)
    browser_max_pages = _bounded_int_env(
        "CRAWL_BROWSER_MAX_PAGES",
        default=BROWSER_CRAWL_MAX_PAGES_DEFAULT,
        minimum=1,
        maximum=10_000,
    )
    browser_max_seconds = _bounded_int_env(
        "CRAWL_BROWSER_MAX_SECONDS",
        default=BROWSER_CRAWL_MAX_SECONDS_DEFAULT,
        minimum=30,
        maximum=86_400,
    )
    requested_max_pages = max(1, min(int(site.max_pages or 1), 10_000))
    max_pages = min(requested_max_pages, browser_max_pages) if run.crawl_runtime == "browser" else requested_max_pages
    run_deadline = time.monotonic() + browser_max_seconds if run.crawl_runtime == "browser" else None

    try:
        with _persona_crawl_client(persona, document_url=site.start_url) as client:
            queue: deque[str] = deque([site.start_url])
            queued: set[str] = set(queue)
            visited: set[str] = set()
            pages: list[Page] = []
            first_failure: tuple[str, str] | None = None

            while queue and len(pages) < max_pages:
                db.refresh(run)
                if run.status == "CANCEL_REQUESTED":
                    _finalize_cancelled_run(
                        db,
                        run=run,
                        site=site,
                        persona=persona,
                        actor_user_id=actor_user_id,
                        job=job,
                    )
                    raise RunCancelled()
                if run_deadline is not None and time.monotonic() >= run_deadline:
                    if first_failure is None:
                        first_failure = (
                            "browser_run_time_limit",
                            "Browser-runtime достиг лимита времени для одного прогона. Уменьшите область сайта или запустите повторно позже.",
                        )
                    break
                current = queue.popleft()
                if current in visited:
                    continue
                visited.add(current)
                run.current_url = current
                run.progress_updated_at = datetime.utcnow()
                db.commit()
                heartbeat_job(db, job=job)

                started_fetch = time.monotonic()
                try:
                    resp = client.get(current)
                except Exception as exc:
                    failure_code, failure_message = _classify_fetch_failure(exc)
                    if first_failure is None:
                        first_failure = (failure_code, failure_message)
                    failed_page = Page(
                            run_id=run.id,
                            url=current,
                            status_code=0,
                            content_type="",
                            html="",
                            html_hash="",
                            final_url=None,
                            final_status_code=None,
                            redirect_chain_json=[],
                            fetch_error_code=failure_code,
                            fetch_error_message=failure_message,
                            response_time_ms=round((time.monotonic() - started_fetch) * 1000),
                            crawl_batch_no=(len(pages) // CRAWL_PROGRESS_BATCH_SIZE) + 1,
                    )
                    pages.append(failed_page)
                    db.add(failed_page)
                    run.pages_total = len(pages)
                    run.current_batch_no = (len(pages) // CRAWL_PROGRESS_BATCH_SIZE) + 1
                    run.progress_updated_at = datetime.utcnow()
                    db.commit()
                    heartbeat_job(db, job=job)
                    continue

                response_time_ms = round((time.monotonic() - started_fetch) * 1000)
                final_url = _normalize_url(str(resp.url))
                chain = _redirect_chain(resp)
                source_status = chain[0]["status_code"] if len(chain) > 1 else int(resp.status_code)
                visited.add(final_url)
                if not _is_allowed_url(
                    final_url,
                    scope=scope,
                    allowed_domains=allowed_domains,
                    excluded_ext=excluded_ext,
                ):
                    if first_failure is None:
                        first_failure = (
                            "scope_redirect",
                            "Стартовый адрес перенаправил crawler за пределы области сайта.",
                        )
                    scope_page = Page(
                            run_id=run.id,
                            url=current,
                            status_code=source_status,
                            content_type="",
                            html="",
                            html_hash="",
                            final_url=final_url,
                            final_status_code=int(resp.status_code),
                            redirect_chain_json=chain,
                            fetch_error_code="scope_redirect",
                            fetch_error_message="Перенаправление вышло за пределы области мониторинга.",
                            response_time_ms=response_time_ms,
                            crawl_batch_no=(len(pages) // CRAWL_PROGRESS_BATCH_SIZE) + 1,
                    )
                    pages.append(scope_page)
                    db.add(scope_page)
                    run.pages_total = len(pages)
                    run.current_batch_no = (len(pages) // CRAWL_PROGRESS_BATCH_SIZE) + 1
                    run.progress_updated_at = datetime.utcnow()
                    db.commit()
                    heartbeat_job(db, job=job)
                    continue
                ct = (resp.headers.get("content-type", "") or "").lower()
                html = resp.text if "text/html" in ct else ""
                h = hashlib.sha256(html.encode("utf-8", errors="ignore")).hexdigest() if html else ""

                fetched_page = Page(
                        run_id=run.id,
                        url=current,
                        status_code=source_status,
                        content_type=ct,
                        html=html,
                        html_hash=h,
                        final_url=final_url,
                        final_status_code=int(resp.status_code),
                        redirect_chain_json=chain,
                        fetch_error_code=None,
                        fetch_error_message=None,
                        response_time_ms=response_time_ms,
                        crawl_batch_no=(len(pages) // CRAWL_PROGRESS_BATCH_SIZE) + 1,
                )
                pages.append(fetched_page)
                db.add(fetched_page)
                run.pages_total = len(pages)
                run.current_batch_no = (len(pages) // CRAWL_PROGRESS_BATCH_SIZE) + 1
                run.progress_updated_at = datetime.utcnow()
                db.commit()
                heartbeat_job(db, job=job)

                if not html or resp.status_code >= 400:
                    continue

                soup = BeautifulSoup(html, "lxml")
                for tag in soup.find_all("a"):
                    href = (tag.get("href") or "").strip()
                    if not href:
                        continue
                    candidate = _normalize_url(urljoin(final_url, href))
                    if not candidate:
                        continue
                    if candidate in visited or candidate in queued:
                        continue
                    if not _is_allowed_url(
                        candidate,
                        scope=scope,
                        allowed_domains=allowed_domains,
                        excluded_ext=excluded_ext,
                    ):
                        continue
                    queue.append(candidate)
                    queued.add(candidate)
                run.pages_discovered = len(queued)
                run.progress_updated_at = datetime.utcnow()
                db.commit()
                heartbeat_job(db, job=job)

        run.pages_total = len(pages)
        run.pages_discovered = max(len(queued), len(pages))
        run.current_batch_no = ((len(pages) - 1) // CRAWL_PROGRESS_BATCH_SIZE) + 2 if pages else 1
        successful_html_pages = [
            page
            for page in pages
            if not page.fetch_error_code
            and (page.final_status_code or page.status_code) < 400
            and bool(page.html)
        ]
        if not successful_html_pages:
            if first_failure is not None:
                failure_code, failure_message = first_failure
            elif pages and all(
                page.fetch_error_code or (page.final_status_code or page.status_code) >= 400
                for page in pages
            ):
                failure_code = "http_error"
                failure_message = "Сайт ответил ошибкой и не отдал доступные страницы."
            else:
                failure_code = "no_html_pages"
                failure_message = "Сайт доступен, но HTML-страницы для мониторинга не найдены."
            run.status = "FAILED"
            run.failure_code = failure_code
            run.failure_message = failure_message
            run.finished_at = datetime.utcnow()
            run.current_url = None
            run.progress_updated_at = run.finished_at
            _emit_run_completion_event(
                db,
                run=run,
                site=site,
                persona=persona,
                actor_user_id=actor_user_id,
            )
            db.commit()
            finish_job_from_run(db, job=job, run=run)
            raise HTTPException(
                status_code=502,
                detail={
                    "code": failure_code,
                    "message": failure_message,
                    "run_id": run.id,
                },
            )

        prev_run = (
            db.query(Run)
            .filter(
                Run.project_site_id == site.id,
                Run.crawl_persona_id == persona.id,
                Run.status == "FINISHED",
                Run.id < run.id,
            )
            .order_by(Run.id.desc())
            .first()
        )
        if prev_run is None:
            run.pages_changed = run.pages_total
        else:
            prev_map = {
                url: (html_hash or "")
                for url, html_hash in db.query(Page.url, Page.html_hash).filter(Page.run_id == prev_run.id).all()
            }
            changed = 0
            current_urls: set[str] = set()
            for page in pages:
                current_urls.add(page.url)
                if prev_map.get(page.url) != (page.html_hash or ""):
                    changed += 1
            changed += len(set(prev_map) - current_urls)
            run.pages_changed = changed

        run.status = "FINISHED"
        run.failure_code = None
        run.failure_message = None
        run.finished_at = datetime.utcnow()
        run.current_url = None
        run.progress_updated_at = run.finished_at
        _emit_run_completion_event(
            db,
            run=run,
            site=site,
            persona=persona,
            actor_user_id=actor_user_id,
        )
        db.commit()
        finish_job_from_run(db, job=job, run=run)
    except HTTPException as exc:
        if run.status != "FAILED":
            detail = exc.detail if isinstance(exc.detail, dict) else {}
            run.status = "FAILED"
            run.failure_code = run.failure_code or detail.get("code") or "request_failed"
            run.failure_message = (
                run.failure_message
                or detail.get("message")
                or "Прогон не удалось завершить."
            )
            run.finished_at = datetime.utcnow()
            run.current_url = None
            run.progress_updated_at = run.finished_at
            _emit_run_completion_event(
                db,
                run=run,
                site=site,
                persona=persona,
                actor_user_id=actor_user_id,
            )
            db.commit()
            finish_job_from_run(db, job=job, run=run)
        raise
    except BrowserCrawlerError as exc:
        run.status = "FAILED"
        run.failure_code = exc.code
        run.failure_message = exc.user_message
        run.finished_at = datetime.utcnow()
        run.current_url = None
        run.progress_updated_at = run.finished_at
        _emit_run_completion_event(
            db,
            run=run,
            site=site,
            persona=persona,
            actor_user_id=actor_user_id,
        )
        db.commit()
        finish_job_from_run(db, job=job, run=run)
        raise HTTPException(
            status_code=502,
            detail={
                "code": exc.code,
                "message": exc.user_message,
                "runtime": "browser",
                "run_id": run.id,
            },
        ) from exc
    except RunCancelled:
        pass
    except Exception as exc:
        failure_code, failure_message = _classify_fetch_failure(exc)
        run.status = "FAILED"
        run.failure_code = failure_code
        run.failure_message = failure_message
        run.finished_at = datetime.utcnow()
        run.current_url = None
        run.progress_updated_at = run.finished_at
        _emit_run_completion_event(
            db,
            run=run,
            site=site,
            persona=persona,
            actor_user_id=actor_user_id,
        )
        db.commit()
        finish_job_from_run(db, job=job, run=run)
        raise

    return run


@router.post("/start-site/{site_id}")
def start_site_run(
    site_id: int,
    payload: StartSiteRunIn | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("crawler.run")),
):
    site = db.get(ProjectSite, site_id)
    if not site:
        raise HTTPException(status_code=404, detail="Project site not found")
    if not site.is_enabled:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "project_site_disabled",
                "message": f"Сайт «{site.name}» отключён и не может быть запущен.",
            },
        )
    _assert_no_active_site_run(db, site)
    persona = None
    if payload and payload.crawl_persona_id is not None:
        persona = (
            db.query(CrawlPersona)
            .filter(
                CrawlPersona.id == payload.crawl_persona_id,
                CrawlPersona.project_site_id == site.id,
                CrawlPersona.is_enabled.is_(True),
            )
            .first()
        )
        if persona is None:
            raise HTTPException(status_code=404, detail="Crawl persona not found")
    run_persona = persona or get_default_persona(db, site)
    _assert_persona_ready_for_run(run_persona)
    job = enqueue_site_run_job(db, site=site, persona=run_persona, actor_user_id=current_user.id)
    session = _persona_session_status(run_persona)
    if crawler_worker_enabled():
        return _queued_run_response(job=job, site=site, persona=run_persona, session=session)
    try:
        run = _execute_site_run(db, site, persona=run_persona, actor_user_id=current_user.id, job=job)
    except Exception:
        fail_job(
            db,
            job=job,
            failure_code="start_failed",
            failure_message="Crawler job не смог завершить синхронный запуск.",
        )
        raise
    persona = db.get(CrawlPersona, run.crawl_persona_id) if run.crawl_persona_id else None
    session = _persona_session_status(persona)
    return {
        "ok": True,
        "run_id": run.id,
        "project_site_id": site.id,
        "crawl_persona_id": run.crawl_persona_id,
        "crawl_runtime": run.crawl_runtime,
        "persona": _persona_payload(persona),
        "persona_label": persona.label if persona else None,
        "persona_key": persona.key if persona else None,
        "session_required": session["session_required"],
        "session_status": session["session_status"],
        "session_message": session["message"],
    }


@router.post("/start-project/{project_id}")
def start_project_sites(
    project_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("crawler.run")),
):
    project = db.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    sites = (
        db.query(ProjectSite)
        .filter(ProjectSite.project_id == project_id, ProjectSite.is_enabled.is_(True))
        .order_by(ProjectSite.sort_order.asc(), ProjectSite.id.asc())
        .all()
    )
    if not sites:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "project_has_no_enabled_sites",
                "message": "В проекте нет включённых сайтов для запуска.",
            },
        )

    results = []
    for site in sites:
        persona = get_default_persona(db, site)
        session = _persona_session_status(persona)
        base_result = {
            "project_site_id": site.id,
            "site_name": site.name,
            "run_id": None,
            "crawl_persona_id": persona.id,
            "persona": _persona_payload(persona),
            "persona_key": persona.key,
            "persona_label": persona.label,
            "session_required": session["session_required"],
            "session_status": session["session_status"],
            "session_message": session["message"],
        }
        try:
            _assert_no_active_site_run(db, site)
            _assert_persona_ready_for_run(persona)
            job = enqueue_site_run_job(db, site=site, persona=persona, actor_user_id=current_user.id)
            if crawler_worker_enabled():
                results.append(
                    {
                        **base_result,
                        "project_site_id": site.id,
                        "site_name": site.name,
                        "job_id": job.id,
                        "job_status": job.status,
                        "run_id": None,
                        "status": "QUEUED",
                        "failure_code": None,
                        "failure_message": None,
                    }
                )
                continue
            try:
                run = _execute_site_run(db, site, persona=persona, actor_user_id=current_user.id, job=job)
            except Exception:
                fail_job(
                    db,
                    job=job,
                    failure_code="start_failed",
                    failure_message="Crawler job не смог завершить синхронный запуск.",
                )
                raise
            results.append(
                {
                    **base_result,
                    "project_site_id": site.id,
                    "site_name": site.name,
                    "run_id": run.id,
                    "crawl_persona_id": run.crawl_persona_id,
                    "crawl_runtime": run.crawl_runtime,
                    "status": run.status,
                    "failure_code": run.failure_code,
                    "failure_message": run.failure_message,
                }
            )
        except HTTPException as exc:
            detail = exc.detail if isinstance(exc.detail, dict) else {}
            run_id = detail.get("run_id")
            if run_id is None:
                latest_run = (
                    db.query(Run)
                    .filter(Run.project_site_id == site.id)
                    .order_by(Run.id.desc())
                    .first()
                )
                run_id = latest_run.id if latest_run else None
            results.append(
                {
                    **base_result,
                    "project_site_id": site.id,
                    "site_name": site.name,
                    "run_id": run_id,
                    "status": "SKIPPED" if exc.status_code == 409 else "FAILED",
                    "failure_code": detail.get("code") or f"http_{exc.status_code}",
                    "failure_message": detail.get("message") or str(exc.detail),
                }
            )
        except Exception as exc:
            failure_code, failure_message = _classify_fetch_failure(exc)
            latest_run = (
                db.query(Run)
                .filter(Run.project_site_id == site.id)
                .order_by(Run.id.desc())
                .first()
            )
            results.append(
                {
                    **base_result,
                    "project_site_id": site.id,
                    "site_name": site.name,
                    "run_id": latest_run.id if latest_run else None,
                    "status": "FAILED",
                    "failure_code": failure_code,
                    "failure_message": failure_message,
                }
            )

    return {
        "ok": True,
        "project_id": project_id,
        "sites_total": len(sites),
        "finished": sum(1 for row in results if row["status"] == "FINISHED"),
        "failed": sum(1 for row in results if row["status"] == "FAILED"),
        "queued": sum(1 for row in results if row["status"] == "QUEUED"),
        "skipped": sum(1 for row in results if row["status"] == "SKIPPED"),
        "results": results,
    }


@router.post("/worker/tick")
def run_worker_tick(
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_permission("crawler.run")),
):
    if not crawler_worker_enabled():
        raise HTTPException(
            status_code=409,
            detail={
                "code": "crawler_worker_disabled",
                "message": "Crawler worker execution выключен. Установите CRAWLER_WORKER_ENABLED=1 для обработки queued jobs.",
            },
        )
    job = claim_next_queued_job(db)
    if job is None:
        return {
            "ok": True,
            "processed": False,
            "message": "В очереди crawler нет задач.",
        }

    site = db.get(ProjectSite, job.project_site_id)
    if site is None or not site.is_enabled:
        fail_job(
            db,
            job=job,
            failure_code="project_site_unavailable",
            failure_message="Сайт задачи недоступен или отключён.",
        )
        return {
            "ok": True,
            "processed": True,
            "job_id": job.id,
            "run_id": None,
            "status": "FAILED",
            "failure_code": "project_site_unavailable",
        }
    persona = db.get(CrawlPersona, job.crawl_persona_id) if job.crawl_persona_id else get_default_persona(db, site)
    try:
        _assert_persona_ready_for_run(persona)
        run = _execute_site_run(db, site, persona=persona, actor_user_id=job.created_by_user_id, job=job)
    except HTTPException as exc:
        detail = exc.detail if isinstance(exc.detail, dict) else {}
        fail_job(
            db,
            job=job,
            failure_code=detail.get("code") or f"http_{exc.status_code}",
            failure_message=detail.get("message") or str(exc.detail),
        )
        raise
    except Exception as exc:
        failure_code, failure_message = _classify_fetch_failure(exc)
        fail_job(db, job=job, failure_code=failure_code, failure_message=failure_message)
        raise

    return {
        "ok": True,
        "processed": True,
        "job_id": job.id,
        "run_id": run.id,
        "project_site_id": site.id,
        "status": job.status,
        "run_status": run.status,
        "failure_code": run.failure_code,
        "failure_message": run.failure_message,
    }


@router.post("/{run_id}/retry-pages")
def retry_problem_pages(
    run_id: int,
    payload: RetryPagesIn,
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_permission("crawler.run")),
):
    run = db.get(Run, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    if run.status in {"RUNNING", "CANCEL_REQUESTED"}:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "run_still_active",
                "message": "Дождитесь завершения текущего прогона перед повторной проверкой страниц.",
            },
        )
    site = db.get(ProjectSite, run.project_site_id)
    if not site:
        raise HTTPException(status_code=409, detail="Project site not found")

    query = db.query(Page).filter(Page.run_id == run.id)
    requested_urls = list(dict.fromkeys(payload.urls or []))
    if requested_urls:
        query = query.filter(Page.url.in_(requested_urls))
    pages = query.order_by(Page.id.asc()).all()

    if requested_urls and len(pages) != len(requested_urls):
        found_urls = {page.url for page in pages}
        missing = [url for url in requested_urls if url not in found_urls]
        raise HTTPException(
            status_code=404,
            detail={
                "code": "retry_pages_not_found",
                "message": "Часть выбранных страниц отсутствует в исходном прогоне.",
                "urls": missing,
            },
        )

    problem_pages = [page for page in pages if _is_problem_page(page)]
    if requested_urls and len(problem_pages) != len(pages):
        healthy_urls = [page.url for page in pages if not _is_problem_page(page)]
        raise HTTPException(
            status_code=409,
            detail={
                "code": "retry_not_needed",
                "message": "Повторная проверка доступна только для страниц с ошибкой.",
                "urls": healthy_urls,
            },
        )
    if not problem_pages:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "no_problem_pages",
                "message": "В этом прогоне нет страниц, которым требуется повторная проверка.",
            },
        )
    if len(problem_pages) > MAX_RETRY_PAGES:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "retry_page_limit",
                "message": f"За один раз можно повторно проверить не более {MAX_RETRY_PAGES} страниц.",
                "pages_total": len(problem_pages),
            },
        )

    attempt_counts = dict(
        db.query(PageRetryAttempt.page_id, func.count(PageRetryAttempt.id))
        .filter(PageRetryAttempt.page_id.in_([page.id for page in problem_pages]))
        .group_by(PageRetryAttempt.page_id)
        .all()
    )
    latest_attempts = {}
    for attempt in (
        db.query(PageRetryAttempt)
        .filter(PageRetryAttempt.page_id.in_([page.id for page in problem_pages]))
        .order_by(PageRetryAttempt.page_id.asc(), PageRetryAttempt.attempt_no.desc())
        .all()
    ):
        latest_attempts.setdefault(attempt.page_id, attempt)
    results = []
    retry_persona = db.get(CrawlPersona, run.crawl_persona_id) if run.crawl_persona_id else None
    retry_session = _assert_persona_ready_for_run(retry_persona) if retry_persona else _persona_session_status(None)
    try:
        with _persona_crawl_client(retry_persona, document_url=site.start_url) as client:
            for page in problem_pages:
                previous_attempts = int(attempt_counts.get(page.id, 0))
                latest_attempt = latest_attempts.get(page.id)
                if latest_attempt is not None and latest_attempt.status == "SUCCEEDED":
                    results.append(
                        {
                            "page_id": page.id,
                            "url": page.url,
                            "status": "SKIPPED",
                            "attempt_no": previous_attempts,
                            "message": "Последняя повторная проверка уже была успешной.",
                        }
                    )
                    continue
                if latest_attempt is not None:
                    backoff_seconds = RETRY_BACKOFF_SECONDS[min(previous_attempts, len(RETRY_BACKOFF_SECONDS) - 1)]
                    elapsed_seconds = (datetime.utcnow() - latest_attempt.finished_at).total_seconds()
                    if elapsed_seconds < backoff_seconds:
                        wait_seconds = max(1, math.ceil(backoff_seconds - elapsed_seconds))
                        results.append(
                            {
                                "page_id": page.id,
                                "url": page.url,
                                "status": "SKIPPED",
                                "attempt_no": previous_attempts,
                                "message": f"Повторите через {wait_seconds} сек., чтобы не создавать лишнюю нагрузку.",
                            }
                        )
                        continue
                if previous_attempts >= MAX_RETRY_ATTEMPTS:
                    results.append(
                        {
                            "page_id": page.id,
                            "url": page.url,
                            "status": "SKIPPED",
                            "attempt_no": previous_attempts,
                            "message": "Достигнут лимит из 3 повторных попыток.",
                        }
                    )
                    continue
                attempt = _retry_page(
                    client,
                    run=run,
                    page=page,
                    site=site,
                    attempt_no=previous_attempts + 1,
                )
                db.add(attempt)
                db.flush()
                results.append(
                    {
                        "page_id": page.id,
                        "url": page.url,
                        "status": attempt.status,
                        "attempt_no": attempt.attempt_no,
                        "status_code": attempt.status_code,
                        "final_url": attempt.final_url,
                        "final_status_code": attempt.final_status_code,
                        "fetch_error_code": attempt.fetch_error_code,
                        "fetch_error_message": attempt.fetch_error_message,
                        "response_time_ms": attempt.response_time_ms,
                    }
                )
    except BrowserCrawlerError as exc:
        raise HTTPException(
            status_code=502,
            detail={
                "code": exc.code,
                "message": exc.user_message,
                "runtime": "browser",
                "run_id": run.id,
            },
        ) from exc
    db.commit()

    return {
        "ok": True,
        "run_id": run.id,
        "requested": len(problem_pages),
        "succeeded": sum(1 for row in results if row["status"] == "SUCCEEDED"),
        "failed": sum(1 for row in results if row["status"] == "FAILED"),
        "skipped": sum(1 for row in results if row["status"] == "SKIPPED"),
        "crawl_persona_id": retry_persona.id if retry_persona else None,
        "crawl_runtime": run.crawl_runtime,
        "persona": _persona_payload(retry_persona),
        "persona_label": retry_persona.label if retry_persona else None,
        "session_required": retry_session["session_required"],
        "session_status": retry_session["session_status"],
        "session_message": retry_session["message"],
        "results": results,
        "message": "Исходные результаты прогона сохранены без изменений.",
    }


@router.post("/{run_id}/cancel")
def cancel_run(
    run_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("crawler.run")),
):
    run = db.get(Run, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    mark_stale_running_runs_failed(db, project_site_id=run.project_site_id)
    db.refresh(run)
    persona = db.get(CrawlPersona, run.crawl_persona_id) if run.crawl_persona_id else None

    if run.status == "CANCEL_REQUESTED":
        return {
            "ok": True,
            "run": _serialize_run(run, persona),
            "message": "Остановка уже запрошена. Crawler завершит текущую страницу и остановит прогон.",
        }
    if run.status != "RUNNING":
        raise HTTPException(
            status_code=409,
            detail={
                "code": "run_not_active",
                "message": "Этот прогон уже не выполняется, отмена не требуется.",
                "run_id": run.id,
                "status": run.status,
            },
        )

    run.status = "CANCEL_REQUESTED"
    run.failure_code = "cancel_requested"
    run.failure_message = (
        "Остановка запрошена. Crawler завершит текущую страницу и остановит прогон перед следующим шагом."
    )
    run.progress_updated_at = datetime.utcnow()
    db.commit()
    db.refresh(run)

    emit_event(
        db,
        event_type="crawler.run.cancel_requested",
        channel=EVENT_CHANNEL_NOTIFICATION,
        severity=EVENT_SEVERITY_INFO,
        title="Остановка прогона запрошена",
        body="Crawler завершит текущую страницу и остановит прогон перед следующим шагом.",
        target_path=f"/projects/{run.project_id}",
        target_ref=f"run:{run.id}",
        actor_user_id=current_user.id,
        target_user_id=None,
        meta_json={
            "run_id": run.id,
            "project_id": run.project_id,
            "project_site_id": run.project_site_id,
            "crawl_persona_id": run.crawl_persona_id,
            "status": run.status,
            "failure_code": run.failure_code,
            "suppress_toast": True,
        },
    )
    db.commit()

    return {
        "ok": True,
        "run": _serialize_run(run, persona),
        "message": "Остановка запрошена. Crawler завершит текущую страницу и остановит прогон перед следующим шагом.",
    }


@router.get("/by-project/{project_id}")
def list_runs(
    project_id: int,
    page: int | None = None,
    page_size: int = 20,
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_permission("data.view")),
):
    mark_stale_running_runs_failed(db, project_id=project_id)
    query = (
        db.query(Run, CrawlPersona)
        .outerjoin(CrawlPersona, CrawlPersona.id == Run.crawl_persona_id)
        .filter(Run.project_id == project_id)
        .order_by(Run.id.desc())
    )
    paged = paginate_query(query, page=page, page_size=page_size)
    if page is None:
        return [_serialize_run(run, persona) for run, persona in paged]
    items, total, safe_page, safe_page_size = paged
    return build_paged_response(
        items=[_serialize_run(run, persona) for run, persona in items],
        total=total,
        page=safe_page,
        page_size=safe_page_size,
    )


@router.get("/by-site/{site_id}")
def list_site_runs(
    site_id: int,
    crawl_persona_id: int | None = None,
    page: int | None = None,
    page_size: int = 20,
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_permission("data.view")),
):
    if not db.get(ProjectSite, site_id):
        raise HTTPException(status_code=404, detail="Project site not found")
    mark_stale_running_runs_failed(db, project_site_id=site_id)
    query = (
        db.query(Run, CrawlPersona)
        .outerjoin(CrawlPersona, CrawlPersona.id == Run.crawl_persona_id)
        .filter(Run.project_site_id == site_id)
        .order_by(Run.id.desc())
    )
    if crawl_persona_id is not None:
        query = query.filter(Run.crawl_persona_id == crawl_persona_id)
    paged = paginate_query(query, page=page, page_size=page_size)
    if page is None:
        return [_serialize_run(run, persona) for run, persona in paged]
    items, total, safe_page, safe_page_size = paged
    return build_paged_response(
        items=[_serialize_run(run, persona) for run, persona in items],
        total=total,
        page=safe_page,
        page_size=safe_page_size,
    )


@router.get("/{run_id}/pages")
def list_pages(
    run_id: int,
    page: int | None = None,
    page_size: int = 20,
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_permission("data.view")),
):
    query = db.query(Page).filter(Page.run_id == run_id).order_by(Page.id.asc())
    paged = paginate_query(query, page=page, page_size=page_size)
    if page is None:
        return paged
    items, total, safe_page, safe_page_size = paged
    return build_paged_response(items=items, total=total, page=safe_page, page_size=safe_page_size)


@router.get("/{run_id}/page-catalog")
def list_page_catalog(
    run_id: int,
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_permission("data.view")),
):
    if not db.get(Run, run_id):
        raise HTTPException(status_code=404, detail="Run not found")
    rows = (
        db.query(Page.id, Page.url, Page.status_code, Page.html_hash, Page.html)
        .filter(Page.run_id == run_id)
        .order_by(Page.url.asc())
        .all()
    )
    return [
        {
            "id": row.id,
            "url": row.url,
            "status_code": row.status_code,
            "html_hash": row.html_hash,
            "title": _extract_html_title(row.html),
        }
        for row in rows
    ]


@router.get("/{run_id}/page-context")
def get_page_context(
    run_id: int,
    url: str = Query(min_length=1),
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_permission("data.view")),
):
    run = db.get(Run, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    page = (
        db.query(Page)
        .filter(Page.run_id == run_id, Page.url == url)
        .first()
    )
    if not page:
        raise HTTPException(status_code=404, detail="Page not found in this run")
    return build_page_context(db, run, page)


@router.get("/{run_id}/snapshot")
def get_page_snapshot(
    run_id: int,
    url: str = Query(min_length=1),
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_permission("data.view")),
):
    run = db.get(Run, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    page = (
        db.query(Page)
        .filter(Page.run_id == run_id, Page.url == url)
        .first()
    )
    if not page:
        raise HTTPException(status_code=404, detail="Page not found in this run")
    context = build_page_context(db, run, page)
    return {
        "run_id": run.id,
        "project_site_id": run.project_site_id,
        "crawl_persona_id": run.crawl_persona_id,
        "persona": context["page"]["persona"],
        "url": page.url,
        "status_code": page.status_code,
        "content_type": page.content_type,
        "html": page.html,
        "html_hash": page.html_hash,
        "rendered_snapshot": get_rendered_snapshot_metadata(page),
        "meta": context["meta"],
        "seo": context["seo"],
        "links": {
            "total": context["links"]["total"],
            "internal": context["links"]["internal"],
            "external": context["links"]["external"],
            "known_broken": context["links"]["known_broken"],
        },
        "assets": {
            "images": {
                "total": context["assets"]["images"]["total"],
                "missing_alt": context["assets"]["images"]["missing_alt"],
            },
            "scripts": {"total": context["assets"]["scripts"]["total"]},
            "styles": {"total": context["assets"]["styles"]["total"]},
        },
        "tracking": context["tracking"],
    }


@router.post("/{run_id}/rendered-snapshot")
def create_rendered_page_snapshot(
    run_id: int,
    url: str = Query(min_length=1),
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_permission("crawler.run")),
):
    run = db.get(Run, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    page = db.query(Page).filter(Page.run_id == run_id, Page.url == url).first()
    if not page:
        raise HTTPException(status_code=404, detail="Page not found in this run")
    try:
        return render_page_snapshot(page)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail=(
                "Не удалось создать визуальный снимок. Проверьте, что Chromium установлен "
                "в backend-контейнере, и повторите попытку."
            ),
        ) from exc


@router.get("/{run_id}/rendered-snapshot")
def get_rendered_page_snapshot(
    run_id: int,
    url: str = Query(min_length=1),
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_permission("data.view")),
):
    page = db.query(Page).filter(Page.run_id == run_id, Page.url == url).first()
    if not page:
        raise HTTPException(status_code=404, detail="Page not found in this run")
    image_path = rendered_snapshot_file(page)
    if image_path is None:
        raise HTTPException(status_code=404, detail="Rendered snapshot not found")
    return FileResponse(image_path, media_type="image/jpeg", filename=f"page-{page.id}.jpg")


@router.post("/{run_id}/consent-audit")
def create_page_consent_audit(
    run_id: int,
    url: str = Query(min_length=1),
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_permission("crawler.run")),
):
    run = db.get(Run, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    page = db.query(Page).filter(Page.run_id == run_id, Page.url == url).first()
    if not page:
        raise HTTPException(status_code=404, detail="Page not found in this run")
    persona_browser_state = None
    persona = db.get(CrawlPersona, run.crawl_persona_id) if run.crawl_persona_id else None
    if persona and persona.has_secrets and persona.encrypted_session_bundle:
        try:
            persona_browser_state = build_browser_persona_state(
                decrypt_session_bundle(persona.encrypted_session_bundle),
                document_url=page.final_url or page.url,
            )
        except ValueError as exc:
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "persona_session_unavailable",
                    "message": "Сессию выбранной персоны не удалось расшифровать. Подключите session bundle заново.",
                },
            ) from exc
    try:
        return run_consent_audit(page, persona_browser_state=persona_browser_state)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail=(
                "Не удалось выполнить browser-аудит consent. Проверьте Chromium в backend-контейнере "
                "и повторите попытку."
            ),
        ) from exc
