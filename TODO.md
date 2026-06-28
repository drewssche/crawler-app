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
  - legacy `/runs/start/{profile_id}` compatibility endpoint удалён; запуск выполняется через `/runs/start-site/{site_id}` или `/runs/start-project/{project_id}`;
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
  - маршрут перенесён внутрь проекта: `/projects/:id/compare`, Event Center скрывается в focus mode;
  - левая/правая сторона независимо выбирают сайт, успешный run и страницу;
  - поддержаны cross-site и historical compare без обязательного auto-match;
  - режим `Код` показывает line diff сохранённого HTML, `Структура` сравнивает HTTP/meta/SEO/links/assets;
  - focus workspace скрывает оба sidebar и отдаёт ширину двум рабочим панелям;
  - `Визуально` показывает sanitized snapshots в sandboxed iframe с CSP без scripts/forms/network resources;
  - `Обзор/Детально` и `Обе/Левая/Правая` предотвращают нечитаемые миниатюры;
  - auto-match предлагает пару по normalized relative path; unique tail match получает среднюю confidence, неоднозначные варианты не предлагаются;
  - предложение применяется только явной кнопкой и не заменяет ручной выбор;
  - sync scroll и resize остаются следующими расширениями.
- page fetch diagnostics:
  - каждый обнаруженный URL сохраняет исходный/конечный status, final URL, redirect chain, response time и безопасный fetch error;
  - `301/302/307/308` отображаются отдельным жёлтым page-result с friendly-пояснением и адресом назначения;
  - timeout/connect/TLS/redirect failures сохраняются как красный page-level result и не валят run при наличии других успешных HTML-страниц;
  - полный run остаётся `FAILED`, если не получено ни одной пригодной HTML-страницы.
- Последние проверки: backend `65 passed, 2 skipped`; backend integration `37 passed`; frontend project UI `18 passed`; PostgreSQL migration `b2f8d9e4c6a1` verified; RBAC parity passed; frontend production build passed; targeted ESLint passed; rendered snapshot Chromium smoke passed; runtime consent audit smoke passed; DOM/rendered element picker targeted checks passed; `git diff --check` passed.
- Общий frontend lint имеет ранее существовавшие ошибки вне текущих изменений; не считать их регрессией этой волны.
- UX-аудит 2026-06-26 подтвердил четыре приоритетные волны:
  1. исправить потерю Structure при повторном выборе site card и открывать контекст раздела дерева вместо внешнего сайта;
  2. превратить Page Inspector из сводки счётчиков в понятное исследование links/assets/tracking с легендами и progressive disclosure;
  3. заменить обрезанный sanitized DOM на достоверный сохранённый rendered snapshot, сохранив безопасный DOM/code-режим отдельно;
  4. сделать Compare пригодным для тысяч страниц: searchable picker, progressive controls и полноразмерные/изменяемые панели без фиксированной высоты документа.
- Следующий рекомендуемый пункт: **browser-based Crawl Persona flow**: friendly login capture, применение `localStorage/sessionStorage`, MFA/manual checkpoint и честные UX-пояснения по истечению сессии.
- Legacy audit 2026-06-27:
  - проект находится в dev-stage, поэтому breaking cleanup допустим, если упрощает целевую модель;
  - audit зафиксирован в [`docs/audits/LEGACY_AUDIT_2026-06-27.md`](docs/audits/LEGACY_AUDIT_2026-06-27.md);
  - DB/model/FK terminology wave закрыта: `Project/projects/project_id`;
  - route/API terminology `profiles → projects` закрыта для внешнего контракта;
  - frontend terminology wave закрыта: `ProjectDashboardPage/ProjectNewPage/projectListCache` и project-oriented props/utils без изменения backend API prefix;
  - дублирующие site-поля из project container удалены; summary/search берут рабочий URL/allowlist из `ProjectSite` aggregate.

## Working Rules

