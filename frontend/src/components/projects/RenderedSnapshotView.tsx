import { useEffect, useState } from "react";
import {
  createRenderedSnapshot,
  downloadRenderedSnapshot,
  type RenderedSnapshotMetadata,
} from "../../api/compare";
import Button from "../ui/Button";
import Card from "../ui/Card";
import { MetaText, StatusText } from "../ui/StatusText";

export default function RenderedSnapshotView({
  runId,
  url,
  metadata,
  canGenerate,
  onCreated,
  scale = "fit",
}: {
  runId: number;
  url: string;
  metadata: RenderedSnapshotMetadata;
  canGenerate: boolean;
  onCreated: (metadata: RenderedSnapshotMetadata) => void;
  scale?: "fit" | "actual";
}) {
  const [objectUrl, setObjectUrl] = useState("");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!metadata.available) {
      return;
    }
    let cancelled = false;
    let nextObjectUrl = "";
    downloadRenderedSnapshot(runId, url)
      .then((blob) => {
        if (cancelled) return;
        nextObjectUrl = URL.createObjectURL(blob);
        setObjectUrl(nextObjectUrl);
      })
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "Не удалось загрузить снимок.");
      })
    return () => {
      cancelled = true;
      if (nextObjectUrl) URL.revokeObjectURL(nextObjectUrl);
    };
  }, [metadata.available, metadata.captured_at, runId, url]);

  async function handleGenerate() {
    setGenerating(true);
    setError("");
    try {
      onCreated(await createRenderedSnapshot(runId, url));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось создать визуальный снимок.");
    } finally {
      setGenerating(false);
    }
  }

  if (!metadata.available) {
    return (
      <Card variant="hint" style={{ display: "grid", gap: 9, alignContent: "center", minHeight: 240 }}>
        <div style={{ fontWeight: 800 }}>Визуальный снимок ещё не создан</div>
        <MetaText>{metadata.explanation}</MetaText>
        {canGenerate ? (
          <div>
            <Button variant="accent" disabled={generating} onClick={() => void handleGenerate()}>
              {generating ? "Создаём снимок…" : "Создать визуальный снимок"}
            </Button>
          </div>
        ) : (
          <MetaText opacity={0.68}>Создать новый артефакт может пользователь с правом запуска crawler.</MetaText>
        )}
        {error && <StatusText tone="danger">{error}</StatusText>}
      </Card>
    );
  }

  return (
    <div className="rendered-snapshot-shell">
      <Card variant="warning" style={{ padding: 9, display: "grid", gap: 4 }}>
        <MetaText>{metadata.explanation}</MetaText>
        <MetaText opacity={0.65}>
          Размер: {metadata.width || "—"} × {metadata.full_height || metadata.height || "—"}
          {metadata.clipped ? " · очень длинная страница обрезана" : ""}
        </MetaText>
      </Card>
      {!objectUrl && !error && <MetaText>Загружаем сохранённый снимок…</MetaText>}
      {error && <StatusText tone="danger">{error}</StatusText>}
      {objectUrl && (
        <div className={`rendered-snapshot-scroll rendered-snapshot-${scale}`}>
          <img
            src={objectUrl}
            alt={`Визуальный снимок ${url}`}
            style={scale === "actual" && metadata.width ? { width: metadata.width } : undefined}
          />
        </div>
      )}
    </div>
  );
}
