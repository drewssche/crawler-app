import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { getCompareSnapshot, type CompareSnapshot } from "../api/compare";
import { getPageContext, type PageContext } from "../api/pageContext";
import PageInspectionReport from "../components/projects/PageInspectionReport";
import Card from "../components/ui/Card";
import SectionHeaderRow from "../components/ui/SectionHeaderRow";
import SegmentedControl from "../components/ui/SegmentedControl";
import { MetaText, StatusText } from "../components/ui/StatusText";
import { safeSnapshotDocument } from "../utils/safeSnapshotDocument";
import RenderedSnapshotView from "../components/projects/RenderedSnapshotView";
import { useAuth } from "../hooks/auth";
import { hasPermission } from "../utils/permissions";

type InspectorMode = "snapshot" | "dom" | "code";

type PickedElement = {
  tag: string;
  id: string;
  className: string;
  selector: string;
  text: string;
  outerHTML: string;
  rect: { x: number; y: number; width: number; height: number };
};

function highlightedHtml(html: string, selected?: PickedElement | null): string {
  if (!selected?.outerHTML) return html || "HTML отсутствует.";
  const index = html.indexOf(selected.outerHTML);
  if (index === -1) return html || "HTML отсутствует.";
  return `${html.slice(0, index)}__CRAWLER_PICK_START__${html.slice(index, index + selected.outerHTML.length)}__CRAWLER_PICK_END__${html.slice(index + selected.outerHTML.length)}`;
}

