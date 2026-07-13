const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { JSDOM } = require("jsdom");

const PROJECT_ROOT = path.join(__dirname, "..");
const TASK_MANAGER_PATH = path.join(PROJECT_ROOT, "drawio", "src", "main", "webapp", "plugins", "garden_planner_plugins", "Garden_Task_Manager.js");
const TEST_REALISTIC_WEEK_WORK_HOURS_JSON = JSON.stringify({ schemaVersion: 1, days: [ // CHANGE
    { startMinute: 480, endMinute: 720 }, // NEW
    { startMinute: 1020, endMinute: 1140 }, // NEW
    { startMinute: 1020, endMinute: 1140 }, // NEW
    { startMinute: 1020, endMinute: 1140 }, // NEW
    { startMinute: 1020, endMinute: 1140 }, // NEW
    { startMinute: 1020, endMinute: 1140 }, // NEW
    { startMinute: 480, endMinute: 720 } // NEW
] }); // CHANGE
const TEST_LEGACY_BOARD_STYLE = "swimlane;fontStyle=2;childLayout=stackLayout;horizontal=1;startSize=28;horizontalStack=1;resizeParent=1;resizeParentMax=0;resizeLast=0;collapsible=1;marginBottom=0;swimlaneFillColor=none;fontFamily=Permanent Marker;fontSize=16;points=[];verticalAlign=top;stackBorder=0;resizable=1;strokeWidth=2;disableMultiStroke=1;"; // NEW

function nextTick() {
    return new Promise(resolve => setTimeout(resolve, 5));
}

class TestGeometry {
    constructor(x, y, width, height) {
        this.x = x;
        this.y = y;
        this.width = width;
        this.height = height;
    }

    clone() {
        return new TestGeometry(this.x, this.y, this.width, this.height);
    }
}

class TestCell {
    constructor(id, value, geometry, style) {
        this.id = id;
        this.value = value || "";
        this.geometry = geometry || new TestGeometry(0, 0, 0, 0);
        this.style = style || "";
        this.vertex = true;
        this.children = [];
        this.parent = null;
        this.visible = true;
    }

    getId() { return this.id; }
    getGeometry() { return this.geometry; }
    setVertex(value) { this.vertex = !!value; }
    setConnectable() {}
    getStyle() { return this.style; }
    setStyle(style) { this.style = style; }
}

function makeValue(document, attrs = {}) {
    const value = document.createElement("object");
    Object.entries(attrs).forEach(([key, attrValue]) => {
        if (attrValue != null) value.setAttribute(key, String(attrValue));
    });
    return value;
}

function attr(cell, key) {
    return cell && cell.value && cell.value.getAttribute ? cell.value.getAttribute(key) : null;
}

function setAttr(cell, key, value) { // NEW
    if (value == null) cell.value.removeAttribute(key); // NEW
    else cell.value.setAttribute(key, String(value)); // NEW
} // NEW

function buttonByText(root, text) {
    return Array.from(root.querySelectorAll("button")).find(button => button.textContent === text);
}

function modeToggleButton(root) { // NEW
    return buttonByText(root, "Switch to Full view") || buttonByText(root, "Switch to Week view"); // CHANGE
} // NEW

function loadTaskManagerHooks() { // NEW
    const context = vm.createContext({ // NEW
        console, // NEW
        globalThis: { __TRELLIS_TASK_MANAGER_TEST__: true }, // NEW
        Draw: { loadPlugin() {} } // NEW
    }); // NEW
    vm.runInContext(fs.readFileSync(TASK_MANAGER_PATH, "utf8"), context, { filename: TASK_MANAGER_PATH }); // NEW
    return context.globalThis.__TRELLIS_TASK_MANAGER_TEST_HOOKS__; // NEW
} // NEW

function saveSelectedWeekDayHours(h, dayIndex, startValue, endValue) { // NEW
    const boardOverlay = h.document.querySelector(".trellis-task-board-header-controls"); // NEW
    buttonByText(boardOverlay, "Edit Hours").click(); // NEW
    const timeInputs = Array.from(h.lastDialog.querySelectorAll("input[type='time']")); // NEW
    const selectedWeekOffset = 14 + (dayIndex * 2); // NEW
    timeInputs[selectedWeekOffset].value = startValue; // NEW
    timeInputs[selectedWeekOffset + 1].value = endValue; // NEW
    buttonByText(h.lastDialog, "Save").click(); // NEW
} // NEW

function selectedWeekOverrideDay(h, dayIndex) { // NEW
    const overrides = JSON.parse(attr(h.board, "task_work_hours_week_overrides_json")); // NEW
    return overrides.weeks["2026-07-12"].days[dayIndex]; // NEW
} // NEW

function addHarnessCard(h, lane, id, attrs = {}, height = 60) { // NEW
    const card = new TestCell(id, makeValue(h.document, Object.assign({ kanban_card: "1", title: id }, attrs)), new TestGeometry(30, 60 + (lane.children.length * 70), 120, height)); // NEW
    card.parent = lane; // NEW
    lane.children.push(card); // NEW
    return card; // NEW
} // NEW

