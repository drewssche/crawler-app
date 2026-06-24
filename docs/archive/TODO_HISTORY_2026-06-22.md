# TODO History — snapshot 2026-06-22

Обновляю этот файл на каждом шаге: добавляю новые задачи, отмечаю выполненные, убираю неактуальные.

## Audit Guardrails (stop criteria)
- Волна аудита: максимум 5 реализованных задач или 2 крупных рефакторинга.
- После каждой волны: короткая ретроспектива (эффект, риски, остаточный ROI).
- Остановка текущего цикла:
  - 2 прохода подряд без новых HIGH-задач;
  - новые кандидаты в основном LOW и суммарный ожидаемый эффект < 10%;
  - стоимость/риск выше пользы.
- Лимит без отдельного согласования: не более 3 волн подряд по одному домену.
- По завершению: оформить `Audit Final` (что было/что стало/как проверено/что не трогаем).
- Формат отчета по каждому завершенному шагу (обязательно):
  - `Что было`;
  - `Что стало`;
  - `Как проверить` (маршрут кликов в UI + ожидаемый результат);
  - `Вклад в цели` (какую нагрузку/сложность снизили и ориентировочно насколько: `high/medium/low` или `%`, если измеримо).
- PRIORITY-контракт для frontend-аудита (обязателен для каждой волны):
  Цель:
  - снизить клиентскую нагрузку (перерисовки, лишние вычисления, тяжелые эффекты);
  - снизить потенциальную нагрузку на сервер (лишние запросы, дубли загрузок, неэффективные вызовы);
  - сократить количество файлов и строк там, где это возможно без потери UX;
  - удалить неиспользуемый/legacy код;
  - усилить reuse: сначала переиспользовать существующие паттерны/механики, и только при недостаточности выносить новый reusable.
  Контекст:
  - изменения выполнять по принципу `No-Regression Refactor` (без изменения бизнес-поведения, если не согласовано отдельно);
  - сначала инвентаризация и приоритизация, затем поэтапное внедрение с проверкой.
  План аудита:
  - инвентаризация hot-spots по запросам/эффектам/частым рендерам (`Users`, `Events`, `Activity`, `SidebarRight`, `Monitoring`);
  - поиск дублирующихся механик и кандидатов на объединение страниц/компонентов/хелперов;
  - поиск dead code (неиспользуемые компоненты, утилиты, типы, локальные обертки);
  - аудит сетевых паттернов: где можно уменьшить число запросов, убрать повторные загрузки, добавить локальный кеш/дедупликацию;
  - аудит UI-производительности: мемоизация тяжелых участков, контроль частоты обновлений и инкрементальных догрузок;
  - подготовка и внедрение приоритетного набора quick-wins;
  - синхронизация `PATTERNS.md` и `REUSE_INDEX.md` по итоговым решениям.
  Артефакты результата:
  - список изменений с оценкой эффекта и риска;
  - перечень удаленных/объединенных файлов;
  - перечень новых/усиленных reusable-паттернов;
  - проверка сборки и smoke-check ключевых экранов.

## Checklist (обновлено)
- [x] Проверка по stop-criteria перед стартом следующей волны.
- [x] Обновлены статусы `In Progress/Next/Done/Неактуально` без дублей.
- [ ] Для каждого закрытого пункта добавлен итог в формате `что было -> что стало -> как проверить -> вклад в цели`.
- [x] Обновлены `PATTERNS.md` и `REUSE_INDEX.md`, если появился новый reusable-контракт.
- [x] Добавлены file refs для новых/измененных пунктов.

## Stop-criteria review (2026-02-21)
- В блоке `Next`: оставались HIGH-задачи по frontend-аудиту и реюзу паттернов; остаток в основном `LOW`.
- На тот момент отдельно отмечался `MEDIUM` backend TTL-кэш monitoring-агрегатов; позже закрыт в backend wave 1.
- Дубли из старых проходов закрыты/синхронизированы, чтобы не раздувать бэклог.
- Следующий фокус: короткая финальная волна cleanup и переход к `Audit Final`.

## Stop-criteria review (2026-02-21, pass 2)
- Дополнительный техпроход по frontend выполнен (`pages/components/hooks`, эффекты/скролл/загрузчики, крупные файлы).
- Новых `HIGH` кандидатов не найдено.
- Новых `MEDIUM` кандидатов во frontend не найдено.
- Остаток по frontend: в основном `LOW` (dead exports/unused utils, `Timeline` windowing-проверка, cleanup кандидатов бейджей).
- Решение по stop-критериям: после закрытия текущего `In Progress` cleanup-пункта перейти к `Audit Final` по frontend.

## Audit Final (frontend, wave summary)
- Что было:
  - многократные дубли в загрузчиках, контекстах drawer, каталогах и polling-механике;
  - высокая вероятность лишних запросов/перерисовок в `Users/Events/Activity/SidebarRight/Monitoring`;
  - фрагментированный реюз и разрозненные локальные реализации.
- Что стало:
  - унифицированы ключевые механики (`catalog cache`, `user context loader`, `polling manager`, `push fallback`, `incremental pager`, `workspace infinite scroll`, `guarded async drawer state`);
  - тяжелые страницы переведены на route-level code-splitting;
  - снижены дубли сетевых вызовов и стабилизированы race/cancel сценарии;
  - `Next` очищен от дублей/закрытых пунктов, остаток в основном `LOW`.
- Как проверить:
  - TypeScript: `cd frontend && npx tsc -b` (должно проходить);
  - UI smoke:
    - `Пользователи`: поиск/скролл/select-all/bulk/drawer/deep-link;
    - `Системные администраторы`: скролл/select/bulk/drawer;
    - `Центр событий`: фильтры/скролл/context drawer/mark handled;
    - `Журнал действий`: режимы audit/login, фильтры, контекст записи;
    - `Мониторинг`: автообновление, фокус, таблица, экспорт.
- Вклад в цели:
  - снижение клиентской нагрузки (рендер/скролл/бандл): `high`;
  - снижение потенциальной серверной нагрузки (дедуп/кэш/cancel/push): `high`;
  - упрощение и снижение объема дублирующего кода через реюз: `high`;
  - остаточный ROI: преимущественно `LOW` (backend monitoring TTL cache закрыт в backend wave 1).

## Audit Final (backend, wave 1)
- Что было:
  - локальные full-scan/py-filtering пути в экспортных сборщиках;
  - list_users enrichment подтягивал большие массивы history/events;
  - синхронизация root-admin emails работала через полное чтение `users`.
- Что стало:
  - экспортные сборщики переиспользуют SQL query-builder'ы (`audit/login-history`);
  - enrichment для `list_users` переведен на subquery `max(id)` per user/email;
  - `sync_admin_users` ограничен релевантными пользователями (is_admin/target emails).
- Как проверить:
  - `/admin/login-history/export.csv|xlsx` и `/admin/audit/export.csv|xlsx` с фильтрами;
  - `/admin/users?status=all&page=1&page_size=20` (корректные pending/unread/last_login поля);
  - `/admin/settings/admin-emails` и `POST /admin/settings/admin-emails` (создание/промоут/демоут без full-scan).
- Вклад в цели:
  - снижение server CPU/IO и рисков таймаутов на больших таблицах (`medium`).

## Wave 1 ретроспектива (backend)
- Эффект:
  - снижение full-scan/py-filtering путей (`audit/login export`, `list_users`, `admin sync`, `admin_emails`) — `medium`.
- Риски:
  - риск логической ошибки в subquery `max(id)` при нестандартных ID-сценариях минимален (ID монотонный).
- Остаточный ROI:
  - `LOW` — дальнейшие оптимизации возможны, но без подтвержденных горячих мест.

## In Progress
- [ ] Нет активных пунктов.

## Next
- Статус: `HIGH re-audit` закрыт (`docs/audits/AUDIT_HIGH_REVALIDATION_2026-02-24.md`), активный фокус — intake-волна + `MEDIUM` реюз-волна.
- Примечание: staging-зависимые проверки помечаем как `release-gate` и выполняем ближе к релизу/деплою.
- Решение (2026-02-26): `release-gate` задачи сейчас сознательно `skip` до pre-release этапа; вернуться к ним при старте релизного чеклиста.

### Product backlog intake (2026-06-22)

Правило приоритизации: сначала подтвержденные дефекты и эксплуатационная устойчивость, затем resource/access guardrails и Scan & Diff data foundation; UI-обогащение строить только на надежных метриках/API.

- [ ] P0: Stabilization gate перед новой продуктовой волной.
  priority: HIGH
  value/cost: `high / low-medium`
  scope: `backend/app/api/profiles.py`, API response contract, integration tests, project/run UI smoke
  problem:
  - backend baseline: `/profiles/summary` возвращает raw list, а общий контракт и тест ожидают `{ok,data,request_id}`;
  - после создания проект иногда появляется в списках с задержкой;
  - запуск одного проекта визуально блокировал запуск остальных;
  - после завершения run UI мог не показывать собранные страницы/изменения;
  - поведение повторного создания одинакового scope (`domain/path`) не определено.
  goal:
  - вернуть полностью зеленый backend test baseline;
  - воспроизвести четыре project/run сценария и отделить cache/UI race от backend/job ошибок;
  - зафиксировать duplicate-scope policy до добавления DB constraint.
  verification:
  - backend tests: `0 failed`;
  - два проекта запускаются независимо с явным per-project lock;
  - новый проект сразу виден в Workspace/Sidebar;
  - FINISHED run показывает ненулевые pages при успешном crawl и явную причину при пустом результате;
  - duplicate scope возвращает согласованный conflict/warning flow.
  status note (2026-06-22, wave 1):
  - `/profiles/summary` возвращен к общему success envelope;
  - после создания проекта инвалидируется shared profiles cache;
  - добавлен per-project active-run guard (`409` только для того же проекта);
  - crawl с нулем собранных страниц переводит run в `FAILED` и возвращает диагностируемый `502`;
  - `pages_changed` учитывает URL, исчезнувшие после предыдущего run;
  - одинаковый canonical scope (`start_url + allowed domains`) отклоняется с `409`;
  - backend: `39 passed, 2 skipped`; frontend production build: passed;
  - remaining: visual UI smoke недоступен в текущей browser-сессии; выполнить вручную перед закрытием пункта.

- [ ] P0: Observer notification visibility parity (server-first RBAC filtering).
  priority: HIGH
  value/cost: `high / low-medium`
  scope: event feed API, `SidebarRight`, permission matrix, integration/UI tests
  problem: наблюдатель видит в sidebar события/действия, source которых ему недоступен; переход затем запрещен.
  goal: не выдавать пользователю недоступные event categories на backend; frontend дополнительно скрывает невозможные actions.
  verification: observer payload и UI не содержат закрытые категории; прямой URL по-прежнему защищен backend permission-check.
  status note (2026-06-22, wave 1):
  - backend `/events/center` подтвержденно возвращает viewer `403` (добавлен integration test);
  - `AppLayout` больше не монтирует Event Center для ролей без `events.view`, что исключает выдачу stale singleton snapshot после смены пользователя;
  - remaining: visual viewer smoke перед закрытием пункта.

- [x] P0: Friendly project/run failure UX.
  priority: HIGH
  value/cost: `high / medium`
  decision (2026-06-22): `accept`; реализовать до async reliability epic.
  scope:
  - duplicate canonical scope: вместо технического `409` показать существующий проект и действия `Открыть проект / Изменить адрес`; не объединять и не создавать точный дубликат автоматически;
  - active run: блокировать только текущий проект, показывать `Для этого проекта уже выполняется прогон. Другие проекты можно запускать независимо`;
  - failed run: сохранять стабильный failure code + безопасное сообщение, показывать `Повторить / Проверить адрес / Технические детали`; отдельную кнопку настроек добавить вместе с project settings, не вести пользователя в несуществующий раздел;
  - различать минимум `timeout`, `connect/dns`, `tls`, `http/no-html`, `unknown`; автоматические retries оставить Operations reliability epic;
  - viewer Event Center сейчас остается скрытым; вернуть компактные персональные уведомления только после subscriptions/outbox, без admin/audit categories.
  verification:
  - duplicate form сохраняет ввод и позволяет одним кликом открыть существующий project id;
  - active-run `409` отображается как локальный статус проекта, не глобальная блокировка;
  - FAILED reason сохраняется после reload и не раскрывает секреты/stack trace;
  - retry запускает новый run только после завершенного FAILED;
  - viewer layout не резервирует пустые 320px под Event Center.
  completed (2026-06-22):
  - API возвращает `profile_scope_conflict` с id/name существующего проекта; форма сохраняет введенный адрес и предлагает открыть проект либо исправить ввод;
  - `run_already_active` и UI поясняют per-project lock; другие проекты не блокируются;
  - в `runs` добавлены `failure_code/failure_message`, миграция применена; timeout/connect/TLS/HTTP/no-HTML/unknown имеют безопасные сообщения;
  - FAILED-card и история показывают причину; доступны retry, проверка адреса и технические детали;
  - backend `40 passed, 2 skipped`, frontend production build passed, `git diff --check` passed;
  - in-app visual smoke не выполнен: browser integration недоступна в текущей сессии; ручной smoke остается частью общего stabilization gate, а не блокером закрытия реализации.

- [ ] P0/P1 EPIC: Operations reliability + unattended recovery.
  priority: HIGH
  value/cost: `very-high / high`
  dependency: stabilization gate; async crawl/job boundary
  decision: `accept, staged`; не объединять blind restart и alerting в один механизм.
  stages:
  - вынести crawl из HTTP request в Celery worker; endpoint создает run и быстро возвращает `run_id`;
  - job lease/heartbeat, idempotency key, bounded retries с exponential backoff, timeout/cancel, stale RUNNING recovery;
  - per-project lock вместо глобальной блокировки, dead-letter/FAILED reason, безопасный resume/retry;
  - Docker healthchecks/restart policy и readiness для Postgres/Redis/backend/worker;
  - Telegram private digest только после появления достоверных health/job signals: периодический статус + немедленные alerts по деградации/FAILED/recovery.
  guardrails:
  - не перезапускать бесконечно; retry budget + cooldown;
  - не слать heartbeat-spam: digest interval, dedupe и state-transition alerts;
  - секреты Telegram хранить только в env/secret storage.
  verification: kill worker/network timeout/stale run сценарии восстанавливаются автоматически либо переходят в диагностируемый FAILED; Telegram получает deduplicated status/recovery message.

- [ ] P1 EPIC: Project governance — quotas, canonical scope, ownership.
  priority: HIGH
  value/cost: `high / high`
  dependency: согласовать multi-tenant модель до subscriptions и project-user UI
  decision: `accept`; объединяет ограничения проектов/доменов, duplicate policy, path-only crawl и project membership.
  scope:
  - configurable quota: max projects per actor/role, domains per project, pages/concurrency/storage budget;
  - canonical crawl scope: normalized `scheme + host + path_prefix`; режим `весь домен` или `только раздел`;
  - crawler не выходит выше/вне `path_prefix`; redirects проверяются повторно;
  - duplicate policy: одинаковый canonical scope запрещать или требовать явного варианта/контекста; одинаковый домен с разными path scope допустим;
  - project membership (`project_id <-> user_id`, role/permissions) и admin view «какие пользователи в каких проектах».
  verification: quota возвращает объяснимый `409/422`; path-scope тест не выпускает crawl наружу; canonical duplicates покрыты integration tests; project membership применяется server-side.

- [ ] P1: Project information architecture — `Основная | История | Настройки`.
  priority: MEDIUM-HIGH
  value/cost: `high / medium`
  dependency: надежные run/diff metrics
  decision: `accept with consolidation`; не добавлять еще одну History — текущую вкладку переиспользовать.
  target UX:
  - `Основная`: объединить текущие `Сводка + Структура`, это core workflow;
  - `История`: существующая история run/diff;
  - `Настройки`: rename/редактирование scope, расписание, resource limits/usage, состояние проекта, danger zone;
  - расписание открывать inline/modal из основной или настроек, отдельная постоянная вкладка не нужна;
  - rename — pencil action с небольшой modal/form, используя общий project update endpoint;
  - KPI считать per-domain + aggregate; не смешивать multi-domain значения в один неинтерпретируемый показатель.
  verification: core structure доступна без лишнего tab switch; destructive/settings actions отделены; multi-domain KPI объяснимы и имеют source period.

- [ ] P1: Workspace project rows/cards density redesign.
  priority: MEDIUM
  value/cost: `medium / low-medium`
  dependency: stabilization gate + reliable summary/diff metrics
  decision: `accept, but do not fill whitespace with decorative badges`.
  goal: сделать строки компактнее и показывать только decision-useful summary: domains, last run time/status, pages, added/changed/deleted/errors, next schedule; delete перенести в overflow/settings.
  verification: на desktop видно больше проектов без потери scan status; mobile/узкие окна не перегружены; данные совпадают с summary API.