- Сначала читать этот файл и `git diff`; не перезаписывать незакоммиченные изменения.
- Формат закрытия: `Что было → Что стало → Как проверить → Вклад в цели`.
- Новые бизнес-правила — server-first; frontend только объясняет состояние и доступные действия.
- Friendly operational UX — сквозной контракт: длительное действие показывает реальный текущий этап, animation/spinner только при фактической работе, понятный следующий результат, мгновенный success/error state и при необходимости toast/Event Center. Не использовать декоративный progress, ложный ETA, бесконечную анимацию после завершения или скрытый background refresh; соблюдать `prefers-reduced-motion`.
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
  - повторный клик по уже выбранной карточке ничего не сбрасывает; при смене сайта последний готовый контекст сохраняется до загрузки нового и получает loading overlay вместо пустой Structure;
  - выбранная карточка явно подписана `Выбранный сайт`/`Рабочий контекст`, чтобы клик и область его влияния не требовали догадки;
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
  - каждая обнаруженная страница получает собственный crawl result, включая timeout, connect/TLS error, redirect loop и выход за scope; локальная ошибка страницы не делает весь run `FAILED`, если другие HTML-страницы успешно собраны;
  - run становится `FAILED`, когда не получено ни одной пригодной успешной HTML-страницы либо нарушен системный контракт запуска;
  - исходный результат страницы не перезаписывать после повторной попытки: retries сохраняются отдельными attempts внутри контекста исходного run;
  - действия retry:
    - `Повторить проблемные страницы` для всех подходящих failures;
    - `Повторить` рядом с конкретной failed-страницей прямо в Structure и в подробном drawer;
    - ручной выбор нескольких страниц;
  - retry поддерживает фильтры `4xx/5xx`, timeout, connection/TLS, redirect errors и bounded attempts/backoff, чтобы не создавать лишнюю нагрузку на сайт.
  - long-running UX contract: при crawl/retry/refresh UI показывает текущее действие, блокирует конфликтующие controls, сохраняет последний готовый срез и поясняет, когда данные обновятся; пустой экран без статуса не использовать.
  - live feedback: анимированный текущий этап и elapsed time без фиктивного процента; завершение/ошибка сразу меняют UI, показывают toast и создают адресное уведомление в Event Center. Точный `обработано N из M` допускается только после backend progress/heartbeat.
  - live Structure: run постепенно сохраняет crawl results и `current_url`; UI показывает текущий URL, добавляет готовые страницы/разделы с короткой анимацией и не считает ещё не посещённые baseline URL удалёнными. Spinner на каждом разделе не использовать: crawler не знает заранее, когда раздел полностью завершён.
  - batch feedback: завершённые страницы предыдущих батчей получают `✓ готово`; текущий батч и URL остаются активными. Показывать `готово / обнаружено / в очереди`, но не процент от неизвестного финального количества и не галочку «раздел завершён».
  - completed-run UX: итоговая карточка показывает страницы/new/changed/errors/duration; быстрые фильтры `Все / Новые / Ошибки` меняют дерево без потери URL-иерархии. Live updates не выполняют автопрокрутку.

  **Single-site anomaly monitoring**
  - baseline строится по нескольким успешным прогонам конкретного сайта/scope;
  - сигналы: рост `4xx/5xx`, падение coverage/pages, массовое исчезновение URL, необычный объём изменений, изменение title/canonical/robots, broken links/resources и время ответа;
  - до накопления baseline показывать `Недостаточно данных`, а не ложную аномалию;
  - severity и причина рассчитываются backend и видны отдельно по сайту.
  - UI-название `Состояние сайта` заменить на `Мониторинг отклонений`; до готовности baseline показывать прогресс `1 из 4 успешных прогонов` и кратко объяснять, какие показатели начнут сравниваться;
  - термин `baseline` использовать только в раскрываемых технических деталях; основной текст — `обычный уровень по предыдущим прогонам`.

  **Page intelligence**
  - клик по узлу Structure сначала открывает read-only context drawer, не внешний сайт;
  - агрегирующий узел-раздел без собственной сохранённой страницы открывает контекст раздела: число дочерних страниц, статусы, ошибки и быстрый поиск внутри раздела; внешний переход остаётся отдельной кнопкой;
  - drawer: site/scope, URL, HTTP/status, snapshot/meta, links/resources, текущий/предыдущий run и явное действие `Открыть на сайте`;
  - redirect URL сохраняется отдельным узлом/result, даже если конечная страница также успешно просканирована;
  - redirect diagnostics: исходный URL, конечный URL, полная chain, количество переходов, выход за scope/loop и friendly-пояснение:
    - `301 — постоянное перенаправление`: поисковым системам и пользователям предлагается новый постоянный адрес;
    - `302 — временное перенаправление`: исходный адрес пока считается основным;
    - `307 — временное перенаправление с сохранением метода запроса`;
    - `308 — постоянное перенаправление с сохранением метода запроса`;
  - обычный валидный redirect показывать системным жёлтым состоянием `Перенаправляет на …`; loop, длинную chain, недоступную конечную страницу или выход за scope — красным с причиной;
  - анализ выбранной страницы выполняется on-demand по сохранённому HTML, без массового пересчёта всего сайта при каждом открытии проекта;
  - links/resources:
    - searchable/filterable список ссылок `Все | Внутренние | Внешние | Битые` с anchor text, destination URL и известным HTTP status;
    - inventory изображений/scripts/styles с URL, alt, first/third-party признаком и известной доступностью; summary-счётчики остаются входом, но не заменяют список;
    - граф ссылок/структура переходов — отдельное расширение после стабильного списка, не блокирует первую полезную версию;
  - cookies/scripts intelligence:
    - cookies, установленные ответом страницы и client-side scripts, с доменом, path, expiry, SameSite/Secure/HttpOnly и friendly-пояснением назначения, если оно достоверно определено;
    - first-party/third-party scripts, источник, категория (`необходимый`, `аналитика`, `маркетинг`, `неизвестный`) и страницы, где они обнаружены;
    - отдельное распознавание Google Tag Manager, Google Analytics и известных tag/consent loaders без предположения, что найденный script обязательно отправил данные;
    - извлекать и показывать обнаруженные analytics identifiers и источник: `GTM-XXXX`, `G-XXXX`, `UA-XXXX`, `AW-XXXX` и другие достоверно распознанные IDs, чтобы пользователь мог найти соответствующий контейнер/ресурс в аналитике;
    - один script может содержать несколько IDs; UI группирует их по provider/type, показывает страницы обнаружения и не раскрывает значения cookies/tokens;
    - behavior audit в двух фазах: `до согласия` и `после согласия`, чтобы показать какие cookies/scripts реально появляются или выполняются до/после принятия;
    - состояния `запущен до согласия`, `ожидает согласия`, `появился после согласия`, `поведение не определено`; неизвестное не выдавать за нарушение;
    - drawer объясняет наблюдаемое техническое поведение, но не подменяет юридическую оценку GDPR/ePrivacy;
    - значения auth/session cookies и tokens никогда не возвращать в UI: только безопасные metadata и masked identifiers.
    - UI сначала показывает вывод: `аналитика не обнаружена` либо распознанные providers/IDs; generic scripts группируются в сворачиваемый блок `Прочие scripts`, а повторяющиеся карточки `Не определён` не занимают основной экран;
    - статический анализ и runtime consent audit визуально разделяются: `найдено в HTML` не означает `запустилось`, а `не проверено` получает короткое пояснение и ссылку на скрываемую легенду.
  - SEO checklist MVP: `title`, description, один содержательный `h1`, canonical, indexability/robots, lang, viewport, image alt и базовая структура headings;
  - SEO score `0–100` рассчитывается backend по прозрачным весам; UI показывает процент, passed/warning/failed пункты и конкретную рекомендацию, а не обещание позиции в поиске;
  - score является технической полнотой страницы, не универсальной оценкой качества контента или гарантией SEO-результата;
  - позднее расширить structured data/Open Graph/hreflang/content duplication только после стабильного snapshot contract;
  - unchanged page показывает одно состояние `Изменений нет`, без дублирования одинаковых окон;
  - subscriptions, occurrence search и target fingerprint добавляются после стабильных snapshot/diff contracts.
  - full-width Page Inspector: основная область показывает безопасный snapshot с режимами `Визуально | Код`, вторичная панель — единый вертикальный отчёт с секциями и sticky-якорями вместо скрывающих контекст вкладок;
  - `Визуально` должен показывать сохранённый rendered screenshot/full-page capture со стилями, изображениями и фактическим viewport; текущий sanitized HTML остаётся отдельным режимом `DOM`, а не имитацией визуального вида;
  - не подгружать live CSS/images исходного сайта внутрь исторического snapshot по умолчанию: это ломает воспроизводимость, может выполнить нежелательные запросы и смешивает состояние разных дат;
  - секции Inspector: `Сводка`, `SEO`, `Ссылки`, `Ассеты`, `Аналитика`, `Cookies/consent`, `Повторные проверки`; drawer остаётся кратким входом с действием `Открыть полный анализ`;
  - `Технический контекст` использует человеческие названия и скрываемую легенду `Что означает`; внутренние `run_id/site_id` находятся только в `Технических деталях`;
  - sticky-навигация Inspector оформляется компактными chips без стандартных подчёркнутых ссылок, подсвечивает текущую секцию и допускает горизонтальный scroll на узком экране;
  - единый status-chip contract для project/site/run/page/tracking: icon + label + tooltip, семантические tones `success/info/warning/danger/neutral`; сырые тексты `Включён`, `Не определён`, `FINISHED` и цвет без пояснения не использовать;
  - пользовательские названия прогонов строятся по дате/времени и сайту (`Прогон от 25.06.2026, 17:05`); глобальный DB `run #5` показывается только в раскрываемых технических деталях и не выдаётся за пятый прогон проекта.
  - широкий экран использует пропорцию около `2fr / minmax(320px, 0.9fr)`; на узком экране области складываются вертикально. Отчёт не должен уменьшать snapshot до нечитаемой миниатюры;
  - те же report sections переиспользуются в Compare с переключателем `Левая | Правая | Различия`; режим различий показывает только значимые расхождения HTTP/SEO/resources/analytics IDs/cookies/CMP и не повторяет одинаковые данные — MVP готов.

  **Crawl personas / user contexts**
  - один `ProjectSite` поддерживает несколько контекстов просмотра: минимум `Гость`, позднее `Авторизованный` и `Партнёр`;
  - целевая модель: `ProjectSite → CrawlPersona → Run → Page`, чтобы результаты, baseline, retries и Compare не смешивали разные сессии;
  - Compare позволяет выбирать persona вместе с site/run/page: гость ↔ авторизованный, партнёр ↔ партнёр другого сайта и historical compare одной persona;
  - staged implementation:
    1. guest context и статические безопасные headers — готово;
    2. encrypted cookie/session bundle с masked UI, expiry-status и запретом viewer читать secrets — backend + первый UI готовы; HTTP-crawler применяет cookies/headers из session bundle; `localStorage/sessionStorage` применяются на следующем browser-based crawler этапе;
    3. browser-based login scenario для CSRF/dynamic forms — foundation готов: Playwright runtime умеет применять persona browser state (`cookies/localStorage/sessionStorage/headers`) в runtime consent audit; login capture API contract готов (`start/status/complete/cancel`, duplicate guard, auto-expire, без хранения secrets в capture-row); UI wizard MVP готов: ручной режим `Открыть сайт для входа` + вставка Playwright storageState; managed capture backend/runtime contract готов: feature flag, endpoint `capture-managed`, Playwright service и безопасное сохранение storageState тем же encrypted bundle; интерактивный managed-session lifecycle готов: `start/status/save/cancel`, session id, UI-состояния и сохранение state без вставки JSON; readiness guard готов: backend предупреждает, если state пустой/похож на login-page, UI показывает причины и даёт явное `Сохранить принудительно`; следующий шаг — bridge открытия реального управляемого окна в dev/runtime окружении и MFA-friendly инструкции для пользователя;
    4. MFA/manual checkpoint только как явный управляемый workflow;
  - согласованный UX:
    - по умолчанию выбран `Гость`: crawler идёт без cookies и авторизации, пока пользователь явно не выбрал другую персону;
    - пользователь заранее создаёт персону в настройках сайта: `Гость`, `Авторизованный пользователь`, `Партнёр`, `Другая роль`;
    - для негостевой персоны подключает сессию один раз: MVP — ручная вставка cookies/localStorage/session JSON; позже — friendly flow `Открыть сайт и войти`, где пользователь логинится руками/проходит 2FA и сохраняет сессию;
    - при запуске сайта выбирает одну персону; bulk-run по нескольким персонам добавлять только после стабильного одиночного запуска;
    - в истории, структуре, Page Inspector и Compare всегда видно, какой персоной сделан run;
    - viewer видит только masked status: `сессия не подключена/подключена/истекает/просрочена`, но не cookies/tokens.
  - bulk-run personas:
    - `Запустить все сайты` использует default persona каждого сайта и показывает её в результате по каждому сайту;
    - негостевая persona без подключённой/активной сессии не запускается тихо как гость: сайт получает `SKIPPED` с причиной `сессия не подключена/истекла/недоступна`;
    - UI результата общего запуска показывает сайт, контекст, session status и итог `запущен/пропущен/ошибка`.
  - persona-aware Structure/History:
    - `/runs/by-site/{site_id}` поддерживает backend-фильтр `crawl_persona_id`;
    - Project UI имеет отдельный фильтр просмотра `Все контексты | конкретная persona`, который влияет на последний run, Structure и History, но не подменяет выбор persona для нового запуска;
    - empty states объясняют, что у выбранной persona ещё нет прогонов, вместо ощущения пропавшей структуры.
  - безопасная экономия ресурсов между персонами:
    - по умолчанию `Безопасная`: каждую персону нужно реально открыть/проверить, но тяжёлый анализ можно переиспользовать после доказанного совпадения fingerprint;
    - доказательство совпадения: status, final URL, content-type, HTML hash и позднее rendered/snapshot hash;
    - если совпало, page result получает `reused_from_page_id`/`reuse_reason`, а UI показывает `Контент совпадает с “Гость”; анализ переиспользован`;
    - не пропускать проверку авторизованной персоны заранее: redirect на login, 403 или role-only блоки должны быть обнаружены;
    - режимы позже: `Безопасная`, `Максимальная`, `Выключена`.
  - пароли, cookie values и tokens хранятся encrypted-at-rest, не попадают в crawl artifacts/logs/API responses и доступны только через server-side secret references;
  - baseline и anomaly signals всегда scoped по `project_site_id + persona_id + scope`, иначе различия ролей будут ошибочно считаться аномалиями.

  **Compare workspace**
  - отдельный полноширинный маршрут внутри проекта: `/projects/:id/compare`;
  - верхняя компактная строка выбора:
    `левый сайт + страница/версия ↔ правый сайт + страница/версия`;
  - выбор каждой стороны читается как `Сайт → Контекст доступа → Версия → Страница`; контекст можно оставить `Все контексты` либо сузить до конкретной persona;
  - при сравнении разных personas UI показывает предупреждение `Сравнение разных контекстов доступа`: отличия могут быть правами доступа/авторизацией/персонализацией, а не обычным изменением страницы;
  - режимы: `Визуально`, `Код`, `Структура`, позднее `Контент`;
  - mode controls скрыты или disabled с пояснением, пока обе страницы не выбраны; сценарий читается как `1. Выберите страницы → 2. Выберите режим → 3. Исследуйте различия`;
  - выбор страницы — searchable combobox с URL/title/status, keyboard navigation и virtualization/server-side search для run с сотнями и тысячами страниц; native select не является целевым решением;
  - пользователь может вручную выбрать любые две страницы; auto-match по normalized relative path только предлагает пару и не блокирует ручной выбор;
  - поддержать cross-site compare и historical compare одной страницы/сайта одним UI;
  - Compare работает как настоящий focus workspace: скрываются оба sidebar, остаются компактная навигация назад и рабочая область;
  - широкий экран: две полноценные панели; средний/узкий: переключение `Обе | Левая | Правая`, без двух нечитаемых миниатюр;
  - next compare layout idea: на широком экране использовать рабочую схему `левая info-панель | левая страница | правая страница | правая info-панель`, где каждая info-панель относится только к своей странице; центральная область остаётся главным местом сравнения. На средних/узких экранах не держать четыре колонки: info-панели сворачиваются в drawer/нижнюю панель или переключатель `Инфо: Левая | Правая | Различия`, чтобы snapshot не становился нечитаемым;
  - отдельный режим `Различия` остаётся нужен поверх двух page-info панелей: он показывает только расхождения между страницами, а не полный отчёт каждой стороны;
  - element-level inspection после стабилизации layout: пользователь включает `Выбрать блок`, кликает визуальный/DOM-блок, видит связанный HTML-фрагмент и при переходе в `Код` получает подсветку соответствующих строк. DOM/sandbox и rendered snapshot element-map (`selector`, bounding box, outerHTML, text fingerprint) являются базой для клика по визуальному снимку; позже — сравнение выбранных блоков слева/справа.
  - visual mode использует сохранённый rendered snapshot; sandboxed DOM доступен отдельно для исследования структуры без scripts/forms/network navigation;
  - высота документа не задаётся константой: full-page capture либо измеренный DOM не должен обрезаться после 1600 px или создавать ложную пустую область;
  - режимы масштаба: `Вписать по ширине | 100% | Вся страница`; обе snapshot-панели и Inspector используют высоту viewport, независимый scroll и не уменьшаются до коротких окон;
  - селекторы после выбора остаются компактными над соответствующей панелью; добавить resize рабочей области и Inspector, затем optional sync scroll.

  **Implementation order**
  1. Data model/migration: `ProjectSite`, site-scoped runs/pages и compatibility для существующих данных — готово.
  2. Create/settings UX для сайтов и scope без фиктивных controls — готово.
  3. Site-scoped crawler: одиночный и project-level multi-site run, path/redirect guard, fair per-site budgets и per-site diagnostics — готовы; durable background orchestration остаётся в reliability epic.
  4. Project UI: функциональные site cards как context selector, отдельные KPI/coverage/errors и site-scoped History — готово.
  5. Single-site anomaly baseline/signals — MVP готов; title/canonical/robots/resources/latency signals требуют расширенного page snapshot contract.
  6. Page context drawer на существующих snapshot/index данных — MVP готов; richer persisted snapshot fields остаются.
  7. Full-width manual compare workspace — MVP `Код/Структура` готов.
  8. Visual mode/focus workspace и auto page matching — готовы; sync scroll/resize, subscriptions/outbox остаются.
  9. Persisted redirect chain + page-level network failures и friendly diagnostics — готово.
  10. Bounded bulk/single-page retry attempts внутри исходного run — готово.
  11. Rich snapshot: response timing, cookies/scripts/GTM inventory и consent behavior `до/после` — static inventory и on-demand runtime consent audit MVP готовы; persisted audit history/queued audits остаются.
  12. Full-width single-page Inspector и общий Inspector в Compare — каркас MVP готов; UX-аудит требует следующей волны:
      - 12.1 site-card persistence, directory context, human run/status labels и anomaly explanation — готово;
      - 12.2 полные searchable links/assets inventories, grouped tracking и section legend/chips — готово;
      - 12.3 persisted rendered full-page snapshot + отдельные безопасные `DOM/Код` режимы — on-demand reconstruction готова; нативный screenshot в момент crawl остаётся для browser-persona этапа;
      - 12.4 searchable Compare picker, progressive controls, dynamic height и resizable panels — готово; server-side search/true virtualization остаются только при подтверждённой просадке на больших runs.
  13. Runtime consent audit `до/после`, затем отображение наблюдаемого поведения cookies/scripts — on-demand MVP готов.
  14. `CrawlPersona`: guest → encrypted session bundle → browser login scenarios. Guest foundation готов: каждый site получает default `Гость`, API runs/snapshots/context возвращают persona metadata, anomaly baseline scoped по default persona.
  15. Расширить anomaly/Compare на redirect, resources, consent и persona-scoped signals.
  15.1 Compare layout refinement: split page info into left/right contextual panels around the central two-page comparison; keep adaptive fallback for medium/narrow screens and preserve a separate differences-only report — готово.
  15.2 Element-level inspection: visual/DOM block picker → linked HTML fragment → code highlight; later selected-block compare and target fingerprint monitoring. DOM picker и rendered snapshot element-map MVP готовы: новые визуальные снимки сохраняют карту блоков, чтобы клик по screenshot выбирал HTML-элемент. UX-stabilization: выбранный блок показывает источник (`Визуальный снимок`/`DOM`), пустой клик получает friendly warning, подсветка кода честно объясняет mismatch, есть `Сбросить выбор`.
  15.3 Selected-block compare: ручной выбор блока слева/справа в Compare, HTML/text diff только выбранных блоков, размеры/selector, structural fingerprint и warning, если блоки структурно не похожи — MVP готов. UX-polish: статус `Блоки: 0/2–2/2`, следующий шаг, `Очистить оба блока` и пояснение, когда старый snapshot без `element_map` требует пересоздания. Auto-suggest похожего блока готов как явное предложение по fingerprint без автоприменения. Следующее расширение: сохранение target monitoring.
  16. Backend schedule contract: сохранённое расписание, timezone, duplicate-run guard, pause/resume и следующий запуск; текущий settings-блок остаётся честным manual-only состоянием до этого этапа.
  17. Дублирующие site-поля из project container удалены; compatibility endpoint `/runs/start/{profile_id}` уже удалён.

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

