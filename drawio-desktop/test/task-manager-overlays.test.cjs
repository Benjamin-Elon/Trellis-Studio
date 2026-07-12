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
    let currentUi = null; // NEW

    const root = new TestCell("root", makeValue(document), new TestGeometry(0, 0, 0, 0));
    const board = new TestCell("board", makeValue(document, { board_key: "KANBAN_BOARD", board_role: "main", task_view_mode: "WEEK", task_selected_week_start: "2026-07-12", task_selected_day: "2026-07-15" }), new TestGeometry(10, 10, 700, 260)); // CHANGE
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
        mxGeometryChange: class { constructor(cell) { this.cell = cell; } } // CHANGE
    });

    vm.runInContext(fs.readFileSync(TASK_MANAGER_PATH, "utf8"), context, { filename: TASK_MANAGER_PATH });

    return {
        document,
        graph,
        board,
        stagedLane, // NEW
        weekSunLane, // NEW
        weekTueLane, // NEW
        weekWedLane, // NEW
        weekSatLane, // NEW
        stagedCard, // NEW
        stagedBeforeCard, // NEW
        stagedAfterCard, // NEW
        stagedInvalidCard, // NEW
        weekLaneCard, // NEW
        card1,
        card2,
        states,
        get lastDialog() { return lastDialog; },
        get ui() { return currentUi; }, // NEW
        geometryChange(cell) { return new context.mxGeometryChange(cell); }, // NEW
        setState(cell, state) { states.set(cell, state); },
        fireViewEvent(eventName = "repaint") {
            viewListeners.filter(entry => entry.event === eventName).forEach(entry => entry.listener());
        },
        fireModelChange(edit = null) { // CHANGE
            const evt = { getProperty(key) { return key === "edit" ? edit : null; } }; // NEW
            modelListeners.filter(entry => entry.event === "change").forEach(entry => entry.listener(null, evt)); // CHANGE
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

test("task manager week day cards show workflow colors and time badge", async () => { // NEW
    const h = makeHarness(); // NEW
    h.graph.setSelectionCell(h.weekWedLane); // NEW
    await nextTick(); // NEW

    assert.match(h.weekLaneCard.style, /fillColor=#F8CECC/); // NEW
    assert.match(attr(h.weekLaneCard, "label"), /<b>Time:<\/b> 6:00 AM-7:00 AM/); // NEW

    setAttr(h.weekLaneCard, "workflow_state", "DOING"); // NEW
    h.graph.setSelectionCell(h.weekWedLane); // NEW
    await nextTick(); // NEW
    assert.match(h.weekLaneCard.style, /fillColor=#FFF2CC/); // NEW

    setAttr(h.weekLaneCard, "workflow_state", "DONE"); // NEW
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
    assert.equal(attr(h.weekLaneCard, "schedule_start_minute"), "360"); // NEW
    assert.equal(attr(breakCard, "schedule_start_minute"), "420"); // NEW
    assert.match(attr(breakCard, "label"), /<b>Time:<\/b> 7:00 AM-7:30 AM/); // NEW
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
    h.graph.setSelectionCell(h.weekWedLane); // NEW
    await nextTick(); // NEW

    assert.equal(breakCard.visible, false); // NEW
    assert.equal(attr(breakCard, "schedule_start_minute"), null); // NEW

    setAttr(h.board, "task_selected_week_start", "2026-07-12"); // NEW
    setAttr(h.board, "task_selected_day", "2026-07-15"); // NEW
    h.graph.setSelectionCell(h.weekWedLane); // NEW
    await nextTick(); // NEW
    assert.equal(breakCard.visible, true); // NEW
    assert.notEqual(attr(breakCard, "schedule_start_minute"), null); // CHANGE
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

    h.graph.setSelectionCell(h.weekWedLane); // NEW
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
    h.graph.setSelectionCell(h.weekWedLane); // NEW
    await nextTick(); // NEW

    h.weekWedLane.geometry.width = 1200; // CHANGE
    h.fireModelChange({ changes: [h.geometryChange(h.weekWedLane)] }); // NEW
    await nextTick(); // NEW

    const widths = JSON.parse(attr(h.board, "task_day_lane_widths_json")).widths; // NEW
    assert.equal(widths.WEEK_WED, 1200); // CHANGE
    assert.equal(widths.WEEK_TUE, 220); // NEW
    assert.equal(h.weekWedLane.geometry.width, 1200); // CHANGE
    assert.equal(h.stagedLane.geometry.width, 220); // NEW
    assert.equal(h.board.geometry.width, 2872); // CHANGE
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
