import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { apiPost, isAbortError } from "../api/client";
import Button from "../components/ui/Button";
import Card from "../components/ui/Card";
import ClearableInput from "../components/ui/ClearableInput";
import ListTotalMeta from "../components/ui/ListTotalMeta";
import RelevanceBadge from "../components/ui/RelevanceBadge";
import RolePermissionsHint from "../components/ui/RolePermissionsHint";
import SelectableListRow from "../components/ui/SelectableListRow";
import SegmentedControl from "../components/ui/SegmentedControl";
import { MetaText, StatusText } from "../components/ui/StatusText";
import IdentityBadgeRow from "../components/users/IdentityBadgeRow";
import UserDetailsDrawer, { type UserDetailsResponse } from "../components/users/UserDetailsDrawer";
import UserActionPanel, {
  type ActionCatalogItem,
  type BulkAction,
  type TrustPolicy,
  type TrustPolicyCatalogItem,
  type UserRole,
} from "../components/users/UserActionPanel";
import UserBadgeGroups from "../components/users/UserBadgeGroups";
import UserListSessionMeta from "../components/users/UserListSessionMeta";
import { UserStatusPills, UserTrustPills } from "../components/users/UserStatusPills";
import { useAuth } from "../hooks/auth";
import { useUsersList } from "../hooks/useUsersList";
import { useWorkspaceInfiniteScroll } from "../hooks/useWorkspaceInfiniteScroll";
import { useScheduledResetAndLoad } from "../hooks/useScheduledResetAndLoad";
import type { AvailableActionsResponse } from "../types/catalog";
import { getUserAndTrustCatalogsCached } from "../utils/catalogCache";
import { normalizeError } from "../utils/errors";
import { resolveDisplayRole } from "../utils/roles";
import { loadUserContextByEmail, loadUserContextById } from "../utils/userContext";

type UsersTab = "all" | "pending" | "approved" | "deleted";

type UserRow = {
  id: number;
  email: string;
  role: string;
  is_root_admin: boolean;
  pending_requested_at?: string | null;
  is_approved: boolean;
  is_admin: boolean;
  is_blocked: boolean;
  is_deleted: boolean;
  trust_policy: TrustPolicy;
  trusted_days_left: number | null;
  trusted_devices_count?: number;
  last_activity_at?: string | null;
  last_ip?: string | null;
  last_user_agent?: string | null;
  pending_unread?: boolean;
  pending_event_id?: number | null;
};

type ActionPayload = {
  action: BulkAction;
  role?: UserRole;
  trust_policy?: TrustPolicy;
  reason?: string;
};

