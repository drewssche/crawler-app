import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiGet, apiPost, isAbortError } from "../api/client";
import AccentPill from "../components/ui/AccentPill";
import Button from "../components/ui/Button";
import Card from "../components/ui/Card";
import ConfirmDialog from "../components/ui/ConfirmDialog";
import ClearableInput from "../components/ui/ClearableInput";
import SelectableListRow from "../components/ui/SelectableListRow";
import SlidePanel from "../components/ui/SlidePanel";
import type { TrustPolicyCatalogItem } from "../components/users/UserActionPanel";
import CompactActionCard from "../components/users/CompactActionCard";
import IdentityBadgeRow from "../components/users/IdentityBadgeRow";
import UserBadgeGroups from "../components/users/UserBadgeGroups";
import TrustPolicyDetailsCard from "../components/users/TrustPolicyDetailsCard";
import { UserStatusPills } from "../components/users/UserStatusPills";
import { useAuth } from "../hooks/auth";
import { getTrustPolicyCatalogCached } from "../utils/catalogCache";
import { useWorkspaceInfiniteScroll } from "../hooks/useWorkspaceInfiniteScroll";

type AdminSettingsResponse = {
  admin_emails: string[];
  db_admins: string[];
  is_root_admin: boolean;
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
  reasonRequired: "\u041f\u0440\u0438\u0447\u0438\u043d\u0430 \u0438\u0437\u043c\u0435\u043d\u0435\u043d\u0438\u044f \u0441\u043f\u0438\u0441\u043a\u0430 (\u043e\u0431\u044f\u0437\u0430\u0442\u0435\u043b\u044c\u043d\u043e)",
  reasonHint: "\u041f\u0440\u0438\u0447\u0438\u043d\u0430 \u043e\u0431\u044f\u0437\u0430\u0442\u0435\u043b\u044c\u043d\u0430 \u0438 \u043f\u043e\u043f\u0430\u0434\u0435\u0442 \u0432 \u0430\u0443\u0434\u0438\u0442-\u043b\u043e\u0433.",
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
};

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const ADD_REASON_PRESETS = [
  "\u0420\u0430\u0441\u0448\u0438\u0440\u0435\u043d\u0438\u0435 \u043a\u043e\u043c\u0430\u043d\u0434\u044b \u0430\u0434\u043c\u0438\u043d\u0438\u0441\u0442\u0440\u0438\u0440\u043e\u0432\u0430\u043d\u0438\u044f",
  "\u0420\u0435\u0437\u0435\u0440\u0432\u043d\u044b\u0439 root-admin \u043d\u0430 \u0441\u043b\u0443\u0447\u0430\u0439 \u0438\u043d\u0446\u0438\u0434\u0435\u043d\u0442\u0430",
  "\u0414\u0435\u043b\u0435\u0433\u0438\u0440\u043e\u0432\u0430\u043d\u0438\u0435 \u043e\u0442\u0432\u0435\u0442\u0441\u0442\u0432\u0435\u043d\u043d\u043e\u0441\u0442\u0438",
  "\u0412\u0440\u0435\u043c\u0435\u043d\u043d\u043e\u0435 \u043d\u0430\u0437\u043d\u0430\u0447\u0435\u043d\u0438\u0435 \u043d\u0430 \u043f\u0435\u0440\u0438\u043e\u0434 \u043f\u0440\u043e\u0435\u043a\u0442\u0430",
];

const REMOVE_REASON_PRESETS = [
  "\u0420\u043e\u0442\u0430\u0446\u0438\u044f \u0434\u043e\u0441\u0442\u0443\u043f\u0430",
  "\u0423\u0447\u0435\u0442\u043d\u0430\u044f \u0437\u0430\u043f\u0438\u0441\u044c \u0431\u043e\u043b\u044c\u0448\u0435 \u043d\u0435 \u0438\u0441\u043f\u043e\u043b\u044c\u0437\u0443\u0435\u0442\u0441\u044f",
  "\u0421\u043d\u0438\u0436\u0435\u043d\u0438\u0435 \u043f\u0440\u0438\u0432\u0438\u043b\u0435\u0433\u0438\u0439 \u043f\u043e \u043f\u043e\u043b\u0438\u0442\u0438\u043a\u0435 \u0431\u0435\u0437\u043e\u043f\u0430\u0441\u043d\u043e\u0441\u0442\u0438",
  "\u0417\u0430\u043f\u0440\u043e\u0441 \u0432\u043b\u0430\u0434\u0435\u043b\u044c\u0446\u0430 \u0441\u0438\u0441\u0442\u0435\u043c\u044b",
];
const BASE_ROWS = 20;

