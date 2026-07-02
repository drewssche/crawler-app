# Crawler App

Веб-приложение для мониторинга сайтов: проекты, сайты внутри проекта, scoped crawl, сравнение страниц, page inspector, crawl personas, расписания, очередь worker и уведомления по целям мониторинга.

Проект сейчас на dev-stage, но основные пользовательские сценарии уже собраны вокруг целевой модели:

- `Project` — рабочая область, права доступа и настройки.
- `ProjectSite` — самостоятельный сайт внутри проекта: стартовый URL, режим `весь сайт / раздел`, лимиты и роль сайта.
- `CrawlPersona` — контекст обхода сайта: минимум `Гость`, далее авторизованные/партнёрские сессии.
- `Run` — прогон конкретного сайта под конкретной persona.
- `Page` — результат страницы внутри run: HTTP/meta, HTML, rendered snapshot, ошибки, redirects, SEO, links/assets/tracking.

## Быстрый старт

Основная команда для dev-стека:

```bash
docker compose up -d --build
```

Она поднимает backend, frontend, worker, БД и Prometheus. Worker включён по умолчанию: запуск сайта ставится в очередь, а отдельный service забирает задачи.

Адреса:

- Frontend: `http://localhost:5173`
- Backend health: `http://localhost:8000/health`
- Prometheus: `http://localhost:9090`

## Beta deploy и доступы

Пошаговый server guide: [`docs/BETA_DEPLOY_DUCKDNS.md`](docs/BETA_DEPLOY_DUCKDNS.md).

Для beta на собственном сервере/DuckDNS держим две гарантии:

- root-admin из env всегда может попасть в приложение после деплоя;
- остальные пользователи получают доступ через заявку или одноразовую invite-ссылку.

Минимальный server env:

```env
APP_ENV=beta
PUBLIC_APP_URL=https://crawler-app.duckdns.org
SECRET_KEY=replace-with-long-random-secret

ADMIN_EMAILS=you@example.com
EMERGENCY_ROOT_ADMIN_EMAIL=backup@example.com
ADMIN_PASSWORD=replace-with-strong-admin-password
AUTH_ADMIN_PASSWORD_LOGIN_ENABLED=true
AUTH_PASSWORD_LOGIN_ENABLED=true
AUTH_DEV_SHOW_CODE=false

SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=...
SMTP_PASSWORD=...
SMTP_FROM=...
SMTP_USE_TLS=true

VITE_ADMIN_PASSWORD_LOGIN_ENABLED=true
VITE_PASSWORD_LOGIN_ENABLED=true
```

Как это работает:

- `ADMIN_EMAILS` и `EMERGENCY_ROOT_ADMIN_EMAIL` принудительно дают root-admin права указанным email.
- `ADMIN_PASSWORD` создаёт env-admin пользователя при старте backend.
- `AUTH_ADMIN_PASSWORD_LOGIN_ENABLED=true` включает аварийный парольный вход только для email из root-admin env списка.
- `AUTH_PASSWORD_LOGIN_ENABLED=true` включает временный beta-вход по паролю для подтверждённых пользователей. Admin/root-admin может сгенерировать пароль в карточке пользователя и передать его вручную.
- Основной вход пользователей остаётся через email-код.
- Если новый человек сам нажал `Запрос доступа`, admin/root-admin подтверждает его в `Пользователи`.
- Если admin/root-admin создаёт invite в `Пользователи`, человек получает ссылку `/invite/:token`, подтверждает email-кодом и сразу получает заданную роль.

Для публичной beta рекомендуется дополнительно закрыть индексацию:

```text
robots.txt: User-agent: * / Disallow: /
X-Robots-Tag: noindex, nofollow
```

Остановить без удаления данных:

```bash
docker compose down
```

Остановить и удалить тома:

```bash
docker compose down -v
```

## Основные сценарии

### Проекты и сайты

- Проект может содержать один или несколько сайтов.
- Сайт можно сканировать целиком или только внутри раздела через `path_prefix`.
- Одинаковый URL/scope разрешён в разных проектах, но внутри одного проекта duplicate scope запрещён.
- `Запустить выбранный сайт` запускает только активную карточку сайта.
- `Запустить все сайты` показывается только для multi-site проекта и ставит в очередь все включённые сайты.

