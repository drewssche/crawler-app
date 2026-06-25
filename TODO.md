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
- `ProjectSite` foundation 2026-06-24:
  - добавлены модель, миграция/backfill и RBAC API сайтов проекта;
  - новый и существующий проект гарантированно получает один primary site;
  - canonical `whole_site/path_prefix` scope защищает границы раздела и выход через `..`;
  - каждый `Run` теперь обязательно принадлежит `ProjectSite`, а `Page` наследует site scope через `run_id`;
  - legacy `/runs/start/{profile_id}` сохранён как compatibility endpoint и запускает primary site;
  - явные site endpoints: запуск `/runs/start-site/{site_id}` и история `/runs/by-site/{site_id}`;
  - crawler использует настройки `ProjectSite`, проверяет section scope до запроса и после redirect.
- friendly Create/Settings UX:
  - создание проекта атомарно создаёт первый сайт с режимом `Весь сайт/Только раздел`;
  - общий textarea доменов удалён из формы;
  - настройки показывают самостоятельные site cards с add/edit/enable/disable/delete;
  - destructive состояния объясняют, почему сайт с историей нужно отключить, а не удалить.
- functional site context cards:
  - `Основная` показывает компактные карточки всех сайтов и один выбранный контекст;
  - summary всех карточек загружается одним backend-запросом без N+1;
  - запуск, KPI, Structure и History используют `project_site_id` выбранной карточки;
  - disabled/error/empty states остаются локальными для сайта.
- multi-site project orchestration:
  - `Запустить все сайты` последовательно запускает все включённые сайты с собственным page budget;
  - failure/active state одного сайта не прерывает остальные;
  - aggregate response и UI сохраняют отдельный итог `FINISHED/FAILED/SKIPPED` по каждому сайту;
  - текущий orchestration синхронный; вынос в durable worker/parent project run остаётся частью operations reliability.
- single-site anomaly baseline MVP:
  - baseline рассчитывается backend по трём предыдущим `FINISHED` runs того же `ProjectSite`;
  - до накопления baseline состояние строго `Недостаточно данных`;
  - сигналы MVP: падение coverage/pages, рост доли HTTP `4xx/5xx`, необычная доля изменённых страниц;
  - site cards показывают короткий статус, выбранный сайт — причины и сравнение с baseline;
  - run failure остаётся отдельной ошибкой запуска и не маскируется под статистическую аномалию.
- Page context + SEO checklist MVP:
  - клик по странице Structure открывает drawer, а не внешний сайт;
  - on-demand backend-анализ показывает HTTP/meta/headings, внутренние/внешние и известные broken links, images/scripts/styles;
  - SEO score `0–100` состоит из прозрачных checks с весами и рекомендациями;
  - `Открыть на сайте` остаётся явным действием; удалённая страница получает понятное empty/error состояние.
- manual Compare workspace MVP:
  - маршрут перенесён внутрь проекта: `/profiles/:id/compare`, Event Center скрывается в focus mode;
  - левая/правая сторона независимо выбирают сайт, успешный run и страницу;
  - поддержаны cross-site и historical compare без обязательного auto-match;
  - режим `Код` показывает line diff сохранённого HTML, `Структура` сравнивает HTTP/meta/SEO/links/assets;
  - focus workspace скрывает оба sidebar и отдаёт ширину двум рабочим панелям;
  - `Визуально` показывает sanitized snapshots в sandboxed iframe с CSP без scripts/forms/network resources;
  - `Обзор/Детально` и `Обе/Левая/Правая` предотвращают нечитаемые миниатюры;
  - sync scroll, resize и auto-match остаются следующими расширениями.
