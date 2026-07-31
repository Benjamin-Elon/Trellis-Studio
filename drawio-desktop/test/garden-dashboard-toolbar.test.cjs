const assert = require("node:assert/strict"); // NEW
const fs = require("node:fs"); // NEW
const path = require("node:path"); // NEW
const test = require("node:test"); // NEW

const PROJECT_ROOT = path.join(__dirname, ".."); // NEW
const DASHBOARD_PATH = path.join(PROJECT_ROOT, "drawio", "src", "main", "webapp", "plugins", "garden_planner_plugins", "Garden_Dashboard.js"); // NEW

function source() { // NEW
    return fs.readFileSync(DASHBOARD_PATH, "utf8"); // NEW
} // NEW

function viewportToolbarSource() { // NEW
    const text = source(); // NEW
    const start = text.indexOf("// -------------------- Viewport toolbar (active dashboard UI)"); // NEW
    const end = text.indexOf("function openIrrigationPlannerForDashboard", start); // NEW
    assert.notEqual(start, -1, "Missing viewport toolbar section"); // NEW
    assert.notEqual(end, -1, "Missing legacy compatibility boundary"); // NEW
    return text.slice(start, end); // NEW
} // NEW

test("garden dashboard toolbar is mounted to the graph viewport and sized from the viewport", () => { // NEW
    const text = viewportToolbarSource(); // NEW
    const fullSource = source(); // NEW
    assert.match(text, /wrap\.className = "trellis-garden-dashboard-toolbar"/); // NEW
    assert.match(fullSource, /trellis-graph-control-layer/); // CHANGE
    assert.match(text, /function getViewportToolbarContainer\(\)/); // CHANGE
    assert.match(text, /return graph && graph\.container;/); // NEW
    assert.match(text, /host\.appendChild\(wrap\);/); // NEW
    assert.match(text, /wrap\.style\.position = "fixed";/); // NEW
    assert.match(text, /const host = getViewportToolbarContainer\(\); \/\/ CHANGE/); // NEW
    assert.match(text, /function viewportToolbarWidth\(host\)/); // NEW
    assert.match(text, /host\.getBoundingClientRect/); // NEW
    assert.match(text, /if \(rect && rect\.width\) return rect\.width;/); // NEW
    assert.match(text, /entry\.wrap\.style\.left = Math\.round\(rect\.left \|\| 0\) \+ "px";/); // NEW
    assert.match(text, /entry\.wrap\.style\.top = Math\.round\(rect\.top \|\| 0\) \+ "px";/); // NEW
    assert.match(text, /entry\.wrap\.style\.width = Math\.max\(0, Math\.round\(viewportToolbarWidth\(host\)\)\) \+ "px";/); // NEW
    assert.doesNotMatch(text, /innerWidth/); // NEW
}); // NEW

test("garden dashboard toolbar width follows a narrowed graph container rect", () => { // NEW
    const graph = { // NEW
        container: { // NEW
            clientWidth: 1600, // NEW
            getBoundingClientRect() { return { left: 88, top: 124, width: 916, height: 700 }; } // NEW
        } // NEW
    }; // NEW
    const entry = { wrap: { style: {} } }; // NEW
    function getViewportToolbarContainer() { return graph && graph.container; } // NEW
    function viewportToolbarWidth(host) { // NEW
        if (!host) return 0; // NEW
        const rect = host.getBoundingClientRect ? host.getBoundingClientRect() : null; // NEW
        if (rect && rect.width) return rect.width; // NEW
        return host.clientWidth || 0; // NEW
    } // NEW
    function positionViewportToolbar(target) { // NEW
        const host = getViewportToolbarContainer(); // NEW
        if (!target || !host) return; // NEW
        const rect = host.getBoundingClientRect ? host.getBoundingClientRect() : { left: 0, top: 0 }; // NEW
        target.wrap.style.left = Math.round(rect.left || 0) + "px"; // NEW
        target.wrap.style.top = Math.round(rect.top || 0) + "px"; // NEW
        target.wrap.style.width = Math.max(0, Math.round(viewportToolbarWidth(host))) + "px"; // NEW
    } // NEW
    positionViewportToolbar(entry); // NEW
    assert.equal(entry.wrap.style.left, "88px"); // NEW
    assert.equal(entry.wrap.style.top, "124px"); // NEW
    assert.equal(entry.wrap.style.width, "916px"); // NEW
}); // NEW

test("garden dashboard toolbar follows garden module and descendant selection", () => { // NEW
    const text = viewportToolbarSource(); // NEW
    const fullSource = source(); // NEW
    assert.match(text, /function selectedGardenModuleForToolbar\(\)/); // NEW
    assert.match(text, /graph\.getSelectionCells/); // NEW
    assert.match(text, /const moduleCell = isGardenModule\(cell\) \? cell : findGardenModuleAncestor\(graph, cell\);/); // NEW
    assert.match(text, /if \(!moduleCell\) \{ hideViewportToolbar\(\); return; \}/); // NEW
    assert.match(fullSource, /graph\.getSelectionModel\(\)\.addListener\(mxEvent\.CHANGE, scheduleViewportToolbarRefresh\);/); // NEW
}); // NEW

