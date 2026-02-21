from pathlib import Path
import re

path = Path(r"d:\python\crawler-app\frontend\src\pages\UsersPage.tsx")
text = path.read_text(encoding="utf-8", errors="ignore")

# Trust hints
text = re.sub(
    r"const TRUST_HINTS:[\s\S]*?};",
    "const TRUST_HINTS: Record<TrustPolicy, string> = {\n"
    "  strict: \"Код при каждом входе.\",\n"
    "  standard: \"Доверие 30 дней.\",\n"
    "  extended: \"Доверие 90 дней.\",\n"
    "  permanent: \"Бессрочное доверие.\",\n"
    "};",
    text,
)

# Reasons
text = re.sub(
    r"revoke\\`, \\{ reason: \"[^\"]*\" \\}\\);",
    "revoke`, { reason: \"Отзыв устройства из карточки пользователя\" });",
    text,
)
text = re.sub(
    r"revoke-except`, \\{[\\s\\S]*?reason: \"[^\"]*\",",
    "revoke-except`, {\n      keep_device_id: keepDeviceId,\n      reason: \"Отзыв всех доверенных устройств, кроме последнего\",",
    text,
)

# Messages
text = re.sub(r"setError\\(\"[^\"]*\"\\);", "setError(\"Сначала выберите пользователей в списке.\");", text)
text = re.sub(r"setMessage\\(\"[^\"]*\"\\);", "setMessage(\"Действие выполнено.\");", text)

# Page title
text = re.sub(r"<h2 style=\\{\\{ marginTop: 0 \\}\\}>.*?</h2>", "<h2 style={{ marginTop: 0 }}>Пользователи</h2>", text)

# Tabs
text = re.sub(r"\\{ value: \"all\", label: \".*?\" \\}", "{ value: \"all\", label: \"Все\" }", text)
text = re.sub(r"\\{ value: \"pending\", label: \".*?\" \\}", "{ value: \"pending\", label: \"Запросившие\" }", text)
text = re.sub(r"\\{ value: \"approved\", label: \".*?\" \\}", "{ value: \"approved\", label: \"Активные\" }", text)
text = re.sub(r"\\{ value: \"deleted\", label: \".*?\" \\}", "{ value: \"deleted\", label: \"Удаленные\" }", text)

# Search input + button
text = re.sub(r"placeholder=\"[^\"]*\"", "placeholder=\"Поиск по email\"", text)
text = re.sub(
    r"<Button variant=\"secondary\"[^>]*>.*?</Button>",
    "<Button variant=\"secondary\" onClick={() => loadUsers(tab, query)}>Найти</Button>",
    text,
    count=1,
)

# Show deleted label
text = re.sub(r"\\n\\s*[^\\n]*Показывать[^\\n]*\\n", "\n          Показывать удалённых\n", text)

# Sort options
text = re.sub(r"<option value=\"id\">.*?</option>", "<option value=\"id\">Сортировка: id</option>", text)
text = re.sub(r"<option value=\"email\">.*?</option>", "<option value=\"email\">Сортировка: email</option>", text)
text = re.sub(r"<option value=\"role\">.*?</option>", "<option value=\"role\">Сортировка: role</option>", text)
text = re.sub(r"\\{ value: \"asc\", label: \".*?\" \\}", "{ value: \"asc\", label: \"По возрастанию\" }", text)
text = re.sub(r"\\{ value: \"desc\", label: \".*?\" \\}", "{ value: \"desc\", label: \"По убыванию\" }", text)

# Header row
text = re.sub(r"title=\"[^\"]*\"", "title=\"Выбрать всех пользователей в текущем списке\"", text, count=1)
text = re.sub(r">.*?Список.*?</div>", ">Список пользователей</div>", text, count=1)
text = re.sub(r">.*?Выбрано:.*?</div>", ">Выбрано: {selected.length}</div>", text, count=1)

# Pending badge
text = re.sub(r"<AccentPill tone=\"info\">.*?</AccentPill>", "<AccentPill tone=\"info\">новый запрос</AccentPill>", text)

# Trust policy title fallback
text = re.sub(r"\\?\\? \"[^\"]*\"\\}", "?? \"Политика доверия\"}", text)

# Session line (approved)
text = re.sub(
    r"\\s*.*last_activity_at.*\\n\\s*.*last_ip.*\\n\\s*.*last_user_agent.*\\n\\s*.*trusted_devices_count.*",
    "                    {u.is_approved && !u.is_deleted && (\n"
    "                      <div style={{ marginTop: 6, fontSize: 12, opacity: 0.74 }}>\n"
    "                        сессия: {u.last_activity_at || \"-\"}\n"
    "                        {u.last_ip ? ` • IP: ${u.last_ip}` : \"\"}\n"
    "                        {u.last_user_agent ? ` • ${shortUserAgent(u.last_user_agent)}` : \"\"}\n"
    "                        {typeof u.trusted_devices_count === \"number\" ? ` • устройств: ${u.trusted_devices_count}` : \"\"}\n"
    "                      </div>\n"
    "                    )}",
    text,
    count=1,
)

# Deleted tab line
text = re.sub(
    r"\\{u.last_activity_at \\? `[^`]*` : \"\"\\}\\n\\s*\\{u.last_activity_at && u.last_ip \\? \"[^\"]*\" : \"\"\\}\\n\\s*\\{u.last_ip \\? `[^`]*` : \"\"\\}",
    "{u.last_activity_at ? `последняя активность: ${u.last_activity_at}` : \"\"}\n"
    "                        {u.last_activity_at && u.last_ip ? \" • \" : \"\"}\n"
    "                        {u.last_ip ? `последний IP: ${u.last_ip}` : \"\"}",
    text,
)

# Open button + empty state + action panel
text = re.sub(r">.*?</Button>", ">Открыть</Button>", text, count=1)
text = re.sub(r"<EmptyState text=\"[^\"]*\" />", "<EmptyState text=\"Пользователи не найдены.\" />", text)
text = re.sub(r"title=\"[^\"]*\"", "title=\"Действия для выбранных пользователей\"", text, count=1)
text = re.sub(
    r"reasonOptionalPlaceholder=\"[^\"]*\"",
    "reasonOptionalPlaceholder=\"Причина действия (необязательно, но рекомендуется)\"",
    text,
)

# Bullet fix
text = text.replace(" ? ", " • ")

path.write_text(text, encoding="utf-8")
