import type { CSSProperties } from "react";
import Button from "./Button";

type Preset = {
  label: string;
  value: number;
};

type Props = {
  presets: Preset[];
  value: number;
  onChange: (value: number) => void;
  active?: boolean;
  size?: "sm" | "md";
  style?: CSSProperties;
};

export default function RangePresetGroup({
  presets,
  value,
  onChange,
  active = true,
  size = "sm",
  style,
}: Props) {
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", ...(style || {}) }}>
      {presets.map((preset) => (
        <Button
          key={preset.value}
          size={size}
          variant={active && value === preset.value ? "primary" : "ghost"}
          onClick={() => onChange(preset.value)}
        >
          {preset.label}
        </Button>
      ))}
    </div>
  );
}

