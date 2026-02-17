import { Navigate, Route, Routes } from "react-router-dom";
import RequireAuth from "./components/RequireAuth";
import AppLayout from "./components/layout/AppLayout";
import ComparePage from "./pages/ComparePage";
import ActivityLogPage from "./pages/ActivityLogPage";
import LoginPage from "./pages/LoginPage";
import ProfileDashboardPage from "./pages/ProfileDashboardPage";
import ProfileNewPage from "./pages/ProfileNewPage";
import RootAdminsPage from "./pages/RootAdminsPage";
import SettingsPage from "./pages/SettingsPage";
import UsersPage from "./pages/UsersPage";
import WorkspaceHomePage from "./pages/WorkspaceHomePage";

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route
        path="/*"
        element={
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        }
      >
        <Route index element={<WorkspaceHomePage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="profiles/new" element={<ProfileNewPage />} />
        <Route path="profiles/:id" element={<ProfileDashboardPage />} />
        <Route path="compare" element={<ComparePage />} />
        <Route path="users" element={<UsersPage />} />
        <Route path="logs" element={<ActivityLogPage />} />
        <Route path="root-admins" element={<RootAdminsPage />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
