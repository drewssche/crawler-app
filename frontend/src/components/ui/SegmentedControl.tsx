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
    <div className="segmented-control">
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
