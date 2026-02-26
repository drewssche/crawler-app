# Project Tree Simplification Plan (2026-02-26)

Цель: упростить структуру проекта без изменения бизнес-поведения и без роста нагрузки на сервер.

## Scope

- `docs`/markdown артефакты в корне репозитория.
- `frontend/src/pages/*` крупные страницы с накопленным page-level кодом.
- `backend/app/main.py` как central entrypoint с частью доменной логики.

## Guardrails

- Не меняем API-контракты и схемы БД.
- Не увеличиваем число запросов и частоту polling/refresh.
- Не ломаем multi-user sync поведение (права, счетчики, event center).
- Любой move/refactor делаем в формате `No-Regression`.

## Phase 1 (Docs Tree, low risk)

1. Ввести папки:
- `docs/audits/`
- `docs/ui/`
- `docs/governance/`

2. Перенести markdown-файлы по категориям:
- `AUDIT_*.md` -> `docs/audits/`
- `UI_*.md`, `BADGE_*.md` -> `docs/ui/`
- `PATTERNS.md`, `REUSE_INDEX.md`, `TODO.md` оставить в корне как operational entrypoints.

3. Добавить `docs/README.md` с навигацией.

Ожидаемый эффект:
- быстрее находить нужные артефакты;
- меньше визуального шума в корне репозитория.

## Phase 2 (Frontend Tree, medium risk)

1. Для больших страниц (`MonitoringPage`, `ActivityLogPage`, `RootAdminsPage`) ввести подпапки:
- `frontend/src/pages/monitoring/*`
- `frontend/src/pages/activity/*`
- `frontend/src/pages/rootAdmins/*`

2. Вынести из страниц только UI-composition блоки:
- table sections,
- toolbar sections,
- modal/drawer content sections.

3. Логику данных/хуков не переносить в эту фазу (только layout-decomposition).

Ожидаемый эффект:
- меньше merge-конфликтов;
- ниже порог входа в page-level изменения.

## Phase 3 (Backend Entry Split, medium risk)

1. Вынести из `backend/app/main.py` сервисные блоки в отдельные модули:
- `metrics flatten/export` helper,
- `app exception handlers`,
- `request middleware`.

2. Оставить в `main.py` только:
- app init,
- router wiring,
- lifecycle wiring.

Ожидаемый эффект:
- `main.py` становится легче для ревью и сопровождения;
- ниже риск случайных cross-cutting правок.

## Rollout Order

1. Phase 1 (docs) — безопасно, можно делать сразу.
2. Phase 2 (frontend decomposition) — по одной странице за итерацию.
3. Phase 3 (backend entry split) — после стабилизации frontend phase.

## Progress

- 2026-02-26:
  - Phase 1: completed.
  - Phase 2: started with `MonitoringPage` decomposition into `frontend/src/pages/monitoring/*`.
  - Phase 2: continued with `ActivityLogPage` move into `frontend/src/pages/activity/*` + bridge export in `frontend/src/pages/ActivityLogPage.tsx`.

## Verification

- Docs: ссылки и индексы открываются, битых путей нет.
- Frontend: `cd frontend && npm run -s build`.
- Backend: `docker compose exec backend sh -lc "cd /app && PYTHONPATH=/app pytest -q tests/test_api_integration.py"`.
- Smoke: проверка ключевых экранов (`Users`, `RootAdmins`, `Events`, `Monitoring`, `Activity`).

## Explicit Non-Goals

- Не делаем функциональный redesign.
- Не трогаем release-gate staging задачи из `TODO.md`.
- Не меняем текущие infinite/lazy механики (`useWorkspaceInfiniteScroll`, `useIncrementalPager`).
