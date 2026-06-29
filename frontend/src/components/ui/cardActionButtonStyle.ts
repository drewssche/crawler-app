import type { CSSProperties } from "react";

export function getCardActionButtonStyle(compact = false): CSSProperties {
  return {
    fontSize: compact ? 11 : 12,
    padding: compact ? "0 6px" : "3px 9px",
    borderRadius: compact ? 8 : 9,
    minHeight: compact ? 22 : 26,
  };
}
