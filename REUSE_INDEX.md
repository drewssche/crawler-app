# REUSE_INDEX

Точечная карта реюзов и кандидатов на дедупликацию.

## Уже переиспользуется

- `frontend/src/components/ui/Button.tsx`
  Единый паттерн кнопок (`variant`, `size`, hover/active).

- `frontend/src/components/ui/SegmentedControl.tsx`
  Короткие фиксированные переключатели (`all/notification/action`, `asc/desc`, вкладки).

- `frontend/src/components/ui/UiSelect.tsx`
  Единый `select`-паттерн (стиль + стрелка + focus/hover).

- `frontend/src/components/ui/HintCard.tsx`
  Единый визуальный паттерн подсказок (accent-card с заголовком/описанием/контентом).
  Используется в `RolePermissionsHint` и в подсказке порогов `MonitoringPage`.

- `frontend/src/components/ui/HintTable.tsx`
  Единый табличный паттерн для hint-блоков (колонки/строки/align/padding).
  Используется в `RolePermissionsHint` и в подсказке порогов `MonitoringPage`.

- `frontend/src/components/ui/ClearableInput.tsx`
  Поисковые поля с очисткой `×`.

- `frontend/src/components/ui/SelectableListRow.tsx`
  Единая строка списка с чекбоксом/контентом/кнопкой `Открыть` и общими hover/highlight состояниями.
  Подключено в `UsersPage` и `RootAdminsPage` для одинаковой плотности и анимаций строк.

- `frontend/src/App.tsx` (`React.lazy` + `Suspense`)
  Единый route-level code-splitting для тяжелых страниц:
  `UsersPage`, `ActivityLogPage`, `MonitoringPage`, `EventsPage`.

- `frontend/src/components/ui/ContextQuickActions.tsx`
  Унифицированные quick-actions в drawer.

- `frontend/src/components/users/userContextQuickActions.ts`
  Единый builder для auth/security quick-actions
  (`Отозвать сессии`, `Отозвать доверенные устройства`, `Открыть входы по IP`)
  в `EventsPage` и `SidebarRight`.

- `frontend/src/components/ui/EventMetaPills.tsx`
  Единый рендер event-meta бейджей (`канал / уровень / read / handled`) для drawer-контекстов
  (`EventsPage`, `SidebarRight`).

- `frontend/src/components/layout/SidebarRight.tsx` (`areEventListsEqual` + state refs)
  Guard-diff паттерн для polling-обновлений:
  состояние списков `notifications/actions` обновляется только при реальном изменении данных.
  Для компактного режима применяется фиксированное окно `top-20` (без локальной бесконечной догрузки).

- `frontend/src/components/users/UserActionPanel.tsx`
  Единый блок user-действий (`action + reason + presets + dynamic hint + confirm`).

- `frontend/src/components/users/UserStatusPills.tsx`
  Единый рендер статусов пользователя (без инфошума).

- `frontend/src/components/users/UserTrustPills.tsx`
  Единый рендер trust-статуса пользователя (`доверие: ...`) без отдельного time/device слоя в compact UX.

- `frontend/src/components/users/UserBadgeGroups.tsx`
  Единый layout для групп бейджей (`identity -> status -> trust`) с одинаковой структурой рядов в drawer-контекстах.

- `frontend/src/components/users/IdentityBadgeRow.tsx`
  Единый identity-ряд (`роль + Вы + есть в БД/только ADMIN_EMAILS`) для drawer-контекстов
  (`RootAdminsPage`, `UserDetailsDrawer`).
  Для self-маркера использует `RelevanceBadge` (единый стиль бейджа `Вы`).

- `frontend/src/components/users/TrustPolicyDetailsCard.tsx`
  Единый trust-detail блок для drawer-контекстов (`Параметры доверия`: описание + `Код/Срок/Риск`).

- `frontend/src/components/users/TrustPolicyDetailChips.tsx`
  Единый рендер trust-деталей (`Код/Срок/Риск`) с семантикой:
  `Код/Срок/Риск` в trust-палитре из `trustPolicyCatalog`.

- `frontend/src/components/users/userBadgeCatalog.ts`
  Централизованный каталог бейджей (`label + priority + color/bg`) для:
  `RoleBadge`, `RelevanceBadge`, `UserStatusPills`, `UserTrustPills`.
  Дополнительно фиксирует семантический цветовой контракт:
  `identity(roles/relevance)` -> cold-spectrum оттенки с различением уровней роли,
  `status` -> зелёный/красный/нейтральный,
  `time` -> централизованная палитра сроков/состояний устройства.

