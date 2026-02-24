import { useEffect, useState } from "react";
import { getPermissionsMatrixCached, type PermissionsMatrix } from "../../utils/permissionsMatrixCache";
import HintCard from "./HintCard";
import HintTable from "./HintTable";
import RoleBadge from "./RoleBadge";

function Mark({ ok }: { ok: boolean }) {
  return <span style={{ color: ok ? "#6ec7b5" : "#8d96a1", fontWeight: 700 }}>{ok ? "\u2713" : "\u2014"}</span>;
}

const ROLE_ORDER = ["viewer", "editor", "admin", "root-admin"];

export default function RolePermissionsHint() {
  const [data, setData] = useState<PermissionsMatrix | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    getPermissionsMatrixCached()
      .then((result) => {
        if (!active) return;
        setData(result);
      })
      .catch(() => {
        if (!active) return;
        setError("\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044c \u043c\u0430\u0442\u0440\u0438\u0446\u0443 \u0440\u043e\u043b\u0435\u0439.");
      });
    return () => {
      active = false;
    };
  }, []);

  const roles = ROLE_ORDER.filter((r) => data?.roles.some((x) => x.role === r));
  const columns = [
    { key: "capability", label: "Возможность", align: "left" as const },
    ...roles.map((role) => ({
      key: role,
      label: <RoleBadge role={role} />,
      align: "center" as const,
    })),
  ];
  const rows = (data?.capabilities || []).map((cap) => ({
    id: cap.id,
    cells: {
      capability: cap.label,
      ...Object.fromEntries(roles.map((role) => [role, <Mark key={`${cap.id}:${role}`} ok={cap.roles.includes(role)} />])),
    },
  }));

  return (
    <HintCard
      title={"\u0420\u043e\u043b\u0438 \u0438 \u043f\u0440\u0430\u0432\u0430 (\u0434\u0438\u043d\u0430\u043c\u0438\u0447\u0435\u0441\u043a\u0438)"}
      subtitle={"\u041f\u043e\u0434\u0441\u043a\u0430\u0437\u043a\u0430 \u0441\u0442\u0440\u043e\u0438\u0442\u0441\u044f \u0438\u0437 backend-\u043c\u0430\u0442\u0440\u0438\u0446\u044b \u043f\u0440\u0430\u0432 \u0438 \u0430\u0432\u0442\u043e\u043c\u0430\u0442\u0438\u0447\u0435\u0441\u043a\u0438 \u043e\u0431\u043d\u043e\u0432\u043b\u044f\u0435\u0442\u0441\u044f \u043f\u0440\u0438 \u0438\u0437\u043c\u0435\u043d\u0435\u043d\u0438\u044f\u0445."}
    >
      {error && <div style={{ marginTop: 8, color: "#d55" }}>{error}</div>}
      {data && <HintTable columns={columns} rows={rows} fontSize={14} cellPadding="8px 6px" />}
    </HintCard>
  );
}
