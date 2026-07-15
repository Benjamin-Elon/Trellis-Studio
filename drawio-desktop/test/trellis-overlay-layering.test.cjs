const assert = require("node:assert/strict"); // NEW
const fs = require("node:fs"); // NEW
const path = require("node:path"); // NEW
const test = require("node:test"); // NEW

const PROJECT_ROOT = path.join(__dirname, ".."); // NEW
const PLUGIN_ROOT = path.join(PROJECT_ROOT, "drawio", "src", "main", "webapp", "plugins", "garden_planner_plugins"); // NEW
const DIALOG_LAYER = 2e9; // NEW

function readProjectFile(relPath) { // NEW
    return fs.readFileSync(path.join(PROJECT_ROOT, relPath), "utf8"); // NEW
} // NEW

function readPlugin(name) { // NEW
    return fs.readFileSync(path.join(PLUGIN_ROOT, name), "utf8"); // NEW
} // NEW

function overlayLayerSource(name) { // NEW
    const source = readPlugin(name); // NEW
    const match = source.match(/const GRAPH_OVERLAY_Z = Object\.freeze\(\{ ANNOTATION: (\d+), CONNECTION: (\d+), CONTROL: (\d+), CONTROL_TOP: (\d+) \}\);/); // NEW
    assert.ok(match, name + " should declare the graph overlay layer contract"); // NEW
    return { // NEW
        annotation: Number(match[1]), // NEW
        connection: Number(match[2]), // NEW
        control: Number(match[3]), // NEW
        controlTop: Number(match[4]) // NEW
    }; // NEW
} // NEW

function assertLayerContract(name) { // NEW
    const z = overlayLayerSource(name); // NEW
    assert.equal(z.annotation, 10000, name + " annotation layer should be stable"); // NEW
    assert.equal(z.connection, 10010, name + " connection layer should be stable"); // NEW
    assert.equal(z.control, 10020, name + " control layer should be stable"); // NEW
    assert.equal(z.controlTop, 10030, name + " top-control layer should be stable"); // NEW
    assert.ok(z.annotation < z.connection, name + " annotations should sit below connection visuals"); // NEW
    assert.ok(z.connection < z.control, name + " connection visuals should sit below controls"); // NEW
    assert.ok(z.control < z.controlTop, name + " controls should sit below top controls"); // NEW
    assert.ok(z.controlTop < DIALOG_LAYER, name + " graph overlays should stay below Draw.io dialogs"); // NEW
} // NEW

test("graph overlay plugins share a dialog-safe layer contract", () => { // NEW
    [ // NEW
        "Plant_Tiler.js", // NEW
        "Modules_Standalone.js", // NEW
        "Garden_Beds.js", // NEW
        "Garden_Dashboard.js", // NEW
        "Garden_Task_Manager.js", // NEW
        "Garden_Scale.js", // NEW
        "Deep_Click_Through.js", // NEW
        "Vertex_Linking_Standalone.js", // NEW
        "Bed_Succession_Navigator.js" // NEW
    ].forEach(assertLayerContract); // NEW

    assert.match(readProjectFile("drawio/src/main/webapp/js/diagramly/EditorUi.js"), /zIndex: 2e9/); // NEW
    assert.match(readProjectFile("drawio/src/main/webapp/js/diagramly/Dialogs.js"), /zIndex: 2e9/); // NEW
}); // NEW

test("irrigation controls render above irrigation annotations and connection overlays", () => { // NEW
    const source = readPlugin("Garden_Irrigation_Planner.js"); // NEW

    assert.match(source, /function overlayHost\(\)/); // CHANGE
    assert.match(source, /const pane = graph\.view && graph\.view\.overlayPane \? graph\.view\.overlayPane : null/); // CHANGE
    assert.match(source, /function appendOverlayNode\(node\)[\s\S]*host\.appendChild\(node\)/); // CHANGE
    assert.match(source, /trellis-irrigation-mode-hud[\s\S]*z-index:1005/); // CHANGE
    assert.match(source, /trellis-irrigation-enter-mode[\s\S]*z-index:1005/); // CHANGE
    assert.match(source, /function portBadgeStyle[\s\S]*z-index:1002/); // CHANGE
    assert.match(source, /function internalConnectionBadgeStyle[\s\S]*z-index:1003/); // CHANGE
    assert.match(source, /selected-pipe-highlight[\s\S]*z-index:999/); // CHANGE
    assert.match(source, /trellis-irrigation-zone-badge[\s\S]*z-index:997/); // CHANGE
    assert.match(source, /trellis-irrigation-warning-badge[\s\S]*z-index:998/); // CHANGE
}); // NEW

