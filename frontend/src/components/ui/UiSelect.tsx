import { useState } from "react";
import type {
  CSSProperties,
  FocusEvent,
  KeyboardEvent,
  MouseEvent,
  SelectHTMLAttributes,
} from "react";

type Props = SelectHTMLAttributes<HTMLSelectElement> & {
  containerStyle?: CSSProperties;
};

export default function UiSelect({ style, containerStyle, className, children, ...rest }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const {
    onMouseDown,
    onKeyDown,
    onBlur,
    onChange,
    disabled,
    ...selectProps
  } = rest;

  const handleMouseDown = (event: MouseEvent<HTMLSelectElement>) => {
    onMouseDown?.(event);
    if (event.defaultPrevented || disabled) return;

    // Re-click on focused/open native select usually closes popup without blur/change.
    // Toggle local state here so arrow state does not get stuck in "open".
    if (isOpen && document.activeElement === event.currentTarget) {
      setIsOpen(false);
      return;
    }

    setIsOpen(true);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLSelectElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented || disabled) return;
    if (event.key === "Escape" || event.key === "Tab") {
      setIsOpen(false);
      return;
    }
    if (
      event.key === "Enter" ||
      event.key === " " ||
      event.key === "ArrowDown" ||
      event.key === "ArrowUp" ||
      event.key === "F4"
    ) {
      setIsOpen(true);
    }
  };

  const handleBlur = (event: FocusEvent<HTMLSelectElement>) => {
    onBlur?.(event);
    setIsOpen(false);
  };

  return (
    <div className="ui-select-wrap" style={containerStyle}>
      <select
        {...selectProps}
        disabled={disabled}
        className={["ui-select", className || ""].join(" ").trim()}
        style={style}
        onMouseDown={handleMouseDown}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        onChange={(event) => {
          onChange?.(event);
          setIsOpen(false);
        }}
      >
        {children}
      </select>
      <span aria-hidden className={["ui-select-arrow", isOpen ? "is-open" : ""].join(" ").trim()} />
    </div>
  );
}
