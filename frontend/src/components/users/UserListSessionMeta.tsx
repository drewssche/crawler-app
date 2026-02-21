import { formatApiDateTime } from "../../utils/datetime";
import { UA_TOOLTIP_PREFIX, UI_BULLET } from "../../utils/uiText";
import { parseUserAgentParts } from "../../utils/userAgent";

type Props = {
  lastIp?: string | null;
  lastUserAgent?: string | null;
  lastActivityAt?: string | null;
  trustedDevicesCount?: number | null;
};

export default function UserListSessionMeta({
  lastIp,
  lastUserAgent,
  lastActivityAt,
  trustedDevicesCount,
}: Props) {
  const ip = lastIp || "-";
  const session = lastActivityAt ? formatApiDateTime(lastActivityAt) : "-";
  const parts = parseUserAgentParts(lastUserAgent);
  const uaLabel =
    parts.browser === "-" && parts.os === "-"
      ? "UA: -"
      : `UA: ${parts.browser} (браузер)${UI_BULLET}${parts.os} (ОС)`;
  const devices = typeof trustedDevicesCount === "number" ? String(trustedDevicesCount) : "-";
  const lineParts = [
    `сессия: ${session}`,
    `IP: ${ip}`,
    uaLabel,
    `устройств: ${devices}`,
  ];

  return (
    <div
      style={{ fontSize: 12, opacity: 0.76 }}
      title={lastUserAgent ? `${UA_TOOLTIP_PREFIX}${lastUserAgent}` : undefined}
    >
      {lineParts.join(UI_BULLET)}
    </div>
  );
}
