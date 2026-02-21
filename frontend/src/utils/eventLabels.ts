export function eventChannelLabel(channel: string): string {
  if (channel === "notification") return "уведомления";
  if (channel === "action") return "действия";
  return channel || "—";
}

export function eventSeverityLabel(severity: string): string {
  if (severity === "danger") return "критично";
  if (severity === "warning") return "предупреждение";
  if (severity === "info") return "информация";
  return severity || "—";
}

export function eventReadStatusLabel(isRead: boolean): string {
  return isRead ? "прочитано" : "новое";
}

export function eventHandledStatusLabel(isHandled: boolean): string {
  return isHandled ? "обработано" : "не обработано";
}
