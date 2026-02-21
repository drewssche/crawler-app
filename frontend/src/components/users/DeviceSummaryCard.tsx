import AccentPill from "../ui/AccentPill";
import Button from "../ui/Button";
import { shortUserAgent } from "../../utils/userAgent";
import { UI_BULLET } from "../../utils/uiText";
import { formatApiDateTime } from "../../utils/datetime";


export type TrustedDeviceItem = {
  id: number;
  policy: string;
  created_at: string;
  expires_at: string | null;
  last_used_at: string | null;
  revoked_at: string | null;
  status: "active" | "expiring_soon" | "expired" | "revoked" | "permanent";
  days_left: number | null;
  device_label?: string | null;
  device_ip?: string | null;
  device_user_agent?: string | null;
  device_source?: string | null;
  device_seen_at?: string | null;
};

function statusLabel(status: TrustedDeviceItem["status"]) {
  switch (status) {
    case "active":
      return "\u0430\u043a\u0442\u0438\u0432\u043d\u043e";
    case "expiring_soon":
      return "\u0438\u0441\u0442\u0435\u043a\u0430\u0435\u0442 \u0441\u043a\u043e\u0440\u043e";
    case "expired":
      return "\u0438\u0441\u0442\u0435\u043a\u043b\u043e";
    case "revoked":
      return "\u043e\u0442\u043e\u0437\u0432\u0430\u043d\u043e";
    case "permanent":
      return "\u0431\u0435\u0441\u0441\u0440\u043e\u0447\u043d\u043e";
    default:
      return status;
  }
}

function statusTone(status: TrustedDeviceItem["status"]): "success" | "warning" | "danger" | "neutral" {
  if (status === "active") return "success";
  if (status === "expiring_soon") return "warning";
  if (status === "expired" || status === "revoked") return "danger";
  return "neutral";
}

export default function DeviceSummaryCard({
  device,
  usageCount = 1,
  isLatest = false,
  onRevoke,
  busy = false,
}: {
  device: TrustedDeviceItem;
  usageCount?: number;
  isLatest?: boolean;
  onRevoke?: () => void;
  busy?: boolean;
}) {
  return (
    <div style={{ border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: 10, display: "grid", gap: 6 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
        {isLatest && <AccentPill tone="info">{"\u043f\u043e\u0441\u043b\u0435\u0434\u043d\u0435\u0435"}</AccentPill>}
        <AccentPill>{device.policy}</AccentPill>
        <AccentPill tone={statusTone(device.status)}>
          {"\u0441\u0442\u0430\u0442\u0443\u0441"}: {statusLabel(device.status)}
        </AccentPill>
        {usageCount > 1 && <AccentPill tone="neutral">{"\u043f\u043e\u0432\u0442\u043e\u0440\u043e\u0432"}: {usageCount}</AccentPill>}
      </div>
      <div style={{ fontSize: 12, opacity: 0.84 }}>
        {"\u0443\u0441\u0442\u0440\u043e\u0439\u0441\u0442\u0432\u043e"}: {device.device_label || shortUserAgent(device.device_user_agent)}
      </div>
      <div style={{ fontSize: 12, opacity: 0.84 }}>
        IP: {device.device_ip || "-"}{UI_BULLET}{"\u0438\u0441\u0442\u043e\u0447\u043d\u0438\u043a"}: {device.device_source || "-"}
      </div>
      <div style={{ fontSize: 12, opacity: 0.84 }}>
        {"\u043f\u043e\u0441\u043b\u0435\u0434\u043d\u0438\u0439 \u0432\u0445\u043e\u0434"}: {(device.last_used_at || device.device_seen_at || device.created_at) ? formatApiDateTime(device.last_used_at || device.device_seen_at || device.created_at || "") : "-"}
      </div>
      <div style={{ fontSize: 12, opacity: 0.84 }}>
        {"\u0438\u0441\u0442\u0435\u043a\u0430\u0435\u0442"}: {device.expires_at ? formatApiDateTime(device.expires_at) : "-"}
      </div>
      {onRevoke && device.status !== "revoked" && (
        <div>
          <Button size="sm" variant="danger" onClick={onRevoke} disabled={busy}>
            {busy ? "\u041e\u0442\u0437\u044b\u0432..." : "\u041e\u0442\u043e\u0437\u0432\u0430\u0442\u044c \u0443\u0441\u0442\u0440\u043e\u0439\u0441\u0442\u0432\u043e"}
          </Button>
        </div>
      )}
    </div>
  );
}
