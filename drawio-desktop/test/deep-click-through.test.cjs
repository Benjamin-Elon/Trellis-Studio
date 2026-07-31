const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { JSDOM } = require("jsdom");

const PLUGIN_PATH = path.join(
    __dirname,
    "..",
    "drawio",
    "src",
    "main",
    "webapp",
    "plugins",
    "garden_planner_plugins",
    "Deep_Click_Through.js"
);
const TEST_MOVE_IMAGE = "data:image/svg+xml;base64,PHN2Zy8+";

class TestCell {
    constructor(id, attrs = {}, style = "") {
        this.id = id;
        this.attrs = { ...attrs };
        this.style = style;
        this.children = [];
    }

    getAttribute(key) { return this.attrs[key] || null; }
}

class TestModel {
    constructor(root) { this.root = root; }
    getRoot() { return this.root; }
    getParent(cell) { return cell && cell.parent ? cell.parent : null; }
    getChildCount(cell) { return cell && cell.children ? cell.children.length : 0; }
    getChildAt(cell, index) { return cell.children[index]; }
    getChildCells(cell) { return cell && cell.children ? cell.children.slice() : []; }
    isVertex(cell) { return !!cell && cell !== this.root; }
}

function appendChild(parent, child) {
    child.parent = parent;
    parent.children.push(child);
    return child;
}

