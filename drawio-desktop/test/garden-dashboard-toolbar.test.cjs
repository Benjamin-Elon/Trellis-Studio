const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const PROJECT_ROOT = path.join(__dirname, "..");
const DASHBOARD_PATH = path.join(PROJECT_ROOT, "drawio", "src", "main", "webapp", "plugins", "garden_planner_plugins", "Garden_Dashboard.js");

function source() {
    return fs.readFileSync(DASHBOARD_PATH, "utf8");
}

function viewportToolbarSource() {
    const text = source();
    const start = text.indexOf("// -------------------- Viewport toolbar (active dashboard UI)");
    const end = text.indexOf("// -------------------- View/model event wiring", start);
    assert.notEqual(start, -1, "Missing viewport toolbar section");
    assert.notEqual(end, -1, "Missing viewport toolbar boundary");
    return text.slice(start, end);
}

test("garden dashboard toolbar is mounted to the graph viewport and sized from the viewport", () => {
    const text = viewportToolbarSource();
    const fullSource = source();
    assert.match(text, /wrap\.className = "trellis-garden-dashboard-toolbar"/);
    assert.match(fullSource, /trellis-graph-control-layer/);
    assert.match(text, /function getViewportToolbarContainer\(\)/);
    assert.match(text, /return graph && graph\.container;/);
    assert.match(text, /host\.appendChild\(wrap\);/);
    assert.match(text, /wrap\.style\.position = "fixed";/);
    assert.match(text, /const host = getViewportToolbarContainer\(\);/);
    assert.match(text, /function viewportToolbarWidth\(host\)/);
    assert.match(text, /host\.getBoundingClientRect/);
    assert.match(text, /if \(rect && rect\.width\) return rect\.width;/);
    assert.match(text, /entry\.wrap\.style\.left = Math\.round\(rect\.left \|\| 0\) \+ "px";/);
    assert.match(text, /entry\.wrap\.style\.top = Math\.round\(rect\.top \|\| 0\) \+ "px";/);
    assert.match(text, /entry\.wrap\.style\.width = Math\.max\(0, Math\.round\(viewportToolbarWidth\(host\)\)\) \+ "px";/);
    assert.doesNotMatch(text, /innerWidth/);
});

test("garden dashboard toolbar width follows a narrowed graph container rect", () => {
    const graph = {
        container: {
            clientWidth: 1600,
            getBoundingClientRect() { return { left: 88, top: 124, width: 916, height: 700 }; }
        }
    };
    const entry = { wrap: { style: {} } };
    function getViewportToolbarContainer() { return graph && graph.container; }
    function viewportToolbarWidth(host) {
        if (!host) return 0;
        const rect = host.getBoundingClientRect ? host.getBoundingClientRect() : null;
        if (rect && rect.width) return rect.width;
        return host.clientWidth || 0;
    }
    function positionViewportToolbar(target) {
        const host = getViewportToolbarContainer();
        if (!target || !host) return;
        const rect = host.getBoundingClientRect ? host.getBoundingClientRect() : { left: 0, top: 0 };
        target.wrap.style.left = Math.round(rect.left || 0) + "px";
        target.wrap.style.top = Math.round(rect.top || 0) + "px";
        target.wrap.style.width = Math.max(0, Math.round(viewportToolbarWidth(host))) + "px";
    }
    positionViewportToolbar(entry);
    assert.equal(entry.wrap.style.left, "88px");
    assert.equal(entry.wrap.style.top, "124px");
    assert.equal(entry.wrap.style.width, "916px");
});

test("garden dashboard toolbar follows garden module and descendant selection", () => {
    const text = viewportToolbarSource();
    const fullSource = source();
    assert.match(text, /function resolveDashboardToolbarContext\(\)/);
    assert.match(text, /function selectedGardenModuleForToolbar\(\)/);
    assert.match(text, /graph\.getSelectionCells/);
    assert.match(text, /const moduleCell = isGardenModule\(cell\) \? cell : findGardenModuleAncestor\(graph, cell\);/);
    assert.match(text, /if \(!context\.moduleCell\) \{ renderBlankViewportToolbar\(context\); return; \}/);
    assert.match(fullSource, /graph\.getSelectionModel\(\)\.addListener\(mxEvent\.CHANGE, scheduleViewportToolbarRefresh\);/);
});

