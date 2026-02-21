import { Navigate } from "react-router-dom";
import { useAuth } from "../hooks/auth";
import { hasPermission, type Permission } from "../utils/permissions";

type Props = {
  permission: Permission;
  children: React.ReactNode;
};

export default function RequirePermission({ permission, children }: Props) {
  const { user } = useAuth();
  if (!hasPermission(user?.role, permission)) {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
}

