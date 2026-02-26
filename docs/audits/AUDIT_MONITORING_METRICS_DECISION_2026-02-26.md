# Monitoring Metrics Decision 2026-02-26

Цель: зафиксировать решение по спорным monitoring-счетчикам после cleanup-wave.

## Scope

- `backend/app/api/auth.py`
- `backend/app/api/admin.py`
- `backend/app/api/events.py`
- `backend/app/main.py`
- `backend/app/services/admin_actions.py`
- `backend/app/services/admin_monitoring.py`
- `frontend/src/pages/MonitoringPage.tsx`

## Remove (done)

1. `auth_start_total`
2. `auth_verify_total`
3. `auth_request_access_total`
4. `admin_action_total`
5. `admin_bulk_total`
6. Monitoring history series:
   - `auth_starts`
   - `admin_actions`

Причина:
- графики по этим series уже выпилены из default monitoring view;
- дублирующая ценность относительно `*_result_total` и доменных event/audit потоков;
- снижение шума в `/metrics` и в таблице мониторинга.

## Keep (explicit decision)

1. `events_center_total`
2. `events_feed_total`
3. `events_read_total`
4. `events_dismiss_total`
5. `admin_bulk_result_total`
6. `auth_start_result_total`
7. `auth_verify_result_total`
8. `auth_request_access_result_total`
9. `monitoring_anomaly_total`

Причина:
- это операционные counters и outcome-метрики, полезные для диагностики multi-user сценариев;
- `auth_verify_result_total` используется для `invalid_code` в anomaly-flow;
- `admin_bulk_result_total` даёт итоговое качество bulk-операций (`changed=true/false`).

## Validation

1. Backend integration tests:
- `test_settings_summary_endpoint_returns_domains`
- `test_settings_summary_monitoring_state_uses_history_thresholds`

2. Frontend build:
- `cd frontend && npm run build`

Результат:
- backend tests: passed
- frontend build: passed

## Follow-up

- Если понадобится дальнейшая чистка `events_*`, сначала собрать отдельную карту usage в alerting/ops и только затем принимать решение.
