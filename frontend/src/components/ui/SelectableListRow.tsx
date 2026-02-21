import type { ReactNode } from "react";
import Button from "./Button";
import Card from "./Card";

export default function SelectableListRow({
  checked,
  onToggle,
  title,
  badges,
  details,
  onOpen,
  highlighted = false,
  checkboxTitle,
  openLabel = "\u041e\u0442\u043a\u0440\u044b\u0442\u044c",
}: {
  checked: boolean;
  onToggle: () => void;
  title: ReactNode;
  badges?: ReactNode;
  details?: ReactNode;
  onOpen: () => void;
  highlighted?: boolean;
  checkboxTitle?: string;
  openLabel?: string;
}) {
  return (
    <Card
      className="interactive-row"
      style={{
        padding: 12,
        borderColor: highlighted ? "rgba(106,160,255,0.45)" : "transparent",
        background: highlighted ? "rgba(106,160,255,0.08)" : "rgba(255,255,255,0.03)",
      }}
    >
      <div
        style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", alignItems: "center", gap: 10, cursor: "pointer" }}
        onClick={(event) => {
          const target = event.target as HTMLElement;
          if (target.closest("input,button,a")) return;
          onOpen();
        }}
      >
        <input type="checkbox" checked={checked} onChange={onToggle} title={checkboxTitle} />
        <div style={{ display: "grid", gap: 6 }}>
          <div style={{ fontWeight: 700 }}>{title}</div>
          {badges ? <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>{badges}</div> : null}
          {details}
        </div>
        <Button size="sm" variant="ghost" onClick={onOpen}>
          {openLabel}
        </Button>
      </div>
    </Card>
  );
}
