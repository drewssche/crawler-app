import hashlib
from collections import deque
from datetime import datetime
from urllib.parse import urldefrag, urljoin, urlparse

import httpx
from fastapi import APIRouter, Depends, HTTPException
from bs4 import BeautifulSoup
from sqlalchemy.orm import Session

from app.core.paging import build_paged_response, paginate_query
from app.db.models.page import Page
from app.db.models.profile import Profile
from app.db.models.run import Run
from app.db.session import get_db

router = APIRouter(prefix="/runs", tags=["runs"])


def _classify_fetch_failure(exc: Exception) -> tuple[str, str]:
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


def _parse_allowed_domains(profile: Profile) -> set[str]:
    raw = (profile.allowed_domains_csv or "").strip()
    if not raw:
        host = (urlparse(profile.start_url).hostname or "").lower().strip()
        return {host} if host else set()
    return {x.strip().lower() for x in raw.split(",") if x.strip()}


def _parse_excluded_ext(profile: Profile) -> tuple[str, ...]:
    raw = (profile.exclude_ext_csv or "").strip()
    if not raw:
        return ()
    return tuple(x.strip().lower() for x in raw.split(",") if x.strip())


def _normalize_url(url: str) -> str:
    clean, _frag = urldefrag(url)
    return clean.strip()


def _build_seed_urls(profile: Profile, allowed_domains: set[str]) -> list[str]:
    start_url = _normalize_url(profile.start_url)
    parsed_start = urlparse(start_url)
    scheme = parsed_start.scheme if parsed_start.scheme in {"http", "https"} else "https"

    seeds: list[str] = []
    seen: set[str] = set()

    def _push(url: str) -> None:
        normalized = _normalize_url(url)
        if not normalized or normalized in seen:
            return
        seen.add(normalized)
        seeds.append(normalized)

    _push(start_url)
    for domain in sorted(allowed_domains):
        host = (domain or "").strip().lower()
        if not host:
            continue
        _push(f"{scheme}://{host}/")
    return seeds


def _is_allowed_url(url: str, allowed_domains: set[str], excluded_ext: tuple[str, ...]) -> bool:
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
    path = (parsed.path or "").lower()
    if excluded_ext and any(path.endswith(ext) for ext in excluded_ext):
        return False
    return True


@router.post("/start/{profile_id}")
def start_run(profile_id: int, db: Session = Depends(get_db)):
    profile = db.get(Profile, profile_id)
    if not profile:
        raise HTTPException(status_code=404, detail="Profile not found")

    active_run = (
        db.query(Run)
        .filter(Run.profile_id == profile_id, Run.status == "RUNNING")
        .order_by(Run.id.desc())
        .first()
    )
    if active_run is not None:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "run_already_active",
                "message": "Для этого проекта уже выполняется прогон. Дождитесь его завершения.",
                "run_id": active_run.id,
            },
        )

    run = Run(profile_id=profile_id, status="RUNNING", started_at=datetime.utcnow())
    db.add(run)
    db.commit()
    db.refresh(run)

    allowed_domains = _parse_allowed_domains(profile)
    excluded_ext = _parse_excluded_ext(profile)
    seed_urls = _build_seed_urls(profile, allowed_domains)
    max_pages = max(1, min(int(profile.max_pages or 1), 10_000))

    try:
        with httpx.Client(follow_redirects=True, timeout=20) as client:
            queue: deque[str] = deque(
                [url for url in seed_urls if _is_allowed_url(url, allowed_domains, excluded_ext)]
            )
            queued: set[str] = set(queue)
            visited: set[str] = set()
            pages: list[Page] = []
            first_failure: tuple[str, str] | None = None

            while queue and len(pages) < max_pages:
                current = queue.popleft()
                if current in visited:
                    continue
                visited.add(current)

                try:
                    resp = client.get(current)
                except Exception as exc:
                    if first_failure is None:
                        first_failure = _classify_fetch_failure(exc)
                    continue

                final_url = _normalize_url(str(resp.url))
                ct = (resp.headers.get("content-type", "") or "").lower()
                html = resp.text if "text/html" in ct else ""
                h = hashlib.sha256(html.encode("utf-8", errors="ignore")).hexdigest() if html else ""

                pages.append(
                    Page(
                        run_id=run.id,
                        url=final_url,
                        status_code=resp.status_code,
                        content_type=ct,
                        html=html,
                        html_hash=h,
                    )
                )

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
                    if not _is_allowed_url(candidate, allowed_domains, excluded_ext):
                        continue
                    queue.append(candidate)
                    queued.add(candidate)

        for page in pages:
            db.add(page)

        run.pages_total = len(pages)
        successful_html_pages = [page for page in pages if page.status_code < 400 and bool(page.html)]
        if not successful_html_pages:
            if first_failure is not None:
                failure_code, failure_message = first_failure
            elif pages and all(page.status_code >= 400 for page in pages):
                failure_code = "http_error"
                failure_message = "Сайт ответил ошибкой и не отдал доступные страницы."
            else:
                failure_code = "no_html_pages"
                failure_message = "Сайт доступен, но HTML-страницы для мониторинга не найдены."
            run.status = "FAILED"
            run.failure_code = failure_code
            run.failure_message = failure_message
            run.finished_at = datetime.utcnow()
            db.commit()
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
            .filter(Run.profile_id == profile_id, Run.status == "FINISHED", Run.id < run.id)
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
        db.commit()
    except HTTPException:
        if run.status != "FAILED":
            run.status = "FAILED"
            run.failure_code = run.failure_code or "request_failed"
            run.failure_message = run.failure_message or "Прогон не удалось завершить."
            run.finished_at = datetime.utcnow()
            db.commit()
        raise
    except Exception as exc:
        failure_code, failure_message = _classify_fetch_failure(exc)
        run.status = "FAILED"
        run.failure_code = failure_code
        run.failure_message = failure_message
        run.finished_at = datetime.utcnow()
        db.commit()
        raise

    return {"ok": True, "run_id": run.id}


@router.get("/by-profile/{profile_id}")
def list_runs(
    profile_id: int,
    page: int | None = None,
    page_size: int = 20,
    db: Session = Depends(get_db),
):
    query = db.query(Run).filter(Run.profile_id == profile_id).order_by(Run.id.desc())
    paged = paginate_query(query, page=page, page_size=page_size)
    if page is None:
        return paged
    items, total, safe_page, safe_page_size = paged
    return build_paged_response(items=items, total=total, page=safe_page, page_size=safe_page_size)


@router.get("/{run_id}/pages")
def list_pages(
    run_id: int,
    page: int | None = None,
    page_size: int = 20,
    db: Session = Depends(get_db),
):
    query = db.query(Page).filter(Page.run_id == run_id).order_by(Page.id.asc())
    paged = paginate_query(query, page=page, page_size=page_size)
    if page is None:
        return paged
    items, total, safe_page, safe_page_size = paged
    return build_paged_response(items=items, total=total, page=safe_page, page_size=safe_page_size)
