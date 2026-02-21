import { formatApiDateTime } from "../../utils/datetime";
import { UI_BULLET } from "../../utils/uiText";
import { shortUserAgent } from "../../utils/userAgent";

type Props = {
  lastIp?: string | null;
  lastUserAgent?: string | null;
  lastActivityAt?: string | null;
  ipLabel?: string;
  deviceLabel?: string;
  activityLabel?: string;
};

export default function UserListSessionMeta({
  lastIp,
  lastUserAgent,
  lastActivityAt,
  ipLabel = "IP",
  deviceLabel = "устройство",
  activityLabel = "активность",
}: Props) {
  const ip = lastIp || "-";
  const device = lastUserAgent ? shortUserAgent(lastUserAgent) : "-";
  const activity = lastActivityAt ? formatApiDateTime(lastActivityAt) : "-";
  const parts = [`${ipLabel}: ${ip}`, `${deviceLabel}: ${device}`, `${activityLabel}: ${activity}`];

  return (
    <div style={{ fontSize: 12, opacity: 0.76 }} title={lastUserAgent || undefined}>
      {parts.join(UI_BULLET)}
    </div>
  );
}
