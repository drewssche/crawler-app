import type { CSSProperties } from "react";
import AccentPill from "./AccentPill";
import { getHttpStatusVisualMeta } from "../../utils/httpStatusVisual";

type Props = {
  status: string | number | null | undefined;
  showCode?: boolean;
  style?: CSSProperties;
};

export default function HttpStatusBadge({ status, showCode = true, style }: Props) {
  const meta = getHttpStatusVisualMeta(status);
  const label = meta.code == null
    ? meta.toneLabel
    : showCode
      ? `status ${meta.code}: ${meta.toneLabel}`
      : meta.toneLabel;
  return (
    <AccentPill
      title={meta.hint}
      style={{
        background: meta.chipBg,
        color: meta.color,
        border: "1px solid rgba(255,255,255,0.14)",
        textTransform: "lowercase",
        ...style,
      }}
    >
      {label}
    </AccentPill>
  );
}
