import { useEffect, useMemo, useState } from "react";

export type ToastItem = {
  id: string;
  title: string;
  body: string;
  actionLabel?: string;
  onAction?: () => void;
};

type Props = {
  items: ToastItem[];
  onClose: (id: string) => void;
  autoCloseMs?: number;
};

export default function ToastHost({ items, onClose, autoCloseMs = 6000 }: Props) {
  const [createdAtMap, setCreatedAtMap] = useState<Record<string, number>>({});

  useEffect(() => {
    setCreatedAtMap((prev) => {
      const next = { ...prev };
      const now = Date.now();
      for (const item of items) {
        if (!next[item.id]) {
          next[item.id] = now;
        }
      }
      for (const id of Object.keys(next)) {
        if (!items.find((x) => x.id === id)) {
          delete next[id];
        }
      }
      return next;
    });
  }, [items]);

  useEffect(() => {
    if (items.length === 0) return;
    const timer = window.setInterval(() => {
      const now = Date.now();
      for (const item of items) {
        const started = createdAtMap[item.id];
        if (!started) continue;
        if (now - started >= autoCloseMs) {
          onClose(item.id);
        }
      }
    }, 250);
    return () => window.clearInterval(timer);
  }, [items, createdAtMap, autoCloseMs, onClose]);

  const progress = useMemo(() => {
    const now = Date.now();
    const out: Record<string, number> = {};
    for (const item of items) {
      const started = createdAtMap[item.id] ?? now;
      const ratio = Math.max(0, Math.min(1, 1 - (now - started) / autoCloseMs));
      out[item.id] = ratio;
    }
    return out;
  }, [items, createdAtMap, autoCloseMs]);

  if (items.length === 0) return null;

  return (
    <div style={{ position: "fixed", right: 20, bottom: 20, display: "grid", gap: 8, zIndex: 50 }}>
      {items.slice(0, 3).map((item) => (
        <div key={item.id} style={{ width: 320, maxWidth: "86vw", border: "1px solid #3333", borderRadius: 12, padding: 10, background: "#1d1d1d" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "start" }}>
            <div>
              <div style={{ fontWeight: 700 }}>{item.title}</div>
              <div style={{ opacity: 0.85, fontSize: 13 }}>{item.body}</div>
            </div>
            <button onClick={() => onClose(item.id)} style={{ borderRadius: 8, cursor: "pointer" }} title="Закрыть">
              ×
            </button>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, alignItems: "center" }}>
            {item.actionLabel && item.onAction ? (
              <button onClick={item.onAction} style={{ padding: "5px 8px", borderRadius: 8, cursor: "pointer" }}>
                {item.actionLabel}
              </button>
            ) : (
              <span />
            )}
            <div style={{ width: 100, height: 4, borderRadius: 2, background: "rgba(255,255,255,0.15)", overflow: "hidden" }}>
              <div style={{ width: `${Math.round((progress[item.id] ?? 1) * 100)}%`, height: "100%", background: "#6aa0ff" }} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
