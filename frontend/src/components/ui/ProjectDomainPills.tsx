import { splitProjectDomainsCsv, summarizeProjectDomains } from "../../utils/projectDomains";
import { MetaText } from "./StatusText";

type Props = {
  csv: string | null | undefined;
  fallbackUrl?: string | null;
  emptyLabel?: string;
};

export default function ProjectDomainPills({ csv, fallbackUrl, emptyLabel = "Домены не заданы." }: Props) {
  const domains = splitProjectDomainsCsv(csv);
  if (domains.length <= 0) {
    const fallback = summarizeProjectDomains(csv, fallbackUrl);
    if (!fallback || fallback === "домен не задан") return <MetaText>{emptyLabel}</MetaText>;
    return (
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <span
          style={{
            padding: "3px 8px",
            borderRadius: 999,
            border: "1px solid rgba(255,255,255,0.2)",
            background: "rgba(255,255,255,0.04)",
            fontSize: 12,
          }}
        >
          {fallback}
        </span>
      </div>
    );
  }
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {domains.map((domain) => (
        <span
          key={domain}
          style={{
            padding: "3px 8px",
            borderRadius: 999,
            border: "1px solid rgba(255,255,255,0.2)",
            background: "rgba(255,255,255,0.04)",
            fontSize: 12,
          }}
        >
          {domain}
        </span>
      ))}
    </div>
  );
}
