# UI Selector Full-Sweep Matrix (2026-02-25)

Goal: lock one selector contract (`UiSelect`) across pages/components, without UX changes.

## Scope

- `frontend/src/pages/*`
- `frontend/src/components/*`
- `frontend/src/components/ui/UiSelect.tsx`

## Legend

- `used`: uses shared `UiSelect`.
- `missed`: local selector candidate that should be migrated to `UiSelect`.
- `legacy`: obsolete selector implementation planned for cleanup.
- `exception`: intentional non-`UiSelect` control (documented).

## Cross-Page Matrix

| Area | File | Status | Current Pattern | Where To See In UI |
|---|---|---|---|---|
| Monitoring export format | `frontend/src/pages/MonitoringPage.tsx` | `used` | `UiSelect` (`csv/xlsx`) | `Мониторинг -> Таблица метрик -> формат экспорта` |
| Activity export format | `frontend/src/pages/ActivityLogPage.tsx` | `used` | `UiSelect` (`csv/xlsx`) | `Журнал действий -> toolbar -> экспорт` |
| Activity audit action filter | `frontend/src/pages/ActivityLogPage.tsx` | `used` | `UiSelect` (action catalog) | `Журнал действий -> Фильтры -> действие` |
| Activity login result filter | `frontend/src/pages/ActivityLogPage.tsx` | `used` | `UiSelect` (result filter) | `Журнал действий -> Фильтры -> результат` |
| Activity login source filter | `frontend/src/pages/ActivityLogPage.tsx` | `used` | `UiSelect` (source filter) | `Журнал действий -> Фильтры -> источник` |
| Users bulk action select | `frontend/src/components/users/UserActionPanel.tsx` | `used` | `UiSelect` (bulk action) | `Пользователи -> Действия для выбранных -> действие` |
| Users approve role select | `frontend/src/components/users/UserActionPanel.tsx` | `used` | `UiSelect` (role) | `Пользователи -> Действия для выбранных -> роль` |
| Users trust policy select | `frontend/src/components/users/UserActionPanel.tsx` | `used` | `UiSelect` (trust policy) | `Пользователи -> Действия для выбранных -> политика доверия` |
| Native select tag | `frontend/src/components/ui/UiSelect.tsx` | `exception` | internal `<select>` shell | infrastructure only, not page-level UI |

## Missed / Legacy Result

- `missed`: none found in current scan.
- `legacy`: none found in current scan.
- raw `<select>` in pages/features: none found (except inside `UiSelect.tsx` itself).

## Context Presets (Decision)

- Keep one base selector component (`UiSelect`) as canonical contract.
- Do not introduce new wrappers yet for `toolbar/modal/dense` because no second call-site with the same layout contract is confirmed.
- Register wrapper idea as backlog candidate; promote only on `>=2` stable call-sites.

## Verification Commands

- `rg -n "<UiSelect|<select|ui-select-wrap|ui-select" frontend/src/pages frontend/src/components`
- Expected: only `UiSelect` usages in feature/page files; raw `<select>` only inside `frontend/src/components/ui/UiSelect.tsx`.
