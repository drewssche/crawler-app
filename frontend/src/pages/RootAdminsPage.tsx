import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiGet, apiPost, isAbortError } from "../api/client";
import AccentPill from "../components/ui/AccentPill";
import Button from "../components/ui/Button";
import ReasonPresetButton from "../components/ui/ReasonPresetButton";
import Card from "../components/ui/Card";
import ConfirmDialog from "../components/ui/ConfirmDialog";
import ClearableInput from "../components/ui/ClearableInput";
import ListTotalMeta from "../components/ui/ListTotalMeta";
import ModalActionRow from "../components/ui/ModalActionRow";
import ModalShell from "../components/ui/ModalShell";
import ApplicabilityHint from "../components/ui/ApplicabilityHint";
import InlineInfoRow from "../components/ui/InlineInfoRow";
import SelectableListRow from "../components/ui/SelectableListRow";
import SectionHeaderRow from "../components/ui/SectionHeaderRow";
import SlidePanel from "../components/ui/SlidePanel";
import { MetaText, StatusText } from "../components/ui/StatusText";
import type { TrustPolicyCatalogItem } from "../components/users/UserActionPanel";
import CompactActionCard from "../components/users/CompactActionCard";
import IdentityBadgeRow from "../components/users/IdentityBadgeRow";
import UserListSessionMeta from "../components/users/UserListSessionMeta";
import UserBadgeGroups from "../components/users/UserBadgeGroups";
import TrustPolicyDetailsCard from "../components/users/TrustPolicyDetailsCard";
import { UserStatusPills } from "../components/users/UserStatusPills";
import { useAuth } from "../hooks/auth";
import { useIncrementalPager } from "../hooks/useIncrementalPager";
import { useScheduledResetAndLoad } from "../hooks/useScheduledResetAndLoad";
import { getTrustPolicyCatalogCached } from "../utils/catalogCache";
import { normalizeError } from "../utils/errors";
import {
  DEFAULT_ADMIN_EMAILS_REASON_CONTRACT,
  getReasonPlaceholder,
  getReasonRequiredError,
  mergeAdminEmailsReasonContract,
  resolveAdminEmailsReasonMode,
  type AdminEmailsReasonContract,
} from "../utils/reasonPolicy";
import { useWorkspaceInfiniteScroll } from "../hooks/useWorkspaceInfiniteScroll";
import type { PagedResponse } from "../types/common";

type AdminSettingsResponse = {
  admin_emails: string[];
  db_admins: string[];
  db_profiles?: Record<string, UserLookupRow>;
  is_root_admin: boolean;
  reason_policy?: Partial<AdminEmailsReasonContract>;
};

type AdminPageRow = {
  email: string;
  in_db: boolean;
  profile?: UserLookupRow | null;
};

type AdminPageResponse = PagedResponse<AdminPageRow> & {
  total_all?: number;
  reason_policy?: Partial<AdminEmailsReasonContract>;
};

type SaveAdminEmailsResponse = {
  ok: boolean;
  admin_emails: string[];
  sync: {
    created: number;
    promoted: number;
    demoted: number;
    skipped_create_without_password: number;
  };
  note: string;
};

type UserLookupRow = {
  id: number;
  email: string;
  role: string;
  is_approved: boolean;
  is_blocked?: boolean;
  is_deleted?: boolean;
  trust_policy?: string;
  trusted_days_left?: number | null;
  trusted_devices_count?: number | null;
  last_activity_at?: string | null;
  last_ip?: string | null;
  last_user_agent?: string | null;
};

type TrustPolicy = "strict" | "standard" | "extended" | "permanent";

