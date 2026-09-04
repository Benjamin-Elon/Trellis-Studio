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
    "Vertex_Linking_Standalone.js"
);

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
    constructor(id, attrs = {}, geometry = null, style = "") {
        this.id = id;
        this.attrs = Object.assign({}, attrs);
        this.geometry = geometry;
        this.style = style;
        this.children = [];
        this.vertex = !attrs.edge;
        this.edge = !!attrs.edge;
    }

    getAttribute(key) { return this.attrs[key] || null; }
    getStyle() { return this.style || ""; }
    getGeometry() { return this.geometry; }
}

class TestModel {
    constructor(root) {
        this.root = root;
        this.updateDepth = 0;
    }

    getRoot() { return this.root; }
    getParent(cell) { return cell && cell.parent ? cell.parent : null; }
    getChildCount(cell) { return cell && cell.children ? cell.children.length : 0; }
    getChildAt(cell, index) { return cell.children[index]; }
    getChildCells(cell) { return cell && cell.children ? cell.children.slice() : []; }
    getGeometry(cell) { return cell && cell.geometry ? cell.geometry : null; }
    setGeometry(cell, geometry) { if (cell) cell.geometry = geometry; }
    isVertex(cell) { return !!cell && cell.vertex !== false && cell !== this.root; }
    isEdge(cell) { return !!cell && cell.edge === true; }
    getTerminal(edge, source) { return edge ? (source ? edge.source : edge.target) : null; }
    getCell(id) { return findCell(this.root, id); }
    addListener() {} // NEW
    beginUpdate() { this.updateDepth += 1; }
    endUpdate() { this.updateDepth -= 1; }
    contains(cell) { return !!cell && isDescendantOrSelf(this.root, cell); }
    add(parent, child, index) {
        const oldParent = this.getParent(child);
        if (oldParent && oldParent.children) oldParent.children = oldParent.children.filter(entry => entry !== child);
        child.parent = parent;
        parent.children = parent.children || [];
        const insertAt = typeof index === "number" ? Math.min(index, parent.children.length) : parent.children.length;
        parent.children.splice(insertAt, 0, child);
        return child;
    }
}

function findCell(root, id) {
    if (!root || !id) return null;
    if (root.id === id) return root;
    for (const child of root.children || []) {
        const found = findCell(child, id);
        if (found) return found;
    }
    return null;
}

function isDescendantOrSelf(root, cell) {
    if (root === cell) return true;
    return (root.children || []).some(child => isDescendantOrSelf(child, cell));
}

function appendChild(parent, child) {
    child.parent = parent;
    parent.children.push(child);
    return child;
}

function makeCell(id, x, y, width = 30, height = 20, attrs = {}, style = "") {
    return new TestCell(id, attrs, new TestGeometry(x, y, width, height), style);
}

function absoluteBounds(model, cell) {
    const geo = model.getGeometry(cell);
    let x = geo ? geo.x : 0;
    let y = geo ? geo.y : 0;
    let parent = model.getParent(cell);
    while (parent) {
        const parentGeo = model.getGeometry(parent);
        if (parentGeo) {
            x += parentGeo.x || 0;
            y += parentGeo.y || 0;
            if (/swimlane/.test(parent.style || "")) y += 20;
        }
        parent = model.getParent(parent);
    }
    return { x, y, width: geo ? geo.width : 0, height: geo ? geo.height : 0 };
}

