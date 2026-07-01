import hashlib
import json
import os
import shutil
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

from bs4 import BeautifulSoup
from playwright.sync_api import sync_playwright

from app.db.models.page import Page


SNAPSHOT_FORMAT = "jpeg"
SNAPSHOT_VERSION = 2
MAX_RENDER_HEIGHT = 30_000
MAX_ELEMENT_MAP_ITEMS = 1_500


@dataclass
class RenderedSnapshotArtifact:
    image_bytes: bytes
    metadata: dict


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


def _element_map_script(max_items: int, max_height: int) -> str:
    return f"""() => {{
        const maxItems = {max_items};
        const maxHeight = {max_height};
        const textLimit = 500;
        const htmlLimit = 5000;

        function cssEscape(value) {{
            if (window.CSS && typeof window.CSS.escape === "function") {{
                return window.CSS.escape(value);
            }}
            return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\\\$&");
        }}

        function selectorFor(element) {{
            if (!element || element.nodeType !== Node.ELEMENT_NODE) return "";
            if (element.id) return `${{element.tagName.toLowerCase()}}#${{cssEscape(element.id)}}`;
            const parts = [];
            let current = element;
            while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.body) {{
                let part = current.tagName.toLowerCase();
                const className = typeof current.className === "string" ? current.className.trim() : "";
                const firstClass = className.split(/\\s+/).filter(Boolean)[0];
                if (firstClass) part += `.${{cssEscape(firstClass)}}`;
                const parent = current.parentElement;
                if (parent) {{
                    const siblings = Array.from(parent.children).filter((node) => node.tagName === current.tagName);
                    if (siblings.length > 1) part += `:nth-of-type(${{siblings.indexOf(current) + 1}})`;
                }}
                parts.unshift(part);
                current = parent;
                if (parts.length >= 5) break;
            }}
            return parts.join(" > ");
        }}

        const candidates = Array.from(document.body?.querySelectorAll("*") || []);
        const items = [];
        let eligibleTotal = 0;
        for (const element of candidates) {{
            const rect = element.getBoundingClientRect();
            const width = Math.round(rect.width);
            const height = Math.round(rect.height);
            const x = Math.round(rect.left + window.scrollX);
            const y = Math.round(rect.top + window.scrollY);
            if (width < 4 || height < 4 || x < 0 || y < 0 || y > maxHeight) continue;
            const style = window.getComputedStyle(element);
            if (
                style.display === "none" ||
                style.visibility === "hidden" ||
                Number(style.opacity || 1) === 0
            ) continue;
            eligibleTotal += 1;
            if (items.length >= maxItems) continue;
            const outerHTML = element.outerHTML || "";
            const text = (element.innerText || element.textContent || "").replace(/\\s+/g, " ").trim();
            items.push({{
                tag: element.tagName.toLowerCase(),
                id: element.id || "",
                className: typeof element.className === "string" ? element.className.trim() : "",
                selector: selectorFor(element),
                text: text.slice(0, textLimit),
                outerHTML: outerHTML.length > htmlLimit ? `${{outerHTML.slice(0, htmlLimit)}}…` : outerHTML,
                rect: {{ x, y, width, height }},
            }});
        }}
        return {{
            version: 1,
            items_total: eligibleTotal,
            items_truncated: eligibleTotal > maxItems,
            coordinate_space: "rendered_snapshot_pixels",
            items,
        }};
    }}"""


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


def write_rendered_snapshot_artifact(page: Page, artifact: RenderedSnapshotArtifact) -> dict:
    image_path, metadata_path = _artifact_paths(page)
    image_path.parent.mkdir(parents=True, exist_ok=True)
    image_path.write_bytes(artifact.image_bytes)
    metadata_path.write_text(json.dumps(artifact.metadata, ensure_ascii=False), encoding="utf-8")
    return get_rendered_snapshot_metadata(page)


def delete_rendered_snapshot_artifacts_for_run(run_id: int) -> None:
    directory = snapshot_root() / str(run_id)
    if not directory.exists():
        return
    shutil.rmtree(directory, ignore_errors=True)


def capture_live_browser_page_snapshot(browser_page, *, capture_source: str = "browser_persona_run") -> RenderedSnapshotArtifact:
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
    element_map = browser_page.evaluate(_element_map_script(MAX_ELEMENT_MAP_ITEMS, captured_height))
    image_bytes = browser_page.screenshot(
        type=SNAPSHOT_FORMAT,
        quality=78,
        full_page=not clipped,
        clip=None if not clipped else {"x": 0, "y": 0, "width": min(width, 1440), "height": captured_height},
    )
    metadata = {
        "capture_source": capture_source,
        "captured_at": datetime.now(timezone.utc).isoformat(),
        "width": width,
        "height": captured_height,
        "full_height": full_height,
        "clipped": clipped,
        "mime_type": "image/jpeg",
        "element_map": element_map,
        "explanation": (
            "Снимок сохранён во время browser-прогона этой страницы. Он отражает фактический viewport, "
            "стили, изображения и сессию выбранного контекста на момент обхода."
        ),
    }
    return RenderedSnapshotArtifact(image_bytes=image_bytes, metadata=metadata)


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
        artifact = capture_live_browser_page_snapshot(browser_page, capture_source="stored_html_live_assets")
        image_path.write_bytes(artifact.image_bytes)
        context.close()
        browser.close()

    metadata = {
        **artifact.metadata,
        "explanation": (
            "Снимок построен из HTML этого прогона. Scripts и формы отключены; CSS, изображения "
            "и шрифты загружены с сайта в момент создания и могли измениться после прогона."
        ),
    }
    metadata_path.write_text(json.dumps(metadata, ensure_ascii=False), encoding="utf-8")
    return get_rendered_snapshot_metadata(page)
