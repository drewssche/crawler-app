# Engineering Playbook

Компактный source of truth для разработки `crawler-app`. Исторические подробности доступны в [`archive/`](archive/).

## 1. Priorities

1. Корректность и безопасность доступа.
2. Server load и multi-user consistency.
3. Friendly, объяснимый UX/UI.
4. Reuse и снижение дублирования.
5. Только затем визуальное обогащение.

Shared-state хранится в DB/backend. Локальный frontend state не является source of truth для действий, влияющих на других пользователей.

## 2. Delivery Contract

- **Reuse first:** сначала расширить существующий helper/component; новый shared-модуль — при реальном повторном использовании.
- **No-regression:** рефакторинг не меняет бизнес-поведение без отдельного решения.
- **Server-first:** permissions, applicability, reason-policy, quotas и failure semantics задаёт backend.
- **Friendly UX:** безопасное сообщение, причина, следующее действие, сохранение пользовательского ввода; никаких raw stack traces.
- **Browser:** только по явному запросу пользователя.
- **Docs:** закрытый пункт фиксируется в `TODO.md` форматом `Что было → Что стало → Как проверить → Вклад`.

## 3. API and Async State

- Success payload для общих API: `{ok,data,request_id}`.
- Ошибки: стабильный `code`, безопасный `message`, optional `details`, `request_id`.
- Frontend использует typed `ApiError`, а не парсит строки ошибок.
- Page loaders поддерживают cancellation/anti-race; повторные запросы дедуплицируются через shared TTL/in-flight cache.
- Shared operations используют idempotency/lock; run-lock — per-project.

## 4. RBAC

- Source of truth: `backend/app/core/permissions.py`.
- Enforcement выполняется backend `require_permission`; скрытие frontend не является защитой.
- Frontend: `hasPermission` + route guards + условный mount недоступных data surfaces.
- При изменении ролей обновлять backend matrix, frontend guards и tests; запускать `python tools/check_rbac_parity.py`.

## 5. Lists, Feeds and Drawers

- Базовый list contract: `20 + incremental load` через `useIncrementalPager` и `useWorkspaceInfiniteScroll`.
- Domain loaders: `useUsersList`, `useEventFeed`, `useActivityFeed`.
- Drawer async lifecycle: `useGuardedAsyncState`; user context: shared `userContext` loader/cache.
- SidebarRight держит компактное окно top-20; полный объём — на странице.
- Reset/search flow не должен создавать дубли запросов или misleading totals.

## 6. Events, Audit and Monitoring

Значимое действие оставляет тройной след: audit, event, monitoring. Event data фильтруются server-side по RBAC. Deep-link ведёт в релевантный контекст, read/handled state хранится per-user в DB.

Monitoring использует shared loaders/config/chart components; тяжёлые агрегаты — с коротким TTL cache и явным refresh contract.

## 7. Project UX

- Project information architecture: `Основная | История | Настройки`.
  - `Основная`: run state, decision-useful metrics and current structure.
  - `История`: persisted runs/diff history only.
  - `Настройки`: real profile/scope/limits/schedule availability and danger zone.
  - Не показывать сохраняемые controls до появления реального backend API.
- Duplicate canonical scope: объяснимый conflict с переходом в существующий проект и возможностью исправить ввод.
- Active/failed run — локальное состояние проекта, не глобальная блокировка.
- Failed run показывает безопасную причину и действия `Повторить / Проверить адрес / Технические детали`.
- Project search использует только `frontend/src/utils/projectSearch.ts`:
  `NFKC + lowercase + ё/е + URL cleanup + RU/EN layout recovery`;
  ranking `exact > prefix/segment-prefix > substring > layout match`;
  effective query подсвечивается через `HighlightedText`.
- Пунктуационный search — no-op; fuzzy/Levenshtein добавляется только по подтверждённым кейсам.

## 8. UI Composition

- Base primitives: `Button`, `Card`, `ClearableInput`, `UiSelect`, `StatusText`, `EmptyState`.
- Card actions: `CardActionButton` / domain wrappers; modal: `ModalShell + ModalActionRow`.
- Drawers: `DrawerBody`; scrollable side regions: `ScrollableRegion`.
- Hint content: `HintCard`; interactive panels: `Card interactive`.
- Не создавать page-level variants, если существующий primitive можно расширить без регрессии.

## 9. Scan Data Lifecycle

- Raw artifacts (`html/dom/screenshot/resources`) — `latest + previous` run на проект.
- Старые runs сохраняют агрегированную статистику.
- Project delete — транзакционный, audit-visible; долгосрочная статистика удаляется только по отдельной retention policy.
- Sensitive crawler state не хранится открытым текстом.

## 10. Verification Minimum

- Targeted unit/integration tests.
- Frontend production build для frontend-волн.
- `git diff --check`.
- Targeted lint затронутых файлов; baseline-проблемы фиксируются отдельно.
- UI route/smoke описывается в TODO; Browser запускается только по запросу.

## 11. Reuse Map

| Domain | Canonical modules |
|---|---|
| API/cache | `api/client.ts`, `profileListCache`, catalog caches |
| Paging/scroll | `useIncrementalPager`, `useWorkspaceInfiniteScroll` |
| Feed loaders | `useUsersList`, `useEventFeed`, `useActivityFeed` |
| Async drawers | `useGuardedAsyncState`, `userContext` |
| Project search | `projectSearch`, `HighlightedText`, `ProjectDomainPills` |
| Event cards | `EventCardActions`, `CardActionButton`, `IconGhostButton` |
| User actions | `UserActionPanel`, reason-policy helpers, applicability catalog |
| Monitoring | `InteractiveLineChart`, `monitoringContext`, `monitoringChartConfig` |
| Exports | `exportUrl`, `download` |
| Modal/panels | `ModalShell`, `ModalActionRow`, `DrawerBody`, `ScrollableRegion` |

Полная прежняя карта компонентов: [`archive/REUSE_INDEX_FULL_2026-06-22.md`](archive/REUSE_INDEX_FULL_2026-06-22.md).
Полный прежний набор контрактов: [`archive/PATTERNS_FULL_2026-06-22.md`](archive/PATTERNS_FULL_2026-06-22.md).
