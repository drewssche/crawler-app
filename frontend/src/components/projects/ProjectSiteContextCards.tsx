import type { ProjectSiteSummary } from "../../api/projectSites";
import Card from "../ui/Card";
import ProjectRunBadge from "../ui/ProjectRunBadge";
import AccentPill from "../ui/AccentPill";
import { MetaText } from "../ui/StatusText";

function scopeLabel(site: ProjectSiteSummary): string {
  return site.scope_mode === "whole_site" ? "Весь сайт" : `Раздел ${site.path_prefix}`;
}

export default function ProjectSiteContextCards({
  sites,
  selectedSiteId,
  onSelect,
}: {
  sites: ProjectSiteSummary[];
  selectedSiteId: number | null;
  onSelect: (siteId: number) => void;
}) {
  return (
    <div
      aria-label="Сайты проекта"
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
        gap: 8,
      }}
    >
      {sites.map((site) => {
        const selected = site.id === selectedSiteId;
        const lastRun = site.last_run;
        const contextLabel = site.last_run?.persona?.label || site.default_persona?.label || "Гость";
        return (
          <Card
            key={site.id}
            interactive
            role="button"
            tabIndex={0}
            aria-pressed={selected}
            onClick={() => onSelect(site.id)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              onSelect(site.id);
            }}
            style={{
              cursor: "pointer",
              display: "grid",
              gap: 10,
              minHeight: 112,
              borderColor: selected ? "rgba(120,166,255,0.78)" : undefined,
              background: selected ? "rgba(120,166,255,0.1)" : undefined,
              boxShadow: selected ? "0 0 0 1px rgba(120,166,255,0.22)" : undefined,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 750, overflow: "hidden", textOverflow: "ellipsis" }}>{site.name}</div>
                <MetaText opacity={0.68} style={{ marginTop: 2, overflow: "hidden", textOverflow: "ellipsis" }}>
                  {site.start_url}
                </MetaText>
              </div>
              <ProjectRunBadge status={lastRun?.status} />
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <AccentPill tone={selected ? "info" : "neutral"}>{contextLabel}</AccentPill>
              <AccentPill tone="neutral">{site.runs_total} прогон(а)</AccentPill>
              <MetaText opacity={0.68}>{scopeLabel(site)}</MetaText>
            </div>
            {lastRun && (
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <MetaText>Страниц: <strong>{lastRun.pages_total}</strong></MetaText>
                {site.runs_total > 1 && (
                  <MetaText>Изменений: <strong>{lastRun.pages_changed}</strong></MetaText>
                )}
              </div>
            )}

            {!site.is_enabled && (
              <div>
                <AccentPill tone="warning" title="Новые прогоны отключены, предыдущие результаты сохранены.">
                  Сайт отключён
                </AccentPill>
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}
