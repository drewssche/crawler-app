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
    <Card variant="hint" style={style}>
      <div style={{ display: "grid", gap: 8 }}>
        <div style={{ fontWeight: 700 }}>{title}</div>
        {subtitle ? <div style={{ opacity: 0.8, fontSize: 13 }}>{subtitle}</div> : null}
        {children}
      </div>
    </Card>
  );
}
