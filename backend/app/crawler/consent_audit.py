import json
import re
from datetime import datetime, timezone
from urllib.parse import urlparse

from bs4 import BeautifulSoup
from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
from playwright.sync_api import sync_playwright

from app.db.models.page import Page


CONSENT_BUTTON_PATTERNS = (
    r"\baccept all\b",
    r"\baccept\b",
    r"\bagree\b",
    r"\ballow all\b",
    r"\bok\b",
    r"\bgot it\b",
    r"\bсоглас",
    r"\bпринять\b",
    r"\bразреш",
    r"\bподтверд",
)

TRACKING_MARKERS = (
    ("Google Tag Manager", re.compile(r"googletagmanager\.com|GTM-[A-Z0-9]+", re.I)),
    ("Google Analytics", re.compile(r"google-analytics\.com|analytics\.google\.com|gtag/js|G-[A-Z0-9]{5,}|UA-\d+-\d+", re.I)),
    ("Google Ads", re.compile(r"googleadservices\.com|doubleclick\.net|AW-\d+", re.I)),
    ("Яндекс Метрика", re.compile(r"mc\.yandex\.ru|yandex\.ru/metrika|ym\(", re.I)),
    ("Meta Pixel", re.compile(r"connect\.facebook\.net|facebook\.com/tr|fbq\(", re.I)),
)


def _runtime_audit_document(page: Page) -> str:
    soup = BeautifulSoup(page.html or "<html><body></body></html>", "lxml")
    for node in soup.select("iframe, object, embed, form, meta[http-equiv]"):
        node.decompose()
    if soup.head is None:
        head = soup.new_tag("head")
        if soup.html is None:
            html = soup.new_tag("html")
            html.append(head)
            html.append(soup.new_tag("body"))
            soup.append(html)
        else:
            soup.html.insert(0, head)
    for base in soup.select("base"):
        base.decompose()
    base = soup.new_tag("base", href=page.final_url or page.url)
    soup.head.insert(0, base)
    return f"<!doctype html>{soup}"


def _safe_cookie_names(cookies: list[dict]) -> list[str]:
    return sorted({str(cookie.get("name") or "") for cookie in cookies if cookie.get("name")})


def _extract_document_cookie_names(raw_cookie: str) -> list[str]:
    names = []
    for chunk in (raw_cookie or "").split(";"):
        name = chunk.strip().split("=", 1)[0].strip()
        if name:
            names.append(name)
    return sorted(set(names))


def _tracking_providers(request_urls: list[str]) -> list[str]:
    providers = []
    haystack = "\n".join(request_urls)
    for provider, pattern in TRACKING_MARKERS:
        if pattern.search(haystack):
            providers.append(provider)
    return providers


def _summarize_requests(requests: list[dict]) -> dict:
    urls = [item["url"] for item in requests]
    return {
        "total": len(requests),
        "script": sum(1 for item in requests if item["resource_type"] == "script"),
        "xhr_fetch": sum(1 for item in requests if item["resource_type"] in {"xhr", "fetch"}),
        "tracking_providers": _tracking_providers(urls),
        "sample": urls[:20],
    }


def _click_consent_button(browser_page) -> dict:
    pattern = re.compile("|".join(CONSENT_BUTTON_PATTERNS), re.I)
    candidates = browser_page.locator("button, a, input[type='button'], input[type='submit'], [role='button']")
    count = min(candidates.count(), 80)
    for index in range(count):
        candidate = candidates.nth(index)
        try:
            label = candidate.inner_text(timeout=600).strip()
        except Exception:
            label = ""
        try:
            value = candidate.get_attribute("value", timeout=300) or ""
        except Exception:
            value = ""
        try:
            aria = candidate.get_attribute("aria-label", timeout=300) or ""
        except Exception:
            aria = ""
        text = " ".join(part for part in (label, value, aria) if part).strip()
        if not text or not pattern.search(text):
            continue
        try:
            candidate.click(timeout=2_000, force=True)
            return {"clicked": True, "label": text[:120], "explanation": "Найдена и нажата типовая кнопка согласия."}
        except Exception:
            continue
    return {"clicked": False, "label": "", "explanation": "Типовая кнопка согласия не найдена или не нажалась автоматически."}


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


