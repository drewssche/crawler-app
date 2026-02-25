import type { ComponentProps, ReactNode } from "react";
import Button from "./Button";

type Props = Omit<ComponentProps<typeof Button>, "variant" | "size" | "children"> & {
  children?: ReactNode;
};

export default function IconGhostButton({ children = "×", style, ...rest }: Props) {
  return (
    <Button
      {...rest}
      variant="ghost"
      size="sm"
      style={{
        padding: "0 6px",
        minHeight: 22,
        minWidth: 22,
        lineHeight: 1,
        ...(style || {}),
      }}
    >
      {children}
    </Button>
  );
}
