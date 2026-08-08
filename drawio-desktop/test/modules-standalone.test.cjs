const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { JSDOM } = require("jsdom");

const PROJECT_ROOT = path.join(__dirname, "..");
const PLUGIN_PATH = path.join(PROJECT_ROOT, "drawio", "src", "main", "webapp", "plugins", "garden_planner_plugins", "Modules_Standalone.js");

let nextCellId = 1;

class TestGeometry {
    constructor(x, y, width, height) {
        this.x = x;
        this.y = y;
        this.width = width;
        this.height = height;
        this.relative = false;
    }

    clone() {
        const copy = new TestGeometry(this.x, this.y, this.width, this.height);
        copy.relative = this.relative;
        copy.alternateBounds = this.alternateBounds;
        return copy;
    }
}

class TestCell {
    constructor(value, geometry, style) {
        this.id = "cell-" + nextCellId++;
        this.value = value;
        this.geometry = geometry || null;
        this.style = style || "";
        this.children = [];
        this.parent = null;
        this.vertex = false;
    }

    getId() { return this.id; }
    getStyle() { return this.style || ""; }
    getGeometry() { return this.geometry; }
    isVertex() { return !!this.vertex; }
    getAttribute(key) { return this.value && this.value.nodeType === 1 ? this.value.getAttribute(key) : null; }
}

class TestModel {
    constructor(root) {
        this.root = root;
        this.cells = {};
        this.listeners = new Map();
        this.updateLevel = 0;
        this.topLevelUpdateCount = 0;
        this.valueWrites = [];
        this.register(root);
    }

    register(cell) {
        if (cell && cell.id) this.cells[cell.id] = cell;
        (cell.children || []).forEach(child => this.register(child));
    }

    beginUpdate() { if (this.updateLevel === 0) this.topLevelUpdateCount += 1; this.updateLevel += 1; }
    endUpdate() { this.updateLevel = Math.max(0, this.updateLevel - 1); }
    getRoot() { return this.root; }
    getCell(id) { return this.cells[id] || null; }
    getParent(cell) { return cell && cell.parent ? cell.parent : null; }
    getChildren(cell) { return cell && cell.children ? cell.children.slice() : []; }
    getChildCount(cell) { return cell && cell.children ? cell.children.length : 0; }
    getChildAt(cell, index) { return cell.children[index]; }
    getGeometry(cell) { return cell && cell.geometry ? cell.geometry : null; }
    isVertex(cell) { return !!cell && !!cell.vertex; }

    add(parent, cell, index) {
        if (!parent || !cell) return cell;
        if (cell.parent && cell.parent.children) cell.parent.children = cell.parent.children.filter(child => child !== cell);
        cell.parent = parent;
        if (typeof index === "number") parent.children.splice(index, 0, cell);
        else parent.children.push(cell);
        this.register(cell);
        return cell;
    }

    remove(cell) {
        if (!cell) return null;
        if (cell.parent && cell.parent.children) cell.parent.children = cell.parent.children.filter(child => child !== cell);
        cell.parent = null;
        return cell;
    }

    setGeometry(cell, geometry) { if (cell) cell.geometry = geometry; }
    setStyle(cell, style) { if (cell) cell.style = style || ""; }
    setValue(cell, value) { if (cell) { this.valueWrites.push({ cell, oldValue: cell.value, newValue: value }); cell.value = value; } }

    addListener(eventName, listener) {
        if (!this.listeners.has(eventName)) this.listeners.set(eventName, []);
        this.listeners.get(eventName).push(listener);
    }

    fire(eventName) {
        (this.listeners.get(eventName) || []).forEach(listener => listener(this, {}));
    }
}

function makeEventObject(name, pairs) {
    const props = {};
    for (let i = 0; i < pairs.length; i += 2) props[pairs[i]] = pairs[i + 1];
    return { name, getProperty(key) { return props[key]; } };
}

