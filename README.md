# Crawler App

Веб-приложение для управления краулинг-профилями, прогонами, доступом пользователей и админ-операциями.

## Быстрый старт

### Обычный режим
```bash
docker compose up -d --build
```

### Режим с мониторингом (Prometheus + Grafana)
```bash
docker compose --profile monitoring up -d --build
```

## Адреса сервисов

- Frontend: `http://localhost:5173`
- Backend health: `http://localhost:8000/health`
- Prometheus: `http://localhost:9090`
- Grafana: `http://localhost:3000`

## Остановка

### Остановить без удаления данных
```bash
docker compose --profile monitoring down
```

### Остановить и удалить тома
```bash
docker compose --profile monitoring down -v
```

## Метрики

- JSON метрики backend: `GET /metrics`
- Prometheus формат: `GET /metrics/prometheus`
- Экспорт таблицы метрик:
  - `GET /metrics/export.csv`
  - `GET /metrics/export.xlsx`

## Паттерны и контракты

Подробный свод механик, паттернов реюза, DoD и PR-checklist вынесен в:

- `PATTERNS.md`

Этот файл (`README.md`) оставляем кратким: запуск/эксплуатация/точки входа.

## Обязательное правило кодировки (Encoding First)

- Все файлы с русским текстом сохраняются в `UTF-8` (предпочтительно `UTF-8 without BOM`).
- `CP1251/Windows-1251` запрещены.
- Любая mojibake/кракозябра блокирует завершение задачи до исправления.
