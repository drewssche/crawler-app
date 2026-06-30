import type { ReactNode } from "react";
import CardActionButton from "./CardActionButton";

type Option<T extends string> = {
  value: T;
  label: ReactNode;
  title?: string;
  disabled?: boolean;
};

type Props<T extends string> = {
  value: T;
  options: Array<Option<T>>;
  onChange: (value: T) => void;
  disabled?: boolean;
  ariaLabel: string;
};

export default function ChipPicker<T extends string>({ value, options, onChange, disabled = false, ariaLabel }: Props<T>) {
  return (
    <div role="group" aria-label={ariaLabel} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <CardActionButton
            key={option.value}
            type="button"
            compact
            variant={active ? "primary" : "ghost"}
            active={active}
            aria-pressed={active}
            disabled={disabled || option.disabled}
            title={option.title}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </CardActionButton>
        );
      })}
    </div>
  );
}
