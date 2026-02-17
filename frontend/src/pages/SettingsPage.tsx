import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiGet } from "../api/client";
import { useAuth } from "../hooks/auth";
import { isAdminRole } from "../utils/roles";

type AdminSettingsResponse = {
  admin_emails: string[];
  db_admins: string[];
  is_root_admin: boolean;
};

export default function SettingsPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [isRootAdmin, setIsRootAdmin] = useState(false);

  const isAdmin = isAdminRole(user?.role);

  useEffect(() => {
    if (!isAdmin) {
      setIsRootAdmin(false);
      return;
    }

    let active = true;
    apiGet<AdminSettingsResponse>("/admin/settings/admin-emails")
      .then(() => {
        if (!active) return;
        setIsRootAdmin(true);
      })
      .catch(() => {
        if (!active) return;
        setIsRootAdmin(false);
      });

    return () => {
      active = false;
    };
  }, [isAdmin]);

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Настройки</h2>
      <p style={{ opacity: 0.8 }}>Выберите раздел для управления рабочей областью.</p>

      <div style={{ display: "grid", gap: 10, maxWidth: 420 }}>
        {isAdmin && (
          <button
            onClick={() => navigate("/users")}
            style={{ padding: "12px 14px", borderRadius: 12, cursor: "pointer", textAlign: "left" }}
          >
            Пользователи
          </button>
        )}

        {isAdmin && (
          <button
            onClick={() => navigate("/logs")}
            style={{ padding: "12px 14px", borderRadius: 12, cursor: "pointer", textAlign: "left" }}
          >
            Журнал действий
          </button>
        )}

        {isRootAdmin && (
          <button
            onClick={() => navigate("/root-admins")}
            style={{ padding: "12px 14px", borderRadius: 12, cursor: "pointer", textAlign: "left" }}
          >
            Системные администраторы
          </button>
        )}
      </div>
    </div>
  );
}