test("garden dashboard toolbar controls use module scoped plugin contracts", () => {
    const text = viewportToolbarSource();
    assert.match(text, /window\.dispatchEvent\(new CustomEvent\(PLAN_YEAR_EVENT, \{ detail: \{ moduleCellId: cellId\(activeToolbarModule\), year \} \}\)\)/);
    assert.match(text, /window\.dispatchEvent\(new CustomEvent\(ALLOCATE_PLAN_EVENT, \{ detail: \{ moduleCellId: cellId\(activeToolbarModule\), year \} \}\)\)/);
    assert.doesNotMatch(text, /dashCellId/);
    assert.match(text, /equipmentApi\.openDialog\(activeToolbarModule\)/);
    assert.match(text, /plannerApi\.openIrrigationMode\(moduleCell, \{ preserveViewport: true \}\);/);
    assert.match(text, /downloadCsv\(`\$\{safeName\}_\$\{year\}_dashboard\.csv`, buildDashboardCsvSingleTable\(metrics, year\)\);/);
});

test("garden dashboard toolbar exposes share only for eligible selected scopes", () => {
    const text = viewportToolbarSource();
    assert.match(text, /const shareBtn = createToolbarButton\("Share", "Share selected module\(s\), task board\(s\), or garden bed\(s\)", "open"\);/);
    assert.match(text, /rightActions\.appendChild\(shareBtn\);/);
    assert.match(text, /shareBtn\.addEventListener\("click", function \(\) \{ openShareGardenCanvasDialog\(\); \}\);/);
    assert.match(text, /function shareSelectionState\(\)/);
    assert.match(text, /users\.getEligibleShareScopes\(selectedCellsForShare\(\)\)/);
    assert.match(text, /setButtonDisabled\(entry\.shareBtn, gardenToolsDisabled \|\| !shareState\.ok, gardenToolsDisabled \? WORKSPACE_DISABLED_TITLE : \(shareState\.ok \? "Share selected scope\(s\)" : shareState\.reason\)\);/);
    assert.match(text, /function openEnableUsersForShareDialog\(\)/);
    assert.match(text, /Create the first admin before sharing selected garden scopes\./);
    assert.match(text, /setTimeout\(openShareGardenCanvasDialog, 0\);/);
    assert.match(text, /Syncthing sharing is unavailable in this Trellis build\./);
});

test("garden dashboard toolbar groups tools left and messages export share table right", () => {
    const text = viewportToolbarSource();
    assert.match(text, /leftControls\.className = "trellis-garden-dashboard-toolbar-left"/);
    assert.match(text, /rightActions\.className = "trellis-garden-dashboard-toolbar-right"/);
    assert.match(text, /leftControls\.appendChild\(gardenName\);[\s\S]*leftControls\.appendChild\(gardenPickerWrap\);[\s\S]*leftControls\.appendChild\(createGardenBtn\);[\s\S]*leftControls\.appendChild\(workspaceWrap\);[\s\S]*leftControls\.appendChild\(taskBoardSelect\);[\s\S]*leftControls\.appendChild\(prev\);[\s\S]*leftControls\.appendChild\(yearLabel\);[\s\S]*leftControls\.appendChild\(next\);[\s\S]*leftControls\.appendChild\(planBtn\);[\s\S]*leftControls\.appendChild\(allocateBtn\);[\s\S]*leftControls\.appendChild\(irrigationBtn\);[\s\S]*leftControls\.appendChild\(equipmentBtn\);/);
    assert.match(text, /rightActions\.appendChild\(messagesBtn\);[\s\S]*rightActions\.appendChild\(exportBtn\);[\s\S]*rightActions\.appendChild\(shareBtn\);[\s\S]*rightActions\.appendChild\(tableBtn\);/);
    assert.match(text, /controls\.appendChild\(leftControls\);[\s\S]*controls\.appendChild\(rightActions\);/);
});