function isTrustPolicy(value: string | null | undefined): value is TrustPolicy {
  return value === "strict" || value === "standard" || value === "extended" || value === "permanent";
}

export default function RootAdminsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [adminEmails, setAdminEmails] = useState<string[]>([]);
  const [dbAdmins, setDbAdmins] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [addReason, setAddReason] = useState("");
  const [bulkReason, setBulkReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [rowsVisible, setRowsVisible] = useState(BASE_ROWS);
  const [selected, setSelected] = useState<string[]>([]);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerEmail, setDrawerEmail] = useState<string>("");
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [drawerUser, setDrawerUser] = useState<UserLookupRow | null>(null);
  const [trustPolicyCatalog, setTrustPolicyCatalog] = useState<Record<TrustPolicy, TrustPolicyCatalogItem>>({} as Record<TrustPolicy, TrustPolicyCatalogItem>);
  const [drawerReason, setDrawerReason] = useState("");
  const [drawerActionLoading, setDrawerActionLoading] = useState(false);
  const [confirmState, setConfirmState] = useState<{ open: boolean; scope: "bulk" | "drawer"; email?: string }>({
    open: false,
    scope: "bulk",
  });
  const adminListAbortRef = useRef<AbortController | null>(null);
  const drawerLookupAbortRef = useRef<AbortController | null>(null);
  const drawerLookupSeqRef = useRef(0);

  const selfEmail = (user?.email || "").toLowerCase();

  async function load() {
    adminListAbortRef.current?.abort();
    const controller = new AbortController();
    adminListAbortRef.current = controller;
    setError("");
    try {
      const data = await apiGet<AdminSettingsResponse>("/admin/settings/admin-emails", { signal: controller.signal });
      setAdminEmails(data.admin_emails || []);
      setDbAdmins(data.db_admins || []);
      setRowsVisible(BASE_ROWS);
    } catch (e) {
      if (isAbortError(e)) return;
      setError(String(e));
    } finally {
      if (adminListAbortRef.current === controller) {
        adminListAbortRef.current = null;
      }
    }
  }

  useEffect(() => {
    load();
  }, []);

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

  async function saveList(nextEmails: string[], reasonText: string) {
    setError("");
    setMessage("");
    setLoading(true);
    try {
      const res = await apiPost<SaveAdminEmailsResponse>("/admin/settings/admin-emails", {
        emails: nextEmails,
        reason: reasonText,
      });
      setAdminEmails(res.admin_emails || []);
      setMessage(TXT.updated);
      setSelected([]);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function addEmail() {
    const normalized = newEmail.trim().toLowerCase();
    const reasonText = addReason.trim();
    if (!EMAIL_RE.test(normalized)) {
      setError(TXT.badEmail);
      return;
    }
    if (!reasonText) {
      setError(TXT.needReason);
      return;
    }
    if (adminEmails.includes(normalized)) {
      setError(TXT.exists);
      return;
    }
    await saveList([...adminEmails, normalized], reasonText);
    setModalOpen(false);
    setNewEmail("");
    setAddReason("");
    await load();
  }

  const filtered = useMemo(
    () => adminEmails.filter((x) => x.includes(search.trim().toLowerCase())),
    [adminEmails, search],
  );
  const visibleAdmins = useMemo(() => filtered.slice(0, rowsVisible), [filtered, rowsVisible]);

  useWorkspaceInfiniteScroll({
    canLoadMore: rowsVisible < filtered.length,
    isLoading: false,
    onLoadMore: () => setRowsVisible((v) => Math.min(v + BASE_ROWS, filtered.length)),
    contentKey: `${rowsVisible}:${filtered.length}`,
  });

  useEffect(() => {
    setRowsVisible(BASE_ROWS);
  }, [search]);

  useEffect(() => {
    setRowsVisible((v) => Math.min(Math.max(BASE_ROWS, v), Math.max(BASE_ROWS, filtered.length)));
  }, [filtered.length]);

  const allSelected = visibleAdmins.length > 0 && visibleAdmins.every((x) => selected.includes(x));

  const removableSelected = useMemo(() => {
    if (selected.length === 0) return [] as string[];
    return selected.filter((x) => x !== selfEmail);
  }, [selected, selfEmail]);

  const canBulkRemove = useMemo(() => {
    if (removableSelected.length === 0) return false;
    return adminEmails.filter((x) => !removableSelected.includes(x)).length >= 1;
  }, [adminEmails, removableSelected]);

  function toggleOne(email: string) {
    setSelected((prev) => (prev.includes(email) ? prev.filter((x) => x !== email) : [...prev, email]));
  }

  function toggleAll() {
    setSelected(allSelected ? [] : visibleAdmins);
  }

  async function removeSelected() {
    const reasonText = bulkReason.trim();
    if (!reasonText) {
      setError(TXT.needReason);
      return;
    }
    if (selected.length === 0) {
      setError(TXT.chooseRows);
      return;
    }
    if (!canBulkRemove) {
      setError(TXT.cannotForSelected);
      return;
    }

    const next = adminEmails.filter((x) => !removableSelected.includes(x));
    if (next.length < 1) {
      setError(TXT.atLeastOne);
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
      adminListAbortRef.current?.abort();
      adminListAbortRef.current = null;
      drawerLookupAbortRef.current?.abort();
      drawerLookupAbortRef.current = null;
    };
  }, []);

  const isDrawerSelf = drawerEmail.toLowerCase() === selfEmail;
  const isLastRootAdmin = adminEmails.length <= 1;
  const canRemoveFromDrawer = !isDrawerSelf && !isLastRootAdmin;

  async function removeFromDrawer() {
    if (!canRemoveFromDrawer) return;
    const reasonText = drawerReason.trim();
    if (!reasonText) {
      setError(TXT.needReason);
      return;
    }
    setConfirmState({ open: true, scope: "drawer", email: drawerEmail });
  }

  async function confirmRemove() {
    if (!confirmState.open) return;
    if (confirmState.scope === "bulk") {
      const next = adminEmails.filter((x) => !removableSelected.includes(x));
      setDrawerActionLoading(true);
      try {
        await saveList(next, bulkReason.trim());
        setBulkReason("");
        if (selected.some((x) => x === selfEmail)) {
          setMessage(TXT.skippedSelf);
        }
        await load();
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
      await saveList(adminEmails.filter((x) => x !== confirmState.email), drawerReason.trim());
      setDrawerReason("");
      setDrawerOpen(false);
      await load();
    } finally {
      setDrawerActionLoading(false);
      setConfirmState({ open: false, scope: "drawer" });
    }
  }

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>{TXT.title}</h2>

      {error && <div style={{ color: "#d55", marginBottom: 10 }}>{error}</div>}
      {message && <div style={{ color: "#8fd18f", marginBottom: 10 }}>{message}</div>}

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

          {visibleAdmins.map((email) => {
            const inDb = dbAdmins.includes(email);
            const isSelf = email.toLowerCase() === selfEmail;
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
                checkboxTitle={TXT.selectAllTitle}
                openLabel={TXT.open}
              />
            );
          })}

          {filtered.length === 0 && <div style={{ opacity: 0.75 }}>{TXT.noRows}</div>}
          {filtered.length > visibleAdmins.length && (
            <div style={{ fontSize: 12, opacity: 0.72 }}>
              Показано: {visibleAdmins.length} из {filtered.length}
            </div>
          )}
        </div>
      </Card>

      {selected.length > 0 && (
        <CompactActionCard title={TXT.actions} style={{ marginBottom: 12 }}>
          <div style={{ display: "grid", gap: 8 }}>
            {canBulkRemove ? (
              <>
                <div style={{ fontSize: 12, opacity: 0.82 }}>
                  Применится к записям: {removableSelected.length} из {selected.length}
                </div>
                {removableSelected.length < selected.length && (
                  <div style={{ fontSize: 12, opacity: 0.82 }}>
                    Часть выбранных записей будет пропущена (например, нельзя удалить себя).
                  </div>
                )}
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <Button onClick={removeSelected} disabled={loading} variant="danger" size="sm">{TXT.removeSelected}</Button>
                </div>
                <input
                  value={bulkReason}
                  onChange={(e) => setBulkReason(e.target.value)}
                  placeholder={TXT.reasonRequired}
                  style={{ width: "100%", boxSizing: "border-box", padding: 10, borderRadius: 10 }}
                />
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {REMOVE_REASON_PRESETS.map((p) => (
                    <Button key={p} size="sm" variant="ghost" onClick={() => setBulkReason(p)} style={{ borderRadius: 999 }}>
                      {p}
                    </Button>
                  ))}
                </div>
                <div style={{ fontSize: 12, opacity: 0.78 }}>{TXT.reasonHint}</div>
              </>
            ) : (
              <>
                <div style={{ fontSize: 12, opacity: 0.82 }}>
                  Применится к записям: {removableSelected.length} из {selected.length}
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {selected.some((x) => x === selfEmail) && <AccentPill tone="warning">{TXT.cannotSelf}</AccentPill>}
                  {adminEmails.length <= 1 && <AccentPill tone="warning">{TXT.cannotLast}</AccentPill>}
                </div>
              </>
            )}
          </div>
        </CompactActionCard>
      )}

      {modalOpen && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "grid", placeItems: "center", zIndex: 20 }}>
          <Card style={{ width: 420, maxWidth: "92vw", padding: 14, background: "#1a1a1a" }}>
            <h3 style={{ marginTop: 0 }}>{TXT.addModalTitle}</h3>
            <input value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="email@company.com" style={{ width: "100%", boxSizing: "border-box", padding: 10, borderRadius: 10, marginBottom: 10 }} />
            <input value={addReason} onChange={(e) => setAddReason(e.target.value)} placeholder={TXT.reasonRequired} style={{ width: "100%", boxSizing: "border-box", padding: 10, borderRadius: 10, marginBottom: 10 }} />
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
              {ADD_REASON_PRESETS.map((p) => (
                <Button key={p} size="sm" variant="ghost" onClick={() => setAddReason(p)} style={{ borderRadius: 999 }}>{p}</Button>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <Button variant="ghost" size="sm" onClick={() => setModalOpen(false)}>{TXT.cancel}</Button>
              <Button variant="primary" size="sm" onClick={addEmail}>OK</Button>
            </div>
          </Card>
        </div>
      )}

      <SlidePanel open={drawerOpen} onClose={() => setDrawerOpen(false)}>
        <div style={{ padding: 16, borderBottom: "1px solid rgba(255,255,255,0.08)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800 }}>{TXT.drawerTitle}</div>
            <div style={{ fontSize: 12, opacity: 0.7 }}>{drawerEmail}</div>
          </div>
          <Button onClick={() => setDrawerOpen(false)} size="sm" variant="ghost">{TXT.close}</Button>
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
                        dbPresence={dbAdmins.includes(drawerEmail) ? "in_db" : "only_env"}
                        inDbLabel={TXT.inDb}
                        onlyEnvLabel={TXT.onlyEnv}
                      />
                    }
                    status={
                      drawerUser ? (
                        <UserStatusPills
                          user={{ ...drawerUser, role: null, is_root_admin: false }}
                          showApproveWhenFalse
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
                        <div
                          style={{ fontSize: 13, opacity: 0.84 }}
                          title="Политика доверия устройства"
                        >
                          Политика доверия: <b>{drawerUser.trust_policy || "-"}</b>
                        </div>
                      )}
                    </>
                  ) : (
                    <div style={{ opacity: 0.8 }}>{TXT.notFoundInDb}</div>
                  )}
                </div>
              </Card>

              <div style={{ display: "flex", justifyContent: "flex-start" }}>
                <Button size="sm" variant="secondary" onClick={() => navigate(`/users?highlight_email=${encodeURIComponent(drawerEmail)}`)}>
                  {TXT.usersLink}
                </Button>
              </div>

              <CompactActionCard tone="warning" title={TXT.fastActions}>
                <div style={{ display: "grid", gap: 8 }}>
                  {canRemoveFromDrawer ? (
                    <>
                      <input value={drawerReason} onChange={(e) => setDrawerReason(e.target.value)} placeholder={TXT.reasonRequired} style={{ width: "100%", boxSizing: "border-box", padding: 10, borderRadius: 10 }} />
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {REMOVE_REASON_PRESETS.map((p) => (
                          <Button key={p} size="sm" variant="ghost" onClick={() => setDrawerReason(p)} style={{ borderRadius: 999 }}>{p}</Button>
                        ))}
                      </div>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <Button size="sm" variant="danger" onClick={removeFromDrawer} disabled={drawerActionLoading}>
                          {drawerActionLoading ? TXT.removing : TXT.removeOne}
                        </Button>
                      </div>
                      <div style={{ fontSize: 12, opacity: 0.78 }}>{TXT.reasonHint}</div>
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