function makeHarness() {
    const dom = new JSDOM("<!doctype html><body><div id='graph'></div></body>");
    const document = dom.window.document;
    const root = new TestCell("root", {}, new TestGeometry(0, 0, 0, 0));
    const layer = appendChild(root, makeCell("layer", 0, 0, 0, 0));
    const moduleA = appendChild(layer, makeCell("module-a", 100, 50, 180, 120, { canParent: "1" }, "swimlane;module=1;startSize=20"));
    const childA = appendChild(moduleA, makeCell("child-a", 10, 15));
    const moduleB = appendChild(layer, makeCell("module-b", 360, 50, 180, 120, { canParent: "1" }, "swimlane;module=1;startSize=20"));
    const childB = appendChild(moduleB, makeCell("child-b", 10, 15));
    const plainLeaf = appendChild(layer, makeCell("plain-leaf", 40, 40));
    const existing = appendChild(layer, makeCell("existing", 600, 60));
    const model = new TestModel(root);
    const graphListeners = new Map();
    const mouseListeners = [];
    let selectedCells = [];
    let pendingPasteCells = [];
    let pendingLocalClipboardCells = []; // NEW
    const graph = {
        container: document.getElementById("graph"),
        view: { getState(cell) { const b = absoluteBounds(model, cell); return { x: b.x, y: b.y, width: b.width, height: b.height }; } },
        getView() { return this.view; }, // NEW
        getModel() { return model; },
        getDefaultParent() { return layer; },
        getCellGeometry(cell) { return model.getGeometry(cell); },
        getStartSize() { return { width: 0, height: 20 }; },
        isSwimlane(cell) { return /swimlane/.test(cell && cell.style || ""); },
        isCellVisible(cell) { return !(cell && cell.hidden); },
        isCellLocked(cell) { return !!(cell && cell.locked); },
        isValidDropTarget(cell) { return !!(cell && cell.attrs && cell.attrs.canParent === "1" && !cell.invalidDropTarget); },
        getCellAt(x, y) {
            if (typeof graph.hitResolver === "function") return graph.hitResolver(x, y);
            return graph.__hitCell || null;
        },
        refresh(cell) { graph.refreshed = cell || true; },
        addMouseListener(listener) { mouseListeners.push(listener); },
        addListener(eventName, listener) {
            if (!graphListeners.has(eventName)) graphListeners.set(eventName, []);
            graphListeners.get(eventName).push(listener);
        },
        fireEvent(evt) {
            (graphListeners.get(evt && evt.name) || []).forEach(listener => listener(this, evt));
        },
        getSelectionCell() { return selectedCells[0] || null; },
        getSelectionCells() { return selectedCells.slice(); },
        setSelectionCell(cell) { selectedCells = cell ? [cell] : []; },
        setSelectionCells(cells) { selectedCells = cells ? cells.slice() : []; },
        getSelectionModel() { return { addListener() {} }; },
        isCellSelected(cell) { return selectedCells.includes(cell); },
        removeSelectionCell(cell) { selectedCells = selectedCells.filter(selected => selected !== cell); },
        addSelectionCell(cell) { if (!selectedCells.includes(cell)) selectedCells.push(cell); },
        moveCellsTo(cells) { graph.movedToCells = cells || []; }
    };
    const ui = {
        editor: { graph },
        pasteXml(xml) { return pendingPasteCells; },
        pasteFromLocalClipboard() { return null; },
        isCompatibleString(xml) { return /^<mxGraphModel/.test(String(xml || "")); },
        menus: { get() { return null; }, addMenuItems() {} }
    };
    const context = {
        window: dom.window,
        document,
        console: { log() {}, warn() {}, error() {}, debug() {} },
        setTimeout(fn) { fn(); return 1; },
        clearTimeout() {},
        Draw: { loadPlugin(callback) { callback(ui); } },
        mxEvent: {
            CELLS_ADDED: "cellsAdded",
            CELLS_REMOVED: "cellsRemoved",
            CHANGE: "change",
            isControlDown(evt) { return !!(evt && evt.ctrlKey); },
            isMetaDown(evt) { return !!(evt && evt.metaKey); },
            consume() {},
            addListener(node, name, fn) { node.addEventListener(name, fn, true); }
        },
        mxEventObject: function mxEventObject(name, ...pairs) {
            this.name = name;
            this.getProperty = function (key) {
                for (let i = 0; i < pairs.length; i += 2) if (pairs[i] === key) return pairs[i + 1];
                return null;
            };
        },
        mxUtils: {
            convertPoint(_container, x, y) { return { x, y }; },
            createXmlDocument() { return document.implementation.createDocument("", "", null); }
        },
        mxClipboard: { paste() { return pendingLocalClipboardCells; } } // NEW
    };
    vm.runInNewContext(fs.readFileSync(PLUGIN_PATH, "utf8"), context, { filename: PLUGIN_PATH });
    return {
        graph,
        model,
        layer,
        moduleA,
        childA,
        moduleB,
        childB,
        plainLeaf,
        existing,
        ui,
        setPendingPasteCells(cells) { pendingPasteCells = cells; },
        setPendingLocalClipboardCells(cells) { pendingLocalClipboardCells = cells; }, // NEW
        api: graph.__trellisPasteParenting
    };
}

test("cursor paste over a child resolves the valid ancestor and preserves visible position", () => {
    const { graph, model, layer, childA, moduleA, api } = makeHarness();
    const pasted = appendChild(layer, makeCell("pasted", 220, 110, 40, 20));
    const before = absoluteBounds(model, pasted);
    graph.__hitCell = childA;

    const op = api.beginPaste(null, { clientX: 112, clientY: 86 });
    const parent = api.completePaste(op, [pasted], null);

    assert.equal(parent, moduleA);
    assert.equal(model.getParent(pasted), moduleA);
    assert.deepEqual(absoluteBounds(model, pasted), before);
    assert.equal(pasted.geometry.x, 120);
    assert.equal(pasted.geometry.y, 40);
});

