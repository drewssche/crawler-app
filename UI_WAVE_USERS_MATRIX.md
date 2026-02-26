# UI Wave: Users

Цель волны: найти hardcoded UI-паттерны в `UsersPage` и связанных user-компонентах, вынести только то, что реально переиспользуется (минимум 2 call-sites), без UX-изменений.

## Scope

- `frontend/src/pages/UsersPage.tsx`
- `frontend/src/components/users/UserDetailsDrawer.tsx`
- `frontend/src/components/users/UserActionPanel.tsx`
- `frontend/src/components/users/UserBadgeGroups.tsx`
- `frontend/src/components/users/IdentityBadgeRow.tsx`
- `frontend/src/components/users/SessionSummaryCard.tsx`
- `frontend/src/components/users/DeviceSummaryCard.tsx`
- `frontend/src/components/users/TrustPolicyDetailsCard.tsx`
- `frontend/src/components/users/CompactActionCard.tsx`
- `frontend/src/components/users/UserListSessionMeta.tsx`

## Reuse-Ready (>=2 call-sites)

1. Drawer section header row
   Pattern: `title + optional actions` в одной строке (`display:flex`, `justify-content:space-between`, `gap`, `align-items:center`).
   Current call-sites: `UserDetailsDrawer` (блоки `Доверенные устройства`, `История входов и IP`), аналогичные секции есть в других drawer/page контекстах.
   Proposal: wrapper `SectionHeaderRow` поверх существующей верстки.

2. Muted meta text tokens
   Pattern: повторяющиеся `fontSize 12/13 + opacity 0.72..0.88` для технического/вторичного текста.
   Current call-sites: `UserDetailsDrawer`, `SessionSummaryCard`, `DeviceSummaryCard`, `UserActionPanel`, `UsersPage`.
   Proposal: small text wrappers (`MetaText`) или style-tokens в одном месте.

3. Error/status inline message style
   Pattern: локальные цветовые литералы для ошибок (`#e67f7f`, `#d55`) и success (`#8fd18f`).
   Current call-sites: `UsersPage`, `UserActionPanel`, `UserDetailsDrawer`.
   Proposal: shared semantic text styles (`error/success/warning/muted`) без изменения поведения.

4. Border/card-like mini container inside cards
   Pattern: локальный bordered box (`border`, `borderRadius`, `padding`) для компактных summary-блоков.
   Current call-sites: `DeviceSummaryCard`, preview-строки истории в `UserDetailsDrawer`, похожие блоки в соседних страницах.
   Proposal: lightweight wrapper на базе `Card` composition (без нового panel framework).

## Implemented In This Wave

1. `SectionHeaderRow` (`frontend/src/components/ui/SectionHeaderRow.tsx`)
   Applied in `UserDetailsDrawer` (2 секции).

2. `StatusText` + `MetaText` (`frontend/src/components/ui/StatusText.tsx`)
   Applied in `UsersPage`, `UserActionPanel`, `UserDetailsDrawer`, `SessionSummaryCard`, `DeviceSummaryCard`, `UserListSessionMeta`.

3. `DeviceSummaryCard` shell aligned to `Card` composition
   Local bordered container switched to `Card` base (no UX/behavior change).

## Button Slice (Users)

1. Already aligned (semantic OK)
   - Base `Button` variants in `UsersPage` (`primary/secondary/ghost/danger` by action intent).
   - `ReasonPresetButton` in `UserActionPanel` for reason chips (shared wrapper, no local pill-style literals).
   - Drawer/list actions follow common button rhythm (`sm` inline, `md` section-level).

2. Candidates for future button reuse
   - `UserActionPanel` action icon bubble (`i/!`) can evolve into shared `ActionStateMarker` if 2nd call-site appears.
   - Rare local button+hint couplings in apply-status blocks can be normalized only if reused outside Users domain.

## Где Увидеть В UI

1. `UsersPage` list/status messages
   Route: `Пользователи`.
   Steps: открыть страницу, выполнить поиск, очистить фильтр, дождаться empty/loading/success сообщений.
   Expected: единый тон сообщений (`danger/success/muted`), без локального color-drift.

2. `UsersPage -> UserDetailsDrawer`
   Route: `Пользователи -> Открыть` у любой строки.
   Steps: открыть drawer, прокрутить блоки `Доверенные устройства` и `История входов и IP`.
   Expected: одинаковая строка заголовка секции (`title + actions`) через общий layout.

3. `UsersPage -> UserDetailsDrawer -> UserActionPanel`
   Route: `Пользователи -> Открыть`.
   Steps: выбрать действие с частичной/нулевой применимостью.
   Expected: warning/error/meta тексты выглядят консистентно с остальными страницами.

4. Button semantics on Users flow
   Route: `Пользователи`.
   Steps: открыть `Действия для выбранных`, проверить `primary/secondary/ghost/danger`, пресеты причины, кнопки в drawer.
   Expected: кнопки соответствуют общему semantic-map без локального style-drift.

## Keep As-Is (already reusable / aligned)

1. `Card` как база панелей в user-контекстах.
2. `Button` variants (`primary/secondary/ghost/danger/panel-toggle`) по текущему контракту.
3. `SelectableListRow`, `UserBadgeGroups`, `IdentityBadgeRow`, `UserStatusPills/UserTrustPills`, `TrustPolicyDetailsCard`, `UserListSessionMeta`.

## Non-Reused (single-use now)

Одиночные паттерны вынесены в отдельный backlog: `UI_SINGLE_USE_BACKLOG.md`.
