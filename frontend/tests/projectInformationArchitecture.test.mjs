import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../src/pages/ProfileDashboardPage.tsx", import.meta.url), "utf8");

test("project page exposes the consolidated three-tab information architecture", () => {
  for (const label of ["Основная", "История", "Настройки"]) {
    assert.match(source, new RegExp(`label: "${label}"`));
  }
  for (const removedLabel of ["Сводка", "Расписание", "Структура"]) {
    assert.doesNotMatch(source, new RegExp(`label: "${removedLabel}"`));
  }
});

test("main tab contains last run metrics and structure", () => {
  assert.match(source, /activeTab === "main"/);
  assert.match(source, /Последний прогон/);
  assert.match(source, /Показатели последнего прогона/);
  assert.match(source, /Структура сайта/);
});

test("settings contain real project parameters without a fake schedule save control", () => {
  assert.match(source, /activeTab === "settings"/);
  assert.match(source, /Основные параметры/);
  assert.match(source, /Сканирование и лимиты/);
  assert.match(source, /Опасная зона/);
  assert.doesNotMatch(source, /Сохранить расписание/);
});
