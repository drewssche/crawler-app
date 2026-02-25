import type { CSSProperties, ComponentProps } from "react";
import Button from "./Button";

type ButtonProps = ComponentProps<typeof Button>;

type Props = Omit<ButtonProps, "size"> & {
  compact?: boolean;
};

export function getCardActionButtonStyle(compact = false): CSSProperties {
  return {
    fontSize: compact ? 11 : 12,
    padding: compact ? "0 6px" : "6px 10px",
    borderRadius: compact ? 8 : 10,
    minHeight: compact ? 24 : 30,
  };
}

export default function CardActionButton({ compact = false, style, ...rest }: Props) {
  return <Button {...rest} size="sm" style={{ ...getCardActionButtonStyle(compact), ...(style || {}) }} />;
}
