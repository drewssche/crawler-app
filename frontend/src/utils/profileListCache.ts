import { apiGet } from "../api/client";

export type ProfileListItem = {
  id: number;
  name: string;
  start_url: string;
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

export async function getProfilesCached(force = false): Promise<ProfileListItem[]> {
  const now = Date.now();
  if (!force && profilesEntry.value && profilesEntry.expiresAt > now) {
    return profilesEntry.value;
  }
  if (profilesEntry.inFlight) return profilesEntry.inFlight;
  profilesEntry.inFlight = apiGet<ProfileListItem[]>("/profiles")
    .then((rows) => {
      profilesEntry.value = rows || [];
      profilesEntry.expiresAt = Date.now() + TTL_MS;
      return profilesEntry.value;
    })
    .finally(() => {
      profilesEntry.inFlight = null;
    });
  return profilesEntry.inFlight;
}

