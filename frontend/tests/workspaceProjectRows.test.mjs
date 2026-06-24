import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../src/pages/WorkspaceHomePage.tsx", import.meta.url), "utf8");

test("workspace rows expose decision-useful run summary", () => {
  for (const label of ["Последний прогон", "Страниц:", "Изменений:", "Прогонов:"]) {
    assert.match(source, new RegExp(label));
  }
});

test("workspace removes destructive actions from project rows", () => {
  assert.doesNotMatch(source, /apiDelete/);
  assert.doesNotMatch(source, /ConfirmDialog/);
  assert.doesNotMatch(source, />Удалить</);
});

test("workspace rows remain keyboard accessible and use shared project search", () => {
  assert.match(source, /searchProjects\(projects, search\)/);
  assert.match(source, /role="button"/);
  assert.match(source, /event\.key === "Enter"/);
});