function makeHarness(options = {}) { // CHANGE
    const dom = new JSDOM(options.svgOverlayPane // CHANGE
        ? "<!doctype html><body><div id='graph'><svg><g id='overlay'></g></svg></div></body>" // NEW
        : "<!doctype html><body><div id='graph'><div id='overlay'></div></div></body>"); // CHANGE
    const { document } = dom.window;
    const container = document.getElementById("graph");
    const overlayPane = document.getElementById("overlay");
    const selectionListeners = [];
    const modelListeners = [];
    const viewListeners = [];
    const mouseListeners = []; // NEW
    const graphListeners = new Map(); // NEW
    let selectedCells = [];
    let lastDialog = null;
    let currentUi = null; // NEW

    const root = new TestCell("root", makeValue(document), new TestGeometry(0, 0, 0, 0));
    const board = new TestCell("board", makeValue(document, { board_key: "KANBAN_BOARD", board_role: "main", task_view_mode: "WEEK", task_selected_week_start: "2026-07-12", task_selected_day: "2026-07-12", task_work_hours_defaults_json: TEST_REALISTIC_WEEK_WORK_HOURS_JSON }), new TestGeometry(10, 10, 700, 260), TEST_LEGACY_BOARD_STYLE); // CHANGE
    const stagedLane = new TestCell("staged", makeValue(document, { lane_key: "TODO_STAGED", status: "TODO (staged)" }), new TestGeometry(20, 40, 200, 200)); // NEW
    const weekSunLane = new TestCell("weekSun", makeValue(document, { lane_key: "WEEK_SUN", status: "Sunday" }), new TestGeometry(240, 40, 200, 200)); // NEW
    const weekMonLane = new TestCell("weekMon", makeValue(document, { lane_key: "WEEK_MON", status: "Monday" }), new TestGeometry(460, 40, 200, 200)); // NEW
    const weekTueLane = new TestCell("weekTue", makeValue(document, { lane_key: "WEEK_TUE", status: "Tuesday" }), new TestGeometry(680, 40, 200, 200)); // NEW
    const weekWedLane = new TestCell("weekWed", makeValue(document, { lane_key: "WEEK_WED", status: "Wednesday" }), new TestGeometry(460, 40, 200, 200)); // NEW
    const weekThuLane = new TestCell("weekThu", makeValue(document, { lane_key: "WEEK_THU", status: "Thursday" }), new TestGeometry(1120, 40, 200, 200)); // NEW
    const weekFriLane = new TestCell("weekFri", makeValue(document, { lane_key: "WEEK_FRI", status: "Friday" }), new TestGeometry(1340, 40, 200, 200)); // NEW
    const weekSatLane = new TestCell("weekSat", makeValue(document, { lane_key: "WEEK_SAT", status: "Saturday" }), new TestGeometry(1560, 40, 200, 200)); // NEW
    const todoLane = new TestCell("todo", makeValue(document, { lane_key: "TODO", status: "TODO" }), new TestGeometry(20, 40, 200, 200));
    const doingLane = new TestCell("doing", makeValue(document, { lane_key: "DOING", status: "DOING" }), new TestGeometry(240, 40, 200, 200));
    const stagedCard = new TestCell("stagedCard", makeValue(document, { // NEW
        kanban_card: "1", // NEW
        title: "Stage compost", // NEW
        workflow_state: "STAGED", // NEW
        start: "2026-07-14", // NEW
        end: "2026-07-14" // NEW
    }), new TestGeometry(30, 60, 120, 60)); // NEW
    const stagedBeforeCard = new TestCell("stagedBeforeCard", makeValue(document, { // NEW
        kanban_card: "1", // NEW
        title: "Before week", // NEW
        workflow_state: "STAGED", // NEW
        start: "2026-07-01", // NEW
        end: "2026-07-01" // NEW
    }), new TestGeometry(30, 130, 120, 60)); // NEW
    const stagedAfterCard = new TestCell("stagedAfterCard", makeValue(document, { // NEW
        kanban_card: "1", // NEW
        title: "After week", // NEW
        workflow_state: "STAGED", // NEW
        start: "2026-07-25", // NEW
        end: "2026-07-25" // NEW
    }), new TestGeometry(30, 200, 120, 60)); // NEW
    const stagedInvalidCard = new TestCell("stagedInvalidCard", makeValue(document, { // NEW
        kanban_card: "1", // NEW
        title: "No date", // NEW
        workflow_state: "STAGED" // NEW
    }), new TestGeometry(30, 270, 120, 60)); // NEW
    const weekTueCard = new TestCell("weekTueCard", makeValue(document, { // NEW
        kanban_card: "1", // NEW
        title: "Tuesday task", // NEW
        workflow_state: "TODO", // NEW
        assigned_day: "2026-07-14", // NEW
        start: "2026-07-14", // NEW
        end: "2026-07-14" // NEW
    }), new TestGeometry(690, 60, 120, 60)); // NEW
    const weekTueCard2 = new TestCell("weekTueCard2", makeValue(document, { // NEW
        kanban_card: "1", // NEW
        title: "Second Tuesday task", // NEW
        workflow_state: "TODO", // NEW
        assigned_day: "2026-07-14", // NEW
        start: "2026-07-14", // NEW
        end: "2026-07-14" // NEW
    }), new TestGeometry(690, 130, 120, 60)); // NEW
    const weekLaneCard = new TestCell("weekLaneCard", makeValue(document, { // NEW
        kanban_card: "1", // NEW
        title: "Week lane task", // NEW
        workflow_state: "TODO", // NEW
        assigned_day: "2026-07-15", // NEW
        start: "2026-07-15", // NEW
        end: "2026-07-15" // NEW
    }), new TestGeometry(470, 60, 120, 60)); // NEW
    const card1 = new TestCell("card1", makeValue(document, {
        kanban_card: "1",
        title: "Irrigate",
        workflow_state: "TODO",
        start: "2026-07-01",
        end: "2026-07-03",
        base_start: "2026-07-01",
        base_end: "2026-07-03",
        date_override: "1",
        card_note: "old note"
    }), new TestGeometry(30, 60, 120, 60));
    const card2 = new TestCell("card2", makeValue(document, {
        kanban_card: "1",
        title: "Mulch",
        workflow_state: "TODO",
        start: "2026-07-05",
        end: "2026-07-09",
        base_start: "2026-07-05",
        base_end: "2026-07-09",
        date_override: "1",
        card_note: "other note"
    }), new TestGeometry(30, 130, 120, 60));

    const cellById = new Map();
    let labelSetCount = 0; // NEW
    function instrumentLabelWrites(value) { // NEW
        if (!value || typeof value.setAttribute !== "function" || value.__trellisLabelWritesInstrumented) return value; // NEW
        const originalSetAttribute = value.setAttribute.bind(value); // NEW
        value.setAttribute = function (name, attrValue) { // NEW
            if (name === "label") labelSetCount += 1; // NEW
            return originalSetAttribute(name, attrValue); // NEW
        }; // NEW
        value.__trellisLabelWritesInstrumented = true; // NEW
        return value; // NEW
    } // NEW
    function register(cell) {
        if (cell) instrumentLabelWrites(cell.value); // NEW
        cellById.set(cell.id, cell);
        cell.children.forEach(register);
    }

    function add(parent, child, index = parent.children.length) {
        if (child.parent) child.parent.children = child.parent.children.filter(existing => existing !== child);
        child.parent = parent;
        const boundedIndex = Math.max(0, Math.min(index, parent.children.length));
        parent.children.splice(boundedIndex, 0, child);
        register(child);
    }

    add(root, board);
    add(board, stagedLane); // NEW
    add(board, weekSunLane); // NEW
    add(board, weekMonLane); // NEW
    add(board, weekTueLane); // NEW
    add(board, weekWedLane); // NEW
    add(board, weekThuLane); // NEW
    add(board, weekFriLane); // NEW
    add(board, weekSatLane); // NEW
    add(board, todoLane);
    add(board, doingLane);
    add(stagedLane, stagedCard); // NEW
    add(stagedLane, stagedBeforeCard); // NEW
    add(stagedLane, stagedAfterCard); // NEW
    add(stagedLane, stagedInvalidCard); // NEW
    add(weekTueLane, weekTueCard); // NEW
    add(weekTueLane, weekTueCard2); // NEW
    add(weekWedLane, weekLaneCard); // NEW
    add(todoLane, card1);
    add(todoLane, card2);

    const states = new Map();
    let geometrySetCount = 0; // NEW
    const refreshCalls = []; // NEW
    const model = {
        isVertex(cell) { return !!(cell && cell.vertex); },
        getParent(cell) { return cell ? cell.parent : null; },
        getChildCount(cell) { return cell && cell.children ? cell.children.length : 0; },
        getChildAt(cell, index) { return cell.children[index]; },
        add(parent, child, index) { add(parent, child, index); },
        beginUpdate() {},
        endUpdate() {},
        setValue(cell, value) { cell.value = instrumentLabelWrites(value); }, // CHANGE
        setGeometry(cell, geometry) { geometrySetCount++; cell.geometry = geometry; }, // CHANGE
        getGeometry(cell) { return cell ? cell.geometry : null; },
        setVisible(cell, visible) { cell.visible = !!visible; },
        isVisible(cell) { return !cell || cell.visible !== false; },
        remove(cell) {
            if (cell && cell.parent) cell.parent.children = cell.parent.children.filter(child => child !== cell);
            if (cell) cell.parent = null;
        },
        getCell(id) { return cellById.get(id) || null; },
        getRoot() { return root; },
        addListener(event, listener) { modelListeners.push({ event, listener }); }
    };

    const selectionModel = {
        addListener(event, listener) { selectionListeners.push(listener); }
    };

    const graph = {
        container,
        view: {
            overlayPane,
            getState(cell) { return states.get(cell) || null; },
            addListener(event, listener) { viewListeners.push({ event, listener }); }
        },
        getModel() { return model; },
        getDefaultParent() { return root; },
        getSelectionModel() { return selectionModel; },
        getSelectionCell() { return selectedCells[0] || null; },
        getSelectionCells() { return selectedCells.slice(); },
        setSelectionCells(cells) {
            selectedCells = cells ? cells.slice() : [];
            selectionListeners.forEach(listener => listener());
        },
        setSelectionCell(cell) { this.setSelectionCells(cell ? [cell] : []); },
        refresh(cell) { refreshCalls.push(cell || null); }, // CHANGE
        removeCellOverlays() {},
        addCellOverlay() {},
        addListener(event, listener) { // CHANGE
            if (!graphListeners.has(event)) graphListeners.set(event, []); // NEW
            graphListeners.get(event).push(listener); // NEW
        }, // CHANGE
        addMouseListener(listener) { mouseListeners.push(listener); }, // NEW
        fireEvent() {},
        getEdges() { return []; },
        scrollCellToVisible() {},
        isCellVisible(cell) { return !cell || cell.visible !== false; },
        isValidDropTarget() { return true; },
        resizeCells(cells) { return cells; }, // NEW
        moveCells(cells, dx, dy, clone, target) { if (target && !clone) (cells || []).forEach(cell => add(target, cell)); return cells; } // CHANGE
    };

    const context = vm.createContext({
        console,
        Date,
        Math,
        Promise,
        setTimeout,
        clearTimeout,
        globalThis: { __TRELLIS_TASK_MANAGER_TEST__: true }, // NEW
        window: dom.window,
        document,
        Draw: {
            loadPlugin(registerPlugin) {
                const ui = { // CHANGE
                    editor: { graph, undoManager: { undoableEditHappened() {} } },
                    hideDialog() {
                        if (currentUi && currentUi.dialog && currentUi.dialog.bg && currentUi.dialog.bg.parentNode) currentUi.dialog.bg.parentNode.removeChild(currentUi.dialog.bg); // NEW
                        if (currentUi && currentUi.dialog && currentUi.dialog.container && currentUi.dialog.container.parentNode) currentUi.dialog.container.parentNode.removeChild(currentUi.dialog.container); // NEW
                        lastDialog = null;
                        if (currentUi) currentUi.dialog = null; // NEW
                    },
                    showDialog(node) {
                        const bg = document.createElement("div"); // NEW
                        const containerNode = document.createElement("div"); // NEW
                        lastDialog = node;
                        containerNode.appendChild(node); // NEW
                        document.body.appendChild(bg); // NEW
                        document.body.appendChild(containerNode); // NEW
                        currentUi.dialog = { bg, container: containerNode }; // NEW
                    }
                }; // CHANGE
                currentUi = ui; // NEW
                registerPlugin(ui); // CHANGE
            }
        },
        mxUtils: {
            createXmlDocument() { return document.implementation.createDocument("", "", null); },
            htmlEntities(value) {
                return String(value).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
            },
            button(label, fn) {
                const button = document.createElement("button");
                button.type = "button";
                button.textContent = label;
                button.addEventListener("click", fn);
                return button;
            }
        },
        mxEvent: {
            CHANGE: "change",
            SCALE: "scale",
            TRANSLATE: "translate",
            SCALE_AND_TRANSLATE: "scaleAndTranslate",
            REPAINT: "repaint",
            CLICK: "click",
            CELLS_MOVED: "cellsMoved", // NEW
            CELLS_RESIZED: "cellsResized", // NEW
            addListener(node, event, listener) { node.addEventListener(event, listener); },
            consume(evt) { if (evt && evt.preventDefault) evt.preventDefault(); },
            isControlDown() { return false; },
            isMetaDown() { return false; },
            isShiftDown() { return false; },
            isPopupTrigger() { return false; }
        },
        mxCell: class extends TestCell { // CHANGE: plugin code calls mxCell(value, geometry, style)
            constructor(value, geometry, style) { // NEW
                super(`generated-${cellById.size + 1}`, value, geometry, style); // NEW
            } // NEW
        }, // CHANGE
        mxGeometry: TestGeometry,
        mxImage: class {},
        mxCellOverlay: class { addListener() {} },
        mxPoint: class { constructor(x, y) { this.x = x; this.y = y; } },
        mxConstants: { ALIGN_RIGHT: "right", ALIGN_TOP: "top", ALIGN_BOTTOM: "bottom" },
        mxEventObject: class { constructor(name, key, value) { this.name = name; this.props = { [key]: value }; } getProperty(key) { return this.props[key]; } },
        mxChildChange: class {},
        mxValueChange: class {},
        mxStyleChange: class {},
        mxGeometryChange: class { constructor(cell, previous) { this.cell = cell; this.previous = previous || null; } } // CHANGE
    });

    vm.runInContext(fs.readFileSync(TASK_MANAGER_PATH, "utf8"), context, { filename: TASK_MANAGER_PATH });
    const taskHooks = context.globalThis.__TRELLIS_TASK_MANAGER_TEST_HOOKS__; // NEW

    return {
        document,
        graph,
        board,
        stagedLane, // NEW
        weekSunLane, // NEW
        weekTueLane, // NEW
        weekWedLane, // NEW
        weekSatLane, // NEW
        todoLane, // NEW
        doingLane, // NEW
        stagedCard, // NEW
        stagedBeforeCard, // NEW
        stagedAfterCard, // NEW
        stagedInvalidCard, // NEW
        weekTueCard, // NEW
        weekTueCard2, // NEW
        weekLaneCard, // NEW
        card1,
        card2,
        states,
        get geometrySetCount() { return geometrySetCount; }, // NEW
        get labelSetCount() { return labelSetCount; }, // NEW
        reflowCounters() { return JSON.parse(JSON.stringify(taskHooks.snapshotTaskReflowTestCounters())); }, // NEW
        get refreshCalls() { return refreshCalls.slice(); }, // NEW
        get lastDialog() { return lastDialog; },
        get ui() { return currentUi; }, // NEW
        geometryChange(cell, previous) { return new context.mxGeometryChange(cell, previous); }, // CHANGE
        childChange(cell, previous) { const change = new context.mxChildChange(); change.child = cell; change.previous = previous; return change; }, // NEW
        setState(cell, state) { states.set(cell, state); },
        fireViewEvent(eventName = "repaint") {
            viewListeners.filter(entry => entry.event === eventName).forEach(entry => entry.listener());
        },
        fireGraphEvent(eventName, props = {}) { // NEW
            const evt = { getProperty(key) { return Object.prototype.hasOwnProperty.call(props, key) ? props[key] : null; } }; // NEW
            (graphListeners.get(eventName) || []).forEach(listener => listener(graph, evt)); // NEW
        }, // NEW
        fireModelChange(edit = null) { // CHANGE
            const evt = { getProperty(key) { return key === "edit" ? edit : null; } }; // NEW
            modelListeners.filter(entry => entry.event === "change").forEach(entry => entry.listener(null, evt)); // CHANGE
        },
        mouseDown(cell = null) { // NEW
            const me = { getCell() { return cell; }, getEvent() { return {}; } }; // NEW
            mouseListeners.forEach(listener => { if (listener.mouseDown) listener.mouseDown(graph, me); }); // NEW
        }, // NEW
        mouseUp(cell = null) { // NEW
            const me = { getCell() { return cell; }, getEvent() { return {}; } }; // NEW
            mouseListeners.forEach(listener => { if (listener.mouseUp) listener.mouseUp(graph, me); }); // NEW
        }, // NEW
        resetCounters() { geometrySetCount = 0; labelSetCount = 0; refreshCalls.length = 0; taskHooks.resetTaskReflowTestCounters(); } // CHANGE
    };
}

test("task manager reflow scope policy maps command categories", () => { // NEW
    const hooks = loadTaskManagerHooks(); // NEW
    const plain = value => JSON.parse(JSON.stringify(value)); // NEW
    assert.deepEqual(plain(hooks.normalizeTaskReflowScopePlan("full")), { // NEW
        requested: ["full"], full: true, classification: true, lanes: true, layout: true, badges: true // NEW
    }); // NEW
    assert.deepEqual(plain(hooks.normalizeTaskReflowScopePlan("badges")), { // NEW
        requested: ["badges"], full: false, classification: false, lanes: false, layout: false, badges: true // NEW
    }); // NEW
    assert.deepEqual(plain(hooks.normalizeTaskReflowScopePlan("layout")), { // NEW
        requested: ["layout"], full: false, classification: false, lanes: true, layout: true, badges: true // NEW
    }); // NEW
    assert.equal(hooks.getTaskReflowScopeForCommand("workflow"), "classification"); // NEW
    assert.equal(hooks.getTaskReflowScopeForCommand("editHours"), "layout"); // NEW
    assert.equal(hooks.getTaskReflowScopeForCommand("boardResize"), "layout"); // NEW
    assert.equal(hooks.getTaskReflowScopeForCommand("selection"), "badges"); // NEW
    assert.equal(hooks.getTaskReflowScopeForCommand("unknown-command"), "full"); // NEW
}); // NEW

