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
              actions={<MetaText>{snapshot.status_code} · SEO {snapshot.seo.score}%</MetaText>}
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
              <div style={{ minHeight: 0, overflow: "auto", background: "#fff", borderRadius: 8, marginTop: 8 }}>
                <iframe
                  title={`Snapshot: ${snapshot.url}`}
                  sandbox=""
                  srcDoc={safeSnapshotDocument(snapshot.html)}
                  style={{ display: "block", border: 0, width: "100%", minHeight: 900, background: "#fff" }}
                />
              </div>
            ) : (
              <pre
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
                {snapshot.html || "HTML отсутствует."}
              </pre>
            )}
          </Card>

          <Card className="page-inspector-report" style={{ minHeight: 0, overflowY: "auto", overflowX: "hidden" }}>
            <PageInspectionReport context={context} />
          </Card>
        </div>
      )}
    </div>
  );
}