- `BADGE_INDEX.md`
  Единый реестр всех бейджей (тексты, группы, источники, логика показа).
  Используется как навигационная карта перед изменениями бейджей/подсказок.

- `frontend/src/utils/uiText.ts`
  Единый набор коротких UI-разделителей/текстовых токенов.
  Сейчас: `UI_BULLET = " • "` (применяется в UserDetails/Session/Device строках, чтобы исключить raw-escape и кодировочные артефакты).

- `frontend/src/pages/ActivityLogPage.tsx` (email datalist lazy-suggest)
  Паттерн снижения стартовой нагрузки: вместо preload всех пользователей на маунте
  используется debounced lookup (`q`, top-20) для подсказок email в фильтрах.

- `frontend/src/utils/catalogCache.ts`
  Единый TTL-кэш каталогов (`actions/trust/audit actions`) с in-flight dedupe.
  Используется в `UsersPage`, `EventsPage`, `ActivityLogPage`, `SidebarRight`, `RootAdminsPage`
  для снижения дублей запросов и синхронизации поведения drawer/action-блоков.

- `frontend/src/utils/eventCenterUnreadStore.ts`
  Shared store unread-счетчиков Event Center (`notifications/actions/total`) с подпиской и fallback-fetch.
  `SidebarRight` публикует значения из polling, `SettingsPage` читает/подписывается без отдельного независимого цикла запросов.

- `frontend/src/utils/eventCenterPollingManager.ts`
  Shared singleton transport-manager Event Center:
  `SSE-first` (`/events/center/stream`) + автоматический fallback/reconnect на polling (`/events/center` top-N).
  Один активный транспорт на приложение, подписка из `SidebarRight`, ручной refresh через `refreshEventCenterPollingNow`.

- `frontend/src/utils/settingsStatsCache.ts`
  Shared TTL-кэш статистики `SettingsPage` по доменам:
  `pending users`, `root-admin count`, `audit 24h`, `monitoring state`.
  Снижает повторные вызовы редко меняющихся источников и убирает последовательные wait-цепочки.

- `frontend/src/utils/profileListCache.ts`
  Shared TTL-кэш списка профилей (`/profiles`) для `SidebarLeft`.
  Убирает повторную загрузку на каждый route-change и сохраняет актуальность через короткий TTL/force-обновление.

- `frontend/src/utils/permissionsMatrixCache.ts`
  Shared TTL-кэш матрицы прав (`/auth/permissions-matrix`) для `RolePermissionsHint`.
  Убирает повторные загрузки при повторных маунтах hint-компонента.

- `frontend/src/utils/download.ts`
  Единый download-flow для export-сценариев (`apiDownloadWithProgress + objectURL + revoke`) через
  `downloadBlobFile(path, filename, { onProgress })`.
  Подключен в `MonitoringPage` и `ActivityLogPage` (pending/progress без навигации).

- `frontend/src/utils/exportUrl.ts`
  Единый builder export URL для `ActivityLogPage` (`audit/login`) и `MonitoringPage` (`metrics`) с синхронизацией фильтров.

- `frontend/src/utils/errors.ts`
  Единая нормализация ошибок UI (`normalizeError(error)`), чтобы не дублировать `String(e)`/локальные функции.
  Подключено в `UsersPage`, `EventsPage`, `ActivityLogPage`, `RootAdminsPage`, `MonitoringPage`.

- `frontend/src/hooks/useIncrementalPager.ts`
  Единый hook для page-level пагинации (`load/reset/append + requestNextPage guard + anti-race request-seq + AbortController cancel`).
  Подключен в `EventsPage`, `ActivityLogPage`, `UsersPage`, `RootAdminsPage` (server-side pagination).

- `frontend/src/hooks/useUsersList.ts`
  Доменный loader списка пользователей (`/admin/users`) поверх `useIncrementalPager`:
  `rows + total + hasMore + reset/requestNext` и сохранение selection при reset.
  Подключен в `UsersPage`.

- `frontend/src/hooks/useEventFeed.ts`
  Доменный loader ленты событий (`/events/feed`) поверх `useIncrementalPager`.
  Подключен в `EventsPage`.

- `frontend/src/hooks/useActivityFeed.ts`
  Доменный loader журнала (`/admin/audit`, `/admin/login-history`) поверх `useIncrementalPager`
  с переключением `audit/login`.
  Подключен в `ActivityLogPage`.