- [ ] **P1 Legacy cleanup — Project terminology and compatibility removal** (`HIGH`, staged).
  Цель: не строить target monitoring поверх старой profile-модели. Стадия разработки позволяет делать breaking cleanup, если оно снижает сложность.
  - Audit: [`docs/audits/LEGACY_AUDIT_2026-06-27.md`](docs/audits/LEGACY_AUDIT_2026-06-27.md).
  - 1. Safe cleanup: README/user-facing wording and obsolete compatibility endpoints.
  - 2. Backend cleanup: `POST /runs/start/{profile_id}` удалён; `GET /runs/by-profile/{profile_id}` заменён на `/runs/by-project/{project_id}`.
  - 3. Frontend terminology: `ProfileDashboardPage → ProjectDashboardPage`, `ProfileNewPage → ProjectNewPage`, `profileListCache → projectListCache` — закрыто.
  - 4. Route/API rename: `/profiles/* → /projects/*`, `/profiles/{id}/sites → /projects/{id}/sites`, `profiles.edit → projects.edit` — закрыто.
  - 5. DB rename wave: `profiles → projects`, `profile_id → project_id` — закрыто.
  - 6. Project container cleanup: duplicate site fields removed from `projects`; `ProjectSite` is now the source for URL/scope/limits/allowlist.

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

