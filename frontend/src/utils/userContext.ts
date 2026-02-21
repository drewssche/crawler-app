import { apiGet, apiPost } from "../api/client";
import type { UserDetailsResponse } from "../components/users/UserDetailsDrawer";
import type { AvailableActionsResponse } from "../types/catalog";
import type { BulkAction } from "../components/users/UserActionPanel";
import type { IdEmail } from "../types/common";

export type LoadedUserContext = {
  details: UserDetailsResponse;
  availableActions: BulkAction[];
};

const EMAIL_RESOLVE_TTL_MS = 60_000;
const EMAIL_RESOLVE_MISS_TTL_MS = 20_000;

type EmailResolveCacheEntry = {
  userId: number | null;
  expiresAt: number;
};

const emailToUserIdCache = new Map<string, EmailResolveCacheEntry>();
const emailResolveInFlight = new Map<string, Promise<number | null>>();

function getCachedUserIdByEmail(normalizedEmail: string): number | null | undefined {
  const now = Date.now();
  const cached = emailToUserIdCache.get(normalizedEmail);
  if (!cached) return undefined;
  if (cached.expiresAt <= now) {
    emailToUserIdCache.delete(normalizedEmail);
    return undefined;
  }
  return cached.userId;
}

async function resolveUserIdByEmail(normalizedEmail: string): Promise<number | null> {
  const cached = getCachedUserIdByEmail(normalizedEmail);
  if (cached !== undefined) {
    return cached;
  }

  const existingInFlight = emailResolveInFlight.get(normalizedEmail);
  if (existingInFlight) {
    return existingInFlight;
  }

  const promise = apiGet<IdEmail[]>(`/admin/users?status=all&q=${encodeURIComponent(normalizedEmail)}`)
    .then((rows) => {
      const hit = (rows || []).find((x) => x.email.toLowerCase() === normalizedEmail);
      const userId = hit ? hit.id : null;
      emailToUserIdCache.set(normalizedEmail, {
        userId,
        expiresAt: Date.now() + (userId ? EMAIL_RESOLVE_TTL_MS : EMAIL_RESOLVE_MISS_TTL_MS),
      });
      return userId;
    })
    .finally(() => {
      emailResolveInFlight.delete(normalizedEmail);
    });

  emailResolveInFlight.set(normalizedEmail, promise);
  return promise;
}

export async function loadUserContextById(userId: number, options?: { signal?: AbortSignal }): Promise<LoadedUserContext> {
  const [details, available] = await Promise.all([
    apiGet<UserDetailsResponse>(`/admin/users/${userId}/details`, { signal: options?.signal }),
    apiPost<AvailableActionsResponse>("/admin/users/actions/available", { user_ids: [userId] }, { signal: options?.signal }),
  ]);
  return {
    details,
    availableActions: available.actions ?? [],
  };
}

export async function loadUserContextByEmail(email: string): Promise<LoadedUserContext | null> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return null;
  const userId = await resolveUserIdByEmail(normalized);
  if (!userId) return null;
  return loadUserContextById(userId);
}
