import hashlib
from collections import deque
from datetime import datetime
from urllib.parse import urldefrag, urljoin, urlparse

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from bs4 import BeautifulSoup
from sqlalchemy.orm import Session

from app.core.paging import build_paged_response, paginate_query
from app.core.site_scope import CanonicalSiteScope, canonicalize_site_scope, is_url_in_site_scope
from app.db.models.page import Page
from app.db.models.profile import Profile
from app.db.models.project_site import ProjectSite
from app.db.models.run import Run
from app.db.models.user import User
from app.db.session import get_db
from app.core.security import require_permission
from app.services.project_sites import create_primary_site_for_profile
from app.services.page_context import build_page_context

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


def _assert_no_active_project_run(db: Session, profile_id: int) -> None:
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


def _assert_no_active_site_run(db: Session, site: ProjectSite) -> None:
    active_run = (
        db.query(Run)
        .filter(Run.project_site_id == site.id, Run.status == "RUNNING")
        .order_by(Run.id.desc())
        .first()
    )
    if active_run is not None:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "site_run_already_active",
                "message": f"Для сайта «{site.name}» уже выполняется прогон.",
                "run_id": active_run.id,
                "project_site_id": site.id,
            },
        )


def _get_primary_site(db: Session, profile: Profile) -> ProjectSite:
    site = (
        db.query(ProjectSite)
        .filter(ProjectSite.profile_id == profile.id, ProjectSite.is_enabled.is_(True))
        .order_by(ProjectSite.sort_order.asc(), ProjectSite.id.asc())
        .first()
    )
    if site is not None:
        return site
    existing_site = (
        db.query(ProjectSite)
        .filter(ProjectSite.profile_id == profile.id)
        .order_by(ProjectSite.sort_order.asc(), ProjectSite.id.asc())
        .first()
    )
    if existing_site is not None:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "project_has_no_enabled_sites",
                "message": "В проекте нет включённых сайтов для запуска.",
            },
        )
    site = create_primary_site_for_profile(db, profile)
    db.flush()
    return site


def _execute_site_run(db: Session, site: ProjectSite) -> Run:
    scope = canonicalize_site_scope(
        site.start_url,
        scope_mode=site.scope_mode,
        path_prefix=site.path_prefix,
    )
    run = Run(
        profile_id=site.profile_id,
        project_site_id=site.id,
        status="RUNNING",
        started_at=datetime.utcnow(),
    )
    db.add(run)
    db.commit()
    db.refresh(run)

    allowed_domains = _parse_allowed_domains(site)
    excluded_ext = _parse_excluded_ext(site)
    max_pages = max(1, min(int(site.max_pages or 1), 10_000))

    try:
        with httpx.Client(follow_redirects=True, timeout=20) as client:
            queue: deque[str] = deque([site.start_url])
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
                    continue
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
                    if not _is_allowed_url(
                        candidate,
                        scope=scope,
                        allowed_domains=allowed_domains,
                        excluded_ext=excluded_ext,
                    ):
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
            .filter(
                Run.project_site_id == site.id,
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

    return run


@router.post("/start/{profile_id}")
def start_run(
    profile_id: int,
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_permission("crawler.run")),
):
    profile = db.get(Profile, profile_id)
    if not profile:
        raise HTTPException(status_code=404, detail="Profile not found")
    _assert_no_active_project_run(db, profile_id)
    site = _get_primary_site(db, profile)
    run = _execute_site_run(db, site)
    return {"ok": True, "run_id": run.id, "project_site_id": site.id}


@router.post("/start-site/{site_id}")
def start_site_run(
    site_id: int,
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_permission("crawler.run")),
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
    run = _execute_site_run(db, site)
    return {"ok": True, "run_id": run.id, "project_site_id": site.id}


@router.post("/start-project/{profile_id}")
def start_project_sites(
    profile_id: int,
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_permission("crawler.run")),
):
    profile = db.get(Profile, profile_id)
    if not profile:
        raise HTTPException(status_code=404, detail="Profile not found")
    sites = (
        db.query(ProjectSite)
        .filter(ProjectSite.profile_id == profile_id, ProjectSite.is_enabled.is_(True))
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
        try:
            _assert_no_active_site_run(db, site)
            run = _execute_site_run(db, site)
            results.append(
                {
                    "project_site_id": site.id,
                    "site_name": site.name,
                    "run_id": run.id,
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
        "profile_id": profile_id,
        "sites_total": len(sites),
        "finished": sum(1 for row in results if row["status"] == "FINISHED"),
        "failed": sum(1 for row in results if row["status"] == "FAILED"),
        "skipped": sum(1 for row in results if row["status"] == "SKIPPED"),
        "results": results,
    }


@router.get("/by-profile/{profile_id}")
def list_runs(
    profile_id: int,
    page: int | None = None,
    page_size: int = 20,
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_permission("data.view")),
):
    query = db.query(Run).filter(Run.profile_id == profile_id).order_by(Run.id.desc())
    paged = paginate_query(query, page=page, page_size=page_size)
    if page is None:
        return paged
    items, total, safe_page, safe_page_size = paged
    return build_paged_response(items=items, total=total, page=safe_page, page_size=safe_page_size)


@router.get("/by-site/{site_id}")
def list_site_runs(
    site_id: int,
    page: int | None = None,
    page_size: int = 20,
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_permission("data.view")),
):
    if not db.get(ProjectSite, site_id):
        raise HTTPException(status_code=404, detail="Project site not found")
    query = db.query(Run).filter(Run.project_site_id == site_id).order_by(Run.id.desc())
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
        db.query(Page.id, Page.url, Page.status_code, Page.html_hash)
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
        "url": page.url,
        "status_code": page.status_code,
        "content_type": page.content_type,
        "html": page.html,
        "html_hash": page.html_hash,
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
    }