const TXT = {
  title: "\u0421\u0438\u0441\u0442\u0435\u043c\u043d\u044b\u0435 \u0430\u0434\u043c\u0438\u043d\u0438\u0441\u0442\u0440\u0430\u0442\u043e\u0440\u044b",
  search: "\u041f\u043e\u0438\u0441\u043a \u043f\u043e email",
  add: "\u0414\u043e\u0431\u0430\u0432\u0438\u0442\u044c",
  list: "\u0421\u043f\u0438\u0441\u043e\u043a \u0441\u0438\u0441\u0442\u0435\u043c\u043d\u044b\u0445 \u0430\u0434\u043c\u0438\u043d\u0438\u0441\u0442\u0440\u0430\u0442\u043e\u0440\u043e\u0432",
  selected: "\u0412\u044b\u0431\u0440\u0430\u043d\u043e",
  open: "\u041e\u0442\u043a\u0440\u044b\u0442\u044c",
  noRows: "\u0412 \u0441\u043f\u0438\u0441\u043a\u0435 \u043f\u043e\u043a\u0430 \u043d\u0435\u0442 \u0437\u0430\u043f\u0438\u0441\u0435\u0439.",
  actions: "\u0414\u0435\u0439\u0441\u0442\u0432\u0438\u044f \u0434\u043b\u044f \u0432\u044b\u0431\u0440\u0430\u043d\u043d\u044b\u0445",
  removeSelected: "\u0423\u0434\u0430\u043b\u0438\u0442\u044c \u0432\u044b\u0431\u0440\u0430\u043d\u043d\u044b\u0445",
  addModalTitle: "\u0414\u043e\u0431\u0430\u0432\u0438\u0442\u044c \u0441\u0438\u0441\u0442\u0435\u043c\u043d\u043e\u0433\u043e \u0430\u0434\u043c\u0438\u043d\u0438\u0441\u0442\u0440\u0430\u0442\u043e\u0440\u0430",
  cancel: "\u041e\u0442\u043c\u0435\u043d\u0430",
  drawerTitle: "\u0421\u0438\u0441\u0442\u0435\u043c\u043d\u044b\u0439 \u0430\u0434\u043c\u0438\u043d\u0438\u0441\u0442\u0440\u0430\u0442\u043e\u0440",
  close: "\u0417\u0430\u043a\u0440\u044b\u0442\u044c",
  loading: "\u0417\u0430\u0433\u0440\u0443\u0437\u043a\u0430...",
  inDb: "\u0435\u0441\u0442\u044c \u0432 \u0411\u0414",
  onlyEnv: "\u0442\u043e\u043b\u044c\u043a\u043e ADMIN_EMAILS",
  usersLink: "\u041e\u0442\u043a\u0440\u044b\u0442\u044c \u0432 \u041f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u0442\u0435\u043b\u044f\u0445",
  trustDetails: "\u041f\u0430\u0440\u0430\u043c\u0435\u0442\u0440\u044b \u0434\u043e\u0432\u0435\u0440\u0438\u044f",
  fastActions: "\u0411\u044b\u0441\u0442\u0440\u044b\u0435 \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u044f",
  removeOne: "\u0423\u0434\u0430\u043b\u0438\u0442\u044c \u0438\u0437 root-admin",
  removing: "\u0423\u0434\u0430\u043b\u0435\u043d\u0438\u0435...",
  cannotSelf: "\u041d\u0435\u043b\u044c\u0437\u044f \u0443\u0434\u0430\u043b\u0438\u0442\u044c \u0441\u0435\u0431\u044f",
  cannotLast: "\u041d\u0435\u043b\u044c\u0437\u044f \u0443\u0434\u0430\u043b\u0438\u0442\u044c \u043f\u043e\u0441\u043b\u0435\u0434\u043d\u0435\u0433\u043e root-admin",
  updated: "\u0421\u043f\u0438\u0441\u043e\u043a \u0441\u0438\u0441\u0442\u0435\u043c\u043d\u044b\u0445 \u0430\u0434\u043c\u0438\u043d\u0438\u0441\u0442\u0440\u0430\u0442\u043e\u0440\u043e\u0432 \u043e\u0431\u043d\u043e\u0432\u043b\u0435\u043d.",
  badEmail: "\u0412\u0432\u0435\u0434\u0438\u0442\u0435 \u043a\u043e\u0440\u0440\u0435\u043a\u0442\u043d\u044b\u0439 email.",
  needReason: "\u0423\u043a\u0430\u0436\u0438\u0442\u0435 \u043f\u0440\u0438\u0447\u0438\u043d\u0443 \u0438\u0437\u043c\u0435\u043d\u0435\u043d\u0438\u044f \u0441\u043f\u0438\u0441\u043a\u0430.",
  exists: "\u042d\u0442\u043e\u0442 email \u0443\u0436\u0435 \u0432 \u0441\u043f\u0438\u0441\u043a\u0435.",
  chooseRows: "\u0412\u044b\u0431\u0435\u0440\u0438\u0442\u0435 \u0430\u0434\u043c\u0438\u043d\u0438\u0441\u0442\u0440\u0430\u0442\u043e\u0440\u043e\u0432 \u0434\u043b\u044f \u0443\u0434\u0430\u043b\u0435\u043d\u0438\u044f.",
  cannotForSelected: "\u0414\u043b\u044f \u0432\u044b\u0431\u0440\u0430\u043d\u043d\u044b\u0445 \u0437\u0430\u043f\u0438\u0441\u0435\u0439 \u0443\u0434\u0430\u043b\u0435\u043d\u0438\u0435 \u043d\u0435\u0434\u043e\u0441\u0442\u0443\u043f\u043d\u043e.",
  atLeastOne: "\u0414\u043e\u043b\u0436\u0435\u043d \u043e\u0441\u0442\u0430\u0442\u044c\u0441\u044f \u0445\u043e\u0442\u044f \u0431\u044b \u043e\u0434\u0438\u043d \u0441\u0438\u0441\u0442\u0435\u043c\u043d\u044b\u0439 \u0430\u0434\u043c\u0438\u043d\u0438\u0441\u0442\u0440\u0430\u0442\u043e\u0440.",
  skippedSelf: "\u0427\u0430\u0441\u0442\u044c \u0437\u0430\u043f\u0438\u0441\u0435\u0439 \u043f\u0440\u043e\u043f\u0443\u0449\u0435\u043d\u0430: \u043d\u0435\u043b\u044c\u0437\u044f \u0443\u0434\u0430\u043b\u0438\u0442\u044c \u0441\u0435\u0431\u044f.",
  notFoundInDb: "\u041f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u0442\u0435\u043b\u044c \u0441 \u044d\u0442\u0438\u043c email \u043d\u0435 \u043d\u0430\u0439\u0434\u0435\u043d \u0432 \u0411\u0414 (\u0435\u0441\u0442\u044c \u0442\u043e\u043b\u044c\u043a\u043e \u0432 ADMIN_EMAILS).",
  confirmRemove: "\u0423\u0434\u0430\u043b\u0438\u0442\u044c",
  selectAllTitle: "\u0412\u044b\u0431\u0440\u0430\u0442\u044c \u0432\u0441\u0435\u0445 \u0432 \u0442\u0435\u043a\u0443\u0449\u0435\u043c \u0441\u043f\u0438\u0441\u043a\u0435",
  usersTotal: "\u0412\u0441\u0435\u0433\u043e \u043f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u0442\u0435\u043b\u0435\u0439",
};

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const BASE_ROWS = 20;

