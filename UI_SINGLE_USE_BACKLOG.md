# UI Single-Use Backlog

Одиночные hardcoded UI-паттерны, которые пока не подтверждены как reusable (меньше 2 call-sites).
Назначение файла: не терять потенциальный реюз, категоризировать, планировать cleanup/структурирование.

## Users Wave Intake

1. `UserActionPanel` action icon bubble
   Category: `status/action marker`
   File: `frontend/src/components/users/UserActionPanel.tsx`
   Why single-use now: используется в одном экране, но вынесен в shared pilot `ActionStateMarker`.
   Potential reuse: action preview в `RootAdmins`/других админ-панелях.
   Decision draft: `pilot` (promote to canonical on 2nd call-site).

2. JWT version hint line with tooltip
   Category: `security technical hint`
   File: `frontend/src/components/users/UserDetailsDrawer.tsx`
   Why single-use now: специфичный текст про `token_version`.
   Potential reuse: security context cards (`Activity/Events` user context).
   Decision draft: `keep-local-for-now`.

3. Login history preview row layout
   Category: `history preview row`
   File: `frontend/src/components/users/UserDetailsDrawer.tsx`
   Why single-use now: compact preview входов в drawer, уникальная структура.
   Potential reuse: другие compact history previews.
   Decision draft: `candidate`, если появится 2-й кейс.

4. Session summary card internals
   Category: `session summary block`
   File: `frontend/src/components/users/SessionSummaryCard.tsx`
   Why single-use now: компонент reusable по смыслу, но фактически пока в одном контексте.
   Potential reuse: `RootAdmins`/`Sidebar`/security drawers.
   Decision draft: `watch`.

## RootAdmins Wave Intake

1. (resolved) Drawer trust fallback text block
   Category: `trust fallback`
   File: `frontend/src/pages/RootAdminsPage.tsx`
   Resolution: migrated to shared `InlineInfoRow` and reused in `UserDetailsDrawer`.


## Events + Activity Wave Intake

1. Events card body metadata row
   Category: `event card meta row`
   File: `frontend/src/pages/EventsPage.tsx`
   Why single-use now: локальная сборка строки `канал/уровень/статус/скрыто`.
   Potential reuse: `SidebarRight` event cards (частично уже перекрыто `EventMetaPills` для drawer).
   Decision draft: `candidate`.

2. Activity related-record cards
  Category: `related record block`
  File: `frontend/src/pages/ActivityLogPage.tsx`
  Why single-use now: `RelatedRecordCard` локален странице.
  Potential reuse: похожие context cards в `Events/Sidebar`.
  Decision draft: `watch`.

3. Activity export/filter action grouping
  Category: `feed toolbar action row`
  File: `frontend/src/pages/ActivityLogPage.tsx`
  Why single-use now: кнопки/инлайн-действия в toolbar собраны локально под один экран.
  Potential reuse: если второй feed получит аналогичный grouped export/filter toolbar.
  Decision draft: `watch`.

## Monitoring + Sidebar Wave Intake

1. Monitoring quick-range button cluster (`15м/1ч/6ч/24ч`)
   Category: `button preset group`
   File: `frontend/src/pages/MonitoringPage.tsx`
   Why single-use now: используется в одном экране, но вынесен в shared pilot `RangePresetGroup`.
   Potential reuse: любые future time-range filters.
   Decision draft: `pilot` (promote to canonical on 2nd call-site).

2. Monitoring status summary line (`errors/requests/rate`)
   Category: `kpi summary line`
   File: `frontend/src/pages/MonitoringPage.tsx`
   Why single-use now: доменно-специфичный формат строки.
   Potential reuse: low.
   Decision draft: `keep-local-for-now`.

## Selector Mini-Wave Intake

1. `UiSelect` context wrapper for toolbar rows
   Category: `selector layout preset`
   File: `frontend/src/components/ui/UiSelect.tsx` (future composition wrapper)
   Why single-use now: current toolbar select layouts are not repeated as one stable composition.
   Potential reuse: export/filter toolbars on future feed pages.
   Decision draft: `candidate` (promote on >=2 call-sites).

2. `UiSelect` context wrapper for modal forms
   Category: `selector layout preset`
   File: `frontend/src/components/ui/UiSelect.tsx` (future composition wrapper)
   Why single-use now: no repeated modal-select layout contract yet.
   Potential reuse: add/edit modal forms with select fields.
   Decision draft: `candidate` (promote on >=2 call-sites).

3. `UiSelect` dense variant wrapper
   Category: `selector density preset`
   File: `frontend/src/components/ui/UiSelect.tsx` (future size wrapper)
   Why single-use now: dense size demand appears as isolated style tweaks, not a shared stable requirement.
   Potential reuse: compact table-toolbars and dense drawer controls.
   Decision draft: `watch`.

## Status Model

- `candidate`: потенциальный reusable, вернуться в следующей волне.
- `pilot`: уже вынесен в shared как pilot-pattern; становится canonical при 2-м call-site.
- `watch`: пока оставить как есть, следить за новыми call-sites.
- `keep-local-for-now`: сознательно локально из-за доменной специфики.
- `drop`: удалить как legacy после подтверждения неиспользования.
