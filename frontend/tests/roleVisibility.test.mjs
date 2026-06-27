import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appSource = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
const sidebarSource = await readFile(new URL("../src/components/layout/SidebarLeft.tsx", import.meta.url), "utf8");
const workspaceSource = await readFile(new URL("../src/pages/WorkspaceHomePage.tsx", import.meta.url), "utf8");
const projectSource = await readFile(new URL("../src/pages/ProjectDashboardPage.tsx", import.meta.url), "utf8");
const permissionsSource = await readFile(new URL("../src/utils/permissions.ts", import.meta.url), "utf8");
const debugSource = await readFile(new URL("../src/pages/UiDebugPage.tsx", import.meta.url), "utf8");

test("project routes use explicit permissions", () => {
  assert.match(appSource, /permission="projects\.edit"[\s\S]*?<ProjectNewPage/);
  assert.match(appSource, /permission="data\.view"[\s\S]*?<ProjectDashboardPage/);
  assert.match(appSource, /path="projects\/:id\/compare"[\s\S]*?permission="data\.view"[\s\S]*?<ComparePage/);
  assert.match(appSource, /path="projects\/:id\/inspect"[\s\S]*?permission="data\.view"[\s\S]*?<PageInspectorPage/);
});

test("viewer and editor project capabilities are distinct", () => {
  assert.match(permissionsSource, /viewer:\s*new Set\(\["data\.view"\]\)/);
  assert.match(permissionsSource, /editor:\s*new Set\(\["data\.view", "crawler\.run", "projects\.edit"\]\)/);
  assert.match(permissionsSource, /raw in PERMISSIONS_BY_ROLE \? raw : "viewer"/);
});

test("project mutations are hidden without matching permissions", () => {
  assert.match(sidebarSource, /canEditProjects/);
  assert.match(workspaceSource, /canEditProjects/);
  assert.match(projectSource, /canRunCrawler/);
  assert.match(projectSource, /canEditProject/);
});

test("UI Debug is fixture-only and guarded by development flags", () => {
  assert.match(debugSource, /VITE_ENABLE_UI_DEBUG/);
  assert.match(debugSource, /реальные права и данные не изменены/);
  assert.match(debugSource, /fixture_only/);
  assert.doesNotMatch(debugSource, /setToken|access_token|imperson/);
});