test("task manager selection overlays render above graph and defer until states are available", async () => {
    const h = makeHarness();
    const boardOverlay = h.document.querySelector(".trellis-task-board-header-controls");
    const cardOverlay = h.document.querySelector(".trellis-task-selected-card-actions");
    const dayLaneOverlay = h.document.querySelector(".trellis-task-selected-day-lane-actions"); // NEW
    assert.equal(boardOverlay.parentNode.className, "trellis-task-control-layer"); // CHANGE
    assert.equal(cardOverlay.parentNode.className, "trellis-task-control-layer"); // CHANGE
    assert.equal(dayLaneOverlay.parentNode.className, "trellis-task-control-layer"); // NEW
    assert.equal(boardOverlay.parentNode.parentNode.id, "overlay"); // CHANGE

    h.graph.setSelectionCell(h.board);
    h.setState(h.board, { x: 10, y: 10, width: 700, height: 260 });
    await nextTick();

    assert.equal(boardOverlay.style.display, "flex");
    assert.equal(boardOverlay.style.zIndex, "10020");
    assert.equal(boardOverlay.style.left, "10px");
    assert.equal(cardOverlay.style.display, "none");
    assert.equal(dayLaneOverlay.style.display, "none"); // NEW

    h.graph.setSelectionCell(h.card1);
    h.setState(h.card1, { x: 30, y: 60, width: 120, height: 60 });
    await nextTick();

    assert.equal(cardOverlay.style.display, "flex");
    assert.equal(cardOverlay.style.zIndex, "10020");
    assert.equal(cardOverlay.style.top, "141px"); // CHANGE
    assert.equal(cardOverlay.style.flexDirection, "column"); // NEW
    assert.equal(cardOverlay.style.alignItems, "stretch"); // NEW

    h.graph.setSelectionCell(h.card2); // NEW
    await nextTick(); // NEW

    assert.equal(cardOverlay.style.display, "none"); // NEW
});

test("task manager DOM overlays avoid SVG overlayPane hosts", async () => { // NEW
    const h = makeHarness({ svgOverlayPane: true }); // NEW
    const boardOverlay = h.document.querySelector(".trellis-task-board-header-controls"); // NEW
    const cardOverlay = h.document.querySelector(".trellis-task-selected-card-actions"); // NEW
    const dayLaneOverlay = h.document.querySelector(".trellis-task-selected-day-lane-actions"); // NEW
    assert.equal(boardOverlay.parentNode.className, "trellis-task-control-layer"); // CHANGE
    assert.equal(cardOverlay.parentNode.className, "trellis-task-control-layer"); // CHANGE
    assert.equal(dayLaneOverlay.parentNode.className, "trellis-task-control-layer"); // NEW
    assert.equal(boardOverlay.parentNode.parentNode.id, "graph"); // CHANGE

    h.graph.setSelectionCell(h.board); // NEW
    h.setState(h.board, { x: 10, y: 10, width: 700, height: 260 }); // NEW
    await nextTick(); // NEW

    assert.equal(boardOverlay.style.display, "flex"); // NEW
    assert.equal(boardOverlay.style.zIndex, "10020"); // NEW
    assert.equal(boardOverlay.parentNode.nodeName, "DIV"); // CHANGE
    assert.equal(boardOverlay.parentNode.className, "trellis-task-control-layer"); // CHANGE
    assert.equal(boardOverlay.parentNode.parentNode.id, "graph"); // CHANGE
});

test("task manager hides task overlays during week card drag and refreshes once after mouseup", async () => { // NEW
    const h = makeHarness(); // NEW
    const boardOverlay = h.document.querySelector(".trellis-task-board-header-controls"); // NEW
    const cardOverlay = h.document.querySelector(".trellis-task-selected-card-actions"); // NEW
    h.setState(h.board, { x: 10, y: 10, width: 700, height: 260 }); // NEW
    h.setState(h.weekTueCard, { x: 690, y: 60, width: 120, height: 60 }); // NEW
    h.graph.setSelectionCell(h.weekTueCard); // NEW
    await nextTick(); // NEW

    assert.equal(boardOverlay.style.display, "flex"); // NEW
    assert.equal(cardOverlay.style.display, "flex"); // NEW
    const initialLeft = cardOverlay.style.left; // NEW

    h.mouseDown(h.weekTueCard); // NEW
    assert.equal(boardOverlay.style.display, "none"); // NEW
    assert.equal(cardOverlay.style.display, "none"); // NEW

    h.setState(h.weekTueCard, { x: 760, y: 90, width: 120, height: 60 }); // NEW
    h.fireViewEvent("repaint"); // NEW
    h.fireModelChange(); // NEW
    await nextTick(); // NEW
    assert.equal(cardOverlay.style.display, "none"); // NEW
    assert.equal(cardOverlay.style.left, initialLeft); // NEW

    h.mouseUp(h.weekTueCard); // NEW
    await nextTick(); // NEW
    assert.equal(boardOverlay.style.display, "flex"); // NEW
    assert.equal(cardOverlay.style.display, "flex"); // NEW
    assert.notEqual(cardOverlay.style.left, initialLeft); // NEW
}); // NEW

test("task manager hides task overlays during full-mode card drag", async () => { // NEW
    const h = makeHarness(); // NEW
    const cardOverlay = h.document.querySelector(".trellis-task-selected-card-actions"); // NEW
    setAttr(h.board, "task_view_mode", "FULL"); // NEW
    h.setState(h.card1, { x: 30, y: 60, width: 120, height: 60 }); // NEW
    h.graph.setSelectionCell(h.card1); // NEW
    await nextTick(); // NEW

    assert.equal(cardOverlay.style.display, "flex"); // NEW
    h.mouseDown(h.card1); // NEW
    assert.equal(cardOverlay.style.display, "none"); // NEW
    h.mouseUp(h.card1); // NEW
    await nextTick(); // NEW
    assert.equal(cardOverlay.style.display, "flex"); // NEW
}); // NEW

test("task manager releases overlay suppression on moved and resized commit events", async () => { // NEW
    const h = makeHarness(); // NEW
    const cardOverlay = h.document.querySelector(".trellis-task-selected-card-actions"); // NEW
    h.setState(h.weekTueCard, { x: 690, y: 60, width: 120, height: 60 }); // NEW
    h.graph.setSelectionCell(h.weekTueCard); // NEW
    await nextTick(); // NEW

    h.mouseDown(h.weekTueCard); // NEW
    assert.equal(cardOverlay.style.display, "none"); // NEW
    h.fireGraphEvent("cellsMoved", { cells: [h.weekTueCard] }); // NEW
    await nextTick(); // NEW
    assert.equal(cardOverlay.style.display, "flex"); // NEW

    h.mouseDown(h.weekTueCard); // NEW
    assert.equal(cardOverlay.style.display, "none"); // NEW
    h.fireGraphEvent("cellsResized", { cells: [h.weekTueCard] }); // NEW
    await nextTick(); // NEW
    assert.equal(cardOverlay.style.display, "flex"); // NEW
}); // NEW

test("task manager non-task mouse interactions do not suppress overlays", async () => { // NEW
    const h = makeHarness(); // NEW
    const boardOverlay = h.document.querySelector(".trellis-task-board-header-controls"); // NEW
    h.setState(h.board, { x: 10, y: 10, width: 700, height: 260 }); // NEW
    h.graph.setSelectionCell(h.board); // NEW
    await nextTick(); // NEW

    assert.equal(boardOverlay.style.display, "flex"); // NEW
    h.mouseDown(h.board); // NEW
    h.fireViewEvent("repaint"); // NEW
    await nextTick(); // NEW
    assert.equal(boardOverlay.style.display, "flex"); // NEW
}); // NEW

test("task manager staged start badge uses visible-week weekday wording", async () => { // CHANGE
    const h = makeHarness(); // NEW

    h.graph.setSelectionCell(h.board); // NEW
    await nextTick(); // NEW
    assert.match(attr(h.stagedCard, "label"), /Start:/); // CHANGE
    assert.match(attr(h.stagedCard, "label"), /Start (Tue|tomorrow)/); // CHANGE
    assert.doesNotMatch(attr(h.stagedCard, "label"), /Due:/); // NEW

    h.graph.setSelectionCell(h.weekWedLane); // NEW
    await nextTick(); // NEW
    assert.match(attr(h.stagedCard, "label"), /Start (Tue|tomorrow)/); // CHANGE
    assert.doesNotMatch(attr(h.stagedCard, "label"), /early|late/); // CHANGE

    h.graph.setSelectionCell(h.weekLaneCard); // NEW
    await nextTick(); // NEW
    assert.match(attr(h.stagedCard, "label"), /Start (Tue|tomorrow)/); // CHANGE
    assert.doesNotMatch(attr(h.stagedCard, "label"), /early|late/); // CHANGE
}); // NEW

test("task manager week scheduler lays out day heights and selected-lane controls", async () => { // NEW
    const h = makeHarness(); // NEW
    h.setState(h.board, { x: 10, y: 10, width: 700, height: 260 }); // NEW
    h.graph.setSelectionCell(h.board); // NEW
    await nextTick(); // NEW

    const boardOverlay = h.document.querySelector(".trellis-task-board-header-controls"); // NEW
    const timeScaleOverlay = h.document.querySelector(".trellis-task-week-time-scale"); // NEW
    assert.equal(buttonByText(boardOverlay, "Day"), undefined); // NEW
    assert.equal(timeScaleOverlay.style.display, "block"); // NEW
    assert.equal(timeScaleOverlay.querySelectorAll(".trellis-task-week-time-label").length, 12); // NEW
    assert.equal(timeScaleOverlay.querySelector(".trellis-task-week-time-label").textContent, "8:00 AM"); // NEW
    assert.equal(timeScaleOverlay.style.left, "256px"); // NEW
    assert.equal(timeScaleOverlay.style.top, "58px"); // CHANGE
    assert.equal(timeScaleOverlay.querySelector(".trellis-task-week-time-grid-line").style.left, "72px"); // NEW
    assert.equal(h.weekSunLane.geometry.y, 48); // CHANGE
    assert.equal(h.weekWedLane.geometry.y, 768); // CHANGE
    assert.equal(parseInt(timeScaleOverlay.style.top, 10), 10 + h.weekSunLane.geometry.y); // NEW
    assert.equal(h.weekWedLane.geometry.height, 160); // CHANGE
    assert.equal(h.weekSunLane.geometry.height, 320); // NEW
    assert.equal(h.stagedLane.geometry.height, 880); // CHANGE
    assert.equal(h.board.geometry.height, 938); // CHANGE
    h.graph.view.scale = 2; // NEW
    h.setState(h.board, { x: 20, y: 20, width: 1400, height: 520 }); // NEW
    h.fireViewEvent("repaint"); // NEW
    await nextTick(); // NEW
    assert.equal(timeScaleOverlay.style.top, "116px"); // NEW
    assert.equal(timeScaleOverlay.querySelector(".trellis-task-week-time-grid-line").style.left, "144px"); // NEW
    h.graph.view.scale = 1; // NEW

    h.setState(h.weekWedLane, { x: 460, y: 40, width: 200, height: 960 }); // NEW
    h.graph.setSelectionCell(h.weekWedLane); // NEW
    await nextTick(); // NEW
    assert.ok(buttonByText(boardOverlay, "Edit Hours")); // NEW
    assert.ok(buttonByText(boardOverlay, "Add Break")); // NEW
    assert.equal(attr(h.board, "task_selected_day"), "2026-07-15"); // NEW
}); // NEW

