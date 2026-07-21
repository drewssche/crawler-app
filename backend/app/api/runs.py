import hashlib
import json
import math
import os
import re
import threading
import time
from collections import deque
from contextlib import contextmanager
from datetime import datetime, timedelta
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
from app.db.models.page_consent_audit import PageConsentAudit
from app.db.models.page_monitoring_notification_outbox import PageMonitoringNotificationOutbox
from app.db.models.page_monitoring_target import PageMonitoringTarget
from app.db.models.page_monitoring_target_check import PageMonitoringTargetCheck
from app.db.models.page_monitoring_target_subscription import PageMonitoringTargetSubscription
from app.db.models.page_retry_attempt import PageRetryAttempt
from app.db.models.project import Project
from app.db.models.crawl_persona import CrawlPersona
from app.db.models.crawler_run_job import CrawlerRunJob
from app.db.models.project_site import ProjectSite
from app.db.models.run import Run
from app.db.models.user import User
from app.db.session import SessionLocal, get_db
from app.core.security import get_user_role, require_permission
from app.core.events import (
    EVENT_CHANNEL_NOTIFICATION,
    EVENT_SEVERITY_DANGER,
    EVENT_SEVERITY_INFO,
    EVENT_SEVERITY_WARNING,
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
    reschedule_job_retry,
)
from app.services.monitoring_notification_delivery import (
    build_monitoring_notification_message,
    deliver_outbox_row,
    deliver_queued_outbox,
    monitoring_delivery_diagnostics,
    monitoring_notification_max_attempts,
)
from app.services.page_context import build_page_context
from app.services.persona_secrets import decrypt_session_bundle
from app.services.persona_browser_state import build_browser_persona_state
from app.services.run_recovery import mark_stale_running_runs_failed
from app.services.project_memberships import require_project_read, require_project_write
from app.services.project_quotas import enforce_actor_active_job_quota, enforce_bulk_run_quota
from app.services.scan_retention import prune_site_persona_raw_artifacts
from app.crawler.browser_fetcher import BrowserCrawlerError, BrowserPersonaClient, browser_state_requires_runtime
from app.crawler.renderer import (
    get_rendered_snapshot_metadata,
    render_page_snapshot,
    rendered_snapshot_file,
    write_rendered_snapshot_artifact,
)
from app.crawler.consent_audit import run_consent_audit

router = APIRouter(prefix="/runs", tags=["runs"])

MAX_RETRY_PAGES = 50
MAX_RETRY_ATTEMPTS = 3
RETRY_BACKOFF_SECONDS = (0, 5, 15)
CRAWL_PROGRESS_BATCH_SIZE = 5
BROWSER_CRAWL_MAX_PAGES_DEFAULT = 500
BROWSER_CRAWL_MAX_SECONDS_DEFAULT = 600
MONITORING_SUBSCRIPTION_CHANNELS = {"email", "telegram_chat"}
MONITORING_SUBSCRIPTION_STATUSES = {"changed", "missing", "not_checkable"}
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


class MonitoringTargetElementIn(BaseModel):
    tag: str = Field(min_length=1, max_length=80)
    id: str = Field(default="", max_length=240)
    className: str = Field(default="", max_length=1000)
    selector: str = Field(min_length=1, max_length=4000)
    text: str = Field(default="", max_length=5000)
    outerHTML: str = Field(default="", max_length=50_000)
    rect: dict[str, Any] = Field(default_factory=dict)


class CreateMonitoringTargetIn(BaseModel):
    name: str | None = Field(default=None, max_length=240)
    source: str = Field(default="rendered_snapshot", max_length=60)
    element: MonitoringTargetElementIn


class UpdateMonitoringTargetIn(BaseModel):
    name: str | None = Field(default=None, max_length=240)
    is_active: bool | None = None


class CreateMonitoringTargetSubscriptionIn(BaseModel):
    channel_type: str = Field(min_length=1, max_length=40)
    destination: str = Field(min_length=1, max_length=500)
    statuses: list[str] = Field(default_factory=lambda: ["changed", "missing", "not_checkable"])
    min_interval_minutes: int = Field(default=0, ge=0, le=10080)


class UpdateMonitoringTargetSubscriptionIn(BaseModel):
    destination: str | None = Field(default=None, min_length=1, max_length=500)
    statuses: list[str] | None = None
    min_interval_minutes: int | None = Field(default=None, ge=0, le=10080)
    is_active: bool | None = None


class PreviewMonitoringTargetSubscriptionIn(BaseModel):
    status: str = Field(default="not_checkable", max_length=30)


def _extract_page_search_meta(html: str | None) -> dict[str, str]:
    if not html:
        return {"title": "", "description": "", "h1": ""}
    soup = BeautifulSoup(html, "html.parser")
    title = soup.title.string.strip() if soup.title and soup.title.string else ""
    description_tag = soup.find("meta", attrs={"name": lambda value: value and value.lower() == "description"})
    description = str(description_tag.get("content") or "").strip() if description_tag else ""
    h1 = soup.find("h1")
    h1_text = h1.get_text(" ", strip=True) if h1 else ""
    return {"title": title, "description": description, "h1": h1_text}


def _serialize_page_list_item(page: Page) -> dict[str, Any]:
    search_meta = _extract_page_search_meta(page.html)
    return {
        "id": page.id,
        "run_id": page.run_id,
        "url": page.url,
        "status_code": page.status_code,
        "content_type": page.content_type,
        "html_hash": page.html_hash,
        "final_url": page.final_url,
        "final_status_code": page.final_status_code,
        "redirect_chain_json": page.redirect_chain_json,
        "fetch_error_code": page.fetch_error_code,
        "fetch_error_message": page.fetch_error_message,
        "response_time_ms": page.response_time_ms,
        "crawl_batch_no": page.crawl_batch_no,
        **search_meta,
    }


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


