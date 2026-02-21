import Button from "./Button";

type Option<T extends string> = {
  value: T;
  label: string;
};

type Props<T extends string> = {
  value: T;
  options: Array<Option<T>>;
  onChange: (value: T) => void;
};

export default function SegmentedControl<T extends string>({ value, options, onChange }: Props<T>) {
  return (
    <div
      style={{
        display: "inline-flex",
        gap: 6,
        padding: 4,
        border: "1px solid #3333",
        borderRadius: 12,
        background: "rgba(255,255,255,0.02)",
      }}
    >
      {options.map((option) => (
        <Button
          key={option.value}
          size="sm"
          variant="ghost"
          active={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </Button>
      ))}
    </div>
  );
}