const TXT = {
  title: "\u041f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u0442\u0435\u043b\u0438",
  tabAll: "\u0412\u0441\u0435",
  tabPending: "\u041e\u0436\u0438\u0434\u0430\u044e\u0442 \u043f\u043e\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043d\u0438\u044f",
  tabApproved: "\u041f\u043e\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043d\u043d\u044b\u0435",
  tabDeleted: "\u0423\u0434\u0430\u043b\u0435\u043d\u043d\u044b\u0435",
  chooseUsersFirst: "\u0421\u043d\u0430\u0447\u0430\u043b\u0430 \u0432\u044b\u0431\u0435\u0440\u0438\u0442\u0435 \u043f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u0442\u0435\u043b\u0435\u0439 \u0432 \u0441\u043f\u0438\u0441\u043a\u0435.",
  noApplicable: "\u0414\u043b\u044f \u0432\u044b\u0431\u0440\u0430\u043d\u043d\u043e\u0433\u043e \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u044f \u043d\u0435\u0442 \u043f\u043e\u0434\u0445\u043e\u0434\u044f\u0449\u0438\u0445 \u043f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u0442\u0435\u043b\u0435\u0439.",
  actionDone: "\u0414\u0435\u0439\u0441\u0442\u0432\u0438\u0435 \u043f\u0440\u0438\u043c\u0435\u043d\u0435\u043d\u043e.",
  userActionDone: "\u0414\u0435\u0439\u0441\u0442\u0432\u0438\u0435 \u043f\u043e \u043f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u0442\u0435\u043b\u044e \u0432\u044b\u043f\u043e\u043b\u043d\u0435\u043d\u043e.",
  userNotFoundInDb: "\u041f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u0442\u0435\u043b\u044c \u043d\u0435 \u043d\u0430\u0439\u0434\u0435\u043d \u0432 \u0411\u0414.",
  resetContext: "\u0421\u0431\u0440\u043e\u0441\u0438\u0442\u044c \u043a\u043e\u043d\u0442\u0435\u043a\u0441\u0442",
  searchPlaceholder: "\u041f\u043e\u0438\u0441\u043a \u043f\u043e email",
  loading: "\u0417\u0430\u0433\u0440\u0443\u0437\u043a\u0430...",
  find: "\u041d\u0430\u0439\u0442\u0438",
  selectAllTitle: "\u0412\u044b\u0431\u0440\u0430\u0442\u044c \u0432\u0441\u0435 \u0432 \u0442\u0435\u043a\u0443\u0449\u0435\u043c \u0441\u043f\u0438\u0441\u043a\u0435",
  usersList: "\u0421\u043f\u0438\u0441\u043e\u043a \u043f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u0442\u0435\u043b\u0435\u0439",
  selected: "\u0412\u044b\u0431\u0440\u0430\u043d\u043e",
  selectUserTitle: "\u0412\u044b\u0431\u0440\u0430\u0442\u044c \u043f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u0442\u0435\u043b\u044f",
  open: "\u041e\u0442\u043a\u0440\u044b\u0442\u044c",
  hasUnreadRequest: "\u0415\u0441\u0442\u044c \u043d\u0435\u043f\u0440\u043e\u0447\u0438\u0442\u0430\u043d\u043d\u0430\u044f \u0437\u0430\u044f\u0432\u043a\u0430",
  usersNotFound: "\u041f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u0442\u0435\u043b\u0438 \u043d\u0435 \u043d\u0430\u0439\u0434\u0435\u043d\u044b.",
  usersTotal: "\u0412\u0441\u0435\u0433\u043e \u043f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u0442\u0435\u043b\u0435\u0439",
  shown: "\u041f\u043e\u043a\u0430\u0437\u0430\u043d\u043e",
  actionsForSelected: "\u0414\u0435\u0439\u0441\u0442\u0432\u0438\u044f \u0434\u043b\u044f \u0432\u044b\u0431\u0440\u0430\u043d\u043d\u044b\u0445 \u043f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u0442\u0435\u043b\u0435\u0439",
  reasonOptional: "\u041f\u0440\u0438\u0447\u0438\u043d\u0430 \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u044f (\u043d\u0435\u043e\u0431\u044f\u0437\u0430\u0442\u0435\u043b\u044c\u043d\u043e, \u043d\u043e \u0440\u0435\u043a\u043e\u043c\u0435\u043d\u0434\u0443\u0435\u0442\u0441\u044f)",
  loadingActions: "\u041e\u0431\u043d\u043e\u0432\u043b\u044f\u044e \u0434\u043e\u0441\u0442\u0443\u043f\u043d\u044b\u0435 \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u044f...",
} as const;

const TAB_OPTIONS: Array<{ value: UsersTab; label: string }> = [
  { value: "all", label: TXT.tabAll },
  { value: "pending", label: TXT.tabPending },
  { value: "approved", label: TXT.tabApproved },
  { value: "deleted", label: TXT.tabDeleted },
];