test("task manager normalizes narrow and wide day cards to the lane interior", async () => { // NEW
    const h = makeHarness(); // NEW
    h.weekTueCard.geometry.x = 55; // NEW
    h.weekTueCard.geometry.width = 80; // NEW
    h.weekTueCard2.geometry.x = -20; // NEW
    h.weekTueCard2.geometry.width = 400; // NEW
    const stagedGeometry = h.stagedCard.geometry.clone(); // NEW

    h.graph.setSelectionCell(h.board); // NEW
    await nextTick(); // NEW

    const expectedWidth = h.weekTueLane.geometry.width - 20; // NEW
    assert.equal(h.weekTueCard.geometry.x, 10); // NEW
    assert.equal(h.weekTueCard.geometry.width, expectedWidth); // NEW
    assert.equal(h.weekTueCard2.geometry.x, 10); // NEW
    assert.equal(h.weekTueCard2.geometry.width, expectedWidth); // NEW
    assert.equal(h.stagedCard.geometry.x, stagedGeometry.x); // NEW
    assert.equal(h.stagedCard.geometry.width, stagedGeometry.width); // NEW
}); // NEW

test("task manager dragged cards adopt the destination day-lane width", async () => { // NEW
    const h = makeHarness(); // NEW
    h.stagedCard.geometry.x = 45; // NEW
    h.stagedCard.geometry.width = 75; // NEW

    h.graph.moveCells([h.stagedCard], 0, 0, false, h.weekTueLane); // NEW
    await nextTick(); // NEW

    assert.equal(h.stagedCard.parent, h.weekTueLane); // NEW
    assert.equal(h.stagedCard.geometry.x, 10); // NEW
    assert.equal(h.stagedCard.geometry.width, h.weekTueLane.geometry.width - 20); // NEW
}); // NEW

test("task manager day-lane overlay appears only for selected week day lanes", async () => { // NEW
    const h = makeHarness(); // NEW
    const overlay = h.document.querySelector(".trellis-task-selected-day-lane-actions"); // NEW
    h.setState(h.weekSunLane, { x: 240, y: 28, width: 200, height: 320 }); // NEW
    h.setState(h.weekLaneCard, { x: 470, y: 60, width: 120, height: 60 }); // NEW

    h.graph.setSelectionCell(h.board); // NEW
    await nextTick(); // NEW
    assert.equal(overlay.style.display, "none"); // NEW

    h.graph.setSelectionCell(h.weekLaneCard); // NEW
    await nextTick(); // NEW
    assert.equal(overlay.style.display, "none"); // NEW

    h.graph.setSelectionCell(h.weekSunLane); // NEW
    await nextTick(); // NEW
    assert.equal(overlay.style.display, "flex"); // NEW
    assert.equal(overlay.style.top, "369px"); // NEW
    assert.equal(overlay.style.flexDirection, "column"); // NEW
    assert.equal(overlay.style.alignItems, "stretch"); // NEW
    assert.ok(buttonByText(overlay, "Change Hours")); // NEW
    assert.ok(buttonByText(overlay, "Add Break")); // NEW
    assert.equal(buttonByText(overlay, "Close Day").style.display, ""); // NEW
    assert.equal(buttonByText(overlay, "Open Day").style.display, "none"); // NEW
}); // NEW

test("task manager day-lane overlay opens closes and adds breaks for selected day", async () => { // NEW
    const h = makeHarness(); // NEW
    const overlay = h.document.querySelector(".trellis-task-selected-day-lane-actions"); // NEW
    h.setState(h.weekSunLane, { x: 240, y: 28, width: 200, height: 320 }); // NEW
    h.graph.setSelectionCell(h.weekSunLane); // NEW
    await nextTick(); // NEW

    buttonByText(overlay, "Change Hours").click(); // NEW
    const timeInputs = Array.from(h.lastDialog.querySelectorAll("input[type='time']")); // NEW
    timeInputs[0].value = "07:00"; // NEW
    timeInputs[1].value = "10:30"; // NEW
    buttonByText(h.lastDialog, "Save").click(); // NEW
    await nextTick(); // NEW
    assert.deepEqual(selectedWeekOverrideDay(h, 0), { closed: false, startMinute: 420, endMinute: 630 }); // NEW

    buttonByText(overlay, "Close Day").click(); // NEW
    await nextTick(); // NEW
    assert.equal(selectedWeekOverrideDay(h, 0).closed, true); // NEW
    assert.equal(selectedWeekOverrideDay(h, 0).startMinute, 420); // NEW
    assert.equal(selectedWeekOverrideDay(h, 0).endMinute, 630); // NEW
    assert.equal(buttonByText(overlay, "Add Break").style.display, "none"); // NEW
    assert.equal(buttonByText(overlay, "Open Day").style.display, ""); // NEW

    buttonByText(overlay, "Open Day").click(); // NEW
    await nextTick(); // NEW
    assert.deepEqual(selectedWeekOverrideDay(h, 0), { closed: false, startMinute: 420, endMinute: 630 }); // CHANGE
    assert.equal(buttonByText(overlay, "Add Break").style.display, ""); // NEW

    buttonByText(overlay, "Add Break").click(); // NEW
    await nextTick(); // NEW
    assert.ok(h.weekSunLane.children.some(cell => attr(cell, "schedule_break") === "1")); // NEW
    assert.equal(buttonByText(overlay, "Close Day").style.display, "none"); // NEW
}); // NEW

test("task manager day-lane overlay hides open close on non-empty days and hides add break when closed", async () => { // NEW
    const h = makeHarness(); // NEW
    const overlay = h.document.querySelector(".trellis-task-selected-day-lane-actions"); // NEW
    h.setState(h.weekWedLane, { x: 460, y: 748, width: 200, height: 160 }); // NEW
    h.graph.setSelectionCell(h.weekWedLane); // NEW
    await nextTick(); // NEW

    assert.equal(buttonByText(overlay, "Add Break").style.display, ""); // NEW
    assert.equal(buttonByText(overlay, "Open Day").style.display, "none"); // NEW
    assert.equal(buttonByText(overlay, "Close Day").style.display, "none"); // NEW

    setAttr(h.board, "task_work_hours_week_overrides_json", JSON.stringify({ // NEW
        weeks: { "2026-07-12": { days: [{}, {}, {}, { closed: true }, {}, {}, {}] } } // NEW
    })); // NEW
    h.fireModelChange(); // NEW
    await nextTick(); // NEW

    assert.equal(buttonByText(overlay, "Add Break").style.display, "none"); // NEW
    assert.equal(buttonByText(overlay, "Open Day").style.display, "none"); // NEW
    assert.equal(buttonByText(overlay, "Close Day").style.display, "none"); // NEW
}); // NEW

test("task manager day-lane change hours dialog saves only selected weekday override", async () => { // NEW
    const h = makeHarness(); // NEW
    const overlay = h.document.querySelector(".trellis-task-selected-day-lane-actions"); // NEW
    h.setState(h.weekSunLane, { x: 240, y: 28, width: 200, height: 320 }); // NEW
    h.graph.setSelectionCell(h.weekSunLane); // NEW
    await nextTick(); // NEW

    buttonByText(overlay, "Change Hours").click(); // NEW
    const timeInputs = Array.from(h.lastDialog.querySelectorAll("input[type='time']")); // NEW
    timeInputs[0].value = "07:00"; // NEW
    timeInputs[1].value = "10:30"; // NEW
    buttonByText(h.lastDialog, "Save").click(); // NEW
    await nextTick(); // NEW

    assert.deepEqual(selectedWeekOverrideDay(h, 0), { closed: false, startMinute: 420, endMinute: 630 }); // NEW
    assert.equal(selectedWeekOverrideDay(h, 3).startMinute, 1020); // NEW
    assert.equal(selectedWeekOverrideDay(h, 3).endMinute, 1140); // NEW
}); // NEW

test("task manager day-lane vertical resize edits selected-week hours by moved edge", async () => { // NEW
    const h = makeHarness(); // NEW
    h.graph.setSelectionCell(h.weekWedLane); // NEW
    await nextTick(); // NEW

    let previousGeometry = h.weekWedLane.geometry.clone(); // NEW
    h.graph.resizeCells([h.weekWedLane]); // NEW
    h.weekWedLane.geometry.height += 80; // NEW
    h.fireModelChange({ changes: [h.geometryChange(h.weekWedLane, previousGeometry)] }); // NEW
    await nextTick(); // NEW
    assert.equal(selectedWeekOverrideDay(h, 3).startMinute, 1020); // NEW
    assert.equal(selectedWeekOverrideDay(h, 3).endMinute, 1200); // NEW

    previousGeometry = h.weekWedLane.geometry.clone(); // NEW
    h.graph.resizeCells([h.weekWedLane]); // NEW
    h.weekWedLane.geometry.y -= 40; // NEW
    h.weekWedLane.geometry.height += 40; // NEW
    h.fireModelChange({ changes: [h.geometryChange(h.weekWedLane, previousGeometry)] }); // NEW
    await nextTick(); // NEW
    assert.equal(selectedWeekOverrideDay(h, 3).startMinute, 990); // NEW
    assert.equal(selectedWeekOverrideDay(h, 3).endMinute, 1200); // NEW

    previousGeometry = h.weekWedLane.geometry.clone(); // NEW
    h.graph.resizeCells([h.weekWedLane]); // NEW
    h.weekWedLane.geometry.y -= 40; // NEW
    h.weekWedLane.geometry.height += 80; // NEW
    h.fireModelChange({ changes: [h.geometryChange(h.weekWedLane, previousGeometry)] }); // NEW
    await nextTick(); // NEW
    assert.equal(selectedWeekOverrideDay(h, 3).startMinute, 960); // NEW
    assert.equal(selectedWeekOverrideDay(h, 3).endMinute, 1230); // NEW
}); // NEW