### Structure и Page Inspector

- Structure показывает дерево страниц выбранного сайта/run/persona.
- Клик по странице открывает контекстное окно внутри интерфейса, а не внешний сайт.
- Page Inspector показывает HTTP/meta, SEO score, ссылки, ассеты, scripts/cookies/analytics, redirects/fetch errors и rendered snapshot.
- Для проблемных страниц есть точечный и массовый bounded retry в контексте исходной persona.

### Compare

Сравнение страниц находится внутри проекта:

```text
/projects/:id/compare
```

Можно сравнивать:

- разные сайты внутри проекта;
- разные версии одной страницы;
- разные personas;
- страницы, подобранные вручную или через auto-match по relative path.

Режимы:

- `Визуально` — rendered snapshots;
- `Код` — HTML diff;
- `Структура` — HTTP/meta/SEO/links/assets comparison.

Compare работает как focus workspace: сайдбары скрываются, чтобы оставить максимум места рабочей области.

### Цели мониторинга

В Compare можно выбрать визуальный блок страницы и сохранить его как monitoring target. После следующих успешных runs crawler автоматически проверяет, остался ли блок на месте.

Статусы цели:

- `На месте`;
- `Изменился`;
- `Не найден`;
- `Нужна проверка`;
- `Ждёт прогона`.

Для целей доступны:

- rename/pause/resume/delete;
- история проверок;
- Event Center уведомления;
- email/Telegram подписки;
- throttling по времени;
- delivery outbox;
- retry/backoff;
- diagnostics card для admin/root-admin;
- `Preview` и `Тест` сообщения канала.

### Расписания

В настройках проекта можно включить автозапуск:

- daily/weekly;
- время `HH:MM`;
- timezone;
- pause/resume;
- список сайтов и personas, которые будут запущены.

Worker сам проверяет due schedules и ставит задачи в очередь. Duplicate guard не создаёт новый запуск, если проект уже имеет активный run/job.

## Права доступа

Системные роли:

- `viewer` — просмотр доступных данных;
- `editor` — запуск crawler и редактирование проектов, где есть доступ;
- `admin` — операционное управление;
- `root-admin` — полный системный доступ.

Project membership задаёт доступ внутри проекта:

- `owner` — управляет доступами проекта;
- `editor` — меняет сайты/настройки и запускает crawler;
- `viewer` — смотрит результаты.

Обычные `viewer/editor` видят только проекты, где они участники. `admin/root-admin` видят все проекты.

## Worker и очередь

В dev compose worker включён:

```env
CRAWLER_WORKER_ENABLED=1
CRAWLER_JOB_LEASE_SECONDS=300
CRAWLER_JOB_STALE_QUEUED_SECONDS=600
CRAWLER_JOB_MAX_ATTEMPTS=3
CRAWLER_JOB_RETRY_BACKOFF_SECONDS=10,30,120
```

Полезные команды:

```bash
docker compose logs -f worker
docker compose stop worker
```

Ручной debug-tick одного шага worker:

```bash
docker compose exec backend env CRAWLER_WORKER_ENABLED=1 CRAWLER_WORKER_TICK_LIMIT=1 PYTHONPATH=/app python -m app.worker.crawler_worker
```

Readiness:

- `GET /crawler/readiness`
- в Project Dashboard admin/root-admin видят компактную readiness-панель: queued/running/cancel-requested jobs, режим `worker/sync`, stale queue и degraded issues.

Активные задачи:

- `GET /runs/active-job/by-site/{site_id}`
- `GET /runs/active-jobs/by-project/{project_id}`

Отмена активного run:

```text
POST /runs/{run_id}/cancel
```

Backend ставит `CANCEL_REQUESTED`, crawler-watchdog пытается быстро прервать текущий HTTP/browser fetch. Уже сохранённые страницы остаются в истории.

## Crawl personas и managed login

Для авторизованного обхода можно подключить persona через Playwright storage state или managed login.

Env для managed login:

