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
