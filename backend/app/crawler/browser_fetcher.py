import json
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlparse

from playwright.sync_api import Error as PlaywrightError
from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
from playwright.sync_api import sync_playwright

from app.crawler.renderer import RenderedSnapshotArtifact, capture_live_browser_page_snapshot


class BrowserCrawlerError(RuntimeError):
    def __init__(self, code: str, user_message: str, *, technical_message: str = ""):
        super().__init__(technical_message or user_message)
        self.code = code
        self.user_message = user_message
        self.technical_message = technical_message or user_message


def _session_storage_init_script(session_storage: dict[str, list[dict[str, str]]]) -> str:
    if not session_storage:
        return ""
    serialized = json.dumps(session_storage, ensure_ascii=False)
    return """
    (() => {
      const state = __SESSION_STORAGE_STATE__;
      const rows = state[window.location.origin] || [];
      for (const item of rows) {
        try {
          window.sessionStorage.setItem(String(item.name), String(item.value));
        } catch (_error) {}
      }
    })();
    """.replace("__SESSION_STORAGE_STATE__", serialized)


def browser_state_requires_runtime(state: dict[str, Any] | None) -> bool:
    summary = (state or {}).get("summary") or {}
    return bool(
        int(summary.get("local_storage_count") or 0) > 0
        or int(summary.get("session_storage_count") or 0) > 0
    )


@dataclass
class BrowserFetchResponse:
    url: str
    status_code: int
    headers: dict[str, str]
    text: str
    history: list[Any]
    rendered_snapshot_artifact: RenderedSnapshotArtifact | None = None


class BrowserPersonaClient:
    def __init__(self, persona_browser_state: dict[str, Any], *, timeout_ms: int = 30_000):
        self.persona_browser_state = persona_browser_state
        self.timeout_ms = timeout_ms
        self.playwright = None
        self.browser = None
        self.context = None

    def __enter__(self):
        state = self.persona_browser_state or {}
        try:
            self.playwright = sync_playwright().start()
            self.browser = self.playwright.chromium.launch(headless=True)
            self.context = self.browser.new_context(
                viewport={"width": 1440, "height": 1000},
                java_script_enabled=True,
                ignore_https_errors=True,
                storage_state=state.get("storage_state"),
                extra_http_headers=state.get("extra_http_headers") or None,
            )
            session_script = _session_storage_init_script(state.get("session_storage") or {})
            if session_script:
                self.context.add_init_script(session_script)
            return self
        except Exception as exc:
            self.__exit__(type(exc), exc, getattr(exc, "__traceback__", None))
            raise BrowserCrawlerError(
                "browser_runtime_unavailable",
                (
                    "Не удалось запустить browser runtime для авторизованного обхода. "
                    "Проверьте Chromium/Playwright в backend-контейнере и пересоберите backend."
                ),
                technical_message=str(exc),
            ) from exc

    def __exit__(self, exc_type, exc, tb):
        self.close()
        return False

    def close(self):
        for resource in (self.context, self.browser):
            if resource is None:
                continue
            try:
                resource.close()
            except Exception:
                pass
        if self.playwright is not None:
            try:
                self.playwright.stop()
            except Exception:
                pass
        self.context = None
        self.browser = None
        self.playwright = None

    def get(self, url: str) -> BrowserFetchResponse:
        if self.context is None:
            raise RuntimeError("BrowserPersonaClient must be used as a context manager.")
        page = self.context.new_page()
        try:
            try:
                response = page.goto(url, wait_until="domcontentloaded", timeout=self.timeout_ms)
            except PlaywrightTimeoutError as exc:
                raise BrowserCrawlerError(
                    "browser_navigation_timeout",
                    "Browser-crawler не дождался загрузки страницы. Попробуйте повторить позже или проверьте скорость сайта.",
                    technical_message=str(exc),
                ) from exc
            except PlaywrightError as exc:
                raise BrowserCrawlerError(
                    "browser_navigation_error",
                    "Browser-crawler не смог открыть страницу в авторизованном контексте.",
                    technical_message=str(exc),
                ) from exc
            try:
                page.wait_for_load_state("networkidle", timeout=3_000)
            except Exception:
                pass
            final_url = page.url
            html = page.content()
            rendered_snapshot_artifact = None
            try:
                rendered_snapshot_artifact = capture_live_browser_page_snapshot(page)
            except Exception:
                rendered_snapshot_artifact = None
            status_code = int(response.status) if response is not None else 0
            headers = {str(key).lower(): str(value) for key, value in (response.headers if response is not None else {}).items()}
            if "content-type" not in headers and _looks_like_html_url(final_url):
                headers["content-type"] = "text/html; charset=utf-8"
            return BrowserFetchResponse(
                url=final_url,
                status_code=status_code,
                headers=headers,
                text=html,
                history=[],
                rendered_snapshot_artifact=rendered_snapshot_artifact,
            )
        finally:
            page.close()


def _looks_like_html_url(url: str) -> bool:
    path = (urlparse(url).path or "").lower()
    return not path or path.endswith("/") or "." not in path.rsplit("/", 1)[-1] or path.endswith((".html", ".htm", ".php"))
