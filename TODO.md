# TODO

Короткий рабочий backlog. Полная история решений и завершённых волн сохранена в
[`docs/archive/TODO_HISTORY_2026-06-22.md`](docs/archive/TODO_HISTORY_2026-06-22.md).

## Current Context — 2026-06-24

- Активная продуктовая установка: **friendly UX/UI**, без декоративного шума и с объяснимыми состояниями.
- Browser-smoke выполняется **только по явному запросу пользователя**.
- Завершённые волны закоммичены:
  - `16708d3` — stabilization, friendly failures/search и project IA;
  - `ea8ec69` — compact Workspace project rows.
- Уточнён целевой продуктовый контракт:
  - проект — контейнер для одного или нескольких самостоятельных сайтов;
  - мониторинг аномалий работает и для проекта с одним сайтом;
  - сравнение сайтов опционально и выполняется между выбранными страницами/версиями;
  - сайт можно сканировать целиком либо только внутри заданного раздела (`path_prefix`).
- Role audit 2026-06-24:
  - project/run permissions теперь enforced backend-first и отражены frontend guards;
  - fixture-only UI Debug Center реализован без impersonation и backend writes;
  - настоящая impersonation остаётся заблокированной до project membership.
- Последние проверки: backend `42 passed, 2 skipped`; RBAC parity passed; frontend tests `16 passed`; frontend production build passed; targeted ESLint passed; `git diff --check` passed.
- Общий frontend lint имеет ранее существовавшие ошибки вне текущих изменений; не считать их регрессией этой волны.
- Следующий рекомендуемый пункт: **Site monitoring foundation — `ProjectSite + section scope`**.

## Working Rules

- Сначала читать этот файл и `git diff`; не перезаписывать незакоммиченные изменения.
- Формат закрытия: `Что было → Что стало → Как проверить → Вклад в цели`.
- Новые бизнес-правила — server-first; frontend только объясняет состояние и доступные действия.
- Reuse-first, no-regression, server-load и multi-user правила: [`docs/ENGINEERING_PLAYBOOK.md`](docs/ENGINEERING_PLAYBOOK.md).
- Release-gate и Browser-проверки не запускать автоматически.

## In Progress

- [ ] Нет активного пункта.

## Next — UX/Product

- [ ] **P1 EPIC: Site monitoring + scoped crawl + compare workspace** (`HIGH`, staged).
  Цель: одна модель должна поддерживать мониторинг одного сайта, несколько сайтов в проекте, аномалии и ручное/автоматическое сравнение страниц.

  **Product model**
  - `Project` — рабочий контейнер и права доступа.
  - `ProjectSite` — самостоятельный сайт внутри проекта:
    `name/region`, `start_url`, `scope_mode`, `path_prefix`, `role`, crawl limits и технический allowlist.
  - Проект содержит `1+` сайтов. Роли `reference/target` помогают UX сравнения, но не ограничивают выбор: сравнить можно любые два сайта или две версии одного сайта.
  - Текущий `allowed_domains_csv` больше не обозначает сравниваемые сайты; после миграции это только технический allowlist конкретного `ProjectSite`.

  **Section scope**
  - режимы: `Весь сайт` и `Только раздел`;
  - для `Только раздел` хранить canonical `scheme + host + path_prefix`, например `https://example.com/docs/`;
  - crawler включает стартовую страницу и потом принимает только URL того же site scope;
  - `/docs` не должен случайно включать `/docs-old`; проверять границу path segment;
  - redirects повторно валидируются после перехода; выход выше/вне `path_prefix` блокируется и учитывается в диагностике;
  - query/fragment normalization задаётся отдельно, чтобы не создавать дубликаты URL.

  **Creation/settings UX**
  - форма создаёт первый сайт через отдельные поля `Название сайта`, `Стартовый адрес`, `Область: весь сайт/раздел`;
  - основной домен автоматически становится технически разрешённым;
  - дополнительные сайты добавляются отдельными site cards/rows, а не общим textarea доменов;
  - paste нескольких адресов может раскладываться в несколько строк, но перед созданием пользователь видит итоговый список сайтов;
  - ошибки и duplicate scope показываются рядом с конкретным сайтом;
  - существующие проекты мигрируются в проект с одним `ProjectSite`; дополнительные значения старого `allowed_domains_csv` не превращать автоматически в compare-sites без подтверждения пользователя.

  **Crawl/run contract**
  - run хранит результаты раздельно по `project_site_id`;
  - у каждого сайта собственные status/failure/pages/duration/coverage и fair page budget;
  - обход одного сайта не должен исчерпывать общий лимит и скрывать второй сайт;
  - project-level run агрегирует site runs, но не смешивает их диагностику;
  - structure/history/KPI имеют фильтр `Все сайты | конкретный сайт`.

  **Single-site anomaly monitoring**
  - baseline строится по нескольким успешным прогонам конкретного сайта/scope;
  - сигналы: рост `4xx/5xx`, падение coverage/pages, массовое исчезновение URL, необычный объём изменений, изменение title/canonical/robots, broken links/resources и время ответа;
  - до накопления baseline показывать `Недостаточно данных`, а не ложную аномалию;
  - severity и причина рассчитываются backend и видны отдельно по сайту.

  **Page intelligence**
  - клик по узлу Structure сначала открывает read-only context drawer, не внешний сайт;
  - drawer: site/scope, URL, HTTP/status, snapshot/meta, links/resources, текущий/предыдущий run и явное действие `Открыть на сайте`;
  - unchanged page показывает одно состояние `Изменений нет`, без дублирования одинаковых окон;
  - subscriptions, occurrence search и target fingerprint добавляются после стабильных snapshot/diff contracts.

  **Compare workspace**
  - отдельный полноширинный маршрут внутри проекта: `/profiles/:id/compare`;
  - верхняя компактная строка выбора:
    `левый сайт + страница/версия ↔ правый сайт + страница/версия`;
  - режимы: `Визуально`, `Код`, `Структура`, позднее `Контент`;
  - пользователь может вручную выбрать любые две страницы; auto-match по normalized relative path только предлагает пару и не блокирует ручной выбор;
  - поддержать cross-site compare и historical compare одной страницы/сайта одним UI;
  - широкий экран: split view + optional sync scroll; средний: resize/single-side/diff mode; мобильный: последовательный просмотр;
  - в compare focus mode скрывать правый Event Center и позволять свернуть левый sidebar.

  **Implementation order**
  1. Data model/migration: `ProjectSite`, site-scoped runs/pages; compatibility для существующих проектов.
  2. Create/settings UX для сайтов и scope без фиктивных controls.
  3. Site-scoped crawler с path guard, fair budgets и per-site diagnostics.
  4. Project UI: site cards, site filter, отдельные KPI/coverage/errors.
  5. Single-site anomaly baseline/signals.
  6. Page context drawer на существующих snapshot/index данных.
  7. Full-width manual compare workspace.
  8. Auto page matching, visual/code diff, subscriptions/outbox.

  **Verification**
  - single-site whole-domain и section-only проекты не выходят за scope;
  - multi-site run гарантированно стартует и возвращает диагностику по каждому сайту;
  - ошибка одного сайта не скрывает успешный результат другого;
  - anomaly UI не срабатывает без baseline;
  - compare позволяет выбрать две произвольные страницы и не теряет контекст проекта.

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