- [x] P1: Friendly project search — normalization, keyboard-layout recovery and highlighting.
  priority: MEDIUM-HIGH
  value/cost: `high / low-medium`
  decision (2026-06-22): `accept`; сначала внедрить в два project-list call-site, без тяжелого fuzzy/semantic engine.
  scope: `WorkspaceHomePage`, `SidebarLeft`, shared `projectSearch` matcher/ranker, `HighlightedText`, frontend unit/UI tests.
  problem:
  - поиск сейчас использует локальный `toLowerCase().includes(...)` в двух местах и может расходиться;
  - требуется гарантировать поиск латинского project/domain (`books.toscrape.com`) обычным латинским запросом;
  - запрос, случайно введенный в неверной RU/EN раскладке, должен находить ожидаемое совпадение: `ищщл` -> `book`, а для русских имен — обратное преобразование EN -> RU;
  - совпавший фрагмент в имени/домене должен быть визуально выделен.
  implementation:
  - единая Unicode-normalization: `NFKC`, lowercase, `ё -> е`, trim/collapse whitespace; для URL/domain дополнительно учитывать вариант без scheme, `www.` и trailing slash;
  - генерировать не более трех query variants: исходный, RU -> EN keyboard map, EN -> RU keyboard map; применять layout-вариант только если он реально улучшил match;
  - ranking: exact > prefix/segment-prefix > substring > keyboard-layout match; при равенстве сохранять исходный порядок списка;
  - искать по `name`, `start_url`, `allowed_domains_csv`; показывать, в каком поле найдено совпадение, только если это не очевидно из заголовка/домена;
  - подсвечивать символы в исходной строке результата, соответствующие effective query; использовать `<mark>`/shared `HighlightedText` с доступным контрастом и без изменения регистра исходного текста;
  - не добавлять на этом этапе Levenshtein/fuzzy typo correction и semantic search: они дадут ложные совпадения и усложнят объяснимость; вернуться к typo-tolerance только по реальным поисковым логам/кейсам.
  verification:
  - `books`, `BOOKS`, `books.toscrape.com` и URL-варианты находят проект `books.toscrape.com`;
  - `ищщл` на русской раскладке находит `books.toscrape.com` и подсвечивает `book` в исходном названии;
  - обратный EN -> RU layout case покрыт тестом на русском имени проекта;
  - Workspace и Sidebar возвращают одинаковый набор и порядок; очистка query восстанавливает полный список;
  - пустые/пунктуационные запросы не создают шум, screen reader не читает подсветку дважды.
  completed (2026-06-22):
  - Что было: `WorkspaceHomePage` и `SidebarLeft` независимо фильтровали проекты через локальный `toLowerCase().includes(...)`, без исправления раскладки, ranking и подсветки;
  - Что стало: добавлен shared `projectSearch` с `NFKC`, `ё -> е`, URL/domain normalization, RU/EN keyboard recovery и стабильным ranking; оба списка используют один результат и порядок;
  - friendly UI: совпадения подсвечиваются в имени/доменах, неочевидное поле показывается отдельной строкой, для пустого результата есть понятный текст и действие `Очистить поиск`;
  - guardrail: punctuation-only query работает как no-op; fuzzy/Levenshtein намеренно не добавлялся;
  - Как проверить: в Workspace и Sidebar ввести `books`, `BOOKS`, полный URL, `ищщл`, EN->RU кейс и отсутствующий запрос; набор/порядок должны совпадать, очистка возвращает полный список;
  - automated verification: `npm run test:project-search` — `6 passed`; `npm run build` — passed; targeted eslint измененных файлов — passed; `git diff --check` — passed;
  - Вклад в цели: единый предсказуемый поиск и снижение UX-фрикции при неверной раскладке (`high`), устранение двух локальных реализаций (`medium`).

- [ ] P1/P2 EPIC: Page intelligence + subscriptions.
  priority: MEDIUM-HIGH
  value/cost: `very-high / high`
  dependency: `page_snapshot`, `page_diff_index`, links/resources index, project membership
  decision: `accept as core differentiator`, реализовывать вертикальными slices.
  slices:
  - клик по странице в Structure открывает context drawer, а не новую несвязанную поверхность;
  - drawer: snapshot/meta/status/link/resource context + действие `Подписаться`;
  - user profile: `Подписки` со страницами/правилами, каналами доставки и preview отчета;
  - link occurrence search: все страницы, где URL встречается, с source element/context;
  - link target fingerprint: фиксировать изменения содержимого по тому же URL (включая документы), не только изменение href;
  - compare UX: если previous/current идентичны, показывать одно окно + явный `Без изменений`; split view только при наличии diff.
  verification: subscription привязана к доступному project/page scope; изменение документа по стабильному URL создает событие; occurrence search возвращает source pages; unchanged compare не дублирует одинаковый контент.

- [ ] P1: Protected emergency root actor.
  priority: HIGH
  value/cost: `high / medium`
  decision: `accept with correction`; literal email/user hardcode в source отклонен.
  goal: config/secret-backed bootstrap root actor, скрытый из обычных user/root-admin lists, не удаляемый и не demote-имый через UI/API; действия остаются в audit log.
  guardrails: break-glass credentials rotation, production-only secret source, минимум повседневного использования.
  verification: actor нельзя удалить/demote через bulk/direct endpoints; он не отображается в обычном UI; audit сохраняет actor identity.

- [ ] P2: Dev-only role impersonation/debug view.
  priority: MEDIUM
  value/cost: `medium / medium`
  decision: `defer until server-side project RBAC is stable`.
  goal: только development/staging переключатель представления ролей с постоянным warning banner; production hard-disable; предпочтительно preview effective permissions без выпуска реального токена роли.
  verification: feature отсутствует в production bundle/config; действия в debug mode различимы в логах.

- [ ] P2: Telegram user notification channels and report preview.
  priority: MEDIUM
  value/cost: `medium-high / high`
  dependency: subscriptions + delivery preferences + notification outbox
  decision: `merge with Page intelligence subscriptions`; не смешивать с operational admin alerts.
  goal: пользовательские уведомления о subscribed page/project changes, выбор платформы/частоты и preview шаблона отчета.
  verification: delivery respects project membership and event preferences; retries/dedupe/outbox не создают повторные сообщения.

### Intake cuts / explicit deferrals

- Не добавлять новую вкладку `История`: она уже существует; требуется наполнить ее реальными diff-данными.
- Не сохранять отдельную вкладку `Расписание`, если настройка помещается в `Основная/Настройки`.
- Не заполнять широкие project cards множеством бейджей до появления надежных метрик; сначала compact information hierarchy.
- Не хардкодить супер-админа в исходниках; использовать secret/config-backed protected actor.
- Не расширять `HighlightedText` за пределы подтвержденных project-search/Structure call-sites и не выносить collapse-reset abstraction раньше core reliability/storage задач.

- [ ] MEDIUM: Staging-scale recheck счетчиков после count-less rollout (`events/users/activity`) (remaining: staging validation pass).
  priority: MEDIUM
  stage: release-gate
  scope: `frontend/src/hooks/useEventFeed.ts`, `frontend/src/hooks/useUsersList.ts`, `frontend/src/hooks/useActivityFeed.ts`, `frontend/src/hooks/useIncrementalPager.ts`, `backend/app/api/admin.py`, `backend/app/api/events.py`
  problem: UI-contract на клиенте уже усилен (`total` unknown until first total; no misleading `из 0`), но нужна валидация на staging-наборах.
  goal: подтвердить, что `Loaded N of M`/`hasMore` ведут себя корректно на объемных данных.
  verification: E2E smoke на `Events/Users/Activity` + сверка page1 total и append-поведения.

- [ ] MEDIUM: Users vs RootAdmins parity (remaining: data sanity recheck на staging-наборах).
  priority: MEDIUM
  stage: release-gate
  scope: `frontend/src/components/users/UserListSessionMeta.tsx`, `frontend/src/pages/UsersPage.tsx`, `frontend/src/pages/RootAdminsPage.tsx`, `backend/app/api/admin.py`
  problem: функциональный drift по `trusted_devices_count` закрыт; остается перепроверка адекватности самих значений на staging-sized данных.
  goal: подтвердить корректность device/session numbers на реалистичных объёмах.
  verification: выборка одинаковых email в `Users/RootAdmins` + сверка с `trusted_devices`/`login_history`.

- [ ] LOW (near prod): cleanup synthetic loadtest data from dev DB (prefer restore/reset), см. `docs/audits/AUDIT_DB_INDEX_2026-02-24.md`.
- [ ] MEDIUM: Scan & Diff MVP-1 feature design (data contract + project-page flow, no auth contexts yet).
  priority: MEDIUM
  scope: `docs/governance/FEATURE_CARD_SCAN_DIFF_MVP1_2026-02-26.md`, `docs/governance/IMPLEMENTATION_PLAN_SCAN_DIFF_MVP1_2026-02-26.md`, `frontend/src/pages/ProfileDashboardPage.tsx`, crawl/scan backend modules (next wave)
  problem: перед внедрением сканирования нужен согласованный contract хранения и отображения данных, чтобы позже добавить `Визуальный/Код` diff без переделок.
  goal: утвердить и внедрить MVP-1 сбор артефактов (HTML/DOM/screenshot/meta/links/resources) с подготовкой к diff.
  verification: пилот на `https://books.toscrape.com/`, smoke по сохранению артефактов и базовому индексу изменений.
  status note (2026-02-26):
  - feature-card подготовлен;
  - implementation-plan по этапам backend/frontend/валидации подготовлен.
  - `ProfileDashboardPage` обновлен до проектного skeleton под MVP-1 (`Проект`, `Скан и данные`, `Последний прогон`); блок `Сравнение` вынесен в отдельный следующий шаг (нужен отдельный экран/пространство).
  - в карточке проекта добавлены операционные блоки MVP-1: статус проекта, `KPI проекта`, `Последний прогон`, `Запустить прогон`/`Обновить статус`;
  - подключен run-level контракт текущего backend (`/runs/start/{profile_id}`, `/runs/by-profile/{profile_id}`) + мягкий poll каждые 5с только пока статус `RUNNING`;
  - по расписанию зафиксирован staged-подход: первый прогон вручную, автозапуск — отдельным шагом с рекомендацией непиковых окон.
  - добавлен summary endpoint `/profiles/summary` (без `N+1`) и подключен в `SidebarLeft`/`WorkspaceHomePage` для статуса проектов в списках.
  - статусные бейджи унифицированы через shared `ProjectRunBadge`; в `Workspace` добавлена мягкая status-hover подсветка строк без изменения базовой анимации `interactive-row`.
  - status-hover механика выровнена и для списка проектов в `SidebarLeft` (консистентность с `Workspace`);
  - в карточке проекта добавлен явный блок `Расписание` (MVP-1 placeholder + рекомендация непикового окна).
  - устранен краткий flicker breadcrumbs на переходе в проект: имя передается через route-state (`projectName`) и сразу используется в `AppLayout`.
  - active-строка проекта в `SidebarLeft` теперь в статусном акценте (не фиксированный синий), чтобы active/hover были консистентны.
  - в `Workspace` счетчик `прогонов` переведен в списочный бейдж (консистентнее с паттерном статусных чипов);
  - интенсивность `active` в `SidebarLeft` снижена (мягче относительно hover для warning/danger).
  - в карточку проекта добавлен footer-блок `Опасная зона` с действием `Удалить проект` через shared `ConfirmDialog`.
  - для проектных списков включен постоянный мягкий status-tint строки (до hover) + сохранен текущий hover-акцент;
  - `ProjectRunBadge`/`ProjectInfoBadge` выровнены по токенам размеров/паддингов чипов;
  - `ConfirmDialog` расширен `confirmVariant` для консистентных destructive-кнопок в модалках подтверждения.
  - мини-унификация modal-actions: в `RootAdmins` add-modal выровнены action-кнопки по размеру и тексту (`Добавить` вместо `OK`).
  - `Опасная зона` в карточке проекта переведена на `danger`-тон (мягкий красноватый акцент).
  - поиск проектов в `Workspace` и `SidebarLeft` расширен: ищет по имени, `start_url` и `allowed_domains_csv`.
  - добавлен `FormModal` и применен в `RootAdmins` add-modal для дальнейшей унификации form-модалок.
  - унифицированы destructive-confirm тексты/кнопки: `Отмена + Удалить` (danger) и контекстные title/description для `Users/RootAdmins/Projects`.
  - убран дублирующий заголовок `Проект` под breadcrumbs в карточке проекта.
  - паттерн card-delete переведен на footer-расположение (`CardFooterActions`) вместо верхнего action в проектных карточках.
  - breadcrumbs на `/profiles/:id` дополнительно стабилизированы: приоритет immediate-label из route-state для снижения flicker.
  - compact-иконки статуса проекта (sidebar/workspace) выровнены по фиксированной геометрии, чтобы `✓/!/•` были визуально консистентны.
  - header строки проекта в `SidebarLeft` переведен на grid (`title + badge`), чтобы отступ/позиция compact-бейджа не зависели от длины title.
  - в `runs.start` внедрен базовый multi-page crawl (BFS по внутренним ссылкам с доменными/extension-фильтрами и лимитом `max_pages`); `pages_total/pages_changed` теперь считаются по фактическому набору страниц.
  - добавлен легкий animated spinner для compact-бейджа статуса `RUNNING` (`CSS transform`, `prefers-reduced-motion` учтен).
  - подписи доменов в project-list (`Workspace`/`SidebarLeft`) переведены на формат `first-domain +N` через shared helper, чтобы корректно отражать multi-domain проекты.
  - в карточке проекта (`/profiles/:id`) домены возвращены к формату `1 тег = 1 домен`; `first-domain +N` оставлен только для list-контекста (`Workspace`/`SidebarLeft`).
  - блок `Расписание` в карточке проекта расширен до UI-прототипа (вкл/выкл, частота, окно запуска) с зафиксированным next-step: подключить сохранение через backend API.
  - `ProfileDashboardPage` переведен на вкладочный прототип `Сводка | Расписание | Структура | История` (без изменения release-логики).
  - внедрен `projectRunLiveStore`: optimistic `RUNNING` и финальный статус run синхронно обновляют `ProfileDashboardPage`, `SidebarLeft`, `WorkspaceHomePage` без отдельного polling в списках.
  - pilot: в `Структуре` добавлена подсветка совпадений поискового запроса в названиях узлов через shared `HighlightedText`.

- [ ] MEDIUM: Reuse extraction — collapse-reset windowed lazy loader audit (cross-page).
  priority: MEDIUM
  scope: `frontend/src/components/ui/ProjectStructureTree.tsx`, `frontend/src/hooks/*scroll*`, list/tree pages with collapsible branches
  problem: механика `expand -> lazy load -> collapse -> reset` полезна не только для `Структуры`, но пока реализована локально.
  goal: вынести общий reusable контракт и пройти аудит страниц, где есть раскрывающиеся длинные списки/ветки.
  verification: shared helper/hook внедрен минимум в 2 call-sites; локальные дубли удалены; UX без регрессии.

- [ ] MEDIUM: Reuse extraction — search match highlighting pattern + rollout audit.
  priority: MEDIUM
  dependency: сначала закрыть `Friendly project search` как первый production call-site; затем расширять на Users/RootAdmins/Activity.
  scope: `frontend/src/components/ui/HighlightedText.tsx`, searchable pages (`Workspace`, `Users`, `RootAdmins`, `Activity`, `Structure`)
  problem: подсветка совпадений нужна консистентно в поисковых списках, сейчас только pilot в `Структуре`.
  goal: утвердить reusable pattern подсветки match-фрагментов и применить по приоритетным search-контекстам.
  verification: общий компонент используется в нескольких search-экранах; контраст/читаемость проверены.
  context note:
  - при добавлении semantic/meta-поиска (`title/description/h1`) в `Структуре` подсвечивать match и в мета-строке;
  - мета-строка по умолчанию скрыта и показывается только когда совпадение найдено в метаданных (чтобы не перегружать список).
  - вкладка `Структура` переведена в explorer-tree (`домен -> каталоги -> страница`) с default-collapsed каталогами и `+/-` раскрытием веток;
  - для `Структуры` реализован lazy per-node (`20 + еще 20`) с auto-load по scroll-sentinel только для раскрытых веток; при повторном сворачивании ветка сбрасывается к стартовому окну;
  - в `Структуре` добавлен `ClearableInput` поиск по URL/пути; semantic-поиск по `title/description/h1` фиксируем следующим шагом после подключения snapshots/meta в runtime API;
  - статусы в `Структуре` переведены с текстовых badge на иконки через shared `StructureStatusIcon` (акцентные цвета) + добавлена legend-подсказка над деревом;
  - `runs.start` исправлен для multi-domain seed: обход стартует по всем доменам из `allowed_domains_csv` (не только первый `start_url`);
  - добавлен регрессионный тест `test_run_start_seeds_all_allowed_domains`.