test("graph-local Trellis controls use control layers", () => { // NEW
    assert.match(readPlugin("Plant_Tiler.js"), /toolbar\.style\.zIndex = String\(GRAPH_OVERLAY_Z\.CONTROL\)/); // NEW
    assert.match(readPlugin("Modules_Standalone.js"), /trellis-root-module-overlay[\s\S]*overlay\.style\.zIndex = String\(GRAPH_OVERLAY_Z\.CONTROL\)/); // NEW
    assert.match(readPlugin("Modules_Standalone.js"), /trellis-team-role-overlay[\s\S]*overlay\.style\.zIndex = String\(GRAPH_OVERLAY_Z\.CONTROL\)/); // NEW
    assert.match(readPlugin("Modules_Standalone.js"), /trellis-role-image-overlay[\s\S]*overlay\.style\.zIndex = String\(GRAPH_OVERLAY_Z\.CONTROL\)/); // NEW
    assert.match(readPlugin("Garden_Beds.js"), /trellis-bed-conditions-overlay[\s\S]*div\.style\.zIndex = String\(GRAPH_OVERLAY_Z\.CONTROL\)/); // NEW
    assert.match(readPlugin("Garden_Dashboard.js"), /trellis-garden-dashboard-toolbar[\s\S]*wrap\.style\.zIndex = String\(GRAPH_OVERLAY_Z\.CONTROL\)/); // NEW
    assert.match(readPlugin("Garden_Task_Manager.js"), /trellis-task-board-header-controls[\s\S]*bar\.style\.zIndex = String\(GRAPH_OVERLAY_Z\.CONTROL\)/); // NEW
    assert.match(readPlugin("Garden_Task_Manager.js"), /trellis-task-selected-card-actions[\s\S]*overlay\.style\.zIndex = String\(GRAPH_OVERLAY_Z\.CONTROL\)/); // NEW
    assert.match(readPlugin("Garden_Task_Manager.js"), /const paneIsSvg = !!\(pane && pane\.namespaceURI === 'http:\/\/www\.w3\.org\/2000\/svg'\)/); // NEW
    assert.match(readPlugin("Garden_Task_Manager.js"), /const baseHost = pane && !paneIsSvg \? pane : \(graph\.container \|\| pane \|\| null\)/); // CHANGE
    assert.match(readPlugin("Garden_Task_Manager.js"), /trellis-task-control-layer/); // NEW
    assert.match(readPlugin("Garden_Dashboard.js"), /trellis-graph-control-layer/); // NEW
    assert.match(readPlugin("Garden_Dashboard.js"), /trellis-body-control-layer/); // NEW
    assert.match(readPlugin("Garden_Dashboard.js"), /document\.body\.appendChild\(layer\)/); // NEW
    const vertexLinking = readPlugin("Vertex_Linking_Standalone.js"); // NEW
    assert.match(vertexLinking, /trellis-graph-connection-layer/); // NEW
    assert.match(vertexLinking, /trellis-graph-control-layer/); // NEW
    assert.match(vertexLinking, /ensureGraphOverlaySvgLayer\('connection'\)/); // NEW
    assert.match(vertexLinking, /panelHost\.appendChild\(entry\.panel\)/); // NEW
    assert.match(vertexLinking, /manual-link-task-schedule-overlay/); // NEW
    assert.match(vertexLinking, /panel\.style\.zIndex = String\(GRAPH_OVERLAY_Z\.CONTROL\)/); // NEW
}); // NEW

