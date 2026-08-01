const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { JSDOM } = require("jsdom");

const PROJECT_ROOT = path.join(__dirname, "..");
const TASK_MANAGER_PATH = path.join(PROJECT_ROOT, "drawio", "src", "main", "webapp", "plugins", "garden_planner_plugins", "Garden_Task_Manager.js");
const TEST_REALISTIC_WEEK_WORK_HOURS_JSON = JSON.stringify({ schemaVersion: 1, days: [
    { startMinute: 480, endMinute: 720 },
    { startMinute: 1020, endMinute: 1140 },
    { startMinute: 1020, endMinute: 1140 },
    { startMinute: 1020, endMinute: 1140 },
    { startMinute: 1020, endMinute: 1140 },
    { startMinute: 1020, endMinute: 1140 },
    { startMinute: 480, endMinute: 720 }
] });
const TEST_LEGACY_BOARD_STYLE = "swimlane;fontStyle=2;childLayout=stackLayout;horizontal=1;startSize=28;horizontalStack=1;resizeParent=1;resizeParentMax=0;resizeLast=0;collapsible=1;marginBottom=0;swimlaneFillColor=none;fontFamily=Permanent Marker;fontSize=16;points=[];verticalAlign=top;stackBorder=0;resizable=1;strokeWidth=2;disableMultiStroke=1;";

function nextTick() {
    return new Promise(resolve => setTimeout(resolve, 5));
}

/**
 * Creates a Date constructor whose no-argument clock reads use local noon on a fixed calendar date.
 * Calls with arguments retain native Date behavior so plugin parsing and calendar arithmetic stay realistic.
 */
function createFixedLocalDateConstructor(localISO) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(localISO || ""));
    if (!match) throw new TypeError("Fixed local date must use YYYY-MM-DD format.");
    const fixedLocalNoon = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12, 0, 0, 0);
    const fixedNow = fixedLocalNoon.getTime();
    return class FixedLocalDate extends Date {
        constructor(...args) {
            super(...(args.length ? args : [fixedNow])); // NEW: only no-argument construction reads the fixed clock
        }

        static now() { return fixedNow; }
    };
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
    setCollapsed(collapsed) { this.collapsed = !!collapsed; }
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

function setAttr(cell, key, value) {
    if (value == null) cell.value.removeAttribute(key);
    else cell.value.setAttribute(key, String(value));
}

function buttonByText(root, text) {
    return Array.from(root.querySelectorAll("button")).find(button => button.textContent === text);
}

function buttonStartingWith(root, text) {
    return Array.from(root.querySelectorAll("button")).find(button => button.textContent.startsWith(text));
}

function changeCheckbox(document, checkbox, checked) {
    checkbox.checked = checked;
    checkbox.dispatchEvent(new document.defaultView.Event("change", { bubbles: true }));
}

function laneToggleInput(root, laneKey) {
    return root.querySelector(`.trellis-task-board-lane-toggle[data-lane-key="${laneKey}"] input[type="checkbox"]`);
}

function laneToggleKeys(root) {
    return Array.from(root.querySelectorAll(".trellis-task-board-lane-toggle")).map(label => label.getAttribute("data-lane-key"));
}

function columnsToggleButton(root) {
    return buttonByText(root, "Hide/Show columns");
}

function laneTogglePanel(root) {
    return root.querySelector(".trellis-task-board-column-panel");
}

function taskModuleOverlay(document) {
    return document.querySelector(".trellis-task-module-board-overlay");
}

function taskModuleOverlayInput(document) {
    const input = document.querySelector(".trellis-task-module-board-overlay input[aria-label='Task label']");
    assert.ok(input, "missing task module label input");
    return input;
}

function showLaneToggles(root) {
    const toggle = columnsToggleButton(root);
    if (toggle && toggle.getAttribute("aria-expanded") !== "true") toggle.click();
}

