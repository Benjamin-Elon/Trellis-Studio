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
        (cell.children || []).slice().forEach(child => this.remove(child)); // NEW
        if (cell.parent && cell.parent.children) cell.parent.children = cell.parent.children.filter(child => child !== cell);
        cell.parent = null;
        if (cell.id) delete this.cells[cell.id]; // NEW
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
    const dom = new JSDOM("<!doctype html><body><div id='graph'></div></body>", { url: "https://trellis.test/" }); // CHANGE
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
    const removeCalls = []; // NEW
    const foldCalls = []; // NEW
    const confirmations = []; // NEW
    const alerts = []; // NEW
    let insertImageCalls = 0;
    const editingStarts = []; // NEW
    const electronRequests = []; // NEW
    let promptValue = "40";
    let confirmResult = true; // NEW
    const promptCalls = [];
    let lastDialog = null; // NEW
    let selectedCells = [];
    let nullLeafChildren = false; // NEW
    const container = document.getElementById("graph");
    const originalGetChildren = model.getChildren.bind(model); // NEW
    model.getChildren = cell => { // NEW
        const children = originalGetChildren(cell); // NEW
        return nullLeafChildren && (!children || !children.length) ? null : children; // NEW
    }; // NEW
    Object.defineProperty(container, "clientWidth", { value: 800, configurable: true });
    Object.defineProperty(container, "clientHeight", { value: 600, configurable: true });
    container.getBoundingClientRect = () => ({ left: 10, top: 20, width: 800, height: 600 });
    dom.window.confirm = message => { confirmations.push(String(message)); return confirmResult; }; // NEW

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
        removeCells(cells, includeEdges) { // NEW
            const removed = []; // NEW
            function collect(cell) { // NEW
                if (!cell || removed.includes(cell)) return; // NEW
                removed.push(cell); // NEW
                (model.getChildren(cell) || []).forEach(collect); // NEW
            } // NEW
            (cells || selectedCells).forEach(collect); // NEW
            removeCalls.push({ cells: (cells || selectedCells).slice(), includeEdges }); // NEW
            removed.forEach(cell => model.remove(cell)); // NEW
            this.fireEvent(makeEventObject("cellsRemoved", ["cells", removed])); // NEW
            return removed; // NEW
        }, // NEW
        foldCells(collapse, recurse, cells) { // NEW
            foldCalls.push({ collapse: !!collapse, recurse: !!recurse, cells: (cells || []).slice() }); // NEW
            (cells || []).forEach(cell => { if (cell) cell.collapsed = !!collapse; }); // NEW
            return cells || []; // NEW
        }, // NEW
        isCellCollapsed(cell) { return !!(cell && cell.collapsed); }, // NEW
        moveCells(cells, dx = 0, dy = 0, _clone = false, target = null) { // NEW
            const moved = (cells || []).filter(Boolean);
            moved.forEach(cell => {
                const geo = model.getGeometry(cell);
                if (geo && !geo.relative) {
                    geo.x = (geo.x || 0) + dx;
                    geo.y = (geo.y || 0) + dy;
                }
                if (target) model.add(target, cell);
            });
            this.fireEvent(makeEventObject("cellsMoved", ["cells", moved, "dx", dx, "dy", dy]));
            this.movedCells = moved;
            this.lastMoveDelta = { dx, dy };
            return moved;
        },
        setSelectionCell(cell) { selectedCells = cell ? [cell] : []; (selectionListeners.get("change") || []).forEach(listener => listener(this, {})); },
        setSelectionCells(cells) { selectedCells = (cells || []).filter(Boolean); (selectionListeners.get("change") || []).forEach(listener => listener(this, {})); },
        getSelectionCell() { return selectedCells[0] || null; },
        getSelectionCells() { return selectedCells.slice(); },
        startEditingAtCell(cell, evt, initialText) { editingStarts.push({ cell, evt, initialText }); }, // NEW
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
        alert(message) { alerts.push(String(message)); }, // NEW
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
        confirm(message) { confirmations.push(String(message)); return confirmResult; }, // NEW
        Draw: { loadPlugin(callback) { callback(ui); } },
        mxCell: TestCell,
        mxGeometry: TestGeometry,
        mxLayoutManager: function mxLayoutManager() {},
        mxStackLayout: function mxStackLayout() {},
        mxEventObject: function mxEventObject(name, ...pairs) { return makeEventObject(name, pairs); },
        mxUtils: {
            createXmlDocument() { return document.implementation.createDocument("", "", null); },
            alert(message) { alerts.push(String(message)); } // NEW
        },
        mxEvent: {
            CHANGE: "change",
            REMOVE_CELLS: "removeCells", // NEW
            ADD_CELLS: "addCells",
            CELLS_ADDED: "cellsAdded",
            CELLS_REMOVED: "cellsRemoved", // NEW
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
    return {
        dom,
        document,
        graph,
        model,
        root,
        mouseListeners,
        graphListeners,
        viewListeners,
        selectionListeners,
        firedEvents,
        contextMenuContributors,
        promptCalls,
        removeCalls, // NEW
        foldCalls, // NEW
        confirmations, // NEW
        alerts, // NEW
        setPromptValue(value) { promptValue = value; },
        setConfirmResult(value) { confirmResult = value !== false; }, // NEW
        setNullLeafChildren(value) { nullLeafChildren = !!value; }, // NEW
        disableConfirm() { dom.window.confirm = undefined; context.confirm = undefined; }, // NEW
        setElectronImagePicker(options = {}) {
            dom.window.electron = {
                request(msg, callback, error) {
                    electronRequests.push(msg); // NEW
                    try {
                        if (msg.action === "getPicturesFolder") callback(options.picturesFolder || "C:\\Users\\test\\Pictures");
                        else if (msg.action === "getDocumentsFolder") callback(options.documentsFolder || "C:\\Users\\test\\Documents");
                        else if (msg.action === "showOpenDialog") callback(options.paths || ["C:\\Users\\test\\Pictures\\role.png"]);
                        else if (msg.action === "dirname") callback(options.dirname || "C:\\Users\\test\\Pictures");
                        else if (msg.action === "readFile") callback(options.base64 || "test");
                        else throw new Error("unexpected electron request " + msg.action);
                    } catch (e) {
                        if (error) error(e.message, e);
                    }
                }
            };
        }, // NEW
        clearValueWrites() { model.valueWrites.length = 0; },
        get valueWrites() { return model.valueWrites.slice(); },
        get insertImageCalls() { return insertImageCalls; },
        get editingStarts() { return editingStarts.slice(); }, // NEW
        get electronRequests() { return electronRequests.slice(); }, // NEW
        get selectedCell() { return selectedCells[0] || null; },
        get lastDialog() { return lastDialog; }
    }; // CHANGE
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
    const down = makeMouseEvent(harness.dom.window, "mousedown", { clientX: opts.clientX || 100, clientY: opts.clientY || 120, graphX: opts.graphX || 90, graphY: opts.graphY || 100, detail: opts.detail, ctrlKey: opts.ctrlKey, metaKey: opts.metaKey, shiftKey: opts.shiftKey, altKey: opts.altKey, button: opts.button }); // CHANGE
    const up = makeMouseEvent(harness.dom.window, "mouseup", { clientX: opts.upClientX || opts.clientX || 100, clientY: opts.upClientY || opts.clientY || 120, graphX: opts.graphX || 90, graphY: opts.graphY || 100, detail: opts.detail, ctrlKey: opts.ctrlKey, metaKey: opts.metaKey, shiftKey: opts.shiftKey, altKey: opts.altKey, button: opts.button }); // CHANGE
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

function visibleRoleOverlayButtonTexts(document) {
    return roleOverlayButtons(document).filter(button => button.style.display !== "none").map(button => button.textContent); // NEW
}

function roleOverlayButton(document, text) {
    const button = roleOverlayButtons(document).find(entry => entry.textContent === text); // NEW
    assert.ok(button, "missing team overlay button " + text); // NEW
    return button; // NEW
} // NEW

function roleCardsUnder(cell) {
    const out = []; // NEW
    function walk(current) { // NEW
        if (!current) return; // NEW
        if (styleHas(current, "role_card=1")) out.push(current); // NEW
        (current.children || []).forEach(walk); // NEW
    } // NEW
    walk(cell); // NEW
    return out; // NEW
} // NEW

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

function makeValue(document, attrs) {
    const value = document.createElement("obj");
    Object.entries(attrs || {}).forEach(([key, attrValue]) => value.setAttribute(key, String(attrValue)));
    return value;
}

function addTestChild(harness, parent, attrs = {}) { // NEW
    const child = new TestCell(makeValue(harness.document, attrs), new TestGeometry(10, 10, 40, 20), "shape=rectangle;"); // NEW
    child.vertex = true; // NEW
    harness.model.add(parent, child); // NEW
    return child; // NEW
} // NEW

function installRoadmapCreationStub(harness) { // NEW
    const ensured = []; // NEW
    harness.graph.__trellisRoadmapManager = { // NEW
        ensureMainRoadmapInRoadmapModule(moduleCell) { ensured.push(moduleCell); return true; } // NEW
    }; // NEW
    return ensured; // NEW
} // NEW

function createGardenCluster(harness) { // NEW
    installRoadmapCreationStub(harness); // NEW
    const garden = harness.graph.__trellisModules.createModuleAtPoint({ x: 30, y: 40 }, "garden"); // NEW
    return { // NEW
        garden, // NEW
        team: harness.model.getCell(garden.getAttribute("trellis_team_module_id")), // NEW
        task: harness.model.getCell(garden.getAttribute("trellis_task_module_id")), // NEW
        roadmap: harness.model.getCell(garden.getAttribute("roadmap_module_id")) // NEW
    }; // NEW
} // NEW

function makeCell(harness, attrs, geometry, style = "") {
    const cell = new TestCell(makeValue(harness.document, attrs), geometry, style);
    cell.vertex = true;
    return cell;
}

function makeModuleReady(moduleCell, width = 320, height = 220, margin = 0) {
    moduleCell.geometry.width = width;
    moduleCell.geometry.height = height;
    moduleCell.style += ";module_margin=" + margin;
    return moduleCell;
}

function absoluteBounds(cell) {
    const geo = cell && cell.geometry || {};
    let x = Number(geo.x || 0);
    let y = Number(geo.y || 0);
    let parent = cell && cell.parent;
    while (parent) {
        const parentGeo = parent.geometry || {};
        x += Number(parentGeo.x || 0);
        y += Number(parentGeo.y || 0);
        parent = parent.parent;
    }
    return { x, y, width: Number(geo.width || 0), height: Number(geo.height || 0) };
}

function centerInside(cell, container) {
    const cellBounds = absoluteBounds(cell);
    const containerBounds = absoluteBounds(container);
    const cx = cellBounds.x + cellBounds.width / 2;
    const cy = cellBounds.y + cellBounds.height / 2;
    return cx >= containerBounds.x && cx <= containerBounds.x + containerBounds.width && cy >= containerBounds.y && cy <= containerBounds.y + containerBounds.height;
}

function styleInt(cell, key, fallback = 0) {
    const match = new RegExp("(?:^|;)" + key + "=(\\d+)(?=;|$)").exec(cell && cell.style || "");
    return match ? Number(match[1]) : fallback;
}

function insideRightBottomInnerMargin(cell, moduleCell) {
    const cellBounds = absoluteBounds(cell);
    const moduleBounds = absoluteBounds(moduleCell);
    const margin = styleInt(moduleCell, "module_margin", 0);
    return (
        cellBounds.x >= moduleBounds.x &&
        cellBounds.y >= moduleBounds.y &&
        cellBounds.x + cellBounds.width <= moduleBounds.x + moduleBounds.width - margin &&
        cellBounds.y + cellBounds.height <= moduleBounds.y + moduleBounds.height - margin
    );
}

function insideModuleBounds(cell, moduleCell) {
    const cellBounds = absoluteBounds(cell);
    const moduleBounds = absoluteBounds(moduleCell);
    return (
        cellBounds.x >= moduleBounds.x &&
        cellBounds.y >= moduleBounds.y &&
        cellBounds.x + cellBounds.width <= moduleBounds.x + moduleBounds.width &&
        cellBounds.y + cellBounds.height <= moduleBounds.y + moduleBounds.height
    );
} // CHANGE

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

function resizeCellAndFire(harness, cell, width, height) {
    const previous = cell.geometry.clone(); // CHANGE
    const next = cell.geometry.clone(); // CHANGE
    next.width = width; // CHANGE
    next.height = height; // CHANGE
    harness.model.setGeometry(cell, next); // CHANGE
    harness.graph.fireEvent(makeEventObject("cellsResized", ["cells", [cell], "bounds", [next], "previous", [previous]])); // CHANGE
} // CHANGE

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

test("createModuleAtPoint creates garden neighbor modules including roadmap when available", () => { // NEW
    const harness = makeHarness(); // NEW
    const ensuredRoadmaps = installRoadmapCreationStub(harness); // NEW
    const garden = harness.graph.__trellisModules.createModuleAtPoint({ x: 30, y: 40 }, "garden"); // NEW
    const team = harness.model.getCell(garden.getAttribute("trellis_team_module_id")); // NEW
    const task = harness.model.getCell(garden.getAttribute("trellis_task_module_id")); // NEW
    const roadmap = harness.model.getCell(garden.getAttribute("roadmap_module_id")); // NEW
    assert.equal(team.getAttribute("trellis_garden_module_id"), garden.id); // NEW
    assert.equal(task.getAttribute("trellis_garden_module_id"), garden.id); // NEW
    assert.equal(roadmap.getAttribute("roadmap_garden_module_id"), garden.id); // NEW
    assert.equal(roadmap.getAttribute("roadmap_task_module_id"), task.id); // NEW
    assert.equal(roadmap.getAttribute("roadmap_team_module_id"), team.id); // NEW
    assert.equal(ensuredRoadmaps.at(-1), roadmap); // NEW
}); // NEW

test("garden creation falls back to partial cluster when roadmap manager is unavailable", () => { // NEW
    const harness = makeHarness(); // NEW
    const garden = harness.graph.__trellisModules.createModuleAtPoint({ x: 30, y: 40 }, "garden"); // NEW
    assert.ok(harness.model.getCell(garden.getAttribute("trellis_team_module_id"))); // NEW
    assert.ok(harness.model.getCell(garden.getAttribute("trellis_task_module_id"))); // NEW
    assert.equal(garden.getAttribute("roadmap_module_id"), null); // NEW
    assert.deepEqual(harness.alerts, ["Roadmap Manager is unavailable. The Garden remains usable; create its Roadmap companion after the plugin is loaded."]); // NEW
}); // NEW

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

test("delete on expanded module folds without deleting", () => { // NEW
    const harness = makeHarness(); // NEW
    const mod = harness.graph.__trellisModules.createModuleAtPoint({ x: 11, y: 22 }, "regular"); // NEW
    harness.graph.removeCells([mod]); // NEW
    assert.equal(mod.collapsed, true); // NEW
    assert.equal(harness.model.getParent(mod), harness.root); // NEW
    assert.equal(harness.removeCalls.length, 0); // NEW
    assert.equal(harness.foldCalls.length, 1); // CHANGE
    assert.equal(harness.foldCalls[0].cells[0], mod); // CHANGE
}); // NEW

test("workspace handle drag suppresses module delete lifecycle", () => { // NEW
    const harness = makeHarness(); // NEW
    const mod = harness.graph.__trellisModules.createModuleAtPoint({ x: 11, y: 22 }, "regular"); // NEW
    harness.graph.__trellisWorkspaceHandleDragActive = true; // NEW
    assert.deepEqual(harness.graph.removeCells([mod]), []); // NEW
    assert.equal(!!mod.collapsed, false); // CHANGE
    assert.equal(harness.model.getParent(mod), harness.root); // NEW
    assert.equal(harness.removeCalls.length, 0); // NEW
    assert.equal(harness.foldCalls.length, 0); // NEW
    assert.deepEqual(harness.confirmations, []); // NEW
}); // NEW

test("delete on folded standalone module confirms and removes descendants", () => { // NEW
    const harness = makeHarness(); // NEW
    const mod = harness.graph.__trellisModules.createModuleAtPoint({ x: 11, y: 22 }, "regular"); // NEW
    const child = addTestChild(harness, mod, { label: "Child" }); // NEW
    mod.collapsed = true; // NEW
    harness.graph.removeCells([mod]); // NEW
    assert.deepEqual(harness.confirmations, ["Delete this module and its contents? This and any other action can be undone with Ctrl+Z."]); // NEW
    assert.equal(harness.model.getCell(mod.id), null); // NEW
    assert.equal(harness.model.getCell(child.id), null); // NEW
}); // NEW

test("delete on expanded garden folds cluster root without deleting neighbors", () => { // NEW
    const harness = makeHarness(); // NEW
    const cluster = createGardenCluster(harness); // NEW
    harness.alerts.length = 0; // NEW
    harness.graph.removeCells([cluster.garden]); // NEW
    assert.equal(cluster.garden.collapsed, true); // NEW
    assert.equal(harness.model.getParent(cluster.team), harness.root); // NEW
    assert.equal(harness.model.getParent(cluster.task), harness.root); // NEW
    assert.equal(harness.model.getParent(cluster.roadmap), harness.root); // NEW
    assert.equal(harness.removeCalls.length, 0); // NEW
}); // NEW

test("delete on folded garden confirms and removes typed cluster with descendants", () => { // NEW
    const harness = makeHarness(); // NEW
    const cluster = createGardenCluster(harness); // NEW
    const child = addTestChild(harness, cluster.task, { label: "Task child" }); // NEW
    harness.alerts.length = 0; // NEW
    cluster.garden.collapsed = true; // NEW
    harness.graph.removeCells([cluster.garden]); // NEW
    assert.deepEqual(harness.confirmations, ["Delete this Garden and its neighboring Team, Task, and Roadmap modules? This and any other action can be undone with Ctrl+Z."]); // NEW
    [cluster.garden, cluster.team, cluster.task, cluster.roadmap, child].forEach(cell => assert.equal(harness.model.getCell(cell.id), null)); // NEW
}); // NEW

test("delete on folded garden companion is blocked", () => { // NEW
    const harness = makeHarness(); // NEW
    const cluster = createGardenCluster(harness); // NEW
    harness.alerts.length = 0; // NEW
    cluster.team.collapsed = true; // NEW
    harness.graph.removeCells([cluster.team]); // NEW
    assert.deepEqual(harness.alerts, ["Only the Garden module can delete this cluster. Select the folded Garden module and press Delete to remove the Garden and its neighboring modules."]); // NEW
    assert.equal(harness.model.getParent(cluster.team), harness.root); // NEW
    assert.equal(harness.removeCalls.length, 0); // NEW
}); // NEW

test("mixed delete removes ordinary cells while folding expanded modules", () => { // NEW
    const harness = makeHarness(); // NEW
    const mod = harness.graph.__trellisModules.createModuleAtPoint({ x: 11, y: 22 }, "regular"); // NEW
    const ordinary = addTestChild(harness, harness.root, { label: "Ordinary" }); // NEW
    harness.graph.removeCells([mod, ordinary]); // NEW
    assert.equal(mod.collapsed, true); // NEW
    assert.equal(harness.model.getParent(mod), harness.root); // NEW
    assert.equal(harness.model.getCell(ordinary.id), null); // NEW
}); // NEW

test("garden cluster deletion requires delete permission for every descendant", () => { // NEW
    const harness = makeHarness(); // NEW
    const cluster = createGardenCluster(harness); // NEW
    const deniedChild = addTestChild(harness, cluster.task, { label: "Denied" }); // NEW
    cluster.garden.collapsed = true; // NEW
    harness.alerts.length = 0; // NEW
    harness.graph.__trellisUsers = { canDeleteCell(cell) { return cell !== deniedChild; } }; // NEW
    harness.graph.removeCells([cluster.garden]); // NEW
    assert.deepEqual(harness.alerts, ["You do not have permission to delete the selected module contents."]); // NEW
    [cluster.garden, cluster.team, cluster.task, cluster.roadmap, deniedChild].forEach(cell => assert.ok(harness.model.getCell(cell.id))); // NEW
    assert.equal(harness.removeCalls.length, 0); // NEW
}); // NEW

test("folded module deletion cancels when confirmation is unavailable", () => { // NEW
    const harness = makeHarness(); // NEW
    const mod = harness.graph.__trellisModules.createModuleAtPoint({ x: 11, y: 22 }, "regular"); // NEW
    mod.collapsed = true; // NEW
    harness.disableConfirm(); // NEW
    harness.graph.removeCells([mod]); // NEW
    assert.deepEqual(harness.alerts, ["Delete confirmation is unavailable. Nothing was deleted."]); // NEW
    assert.ok(harness.model.getCell(mod.id)); // NEW
    assert.equal(harness.removeCalls.length, 0); // NEW
}); // NEW

test("folded leaf module deletion tolerates null child lists", () => { // NEW
    const harness = makeHarness(); // NEW
    const mod = harness.graph.__trellisModules.createModuleAtPoint({ x: 11, y: 22 }, "regular"); // NEW
    mod.collapsed = true; // NEW
    harness.setNullLeafChildren(true); // NEW
    harness.graph.removeCells([mod]); // NEW
    assert.deepEqual(harness.confirmations, ["Delete this module and its contents? This and any other action can be undone with Ctrl+Z."]); // NEW
    assert.equal(harness.model.getCell(mod.id), null); // NEW
}); // NEW

test("folded module deletion does not re-prompt when Roadmap Manager wraps after Modules", () => { // NEW
    const harness = makeHarness(); // NEW
    const mod = harness.graph.__trellisModules.createModuleAtPoint({ x: 11, y: 22 }, "regular"); // NEW
    const modulesRemoveCells = harness.graph.removeCells; // NEW
    let roadmapDeleteCalls = 0; // NEW
    mod.collapsed = true; // NEW
    harness.graph.__trellisRoadmapManager = { // NEW
        deleteRoadmapCells(cells) { // NEW
            roadmapDeleteCalls += 1; // NEW
            return modulesRemoveCells.call(harness.graph, cells, true); // NEW
        } // NEW
    }; // NEW
    harness.graph.removeCells = function (cells) { return harness.graph.__trellisRoadmapManager.deleteRoadmapCells(cells); }; // NEW
    harness.graph.removeCells([mod]); // NEW
    assert.deepEqual(harness.confirmations, ["Delete this module and its contents? This and any other action can be undone with Ctrl+Z."]); // NEW
    assert.equal(roadmapDeleteCalls, 1); // NEW
    assert.equal(harness.model.getCell(mod.id), null); // NEW
}); // NEW

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

test("protected trellis objects clamp by module type", () => {
    const cases = [
        { name: "garden bed", attrs: { garden_bed: "1" }, type: "garden", expected: { dx: 40, dy: 50 }, inside: insideModuleBounds },
        { name: "planting group", attrs: { tiler_group: "1" }, type: "garden", expected: { dx: 40, dy: 50 }, inside: insideModuleBounds },
        { name: "bed assembly", attrs: { irrigation_assembly: "1", irrigation_assembly_type: "bed" }, type: "garden", expected: { dx: 40, dy: 50 }, inside: insideModuleBounds },
        { name: "source assembly", attrs: { irrigation_assembly: "1", irrigation_assembly_type: "source" }, type: "garden", expected: { dx: 40, dy: 50 }, inside: insideModuleBounds },
        { name: "task board", attrs: { board_key: "KANBAN_BOARD", board_role: "main" }, type: "task", expected: { dx: 20, dy: 30 }, inside: insideRightBottomInnerMargin }
    ];
    cases.forEach(({ attrs, type, expected, inside }) => {
        const harness = makeHarness();
        const mod = makeModuleReady(harness.graph.__trellisModules.createModuleAtPoint({ x: 0, y: 0 }, type), 320, 220, 20);
        const beforeSize = { width: mod.geometry.width, height: mod.geometry.height }; // CHANGE
        const cell = makeCell(harness, attrs, new TestGeometry(240, 140, 40, 30), attrs.board_key ? "swimlane;" : "");
        harness.model.add(mod, cell);
        harness.graph.moveCells([cell], 120, 120);
        assert.deepEqual(harness.graph.lastMoveDelta, expected); // CHANGE
        assert.equal(inside(cell, mod), true); // CHANGE
        if (type === "garden") assert.deepEqual({ width: mod.geometry.width, height: mod.geometry.height }, beforeSize); // CHANGE
        assert.equal(harness.model.getParent(cell), mod);
    });
});

test("regular module children can drag past right and bottom to grow the module", () => {
    const harness = makeHarness();
    const mod = makeModuleReady(harness.graph.__trellisModules.createModuleAtPoint({ x: 0, y: 0 }, "regular"), 320, 220, 20);
    const child = makeCell(harness, { label: "ordinary" }, new TestGeometry(240, 140, 40, 30));
    harness.model.add(mod, child);
    harness.graph.moveCells([child], 120, 120);
    assert.deepEqual(harness.graph.lastMoveDelta, { dx: 120, dy: 120 }); // CHANGE
    assert.equal(harness.model.getParent(child), mod); // CHANGE
    assert.equal(child.geometry.x, 360); // CHANGE
    assert.equal(child.geometry.y, 260); // CHANGE
    assert.equal(mod.geometry.width, 420); // CHANGE
    assert.equal(mod.geometry.height, 310); // CHANGE
});

test("regular module children clamp at left and top edges", () => {
    const harness = makeHarness();
    const mod = makeModuleReady(harness.graph.__trellisModules.createModuleAtPoint({ x: 0, y: 0 }, "regular"), 320, 220, 20);
    const child = makeCell(harness, { label: "ordinary" }, new TestGeometry(20, 20, 40, 30));
    harness.model.add(mod, child);
    harness.graph.moveCells([child], -80, -90);
    assert.deepEqual(harness.graph.lastMoveDelta, { dx: -20, dy: -20 }); // CHANGE
    assert.equal(child.geometry.x, 0); // CHANGE
    assert.equal(child.geometry.y, 0); // CHANGE
    assert.equal(harness.model.getParent(child), mod); // CHANGE
});

test("team and task module ordinary children do not use regular outside growth", () => {
    ["team", "task"].forEach(type => {
        const harness = makeHarness();
        const mod = makeModuleReady(harness.graph.__trellisModules.createModuleAtPoint({ x: 0, y: 0 }, type), 320, 220, 20);
        const child = makeCell(harness, { label: "ordinary" }, new TestGeometry(240, 140, 40, 30), type === "task" ? "swimlane;" : "");
        harness.model.add(mod, child);
        harness.graph.moveCells([child], 120, 120);
        assert.deepEqual(harness.graph.lastMoveDelta, { dx: 20, dy: 30 }); // CHANGE
        assert.equal(insideRightBottomInnerMargin(child, mod), true); // CHANGE
        assert.equal(mod.geometry.width, type === "team" ? 360 : 320); // CHANGE
        assert.equal(mod.geometry.height, 220); // CHANGE
        assert.equal(harness.model.getParent(child), mod); // CHANGE
    });
});

test("role cards clamp to team modules and role internals clamp to their role parent", () => {
    const harness = makeHarness();
    const { team, role, nameRow } = createRoleFixture(harness);
    makeModuleReady(team, 520, 360, 20);
    role.geometry.x = 200;
    role.geometry.y = 40;
    harness.graph.moveCells([role], 200, 0);
    assert.equal(harness.graph.lastMoveDelta.dx, 40);
    assert.equal(insideRightBottomInnerMargin(role, team), true);
    nameRow.geometry.x = 168;
    harness.graph.moveCells([nameRow], 80, 0);
    assert.equal(harness.graph.lastMoveDelta.dx, 5);
    assert.equal(centerInside(nameRow, role), true);
    assert.equal(harness.model.getParent(nameRow), role);
});

test("mixed protected selections share one clamped delta", () => {
    const harness = makeHarness();
    const mod = makeModuleReady(harness.graph.__trellisModules.createModuleAtPoint({ x: 0, y: 0 }, "garden"), 320, 220, 20);
    const bed = makeCell(harness, { garden_bed: "1" }, new TestGeometry(240, 80, 40, 30));
    const note = makeCell(harness, { label: "loose note" }, new TestGeometry(20, 20, 40, 30));
    harness.model.add(mod, bed);
    harness.model.add(mod, note);
    harness.graph.moveCells([bed, note], 120, 0);
    assert.equal(harness.graph.lastMoveDelta.dx, 40); // CHANGE
    assert.equal(bed.geometry.x, 280); // CHANGE
    assert.equal(note.geometry.x, 60); // CHANGE
    assert.equal(mod.geometry.width, 320); // CHANGE
});

test("protected cells reject drops outside their current module", () => {
    const harness = makeHarness();
    const garden = makeModuleReady(harness.graph.__trellisModules.createModuleAtPoint({ x: 0, y: 0 }, "garden"));
    const other = makeModuleReady(harness.graph.__trellisModules.createModuleAtPoint({ x: 500, y: 0 }, "garden"));
    const bed = makeCell(harness, { garden_bed: "1" }, new TestGeometry(20, 20, 80, 40));
    const assembly = makeCell(harness, { irrigation_assembly: "1", irrigation_assembly_type: "parts" }, new TestGeometry(120, 20, 80, 40));
    const ordinary = makeCell(harness, { label: "ordinary" }, new TestGeometry(220, 20, 80, 40)); // CHANGE
    harness.model.add(garden, bed);
    harness.model.add(garden, assembly);
    harness.model.add(garden, ordinary); // CHANGE
    assert.equal(harness.graph.isValidDropTarget(garden, [bed]), true);
    assert.equal(harness.graph.isValidDropTarget(other, [bed]), false);
    assert.equal(harness.graph.isValidDropTarget(harness.root, [assembly]), false);
    assert.equal(harness.graph.isValidDropTarget(harness.root, [ordinary]), false); // CHANGE
    assert.deepEqual(harness.graph.moveCells([ordinary], 10, 0, false, harness.root), [ordinary]); // CHANGE
    assert.equal(harness.model.getParent(ordinary), garden); // CHANGE
});

test("CELLS_MOVED clamps leaked protected cells instead of reparenting to root", () => {
    const harness = makeHarness();
    const garden = makeModuleReady(harness.graph.__trellisModules.createModuleAtPoint({ x: 0, y: 0 }, "garden"), 320, 220, 20);
    const bed = makeCell(harness, { garden_bed: "1" }, new TestGeometry(420, 20, 80, 40));
    harness.model.add(garden, bed);
    harness.graph.fireEvent(makeEventObject("cellsMoved", ["cells", [bed], "dx", 200, "dy", 0]));
    assert.equal(harness.model.getParent(bed), garden);
    assert.equal(bed.geometry.x, 240); // CHANGE
    assert.equal(insideModuleBounds(bed, garden), true); // CHANGE
    assert.equal(garden.geometry.width, 320); // CHANGE
    assert.equal(garden.geometry.height, 220); // CHANGE
});

test("garden child moves do not auto-shrink the garden module", () => {
    const harness = makeHarness();
    const garden = makeModuleReady(harness.graph.__trellisModules.createModuleAtPoint({ x: 0, y: 0 }, "garden"), 500, 400, 60);
    const bed = makeCell(harness, { garden_bed: "1" }, new TestGeometry(320, 260, 80, 40));
    harness.model.add(garden, bed);
    harness.graph.moveCells([bed], -120, -100);
    assert.equal(garden.geometry.width, 500); // CHANGE
    assert.equal(garden.geometry.height, 400); // CHANGE
    assert.equal(harness.model.getParent(bed), garden); // CHANGE
});

test("kanban cards can move to another board lane while lanes remain fixed", () => {
    const harness = makeHarness();
    const taskModule = makeModuleReady(harness.graph.__trellisModules.createModuleAtPoint({ x: 0, y: 0 }, "task"), 900, 500);
    const boardA = makeCell(harness, { board_key: "KANBAN_BOARD", board_role: "main" }, new TestGeometry(10, 10, 360, 240), "swimlane;");
    const boardB = makeCell(harness, { board_key: "KANBAN_BOARD", board_role: "secondary" }, new TestGeometry(430, 10, 360, 240), "swimlane;");
    const laneA = makeCell(harness, { lane_key: "TODO" }, new TestGeometry(20, 40, 140, 160), "swimlane;");
    const laneB = makeCell(harness, { lane_key: "DOING" }, new TestGeometry(20, 40, 140, 160), "swimlane;");
    const card = makeCell(harness, { kanban_card: "1" }, new TestGeometry(20, 50, 100, 40));
    harness.model.add(taskModule, boardA);
    harness.model.add(taskModule, boardB);
    harness.model.add(boardA, laneA);
    harness.model.add(boardB, laneB);
    harness.model.add(laneA, card);
    assert.equal(harness.graph.isValidDropTarget(laneB, [card]), true);
    assert.equal(harness.graph.isValidDropTarget(boardB, [card]), false);
    harness.graph.moveCells([card], 10, 0, false, laneB);
    assert.equal(harness.model.getParent(card), laneB);
    const laneX = laneB.geometry.x;
    assert.deepEqual(harness.graph.moveCells([laneB], 100, 0), [laneB]);
    assert.equal(laneB.geometry.x, laneX);
    assert.equal(harness.graph.isValidDropTarget(boardA, [laneB]), false);
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

test("garden module margin API ignores legacy internal margin values", () => {
    const harness = makeHarness();
    const garden = harness.graph.__trellisModules.createModuleAtPoint({ x: 11, y: 22 }, "garden");
    garden.style += ";module_margin=90"; // CHANGE
    assert.equal(harness.graph.__trellisModules.getModuleMargin(garden), 0); // CHANGE
    harness.graph.__trellisModules.setModuleMargin(garden, 35); // CHANGE
    assert.equal(harness.graph.__trellisModules.getModuleMargin(garden), 0); // CHANGE
    assert.doesNotMatch(garden.style, /(?:^|;)module_margin=35(?:;|$)/); // CHANGE
});

test("garden module resize cannot shrink below child contents", () => {
    const harness = makeHarness();
    const garden = makeModuleReady(harness.graph.__trellisModules.createModuleAtPoint({ x: 0, y: 0 }, "garden"), 360, 260, 0); // CHANGE
    const bed = makeCell(harness, { garden_bed: "1" }, new TestGeometry(240, 150, 100, 90)); // CHANGE
    harness.model.add(garden, bed); // CHANGE
    resizeCellAndFire(harness, garden, 200, 180); // CHANGE
    assert.equal(garden.geometry.width, 340); // CHANGE
    assert.equal(garden.geometry.height, 240); // CHANGE
});

test("garden module resize restores only undersized dimensions", () => {
    const harness = makeHarness();
    const garden = makeModuleReady(harness.graph.__trellisModules.createModuleAtPoint({ x: 0, y: 0 }, "garden"), 360, 320, 0); // CHANGE
    const bed = makeCell(harness, { garden_bed: "1" }, new TestGeometry(180, 100, 80, 80)); // CHANGE
    harness.model.add(garden, bed); // CHANGE
    resizeCellAndFire(harness, garden, 220, 300); // CHANGE
    assert.equal(garden.geometry.width, 260); // CHANGE
    assert.equal(garden.geometry.height, 300); // CHANGE
});

test("garden module resize minimum ignores legacy internal margin", () => {
    const harness = makeHarness();
    const garden = makeModuleReady(harness.graph.__trellisModules.createModuleAtPoint({ x: 0, y: 0 }, "garden"), 360, 260, 90); // CHANGE
    const bed = makeCell(harness, { garden_bed: "1" }, new TestGeometry(180, 100, 80, 80)); // CHANGE
    harness.model.add(garden, bed); // CHANGE
    resizeCellAndFire(harness, garden, 120, 120); // CHANGE
    assert.equal(garden.geometry.width, 260); // CHANGE
    assert.equal(garden.geometry.height, 180); // CHANGE
});

test("empty garden module resize honors base minimum", () => {
    const harness = makeHarness();
    const garden = harness.graph.__trellisModules.createModuleAtPoint({ x: 0, y: 0 }, "garden"); // CHANGE
    resizeCellAndFire(harness, garden, 20, 20); // CHANGE
    assert.equal(garden.geometry.width, 60); // CHANGE
    assert.equal(garden.geometry.height, 40); // CHANGE
});

test("garden resize minimum does not normalize negative child positions", () => {
    const harness = makeHarness();
    const garden = makeModuleReady(harness.graph.__trellisModules.createModuleAtPoint({ x: 0, y: 0 }, "garden"), 180, 120, 0); // CHANGE
    const bed = makeCell(harness, { garden_bed: "1" }, new TestGeometry(-50, -40, 80, 70)); // CHANGE
    harness.model.add(garden, bed); // CHANGE
    resizeCellAndFire(harness, garden, 20, 20); // CHANGE
    assert.equal(garden.geometry.width, 60); // CHANGE
    assert.equal(garden.geometry.height, 40); // CHANGE
    assert.equal(bed.geometry.x, -50); // CHANGE
    assert.equal(bed.geometry.y, -40); // CHANGE
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

test("shrunk modules pull nearby right-side neighbors to the exact external margin", () => {
    const harness = makeHarness();
    const left = harness.graph.__trellisModules.createModuleAtPoint({ x: 0, y: 0 }, "regular");
    const right = harness.graph.__trellisModules.createModuleAtPoint({ x: 280, y: 0 }, "regular");
    const previous = left.geometry.clone();
    previous.width = 240;
    const next = previous.clone();
    next.width = 160;
    harness.model.setGeometry(left, next);
    harness.graph.fireEvent(makeEventObject("cellsResized", ["cells", [left], "bounds", [next], "previous", [previous]]));
    assert.equal(right.geometry.x, 200); // NEW
});

test("programmatic module margin growth preserves external margins", () => {
    const harness = makeHarness();
    const left = harness.graph.__trellisModules.createModuleAtPoint({ x: 0, y: 0 }, "regular");
    const right = harness.graph.__trellisModules.createModuleAtPoint({ x: 260, y: 0 }, "regular");
    left.style += ";module_margin=40";
    const child = new TestCell("wide-child", new TestGeometry(20, 10, 180, 20), "");
    child.vertex = true;
    harness.model.add(left, child);
    harness.graph.__trellisModules.applyModuleMargins(left);
    assert.equal(left.geometry.width, 240);
    assert.equal(right.geometry.x, 280); // NEW
});

test("programmatic module margin shrink pulls nearby neighbors to the exact external margin", () => {
    const harness = makeHarness();
    const left = harness.graph.__trellisModules.createModuleAtPoint({ x: 0, y: 0 }, "regular");
    const right = harness.graph.__trellisModules.createModuleAtPoint({ x: 280, y: 0 }, "regular");
    left.style += ";module_margin=40";
    const child = new TestCell("resized-child", new TestGeometry(20, 10, 180, 20), "");
    child.vertex = true;
    harness.model.add(left, child);
    harness.graph.__trellisModules.applyModuleMargins(left);
    child.geometry.width = 100;
    harness.graph.__trellisModules.applyModuleMargins(left, { allowShrink: true });
    assert.equal(left.geometry.width, 160);
    assert.equal(right.geometry.x, 200); // NEW
});

test("shrunk modules leave neighbors beyond three external margins in place", () => {
    const harness = makeHarness();
    const left = harness.graph.__trellisModules.createModuleAtPoint({ x: 0, y: 0 }, "regular");
    const farRight = harness.graph.__trellisModules.createModuleAtPoint({ x: 401, y: 0 }, "regular");
    const previous = left.geometry.clone();
    previous.width = 240;
    const next = previous.clone();
    next.width = 160;
    harness.model.setGeometry(left, next);
    harness.graph.fireEvent(makeEventObject("cellsResized", ["cells", [left], "bounds", [next], "previous", [previous]]));
    assert.equal(farRight.geometry.x, 401); // NEW
});

test("programmatic module margin no-op leaves neighbors in place", () => {
    const harness = makeHarness();
    const left = harness.graph.__trellisModules.createModuleAtPoint({ x: 0, y: 0 }, "regular");
    const right = harness.graph.__trellisModules.createModuleAtPoint({ x: 260, y: 0 }, "regular");
    left.style += ";module_margin=40";
    const child = new TestCell("small-child", new TestGeometry(20, 10, 80, 20), "");
    child.vertex = true;
    harness.model.add(left, child);
    harness.graph.__trellisModules.applyModuleMargins(left);
    assert.equal(left.geometry.width, 160);
    assert.equal(right.geometry.x, 260); // NEW
});

test("empty canvas click renders root module overlay buttons", () => {
    const harness = makeHarness();
    fireGraphClick(harness, { clientX: 120, clientY: 150, graphX: 200, graphY: 230 });
    const buttons = overlayButtons(harness.document);
    assert.deepEqual(buttons.map(button => button.textContent), ["Add Module", "Add Garden Module", "Add Team Module", "Add Task Module", "Add Roadmap Module"]); // CHANGE
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

test("module context menu omits module type conversion actions", () => { // NEW
    const harness = makeHarness(); // NEW
    const regular = harness.graph.__trellisModules.createModuleAtPoint({ x: 10, y: 20 }, "regular"); // NEW
    const garden = harness.graph.__trellisModules.createModuleAtPoint({ x: 30, y: 40 }, "garden"); // NEW
    const event = makeMouseEvent(harness.dom.window, "mouseup", { clientX: 110, clientY: 130, graphX: 95, graphY: 105 }); // NEW
    const regularLabels = menuItemsFor(harness, regular, event).map(item => item.label); // NEW
    const gardenLabels = menuItemsFor(harness, garden, event).map(item => item.label); // NEW
    assert.equal(regularLabels.some(label => /^Set as /.test(label)), false); // NEW
    assert.equal(gardenLabels.some(label => /^Set as /.test(label)), false); // NEW
    assert.ok(regularLabels.includes("Add Submodule")); // NEW
    assert.ok(gardenLabels.includes("Set Internal Margin (diagram units)...")); // NEW
}); // NEW

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

test("selecting one team module renders the team management overlay", () => {
    const harness = makeHarness();
    const team = harness.graph.__trellisModules.createModuleAtPoint({ x: 50, y: 60 }, "team");
    assert.deepEqual(visibleRoleOverlayButtonTexts(harness.document), ["Add Team", "Set Permissions", "Set Module Margins"]); // CHANGE
    assert.equal(roleOverlayInput(harness.document, "Name").value, "Team Module"); // CHANGE
    assert.equal(roleOverlay(harness.document).querySelectorAll(".trellis-team-module-label-controls input").length, 1);
    assert.equal(roleOverlay(harness.document).querySelector(".trellis-team-module-label-controls").textContent.includes("Garden label"), false);
    assert.equal(roleOverlay(harness.document).querySelector(".trellis-team-module-label-controls").textContent.includes("Team label"), false);
    assert.equal(roleOverlay(harness.document).style.display, "flex");
    assert.equal(roleOverlay(harness.document).style.left, "58px");
    assert.equal(roleOverlay(harness.document).style.top, "68px");
    assert.equal(harness.selectedCell, team);
});

test("selecting team sections and role cards renders permissions in their overlays", () => {
    const harness = makeHarness();
    const api = harness.graph.__trellisModules;
    const team = api.createModuleAtPoint({ x: 50, y: 60 }, "team");
    const section = api.createTeamSection(team, "Propagation");
    const role = api.addRoleCardToTeamModule(team, 140, 160);

    harness.graph.setSelectionCell(section);
    let buttons = visibleRoleOverlayButtonTexts(harness.document); // CHANGE
    assert.deepEqual(buttons, ["Add New Role", "Set Permissions"]); // CHANGE
    assert.equal(roleOverlayInput(harness.document, "Name").value, "Propagation"); // CHANGE: team overlay uses the same editable name field as the team module overlay.
    assert.equal(roleOverlay(harness.document).querySelector(".trellis-team-module-label-controls").textContent.includes("Team:"), false); // CHANGE

    harness.graph.setSelectionCell(role);
    buttons = visibleRoleOverlayButtonTexts(harness.document); // CHANGE
    assert.deepEqual(buttons, ["Set Permissions"]); // CHANGE
    assert.match(roleOverlay(harness.document).querySelector(".trellis-team-module-label-controls").textContent, /Role:/);
});

test("team sections lazily migrate direct role cards into Unassigned", () => {
    const harness = makeHarness();
    const api = harness.graph.__trellisModules;
    const team = api.createModuleAtPoint({ x: 50, y: 60 }, "team");
    const role = api.createRoleCard(team, 110, 140);
    assert.equal(harness.model.getParent(role), team);

    api.ensureTeamModuleSections(team);
    const sections = api.teamSectionsInModule(team);
    const unassigned = sections.find(section => section.getAttribute("trellis_team_unassigned") === "1");
    assert.ok(unassigned);
    assert.equal(api.isTeamSection(unassigned), true);
    assert.equal(harness.model.getParent(role), unassigned);
    assert.equal(roleCardsUnder(unassigned).includes(role), true);
});

test("team-aware role insertion uses selected named team section", () => {
    const harness = makeHarness();
    const api = harness.graph.__trellisModules;
    const team = api.createModuleAtPoint({ x: 50, y: 60 }, "team");
    const section = api.createTeamSection(team, "Propagation");
    harness.graph.setSelectionCell(section);

    const role = api.addRoleCardToTeamModule(team, 140, 160);
    assert.ok(role);
    assert.equal(harness.model.getParent(role), section);
    assert.equal(api.isTeamSection(section), true);
    assert.equal(section.getAttribute("trellis_team_id").length > 0, true);
    assert.equal(role.geometry.x, 20);
    assert.equal(role.geometry.y, 54);
});

test("role cards can use active team sections as live drop targets", () => {
    const harness = makeHarness();
    const api = harness.graph.__trellisModules;
    const team = makeModuleReady(api.createModuleAtPoint({ x: 50, y: 60 }, "team"), 1000, 520, 0);
    const source = api.createTeamSection(team, "Propagation", { point: { x: 20, y: 20 } });
    const target = api.createTeamSection(team, "Harvest", { point: { x: 420, y: 20 } });
    const archived = api.createTeamSection(team, "Archived", { point: { x: 760, y: 20 } });
    const otherTeam = makeModuleReady(api.createModuleAtPoint({ x: 1300, y: 60 }, "team"), 700, 420, 0);
    const otherSection = api.createTeamSection(otherTeam, "External", { point: { x: 20, y: 20 } });
    archived.value.setAttribute("trellis_team_archived", "1"); // NEW
    harness.graph.setSelectionCell(source);
    const role = api.addRoleCardToTeamModule(team, 140, 160);

    assert.equal(harness.graph.isValidDropTarget(target, [role]), true); // NEW
    assert.equal(harness.graph.isValidDropTarget(archived, [role]), false); // NEW
    assert.equal(harness.graph.isValidDropTarget(otherSection, [role]), false); // NEW

    harness.graph.moveCells([role], 420, 0, false, target);

    assert.equal(harness.model.getParent(role), target); // NEW
});

test("dragged role cards reparent to the team section containing their center", () => {
    const harness = makeHarness();
    const api = harness.graph.__trellisModules;
    const team = makeModuleReady(api.createModuleAtPoint({ x: 50, y: 60 }, "team"), 1000, 520, 0);
    const source = api.createTeamSection(team, "Propagation", { point: { x: 20, y: 20 } });
    const target = api.createTeamSection(team, "Harvest", { point: { x: 420, y: 20 } });
    target.geometry.height = 200; // NEW
    harness.graph.setSelectionCell(source);
    const role = api.addRoleCardToTeamModule(team, 140, 160);
    const before = absoluteBounds(role);

    harness.graph.moveCells([role], 420, 0);

    const after = absoluteBounds(role);
    assert.equal(harness.model.getParent(role), target); // NEW
    assert.equal(after.x, before.x + 420); // NEW
    assert.equal(after.y, before.y); // NEW
    assert.equal(role.geometry.x, after.x - absoluteBounds(target).x); // NEW
    assert.equal(role.geometry.y, after.y - absoluteBounds(target).y); // NEW
    assert.equal(target.geometry.height, 324); // NEW
});

test("dragged role cards stay in their team when their center lands in a gap", () => {
    const harness = makeHarness();
    const api = harness.graph.__trellisModules;
    const team = makeModuleReady(api.createModuleAtPoint({ x: 50, y: 60 }, "team"), 1000, 520, 0);
    const source = api.createTeamSection(team, "Propagation", { point: { x: 20, y: 20 } });
    const target = api.createTeamSection(team, "Harvest", { point: { x: 420, y: 20 } });
    target.geometry.height = 200; // NEW
    harness.graph.setSelectionCell(source);
    const role = api.addRoleCardToTeamModule(team, 140, 160);

    harness.graph.moveCells([role], 240, 0);

    assert.equal(harness.model.getParent(role), source); // NEW
    assert.equal(role.geometry.x, 40); // NEW
    assert.equal(role.geometry.y, 54); // NEW
});

test("dragged unassigned role cards reparent into named team sections", () => {
    const harness = makeHarness();
    const api = harness.graph.__trellisModules;
    const team = makeModuleReady(api.createModuleAtPoint({ x: 50, y: 60 }, "team"), 1000, 1000, 0);
    const unassigned = api.ensureTeamModuleSections(team);
    const target = api.createTeamSection(team, "Harvest", { point: { x: 420, y: 400 } });
    target.geometry.height = 200; // NEW
    harness.graph.setSelectionCell(unassigned);
    const role = api.addRoleCardToTeamModule(team, 140, 160);
    const roleBefore = absoluteBounds(role); // NEW
    const targetBefore = absoluteBounds(target); // NEW
    const dx = targetBefore.x + targetBefore.width / 2 - (roleBefore.x + roleBefore.width / 2); // NEW
    const dy = targetBefore.y + targetBefore.height / 2 - (roleBefore.y + roleBefore.height / 2); // NEW

    harness.graph.moveCells([role], dx, dy); // CHANGE

    assert.equal(harness.model.getParent(role), target); // NEW
    assert.notEqual(harness.model.getParent(role), unassigned); // NEW
});

test("dragged role cards do not reparent into archived team sections", () => {
    const harness = makeHarness();
    const api = harness.graph.__trellisModules;
    const team = makeModuleReady(api.createModuleAtPoint({ x: 50, y: 60 }, "team"), 1000, 700, 0);
    const source = api.createTeamSection(team, "Propagation", { point: { x: 20, y: 20 } });
    const archived = api.createTeamSection(team, "Archived", { point: { x: 420, y: 20 } });
    archived.geometry.height = 200; // NEW
    archived.value.setAttribute("trellis_team_archived", "1"); // NEW
    harness.graph.setSelectionCell(source);
    const role = api.addRoleCardToTeamModule(team, 140, 160);

    harness.graph.moveCells([role], 420, 0);

    assert.equal(harness.model.getParent(role), source); // NEW
    assert.notEqual(harness.model.getParent(role), archived); // NEW
    assert.equal(role.geometry.x, 40); // NEW
    assert.equal(role.geometry.y, 54); // NEW
});

test("manual team section enlargement persists after resize events", () => {
    const harness = makeHarness();
    const api = harness.graph.__trellisModules;
    const team = api.createModuleAtPoint({ x: 50, y: 60 }, "team");
    const section = api.createTeamSection(team, "Propagation");

    resizeCellAndFire(harness, section, 520, 280);

    assert.equal(section.geometry.width, 520); // NEW
    assert.equal(section.geometry.height, 280); // NEW
});

test("team section resize restores only dimensions undersized for role contents", () => {
    const harness = makeHarness();
    const api = harness.graph.__trellisModules;
    const team = api.createModuleAtPoint({ x: 50, y: 60 }, "team");
    const section = api.createTeamSection(team, "Propagation");
    harness.graph.setSelectionCell(section);
    api.addRoleCardToTeamModule(team, 140, 160);

    resizeCellAndFire(harness, section, 500, 200);

    assert.equal(section.geometry.width, 500); // NEW
    assert.equal(section.geometry.height, 324); // NEW
});

test("resized team sections push neighboring sections away", () => {
    const harness = makeHarness();
    const api = harness.graph.__trellisModules;
    const team = api.createModuleAtPoint({ x: 50, y: 60 }, "team");
    const left = api.createTeamSection(team, "Propagation", { point: { x: 20, y: 20 } });
    const right = api.createTeamSection(team, "Harvest", { point: { x: 380, y: 20 } });

    resizeCellAndFire(harness, left, 350, 140);

    assert.equal(left.geometry.width, 350); // NEW
    assert.equal(right.geometry.x, 390); // NEW
});

test("dragged team sections stay fixed while neighbors restore the minimum spacing", () => {
    const harness = makeHarness();
    const api = harness.graph.__trellisModules;
    const team = api.createModuleAtPoint({ x: 50, y: 60 }, "team");
    const dragged = api.createTeamSection(team, "Propagation", { point: { x: 20, y: 180 } });
    const neighbor = api.createTeamSection(team, "Harvest", { point: { x: 380, y: 180 } });

    harness.graph.moveCells([dragged], 300, 0);

    assert.equal(dragged.geometry.x, 320); // NEW
    assert.equal(dragged.geometry.y, 180); // NEW
    assert.equal(neighbor.geometry.x, 380); // NEW
    assert.equal(neighbor.geometry.y, 20); // NEW
});

test("resized team sections restore spacing by shortest movement instead of resize vector", () => {
    const harness = makeHarness();
    const api = harness.graph.__trellisModules;
    const team = api.createModuleAtPoint({ x: 50, y: 60 }, "team");
    const resized = api.createTeamSection(team, "Propagation", { point: { x: 20, y: 20 } });
    const neighbor = api.createTeamSection(team, "Harvest", { point: { x: 330, y: 210 } });
    const previous = resized.geometry.clone();
    const next = resized.geometry.clone();
    next.height = 220;

    harness.model.setGeometry(resized, next);
    harness.graph.fireEvent(makeEventObject("cellsResized", ["cells", [resized], "bounds", [next], "previous", [previous], "dx", 0, "dy", 80]));

    assert.equal(resized.geometry.height, 220); // NEW
    assert.equal(neighbor.geometry.x, 360); // NEW
    assert.equal(neighbor.geometry.y, 210); // NEW
});

test("dragged team sections push Unassigned sections out of the 20px minimum spacing", () => {
    const harness = makeHarness();
    const api = harness.graph.__trellisModules;
    const team = api.createModuleAtPoint({ x: 50, y: 60 }, "team");
    const unassigned = api.ensureTeamModuleSections(team);
    const active = api.createTeamSection(team, "Propagation");

    harness.graph.moveCells([active], 0, -160);

    assert.equal(active.geometry.y, 20); // NEW
    assert.equal(unassigned.geometry.y, -140); // NEW
});

test("dragged team sections push archived sections out of the 20px minimum spacing", () => {
    const harness = makeHarness();
    const api = harness.graph.__trellisModules;
    const team = api.createModuleAtPoint({ x: 50, y: 60 }, "team");
    api.ensureTeamModuleSections(team);
    const active = api.createTeamSection(team, "Propagation");
    const archived = api.createTeamSection(team, "Archived");
    archived.value.setAttribute("trellis_team_archived", "1"); // NEW

    harness.graph.moveCells([active], 0, 160);

    assert.equal(active.geometry.y, 340); // NEW
    assert.equal(archived.geometry.y, 180); // NEW
});

test("Add Team creates the next section below unassigned active and archived teams", () => {
    const harness = makeHarness();
    const api = harness.graph.__trellisModules;
    const team = api.createModuleAtPoint({ x: 50, y: 60 }, "team");
    const unassigned = api.ensureTeamModuleSections(team);
    const active = api.createTeamSection(team, "Propagation");
    const archived = api.createTeamSection(team, "Archived");
    archived.value.setAttribute("trellis_team_archived", "1"); // NEW
    harness.graph.setSelectionCell(team);

    roleOverlayButton(harness.document, "Add Team").dispatchEvent(new harness.dom.window.MouseEvent("click", { bubbles: true }));

    const created = team.children.filter(child => child.getAttribute("trellis_team_section") === "1").at(-1);
    assert.notEqual(created, unassigned); // NEW
    assert.notEqual(created, active); // NEW
    assert.notEqual(created, archived); // NEW
    assert.equal(created.geometry.y, archived.geometry.y + archived.geometry.height + 20); // NEW
});

test("team module overlay edits labels without graph action side effects", () => {
    const harness = makeHarness();
    const team = harness.graph.__trellisModules.createModuleAtPoint({ x: 50, y: 60 }, "team");
    harness.clearValueWrites();
    const oldTeamValue = team.value;
    const oldTeamLabel = oldTeamValue.getAttribute("label");
    let input = roleOverlayInput(harness.document, "Name"); // CHANGE
    input.value = "Harvest Crew";
    input.dispatchEvent(new harness.dom.window.Event("blur"));
    assert.equal(team.getAttribute("label"), "Harvest Crew");
    assert.equal(harness.valueWrites.length, 1);
    assert.equal(harness.valueWrites[0].oldValue, oldTeamValue);
    assert.notEqual(harness.valueWrites[0].newValue, oldTeamValue);
    assert.equal(oldTeamValue.getAttribute("label"), oldTeamLabel);

    harness.graph.setSelectionCell(team);
    harness.clearValueWrites();
    input = roleOverlayInput(harness.document, "Name"); // CHANGE
    input.value = "Draft Crew";
    dispatchInputKey(input, "Escape");
    assert.equal(input.value, "Harvest Crew");
    assert.equal(team.getAttribute("label"), "Harvest Crew");
    assert.equal(harness.valueWrites.length, 0);

    input.value = "   ";
    dispatchInputKey(input, "Enter");
    assert.equal(team.getAttribute("label"), "Team Module");
});

test("team section overlay edits labels with the module overlay name field behavior", () => {
    const harness = makeHarness();
    const api = harness.graph.__trellisModules; // CHANGE
    const team = api.createModuleAtPoint({ x: 50, y: 60 }, "team"); // CHANGE
    const section = api.createTeamSection(team, "Propagation"); // CHANGE
    harness.graph.setSelectionCell(section); // CHANGE

    harness.clearValueWrites(); // CHANGE
    const oldSectionValue = section.value; // CHANGE
    const oldSectionLabel = oldSectionValue.getAttribute("label"); // CHANGE
    let input = roleOverlayInput(harness.document, "Name"); // CHANGE
    input.value = "Harvest"; // CHANGE
    input.dispatchEvent(new harness.dom.window.Event("blur")); // CHANGE
    assert.equal(section.getAttribute("label"), "Harvest"); // CHANGE
    assert.equal(harness.valueWrites.length, 1); // CHANGE
    assert.equal(harness.valueWrites[0].cell, section); // CHANGE
    assert.equal(harness.valueWrites[0].oldValue, oldSectionValue); // CHANGE
    assert.notEqual(harness.valueWrites[0].newValue, oldSectionValue); // CHANGE
    assert.equal(oldSectionValue.getAttribute("label"), oldSectionLabel); // CHANGE

    harness.graph.setSelectionCell(section); // CHANGE
    harness.clearValueWrites(); // CHANGE
    input = roleOverlayInput(harness.document, "Name"); // CHANGE
    input.value = "Draft"; // CHANGE
    dispatchInputKey(input, "Escape"); // CHANGE
    assert.equal(input.value, "Harvest"); // CHANGE
    assert.equal(section.getAttribute("label"), "Harvest"); // CHANGE
    assert.equal(harness.valueWrites.length, 0); // CHANGE

    input.value = "   "; // CHANGE
    dispatchInputKey(input, "Enter"); // CHANGE
    assert.equal(section.getAttribute("label"), "New Team"); // CHANGE
}); // CHANGE

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
    assert.equal(controls.querySelectorAll("input[aria-label='Name']").length, 1); // CHANGE
    assert.deepEqual(visibleRoleOverlayButtonTexts(harness.document), ["Add Team", "Set Permissions", "Set Module Margins"]); // CHANGE
    assert.equal(controls.textContent.includes("Garden label"), false);
    assert.equal(controls.textContent.includes("Team label"), false);
    assert.equal(roleOverlayInput(harness.document, "Name").value, "Garden Team"); // CHANGE

    garden.value.setAttribute("label", "Market Garden");
    harness.graph.setSelectionCell(team);
    assert.equal(roleOverlay(harness.document).querySelector(".trellis-team-module-label-controls").textContent.includes("Market Garden"), false);
});

test("garden team overlay set permissions opens team permission mode", () => {
    const harness = makeHarness();
    const garden = harness.graph.__trellisModules.createModuleAtPoint({ x: 30, y: 40 }, "garden");
    const team = harness.model.getCell(garden.getAttribute("trellis_team_module_id"));
    let opened = null;
    harness.dom.window.Trellis = { users: { openTeamPermissionMode(moduleCell) { opened = moduleCell; return { ok: true }; } } }; // NEW

    harness.graph.setSelectionCell(team);
    roleOverlayButton(harness.document, "Set Permissions").dispatchEvent(new harness.dom.window.MouseEvent("click", { bubbles: true })); // NEW

    assert.equal(opened, team); // NEW
    assert.equal(roleOverlay(harness.document).style.display, "none"); // NEW
});

test("team role overlay stays suppressed while team permission mode is active", () => {
    const harness = makeHarness();
    const team = harness.graph.__trellisModules.createModuleAtPoint({ x: 50, y: 60 }, "team");
    let active = false;
    harness.dom.window.Trellis = { users: { isTeamPermissionModeActive() { return active; } } }; // NEW
    harness.graph.setSelectionCell(team);
    assert.equal(roleOverlay(harness.document).style.display, "flex");

    active = true;
    harness.dom.window.dispatchEvent(new harness.dom.window.CustomEvent("trellisTeamPermissionModeChanged", { detail: { active: true, teamModuleId: team.id } }));
    assert.equal(roleOverlay(harness.document).style.display, "none");
    harness.graph.setSelectionCell(team);
    assert.equal(roleOverlay(harness.document).style.display, "none");

    active = false;
    harness.dom.window.dispatchEvent(new harness.dom.window.CustomEvent("trellisTeamPermissionModeChanged", { detail: { active: false, teamModuleId: team.id } }));
    assert.equal(roleOverlay(harness.document).style.display, "flex");
}); // NEW

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
    fireGraphClick(harness, { cell: team, hitCell: team, clientX: 180, clientY: 220, graphX: 90, graphY: 100 }); // CHANGE
    harness.graph.setSelectionCell(team); // NEW
    const overlay = roleOverlay(harness.document);
    assert.equal(overlay.style.display, "flex");
    assert.equal(overlay.style.left, "178px");
    assert.equal(overlay.style.top, "208px");
    assert.deepEqual(visibleRoleOverlayButtonTexts(harness.document), ["Add Team", "Set Permissions", "Set Module Margins"]); // NEW
});

test("first click selecting a team section shows team overlay next to the click", () => {
    const harness = makeHarness();
    const api = harness.graph.__trellisModules;
    const team = api.createModuleAtPoint({ x: 50, y: 60 }, "team");
    const section = api.createTeamSection(team, "Propagation");
    harness.graph.setSelectionCell(null);
    fireGraphClick(harness, { cell: section, hitCell: section, clientX: 180, clientY: 220, graphX: 90, graphY: 100 }); // NEW
    harness.graph.setSelectionCell(section); // NEW
    const overlay = roleOverlay(harness.document);
    assert.equal(overlay.style.display, "flex"); // NEW
    assert.equal(overlay.style.left, "178px"); // NEW
    assert.equal(overlay.style.top, "208px"); // NEW
    assert.deepEqual(visibleRoleOverlayButtonTexts(harness.document), ["Add New Role", "Set Permissions"]); // NEW
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

test("role overlay button creates role card from stored click point and focuses name", async () => {
    const harness = makeHarness();
    const api = harness.graph.__trellisModules; // CHANGE
    const team = api.createModuleAtPoint({ x: 50, y: 60 }, "team"); // CHANGE
    const section = api.createTeamSection(team, "Propagation"); // CHANGE
    harness.document.dispatchEvent(new harness.dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    fireGraphClick(harness, { cell: section, hitCell: section, clientX: 100, clientY: 120, graphX: 90, graphY: 100 }); // CHANGE
    harness.graph.setSelectionCell(section); // CHANGE
    const updateCountBefore = harness.model.topLevelUpdateCount;
    roleOverlayButton(harness.document, "Add New Role").dispatchEvent(new harness.dom.window.MouseEvent("click", { bubbles: true })); // CHANGE
    const role = roleCardsUnder(team)[0]; // CHANGE
    assert.ok(role);
    const nameRow = role.children.find(child => styleHas(child, "role_name=1"));
    assert.equal(harness.graph.__trellisModules.isTeamSection(harness.model.getParent(role)), true); // NEW
    assert.equal(role.geometry.x, 20); // CHANGE
    assert.equal(role.geometry.y, 54); // CHANGE
    assert.equal(harness.selectedCell, nameRow);
    await waitForTimers();
    assert.equal(harness.editingStarts.at(-1).cell, nameRow);
    assert.equal(roleOverlay(harness.document).style.display, "none");
    assert.equal(harness.model.topLevelUpdateCount - updateCountBefore, 1);
});

test("context menu add role card uses one top-level model transaction and focuses name", async () => {
    const harness = makeHarness();
    const team = harness.graph.__trellisModules.createModuleAtPoint({ x: 50, y: 60 }, "team");
    const evt = makeMouseEvent(harness.dom.window, "mouseup", { clientX: 110, clientY: 130, graphX: 95, graphY: 105 });
    const addRole = menuItemsFor(harness, team, evt).find(item => item.label === "Add Role Card");
    assert.ok(addRole);
    const updateCountBefore = harness.model.topLevelUpdateCount;
    addRole.funct();
    const role = roleCardsUnder(team)[0]; // CHANGE
    assert.ok(role);
    const nameRow = role.children.find(child => styleHas(child, "role_name=1"));
    assert.equal(harness.graph.__trellisModules.isTeamSection(harness.model.getParent(role)), true); // NEW
    assert.equal(role.geometry.x, 20); // CHANGE
    assert.equal(role.geometry.y, 54); // CHANGE
    assert.equal(harness.selectedCell, nameRow);
    await waitForTimers();
    assert.equal(harness.editingStarts.at(-1).cell, nameRow);
    assert.equal(harness.model.topLevelUpdateCount - updateCountBefore, 1);
});

test("role overlay button falls back to top-left content placement", () => {
    const harness = makeHarness();
    const api = harness.graph.__trellisModules; // CHANGE
    const team = api.createModuleAtPoint({ x: 50, y: 60 }, "team"); // CHANGE
    const section = api.createTeamSection(team, "Propagation"); // CHANGE
    harness.graph.setSelectionCell(section); // CHANGE
    roleOverlayButton(harness.document, "Add New Role").dispatchEvent(new harness.dom.window.MouseEvent("click", { bubbles: true })); // CHANGE
    const role = roleCardsUnder(team)[0]; // CHANGE
    assert.ok(role);
    const nameRow = role.children.find(child => styleHas(child, "role_name=1"));
    assert.equal(harness.graph.__trellisModules.isTeamSection(harness.model.getParent(role)), true); // NEW
    assert.equal(role.geometry.x, 20); // CHANGE
    assert.equal(role.geometry.y, 54); // CHANGE
    assert.equal(harness.selectedCell, nameRow);
    assert.equal(roleOverlay(harness.document).style.display, "none");
});

test("role overlay margin button opens the combined module margins dialog", () => {
    const harness = makeHarness();
    const team = harness.graph.__trellisModules.createModuleAtPoint({ x: 50, y: 60 }, "team");
    roleOverlayButton(harness.document, "Set Module Margins").dispatchEvent(new harness.dom.window.MouseEvent("click", { bubbles: true })); // CHANGE
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

test("standalone team module margin dialog uses diagram units", () => {
    const harness = makeHarness();
    const team = harness.graph.__trellisModules.createModuleAtPoint({ x: 30, y: 40 }, "team"); // CHANGE
    team.style += ";module_margin=180;module_external_margin=45"; // NEW
    harness.graph.setSelectionCell(team);

    roleOverlayButton(harness.document, "Set Module Margins").dispatchEvent(new harness.dom.window.MouseEvent("click", { bubbles: true })); // CHANGE
    const labels = Array.from(harness.lastDialog.querySelectorAll("label")).map(label => label.textContent); // NEW
    const inputs = harness.lastDialog.querySelectorAll("input"); // NEW
    assert.deepEqual(labels, ["Internal margin (diagram units):", "External margin (diagram units):"]); // CHANGE
    assert.equal(inputs[0].value, "180"); // CHANGE
    assert.equal(inputs[1].value, "45"); // CHANGE

    inputs[0].value = "270"; // CHANGE
    inputs[1].value = "113"; // CHANGE
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
    assert.deepEqual(visibleRoleOverlayButtonTexts(harness.document), ["Add Team", "Set Permissions", "Set Module Margins"]); // CHANGE
});

test("clicking the already-selected team section hides team overlay without reopening", () => {
    const harness = makeHarness();
    const api = harness.graph.__trellisModules;
    const team = api.createModuleAtPoint({ x: 50, y: 60 }, "team");
    const section = api.createTeamSection(team, "Propagation");
    harness.graph.setSelectionCell(section);
    const overlay = roleOverlay(harness.document);
    assert.equal(overlay.style.display, "flex"); // NEW
    assert.deepEqual(visibleRoleOverlayButtonTexts(harness.document), ["Add New Role", "Set Permissions"]); // NEW
    fireGraphClick(harness, { cell: section, hitCell: section, clientX: 100, clientY: 120, graphX: 90, graphY: 100 }); // NEW
    assert.equal(overlay.style.display, "none"); // NEW
    assert.deepEqual(visibleRoleOverlayButtonTexts(harness.document), ["Add New Role", "Set Permissions"]); // NEW
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
        assert.match(cell.style, /(?:^|;)connectable=0(?:;|$)/); // CHANGE
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

test("single clicking role text fields starts editing", async () => {
    const harness = makeHarness();
    const { nameRow, titleRow, notesRow, contactRow } = createRoleFixture(harness);
    for (const field of [nameRow, titleRow, notesRow, contactRow]) {
        fireGraphClick(harness, { cell: field, hitCell: field, clientX: 100, clientY: 120 });
        await waitForTimers();
        assert.equal(harness.selectedCell, field);
        assert.equal(harness.editingStarts.at(-1).cell, field);
    }
}); // NEW

test("single click editing ignores role labels image boxes drags double clicks and modifiers", async () => {
    const harness = makeHarness();
    const { role, imageRow, nameRow, fieldLabels, headerSeparator } = createRoleFixture(harness);
    const before = harness.editingStarts.length;
    fireGraphClick(harness, { cell: fieldLabels[0], hitCell: fieldLabels[0] });
    fireGraphClick(harness, { cell: headerSeparator, hitCell: headerSeparator });
    fireGraphClick(harness, { cell: role, hitCell: role });
    fireGraphClick(harness, { cell: imageRow, hitCell: imageRow, upClientX: 130 });
    fireGraphClick(harness, { cell: nameRow, hitCell: nameRow, detail: 2 });
    fireGraphClick(harness, { cell: nameRow, hitCell: nameRow, ctrlKey: true });
    await waitForTimers();
    assert.equal(harness.editingStarts.length, before);
}); // NEW

test("empty role image slot has no add-image overlay and keeps context affordances", () => {
    const harness = makeHarness();
    const { role, imageRow, nameRow } = createRoleFixture(harness);
    harness.graph.setSelectionCell(role);
    assert.equal(roleImageOverlayButtons(harness.document).length, 0);
    assert.equal(isRoleImageOverlayVisible(harness.document), false);
    harness.graph.setSelectionCell(imageRow);
    assert.equal(roleImageOverlayButtons(harness.document).length, 0);
    assert.equal(isRoleImageOverlayVisible(harness.document), false);
    harness.graph.setSelectionCell(nameRow);
    assert.equal(isRoleImageOverlayVisible(harness.document), false);
    assert.equal(runModulesContextMenu(harness, role).labels.includes("Add Role Image"), true);
    assert.equal(runModulesContextMenu(harness, imageRow).labels.includes("Add Role Image"), true);
    assert.equal(runModulesContextMenu(harness, nameRow).labels.includes("Add Role Image"), false);
});

test("clicking the role card does not open the native image picker", async () => {
    const harness = makeHarness();
    harness.setElectronImagePicker({ base64: "native", paths: ["C:\\Users\\test\\Pictures\\role.jpg"] });
    const { role, imageRow } = createRoleFixture(harness);
    fireGraphClick(harness, { cell: role, hitCell: role, selectCellOnDown: role });
    await waitForTimers();
    assert.equal(harness.selectedCell, role);
    assert.equal(getRoleAvatar(imageRow), null);
    assert.deepEqual(harness.electronRequests, []);
}); // NEW

test("existing role image does not render an add-image overlay", async () => {
    const harness = makeHarness();
    const { role, imageRow } = createRoleFixture(harness);
    harness.graph.__trellisModules.selectRoleImage(role);
    await waitForTimers();
    const avatar = getRoleAvatar(imageRow);
    assert.ok(avatar);
    harness.graph.setSelectionCell(role);
    assert.equal(isRoleImageOverlayVisible(harness.document), false);
    harness.graph.setSelectionCell(imageRow);
    assert.equal(roleImageOverlayButtons(harness.document).length, 0);
    assert.equal(isRoleImageOverlayVisible(harness.document), false);
    harness.graph.setSelectionCell(avatar);
    assert.equal(roleImageOverlayButtons(harness.document).length, 0);
    assert.equal(isRoleImageOverlayVisible(harness.document), false);
    assert.equal(runModulesContextMenu(harness, role).labels.includes("Change Role Image"), false);
    assert.equal(runModulesContextMenu(harness, imageRow).labels.includes("Change Role Image"), false);
    assert.equal(runModulesContextMenu(harness, avatar).labels.includes("Change Role Image"), true);
});

test("clicking the photo box opens native image picker and creates the avatar", async () => {
    const harness = makeHarness();
    harness.setElectronImagePicker({ base64: "native", paths: ["C:\\Users\\test\\Pictures\\role.jpg"] });
    const { role, imageRow } = createRoleFixture(harness);
    fireGraphClick(harness, { cell: imageRow, hitCell: imageRow });
    await waitForTimers();
    const avatar = getRoleAvatar(imageRow);
    assert.deepEqual(harness.electronRequests.map(item => item.action), ["getPicturesFolder", "showOpenDialog", "dirname", "readFile"]);
    assert.equal(harness.electronRequests[1].defaultPath, "C:\\Users\\test\\Pictures");
    assert.deepEqual(Array.from(harness.electronRequests[1].filters[0].extensions), ["png", "jpg", "jpeg", "gif", "webp", "svg"]); // CHANGE
    assert.equal(harness.electronRequests[3].encoding, "base64");
    assert.equal(harness.insertImageCalls, 0);
    assert.ok(avatar);
    assert.equal(avatar.parent, imageRow);
    assert.equal(avatar.geometry.width, 40);
    assert.equal(avatar.geometry.height, 40);
    assert.equal(avatar.geometry.x, 5);
    assert.equal(avatar.geometry.y, 5);
    assert.equal(imageRow.value, "");
    assert.doesNotMatch(String(role.value), /<img/i);
    assert.match(avatar.style, /(?:^|;)image=data:image\/jpeg,native(?:;|$)/); // CHANGE
    assert.doesNotMatch(avatar.style, /;base64,/); // NEW
    assert.match(role.style, /(?:^|;)image=data:image\/jpeg,native(?:;|$)/); // CHANGE
    assert.doesNotMatch(role.style, /;base64,/); // NEW
    assert.match(role.style, /(?:^|;)imageWidth=38(?:;|$)/);
});

test("canceling the native role image picker leaves the photo unchanged", async () => {
    const harness = makeHarness();
    harness.setElectronImagePicker({ paths: [] });
    const { imageRow } = createRoleFixture(harness);
    fireGraphClick(harness, { cell: imageRow, hitCell: imageRow });
    await waitForTimers();
    assert.equal(getRoleAvatar(imageRow), null);
    assert.deepEqual(harness.electronRequests.map(item => item.action), ["getPicturesFolder", "showOpenDialog"]);
}); // NEW

test("clicking an existing role avatar replaces it with a native image", async () => {
    const harness = makeHarness();
    harness.setElectronImagePicker({ base64: "first", paths: ["C:\\Users\\test\\Pictures\\first.png"] });
    const { role, imageRow } = createRoleFixture(harness);
    fireGraphClick(harness, { cell: imageRow, hitCell: imageRow });
    await waitForTimers();
    const firstAvatar = getRoleAvatar(imageRow);
    assert.ok(firstAvatar);
    harness.setElectronImagePicker({ base64: "second", paths: ["C:\\Users\\test\\Pictures\\second.webp"] });
    fireGraphClick(harness, { cell: firstAvatar, hitCell: firstAvatar });
    await waitForTimers();
    const avatars = imageRow.children.filter(child => styleHas(child, "role_avatar=1"));
    assert.equal(avatars.length, 1);
    assert.notEqual(avatars[0], firstAvatar);
    assert.equal(firstAvatar.parent, null);
    assert.equal(avatars[0].geometry.width, 40);
    assert.equal(avatars[0].geometry.height, 40);
    assert.match(avatars[0].style, /(?:^|;)image=data:image\/webp,second(?:;|$)/); // CHANGE
    assert.doesNotMatch(avatars[0].style, /;base64,/); // NEW
    assert.match(role.style, /(?:^|;)image=data:image\/webp,second(?:;|$)/); // CHANGE
    assert.doesNotMatch(role.style, /;base64,/); // NEW
    assert.doesNotMatch(String(role.value), /<img/i);
});