test("garden dashboard toolbar disables Allocate until the selected year has saved crops", () => {
    const fullSource = source();
    const text = viewportToolbarSource();
    assert.match(fullSource, /const ALLOCATE_NO_PLAN_TITLE = "Create a year plan before allocating\.";[\s\S]*const ALLOCATE_EMPTY_PLAN_TITLE = "Add at least one crop to the year plan before allocating\.";/);
    assert.match(fullSource, /function allocationPlanStatus\(moduleCell, year\)/);
    assert.match(fullSource, /const planObj = getPlanYearObject\(moduleCell, year\);/);
    assert.match(fullSource, /const crops = Array\.isArray\(planObj\.crops\) \? planObj\.crops : \[\];/);
    assert.match(fullSource, /crops\.length[\s\S]*\{ enabled: true, title: "Allocate the current plan" \}/);
    assert.match(text, /const allocateStatus = allocationPlanStatus\(moduleCell, year\);/);
    assert.match(text, /setButtonDisabled\(entry\.allocateBtn, gardenToolsDisabled \|\| !allocateStatus\.enabled, gardenToolsDisabled \? WORKSPACE_DISABLED_TITLE : allocateStatus\.title\);/);

    function getCellAttr(cell, key, fallbackValue) {
        return cell && cell.attrs && Object.prototype.hasOwnProperty.call(cell.attrs, key) ? cell.attrs[key] : fallbackValue;
    }
    function safeJsonParse(value, fallbackValue) {
        try { return JSON.parse(String(value || "")); } catch (_) { return fallbackValue; }
    }
    function getPlanYearObject(moduleCell, year) {
        const raw = getCellAttr(moduleCell, "plan_year_json", "");
        if (!raw) return null;
        const root = safeJsonParse(raw, null);
        if (!root || typeof root !== "object") return null;
        const obj = root[String(year)];
        return obj && typeof obj === "object" ? obj : null;
    }
    function allocationPlanStatus(moduleCell, year) {
        const planObj = getPlanYearObject(moduleCell, year);
        if (!planObj) return { enabled: false, title: "Create a year plan before allocating." };
        const crops = Array.isArray(planObj.crops) ? planObj.crops : [];
        return crops.length
            ? { enabled: true, title: "Allocate the current plan" }
            : { enabled: false, title: "Add at least one crop to the year plan before allocating." };
    }

    assert.deepEqual(allocationPlanStatus({ attrs: {} }, 2026), { enabled: false, title: "Create a year plan before allocating." });
    assert.deepEqual(allocationPlanStatus({ attrs: { plan_year_json: JSON.stringify({ 2026: { crops: [] } }) } }, 2026), { enabled: false, title: "Add at least one crop to the year plan before allocating." });
    assert.deepEqual(allocationPlanStatus({ attrs: { plan_year_json: JSON.stringify({ 2026: { crops: [{}] } }) } }, 2026), { enabled: true, title: "Allocate the current plan" });
    assert.deepEqual(allocationPlanStatus({ attrs: { plan_year_json: JSON.stringify({ 2025: { crops: [{}] } }) } }, 2026), { enabled: false, title: "Create a year plan before allocating." });
});

test("garden dashboard blank state keeps controls visible and exposes searchable garden picker", () => {
    const text = viewportToolbarSource();
    assert.match(text, /function renderBlankViewportToolbar\(context\)/);
    assert.match(text, /entry\.gardenName\.textContent = "No active garden";/);
    assert.match(text, /setGardenActionControlsDisabled\(entry, true\);/);
    assert.match(text, /entry\.workspaceWrap\.style\.display = "none";/);
    assert.match(text, /const gardenPickerWrap = document\.createElement\("div"\);/);
    assert.match(text, /gardenPickerWrap\.className = "trellis-garden-dashboard-picker";/);
    assert.match(text, /const gardenPickerBtn = createToolbarButton\("Select garden\.\.\.", "Select a garden module", "open"\);/);
    assert.match(text, /const search = document\.createElement\("input"\);[\s\S]*search\.type = "search";[\s\S]*search\.className = "trellis-garden-dashboard-garden-search";/);
    assert.match(text, /search\.placeholder = "Search gardens";/);
});

test("garden dashboard waits for an opened diagram before rendering toolbar", () => {
    const text = viewportToolbarSource();
    const fullSource = source();
    assert.match(text, /function dashboardDiagramIsOpen\(\)/);
    assert.match(text, /ui\.getCurrentFile\(\)/);
    assert.match(text, /if \(!dashboardDiagramIsOpen\(\)\) \{ hideViewportToolbar\(\); return; \}/);
    assert.match(text, /function handleDashboardDiagramOpened\(\)/);
    assert.match(text, /startupGardenFocusDone = false;/);
    assert.match(fullSource, /ui\.editor\.addListener\("fileLoaded", handleDashboardDiagramOpened\);/);
});

test("garden dashboard picker searches by garden name while preserving city grouping", () => {
    const text = viewportToolbarSource();
    assert.match(text, /function groupedGardensForPicker\(gardens, searchText\)/);
    assert.match(text, /gardenLabel\(garden\)\.toLocaleLowerCase\(\)\.indexOf\(query\) >= 0/);
    assert.doesNotMatch(text, /gardenCity\(garden\)\.toLocaleLowerCase\(\)\.indexOf\(query\)/);
    assert.match(text, /const city = gardenCity\(garden\) \|\| GARDEN_PICKER_NO_CITY;/);
    assert.match(text, /if \(left === GARDEN_PICKER_NO_CITY && right !== GARDEN_PICKER_NO_CITY\) return 1;/);
    assert.match(text, /gardenLabel\(left\)\.localeCompare\(gardenLabel\(right\)\)/);
});