export default function UsersPage() {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const [tab, setTab] = useState<UsersTab>("all");
  const [query, setQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<number[]>([]);

  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const [actionCatalog, setActionCatalog] = useState<Record<BulkAction, ActionCatalogItem>>({} as Record<BulkAction, ActionCatalogItem>);
  const [trustPolicyCatalog, setTrustPolicyCatalog] = useState<Record<TrustPolicy, TrustPolicyCatalogItem>>({} as Record<TrustPolicy, TrustPolicyCatalogItem>);

  const [availableActions, setAvailableActions] = useState<BulkAction[]>([]);
  const [availableLoading, setAvailableLoading] = useState(false);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [drawerError, setDrawerError] = useState("");
  const [drawerData, setDrawerData] = useState<UserDetailsResponse | null>(null);
  const [drawerAvailableActions, setDrawerAvailableActions] = useState<BulkAction[]>([]);
  const [drawerUserId, setDrawerUserId] = useState<number | null>(null);

  const availableAbortRef = useRef<AbortController | null>(null);
  const drawerAbortRef = useRef<AbortController | null>(null);
  const drawerRequestSeqRef = useRef(0);
  const keepSelectionOnResetRef = useRef(false);
  const tabRef = useRef<UsersTab>(tab);
  const queryRef = useRef(query);

  const actorEmail = (user?.email || "").toLowerCase();
  const [applicableUserIdsByAction, setApplicableUserIdsByAction] = useState<Partial<Record<BulkAction, number[]>>>({});

  const {
    rows: users,
    total,
    isLoading: isUsersLoading,
    hasMore,
    resetAndLoad,
    requestNextPage,
  } = useUsersList<UserRow>({
    statusRef: tabRef,
    queryRef,
    keepSelectionOnResetRef,
    setSelectedIds,
    onReset: () => setError(""),
    onError: (e) => setError(normalizeError(e)),
  });
  const { scheduleResetAndLoad } = useScheduledResetAndLoad(resetAndLoad);

  const selectedUsers = useMemo(() => {
    if (selectedIds.length === 0) return [];
    const selectedSet = new Set(selectedIds);
    return users.filter((row) => selectedSet.has(row.id));
  }, [users, selectedIds]);

  const allVisibleIds = useMemo(() => users.map((row) => row.id), [users]);
  const allVisibleSelected = useMemo(
    () => allVisibleIds.length > 0 && allVisibleIds.every((id) => selectedIds.includes(id)),
    [allVisibleIds, selectedIds],
  );

  const applicableCountByAction = useMemo(() => {
    const out: Partial<Record<BulkAction, number>> = {};
    for (const action of availableActions) {
      out[action] = (applicableUserIdsByAction[action] || []).length;
    }
    return out;
  }, [availableActions, applicableUserIdsByAction]);

  function resetUsersList(options?: { nextTab?: UsersTab; nextQuery?: string; keepSelection?: boolean }) {
    const nextTab = options?.nextTab ?? tabRef.current;
    const nextQuery = options?.nextQuery ?? queryRef.current;

    if (nextTab !== tab) setTab(nextTab);
    if (nextQuery !== query) setQuery(nextQuery);
    tabRef.current = nextTab;
    queryRef.current = nextQuery;
    keepSelectionOnResetRef.current = Boolean(options?.keepSelection);
    scheduleResetAndLoad();
  }

  async function refreshDrawerContext(userId: number) {
    const seq = ++drawerRequestSeqRef.current;
    drawerAbortRef.current?.abort();
    const controller = new AbortController();
    drawerAbortRef.current = controller;

    setDrawerLoading(true);
    setDrawerError("");

    try {
      const loaded = await loadUserContextById(userId, { signal: controller.signal });
      if (seq !== drawerRequestSeqRef.current) return;
      setDrawerData(loaded.details);
      setDrawerAvailableActions(loaded.availableActions);
      setDrawerUserId(userId);
    } catch (e) {
      if (isAbortError(e)) return;
      if (seq !== drawerRequestSeqRef.current) return;
      setDrawerError(normalizeError(e));
      setDrawerData(null);
      setDrawerAvailableActions([]);
      setDrawerUserId(userId);
    } finally {
      if (drawerAbortRef.current === controller) {
        drawerAbortRef.current = null;
      }
      if (seq === drawerRequestSeqRef.current) {
        setDrawerLoading(false);
      }
    }
  }

  async function openDrawerById(userId: number) {
    setDrawerOpen(true);
    await refreshDrawerContext(userId);
  }

  async function runBulkAction(payload: ActionPayload) {
    if (selectedUsers.length === 0) {
      throw new Error(TXT.chooseUsersFirst);
    }

    const applicableIds = applicableUserIdsByAction[payload.action] || [];

    if (applicableIds.length === 0) {
      throw new Error(TXT.noApplicable);
    }

    await apiPost("/admin/users/bulk", {
      user_ids: applicableIds,
      action: payload.action,
      role: payload.role,
      trust_policy: payload.trust_policy,
      reason: payload.reason,
    });

    setMessage(TXT.actionDone);
    resetUsersList({ keepSelection: true });

    if (drawerUserId && applicableIds.includes(drawerUserId)) {
      await refreshDrawerContext(drawerUserId);
    }
  }

  async function runDrawerAction(payload: ActionPayload) {
    if (!drawerUserId) return;
    await apiPost("/admin/users/bulk", {
      user_ids: [drawerUserId],
      action: payload.action,
      role: payload.role,
      trust_policy: payload.trust_policy,
      reason: payload.reason,
    });
    setMessage(TXT.userActionDone);
    await refreshDrawerContext(drawerUserId);
    resetUsersList({ keepSelection: true });
  }

  async function revokeTrustedDevice(deviceId: number) {
    if (!drawerUserId) return;
    await apiPost(`/admin/users/${drawerUserId}/trusted-devices/${deviceId}/revoke`, {});
    await refreshDrawerContext(drawerUserId);
    resetUsersList({ keepSelection: true });
  }

  async function revokeTrustedDevicesExceptLatest(keepDeviceId: number) {
    if (!drawerUserId) return;
    await apiPost(`/admin/users/${drawerUserId}/trusted-devices/revoke-except`, { keep_device_id: keepDeviceId });
    await refreshDrawerContext(drawerUserId);
    resetUsersList({ keepSelection: true });
  }

  function toggleOne(id: number) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function toggleAllVisible() {
    setSelectedIds((prev) => {
      if (allVisibleSelected) {
        const hideSet = new Set(allVisibleIds);
        return prev.filter((id) => !hideSet.has(id));
      }
      const next = new Set(prev);
      allVisibleIds.forEach((id) => next.add(id));
      return Array.from(next);
    });
  }

  useWorkspaceInfiniteScroll({
    canLoadMore: hasMore,
    isLoading: isUsersLoading,
    onLoadMore: requestNextPage,
    contentKey: `${users.length}:${tab}:${query}`,
  });

  useEffect(() => {
    let active = true;
    getUserAndTrustCatalogsCached()
      .then(({ actionCatalog: actionMap, trustPolicyCatalog: trustMap }) => {
        if (!active) return;
        setActionCatalog(actionMap);
        setTrustPolicyCatalog(trustMap);
      })
      .catch(() => {
        if (!active) return;
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    resetUsersList({ nextTab: tab, nextQuery: query });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  useEffect(() => {
    if (selectedIds.length === 0) {
      setAvailableActions([]);
      setApplicableUserIdsByAction({});
      setAvailableLoading(false);
      availableAbortRef.current?.abort();
      availableAbortRef.current = null;
      return;
    }

    setAvailableLoading(true);
    setError("");

    const controller = new AbortController();
    availableAbortRef.current?.abort();
    availableAbortRef.current = controller;

    const timer = window.setTimeout(async () => {
      try {
        const data = await apiPost<AvailableActionsResponse>(
          "/admin/users/actions/available",
          { user_ids: selectedIds },
          { signal: controller.signal },
        );
        setAvailableActions(data.actions || []);
        setApplicableUserIdsByAction((data.applicable_by_action || {}) as Partial<Record<BulkAction, number[]>>);
      } catch (e) {
        if (isAbortError(e)) return;
        setError(normalizeError(e));
      } finally {
        if (availableAbortRef.current === controller) {
          availableAbortRef.current = null;
        }
        setAvailableLoading(false);
      }
    }, 180);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
      if (availableAbortRef.current === controller) {
        availableAbortRef.current = null;
      }
      setAvailableLoading(false);
    };
  }, [selectedIds]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const highlightUserId = Number(params.get("highlight_user_id") || "");
    const highlightEmail = params.get("highlight_email") || "";

    if (Number.isFinite(highlightUserId) && highlightUserId > 0) {
      void openDrawerById(highlightUserId);
      return;
    }

    if (highlightEmail.trim()) {
      void (async () => {
        setDrawerOpen(true);
        setDrawerLoading(true);
        setDrawerError("");
        try {
          const loaded = await loadUserContextByEmail(highlightEmail);
          if (!loaded) {
            setDrawerData(null);
            setDrawerAvailableActions([]);
            setDrawerUserId(null);
            setDrawerError(TXT.userNotFoundInDb);
            return;
          }
          setDrawerData(loaded.details);
          setDrawerAvailableActions(loaded.availableActions);
          setDrawerUserId(loaded.details.user.id);
        } catch (e) {
          setDrawerError(normalizeError(e));
        } finally {
          setDrawerLoading(false);
        }
      })();
    }
  }, [location.search]);

  useEffect(() => {
    return () => {
      availableAbortRef.current?.abort();
      availableAbortRef.current = null;
      drawerAbortRef.current?.abort();
      drawerAbortRef.current = null;
    };
  }, []);

  const hasDeepLinkContext = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return Boolean(params.get("highlight_user_id") || params.get("highlight_email"));
  }, [location.search]);

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <h2 style={{ marginTop: 0, marginBottom: 0 }}>{TXT.title}</h2>

      {error && <StatusText tone="danger">{error}</StatusText>}
      {message && <StatusText tone="success">{message}</StatusText>}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <SegmentedControl value={tab} options={TAB_OPTIONS} onChange={setTab} />
        {hasDeepLinkContext && (
          <Button size="sm" variant="ghost" onClick={() => navigate({ pathname: "/users", search: "" }, { replace: true })}>
            {TXT.resetContext}
          </Button>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8 }}>
        <ClearableInput
          value={query}
          onChange={setQuery}
          placeholder={TXT.searchPlaceholder}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              resetUsersList({ nextTab: tab, nextQuery: query });
            }
          }}
        />
        <Button
          variant="primary"
          size="sm"
          onClick={() => {
            resetUsersList({ nextTab: tab, nextQuery: query });
          }}
          disabled={isUsersLoading}
        >
          {isUsersLoading ? TXT.loading : TXT.find}
        </Button>
      </div>

      <Card>
        <div style={{ display: "grid", gap: 10 }}>
          <div style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", alignItems: "center", gap: 10, opacity: 0.82 }}>
            <input type="checkbox" checked={allVisibleSelected} onChange={toggleAllVisible} title={TXT.selectAllTitle} />
            <div>{TXT.usersList}</div>
            <div>
              {TXT.selected}: {selectedIds.length}
            </div>
          </div>
          <ListTotalMeta label={TXT.usersTotal} total={total} />

          {users.map((row) => (
            <UsersListRow
              key={row.id}
              row={row}
              actorEmail={actorEmail}
              checked={selectedIds.includes(row.id)}
              highlighted={drawerOpen && drawerData?.user.id === row.id}
              trustPolicyCatalog={trustPolicyCatalog}
              hasUnreadRequestLabel={TXT.hasUnreadRequest}
              checkboxTitle={TXT.selectUserTitle}
              openLabel={TXT.open}
              onToggle={toggleOne}
              onOpen={openDrawerById}
            />
          ))}

          {!isUsersLoading && users.length === 0 && <StatusText tone="muted">{TXT.usersNotFound}</StatusText>}

          {hasMore && (
            <MetaText opacity={0.72}>
              {TXT.shown}: {users.length} {"\u0438\u0437"} {total ?? "—"}
            </MetaText>
          )}
        </div>
      </Card>

      {selectedIds.length > 0 && (
        <UserActionPanel
          title={TXT.actionsForSelected}
          availableActions={availableActions}
          actionCatalog={actionCatalog}
          trustPolicyCatalog={trustPolicyCatalog}
          selectedCount={selectedIds.length}
          applicableCountByAction={applicableCountByAction}
          onRunAction={runBulkAction}
          reasonOptionalPlaceholder={TXT.reasonOptional}
        />
      )}

      {selectedIds.length > 0 && availableLoading && (
        <MetaText opacity={0.7}>{TXT.loadingActions}</MetaText>
      )}

      <RolePermissionsHint />

      <UserDetailsDrawer
        open={drawerOpen}
        loading={drawerLoading}
        error={drawerError}
        data={drawerData}
        currentUserEmail={user?.email || null}
        availableActions={drawerAvailableActions}
        actionCatalog={actionCatalog}
        trustPolicyCatalog={trustPolicyCatalog}
        browserJwtLeftSeconds={null}
        onRunAction={runDrawerAction}
        onRevokeTrustedDevice={revokeTrustedDevice}
        onRevokeTrustedDevicesExceptLatest={revokeTrustedDevicesExceptLatest}
        onClose={() => {
          setDrawerOpen(false);
          setDrawerLoading(false);
          setDrawerError("");
          setDrawerData(null);
          setDrawerAvailableActions([]);
          setDrawerUserId(null);
          drawerAbortRef.current?.abort();
          drawerAbortRef.current = null;
        }}
      />
    </div>
  );
}

