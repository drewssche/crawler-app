import AccentPill from "../ui/AccentPill";
import RelevanceBadge from "../ui/RelevanceBadge";
import RoleBadge from "../ui/RoleBadge";
import type { DisplayRole } from "../../utils/roles";

type DbPresence = "in_db" | "only_env";

export default function IdentityBadgeRow({
  role,
  showSelf = false,
  dbPresence,
  selfLabel = "Вы",
  inDbLabel = "есть в БД",
  onlyEnvLabel = "только ADMIN_EMAILS",
}: {
  role: DisplayRole;
  showSelf?: boolean;
  dbPresence?: DbPresence;
  selfLabel?: string;
  inDbLabel?: string;
  onlyEnvLabel?: string;
}) {
  return (
    <>
      <RoleBadge role={role} />
      {showSelf && (selfLabel === "Вы" ? <RelevanceBadge relevance="self" /> : <AccentPill tone="info">{selfLabel}</AccentPill>)}
      {dbPresence === "in_db" && <AccentPill tone="success">{inDbLabel}</AccentPill>}
      {dbPresence === "only_env" && <AccentPill tone="neutral">{onlyEnvLabel}</AccentPill>}
    </>
  );
}
