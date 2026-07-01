# TODO

Короткий рабочий backlog. Полная история решений и завершённых волн сохранена в
[`docs/archive/TODO_HISTORY_2026-06-22.md`](docs/archive/TODO_HISTORY_2026-06-22.md).

## Current Context — 2026-07-01

- Активная продуктовая установка: **friendly UX/UI**, без декоративного шума и с объяснимыми состояниями.
- Browser-smoke выполняется **только по явному запросу пользователя**.
- Завершённые волны закоммичены:
  - `16708d3` — stabilization, friendly failures/search и project IA;
  - `ea8ec69` — compact Workspace project rows;
  - `0760858` — page monitoring targets, rendered/compare polish и notification delivery.
- Уточнён целевой продуктовый контракт:
  - проект — контейнер для одного или нескольких самостоятельных сайтов;
  - мониторинг аномалий работает и для проекта с одним сайтом;
  - сравнение сайтов опционально и выполняется между выбранными страницами/версиями;
  - сайт можно сканировать целиком либо только внутри заданного раздела (`path_prefix`).
- Role audit 2026-06-24:
  - project/run permissions теперь enforced backend-first и отражены frontend guards;
  - fixture-only UI Debug Center реализован без impersonation и backend writes;
  - настоящая impersonation остаётся заблокированной до project membership.
- Project membership governance:
  - `ProjectMembership` задаёт доступ внутри проекта: `owner/editor/viewer`;
  - owner управляет участниками, editor меняет сайты/запуски, viewer только смотрит результаты;
  - backend защищает последнего owner, а UI объясняет роли в настройках проекта;
  - глобальные `admin/root-admin` сохраняют полный operational-доступ ко всем проектам.
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
- Последние проверки: backend target monitoring preview/test-send targeted `1 passed`; backend renderer `4 passed`; frontend project UI `30 passed`; TypeScript `tsc -b` passed; frontend production build passed без Vite chunk warning; PostgreSQL migration `f2c9a7e8d104 (head)` verified; target monitoring Event Center + email/Telegram outbox/delivery tick + subscription UI + bounded retry/backoff diagnostics card + preview/test-send covered; `git diff --check` passed.
- Общий frontend lint имеет ранее существовавшие ошибки вне текущих изменений; не считать их регрессией этой волны.
- UX-аудит 2026-06-26 подтвердил четыре приоритетные волны:
  1. исправить потерю Structure при повторном выборе site card и открывать контекст раздела дерева вместо внешнего сайта;
  2. превратить Page Inspector из сводки счётчиков в понятное исследование links/assets/tracking с легендами и progressive disclosure;
  3. заменить обрезанный sanitized DOM на достоверный сохранённый rendered snapshot, сохранив безопасный DOM/code-режим отдельно;
  4. сделать Compare пригодным для тысяч страниц: searchable picker, progressive controls и полноразмерные/изменяемые панели без фиксированной высоты документа.
- Следующий рекомендуемый пункт: **release stabilization**: technical checks закрыты, остаётся только ручной Browser-smoke по явному запросу пользователя. Новые крупные фичи не начинать до подтверждения project/run сценариев.
- Legacy audit 2026-06-27:
  - проект находится в dev-stage, поэтому breaking cleanup допустим, если упрощает целевую модель;
  - audit зафиксирован в [`docs/audits/LEGACY_AUDIT_2026-06-27.md`](docs/audits/LEGACY_AUDIT_2026-06-27.md);
  - DB/model/FK terminology wave закрыта: `Project/projects/project_id`;
  - route/API terminology `profiles → projects` закрыта для внешнего контракта;
  - frontend terminology wave закрыта: `ProjectDashboardPage/ProjectNewPage/projectListCache` и project-oriented props/utils без изменения backend API prefix;
  - дублирующие site-поля из project container удалены; summary/search берут пользовательский список `sites[]` из `ProjectSite` aggregate, а technical allowlist больше не отображается как сайты проекта.

## Working Rules

- Сначала читать этот файл и `git diff`; не перезаписывать незакоммиченные изменения.
- Формат закрытия: `Что было → Что стало → Как проверить → Вклад в цели`.
- Новые бизнес-правила — server-first; frontend только объясняет состояние и доступные действия.
- Friendly operational UX — сквозной контракт: длительное действие показывает реальный текущий этап, animation/spinner только при фактической работе, понятный следующий результат, мгновенный success/error state и при необходимости toast/Event Center. Не использовать декоративный progress, ложный ETA, бесконечную анимацию после завершения или скрытый background refresh; соблюдать `prefers-reduced-motion`.
- Reuse-first, no-regression, server-load и multi-user правила: [`docs/ENGINEERING_PLAYBOOK.md`](docs/ENGINEERING_PLAYBOOK.md).
- Release-gate и Browser-проверки не запускать автоматически.

## In Progress

- [ ] **Release stabilization / manual Browser-smoke gate**.
  Implementation work по текущему MVP закрыт. Остаётся только ручное подтверждение ключевых сценариев в UI по явному запросу пользователя; автоматический Browser-smoke не запускать.

## Next — UX/Product

