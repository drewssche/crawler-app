from app.crawler.consent_audit import _runtime_audit_document, run_consent_audit
from app.db.models.page import Page


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
