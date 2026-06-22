import type { CSSProperties, ReactNode } from "react";

type Props = {
  children: ReactNode;
  style?: CSSProperties;
};

export default function CardFooterActions({ children, style }: Props) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "flex-end",
        alignItems: "center",
        gap: 8,
        marginTop: 6,
        ...(style || {}),
      }}
    >
      {children}
    </div>
  );
}