test("custom Trellis dialogs render at the Draw.io dialog layer", () => { // NEW
    const yearPlanner = readPlugin("Year_Planner.js"); // NEW
    assert.match(yearPlanner, /const TRELLIS_DIALOG_Z = 2000000000;/); // NEW
    assert.match(yearPlanner, /z-index:" \+ TRELLIS_DIALOG_Z \+ "/); // NEW
    const scheduler = readPlugin("Garden_Scheduler_Dialog.js"); // NEW
    assert.match(scheduler, /const TRELLIS_DIALOG_Z = 2000000000;/); // NEW
    assert.match(scheduler, /function elevateTrellisDialog/); // NEW
    assert.match(scheduler, /dlg\.container\.style\.zIndex = String\(TRELLIS_DIALOG_Z\)/); // NEW
    assert.match(scheduler, /dlg\.bg\.style\.zIndex = String\(TRELLIS_DIALOG_Z - 1\)/); // NEW
    const showDialogCount = (scheduler.match(/ui\.showDialog\(/g) || []).length; // NEW
    const elevateCount = (scheduler.match(/elevateTrellisDialog\(ui\)/g) || []).length; // NEW
    assert.ok(showDialogCount > 0, "scheduler should own dialog call sites"); // NEW
    assert.equal(elevateCount, showDialogCount, "scheduler should elevate each owned ui.showDialog call"); // NEW
    const taskManager = readPlugin("Garden_Task_Manager.js"); // NEW
    assert.match(taskManager, /const TRELLIS_DIALOG_Z = 2000000000;/); // NEW
    assert.match(taskManager, /function elevateTaskManagerDialog\(\)/); // NEW
    assert.match(taskManager, /dlg\.container\.style\.zIndex = String\(TRELLIS_DIALOG_Z\)/); // NEW
    assert.match(taskManager, /dlg\.bg\.style\.zIndex = String\(TRELLIS_DIALOG_Z - 1\)/); // NEW
    assert.equal((taskManager.match(/ui\.showDialog\(/g) || []).length, 1); // NEW
    const gardenBeds = readPlugin("Garden_Beds.js"); // NEW
    assert.match(gardenBeds, /const TRELLIS_DIALOG_Z = 2000000000;/); // NEW
    assert.match(gardenBeds, /function elevateBedConditionsDialog\(\)/); // NEW
    assert.match(gardenBeds, /dlg\.container\.style\.zIndex = String\(TRELLIS_DIALOG_Z\)/); // NEW
    assert.match(gardenBeds, /dlg\.bg\.style\.zIndex = String\(TRELLIS_DIALOG_Z - 1\)/); // NEW
    assert.equal((gardenBeds.match(/ui\.showDialog\(/g) || []).length, (gardenBeds.match(/elevateBedConditionsDialog\(\)/g) || []).length - 1); // NEW
}); // NEW

test("non-control graph overlays stay below controls", () => { // NEW
    assert.match(readPlugin("Garden_Scale.js"), /const OVERLAY_Z = GRAPH_OVERLAY_Z\.ANNOTATION;/); // NEW
    assert.doesNotMatch(readPlugin("Bed_Succession_Navigator.js"), /styleOverlapBadge|badgePrev|badgeNext/); // CHANGE
    assert.match(readPlugin("Bed_Succession_Navigator.js"), /function styleBtn[\s\S]*el\.style\.zIndex = String\(GRAPH_OVERLAY_Z\.CONTROL\)/); // NEW
    assert.match(readPlugin("Bed_Succession_Navigator.js"), /function styleSelectBtn[\s\S]*el\.style\.zIndex = String\(GRAPH_OVERLAY_Z\.CONTROL\)/); // NEW
    assert.match(readPlugin("Deep_Click_Through.js"), /handle\.style\.zIndex = String\(GRAPH_OVERLAY_Z\.CONTROL_TOP\)/); // NEW
    assert.match(readPlugin("Deep_Click_Through.js"), /div\.style\.zIndex = String\(GRAPH_OVERLAY_Z\.CONTROL_TOP\)/); // NEW
}); // NEW
