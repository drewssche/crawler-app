import { apiGet } from "../api/client";

export type MatrixRole = {
  role: string;
  permissions: string[];
};

export type MatrixCapability = {
  id: string;
  label: string;
  roles: string[];
};

export type PermissionsMatrix = {
  roles: MatrixRole[];
  permission_labels: Record<string, string>;
  capabilities: MatrixCapability[];
};

type CacheEntry<T> = {
  value: T | null;
  expiresAt: number;
  inFlight: Promise<T> | null;
};

const TTL_MS = 60_000;
const matrixEntry: CacheEntry<PermissionsMatrix> = {
  value: null,
  expiresAt: 0,
  inFlight: null,
};

export async function getPermissionsMatrixCached(force = false): Promise<PermissionsMatrix> {
  const now = Date.now();
  if (!force && matrixEntry.value && matrixEntry.expiresAt > now) {
    return matrixEntry.value;
  }
  if (matrixEntry.inFlight) return matrixEntry.inFlight;
  matrixEntry.inFlight = apiGet<PermissionsMatrix>("/auth/permissions-matrix")
    .then((data) => {
      matrixEntry.value = data;
      matrixEntry.expiresAt = Date.now() + TTL_MS;
      return data;
    })
    .finally(() => {
      matrixEntry.inFlight = null;
    });
  return matrixEntry.inFlight;
}

