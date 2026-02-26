import type { CSSProperties, ComponentProps } from "react";
import Button from "./Button";

type ButtonProps = ComponentProps<typeof Button>;

type Props = Omit<ButtonProps, "size"> & {
  compact?: boolean;
};

export function getCardActionButtonStyle(compact = false): CSSProperties {
  return {
    fontSize: compact ? 11 : 12,
    padding: compact ? "0 6px" : "3px 9px",
    borderRadius: compact ? 8 : 9,
    minHeight: compact ? 22 : 26,
  };
}

export default function CardActionButton({ compact = false, style, ...rest }: Props) {
  return <Button {...rest} size="sm" style={{ ...getCardActionButtonStyle(compact), ...(style || {}) }} />;
}
