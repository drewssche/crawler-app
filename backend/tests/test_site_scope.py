import pytest

from app.core.site_scope import canonicalize_site_scope, is_url_in_site_scope


def test_whole_site_scope_normalizes_origin_and_accepts_any_same_origin_path():
    scope = canonicalize_site_scope(
        "HTTPS://Example.COM:443/docs/?preview=1#top",
        scope_mode="whole_site",
    )

    assert scope.start_url == "https://example.com/docs"
    assert scope.canonical_origin == "https://example.com"
    assert scope.path_prefix == "/"
    assert is_url_in_site_scope("https://example.com/other/page?x=1", scope)
    assert not is_url_in_site_scope("http://example.com/other/page", scope)
    assert not is_url_in_site_scope("https://www.example.com/other/page", scope)


def test_path_prefix_scope_uses_segment_boundary_and_blocks_other_origins():
    scope = canonicalize_site_scope(
        "https://example.com",
        scope_mode="path_prefix",
        path_prefix="/docs",
    )

    assert scope.start_url == "https://example.com/docs"
    assert scope.path_prefix == "/docs/"
    assert is_url_in_site_scope("https://example.com/docs", scope)
    assert is_url_in_site_scope("https://example.com/docs/guide/", scope)
    assert not is_url_in_site_scope("https://example.com/docs-old/", scope)
    assert not is_url_in_site_scope("https://example.com/docs/%2e%2e/admin", scope)
    assert not is_url_in_site_scope("https://example.com/", scope)
    assert not is_url_in_site_scope("https://other.example.com/docs/", scope)


def test_path_prefix_scope_rejects_start_url_outside_selected_section():
    with pytest.raises(ValueError, match="inside the selected path prefix"):
        canonicalize_site_scope(
            "https://example.com/blog",
            scope_mode="path_prefix",
            path_prefix="/docs",
        )