- [ ] HIGH: Scan storage retention + permanent stats policy (project delete-safe).
  priority: HIGH
  stage: implementation
  scope: scan storage models/services, `backend/app/api/profiles.py` (delete flow), cleanup job, reporting/export layer (next step)
  problem: нужно удержать storage под контролем без потери ключевой аналитики импакта краулера на длинном горизонте.
  goal: хранить raw-артефакты только для `последний + предыдущий` run, при этом агрегированная статистика проекта сохраняется перманентно даже после удаления проекта.
  verification:
  - для проекта после `3+` завершенных run в raw-хранилище остаются только 2 последних набора артефактов;
  - `page_diff_index` корректно строится для пары `previous/latest`;
  - при удалении проекта статистические агрегаты не удаляются и доступны для будущего export-отчета (`месяц/квартал/полугодие/год`);
  - интеграционные тесты на delete-flow и retention-cleanup проходят.
  implementation notes:
  - удаление проекта выполнять только в одной транзакции (soft-delete/cleanup pointer updates/audit log);
  - фиксировать отдельный `project_deletion_log` (кто, когда, reason, затронутые run-id, retention summary);
  - cookie/token данные в snapshot-пайплайне не хранить в открытом виде (mask/hash + allowlist policy).
## Неактуально
- Нет неактуальных задач на текущий момент.

## Done
- [x] MEDIUM: Feature implementation intake — `Создать проект` (iteration 1: creation-only, no scan logic).
  status note (2026-02-26):
  - реализована форма создания проекта в `frontend/src/pages/ProfileNewPage.tsx`:
    - домены обязательны (`>=1`);
    - имя опционально;
    - если имя пустое — авто-имя из доменов;
  - добавлена нормализация/валидация доменов в `frontend/src/utils/projectDomains.ts` (ввод домена или URL -> нормализованный домен);
  - навигация по варианту A: CTA `+ Создать проект` в `SidebarLeft` и на странице `Рабочая область`;
  - `Рабочая область` обновлена в формат project-hub: список проектов + поиск + CTA создания + быстрые действия `Открыть/Удалить`;
  - RU-only терминология обновлена в релевантных entrypoint-элементах;
  - локальная проверка: `cd frontend && npm run -s build` -> success.

- [x] MEDIUM: Feature intake governance baseline (`docs/governance/FEATURE_INTAKE_PLAYBOOK.md`).
  status note (2026-02-26):
  - добавлен единый playbook для ввода новых фич (scope/reuse/matrix impact/PR checklist/validation/docs sync);
  - добавлены ссылки в `README.md`, `docs/README.md`, `PATTERNS.md`;
  - рабочий термин по новой сущности фиксируем как `Проект` (RU-only контекст).

- [x] MEDIUM: Time rendering unification (phase 2) — shared operational + dual local/UTC helpers.
  status note (2026-02-26):
  - в `frontend/src/utils/datetime.ts` добавлены unified helpers:
    - operational: `formatOperationalDateTime`, `formatOperationalTime`, `formatOperationalNow`;
    - dual-mode: `formatLocalAndUtc`, `formatApiDateTimeDual` (готово для scheduling-экранов);
  - `EventsPage`, `ActivityLogPage`, `MonitoringPage` переведены на shared operational helpers без изменения текущего UX-контракта;
  - локальная проверка: `cd frontend && npm run -s build` -> success.

- [x] LOW: Project tree simplification proposals (docs + frontend pages + backend entrypoint split).
  status note (2026-02-26):
  - `Phase 1` завершен: markdown-дерево реорганизовано (`docs/audits`, `docs/ui`, `docs/README.md`);
  - `Phase 2` завершен: `Monitoring/ActivityLog/RootAdmins` вынесены в `frontend/src/pages/{monitoring,activity,rootAdmins}/*` с re-export bridge-файлами;
  - `Phase 3` завершен: `main.py` декомпозирован на lifecycle/wiring/system-routes (`backend/app/core/app_lifecycle.py`, `backend/app/core/app_wiring.py`, `backend/app/api/system.py`) + выделенные middleware/handlers/metrics-export helpers;
  - backend smoke/integration: `docker compose exec backend ... pytest -q tests/test_api_integration.py` -> `20 passed`.

- [x] Cleanup: перенесены закрытые пункты из `Next` в `Done` (2026-02-26).
  status note: `Next` теперь содержит только открытые задачи.

- [x] HIGH: Monitoring accuracy re-audit (local compose + integration checks).
  priority: HIGH
  scope: `backend/tests/test_api_integration.py`, `docker-compose.yml`, `frontend/src/pages/MonitoringPage.tsx`, `frontend/src/pages/SettingsPage.tsx`
  problem: требовалось подтвердить, что `Settings` monitoring state не уходит в drift относительно history/threshold logic.
  goal: закрыть high-risk verification до следующей волны.
  verification:
  - `docker compose up -d --build` (stack with Prometheus in default mode);
  - `docker compose exec backend sh -lc "cd /app && PYTHONPATH=/app pytest -q tests/test_api_integration.py::test_settings_summary_endpoint_returns_domains tests/test_api_integration.py::test_settings_summary_monitoring_state_uses_history_thresholds"` -> `2 passed`;
  - orphan cleanup после удаления Grafana: `docker compose up -d --remove-orphans`.
  status note (2026-02-26):
  - HIGH-пункт закрыт локально; следующий шаг по monitoring accuracy — выборочный staging smoke только как контрольный дубль.

- [x] LOW: Tech-debt text fix — `METRIC_DESCRIPTIONS` readability/coverage update.
  priority: LOW
  scope: `backend/app/main.py`, `frontend/src/pages/MonitoringPage.tsx`
  problem: часть метрик показывалась как generic `Служебная метрика.` без явного описания.
  goal: зафиксировать читабельные описания для operational/result/anomaly счетчиков.
  verification: `/metrics` экспорт и таблица `Monitoring` показывают человекочитаемые descriptions.

- [x] LOW: Monitoring KPI simplification audit (`auth/admin` cards relevance).
  priority: LOW
  scope: `frontend/src/pages/MonitoringPage.tsx`
  problem: KPI-блок содержит `Старт авторизации`/`Admin действия`, ценность которых для оперативного default-view не всегда подтверждена.
  goal: принять решение по финальному default KPI-набору на основе фактических сценариев использования.
  verification: согласованный KPI-набор зафиксирован в UI и docs (`PATTERNS/REUSE`), без информационного шума.
  status note:
  - default-view закреплен как `HTTP/API` + `События`;
  - вторичные метрики вынесены в отдельный `Служебные` срез (без подсказок test-only формата).

- [x] LOW: Monitoring legacy metrics full cleanup audit (`auth/admin` backend counters/routes usage).
  priority: LOW
  scope: `backend/app/main.py`, `backend/app/core/metrics.py`, `backend/app/services/admin_monitoring.py`, `frontend/src/pages/MonitoringPage.tsx`
  problem: UI-вкладки `Авторизация/Админ-действия` уже убраны, но backend-метрики могут оставаться как исторический/служебный след.
  goal: подтвердить, что counters не нужны для alerting/аудита, и только после этого безопасно удалить или архивировать.
  verification: карта использования + решение (`keep`/`remove`) зафиксировано в docs; при `remove` — no-regression по monitoring summary/history/tests.
  status note:
  - decision log: `docs/audits/AUDIT_MONITORING_METRICS_DECISION_2026-02-26.md`;
  - removed: `auth_start_total`, `auth_verify_total`, `auth_request_access_total`, `admin_action_total`, `admin_bulk_total`, history-series `auth_starts/admin_actions`;
  - kept (explicit): `events_*`, `*_result_total`, `monitoring_anomaly_total`.

- [x] LOW: Button full-sweep mini-wave (cross-page matrix: used/missed/legacy + backlog).
  priority: LOW
  scope: `frontend/src/pages/*`, `frontend/src/components/*`, `frontend/src/components/ui/Button.tsx`, `docs/ui/UI_WAVE_*_MATRIX.md`, `docs/ui/UI_SINGLE_USE_BACKLOG.md`, `PATTERNS.md`, `REUSE_INDEX.md`
  context:
  - `Button Slice` уже выделен в wave-матрицах (`Users`, `RootAdmins`, `Events+Activity`, `Monitoring+Sidebar`);
  - нужен единый cross-page sweep, чтобы зафиксировать full coverage и остаточные legacy-кнопки в одном артефакте.
  problem: semantic-map зафиксирован частично по волнам, но отсутствует финальная сквозная матрица `used/missed/legacy` и приоритезированный backlog.
  goal: завершить soft-harmonization по кнопкам без изменения UX/бизнес-поведения, вынося только реально переиспользуемые кейсы (>=2 call-sites).
  verification:
  - собрана cross-page матрица по кнопкам (`used/missed/legacy`) с семантикой `primary/accent/secondary/ghost/danger/export/panel-toggle/inline-action`;
  - для каждой записи указан `Где увидеть в UI` (route + click path + expected visual behavior);
  - все кандидаты либо мигрированы в shared variants/wrappers, либо отмечены как explicit exception в `docs/ui/UI_SINGLE_USE_BACKLOG.md`;
  - legacy-страницы/локальные button-style блоки либо очищены в коде, либо добавлены в manual-cleanup очередь при невозможности авто-очистки;
  - `PATTERNS.md`/`REUSE_INDEX.md` синхронизированы по итоговому button-map.
  status note:
  - создан `docs/ui/UI_BUTTON_FULL_SWEEP_MATRIX.md` (full inventory + UI routes);
  - очищен button-legacy в коде: `AppLayout` breadcrumbs -> `InlineActionButton`, `ToastHost` close -> `IconGhostButton`;
  - residual mini-wave: `RootAdmins modal action row` вынесен в shared `ModalActionRow` (`ConfirmDialog` + `RootAdminsPage`);
  - `Monitoring quick-range preset group` оставлен в candidate до появления 2-го call-site;
  - manual-cleanup additions по этой волне: нет.

- [x] LOW: Button taxonomy map by UI context (`drawer/sidebar/modal/table/toolbar/inline`).
  priority: LOW
  scope: `frontend/src/components/ui/Button.tsx`, `frontend/src/components/ui/InlineActionButton.tsx`, `frontend/src/components/ui/*Button*.tsx`, `PATTERNS.md`, `REUSE_INDEX.md`
  problem: нужен единый каталог кнопок по контекстам UI, чтобы `InlineActionButton` и base/wrapper-кнопки были формально классифицированы, а не воспринимались как разрозненные исключения.
  goal: зафиксировать архитектурную схему `какая кнопка -> для какого действия/окна` (drawer, sidebar, modal, table, toolbar, inline), с правилами расширения.
  verification:
  - создана taxonomy-матрица кнопок по контекстам и семантике;
  - для каждого контекста указан canonical component (`Button` variant или wrapper);
  - `PATTERNS.md`/`REUSE_INDEX.md` синхронизированы с новым taxonomy-контрактом.
  status note:
  - создан `docs/ui/UI_BUTTON_TAXONOMY.md` (category/context/size/motion baseline);
  - согласован color-accent contract по категориям и unified motion;
  - зафиксирован size contract `outside=md`, `inside=compact(CardActionButton)`;
  - single-use pilots оформлены как паттерны: `RangePresetGroup` (`Monitoring`) и `ActionStateMarker` (`UserActionPanel`).

- [x] LOW: UI taxonomy matrix (cross-element) for new pages/windows bootstrap.
  priority: LOW
  scope: `frontend/src/components/ui/*`, `frontend/src/components/users/*`, `frontend/src/components/layout/*`, `docs/ui/UI_WAVE_*_MATRIX.md`, `PATTERNS.md`, `REUSE_INDEX.md`
  problem: кроме кнопок, нет единой карты UI-элементов по контекстам (`lists`, `drawers`, `default panels/cards`, `toolbars`, `filters`, `modals`, `status/meta text`), из-за чего на новых экранах растет риск локальных divergence.
  goal: зафиксировать общий taxonomy-контракт UI (какой canonical компонент/композиция используется в каждом контексте) и процесс расширения для новых страниц.
  verification:
  - собрана cross-element taxonomy-матрица с `used/candidate/single-use`;
  - для каждого контекста указан `где увидеть в UI` + canonical path в коде;
  - single-use элементы категоризированы и занесены в backlog с rule `extract only if >=2 call-sites`;
  - `PATTERNS.md`/`REUSE_INDEX.md` синхронизированы под новый taxonomy-contract.
  status note:
  - создан стартовый draft `docs/ui/UI_TAXONOMY_MATRIX.md` (v1) с context->canonical map и legend статусов;
  - selector mini-wave выполнен (`docs/ui/UI_SELECTOR_FULL_SWEEP_MATRIX.md`);
  - modal exception снят: add-modal `RootAdmins` переведен на shared `ModalShell` (2 call-sites вместе с `ConfirmDialog`);
  - контексты матрицы и exception-set согласованы;
  - финальный exception-set: только `Monitoring dense numeric controls`;
  - `ModalShell` утвержден как canonical modal container.

- [x] LOW: Selector UI unification (`UiSelect` full-sweep + hardcoded select cleanup).
  priority: LOW
  scope: `frontend/src/pages/*`, `frontend/src/components/*`, `frontend/src/components/ui/UiSelect.tsx`, `PATTERNS.md`, `REUSE_INDEX.md`
  problem: селекторы частично унифицированы, но остаются локальные вариации (разный shell/spacing/inline-styles), что дает визуальный drift.
  goal: привести селекторы к одному reusable-контракту (`UiSelect` + optional wrappers для dense/toolbar/modal contexts), убрать page-level hardcode.
  verification:
  - собрана матрица селекторов `used/missed/legacy` по всем страницам;
  - все возможные call-sites переведены на shared `UiSelect` (или documented exception);
  - для toolbar/modal/dense кейсов зафиксированы явные shared presets/wrappers;
  - `PATTERNS.md`/`REUSE_INDEX.md` синхронизированы по итоговому selector-map.
  status note:
  - создан `docs/ui/UI_SELECTOR_FULL_SWEEP_MATRIX.md` с cross-page inventory + `где увидеть в UI`;
  - full-scan показал: page-level raw `<select>` отсутствуют, все call-sites используют `UiSelect`;
  - wrappers `toolbar/modal/dense` оставлены в backlog как `candidate` до `>=2 call-sites` (без преждевременного дробления UI-слоя).

- [x] LOW: Button candidates backlog (post-sweep decisions).
  priority: LOW
  scope: `frontend/src/components/users/UserActionPanel.tsx`, `frontend/src/pages/RootAdminsPage.tsx`, `frontend/src/components/layout/SidebarRight.tsx`
  problem: после глобального button-sweep остались локальные кнопочные паттерны, которые можно вынести в общий слой.
  candidates:
  - reason preset pills (`ghost + borderRadius: 999`) в `UserActionPanel` и `RootAdminsPage` -> общий `ReasonPresetButton`;
  - compact dismiss icon button (`×`) в карточках сайдбара -> общий `IconGhostButton` (если решим канонизировать);
  goal: согласовать keep/migrate по кандидатам и закрыть остаточный локальный button-style код.
  verification: выбранные кандидаты переведены на shared wrappers, отклонения задокументированы как explicit exception.
  status note: закрыто в волне `Button candidates migration (reason presets + card icon dismiss)` ниже.

- [x] LOW: Button candidates migration (reason presets + card icon dismiss).
  Что было:
  - reason preset-кнопки и compact dismiss (`×`) повторяли локальные button-style литералы в нескольких файлах.
  Что стало:
  - добавлены shared wrappers `ReasonPresetButton` и `IconGhostButton`;
  - `UserActionPanel` + `RootAdminsPage` переведены на `ReasonPresetButton`;
  - карточки `SidebarRight` переведены на `IconGhostButton`;
  - alignment collapsed/expanded toggle в `SidebarRight` выровнен по одной горизонтальной базовой линии.
  file refs:
  - `frontend/src/components/ui/ReasonPresetButton.tsx`
  - `frontend/src/components/ui/IconGhostButton.tsx`
  - `frontend/src/components/users/UserActionPanel.tsx`
  - `frontend/src/pages/RootAdminsPage.tsx`
  - `frontend/src/components/layout/SidebarRight.tsx`
  - `PATTERNS.md`
  - `REUSE_INDEX.md`
  Как проверить:
  - `RootAdmins`/`Users` action panels: reason presets выглядят и ведут себя одинаково;
  - `SidebarRight`: `×` в карточках одинаковый compact style, toggle-кнопка на одной линии в collapsed/expanded header.
  Вклад в цели:
  - закрыт остаточный локальный button-style drift по ключевым кандидатам (`low/medium`).