function makeHarness() {
    nextCellId = 1;
    const dom = new JSDOM("<!doctype html><body><div id='graph'></div></body>");
    const document = dom.window.document;
    const root = new TestCell("", null, "");
    root.id = "root";
    const model = new TestModel(root);
    const mouseListeners = [];
    const graphListeners = new Map();
    const viewListeners = new Map();
    const selectionListeners = new Map();
    const firedEvents = [];
    const contextMenuContributors = [];
    let insertImageCalls = 0;
    let promptValue = "40";
    const promptCalls = [];
    let lastDialog = null; // NEW
    let selectedCells = [];
    const container = document.getElementById("graph");
    Object.defineProperty(container, "clientWidth", { value: 800, configurable: true });
    Object.defineProperty(container, "clientHeight", { value: 600, configurable: true });
    container.getBoundingClientRect = () => ({ left: 10, top: 20, width: 800, height: 600 });

    function addMappedListener(map, eventName, listener) {
        if (!map.has(eventName)) map.set(eventName, []);
        map.get(eventName).push(listener);
    }

    const graph = {
        container,
        popupMenuHandler: {},
        resizeChildCells() {},
        view: {
            scale: 1,
            translate: { x: 0, y: 0 },
            getState(cell) { const g = model.getGeometry(cell); return g ? { x: g.x, y: g.y, width: g.width, height: g.height } : null; },
            addListener(eventName, listener) { addMappedListener(viewListeners, eventName, listener); }
        },
        getModel() { return model; },
        getDefaultParent() { return root; },
        getCellGeometry(cell) { return model.getGeometry(cell); },
        getStartSize() { return { width: 0, height: 0 }; },
        getPointForEvent(evt) { return { x: evt.graphX == null ? evt.clientX : evt.graphX, y: evt.graphY == null ? evt.clientY : evt.graphY }; },
        getCellAt() { return graph.__hitCell || null; },
        getView() { return this.view; },
        refresh() {},
        insertVertex(parent, id, value, x, y, w, h, style) { const cell = new TestCell(value, new TestGeometry(x, y, w, h), style); cell.vertex = true; return model.add(parent || root, cell); },
        setSelectionCell(cell) { selectedCells = cell ? [cell] : []; (selectionListeners.get("change") || []).forEach(listener => listener(this, {})); },
        setSelectionCells(cells) { selectedCells = (cells || []).filter(Boolean); (selectionListeners.get("change") || []).forEach(listener => listener(this, {})); },
        getSelectionCell() { return selectedCells[0] || null; },
        getSelectionCells() { return selectedCells.slice(); },
        getSelectionModel() { return { addListener(eventName, listener) { addMappedListener(selectionListeners, eventName, listener); } }; },
        addMouseListener(listener) { mouseListeners.push(listener); },
        addListener(eventName, listener) { addMappedListener(graphListeners, eventName, listener); },
        fireEvent(evt) { firedEvents.push(evt); (graphListeners.get(evt && evt.name) || []).forEach(listener => listener(this, evt)); }
    };

    dom.window.TrellisContextMenu = {
        install() {},
        register(contributor) { contextMenuContributors.push(contributor); }
    };

    const actions = {
        get(name) {
            if (name !== "insertImage") return null;
            return {
                funct() {
                    insertImageCalls += 1;
                    graph.insertVertex(root, null, "avatar", 0, 0, 20, 20, "shape=image;image=data:image/png;base64,test", false);
                }
            };
        }
    };

    const ui = {
        editor: { graph },
        actions,
        prompt(message, value, callback) {
            promptCalls.push({ message, value });
            callback(promptValue);
        },
        showDialog(node) {
            lastDialog = node; // NEW
            document.body.appendChild(node); // NEW
        },
        hideDialog() {
            if (lastDialog && lastDialog.parentNode) lastDialog.parentNode.removeChild(lastDialog); // NEW
            lastDialog = null; // NEW
        }
    };

    const context = {
        window: dom.window,
        document,
        console: { log() {}, warn() {}, error() {} },
        setTimeout,
        clearTimeout,
        Draw: { loadPlugin(callback) { callback(ui); } },
        mxCell: TestCell,
        mxGeometry: TestGeometry,
        mxLayoutManager: function mxLayoutManager() {},
        mxStackLayout: function mxStackLayout() {},
        mxEventObject: function mxEventObject(name, ...pairs) { return makeEventObject(name, pairs); },
        mxUtils: {
            createXmlDocument() { return document.implementation.createDocument("", "", null); }
        },
        mxEvent: {
            CHANGE: "change",
            ADD_CELLS: "addCells",
            CELLS_ADDED: "cellsAdded",
            CELLS_MOVED: "cellsMoved",
            CELLS_RESIZED: "cellsResized",
            SCALE: "scale",
            TRANSLATE: "translate",
            SCALE_AND_TRANSLATE: "scaleAndTranslate",
            DESTROY: "destroy",
            addListener(node, eventName, listener) { node.addEventListener(eventName, listener); },
            consume(evt) { if (evt && evt.preventDefault) evt.preventDefault(); if (evt && evt.stopPropagation) evt.stopPropagation(); },
            getSource(evt) { return evt && (evt.target || evt.srcElement); },
            getClientX(evt) { return evt && evt.clientX || 0; },
            getClientY(evt) { return evt && evt.clientY || 0; },
            isControlDown(evt) { return !!(evt && evt.ctrlKey); },
            isMetaDown(evt) { return !!(evt && evt.metaKey); },
            isShiftDown(evt) { return !!(evt && evt.shiftKey); },
            isPopupTrigger(evt) { return !!(evt && evt.button === 2); }
        }
    };

    vm.runInNewContext(fs.readFileSync(PLUGIN_PATH, "utf8"), context, { filename: PLUGIN_PATH });
    return { dom, document, graph, model, root, mouseListeners, graphListeners, viewListeners, selectionListeners, firedEvents, contextMenuContributors, promptCalls, setPromptValue(value) { promptValue = value; }, clearValueWrites() { model.valueWrites.length = 0; }, get valueWrites() { return model.valueWrites.slice(); }, get insertImageCalls() { return insertImageCalls; }, get selectedCell() { return selectedCells[0] || null; }, get lastDialog() { return lastDialog; } }; // CHANGE
}

function makeMouseEvent(window, type, opts) {
    const event = new window.MouseEvent(type, {
        bubbles: true,
        button: opts.button == null ? 0 : opts.button,
        clientX: opts.clientX,
        clientY: opts.clientY,
        detail: opts.detail == null ? 1 : opts.detail,
        ctrlKey: !!opts.ctrlKey,
        shiftKey: !!opts.shiftKey,
        altKey: !!opts.altKey
    });
    Object.defineProperty(event, "graphX", { value: opts.graphX == null ? opts.clientX : opts.graphX });
    Object.defineProperty(event, "graphY", { value: opts.graphY == null ? opts.clientY : opts.graphY });
    return event;
}

function fireGraphClick(harness, opts = {}) {
    const graph = harness.graph;
    const cell = opts.cell || null;
    graph.__hitCell = opts.hitCell === undefined ? cell : opts.hitCell;
    const down = makeMouseEvent(harness.dom.window, "mousedown", { clientX: opts.clientX || 100, clientY: opts.clientY || 120, graphX: opts.graphX || 90, graphY: opts.graphY || 100, detail: opts.detail });
    const up = makeMouseEvent(harness.dom.window, "mouseup", { clientX: opts.upClientX || opts.clientX || 100, clientY: opts.upClientY || opts.clientY || 120, graphX: opts.graphX || 90, graphY: opts.graphY || 100, detail: opts.detail });
    const makeMe = event => ({
        getEvent() { return event; },
        getCell() { return cell; },
        getGraphX() { return event.graphX; },
        getGraphY() { return event.graphY; }
    });
    harness.mouseListeners.forEach(listener => listener.mouseDown(graph, makeMe(down)));
    if (opts.selectCellOnDown) graph.setSelectionCell(opts.selectCellOnDown);
    harness.mouseListeners.forEach(listener => listener.mouseUp(graph, makeMe(up)));
}

function overlayButtons(document) {
    return Array.from(document.querySelectorAll(".trellis-root-module-overlay button"));
}

function roleOverlay(document) {
    return document.querySelector(".trellis-team-role-overlay");
}

function roleOverlayButtons(document) {
    return Array.from(document.querySelectorAll(".trellis-team-role-overlay button"));
}

function roleOverlayInput(document, ariaLabel) {
    const input = document.querySelector(`.trellis-team-role-overlay input[aria-label='${ariaLabel}']`);
    assert.ok(input, "missing team overlay input " + ariaLabel);
    return input;
}

