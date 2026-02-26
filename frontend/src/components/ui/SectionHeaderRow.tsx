import type { CSSProperties, ReactNode } from "react";

export default function SectionHeaderRow({
  title,
  actions,
  style,
}: {
  title: ReactNode;
  actions?: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        gap: 8,
        alignItems: "center",
        ...style,
      }}
    >
      <div style={{ fontWeight: 700 }}>{title}</div>
      {actions ? <div style={{ display: "flex", gap: 8, alignItems: "center" }}>{actions}</div> : null}
    </div>
  );
}

