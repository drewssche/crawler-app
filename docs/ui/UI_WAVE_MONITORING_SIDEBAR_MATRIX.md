# UI Wave: Monitoring + Sidebar

Цель волны: убрать повтор text/layout паттернов в `MonitoringPage` и `SidebarRight`, не меняя поведение; кнопки вести по тому же принципу (семантика -> shared variant/wrapper -> backlog).

## Scope

- `frontend/src/pages/MonitoringPage.tsx`
- `frontend/src/components/layout/SidebarRight.tsx`
- `frontend/src/components/ui/SectionHeaderRow.tsx`
- `frontend/src/components/ui/StatusText.tsx`
- `frontend/src/components/ui/Button.tsx` (button-slice)

## Reuse-Ready (>=2 call-sites)

1. Drawer header row
   Pattern: `title + subtitle + close` в header drawer.
   Applied: `SidebarRight` context drawer через `SectionHeaderRow`.

2. Meta/error text tokens
   Pattern: локальные `fontSize/opacity` и `#d55` для error/message.
   Applied: `MonitoringPage`, `SidebarRight` через `MetaText/StatusText`.

3. Table/card header row with actions
   Pattern: `title/meta + action controls` в одной строке.
   Applied: `MonitoringPage` table header через `SectionHeaderRow`.

## Button Slice (this wave)

1. Already aligned
   - `SidebarToggleButton` в `SidebarRight`.
   - `EventCardActions` + `IconGhostButton` в карточках sidebar.
   - `Button` variants в Monitoring (`primary/secondary/ghost/panel-toggle/export`).

2. Candidates (not forced this wave)
   - Monitoring quick-range buttons (`15м/1ч/6ч/24ч`) как возможный reusable preset-group.
   - Monitoring table filter toolbar action grouping (если появится второй аналогичный экран).

## Adaptive Follow-up (2026-02-26)

1. Monitoring thresholds controls layout
   Problem: в блоке `Настроить пороги` была жесткая сетка `repeat(4, minmax(140px, 1fr)) auto auto`, из-за чего на узком экране кнопки действий визуально сжимались.
   Fix:
   - поля порогов переведены на responsive-grid `repeat(auto-fit, minmax(140px, 1fr))`;
   - кнопки `Сохранить`/`Рекомендованные` вынесены в отдельный flex-ряд (`wrap`, `justify-content: flex-end`).
   Result: кнопки остаются читаемыми и кликабельными на compact-width без изменения бизнес-поведения.
   File: `frontend/src/pages/MonitoringPage.tsx`

2. HTTP status visual contract (soft-accent)
   Problem: статус-коды `2xx/3xx/4xx/5xx` рендерились локальным hardcode в `MonitoringPage`.
   Fix:
   - вынесен shared helper `frontend/src/utils/httpStatusVisual.ts`;
   - добавлен shared `frontend/src/components/ui/HttpStatusBadge.tsx`;
   - `MonitoringPage` переведен на этот контракт (endpoint table + metrics table).
   Result: единая интерпретация status-кодов и мягкий row-accent для ненормальных кодов без page-level style drift.

## Где Увидеть В UI

1. Monitoring page
   Route: `Мониторинг`.
   Steps: открыть таблицу метрик, переключить фильтры/экспорт, вызвать ошибку/обновление.
   Expected: консистентные meta/error тексты, header таблицы собран одним shared layout.

2. Sidebar context drawer
   Route: `Центр событий (правый сайдбар) -> клик по карточке`.
   Steps: открыть drawer события.
   Expected: header (`Контекст события + время + Закрыть`) в том же layout-контракте, что другие drawers.

## Non-Reused (single-use now)

Одиночные паттерны добавлены в `docs/ui/UI_SINGLE_USE_BACKLOG.md`.
