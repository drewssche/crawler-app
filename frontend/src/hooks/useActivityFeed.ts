import { useState } from "react";
import { apiGet } from "../api/client";
import type { PagedResponse } from "../types/common";
import { useIncrementalPager } from "./useIncrementalPager";

export type ActivityMode = "audit" | "login";

export type ActivityAuditItem = {
  id: number;
  created_at: string;
  action: string;
  actor_email: string;
  target_email: string;
  ip: string | null;
  meta?: Record<string, unknown> | null;
};

export type ActivityLoginItem = {
  id: number;
  user_id: number | null;
  email: string;
  created_at: string;
  ip: string | null;
  user_agent: string | null;
  result: string;
  source: string;
};

type UseActivityFeedOptions = {
  mode: ActivityMode;
  pageSize?: number;
  dateFrom: string;
  dateTo: string;
  sortDir: "desc" | "asc";
  action: string;
  actorEmail: string;
  targetEmail: string;
  securityOnly: boolean;
  ipFilter: string;
  resultFilter: string;
  sourceFilter: string;
  onReset?: () => void;
  onError?: (error: unknown) => void;
};

export function useActivityFeed({
  mode,
  pageSize = 20,
  dateFrom,
  dateTo,
  sortDir,
  action,
  actorEmail,
  targetEmail,
  securityOnly,
  ipFilter,
  resultFilter,
  sourceFilter,
  onReset,
  onError,
}: UseActivityFeedOptions) {
  const [auditRows, setAuditRows] = useState<ActivityAuditItem[]>([]);
  const [loginRows, setLoginRows] = useState<ActivityLoginItem[]>([]);

  const { total, isLoading, hasMore, resetAndLoad, requestNextPage } = useIncrementalPager<ActivityAuditItem | ActivityLoginItem>({
    fetchPage: async (nextPage, signal) => {
      const qp = new URLSearchParams({
        page: String(nextPage),
        page_size: String(pageSize),
        date_from: dateFrom,
        date_to: dateTo,
        sort_dir: sortDir,
      });
      if (mode === "audit") {
        qp.set("action", action.trim());
        qp.set("actor_email", actorEmail.trim());
        qp.set("target_email", targetEmail.trim());
        qp.set("security_only", String(securityOnly));
        return apiGet<PagedResponse<ActivityAuditItem | ActivityLoginItem>>(`/admin/audit?${qp.toString()}`, { signal });
      }
      qp.set("email", targetEmail.trim());
      qp.set("ip", ipFilter.trim());
      qp.set("result", resultFilter.trim());
      qp.set("source", sourceFilter.trim());
      return apiGet<PagedResponse<ActivityAuditItem | ActivityLoginItem>>(`/admin/login-history?${qp.toString()}`, { signal });
    },
    applyPage: (data, append) => {
      if (mode === "audit") {
        setAuditRows((prev) => (append ? [...prev, ...(data.items as ActivityAuditItem[])] : (data.items as ActivityAuditItem[])));
        if (!append) setLoginRows([]);
        return;
      }
      setLoginRows((prev) => (append ? [...prev, ...(data.items as ActivityLoginItem[])] : (data.items as ActivityLoginItem[])));
      if (!append) setAuditRows([]);
    },
    onReset: () => {
      setAuditRows([]);
      setLoginRows([]);
      onReset?.();
    },
    onError: (e) => {
      onError?.(e);
    },
  });

  return {
    auditRows,
    loginRows,
    total,
    isLoading,
    hasMore,
    resetAndLoad,
    requestNextPage,
  };
}
