# UI Taxonomy Matrix (Draft v1, 2026-02-25)

Р¦РµР»СЊ: Р·Р°С„РёРєСЃРёСЂРѕРІР°С‚СЊ canonical UI-РєРѕРЅС‚СЂР°РєС‚С‹ РґР»СЏ РЅРѕРІС‹С… СЃС‚СЂР°РЅРёС†/РѕРєРѕРЅ, С‡С‚РѕР±С‹ РЅРµ СЂР°Р·РјРЅРѕР¶Р°С‚СЊ Р»РѕРєР°Р»СЊРЅС‹Р№ hardcode.

## Legend

- `used`: canonical РїР°С‚С‚РµСЂРЅ СѓР¶Рµ РїСЂРёРјРµРЅСЏРµС‚СЃСЏ.
- `pilot`: shared-РїР°С‚С‚РµСЂРЅ РІРЅРµРґСЂРµРЅ, РѕР¶РёРґР°РµС‚ 2-Р№ call-site РґР»СЏ РѕРєРѕРЅС‡Р°С‚РµР»СЊРЅРѕР№ РєР°РЅРѕРЅРёР·Р°С†РёРё.
- `candidate`: РїРѕРєР° single-use/local, РІС‹РЅРѕСЃРёС‚СЊ РїСЂРё `>=2 call-sites`.
- `exception`: РґРѕРїСѓСЃС‚РёРјРѕРµ РѕС‚РєР»РѕРЅРµРЅРёРµ (РґРѕР»Р¶РЅРѕ Р±С‹С‚СЊ СЏРІРЅРѕ РѕР±РѕСЃРЅРѕРІР°РЅРѕ).
- `legacy`: РїРѕРґР»РµР¶РёС‚ cleanup/РјРёРіСЂР°С†РёРё.

## Matrix

