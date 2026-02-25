import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from "react";

type ButtonVariant = "primary" | "accent" | "secondary" | "ghost" | "danger" | "export" | "panel-toggle";
type ButtonSize = "sm" | "md";

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  children: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  active?: boolean;
  fullWidth?: boolean;
  exportProgress?: number | null;
};

function byVariant(variant: ButtonVariant, active: boolean): CSSProperties {
  if (variant === "primary") {
    return active
      ? {
          background: "rgba(58,92,158,0.94)",
          border: "1px solid rgba(136,178,240,0.78)",
          color: "#f2f7ff",
        }
      : {
          background: "rgba(33,48,74,0.92)",
          border: "1px solid rgba(120,166,255,0.62)",
          color: "#e8efff",
        };
  }
  if (variant === "accent") {
    return active
      ? {
          background: "rgba(68,76,88,0.95)",
          border: "1px solid rgba(184,194,212,0.62)",
          color: "#f0f3f9",
        }
      : {
          background: "rgba(12,15,20,0.99)",
          border: "1px solid rgba(255,255,255,0.22)",
          color: "#e4e9f2",
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
  if (variant === "panel-toggle") {
    return active
      ? {
          background: "rgba(56,78,112,0.72)",
          border: "1px solid rgba(120,166,255,0.66)",
          color: "#e6efff",
        }
      : {
          background: "rgba(255,255,255,0.06)",
          border: "1px solid rgba(255,255,255,0.24)",
          color: "#e4e8f3",
        };
  }
  if (variant === "export") {
    return active
      ? {
          background: "rgba(120,166,255,0.2)",
          border: "1px solid rgba(120,166,255,0.68)",
          color: "#e7efff",
        }
      : {
          background: "rgba(120,166,255,0.1)",
          border: "1px solid rgba(120,166,255,0.42)",
          color: "#e7efff",
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
  exportProgress,
  disabled,
  className,
  style,
  ...rest
}: Props) {
  const variantStyle = byVariant(variant, active);
  const sizeStyle = bySize(size);
  const normalizedProgress =
    exportProgress === undefined
      ? null
      : exportProgress == null
        ? 36
        : Math.max(0, Math.min(100, exportProgress));
  const showExportProgress = variant === "export" && normalizedProgress != null;
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
        position: "relative",
        overflow: "hidden",
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
      aria-busy={showExportProgress ? true : undefined}
    >
      {showExportProgress && (
        <span
          aria-hidden
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: `${normalizedProgress}%`,
            background: "linear-gradient(90deg, rgba(120,166,255,0.2), rgba(120,166,255,0.34))",
            transition: "width 180ms ease",
          }}
        />
      )}
      <span style={{ position: "relative", zIndex: 1 }}>{children}</span>
    </button>
  );
}