- [x] **P1 EPIC: Site monitoring + scoped crawl + compare workspace — MVP complete** (`HIGH`).
  Цель: одна модель должна поддерживать мониторинг одного сайта, несколько сайтов в проекте, аномалии и ручное/автоматическое сравнение страниц.
  Итог 2026-06-29: пользовательский MVP готов. Проект поддерживает самостоятельные сайты, scoped crawl, site cards, multi-site runs, anomaly baseline, Page Inspector, redirects/errors/retry, personas, visual/code/structure Compare и selected-block compare. Оставшиеся пункты ниже являются расширениями после stabilization, а не блокерами MVP.
  Evidence 2026-06-29: targeted backend suite по site scope, multi-site run, redirects, retries, personas, browser-runtime guard, worker/cancel/recovery → `17 passed`.

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
  - baseline строится по нескольким успешным прогонам конкретного сайта/scope и default persona; API возвращает `crawl_persona_id/persona_label`, UI показывает, для какого контекста считается мониторинг;
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
    3. browser-based login scenario для CSRF/dynamic forms — foundation готов: Playwright runtime умеет применять persona browser state (`cookies/localStorage/sessionStorage/headers`) в runtime consent audit; login capture API contract готов (`start/status/complete/cancel`, duplicate guard, auto-expire, без хранения secrets в capture-row); UI wizard MVP готов: ручной режим `Открыть сайт для входа` + вставка Playwright storageState; managed capture backend/runtime contract готов: feature flag, endpoint `capture-managed`, Playwright service и безопасное сохранение storageState тем же encrypted bundle; интерактивный managed-session lifecycle готов: `start/status/save/cancel`, session id, UI-состояния и сохранение state без вставки JSON; readiness guard готов: backend предупреждает, если state пустой/похож на login-page, UI показывает причины и даёт явное `Сохранить принудительно`; bridge открытия реального управляемого окна в dev/runtime окружении готов на уровне UX/status payload: backend возвращает headless/headed/DISPLAY-состояние, recommended env и команду перезапуска, UI объясняет MFA/2FA workflow и fallback на ручной storageState; browser-crawler adapter MVP готов: если persona содержит `localStorage/sessionStorage`, run идёт через Playwright-контекст с cookies/storage/headers, иначе остаётся быстрый HTTP-crawler; диагностика Chromium/Playwright готова: runtime startup отдаёт `browser_runtime_unavailable`, navigation failures становятся page-level `browser_navigation_*` без утечки технических деталей; UI-индикатор runtime готов: `Run.crawl_runtime` сохраняется в истории и отображается как `HTTP runtime` / `Browser runtime`; resource/retry policy готова: browser-runs ограничены `CRAWL_BROWSER_MAX_PAGES/SECONDS`, а retry проблемных страниц повторяет исходный browser-context вместо HTTP-only; single-run UX guard готов: негостевая persona без active session блокируется до API, select показывает `без сессии/истекла/подключена`, optimistic queued-state создаётся только после успешного ответа backend; следующий шаг — stabilization gate.
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
  - persona-aware retries:
    - retry одной страницы и массовый retry проблемных страниц всегда выполняются в контексте persona исходного run;
    - негостевой retry без активной сессии блокируется с понятной причиной `сессия не подключена/истекла/недоступна`, а не запускается тихо как `Гость`;
    - UI явно подписывает действие как `Повторить как <контекст>` и показывает session-status в результате.
  - безопасная экономия ресурсов между персонами:
    - по умолчанию `Безопасная`: каждую персону нужно реально открыть/проверить, но тяжёлый анализ можно переиспользовать после доказанного совпадения fingerprint;
    - доказательство совпадения: status, final URL, content-type, HTML hash и позднее rendered/snapshot hash;
    - если совпало, page result получает `reused_from_page_id`/`reuse_reason`, а UI показывает `Контент совпадает с “Гость”; анализ переиспользован`;
    - не пропускать проверку авторизованной персоны заранее: redirect на login, 403 или role-only блоки должны быть обнаружены;
    - режимы позже: `Безопасная`, `Максимальная`, `Выключена`.
  - пароли, cookie values и tokens хранятся encrypted-at-rest, не попадают в crawl artifacts/logs/API responses и доступны только через server-side secret references;
  - baseline и anomaly signals всегда scoped по `project_site_id + persona_id + scope`, иначе различия ролей будут ошибочно считаться аномалиями; default-persona baseline зафиксирован тестом, runs других personas не влияют на сигнал.

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

- [x] **MEDIUM Reuse: collapse-reset windowed lazy loader audit**.
  Audit 2026-06-28: второго подтверждённого call-site нет. Collapse-reset/windowed children остаются локально в `ProjectStructureTree`; `useIncrementalPager` и section-nav observers имеют другой контракт. Shared abstraction не выносить до появления второго дерева/иерархии с тем же UX.

- [x] **MEDIUM Reuse: search highlighting rollout audit**.
  Audit 2026-06-28: `HighlightedText` оставлен для Structure/project search и точечно расширен на Users/RootAdmins email search, где результат прямо сопоставляется с видимым email. Activity/Monitoring не расширять без отдельного UX-сценария: там есть event-context highlighting и смешанные типы строк.

## Reliability and Foundations

- [x] **P1 Legacy cleanup — Project terminology and compatibility removal** (`HIGH`, staged).
  Цель: не строить target monitoring поверх старой profile-модели. Стадия разработки позволяет делать breaking cleanup, если оно снижает сложность.
  - Audit: [`docs/audits/LEGACY_AUDIT_2026-06-27.md`](docs/audits/LEGACY_AUDIT_2026-06-27.md).
  - 1. Safe cleanup: README/user-facing wording and obsolete compatibility endpoints — закрыто; live role hints and breadcrumb fallback no longer use project/profile legacy wording.
  - 2. Backend cleanup: `POST /runs/start/{profile_id}` удалён; `GET /runs/by-profile/{profile_id}` заменён на `/runs/by-project/{project_id}`; live scan confirms no active compatibility endpoint.
  - 3. Frontend terminology: `ProfileDashboardPage → ProjectDashboardPage`, `ProfileNewPage → ProjectNewPage`, `profileListCache → projectListCache` — закрыто.
  - 4. Route/API rename: `/profiles/* → /projects/*`, `/profiles/{id}/sites → /projects/{id}/sites`, `profiles.edit → projects.edit` — закрыто.
  - 5. DB rename wave: `profiles → projects`, `profile_id → project_id` — закрыто.
  - 6. Project container cleanup: duplicate site fields removed from `projects`; `ProjectSite` is now the source for URL/scope/limits/allowlist.
  - Historical Alembic revisions/archive docs may still mention `profiles/profile_id`; keep them as migration/history records, not live product contract.

- [ ] **P0 Stabilization gate** (`HIGH`, implementation complete; manual smoke pending).
  Technical gate 2026-07-01 passed: backend target monitoring `1 passed`, backend renderer `4 passed`, frontend project UI `30 passed`, TypeScript/build passed, Alembic head `f2c9a7e8d104`, `git diff --check` passed.
  Осталось ручное Browser-smoke подтверждение project/run сценариев по отдельному запросу: два независимых запуска, immediate project visibility, FINISHED pages, duplicate conflict.

- [x] **P0 Observer notification visibility parity** (`HIGH`).
  Backend viewer/editor без `events.view` получают `403`, frontend не монтирует Event Center и не показывает Settings-link без `events.view`; event state mutations scoped по видимым событиям (`target_user_id is null` или текущий user). Явный viewer Browser-smoke остаётся только по запросу.

