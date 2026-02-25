import type { ComponentProps } from "react";
import Button from "./Button";

type Props = Omit<ComponentProps<typeof Button>, "variant" | "size">;

export default function ReasonPresetButton({ style, ...rest }: Props) {
  return <Button {...rest} variant="ghost" size="sm" style={{ borderRadius: 999, ...(style || {}) }} />;
}
