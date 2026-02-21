import type { CSSProperties, HTMLAttributes, ReactNode } from "react";

type Tone = "neutral" | "info" | "success" | "warning" | "danger";

type Props = {
  children: ReactNode;
  tone?: Tone;
  style?: CSSProperties;
} & HTMLAttributes<HTMLSpanElement>;

const TONE_STYLES: Record<Tone, CSSProperties> = {
  neutral: { background: "rgba(158,167,179,0.14)", color: "#9ea7b3" },
  info: { background: "rgba(120,166,255,0.14)", color: "#78a6ff" },
  success: { background: "rgba(110,199,181,0.14)", color: "#6ec7b5" },
  warning: { background: "rgba(240,168,94,0.14)", color: "#f0a85e" },
  danger: { background: "rgba(230,127,127,0.14)", color: "#e67f7f" },
};

export default function AccentPill({ children, tone = "neutral", style, ...rest }: Props) {
  return (
    <span
      {...rest}
      style={{
        ...TONE_STYLES[tone],
        padding: "2px 8px",
        borderRadius: 999,
        fontWeight: 700,
        display: "inline-flex",
        alignItems: "center",
        ...style,
      }}
    >
      {children}
    </span>
  );
}
