import { forwardRef } from "react";
import type { CSSProperties, HTMLAttributes, ReactNode } from "react";

type CardVariant = "default" | "hint" | "warning";

type Props = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
  style?: CSSProperties;
  className?: string;
  variant?: CardVariant;
  interactive?: boolean;
};

const VARIANT_STYLE: Record<CardVariant, CSSProperties> = {
  default: {
    border: "1px solid #3333",
    background: "rgba(255,255,255,0.03)",
  },
  hint: {
    border: "1px solid rgba(120,166,255,0.5)",
    background: "rgba(120,166,255,0.06)",
  },
  warning: {
    border: "1px solid rgba(255,166,0,0.45)",
    background: "rgba(255,255,255,0.03)",
  },
};

function joinClassName(interactive: boolean, className?: string): string | undefined {
  if (interactive && className) return `interactive-row ${className}`;
  if (interactive) return "interactive-row";
  return className;
}

const Card = forwardRef<HTMLDivElement, Props>(
  ({ children, style, className, variant = "default", interactive = false, ...rest }, ref) => (
    <div
      ref={ref}
      className={joinClassName(interactive, className)}
      {...rest}
      style={{
        borderRadius: 12,
        padding: 10,
        ...VARIANT_STYLE[variant],
        ...style,
      }}
    >
      {children}
    </div>
  ),
);

Card.displayName = "Card";

export default Card;