| Context | Canonical | Status | Current Call-Sites | Where To See In UI |
|---|---|---|---|---|
| Header layout | `SectionHeaderRow` | `used` | `Users/UserDetails`, `RootAdmins`, `Events`, `Activity`, `Monitoring`, `SidebarRight` | `РџРѕР»СЊР·РѕРІР°С‚РµР»Рё -> РћС‚РєСЂС‹С‚СЊ`, `РЎРёСЃС‚РµРјРЅС‹Рµ Р°РґРјРёРЅРёСЃС‚СЂР°С‚РѕСЂС‹ -> РћС‚РєСЂС‹С‚СЊ`, `Р¦РµРЅС‚СЂ СЃРѕР±С‹С‚РёР№ -> РєР°СЂС‚РѕС‡РєР°` |
| Panel container | `Card` (`default/hint/warning`, `interactive`) | `used` | `Users`, `RootAdmins`, `Events`, `Activity`, `Monitoring`, `Sidebar` | РІСЃРµ РєР»СЋС‡РµРІС‹Рµ СЌРєСЂР°РЅС‹, РєР°СЂС‚РѕС‡РєРё СЃРїРёСЃРєРѕРІ Рё Р±Р»РѕРєРѕРІ |
| Selectable list row | `SelectableListRow` | `used` | `UsersPage`, `RootAdminsPage` | `РџРѕР»СЊР·РѕРІР°С‚РµР»Рё`, `РЎРёСЃС‚РµРјРЅС‹Рµ Р°РґРјРёРЅРёСЃС‚СЂР°С‚РѕСЂС‹` |
| Drawer shell | `SlidePanel` + `SectionHeaderRow` | `used` | `Users`, `RootAdmins`, `Events`, `Activity`, `SidebarRight` | РѕС‚РєСЂС‹С‚СЊ Р»СЋР±СѓСЋ РєР°СЂС‚РѕС‡РєСѓ СЃ РєРѕРЅС‚РµРєСЃС‚РѕРј |
| Modal confirm | `ConfirmDialog` + `ModalActionRow` | `used` | confirm-РєРµР№СЃС‹ `Users/RootAdmins` | bulk/remove СЃС†РµРЅР°СЂРёРё |
| Modal actions row | `ModalActionRow` | `used` | `ConfirmDialog`, `RootAdmins` add-modal | `РЎРёСЃС‚РµРјРЅС‹Рµ Р°РґРјРёРЅРёСЃС‚СЂР°С‚РѕСЂС‹ -> Р”РѕР±Р°РІРёС‚СЊ` |
| Modal shell | `ModalShell` | `used` | `ConfirmDialog`, `RootAdmins` add-modal | `Системные администраторы -> Добавить`, confirm-модалки |
| Buttons (base variants) | `Button` (`primary/accent/secondary/ghost/danger/export/panel-toggle`) | `used` | cross-page | РІСЃРµ СЃС‚СЂР°РЅРёС†С‹ |
| Card action buttons | `EventCardActions` + `CardActionButton` | `used` | `EventsPage`, `SidebarRight` | `Р¦РµРЅС‚СЂ СЃРѕР±С‹С‚РёР№`, РїСЂР°РІС‹Р№ СЃР°Р№РґР±Р°СЂ |
| Sidebar toggle | `SidebarToggleButton` | `used` | `SidebarRight` collapsed/expanded | РїСЂР°РІС‹Р№ СЃР°Р№РґР±Р°СЂ |
| Reason chips | `ReasonPresetButton` | `used` | `UserActionPanel`, `RootAdminsPage` | bulk/action С„РѕСЂРјС‹ |
| Icon dismiss | `IconGhostButton` | `used` | `SidebarRight`, `ToastHost` | РєР°СЂС‚РѕС‡РєРё СЃР°Р№РґР±Р°СЂР°, toast |
| Inline text action | `InlineActionButton` | `used` | `ActivityLogPage`, `AppLayout` breadcrumbs | `Р–СѓСЂРЅР°Р» РґРµР№СЃС‚РІРёР№`, РІРµСЂС…РЅРёР№ breadcrumb |
| Inline info row | `InlineInfoRow` | `used` | `RootAdminsPage`, `UserDetailsDrawer` | fallback trust-line в drawer `RootAdmins`, JWT version line в `Users` drawer |
| Status/meta text | `StatusText`, `MetaText` | `used` | `Users`, `RootAdmins`, `Events`, `Activity`, `Monitoring`, user-cards | loading/error/success СЃРѕСЃС‚РѕСЏРЅРёСЏ |
| Empty state | `EmptyState` | `used` | `Events`, `Activity`, `Monitoring` | РїСѓСЃС‚С‹Рµ С„РёР»СЊС‚СЂС‹/Р»РµРЅС‚С‹ |
| Selector base | `UiSelect` | `used` | `MonitoringPage`, `ActivityLogPage`, `UserActionPanel` | `РњРѕРЅРёС‚РѕСЂРёРЅРі` export format; `Р–СѓСЂРЅР°Р» РґРµР№СЃС‚РІРёР№` filters/export; `РџРѕР»СЊР·РѕРІР°С‚РµР»Рё` bulk action panel |
| Filter segmented control | `SegmentedControl` | `used` | `Users`, `Activity`, `Monitoring` | С„РёР»СЊС‚СЂС‹/СЂРµР¶РёРјС‹ |
| Clearable text input | `ClearableInput` | `used` | `Users`, `RootAdmins`, `Activity`, `Monitoring` | search/filter СЃС‚СЂРѕРєРё |
| List totals meta | `ListTotalMeta` | `used` | `Users`, `RootAdmins` | РЅР°Рґ СЃРїРёСЃРєР°РјРё СЃСѓС‰РЅРѕСЃС‚РµР№ |
| Range preset group | `RangePresetGroup` | `pilot` | `MonitoringPage` | `РњРѕРЅРёС‚РѕСЂРёРЅРі -> РСЃС‚РѕСЂРёС‡РµСЃРєРёРµ РіСЂР°С„РёРєРё` |
| Action state marker | `ActionStateMarker` | `pilot` | `UserActionPanel` | `РџРѕР»СЊР·РѕРІР°С‚РµР»Рё -> Р”РµР№СЃС‚РІРёСЏ` |
| Toolbar select presets | `UiSelect` context presets (`toolbar/modal/dense`) | `candidate` | РµС‰Рµ РЅРµ РІС‹РЅРµСЃРµРЅРѕ РІ wrappers | Р±СѓРґСѓС‰Р°СЏ selector mini-wave |

## Known Exceptions


1. Monitoring dense input controls
   - Status: `exception`.
   - Note: numeric threshold inputs РїРѕРєР° Р»РѕРєР°Р»СЊРЅС‹; РІРѕР·РјРѕР¶РЅС‹Р№ Р±СѓРґСѓС‰РёР№ `DenseNumberInput` С‚РѕР»СЊРєРѕ РїСЂРё 2+ call-sites.

## Single-Use Backlog Link

- РўРµРєСѓС‰РёРµ `candidate/pilot/exception` РґРµС‚Р°Р»Рё: `UI_SINGLE_USE_BACKLOG.md`.
- Selector full-sweep details: `UI_SELECTOR_FULL_SWEEP_MATRIX.md`.

## Governance Rule

1. РќРѕРІС‹Р№ СЌРєСЂР°РЅ СЃРЅР°С‡Р°Р»Р° РјР°РїРїРёС‚СЃСЏ РЅР° РєРѕРЅС‚РµРєСЃС‚С‹ РёР· СЌС‚РѕР№ РјР°С‚СЂРёС†С‹.
2. Р•СЃР»Рё РєРѕРЅС‚РµРєСЃС‚ СѓР¶Рµ `used` — РѕР±СЏР·Р°С‚РµР»СЊРЅРѕ reuse canonical РєРѕРјРїРѕРЅРµРЅС‚Р°.
3. Р•СЃР»Рё РЅРµС‚ СЃРѕРІРїР°РґРµРЅРёСЏ — `candidate` РІ backlog; extraction С‚РѕР»СЊРєРѕ РїСЂРё `>=2 call-sites` РёР»Рё СЃРѕРіР»Р°СЃРѕРІР°РЅРЅРѕРј `pilot`.
