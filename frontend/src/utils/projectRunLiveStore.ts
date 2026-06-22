import type { ProfileSummaryItem } from "./profileListCache";

export type ProjectRunLiveUpdate = {
  profileId: number;
  status: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  pagesTotal?: number;
  pagesChanged?: number;
  runsTotal?: number;
};

type Listener = (update: ProjectRunLiveUpdate) => void;

const listeners = new Set<Listener>();

export function publishProjectRunLive(update: ProjectRunLiveUpdate) {
  for (const listener of listeners) listener(update);
}

export function subscribeProjectRunLive(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function applyProjectRunLiveUpdate(row: ProfileSummaryItem, update: ProjectRunLiveUpdate): ProfileSummaryItem {
  if (row.id !== update.profileId) return row;
  const prev = row.last_run;
  const nextLastRun = {
    id: prev?.id || -Date.now(),
    status: update.status,
    started_at: update.startedAt ?? prev?.started_at ?? new Date().toISOString(),
    finished_at: update.finishedAt ?? (update.status === "RUNNING" ? null : prev?.finished_at ?? null),
    pages_total: update.pagesTotal ?? prev?.pages_total ?? 0,
    pages_changed: update.pagesChanged ?? prev?.pages_changed ?? 0,
  };
  const nextRunsTotal =
    update.runsTotal ??
    (update.status === "RUNNING" && prev?.status !== "RUNNING" ? Math.max(1, row.runs_total + 1) : row.runs_total);
  return {
    ...row,
    runs_total: nextRunsTotal,
    last_run: nextLastRun,
  };
}
