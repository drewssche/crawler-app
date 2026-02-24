# DEAD CODE / INFRA CLEANUP DISCOVERY 2026-02-24

## Scope
- `backend/app/api/compare.py`
- `backend/app/api/pages.py`
- `tools/*`
- `monitoring/*`
- `docker-compose.yml`

## Findings

### 1) Empty API modules (remove when ACL allows)
- `backend/app/api/compare.py` (0 bytes)
- `backend/app/api/pages.py` (0 bytes)

Evidence:
- Files are empty.
- Not imported in `backend/app/main.py` routers.
- No references found in backend code search.

Decision: `REMOVE` (manual cleanup queue remains due ACL lock).

### 2) One-off migration scripts in tools (stale path, non-reusable)
- `tools/fix_userspage.py`
- `tools/fix_userspage_regex.py`

Evidence:
- Hardcoded legacy path: `d:\python\crawler-app\frontend\src\pages\UsersPage.tsx`.
- Contain one-time mojibake-replacement logic.
- Not referenced by docs/CI/runtime.

Decision: `ARCHIVE/REMOVE` (safe candidate after confirmation).

### 3) Operational guard scripts (keep)
- `tools/check_utf8.py`
- `tools/check_rbac_parity.py`

Evidence:
- Explicitly referenced in `PATTERNS.md` and `TODO.md`.
- Used as active quality gates.

Decision: `KEEP`.

### 4) Monitoring infra files (keep)
- `monitoring/prometheus.yml`

Evidence:
- Mounted by `docker-compose.yml` in `prometheus` service (`--profile monitoring`).

Decision: `KEEP`.

### 5) Docker compose path hygiene
- `docker-compose.yml` references project-relative mounts only.
- No stale absolute legacy project paths found in compose.

Decision: `KEEP` (no cleanup needed).

## Prioritized cleanup execution queue
1. `HIGH`: physically delete `backend/app/api/compare.py`, `backend/app/api/pages.py` (after ACL unblock; already tracked).
2. `MEDIUM`: remove or archive `tools/fix_userspage.py`, `tools/fix_userspage_regex.py`.
3. `LOW`: optional docs regrouping for audit artifacts after functional cleanup.
