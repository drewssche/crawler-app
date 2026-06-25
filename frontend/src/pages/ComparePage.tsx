import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import {
  getCompareSnapshot,
  listComparePages,
  listCompareRuns,
  type ComparePageItem,
  type CompareRun,
  type CompareSnapshot,
} from "../api/compare";
import { listProjectSites, type ProjectSite } from "../api/projectSites";
import Card from "../components/ui/Card";
import SegmentedControl from "../components/ui/SegmentedControl";
import SectionHeaderRow from "../components/ui/SectionHeaderRow";
import { MetaText, StatusText } from "../components/ui/StatusText";
import UiSelect from "../components/ui/UiSelect";
import { formatOperationalDateTime } from "../utils/datetime";
import { buildLineDiff } from "../utils/codeDiff";
import { suggestPageMatch } from "../utils/pageMatch";
import Button from "../components/ui/Button";

type CompareMode = "visual" | "code" | "structure";
type SideKey = "left" | "right";
type PanelView = "both" | "left" | "right";
type VisualScale = "overview" | "detail";

type SideState = {
  siteId: number | null;
  runs: CompareRun[];
  runId: number | null;
  pages: ComparePageItem[];
  url: string;
  snapshot: CompareSnapshot | null;
  loading: boolean;
  error: string;
};

const EMPTY_SIDE: SideState = {
  siteId: null,
  runs: [],
  runId: null,
  pages: [],
  url: "",
  snapshot: null,
  loading: false,
  error: "",
};

function SnapshotSelector({
  label,
  sites,
  side,
  onSiteChange,
  onRunChange,
  onPageChange,
}: {
  label: string;
  sites: ProjectSite[];
  side: SideState;
  onSiteChange: (siteId: number) => void;
  onRunChange: (runId: number) => void;
  onPageChange: (url: string) => void;
}) {
  return (
    <Card style={{ display: "grid", gap: 8, minWidth: 0 }}>
      <div style={{ fontWeight: 700 }}>{label}</div>
      <UiSelect
        value={side.siteId ?? ""}
        onChange={(event) => onSiteChange(Number(event.target.value))}
        style={{ width: "100%" }}
      >
        <option value="" disabled>Выберите сайт</option>
        {sites.map((site) => <option key={site.id} value={site.id}>{site.name} · {site.start_url}</option>)}
      </UiSelect>
      <UiSelect
        value={side.runId ?? ""}
        onChange={(event) => onRunChange(Number(event.target.value))}
        disabled={side.runs.length === 0}
        style={{ width: "100%" }}
      >
        <option value="" disabled>Выберите версию</option>
        {side.runs.map((run) => (
          <option key={run.id} value={run.id}>
            run #{run.id} · {run.status} · {formatOperationalDateTime(run.finished_at || run.started_at)}
          </option>
        ))}
      </UiSelect>
      <UiSelect
        value={side.url}
        onChange={(event) => onPageChange(event.target.value)}
        disabled={side.pages.length === 0}
        style={{ width: "100%" }}
      >
        <option value="" disabled>Выберите страницу</option>
        {side.pages.map((page) => (
          <option key={page.id} value={page.url}>{page.status_code} · {page.url}</option>
        ))}
      </UiSelect>
      {side.loading && <MetaText>Загрузка snapshot...</MetaText>}
      {side.error && <StatusText tone="danger">{side.error}</StatusText>}
    </Card>
  );
}

function MetricRow({ label, left, right }: { label: string; left: string | number; right: string | number }) {
  const different = String(left) !== String(right);
  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(130px, 0.8fr) 1fr 1fr", gap: 8, fontSize: 13 }}>
      <MetaText opacity={0.68}>{label}</MetaText>
      <div style={{ color: different ? "#e7a15a" : "inherit", wordBreak: "break-word" }}>{left || "—"}</div>
      <div style={{ color: different ? "#e7a15a" : "inherit", wordBreak: "break-word" }}>{right || "—"}</div>
    </div>
  );
}

