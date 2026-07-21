const assert = require("node:assert/strict"); // NEW
const fs = require("node:fs"); // NEW
const path = require("node:path"); // NEW
const test = require("node:test"); // NEW
const vm = require("node:vm"); // NEW
const { JSDOM } = require("jsdom"); // NEW

const PLUGIN_PATH = path.join( // NEW
    __dirname, // NEW
    "..", // NEW
    "drawio", // NEW
    "src", // NEW
    "main", // NEW
    "webapp", // NEW
    "plugins", // NEW
    "garden_planner_plugins", // NEW
    "Deep_Click_Through.js" // NEW
); // NEW
const TEST_MOVE_IMAGE = "data:image/svg+xml;base64,PHN2Zy8+"; // NEW

class TestCell { // NEW
    constructor(id, attrs = {}, style = "") { // NEW
        this.id = id; // NEW
        this.attrs = { ...attrs }; // NEW
        this.style = style; // NEW
        this.children = []; // NEW
    } // NEW

    getAttribute(key) { return this.attrs[key] || null; } // NEW
} // NEW

class TestModel { // NEW
    constructor(root) { this.root = root; } // NEW
    getRoot() { return this.root; } // NEW
    getParent(cell) { return cell && cell.parent ? cell.parent : null; } // NEW
    getChildCount(cell) { return cell && cell.children ? cell.children.length : 0; } // NEW
    getChildAt(cell, index) { return cell.children[index]; } // NEW
    getChildCells(cell) { return cell && cell.children ? cell.children.slice() : []; } // NEW
    isVertex(cell) { return !!cell && cell !== this.root; } // NEW
} // NEW

function appendChild(parent, child) { // NEW
    child.parent = parent; // NEW
    parent.children.push(child); // NEW
    return child; // NEW
} // NEW

