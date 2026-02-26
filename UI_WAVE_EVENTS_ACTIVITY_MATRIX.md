# UI Wave: Events + Activity

Цель волны: унифицировать повторяющиеся UI-токены в `EventsPage` и `ActivityLogPage` (status/meta text, drawer header layout) через existing shared wrappers без изменения UX/логики.

## Scope

- `frontend/src/pages/EventsPage.tsx`
- `frontend/src/pages/ActivityLogPage.tsx`
- `frontend/src/components/ui/SectionHeaderRow.tsx`
- `frontend/src/components/ui/StatusText.tsx`

## Reuse-Ready (>=2 call-sites)

1. Drawer header row (`title + subtitle + close action`)
   Pattern: одинаковый header в slide drawers с локальным flex-layout.
   Current call-sites: `EventsPage`, `ActivityLogPage`, `Users/UserDetails`, `RootAdmins`.
   Decision: use shared `SectionHeaderRow`.

2. Feed meta/status/error text
   Pattern: локальные `fontSize/opacity` для `Загружено...` и локальные error-color блоки.
   Current call-sites: `EventsPage`, `ActivityLogPage`, `UsersPage`, `RootAdminsPage`, `UserActionPanel`, `UserDetailsDrawer`.
   Decision: use shared `MetaText/StatusText`.

## Button Slice (Events + Activity)

1. Already aligned (semantic OK)
   - Event card actions canonicalized via shared `EventCardActions`.
   - Shared `IconGhostButton`/`CardActionButton` contracts are used for compact card-level actions.
   - Primary page controls use `Button` variants by intent (`secondary/ghost/export/panel-toggle` where applicable).

2. Candidates for future button reuse
   - Activity filter inline chips/links are currently `InlineActionButton` and valid; watch for 2nd domain needing same behavior.
   - If a second feed needs identical export-toolbar grouping, extract shared `FeedExportActionsRow`.

## Implemented In This Wave

1. `EventsPage`
   - `Загружено...` и loading converted to `MetaText`.
   - `feedError` и `drawerError` converted to `StatusText`.
   - drawer header converted to `SectionHeaderRow`.

2. `ActivityLogPage`
   - feed-level/status `Загружено...` converted to `MetaText`.
   - `error` и `drawerError` converted to `StatusText`.
   - drawer header converted to `SectionHeaderRow`.

## Где Увидеть В UI

1. Events feed
   Route: `Центр событий`.
   Steps: сменить фильтры, дождаться загрузки/ошибки, открыть карточку события.
   Expected: `Загружено...` и ошибки в едином text-токене; drawer-header консистентен с другими страницами.

2. Activity feed
   Route: `Журнал действий`.
   Steps: переключить режимы `audit/login`, применить фильтры, открыть контекст записи.
   Expected: те же text/status токены и тот же drawer-header layout-контракт.

3. Button semantics on Events/Activity flow
   Route: `Центр событий` и `Журнал действий`.
   Steps: проверить card actions (`Открыть источник/Отметить/Скрыть/Еще`), toolbar и export-кнопки.
   Expected: действия собраны через shared button patterns без локальных style-веток.

## Non-Reused (single-use now)

Одиночные паттерны добавляются в `UI_SINGLE_USE_BACKLOG.md`.
