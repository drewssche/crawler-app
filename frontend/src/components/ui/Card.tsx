import { forwardRef } from "react";
import type { CSSProperties, HTMLAttributes, ReactNode } from "react";

type Props = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
  style?: CSSProperties;
  className?: string;
};

const Card = forwardRef<HTMLDivElement, Props>(({ children, style, className, ...rest }, ref) => (
  <div
    ref={ref}
    className={className}
    {...rest}
    style={{
      border: "1px solid #3333",
      borderRadius: 12,
      padding: 10,
      background: "rgba(255,255,255,0.03)",
      ...style,
    }}
  >
    {children}
  </div>
));

Card.displayName = "Card";

export default Card;