- `frontend/src/hooks/useGuardedAsyncState.ts`
  Единый lifecycle для async drawer-context загрузки:
  `requestSeq stale-guard + loading/error state + reset`.
  Подключен в `EventsPage`, `ActivityLogPage`, `SidebarRight`.

- `frontend/src/api/client.ts` (`signal` + `isAbortError`)
  Единый контракт сетевой отмены запросов в UI:
  `apiGet/apiPost/apiDelete/apiDownload` принимают `AbortSignal`, а `isAbortError` используется в страницах
  для silent-cancel без шумных ошибок в UI.

- `frontend/src/hooks/useWorkspaceInfiniteScroll.ts`
  Единый hook автодогрузки по скроллу (`workspace-scroll-container` first + fallback window + short-content prefetch).
  Подключен в `EventsPage`, `ActivityLogPage`, `MonitoringPage`.

- `frontend/src/utils/userContext.ts`
  Единый loader user-context:
  `loadUserContextByEmail/loadUserContextById` (`details + available-actions`).
  Используется в `EventsPage`, `ActivityLogPage`, `SidebarRight`, `UsersPage`.
  Внутри `loadUserContextByEmail` добавлен resolve-cache `email -> userId` (TTL + in-flight dedupe),
  чтобы не повторять `GET /admin/users?status=all&q=...` при частых открытиях контекста.

- `frontend/src/components/users/DeviceSummaryCard.tsx`
  Единый компактный блок по доверенному устройству.

- `frontend/src/components/users/SessionSummaryCard.tsx`
  Единый компактный блок сессии/авторизации.

- `frontend/src/components/users/CompactActionCard.tsx`
  Единый компактный контейнер action-блоков (типографика/отступы/контраст)
  для `UsersPage` и `RootAdminsPage`.

- `frontend/src/components/users/UserListSessionMeta.tsx`
  Единая компактная строка сессии для списков:
  `сессия: <дата> • IP: <ip> • UA: <браузер> (браузер) • <ОС> (ОС) • устройств: <N>`.
  Подключено в `UsersPage` и `RootAdminsPage`.

- `frontend/src/utils/eventTime.ts`
  Единый парсинг/формат времени события:
  `eventTimestampFromMetaOrCreatedAt`, `formatEventMarkerTime`, `formatEventMarkerLocalShort`.

- `frontend/src/utils/datetime.ts`
  Единый контракт отображения времени в operational UI:
  `formatApiDateTime` -> `DD.MM.YYYY, HH:mm:ss (UTC±offset)`,
  `formatApiTime` -> `HH:mm:ss (UTC±offset)`,
  плюс shared helpers для timezone offset.

- `frontend/src/utils/eventLabels.ts`
  Единый mapping сырых event-enum значений в UI-лейблы:
  `eventChannelLabel`, `eventSeverityLabel`, `eventReadStatusLabel`, `eventHandledStatusLabel`.

- `frontend/src/types/catalog.ts`
  Централизованные response-типы каталогов/available-actions:
  `AuditActionCatalogResponse`, `ActionCatalogResponse`, `TrustPolicyCatalogResponse`, `AvailableActionsResponse`.

- `frontend/src/types/common.ts`
  Централизованные lightweight-типы:
  `IdEmail`, `PagedResponse<T>`.


## Каталог реюза по категориям

### UI компоненты
- `frontend/src/components/ui/Button.tsx`, `frontend/src/components/ui/SegmentedControl.tsx`, `frontend/src/components/ui/UiSelect.tsx`, `frontend/src/components/ui/ClearableInput.tsx`
- `frontend/src/components/ui/SelectableListRow.tsx`, `frontend/src/components/ui/EventMetaPills.tsx`, `frontend/src/components/ui/ContextQuickActions.tsx`
- `frontend/src/components/ui/RoleBadge.tsx`, `frontend/src/components/ui/RolePermissionsHint.tsx`

### UI доменные блоки
- `frontend/src/components/users/UserActionPanel.tsx`
- `frontend/src/components/users/UserStatusPills.tsx`, `frontend/src/components/users/UserTrustPills.tsx`, `frontend/src/components/users/UserBadgeGroups.tsx`, `frontend/src/components/users/IdentityBadgeRow.tsx`
- `frontend/src/components/users/TrustPolicyDetailsCard.tsx`, `frontend/src/components/users/TrustPolicyDetailChips.tsx`
- `frontend/src/components/users/SessionSummaryCard.tsx`, `frontend/src/components/users/DeviceSummaryCard.tsx`, `frontend/src/components/users/UserListSessionMeta.tsx`, `frontend/src/components/users/CompactActionCard.tsx`

