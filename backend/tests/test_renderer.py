from pathlib import Path

from app.crawler.renderer import _element_map_script, _safe_render_document, get_rendered_snapshot_metadata
from app.db.models.page import Page


def test_safe_render_document_blocks_active_content_and_keeps_assets():
    page = Page(
        id=7,
        run_id=3,
        url="https://example.test/catalog/",
        final_url="https://example.test/catalog/",
        status_code=200,
        content_type="text/html",
        html_hash="abc",
        html="""
        <html><head>
          <link rel="stylesheet" href="/app.css">
          <script src="/danger.js"></script>
        </head><body>
          <form action="/submit"><input></form>
          <img src="/hero.jpg">
        </body></html>
        """,
    )

    document = _safe_render_document(page)

    assert '<base href="https://example.test/catalog/"' in document
    assert 'href="/app.css"' in document
    assert 'src="/hero.jpg"' in document
    assert "<script" not in document
    assert "<form" not in document


def test_missing_rendered_snapshot_metadata_is_explainable(monkeypatch, tmp_path: Path):
    monkeypatch.setenv("RENDERED_SNAPSHOT_DIR", str(tmp_path))
    page = Page(
        id=9,
        run_id=4,
        url="https://example.test/",
        status_code=200,
        content_type="text/html",
        html_hash="def",
        html="<html></html>",
    )

    metadata = get_rendered_snapshot_metadata(page)

    assert metadata["available"] is False
    assert metadata["capture_source"] == "stored_html_live_assets"
    assert "CSS" in metadata["explanation"]


def test_rendered_snapshot_element_map_script_keeps_user_friendly_fields():
    script = _element_map_script(max_items=25, max_height=900)

    assert "selectorFor" in script
    assert "outerHTML" in script
    assert "coordinate_space" in script
    assert "rendered_snapshot_pixels" in script
    assert "items_truncated" in script
