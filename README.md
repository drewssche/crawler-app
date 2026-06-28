# Crawler App

Веб-приложение для управления проектами мониторинга сайтов, прогонами crawler, доступом пользователей и админ-операциями.

## Быстрый старт

### Основной режим (с Prometheus)
```bash
docker compose up -d --build
```

## Адреса сервисов

- Frontend: `http://localhost:5173`
- Backend health: `http://localhost:8000/health`
- Prometheus: `http://localhost:9090`

## Остановка

### Остановить без удаления данных
```bash
docker compose down
```

### Остановить и удалить тома
```bash
docker compose down -v
```

## UI Debug Center (только development)

Для fixture-only проверки ролей, toast, запросов доступа, событий и редких UI-состояний добавьте в `.env`:

```env
APP_ENV=development
UI_DEBUG_ENABLED=true
VITE_ENABLE_UI_DEBUG=true
```

Затем пересоберите frontend/backend:

```bash
docker compose up -d --build backend frontend
```

Открыть: `Настройки → UI Debug Center`.

- доступ: admin/root-admin;
- реальные роли и данные не изменяются;
- backend жёстко отключает режим при `APP_ENV=production`;
- настоящая impersonation намеренно не реализована.

## Managed login для crawl personas

Для подключения авторизованной persona через управляемый браузер добавьте в `.env`:

```env
CRAWL_PERSONA_MANAGED_LOGIN_CAPTURE_ENABLED=1
CRAWL_PERSONA_MANAGED_LOGIN_CAPTURE_HEADLESS=0
CRAWL_BROWSER_MAX_PAGES=500
CRAWL_BROWSER_MAX_SECONDS=600
CRAWL_STALE_RUNNING_SECONDS=1800
```

Затем перезапустите backend:

```bash
docker compose up -d --build backend
```

Если backend запущен в Docker без GUI/DISPLAY, видимое окно может не открыться. UI покажет это явно и предложит fallback: ручной импорт Playwright `storageState`.

`CRAWL_BROWSER_MAX_PAGES` и `CRAWL_BROWSER_MAX_SECONDS` ограничивают дорогие browser-runs. Обычный HTTP-crawler продолжает использовать лимит сайта.

`CRAWL_STALE_RUNNING_SECONDS` задаёт, через сколько секунд без обновления прогресса `RUNNING`-прогон считается зависшим. При следующем чтении истории или запуске сайта backend пометит такой прогон как `FAILED/stale_run_recovered`, чтобы он не блокировал новый запуск.

Активный прогон можно остановить через `POST /runs/{run_id}/cancel`. В текущей синхронной архитектуре это не прерывает уже начатый HTTP-запрос мгновенно: backend ставит `CANCEL_REQUESTED`, а crawler завершает текущую страницу и переводит run в `CANCELLED` перед следующим шагом.

Операционная диагностика crawler доступна admin/root-admin через `GET /crawler/readiness`: режим исполнения, активные runs, ожидание отмены, stale recovery и порог `CRAWL_STALE_RUNNING_SECONDS`.

Каждый запуск сайта теперь создаёт durable job-запись `crawler_run_jobs`. В dev `docker-compose` включён worker-mode: backend ставит site-run в очередь, а отдельный `worker` service забирает queued jobs и выполняет crawl.

Readiness также контролирует production-состояние очереди:

- `RUNNING/CANCEL_REQUESTED` job с истёкшей lease автоматически закрывается как failed/cancelled и освобождает сайт для нового запуска;
- старая `QUEUED` job не удаляется автоматически, но переводит readiness в `degraded`, чтобы было видно проблему worker/backlog;
- порог старой очереди задаёт `CRAWLER_JOB_STALE_QUEUED_SECONDS` — по умолчанию 600 секунд.

Worker включён в `docker-compose.yml` явно:

```env
CRAWLER_WORKER_ENABLED=1
CRAWLER_JOB_LEASE_SECONDS=300
CRAWLER_JOB_STALE_QUEUED_SECONDS=600
```

В этом режиме `POST /runs/start-site/{site_id}` ставит задачу в очередь. Постоянный `worker` service автоматически забирает queued jobs. Ручной `POST /runs/worker/tick` остаётся debug/admin-инструментом для проверки одного шага worker execution.

Для восстановления UI после перезагрузки страницы доступен `GET /runs/active-job/by-site/{site_id}`: он возвращает текущую active job сайта или `active=false`, если очередь/worker уже завершили работу.

Dev stack с worker запускается обычной командой:

```bash
docker compose up -d --build
```

Остановить только worker, если нужно временно проверить backend без фонового crawl:

```bash
docker compose stop worker
```

Запустить bounded smoke-проверку worker process внутри backend-контейнера:

```bash
docker compose exec backend env CRAWLER_WORKER_ENABLED=1 CRAWLER_WORKER_TICK_LIMIT=1 PYTHONPATH=/app python -m app.worker.crawler_worker
```

Опциональные настройки:

```env
CRAWLER_WORKER_POLL_SECONDS=2
CRAWLER_WORKER_TICK_LIMIT=0
```

`CRAWLER_WORKER_TICK_LIMIT=0` означает работать до SIGTERM/SIGINT.

## Метрики

- JSON метрики backend: `GET /metrics`
- Prometheus формат: `GET /metrics/prometheus`
- Экспорт таблицы метрик:
  - `GET /metrics/export.csv`
  - `GET /metrics/export.xlsx`

## Архитектурный граф

- [Открыть knowledge graph проекта](.understand-anything/knowledge-graph.json)

Граф создан с помощью [Understand Anything](https://github.com/Egonex-AI/Understand-Anything) и содержит архитектурные слои, связи файлов и guided tour. Для интерактивного просмотра установите Understand Anything и запустите `/understand-dashboard` из корня проекта; повторный полный анализ не требуется.

## Паттерны и контракты

Актуальные инженерные контракты, reuse-карта, DoD и verification minimum объединены в:

- `docs/ENGINEERING_PLAYBOOK.md`
- `TODO.md` — только текущий контекст и открытый backlog
- `RBAC_MAP.md`
- `docs/README.md`
- `docs/governance/FEATURE_INTAKE_PLAYBOOK.md`
- `docs/audits/AUDIT_DISCOVERY_2026-02-24.md`

Критичный governance-контракт:
- `docs/ENGINEERING_PLAYBOOK.md` -> `Priorities` и `Delivery Contract`.

Полные исторические snapshots прежних `TODO/PATTERNS/REUSE_INDEX` находятся в `docs/archive/`.

Этот файл (`README.md`) оставляем кратким: запуск/эксплуатация/точки входа.

## Обязательное правило кодировки (Encoding First)

- Все файлы с русским текстом сохраняются в `UTF-8` (предпочтительно `UTF-8 without BOM`).
- `CP1251/Windows-1251` запрещены.
- Любая mojibake/кракозябра блокирует завершение задачи до исправления.