function makeHarness(options = {}) {
    const dom = new JSDOM("<!doctype html><body><div id='graph'></div></body>");
    const document = dom.window.document;
    const root = new TestCell("root");
    const gardenModule = appendChild(root, new TestCell("garden", { garden_module: "1" }, "swimlane;module=1"));
    const legacyGardenModule = appendChild(root, new TestCell("legacyGarden", { trellis_garden_module: "1" }, "swimlane;module=1"));
    const regularModule = appendChild(root, new TestCell("regular", {}, "swimlane;module=1"));
    const teamModule = appendChild(root, new TestCell("team", { team_module: "1" }, "swimlane;module=1"));
    const bed = appendChild(gardenModule, new TestCell("bed", { garden_bed: "1" }));
    const emptyBed = appendChild(gardenModule, new TestCell("emptyBed", { garden_bed: "1" }));
    const bedAssembly = options.bedAssembly ? appendChild(gardenModule, new TestCell("bedAssembly", { irrigation_assembly: "1", irrigation_assembly_type: "bed" })) : null;
    const tilerGroup = appendChild(gardenModule, new TestCell("tiler", { tiler_group: "1" }));
    const occupiedTiler = appendChild(gardenModule, new TestCell("occupiedTiler", { tiler_group: "1" }));
    const lane = appendChild(gardenModule, new TestCell("lane", { lane_key: "TODO" }, "swimlane;"));
    const card = appendChild(lane, new TestCell("card", { kanban_card: "1" }));
    const siblingLane = appendChild(gardenModule, new TestCell("siblingLane", { lane_key: "DOING" }, "swimlane;"));
    const siblingCard = appendChild(siblingLane, new TestCell("siblingCard", { kanban_card: "1" }));
    const kanbanBoard = appendChild(root, new TestCell("kanbanBoard", { board_key: "KANBAN_BOARD" }, "swimlane;"));
    const kanbanLane = appendChild(kanbanBoard, new TestCell("kanbanLane", { lane_key: "TODO" }, "swimlane;"));
    const kanbanCard = appendChild(kanbanLane, new TestCell("kanbanCard", { kanban_card: "1" }));
    const regularChild = appendChild(regularModule, new TestCell("regularChild", {}));
    const teamRole = appendChild(teamModule, new TestCell("teamRole", {}, "shape=swimlane;role_card=1"));
    const plainTop = appendChild(root, new TestCell("plainTop", {}));
    const model = new TestModel(root);
    let selectedCells = [];
    const movableCells = new Map();
    const stateMap = new Map();
    stateMap.set(gardenModule, { cell: gardenModule, x: 10, y: 20, width: 300, height: 220 });
    stateMap.set(legacyGardenModule, { cell: legacyGardenModule, x: 400, y: 20, width: 300, height: 220 });
    stateMap.set(regularModule, { cell: regularModule, x: 10, y: 300, width: 300, height: 220 });
    stateMap.set(teamModule, { cell: teamModule, x: 400, y: 300, width: 300, height: 220 });
    stateMap.set(lane, { cell: lane, x: 30, y: 50, width: 120, height: 160 });
    stateMap.set(card, { cell: card, x: 40, y: 70, width: 80, height: 40 });
    stateMap.set(kanbanBoard, { cell: kanbanBoard, x: 760, y: 20, width: 160, height: 220 });
    stateMap.set(kanbanLane, { cell: kanbanLane, x: 780, y: 50, width: 120, height: 160 });
    stateMap.set(kanbanCard, { cell: kanbanCard, x: 790, y: 70, width: 80, height: 40 });
    stateMap.set(bed, { cell: bed, x: 40, y: 130, width: 80, height: 40 });
    stateMap.set(emptyBed, { cell: emptyBed, x: 230, y: 130, width: 80, height: 40 });
    if (bedAssembly) stateMap.set(bedAssembly, { cell: bedAssembly, x: 88, y: 138, width: 24, height: 20 });
    stateMap.set(tilerGroup, { cell: tilerGroup, x: 150, y: 130, width: 80, height: 40 });
    stateMap.set(occupiedTiler, { cell: occupiedTiler, x: 60, y: 140, width: 20, height: 20 });
    stateMap.set(siblingLane, { cell: siblingLane, x: 170, y: 175, width: 120, height: 55 });
    stateMap.set(siblingCard, { cell: siblingCard, x: 180, y: 188, width: 80, height: 28 });
    stateMap.set(regularChild, { cell: regularChild, x: 40, y: 360, width: 80, height: 40 });
    stateMap.set(teamRole, { cell: teamRole, x: 430, y: 360, width: 80, height: 40 });
    stateMap.set(plainTop, { cell: plainTop, x: 720, y: 360, width: 80, height: 40 });
    const graph = {
        model,
        container: document.getElementById("graph"),
        view: { getState(cell) { return stateMap.get(cell) || null; }, addListener() {} },
        getModel() { return model; },
        getCurrentRoot() { return root; },
        getSelectionCells() { return selectedCells.slice(); },
        setSelectionCell(cell) { selectedCells = cell ? [cell] : []; },
        setSelectionCells(cells) { selectedCells = cells ? cells.slice() : []; },
        selectCellsForEvent(cells) { selectedCells = cells ? cells.slice() : []; },
        clearSelection() { selectedCells = []; },
        isCellSelected(cell) { return selectedCells.includes(cell); },
        removeSelectionCell(cell) { selectedCells = selectedCells.filter(selected => selected !== cell); },
        addSelectionCell(cell) { if (!selectedCells.includes(cell)) selectedCells.push(cell); },
        isCellVisible() { return true; },
        isCellMovable(cell) { return movableCells.has(cell) ? movableCells.get(cell) : true; },
        getCellAt() { return graph.__hitCell || null; },
        getCells() { return graph.__regionCells || []; },
        getCursorForMouseEvent() { return graph.__nativeCursor || null; },
        isToggleEvent(evt) { return !!(evt && (evt.ctrlKey || evt.metaKey)); },
        getSelectionModel() { return { addListener() {} }; },
        addListener() {},
        addMouseListener(listener) { graph.__mouseListener = listener; }
    };
    graph.__stateMap = stateMap;
    graph.__trellisBedSuccessionNavigator = {
        resolveOccupiedBedMoveUnit(cell) {
            const beds = [bed, emptyBed];
            const groups = [tilerGroup, occupiedTiler];
            const assemblies = [bedAssembly].filter(Boolean);
            if (!isHarnessBed(cell) && !isHarnessTilerGroup(cell) && !isHarnessBedAssembly(cell)) return null;
            const anchor = isHarnessBed(cell) ? cell : containingHarnessBedForCell(cell, beds, stateMap);
            if (!anchor) return null;
            const contained = groups.filter(group => containingHarnessBedForCell(group, beds, stateMap) === anchor);
            const containedAssemblies = assemblies.filter(assembly => containingHarnessBedForCell(assembly, beds, stateMap) === anchor);
            return contained.length || containedAssemblies.length ? { bed: anchor, bedAssemblies: containedAssemblies, plantingGroups: contained, cells: [anchor].concat(containedAssemblies, contained) } : null;
        }
    };
    const context = {
        window: dom.window,
        document,
        console: { debug() {}, log() {}, warn() {}, error() {} },
        Draw: { loadPlugin(callback) { callback({ editor: { graph } }); } },
        Editor: { moveImage: TEST_MOVE_IMAGE },
        mxGraphHandler: function mxGraphHandler() {},
        mxEvent: {
            isControlDown(evt) { return !!(evt && evt.ctrlKey); },
            isMetaDown(evt) { return !!(evt && evt.metaKey); },
            isShiftDown(evt) { return !!(evt && evt.shiftKey); },
            isAltDown(evt) { return !!(evt && evt.altKey); },
            getClientX(evt) { return evt && evt.clientX || 0; },
            getClientY(evt) { return evt && evt.clientY || 0; },
            addListener(node, name, fn) { node.addEventListener(name, fn); },
            addGestureListeners() {},
            removeGestureListeners() {},
            consume(evt) { if (evt && evt.preventDefault) evt.preventDefault(); }
        },
        mxUtils: {
            convertPoint(_container, x, y) { return { x: x || 0, y: y || 0 }; },
            contains(state, x, y) { return !!state && x >= state.x && y >= state.y && x <= state.x + state.width && y <= state.y + state.height; },
            getValue(style, key, fallback) { return style && key in style ? style[key] : fallback; },
            toRadians(degrees) { return degrees * Math.PI / 180; },
            getRotatedPoint(point) { return point; }
        },
        mxConstants: { STYLE_ROTATION: "rotation" },
        mxPoint: function mxPoint(x, y) { this.x = x; this.y = y; }
    };
    context.mxGraphHandler.prototype = {
        mouseDown() { graph.__oldGraphHandlerMouseDownCalled = true; },
        mouseMove() { graph.__lastDragCells = this.getCells(this.cell); },
        mouseUp() { graph.__lastDragCells = this.getCells(this.cell); },
        isDelayedSelection() { return false; },
        getCells(initialCell) { return [initialCell]; }
    };
    vm.runInNewContext(fs.readFileSync(PLUGIN_PATH, "utf8"), context, { filename: PLUGIN_PATH });
    const graphHandler = new context.mxGraphHandler();
    graphHandler.graph = graph;
    graph.graphHandler = graphHandler;
    return { graph, window: dom.window, Handler: context.mxGraphHandler, gardenModule, legacyGardenModule, regularModule, teamModule, regularChild, teamRole, plainTop, bed, emptyBed, bedAssembly, tilerGroup, occupiedTiler, lane, card, siblingLane, siblingCard, kanbanBoard, kanbanLane, kanbanCard, movableCells, getSelected: () => selectedCells.slice() };
}