- [x] **P1 Element picker MVP for Page Inspector DOM mode**.
  - Что было: можно было смотреть snapshot, DOM и HTML отдельно, но не было связи `визуально выбранный блок → HTML фрагмент`.
  - Что стало: в `Полный анализ → DOM` появилась кнопка `Выбрать блок`; sandboxed DOM подсвечивает hover/selected element и передаёт наружу только tag/id/classes/selector/text/outerHTML/bounding box. Правая панель показывает карточку выбранного блока, HTML фрагмент и действие `Показать в коде`; режим `Код` подсвечивает найденный фрагмент. Inline event handlers удаляются перед показом DOM, scripts исходной страницы не исполняются.
  - Как проверить: открыть полный анализ страницы, перейти в `DOM`, включить `Выбрать блок`, кликнуть по блоку, затем нажать `Показать в коде`.
  - Вклад в цели: пользователь может исследовать конкретную область страницы без ручного поиска HTML (`high` UX/product value); это безопасная база для будущего selected-block compare и rendered snapshot element-map (`high` architecture).

- [x] **P1 Compare layout refinement — side-specific page info panels**.
  - Что было: Compare имел одну общую info-панель с переключателем `Левая/Правая/Различия`; пользователю приходилось помнить, к какой странице относится текущий отчёт.
  - Что стало: на широком экране рабочая область строится как `инфо левой страницы | центральное сравнение | инфо правой страницы`; каждая side-панель имеет собственный отчёт и независимые section anchors. Отдельный блок `Только различия` показывает только расхождения и не дублирует полные отчёты сторон. На средних/узких экранах layout складывается в одну колонку, чтобы snapshots не становились нечитаемыми.
  - Как проверить: `Проект → Сравнить страницы`, выбрать две страницы; слева от центрального сравнения видна информация левой страницы, справа — правой, ниже — `Только различия`.
  - Вклад в цели: Compare стал ближе к рабочему пространству анализа, где данные физически расположены рядом со своей страницей (`high` UX/correctness); отдельный report различий сохранён для быстрых выводов (`high` product value).

