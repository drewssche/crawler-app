import type { CSSProperties, ReactNode } from "react";
import Card from "./Card";

type Props = {
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  style?: CSSProperties;
};

export default function HintCard({ title, subtitle, children, style }: Props) {
  return (
    <Card style={{ borderColor: "rgba(120,166,255,0.5)", background: "rgba(120,166,255,0.06)", ...style }}>
      <div style={{ display: "grid", gap: 8 }}>
        <div style={{ fontWeight: 700 }}>{title}</div>
        {subtitle ? <div style={{ opacity: 0.8, fontSize: 13 }}>{subtitle}</div> : null}
        {children}
      </div>
    </Card>
  );
}
