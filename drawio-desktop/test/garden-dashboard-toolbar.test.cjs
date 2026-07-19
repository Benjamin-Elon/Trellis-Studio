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
    assert.match(text, /const shareBtn = createToolbarButton\("Share", "Share selected module\(s\), task board\(s\), or garden bed\(s\)"\);/); // NEW
    assert.match(text, /controls\.appendChild\(shareBtn\);/); // NEW
    assert.match(text, /shareBtn\.addEventListener\("click", function \(\) \{ openShareGardenCanvasDialog\(\); \}\);/); // NEW
    assert.match(text, /function shareSelectionState\(\)/); // NEW
    assert.match(text, /users\.getEligibleShareScopes\(selectedCellsForShare\(\)\)/); // NEW
    assert.match(text, /setButtonDisabled\(entry\.shareBtn, !shareState\.ok, shareState\.ok \? "Share selected scope\(s\)" : shareState\.reason\);/); // NEW
    assert.match(text, /function openEnableUsersForShareDialog\(\)/); // CHANGE
    assert.match(text, /Create the first admin before sharing selected garden scopes\./); // NEW
    assert.match(text, /setTimeout\(openShareGardenCanvasDialog, 0\);/); // NEW
    assert.match(text, /Syncthing sharing is unavailable in this Trellis build\./); // NEW
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