test("repeat paste within eight pixels reuses the original cached parent", () => {
    const { graph, model, layer, childA, childB, moduleA, api } = makeHarness();
    const first = appendChild(layer, makeCell("first", 220, 110));
    graph.__hitCell = childA;
    api.completePaste(api.beginPaste(null, { clientX: 112, clientY: 86 }), [first], null);

    const second = appendChild(layer, makeCell("second", 230, 120));
    graph.__hitCell = childB;
    api.completePaste(api.beginPaste(null, { clientX: 120, clientY: 94 }), [second], null);

    assert.equal(model.getParent(second), moduleA);
});

test("paste after moving beyond eight pixels resolves a new parent", () => {
    const { graph, model, layer, childA, childB, moduleA, moduleB, api } = makeHarness();
    const first = appendChild(layer, makeCell("first", 220, 110));
    graph.__hitCell = childA;
    api.completePaste(api.beginPaste(null, { clientX: 112, clientY: 86 }), [first], null);

    const second = appendChild(layer, makeCell("second", 420, 110));
    graph.__hitCell = childB;
    api.completePaste(api.beginPaste(null, { clientX: 372, clientY: 86 }), [second], null);

    assert.equal(model.getParent(first), moduleA);
    assert.equal(model.getParent(second), moduleB);
});

test("stale cached parent re-resolves at the same point before falling back", () => {
    const { graph, model, layer, childA, childB, moduleA, moduleB, api } = makeHarness();
    const first = appendChild(layer, makeCell("first", 220, 110));
    graph.__hitCell = childA;
    api.completePaste(api.beginPaste(null, { clientX: 112, clientY: 86 }), [first], null);
    moduleA.hidden = true;

    const second = appendChild(layer, makeCell("second", 230, 120));
    graph.__hitCell = childB;
    api.completePaste(api.beginPaste(null, { clientX: 113, clientY: 87 }), [second], null);

    assert.equal(model.getParent(second), moduleB);
});

test("nested pasted roots keep hierarchy and only internal top-level edges move with the batch", () => {
    const { graph, model, layer, childA, moduleA, existing, api } = makeHarness();
    const group = appendChild(layer, makeCell("group", 220, 110, 60, 40));
    const child = appendChild(group, makeCell("nested-child", 5, 5));
    const sibling = appendChild(layer, makeCell("sibling", 300, 120));
    const internalEdge = appendChild(layer, new TestCell("internal-edge", { edge: true }, new TestGeometry(0, 0, 0, 0)));
    internalEdge.source = child;
    internalEdge.target = sibling;
    const externalEdge = appendChild(layer, new TestCell("external-edge", { edge: true }, new TestGeometry(0, 0, 0, 0)));
    externalEdge.source = sibling;
    externalEdge.target = existing;
    graph.__hitCell = childA;

    api.completePaste(api.beginPaste(null, { clientX: 112, clientY: 86 }), [group, child, sibling, internalEdge, externalEdge], null);

    assert.equal(model.getParent(group), moduleA);
    assert.equal(model.getParent(child), group);
    assert.equal(model.getParent(sibling), moduleA);
    assert.equal(model.getParent(internalEdge), moduleA);
    assert.equal(model.getParent(externalEdge), layer);
});

test("pasteHere uses the explicit menu point as a fresh anchor", () => {
    const { graph, model, layer, moduleB, childB, ui, setPendingPasteCells } = makeHarness();
    const pasted = appendChild(layer, makeCell("paste-here", 400, 110));
    setPendingPasteCells([pasted]);
    graph.hitResolver = (x) => x >= 360 ? childB : null;

    ui.pasteXml("<mxGraphModel/>", true, null, null, null, { x: 370, y: 86 });

    assert.equal(model.getParent(pasted), moduleB);
});

test("local clipboard diagram paste is cursor-parented after draw.io movement", () => {
    const { graph, model, layer, moduleA, childA, ui, setPendingLocalClipboardCells, api } = makeHarness();
    const pasted = appendChild(layer, makeCell("local", 220, 110));
    setPendingLocalClipboardCells([pasted]);
    graph.__hitCell = childA;
    api.rememberPointer({ clientX: 112, clientY: 86 }); // NEW

    ui.pasteFromLocalClipboard();

    assert.equal(model.getParent(pasted), moduleA);
    assert.deepEqual(graph.movedToCells, [pasted]);
});

test("non-diagram text paste is not cursor-parented", () => {
    const { graph, model, layer, childA, ui, setPendingPasteCells } = makeHarness();
    const pasted = appendChild(layer, makeCell("text", 220, 110));
    setPendingPasteCells([pasted]);
    graph.__hitCell = childA;

    ui.pasteXml("plain text", true, null, { clientX: 112, clientY: 86 }, true, null);

    assert.equal(model.getParent(pasted), layer);
});
