import type { CSSProperties, ReactNode } from "react";

type Props = {
  label: ReactNode;
  value?: ReactNode;
  title?: string;
  boldValue?: boolean;
  style?: CSSProperties;
};

export default function InlineInfoRow({
  label,
  value,
  title,
  boldValue = false,
  style,
}: Props) {
  return (
    <div
      title={title}
      style={{
        fontSize: 13,
        opacity: 0.84,
        ...style,
      }}
    >
      <span>{label}</span>
      {value !== undefined ? (
        <>
          {" "}
          {boldValue ? <b>{value}</b> : value}
        </>
      ) : null}
    </div>
  );
}

