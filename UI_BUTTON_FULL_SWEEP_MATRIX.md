# UI Button Full-Sweep Matrix (2026-02-25)

Цель: собрать сквозную матрицу кнопок `used/missed/legacy` по `frontend/src/pages/*` и `frontend/src/components/*`, убрать кодовый legacy без UX-изменений, а одиночные кандидаты отправить в backlog.

## Scope

- `frontend/src/pages/*`
- `frontend/src/components/*`
- `frontend/src/components/ui/Button.tsx` и button-wrappers
- wave docs: `UI_WAVE_*_MATRIX.md`
- backlog: `UI_SINGLE_USE_BACKLOG.md`

## Used (aligned)

1. Shared variants via `Button`
   - `primary`, `accent`, `secondary`, `ghost`, `danger`, `export`, `panel-toggle`.
   - Применяются в `Users`, `RootAdmins`, `Events`, `Activity`, `Monitoring`, `SidebarLeft/Right`, `Login`, `ConfirmDialog`, `ClearableInput`, `SelectableListRow`.

2. Shared button wrappers
   - `SidebarToggleButton`: `SidebarRight` collapse/expand.
   - `EventCardActions` (+ `CardActionButton`): `EventsPage` и `SidebarRight`.
   - `ReasonPresetButton`: `UserActionPanel` и `RootAdminsPage`.
   - `IconGhostButton`: `SidebarRight` card dismiss controls, `ToastHost` close control.
   - `InlineActionButton`: `ActivityLogPage` inline filters, `AppLayout` breadcrumbs.
   - `ModalActionRow`: `ConfirmDialog` и `RootAdminsPage` add-modal footer.

## Missed (no immediate extraction)

1. Monitoring quick-range presets (`15м/1ч/6ч/24ч`)
   - Status: `pilot`.
   - Result: вынесено в shared `RangePresetGroup`, canonical после 2-го call-site.

2. RootAdmins modal footer composition (`cancel + primary`)
   - Status: `migrated`.
   - Result: вынесено в shared `ModalActionRow` и подключено в `ConfirmDialog` + `RootAdminsPage`.

3. UserActionPanel action marker (`i/!`)
   - Status: `pilot`.
   - Result: вынесено в shared `ActionStateMarker`, canonical после 2-го call-site.

## Legacy (cleaned in code)

1. Breadcrumb buttons in workspace header
   - Before: `Button variant="ghost"` с локальным style-reset (`border:none/background:transparent/padding:0`).
   - After: `InlineActionButton` (shared inline pattern), без page-level button-style.
   - File: `frontend/src/components/layout/AppLayout.tsx`.

2. Toast close button (`×`)
   - Before: локальный `Button variant="ghost"` + compact style literals.
   - After: `IconGhostButton` (shared compact icon control).
   - File: `frontend/src/components/ui/ToastHost.tsx`.

## UI Routes (where to see)

1. `Рабочая область` breadcrumb
   - Route: любой экран внутри `workspace` с breadcrumb в header.
   - Check: клики по breadcrumb работают как раньше, визуально это inline-action без рамки.

2. `Event Center` right sidebar
   - Route: правый сайдбар, карточки уведомлений/ленты действий.
   - Check: dismiss-кнопки компактные и единообразные.

3. Toast notifications
   - Route: любой сценарий с toast (например, action success/error).
   - Check: `×` использует тот же compact icon-button contract, закрытие без регрессий.

## Manual Cleanup Queue Impact

- В этой button-волне файлов для ручного удаления не выявлено.
- Все найденные кодовые legacy-места очищены автоматически в коде.