test("garden dashboard toolbar controls use module scoped plugin contracts", () => { // NEW
    const text = viewportToolbarSource(); // NEW
    assert.match(text, /window\.dispatchEvent\(new CustomEvent\(PLAN_YEAR_EVENT, \{ detail: \{ moduleCellId: cellId\(activeToolbarModule\), year \} \}\)\)/); // NEW
    assert.match(text, /window\.dispatchEvent\(new CustomEvent\(ALLOCATE_PLAN_EVENT, \{ detail: \{ moduleCellId: cellId\(activeToolbarModule\), year \} \}\)\)/); // NEW
    assert.doesNotMatch(text, /dashCellId/); // NEW
    assert.match(text, /equipmentApi\.openDialog\(activeToolbarModule\)/); // NEW
    assert.match(text, /plannerApi\.openIrrigationMode\(moduleCell, \{ preserveViewport: true \}\);/); // NEW
    assert.match(text, /downloadCsv\(`\$\{safeName\}_\$\{year\}_dashboard\.csv`, buildDashboardCsvSingleTable\(metrics, year\)\);/); // NEW
}); // NEW

test("garden dashboard toolbar exposes share only for eligible selected scopes", () => { // NEW
    const text = viewportToolbarSource(); // NEW
    assert.match(text, /const shareBtn = createToolbarButton\("Share", "Share selected module\(s\), task board\(s\), or garden bed\(s\)", "open"\);/); // CHANGE
    assert.match(text, /rightActions\.appendChild\(shareBtn\);/); // CHANGE
    assert.match(text, /shareBtn\.addEventListener\("click", function \(\) \{ openShareGardenCanvasDialog\(\); \}\);/); // NEW
    assert.match(text, /function shareSelectionState\(\)/); // NEW
    assert.match(text, /users\.getEligibleShareScopes\(selectedCellsForShare\(\)\)/); // NEW
    assert.match(text, /setButtonDisabled\(entry\.shareBtn, !shareState\.ok, shareState\.ok \? "Share selected scope\(s\)" : shareState\.reason\);/); // NEW
    assert.match(text, /function openEnableUsersForShareDialog\(\)/); // CHANGE
    assert.match(text, /Create the first admin before sharing selected garden scopes\./); // NEW
    assert.match(text, /setTimeout\(openShareGardenCanvasDialog, 0\);/); // NEW
    assert.match(text, /Syncthing sharing is unavailable in this Trellis build\./); // NEW
}); // NEW

test("garden dashboard toolbar groups tools left and messages export share table right", () => { // NEW
    const text = viewportToolbarSource(); // NEW
    assert.match(text, /leftControls\.className = "trellis-garden-dashboard-toolbar-left"/); // NEW
    assert.match(text, /rightActions\.className = "trellis-garden-dashboard-toolbar-right"/); // NEW
    assert.match(text, /leftControls\.appendChild\(prev\);[\s\S]*leftControls\.appendChild\(yearLabel\);[\s\S]*leftControls\.appendChild\(next\);[\s\S]*leftControls\.appendChild\(planBtn\);[\s\S]*leftControls\.appendChild\(equipmentBtn\);[\s\S]*leftControls\.appendChild\(irrigationBtn\);[\s\S]*leftControls\.appendChild\(allocateBtn\);[\s\S]*leftControls\.appendChild\(taskBoardBtn\);[\s\S]*leftControls\.appendChild\(taskBoardSelect\);/); // CHANGE
    assert.match(text, /rightActions\.appendChild\(messagesBtn\);[\s\S]*rightActions\.appendChild\(exportBtn\);[\s\S]*rightActions\.appendChild\(shareBtn\);[\s\S]*rightActions\.appendChild\(tableBtn\);/); // NEW
    assert.match(text, /controls\.appendChild\(leftControls\);[\s\S]*controls\.appendChild\(rightActions\);/); // NEW
}); // NEW