function isHarnessBed(cell) {
    return !!cell && cell.getAttribute && cell.getAttribute("garden_bed") === "1";
}

function isHarnessTilerGroup(cell) {
    return !!cell && cell.getAttribute && cell.getAttribute("tiler_group") === "1";
}

function isHarnessBedAssembly(cell) {
    return !!cell && cell.getAttribute && cell.getAttribute("irrigation_assembly") === "1" && cell.getAttribute("irrigation_assembly_type") === "bed";
}

function harnessCenter(cell, stateMap) {
    const state = stateMap.get(cell);
    return state ? { x: state.x + state.width / 2, y: state.y + state.height / 2 } : null;
}

function harnessContains(bed, point, stateMap) {
    const state = stateMap.get(bed);
    return !!state && !!point && point.x >= state.x && point.x <= state.x + state.width && point.y >= state.y && point.y <= state.y + state.height;
}

function containingHarnessBedForCell(cell, beds, stateMap) {
    const center = harnessCenter(cell, stateMap);
    let chosen = null;
    let chosenArea = Infinity;
    for (const bed of beds) {
        const state = stateMap.get(bed);
        const area = state ? state.width * state.height : 0;
        if (area > 0 && area < chosenArea && harnessContains(bed, center, stateMap)) {
            chosen = bed;
            chosenArea = area;
        }
    }
    return chosen;
}

function plainClick(graph, cell, detail = 1) {
    graph.__hitCell = cell;
    graph.selectCellForEvent(cell, { detail, clientX: 0, clientY: 0 });
}

function ctrlClick(graph, cell) {
    graph.__hitCell = cell;
    graph.selectCellForEvent(cell, { detail: 1, ctrlKey: true, clientX: 0, clientY: 0 });
}

function makeMouseEvent(cell, x = 0, y = 0, sourceState = null) {
    return {
        sourceState,
        getCell() { return cell; },
        getState() { return cell ? { cell } : null; },
        getX() { return x; },
        getY() { return y; },
        getEvent() { return { button: 0, clientX: x, clientY: y }; },
        isConsumed() { return false; },
        isSource() { return false; }
    };
}

function ids(cells) {
    return Array.from(cells || [], cell => cell && cell.id);
}

function makeCursorState(cell) {
    return { cell, cursor: null, setCursor(cursor) { this.cursor = cursor; } };
}

function applyNativeGraphHandlerCursor(graph, me) {
    let cursor = graph.getCursorForMouseEvent(me);
    if (cursor == null && graph.isCellMovable(me.getCell())) cursor = "move";
    if (cursor != null && me.sourceState) me.sourceState.setCursor(cursor);
    return cursor;
}

test("plain second-click on sole-selected garden module keeps selection", () => {
    const { graph, gardenModule, getSelected } = makeHarness();
    graph.setSelectionCell(gardenModule);
    plainClick(graph, gardenModule);
    assert.deepEqual(getSelected(), [gardenModule]);
});

