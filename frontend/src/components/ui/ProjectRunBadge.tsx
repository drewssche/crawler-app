import AccentPill from "./AccentPill";
import { getProjectRunBadgeMeta } from "./projectRunBadgeMeta";

type Props = {
  status?: string | null;
  compact?: boolean;
};

export default function ProjectRunBadge({ status, compact = false }: Props) {
  const meta = getProjectRunBadgeMeta(status);
  const isRunning = (status || "").toUpperCase() === "RUNNING";
  const compactStyle = compact
    ? {
        width: 30,
        minWidth: 30,
        height: 30,
        padding: 0,
        borderRadius: 999,
        justifyContent: "center" as const,
      }
    : {
        padding: "3px 8px",
      };
  return (
    <AccentPill
      tone={meta.tone}
      title={meta.hint}
      style={{
        border: "1px solid rgba(255,255,255,0.14)",
        whiteSpace: "nowrap",
        ...compactStyle,
      }}
    >
      {compact ? (
        isRunning ? (
          <span
            className="project-run-spinner"
            aria-label="Идет прогон"
            style={{
              width: 14,
              height: 14,
              borderRadius: "50%",
              border: "2px solid currentColor",
              borderTopColor: "transparent",
              display: "inline-block",
            }}
          />
        ) : (
          <span
            style={{
              width: 14,
              height: 14,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 13,
              lineHeight: 1,
              fontWeight: 800,
            }}
          >
            {meta.icon}
          </span>
        )
      ) : meta.label}
    </AccentPill>
  );
}