def _serialize_crawler_job(
    job: CrawlerRunJob,
    *,
    site: ProjectSite | None = None,
    persona: CrawlPersona | None = None,
) -> dict:
    return {
        "id": job.id,
        "project_id": job.project_id,
        "project_site_id": job.project_site_id,
        "crawl_persona_id": job.crawl_persona_id,
        "run_id": job.run_id,
        "kind": job.kind,
        "status": job.status,
        "lease_owner": job.lease_owner,
        "lease_expires_at": job.lease_expires_at,
        "attempts": job.attempts,
        "max_attempts": job.max_attempts,
        "scheduled_at": job.scheduled_at,
        "started_at": job.started_at,
        "finished_at": job.finished_at,
        "heartbeat_at": job.heartbeat_at,
        "created_at": job.created_at,
        "updated_at": job.updated_at,
        "failure_code": job.failure_code,
        "failure_message": job.failure_message,
        "site": (
            None
            if site is None
            else {
                "id": site.id,
                "project_id": site.project_id,
                "name": site.name,
                "start_url": site.start_url,
                "is_enabled": site.is_enabled,
            }
        ),
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


def _persist_response_rendered_snapshot(page: Page, response: Any) -> None:
    artifact = getattr(response, "rendered_snapshot_artifact", None)
    if artifact is None:
        return
    try:
        write_rendered_snapshot_artifact(page, artifact)
    except Exception:
        return


def _serialize_consent_audit(row: PageConsentAudit) -> dict[str, Any]:
    result = row.result_json or {}
    return {
        "id": row.id,
        "status": row.status,
        "source": row.source,
        "requested_at": row.requested_at.isoformat() if row.requested_at else None,
        "started_at": row.started_at.isoformat() if row.started_at else None,
        "completed_at": row.completed_at.isoformat() if row.completed_at else None,
        "created_by_user_id": row.created_by_user_id,
        "crawl_persona_id": row.crawl_persona_id,
        "error_code": row.error_code,
        "error_message": row.error_message,
        "result": result,
        **result,
    }


def _target_fingerprint(element: MonitoringTargetElementIn) -> dict[str, Any]:
    html = element.outerHTML or ""
    class_tokens = [token for token in (element.className or "").split() if token]
    return {
        "tag": element.tag.lower(),
        "id_present": bool(element.id),
        "class_count": len(class_tokens),
        "selector": element.selector,
        "text_length": len(element.text or ""),
        "html_length": len(html),
        "link_count": len(re.findall(r"<a\b", html, flags=re.IGNORECASE)),
        "image_count": len(re.findall(r"<img\b|<picture\b|<source\b", html, flags=re.IGNORECASE)),
        "heading_count": len(re.findall(r"<h[1-6]\b", html, flags=re.IGNORECASE)),
    }


def _fingerprint_hash(fingerprint: dict[str, Any]) -> str:
    payload = json.dumps(fingerprint, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _serialize_monitoring_target(
    row: PageMonitoringTarget,
    *,
    latest_check: PageMonitoringTargetCheck | None = None,
    subscriptions: list[PageMonitoringTargetSubscription] | None = None,
) -> dict[str, Any]:
    active_subscriptions = [item for item in (subscriptions or []) if item.is_active]
    return {
        "id": row.id,
        "project_id": row.project_id,
        "project_site_id": row.project_site_id,
        "run_id": row.run_id,
        "page_id": row.page_id,
        "crawl_persona_id": row.crawl_persona_id,
        "name": row.name,
        "page_url": row.page_url,
        "selector": row.selector,
        "tag": row.tag,
        "fingerprint_hash": row.fingerprint_hash,
        "fingerprint": row.fingerprint_json or {},
        "source": row.source,
        "is_active": row.is_active,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
        "latest_check": _serialize_monitoring_target_check(latest_check) if latest_check else None,
        "active_subscription_count": len(active_subscriptions),
        "active_subscription_channels": sorted({item.channel_type for item in active_subscriptions}),
        "next_step": "Блок сохранён. После следующих успешных прогонов crawler проверит, остался ли он на странице.",
    }


def _serialize_monitoring_target_check(row: PageMonitoringTargetCheck) -> dict[str, Any]:
    return {
        "id": row.id,
        "target_id": row.target_id,
        "project_id": row.project_id,
        "project_site_id": row.project_site_id,
        "run_id": row.run_id,
        "page_id": row.page_id,
        "status": row.status,
        "message": row.message,
        "result": row.result_json or {},
        "checked_at": row.checked_at.isoformat() if row.checked_at else None,
    }


def _clean_subscription_channel(channel_type: str) -> str:
    channel = (channel_type or "").strip().lower().replace("-", "_")
    if channel not in MONITORING_SUBSCRIPTION_CHANNELS:
        raise HTTPException(
            status_code=422,
            detail="Notification channel must be email or telegram_chat",
        )
    return channel


def _clean_subscription_statuses(statuses: list[str] | None) -> list[str]:
    cleaned = sorted({(status or "").strip().lower() for status in (statuses or []) if (status or "").strip()})
    if not cleaned:
        raise HTTPException(status_code=422, detail="At least one notification status is required")
    unknown = [status for status in cleaned if status not in MONITORING_SUBSCRIPTION_STATUSES]
    if unknown:
        raise HTTPException(status_code=422, detail=f"Unsupported notification statuses: {', '.join(unknown)}")
    return cleaned


def _serialize_monitoring_subscription(row: PageMonitoringTargetSubscription) -> dict[str, Any]:
    return {
        "id": row.id,
        "target_id": row.target_id,
        "project_id": row.project_id,
        "channel_type": row.channel_type,
        "destination": row.destination,
        "statuses": row.statuses_json or [],
        "min_interval_minutes": row.min_interval_minutes,
        "is_active": row.is_active,
        "last_enqueued_at": row.last_enqueued_at.isoformat() if row.last_enqueued_at else None,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


def _serialize_monitoring_outbox(row: PageMonitoringNotificationOutbox) -> dict[str, Any]:
    return {
        "id": row.id,
        "subscription_id": row.subscription_id,
        "target_id": row.target_id,
        "target_check_id": row.target_check_id,
        "project_id": row.project_id,
        "channel_type": row.channel_type,
        "destination": row.destination,
        "event_status": row.event_status,
        "delivery_status": row.delivery_status,
        "attempts": row.attempts,
        "max_attempts": row.max_attempts,
        "next_attempt_at": row.next_attempt_at.isoformat() if row.next_attempt_at else None,
        "payload": row.payload_json or {},
        "last_error": row.last_error,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "sent_at": row.sent_at.isoformat() if row.sent_at else None,
    }


def _build_monitoring_notification_payload(
    *,
    target: PageMonitoringTarget,
    status: str,
    message: str,
    project_id: int,
    project_site_id: int | None,
    run_id: int | None,
    page_id: int | None,
    target_check_id: int | None,
    similarity: Any = None,
    is_test: bool = False,
) -> dict[str, Any]:
    return {
        "title": "Тест уведомления отслеживаемого блока" if is_test else "Отслеживаемый блок требует внимания",
        "target_name": target.name,
        "status": status,
        "message": message,
        "project_id": project_id,
        "project_site_id": project_site_id,
        "run_id": run_id,
        "page_id": page_id,
        "page_url": target.page_url,
        "target_id": target.id,
        "target_check_id": target_check_id,
        "target_path": f"/projects/{project_id}",
        "similarity": similarity,
        "is_test": is_test,
    }


def _element_fingerprint_from_html(tag_name: str, html: str, text: str, selector: str = "") -> dict[str, Any]:
    classes = re.findall(r'\bclass=["\']([^"\']+)["\']', html, flags=re.IGNORECASE)
    class_count = len({token for raw in classes for token in raw.split() if token})
    return {
        "tag": tag_name.lower(),
        "id_present": bool(re.search(r"\bid=", html, flags=re.IGNORECASE)),
        "class_count": class_count,
        "selector": selector,
        "text_length": len(text or ""),
        "html_length": len(html or ""),
        "link_count": len(re.findall(r"<a\b", html, flags=re.IGNORECASE)),
        "image_count": len(re.findall(r"<img\b|<picture\b|<source\b", html, flags=re.IGNORECASE)),
        "heading_count": len(re.findall(r"<h[1-6]\b", html, flags=re.IGNORECASE)),
    }


def _fingerprint_similarity(saved: dict[str, Any], candidate: dict[str, Any]) -> int:
    score = 0
    if saved.get("tag") == candidate.get("tag"):
        score += 30
    for key, weight in (
        ("class_count", 12),
        ("text_length", 16),
        ("html_length", 12),
        ("link_count", 10),
        ("image_count", 10),
        ("heading_count", 12),
    ):
        left = max(0, int(saved.get(key) or 0))
        right = max(0, int(candidate.get(key) or 0))
        scale = max(left, right, 1)
        score += max(0, round(weight - (abs(left - right) / scale) * weight))
    return max(0, min(100, score))


def _evaluate_monitoring_target_on_page(target: PageMonitoringTarget, page: Page) -> dict[str, Any]:
    if not page.html:
        return {
            "status": "not_checkable",
            "message": "У выбранной страницы нет сохранённого HTML для поиска блока.",
            "matches": [],
            "best_match": None,
        }
    soup = BeautifulSoup(page.html, "lxml")
    saved_fingerprint = target.fingerprint_json or {}
    matches = []
    try:
        selector_matches = soup.select(target.selector) if target.selector else []
    except Exception:
        selector_matches = []
    for node in selector_matches[:5]:
        html = str(node)
        text = node.get_text(" ", strip=True)
        fingerprint = _element_fingerprint_from_html(getattr(node, "name", "") or "", html, text, target.selector)
        matches.append({
            "strategy": "selector",
            "selector": target.selector,
            "tag": fingerprint["tag"],
            "text": text[:500],
            "similarity": _fingerprint_similarity(saved_fingerprint, fingerprint),
            "fingerprint": fingerprint,
        })
    if not matches:
        for node in soup.find_all(target.tag or True)[:200]:
            html = str(node)
            text = node.get_text(" ", strip=True)
            fingerprint = _element_fingerprint_from_html(getattr(node, "name", "") or "", html, text)
            similarity = _fingerprint_similarity(saved_fingerprint, fingerprint)
            if similarity >= 55:
                matches.append({
                    "strategy": "fingerprint",
                    "selector": "",
                    "tag": fingerprint["tag"],
                    "text": text[:500],
                    "similarity": similarity,
                    "fingerprint": fingerprint,
                })
        matches.sort(key=lambda item: int(item["similarity"]), reverse=True)
        matches = matches[:5]
    best = matches[0] if matches else None
    if not best:
        status = "missing"
        message = "Блок не найден на выбранной версии страницы."
    elif best["strategy"] == "selector" and int(best["similarity"]) >= 85:
        status = "matched"
        message = "Блок найден по сохранённому selector и структурно похож на исходный вариант."
    elif int(best["similarity"]) >= 70:
        status = "changed"
        message = "Похожий блок найден, но структура отличается. Нужна визуальная проверка."
    else:
        status = "changed"
        message = "Найден слабый кандидат. Вероятно, блок изменился или selector устарел."
    return {
        "status": status,
        "message": message,
        "matches": matches,
        "best_match": best,
    }


def _store_monitoring_target_check(
    db: Session,
    *,
    target: PageMonitoringTarget,
    run: Run,
    page: Page | None,
    evaluation: dict[str, Any],
) -> PageMonitoringTargetCheck:
    row = PageMonitoringTargetCheck(
        target_id=target.id,
        project_id=run.project_id,
        project_site_id=run.project_site_id,
        run_id=run.id,
        page_id=page.id if page else None,
        status=str(evaluation.get("status") or "not_checkable")[:30],
        message=str(evaluation.get("message") or ""),
        result_json=evaluation,
    )
    db.add(row)
    return row


def _emit_monitoring_target_event(
    db: Session,
    *,
    target: PageMonitoringTarget,
    run: Run,
    check: PageMonitoringTargetCheck,
    page: Page | None,
    evaluation: dict[str, Any],
) -> None:
    status = str(evaluation.get("status") or "")
    if status == "matched":
        return
    status_label = {
        "changed": "изменился",
        "missing": "не найден",
        "not_checkable": "требует ручной проверки",
    }.get(status, "требует внимания")
    severity = EVENT_SEVERITY_DANGER if status == "missing" else EVENT_SEVERITY_WARNING
    page_path = target.page_url
    try:
        parsed = urlparse(target.page_url)
        page_path = f"{parsed.path or '/'}{parsed.query and '?' + parsed.query or ''}"
    except Exception:
        page_path = target.page_url
    emit_event(
        db,
        event_type="monitoring.target.changed",
        channel=EVENT_CHANNEL_NOTIFICATION,
        severity=severity,
        title=f"Отслеживаемый блок: {status_label}",
        body=f"«{target.name}» на странице {page_path}: {evaluation.get('message') or 'Проверьте отслеживаемый блок.'}",
        target_path=f"/projects/{run.project_id}",
        target_ref=f"monitoring_target:{target.id}:check:{check.id}",
        actor_user_id=None,
        target_user_id=None,
        meta_json={
            "target_id": target.id,
            "target_check_id": check.id,
            "project_id": run.project_id,
            "project_site_id": run.project_site_id,
            "run_id": run.id,
            "page_id": page.id if page else None,
            "page_url": target.page_url,
            "target_name": target.name,
            "status": status,
            "similarity": (evaluation.get("best_match") or {}).get("similarity"),
        },
    )


def _enqueue_monitoring_target_notifications(
    db: Session,
    *,
    target: PageMonitoringTarget,
    run: Run,
    check: PageMonitoringTargetCheck,
    page: Page | None,
    evaluation: dict[str, Any],
) -> int:
    status = str(evaluation.get("status") or "")
    if status not in MONITORING_SUBSCRIPTION_STATUSES:
        return 0
    subscriptions = (
        db.query(PageMonitoringTargetSubscription)
        .filter(
            PageMonitoringTargetSubscription.target_id == target.id,
            PageMonitoringTargetSubscription.is_active.is_(True),
        )
        .all()
    )
    if not subscriptions:
        return 0
    now = datetime.utcnow()
    enqueued = 0
    for subscription in subscriptions:
        statuses = subscription.statuses_json or []
        if status not in statuses:
            continue
        if subscription.last_enqueued_at and subscription.min_interval_minutes > 0:
            next_allowed_at = subscription.last_enqueued_at + timedelta(minutes=subscription.min_interval_minutes)
            if next_allowed_at > now:
                continue
        payload = _build_monitoring_notification_payload(
            target=target,
            status=status,
            message=evaluation.get("message") or "",
            project_id=run.project_id,
            project_site_id=run.project_site_id,
            run_id=run.id,
            page_id=page.id if page else None,
            target_check_id=check.id,
            similarity=(evaluation.get("best_match") or {}).get("similarity"),
        )
        db.add(
            PageMonitoringNotificationOutbox(
                subscription_id=subscription.id,
                target_id=target.id,
                target_check_id=check.id,
                project_id=run.project_id,
                channel_type=subscription.channel_type,
                destination=subscription.destination,
                event_status=status,
                delivery_status="queued",
                attempts=0,
                max_attempts=monitoring_notification_max_attempts(),
                next_attempt_at=None,
                payload_json=payload,
                last_error="",
            )
        )
        subscription.last_enqueued_at = now
        subscription.updated_at = now
        enqueued += 1
    if enqueued:
        db.flush()
    return enqueued


def _run_monitoring_target_checks_for_run(db: Session, run: Run) -> int:
    targets = (
        db.query(PageMonitoringTarget)
        .filter(
            PageMonitoringTarget.project_id == run.project_id,
            PageMonitoringTarget.project_site_id == run.project_site_id,
            PageMonitoringTarget.crawl_persona_id == run.crawl_persona_id,
            PageMonitoringTarget.is_active.is_(True),
        )
        .all()
    )
    if not targets:
        return 0

    pages_by_url = {
        url: page
        for url, page in db.query(Page.url, Page).filter(Page.run_id == run.id).all()
    }
    checks_count = 0
    for target in targets:
        page = pages_by_url.get(target.page_url)
        if page is None:
            evaluation = {
                "status": "missing",
                "message": "Страница отслеживаемого блока не найдена в этом прогоне.",
                "matches": [],
                "best_match": None,
            }
        else:
            try:
                evaluation = _evaluate_monitoring_target_on_page(target, page)
            except Exception:
                evaluation = {
                    "status": "not_checkable",
                    "message": "Блок не удалось проверить автоматически. Нужна ручная проверка.",
                    "matches": [],
                    "best_match": None,
                }
        check = _store_monitoring_target_check(db, target=target, run=run, page=page, evaluation=evaluation)
        db.flush()
        _emit_monitoring_target_event(db, target=target, run=run, check=check, page=page, evaluation=evaluation)
        _enqueue_monitoring_target_notifications(db, target=target, run=run, check=check, page=page, evaluation=evaluation)
        checks_count += 1
    db.flush()
    return checks_count


def _is_retryable_job_failure(failure_code: str | None) -> bool:
    return (failure_code or "") in {
        "timeout",
        "connection_error",
        "request_error",
        "http_error",
        "browser_navigation_timeout",
        "browser_navigation_error",
        "browser_runtime_unavailable",
    }


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


class RunCancelInterrupt(Exception):
    pass


class RunCancelWatcher:
    def __init__(self, run_id: int, *, poll_seconds: float = 0.5):
        self.run_id = run_id
        self.poll_seconds = poll_seconds
        self.cancel_requested = threading.Event()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._clients: list[Any] = []
        self._lock = threading.Lock()

    def __enter__(self):
        self._thread = threading.Thread(target=self._watch, name=f"run-cancel-watch-{self.run_id}", daemon=True)
        self._thread.start()
        return self

    def __exit__(self, exc_type, exc, tb):
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=1.0)
        return False

    def register_client(self, client: Any) -> None:
        with self._lock:
            self._clients.append(client)
        if self.cancel_requested.is_set():
            self._close_client(client)

    def raise_if_cancelled(self) -> None:
        if self.cancel_requested.is_set():
            raise RunCancelInterrupt()

    def _watch(self) -> None:
        while not self._stop.wait(self.poll_seconds):
            if self._is_cancel_requested():
                self.cancel_requested.set()
                self._close_clients()
                return

    def _is_cancel_requested(self) -> bool:
        try:
            with SessionLocal() as db:
                status = db.query(Run.status).filter(Run.id == self.run_id).scalar()
                return status == "CANCEL_REQUESTED"
        except Exception:
            return False

    def _close_clients(self) -> None:
        with self._lock:
            clients = list(self._clients)
        for client in clients:
            self._close_client(client)

    @staticmethod
    def _close_client(client: Any) -> None:
        close = getattr(client, "close", None)
        if not callable(close):
            return
        try:
            close()
        except Exception:
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
        with RunCancelWatcher(run.id) as cancel_watcher:
            with _persona_crawl_client(persona, document_url=site.start_url) as client:
                cancel_watcher.register_client(client)
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
                        cancel_watcher.raise_if_cancelled()
                        resp = client.get(current)
                        cancel_watcher.raise_if_cancelled()
                    except RunCancelInterrupt:
                        db.refresh(run)
                        if run.status != "CANCEL_REQUESTED":
                            run.status = "CANCEL_REQUESTED"
                            run.failure_code = "cancel_requested"
                            run.failure_message = "Остановка запрошена."
                            run.progress_updated_at = datetime.utcnow()
                            db.commit()
                        _finalize_cancelled_run(
                            db,
                            run=run,
                            site=site,
                            persona=persona,
                            actor_user_id=actor_user_id,
                            job=job,
                        )
                        raise RunCancelled()
                    except Exception as exc:
                        if cancel_watcher.cancel_requested.is_set():
                            db.refresh(run)
                            if run.status != "CANCEL_REQUESTED":
                                run.status = "CANCEL_REQUESTED"
                                run.failure_code = "cancel_requested"
                                run.failure_message = "Остановка запрошена."
                                run.progress_updated_at = datetime.utcnow()
                                db.commit()
                            _finalize_cancelled_run(
                                db,
                                run=run,
                                site=site,
                                persona=persona,
                                actor_user_id=actor_user_id,
                                job=job,
                            )
                            raise RunCancelled()
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
                    db.flush()
                    _persist_response_rendered_snapshot(fetched_page, resp)
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
        _run_monitoring_target_checks_for_run(db, run)
        _emit_run_completion_event(
            db,
            run=run,
            site=site,
            persona=persona,
            actor_user_id=actor_user_id,
        )
        db.commit()
        finish_job_from_run(db, job=job, run=run)
        prune_site_persona_raw_artifacts(
            db,
            project_site_id=site.id,
            crawl_persona_id=run.crawl_persona_id,
        )
        db.commit()
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
    require_project_write(db, project_id=site.project_id, user=current_user)
    if not site.is_enabled:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "project_site_disabled",
                "message": f"Сайт «{site.name}» отключён и не может быть запущен.",
            },
        )
    _assert_no_active_site_run(db, site)
    enforce_actor_active_job_quota(
        db,
        actor_user_id=current_user.id,
        role=get_user_role(current_user),
        requested_jobs=1,
    )
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
    require_project_write(db, project_id=project_id, user=current_user)
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
    role = get_user_role(current_user)
    enforce_bulk_run_quota(role=role, sites_count=len(sites))
    enforce_actor_active_job_quota(
        db,
        actor_user_id=current_user.id,
        role=role,
        requested_jobs=len(sites),
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


def process_next_worker_job(db: Session) -> dict:
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
        failure_code = detail.get("code") or f"http_{exc.status_code}"
        failure_message = detail.get("message") or str(exc.detail)
        fail_job(
            db,
            job=job,
            failure_code=failure_code,
            failure_message=failure_message,
        )
        retry_job = (
            reschedule_job_retry(db, job=job, failure_code=failure_code, failure_message=failure_message)
            if _is_retryable_job_failure(failure_code)
            else None
        )
        if retry_job is not None:
            return {
                "ok": True,
                "processed": True,
                "job_id": retry_job.id,
                "run_id": retry_job.run_id,
                "project_site_id": site.id,
                "status": retry_job.status,
                "failure_code": retry_job.failure_code,
                "failure_message": retry_job.failure_message,
                "retry": {
                    "scheduled": True,
                    "attempts": retry_job.attempts,
                    "max_attempts": retry_job.max_attempts,
                    "scheduled_at": retry_job.scheduled_at.isoformat() if retry_job.scheduled_at else None,
                },
            }
        return {
            "ok": True,
            "processed": True,
            "job_id": job.id,
            "run_id": job.run_id,
            "project_site_id": site.id,
            "status": job.status,
            "failure_code": failure_code,
            "failure_message": failure_message,
            "retry": {"scheduled": False, "attempts": job.attempts, "max_attempts": job.max_attempts},
        }
    except Exception as exc:
        failure_code, failure_message = _classify_fetch_failure(exc)
        fail_job(db, job=job, failure_code=failure_code, failure_message=failure_message)
        retry_job = (
            reschedule_job_retry(db, job=job, failure_code=failure_code, failure_message=failure_message)
            if _is_retryable_job_failure(failure_code)
            else None
        )
        if retry_job is not None:
            return {
                "ok": True,
                "processed": True,
                "job_id": retry_job.id,
                "run_id": retry_job.run_id,
                "project_site_id": site.id,
                "status": retry_job.status,
                "failure_code": retry_job.failure_code,
                "failure_message": retry_job.failure_message,
                "retry": {
                    "scheduled": True,
                    "attempts": retry_job.attempts,
                    "max_attempts": retry_job.max_attempts,
                    "scheduled_at": retry_job.scheduled_at.isoformat() if retry_job.scheduled_at else None,
                },
            }
        return {
            "ok": True,
            "processed": True,
            "job_id": job.id,
            "run_id": job.run_id,
            "project_site_id": site.id,
            "status": job.status,
            "failure_code": failure_code,
            "failure_message": failure_message,
            "retry": {"scheduled": False, "attempts": job.attempts, "max_attempts": job.max_attempts},
        }

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
    return process_next_worker_job(db)


@router.post("/monitoring-notifications/worker/tick")
def monitoring_notification_worker_tick(
    limit: int = Query(default=20, ge=1, le=100),
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_permission("audit.view")),
):
    rows = deliver_queued_outbox(db, limit=limit)
    sent = len([row for row in rows if row.delivery_status == "sent"])
    failed = len([row for row in rows if row.delivery_status == "failed"])
    return {
        "ok": True,
        "processed": len(rows),
        "sent": sent,
        "failed": failed,
        "items": [_serialize_monitoring_outbox(row) for row in rows],
    }


