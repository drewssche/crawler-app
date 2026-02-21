import AccentPill from "./AccentPill";
import { type DisplayRole } from "../../utils/roles";
import { roleBadgeHint, roleBadgeMeta } from "../users/userBadgeCatalog";

type Props = { role: DisplayRole };

export default function RoleBadge({ role }: Props) {
  if (role === "не назначена") return null;
  const meta = roleBadgeMeta(role);
  return <AccentPill style={{ background: meta.bg, color: meta.color }} title={roleBadgeHint(role)}>{meta.label}</AccentPill>;
}
