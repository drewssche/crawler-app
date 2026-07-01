import { Suspense, lazy, type ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import RequireAuth from "./components/RequireAuth";
import RequirePermission from "./components/RequirePermission";
import AppLayout from "./components/layout/AppLayout";
import LoginPage from "./pages/LoginPage";

const WorkspaceHomePage = lazy(() => import("./pages/WorkspaceHomePage"));
const ProjectNewPage = lazy(() => import("./pages/ProjectNewPage"));
const ProjectDashboardPage = lazy(() => import("./pages/ProjectDashboardPage"));
const ComparePage = lazy(() => import("./pages/ComparePage"));
const PageInspectorPage = lazy(() => import("./pages/PageInspectorPage"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));
const RootAdminsPage = lazy(() => import("./pages/RootAdminsPage"));
const UiDebugPage = lazy(() => import("./pages/UiDebugPage"));
const UsersPage = lazy(() => import("./pages/UsersPage"));
const ActivityLogPage = lazy(() => import("./pages/ActivityLogPage"));
const MonitoringPage = lazy(() => import("./pages/MonitoringPage"));
const EventsPage = lazy(() => import("./pages/EventsPage"));

function RouteFallback() {
  return <div style={{ padding: 16, opacity: 0.78 }}>Загрузка страницы...</div>;
}

function LazyRoute({ children }: { children: ReactNode }) {
  return <Suspense fallback={<RouteFallback />}>{children}</Suspense>;
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
              <LazyRoute>
                <WorkspaceHomePage />
              </LazyRoute>
            </RequirePermission>
          }
        />
        <Route
          path="settings"
          element={
            <RequirePermission permission="users.manage">
              <LazyRoute>
                <SettingsPage />
              </LazyRoute>
            </RequirePermission>
          }
        />
        <Route
          path="projects/new"
          element={
            <RequirePermission permission="projects.edit">
              <LazyRoute>
                <ProjectNewPage />
              </LazyRoute>
            </RequirePermission>
          }
        />
        <Route
          path="projects/:id"
          element={
            <RequirePermission permission="data.view">
              <LazyRoute>
                <ProjectDashboardPage />
              </LazyRoute>
            </RequirePermission>
          }
        />
        <Route
          path="projects/:id/compare"
          element={
            <RequirePermission permission="data.view">
              <LazyRoute>
                <ComparePage />
              </LazyRoute>
            </RequirePermission>
          }
        />
        <Route
          path="projects/:id/inspect"
          element={
            <RequirePermission permission="data.view">
              <LazyRoute>
                <PageInspectorPage />
              </LazyRoute>
            </RequirePermission>
          }
        />
        <Route
          path="users"
          element={
            <RequirePermission permission="users.manage">
              <LazyRoute>
                <UsersPage />
              </LazyRoute>
            </RequirePermission>
          }
        />
        <Route
          path="logs"
          element={
            <RequirePermission permission="audit.view">
              <LazyRoute>
                <ActivityLogPage />
              </LazyRoute>
            </RequirePermission>
          }
        />
        <Route
          path="monitoring"
          element={
            <RequirePermission permission="audit.view">
              <LazyRoute>
                <MonitoringPage />
              </LazyRoute>
            </RequirePermission>
          }
        />
        <Route
          path="events"
          element={
            <RequirePermission permission="events.view">
              <LazyRoute>
                <EventsPage />
              </LazyRoute>
            </RequirePermission>
          }
        />
        <Route
          path="root-admins"
          element={
            <RequirePermission permission="root_admins.manage">
              <LazyRoute>
                <RootAdminsPage />
              </LazyRoute>
            </RequirePermission>
          }
        />
        <Route
          path="ui-debug"
          element={
            <RequirePermission permission="users.manage">
              <LazyRoute>
                <UiDebugPage />
              </LazyRoute>
            </RequirePermission>
          }
        />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