test("garden dashboard picker selection and no-garden create path select and zoom gardens", () => {
    const text = viewportToolbarSource();
    const fullSource = source();
    assert.match(text, /function selectAndZoomToGarden\(moduleCell\)/);
    assert.match(text, /graph\.setSelectionCell\(moduleCell\)/);
    assert.match(text, /function cellBoundsInModel\(cell\)/);
    assert.match(text, /graph\.view && graph\.view\.getState \? graph\.view\.getState\(cell\) : null/);
    assert.match(text, /x: Number\(state\.x\) \/ scale - \(Number\(translate\.x\) \|\| 0\)/);
    assert.match(text, /parentGeo = model\.getGeometry \? model\.getGeometry\(parent\) : null/);
    assert.match(text, /function zoomGardenToViewport\(moduleCell\)/);
    assert.match(text, /const bounds = cellBoundsInModel\(moduleCell\);/);
    assert.doesNotMatch(text, /model\.getGeometry\(moduleCell\)/);
    assert.match(text, /graph\.fitWindow\(bounds, 48\);/);
    assert.doesNotMatch(text, /scrollRectToVisible\(bounds\)/);
    assert.match(text, /if \(graph\.view && Number\(graph\.view\.scale\) > 1 && graph\.zoomTo\) graph\.zoomTo\(1\);/);
    assert.match(text, /if \(graph\.scrollCellToVisible\) graph\.scrollCellToVisible\(moduleCell, true\);/);
    assert.match(fullSource, /const DEFAULT_MODULE_WIDTH = 160;/);
    assert.match(fullSource, /const DEFAULT_MODULE_HEIGHT = 100;/);
    assert.match(text, /function visibleViewportGardenInsertPoint\(\)/);
    assert.match(text, /if \(graph\.getCenterInsertPoint\) return graph\.getCenterInsertPoint\(moduleBounds\);/);
    assert.match(text, /- moduleBounds\.width \/ 2/);
    assert.match(text, /- moduleBounds\.height \/ 2/);
    assert.match(text, /modules\.createModuleAtPoint\(visibleViewportGardenInsertPoint\(\), "garden"\)/);
    assert.match(text, /entry\.createGardenBtn\.style\.display = candidates\.length \? "none" : "inline-block";/);
});

test("garden dashboard startup focuses sole garden only once", () => {
    const text = viewportToolbarSource();
    const fullSource = source();
    assert.match(text, /let startupGardenFocusDone = false;/);
    assert.match(text, /function runStartupGardenFocusOnce\(\)/);
    assert.match(text, /if \(startupGardenFocusDone\) return;/);
    assert.match(text, /if \(gardens\.length !== 1 \|\| selectedCellIsGardenRelated\(\)\) return;/);
    assert.match(text, /selectAndZoomToGarden\(gardens\[0\]\);/);
    assert.match(fullSource, /scheduleStartupGardenFocus\(\);/);
});