@router.get("/monitoring-notifications/diagnostics")
def monitoring_notification_diagnostics(
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_permission("audit.view")),
):
    return monitoring_delivery_diagnostics(db)


@router.post("/{run_id}/retry-pages")
def retry_problem_pages(
    run_id: int,
    payload: RetryPagesIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("crawler.run")),
):
    run = db.get(Run, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    require_project_write(db, project_id=run.project_id, user=current_user)
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
    require_project_write(db, project_id=run.project_id, user=current_user)
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
    current_user: User = Depends(require_permission("data.view")),
):
    require_project_read(db, project_id=project_id, user=current_user)
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


@router.get("/active-jobs/by-project/{project_id}")
def list_active_project_jobs(
    project_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("data.view")),
):
    project = db.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    require_project_read(db, project_id=project_id, user=current_user)
    sites = (
        db.query(ProjectSite)
        .filter(ProjectSite.project_id == project_id)
        .order_by(ProjectSite.sort_order.asc(), ProjectSite.id.asc())
        .all()
    )
    jobs = []
    for site in sites:
        job = find_active_site_job(db, project_site_id=site.id)
        if job is None:
            continue
        persona = db.get(CrawlPersona, job.crawl_persona_id) if job.crawl_persona_id else None
        jobs.append(_serialize_crawler_job(job, site=site, persona=persona))
    return {
        "active": len(jobs) > 0,
        "project_id": project_id,
        "total": len(jobs),
        "jobs": jobs,
    }


