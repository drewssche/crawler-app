import { useMemo, useState } from "react";
import Button from "../ui/Button";
import Card from "../ui/Card";
import SlidePanel from "../ui/SlidePanel";
import DeviceSummaryCard, { type TrustedDeviceItem } from "./DeviceSummaryCard";
import SessionSummaryCard, { type LoginHistoryItem } from "./SessionSummaryCard";
import UserActionPanel, { type ActionCatalogItem, type BulkAction, type TrustPolicy, type TrustPolicyCatalogItem } from "./UserActionPanel";
import IdentityBadgeRow from "./IdentityBadgeRow";
import UserBadgeGroups from "./UserBadgeGroups";
import TrustPolicyDetailsCard from "./TrustPolicyDetailsCard";
import { UserStatusPills } from "./UserStatusPills";
import { shortUserAgent } from "../../utils/userAgent";
import { UI_BULLET } from "../../utils/uiText";
import { resolveDisplayRole } from "../../utils/roles";
import { formatApiDateTime } from "../../utils/datetime";

export type UserDetailsResponse = {
  user: {
    id: number;
    email: string;
    role: string;
    is_root_admin: boolean;
    is_approved: boolean;
    is_admin: boolean;
    is_blocked: boolean;
    is_deleted: boolean;
    trust_policy: TrustPolicy;
    trusted_days_left: number | null;
    token_version: number;
    last_activity_at: string | null;
    last_ip: string | null;
    last_user_agent: string | null;
    known_ips: string[];
  };
  session: {
    jwt_ttl_minutes: number;
    estimated_jwt_expires_at: string | null;
    estimated_jwt_left_seconds: number | null;
  };
  trusted_devices: TrustedDeviceItem[];
  login_history: LoginHistoryItem[];
  admin_actions: Array<{
    id: number;
    created_at: string;
    action: string;
    ip: string | null;
    meta?: Record<string, unknown>;
  }>;
  anomalies?: {
    invalid_code_24h: number;
    frequent_invalid_code: boolean;
    latest_ip_is_new: boolean;
    ua_changed_recently: boolean;
  };
};

type DeviceGroup = {
  key: string;
  device: TrustedDeviceItem;
  count: number;
  latestAtTs: number;
};

function eventTs(value: string | null | undefined) {
  if (!value) return 0;
  const t = Date.parse(value);
  return Number.isNaN(t) ? 0 : t;
}

function deviceGroupKey(device: TrustedDeviceItem): string {
  return [
    device.policy,
    device.device_ip || "",
    device.device_source || "",
    device.device_label || "",
    shortUserAgent(device.device_user_agent || null),
  ].join("|");
}