test("garden dashboard resolves linked and ambiguous module contexts", () => {
    const text = viewportToolbarSource();
    assert.match(text, /function linkedGardenModulesForCompanion\(moduleCell\)/);
    assert.match(text, /const typedGardenId = getCellAttr\(moduleCell, "trellis_garden_module_id", ""\);/);
    assert.match(text, /const taskModule = isTaskModule\(cell\) \? cell : findTaskModuleAncestor\(graph, cell\);[\s\S]*if \(taskModule\) return linkedGardenModulesForCompanion\(taskModule\);/);
    assert.match(text, /const teamModule = isTeamModule\(cell\) \? cell : findTeamModuleAncestor\(graph, cell\);[\s\S]*if \(teamModule\) return linkedGardenModulesForCompanion\(teamModule\);/);
    assert.match(text, /if \(ambiguous\.length\) \{[\s\S]*return \{ moduleCell: null, candidates: sortGardensForPicker\(filtered\), allGardens, reason: "ambiguous" \};/);
    assert.match(text, /if \(unique\.length === 1\) return \{ moduleCell: unique\[0\], candidates: allGardens, allGardens, reason: "selected" \};/);
    assert.match(text, /return \{ moduleCell: null, candidates: allGardens, allGardens, reason: "mixed" \};/);
});

test("garden dashboard applies selected year to linked task module cards", () => {
    const text = source();
    assert.match(text, /function collectLinkedTaskBoardCards\(moduleCell\)/);
    assert.match(text, /api\.listBoardsForGarden\(moduleCell\)/);
    assert.match(text, /getDescendants\(board\)\.forEach\(function \(cell\)/);
    assert.match(text, /if \(!isKanbanCard\(cell\) \|\| \(id && seen\.has\(id\)\)\) return;/);
    assert.match(text, /const cards = all\.filter\(isKanbanCard\)\.concat\(collectLinkedTaskBoardCards\(moduleCell\)\);/);
    assert.match(text, /const show = shouldRenderTaskCard\(c, selectedYear\);[\s\S]*setYearHidden\(c, !show\);/);
    assert.match(text, /graph\.refresh\(moduleCell\);[\s\S]*notifyYearFilterChanged\(moduleCell, selectedYear\);/);
});

test("garden dashboard derives active workspace from selection", () => {
    const text = viewportToolbarSource();
    assert.match(text, /function getActiveWorkspaceForSelection\(\)/);
    assert.match(text, /function getSelectedWorkspaceForCell\(cell\)/);
    assert.match(text, /if \(isGardenModule\(cell\) \|\| findGardenModuleAncestor\(graph, cell\)\) return "garden";/);
    assert.match(text, /if \(isTaskModule\(cell\) \|\| findTaskModuleAncestor\(graph, cell\)\) return "tasks";/);
    assert.match(text, /if \(isTeamModule\(cell\) \|\| findTeamModuleAncestor\(graph, cell\)\) return "team";/);
    assert.match(text, /return workspaces\.size === 1 \? Array\.from\(workspaces\)\[0\] : null;/);
    assert.match(text, /applyWorkspaceSegmentState\(entry\.workspaceGardenBtn, activeWorkspace === "garden", false\);/);
    assert.match(text, /applyWorkspaceSegmentState\(entry\.workspaceTasksBtn, activeWorkspace === "tasks", false\);/);
    assert.match(text, /applyWorkspaceSegmentState\(entry\.workspaceTeamBtn, activeWorkspace === "team", false\);/);
});

test("garden workspace switcher repairs companions and pulses destinations", () => {
    const text = viewportToolbarSource();
    assert.match(text, /function ensureWorkspaceTaskModule\(moduleCell\)/);
    assert.match(text, /modules\.ensureGardenTaskModule\(moduleCell, \{ createMainBoard: true \}\)/);
    assert.match(text, /function ensureWorkspaceTeamModule\(moduleCell\)/);
    assert.match(text, /modules\.ensureGardenTeamModule\(moduleCell\)/);
    assert.match(text, /function pulseWorkspaceDestination\(cell\)/);
    assert.match(text, /trellis-garden-workspace-destination-pulse/);
    assert.match(text, /setTimeout\(function \(\) \{ pulseWorkspaceDestination\(openedBoard \|\| taskModule\); \}, 0\);/);
    assert.match(text, /setTimeout\(function \(\) \{ pulseWorkspaceDestination\(teamModule\); \}, 0\);/);
    assert.doesNotMatch(text, /model\.add\(.*trellis-garden-workspace-destination-pulse/);
});

test("garden dashboard disables garden tools outside Garden workspace", () => {
    const text = viewportToolbarSource();
    const fullSource = source();
    assert.match(fullSource, /const WORKSPACE_DISABLED_TITLE = "Return to Garden workspace before using garden tools\.";/);
    assert.match(text, /const gardenToolsDisabled = activeWorkspace === "tasks" \|\| activeWorkspace === "team";/);
    assert.match(text, /const yearControlsDisabled = activeWorkspace === "team";/);
    assert.match(text, /setGardenActionControlsDisabled\(entry, gardenToolsDisabled, gardenToolsDisabled \? WORKSPACE_DISABLED_TITLE : ""\);/);
    assert.match(text, /setYearActionControlsDisabled\(entry, yearControlsDisabled, yearControlsDisabled \? WORKSPACE_DISABLED_TITLE : ""\);/);
    assert.match(text, /\[entry\.planBtn, entry\.equipmentBtn, entry\.irrigationBtn, entry\.allocateBtn, entry\.messagesBtn, entry\.exportBtn, entry\.shareBtn, entry\.tableBtn\]/);
    assert.match(text, /\[entry\.prev, entry\.next\]\.forEach/);
    assert.match(text, /setYearActionControlsDisabled\(entry, true\);/);
    assert.doesNotMatch(text, /entry\.workspaceGardenBtn[\s\S]{0,120}setButtonDisabled/);
    assert.match(text, /const showTaskBoardSelect = activeWorkspace === "tasks" && taskBoards\.length > 1;/);
    assert.match(text, /entry\.taskBoardSelect\.disabled = !taskApi \|\| !showTaskBoardSelect;/);
    assert.match(text, /entry\.taskBoardSelect\.style\.display = showTaskBoardSelect \? "" : "none";/);
});

test("garden dashboard toolbar exposes Garden Workspace Switcher with task badge and selector", () => {
    const text = viewportToolbarSource();
    const fullSource = source();
    assert.match(text, /const workspaceSwitcher = createWorkspaceSwitcher\(\);/);
    assert.match(text, /const workspaceGardenBtn = workspaceSwitcher\.gardenBtn;/);
    assert.match(text, /const workspaceTasksBtn = workspaceSwitcher\.tasksBtn;/);
    assert.match(text, /const workspaceTeamBtn = workspaceSwitcher\.teamBtn;/);
    assert.match(text, /const taskBoardSelect = createTaskBoardSelect\(\);/);
    assert.match(fullSource, /select\.title = "Task Boards";/);
    assert.match(fullSource, /select\.setAttribute\("aria-label", "Task Boards"\);/);
    assert.match(fullSource, /select\.addEventListener\(type, stopToolbarNativeControlEvent\);/); // NEW
    assert.match(fullSource, /function isToolbarNativeControl\(target\)/); // NEW
    assert.match(text, /if \(isToolbarNativeControl\(evt && evt\.target\)\) \{ stopToolbarNativeControlEvent\(evt\); return; \} mxEvent\.consume\(evt\);/); // NEW
    assert.match(fullSource, /function createWorkspaceSwitcher\(\)/);
    assert.match(fullSource, /trellis-garden-workspace-switcher/);
    assert.match(fullSource, /trellis-garden-workspace-task-badge/);
    assert.doesNotMatch(fullSource, /function createTaskBoardButton\(\)/);
    assert.doesNotMatch(fullSource, /trellis-task-board-toolbar-badge/);
    assert.match(fullSource, /function taskBoardOptionLabel\(boardSummary\)/);
    assert.match(fullSource, /return String\(boardSummary && boardSummary\.name \|\| "Kanban"\);/);
    assert.match(fullSource, /const TASK_BOARD_KEY = "KANBAN_BOARD";/);
    assert.match(fullSource, /const LEGACY_TASK_BOARD_KEY = "MAIN_KANBAN_BOARD";/);
    assert.match(fullSource, /function selectedTaskBoardIdForSelection\(\)/);
    assert.match(fullSource, /findTaskBoardAncestor\(cell\)/);
    assert.doesNotMatch(fullSource, /count \? " \(" \+ count \+ "\)" : ""/);
    assert.doesNotMatch(fullSource, /years\.length \? " " \+ years\.join\(", "\) : ""/);
    assert.match(text, /workspaceGardenBtn\.addEventListener\("click", function \(\) \{ openGardenWorkspace\(activeToolbarModule, "garden"\); \}\);/);
    assert.match(text, /workspaceTasksBtn\.addEventListener\("click", function \(\) \{ openToolbarTaskBoard\(activeToolbarModule, taskBoardSelect\.value\); \}\);/);
    assert.match(text, /workspaceTeamBtn\.addEventListener\("click", function \(\) \{ openGardenWorkspace\(activeToolbarModule, "team"\); \}\);/);
    assert.match(text, /taskBoardSelect\.addEventListener\("change", function \(\) \{ if \(activeToolbarModule && taskBoardSelect\.value\) \{ saveRememberedTaskBoardId\(activeToolbarModule, taskBoardSelect\.value\); openToolbarTaskBoard\(activeToolbarModule, taskBoardSelect\.value\); \} \}\);/);
    assert.match(text, /const showTaskBoardSelect = activeWorkspace === "tasks" && taskBoards\.length > 1;/);
    assert.match(text, /entry\.taskBoardSelect\.style\.display = showTaskBoardSelect \? "" : "none";/);
    assert.match(text, /entry\.taskBoardSelect\.disabled = !taskApi \|\| !showTaskBoardSelect;/);
    assert.match(text, /entry\.taskBoardSelect\.title = "Task Boards";/);
});

test("garden dashboard toolbar uses task manager API for boards and unseen counts", () => {
    const text = viewportToolbarSource();
    const fullSource = source();
    assert.match(fullSource, /function taskManagerApi\(\)/);
    assert.match(fullSource, /const requestedBoardId = boardId \|\| selectedTaskBoardIdForGarden\(moduleCell, taskBoards, ""\);/);
    assert.match(fullSource, /const openedBoard = api\.openBoardForGarden\(moduleCell, requestedBoardId, year\);/);
    assert.match(text, /taskApi\.setActiveDashboardContext\(moduleCell, year\);/);
    assert.match(text, /taskApi\.listBoardsForGarden\(moduleCell\)/);
    assert.match(text, /taskApi\.unseenCreatedSummaryForGarden\(moduleCell\)/);
    assert.match(text, /renderWorkspaceSwitcher\(entry, activeWorkspace, taskSummary\);/);
    assert.match(text, /badge\.style\.display = badgeTotal > 0 \? "" : "none";/);
    assert.match(fullSource, /window\.addEventListener\("trellisTaskBoardSeenStateChanged", scheduleViewportToolbarRefresh\);/);
});

test("garden dashboard toolbar persists the selected task board in local user storage", () => {
    const text = viewportToolbarSource();
    const fullSource = source();
    assert.match(text, /const taskBoardSelectionByPreferenceKey = new Map\(\);/);
    assert.match(fullSource, /const WORKSPACE_TASK_BOARD_STORAGE_PREFIX = "trellis\.gardenDashboard\.workspaceTaskBoard\.v1";/);
    assert.match(text, /function workspaceUserScopeKey\(\)/);
    assert.match(text, /return current && current\.id \? "user:" \+ current\.id : "shared";/);
    assert.match(text, /function loadRememberedTaskBoardId\(moduleCell\)/);
    assert.match(text, /function saveRememberedTaskBoardId\(moduleCell, boardId\)/);
    assert.match(text, /if \(requestedBoardId\) saveRememberedTaskBoardId\(moduleCell, requestedBoardId\);/);
    assert.match(text, /if \(openedBoardId\) saveRememberedTaskBoardId\(moduleCell, openedBoardId\);/);
    assert.match(text, /const preferredBoardId = selectedTaskBoardIdForGarden\(moduleCell, taskBoards, entry\.taskBoardSelect\.value, selectedTaskBoardIdForSelection\(\)\);/);
    assert.match(text, /if \(taskBoardIdInList\(boards, selectedBoardId\)\) return String\(selectedBoardId \|\| ""\);/);
    assert.match(text, /if \(id && id === preferredBoardId\) selectedBoardId = id;/);
    assert.match(text, /if \(selectedBoardId\) entry\.taskBoardSelect\.value = selectedBoardId;/);
});

test("garden dashboard selected task board resolver is strict across selected cells", () => {
    const TASK_BOARD_KEY = "KANBAN_BOARD";
    const LEGACY_TASK_BOARD_KEY = "MAIN_KANBAN_BOARD";
    const root = { id: "root" };
    const boardA = { id: "board-a", attrs: { board_key: TASK_BOARD_KEY }, parent: root };
    const boardB = { id: "board-b", attrs: { board_key: TASK_BOARD_KEY }, parent: root };
    const legacyBoard = { id: "legacy-board", attrs: { board_key: LEGACY_TASK_BOARD_KEY }, parent: root };
    const laneA = { id: "lane-a", parent: boardA };
    const cardA = { id: "card-a", parent: laneA };
    const taskModule = { id: "task-module", attrs: { task_module: "1" }, parent: root };

    function getCellAttr(cell, key, def = "") {
        return cell && cell.attrs && Object.prototype.hasOwnProperty.call(cell.attrs, key) ? cell.attrs[key] : def;
    }
    function cellId(cell) {
        return cell && cell.id || "";
    }
    function isTaskBoard(cell) {
        const key = getCellAttr(cell, "board_key", "");
        return key === TASK_BOARD_KEY || key === LEGACY_TASK_BOARD_KEY;
    }
    function findTaskBoardAncestor(cell) {
        let cur = cell;
        while (cur) {
            if (isTaskBoard(cur)) return cur;
            cur = cur.parent || null;
        }
        return null;
    }
    function selectedTaskBoardIdForSelection(selected) {
        if (!selected.length) return "";
        let selectedBoardId = "";
        for (const cell of selected) {
            const board = findTaskBoardAncestor(cell);
            const id = cellId(board);
            if (!id) return "";
            if (selectedBoardId && selectedBoardId !== id) return "";
            selectedBoardId = id;
        }
        return selectedBoardId;
    }

    assert.equal(selectedTaskBoardIdForSelection([boardA]), "board-a");
    assert.equal(selectedTaskBoardIdForSelection([cardA]), "board-a");
    assert.equal(selectedTaskBoardIdForSelection([laneA, cardA]), "board-a");
    assert.equal(selectedTaskBoardIdForSelection([legacyBoard]), "legacy-board");
    assert.equal(selectedTaskBoardIdForSelection([cardA, boardB]), "");
    assert.equal(selectedTaskBoardIdForSelection([taskModule]), "");
    assert.equal(selectedTaskBoardIdForSelection([cardA, taskModule]), "");
});

test("garden dashboard toolbar marks Irrigation active with existing blue", () => {
    const text = viewportToolbarSource();
    const fullSource = source();
    assert.match(fullSource, /const IRRIGATION_MODE_CHANGED_EVENT = "trellisIrrigationModeChanged";/);
    assert.match(fullSource, /const IRRIGATION_ACTIVE_BACKGROUND = "#eff6ff";/);
    assert.match(fullSource, /const IRRIGATION_ACTIVE_TEXT = "#1e3a8a";/);
    assert.match(text, /function activeIrrigationModuleMatches\(moduleCell\)/);
    assert.match(text, /plannerApi\.isIrrigationModeActive\(moduleCell\)/);
    assert.match(text, /function applyToolbarActiveButtonState\(btn, active\)/);
    assert.match(text, /btn\.style\.background = active \? IRRIGATION_ACTIVE_BACKGROUND : "#fff";/);
    assert.match(text, /btn\.style\.borderColor = "#2563eb";/);
    assert.match(text, /btn\.style\.color = active \? IRRIGATION_ACTIVE_TEXT : "#1d4ed8";/);
    assert.match(text, /applyToolbarActiveButtonState\(entry\.irrigationBtn, activeIrrigationModuleMatches\(moduleCell\)\);/);
    assert.match(fullSource, /window\.addEventListener\(IRRIGATION_MODE_CHANGED_EVENT, scheduleViewportToolbarRefresh\);/);
});

test("garden dashboard irrigation buttons close active irrigation mode", () => {
    const text = viewportToolbarSource();
    const fullSource = source();
    assert.match(text, /function toggleIrrigationPlannerForModule\(moduleCell\)/);
    assert.match(text, /plannerApi\.isIrrigationModeActive\(moduleCell\)[\s\S]*plannerApi\.closeIrrigationMode\(\);[\s\S]*return;/);
    assert.match(text, /irrigationBtn\.addEventListener\("click", function \(\) \{ toggleIrrigationPlannerForModule\(activeToolbarModule\); \}\);/);
    assert.doesNotMatch(fullSource, /toggleIrrigationPlannerForDashboard/);
});

test("garden dashboard messages button calls users API for active module and prompts auth", () => {
    const text = viewportToolbarSource();
    assert.match(text, /const messagesBtn = createToolbarButton\("Messages", "Review access requests", "open"\);/);
    assert.match(text, /users\.incomingAccessRequestCount\(\{ scopeCell: moduleCell \}\)/);
    assert.match(text, /users\.unreadAccessMessageCount\(\{ scopeCell: moduleCell \}\)/);
    assert.match(text, /return incoming \+ unread;/);
    assert.match(text, /messagesBtn\.addEventListener\("click", function \(\) \{ openToolbarMessagesDialog\(activeToolbarModule\); \}\);/);
    assert.match(text, /users\.openMessagesDialog\(\{ scopeCell: moduleCell \}\);/);
    assert.match(source(), /window\.addEventListener\("trellisUsersStoreChanged", scheduleViewportToolbarRefresh\);/);
    assert.match(text, /users\.showAuthDialog\(\{ blocking: false, message: users\.isEnabled && users\.isEnabled\(\) \? "Log in to review access messages\." : "Enable users before reviewing access messages\." \}\);/);
    assert.match(text, /entry\.messagesBtn\.textContent = messagesButtonLabel\(moduleCell\);/);
});

test("garden dashboard table is collapsed by default and session scoped", () => {
    const text = viewportToolbarSource();
    assert.match(text, /const toolbarExpandedByModuleId = new Map\(\);/);
    assert.match(text, /table\.style\.display = "none";/);
    assert.match(text, /toolbarExpandedByModuleId\.set\(key, toolbarExpandedByModuleId\.get\(key\) !== true\);/);
    assert.match(text, /entry\.table\.style\.display = expanded \? "block" : "none";/);
    assert.doesNotMatch(text, /setCellAttr\(.*expanded/i);
});

test("legacy dashboard cell code is removed from the viewport dashboard plugin", () => {
    const text = source();
    assert.doesNotMatch(text, /function createDashboardCell/);
    assert.doesNotMatch(text, /function attachExistingDashboards/);
    assert.doesNotMatch(text, /function recomputeAndRenderDashboard/);
    assert.doesNotMatch(text, /function collectTouchedDashboards/);
    assert.doesNotMatch(text, /garden_dashboard/);
    assert.doesNotMatch(text, /DASH_ATTR/);
    assert.doesNotMatch(text, /overlayByDashId/);
});
