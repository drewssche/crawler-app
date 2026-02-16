import { useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../hooks/auth";

export default function RequireAuth({ children }: { children: React.ReactNode }) {
  const { token, refreshMe } = useAuth();
  const location = useLocation();
  const [checking, setChecking] = useState(true);
  const [valid, setValid] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      if (!token) {
        if (!active) return;
        setValid(false);
        setChecking(false);
        return;
      }
      const me = await refreshMe();
      if (!active) return;
      setValid(Boolean(me));
      setChecking(false);
    })();
    return () => {
      active = false;
    };
  }, [token]);

  if (!token) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (checking) {
    return <div style={{ padding: 24 }}>Проверка авторизации...</div>;
  }

  if (!valid) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <>{children}</>;
}
