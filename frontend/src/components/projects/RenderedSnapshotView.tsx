import { type MouseEvent, type Ref, type UIEvent, useEffect, useRef, useState } from "react";
import {
  createRenderedSnapshot,
  downloadRenderedSnapshot,
  type RenderedSnapshotElement,
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
  elementPicker = false,
  selectedElement,
  onElementSelected,
  onElementMiss,
  scrollContainerRef,
  onScroll,
}: {
  runId: number;
  url: string;
  metadata: RenderedSnapshotMetadata;
  canGenerate: boolean;
  onCreated: (metadata: RenderedSnapshotMetadata) => void;
  scale?: "fit" | "actual";
  elementPicker?: boolean;
  selectedElement?: RenderedSnapshotElement | null;
  onElementSelected?: (element: RenderedSnapshotElement) => void;
  onElementMiss?: () => void;
  scrollContainerRef?: Ref<HTMLDivElement>;
  onScroll?: (event: UIEvent<HTMLDivElement>) => void;
}) {
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [objectUrl, setObjectUrl] = useState("");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const elements = metadata.element_map?.items || [];
  const canPickElement = elementPicker && elements.length > 0 && !!onElementSelected;

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

  function handleImageClick(event: MouseEvent<HTMLImageElement>) {
    if (!canPickElement) return;
    const image = imageRef.current;
    if (!image) return;
    const bounds = image.getBoundingClientRect();
    const naturalWidth = image.naturalWidth || metadata.width || bounds.width;
    const naturalHeight = image.naturalHeight || metadata.height || bounds.height;
    const x = ((event.clientX - bounds.left) / bounds.width) * naturalWidth;
    const y = ((event.clientY - bounds.top) / bounds.height) * naturalHeight;
    const containing = elements.filter((element) => {
      const rect = element.rect;
      return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
    });
    const nearest = containing.sort((left, right) => {
      const leftArea = left.rect.width * left.rect.height;
      const rightArea = right.rect.width * right.rect.height;
      return leftArea - rightArea;
    })[0];
    if (nearest) {
      onElementSelected?.(nearest);
      return;
    }
    onElementMiss?.();
  }

  const selectedRect = selectedElement?.rect;
  const highlightWidth = imageSize.width || metadata.width || 1;
  const highlightHeight = imageSize.height || metadata.height || metadata.full_height || 1;
  const highlightStyle = selectedRect
    ? {
        left: `${(selectedRect.x / highlightWidth) * 100}%`,
        top: `${(selectedRect.y / highlightHeight) * 100}%`,
        width: `${(selectedRect.width / highlightWidth) * 100}%`,
        height: `${(selectedRect.height / highlightHeight) * 100}%`,
      }
    : undefined;

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
          {metadata.element_map ? ` · блоков для выбора: ${metadata.element_map.items.length}${metadata.element_map.items_truncated ? "+" : ""}` : ""}
        </MetaText>
      </Card>
      {elementPicker && metadata.element_map && (
        <div className="element-picker-hint">
          Кликните по области снимка. Мы выберем самый конкретный HTML-блок под курсором.
        </div>
      )}
      {!objectUrl && !error && <MetaText>Загружаем сохранённый снимок…</MetaText>}
      {error && <StatusText tone="danger">{error}</StatusText>}
      {objectUrl && (
        <div
          ref={scrollContainerRef}
          onScroll={onScroll}
          className={`rendered-snapshot-scroll rendered-snapshot-${scale}${canPickElement ? " rendered-snapshot-picker-enabled" : ""}`}
        >
          <div className="rendered-snapshot-image-wrap">
            <img
              ref={imageRef}
              src={objectUrl}
              alt={`Визуальный снимок ${url}`}
              onClick={handleImageClick}
              onLoad={(event) => {
                setImageSize({
                  width: event.currentTarget.naturalWidth,
                  height: event.currentTarget.naturalHeight,
                });
              }}
              style={scale === "actual" && metadata.width ? { width: metadata.width } : undefined}
            />
            {highlightStyle && <div className="rendered-snapshot-element-highlight" style={highlightStyle} />}
          </div>
        </div>
      )}
    </div>
  );
}
