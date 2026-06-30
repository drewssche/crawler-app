import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../src/pages/ProjectDashboardPage.tsx", import.meta.url), "utf8");
const sitesSource = await readFile(new URL("../src/components/projects/ProjectSitesSettings.tsx", import.meta.url), "utf8");
const membersSource = await readFile(new URL("../src/components/projects/ProjectMembersSettings.tsx", import.meta.url), "utf8");
const createSource = await readFile(new URL("../src/pages/ProjectNewPage.tsx", import.meta.url), "utf8");
const siteCardsSource = await readFile(new URL("../src/components/projects/ProjectSiteContextCards.tsx", import.meta.url), "utf8");
const pageDrawerSource = await readFile(new URL("../src/components/projects/PageContextDrawer.tsx", import.meta.url), "utf8");
const directoryDrawerSource = await readFile(new URL("../src/components/projects/DirectoryContextDrawer.tsx", import.meta.url), "utf8");
const structureSource = await readFile(new URL("../src/components/ui/ProjectStructureTree.tsx", import.meta.url), "utf8");
const compareSource = await readFile(new URL("../src/pages/ComparePage.tsx", import.meta.url), "utf8");
const layoutSource = await readFile(new URL("../src/components/layout/AppLayout.tsx", import.meta.url), "utf8");
const sidebarLeftSource = await readFile(new URL("../src/components/layout/SidebarLeft.tsx", import.meta.url), "utf8");
const sidebarRightSource = await readFile(new URL("../src/components/layout/SidebarRight.tsx", import.meta.url), "utf8");
const inspectorSource = await readFile(new URL("../src/pages/PageInspectorPage.tsx", import.meta.url), "utf8");
const reportSource = await readFile(new URL("../src/components/projects/PageInspectionReport.tsx", import.meta.url), "utf8");
const safeSnapshotSource = await readFile(new URL("../src/utils/safeSnapshotDocument.ts", import.meta.url), "utf8");
const quotaErrorsSource = await readFile(new URL("../src/utils/quotaErrors.ts", import.meta.url), "utf8");
const cssSource = await readFile(new URL("../src/index.css", import.meta.url), "utf8");
const renderedSnapshotSource = await readFile(new URL("../src/components/projects/RenderedSnapshotView.tsx", import.meta.url), "utf8");
const highlightedTextSource = await readFile(new URL("../src/components/ui/HighlightedText.tsx", import.meta.url), "utf8");

test("project page exposes the consolidated three-tab information architecture", () => {
  for (const label of ["Основная", "История", "Настройки"]) {
    assert.match(source, new RegExp(`label: "${label}"`));
  }
  for (const removedLabel of ["Сводка", "Расписание", "Структура"]) {
    assert.doesNotMatch(source, new RegExp(`label: "${removedLabel}"`));
  }
  assert.ok(
    source.indexOf("<SegmentedControl") < source.indexOf("<ProjectSiteContextCards"),
    "primary project tabs should stay above site context cards",
  );
});

test("main tab keeps minimal project workspace without duplicate summary blocks", () => {
  assert.match(source, /activeTab === "main"/);
  assert.match(source, /Структура сайта/);
  assert.match(source, /ProjectSiteContextCards/);
  assert.doesNotMatch(source, /Рабочая сводка/);
  assert.doesNotMatch(source, /Показатели последнего прогона/);
  assert.doesNotMatch(source, /Контекст просмотра структуры и истории/);
  assert.doesNotMatch(source, /Если ничего не менять, crawler пойдёт/);
});

test("project disclosure blocks persist collapsed state locally", () => {
  assert.match(source, /PROJECT_DISCLOSURE_STORAGE_PREFIX/);
  assert.match(source, /ProjectPersistentDetails/);
  assert.match(source, /window\.localStorage\.setItem/);
  assert.match(source, /storageKey="structure-process"/);
  assert.match(source, /storageKey="structure-slice-details"/);
  assert.match(source, /storageKey="structure-legend"/);
});

