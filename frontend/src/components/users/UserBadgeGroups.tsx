import type { ReactNode } from "react";

export default function UserBadgeGroups({
  identity,
  status,
  trust,
}: {
  identity?: ReactNode;
  status?: ReactNode;
  trust?: ReactNode;
}) {
  const rowStyle = { display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" } as const;

  return (
    <div style={{ display: "grid", gap: 6 }}>
      {identity ? <div style={rowStyle}>{identity}</div> : null}
      {status ? <div style={rowStyle}>{status}</div> : null}
      {trust ? <div style={rowStyle}>{trust}</div> : null}
    </div>
  );
}
