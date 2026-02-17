import AccentPill from "./AccentPill";
import { type DisplayRole } from "../../utils/roles";

type Props = {
  role: DisplayRole;
};

function roleTone(role: DisplayRole): "info" | "success" | "warning" | "danger" | "neutral" {
  if (role === "viewer") return "info";
  if (role === "editor") return "success";
  if (role === "admin") return "warning";
  if (role === "root-admin") return "danger";
  return "neutral";
}

export default function RoleBadge({ role }: Props) {
  return <AccentPill tone={roleTone(role)}>роль: {role}</AccentPill>;
}
