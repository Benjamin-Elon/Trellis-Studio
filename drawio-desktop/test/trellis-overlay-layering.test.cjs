const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const PROJECT_ROOT = path.join(__dirname, "..");
const PLUGIN_ROOT = path.join(PROJECT_ROOT, "drawio", "src", "main", "webapp", "plugins", "garden_planner_plugins");
const DIALOG_LAYER = 2e9;

function readProjectFile(relPath) {
    return fs.readFileSync(path.join(PROJECT_ROOT, relPath), "utf8");
}

function readPlugin(name) {
    return fs.readFileSync(path.join(PLUGIN_ROOT, name), "utf8");
}

function overlayLayerSource(name) {
    const source = readPlugin(name);
    const match = source.match(/const GRAPH_OVERLAY_Z = Object\.freeze\(\{ ANNOTATION: (\d+), CONNECTION: (\d+), CONTROL: (\d+), CONTROL_TOP: (\d+) \}\);/);
    assert.ok(match, name + " should declare the graph overlay layer contract");
    return {
        annotation: Number(match[1]),
        connection: Number(match[2]),
        control: Number(match[3]),
        controlTop: Number(match[4])
    };
}

function assertLayerContract(name) {
    const z = overlayLayerSource(name);
    assert.equal(z.annotation, 10000, name + " annotation layer should be stable");
    assert.equal(z.connection, 10010, name + " connection layer should be stable");
    assert.equal(z.control, 10020, name + " control layer should be stable");
    assert.equal(z.controlTop, 10030, name + " top-control layer should be stable");
    assert.ok(z.annotation < z.connection, name + " annotations should sit below connection visuals");
    assert.ok(z.connection < z.control, name + " connection visuals should sit below controls");
    assert.ok(z.control < z.controlTop, name + " controls should sit below top controls");
    assert.ok(z.controlTop < DIALOG_LAYER, name + " graph overlays should stay below Draw.io dialogs");
}

test("graph overlay plugins share a dialog-safe layer contract", () => {
    [
        "Plant_Tiler.js",
        "Modules_Standalone.js",
        "Garden_Beds.js",
        "Garden_Dashboard.js",
        "Garden_Task_Manager.js",
        "Garden_Irrigation_Planner.js",
        "Garden_Scale.js",
        "Deep_Click_Through.js",
        "Vertex_Linking_Standalone.js",
        "Bed_Succession_Navigator.js",
        "Created_Change_Map.js"
    ].forEach(assertLayerContract);

    assert.match(readProjectFile("drawio/src/main/webapp/js/diagramly/EditorUi.js"), /zIndex: 2e9/);
    assert.match(readProjectFile("drawio/src/main/webapp/js/diagramly/Dialogs.js"), /zIndex: 2e9/);
});

test("irrigation controls render above irrigation annotations and connection overlays", () => {
    const source = readPlugin("Garden_Irrigation_Planner.js");

    assert.match(source, /function overlayHost\(\)/);
    assert.match(source, /const pane = graph\.view && graph\.view\.overlayPane \? graph\.view\.overlayPane : null/);
    assert.match(source, /function appendOverlayNode\(node\)[\s\S]*host\.appendChild\(node\)/);
    assert.match(source, /function ensureIrrigationControlLayer\(\)[\s\S]*trellis-irrigation-control-layer/);
    assert.match(source, /const baseHost = graph\.container \|\| \(pane && !paneIsSvg \? pane : null\)/);
    assert.match(source, /function inlineConnectionActionStyle[\s\S]*GRAPH_OVERLAY_Z\.CONTROL_TOP/);
    assert.match(source, /trellis-irrigation-mode-hud[\s\S]*z-index:1005/);
    assert.match(source, /trellis-irrigation-enter-mode[\s\S]*z-index:1005/);
    assert.match(source, /function portBadgeStyle[\s\S]*z-index:1002/);
    assert.match(source, /function internalConnectionBadgeStyle[\s\S]*z-index:1003/);
    assert.match(source, /selected-pipe-highlight[\s\S]*z-index:999/);
    assert.match(source, /trellis-irrigation-zone-badge[\s\S]*z-index:997/);
    assert.match(source, /trellis-irrigation-warning-badge[\s\S]*z-index:998/);
});