function dispatchInputKey(input, key) {
    input.dispatchEvent(new input.ownerDocument.defaultView.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
}

function roleImageOverlay(document) {
    return document.querySelector(".trellis-role-image-overlay");
}

function roleImageOverlayButtons(document) {
    return Array.from(document.querySelectorAll(".trellis-role-image-overlay button"));
}

function isRoleImageOverlayVisible(document) {
    const overlay = roleImageOverlay(document);
    return !!overlay && overlay.style.display !== "none";
}

function fireMappedListeners(map, eventName) {
    (map.get(eventName) || []).forEach(listener => listener({}, {}));
}

function menuItemsFor(harness, cell, evt) {
    const items = [];
    const menu = {
        addItem(label, _icon, funct) { items.push({ label, funct }); },
        addSeparator() {}
    };
    harness.contextMenuContributors.forEach(contributor => contributor.addItems(menu, cell, evt));
    return items;
}

function styleHas(cell, flag) {
    return new RegExp("(^|;)" + flag + "(;|$)").test(cell && cell.style || "");
}

function cellText(cell) {
    if (!cell) return "";
    const raw = cell.value && cell.value.getAttribute ? (cell.value.getAttribute("label") || "") : (cell.value == null ? "" : String(cell.value));
    return String(raw).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function createRoleFixture(harness) {
    const team = harness.graph.__trellisModules.createModuleAtPoint({ x: 50, y: 60 }, "team");
    const role = harness.graph.__trellisModules.createRoleCard(team, 90, 100);
    const imageRow = role.children.find(child => styleHas(child, "role_imagerow=1"));
    const nameRow = role.children.find(child => styleHas(child, "role_name=1"));
    const titleRow = role.children.find(child => styleHas(child, "role_title=1"));
    const fieldLabels = role.children.filter(child => styleHas(child, "role_field_label=1"));
    const headerSeparator = role.children.find(child => styleHas(child, "role_header_separator=1"));
    const notesLabel = fieldLabels.find(child => child.value === "Description / notes");
    const notesRow = role.children.find(child => notesLabel && child.geometry && child.geometry.x === notesLabel.geometry.x && child.geometry.y > notesLabel.geometry.y && !styleHas(child, "role_field_label=1"));
    const contactLabel = fieldLabels.find(child => child.value === "Contact info");
    const contactRow = role.children.find(child => contactLabel && child.geometry && child.geometry.x === contactLabel.geometry.x && child.geometry.y > contactLabel.geometry.y && !styleHas(child, "role_field_label=1"));
    return { team, role, imageRow, nameRow, titleRow, fieldLabels, headerSeparator, notesRow, contactRow };
}

function runModulesContextMenu(harness, cell) {
    const contributor = harness.contextMenuContributors.find(item => item.id === "modules");
    assert.ok(contributor);
    const labels = [];
    const actions = new Map();
    const menu = {
        addSeparator() { labels.push("---"); },
        addItem(label, _image, funct) { labels.push(label); if (typeof funct === "function") actions.set(label, funct); }
    };
    contributor.addItems(menu, cell, { graphX: 90, graphY: 100, clientX: 100, clientY: 120 });
    return { labels, actions };
}

function getRoleAvatar(imageRow) {
    return (imageRow.children || []).find(child => styleHas(child, "role_avatar=1")) || null;
}

function waitForTimers() {
    return new Promise(resolve => setTimeout(resolve, 5));
}

test("createModuleAtPoint creates a regular module at requested coordinates", () => {
    const harness = makeHarness();
    const mod = harness.graph.__trellisModules.createModuleAtPoint({ x: 11, y: 22 }, "regular");
    assert.equal(harness.root.children[0], mod);
    assert.equal(mod.geometry.x, 11);
    assert.equal(mod.geometry.y, 22);
    assert.match(mod.style, /module=1/);
    assert.equal(mod.getAttribute("garden_module"), null);
    assert.equal(mod.getAttribute("team_module"), null);
    assert.equal(harness.selectedCell, mod);
});

test("createModuleAtPoint creates garden module with settings-needed event", async () => {
    const harness = makeHarness();
    let ensuredTaskBoard = null;
    harness.graph.__trellisTaskManager = { ensureMainBoardInTaskModule(taskModule) { ensuredTaskBoard = taskModule; } };
    const mod = harness.graph.__trellisModules.createModuleAtPoint({ x: 30, y: 40 }, "garden");
    await new Promise(resolve => setTimeout(resolve, 5));
    const team = harness.root.children.find(child => child !== mod && child.getAttribute("team_module") === "1");
    const task = harness.root.children.find(child => child !== mod && child.getAttribute("task_module") === "1");
    assert.equal(mod.getAttribute("garden_module"), "1");
    assert.equal(mod.getAttribute("team_module"), null);
    assert.ok(team);
    assert.ok(task);
    assert.equal(mod.getAttribute("trellis_team_module_id"), team.id);
    assert.equal(team.getAttribute("trellis_garden_module_id"), mod.id);
    assert.equal(mod.getAttribute("trellis_task_module_id"), task.id);
    assert.equal(task.getAttribute("trellis_garden_module_id"), mod.id);
    assert.match(mod.getAttribute("linkedTo") || "", new RegExp(team.id));
    assert.match(team.getAttribute("linkedTo") || "", new RegExp(mod.id));
    assert.match(mod.getAttribute("linkedTo") || "", new RegExp(task.id));
    assert.match(task.getAttribute("linkedTo") || "", new RegExp(mod.id));
    assert.equal(ensuredTaskBoard, task);
    assert.match(mod.style, /swimlaneFillColor=#B9E0A5/);
    assert.equal(mod.geometry.width, 160); // CHANGE
    assert.equal(mod.geometry.height, 100); // CHANGE
    assert.equal(harness.selectedCell, mod);
    const settingsEvents = harness.firedEvents.filter(event => event.name === "usl:gardenModuleNeedsSettings");
    assert.equal(settingsEvents.length, 1);
    assert.equal(settingsEvents[0].getProperty("cell"), mod);
});

test("createModuleAtPoint creates team module", () => {
    const harness = makeHarness();
    const mod = harness.graph.__trellisModules.createModuleAtPoint({ x: 50, y: 60 }, "team");
    assert.equal(mod.getAttribute("team_module"), "1");
    assert.equal(mod.getAttribute("garden_module"), null);
    assert.match(mod.style, /swimlaneFillColor=#FFF2CC/);
    assert.equal(harness.selectedCell, mod);
});

test("createModuleAtPoint creates task module", () => {
    const harness = makeHarness();
    const mod = harness.graph.__trellisModules.createModuleAtPoint({ x: 50, y: 60 }, "task");
    assert.equal(mod.getAttribute("task_module"), "1");
    assert.equal(mod.getAttribute("garden_module"), null);
    assert.equal(mod.getAttribute("team_module"), null);
    assert.match(mod.style, /swimlaneFillColor=#E0F2FE/);
    assert.equal(harness.selectedCell, mod);
});

test("garden companion team repair reuses typed team module", () => {
    const harness = makeHarness();
    const garden = harness.graph.__trellisModules.createModuleAtPoint({ x: 30, y: 40 }, "garden");
    const team = harness.model.getCell(garden.getAttribute("trellis_team_module_id"));
    const repaired = harness.graph.__trellisModules.ensureGardenTeamModule(garden);
    assert.equal(repaired, team);
    assert.equal(harness.root.children.filter(child => child.getAttribute("team_module") === "1").length, 1);
});

test("garden companion task repair reuses typed task module and mirrors access", () => {
    const harness = makeHarness();
    let ensuredTaskBoard = null;
    harness.graph.__trellisTaskManager = { ensureMainBoardInTaskModule(taskModule) { ensuredTaskBoard = taskModule; } };
    const garden = harness.graph.__trellisModules.createModuleAtPoint({ x: 30, y: 40 }, "garden");
    garden.value.setAttribute("trellis_owner_user_id", "owner-1");
    garden.value.setAttribute("trellis_access_grants_json", "[{\"userId\":\"u1\",\"preset\":\"gardener\",\"capabilities\":[]}]");
    ensuredTaskBoard = null;
    const repaired = harness.graph.__trellisModules.ensureGardenTaskModule(garden);
    const team = harness.model.getCell(garden.getAttribute("trellis_team_module_id"));
    assert.equal(repaired.getAttribute("task_module"), "1");
    assert.equal(repaired.getAttribute("trellis_garden_module_id"), garden.id);
    assert.equal(repaired.getAttribute("trellis_owner_user_id"), "owner-1");
    assert.equal(repaired.getAttribute("trellis_access_grants_json"), garden.getAttribute("trellis_access_grants_json"));
    assert.equal(team.getAttribute("trellis_owner_user_id"), "owner-1");
    assert.equal(harness.root.children.filter(child => child.getAttribute("task_module") === "1").length, 1);
    assert.ok(repaired.geometry.y > team.geometry.y);
    assert.equal(ensuredTaskBoard, null);
    harness.graph.__trellisModules.ensureGardenTaskModule(garden, { createMainBoard: true });
    assert.equal(ensuredTaskBoard, repaired);
});

test("module cells cannot be dropped under non-module parents", () => {
    const harness = makeHarness();
    const nonModule = new TestCell("plain", new TestGeometry(0, 0, 400, 300), "shape=rectangle;");
    nonModule.vertex = true;
    harness.model.add(harness.root, nonModule);
    const mod = harness.graph.__trellisModules.createModuleAtPoint({ x: 11, y: 22 }, "regular");
    assert.equal(harness.graph.isValidDropTarget(nonModule, [mod]), false);
    harness.model.add(nonModule, mod);
    harness.graph.fireEvent(makeEventObject("cellsMoved", ["cells", [mod]]));
    assert.equal(harness.model.getParent(mod), harness.root);
});

test("promptSetModuleMargin updates style and reapplies module sizing", async () => {
    const harness = makeHarness();
    const mod = harness.graph.__trellisModules.createModuleAtPoint({ x: 11, y: 22 }, "regular");
    mod.style += ";module_margin=12";
    const child = new TestCell("child", new TestGeometry(20, 30, 220, 80), "");
    child.vertex = true;
    harness.model.add(mod, child);
    harness.setPromptValue("45");
    harness.graph.__trellisModules.promptSetModuleMargin(mod);
    await waitForTimers();
    assert.equal(harness.promptCalls.length, 1);
    assert.equal(harness.promptCalls[0].value, "12");
    assert.match(mod.style, /(?:^|;)module_margin=45(?:;|$)/);
    assert.doesNotMatch(mod.style, /(?:^|;)module_margin=12(?:;|$)/);
    assert.equal(mod.geometry.width, 285);
    assert.equal(mod.geometry.height, 155);
});

test("module margin prompt can be requested through the fallback graph event", async () => {
    const harness = makeHarness();
    const mod = harness.graph.__trellisModules.createModuleAtPoint({ x: 11, y: 22 }, "regular");
    harness.setPromptValue("30");
    harness.graph.fireEvent(makeEventObject("usl:requestPromptSetModuleMargin", ["cell", mod]));
    await waitForTimers();
    assert.equal(harness.promptCalls.length, 1);
    assert.equal(harness.promptCalls[0].value, "450"); // CHANGE
    assert.match(mod.style, /(?:^|;)module_margin=30(?:;|$)/);
});

test("module margin API updates style and reapplies module sizing without prompt", () => {
    const harness = makeHarness();
    const mod = harness.graph.__trellisModules.createModuleAtPoint({ x: 11, y: 22 }, "regular");
    const child = new TestCell("child", new TestGeometry(20, 30, 220, 80), "");
    child.vertex = true;
    harness.model.add(mod, child);
    assert.equal(harness.graph.__trellisModules.getModuleMargin(mod), 450); // CHANGE
    harness.graph.__trellisModules.setModuleMargin(mod, 35);
    assert.equal(harness.promptCalls.length, 0);
    assert.equal(harness.graph.__trellisModules.getModuleMargin(mod), 35); // CHANGE
    assert.match(mod.style, /(?:^|;)module_margin=35(?:;|$)/);
    assert.equal(mod.geometry.width, 275);
    assert.equal(mod.geometry.height, 145);
});

test("module margin can be set through the fallback graph event", () => {
    const harness = makeHarness();
    const mod = harness.graph.__trellisModules.createModuleAtPoint({ x: 11, y: 22 }, "regular");
    harness.graph.fireEvent(makeEventObject("usl:requestSetModuleMargin", ["cell", mod, "marginPx", 27]));
    assert.equal(harness.promptCalls.length, 0);
    assert.match(mod.style, /(?:^|;)module_margin=27(?:;|$)/);
    assert.equal(harness.graph.__trellisModules.getModuleMargin(mod), 27); // CHANGE
});

test("module external margin API stores spacing and pushes neighbors", () => {
    const harness = makeHarness();
    const left = harness.graph.__trellisModules.createModuleAtPoint({ x: 0, y: 0 }, "regular");
    const right = harness.graph.__trellisModules.createModuleAtPoint({ x: 260, y: 0 }, "regular");
    assert.equal(harness.graph.__trellisModules.getModuleExternalMargin(left), 40); // NEW
    harness.graph.__trellisModules.setModuleExternalMargin(left, 120);
    assert.match(left.style, /(?:^|;)module_external_margin=120(?:;|$)/); // NEW
    assert.equal(right.geometry.x, 280); // NEW
});

test("created modules push neighboring modules to maintain external margins", () => {
    const harness = makeHarness();
    const existing = harness.graph.__trellisModules.createModuleAtPoint({ x: 200, y: 0 }, "regular");
    harness.graph.__trellisModules.setModuleExternalMargin(existing, 80);
    const created = harness.graph.__trellisModules.createModuleAtPoint({ x: 0, y: 0 }, "regular");
    assert.equal(created.geometry.x, 0);
    assert.equal(existing.geometry.x, 240); // NEW
});

test("moved modules push neighbors using the move vector", () => {
    const harness = makeHarness();
    const left = harness.graph.__trellisModules.createModuleAtPoint({ x: 0, y: 0 }, "regular");
    const right = harness.graph.__trellisModules.createModuleAtPoint({ x: 300, y: 0 }, "regular");
    const moved = left.geometry.clone();
    moved.x = 120;
    harness.model.setGeometry(left, moved);
    harness.graph.fireEvent(makeEventObject("cellsMoved", ["cells", [left], "dx", 120, "dy", 0]));
    assert.equal(right.geometry.x, 320); // NEW
});

test("resized modules push neighbors on expanded edges", () => {
    const harness = makeHarness();
    const left = harness.graph.__trellisModules.createModuleAtPoint({ x: 0, y: 0 }, "regular");
    const right = harness.graph.__trellisModules.createModuleAtPoint({ x: 220, y: 0 }, "regular");
    const previous = left.geometry.clone();
    const next = left.geometry.clone();
    next.width = 200;
    harness.model.setGeometry(left, next);
    harness.graph.fireEvent(makeEventObject("cellsResized", ["cells", [left], "bounds", [next], "previous", [previous]]));
    assert.equal(right.geometry.x, 240); // NEW
});

test("empty canvas click renders root module overlay buttons", () => {
    const harness = makeHarness();
    fireGraphClick(harness, { clientX: 120, clientY: 150, graphX: 200, graphY: 230 });
    const buttons = overlayButtons(harness.document);
    assert.deepEqual(buttons.map(button => button.textContent), ["Add Module", "Add Garden Module", "Add Team Module", "Add Task Module"]);
    assert.equal(harness.document.querySelector(".trellis-root-module-overlay").style.display, "flex");
});

test("overlay buttons create the selected module type at stored click point and hide", async () => {
    const harness = makeHarness();
    fireGraphClick(harness, { clientX: 130, clientY: 160, graphX: 210, graphY: 240 });
    overlayButtons(harness.document)[1].dispatchEvent(new harness.dom.window.MouseEvent("click", { bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 5));
    const mod = harness.root.children[0];
    assert.equal(mod.geometry.x, 210);
    assert.equal(mod.geometry.y, 240);
    assert.equal(mod.getAttribute("garden_module"), "1");
    assert.equal(harness.document.querySelector(".trellis-root-module-overlay").style.display, "none");
});

test("clicking an existing cell does not render the root module overlay", () => {
    const harness = makeHarness();
    const existing = harness.graph.__trellisModules.createModuleAtPoint({ x: 5, y: 6 }, "regular");
    fireGraphClick(harness, { cell: existing, hitCell: existing, clientX: 140, clientY: 170, graphX: 220, graphY: 250 });
    const overlay = harness.document.querySelector(".trellis-root-module-overlay");
    assert.equal(overlay, null);
});

test("overlay dismisses on Escape and outside graph gesture", () => {
    const harness = makeHarness();
    fireGraphClick(harness, { clientX: 150, clientY: 180, graphX: 230, graphY: 260 });
    const overlay = harness.document.querySelector(".trellis-root-module-overlay");
    assert.equal(overlay.style.display, "flex");
    harness.document.dispatchEvent(new harness.dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    assert.equal(overlay.style.display, "none");
    fireGraphClick(harness, { clientX: 150, clientY: 180, graphX: 230, graphY: 260 });
    assert.equal(overlay.style.display, "flex");
    const existing = harness.graph.__trellisModules.createModuleAtPoint({ x: 1, y: 2 }, "regular");
    fireGraphClick(harness, { cell: existing, hitCell: existing, clientX: 160, clientY: 190, graphX: 240, graphY: 270 });
    assert.equal(overlay.style.display, "none");
});

test("empty canvas click while overlay is active dismisses without reopening", () => {
    const harness = makeHarness();
    fireGraphClick(harness, { clientX: 170, clientY: 200, graphX: 250, graphY: 280 });
    const overlay = harness.document.querySelector(".trellis-root-module-overlay");
    assert.equal(overlay.style.display, "flex");
    fireGraphClick(harness, { clientX: 190, clientY: 220, graphX: 270, graphY: 300 });
    assert.equal(overlay.style.display, "none");
    fireGraphClick(harness, { clientX: 210, clientY: 240, graphX: 290, graphY: 320 });
    assert.equal(overlay.style.display, "flex");
});

test("selecting one team module renders the add role card overlay", () => {
    const harness = makeHarness();
    const team = harness.graph.__trellisModules.createModuleAtPoint({ x: 50, y: 60 }, "team");
    const buttons = roleOverlayButtons(harness.document);
    assert.deepEqual(buttons.map(button => button.textContent), ["Add Role Card", "Set Module Margins"]); // CHANGE
    assert.equal(roleOverlayInput(harness.document, "Team label").value, "Team Module");
    assert.equal(roleOverlay(harness.document).querySelectorAll(".trellis-team-module-label-controls input").length, 1);
    assert.equal(roleOverlay(harness.document).querySelector(".trellis-team-module-label-controls").textContent.includes("Garden label"), false);
    assert.equal(roleOverlay(harness.document).querySelector(".trellis-team-module-label-controls").textContent.includes("Team label"), false);
    assert.equal(roleOverlay(harness.document).style.display, "flex");
    assert.equal(roleOverlay(harness.document).style.left, "58px");
    assert.equal(roleOverlay(harness.document).style.top, "68px");
    assert.equal(harness.selectedCell, team);
});

test("team module overlay edits labels without graph action side effects", () => {
    const harness = makeHarness();
    const team = harness.graph.__trellisModules.createModuleAtPoint({ x: 50, y: 60 }, "team");
    harness.clearValueWrites();
    const oldTeamValue = team.value;
    const oldTeamLabel = oldTeamValue.getAttribute("label");
    let input = roleOverlayInput(harness.document, "Team label");
    input.value = "Harvest Crew";
    input.dispatchEvent(new harness.dom.window.Event("blur"));
    assert.equal(team.getAttribute("label"), "Harvest Crew");
    assert.equal(harness.valueWrites.length, 1);
    assert.equal(harness.valueWrites[0].oldValue, oldTeamValue);
    assert.notEqual(harness.valueWrites[0].newValue, oldTeamValue);
    assert.equal(oldTeamValue.getAttribute("label"), oldTeamLabel);

    harness.graph.setSelectionCell(team);
    harness.clearValueWrites();
    input = roleOverlayInput(harness.document, "Team label");
    input.value = "Draft Crew";
    dispatchInputKey(input, "Escape");
    assert.equal(input.value, "Harvest Crew");
    assert.equal(team.getAttribute("label"), "Harvest Crew");
    assert.equal(harness.valueWrites.length, 0);

    input.value = "   ";
    dispatchInputKey(input, "Enter");
    assert.equal(team.getAttribute("label"), "Team Module");
});

test("module label API writes garden and team labels with clone-backed undo values", () => {
    const harness = makeHarness();
    const garden = harness.graph.__trellisModules.createModuleAtPoint({ x: 30, y: 40 }, "garden");
    const team = harness.model.getCell(garden.getAttribute("trellis_team_module_id"));

    harness.clearValueWrites();
    const oldGardenValue = garden.value;
    const oldGardenLabel = oldGardenValue.getAttribute("label");
    assert.equal(harness.graph.__trellisModules.writeModuleLabel(garden, "Kitchen Garden"), "Kitchen Garden");
    assert.equal(harness.valueWrites.length, 1);
    assert.equal(harness.valueWrites[0].cell, garden);
    assert.equal(harness.valueWrites[0].oldValue, oldGardenValue);
    assert.notEqual(harness.valueWrites[0].newValue, oldGardenValue);
    assert.equal(oldGardenValue.getAttribute("label"), oldGardenLabel);
    assert.equal(garden.getAttribute("label"), "Kitchen Garden");

    harness.clearValueWrites();
    assert.equal(harness.graph.__trellisModules.writeModuleLabel(garden, "Kitchen Garden"), "Kitchen Garden");
    assert.equal(harness.valueWrites.length, 0);

    harness.clearValueWrites();
    const oldTeamValue = team.value;
    const oldTeamLabel = oldTeamValue.getAttribute("label");
    assert.equal(harness.graph.__trellisModules.writeModuleLabel(team, "Harvest Crew"), "Harvest Crew");
    assert.equal(harness.valueWrites.length, 1);
    assert.equal(harness.valueWrites[0].cell, team);
    assert.equal(harness.valueWrites[0].oldValue, oldTeamValue);
    assert.notEqual(harness.valueWrites[0].newValue, oldTeamValue);
    assert.equal(oldTeamValue.getAttribute("label"), oldTeamLabel);
    assert.equal(team.getAttribute("label"), "Harvest Crew");
});

test("linked team module overlay uses a single editable team label field", () => {
    const harness = makeHarness();
    const garden = harness.graph.__trellisModules.createModuleAtPoint({ x: 30, y: 40 }, "garden");
    const team = harness.model.getCell(garden.getAttribute("trellis_team_module_id"));
    harness.graph.__trellisModules.writeModuleLabel(garden, "Kitchen Garden");
    harness.graph.setSelectionCell(team);
    const controls = roleOverlay(harness.document).querySelector(".trellis-team-module-label-controls");
    assert.equal(controls.querySelectorAll("input[aria-label='Team label']").length, 1);
    assert.equal(controls.textContent.includes("Garden label"), false);
    assert.equal(controls.textContent.includes("Team label"), false);
    assert.equal(roleOverlayInput(harness.document, "Team label").value, "Garden Team");

    garden.value.setAttribute("label", "Market Garden");
    harness.graph.setSelectionCell(team);
    assert.equal(roleOverlay(harness.document).querySelector(".trellis-team-module-label-controls").textContent.includes("Market Garden"), false);
});

test("team module overlay position is not clamped to the viewport", () => {
    const harness = makeHarness();
    const team = harness.graph.__trellisModules.createModuleAtPoint({ x: -40, y: -50 }, "team");
    const overlay = roleOverlay(harness.document);
    assert.equal(overlay.style.display, "flex");
    assert.equal(overlay.style.left, "-32px");
    assert.equal(overlay.style.top, "-42px");
    assert.equal(harness.selectedCell, team);
});

test("first click selecting a team module shows role overlay next to the click", () => {
    const harness = makeHarness();
    const team = harness.graph.__trellisModules.createModuleAtPoint({ x: 50, y: 60 }, "team");
    harness.graph.setSelectionCell(null);
    fireGraphClick(harness, { cell: team, hitCell: team, selectCellOnDown: team, clientX: 180, clientY: 220, graphX: 90, graphY: 100 });
    const overlay = roleOverlay(harness.document);
    assert.equal(overlay.style.display, "flex");
    assert.equal(overlay.style.left, "178px");
    assert.equal(overlay.style.top, "208px");
});

test("selecting regular or garden modules does not render the role card overlay", () => {
    const harness = makeHarness();
    const regular = harness.graph.__trellisModules.createModuleAtPoint({ x: 10, y: 20 }, "regular");
    assert.equal(roleOverlay(harness.document), null);
    const garden = harness.graph.__trellisModules.createModuleAtPoint({ x: 30, y: 40 }, "garden");
    assert.equal(roleOverlay(harness.document), null);
    harness.graph.setSelectionCell(regular);
    assert.equal(roleOverlay(harness.document), null);
    harness.graph.setSelectionCell(garden);
    assert.equal(roleOverlay(harness.document), null);
});

test("role overlay button creates role card from stored click point and hides", () => {
    const harness = makeHarness();
    const team = harness.graph.__trellisModules.createModuleAtPoint({ x: 50, y: 60 }, "team");
    harness.document.dispatchEvent(new harness.dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    fireGraphClick(harness, { cell: team, hitCell: team, clientX: 100, clientY: 120, graphX: 90, graphY: 100 });
    harness.graph.setSelectionCell(team);
    const updateCountBefore = harness.model.topLevelUpdateCount;
    roleOverlayButtons(harness.document)[0].dispatchEvent(new harness.dom.window.MouseEvent("click", { bubbles: true }));
    const role = team.children.find(child => /(^|;)role_card=1(;|$)/.test(child.style));
    assert.ok(role);
    assert.equal(role.geometry.x, 40);
    assert.equal(role.geometry.y, 40);
    assert.equal(harness.selectedCell, role);
    assert.equal(roleOverlay(harness.document).style.display, "none");
    assert.equal(harness.model.topLevelUpdateCount - updateCountBefore, 1);
});

test("context menu add role card uses one top-level model transaction", () => {
    const harness = makeHarness();
    const team = harness.graph.__trellisModules.createModuleAtPoint({ x: 50, y: 60 }, "team");
    const evt = makeMouseEvent(harness.dom.window, "mouseup", { clientX: 110, clientY: 130, graphX: 95, graphY: 105 });
    const addRole = menuItemsFor(harness, team, evt).find(item => item.label === "Add Role Card");
    assert.ok(addRole);
    const updateCountBefore = harness.model.topLevelUpdateCount;
    addRole.funct();
    const role = team.children.find(child => /(^|;)role_card=1(;|$)/.test(child.style));
    assert.ok(role);
    assert.equal(role.geometry.x, 45);
    assert.equal(role.geometry.y, 45);
    assert.equal(harness.selectedCell, role);
    assert.equal(harness.model.topLevelUpdateCount - updateCountBefore, 1);
});

test("role overlay button falls back to top-left content placement", () => {
    const harness = makeHarness();
    const team = harness.graph.__trellisModules.createModuleAtPoint({ x: 50, y: 60 }, "team");
    roleOverlayButtons(harness.document)[0].dispatchEvent(new harness.dom.window.MouseEvent("click", { bubbles: true }));
    const role = team.children.find(child => /(^|;)role_card=1(;|$)/.test(child.style));
    assert.ok(role);
    assert.equal(role.geometry.x, 100);
    assert.equal(role.geometry.y, 100);
    assert.equal(harness.selectedCell, role);
    assert.equal(roleOverlay(harness.document).style.display, "none");
});

test("role overlay margin button opens the combined module margins dialog", () => {
    const harness = makeHarness();
    const team = harness.graph.__trellisModules.createModuleAtPoint({ x: 50, y: 60 }, "team");
    roleOverlayButtons(harness.document)[1].dispatchEvent(new harness.dom.window.MouseEvent("click", { bubbles: true }));
    assert.ok(harness.lastDialog); // CHANGE
    assert.equal(harness.lastDialog.querySelector("div").textContent, "Set Module Margins"); // CHANGE
    const inputs = harness.lastDialog.querySelectorAll("input"); // CHANGE
    assert.equal(inputs.length, 2); // CHANGE
    inputs[0].value = "65"; // CHANGE
    inputs[1].value = "25"; // CHANGE
    Array.from(harness.lastDialog.querySelectorAll("button")).find(button => button.textContent === "OK").dispatchEvent(new harness.dom.window.MouseEvent("click", { bubbles: true })); // CHANGE
    assert.match(team.style, /(?:^|;)module_margin=65(?:;|$)/);
    assert.match(team.style, /(?:^|;)module_external_margin=25(?:;|$)/); // CHANGE
    assert.equal(roleOverlay(harness.document).style.display, "none");
});

test("linked team module margin dialog uses the garden unit system", () => {
    const harness = makeHarness();
    const garden = harness.graph.__trellisModules.createModuleAtPoint({ x: 30, y: 40 }, "garden");
    garden.value.setAttribute("unit_system", "metric"); // NEW
    const team = harness.model.getCell(garden.getAttribute("trellis_team_module_id"));
    team.style += ";module_margin=180;module_external_margin=45"; // NEW
    harness.graph.setSelectionCell(team);

    roleOverlayButtons(harness.document)[1].dispatchEvent(new harness.dom.window.MouseEvent("click", { bubbles: true }));
    const labels = Array.from(harness.lastDialog.querySelectorAll("label")).map(label => label.textContent); // NEW
    const inputs = harness.lastDialog.querySelectorAll("input"); // NEW
    assert.deepEqual(labels, ["Internal margin (m):", "External margin (m):"]); // NEW
    assert.equal(inputs[0].value, "2"); // NEW
    assert.equal(inputs[1].value, "0.5"); // NEW

    inputs[0].value = "3"; // NEW
    inputs[1].value = "1.25"; // NEW
    Array.from(harness.lastDialog.querySelectorAll("button")).find(button => button.textContent === "OK").dispatchEvent(new harness.dom.window.MouseEvent("click", { bubbles: true })); // NEW
    assert.match(team.style, /(?:^|;)module_margin=270(?:;|$)/); // NEW
    assert.match(team.style, /(?:^|;)module_external_margin=113(?:;|$)/); // NEW
});

test("clicking the already-selected team module hides role overlay without reopening", () => {
    const harness = makeHarness();
    const team = harness.graph.__trellisModules.createModuleAtPoint({ x: 50, y: 60 }, "team");
    const overlay = roleOverlay(harness.document);
    assert.equal(overlay.style.display, "flex");
    fireGraphClick(harness, { cell: team, hitCell: team, clientX: 100, clientY: 120, graphX: 90, graphY: 100 });
    assert.equal(overlay.style.display, "none");
    assert.equal(roleOverlayButtons(harness.document).length, 2); // CHANGE
});

test("role overlay hides on Escape, outside gesture, model change, and view change", () => {
    const harness = makeHarness();
    const team = harness.graph.__trellisModules.createModuleAtPoint({ x: 50, y: 60 }, "team");
    const overlay = roleOverlay(harness.document);
    assert.equal(overlay.style.display, "flex");
    harness.document.dispatchEvent(new harness.dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    assert.equal(overlay.style.display, "none");
    harness.graph.setSelectionCell(team);
    assert.equal(overlay.style.display, "flex");
    fireGraphClick(harness, { clientX: 200, clientY: 220, graphX: 190, graphY: 200 });
    assert.equal(overlay.style.display, "none");
    harness.graph.setSelectionCell(team);
    assert.equal(overlay.style.display, "flex");
    harness.model.fire("change");
    assert.equal(overlay.style.display, "none");
    harness.graph.setSelectionCell(team);
    assert.equal(overlay.style.display, "flex");
    fireMappedListeners(harness.viewListeners, "scale");
    assert.equal(overlay.style.display, "none");
    harness.graph.setSelectionCell(team);
    assert.equal(overlay.style.display, "flex");
    fireMappedListeners(harness.viewListeners, "translate");
    assert.equal(overlay.style.display, "none");
});

test("new role cards use v2 compact roster profile geometry", () => {
    const harness = makeHarness();
    const { role, imageRow, nameRow, titleRow, fieldLabels, headerSeparator, notesRow, contactRow } = createRoleFixture(harness);
    assert.match(role.style, /(?:^|;)role_card=1(?:;|$)/);
    assert.match(role.style, /(?:^|;)role_card_version=2(?:;|$)/);
    assert.match(role.style, /(?:^|;)shape=label(?:;|$)/);
    assert.match(role.style, /(?:^|;)resizable=0(?:;|$)/);
    assert.doesNotMatch(role.style, /(?:^|;)shape=swimlane(?:;|$)/);
    assert.doesNotMatch(role.style, /(?:^|;)startSize=/);
    assert.doesNotMatch(role.style, /(?:^|;)swimlaneFillColor=/);
    assert.equal(role.geometry.width, 260);
    assert.equal(role.geometry.height, 250);
    assert.equal(role.geometry.alternateBounds.width, 180);
    assert.equal(role.geometry.alternateBounds.height, 64);
    assert.equal(imageRow.value, "click to add image");
    assert.equal(imageRow.geometry.y, 76);
    assert.equal(nameRow.geometry.y, 76);
    assert.equal(titleRow.geometry.y, 118);
    assert.ok(notesRow);
    assert.ok(contactRow);
    assert.equal(contactRow.geometry.y, 208);
    assert.equal(contactRow.geometry.height, 32);
    assert.equal(styleHas(nameRow, "role_name=1"), true);
    assert.equal(styleHas(titleRow, "role_title=1"), true);
    assert.equal(role.children.filter(child => styleHas(child, "role_name=1")).length, 1);
    assert.equal(role.children.filter(child => styleHas(child, "role_title=1")).length, 1);
    assert.equal(nameRow.value, "");
    assert.equal(titleRow.value, "");
    [imageRow, nameRow, titleRow, notesRow, contactRow].forEach(cell => {
        assert.match(cell.style, /(?:^|;)html=1(?:;|$)/);
        assert.match(cell.style, /(?:^|;)whiteSpace=wrap(?:;|$)/);
        assert.match(cell.style, /(?:^|;)overflow=hidden(?:;|$)/);
    });
    assert.deepEqual(fieldLabels.map(cell => cell.value), ["Photo", "Name", "Role / title", "Description / notes", "Contact info"]);
    assert.equal(fieldLabels.every(cell => /(?:^|;)editable=0(?:;|$)/.test(cell.style)), true);
    assert.equal(fieldLabels.some(cell => styleHas(cell, "role_name=1") || styleHas(cell, "role_title=1")), false);
    assert.ok(headerSeparator);
    assert.equal(headerSeparator.geometry.y, 54);
    assert.match(headerSeparator.style, /(?:^|;)editable=0(?:;|$)/);
    assert.doesNotMatch(String(role.value), /<img/i);
    assert.match(role.style, /(?:^|;)image=data:image\/svg\+xml,/);
    assert.match(role.style, /(?:^|;)imageWidth=38(?:;|$)/);
    assert.match(role.style, /(?:^|;)imageHeight=38(?:;|$)/);
    assert.match(role.style, /(?:^|;)imageAlign=left(?:;|$)/);
    assert.match(role.style, /(?:^|;)imageVerticalAlign=top(?:;|$)/);
    assert.match(role.style, /(?:^|;)verticalAlign=top(?:;|$)/);
    assert.match(role.style, /(?:^|;)spacingTop=8(?:;|$)/);
});

test("v2 role card summary syncs name and role without prefixing value fields", () => {
    const harness = makeHarness();
    const { role, nameRow, titleRow } = createRoleFixture(harness);
    assert.match(String(role.value), /Unnamed person/);
    assert.match(String(role.value), /Unspecified role/);
    harness.model.setValue(nameRow, "Bob");
    harness.model.setValue(titleRow, "Lead gardener");
    harness.model.fire("change");
    assert.match(String(role.value), /Bob/);
    assert.match(String(role.value), /Lead gardener/);
    assert.equal(nameRow.value, "Bob");
    assert.equal(titleRow.value, "Lead gardener");
    assert.doesNotMatch(String(nameRow.value), /^Name:/);
    assert.doesNotMatch(String(titleRow.value), /^Role/);
});

test("legacy role cards are not rewritten by summary sync", () => {
    const harness = makeHarness();
    const team = harness.graph.__trellisModules.createModuleAtPoint({ x: 50, y: 60 }, "team");
    const role = new TestCell("Legacy Role", new TestGeometry(10, 20, 240, 160), "shape=swimlane;role_card=1;");
    role.vertex = true;
    harness.model.add(team, role);
    const name = new TestCell("Legacy Name", new TestGeometry(0, 0, 100, 30), "role_name=1;");
    name.vertex = true;
    harness.model.add(role, name);
    harness.model.fire("change");
    assert.equal(role.value, "Legacy Role");
});

test("empty role image slot shows add affordances for role card and image row only", () => {
    const harness = makeHarness();
    const { role, imageRow, nameRow } = createRoleFixture(harness);
    harness.graph.setSelectionCell(role);
    assert.equal(roleImageOverlayButtons(harness.document)[0].textContent, "Add Image");
    assert.equal(isRoleImageOverlayVisible(harness.document), true);
    harness.graph.setSelectionCell(imageRow);
    assert.equal(roleImageOverlayButtons(harness.document)[0].textContent, "Add Image");
    assert.equal(isRoleImageOverlayVisible(harness.document), true);
    harness.graph.setSelectionCell(nameRow);
    assert.equal(isRoleImageOverlayVisible(harness.document), false);
    assert.equal(runModulesContextMenu(harness, role).labels.includes("Add Role Image"), true);
    assert.equal(runModulesContextMenu(harness, imageRow).labels.includes("Add Role Image"), true);
    assert.equal(runModulesContextMenu(harness, nameRow).labels.includes("Add Role Image"), false);
});

test("existing role image shows change overlay from image section or avatar only", async () => {
    const harness = makeHarness();
    const { role, imageRow } = createRoleFixture(harness);
    harness.graph.__trellisModules.selectRoleImage(role);
    await waitForTimers();
    const avatar = getRoleAvatar(imageRow);
    assert.ok(avatar);
    harness.graph.setSelectionCell(role);
    assert.equal(isRoleImageOverlayVisible(harness.document), false);
    harness.graph.setSelectionCell(imageRow);
    assert.equal(roleImageOverlayButtons(harness.document)[0].textContent, "Change Image");
    assert.equal(isRoleImageOverlayVisible(harness.document), true);
    harness.graph.setSelectionCell(avatar);
    assert.equal(roleImageOverlayButtons(harness.document)[0].textContent, "Change Image");
    assert.equal(isRoleImageOverlayVisible(harness.document), true);
    assert.equal(runModulesContextMenu(harness, role).labels.includes("Change Role Image"), false);
    assert.equal(runModulesContextMenu(harness, imageRow).labels.includes("Change Role Image"), false);
    assert.equal(runModulesContextMenu(harness, avatar).labels.includes("Change Role Image"), true);
});

test("role image overlay button invokes insert image and creates the avatar", async () => {
    const harness = makeHarness();
    const { role, imageRow } = createRoleFixture(harness);
    harness.graph.setSelectionCell(role);
    roleImageOverlayButtons(harness.document)[0].dispatchEvent(new harness.dom.window.MouseEvent("click", { bubbles: true }));
    await waitForTimers();
    const avatar = getRoleAvatar(imageRow);
    assert.equal(harness.insertImageCalls, 1);
    assert.ok(avatar);
    assert.equal(avatar.parent, imageRow);
    assert.equal(avatar.geometry.width, 40);
    assert.equal(avatar.geometry.height, 40);
    assert.equal(avatar.geometry.x, 5);
    assert.equal(avatar.geometry.y, 5);
    assert.equal(imageRow.value, "");
    assert.doesNotMatch(String(role.value), /<img/i);
    assert.match(role.style, /(?:^|;)image=data:image\/png;base64,test(?:;|$)/);
    assert.match(role.style, /(?:^|;)imageWidth=38(?:;|$)/);
});

test("inserted role image replaces any prior avatar", async () => {
    const harness = makeHarness();
    const { role, imageRow } = createRoleFixture(harness);
    harness.graph.__trellisModules.selectRoleImage(role);
    await waitForTimers();
    const firstAvatar = getRoleAvatar(imageRow);
    assert.ok(firstAvatar);
    harness.graph.__trellisModules.selectRoleImage(role);
    await waitForTimers();
    const avatars = imageRow.children.filter(child => styleHas(child, "role_avatar=1"));
    assert.equal(avatars.length, 1);
    assert.notEqual(avatars[0], firstAvatar);
    assert.equal(firstAvatar.parent, null);
    assert.equal(avatars[0].geometry.width, 40);
    assert.equal(avatars[0].geometry.height, 40);
    assert.match(role.style, /(?:^|;)image=data:image\/png;base64,test(?:;|$)/);
    assert.doesNotMatch(String(role.value), /<img/i);
});