- [x] **P0/P1 Operations reliability + unattended recovery — MVP complete** (`HIGH`).
  Celery boundary, lease/heartbeat, bounded retries/backoff, timeout/cancel, health/readiness; Telegram digest только после достоверных signals.
  Итог 2026-06-29: crawler уже работает через durable job boundary/worker, умеет восстанавливать stale/expired jobs, показывает queued/running/retry состояния, поддерживает bounded backoff, active-job restore после reload, readiness panel и быстрый cancel. Extended operations/event log оставлен только как optional расширение, если компактной панели и Event Center окажется недостаточно.
  Evidence 2026-06-29: targeted backend suite по worker queue/tick, readiness recovery, retry backoff, active jobs restore и cancel interrupt входит в общий `17 passed` выше.
  - 1. Stale recovery MVP готов: `RUNNING` run без progress heartbeat дольше `CRAWL_STALE_RUNNING_SECONDS` автоматически помечается `FAILED/stale_run_recovered` при чтении истории или перед новым запуском сайта/проекта; это снимает вечную блокировку site-run после падения процесса.
  - 2. Cancel API MVP готов: `POST /runs/{run_id}/cancel` переводит активный run в `CANCEL_REQUESTED`; crawler проверяет флаг между страницами и завершает run как `CANCELLED`. До финального `CANCELLED` сайт считается занятым, retry недоступен.
  - 3. Crawler readiness MVP готов: `GET /crawler/readiness` показывает sync-mode, worker disabled, active/cancel-requested runs, stale recovery threshold/recovered count и sample активных runs для admin/root-admin.
  - 4. Durable job/lease boundary foundation готов: `crawler_run_jobs` фиксирует site-run jobs, sync runner берёт lease `sync-backend`, пишет heartbeat и закрывает job как `SUCCEEDED/FAILED/CANCELLED`; readiness показывает job counters/sample. Execution пока остаётся synchronous.
  - 5. Worker execution tick MVP готов: при `CRAWLER_WORKER_ENABLED=1` start API ставит jobs в `QUEUED`, `POST /runs/worker/tick` claim-ит одну queued job, берёт lease `crawler-worker` и выполняет её через общий runner. Это manual tick, ещё не continuous daemon.
  - 6. Continuous worker loop MVP готов: `python -m app.worker.crawler_worker` обрабатывает queued jobs в отдельном процессе до SIGTERM/SIGINT; `CRAWLER_WORKER_POLL_SECONDS` задаёт polling, `CRAWLER_WORKER_TICK_LIMIT` нужен для bounded/dev runs.
  - 7. Docker Compose worker service готов: dev stack поднимает `crawler_worker` вместе с backend/frontend; backend работает с `CRAWLER_WORKER_ENABLED=1`, поэтому site-runs попадают в очередь, а worker забирает их автоматически.
  - 8. Worker recovery/readiness MVP готов: readiness закрывает expired `RUNNING/CANCEL_REQUESTED` jobs с истёкшей lease, освобождает сайт для нового запуска, показывает `recovered_expired_jobs`, stale queued diagnostics и переводит статус в `degraded`, если очередь ждёт дольше `CRAWLER_JOB_STALE_QUEUED_SECONDS`.
  - 9. UI worker execution indication MVP готов: Project Dashboard больше не имитирует `RUNNING` сразу после клика; queued start-site/start-project показываются как `В очереди worker`, pending job хранится локально, runs/readiness polling продолжается до появления real run, live-блок различает этапы `очередь → worker взял → crawler обходит`.
  - 10. Persistent active job status MVP готов: `GET /runs/active-job/by-site/{site_id}` возвращает active crawler job сайта с site/persona metadata или `active=false`; Project Dashboard восстанавливает queued pending-блок после reload без ожидания нового run.
  - 11. Bounded job retries/backoff MVP готов: worker не падает процессом на retryable job failure; transient failures переоткладываются в `QUEUED` до `CRAWLER_JOB_MAX_ATTEMPTS` с `CRAWLER_JOB_RETRY_BACKOFF_SECONDS`, non-retryable настройки/session/scope failures остаются terminal. Page retry/backoff уже был реализован отдельно.
  - 12. Project-level active jobs recovery MVP готов: `GET /runs/active-jobs/by-project/{project_id}` возвращает все active jobs проекта с site/persona metadata; Project Dashboard восстанавливает queued pending jobs всех сайтов после reload, включая сценарий `Запустить все сайты`.
  - 13. Pending retry/backoff explanation MVP готов: Project Dashboard показывает в pending-блоке retryable worker job: следующую попытку `N из M`, время до повторного запуска и причину последнего сбоя.
  - 14. Lightweight operations panel MVP готов: Project Dashboard для admin/root-admin показывает readiness crawler, режим `worker/sync`, queued/running/cancel-requested jobs, возраст старейшей queued job, recovered expired jobs и первые degraded-issues; запросы readiness в UI теперь guard-ятся правом `audit.view`.
  - 15. Fast cancel interrupt MVP готов: во время run отдельный cancel-watchdog отслеживает `CANCEL_REQUESTED` и закрывает текущий HTTP/browser client, чтобы прервать зависший fetch быстрее сетевого timeout; частично оборванная текущая страница не сохраняется как page-error, уже сохранённые страницы остаются в истории.
  - Следующее: extended operations/event log для worker только если компактной панели и notification center недостаточно; иначе перейти к governance/quotas.

- [x] **P1 Project governance — quotas, ownership, membership** (`HIGH`, follows Site foundation).
  Quotas foundation готова: role-based limits для project count, sites per project, max pages/concurrency per site, active crawler jobs per user и bulk-run size; env overrides `QUOTA_{ROLE}_...`.
  Membership foundation и management UI готовы: `project_memberships`, creator=`owner`, admin/root-admin global access, viewer/editor видят только member-проекты; owner/admin могут добавлять, менять роль и удалять участников. Compatibility fallback для проектов без membership удалён: такие проекты доступны только admin/root-admin до назначения owner.
  Friendly quota UX готов: create project/site, settings save и site/project run показывают понятное объяснение лимита, текущего значения, запрошенного действия и следующего шага для пользователя.
  Quota overview готов: Settings показывает admin/root-admin read-only обзор лимитов ролей из `QUOTA_{ROLE}_...`.
  Storage budget visibility готова: Settings показывает budget из `SCAN_STORAGE_BUDGET_MB`, фактическое использование raw HTML/rendered snapshots, retention `SCAN_RAW_ARTIFACT_RUNS_TO_KEEP` и крупнейшие проекты по raw HTML. Жёсткая enforcement-очистка сверх retention пока не нужна: `scan_retention` уже ограничивает тяжёлые artifacts последних successful runs.
  Финальный membership compatibility audit готов: runtime-допуск `project without memberships → visible to everyone` удалён; README обновлён под обязательную membership-модель.
  Canonical site/path scope и duplicate policy перенесены в epic `Site monitoring + scoped crawl + compare workspace`, чтобы не вести два конкурирующих контракта.

- [x] **P1 Protected emergency root actor** (`HIGH`).
  `EMERGENCY_ROOT_ADMIN_EMAIL` добавляет config-backed break-glass root-admin в effective runtime access, скрывает его из обычного Users list без прямого поиска, защищает от удаления через root-admin management и bulk user actions, оставляет действия audit-visible.

## Release Gate / Deferred

- [x] Staging-scale count-less counters recheck: Events/Users/Activity (`MEDIUM`, release-gate).
  `include_total=false` закреплён для Users/Audit/Login history: API отдаёт страницу и `total: null`, не заставляя UI ждать дорогой `COUNT(*)` на больших таблицах. Проверка 2026-06-29: `docker compose exec backend env PYTHONPATH=/app pytest -q tests/test_api_integration.py -k "include_total_false"` → `3 passed`.
