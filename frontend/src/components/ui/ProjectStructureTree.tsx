import { useEffect, useMemo, useRef, useState } from "react";
import CardActionButton from "./CardActionButton";
import HighlightedText from "./HighlightedText";
import StructureStatusIcon from "./StructureStatusIcon";

type StructureStatus = "unchanged" | "changed" | "added" | "deleted" | "redirect" | "error";

export type ProjectStructureRow = {
  url: string;
  status: StructureStatus;
  statusCode: number;
  batchNo: number | null;
};

type TreeNode = {
  key: string;
  label: string;
  url: string;
  isDirectory: boolean;
  hasPage: boolean;
  pageStatus: StructureStatus | null;
  pageStatusCode: number;
  pageBatchNo: number | null;
  children: TreeNode[];
  total: number;
  changed: number;
  errors: number;
};

export type ProjectStructureDirectoryContext = {
  label: string;
  url: string;
  totalPages: number;
  changedPages: number;
  errorPages: number;
  directSections: number;
  directPages: number;
};

const NODE_BATCH_SIZE = 20;

function statusLabel(status: StructureStatus): string {
  if (status === "changed") return "изменен";
  if (status === "added") return "добавлен";
  if (status === "deleted") return "удален";
  if (status === "redirect") return "перенаправляет";
  if (status === "error") return "ошибка";
  return "без изменений";
}

function createNode(key: string, label: string, url: string, isDirectory: boolean): TreeNode {
  return {
    key,
    label,
    url,
    isDirectory,
    hasPage: false,
    pageStatus: null,
    pageStatusCode: 0,
    pageBatchNo: null,
    children: [],
    total: 0,
    changed: 0,
    errors: 0,
  };
}

function ensureChild(parent: TreeNode, key: string, label: string, url: string, isDirectory: boolean): TreeNode {
  const existing = parent.children.find((child) => child.key === key);
  if (existing) {
    if (isDirectory) existing.isDirectory = true;
    return existing;
  }
  const node = createNode(key, label, url, isDirectory);
  parent.children.push(node);
  return node;
}

function markPage(node: TreeNode, row: ProjectStructureRow): void {
  node.hasPage = true;
  node.pageStatus = row.status;
  node.pageStatusCode = row.statusCode;
  node.pageBatchNo = row.batchNo;
}

function finalizeNode(node: TreeNode): TreeNode {
  node.children = node.children.map(finalizeNode).sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.label.localeCompare(b.label, "ru");
  });

  let total = node.hasPage ? 1 : 0;
  let changed = node.hasPage && node.pageStatus && node.pageStatus !== "unchanged" ? 1 : 0;
  let errors = node.hasPage && node.pageStatus === "error" ? 1 : 0;
  for (const child of node.children) {
    total += child.total;
    changed += child.changed;
    errors += child.errors;
  }
  node.total = total;
  node.changed = changed;
  node.errors = errors;
  return node;
}

function buildTree(rows: ProjectStructureRow[]): TreeNode[] {
  const roots = new Map<string, TreeNode>();
  for (const row of rows) {
    let parsed: URL;
    try {
      parsed = new URL(row.url);
    } catch {
      continue;
    }
    const origin = `${parsed.protocol}//${parsed.host}`;
    const rootKey = `${origin}/`;
    let root = roots.get(rootKey);
    if (!root) {
      root = createNode(rootKey, `${origin}/`, `${origin}/`, true);
      roots.set(rootKey, root);
    }

    const segments = parsed.pathname.split("/").filter(Boolean);
    let current = root;

    if (segments.length === 0) {
      markPage(current, row);
      continue;
    }

    for (let i = 0; i < segments.length; i += 1) {
      const segment = decodeURIComponent(segments[i]);
      const isLast = i === segments.length - 1;
      const isDir = !isLast || parsed.pathname.endsWith("/");
      const path = `/${segments.slice(0, i + 1).join("/")}${isDir ? "/" : ""}`;
      const nodeUrl = `${origin}${path}`;
      const nodeKey = nodeUrl;
      const label = `${segment}${isDir ? "/" : ""}`;
      current = ensureChild(current, nodeKey, label, nodeUrl, isDir);
    }

    markPage(current, row);
  }

  return Array.from(roots.values()).map(finalizeNode).sort((a, b) => a.label.localeCompare(b.label, "ru"));
}