function makeHarness() { // NEW
    const dom = new JSDOM("<!doctype html><body><div id='graph'></div></body>"); // NEW
    const document = dom.window.document; // NEW
    const root = new TestCell("root"); // NEW
    const gardenModule = appendChild(root, new TestCell("garden", { garden_module: "1" }, "swimlane;module=1")); // NEW
    const legacyGardenModule = appendChild(root, new TestCell("legacyGarden", { trellis_garden_module: "1" }, "swimlane;module=1")); // NEW
    const regularModule = appendChild(root, new TestCell("regular", {}, "swimlane;module=1")); // NEW
    const teamModule = appendChild(root, new TestCell("team", { team_module: "1" }, "swimlane;module=1")); // NEW
    const bed = appendChild(gardenModule, new TestCell("bed", { garden_bed: "1" })); // NEW
    const tilerGroup = appendChild(gardenModule, new TestCell("tiler", { tiler_group: "1" })); // NEW
    const lane = appendChild(gardenModule, new TestCell("lane", { lane_key: "TODO" }, "swimlane;")); // NEW
    const card = appendChild(lane, new TestCell("card", { kanban_card: "1" })); // NEW
    const kanbanBoard = appendChild(root, new TestCell("kanbanBoard", { board_key: "KANBAN_BOARD" }, "swimlane;")); // CHANGE
    const kanbanLane = appendChild(kanbanBoard, new TestCell("kanbanLane", { lane_key: "TODO" }, "swimlane;")); // NEW
    const kanbanCard = appendChild(kanbanLane, new TestCell("kanbanCard", { kanban_card: "1" })); // NEW
    const regularChild = appendChild(regularModule, new TestCell("regularChild", {})); // NEW
    const teamRole = appendChild(teamModule, new TestCell("teamRole", {}, "shape=swimlane;role_card=1")); // NEW
    const model = new TestModel(root); // NEW
    let selectedCells = []; // NEW
    const movableCells = new Map(); // NEW
    const stateMap = new Map(); // NEW
    stateMap.set(gardenModule, { cell: gardenModule, x: 10, y: 20, width: 300, height: 220 }); // NEW
    stateMap.set(legacyGardenModule, { cell: legacyGardenModule, x: 400, y: 20, width: 300, height: 220 }); // NEW
    stateMap.set(regularModule, { cell: regularModule, x: 10, y: 300, width: 300, height: 220 }); // NEW
    stateMap.set(teamModule, { cell: teamModule, x: 400, y: 300, width: 300, height: 220 }); // NEW
    stateMap.set(lane, { cell: lane, x: 30, y: 50, width: 120, height: 160 }); // NEW
    stateMap.set(card, { cell: card, x: 40, y: 70, width: 80, height: 40 }); // NEW
    stateMap.set(kanbanBoard, { cell: kanbanBoard, x: 760, y: 20, width: 160, height: 220 }); // CHANGE
    stateMap.set(kanbanLane, { cell: kanbanLane, x: 780, y: 50, width: 120, height: 160 }); // CHANGE
    stateMap.set(kanbanCard, { cell: kanbanCard, x: 790, y: 70, width: 80, height: 40 }); // CHANGE
    stateMap.set(bed, { cell: bed, x: 40, y: 130, width: 80, height: 40 }); // NEW
    stateMap.set(tilerGroup, { cell: tilerGroup, x: 150, y: 130, width: 80, height: 40 }); // NEW
    stateMap.set(regularChild, { cell: regularChild, x: 40, y: 360, width: 80, height: 40 }); // NEW
    stateMap.set(teamRole, { cell: teamRole, x: 430, y: 360, width: 80, height: 40 }); // NEW
    const graph = { // NEW
        model, // NEW
        container: document.getElementById("graph"), // NEW
        view: { getState(cell) { return stateMap.get(cell) || null; }, addListener() {} }, // CHANGE
        getModel() { return model; }, // NEW
        getCurrentRoot() { return root; }, // NEW
        getSelectionCells() { return selectedCells.slice(); }, // NEW
        setSelectionCell(cell) { selectedCells = cell ? [cell] : []; }, // NEW
        setSelectionCells(cells) { selectedCells = cells ? cells.slice() : []; }, // NEW
        selectCellsForEvent(cells) { selectedCells = cells ? cells.slice() : []; }, // NEW
        clearSelection() { selectedCells = []; }, // NEW
        isCellSelected(cell) { return selectedCells.includes(cell); }, // NEW
        removeSelectionCell(cell) { selectedCells = selectedCells.filter(selected => selected !== cell); }, // NEW
        addSelectionCell(cell) { if (!selectedCells.includes(cell)) selectedCells.push(cell); }, // NEW
        isCellVisible() { return true; }, // NEW
        isCellMovable(cell) { return movableCells.has(cell) ? movableCells.get(cell) : true; }, // CHANGE
        getCellAt() { return graph.__hitCell || null; }, // CHANGE
        getCells() { return graph.__regionCells || []; }, // NEW
        getCursorForMouseEvent() { return graph.__nativeCursor || null; }, // NEW
        isToggleEvent(evt) { return !!(evt && (evt.ctrlKey || evt.metaKey)); }, // NEW
        getSelectionModel() { return { addListener() {} }; }, // NEW
        addListener() {}, // NEW
        addMouseListener(listener) { graph.__mouseListener = listener; } // NEW
    }; // NEW
    graph.__stateMap = stateMap; // NEW
    const context = { // NEW
        window: dom.window, // NEW
        document, // NEW
        console: { debug() {}, log() {}, warn() {}, error() {} }, // NEW
        Draw: { loadPlugin(callback) { callback({ editor: { graph } }); } }, // NEW
        Editor: { moveImage: TEST_MOVE_IMAGE }, // NEW
        mxGraphHandler: function mxGraphHandler() {}, // NEW
        mxEvent: { // NEW
            isControlDown(evt) { return !!(evt && evt.ctrlKey); }, // NEW
            isMetaDown(evt) { return !!(evt && evt.metaKey); }, // NEW
            isShiftDown(evt) { return !!(evt && evt.shiftKey); }, // NEW
            isAltDown(evt) { return !!(evt && evt.altKey); }, // NEW
            getClientX(evt) { return evt && evt.clientX || 0; }, // NEW
            getClientY(evt) { return evt && evt.clientY || 0; }, // CHANGE
            addListener(node, name, fn) { node.addEventListener(name, fn); }, // NEW
            addGestureListeners() {}, // NEW
            removeGestureListeners() {}, // NEW
            consume(evt) { if (evt && evt.preventDefault) evt.preventDefault(); } // NEW
        }, // NEW
        mxUtils: { // NEW
            convertPoint(_container, x, y) { return { x: x || 0, y: y || 0 }; }, // CHANGE
            contains(state, x, y) { return !!state && x >= state.x && y >= state.y && x <= state.x + state.width && y <= state.y + state.height; }, // CHANGE
            getValue(style, key, fallback) { return style && key in style ? style[key] : fallback; }, // NEW
            toRadians(degrees) { return degrees * Math.PI / 180; }, // NEW
            getRotatedPoint(point) { return point; } // NEW
        }, // NEW
        mxConstants: { STYLE_ROTATION: "rotation" }, // NEW
        mxPoint: function mxPoint(x, y) { this.x = x; this.y = y; } // NEW
    }; // NEW
    context.mxGraphHandler.prototype = { // NEW
        mouseDown() { graph.__oldGraphHandlerMouseDownCalled = true; }, // NEW
        isDelayedSelection() { return false; }, // NEW
        getCells(initialCell) { return [initialCell]; } // NEW
    }; // NEW
    vm.runInNewContext(fs.readFileSync(PLUGIN_PATH, "utf8"), context, { filename: PLUGIN_PATH }); // NEW
    return { graph, window: dom.window, Handler: context.mxGraphHandler, gardenModule, legacyGardenModule, regularModule, teamModule, regularChild, teamRole, bed, tilerGroup, lane, card, kanbanBoard, kanbanLane, kanbanCard, movableCells, getSelected: () => selectedCells.slice() }; // CHANGE
} // NEW