- [x] **P1 Crawl Personas foundation — explicit guest context**.
  - Что было: все прогоны технически относились только к сайту; будущие авторизованные/партнёрские результаты могли бы смешаться с гостевыми в history, baseline и Compare.
  - Что стало: добавлена модель `CrawlPersona`, миграция создаёт default `Гость` для каждого `ProjectSite`, API-запуски пишут `crawl_persona_id`, history/summary/snapshot/page-context возвращают persona metadata, anomaly baseline считает default-persona отдельно. UI показывает `Контекст: Гость` в site cards, history, Compare и Page Inspector.
  - Как проверить: `Проект → Основная` показывает контекст сайта; новый запуск создаёт run с `persona: Гость`; `Compare` и `Полный анализ` показывают тот же контекст. Миграция: `docker compose exec backend alembic upgrade head`.
  - Вклад в цели: результаты разных пользовательских представлений больше не будут смешиваться при добавлении авторизованных сценариев (`high` correctness); пользователь видит, чьими глазами была просмотрена страница (`high` friendly UX).

- [x] **P1 On-demand runtime consent audit for page Inspector**.
  - Что было: Inspector честно показывал, что статический HTML не доказывает фактический запуск scripts/cookies до или после согласия.
  - Что стало: editor/admin может явно запустить browser-аудит выбранной страницы; backend открывает сохранённый HTML на origin страницы, разрешает scripts/xhr/fetch, пробует нажать типовую кнопку consent и сравнивает cookies/requests до и после. UI показывает cookies names, request counts, распознанные tracking providers, новые cookies/providers и предупреждает, что это наблюдаемое поведение, а не юридическая оценка. Значения cookies/tokens не возвращаются.
  - Как проверить: `Полный анализ → Cookies и consent → Проверить до/после`; после выполнения сравнить блоки `До согласия`, `После согласия` и `Что изменилось`.
  - Вклад в цели: пользователь видит не только факт наличия GTM/scripts, но и наблюдаемое runtime-поведение относительно consent (`high` product value); аудит запускается только по запросу и не создаёт скрытой нагрузки на массовые runs (`high` operations/security).

