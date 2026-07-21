import { type Ref, type UIEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import {
  getCompareSnapshot,
  listComparePages,
  listCompareRuns,
  type ComparePageItem,
  type CompareRun,
  type CompareSnapshot,
  type RenderedSnapshotElement,
} from "../api/compare";
import { listProjectSites, type ProjectSite } from "../api/projectSites";
import Card from "../components/ui/Card";
import SegmentedControl from "../components/ui/SegmentedControl";
import SectionHeaderRow from "../components/ui/SectionHeaderRow";
import { MetaText, StatusText } from "../components/ui/StatusText";
import UiSelect from "../components/ui/UiSelect";
import { formatOperationalDateTime, formatRunTitle } from "../utils/datetime";
import { buildLineDiff } from "../utils/codeDiff";
import { suggestPageMatch } from "../utils/pageMatch";
import Button from "../components/ui/Button";
import { getPageContext, type PageContext } from "../api/pageContext";
import { checkMonitoringTarget, createMonitoringTarget, type MonitoringTarget } from "../api/monitoringTargets";
import PageInspectionReport from "../components/projects/PageInspectionReport";
import { getProjectRunBadgeMeta } from "../components/ui/projectRunBadgeMeta";
import RenderedSnapshotView from "../components/projects/RenderedSnapshotView";
import { useAuth } from "../hooks/auth";
import { hasPermission } from "../utils/permissions";

type CompareMode = "visual" | "code" | "structure";
type SideKey = "left" | "right";
type PanelView = "both" | "left" | "right";
type VisualScale = "overview" | "detail";
type CompareWorkspaceHeight = "compact" | "comfortable" | "tall";
type ComparePickedElement = RenderedSnapshotElement & { side: SideKey };
type BlockFingerprint = {
  tag: string;
  classCount: number;
  childCount: number;
  linkCount: number;
  imageCount: number;
  headingCount: number;
  textLength: number;
  signature: string;
};
type BlockMatchSuggestion = {
  side: SideKey;
  element: ComparePickedElement;
  score: number;
  reason: string;
};

const PAGE_PICKER_LIMIT = 80;
const COMPARE_SYNC_SCROLL_STORAGE_KEY = "crawler.compare.syncScroll";
const COMPARE_WORKSPACE_HEIGHT_STORAGE_KEY = "crawler.compare.workspaceHeight";
const COMPARE_WORKSPACE_HEIGHTS = new Set<CompareWorkspaceHeight>(["compact", "comfortable", "tall"]);

type SideState = {
  siteId: number | null;
  runs: CompareRun[];
  personaFilterId: number | "all";
  runId: number | null;
  pages: ComparePageItem[];
  pageQuery: string;
  url: string;
  snapshot: CompareSnapshot | null;
  context: PageContext | null;
  loading: boolean;
  error: string;
};

const EMPTY_SIDE: SideState = {
  siteId: null,
  runs: [],
  personaFilterId: "all",
  runId: null,
  pages: [],
  pageQuery: "",
  url: "",
  snapshot: null,
  context: null,
  loading: false,
  error: "",
};

function SnapshotSelector({
  label,
  sites,
  side,
  suggestedUrl,
  onSiteChange,
  onPersonaFilterChange,
  onRunChange,
  onPageQueryChange,
  onPageChange,
}: {
  label: string;
  sites: ProjectSite[];
  side: SideState;
  suggestedUrl?: string | null;
  onSiteChange: (siteId: number) => void;
  onPersonaFilterChange: (personaId: number | "all") => void;
  onRunChange: (runId: number) => void;
  onPageQueryChange: (query: string) => void;
  onPageChange: (url: string) => void;
}) {
  const normalizedQuery = side.pageQuery.trim().toLowerCase();
  const filteredPages = normalizedQuery
    ? side.pages.filter((page) => {
        const haystack = `${page.url} ${page.title || ""} ${page.status_code}`.toLowerCase();
        return haystack.includes(normalizedQuery);
      })
    : side.pages;
  const visiblePages = filteredPages.slice(0, PAGE_PICKER_LIMIT);
  const selectedPage = side.pages.find((page) => page.url === side.url);
  const personaOptions = Array.from(
    new Map(
      side.runs.map((run) => {
        const persona = run.persona || { id: 0, key: "guest", label: "Гость", kind: "guest" };
        return [persona.id, persona] as const;
      }),
    ).values(),
  );
  const visibleRuns = side.personaFilterId === "all"
    ? side.runs
    : side.runs.filter((run) => (run.persona?.id || 0) === side.personaFilterId);

  return (
    <Card className="compare-selector-card">
      <SectionHeaderRow
        title={<div style={{ fontWeight: 800 }}>{label}</div>}
        actions={
          side.loading
            ? <CompareLoadingDot label="Загрузка" />
            : side.url ? <StatusText tone="success">Страница выбрана</StatusText> : <MetaText>Шаг 1</MetaText>
        }
      />
      <MetaText opacity={0.68}>1 · Сайт</MetaText>
      <UiSelect
        value={side.siteId ?? ""}
        onChange={(event) => onSiteChange(Number(event.target.value))}
        style={{ width: "100%" }}
      >
        <option value="" disabled>Выберите сайт</option>
        {sites.map((site) => <option key={site.id} value={site.id}>{site.name} · {site.start_url}</option>)}
      </UiSelect>
      <div className="compare-chip-step">
        <MetaText opacity={0.68}>2 · Контекст доступа</MetaText>
        <div className="compare-chip-row" aria-label={`${label}: контекст доступа`}>
          <Button
            size="sm"
            variant="ghost"
            active={side.personaFilterId === "all"}
            disabled={side.runs.length === 0}
            onClick={() => onPersonaFilterChange("all")}
          >
            Все контексты доступа
          </Button>
          {personaOptions.map((persona) => (
            <Button
              key={persona.id}
              size="sm"
              variant="ghost"
              active={side.personaFilterId === persona.id}
              disabled={side.runs.length === 0}
              onClick={() => onPersonaFilterChange(persona.id)}
            >
              {persona.label}
            </Button>
          ))}
        </div>
      </div>
      <MetaText opacity={0.68}>3 · Версия</MetaText>
      <UiSelect
        value={side.runId ?? ""}
        onChange={(event) => onRunChange(Number(event.target.value))}
        disabled={visibleRuns.length === 0}
        style={{ width: "100%" }}
      >
        <option value="" disabled>Выберите версию</option>
        {visibleRuns.map((run) => (
          <option key={run.id} value={run.id}>
            {formatRunTitle(run.started_at)} · {run.persona?.label || "Гость"} · {getProjectRunBadgeMeta(run.status).label} · {formatOperationalDateTime(run.finished_at || run.started_at)}
          </option>
        ))}
      </UiSelect>
      {side.personaFilterId !== "all" && visibleRuns.length === 0 && (
        <MetaText opacity={0.68}>У выбранного контекста пока нет успешных версий для сравнения.</MetaText>
      )}

      <div className="compare-page-picker" aria-label={`${label}: выбор страницы`}>
        <MetaText opacity={0.68}>4 · Страница</MetaText>
        <input
          value={side.pageQuery}
          onChange={(event) => onPageQueryChange(event.target.value)}
          disabled={side.pages.length === 0}
          placeholder={side.pages.length ? "Поиск страницы по URL, title или HTTP..." : "Сначала выберите версию"}
          className="compare-page-search"
        />
        <div className="compare-page-picker-meta">
          <MetaText opacity={0.68}>
            {side.pages.length
              ? `Найдено: ${filteredPages.length} из ${side.pages.length}`
              : "Страницы появятся после выбора успешного прогона."}
          </MetaText>
          {filteredPages.length > PAGE_PICKER_LIMIT && (
            <MetaText opacity={0.62}>Показаны первые {PAGE_PICKER_LIMIT}. Уточните поиск.</MetaText>
          )}
        </div>
        {selectedPage && (
          <div className="compare-selected-page">
            <MetaText opacity={0.68}>Выбрано</MetaText>
            <div>{selectedPage.title || selectedPage.url}</div>
            {selectedPage.title && <MetaText opacity={0.62}>{selectedPage.url}</MetaText>}
          </div>
        )}
        <div className="compare-page-results" role="listbox" aria-label="Найденные страницы">
          {visiblePages.map((page) => (
            <button
              key={page.id}
              type="button"
              className={[
                "compare-page-result",
                page.url === side.url ? "is-selected" : "",
                suggestedUrl && page.url === suggestedUrl && page.url !== side.url ? "is-auto-suggested" : "",
              ].filter(Boolean).join(" ")}
              onClick={() => onPageChange(page.url)}
            >
              <span className="compare-page-result-main">{page.title || page.url}</span>
              {page.title && <span className="compare-page-result-url">{page.url}</span>}
              <span className="compare-page-result-meta">
                {suggestedUrl && page.url === suggestedUrl && page.url !== side.url ? "Автоподбор · " : ""}
                HTTP {page.status_code}
              </span>
            </button>
          ))}
          {side.pages.length > 0 && visiblePages.length === 0 && (
            <MetaText>По этому запросу страниц не найдено.</MetaText>
          )}
        </div>
      </div>
      {side.loading && (
        <MetaText style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
          <span className="compare-loading-dot" aria-hidden />
          Загружаем данные этой стороны...
        </MetaText>
      )}
      {side.error && <StatusText tone="danger">{side.error}</StatusText>}
    </Card>
  );
}

function CompareLoadingDot({ label = "Загрузка" }: { label?: string }) {
  return (
    <span className="compare-loading-inline" role="status" aria-label={label}>
      <span className="compare-loading-dot" aria-hidden />
      <span>{label}</span>
    </span>
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

function countMatches(source: string, pattern: RegExp): number {
  return source.match(pattern)?.length || 0;
}

function buildBlockFingerprint(element: RenderedSnapshotElement | null): BlockFingerprint | null {
  if (!element) return null;
  const html = element.outerHTML || "";
  const tagMatches = html.match(/<([a-zA-Z][\w:-]*)\b/g) || [];
  const classTokens = element.className.split(/\s+/).filter(Boolean);
  const childCount = Math.max(0, tagMatches.length - 1);
  const linkCount = countMatches(html, /<a\b/gi);
  const imageCount = countMatches(html, /<img\b|<picture\b|<source\b/gi);
  const headingCount = countMatches(html, /<h[1-6]\b/gi);
  return {
    tag: element.tag,
    classCount: classTokens.length,
    childCount,
    linkCount,
    imageCount,
    headingCount,
    textLength: element.text.length,
    signature: [
      element.tag,
      `classes:${classTokens.length}`,
      `children:${childCount}`,
      `links:${linkCount}`,
      `images:${imageCount}`,
      `headings:${headingCount}`,
    ].join(" · "),
  };
}

function scoreDelta(leftValue: number, rightValue: number, weight: number): number {
  const maxValue = Math.max(leftValue, rightValue, 1);
  return Math.max(0, weight - (Math.abs(leftValue - rightValue) / maxValue) * weight);
}

function blockSimilarity(left: BlockFingerprint | null, right: BlockFingerprint | null): number | null {
  if (!left || !right) return null;
  let score = 0;
  score += left.tag === right.tag ? 30 : 0;
  score += scoreDelta(left.classCount, right.classCount, 12);
  score += scoreDelta(left.childCount, right.childCount, 18);
  score += scoreDelta(left.linkCount, right.linkCount, 10);
  score += scoreDelta(left.imageCount, right.imageCount, 10);
  score += scoreDelta(left.headingCount, right.headingCount, 8);
  score += scoreDelta(left.textLength, right.textLength, 12);
  return Math.round(Math.max(0, Math.min(100, score)));
}

function sideLabel(side: SideKey): string {
  return side === "left" ? "слева" : "справа";
}

function suggestMatchingBlock({
  source,
  candidates,
  targetSide,
}: {
  source: ComparePickedElement | null;
  candidates: RenderedSnapshotElement[];
  targetSide: SideKey;
}): BlockMatchSuggestion | null {
  if (!source || candidates.length === 0) return null;
  const sourceFingerprint = buildBlockFingerprint(source);
  const ranked = candidates
    .map((candidate) => {
      const candidateFingerprint = buildBlockFingerprint(candidate);
      const score = blockSimilarity(sourceFingerprint, candidateFingerprint) || 0;
      const selectorBonus = source.selector && source.selector === candidate.selector ? 12 : 0;
      const tagBonus = source.tag === candidate.tag ? 8 : 0;
      return {
        element: { ...candidate, side: targetSide },
        score: Math.min(100, score + selectorBonus + tagBonus),
      };
    })
    .sort((leftCandidate, rightCandidate) => rightCandidate.score - leftCandidate.score);
  const best = ranked[0];
  if (!best || best.score < 55) return null;
  return {
    ...best,
    side: targetSide,
    reason: `Похожесть ${best.score}% по tag/classes/children/links/images/headings/text length.`,
  };
}

function FingerprintRow({
  label,
  left,
  right,
}: {
  label: string;
  left: string | number;
  right: string | number;
}) {
  const different = String(left) !== String(right);
  return (
    <div className={`compare-fingerprint-row${different ? " is-different" : ""}`}>
      <MetaText opacity={0.68}>{label}</MetaText>
      <div>{left}</div>
      <div>{right}</div>
    </div>
  );
}

function VisualSnapshotPanel({
  label,
  snapshot,
  scale,
  canGenerate,
  blockPickerEnabled,
  selectedElement,
  scrollContainerRef,
  onSnapshotScroll,
  onElementSelected,
  onElementMiss,
  onRenderedSnapshotCreated,
}: {
  label: string;
  snapshot: CompareSnapshot;
  scale: VisualScale;
  canGenerate: boolean;
  blockPickerEnabled: boolean;
  selectedElement: ComparePickedElement | null;
  scrollContainerRef?: Ref<HTMLDivElement>;
  onSnapshotScroll?: (event: UIEvent<HTMLDivElement>) => void;
  onElementSelected: (element: RenderedSnapshotElement) => void;
  onElementMiss: () => void;
  onRenderedSnapshotCreated: (metadata: CompareSnapshot["rendered_snapshot"]) => void;
}) {
  return (
    <Card className="compare-visual-panel">
      <SectionHeaderRow
        title={<div>{label}</div>}
        actions={<MetaText opacity={0.68}>{snapshot.persona?.label || "Гость"} · {snapshot.status_code} · SEO {snapshot.seo.score}%</MetaText>}
      />
      <RenderedSnapshotView
        key={`${snapshot.run_id}-${snapshot.url}`}
        runId={snapshot.run_id}
        url={snapshot.url}
        metadata={snapshot.rendered_snapshot}
        canGenerate={canGenerate}
        scale={scale === "overview" ? "fit" : "actual"}
        elementPicker={blockPickerEnabled}
        selectedElement={selectedElement}
        scrollContainerRef={scrollContainerRef}
        onScroll={onSnapshotScroll}
        onElementSelected={onElementSelected}
        onElementMiss={onElementMiss}
        onCreated={onRenderedSnapshotCreated}
      />
    </Card>
  );
}

function SelectedBlockCard({
  label,
  element,
  onReset,
  onSaveTarget,
  savingTarget,
}: {
  label: string;
  element: ComparePickedElement | null;
  onReset: () => void;
  onSaveTarget?: () => void;
  savingTarget?: boolean;
}) {
  return (
    <Card variant={element ? "hint" : "default"} style={{ display: "grid", gap: 7 }}>
      <SectionHeaderRow
        title={<div>{label}</div>}
        actions={element && (
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            {onSaveTarget && (
              <button type="button" className="element-picker-toggle" disabled={savingTarget} onClick={onSaveTarget}>
                {savingTarget ? "Сохраняем..." : "Отслеживать блок"}
              </button>
            )}
            <button type="button" className="element-picker-toggle" onClick={onReset}>
              Сбросить
            </button>
          </div>
        )}
      />
      {!element && (
        <MetaText opacity={0.68}>Блок ещё не выбран. Включите выбор и кликните нужную область на snapshot.</MetaText>
      )}
      {element && (
        <>
          <MetaText>Элемент: &lt;{element.tag}&gt;</MetaText>
          <MetaText style={{ wordBreak: "break-word" }}>Selector: {element.selector}</MetaText>
          <MetaText>
            Область: {element.rect.width}×{element.rect.height}px · x:{element.rect.x}, y:{element.rect.y}
          </MetaText>
          {element.text && <MetaText style={{ whiteSpace: "pre-wrap" }}>{element.text.slice(0, 240)}</MetaText>}
        </>
      )}
    </Card>
  );
}

function SelectedBlockCompare({
  left,
  right,
  onReset,
  onResetAll,
  onSaveTarget,
  savingTargetSide,
}: {
  left: ComparePickedElement | null;
  right: ComparePickedElement | null;
  onReset: (side: SideKey) => void;
  onResetAll: () => void;
  onSaveTarget: (side: SideKey) => void;
  savingTargetSide: SideKey | null;
}) {
  const blockDiff = useMemo(
    () => left && right ? buildLineDiff(left.outerHTML, right.outerHTML, 220) : [],
    [left, right],
  );
  const textDiff = useMemo(
    () => left && right ? buildLineDiff(left.text || "", right.text || "", 120) : [],
    [left, right],
  );
  const sameTag = Boolean(left && right && left.tag === right.tag);
  const sameSelector = Boolean(left && right && left.selector === right.selector);
  const leftFingerprint = useMemo(() => buildBlockFingerprint(left), [left]);
  const rightFingerprint = useMemo(() => buildBlockFingerprint(right), [right]);
  const similarity = useMemo(() => blockSimilarity(leftFingerprint, rightFingerprint), [leftFingerprint, rightFingerprint]);
  const changedBlockLines = blockDiff.filter((line) => line.kind !== "same").length;
  const nextStep = !left && !right
    ? "Выберите блок слева и справа."
    : !left
      ? "Теперь выберите блок слева."
      : !right
        ? "Теперь выберите блок справа."
        : "Оба блока выбраны — можно смотреть diff и fingerprint.";

  return (
    <Card className="compare-selected-blocks" style={{ display: "grid", gap: 10 }}>
      <SectionHeaderRow
        title={<div>Сравнение выбранных блоков</div>}
        actions={
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <MetaText opacity={0.68}>{left && right ? `Изменённых HTML-строк: ${changedBlockLines}` : nextStep}</MetaText>
            {(left || right) && (
              <button type="button" className="element-picker-toggle" onClick={onResetAll}>
                Очистить оба блока
              </button>
            )}
          </div>
        }
      />
      <MetaText opacity={0.72}>
        Это ручное сравнение конкретных областей страницы. Оно не пытается само угадать соответствующий блок.
      </MetaText>
      {(!left || !right) && <StatusText tone="muted">{nextStep}</StatusText>}
      <div className="compare-two-column-grid">
        <SelectedBlockCard
          label="Блок слева"
          element={left}
          onReset={() => onReset("left")}
          onSaveTarget={() => onSaveTarget("left")}
          savingTarget={savingTargetSide === "left"}
        />
        <SelectedBlockCard
          label="Блок справа"
          element={right}
          onReset={() => onReset("right")}
          onSaveTarget={() => onSaveTarget("right")}
          savingTarget={savingTargetSide === "right"}
        />
      </div>
      {left && right && !sameTag && (
        <StatusText tone="warning">Выбраны разные HTML-теги: &lt;{left.tag}&gt; слева и &lt;{right.tag}&gt; справа. Сравнение возможно, но структурно блоки могут быть не парой.</StatusText>
      )}
      {similarity !== null && similarity < 55 && (
        <StatusText tone="warning">Структурная похожесть низкая: {similarity}%. Возможно, выбраны разные по смыслу блоки.</StatusText>
      )}
      {left && right && sameTag && !sameSelector && (
        <StatusText tone="warning">Selector отличается. Это нормально для разных сайтов, но проверьте, что выбраны смыслово одинаковые блоки.</StatusText>
      )}
      {left && right && (
        <div style={{ display: "grid", gap: 10 }}>
          {leftFingerprint && rightFingerprint && (
            <details className="inspector-details" open>
              <summary>Structural fingerprint выбранных блоков</summary>
              <MetaText opacity={0.68} style={{ marginTop: 7 }}>
                Похожесть: {similarity}% · это техническая подсказка по структуре, а не автоматическое решение, что блоки являются парой.
              </MetaText>
              <div className="compare-fingerprint-table">
                <FingerprintRow label="Tag" left={leftFingerprint.tag} right={rightFingerprint.tag} />
                <FingerprintRow label="Classes" left={leftFingerprint.classCount} right={rightFingerprint.classCount} />
                <FingerprintRow label="Children" left={leftFingerprint.childCount} right={rightFingerprint.childCount} />
                <FingerprintRow label="Links" left={leftFingerprint.linkCount} right={rightFingerprint.linkCount} />
                <FingerprintRow label="Images" left={leftFingerprint.imageCount} right={rightFingerprint.imageCount} />
                <FingerprintRow label="Headings" left={leftFingerprint.headingCount} right={rightFingerprint.headingCount} />
                <FingerprintRow label="Text length" left={leftFingerprint.textLength} right={rightFingerprint.textLength} />
              </div>
              <MetaText opacity={0.58} style={{ marginTop: 7, wordBreak: "break-word" }}>
                Сигнатуры: Л — {leftFingerprint.signature}; П — {rightFingerprint.signature}
              </MetaText>
            </details>
          )}
          <div>
            <div style={{ fontWeight: 800, marginBottom: 6 }}>HTML выбранных блоков</div>
            <div className="compare-block-diff">
              {blockDiff.map((line, index) => (
                <div key={`${index}-${line.kind}`} className="compare-block-diff-row">
                  <pre className={line.kind === "removed" ? "is-removed" : ""}>{line.left || " "}</pre>
                  <pre className={line.kind === "added" ? "is-added" : ""}>{line.right || " "}</pre>
                </div>
              ))}
            </div>
          </div>
          <details className="inspector-details">
            <summary>Текстовый diff выбранных блоков</summary>
            <div className="compare-block-diff" style={{ marginTop: 8 }}>
              {textDiff.map((line, index) => (
                <div key={`${index}-${line.kind}`} className="compare-block-diff-row">
                  <pre className={line.kind === "removed" ? "is-removed" : ""}>{line.left || " "}</pre>
                  <pre className={line.kind === "added" ? "is-added" : ""}>{line.right || " "}</pre>
                </div>
              ))}
            </div>
          </details>
        </div>
      )}
    </Card>
  );
}

function BlockMatchSuggestionCard({
  suggestion,
  onApply,
}: {
  suggestion: BlockMatchSuggestion | null;
  onApply: (suggestion: BlockMatchSuggestion) => void;
}) {
  if (!suggestion) {
    return (
      <Card variant="default" style={{ display: "grid", gap: 6 }}>
        <div style={{ fontWeight: 800 }}>Предложение похожего блока</div>
        <MetaText opacity={0.68}>
          Пока нет надёжного предложения. Выберите блок вручную на второй стороне или пересоздайте snapshot с картой элементов.
        </MetaText>
      </Card>
    );
  }
  return (
    <Card variant="hint" style={{ display: "grid", gap: 7 }}>
      <SectionHeaderRow
        title={<div>Предложение похожего блока</div>}
        actions={
          <Button size="sm" variant="primary" onClick={() => onApply(suggestion)}>
            Применить {sideLabel(suggestion.side)}
          </Button>
        }
      />
      <StatusText tone={suggestion.score >= 75 ? "success" : "warning"}>
        Найден кандидат {sideLabel(suggestion.side)} · похожесть {suggestion.score}%
      </StatusText>
      <MetaText>{suggestion.reason}</MetaText>
      <MetaText style={{ wordBreak: "break-word" }}>Selector: {suggestion.element.selector}</MetaText>
      <MetaText>
        Область: {suggestion.element.rect.width}×{suggestion.element.rect.height}px · x:{suggestion.element.rect.x}, y:{suggestion.element.rect.y}
      </MetaText>
      {suggestion.element.text && (
        <MetaText style={{ whiteSpace: "pre-wrap" }}>{suggestion.element.text.slice(0, 220)}</MetaText>
      )}
    </Card>
  );
}

function PageInfoPanel({
  label,
  context,
  side,
}: {
  label: string;
  context: PageContext | null;
  side: SideKey;
}) {
  return (
    <Card className={`compare-side-report compare-side-report-${side}`}>
      <div style={{ display: "grid", gap: 9 }}>
        <div>
          <div style={{ fontWeight: 800 }}>{label}</div>
          <MetaText opacity={0.68}>
            Относится только к {side === "left" ? "левой" : "правой"} выбранной странице.
          </MetaText>
        </div>
        {!context && <MetaText>Загружаем диагностику страницы...</MetaText>}
        {context && <PageInspectionReport context={context} idPrefix={`compare-${side}-inspector`} />}
      </div>
    </Card>
  );
}

function DifferenceRow({
  label,
  left,
  right,
}: {
  label: string;
  left: string | number;
  right: string | number;
}) {
  const different = String(left) !== String(right);
  return (
    <Card variant={different ? "warning" : "default"} style={{ display: "grid", gap: 4 }}>
      <MetaText opacity={0.68}>{label}</MetaText>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 12 }}>
        <div style={{ wordBreak: "break-word" }}>Л: {left || "—"}</div>
        <div style={{ wordBreak: "break-word" }}>П: {right || "—"}</div>
      </div>
    </Card>
  );
}

function onlyOnSide(left: string[], right: string[]) {
  const rightSet = new Set(right);
  return left.filter((value) => !rightSet.has(value));
}

function PageInspectionDifferences({
  left,
  right,
}: {
  left: PageContext;
  right: PageContext;
}) {
  const leftIds = left.tracking.identifiers.map((item) => item.id);
  const rightIds = right.tracking.identifiers.map((item) => item.id);
  const leftOnlyIds = onlyOnSide(leftIds, rightIds);
  const rightOnlyIds = onlyOnSide(rightIds, leftIds);
  const leftOnlyCookies = onlyOnSide(left.tracking.cookies.names, right.tracking.cookies.names);
  const rightOnlyCookies = onlyOnSide(right.tracking.cookies.names, left.tracking.cookies.names);
  const leftOnlyCmp = onlyOnSide(left.tracking.consent.frameworks, right.tracking.consent.frameworks);
  const rightOnlyCmp = onlyOnSide(right.tracking.consent.frameworks, left.tracking.consent.frameworks);
  const hasTrackingDifferences =
    leftOnlyIds.length > 0 ||
    rightOnlyIds.length > 0 ||
    leftOnlyCookies.length > 0 ||
    rightOnlyCookies.length > 0 ||
    leftOnlyCmp.length > 0 ||
    rightOnlyCmp.length > 0;

  return (
    <div style={{ display: "grid", gap: 14, paddingBottom: 24 }}>
      <div>
        <div style={{ fontWeight: 800, marginBottom: 7 }}>Сводка различий</div>
        <div style={{ display: "grid", gap: 6 }}>
          <DifferenceRow label="HTTP" left={left.page.final_status_code} right={right.page.final_status_code} />
          <DifferenceRow label="Title" left={left.meta.title} right={right.meta.title} />
          <DifferenceRow label="Canonical" left={left.meta.canonical} right={right.meta.canonical} />
          <DifferenceRow label="SEO score" left={`${left.seo.score}%`} right={`${right.seo.score}%`} />
        </div>
      </div>

      <div>
        <div style={{ fontWeight: 800, marginBottom: 7 }}>Ссылки и ассеты</div>
        <div style={{ display: "grid", gap: 6 }}>
          <DifferenceRow label="Ссылки" left={left.links.total} right={right.links.total} />
          <DifferenceRow label="Битые ссылки" left={left.links.known_broken} right={right.links.known_broken} />
          <DifferenceRow label="Изображения" left={left.assets.images.total} right={right.assets.images.total} />
          <DifferenceRow label="Без alt" left={left.assets.images.missing_alt} right={right.assets.images.missing_alt} />
          <DifferenceRow label="Scripts" left={left.assets.scripts.total} right={right.assets.scripts.total} />
        </div>
      </div>

      <div>
        <div style={{ fontWeight: 800, marginBottom: 7 }}>Аналитика и consent</div>
        {!hasTrackingDifferences && <StatusText tone="success">Различий в распознанных ID, cookies и CMP не найдено.</StatusText>}
        {leftOnlyIds.length > 0 && <StatusText tone="warning">Только слева ID: {leftOnlyIds.join(", ")}</StatusText>}
        {rightOnlyIds.length > 0 && <StatusText tone="warning">Только справа ID: {rightOnlyIds.join(", ")}</StatusText>}
        {leftOnlyCookies.length > 0 && <MetaText>Только слева cookies: {leftOnlyCookies.join(", ")}</MetaText>}
        {rightOnlyCookies.length > 0 && <MetaText>Только справа cookies: {rightOnlyCookies.join(", ")}</MetaText>}
        {leftOnlyCmp.length > 0 && <MetaText>Только слева CMP: {leftOnlyCmp.join(", ")}</MetaText>}
        {rightOnlyCmp.length > 0 && <MetaText>Только справа CMP: {rightOnlyCmp.join(", ")}</MetaText>}
        <MetaText opacity={0.65} style={{ marginTop: 6 }}>
          Сравниваются статические признаки сохранённого HTML. Фактический запуск до/после согласия здесь не подтверждается.
        </MetaText>
      </div>
    </div>
  );
}

export default function ComparePage() {
  const { user } = useAuth();
  const { id } = useParams<{ id: string }>();
  const projectId = Number(id);
  const [sites, setSites] = useState<ProjectSite[]>([]);
  const [left, setLeft] = useState<SideState>(EMPTY_SIDE);
  const [right, setRight] = useState<SideState>(EMPTY_SIDE);
  const [mode, setMode] = useState<CompareMode>("visual");
  const [panelView, setPanelView] = useState<PanelView>("both");
  const [visualScale, setVisualScale] = useState<VisualScale>("overview");
  const [syncVisualScroll, setSyncVisualScroll] = useState(() => localStorage.getItem(COMPARE_SYNC_SCROLL_STORAGE_KEY) !== "off");
  const [workspaceHeight, setWorkspaceHeight] = useState<CompareWorkspaceHeight>(() => {
    const saved = localStorage.getItem(COMPARE_WORKSPACE_HEIGHT_STORAGE_KEY);
    return COMPARE_WORKSPACE_HEIGHTS.has(saved as CompareWorkspaceHeight) ? saved as CompareWorkspaceHeight : "comfortable";
  });
  const [compareStarted, setCompareStarted] = useState(false);
  const [compareLoading, setCompareLoading] = useState(false);
  const [autoMatchEnabled, setAutoMatchEnabled] = useState(true);
  const [blockPickerEnabled, setBlockPickerEnabled] = useState(false);
  const [selectedBlocks, setSelectedBlocks] = useState<{ left: ComparePickedElement | null; right: ComparePickedElement | null }>({ left: null, right: null });
  const [blockPickerNotice, setBlockPickerNotice] = useState("");
  const [savingTargetSide, setSavingTargetSide] = useState<SideKey | null>(null);
  const [savedTarget, setSavedTarget] = useState<MonitoringTarget | null>(null);
  const [checkingTarget, setCheckingTarget] = useState(false);
  const [targetMessage, setTargetMessage] = useState("");
  const [targetError, setTargetError] = useState("");
  const [error, setError] = useState("");
  const leftSnapshotScrollRef = useRef<HTMLDivElement | null>(null);
  const rightSnapshotScrollRef = useRef<HTMLDivElement | null>(null);
  const syncedScrollGuardRef = useRef<SideKey | null>(null);
  const canGenerateSnapshot = hasPermission(user?.role, "crawler.run");

  useEffect(() => {
    localStorage.setItem(COMPARE_SYNC_SCROLL_STORAGE_KEY, syncVisualScroll ? "on" : "off");
  }, [syncVisualScroll]);

  useEffect(() => {
    localStorage.setItem(COMPARE_WORKSPACE_HEIGHT_STORAGE_KEY, workspaceHeight);
  }, [workspaceHeight]);

  const handleSyncedCompareScroll = useCallback((source: SideKey, event: UIEvent<HTMLDivElement>) => {
    if (!syncVisualScroll || panelView !== "both" || mode !== "visual") return;
    if (syncedScrollGuardRef.current && syncedScrollGuardRef.current !== source) return;
    const sourceElement = event.currentTarget;
    const targetElement = source === "left" ? rightSnapshotScrollRef.current : leftSnapshotScrollRef.current;
    if (!targetElement) return;
    const sourceMaxTop = Math.max(1, sourceElement.scrollHeight - sourceElement.clientHeight);
    const sourceMaxLeft = Math.max(1, sourceElement.scrollWidth - sourceElement.clientWidth);
    const targetMaxTop = Math.max(0, targetElement.scrollHeight - targetElement.clientHeight);
    const targetMaxLeft = Math.max(0, targetElement.scrollWidth - targetElement.clientWidth);
    syncedScrollGuardRef.current = source;
    targetElement.scrollTop = (sourceElement.scrollTop / sourceMaxTop) * targetMaxTop;
    targetElement.scrollLeft = (sourceElement.scrollLeft / sourceMaxLeft) * targetMaxLeft;
    window.requestAnimationFrame(() => {
      syncedScrollGuardRef.current = null;
    });
  }, [mode, panelView, syncVisualScroll]);

  const updateSide = useCallback((key: SideKey, updater: (current: SideState) => SideState) => {
    if (key === "left") setLeft(updater);
    else setRight(updater);
  }, []);

  const resetCompareWorkspace = useCallback(() => {
    setCompareStarted(false);
    setCompareLoading(false);
    setBlockPickerEnabled(false);
    setSelectedBlocks({ left: null, right: null });
    setBlockPickerNotice("");
    setSavingTargetSide(null);
    setSavedTarget(null);
    setCheckingTarget(false);
    setTargetMessage("");
    setTargetError("");
  }, []);

  const selectSite = useCallback(async (key: SideKey, siteId: number) => {
    resetCompareWorkspace();
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
  }, [resetCompareWorkspace, updateSide]);

  async function selectRun(key: SideKey, runId: number) {
    resetCompareWorkspace();
    setSelectedBlocks((current) => ({ ...current, [key]: null }));
    updateSide(key, (current) => ({
      ...current,
      runId,
      pages: [],
      pageQuery: "",
      url: "",
      snapshot: null,
      context: null,
      loading: true,
      error: "",
    }));
    try {
      const pages = await listComparePages(runId);
      updateSide(key, (current) => ({ ...current, pages, loading: false }));
    } catch (err) {
      updateSide(key, (current) => ({ ...current, loading: false, error: err instanceof Error ? err.message : "Ошибка загрузки." }));
    }
  }

  async function selectPersonaFilter(key: SideKey, personaId: number | "all") {
    resetCompareWorkspace();
    const side = key === "left" ? left : right;
    const visibleRuns = personaId === "all"
      ? side.runs
      : side.runs.filter((run) => (run.persona?.id || 0) === personaId);
    const runId = visibleRuns[0]?.id ?? null;
    setSelectedBlocks((current) => ({ ...current, [key]: null }));
    updateSide(key, (current) => ({
      ...current,
      personaFilterId: personaId,
      runId,
      pages: [],
      pageQuery: "",
      url: "",
      snapshot: null,
      context: null,
      loading: Boolean(runId),
      error: runId ? "" : "У выбранного контекста пока нет успешных прогонов.",
    }));
    if (!runId) return;
    try {
      const pages = await listComparePages(runId);
      updateSide(key, (current) => ({ ...current, pages, loading: false, error: "" }));
    } catch (err) {
      updateSide(key, (current) => ({ ...current, loading: false, error: err instanceof Error ? err.message : "Ошибка загрузки." }));
    }
  }

  async function selectPage(key: SideKey, url: string) {
    resetCompareWorkspace();
    updateSide(key, (current) => ({ ...current, url, snapshot: null, context: null, error: "" }));
  }

  async function loadSideSnapshot(key: SideKey) {
    const side = key === "left" ? left : right;
    if (!side.runId || !side.url) return;
    updateSide(key, (current) => ({ ...current, loading: true, error: "" }));
    try {
      const [snapshot, context] = await Promise.all([
        getCompareSnapshot(side.runId, side.url),
        getPageContext(side.runId, side.url),
      ]);
      updateSide(key, (current) => ({ ...current, snapshot, context, loading: false }));
    } catch (err) {
      updateSide(key, (current) => ({ ...current, loading: false, error: err instanceof Error ? err.message : "Snapshot недоступен." }));
    }
  }

  async function startCompare() {
    if (!left.runId || !right.runId || !left.url || !right.url) return;
    resetCompareWorkspace();
    setCompareStarted(true);
    setCompareLoading(true);
    setError("");
    try {
      await Promise.all([loadSideSnapshot("left"), loadSideSnapshot("right")]);
    } finally {
      setCompareLoading(false);
    }
  }

  async function saveMonitoringTarget(side: SideKey) {
    const snapshot = side === "left" ? left.snapshot : right.snapshot;
    const element = side === "left" ? selectedBlocks.left : selectedBlocks.right;
    if (!snapshot || !element) return;
    setSavingTargetSide(side);
    setTargetMessage("");
    setTargetError("");
    try {
      const target = await createMonitoringTarget(snapshot.run_id, snapshot.url, {
        name: `${snapshot.meta.title || snapshot.url} · ${element.tag}`,
        source: "rendered_snapshot",
        element,
      });
      setSavedTarget(target);
      setTargetMessage(`Блок «${target.name}» сохранён. ${target.next_step}`);
    } catch (err) {
      setTargetError(err instanceof Error ? err.message : "Не удалось сохранить отслеживаемый блок.");
    } finally {
      setSavingTargetSide(null);
    }
  }

  async function checkSavedMonitoringTarget() {
    if (!savedTarget) return;
    setCheckingTarget(true);
    setTargetError("");
    try {
      const result = await checkMonitoringTarget(savedTarget.id);
      const label = result.status === "matched"
        ? "найдена"
        : result.status === "changed"
          ? "похожа, но изменилась"
          : result.status === "missing"
            ? "не найдена"
            : "не проверяется";
      setTargetMessage(`Проверка блока: ${label}. ${result.message}`);
    } catch (err) {
      setTargetError(err instanceof Error ? err.message : "Не удалось проверить отслеживаемый блок.");
    } finally {
      setCheckingTarget(false);
    }
  }

  function updatePageQuery(key: SideKey, query: string) {
    updateSide(key, (current) => ({ ...current, pageQuery: query }));
  }

  useEffect(() => {
    if (!Number.isFinite(projectId)) return;
    listProjectSites(projectId)
      .then((rows) => {
        setSites(rows);
        const leftSite = rows[0];
        const rightSite = rows[1] || rows[0];
        if (leftSite) void selectSite("left", leftSite.id);
        if (rightSite) void selectSite("right", rightSite.id);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Не удалось загрузить сайты проекта."));
  }, [projectId, selectSite]);

  const diff = useMemo(
    () => left.snapshot && right.snapshot ? buildLineDiff(left.snapshot.html, right.snapshot.html) : [],
    [left.snapshot, right.snapshot],
  );
  const changedLines = diff.filter((line) => line.kind !== "same").length;
  const pagesPicked = Boolean(left.runId && right.runId && left.url && right.url);
  const ready = compareStarted && Boolean(left.snapshot && right.snapshot);
  const inspectorReady = Boolean(left.context && right.context);
  const selectionProgress = (left.url ? 1 : 0) + (right.url ? 1 : 0);
  const leftPersona = left.snapshot?.persona || left.runs.find((run) => run.id === left.runId)?.persona || null;
  const rightPersona = right.snapshot?.persona || right.runs.find((run) => run.id === right.runId)?.persona || null;
  const leftPersonaKey = leftPersona?.key || "guest";
  const rightPersonaKey = rightPersona?.key || "guest";
  const differentAccessContexts = ready && leftPersonaKey !== rightPersonaKey;
  const selectedBlockCount = (selectedBlocks.left ? 1 : 0) + (selectedBlocks.right ? 1 : 0);
  const missingElementMapSides = [
    left.snapshot && !left.snapshot.rendered_snapshot.element_map?.items?.length ? "слева" : "",
    right.snapshot && !right.snapshot.rendered_snapshot.element_map?.items?.length ? "справа" : "",
  ].filter(Boolean);
  const blockMatchSuggestion = useMemo(() => {
    if (selectedBlocks.left && !selectedBlocks.right) {
      return suggestMatchingBlock({
        source: selectedBlocks.left,
        candidates: right.snapshot?.rendered_snapshot.element_map?.items || [],
        targetSide: "right",
      });
    }
    if (selectedBlocks.right && !selectedBlocks.left) {
      return suggestMatchingBlock({
        source: selectedBlocks.right,
        candidates: left.snapshot?.rendered_snapshot.element_map?.items || [],
        targetSide: "left",
      });
    }
    return null;
  }, [left.snapshot, right.snapshot, selectedBlocks.left, selectedBlocks.right]);
  const rightSuggestion = useMemo(
    () => autoMatchEnabled && left.url && right.pages.length ? suggestPageMatch(left.url, right.pages) : null,
    [autoMatchEnabled, left.url, right.pages],
  );
  const leftSuggestion = useMemo(
    () => autoMatchEnabled && right.url && left.pages.length ? suggestPageMatch(right.url, left.pages) : null,
    [autoMatchEnabled, right.url, left.pages],
  );

  return (
    <div style={{ display: "grid", gap: 12, minWidth: 0 }}>
      <SectionHeaderRow
        title={
          <div>
            <h2 style={{ margin: 0 }}>Сравнение страниц</h2>
            <MetaText opacity={0.68}>
              Шаг 1: выберите две страницы. Шаг 2: выберите режим сравнения. Шаг 3: исследуйте различия.
            </MetaText>
          </div>
        }
        actions={
          ready
            ? (
              <SegmentedControl
                value={mode}
                onChange={setMode}
                options={[
                  { value: "visual", label: "Визуально" },
                  { value: "code", label: "Код" },
                  { value: "structure", label: "Структура" },
                ]}
              />
            )
            : <StatusText tone={selectionProgress === 2 ? "success" : "muted"}>Выбрано {selectionProgress}/2</StatusText>
        }
      />
      {error && <StatusText tone="danger">{error}</StatusText>}

      <div className="compare-two-column-grid">
        <SnapshotSelector
          label="Левая сторона"
          sites={sites}
          side={left}
          suggestedUrl={leftSuggestion?.page.url || null}
          onSiteChange={(siteId) => void selectSite("left", siteId)}
          onPersonaFilterChange={(personaId) => void selectPersonaFilter("left", personaId)}
          onRunChange={(runId) => void selectRun("left", runId)}
          onPageQueryChange={(query) => updatePageQuery("left", query)}
          onPageChange={(url) => void selectPage("left", url)}
        />
        <SnapshotSelector
          label="Правая сторона"
          sites={sites}
          side={right}
          suggestedUrl={rightSuggestion?.page.url || null}
          onSiteChange={(siteId) => void selectSite("right", siteId)}
          onPersonaFilterChange={(personaId) => void selectPersonaFilter("right", personaId)}
          onRunChange={(runId) => void selectRun("right", runId)}
          onPageQueryChange={(query) => updatePageQuery("right", query)}
          onPageChange={(url) => void selectPage("right", url)}
        />
      </div>

      <Card variant={pagesPicked ? "hint" : "default"} style={{ display: "grid", gap: 8 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <StatusText tone={pagesPicked ? "success" : "muted"}>
              {pagesPicked ? "Пара выбрана" : `Выберите две страницы · ${selectionProgress}/2`}
            </StatusText>
            <Button
              size="sm"
              variant="ghost"
              active={autoMatchEnabled}
              onClick={() => setAutoMatchEnabled((current) => !current)}
            >
              {autoMatchEnabled ? "Автоподбор включён" : "Автоподбор выключен"}
            </Button>
          </div>
          <Button
            size="sm"
            variant="primary"
            disabled={!pagesPicked || compareLoading}
            onClick={() => void startCompare()}
          >
            {compareLoading ? <CompareLoadingDot label="Готовим сравнение" /> : "Сравнить"}
          </Button>
        </div>
        {compareLoading && (
          <MetaText opacity={0.72} style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
            <span className="compare-loading-dot" aria-hidden />
            Загружаем snapshots и контекст обеих страниц. После загрузки откроется рабочая область сравнения.
          </MetaText>
        )}
        {!ready && compareStarted && !compareLoading && (
          <StatusText tone="warning">Не удалось загрузить обе стороны. Проверьте ошибки в карточках выбора и попробуйте снова.</StatusText>
        )}
      </Card>

      {autoMatchEnabled && (rightSuggestion || leftSuggestion) && (
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

      {differentAccessContexts && (
        <Card variant="warning" style={{ display: "grid", gap: 6 }}>
          <div style={{ fontWeight: 700 }}>Сравнение разных контекстов доступа</div>
          <MetaText opacity={0.78}>
            Слева: {leftPersona?.label || "Гость"} · справа: {rightPersona?.label || "Гость"}.
            Различия могут означать разные права доступа, авторизацию или персонализацию, а не обычное изменение страницы.
          </MetaText>
        </Card>
      )}

      {!ready && (
        <Card variant="hint">
          <MetaText>
            Режимы сравнения появятся после выбора двух страниц и нажатия «Сравнить».
            Так интерфейс не показывает переключатели, которые ещё ни на что не влияют.
          </MetaText>
        </Card>
      )}

      {ready && (
        <Card className="compare-focus-toolbar" style={{ padding: 8 }}>
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
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <StatusText tone={selectedBlockCount === 2 ? "success" : "muted"}>
                  Блоки: {selectedBlockCount}/2
                </StatusText>
                <button
                  type="button"
                  className={`element-picker-toggle${syncVisualScroll ? " is-active" : ""}`}
                  onClick={() => setSyncVisualScroll((current) => !current)}
                  title="Синхронно прокручивает левый и правый визуальные снимки."
                >
                  {syncVisualScroll ? "Скролл связан" : "Скролл отдельно"}
                </button>
                <button
                  type="button"
                  className={`element-picker-toggle${blockPickerEnabled ? " is-active" : ""}`}
                  disabled={missingElementMapSides.length > 0}
                  title={missingElementMapSides.length ? "Для выбора блоков нужен визуальный снимок новой версии с картой элементов." : undefined}
                  onClick={() => setBlockPickerEnabled((current) => !current)}
                >
                  {blockPickerEnabled ? "Выбор блоков включён" : "Выбрать блоки"}
                </button>
                {(selectedBlocks.left || selectedBlocks.right) && (
                  <button
                    type="button"
                    className="element-picker-toggle"
                    onClick={() => {
                      setSelectedBlocks({ left: null, right: null });
                      setBlockPickerNotice("");
                    }}
                  >
                    Очистить оба блока
                  </button>
                )}
                <SegmentedControl
                  value={visualScale}
                  onChange={setVisualScale}
                  options={[
                    { value: "overview", label: "Обзор" },
                    { value: "detail", label: "Детально" },
                  ]}
                />
                <SegmentedControl
                  value={workspaceHeight}
                  onChange={setWorkspaceHeight}
                  options={[
                    { value: "compact", label: "Компактно" },
                    { value: "comfortable", label: "Удобно" },
                    { value: "tall", label: "Высоко" },
                  ]}
                />
              </div>
            )}
          </div>
        </Card>
      )}

      {ready && left.snapshot && right.snapshot && (
        <>
        <div className={`compare-focus-workspace is-height-${workspaceHeight}`}>
        <div className={`compare-workspace-grid compare-work-area ${panelView === "both" ? "is-both" : `is-single is-${panelView}`}`}>
          {panelView !== "right" && (
            <PageInfoPanel label="Инфо левой страницы" context={left.context} side="left" />
          )}

          <div className="compare-central-stage">
            {mode === "visual" && (
              <div
                className={panelView === "both" ? "compare-two-column-grid" : undefined}
                style={panelView === "both" ? undefined : { display: "grid", gridTemplateColumns: "minmax(0, 1fr)" }}
              >
                {panelView !== "right" && (
                  <VisualSnapshotPanel
                    label="Левая страница"
                    snapshot={left.snapshot}
                    scale={visualScale}
                    canGenerate={canGenerateSnapshot}
                    blockPickerEnabled={blockPickerEnabled}
                    selectedElement={selectedBlocks.left}
                    scrollContainerRef={leftSnapshotScrollRef}
                    onSnapshotScroll={(event) => handleSyncedCompareScroll("left", event)}
                    onElementSelected={(element) => {
                      setSelectedBlocks((current) => ({ ...current, left: { ...element, side: "left" } }));
                      setBlockPickerNotice("");
                    }}
                    onElementMiss={() => setBlockPickerNotice("Слева в этой точке snapshot не найден HTML-блок. Попробуйте кликнуть по видимому тексту, изображению или карточке.")}
                    onRenderedSnapshotCreated={(metadata) => {
                      setLeft((current) => current.snapshot
                        ? { ...current, snapshot: { ...current.snapshot, rendered_snapshot: metadata } }
                        : current);
                    }}
                  />
                )}
                {panelView !== "left" && (
                  <VisualSnapshotPanel
                    label="Правая страница"
                    snapshot={right.snapshot}
                    scale={visualScale}
                    canGenerate={canGenerateSnapshot}
                    blockPickerEnabled={blockPickerEnabled}
                    selectedElement={selectedBlocks.right}
                    scrollContainerRef={rightSnapshotScrollRef}
                    onSnapshotScroll={(event) => handleSyncedCompareScroll("right", event)}
                    onElementSelected={(element) => {
                      setSelectedBlocks((current) => ({ ...current, right: { ...element, side: "right" } }));
                      setBlockPickerNotice("");
                    }}
                    onElementMiss={() => setBlockPickerNotice("Справа в этой точке snapshot не найден HTML-блок. Попробуйте кликнуть по видимому тексту, изображению или карточке.")}
                    onRenderedSnapshotCreated={(metadata) => {
                      setRight((current) => current.snapshot
                        ? { ...current, snapshot: { ...current.snapshot, rendered_snapshot: metadata } }
                        : current);
                    }}
                  />
                )}
              </div>
            )}

            {mode === "code" && (
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

            {mode === "structure" && (
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

            {mode === "visual" && (
              <>
                {missingElementMapSides.length > 0 && (
                  <StatusText tone="warning">
                    Выбор блоков недоступен {missingElementMapSides.join(" и ")}: пересоздайте визуальный снимок, чтобы появилась карта элементов.
                  </StatusText>
                )}
                {blockPickerNotice && <StatusText tone="warning">{blockPickerNotice}</StatusText>}
                {targetError && <StatusText tone="danger">{targetError}</StatusText>}
                {targetMessage && (
                  <Card variant="hint" style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", flexWrap: "wrap", padding: 9 }}>
                    <StatusText tone="success">{targetMessage}</StatusText>
                    {savedTarget && (
                      <Button size="sm" variant="secondary" disabled={checkingTarget} onClick={() => void checkSavedMonitoringTarget()}>
                        {checkingTarget ? "Проверяем..." : "Проверить блок"}
                      </Button>
                    )}
                  </Card>
                )}
                {selectedBlockCount === 1 && (
                  <BlockMatchSuggestionCard
                    suggestion={blockMatchSuggestion}
                    onApply={(suggestion) => {
                      setSelectedBlocks((current) => ({ ...current, [suggestion.side]: suggestion.element }));
                      setBlockPickerNotice("");
                    }}
                  />
                )}
                <SelectedBlockCompare
                  left={selectedBlocks.left}
                  right={selectedBlocks.right}
                  onSaveTarget={(side) => void saveMonitoringTarget(side)}
                  savingTargetSide={savingTargetSide}
                  onReset={(side) => {
                    setSelectedBlocks((current) => ({ ...current, [side]: null }));
                    setBlockPickerNotice("");
                    setTargetMessage("");
                    setTargetError("");
                  }}
                  onResetAll={() => {
                    setSelectedBlocks({ left: null, right: null });
                    setBlockPickerNotice("");
                    setTargetMessage("");
                    setTargetError("");
                  }}
                />
              </>
            )}
          </div>

          {panelView !== "left" && (
            <PageInfoPanel label="Инфо правой страницы" context={right.context} side="right" />
          )}
        </div>
        <Card className="compare-differences-report">
          <div style={{ display: "grid", gap: 9 }}>
            <div>
              <div style={{ fontWeight: 800 }}>Только различия</div>
              <MetaText opacity={0.68}>
                Здесь не повторяется полный отчёт сторон — только значимые расхождения между выбранными страницами.
              </MetaText>
            </div>
            {!inspectorReady && <MetaText>Загружаем диагностику обеих страниц...</MetaText>}
            {inspectorReady && left.context && right.context && (
              <PageInspectionDifferences left={left.context} right={right.context} />
            )}
          </div>
        </Card>
        </div>
        </>
      )}
    </div>
  );
}
