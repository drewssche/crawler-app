import { MetaText, StatusText } from "./StatusText";

type Props = {
  applied: number;
  total: number;
  subject?: string;
  showPartial?: boolean;
  partialText?: string;
  showNone?: boolean;
  noneText?: string;
};

export default function ApplicabilityHint({
  applied,
  total,
  subject = "записям",
  showPartial = false,
  partialText,
  showNone = false,
  noneText = "Действие недоступно для текущей выборки.",
}: Props) {
  return (
    <>
      <MetaText opacity={0.82}>
        Применится к {subject}: {applied} из {total}
      </MetaText>
      {showPartial && partialText && <MetaText opacity={0.82}>{partialText}</MetaText>}
      {showNone && (
        <StatusText tone="warning" style={{ fontSize: 12, opacity: 0.82 }}>
          {noneText}
        </StatusText>
      )}
    </>
  );
}

