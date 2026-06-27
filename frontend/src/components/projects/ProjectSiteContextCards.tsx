import type { ProjectSiteSummary } from "../../api/projectSites";
import { formatOperationalDateTime } from "../../utils/datetime";
import Card from "../ui/Card";
import ProjectRunBadge from "../ui/ProjectRunBadge";
import AccentPill from "../ui/AccentPill";
import { MetaText, StatusText } from "../ui/StatusText";

function scopeLabel(site: ProjectSiteSummary): string {
  return site.scope_mode === "whole_site" ? "Весь сайт" : `Раздел ${site.path_prefix}`;
}

function anomalyLabel(site: ProjectSiteSummary): { text: string; tone: "success" | "warning" | "danger" | "muted" } {
  if (site.anomaly.status === "insufficient_data") {
    const required = site.anomaly.baseline_runs_required + 1;
    return { text: `Мониторинг: ${Math.min(site.anomaly.successful_runs, required)} из ${required} прогонов`, tone: "muted" };
  }
  if (site.anomaly.status === "anomaly") {
    return {
      text: site.anomaly.severity === "danger" ? "Обнаружена критичная аномалия" : "Обнаружено отклонение",
      tone: site.anomaly.severity === "danger" ? "danger" : "warning",
    };
  }
  return { text: "Аномалий не обнаружено", tone: "success" };
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
        const anomaly = anomalyLabel(site);
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
              gap: 7,
              minHeight: 128,
              borderColor: selected ? "rgba(120,166,255,0.78)" : undefined,
              background: selected ? "rgba(120,166,255,0.1)" : undefined,
              boxShadow: selected ? "0 0 0 1px rgba(120,166,255,0.22)" : undefined,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 750, overflow: "hidden", textOverflow: "ellipsis" }}>{site.name}</div>
                <MetaText opacity={0.68} style={{ marginTop: 2 }}>{scopeLabel(site)}</MetaText>
                <MetaText opacity={0.68} style={{ marginTop: 2 }}>
                  Контекст: {site.last_run?.persona?.label || site.default_persona?.label || "Гость"}
                </MetaText>
              </div>
              <ProjectRunBadge status={lastRun?.status} />
            </div>
            {selected && (
              <div>
                <AccentPill tone="info" title="Показатели, структура и история ниже относятся к этому сайту.">
                  Выбранный сайт
                </AccentPill>
              </div>
            )}

            {lastRun ? (
              <>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <MetaText>Страниц: <strong>{lastRun.pages_total}</strong></MetaText>
                  <MetaText>Изменений: <strong>{lastRun.pages_changed}</strong></MetaText>
                </div>
                <MetaText opacity={0.65}>
                  {lastRun.finished_at
                    ? formatOperationalDateTime(lastRun.finished_at)
                    : lastRun.status === "RUNNING" ? "Прогон выполняется" : formatOperationalDateTime(lastRun.started_at)}
                </MetaText>
                {lastRun.status === "FAILED" && (
                  <StatusText tone="danger" style={{ fontSize: 12 }}>
                    {lastRun.failure_message || "Прогон завершился с ошибкой."}
                  </StatusText>
                )}
              </>
            ) : (
              <MetaText opacity={0.68}>Прогонов пока нет</MetaText>
            )}

            {!site.is_enabled && (
              <div>
                <AccentPill tone="warning" title="Новые прогоны отключены, предыдущие результаты сохранены.">
                  Сайт отключён
                </AccentPill>
              </div>
            )}
            <StatusText tone={anomaly.tone} style={{ fontSize: 12 }}>{anomaly.text}</StatusText>
          </Card>
        );
      })}
    </div>
  );
}
