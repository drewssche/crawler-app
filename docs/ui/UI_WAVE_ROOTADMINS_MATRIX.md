# UI Wave: RootAdmins

Цель волны: пройти `RootAdminsPage` и связанные блоки, вынести повторяемые UI-паттерны в shared-слой (>=2 call-sites), одиночные паттерны отправить в backlog на категоризацию и cleanup.

## Scope

- `frontend/src/pages/RootAdminsPage.tsx`
- `frontend/src/components/users/CompactActionCard.tsx`
- `frontend/src/components/users/TrustPolicyDetailsCard.tsx`
- `frontend/src/components/users/UserListSessionMeta.tsx`
- `frontend/src/components/ui/ReasonPresetButton.tsx`
- `frontend/src/components/ui/SelectableListRow.tsx`
- `frontend/src/components/ui/ListTotalMeta.tsx`
- `frontend/src/components/ui/SlidePanel.tsx`
- `frontend/src/components/ui/ConfirmDialog.tsx`
- `frontend/src/components/ui/ModalShell.tsx`

## Reuse-Ready (>=2 call-sites)

1. Inline status/meta/error text blocks
   Pattern: локальные `fontSize/opacity` и `color` для error/success/muted/info.
   Current call-sites: `RootAdminsPage`, `UsersPage`, `UserActionPanel`, `UserDetailsDrawer`.
   Proposal: расширить применение `StatusText/MetaText` на `RootAdminsPage`.

2. Section header row in drawer/cards
   Pattern: `title + actions` внутри блоков drawer.
   Current call-sites: `UserDetailsDrawer`, `RootAdminsPage` drawer (локально), другие drawer contexts.
   Proposal: внедрить `SectionHeaderRow` там, где еще локальный flex-layout.

3. Overlay modal shell
   Pattern: локальный fixed overlay + centered card (`modalOpen` блок).
   Current call-sites: `RootAdminsPage`, похожие ad-hoc модалки в других местах проекта.
   Proposal: кандидат на shared wrapper поверх `Card` (без нового panel framework).

## Button Slice (RootAdmins)

1. Already aligned (semantic OK)
   - `Button` variants in list/bulk/modal (`primary/secondary/ghost/danger`) соответствуют намерению действий.
   - `ReasonPresetButton` используется в add/remove сценариях как shared reason-chip control.
   - Drawer and bulk action buttons выдерживают size contract (`sm` inline, `md` section-level).

2. Candidates for future button reuse
   - Узкоспециальные bulk remove hint+button composition пока локальны; кандидат только при cross-page повторе.

## Residual Mini-Wave Result

1. Add-modal footer layout (`cancel + primary`)
   - Status: migrated to shared `ModalActionRow`.
   - Call-sites: `RootAdminsPage` add-modal, `ConfirmDialog`.

2. Add-modal shell (`overlay + portal + animation`)
   - Status: migrated to shared `ModalShell`.
   - Call-sites: `RootAdminsPage` add-modal, `ConfirmDialog`.

## Single-Use Candidates (intake)

1. Drawer fallback trust text block (`Политика доверия: ...`)
   Category: `trust fallback`
   File: `RootAdminsPage.tsx`
   Status: `keep-local-for-now` (узкая доменная ветка).

## Где Увидеть В UI

1. RootAdmins list and bulk block
   Route: `Системные администраторы`.
   Steps: выбрать 1..N строк, открыть блок `Действия для выбранных`.
   Expected: reason presets, applicability hints, status/error messages — консистентный стиль и поведение.

2. Add root-admin modal
   Route: `Системные администраторы -> Добавить`.
   Steps: открыть модалку, проверить reason input/presets/hint.
   Expected: визуальная согласованность с shared controls (`Button`, `ReasonPresetButton`, text tokens).

3. Root-admin drawer
   Route: `Системные администраторы -> Открыть` у строки.
   Steps: проверить header, статусные бейджи, trust-details, fast actions.
   Expected: drawer-блоки в той же визуальной системе, что `Users` drawer.

4. Button semantics on RootAdmins flow
   Route: `Системные администраторы`.
   Steps: пройти сценарии `Добавить`, `Удалить`, bulk-операции и drawer-actions.
   Expected: единая семантика `primary/secondary/ghost/danger`, без page-level кастомного button-style.

## Notes

- Базовая панельная примитивность остается на `Card`.
- Разрешены только wrappers/composition; не вводим параллельный framework для панелей.

## Implemented In This Wave

1. `StatusText` + `MetaText`
   Applied in `RootAdminsPage` for inline status/error/success/muted and helper text hints.

2. `SectionHeaderRow`
   Applied in `RootAdminsPage` drawer header (`title + close action`) for layout consistency with `Users` drawer.

3. `ModalShell`
   Applied in `RootAdminsPage` add-modal; `ConfirmDialog` migrated to the same shell for canonical modal container reuse.

4. `ApplicabilityHint`
   Applied in `RootAdminsPage` bulk block and `UserActionPanel` (Users) for unified applicability meta/hint text.

5. `InlineInfoRow`
   Applied in `RootAdminsPage` trust fallback line and reused in `UserDetailsDrawer` JWT info line.
