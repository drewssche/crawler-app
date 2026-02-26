# DB/Index Audit 2026-02-24

## Scope
- Query workload review:
  - `backend/app/api/admin.py`
  - `backend/app/services/admin_queries.py`
  - `backend/app/api/events.py`
- Schema/index review:
  - `backend/app/db/models/*`
  - `backend/alembic/versions/*`
- Runtime DB snapshot:
  - `pg_indexes`, `pg_stat_user_tables` from `crawler_db`.

## Workload profile (hot paths)

1. Events feed/center
- Filters: `channel`, optional `severity in (warning,danger)`.
- State filters through `LEFT JOIN event_user_state` by `(event_id,user_id)` + unread/dismissed flags.
- Sort/pagination: `ORDER BY event_feed.created_at DESC, event_feed.id DESC`.
- Files: `backend/app/api/events.py`.

2. Login history (admin)
- Filters: `user_id`, optional `result/source/date range`; optional `%...%` by `email/ip`.
- Sort/pagination: `ORDER BY created_at DESC, id DESC`.
- User details: latest by `user_id`, plus `user_id + ip` lookup.
- Files: `backend/app/services/admin_queries.py`, `backend/app/api/admin.py`.

3. Admin audit logs
- Filters: `action/date range`, optional actor/target email search (via joined users, `%...%`).
- Sort/pagination: `ORDER BY created_at DESC, id DESC`.
- User details: target-specific recent actions.
- Files: `backend/app/services/admin_queries.py`, `backend/app/api/admin.py`.

4. Trusted devices
- Filters: `user_id`, `revoked_at IS NULL`.
- Sort: `last_used_at DESC, created_at DESC, id DESC` (bulk revoke except latest).
- Files: `backend/app/api/admin.py`, `backend/app/services/admin_queries.py`.

## Current index snapshot (runtime DB)
- Existing composite indexes:
  - `ix_event_user_state_user_read_event` on `(user_id, is_read, event_id)`
  - `ix_event_feed_channel_severity_created_id` on `(channel, severity, created_at, id)`
- Most other indexes are single-column (`created_at`, `user_id`, `action`, etc.).

Runtime table sizes now (`pg_stat_user_tables.n_live_tup`):
- `users`: 7
- `login_history`: 34
- `admin_audit_logs`: 47
- `auth_attempts`: 74
- `event_feed`: 79
- `event_user_state`: 159
- `trusted_devices`: 14

Conclusion for current env: no immediate performance pressure by cardinality.

## Findings and candidates

### MEDIUM-1 (recommended first)
Add composite index for frequent per-user login timeline reads.
- Candidate:
  - `login_history(user_id, created_at DESC, id DESC)`
- Why:
  - Covers repeated pattern in user details and admin queries with sort-by-time.
- Paths:
  - `load_recent_login_history_for_user`
  - user details latest login paths.

### MEDIUM-2
Add composite index for trusted device "active latest" path.
- Candidate:
  - `trusted_devices(user_id, revoked_at, last_used_at DESC, created_at DESC, id DESC)`
- Why:
  - Aligns with revoke-all-except-latest and active-device sort path.

### MEDIUM-3
Add composite index for user-targeted audit timeline.
- Candidate:
  - `admin_audit_logs(target_user_id, created_at DESC, id DESC)`
- Why:
  - Directly supports user-details audit pane sorted by recency.

### LOW-1
Optional index for status-heavy users listing.
- Candidate:
  - `users(is_deleted, is_approved, id)`
- Why:
  - Helps list filters (`pending/approved/deleted`) with stable id ordering.
- Note:
  - Evaluate after user table reaches meaningful size.

### LOW-2
Optional event feed index for channel-only recency.
- Candidate:
  - `event_feed(channel, created_at DESC, id DESC)`
- Why:
  - Existing composite starts with `(channel, severity, ...)`; channel-only queries may not fully benefit from trailing sort keys.
- Note:
  - Measure with `EXPLAIN` under larger dataset before adding.