function safeSnapshotDocument(html: string): string {
  const parser = new DOMParser();
  const document = parser.parseFromString(html || "<html><body></body></html>", "text/html");
  for (const node of document.querySelectorAll("script, iframe, object, embed, form, base, meta[http-equiv]")) {
    node.remove();
  }
  for (const link of document.querySelectorAll("link[rel='stylesheet']")) link.remove();
  for (const image of document.querySelectorAll("img")) {
    const alt = image.getAttribute("alt") || "Изображение snapshot";
    image.removeAttribute("src");
    image.setAttribute("alt", alt);
    image.style.minHeight = "40px";
    image.style.background = "#ececec";
  }
  for (const anchor of document.querySelectorAll("a")) anchor.removeAttribute("href");
  const csp = document.createElement("meta");
  csp.setAttribute("http-equiv", "Content-Security-Policy");
  csp.setAttribute("content", "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:");
  document.head.prepend(csp);
  return `<!doctype html>${document.documentElement.outerHTML}`;
}

function VisualSnapshotPanel({
  label,
  snapshot,
  scale,
}: {
  label: string;
  snapshot: CompareSnapshot;
  scale: VisualScale;
}) {
  const overview = scale === "overview";
  return (
    <Card style={{ display: "grid", gridTemplateRows: "auto minmax(0, 1fr)", gap: 8, minHeight: "calc(100vh - 260px)", overflow: "hidden" }}>
      <SectionHeaderRow
        title={<div>{label}</div>}
        actions={<MetaText opacity={0.68}>{snapshot.status_code} · SEO {snapshot.seo.score}%</MetaText>}
      />
      <div style={{ minHeight: 0, overflow: overview ? "hidden" : "auto", background: "#fff", borderRadius: 8 }}>
        <iframe
          title={`${label}: ${snapshot.url}`}
          sandbox=""
          srcDoc={safeSnapshotDocument(snapshot.html)}
          style={{
            display: "block",
            border: 0,
            background: "#fff",
            width: overview ? 1280 : "100%",
            height: overview ? 1600 : "100%",
            minHeight: overview ? 1600 : 700,
            transform: overview ? "scale(0.58)" : undefined,
            transformOrigin: "top left",
          }}
        />
      </div>
    </Card>
  );
}