@router.get("/by-site/{site_id}")
def list_site_runs(
    site_id: int,
    crawl_persona_id: int | None = None,
    page: int | None = None,
    page_size: int = 20,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("data.view")),
):
    site = db.get(ProjectSite, site_id)
    if not site:
        raise HTTPException(status_code=404, detail="Project site not found")
    require_project_read(db, project_id=site.project_id, user=current_user)
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


@router.get("/active-job/by-site/{site_id}")
def get_active_site_job(
    site_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("data.view")),
):
    site = db.get(ProjectSite, site_id)
    if not site:
        raise HTTPException(status_code=404, detail="Project site not found")
    require_project_read(db, project_id=site.project_id, user=current_user)
    job = find_active_site_job(db, project_site_id=site_id)
    if job is None:
        return {
            "active": False,
            "job": None,
            "site": {
                "id": site.id,
                "project_id": site.project_id,
                "name": site.name,
                "start_url": site.start_url,
                "is_enabled": site.is_enabled,
            },
        }
    persona = db.get(CrawlPersona, job.crawl_persona_id) if job.crawl_persona_id else None
    return {
        "active": True,
        "job": _serialize_crawler_job(job, site=site, persona=persona),
        "site": {
            "id": site.id,
            "project_id": site.project_id,
            "name": site.name,
            "start_url": site.start_url,
            "is_enabled": site.is_enabled,
        },
        "persona": None if persona is None else {
            "id": persona.id,
            "key": persona.key,
            "label": persona.label,
            "kind": persona.kind,
            "has_secrets": persona.has_secrets,
        },
    }


