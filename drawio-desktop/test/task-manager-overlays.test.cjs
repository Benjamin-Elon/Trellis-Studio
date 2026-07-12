const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { JSDOM } = require("jsdom");

const PROJECT_ROOT = path.join(__dirname, "..");
const TASK_MANAGER_PATH = path.join(PROJECT_ROOT, "drawio", "src", "main", "webapp", "plugins", "garden_planner_plugins", "Garden_Task_Manager.js");

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
    let selectedCells = [];
    let lastDialog = null;

    const root = new TestCell("root", makeValue(document), new TestGeometry(0, 0, 0, 0));
    const board = new TestCell("board", makeValue(document, { board_key: "KANBAN_BOARD", board_role: "main", task_view_mode: "WEEK", task_selected_week_start: "2026-07-12", task_selected_day: "2026-07-15" }), new TestGeometry(10, 10, 700, 260)); // CHANGE
    const stagedLane = new TestCell("staged", makeValue(document, { lane_key: "TODO_STAGED", status: "TODO (staged)" }), new TestGeometry(20, 40, 200, 200)); // NEW
    const weekWedLane = new TestCell("weekWed", makeValue(document, { lane_key: "WEEK_WED", status: "Wednesday" }), new TestGeometry(460, 40, 200, 200)); // NEW
    const todoLane = new TestCell("todo", makeValue(document, { lane_key: "TODO", status: "TODO" }), new TestGeometry(20, 40, 200, 200));
    const doingLane = new TestCell("doing", makeValue(document, { lane_key: "DOING", status: "DOING" }), new TestGeometry(240, 40, 200, 200));
    const stagedCard = new TestCell("stagedCard", makeValue(document, { // NEW
        kanban_card: "1", // NEW
        title: "Stage compost", // NEW
        workflow_state: "STAGED", // NEW
        start: "2026-07-14", // NEW
        end: "2026-07-14" // NEW
    }), new TestGeometry(30, 60, 120, 60)); // NEW
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
    function register(cell) {
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
    add(board, weekWedLane); // NEW
    add(board, todoLane);
    add(board, doingLane);
    add(stagedLane, stagedCard); // NEW
    add(weekWedLane, weekLaneCard); // NEW
    add(todoLane, card1);
    add(todoLane, card2);

    const states = new Map();
    const model = {
        isVertex(cell) { return !!(cell && cell.vertex); },
        getParent(cell) { return cell ? cell.parent : null; },
        getChildCount(cell) { return cell && cell.children ? cell.children.length : 0; },
        getChildAt(cell, index) { return cell.children[index]; },
        add(parent, child, index) { add(parent, child, index); },
        beginUpdate() {},
        endUpdate() {},
        setValue(cell, value) { cell.value = value; },
        setGeometry(cell, geometry) { cell.geometry = geometry; },
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
        refresh() {},
        removeCellOverlays() {},
        addCellOverlay() {},
        addListener() {},
        fireEvent() {},
        getEdges() { return []; },
        scrollCellToVisible() {},
        isCellVisible(cell) { return !cell || cell.visible !== false; },
        isValidDropTarget() { return true; },
        moveCells(cells) { return cells; }
    };

    const context = vm.createContext({
        console,
        Date,
        Math,
        Promise,
        setTimeout,
        clearTimeout,
        window: dom.window,
        document,
        Draw: {
            loadPlugin(registerPlugin) {
                registerPlugin({
                    editor: { graph, undoManager: { undoableEditHappened() {} } },
                    hideDialog() {
                        if (lastDialog && lastDialog.parentNode) lastDialog.parentNode.removeChild(lastDialog);
                        lastDialog = null;
                    },
                    showDialog(node) {
                        lastDialog = node;
                        document.body.appendChild(node);
                    }
                });
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
        mxGeometryChange: class {}
    });

    vm.runInContext(fs.readFileSync(TASK_MANAGER_PATH, "utf8"), context, { filename: TASK_MANAGER_PATH });

    return {
        document,
        graph,
        board,
        stagedLane, // NEW
        weekWedLane, // NEW
        stagedCard, // NEW
        weekLaneCard, // NEW
        card1,
        card2,
        states,
        get lastDialog() { return lastDialog; },
        setState(cell, state) { states.set(cell, state); },
        fireViewEvent(eventName = "repaint") {
            viewListeners.filter(entry => entry.event === eventName).forEach(entry => entry.listener());
        },
        fireModelChange() {
            modelListeners.filter(entry => entry.event === "change").forEach(entry => entry.listener());
        }
    };
}

test("task manager selection overlays render above graph and defer until states are available", async () => {
    const h = makeHarness();
    const boardOverlay = h.document.querySelector(".trellis-task-board-header-controls");
    const cardOverlay = h.document.querySelector(".trellis-task-selected-card-actions");
    assert.equal(boardOverlay.parentNode.className, "trellis-task-control-layer"); // CHANGE
    assert.equal(cardOverlay.parentNode.className, "trellis-task-control-layer"); // CHANGE
    assert.equal(boardOverlay.parentNode.parentNode.id, "overlay"); // CHANGE

    h.graph.setSelectionCell(h.board);
    h.setState(h.board, { x: 10, y: 10, width: 700, height: 260 });
    await nextTick();

    assert.equal(boardOverlay.style.display, "flex");
    assert.equal(boardOverlay.style.zIndex, "10020");
    assert.equal(boardOverlay.style.left, "10px");
    assert.equal(cardOverlay.style.display, "none");

    h.graph.setSelectionCell(h.card1);
    h.setState(h.card1, { x: 30, y: 60, width: 120, height: 60 });
    await nextTick();

    assert.equal(cardOverlay.style.display, "flex");
    assert.equal(cardOverlay.style.zIndex, "10020");
    assert.equal(cardOverlay.style.top, "126px");

    h.graph.setSelectionCell(h.card2); // NEW
    await nextTick(); // NEW

    assert.equal(cardOverlay.style.display, "none"); // NEW
});

test("task manager DOM overlays avoid SVG overlayPane hosts", async () => { // NEW
    const h = makeHarness({ svgOverlayPane: true }); // NEW
    const boardOverlay = h.document.querySelector(".trellis-task-board-header-controls"); // NEW
    const cardOverlay = h.document.querySelector(".trellis-task-selected-card-actions"); // NEW
    assert.equal(boardOverlay.parentNode.className, "trellis-task-control-layer"); // CHANGE
    assert.equal(cardOverlay.parentNode.className, "trellis-task-control-layer"); // CHANGE
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

test("task manager staged due badge follows weekly selection anchor", async () => { // NEW
    const h = makeHarness(); // NEW

    h.graph.setSelectionCell(h.board); // NEW
    await nextTick(); // NEW
    assert.match(attr(h.stagedCard, "label"), /Due:/); // NEW
    assert.match(attr(h.stagedCard, "label"), /Due now/); // NEW

    h.graph.setSelectionCell(h.weekWedLane); // NEW
    await nextTick(); // NEW
    assert.match(attr(h.stagedCard, "label"), /1d early/); // NEW

    h.graph.setSelectionCell(h.weekLaneCard); // NEW
    await nextTick(); // NEW
    assert.match(attr(h.stagedCard, "label"), /1d early/); // NEW
}); // NEW

test("task manager week scheduler lays out day heights and selected-lane controls", async () => { // NEW
    const h = makeHarness(); // NEW
    h.setState(h.board, { x: 10, y: 10, width: 700, height: 260 }); // NEW
    h.graph.setSelectionCell(h.board); // NEW
    await nextTick(); // NEW

    const boardOverlay = h.document.querySelector(".trellis-task-board-header-controls"); // NEW
    assert.equal(buttonByText(boardOverlay, "Day"), undefined); // NEW
    assert.equal(h.weekWedLane.geometry.height, 960); // NEW
    assert.equal(h.stagedLane.geometry.height, 960); // NEW
    assert.equal(h.board.geometry.height, 998); // NEW

    h.setState(h.weekWedLane, { x: 460, y: 40, width: 200, height: 960 }); // NEW
    h.graph.setSelectionCell(h.weekWedLane); // NEW
    await nextTick(); // NEW
    assert.ok(buttonByText(boardOverlay, "Edit Hours")); // NEW
    assert.ok(buttonByText(boardOverlay, "Add Break")); // NEW
    assert.equal(attr(h.board, "task_selected_day"), "2026-07-15"); // NEW
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
    assert.equal(attr(breakCard, "schedule_duration_minutes"), "30"); // NEW
    assert.equal(attr(h.weekLaneCard, "schedule_start_minute"), "360"); // NEW
    assert.equal(attr(breakCard, "schedule_start_minute"), "420"); // NEW
}); // NEW

test("task manager closed week days label closed and clear schedule attributes", async () => { // NEW
    const h = makeHarness(); // NEW
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
}); // NEW

test("task manager multi-card overlay applies workflow, note, date, reset, and clear actions", async () => {
    const h = makeHarness();
    const overlay = h.document.querySelector(".trellis-task-selected-card-actions");

    h.setState(h.board, { x: 10, y: 10, width: 700, height: 260 });
    h.setState(h.card1, { x: 30, y: 60, width: 120, height: 60 });
    h.setState(h.card2, { x: 30, y: 130, width: 120, height: 60 });
    h.graph.setSelectionCells([h.card1, h.card2]);
    await nextTick();

    assert.equal(overlay.style.display, "flex");
    ["Edit", "TODO", "DOING", "DONE", "Reset Dates", "Clear Note"].forEach(label => assert.ok(buttonByText(overlay, label), label));

    buttonByText(overlay, "Edit").click();
    assert.ok(h.lastDialog);
    const noteInput = h.lastDialog.querySelector("input[type='text']");
    const dateInput = h.lastDialog.querySelector("input[type='date']");
    noteInput.value = "shared note";
    noteInput.dispatchEvent(new h.document.defaultView.Event("input", { bubbles: true }));
    dateInput.value = "2026-08-01";
    dateInput.dispatchEvent(new h.document.defaultView.Event("input", { bubbles: true }));
    buttonByText(h.lastDialog, "Save").click();
    await nextTick();

    assert.equal(attr(h.card1, "card_note"), "shared note");
    assert.equal(attr(h.card2, "card_note"), "shared note");
    assert.equal(attr(h.card1, "start"), "2026-08-01");
    assert.equal(attr(h.card1, "end"), "2026-08-03");
    assert.equal(attr(h.card2, "start"), "2026-08-01");
    assert.equal(attr(h.card2, "end"), "2026-08-05");

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

    buttonByText(overlay, "DOING").click();
    await nextTick();
    assert.equal(attr(h.card1, "workflow_state"), "DOING");
    assert.equal(attr(h.card2, "workflow_state"), "DOING");
});