export default function ComparePage() {
  const { id } = useParams<{ id: string }>();
  const profileId = Number(id);
  const [sites, setSites] = useState<ProjectSite[]>([]);
  const [left, setLeft] = useState<SideState>(EMPTY_SIDE);
  const [right, setRight] = useState<SideState>(EMPTY_SIDE);
  const [mode, setMode] = useState<CompareMode>("visual");
  const [panelView, setPanelView] = useState<PanelView>("both");
  const [visualScale, setVisualScale] = useState<VisualScale>("overview");
  const [error, setError] = useState("");

  const updateSide = useCallback((key: SideKey, updater: (current: SideState) => SideState) => {
    if (key === "left") setLeft(updater);
    else setRight(updater);
  }, []);

  const selectSite = useCallback(async (key: SideKey, siteId: number) => {
    updateSide(key, () => ({ ...EMPTY_SIDE, siteId, loading: true }));
    try {
      const runs = (await listCompareRuns(siteId)).filter((run) => run.status === "FINISHED");
      const runId = runs[0]?.id ?? null;
      const pages = runId ? await listComparePages(runId) : [];
      updateSide(key, () => ({
        ...EMPTY_SIDE,
        siteId,
        runs,
        runId,
        pages,
        loading: false,
        error: runs.length ? "" : "У сайта пока нет успешных прогонов.",
      }));
    } catch (err) {
      updateSide(key, (current) => ({ ...current, loading: false, error: err instanceof Error ? err.message : "Ошибка загрузки." }));
    }
  }, [updateSide]);

  async function selectRun(key: SideKey, runId: number) {
    updateSide(key, (current) => ({ ...current, runId, pages: [], url: "", snapshot: null, loading: true, error: "" }));
    try {
      const pages = await listComparePages(runId);
      updateSide(key, (current) => ({ ...current, pages, loading: false }));
    } catch (err) {
      updateSide(key, (current) => ({ ...current, loading: false, error: err instanceof Error ? err.message : "Ошибка загрузки." }));
    }
  }

  async function selectPage(key: SideKey, url: string) {
    const side = key === "left" ? left : right;
    if (!side.runId) return;
    updateSide(key, (current) => ({ ...current, url, snapshot: null, loading: true, error: "" }));
    try {
      const snapshot = await getCompareSnapshot(side.runId, url);
      updateSide(key, (current) => ({ ...current, snapshot, loading: false }));
    } catch (err) {
      updateSide(key, (current) => ({ ...current, loading: false, error: err instanceof Error ? err.message : "Snapshot недоступен." }));
    }
  }

  useEffect(() => {
    if (!Number.isFinite(profileId)) return;
    listProjectSites(profileId)
      .then((rows) => {
        setSites(rows);
        const leftSite = rows[0];
        const rightSite = rows[1] || rows[0];
        if (leftSite) void selectSite("left", leftSite.id);
        if (rightSite) void selectSite("right", rightSite.id);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Не удалось загрузить сайты проекта."));
  }, [profileId, selectSite]);

  const diff = useMemo(
    () => left.snapshot && right.snapshot ? buildLineDiff(left.snapshot.html, right.snapshot.html) : [],
    [left.snapshot, right.snapshot],
  );
  const changedLines = diff.filter((line) => line.kind !== "same").length;
  const ready = Boolean(left.snapshot && right.snapshot);
  const rightSuggestion = useMemo(
    () => left.url && right.pages.length ? suggestPageMatch(left.url, right.pages) : null,
    [left.url, right.pages],
  );
  const leftSuggestion = useMemo(
    () => right.url && left.pages.length ? suggestPageMatch(right.url, left.pages) : null,
    [right.url, left.pages],
  );

  return (
    <div style={{ display: "grid", gap: 12, minWidth: 0 }}>
      <SectionHeaderRow
        title={
          <div>
            <h2 style={{ margin: 0 }}>Сравнение страниц</h2>
            <MetaText opacity={0.68}>Выберите любые два snapshots внутри проекта.</MetaText>
          </div>
        }
        actions={
          <SegmentedControl
            value={mode}
            onChange={setMode}
            options={[
              { value: "visual", label: "Визуально" },
              { value: "code", label: "Код" },
              { value: "structure", label: "Структура" },
            ]}
          />
        }
      />
      {error && <StatusText tone="danger">{error}</StatusText>}

      <div className="compare-two-column-grid">
        <SnapshotSelector
          label="Левая сторона"
          sites={sites}
          side={left}
          onSiteChange={(siteId) => void selectSite("left", siteId)}
          onRunChange={(runId) => void selectRun("left", runId)}
          onPageChange={(url) => void selectPage("left", url)}
        />
        <SnapshotSelector
          label="Правая сторона"
          sites={sites}
          side={right}
          onSiteChange={(siteId) => void selectSite("right", siteId)}
          onRunChange={(runId) => void selectRun("right", runId)}
          onPageChange={(url) => void selectPage("right", url)}
        />
      </div>

      {(rightSuggestion || leftSuggestion) && (
        <Card variant="hint" style={{ display: "grid", gap: 8 }}>
          <div style={{ fontWeight: 700 }}>Предложение пары</div>
          {rightSuggestion && rightSuggestion.page.url !== right.url && (
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <div>
                <MetaText>{rightSuggestion.reason}</MetaText>
                <MetaText opacity={0.65}>Справа: {rightSuggestion.page.url} · уверенность {rightSuggestion.confidence === "high" ? "высокая" : "средняя"}</MetaText>
              </div>
              <Button size="sm" variant="primary" onClick={() => void selectPage("right", rightSuggestion.page.url)}>
                Выбрать справа
              </Button>
            </div>
          )}
          {leftSuggestion && leftSuggestion.page.url !== left.url && (
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <div>
                <MetaText>{leftSuggestion.reason}</MetaText>
                <MetaText opacity={0.65}>Слева: {leftSuggestion.page.url} · уверенность {leftSuggestion.confidence === "high" ? "высокая" : "средняя"}</MetaText>
              </div>
              <Button size="sm" variant="primary" onClick={() => void selectPage("left", leftSuggestion.page.url)}>
                Выбрать слева
              </Button>
            </div>
          )}
        </Card>
      )}

      {!ready && <Card variant="hint"><MetaText>Выберите страницу с обеих сторон, чтобы начать сравнение.</MetaText></Card>}

      {ready && (
        <Card style={{ padding: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
            <SegmentedControl
              value={panelView}
              onChange={setPanelView}
              options={[
                { value: "both", label: "Обе" },
                { value: "left", label: "Левая" },
                { value: "right", label: "Правая" },
              ]}
            />
            {mode === "visual" && (
              <SegmentedControl
                value={visualScale}
                onChange={setVisualScale}
                options={[
                  { value: "overview", label: "Обзор" },
                  { value: "detail", label: "Детально" },
                ]}
              />
            )}
          </div>
        </Card>
      )}

      {ready && mode === "visual" && left.snapshot && right.snapshot && (
        <div
          className={panelView === "both" ? "compare-two-column-grid" : undefined}
          style={panelView === "both" ? undefined : { display: "grid", gridTemplateColumns: "minmax(0, 1fr)" }}
        >
          {panelView !== "right" && <VisualSnapshotPanel label="Левая страница" snapshot={left.snapshot} scale={visualScale} />}
          {panelView !== "left" && <VisualSnapshotPanel label="Правая страница" snapshot={right.snapshot} scale={visualScale} />}
        </div>
      )}

      {ready && mode === "code" && (
        <Card style={{ display: "grid", gap: 8, overflow: "hidden" }}>
          <SectionHeaderRow
            title={<div>HTML diff</div>}
            actions={<MetaText opacity={0.68}>Изменённых строк: {changedLines}</MetaText>}
          />
          <div style={{ overflow: "auto", maxHeight: "calc(100vh - 360px)", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12 }}>
            {diff.map((line, index) => (
              <div
                key={`${index}-${line.kind}`}
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                  gap: 1,
                  background: "rgba(255,255,255,0.06)",
                }}
              >
                <pre style={{ margin: 0, padding: "3px 7px", whiteSpace: "pre-wrap", background: line.kind === "removed" ? "rgba(213,85,85,0.16)" : "rgba(0,0,0,0.12)" }}>{line.left || " "}</pre>
                <pre style={{ margin: 0, padding: "3px 7px", whiteSpace: "pre-wrap", background: line.kind === "added" ? "rgba(97,190,130,0.16)" : "rgba(0,0,0,0.12)" }}>{line.right || " "}</pre>
              </div>
            ))}
          </div>
        </Card>
      )}

      {ready && mode === "structure" && left.snapshot && right.snapshot && (
        <Card style={{ display: "grid", gap: 9 }}>
          <SectionHeaderRow
            title={<div>Структурное сравнение</div>}
            actions={<MetaText opacity={0.68}>Отличающиеся значения подсвечены</MetaText>}
          />
          <MetricRow label="HTTP" left={left.snapshot.status_code} right={right.snapshot.status_code} />
          <MetricRow label="Title" left={left.snapshot.meta.title} right={right.snapshot.meta.title} />
          <MetricRow label="Description" left={left.snapshot.meta.description} right={right.snapshot.meta.description} />
          <MetricRow label="Canonical" left={left.snapshot.meta.canonical} right={right.snapshot.meta.canonical} />
          <MetricRow label="SEO score" left={`${left.snapshot.seo.score}%`} right={`${right.snapshot.seo.score}%`} />
          <MetricRow label="Headings" left={left.snapshot.meta.headings.length} right={right.snapshot.meta.headings.length} />
          <MetricRow label="Ссылки" left={left.snapshot.links.total} right={right.snapshot.links.total} />
          <MetricRow label="Битые ссылки" left={left.snapshot.links.known_broken} right={right.snapshot.links.known_broken} />
          <MetricRow label="Изображения" left={left.snapshot.assets.images.total} right={right.snapshot.assets.images.total} />
          <MetricRow label="Без alt" left={left.snapshot.assets.images.missing_alt} right={right.snapshot.assets.images.missing_alt} />
          <MetricRow label="Scripts" left={left.snapshot.assets.scripts.total} right={right.snapshot.assets.scripts.total} />
          <MetricRow label="Styles" left={left.snapshot.assets.styles.total} right={right.snapshot.assets.styles.total} />
        </Card>
      )}
    </div>
  );
}