function plainClick(graph, cell, detail = 1) { // NEW
    graph.__hitCell = cell; // NEW
    graph.selectCellForEvent(cell, { detail, clientX: 0, clientY: 0 }); // NEW
} // NEW

function ctrlClick(graph, cell) { // NEW
    graph.__hitCell = cell; // NEW
    graph.selectCellForEvent(cell, { detail: 1, ctrlKey: true, clientX: 0, clientY: 0 }); // NEW
} // NEW

function makeMouseEvent(cell, x = 0, y = 0, sourceState = null) { // CHANGE
    return { // NEW
        sourceState, // NEW
        getCell() { return cell; }, // NEW
        getState() { return cell ? { cell } : null; }, // NEW
        getX() { return x; }, // NEW
        getY() { return y; }, // NEW
        getEvent() { return { button: 0, clientX: x, clientY: y }; }, // NEW
        isConsumed() { return false; }, // NEW
        isSource() { return false; } // NEW
    }; // NEW
} // NEW

function ids(cells) { // NEW
    return Array.from(cells || [], cell => cell && cell.id); // CHANGE
} // NEW

function makeCursorState(cell) { // NEW
    return { cell, cursor: null, setCursor(cursor) { this.cursor = cursor; } }; // NEW
} // NEW

function applyNativeGraphHandlerCursor(graph, me) { // NEW
    let cursor = graph.getCursorForMouseEvent(me); // NEW
    if (cursor == null && graph.isCellMovable(me.getCell())) cursor = "move"; // NEW
    if (cursor != null && me.sourceState) me.sourceState.setCursor(cursor); // NEW
    return cursor; // NEW
} // NEW

test("plain second-click on sole-selected garden module keeps selection", () => { // CHANGE
    const { graph, gardenModule, getSelected } = makeHarness(); // NEW
    graph.setSelectionCell(gardenModule); // NEW
    plainClick(graph, gardenModule); // NEW
    assert.deepEqual(getSelected(), [gardenModule]); // CHANGE
}); // NEW

test("plain second-click on selected garden module closes graph-local irrigation mode without clearing selection", () => { // CHANGE
    const { graph, gardenModule, getSelected } = makeHarness(); // NEW
    const closeCalls = []; // NEW
    graph.__trellisIrrigationPlanner = { closeIrrigationMode() { closeCalls.push("graph"); } }; // NEW
    graph.setSelectionCell(gardenModule); // NEW
    plainClick(graph, gardenModule); // NEW
    assert.deepEqual(closeCalls, ["graph"]); // NEW
    assert.deepEqual(getSelected(), [gardenModule]); // CHANGE
}); // NEW