- [ ] **P1 Project governance — quotas, ownership, membership** (`HIGH`, follows Site foundation).
  Quotas per actor/role/project/site, storage/concurrency budgets и server-side project membership.
  Canonical site/path scope и duplicate policy перенесены в epic `Site monitoring + scoped crawl + compare workspace`, чтобы не вести два конкурирующих контракта.

- [ ] **HIGH Scan storage retention + permanent stats policy**.
  Raw artifacts `latest + previous`; агрегаты сохраняются; project delete транзакционный и audit-safe.

- [ ] **P1 Protected emergency root actor** (`HIGH`).
  Secret/config-backed break-glass actor, скрытый из обычных списков, недоступный для delete/demote, audit-visible.

## Release Gate / Deferred

- [ ] Staging-scale count-less counters recheck: Events/Users/Activity (`MEDIUM`, release-gate).
- [ ] Users vs RootAdmins device/session parity on staging-sized data (`MEDIUM`, release-gate).
- [ ] Cleanup synthetic load-test data near production (`LOW`, prefer restore/reset).
- [ ] Telegram user channels/report preview (`P2`, после subscriptions + outbox; не смешивать с operational alerts).

## Recently Done

- [x] **P0 Project/run RBAC parity**.
  - Что было: project/run API были доступны без согласованных permissions; viewer видел mutation controls, а editor формально не отличался от viewer.
  - Что стало: permissions `data.view/crawler.run/profiles.edit` добавлены в backend/frontend source-of-truth; routes и endpoints защищены; viewer читает, editor редактирует/запускает, admin/root наследуют возможности.
  - Как проверить: anonymous project/run API → `401`; viewer read → `200`, mutations → `403`; editor create/start/delete разрешены; direct frontend URL guarded.
  - Вклад в цели: закрыт security blocker для `ProjectSite`, role preview и future membership (`high`).
- [x] **P1 Dev-only UI Debug Center — fixture stage**.
  - Что было: toast, access request, event/anomaly и role UI можно было увидеть только через реальные действия/данные.
  - Что стало: `/ui-debug` для admin/root-admin под двойным dev guard; preview ролей, permission matrix, toast gallery, Event Center fixtures и редкие user/project states без DB writes.
  - Как проверить: включить flags из README, пересобрать frontend/backend, открыть `Настройки → UI Debug Center`; production backend всегда возвращает `enabled=false`.
  - Вклад в цели: быстрее и безопаснее визуальная проверка редких состояний (`high` QA/UX), без impersonation риска.
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
