import { type CSSProperties, type ReactNode } from "react";

const BASE_STYLE: CSSProperties = {
  padding: 16,
  display: "grid",
  gap: 12,
  alignContent: "start",
  minHeight: 0,
  overflowY: "auto",
};

export default function DrawerBody({
  children,
  style,
}: {
  children: ReactNode;
  style?: CSSProperties;
}) {
  return <div style={{ ...BASE_STYLE, ...style }}>{children}</div>;
}