test("graph-local irrigation close is preferred over window fallback", () => { // NEW
    const { graph, window, gardenModule } = makeHarness(); // NEW
    const closeCalls = []; // NEW
    graph.__trellisIrrigationPlanner = { closeIrrigationMode() { closeCalls.push("graph"); } }; // NEW
    window.TrellisIrrigationPlanner = { closeIrrigationMode() { closeCalls.push("window"); } }; // NEW
    graph.setSelectionCell(gardenModule); // NEW
    plainClick(graph, gardenModule); // NEW
    assert.deepEqual(closeCalls, ["graph"]); // NEW
}); // NEW

test("window irrigation close is used when graph-local API is unavailable", () => { // NEW
    const { graph, window, gardenModule, getSelected } = makeHarness(); // NEW
    const closeCalls = []; // NEW
    window.TrellisIrrigationPlanner = { closeIrrigationMode() { closeCalls.push("window"); } }; // NEW
    graph.setSelectionCell(gardenModule); // NEW
    plainClick(graph, gardenModule); // NEW
    assert.deepEqual(closeCalls, ["window"]); // NEW
    assert.deepEqual(getSelected(), [gardenModule]); // CHANGE
}); // NEW

test("plain second-click also recognizes legacy garden module attribute", () => { // NEW
    const { graph, legacyGardenModule, getSelected } = makeHarness(); // NEW
    graph.setSelectionCell(legacyGardenModule); // NEW
    plainClick(graph, legacyGardenModule); // NEW
    assert.deepEqual(getSelected(), [legacyGardenModule]); // CHANGE
}); // NEW

test("plain second-click on regular and team modules stays selected", () => { // CHANGE
    const { graph, regularModule, teamModule, getSelected } = makeHarness(); // CHANGE
    const closeCalls = []; // NEW
    graph.__trellisIrrigationPlanner = { closeIrrigationMode() { closeCalls.push("graph"); } }; // NEW
    graph.setSelectionCell(regularModule); // NEW
    plainClick(graph, regularModule); // NEW
    assert.deepEqual(getSelected(), [regularModule]); // NEW
    graph.setSelectionCell(teamModule); // NEW
    plainClick(graph, teamModule); // NEW
    assert.deepEqual(getSelected(), [teamModule]); // NEW
    assert.deepEqual(closeCalls, []); // NEW
}); // NEW

test("plain second-click on garden objects other than modules stays selected", () => { // NEW
    const { graph, bed, tilerGroup, getSelected } = makeHarness(); // NEW
    const closeCalls = []; // NEW
    graph.__trellisIrrigationPlanner = { closeIrrigationMode() { closeCalls.push("graph"); } }; // NEW
    graph.setSelectionCell(bed); // NEW
    plainClick(graph, bed); // NEW
    assert.deepEqual(getSelected(), [bed]); // NEW
    graph.setSelectionCell(tilerGroup); // NEW
    plainClick(graph, tilerGroup); // NEW
    assert.deepEqual(getSelected(), [tilerGroup]); // NEW
    assert.deepEqual(closeCalls, []); // NEW
}); // NEW

test("selected tiler drag over a garden bed keeps the tiler as initial drag cell", () => { // NEW
    const { graph, Handler, bed, tilerGroup } = makeHarness(); // NEW
    graph.__stateMap.set(tilerGroup, { cell: tilerGroup, x: 40, y: 130, width: 80, height: 40 }); // NEW
    graph.setSelectionCell(tilerGroup); // NEW
    graph.__hitCell = tilerGroup; // NEW
    const handler = new Handler(); // NEW
    handler.graph = graph; // NEW

    assert.equal(handler.getInitialCellForEvent(makeMouseEvent(bed, 50, 140)), tilerGroup); // NEW
}); // NEW

test("plain click through selected tiler over a garden bed still selects the bed", () => { // NEW
    const { graph, bed, tilerGroup, getSelected } = makeHarness(); // NEW
    graph.__stateMap.set(tilerGroup, { cell: tilerGroup, x: 40, y: 130, width: 80, height: 40 }); // NEW
    graph.setSelectionCell(tilerGroup); // NEW
    graph.__hitCell = tilerGroup; // NEW

    graph.selectCellForEvent(tilerGroup, { detail: 1, clientX: 50, clientY: 140, button: 0 }); // NEW

    assert.deepEqual(getSelected(), [bed]); // NEW
}); // NEW

