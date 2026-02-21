# BADGE_INDEX

Единый реестр бейджей в frontend: где определены, какой текст показывают, в какой группе и при каких условиях рендерятся.

## 1) Базовый каталог пользовательских бейджей (single source of truth)

Источник:
- `frontend/src/components/users/userBadgeCatalog.ts`

Ключи и тексты:

| Группа | Ключ | Текст |
|---|---|---|
| role | `role.viewer` | `Наблюдатель` |
| role | `role.editor` | `Редактор` |
| role | `role.admin` | `Администратор` |
| role | `role.root-admin` | `Root-admin` |
| relevance | `relevance.self` | `Вы` |
| relevance | `relevance.selected` | `Выбранный пользователь` |
| status | `status.approve` | `доступ подтверждён` |
| status | `status.blocked` | `заблокирован` |
| status | `status.deleted` | `удалён` |
| status | `status.pending` | `ожидает подтверждения` |
| trust | `trust.standard` | `доверие: стандарт` |
| trust | `trust.strict` | `доверие: строгое` |
| trust | `trust.extended` | `доверие: расширенное` |
| trust | `trust.permanent` | `доверие: бессрочное` |
| time | `time.expires` | `срок доверия` |
| time | `time.device.ok` | `статус устройства` |
| time | `time.device.soon` | `статус устройства` |
| time | `time.device.expired` | `статус устройства` |
| time | `time.device.permanent` | `статус устройства` |

Где используются:
- `frontend/src/components/ui/RoleBadge.tsx`
- `frontend/src/components/ui/RelevanceBadge.tsx`
- `frontend/src/components/users/UserStatusPills.tsx`

## 2) Производные бейджи статуса пользователя (рендер-логика)

Источник:
- `frontend/src/components/users/UserStatusPills.tsx`

Правила:
- Роль: через `RoleBadge` (не показывается для `не назначена`).
- Pending: `ожидает подтверждения` при `!is_approved && preferPendingBadge && !is_deleted`.
- Approve: `доступ подтверждён: да/нет` только если включены соответствующие флаги показа и `!is_deleted`.
- Blocked:
  - `заблокирован` при `is_blocked=true && !is_deleted`
  - `не заблокирован` при `showBlockedWhenFalse=true && !is_deleted`
  - `заблокирован` также для удалённого пользователя при `is_deleted=true && is_blocked=true && showBlockedForDeleted=true`.
- Deleted: `удалён` при `is_deleted=true`.

## 3) Производные trust/time бейджи пользователя

Источник:
- `frontend/src/components/users/UserStatusPills.tsx` (`UserTrustPills`)

Правила:
- Trust-policy бейдж (`доверие: ...`) всегда от текущей политики.
- Expires-бейдж (`срок доверия: N дн.`) показывается по `showExpires` и только при конечном сроке (или если явно разрешен `not configured`).
- Device-status бейдж (`статус устройства: ...`) показывается по `showDeviceStatus`.
- Для `trustedDaysLeft < 0` статус считается `бессрочно`.

## 4) Identity row в контекстах пользователя

Источник:
- `frontend/src/components/users/IdentityBadgeRow.tsx`

Состав:
- `RoleBadge`
- `RelevanceBadge` (`Вы`) при self-контексте
- Доп. бейджи наличия:
  - `есть в БД`
  - `только ADMIN_EMAILS`

## 5) Event meta бейджи (центр событий и правый sidebar)

Источник:
- `frontend/src/components/ui/EventMetaPills.tsx`

Состав:
- `канал: ...`
- `уровень: ...`
- `прочитано/не прочитано`
- `обработано/не обработано` (если `showHandled=true`)

Тексты значений берутся из:
- `frontend/src/utils/eventLabels.ts`

## 6) Trust detail chips (блок "Параметры доверия")

Источник:
- `frontend/src/components/users/TrustPolicyDetailChips.tsx`

Состав:
- `Код: ...`
- `Срок доверия: ...`
- `Риск: ...`

Значения приходят из backend `trust_policy_catalog`.

## 7) Локальные бейджи вне userBadgeCatalog

Это не каталог ролей/статусов, а контекстные/служебные бейджи на `AccentPill`:
- `frontend/src/components/users/DeviceSummaryCard.tsx`:
  - `последнее`, `policy`, `статус: ...`, `повторов: N`
- `frontend/src/pages/RootAdminsPage.tsx`:
  - предупреждения типа `нельзя удалить себя`, `нельзя удалить последнего root-admin`
- `frontend/src/pages/ActivityLogPage.tsx`:
  - `Помечено как обработанное` и пр. контекстные статусы

## 8) Как вносить изменения корректно

1. Если это role/relevance/status/trust/time пользователя:
- меняем в `frontend/src/components/users/userBadgeCatalog.ts`.

2. Если это логика показа (когда бейдж отображать):
- меняем в `frontend/src/components/users/UserStatusPills.tsx`.

3. Если это event-meta:
- меняем в `frontend/src/components/ui/EventMetaPills.tsx` и при необходимости в `frontend/src/utils/eventLabels.ts`.

4. Не добавлять локальные ad-hoc цвета для системных пользовательских бейджей в страницах.
