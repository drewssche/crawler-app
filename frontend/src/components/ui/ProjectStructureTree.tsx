import { useEffect, useMemo, useRef, useState } from "react";
import HighlightedText from "./HighlightedText";
import StructureStatusIcon from "./StructureStatusIcon";

type StructureStatus = "unchanged" | "changed" | "added" | "deleted" | "error";

export type ProjectStructureRow = {
  url: string;
  status: StructureStatus;
  statusCode: number;
};

type TreeNode = {
  key: string;
  label: string;
  url: string;
  isDirectory: boolean;
  hasPage: boolean;
  pageStatus: StructureStatus | null;
  pageStatusCode: number;
  children: TreeNode[];
  total: number;
  changed: number;
  errors: number;
};

const NODE_BATCH_SIZE = 20;

function statusLabel(status: StructureStatus): string {
  if (status === "changed") return "изменен";
  if (status === "added") return "добавлен";
  if (status === "deleted") return "удален";
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
}: {
  node: TreeNode;
  depth: number;
  expanded: Set<string>;
  visibleByNode: Record<string, number>;
  query: string;
  onToggle: (key: string) => void;
  onLoadMore: (key: string) => void;
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
        className="structure-tree-row"
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
            window.open(node.url, "_blank", "noopener,noreferrer");
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
}: {
  rows: ProjectStructureRow[];
  query?: string;
}) {
  const fullTree = useMemo(() => buildTree(rows), [rows]);
  const tree = useMemo(() => filterTree(fullTree, query), [fullTree, query]);
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(() => new Set());
  const [visibleByNode, setVisibleByNode] = useState<Record<string, number>>({});
  const nodeIndex = useMemo(() => indexTree(tree), [tree]);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) return;
    setExpandedKeys(collectExpandableKeys(tree));
  }, [query, tree]);

  useEffect(() => {
    setVisibleByNode({});
  }, [rows, query]);

  return (
    <div className="structure-tree-root">
      {tree.length === 0 ? <div style={{ fontSize: 12, opacity: 0.72 }}>Нет совпадений в текущем срезе.</div> : null}
      {tree.map((node) => (
            <TreeRow
              key={node.key}
              node={node}
              depth={0}
              expanded={expandedKeys}
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
        />
      ))}
    </div>
  );
}