test("ctrl-click selection toggle remains unchanged", () => { // NEW
    const { graph, gardenModule, getSelected } = makeHarness(); // NEW
    const closeCalls = []; // NEW
    graph.__trellisIrrigationPlanner = { closeIrrigationMode() { closeCalls.push("graph"); } }; // NEW
    graph.setSelectionCell(gardenModule); // NEW
    ctrlClick(graph, gardenModule); // NEW
    assert.deepEqual(getSelected(), []); // NEW
    assert.deepEqual(closeCalls, []); // NEW
}); // NEW

test("double-click on selected garden module does not clear selection", () => { // NEW
    const { graph, gardenModule, getSelected } = makeHarness(); // NEW
    const closeCalls = []; // NEW
    graph.__trellisIrrigationPlanner = { closeIrrigationMode() { closeCalls.push("graph"); } }; // NEW
    graph.setSelectionCell(gardenModule); // NEW
    plainClick(graph, gardenModule, 2); // NEW
    assert.deepEqual(getSelected(), [gardenModule]); // NEW
    assert.deepEqual(closeCalls, []); // NEW
}); // NEW

test("workspace classifier recognizes all Trellis modules and lane_key lanes", () => { // CHANGE
    const { graph, gardenModule, legacyGardenModule, lane, kanbanLane, regularModule, teamModule, bed } = makeHarness(); // CHANGE
    const api = graph.__trellisWorkspaceDragPolicy; // NEW
    assert.equal(api.isWorkspaceContainer(gardenModule), true); // NEW
    assert.equal(api.getWorkspaceContainerType(gardenModule), "module"); // NEW
    assert.equal(api.isWorkspaceContainer(legacyGardenModule), true); // NEW
    assert.equal(api.getWorkspaceContainerType(legacyGardenModule), "module"); // NEW
    assert.equal(api.isWorkspaceContainer(regularModule), true); // CHANGE
    assert.equal(api.getWorkspaceContainerType(regularModule), "module"); // NEW
    assert.equal(api.isWorkspaceContainer(teamModule), true); // NEW
    assert.equal(api.getWorkspaceContainerType(teamModule), "module"); // NEW
    assert.equal(api.getWorkspaceContainerType(lane), "lane"); // NEW
    assert.equal(api.isWorkspaceContainer(kanbanLane), true); // NEW
    assert.equal(api.getWorkspaceContainerType(kanbanLane), "lane"); // NEW
    assert.equal(api.isWorkspaceContainer(bed), false); // NEW
}); // NEW

test("workspace descendant marquee filters out container and unrelated cells", () => { // NEW
    const { graph, gardenModule, regularModule, bed, tilerGroup, lane, card, getSelected } = makeHarness(); // NEW
    graph.__regionCells = [gardenModule, bed, tilerGroup, lane, card, regularModule]; // NEW
    graph.__trellisWorkspaceMarqueeContainer = gardenModule; // NEW
    const selected = graph.selectRegion({ x: 0, y: 0, width: 500, height: 500 }, { button: 0 }); // NEW
    assert.deepEqual(ids(selected), ["bed", "tiler", "lane", "card"]); // NEW
    assert.deepEqual(ids(getSelected()), ["bed", "tiler", "lane", "card"]); // NEW
}); // NEW

test("lane scoped marquee keeps only lane descendants", () => { // NEW
    const { graph, gardenModule, bed, lane, card, getSelected } = makeHarness(); // NEW
    graph.__regionCells = [gardenModule, bed, lane, card]; // NEW
    graph.__trellisWorkspaceMarqueeContainer = lane; // NEW
    const selected = graph.selectRegion({ x: 0, y: 0, width: 500, height: 500 }, { button: 0 }); // NEW
    assert.deepEqual(ids(selected), ["card"]); // NEW
    assert.deepEqual(ids(getSelected()), ["card"]); // NEW
}); // NEW

test("workspace handles include selected containers and hovered container", () => { // NEW
    const { graph, gardenModule, legacyGardenModule, lane, regularModule, teamModule } = makeHarness(); // CHANGE
    const api = graph.__trellisWorkspaceDragPolicy; // NEW
    graph.setSelectionCells([gardenModule, regularModule, teamModule]); // CHANGE
    api.setHoveredCellForTests(lane); // NEW
    assert.deepEqual(ids(api.getHandleCells()), ["garden", "regular", "team", "lane"]); // CHANGE
    graph.setSelectionCells([gardenModule, legacyGardenModule]); // NEW
    api.setHoveredCellForTests(null); // NEW
    assert.deepEqual(ids(api.getHandleCells()), ["garden", "legacyGarden"]); // NEW
}); // NEW