- [x] LOW: Applicability hint block reuse (`Users` + `RootAdmins`).
  priority: LOW
  scope: `frontend/src/components/users/UserActionPanel.tsx`, `frontend/src/pages/RootAdminsPage.tsx`, `frontend/src/components/ui/ApplicabilityHint.tsx`, `REUSE_INDEX.md`
  problem: блоки `Применится к ... из ...` и связанные partial/none hints были локально сверстаны в нескольких местах.
  goal: вынести общий non-button UI паттерн для applicability-текста и исключить локальный style/text drift.
  verification:
  - добавлен shared `ApplicabilityHint`;
  - `UserActionPanel` и `RootAdmins` bulk block переведены на общий компонент;
  - `REUSE_INDEX.md` синхронизирован.

- [x] LOW: Inline info row reuse (`RootAdmins` + `Users drawer`).
  priority: LOW
  scope: `frontend/src/components/ui/InlineInfoRow.tsx`, `frontend/src/pages/RootAdminsPage.tsx`, `frontend/src/components/users/UserDetailsDrawer.tsx`, `REUSE_INDEX.md`
  problem: компактные technical/fallback строки (`label + value`) дублировались локальной разметкой.
  goal: унифицировать non-button UI паттерн для inline info строк без UX-изменений.
  verification:
  - добавлен shared `InlineInfoRow`;
  - `RootAdmins` trust fallback и `UserDetailsDrawer` JWT version line переведены на shared компонент;
  - `REUSE_INDEX.md` и wave-матрица синхронизированы.

- [x] LOW: UI scroll mechanics hardening wave (`DrawerBody` + `ScrollableRegion` + viewport-safe `ModalShell`).
  Что было:
  - часть scroll-контрактов в drawer/sidebars была page-level и дублировалась;
  - в длинных контекстах был риск недоступного контента на низких экранах.
  Что стало:
  - введен shared `DrawerBody` и применен в `Events/Activity/RootAdmins/UserDetails/SidebarRight`;
  - введен shared `ScrollableRegion` и применен в `SidebarLeft` (profiles list) и `SidebarRight` (notifications/actions columns);
  - `ModalShell` усилен viewport-safe контрактом (`maxHeight + overflowY:auto`).
  file refs:
  - `frontend/src/components/ui/DrawerBody.tsx`
  - `frontend/src/components/ui/ScrollableRegion.tsx`
  - `frontend/src/components/ui/ModalShell.tsx`
  - `frontend/src/pages/EventsPage.tsx`
  - `frontend/src/pages/ActivityLogPage.tsx`
  - `frontend/src/pages/RootAdminsPage.tsx`
  - `frontend/src/components/users/UserDetailsDrawer.tsx`
  - `frontend/src/components/layout/SidebarLeft.tsx`
  - `frontend/src/components/layout/SidebarRight.tsx`
  - `REUSE_INDEX.md`
  - `docs/ui/UI_TAXONOMY_MATRIX.md`
  Как проверить:
  - открыть длинный drawer-контент в `Events/Activity/RootAdmins/SidebarRight` и прокрутить до конца;
  - проверить прокрутку длинных списков в левом/правом сайдбарах;
  - открыть длинную модалку на низком экране и проверить внутренний скролл.
  Вклад в цели:
  - снижение риска UI-blocker регрессий на compact/низких экранах без изменения бизнес-логики (`medium` UX-stability).

- [x] MEDIUM (deferred): Execute safe cleanup pack from `docs/audits/AUDIT_DEAD_CODE_2026-02-24.md` (manual zone).
  status note (2026-02-26):
  - выполнен согласованный manual-cleanup: удалены `backend/app/api/compare.py`, `backend/app/api/pages.py`, `tools/fix_userspage.py`, `tools/fix_userspage_regex.py`, `MANUAL_CLEANUP.md`;
  - синхронизированы `docs/audits/AUDIT_DEAD_CODE_2026-02-24.md`, `docs/audits/AUDIT_DISCOVERY_2026-02-24.md`, `README.md`.

- [x] LOW: Docs encoding cleanup — mojibake в `docs/ui/UI_TAXONOMY_MATRIX.md`.
  status note (2026-02-26):
  - UTF-8 текст в `docs/ui/UI_TAXONOMY_MATRIX.md` восстановлен и читаем в IDE/CLI (legend/matrix/exceptions).

- [x] LOW: Reason UX text-token dedupe (RootAdmins fallback placeholders/hints).
  status note (2026-02-26):
  - в `reasonPolicy` добавлен shared helper `getAdminEmailsReasonInputMeta` + централизованный fallback-placeholder;
  - `RootAdminsPage` переведен на shared мета (`placeholder/hint/presets`) для add/remove/bulk/drawer без page-level fallback-строк.

- [x] LOW: Monitoring thresholds row adaptive fix (narrow-screen button clipping).
  Что было:
  - в `MonitoringPage` блок порогов использовал жесткую сетку `4 inputs + 2 buttons` в одной строке;
  - на узких экранах кнопки (`Сохранить`/`Рекомендованные`) сжимались и визуально обрезались.
  Что стало:
  - числовые поля порогов переведены на responsive-grid `repeat(auto-fit, minmax(140px, 1fr))`;
  - action-кнопки вынесены в отдельный flex-ряд с переносом (`wrap`) и правым выравниванием;
  - поведение/семантика кнопок и API сохранены (`No-Regression Refactor`).
  file refs:
  - `frontend/src/pages/MonitoringPage.tsx`
  Как проверить:
  - `Мониторинг -> Настроить пороги`: уменьшить ширину окна до компактной;
  - убедиться, что поля порогов перестраиваются по сетке, а кнопки остаются полностью видимыми и кликабельными;
  - нажать `Сохранить` и `Рекомендованные`, проверить сохранение и сброс порогов.
  - локальная техпроверка: `cd frontend && npm ci --include=dev && npm run build` (ожидаемо: `tsc -b` + `vite build` проходят).
  Вклад в цели:
  - снижение layout-regression на узких экранах без изменения бизнес-логики (`medium` UX-stability).
  status note (2026-02-26):
  - локальная build-валидация восстановлена в среде агента после установки devDependencies (`npm ci --include=dev`), `npm run build` проходит стабильно.

- [x] HIGH/MEDIUM verification pre-pass (local): monitoring counters + count-less totals + Users/RootAdmins parity.
  Что было:
  - после UI/реюз волн оставалась необходимость повторно подтвердить критичные контракты перед staging-pass.
  Что стало:
  - локально прогнаны целевые integration-тесты:
    - monitoring summary state по history/thresholds;
    - count-less contract (`include_total=false`) для users/audit/login;
    - parity `trusted_devices_count` между Users и RootAdmins.
  file refs:
  - `backend/tests/test_api_integration.py`
  Как проверить:
  - `docker compose run --rm backend sh -lc "cd /app && PYTHONPATH=/app pytest -q tests/test_api_integration.py::test_settings_summary_monitoring_state_uses_history_thresholds tests/test_api_integration.py::test_users_and_root_admins_pages_have_parity_for_trusted_devices_count tests/test_api_integration.py::test_users_list_include_total_false_returns_null_total tests/test_api_integration.py::test_audit_list_include_total_false_returns_null_total tests/test_api_integration.py::test_login_history_include_total_false_returns_null_total"`
  - ожидаемо: `5 passed`.
  Вклад в цели:
  - снижает риск регрессий перед ручным staging-pass (`high` по надежности pre-check).

- [x] MEDIUM: Accent CTA wave (`second primary`) for navigation/context zones.
  Что было:
  - не было отдельного “второго primary” для навигационно-контекстных CTA; кнопки в левом/правом сайдбарах использовали смешанные варианты.
  Что стало:
  - в `Button` добавлен `variant="accent"` с отдельным hover/active-контрактом;
  - `accent` затемнен до near-black базы (по визуальному ориентиру проекта), без голубого glow, с нейтральным hover/active;
  - левый сайдбар (`Рабочая область`/`Настройки`) переведен на `accent` и выровнен по размеру (`md`);
  - workspace/nav: back-button в workspace-header переведен на `accent` (`sm`);
  - drawer/context: CTA `Открыть...` в `Events/Activity/RootAdmins/SidebarRight` и quick-actions monitoring-контекста переведены на `accent`.
  - дополнительная калибровка контраста: для `primary` усилен и затем смягчен active/pressed; для `+ Создать проект` добавлен `active` по роуту `/profiles/new`.
  file refs:
  - `frontend/src/components/ui/Button.tsx`
  - `frontend/src/index.css`
  - `frontend/src/components/layout/AppLayout.tsx`
  - `frontend/src/components/layout/SidebarLeft.tsx`
  - `frontend/src/components/layout/SidebarRight.tsx`
  - `frontend/src/pages/EventsPage.tsx`
  - `frontend/src/pages/ActivityLogPage.tsx`
  - `frontend/src/pages/RootAdminsPage.tsx`
  - `frontend/src/components/monitoring/MonitoringContextCard.tsx`
  - `frontend/src/components/ui/ContextQuickActions.tsx`
  - `PATTERNS.md`
  - `REUSE_INDEX.md`
  Как проверить:
  - `SidebarLeft`: `Рабочая область` и `Настройки` визуально как единый второй primary, одинаковой высоты;
  - `SidebarRight`: `Показать все` и стрелки сворачивания/разворачивания в том же accent-контракте;
  - `Events/Activity/RootAdmins/SidebarRight` в дроуверах `Открыть...` CTA в accent-стиле;
  - `primary` action-кнопки (например `+ Создать проект`) остались action-primary, не смешаны с nav-accent.
  Вклад в цели:
  - консистентный визуальный контракт CTA по зонам интерфейса и снижение style-drift (`medium`).

- [x] LOW: Button semantics sweep (partial) — inline filter buttons dedupe in Activity.
  Что было:
  - в `ActivityLogPage` использовались raw `<button style={{ all: "unset" ... }}>` в нескольких местах для inline-фильтров.
  Что стало:
  - введен общий `InlineActionButton` и подключен во всех этих местах (`action/actor/target/result/ip/email`);
  - убран page-level дубликат inline-button стилей без изменения UX/поведения.
  file refs:
  - `frontend/src/components/ui/InlineActionButton.tsx`
  - `frontend/src/pages/ActivityLogPage.tsx`
  - `REUSE_INDEX.md`
  Как проверить:
  - `Журнал действий` (`Аудит` и `Входы`): клик по inline-подписям в карточке по-прежнему применяет соответствующий фильтр.
  Вклад в цели:
  - снижение style-drift и локальных дубликатов кнопочных стилей (`low`).

- [x] LOW: Card action buttons canonization (`Events` + `SidebarRight`).
  Что было:
  - требовалось зафиксировать единый визуальный канон кнопок в карточках событий, чтобы не допускать расхождения по страницам.
  Что стало:
  - подтвержден и закреплен реюз через общий `EventCardActions`;
  - карточечный button-style токен вынесен в `CardActionButton`, `EventCardActions` переведен на этот wrapper;
  - контракт канона добавлен в `PATTERNS.md`, индексирован в `REUSE_INDEX.md`.
  file refs:
  - `frontend/src/components/ui/EventCardActions.tsx`
  - `frontend/src/components/ui/CardActionButton.tsx`
  - `frontend/src/pages/EventsPage.tsx`
  - `frontend/src/components/layout/SidebarRight.tsx`
  - `PATTERNS.md`
  - `REUSE_INDEX.md`
  Как проверить:
  - `Центр событий` и правый сайдбар: в карточках событий ряд кнопок выглядит одинаково (`Открыть источник / Отметить... / Скрыть / Еще`), без визуального дрейфа.
  Вклад в цели:
  - усиление reuse-дисциплины и снижение риска локального style-drift (`low`).

- [x] LOW: SidebarRight collapse/expand toggle canonization + alignment fix.
  Что было:
  - кнопка сворачивания/разворачивания в `SidebarRight` имела локальный inline-style и визуально могла смещаться относительно заголовка.
  Что стало:
  - введен shared `SidebarToggleButton` (на базе `Button`) с фиксированной квадратной геометрией;
  - `SidebarRight` в collapsed/expanded состояниях переведен на этот reusable;
  - выравнивание в header-строке нормализовано (`minHeight` + line-height заголовка).
  file refs:
  - `frontend/src/components/ui/SidebarToggleButton.tsx`
  - `frontend/src/components/layout/SidebarRight.tsx`
  - `PATTERNS.md`
  - `REUSE_INDEX.md`
  Как проверить:
  - открыть правый сайдбар: в заголовке `Центр событий` кнопка toggle на одной горизонтальной линии с текстом;
  - свернуть/развернуть: в обоих состояниях размер/стиль toggle одинаковый.
  Вклад в цели:
  - убран layout-style drift для системной кнопки layout-контрола (`low`).

- [x] LOW: Button semantics (phase 3) — panel-toggle contrast + size consistency + tabs shell tokenization.
  Что было:
  - `panel-toggle` местами сливался с фоном карточек;
  - в `Monitoring` section-toggle кнопки были разного размера;
  - `SegmentedControl` shell-стили были inline, без явного общего визуального токена.
  Что стало:
  - усилен контраст `panel-toggle` (фон/бордер/active/hover);
  - в `Monitoring` section-level toggle-кнопки приведены к единому размеру (`md`);
  - `SegmentedControl` переведен на общий CSS shell-класс `.segmented-control` с токенами.
  file refs:
  - `frontend/src/components/ui/Button.tsx`
  - `frontend/src/pages/MonitoringPage.tsx`
  - `frontend/src/components/ui/SegmentedControl.tsx`
  - `frontend/src/index.css`
  - `PATTERNS.md`
  - `REUSE_INDEX.md`
  Как проверить:
  - `Мониторинг`: `Настроить пороги` и `Раскрыть/Скрыть` одинаковой высоты и не сливаются с фоном;
  - `Пользователи`: вкладки визуально прежние, без регрессии;
  - `Журнал действий`/`UserDetailsDrawer`: toggle-кнопки читаемые, с явным active-state.
  Вклад в цели:
  - снижение визуального дрейфа и рост консистентности UI-контракта (`medium`).

- [x] MEDIUM: Button semantics wave (phase 2) — semantic-map + `panel-toggle` rollout.
  Что было:
  - не было формального контракта, какой `Button variant` использовать по смыслу действия;
  - кнопки раскрытия блоков использовали mixed-стили (`ghost/default`) в разных страницах.
  Что стало:
  - зафиксирован semantic-map в `PATTERNS.md` (`primary/secondary/ghost/danger/export/panel-toggle`);
  - `REUSE_INDEX.md` обновлен по новым button presets;
  - добавлен `variant=\"panel-toggle\"` в `Button`;
  - rollout `panel-toggle` выполнен в ключевых collapsible местах: `Monitoring` (пороги, доп.блок), `Activity` (фильтры), `UserDetailsDrawer` (trusted devices).
  file refs:
  - `frontend/src/components/ui/Button.tsx`
  - `frontend/src/pages/MonitoringPage.tsx`
  - `frontend/src/pages/ActivityLogPage.tsx`
  - `frontend/src/components/users/UserDetailsDrawer.tsx`
  - `PATTERNS.md`
  - `REUSE_INDEX.md`
  Как проверить:
  - `Мониторинг`: `Настроить/Скрыть пороги` и `Раскрыть/Скрыть` выглядят единообразно и имеют active-state;
  - `Журнал действий`: `Фильтры/Скрыть фильтры` в том же visual-contract;
  - `UserDetailsDrawer`: `Показать все/Свернуть` у trusted devices в том же toggle-pattern.
  Вклад в цели:
  - снижение style-drift и усиление реюза UI-контракта (`medium`).

- [x] LOW: Export preset (phase 1) — progress bar inside button for key export screens.
  Что было:
  - прогресс экспорта отображался только текстом (`Экспорт ...%`), без единого визуального паттерна кнопки.
  Что стало:
  - в `Button` добавлен `variant=\"export\"` и `exportProgress` (полоска прогресса внутри кнопки);
  - подключено на ключевых экранах: `Monitoring` и `ActivityLog`.
  file refs:
  - `frontend/src/components/ui/Button.tsx`
  - `frontend/src/pages/MonitoringPage.tsx`
  - `frontend/src/pages/ActivityLogPage.tsx`
  Как проверить:
  - запустить экспорт на `Мониторинг` и `Журнал действий`: кнопка меняет текст на `Экспорт.../N%`, внутри видна заполняющаяся полоса, повторный клик заблокирован.
  Вклад в цели:
  - консистентный UX экспортов и лучшая видимость прогресса (`medium`).

