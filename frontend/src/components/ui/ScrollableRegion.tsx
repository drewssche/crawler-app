import { type CSSProperties, type ReactNode } from "react";

const BASE_STYLE: CSSProperties = {
  minHeight: 0,
  overflowY: "auto",
  overflowX: "hidden",
};

export default function ScrollableRegion({
  children,
  style,
}: {
  children: ReactNode;
  style?: CSSProperties;
}) {
  return <div style={{ ...BASE_STYLE, ...style }}>{children}</div>;
}
