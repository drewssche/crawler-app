import type { CSSProperties, HTMLAttributes, ReactNode } from "react";

type MessageTone = "error" | "danger" | "success" | "warning" | "muted";

const TONE_STYLE: Record<MessageTone, CSSProperties> = {
  error: { color: "#e67f7f" },
  danger: { color: "#d55" },
  success: { color: "#8fd18f" },
  warning: { color: "#e7a15a" },
  muted: { opacity: 0.78 },
};

type BaseProps = Omit<HTMLAttributes<HTMLDivElement>, "children"> & {
  children: ReactNode;
  style?: CSSProperties;
};

export function MetaText({
  children,
  size = 12,
  opacity = 0.8,
  style,
  ...rest
}: BaseProps & { size?: number; opacity?: number }) {
  return (
    <div {...rest} style={{ fontSize: size, opacity, ...(style || {}) }}>
      {children}
    </div>
  );
}

export function StatusText({
  children,
  tone,
  style,
  ...rest
}: BaseProps & { tone: MessageTone }) {
  return (
    <div {...rest} style={{ ...TONE_STYLE[tone], ...(style || {}) }}>
      {children}
    </div>
  );
}

