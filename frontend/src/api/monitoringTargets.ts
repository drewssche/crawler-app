import { apiDelete, apiGet, apiPatch, apiPost } from "./client";
import type { RenderedSnapshotElement } from "./compare";

export type MonitoringTarget = {
  id: number;
  project_id: number;
  project_site_id?: number | null;
  run_id: number;
  page_id: number;
  crawl_persona_id?: number | null;
  name: string;
  page_url: string;
  selector: string;
  tag: string;
  fingerprint_hash: string;
  fingerprint: Record<string, unknown>;
  source: string;
  is_active: boolean;
  created_at?: string | null;
  updated_at?: string | null;
  latest_check?: MonitoringTargetCheckRecord | null;
  next_step: string;
};

export type MonitoringTargetCheck = {
  target: MonitoringTarget;
  checked_run_id: number;
  checked_page_id: number;
  checked_url: string;
  status: "matched" | "changed" | "missing" | "not_checkable";
  message: string;
  best_match?: {
    strategy: "selector" | "fingerprint";
    selector: string;
    tag: string;
    text: string;
    similarity: number;
    fingerprint: Record<string, unknown>;
  } | null;
  matches: Array<NonNullable<MonitoringTargetCheck["best_match"]>>;
};

export type MonitoringTargetCheckRecord = {
  id: number;
  target_id: number;
  project_id: number;
  project_site_id?: number | null;
  run_id: number;
  page_id?: number | null;
  status: MonitoringTargetCheck["status"];
  message: string;
  result: Omit<MonitoringTargetCheck, "target" | "checked_run_id" | "checked_page_id" | "checked_url">;
  checked_at?: string | null;
};