- [x] LOW: Monitoring additional restore + list total reuse + mojibake cleanup.
  Что было:
  - блок `Дополнительно` на `Мониторинге` был не в ожидаемом формате (не collapsible под графиками);
  - строка `Всего пользователей` была не унифицирована между `Users` и `RootAdmins`;
  - в `Users` встречался битый fallback `вЂ—`.
  Что стало:
  - `Мониторинг`: `Дополнительно` возвращен сразу под графиками, скрыт по умолчанию, с кнопкой `Раскрыть/Скрыть`; внутри только `Топ endpoint'ов` (без `Grafana/Prometheus`);
  - введен reusable `ListTotalMeta`, подключен в `Users` и `RootAdmins`;
  - fallback исправлен на корректный `—`.
  file refs:
  - `frontend/src/pages/MonitoringPage.tsx`
  - `frontend/src/components/ui/ListTotalMeta.tsx`
  - `frontend/src/pages/UsersPage.tsx`
  - `frontend/src/pages/RootAdminsPage.tsx`
  Как проверить:
  - `Мониторинг`: ниже блока графиков есть `Дополнительно` с кнопкой `Раскрыть`, по умолчанию содержимое скрыто;
  - `Пользователи` и `Системные администраторы`: отображается одинаковая строка `Всего пользователей: N`;
  - при `total=null` отображается `—`, без кракозябр.
  Вклад в цели:
  - повышение консистентности/reuse (`medium`) и устранение текстового дефекта (`low`).

- [x] LOW: Backend audit for monitoring `auth/admin` metrics (decision: service-only for now).
  Что было:
  - после удаления UI-вкладок `Авторизация/Админ-действия` требовалось понять, можно ли безопасно удалить backend-метрики `auth_*` / `admin_*`.
  Что стало:
  - проведен аудит использования:
    - counters инкрементятся в auth/admin потоках (`auth_start_total`, `auth_verify_total`, `auth_request_access_total`, `admin_bulk_total`, `admin_action_total`);
    - в `monitoring history` они еще публикуются как серии (`auth_starts`, `admin_actions`);
    - в текущем UI/summary-контракте они больше не используются как primary signal.
  решение:
  - оставить метрики как `service-only` (диагностика/операционный срез), не удалять без отдельной migration-волны.
  file refs:
  - `backend/app/api/auth.py`
  - `backend/app/services/admin_actions.py`
  - `backend/app/services/admin_monitoring.py`
  - `backend/app/main.py`
  Как проверить:
  - `GET /metrics` содержит `auth_*` и `admin_*` counters;
  - `GET /admin/monitoring/history` содержит `auth_starts`/`admin_actions`, при этом UI не выводит их как отдельные вкладки.
  Вклад в цели:
  - снижен риск преждевременного удаления наблюдаемости; зафиксировано целевое состояние (`low`).

- [x] MEDIUM: Users + Monitoring UX cleanup wave (totals + monitoring table simplification).
  Что было:
  - в верхней части списка `Users` не было явного `всего пользователей`;
  - в `Monitoring` оставались малополезные вкладки `Авторизация/Админ-действия` и избыточный блок `Дополнительно` (`Топ endpoint` + `Grafana/Prometheus`);
  - в таблице метрик не было hover-подсветки строк.
  Что стало:
  - `Users`: добавлен счетчик `Всего пользователей: N` в шапке списка;
  - `Monitoring`: удалены вкладки `Авторизация/Админ-действия` из фильтров таблицы, удален весь блок `Дополнительно`;
  - `Monitoring`: добавлена hover-подсветка строк таблицы метрик (`table-hover-row`).
  file refs:
  - `frontend/src/pages/UsersPage.tsx`
  - `frontend/src/pages/MonitoringPage.tsx`
  - `frontend/src/index.css`
  Как проверить:
  - `Пользователи`: вверху списка видно `Всего пользователей: ...`;
  - `Мониторинг -> Таблица метрик`: в сегменте нет `Авторизация/Админ-действия`, строки таблицы подсвечиваются при hover;
  - `Мониторинг`: блока `Дополнительно` с `Топ endpoint`/`Grafana` больше нет.
  Вклад в цели:
  - снижение UI-шума и улучшение читаемости рабочих таблиц (`medium`).

- [x] MEDIUM: Panel variants reuse wave via existing UI layer (`Card`/`HintCard`) with animation preservation.
  Что было:
  - часть panel-стилей и interactive-поведения задавалась page-level inline, с риском style drift.
  Что стало:
  - `Card` расширен до `variant` (`default/hint/warning`) и `interactive` (переиспользует текущий `.interactive-row` анимационный контракт);
  - `HintCard` переведен на `Card variant=\"hint\"`;
  - миграция применена в `MonitoringPage`, `SettingsPage`, `SidebarRight`, `EventsPage`, `ActivityLogPage`, `SelectableListRow` (для `Users/RootAdmins`) без изменения UX-анимаций.
  file refs:
  - `frontend/src/components/ui/Card.tsx`
  - `frontend/src/components/ui/HintCard.tsx`
  - `frontend/src/components/ui/SelectableListRow.tsx`
  - `frontend/src/pages/MonitoringPage.tsx`
  - `frontend/src/pages/SettingsPage.tsx`
  - `frontend/src/components/layout/SidebarRight.tsx`
  - `frontend/src/pages/EventsPage.tsx`
  - `frontend/src/pages/ActivityLogPage.tsx`
  Как проверить:
  - hover/focus анимации карточек в `Settings`, `Monitoring`, `Sidebar`, `Events`, `Activity`, `Users`, `RootAdmins` визуально совпадают с прежним поведением;
  - `Статус`-блок в `Monitoring` выглядит как default panel; hint-блоки остаются accent.
  Вклад в цели:
  - снижение дублирования panel-стилей и контроль регрессий анимаций на всех ключевых страницах (`medium`).

- [x] LOW: Sidebar Event Center header compact timestamp polish.
  Что было:
  - в правом сайдбаре строка `обновлено: ...` занимала лишнее место и визуально перегружала компактный header.
  Что стало:
  - label переведен в компактный icon+time формат (`↻ HH:mm:ss (UTC±offset)`), полный текст вынесен в `title`.
  file refs:
  - `frontend/src/components/layout/SidebarRight.tsx`
  Как проверить:
  - `Правый сайдбар -> Центр событий`: справа от `Показать все` отображается иконка обновления и время; при hover у времени показывается полный `Обновлено: ...`.
  Вклад в цели:
  - снижение визуального шума в компактном контейнере (`low`).

- [x] MEDIUM: Monitoring chart UX polish (crosshair-X/Y, stable hover row, status/threshold clarity, zoom toggle).
  Что было:
  - hover показывал только вертикальную линию; подпись времени/значения вызывала layout shift;
  - zoom требовал попадания на линию и отдельную кнопку сброса;
  - статус/последнее обновление и пороги были недостаточно самообъяснимыми.
  Что стало:
  - `InteractiveLineChart`: добавлены горизонтальная линия crosshair, постоянная info-row фиксированной высоты, более явная подпись (`Значение метрики + Время`);
  - zoom переключается кликом по всей карточке графика (`on/off`), отдельная кнопка сброса убрана;
  - summary-блок: `Статус: ...`, отдельная строка `Последнее обновление`, ясный блок `За интервал`;
  - пороги: добавлены пояснения значений и кнопка `Рекомендованные`;
  - подсказка порогов оформлена в консистентном `role-hint` стиле через shared `HintCard` + `HintTable` (единая синяя карточка + табличный формат);
  - внешний статус-контейнер возвращен к default card-стилю (как у соседних дефолтных блоков; accent только внутри подсказки);
  - разделитель в chart-meta переведен на shared bullet token (`UI_BULLET`) вместо локального `|`.
  file refs:
  - `frontend/src/components/monitoring/InteractiveLineChart.tsx`
  - `frontend/src/pages/MonitoringPage.tsx`
  - `frontend/src/components/ui/HintCard.tsx`
  - `frontend/src/components/ui/HintTable.tsx`
  - `frontend/src/components/ui/RolePermissionsHint.tsx`
  Как проверить:
  - `Мониторинг`: hover по линии показывает перекрестие X/Y, info-row не прыгает;
  - клик по карточке `HTTP запросы/HTTP ошибки` включает/выключает увеличенный график;
  - в summary видно `Статус: ...`, `Последнее обновление`, а в порогах есть пояснения и reset к рекомендованным.
  Вклад в цели:
  - повышение читаемости без визуального шума и снижение UX-фрикции (`high`).

- [x] MEDIUM: Monitoring charts rework (interactive hover/crosshair + zoom + drawer parity).
  Что было:
  - `MonitoringPage` рендерил точки графиков постоянно (визуальный шум), служебный чекбокс и лишние графики перегружали блок;
  - `MonitoringContextCard` имел отдельный локальный SVG-паттерн, отличающийся от мониторинга.
  Что стало:
  - вынесен reusable `InteractiveLineChart` (hover по всей области графика по X-координате, vertical+horizontal crosshair, point reveal on hover, time ticks);
  - в `MonitoringPage` убран `Показать служебные` и связанный график `Центр событий`, исторический блок оставлен на `HTTP запросы/HTTP ошибки`;
  - добавлен zoom flow: клик по mini-chart открывает увеличенный график, повторный клик по enlarged-области закрывает zoom (без отдельной кнопки/подписи);
  - `MonitoringContextCard` переведен на тот же reusable chart, добавлены marker линии для момента события и локальных всплесков.
  file refs:
  - `frontend/src/components/monitoring/InteractiveLineChart.tsx`
  - `frontend/src/pages/MonitoringPage.tsx`
  - `frontend/src/components/monitoring/MonitoringContextCard.tsx`
  - `frontend/src/utils/monitoringContext.ts`
  Как проверить:
  - `Мониторинг -> Исторические графики`: видны только `HTTP запросы/HTTP ошибки`; чекбокса `Показать служебные` нет;
  - на графике hover срабатывает по всей области: появляется crosshair + активная точка на линии + timestamp/value;
  - клик по mini-chart открывает увеличенный график, повторный клик по enlarged-графику возвращает обычный режим;
  - в `Events/Sidebar -> контекст monitoring` график отображается тем же визуальным паттерном, есть маркер события и маркеры всплесков.
  Вклад в цели:
  - снижение UI-шума и унификация chart-паттерна между модулями (`high`).

- [x] HIGH/MEDIUM pre-staging gate: automated checks for monitoring summary, count-less totals, Users/RootAdmins parity.
  Что было:
  - для части критичных пунктов wave оставалась только ручная/staging-валидация, без явного automated pre-check в интеграционных тестах.
  Что стало:
  - добавлены integration checks:
    - `/admin/settings/summary` корректно вычисляет monitoring-state по thresholds/history;
    - `/admin/users`, `/admin/audit`, `/admin/login-history` при `include_total=false` возвращают `total=null` (count-less contract);
    - parity: `trusted_devices_count` совпадает между `Users` и `RootAdmins` для одного email.
  file refs:
  - `backend/tests/test_api_integration.py`
  Как проверить:
  - `docker compose run --rm backend sh -lc 'cd /app && PYTHONPATH=/app pytest -q tests/test_api_integration.py::test_settings_summary_monitoring_state_uses_history_thresholds tests/test_api_integration.py::test_users_list_include_total_false_returns_null_total tests/test_api_integration.py::test_audit_list_include_total_false_returns_null_total tests/test_api_integration.py::test_login_history_include_total_false_returns_null_total tests/test_api_integration.py::test_users_and_root_admins_pages_have_parity_for_trusted_devices_count'`
  - ожидаемо: `5 passed`.
  Вклад в цели:
  - снизили риск регрессий перед staging-pass для HIGH/MEDIUM пунктов (`high` по надежности верификации).

- [x] MEDIUM: Cross-module feature extension pattern (Monitoring/Events/Audit/RBAC).
  Что было:
  - extension-playbook был размыт: часть правил была в TODO/чат-контексте, без явной связки `PATTERNS <-> REUSE`.
  Что стало:
  - зафиксирован единый checklist расширения фич (`extend > create`, source-of-truth first, thin route/page, обязательный verification/docs sync);
  - правила связаны с реальными reusable-точками и file refs.
  file refs:
  - `PATTERNS.md`
  - `REUSE_INDEX.md`
  - `TODO.md`
  Как проверить:
  - открыть `PATTERNS.md` раздел `Cross-Module Feature Extension Checklist`;
  - убедиться, что `REUSE_INDEX.md` содержит `Reuse Gate (cross-module)` и активные reuse targets;
  - в `TODO.md` пункт перенесен из `Next` в `Done`.
  Вклад в цели:
  - снижение вероятности дублирования и drift при следующих фичах (`medium`).

- [x] MEDIUM: Export URL builder parity (`ActivityLog` + `Monitoring`).
  Что было:
  - `ActivityLogPage` использовал shared `exportUrl`, а `MonitoringPage` собирал export URL inline.
  Что стало:
  - `MonitoringPage` переведен на shared builder `buildMonitoringExportRequest` в `utils/exportUrl.ts`.
  file refs:
  - `frontend/src/utils/exportUrl.ts`
  - `frontend/src/pages/MonitoringPage.tsx`
  - `REUSE_INDEX.md`
  Как проверить:
  - `Мониторинг -> Экспорт (CSV/XLSX)`: скачивание проходит как раньше, без навигации и с progress;
  - `Журнал действий -> Экспорт`: без изменений, URL формируется через тот же shared-модуль.
  Вклад в цели:
  - снижение риска расхождения параметров export между страницами (`medium`).

- [x] MEDIUM: Count-less pager contract hardening (phase 1) for `events/users/activity/root-admins`.
  Что было:
  - после `reset` pager сбрасывал `total` в `0`, из-за чего на UI мог кратковременно появляться misleading статус `Загружено N из 0`.
  Что стало:
  - `useIncrementalPager` хранит `total` как `number | null`; до получения первого `include_total` показывается `—`;
  - страницы `Events/Users/Activity/RootAdmins` обновлены на безопасный рендер `total ?? "—"`;
  - fallback `hasMore` для count-less append сохранен (full page => potential next page).
  file refs:
  - `frontend/src/hooks/useIncrementalPager.ts`
  - `frontend/src/pages/EventsPage.tsx`
  - `frontend/src/pages/UsersPage.tsx`
  - `frontend/src/pages/ActivityLogPage.tsx`
  - `frontend/src/pages/RootAdminsPage.tsx`
  Как проверить:
  - открыть `Events`, `Users`, `Activity`, `RootAdmins` и выполнить reset/search/tab switch;
  - не должно быть статуса `из 0` до ответа page1; вместо этого `из —`;
  - после page1 total появляется корректно, на append total не скачет.
  Вклад в цели:
  - снижение UI-drift и ложных состояний счетчиков при count-less пагинации (`medium`).

- [x] MEDIUM: Shared `search -> resetAndLoad` helper + применение в `Users/RootAdmins/Activity`.
  Что было:
  - reset/search flow был реализован локально на каждой странице (`Activity` с собственным `requestAnimationFrame`, `Users/RootAdmins` с прямыми `resetAndLoad`), что повышало риск drift.
  Что стало:
  - добавлен общий hook `useScheduledResetAndLoad` (dedupe + cleanup `requestAnimationFrame`);
  - подключен в `ActivityLogPage`, `UsersPage`, `RootAdminsPage`.
  file refs:
  - `frontend/src/hooks/useScheduledResetAndLoad.ts`
  - `frontend/src/pages/ActivityLogPage.tsx`
  - `frontend/src/pages/UsersPage.tsx`
  - `frontend/src/pages/RootAdminsPage.tsx`
  Как проверить:
  - `Users`: поиск + Enter/кнопка `Найти` + переключение табов работают как раньше;
  - `RootAdmins`: поиск и обновление списка без регрессии;
  - `Activity`: смена режима/фильтров не вызывает дублей загрузки.
  Вклад в цели:
  - снижение дублирования и унификация search-reset механики (`medium`).