@router.get("/{run_id}/pages")
def list_pages(
    run_id: int,
    page: int | None = None,
    page_size: int = 20,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("data.view")),
):
    run = db.get(Run, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    require_project_read(db, project_id=run.project_id, user=current_user)
    query = db.query(Page).filter(Page.run_id == run_id).order_by(Page.id.asc())
    paged = paginate_query(query, page=page, page_size=page_size)
    if page is None:
        return [_serialize_page_list_item(item) for item in paged]
    items, total, safe_page, safe_page_size = paged
    return build_paged_response(
        items=[_serialize_page_list_item(item) for item in items],
        total=total,
        page=safe_page,
        page_size=safe_page_size,
    )


@router.get("/{run_id}/page-catalog")
def list_page_catalog(
    run_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("data.view")),
):
    run = db.get(Run, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    require_project_read(db, project_id=run.project_id, user=current_user)
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
            "title": _extract_page_search_meta(row.html)["title"],
        }
        for row in rows
    ]


@router.get("/{run_id}/page-context")
def get_page_context(
    run_id: int,
    url: str = Query(min_length=1),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("data.view")),
):
    run = db.get(Run, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    require_project_read(db, project_id=run.project_id, user=current_user)
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
    current_user: User = Depends(require_permission("data.view")),
):
    run = db.get(Run, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    require_project_read(db, project_id=run.project_id, user=current_user)
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
    current_user: User = Depends(require_permission("crawler.run")),
):
    run = db.get(Run, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    require_project_write(db, project_id=run.project_id, user=current_user)
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
    current_user: User = Depends(require_permission("data.view")),
):
    run = db.get(Run, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    require_project_read(db, project_id=run.project_id, user=current_user)
    page = db.query(Page).filter(Page.run_id == run_id, Page.url == url).first()
    if not page:
        raise HTTPException(status_code=404, detail="Page not found in this run")
    image_path = rendered_snapshot_file(page)
    if image_path is None:
        raise HTTPException(status_code=404, detail="Rendered snapshot not found")
    return FileResponse(image_path, media_type="image/jpeg", filename=f"page-{page.id}.jpg")


@router.post("/{run_id}/monitoring-targets")
def create_page_monitoring_target(
    run_id: int,
    payload: CreateMonitoringTargetIn,
    url: str = Query(min_length=1),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("projects.edit")),
):
    run = db.get(Run, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    require_project_write(db, project_id=run.project_id, user=current_user)
    page = db.query(Page).filter(Page.run_id == run_id, Page.url == url).first()
    if not page:
        raise HTTPException(status_code=404, detail="Page not found in this run")
    element = payload.element
    fingerprint = _target_fingerprint(element)
    name = (payload.name or "").strip() or f"{element.tag.lower()} · {element.selector[:160]}"
    row = PageMonitoringTarget(
        project_id=run.project_id,
        project_site_id=run.project_site_id,
        run_id=run.id,
        page_id=page.id,
        crawl_persona_id=run.crawl_persona_id,
        created_by_user_id=current_user.id,
        name=name[:240],
        page_url=page.url,
        selector=element.selector,
        tag=element.tag.lower(),
        element_text=element.text or "",
        element_html=element.outerHTML or "",
        element_rect_json=element.rect,
        fingerprint_hash=_fingerprint_hash(fingerprint),
        fingerprint_json=fingerprint,
        source=payload.source or "rendered_snapshot",
        is_active=True,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _serialize_monitoring_target(row)


@router.get("/monitoring-targets/by-project/{project_id}")
def list_project_monitoring_targets(
    project_id: int,
    limit: int = Query(default=20, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("data.view")),
):
    require_project_read(db, project_id=project_id, user=current_user)
    rows = (
        db.query(PageMonitoringTarget)
        .filter(PageMonitoringTarget.project_id == project_id)
        .order_by(PageMonitoringTarget.created_at.desc(), PageMonitoringTarget.id.desc())
        .limit(limit)
        .all()
    )
    target_ids = [row.id for row in rows]
    latest_checks: dict[int, PageMonitoringTargetCheck] = {}
    subscriptions_by_target: dict[int, list[PageMonitoringTargetSubscription]] = {}
    if target_ids:
        check_rows = (
            db.query(PageMonitoringTargetCheck)
            .filter(PageMonitoringTargetCheck.target_id.in_(target_ids))
            .order_by(PageMonitoringTargetCheck.target_id.asc(), PageMonitoringTargetCheck.checked_at.desc(), PageMonitoringTargetCheck.id.desc())
            .all()
        )
        for check in check_rows:
            if (check.result_json or {}).get("is_test"):
                continue
            if check.target_id not in latest_checks:
                latest_checks[check.target_id] = check
        subscription_rows = (
            db.query(PageMonitoringTargetSubscription)
            .filter(PageMonitoringTargetSubscription.target_id.in_(target_ids))
            .all()
        )
        for subscription in subscription_rows:
            subscriptions_by_target.setdefault(subscription.target_id, []).append(subscription)
    return {
        "items": [
            _serialize_monitoring_target(
                row,
                latest_check=latest_checks.get(row.id),
                subscriptions=subscriptions_by_target.get(row.id),
            )
            for row in rows
        ],
        "total": len(rows),
    }


@router.get("/monitoring-targets/{target_id}/checks")
def list_monitoring_target_checks(
    target_id: int,
    limit: int = Query(default=20, ge=1, le=100),
    include_tests: bool = Query(default=False),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("data.view")),
):
    target = db.get(PageMonitoringTarget, target_id)
    if not target:
        raise HTTPException(status_code=404, detail="Monitoring target not found")
    require_project_read(db, project_id=target.project_id, user=current_user)
    rows = (
        db.query(PageMonitoringTargetCheck)
        .filter(PageMonitoringTargetCheck.target_id == target_id)
        .order_by(PageMonitoringTargetCheck.checked_at.desc(), PageMonitoringTargetCheck.id.desc())
        .limit(limit * 2 if not include_tests else limit)
        .all()
    )
    if not include_tests:
        rows = [row for row in rows if not (row.result_json or {}).get("is_test")][:limit]
    return {
        "target": _serialize_monitoring_target(target),
        "items": [_serialize_monitoring_target_check(row) for row in rows],
        "total": len(rows),
    }


@router.patch("/monitoring-targets/{target_id}")
def update_monitoring_target(
    target_id: int,
    payload: UpdateMonitoringTargetIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("projects.edit")),
):
    target = db.get(PageMonitoringTarget, target_id)
    if not target:
        raise HTTPException(status_code=404, detail="Monitoring target not found")
    require_project_write(db, project_id=target.project_id, user=current_user)
    if payload.name is not None:
        name = payload.name.strip()
        if not name:
            raise HTTPException(status_code=422, detail="Target name cannot be empty")
        target.name = name[:240]
    if payload.is_active is not None:
        target.is_active = payload.is_active
    target.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(target)
    return _serialize_monitoring_target(target)


