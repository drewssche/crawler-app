import type { ReactNode } from "react";

type Props = {
  children: ReactNode;
};

export default function FiltersBar({ children }: Props) {
  return (
    <div
      style={{
        display: "grid",
        gap: 8,
        padding: 10,
        border: "1px solid #3333",
        borderRadius: 12,
        background: "rgba(255,255,255,0.02)",
      }}
    >
      {children}
    </div>
  );
}
