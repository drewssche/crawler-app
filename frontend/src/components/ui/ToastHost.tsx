import { useEffect, useMemo, useState } from "react";
import Button from "./Button";

export type ToastItem = {
  id: string;
  title: string;
  body: string;
  accent?: "info" | "warning" | "danger" | "neutral";
  actionLabel?: string;
  onAction?: () => void;
  secondaryActionLabel?: string;
  onSecondaryAction?: () => void;
  onClick?: () => void;
};

type Props = {
  items: ToastItem[];
  onClose: (id: string) => void;
  autoCloseMs?: number;
};

export default function ToastHost({ items, onClose, autoCloseMs = 6000 }: Props) {
  const [expiresAtMap, setExpiresAtMap] = useState<Record<string, number>>({});
  const [pausedRemainingMap, setPausedRemainingMap] = useState<Record<string, number>>({});
  const [closingMap, setClosingMap] = useState<Record<string, true>>({});
  const [enteredMap, setEnteredMap] = useState<Record<string, true>>({});
  const [nowMs, setNowMs] = useState<number>(Date.now());
  const EXIT_MS = 220;

  function beginClose(id: string) {
    setClosingMap((prev) => (prev[id] ? prev : { ...prev, [id]: true }));
  }

  useEffect(() => {
    setExpiresAtMap((prev) => {
      const next = { ...prev };
      const now = Date.now();
      for (const item of items) {
        if (!next[item.id]) {
          next[item.id] = now + autoCloseMs;
        }
      }
      for (const id of Object.keys(next)) {
        if (!items.find((x) => x.id === id)) {
          delete next[id];
        }
      }
      return next;
    });
    setPausedRemainingMap((prev) => {
      const next = { ...prev };
      for (const id of Object.keys(next)) {
        if (!items.find((x) => x.id === id)) {
          delete next[id];
        }
      }
      return next;
    });
    setClosingMap((prev) => {
      const next = { ...prev };
      for (const id of Object.keys(next)) {
        if (!items.find((x) => x.id === id)) {
          delete next[id];
        }
      }
      return next;
    });
    setEnteredMap((prev) => {
      const next = { ...prev };
      for (const id of Object.keys(next)) {
        if (!items.find((x) => x.id === id)) {
          delete next[id];
        }
      }
      return next;
    });
  }, [items, autoCloseMs]);

  useEffect(() => {
    const newIds = items.map((x) => x.id).filter((id) => !enteredMap[id]);
    if (newIds.length === 0) return;
    const t = window.setTimeout(() => {
      setEnteredMap((prev) => {
        const next = { ...prev };
        for (const id of newIds) next[id] = true;
        return next;
      });
    }, 10);
    return () => window.clearTimeout(t);
  }, [items, enteredMap]);

  useEffect(() => {
    if (items.length === 0) return undefined;
    const tick = window.setInterval(() => {
      setNowMs(Date.now());
    }, 120);
    return () => window.clearInterval(tick);
  }, [items.length]);

  useEffect(() => {
    if (items.length === 0) return undefined;
    const timer = window.setInterval(() => {
      const now = Date.now();
      for (const item of items) {
        if (pausedRemainingMap[item.id] != null) continue;
        const expiresAt = expiresAtMap[item.id];
        if (!expiresAt) continue;
        if (now >= expiresAt) {
          beginClose(item.id);
        }
      }
    }, 250);
    return () => window.clearInterval(timer);
  }, [items, expiresAtMap, pausedRemainingMap]);

  useEffect(() => {
    const ids = Object.keys(closingMap);
    if (ids.length === 0) return;
    const timer = window.setTimeout(() => {
      for (const id of ids) onClose(id);
    }, EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [closingMap, onClose]);

  const progress = useMemo(() => {
    const out: Record<string, number> = {};
    for (const item of items) {
      const pausedRemaining = pausedRemainingMap[item.id];
      const remaining = pausedRemaining != null ? pausedRemaining : Math.max(0, (expiresAtMap[item.id] ?? nowMs) - nowMs);
      const ratio = Math.max(0, Math.min(1, remaining / autoCloseMs));
      out[item.id] = ratio;
    }
    return out;
  }, [items, pausedRemainingMap, expiresAtMap, autoCloseMs, nowMs]);

  function pauseToast(id: string) {
    if (pausedRemainingMap[id] != null) return;
    const now = Date.now();
    const expiresAt = expiresAtMap[id];
    if (!expiresAt) return;
    const remaining = Math.max(0, expiresAt - now);
    setPausedRemainingMap((prev) => ({ ...prev, [id]: remaining }));
  }

  function resumeToast(id: string) {
    const remaining = pausedRemainingMap[id];
    if (remaining == null) return;
    const now = Date.now();
    setPausedRemainingMap((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setExpiresAtMap((prev) => ({ ...prev, [id]: now + remaining }));
  }

  if (items.length === 0) return null;

  return (
    <div style={{ position: "fixed", right: 20, bottom: 20, display: "grid", gap: 8, zIndex: 50 }}>
      {items.slice(0, 3).map((item) => (
        <div
          key={item.id}
          onMouseEnter={() => pauseToast(item.id)}
          onMouseLeave={() => resumeToast(item.id)}
          onClick={
            item.onClick
              ? () => {
                  item.onClick?.();
                  beginClose(item.id);
                }
              : undefined
          }
          onAnimationStart={() => {
            if (!enteredMap[item.id]) {
              setEnteredMap((prev) => ({ ...prev, [item.id]: true }));
            }
          }}
          style={{
            width: 320,
            maxWidth: "86vw",
            border: "1px solid #3333",
            borderRadius: 12,
            padding: 10,
            background:
              item.accent === "danger"
                ? "linear-gradient(180deg, rgba(224,92,92,0.20), rgba(29,29,29,0.96))"
                : item.accent === "warning"
                ? "linear-gradient(180deg, rgba(240,168,94,0.18), rgba(29,29,29,0.96))"
                : item.accent === "info"
                ? "linear-gradient(180deg, rgba(106,160,255,0.18), rgba(29,29,29,0.96))"
                : "#1d1d1d",
            cursor: item.onClick ? "pointer" : "default",
            opacity: closingMap[item.id] ? 0 : enteredMap[item.id] ? 1 : 0,
            transform: closingMap[item.id]
              ? "translateY(8px) scale(0.98)"
              : enteredMap[item.id]
                ? "translateY(0) scale(1)"
                : "translateY(10px) scale(0.98)",
            transition: "opacity 220ms ease, transform 220ms ease",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "start" }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 700 }}>{item.title}</div>
              <div
                style={{
                  opacity: 0.85,
                  fontSize: 13,
                  overflow: "hidden",
                  display: "-webkit-box",
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical",
                }}
              >
                {item.body}
              </div>
            </div>
            <Button
              onClick={(e) => {
                e.stopPropagation();
                beginClose(item.id);
              }}
              size="sm"
              variant="ghost"
              title={"\u0417\u0430\u043a\u0440\u044b\u0442\u044c"}
              style={{ minWidth: 28, padding: "0 8px" }}
            >
              {"\u00d7"}
            </Button>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, alignItems: "center" }}>
            <div style={{ display: "flex", gap: 6, alignItems: "center", minHeight: 28 }}>
              {item.actionLabel && item.onAction ? (
                <Button
                  onClick={(e) => {
                    e.stopPropagation();
                    item.onAction?.();
                    beginClose(item.id);
                  }}
                  size="sm"
                  variant="secondary"
                >
                  {item.actionLabel}
                </Button>
              ) : null}
              {item.secondaryActionLabel && item.onSecondaryAction ? (
                <Button
                  onClick={(e) => {
                    e.stopPropagation();
                    item.onSecondaryAction?.();
                    beginClose(item.id);
                  }}
                  size="sm"
                  variant="ghost"
                >
                  {item.secondaryActionLabel}
                </Button>
              ) : null}
            </div>
            <div style={{ width: 100, height: 4, borderRadius: 2, background: "rgba(255,255,255,0.15)", overflow: "hidden" }}>
              <div style={{ width: `${Math.round((progress[item.id] ?? 1) * 100)}%`, height: "100%", background: "#6aa0ff" }} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
