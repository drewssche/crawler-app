import type { CSSProperties, SelectHTMLAttributes } from "react";

type Props = SelectHTMLAttributes<HTMLSelectElement> & {
  containerStyle?: CSSProperties;
};

export default function UiSelect({ style, containerStyle, className, children, ...rest }: Props) {
  return (
    <div className="ui-select-wrap" style={containerStyle}>
      <select
        {...rest}
        className={["ui-select", className || ""].join(" ").trim()}
        style={style}
      >
        {children}
      </select>
      <span aria-hidden className="ui-select-arrow">
        ▾
      </span>
    </div>
  );
}
