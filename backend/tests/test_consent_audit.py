from app.crawler.consent_audit import _runtime_audit_document, run_consent_audit
from app.db.models.page import Page
from app.services.persona_browser_state import build_browser_persona_state


def test_runtime_audit_document_keeps_scripts_but_removes_active_forms():
    page = Page(
        id=11,
        run_id=5,
        url="https://consent.test/",
        final_url="https://consent.test/",
        status_code=200,
        content_type="text/html",
        html_hash="consent",
        html="""
        <html><head><script>document.cookie = "before_cookie=1";</script></head>
        <body><form action="/pay"><input name="card"></form></body></html>
        """,
    )

    document = _runtime_audit_document(page)

    assert "<script>" in document
    assert "<form" not in document
    assert '<base href="https://consent.test/"' in document


def test_run_consent_audit_reports_cookie_changes_without_values():
    page = Page(
        id=12,
        run_id=5,
        url="https://consent.test/",
        final_url="https://consent.test/",
        status_code=200,
        content_type="text/html",
        html_hash="consent",
        html="""
        <html><body>
          <script>document.cookie = "before_cookie=secret";</script>
          <button id="accept" onclick='document.cookie = "after_cookie=secret"; fetch("/after-consent")'>Accept all</button>
        </body></html>
        """,
    )

    result = run_consent_audit(page)

    assert result["runtime_audit"] == "completed"
    assert result["values_exposed"] is False
    assert "before_cookie" in result["before_consent"]["cookies"]
    assert "after_cookie" in result["after_consent"]["new_cookies"]
    assert "secret" not in str(result)
    assert result["after_consent"]["attempted"] is True


def test_build_browser_persona_state_masks_values_and_maps_storage():
    state = build_browser_persona_state(
        {
            "cookies": [{"name": "sid", "value": "secret-cookie", "domain": "consent.test", "path": "/"}],
            "headers": {"X-Role": "partner", "Cookie": "blocked"},
            "localStorage": {"role": "secret-role"},
            "sessionStorage": [{"name": "tab", "value": "secret-tab"}],
        },
        document_url="https://consent.test/path",
    )

    assert state["summary"] == {
        "cookies_count": 1,
        "headers_count": 1,
        "local_storage_count": 1,
        "session_storage_count": 1,
        "values_exposed": False,
    }
    assert state["storage_state"]["origins"][0]["origin"] == "https://consent.test"
    assert state["extra_http_headers"] == {"X-Role": "partner"}


def test_run_consent_audit_applies_persona_browser_state_without_exposing_values():
    page = Page(
        id=13,
        run_id=5,
        url="https://consent.test/",
        final_url="https://consent.test/",
        status_code=200,
        content_type="text/html",
        html_hash="consent",
        html="""
        <html><body>
          <script>
            if (localStorage.getItem("role") === "secret-role") document.cookie = "local_seen=1";
            if (sessionStorage.getItem("tab") === "secret-tab") document.cookie = "session_seen=1";
          </script>
        </body></html>
        """,
    )
    state = build_browser_persona_state(
        {
            "localStorage": {"role": "secret-role"},
            "sessionStorage": {"tab": "secret-tab"},
        },
        document_url="https://consent.test/",
    )

    result = run_consent_audit(page, persona_browser_state=state)

    assert result["persona_state"]["applied"] is True
    assert result["persona_state"]["local_storage_count"] == 1
    assert result["persona_state"]["session_storage_count"] == 1
    assert "local_seen" in result["before_consent"]["cookies"]
    assert "session_seen" in result["before_consent"]["cookies"]
    assert "secret-role" not in str(result)
    assert "secret-tab" not in str(result)
