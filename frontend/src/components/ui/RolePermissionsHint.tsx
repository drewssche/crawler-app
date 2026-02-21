import { useEffect, useState } from "react";
import { getPermissionsMatrixCached, type PermissionsMatrix } from "../../utils/permissionsMatrixCache";
import Card from "./Card";
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

  return (
    <Card style={{ borderColor: "rgba(120,166,255,0.5)", background: "rgba(120,166,255,0.06)" }}>
      <h3 style={{ margin: 0 }}>{"\u0420\u043e\u043b\u0438 \u0438 \u043f\u0440\u0430\u0432\u0430 (\u0434\u0438\u043d\u0430\u043c\u0438\u0447\u0435\u0441\u043a\u0438)"}</h3>
      <div style={{ marginTop: 8, opacity: 0.8, fontSize: 13 }}>
        {"\u041f\u043e\u0434\u0441\u043a\u0430\u0437\u043a\u0430 \u0441\u0442\u0440\u043e\u0438\u0442\u0441\u044f \u0438\u0437 backend-\u043c\u0430\u0442\u0440\u0438\u0446\u044b \u043f\u0440\u0430\u0432 \u0438 \u0430\u0432\u0442\u043e\u043c\u0430\u0442\u0438\u0447\u0435\u0441\u043a\u0438 \u043e\u0431\u043d\u043e\u0432\u043b\u044f\u0435\u0442\u0441\u044f \u043f\u0440\u0438 \u0438\u0437\u043c\u0435\u043d\u0435\u043d\u0438\u044f\u0445."}
      </div>
      {error && <div style={{ marginTop: 8, color: "#d55" }}>{error}</div>}
      {data && (
        <div style={{ overflowX: "auto", marginTop: 10 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", padding: "8px 6px", borderBottom: "1px solid #3333" }}>{"\u0412\u043e\u0437\u043c\u043e\u0436\u043d\u043e\u0441\u0442\u044c"}</th>
                {roles.map((r) => (
                  <th key={r} style={{ textAlign: "center", padding: "8px 6px", borderBottom: "1px solid #3333" }}>
                    <RoleBadge role={r} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.capabilities.map((cap) => (
                <tr key={cap.id}>
                  <td style={{ padding: "8px 6px", borderBottom: "1px solid #3333" }}>{cap.label}</td>
                  {roles.map((r) => (
                    <td key={`${cap.id}-${r}`} style={{ textAlign: "center", padding: "8px 6px", borderBottom: "1px solid #3333" }}>
                      <Mark ok={cap.roles.includes(r)} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