@router.delete("/monitoring-targets/{target_id}")
def delete_monitoring_target(
    target_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("projects.edit")),
):
    target = db.get(PageMonitoringTarget, target_id)
    if not target:
        raise HTTPException(status_code=404, detail="Monitoring target not found")
    require_project_write(db, project_id=target.project_id, user=current_user)
    db.delete(target)
    db.commit()
    return {"deleted": True, "target_id": target_id}


@router.get("/monitoring-targets/{target_id}/subscriptions")
def list_monitoring_target_subscriptions(
    target_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("data.view")),
):
    target = db.get(PageMonitoringTarget, target_id)
    if not target:
        raise HTTPException(status_code=404, detail="Monitoring target not found")
    require_project_read(db, project_id=target.project_id, user=current_user)
    rows = (
        db.query(PageMonitoringTargetSubscription)
        .filter(PageMonitoringTargetSubscription.target_id == target_id)
        .order_by(PageMonitoringTargetSubscription.created_at.desc(), PageMonitoringTargetSubscription.id.desc())
        .all()
    )
    return {"items": [_serialize_monitoring_subscription(row) for row in rows], "total": len(rows)}


@router.post("/monitoring-targets/{target_id}/subscriptions")
def create_monitoring_target_subscription(
    target_id: int,
    payload: CreateMonitoringTargetSubscriptionIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("projects.edit")),
):
    target = db.get(PageMonitoringTarget, target_id)
    if not target:
        raise HTTPException(status_code=404, detail="Monitoring target not found")
    require_project_write(db, project_id=target.project_id, user=current_user)
    row = PageMonitoringTargetSubscription(
        target_id=target.id,
        project_id=target.project_id,
        created_by_user_id=current_user.id,
        channel_type=_clean_subscription_channel(payload.channel_type),
        destination=payload.destination.strip(),
        statuses_json=_clean_subscription_statuses(payload.statuses),
        min_interval_minutes=payload.min_interval_minutes,
        is_active=True,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _serialize_monitoring_subscription(row)


@router.patch("/monitoring-subscriptions/{subscription_id}")
def update_monitoring_target_subscription(
    subscription_id: int,
    payload: UpdateMonitoringTargetSubscriptionIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("projects.edit")),
):
    row = db.get(PageMonitoringTargetSubscription, subscription_id)
    if not row:
        raise HTTPException(status_code=404, detail="Monitoring subscription not found")
    require_project_write(db, project_id=row.project_id, user=current_user)
    if payload.destination is not None:
        row.destination = payload.destination.strip()
    if payload.statuses is not None:
        row.statuses_json = _clean_subscription_statuses(payload.statuses)
    if payload.min_interval_minutes is not None:
        row.min_interval_minutes = payload.min_interval_minutes
    if payload.is_active is not None:
        row.is_active = payload.is_active
    row.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(row)
    return _serialize_monitoring_subscription(row)