test("garden dashboard toolbar exposes Task Board button badge and selector", () => { // NEW
    const text = viewportToolbarSource(); // NEW
    const fullSource = source(); // NEW
    assert.match(text, /const taskBoardBtn = createTaskBoardButton\(\);/); // NEW
    assert.match(text, /const taskBoardSelect = createTaskBoardSelect\(\);/); // NEW
    assert.match(fullSource, /function createTaskBoardButton\(\)/); // NEW
    assert.match(fullSource, /trellis-task-board-toolbar-badge/); // NEW
    assert.match(fullSource, /function taskBoardOptionLabel\(boardSummary\)/); // NEW
    assert.match(fullSource, /count \? " \(" \+ count \+ "\)" : ""/); // CHANGE
    assert.match(fullSource, /years\.length \? " " \+ years\.join\(", "\) : ""/); // NEW
    assert.match(text, /taskBoardBtn\.addEventListener\("click", function \(\) \{ openToolbarTaskBoard\(activeToolbarModule, taskBoardSelect\.value\); \}\);/); // NEW
    assert.match(text, /taskBoardSelect\.addEventListener\("change", function \(\) \{ if \(activeToolbarModule && taskBoardSelect\.value\) taskBoardSelectionByModuleId\.set\(cellId\(activeToolbarModule\), taskBoardSelect\.value\); \}\);/); // CHANGE
    assert.doesNotMatch(text, /taskBoardSelect\.addEventListener\("change", function \(\) \{ openToolbarTaskBoard/); // NEW
}); // NEW

test("garden dashboard toolbar uses task manager API for boards and unseen counts", () => { // NEW
    const text = viewportToolbarSource(); // NEW
    const fullSource = source(); // NEW
    assert.match(fullSource, /function taskManagerApi\(\)/); // NEW
    assert.match(fullSource, /const requestedBoardId = boardId \|\| taskBoardSelectionByModuleId\.get\(moduleId\) \|\| "";/); // CHANGE
    assert.match(fullSource, /const openedBoard = api\.openBoardForGarden\(moduleCell, requestedBoardId, year\);/); // CHANGE
    assert.match(text, /taskApi\.setActiveDashboardContext\(moduleCell, year\);/); // NEW
    assert.match(text, /taskApi\.listBoardsForGarden\(moduleCell\)/); // NEW
    assert.match(text, /taskApi\.unseenCreatedSummaryForGarden\(moduleCell\)/); // NEW
    assert.match(text, /badge\.style\.display = badgeTotal > 0 \? "" : "none";/); // NEW
    assert.match(fullSource, /window\.addEventListener\("trellisTaskBoardSeenStateChanged", scheduleViewportToolbarRefresh\);/); // NEW
}); // NEW

test("garden dashboard toolbar preserves the current task board across refresh", () => { // NEW
    const text = viewportToolbarSource(); // NEW
    assert.match(text, /const taskBoardSelectionByModuleId = new Map\(\);/); // NEW
    assert.match(text, /if \(requestedBoardId\) taskBoardSelectionByModuleId\.set\(moduleId, requestedBoardId\);/); // NEW
    assert.match(text, /if \(openedBoardId\) taskBoardSelectionByModuleId\.set\(moduleId, openedBoardId\);/); // NEW
    assert.match(text, /const preferredBoardId = taskBoardSelectionByModuleId\.get\(moduleId\) \|\| entry\.taskBoardSelect\.value \|\| "";/); // NEW
    assert.match(text, /if \(id && id === preferredBoardId\) selectedBoardId = id;/); // NEW
    assert.match(text, /if \(selectedBoardId\) \{ entry\.taskBoardSelect\.value = selectedBoardId; taskBoardSelectionByModuleId\.set\(moduleId, selectedBoardId\); \}/); // NEW
}); // NEW

test("garden dashboard toolbar marks Irrigation active with existing blue", () => { // NEW
    const text = viewportToolbarSource(); // NEW
    const fullSource = source(); // NEW
    assert.match(fullSource, /const IRRIGATION_MODE_CHANGED_EVENT = "trellisIrrigationModeChanged";/); // NEW
    assert.match(fullSource, /const IRRIGATION_ACTIVE_BLUE = "#2563eb";/); // NEW
    assert.match(text, /function activeIrrigationModuleMatches\(moduleCell\)/); // NEW
    assert.match(text, /plannerApi\.isIrrigationModeActive\(moduleCell\)/); // NEW
    assert.match(text, /function applyToolbarActiveButtonState\(btn, active\)/); // NEW
    assert.match(text, /btn\.style\.background = active \? IRRIGATION_ACTIVE_BLUE : "#fff";/); // NEW
    assert.match(text, /btn\.style\.borderColor = active \? IRRIGATION_ACTIVE_BLUE : "#2563eb";/); // CHANGE
    assert.match(text, /btn\.style\.color = active \? "#fff" : "#1d4ed8";/); // CHANGE
    assert.match(text, /applyToolbarActiveButtonState\(entry\.irrigationBtn, activeIrrigationModuleMatches\(moduleCell\)\);/); // NEW
    assert.match(fullSource, /window\.addEventListener\(IRRIGATION_MODE_CHANGED_EVENT, scheduleViewportToolbarRefresh\);/); // NEW
}); // NEW

test("garden dashboard irrigation buttons close active irrigation mode", () => { // CHANGE
    const text = viewportToolbarSource(); // CHANGE
    const fullSource = source(); // CHANGE
    assert.match(text, /function toggleIrrigationPlannerForModule\(moduleCell\)/); // CHANGE
    assert.match(text, /plannerApi\.isIrrigationModeActive\(moduleCell\)[\s\S]*plannerApi\.closeIrrigationMode\(\);[\s\S]*return;/); // CHANGE
    assert.match(text, /irrigationBtn\.addEventListener\("click", function \(\) \{ toggleIrrigationPlannerForModule\(activeToolbarModule\); \}\);/); // CHANGE
    assert.match(fullSource, /function toggleIrrigationPlannerForDashboard\(dashCell\)[\s\S]*toggleIrrigationPlannerForModule\(moduleCell\);/); // CHANGE
    assert.match(fullSource, /irrigationBtn\.addEventListener\("click", \(ev\) => \{[\s\S]*toggleIrrigationPlannerForDashboard\(dashCell\);/); // CHANGE
}); // CHANGE

test("garden dashboard messages button calls users API for active module and prompts auth", () => { // NEW
    const text = viewportToolbarSource(); // NEW
    assert.match(text, /const messagesBtn = createToolbarButton\("Messages", "Review access requests", "open"\);/); // CHANGE
    assert.match(text, /users\.incomingAccessRequestCount\(\{ scopeCell: moduleCell \}\)/); // NEW
    assert.match(text, /users\.unreadAccessMessageCount\(\{ scopeCell: moduleCell \}\)/); // NEW
    assert.match(text, /return incoming \+ unread;/); // NEW
    assert.match(text, /messagesBtn\.addEventListener\("click", function \(\) \{ openToolbarMessagesDialog\(activeToolbarModule\); \}\);/); // NEW
    assert.match(text, /users\.openMessagesDialog\(\{ scopeCell: moduleCell \}\);/); // NEW
    assert.match(source(), /window\.addEventListener\("trellisUsersStoreChanged", scheduleViewportToolbarRefresh\);/); // CHANGE
    assert.match(text, /users\.showAuthDialog\(\{ blocking: false, message: users\.isEnabled && users\.isEnabled\(\) \? "Log in to review access messages\." : "Enable users before reviewing access messages\." \}\);/); // NEW
    assert.match(text, /entry\.messagesBtn\.textContent = messagesButtonLabel\(moduleCell\);/); // NEW
}); // NEW

test("garden dashboard table is collapsed by default and session scoped", () => { // NEW
    const text = viewportToolbarSource(); // NEW
    assert.match(text, /const toolbarExpandedByModuleId = new Map\(\);/); // NEW
    assert.match(text, /table\.style\.display = "none";/); // NEW
    assert.match(text, /toolbarExpandedByModuleId\.set\(key, toolbarExpandedByModuleId\.get\(key\) !== true\);/); // NEW
    assert.match(text, /entry\.table\.style\.display = expanded \? "block" : "none";/); // NEW
    assert.doesNotMatch(text, /setCellAttr\(.*expanded/i); // NEW
}); // NEW

test("legacy dashboard cells are inert and no longer created or attached", () => { // NEW
    const text = source(); // NEW
    assert.match(text, /function createDashboardCell\(moduleCell\) \{\s*return null; \/\/ CHANGE/); // NEW
    assert.match(text, /graph\.addListener\("usl:gardenModuleNeedsSettings", function \(sender, evt\) \{\s*return; \/\/ CHANGE/); // NEW
    assert.match(text, /addItems: function \(menu, cell, evt\) \{ \/\/ CHANGE\s*return; \/\/ CHANGE/); // NEW
    assert.match(text, /function attachExistingDashboards\(\) \{\s*return; \/\/ CHANGE/); // NEW
    assert.match(text, /function scheduleAttachExistingDashboards\(\) \{\s*return; \/\/ CHANGE/); // NEW
    assert.match(text, /function recomputeAndRenderDashboard\(dashCell, opts\) \{ \/\/ CHANGE\s*return; \/\/ CHANGE/); // NEW
    assert.match(text, /function collectTouchedDashboards\(cells\) \{ \/\/ CHANGE\s*return \[\]; \/\/ CHANGE/); // NEW
    assert.match(text, /graph\.getSelectionModel\(\)\.addListener\(mxEvent\.CHANGE, function \(\) \{ \/\/ CHANGE\s*return; \/\/ CHANGE/); // NEW
    const selectionListener = text.slice(text.indexOf("// Recompute when selecting a dashboard"), text.indexOf("// -------------------- Context menu: Create Garden Dashboard")); // NEW
    assert.doesNotMatch(selectionListener, /ensureOverlayForDashboard\(dash\)/); // NEW
    assert.doesNotMatch(selectionListener, /recomputeAndRenderDashboard\(dash\)/); // NEW
}); // NEW