test("settings contain real project parameters without a fake schedule save control", () => {
  assert.match(source, /activeTab === "settings"/);
  assert.match(source, /activeSettingsSection/);
  assert.match(source, /ProjectSettingsSectionId/);
  assert.doesNotMatch(source, /function ProjectSettingsSection/);
  assert.match(source, /title: "Сайты"/);
  assert.match(source, /title: "Участники"/);
  assert.match(source, />Расписание</);
  assert.match(source, />Опасная зона</);
  assert.match(source, /setActiveSettingsSection/);
  assert.match(source, /aria-pressed=\{activeSettingsSection === item\.id\}/);
  assert.match(source, /<ProjectSitesSettings[\s\S]*compactHeader/);
  assert.match(source, /<ProjectMembersSettings[\s\S]*compactHeader/);
  assert.match(sitesSource, /compactHeader/);
  assert.match(membersSource, /compactHeader/);
  assert.match(source, /ProjectSitesSettings/);
  assert.match(sitesSource, /Сайты проекта/);
  assert.match(sitesSource, /Добавить сайт/);
  assert.match(sitesSource, /updateProjectSite/);
  assert.match(source, /Опасная зона/);
  assert.doesNotMatch(source, /Сохранить расписание/);
});

test("project settings internals use chip controls instead of native selects", () => {
  assert.doesNotMatch(sitesSource, /UiSelect/);
  assert.doesNotMatch(membersSource, /UiSelect/);
  assert.match(sitesSource, /ChipPicker/);
  assert.match(membersSource, /ChipPicker/);
  assert.match(membersSource, /ariaLabel="Роль нового участника"/);
  assert.match(sitesSource, /ariaLabel="Тип персоны"/);
});

test("project members are added through searchable user combobox with highlight and states", () => {
  assert.match(membersSource, /role="combobox"/);
  assert.match(membersSource, /\/admin\/users\?status=all&q=/);
  assert.match(membersSource, /HighlightedText/);
  assert.match(membersSource, /Уже участник/);
  assert.match(membersSource, /Заблокирован/);
  assert.match(membersSource, /Ожидает подтверждения/);
  assert.match(membersSource, /Пользователь не найден/);
  assert.match(membersSource, /userLookupNoMatch/);
});

