# RBAC MAP

Single structural map of roles/permissions and enforcement points.

## Source of truth
- Backend permission matrix:
  - `backend/app/core/permissions.py`
- Runtime role resolution:
  - `backend/app/core/security.py` -> `get_user_role()`

## Roles
- `viewer`
- `editor`
- `admin`
- `root-admin`

## Permissions (backend contract)
- `events.view`
- `audit.view`
- `users.manage`
- `root_admins.manage`

Current matrix (`backend/app/core/permissions.py`):
- `viewer`: none
- `editor`: none (domain capabilities may still allow non-admin app usage)
- `admin`: `events.view`, `audit.view`, `users.manage`
- `root-admin`: all above + `root_admins.manage`

## Runtime role derivation
`backend/app/core/security.py:get_user_role(user)` precedence:
1. Email in `ADMIN_EMAILS` env -> `root-admin`
2. `user.role` if present
3. `user.is_admin` -> `admin`
4. fallback -> `viewer`

## Backend enforcement points
- Generic dependency: `require_permission(permission)` in `backend/app/core/security.py`
- Router usage:
  - `backend/app/api/events.py` (`events.view`)
  - `backend/app/api/admin.py` (`users.manage`, `audit.view`, `root_admins.manage`)
  - `backend/app/main.py` metrics endpoints (`audit.view`)

## Frontend enforcement points
- Permission helper mirror:
  - `frontend/src/utils/permissions.ts`
- Route/UI guards:
  - `frontend/src/components/RequirePermission.tsx`
  - `frontend/src/App.tsx` route-level permission wrapping
  - `frontend/src/components/layout/SidebarLeft.tsx` and `frontend/src/pages/SettingsPage.tsx`

## Sync risks
1. Backend and frontend keep separate copies of permission matrix.
2. `editor` has zero admin permissions but may appear as regular app role; ensure intent stays explicit.
3. Runtime root-admin elevation by env email can differ from persisted DB role.

## Anti-drift checklist (required on RBAC changes)
1. Update backend matrix in `backend/app/core/permissions.py`.
2. Update frontend mirror in `frontend/src/utils/permissions.ts`.
3. Verify route guards in `frontend/src/App.tsx` and menu visibility in `SidebarLeft`/`SettingsPage`.
4. Verify `/auth/permissions-matrix` response (`backend/app/api/auth.py`) and `RolePermissionsHint` rendering.
5. Run backend permission tests:
   - `backend/tests/test_permissions.py`
   - RBAC integration scenarios in `backend/tests/test_api_integration.py`.

## Recommended follow-up
- Add CI parity check that compares backend matrix payload with frontend permission constants (fail on mismatch).