export type MonitoringTargetSubscription = {
  id: number;
  target_id: number;
  project_id: number;
  channel_type: "email" | "telegram_chat" | string;
  destination: string;
  statuses: Array<MonitoringTargetCheck["status"]>;
  min_interval_minutes: number;
  is_active: boolean;
  last_enqueued_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type MonitoringNotificationOutboxItem = {
  id: number;
  subscription_id?: number | null;
  target_id: number;
  target_check_id: number;
  project_id: number;
  channel_type: "email" | "telegram_chat" | string;
  destination: string;
  event_status: MonitoringTargetCheck["status"];
  delivery_status: "queued" | "sent" | "failed" | string;
  attempts: number;
  max_attempts: number;
  next_attempt_at?: string | null;
  payload: Record<string, unknown>;
  last_error: string;
  created_at?: string | null;
  sent_at?: string | null;
};

export type MonitoringNotificationDiagnostics = {
  smtp_configured: boolean;
  telegram_configured: boolean;
  max_attempts: number;
  retry_backoff_seconds: number[];
  counts: {
    queued: number;
    failed_waiting: number;
    retry_ready: number;
    sent: number;
    dead: number;
  };
  total: number;
};

export type CreateMonitoringTargetInput = {
  name?: string;
  source?: "rendered_snapshot" | string;
  element: RenderedSnapshotElement;
};

export function createMonitoringTarget(runId: number, url: string, payload: CreateMonitoringTargetInput): Promise<MonitoringTarget> {
  return apiPost<MonitoringTarget>(`/runs/${runId}/monitoring-targets?url=${encodeURIComponent(url)}`, payload);
}

export function listProjectMonitoringTargets(projectId: number, limit = 20): Promise<{ items: MonitoringTarget[]; total: number }> {
  return apiGet<{ items: MonitoringTarget[]; total: number }>(`/runs/monitoring-targets/by-project/${projectId}?limit=${limit}`);
}

export function checkMonitoringTarget(targetId: number, options?: { runId?: number; url?: string }): Promise<MonitoringTargetCheck> {
  const params = new URLSearchParams();
  if (options?.runId) params.set("run_id", String(options.runId));
  if (options?.url) params.set("url", options.url);
  const suffix = params.toString() ? `?${params.toString()}` : "";
  return apiPost<MonitoringTargetCheck>(`/runs/monitoring-targets/${targetId}/check${suffix}`, {});
}

export function listMonitoringTargetChecks(
  targetId: number,
  limit = 20,
): Promise<{ target: MonitoringTarget; items: MonitoringTargetCheckRecord[]; total: number }> {
  return apiGet<{ target: MonitoringTarget; items: MonitoringTargetCheckRecord[]; total: number }>(
    `/runs/monitoring-targets/${targetId}/checks?limit=${limit}`,
  );
}

export function updateMonitoringTarget(
  targetId: number,
  payload: { name?: string; is_active?: boolean },
): Promise<MonitoringTarget> {
  return apiPatch<MonitoringTarget>(`/runs/monitoring-targets/${targetId}`, payload);
}

export function deleteMonitoringTarget(targetId: number): Promise<{ deleted: boolean; target_id: number }> {
  return apiDelete<{ deleted: boolean; target_id: number }>(`/runs/monitoring-targets/${targetId}`);
}

export function listMonitoringTargetSubscriptions(
  targetId: number,
): Promise<{ items: MonitoringTargetSubscription[]; total: number }> {
  return apiGet<{ items: MonitoringTargetSubscription[]; total: number }>(
    `/runs/monitoring-targets/${targetId}/subscriptions`,
  );
}

export function createMonitoringTargetSubscription(
  targetId: number,
  payload: {
    channel_type: "email" | "telegram_chat" | string;
    destination: string;
    statuses?: Array<MonitoringTargetCheck["status"]>;
    min_interval_minutes?: number;
  },
): Promise<MonitoringTargetSubscription> {
  return apiPost<MonitoringTargetSubscription>(`/runs/monitoring-targets/${targetId}/subscriptions`, payload);
}

export function updateMonitoringTargetSubscription(
  subscriptionId: number,
  payload: {
    destination?: string;
    statuses?: Array<MonitoringTargetCheck["status"]>;
    min_interval_minutes?: number;
    is_active?: boolean;
  },
): Promise<MonitoringTargetSubscription> {
  return apiPatch<MonitoringTargetSubscription>(`/runs/monitoring-subscriptions/${subscriptionId}`, payload);
}

export function deleteMonitoringTargetSubscription(subscriptionId: number): Promise<{ deleted: boolean; subscription_id: number }> {
  return apiDelete<{ deleted: boolean; subscription_id: number }>(`/runs/monitoring-subscriptions/${subscriptionId}`);
}

export type MonitoringNotificationPreview = {
  subscription: MonitoringTargetSubscription;
  target: MonitoringTarget;
  subject: string;
  body: string;
  payload: Record<string, unknown>;
};

export function previewMonitoringTargetSubscription(
  subscriptionId: number,
  status: MonitoringTargetCheck["status"] = "not_checkable",
): Promise<MonitoringNotificationPreview> {
  return apiPost<MonitoringNotificationPreview>(`/runs/monitoring-subscriptions/${subscriptionId}/preview`, { status });
}

export function testSendMonitoringTargetSubscription(
  subscriptionId: number,
  status: MonitoringTargetCheck["status"] = "not_checkable",
): Promise<{
  ok: boolean;
  preview: Pick<MonitoringNotificationPreview, "subject" | "body" | "payload">;
  outbox: MonitoringNotificationOutboxItem;
}> {
  return apiPost<{
    ok: boolean;
    preview: Pick<MonitoringNotificationPreview, "subject" | "body" | "payload">;
    outbox: MonitoringNotificationOutboxItem;
  }>(`/runs/monitoring-subscriptions/${subscriptionId}/test-send`, { status });
}

export function listMonitoringTargetNotificationOutbox(
  targetId: number,
  limit = 20,
): Promise<{ items: MonitoringNotificationOutboxItem[]; total: number }> {
  return apiGet<{ items: MonitoringNotificationOutboxItem[]; total: number }>(
    `/runs/monitoring-targets/${targetId}/notification-outbox?limit=${limit}`,
  );
}

export function runMonitoringNotificationDeliveryTick(
  limit = 20,
): Promise<{
  ok: boolean;
  processed: number;
  sent: number;
  failed: number;
  items: MonitoringNotificationOutboxItem[];
}> {
  return apiPost<{
    ok: boolean;
    processed: number;
    sent: number;
    failed: number;
    items: MonitoringNotificationOutboxItem[];
  }>(`/runs/monitoring-notifications/worker/tick?limit=${limit}`, {});
}

export function getMonitoringNotificationDiagnostics(): Promise<MonitoringNotificationDiagnostics> {
  return apiGet<MonitoringNotificationDiagnostics>("/runs/monitoring-notifications/diagnostics");
}
