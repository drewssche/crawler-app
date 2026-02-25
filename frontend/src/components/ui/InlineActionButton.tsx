import type { ButtonHTMLAttributes, ReactNode } from "react";

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  children: ReactNode;
  bold?: boolean;
};

export default function InlineActionButton({ children, bold = false, style, ...rest }: Props) {
  return (
    <button
      {...rest}
      type={rest.type ?? "button"}
      style={{
        all: "unset",
        cursor: "pointer",
        fontWeight: bold ? 700 : undefined,
        ...(style || {}),
      }}
    >
      {children}
    </button>
  );
}