### Хуки и lifecycle
- `frontend/src/hooks/useIncrementalPager.ts`
- `frontend/src/hooks/useUsersList.ts`, `frontend/src/hooks/useEventFeed.ts`, `frontend/src/hooks/useActivityFeed.ts`
- `frontend/src/hooks/useWorkspaceInfiniteScroll.ts`, `frontend/src/hooks/useGuardedAsyncState.ts`

### Data/cache/transport
- `frontend/src/utils/catalogCache.ts`, `frontend/src/utils/settingsStatsCache.ts`, `frontend/src/utils/profileListCache.ts`, `frontend/src/utils/permissionsMatrixCache.ts`
- `frontend/src/utils/eventCenterUnreadStore.ts`, `frontend/src/utils/eventCenterPollingManager.ts`
- `frontend/src/utils/userContext.ts`, `frontend/src/utils/monitoringContext.ts`

### Сетевые и служебные утилиты
- `frontend/src/api/client.ts` (`signal`, `isAbortError`, `apiDownload`, `apiDownloadWithProgress`)
- `frontend/src/utils/download.ts`, `frontend/src/utils/errors.ts`
- `frontend/src/utils/datetime.ts`, `frontend/src/utils/eventTime.ts`, `frontend/src/utils/eventLabels.ts`, `frontend/src/utils/eventRouting.ts`, `frontend/src/utils/eventPrimaryAction.ts`
- `frontend/src/utils/userAgent.ts`, `frontend/src/utils/uiText.ts`

### Типы и контракты
- `frontend/src/types/catalog.ts`, `frontend/src/types/common.ts`
- `frontend/src/components/users/userBadgeCatalog.ts`, `BADGE_INDEX.md`
## Кандидаты на реюз (аудит)

1. Monitoring drawer context duplicated (закрыто)
- Закрыто реюзом:
  - `frontend/src/components/monitoring/MonitoringContextCard.tsx`
  - `frontend/src/utils/monitoringContext.ts` (`loadMonitoringContext`)
- Зафиксированный анти-регресс:
  - fallback окна истории `60m -> 24h -> 7d`,
  - если `focus_path` дает пустой ряд, повторяем загрузку без `focus_path`.

2. `shortUserAgent` duplicated (закрыто)
- Закрыто реюзом:
  - `frontend/src/utils/userAgent.ts`

3. `formatDateTime` local wrappers duplicated (закрыто)
- Закрыто реюзом `frontend/src/utils/datetime.ts`.
- Подключено напрямую в:
  - `frontend/src/pages/EventsPage.tsx`
  - `frontend/src/components/layout/SidebarRight.tsx`
  - `frontend/src/components/users/UserDetailsDrawer.tsx`
  - `frontend/src/components/users/SessionSummaryCard.tsx`
  - `frontend/src/components/users/DeviceSummaryCard.tsx`

4. Event meta pills duplicated (закрыто)
- Закрыто реюзом:
  - `frontend/src/components/ui/EventMetaPills.tsx`
- Подключено в:
  - `frontend/src/pages/EventsPage.tsx` (drawer)
  - `frontend/src/components/layout/SidebarRight.tsx` (drawer)

5. Direct `fetch` bypassing api client (закрыто)
- Закрыто реюзом:
  - `frontend/src/utils/download.ts` (`downloadBlobFile` на базе `apiDownload`)
- Подключено в:
  - `frontend/src/pages/MonitoringPage.tsx` (экспорт)
  - `frontend/src/pages/ActivityLogPage.tsx` (экспорт)

6. Action/Trust catalog response types duplicated (закрыто)
- Закрыто реюзом:
  - `frontend/src/types/catalog.ts`
- Подключено в:
  - `frontend/src/pages/UsersPage.tsx`
  - `frontend/src/pages/EventsPage.tsx`
  - `frontend/src/components/layout/SidebarRight.tsx`
  - `frontend/src/pages/ActivityLogPage.tsx`
  - `frontend/src/pages/RootAdminsPage.tsx`

## Быстрый план внедрения

