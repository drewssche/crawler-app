# REUSE_INDEX

Точечная карта реюзов и кандидатов на дедупликацию.

## Уже переиспользуется

- `frontend/src/components/ui/Button.tsx`
  Единый паттерн кнопок (`variant`, `size`, hover/active).

- `frontend/src/components/ui/SegmentedControl.tsx`
  Короткие фиксированные переключатели (`all/notification/action`, `asc/desc`, вкладки).

- `frontend/src/components/ui/UiSelect.tsx`
  Единый `select`-паттерн (стиль + стрелка + focus/hover).

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
  Единый download-flow для export-сценариев (`apiDownload + objectURL + revoke`) через `downloadBlobFile(path, filename)`.
  Подключен в `MonitoringPage` и `ActivityLogPage`.

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

- `frontend/src/utils/eventLabels.ts`
  Единый mapping сырых event-enum значений в UI-лейблы:
  `eventChannelLabel`, `eventSeverityLabel`, `eventReadStatusLabel`, `eventHandledStatusLabel`.

- `frontend/src/types/catalog.ts`
  Централизованные response-типы каталогов/available-actions:
  `AuditActionCatalogResponse`, `ActionCatalogResponse`, `TrustPolicyCatalogResponse`, `AvailableActionsResponse`.

- `frontend/src/types/common.ts`
  Централизованные lightweight-типы:
  `IdEmail`, `PagedResponse<T>`.


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

5. Direct `fetch` bypassing api client (средний приоритет)
- Найдено:
  - `frontend/src/pages/MonitoringPage.tsx` (экспорт)
  - `frontend/src/pages/ActivityLogPage.tsx` (экспорт)
- Рекомендация:
  добавить в `api/client.ts` общий `apiDownload(path)` и использовать его.

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

1. Вынести `shortUserAgent` в `utils/userAgent.ts` и заменить все локальные реализации.
2. Добавить `apiDownload` в `api/client.ts` и убрать прямой `fetch` из страниц экспорта.
3. (Закрыто) Вынести общие типы каталогов в `types/catalog.ts`.
4. (Закрыто) Вынести `EventMetaPills` для `EventsPage` + `SidebarRight` (чтобы channel/severity/read/handled рендерились из одного компонента).

## Ограничение на изменения

- Не ломать текущий сценарий monitoring-context:
  график в drawer должен строиться через `loadMonitoringContext(...)` с fallback
  `60m -> 24h -> 7d` и с повтором без `focus_path` при пустом ряде.
- `frontend/src/utils/userAgent.ts`
  Единый short-form для User-Agent:
  `shortUserAgent` используется в Users/Activity/UserDetails/Session/Device.