def run_consent_audit(page: Page, persona_browser_state: dict | None = None) -> dict:
    if not page.html:
        raise ValueError("Для страницы не сохранён HTML.")

    document = _runtime_audit_document(page)
    document_url = page.final_url or page.url
    before_requests: list[dict] = []
    after_requests: list[dict] = []
    phase = {"value": "before"}

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        state = persona_browser_state or {}
        context = browser.new_context(
            viewport={"width": 1440, "height": 1000},
            java_script_enabled=True,
            ignore_https_errors=True,
            storage_state=state.get("storage_state"),
            extra_http_headers=state.get("extra_http_headers") or None,
        )
        browser_page = context.new_page()
        session_script = _session_storage_init_script(state.get("session_storage") or {})
        if session_script:
            browser_page.add_init_script(session_script)

        def route_request(route):
            request = route.request
            parsed = urlparse(request.url)
            if request.resource_type == "document" and request.url.split("#", 1)[0] == document_url.split("#", 1)[0]:
                route.fulfill(status=200, content_type="text/html; charset=utf-8", body=document)
                return
            if parsed.scheme not in {"http", "https", "data", "blob", "about"}:
                route.abort()
                return
            if request.resource_type in {"image", "font", "media", "manifest", "websocket"}:
                route.abort()
                return
            route.continue_()

        def record_request(request):
            if request.resource_type not in {"script", "xhr", "fetch", "document"}:
                return
            target = after_requests if phase["value"] == "after" else before_requests
            target.append({"url": request.url, "resource_type": request.resource_type})

        browser_page.route("**/*", route_request)
        browser_page.on("request", record_request)
        browser_page.goto(document_url, wait_until="domcontentloaded", timeout=30_000)
        try:
            browser_page.wait_for_load_state("networkidle", timeout=3_000)
        except PlaywrightTimeoutError:
            pass
        browser_page.wait_for_timeout(1_000)
        before_context_cookies = _safe_cookie_names(context.cookies())
        before_document_cookies = _extract_document_cookie_names(browser_page.evaluate("() => document.cookie"))

        phase["value"] = "after"
        consent_action = _click_consent_button(browser_page)
        if consent_action["clicked"]:
            try:
                browser_page.wait_for_load_state("networkidle", timeout=3_000)
            except PlaywrightTimeoutError:
                pass
            browser_page.wait_for_timeout(1_000)

        after_context_cookies = _safe_cookie_names(context.cookies())
        after_document_cookies = _extract_document_cookie_names(browser_page.evaluate("() => document.cookie"))
        context.close()
        browser.close()

    before_cookie_names = sorted(set(before_context_cookies + before_document_cookies))
    after_cookie_names = sorted(set(after_context_cookies + after_document_cookies))
    new_cookie_names = sorted(set(after_cookie_names) - set(before_cookie_names))
    before_summary = _summarize_requests(before_requests)
    after_summary = _summarize_requests(after_requests)
    new_tracking_providers = sorted(set(after_summary["tracking_providers"]) - set(before_summary["tracking_providers"]))

    return {
        "runtime_audit": "completed",
        "audited_at": datetime.now(timezone.utc).isoformat(),
        "source": "stored_html_live_scripts",
        "before_consent": {
            "cookies": before_cookie_names,
            "requests": before_summary,
        },
        "after_consent": {
            "attempted": consent_action["clicked"],
            "action_label": consent_action["label"],
            "cookies": after_cookie_names,
            "new_cookies": new_cookie_names,
            "requests": after_summary,
            "new_tracking_providers": new_tracking_providers,
        },
        "consent_action": consent_action,
        "values_exposed": False,
        "persona_state": {
            **(state.get("summary") or {}),
            "applied": bool(state),
            "values_exposed": False,
        },
        "explanation": (
            "Browser-аудит выполнен по сохранённому HTML страницы с live scripts. "
            "Показаны только имена cookies, типы запросов и распознанные providers; значения cookies/tokens не возвращаются. "
            "Если кнопка согласия не найдена, состояние после согласия не подтверждается."
        ),
    }