- [x] MEDIUM: Settings optimization audit — removed extra unread fetch path, unified to single summary API.
  Что было:
  - `SettingsPage` кроме summary дергал отдельный unread-путь (`eventCenterUnreadStore` fallback -> `/events/center`), что увеличивало число запросов и давало дополнительный источник drift.
  Что стало:
  - `/admin/settings/summary` расширен полем `events_unread`;
  - `SettingsPage` на первичной загрузке берет все бейджи из одного summary payload;
  - realtime обновление unread через `subscribeEventCenterUnread` оставлено (без лишнего initial fallback fetch).
  file refs:
  - `backend/app/api/admin.py`
  - `frontend/src/utils/settingsStatsCache.ts`
  - `frontend/src/pages/SettingsPage.tsx`
  - `backend/tests/test_api_integration.py`
  Как проверить:
  - открыть `Настройки` с чистого состояния: бейджи `Пользователи/Сисадмины/Центр событий/Журнал/Мониторинг` приходят после одного summary-запроса;
  - в Network не должно быть отдельного initial `/events/center` из `SettingsPage`;
  - unread в `Центр событий` продолжает обновляться при входящих событиях через shared subscription.
  Вклад в цели:
  - снижение лишней серверной нагрузки и уменьшение числа источников расхождений (`medium/high`).

- [x] HIGH: Monitoring accuracy re-audit (phase 2) — Settings counters переведены на единый backend summary source-of-truth.
  Что было:
  - `SettingsPage` собирала бейджи из набора независимых endpoint-ов, что усложняло консистентность и диагностику расхождений.
  Что стало:
  - добавлен backend агрегат `GET /admin/settings/summary` (pending/root-admins/audit24h/monitoring + `source_ok`);
  - frontend использует единый cached reader `getSettingsSummaryCached(...)` и заполняет карточки из одного payload.
  file refs:
  - `backend/app/api/admin.py`
  - `frontend/src/utils/settingsStatsCache.ts`
  - `frontend/src/pages/SettingsPage.tsx`
  - `backend/tests/test_api_integration.py`
  Как проверить:
  - открыть `Настройки` и сверить бейджи с источниками (`/users`, `/root-admins`, `/logs`, `/monitoring`);
  - `source_ok=false` должен включать индикатор деградации на соответствующей карточке.
  Вклад в цели:
  - единый source-of-truth counters и снижение риска drift (`high`).

- [x] MEDIUM: Data sanity endpoint for exact counts (`trusted_devices/login_history`) without rounding.
  Что было:
  - staging-сверка `Users/RootAdmins` требовала ручного SQL-сопоставления и не имела быстрого API-пути контроля.
  Что стало:
  - добавлен endpoint `GET /admin/users/{user_id}/sanity` (точные числа):
    - snapshot (`trusted_devices_count`, `last_activity_at`, `last_ip`, `last_user_agent`);
    - источники (`trusted_devices_active/revoked/total`, `latest_login*`, `login_history_total`);
    - флаги совпадения `matches` + итог `ok`.
  file refs:
  - `backend/app/api/admin.py`
  - `backend/tests/test_api_integration.py`
  Как проверить:
  - вызвать `GET /admin/users/{id}/sanity` под `users.manage`;
  - проверить `sources.trusted_devices_active_count` и `snapshot.trusted_devices_count` (должны совпадать);
  - `ok=true` означает консистентность snapshot с источниками.
  Вклад в цели:
  - ускорение и стандартизация staging sanity-check для паритета `Users/RootAdmins` (`medium`).

- [x] MEDIUM: Users vs RootAdmins parity (phase 1) — синхронизирован счетчик устройств в списках.
  Что было:
  - в `RootAdmins` для `db_profiles` backend вырезал `trusted_devices_count`, из-за чего строка сессии показывала `устройств: -`, когда в `Users` было число.
  Что стало:
  - `trusted_devices_count` больше не удаляется в `/admin/settings/admin-emails`, обе страницы используют единый источник профиля.
  file refs:
  - `backend/app/api/admin.py`
  - `frontend/src/pages/UsersPage.tsx`
  - `frontend/src/pages/RootAdminsPage.tsx`
  Как проверить:
  - открыть одного и того же email в `Пользователи` и `Системные администраторы`;
  - строка `сессия/IP/UA/устройств` должна совпадать по числу устройств.
  Вклад в цели:
  - устранение визуального drift между страницами (`medium`).

- [x] UX cleanup: SidebarRight header — удалена лишняя кнопка `Обновить`, оставлен авто-refresh + timestamp.
  Что было:
  - ручная кнопка `Обновить` дублировала автообновление и создавала ощущение "не работает".
  Что стало:
  - хедер правого сайдбара упрощен: `Показать все` + `обновлено: HH:mm:ss (UTC±offset)`.
  file refs:
  - `frontend/src/components/layout/SidebarRight.tsx`
  Как проверить:
  - `SidebarRight` в развёрнутом состоянии: кнопки `Обновить` нет; timestamp обновляется при приходе нового снапшота.
  Вклад в цели:
  - снижение шумного UX и повышение предсказуемости поведения (`low/medium`).

- [x] HIGH: Monitoring accuracy re-audit (phase 1.5) — Settings counters при входе обновляются из источника (force refresh).
  Что стало:
  - `SettingsPage` запрашивает актуальные значения (`pending/root-admins/audit24h/monitoring`) с `force=true` на маунте вместо возможного stale-кэша.
  file refs:
  - `frontend/src/pages/SettingsPage.tsx`
  - `frontend/src/utils/settingsStatsCache.ts`
  Как проверить:
  - после действий в `Users/RootAdmins/Logs` перейти в `Settings` и сверить бейджи со страницами-источниками;
  - значения должны обновляться без ожидания TTL.
  Вклад в цели:
  - снижение риска расхождений counters в навигационном хабе (`high`).

- [x] MEDIUM: Time rendering unification (phase 1) — local user time + explicit UTC offset with seconds.
  Что было:
  - время рендерилось разрозненно (`toLocale*`, локальные форматы), без единого контракта по offset/секундам;
  - в `Monitoring` hover показывал `local + UTC`, что перегружало operational контекст.
  Что стало:
  - `frontend/src/utils/datetime.ts` стал source-of-truth для time-formatting:
    - `formatApiDateTime` -> `DD.MM.YYYY, HH:mm:ss (UTC±offset)`;
    - `formatApiTime` -> `HH:mm:ss (UTC±offset)`;
    - shared helpers для offset/UTC-safe formatting;
  - `frontend/src/utils/eventTime.ts` переведен на shared datetime-helpers;
  - `MonitoringPage` chart hover и timeline labels переведены на local+offset;
  - `SidebarRight` `lastUpdated` переведен на единый формат.
  file refs:
  - `frontend/src/utils/datetime.ts`
  - `frontend/src/utils/eventTime.ts`
  - `frontend/src/pages/MonitoringPage.tsx`
  - `frontend/src/components/layout/SidebarRight.tsx`
  Как проверить:
  - `Events/Activity/Users/RootAdmins/Sidebar/Drawers` — timestamps показываются с секундами и `UTC±offset`;
  - `Monitoring` hover по точкам графика — local timestamp + value (без отдельной UTC-строки).
  Вклад в цели:
  - консистентность time-UX и снижение format drift (`medium`).

- [x] HIGH: Monitoring accuracy re-audit (phase 1) — единый подсчет HTTP ошибок через middleware.
  Что было:
  - `http_errors_total` инкрементировался только в exception handlers, из-за чего часть 404/4xx могла не попадать в метрику консистентно.
  Что стало:
  - `backend/app/main.py`: `http_errors_total` считается в `request_context_middleware` по фактическому `response.status_code >= 400` (с labels `method/path/status`);
  - дублирующие инкременты убраны из exception handlers;
  - добавлен интеграционный тест на 404-path в метриках.
  file refs:
  - `backend/app/main.py`
  - `backend/tests/test_api_integration.py`
  Как проверить:
  - API: запросить несуществующий route (`/__missing_route__`), затем `GET /metrics`;
  - в `counters.http_errors_total` должна быть строка с `path=/__missing_route__` и `status=404`.
  Вклад в цели:
  - повышение точности monitoring error-метрик и снижение drift (`high`).

- [x] HIGH: Export UX hardening (phase 1) — pending/progress без навигационного сдвига.
  Что было:
  - при больших экспортов UI долго не показывал явный прогресс выполнения.
  Что стало:
  - добавлен общий download-progress контракт: `apiDownloadWithProgress` + `downloadBlobFile(..., { onProgress })`;
  - `ActivityLogPage` и `MonitoringPage` показывают `Экспорт.../N%` и блокируют повторный клик до завершения;
  - файл продолжает скачиваться через blob/objectURL без перехода текущей вкладки.
  file refs:
  - `frontend/src/api/client.ts`
  - `frontend/src/utils/download.ts`
  - `frontend/src/pages/ActivityLogPage.tsx`
  - `frontend/src/pages/MonitoringPage.tsx`
  Как проверить:
  - UI: `Журнал действий -> Экспорт` и `Мониторинг -> Таблица метрик -> Экспорт`;
  - во время выгрузки кнопка показывает прогресс и недоступна для повторного старта;
  - после завершения страница/контекст не сбрасываются.
  Вклад в цели:
  - устойчивость и предсказуемость UX экспорта (`high`).

- [x] MEDIUM: Reusable export URL builder (`ActivityLog` audit/login modes).
  Что было:
  - `ActivityLogPage` собирал export URL inline, риск расхождения параметров между режимами.
  Что стало:
  - вынесен единый builder `buildActivityExportRequest(...)` в shared util.
  file refs:
  - `frontend/src/utils/exportUrl.ts`
  - `frontend/src/pages/ActivityLogPage.tsx`
  Как проверить:
  - в режимах `audit/login` экспорт отражает текущие фильтры (`date/action/email/ip/result/source/security_only`).
  Вклад в цели:
  - уменьшение дублирования и риска drift (`medium`).

- [x] MEDIUM: Monitoring chart UX (hover tooltip с timestamp/value).
  Что было:
  - mini/big графики показывали линию без point-in-time tooltip по точкам.
  Что стало:
  - на точки добавлены hover tooltips с локальным временем, UTC и значением.
  file refs:
  - `frontend/src/pages/MonitoringPage.tsx`
  Как проверить:
  - UI: `Мониторинг -> Исторические графики`, навести на точку линии;
  - tooltip показывает время (local + UTC) и value.
  Вклад в цели:
  - улучшение читаемости и диагностики графиков (`medium`).

- [x] HIGH: Dynamic reason-policy source-of-truth для `/admin/settings/admin-emails` + унификация frontend-consumers.
  Что было:
  - для `/admin/settings/admin-emails` причина была жестко обязательной (`require_reason`) вне критичности сценария;
  - в UI `RootAdminsPage` обязательность reason была локально захардкожена.
  Что стало:
  - добавлен backend policy-модуль `backend/app/services/reason_policy.py` (`remove_other_root_admin=required`, `add_root_admin=recommended`, `no_effect=optional`);
  - endpoint `GET/POST /admin/settings/admin-emails` отдает/использует `reason_policy` и `reason_mode`;
  - `RootAdminsPage` и `UserActionPanel` используют единый frontend module `frontend/src/utils/reasonPolicy.ts`.
  file refs:
  - `backend/app/services/reason_policy.py`
  - `backend/app/api/admin.py`
  - `frontend/src/utils/reasonPolicy.ts`
  - `frontend/src/pages/RootAdminsPage.tsx`
  - `frontend/src/components/users/UserActionPanel.tsx`
  - `backend/tests/test_api_integration.py`
  Как проверить:
  - UI: `RootAdminsPage` -> `Добавить` (reason не блокирует), `Удалить другого root-admin` (reason обязателен).
  - API: `POST /admin/settings/admin-emails` с удалением другого root-admin и пустым reason -> `400`, no-op с пустым reason -> `200`.
  Вклад в цели:
  - консистентность бизнес-правил между backend/frontend (`high`);
  - снижение риска дрейфа reason-логики на новых сценариях (`high`).

- [x] Policy tuning (follow-up): обновлена матрица критичности reason.
  Что стало:
  - bulk `set_role` переведен в `recommended` (reason больше не блокирует выполнение);
  - `/admin/settings/admin-emails`: `add_root_admin` переведен в `required`,
    `remove_other_root_admin` остается `required`, `no_effect` остается `optional`.
  file refs:
  - `backend/app/services/admin_bulk.py`
  - `backend/app/services/reason_policy.py`
  - `backend/tests/test_api_integration.py`
  - `backend/tests/test_admin_bulk.py`

- [x] Reuse hardcode cleanup (RootAdmins reason UX): локальные presets/hints удалены, UI переведен на backend reason-policy contract.
  Что было:
  - `RootAdminsPage` хранил `ADD_REASON_PRESETS/REMOVE_REASON_PRESETS` и локальные подсказки в коде страницы.
  Что стало:
  - presets/hints приходят из backend `reason_policy` (`modes + presets + hints`);
  - фронт использует общий merge/placeholder/validation контракт из `frontend/src/utils/reasonPolicy.ts`.
  file refs:
  - `backend/app/services/reason_policy.py`
  - `backend/app/api/admin.py`
  - `frontend/src/utils/reasonPolicy.ts`
  - `frontend/src/pages/RootAdminsPage.tsx`

- [x] Reuse cleanup (Users applicability): удалена локальная логика применимости действий на frontend.
  Что было:
  - `UsersPage` содержал объемный локальный `isActionApplicable(...)`, дублирующий backend-правила ролей/инвариантов.
  Что стало:
  - `/admin/users/actions/available` расширен матрицей применимости (`applicable_by_action`, `applicable_by_user`);
  - `UsersPage` использует backend-матрицу для счетчиков/фильтра применимых `user_ids` в bulk.
  file refs:
  - `backend/app/api/admin.py`
  - `frontend/src/pages/UsersPage.tsx`
  - `frontend/src/types/catalog.ts`

- [x] HIGH (split-plan phase 1): вынесены reusable serializers из `admin.py`.
  Что было:
  - сериализация login-history/audit была встроена в `backend/app/api/admin.py`.
  Что стало:
  - сериализация вынесена в `backend/app/services/admin_serializers.py`;
  - `admin.py` использует общий сервис (`serialize_*`, `iter_serialized_*`) без изменения контрактов API.
  file refs:
  - `backend/app/services/admin_serializers.py`
  - `backend/app/api/admin.py`
  Как проверить:
  - `python -c "from pathlib import Path; compile(Path(''backend/app/api/admin.py'').read_text(encoding=''utf-8''), ''backend/app/api/admin.py'', ''exec''); compile(Path(''backend/app/services/admin_serializers.py'').read_text(encoding=''utf-8''), ''backend/app/services/admin_serializers.py'', ''exec'')"`
  - `GET /admin/audit?page=1&page_size=50`, `GET /admin/login-history?page=1&page_size=50` — формат ответа без изменений.
  Вклад в цели:
  - снижение связности монолитного файла и подготовка к следующей фазе декомпозиции (`medium`).

- [x] MEDIUM: export safety — убран `query.all()` в export-path для audit/login-history + потоковый CSV.
  Что было:
  - export-пути собирали результаты через `query.all()` и затем формировали in-memory коллекции.
  Что стало:
  - export-сборщики в `admin.py` переведены на итеративный режим (`query.yield_per(1000)` + генераторы сериализации);
  - `csv_attachment_response` переведен на `StreamingResponse` с chunk-генерацией.
  file refs:
  - `backend/app/api/admin.py`
  - `backend/app/core/export_utils.py`
  - `backend/app/services/admin_serializers.py`
  Как проверить:
  - `python -c "from pathlib import Path; files=[''backend/app/api/admin.py'',''backend/app/core/export_utils.py'',''backend/app/services/admin_serializers.py'']; [compile(Path(f).read_text(encoding=''utf-8''), f, ''exec'') for f in files]"`
  - `GET /admin/login-history/export.csv|xlsx`, `GET /admin/audit/export.csv|xlsx` с фильтрами — файлы скачиваются и содержимое корректно.
  Вклад в цели:
  - снижение пикового потребления памяти на export-path и устойчивость при росте выборок (`medium`).
