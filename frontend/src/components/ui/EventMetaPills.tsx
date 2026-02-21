import type { EventItem } from "../../api/events";
import { eventChannelLabel, eventHandledStatusLabel, eventReadStatusLabel, eventSeverityLabel } from "../../utils/eventLabels";
import AccentPill from "./AccentPill";

function severityTone(severity: EventItem["severity"]): "neutral" | "warning" | "danger" {
  if (severity === "danger") return "danger";
  if (severity === "warning") return "warning";
  return "neutral";
}

export default function EventMetaPills({
  channel,
  severity,
  isRead,
  isHandled,
  showHandled = true,
}: {
  channel: EventItem["channel"];
  severity: EventItem["severity"];
  isRead: boolean;
  isHandled?: boolean;
  showHandled?: boolean;
}) {
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      <AccentPill tone="info">канал: {eventChannelLabel(channel)}</AccentPill>
      <AccentPill tone={severityTone(severity)}>уровень: {eventSeverityLabel(severity)}</AccentPill>
      <AccentPill tone={isRead ? "neutral" : "info"}>{eventReadStatusLabel(isRead)}</AccentPill>
      {showHandled && typeof isHandled === "boolean" && (
        <AccentPill tone={isHandled ? "success" : "neutral"}>{eventHandledStatusLabel(isHandled)}</AccentPill>
      )}
    </div>
  );
}

