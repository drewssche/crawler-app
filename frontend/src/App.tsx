import { Navigate, Route, Routes } from "react-router-dom";
import RequireAuth from "./components/RequireAuth";
import AppLayout from "./components/layout/AppLayout";
import ComparePage from "./pages/ComparePage";
import LoginPage from "./pages/LoginPage";
import ProfileDashboardPage from "./pages/ProfileDashboardPage";
import ProfileNewPage from "./pages/ProfileNewPage";
import UsersPage from "./pages/UsersPage";

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
        <Route index element={<Navigate to="/profiles/new" replace />} />
        <Route path="profiles/new" element={<ProfileNewPage />} />
        <Route path="profiles/:id" element={<ProfileDashboardPage />} />
        <Route path="compare" element={<ComparePage />} />
        <Route path="users" element={<UsersPage />} />
      </Route>

      <Route path="*" element={<Navigate to="/profiles/new" replace />} />
    </Routes>
  );
}