- [x] Discovery-wave 1 (system-wide, static profiling pass): зафиксированы hot paths, structural и dead-code кандидаты.
  Что было:
  - не было формализованной карты hotspot-участков по backend/frontend для следующей волны.
  Что стало:
  - зафиксированы основные hotspots:
    - `backend/app/api/admin.py` (крупный монолит ~1790 строк, смешение query/serialization/handlers);
    - export-пути используют `query.all()` (`backend/app/api/admin.py`), что несет риск роста памяти на больших выборках;
    - event feed использует `count + page query` с join/state-фильтрами (`backend/app/api/events.py`);
    - обнаружены пустые backend-модули `backend/app/api/compare.py`, `backend/app/api/pages.py`;
    - обнаружен mojibake в `METRIC_DESCRIPTIONS` в `backend/app/main.py`.
  file refs:
  - `backend/app/api/admin.py`
  - `backend/app/api/events.py`
  - `backend/app/main.py`
  - `backend/app/api/compare.py`
  - `backend/app/api/pages.py`
  - `frontend/src/pages/ActivityLogPage.tsx`
  - `frontend/src/pages/UsersPage.tsx`
  - `frontend/src/pages/MonitoringPage.tsx`
  - `frontend/src/pages/RootAdminsPage.tsx`
  Как проверить:
  - `Backend -> admin/events -> endpoints`: проверить SQL-paths (`count/offset/limit/join`) по указанным file refs;
  - `Backend -> api`: убедиться, что `compare.py/pages.py` пустые и не подключены в `backend/app/main.py`;
  - `Backend -> main`: проверить текст `METRIC_DESCRIPTIONS` на корректную UTF-8 читаемость.
  Вклад в цели:
  - снижение неопределенности и переход к data-driven приоритизации следующей волны (`high`).
- [x] System-wide audit (backend, wave 2): индексы для `events` (feed/read).
  Что было:
  - `only_unread` и `read-all` опирались на join/filter без специализированных индексов.
  Что стало:
  - добавлены индексы на `event_user_state(user_id,is_read,event_id)` и `event_feed(channel,severity,created_at,id)`.
  file refs:
  - `backend/alembic/versions/a3c1e8f4b7d2_add_event_feed_indexes.py`
  Как проверить:
  - `alembic upgrade head`;
  - `GET /events/feed?only_unread=true`, `POST /events/read-all` по каналам.
  Вклад в цели:
  - ускорение фильтрации/джойнов и снижение нагрузки (`medium`).
- [x] System-wide audit (backend, wave 2): SQL‑фильтр `only_unread` в `/events/feed`.
  Что было:
  - фильтрация `only_unread` выполнялась в Python после выборки page.
  Что стало:
  - фильтр unread/dismissed/own-actor перенесен в SQL (left join `EventUserState`).
  file refs:
  - `backend/app/api/events.py`
  Как проверить:
  - `GET /events/feed?only_unread=true` (канал all/notification/action);
  - убедиться, что собственные действия не попадают в unread.
  Вклад в цели:
  - снижение лишнего трафика и Python‑фильтрации (`medium`).
- [x] System-wide audit (backend, wave 2): оптимизация `/events/read-all` без full-scan.
  Что было:
  - `/events/read-all` выбирал все `EventFeed.id` и обновлял через Python loop.
  Что стало:
  - batch‑update через SQL по `EventUserState` + join к `EventFeed` с фильтрами.
  file refs:
  - `backend/app/api/events.py`
  Как проверить:
  - `POST /events/read-all` с `channel=all/notification/action` и `security_only=true/false`;
  - проверка количества `updated` и состояния `EventUserState.is_read`.
  Вклад в цели:
  - снижение нагрузки при больших лентах (`medium`).
- [x] System-wide audit (backend, wave 1): оптимизация `get_admin_emails_settings` без лишних full-row загрузок.
  Что было:
  - выборка админов выполнялась через `db.query(User).all()` (полные модели).
  - lookup профилей выполнялся без нормализации email к lower-case (риск несовпадений).
  Что стало:
  - список админов берется как `User.email` (легкий запрос);
  - профили по runtime email ищутся через `func.lower(User.email)` и нормализованный список.
  file refs:
  - `backend/app/api/admin.py`
  Как проверить:
  - `GET /admin/settings/admin-emails` (paged и non-paged режимы);
  - корректность `db_admins` и `db_profiles` для mixed-case email.
  Вклад в цели:
  - снижение server CPU/IO и уменьшение объема загружаемых моделей (`low/medium`).
- [x] System-wide audit (backend, wave 1): оптимизация `sync_admin_users` (без full scan таблицы пользователей).
  Что было:
  - `sync_admin_users` загружал все записи `User`, независимо от размера таблицы.
  Что стало:
  - запрос ограничен `is_admin=True` + `email in target`, т.е. только релевантные кандидаты;
  - логика promote/demote сохранена.
  file refs:
  - `backend/app/core/admin_sync.py`
  Как проверить:
  - `POST /admin/settings/admin-emails` с добавлением/удалением email;
  - в БД корректно промоутятся/демоутятся только нужные пользователи.
  Вклад в цели:
  - снижение server CPU/IO при больших таблицах пользователей (`medium`).
- [x] System-wide audit (backend, wave 1): оптимизация `list_users` enrichment-пайплайна (без full-scan).
  Что было:
  - `list_users` тянул все `LoginHistory/AuthAttempt/EventFeed` для выбранных пользователей и фильтровал в Python;
  - риск масштабирования по количеству событий/логов при больших базах.
  Что стало:
  - latest `LoginHistory` берется через subquery `max(id)` per user;
  - `request_access` берется через subquery `max(id)` per email;
  - `pending events` берутся через subquery `max(id)` per target_user_id, state-check только для этих событий.
  file refs:
  - `backend/app/api/admin.py`
  Как проверить:
  - `GET /admin/users?status=all&page=1&page_size=20&q=`: `pending_requested_at`/`pending_unread`/`pending_event_id` остаются корректны;
  - сортировка и фильтры пользователей не меняются;
  - функциональный smoke в UI: `Пользователи -> вкладки -> поиск -> drawer`.
  Вклад в цели:
  - снижение server CPU/IO на больших логах (`medium`);
  - снижение риска таймаутов/нагрузки (`medium`).
- [x] System-wide audit (backend, wave 1): reuse-first cleanup экспортных сборщиков аудита/входов.
  Что было:
  - `_collect_audit_items` делал full-scan `AdminAuditLog + User` и фильтровал в Python;
  - `_collect_login_history_items` дублировал SQL-фильтры отдельно от page-list path.
  Что стало:
  - оба экспортных сборщика переведены на существующие query-builder'ы (`_build_audit_rows_query`, `_build_login_history_query`);
  - добавлен единый `_serialize_audit_rows`, устранено дублирование с list-endpoint.
  file refs:
  - `backend/app/api/admin.py`
  Как проверить:
  - `GET /admin/audit/export.csv|xlsx` и `GET /admin/login-history/export.csv|xlsx` с фильтрами (`action/email/ip/date/sort_dir`) — результаты и сортировка корректны;
  - списковые endpoints `/admin/audit`, `/admin/login-history` продолжают возвращать прежний формат.
  Вклад в цели:
  - меньше дублей и ниже риск расхождения логики list/export (`medium`);
  - снижение server CPU/памяти за счет SQL-фильтрации вместо Python full-scan (`medium`).
- [x] PRIORITY (backend audit, wave 1): завершен пакет оптимизаций `reuse-first, no-regression`.
  Что было:
  - ряд backend-эндпоинтов имел тяжелые list/экспортные и snapshot-пайплайны с дублями и лишней стоимостью.
  Что стало:
  - `HIGH`: SQL-pagination/filtering для `audit/login-history` list endpoints;
  - `HIGH`: server-side pagination для `profiles/runs` (с backward-compatible режимом без `page`);
  - `MEDIUM`: общий export-helper для CSV/XLSX (`admin + metrics`);
  - `MEDIUM`: общий builder user-profile snapshot + bulk trust/login summary для `list_users` и `admin-emails`.
  file refs:
  - `backend/app/api/admin.py`
  - `backend/app/api/profiles.py`
  - `backend/app/api/runs.py`
  - `backend/app/main.py`
  - `backend/app/core/paging.py`
  - `backend/app/core/export_utils.py`
  - `backend/app/core/monitoring_cache.py`
  Как проверить:
  - `GET /admin/audit?page=1&page_size=50` и `GET /admin/login-history?page=1&page_size=50`;
  - `GET /profiles` (старый режим) и `GET /profiles?page=1&page_size=20` (paged режим);
  - `GET /runs/by-profile/{id}` и `GET /runs/by-profile/{id}?page=1&page_size=20`;
  - экспорты: `audit/login/metrics` в `csv/xlsx` с прежними именами файлов;
  - мониторинг-кэш: `history/focus/metrics` + `force_refresh` + invalidation после `POST /admin/monitoring/settings`.
  Вклад в цели:
  - снижение server-side нагрузки на массовых выборках/агрегатах (`high`);
  - сокращение дублей и усиление backend-reuse (`high`);
  - снижение риска расхождения поведения между похожими endpoint-пайплайнами (`medium`).

- [x] HIGH (backend audit wave 1): server-side pagination для `profiles`/`runs` (backward-compatible).
  Что было:
  - `/profiles`, `/runs/by-profile/{id}`, `/runs/{id}/pages` возвращали только полные списки.
  Что стало:
  - добавлен reusable pagination helper `backend/app/core/paging.py`;
  - в `profiles/runs` введены `page/page_size`:
    - если `page` не передан, поведение прежнее (возвращается список);
    - если `page` передан, возвращается paged-объект (`items/total/page/page_size`).
  file refs:
  - `backend/app/core/paging.py`
  - `backend/app/api/profiles.py`
  - `backend/app/api/runs.py`
  Как проверить:
  - `GET /profiles` -> прежний формат list;
  - `GET /profiles?page=1&page_size=20` -> paged-формат;
  - `GET /runs/by-profile/{id}` и `GET /runs/{id}/pages` аналогично для list/paged режимов.
  Вклад в цели:
  - снижение нагрузки/объема ответов на длинных списках (`high`);
  - reuse через единый paging helper (`high`).

- [x] MEDIUM (backend audit wave 1): общий export-helper для CSV/XLSX.
  Что было:
  - дублирующиеся блоки `csv.writer`/`Workbook` в `admin.py` и `main.py`.
  Что стало:
  - вынесен reusable `backend/app/core/export_utils.py`:
    - `csv_attachment_response`
    - `xlsx_attachment_response`
  - мигрированы экспорт-эндпоинты `audit/login/metrics` на общий helper.
  file refs:
  - `backend/app/core/export_utils.py`
  - `backend/app/api/admin.py`
  - `backend/app/main.py`
  Как проверить:
  - `GET /admin/audit/export.csv|xlsx`
  - `GET /admin/login-history/export.csv|xlsx`
  - `GET /metrics/export.csv|xlsx`
    -> файлы скачиваются с прежними именами/колонками.
  Вклад в цели:
  - упрощение и сокращение дублей в backend (`high`);
  - снижение риска расхождения форматов экспортов (`medium`).

- [x] HIGH (backend audit wave 1): `audit/login-history` list endpoints переведены с full-load на SQL-пагинацию/фильтрацию.
  Что было:
  - `list_audit_logs` и `list_login_history` сначала собирали полные списки (`.all()`), затем резали page на Python-уровне.
  Что стало:
  - `list_audit_logs` использует SQL query-builder с joins/filters/sort/count/offset-limit;
  - `list_login_history` использует SQL query-builder с filters/sort/count/offset-limit;
  - добавлены reusable helpers в `admin.py`:
    - `_build_login_history_query`
    - `_serialize_login_history_rows`
    - `_build_audit_rows_query`
  file refs:
  - `backend/app/api/admin.py`
  Как проверить:
  - API:
    1. `GET /admin/audit?page=1&page_size=50` и `page=2` -> корректные `items/total/page/page_size`.
    2. `GET /admin/audit?actor_email=...&target_email=...&action=...` -> фильтры применяются на SQL-уровне.
    3. `GET /admin/login-history?page=1&page_size=50&email=...&ip=...` -> корректная пагинация/фильтры.
    4. Сравнить формат ответа с предыдущим фронтовым контрактом (без регрессии полей).
  Вклад в цели:
  - снижение server CPU/RAM на больших выборках (`high`);
  - снижение latency list-endpoints при росте данных (`high`);
  - усиление reuse внутри backend через единые query builders (`medium`).
- [x] MEDIUM: backend TTL-кэш для monitoring-агрегатов (`/metrics`, `/admin/monitoring/history`, `/admin/monitoring/history/focus`) + invalidation-правила.
  Что было:
  - каждый запрос к monitoring history/focus дергал Prometheus range-запросы без повторного использования результатов;
  - `/metrics` отдавал live-snapshot на каждый запрос без короткого сглаживания.
  Что стало:
  - добавлен общий backend TTL-кэш `backend/app/core/monitoring_cache.py`;
  - подключено к `backend/app/api/admin.py`:
    - кэш для `/admin/monitoring/history` и `/admin/monitoring/history/focus`,
    - `force_refresh` для явного обхода кэша,
    - кэширование и success, и error-пейлоадов (для защиты от fail-storm);
  - `POST /admin/monitoring/settings` теперь инвалидирует кэш префикса `monitoring:*`;
  - подключено к `backend/app/main.py`:
    - короткий TTL-кэш для `/metrics` snapshot.
  Как проверить:
  - API:
    1. `GET /admin/monitoring/history?range_minutes=60&step_seconds=30` два раза подряд -> второй ответ должен идти без повторного тяжелого окна (визуально быстрее/меньше нагрузки на Prometheus).
    2. `GET /admin/monitoring/history?range_minutes=60&step_seconds=30&force_refresh=true` -> принудительный обход кэша.
    3. `POST /admin/monitoring/settings` -> затем `GET /admin/monitoring/history...` должен пересобраться после инвалидции.
    4. `GET /metrics` несколько раз подряд -> данные консистентны в пределах короткого TTL.
  Вклад в цели:
  - снижение потенциальной серверной нагрузки при конкурентных открытиях Monitoring (`high`);
  - снижение burst-нагрузки на Prometheus (`high`);
  - упрощение повторного использования кэш-политики через единый модуль (`medium`).
- [x] Event Center transport guard: при недоступном SSE (`/events/center/stream` 404) push отключается на сессию после нескольких неуспешных открытий, дальше работает polling без reconnect-спама.
  file refs:
  - `frontend/src/utils/eventCenterPollingManager.ts`
- [x] LOW: целевая ревизия dead exports/unused utility-функций (phase 2).
  Что было:
  - в `In Progress` висел cleanup-кандидат по dead exports/unused utils после предыдущих anti-dup шагов.
  Что стало:
  - выполнен дополнительный проход по `frontend/src/utils/*` и `frontend/src/hooks/*` + проверка мест с `eslint-disable react-hooks/exhaustive-deps`;
  - новых безопасных dead exports/unused utils для удаления не найдено (после уже выполненных cleanup-итераций);
  - зафиксирован второй stop-review в `TODO` и подтвержден переход к `Audit Final`.
  Как проверить:
  - `TODO.md`: блок `Stop-criteria review (2026-02-21, pass 2)` и закрытый пункт в `Done`;
  - `frontend/src/pages/ActivityLogPage.tsx`, `frontend/src/pages/UsersPage.tsx`, `frontend/src/pages/RootAdminsPage.tsx`:
    проверки на `eslint-disable` оставлены без изменения поведения (No-Regression).
  Вклад в цели:
  - снижение риска регрессий за счет отказа от небезопасных “удалений ради удаления” (`high`);
  - сокращение технического долга по бэклогу за счет закрытия дублирующего cleanup-пункта (`medium`).
- [x] MEDIUM: anti-dup — unified helper для async drawer-context lifecycle (`requestSeq + loading + error + stale-guard`):
  - добавлен reusable-hook `frontend/src/hooks/useGuardedAsyncState.ts`;
  - внедрен в `EventsPage`, `ActivityLogPage`, `SidebarRight`;
  - убраны локальные ad-hoc `requestSeq/active` блоки и дубли `loading/error` lifecycle.
- [x] HIGH pagination phase 1: `UsersPage` переведен на server-side pagination.
- [x] HIGH pagination phase 2: `RootAdminsPage` переведен на server-side pagination (`/admin/settings/admin-emails?page/page_size&q` + incremental load на frontend).
- [x] Reuse: добавлен единый `UserListSessionMeta` (`IP • устройство • активность`) и подключен в списках `UsersPage` + `RootAdminsPage`.
- [x] `UserListSessionMeta` теперь рендерится всегда (с прочерками), чтобы высота карточек в списках была консистентной.
- [x] `RootAdminsPage` контекст списка обогащен backend-профилями (`db_profiles` из `/admin/settings/admin-emails`) для показа session-meta без дополнительных N+1 запросов с frontend.
- [x] Проверка approve-логики: backend approve/remove_approve/set_role/bulk-ограничения сохранены; удален только approve-бейдж в UI.
- [x] `ActivityLogPage`: фильтр-flow стабилизирован через единый `scheduleResetAndLoad` (один rAF-планировщик) вместо множественных `setTimeout(...resetAndLoad...)`.
- [x] `useWorkspaceInfiniteScroll`: добавлен rAF-throttle и стабилизирован listener через refs (`canLoadMore/isLoading/threshold`), чтобы уменьшить лишние rebind и частоту вычислений на скролле.
- [x] Вынос page-loaders в shared hooks:
  - `frontend/src/hooks/useUsersList.ts` -> `frontend/src/pages/UsersPage.tsx`
  - `frontend/src/hooks/useEventFeed.ts` -> `frontend/src/pages/EventsPage.tsx`
  - `frontend/src/hooks/useActivityFeed.ts` -> `frontend/src/pages/ActivityLogPage.tsx`
  Эффект: меньше локального дублирования `fetchPage/applyPage/onReset/onError`, единый контракт guard/cancel/retry.
