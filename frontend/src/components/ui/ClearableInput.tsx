import type { CSSProperties, InputHTMLAttributes } from "react";
import Button from "./Button";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> & {
  value: string;
  onChange: (value: string) => void;
  containerStyle?: CSSProperties;
};

export default function ClearableInput({ value, onChange, containerStyle, style, ...rest }: Props) {
  return (
    <div style={{ position: "relative", ...containerStyle }}>
      <input
        {...rest}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: "100%",
          boxSizing: "border-box",
          padding: "10px 34px 10px 10px",
          borderRadius: 10,
          ...(style || {}),
        }}
      />
      {value.trim() && (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => onChange("")}
          title="Очистить"
          style={{
            position: "absolute",
            right: 4,
            top: "50%",
            transform: "translateY(-50%)",
            minHeight: 22,
            minWidth: 22,
            padding: "0 6px",
            lineHeight: 1,
          }}
        >
          ×
        </Button>
      )}
    </div>
  );
}

