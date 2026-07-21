import type { ReactNode } from "react";

export type ProjectStatusShortcutTone = "neutral" | "success" | "warning" | "danger";

export type ProjectStatusShortcut = {
  id: string;
  label: string;
  value: ReactNode;
  tone?: ProjectStatusShortcutTone;
  title?: string;
  onClick: () => void;
  disabled?: boolean;
};

const TONE_COLOR: Record<ProjectStatusShortcutTone, string> = {
  neutral: "#9ea7b3",
  success: "#6ec7b5",
  warning: "#f0a85e",
  danger: "#e67f7f",
};

export default function ProjectStatusShortcuts({ items }: { items: ProjectStatusShortcut[] }) {
  return (
    <nav
      aria-label="Сводка проекта"
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
        gap: 8,
      }}
    >
      {items.map((item) => {
        const tone = item.tone || "neutral";
        return (
          <button
            key={item.id}
            type="button"
            className="interactive-row"
            title={item.title}
            onClick={item.onClick}
            disabled={item.disabled}
            style={{
              appearance: "none",
              width: "100%",
              minWidth: 0,
              minHeight: 66,
              display: "grid",
              gridTemplateColumns: "8px minmax(0, 1fr) auto",
              alignItems: "center",
              gap: 10,
              padding: "10px 12px",
              borderRadius: 12,
              border: "1px solid rgba(255,255,255,0.1)",
              background: "rgba(255,255,255,0.03)",
              color: "inherit",
              textAlign: "left",
              cursor: item.disabled ? "default" : "pointer",
              opacity: item.disabled ? 0.74 : 1,
            }}
          >
            <span
              aria-hidden="true"
              style={{ width: 8, height: 8, borderRadius: 999, background: TONE_COLOR[tone] }}
            />
            <span style={{ minWidth: 0, display: "grid", gap: 3 }}>
              <span style={{ color: "var(--muted)", fontSize: 12 }}>{item.label}</span>
              <strong style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {item.value}
              </strong>
            </span>
            <span aria-hidden="true" style={{ color: "var(--muted)", fontSize: 18 }}>{item.disabled ? "" : "›"}</span>
          </button>
        );
      })}
    </nav>
  );
}