test("workspace handles omit canonical kanban board lanes", () => { // NEW
    const { graph, kanbanLane } = makeHarness(); // NEW
    const api = graph.__trellisWorkspaceDragPolicy; // NEW
    graph.setSelectionCell(kanbanLane); // NEW
    api.setHoveredCellForTests(kanbanLane); // NEW
    assert.deepEqual(ids(api.getHandleCells()), []); // NEW
    api.refreshHandles(); // NEW
    assert.equal(graph.container.querySelector("[data-trellis-workspace-drag-handle='1']"), null); // NEW
}); // NEW

test("workspace handles remain available for non-board lane_key lanes", () => { // NEW
    const { graph, lane } = makeHarness(); // NEW
    const api = graph.__trellisWorkspaceDragPolicy; // NEW
    graph.setSelectionCell(lane); // NEW
    assert.deepEqual(ids(api.getHandleCells()), ["lane"]); // NEW
    api.refreshHandles(); // NEW
    assert.ok(graph.container.querySelector("[data-trellis-workspace-drag-handle='1']"), "expected non-board lane handle"); // NEW
}); // NEW

test("workspace handles hide non-movable containers", () => { // NEW
    const { graph, gardenModule, lane, movableCells } = makeHarness(); // NEW
    const api = graph.__trellisWorkspaceDragPolicy; // NEW
    movableCells.set(gardenModule, false); // NEW
    graph.setSelectionCells([gardenModule, lane]); // NEW
    assert.deepEqual(ids(api.getHandleCells()), ["lane"]); // NEW
}); // NEW

test("workspace container body hover uses default cursor and restores over children", () => { // NEW
    const { graph, gardenModule, card } = makeHarness(); // NEW
    const api = graph.__trellisWorkspaceDragPolicy; // NEW
    graph.container.style.cursor = "move"; // NEW
    graph.__hitCell = gardenModule; // NEW
    api.updateHoverForTests(makeMouseEvent(gardenModule, 250, 90)); // NEW
    assert.equal(graph.container.style.cursor, "default"); // NEW
    assert.equal(graph.getCursorForMouseEvent(makeMouseEvent(gardenModule, 250, 90)), "default"); // NEW
    graph.__hitCell = card; // NEW
    graph.__nativeCursor = "native"; // NEW
    api.updateHoverForTests(makeMouseEvent(gardenModule, 50, 90)); // NEW
    assert.equal(graph.container.style.cursor, "move"); // NEW
    assert.equal(graph.getCursorForMouseEvent(makeMouseEvent(gardenModule, 50, 90)), "native"); // NEW
}); // NEW

test("workspace body hover stamps default cursor before native move fallback", () => { // NEW
    const { graph, gardenModule } = makeHarness(); // NEW
    const sourceState = makeCursorState(gardenModule); // NEW
    graph.__hitCell = gardenModule; // NEW
    const cursor = applyNativeGraphHandlerCursor(graph, makeMouseEvent(gardenModule, 250, 90, sourceState)); // NEW
    assert.equal(cursor, "default"); // NEW
    assert.equal(sourceState.cursor, "default"); // NEW
}); // NEW

test("workspace container body cursor restores on graph mouseleave", () => { // NEW
    const { graph, window, gardenModule } = makeHarness(); // NEW
    const api = graph.__trellisWorkspaceDragPolicy; // NEW
    graph.container.style.cursor = "move"; // NEW
    graph.__hitCell = gardenModule; // NEW
    api.updateHoverForTests(makeMouseEvent(gardenModule, 250, 90)); // NEW
    assert.equal(graph.container.style.cursor, "default"); // NEW
    graph.container.dispatchEvent(new window.MouseEvent("mouseleave", { bubbles: true })); // NEW
    assert.equal(graph.container.style.cursor, "move"); // NEW
}); // NEW

