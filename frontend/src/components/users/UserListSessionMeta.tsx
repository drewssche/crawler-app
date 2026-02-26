import { formatApiDateTime } from "../../utils/datetime";
import { UA_TOOLTIP_PREFIX, UI_BULLET } from "../../utils/uiText";
import { parseUserAgentParts } from "../../utils/userAgent";
import { MetaText } from "../ui/StatusText";

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
      : `UA: ${parts.browser} (\u0431\u0440\u0430\u0443\u0437\u0435\u0440)${UI_BULLET}${parts.os} (\u041e\u0421)`;
  const devices = typeof trustedDevicesCount === "number" ? String(trustedDevicesCount) : "-";
  const lineParts = [
    `\u0441\u0435\u0441\u0441\u0438\u044f: ${session}`,
    `IP: ${ip}`,
    uaLabel,
    `\u0443\u0441\u0442\u0440\u043e\u0439\u0441\u0442\u0432: ${devices}`,
  ];

  return (
    <MetaText opacity={0.76} title={lastUserAgent ? `${UA_TOOLTIP_PREFIX}${lastUserAgent}` : undefined}>
      {lineParts.join(UI_BULLET)}
    </MetaText>
  );
}