test("plain second-click on selected garden module closes graph-local irrigation mode without clearing selection", () => {
    const { graph, gardenModule, getSelected } = makeHarness();
    const closeCalls = [];
    graph.__trellisIrrigationPlanner = { closeIrrigationMode() { closeCalls.push("graph"); } };
    graph.setSelectionCell(gardenModule);
    plainClick(graph, gardenModule);
    assert.deepEqual(closeCalls, ["graph"]);
    assert.deepEqual(getSelected(), [gardenModule]);
});

test("graph-local irrigation close is preferred over window fallback", () => {
    const { graph, window, gardenModule } = makeHarness();
    const closeCalls = [];
    graph.__trellisIrrigationPlanner = { closeIrrigationMode() { closeCalls.push("graph"); } };
    window.TrellisIrrigationPlanner = { closeIrrigationMode() { closeCalls.push("window"); } };
    graph.setSelectionCell(gardenModule);
    plainClick(graph, gardenModule);
    assert.deepEqual(closeCalls, ["graph"]);
});

test("window irrigation close is used when graph-local API is unavailable", () => {
    const { graph, window, gardenModule, getSelected } = makeHarness();
    const closeCalls = [];
    window.TrellisIrrigationPlanner = { closeIrrigationMode() { closeCalls.push("window"); } };
    graph.setSelectionCell(gardenModule);
    plainClick(graph, gardenModule);
    assert.deepEqual(closeCalls, ["window"]);
    assert.deepEqual(getSelected(), [gardenModule]);
});

test("plain second-click also recognizes legacy garden module attribute", () => {
    const { graph, legacyGardenModule, getSelected } = makeHarness();
    graph.setSelectionCell(legacyGardenModule);
    plainClick(graph, legacyGardenModule);
    assert.deepEqual(getSelected(), [legacyGardenModule]);
});

test("plain second-click on regular and team modules stays selected", () => {
    const { graph, regularModule, teamModule, getSelected } = makeHarness();
    const closeCalls = [];
    graph.__trellisIrrigationPlanner = { closeIrrigationMode() { closeCalls.push("graph"); } };
    graph.setSelectionCell(regularModule);
    plainClick(graph, regularModule);
    assert.deepEqual(getSelected(), [regularModule]);
    graph.setSelectionCell(teamModule);
    plainClick(graph, teamModule);
    assert.deepEqual(getSelected(), [teamModule]);
    assert.deepEqual(closeCalls, []);
});

test("plain second-click on garden objects other than modules stays selected", () => {
    const { graph, bed, tilerGroup, getSelected } = makeHarness();
    const closeCalls = [];
    graph.__trellisIrrigationPlanner = { closeIrrigationMode() { closeCalls.push("graph"); } };
    graph.setSelectionCell(bed);
    plainClick(graph, bed);
    assert.deepEqual(getSelected(), [bed]);
    graph.setSelectionCell(tilerGroup);
    plainClick(graph, tilerGroup);
    assert.deepEqual(getSelected(), [tilerGroup]);
    assert.deepEqual(closeCalls, []);
});

test("selected tiler drag over a garden bed keeps the tiler as initial drag cell", () => {
    const { graph, Handler, bed, tilerGroup } = makeHarness();
    graph.__stateMap.set(tilerGroup, { cell: tilerGroup, x: 40, y: 130, width: 80, height: 40 });
    graph.setSelectionCell(tilerGroup);
    graph.__hitCell = tilerGroup;
    const handler = new Handler();
    handler.graph = graph;

    assert.equal(handler.getInitialCellForEvent(makeMouseEvent(bed, 50, 140)), tilerGroup);
});

test("plain click through selected tiler over a garden bed still selects the bed", () => {
    const { graph, bed, tilerGroup, getSelected } = makeHarness();
    graph.__stateMap.set(tilerGroup, { cell: tilerGroup, x: 40, y: 130, width: 80, height: 40 });
    graph.setSelectionCell(tilerGroup);
    graph.__hitCell = tilerGroup;

    graph.selectCellForEvent(tilerGroup, { detail: 1, clientX: 50, clientY: 140, button: 0 });

    assert.deepEqual(getSelected(), [bed]);
});

test("ctrl-click selection toggle remains unchanged", () => {
    const { graph, gardenModule, getSelected } = makeHarness();
    const closeCalls = [];
    graph.__trellisIrrigationPlanner = { closeIrrigationMode() { closeCalls.push("graph"); } };
    graph.setSelectionCell(gardenModule);
    ctrlClick(graph, gardenModule);
    assert.deepEqual(getSelected(), []);
    assert.deepEqual(closeCalls, []);
});

