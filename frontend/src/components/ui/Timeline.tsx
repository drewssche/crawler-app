import type { ReactNode } from "react";

type Item = {
  key: string | number;
  content: ReactNode;
};

type Props = {
  items: Item[];
};

export default function Timeline({ items }: Props) {
  return (
    <div style={{ display: "grid", gap: 10 }}>
      {items.map((item) => (
        <div key={item.key} style={{ display: "grid", gridTemplateColumns: "8px 1fr", gap: 10 }}>
          <div style={{ borderRadius: 4, background: "rgba(106,160,255,0.45)" }} />
          <div>{item.content}</div>
        </div>
      ))}
    </div>
  );
}