function filterTree(nodes: TreeNode[], query: string): TreeNode[] {
  const q = query.trim().toLowerCase();
  if (!q) return nodes;
  const visit = (node: TreeNode): TreeNode | null => {
    const children = node.children.map(visit).filter(Boolean) as TreeNode[];
    const selfMatch = node.label.toLowerCase().includes(q) || node.url.toLowerCase().includes(q);
    if (!selfMatch && children.length === 0) return null;
    return { ...node, children };
  };
  return nodes.map(visit).filter(Boolean) as TreeNode[];
}

function collectExpandableKeys(nodes: TreeNode[]): Set<string> {
  const keys = new Set<string>();
  const stack = [...nodes];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.children.length > 0) keys.add(node.key);
    for (const child of node.children) {
      stack.push(child);
    }
  }
  return keys;
}

function indexTree(nodes: TreeNode[]): Map<string, TreeNode> {
  const map = new Map<string, TreeNode>();
  const stack = [...nodes];
  while (stack.length > 0) {
    const node = stack.pop()!;
    map.set(node.key, node);
    for (const child of node.children) stack.push(child);
  }
  return map;
}

function collectDescendantKeys(node: TreeNode): string[] {
  const keys: string[] = [];
  const stack = [...node.children];
  while (stack.length > 0) {
    const current = stack.pop()!;
    keys.push(current.key);
    for (const child of current.children) stack.push(child);
  }
  return keys;
}

function hierarchyKeysForUrl(rawUrl: string): string[] {
  try {
    const parsed = new URL(rawUrl);
    const origin = `${parsed.protocol}//${parsed.host}`;
    const keys = [`${origin}/`];
    const segments = parsed.pathname.split("/").filter(Boolean);
    for (let index = 0; index < segments.length; index += 1) {
      const isLast = index === segments.length - 1;
      const isDirectory = !isLast || parsed.pathname.endsWith("/");
      keys.push(`${origin}/${segments.slice(0, index + 1).join("/")}${isDirectory ? "/" : ""}`);
    }
    return keys;
  } catch {
    return [];
  }
}

