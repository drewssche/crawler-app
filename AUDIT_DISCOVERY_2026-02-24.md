# AUDIT DISCOVERY 2026-02-24

## Scope
- System-wide discovery for backend/frontend structure.
- Reuse inventory validation against `REUSE_INDEX.md`.
- RBAC consistency review and extraction into dedicated map.
- Cleanup blockers and dead-surface candidates.

## Current blockers
- File deletion blocked by OS ACL/lock semantics:
  - `backend/app/api/compare.py` (0 bytes)
  - `backend/app/api/pages.py` (0 bytes)
- Even after ACL grant on folder/git, direct delete still returns Access denied in this session.
- Manual queue is tracked in `MANUAL_CLEANUP.md`.

## Structure snapshot
- Top-level dirs: `backend`, `frontend`, `monitoring`, `tools`.
- Code files count:
  - Python: 73
  - TypeScript/TSX: 84
- Largest hotspots (by lines):
  - `backend/app/api/admin.py` (1584)
  - `frontend/src/pages/ActivityLogPage.tsx` (830)
  - `frontend/src/components/layout/SidebarRight.tsx` (812)
  - `frontend/src/pages/MonitoringPage.tsx` (658)
  - `frontend/src/pages/UsersPage.tsx` (657)
  - `frontend/src/pages/RootAdminsPage.tsx` (611)

## Findings

### HIGH
1. Monolithic admin API surface
- Evidence: `backend/app/api/admin.py` contains schema, query-builders, serializers, business handlers, exports, settings API.
- Risk: high regression probability for unrelated changes, low reviewability.
- Action: continue split-plan:
  - phase 2: query-builders -> `app/services/admin_queries.py`
  - phase 3: action handlers -> `app/services/admin_actions.py`
  - phase 4: monitoring/settings handlers -> dedicated service module.

2. Encoding drift exists beyond TODO
- Evidence: mojibake literals found in runtime-visible strings:
  - `backend/app/main.py` (`METRIC_DESCRIPTIONS`)
  - `frontend/src/App.tsx` route fallback text
- Risk: operator UX degradation + hidden text regressions.
- Action: add encoding gate (pre-commit/check script) and normalize files to UTF-8.

### MEDIUM
1. Role/permission logic duplicated in backend and frontend
- Evidence:
  - Backend source of truth: `backend/app/core/permissions.py`
  - Frontend mirror: `frontend/src/utils/permissions.ts`
- Risk: policy drift when adding/changing permissions.
- Action: document strict sync contract (done in `RBAC_MAP.md`) and add parity test/check.

2. Dead API surface candidates
- Evidence: empty files `backend/app/api/compare.py`, `backend/app/api/pages.py`.
- Risk: confusion and wrong assumptions during onboarding.
- Action: remove after manual ACL unblock and confirm no imports/references.

3. Large page components still carry mixed responsibilities
- Evidence: `UsersPage`, `RootAdminsPage`, `MonitoringPage`, `ActivityLogPage` remain 600-800 LOC each.
- Action: extract domain sections into page-local modules without behavior changes.

### LOW
1. Path hygiene
- No stale hardcoded project paths found in checked infra/docs:
  - `docker-compose.yml`, `backend/Dockerfile`, `frontend/Dockerfile`, `README.md`, `PATTERNS.md`, `REUSE_INDEX.md`, `TODO.md`.

## Prioritized backlog (new wave)

### HIGH
1. Continue admin split-plan phase 2-4 (`admin_queries`, `admin_actions`, monitoring/settings service split).
2. Encoding normalization wave for runtime text files + UTF-8 guard check.
3. Finalize dead API cleanup (`compare.py`, `pages.py`) right after ACL unblock.

### MEDIUM
1. Add RBAC parity check between backend permission matrix and frontend mirror.
2. Decompose frontend heavy pages into bounded sections (no-regression only).
3. DB/index workload audit based on real query paths from admin/events (completed; migration `d4f8a1c9b2e7` applied in dev env, see `AUDIT_DB_INDEX_2026-02-24.md`).

### LOW
1. Optional tree simplification pass (`tools/`, docs grouping) after medium items.

## Suggested execution order
1. Finish cleanup blocker (manual delete two files).
2. Admin split-plan phase 2 (queries extraction) with compile/tests.
3. Encoding wave for runtime-visible text.
4. RBAC parity automation.
5. Frontend bounded decomposition.


## Reuse consolidation candidates (merge-first, future)
- Status update: reason/login-code helpers consolidated into existing `admin_actions`; `_estimate_jwt_expiry` kept local as single-use (deferred until reuse appears).
- Status update: trusted-devices path consolidated into existing `admin_queries` + `admin_serializers`; router-level helper reduced to thin orchestration wrapper.
- Status update: query/snapshot consolidation moved to existing modules (`admin_queries`, `admin_serializers`) without introducing new module types.
1. `backend/app/api/admin.py` -> `admin_queries`
- Done: moved query helpers (`build_last_login_map`, `build_trust_summary_map`) to `backend/app/services/admin_queries.py` and wired admin-email/user-list paths to shared query source.
- Expected impact: lower `admin.py` size and single query layer.

2. `backend/app/api/admin.py` -> `admin_actions`
- Done: moved `_require_reason` and `send_login_code_for_user` into existing `admin_actions`; route handlers now call service functions directly.
- Expected impact: thinner route layer and clearer service boundaries.

3. Export row mapping consolidation
- Done: login/audit CSV/XLSX row mapping moved to shared serializer iterators (`iter_login_history_export_rows`, `iter_audit_export_rows`) and connected in admin export routes.
- Impact: removed duplicated inline formatter generators from route layer.

4. Monitoring logic boundary check
- Candidate: keep `admin_monitoring.py` as single monitoring payload source and avoid reintroducing Prometheus/cache logic in routers.
- Expected impact: prevents service drift and duplicate monitoring code paths.






- Update: staging-like EXPLAIN validation completed (dev data scale-up), see `AUDIT_DB_INDEX_2026-02-24.md` for plans and keep/tune decisions.

- Update: trusted-devices index path tuned via migration `e7c2d5a1f4b9`; residual `top-N sort` removed on staging-like EXPLAIN.


- Update: dead code/infra discovery completed, see AUDIT_DEAD_CODE_2026-02-24.md (empty API modules + one-off tools classification).

- Update: manual cleanup execution delegated to user (MANUAL_CLEANUP.md), agent keeps queue/report in sync and skips physical deletion.


- Update: `admin.py` user-details query path consolidated to `admin_queries` loaders (login/audit), reducing router-level SQL duplication.


- Update: list_users/admin-emails enrichment paths consolidated to shared admin_queries loaders (latest request-access per email, latest pending access event per user, users-by-email map).
- Update: trusted-devices revoke-except path now also uses shared admin_queries loader (active devices list), reducing remaining inline query duplication in admin.py.
- Update: user-details anomaly counters (`invalid_code_24h`, latest-ip novelty) moved to shared admin_queries helper layer, further reducing router-level inline SQL/count paths.
- Update: user-details response mapping (login_history/admin_actions/anomalies) moved to shared admin_serializers helpers; admin route layer remains orchestration-only.