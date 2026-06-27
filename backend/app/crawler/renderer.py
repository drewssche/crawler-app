import hashlib
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

from bs4 import BeautifulSoup
from playwright.sync_api import sync_playwright

from app.db.models.page import Page


SNAPSHOT_FORMAT = "jpeg"
SNAPSHOT_VERSION = 1
MAX_RENDER_HEIGHT = 30_000


def snapshot_root() -> Path:
    return Path(os.getenv("RENDERED_SNAPSHOT_DIR", "/app/data/rendered_snapshots"))


def _artifact_key(page: Page) -> str:
    identity = f"{page.run_id}:{page.id}:{page.html_hash}:{SNAPSHOT_VERSION}"
    return hashlib.sha256(identity.encode("utf-8")).hexdigest()[:24]


def _artifact_paths(page: Page) -> tuple[Path, Path]:
    directory = snapshot_root() / str(page.run_id)
    key = _artifact_key(page)
    return directory / f"{key}.{SNAPSHOT_FORMAT}", directory / f"{key}.json"


def _safe_render_document(page: Page) -> str:
    soup = BeautifulSoup(page.html or "<html><body></body></html>", "lxml")
    for node in soup.select("script, iframe, object, embed, form, meta[http-equiv]"):
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


def get_rendered_snapshot_metadata(page: Page) -> dict:
    image_path, metadata_path = _artifact_paths(page)
    if not image_path.exists() or not metadata_path.exists():
        return {
            "available": False,
            "capture_source": "stored_html_live_assets",
            "explanation": (
                "Визуальная реконструкция ещё не создана. Она строится из сохранённого HTML, "
                "но CSS, изображения и шрифты загружаются в момент создания."
            ),
        }
    try:
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {
            "available": False,
            "capture_source": "stored_html_live_assets",
            "explanation": "Артефакт визуальной реконструкции повреждён и требует повторного создания.",
        }
    return {
        **metadata,
        "available": True,
    }


def rendered_snapshot_file(page: Page) -> Path | None:
    image_path, metadata_path = _artifact_paths(page)
    if not image_path.exists() or not metadata_path.exists():
        return None
    return image_path


def render_page_snapshot(page: Page) -> dict:
    if not page.html:
        raise ValueError("Для страницы не сохранён HTML.")
    image_path, metadata_path = _artifact_paths(page)
    image_path.parent.mkdir(parents=True, exist_ok=True)
    document = _safe_render_document(page)

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        context = browser.new_context(
            viewport={"width": 1440, "height": 1000},
            device_scale_factor=1,
            java_script_enabled=False,
        )
        browser_page = context.new_page()

        def route_request(route):
            request = route.request
            parsed = urlparse(request.url)
            if request.resource_type in {"script", "xhr", "fetch", "websocket", "media", "manifest"}:
                route.abort()
                return
            if parsed.scheme not in {"http", "https", "data", "blob", "about"}:
                route.abort()
                return
            route.continue_()

        browser_page.route("**/*", route_request)
        browser_page.set_content(document, wait_until="domcontentloaded", timeout=30_000)
        try:
            browser_page.wait_for_load_state("networkidle", timeout=8_000)
        except Exception:
            pass
        dimensions = browser_page.evaluate(
            """() => ({
                width: Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth || 0),
                height: Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight || 0)
            })"""
        )
        width = max(320, min(int(dimensions.get("width") or 1440), 4_000))
        full_height = max(200, int(dimensions.get("height") or 1000))
        captured_height = min(full_height, MAX_RENDER_HEIGHT)
        clipped = full_height > captured_height
        browser_page.screenshot(
            path=str(image_path),
            type="jpeg",
            quality=78,
            full_page=not clipped,
            clip=None if not clipped else {"x": 0, "y": 0, "width": min(width, 1440), "height": captured_height},
        )
        context.close()
        browser.close()

    metadata = {
        "capture_source": "stored_html_live_assets",
        "captured_at": datetime.now(timezone.utc).isoformat(),
        "width": width,
        "height": captured_height,
        "full_height": full_height,
        "clipped": clipped,
        "mime_type": "image/jpeg",
        "explanation": (
            "Снимок построен из HTML этого прогона. Scripts и формы отключены; CSS, изображения "
            "и шрифты загружены с сайта в момент создания и могли измениться после прогона."
        ),
    }
    metadata_path.write_text(json.dumps(metadata, ensure_ascii=False), encoding="utf-8")
    return get_rendered_snapshot_metadata(page)