function AutoLoadSentinel({
  enabled,
  onVisible,
}: {
  enabled: boolean;
  onVisible: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const lastHitRef = useRef(0);
  useEffect(() => {
    if (!enabled || !ref.current) return;
    const node = ref.current;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const now = Date.now();
          if (now - lastHitRef.current < 220) continue;
          lastHitRef.current = now;
          onVisible();
        }
      },
      { root: null, rootMargin: "240px 0px 240px 0px", threshold: 0.1 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [enabled, onVisible]);

  return <div ref={ref} className="structure-tree-sentinel" />;
}

function TreeRow({
  node,
  depth,
  expanded,
  visibleByNode,
  query,
  onToggle,
  onLoadMore,
  onPageSelect,
  onDirectorySelect,
  canRetry,
  retryingUrl,
  retryResultByUrl,
  onRetryPage,
  recentNodeKeys,
  live,
  currentBatchNo,
}: {
  node: TreeNode;
  depth: number;
  expanded: Set<string>;
  visibleByNode: Record<string, number>;
  query: string;
  onToggle: (key: string) => void;
  onLoadMore: (key: string) => void;
  onPageSelect?: (url: string) => void;
  onDirectorySelect?: (context: ProjectStructureDirectoryContext) => void;
  canRetry: boolean;
  retryingUrl?: string | null;
  retryResultByUrl?: Record<string, "success" | "failed" | "skipped">;
  onRetryPage?: (url: string) => void;
  recentNodeKeys: Set<string>;
  live: boolean;
  currentBatchNo: number | null;
}) {
  const hasChildren = node.children.length > 0;
  const isExpanded = expanded.has(node.key);
  const canOpen = Boolean(node.url);
  const rowPadding = 10 + depth * 16;
  const showPageStatus = node.hasPage && node.pageStatus && node.pageStatus !== "unchanged";
  const visibleChildren = hasChildren
    ? node.children.slice(0, Math.max(NODE_BATCH_SIZE, visibleByNode[node.key] || NODE_BATCH_SIZE))
    : [];
  const hasMoreChildren = hasChildren && visibleChildren.length < node.children.length;

  return (
    <div style={{ display: "grid", gap: 4 }}>
      <div
        className={`structure-tree-row${recentNodeKeys.has(node.key) ? " structure-tree-row-live-added" : ""}`}
        style={{ paddingLeft: rowPadding }}
      >
        <button
          type="button"
          className="structure-tree-toggle"
          onClick={() => {
            if (!hasChildren) return;
            onToggle(node.key);
          }}
          aria-label={hasChildren ? (isExpanded ? "Свернуть раздел" : "Развернуть раздел") : "Элемент"}
        >
          {hasChildren ? (isExpanded ? "−" : "+") : "•"}
        </button>
        <button
          type="button"
          className="structure-tree-link"
          onClick={() => {
            if (!canOpen) return;
            if (node.hasPage && onPageSelect) {
              onPageSelect(node.url);
              return;
            }
            onDirectorySelect?.({
              label: node.label,
              url: node.url,
              totalPages: node.total,
              changedPages: node.changed,
              errorPages: node.errors,
              directSections: node.children.filter((child) => child.isDirectory).length,
              directPages: node.children.filter((child) => child.hasPage && !child.isDirectory).length,
            });
          }}
          title={node.url}
        >
          <HighlightedText value={node.label} query={query} />
        </button>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", justifyContent: "flex-end", fontSize: 12 }}>
          {node.changed > 0 ? (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }} title="Измененные элементы">
              <StructureStatusIcon status="changed" size={14} /> {node.changed}
            </span>
          ) : null}
          {node.errors > 0 ? (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }} title="Ошибочные элементы">
              <StructureStatusIcon status="error" size={14} /> {node.errors}
            </span>
          ) : null}
          {showPageStatus ? (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }} title={statusLabel(node.pageStatus!)}>
              <StructureStatusIcon status={node.pageStatus!} size={14} />
            </span>
          ) : null}
          {node.pageStatusCode >= 400 ? <span style={{ opacity: 0.86 }}>status {node.pageStatusCode}</span> : null}
          {node.hasPage && node.pageBatchNo !== null && (
            live && currentBatchNo !== null && node.pageBatchNo >= currentBatchNo ? (
              <span style={{ opacity: 0.72 }}>батч {node.pageBatchNo}</span>
            ) : (
              <span
                style={{ color: "#8fd18f", display: "inline-flex", alignItems: "center", gap: 3 }}
                title={`Результат страницы сохранён в батче ${node.pageBatchNo}`}
              >
                ✓ готово
              </span>
            )
          )}
          {node.hasPage && retryResultByUrl?.[node.url] === "success" ? (
            <span style={{ color: "#8fd18f" }} title="Исходный результат сохранён в истории прогона">
              повторно доступна
            </span>
          ) : null}
          {node.hasPage && retryResultByUrl?.[node.url] === "failed" ? (
            <span style={{ color: "#e7a15a" }}>ошибка сохранилась</span>
          ) : null}
          {node.hasPage && retryResultByUrl?.[node.url] === "skipped" ? (
            <span style={{ opacity: 0.72 }}>повтор временно недоступен</span>
          ) : null}
          {canRetry && node.hasPage && node.pageStatus === "error" && retryResultByUrl?.[node.url] !== "success" ? (
            <CardActionButton
              compact
              variant="secondary"
              disabled={Boolean(retryingUrl)}
              title="Повторно проверить только эту страницу. Исходный результат не изменится."
              onClick={(event) => {
                event.stopPropagation();
                onRetryPage?.(node.url);
              }}
            >
              {retryingUrl === node.url ? "Проверяем..." : "Повторить"}
            </CardActionButton>
          ) : null}
        </div>
      </div>
      {hasChildren && (
        <div
          className="structure-tree-children"
          style={{
            maxHeight: isExpanded ? 20000 : 0,
            opacity: isExpanded ? 1 : 0,
          }}
        >
          <div style={{ display: "grid", gap: 4 }}>
            {visibleChildren.map((child) => (
              <TreeRow
                key={child.key}
                node={child}
                depth={depth + 1}
                expanded={expanded}
                visibleByNode={visibleByNode}
                query={query}
                onToggle={onToggle}
                onLoadMore={onLoadMore}
                onPageSelect={onPageSelect}
                onDirectorySelect={onDirectorySelect}
                canRetry={canRetry}
                retryingUrl={retryingUrl}
                retryResultByUrl={retryResultByUrl}
                onRetryPage={onRetryPage}
                recentNodeKeys={recentNodeKeys}
                live={live}
                currentBatchNo={currentBatchNo}
              />
            ))}
            {isExpanded && hasMoreChildren ? (
              <AutoLoadSentinel
                enabled
                onVisible={() => {
                  onLoadMore(node.key);
                }}
              />
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

export default function ProjectStructureTree({
  rows,
  query = "",
  onPageSelect,
  onDirectorySelect,
  canRetry = false,
  retryingUrl = null,
  retryResultByUrl = {},
  onRetryPage,
  live = false,
  currentBatchNo = null,
}: {
  rows: ProjectStructureRow[];
  query?: string;
  onPageSelect?: (url: string) => void;
  onDirectorySelect?: (context: ProjectStructureDirectoryContext) => void;
  canRetry?: boolean;
  retryingUrl?: string | null;
  retryResultByUrl?: Record<string, "success" | "failed" | "skipped">;
  onRetryPage?: (url: string) => void;
  live?: boolean;
  currentBatchNo?: number | null;
}) {
  const fullTree = useMemo(() => buildTree(rows), [rows]);
  const tree = useMemo(() => filterTree(fullTree, query), [fullTree, query]);
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(() => new Set());
  const [visibleByNode, setVisibleByNode] = useState<Record<string, number>>({});
  const [recentNodeKeys, setRecentNodeKeys] = useState<Set<string>>(() => new Set());
  const previousUrlsRef = useRef<Set<string>>(new Set(rows.map((row) => row.url)));
  const nodeIndex = useMemo(() => indexTree(tree), [tree]);
  const effectiveExpandedKeys = useMemo(
    () => query.trim() ? collectExpandableKeys(tree) : expandedKeys,
    [query, tree, expandedKeys],
  );

  useEffect(() => {
    const nextUrls = new Set(rows.map((row) => row.url));
    if (!live) {
      previousUrlsRef.current = nextUrls;
      const resetTimer = window.setTimeout(() => setRecentNodeKeys(new Set()), 0);
      return () => window.clearTimeout(resetTimer);
    }
    const addedUrls = rows
      .map((row) => row.url)
      .filter((url) => !previousUrlsRef.current.has(url));
    previousUrlsRef.current = nextUrls;
    if (addedUrls.length === 0) return;
    setRecentNodeKeys(new Set(addedUrls.flatMap(hierarchyKeysForUrl)));
    const timer = window.setTimeout(() => setRecentNodeKeys(new Set()), 1800);
    return () => window.clearTimeout(timer);
  }, [live, rows]);

  return (
    <div className="structure-tree-root">
      {tree.length === 0 ? <div style={{ fontSize: 12, opacity: 0.72 }}>Нет совпадений в текущем срезе.</div> : null}
      {tree.map((node) => (
            <TreeRow
              key={node.key}
              node={node}
              depth={0}
              expanded={effectiveExpandedKeys}
              visibleByNode={visibleByNode}
              query={query}
              onToggle={(key) => {
            setExpandedKeys((prev) => {
              const next = new Set(prev);
              const isOpen = next.has(key);
              if (isOpen) {
                const node = nodeIndex.get(key);
                next.delete(key);
                if (node) {
                  for (const childKey of collectDescendantKeys(node)) next.delete(childKey);
                }
                setVisibleByNode((current) => {
                  const updated = { ...current };
                  delete updated[key];
                  if (node) {
                    for (const childKey of collectDescendantKeys(node)) delete updated[childKey];
                  }
                  return updated;
                });
              } else {
                next.add(key);
                setVisibleByNode((current) => ({ ...current, [key]: Math.max(NODE_BATCH_SIZE, current[key] || NODE_BATCH_SIZE) }));
              }
              return next;
            });
          }}
              onLoadMore={(key) => {
            setVisibleByNode((current) => ({
              ...current,
              [key]: (current[key] || NODE_BATCH_SIZE) + NODE_BATCH_SIZE,
            }));
          }}
          onPageSelect={onPageSelect}
          onDirectorySelect={onDirectorySelect}
          canRetry={canRetry}
          retryingUrl={retryingUrl}
          retryResultByUrl={retryResultByUrl}
          onRetryPage={onRetryPage}
          recentNodeKeys={recentNodeKeys}
          live={live}
          currentBatchNo={currentBatchNo}
        />
      ))}
    </div>
  );
}