test("workspace container header hover keeps native cursor", () => { // NEW
    const { graph, gardenModule } = makeHarness(); // NEW
    const api = graph.__trellisWorkspaceDragPolicy; // NEW
    graph.container.style.cursor = "move"; // NEW
    graph.__hitCell = gardenModule; // NEW
    api.updateHoverForTests(makeMouseEvent(gardenModule, 50, 30)); // NEW
    assert.equal(graph.container.style.cursor, "move"); // NEW
    assert.equal(api.shouldUseSelectCursorForTests(makeMouseEvent(gardenModule, 50, 30)), false); // NEW
    assert.equal(graph.getCursorForMouseEvent(makeMouseEvent(gardenModule, 50, 30)), null); // NEW
    const sourceState = makeCursorState(gardenModule); // NEW
    assert.equal(applyNativeGraphHandlerCursor(graph, makeMouseEvent(gardenModule, 50, 30, sourceState)), "move"); // NEW
    assert.equal(sourceState.cursor, "move"); // NEW
}); // NEW

test("workspace drag handle renders Draw.io move image and keeps move cursor", () => { // NEW
    const { graph, gardenModule } = makeHarness(); // NEW
    const api = graph.__trellisWorkspaceDragPolicy; // NEW
    graph.setSelectionCell(gardenModule); // NEW
    api.refreshHandles(); // NEW
    const handle = graph.container.querySelector("[data-trellis-workspace-drag-handle='1']"); // NEW
    assert.ok(handle, "expected workspace handle"); // NEW
    assert.equal(handle.style.cursor, "move"); // NEW
    const img = handle.querySelector("img"); // NEW
    assert.ok(img, "expected Draw.io move image"); // NEW
    assert.equal(img.getAttribute("src"), TEST_MOVE_IMAGE); // NEW
}); // NEW

test("surface drag on workspace modules is marked for scoped marquee", () => { // CHANGE
    const { graph, Handler, gardenModule, regularModule, teamModule } = makeHarness(); // CHANGE
    const handler = new Handler(); // NEW
    handler.graph = graph; // NEW
    graph.__hitCell = gardenModule; // NEW
    handler.mouseDown(graph, makeMouseEvent(gardenModule, 250, 90)); // CHANGE
    assert.equal(graph.__trellisWorkspaceDragContext.cell, gardenModule); // NEW
    assert.equal(graph.__trellisWorkspaceDragContext.type, "module"); // NEW
    assert.equal(graph.__oldGraphHandlerMouseDownCalled, undefined); // NEW
    graph.__trellisWorkspaceDragContext = null; // NEW
    graph.__hitCell = regularModule; // NEW
    handler.mouseDown(graph, makeMouseEvent(regularModule, 250, 390)); // NEW
    assert.equal(graph.__trellisWorkspaceDragContext.cell, regularModule); // NEW
    assert.equal(graph.__trellisWorkspaceDragContext.type, "module"); // NEW
    graph.__trellisWorkspaceDragContext = null; // NEW
    graph.__hitCell = teamModule; // NEW
    handler.mouseDown(graph, makeMouseEvent(teamModule, 640, 390)); // NEW
    assert.equal(graph.__trellisWorkspaceDragContext.cell, teamModule); // NEW
    assert.equal(graph.__trellisWorkspaceDragContext.type, "module"); // NEW
}); // NEW

test("workspace module header drag stays on native graph handler path", () => { // CHANGE
    const { graph, Handler, gardenModule, regularModule, teamModule } = makeHarness(); // CHANGE
    const handler = new Handler(); // NEW
    handler.graph = graph; // NEW
    graph.__hitCell = gardenModule; // NEW
    handler.mouseDown(graph, makeMouseEvent(gardenModule, 50, 30)); // NEW
    assert.equal(graph.__trellisWorkspaceDragContext, undefined); // NEW
    assert.equal(graph.__oldGraphHandlerMouseDownCalled, true); // NEW
    graph.__oldGraphHandlerMouseDownCalled = false; // NEW
    graph.__hitCell = regularModule; // NEW
    handler.mouseDown(graph, makeMouseEvent(regularModule, 50, 310)); // NEW
    assert.equal(graph.__trellisWorkspaceDragContext, undefined); // NEW
    assert.equal(graph.__oldGraphHandlerMouseDownCalled, true); // NEW
    graph.__oldGraphHandlerMouseDownCalled = false; // NEW
    graph.__hitCell = teamModule; // NEW
    handler.mouseDown(graph, makeMouseEvent(teamModule, 440, 310)); // NEW
    assert.equal(graph.__trellisWorkspaceDragContext, undefined); // NEW
    assert.equal(graph.__oldGraphHandlerMouseDownCalled, true); // NEW
}); // NEW