1. (Закрыто) Вынести `shortUserAgent` в `utils/userAgent.ts` и заменить все локальные реализации.
2. (Закрыто) Добавить `apiDownload` в `api/client.ts` и убрать прямой `fetch` из страниц экспорта.
3. (Закрыто) Вынести общие типы каталогов в `types/catalog.ts`.
4. (Закрыто) Вынести `EventMetaPills` для `EventsPage` + `SidebarRight` (чтобы channel/severity/read/handled рендерились из одного компонента).
## Ограничение на изменения

- Не ломать текущий сценарий monitoring-context:
  график в drawer должен строиться через `loadMonitoringContext(...)` с fallback
  `60m -> 24h -> 7d` и с повтором без `focus_path` при пустом ряде.
- `frontend/src/utils/userAgent.ts`
  Единый short-form для User-Agent:
  `shortUserAgent` используется в Users/Activity/UserDetails/Session/Device.

### Backend service reuse
- `backend/app/services/admin_actions.py`: includes shared `require_reason` and `send_login_code_for_user` helpers (used by admin routes and bulk-action path).
- `backend/app/services/admin_queries.py`: includes trusted-devices query loaders (`load_recent_login_history_for_user`, `load_trusted_devices_for_user`).
- `backend/app/services/admin_serializers.py`: includes trusted-devices serializer (`serialize_trusted_devices`) and UA/device label normalization helpers.
- `app.core.events.utc_now_naive`: reused in `backend/app/api/admin.py` and `backend/app/services/admin_queries.py` to avoid local time-helper duplicates.
- `backend/app/services/admin_queries.py`: now also hosts `build_last_login_map` and `build_trust_summary_map` (single query source for user list/admin-email snapshots).
- `backend/app/services/admin_serializers.py`: now also hosts `build_user_profile_snapshot` (single snapshot serializer source).
- `backend/app/services/admin_serializers.py`: shared login/audit row serializers and iter serializers.
- `backend/app/services/admin_serializers.py`: shared export row iterators (`iter_login_history_export_rows`, `iter_audit_export_rows`) for CSV/XLSX routes in `admin.py`.
- `backend/app/services/admin_queries.py`: shared query-builders for login history and audit rows.
- `backend/app/services/admin_actions.py`: shared actor/target permission checks for bulk admin actions.
- `backend/app/services/admin_actions.py`: also hosts shared admin action logging/event emission helper (`log_admin_action`) used by `admin.py`.
- `backend/app/services/admin_monitoring.py`: shared monitoring settings and history/focus payload builders (with cache + Prometheus query helpers).


- backend/app/services/admin_queries.py: shared load_recent_admin_audit_for_user for user-details audit context (admin route no longer builds this query inline).
- backend/app/services/admin_queries.py: shared loaders for list/admin-email enrichment (load_latest_request_access_requested_at_by_email, load_latest_pending_access_events_for_users, load_users_by_email_map) replacing duplicated inline SQL in admin.py.
- backend/app/services/admin_queries.py: shared active trusted-devices loader load_active_trusted_devices_for_user reused by revoke-except route in admin.py.
- backend/app/services/admin_queries.py: shared anomaly counter helpers (`count_login_history_result_since`, `count_login_history_ip_occurrences`) reused by user-details flow in admin.py.
- backend/app/services/admin_serializers.py: shared user-details serializers/anomaly builder (`serialize_user_details_login_history`, `serialize_user_details_admin_actions`, `build_user_details_anomalies`) replace inline route mappings in admin.py.
- backend/app/api/admin.py export routes now reuse iterator chain `iter_serialized_* -> iter_*_export_rows` with `yield_per`, removing eager materialization (`query.all()`) in audit/login-history export paths.
- backend/app/core/export_utils.py: existing `xlsx_attachment_response` extended to `Workbook(write_only=True)` for lower export memory footprint (module reused, no new export module).
- backend/app/services/admin_bulk.py + frontend/src/components/users/UserActionPanel.tsx: shared reason-policy contract via catalog field `reason_mode` (`required/recommended/optional`), UI reason validation/placeholder now follows backend source-of-truth.
- backend/app/services/reason_policy.py + frontend/src/utils/reasonPolicy.ts: unified reason-policy contract for `/admin/settings/admin-emails` (`add/remove-other -> required`, `no-op -> optional`) reused by backend enforcement and frontend UX.
- backend `reason_policy` contract extended to `modes + presets + hints`; `RootAdminsPage` consumes this payload and no longer stores local presets/hints.
- backend `/admin/users/actions/available` now serves applicability matrix (`applicable_by_action`, `applicable_by_user`); `UsersPage` reuses backend matrix and removed local `isActionApplicable` rule duplication.
- backend/tests/test_api_integration.py + backend/tests/test_admin_bulk.py: reason-policy parity checks added for required/non-required flows (`set_role`, `remove_approve`, `/admin/settings/admin-emails`).


