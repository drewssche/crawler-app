import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../hooks/auth";

export default function RequireAuth({ children }: { children: React.ReactNode }) {
  const { token, user, loading } = useAuth();
  const location = useLocation();

  if (!token) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (loading) {
    return <div style={{ padding: 24 }}>{"\u041f\u0440\u043e\u0432\u0435\u0440\u043a\u0430 \u0430\u0432\u0442\u043e\u0440\u0438\u0437\u0430\u0446\u0438\u0438..."}</div>;
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <>{children}</>;
}
