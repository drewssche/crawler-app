from app.core.metrics import snapshot_metrics

METRIC_DESCRIPTIONS: dict[str, str] = {
    "http_requests_total": "Количество HTTP-запросов к API.",
    "http_errors_total": "Количество HTTP-ошибок (4xx/5xx).",
    "auth_start_result_total": "Результаты старта авторизации по статусам (labels: result).",
    "auth_verify_result_total": "Результаты проверки кода входа по статусам (labels: result).",
    "auth_request_access_result_total": "Результаты заявок на доступ по статусам (labels: result).",
    "admin_bulk_result_total": "Итоги bulk-операций админа (labels: action, changed).",
    "events_center_total": "Количество загрузок центра событий.",
    "events_feed_total": "Количество загрузок полной ленты событий.",
    "events_read_total": "Изменения статуса прочитанности событий.",
    "events_dismiss_total": "Изменения статуса скрытия событий.",
    "monitoring_anomaly_total": "Срабатывания monitoring-anomaly детектора (labels: key, severity).",
}


def flatten_metric_rows(group: str, query: str) -> list[dict[str, str | int | float]]:
    counters = snapshot_metrics()
    group_prefix = group.strip().lower()
    q = query.strip().lower()
    rows: list[dict[str, str | int | float]] = []
    for metric_name, items in counters.items():
        if group_prefix and group_prefix != "all" and not metric_name.startswith(f"{group_prefix}_"):
            continue
        for item in items:
            labels_dict = item.get("labels", {}) if isinstance(item, dict) else {}
            labels = ", ".join(f"{k}={v}" for k, v in sorted(labels_dict.items())) if labels_dict else "-"
            value = item.get("value", 0) if isinstance(item, dict) else 0
            row = {
                "metric": metric_name,
                "description": METRIC_DESCRIPTIONS.get(metric_name, "Служебная метрика."),
                "labels": labels,
                "value": value,
            }
            if q:
                haystack = f"{row['metric']} {row['description']} {row['labels']}".lower()
                if q not in haystack:
                    continue
            rows.append(row)
    rows.sort(key=lambda x: float(x["value"]), reverse=True)
    return rows
