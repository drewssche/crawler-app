# TODO

Короткий рабочий backlog. Полная история решений и завершённых волн сохранена в
[`docs/archive/TODO_HISTORY_2026-06-22.md`](docs/archive/TODO_HISTORY_2026-06-22.md).

## Current Context — 2026-06-24

- Активная продуктовая установка: **friendly UX/UI**, без декоративного шума и с объяснимыми состояниями.
- Browser-smoke выполняется **только по явному запросу пользователя**.
- В рабочем дереве сохранена незакоммиченная stabilization-волна:
  - единый `/profiles/summary` response envelope и cache invalidation;
  - duplicate canonical scope и friendly conflict UX;
  - per-project active-run guard;
  - стабильные failure codes/messages и FAILED UX;
  - viewer Event Center скрыт при отсутствии `events.view`;
  - Friendly project search в Workspace/Sidebar;
  - project information architecture `Основная | История | Настройки`.
- Последние проверки: backend `40 passed, 2 skipped`; Alembic current=head; frontend tests `12 passed`; frontend production build passed; targeted ESLint passed; `git diff --check` passed.
- Общий frontend lint имеет ранее существовавшие ошибки вне текущих изменений; не считать их регрессией этой волны.
- Следующий рекомендуемый UX-пункт: **Page intelligence — первый vertical slice context drawer страницы**.

## Working Rules

- Сначала читать этот файл и `git diff`; не перезаписывать незакоммиченные изменения.
- Формат закрытия: `Что было → Что стало → Как проверить → Вклад в цели`.
- Новые бизнес-правила — server-first; frontend только объясняет состояние и доступные действия.
- Reuse-first, no-regression, server-load и multi-user правила: [`docs/ENGINEERING_PLAYBOOK.md`](docs/ENGINEERING_PLAYBOOK.md).
- Release-gate и Browser-проверки не запускать автоматически.

## In Progress

- [ ] Нет активного пункта.

## Next — UX/Product

- [ ] **P1/P2 Page intelligence + subscriptions** (`MEDIUM-HIGH`, epic).
  Context drawer страницы, snapshot/meta/status/links/resources, subscriptions, occurrence search, target fingerprint и понятный compare UX.

- [ ] **MEDIUM Reuse: collapse-reset windowed lazy loader audit**.
  Выносить только после второго подтверждённого call-site; сохранить текущий UX дерева.

- [ ] **MEDIUM Reuse: search highlighting rollout audit**.
  `HighlightedText` уже используется в Structure и project search; расширять на Users/RootAdmins/Activity только по подтверждённой пользе.

## Reliability and Foundations

- [ ] **P0 Stabilization gate** (`HIGH`, implementation mostly complete).
  Осталось ручное подтверждение project/run сценариев по отдельному запросу: два независимых запуска, immediate project visibility, FINISHED pages, duplicate conflict.

- [ ] **P0 Observer notification visibility parity** (`HIGH`, implementation mostly complete).
  Backend viewer получает `403`, frontend не монтирует Event Center. Остался явный viewer UI-smoke по запросу.

- [ ] **P0/P1 Operations reliability + unattended recovery** (`HIGH`, epic).
  Celery boundary, lease/heartbeat, bounded retries/backoff, timeout/cancel, stale recovery, health/readiness; Telegram digest только после достоверных signals.

- [ ] **P1 Project governance — quotas, canonical scope, ownership** (`HIGH`, epic).
  Quotas, `scheme + host + path_prefix`, domain/path crawl guard, duplicate policy и server-side project membership.

- [ ] **HIGH Scan storage retention + permanent stats policy**.
  Raw artifacts `latest + previous`; агрегаты сохраняются; project delete транзакционный и audit-safe.

- [ ] **MEDIUM Scan & Diff MVP-1 data foundation**.
  Довести snapshot/diff contracts и storage flow; текущие feature-card/plan находятся в `docs/governance/`.

- [ ] **P1 Protected emergency root actor** (`HIGH`).
  Secret/config-backed break-glass actor, скрытый из обычных списков, недоступный для delete/demote, audit-visible.

## Release Gate / Deferred

- [ ] Staging-scale count-less counters recheck: Events/Users/Activity (`MEDIUM`, release-gate).
- [ ] Users vs RootAdmins device/session parity on staging-sized data (`MEDIUM`, release-gate).
- [ ] Cleanup synthetic load-test data near production (`LOW`, prefer restore/reset).
- [ ] Dev-only role impersonation/debug view (`P2`, после server-side project RBAC).
- [ ] Telegram user channels/report preview (`P2`, после subscriptions + outbox; не смешивать с operational alerts).

## Recently Done

- [x] **P1 Workspace project rows/cards density redesign**.
  - Что было: высокие project cards с отдельными domain pills, одним счётчиком и постоянной кнопкой удаления; важные run-данные не читались с первого взгляда.
  - Что стало: компактная keyboard-accessible строка показывает имя, краткий domain scope, status, время последнего прогона, страницы, изменения и число прогонов; layout переносится на узкой ширине.
  - Как проверить: открыть Workspace с проектами разных статусов; клик/Enter/Space открывают проект, поиск и подсветка сохраняются, destructive action в строке отсутствует и доступен в `Проект → Настройки`.
  - Вклад в цели: больше проектов в viewport и быстрее читается состояние (`high` UX); удалён лишний destructive control и один UI-компонент из bundle (`medium`).
- [x] **P1 Project information architecture — `Основная | История | Настройки`**.
  - Что было: четыре вкладки `Сводка | Расписание | Структура | История`; структура требовала отдельного перехода, а расписание было несохраняемым UI-прототипом.
  - Что стало: `Основная` объединяет последний прогон, KPI и структуру; `История` показывает реальные runs без фиктивного domain-фильтра; `Настройки` содержит реальные profile/scope/limit параметры, честный статус расписания и danger zone.
  - Как проверить: открыть проект; на `Основная` доступны run/KPI/structure, на `История` — список прогонов, на `Настройки` — параметры, ручной запуск и удаление. Кнопки `Сохранить расписание` нет.
  - Вклад в цели: меньше лишних переходов и ложных affordance (`high` UX), ясное разделение работы/истории/настроек (`high`).
- [x] Friendly project/run failure UX.
- [x] Friendly project search: normalization, URL cleanup, RU/EN layout recovery, ranking, highlighting и friendly empty state.
- [x] Backend/frontend stabilization implementation checks; ручные Browser-gates оставлены открытыми отдельно.

## Archive Index

- Полный TODO и ретроспективы: [`docs/archive/TODO_HISTORY_2026-06-22.md`](docs/archive/TODO_HISTORY_2026-06-22.md)
- Полный historical patterns snapshot: [`docs/archive/PATTERNS_FULL_2026-06-22.md`](docs/archive/PATTERNS_FULL_2026-06-22.md)
- Полный historical reuse snapshot: [`docs/archive/REUSE_INDEX_FULL_2026-06-22.md`](docs/archive/REUSE_INDEX_FULL_2026-06-22.md)