test("shared search highlight uses visible warm contrast", () => {
  assert.match(highlightedTextSource, /rgba\(255, 214, 102, 0\.34\)/);
  assert.match(highlightedTextSource, /#fff3bf/);
  assert.match(highlightedTextSource, /rgba\(255, 214, 102, 0\.42\)/);
});

test("project creation uses explicit site cards instead of a shared domains textarea", () => {
  assert.match(createSource, /Первый сайт/);
  assert.match(createSource, /\+ Добавить сайт/);
  assert.match(createSource, /scope_mode: primaryDraft\.scopeMode/);
  assert.match(createSource, /createProjectSite/);
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
  assert.match(siteCardsSource, /runs_total/);
  assert.match(siteCardsSource, /site\.start_url/);
  assert.match(source, /if \(siteId === selectedSiteId\) return/);
  assert.doesNotMatch(source, /if \(siteId === selectedSiteId\) return;[\s\S]{0,180}setLastRunPages\(\[\]\)/);
});

test("project-level run preserves per-site outcomes", () => {
  assert.match(source, /\/runs\/start-project\/\$\{project\.id\}/);
  assert.match(source, /Запустить все сайты/);
  assert.match(source, /projectHasMultipleSites &&/);
  assert.match(source, /Успешно:/);
  assert.match(source, /с ошибкой:/);
  assert.match(source, /result\.site_name/);
});

test("site anomaly UX distinguishes baseline, normal and anomaly states", () => {
  assert.match(siteCardsSource, /ProjectRunBadge/);
  assert.doesNotMatch(siteCardsSource, /Мониторинг:/);
  assert.doesNotMatch(siteCardsSource, /Аномалий не обнаружено/);
  assert.doesNotMatch(siteCardsSource, /Обнаружена критичная аномалия/);
});

test("structure opens an on-demand page context drawer with SEO and broken links", () => {
  assert.match(source, /getPageContext\(structureRunId, url\)/);
  assert.match(source, /PageContextDrawer/);
  assert.match(source, /title\?: string \| null/);
  assert.match(source, /description\?: string \| null/);
  assert.match(source, /h1\?: string \| null/);
  assert.match(source, /row\.title/);
  assert.match(source, /row\.description/);
  assert.match(source, /row\.h1/);
  assert.match(source, /Поиск по URL, title, description, H1/);
  assert.match(structureSource, /onPageSelect\(node\.url\)/);
  assert.match(structureSource, /onDirectorySelect/);
  assert.doesNotMatch(structureSource, /window\.open\(node\.url/);
  assert.match(source, /DirectoryContextDrawer/);
  assert.match(directoryDrawerSource, /Контекст раздела/);
  assert.match(directoryDrawerSource, /Открыть раздел на сайте/);
  assert.match(pageDrawerSource, /SEO checklist/);
  assert.match(pageDrawerSource, /known_broken/);
  assert.match(pageDrawerSource, /Ассеты/);
  assert.match(pageDrawerSource, /Открыть на сайте/);
  assert.match(pageDrawerSource, /Перенаправление/);
  assert.match(pageDrawerSource, /Ошибка относится только к этой странице/);
  assert.match(pageDrawerSource, /Аналитика, scripts и cookies/);
  assert.match(pageDrawerSource, /Найденные идентификаторы/);
  assert.match(pageDrawerSource, /Момент запуска не проверен/);
  assert.match(pageDrawerSource, /Поведение согласия не проверено/);
  assert.match(pageDrawerSource, /Прочие scripts/);
  assert.match(pageDrawerSource, /Без значений cookies, токенов/);
  assert.match(pageDrawerSource, /Открыть полный анализ/);
  assert.match(source, /\/inspect\?run=/);
});

test("full page inspector keeps the snapshot and a scrollable section report visible together", () => {
  assert.match(inspectorSource, /page-inspector-grid/);
  assert.match(inspectorSource, /Снимок/);
  assert.match(inspectorSource, /DOM/);
  assert.match(inspectorSource, /Сохранённый HTML/);
  assert.match(inspectorSource, /sandbox="allow-scripts"/);
  assert.match(inspectorSource, /RenderedSnapshotView/);
  assert.match(inspectorSource, /elementPicker=\{elementPickerEnabled\}/);
  assert.match(inspectorSource, /source: "snapshot"/);
  assert.match(inspectorSource, /source: "dom"/);
  assert.match(inspectorSource, /PageInspectionReport/);
  assert.match(inspectorSource, /Выбрать блок/);
  assert.match(inspectorSource, /Выбранный блок/);
  assert.match(inspectorSource, /Показать в коде/);
  assert.match(inspectorSource, /Сбросить выбор/);
  assert.match(inspectorSource, /Источник:/);
  assert.match(inspectorSource, /Точный HTML-фрагмент не найден/);
  assert.match(inspectorSource, /не найден HTML-блок/);
  assert.match(inspectorSource, /page-code-selected-fragment/);
  assert.match(safeSnapshotSource, /crawler:element-selected/);
  assert.match(safeSnapshotSource, /startsWith\("on"\)/);
  assert.match(cssSource, /element-picker-toggle/);
  assert.match(cssSource, /\.inspector-section-nav[\s\S]*position: sticky/);
  assert.match(reportSource, /Найти ссылку по адресу или тексту/);
  assert.match(reportSource, /Найти ассет по адресу или alt/);
  assert.match(reportSource, /Прочие scripts/);
  assert.match(reportSource, /Что означают технические поля/);
  assert.match(reportSource, /inspector-section-nav/);
  for (const label of ["Сводка", "SEO", "Ссылки", "Ассеты", "Аналитика", "Cookies", "Повторы"]) {
    assert.match(reportSource, new RegExp(label));
  }
});

test("problem pages support bounded single and bulk retry without replacing the original result", () => {
  assert.match(source, /retryProblemPages\(structureRunId/);
  assert.match(source, /Повторить проблемные/);
  assert.match(source, /Исходный результат прогона сохранён/);
  assert.match(source, /handleRetryStructurePage/);
  assert.match(structureSource, /onRetryPage/);
  assert.match(structureSource, /повторно доступна/);
  assert.match(pageDrawerSource, /Повторные проверки/);
  assert.match(pageDrawerSource, /Исходный результат страницы не изменяется/);
  assert.match(pageDrawerSource, /context\.page\.can_retry/);
});

test("structure keeps users informed while a crawl or refresh is running", () => {
  assert.match(source, /Идёт сканирование выбранного сайта/);
  assert.match(source, /Пока показываем последнюю готовую структуру/);
  assert.match(source, /обновится автоматически/);
  assert.match(source, /Загружаем готовую структуру/);
  assert.match(source, /completedRunsWithPages/);
  assert.match(source, /Crawler обходит страницы/);
  assert.match(source, /runElapsedSeconds/);
  assert.match(source, /ToastHost/);
  assert.match(source, /refreshEventCenterPollingNow/);
  assert.match(source, /structureIsLive/);
  assert.match(source, /Сейчас обрабатывается:/);
  assert.match(source, /Новые страницы появляются автоматически/);
  assert.match(source, /live=\{structureIsLive\}/);
  assert.match(source, /Готово:/);
  assert.match(source, /Обнаружено:/);
  assert.match(source, /В очереди:/);
  assert.match(source, /currentBatchNo/);
  assert.match(source, /дерево не прокручивается само/);
  assert.match(source, /Подробности процесса/);
  assert.match(source, /Детали среза/);
  assert.match(source, /Страницы в структуре/);
  assert.match(source, /Легенда структуры/);
  assert.match(source, /Все ·/);
  assert.match(source, /Новые ·/);
  assert.match(source, /Ошибки ·/);
  assert.match(source, /Прогон завершён — структура готова/);
  assert.match(structureSource, /structure-tree-row-live-added/);
  assert.match(structureSource, /✓ готово/);
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
  assert.match(compareSource, /PageInspectionReport/);
  assert.match(compareSource, /Инфо левой страницы/);
  assert.match(compareSource, /Инфо правой страницы/);
  assert.match(compareSource, /Только различия/);
  assert.match(compareSource, /PageInspectionDifferences/);
  assert.match(compareSource, /Только слева ID/);
  assert.match(compareSource, /Только справа cookies/);
});

test("compare visual mode uses a full focus workspace and persisted rendered snapshots", () => {
  assert.match(layoutSource, /focusWorkspaceMode/);
  assert.match(layoutSource, /!focusWorkspaceMode && \(/);
  assert.match(compareSource, /RenderedSnapshotView/);
  assert.match(renderedSnapshotSource, /Создать визуальный снимок/);
  assert.match(renderedSnapshotSource, /downloadRenderedSnapshot/);
  assert.match(renderedSnapshotSource, /metadata\.explanation/);
  assert.match(renderedSnapshotSource, /element_map/);
  assert.match(renderedSnapshotSource, /rendered-snapshot-element-highlight/);
  assert.match(renderedSnapshotSource, /handleImageClick/);
  assert.match(safeSnapshotSource, /Content-Security-Policy/);
  assert.match(compareSource, /Визуально/);
  assert.match(compareSource, /Обзор/);
  assert.match(compareSource, /Детально/);
  assert.match(compareSource, /Выбрать блоки/);
  assert.match(compareSource, /Блоки: \{selectedBlockCount\}\/2/);
  assert.match(compareSource, /Очистить оба блока/);
  assert.match(compareSource, /missingElementMapSides/);
  assert.match(compareSource, /пересоздайте визуальный снимок/);
  assert.match(compareSource, /Теперь выберите блок слева/);
  assert.match(compareSource, /Теперь выберите блок справа/);
  assert.match(compareSource, /blockPickerEnabled/);
  assert.match(compareSource, /onElementSelected/);
  assert.match(compareSource, /suggestMatchingBlock/);
  assert.match(compareSource, /BlockMatchSuggestionCard/);
  assert.match(compareSource, /Предложение похожего блока/);
  assert.match(compareSource, /Применить \{sideLabel\(suggestion\.side\)\}/);
  assert.match(compareSource, /selectedBlockCount === 1/);
  assert.match(compareSource, /Сравнение выбранных блоков/);
  assert.match(compareSource, /HTML выбранных блоков/);
  assert.match(compareSource, /Текстовый diff выбранных блоков/);
  assert.match(compareSource, /buildBlockFingerprint/);
  assert.match(compareSource, /blockSimilarity/);
  assert.match(compareSource, /Structural fingerprint выбранных блоков/);
  assert.match(compareSource, /Структурная похожесть низкая/);
  assert.match(compareSource, /Selector отличается/);
  assert.match(compareSource, /разные HTML-теги/);
  assert.match(cssSource, /compare-block-diff/);
  assert.match(cssSource, /compare-fingerprint-table/);
  assert.match(compareSource, /value: "both", label: "Обе"/);
  assert.match(compareSource, /value: "left", label: "Левая"/);
  assert.match(compareSource, /value: "right", label: "Правая"/);
});

test("compare page selection is searchable and mode controls are progressive", () => {
  assert.match(compareSource, /PAGE_PICKER_LIMIT/);
  assert.match(compareSource, /compare-page-search/);
  assert.match(compareSource, /Поиск страницы по URL, title или HTTP/);
  assert.match(compareSource, /Найдено:/);
  assert.match(compareSource, /Показаны первые/);
  assert.match(compareSource, /Выбрано \{selectionProgress\}\/2/);
  assert.match(compareSource, /compareStarted/);
  assert.match(compareSource, /compareLoading/);
  assert.match(compareSource, /autoMatchEnabled/);
  assert.match(compareSource, /function startCompare/);
  assert.match(compareSource, /Загружаем сравнение/);
  assert.match(compareSource, /Автоподбор включён/);
  assert.match(compareSource, /Автоподбор выключен/);
  assert.match(compareSource, /Режимы сравнения появятся после выбора двух страниц и нажатия «Сравнить»/);
  assert.match(compareSource, /compare-work-area/);
  assert.match(compareSource, /updateSide\(key, \(current\) => \(\{ \.\.\.current, url, snapshot: null, context: null, error: "" \}\)\)/);
  assert.match(cssSource, /compare-page-results/);
  assert.match(cssSource, /compare-visual-panel/);
  assert.match(cssSource, /resize: horizontal/);
});

test("compare layout keeps page info next to its own side and preserves central comparison", () => {
  assert.match(compareSource, /compare-workspace-grid/);
  assert.match(compareSource, /compare-central-stage/);
  assert.match(compareSource, /compare-side-report/);
  assert.match(compareSource, /compare-differences-report/);
  assert.match(compareSource, /idPrefix=\{`compare-\$\{side\}-inspector`\}/);
  assert.match(reportSource, /idPrefix = "inspector"/);
  assert.match(cssSource, /grid-template-columns: minmax\(240px, 0\.42fr\) minmax\(0, 1fr\) minmax\(0, 1fr\) minmax\(240px, 0\.42fr\)/);
  assert.match(cssSource, /compare-workspace-grid\.is-both \.compare-central-stage/);
});

test("interactive controls expose consistent hover and keyboard focus polish", () => {
  assert.match(cssSource, /\.interactive-row:focus-visible/);
  assert.match(cssSource, /\.project-persistent-summary:hover/);
  assert.match(cssSource, /\.project-persistent-summary:focus-visible/);
  assert.match(cssSource, /\.compare-page-result:focus-visible/);
  assert.match(cssSource, /\.element-picker-toggle:hover:not\(:disabled\)/);
  assert.match(cssSource, /\.inspector-details:hover/);
  assert.match(source, /className="project-persistent-details"/);
  assert.match(source, /className="project-persistent-summary"/);
});

test("sidebars support compact workspace and event-center view modes", () => {
  assert.match(layoutSource, /leftCollapsed/);
  assert.match(layoutSource, /SIDEBAR_LEFT_COLLAPSED_STORAGE_KEY/);
  assert.match(layoutSource, /<SidebarLeft collapsed=\{leftCollapsed\}/);
  assert.match(sidebarLeftSource, /collapsed: boolean/);
  assert.match(sidebarLeftSource, /Развернуть левое меню/);
  assert.match(sidebarLeftSource, /Свернуть левое меню/);
  assert.match(sidebarRightSource, /SidebarRightViewMode = "both" \| "notifications" \| "activity"/);
  assert.match(sidebarRightSource, /SIDEBAR_RIGHT_VIEW_STORAGE_KEY/);
  assert.match(sidebarRightSource, /viewMode === "both"/);
  assert.match(sidebarRightSource, /viewMode === "notifications"/);
  assert.match(sidebarRightSource, /viewMode === "activity"/);
  assert.match(sidebarRightSource, /Оба/);
  assert.match(sidebarRightSource, /Увед\./);
  assert.match(sidebarRightSource, /Лента/);
  assert.match(sidebarRightSource, /gridTemplateRows: viewMode === "both" \? "1fr 1px 1fr" : "minmax\(0, 1fr\)"/);
});

test("page inspector exposes on-demand runtime consent audit", () => {
  assert.match(reportSource, /createConsentAudit/);
  assert.match(reportSource, /Browser-аудит до\/после согласия/);
  assert.match(reportSource, /Проверить до\/после/);
  assert.match(reportSource, /До согласия/);
  assert.match(reportSource, /После согласия/);
  assert.match(reportSource, /Новые cookies/);
  assert.match(reportSource, /values cookies\/tokens не показываются|Значения cookies\/tokens не показываются/);
});

test("guest crawl persona is visible in site, compare and page context UX", () => {
  assert.match(siteCardsSource, /contextLabel/);
  assert.match(siteCardsSource, /default_persona\?\.label \|\| "Гость"/);
  assert.match(compareSource, /run\.persona\?\.label \|\| "Гость"/);
  assert.match(reportSource, /Контекст просмотра:/);
  assert.match(pageDrawerSource, /Контекст просмотра:/);
  assert.match(compareSource, /snapshot\.persona\?\.label \|\| "Гость"/);
  assert.match(compareSource, /Все контексты доступа/);
  assert.match(compareSource, /Сравнение разных контекстов доступа/);
  assert.match(compareSource, /Различия могут означать разные права доступа/);
});

test("managed persona login bridge explains visible browser and MFA workflow", () => {
  assert.match(sitesSource, /Видимое browser-окно открыто/);
  assert.match(sitesSource, /MFA\/2FA/);
  assert.match(sitesSource, /CRAWL_PERSONA_MANAGED_LOGIN_CAPTURE_HEADLESS=0/);
  assert.match(sitesSource, /docker compose up -d --build backend/);
  assert.match(sitesSource, /DISPLAY\/WAYLAND_DISPLAY/);
  assert.match(sitesSource, /ручной storageState/);
});

test("project run history exposes crawl runtime explicitly", () => {
  assert.match(source, /RunRuntimePill/);
  assert.match(source, /Browser runtime/);
  assert.match(source, /HTTP runtime/);
  assert.match(source, /crawl_runtime/);
  assert.match(source, /storageKey=\{`history-run-\$\{run\.id\}`\}/);
  assert.match(source, /run\.pages_total\} страниц/);
  assert.match(source, /run\.pages_changed\} изменений/);
  assert.doesNotMatch(source, /Контекст просмотра: \{run\.persona/);
});

test("project quota failures are explained as user-facing limits", () => {
  assert.match(createSource, /formatQuotaError/);
  assert.match(sitesSource, /formatQuotaError/);
  assert.match(source, /formatQuotaError/);
  assert.match(quotaErrorsSource, /Достигнут лимит:/);
  assert.match(quotaErrorsSource, /Дождитесь завершения текущих задач/);
  assert.match(quotaErrorsSource, /Запустите сайты частями/);
  assert.match(quotaErrorsSource, /Уменьшите лимит страниц/);
});

test("compare auto-match suggests but does not force a relative-path pair", () => {
  assert.match(compareSource, /suggestPageMatch/);
  assert.match(compareSource, /Предложение пары/);
  assert.match(compareSource, /Выбрать справа/);
  assert.match(compareSource, /Выбрать слева/);
  assert.doesNotMatch(compareSource, /setRight\([^)]*suggestion/);
});