- [x] Users vs RootAdmins device/session parity on staging-sized data (`MEDIUM`, release-gate).
  RootAdmins page использует тот же snapshot/profile enrichment для trusted-devices/session summary, что Users list; расхождение `trusted_devices_count` зафиксировано тестом. Проверка 2026-06-29: `docker compose exec backend env PYTHONPATH=/app pytest -q tests/test_api_integration.py -k "users_and_root_admins_pages_have_parity_for_trusted_devices_count"` → `1 passed`.
- [x] Cleanup synthetic load-test data near production (`LOW`, prefer restore/reset).
  No-op cleanup закрыт 2026-06-29: текущая dev DB не содержит старого synthetic scale-up из `AUDIT_DB_INDEX_2026-02-24` (`login_history=38`, `admin_audit_logs=6`, `trusted_devices=7`, `projects=1`, `runs=1`). Удаляющий скрипт не добавлялся намеренно: без подтверждённого мусора безопаснее restore/reset, чем частичный destructive SQL.
- [x] Backend schedule contract (`P1`, после Browser-smoke): сохранённое расписание, timezone, duplicate-run guard, pause/resume и следующий запуск.
  Готово 2026-06-30: добавлена таблица `project_schedules`, API `GET/PUT /projects/{id}/schedule`, `pause/resume`, operational tick `POST /projects/schedules/run-due` под admin-level `audit.view`; расписание поддерживает `daily/weekly`, `HH:MM`, IANA timezone и next_run_at. Duplicate guard не создаёт новый запуск, если в проекте уже есть активный run/job. UI `Проект → Настройки → Расписание` больше не manual-only: можно включить/поставить на паузу, выбрать частоту/дни/время/timezone и увидеть следующий запуск.
  Follow-up 2026-07-01: due schedules подключены к `crawler_worker` loop. Worker проверяет расписания по `CRAWLER_SCHEDULE_POLL_SECONDS` и ставит due project-sites в durable queue; переключатель `CRAWLER_SCHEDULES_ENABLED` позволяет выключить автопланировщик без удаления сохранённых расписаний.
  UX follow-up 2026-07-01: в UI расписания добавлена секция `Будет запущено` — включённые сайты проекта, default persona и статус сессии; отключённые сайты показаны отдельным счётчиком как не участвующие в авторанe.
- [x] Friendly UX/UI refinement wave (`P1`, implementation pass complete):
  - UX-принцип 2026-06-30: интерфейс должен быть понятен структурой, а не пояснительными простынями. Минимизировать текст, убрать дубли, не использовать нативные dropdown там, где они визуально ломаются; короткие варианты показывать chips/segmented, длинные — combobox/command palette, справку переносить в `?`.
  - 2026-06-29 старт волны: Settings `Лимиты ролей`/`Хранилище сканов` переведены в раскрываемые friendly-секции с русскими метриками и техническими деталями под disclosure; `Вы` перенесён рядом с email в Users, RootAdmins и project members; системная роль участника проекта русифицирована.
  - 2026-06-29 server contract: одинаковый URL/scope в разных проектах разрешён; duplicate scope внутри одного проекта остаётся запрещённым через `project_site_scope_conflict`.
  - 2026-06-29 create project UX: форма создания поддерживает несколько site cards через `+ Добавить сайт`, локально объясняет duplicate scope внутри формы и добавляет дополнительные сайты сразу после создания проекта.
  - 2026-06-29 project page IA: вкладки `Основная / История / Настройки` подняты над карточками сайтов, карточки сайтов скрыты на вкладке настроек, `Запустить все сайты` показывается только для multi-site проектов, admin/root readiness свернут в компактную disclosure-панель.
  - 2026-06-29 main tab UX: `Мониторинг отклонений` и `Последний прогон` объединены в `Рабочую сводку`, техническое объяснение baseline спрятано в disclosure, подробные метрики последнего прогона стали раскрываемым блоком.
  - 2026-06-29 structure UX: блок `Структура сайта` стал компактнее — live/ready summary остаётся видимым, stage pipeline, детали среза и легенда структуры раскрываются по запросу; старые отдельные кнопки `Показать новые/ошибки` заменены едиными быстрыми фильтрами `Все / Новые / Ошибки`.
  - 2026-06-29 persisted disclosure UX: раскрываемые блоки страницы проекта сохраняют open/closed в localStorage (`admin readiness`, baseline, метрики, процесс структуры, детали среза, легенда), чтобы UI не сбрасывал выбор пользователя после перезагрузки.
  - 2026-06-29 project settings IA: вкладка `Настройки` собрана в persistent accordion-секции `Сайты и контексты доступа`, `Участники и права`, `Расписание`, `Опасная зона`; ручной режим расписаний остался честным manual-only состоянием.
  - 2026-06-29 project members UX: добавление участника переведено на searchable combobox по `/admin/users?status=all&q=...` с подсветкой совпадений и состояниями `уже участник / можно добавить / ожидает подтверждения / заблокирован / удалён / не найден`; заведомо недоступные варианты блокируют `Добавить`.
  - 2026-06-30 project settings cleanup: внутренние компоненты `ProjectSitesSettings` и `ProjectMembersSettings` получили `compactHeader`, чтобы внутри accordion не дублировать крупные заголовки секций.
  - 2026-06-30 stage 1 done: main tab очищен от пояснительных простыней, `Рабочей сводки`, `Показателей последнего прогона` и отдельного блока контекста; карточки сайтов стали компактными.
  - 2026-06-30 stage 2 done: контекст просмотра и домены перенесены в `Структуру сайта` chips-контролами; домены поддерживают мультивыбор, поиск расширен по `URL`, `final URL`, домену, HTTP/status/error и SEO-полям `title/description/h1` из lightweight списка страниц.
  - 2026-06-30 stage 2 follow-up done: Structure workspace в режиме `Все контексты` строит отдельные секции по персонам/последним runs, чтобы `Гость`, `Партнёр` и будущие авторизованные контексты не смешивались в одно дерево; открытие страницы и retry привязаны к run конкретной секции.
  - 2026-06-30 stage 2 follow-up polish done: multi-context Structure показывает компактные карточки контекстов со счётчиками, а дерево раскрывает только активный контекст; это сохраняет обзор и не превращает страницу в длинную простыню при нескольких personas.
  - 2026-06-30 stage 2 domain polish done: доменный scope в Structure переведён в компактный раскрываемый picker с поиском; выбранные домены видны как summary, полный список не занимает экран постоянно.
  - 2026-06-30 stage 3 done: история прогонов переведена в компактные карточки с chips (`контекст`, `runtime`, `страницы`, `изменения`, `длительность`), а старт/финиш/current URL/failure-details спрятаны в persistent `Детали`.
  - 2026-06-30 stage 4 done: вкладка project `Настройки` больше не accordion-свалка — разделы `Сайты / Участники / Расписание / Опасная зона` стали навигационными карточками, ниже показывается только выбранный раздел; контейнерные поясняющие тексты убраны.
  - 2026-06-30 stage 4 follow-up done: внутренние формы `ProjectSitesSettings`/`ProjectMembersSettings` больше не используют `UiSelect`; короткие выборы ролей/типов переведены на chip controls без изменения backend-контрактов. Общую справку через будущую кнопку `?` держать отдельным UX-паттерном.
  - 2026-06-30 stage 5 done: Compare стал явным wizard-flow — выбор левой/правой страницы фиксирует URL, snapshots/context грузятся только по кнопке `Сравнить`; режимы `Визуально/Код/Структура` показываются после загрузки обеих сторон, автоподбор пары получил toggle.
  - 2026-06-30 stage 5 follow-up done: Compare visual polish получил подсветку auto-picked строк, micro-spinner при загрузке стороны/snapshots и отдельный focus workspace для результата сравнения.
  - 2026-06-30 stage 6 done: левый sidebar получил compact collapse/expand rail с сохранением состояния; правый event-center получил режимы `Оба` (текущий 50/50), `Уведомления` и `Лента` с сохранением выбора.
  - 2026-06-30 stage 6 follow-up done: правый event-center получил третью область `Очередь задач` на базе `/crawler/readiness`; режим `Все` делит высоту как `Уведомления / Лента / Очередь` примерно 33/33/33, отдельный режим `Очередь` раскрывает её на всю высоту. Job-level actions оставить до backend-контракта управления job-id.
  - 2026-06-30 stage 7 done: добавлен общий hover/focus polish для interactive cards, persistent details/disclosure summaries, compare page results и element-picker controls; keyboard polish combobox (`↑/↓/Enter`, ARIA active descendant) оставлен после визуальной проверки.
  - Итог 2026-07-01: минималистичная IA/UX-волна закрыта; дальнейшие правки вести только по результатам ручного smoke или конкретных UX-наблюдений.
