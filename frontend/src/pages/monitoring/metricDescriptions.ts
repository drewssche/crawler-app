export const METRIC_DESCRIPTIONS: Record<string, string> = {
  http_requests_total: "Количество HTTP-запросов к API.",
  http_errors_total: "Количество HTTP-ошибок (4xx/5xx).",
  auth_start_result_total: "Результаты старта авторизации по статусам (labels: result).",
  auth_verify_result_total: "Результаты проверки кода входа по статусам (labels: result).",
  auth_request_access_result_total: "Результаты заявок на доступ по статусам (labels: result).",
  admin_bulk_result_total: "Итоги bulk-операций админа (labels: action, changed).",
  events_center_total: "Количество загрузок центра событий.",
  events_feed_total: "Количество загрузок полной ленты событий.",
  events_read_total: "Изменения статуса прочитанности событий.",
  events_dismiss_total: "Изменения статуса скрытия событий.",
  monitoring_anomaly_total: "Срабатывания monitoring-anomaly детектора (labels: key, severity).",
};