- `backend/app/services/admin_queries.py` + `backend/app/services/admin_serializers.py`
  Reused from `backend/app/api/admin.py` routes (`list_users`, `user_details`, `admin-emails`, trusted-devices revoke-except) to remove inline duplicate query/serialization blocks.


## Reuse Gate (cross-module)
- Scan related modules before extraction: `api -> services -> core -> frontend hooks/utils` for same-domain logic.
- Prefer `extend existing helper` over `new helper/module` to avoid reuse fragmentation.
- After extraction, keep thin route/page layer and call shared helper from all relevant modules.
- Every merge-first reuse step must be reflected in `TODO.md` and linked with file refs.

- `useIncrementalPager` extended for count-less append pages (`total` optional + hasMore fallback), reused by `useEventFeed` with `includeTotal` only on first page to reduce backend count load.

- `backend/app/api/admin.py` (`user_details`) now reuses one loaded login-history dataset (`limit=200`) for both summary list and trusted-device enrichment, removing duplicated loader call.

- `useActivityFeed` now reuses count-less append contract (`include_total` only for page 1) for both `/admin/audit` and `/admin/login-history`, paired with shared `useIncrementalPager` fallback total/hasMore behavior.

- `useUsersList` now reuses count-less append contract (`include_total` only for page 1) for `/admin/users`, aligned with shared `useIncrementalPager` total/hasMore fallback behavior.

- Governance check: cross-page HIGH reconciliation completed (`AUDIT_HIGH_REVALIDATION_2026-02-24.md`), reuse/pattern coverage confirmed for current infinite-scroll and export hot paths.
- Governance update (re-audit pass 2): cross-page HIGH reconciliation matrix refreshed (`AUDIT_HIGH_REVALIDATION_2026-02-24.md`) with done+open coverage and explicit page applicability.
- Backend alignment fix: `/admin/audit` list route now respects `include_total`, so `useActivityFeed` count-less append contract is now fully effective for both `/admin/audit` and `/admin/login-history`.

## Active Reuse Targets (intake wave)
- `frontend/src/utils/reasonPolicy.ts`: единый модуль reason-policy (`required/recommended/optional`, placeholder/validation helpers), подключен в `UserActionPanel` и `RootAdminsPage` для консистентного поведения поля причины.
- `frontend/src/utils/download.ts`: extend to shared export runner state (`pending/success/error`) and keep non-navigating download behavior for all callers.
- `frontend/src/utils/datetime.ts` + `frontend/src/utils/eventTime.ts`: converge to single `local + UTC` rendering contract for cards, drawers, lists, charts.
- `frontend/src/components/users/UserListSessionMeta.tsx`: keep single session/device renderer shared by `UsersPage` and `RootAdminsPage`; parity regressions fixed only through this reusable path.
- `frontend/src/hooks/useIncrementalPager.ts` + domain hooks (`useEventFeed`, `useUsersList`, `useActivityFeed`): staging-scale counter recheck must preserve one total-contract implementation.
- `frontend/src/utils/exportUrl.ts`: maintain one export URL builder entry-point for `ActivityLogPage` + `MonitoringPage`; new export callers should be added here first.

- `frontend/src/components/monitoring/InteractiveLineChart.tsx`
  Shared interactive chart renderer for monitoring contexts:
  `area-hover (X-snap to line) + smooth active point + crosshair X/Y + time ticks + click-to-zoom hooks + marker lines`.
  Reused in `MonitoringPage` (mini + zoom charts) and `MonitoringContextCard` (drawer/event context).

- `frontend/src/utils/monitoringContext.ts`
  Extended with `detectSpikeTimestamps(points)` for reusable local spike markers in context charts.

- `frontend/src/utils/monitoringChartConfig.ts`
  Shared monitoring chart config (`key/title/color/highlight`) used by `MonitoringPage` to avoid page-level chart literals.

- `MonitoringPage` range control reuse contract:
  quick presets (`15m/1h/6h/24h`) + optional precise slider (`1..24h`) with one effective range-state for all history/focus loaders.
