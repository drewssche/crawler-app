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
- Capability labels are not permissions. Any capability shown in the matrix (`data.view`, `crawler.run`, `profiles.edit`) must exist in backend/frontend permission sets and guard concrete endpoints.
- Target role contract:
  - viewer: read accessible project/site/run/page data;
  - editor: viewer + edit project/site and start/retry runs;
  - admin: editor + users/events/audit/monitoring;
  - root-admin: admin + root-admin management.
- При изменении ролей обновлять backend matrix, frontend guards и tests; запускать `python tools/check_rbac_parity.py`.

### Dev UI Debug Contract

- Fixture-based UI Debug Center may preview roles/states but never changes the actor's backend permissions.
- It is enabled only by explicit development flags, carries a permanent warning banner and is absent from production builds/routes.
- Synthetic toasts/events/access requests are local fixtures by default; no DB writes or real notifications.
- Real impersonation requires complete endpoint RBAC, project membership, root-admin authorization, short-lived audited tokens and production hard-disable.

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

- Project is a container; a monitored website is `ProjectSite`.
  A project has one or more sites, while anomalies and crawl diagnostics remain site-scoped.
- Each `ProjectSite` owns its `start_url`, crawl scope, technical allowlist and limits.
  `allowed_domains` is not a list of sites to compare.
- Scope modes:
  - `whole_site`;
  - `path_prefix` with segment-boundary validation and redirect re-check.
- Existing projects migrate to one primary site. Ambiguous legacy extra domains require user confirmation before becoming separate sites.
- Compare is a full-width project route (`/profiles/:id/compare`), not a cramped card in Workspace.
  It supports arbitrary left/right site+page+version selection, visual/code/structure modes and responsive focus mode.
- Single-site anomaly detection is independent from compare and requires a reliable per-site baseline.
- Project information architecture: `Основная | История | Настройки`.
  - `Основная`: run state, decision-useful metrics and current structure.
  - `История`: persisted runs/diff history only.
  - `Настройки`: real profile/scope/limits/schedule availability and danger zone.
  - Не показывать сохраняемые controls до появления реального backend API.
- Workspace project rows показывают только достоверные summary-поля: domain scope, run status/time, pages, changes и runs count.
  Destructive actions не размещаются в списке; они находятся в `Проект → Настройки → Опасная зона`.
  Строка обязана поддерживать mouse + Enter/Space и адаптивный перенос метаданных.
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