@router.delete("/monitoring-subscriptions/{subscription_id}")
def delete_monitoring_target_subscription(
    subscription_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("projects.edit")),
):
    row = db.get(PageMonitoringTargetSubscription, subscription_id)
    if not row:
        raise HTTPException(status_code=404, detail="Monitoring subscription not found")
    require_project_write(db, project_id=row.project_id, user=current_user)
    db.delete(row)
    db.commit()
    return {"deleted": True, "subscription_id": subscription_id}


def _get_subscription_with_target_for_write(
    db: Session,
    *,
    subscription_id: int,
    current_user: User,
) -> tuple[PageMonitoringTargetSubscription, PageMonitoringTarget]:
    subscription = db.get(PageMonitoringTargetSubscription, subscription_id)
    if not subscription:
        raise HTTPException(status_code=404, detail="Monitoring subscription not found")
    require_project_write(db, project_id=subscription.project_id, user=current_user)
    target = db.get(PageMonitoringTarget, subscription.target_id)
    if not target:
        raise HTTPException(status_code=404, detail="Monitoring target not found")
    return subscription, target


def _monitoring_subscription_preview_payload(
    *,
    subscription: PageMonitoringTargetSubscription,
    target: PageMonitoringTarget,
    status: str,
) -> dict[str, Any]:
    cleaned_status = _clean_subscription_statuses([status])[0]
    message = "Тестовое уведомление: канал подключён к отслеживаемому блоку. Реальные уведомления появятся при изменении, пропаже или невозможности проверить блок."
    payload = _build_monitoring_notification_payload(
        target=target,
        status=cleaned_status,
        message=message,
        project_id=subscription.project_id,
        project_site_id=target.project_site_id,
        run_id=target.run_id,
        page_id=target.page_id,
        target_check_id=None,
        is_test=True,
    )
    subject, body = build_monitoring_notification_message(payload)
    return {
        "subscription": _serialize_monitoring_subscription(subscription),
        "target": _serialize_monitoring_target(target),
        "subject": subject,
        "body": body,
        "payload": payload,
    }


@router.post("/monitoring-subscriptions/{subscription_id}/preview")
def preview_monitoring_target_subscription(
    subscription_id: int,
    payload: PreviewMonitoringTargetSubscriptionIn | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("projects.edit")),
):
    subscription, target = _get_subscription_with_target_for_write(
        db,
        subscription_id=subscription_id,
        current_user=current_user,
    )
    preview_status = (payload.status if payload else "not_checkable") or "not_checkable"
    return _monitoring_subscription_preview_payload(subscription=subscription, target=target, status=preview_status)


