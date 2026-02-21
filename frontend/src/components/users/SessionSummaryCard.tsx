import { shortUserAgent } from "../../utils/userAgent";
import { UI_BULLET } from "../../utils/uiText";
import { formatApiDateTime } from "../../utils/datetime";
export type LoginHistoryItem = {
  id: number;
  created_at: string;
  ip: string | null;
  user_agent: string | null;
  result: string;
  source: string;
};

function formatSeconds(seconds: number | null) {
  if (seconds === null) return "-";
  if (seconds <= 0) return "\u0438\u0441\u0442\u0435\u043a\u043b\u043e";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h} \u0447 ${m} \u043c\u0438\u043d`;
  return `${m} \u043c\u0438\u043d`;
}

export default function SessionSummaryCard({
  latestLogin,
  lastActivityAt,
  lastIp,
  lastUserAgent,
  serverTtlMinutes,
  userJwtExpiresAt,
  userJwtLeftSeconds,
  browserJwtLeftSeconds,
}: {
  latestLogin: LoginHistoryItem | null;
  lastActivityAt: string | null;
  lastIp: string | null;
  lastUserAgent: string | null;
  serverTtlMinutes: number;
  userJwtExpiresAt: string | null;
  userJwtLeftSeconds: number | null;
  browserJwtLeftSeconds: number | null;
}) {
  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div style={{ fontWeight: 700 }}>
        {"\u041f\u043e\u0441\u043b\u0435\u0434\u043d\u044f\u044f \u0441\u0435\u0441\u0441\u0438\u044f"}
      </div>
      <div style={{ fontSize: 13, opacity: 0.88 }}>
        {"\u0430\u043a\u0442\u0438\u0432\u043d\u043e\u0441\u0442\u044c"}: {lastActivityAt ? formatApiDateTime(lastActivityAt) : "-"}
      </div>
      <div style={{ fontSize: 13, opacity: 0.88 }}>IP: {lastIp || "-"}</div>
      <div style={{ fontSize: 13, opacity: 0.88 }} title={lastUserAgent || "-"}>
        {"\u0443\u0441\u0442\u0440\u043e\u0439\u0441\u0442\u0432\u043e"}: {shortUserAgent(lastUserAgent)}
      </div>

      <div style={{ fontSize: 13, opacity: 0.82, marginTop: 2 }}>
        JWT TTL: {serverTtlMinutes} {"\u043c\u0438\u043d"}{UI_BULLET}{"\u0434\u043e \u043a\u043e\u043d\u0446\u0430"}: {formatSeconds(userJwtLeftSeconds)}{UI_BULLET}{"\u0438\u0441\u0442\u0435\u043a\u0430\u0435\u0442"}: {userJwtExpiresAt ? formatApiDateTime(userJwtExpiresAt) : "-"}
      </div>
      <div style={{ fontSize: 12, opacity: 0.72 }}>
        {"JWT \u0432 \u0442\u0435\u043a\u0443\u0449\u0435\u043c \u0431\u0440\u0430\u0443\u0437\u0435\u0440\u0435 (admin):"} {formatSeconds(browserJwtLeftSeconds)}
      </div>

      <div style={{ marginTop: 4, borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: 8 }}>
        <div style={{ fontSize: 12, fontWeight: 700, opacity: 0.86 }}>
          {"\u041f\u043e\u0441\u043b\u0435\u0434\u043d\u0438\u0439 \u0432\u0445\u043e\u0434"}
        </div>
        {!latestLogin && <div style={{ fontSize: 12, opacity: 0.72 }}>{"\u0434\u0430\u043d\u043d\u044b\u0445 \u043d\u0435\u0442"}</div>}
        {latestLogin && (
          <>
            <div style={{ fontSize: 12, opacity: 0.84 }}>{latestLogin.result}{UI_BULLET}{latestLogin.source}</div>
            <div style={{ fontSize: 12, opacity: 0.84 }}>{"\u043a\u043e\u0433\u0434\u0430"}: {latestLogin.created_at ? formatApiDateTime(latestLogin.created_at) : "-"}</div>
            <div style={{ fontSize: 12, opacity: 0.84 }}>IP: {latestLogin.ip || "-"}</div>
            <div style={{ fontSize: 12, opacity: 0.84 }} title={latestLogin.user_agent || "-"}>
              {"\u0443\u0441\u0442\u0440\u043e\u0439\u0441\u0442\u0432\u043e"}: {shortUserAgent(latestLogin.user_agent)}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
