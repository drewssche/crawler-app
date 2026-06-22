import AccentPill from "./AccentPill";

type Props = {
  label: string;
  tone?: "neutral" | "info" | "success" | "warning" | "danger";
};

export default function ProjectInfoBadge({ label, tone = "info" }: Props) {
  return (
    <AccentPill
      tone={tone}
      style={{
        border: "1px solid rgba(255,255,255,0.14)",
        whiteSpace: "nowrap",
        padding: "3px 8px",
      }}
    >
      {label}
    </AccentPill>
  );
}