test("task manager shrinking day-lane hours keeps cards visible and marks overflow", async () => { // NEW
    const h = makeHarness(); // NEW
    h.graph.setSelectionCell(h.weekWedLane); // NEW
    await nextTick(); // NEW

    const previousGeometry = h.weekWedLane.geometry.clone(); // NEW
    h.graph.resizeCells([h.weekWedLane]); // NEW
    h.weekWedLane.geometry.height -= 120; // NEW
    h.fireModelChange({ changes: [h.geometryChange(h.weekWedLane, previousGeometry)] }); // NEW
    await nextTick(); // NEW

    assert.equal(selectedWeekOverrideDay(h, 3).endMinute, 1050); // NEW
    assert.equal(h.weekLaneCard.visible, true); // NEW
    assert.match(h.weekLaneCard.style, /strokeColor=#B91C1C/); // NEW
}); // NEW

test("task manager overflow cards do not auto-expand day lanes or persist hours", async () => { // NEW
    const h = makeHarness(); // NEW
    h.graph.setSelectionCell(h.board); // NEW
    await nextTick(); // NEW
    const initialLaneHeight = h.weekWedLane.geometry.height; // NEW
    const overflowCard = addHarnessCard(h, h.weekWedLane, "overflowWedCard", { // NEW
        workflow_state: "TODO", // NEW
        assigned_day: "2026-07-15", // NEW
        start: "2026-07-15", // NEW
        end: "2026-07-15", // NEW
        task_estimated_hours: "2" // NEW
    }); // NEW

    h.fireModelChange({ changes: [h.childChange(overflowCard, null)] }); // NEW
    await nextTick(); // NEW
    const automaticGrowthPreviousGeometry = h.weekWedLane.geometry.clone(); // NEW
    h.weekWedLane.geometry.height += 160; // NEW
    h.fireModelChange({ changes: [h.geometryChange(h.weekWedLane, automaticGrowthPreviousGeometry)] }); // NEW
    await nextTick(); // NEW

    assert.equal(h.weekWedLane.geometry.height, initialLaneHeight); // NEW
    assert.equal(attr(h.board, "task_work_hours_week_overrides_json"), null); // NEW
    assert.equal(overflowCard.visible, true); // NEW
    assert.equal(attr(overflowCard, "schedule_start_minute"), "1080"); // NEW
    assert.equal(attr(overflowCard, "schedule_duration_minutes"), "120"); // NEW
    assert.match(overflowCard.style, /strokeColor=#B91C1C/); // NEW
}); // NEW

test("task manager week selection only reflows when active day changes", async () => { // NEW
    const h = makeHarness(); // NEW
    h.graph.setSelectionCell(h.weekTueCard); // NEW
    await nextTick(); // NEW

    assert.equal(attr(h.board, "task_selected_day"), "2026-07-14"); // NEW
    assert.ok(h.geometrySetCount > 0); // NEW

    h.resetCounters(); // NEW
    h.graph.setSelectionCell(h.weekTueCard2); // NEW
    await nextTick(); // NEW

    const counters = h.reflowCounters(); // NEW
    assert.equal(attr(h.board, "task_selected_day"), "2026-07-14"); // NEW
    assert.equal(h.geometrySetCount, 0); // NEW
    assert.equal(h.labelSetCount, 0); // NEW
    assert.equal(counters.badges, 1); // NEW
    assert.equal(counters.classification, 0); // NEW
    assert.equal(counters.layout, 0); // NEW
    assert.equal(counters.lanes, 0); // NEW
    assert.equal(counters.boardLayout, 0); // NEW
    assert.equal(counters.schedulePack, 0); // NEW
    assert.ok(counters.labelWriteSkip > 0); // NEW
}); // NEW

test("task manager note-only edits refresh badges without layout", async () => { // NEW
    const h = makeHarness(); // NEW
    const overlay = h.document.querySelector(".trellis-task-selected-card-actions"); // NEW
    h.setState(h.card1, { x: 30, y: 60, width: 120, height: 60 }); // NEW
    h.graph.setSelectionCell(h.card1); // NEW
    await nextTick(); // NEW

    h.resetCounters(); // NEW
    buttonByText(overlay, "Clear Note").click(); // NEW
    await nextTick(); // NEW

    const counters = h.reflowCounters(); // NEW
    assert.equal(attr(h.card1, "card_note"), null); // NEW
    assert.equal(h.geometrySetCount, 0); // NEW
    assert.equal(counters.classification, 0); // NEW
    assert.equal(counters.layout, 0); // NEW
    assert.equal(counters.lanes, 0); // NEW
    assert.equal(counters.boardLayout, 0); // NEW
    assert.equal(counters.schedulePack, 0); // NEW
    assert.equal(h.card1.parent, h.todoLane); // NEW
    assert.doesNotMatch(attr(h.card1, "label"), /<b>Note:<\/b>/); // NEW
}); // NEW

test("task manager unchanged badge refresh skips label rewrites", async () => { // NEW
    const h = makeHarness(); // NEW
    h.graph.setSelectionCell(h.weekTueCard); // NEW
    await nextTick(); // NEW

    h.resetCounters(); // NEW
    h.graph.setSelectionCell(h.weekTueCard2); // NEW
    await nextTick(); // NEW

    const counters = h.reflowCounters(); // NEW
    assert.equal(attr(h.board, "task_selected_day"), "2026-07-14"); // NEW
    assert.equal(h.geometrySetCount, 0); // NEW
    assert.equal(h.labelSetCount, 0); // NEW
    assert.ok(counters.labelWriteSkip > 0); // NEW
}); // NEW

test("task manager restores staged card style when week card is dragged back to staged", async () => { // NEW
    const h = makeHarness(); // NEW
    h.weekLaneCard.setStyle("whiteSpace=wrap;html=1;fillColor=#D5E8D4;strokeColor=#000000;customFlag=keep;"); // NEW
    setAttr(h.weekLaneCard, "workflow_state", "DONE"); // NEW
    setAttr(h.weekLaneCard, "completed", "2026-07-15"); // NEW
    setAttr(h.weekLaneCard, "schedule_start_minute", "360"); // NEW
    setAttr(h.weekLaneCard, "schedule_duration_minutes", "120"); // NEW
    h.weekLaneCard.geometry.height = 160; // NEW

    h.resetCounters(); // NEW
    h.graph.moveCells([h.weekLaneCard], 0, 0, false, h.stagedLane); // NEW
    await nextTick(); // NEW

    const counters = h.reflowCounters(); // NEW
    assert.equal(h.stagedLane.children.includes(h.weekLaneCard), true); // NEW
    assert.equal(attr(h.weekLaneCard, "workflow_state"), "STAGED"); // NEW
    assert.equal(attr(h.weekLaneCard, "assigned_day"), null); // NEW
    assert.equal(attr(h.weekLaneCard, "completed"), null); // NEW
    assert.equal(attr(h.weekLaneCard, "manual_staged"), "1"); // NEW
    assert.equal(h.weekLaneCard.geometry.height, 80); // NEW
    assert.equal(attr(h.weekLaneCard, "schedule_start_minute"), "360"); // NEW
    assert.equal(attr(h.weekLaneCard, "schedule_duration_minutes"), "120"); // NEW
    assert.match(h.weekLaneCard.style, /fillColor=swimlane/); // NEW
    assert.match(h.weekLaneCard.style, /customFlag=keep/); // NEW
    assert.doesNotMatch(h.weekLaneCard.style, /fillColor=#D5E8D4/); // NEW
    assert.doesNotMatch(h.weekLaneCard.style, /strokeColor=#000000/); // NEW
    assert.ok(counters.classification > 0); // NEW
    assert.ok(counters.lanes > 0); // NEW
    assert.ok(counters.layout > 0); // NEW
}); // NEW

test("task manager toggles destination view labels, arrows, and board selection", async () => { // CHANGE
    const h = makeHarness(); // NEW
    const boardOverlay = h.document.querySelector(".trellis-task-board-header-controls"); // NEW
    h.setState(h.board, { x: 10, y: 10, width: 700, height: 260 }); // NEW
    h.graph.setSelectionCell(h.board); // NEW
    await nextTick(); // NEW

    assert.equal(boardOverlay.firstChild.textContent, "Mode: Week"); // NEW
    assert.equal(modeToggleButton(boardOverlay).textContent, "Switch to Full view"); // CHANGE
    assert.equal(modeToggleButton(boardOverlay).getAttribute("aria-pressed"), "true"); // NEW
    assert.equal(buttonByText(boardOverlay, "<").style.display, ""); // NEW
    assert.equal(buttonByText(boardOverlay, ">").style.display, ""); // NEW
    assert.equal(buttonByText(boardOverlay, "This Week").style.display, ""); // NEW

    modeToggleButton(boardOverlay).click(); // CHANGE
    await nextTick(); // NEW

    assert.equal(attr(h.board, "task_view_mode"), "FULL"); // NEW
    assert.equal(h.graph.getSelectionCell(), h.board); // NEW
    assert.equal(boardOverlay.firstChild.textContent, "Mode: Full"); // NEW
    assert.equal(modeToggleButton(boardOverlay).textContent, "Switch to Week view"); // CHANGE
    assert.equal(modeToggleButton(boardOverlay).getAttribute("aria-pressed"), "false"); // NEW
    assert.equal(buttonByText(boardOverlay, "<").style.display, "none"); // NEW
    assert.equal(buttonByText(boardOverlay, ">").style.display, "none"); // NEW
    assert.equal(buttonByText(boardOverlay, "Today").style.display, "none"); // NEW

    modeToggleButton(boardOverlay).click(); // NEW
    await nextTick(); // NEW

    assert.equal(attr(h.board, "task_view_mode"), "WEEK"); // NEW
    assert.equal(boardOverlay.firstChild.textContent, "Mode: Week"); // NEW
    assert.equal(modeToggleButton(boardOverlay).textContent, "Switch to Full view"); // CHANGE
    assert.equal(buttonByText(boardOverlay, "<").style.display, ""); // NEW
    assert.equal(buttonByText(boardOverlay, ">").style.display, ""); // NEW

    h.setState(h.weekWedLane, { x: 460, y: 40, width: 200, height: 960 }); // NEW
    h.graph.setSelectionCell(h.weekWedLane); // NEW
    await nextTick(); // NEW

    assert.equal(h.graph.getSelectionCell(), h.weekWedLane); // NEW
    modeToggleButton(boardOverlay).click(); // NEW
    await nextTick(); // NEW

    assert.equal(attr(h.board, "task_view_mode"), "FULL"); // NEW
    assert.equal(h.graph.getSelectionCell(), h.board); // NEW
    assert.equal(boardOverlay.style.display, "flex"); // NEW
    assert.equal(boardOverlay.firstChild.textContent, "Mode: Full"); // NEW
    assert.equal(modeToggleButton(boardOverlay).textContent, "Switch to Week view"); // CHANGE
}); // NEW

test("task manager week day cards show workflow colors and time badge", async () => { // NEW
    const h = makeHarness(); // NEW
    h.graph.setSelectionCell(h.weekWedLane); // NEW
    await nextTick(); // NEW

    assert.match(h.weekLaneCard.style, /fillColor=#F8CECC/); // NEW
    assert.match(attr(h.weekLaneCard, "label"), /<b>Time:<\/b> 5:00 PM-6:00 PM/); // CHANGE

    setAttr(h.weekLaneCard, "workflow_state", "DOING"); // NEW
    setAttr(h.board, "task_selected_day", "2026-07-12"); // NEW
    h.graph.setSelectionCell(h.weekWedLane); // NEW
    await nextTick(); // NEW
    assert.match(h.weekLaneCard.style, /fillColor=#FFF2CC/); // NEW

    setAttr(h.weekLaneCard, "workflow_state", "DONE"); // NEW
    setAttr(h.board, "task_selected_day", "2026-07-12"); // NEW
    h.graph.setSelectionCell(h.weekWedLane); // NEW
    await nextTick(); // NEW
    assert.match(h.weekLaneCard.style, /fillColor=#D5E8D4/); // NEW
}); // NEW

test("task manager adds break cards and derives stacked schedule attributes", async () => { // NEW
    const h = makeHarness(); // NEW
    const boardOverlay = h.document.querySelector(".trellis-task-board-header-controls"); // NEW
    h.setState(h.board, { x: 10, y: 10, width: 700, height: 260 }); // NEW
    h.setState(h.weekWedLane, { x: 460, y: 40, width: 200, height: 960 }); // NEW
    h.graph.setSelectionCell(h.weekWedLane); // NEW
    await nextTick(); // NEW

    buttonByText(boardOverlay, "Add Break").click(); // NEW
    await nextTick(); // NEW

    const breakCard = h.weekWedLane.children.find(cell => attr(cell, "schedule_break") === "1"); // NEW
    assert.ok(breakCard); // NEW
    assert.equal(attr(breakCard, "assigned_day"), "2026-07-15"); // NEW
    assert.equal(attr(breakCard, "schedule_duration_minutes"), "30"); // NEW
    assert.equal(attr(h.weekLaneCard, "schedule_start_minute"), "1020"); // CHANGE
    assert.equal(attr(breakCard, "schedule_start_minute"), "1080"); // CHANGE
    assert.match(attr(breakCard, "label"), /<b>Time:<\/b> 6:00 PM-6:30 PM/); // CHANGE
    assert.match(breakCard.style, /fillColor=#F3F4F6/); // NEW
    assert.match(breakCard.style, /strokeColor=#6B7280/); // NEW
}); // NEW

test("task manager hides day-owned breaks outside their visible week", async () => { // NEW
    const h = makeHarness(); // NEW
    const boardOverlay = h.document.querySelector(".trellis-task-board-header-controls"); // NEW
    h.graph.setSelectionCell(h.weekWedLane); // NEW
    await nextTick(); // NEW
    buttonByText(boardOverlay, "Add Break").click(); // NEW
    await nextTick(); // NEW
    const breakCard = h.weekWedLane.children.find(cell => attr(cell, "schedule_break") === "1"); // NEW
    assert.equal(attr(breakCard, "assigned_day"), "2026-07-15"); // NEW

    setAttr(h.board, "task_selected_week_start", "2026-07-19"); // NEW
    setAttr(h.board, "task_selected_day", "2026-07-22"); // NEW
    h.graph.setSelectionCell(h.board); // CHANGE
    await nextTick(); // NEW

    assert.equal(breakCard.visible, false); // NEW
    assert.equal(attr(breakCard, "schedule_start_minute"), null); // NEW
    assert.equal(attr(breakCard, "schedule_duration_minutes"), "30"); // NEW

    setAttr(h.board, "task_selected_week_start", "2026-07-12"); // NEW
    setAttr(h.board, "task_selected_day", "2026-07-15"); // NEW
    h.graph.setSelectionCell(h.board); // CHANGE
    await nextTick(); // NEW
    assert.equal(breakCard.visible, true); // NEW
    assert.equal(h.weekWedLane.children.indexOf(h.weekLaneCard) < h.weekWedLane.children.indexOf(breakCard), true); // CHANGE
    assert.equal(attr(h.weekLaneCard, "schedule_start_minute"), "1020"); // CHANGE
    assert.equal(attr(breakCard, "schedule_start_minute"), "1080"); // CHANGE
    assert.equal(attr(breakCard, "schedule_duration_minutes"), "30"); // NEW
    assert.match(attr(breakCard, "label"), /<b>Time:<\/b> 6:00 PM-6:30 PM/); // CHANGE
    assert.equal(attr(breakCard, "schedule_order"), "1"); // NEW
    assert.equal(attr(breakCard, "schedule_order_day"), "2026-07-15"); // NEW
}); // NEW

test("task manager same-lane reorder refreshes persisted schedule order", async () => { // NEW
    const h = makeHarness(); // NEW
    const boardOverlay = h.document.querySelector(".trellis-task-board-header-controls"); // NEW
    h.graph.setSelectionCell(h.weekWedLane); // NEW
    await nextTick(); // NEW
    buttonByText(boardOverlay, "Add Break").click(); // NEW
    await nextTick(); // NEW
    const breakCard = h.weekWedLane.children.find(cell => attr(cell, "schedule_break") === "1"); // NEW
    h.weekWedLane.children = [breakCard, h.weekLaneCard]; // NEW
    h.fireModelChange({ changes: [h.childChange(breakCard, h.weekWedLane)] }); // NEW
    await nextTick(); // NEW

    assert.equal(attr(breakCard, "schedule_start_minute"), "1020"); // CHANGE
    assert.equal(attr(h.weekLaneCard, "schedule_start_minute"), "1050"); // CHANGE
    assert.equal(attr(breakCard, "schedule_order"), "0"); // NEW
    assert.equal(attr(h.weekLaneCard, "schedule_order"), "1"); // NEW
}); // NEW

test("task manager migrates existing undated breaks to the visible lane date", async () => { // NEW
    const h = makeHarness(); // NEW
    const boardOverlay = h.document.querySelector(".trellis-task-board-header-controls"); // NEW
    h.graph.setSelectionCell(h.weekWedLane); // NEW
    await nextTick(); // NEW
    buttonByText(boardOverlay, "Add Break").click(); // NEW
    await nextTick(); // NEW
    const breakCard = h.weekWedLane.children.find(cell => attr(cell, "schedule_break") === "1"); // NEW
    setAttr(breakCard, "assigned_day", null); // NEW

    h.graph.setSelectionCell(h.board); // CHANGE
    await nextTick(); // NEW

    assert.equal(attr(breakCard, "assigned_day"), "2026-07-15"); // NEW
    assert.equal(breakCard.visible, true); // NEW
}); // NEW

test("task manager allocates selected staged cards to clamped start dates", async () => { // NEW
    const h = makeHarness(); // NEW
    const overlay = h.document.querySelector(".trellis-task-selected-card-actions"); // NEW
    [h.stagedCard, h.stagedBeforeCard, h.stagedAfterCard, h.stagedInvalidCard].forEach((card, index) => { // NEW
        h.setState(card, { x: 30, y: 60 + (index * 70), width: 120, height: 60 }); // NEW
    }); // NEW
    h.graph.setSelectionCells([h.stagedCard, h.stagedBeforeCard, h.stagedAfterCard, h.stagedInvalidCard]); // NEW
    await nextTick(); // NEW

    const allocateButton = buttonByText(overlay, "Allocate to Start Dates"); // NEW
    assert.ok(allocateButton); // NEW
    assert.equal(allocateButton.style.display, ""); // NEW

    allocateButton.click(); // NEW
    await nextTick(); // NEW

    assert.equal(h.weekTueLane.children.includes(h.stagedCard), true); // NEW
    assert.equal(h.weekSunLane.children.includes(h.stagedBeforeCard), true); // NEW
    assert.equal(h.weekSatLane.children.includes(h.stagedAfterCard), true); // NEW
    assert.equal(h.stagedLane.children.includes(h.stagedInvalidCard), true); // NEW
    assert.equal(attr(h.stagedCard, "workflow_state"), "TODO"); // NEW
    assert.equal(attr(h.stagedCard, "assigned_day"), "2026-07-14"); // NEW
    assert.equal(attr(h.stagedBeforeCard, "assigned_day"), "2026-07-12"); // NEW
    assert.equal(attr(h.stagedAfterCard, "assigned_day"), "2026-07-18"); // NEW
    assert.equal(attr(h.stagedInvalidCard, "workflow_state"), "STAGED"); // NEW

    h.setState(h.weekLaneCard, { x: 470, y: 60, width: 120, height: 60 }); // NEW
    h.graph.setSelectionCells([h.stagedInvalidCard, h.weekLaneCard]); // NEW
    await nextTick(); // NEW
    assert.equal(buttonByText(overlay, "Allocate to Start Dates").style.display, "none"); // NEW
}); // NEW

test("task manager direct day-lane resize persists selected weekday width", async () => { // NEW
    const h = makeHarness(); // NEW
    const boardOverlay = h.document.querySelector(".trellis-task-board-header-controls"); // NEW
    h.graph.setSelectionCell(h.weekWedLane); // NEW
    await nextTick(); // NEW
    buttonByText(boardOverlay, "Add Break").click(); // NEW
    await nextTick(); // NEW
    const breakCard = h.weekWedLane.children.find(cell => attr(cell, "schedule_break") === "1"); // NEW

    const previousGeometry = h.weekWedLane.geometry.clone(); // NEW
    h.weekWedLane.geometry.width = 1200; // CHANGE
    h.fireModelChange({ changes: [h.geometryChange(h.weekWedLane, previousGeometry)] }); // CHANGE
    await nextTick(); // NEW

    const widths = JSON.parse(attr(h.board, "task_day_lane_widths_json")).widths; // NEW
    assert.equal(widths.WEEK_WED, 1200); // CHANGE
    assert.equal(widths.WEEK_TUE, 220); // NEW
    assert.equal(h.weekWedLane.geometry.width, 1200); // CHANGE
    assert.equal(h.weekLaneCard.geometry.x, 10); // NEW
    assert.equal(h.weekLaneCard.geometry.width, 1180); // NEW
    assert.equal(breakCard.geometry.x, 10); // NEW
    assert.equal(breakCard.geometry.width, 1180); // NEW
    assert.equal(h.stagedLane.geometry.width, 220); // NEW
    assert.equal(h.board.geometry.width, 2944); // CHANGE
}); // NEW

test("task manager rejects direct horizontal day-card geometry changes", async () => { // NEW
    const h = makeHarness(); // NEW
    h.graph.setSelectionCell(h.board); // NEW
    await nextTick(); // NEW
    const expectedDuration = attr(h.weekLaneCard, "schedule_duration_minutes"); // NEW
    const previousGeometry = h.weekLaneCard.geometry.clone(); // NEW

    h.weekLaneCard.geometry.x = 45; // NEW
    h.weekLaneCard.geometry.width = 70; // NEW
    h.fireModelChange({ changes: [h.geometryChange(h.weekLaneCard, previousGeometry)] }); // NEW
    await nextTick(); // NEW

    assert.equal(h.weekLaneCard.geometry.x, 10); // NEW
    assert.equal(h.weekLaneCard.geometry.width, h.weekWedLane.geometry.width - 20); // NEW
    assert.equal(attr(h.weekLaneCard, "schedule_duration_minutes"), expectedDuration); // NEW
    assert.equal(attr(h.board, "task_day_lane_widths_json"), null); // NEW
}); // NEW

test("task manager ignores week-lane layout geometry when width is unchanged", async () => { // NEW
    const h = makeHarness(); // NEW
    await nextTick(); // NEW
    h.resetCounters(); // NEW

    const previousGeometry = h.weekWedLane.geometry.clone(); // NEW
    h.weekWedLane.geometry.x += 40; // NEW
    h.fireModelChange({ changes: [h.geometryChange(h.weekWedLane, previousGeometry)] }); // NEW
    await nextTick(); // NEW

    assert.equal(attr(h.board, "task_day_lane_widths_json"), null); // NEW
    assert.equal(attr(h.board, "task_work_hours_week_overrides_json"), null); // NEW
    assert.equal(h.reflowCounters().layout, 0); // NEW
}); // NEW

test("task manager replaces legacy board layout ownership with canonical managed styles", async () => { // NEW
    const h = makeHarness(); // NEW
    assert.match(h.board.style, /(?:^|;)childLayout=stackLayout(?:;|$)/); // NEW
    assert.match(h.board.style, /(?:^|;)swimlaneFillColor=none(?:;|$)/); // NEW

    h.graph.setSelectionCell(h.board); // NEW
    await nextTick(); // NEW

    assert.match(h.board.style, /(?:^|;)swimlaneFillColor=#F8FAFC(?:;|$)/); // NEW
    assert.doesNotMatch(h.board.style, /(?:^|;)swimlaneFillColor=none(?:;|$)/); // NEW
    assert.doesNotMatch(h.board.style, /(?:^|;)childLayout=/); // NEW
    assert.doesNotMatch(h.board.style, /(?:^|;)horizontalStack=/); // NEW
    assert.doesNotMatch(h.board.style, /(?:^|;)resizeParent(?:Max)?=/); // NEW
    assert.doesNotMatch(h.board.style, /(?:^|;)resizeLast=/); // NEW
    assert.doesNotMatch(h.board.style, /(?:^|;)stackBorder=/); // NEW
    assert.match(h.board.style, /(?:^|;)resizable=1(?:;|$)/); // NEW
    h.board.children.filter(cell => attr(cell, "lane_key") && !String(attr(cell, "lane_key")).startsWith("WEEK_")).forEach(lane => { // CHANGE
        assert.match(lane.style, /(?:^|;)childLayout=stackLayout(?:;|$)/); // NEW
        assert.match(lane.style, /(?:^|;)horizontalStack=0(?:;|$)/); // NEW
        assert.match(lane.style, /(?:^|;)resizeParent=0(?:;|$)/); // NEW
        assert.doesNotMatch(lane.style, /(?:^|;)resizeParent=1(?:;|$)/); // NEW
    }); // NEW
    [h.weekSunLane, h.weekWedLane].forEach(lane => { // NEW
        assert.doesNotMatch(lane.style, /(?:^|;)childLayout=stackLayout(?:;|$)/); // NEW
        assert.match(lane.style, /(?:^|;)resizeParent=0(?:;|$)/); // NEW
    }); // NEW
    assert.match(h.weekSunLane.style, /(?:^|;)collapsible=0(?:;|$)/); // NEW
    assert.match(h.weekWedLane.style, /(?:^|;)collapsible=0(?:;|$)/); // NEW
    assert.match(h.stagedLane.style, /(?:^|;)collapsible=1(?:;|$)/); // NEW
    assert.match(h.todoLane.style, /(?:^|;)collapsible=1(?:;|$)/); // NEW
}); // NEW

test("task manager full-mode board resize persists lane height and refreshes paging", async () => { // NEW
    const h = makeHarness(); // NEW
    setAttr(h.board, "task_view_mode", "FULL"); // NEW
    h.graph.setSelectionCell(h.board); // NEW
    await nextTick(); // NEW
    for (let i = 0; i < 4; i++) addHarnessCard(h, h.todoLane, `todoExtra${i}`, { workflow_state: "TODO", start: `2026-07-${10 + i}` }); // NEW
    setAttr(h.todoLane, "page_index", "5"); // NEW
    h.resetCounters(); // NEW

    const previousGeometry = h.board.geometry.clone(); // NEW
    h.board.geometry.height = 324; // NEW
    h.fireModelChange({ changes: [h.geometryChange(h.board, previousGeometry)] }); // NEW
    await nextTick(); // NEW

    const visibleTodoCards = h.todoLane.children.filter(cell => attr(cell, "kanban_card") === "1" && cell.visible !== false); // NEW
    const counters = h.reflowCounters(); // NEW
    assert.equal(attr(h.board, "task_full_lane_height"), "286"); // NEW
    assert.equal(h.stagedLane.geometry.height, 286); // NEW
    assert.equal(h.todoLane.geometry.height, 286); // NEW
    assert.equal(h.doingLane.geometry.height, 286); // NEW
    assert.equal(h.board.geometry.height, 324); // NEW
    assert.equal(attr(h.todoLane, "page_index"), "2"); // CHANGE
    assert.equal(visibleTodoCards.length, 3); // NEW
    assert.equal(counters.classification, 0); // NEW
    assert.ok(counters.layout > 0); // NEW
    assert.ok(counters.lanes > 0); // NEW
    assert.ok(counters.boardLayout > 0); // NEW
}); // NEW

test("task manager keeps week schedule height separate from full-view card height", async () => { // NEW
    const h = makeHarness(); // NEW
    const boardOverlay = h.document.querySelector(".trellis-task-board-header-controls"); // NEW
    h.graph.setSelectionCell(h.weekWedLane); // NEW
    await nextTick(); // NEW

    const previousWeekGeometry = h.weekLaneCard.geometry.clone(); // NEW
    h.weekLaneCard.geometry.height = 160; // NEW
    h.fireModelChange({ changes: [h.geometryChange(h.weekLaneCard, previousWeekGeometry)] }); // NEW
    await nextTick(); // NEW

    assert.equal(attr(h.weekLaneCard, "schedule_duration_minutes"), "120"); // NEW
    assert.equal(attr(h.weekLaneCard, "task_full_card_height"), null); // NEW

    h.graph.setSelectionCell(h.board); // NEW
    await nextTick(); // NEW
    modeToggleButton(boardOverlay).click(); // NEW
    await nextTick(); // NEW

    assert.equal(attr(h.board, "task_view_mode"), "FULL"); // NEW
    assert.equal(h.weekLaneCard.parent, h.todoLane); // NEW
    assert.equal(h.weekLaneCard.geometry.height, 80); // NEW
    assert.equal(attr(h.weekLaneCard, "task_full_card_height"), null); // NEW
    assert.equal(attr(h.weekLaneCard, "schedule_duration_minutes"), "120"); // NEW

    const previousFullGeometry = h.weekLaneCard.geometry.clone(); // NEW
    h.weekLaneCard.geometry.height = 140; // NEW
    h.fireModelChange({ changes: [h.geometryChange(h.weekLaneCard, previousFullGeometry)] }); // NEW
    await nextTick(); // NEW

    assert.equal(attr(h.weekLaneCard, "task_full_card_height"), "140"); // NEW
    assert.equal(h.weekLaneCard.geometry.height, 140); // NEW

    modeToggleButton(boardOverlay).click(); // NEW
    await nextTick(); // NEW

    assert.equal(attr(h.board, "task_view_mode"), "WEEK"); // NEW
    assert.equal(h.weekLaneCard.parent, h.weekWedLane); // NEW
    assert.equal(h.weekLaneCard.geometry.height, 160); // NEW
    assert.equal(attr(h.weekLaneCard, "schedule_duration_minutes"), "120"); // NEW
    assert.equal(attr(h.weekLaneCard, "task_full_card_height"), "140"); // NEW

    modeToggleButton(boardOverlay).click(); // NEW
    await nextTick(); // NEW

    assert.equal(attr(h.board, "task_view_mode"), "FULL"); // NEW
    assert.equal(h.weekLaneCard.parent, h.todoLane); // NEW
    assert.equal(h.weekLaneCard.geometry.height, 140); // NEW
}); // NEW

test("task manager migrates existing full-view card height without using week schedule height", async () => { // NEW
    const h = makeHarness(); // NEW
    setAttr(h.board, "task_view_mode", "FULL"); // NEW
    h.card1.geometry.height = 132; // NEW

    h.graph.setSelectionCell(h.board); // NEW
    await nextTick(); // NEW

    assert.equal(attr(h.card1, "task_full_card_height"), "132"); // NEW
    assert.equal(h.card1.geometry.height, 132); // NEW
}); // NEW

test("task manager week-mode board resize expands staged lane only", async () => { // CHANGE
    const h = makeHarness(); // NEW
    h.graph.setSelectionCell(h.board); // NEW
    await nextTick(); // NEW
    const expectedDayLaneHeight = h.weekWedLane.geometry.height; // CHANGE
    h.resetCounters(); // NEW

    const previousGeometry = h.board.geometry.clone(); // NEW
    h.board.geometry.height = 1600; // NEW
    h.fireModelChange({ changes: [h.geometryChange(h.board, previousGeometry)] }); // NEW
    await nextTick(); // NEW

    const heights = JSON.parse(attr(h.board, "task_week_board_heights_json")).weeks; // NEW
    const counters = h.reflowCounters(); // NEW
    assert.equal(heights["2026-07-12"], 1600); // NEW
    assert.equal(attr(h.board, "task_full_lane_height"), null); // NEW
    assert.equal(h.weekWedLane.geometry.height, expectedDayLaneHeight); // CHANGE
    assert.equal(h.stagedLane.geometry.height, 1542); // CHANGE
    assert.equal(h.board.geometry.height, 1600); // CHANGE
    assert.ok(counters.layout > 0); // NEW
    assert.ok(counters.boardLayout > 0); // NEW
}); // CHANGE

test("task manager week-mode board resize clamps below tallest day lane", async () => { // NEW
    const h = makeHarness(); // NEW
    h.graph.setSelectionCell(h.board); // NEW
    await nextTick(); // NEW
    const expectedDayLaneHeight = h.weekWedLane.geometry.height; // NEW
    const expectedMinimumBoardHeight = h.board.geometry.height; // NEW

    const previousGeometry = h.board.geometry.clone(); // NEW
    h.board.geometry.height = 100; // NEW
    h.fireModelChange({ changes: [h.geometryChange(h.board, previousGeometry)] }); // NEW
    await nextTick(); // NEW

    assert.equal(h.weekWedLane.geometry.height, expectedDayLaneHeight); // NEW
    assert.equal(h.board.geometry.height, expectedMinimumBoardHeight); // NEW
    assert.ok(h.board.geometry.height >= h.weekWedLane.geometry.y + h.weekWedLane.geometry.height + 10); // NEW
}); // NEW

test("task manager week-mode board height is restored per selected week", async () => { // NEW
    const h = makeHarness(); // NEW
    h.graph.setSelectionCell(h.board); // NEW
    await nextTick(); // NEW
    const defaultBoardHeight = h.board.geometry.height; // NEW

    const previousGeometry = h.board.geometry.clone(); // NEW
    h.board.geometry.height = 1600; // NEW
    h.fireModelChange({ changes: [h.geometryChange(h.board, previousGeometry)] }); // NEW
    await nextTick(); // NEW
    assert.equal(h.board.geometry.height, 1600); // NEW

    setAttr(h.board, "task_selected_week_start", "2026-07-19"); // NEW
    setAttr(h.board, "task_selected_day", "2026-07-19"); // NEW
    h.graph.setSelectionCell(h.board); // NEW
    await nextTick(); // NEW
    assert.equal(h.board.geometry.height, defaultBoardHeight); // NEW
    assert.equal(h.stagedLane.geometry.height, 880); // CHANGE

    setAttr(h.board, "task_selected_week_start", "2026-07-12"); // NEW
    setAttr(h.board, "task_selected_day", "2026-07-12"); // NEW
    h.graph.setSelectionCell(h.board); // NEW
    await nextTick(); // NEW
    assert.equal(h.board.geometry.height, 1600); // NEW
    assert.equal(h.stagedLane.geometry.height, 1542); // CHANGE
}); // NEW

test("task manager restores persisted full-mode board height after week mode", async () => { // NEW
    const h = makeHarness(); // NEW
    const boardOverlay = h.document.querySelector(".trellis-task-board-header-controls"); // NEW
    setAttr(h.board, "task_view_mode", "FULL"); // NEW
    setAttr(h.board, "task_full_lane_height", "300"); // NEW
    h.graph.setSelectionCell(h.board); // NEW
    await nextTick(); // NEW

    assert.equal(h.todoLane.geometry.height, 300); // NEW
    assert.equal(h.board.geometry.height, 338); // NEW
    modeToggleButton(boardOverlay).click(); // CHANGE
    await nextTick(); // NEW
    assert.equal(attr(h.board, "task_view_mode"), "WEEK"); // NEW
    assert.ok(h.weekSunLane.geometry.height > 300); // CHANGE
    assert.notEqual(h.board.geometry.height, 338); // NEW

    modeToggleButton(boardOverlay).click(); // CHANGE
    await nextTick(); // NEW
    assert.equal(attr(h.board, "task_view_mode"), "FULL"); // NEW
    assert.equal(h.todoLane.geometry.height, 300); // NEW
    assert.equal(h.board.geometry.height, 338); // NEW
}); // NEW

test("task manager closed week days label closed and clear schedule attributes", async () => { // NEW
    const h = makeHarness(); // NEW
    const originalY = h.weekLaneCard.geometry.y; // NEW
    const originalHeight = h.weekLaneCard.geometry.height; // NEW
    h.weekLaneCard.geometry.x = 70; // NEW
    h.weekLaneCard.geometry.width = 65; // NEW
    setAttr(h.weekLaneCard, "schedule_start_minute", "360"); // NEW
    setAttr(h.weekLaneCard, "schedule_duration_minutes", "60"); // NEW
    setAttr(h.board, "task_work_hours_week_overrides_json", JSON.stringify({ // NEW
        weeks: { "2026-07-12": { days: [{}, {}, {}, { closed: true }, {}, {}, {}] } } // NEW
    })); // NEW

    h.graph.setSelectionCell(h.weekWedLane); // NEW
    await nextTick(); // NEW

    assert.match(attr(h.weekWedLane, "label"), /closed/); // NEW
    assert.equal(attr(h.weekLaneCard, "schedule_start_minute"), null); // NEW
    assert.equal(attr(h.weekLaneCard, "schedule_duration_minutes"), null); // NEW
    assert.equal(h.weekLaneCard.geometry.x, 10); // NEW
    assert.equal(h.weekLaneCard.geometry.width, h.weekWedLane.geometry.width - 20); // NEW
    assert.equal(h.weekLaneCard.geometry.y, originalY); // NEW
    assert.equal(h.weekLaneCard.geometry.height, originalHeight); // NEW
}); // NEW

test("task manager all-closed week hides time scale and keeps day lanes compact", async () => { // NEW
    const h = makeHarness(); // NEW
    setAttr(h.board, "task_work_hours_week_overrides_json", JSON.stringify({ // NEW
        weeks: { "2026-07-12": { days: [{ closed: true }, { closed: true }, { closed: true }, { closed: true }, { closed: true }, { closed: true }, { closed: true }] } } // NEW
    })); // NEW
    h.graph.setSelectionCell(h.board); // NEW
    await nextTick(); // NEW

    const timeScaleOverlay = h.document.querySelector(".trellis-task-week-time-scale"); // NEW
    assert.equal(timeScaleOverlay.style.display, "none"); // NEW
    assert.equal(h.weekSunLane.geometry.y, 48); // CHANGE
    assert.equal(h.weekWedLane.geometry.y, 48); // CHANGE
    assert.equal(h.weekSunLane.geometry.height, 20); // NEW
    assert.equal(h.weekWedLane.geometry.height, 20); // NEW
    assert.equal(h.stagedLane.geometry.height, 20); // NEW
    assert.equal(h.board.geometry.height, 78); // CHANGE
}); // NEW

test("task manager edit hours shifts existing day stack and marks overflow", async () => { // NEW
    const h = makeHarness(); // NEW
    const boardOverlay = h.document.querySelector(".trellis-task-board-header-controls"); // NEW
    h.graph.setSelectionCell(h.weekWedLane); // NEW
    await nextTick(); // NEW
    buttonByText(boardOverlay, "Add Break").click(); // NEW
    await nextTick(); // NEW
    const breakCard = h.weekWedLane.children.find(cell => attr(cell, "schedule_break") === "1"); // NEW
    const originalOrder = h.weekWedLane.children.map(cell => cell.id).join(","); // NEW

    h.resetCounters(); // NEW
    saveSelectedWeekDayHours(h, 3, "08:00", "09:00"); // NEW
    await nextTick(); // NEW

    const counters = h.reflowCounters(); // NEW
    assert.equal(h.weekWedLane.children.map(cell => cell.id).join(","), originalOrder); // NEW
    assert.equal(attr(h.weekLaneCard, "schedule_start_minute"), "480"); // NEW
    assert.equal(attr(h.weekLaneCard, "schedule_duration_minutes"), "60"); // NEW
    assert.equal(attr(breakCard, "schedule_start_minute"), "540"); // NEW
    assert.equal(attr(breakCard, "schedule_duration_minutes"), "30"); // NEW
    assert.match(attr(h.weekLaneCard, "label"), /<b>Time:<\/b> 8:00 AM-9:00 AM/); // NEW
    assert.match(attr(breakCard, "label"), /<b>Time:<\/b> 9:00 AM-9:30 AM/); // NEW
    assert.doesNotMatch(h.weekLaneCard.style, /strokeColor=#B91C1C/); // NEW
    assert.match(breakCard.style, /strokeColor=#B91C1C/); // NEW
    assert.equal(counters.classification, 0); // NEW
    assert.ok(counters.layout > 0); // NEW
    assert.ok(counters.lanes > 0); // NEW
    assert.ok(counters.boardLayout > 0); // NEW
    assert.ok(counters.schedulePack > 0); // NEW
}); // NEW

test("task manager edit hours start and end changes do not compress durations", async () => { // NEW
    const h = makeHarness(); // NEW
    const boardOverlay = h.document.querySelector(".trellis-task-board-header-controls"); // NEW
    h.graph.setSelectionCell(h.weekWedLane); // NEW
    await nextTick(); // NEW
    buttonByText(boardOverlay, "Add Break").click(); // NEW
    await nextTick(); // NEW
    const breakCard = h.weekWedLane.children.find(cell => attr(cell, "schedule_break") === "1"); // NEW

    saveSelectedWeekDayHours(h, 3, "08:00", "18:00"); // NEW
    await nextTick(); // NEW
    assert.equal(attr(h.weekLaneCard, "schedule_start_minute"), "480"); // NEW
    assert.equal(attr(breakCard, "schedule_start_minute"), "540"); // NEW
    assert.equal(attr(h.weekLaneCard, "schedule_duration_minutes"), "60"); // NEW
    assert.equal(attr(breakCard, "schedule_duration_minutes"), "30"); // NEW

    saveSelectedWeekDayHours(h, 3, "06:00", "07:00"); // NEW
    await nextTick(); // NEW
    assert.equal(attr(h.weekLaneCard, "schedule_start_minute"), "360"); // NEW
    assert.equal(attr(breakCard, "schedule_start_minute"), "420"); // NEW
    assert.equal(attr(h.weekLaneCard, "schedule_duration_minutes"), "60"); // NEW
    assert.equal(attr(breakCard, "schedule_duration_minutes"), "30"); // NEW
    assert.match(breakCard.style, /strokeColor=#B91C1C/); // NEW
}); // NEW

test("task manager edit hours dialog uses Trellis dialog layer", async () => { // NEW
    const h = makeHarness(); // NEW
    const boardOverlay = h.document.querySelector(".trellis-task-board-header-controls"); // NEW
    h.graph.setSelectionCell(h.weekWedLane); // NEW
    await nextTick(); // NEW

    buttonByText(boardOverlay, "Edit Hours").click(); // NEW

    assert.ok(h.lastDialog); // NEW
    assert.equal(h.ui.dialog.container.style.zIndex, "2000000000"); // NEW
    assert.equal(h.ui.dialog.bg.style.zIndex, "1999999999"); // NEW
}); // NEW

test("task manager single DONE card still offers TODO and DOING actions", async () => { // NEW
    const h = makeHarness(); // NEW
    const overlay = h.document.querySelector(".trellis-task-selected-card-actions"); // NEW
    setAttr(h.weekLaneCard, "workflow_state", "DONE"); // NEW
    setAttr(h.weekLaneCard, "completed", "2026-07-15"); // NEW
    h.setState(h.weekLaneCard, { x: 470, y: 60, width: 120, height: 60 }); // NEW
    h.graph.setSelectionCell(h.weekLaneCard); // NEW
    await nextTick(); // NEW

    assert.equal(buttonByText(overlay, "TODO").style.display, ""); // NEW
    assert.equal(buttonByText(overlay, "DOING").style.display, ""); // NEW
    assert.equal(buttonByText(overlay, "DONE").style.display, "none"); // NEW

    buttonByText(overlay, "TODO").click(); // NEW
    await nextTick(); // NEW
    assert.equal(attr(h.weekLaneCard, "workflow_state"), "TODO"); // NEW
    assert.equal(attr(h.weekLaneCard, "completed"), null); // NEW
}); // NEW

test("task manager hides workflow actions for staged and mixed non-day selections", async () => { // NEW
    const h = makeHarness(); // NEW
    const overlay = h.document.querySelector(".trellis-task-selected-card-actions"); // NEW
    h.setState(h.stagedCard, { x: 30, y: 60, width: 120, height: 60 }); // NEW
    h.setState(h.weekLaneCard, { x: 470, y: 60, width: 120, height: 60 }); // NEW
    h.setState(h.card1, { x: 30, y: 130, width: 120, height: 60 }); // NEW

    h.graph.setSelectionCell(h.stagedCard); // NEW
    await nextTick(); // NEW
    assert.equal(overlay.style.display, "flex"); // NEW
    assert.equal(buttonByText(overlay, "TODO").style.display, "none"); // NEW
    assert.equal(buttonByText(overlay, "DOING").style.display, "none"); // NEW
    assert.equal(buttonByText(overlay, "DONE").style.display, "none"); // NEW
    assert.equal(buttonByText(overlay, "Allocate to Start Dates").style.display, ""); // NEW

    h.graph.setSelectionCells([h.weekLaneCard, h.card1]); // NEW
    await nextTick(); // NEW
    assert.equal(overlay.style.display, "flex"); // NEW
    assert.equal(buttonByText(overlay, "TODO").style.display, "none"); // NEW
    assert.equal(buttonByText(overlay, "DOING").style.display, "none"); // NEW
    assert.equal(buttonByText(overlay, "DONE").style.display, "none"); // NEW
}); // NEW

test("task manager multi-card overlay applies note, date, reset, and clear actions", async () => { // CHANGE
    const h = makeHarness();
    const overlay = h.document.querySelector(".trellis-task-selected-card-actions");

    h.setState(h.board, { x: 10, y: 10, width: 700, height: 260 });
    h.setState(h.card1, { x: 30, y: 60, width: 120, height: 60 });
    h.setState(h.card2, { x: 30, y: 130, width: 120, height: 60 });
    h.graph.setSelectionCells([h.card1, h.card2]);
    await nextTick();

    assert.equal(overlay.style.display, "flex");
    ["Edit", "Reset Dates", "Clear Note"].forEach(label => assert.ok(buttonByText(overlay, label))); // CHANGE
    assert.equal(buttonByText(overlay, "TODO").style.display, "none"); // NEW
    assert.equal(buttonByText(overlay, "DOING").style.display, "none"); // NEW
    assert.equal(buttonByText(overlay, "DONE").style.display, "none"); // NEW

    buttonByText(overlay, "Edit").click();
    assert.ok(h.lastDialog);
    const noteInput = h.lastDialog.querySelector("input[type='text']");
    const dateInput = h.lastDialog.querySelector("input[type='date']");
    noteInput.value = "shared note";
    noteInput.dispatchEvent(new h.document.defaultView.Event("input", { bubbles: true }));
    dateInput.value = "2026-08-01";
    dateInput.dispatchEvent(new h.document.defaultView.Event("input", { bubbles: true }));
    h.resetCounters(); // NEW
    buttonByText(h.lastDialog, "Save").click();
    await nextTick();

    const dateCounters = h.reflowCounters(); // NEW
    assert.equal(attr(h.card1, "card_note"), "shared note");
    assert.equal(attr(h.card2, "card_note"), "shared note");
    assert.equal(attr(h.card1, "start"), "2026-08-01");
    assert.equal(attr(h.card1, "end"), "2026-08-03");
    assert.equal(attr(h.card2, "start"), "2026-08-01");
    assert.equal(attr(h.card2, "end"), "2026-08-05");
    assert.ok(dateCounters.classification > 0); // NEW
    assert.ok(dateCounters.layout > 0); // NEW

    buttonByText(overlay, "Reset Dates").click();
    await nextTick();
    assert.equal(attr(h.card1, "start"), "2026-07-01");
    assert.equal(attr(h.card1, "date_override"), null);
    assert.equal(attr(h.card2, "start"), "2026-07-05");
    assert.equal(attr(h.card2, "date_override"), null);

    buttonByText(overlay, "Clear Note").click();
    await nextTick();
    assert.equal(attr(h.card1, "card_note"), null);
    assert.equal(attr(h.card2, "card_note"), null);
}); // CHANGE