test("graph-local Trellis controls use control layers", () => {
    assert.match(readPlugin("Plant_Tiler.js"), /toolbar\.style\.zIndex = String\(GRAPH_OVERLAY_Z\.CONTROL\)/);
    assert.match(readPlugin("Modules_Standalone.js"), /trellis-root-module-overlay[\s\S]*overlay\.style\.zIndex = String\(GRAPH_OVERLAY_Z\.CONTROL\)/);
    assert.match(readPlugin("Modules_Standalone.js"), /trellis-team-role-overlay[\s\S]*overlay\.style\.zIndex = String\(GRAPH_OVERLAY_Z\.CONTROL\)/);
    assert.match(readPlugin("Modules_Standalone.js"), /trellis-role-image-overlay[\s\S]*overlay\.style\.zIndex = String\(GRAPH_OVERLAY_Z\.CONTROL\)/);
    assert.match(readPlugin("Garden_Beds.js"), /trellis-bed-conditions-overlay[\s\S]*div\.style\.zIndex = String\(GRAPH_OVERLAY_Z\.CONTROL\)/);
    assert.match(readPlugin("Garden_Dashboard.js"), /trellis-garden-dashboard-toolbar[\s\S]*wrap\.style\.zIndex = String\(GRAPH_OVERLAY_Z\.CONTROL\)/);
    assert.match(readPlugin("Garden_Dashboard.js"), /wrap\.style\.zIndex = String\(GRAPH_OVERLAY_Z\.CONTROL\);/);
    assert.match(readPlugin("Created_Change_Map.js"), /panel\.style\.zIndex = String\(GRAPH_OVERLAY_Z\.CONTROL\)/);
    assert.match(readPlugin("Garden_Task_Manager.js"), /trellis-task-board-header-controls[\s\S]*bar\.style\.zIndex = String\(GRAPH_OVERLAY_Z\.CONTROL\)/);
    assert.match(readPlugin("Garden_Task_Manager.js"), /trellis-task-selected-card-actions[\s\S]*overlay\.style\.zIndex = String\(GRAPH_OVERLAY_Z\.CONTROL\)/);
    assert.match(readPlugin("Garden_Task_Manager.js"), /const paneIsSvg = !!\(pane && pane\.namespaceURI === 'http:\/\/www\.w3\.org\/2000\/svg'\)/);
    assert.match(readPlugin("Garden_Task_Manager.js"), /const baseHost = pane && !paneIsSvg \? pane : \(graph\.container \|\| pane \|\| null\)/);
    assert.match(readPlugin("Garden_Task_Manager.js"), /trellis-task-control-layer/);
    assert.match(readPlugin("Garden_Dashboard.js"), /trellis-graph-control-layer/);
    assert.match(readPlugin("Garden_Dashboard.js"), /trellis-body-control-layer/);
    assert.match(readPlugin("Garden_Dashboard.js"), /document\.body\.appendChild\(layer\)/);
    const vertexLinking = readPlugin("Vertex_Linking_Standalone.js");
    assert.match(vertexLinking, /trellis-graph-connection-layer/);
    assert.match(vertexLinking, /trellis-graph-control-layer/);
    assert.match(vertexLinking, /ensureGraphOverlaySvgLayer\('connection'\)/);
    assert.match(vertexLinking, /function getPanelLayer\(\) \{[\s\S]*return ensureGraphOverlayHtmlLayer\('control'\);/);
    assert.doesNotMatch(vertexLinking, /return ensureGraphOverlayHtmlLayer\('control'\) \|\| getPanelHost\(\)/);
    assert.match(vertexLinking, /panelHost\.appendChild\(entry\.panel\)/);
    assert.match(vertexLinking, /manual-link-task-schedule-overlay/);
    assert.match(vertexLinking, /panel\.style\.zIndex = String\(GRAPH_OVERLAY_Z\.CONTROL\)/);
});

test("custom Trellis dialogs render at the Draw.io dialog layer", () => {
    const users = readPlugin("Trellis_Users.js");
    assert.match(users, /const USERS_UI_LAYER_Z = 2000000000;/);
    assert.match(users, /const AUTH_OVERLAY_Z = 2147483000;/);
    assert.match(users, /trellis-users-rejected-edit-popover[\s\S]*z-index:" \+ USERS_UI_LAYER_Z/);
    assert.match(users, /trellis-users-access-dialog[\s\S]*z-index:" \+ USERS_UI_LAYER_Z/);
    assert.match(users, /trellis-users-auth-overlay[\s\S]*z-index:" \+ AUTH_OVERLAY_Z/);
    assert.doesNotMatch(users, /ui\.showDialog\(buildChangeRejectedDialog/);
    assert.match(users, /accountMenu\.style\.cssText = "position:fixed[\s\S]*z-index:" \+ USERS_UI_LAYER_Z/);
    assert.match(users, /const host = document\.body;[\s\S]*panel\.style\.cssText = "position:fixed[\s\S]*z-index:" \+ USERS_UI_LAYER_Z/);
    const yearPlanner = readPlugin("Year_Planner.js");
    assert.match(yearPlanner, /const TRELLIS_DIALOG_Z = 2000000000;/);
    assert.match(yearPlanner, /z-index:" \+ TRELLIS_DIALOG_Z \+ "/);
    const scheduler = readPlugin("Garden_Scheduler_Dialog.js");
    assert.match(scheduler, /const TRELLIS_DIALOG_Z = 2000000000;/);
    assert.match(scheduler, /function elevateTrellisDialog/);
    assert.match(scheduler, /dlg\.container\.style\.zIndex = String\(TRELLIS_DIALOG_Z\)/);
    assert.match(scheduler, /dlg\.bg\.style\.zIndex = String\(TRELLIS_DIALOG_Z - 1\)/);
    const showDialogCount = (scheduler.match(/ui\.showDialog\(/g) || []).length;
    const elevateCount = (scheduler.match(/elevateTrellisDialog\(ui\)/g) || []).length;
    assert.ok(showDialogCount > 0, "scheduler should own dialog call sites");
    assert.equal(elevateCount, showDialogCount, "scheduler should elevate each owned ui.showDialog call");
    const taskManager = readPlugin("Garden_Task_Manager.js");
    assert.match(taskManager, /const TRELLIS_DIALOG_Z = 2000000000;/);
    assert.match(taskManager, /function elevateTaskManagerDialog\(\)/);
    assert.match(taskManager, /dlg\.container\.style\.zIndex = String\(TRELLIS_DIALOG_Z\)/);
    assert.match(taskManager, /dlg\.bg\.style\.zIndex = String\(TRELLIS_DIALOG_Z - 1\)/);
    assert.equal((taskManager.match(/ui\.showDialog\(/g) || []).length, 1);
    const gardenBeds = readPlugin("Garden_Beds.js");
    assert.match(gardenBeds, /const TRELLIS_DIALOG_Z = 2000000000;/);
    assert.match(gardenBeds, /function elevateBedConditionsDialog\(\)/);
    assert.match(gardenBeds, /dlg\.container\.style\.zIndex = String\(TRELLIS_DIALOG_Z\)/);
    assert.match(gardenBeds, /dlg\.bg\.style\.zIndex = String\(TRELLIS_DIALOG_Z - 1\)/);
    assert.equal((gardenBeds.match(/ui\.showDialog\(/g) || []).length, (gardenBeds.match(/elevateBedConditionsDialog\(\)/g) || []).length - 1);
    const plantTiler = readPlugin("Plant_Tiler.js");
    assert.match(plantTiler, /const TRELLIS_DIALOG_Z = 2000000000;/);
    assert.match(plantTiler, /function elevateTrellisDialog\(\)/);
    assert.match(plantTiler, /dlg\.container\.style\.zIndex = String\(TRELLIS_DIALOG_Z\)/);
    assert.match(plantTiler, /dlg\.bg\.style\.zIndex = String\(TRELLIS_DIALOG_Z - 1\)/);
    assert.equal((plantTiler.match(/ui\.showDialog\(/g) || []).length, (plantTiler.match(/elevateTrellisDialog\(\)/g) || []).length - 1);
    const irrigation = readPlugin("Garden_Irrigation_Planner.js");
    assert.match(irrigation, /const TRELLIS_DIALOG_Z = 2000000000;/);
    assert.match(irrigation, /function showDialog\(node, w, h\)[\s\S]*ui\.showDialog\(node, w, h, true, true\);[\s\S]*elevateTrellisDialog\(\);/);
    assert.match(irrigation, /function elevateTrellisDialog\(\)/);
    assert.match(irrigation, /dlg\.container\.style\.zIndex = String\(TRELLIS_DIALOG_Z\)/);
    assert.match(irrigation, /dlg\.bg\.style\.zIndex = String\(TRELLIS_DIALOG_Z - 1\)/);
    assert.equal((irrigation.match(/ui\.showDialog\(/g) || []).length, 1);
    const databaseTools = readPlugin("Trellis_Database_Tools.js");
    assert.match(databaseTools, /const TRELLIS_DIALOG_Z = 2000000000;/);
    assert.match(databaseTools, /function elevateTrellisDialog\(ui\)/);
    assert.match(databaseTools, /ui\.showDialog\(buildRestoreDialog\(ui\), 560, 320, true, true\);[\s\S]*elevateTrellisDialog\(ui\);/);
    const updatesLinks = readPlugin("Trellis_Updates_Links.js");
    assert.match(updatesLinks, /const TRELLIS_DIALOG_Z = 2000000000;/);
    assert.match(updatesLinks, /function elevateTrellisDialog\(ui\)/);
    assert.match(updatesLinks, /ui\.showDialog\(buildDialog\(ui\), 960, 620, true, true\);[\s\S]*elevateTrellisDialog\(ui\);/);
    const dashboard = readPlugin("Garden_Dashboard.js");
    assert.match(dashboard, /const TRELLIS_DIALOG_Z = 2000000000;/);
    assert.match(dashboard, /z-index:" \+ TRELLIS_DIALOG_Z \+ "/);
    assert.doesNotMatch(dashboard, /z-index:100040/);
    const equipment = readPlugin("Garden_Equipment.js");
    assert.match(equipment, /const TRELLIS_DIALOG_Z = 2000000000;/);
    assert.match(equipment, /trellis-eq-overlay[\s\S]*z-index: \$\{TRELLIS_DIALOG_Z\}/);
    assert.doesNotMatch(equipment, /z-index: 10030/);
});

test("non-control graph overlays stay below controls", () => {
    assert.match(readPlugin("Garden_Scale.js"), /const OVERLAY_Z = GRAPH_OVERLAY_Z\.ANNOTATION;/);
    assert.doesNotMatch(readPlugin("Bed_Succession_Navigator.js"), /styleOverlapBadge|badgePrev|badgeNext/);
    assert.match(readPlugin("Bed_Succession_Navigator.js"), /function styleBtn[\s\S]*el\.style\.zIndex = String\(GRAPH_OVERLAY_Z\.CONTROL\)/);
    assert.match(readPlugin("Bed_Succession_Navigator.js"), /function styleSelectBtn[\s\S]*el\.style\.zIndex = String\(GRAPH_OVERLAY_Z\.CONTROL\)/);
    assert.match(readPlugin("Deep_Click_Through.js"), /handle\.style\.zIndex = String\(GRAPH_OVERLAY_Z\.CONTROL_TOP\)/);
    assert.match(readPlugin("Deep_Click_Through.js"), /div\.style\.zIndex = String\(GRAPH_OVERLAY_Z\.CONTROL_TOP\)/);
    const changeMap = readPlugin("Created_Change_Map.js");
    assert.doesNotMatch(changeMap, /zIndex: 9999/);
    assert.doesNotMatch(changeMap, /zIndex: 9998/);
    assert.match(changeMap, /zIndex: String\(GRAPH_OVERLAY_Z\.ANNOTATION\)/);
});
