import type { CSSProperties, ReactNode } from "react";

type Props = {
  children: ReactNode;
  style?: CSSProperties;
};

export default function Card({ children, style }: Props) {
  return (
    <div
      style={{
        border: "1px solid #3333",
        borderRadius: 12,
        padding: 10,
        background: "rgba(255,255,255,0.03)",
        ...style,
      }}
    >
      {children}
    </div>
  );
}