- [x] Dead exports cleanup (frontend utils), без UX-изменений:
  - удалены неиспользуемые `isRootAdminRole` и `isAdminRole` из `frontend/src/utils/roles.ts`;
  - удалены неиспользуемые transport-debug exports из `frontend/src/utils/eventCenterPollingManager.ts`:
    `getEventCenterPollingSnapshot`, `getEventCenterTransportMode`, `forceRestartEventCenterTransport`.
- [x] Anti-dup: введен единый `normalizeError` (`frontend/src/utils/errors.ts`) и подключен в:
  `UsersPage`, `EventsPage`, `ActivityLogPage`, `RootAdminsPage`, `MonitoringPage`.

## Anti-dup pass (candidate map)
- [x] Кандидат: единый helper нормализации ошибок UI (`normalizeError`) вместо разрозненных `String(e)`/локальных функций.
  file refs:
  - `frontend/src/pages/UsersPage.tsx`
  - `frontend/src/pages/EventsPage.tsx`
  - `frontend/src/pages/ActivityLogPage.tsx`
  - `frontend/src/pages/RootAdminsPage.tsx`
  - `frontend/src/pages/MonitoringPage.tsx`
- [x] Кандидат: unified helper для async drawer-context lifecycle (`requestSeq + loading + error + stale-guard`).
  file refs:
  - `frontend/src/pages/EventsPage.tsx`
  - `frontend/src/pages/ActivityLogPage.tsx`
  - `frontend/src/components/layout/SidebarRight.tsx`
  Backend: `/admin/users` поддерживает `page/page_size` (с backward-compatible ответом: список без `page`, `PagedResponse` с `page`).
  Frontend: `UsersPage` загружает страницы инкрементально (`page_size=20`, append on scroll), без полной загрузки списка.
- [x] Удален бейдж `доступ подтверждён: да/нет` и связанная legacy-логика:
  `status.approve` удален из `userBadgeCatalog`,
  `UserStatusPills` очищен от approve-ветки и approve-пропсов,
  страницы/дроуеры (`UsersPage`, `UserDetailsDrawer`, `EventsPage`, `ActivityLogPage`, `SidebarRight`, `RootAdminsPage`) синхронизированы.
  Обновлены `docs/ui/BADGE_INDEX.md` и `PATTERNS.md`.
- [x] `App.tsx`: включен route-level code-splitting для тяжелых страниц через `React.lazy + Suspense` (`UsersPage`, `ActivityLogPage`, `MonitoringPage`, `EventsPage`) с единым fallback.
- [x] `EventsPage`: устранены кракозябры в UI-строках фильтров/карточек/drawer, файл приведен к корректному UTF-8 отображению.
- [x] Event Center polling: добавлен singleton `frontend/src/utils/eventCenterPollingManager.ts`; `SidebarRight` переведен с локального `setInterval` на подписку/refresh через shared manager.
- [x] Event Center transport: реализован `SSE-first` в `eventCenterPollingManager` с автоматическим fallback на polling и авто-reconnect (`push недоступен -> polling без деградации UX`).
- [x] `userContext`: добавлен frontend resolve-cache (`email -> userId`) с TTL + in-flight dedupe, чтобы убрать повторные `GET /admin/users?status=all&q=...` в `EventsPage`/`ActivityLogPage`/`SidebarRight`.
- [x] `SidebarRight`: добавлен guard-diff для polling/expanded загрузок (`areEventListsEqual` + refs), чтобы не делать лишние `setNotifications/setActions` при неизменных данных.
- [x] `ActivityLogPage`: убран preload `GET /admin/users?status=all` при маунте; `emails-list` переведен на lazy-suggest по вводу (`q`, debounce 220ms, top-20).
- [x] Вынесен reusable pagination-hook `frontend/src/hooks/useIncrementalPager.ts`; на него переведены `EventsPage` и `ActivityLogPage` (`load/reset/append + requestNextPage guard`).
- [x] Вынесен reusable scroll-hook `frontend/src/hooks/useWorkspaceInfiniteScroll.ts`; unified-механика автодогрузки подключена в `EventsPage`, `ActivityLogPage`, `MonitoringPage`.
- [x] `UsersPage` и `RootAdminsPage`: подключен `useWorkspaceInfiniteScroll` для инкрементального рендера длинных списков (показ порциями + догрузка по скроллу).
- [x] `UsersPage` drawer refresh-flow оптимизирован: после действий вместо `openUserDrawer`-реопена используется прямой `refreshDrawerContext`, а `users list` и `drawer context` обновляются параллельно (`Promise.all`) для снижения лишних повторных вызовов.
- [x] `UsersPage`: расчет `availableActions` на выделение переведен на debounce (`180ms`) с cleanup, чтобы снизить burst-запросы при серийном выборе чекбоксов.
- [x] Unified download-flow: вынесен общий helper `frontend/src/utils/download.ts` (`downloadBlobFile`) и подключен в `MonitoringPage` + `ActivityLogPage` для export-сценариев.
- [x] `ActivityLogPage`: объединен auto-load flow в единый guard `requestNextPage` с дедупликацией `page+1` (скролл + highlight), чтобы избежать повторных догрузок одной и той же страницы.
- [x] `RolePermissionsHint` переведен на shared TTL-кэш матрицы прав (`frontend/src/utils/permissionsMatrixCache.ts`), чтобы убрать лишние повторные запросы `/auth/permissions-matrix`.
- [x] `RequireAuth` упрощен: удален дублирующий `refreshMe`-check; валидация авторизации берется из `AuthProvider` (`token/user/loading`), что убирает лишний `/auth/me` при старте/рефреше.
- [x] `SidebarLeft` оптимизирован: список профилей переведен на shared TTL-кэш (`frontend/src/utils/profileListCache.ts`), загрузка профилей ограничена профильным доменом роутов, `refreshMe` переведен на throttled обновление (не на каждый переход).
- [x] `SettingsPage` оптимизирован: загрузка статистики переведена на параллельные доменные вызовы (`Promise.allSettled`) + локальный TTL-кэш редко меняющихся счетчиков (`frontend/src/utils/settingsStatsCache.ts`).
- [x] `UsersPage`: `nowMs`-таймер ограничен жизненным циклом открытого drawer (без фонового тика, когда карточка пользователя закрыта).
- [x] `EventsPage`, `ActivityLogPage`, `MonitoringPage`: page-загрузчики переведены на реальную сетевую отмену через `AbortController` (включая `useIncrementalPager` и monitoring loaders), чтобы не держать устаревшие in-flight запросы при быстрых переключениях.
- [x] `UsersPage`, `RootAdminsPage`: добавлена сетевая отмена (`AbortController`) для page-loaders (`load users/admin list`, `drawer lookup`), чтобы при быстрых переключениях не применять устаревшие ответы.
- [x] `SidebarRight` polling оптимизирован: регулярный poll работает по фиксированному окну `top-20` для `Уведомлений` и `Ленты действий`, без локального расширения лимитов в компактной панели.
- [x] Event Center unread: добавлен shared store `frontend/src/utils/eventCenterUnreadStore.ts`; `SidebarRight` публикует unread из polling, `SettingsPage` подписывается на shared snapshot и использует fallback-fetch только при пустом store.
- [x] `MonitoringPage`: разделены потоки автообновления: `metrics/history` поллятся, `settings` грузятся при входе и после save, `focus` запрашивается только при активном `focusMetric`.
- [x] `EventsPage` + `ActivityLogPage`: добавлен anti-race request-seq guard для feed/context загрузок, чтобы устаревшие in-flight ответы не перетирали актуальный UI при быстрых переключениях.
- [x] `UsersPage`: из `openUserDrawer` убран лишний `loadUsers()`; при `pendingEventId` список синхронизируется локально (`pending_unread/pending_event_id`) без отдельного запроса.
- [x] Unified user-context loader: добавлен reusable `frontend/src/utils/userContext.ts` (`loadUserContextByEmail/loadUserContextById`) и подключен в `EventsPage`, `ActivityLogPage`, `SidebarRight`, `UsersPage`.
- [x] Frontend catalogs: добавлен единый TTL-кэш + in-flight dedupe (`frontend/src/utils/catalogCache.ts`) и подключен в `UsersPage`, `EventsPage`, `ActivityLogPage`, `SidebarRight`, `RootAdminsPage` для каталогов `actions/trust/audit`.
- [x] Simplification-first (частично закрыто): вынесены общие lightweight-типы в `frontend/src/types/common.ts` (`IdEmail`, `PagedResponse<T>`), и вынесен reusable builder `frontend/src/components/users/userContextQuickActions.ts` для auth/security quick-actions; подключено в `EventsPage` и `SidebarRight`.
- [x] PRIORITY: UsersPage UX-пакет (согласованный) закрыт:
  - в `UserActionPanel` убраны дубли названия действия в инфо-карточке;
  - оставлены только релевантные действия (включая логику удаления: `Удалить` для active, `Восстановить/Удалить окончательно` для deleted);
  - унифицирован inline-разделитель через `UI_BULLET = " • "` без raw-escape;
  - trust-детали приведены к reusable-паттерну (`Код/Срок/Риск`) и единой палитре;
  - role-бейджи и матрица ролей синхронизированы через единый `userBadgeCatalog`;
  - `PATTERNS.md` и `REUSE_INDEX.md` синхронизированы с новым контрактом.
- [x] Добавлен backend-driven `set_role` для смены роли после approve (`viewer/editor/admin`) с root-only ограничением на назначение `admin`.
- [x] Добавлен `apiDownload(...)` в `frontend/src/api/client.ts`, прямой `fetch` в экспортных сценариях `MonitoringPage` и `ActivityLogPage` убран.
- [x] Выполнена ручная UI-проверка `MonitoringPage` (включая anomaly -> event -> deep-link -> highlight): регрессий не выявлено.
- [x] Физически удален неиспользуемый deprecated-файл `frontend/src/components/ui/ListLimitControl.tsx`.
- [x] Вынесен reusable `IdentityBadgeRow` для drawer-контекстов (`RootAdminsPage`, `UserDetailsDrawer`) и унифицирован порядок identity-бейджей.
- [x] Вынесены общие response-типы каталогов в `frontend/src/types/catalog.ts` и подключены в `UsersPage`, `EventsPage`, `SidebarRight`, `ActivityLogPage`, `RootAdminsPage`.
- [x] Вынесен reusable `EventMetaPills` и подключен в drawer-контекстах `EventsPage` + `SidebarRight`.
- [x] Убраны локальные `formatDateTime` wrappers в `Events/Sidebar/UserDetails/Session/Device`, использован единый helper `utils/datetime`.
- [x] Добавлен reusable `CompactActionCard` и подключен в `UsersPage` + `RootAdminsPage` для action-блоков.
- [x] `UsersPage` список дополнительно уплотнен: строка `сессия` переведена на единый формат времени и более компактный текст (`IP/UA/устройств`).
- [x] `UsersPage`: бейдж `Вы` добавлен в список и в drawer-контекст карточки пользователя для текущего admin.
- [x] `EventsPage` и `ActivityLogPage`: в user-карточках drawer добавлен self-маркер `Вы` для текущего admin.
- [x] `SidebarRight` drawer: добавлена user-карточка (`email + статусы`) и self-маркер `Вы` для текущего admin.
- [x] Добавлен reusable `UserBadgeGroups` для единообразной структуры групп бейджей (`identity/status/trust`) в drawer-контекстах (`RootAdminsPage`, `UserDetailsDrawer`).
- [x] Trust-детали (`Код/Срок/Риск`) вынесены в reusable `TrustPolicyDetailChips` и синхронизированы между `RootAdminsPage` и `UserActionPanel` в единой trust-палитре.
- [x] В `userBadgeCatalog` внедрен семантический цветовой контракт бейджей (`identity/status/trust`), чтобы цвета отображались упорядоченно и одинаково на всех экранах.
- [x] `RootAdminsPage` drawer: добавлены re-use бейджей статусов/доверия (`UserStatusPills`/`UserTrustPills`) и подсказки trust-политик из общего каталога.
- [x] Централизованы русские подписи user-бейджей и hover-подсказки (`userBadgeCatalog` + `RoleBadge` + `UserStatusPills`).
- [x] Вынести `shortUserAgent` в `frontend/src/utils/userAgent.ts` и заменить дубли в `Users/Activity/UserDetails/Device/Session`.
- [x] Вынести monitoring drawer context в общий reusable-блок (`MonitoringContextCard` + общий loader `loadMonitoringContext`) и подключить в `EventsPage` + `SidebarRight`.
- [x] `RelevanceBadge` переведен на единый `userBadgeCatalog` (`relevanceBadgeMeta`): бейджи `Вы`/`Выбранный пользователь` централизованы по стилю и label.
- [x] `RoleBadge` переведен на единый `userBadgeCatalog` (`roleBadgeMeta`): роль-бейджи и статус-бейджи теперь управляются из одного источника.
- [x] `UserStatusPills`/`UserTrustPills` переведены на централизованный рендер через `userBadgeMeta` (`label + priority`), локальные подписи/порядок больше не хардкодятся в компоненте.
- [x] `EventsPage` и `ActivityLogPage` drawer переведены на re-use `UserStatusPills` (единый паттерн user-бейджей без локальных расхождений).
- [x] `userBadgeCatalog` расширен до `label + priority + color/bg` (`userBadgeMeta`) для централизации подписи/порядка/стиля бейджей.
- [x] Введена единая матрица пользовательских бейджей `userBadgeCatalog` и подключена в `UserStatusPills`/`UserTrustPills`/`UsersPage` (снижен визуальный конфликт с role-бейджами).
- [x] Нормализован русский текст в `UserStatusPills` (`approve: да/нет`, trust-статусы), файл пересохранен в корректной UTF-8.
- [x] `Events`: события с релевантностью `Вы` больше не считаются непрочитанными для текущего пользователя (backend auto-read для actor + исключение из unread-count).
- [x] `SidebarRight`: toast-уведомления по событиям `Вы` подавлены (показываются только релевантные уведомления для других кейсов).
- [x] `UsersPage`: добавлен компактный режим строки (`последняя сессия + IP/UA + число доверенных устройств`) для approved-пользователей.
- [x] Контракт кодировок усилен: добавлено обязательное правило проверки `cp1251` при кракозябрах с конвертацией в `UTF-8 without BOM`.
- [x] Archive (frontend/UI wave, compressed): длинный блок закрытых задач по `Users/RootAdmins/Events/Activity/Monitoring/SidebarRight/Settings` (drawer UX, quick-actions, confirm-dialog, unread/handled flow, deep-link, clearable input, trust/session cards, encoding fixes, compact action patterns) перенесен в архивный формат.
- [x] Подробные шаги этой волны сохранены в git-истории и связанных артефактах; в конце `TODO.md` оставлены только компактные архивные summary-блоки.

## 2026-02-24 Codex Update (archive, compact)
- [x] `admin.py` split/reuse wave завершена: ключевые query/serializer/action/monitoring части перенесены в `backend/app/services/*`, route-слой оставлен thin.
- [x] Export-оптимизация завершена для `audit/login-history`: итеративный пайплайн + shared export-utils (`csv/xlsx`, `write_only=True` для XLSX).
- [x] Count-less append контракт завершен и выровнен end-to-end (`events/users/activity`, включая `/admin/audit` с `include_total`).
- [x] HIGH re-audit pass 2 завершен: `docs/audits/AUDIT_HIGH_REVALIDATION_2026-02-24.md` (open HIGH residuals: none).
- [x] Доки синхронизированы по governance/reuse: `PATTERNS.md`, `REUSE_INDEX.md`, `TODO.md`.
- [ ] Оставшиеся открытые задачи ведем только в `Next` (включая manual-cleanup и intake-волны).

### Archive refs
- `docs/audits/AUDIT_API_QUERY_PROFILING_2026-02-24.md`
- `docs/audits/AUDIT_DB_INDEX_2026-02-24.md`
- `docs/audits/AUDIT_DEAD_CODE_2026-02-24.md`
- `docs/audits/AUDIT_HIGH_REVALIDATION_2026-02-24.md`
- `docs/audits/AUDIT_DEAD_CODE_2026-02-24.md`
