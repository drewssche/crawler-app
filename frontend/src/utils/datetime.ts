export function parseApiDate(value: string): Date | null {
  if (!value) return null;
  const hasTimezone = /([zZ]|[+\-]\d{2}:\d{2})$/.test(value);
  const normalized = hasTimezone ? value : `${value}Z`;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

export function timezoneOffsetLabel(date: Date): string {
  const totalMinutes = -date.getTimezoneOffset();
  const sign = totalMinutes >= 0 ? "+" : "-";
  const absMinutes = Math.abs(totalMinutes);
  const hours = Math.floor(absMinutes / 60);
  const minutes = absMinutes % 60;
  if (minutes === 0) return `UTC${sign}${hours}`;
  return `UTC${sign}${hours}:${pad2(minutes)}`;
}

export function formatLocalDateTimeWithOffset(
  date: Date,
  options?: { locale?: string; includeDate?: boolean; includeSeconds?: boolean },
): string {
  const locale = options?.locale || "ru-RU";
  const includeDate = options?.includeDate ?? true;
  const includeSeconds = options?.includeSeconds ?? true;
  const formatter = new Intl.DateTimeFormat(locale, {
    year: includeDate ? "numeric" : undefined,
    month: includeDate ? "2-digit" : undefined,
    day: includeDate ? "2-digit" : undefined,
    hour: "2-digit",
    minute: "2-digit",
    second: includeSeconds ? "2-digit" : undefined,
    hour12: false,
  });
  return `${formatter.format(date)} (${timezoneOffsetLabel(date)})`;
}

export function formatUtcTime(date: Date, options?: { includeSeconds?: boolean }): string {
  const includeSeconds = options?.includeSeconds ?? true;
  const h = pad2(date.getUTCHours());
  const m = pad2(date.getUTCMinutes());
  if (!includeSeconds) return `${h}:${m} UTC`;
  const s = pad2(date.getUTCSeconds());
  return `${h}:${m}:${s} UTC`;
}

export function formatApiDateTime(value: string, locale: string = "ru-RU"): string {
  const date = parseApiDate(value);
  if (!date) return value;
  return formatLocalDateTimeWithOffset(date, { locale, includeDate: true, includeSeconds: true });
}

export function formatApiTime(value: string, locale: string = "ru-RU"): string {
  const date = parseApiDate(value);
  if (!date) return value;
  return formatLocalDateTimeWithOffset(date, { locale, includeDate: false, includeSeconds: true });
}

export function formatTimestampSecondsLocal(value: number, locale: string = "ru-RU"): string {
  const date = new Date(value * 1000);
  return formatLocalDateTimeWithOffset(date, { locale, includeDate: true, includeSeconds: true });
}