test("double-click on selected garden module does not clear selection", () => {
    const { graph, gardenModule, getSelected } = makeHarness();
    const closeCalls = [];
    graph.__trellisIrrigationPlanner = { closeIrrigationMode() { closeCalls.push("graph"); } };
    graph.setSelectionCell(gardenModule);
    plainClick(graph, gardenModule, 2);
    assert.deepEqual(getSelected(), [gardenModule]);
    assert.deepEqual(closeCalls, []);
});

test("workspace classifier recognizes all Trellis modules and lane_key lanes", () => {
    const { graph, gardenModule, legacyGardenModule, lane, kanbanLane, regularModule, teamModule, bed } = makeHarness();
    const api = graph.__trellisWorkspaceDragPolicy;
    assert.equal(api.isWorkspaceContainer(gardenModule), true);
    assert.equal(api.getWorkspaceContainerType(gardenModule), "module");
    assert.equal(api.isWorkspaceContainer(legacyGardenModule), true);
    assert.equal(api.getWorkspaceContainerType(legacyGardenModule), "module");
    assert.equal(api.isWorkspaceContainer(regularModule), true);
    assert.equal(api.getWorkspaceContainerType(regularModule), "module");
    assert.equal(api.isWorkspaceContainer(teamModule), true);
    assert.equal(api.getWorkspaceContainerType(teamModule), "module");
    assert.equal(api.getWorkspaceContainerType(lane), "lane");
    assert.equal(api.isWorkspaceContainer(kanbanLane), true);
    assert.equal(api.getWorkspaceContainerType(kanbanLane), "lane");
    assert.equal(api.isWorkspaceContainer(bed), false);
});

test("workspace marquee selects descendants across intersected containers", () => {
    const { graph, gardenModule, regularModule, teamModule, bed, tilerGroup, lane, card, regularChild, teamRole, plainTop, getSelected } = makeHarness();
    graph.__regionCells = [gardenModule, bed, tilerGroup, lane, card, regularModule, regularChild, teamModule, teamRole, plainTop];
    graph.__trellisWorkspaceMarqueeContainer = gardenModule;
    const selected = graph.selectRegion({ x: 0, y: 0, width: 500, height: 500 }, { button: 0 });
    assert.deepEqual(ids(selected), ["bed", "tiler", "card", "regularChild", "teamRole"]);
    assert.deepEqual(ids(getSelected()), ["bed", "tiler", "card", "regularChild", "teamRole"]);
});

test("lane-start marquee selects descendants in other intersected containers", () => {
    const { graph, bed, lane, card, siblingCard, regularChild, plainTop, getSelected } = makeHarness();
    graph.__regionCells = [bed, lane, card, siblingCard, regularChild, plainTop];
    graph.__trellisWorkspaceMarqueeContainer = lane;
    const selected = graph.selectRegion({ x: 0, y: 0, width: 500, height: 500 }, { button: 0 });
    assert.deepEqual(ids(selected), ["bed", "card", "siblingCard", "regularChild"]);
    assert.deepEqual(ids(getSelected()), ["bed", "card", "siblingCard", "regularChild"]);
});

test("lane-to-lane marquee does not require sibling lane surface in region cells", () => {
    const { graph, lane, card, siblingCard, plainTop, getSelected } = makeHarness();
    graph.__regionCells = [card, siblingCard, plainTop];
    graph.__trellisWorkspaceMarqueeContainer = lane;
    const selected = graph.selectRegion({ x: 0, y: 0, width: 500, height: 500 }, { button: 0 });
    assert.deepEqual(ids(selected), ["card", "siblingCard"]);
    assert.deepEqual(ids(getSelected()), ["card", "siblingCard"]);
});

test("workspace handles include selected containers and hovered container", () => {
    const { graph, gardenModule, legacyGardenModule, lane, regularModule, teamModule } = makeHarness();
    const api = graph.__trellisWorkspaceDragPolicy;
    graph.setSelectionCells([gardenModule, regularModule, teamModule]);
    api.setHoveredCellForTests(lane);
    assert.deepEqual(ids(api.getHandleCells()), ["garden", "regular", "team", "lane"]);
    graph.setSelectionCells([gardenModule, legacyGardenModule]);
    api.setHoveredCellForTests(null);
    assert.deepEqual(ids(api.getHandleCells()), ["garden", "legacyGarden"]);
});

test("occupied garden bed selection shows a bed move handle at the move-unit bounding box", () => {
    const { graph, bed, occupiedTiler } = makeHarness();
    const api = graph.__trellisWorkspaceDragPolicy;
    graph.__stateMap.set(occupiedTiler, { cell: occupiedTiler, x: 30, y: 120, width: 20, height: 20 });
    graph.setSelectionCell(bed);
    assert.deepEqual(ids(api.getHandleCells()), ["bed"]);
    api.refreshHandles();
    const handle = graph.container.querySelector("[data-trellis-workspace-drag-handle='1']");
    assert.ok(handle, "expected occupied bed handle");
    assert.equal(handle.title, "Move garden bed and planting groups");
    assert.equal(handle.style.left, "8px");
    assert.equal(handle.style.top, "98px");
});

