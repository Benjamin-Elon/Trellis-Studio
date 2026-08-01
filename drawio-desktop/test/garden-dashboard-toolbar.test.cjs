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
    const end = text.indexOf("function openIrrigationPlannerForDashboard", start);
    assert.notEqual(start, -1, "Missing viewport toolbar section");
    assert.notEqual(end, -1, "Missing legacy compatibility boundary");
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
    assert.match(text, /function selectedGardenModuleForToolbar\(\)/);
    assert.match(text, /graph\.getSelectionCells/);
    assert.match(text, /const moduleCell = isGardenModule\(cell\) \? cell : findGardenModuleAncestor\(graph, cell\);/);
    assert.match(text, /if \(!moduleCell\) \{ hideViewportToolbar\(\); return; \}/);
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
    assert.match(text, /setButtonDisabled\(entry\.shareBtn, !shareState\.ok, shareState\.ok \? "Share selected scope\(s\)" : shareState\.reason\);/);
    assert.match(text, /function openEnableUsersForShareDialog\(\)/);
    assert.match(text, /Create the first admin before sharing selected garden scopes\./);
    assert.match(text, /setTimeout\(openShareGardenCanvasDialog, 0\);/);
    assert.match(text, /Syncthing sharing is unavailable in this Trellis build\./);
});

test("garden dashboard toolbar groups tools left and messages export share table right", () => {
    const text = viewportToolbarSource();
    assert.match(text, /leftControls\.className = "trellis-garden-dashboard-toolbar-left"/);
    assert.match(text, /rightActions\.className = "trellis-garden-dashboard-toolbar-right"/);
    assert.match(text, /leftControls\.appendChild\(prev\);[\s\S]*leftControls\.appendChild\(yearLabel\);[\s\S]*leftControls\.appendChild\(next\);[\s\S]*leftControls\.appendChild\(planBtn\);[\s\S]*leftControls\.appendChild\(equipmentBtn\);[\s\S]*leftControls\.appendChild\(irrigationBtn\);[\s\S]*leftControls\.appendChild\(allocateBtn\);[\s\S]*leftControls\.appendChild\(taskBoardBtn\);[\s\S]*leftControls\.appendChild\(taskBoardSelect\);/);
    assert.match(text, /rightActions\.appendChild\(messagesBtn\);[\s\S]*rightActions\.appendChild\(exportBtn\);[\s\S]*rightActions\.appendChild\(shareBtn\);[\s\S]*rightActions\.appendChild\(tableBtn\);/);
    assert.match(text, /controls\.appendChild\(leftControls\);[\s\S]*controls\.appendChild\(rightActions\);/);
});