- [x] Snapshot/Compare polish (`P2`, implementation complete; performance extensions deferred):
  - 2026-07-01 stage 1 done: Compare visual workspace получил синхронный scroll левой/правой страницы и переключатель высоты `Компактно / Удобно / Высоко`; оба выбора сохраняются локально, чтобы пользователь мог настроить удобную рабочую область один раз.
  - 2026-07-01 stage 2 done: browser-runtime crawl сохраняет rendered screenshot и element-map прямо во время persona-run; UI получает `rendered_snapshot.available=true` сразу после browser-прогона, без ручного пересоздания из сохранённого HTML.
  - 2026-07-01 stage 3 done: runtime consent audit сохраняется в `page_consent_audits`, Inspector показывает историю последних проверок страницы и обновляет её после ручного запуска. Очередь audit jobs оставлена отдельным backend-контрактом, чтобы не плодить полусырые queued states.
  - Deferred only if needed: queued consent audits, server-side search/true virtualization и deeper compare optimizations включать только при подтверждённой просадке на больших runs.
- [x] Frontend production polish (`P2`, current gate passed):
  - 2026-07-01 stage 1 done: основные страницы workspace/settings/project/compare/inspector/debug переведены на lazy routes; цель — убрать Vite warning про `index` chunk > 500 kB без изменения UX и backend.
  - Итог 2026-07-01: production build проходит без Vite chunk warning; manualChunks/глубокое дробление не делать, пока warning или задержка первого экрана не вернутся.
- [x] Target monitoring/subscriptions (`P2`, implementation complete):
  - 2026-07-01 stage 1 done: выбранный visual block в Compare можно сохранить как `page_monitoring_target`; backend хранит selector/tag/text/html-fragment/rect/fingerprint hash, а UI показывает friendly next step без обещания уже работающих уведомлений.
  - 2026-07-01 stage 2 done: добавлен ручной occurrence check для сохранённой цели — backend ищет блок по selector и fallback fingerprint в выбранной версии страницы, возвращает `matched/changed/missing/not_checkable`; Compare показывает кнопку `Проверить цель` после сохранения.
  - 2026-07-01 stage 3 done: после каждого успешного run backend автоматически проверяет активные цели этого сайта+персоны, сохраняет историю в `page_monitoring_target_checks` и отдаёт её через API.
  - 2026-07-01 stage 4 done: на основной вкладке проекта добавлена секция `Цели мониторинга` — compact cards по выбранному сайту, friendly-статусы (`На месте/Изменился/Не найден/Ждёт прогона`), последняя проверка прямо в списке и lazy history при раскрытии цели.
  - 2026-07-01 stage 5 done: проблемные результаты целей (`changed/missing/not_checkable`) создают notification event `monitoring.target.changed` в Event Center с deep-link на проект, severity `warning/danger` и meta по target/check/run/page. `matched` не создаёт шумных уведомлений.
  - 2026-07-01 stage 6 done: добавлено управление lifecycle целей — rename, pause/resume и delete через `PATCH/DELETE /runs/monitoring-targets/{id}`; UI показывает inline rename, pause/resume и удаление с подтверждением. Paused targets не проверяются автоматически и не создают уведомления.
  - 2026-07-01 stage 7 done: заложен backend-контракт external notification subscriptions/outbox для target monitoring. Подписка не привязана к одному “адресу”: `channel_type=email` использует email destination, `channel_type=telegram_chat` использует Telegram chat id/username destination; outbox получает queued payload при `changed/missing/not_checkable` с учётом статусов и throttling `min_interval_minutes`.
  - 2026-07-01 stage 8 done: добавлен delivery handler для monitoring notification outbox и endpoint `POST /runs/monitoring-notifications/worker/tick`. Email доставляется через SMTP utility, Telegram chat — через Bot API при `TELEGRAM_BOT_TOKEN`; если SMTP/Telegram не настроены, outbox-row помечается `failed` с понятной причиной, а tick не валит worker.
  - 2026-07-01 stage 9 done: UI-настройки подписок добавлены в карточку цели (`Детали цели → Уведомления`): добавить email/Telegram channel, выбрать статусы chips, задать throttling, pause/resume/delete subscription и посмотреть последние доставки queued/sent/failed с ошибкой.
  - 2026-07-01 stage 10 done: delivery outbox получил retry/backoff policy (`next_attempt_at`, `max_attempts`, env `MONITORING_NOTIFICATION_RETRY_BACKOFF_SECONDS`, `MONITORING_NOTIFICATION_MAX_ATTEMPTS`) и terminal status `dead` после лимита попыток. Diagnostics endpoint показывает SMTP/Telegram configured-state и counts (`queued/retry_ready/failed_waiting/sent/dead`); UI показывает `попыток N/M`, следующую попытку и `Остановлено`.
  - 2026-07-01 stage 11 done: admin/root-admin diagnostics card добавлена в операционную область проекта: показывает готовность Email/Telegram, очередь, retry-ready, failed-waiting, sent/dead, max attempts и backoff policy без раскрытия secrets.
  - 2026-07-01 stage 12 done: для каждого канала подписки добавлены `Preview` и `Тест`: preview показывает subject/body без отправки, test-send создаёт тестовую check/outbox запись, сразу пытается доставить и показывает результат в UI/истории доставок.
  - Итог 2026-07-01: selected visual block можно превратить в monitoring target; проверки идут автоматически после успешных runs; события, email/Telegram outbox, retry/backoff, diagnostics и test-send закрыты.
