import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from "react";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md";

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  children: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  active?: boolean;
  fullWidth?: boolean;
};

function byVariant(variant: ButtonVariant, active: boolean): CSSProperties {
  if (variant === "primary") {
    return active
      ? {
          background: "rgba(106,160,255,0.22)",
          border: "1px solid rgba(106,160,255,0.7)",
          color: "#dfe9ff",
        }
      : {
          background: "rgba(106,160,255,0.13)",
          border: "1px solid rgba(106,160,255,0.4)",
          color: "#dfe9ff",
        };
  }
  if (variant === "danger") {
    return active
      ? {
          background: "rgba(230,127,127,0.2)",
          border: "1px solid rgba(230,127,127,0.65)",
          color: "#ffd7d7",
        }
      : {
          background: "rgba(230,127,127,0.1)",
          border: "1px solid rgba(230,127,127,0.35)",
          color: "#ffd7d7",
        };
  }
  if (variant === "ghost") {
    return active
      ? {
          background: "rgba(106,160,255,0.12)",
          border: "1px solid rgba(106,160,255,0.55)",
          color: "inherit",
        }
      : {
          background: "transparent",
          border: "1px solid #3333",
          color: "inherit",
        };
  }
  return active
    ? {
        background: "rgba(255,255,255,0.1)",
        border: "1px solid rgba(255,255,255,0.25)",
        color: "inherit",
      }
    : {
        background: "#1a1a1a",
        border: "1px solid #3333",
        color: "inherit",
      };
}

function bySize(size: ButtonSize): CSSProperties {
  if (size === "sm") {
    return {
      padding: "4px 10px",
      fontSize: 12,
      borderRadius: 8,
      minHeight: 28,
    };
  }
  return {
    padding: "8px 12px",
    fontSize: 14,
    borderRadius: 10,
    minHeight: 36,
  };
}

export default function Button({
  children,
  variant = "secondary",
  size = "md",
  active = false,
  fullWidth = false,
  disabled,
  className,
  style,
  ...rest
}: Props) {
  const variantStyle = byVariant(variant, active);
  const sizeStyle = bySize(size);
  return (
    <button
      {...rest}
      className={[
        "ui-btn",
        `ui-btn--${variant}`,
        `ui-btn--${size}`,
        active ? "is-active" : "",
        className || "",
      ]
        .join(" ")
        .trim()}
      disabled={disabled}
      style={{
        ...variantStyle,
        ...sizeStyle,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.6 : 1,
        width: fullWidth ? "100%" : undefined,
        transition: "background-color 170ms ease, border-color 170ms ease, box-shadow 170ms ease, transform 170ms ease",
        ...(style || {}),
      }}
    >
      {children}
    </button>
  );
}