test("workspace first-use callout anchors to cursor point", () => { // NEW
    const { graph, gardenModule } = makeHarness(); // NEW
    const anchor = graph.__trellisWorkspaceDragPolicy.getCalloutAnchorPointForTests(gardenModule, makeMouseEvent(gardenModule, 123, 145)); // NEW
    assert.deepEqual(anchor, { x: 123, y: 145 }); // NEW
}); // NEW

test("workspace move callout is suppressed for canonical kanban board lanes", () => { // NEW
    const { graph, lane, kanbanLane } = makeHarness(); // NEW
    const api = graph.__trellisWorkspaceDragPolicy; // NEW
    const rubberband = { first: { x: 0, y: 0 } }; // NEW
    assert.equal(api.shouldShowCalloutForTests({ cell: kanbanLane, type: "lane" }, rubberband, makeMouseEvent(kanbanLane, 20, 20)), false); // NEW
    assert.equal(api.shouldShowCalloutForTests({ cell: lane, type: "lane" }, rubberband, makeMouseEvent(lane, 20, 20)), true); // NEW
}); // NEW

test("nested workspace surface drag chooses deepest eligible container", () => { // NEW
    const { graph, Handler, gardenModule, lane } = makeHarness(); // NEW
    const handler = new Handler(); // NEW
    handler.graph = graph; // NEW
    graph.__hitCell = lane; // NEW
    handler.mouseDown(graph, makeMouseEvent(gardenModule)); // NEW
    assert.equal(graph.__trellisWorkspaceDragContext.cell, lane); // NEW
    assert.equal(graph.__trellisWorkspaceDragContext.type, "lane"); // NEW
}); // NEW

test("lane hover grace keeps lane handle when parent module is hit", () => { // NEW
    const { graph, gardenModule, lane } = makeHarness(); // NEW
    const api = graph.__trellisWorkspaceDragPolicy; // NEW
    api.setHoveredCellForTests(lane); // NEW
    graph.__hitCell = gardenModule; // NEW
    api.updateHoverForTests(makeMouseEvent(gardenModule, 20, 90)); // NEW
    assert.deepEqual(ids(api.getHandleCells()), ["lane"]); // NEW
}); // NEW

test("child drags inside workspace modules stay on native graph handler path", () => { // CHANGE
    const { graph, Handler, gardenModule, bed, regularChild, teamRole } = makeHarness(); // CHANGE
    const handler = new Handler(); // NEW
    handler.graph = graph; // NEW
    graph.__hitCell = bed; // NEW
    handler.mouseDown(graph, makeMouseEvent(gardenModule)); // NEW
    assert.equal(graph.__trellisWorkspaceDragContext, undefined); // NEW
    assert.equal(graph.__oldGraphHandlerMouseDownCalled, true); // NEW
    graph.__oldGraphHandlerMouseDownCalled = false; // NEW
    graph.__hitCell = regularChild; // CHANGE
    handler.mouseDown(graph, makeMouseEvent(regularChild, 50, 370)); // CHANGE
    assert.equal(graph.__trellisWorkspaceDragContext, undefined); // NEW
    assert.equal(graph.__oldGraphHandlerMouseDownCalled, true); // NEW
    graph.__oldGraphHandlerMouseDownCalled = false; // NEW
    graph.__hitCell = teamRole; // NEW
    handler.mouseDown(graph, makeMouseEvent(teamRole, 440, 370)); // NEW
    assert.equal(graph.__trellisWorkspaceDragContext, undefined); // NEW
    assert.equal(graph.__oldGraphHandlerMouseDownCalled, true); // NEW
}); // NEW

test("deep click-through returns children inside regular and team modules", () => { // NEW
    const { graph, regularModule, regularChild, teamModule, teamRole } = makeHarness(); // NEW
    graph.__hitCell = regularModule; // NEW
    assert.equal(graph.getCellAt(50, 370), regularChild); // NEW
    graph.__hitCell = teamModule; // NEW
    assert.equal(graph.getCellAt(440, 370), teamRole); // NEW
}); // NEW
