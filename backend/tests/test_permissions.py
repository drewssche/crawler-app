from app.core.permissions import has_permission, normalize_role, permissions_matrix_payload


def test_normalize_role_unknown_defaults_to_viewer():
    assert normalize_role("unknown-role") == "viewer"
    assert normalize_role(None) == "viewer"


def test_has_permission_matrix_basics():
    assert has_permission("admin", "users.manage") is True
    assert has_permission("admin", "root_admins.manage") is False
    assert has_permission("root-admin", "root_admins.manage") is True
    assert has_permission("viewer", "events.view") is False


def test_permissions_matrix_payload_contains_expected_roles():
    payload = permissions_matrix_payload()
    roles = [x["role"] for x in payload["roles"]]
    assert roles == ["viewer", "editor", "admin", "root-admin"]