test("garden dashboard toolbar exposes Task Board button badge and selector", () => {
    const text = viewportToolbarSource();
    const fullSource = source();
    assert.match(text, /const taskBoardBtn = createTaskBoardButton\(\);/);
    assert.match(text, /const taskBoardSelect = createTaskBoardSelect\(\);/);
    assert.match(fullSource, /function createTaskBoardButton\(\)/);
    assert.match(fullSource, /trellis-task-board-toolbar-badge/);
    assert.match(fullSource, /function taskBoardOptionLabel\(boardSummary\)/);
    assert.match(fullSource, /count \? " \(" \+ count \+ "\)" : ""/);
    assert.match(fullSource, /years\.length \? " " \+ years\.join\(", "\) : ""/);
    assert.match(text, /taskBoardBtn\.addEventListener\("click", function \(\) \{ openToolbarTaskBoard\(activeToolbarModule, taskBoardSelect\.value\); \}\);/);
    assert.match(text, /taskBoardSelect\.addEventListener\("change", function \(\) \{ if \(activeToolbarModule && taskBoardSelect\.value\) taskBoardSelectionByModuleId\.set\(cellId\(activeToolbarModule\), taskBoardSelect\.value\); \}\);/);
    assert.doesNotMatch(text, /taskBoardSelect\.addEventListener\("change", function \(\) \{ openToolbarTaskBoard/);
});

test("garden dashboard toolbar uses task manager API for boards and unseen counts", () => {
    const text = viewportToolbarSource();
    const fullSource = source();
    assert.match(fullSource, /function taskManagerApi\(\)/);
    assert.match(fullSource, /const requestedBoardId = boardId \|\| taskBoardSelectionByModuleId\.get\(moduleId\) \|\| "";/);
    assert.match(fullSource, /const openedBoard = api\.openBoardForGarden\(moduleCell, requestedBoardId, year\);/);
    assert.match(text, /taskApi\.setActiveDashboardContext\(moduleCell, year\);/);
    assert.match(text, /taskApi\.listBoardsForGarden\(moduleCell\)/);
    assert.match(text, /taskApi\.unseenCreatedSummaryForGarden\(moduleCell\)/);
    assert.match(text, /badge\.style\.display = badgeTotal > 0 \? "" : "none";/);
    assert.match(fullSource, /window\.addEventListener\("trellisTaskBoardSeenStateChanged", scheduleViewportToolbarRefresh\);/);
});

test("garden dashboard toolbar preserves the current task board across refresh", () => {
    const text = viewportToolbarSource();
    assert.match(text, /const taskBoardSelectionByModuleId = new Map\(\);/);
    assert.match(text, /if \(requestedBoardId\) taskBoardSelectionByModuleId\.set\(moduleId, requestedBoardId\);/);
    assert.match(text, /if \(openedBoardId\) taskBoardSelectionByModuleId\.set\(moduleId, openedBoardId\);/);
    assert.match(text, /const preferredBoardId = taskBoardSelectionByModuleId\.get\(moduleId\) \|\| entry\.taskBoardSelect\.value \|\| "";/);
    assert.match(text, /if \(id && id === preferredBoardId\) selectedBoardId = id;/);
    assert.match(text, /if \(selectedBoardId\) \{ entry\.taskBoardSelect\.value = selectedBoardId; taskBoardSelectionByModuleId\.set\(moduleId, selectedBoardId\); \}/);
});

test("garden dashboard toolbar marks Irrigation active with existing blue", () => {
    const text = viewportToolbarSource();
    const fullSource = source();
    assert.match(fullSource, /const IRRIGATION_MODE_CHANGED_EVENT = "trellisIrrigationModeChanged";/);
    assert.match(fullSource, /const IRRIGATION_ACTIVE_BLUE = "#2563eb";/);
    assert.match(text, /function activeIrrigationModuleMatches\(moduleCell\)/);
    assert.match(text, /plannerApi\.isIrrigationModeActive\(moduleCell\)/);
    assert.match(text, /function applyToolbarActiveButtonState\(btn, active\)/);
    assert.match(text, /btn\.style\.background = active \? IRRIGATION_ACTIVE_BLUE : "#fff";/);
    assert.match(text, /btn\.style\.borderColor = active \? IRRIGATION_ACTIVE_BLUE : "#2563eb";/);
    assert.match(text, /btn\.style\.color = active \? "#fff" : "#1d4ed8";/);
    assert.match(text, /applyToolbarActiveButtonState\(entry\.irrigationBtn, activeIrrigationModuleMatches\(moduleCell\)\);/);
    assert.match(fullSource, /window\.addEventListener\(IRRIGATION_MODE_CHANGED_EVENT, scheduleViewportToolbarRefresh\);/);
});

test("garden dashboard irrigation buttons close active irrigation mode", () => {
    const text = viewportToolbarSource();
    const fullSource = source();
    assert.match(text, /function toggleIrrigationPlannerForModule\(moduleCell\)/);
    assert.match(text, /plannerApi\.isIrrigationModeActive\(moduleCell\)[\s\S]*plannerApi\.closeIrrigationMode\(\);[\s\S]*return;/);
    assert.match(text, /irrigationBtn\.addEventListener\("click", function \(\) \{ toggleIrrigationPlannerForModule\(activeToolbarModule\); \}\);/);
    assert.match(fullSource, /function toggleIrrigationPlannerForDashboard\(dashCell\)[\s\S]*toggleIrrigationPlannerForModule\(moduleCell\);/);
    assert.match(fullSource, /irrigationBtn\.addEventListener\("click", \(ev\) => \{[\s\S]*toggleIrrigationPlannerForDashboard\(dashCell\);/);
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

test("legacy dashboard cells are inert and no longer created or attached", () => {
    const text = source();
    assert.match(text, /function createDashboardCell\(moduleCell\) \{\s*return null;/);
    assert.match(text, /graph\.addListener\("usl:gardenModuleNeedsSettings", function \(sender, evt\) \{\s*return;/);
    assert.match(text, /addItems: function \(menu, cell, evt\) \{\s*return;/);
    assert.match(text, /function attachExistingDashboards\(\) \{\s*return;/);
    assert.match(text, /function scheduleAttachExistingDashboards\(\) \{\s*return;/);
    assert.match(text, /function recomputeAndRenderDashboard\(dashCell, opts\) \{\s*return;/);
    assert.match(text, /function collectTouchedDashboards\(cells\) \{\s*return \[\];/);
    assert.match(text, /graph\.getSelectionModel\(\)\.addListener\(mxEvent\.CHANGE, function \(\) \{\s*return;/);
    const selectionListener = text.slice(text.indexOf("// Recompute when selecting a dashboard"), text.indexOf("// -------------------- Context menu: Create Garden Dashboard"));
    assert.doesNotMatch(selectionListener, /ensureOverlayForDashboard\(dash\)/);
    assert.doesNotMatch(selectionListener, /recomputeAndRenderDashboard\(dash\)/);
});
