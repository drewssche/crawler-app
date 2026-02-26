# UI Taxonomy Matrix (Draft v1, 2026-02-25)

Цель: зафиксировать canonical UI-контракты для новых страниц/окон, чтобы не размножать локальный hardcode.

## Legend

- `used`: canonical паттерн уже применяется.
- `pilot`: shared-паттерн внедрен, ожидает 2-й call-site для окончательной канонизации.
- `candidate`: пока single-use/local, выносить при `>=2 call-sites`.
- `exception`: допустимое отклонение (должно быть явно обосновано).
- `legacy`: подлежит cleanup/миграции.

## Matrix

| Context | Canonical | Status | Current Call-Sites | Where To See In UI |
|---|---|---|---|---|
| Header layout | `SectionHeaderRow` | `used` | `Users/UserDetails`, `RootAdmins`, `Events`, `Activity`, `Monitoring`, `SidebarRight` | `Пользователи -> Открыть`, `Системные администраторы -> Открыть`, `Центр событий -> карточка` |
| Drawer body scroll | `DrawerBody` | `used` | `UserDetailsDrawer`, `RootAdmins`, `Events`, `Activity`, `SidebarRight` | любые drawer-контексты с длинным контентом |
| Generic scroll area | `ScrollableRegion` | `used` | `SidebarLeft` profiles list, `SidebarRight` notifications/actions columns | левый сайдбар (`профили`), правый сайдбар (`Центр событий`) |
| Panel container | `Card` (`default/hint/warning`, `interactive`) | `used` | `Users`, `RootAdmins`, `Events`, `Activity`, `Monitoring`, `Sidebar` | все ключевые экраны, карточки списков и блоков |
| Selectable list row | `SelectableListRow` | `used` | `UsersPage`, `RootAdminsPage` | `Пользователи`, `Системные администраторы` |
| Drawer shell | `SlidePanel` + `SectionHeaderRow` | `used` | `Users`, `RootAdmins`, `Events`, `Activity`, `SidebarRight` | открыть любую карточку с контекстом |
| Modal confirm | `ConfirmDialog` + `ModalActionRow` | `used` | confirm-кейсы `Users/RootAdmins` | bulk/remove сценарии |
| Modal actions row | `ModalActionRow` | `used` | `ConfirmDialog`, `RootAdmins` add-modal | `Системные администраторы -> Добавить` |
| Modal shell | `ModalShell` (viewport-safe scroll) | `used` | `ConfirmDialog`, `RootAdmins` add-modal | `Системные администраторы -> Добавить`, confirm-модалки |
| Buttons (base variants) | `Button` (`primary/accent/secondary/ghost/danger/export/panel-toggle`) | `used` | cross-page | все страницы |
| Card action buttons | `EventCardActions` + `CardActionButton` | `used` | `EventsPage`, `SidebarRight` | `Центр событий`, правый сайдбар |
| Sidebar toggle | `SidebarToggleButton` | `used` | `SidebarRight` collapsed/expanded | правый сайдбар |
| Reason chips | `ReasonPresetButton` | `used` | `UserActionPanel`, `RootAdminsPage` | bulk/action формы |
| Icon dismiss | `IconGhostButton` | `used` | `SidebarRight`, `ToastHost` | карточки сайдбара, toast |
| Inline text action | `InlineActionButton` | `used` | `ActivityLogPage`, `AppLayout` breadcrumbs | `Журнал действий`, верхний breadcrumb |
| Inline info row | `InlineInfoRow` | `used` | `RootAdminsPage`, `UserDetailsDrawer` | fallback trust-line в drawer `RootAdmins`, JWT version line в `Users` drawer |
| HTTP status badge | `HttpStatusBadge` + `httpStatusVisual` | `used` | `MonitoringPage` (endpoint table + metrics table) | `Мониторинг -> Дополнительно`, `Мониторинг -> Таблица метрик` |
| Status/meta text | `StatusText`, `MetaText` | `used` | `Users`, `RootAdmins`, `Events`, `Activity`, `Monitoring`, user-cards | loading/error/success состояния |
| Empty state | `EmptyState` | `used` | `Events`, `Activity`, `Monitoring` | пустые фильтры/ленты |
| Selector base | `UiSelect` | `used` | `MonitoringPage`, `ActivityLogPage`, `UserActionPanel` | `Мониторинг` export format; `Журнал действий` filters/export; `Пользователи` bulk action panel |
| Filter segmented control | `SegmentedControl` | `used` | `Users`, `Activity`, `Monitoring` | фильтры/режимы |
| Clearable text input | `ClearableInput` | `used` | `Users`, `RootAdmins`, `Activity`, `Monitoring` | search/filter строки |
| List totals meta | `ListTotalMeta` | `used` | `Users`, `RootAdmins` | над списками сущностей |
| Range preset group | `RangePresetGroup` | `pilot` | `MonitoringPage` | `Мониторинг -> Исторические графики` |
| Action state marker | `ActionStateMarker` | `pilot` | `UserActionPanel` | `Пользователи -> Действия` |
| Toolbar select presets | `UiSelect` context presets (`toolbar/modal/dense`) | `candidate` | еще не вынесено в wrappers | будущая selector mini-wave |

## Known Exceptions

1. Monitoring dense input controls
   - Status: `exception`.
   - Note: numeric threshold inputs пока локальны; возможный будущий `DenseNumberInput` только при 2+ call-sites.

## Single-Use Backlog Link

- Текущие `candidate/pilot/exception` детали: `docs/ui/UI_SINGLE_USE_BACKLOG.md`.
- Selector full-sweep details: `docs/ui/UI_SELECTOR_FULL_SWEEP_MATRIX.md`.

## Governance Rule

1. Новый экран сначала маппится на контексты из этой матрицы.
2. Если контекст уже `used`, обязательно reuse canonical компонента.
3. Если нет совпадения, фиксируем `candidate` в backlog; extraction только при `>=2 call-sites` или согласованном `pilot`.
