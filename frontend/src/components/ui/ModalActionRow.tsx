import type { CSSProperties, ReactNode } from "react";

type Props = {
  children: ReactNode;
  style?: CSSProperties;
};

export default function ModalActionRow({ children, style }: Props) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "flex-end",
        gap: 8,
        marginTop: 4,
        ...(style || {}),
      }}
    >
      {children}
    </div>
  );
}