- Последние проверки: backend `54 passed, 2 skipped`; PostgreSQL migrations/backfill verified, все существующие runs получили `project_site_id`; RBAC parity passed; frontend tests `25 passed`; frontend production build passed; targeted ESLint passed; `git diff --check` passed.
- Общий frontend lint имеет ранее существовавшие ошибки вне текущих изменений; не считать их регрессией этой волны.
- Следующий рекомендуемый пункт: **normalized relative-path auto-match + optional sync scroll/resize** для Compare.

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

  **Site cards visual contract**
  - на `Основной` компактные карточки сайтов являются переключателем рабочего контекста, а не декоративной сеткой;
  - карточка показывает название, scope, состояние последнего прогона, страницы, изменения и время; выбранный сайт выделяется без лишнего визуального шума;
  - KPI, Structure, History и ручной запуск ниже всегда относятся к выбранному сайту;
  - в `Настройках` используются раскрываемые management cards с add/edit/enable/disable/delete;
  - в Workspace не вкладывать крупные site cards в project rows: показывать только компактный агрегат сайтов;
  - в Compare использовать две компактные selector cards, которые после выбора освобождают место для diff.

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
  - анализ выбранной страницы выполняется on-demand по сохранённому HTML, без массового пересчёта всего сайта при каждом открытии проекта;
  - links/resources: внутренние/внешние ссылки, известные broken targets текущего run, изображения/scripts/styles и отсутствующие обязательные атрибуты;
  - SEO checklist MVP: `title`, description, один содержательный `h1`, canonical, indexability/robots, lang, viewport, image alt и базовая структура headings;
  - SEO score `0–100` рассчитывается backend по прозрачным весам; UI показывает процент, passed/warning/failed пункты и конкретную рекомендацию, а не обещание позиции в поиске;
  - score является технической полнотой страницы, не универсальной оценкой качества контента или гарантией SEO-результата;
  - позднее расширить structured data/Open Graph/hreflang/content duplication только после стабильного snapshot contract;
  - unchanged page показывает одно состояние `Изменений нет`, без дублирования одинаковых окон;
  - subscriptions, occurrence search и target fingerprint добавляются после стабильных snapshot/diff contracts.

  **Compare workspace**
  - отдельный полноширинный маршрут внутри проекта: `/profiles/:id/compare`;
  - верхняя компактная строка выбора:
    `левый сайт + страница/версия ↔ правый сайт + страница/версия`;
  - режимы: `Визуально`, `Код`, `Структура`, позднее `Контент`;
  - пользователь может вручную выбрать любые две страницы; auto-match по normalized relative path только предлагает пару и не блокирует ручной выбор;
  - поддержать cross-site compare и historical compare одной страницы/сайта одним UI;
  - Compare работает как настоящий focus workspace: скрываются оба sidebar, остаются компактная навигация назад и рабочая область;
  - широкий экран: две полноценные панели; средний/узкий: переключение `Обе | Левая | Правая`, без двух нечитаемых миниатюр;
  - visual mode использует sandboxed snapshot iframe без scripts/forms/network navigation; режим `Обзор` масштабирует страницу, `Детально` сохраняет читаемый 100% scroll;
  - селекторы после выбора остаются компактными над соответствующей панелью; позднее добавить resize и optional sync scroll.

  **Implementation order**
  1. Data model/migration: `ProjectSite`, site-scoped runs/pages и compatibility для существующих данных — готово.
  2. Create/settings UX для сайтов и scope без фиктивных controls — готово.
  3. Site-scoped crawler: одиночный и project-level multi-site run, path/redirect guard, fair per-site budgets и per-site diagnostics — готовы; durable background orchestration остаётся в reliability epic.
  4. Project UI: функциональные site cards как context selector, отдельные KPI/coverage/errors и site-scoped History — готово.
  5. Single-site anomaly baseline/signals — MVP готов; title/canonical/robots/resources/latency signals требуют расширенного page snapshot contract.
  6. Page context drawer на существующих snapshot/index данных — MVP готов; richer persisted snapshot fields остаются.
  7. Full-width manual compare workspace — MVP `Код/Структура` готов.
  8. Visual mode/focus workspace — готово; auto page matching, sync scroll/resize, subscriptions/outbox остаются.
  9. После перевода UI, crawler и API удалить дублирующие site-поля из legacy `Profile` и compatibility endpoint `/runs/start/{profile_id}`.

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

- [x] **P1 Compare focus workspace + safe visual snapshots**.
  - Что было: Compare оставлял левый sidebar и не имел визуального режима; две будущие панели рисковали стать слишком узкими.
  - Что стало: оба sidebar скрываются; sanitized snapshots отображаются в sandboxed iframe; режимы `Обзор/Детально` и `Обе/Левая/Правая` дают полезную площадь на широком и узком экране.
  - Как проверить: `Проект → Сравнить страницы → Визуально`; переключить масштаб и одну/две стороны, убедиться, что links/forms/scripts snapshot не выполняются.
  - Вклад в цели: визуальное сравнение получило отдельное рабочее пространство (`high` UX); snapshot не исполняет сохранённый активный контент (`high` security).
- [x] **P1 Full-width manual Compare workspace MVP**.
  - Что было: `/compare` был общей страницей-заглушкой без контекста проекта и данных.
  - Что стало: `/profiles/:id/compare` позволяет вручную выбрать любые две страницы/версии; HTML line diff и structural diff работают для разных сайтов и истории одного сайта, Event Center скрыт для полезной ширины.
  - Как проверить: `Проект → Сравнить страницы` → выбрать site/run/page слева и справа → переключить `Код/Структура`; на узком экране селекторы переходят в одну колонку.
  - Вклад в цели: compare стал реальным рабочим инструментом без блокирующего auto-match (`high` product value); выбор snapshot остаётся явным и объяснимым (`high` UX).
- [x] **P1 Page context drawer + technical SEO checklist MVP**.
  - Что было: клик по Structure сразу открывал внешний сайт; сохранённый HTML не давал пользователю объяснимого контекста страницы.
  - Что стало: drawer анализирует выбранную страницу on-demand, показывает HTTP/meta/headings, ссылки и известные broken targets, ассеты и SEO score из девяти взвешенных проверок.
  - Как проверить: `Проект → Основная → Структура` → клик по странице; проверить SEO checklist, links/assets и отдельную кнопку `Открыть на сайте`.
  - Вклад в цели: диагностика страницы остаётся внутри проекта (`high` UX); SEO-процент объясним и не выдаётся за гарантию поисковых позиций (`high` trust/correctness).
