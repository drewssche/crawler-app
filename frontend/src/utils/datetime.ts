export function parseApiDate(value: string): Date | null {
  if (!value) return null;
  const hasTimezone = /([zZ]|[+\-]\d{2}:\d{2})$/.test(value);
  const normalized = hasTimezone ? value : `${value}Z`;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

export function formatApiDateTime(value: string, locale: string = "ru-RU"): string {
  const date = parseApiDate(value);
  if (!date) return value;
  return date.toLocaleString(locale);
}

export function formatApiTime(value: string, locale: string = "ru-RU"): string {
  const date = parseApiDate(value);
  if (!date) return value;
  return date.toLocaleTimeString(locale);
}

