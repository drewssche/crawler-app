# Manual Cleanup Queue

Файлы, которые не удалось удалить автоматически из-за прав/ACL:

- `backend/app/api/compare.py` (0 bytes)
- `backend/app/api/pages.py` (0 bytes)

Команды для ручного удаления (PowerShell от администратора в корне проекта):

```powershell
attrib -R backend\app\api\compare.py
attrib -R backend\app\api\pages.py
icacls backend\app\api\compare.py /grant "%USERNAME%":F
icacls backend\app\api\pages.py /grant "%USERNAME%":F
Remove-Item backend\app\api\compare.py -Force
Remove-Item backend\app\api\pages.py -Force
```


## Loadtest Data Cleanup (near production cutover)

Staging-like performance validation added synthetic rows to dev DB:
- login_history (email like 'loadtest%@example.com', user_agent='Mozilla/5.0 loadtest')
- dmin_audit_logs (meta_json.reason='loadtest', user_agent='Mozilla/5.0 loadtest')
- 	rusted_devices (synthetic batch for index validation)

Decision: keep for now (for repeatable EXPLAIN/perf checks).

Before prod-like runs/cutover, cleanup is recommended:
1. Preferred: reset/restore clean PostgreSQL data volume from sanitized backup.
2. Optional targeted cleanup for marked rows:
`sql
DELETE FROM login_history WHERE email LIKE 'loadtest%@example.com' OR user_agent = 'Mozilla/5.0 loadtest';
DELETE FROM admin_audit_logs WHERE user_agent = 'Mozilla/5.0 loadtest' OR (meta_json->>'reason') = 'loadtest';
` 
3. 	rusted_devices synthetic rows are not safely distinguishable by marker; prefer full DB reset/restore for guaranteed cleanup.



## One-off Tools Cleanup Queue

Candidates for remove/archive (non-runtime, one-time scripts with legacy hardcoded path):
- 	ools/fix_userspage.py`r
- 	ools/fix_userspage_regex.py`r



## Policy note (manual mode)
- By current agreement, file deletions from this queue are not executed by agent in-session.
- Agent only updates queue and verification context; user performs physical deletion manually.

