# DEAD CODE / INFRA CLEANUP DISCOVERY 2026-02-24

## Scope
- `backend/app/api/compare.py`
- `backend/app/api/pages.py`
- `tools/*`
- `monitoring/*`
- `docker-compose.yml`

## Findings

### 1) Empty API modules
- `backend/app/api/compare.py` (0 bytes, removed 2026-02-26)
- `backend/app/api/pages.py` (0 bytes, removed 2026-02-26)

Evidence:
- Files are empty.
- Not imported in `backend/app/main.py` routers.
- No references found in backend code search.

Decision: `REMOVED` (physically deleted in workspace).

### 2) One-off migration scripts in tools (stale path, non-reusable)
- `tools/fix_userspage.py` (removed 2026-02-26)
- `tools/fix_userspage_regex.py` (removed 2026-02-26)

Evidence:
- Hardcoded legacy path: `d:\python\crawler-app\frontend\src\pages\UsersPage.tsx`.
- Contain one-time mojibake-replacement logic.
- Not referenced by docs/CI/runtime.

Decision: `REMOVED` (safe cleanup executed).

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
- Mounted by `docker-compose.yml` in `prometheus` service (base stack, default `docker compose up`).

Decision: `KEEP`.

### 5) Docker compose path hygiene
- `docker-compose.yml` references project-relative mounts only.
- No stale absolute legacy project paths found in compose.

Decision: `KEEP` (no cleanup needed).

## Prioritized cleanup execution queue
1. `HIGH`: physically delete `backend/app/api/compare.py`, `backend/app/api/pages.py` (completed 2026-02-26).
2. `MEDIUM`: remove or archive `tools/fix_userspage.py`, `tools/fix_userspage_regex.py` (completed 2026-02-26).
3. `LOW`: optional docs regrouping for audit artifacts after functional cleanup.