test("planting group selection shows its containing occupied bed handle", () => {
    const { graph, occupiedTiler } = makeHarness();
    const api = graph.__trellisWorkspaceDragPolicy;
    graph.setSelectionCell(occupiedTiler);
    assert.deepEqual(ids(api.getHandleCells()), ["bed"]);
    assert.deepEqual(ids(api.getHandleDragCellsForTests(api.getHandleCells()[0])), ["bed", "occupiedTiler"]);
});

test("bed assembly selection shows occupied bed handle and drags the whole bed unit", () => {
    const { graph, bed, bedAssembly, occupiedTiler, getSelected } = makeHarness({ bedAssembly: true });
    const api = graph.__trellisWorkspaceDragPolicy;
    graph.setSelectionCell(bedAssembly);
    assert.deepEqual(ids(api.getHandleCells()), ["bed"]);
    api.refreshHandles();
    const handle = graph.container.querySelector("[data-trellis-workspace-drag-handle='1']");
    assert.ok(handle, "expected occupied bed handle for bed assembly selection");
    assert.equal(handle.title, "Move garden bed, irrigation assembly, and planting groups");
    assert.deepEqual(ids(api.getHandleDragCellsForTests(bed)), ["bed", "bedAssembly", "occupiedTiler"]);
    api.beginHandleDragForTests(bed, { button: 0, clientX: 40, clientY: 130, preventDefault() {} });
    assert.deepEqual(ids(getSelected()), ["bed", "bedAssembly", "occupiedTiler"]);
    assert.deepEqual(ids(graph.graphHandler.__trellisWorkspaceHandleDragCells), ["bed", "bedAssembly", "occupiedTiler"]);
});

test("empty beds and outside-bed planting groups do not show occupied bed handles", () => {
    const { graph, emptyBed, tilerGroup } = makeHarness();
    const api = graph.__trellisWorkspaceDragPolicy;
    graph.setSelectionCell(emptyBed);
    assert.deepEqual(ids(api.getHandleCells()), []);
    graph.setSelectionCell(tilerGroup);
    assert.deepEqual(ids(api.getHandleCells()), []);
});

test("occupied bed handle drag moves every contained planting group", () => {
    const { graph, bed, tilerGroup } = makeHarness();
    const api = graph.__trellisWorkspaceDragPolicy;
    graph.__stateMap.set(tilerGroup, { cell: tilerGroup, x: 80, y: 145, width: 10, height: 10 });
    assert.deepEqual(ids(api.getHandleDragCellsForTests(bed)), ["bed", "tiler", "occupiedTiler"]);
});

test("occupied bed handle drag selects the bed and contained planting groups", () => {
    const { graph, bed, occupiedTiler, getSelected } = makeHarness();
    const api = graph.__trellisWorkspaceDragPolicy;
    graph.setSelectionCell(occupiedTiler);
    api.beginHandleDragForTests(bed, { button: 0, clientX: 40, clientY: 130, preventDefault() {} });
    assert.deepEqual(ids(getSelected()), ["bed", "occupiedTiler"]);
    assert.deepEqual(ids(graph.graphHandler.__trellisWorkspaceHandleDragCells), ["bed", "occupiedTiler"]);
    assert.deepEqual(ids(graph.graphHandler.getCells(bed)), ["bed", "occupiedTiler"]);
});

test("workspace handles omit canonical kanban board lanes", () => {
    const { graph, kanbanLane } = makeHarness();
    const api = graph.__trellisWorkspaceDragPolicy;
    graph.setSelectionCell(kanbanLane);
    api.setHoveredCellForTests(kanbanLane);
    assert.deepEqual(ids(api.getHandleCells()), []);
    api.refreshHandles();
    assert.equal(graph.container.querySelector("[data-trellis-workspace-drag-handle='1']"), null);
});

test("workspace handles remain available for non-board lane_key lanes", () => {
    const { graph, lane } = makeHarness();
    const api = graph.__trellisWorkspaceDragPolicy;
    graph.setSelectionCell(lane);
    assert.deepEqual(ids(api.getHandleCells()), ["lane"]);
    api.refreshHandles();
    assert.ok(graph.container.querySelector("[data-trellis-workspace-drag-handle='1']"), "expected non-board lane handle");
});

test("workspace handles hide non-movable containers", () => {
    const { graph, gardenModule, lane, movableCells } = makeHarness();
    const api = graph.__trellisWorkspaceDragPolicy;
    movableCells.set(gardenModule, false);
    graph.setSelectionCells([gardenModule, lane]);
    assert.deepEqual(ids(api.getHandleCells()), ["lane"]);
});