- [x] **P1 Compare workspace searchable picker and progressive controls**.
  - Что было: выбор страницы был native select без поиска; режимы `Визуально/Код/Структура` отображались до выбора страниц; рабочие панели имели слишком короткую высоту для длинных snapshots.
  - Что стало: каждая сторона получила searchable picker по URL/title/HTTP с ограничением видимых результатов и подсказкой уточнить поиск; catalog endpoint отдаёт title страницы; режимы сравнения появляются только после выбора двух страниц; snapshot и report панели используют высоту viewport и допускают горизонтальный resize info-панели.
  - Как проверить: `Проект → Сравнить страницы`, выбрать сайт/run, найти страницу через поиск, выбрать обе стороны; после этого появляются режимы и панель `Обе/Левая/Правая`; длинный snapshot скроллится внутри высокой рабочей области.
  - Вклад в цели: Compare стал пригоднее для runs с сотнями/тысячами страниц (`high` UX); интерфейс больше не показывает controls без эффекта (`high` friendly UX).

- [x] **P1 Persisted rendered page reconstruction for Inspector and Compare**.
  - Что было: `Визуально` показывал sanitized HTML без styles/images, поэтому выглядел как сломанная страница; фиксированная iframe-высота обрезала длинный контент.
  - Что стало: editor/admin может явно создать JPEG-реконструкцию из HTML выбранного прогона; scripts/forms/XHR блокируются, CSS/images/fonts разрешены только для отрисовки; артефакт сохраняется в отдельном Docker volume и повторно используется в Inspector/Compare. Inspector разделён на `Снимок | DOM | Код`, Compare использует снимок с `Обзор/Детально`; viewer может читать готовый артефакт, но не создавать новый.
  - Как проверить: пересобрать backend, открыть полный анализ → `Снимок → Создать визуальный снимок`; после генерации обновить страницу — используется сохранённый JPEG. В Compare создать снимки обеих сторон и переключить `Обзор/Детально`.
  - Вклад в цели: страница отображается со стилями и изображениями без исполнения сохранённого активного кода (`high` UX/security); генерация выполняется только по запросу и не удваивает нагрузку crawl на тысячи страниц (`high` operations).
  - Ограничение: это реконструкция сохранённого HTML с ресурсами, загруженными в момент создания. Для полностью исторически точного вида понадобится browser-capture непосредственно во время persona-run с retention/quota.
