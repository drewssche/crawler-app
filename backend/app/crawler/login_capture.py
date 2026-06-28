import os
from dataclasses import dataclass

from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
from playwright.sync_api import sync_playwright


class ManagedLoginCaptureUnavailable(RuntimeError):
    pass


@dataclass(frozen=True)
class ManagedLoginCaptureResult:
    storage_state: dict
    final_url: str
    page_title: str


def managed_login_capture_available() -> bool:
    return os.getenv("CRAWL_PERSONA_MANAGED_LOGIN_CAPTURE_ENABLED", "").strip().lower() in {"1", "true", "yes", "on"}


def capture_managed_login_state(login_url: str, *, wait_seconds: int = 0) -> ManagedLoginCaptureResult:
    if not managed_login_capture_available():
        raise ManagedLoginCaptureUnavailable(
            "Managed browser login capture is not enabled. Set CRAWL_PERSONA_MANAGED_LOGIN_CAPTURE_ENABLED=1."
        )

    wait_ms = max(0, min(wait_seconds, 120)) * 1000
    headless = os.getenv("CRAWL_PERSONA_MANAGED_LOGIN_CAPTURE_HEADLESS", "1").strip().lower() not in {
        "0",
        "false",
        "no",
        "off",
    }

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=headless)
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