@router.post("/monitoring-subscriptions/{subscription_id}/test-send")
def test_send_monitoring_target_subscription(
    subscription_id: int,
    payload: PreviewMonitoringTargetSubscriptionIn | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("projects.edit")),
):
    subscription, target = _get_subscription_with_target_for_write(
        db,
        subscription_id=subscription_id,
        current_user=current_user,
    )
    preview_status = (payload.status if payload else "not_checkable") or "not_checkable"
    preview = _monitoring_subscription_preview_payload(subscription=subscription, target=target, status=preview_status)
    check = PageMonitoringTargetCheck(
        target_id=target.id,
        project_id=target.project_id,
        project_site_id=target.project_site_id,
        run_id=target.run_id,
        page_id=target.page_id,
        status=preview["payload"]["status"],
        message="Тестовая проверка для проверки доставки уведомления.",
        result_json={"status": preview["payload"]["status"], "message": preview["payload"]["message"], "is_test": True},
    )
    db.add(check)
    db.flush()
    preview["payload"]["target_check_id"] = check.id
    row = PageMonitoringNotificationOutbox(
        subscription_id=subscription.id,
        target_id=target.id,
        target_check_id=check.id,
        project_id=target.project_id,
        channel_type=subscription.channel_type,
        destination=subscription.destination,
        event_status=preview["payload"]["status"],
        delivery_status="queued",
        attempts=0,
        max_attempts=monitoring_notification_max_attempts(),
        next_attempt_at=None,
        payload_json=preview["payload"],
        last_error="",
    )
    db.add(row)
    db.flush()
    deliver_outbox_row(db, row)
    db.commit()
    db.refresh(row)
    return {
        "ok": row.delivery_status == "sent",
        "preview": {key: preview[key] for key in ("subject", "body", "payload")},
        "outbox": _serialize_monitoring_outbox(row),
    }


@router.get("/monitoring-targets/{target_id}/notification-outbox")
def list_monitoring_target_notification_outbox(
    target_id: int,
    limit: int = Query(default=20, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("data.view")),
):
    target = db.get(PageMonitoringTarget, target_id)
    if not target:
        raise HTTPException(status_code=404, detail="Monitoring target not found")
    require_project_read(db, project_id=target.project_id, user=current_user)
    rows = (
        db.query(PageMonitoringNotificationOutbox)
        .filter(PageMonitoringNotificationOutbox.target_id == target_id)
        .order_by(PageMonitoringNotificationOutbox.created_at.desc(), PageMonitoringNotificationOutbox.id.desc())
        .limit(limit)
        .all()
    )
    return {"items": [_serialize_monitoring_outbox(row) for row in rows], "total": len(rows)}


@router.post("/monitoring-targets/{target_id}/check")
def check_monitoring_target(
    target_id: int,
    run_id: int | None = Query(default=None),
    url: str | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("data.view")),
):
    target = db.get(PageMonitoringTarget, target_id)
    if not target:
        raise HTTPException(status_code=404, detail="Monitoring target not found")
    require_project_read(db, project_id=target.project_id, user=current_user)
    query = db.query(Page)
    if run_id is not None:
        query = query.filter(Page.run_id == run_id)
    else:
        query = query.filter(Page.run_id == target.run_id)
    query = query.filter(Page.url == (url or target.page_url))
    page = query.first()
    if not page:
        raise HTTPException(status_code=404, detail="Page not found for target check")
    run = db.get(Run, page.run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    require_project_read(db, project_id=run.project_id, user=current_user)
    evaluation = _evaluate_monitoring_target_on_page(target, page)
    return {
        "target": _serialize_monitoring_target(target),
        "checked_run_id": run.id,
        "checked_page_id": page.id,
        "checked_url": page.url,
        **evaluation,
    }


@router.post("/{run_id}/consent-audit")
def create_page_consent_audit(
    run_id: int,
    url: str = Query(min_length=1),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("crawler.run")),
):
    run = db.get(Run, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    require_project_write(db, project_id=run.project_id, user=current_user)
    page = db.query(Page).filter(Page.run_id == run_id, Page.url == url).first()
    if not page:
        raise HTTPException(status_code=404, detail="Page not found in this run")
    audit_row = PageConsentAudit(
        project_id=run.project_id,
        project_site_id=run.project_site_id,
        run_id=run.id,
        page_id=page.id,
        crawl_persona_id=run.crawl_persona_id,
        created_by_user_id=current_user.id,
        status="RUNNING",
        source="stored_html_live_scripts",
        requested_at=datetime.utcnow(),
        started_at=datetime.utcnow(),
    )
    db.add(audit_row)
    db.commit()
    db.refresh(audit_row)
    persona_browser_state = None
    persona = db.get(CrawlPersona, run.crawl_persona_id) if run.crawl_persona_id else None
    if persona and persona.has_secrets and persona.encrypted_session_bundle:
        try:
            persona_browser_state = build_browser_persona_state(
                decrypt_session_bundle(persona.encrypted_session_bundle),
                document_url=page.final_url or page.url,
            )
        except ValueError as exc:
            audit_row.status = "FAILED"
            audit_row.error_code = "persona_session_unavailable"
            audit_row.error_message = "Сессию выбранной персоны не удалось расшифровать."
            audit_row.completed_at = datetime.utcnow()
            db.commit()
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "persona_session_unavailable",
                    "message": "Сессию выбранной персоны не удалось расшифровать. Подключите session bundle заново.",
                },
            ) from exc
    try:
        result = run_consent_audit(page, persona_browser_state=persona_browser_state)
        audit_row.status = "COMPLETED"
        audit_row.result_json = result
        audit_row.error_code = None
        audit_row.error_message = None
        audit_row.completed_at = datetime.utcnow()
        db.commit()
        db.refresh(audit_row)
        return _serialize_consent_audit(audit_row)
    except ValueError as exc:
        audit_row.status = "FAILED"
        audit_row.error_code = "invalid_page"
        audit_row.error_message = str(exc)
        audit_row.completed_at = datetime.utcnow()
        db.commit()
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except Exception as exc:
        audit_row.status = "FAILED"
        audit_row.error_code = "browser_audit_failed"
        audit_row.error_message = "Не удалось выполнить browser-аудит consent."
        audit_row.completed_at = datetime.utcnow()
        db.commit()
        raise HTTPException(
            status_code=503,
            detail=(
                "Не удалось выполнить browser-аудит consent. Проверьте Chromium в backend-контейнере "
                "и повторите попытку."
            ),
        ) from exc


@router.get("/{run_id}/consent-audits")
def list_page_consent_audits(
    run_id: int,
    url: str = Query(min_length=1),
    limit: int = Query(default=5, ge=1, le=20),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("data.view")),
):
    run = db.get(Run, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    require_project_read(db, project_id=run.project_id, user=current_user)
    page = db.query(Page).filter(Page.run_id == run_id, Page.url == url).first()
    if not page:
        raise HTTPException(status_code=404, detail="Page not found in this run")
    rows = (
        db.query(PageConsentAudit)
        .filter(PageConsentAudit.page_id == page.id)
        .order_by(PageConsentAudit.requested_at.desc(), PageConsentAudit.id.desc())
        .limit(limit)
        .all()
    )
    return {
        "items": [_serialize_consent_audit(row) for row in rows],
        "total": len(rows),
        "queued_supported": False,
        "queued_explanation": "Очередь consent-аудитов будет подключена после отдельного worker-контракта; текущие аудиты выполняются сразу по кнопке и сохраняются в истории.",
    }
