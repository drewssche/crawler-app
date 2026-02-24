export type ActivityExportMode = "audit" | "login";
export type ExportFormat = "csv" | "xlsx";
export type MonitoringExportGroup = "all" | "http" | "auth" | "admin" | "events";

export function buildActivityExportRequest(args: {
  mode: ActivityExportMode;
  format: ExportFormat;
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
}): { url: string; filename: string } {
  const p = new URLSearchParams({
    date_from: args.dateFrom,
    date_to: args.dateTo,
    sort_dir: args.sortDir,
  });

  if (args.mode === "audit") {
    p.set("action", args.action.trim());
    p.set("actor_email", args.actorEmail.trim());
    p.set("target_email", args.targetEmail.trim());
    p.set("security_only", String(args.securityOnly));
    return {
      url: `/admin/audit/export.${args.format}?${p.toString()}`,
      filename: `admin_audit_logs.${args.format}`,
    };
  }

  p.set("email", args.targetEmail.trim());
  p.set("ip", args.ipFilter.trim());
  p.set("result", args.resultFilter.trim());
  p.set("source", args.sourceFilter.trim());
  return {
    url: `/admin/login-history/export.${args.format}?${p.toString()}`,
    filename: `login_history.${args.format}`,
  };
}

export function buildMonitoringExportRequest(args: {
  format: ExportFormat;
  group: MonitoringExportGroup;
  query: string;
}): { url: string; filename: string } {
  const p = new URLSearchParams({
    group: args.group,
    query: args.query.trim(),
  });
  return {
    url: `/metrics/export.${args.format}?${p.toString()}`,
    filename: `metrics.${args.format}`,
  };
}