export default function PageInspectorPage() {
  const { user } = useAuth();
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const runId = Number(searchParams.get("run"));
  const url = searchParams.get("url") || "";
  const [mode, setMode] = useState<InspectorMode>("snapshot");
  const [snapshot, setSnapshot] = useState<CompareSnapshot | null>(null);
  const [context, setContext] = useState<PageContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [elementPickerEnabled, setElementPickerEnabled] = useState(false);
  const [pickedElement, setPickedElement] = useState<PickedElement | null>(null);
  const invalidSelection = !Number.isFinite(runId) || runId <= 0 || !url;
  const visibleError = invalidSelection ? "Не выбран прогон или URL страницы." : error;
  const canGenerateSnapshot = hasPermission(user?.role, "crawler.run");

  useEffect(() => {
    if (invalidSelection) return;
    let cancelled = false;
    const startTimer = window.setTimeout(() => {
      if (cancelled) return;
      setLoading(true);
      setError("");
      Promise.all([getCompareSnapshot(runId, url), getPageContext(runId, url)])
        .then(([nextSnapshot, nextContext]) => {
          if (cancelled) return;
          setSnapshot(nextSnapshot);
          setContext(nextContext);
        })
        .catch((reason) => {
          if (cancelled) return;
          setError(reason instanceof Error ? reason.message : "Не удалось загрузить анализ страницы.");
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(startTimer);
    };
  }, [invalidSelection, runId, url]);

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.data?.type !== "crawler:element-selected") return;
      const payload = event.data.payload as PickedElement;
      if (!payload?.outerHTML || !payload?.selector) return;
      setPickedElement(payload);
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  return (
    <div style={{ display: "grid", gridTemplateRows: "auto minmax(0, 1fr)", gap: 10, height: "100%", minHeight: 0 }}>
      <SectionHeaderRow
        title={
          <div style={{ minWidth: 0 }}>
            <h2 style={{ margin: 0 }}>Анализ страницы</h2>
            <MetaText opacity={0.68} style={{ wordBreak: "break-word" }}>
              Страница проекта #{id} · {url}
            </MetaText>
          </div>
        }
        actions={
          <SegmentedControl
            value={mode}
            onChange={setMode}
            options={[
              { value: "snapshot", label: "Снимок" },
              { value: "dom", label: "DOM" },
              { value: "code", label: "Код" },
            ]}
          />
        }
        style={{ alignItems: "flex-start", flexWrap: "wrap" }}
      />

      {!invalidSelection && loading && <Card variant="hint"><MetaText>Загружаем snapshot и диагностику страницы...</MetaText></Card>}
      {visibleError && <StatusText tone="danger">{visibleError}</StatusText>}

      {!invalidSelection && !loading && !visibleError && snapshot && context && (
        <div className="page-inspector-grid">
          <Card style={{ minHeight: 0, overflow: "hidden", display: "grid", gridTemplateRows: "auto minmax(0, 1fr)" }}>
            <SectionHeaderRow
              title={
                <div>
                  {mode === "snapshot"
                    ? "Визуальный снимок"
                    : mode === "dom"
                      ? "Безопасный DOM"
                      : "Сохранённый HTML"}
                </div>
              }
              actions={
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  {mode === "dom" && (
                    <button
                      type="button"
                      className={`element-picker-toggle${elementPickerEnabled ? " is-active" : ""}`}
                      onClick={() => setElementPickerEnabled((current) => !current)}
                    >
                      {elementPickerEnabled ? "Выбор блока включён" : "Выбрать блок"}
                    </button>
                  )}
                  <MetaText>{snapshot.status_code} · SEO {snapshot.seo.score}%</MetaText>
                </div>
              }
            />
            {mode === "snapshot" ? (
              <RenderedSnapshotView
                key={`${snapshot.run_id}-${snapshot.url}`}
                runId={snapshot.run_id}
                url={snapshot.url}
                metadata={snapshot.rendered_snapshot}
                canGenerate={canGenerateSnapshot}
                onCreated={(metadata) => setSnapshot((current) => current ? { ...current, rendered_snapshot: metadata } : current)}
              />
            ) : mode === "dom" ? (
              <div className="element-picker-dom-shell">
                {elementPickerEnabled && (
                  <div className="element-picker-hint">
                    Наведите на блок в DOM-снимке и кликните, чтобы увидеть HTML этого элемента.
                  </div>
                )}
                <iframe
                  title={`Snapshot: ${snapshot.url}`}
                  sandbox="allow-scripts"
                  srcDoc={safeSnapshotDocument(snapshot.html, { elementPicker: elementPickerEnabled })}
                  style={{ display: "block", border: 0, width: "100%", minHeight: 900, background: "#fff" }}
                />
              </div>
            ) : (
              <pre
                className="page-code-view"
                style={{
                  margin: "8px 0 0",
                  padding: 12,
                  minHeight: 0,
                  overflow: "auto",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  background: "rgba(0,0,0,0.24)",
                  borderRadius: 8,
                  fontSize: 12,
                }}
              >
                {highlightedHtml(snapshot.html || "", pickedElement).split(/(__CRAWLER_PICK_START__|__CRAWLER_PICK_END__)/).map((part, index, parts) => {
                  if (part === "__CRAWLER_PICK_START__" || part === "__CRAWLER_PICK_END__") return null;
                  const selected = parts[index - 1] === "__CRAWLER_PICK_START__";
                  return selected
                    ? <mark key={index} className="page-code-selected-fragment">{part}</mark>
                    : part;
                })}
              </pre>
            )}
          </Card>

          <Card className="page-inspector-report" style={{ minHeight: 0, overflowY: "auto", overflowX: "hidden" }}>
            {pickedElement && (
              <Card className="element-picker-card" variant="hint">
                <SectionHeaderRow
                  title={<div>Выбранный блок</div>}
                  actions={
                    <button
                      type="button"
                      className="element-picker-toggle"
                      onClick={() => setMode("code")}
                    >
                      Показать в коде
                    </button>
                  }
                />
                <MetaText>Элемент: &lt;{pickedElement.tag}&gt;</MetaText>
                <MetaText style={{ wordBreak: "break-word" }}>Selector: {pickedElement.selector}</MetaText>
                {pickedElement.id && <MetaText>ID: {pickedElement.id}</MetaText>}
                {pickedElement.className && <MetaText style={{ wordBreak: "break-word" }}>Classes: {pickedElement.className}</MetaText>}
                <MetaText>
                  Область: {pickedElement.rect.width}×{pickedElement.rect.height}px · x:{pickedElement.rect.x}, y:{pickedElement.rect.y}
                </MetaText>
                <details className="inspector-details">
                  <summary>HTML выбранного блока</summary>
                  <pre className="element-picker-html">{pickedElement.outerHTML}</pre>
                </details>
                {pickedElement.text && (
                  <details className="inspector-details">
                    <summary>Текст блока</summary>
                    <MetaText style={{ marginTop: 7, whiteSpace: "pre-wrap" }}>{pickedElement.text}</MetaText>
                  </details>
                )}
              </Card>
            )}
            <PageInspectionReport context={context} />
          </Card>
        </div>
      )}
    </div>
  );
}
