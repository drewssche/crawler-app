# Crawler App

Веб-приложение для управления краулинг-профилями, прогонами, доступом пользователей и админ-операциями.

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

## Метрики

- JSON метрики backend: `GET /metrics`
- Prometheus формат: `GET /metrics/prometheus`
- Экспорт таблицы метрик:
  - `GET /metrics/export.csv`
  - `GET /metrics/export.xlsx`

## Паттерны и контракты

Подробный свод механик, паттернов реюза, DoD и PR-checklist вынесен в:

- `PATTERNS.md`
- `REUSE_INDEX.md`
- `RBAC_MAP.md`
- `docs/README.md`
- `docs/audits/AUDIT_DISCOVERY_2026-02-24.md`

Критичный governance-контракт:
- `PATTERNS.md` -> `1.2 Super-Priority: Server-Load & Multi-User Sync First`.

Этот файл (`README.md`) оставляем кратким: запуск/эксплуатация/точки входа.

## Обязательное правило кодировки (Encoding First)

- Все файлы с русским текстом сохраняются в `UTF-8` (предпочтительно `UTF-8 without BOM`).
- `CP1251/Windows-1251` запрещены.
- Любая mojibake/кракозябра блокирует завершение задачи до исправления.
