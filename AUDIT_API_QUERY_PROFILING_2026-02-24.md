# AUDIT API/QUERY PROFILING HOT PATHS 2026-02-24

## Scope
- Backend: `backend/app/api/admin.py`, `backend/app/api/events.py`, `backend/app/services/admin_queries.py`, `backend/app/main.py`
- Frontend: `frontend/src/pages/UsersPage.tsx`, `frontend/src/pages/EventsPage.tsx`, `frontend/src/pages/ActivityLogPage.tsx`, `frontend/src/pages/MonitoringPage.tsx`, `frontend/src/pages/RootAdminsPage.tsx`, `frontend/src/hooks/useActivityFeed.ts`, `frontend/src/hooks/useIncrementalPager.ts`

## Method
- Static request-path profiling (endpoint -> query shape -> pagination/count/export path).
- Recheck of known optimization waves to detect residual hotspots.
- No behavior changes in this wave.

## Hot Paths (ranked)

### HIGH-1: `/events/center` fan-out read path
Evidence:
- Executes 2 feed fetches + 2 unread count queries per request.
- Each feed fetch includes `count + page query + ensure_event_states` flow.
- GET endpoint commits transaction (`db.commit()`) after read path.

Impact:
- High request cost under frequent polling dashboards.
- Elevated DB load from repeated count operations.

References:
- `backend/app/api/events.py:116`
- `backend/app/api/events.py:46`
- `backend/app/api/events.py:94`

### HIGH-2: `/admin/users` enriched list path
Evidence:
- Main list executes `count + page query`.
- Enrichment adds multiple additional loaders (`last_login`, `trust_summary`, `pending events/state`).
- Effective query fan-out per page remains significant at scale.

Impact:
- Heavy admin screen on large user base and frequent refreshes.

References:
- `backend/app/api/admin.py:191`
- `backend/app/api/admin.py:227`
- `backend/app/api/admin.py:236`

### HIGH-3: audit/login exports still full materialization
Evidence:
- Export endpoints call `query.all()` before serialization.
- Large exports still allocate full result sets in memory.

Impact:
- Memory pressure and timeout risk for big datasets.

References:
- `backend/app/api/admin.py:807`
- `backend/app/api/admin.py:831`
- `backend/app/api/admin.py:872`
- `backend/app/api/admin.py:895`

## Medium Hot Paths

### MEDIUM-1: `/events/feed` double-pass (`count + rows`) under infinite scroll
Evidence:
- Each page request performs count and data fetch.
- Includes join/filter logic with state table per user.

References:
- `backend/app/api/events.py:175`
- `backend/app/api/events.py:73`
- `backend/app/api/events.py:74`

### MEDIUM-2: `/admin/users/{id}/details` duplicated login-history reads
Evidence:
- Reads recent login history for page data and then reads extended history again for trusted-device serialization.
- Additional anomaly counters execute separate count queries.

References:
- `backend/app/api/admin.py:411`
- `backend/app/api/admin.py:422`
- `backend/app/api/admin.py:430`
- `backend/app/api/admin.py:435`

### MEDIUM-3: `/admin/audit` and `/admin/login-history` filter flexibility vs index selectivity
Evidence:
- Leading-wildcard `ilike("%...%")` on filter fields.
- Count query per page is required for current UI contract.

References:
- `backend/app/services/admin_queries.py:33`
- `backend/app/services/admin_queries.py:100`
- `backend/app/api/admin.py:723`
- `backend/app/api/admin.py:763`

## Structural Simplification Map (discovery output)

### Backend
- `events.py`: extract query builders for feed/count into a dedicated service (`events_queries`) to isolate optimization and avoid route-level query drift.
- `admin.py`: keep route layer thin; move remaining per-endpoint orchestration chunks with repeated query patterns into service-level composable loaders.
- Export pipeline: move from eager list serialization to iterator/chunk processing contract in `export_utils` + serializers.

### Frontend
- Keep `useIncrementalPager` as single paging contract.
- Introduce shared "search-to-reset" helper for pages with identical debounce/reset behavior (`UsersPage`, `RootAdminsPage`, `ActivityLogPage`).
- Isolate "export URL builder" from `ActivityLogPage` into reusable helper to prevent filter/param drift.

## Prioritized Backlog (new)

### HIGH
1. `events.center` query cost reduction (merge unread counters and reduce double-pass reads).
2. `admin.users` enrichment cost reduction (batch strategy + cache window for expensive enrichers).
3. Replace export `query.all()` with streaming/chunked export path for audit/login.

### MEDIUM
1. Optimize `events.feed` count strategy for infinite scroll path.
2. Collapse duplicate login-history reads in `user_details` into one loaded dataset + derived views.
3. Add optional fast-filter mode for audit/login lists (prefix/equals-first where possible).

### LOW
1. Frontend utility consolidation for repeated search/reset/export helpers.
2. Optional project-tree regrouping after HIGH/MEDIUM execution.

## Verification Output
- Endpoint/query hotspot map created.
- Structural simplification map created.
- Prioritized HIGH/MEDIUM/LOW backlog created.

## Notes
- This is a discovery/profiling artifact. No runtime behavior changed.
- DB/index migrations from `AUDIT_DB_INDEX_2026-02-24.md` remain valid and complementary.

## Execution Update (2026-02-24)
- Implemented first HIGH backlog item (partial): `/events/center` now skips redundant `count()` calls in internal feed loads.
- Code change: `backend/app/api/events.py` (`_fetch_events_with_state(..., include_total=False)` in center path).
- Regression: `docker compose run --rm backend ... pytest -q tests/test_permissions.py tests/test_admin_bulk.py tests/test_api_integration.py` -> `19 passed, 2 skipped`.
- Implemented second HIGH backlog item (partial): `/admin/users` pending-access enrichment moved to shared `admin_queries.build_pending_access_flags_for_users` with pending-only candidate filtering, reducing unnecessary event/state enrichment work for non-pending rows.
- Implemented third HIGH backlog item: export paths (`/admin/audit`, `/admin/login-history`, csv/xlsx) moved to iterator streaming (`yield_per` + shared serializers) and XLSX write-only mode; removed eager `query.all()` materialization.
- Implemented MEDIUM backlog item (partial): `/events/feed` now supports count-less append pages (`include_total=false` after page 1), reducing repeated `count()` cost for infinite scroll while keeping page contract stable.
- Implemented MEDIUM backlog item: `/admin/users/{id}/details` now uses one login-history load (`limit=200`) with derived slices/views (top-20 + trusted-device hints), removing duplicated read path.
- Implemented MEDIUM backlog item (partial): `/admin/audit` and `/admin/login-history` switched to count-less append pages (`include_total=false` after page 1) for ActivityLog infinite scroll; page-1 total retained for UI counters.
- Implemented MEDIUM backlog item: `/admin/users` switched to count-less append pages (`include_total=false` after page 1) for UsersPage infinite scroll; page-1 total retained for UI counters.