- [ ] Extended operations/event log (`P2`, только если потребуется): отдельный подробный журнал worker-событий сверх текущих queued/running/retry states, readiness panel и Event Center.
- [ ] Telegram user channels/report preview (`P2`, после subscriptions + outbox): отдельный report preview/digest для Telegram user channels; не смешивать с operational target alerts.

## Recently Done

- [x] **P1 Project governance — project membership foundation**.
  - Что было: `data.view/projects.edit` давали доступ ко всем проектам, кроме различий между ролями.
  - Что стало: добавлены модель и миграция `project_memberships`. Новый проект получает owner membership для создателя; обычные viewer/editor видят и запускают только member-проекты; admin/root-admin сохраняют глобальный доступ. Runtime fallback для проектов без membership удалён: такие проекты доступны только admin/root-admin до назначения owner.
  - Как проверить: `docker compose exec backend env PYTHONPATH=/app alembic upgrade head`; `docker compose exec backend env PYTHONPATH=/app pytest -q tests/test_api_integration.py`.
  - Вклад в цели: появилась server-side основа ownership/visibility без UI-управления участниками (`high` governance/security).

- [x] **P1 Project governance — role-based quota foundation**.
  - Что было: роль давала permission на запуск/редактирование, но не ограничивала стоимость настроек и размер очереди.
  - Что стало: добавлен `project_quotas` service. Backend проверяет project create, site create/update, start-site и start-project: `max_projects`, `max_sites_per_project`, `max_pages_per_site`, `max_concurrency_per_site`, `max_active_jobs_per_user`, `max_bulk_sites_per_run`. Ошибки возвращаются как friendly `quota_exceeded` с `quota/limit/current/requested`.
  - Настройка: env overrides вида `QUOTA_EDITOR_MAX_PAGES_PER_SITE`, `QUOTA_EDITOR_MAX_ACTIVE_JOBS_PER_USER`, `QUOTA_ADMIN_MAX_BULK_SITES_PER_RUN`.
  - Как проверить: `docker compose exec backend env PYTHONPATH=/app pytest -q tests/test_api_integration.py -k "quota or duplicate_canonical_scope or project_sites_are_created or start_project"`.
  - Вклад в цели: crawler получил server-side защиту от слишком дорогих запусков до появления полноценной ownership/membership модели (`high` production readiness).

- [x] **HIGH Scan storage retention + permanent stats policy**.
  - Что было: каждый successful crawl сохранял HTML в `pages.html`, а rendered snapshots могли оставаться файлами без ограничителя объёма.
  - Что стало: добавлен `scan_retention` policy: по умолчанию raw artifacts сохраняются только для двух последних `FINISHED` runs одного site+persona (`latest + previous`). У старых runs очищается тяжёлый HTML и удаляется rendered snapshot directory, но URL/status/hash/timing/run counters остаются для истории, статистики и baseline. Project delete дополнительно удаляет rendered snapshot files всех runs проекта.
  - Настройка: `SCAN_RAW_ARTIFACT_RUNS_TO_KEEP` от 1 до 20, дефолт 2.
  - Как проверить: `docker compose exec backend env PYTHONPATH=/app pytest -q tests/test_api_integration.py -k "scan_retention or inflight_fetch or cancel_requested or crawler_readiness or primary_site"`.
  - Вклад в цели: storage growth ограничен без потери постоянных агрегатов (`high` production readiness).

- [x] **P0/P1 Operations reliability — fast cancel interrupt**.
  - Что было: cancel гарантированно срабатывал между страницами, но уже начатый fetch мог ждать сетевой/browser timeout.
  - Что стало: `_execute_site_run` запускает `RunCancelWatcher`, который отдельным коротким DB-poll отслеживает `CANCEL_REQUESTED` и закрывает активный HTTP/browser client. Если cancel пришёл во время fetch, run финализируется как `CANCELLED`, а текущая оборванная страница не превращается в ложный `timeout/error`.
  - Как проверить: `docker compose exec backend env PYTHONPATH=/app pytest -q tests/test_api_integration.py -k "cancel_run or cancel_requested or inflight_fetch or worker_job_retries or crawler_readiness"`.
  - Вклад в цели: остановка crawler стала отзывчивее и безопаснее для production-like worker-mode (`high` operations reliability/friendly UX).

- [x] **P0/P1 Operations UX — crawler readiness panel**.
  - Что было: readiness был доступен через API, но в Project Dashboard admin видел только локальный pending-блок; роли без `audit.view` могли лишний раз обращаться к защищённому endpoint и получать silent 403.
  - Что стало: добавлена компактная операционная панель для admin/root-admin: readiness, режим исполнения, queued/running/cancel-requested, старейшая queued job, recovered expired jobs и первые warning/critical issues. UI дергает `/crawler/readiness` только при наличии `audit.view`.
  - Как проверить: зайти admin/root-admin в Project Dashboard; при worker-mode увидеть `Crawler: Готов`, `Режим: worker`, counters очереди. Typecheck: `corepack pnpm --dir frontend exec tsc -b`.
  - Вклад в цели: production-like worker-mode стал наблюдаемым прямо в рабочем экране без отдельного API/debug шага (`high` friendly admin UX/operations).

- [x] **P0/P1 Operations reliability — continuous crawler worker loop MVP**.
  - Что было: worker execution был доступен только как ручной `POST /runs/worker/tick`, то есть без постоянного обработчика очереди.
  - Что стало: добавлен запускаемый процесс `python -m app.worker.crawler_worker`. Он требует `CRAWLER_WORKER_ENABLED=1`, claim-ит queued jobs через общий worker-step, логирует обработку, ждёт `CRAWLER_WORKER_POLL_SECONDS` при пустой очереди и корректно останавливается по SIGTERM/SIGINT. `CRAWLER_WORKER_TICK_LIMIT` позволяет bounded/dev запуск.
  - Как проверить: `docker compose exec backend env CRAWLER_WORKER_ENABLED=1 CRAWLER_WORKER_TICK_LIMIT=1 PYTHONPATH=/app python -m app.worker.crawler_worker`.
  - Вклад в цели: появился реальный long-running worker entrypoint (`high` operations architecture).

