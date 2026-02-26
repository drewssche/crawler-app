# Manual Cleanup Queue

Файлы, которые не удаляем в агент-сессии по текущему соглашению (manual mode):

- `backend/app/api/compare.py` (0 bytes)
- `backend/app/api/pages.py` (0 bytes)

Команды для ручного удаления (PowerShell, из корня проекта):

```powershell
attrib -R backend\app\api\compare.py
attrib -R backend\app\api\pages.py
icacls "backend\app\api\compare.py" /grant "$($env:USERNAME):(F)"
icacls "backend\app\api\pages.py" /grant "$($env:USERNAME):(F)"
Remove-Item "backend\app\api\compare.py" -Force
Remove-Item "backend\app\api\pages.py" -Force
```

## Loadtest Data Cleanup (near production cutover)

В staging-like проверках были добавлены синтетические строки в dev DB:

- `login_history` (`email` like `loadtest%@example.com`, `user_agent='Mozilla/5.0 loadtest'`)
- `admin_audit_logs` (`meta_json.reason='loadtest'`, `user_agent='Mozilla/5.0 loadtest'`)
- `trusted_devices` (синтетический batch для проверки index path)

Decision now: оставить до завершения perf-повторов.

Перед prod-like запуском:

1. Предпочтительно: полный reset/restore PostgreSQL volume из чистого бэкапа.
2. Опционально: таргетированная чистка маркированных строк:

```sql
DELETE FROM login_history
WHERE email LIKE 'loadtest%@example.com'
   OR user_agent = 'Mozilla/5.0 loadtest';

DELETE FROM admin_audit_logs
WHERE user_agent = 'Mozilla/5.0 loadtest'
   OR (meta_json->>'reason') = 'loadtest';
```

3. Для `trusted_devices` безопасного маркера нет; для гарантированной очистки использовать reset/restore.

## One-off Tools Cleanup Queue

Кандидаты на remove/archive (one-time scripts, не runtime):

- `tools/fix_userspage.py`
- `tools/fix_userspage_regex.py`

## Button Full-Sweep (2026-02-25)

- Ручных удалений файлов по button-волне не требуется.
- Найденные legacy-кейсы по кнопкам очищены автоматически в коде:
  - `frontend/src/components/layout/AppLayout.tsx`
  - `frontend/src/components/ui/ToastHost.tsx`

## Policy Note (manual mode)

- По текущему соглашению физическое удаление файлов из этого списка выполняется вручную.
- Агент ведет очередь, верификацию и синхронизацию с `TODO.md`/audit-доками.