- [x] **P1 Single-site anomaly baseline MVP**.
  - Что было: карточка показывала только состояние последнего run; любое отклонение приходилось оценивать вручную, а без истории нельзя было отличить норму от проблемы.
  - Что стало: backend сравнивает последний успешный run с тремя предыдущими runs того же сайта; возвращает `insufficient_data/normal/anomaly`, severity и объяснимые причины по coverage, HTTP errors и change rate.
  - Как проверить: до четырёх успешных runs → `Недостаточно данных`; стабильный четвёртый run → `Норма`; резкое падение страниц или рост ошибок → warning/danger с причиной на выбранном сайте.
  - Вклад в цели: мониторинг одного сайта работает независимо от compare (`high` product value); baseline не создаёт ложных тревог без истории (`high` correctness).
- [x] **P1 Project-level multi-site orchestration**.
  - Что было: каждый сайт можно было запускать отдельно, но общего действия для проекта не существовало; пользователь должен был повторять запуск по карточкам.
  - Что стало: `Запустить все сайты` проходит все enabled sites, сохраняет отдельный run/лимит/ошибку для каждого и продолжает после локального failure или active conflict; UI показывает aggregate outcome и проблемные сайты.
  - Как проверить: проект с доступным и недоступным сайтом → `Запустить все сайты` → один `FINISHED`, второй `FAILED`, история успешного сайта сохранена и не скрыта.
  - Вклад в цели: multi-site проект выполняет реальную общую работу без смешивания результатов (`high` product correctness); локальная ошибка не блокирует остальные сайты (`high` reliability).
- [x] **P1 Functional site context cards on project page**.
  - Что было: карточки сайтов существовали только как management UI в настройках, а основная страница продолжала показывать смешанный project-level контекст.
  - Что стало: компактные карточки на `Основной` выбирают сайт; один summary endpoint отдаёт их статусы; запуск, последний прогон, KPI, Structure и History переключаются вместе с карточкой.
  - Как проверить: проект с двумя сайтами → выбрать каждую карточку → история/структура/счётчики меняются; `Запустить выбранный сайт` создаёт run только для активной карточки.
  - Вклад в цели: карточка стала функциональным контекстом, а не декором (`high` UX); результаты сайтов визуально и технически не смешиваются (`high` correctness).
- [x] **P1 Friendly project/site creation and settings UX**.
  - Что было: создание принимало общий textarea доменов, поэтому технический allowlist выглядел как список самостоятельных сайтов; настройки показывали legacy-поля без возможности изменить реальный scope.
  - Что стало: первый сайт создаётся атомарно через отдельные поля; режим раздела задаёт явный `path_prefix`; дополнительные сайты управляются отдельными cards с inline edit, состоянием и объяснимыми destructive guards.
  - Как проверить: `Создать проект` → выбрать `Только раздел`; затем `Проект → Настройки → Сайты проекта` → добавить/изменить/отключить сайт; duplicate scope получает локальную понятную ошибку.
  - Вклад в цели: модель `Project → ProjectSite` стала видимой и понятной пользователю (`high` UX); legacy allowlist больше не формирует ошибочную ментальную модель (`high` correctness).
- [x] **P1 Site-scoped runs/pages and crawler boundary**.
  - Что было: `Run` принадлежал только проекту, diff искал предыдущий запуск по всему проекту, а `allowed_domains_csv` превращался в набор самостоятельных seed-доменов.
  - Что стало: `Run.project_site_id` обязателен и backfilled; страницы изолированы через site run; diff сравнивает только историю того же сайта; отдельный сайт запускается и читается отдельными endpoints.
  - Как проверить: `alembic current` → `a6c3e9f1b247`; `POST /runs/start-site/{site_id}`; `GET /runs/by-site/{site_id}`; section run не запрашивает `/docs-old`, encoded `../` и другой origin.
  - Вклад в цели: второй сайт больше не является техническим доменом первого и получил независимую историю (`high` correctness); legacy project start сохранён только для плавного перехода UI (`medium` compatibility).
- [x] **P1 ProjectSite foundation — model, migration, canonical scope API**.
  - Что было: один `Profile` смешивал проект, стартовый сайт и общий список доменов; второй домен не имел самостоятельного результата.
  - Что стало: проект хранит `1+ ProjectSite`; миграция создаёт primary site для каждого существующего проекта; API позволяет читать/добавлять/редактировать/удалять сайты с RBAC, duplicate conflict и запретом удалить последний сайт.
  - Как проверить: `alembic current` → `8f2b1c4d6e90`; `GET /profiles/{id}/sites`; section scope `/docs/` принимает `/docs/page`, но отклоняет `/docs-old` и `/docs/../admin`.
  - Вклад в цели: создан совместимый фундамент multi-site и section-only мониторинга без преждевременного изменения crawler/UI (`high` architecture/reliability).
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