function isTrustPolicy(value: string | null | undefined): value is TrustPolicy {
  return value === "strict" || value === "standard" || value === "extended" || value === "permanent";
}

export default function RootAdminsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [rows, setRows] = useState<AdminPageRow[]>([]);
  const [adminCount, setAdminCount] = useState(0);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [addReason, setAddReason] = useState("");
  const [bulkReason, setBulkReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string[]>([]);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerEmail, setDrawerEmail] = useState<string>("");
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [drawerUser, setDrawerUser] = useState<UserLookupRow | null>(null);
  const [trustPolicyCatalog, setTrustPolicyCatalog] = useState<Record<TrustPolicy, TrustPolicyCatalogItem>>({} as Record<TrustPolicy, TrustPolicyCatalogItem>);
  const [drawerReason, setDrawerReason] = useState("");
  const [drawerActionLoading, setDrawerActionLoading] = useState(false);
  const [adminReasonContract, setAdminReasonContract] = useState<AdminEmailsReasonContract>(DEFAULT_ADMIN_EMAILS_REASON_CONTRACT);
  const [confirmState, setConfirmState] = useState<{ open: boolean; scope: "bulk" | "drawer"; email?: string }>({
    open: false,
    scope: "bulk",
  });
  const keepSelectionOnResetRef = useRef(false);
  const searchRef = useRef(search);
  const drawerLookupAbortRef = useRef<AbortController | null>(null);
  const drawerLookupSeqRef = useRef(0);

  const selfEmail = (user?.email || "").toLowerCase();

  const { total, isLoading: isListLoading, hasMore, resetAndLoad, requestNextPage } = useIncrementalPager<AdminPageRow>({
    fetchPage: (nextPage, signal) =>
      apiGet<AdminPageResponse>(
        `/admin/settings/admin-emails?page=${nextPage}&page_size=${BASE_ROWS}&q=${encodeURIComponent(searchRef.current.trim())}`,
        { signal },
      ),
    applyPage: (data, append) => {
      const ext = data as AdminPageResponse;
      setAdminCount(ext.total_all ?? data.total ?? 0);
      if (ext.reason_policy) setAdminReasonContract(mergeAdminEmailsReasonContract(ext.reason_policy));
      const items = data.items || [];
      if (append) {
        setRows((prev) => {
          const next = [...prev, ...items];
          const uniq = new Map<string, AdminPageRow>();
          for (const row of next) uniq.set(row.email.toLowerCase(), row);
          return Array.from(uniq.values());
        });
        return;
      }
      setRows(items);
      if (keepSelectionOnResetRef.current) {
        const nextSet = new Set(items.map((x) => x.email.toLowerCase()));
        setSelected((prev) => prev.filter((x) => nextSet.has(x.toLowerCase())));
      } else {
        setSelected([]);
      }
      keepSelectionOnResetRef.current = false;
    },
    onReset: () => {
      setRows([]);
      setError("");
    },
    onError: (e) => {
      setError(normalizeError(e));
    },
  });
  const { scheduleResetAndLoad } = useScheduledResetAndLoad(resetAndLoad);

  function resetRootAdminsList(options?: { nextQuery?: string; keepSelection?: boolean }) {
    const nextQuery = options?.nextQuery ?? searchRef.current;
    if (nextQuery !== search) setSearch(nextQuery);
    searchRef.current = nextQuery;
    keepSelectionOnResetRef.current = Boolean(options?.keepSelection);
    scheduleResetAndLoad();
  }

  useEffect(() => {
    let active = true;
    getTrustPolicyCatalogCached()
      .then((map) => {
        if (!active) return;
        setTrustPolicyCatalog(map);
      })
      .catch(() => {
        if (!active) return;
        setTrustPolicyCatalog({} as Record<TrustPolicy, TrustPolicyCatalogItem>);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    resetRootAdminsList({ nextQuery: search });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  async function saveList(nextEmails: string[], reasonText: string) {
    setError("");
    setMessage("");
    setLoading(true);
    try {
      const res = await apiPost<SaveAdminEmailsResponse>("/admin/settings/admin-emails", {
        emails: nextEmails,
        reason: reasonText,
      });
      setAdminCount((res.admin_emails || []).length);
      setMessage(TXT.updated);
      setSelected([]);
    } catch (e) {
      setError(normalizeError(e));
    } finally {
      setLoading(false);
    }
  }

  async function fetchAllAdminEmails() {
    const data = await apiGet<AdminSettingsResponse>("/admin/settings/admin-emails");
    if (data.reason_policy) setAdminReasonContract(mergeAdminEmailsReasonContract(data.reason_policy));
    return data.admin_emails || [];
  }

  async function addEmail() {
    const normalized = newEmail.trim().toLowerCase();
    const reasonText = addReason.trim();
    if (!EMAIL_RE.test(normalized)) {
      setError(TXT.badEmail);
      return;
    }
    const full = await fetchAllAdminEmails();
    const nextEmails = [...full, normalized];
    const mode = resolveAdminEmailsReasonMode({
      currentEmails: full,
      nextEmails,
      actorEmail: selfEmail,
      policy: adminReasonContract.modes,
    });
    if (mode === "required" && !reasonText) {
      setError(getReasonRequiredError(mode) || TXT.needReason);
      return;
    }
    if (full.includes(normalized)) {
      setError(TXT.exists);
      return;
    }
    await saveList(nextEmails, reasonText);
    setModalOpen(false);
    setNewEmail("");
    setAddReason("");
    resetRootAdminsList();
  }

  useWorkspaceInfiniteScroll({
    canLoadMore: hasMore,
    isLoading: isListLoading,
    onLoadMore: requestNextPage,
    contentKey: `${rows.length}:${search}`,
  });

  const allSelected = rows.length > 0 && rows.every((x) => selected.includes(x.email));

  const removableSelected = useMemo(() => {
    if (selected.length === 0) return [] as string[];
    return selected.filter((x) => x !== selfEmail);
  }, [selected, selfEmail]);

  const canBulkRemove = useMemo(() => {
    if (removableSelected.length === 0) return false;
    return adminCount - removableSelected.length >= 1;
  }, [adminCount, removableSelected.length]);

  function toggleOne(email: string) {
    setSelected((prev) => (prev.includes(email) ? prev.filter((x) => x !== email) : [...prev, email]));
  }

  function toggleAll() {
    setSelected(allSelected ? [] : rows.map((x) => x.email));
  }

  async function removeSelected() {
    const reasonText = bulkReason.trim();
    if (selected.length === 0) {
      setError(TXT.chooseRows);
      return;
    }
    if (!canBulkRemove) {
      setError(TXT.cannotForSelected);
      return;
    }
    const full = await fetchAllAdminEmails();
    const nextEmails = full.filter((x) => !removableSelected.includes(x));
    const mode = resolveAdminEmailsReasonMode({
      currentEmails: full,
      nextEmails,
      actorEmail: selfEmail,
      policy: adminReasonContract.modes,
    });
    if (mode === "required" && !reasonText) {
      setError(getReasonRequiredError(mode) || TXT.needReason);
      return;
    }

    setConfirmState({ open: true, scope: "bulk" });
  }

  async function openDrawer(email: string) {
    const seq = ++drawerLookupSeqRef.current;
    drawerLookupAbortRef.current?.abort();
    const controller = new AbortController();
    drawerLookupAbortRef.current = controller;
    setDrawerOpen(true);
    setDrawerEmail(email);
    setDrawerReason("");
    setDrawerLoading(true);
    setDrawerUser(null);
    try {
      const rows = await apiGet<UserLookupRow[]>(`/admin/users?status=all&q=${encodeURIComponent(email)}`, { signal: controller.signal });
      if (seq !== drawerLookupSeqRef.current) return;
      const hit = (rows || []).find((x) => x.email.toLowerCase() === email.toLowerCase()) || null;
      setDrawerUser(hit);
    } catch (e) {
      if (isAbortError(e)) return;
      if (seq !== drawerLookupSeqRef.current) return;
      setDrawerUser(null);
    } finally {
      if (drawerLookupAbortRef.current === controller) {
        drawerLookupAbortRef.current = null;
      }
      if (seq === drawerLookupSeqRef.current) {
        setDrawerLoading(false);
      }
    }
  }

  useEffect(() => {
    return () => {
      drawerLookupAbortRef.current?.abort();
      drawerLookupAbortRef.current = null;
    };
  }, []);

  const isDrawerSelf = drawerEmail.toLowerCase() === selfEmail;
  const isLastRootAdmin = adminCount <= 1;
  const canRemoveFromDrawer = !isDrawerSelf && !isLastRootAdmin;
  const addReasonMode = adminReasonContract.modes.add_root_admin;
  const removeReasonMode = adminReasonContract.modes.remove_other_root_admin;
  const addReasonPlaceholder = getReasonPlaceholder(
    addReasonMode,
    "Причина изменения списка (необязательно, но рекомендуется)",
  );
  const removeReasonPlaceholder = getReasonPlaceholder(
    removeReasonMode,
    "Причина изменения списка (необязательно, но рекомендуется)",
  );
  const removeReasonHintText = adminReasonContract.hints[removeReasonMode];
  const addReasonHintText = adminReasonContract.hints[addReasonMode];
  const addReasonPresets = adminReasonContract.presets.add_root_admin || [];
  const removeReasonPresets = adminReasonContract.presets.remove_other_root_admin || [];

  async function removeFromDrawer() {
    if (!canRemoveFromDrawer) return;
    const reasonText = drawerReason.trim();
    const full = await fetchAllAdminEmails();
    const nextEmails = full.filter((x) => x !== drawerEmail);
    const mode = resolveAdminEmailsReasonMode({
      currentEmails: full,
      nextEmails,
      actorEmail: selfEmail,
      policy: adminReasonContract.modes,
    });
    if (mode === "required" && !reasonText) {
      setError(getReasonRequiredError(mode) || TXT.needReason);
      return;
    }
    setConfirmState({ open: true, scope: "drawer", email: drawerEmail });
  }

  async function confirmRemove() {
    if (!confirmState.open) return;
    if (confirmState.scope === "bulk") {
      setDrawerActionLoading(true);
      try {
        const all = await fetchAllAdminEmails();
        const next = all.filter((x) => !removableSelected.includes(x));
        if (next.length < 1) {
          setError(TXT.atLeastOne);
          return;
        }
        await saveList(next, bulkReason.trim());
        setBulkReason("");
        if (selected.some((x) => x === selfEmail)) {
          setMessage(TXT.skippedSelf);
        }
        resetRootAdminsList();
      } finally {
        setDrawerActionLoading(false);
        setConfirmState({ open: false, scope: "bulk" });
      }
      return;
    }

    if (!confirmState.email) {
      setConfirmState({ open: false, scope: "drawer" });
      return;
    }

    setDrawerActionLoading(true);
    try {
      const all = await fetchAllAdminEmails();
      const next = all.filter((x) => x !== confirmState.email);
      if (next.length < 1) {
        setError(TXT.atLeastOne);
        return;
      }
      await saveList(next, drawerReason.trim());
      setDrawerReason("");
      setDrawerOpen(false);
      resetRootAdminsList();
    } finally {
      setDrawerActionLoading(false);
      setConfirmState({ open: false, scope: "drawer" });
    }
  }

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>{TXT.title}</h2>

      {error && <StatusText tone="danger" style={{ marginBottom: 10 }}>{error}</StatusText>}
      {message && <StatusText tone="success" style={{ marginBottom: 10 }}>{message}</StatusText>}

      <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, marginBottom: 12 }}>
        <ClearableInput value={search} onChange={setSearch} placeholder={TXT.search} />
        <Button onClick={() => { setError(""); setMessage(""); setModalOpen(true); }} disabled={loading} variant="primary" size="sm">
          {TXT.add}
        </Button>
      </div>

      <Card style={{ marginBottom: 12 }}>
        <div style={{ display: "grid", gap: 10 }}>
          <div style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", alignItems: "center", gap: 10, opacity: 0.82 }}>
            <input type="checkbox" checked={allSelected} onChange={toggleAll} title={TXT.selectAllTitle} />
            <div>{TXT.list}</div>
            <div>{TXT.selected}: {selected.length}</div>
          </div>
          <ListTotalMeta label={TXT.usersTotal} total={total ?? adminCount} />

          {rows.map((row) => {
            const email = row.email;
            const inDb = row.in_db;
            const isSelf = email.toLowerCase() === selfEmail;
            const profile = row.profile || null;
            return (
              <SelectableListRow
                key={email}
                checked={selected.includes(email)}
                onToggle={() => toggleOne(email)}
                title={email}
                badges={
                  <IdentityBadgeRow
                    role="root-admin"
                    showSelf={isSelf}
                    dbPresence={inDb ? "in_db" : "only_env"}
                    inDbLabel={TXT.inDb}
                    onlyEnvLabel={TXT.onlyEnv}
                  />
                }
                onOpen={() => {
                  void openDrawer(email);
                }}
                details={
                  profile ? (
                    <UserListSessionMeta
                      lastIp={profile.last_ip}
                      lastUserAgent={profile.last_user_agent}
                      lastActivityAt={profile.last_activity_at}
                      trustedDevicesCount={profile.trusted_devices_count ?? null}
                    />
                  ) : null
                }
                checkboxTitle={TXT.selectAllTitle}
                openLabel={TXT.open}
              />
            );
          })}

          {!isListLoading && rows.length === 0 && <StatusText tone="muted">{TXT.noRows}</StatusText>}
          {hasMore && <MetaText opacity={0.72}>Показано: {rows.length} из {total ?? "—"}</MetaText>}
        </div>
      </Card>

      {selected.length > 0 && (
        <CompactActionCard title={TXT.actions} style={{ marginBottom: 12 }}>
          <div style={{ display: "grid", gap: 8 }}>
            {canBulkRemove ? (
              <>
                <ApplicabilityHint
                  applied={removableSelected.length}
                  total={selected.length}
                  showPartial={removableSelected.length < selected.length}
                  partialText="Часть выбранных записей будет пропущена (например, нельзя удалить себя)."
                />
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <Button onClick={removeSelected} disabled={loading} variant="danger" size="sm">{TXT.removeSelected}</Button>
                </div>
                <input
                  value={bulkReason}
                  onChange={(e) => setBulkReason(e.target.value)}
                  placeholder={removeReasonPlaceholder}
                  style={{ width: "100%", boxSizing: "border-box", padding: 10, borderRadius: 10 }}
                />
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {removeReasonPresets.map((p) => (
                    <ReasonPresetButton key={p} onClick={() => setBulkReason(p)}>{p}</ReasonPresetButton>
                  ))}
                </div>
                <MetaText opacity={0.78}>{removeReasonHintText}</MetaText>
              </>
            ) : (
              <>
                <ApplicabilityHint applied={removableSelected.length} total={selected.length} />
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {selected.some((x) => x === selfEmail) && <AccentPill tone="warning">{TXT.cannotSelf}</AccentPill>}
                  {adminCount <= 1 && <AccentPill tone="warning">{TXT.cannotLast}</AccentPill>}
                </div>
              </>
            )}
          </div>
        </CompactActionCard>
      )}

      <ModalShell
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        width="min(420px, 92vw)"
        zIndex={20}
        contentStyle={{ padding: 14, background: "#1a1a1a", display: "grid", gap: 10 }}
      >
        <h3 style={{ marginTop: 0, marginBottom: 0 }}>{TXT.addModalTitle}</h3>
        <input value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="email@company.com" style={{ width: "100%", boxSizing: "border-box", padding: 10, borderRadius: 10 }} />
        <input value={addReason} onChange={(e) => setAddReason(e.target.value)} placeholder={addReasonPlaceholder} style={{ width: "100%", boxSizing: "border-box", padding: 10, borderRadius: 10 }} />
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {addReasonPresets.map((p) => (
            <ReasonPresetButton key={p} onClick={() => setAddReason(p)}>{p}</ReasonPresetButton>
          ))}
        </div>
        <MetaText opacity={0.78}>{addReasonHintText}</MetaText>
        <ModalActionRow style={{ marginTop: 0 }}>
          <Button variant="ghost" size="sm" onClick={() => setModalOpen(false)}>{TXT.cancel}</Button>
          <Button variant="primary" size="sm" onClick={addEmail}>OK</Button>
        </ModalActionRow>
      </ModalShell>

      <SlidePanel open={drawerOpen} onClose={() => setDrawerOpen(false)}>
        <div style={{ padding: 16, borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
          <SectionHeaderRow
            title={(
              <div>
                <div style={{ fontSize: 18, fontWeight: 800 }}>{TXT.drawerTitle}</div>
                <MetaText opacity={0.7}>{drawerEmail}</MetaText>
              </div>
            )}
            actions={<Button onClick={() => setDrawerOpen(false)} size="sm" variant="ghost">{TXT.close}</Button>}
          />
        </div>

        <div style={{ overflowY: "auto", padding: 16, display: "grid", gap: 12, alignContent: "start" }}>
          {drawerLoading && <div>{TXT.loading}</div>}

          {!drawerLoading && (
            <>
              <Card style={{ padding: 12 }}>
                <div style={{ display: "grid", gap: 8 }}>
                  <UserBadgeGroups
                    identity={
                      <IdentityBadgeRow
                        role="root-admin"
                        showSelf={drawerEmail.toLowerCase() === selfEmail}
                        dbPresence={drawerUser ? "in_db" : "only_env"}
                        inDbLabel={TXT.inDb}
                        onlyEnvLabel={TXT.onlyEnv}
                      />
                    }
                    status={
                      drawerUser ? (
                        <UserStatusPills
                          user={{ ...drawerUser, role: null, is_root_admin: false }}
                          showBlockedWhenFalse={false}
                        />
                      ) : null
                    }
                  />
                  {drawerUser ? (
                    <>
                      {isTrustPolicy(drawerUser.trust_policy) ? (
                        <TrustPolicyDetailsCard
                          trustPolicy={drawerUser.trust_policy}
                          trustPolicyCatalog={trustPolicyCatalog}
                          title={TXT.trustDetails}
                        />
                      ) : (
                        <InlineInfoRow
                          title="Политика доверия устройства"
                          label="Политика доверия:"
                          value={drawerUser.trust_policy || "-"}
                          boldValue
                        />
                      )}
                    </>
                  ) : (
                    <MetaText>{TXT.notFoundInDb}</MetaText>
                  )}
                </div>
              </Card>

              <div style={{ display: "flex", justifyContent: "flex-start" }}>
                <Button size="sm" variant="accent" onClick={() => navigate(`/users?highlight_email=${encodeURIComponent(drawerEmail)}`)}>
                  {TXT.usersLink}
                </Button>
              </div>

              <CompactActionCard tone="warning" title={TXT.fastActions}>
                <div style={{ display: "grid", gap: 8 }}>
                  {canRemoveFromDrawer ? (
                    <>
                      <input value={drawerReason} onChange={(e) => setDrawerReason(e.target.value)} placeholder={removeReasonPlaceholder} style={{ width: "100%", boxSizing: "border-box", padding: 10, borderRadius: 10 }} />
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {removeReasonPresets.map((p) => (
                          <ReasonPresetButton key={p} onClick={() => setDrawerReason(p)}>{p}</ReasonPresetButton>
                        ))}
                      </div>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <Button size="sm" variant="danger" onClick={removeFromDrawer} disabled={drawerActionLoading}>
                          {drawerActionLoading ? TXT.removing : TXT.removeOne}
                        </Button>
                      </div>
                      <MetaText opacity={0.78}>{removeReasonHintText}</MetaText>
                    </>
                  ) : (
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {isDrawerSelf && <AccentPill tone="warning">{TXT.cannotSelf}</AccentPill>}
                      {isLastRootAdmin && <AccentPill tone="warning">{TXT.cannotLast}</AccentPill>}
                    </div>
                  )}
                </div>
              </CompactActionCard>
            </>
          )}
        </div>
      </SlidePanel>
      <ConfirmDialog
        open={confirmState.open}
        title="Подтвердите действие"
        description={
          confirmState.scope === "bulk"
            ? `Удалить выбранные записи из root-admin: ${removableSelected.length}`
            : `${TXT.confirmRemove} ${confirmState.email || ""} из списка root-admin`
        }
        confirmText="Да"
        cancelText="Нет"
        loading={drawerActionLoading}
        onCancel={() => {
          if (drawerActionLoading) return;
          setConfirmState({ open: false, scope: "bulk" });
        }}
        onConfirm={() => {
          void confirmRemove();
        }}
      />
    </div>
  );
}

