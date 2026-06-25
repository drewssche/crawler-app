import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../src/pages/ProfileDashboardPage.tsx", import.meta.url), "utf8");
const sitesSource = await readFile(new URL("../src/components/projects/ProjectSitesSettings.tsx", import.meta.url), "utf8");
const createSource = await readFile(new URL("../src/pages/ProfileNewPage.tsx", import.meta.url), "utf8");
const siteCardsSource = await readFile(new URL("../src/components/projects/ProjectSiteContextCards.tsx", import.meta.url), "utf8");
const pageDrawerSource = await readFile(new URL("../src/components/projects/PageContextDrawer.tsx", import.meta.url), "utf8");
const structureSource = await readFile(new URL("../src/components/ui/ProjectStructureTree.tsx", import.meta.url), "utf8");
const compareSource = await readFile(new URL("../src/pages/ComparePage.tsx", import.meta.url), "utf8");
const layoutSource = await readFile(new URL("../src/components/layout/AppLayout.tsx", import.meta.url), "utf8");

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
  assert.match(source, /ProjectSitesSettings/);
  assert.match(sitesSource, /Сайты проекта/);
  assert.match(sitesSource, /Добавить сайт/);
  assert.match(sitesSource, /updateProjectSite/);
  assert.match(source, /Опасная зона/);
  assert.doesNotMatch(source, /Сохранить расписание/);
});

test("project creation uses one explicit site instead of a shared domains textarea", () => {
  assert.match(createSource, /Первый сайт/);
  assert.match(createSource, /scope_mode: scopeMode/);
  assert.match(createSource, /path_prefix:/);
  assert.doesNotMatch(createSource, /Домены \(обязательно, 1\+\)/);
  assert.doesNotMatch(createSource, /textarea/);
});

test("site cards select the context used by runs, history and structure", () => {
  assert.match(source, /ProjectSiteContextCards/);
  assert.match(source, /\/runs\/by-site\/\$\{siteId\}/);
  assert.match(source, /\/runs\/start-site\/\$\{selectedSite\.id\}/);
  assert.match(siteCardsSource, /aria-pressed=\{selected\}/);
  assert.match(siteCardsSource, /Страниц:/);
  assert.match(siteCardsSource, /Изменений:/);
});

test("project-level run preserves per-site outcomes", () => {
  assert.match(source, /\/runs\/start-project\/\$\{project\.id\}/);
  assert.match(source, /Запустить все сайты/);
  assert.match(source, /Успешно:/);
  assert.match(source, /с ошибкой:/);
  assert.match(source, /result\.site_name/);
});

test("site anomaly UX distinguishes baseline, normal and anomaly states", () => {
  assert.match(source, /Недостаточно данных/);
  assert.match(source, /selectedSite\.anomaly\.status === "normal"/);
  assert.match(source, /selectedSite\.anomaly\.reasons\.map/);
  assert.match(siteCardsSource, /Baseline: недостаточно данных/);
  assert.match(siteCardsSource, /Аномалий не обнаружено/);
  assert.match(siteCardsSource, /Обнаружена критичная аномалия/);
});

test("structure opens an on-demand page context drawer with SEO and broken links", () => {
  assert.match(source, /getPageContext\(lastRunId, url\)/);
  assert.match(source, /PageContextDrawer/);
  assert.match(structureSource, /onPageSelect\(node\.url\)/);
  assert.match(pageDrawerSource, /SEO checklist/);
  assert.match(pageDrawerSource, /known_broken/);
  assert.match(pageDrawerSource, /Ассеты/);
  assert.match(pageDrawerSource, /Открыть на сайте/);
});

test("manual compare supports arbitrary site run and page selection", () => {
  assert.match(source, /Сравнить страницы/);
  assert.match(compareSource, /Левая сторона/);
  assert.match(compareSource, /Правая сторона/);
  assert.match(compareSource, /listCompareRuns/);
  assert.match(compareSource, /listComparePages/);
  assert.match(compareSource, /getCompareSnapshot/);
  assert.match(compareSource, /HTML diff/);
  assert.match(compareSource, /Структурное сравнение/);
});

test("compare visual mode uses a full focus workspace and safe snapshot frames", () => {
  assert.match(layoutSource, /compareFocusMode/);
  assert.match(layoutSource, /!compareFocusMode && \(/);
  assert.match(compareSource, /sandbox=""/);
  assert.match(compareSource, /Content-Security-Policy/);
  assert.match(compareSource, /Визуально/);
  assert.match(compareSource, /Обзор/);
  assert.match(compareSource, /Детально/);
  assert.match(compareSource, /value: "both", label: "Обе"/);
  assert.match(compareSource, /value: "left", label: "Левая"/);
  assert.match(compareSource, /value: "right", label: "Правая"/);
});
