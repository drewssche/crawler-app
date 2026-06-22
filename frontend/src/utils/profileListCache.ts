import { apiGet } from "../api/client";

export type ProfileListItem = {
  id: number;
  name: string;
  start_url: string;
  allowed_domains_csv?: string;
};

export type ProfileRunSummary = {
  id: number;
  status: string;
  started_at: string | null;
  finished_at: string | null;
  pages_total: number;
  pages_changed: number;
};

export type ProfileSummaryItem = ProfileListItem & {
  runs_total: number;
  last_run: ProfileRunSummary | null;
};

type CacheEntry<T> = {
  value: T | null;
  expiresAt: number;
  inFlight: Promise<T> | null;
};

const TTL_MS = 30_000;
const profilesEntry: CacheEntry<ProfileListItem[]> = {
  value: null,
  expiresAt: 0,
  inFlight: null,
};
const profilesSummaryEntry: CacheEntry<ProfileSummaryItem[]> = {
  value: null,
  expiresAt: 0,
  inFlight: null,
};

export function invalidateProfilesCache() {
  profilesEntry.value = null;
  profilesEntry.expiresAt = 0;
  profilesSummaryEntry.value = null;
  profilesSummaryEntry.expiresAt = 0;
}

export async function getProfilesSummaryCached(force = false): Promise<ProfileSummaryItem[]> {
  const now = Date.now();
  if (!force && profilesSummaryEntry.value && profilesSummaryEntry.expiresAt > now) {
    return profilesSummaryEntry.value;
  }
  if (profilesSummaryEntry.inFlight) return profilesSummaryEntry.inFlight;
  profilesSummaryEntry.inFlight = apiGet<ProfileSummaryItem[]>("/profiles/summary")
    .then((rows) => {
      profilesSummaryEntry.value = rows || [];
      profilesSummaryEntry.expiresAt = Date.now() + TTL_MS;
      return profilesSummaryEntry.value;
    })
    .finally(() => {
      profilesSummaryEntry.inFlight = null;
    });
  return profilesSummaryEntry.inFlight;
}

export async function getProfilesCached(force = false): Promise<ProfileListItem[]> {
  if (profilesEntry.value && !force && profilesEntry.expiresAt > Date.now()) {
    return profilesEntry.value;
  }
  if (profilesEntry.inFlight) return profilesEntry.inFlight;
  profilesEntry.inFlight = getProfilesSummaryCached(force)
    .then((rows) => {
      profilesEntry.value = rows.map((row) => ({
        id: row.id,
        name: row.name,
        start_url: row.start_url,
        allowed_domains_csv: row.allowed_domains_csv,
      }));
      profilesEntry.expiresAt = Date.now() + TTL_MS;
      return profilesEntry.value;
    })
    .finally(() => {
      profilesEntry.inFlight = null;
    });
  return profilesEntry.inFlight;
}