test("workspace container body hover uses default cursor and restores over children", () => {
    const { graph, gardenModule, card } = makeHarness();
    const api = graph.__trellisWorkspaceDragPolicy;
    graph.container.style.cursor = "move";
    graph.__hitCell = gardenModule;
    api.updateHoverForTests(makeMouseEvent(gardenModule, 250, 90));
    assert.equal(graph.container.style.cursor, "default");
    assert.equal(graph.getCursorForMouseEvent(makeMouseEvent(gardenModule, 250, 90)), "default");
    graph.__hitCell = card;
    graph.__nativeCursor = "native";
    api.updateHoverForTests(makeMouseEvent(gardenModule, 50, 90));
    assert.equal(graph.container.style.cursor, "move");
    assert.equal(graph.getCursorForMouseEvent(makeMouseEvent(gardenModule, 50, 90)), "native");
});

test("workspace body hover stamps default cursor before native move fallback", () => {
    const { graph, gardenModule } = makeHarness();
    const sourceState = makeCursorState(gardenModule);
    graph.__hitCell = gardenModule;
    const cursor = applyNativeGraphHandlerCursor(graph, makeMouseEvent(gardenModule, 250, 90, sourceState));
    assert.equal(cursor, "default");
    assert.equal(sourceState.cursor, "default");
});

test("workspace container body cursor restores on graph mouseleave", () => {
    const { graph, window, gardenModule } = makeHarness();
    const api = graph.__trellisWorkspaceDragPolicy;
    graph.container.style.cursor = "move";
    graph.__hitCell = gardenModule;
    api.updateHoverForTests(makeMouseEvent(gardenModule, 250, 90));
    assert.equal(graph.container.style.cursor, "default");
    graph.container.dispatchEvent(new window.MouseEvent("mouseleave", { bubbles: true }));
    assert.equal(graph.container.style.cursor, "move");
});

test("workspace container header hover keeps native cursor", () => {
    const { graph, gardenModule } = makeHarness();
    const api = graph.__trellisWorkspaceDragPolicy;
    graph.container.style.cursor = "move";
    graph.__hitCell = gardenModule;
    api.updateHoverForTests(makeMouseEvent(gardenModule, 50, 30));
    assert.equal(graph.container.style.cursor, "move");
    assert.equal(api.shouldUseSelectCursorForTests(makeMouseEvent(gardenModule, 50, 30)), false);
    assert.equal(graph.getCursorForMouseEvent(makeMouseEvent(gardenModule, 50, 30)), null);
    const sourceState = makeCursorState(gardenModule);
    assert.equal(applyNativeGraphHandlerCursor(graph, makeMouseEvent(gardenModule, 50, 30, sourceState)), "move");
    assert.equal(sourceState.cursor, "move");
});

test("workspace drag handle renders Draw.io move image and keeps move cursor", () => {
    const { graph, gardenModule } = makeHarness();
    const api = graph.__trellisWorkspaceDragPolicy;
    graph.setSelectionCell(gardenModule);
    api.refreshHandles();
    const handle = graph.container.querySelector("[data-trellis-workspace-drag-handle='1']");
    assert.ok(handle, "expected workspace handle");
    assert.equal(handle.style.cursor, "move");
    const img = handle.querySelector("img");
    assert.ok(img, "expected Draw.io move image");
    assert.equal(img.getAttribute("src"), TEST_MOVE_IMAGE);
});

test("surface drag on workspace modules is marked for scoped marquee", () => {
    const { graph, Handler, gardenModule, regularModule, teamModule } = makeHarness();
    const handler = new Handler();
    handler.graph = graph;
    graph.__hitCell = gardenModule;
    handler.mouseDown(graph, makeMouseEvent(gardenModule, 250, 90));
    assert.equal(graph.__trellisWorkspaceDragContext.cell, gardenModule);
    assert.equal(graph.__trellisWorkspaceDragContext.type, "module");
    assert.equal(graph.__oldGraphHandlerMouseDownCalled, undefined);
    graph.__trellisWorkspaceDragContext = null;
    graph.__hitCell = regularModule;
    handler.mouseDown(graph, makeMouseEvent(regularModule, 250, 390));
    assert.equal(graph.__trellisWorkspaceDragContext.cell, regularModule);
    assert.equal(graph.__trellisWorkspaceDragContext.type, "module");
    graph.__trellisWorkspaceDragContext = null;
    graph.__hitCell = teamModule;
    handler.mouseDown(graph, makeMouseEvent(teamModule, 640, 390));
    assert.equal(graph.__trellisWorkspaceDragContext.cell, teamModule);
    assert.equal(graph.__trellisWorkspaceDragContext.type, "module");
});

