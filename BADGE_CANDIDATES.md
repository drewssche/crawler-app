# Badge Cleanup Candidates

Отдельный список кандидатов на удаление/упрощение бейджей.
Файл ведется как backlog и не означает автоматическое удаление без согласования.

## Active Candidates

1. `relevance.selected`
- Где: `frontend/src/components/users/userBadgeCatalog.ts`
- Почему кандидат: в текущем UI не найдено мест рендера `RelevanceBadge` с `selected`.
- Риск: низкий (визуальный), но перед удалением проверить deep-link/выделение в планируемых сценариях.

2. `time.expires`
- Где: `frontend/src/components/users/userBadgeCatalog.ts`, `frontend/src/components/users/UserStatusPills.tsx`
- Почему кандидат: в текущем list-UX скрыт; используется только в `UserTrustPills`, но в списках отключен.
- Риск: средний, если вернем детальный time-контекст в списки.

3. `time.device.ok|soon|expired|permanent`
- Где: `frontend/src/components/users/userBadgeCatalog.ts`, `frontend/src/components/users/UserStatusPills.tsx`
- Почему кандидат: сейчас не используются в компактном списке пользователей; нужны только если возвращаем device-time в list.
- Риск: средний, влияет на будущее отображение device-time бейджей.

## Already Removed

1. `role.unassigned`
- Статус: удален из каталога и отключен в рендере.
- Причина: шумный бейдж, в pending-контексте заменен на `status.pending`.

