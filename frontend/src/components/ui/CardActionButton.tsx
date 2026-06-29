import type { ComponentProps } from "react";
import Button from "./Button";
import { getCardActionButtonStyle } from "./cardActionButtonStyle";

type ButtonProps = ComponentProps<typeof Button>;

type Props = Omit<ButtonProps, "size"> & {
  compact?: boolean;
};

export default function CardActionButton({ compact = false, style, ...rest }: Props) {
  return <Button {...rest} size="sm" style={{ ...getCardActionButtonStyle(compact), ...(style || {}) }} />;
}