- [x] **P0/P1 Operations reliability — docker-compose worker service by default**.
  - Что было: worker process существовал, но его нужно было запускать отдельной ручной командой; `docker compose up -d --build` поднимал только API/frontend/infra, а backend мог остаться в synchronous-mode.
  - Что стало: в `docker-compose.yml` добавлен `worker` service на том же backend image/volume. Backend и worker получают `CRAWLER_WORKER_ENABLED=1`, поэтому обычный dev stack сразу работает через очередь: start-site создаёт queued job, worker автоматически забирает и выполняет её.
  - Как проверить: `docker compose config --services` должен показывать `worker`; после `docker compose up -d --build` можно смотреть `docker compose logs -f worker`.
  - Вклад в цели: локальное тестирование стало ближе к целевой архитектуре без отдельного ручного запуска worker (`high` operations usability).

- [x] **P0/P1 Operations reliability — worker lease expiry + stale queue readiness**.
  - Что было: активная job с истёкшей lease могла оставаться `RUNNING/CANCEL_REQUESTED` и блокировать сайт; старая `QUEUED` job была видна только как счётчик без операционного объяснения.
  - Что стало: `recover_expired_crawler_jobs` закрывает expired active jobs как `FAILED/CANCELLED`, синхронизирует связанный `Run`, очищает lease и освобождает сайт. `GET /crawler/readiness` показывает `jobs.diagnostics`: stale queued count/sample, oldest queued age, expired lease sample, `recovered_expired_jobs` и `issues`; при проблемах возвращает `ready=false/status=degraded`.
  - Как проверить: создать старую queued job и expired running job; вызвать `GET /crawler/readiness`; expired job станет terminal, linked run получит `crawler_job_lease_expired`, stale queued останется в очереди и будет видна в diagnostics.
  - Вклад в цели: worker-mode стал безопаснее для production-like эксплуатации: падение worker больше не создаёт вечную блокировку, а backlog отображается явно (`high` operations reliability/friendly admin UX).

- [x] **P0/P1 Operations UX — queued/worker/run visual states**.
  - Что было: после клика UI оптимистично добавлял fake `RUNNING` и затем показывал “завершено” сразу после ответа start API; в worker-mode это неверно, потому что backend только ставит job в очередь.
  - Что стало: Project Dashboard различает этапы: отправка запуска, `QUEUED` job, ожидание worker, реальный `RUNNING` run и terminal run. Pending job отображается в верхнем блоке, блокирует конфликтующие кнопки, live-структура показывает `очередь → worker взял → crawler обходит → обновление структуры`, а общий запуск показывает queued jobs по сайтам.
  - Как проверить: `docker compose up -d --build`; нажать `Запустить выбранный сайт`; увидеть `Сайт ожидает worker / Job #...`, затем live run после появления real run. Typecheck: `corepack pnpm --dir frontend exec tsc -b`.
  - Вклад в цели: пользователь видит честное состояние worker execution и не принимает queued API response за завершённый crawl (`high` friendly UX/reliability).

- [x] **P0/P1 Operations UX/API — persistent active site job status**.
  - Что было: pending job был только локальным состоянием Project Dashboard; после reload backend продолжал держать queued job, но UI терял `Job #...` и пояснение ожидания worker.
  - Что стало: добавлен `GET /runs/active-job/by-site/{site_id}` под `data.view`. Endpoint применяет recovery expired lease через `find_active_site_job`, возвращает active job с site/persona metadata или `active=false`. Project Dashboard при выборе сайта восстанавливает queued pending job из backend.
  - Как проверить: в worker-mode запустить сайт, обновить страницу до того как worker взял job; UI снова показывает `Сайт ожидает worker / Job #...`. Backend targeted: `pytest -q tests/test_api_integration.py::test_worker_enabled_queues_and_tick_executes_site_run`; frontend: `corepack pnpm --dir frontend exec tsc -b`.
  - Вклад в цели: pending worker state стал устойчивым к reload и ближе к production UX (`high` reliability/friendly UX).

- [x] **P0/P1 Operations reliability — bounded crawler job retries/backoff**.
  - Что было: page-level retry уже имел лимит/backoff, но failed worker job становился terminal сразу; transient timeout/network/browser-runtime сбой требовал ручного запуска и мог остановить worker loop.
  - Что стало: `CrawlerRunJob` получает `max_attempts` из `CRAWLER_JOB_MAX_ATTEMPTS` (default 3), worker переоткладывает retryable failures в `QUEUED` с `CRAWLER_JOB_RETRY_BACKOFF_SECONDS` (default `10,30,120`) и продолжает работать. Retryable: timeout/connect/request/http_error/browser navigation/runtime. Non-retryable: persona session, scope, disabled site, no HTML/settings failures.
  - Как проверить: `pytest -q tests/test_api_integration.py::test_worker_retries_transient_job_failure_with_backoff`; первый tick возвращает `status=QUEUED/retry.scheduled=true`, второй tick завершает job успешно при backoff `0`.
  - Вклад в цели: transient сбой больше не требует ручного вмешательства и не валит worker process; retry остаётся ограниченным, чтобы не создавать лишнюю нагрузку на сайт (`high` operations reliability).

- [x] **P0/P1 Operations UX/API — project-level active jobs restore**.
  - Что было: `GET /runs/active-job/by-site/{site_id}` восстанавливал pending UI только для выбранного сайта; после reload при `Запустить все сайты` остальные queued jobs были видны backend, но не восстанавливались в Dashboard как pending.
  - Что стало: добавлен `GET /runs/active-jobs/by-project/{project_id}` под `data.view`. Endpoint проходит по сайтам проекта, применяет active-job recovery, возвращает все active jobs с site/persona metadata. Project Dashboard на initial load восстанавливает queued pending jobs всех сайтов одним запросом.
  - Как проверить: в worker-mode поставить два сайта в очередь, обновить проект; кнопка общего запуска показывает `В очереди: 2`, выбранный сайт показывает `Сайт ожидает worker / Job #...`. Backend targeted: `pytest -q tests/test_api_integration.py::test_project_active_jobs_lists_all_site_jobs`; frontend: `corepack pnpm --dir frontend exec tsc -b`.
  - Вклад в цели: multi-site queue state стал устойчивым к reload и пригодным для production-like общего запуска (`high` friendly operations UX).