### Deferred / not recommended now
- Trigram/GIN for `%...%` searches (`ilike '%text%'`) on email/ip/action.
- Reason:
  - More write overhead and extension complexity; current cardinalities are small.

## Proposed migration wave (when scaling)
1. Add 3 medium candidates (`login_history`, `trusted_devices`, `admin_audit_logs`).
2. Collect `EXPLAIN (ANALYZE, BUFFERS)` for:
   - `/admin/users/{id}` details,
   - `/admin/login-history`,
   - `/events/feed`, `/events/center`.
3. Re-check write overhead and index bloat after 1-2 days.

## Validation checklist
- Apply migration in staging.
- Compare query plans before/after on representative data.
- Ensure no regression in existing backend tests.

## Execution update (2026-02-24)

Applied migration:
- `backend/alembic/versions/d4f8a1c9b2e7_add_composite_indexes_for_admin_workload_hot_paths.py`
- Alembic current: `d4f8a1c9b2e7 (head)`
- Added indexes:
  - `ix_login_history_user_created_id`
  - `ix_trusted_devices_user_revoked_last_used_created_id`
  - `ix_admin_audit_logs_target_created_id`

EXPLAIN snapshots (current tiny dataset):
- `login_history` hot path: planner chose `Seq Scan` + `Sort` (table has ~34 rows).
- `trusted_devices` hot path: planner chose `Seq Scan` + `Sort` (table has ~14 rows).
- `admin_audit_logs` hot path: planner chose `Seq Scan` + `Sort` (table has ~47 rows).

Interpretation:
- This is expected at current cardinalities.
- Index usefulness should be validated again on staging-sized dataset where planner thresholds are crossed.

Regression check after migration:
- `docker compose run --rm backend sh -lc "PYTHONPATH=/app pytest -q tests/test_permissions.py tests/test_admin_bulk.py tests/test_api_integration.py"`
- Result: `19 passed, 2 skipped`.

## Staging-like validation update (2026-02-24)

Data scale-up executed in dev DB:
- `login_history`: ~150k rows
- `admin_audit_logs`: ~150k rows
- `trusted_devices`: ~120k rows

Representative EXPLAIN (`user_id/target_user_id = 4`):
1. `login_history` hot path (`WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 20`)
- Plan: `Index Only Scan Backward using ix_login_history_user_created_id`
- Result: index plan confirmed, no seq scan.

2. `admin_audit_logs` hot path (`WHERE target_user_id = ? ORDER BY created_at DESC, id DESC LIMIT 20`)
- Plan: `Index Scan Backward using ix_admin_audit_logs_target_created_id`
- Result: index plan confirmed, no seq scan.

3. `trusted_devices` hot path (`WHERE user_id = ? AND revoked_at IS NULL ORDER BY last_used_at DESC, created_at DESC, id DESC LIMIT 20`)
- Plan: `Index Only Scan using ix_trusted_devices_user_revoked_last_used_created_id` + `top-N sort`
- Result: index filter path is used, but final sort remains.

Decision:
- Keep MEDIUM-1 and MEDIUM-3 indexes as validated improvements.
- Keep MEDIUM-2 index, but add follow-up tuning candidate:
  - evaluate `DESC`/`NULLS` alignment and/or partial index variant for active devices.

Regression after scale-up + migration:
- `19 passed, 2 skipped` on backend target suite.


## Trusted-devices tuning update (2026-02-24)

Applied migration:
- `backend/alembic/versions/e7c2d5a1f4b9_tune_trusted_devices_active_order_index.py`
- Replaced broad mixed-order index with partial ordered index:
  - `ix_td_active_user_lu_ca_id_desc` on `(user_id, last_used_at DESC, created_at DESC, id DESC) WHERE revoked_at IS NULL`

EXPLAIN after tuning:
- `trusted_devices` hot path now uses `Index Only Scan using ix_td_active_user_lu_ca_id_desc`
- `top-N sort` removed.

Validation:
- Alembic current: `e7c2d5a1f4b9 (head)`
- Backend regression subset: `19 passed, 2 skipped`.