const UsersListRow = memo(
  function UsersListRow({
    row,
    actorEmail,
    checked,
    highlighted,
    trustPolicyCatalog,
    hasUnreadRequestLabel,
    checkboxTitle,
    openLabel,
    onToggle,
    onOpen,
  }: {
    row: UserRow;
    actorEmail: string;
    checked: boolean;
    highlighted: boolean;
    trustPolicyCatalog: Record<TrustPolicy, TrustPolicyCatalogItem>;
    hasUnreadRequestLabel: string;
    checkboxTitle: string;
    openLabel: string;
    onToggle: (id: number) => void;
    onOpen: (id: number) => Promise<void>;
  }) {
    const isSelf = !!actorEmail && row.email.toLowerCase() === actorEmail;
    const identityBadges =
      row.is_approved || row.is_root_admin ? (
        <IdentityBadgeRow role={resolveDisplayRole(row)} showSelf={isSelf} />
      ) : isSelf ? (
        <RelevanceBadge relevance="self" />
      ) : null;

    return (
      <SelectableListRow
        checked={checked}
        onToggle={() => onToggle(row.id)}
        title={row.email}
        badges={
          <UserBadgeGroups
            identity={identityBadges}
            status={
              <UserStatusPills
                user={row.is_approved ? row : { ...row, role: null }}
                showBlockedWhenFalse={false}
                hideRole
                preferPendingBadge
              />
            }
            trust={
              row.is_approved && !row.is_deleted ? (
                <UserTrustPills
                  trustPolicy={row.trust_policy}
                  trustPolicyCatalog={trustPolicyCatalog}
                />
              ) : null
            }
          />
        }
        details={
          <div style={{ display: "grid", gap: 4 }}>
            {!row.is_approved && row.pending_unread ? <MetaText opacity={0.75}>{hasUnreadRequestLabel}</MetaText> : null}
            {row.is_approved ? (
              <UserListSessionMeta
                lastIp={row.last_ip}
                lastUserAgent={row.last_user_agent}
                lastActivityAt={row.last_activity_at}
                trustedDevicesCount={row.trusted_devices_count ?? null}
              />
            ) : null}
          </div>
        }
        onOpen={() => {
          void onOpen(row.id);
        }}
        highlighted={highlighted}
        checkboxTitle={checkboxTitle}
        openLabel={openLabel}
      />
    );
  },
  (prev, next) =>
    prev.row === next.row &&
    prev.actorEmail === next.actorEmail &&
    prev.checked === next.checked &&
    prev.highlighted === next.highlighted &&
    prev.trustPolicyCatalog === next.trustPolicyCatalog &&
    prev.hasUnreadRequestLabel === next.hasUnreadRequestLabel &&
    prev.checkboxTitle === next.checkboxTitle &&
    prev.openLabel === next.openLabel,
);

