import { apiGet } from "../api/client";
import type {
  ActionCatalogResponse,
  AuditActionCatalogItem,
  AuditActionCatalogResponse,
  TrustPolicyCatalogResponse,
} from "../types/catalog";
import type { ActionCatalogItem, BulkAction, TrustPolicy, TrustPolicyCatalogItem } from "../components/users/UserActionPanel";

const CATALOG_TTL_MS = 2 * 60 * 1000;

type CacheEntry<T> = {
  value: T | null;
  expiresAt: number;
  inFlight: Promise<T> | null;
};

function createEntry<T>(): CacheEntry<T> {
  return { value: null, expiresAt: 0, inFlight: null };
}

const userActionCatalogEntry = createEntry<Record<BulkAction, ActionCatalogItem>>();
const trustPolicyCatalogEntry = createEntry<Record<TrustPolicy, TrustPolicyCatalogItem>>();
const auditActionCatalogEntry = createEntry<AuditActionCatalogItem[]>();

async function loadWithCache<T>(entry: CacheEntry<T>, loader: () => Promise<T>, force = false): Promise<T> {
  const now = Date.now();
  if (!force && entry.value !== null && entry.expiresAt > now) {
    return entry.value;
  }
  if (entry.inFlight) return entry.inFlight;
  entry.inFlight = loader()
    .then((value) => {
      entry.value = value;
      entry.expiresAt = Date.now() + CATALOG_TTL_MS;
      return value;
    })
    .finally(() => {
      entry.inFlight = null;
    });
  return entry.inFlight;
}

export async function getUserActionCatalogCached(force = false): Promise<Record<BulkAction, ActionCatalogItem>> {
  return loadWithCache(
    userActionCatalogEntry,
    async () => {
      const res = await apiGet<ActionCatalogResponse>("/admin/users/actions/catalog");
      const map = {} as Record<BulkAction, ActionCatalogItem>;
      for (const item of res.actions || []) map[item.action] = item;
      return map;
    },
    force,
  );
}

export async function getTrustPolicyCatalogCached(force = false): Promise<Record<TrustPolicy, TrustPolicyCatalogItem>> {
  return loadWithCache(
    trustPolicyCatalogEntry,
    async () => {
      const res = await apiGet<TrustPolicyCatalogResponse>("/admin/users/trust-policies/catalog");
      const map = {} as Record<TrustPolicy, TrustPolicyCatalogItem>;
      for (const item of res.policies || []) map[item.label] = item;
      return map;
    },
    force,
  );
}

export async function getAuditActionCatalogCached(force = false): Promise<AuditActionCatalogItem[]> {
  return loadWithCache(
    auditActionCatalogEntry,
    async () => {
      const res = await apiGet<AuditActionCatalogResponse>("/admin/audit/actions/catalog");
      return res.actions ?? [];
    },
    force,
  );
}

export async function getUserAndTrustCatalogsCached(force = false): Promise<{
  actionCatalog: Record<BulkAction, ActionCatalogItem>;
  trustPolicyCatalog: Record<TrustPolicy, TrustPolicyCatalogItem>;
}> {
  const [actionCatalog, trustPolicyCatalog] = await Promise.all([
    getUserActionCatalogCached(force),
    getTrustPolicyCatalogCached(force),
  ]);
  return { actionCatalog, trustPolicyCatalog };
}

