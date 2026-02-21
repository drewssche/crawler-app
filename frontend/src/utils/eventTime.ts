import { parseApiDate } from "./datetime";

function parseNumericTimestamp(raw: number): number {
  // Accept both seconds and milliseconds epoch.
  if (raw > 1_000_000_000_000) return Math.floor(raw / 1000);
  return Math.floor(raw);
}

export function toEventTimestampSeconds(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return parseNumericTimestamp(raw);
  }
  if (typeof raw === "string" && raw.trim()) {
    const n = Number(raw);
    if (Number.isFinite(n)) return parseNumericTimestamp(n);
    const parsed = parseApiDate(raw);
    if (!parsed) return null;
    return Math.floor(parsed.getTime() / 1000);
  }
  return null;
}

export function eventTimestampFromMetaOrCreatedAt(meta: Record<string, unknown> | null | undefined, createdAt: string): number | null {
  const fromMetaDetected = toEventTimestampSeconds(meta?.detected_at_utc);
  if (fromMetaDetected !== null) return fromMetaDetected;
  const fromMetaEventTs = toEventTimestampSeconds(meta?.event_ts);
  if (fromMetaEventTs !== null) return fromMetaEventTs;
  return toEventTimestampSeconds(createdAt);
}

export function formatEventMarkerTime(raw: unknown): string | null {
  const seconds = toEventTimestampSeconds(raw);
  if (seconds === null) return null;
  const date = new Date(seconds * 1000);
  const local = date.toLocaleString("ru-RU");
  const utc = date.toISOString().replace("T", " ").replace("Z", " UTC");
  return `Момент события: ${local} (локальное), ${utc}`;
}

export function formatEventMarkerLocalShort(raw: unknown): string | null {
  const seconds = toEventTimestampSeconds(raw);
  if (seconds === null) return null;
  const date = new Date(seconds * 1000);
  return date.toLocaleString("ru-RU");
}