test("task manager routes garden board creation through companion Task Modules", () => {
    const text = taskManagerSource();
    assert.match(text, /function isTaskModule\(cell\)/);
    assert.match(text, /function ensureTaskModuleForGarden\(gardenModule\)/);
    assert.match(text, /const parent = isGardenModule\(containerVertex\) \? boardContainerForGarden\(containerVertex\)/);
    assert.match(text, /const taskModule = cell && model\.isVertex\(cell\) && isTaskModule\(cell\) \? cell : null;/);
    assert.match(text, /menu\.addItem\('Add Kanban Board'[\s\S]*createSecondaryBoardIn\(taskModule\)/);
    assert.match(text, /const createMainBoard = !!\(evt[\s\S]*evt\.getProperty\("createMainBoard"\)\);/);
    assert.doesNotMatch(text, /function repairExistingCompanionTaskBoards\(\)/);
    assert.doesNotMatch(text, /setTimeout\(repairExistingCompanionTaskBoards, 0\);/);
    assert.doesNotMatch(text, /const gm = cell && model\.isVertex\(cell\) && isGardenModule\(cell\) \? cell : null;[\s\S]{0,200}Add Kanban Board/);
});

test("task manager exposes dashboard board APIs and unseen-created state", () => {
    const text = taskManagerSource();
    assert.match(text, /graph\.__trellisTaskManager = Object\.assign/);
    assert.match(text, /listBoardsForGarden: function \(gardenModule\)/);
    assert.match(text, /openBoardForGarden: function \(gardenModule, boardId, year\)/);
    assert.match(text, /unseenCreatedSummaryForGarden: function \(gardenModule\)/);
    assert.match(text, /const TASK_SEEN_CREATED_ATTR = 'task_seen_created_json';/);
    assert.match(text, /function taskBoardUnseenSummaryForGarden\(gardenModule\)/);
    assert.match(text, /createdAt <= cutoff/);
    assert.match(text, /viewer\.unscheduled = Date\.now\(\);/);
});

test("task manager installs a selected Task Module add-board overlay", () => {
    const text = taskManagerSource();
    assert.match(text, /function installSelectedTaskModuleBoardOverlay\(\)/);
    assert.match(text, /trellis-task-module-board-overlay/);
    assert.match(text, /addBoardBtn\.textContent = 'Add Kanban Board';/);
    assert.match(text, /createSecondaryBoardIn\(taskModule\)/);
    assert.match(text, /installSelectedTaskModuleBoardOverlay\(\);/);
});

function modeToggleButton(root) {
    return buttonByText(root, "Switch to Full view") || buttonByText(root, "Switch to Week view");
}

function loadTaskManagerHooks() {
    const context = vm.createContext({
        console,
        globalThis: { __TRELLIS_TASK_MANAGER_TEST__: true },
        Draw: { loadPlugin() {} }
    });
    vm.runInContext(fs.readFileSync(TASK_MANAGER_PATH, "utf8"), context, { filename: TASK_MANAGER_PATH });
    return context.globalThis.__TRELLIS_TASK_MANAGER_TEST_HOOKS__;
}

function taskManagerSource() {
    return fs.readFileSync(TASK_MANAGER_PATH, "utf8");
}

function saveSelectedWeekDayHours(h, dayIndex, startValue, endValue) {
    const boardOverlay = h.document.querySelector(".trellis-task-board-header-controls");
    buttonByText(boardOverlay, "Edit Hours").click();
    const timeInputs = Array.from(h.lastDialog.querySelectorAll("input[type='time']"));
    const selectedWeekOffset = 14 + (dayIndex * 2);
    timeInputs[selectedWeekOffset].value = startValue;
    timeInputs[selectedWeekOffset + 1].value = endValue;
    buttonByText(h.lastDialog, "Save").click();
}

function selectedWeekOverrideDay(h, dayIndex) {
    const overrides = JSON.parse(attr(h.board, "task_work_hours_week_overrides_json"));
    return overrides.weeks["2026-07-12"].days[dayIndex];
}

function addHarnessCard(h, lane, id, attrs = {}, height = 60) {
    const card = new TestCell(id, makeValue(h.document, Object.assign({ kanban_card: "1", title: id }, attrs)), new TestGeometry(30, 60 + (lane.children.length * 70), 120, height));
    card.parent = lane;
    lane.children.push(card);
    return card;
}

function addRoleFixture(h, options = {}) {
    const id = options.id || `role-${Math.random()}`;
    const role = new TestCell(id, makeValue(h.document, { label: options.header || "Role" }), new TestGeometry(0, 0, 240, 160), "shape=swimlane;role_card=1;"); // CHANGE: Role headers need XML values so production-style link metadata can be stored.
    const imageRow = new TestCell(`${id}-image-row`, "", new TestGeometry(0, 0, 80, 80), "shape=rectangle;role_imagerow=1;");
    const nameRow = new TestCell(`${id}-name`, options.name == null ? "Name" : options.name, new TestGeometry(40, 0, 200, 30), options.legacy ? "shape=rectangle;" : "shape=rectangle;role_name=1;");
    const titleRow = new TestCell(`${id}-title`, options.roleTitle == null ? "Role/Title" : options.roleTitle, new TestGeometry(0, 30, 240, 30), options.legacy ? "shape=rectangle;" : "shape=rectangle;role_title=1;");
    h.addCell(role, imageRow); h.addCell(role, nameRow); h.addCell(role, titleRow);
    if (options.image) {
        const avatar = new TestCell(`${id}-avatar`, "", new TestGeometry(5, 5, 70, 70), `shape=image;image=${options.image};role_avatar=1;`);
        h.addCell(imageRow, avatar);
    }
    h.addCell(h.root, role);
    const boardLinks = new Set(String(attr(h.board, "linkedTo") || "").split(",").filter(Boolean));
    boardLinks.add(id);
    setAttr(h.board, "linkedTo", Array.from(boardLinks).join(","));
    if (options.reciprocal !== false) setAttr(role, "linkedTo", h.board.id);
    return { role, imageRow, nameRow, titleRow };
}

function makeHarness(options = {}) {
    const dom = new JSDOM(options.svgOverlayPane
        ? "<!doctype html><body><div id='graph'><svg><g id='overlay'></g></svg></div></body>"
        : "<!doctype html><body><div id='graph'><div id='overlay'></div></div></body>");
    const { document } = dom.window;
    const container = document.getElementById("graph");
    const overlayPane = document.getElementById("overlay");
    const selectionListeners = [];
    const modelListeners = [];
    const viewListeners = [];
    const mouseListeners = [];
    const graphListeners = new Map();
    let selectedCells = [];
    let lastDialog = null;
    let currentUi = null;
    const initialNonDayLaneHeight = Number(options.initialNonDayLaneHeight) || 200;

    const root = new TestCell("root", makeValue(document), new TestGeometry(0, 0, 0, 0));
    const board = new TestCell("board", makeValue(document, { board_key: "KANBAN_BOARD", board_role: "main", task_view_mode: "WEEK", task_selected_week_start: "2026-07-12", task_selected_day: "2026-07-12", task_work_hours_defaults_json: TEST_REALISTIC_WEEK_WORK_HOURS_JSON }), new TestGeometry(10, 10, 700, 260), TEST_LEGACY_BOARD_STYLE);
    const stagedLane = new TestCell("staged", makeValue(document, { lane_key: "TODO_STAGED", status: "TODO (staged)" }), new TestGeometry(20, 40, 200, initialNonDayLaneHeight));
    const weekSunLane = new TestCell("weekSun", makeValue(document, { lane_key: "WEEK_SUN", status: "Sunday" }), new TestGeometry(240, 40, 200, 200));
    const weekMonLane = new TestCell("weekMon", makeValue(document, { lane_key: "WEEK_MON", status: "Monday" }), new TestGeometry(460, 40, 200, 200));
    const weekTueLane = new TestCell("weekTue", makeValue(document, { lane_key: "WEEK_TUE", status: "Tuesday" }), new TestGeometry(680, 40, 200, 200));
    const weekWedLane = new TestCell("weekWed", makeValue(document, { lane_key: "WEEK_WED", status: "Wednesday" }), new TestGeometry(460, 40, 200, 200));
    const weekThuLane = new TestCell("weekThu", makeValue(document, { lane_key: "WEEK_THU", status: "Thursday" }), new TestGeometry(1120, 40, 200, 200));
    const weekFriLane = new TestCell("weekFri", makeValue(document, { lane_key: "WEEK_FRI", status: "Friday" }), new TestGeometry(1340, 40, 200, 200));
    const weekSatLane = new TestCell("weekSat", makeValue(document, { lane_key: "WEEK_SAT", status: "Saturday" }), new TestGeometry(1560, 40, 200, 200));
    const todoLane = new TestCell("todo", makeValue(document, { lane_key: "TODO", status: "TODO", task_page_anchor_card_id: options.initialTodoAnchor, page_index: options.initialTodoPageIndex }), new TestGeometry(20, 40, 200, initialNonDayLaneHeight));
    const doingLane = new TestCell("doing", makeValue(document, { lane_key: "DOING", status: "DOING" }), new TestGeometry(240, 40, 200, initialNonDayLaneHeight));
    const secondaryBoard = options.secondaryBoard ? new TestCell("secondaryBoard", makeValue(document, { board_key: "KANBAN_BOARD", board_role: "secondary", task_view_mode: "WEEK", task_selected_week_start: "2026-07-12", task_selected_day: "2026-07-15", task_work_hours_defaults_json: TEST_REALISTIC_WEEK_WORK_HOURS_JSON }), new TestGeometry(2500, 10, 700, 260), TEST_LEGACY_BOARD_STYLE) : null;
    const secondaryWeekWedLane = secondaryBoard ? new TestCell("secondaryWeekWed", makeValue(document, { lane_key: "WEEK_WED", status: "Wednesday" }), new TestGeometry(460, 40, 200, 200)) : null;
    const secondaryWeekWedCard = secondaryWeekWedLane ? new TestCell("secondaryWeekWedCard", makeValue(document, { kanban_card: "1", title: "Secondary Wednesday task", workflow_state: "TODO", assigned_day: "2026-07-15", start: "2026-07-15", end: "2026-07-15" }), new TestGeometry(470, 60, 120, 60)) : null;
    const stagedCard = new TestCell("stagedCard", makeValue(document, {
        kanban_card: "1",
        title: "Stage compost",
        workflow_state: "STAGED",
        start: "2026-07-14",
        end: "2026-07-14"
    }), new TestGeometry(30, 60, 120, 60));
    const stagedBeforeCard = new TestCell("stagedBeforeCard", makeValue(document, {
        kanban_card: "1",
        title: "Before week",
        workflow_state: "STAGED",
        start: "2026-07-01",
        end: "2026-07-01"
    }), new TestGeometry(30, 130, 120, 60));
    const stagedAfterCard = new TestCell("stagedAfterCard", makeValue(document, {
        kanban_card: "1",
        title: "After week",
        workflow_state: "STAGED",
        start: "2026-07-25",
        end: "2026-07-25"
    }), new TestGeometry(30, 200, 120, 60));
    const stagedInvalidCard = new TestCell("stagedInvalidCard", makeValue(document, {
        kanban_card: "1",
        title: "No date",
        workflow_state: "STAGED"
    }), new TestGeometry(30, 270, 120, 60));
    const weekTueCard = new TestCell("weekTueCard", makeValue(document, {
        kanban_card: "1",
        title: "Tuesday task",
        workflow_state: "TODO",
        assigned_day: "2026-07-14",
        start: "2026-07-14",
        end: "2026-07-14"
    }), new TestGeometry(690, 60, 120, 60));
    const weekTueCard2 = new TestCell("weekTueCard2", makeValue(document, {
        kanban_card: "1",
        title: "Second Tuesday task",
        workflow_state: "TODO",
        assigned_day: "2026-07-14",
        start: "2026-07-14",
        end: "2026-07-14"
    }), new TestGeometry(690, 130, 120, 60));
    const weekLaneCard = new TestCell("weekLaneCard", makeValue(document, {
        kanban_card: "1",
        title: "Week lane task",
        workflow_state: "TODO",
        assigned_day: "2026-07-15",
        start: "2026-07-15",
        end: "2026-07-15"
    }), new TestGeometry(470, 60, 120, 60));
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
    let labelSetCount = 0;
    let modelBeginUpdateCount = 0;
    function instrumentLabelWrites(value) {
        if (!value || typeof value.setAttribute !== "function" || value.__trellisLabelWritesInstrumented) return value;
        const originalSetAttribute = value.setAttribute.bind(value);
        value.setAttribute = function (name, attrValue) {
            if (name === "label") labelSetCount += 1;
            return originalSetAttribute(name, attrValue);
        };
        value.__trellisLabelWritesInstrumented = true;
        return value;
    }
    function register(cell) {
        if (cell) instrumentLabelWrites(cell.value);
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
    add(board, stagedLane);
    add(board, weekSunLane);
    add(board, weekMonLane);
    add(board, weekTueLane);
    add(board, weekWedLane);
    add(board, weekThuLane);
    add(board, weekFriLane);
    add(board, weekSatLane);
    add(board, todoLane);
    add(board, doingLane);
    add(stagedLane, stagedCard);
    add(stagedLane, stagedBeforeCard);
    add(stagedLane, stagedAfterCard);
    add(stagedLane, stagedInvalidCard);
    add(weekTueLane, weekTueCard);
    add(weekTueLane, weekTueCard2);
    add(weekWedLane, weekLaneCard);
    add(todoLane, card1);
    add(todoLane, card2);
    if (secondaryBoard) {
        add(root, secondaryBoard);
        add(secondaryBoard, secondaryWeekWedLane);
        add(secondaryWeekWedLane, secondaryWeekWedCard);
    }

    const states = new Map();
    let geometrySetCount = 0;
    let scrollCellToVisibleCalls = 0;
    let lastScrollCell = null;
    const refreshCalls = [];
    const valueWrites = [];
    const model = {
        isVertex(cell) { return !!(cell && cell.vertex); },
        getParent(cell) { return cell ? cell.parent : null; },
        getChildCount(cell) { return cell && cell.children ? cell.children.length : 0; },
        getChildAt(cell, index) { return cell.children[index]; },
        add(parent, child, index) { add(parent, child, index); },
        beginUpdate() { modelBeginUpdateCount += 1; },
        endUpdate() {},
        setValue(cell, value) { valueWrites.push({ cell, oldValue: cell.value, newValue: value }); cell.value = instrumentLabelWrites(value); },
        setGeometry(cell, geometry) { geometrySetCount++; cell.geometry = geometry; },
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
        refresh(cell) { refreshCalls.push(cell || null); },
        removeCellOverlays() {},
        addCellOverlay() {},
        addListener(event, listener) {
            if (!graphListeners.has(event)) graphListeners.set(event, []);
            graphListeners.get(event).push(listener);
        },
        addMouseListener(listener) { mouseListeners.push(listener); },
        fireEvent() {},
        getEdges() { return []; },
        scrollCellToVisible(cell) { scrollCellToVisibleCalls += 1; lastScrollCell = cell || null; },
        isCellVisible(cell) { return !cell || cell.visible !== false; },
        isCellCollapsed(cell) { return !!(cell && cell.collapsed); },
        foldCells(collapse, _recurse, cells) { (cells || []).forEach(cell => { if (cell) cell.collapsed = !!collapse; }); },
        isValidDropTarget() { return true; },
        resizeCells(cells) { return cells; },
        moveCells(cells, dx, dy, clone, target) { // CHANGE: model user drag geometry before optional reparenting
            (cells || []).forEach(cell => {
                if (cell && cell.geometry && !clone) {
                    cell.geometry.x += Number(dx) || 0;
                    cell.geometry.y += Number(dy) || 0;
                }
                if (target && !clone) add(target, cell);
            });
            return cells;
        }
    };

    const context = vm.createContext({
        console,
        Date: options.DateCtor || Date, // CHANGE: tests may freeze local clock reads without changing production code
        Math,
        Promise,
        setTimeout,
        clearTimeout,
        globalThis: { __TRELLIS_TASK_MANAGER_TEST__: true },
        window: dom.window,
        document,
        Draw: {
            loadPlugin(registerPlugin) {
                const ui = {
                    editor: { graph, undoManager: { undoableEditHappened() {} } },
                    hideDialog() {
                        if (currentUi && currentUi.dialog && currentUi.dialog.bg && currentUi.dialog.bg.parentNode) currentUi.dialog.bg.parentNode.removeChild(currentUi.dialog.bg);
                        if (currentUi && currentUi.dialog && currentUi.dialog.container && currentUi.dialog.container.parentNode) currentUi.dialog.container.parentNode.removeChild(currentUi.dialog.container);
                        lastDialog = null;
                        if (currentUi) currentUi.dialog = null;
                    },
                    showDialog(node) {
                        const bg = document.createElement("div");
                        const containerNode = document.createElement("div");
                        lastDialog = node;
                        containerNode.appendChild(node);
                        document.body.appendChild(bg);
                        document.body.appendChild(containerNode);
                        currentUi.dialog = { bg, container: containerNode };
                    }
                };
                currentUi = ui;
                registerPlugin(ui);
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
            CELLS_MOVED: "cellsMoved",
            CELLS_RESIZED: "cellsResized",
            addListener(node, event, listener) { node.addEventListener(event, listener); },
            consume(evt) { if (evt && evt.preventDefault) evt.preventDefault(); },
            isControlDown() { return false; },
            isMetaDown() { return false; },
            isShiftDown() { return false; },
            isPopupTrigger() { return false; }
        },
        mxCell: class extends TestCell { // CHANGE: plugin code calls mxCell(value, geometry, style)
            constructor(value, geometry, style) {
                super(`generated-${cellById.size + 1}`, value, geometry, style);
            }
        },
        mxGeometry: TestGeometry,
        mxImage: class {},
        mxCellOverlay: class { addListener() {} },
        mxPoint: class { constructor(x, y) { this.x = x; this.y = y; } },
        mxConstants: { ALIGN_RIGHT: "right", ALIGN_TOP: "top", ALIGN_BOTTOM: "bottom" },
        mxEventObject: class { constructor(name, key, value) { this.name = name; this.props = { [key]: value }; } getProperty(key) { return this.props[key]; } },
        mxChildChange: class {},
        mxValueChange: class {},
        mxStyleChange: class {},
        mxGeometryChange: class { constructor(cell, previous) { this.cell = cell; this.previous = previous || null; } }
    });

    vm.runInContext(fs.readFileSync(TASK_MANAGER_PATH, "utf8"), context, { filename: TASK_MANAGER_PATH });
    const taskHooks = context.globalThis.__TRELLIS_TASK_MANAGER_TEST_HOOKS__;
    const runtimeHooks = context.globalThis.__TRELLIS_TASK_MANAGER_RUNTIME_TEST_HOOKS__;

    return {
        document,
        window: dom.window,
        graph,
        model,
        root,
        addCell: add,
        board,
        stagedLane,
        weekSunLane,
        weekTueLane,
        weekWedLane,
        weekSatLane,
        secondaryBoard,
        secondaryWeekWedLane,
        secondaryWeekWedCard,
        todoLane,
        doingLane,
        stagedCard,
        stagedBeforeCard,
        stagedAfterCard,
        stagedInvalidCard,
        weekTueCard,
        weekTueCard2,
        weekLaneCard,
        card1,
        card2,
        states,
        runtimeHooks,
        get geometrySetCount() { return geometrySetCount; },
        get labelSetCount() { return labelSetCount; },
        get modelBeginUpdateCount() { return modelBeginUpdateCount; },
        get selectedCell() { return selectedCells[0] || null; },
        get selectedCells() { return selectedCells.slice(); },
        get scrollCellToVisibleCalls() { return scrollCellToVisibleCalls; },
        get lastScrollCell() { return lastScrollCell; },
        reflowCounters() { return JSON.parse(JSON.stringify(taskHooks.snapshotTaskReflowTestCounters())); },
        get refreshCalls() { return refreshCalls.slice(); },
        clearValueWrites() { valueWrites.length = 0; },
        get valueWrites() { return valueWrites.slice(); },
        get lastDialog() { return lastDialog; },
        get ui() { return currentUi; },
        geometryChange(cell, previous) { return new context.mxGeometryChange(cell, previous); },
        childChange(cell, previous) { const change = new context.mxChildChange(); change.child = cell; change.previous = previous; return change; },
        setState(cell, state) { states.set(cell, state); },
        fireViewEvent(eventName = "repaint") {
            viewListeners.filter(entry => entry.event === eventName).forEach(entry => entry.listener());
        },
        fireGraphEvent(eventName, props = {}) {
            const evt = { getProperty(key) { return Object.prototype.hasOwnProperty.call(props, key) ? props[key] : null; } };
            (graphListeners.get(eventName) || []).forEach(listener => listener(graph, evt));
        },
        fireModelChange(edit = null) {
            const evt = { getProperty(key) { return key === "edit" ? edit : null; } };
            modelListeners.filter(entry => entry.event === "change").forEach(entry => entry.listener(null, evt));
        },
        mouseDown(cell = null, opts = {}) {
            const event = new dom.window.MouseEvent("mousedown", { bubbles: true, button: opts.button || 0, detail: opts.detail == null ? 1 : opts.detail, clientX: opts.clientX == null ? 100 : opts.clientX, clientY: opts.clientY == null ? 120 : opts.clientY });
            Object.defineProperty(event, "graphX", { value: opts.graphX == null ? event.clientX : opts.graphX });
            Object.defineProperty(event, "graphY", { value: opts.graphY == null ? event.clientY : opts.graphY });
            const me = { getCell() { return cell; }, getEvent() { return event; }, getGraphX() { return event.graphX; }, getGraphY() { return event.graphY; } };
            mouseListeners.forEach(listener => { if (listener.mouseDown) listener.mouseDown(graph, me); });
        },
        mouseUp(cell = null, opts = {}) {
            const event = new dom.window.MouseEvent("mouseup", { bubbles: true, button: opts.button || 0, detail: opts.detail == null ? 1 : opts.detail, clientX: opts.clientX == null ? 100 : opts.clientX, clientY: opts.clientY == null ? 120 : opts.clientY });
            Object.defineProperty(event, "graphX", { value: opts.graphX == null ? event.clientX : opts.graphX });
            Object.defineProperty(event, "graphY", { value: opts.graphY == null ? event.clientY : opts.graphY });
            const me = { getCell() { return cell; }, getEvent() { return event; }, getGraphX() { return event.graphX; }, getGraphY() { return event.graphY; } };
            mouseListeners.forEach(listener => { if (listener.mouseUp) listener.mouseUp(graph, me); });
        },
        resetCounters() { geometrySetCount = 0; labelSetCount = 0; modelBeginUpdateCount = 0; scrollCellToVisibleCalls = 0; lastScrollCell = null; refreshCalls.length = 0; taskHooks.resetTaskReflowTestCounters(); }
    };
}

function attachCompanionTaskFixture(h) {
    const garden = new TestCell("garden", makeValue(h.document, { garden_module: "1", label: "Kitchen Garden" }), new TestGeometry(0, 0, 500, 360), "shape=swimlane;");
    const taskModule = new TestCell("taskModule", makeValue(h.document, { task_module: "1", trellis_garden_module_id: "garden", label: "Kitchen Garden Tasks" }), new TestGeometry(540, 180, 500, 360), "shape=swimlane;");
    h.addCell(h.root, garden);
    h.addCell(h.root, taskModule);
    setAttr(garden, "trellis_task_module_id", taskModule.id);
    h.graph.__trellisModules = {
        ensureGardenTaskModule(cell) { return cell === garden ? taskModule : null; },
        findExistingCompanionTask(cell) { return cell === garden ? taskModule : null; }
    };
    return { garden, taskModule };
}

function boardCellsUnder(cell) {
    return (cell.children || []).filter(child => attr(child, "board_key") === "KANBAN_BOARD" || attr(child, "board_key") === "MAIN_KANBAN_BOARD");
}

test("task manager fails closed instead of creating garden-contained boards without Modules API", () => {
    const h = makeHarness();
    const garden = new TestCell("standaloneGarden", makeValue(h.document, { garden_module: "1" }), new TestGeometry(0, 0, 500, 360), "shape=swimlane;");
    h.addCell(h.root, garden);
    const boards = h.graph.__trellisTaskManager.listBoardsForGarden(garden);
    assert.equal(boards.length, 0);
    assert.equal(boardCellsUnder(garden).length, 0);
});

test("task manager list open and scheduler do not create missing companion Task Modules", () => {
    const h = makeHarness();
    const garden = new TestCell("missingCompanionGarden", makeValue(h.document, { garden_module: "1" }), new TestGeometry(0, 0, 500, 360), "shape=swimlane;");
    const group = new TestCell("missingCompanionGroup", makeValue(h.document), new TestGeometry(20, 40, 120, 80), "shape=rectangle;");
    h.addCell(h.root, garden);
    h.addCell(garden, group);
    let ensureCalls = 0;
    h.graph.__trellisModules = {
        findExistingCompanionTask() { return null; },
        ensureGardenTaskModule() { ensureCalls += 1; return null; }
    };
    assert.equal(h.graph.__trellisTaskManager.listBoardsForGarden(garden).length, 0);
    assert.equal(h.graph.__trellisTaskManager.openBoardForGarden(garden, "", "2026"), null);
    assert.equal(h.runtimeHooks.createTasks([{ title: "No board", startISO: "2026-01-01", endISO: "2026-01-01" }], group.id, { focusCreated: false }).length, 0);
    assert.equal(ensureCalls, 0);
    assert.equal(boardCellsUnder(garden).length, 0);
});

test("task manager source keeps dashboard open highlights before seen marking", () => {
    const text = taskManagerSource();
    assert.match(text, /let suppressDashboardSeenSelection = false;/);
    assert.match(text, /if \(!suppressDashboardSeenSelection && activeDashboardTaskContext[\s\S]*markBoardYearViewed\(sel, activeDashboardTaskContext\.gardenModule, activeDashboardTaskContext\.year\)/);
    assert.match(text, /suppressDashboardSeenSelection = true;[\s\S]*graph\.setSelectionCell\(board\);[\s\S]*suppressDashboardSeenSelection = false;/);
    assert.match(text, /fitBoardInViewport\(board\);[\s\S]*highlightUnseenCards\(board, viewerKey, String\(year \|\| ''\)\);[\s\S]*markBoardYearViewed\(board, gardenModule, year\);/);
    assert.match(text, /trellis-task-unseen-created-highlight/);
    assert.doesNotMatch(text, /__trellisUnseenOriginalStyle/);
    assert.doesNotMatch(text, /card\.style \+= .*strokeColor=#FACC15/);
});

test("task manager source clears manual selection by active dashboard year only", () => {
    const h = makeHarness();
    const text = taskManagerSource();
    assert.match(text, /activeDashboardTaskContext = gardenModule && year \? \{ gardenModule, year: String\(year\) \} : null;/);
    assert.match(text, /markBoardYearViewed\(board, activeDashboardTaskContext\.gardenModule, activeDashboardTaskContext\.year\)/);
    assert.match(text, /viewer\[y\] = Date\.now\(\);[\s\S]*viewer\.unscheduled = Date\.now\(\);/);
    assert.ok(h.graph.__trellisTaskManager);
});

test("task manager scheduler emissions may create a missing main board in an existing Task Module", () => {
    const text = taskManagerSource();
    assert.match(text, /boardLayoutService\.ensureBoardTemplateIn\(gardenModule, \{ insideUpdate: true, createMainBoard: true \}\)/);
    assert.match(text, /if \(isGardenModule\(containerVertex\) && !main && !\(opts && opts\.createMainBoard\)\) return \{ parent, board: null, lanes: \{\} \};/);
    assert.doesNotMatch(text, /taskModuleForGarden[\s\S]{0,260}ensureGardenTaskModule\(gardenModule\)/);
});

test("scheduler sync-created tasks target the companion Task Module main board", () => {
    const h = makeHarness();
    const { garden, taskModule } = attachCompanionTaskFixture(h);
    const group = new TestCell("plantingGroup", makeValue(h.document), new TestGeometry(20, 40, 120, 80), "shape=rectangle;");
    h.addCell(garden, group);
    const result = h.runtimeHooks.createTasks([{ title: "Sow peas", startISO: "2026-03-01", endISO: "2026-03-01" }], group.id, { focusCreated: false });
    assert.equal(result.length, 1);
    assert.equal(boardCellsUnder(garden).length, 0);
    const boards = boardCellsUnder(taskModule);
    assert.equal(boards.length, 1);
    assert.ok(boards[0].children.some(lane => (lane.children || []).some(card => attr(card, "title") === "Sow peas")));
});

test("task module overlay edits labels with one bed-style field and no clamping", async () => {
    const h = makeHarness();
    const { garden, taskModule } = attachCompanionTaskFixture(h);
    h.setState(taskModule, { x: -60, y: -500, width: 500, height: 360 });
    h.graph.setSelectionCell(taskModule);
    await nextTick();

    const overlay = taskModuleOverlay(h.document);
    assert.equal(overlay.style.display, "flex");
    assert.equal(overlay.style.left, "-40px");
    assert.equal(overlay.style.top, "-497px");
    assert.equal(overlay.querySelectorAll("input[aria-label='Task label']").length, 1);
    assert.equal(overlay.textContent.includes("Garden label"), false);
    assert.equal(overlay.textContent.includes("Task label"), false);
    assert.ok(buttonByText(overlay, "Add Kanban Board"));
    let input = taskModuleOverlayInput(h.document);
    assert.equal(input.value, "Kitchen Garden Tasks");

    h.clearValueWrites();
    const oldTaskValue = taskModule.value;
    input.value = "Weekly Work";
    input.dispatchEvent(new h.window.Event("blur"));
    assert.equal(attr(taskModule, "label"), "Weekly Work");
    assert.equal(h.valueWrites.length, 1);
    assert.equal(h.valueWrites[0].cell, taskModule);
    assert.equal(h.valueWrites[0].oldValue, oldTaskValue);
    assert.notEqual(h.valueWrites[0].newValue, oldTaskValue);
    assert.equal(oldTaskValue.getAttribute("label"), "Kitchen Garden Tasks");

    h.graph.setSelectionCell(taskModule);
    await nextTick();
    h.clearValueWrites();
    input = taskModuleOverlayInput(h.document);
    input.value = "Draft Work";
    input.dispatchEvent(new h.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    assert.equal(input.value, "Weekly Work");
    assert.equal(attr(taskModule, "label"), "Weekly Work");
    assert.equal(h.valueWrites.length, 0);

    input.value = "   ";
    input.dispatchEvent(new h.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    assert.equal(attr(taskModule, "label"), "Task Module");

    setAttr(garden, "label", "Market Garden");
    h.graph.setSelectionCell(taskModule);
    await nextTick();
    assert.equal(taskModuleOverlay(h.document).textContent.includes("Market Garden"), false);
});

test("task module overlay delegates label writes to the Modules API when available", async () => {
    const h = makeHarness();
    const taskModule = new TestCell("apiTaskModule", makeValue(h.document, { task_module: "1", label: "API Tasks" }), new TestGeometry(40, 50, 300, 120), "shape=swimlane;");
    h.addCell(h.root, taskModule);
    h.setState(taskModule, { x: 40, y: 50, width: 300, height: 120 });
    let writeCalls = 0;
    h.graph.__trellisModules = {
        getModuleLabel(cell, fallback) { return attr(cell, "label") || fallback; },
        writeModuleLabel(cell, label) {
            writeCalls += 1;
            const next = String(label == null ? "" : label).trim() || "Task Module";
            const clone = cell.value.cloneNode(true);
            clone.setAttribute("label", next);
            h.model.beginUpdate();
            try { h.model.setValue(cell, clone); } finally { h.model.endUpdate(); }
            return next;
        }
    };
    h.graph.setSelectionCell(taskModule);
    await nextTick();
    h.clearValueWrites();
    const oldValue = taskModule.value;
    const input = taskModuleOverlayInput(h.document);
    input.value = "API Work";
    input.dispatchEvent(new h.window.Event("blur"));
    assert.equal(writeCalls, 1);
    assert.equal(attr(taskModule, "label"), "API Work");
    assert.equal(h.valueWrites.length, 1);
    assert.equal(h.valueWrites[0].oldValue, oldValue);
    assert.notEqual(h.valueWrites[0].newValue, oldValue);
    assert.equal(oldValue.getAttribute("label"), "API Tasks");
});

test("unlinked task module overlay only shows the editable label input", async () => {
    const h = makeHarness();
    const taskModule = new TestCell("unlinkedTaskModule", makeValue(h.document, { task_module: "1" }), new TestGeometry(-80, -240, 300, 120), "shape=swimlane;");
    h.addCell(h.root, taskModule);
    h.setState(taskModule, { x: -80, y: -240, width: 300, height: 120 });
    h.graph.setSelectionCell(taskModule);
    await nextTick();

    const overlay = taskModuleOverlay(h.document);
    assert.equal(overlay.style.display, "flex");
    assert.equal(overlay.textContent.includes("Garden label"), false);
    assert.equal(overlay.textContent.includes("Task label"), false);
    assert.equal(taskModuleOverlayInput(h.document).value, "Task Module");
    assert.equal(overlay.style.left, "-60px");
    assert.equal(overlay.style.top, "-237px");
});

test("task module overlay follows the cursor and alternates show and hide", async () => {
    const h = makeHarness();
    h.graph.container.getBoundingClientRect = () => ({ left: 10, top: 20, width: 800, height: 600, right: 810, bottom: 620 });
    const taskModule = new TestCell("clickTaskModule", makeValue(h.document, { task_module: "1", label: "Click Tasks" }), new TestGeometry(80, 90, 300, 120), "shape=swimlane;");
    h.addCell(h.root, taskModule);
    h.setState(taskModule, { x: 80, y: 90, width: 300, height: 120 });

    h.mouseDown(taskModule, { clientX: 180, clientY: 220, graphX: 120, graphY: 130 });
    h.graph.setSelectionCell(taskModule);
    await nextTick();
    let overlay = taskModuleOverlay(h.document);
    assert.equal(overlay.style.display, "flex");
    assert.equal(overlay.style.left, "178px");
    assert.equal(overlay.style.top, "208px");
    h.fireViewEvent();
    await nextTick();
    assert.equal(overlay.style.left, "178px");
    assert.equal(overlay.style.top, "208px");
    h.mouseUp(taskModule, { clientX: 180, clientY: 220, graphX: 120, graphY: 130 });
    assert.equal(taskModuleOverlay(h.document).style.display, "flex");

    h.mouseDown(taskModule, { clientX: 200, clientY: 240, graphX: 140, graphY: 150 });
    h.mouseUp(taskModule, { clientX: 200, clientY: 240, graphX: 140, graphY: 150 });
    assert.equal(taskModuleOverlay(h.document).style.display, "none");

    h.mouseDown(taskModule, { clientX: 210, clientY: 250, graphX: 150, graphY: 160 });
    h.mouseUp(taskModule, { clientX: 210, clientY: 250, graphX: 150, graphY: 160 });
    overlay = taskModuleOverlay(h.document);
    assert.equal(overlay.style.display, "flex");
    assert.equal(overlay.style.left, "208px");
    assert.equal(overlay.style.top, "238px");
});

test("task manager reflow scope policy maps command categories", () => {
    const hooks = loadTaskManagerHooks();
    const plain = value => JSON.parse(JSON.stringify(value));
    assert.deepEqual(plain(hooks.normalizeTaskReflowScopePlan("full")), {
        requested: ["full"], full: true, classification: true, lanes: true, layout: true, badges: true
    });
    assert.deepEqual(plain(hooks.normalizeTaskReflowScopePlan("badges")), {
        requested: ["badges"], full: false, classification: false, lanes: false, layout: false, badges: true
    });
    assert.deepEqual(plain(hooks.normalizeTaskReflowScopePlan("layout")), {
        requested: ["layout"], full: false, classification: false, lanes: true, layout: true, badges: true
    });
    assert.equal(hooks.getTaskReflowScopeForCommand("workflow"), "classification");
    assert.equal(hooks.getTaskReflowScopeForCommand("editHours"), "layout");
    assert.equal(hooks.getTaskReflowScopeForCommand("boardResize"), "layout");
    assert.equal(hooks.getTaskReflowScopeForCommand("selection"), "badges");
    assert.equal(hooks.getTaskReflowScopeForCommand("selectedPeriodStagedPaging"), "lanes");
    assert.equal(hooks.getTaskReflowScopeForCommand("unknown-command"), "full");
});

test("task manager normalizes canonical assignee ids and treats assignments as user touches", () => {
    const hooks = loadTaskManagerHooks();
    const plain = value => JSON.parse(JSON.stringify(value));
    assert.deepEqual(plain(hooks.normalizeTaskAssigneeRoleIds('["role-b","role-a","role-a",""]')), ["role-a", "role-b"]);
    assert.deepEqual(plain(hooks.normalizeTaskAssigneeRoleIds("not json")), []);
    assert.equal(hooks.serializeTaskAssigneeRoleIds(["role-b", "role-a"]), '["role-a","role-b"]');
    assert.equal(hooks.serializeTaskAssigneeRoleIds([]), null);
    assert.equal(hooks.isUserTouchedSchedulerCard({ workflow_state: "STAGED", task_assignee_role_ids_json: '["role-a"]' }), true);
    assert.equal(hooks.isUserTouchedSchedulerRecord({ source: { workflow_state: "STAGED", task_assignee_role_ids_json: "bad" }, laneKey: "TODO_STAGED" }), false);
});

test("task manager preserves assignments only across unique scheduler keys and retains unsafe occurrences as missing", () => {
    const hooks = loadTaskManagerHooks();
    const plain = value => JSON.parse(JSON.stringify(value));
    const assigned = { schedulerTaskKey: "occurrence-a", source: { scheduler_task_key: "occurrence-a", workflow_state: "STAGED", task_assignee_role_ids_json: '["role-b","role-a"]' } };
    const unique = plain(hooks.planTaskAssignmentReplacement([assigned], [{ scheduler_task_key: "occurrence-a" }]));
    assert.deepEqual(unique.preserved, [{ key: "occurrence-a", roleIds: ["role-a", "role-b"] }]);
    assert.deepEqual(unique.retainMissing, []);

    const ambiguous = plain(hooks.planTaskAssignmentReplacement([assigned], [{ scheduler_task_key: "occurrence-a" }, { scheduler_task_key: "occurrence-a" }]));
    assert.deepEqual(ambiguous.preserved, []);
    assert.equal(ambiguous.retainMissing.length, 1);
    const removedUpstream = plain(hooks.planTaskAssignmentReplacement([assigned], []));
    assert.equal(removedUpstream.retainMissing.length, 1);

    const differential = plain(hooks.planDifferentialTaskSync([assigned], []));
    assert.equal(differential.removes.length, 0);
    assert.equal(differential.missing.length, 1);
});

test("task manager builds greedy height-aware pages and clamps full cards to standard minimum", () => {
    const hooks = loadTaskManagerHooks();
    const plain = value => JSON.parse(JSON.stringify(value));
    const paged = plain(hooks.buildTaskLanePagePlan([50, 70, 90], 240));
    assert.equal(paged.paged, true);
    assert.deepEqual(paged.pages, [{ start: 0, end: 1 }, { start: 1, end: 2 }, { start: 2, end: 3 }]);
    assert.deepEqual(paged.heights, [80, 80, 90]);
    assert.equal(paged.usableHeight, 140);
    assert.equal(paged.pagerMarginTop, 20);

    const oversized = plain(hooks.buildTaskLanePagePlan([400], 200));
    assert.equal(oversized.paged, false); // NEW: one clamped card does not create a one-page pager
    assert.deepEqual(oversized.heights, [120]);
    assert.deepEqual(oversized.pages, [{ start: 0, end: 1 }]);

    const compact = plain(hooks.buildTaskLanePagePlan([20, 20], 126));
    assert.equal(compact.paged, true);
    assert.deepEqual(compact.pages, [{ start: 0, end: 1 }, { start: 1, end: 2 }]);
});

test("task manager rebuilds paging cache on load and migrates invalid numeric state without undo edits", () => {
    const h = makeHarness({ initialTodoAnchor: "missing-card", initialTodoPageIndex: "8" });
    assert.equal(attr(h.todoLane, "page_index"), null);
    assert.equal(attr(h.todoLane, "task_page_anchor_card_id"), h.card1.id);
    assert.equal(attr(h.todoLane, "label"), "TODO\nPage 1 of 2");
    assert.equal(h.card1.visible, true);
    assert.equal(h.card2.visible, false);
    assert.equal(h.modelBeginUpdateCount, 0);
    assert.equal(h.geometrySetCount, 0);
});

test("task manager selection overlays render above graph and defer until states are available", async () => {
    const h = makeHarness();
    const boardOverlay = h.document.querySelector(".trellis-task-board-header-controls");
    const cardOverlay = h.document.querySelector(".trellis-task-selected-card-actions");
    const dayLaneOverlay = h.document.querySelector(".trellis-task-selected-day-lane-actions");
    assert.equal(boardOverlay.parentNode.className, "trellis-task-control-layer");
    assert.equal(cardOverlay.parentNode.className, "trellis-task-control-layer");
    assert.equal(dayLaneOverlay.parentNode.className, "trellis-task-control-layer");
    assert.equal(boardOverlay.parentNode.parentNode.id, "overlay");

    h.graph.setSelectionCell(h.board);
    h.setState(h.board, { x: 10, y: 10, width: 700, height: 260 });
    await nextTick();

    assert.equal(boardOverlay.style.display, "flex");
    assert.equal(boardOverlay.style.zIndex, "10020");
    assert.equal(boardOverlay.style.left, "30px");
    assert.equal(cardOverlay.style.display, "none");
    assert.equal(dayLaneOverlay.style.display, "none");

    h.graph.setSelectionCell(h.card1);
    h.setState(h.card1, { x: 30, y: 60, width: 120, height: 60 });
    await nextTick();

    assert.equal(cardOverlay.style.display, "flex");
    assert.equal(cardOverlay.style.zIndex, "10020");
    assert.equal(cardOverlay.style.top, "129px");
    assert.equal(cardOverlay.style.flexDirection, "column");
    assert.equal(cardOverlay.style.alignItems, "stretch");

    h.graph.setSelectionCell(h.card2);
    await nextTick();

    assert.equal(cardOverlay.style.display, "none");
});

test("task manager DOM overlays avoid SVG overlayPane hosts", async () => {
    const h = makeHarness({ svgOverlayPane: true });
    const boardOverlay = h.document.querySelector(".trellis-task-board-header-controls");
    const cardOverlay = h.document.querySelector(".trellis-task-selected-card-actions");
    const dayLaneOverlay = h.document.querySelector(".trellis-task-selected-day-lane-actions");
    assert.equal(boardOverlay.parentNode.className, "trellis-task-control-layer");
    assert.equal(cardOverlay.parentNode.className, "trellis-task-control-layer");
    assert.equal(dayLaneOverlay.parentNode.className, "trellis-task-control-layer");
    assert.equal(boardOverlay.parentNode.parentNode.id, "graph");

    h.graph.setSelectionCell(h.board);
    h.setState(h.board, { x: 10, y: 10, width: 700, height: 260 });
    await nextTick();

    assert.equal(boardOverlay.style.display, "flex");
    assert.equal(boardOverlay.style.zIndex, "10020");
    assert.equal(boardOverlay.parentNode.nodeName, "DIV");
    assert.equal(boardOverlay.parentNode.className, "trellis-task-control-layer");
    assert.equal(boardOverlay.parentNode.parentNode.id, "graph");
});

test("task manager hides task overlays during week card drag and refreshes once after mouseup", async () => {
    const h = makeHarness();
    const boardOverlay = h.document.querySelector(".trellis-task-board-header-controls");
    const cardOverlay = h.document.querySelector(".trellis-task-selected-card-actions");
    h.setState(h.board, { x: 10, y: 10, width: 700, height: 260 });
    h.setState(h.weekTueCard, { x: 690, y: 60, width: 120, height: 60 });
    h.graph.setSelectionCell(h.weekTueCard);
    await nextTick();

    assert.equal(boardOverlay.style.display, "flex");
    assert.equal(cardOverlay.style.display, "flex");
    const initialLeft = cardOverlay.style.left;

    h.mouseDown(h.weekTueCard);
    assert.equal(boardOverlay.style.display, "none");
    assert.equal(cardOverlay.style.display, "none");

    h.setState(h.weekTueCard, { x: 760, y: 90, width: 120, height: 60 });
    h.fireViewEvent("repaint");
    h.fireModelChange();
    await nextTick();
    assert.equal(cardOverlay.style.display, "none");
    assert.equal(cardOverlay.style.left, initialLeft);

    h.mouseUp(h.weekTueCard);
    await nextTick();
    assert.equal(boardOverlay.style.display, "flex");
    assert.equal(cardOverlay.style.display, "flex");
    assert.notEqual(cardOverlay.style.left, initialLeft);
});

test("task manager hides task overlays during full-mode card drag", async () => {
    const h = makeHarness();
    const cardOverlay = h.document.querySelector(".trellis-task-selected-card-actions");
    setAttr(h.board, "task_view_mode", "FULL");
    h.setState(h.card1, { x: 30, y: 60, width: 120, height: 60 });
    h.graph.setSelectionCell(h.card1);
    await nextTick();

    assert.equal(cardOverlay.style.display, "flex");
    h.mouseDown(h.card1);
    assert.equal(cardOverlay.style.display, "none");
    h.mouseUp(h.card1);
    await nextTick();
    assert.equal(cardOverlay.style.display, "flex");
});

test("task manager releases overlay suppression on moved and resized commit events", async () => {
    const h = makeHarness();
    const cardOverlay = h.document.querySelector(".trellis-task-selected-card-actions");
    h.setState(h.weekTueCard, { x: 690, y: 60, width: 120, height: 60 });
    h.graph.setSelectionCell(h.weekTueCard);
    await nextTick();

    h.mouseDown(h.weekTueCard);
    assert.equal(cardOverlay.style.display, "none");
    h.fireGraphEvent("cellsMoved", { cells: [h.weekTueCard] });
    await nextTick();
    assert.equal(cardOverlay.style.display, "flex");

    h.mouseDown(h.weekTueCard);
    assert.equal(cardOverlay.style.display, "none");
    h.fireGraphEvent("cellsResized", { cells: [h.weekTueCard] });
    await nextTick();
    assert.equal(cardOverlay.style.display, "flex");
});

test("task manager non-task mouse interactions do not suppress overlays", async () => {
    const h = makeHarness();
    const boardOverlay = h.document.querySelector(".trellis-task-board-header-controls");
    h.setState(h.board, { x: 10, y: 10, width: 700, height: 260 });
    h.graph.setSelectionCell(h.board);
    await nextTick();

    assert.equal(boardOverlay.style.display, "flex");
    h.mouseDown(h.board);
    h.fireViewEvent("repaint");
    await nextTick();
    assert.equal(boardOverlay.style.display, "flex");
});

test("task manager staged start badge uses visible-week weekday wording", async () => {
    const h = makeHarness({ DateCtor: createFixedLocalDateConstructor("2026-07-12") }); // CHANGE: Sunday makes Tuesday render as an exact weekday

    h.graph.setSelectionCell(h.board);
    await nextTick();
    assert.match(attr(h.stagedCard, "label"), /Start:/);
    assert.match(attr(h.stagedCard, "label"), /Start Tue/);
    assert.doesNotMatch(attr(h.stagedCard, "label"), /Due:/);

    h.graph.setSelectionCell(h.weekWedLane);
    await nextTick();
    assert.match(attr(h.stagedCard, "label"), /Start Tue/);
    assert.doesNotMatch(attr(h.stagedCard, "label"), /early|late/);

    h.graph.setSelectionCell(h.weekLaneCard);
    await nextTick();
    assert.match(attr(h.stagedCard, "label"), /Start Tue/);
    assert.doesNotMatch(attr(h.stagedCard, "label"), /early|late/);
});

test("task manager week scheduler lays out day heights and selected-lane controls", async () => {
    const h = makeHarness();
    h.setState(h.board, { x: 10, y: 10, width: 700, height: 260 });
    h.graph.setSelectionCell(h.board);
    await nextTick();

    const boardOverlay = h.document.querySelector(".trellis-task-board-header-controls");
    const timeScaleOverlay = h.document.querySelector(".trellis-task-week-time-scale");
    assert.equal(buttonByText(boardOverlay, "Day"), undefined);
    assert.equal(timeScaleOverlay.style.display, "block");
    assert.equal(timeScaleOverlay.querySelectorAll(".trellis-task-week-time-label").length, 12);
    assert.equal(timeScaleOverlay.querySelector(".trellis-task-week-time-label").textContent, "8:00 AM");
    assert.equal(timeScaleOverlay.style.left, "256px");
    assert.equal(timeScaleOverlay.style.top, "58px");
    assert.equal(timeScaleOverlay.querySelector(".trellis-task-week-time-grid-line").style.left, "72px");
    assert.equal(h.weekSunLane.geometry.y, 48);
    assert.equal(h.weekWedLane.geometry.y, 768);
    assert.equal(parseInt(timeScaleOverlay.style.top, 10), 10 + h.weekSunLane.geometry.y);
    assert.equal(h.weekWedLane.geometry.height, 160);
    assert.equal(h.weekSunLane.geometry.height, 320);
    assert.equal(h.stagedLane.geometry.height, 880);
    assert.equal(h.board.geometry.height, 938);
    h.graph.view.scale = 2;
    h.setState(h.board, { x: 20, y: 20, width: 1400, height: 520 });
    h.fireViewEvent("repaint");
    await nextTick();
    assert.equal(timeScaleOverlay.style.top, "116px");
    assert.equal(timeScaleOverlay.querySelector(".trellis-task-week-time-grid-line").style.left, "144px");
    h.graph.view.scale = 1;

    h.setState(h.weekWedLane, { x: 460, y: 40, width: 200, height: 960 });
    h.graph.setSelectionCell(h.weekWedLane);
    await nextTick();
    assert.ok(buttonByText(boardOverlay, "Edit Hours"));
    assert.ok(buttonByText(boardOverlay, "Add Break"));
    assert.equal(attr(h.board, "task_selected_day"), "2026-07-15");
});

test("scheduler task replacement API joins caller update when requested", () => {
    const h = makeHarness();
    const group = new TestCell("schedule-group", makeValue(h.document, { tiler_group: "1" }), new TestGeometry(0, 0, 120, 80), "tiler_group=1;");
    h.addCell(h.root, group);
    let historyRunCount = 0;
    h.window.Trellis = { history: { run(_metadata, operation) { historyRunCount += 1; return operation(); }, isRestoring() { return false; } } };
    h.graph.setSelectionCell(group);
    h.resetCounters();

    const result = h.window.USL.tasks.applySchedulerTaskReplacement({
        mode: "replace",
        targetGroupId: group.id,
        tasks: [{ title: "Water Crop", startISO: "2026-07-20", endISO: "2026-07-20", scheduler_task_key: "water::0" }]
    }, { insideUpdate: true });

    const created = h.model.getCell(result && result[0] && result[0].cellId);
    assert.ok(created);
    assert.equal(attr(group, "linkedTo"), created.id);
    assert.equal(attr(created, "linkedTo"), group.id);
    assert.equal(h.selectedCell, group);
    assert.equal(h.scrollCellToVisibleCalls, 0);
    assert.ok(h.modelBeginUpdateCount <= 1); // CHANGE: low-level reflow may touch mx, but the replacement wrapper stays joinable
    assert.equal(historyRunCount, 0);
});

test("scheduler sync-created tasks preserve selection and viewport", () => {
    const h = makeHarness();
    const group = new TestCell("sync-schedule-group", makeValue(h.document, { tiler_group: "1", linkedTo: h.card1.id }), new TestGeometry(0, 0, 120, 80), "tiler_group=1;");
    h.addCell(h.root, group);
    setAttr(h.card1, "linkedTo", group.id);
    setAttr(h.card1, "scheduler_task_key", "water::0::0");
    h.graph.setSelectionCell(group);
    h.resetCounters();

    const plan = h.window.USL.tasks.applySchedulerTaskReplacement({
        mode: "sync",
        targetGroupId: group.id,
        tasks: [
            { title: "Water Crop", startISO: "2026-07-20", endISO: "2026-07-20", scheduler_task_key: "water::0::0" },
            { title: "Fertilize Crop", startISO: "2026-07-21", endISO: "2026-07-21", scheduler_task_key: "fertilize::0" }
        ]
    }, { insideUpdate: true });

    const linkedIds = String(attr(group, "linkedTo") || "").split(",").filter(Boolean);
    const created = linkedIds.map(id => h.model.getCell(id)).find(cell => attr(cell, "scheduler_task_key") === "fertilize::0");
    assert.equal(plan.creates.length, 1);
    assert.ok(created);
    assert.equal(h.selectedCell, group);
    assert.equal(h.scrollCellToVisibleCalls, 0);
});

test("direct task replacement focuses generated cards by default", () => {
    const h = makeHarness();
    const group = new TestCell("manual-schedule-group", makeValue(h.document, { tiler_group: "1" }), new TestGeometry(0, 0, 120, 80), "tiler_group=1;");
    h.addCell(h.root, group);
    h.graph.setSelectionCell(group);
    h.resetCounters();

    const result = h.runtimeHooks.replaceTasks(group.id, [
        { title: "Manual Water Crop", startISO: "2026-07-22", endISO: "2026-07-22", scheduler_task_key: "manual::0" }
    ], { insideUpdate: true });

    const created = h.model.getCell(result && result[0] && result[0].cellId);
    assert.ok(created);
    assert.equal(h.selectedCell, created);
    assert.equal(h.scrollCellToVisibleCalls, 1);
    assert.equal(h.lastScrollCell, created);
});

test("legacy tasksCreated event still performs standalone replacement", async () => {
    const h = makeHarness();
    const group = new TestCell("legacy-schedule-group", makeValue(h.document, { tiler_group: "1" }), new TestGeometry(0, 0, 120, 80), "tiler_group=1;");
    h.addCell(h.root, group);
    let historyRunCount = 0;
    h.window.Trellis = { history: { run(_metadata, operation) { historyRunCount += 1; return operation(); }, isRestoring() { return false; } } };
    h.resetCounters();

    h.window.dispatchEvent(new h.window.CustomEvent("tasksCreated", {
        detail: {
            mode: "replace",
            targetGroupId: group.id,
            tasks: [{ title: "Harvest Crop", startISO: "2026-07-21", endISO: "2026-07-21", scheduler_task_key: "harvest::0" }]
        }
    }));
    await nextTick();

    const linkedIds = String(attr(group, "linkedTo") || "").split(",").filter(Boolean);
    assert.equal(linkedIds.length, 1);
    assert.equal(attr(h.model.getCell(linkedIds[0]), "title"), "Harvest Crop");
    assert.ok(h.modelBeginUpdateCount > 0);
    assert.ok(historyRunCount > 0);
});

test("task manager keeps week time scale visible for the last active board", async () => {
    const h = makeHarness();
    h.setState(h.board, { x: 10, y: 10, width: 700, height: 260 });
    h.graph.setSelectionCell(h.board);
    await nextTick();

    const boardOverlay = h.document.querySelector(".trellis-task-board-header-controls");
    const timeScaleOverlay = h.document.querySelector(".trellis-task-week-time-scale");
    assert.equal(timeScaleOverlay.style.display, "block");
    assert.equal(boardOverlay.style.display, "flex");

    h.graph.setSelectionCell(h.root);
    await nextTick();

    assert.equal(timeScaleOverlay.style.display, "block");
    assert.equal(timeScaleOverlay.querySelector(".trellis-task-week-time-label").textContent, "8:00 AM");
    assert.equal(boardOverlay.style.display, "none"); // NEW: scheduler commands remain selection-scoped
});

test("task manager week board shrinks to visible day lanes and aligns time scale", async () => {
    const h = makeHarness();
    h.setState(h.board, { x: 10, y: 10, width: 700, height: 260 });
    h.graph.setSelectionCell(h.board);
    await nextTick();

    const boardOverlay = h.document.querySelector(".trellis-task-board-header-controls");
    const timeScaleOverlay = h.document.querySelector(".trellis-task-week-time-scale");
    showLaneToggles(boardOverlay);
    await nextTick();
    changeCheckbox(h.document, laneToggleInput(boardOverlay, "WEEK_SUN"), false);
    await nextTick();
    changeCheckbox(h.document, laneToggleInput(boardOverlay, "WEEK_SAT"), false);
    await nextTick();

    assert.equal(h.weekSunLane.visible, false);
    assert.equal(h.weekSatLane.visible, false);
    assert.equal(h.model.getCell("weekMon").geometry.x, 318);
    assert.equal(h.board.geometry.width, 1492);
    assert.equal(timeScaleOverlay.style.display, "block");
    assert.equal(timeScaleOverlay.style.left, "256px");
    assert.equal(timeScaleOverlay.style.width, "1236px");
});

test("task manager hides remembered week time scale when another task board becomes active in full view", async () => {
    const h = makeHarness({ secondaryBoard: true });
    h.setState(h.board, { x: 10, y: 10, width: 700, height: 260 });
    h.graph.setSelectionCell(h.board);
    await nextTick();

    const timeScaleOverlay = h.document.querySelector(".trellis-task-week-time-scale");
    assert.equal(timeScaleOverlay.style.display, "block");

    setAttr(h.secondaryBoard, "task_view_mode", "FULL");
    h.graph.setSelectionCell(h.secondaryBoard);
    await nextTick();

    assert.equal(timeScaleOverlay.style.display, "none");
});

test("task manager normalizes narrow and wide day cards to the lane interior", async () => {
    const h = makeHarness();
    h.weekTueCard.geometry.x = 55;
    h.weekTueCard.geometry.width = 80;
    h.weekTueCard2.geometry.x = -20;
    h.weekTueCard2.geometry.width = 400;
    const stagedGeometry = h.stagedCard.geometry.clone();

    h.graph.setSelectionCell(h.board);
    await nextTick();

    const expectedWidth = h.weekTueLane.geometry.width - 20;
    assert.equal(h.weekTueCard.geometry.x, 10);
    assert.equal(h.weekTueCard.geometry.width, expectedWidth);
    assert.equal(h.weekTueCard2.geometry.x, 10);
    assert.equal(h.weekTueCard2.geometry.width, expectedWidth);
    assert.equal(h.stagedCard.geometry.x, stagedGeometry.x);
    assert.equal(h.stagedCard.geometry.width, stagedGeometry.width);
});

test("task manager dragged cards adopt the destination day-lane width", async () => {
    const h = makeHarness();
    h.stagedCard.geometry.x = 45;
    h.stagedCard.geometry.width = 75;

    h.graph.moveCells([h.stagedCard], 0, 0, false, h.weekTueLane);
    await nextTick();

    assert.equal(h.stagedCard.parent, h.weekTueLane);
    assert.equal(h.stagedCard.geometry.x, 10);
    assert.equal(h.stagedCard.geometry.width, h.weekTueLane.geometry.width - 20);
});

test("task manager day-lane overlay appears only for selected week day lanes", async () => {
    const h = makeHarness();
    const overlay = h.document.querySelector(".trellis-task-selected-day-lane-actions");
    h.setState(h.weekSunLane, { x: 240, y: 28, width: 200, height: 320 });
    h.setState(h.weekLaneCard, { x: 470, y: 60, width: 120, height: 60 });

    h.graph.setSelectionCell(h.board);
    await nextTick();
    assert.equal(overlay.style.display, "none");

    h.graph.setSelectionCell(h.weekLaneCard);
    await nextTick();
    assert.equal(overlay.style.display, "none");

    h.graph.setSelectionCell(h.weekSunLane);
    await nextTick();
    assert.equal(overlay.style.display, "flex");
    assert.equal(overlay.style.top, "357px");
    assert.equal(overlay.style.flexDirection, "column");
    assert.equal(overlay.style.alignItems, "stretch");
    assert.ok(buttonByText(overlay, "Change Hours"));
    assert.ok(buttonByText(overlay, "Add Break"));
    assert.equal(buttonByText(overlay, "Close Day").style.display, "");
    assert.equal(buttonByText(overlay, "Close Day").getAttribute("data-trellis-button-variant"), "danger"); // NEW
    assert.match(buttonByText(overlay, "Close Day").getAttribute("style") || "", /background:\s*(?:#b91c1c|rgb\(185,\s*28,\s*28\))/); // NEW
    assert.equal(buttonByText(overlay, "Open Day").style.display, "none");
});

test("task manager day-lane overlay opens closes and adds breaks for selected day", async () => {
    const h = makeHarness();
    const overlay = h.document.querySelector(".trellis-task-selected-day-lane-actions");
    h.setState(h.weekSunLane, { x: 240, y: 28, width: 200, height: 320 });
    h.graph.setSelectionCell(h.weekSunLane);
    await nextTick();

    buttonByText(overlay, "Change Hours").click();
    const timeInputs = Array.from(h.lastDialog.querySelectorAll("input[type='time']"));
    timeInputs[0].value = "07:00";
    timeInputs[1].value = "10:30";
    buttonByText(h.lastDialog, "Save").click();
    await nextTick();
    assert.deepEqual(selectedWeekOverrideDay(h, 0), { closed: false, startMinute: 420, endMinute: 630 });

    buttonByText(overlay, "Close Day").click();
    await nextTick();
    assert.equal(selectedWeekOverrideDay(h, 0).closed, true);
    assert.equal(selectedWeekOverrideDay(h, 0).startMinute, 420);
    assert.equal(selectedWeekOverrideDay(h, 0).endMinute, 630);
    assert.equal(buttonByText(overlay, "Add Break").style.display, "none");
    assert.equal(buttonByText(overlay, "Open Day").style.display, "");

    buttonByText(overlay, "Open Day").click();
    await nextTick();
    assert.deepEqual(selectedWeekOverrideDay(h, 0), { closed: false, startMinute: 420, endMinute: 630 });
    assert.equal(buttonByText(overlay, "Add Break").style.display, "");

    buttonByText(overlay, "Add Break").click();
    await nextTick();
    assert.ok(h.weekSunLane.children.some(cell => attr(cell, "schedule_break") === "1"));
    assert.equal(buttonByText(overlay, "Close Day").style.display, "none");
});

test("task manager day-lane overlay hides open close on non-empty days and hides add break when closed", async () => {
    const h = makeHarness();
    const overlay = h.document.querySelector(".trellis-task-selected-day-lane-actions");
    h.setState(h.weekWedLane, { x: 460, y: 748, width: 200, height: 160 });
    h.graph.setSelectionCell(h.weekWedLane);
    await nextTick();

    assert.equal(buttonByText(overlay, "Add Break").style.display, "");
    assert.equal(buttonByText(overlay, "Open Day").style.display, "none");
    assert.equal(buttonByText(overlay, "Close Day").style.display, "none");

    setAttr(h.board, "task_work_hours_week_overrides_json", JSON.stringify({
        weeks: { "2026-07-12": { days: [{}, {}, {}, { closed: true }, {}, {}, {}] } }
    }));
    h.fireModelChange();
    await nextTick();

    assert.equal(buttonByText(overlay, "Add Break").style.display, "none");
    assert.equal(buttonByText(overlay, "Open Day").style.display, "none");
    assert.equal(buttonByText(overlay, "Close Day").style.display, "none");
});

test("task manager day-lane change hours dialog saves only selected weekday override", async () => {
    const h = makeHarness();
    const overlay = h.document.querySelector(".trellis-task-selected-day-lane-actions");
    h.setState(h.weekSunLane, { x: 240, y: 28, width: 200, height: 320 });
    h.graph.setSelectionCell(h.weekSunLane);
    await nextTick();

    buttonByText(overlay, "Change Hours").click();
    const timeInputs = Array.from(h.lastDialog.querySelectorAll("input[type='time']"));
    timeInputs[0].value = "07:00";
    timeInputs[1].value = "10:30";
    buttonByText(h.lastDialog, "Save").click();
    await nextTick();

    assert.deepEqual(selectedWeekOverrideDay(h, 0), { closed: false, startMinute: 420, endMinute: 630 });
    assert.equal(selectedWeekOverrideDay(h, 3).startMinute, 1020);
    assert.equal(selectedWeekOverrideDay(h, 3).endMinute, 1140);
});

test("task manager day-lane vertical resize edits selected-week hours by moved edge", async () => {
    const h = makeHarness();
    h.graph.setSelectionCell(h.weekWedLane);
    await nextTick();

    let previousGeometry = h.weekWedLane.geometry.clone();
    h.graph.resizeCells([h.weekWedLane]);
    h.weekWedLane.geometry.height += 80;
    h.fireModelChange({ changes: [h.geometryChange(h.weekWedLane, previousGeometry)] });
    await nextTick();
    assert.equal(selectedWeekOverrideDay(h, 3).startMinute, 1020);
    assert.equal(selectedWeekOverrideDay(h, 3).endMinute, 1200);

    previousGeometry = h.weekWedLane.geometry.clone();
    h.graph.resizeCells([h.weekWedLane]);
    h.weekWedLane.geometry.y -= 40;
    h.weekWedLane.geometry.height += 40;
    h.fireModelChange({ changes: [h.geometryChange(h.weekWedLane, previousGeometry)] });
    await nextTick();
    assert.equal(selectedWeekOverrideDay(h, 3).startMinute, 990);
    assert.equal(selectedWeekOverrideDay(h, 3).endMinute, 1200);

    previousGeometry = h.weekWedLane.geometry.clone();
    h.graph.resizeCells([h.weekWedLane]);
    h.weekWedLane.geometry.y -= 40;
    h.weekWedLane.geometry.height += 80;
    h.fireModelChange({ changes: [h.geometryChange(h.weekWedLane, previousGeometry)] });
    await nextTick();
    assert.equal(selectedWeekOverrideDay(h, 3).startMinute, 960);
    assert.equal(selectedWeekOverrideDay(h, 3).endMinute, 1230);
});

test("task manager shrinking day-lane hours keeps cards visible and marks overflow", async () => {
    const h = makeHarness();
    h.graph.setSelectionCell(h.weekWedLane);
    await nextTick();

    const previousGeometry = h.weekWedLane.geometry.clone();
    h.graph.resizeCells([h.weekWedLane]);
    h.weekWedLane.geometry.height -= 120;
    h.fireModelChange({ changes: [h.geometryChange(h.weekWedLane, previousGeometry)] });
    await nextTick();

    assert.equal(selectedWeekOverrideDay(h, 3).endMinute, 1050);
    assert.equal(h.weekLaneCard.visible, true);
    assert.match(h.weekLaneCard.style, /strokeColor=#B91C1C/);
});

test("task manager overflow cards do not auto-expand day lanes or persist hours", async () => {
    const h = makeHarness();
    h.graph.setSelectionCell(h.board);
    await nextTick();
    const initialLaneHeight = h.weekWedLane.geometry.height;
    const overflowCard = addHarnessCard(h, h.weekWedLane, "overflowWedCard", {
        workflow_state: "TODO",
        assigned_day: "2026-07-15",
        start: "2026-07-15",
        end: "2026-07-15",
        task_estimated_hours: "2"
    });

    h.fireModelChange({ changes: [h.childChange(overflowCard, null)] });
    await nextTick();
    const automaticGrowthPreviousGeometry = h.weekWedLane.geometry.clone();
    h.weekWedLane.geometry.height += 160;
    h.fireModelChange({ changes: [h.geometryChange(h.weekWedLane, automaticGrowthPreviousGeometry)] });
    await nextTick();

    assert.equal(h.weekWedLane.geometry.height, initialLaneHeight);
    assert.equal(attr(h.board, "task_work_hours_week_overrides_json"), null);
    assert.equal(overflowCard.visible, true);
    assert.equal(attr(overflowCard, "schedule_start_minute"), "1080");
    assert.equal(attr(overflowCard, "schedule_duration_minutes"), "120");
    assert.match(overflowCard.style, /strokeColor=#B91C1C/);
});

test("task manager week selection only reflows when active day changes", async () => {
    const h = makeHarness();
    h.graph.setSelectionCell(h.weekTueCard);
    await nextTick();

    assert.equal(attr(h.board, "task_selected_day"), "2026-07-14");
    assert.ok(h.geometrySetCount > 0);

    h.resetCounters();
    h.graph.setSelectionCell(h.weekTueCard2);
    await nextTick();

    const counters = h.reflowCounters();
    assert.equal(attr(h.board, "task_selected_day"), "2026-07-14");
    assert.equal(h.geometrySetCount, 0);
    assert.equal(h.labelSetCount, 0);
    assert.equal(counters.badges, 1);
    assert.equal(counters.classification, 0);
    assert.equal(counters.layout, 0);
    assert.equal(counters.lanes, 0);
    assert.equal(counters.boardLayout, 0);
    assert.equal(counters.schedulePack, 0);
    assert.ok(counters.labelWriteSkip > 0);
});

test("task manager note-only edits refresh badges without layout", async () => {
    const h = makeHarness();
    const overlay = h.document.querySelector(".trellis-task-selected-card-actions");
    h.setState(h.card1, { x: 30, y: 60, width: 120, height: 60 });
    h.graph.setSelectionCell(h.card1);
    await nextTick();

    h.resetCounters();
    buttonByText(overlay, "Clear Note").click();
    await nextTick();

    const counters = h.reflowCounters();
    assert.equal(attr(h.card1, "card_note"), null);
    assert.equal(h.geometrySetCount, 0);
    assert.equal(counters.classification, 0);
    assert.equal(counters.layout, 0);
    assert.equal(counters.lanes, 0);
    assert.equal(counters.boardLayout, 0);
    assert.equal(counters.schedulePack, 0);
    assert.equal(h.card1.parent, h.todoLane);
    assert.doesNotMatch(attr(h.card1, "label"), /<b>Note:<\/b>/);
});

test("task manager unchanged badge refresh skips label rewrites", async () => {
    const h = makeHarness();
    h.graph.setSelectionCell(h.weekTueCard);
    await nextTick();

    h.resetCounters();
    h.graph.setSelectionCell(h.weekTueCard2);
    await nextTick();

    const counters = h.reflowCounters();
    assert.equal(attr(h.board, "task_selected_day"), "2026-07-14");
    assert.equal(h.geometrySetCount, 0);
    assert.equal(h.labelSetCount, 0);
    assert.ok(counters.labelWriteSkip > 0);
});

test("task manager restores staged card style when week card is dragged back to staged", async () => {
    const h = makeHarness();
    h.weekLaneCard.setStyle("whiteSpace=wrap;html=1;fillColor=#D5E8D4;strokeColor=#000000;customFlag=keep;");
    setAttr(h.weekLaneCard, "workflow_state", "DONE");
    setAttr(h.weekLaneCard, "completed", "2026-07-15");
    setAttr(h.weekLaneCard, "schedule_start_minute", "360");
    setAttr(h.weekLaneCard, "schedule_duration_minutes", "120");
    h.weekLaneCard.geometry.height = 160;

    h.resetCounters();
    h.graph.moveCells([h.weekLaneCard], 0, 0, false, h.stagedLane);
    await nextTick();

    const counters = h.reflowCounters();
    assert.equal(h.stagedLane.children.includes(h.weekLaneCard), true);
    assert.equal(attr(h.weekLaneCard, "workflow_state"), "STAGED");
    assert.equal(attr(h.weekLaneCard, "assigned_day"), null);
    assert.equal(attr(h.weekLaneCard, "completed"), null);
    assert.equal(attr(h.weekLaneCard, "manual_staged"), "1");
    assert.equal(h.weekLaneCard.geometry.height, 80);
    assert.equal(attr(h.weekLaneCard, "schedule_start_minute"), "360");
    assert.equal(attr(h.weekLaneCard, "schedule_duration_minutes"), "120");
    assert.match(h.weekLaneCard.style, /fillColor=swimlane/);
    assert.match(h.weekLaneCard.style, /customFlag=keep/);
    assert.doesNotMatch(h.weekLaneCard.style, /fillColor=#D5E8D4/);
    assert.doesNotMatch(h.weekLaneCard.style, /strokeColor=#000000/);
    assert.ok(counters.classification > 0);
    assert.ok(counters.lanes > 0);
    assert.ok(counters.layout > 0);
});

test("task manager toggles destination view labels, arrows, and board selection", async () => {
    const h = makeHarness();
    const boardOverlay = h.document.querySelector(".trellis-task-board-header-controls");
    h.setState(h.board, { x: 10, y: 10, width: 700, height: 260 });
    h.graph.setSelectionCell(h.board);
    await nextTick();

    assert.equal(boardOverlay.firstChild.textContent, "Mode: Week");
    assert.equal(modeToggleButton(boardOverlay).textContent, "Switch to Full view");
    assert.equal(modeToggleButton(boardOverlay).getAttribute("aria-pressed"), "true");
    assert.equal(buttonByText(boardOverlay, "<").style.display, "");
    assert.equal(buttonByText(boardOverlay, ">").style.display, "");
    assert.equal(buttonByText(boardOverlay, "This Week").style.display, "");

    modeToggleButton(boardOverlay).click();
    await nextTick();

    assert.equal(attr(h.board, "task_view_mode"), "FULL");
    assert.equal(h.graph.getSelectionCell(), h.board);
    assert.equal(boardOverlay.firstChild.textContent, "Mode: Full");
    assert.equal(modeToggleButton(boardOverlay).textContent, "Switch to Week view");
    assert.equal(modeToggleButton(boardOverlay).getAttribute("aria-pressed"), "false");
    assert.equal(buttonByText(boardOverlay, "<").style.display, "none");
    assert.equal(buttonByText(boardOverlay, ">").style.display, "none");
    assert.equal(buttonByText(boardOverlay, "Today").style.display, "none");

    modeToggleButton(boardOverlay).click();
    await nextTick();

    assert.equal(attr(h.board, "task_view_mode"), "WEEK");
    assert.equal(boardOverlay.firstChild.textContent, "Mode: Week");
    assert.equal(modeToggleButton(boardOverlay).textContent, "Switch to Full view");
    assert.equal(buttonByText(boardOverlay, "<").style.display, "");
    assert.equal(buttonByText(boardOverlay, ">").style.display, "");

    h.setState(h.weekWedLane, { x: 460, y: 40, width: 200, height: 960 });
    h.graph.setSelectionCell(h.weekWedLane);
    await nextTick();

    assert.equal(h.graph.getSelectionCell(), h.weekWedLane);
    modeToggleButton(boardOverlay).click();
    await nextTick();

    assert.equal(attr(h.board, "task_view_mode"), "FULL");
    assert.equal(h.graph.getSelectionCell(), h.board);
    assert.equal(boardOverlay.style.display, "flex");
    assert.equal(boardOverlay.firstChild.textContent, "Mode: Full");
    assert.equal(modeToggleButton(boardOverlay).textContent, "Switch to Week view");
});

test("task manager board controls show current-mode lane toggles and apply visibility", async () => {
    const h = makeHarness();
    const boardOverlay = h.document.querySelector(".trellis-task-board-header-controls");
    h.setState(h.board, { x: 10, y: 10, width: 900, height: 260 });
    h.graph.setSelectionCell(h.board);
    await nextTick();

    assert.equal(laneTogglePanel(boardOverlay).style.display, "none");
    assert.equal(columnsToggleButton(boardOverlay).getAttribute("aria-expanded"), "false");
    showLaneToggles(boardOverlay);
    await nextTick();
    assert.equal(laneTogglePanel(boardOverlay).style.display, "block");
    assert.equal(columnsToggleButton(boardOverlay).getAttribute("aria-expanded"), "true");
    assert.equal(boardOverlay.querySelector(".trellis-task-board-lane-toggles").style.flexWrap, "nowrap");
    assert.deepEqual(laneToggleKeys(boardOverlay), ["TODO_STAGED", "WEEK_SUN", "WEEK_MON", "WEEK_TUE", "WEEK_WED", "WEEK_THU", "WEEK_FRI", "WEEK_SAT"]);
    assert.equal(laneToggleInput(boardOverlay, "TODO"), null);

    modeToggleButton(boardOverlay).click();
    await nextTick();

    assert.equal(attr(h.board, "task_view_mode"), "FULL");
    assert.equal(laneTogglePanel(boardOverlay).style.display, "none");
    showLaneToggles(boardOverlay);
    await nextTick();
    assert.ok(laneToggleInput(boardOverlay, "TODO"));
    assert.equal(laneToggleInput(boardOverlay, "WEEK_WED"), null);
    assert.equal(h.todoLane.visible, true);
    assert.equal(h.board.geometry.width, 2836);

    changeCheckbox(h.document, laneToggleInput(boardOverlay, "TODO"), false);
    await nextTick();

    const hiddenTodoState = JSON.parse(attr(h.board, "task_visible_lane_keys_json"));
    assert.equal(h.todoLane.visible, false);
    assert.equal(h.doingLane.visible, true);
    assert.equal(h.board.geometry.width, 2600);
    assert.equal(hiddenTodoState.FULL.includes("TODO"), false);
    assert.equal(hiddenTodoState.WEEK.includes("WEEK_WED"), true);
    assert.equal(h.graph.getSelectionCell(), h.board);

    changeCheckbox(h.document, laneToggleInput(boardOverlay, "TODO"), true);
    await nextTick();

    const restoredTodoState = JSON.parse(attr(h.board, "task_visible_lane_keys_json"));
    assert.equal(h.todoLane.visible, true);
    assert.equal(h.board.geometry.width, 2836);
    assert.equal(restoredTodoState.FULL.includes("TODO"), true);
});

test("task manager lane toggles keep full and week selections independent", async () => {
    const h = makeHarness();
    const boardOverlay = h.document.querySelector(".trellis-task-board-header-controls");
    h.graph.setSelectionCell(h.board);
    await nextTick();

    modeToggleButton(boardOverlay).click();
    await nextTick();
    showLaneToggles(boardOverlay);
    await nextTick();
    changeCheckbox(h.document, laneToggleInput(boardOverlay, "TODO"), false);
    await nextTick();

    modeToggleButton(boardOverlay).click();
    await nextTick();
    showLaneToggles(boardOverlay);
    await nextTick();
    changeCheckbox(h.document, laneToggleInput(boardOverlay, "WEEK_WED"), false);
    await nextTick();

    let state = JSON.parse(attr(h.board, "task_visible_lane_keys_json"));
    assert.equal(state.FULL.includes("TODO"), false);
    assert.equal(state.WEEK.includes("WEEK_WED"), false);
    assert.equal(h.weekWedLane.visible, false);
    assert.equal(h.weekTueLane.visible, true);

    modeToggleButton(boardOverlay).click();
    await nextTick();
    showLaneToggles(boardOverlay);
    await nextTick();
    assert.equal(laneToggleInput(boardOverlay, "TODO").checked, false);
    assert.equal(h.todoLane.visible, false);

    modeToggleButton(boardOverlay).click();
    await nextTick();
    showLaneToggles(boardOverlay);
    await nextTick();
    assert.equal(laneToggleInput(boardOverlay, "WEEK_WED").checked, false);
    assert.equal(h.weekWedLane.visible, false);
    state = JSON.parse(attr(h.board, "task_visible_lane_keys_json"));
    assert.deepEqual(state.WEEK.filter(key => key === "WEEK_WED"), []);
});

test("task manager lane toggles keep at least one lane visible and expand legacy folded lanes", async () => {
    const h = makeHarness();
    const boardOverlay = h.document.querySelector(".trellis-task-board-header-controls");
    setAttr(h.board, "task_view_mode", "FULL");
    setAttr(h.board, "task_visible_lane_keys_json", JSON.stringify({ schemaVersion: 1, FULL: ["TODO"], WEEK: ["TODO_STAGED"] }));
    h.todoLane.collapsed = true;
    h.graph.setSelectionCell(h.board);
    await nextTick();
    showLaneToggles(boardOverlay);
    await nextTick();

    const todoToggle = laneToggleInput(boardOverlay, "TODO");
    assert.equal(todoToggle.checked, true);
    assert.equal(todoToggle.disabled, true);
    assert.equal(h.todoLane.visible, true);
    assert.equal(h.doingLane.visible, false);
    assert.equal(h.todoLane.collapsed, false);

    changeCheckbox(h.document, todoToggle, false);
    await nextTick();

    const state = JSON.parse(attr(h.board, "task_visible_lane_keys_json"));
    assert.equal(laneToggleInput(boardOverlay, "TODO").checked, true);
    assert.equal(laneToggleInput(boardOverlay, "TODO").disabled, true);
    assert.deepEqual(state.FULL, ["TODO"]);
    assert.equal(h.todoLane.visible, true);
});

test("task manager week day cards show workflow colors and time badge", async () => {
    const h = makeHarness();
    h.graph.setSelectionCell(h.weekWedLane);
    await nextTick();

    assert.match(h.weekLaneCard.style, /fillColor=#F8CECC/);
    assert.match(attr(h.weekLaneCard, "label"), /<b>Time:<\/b> 5:00 PM-6:00 PM/);

    setAttr(h.weekLaneCard, "workflow_state", "DOING");
    setAttr(h.board, "task_selected_day", "2026-07-12");
    h.graph.setSelectionCell(h.weekWedLane);
    await nextTick();
    assert.match(h.weekLaneCard.style, /fillColor=#FFF2CC/);

    setAttr(h.weekLaneCard, "workflow_state", "DONE");
    setAttr(h.board, "task_selected_day", "2026-07-12");
    h.graph.setSelectionCell(h.weekWedLane);
    await nextTick();
    assert.match(h.weekLaneCard.style, /fillColor=#D5E8D4/);
});

test("task manager adds break cards and derives stacked schedule attributes", async () => {
    const h = makeHarness();
    const boardOverlay = h.document.querySelector(".trellis-task-board-header-controls");
    h.setState(h.board, { x: 10, y: 10, width: 700, height: 260 });
    h.setState(h.weekWedLane, { x: 460, y: 40, width: 200, height: 960 });
    h.graph.setSelectionCell(h.weekWedLane);
    await nextTick();

    buttonByText(boardOverlay, "Add Break").click();
    await nextTick();

    const breakCard = h.weekWedLane.children.find(cell => attr(cell, "schedule_break") === "1");
    assert.ok(breakCard);
    assert.equal(attr(breakCard, "assigned_day"), "2026-07-15");
    assert.equal(attr(breakCard, "schedule_duration_minutes"), "30");
    assert.equal(attr(h.weekLaneCard, "schedule_start_minute"), "1020");
    assert.equal(attr(breakCard, "schedule_start_minute"), "1080");
    assert.match(attr(breakCard, "label"), /<b>Time:<\/b> 6:00 PM-6:30 PM/);
    assert.match(breakCard.style, /fillColor=#F3F4F6/);
    assert.match(breakCard.style, /strokeColor=#6B7280/);
});

test("task manager hides day-owned breaks outside their visible week", async () => {
    const h = makeHarness();
    const boardOverlay = h.document.querySelector(".trellis-task-board-header-controls");
    h.graph.setSelectionCell(h.weekWedLane);
    await nextTick();
    buttonByText(boardOverlay, "Add Break").click();
    await nextTick();
    const breakCard = h.weekWedLane.children.find(cell => attr(cell, "schedule_break") === "1");
    assert.equal(attr(breakCard, "assigned_day"), "2026-07-15");

    setAttr(h.board, "task_selected_week_start", "2026-07-19");
    setAttr(h.board, "task_selected_day", "2026-07-22");
    h.graph.setSelectionCell(h.board);
    await nextTick();

    assert.equal(breakCard.visible, false);
    assert.equal(attr(breakCard, "schedule_start_minute"), null);
    assert.equal(attr(breakCard, "schedule_duration_minutes"), "30");

    setAttr(h.board, "task_selected_week_start", "2026-07-12");
    setAttr(h.board, "task_selected_day", "2026-07-15");
    h.graph.setSelectionCell(h.board);
    await nextTick();
    assert.equal(breakCard.visible, true);
    assert.equal(h.weekWedLane.children.indexOf(h.weekLaneCard) < h.weekWedLane.children.indexOf(breakCard), true);
    assert.equal(attr(h.weekLaneCard, "schedule_start_minute"), "1020");
    assert.equal(attr(breakCard, "schedule_start_minute"), "1080");
    assert.equal(attr(breakCard, "schedule_duration_minutes"), "30");
    assert.match(attr(breakCard, "label"), /<b>Time:<\/b> 6:00 PM-6:30 PM/);
    assert.equal(attr(breakCard, "schedule_order"), "1");
    assert.equal(attr(breakCard, "schedule_order_day"), "2026-07-15");
});

test("task manager same-lane reorder refreshes persisted schedule order", async () => {
    const h = makeHarness();
    const boardOverlay = h.document.querySelector(".trellis-task-board-header-controls");
    h.graph.setSelectionCell(h.weekWedLane);
    await nextTick();
    buttonByText(boardOverlay, "Add Break").click();
    await nextTick();
    const breakCard = h.weekWedLane.children.find(cell => attr(cell, "schedule_break") === "1");
    h.graph.moveCells([breakCard], 0, -100, false, null); // CHANGE: reorder through the real same-lane move path
    await nextTick();

    assert.equal(attr(breakCard, "schedule_start_minute"), "1020");
    assert.equal(attr(h.weekLaneCard, "schedule_start_minute"), "1050");
    assert.equal(attr(breakCard, "schedule_order"), "0");
    assert.equal(attr(h.weekLaneCard, "schedule_order"), "1");
});

test("task manager assigns times from same-lane drop order and recalculates overflow", async () => {
    const h = makeHarness();
    const secondCard = addHarnessCard(h, h.weekWedLane, "secondWedCard", { workflow_state: "TODO", assigned_day: "2026-07-15", start: "2026-07-15", end: "2026-07-15" });
    const lastCard = addHarnessCard(h, h.weekWedLane, "lastWedCard", { workflow_state: "TODO", assigned_day: "2026-07-15", start: "2026-07-15", end: "2026-07-15" });
    h.graph.setSelectionCell(h.board);
    await nextTick();

    h.graph.moveCells([lastCard], 0, -220, false, null); // NEW: cross both stationary midpoints
    await nextTick();

    assert.deepEqual(h.weekWedLane.children.slice(0, 3).map(card => card.id), [lastCard.id, h.weekLaneCard.id, secondCard.id]);
    assert.equal(attr(lastCard, "schedule_order"), "0");
    assert.equal(attr(h.weekLaneCard, "schedule_order"), "1");
    assert.equal(attr(secondCard, "schedule_order"), "2");
    assert.equal(attr(lastCard, "schedule_start_minute"), "1020");
    assert.equal(attr(h.weekLaneCard, "schedule_start_minute"), "1080");
    assert.equal(attr(secondCard, "schedule_start_minute"), "1140");
    assert.equal(lastCard.geometry.y, 0);
    assert.equal(h.weekLaneCard.geometry.y, 80);
    assert.equal(secondCard.geometry.y, 160);
    assert.match(attr(lastCard, "label"), /<b>Time:<\/b> 5:00 PM-6:00 PM/);
    assert.doesNotMatch(lastCard.style, /strokeColor=#B91C1C/);
    assert.match(secondCard.style, /strokeColor=#B91C1C/);

    setAttr(h.board, "task_selected_week_start", "2026-07-19");
    setAttr(h.board, "task_selected_day", "2026-07-22");
    h.graph.setSelectionCell(h.board);
    await nextTick();
    setAttr(h.board, "task_selected_week_start", "2026-07-12");
    setAttr(h.board, "task_selected_day", "2026-07-15");
    h.graph.setSelectionCell(h.board);
    await nextTick();

    assert.deepEqual(h.weekWedLane.children.slice(0, 3).map(card => card.id), [lastCard.id, h.weekLaneCard.id, secondCard.id]);
    assert.equal(attr(lastCard, "schedule_start_minute"), "1020");
});

test("task manager midpoint drops support between after-last and unchanged slots", async () => {
    const h = makeHarness();
    const secondCard = addHarnessCard(h, h.weekWedLane, "midpointSecond", { workflow_state: "TODO", assigned_day: "2026-07-15", start: "2026-07-15", end: "2026-07-15" });
    const lastCard = addHarnessCard(h, h.weekWedLane, "midpointLast", { workflow_state: "TODO", assigned_day: "2026-07-15", start: "2026-07-15", end: "2026-07-15" });
    h.graph.setSelectionCell(h.board);
    await nextTick();

    h.graph.moveCells([lastCard], 0, -100, false, null); // NEW: midpoint lands between the first two cards
    await nextTick();
    assert.deepEqual(h.weekWedLane.children.slice(0, 3).map(card => card.id), [h.weekLaneCard.id, lastCard.id, secondCard.id]);

    h.graph.moveCells([lastCard], 0, 10, false, null); // NEW: does not cross the following midpoint
    await nextTick();
    assert.deepEqual(h.weekWedLane.children.slice(0, 3).map(card => card.id), [h.weekLaneCard.id, lastCard.id, secondCard.id]);

    h.graph.moveCells([lastCard], 0, 200, false, null); // NEW: midpoint crosses the final card
    await nextTick();
    assert.deepEqual(h.weekWedLane.children.slice(0, 3).map(card => card.id), [h.weekLaneCard.id, secondCard.id, lastCard.id]);
});

test("task manager inserts cross-day task and break drops by position", async () => {
    const h = makeHarness();
    const wedFollower = addHarnessCard(h, h.weekWedLane, "wedFollower", { workflow_state: "TODO", assigned_day: "2026-07-15", start: "2026-07-15", end: "2026-07-15" });
    const boardOverlay = h.document.querySelector(".trellis-task-board-header-controls");
    h.graph.setSelectionCell(h.weekWedLane);
    await nextTick();
    buttonByText(boardOverlay, "Add Break").click();
    await nextTick();
    const breakCard = h.weekWedLane.children.find(cell => attr(cell, "schedule_break") === "1");

    h.graph.moveCells([h.weekLaneCard], 0, 60, false, h.weekTueLane); // NEW: insert between Tuesday tasks
    await nextTick();
    assert.deepEqual(h.weekTueLane.children.slice(0, 3).map(card => card.id), [h.weekTueCard.id, h.weekLaneCard.id, h.weekTueCard2.id]);
    assert.equal(attr(h.weekLaneCard, "assigned_day"), "2026-07-14");
    assert.equal(attr(h.weekLaneCard, "schedule_start_minute"), "1080");
    assert.equal(attr(wedFollower, "schedule_start_minute"), "1020"); // NEW: source lane closes its gap

    h.graph.moveCells([breakCard], 0, -300, false, h.weekTueLane); // NEW: move the break before every Tuesday task
    await nextTick();
    assert.equal(h.weekTueLane.children[0], breakCard);
    assert.equal(attr(breakCard, "assigned_day"), "2026-07-14");
    assert.equal(attr(breakCard, "schedule_duration_minutes"), "30");
    assert.equal(attr(breakCard, "schedule_start_minute"), "1020");
    assert.equal(attr(h.weekTueCard, "schedule_start_minute"), "1050");
});

test("task manager keeps multi-card schedule moves contiguous", async () => {
    const h = makeHarness();
    const secondCard = addHarnessCard(h, h.weekWedLane, "blockSecond", { workflow_state: "TODO", assigned_day: "2026-07-15", start: "2026-07-15", end: "2026-07-15" });
    const thirdCard = addHarnessCard(h, h.weekWedLane, "blockThird", { workflow_state: "TODO", assigned_day: "2026-07-15", start: "2026-07-15", end: "2026-07-15" });
    const lastCard = addHarnessCard(h, h.weekWedLane, "blockLast", { workflow_state: "TODO", assigned_day: "2026-07-15", start: "2026-07-15", end: "2026-07-15" });
    h.graph.setSelectionCell(h.board);
    await nextTick();

    h.graph.moveCells([secondCard, thirdCard], 0, 200, false, null);
    await nextTick();

    assert.deepEqual(h.weekWedLane.children.slice(0, 4).map(card => card.id), [h.weekLaneCard.id, lastCard.id, secondCard.id, thirdCard.id]);
    assert.equal(attr(secondCard, "schedule_order"), "2");
    assert.equal(attr(thirdCard, "schedule_order"), "3");
});

test("task manager reflows source and destination schedules across boards", async () => {
    const h = makeHarness({ secondaryBoard: true });
    const sourceFollower = addHarnessCard(h, h.weekWedLane, "crossBoardFollower", { workflow_state: "TODO", assigned_day: "2026-07-15", start: "2026-07-15", end: "2026-07-15" });
    h.graph.setSelectionCell(h.board);
    await nextTick();
    h.graph.setSelectionCell(h.secondaryBoard);
    await nextTick();

    h.graph.moveCells([h.weekLaneCard], 0, 60, false, h.secondaryWeekWedLane);
    await nextTick();

    assert.deepEqual(h.secondaryWeekWedLane.children.slice(0, 2).map(card => card.id), [h.secondaryWeekWedCard.id, h.weekLaneCard.id]);
    assert.equal(attr(h.secondaryWeekWedCard, "schedule_start_minute"), "1020");
    assert.equal(attr(h.weekLaneCard, "schedule_start_minute"), "1080");
    assert.equal(attr(sourceFollower, "schedule_start_minute"), "1020");
});

test("task manager card resize and horizontal movement do not reorder schedules", async () => {
    const h = makeHarness();
    const secondCard = addHarnessCard(h, h.weekWedLane, "resizeOrderSecond", { workflow_state: "TODO", assigned_day: "2026-07-15", start: "2026-07-15", end: "2026-07-15" });
    h.graph.setSelectionCell(h.board);
    await nextTick();
    const originalOrder = h.weekWedLane.children.slice(0, 2).map(card => card.id);
    const previousResizeGeometry = h.weekLaneCard.geometry.clone();

    h.weekLaneCard.geometry.height = 160;
    h.fireModelChange({ changes: [h.geometryChange(h.weekLaneCard, previousResizeGeometry)] });
    await nextTick();
    assert.deepEqual(h.weekWedLane.children.slice(0, 2).map(card => card.id), originalOrder);
    assert.equal(attr(h.weekLaneCard, "schedule_duration_minutes"), "120");

    const previousMoveGeometry = secondCard.geometry.clone();
    h.graph.moveCells([secondCard], 40, 0, false, null);
    h.fireModelChange({ changes: [h.geometryChange(secondCard, previousMoveGeometry)] });
    await nextTick();
    assert.deepEqual(h.weekWedLane.children.slice(0, 2).map(card => card.id), originalOrder);
    assert.equal(attr(secondCard, "schedule_order"), "1");
});

test("task manager migrates existing undated breaks to the visible lane date", async () => {
    const h = makeHarness();
    const boardOverlay = h.document.querySelector(".trellis-task-board-header-controls");
    h.graph.setSelectionCell(h.weekWedLane);
    await nextTick();
    buttonByText(boardOverlay, "Add Break").click();
    await nextTick();
    const breakCard = h.weekWedLane.children.find(cell => attr(cell, "schedule_break") === "1");
    setAttr(breakCard, "assigned_day", null);

    h.graph.setSelectionCell(h.board);
    await nextTick();

    assert.equal(attr(breakCard, "assigned_day"), "2026-07-15");
    assert.equal(breakCard.visible, true);
});

test("task manager allocates selected staged cards to clamped start dates", async () => {
    const h = makeHarness({ initialNonDayLaneHeight: 500 }); // CHANGE: keep bulk-operation fixtures on one page
    const overlay = h.document.querySelector(".trellis-task-selected-card-actions");
    [h.stagedCard, h.stagedBeforeCard, h.stagedAfterCard, h.stagedInvalidCard].forEach((card, index) => {
        h.setState(card, { x: 30, y: 60 + (index * 70), width: 120, height: 60 });
    });
    h.graph.setSelectionCells([h.stagedCard, h.stagedBeforeCard, h.stagedAfterCard, h.stagedInvalidCard]);
    await nextTick();

    const allocateButton = buttonByText(overlay, "Allocate to Start Dates");
    assert.ok(allocateButton);
    assert.equal(allocateButton.style.display, "");

    allocateButton.click();
    await nextTick();

    assert.equal(h.weekTueLane.children.includes(h.stagedCard), true);
    assert.equal(h.weekSunLane.children.includes(h.stagedBeforeCard), true);
    assert.equal(h.weekSatLane.children.includes(h.stagedAfterCard), true);
    assert.equal(h.stagedLane.children.includes(h.stagedInvalidCard), true);
    assert.equal(attr(h.stagedCard, "workflow_state"), "TODO");
    assert.equal(attr(h.stagedCard, "assigned_day"), "2026-07-14");
    assert.equal(attr(h.stagedBeforeCard, "assigned_day"), "2026-07-12");
    assert.equal(attr(h.stagedAfterCard, "assigned_day"), "2026-07-18");
    assert.equal(attr(h.stagedInvalidCard, "workflow_state"), "STAGED");

    h.setState(h.weekLaneCard, { x: 470, y: 60, width: 120, height: 60 });
    h.graph.setSelectionCells([h.stagedInvalidCard, h.weekLaneCard]);
    await nextTick();
    assert.equal(buttonByText(overlay, "Allocate to Start Dates").style.display, "none");
});

test("task manager direct day-lane resize persists selected weekday width", async () => {
    const h = makeHarness();
    const boardOverlay = h.document.querySelector(".trellis-task-board-header-controls");
    h.graph.setSelectionCell(h.weekWedLane);
    await nextTick();
    buttonByText(boardOverlay, "Add Break").click();
    await nextTick();
    const breakCard = h.weekWedLane.children.find(cell => attr(cell, "schedule_break") === "1");

    const previousGeometry = h.weekWedLane.geometry.clone();
    h.weekWedLane.geometry.width = 1200;
    h.fireModelChange({ changes: [h.geometryChange(h.weekWedLane, previousGeometry)] });
    await nextTick();

    const widths = JSON.parse(attr(h.board, "task_day_lane_widths_json")).widths;
    assert.equal(widths.WEEK_WED, 1200);
    assert.equal(widths.WEEK_TUE, 220);
    assert.equal(h.weekWedLane.geometry.width, 1200);
    assert.equal(h.weekLaneCard.geometry.x, 10);
    assert.equal(h.weekLaneCard.geometry.width, 1180);
    assert.equal(breakCard.geometry.x, 10);
    assert.equal(breakCard.geometry.width, 1180);
    assert.equal(h.stagedLane.geometry.width, 220);
    assert.equal(h.board.geometry.width, 2944);
});

test("task manager rejects direct horizontal day-card geometry changes", async () => {
    const h = makeHarness();
    h.graph.setSelectionCell(h.board);
    await nextTick();
    const expectedDuration = attr(h.weekLaneCard, "schedule_duration_minutes");
    const previousGeometry = h.weekLaneCard.geometry.clone();

    h.weekLaneCard.geometry.x = 45;
    h.weekLaneCard.geometry.width = 70;
    h.fireModelChange({ changes: [h.geometryChange(h.weekLaneCard, previousGeometry)] });
    await nextTick();

    assert.equal(h.weekLaneCard.geometry.x, 10);
    assert.equal(h.weekLaneCard.geometry.width, h.weekWedLane.geometry.width - 20);
    assert.equal(attr(h.weekLaneCard, "schedule_duration_minutes"), expectedDuration);
    assert.equal(attr(h.board, "task_day_lane_widths_json"), null);
});

test("task manager ignores week-lane layout geometry when width is unchanged", async () => {
    const h = makeHarness();
    await nextTick();
    h.resetCounters();

    const previousGeometry = h.weekWedLane.geometry.clone();
    h.weekWedLane.geometry.x += 40;
    h.fireModelChange({ changes: [h.geometryChange(h.weekWedLane, previousGeometry)] });
    await nextTick();

    assert.equal(attr(h.board, "task_day_lane_widths_json"), null);
    assert.equal(attr(h.board, "task_work_hours_week_overrides_json"), null);
    assert.equal(h.reflowCounters().layout, 0);
});

test("task manager replaces legacy board layout ownership with canonical managed styles", async () => {
    const h = makeHarness();
    assert.match(h.board.style, /(?:^|;)childLayout=stackLayout(?:;|$)/);
    assert.match(h.board.style, /(?:^|;)swimlaneFillColor=none(?:;|$)/);

    h.graph.setSelectionCell(h.board);
    await nextTick();

    assert.match(h.board.style, /(?:^|;)swimlaneFillColor=#F8FAFC(?:;|$)/);
    assert.doesNotMatch(h.board.style, /(?:^|;)swimlaneFillColor=none(?:;|$)/);
    assert.doesNotMatch(h.board.style, /(?:^|;)childLayout=/);
    assert.doesNotMatch(h.board.style, /(?:^|;)horizontalStack=/);
    assert.doesNotMatch(h.board.style, /(?:^|;)resizeParent(?:Max)?=/);
    assert.doesNotMatch(h.board.style, /(?:^|;)resizeLast=/);
    assert.doesNotMatch(h.board.style, /(?:^|;)stackBorder=/);
    assert.match(h.board.style, /(?:^|;)resizable=1(?:;|$)/);
    h.board.children.filter(cell => attr(cell, "lane_key") && !String(attr(cell, "lane_key")).startsWith("WEEK_")).forEach(lane => {
        assert.match(lane.style, /(?:^|;)childLayout=stackLayout(?:;|$)/);
        assert.match(lane.style, /(?:^|;)horizontalStack=0(?:;|$)/);
        assert.match(lane.style, /(?:^|;)resizeParent=0(?:;|$)/);
        assert.doesNotMatch(lane.style, /(?:^|;)resizeParent=1(?:;|$)/);
    });
    [h.weekSunLane, h.weekWedLane].forEach(lane => {
        assert.doesNotMatch(lane.style, /(?:^|;)childLayout=stackLayout(?:;|$)/);
        assert.match(lane.style, /(?:^|;)resizeParent=0(?:;|$)/);
    });
    assert.match(h.weekSunLane.style, /(?:^|;)collapsible=0(?:;|$)/);
    assert.match(h.weekWedLane.style, /(?:^|;)collapsible=0(?:;|$)/);
    assert.match(h.stagedLane.style, /(?:^|;)collapsible=0(?:;|$)/);
    assert.match(h.todoLane.style, /(?:^|;)collapsible=0(?:;|$)/);
});

test("task manager full-mode board resize persists lane height and refreshes paging", async () => {
    const h = makeHarness();
    setAttr(h.board, "task_view_mode", "FULL");
    h.graph.setSelectionCell(h.board);
    await nextTick();
    for (let i = 0; i < 4; i++) addHarnessCard(h, h.todoLane, `todoExtra${i}`, { workflow_state: "TODO", start: `2026-07-${10 + i}` });
    setAttr(h.todoLane, "page_index", "5");
    h.resetCounters();

    const previousGeometry = h.board.geometry.clone();
    h.board.geometry.height = 324;
    h.fireModelChange({ changes: [h.geometryChange(h.board, previousGeometry)] });
    await nextTick();

    const visibleTodoCards = h.todoLane.children.filter(cell => attr(cell, "kanban_card") === "1" && cell.visible !== false);
    const counters = h.reflowCounters();
    assert.equal(attr(h.board, "task_full_lane_height"), "286");
    assert.equal(h.stagedLane.geometry.height, 286);
    assert.equal(h.todoLane.geometry.height, 286);
    assert.equal(h.doingLane.geometry.height, 286);
    assert.equal(h.board.geometry.height, 324);
    assert.equal(attr(h.todoLane, "page_index"), null); // CHANGE: legacy numeric paging state is retired
    assert.equal(attr(h.todoLane, "task_page_anchor_card_id"), visibleTodoCards[0].id);
    assert.equal(visibleTodoCards.length, 2); // CHANGE: actual card heights define the greedy page
    assert.equal(attr(h.todoLane, "label"), "TODO\nPage 1 of 5");
    assert.match(h.todoLane.style, /(?:^|;)marginTop=20(?:;|$)/);
    assert.equal(counters.classification, 0);
    assert.ok(counters.layout > 0);
    assert.ok(counters.lanes > 0);
    assert.ok(counters.boardLayout > 0);
});

test("task manager direct full-mode lane resize snaps shared lane and board height", async () => {
    const h = makeHarness();
    setAttr(h.board, "task_view_mode", "FULL");
    h.graph.setSelectionCell(h.board);
    await nextTick();
    h.resetCounters();

    const previousGeometry = h.todoLane.geometry.clone();
    h.todoLane.geometry.height = 420;
    h.fireModelChange({ changes: [h.geometryChange(h.todoLane, previousGeometry)] });
    await nextTick();

    assert.equal(attr(h.board, "task_full_lane_height"), "420");
    assert.equal(h.stagedLane.geometry.height, 420);
    assert.equal(h.todoLane.geometry.height, 420);
    assert.equal(h.doingLane.geometry.height, 420);
    assert.equal(h.board.geometry.height, 458); // NEW: BOARD_LANE_Y + lane height + BOARD_BOTTOM_PADDING
    assert.ok(h.reflowCounters().boardLayout > 0);
});

test("task manager direct full-mode lane width resize persists per non-day lane and grows board", async () => {
    const h = makeHarness();
    setAttr(h.board, "task_view_mode", "FULL");
    h.graph.setSelectionCell(h.board);
    await nextTick();
    h.resetCounters();

    const previousGeometry = h.todoLane.geometry.clone();
    h.todoLane.geometry.width = 1800; // CHANGE: exceed the default board width once all full-view lanes are laid out
    h.fireModelChange({ changes: [h.geometryChange(h.todoLane, previousGeometry)] });
    await nextTick();

    const widths = JSON.parse(attr(h.board, "task_non_day_lane_widths_json")).widths;
    assert.equal(widths.TODO, 1800);
    assert.equal(attr(h.board, "task_day_lane_widths_json"), null);
    assert.equal(h.stagedLane.geometry.width, 220);
    assert.equal(h.todoLane.geometry.width, 1800);
    assert.equal(h.doingLane.geometry.x, 2062);
    assert.equal(h.board.geometry.width, 2292);
    assert.ok(h.reflowCounters().boardLayout > 0);
});

test("task manager narrower non-day lane widths persist and shrink board to content", async () => {
    const h = makeHarness();
    setAttr(h.board, "task_view_mode", "FULL");
    h.graph.setSelectionCell(h.board);
    await nextTick();

    const previousGeometry = h.todoLane.geometry.clone();
    h.todoLane.geometry.width = 160;
    h.fireModelChange({ changes: [h.geometryChange(h.todoLane, previousGeometry)] });
    await nextTick();

    const widths = JSON.parse(attr(h.board, "task_non_day_lane_widths_json")).widths;
    assert.equal(widths.TODO, 160);
    assert.equal(h.todoLane.geometry.width, 160);
    assert.equal(h.doingLane.geometry.x, 422);
    assert.equal(h.board.geometry.width, 652);
});

test("task manager renders retained Trellis pager controls and repairs hidden-card selection", async () => {
    const h = makeHarness();
    setAttr(h.board, "task_view_mode", "FULL");
    for (let i = 0; i < 4; i++) addHarnessCard(h, h.todoLane, `pagerExtra${i}`, { workflow_state: "TODO", start: `2026-07-${10 + i}` });
    h.graph.setSelectionCell(h.board);
    const previousGeometry = h.board.geometry.clone();
    h.board.geometry.height = 324;
    h.fireModelChange({ changes: [h.geometryChange(h.board, previousGeometry)] });
    await nextTick();
    await nextTick(); // NEW: model repair and retained DOM refresh are independently deferred

    const pager = h.document.querySelector(".trellis-task-lane-pager[data-lane-id='todo']"); // CHANGE: multiple lanes may independently need paging
    const previous = pager.querySelector(".trellis-task-lane-pager__previous");
    const selector = pager.querySelector("select.trellis-task-lane-pager__select");
    const next = pager.querySelector(".trellis-task-lane-pager__next");
    assert.equal(pager.style.display, "flex");
    assert.equal(selector.options.length, 5);
    assert.equal(selector.options[0].textContent, "1");
    assert.equal(previous.disabled, true);
    assert.equal(next.disabled, false);
    assert.equal(previous.hasAttribute("title"), false);
    assert.equal(next.hasAttribute("title"), false);
    assert.equal(previous.getAttribute("aria-label"), "Previous page");
    assert.equal(next.getAttribute("aria-label"), "Next page");
    assert.match(h.document.getElementById("trellis-task-lane-pager-styles").textContent, /#2563EB/);
    assert.ok(previous.querySelector("svg"));
    assert.ok(next.querySelector("svg"));

    next.focus();
    next.click();
    await nextTick();
    assert.equal(h.document.activeElement, next); // NEW: retained nodes preserve the originating control's focus
    assert.equal(selector.value, "1");
    assert.equal(previous.disabled, false);
    assert.equal(h.graph.getSelectionCell(), h.todoLane); // NEW: explicit navigation falls back to the lane
    assert.equal(attr(h.todoLane, "label"), "TODO\nPage 2 of 5");

    const hiddenCard = h.todoLane.children.find(cell => attr(cell, "kanban_card") === "1" && cell.visible === false);
    h.graph.setSelectionCell(hiddenCard);
    await nextTick();
    assert.equal(hiddenCard.visible, true); // NEW: external selection reveals its canonical page
    assert.equal(h.graph.getSelectionCell(), hiddenCard);
    const anchor = h.model.getCell(attr(h.todoLane, "task_page_anchor_card_id"));
    assert.ok(anchor && anchor.visible); // NEW: anchors always rebase to the first visible card

    h.graph.setSelectionCell(h.root);
    await nextTick();
    assert.equal(pager.style.display, "none"); // NEW: only the selected board owns visible controls
});

test("task manager scales and clamps retained pager controls at low zoom", async () => {
    const h = makeHarness();
    setAttr(h.board, "task_view_mode", "FULL");
    for (let i = 0; i < 4; i++) addHarnessCard(h, h.todoLane, `zoomPagerExtra${i}`, { workflow_state: "TODO", start: `2026-07-${10 + i}` });
    h.graph.setSelectionCell(h.board);
    const previousGeometry = h.board.geometry.clone();
    h.board.geometry.height = 324;
    h.fireModelChange({ changes: [h.geometryChange(h.board, previousGeometry)] });
    await nextTick();
    await nextTick();

    const pager = h.document.querySelector(".trellis-task-lane-pager[data-lane-id='todo']");
    h.setState(h.todoLane, { x: 20, y: 40, width: 60, height: 24 });
    h.fireViewEvent("repaint");
    await nextTick();

    const left = Number.parseInt(pager.style.left, 10);
    const top = Number.parseInt(pager.style.top, 10);
    assert.equal(pager.style.display, "flex");
    assert.match(pager.style.transform, /scale\(0\./);
    assert.ok(left >= 20 && left <= 80);
    assert.ok(top >= 40 && top <= 64);
});

test("task manager pages week-view staged lane with retained Trellis controls", async () => {
    const h = makeHarness();
    for (let i = 0; i < 10; i++) addHarnessCard(h, h.stagedLane, `weekStagedPagerExtra${i}`, { workflow_state: "STAGED" });
    h.graph.setSelectionCell(h.board);
    h.fireModelChange();
    await nextTick();
    await nextTick();

    const pager = h.document.querySelector(".trellis-task-lane-pager[data-lane-id='staged']");
    const selector = pager.querySelector("select.trellis-task-lane-pager__select");
    assert.equal(pager.style.display, "flex");
    assert.ok(selector.options.length > 1);
    assert.equal(selector.options[0].textContent, "1");
    assert.ok(pager.querySelector(".trellis-task-lane-pager__previous svg"));
    assert.ok(pager.querySelector(".trellis-task-lane-pager__next svg"));
    assert.match(attr(h.stagedLane, "label"), /^TODO \(staged\)\nPage 1 of /);
});

test("task manager refreshes week-view staged paging after selected-period context changes", async () => {
    const h = makeHarness();
    const wedCard = addHarnessCard(h, h.stagedLane, "periodWedStaged", { workflow_state: "STAGED", start: "2026-07-15", end: "2026-07-15", title: "Wednesday staged target" });
    for (let i = 0; i < 20; i++) addHarnessCard(h, h.stagedLane, `periodSunStaged${i}`, { workflow_state: "STAGED", start: "2026-07-12", end: "2026-07-12", title: `Sunday staged ${String(i).padStart(2, "0")}` });
    h.graph.setSelectionCell(h.board);
    h.fireModelChange();
    await nextTick();
    await nextTick();

    const initialPageCount = h.document.querySelector(".trellis-task-lane-pager[data-lane-id='staged'] select.trellis-task-lane-pager__select").options.length;
    assert.notEqual(attr(h.stagedLane, "task_page_anchor_card_id"), wedCard.id); // CHANGE: Sunday context must not initially anchor to the Wednesday card

    h.resetCounters();
    h.graph.setSelectionCell(h.weekWedLane); // CHANGE: selecting a day lane changes the selected-period context and refreshes staged paging
    await nextTick();
    await nextTick();

    const pager = h.document.querySelector(".trellis-task-lane-pager[data-lane-id='staged']");
    const selector = pager.querySelector("select.trellis-task-lane-pager__select");
    assert.ok(h.reflowCounters().lanes > 0); // NEW: staged selected-period refresh must use the lane render path, not badge-only refresh
    assert.equal(wedCard.visible, true);
    assert.equal(attr(h.stagedLane, "task_page_anchor_card_id"), wedCard.id);
    assert.match(attr(h.stagedLane, "label"), /^TODO \(staged\)\nPage 1 of /);
    assert.equal(pager.style.display, "flex");
    assert.equal(selector.value, "0");
    assert.equal(selector.options.length, initialPageCount);
    assert.equal(attr(h.weekWedLane, "task_page_anchor_card_id"), null); // NEW: weekday schedule lanes remain unpaged
});

test("task manager week-view staged width persists separately from weekday widths", async () => {
    const h = makeHarness();
    h.graph.setSelectionCell(h.board);
    await nextTick();

    const previousGeometry = h.stagedLane.geometry.clone();
    h.stagedLane.geometry.width = 520;
    h.fireModelChange({ changes: [h.geometryChange(h.stagedLane, previousGeometry)] });
    await nextTick();

    const widths = JSON.parse(attr(h.board, "task_non_day_lane_widths_json")).widths;
    assert.equal(widths.TODO_STAGED, 520);
    assert.equal(attr(h.board, "task_day_lane_widths_json"), null);
    assert.equal(h.stagedLane.geometry.width, 520);
    assert.equal(h.weekSunLane.geometry.width, 220);
    assert.equal(h.weekSunLane.geometry.x, 618);
});

test("task manager repairs same-lane and same-board hidden selections but preserves cross-board selection", () => {
    const sameBoard = makeHarness();
    assert.equal(sameBoard.card2.visible, false);
    sameBoard.graph.setSelectionCells([sameBoard.card1, sameBoard.card2]);
    assert.deepEqual(sameBoard.graph.getSelectionCells(), [sameBoard.card1]); // NEW: first selected card chooses the page and hidden siblings are dropped

    const hiddenStagedCard = sameBoard.stagedLane.children.find(cell => attr(cell, "kanban_card") === "1" && cell.visible === false);
    sameBoard.graph.setSelectionCells([sameBoard.card2, hiddenStagedCard]);
    assert.equal(sameBoard.graph.getSelectionCell(), sameBoard.board); // NEW: hidden selection spanning lanes falls back to the common board

    const crossBoard = makeHarness({ secondaryBoard: true });
    const originalSelection = [crossBoard.card2, crossBoard.secondaryWeekWedCard];
    crossBoard.graph.setSelectionCells(originalSelection);
    assert.deepEqual(crossBoard.graph.getSelectionCells(), originalSelection);
    assert.equal(crossBoard.card2.visible, false); // NEW: cross-board selection is never rewritten to reveal a page
});

test("task manager keeps week schedule height separate from full-view card height", async () => {
    const h = makeHarness();
    const boardOverlay = h.document.querySelector(".trellis-task-board-header-controls");
    h.graph.setSelectionCell(h.weekWedLane);
    await nextTick();

    const previousWeekGeometry = h.weekLaneCard.geometry.clone();
    h.weekLaneCard.geometry.height = 160;
    h.fireModelChange({ changes: [h.geometryChange(h.weekLaneCard, previousWeekGeometry)] });
    await nextTick();

    assert.equal(attr(h.weekLaneCard, "schedule_duration_minutes"), "120");
    assert.equal(attr(h.weekLaneCard, "task_full_card_height"), null);

    h.graph.setSelectionCell(h.board);
    await nextTick();
    modeToggleButton(boardOverlay).click();
    await nextTick();

    assert.equal(attr(h.board, "task_view_mode"), "FULL");
    assert.equal(h.weekLaneCard.parent, h.todoLane);
    assert.equal(h.weekLaneCard.geometry.height, 80);
    assert.equal(attr(h.weekLaneCard, "task_full_card_height"), null);
    assert.equal(attr(h.weekLaneCard, "schedule_duration_minutes"), "120");

    const previousFullGeometry = h.weekLaneCard.geometry.clone();
    h.weekLaneCard.geometry.height = 140;
    h.fireModelChange({ changes: [h.geometryChange(h.weekLaneCard, previousFullGeometry)] });
    await nextTick();

    assert.equal(attr(h.weekLaneCard, "task_full_card_height"), "140");
    assert.equal(h.weekLaneCard.geometry.height, 140);

    modeToggleButton(boardOverlay).click();
    await nextTick();

    assert.equal(attr(h.board, "task_view_mode"), "WEEK");
    assert.equal(h.weekLaneCard.parent, h.weekWedLane);
    assert.equal(h.weekLaneCard.geometry.height, 160);
    assert.equal(attr(h.weekLaneCard, "schedule_duration_minutes"), "120");
    assert.equal(attr(h.weekLaneCard, "task_full_card_height"), "140");

    modeToggleButton(boardOverlay).click();
    await nextTick();

    assert.equal(attr(h.board, "task_view_mode"), "FULL");
    assert.equal(h.weekLaneCard.parent, h.todoLane);
    assert.equal(h.weekLaneCard.geometry.height, 140);
});

test("task manager migrates existing full-view card height without using week schedule height", async () => {
    const h = makeHarness();
    setAttr(h.board, "task_view_mode", "FULL");
    h.card1.geometry.height = 132;

    h.graph.setSelectionCell(h.board);
    await nextTick();

    assert.equal(attr(h.card1, "task_full_card_height"), "132");
    assert.equal(h.card1.geometry.height, 132);
});

test("task manager week-mode board resize expands staged lane only", async () => {
    const h = makeHarness();
    h.graph.setSelectionCell(h.board);
    await nextTick();
    const expectedDayLaneHeight = h.weekWedLane.geometry.height;
    h.resetCounters();

    const previousGeometry = h.board.geometry.clone();
    h.board.geometry.height = 1600;
    h.fireModelChange({ changes: [h.geometryChange(h.board, previousGeometry)] });
    await nextTick();

    const heights = JSON.parse(attr(h.board, "task_week_board_heights_json")).weeks;
    const counters = h.reflowCounters();
    assert.equal(heights["2026-07-12"], 1600);
    assert.equal(attr(h.board, "task_full_lane_height"), null);
    assert.equal(h.weekWedLane.geometry.height, expectedDayLaneHeight);
    assert.equal(h.stagedLane.geometry.height, 1542);
    assert.equal(h.board.geometry.height, 1600);
    assert.ok(counters.layout > 0);
    assert.ok(counters.boardLayout > 0);
});

test("task manager repairs direct week-view staged lane resize to board-owned height", async () => {
    const h = makeHarness();
    h.graph.setSelectionCell(h.board);
    await nextTick();
    const expectedBoardHeight = h.board.geometry.height;
    const expectedStagedHeight = h.stagedLane.geometry.height;
    h.resetCounters();

    const previousGeometry = h.stagedLane.geometry.clone();
    h.stagedLane.geometry.height = expectedStagedHeight + 200;
    h.fireModelChange({ changes: [h.geometryChange(h.stagedLane, previousGeometry)] });
    await nextTick();

    assert.equal(attr(h.board, "task_full_lane_height"), null);
    assert.equal(attr(h.board, "task_week_board_heights_json"), null);
    assert.equal(h.stagedLane.geometry.height, expectedStagedHeight);
    assert.equal(h.board.geometry.height, expectedBoardHeight);
    assert.ok(h.reflowCounters().boardLayout > 0);
});

test("task manager week-mode board resize clamps below tallest day lane", async () => {
    const h = makeHarness();
    h.graph.setSelectionCell(h.board);
    await nextTick();
    const expectedDayLaneHeight = h.weekWedLane.geometry.height;
    const expectedMinimumBoardHeight = h.board.geometry.height;

    const previousGeometry = h.board.geometry.clone();
    h.board.geometry.height = 100;
    h.fireModelChange({ changes: [h.geometryChange(h.board, previousGeometry)] });
    await nextTick();

    assert.equal(h.weekWedLane.geometry.height, expectedDayLaneHeight);
    assert.equal(h.board.geometry.height, expectedMinimumBoardHeight);
    assert.ok(h.board.geometry.height >= h.weekWedLane.geometry.y + h.weekWedLane.geometry.height + 10);
});

test("task manager week-mode board height is restored per selected week", async () => {
    const h = makeHarness();
    h.graph.setSelectionCell(h.board);
    await nextTick();
    const defaultBoardHeight = h.board.geometry.height;

    const previousGeometry = h.board.geometry.clone();
    h.board.geometry.height = 1600;
    h.fireModelChange({ changes: [h.geometryChange(h.board, previousGeometry)] });
    await nextTick();
    assert.equal(h.board.geometry.height, 1600);

    setAttr(h.board, "task_selected_week_start", "2026-07-19");
    setAttr(h.board, "task_selected_day", "2026-07-19");
    h.graph.setSelectionCell(h.board);
    await nextTick();
    assert.equal(h.board.geometry.height, defaultBoardHeight);
    assert.equal(h.stagedLane.geometry.height, 880);

    setAttr(h.board, "task_selected_week_start", "2026-07-12");
    setAttr(h.board, "task_selected_day", "2026-07-12");
    h.graph.setSelectionCell(h.board);
    await nextTick();
    assert.equal(h.board.geometry.height, 1600);
    assert.equal(h.stagedLane.geometry.height, 1542);
});

test("task manager restores persisted full-mode board height after week mode", async () => {
    const h = makeHarness();
    const boardOverlay = h.document.querySelector(".trellis-task-board-header-controls");
    setAttr(h.board, "task_view_mode", "FULL");
    setAttr(h.board, "task_full_lane_height", "300");
    h.graph.setSelectionCell(h.board);
    await nextTick();

    assert.equal(h.todoLane.geometry.height, 300);
    assert.equal(h.board.geometry.height, 338);
    modeToggleButton(boardOverlay).click();
    await nextTick();
    assert.equal(attr(h.board, "task_view_mode"), "WEEK");
    assert.ok(h.weekSunLane.geometry.height > 300);
    assert.notEqual(h.board.geometry.height, 338);

    modeToggleButton(boardOverlay).click();
    await nextTick();
    assert.equal(attr(h.board, "task_view_mode"), "FULL");
    assert.equal(h.todoLane.geometry.height, 300);
    assert.equal(h.board.geometry.height, 338);
});

test("task manager closed week days label closed and clear schedule attributes", async () => {
    const h = makeHarness();
    const originalY = h.weekLaneCard.geometry.y;
    const originalHeight = h.weekLaneCard.geometry.height;
    h.weekLaneCard.geometry.x = 70;
    h.weekLaneCard.geometry.width = 65;
    setAttr(h.weekLaneCard, "schedule_start_minute", "360");
    setAttr(h.weekLaneCard, "schedule_duration_minutes", "60");
    setAttr(h.board, "task_work_hours_week_overrides_json", JSON.stringify({
        weeks: { "2026-07-12": { days: [{}, {}, {}, { closed: true }, {}, {}, {}] } }
    }));

    h.graph.setSelectionCell(h.weekWedLane);
    await nextTick();

    assert.match(attr(h.weekWedLane, "label"), /closed/);
    assert.equal(attr(h.weekLaneCard, "schedule_start_minute"), null);
    assert.equal(attr(h.weekLaneCard, "schedule_duration_minutes"), null);
    assert.equal(h.weekLaneCard.geometry.x, 10);
    assert.equal(h.weekLaneCard.geometry.width, h.weekWedLane.geometry.width - 20);
    assert.equal(h.weekLaneCard.geometry.y, originalY);
    assert.equal(h.weekLaneCard.geometry.height, originalHeight);
});

test("task manager all-closed week hides time scale and keeps day lanes compact", async () => {
    const h = makeHarness();
    setAttr(h.board, "task_work_hours_week_overrides_json", JSON.stringify({
        weeks: { "2026-07-12": { days: [{ closed: true }, { closed: true }, { closed: true }, { closed: true }, { closed: true }, { closed: true }, { closed: true }] } }
    }));
    h.graph.setSelectionCell(h.board);
    await nextTick();

    const timeScaleOverlay = h.document.querySelector(".trellis-task-week-time-scale");
    assert.equal(timeScaleOverlay.style.display, "none");
    assert.equal(h.weekSunLane.geometry.y, 48);
    assert.equal(h.weekWedLane.geometry.y, 48);
    assert.equal(h.weekSunLane.geometry.height, 20);
    assert.equal(h.weekWedLane.geometry.height, 20);
    assert.equal(h.stagedLane.geometry.height, 126); // CHANGE: non-day lanes retain a usable title and pager band
    assert.equal(h.board.geometry.height, 184);
});

test("task manager edit hours shifts existing day stack and marks overflow", async () => {
    const h = makeHarness();
    const boardOverlay = h.document.querySelector(".trellis-task-board-header-controls");
    h.graph.setSelectionCell(h.weekWedLane);
    await nextTick();
    buttonByText(boardOverlay, "Add Break").click();
    await nextTick();
    const breakCard = h.weekWedLane.children.find(cell => attr(cell, "schedule_break") === "1");
    const originalOrder = h.weekWedLane.children.map(cell => cell.id).join(",");

    h.resetCounters();
    saveSelectedWeekDayHours(h, 3, "08:00", "09:00");
    await nextTick();

    const counters = h.reflowCounters();
    assert.equal(h.weekWedLane.children.map(cell => cell.id).join(","), originalOrder);
    assert.equal(attr(h.weekLaneCard, "schedule_start_minute"), "480");
    assert.equal(attr(h.weekLaneCard, "schedule_duration_minutes"), "60");
    assert.equal(attr(breakCard, "schedule_start_minute"), "540");
    assert.equal(attr(breakCard, "schedule_duration_minutes"), "30");
    assert.match(attr(h.weekLaneCard, "label"), /<b>Time:<\/b> 8:00 AM-9:00 AM/);
    assert.match(attr(breakCard, "label"), /<b>Time:<\/b> 9:00 AM-9:30 AM/);
    assert.doesNotMatch(h.weekLaneCard.style, /strokeColor=#B91C1C/);
    assert.match(breakCard.style, /strokeColor=#B91C1C/);
    assert.equal(counters.classification, 0);
    assert.ok(counters.layout > 0);
    assert.ok(counters.lanes > 0);
    assert.ok(counters.boardLayout > 0);
    assert.ok(counters.schedulePack > 0);
});

test("task manager edit hours start and end changes do not compress durations", async () => {
    const h = makeHarness();
    const boardOverlay = h.document.querySelector(".trellis-task-board-header-controls");
    h.graph.setSelectionCell(h.weekWedLane);
    await nextTick();
    buttonByText(boardOverlay, "Add Break").click();
    await nextTick();
    const breakCard = h.weekWedLane.children.find(cell => attr(cell, "schedule_break") === "1");

    saveSelectedWeekDayHours(h, 3, "08:00", "18:00");
    await nextTick();
    assert.equal(attr(h.weekLaneCard, "schedule_start_minute"), "480");
    assert.equal(attr(breakCard, "schedule_start_minute"), "540");
    assert.equal(attr(h.weekLaneCard, "schedule_duration_minutes"), "60");
    assert.equal(attr(breakCard, "schedule_duration_minutes"), "30");

    saveSelectedWeekDayHours(h, 3, "06:00", "07:00");
    await nextTick();
    assert.equal(attr(h.weekLaneCard, "schedule_start_minute"), "360");
    assert.equal(attr(breakCard, "schedule_start_minute"), "420");
    assert.equal(attr(h.weekLaneCard, "schedule_duration_minutes"), "60");
    assert.equal(attr(breakCard, "schedule_duration_minutes"), "30");
    assert.match(breakCard.style, /strokeColor=#B91C1C/);
});

test("task manager edit hours dialog uses Trellis dialog layer", async () => {
    const h = makeHarness();
    const boardOverlay = h.document.querySelector(".trellis-task-board-header-controls");
    h.graph.setSelectionCell(h.weekWedLane);
    await nextTick();

    buttonByText(boardOverlay, "Edit Hours").click();

    assert.ok(h.lastDialog);
    assert.equal(h.ui.dialog.container.style.zIndex, "2000000000");
    assert.equal(h.ui.dialog.bg.style.zIndex, "1999999999");
});

test("task manager single DONE card still offers TODO and DOING actions", async () => {
    const h = makeHarness();
    const overlay = h.document.querySelector(".trellis-task-selected-card-actions");
    setAttr(h.weekLaneCard, "workflow_state", "DONE");
    setAttr(h.weekLaneCard, "completed", "2026-07-15");
    h.setState(h.weekLaneCard, { x: 470, y: 60, width: 120, height: 60 });
    h.graph.setSelectionCell(h.weekLaneCard);
    await nextTick();

    assert.equal(buttonByText(overlay, "TODO").style.display, "");
    assert.equal(buttonByText(overlay, "DOING").style.display, "");
    assert.equal(buttonByText(overlay, "DONE").style.display, "none");

    buttonByText(overlay, "TODO").click();
    await nextTick();
    assert.equal(attr(h.weekLaneCard, "workflow_state"), "TODO");
    assert.equal(attr(h.weekLaneCard, "completed"), null);
});

test("task manager hides workflow actions for staged and mixed non-day selections", async () => {
    const h = makeHarness();
    const overlay = h.document.querySelector(".trellis-task-selected-card-actions");
    h.setState(h.stagedCard, { x: 30, y: 60, width: 120, height: 60 });
    h.setState(h.weekLaneCard, { x: 470, y: 60, width: 120, height: 60 });
    h.setState(h.card1, { x: 30, y: 130, width: 120, height: 60 });

    h.graph.setSelectionCell(h.stagedCard);
    await nextTick();
    assert.equal(overlay.style.display, "flex");
    assert.equal(buttonByText(overlay, "TODO").style.display, "none");
    assert.equal(buttonByText(overlay, "DOING").style.display, "none");
    assert.equal(buttonByText(overlay, "DONE").style.display, "none");
    assert.equal(buttonByText(overlay, "Allocate to Start Dates").style.display, "");

    h.graph.setSelectionCells([h.weekLaneCard, h.card1]);
    await nextTick();
    assert.equal(overlay.style.display, "flex");
    assert.equal(buttonByText(overlay, "TODO").style.display, "none");
    assert.equal(buttonByText(overlay, "DOING").style.display, "none");
    assert.equal(buttonByText(overlay, "DONE").style.display, "none");
});

test("task manager multi-card overlay applies note, date, reset, and clear actions", async () => {
    const h = makeHarness({ initialNonDayLaneHeight: 500 }); // CHANGE: keep bulk-operation fixtures on one page
    const overlay = h.document.querySelector(".trellis-task-selected-card-actions");
    setAttr(h.board, "task_view_mode", "FULL"); // NEW: keep both cards on one unpaged lane for bulk-edit coverage
    setAttr(h.board, "task_full_lane_height", "400");
    h.board.geometry.height = 438;

    h.setState(h.board, { x: 10, y: 10, width: 700, height: 260 });
    h.setState(h.card1, { x: 30, y: 60, width: 120, height: 60 });
    h.setState(h.card2, { x: 30, y: 130, width: 120, height: 60 });
    h.graph.setSelectionCells([h.card1, h.card2]);
    await nextTick();

    assert.equal(overlay.style.display, "flex");
    ["Edit", "Reset Dates", "Clear Note"].forEach(label => assert.ok(buttonByText(overlay, label)));
    assert.equal(buttonByText(overlay, "Reset Dates").getAttribute("data-trellis-button-variant"), "danger"); // NEW
    assert.match(buttonByText(overlay, "Reset Dates").getAttribute("style") || "", /background:\s*(?:#b91c1c|rgb\(185,\s*28,\s*28\))/); // NEW
    assert.equal(buttonByText(overlay, "TODO").style.display, "none");
    assert.equal(buttonByText(overlay, "DOING").style.display, "none");
    assert.equal(buttonByText(overlay, "DONE").style.display, "none");

    buttonByText(overlay, "Edit").click();
    assert.ok(h.lastDialog);
    const noteInput = h.lastDialog.querySelector("input[type='text']");
    const dateInput = h.lastDialog.querySelector("input[type='date']");
    noteInput.value = "shared note";
    noteInput.dispatchEvent(new h.document.defaultView.Event("input", { bubbles: true }));
    dateInput.value = "2026-08-01";
    dateInput.dispatchEvent(new h.document.defaultView.Event("input", { bubbles: true }));
    h.resetCounters();
    buttonByText(h.lastDialog, "Save").click();
    await nextTick();

    const dateCounters = h.reflowCounters();
    assert.equal(attr(h.card1, "card_note"), "shared note");
    assert.equal(attr(h.card2, "card_note"), "shared note");
    assert.equal(attr(h.card1, "start"), "2026-08-01");
    assert.equal(attr(h.card1, "end"), "2026-08-03");
    assert.equal(attr(h.card2, "start"), "2026-08-01");
    assert.equal(attr(h.card2, "end"), "2026-08-05");
    assert.ok(dateCounters.classification > 0);
    assert.ok(dateCounters.layout > 0);

    h.graph.setSelectionCell(h.card1); // NEW: automatic paging intentionally discards hidden cross-page bulk selections
    await nextTick();
    buttonByText(overlay, "Reset Dates").click();
    await nextTick();
    assert.equal(attr(h.card1, "start"), "2026-07-01");
    assert.equal(attr(h.card1, "date_override"), null);
    h.graph.setSelectionCell(h.card2);
    await nextTick();
    buttonByText(overlay, "Reset Dates").click();
    await nextTick();
    assert.equal(attr(h.card2, "start"), "2026-07-05");
    assert.equal(attr(h.card2, "date_override"), null);

    h.graph.setSelectionCell(h.card1);
    await nextTick();
    buttonByText(overlay, "Clear Note").click();
    await nextTick();
    assert.equal(attr(h.card1, "card_note"), null);
    h.graph.setSelectionCell(h.card2);
    await nextTick();
    buttonByText(overlay, "Clear Note").click();
    await nextTick();
    assert.equal(attr(h.card2, "card_note"), null);
});

test("task manager assignment control enforces Week-mode single-board task eligibility", async () => {
    const h = makeHarness({ secondaryBoard: true });
    const overlay = h.document.querySelector(".trellis-task-selected-card-actions");
    h.setState(h.stagedCard, { x: 30, y: 60, width: 120, height: 60 });
    h.graph.setSelectionCell(h.stagedCard);
    await nextTick();
    const emptyAssign = buttonStartingWith(overlay, "Assign to");
    assert.ok(emptyAssign);
    assert.equal(emptyAssign.disabled, true);
    assert.match(emptyAssign.textContent, /link role cards/i);

    setAttr(h.board, "task_view_mode", "FULL");
    h.graph.setSelectionCell(h.stagedCard);
    await nextTick();
    assert.equal(emptyAssign.style.display, "none");

    setAttr(h.board, "task_view_mode", "WEEK");
    h.setState(h.secondaryWeekWedCard, { x: 2970, y: 60, width: 120, height: 60 });
    h.graph.setSelectionCells([h.stagedCard, h.secondaryWeekWedCard]);
    await nextTick();
    assert.equal(emptyAssign.style.display, "none");

    const breakCard = new TestCell("assignment-break", makeValue(h.document, { kanban_card: "1", schedule_break: "1", title: "Break" }), new TestGeometry(30, 200, 120, 40));
    h.addCell(h.weekTueLane, breakCard);
    h.setState(breakCard, { x: 690, y: 200, width: 120, height: 40 });
    h.graph.setSelectionCell(breakCard);
    await nextTick();
    assert.equal(emptyAssign.style.display, "none");
});

test("task manager assignment picker groups linked roles, searches, and applies a single assignment", async () => {
    const h = makeHarness();
    const alice = addRoleFixture(h, { id: "role-alice", name: "Alice", roleTitle: "Garden   Lead", legacy: true, image: "data:image/png;base64,test" });
    addRoleFixture(h, { id: "role-bob", name: "Bob", roleTitle: "garden lead" });
    addRoleFixture(h, { id: "role-empty", name: "", roleTitle: "" });
    addRoleFixture(h, { id: "role-one-way", name: "Ignored", roleTitle: "Observer", reciprocal: false });
    h.setState(h.stagedCard, { x: 30, y: 60, width: 120, height: 60 });
    h.graph.setSelectionCell(h.stagedCard);
    await nextTick();
    const overlay = h.document.querySelector(".trellis-task-selected-card-actions");
    const assign = buttonStartingWith(overlay, "Assign to");
    assert.equal(assign.disabled, false);
    assign.click();
    let picker = h.document.querySelector(".trellis-task-assignee-picker");
    assert.ok(picker);
    assert.equal(overlay.style.display, "none");
    assert.equal(picker.style.left, "50px");
    assert.equal(picker.style.top, "129px");
    buttonByText(picker, "Cancel").click();
    await nextTick();
    assert.equal(overlay.style.display, "flex");
    assign.click();
    picker = h.document.querySelector(".trellis-task-assignee-picker");
    assert.ok(picker);
    h.document.body.dispatchEvent(new h.document.defaultView.MouseEvent("mousedown", { bubbles: true }));
    await nextTick();
    assert.equal(h.document.querySelector(".trellis-task-assignee-picker"), null);
    assert.equal(overlay.style.display, "flex");
    assign.click();
    picker = h.document.querySelector(".trellis-task-assignee-picker");
    assert.ok(picker);
    assert.match(picker.textContent, /Garden Lead/); // CHANGE: Group labels collapse internal whitespace while preserving a representative display case.
    assert.match(picker.textContent, /Unnamed person/);
    assert.match(picker.textContent, /Unspecified role/);
    assert.doesNotMatch(picker.textContent, /Ignored/);
    assert.equal(Array.from(picker.querySelectorAll("section")).filter(section => /garden\s+lead/i.test(section.firstChild.textContent)).length, 1);

    const search = picker.querySelector("input[type='search']");
    search.value = "alice";
    search.dispatchEvent(new h.document.defaultView.Event("input", { bubbles: true }));
    const aliceRow = Array.from(picker.querySelectorAll(".trellis-task-assignee-picker-row")).find(row => row.textContent.includes("Alice"));
    const bobRow = Array.from(picker.querySelectorAll(".trellis-task-assignee-picker-row")).find(row => row.textContent.includes("Bob"));
    assert.equal(aliceRow.style.display, "grid");
    assert.equal(bobRow.style.display, "none");
    changeCheckbox(h.document, aliceRow.querySelector("input[type='checkbox']"), true);
    h.resetCounters();
    buttonByText(picker, "Apply").click();
    await nextTick();
    assert.deepEqual(JSON.parse(attr(h.stagedCard, "task_assignee_role_ids_json")), ["role-alice"]);
    assert.equal(h.modelBeginUpdateCount, 1);
    assert.equal(h.document.querySelector(".trellis-task-assignee-picker"), null);
    assert.equal(overlay.style.display, "flex");

    h.fireModelChange();
    await nextTick();
    const stack = h.document.querySelector(".trellis-task-assignee-stack");
    assert.ok(stack);
    const avatar = stack.querySelector(".trellis-task-assignee-avatar");
    assert.equal(avatar.style.width, "16px");
    assert.equal(avatar.querySelector("img").getAttribute("src"), "data:image/png;base64,test");
    avatar.click();
    assert.equal(h.graph.getSelectionCell(), alice.role);

    setAttr(h.board, "task_view_mode", "FULL");
    h.fireModelChange();
    await nextTick();
    assert.equal(h.document.querySelectorAll(".trellis-task-assignee-stack").length, 0);
});

test("task manager bulk assignment uses reversible Existing and All cards controls", async () => {
    const h = makeHarness();
    const role = addRoleFixture(h, { id: "role-bulk", name: "Morgan", roleTitle: "Watering" }).role;
    setAttr(h.weekTueCard, "task_assignee_role_ids_json", '["role-bulk"]');
    h.setState(h.weekTueCard, { x: 690, y: 60, width: 120, height: 60 });
    h.setState(h.weekTueCard2, { x: 690, y: 130, width: 120, height: 60 });
    h.graph.setSelectionCells([h.weekTueCard, h.weekTueCard2]);
    await nextTick();
    const overlay = h.document.querySelector(".trellis-task-selected-card-actions");
    buttonStartingWith(overlay, "Assign to").click();
    let picker = h.document.querySelector(".trellis-task-assignee-picker");
    let row = Array.from(picker.querySelectorAll(".trellis-task-assignee-picker-row")).find(candidate => candidate.textContent.includes("Morgan"));
    let [existing, all] = row.querySelectorAll("input[type='checkbox']");
    assert.equal(existing.checked, true);
    assert.equal(existing.disabled, false);
    assert.equal(all.checked, false);
    changeCheckbox(h.document, all, true);
    assert.equal(existing.checked, true);
    assert.equal(existing.disabled, true);
    changeCheckbox(h.document, all, false);
    assert.equal(existing.checked, true);
    assert.equal(existing.disabled, false);
    h.resetCounters();
    buttonByText(picker, "Apply").click();
    await nextTick();
    assert.equal(h.modelBeginUpdateCount, 0); // NEW: reversible no-op produces no undo record

    buttonStartingWith(overlay, "Assign to").click();
    picker = h.document.querySelector(".trellis-task-assignee-picker");
    row = Array.from(picker.querySelectorAll(".trellis-task-assignee-picker-row")).find(candidate => candidate.textContent.includes("Morgan"));
    [existing, all] = row.querySelectorAll("input[type='checkbox']");
    changeCheckbox(h.document, all, true);
    h.resetCounters();
    buttonByText(picker, "Apply").click();
    await nextTick();
    assert.deepEqual(JSON.parse(attr(h.weekTueCard2, "task_assignee_role_ids_json")), ["role-bulk"]);
    assert.equal(h.modelBeginUpdateCount, 1);

    setAttr(h.board, "linkedTo", ""); setAttr(role, "linkedTo", "");
    h.graph.setSelectionCells([h.weekTueCard, h.weekTueCard2]);
    await nextTick();
    buttonStartingWith(overlay, "Assign to").click();
    picker = h.document.querySelector(".trellis-task-assignee-picker");
    assert.match(picker.textContent, /Unavailable assignments/);
    row = picker.querySelector(".trellis-task-assignee-picker-row");
    [existing, all] = row.querySelectorAll("input[type='checkbox']");
    assert.equal(existing.disabled, false);
    assert.equal(all.disabled, true);
    changeCheckbox(h.document, existing, false);
    buttonByText(picker, "Apply").click();
    await nextTick();
    assert.equal(attr(h.weekTueCard, "task_assignee_role_ids_json"), null);
    assert.equal(attr(h.weekTueCard2, "task_assignee_role_ids_json"), null);
});

test("task manager assignee badges expand to readable name stack, navigate, and clear deleted roles", async () => {
    const h = makeHarness();
    const roles = [
        addRoleFixture(h, { id: "role-1", name: "A One", roleTitle: "Alpha" }).role,
        addRoleFixture(h, { id: "role-2", name: "B Two", roleTitle: "Beta" }).role,
        addRoleFixture(h, { id: "role-3", name: "C Three", roleTitle: "Gamma" }).role,
        addRoleFixture(h, { id: "role-4", name: "D Four", roleTitle: "Delta" }).role
    ];
    setAttr(h.weekTueCard, "task_assignee_role_ids_json", JSON.stringify(roles.map(role => role.id)));
    h.setState(h.weekTueCard, { x: 690, y: 60, width: 120, height: 60 });
    h.fireModelChange();
    await nextTick();
    const stack = h.document.querySelector(".trellis-task-assignee-stack");
    assert.ok(stack);
    assert.equal(stack.querySelectorAll(".trellis-task-assignee-avatar").length, 3);
    const overflow = stack.querySelector(".trellis-task-assignee-overflow");
    assert.equal(overflow.textContent, "+1");
    overflow.click();
    await nextTick();
    assert.equal(h.document.querySelector(".trellis-task-assignee-names-popover"), null);
    let expanded = h.document.querySelector(".trellis-task-assignee-stack-expanded");
    assert.ok(expanded);
    assert.equal(expanded.style.flexDirection, "column");
    assert.equal(expanded.querySelectorAll(".trellis-task-assignee-pill").length, 4);
    assert.equal(expanded.querySelectorAll(".trellis-task-assignee-avatar").length, 4);
    assert.deepEqual(Array.from(expanded.querySelectorAll(".trellis-task-assignee-pill-label")).map(label => label.textContent), ["A O.", "B T.", "D F.", "C T."]);
    const collapse = buttonByText(expanded, "-");
    assert.ok(collapse);
    assert.equal(collapse.getAttribute("aria-label"), "Collapse assignees");
    h.fireModelChange();
    await nextTick();
    expanded = h.document.querySelector(".trellis-task-assignee-stack-expanded");
    assert.ok(expanded);
    buttonByText(expanded, "-").click();
    await nextTick();
    assert.equal(h.document.querySelector(".trellis-task-assignee-stack-expanded"), null);
    assert.equal(h.document.querySelector(".trellis-task-assignee-overflow").textContent, "+1");
    h.document.querySelector(".trellis-task-assignee-overflow").click();
    await nextTick();
    expanded = h.document.querySelector(".trellis-task-assignee-stack-expanded");
    expanded.querySelector(".trellis-task-assignee-avatar").click();
    assert.ok(roles.includes(h.graph.getSelectionCell()));

    const team = new TestCell("deleted-team", "Team", new TestGeometry(0, 0, 300, 300), "team_module=1;");
    h.addCell(h.root, team); h.addCell(team, roles[0]);
    h.model.remove(team);
    h.fireGraphEvent("cellsRemoved", { cells: [team] });
    assert.deepEqual(JSON.parse(attr(h.weekTueCard, "task_assignee_role_ids_json")), ["role-2", "role-3", "role-4"]);
    h.fireModelChange();
    await nextTick();
    expanded = h.document.querySelector(".trellis-task-assignee-stack-expanded");
    assert.ok(expanded);
    assert.equal(expanded.querySelectorAll(".trellis-task-assignee-pill").length, 3);
    assert.doesNotMatch(expanded.title, /A One/);
});