- [x] **P0/P1 Operations UX — pending retry/backoff explanation**.
  - Что было: backend уже переоткладывал transient worker job failures, но UI продолжал показывать только `Сайт ожидает worker`, без причины ожидания и номера попытки.
  - Что стало: pending job хранит `attempts/max_attempts/failure_code/failure_message/scheduled_at`; Dashboard показывает `Повторная попытка N из M`, когда она стартует, и причину последнего сбоя в верхнем pending-блоке и live-блоке структуры.
  - Как проверить: смоделировать retryable worker failure; pending-блок должен показать причину (`timeout`/message), номер следующей попытки и `через N сек.` или `уже можно запускать`. Frontend: `corepack pnpm --dir frontend exec tsc -b`.
  - Вклад в цели: ожидание worker стало объяснимым, пользователь понимает, что система сама повторит временный сбой и когда это произойдёт (`high` friendly operations UX).

- [x] **P0/P1 Operations reliability — feature-flagged worker execution tick**.
  - Что было: durable job boundary уже был в DB, но start API всё равно всегда выполнял run синхронно.
  - Что стало: при `CRAWLER_WORKER_ENABLED=1` `POST /runs/start-site/{site_id}` возвращает queued job без немедленного crawl; `POST /runs/worker/tick` claim-ит одну job, ставит lease `crawler-worker` и выполняет общий `_execute_site_run`. Readiness в этом режиме показывает `mode=worker`, queued jobs и active job sample. Повторный start того же сайта блокируется active job.
  - Как проверить: включить `CRAWLER_WORKER_ENABLED=1`, запустить сайт → получить `queued=true/job_id`; вызвать `POST /runs/worker/tick` → получить `processed=true`, `run_status=FINISHED`, job `SUCCEEDED`.
  - Вклад в цели: execution впервые отделён от start request контрактом очереди и lease (`high` operations architecture), но без риска постоянного фонового процесса на этом шаге.

- [x] **P0/P1 Operations reliability — durable crawler job boundary foundation**.
  - Что было: crawler run жил только как строка `runs`; без отдельной job/lease сущности нельзя безопасно вынести execution из request lifecycle.
  - Что стало: добавлена таблица/model `crawler_run_jobs`, migration `ab12c9d4e701`, lifecycle service `enqueue → RUNNING lease/heartbeat → terminal status`. Синхронный start API создаёт job, берёт lease `sync-backend` и закрывает job вместе с run. Readiness показывает job counters и active job sample.
  - Как проверить: `docker compose exec backend alembic upgrade head`; запустить сайт; в DB увидеть `crawler_run_jobs.status=SUCCEEDED` с `run_id`, `heartbeat_at` и очищенным `lease_expires_at`; `GET /crawler/readiness` показывает job counters.
  - Вклад в цели: подготовлен реальный DB-контракт для worker-boundary без риска сломать текущий sync запуск (`high` architecture/reliability).

- [x] **P0/P1 Operations reliability — crawler readiness endpoint MVP**.
  - Что было: оператор видел общий `/health`, но не видел состояние crawler: есть ли активные runs, отменяемые runs, stale recovery и какой режим исполнения включён.
  - Что стало: добавлен `GET /crawler/readiness` под `audit.view`. Endpoint возвращает `ready/status`, текущий mode `synchronous`, worker disabled с пояснением, active counts/sample и stale recovery threshold/recovered count. При чтении readiness stale runs восстанавливаются тем же server-first механизмом.
  - Как проверить: admin/root-admin вызывает `/crawler/readiness`; viewer получает `403`; старый `RUNNING` run становится `FAILED/stale_run_recovered`, свежий active run остаётся в sample.
  - Вклад в цели: появился операционный источник истины перед worker-boundary (`high` operations value), без ложного утверждения, что очередь уже существует.

- [x] **P0/P1 Operations reliability — cancel active run API MVP**.
  - Что было: пользователь/оператор не мог явно остановить активный crawler run; приходилось ждать завершения или stale recovery.
  - Что стало: добавлен `POST /runs/{run_id}/cancel` с permission `crawler.run`. Активный run получает статус `CANCEL_REQUESTED`, retry и новый запуск сайта остаются заблокированы; crawler между страницами переводит run в `CANCELLED`, сохраняет уже собранные страницы и пишет friendly-пояснение. Повторный cancel идемпотентен, terminal run возвращает понятный `409 run_not_active`.
  - Как проверить: создать активный run, вызвать `POST /runs/{run_id}/cancel`; в истории увидеть `CANCEL_REQUESTED`, затем `CANCELLED` после следующего шага crawler.
  - Вклад в цели: добавляет управляемость долгих прогонов без ложного обещания мгновенно оборвать текущий HTTP-запрос (`high` friendly operations UX).

- [x] **P0/P1 Operations reliability — stale RUNNING recovery MVP**.
  - Что было: если backend-процесс падал во время crawler run, запись могла остаться `RUNNING` навсегда и блокировать следующий запуск сайта.
  - Что стало: backend восстанавливает такие runs при чтении истории или перед новым запуском: если `progress_updated_at/started_at` старше `CRAWL_STALE_RUNNING_SECONDS`, run становится `FAILED` с кодом `stale_run_recovered`, очищенным `current_url` и friendly-пояснением. Порог по умолчанию — 30 минут, env ограничен диапазоном 60 секунд — 24 часа.
  - Как проверить: создать старый `RUNNING` run, вызвать `/runs/by-site/{site_id}` или `/runs/start-site/{site_id}`; старый run больше не блокирует запуск и отображается как recovered failure.
  - Вклад в цели: закрывает первый unattended recovery сценарий без Celery-миграции (`high` operations value), сохраняя честный UI-статус вместо вечного “идёт прогон”.

- [x] **MEDIUM Reuse rollout — search highlighting for user email lists**.
  - Что было: подсветка совпадений работала в project search и Structure, но user/root-admin email search показывал обычный текст.
  - Что стало: Users и RootAdmins подсвечивают совпавшую часть email через существующий `HighlightedText`. Activity/Monitoring не затронуты, чтобы не смешивать текстовый search-highlight с event-context highlighting.
  - Как проверить: открыть Users или RootAdmins, ввести часть email в поиск; совпавший фрагмент email подсвечивается в строках.
  - Вклад в цели: повышает понятность search-results там, где пользователь ищет конкретный email (`medium` friendly UX), без расширения abstraction на неподходящие контексты.

- [x] **MEDIUM Reuse audit — collapse-reset windowed lazy loader**.
  - Что было: в TODO висел риск преждевременного reuse для Structure tree.
  - Что стало: проверены frontend call-sites; общий компонент/хук не выносится, потому что подтверждён только один подходящий сценарий — `ProjectStructureTree`. Это сохраняет текущий UX дерева и не добавляет абстракцию без второго потребителя.
  - Как проверить: `rg -n "collapse|expanded|windowed|IntersectionObserver|useIncrementalPager" frontend/src -g '*.{ts,tsx}'`.
  - Вклад в цели: снижает technical debt decision-risk без изменения пользовательского поведения (`medium` architecture hygiene).

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
