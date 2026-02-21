import type { RelevanceKind } from "../../utils/relevance";
import AccentPill from "./AccentPill";
import { relevanceBadgeMeta } from "../users/userBadgeCatalog";

export default function RelevanceBadge({ relevance }: { relevance: RelevanceKind }) {
  const meta = relevanceBadgeMeta(relevance);
  if (!meta) return null;
  return <AccentPill style={{ background: meta.bg, color: meta.color }}>{meta.label}</AccentPill>;
}
