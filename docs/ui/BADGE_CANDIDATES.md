# Badge Cleanup Candidates

Отдельный список кандидатов на удаление/упрощение бейджей.
Файл ведется как backlog и не означает автоматическое удаление без согласования.

## Active Candidates

1. `relevance.selected`
- Где: `frontend/src/components/users/userBadgeCatalog.ts`
- Текущий статус: оставить.
- Почему: ключ реально используется через `selectedUserEmail` в `ActivityLogPage` (контекстная релевантность).
- Риск удаления: средний (сломает сценарий подсветки "выбранного" контекста).

## Removed In Current Cleanup

1. `time.expires`
- Статус: удален из `userBadgeCatalog` и `UserTrustPills`.
- Причина: в текущем UX не рендерился, дублировал trust-контекст.

2. `time.device.ok|soon|expired|permanent`
- Статус: удалены из `userBadgeCatalog` и `UserTrustPills`.
- Причина: не использовались в рендере списков/дроуеров после принятых UX-правок.

## Already Removed Earlier

1. `role.unassigned`
- Статус: удален из каталога и отключен в рендере.
- Причина: шумный бейдж, в pending-контексте заменен на `status.pending`.