- [x] **P1 Page Inspector research inventories and explainable tracking UX**.
  - Что было: links/assets показывались только счётчиками и известными ошибками; каждый неизвестный script занимал отдельную большую карточку; sticky-навигация выглядела как набор обычных ссылок без текущего контекста.
  - Что стало: ссылки фильтруются и ищутся по URL/anchor text, показывают тип и известный HTTP; изображения/scripts/styles получили собственные searchable inventories и first/third-party маркировку; распознанные analytics IDs/scripts показаны первыми, неизвестные свёрнуты в `Прочие scripts`; технические ограничения и статический/runtime смысл объясняются inline; навигация оформлена chips с active section.
  - Как проверить: открыть `Полный анализ` страницы → `Ссылки` и переключить `Все/Внутренние/Внешние/Битые`; найти asset; открыть `Аналитика` и раскрыть `Прочие scripts`; при прокрутке текущая секция подсвечивается.
  - Вклад в цели: Page Inspector стал пригоден для исследования страницы, а не только чтения агрегатов (`high` product value); неизвестные и непроверенные данные больше не выглядят как подтверждённая проблема (`high` trust/friendly UX).
- [x] **P1 UX correctness — site context, directory context and human statuses**.
  - Что было: повторный клик по выбранной site card очищал Structure; агрегирующий раздел дерева открывал внешний сайт; `run #ID`, `FINISHED/Активен` и `Baseline` требовали знания внутренней модели.
  - Что стало: повторный выбор является no-op, а при смене сайта сохраняется последний готовый срез до загрузки нового; раздел без собственной страницы открывает drawer со сводкой вложенных страниц; выбранная карточка, успешный run, история и мониторинг отклонений получили понятные labels/chips, внутренние ID убраны в технические детали.
  - Как проверить: после готового прогона повторно нажать выбранную карточку — Structure остаётся; нажать `/catalogue/` без page-result — открывается `Контекст раздела`; история показывает `Прогон от …`, а baseline — прогресс накопления истории.
  - Вклад в цели: устранена потеря пользовательского контекста (`high` correctness); дерево и мониторинг больше не требуют понимания DB IDs и статистической терминологии (`high` friendly UX).
- [x] **P1 Bounded retry attempts for problem pages**.
  - Что было: page-level failure сохранялся, но для проверки восстановления требовался новый полный прогон сайта.
  - Что стало: editor/admin может повторить одну страницу прямо из Structure или drawer, либо до 50 проблемных страниц массово; максимум 3 attempts на страницу, успешный retry больше не предлагается, исходный `Page` и статус run не перезаписываются. Во время crawl остаётся последний готовый срез с явным статусом и автоматическим обновлением после завершения.
  - Как проверить: открыть страницу с timeout/4xx → `Повторить`; либо `Структура сайта → Повторить проблемные`; в drawer появляется история attempts с HTTP/error и временем ответа.
  - Вклад в цели: локальная ошибка восстанавливается без лишней нагрузки полного crawl (`high` reliability/UX); исходная диагностика остаётся audit-safe (`high` correctness).
