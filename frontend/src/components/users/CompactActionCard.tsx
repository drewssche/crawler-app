import type { CSSProperties, ReactNode } from "react";
import Card from "../ui/Card";

export default function CompactActionCard({
  title,
  tone = "neutral",
  children,
  style,
}: {
  title?: string;
  tone?: "neutral" | "warning";
  children: ReactNode;
  style?: CSSProperties;
}) {
  const warning = tone === "warning";
  return (
    <Card
      style={{
        padding: 12,
        display: "grid",
        gap: 8,
        borderColor: warning ? "rgba(243,198,119,0.35)" : "rgba(255,255,255,0.12)",
        background: warning ? "rgba(243,198,119,0.06)" : "rgba(255,255,255,0.03)",
        ...style,
      }}
    >
      {title && <div style={{ fontWeight: 700 }}>{title}</div>}
      {children}
    </Card>
  );
}