```env
CRAWL_PERSONA_MANAGED_LOGIN_CAPTURE_ENABLED=1
CRAWL_PERSONA_MANAGED_LOGIN_CAPTURE_HEADLESS=0
CRAWL_BROWSER_MAX_PAGES=500
CRAWL_BROWSER_MAX_SECONDS=600
CRAWL_STALE_RUNNING_SECONDS=1800
```

Перезапуск backend:

```bash
docker compose up -d --build backend
```

Если backend запущен в Docker без GUI/DISPLAY, видимое окно может не открыться. UI покажет это явно и предложит fallback: ручной импорт Playwright `storageState`.

Browser-runs ограничены `CRAWL_BROWSER_MAX_PAGES` и `CRAWL_BROWSER_MAX_SECONDS`. Обычный HTTP-crawler продолжает использовать лимит сайта.

## Уведомления

Target monitoring поддерживает каналы:

- `email`;
- `telegram_chat`.

Для email нужен SMTP env, используемый backend email utility.

Для Telegram нужен:

```env
TELEGRAM_BOT_TOKEN=...
```

Delivery outbox не теряет failed-доставки: применяется retry/backoff policy.

```env
MONITORING_NOTIFICATION_MAX_ATTEMPTS=5
MONITORING_NOTIFICATION_RETRY_BACKOFF_SECONDS=60,300,900,1800,3600
```

Admin/root-admin видят diagnostics card: настроены ли Email/Telegram, сколько записей queued/retry-ready/failed-waiting/sent/dead.

## Хранилище артефактов

Raw artifacts хранятся ограниченно: по умолчанию HTML/rendered snapshots сохраняются только для двух последних успешных прогонов сайта в рамках одной crawl-persona.

```env
SCAN_RAW_ARTIFACT_RUNS_TO_KEEP=2
SCAN_STORAGE_BUDGET_MB=1024
```

Старые runs, URL, HTTP-статусы, hashes, timings и агрегаты остаются в базе, но тяжёлый HTML/rendered files очищаются.

## Quotas

Role-based quotas защищают crawler от дорогих настроек и очередей.

Примеры env:

```env
QUOTA_EDITOR_MAX_PAGES_PER_SITE=5000
QUOTA_EDITOR_MAX_ACTIVE_JOBS_PER_USER=3
QUOTA_ADMIN_MAX_BULK_SITES_PER_RUN=50
```

Ошибки лимитов возвращаются как friendly `quota_exceeded`: UI показывает лимит, текущее значение, запрошенное действие и следующий шаг.

## UI Debug Center

Только development:

```env
APP_ENV=development
UI_DEBUG_ENABLED=true
VITE_ENABLE_UI_DEBUG=true
```

Пересборка:

```bash
docker compose up -d --build backend frontend
```

Открыть: `Настройки → UI Debug Center`.

Ограничения:

- доступ: admin/root-admin;
- реальные роли и данные не изменяются;
- backend отключает режим при `APP_ENV=production`;
- настоящая impersonation намеренно не реализована.

## Метрики

- JSON метрики backend: `GET /metrics`
- Prometheus формат: `GET /metrics/prometheus`
- Экспорт таблицы метрик:
  - `GET /metrics/export.csv`
  - `GET /metrics/export.xlsx`

## Архитектурный граф

- [Открыть knowledge graph проекта](.understand-anything/knowledge-graph.json)

Граф создан с помощью [Understand Anything](https://github.com/Egonex-AI/Understand-Anything). Для интерактивного просмотра установите Understand Anything и запустите `/understand-dashboard` из корня проекта.

## Документация и контракты

- `TODO.md` — текущий контекст и backlog.
- `docs/ENGINEERING_PLAYBOOK.md` — engineering contracts, reuse-first, DoD.
- `RBAC_MAP.md` — роли и права.
- `docs/README.md` — дополнительная документация.
- `docs/governance/FEATURE_INTAKE_PLAYBOOK.md` — feature intake.
- `docs/archive/` — исторические snapshots.

README держим кратким: запуск, эксплуатация и точки входа. Детальные решения фиксируются в `TODO.md` и отдельных docs.

## Encoding First

- Все файлы с русским текстом сохраняются в `UTF-8`.
- `CP1251/Windows-1251` запрещены.
- Любая mojibake/кракозябра блокирует завершение задачи до исправления.