test("workspace module header drag stays on native graph handler path", () => {
    const { graph, Handler, gardenModule, regularModule, teamModule } = makeHarness();
    const handler = new Handler();
    handler.graph = graph;
    graph.__hitCell = gardenModule;
    handler.mouseDown(graph, makeMouseEvent(gardenModule, 50, 30));
    assert.equal(graph.__trellisWorkspaceDragContext, undefined);
    assert.equal(graph.__oldGraphHandlerMouseDownCalled, true);
    graph.__oldGraphHandlerMouseDownCalled = false;
    graph.__hitCell = regularModule;
    handler.mouseDown(graph, makeMouseEvent(regularModule, 50, 310));
    assert.equal(graph.__trellisWorkspaceDragContext, undefined);
    assert.equal(graph.__oldGraphHandlerMouseDownCalled, true);
    graph.__oldGraphHandlerMouseDownCalled = false;
    graph.__hitCell = teamModule;
    handler.mouseDown(graph, makeMouseEvent(teamModule, 440, 310));
    assert.equal(graph.__trellisWorkspaceDragContext, undefined);
    assert.equal(graph.__oldGraphHandlerMouseDownCalled, true);
});

test("workspace first-use callout anchors to cursor point", () => {
    const { graph, gardenModule } = makeHarness();
    const anchor = graph.__trellisWorkspaceDragPolicy.getCalloutAnchorPointForTests(gardenModule, makeMouseEvent(gardenModule, 123, 145));
    assert.deepEqual(anchor, { x: 123, y: 145 });
});

test("workspace move callout is suppressed for canonical kanban board lanes", () => {
    const { graph, lane, kanbanLane } = makeHarness();
    const api = graph.__trellisWorkspaceDragPolicy;
    const rubberband = { first: { x: 0, y: 0 } };
    assert.equal(api.shouldShowCalloutForTests({ cell: kanbanLane, type: "lane" }, rubberband, makeMouseEvent(kanbanLane, 20, 20)), false);
    assert.equal(api.shouldShowCalloutForTests({ cell: lane, type: "lane" }, rubberband, makeMouseEvent(lane, 20, 20)), true);
});

test("nested workspace surface drag chooses deepest eligible container", () => {
    const { graph, Handler, gardenModule, lane } = makeHarness();
    const handler = new Handler();
    handler.graph = graph;
    graph.__hitCell = lane;
    handler.mouseDown(graph, makeMouseEvent(gardenModule));
    assert.equal(graph.__trellisWorkspaceDragContext.cell, lane);
    assert.equal(graph.__trellisWorkspaceDragContext.type, "lane");
});

test("lane hover grace keeps lane handle when parent module is hit", () => {
    const { graph, gardenModule, lane } = makeHarness();
    const api = graph.__trellisWorkspaceDragPolicy;
    api.setHoveredCellForTests(lane);
    graph.__hitCell = gardenModule;
    api.updateHoverForTests(makeMouseEvent(gardenModule, 20, 90));
    assert.deepEqual(ids(api.getHandleCells()), ["lane"]);
});

test("child drags inside workspace modules stay on native graph handler path", () => {
    const { graph, Handler, gardenModule, bed, regularChild, teamRole } = makeHarness();
    const handler = new Handler();
    handler.graph = graph;
    graph.__hitCell = bed;
    handler.mouseDown(graph, makeMouseEvent(gardenModule));
    assert.equal(graph.__trellisWorkspaceDragContext, undefined);
    assert.equal(graph.__oldGraphHandlerMouseDownCalled, true);
    graph.__oldGraphHandlerMouseDownCalled = false;
    graph.__hitCell = regularChild;
    handler.mouseDown(graph, makeMouseEvent(regularChild, 50, 370));
    assert.equal(graph.__trellisWorkspaceDragContext, undefined);
    assert.equal(graph.__oldGraphHandlerMouseDownCalled, true);
    graph.__oldGraphHandlerMouseDownCalled = false;
    graph.__hitCell = teamRole;
    handler.mouseDown(graph, makeMouseEvent(teamRole, 440, 370));
    assert.equal(graph.__trellisWorkspaceDragContext, undefined);
    assert.equal(graph.__oldGraphHandlerMouseDownCalled, true);
});

test("deep click-through returns children inside regular and team modules", () => {
    const { graph, regularModule, regularChild, teamModule, teamRole } = makeHarness();
    graph.__hitCell = regularModule;
    assert.equal(graph.getCellAt(50, 370), regularChild);
    graph.__hitCell = teamModule;
    assert.equal(graph.getCellAt(440, 370), teamRole);
});