export default function UserDetailsDrawer({
  open,
  loading,
  error,
  data,
  currentUserEmail,
  availableActions,
  actionCatalog,
  trustPolicyCatalog,
  browserJwtLeftSeconds,
  onRunAction,
  onRevokeTrustedDevice,
  onRevokeTrustedDevicesExceptLatest,
  onClose,
}: {
  open: boolean;
  loading: boolean;
  error: string;
  data: UserDetailsResponse | null;
  currentUserEmail?: string | null;
  availableActions: BulkAction[];
  actionCatalog: Record<string, ActionCatalogItem>;
  trustPolicyCatalog: Record<string, TrustPolicyCatalogItem>;
  browserJwtLeftSeconds: number | null;
  onRunAction: (payload: { action: BulkAction; role?: "viewer" | "editor" | "admin"; trust_policy?: TrustPolicy; reason?: string }) => Promise<void>;
  onRevokeTrustedDevice: (deviceId: number) => Promise<void>;
  onRevokeTrustedDevicesExceptLatest: (keepDeviceId: number) => Promise<void>;
  onClose: () => void;
}) {
  const [showAllTrustedDevices, setShowAllTrustedDevices] = useState(false);
  const [deviceActionBusy, setDeviceActionBusy] = useState<number | "except_latest" | null>(null);
  const [deviceActionError, setDeviceActionError] = useState("");

  const normalizedAvailable = availableActions ?? [];
  const isSelfUser =
    !!currentUserEmail &&
    !!data?.user?.email &&
    data.user.email.toLowerCase() === currentUserEmail.toLowerCase();

  const sortedLogins = useMemo(() => {
    if (!data) return [];
    const items = Array.isArray(data.login_history) ? data.login_history : [];
    return [...items].sort((a, b) => eventTs(b.created_at) - eventTs(a.created_at));
  }, [data]);

  const latestLogin = sortedLogins[0] ?? null;

  const loginHistoryPreview = useMemo(() => {
    const unique: LoginHistoryItem[] = [];
    const seen = new Set<string>();
    for (const row of sortedLogins) {
      const key = [row.result, row.source, row.ip || "", shortUserAgent(row.user_agent)].join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(row);
      if (unique.length >= 5) break;
    }
    return unique;
  }, [sortedLogins]);

  const groupedDevices = useMemo(() => {
    if (!data) return [] as DeviceGroup[];
    const map = new Map<string, DeviceGroup>();
    const devices = Array.isArray(data.trusted_devices) ? data.trusted_devices : [];

    for (const item of devices) {
      const key = deviceGroupKey(item);
      const ts = Math.max(eventTs(item.last_used_at), eventTs(item.device_seen_at), eventTs(item.created_at));
      const existing = map.get(key);
      if (!existing) {
        map.set(key, { key, device: item, count: 1, latestAtTs: ts });
      } else {
        existing.count += 1;
        if (ts > existing.latestAtTs) {
          existing.latestAtTs = ts;
          existing.device = item;
        }
      }
    }

    return [...map.values()].sort((a, b) => b.latestAtTs - a.latestAtTs);
  }, [data]);

  const visibleDevices = showAllTrustedDevices ? groupedDevices : groupedDevices.slice(0, 1);
  const hiddenDevicesCount = Math.max(0, groupedDevices.length - visibleDevices.length);
  const latestDevice = groupedDevices[0]?.device ?? null;

  async function handleRevokeDevice(deviceId: number) {
    setDeviceActionBusy(deviceId);
    setDeviceActionError("");
    try {
      await onRevokeTrustedDevice(deviceId);
    } catch (e) {
      setDeviceActionError(String(e));
    } finally {
      setDeviceActionBusy(null);
    }
  }

  async function handleRevokeExceptLatest() {
    if (!latestDevice) return;
    setDeviceActionBusy("except_latest");
    setDeviceActionError("");
    try {
      await onRevokeTrustedDevicesExceptLatest(latestDevice.id);
    } catch (e) {
      setDeviceActionError(String(e));
    } finally {
      setDeviceActionBusy(null);
    }
  }

  return (
    <SlidePanel open={open} onClose={onClose}>
      <div style={{ padding: 16, borderBottom: "1px solid rgba(255,255,255,0.08)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 800 }}>Карточка пользователя</div>
          <div style={{ fontSize: 12, opacity: 0.7 }}>ID: {data?.user.id ?? "-"}</div>
        </div>
        <Button onClick={onClose} size="sm" variant="ghost">Закрыть</Button>
      </div>

      <div style={{ overflowY: "auto", padding: 16, display: "grid", gap: 12 }}>
        {loading && <div>Загрузка...</div>}
        {error && <div style={{ color: "#e67f7f" }}>{error}</div>}

        {!loading && !error && data && (
          <>
            <Card>
              <div style={{ display: "grid", gap: 8 }}>
                <div style={{ fontWeight: 700 }}>{data.user.email}</div>
                <UserBadgeGroups
                  identity={
                    data.user.is_approved ? (
                      <IdentityBadgeRow
                        role={resolveDisplayRole(data.user)}
                        showSelf={!!currentUserEmail && data.user.email.toLowerCase() === currentUserEmail.toLowerCase()}
                      />
                    ) : null
                  }
                  status={(
                    <UserStatusPills
                      user={{ ...data.user, role: null }}
                      showBlockedWhenFalse={false}
                      showBlockedForDeleted
                      hideRole
                    />
                  )}
                />
                {data.user.is_approved && !data.user.is_deleted && (
                  <TrustPolicyDetailsCard
                    trustPolicy={data.user.trust_policy}
                    trustPolicyCatalog={trustPolicyCatalog as Record<TrustPolicy, TrustPolicyCatalogItem>}
                  />
                )}
                {!data.user.is_approved && !data.user.is_deleted && (
                  <div style={{ fontSize: 12, opacity: 0.8 }}>статус: ожидает подтверждения</div>
                )}
                <div
                  style={{ fontSize: 13, opacity: 0.78 }}
                  title="Версия JWT. Увеличивается при security-действиях (отзыв сессий, смена роли, блокировка). Старые токены становятся недействительными."
                >
                  Версия токена (JWT): {data.user.token_version}
                </div>
              </div>
            </Card>

            <Card>
              <SessionSummaryCard
                latestLogin={latestLogin}
                lastActivityAt={data.user.last_activity_at}
                lastIp={data.user.last_ip}
                lastUserAgent={data.user.last_user_agent}
                serverTtlMinutes={data.session.jwt_ttl_minutes}
                userJwtExpiresAt={data.session.estimated_jwt_expires_at}
                userJwtLeftSeconds={data.session.estimated_jwt_left_seconds}
                browserJwtLeftSeconds={browserJwtLeftSeconds}
              />
            </Card>

            <UserActionPanel
              availableActions={normalizedAvailable}
              actionCatalog={actionCatalog as Record<BulkAction, ActionCatalogItem>}
              trustPolicyCatalog={trustPolicyCatalog as Record<TrustPolicy, TrustPolicyCatalogItem>}
              onRunAction={onRunAction}
            />

            <Card>
              <div style={{ display: "grid", gap: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                  <div style={{ fontWeight: 700 }}>Доверенные устройства ({groupedDevices.length})</div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    {groupedDevices.length > 1 && latestDevice && !isSelfUser && (
                      <Button size="sm" variant="secondary" onClick={handleRevokeExceptLatest} disabled={deviceActionBusy !== null}>
                        {deviceActionBusy === "except_latest" ? "Отзыв..." : "Отозвать все кроме последнего"}
                      </Button>
                    )}
                    {groupedDevices.length > 1 && (
                      <Button onClick={() => setShowAllTrustedDevices((v) => !v)} size="sm" variant="ghost">
                        {showAllTrustedDevices ? "Свернуть" : "Показать все"}
                      </Button>
                    )}
                  </div>
                </div>

                {deviceActionError && <div style={{ color: "#e67f7f", fontSize: 12 }}>{deviceActionError}</div>}
                {isSelfUser && groupedDevices.length > 0 && (
                  <div style={{ fontSize: 12, opacity: 0.75 }}>Вы не можете отозвать для себя.</div>
                )}
                {groupedDevices.length === 0 && <div style={{ fontSize: 13, opacity: 0.75 }}>Устройств пока нет</div>}
                {groupedDevices.length > 0 && !showAllTrustedDevices && hiddenDevicesCount > 0 && (
                  <div style={{ fontSize: 12, opacity: 0.75 }}>еще устройств: {hiddenDevicesCount}</div>
                )}

                {visibleDevices.map((group, index) => (
                  <DeviceSummaryCard
                    key={group.key}
                    device={group.device}
                    usageCount={group.count}
                    isLatest={index === 0}
                    onRevoke={data.user.is_approved && !isSelfUser ? () => handleRevokeDevice(group.device.id) : undefined}
                    busy={deviceActionBusy === group.device.id}
                  />
                ))}
              </div>
            </Card>

            <Card>
              <div style={{ display: "grid", gap: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                  <div style={{ fontWeight: 700 }}>История входов и IP</div>
                  <a href={`/logs?mode=login&email=${encodeURIComponent(data.user.email)}`} style={{ fontSize: 12, textDecoration: "none" }}>
                    Открыть полный журнал входов
                  </a>
                </div>

                {loginHistoryPreview.length === 0 && <div style={{ fontSize: 13, opacity: 0.75 }}>Записей нет</div>}
                {loginHistoryPreview.map((row) => (
                  <div key={row.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.06)", paddingBottom: 6 }}>
                    <div style={{ fontSize: 13 }}><b>{row.result}</b>{UI_BULLET}{row.source}</div>
                    <div style={{ fontSize: 12, opacity: 0.8 }}>Когда: {row.created_at ? formatApiDateTime(row.created_at) : "-"}</div>
                    <div style={{ fontSize: 12, opacity: 0.8 }}>IP: {row.ip || "-"}</div>
                    <div style={{ fontSize: 12, opacity: 0.8 }} title={row.user_agent || "-"}>
                      UA (идентификатор браузера/устройства): {shortUserAgent(row.user_agent)}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </>
        )}
      </div>
    </SlidePanel>
  );
}
