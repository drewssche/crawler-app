import { Suspense, lazy } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import RequireAuth from "./components/RequireAuth";
import RequirePermission from "./components/RequirePermission";
import AppLayout from "./components/layout/AppLayout";
import ComparePage from "./pages/ComparePage";
import LoginPage from "./pages/LoginPage";
import ProjectDashboardPage from "./pages/ProjectDashboardPage";
import ProjectNewPage from "./pages/ProjectNewPage";
import PageInspectorPage from "./pages/PageInspectorPage";
import RootAdminsPage from "./pages/RootAdminsPage";
import SettingsPage from "./pages/SettingsPage";
import WorkspaceHomePage from "./pages/WorkspaceHomePage";
import UiDebugPage from "./pages/UiDebugPage";

const UsersPage = lazy(() => import("./pages/UsersPage"));
const ActivityLogPage = lazy(() => import("./pages/ActivityLogPage"));
const MonitoringPage = lazy(() => import("./pages/MonitoringPage"));
const EventsPage = lazy(() => import("./pages/EventsPage"));

function RouteFallback() {
  return <div style={{ padding: 16, opacity: 0.78 }}>Загрузка страницы...</div>;
}

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
        <Route
          index
          element={
            <RequirePermission permission="data.view">
              <WorkspaceHomePage />
            </RequirePermission>
          }
        />
        <Route
          path="settings"
          element={
            <RequirePermission permission="users.manage">
              <SettingsPage />
            </RequirePermission>
          }
        />
        <Route
          path="profiles/new"
          element={
            <RequirePermission permission="profiles.edit">
              <ProjectNewPage />
            </RequirePermission>
          }
        />
        <Route
          path="profiles/:id"
          element={
            <RequirePermission permission="data.view">
              <ProjectDashboardPage />
            </RequirePermission>
          }
        />
        <Route
          path="profiles/:id/compare"
          element={
            <RequirePermission permission="data.view">
              <ComparePage />
            </RequirePermission>
          }
        />
        <Route
          path="profiles/:id/inspect"
          element={
            <RequirePermission permission="data.view">
              <PageInspectorPage />
            </RequirePermission>
          }
        />
        <Route
          path="users"
          element={
            <RequirePermission permission="users.manage">
              <Suspense fallback={<RouteFallback />}>
                <UsersPage />
              </Suspense>
            </RequirePermission>
          }
        />
        <Route
          path="logs"
          element={
            <RequirePermission permission="audit.view">
              <Suspense fallback={<RouteFallback />}>
                <ActivityLogPage />
              </Suspense>
            </RequirePermission>
          }
        />
        <Route
          path="monitoring"
          element={
            <RequirePermission permission="audit.view">
              <Suspense fallback={<RouteFallback />}>
                <MonitoringPage />
              </Suspense>
            </RequirePermission>
          }
        />
        <Route
          path="events"
          element={
            <RequirePermission permission="events.view">
              <Suspense fallback={<RouteFallback />}>
                <EventsPage />
              </Suspense>
            </RequirePermission>
          }
        />
        <Route
          path="root-admins"
          element={
            <RequirePermission permission="root_admins.manage">
              <RootAdminsPage />
            </RequirePermission>
          }
        />
        <Route
          path="ui-debug"
          element={
            <RequirePermission permission="users.manage">
              <UiDebugPage />
            </RequirePermission>
          }
        />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