- [x] **P1 Persisted redirects and page-level fetch failures**.
  - Что было: crawler следовал redirect, но сохранял только конечную страницу; timeout отдельной страницы терялся, хотя обход продолжался.
  - Что стало: page-result хранит source/final status, redirect chain, final URL, response time и fetch failure; Structure показывает redirect жёлтым, drawer объясняет `301/302/307/308`, локальный network failure остаётся красным результатом страницы.
  - Как проверить: URL с `301 → 200` остаётся в Structure и показывает назначение; успешная стартовая страница со ссылкой на timeout завершает run как `FINISHED`, а timeout URL виден отдельно.
  - Вклад в цели: диагностика больше не теряет исходные URL и локальные failures (`high` correctness); создан фундамент точечного retry (`high` reliability).
- [x] **P1 Compare normalized relative-path auto-match**.
  - Что было: обе страницы всегда требовали ручного поиска даже при одинаковой структуре сайтов.
  - Что стало: после выбора страницы Compare предлагает пару с тем же normalized path или уникальными последними сегментами; показывает confidence/reason и применяет выбор только по кнопке.
  - Как проверить: выбрать `/products/crm/` слева при наличии `/products/crm/index.html` справа → появляется предложение высокой уверенности; два одинаковых tail-match не дают сомнительной подсказки.
  - Вклад в цели: типовые cross-region сравнения ускорены без потери ручного контроля (`high` UX/correctness).
- [x] **P1 Compare focus workspace + safe visual snapshots**.
  - Что было: Compare оставлял левый sidebar и не имел визуального режима; две будущие панели рисковали стать слишком узкими.
  - Что стало: оба sidebar скрываются; sanitized snapshots отображаются в sandboxed iframe; режимы `Обзор/Детально` и `Обе/Левая/Правая` дают полезную площадь на широком и узком экране.
  - Как проверить: `Проект → Сравнить страницы → Визуально`; переключить масштаб и одну/две стороны, убедиться, что links/forms/scripts snapshot не выполняются.
  - Вклад в цели: визуальное сравнение получило отдельное рабочее пространство (`high` UX); snapshot не исполняет сохранённый активный контент (`high` security).
- [x] **P1 Full-width manual Compare workspace MVP**.
  - Что было: `/compare` был общей страницей-заглушкой без контекста проекта и данных.
  - Что стало: `/projects/:id/compare` позволяет вручную выбрать любые две страницы/версии; HTML line diff и structural diff работают для разных сайтов и истории одного сайта, Event Center скрыт для полезной ширины.
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
  - Что было: один project container смешивал проект, стартовый сайт и общий список доменов; второй домен не имел самостоятельного результата.
  - Что стало: проект хранит `1+ ProjectSite`; миграция создаёт primary site для каждого существующего проекта; API позволяет читать/добавлять/редактировать/удалять сайты с RBAC, duplicate conflict и запретом удалить последний сайт.
  - Как проверить: `alembic current` → `8f2b1c4d6e90`; `GET /projects/{id}/sites`; section scope `/docs/` принимает `/docs/page`, но отклоняет `/docs-old` и `/docs/../admin`.
  - Вклад в цели: создан совместимый фундамент multi-site и section-only мониторинга без преждевременного изменения crawler/UI (`high` architecture/reliability).
- [x] **P0 Project/run RBAC parity**.
  - Что было: project/run API были доступны без согласованных permissions; viewer видел mutation controls, а editor формально не отличался от viewer.
  - Что стало: permissions `data.view/crawler.run/projects.edit` добавлены в backend/frontend source-of-truth; routes и endpoints защищены; viewer читает, editor редактирует/запускает, admin/root наследуют возможности.
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
  - Что стало: `Основная` объединяет последний прогон, KPI и структуру; `История` показывает реальные runs без фиктивного domain-фильтра; `Настройки` содержит реальные project/site scope/limit параметры, честный статус расписания и danger zone.
  - Как проверить: открыть проект; на `Основная` доступны run/KPI/structure, на `История` — список прогонов, на `Настройки` — параметры, ручной запуск и удаление. Кнопки `Сохранить расписание` нет.
  - Вклад в цели: меньше лишних переходов и ложных affordance (`high` UX), ясное разделение работы/истории/настроек (`high`).
- [x] Friendly project/run failure UX.
- [x] Friendly project search: normalization, URL cleanup, RU/EN layout recovery, ranking, highlighting и friendly empty state.
- [x] Backend/frontend stabilization implementation checks; ручные Browser-gates оставлены открытыми отдельно.

## Archive Index

- Полный TODO и ретроспективы: [`docs/archive/TODO_HISTORY_2026-06-22.md`](docs/archive/TODO_HISTORY_2026-06-22.md)
- Полный historical patterns snapshot: [`docs/archive/PATTERNS_FULL_2026-06-22.md`](docs/archive/PATTERNS_FULL_2026-06-22.md)
- Полный historical reuse snapshot: [`docs/archive/REUSE_INDEX_FULL_2026-06-22.md`](docs/archive/REUSE_INDEX_FULL_2026-06-22.md)
