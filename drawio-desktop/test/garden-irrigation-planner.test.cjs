const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { JSDOM } = require("jsdom");

const PROJECT_ROOT = path.join(__dirname, "..");
const PLUGIN_PATH = path.join(PROJECT_ROOT, "drawio", "src", "main", "webapp", "plugins", "garden_planner_plugins", "Garden_Irrigation_Planner.js");

class TestCell {
    constructor(id, value = "", geometry = null, style = "") {
        this.id = id;
        this.value = value;
        this.geometry = geometry;
        this.style = style;
        this.children = [];
    }
    getId() { return this.id; }
    getGeometry() { return this.geometry; }
    getAttribute(key) { return this.value && this.value.nodeType === 1 ? this.value.getAttribute(key) : null; }
}

class TestModel {
    constructor(root) { this.root = root; this.valuesWritten = 0; this.geometryWritten = 0; this.updateDepth = 0; this.removedCells = []; this.completedEdits = []; this.pendingChanges = 0; this.listeners = new Map(); }
    getRoot() { return this.root; }
    getParent(cell) { return cell && cell.parent ? cell.parent : null; }
    getChildCount(cell) { return cell && cell.children ? cell.children.length : 0; }
    getChildAt(cell, index) { return cell.children[index]; }
    getGeometry(cell) { return cell && cell.geometry; }
    setValue(cell, value) { cell.value = value; this.valuesWritten += 1; this.recordChange("value"); }
    setGeometry(cell, value) { cell.geometry = value; this.geometryWritten += 1; this.recordChange("geometry"); }
    remove(cell) {
        this.removedCells.push(cell);
        if (cell && cell.parent && cell.parent.children) cell.parent.children = cell.parent.children.filter(child => child !== cell);
        this.recordChange("remove");
    }
    add(parent, cell, index) {
        if (!parent || !cell) return cell;
        const oldParent = this.getParent(cell);
        if (oldParent && oldParent.children) oldParent.children = oldParent.children.filter(child => child !== cell);
        cell.parent = parent;
        if (!parent.children) parent.children = [];
        if (typeof index === "number") parent.children.splice(Math.min(index, parent.children.length), 0, cell);
        else parent.children.push(cell);
        this.recordChange("add");
        return cell;
    }
    beginUpdate() { this.updateDepth += 1; }
    endUpdate() { this.updateDepth -= 1; if (this.updateDepth === 0 && this.pendingChanges > 0) { const edit = { changes: this.pendingChanges }; this.completedEdits.push(edit); this.pendingChanges = 0; this.fire("undo", edit); } }
    recordChange(_kind) { if (this.updateDepth > 0) this.pendingChanges += 1; else this.completedEdits.push({ changes: 1 }); }
    addListener(event, listener) { if (!this.listeners.has(event)) this.listeners.set(event, []); this.listeners.get(event).push(listener); }
    removeListener(listener) { this.listeners.forEach(list => { const index = list.indexOf(listener); if (index >= 0) list.splice(index, 1); }); }
    fire(event, edit) { (this.listeners.get(event) || []).forEach(listener => listener(this, { getProperty(key) { return key === "edit" ? edit : null; } })); }
}

function appendChild(parent, child) {
    child.parent = parent;
    parent.children.push(child);
    return child;
}

function makeXmlCell(document, id, attrs, geometry) {
    const node = document.implementation.createDocument("", "", null).createElement("object");
    Object.entries(attrs || {}).forEach(([key, value]) => node.setAttribute(key, String(value)));
    return new TestCell(id, node, geometry || null);
}

function descendants(cell, predicate, out = []) {
    (cell.children || []).forEach(child => {
        if (!predicate || predicate(child)) out.push(child);
        descendants(child, predicate, out);
    });
    return out;
}

function loadPlugin(options = {}) {
    const dom = new JSDOM(options.svgOverlayPane ? "<!doctype html><body><div id='graph'><svg><g id='overlay'></g></svg></div></body>" : "<!doctype html><body><div id='graph'></div></body>", { url: options.url || "https://trellis.test/" });
    const document = dom.window.document;
    const consoleLogs = options.consoleLogs || [];
    const root = new TestCell("root");
    const moduleCell = appendChild(root, makeXmlCell(document, "module", { garden_module: "1", label: "Garden" }, { x: 0, y: 0, width: 720, height: 520 }));
    const bed = appendChild(moduleCell, makeXmlCell(document, "bed", { garden_bed: "1", label: "Bed 1" }, { x: 120, y: 120, width: 120, height: 60 }));
    const bed2 = appendChild(moduleCell, makeXmlCell(document, "bed2", { garden_bed: "1", label: "Bed 2" }, { x: 280, y: 120, width: 120, height: 60 }));
    const container = document.getElementById("graph");
    const overlayPane = options.svgOverlayPane ? document.getElementById("overlay") : container;
    Object.defineProperty(container, "clientWidth", { value: options.clientWidth || 1000, configurable: true });
    Object.defineProperty(container, "clientHeight", { value: options.clientHeight || 700, configurable: true });
    const model = new TestModel(root);
    const undoManager = options.undoManager || { undoCalls: 0, redoCalls: 0, undo() { this.undoCalls += 1; if (this.onUndo) this.onUndo(); }, redo() { this.redoCalls += 1; if (this.onRedo) this.onRedo(); } };
    let nextId = 1;
    const actions = new Map();
    const selectionListeners = [];
    const graphListeners = new Map();
    const mouseListeners = [];
    const viewListeners = new Map();
    const graph = {
        selectionCell: options.selectedCell || moduleCell,
        selectionCells: options.selectedCells || null,
        scrolledCells: [],
        fittedWindows: [],
        scrolledRects: [],
        foldCalls: [],
        container,
        view: {
            overlayPane,
            scale: 1,
            translate: { x: 0, y: 0 },
            getState(cell) {
                const absolute = absoluteGeometry(cell);
                return { x: absolute.x, y: absolute.y, width: absolute.width, height: absolute.height };
            },
            addListener(event, listener) { if (!viewListeners.has(event)) viewListeners.set(event, []); viewListeners.get(event).push(listener); },
            removeListener(listener) { viewListeners.forEach(list => { const index = list.indexOf(listener); if (index >= 0) list.splice(index, 1); }); },
            fire(event) { (viewListeners.get(event) || []).forEach(listener => listener()); }
        },
        getModel() { return model; },
        getDefaultParent() { return root; },
        getSelectionCell() { return this.selectionCell; },
        getSelectionCells() { return this.selectionCells || [this.selectionCell].filter(Boolean); },
        setSelectionCell(cell) { this.selectionCell = cell; this.selectionCells = [cell].filter(Boolean); selectionListeners.forEach(listener => listener()); },
        setSelectionCells(cells) { this.selectionCells = cells || []; this.selectionCell = this.selectionCells[0] || null; selectionListeners.forEach(listener => listener()); },
        scrollCellToVisible(cell, center) { this.scrolledCells.push({ cell, center }); },
        fitWindow(bounds, border) { this.fittedWindows.push({ bounds: Object.assign({}, bounds), border }); },
        scrollRectToVisible(bounds) { this.scrolledRects.push(Object.assign({}, bounds)); },
        getSelectionModel() { return { addListener(_event, listener) { selectionListeners.push(listener); }, removeListener(listener) { const index = selectionListeners.indexOf(listener); if (index >= 0) selectionListeners.splice(index, 1); } }; },
        getView() { return this.view; },
        addListener(event, listener) { if (!graphListeners.has(event)) graphListeners.set(event, []); graphListeners.get(event).push(listener); },
        removeListener(listener) { graphListeners.forEach(list => { const index = list.indexOf(listener); if (index >= 0) list.splice(index, 1); }); },
        addMouseListener(listener) { mouseListeners.push(listener); },
        removeMouseListener(listener) { const index = mouseListeners.indexOf(listener); if (index >= 0) mouseListeners.splice(index, 1); },
        fireClick(cell, x = 0, y = 0) {
            const event = { clientX: x, clientY: y };
            (graphListeners.get("click") || []).forEach(listener => listener(this, { getProperty(key) { return key === "cell" ? cell : key === "event" ? event : null; } }));
        },
        fireMouseMove(x = 0, y = 0) {
            const event = { clientX: x, clientY: y };
            mouseListeners.forEach(listener => listener.mouseMove && listener.mouseMove(this, { getEvent() { return event; } }));
        },
        fireCellsAdded(cells) {
            (graphListeners.get("cellsAdded") || []).forEach(listener => listener(this, { getProperty(key) { return key === "cells" ? cells : null; } }));
            (graphListeners.get("addCells") || []).forEach(listener => listener(this, { getProperty(key) { return key === "cells" ? cells : null; } }));
        },
        fireCellsRemoved(cells) {
            (graphListeners.get("cellsRemoved") || []).forEach(listener => listener(this, { getProperty(key) { return key === "cells" ? cells : null; } }));
            (graphListeners.get("removeCells") || []).forEach(listener => listener(this, { getProperty(key) { return key === "cells" ? cells : null; } }));
        },
        fireCellsMoved(cells, dx = 0, dy = 0) {
            (graphListeners.get("cellsMoved") || []).forEach(listener => listener(this, { getProperty(key) { return key === "cells" ? cells : key === "dx" ? dx : key === "dy" ? dy : null; } }));
        },
        fireCellsResized(cells) {
            (graphListeners.get("cellsResized") || []).forEach(listener => listener(this, { getProperty(key) { return key === "cells" ? cells : null; } }));
        },
        getCellAt() { return null; },
        isValidDropTarget() { return true; },
        moveCells(cells, dx = 0, dy = 0, _clone = false, target = null) {
            const moved = cells || [];
            moved.forEach(cell => {
                if (target) model.add(target, cell);
                if (cell && cell.geometry) cell.geometry = Object.assign({}, cell.geometry, { x: Number(cell.geometry.x || 0) + dx, y: Number(cell.geometry.y || 0) + dy });
            });
            this.movedCells = (this.movedCells || []).concat(moved);
            if (moved.length) this.fireCellsMoved(moved, dx, dy);
            return moved;
        },
        updateAlternateBounds(_cell, geo) {
            if (!geo) return;
            if (!geo.alternateBounds) geo.alternateBounds = { x: 0, y: 0, width: 80, height: 30 };
            geo.alternateBounds.x = Number(geo.x || 0);
            geo.alternateBounds.y = Number(geo.y || 0);
        },
        isCellCollapsed(cell) { return !!(cell && cell.collapsed); },
        foldCells(collapse, _recurse, cells) {
            this.foldCalls.push({ collapse: !!collapse, cells: cells || [] });
            (cells || []).forEach(cell => {
                if (!cell || !cell.geometry) return;
                const geo = cloneGeometry(cell.geometry);
                this.updateAlternateBounds(cell, geo, collapse);
                const actual = { x: Number(geo.x || 0), y: Number(geo.y || 0), width: Number(geo.width || 0), height: Number(geo.height || 0) };
                const alternate = geo.alternateBounds || actual;
                geo.x = Number(alternate.x || 0);
                geo.y = Number(alternate.y || 0);
                geo.width = Number(alternate.width || 0);
                geo.height = Number(alternate.height || 0);
                geo.alternateBounds = actual;
                model.setGeometry(cell, geo);
                cell.collapsed = !!collapse;
            });
            return cells || [];
        },
        __withUndoSuppressed(fn) { this.undoSuppressedCalls = (this.undoSuppressedCalls || 0) + 1; return fn(); },
        orderCells(_back, cells) { this.orderedCells = (this.orderedCells || []).concat(cells || []); },
        insertVertex(parent, id, label, x, y, width, height, style) { const cell = appendChild(parent, new TestCell(id || "v" + nextId++, label || "", { x, y, width, height }, style || "")); model.recordChange("insertVertex"); return cell; },
        insertEdge(parent, id, label, source, target, style) {
            const edge = appendChild(parent, new TestCell(id || "e" + nextId++, label || "", { points: [] }, style || ""));
            edge.source = source;
            edge.target = target;
            model.recordChange("insertEdge");
            return edge;
        }
    };
    const ui = {
        editor: { graph, undoManager },
        actions: { addAction(id, fn) { actions.set(id, { funct: fn }); } },
        dialog: { bg: { style: {} }, container: { style: {} } },
        showDialog(node, width, height) { ui.lastDialog = node; ui.hidden = false; ui.showCount = (ui.showCount || 0) + 1; ui.lastDialogSize = { width, height }; ui.dialog.container.style.width = (Number(width || 0) + 60) + "px"; ui.dialog.container.style.height = (Number(height || 0) + 60) + "px"; }, // CHANGE
        hideDialog() { ui.hidden = true; ui.hideCount = (ui.hideCount || 0) + 1; },
        alert(message) { ui.lastAlert = message; }
    };
    const context = {
        window: dom.window,
        document,
        console: { log(...args) { consoleLogs.push(args); } },
        Date,
        setTimeout,
        clearTimeout,
        Blob: function TrellisTestBlob(parts) { this.parts = parts || []; context.lastDownloadText = this.parts.join(""); }, // CHANGE
        URL: { createObjectURL(blob) { context.lastDownloadText = ((blob && blob.parts) || []).join(""); return "#trellis-test-download"; }, revokeObjectURL(url) { context.lastRevokedUrl = url; } }, // CHANGE
        alert(message) { context.lastAlert = message; },
        Draw: { loadPlugin(callback) { callback(ui); } },
        mxEvent: { CHANGE: "change", CLICK: "click", CELLS_ADDED: "cellsAdded", ADD_CELLS: "addCells", CELLS_MOVED: "cellsMoved", CELLS_RESIZED: "cellsResized", CELLS_REMOVED: "cellsRemoved", REMOVE_CELLS: "removeCells", UNDO: "undo", REDO: "redo", SCALE: "scale", TRANSLATE: "translate", SCALE_AND_TRANSLATE: "scaleAndTranslate", getClientX(evt) { return evt && evt.clientX || 0; }, getClientY(evt) { return evt && evt.clientY || 0; } },
        mxUtils: {
            convertPoint(_container, x, y) { return { x, y }; },
            createXmlDocument() { return document.implementation.createDocument("", "", null); },
            htmlEntities(value) { return String(value).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[ch])); },
            button(label, fn) { const button = document.createElement("button"); button.textContent = label; button.addEventListener("click", fn); return button; }
        }
    };
    if (options.currentUser) dom.window.Trellis = { users: { getCurrentUser() { return options.currentUser; } } }; // NEW
    vm.runInNewContext(fs.readFileSync(PLUGIN_PATH, "utf8"), context, { filename: PLUGIN_PATH });
    return { api: graph.__trellisIrrigationPlanner, graph, model, root, moduleCell, bed, bed2, document, ui, actions, undoManager, consoleLogs, context }; // CHANGE
}

function absoluteGeometry(cell) {
    const geo = cell && cell.geometry || { x: 0, y: 0, width: 80, height: 30 };
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

function cloneGeometry(geo) {
    const copy = Object.assign({}, geo || {});
    if (geo && geo.alternateBounds) copy.alternateBounds = Object.assign({}, geo.alternateBounds);
    return copy;
}

function part(id, name, category, stockState, cost, inputs, outputs, inputType, inputSize, outputType, outputSize, specs = {}, unitCost, pipeConnection = false) {
    return {
        id, name, category, stockState, cost, unitCost,
        connectors: { inputs, outputs, input: { type: inputType, nominalSize: inputSize, pipeConnection }, output: { type: outputType, nominalSize: outputSize, maxFlowGpm: specs.maxFlowGpm, pipeConnection } },
        specs
    };
}

function sampleCatalog() {
    return { items: [
        part("filter", "Filter", "filter", "in_stock", 20, 1, 1, "barb", "3/4", "barb", "3/4", { pressureLossPsi: 2 }, undefined, true),
        part("regulator", "Regulator", "regulator", "in_stock", 18, 1, 1, "barb", "3/4", "barb", "3/4", { pressureLossPsi: 1 }, undefined, true),
        part("valve", "Valve", "valve", "in_stock", 30, 1, 2, "barb", "3/4", "barb", "3/4", { pressureLossPsi: 1, maxFlowGpm: 8 }, undefined, true),
        part("pipe_cheap", "3/4 cheap poly", "pipe_tubing", "in_stock", 0, 1, 1, "barb", "3/4", "barb", "3/4", { innerDiameterIn: 0.824, hazenWilliamsC: 150 }, 0.25, true),
        part("pipe_costly", "3/4 costly poly", "pipe_tubing", "in_stock", 0, 1, 1, "barb", "3/4", "barb", "3/4", { innerDiameterIn: 0.824, hazenWilliamsC: 150 }, 0.75, true),
        part("pipe_half", "1/2 poly", "pipe_tubing", "in_stock", 0, 1, 1, "barb", "1/2", "barb", "1/2", { innerDiameterIn: 0.600, hazenWilliamsC: 150 }, 0.32, true),
        part("fght_to_mpt", "FGHT to MPT adapter", "fitting", "in_stock", 5, 1, 1, "fght", "3/4", "mpt", "3/4", { pressureLossPsi: 0.2 }),
        part("fpt_to_barb", "FPT to barb adapter", "fitting", "in_stock", 4, 1, 1, "fpt", "3/4", "barb", "3/4", { pressureLossPsi: 0.2 }, undefined, true),
        part("fght_to_barb_backorder", "FGHT to barb direct adapter", "fitting", "out_of_stock", 9, 1, 1, "fght", "3/4", "barb", "3/4", { pressureLossPsi: 0.2 }, undefined, true),
        part("drip_tape", "Drip Tape", "drip_tape", "out_of_stock", 45, 1, 1, "barb", "3/4", "barb", "3/4", { flowGpm: 1.2, operatingPressurePsi: 10 }, undefined, true)
    ] };
}

function flipConnectCatalog() {
    return { items: [
        part("male_out_fit", "Male outlet fitting", "fitting", "in_stock", 4, 1, 1, "fght", "3/4", "mght", "3/4", { pressureLossPsi: 0.1 }),
        part("female_out_fit", "Female outlet fitting", "fitting", "in_stock", 4, 1, 1, "fght", "3/4", "fght", "3/4", { pressureLossPsi: 0.1 }),
        part("female_out_filter", "Female outlet filter", "filter", "in_stock", 8, 1, 1, "fght", "3/4", "fght", "3/4", { pressureLossPsi: 0.2 })
    ] };
}

function addDripTapeBomParts(catalog) {
    catalog.items.push(part("poly_distribution_1_2", "1/2 in distribution tubing", "pipe_tubing", "in_stock", 0, 1, 1, "barb", "1/2", "barb", "1/2", { innerDiameterIn: 0.600, hazenWilliamsC: 150 }, 0.32, true));
    catalog.items.push(part("poly_mainline_3_4", "3/4 in poly mainline tubing", "pipe_tubing", "in_stock", 0, 1, 1, "barb", "3/4", "barb", "3/4", { innerDiameterIn: 0.824, hazenWilliamsC: 150 }, 0.65, true));
    catalog.items.push(part("barb_tee_1_2", "1/2 in barb tee", "fitting", "in_stock", 2, 1, 2, "barb", "1/2", "barb", "1/2", { pressureLossPsi: 0.2 }, undefined, true));
    catalog.items.push(part("barb_tee_3_4_to_1_2", "3/4: 1/2 barb tee", "fitting", "in_stock", 3.75, 1, 2, "barb", "3/4", "barb", "1/2", { pressureLossPsi: 0.25 }, undefined, true)); // CHANGE
    catalog.items.push(part("end_cap_1_2_barb", "1/2 in barb end cap", "cap_end", "in_stock", 1.25, 1, 0, "barb", "1/2", "", "", { pressureLossPsi: 0 }, undefined, true));
    catalog.items.push(part("drip_tape_8mil_12in", "8 mil drip tape", "drip_tape", "in_stock", 0, 1, 1, "barb", "1/2", "barb", "1/2", { flowGpm: 1.2, flowGpmPerMeter: 1.2, emitterSpacingIn: 12, operatingPressurePsi: 10 }, 0.42, true));
    catalog.items.push(part("fpt_to_half_barb", "FPT to 1/2 barb", "fitting", "in_stock", 4, 1, 1, "fpt", "3/4", "barb", "1/2", { pressureLossPsi: 0.2 }, undefined, true));
    catalog.items.push(part("half_barb_to_3_4_barb", "1/2 barb to 3/4 barb", "fitting", "in_stock", 4, 1, 1, "barb", "1/2", "barb", "3/4", { pressureLossPsi: 0.2 }, undefined, true));
    catalog.items.push(part("half_barb_plug", "1/2 barb plug", "fitting", "in_stock", 2, 1, 0, "barb", "1/2", "", "", { pressureLossPsi: 0 }, undefined, true));
    return catalog;
}

function clickButton(root, text) {
    const button = Array.from(root.querySelectorAll("button")).find(node => node.textContent.includes(text));
    assert.ok(button, "Missing button: " + text);
    button.click();
    return button;
}

function clickExactButton(root, text) {
    const button = Array.from(root.querySelectorAll("button")).find(node => node.textContent.trim() === text);
    assert.ok(button, "Missing exact button: " + text);
    button.click();
    return button;
}

function dispatchDomEvent(node, type) {
    node.dispatchEvent(new node.ownerDocument.defaultView.Event(type, { bubbles: true, cancelable: true }));
}

function selectValues(select) { // NEW
    return Array.from(select.options).map(option => option.value); // NEW
} // NEW

function catalogFormControl(dialog, labelText) { // NEW
    const label = Array.from(dialog.querySelectorAll(".trellis-irrigation-catalog-form label")).find(node => node.textContent.startsWith(labelText)); // NEW
    assert.ok(label, "Missing catalog form control: " + labelText); // NEW
    return label.querySelector("input,select"); // NEW
} // NEW

function catalogHeaderLabels(dialog) { // NEW
    return Array.from(dialog.querySelectorAll(".trellis-irrigation-catalog-table thead th")).map(th => th.textContent); // NEW
} // NEW

function bomHeaderLabels(dialog) { // NEW
    return Array.from(dialog.querySelectorAll("table thead th")).map(th => th.textContent); // NEW
} // NEW

function assertTableHeadersLeftAligned(root, selector, expectedPadding, borderKind) { // NEW
    const headers = Array.from(root.querySelectorAll(selector + " thead th")); // NEW
    assert.ok(headers.length, "missing table headers for " + selector); // NEW
    headers.forEach(th => { // NEW
        assert.equal(th.style.textAlign, "left"); // NEW
        assert.equal(th.style.verticalAlign, "top"); // NEW
        assert.equal(th.style.padding, expectedPadding); // NEW
        if (borderKind === "full") { assert.equal(th.style.borderTopWidth, "1px"); assert.equal(th.style.borderTopStyle, "solid"); } // NEW
        if (borderKind === "bottom") { assert.equal(th.style.borderBottomWidth, "1px"); assert.equal(th.style.borderBottomStyle, "solid"); } // NEW
    }); // NEW
} // NEW

function catalogRowCells(dialog, partId) { // NEW
    const row = dialog.querySelector("[data-part-id='" + partId + "']"); // NEW
    assert.ok(row, "Missing catalog row: " + partId); // NEW
    return Array.from(row.children).map(cell => cell.textContent.trim()); // NEW
} // NEW

function tableRowByText(root, text) { // NEW
    const row = Array.from(root.querySelectorAll("tr")).find(node => node.textContent.includes(text)); // NEW
    assert.ok(row, "Missing table row: " + text); // NEW
    return row; // NEW
} // NEW

function bomGroupTexts(root, tableSelector = ".trellis-irrigation-bom-table") { // NEW
    return Array.from(root.querySelectorAll(tableSelector + " .trellis-irrigation-bom-group")).map(row => row.textContent.trim()); // NEW
} // NEW

function bomDataRowTexts(root, tableSelector = ".trellis-irrigation-bom-table") { // NEW
    return Array.from(root.querySelectorAll(tableSelector + " tbody tr")).filter(row => !row.classList.contains("trellis-irrigation-bom-group")).map(row => row.textContent.trim()); // NEW
} // NEW

function assertNoActiveIrrigationOverlays(root) {
    [
        ".trellis-irrigation-mode-hud",
        ".trellis-irrigation-port-badge",
        ".trellis-irrigation-warning-badge",
        ".trellis-irrigation-selected-pipe-highlight",
        ".trellis-irrigation-inline-connection-action"
    ].forEach(selector => assert.equal(root.querySelectorAll(selector).length, 0, selector));
}

function buttonTexts(root) {
    return Array.from(root.querySelectorAll("button")).map(node => node.textContent.trim()).filter(Boolean);
}

function buttonByText(root, text) {
    const button = Array.from(root.querySelectorAll("button")).find(node => node.textContent.trim() === text);
    assert.ok(button, "Missing button: " + text);
    return button;
}

function clickPort(root, titlePattern) {
    const button = Array.from(root.querySelectorAll(".trellis-irrigation-port-badge")).find(node => titlePattern.test(node.title));
    assert.ok(button, "Missing port badge: " + titlePattern);
    button.click();
    return button;
}

function portBadges(root) {
    return Array.from(root.querySelectorAll(".trellis-irrigation-port-badge"));
}

function portBadgesInState(root, state) {
    return portBadges(root).filter(node => node.classList.contains("trellis-irrigation-port-badge-" + state));
}

function inlineConnectionActions(root) {
    return Array.from(root.querySelectorAll(".trellis-irrigation-inline-connection-action"));
}

function assertInlineConnectionAction(root, label) {
    assert.equal(root.querySelector(".trellis-irrigation-mode-hud"), null, label + " should suppress the regular HUD");
    const actions = inlineConnectionActions(root);
    assert.equal(actions.length, 1, "Expected one inline connection action");
    assert.equal(actions[0].textContent, label);
    assert.equal(actions[0].parentNode && actions[0].parentNode.className, "trellis-irrigation-control-layer");
    assert.equal(actions[0].parentNode && actions[0].parentNode.style.zIndex, "10020");
    assert.equal(actions[0].style.zIndex, "10030");
    return actions[0];
}

function internalConnectionBadges(root) {
    return Array.from(root.querySelectorAll(".trellis-irrigation-internal-connection-badge"));
}

function selectedInternalConnectionBadges(root) {
    return internalConnectionBadges(root).filter(node => node.classList.contains("trellis-irrigation-internal-connection-badge-selected"));
}

function selectedPortBadgeLabels(root) {
    return portBadgesInState(root, "selected").map(node => node.textContent).sort();
}

function selectedPortKeys(api, session) {
    return Array.from(api.__test.selectedValidPorts(session), port => [port.cellId, port.role, String(port.index)].join(":")).sort(); // CHANGE
}
function irrigationLogLabels(logs) {
    return (logs || []).map(args => String(args && args[0] || ""));
}
function irrigationLogsWithLabel(logs, label) {
    const prefix = "[Trellis Irrigation] " + label;
    return (logs || []).filter(args => String(args && args[0] || "") === prefix);
}

function assemblyCells(moduleCell, api) {
    return descendants(moduleCell, cell => cell.getAttribute && cell.getAttribute(api.attrs.ASSEMBLY) === "1");
}

function setMeasuredEdgeLength(edge, lengthUnits) {
    edge.geometry.points = [{ x: 0, y: 0 }, { x: lengthUnits, y: 0 }];
    return edge;
}

function styleToken(style, key) {
    const prefix = key + "=";
    const token = String(style || "").split(";").find(part => part.startsWith(prefix));
    return token ? token.slice(prefix.length) : "";
}

function assertEdgeAnchors(edge, expected) { // NEW
    Object.keys(expected).forEach(key => assert.equal(styleToken(edge && edge.style, key), expected[key], "Expected edge " + key + "=" + expected[key])); // NEW
} // NEW

function assertRegularBedAssemblyStyle(assembly) {
    const style = String(assembly && assembly.style || "");
    assert.doesNotMatch(style, /(?:^|;)swimlane(?:;|$)/, "bed assemblies must not use swimlanes");
    assert.notEqual(styleToken(style, "childLayout"), "stackLayout", "bed assemblies must not stack generated layout rows");
    assert.equal(styleToken(style, "horizontalStack"), "", "bed assemblies must not opt into swimlane horizontal stack behavior");
    assert.equal(styleToken(style, "container"), "1", "bed assemblies should remain regular child-owning containers");
    assert.equal(styleToken(style, "editable"), "0", "bed assembly titles should not capture canvas text focus");
    assert.equal(styleToken(style, "labelPosition"), "center", "bed assembly title should stay horizontally centered above the bed"); // CHANGE
    assert.equal(styleToken(style, "verticalLabelPosition"), "top", "bed assembly title should live above the bed top edge"); // CHANGE
    assert.equal(styleToken(style, "verticalAlign"), "bottom", "bed assembly title should sit just above the top edge"); // CHANGE
    assert.equal(styleToken(style, "spacingBottom"), "2", "bed assembly title should stay close to the top edge"); // CHANGE
    assert.equal(styleToken(style, "fontStyle"), "1", "bed assembly title should remain visually distinct");
}

function assertSwimlaneAssemblyStyle(assembly) {
    const style = String(assembly && assembly.style || "");
    assert.match(style, /(?:^|;)swimlane(?:;|$)/, "source and part assemblies should remain swimlanes");
    assert.equal(styleToken(style, "childLayout"), "stackLayout", "source and part assemblies should keep ordered stack layout");
    assert.equal(styleToken(style, "horizontalStack"), "0", "source and part assemblies should keep vertical stacking");
}

function assertAssemblyPartPlannerManagedStyle(partCell) {
    const style = String(partCell && partCell.style || "");
    assert.equal(styleToken(style, "editable"), "0", "assembly parts should not be label-editable on the canvas");
    assert.equal(styleToken(style, "movable"), "", "assembly parts should stay movable for compact draw.io stack layout");
    assert.equal(styleToken(style, "selectable"), "", "assembly parts should remain selectable by default");
    assert.equal(styleToken(style, "deletable"), "0", "assembly parts should be deleted through planner controls");
    assert.equal(styleToken(style, "resizable"), "0", "assembly parts should not be manually resized");
    assert.equal(styleToken(style, "connectable"), "0", "assembly parts should not expose raw draw.io connectors");
}

function geometryCenter(geo) {
    return { x: Number(geo.x || 0) + Number(geo.width || 0) / 2, y: Number(geo.y || 0) + Number(geo.height || 0) / 2 };
}

function connectionRow(root, label) {
    const row = Array.from(root.querySelectorAll(".trellis-irrigation-connection-row")).find(node => node.textContent.includes(label));
    assert.ok(row, "Missing connection row: " + label);
    return row;
}

function chooseConnectionPart(root, label, partId) {
    const combobox = openConnectionCombobox(root, label);
    const panel = connectionComboboxPanel(combobox);
    const search = panel.querySelector(".trellis-irrigation-connection-combobox-search");
    search.value = partId;
    search.dispatchEvent(new root.ownerDocument.defaultView.Event("input", { bubbles: true }));
    const option = panel.querySelector(".trellis-irrigation-connection-combobox-option[data-part-id='" + partId + "']");
    assert.ok(option, "Missing connection combobox option: " + partId);
    option.click();
    return combobox;
}

function connectionCombobox(root, label) {
    const combobox = connectionRow(root, label).querySelector(".trellis-irrigation-connection-combobox");
    assert.ok(combobox, "Missing connection combobox: " + label);
    return combobox;
}

function openConnectionCombobox(root, label) {
    const combobox = connectionCombobox(root, label);
    const trigger = combobox.querySelector(".trellis-irrigation-connection-combobox-trigger");
    assert.ok(trigger, "Missing connection combobox trigger: " + label);
    trigger.click();
    assert.ok(connectionComboboxPanel(combobox), "Combobox should open: " + label);
    return combobox;
}

function connectionComboboxPanel(combobox) {
    const panel = combobox.querySelector(".trellis-irrigation-connection-combobox-panel") || combobox.ownerDocument.querySelector(".trellis-irrigation-connection-combobox-panel");
    assert.ok(panel, "Missing connection combobox panel");
    return panel;
}

function connectionComboboxOptionIds(combobox) {
    return Array.from(connectionComboboxPanel(combobox).querySelectorAll(".trellis-irrigation-connection-combobox-option")).map(node => node.getAttribute("data-part-id"));
}

function assertConnectionRowReadOnly(root, label) {
    const row = connectionRow(root, label);
    assert.equal(row.querySelector("select"), null, "Connected row should not expose replacement dropdown: " + label);
    assert.ok(row.querySelector(".trellis-irrigation-connection-status"), "Connected row should show read-only status: " + label);
    return row;
}

function assertConnectionHud(root, summaryPattern) {
    const hud = root.querySelector(".trellis-irrigation-connection-hud");
    assert.ok(hud, "Missing Connection HUD");
    assert.match(hud.textContent, /Connection/);
    if (summaryPattern) assert.match(hud.textContent, summaryPattern);
    assert.ok(hud.querySelector(".trellis-irrigation-danger-actions .trellis-irrigation-danger-button"), "Connection HUD should expose bottom danger action");
    assert.ok(Array.from(hud.querySelectorAll(".trellis-irrigation-danger-actions button")).some(node => node.textContent === "Disconnect"), "Connection HUD should expose Disconnect");
    assert.equal(hud.querySelector("select"), null, "Connection HUD should not expose replacement dropdowns");
    return hud;
}

function assertBoundedStyle(node, label) {
    assert.ok(node, "Missing styled node: " + label);
    const style = node.getAttribute("style") || "";
    assert.match(style, /min-width:\s*0/, label + " should allow grid/flex shrink");
    assert.match(style, /max-width:\s*100%/, label + " should stay inside the HUD");
    assert.match(style, /box-sizing:\s*border-box/, label + " should include borders in width");
}

function selectByLabel(root, labelText) {
    const label = Array.from(root.querySelectorAll("label")).find(node => node.textContent.startsWith(labelText));
    assert.ok(label, "Missing label: " + labelText);
    const select = label.querySelector("select");
    assert.ok(select, "Missing select for label: " + labelText);
    return select;
}

function querySelectByLabel(root, labelText) {
    const label = Array.from(root.querySelectorAll("label")).find(node => node.textContent.startsWith(labelText));
    return label ? label.querySelector("select") : null;
}

function inputByLabel(root, labelText) {
    const label = Array.from(root.querySelectorAll("label")).find(node => node.textContent.startsWith(labelText));
    assert.ok(label, "Missing label: " + labelText);
    const input = label.querySelector("input");
    assert.ok(input, "Missing input for label: " + labelText);
    return input;
}

function labelCaption(label) {
    return Array.from(label.childNodes).filter(node => node.nodeType === 3).map(node => node.textContent).join("").trim();
}

function changeSelectByLabel(root, labelText, value) {
    const select = selectByLabel(root, labelText);
    select.value = value;
    select.dispatchEvent(new root.ownerDocument.defaultView.Event("change", { bubbles: true }));
    return select;
}

function inputTextByLabel(root, labelText, value) {
    const input = inputByLabel(root, labelText);
    input.value = String(value);
    input.dispatchEvent(new root.ownerDocument.defaultView.Event("input", { bubbles: true }));
    return input;
}

function blurInput(input) {
    input.dispatchEvent(new input.ownerDocument.defaultView.Event("blur", { bubbles: false }));
}

function createConfiguredDripTapeBedAssembly(api, graph, moduleCell, bed, anchor) {
    const bedAssembly = api.__test.createBedAssembly(moduleCell, bed, anchor || { x: 240, y: 120 }).assembly;
    graph.setSelectionCell(bedAssembly);
    changeSelectByLabel(graph.container, "Inlet part", "fpt_to_half_barb");
    changeSelectByLabel(graph.container, "Row part", "drip_tape_8mil_12in"); // CHANGE
    changeSelectByLabel(graph.container, "Row takeoff part", "barb_tee_1_2"); // CHANGE
    changeSelectByLabel(graph.container, "Row end cap", "end_cap_1_2_barb"); // CHANGE
    changeSelectByLabel(graph.container, "Outlet part", "half_barb_to_3_4_barb");
    graph.setSelectionCell(bedAssembly);
    return bedAssembly;
}

function bedLayoutRows(assembly, api) {
    return descendants(assembly, cell => cell.getAttribute && cell.getAttribute(api.attrs.BED_LAYOUT) === "1");
}

function bedSupplyLines(assembly, api) {
    return descendants(assembly, cell => cell.getAttribute && cell.getAttribute(api.attrs.BED_SUPPLY_LINE) === "1");
}

function createCommittedDripTapeBedAssembly(harness, bedCell) {
    const { api, graph, moduleCell } = harness;
    const targetBed = bedCell || harness.bed;
    api.writeCatalog(moduleCell, addDripTapeBomParts(sampleCatalog()));
    const created = api.__test.createBedAssembly(moduleCell, targetBed, { x: 30, y: 220 });
    api.openIrrigationMode(moduleCell, { preserveViewport: true });
    graph.setSelectionCell(created.assembly);
    changeSelectByLabel(graph.container, "Inlet part", "fpt_to_half_barb");
    changeSelectByLabel(graph.container, "Row part", "drip_tape_8mil_12in"); // CHANGE
    changeSelectByLabel(graph.container, "Row takeoff part", "barb_tee_1_2"); // CHANGE
    changeSelectByLabel(graph.container, "Row end cap", "end_cap_1_2_barb"); // CHANGE
    changeSelectByLabel(graph.container, "Header end cap", "end_cap_1_2_barb");
    return created.assembly;
}

function commitRecipeBedAssembly(api, moduleCell, bedAssembly, pathId, templateId, rows, orientation, recipe) { // NEW
    const catalog = api.readCatalog(moduleCell); // NEW
    const bom = api.__test.computeBedTemplateBom(catalog, bedAssembly.geometry, templateId, rows || 2, orientation || "width", recipe); // NEW
    api.__test.commitBedTemplate(moduleCell, pathId, bedAssembly, Object.assign({}, recipe, { // NEW
        templateId, // NEW
        templateModel: "bom", // NEW
        recipeVersion: 1, // NEW
        rowOrientation: bom.rowOrientation, // NEW
        rowLengthMeters: bom.rowLengthMeters, // NEW
        rowSpacingCm: bom.rowSpacingCm, // NEW
        totalRowMeters: bom.totalRowMeters, // NEW
        requiredParts: bom.requiredParts, // NEW
        resolvedBomParts: bom.recipe && bom.recipe.resolvedBomParts || [], // NEW
        anchorPartId: bom.anchorPartId, // NEW
        supplyPipePartId: bom.recipe && bom.recipe.supplyPipePartId || "", // NEW
        demand: bom.demand, // NEW
        assemblyLabelMode: "", // NEW
        spacing: { rows: bom.rowCount, emitterInches: recipe.emitterSpacingIn || 12, rowSpacingCm: bom.rowSpacingCm } // NEW
    })); // NEW
    return bom; // NEW
} // NEW

function createLifecycleBomFixture(options) { // CHANGE
    const harness = loadPlugin(options || {}); // CHANGE
    const { api, moduleCell, bed } = harness;
    const catalog = addDripTapeBomParts(sampleCatalog());
    catalog.items.push(part("filter_half_lifecycle", "1/2 lifecycle filter", "filter", "out_of_stock", 20, 1, 1, "barb", "1/2", "barb", "1/2", { pressureLossPsi: 1 }, undefined, true));
    api.writeCatalog(moduleCell, catalog);
    const source = api.__test.createSourceAssembly(moduleCell, "Half Source", { connectorType: "barb", nominalSize: "1/2", pipeConnection: true, usableFlowGpm: 5, staticPressurePsi: 45 }, { x: 30, y: 40 });
    const filter = api.__test.createPartAssembly(moduleCell, catalog.items.find(item => item.id === "filter_half_lifecycle"), { x: 30, y: 170 });
    const bedAssembly = api.__test.createBedAssembly(moduleCell, bed, { x: 30, y: 320 });
    const bom = api.__test.computeBedTemplateBom(catalog, bedAssembly.assembly.geometry, "drip_tape_bed", 2, "width");
    api.__test.commitBedTemplate(moduleCell, "bed_lifecycle", bedAssembly.assembly, { templateId: "drip_tape_bed", templateModel: "bom", irrigationType: bom.templateDef.lineKind, rowOrientation: bom.rowOrientation, rowLengthMeters: bom.rowLengthMeters, rowSpacingCm: bom.rowSpacingCm, totalRowMeters: bom.totalRowMeters, requiredParts: bom.requiredParts, anchorPartId: bom.anchorPartId, demand: bom.demand, spacing: { rows: bom.rowCount, emitterInches: 12, rowSpacingCm: bom.rowSpacingCm } });
    assert.equal(api.__test.createAssemblyConnection(moduleCell, { cellId: api.__test.firstAssemblyPart(source.assembly).getId(), role: "output", index: 0 }, { cellId: api.__test.firstAssemblyPart(filter.assembly).getId(), role: "input", index: 0 }).ok, true);
    assert.equal(api.__test.createAssemblyConnection(moduleCell, { cellId: api.__test.firstAssemblyPart(filter.assembly).getId(), role: "output", index: 0 }, { cellId: bedAssembly.assembly.getId(), role: "input", index: 0 }).ok, true);
    const edges = api.__test.collectAssemblyEdges(moduleCell).filter(edge => edge.getAttribute(api.attrs.PIPE_EDGE) === "1");
    edges.forEach(edge => setMeasuredEdgeLength(edge, 120));
    return Object.assign(harness, { catalog, source, filter, filterPart: api.__test.firstAssemblyPart(filter.assembly), bedAssembly: bedAssembly.assembly, pipeEdges: edges });
}

function createLifecycleBranchpointFixture() {
    const harness = loadPlugin();
    const { api, moduleCell, bed } = harness;
    const catalog = addDripTapeBomParts(sampleCatalog());
    catalog.items.push(part("branch_filter_lifecycle", "1/2 lifecycle branch filter", "filter", "out_of_stock", 20, 1, 1, "barb", "1/2", "barb", "1/2", { pressureLossPsi: 1 }, undefined, true));
    api.writeCatalog(moduleCell, catalog);
    const source = api.__test.createSourceAssembly(moduleCell, "Half Source", { connectorType: "barb", nominalSize: "1/2", pipeConnection: true, usableFlowGpm: 5, staticPressurePsi: 45 }, { x: 30, y: 40 });
    const branchpoint = api.__test.createBranchpointEndpoint(moduleCell, "Branch Filter", "branch_filter_lifecycle", { connectorType: "barb", nominalSize: "1/2", pipeConnection: true });
    const bedAssembly = api.__test.createBedAssembly(moduleCell, bed, { x: 30, y: 320 });
    const bom = api.__test.computeBedTemplateBom(catalog, bedAssembly.assembly.geometry, "drip_tape_bed", 2, "width");
    api.__test.commitBedTemplate(moduleCell, "bed_branch_lifecycle", bedAssembly.assembly, { templateId: "drip_tape_bed", templateModel: "bom", irrigationType: bom.templateDef.lineKind, rowOrientation: bom.rowOrientation, rowLengthMeters: bom.rowLengthMeters, rowSpacingCm: bom.rowSpacingCm, totalRowMeters: bom.totalRowMeters, requiredParts: bom.requiredParts, anchorPartId: bom.anchorPartId, demand: bom.demand, spacing: { rows: bom.rowCount, emitterInches: 12, rowSpacingCm: bom.rowSpacingCm } });
    assert.equal(api.__test.createAssemblyConnection(moduleCell, { cellId: api.__test.firstAssemblyPart(source.assembly).getId(), role: "output", index: 0 }, { cellId: branchpoint.getId(), role: "input", index: 0 }).ok, true);
    assert.equal(api.__test.createAssemblyConnection(moduleCell, { cellId: branchpoint.getId(), role: "output", index: 0 }, { cellId: bedAssembly.assembly.getId(), role: "input", index: 0 }).ok, true);
    const pipeEdges = api.__test.collectAssemblyEdges(moduleCell).filter(edge => edge.getAttribute(api.attrs.PIPE_EDGE) === "1");
    pipeEdges.forEach(edge => setMeasuredEdgeLength(edge, 120));
    return Object.assign(harness, { catalog, source, branchpoint, bedAssembly: bedAssembly.assembly, pipeEdges });
}

function hudSectionTitles(root) {
    return Array.from(root.querySelectorAll(".trellis-irrigation-hud-section-title")).map(node => node.textContent);
}

function irrigationHeader(root) {
    const header = root.querySelector(".trellis-irrigation-hud-header");
    assert.ok(header, "Missing irrigation HUD header");
    return header;
}

function dangerButton(root) {
    const button = root.querySelector(".trellis-irrigation-danger-actions .trellis-irrigation-danger-button");
    assert.ok(button, "Missing bottom danger button");
    return button;
}

function lifecycleToggle(root) {
    const toggle = root.querySelector(".trellis-irrigation-lifecycle-toggle");
    assert.ok(toggle, "Missing lifecycle toggle");
    return toggle;
}

function assertNoAssemblyFoldToggle(root) {
    assert.equal(irrigationHeader(root).querySelector(".trellis-irrigation-assembly-fold-toggle"), null);
}

function styleHasColor(node, hex, rgb) {
    const style = node && node.getAttribute("style") || "";
    return style.indexOf(hex) >= 0 || style.indexOf(rgb) >= 0;
}

function activeOutlineStyleMatches(node) {
    return styleHasColor(node, "#d6b656", "rgb(214, 182, 86)");
}

test("already-foldable irrigation assemblies collapse around their geometry center", () => {
    const { api, graph, moduleCell } = loadPlugin();
    api.writeCatalog(moduleCell, sampleCatalog());
    const assembly = api.__test.createPartAssembly(moduleCell, api.readCatalog(moduleCell).items.find(item => item.id === "filter"), { x: 30, y: 40 }).assembly;
    const beforeCenter = geometryCenter(assembly.geometry);

    assert.equal(api.__test.isCenterStableFoldAssembly(assembly), true);
    graph.foldCells(true, false, [assembly]);

    assert.deepEqual(geometryCenter(assembly.geometry), beforeCenter);
    assert.equal(assembly.geometry.width, 80);
    assert.equal(assembly.geometry.height, 30);
    assert.notEqual(assembly.geometry.x, 30);
});

test("moved collapsed irrigation assemblies expand around their moved center", () => {
    const { api, graph, moduleCell } = loadPlugin();
    api.writeCatalog(moduleCell, sampleCatalog());
    const assembly = api.__test.createSourceAssembly(moduleCell, "Well", { connectorType: "barb", nominalSize: "3/4" }, { x: 30, y: 40 }).assembly;

    graph.foldCells(true, false, [assembly]);
    graph.moveCells([assembly], 42, 18);
    const movedCollapsedCenter = geometryCenter(assembly.geometry);
    graph.foldCells(false, false, [assembly]);

    assert.deepEqual(geometryCenter(assembly.geometry), movedCollapsedCenter);
    assert.equal(assembly.geometry.width, 210);
});

test("center-stable folding excludes bed assemblies, modules, and generic cells", () => {
    const { api, graph, moduleCell, bed, document } = loadPlugin();
    const bedAssembly = api.__test.createBedAssembly(moduleCell, bed, { x: 30, y: 220 }).assembly;
    const generic = appendChild(moduleCell, makeXmlCell(document, "generic", { label: "Generic" }, { x: 300, y: 40, width: 160, height: 90 }));

    assert.equal(api.__test.isCenterStableFoldAssembly(bedAssembly), false);
    assert.equal(api.__test.isCenterStableFoldAssembly(moduleCell), false);
    assert.equal(api.__test.isCenterStableFoldAssembly(generic), false);

    const genericTopLeft = { x: generic.geometry.x, y: generic.geometry.y };
    graph.foldCells(true, false, [generic]);
    assert.deepEqual({ x: generic.geometry.x, y: generic.geometry.y }, genericTopLeft);
    assert.equal(styleToken(bedAssembly.style, "collapsible"), "0");
});

test("selected irrigation assembly does not show header collapse and expand icons", () => {
    const { api, graph, moduleCell } = loadPlugin();
    api.writeCatalog(moduleCell, sampleCatalog());
    const assembly = api.__test.createPartAssembly(moduleCell, api.readCatalog(moduleCell).items.find(item => item.id === "filter"), { x: 30, y: 40 }).assembly;
    api.openIrrigationMode(moduleCell, { preserveViewport: true });
    graph.setSelectionCell(assembly);

    assert.equal(hudSectionTitles(graph.container).includes("Assemblies"), false);
    assertNoAssemblyFoldToggle(graph.container); // CHANGE
});

test("selected inner part does not show parent assembly collapse controls", () => {
    const { api, graph, moduleCell } = loadPlugin();
    api.writeCatalog(moduleCell, sampleCatalog());
    const assembly = api.__test.createSourceAssembly(moduleCell, "Well", { connectorType: "barb", nominalSize: "3/4" }, { x: 30, y: 40 }).assembly;
    const sourcePart = api.__test.firstAssemblyPart(assembly);
    api.openIrrigationMode(moduleCell, { preserveViewport: true });
    graph.setSelectionCell(sourcePart);

    assertNoAssemblyFoldToggle(graph.container); // CHANGE
});

test("mixed selected assembly fold states do not show header toggles", () => {
    const { api, graph, moduleCell } = loadPlugin();
    api.writeCatalog(moduleCell, sampleCatalog());
    const expanded = api.__test.createPartAssembly(moduleCell, api.readCatalog(moduleCell).items.find(item => item.id === "filter"), { x: 30, y: 40 }).assembly;
    const collapsed = api.__test.createPartAssembly(moduleCell, api.readCatalog(moduleCell).items.find(item => item.id === "regulator"), { x: 260, y: 40 }).assembly;
    graph.foldCells(true, false, [collapsed]);
    api.openIrrigationMode(moduleCell, { preserveViewport: true });
    graph.setSelectionCells([expanded, collapsed]);

    assertNoAssemblyFoldToggle(graph.container); // CHANGE
});

test("assembly fold controls exclude bed module generic and pipe-only selections", () => {
    const { api, graph, moduleCell, bed, document } = loadPlugin();
    api.writeCatalog(moduleCell, sampleCatalog());
    const source = api.__test.createSourceAssembly(moduleCell, "Well", { connectorType: "barb", nominalSize: "3/4", pipeConnection: true }, { x: 30, y: 40 });
    const filter = api.__test.createPartAssembly(moduleCell, api.readCatalog(moduleCell).items.find(item => item.id === "filter"), { x: 260, y: 40 });
    const bedAssembly = api.__test.createBedAssembly(moduleCell, bed, { x: 30, y: 220 }).assembly;
    const generic = appendChild(moduleCell, makeXmlCell(document, "generic_fold_control", { label: "Generic" }, { x: 460, y: 40, width: 120, height: 60 }));
    const connection = api.__test.createAssemblyConnection(moduleCell, { cellId: api.__test.firstAssemblyPart(source.assembly).getId(), role: "output", index: 0 }, { cellId: api.__test.firstAssemblyPart(filter.assembly).getId(), role: "input", index: 0 });
    assert.equal(connection.ok, true, connection.reason);
    api.openIrrigationMode(moduleCell, { preserveViewport: true });

    graph.setSelectionCell(bedAssembly);
    assertNoAssemblyFoldToggle(graph.container);
    graph.setSelectionCell(bed);
    assertNoAssemblyFoldToggle(graph.container);
    graph.setSelectionCell(moduleCell);
    assertNoAssemblyFoldToggle(graph.container);
    graph.setSelectionCell(connection.edge);
    assertNoAssemblyFoldToggle(graph.container);
    graph.setSelectionCell(generic);
    assert.equal(graph.container.querySelector(".trellis-irrigation-mode-hud"), null);
});

function nextTick() {
    return new Promise(resolve => setTimeout(resolve, 0));
}

test("catalog manager renders category/size group headers, catalog filters, and connector dropdowns", () => {
    const { api, moduleCell, ui } = loadPlugin();
    api.writeCatalog(moduleCell, sampleCatalog());
    api.openCatalogManager(moduleCell);
    assert.equal(ui.dialog.container.style.zIndex, "2000000000");
    assert.equal(ui.dialog.bg.style.zIndex, "1999999999");
    const groups = Array.from(ui.lastDialog.querySelectorAll(".trellis-irrigation-catalog-group")).map(row => row.textContent);
    assert.ok(groups.includes("Filters / 3/4")); // CHANGE
    assert.ok(groups.includes("Fittings / 3/4")); // CHANGE
    assert.ok(groups.includes("Pipe/tubing / 3/4")); // CHANGE
    const broadFilter = ui.lastDialog.querySelector(".trellis-irrigation-catalog-broad-filter");
    const categoryFilter = ui.lastDialog.querySelector(".trellis-irrigation-catalog-category-filter");
    const sizeFilter = ui.lastDialog.querySelector(".trellis-irrigation-catalog-size-filter");
    const connectorTypeFilter = ui.lastDialog.querySelector(".trellis-irrigation-catalog-connector-type-filter"); // NEW
    const connectionFilter = ui.lastDialog.querySelector(".trellis-irrigation-catalog-connection-filter");
    assert.ok(Array.from(broadFilter.options).some(option => option.value === "control_protection"));
    assert.ok(Array.from(broadFilter.options).some(option => option.value === "fittings_adapters" && option.textContent === "Fittings & adapters")); // NEW
    assert.ok(Array.from(categoryFilter.options).some(option => option.value === "fitting"));
    assert.ok(Array.from(sizeFilter.options).some(option => option.value === "3/4"));
    assert.ok(Array.from(connectorTypeFilter.options).some(option => option.value === "barb")); // NEW
    assert.ok(Array.from(connectionFilter.options).some(option => option.value === "3"));
    assert.match(ui.lastDialog.textContent, /Control & protection/);
    assert.equal(api.__test.broadCategoryForCatalogCategory("source_adapter").id, "source_supply"); // CHANGE
    assert.equal(api.__test.broadCategoryForCatalogCategory("fitting").id, "fittings_adapters"); // NEW
    assert.equal(api.__test.broadCategoryForCatalogCategory("cap_end").id, "fittings_adapters"); // NEW
    categoryFilter.value = "filter"; // NEW
    categoryFilter.dispatchEvent(new ui.lastDialog.ownerDocument.defaultView.Event("change")); // NEW
    assert.deepEqual(selectValues(ui.lastDialog.querySelector(".trellis-irrigation-catalog-broad-filter")), ["", "control_protection"]); // NEW
    ui.lastDialog.querySelector(".trellis-irrigation-catalog-category-filter").value = ""; // NEW
    ui.lastDialog.querySelector(".trellis-irrigation-catalog-category-filter").dispatchEvent(new ui.lastDialog.ownerDocument.defaultView.Event("change")); // NEW
    ui.lastDialog.querySelector(".trellis-irrigation-catalog-broad-filter").value = "fittings_adapters"; // NEW
    ui.lastDialog.querySelector(".trellis-irrigation-catalog-broad-filter").dispatchEvent(new ui.lastDialog.ownerDocument.defaultView.Event("change")); // NEW
    const filteredCategoryOptions = Array.from(ui.lastDialog.querySelector(".trellis-irrigation-catalog-category-filter").options).map(option => option.value); // NEW
    assert.deepEqual(filteredCategoryOptions, ["", "fitting"]); // CHANGE
    assert.equal(ui.lastDialog.querySelector(".trellis-irrigation-catalog-category-filter").value, ""); // NEW
    assert.deepEqual(selectValues(ui.lastDialog.querySelector(".trellis-irrigation-catalog-connector-type-filter")).sort(), ["", "barb", "fght", "fpt", "mpt"].sort()); // NEW
    ui.lastDialog.querySelector(".trellis-irrigation-catalog-broad-filter").value = ""; // NEW
    ui.lastDialog.querySelector(".trellis-irrigation-catalog-broad-filter").dispatchEvent(new ui.lastDialog.ownerDocument.defaultView.Event("change")); // NEW
    assert.match(ui.lastDialog.textContent, /3 total/);
    ui.lastDialog.querySelector(".trellis-irrigation-catalog-connection-filter").value = "3"; // CHANGE
    ui.lastDialog.querySelector(".trellis-irrigation-catalog-connection-filter").dispatchEvent(new ui.lastDialog.ownerDocument.defaultView.Event("change")); // CHANGE
    assert.ok(ui.lastDialog.querySelector("[data-part-id='valve']"));
    assert.equal(ui.lastDialog.querySelector("[data-part-id='filter']"), null);
    const selects = Array.from(ui.lastDialog.querySelectorAll(".trellis-irrigation-catalog-form select"));
    assert.ok(selects.some(select => Array.from(select.options).some(option => option.value === "mght")));
    assert.ok(selects.some(select => Array.from(select.options).some(option => option.value === "fght")));
    assert.ok(selects.some(select => Array.from(select.options).some(option => option.value === "3/4")));
    assert.ok(selects.some(select => Array.from(select.options).some(option => option.value === "barb" && option.textContent === "barb")));
    assert.equal(selects.some(select => Array.from(select.options).some(option => option.value === "pipe")), false);
    assert.doesNotMatch(ui.lastDialog.textContent, /\bID\b/);
    assert.doesNotMatch(ui.lastDialog.textContent, /Method/);
    assert.doesNotMatch(ui.lastDialog.textContent, /uses pipe/i);
    assert.doesNotMatch(ui.lastDialog.textContent, /Hazen-Williams/);
    assert.doesNotMatch(ui.lastDialog.textContent, /Pipe inner diameter/);
    ui.lastDialog.querySelector(".trellis-irrigation-catalog-connection-filter").value = "";
    ui.lastDialog.querySelector(".trellis-irrigation-catalog-connection-filter").dispatchEvent(new ui.lastDialog.ownerDocument.defaultView.Event("change"));
    ui.lastDialog.querySelector("[data-part-id='pipe_cheap']").click();
    assert.match(ui.lastDialog.textContent, /Unit cost per ft/);
    assert.match(ui.lastDialog.textContent, /Pipe size/);
    assert.match(ui.lastDialog.textContent, /Pipe inner diameter/);
    assert.doesNotMatch(ui.lastDialog.textContent, /Input type/);
    assert.doesNotMatch(ui.lastDialog.textContent, /Output type/);
    assert.doesNotMatch(ui.lastDialog.textContent, /Inputs/);
    assert.doesNotMatch(ui.lastDialog.textContent, /uses pipe/i);
    const formCategory = Array.from(ui.lastDialog.querySelectorAll(".trellis-irrigation-catalog-form label")).find(label => label.textContent.startsWith("Category")).querySelector("select");
    formCategory.value = "fitting";
    formCategory.dispatchEvent(new ui.lastDialog.ownerDocument.defaultView.Event("change"));
    assert.doesNotMatch(ui.lastDialog.textContent, /Unit cost per ft/);
    assert.doesNotMatch(ui.lastDialog.textContent, /Pipe inner diameter/);
    clickButton(ui.lastDialog, "Save Part");
    const changed = api.readCatalog(moduleCell).items.find(item => item.id === "pipe_cheap");
    assert.equal(changed.category, "fitting");
    assert.equal(changed.unitCost, null);
    assert.equal(changed.specs.innerDiameterIn, null);
});

test("catalog manager row selection updates the editor without replacing the scrolled list", () => { // NEW
    const { api, moduleCell, ui } = loadPlugin(); // NEW
    api.writeCatalog(moduleCell, sampleCatalog()); // NEW
    api.openCatalogManager(moduleCell); // NEW
    const tableWrap = ui.lastDialog.querySelector(".trellis-irrigation-catalog-table-wrap"); // NEW
    const initialSelectedRow = Array.from(tableWrap.querySelectorAll("tr[data-part-id]")).find(row => row.style.background); // NEW
    const targetRow = Array.from(tableWrap.querySelectorAll("tr[data-part-id]")).find(row => row !== initialSelectedRow); // NEW
    assert.ok(targetRow, "expected a non-selected catalog row to click"); // NEW
    const targetName = targetRow.children[0].textContent.trim(); // NEW
    tableWrap.scrollTop = 73; // NEW
    targetRow.click(); // NEW
    const nextTableWrap = ui.lastDialog.querySelector(".trellis-irrigation-catalog-table-wrap"); // NEW
    assert.equal(nextTableWrap, tableWrap); // NEW
    assert.equal(nextTableWrap.scrollTop, 73); // NEW
    assert.equal(Array.from(ui.lastDialog.querySelectorAll(".trellis-irrigation-catalog-form label")).find(label => label.textContent.startsWith("Name")).querySelector("input").value, targetName); // NEW
    assert.ok(targetRow.style.background, "clicked row should show selected styling"); // NEW
    if (initialSelectedRow) assert.equal(initialSelectedRow.style.background, ""); // NEW
}); // NEW

test("catalog and add-part lists keep current grouping depth but use logical flow order", () => { // NEW
    const { api, moduleCell, ui } = loadPlugin(); // NEW
    const catalog = sampleCatalog(); // NEW
    catalog.items.push(part("source_adapter", "Source adapter", "source_adapter", "in_stock", 5, 1, 1, "fght", "3/4", "mpt", "3/4", { pressureLossPsi: 0.1 })); // NEW
    catalog.items.push(part("timer", "Timer", "controller_timer", "in_stock", 30, 1, 1, "barb", "3/4", "barb", "3/4", { pressureLossPsi: 1 }, undefined, true)); // NEW
    catalog.items.push(part("endcap", "End cap", "cap_end", "in_stock", 1, 1, 0, "barb", "1/2", "", "", { pressureLossPsi: 0 }, undefined, true)); // NEW
    api.writeCatalog(moduleCell, catalog); // NEW
    api.openCatalogManager(moduleCell); // NEW
    const groups = Array.from(ui.lastDialog.querySelectorAll(".trellis-irrigation-catalog-group")).map(row => row.textContent); // NEW
    ["Source adapters / 3/4", "Filters / 3/4", "Timers / 3/4", "Fittings / 3/4", "End caps / 1/2", "Pipe/tubing / 1/2", "Drip tape / 3/4"].forEach(label => assert.ok(groups.includes(label), "missing group " + label)); // NEW
    assert.ok(groups.indexOf("Source adapters / 3/4") < groups.indexOf("Filters / 3/4")); // NEW
    assert.ok(groups.indexOf("Filters / 3/4") < groups.indexOf("Timers / 3/4")); // NEW
    assert.ok(groups.indexOf("Timers / 3/4") < groups.indexOf("Fittings / 3/4")); // NEW
    assert.ok(groups.indexOf("Fittings / 3/4") < groups.indexOf("End caps / 1/2")); // NEW
    assert.ok(groups.indexOf("End caps / 1/2") < groups.indexOf("Pipe/tubing / 1/2")); // NEW
    const sortedIds = api.__test.sortAddPartPickerParts(catalog.items).map(item => item.id); // NEW
    assert.ok(sortedIds.indexOf("source_adapter") < sortedIds.indexOf("filter")); // NEW
    assert.ok(sortedIds.indexOf("timer") < sortedIds.indexOf("fght_to_mpt")); // NEW
    assert.ok(sortedIds.indexOf("endcap") < sortedIds.indexOf("pipe_half")); // NEW
}); // NEW

test("catalog manager filters are faceted by other active filters", () => { // NEW
    const { api, moduleCell, ui } = loadPlugin(); // NEW
    api.writeCatalog(moduleCell, sampleCatalog()); // NEW
    api.openCatalogManager(moduleCell); // NEW
    ui.lastDialog.querySelector(".trellis-irrigation-catalog-size-filter").value = "1/2"; // NEW
    ui.lastDialog.querySelector(".trellis-irrigation-catalog-size-filter").dispatchEvent(new ui.lastDialog.ownerDocument.defaultView.Event("change")); // NEW
    assert.deepEqual(selectValues(ui.lastDialog.querySelector(".trellis-irrigation-catalog-category-filter")), ["", "pipe_tubing"]); // NEW
    assert.deepEqual(selectValues(ui.lastDialog.querySelector(".trellis-irrigation-catalog-connection-filter")), ["", "2"]); // NEW
    assert.deepEqual(selectValues(ui.lastDialog.querySelector(".trellis-irrigation-catalog-connector-type-filter")), ["", "barb"]); // NEW
    ui.lastDialog.querySelector(".trellis-irrigation-catalog-connector-type-filter").value = "barb"; // NEW
    ui.lastDialog.querySelector(".trellis-irrigation-catalog-connector-type-filter").dispatchEvent(new ui.lastDialog.ownerDocument.defaultView.Event("change")); // NEW
    assert.ok(ui.lastDialog.querySelector("[data-part-id='pipe_half']")); // NEW
    assert.equal(ui.lastDialog.querySelector("[data-part-id='fght_to_mpt']"), null); // NEW
}); // NEW

test("catalog manager contextual filters respect selected catalogue scope", () => { // NEW
    const { api, graph, moduleCell, ui } = loadPlugin(); // NEW
    const catalog = sampleCatalog(); // NEW
    api.writeCatalog(moduleCell, catalog); // NEW
    const selected = api.__test.createPartAssembly(moduleCell, catalog.items.find(item => item.id === "filter"), { x: 30, y: 40 }); // NEW
    graph.setSelectionCell(selected.assembly); // NEW
    api.openCatalogManager(moduleCell); // NEW
    assert.ok(ui.lastDialog.querySelector(".trellis-irrigation-catalog-show-all")); // NEW
    assert.deepEqual(selectValues(ui.lastDialog.querySelector(".trellis-irrigation-catalog-category-filter")), ["", "filter"]); // NEW
    assert.deepEqual(selectValues(ui.lastDialog.querySelector(".trellis-irrigation-catalog-size-filter")), ["", "3/4"]); // NEW
    assert.deepEqual(selectValues(ui.lastDialog.querySelector(".trellis-irrigation-catalog-connection-filter")), ["", "2"]); // NEW
    assert.ok(ui.lastDialog.querySelector("[data-part-id='filter']")); // NEW
    assert.equal(ui.lastDialog.querySelector("[data-part-id='valve']"), null); // NEW
}); // NEW

test("catalog manager compact view hides detail columns and persists per module user", () => { // NEW
    const { api, graph, moduleCell, ui } = loadPlugin({ currentUser: { id: "user_a", name: "User A" } }); // NEW
    api.writeCatalog(moduleCell, sampleCatalog()); // NEW
    api.openCatalogManager(moduleCell); // NEW
    assert.deepEqual(ui.lastDialogSize, { width: 1280, height: 760 }); // NEW
    assert.equal(ui.lastDialog.style.width, "1240px"); // NEW
    assert.deepEqual(catalogHeaderLabels(ui.lastDialog), ["Name", "Broad", "Category", "Size", "Connections", "Stock", "Price", "Status"]); // CHANGE
    assertTableHeadersLeftAligned(ui.lastDialog, ".trellis-irrigation-catalog-table", "4px", "full"); // NEW
    const fullFilterPrice = ui.lastDialog.querySelector("[data-part-id='filter'] .trellis-irrigation-catalog-price-input"); // CHANGE
    assert.equal(fullFilterPrice.value, "20"); // CHANGE
    assert.doesNotMatch(fullFilterPrice.parentNode.textContent, /\/ea/); // CHANGE
    const fullPipePrice = ui.lastDialog.querySelector("[data-part-id='pipe_cheap'] .trellis-irrigation-catalog-price-input"); // CHANGE
    assert.match(fullPipePrice.value, /^(0\.25|0\.82)$/); // CHANGE
    assert.match(fullPipePrice.parentNode.textContent, /\/(?:ft|m)/); // CHANGE
    const responsiveStyles = ui.lastDialog.ownerDocument.getElementById("trellis-irrigation-catalog-responsive-styles").textContent; // NEW
    assert.match(responsiveStyles, /\.trellis-irrigation-catalog-layout\{display:grid;grid-template-columns:minmax\(620px,1\.08fr\) minmax\(560px,0\.92fr\)/); // NEW
    const compact = ui.lastDialog.querySelector(".trellis-irrigation-catalog-compact-view"); // NEW
    compact.checked = true; // NEW
    compact.dispatchEvent(new ui.lastDialog.ownerDocument.defaultView.Event("change")); // NEW
    assert.equal(ui.dialog.container.style.width, "1080px"); // NEW
    assert.equal(ui.dialog.container.style.height, "780px"); // NEW
    assert.equal(ui.lastDialog.style.width, "980px"); // NEW
    assert.equal(ui.lastDialog.classList.contains("compact"), true); // NEW
    const compactStyleNode = ui.lastDialog.ownerDocument.getElementById("trellis-irrigation-catalog-responsive-styles"); // CHANGE
    const compactRules = Array.from(compactStyleNode.sheet.cssRules).filter(rule => rule.selectorText); // CHANGE
    const compactLayoutRule = compactRules.find(rule => rule.selectorText === ".trellis-irrigation-catalog-manager.compact .trellis-irrigation-catalog-layout"); // NEW
    assert.ok(compactLayoutRule, "compact layout rule should be parsed"); // NEW
    assert.equal(compactLayoutRule.style.getPropertyValue("grid-template-columns"), "1fr"); // NEW
    const compactTableWrapRule = compactRules.find(rule => rule.selectorText === ".trellis-irrigation-catalog-manager.compact .trellis-irrigation-catalog-table-wrap"); // NEW
    assert.ok(compactTableWrapRule, "compact table clamp rule should be parsed"); // NEW
    assert.equal(compactTableWrapRule.style.getPropertyValue("max-height"), "var(--trellis-irrigation-catalog-list-max-height,240px)"); // NEW
    assert.equal(compactTableWrapRule.style.getPropertyValue("overflow"), "auto"); // NEW
    assert.equal(compactRules.some(rule => /minmax\(360px,380px\) minmax\(560px,1fr\)/.test(rule.cssText)), false); // CHANGE
    assert.equal(ui.lastDialog.style.getPropertyValue("--trellis-irrigation-catalog-list-max-height"), "240px"); // NEW
    const compactLayout = ui.lastDialog.querySelector(".trellis-irrigation-catalog-layout"); // NEW
    assert.equal(compactLayout.children[0].className, "trellis-irrigation-catalog-table-wrap"); // NEW
    assert.equal(compactLayout.children[1].className, "trellis-irrigation-catalog-form"); // NEW
    assert.deepEqual(catalogHeaderLabels(ui.lastDialog), ["Name", "Stock", "Price"]); // CHANGE
    assertTableHeadersLeftAligned(ui.lastDialog, ".trellis-irrigation-catalog-table", "4px", "full"); // NEW
    assert.equal(ui.lastDialog.querySelector("[data-part-id='filter'] .trellis-irrigation-catalog-price-input").value, "20"); // CHANGE
    const compactPipePrice = ui.lastDialog.querySelector("[data-part-id='pipe_cheap'] .trellis-irrigation-catalog-price-input"); // CHANGE
    assert.match(compactPipePrice.value, /^(0\.25|0\.82)$/); // CHANGE
    assert.match(compactPipePrice.parentNode.textContent, /\/(?:ft|m)/); // CHANGE
    assert.equal(ui.lastDialog.querySelector(".trellis-irrigation-catalog-group td").getAttribute("colspan"), "3"); // CHANGE
    assert.match(graph.container.ownerDocument.defaultView.localStorage.getItem("trellis.irrigation.catalogManager.compactView.v1"), /"user_a:module":true/); // NEW
    api.openCatalogManager(moduleCell); // NEW
    assert.deepEqual(ui.lastDialogSize, { width: 1020, height: 720 }); // NEW
    assert.equal(ui.lastDialog.querySelector(".trellis-irrigation-catalog-compact-view").checked, true); // NEW
    assert.deepEqual(catalogHeaderLabels(ui.lastDialog), ["Name", "Stock", "Price"]); // CHANGE
}); // NEW

test("catalog manager inline on hand edits stock without selecting the row", () => { // NEW
    const { api, moduleCell, ui } = loadPlugin(); // NEW
    const catalog = sampleCatalog(); // NEW
    catalog.items.find(item => item.id === "filter").stockQuantity = 1; // NEW
    catalog.items.find(item => item.id === "valve").stockQuantity = 2; // NEW
    api.writeCatalog(moduleCell, catalog); // NEW
    api.openCatalogManager(moduleCell); // NEW
    ui.lastDialog.querySelector("[data-part-id='valve']").click(); // NEW
    assert.equal(Array.from(ui.lastDialog.querySelectorAll(".trellis-irrigation-catalog-form label")).find(label => label.textContent.startsWith("Name")).querySelector("input").value, "Valve"); // NEW
    const filterInput = ui.lastDialog.querySelector("[data-part-id='filter'] .trellis-irrigation-catalog-on-hand-input"); // NEW
    assert.doesNotMatch(filterInput.parentNode.textContent, /\bea\b/); // NEW
    const pipeInput = ui.lastDialog.querySelector("[data-part-id='pipe_cheap'] .trellis-irrigation-catalog-on-hand-input"); // NEW
    assert.match(pipeInput.parentNode.textContent, /\bft\b|\bm\b/); // NEW
    filterInput.click(); // NEW
    assert.equal(Array.from(ui.lastDialog.querySelectorAll(".trellis-irrigation-catalog-form label")).find(label => label.textContent.startsWith("Name")).querySelector("input").value, "Valve"); // NEW
    filterInput.value = "4"; // NEW
    filterInput.dispatchEvent(new ui.lastDialog.ownerDocument.defaultView.Event("blur")); // NEW
    let changed = api.readCatalog(moduleCell).items.find(item => item.id === "filter"); // NEW
    assert.equal(changed.stockQuantity, 4); // NEW
    assert.equal(changed.stockState, "in_stock"); // NEW
    const valveInput = ui.lastDialog.querySelector("[data-part-id='valve'] .trellis-irrigation-catalog-on-hand-input"); // NEW
    valveInput.value = "0"; // NEW
    valveInput.dispatchEvent(new ui.lastDialog.ownerDocument.defaultView.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })); // NEW
    changed = api.readCatalog(moduleCell).items.find(item => item.id === "valve"); // NEW
    assert.equal(changed.stockQuantity, 0); // NEW
    assert.equal(changed.stockState, "out_of_stock"); // NEW
    const regulatorInput = ui.lastDialog.querySelector("[data-part-id='regulator'] .trellis-irrigation-catalog-on-hand-input"); // NEW
    regulatorInput.value = "9"; // NEW
    regulatorInput.dispatchEvent(new ui.lastDialog.ownerDocument.defaultView.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); // NEW
    changed = api.readCatalog(moduleCell).items.find(item => item.id === "regulator"); // NEW
    assert.equal(changed.stockQuantity, 0); // NEW
}); // NEW

test("catalog manager inline price edits cost without selecting the row", () => { // NEW
    const { api, moduleCell, ui } = loadPlugin(); // NEW
    api.writeCatalog(moduleCell, sampleCatalog()); // NEW
    api.openCatalogManager(moduleCell); // NEW
    ui.lastDialog.querySelector("[data-part-id='valve']").click(); // NEW
    assert.equal(Array.from(ui.lastDialog.querySelectorAll(".trellis-irrigation-catalog-form label")).find(label => label.textContent.startsWith("Name")).querySelector("input").value, "Valve"); // NEW
    const filterPrice = ui.lastDialog.querySelector("[data-part-id='filter'] .trellis-irrigation-catalog-price-input"); // NEW
    filterPrice.click(); // NEW
    assert.equal(Array.from(ui.lastDialog.querySelectorAll(".trellis-irrigation-catalog-form label")).find(label => label.textContent.startsWith("Name")).querySelector("input").value, "Valve"); // NEW
    filterPrice.value = "22.5"; // NEW
    filterPrice.dispatchEvent(new ui.lastDialog.ownerDocument.defaultView.Event("blur")); // NEW
    let changed = api.readCatalog(moduleCell).items.find(item => item.id === "filter"); // NEW
    assert.equal(changed.cost, 22.5); // NEW
    const pipePrice = ui.lastDialog.querySelector("[data-part-id='pipe_cheap'] .trellis-irrigation-catalog-price-input"); // NEW
    const isMetricPrice = /\/m/.test(pipePrice.parentNode.textContent); // NEW
    pipePrice.value = "1"; // NEW
    pipePrice.dispatchEvent(new ui.lastDialog.ownerDocument.defaultView.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })); // NEW
    changed = api.readCatalog(moduleCell).items.find(item => item.id === "pipe_cheap"); // NEW
    assert.ok(Math.abs(changed.unitCost - (isMetricPrice ? 0.3048 : 1)) < 0.000001); // NEW
    const regulatorPrice = ui.lastDialog.querySelector("[data-part-id='regulator'] .trellis-irrigation-catalog-price-input"); // NEW
    regulatorPrice.value = "99"; // NEW
    regulatorPrice.dispatchEvent(new ui.lastDialog.ownerDocument.defaultView.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); // NEW
    changed = api.readCatalog(moduleCell).items.find(item => item.id === "regulator"); // NEW
    assert.equal(changed.cost, 18); // NEW
}); // NEW

test("BOM broad category filter narrows the category dropdown", () => { // NEW
    const { api, moduleCell, ui } = loadPlugin(); // NEW
    api.writeCatalog(moduleCell, addDripTapeBomParts(sampleCatalog())); // NEW
    const filter = api.__test.createPartAssembly(moduleCell, api.readCatalog(moduleCell).items.find(item => item.id === "filter"), { x: 30, y: 40 }); // NEW
    const fitting = api.__test.createPartAssembly(moduleCell, api.readCatalog(moduleCell).items.find(item => item.id === "fpt_to_half_barb"), { x: 30, y: 160 }); // NEW
    api.__test.createAssemblyConnection(moduleCell, { cellId: api.__test.firstAssemblyPart(filter.assembly).getId(), role: "output", index: 0 }, { cellId: api.__test.firstAssemblyPart(fitting.assembly).getId(), role: "input", index: 0 }); // NEW
    api.openBomDialog(moduleCell); // NEW
    const broadFilter = ui.lastDialog.querySelector(".trellis-irrigation-bom-broad-filter"); // NEW
    const categoryFilter = ui.lastDialog.querySelector(".trellis-irrigation-bom-category-filter"); // NEW
    assert.ok(Array.from(broadFilter.options).some(option => option.value === "fittings_adapters" && option.textContent === "Fittings & adapters")); // NEW
    categoryFilter.value = "filters"; // CHANGE
    categoryFilter.dispatchEvent(new ui.lastDialog.ownerDocument.defaultView.Event("change")); // NEW
    ui.lastDialog.querySelector(".trellis-irrigation-bom-broad-filter").value = "fittings_adapters"; // NEW
    ui.lastDialog.querySelector(".trellis-irrigation-bom-broad-filter").dispatchEvent(new ui.lastDialog.ownerDocument.defaultView.Event("change")); // NEW
    const filteredOptions = Array.from(ui.lastDialog.querySelector(".trellis-irrigation-bom-category-filter").options).map(option => option.value); // NEW
    assert.deepEqual(filteredOptions, ["", "change_size"]); // CHANGE
    assert.equal(ui.lastDialog.querySelector(".trellis-irrigation-bom-category-filter").value, ""); // NEW
    ui.lastDialog.querySelector(".trellis-irrigation-bom-category-filter").value = "change_size"; // NEW
    ui.lastDialog.querySelector(".trellis-irrigation-bom-category-filter").dispatchEvent(new ui.lastDialog.ownerDocument.defaultView.Event("change")); // NEW
    assert.deepEqual(bomDataRowTexts(ui.lastDialog).map(text => /FPT to 1\/2 barb/.test(text)), [true]); // NEW
}); // NEW

test("BOM rows sort by logical flow taxonomy without changing raw catalog categories", () => { // NEW
    const { api, moduleCell, document } = loadPlugin(); // NEW
    const catalog = { items: [ // NEW
        part("drip", "Drip tape line", "drip_tape", "in_stock", 0, 1, 1, "barb", "1/2", "barb", "1/2", { flowGpm: 1, operatingPressurePsi: 10 }, 0.4, true), // NEW
        part("timer", "Timer", "controller_timer", "in_stock", 30, 1, 1, "barb", "3/4", "barb", "3/4", { pressureLossPsi: 1 }, undefined, true), // NEW
        part("endcap", "End cap", "cap_end", "in_stock", 1, 1, 0, "barb", "1/2", "", "", { pressureLossPsi: 0 }, undefined, true), // NEW
        part("source_adapter", "Source adapter", "source_adapter", "in_stock", 5, 1, 1, "fght", "3/4", "mpt", "3/4", { pressureLossPsi: 0.1 }), // NEW
        part("reducer", "Reducer", "fitting", "in_stock", 3, 1, 1, "barb", "3/4", "barb", "1/2", { pressureLossPsi: 0.2 }, undefined, true), // NEW
        part("sprinkler", "Sprinkler", "sprinkler", "in_stock", 6, 1, 1, "barb", "1/2", "barb", "1/2", { flowGpm: 1, operatingPressurePsi: 30 }, undefined, true), // NEW
        part("filter", "Filter", "filter", "in_stock", 10, 1, 1, "barb", "3/4", "barb", "3/4", { pressureLossPsi: 1 }, undefined, true), // NEW
        part("pipe", "Pipe", "pipe_tubing", "in_stock", 0, 1, 1, "barb", "3/4", "barb", "3/4", { innerDiameterIn: 0.824 }, 0.5, true), // NEW
        part("coupler", "Coupler", "fitting", "in_stock", 2, 1, 1, "barb", "1/2", "barb", "1/2", { pressureLossPsi: 0.1 }, undefined, true) // NEW
    ] }; // NEW
    const partCells = catalog.items.filter(item => item.id !== "pipe").map(item => makeXmlCell(document, "bom_" + item.id, { [api.attrs.CATALOG_PART_ID]: item.id })); // NEW
    const rows = api.__test.buildBomRows(moduleCell, { catalog, components: [{ cells: partCells, pipeSegments: [{ pipePartId: "pipe", lengthFt: 12, partState: api.__test.partStates.planned }] }] }).rows; // NEW
    assert.deepEqual(Array.from(rows, row => row.partId), ["source_adapter", "filter", "timer", "coupler", "reducer", "endcap", "pipe", "drip", "sprinkler"]); // CHANGE
    assert.deepEqual(Array.from(rows, row => api.__test.partDisplayCategory(row.part).logicalLabel), ["Source adapters", "Filters", "Timers", "Fittings", "Change size", "End caps", "Pipe/tubing", "Drip tape", "Sprinklers"]); // CHANGE
    assert.equal(catalog.items.find(item => item.id === "reducer").category, "fitting"); // NEW
    const csv = api.__test.buildBomCsv(moduleCell, rows); // NEW
    assert.match(csv, /Source adapter,Source & supply,Source adapters/); // NEW
    assert.match(csv, /Reducer,Fittings & adapters,Change size/); // NEW
    assert.doesNotMatch(csv, /source_adapter|controller_timer|cap_end|pipe_tubing/); // NEW
}); // NEW

test("BOM renders broad section headers and useful fitting subheaders for planned and completed rows", () => { // NEW
    const { api, moduleCell, ui, filterPart, bedAssembly, pipeEdges } = createLifecycleBomFixture(); // NEW
    const fittingPartCells = ["barb_tee_1_2", "fpt_to_half_barb", "end_cap_1_2_barb"].map(function (partId, index) { // NEW
        return api.__test.firstAssemblyPart(api.__test.createPartAssembly(moduleCell, api.readCatalog(moduleCell).items.find(item => item.id === partId), { x: 520, y: 40 + index * 80 }).assembly); // NEW
    }); // NEW
    api.openBomDialog(moduleCell); // NEW
    const plannedGroups = bomGroupTexts(ui.lastDialog); // NEW
    assert.deepEqual(plannedGroups, ["Control & protection", "Fittings & adapters", "Fittings", "Change size", "End caps", "Distribution", "Water application"]); // NEW
    assert.equal(plannedGroups.includes("Filters"), false); // NEW
    api.__test.setPartCellState(filterPart, api.__test.partStates.completed); // NEW
    fittingPartCells.forEach(cell => api.__test.setPartCellState(cell, api.__test.partStates.completed)); // NEW
    pipeEdges.forEach(edge => api.__test.setPipeEdgeState(edge, api.__test.partStates.completed)); // NEW
    api.__test.setBedTemplatePartState(moduleCell, bedAssembly, api.__test.partStates.completed); // NEW
    api.openBomDialog(moduleCell); // NEW
    assert.deepEqual(bomGroupTexts(ui.lastDialog, ".trellis-irrigation-bom-completed-table"), ["Control & protection", "Fittings & adapters", "Fittings", "Change size", "End caps", "Distribution", "Water application"]); // NEW
}); // NEW

test("BOM display and CSV hide each-count unit labels but keep length units", () => { // NEW
    const { api, moduleCell, ui, filterPart, bedAssembly, pipeEdges } = createLifecycleBomFixture(); // CHANGE
    const bom = api.__test.buildBomRows(moduleCell); // NEW
    const csv = api.__test.buildBomCsv(moduleCell, bom.rows); // NEW
    assert.equal(csv.split(/\r?\n/)[0], "Part,Broad category,Category,Size,Required,Stock,Price,Shortage,Total required,Purchase"); // CHANGE
    assert.doesNotMatch(csv, /\bea\b|\/ea/); // NEW
    assert.match(csv, /\bft\b|\bm\b/); // NEW
    api.openBomDialog(moduleCell); // NEW
    assert.deepEqual(bomHeaderLabels(ui.lastDialog), ["Part", "Category", "Size", "Required", "Stock", "Price", "Shortage", "Total planned", "Purchase", "Actions"]); // NEW
    assertTableHeadersLeftAligned(ui.lastDialog, ".trellis-irrigation-bom-table", "5px", "bottom"); // NEW
    const countRow = tableRowByText(ui.lastDialog, "1/2 lifecycle filter"); // NEW
    assert.equal(countRow.children[3].textContent, "1"); // CHANGE
    assert.equal(countRow.children[4].querySelector("input").value, "0"); // NEW
    assert.equal(countRow.children[5].querySelector("input").value, "20"); // CHANGE
    assert.equal(countRow.children[6].textContent, "1"); // NEW
    assert.doesNotMatch(countRow.textContent, /\bea\b|\/ea/); // NEW
    const linearRow = tableRowByText(ui.lastDialog, "8 mil drip tape"); // NEW
    assert.match(linearRow.children[3].textContent, /\bft\b|\bm\b/); // CHANGE
    assert.match(linearRow.children[5].textContent, /\/(?:ft|m)/); // CHANGE
    api.__test.setPartCellState(filterPart, api.__test.partStates.completed); // NEW
    api.__test.setPipeEdgeState(pipeEdges[0], api.__test.partStates.completed); // NEW
    api.__test.setBedTemplatePartState(moduleCell, bedAssembly, api.__test.partStates.completed); // NEW
    api.openBomDialog(moduleCell); // NEW
    assertTableHeadersLeftAligned(ui.lastDialog, ".trellis-irrigation-bom-completed-table", "5px", "bottom"); // NEW
    const completedCountRow = tableRowByText(ui.lastDialog, "1/2 lifecycle filter"); // NEW
    assert.equal(completedCountRow.children[3].textContent, "1"); // NEW
    assert.equal(completedCountRow.children[4].textContent, "$20"); // NEW
    assert.doesNotMatch(completedCountRow.textContent, /\bea\b|\/ea/); // NEW
    const completedLinearRow = tableRowByText(ui.lastDialog, "8 mil drip tape"); // NEW
    assert.match(completedLinearRow.children[3].textContent, /\bft\b|\bm\b/); // NEW
    assert.match(completedLinearRow.children[4].textContent, /\/(?:ft|m)/); // NEW
}); // NEW

test("BOM search filters in place without replacing the focused input", () => { // CHANGE
    const { api, moduleCell, document, ui, context } = createLifecycleBomFixture(); // CHANGE
    api.openBomDialog(moduleCell); // CHANGE
    if (!document.body.contains(ui.lastDialog)) document.body.appendChild(ui.lastDialog); // CHANGE: JSDOM only focuses mounted dialog controls
    const search = ui.lastDialog.querySelector(".trellis-irrigation-bom-search"); // CHANGE
    assert.ok(search, "missing BOM search input"); // CHANGE
    search.focus(); // CHANGE
    search.value = "lifecycle"; // CHANGE
    search.dispatchEvent(new ui.lastDialog.ownerDocument.defaultView.Event("input", { bubbles: true })); // CHANGE
    assert.equal(document.activeElement, search); // CHANGE
    assert.equal(ui.lastDialog.contains(search), true); // CHANGE
    assert.equal(ui.lastDialog.querySelector(".trellis-irrigation-bom-search"), search); // CHANGE
    const rowTexts = Array.from(ui.lastDialog.querySelectorAll(".trellis-irrigation-bom-table tbody tr")).filter(row => !row.classList.contains("trellis-irrigation-bom-group")).map(row => row.textContent); // CHANGE
    assert.equal(rowTexts.some(text => /1\/2 lifecycle filter/.test(text)), true); // CHANGE
    assert.equal(rowTexts.some(text => /8 mil drip tape/.test(text)), false); // CHANGE
    buttonByText(ui.lastDialog, "Export CSV").click(); // CHANGE
    assert.match(context.lastDownloadText, /1\/2 lifecycle filter/); // CHANGE
    assert.doesNotMatch(context.lastDownloadText, /8 mil drip tape/); // CHANGE
}); // CHANGE

test("BOM compact view hides detail and action columns and persists per module user", () => { // NEW
    const { api, graph, moduleCell, ui } = createLifecycleBomFixture({ currentUser: { id: "bom_user", name: "BOM User" } }); // NEW
    api.openBomDialog(moduleCell); // NEW
    assert.deepEqual(ui.lastDialogSize, { width: 980, height: 640 }); // NEW
    assert.equal(ui.lastDialog.style.width, "960px"); // NEW
    assert.equal(ui.lastDialog.classList.contains("compact"), false); // NEW
    assert.deepEqual(bomHeaderLabels(ui.lastDialog), ["Part", "Category", "Size", "Required", "Stock", "Price", "Shortage", "Total planned", "Purchase", "Actions"]); // NEW
    assertTableHeadersLeftAligned(ui.lastDialog, ".trellis-irrigation-bom-table", "5px", "bottom"); // NEW
    const fullRow = tableRowByText(ui.lastDialog, "1/2 lifecycle filter"); // NEW
    fullRow.children[4].querySelector("input").value = "2"; // NEW
    fullRow.children[4].querySelector("input").dispatchEvent(new ui.lastDialog.ownerDocument.defaultView.Event("input", { bubbles: true })); // NEW
    assert.equal(api.readCatalog(moduleCell).items.find(item => item.id === "filter_half_lifecycle").stockQuantity, 0); // NEW
    assert.equal(fullRow.children[9].querySelector("button").style.display, ""); // NEW
    const compact = ui.lastDialog.querySelector(".trellis-irrigation-bom-compact-view"); // NEW
    compact.checked = true; // NEW
    compact.dispatchEvent(new ui.lastDialog.ownerDocument.defaultView.Event("change")); // NEW
    assert.equal(ui.dialog.container.style.width, "960px"); // NEW
    assert.equal(ui.lastDialog.style.width, "860px"); // NEW
    assert.equal(ui.lastDialog.classList.contains("compact"), true); // NEW
    assert.deepEqual(bomHeaderLabels(ui.lastDialog), ["Part", "Required", "Stock", "Price", "Shortage", "Total planned", "Purchase"]); // NEW
    assertTableHeadersLeftAligned(ui.lastDialog, ".trellis-irrigation-bom-table", "5px", "bottom"); // NEW
    assert.equal(ui.lastDialog.querySelector(".trellis-irrigation-bom-group td").getAttribute("colspan"), "7"); // NEW
    assert.equal(buttonTexts(ui.lastDialog).includes("Save"), false); // NEW
    assert.equal(buttonTexts(ui.lastDialog).includes("Undo"), false); // NEW
    assert.match(graph.container.ownerDocument.defaultView.localStorage.getItem("trellis.irrigation.bomDialog.compactView.v1"), /"bom_user:module":true/); // NEW
    api.openBomDialog(moduleCell); // NEW
    assert.deepEqual(ui.lastDialogSize, { width: 900, height: 640 }); // NEW
    assert.equal(ui.lastDialog.querySelector(".trellis-irrigation-bom-compact-view").checked, true); // NEW
    assert.deepEqual(bomHeaderLabels(ui.lastDialog), ["Part", "Required", "Stock", "Price", "Shortage", "Total planned", "Purchase"]); // NEW
}); // NEW

test("BOM compact stock and price inputs commit on blur or Enter and cancel on Escape", () => { // NEW
    const { api, moduleCell, ui } = createLifecycleBomFixture(); // NEW
    api.openBomDialog(moduleCell); // NEW
    const compact = ui.lastDialog.querySelector(".trellis-irrigation-bom-compact-view"); // NEW
    compact.checked = true; // NEW
    compact.dispatchEvent(new ui.lastDialog.ownerDocument.defaultView.Event("change")); // NEW
    let filterStock = ui.lastDialog.querySelector("[data-part-id='filter_half_lifecycle'] .trellis-irrigation-bom-on-hand-input"); // NEW
    filterStock.value = "4"; // NEW
    filterStock.dispatchEvent(new ui.lastDialog.ownerDocument.defaultView.Event("blur")); // NEW
    let changed = api.readCatalog(moduleCell).items.find(item => item.id === "filter_half_lifecycle"); // NEW
    assert.equal(changed.stockQuantity, 4); // NEW
    assert.equal(changed.stockState, "in_stock"); // NEW
    filterStock = ui.lastDialog.querySelector("[data-part-id='filter_half_lifecycle'] .trellis-irrigation-bom-on-hand-input"); // NEW
    filterStock.value = "0"; // NEW
    filterStock.dispatchEvent(new ui.lastDialog.ownerDocument.defaultView.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })); // NEW
    changed = api.readCatalog(moduleCell).items.find(item => item.id === "filter_half_lifecycle"); // NEW
    assert.equal(changed.stockQuantity, 0); // NEW
    assert.equal(changed.stockState, "out_of_stock"); // NEW
    filterStock = ui.lastDialog.querySelector("[data-part-id='filter_half_lifecycle'] .trellis-irrigation-bom-on-hand-input"); // NEW
    filterStock.value = "9"; // NEW
    filterStock.dispatchEvent(new ui.lastDialog.ownerDocument.defaultView.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); // NEW
    changed = api.readCatalog(moduleCell).items.find(item => item.id === "filter_half_lifecycle"); // NEW
    assert.equal(changed.stockQuantity, 0); // NEW
    let filterPrice = ui.lastDialog.querySelector("[data-part-id='filter_half_lifecycle'] .trellis-irrigation-bom-price-input"); // NEW
    filterPrice.value = "22.5"; // NEW
    filterPrice.dispatchEvent(new ui.lastDialog.ownerDocument.defaultView.Event("blur")); // NEW
    changed = api.readCatalog(moduleCell).items.find(item => item.id === "filter_half_lifecycle"); // NEW
    assert.equal(changed.cost, 22.5); // NEW
    filterPrice = ui.lastDialog.querySelector("[data-part-id='filter_half_lifecycle'] .trellis-irrigation-bom-price-input"); // NEW
    filterPrice.value = "99"; // NEW
    filterPrice.dispatchEvent(new ui.lastDialog.ownerDocument.defaultView.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); // NEW
    changed = api.readCatalog(moduleCell).items.find(item => item.id === "filter_half_lifecycle"); // NEW
    assert.equal(changed.cost, 22.5); // NEW
    const linearPrice = ui.lastDialog.querySelector("[data-part-id='drip_tape_8mil_12in'] .trellis-irrigation-bom-price-input"); // NEW
    const isMetricPrice = /\/m/.test(linearPrice.parentNode.textContent); // NEW
    linearPrice.value = "1"; // NEW
    linearPrice.dispatchEvent(new ui.lastDialog.ownerDocument.defaultView.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })); // NEW
    changed = api.readCatalog(moduleCell).items.find(item => item.id === "drip_tape_8mil_12in"); // NEW
    assert.ok(Math.abs(changed.unitCost - (isMetricPrice ? 0.3048 : 1)) < 0.000001); // NEW
}); // NEW

test("catalog manager opens scoped to a selected inner part cell and can show all parts", () => {
    const { api, graph, moduleCell, ui } = loadPlugin();
    const catalog = sampleCatalog();
    api.writeCatalog(moduleCell, catalog);
    const selected = api.__test.createPartAssembly(moduleCell, catalog.items.find(item => item.id === "filter"), { x: 30, y: 40 });
    graph.setSelectionCell(selected.partCell);
    api.openCatalogManager(moduleCell);
    assert.ok(ui.lastDialog.querySelector("[data-part-id='filter']"));
    assert.equal(ui.lastDialog.querySelector("[data-part-id='regulator']"), null);
    const name = inputByLabel(ui.lastDialog, "Name");
    name.value = "Selected Filter";
    clickButton(ui.lastDialog, "Save Part");
    assert.equal(api.readCatalog(moduleCell).items.find(item => item.id === "filter").name, "Selected Filter");
    clickButton(ui.lastDialog, "Show All");
    assert.ok(ui.lastDialog.querySelector("[data-part-id='regulator']"));
});

test("catalog manager treats selected assembly containers as their child catalogue parts", () => {
    const { api, graph, moduleCell, ui } = loadPlugin();
    const catalog = sampleCatalog();
    api.writeCatalog(moduleCell, catalog);
    const filter = api.__test.createPartAssembly(moduleCell, catalog.items.find(item => item.id === "filter"), { x: 30, y: 40 });
    const regulator = api.__test.createPartAssembly(moduleCell, catalog.items.find(item => item.id === "regulator"), { x: 260, y: 40 });
    graph.setSelectionCells([filter.assembly, regulator.assembly]);
    api.openCatalogManager(moduleCell);
    assert.ok(ui.lastDialog.querySelector("[data-part-id='filter']"));
    assert.ok(ui.lastDialog.querySelector("[data-part-id='regulator']"));
    assert.equal(ui.lastDialog.querySelector("[data-part-id='valve']"), null);
});

test("catalog manager deduplicates selected diagram instances of the same catalogue part", () => {
    const { api, graph, moduleCell, ui } = loadPlugin();
    const catalog = sampleCatalog();
    api.writeCatalog(moduleCell, catalog);
    const first = api.__test.createPartAssembly(moduleCell, catalog.items.find(item => item.id === "filter"), { x: 30, y: 40 });
    const second = api.__test.createPartAssembly(moduleCell, catalog.items.find(item => item.id === "filter"), { x: 260, y: 40 });
    graph.setSelectionCells([first.partCell, second.partCell]);
    api.openCatalogManager(moduleCell);
    assert.equal(ui.lastDialog.querySelectorAll("[data-part-id='filter']").length, 1);
    assert.equal(ui.lastDialog.querySelector("[data-part-id='regulator']"), null);
});

test("catalog manager falls back to full catalog when selected part ids are missing", () => {
    const { api, graph, moduleCell, ui } = loadPlugin();
    const catalog = sampleCatalog();
    api.writeCatalog(moduleCell, catalog);
    const missing = api.__test.createPartAssembly(moduleCell, part("missing_part", "Missing part", "filter", "in_stock", 1, 1, 1, "barb", "3/4", "barb", "3/4"), { x: 30, y: 40 });
    graph.setSelectionCell(missing.partCell);
    api.openCatalogManager(moduleCell);
    assert.equal(ui.lastDialog.querySelector(".trellis-irrigation-catalog-show-all"), null);
    assert.ok(ui.lastDialog.querySelector("[data-part-id='filter']"));
    assert.ok(ui.lastDialog.querySelector("[data-part-id='regulator']"));
});

test("catalog manager opens scoped to a selected pipe edge part", () => {
    const { api, graph, moduleCell, ui } = loadPlugin();
    const catalog = sampleCatalog();
    api.writeCatalog(moduleCell, catalog);
    const source = api.__test.createSourceAssembly(moduleCell, "Well", { connectorType: "barb", nominalSize: "3/4", method: "drip", pipeConnection: true, usableFlowGpm: 5, staticPressurePsi: 45 }, { x: 30, y: 40 });
    const filter = api.__test.createPartAssembly(moduleCell, catalog.items.find(item => item.id === "filter"), { x: 30, y: 180 });
    const connection = api.__test.createAssemblyConnection(moduleCell, { cellId: api.__test.firstAssemblyPart(source.assembly).getId(), role: "output", index: 0 }, { cellId: api.__test.firstAssemblyPart(filter.assembly).getId(), role: "input", index: 0 });
    assert.equal(connection.ok, true, connection.reason);
    assert.equal(connection.edge.getAttribute(api.attrs.PIPE_PART_ID), "pipe_cheap");
    graph.setSelectionCell(connection.edge);
    api.openCatalogManager(moduleCell);
    assert.ok(ui.lastDialog.querySelector(".trellis-irrigation-catalog-show-all"));
    assert.ok(ui.lastDialog.querySelector("[data-part-id='pipe_cheap']"));
    assert.equal(ui.lastDialog.querySelector("[data-part-id='filter']"), null);
});

test("catalog manager ignores selected direct-link edges without pipe parts", () => {
    const { api, graph, moduleCell, ui } = loadPlugin();
    const catalog = { items: [
        part("direct_valve", "Direct Valve", "valve", "in_stock", 10, 1, 2, "fpt", "3/4", "mpt", "3/4", { maxFlowGpm: 8 }),
        part("direct_filter", "Direct Filter", "filter", "in_stock", 10, 1, 1, "fpt", "3/4", "mpt", "3/4", { pressureLossPsi: 1 })
    ] };
    api.writeCatalog(moduleCell, catalog);
    const valve = api.__test.createPartAssembly(moduleCell, catalog.items[0], { x: 30, y: 40 });
    const filter = api.__test.createPartAssembly(moduleCell, catalog.items[1], { x: 30, y: 180 });
    const connection = api.__test.createAssemblyConnection(moduleCell, { cellId: api.__test.firstAssemblyPart(valve.assembly).getId(), role: "output", index: 0 }, { cellId: api.__test.firstAssemblyPart(filter.assembly).getId(), role: "input", index: 0 });
    assert.equal(connection.ok, true, connection.reason);
    assert.equal(connection.edge.getAttribute(api.attrs.DIRECT_LINK_EDGE), "1");
    graph.setSelectionCell(connection.edge);
    api.openCatalogManager(moduleCell);
    assert.equal(ui.lastDialog.querySelector(".trellis-irrigation-catalog-show-all"), null);
    assert.ok(ui.lastDialog.querySelector("[data-part-id='direct_valve']"));
    assert.ok(ui.lastDialog.querySelector("[data-part-id='direct_filter']"));
});

test("catalog manager opens selected bed assemblies to saved BOM catalogue parts", () => {
    const { api, graph, moduleCell, bed, ui } = loadPlugin();
    const catalog = addDripTapeBomParts(sampleCatalog());
    api.writeCatalog(moduleCell, catalog);
    const bedAssembly = api.__test.createBedAssembly(moduleCell, bed, { x: 30, y: 220 });
    api.__test.commitBedTemplate(moduleCell, "bed_one", bed, {
        templateId: "drip_tape_bed",
        templateModel: "bom",
        inletPartId: "fpt_to_half_barb",
        outletPartId: "half_barb_to_3_4_barb",
        partIds: ["fpt_to_half_barb", "half_barb_to_3_4_barb"],
        requiredParts: [{ partId: "drip_tape_8mil_12in", quantityPerRowMeter: 1, quantityMeters: 3, unit: "m" }],
        anchorPartId: "drip_tape_8mil_12in",
        demand: { flowGpm: 1.2, operatingPressurePsi: 10 },
        spacing: { rows: 2, emitterInches: 12 }
    });
    graph.setSelectionCell(bedAssembly.assembly);
    api.openCatalogManager(moduleCell);
    assert.ok(ui.lastDialog.querySelector(".trellis-irrigation-catalog-show-all"));
    assert.ok(ui.lastDialog.querySelector("[data-part-id='fpt_to_half_barb']"));
    assert.ok(ui.lastDialog.querySelector("[data-part-id='half_barb_to_3_4_barb']"));
    assert.ok(ui.lastDialog.querySelector("[data-part-id='drip_tape_8mil_12in']"));
    assert.equal(ui.lastDialog.querySelectorAll("[data-part-id='drip_tape_8mil_12in']").length, 1);
    assert.equal(ui.lastDialog.querySelector("[data-part-id='filter']"), null);
});

test("catalog manager deduplicates bed assembly role template and pipe part ids", () => {
    const { api, graph, moduleCell, bed, ui } = loadPlugin();
    const catalog = addDripTapeBomParts(sampleCatalog());
    api.writeCatalog(moduleCell, catalog);
    const bedAssembly = api.__test.createBedAssembly(moduleCell, bed, { x: 30, y: 220 });
    bedAssembly.assembly.value.setAttribute(api.attrs.BED_TEMPLATE_JSON, JSON.stringify({
        inletPartId: "drip_tape_8mil_12in",
        partIds: ["drip_tape_8mil_12in"],
        requiredParts: [{ partId: "drip_tape_8mil_12in" }],
        anchorPartId: "drip_tape_8mil_12in",
        pipePartId: "drip_tape_8mil_12in"
    }));
    graph.setSelectionCell(bedAssembly.assembly);
    api.openCatalogManager(moduleCell);
    assert.equal(ui.lastDialog.querySelectorAll("[data-part-id='drip_tape_8mil_12in']").length, 1);
    assert.equal(ui.lastDialog.querySelector("[data-part-id='filter']"), null);
});

test("catalog manager falls back when selected bed assembly BOM parts are missing", () => {
    const { api, graph, moduleCell, bed, ui } = loadPlugin();
    api.writeCatalog(moduleCell, sampleCatalog());
    const bedAssembly = api.__test.createBedAssembly(moduleCell, bed, { x: 30, y: 220 });
    bedAssembly.assembly.value.setAttribute(api.attrs.BED_TEMPLATE_JSON, JSON.stringify({
        inletPartId: "missing_inlet",
        outletPartId: "missing_outlet",
        partIds: ["missing_inlet", "missing_outlet"],
        requiredParts: [{ partId: "missing_required" }],
        anchorPartId: "missing_required",
        pipePartId: "missing_pipe"
    }));
    graph.setSelectionCell(bedAssembly.assembly);
    api.openCatalogManager(moduleCell);
    assert.equal(ui.lastDialog.querySelector(".trellis-irrigation-catalog-show-all"), null);
    assert.ok(ui.lastDialog.querySelector("[data-part-id='filter']"));
    assert.ok(ui.lastDialog.querySelector("[data-part-id='regulator']"));
});

test("pipe catalog editor saves one shared size without rejecting old asymmetric pipe data", () => {
    const { api, moduleCell, ui } = loadPlugin();
    const legacyPipe = part("legacy_pipe", "Legacy asymmetric pipe", "pipe_tubing", "in_stock", 0, 2, 3, "twist_lock", "1/2", "push_connect", "3/4", { innerDiameterIn: 0.6, hazenWilliamsC: 150 }, 0.4, true);
    assert.equal(api.validateCatalogPart(legacyPipe).ok, true);
    api.writeCatalog(moduleCell, { items: [legacyPipe] });
    api.openCatalogManager(moduleCell);
    ui.lastDialog.querySelector("[data-part-id='legacy_pipe']").click();
    assert.match(ui.lastDialog.textContent, /Pipe size/);
    assert.doesNotMatch(ui.lastDialog.textContent, /Input type/);
    assert.doesNotMatch(ui.lastDialog.textContent, /Output type/);
    assert.doesNotMatch(ui.lastDialog.textContent, /uses pipe/i);
    const pipeSize = Array.from(ui.lastDialog.querySelectorAll(".trellis-irrigation-catalog-form label")).find(label => label.textContent.startsWith("Pipe size")).querySelector("select");
    pipeSize.value = "1";
    clickButton(ui.lastDialog, "Save Part");
    const saved = api.readCatalog(moduleCell).items.find(item => item.id === "legacy_pipe");
    assert.equal(saved.connectors.inputs, 1);
    assert.equal(saved.connectors.outputs, 1);
    assert.equal(saved.connectors.input.type, "twist_lock"); // CHANGE
    assert.equal(saved.connectors.output.type, "twist_lock"); // CHANGE
    assert.equal(saved.connectors.input.nominalSize, "1");
    assert.equal(saved.connectors.output.nominalSize, "1");
    assert.equal(saved.connectors.input.pipeConnection, true); // CHANGE
    assert.equal(saved.connectors.output.pipeConnection, true); // CHANGE
});

test("linear catalog specs derive flow from emitter source data and preserve legacy fallback", () => { // NEW
    const { api } = loadPlugin(); // NEW
    const tape = api.__test.normalizeCatalogPart(part("tape", "Tape", "drip_tape", "in_stock", 1, 1, 1, "barb", "1/2", "barb", "1/2", { emitterFlowGph: 0.8, emitterSpacingIn: 12, operatingPressurePsi: 10 }, 0.2, true)); // NEW
    const dripline = api.__test.normalizeCatalogPart(part("dripline", "Dripline", "dripline", "in_stock", 1, 1, 1, "barb", "1/2", "barb", "1/2", { emitterFlowGph: 0.9, emitterSpacingIn: 18, operatingPressurePsi: 12 }, 0.2, true)); // NEW
    const legacy = api.__test.normalizeCatalogPart(part("legacy", "Legacy", "dripline", "in_stock", 1, 1, 1, "barb", "1/2", "barb", "1/2", { flowGpmPerMeter: 0.8, operatingPressurePsi: 10 }, 0.2, true)); // NEW
    assert.ok(Math.abs(tape.specs.flowGpmPerFoot - 0.0133333333) < 0.000001); // NEW
    assert.ok(Math.abs(tape.specs.flowGpmPerMeter - 0.0437445319) < 0.000001); // NEW
    assert.ok(Math.abs(dripline.specs.flowGpmPerFoot - 0.01) < 0.000001); // NEW
    assert.ok(Math.abs(dripline.specs.flowGpmPerMeter - 0.032808399) < 0.000001); // NEW
    assert.equal(legacy.specs.flowGpmPerMeter, 0.8); // NEW
    assert.equal(legacy.specs.flowGpmPerFoot, null); // NEW
}); // NEW

test("linear catalog editor uses one size field and preserves pipe-style connector family", () => { // NEW
    const { api, moduleCell, ui } = loadPlugin(); // NEW
    const twistDrip = part("twist_drip", "Twist dripline", "dripline", "in_stock", 0, 1, 1, "twist_lock", "1/2", "twist_lock", "1/2", { emitterFlowGph: 0.8, emitterSpacingIn: 12, wettedWidthIn: 12, minOperatingPressurePsi: 10 }, 0.4, true); // NEW
    const pushTape = part("push_tape", "Push tape", "drip_tape", "in_stock", 0, 1, 1, "push_connect", "3/4", "push_connect", "3/4", { flowGpmPerMeter: 0.5, emitterSpacingIn: 12, minOperatingPressurePsi: 10 }, 0.4, true); // NEW
    api.writeCatalog(moduleCell, { items: [twistDrip, pushTape] }); // NEW
    api.openCatalogManager(moduleCell); // NEW
    ui.lastDialog.querySelector("[data-part-id='twist_drip']").click(); // NEW
    assert.match(ui.lastDialog.textContent, /Pipe size/); // NEW
    assert.match(ui.lastDialog.textContent, /Emitter flow gph/); // NEW
    assert.match(ui.lastDialog.textContent, /Wetted width in/); // NEW
    assert.doesNotMatch(ui.lastDialog.textContent, /Input type/); // NEW
    assert.doesNotMatch(ui.lastDialog.textContent, /Output type/); // NEW
    const size = catalogFormControl(ui.lastDialog, "Pipe size"); // NEW
    size.value = "3/4"; // NEW
    clickButton(ui.lastDialog, "Save Part"); // NEW
    let saved = api.readCatalog(moduleCell).items.find(item => item.id === "twist_drip"); // NEW
    assert.equal(saved.connectors.inputs, 1); // NEW
    assert.equal(saved.connectors.outputs, 1); // NEW
    assert.equal(saved.connectors.input.type, "twist_lock"); // NEW
    assert.equal(saved.connectors.output.type, "twist_lock"); // NEW
    assert.equal(saved.connectors.input.nominalSize, "3/4"); // NEW
    assert.equal(saved.connectors.output.nominalSize, "3/4"); // NEW
    ui.lastDialog.querySelector("[data-part-id='push_tape']").click(); // NEW
    clickButton(ui.lastDialog, "Save Part"); // NEW
    saved = api.readCatalog(moduleCell).items.find(item => item.id === "push_tape"); // NEW
    assert.equal(saved.connectors.input.type, "push_connect"); // NEW
    assert.equal(saved.connectors.output.type, "push_connect"); // NEW
}); // NEW

test("starter catalog includes 1 inch and 1/4 inch poly/barb irrigation components", () => {
    const { api } = loadPlugin();
    const catalog = api.starterCatalog();
    const ids = new Set(catalog.items.map(item => item.id));
    const byId = id => catalog.items.find(item => item.id === id);
    [
        "poly_mainline_1",
        "barb_tee_1",
        "barb_elbow_1",
        "barb_coupler_1",
        "end_cap_1_barb",
        "reducer_1_to_3_4_barb",
        "adapter_3_4_to_1_barb",
        "micro_tubing_1_4",
        "micro_tee_1_4",
        "micro_elbow_1_4",
        "micro_coupler_1_4",
        "micro_goof_plug_1_4",
        "transfer_barb_1_2_to_1_4",
        "adapter_1_4_to_1_2_barb",
        "micro_emitter_0_5_gph",
        "micro_emitter_1_0_gph",
        "micro_emitter_2_0_gph",
        "micro_spray_stake_1_4",
        "hose_splitter_2way_3_4_fght_mght",
        "hose_splitter_4way_3_4_fght_mght",
        "barb_tee_3_4_to_1_2",
        "twist_lock_coupler_1_4",
        "twist_lock_tee_1_2",
        "twist_lock_elbow_3_4",
        "twist_lock_end_cap_1",
        "twist_lock_adapter_1_4_to_1",
        "push_connect_coupler_1_4",
        "push_connect_tee_1_2",
        "push_connect_elbow_3_4",
        "push_connect_end_cap_1",
        "push_connect_adapter_1_to_1_4",
        "mpt_nipple_1_4",
        "fpt_coupler_1_2",
        "mpt_to_1_twist_lock_adapter",
        "fpt_to_1_4_push_connect_adapter" // CHANGE
    ].forEach(id => assert.ok(ids.has(id), "Missing starter part " + id));
    ["1_4", "1_2", "3_4", "1"].forEach(sizeId => {
        assert.ok(ids.has("mpt_nipple_" + sizeId), "Missing MPT nipple for " + sizeId);
        assert.ok(ids.has("fpt_coupler_" + sizeId), "Missing FPT coupler for " + sizeId);
        ["barb", "twist_lock", "push_connect"].forEach(family => {
            assert.ok(ids.has("mpt_to_" + sizeId + "_" + family + "_adapter"), "Missing MPT to " + family + " adapter for " + sizeId);
            assert.ok(ids.has("fpt_to_" + sizeId + "_" + family + "_adapter"), "Missing FPT to " + family + " adapter for " + sizeId);
            assert.equal(ids.has(family + "_to_" + sizeId + "_mpt_adapter"), false, "Reverse MPT adapter should be represented by flipped canonical part for " + sizeId); // CHANGE
            assert.equal(ids.has(family + "_to_" + sizeId + "_fpt_adapter"), false, "Reverse FPT adapter should be represented by flipped canonical part for " + sizeId); // CHANGE
        });
    });
    ["twist_lock_tubing_1_4", "twist_lock_tubing_1_2", "twist_lock_tubing_3_4", "twist_lock_tubing_1", "push_connect_tubing_1_4", "push_connect_tubing_1_2", "push_connect_tubing_3_4", "push_connect_tubing_1"].forEach(id => assert.equal(ids.has(id), false, "Removed family tubing should be absent: " + id));
    assert.equal(catalog.items.length, ids.size, "Starter catalog should not contain duplicate part IDs.");
    assert.equal(catalog.items.some(item => [item.connectors.input, item.connectors.output].some(connector => connector && connector.type === "ght")), false);
    assert.equal(catalog.items.some(item => /_(?:1_4|1_2|1)_.*ght|ght.*_(?:1_4|1_2|1)_/.test(item.id)), false, "GHT generated coverage should stay practical 3/4 only.");
    assert.equal(catalog.items.find(item => item.id === "hose_splitter_2way_3_4_fght_mght").connectors.outputs, 2);
    assert.equal(catalog.items.find(item => item.id === "hose_splitter_4way_3_4_fght_mght").connectors.outputs, 4);
    assert.equal(catalog.items.find(item => item.id === "twist_lock_adapter_1_4_to_1").connectors.input.type, "twist_lock");
    assert.equal(catalog.items.find(item => item.id === "push_connect_adapter_1_to_1_4").connectors.output.type, "push_connect");
    assert.equal(catalog.items.find(item => item.id === "twist_lock_coupler_1_2").connectors.input.pipeConnection, true);
    const starterNames = catalog.items.map(item => item.name); // NEW
    assert.equal(starterNames.some(name => /\bin\b/i.test(name)), false, "Starter names should use inch symbols instead of standalone in."); // NEW
    assert.equal(starterNames.some(name => /\s+to\s+/i.test(name)), false, "Starter names should use colon connector transitions."); // NEW
    assert.equal(starterNames.some(name => /\s+x\s+/i.test(name)), false, "Starter names should not use x connector transitions."); // NEW
    assert.equal(byId("fght_to_3_4_mpt_adapter").name, "3/4\" FGHT: MPT adapter"); // NEW
    assert.equal(byId("barb_tee_3_4_to_1_2").name, "3/4\": 1/2\" barb tee"); // CHANGE
    assert.equal(byId("reducer_3_4_to_1_2_barb").name, "3/4\": 1/2\" barb reducer"); // NEW
    assert.equal(byId("twist_lock_adapter_1_4_to_1").name, "1/4\": 1\" twist-lock adapter"); // NEW
    assert.equal(byId("drip_tape_8mil_12in").name, "8 mil drip tape, 12\" emitter spacing"); // NEW
    assert.equal(byId("mpt_to_1_2_push_connect_adapter").connectors.input.type, "mpt");
    assert.equal(byId("mpt_to_1_2_push_connect_adapter").connectors.output.pipeConnection, true);
    assert.equal(byId("fpt_to_1_2_push_connect_adapter").connectors.input.type, "fpt"); // CHANGE
    assert.equal(byId("fpt_to_1_2_push_connect_adapter").connectors.output.pipeConnection, true); // CHANGE
    assert.equal(catalog.items.some(item => item.id === "push_connect_tubing_3_4"), false);
    assert.equal(catalog.items.some(item => [item.connectors.input, item.connectors.output].some(connector => connector && connector.type === "pipe")), false);
    assert.equal(catalog.items.some(item => [item.connectors.input, item.connectors.output].some(connector => connector && connector.method)), false);
    assert.equal(catalog.items.find(item => item.id === "poly_mainline_1").specs.hazenWilliamsC, 150);
    assert.equal(catalog.items.find(item => item.id === "pc_dripline_1_2").specs.minOperatingPressurePsi, 12);
    assert.equal(catalog.items.find(item => item.id === "pc_dripline_1_2").specs.operatingPressurePsi, undefined);
    assert.ok(Math.abs(byId("drip_tape_8mil_12in").specs.flowGpmPerMeter - 0.0437445319) < 0.000001); // CHANGE
    assert.ok(Math.abs(byId("pc_dripline_1_2").specs.flowGpmPerMeter - 0.032808399) < 0.000001); // CHANGE
    assert.equal(byId("drip_tape_8mil_12in").specs.emitterFlowGph, 0.8); // NEW
    assert.equal(byId("drip_tape_8mil_12in").specs.wettedWidthIn, 12); // NEW
    assert.equal(byId("pc_dripline_1_2").specs.emitterFlowGph, 0.9); // NEW
    assert.equal(byId("pc_dripline_1_2").specs.wettedWidthIn, 12); // NEW
    assert.equal(byId("pc_dripline_1_2").specs.emitterSpacingIn, 18); // NEW
    assert.equal(byId("soaker_row_line_1_2").specs.wettedWidthIn, 18); // NEW
    assert.equal(byId("overhead_sprinkler_head_30psi").specs.throwRadiusFt, 8); // NEW
    assert.equal(byId("microspray_stake_20psi").specs.throwRadiusFt, 6); // NEW
    assert.equal(byId("micro_spray_stake_1_4").specs.throwRadiusFt, 4); // NEW
    assert.equal(byId("bubbler_emitter_1_2").specs.throwRadiusFt, 2); // NEW
    assert.equal(byId("micro_emitter_1_0_gph").specs.throwRadiusFt, 0.5); // NEW
    assert.equal(byId("drip_tape_8mil_12in").unitCost, 0.13); // NEW
    assert.equal(byId("poly_mainline_3_4").unitCost, 0.42); // NEW
    assert.equal(byId("poly_distribution_1_2").unitCost, 0.18); // NEW
    assert.equal(byId("filter_150_mesh_3_4_fpt").cost, 26); // NEW
    assert.equal(byId("filter_150_mesh_3_4_fpt").specs.pressureLossPsi, 3); // NEW
    assert.equal(byId("drip_regulator_25psi_3_4_fpt").specs.pressureLossPsi, 5); // NEW
    catalog.items.forEach(item => assert.equal(api.validateCatalogPart(item).ok, true, item.id));
});

test("Hazen-Williams pressure loss uses PSI over the pipe length", () => { // NEW
    const { api } = loadPlugin(); // NEW
    const loss = api.__test.hazenWilliamsPsiLoss({ lengthFt: 100, flowGpm: 8.5, diameterIn: 0.824, c: 150 }); // NEW
    assert.ok(Math.abs(loss - 5.699) < 0.01, "expected 3/4 in PE loss to be near published 6.6 psi/100 ft at max flow"); // NEW
}); // NEW

test("connector compatibility respects GHT and pipe-thread gender", () => {
    const { api } = loadPlugin();
    const c = type => ({ type, nominalSize: "3/4" });
    assert.equal(api.__test.shortCatalogPartName({ name: "3/4 in poly mainline tubing" }), "poly mainline tubing");
    assert.equal(api.__test.shortCatalogPartName({ name: "3/4\" poly mainline tubing" }), "poly mainline tubing"); // NEW
    assert.equal(api.__test.normalizeEndpointProfile({ connectorType: "twist" }).connectorType, "twist_lock");
    assert.equal(api.__test.normalizeEndpointProfile({ connectorType: "twist lock" }).connectorType, "twist_lock");
    assert.equal(api.__test.normalizeEndpointProfile({ connectorType: "push connect" }).connectorType, "push_connect");
    assert.equal(api.__test.normalizeEndpointProfile({ connectorType: "push-to-connect" }).connectorType, "push_connect");
    assert.equal(api.__test.ConnectorRules.isPipeConnectorType("barb"), true);
    assert.equal(api.__test.ConnectorRules.isPipeConnectorType("twist lock"), true);
    assert.equal(api.__test.ConnectorRules.isPipeConnectorType("push-to-connect"), true);
    assert.equal(api.__test.ConnectorRules.isPipeConnectorType("mght"), false);
    assert.equal(api.__test.connectorMatches(c("mght"), c("fght")).ok, true);
    assert.equal(api.__test.connectorMatches(c("fght"), c("mght")).ok, true);
    assert.equal(api.__test.connectorMatches(c("mpt"), c("fpt")).ok, true);
    assert.equal(api.__test.connectorMatches(c("fpt"), c("mpt")).ok, true);
    assert.equal(api.__test.connectorMatches(c("mght"), c("mght")).ok, false);
    assert.equal(api.__test.connectorMatches(c("fpt"), c("fpt")).ok, false);
    assert.equal(api.__test.connectorMatches(c("barb"), c("barb")).ok, false);
    assert.equal(api.__test.connectorMatches(c("ght"), c("ght")).ok, false);
    assert.equal(api.__test.connectorMatches(c("ght"), c("fght")).ok, false);
    assert.equal(api.__test.connectorMatches(c("mght"), c("ght")).ok, false);
    assert.equal(api.__test.connectorMatches(c("quick_connect"), c("quick_connect")).ok, false);
    assert.match(api.__test.connectorMatches(c("ght"), c("ght")).reason, /Gendered GHT/);
    assert.match(api.__test.connectorMatches(c("quick_connect"), c("quick_connect")).reason, /Gendered connector/);
    assert.equal(api.__test.connectorMatches(c("mght"), { type: "fght", nominalSize: "1/2" }).ok, false);
});

test("generated twist-lock and push-connect connectors infer pipe edges by size", () => {
    const { api, moduleCell } = loadPlugin();
    api.writeCatalog(moduleCell, api.starterCatalog());
    const catalog = api.readCatalog(moduleCell);
    const byId = id => catalog.items.find(item => item.id === id);
    assert.equal(byId("twist_lock_coupler_1_2").connectors.input.type, "twist_lock");
    assert.equal(byId("twist_lock_coupler_1_2").connectors.input.pipeConnection, true);
    assert.equal(byId("push_connect_coupler_3_4").connectors.input.type, "push_connect");
    assert.equal(byId("push_connect_coupler_3_4").connectors.input.pipeConnection, true);
    const twistSource = api.__test.createSourceAssembly(moduleCell, "Twist source", { connectorType: "twist_lock", nominalSize: "1/2", pipeConnection: true, usableFlowGpm: 4, staticPressurePsi: 35 }, { x: 30, y: 40 });
    const twistCoupler = api.__test.createPartAssembly(moduleCell, byId("twist_lock_coupler_1_2"), { x: 30, y: 180 });
    const twist = api.__test.createAssemblyConnection(moduleCell, { cellId: api.__test.firstAssemblyPart(twistSource.assembly).getId(), role: "output", index: 0 }, { cellId: api.__test.firstAssemblyPart(twistCoupler.assembly).getId(), role: "input", index: 0 });
    assert.equal(twist.ok, true, twist.reason);
    assert.equal(twist.edge.getAttribute(api.attrs.PIPE_PART_ID), "poly_distribution_1_2");
    const pushSource = api.__test.createSourceAssembly(moduleCell, "Push source", { connectorType: "push_connect", nominalSize: "3/4", pipeConnection: true, usableFlowGpm: 4, staticPressurePsi: 35 }, { x: 340, y: 40 });
    const pushCoupler = api.__test.createPartAssembly(moduleCell, byId("push_connect_coupler_3_4"), { x: 340, y: 180 });
    const push = api.__test.createAssemblyConnection(moduleCell, { cellId: api.__test.firstAssemblyPart(pushSource.assembly).getId(), role: "output", index: 0 }, { cellId: api.__test.firstAssemblyPart(pushCoupler.assembly).getId(), role: "input", index: 0 });
    assert.equal(push.ok, true, push.reason);
    assert.equal(push.edge.getAttribute(api.attrs.PIPE_PART_ID), "poly_mainline_3_4");
    const crossSource = api.__test.createSourceAssembly(moduleCell, "Cross source", { connectorType: "twist_lock", nominalSize: "3/4", pipeConnection: true, usableFlowGpm: 4, staticPressurePsi: 35 }, { x: 650, y: 40 });
    const crossTarget = api.__test.createPartAssembly(moduleCell, byId("push_connect_coupler_3_4"), { x: 650, y: 180 });
    const cross = api.__test.createAssemblyConnection(moduleCell, { cellId: api.__test.firstAssemblyPart(crossSource.assembly).getId(), role: "output", index: 0 }, { cellId: api.__test.firstAssemblyPart(crossTarget.assembly).getId(), role: "input", index: 0 });
    assert.equal(cross.ok, true, cross.reason);
    assert.equal(cross.edge.getAttribute(api.attrs.PIPE_PART_ID), "poly_mainline_3_4");
    const mismatchSource = api.__test.createSourceAssembly(moduleCell, "Mismatch source", { connectorType: "twist_lock", nominalSize: "3/4", pipeConnection: true, usableFlowGpm: 4, staticPressurePsi: 35 }, { x: 900, y: 40 });
    const mismatchTarget = api.__test.createPartAssembly(moduleCell, byId("push_connect_coupler_1_2"), { x: 900, y: 180 });
    const mismatch = api.__test.createAssemblyConnection(moduleCell, { cellId: api.__test.firstAssemblyPart(mismatchSource.assembly).getId(), role: "output", index: 0 }, { cellId: api.__test.firstAssemblyPart(mismatchTarget.assembly).getId(), role: "input", index: 0 });
    assert.equal(mismatch.ok, false);
    assert.match(mismatch.reason, /Pipe Edge size mismatch/);
});

test("hydraulics use minimum operating psi and warn over maximum operating psi", () => {
    const { api, model } = loadPlugin();
    const catalog = { items: [part("spray", "Spray", "sprinkler", "in_stock", 10, 1, 1, "barb", "1/2", "barb", "1/2", { flowGpm: 1, minOperatingPressurePsi: 10, maxOperatingPressurePsi: 20, pressureLossPsi: 0 }, undefined, true)] };
    const writesBeforeEstimate = model.valuesWritten;
    const result = api.__test.estimatePathHydraulics({ catalog, sourceProfile: { connectorType: "barb", nominalSize: "1/2", pipeConnection: true, usableFlowGpm: 2, staticPressurePsi: 45 }, bedDemand: { flowGpm: 1, operatingPressurePsi: 10 }, partIds: ["spray"], lengthFt: 0 });
    assert.equal(model.valuesWritten, writesBeforeEstimate);
    assert.equal(result.requiredPressurePsi, 10);
    assert.equal(result.maxOperatingPressurePsi, 20);
    assert.match(result.warnings.join("\n"), /maximum operating pressure/);
});

test("unit-cost line categories use route length when available", () => {
    const { api, moduleCell, bed, bed2 } = loadPlugin();
    const catalog = { items: [part("dripline_costed", "Costed dripline", "dripline", "in_stock", 50, 1, 1, "barb", "1/2", "barb", "1/2", { flowGpm: 1, minOperatingPressurePsi: 10 }, 2, true)] };
    const pathRecord = { sourceEndpointId: bed.getId(), targetEndpointId: bed2.getId() };
    const lengthFt = api.__test.pathRouteLengthFeet(moduleCell, pathRecord);
    assert.ok(lengthFt > 0);
    assert.equal(api.__test.partCostForReport(moduleCell, catalog, pathRecord, "dripline_costed"), 2 * lengthFt);
});

test("starter catalog upgrade merges new parts into existing catalogs without overwriting user edits", () => {
    const { api, moduleCell } = loadPlugin();
    api.writeCatalog(moduleCell, { items: [
        part("filter", "User Edited Filter", "filter", "in_stock", 99, 1, 1, "barb", "3/4", "barb", "3/4", { pressureLossPsi: 4 }),
        part("custom_micro", "Custom micro part", "fitting", "in_stock", 1, 1, 1, "barb", "1/4", "barb", "1/4", { pressureLossPsi: 0.1 }),
        part("twist_lock_tubing_custom", "Custom twist fitting with obsolete prefix", "fitting", "in_stock", 2, 1, 1, "twist_lock", "1/2", "twist_lock", "1/2", { pressureLossPsi: 0.1 }, undefined, true),
        part("twist_lock_tubing_1_2", "Obsolete twist tubing", "pipe_tubing", "in_stock", 0, 1, 1, "twist_lock", "1/2", "twist_lock", "1/2", { innerDiameterIn: 0.6 }, 0.4, true),
        part("push_connect_tubing_3_4", "Obsolete push tubing", "pipe_tubing", "in_stock", 0, 1, 1, "push_connect", "3/4", "push_connect", "3/4", { innerDiameterIn: 0.824 }, 0.5, true)
    ] });
    const stored = JSON.parse(moduleCell.getAttribute(api.attrs.CATALOG_JSON));
    stored.version = 1;
    moduleCell.value.setAttribute(api.attrs.CATALOG_JSON, JSON.stringify(stored));
    const upgraded = api.seedStarterCatalogIfEmpty(moduleCell);
    const filter = upgraded.items.find(item => item.id === "filter");
    assert.equal(upgraded.version, 4);
    assert.equal(filter.name, "User Edited Filter");
    assert.equal(filter.cost, 99);
    assert.ok(upgraded.items.some(item => item.id === "poly_mainline_1"));
    assert.ok(upgraded.items.some(item => item.id === "micro_tubing_1_4"));
    assert.ok(upgraded.items.some(item => item.id === "twist_lock_adapter_1_4_to_1"));
    assert.ok(upgraded.items.some(item => item.id === "push_connect_adapter_1_to_1_4"));
    assert.equal(upgraded.items.some(item => item.id === "mpt_to_1_2_twist_lock_adapter"), false);
    assert.ok(upgraded.items.some(item => item.id === "custom_micro"));
    assert.ok(upgraded.items.some(item => item.id === "twist_lock_tubing_custom"));
    assert.equal(upgraded.items.some(item => item.id === "twist_lock_tubing_1_2"), false);
    assert.equal(upgraded.items.some(item => item.id === "push_connect_tubing_3_4"), false);
});

test("fitting intent grouping infers granular buckets from existing part data", () => { // NEW
    const { api } = loadPlugin(); // NEW
    function groupName(candidate) { return api.__test.fittingIntentGroupForPart(candidate).label; } // NEW
    assert.equal(groupName(part("barb_coupler", "3/4 barb coupler", "fitting", "in_stock", 2, 1, 1, "barb", "3/4", "barb", "3/4", { pressureLossPsi: 0.1 }, undefined, true)), "Continue"); // NEW
    assert.equal(groupName(part("barb_elbow", "3/4 barb elbow", "fitting", "in_stock", 2, 1, 1, "barb", "3/4", "barb", "3/4", { pressureLossPsi: 0.1 }, undefined, true)), "Turn"); // NEW
    assert.equal(groupName(part("barb_tee", "3/4 barb tee", "fitting", "in_stock", 2, 1, 2, "barb", "3/4", "barb", "3/4", { pressureLossPsi: 0.1 }, undefined, true)), "Branch"); // NEW
    assert.equal(groupName(part("barb_plug", "3/4 barb plug", "fitting", "in_stock", 2, 1, 0, "barb", "3/4", "", "", { pressureLossPsi: 0.1 }, undefined, true)), "End line"); // NEW
    assert.equal(groupName(part("barb_reducer", "3/4 barb to 1/2 barb reducer", "fitting", "in_stock", 2, 1, 1, "barb", "3/4", "barb", "1/2", { pressureLossPsi: 0.1 }, undefined, true)), "Change size"); // NEW
    assert.equal(groupName(part("mpt_to_barb", "3/4 MPT to barb adapter", "fitting", "in_stock", 2, 1, 1, "mpt", "3/4", "barb", "3/4", { pressureLossPsi: 0.1 }, undefined, true)), "Thread adapters"); // NEW
    assert.equal(groupName(part("push_to_barb", "3/4 push-connect to barb adapter", "fitting", "in_stock", 2, 1, 1, "push_connect", "3/4", "barb", "3/4", { pressureLossPsi: 0.1 }, undefined, true)), "Connector adapters"); // NEW
    assert.equal(groupName(part("mystery", "Mystery fitting", "fitting", "in_stock", 2, 2, 1, "barb", "3/4", "barb", "3/4", { pressureLossPsi: 0.1 }, undefined, true)), "Other fittings"); // NEW
    assert.equal(api.__test.fittingIntentGroupForPart(part("source", "Source Adapter", "source_adapter", "in_stock", 2, 1, 1, "fght", "3/4", "mpt", "3/4")), null); // NEW
    assert.equal(api.__test.fittingSizePairGroupForPart(part("reduce", "3/4 barb to 1/2 barb", "fitting", "in_stock", 2, 1, 1, "barb", "3/4", "barb", "1/2", { pressureLossPsi: 0.1 }, undefined, true)).label, "1/2 <-> 3/4"); // NEW
    assert.equal(api.__test.fittingSizePairGroupForPart(part("expand", "1/2 barb to 3/4 barb", "fitting", "in_stock", 2, 1, 1, "barb", "1/2", "barb", "3/4", { pressureLossPsi: 0.1 }, undefined, true)).label, "1/2 <-> 3/4"); // NEW
    assert.equal(api.__test.fittingSizePairGroupForPart(part("thread_same_mpt", "3/4 MPT to 3/4 barb", "fitting", "in_stock", 2, 1, 1, "mpt", "3/4", "barb", "3/4", { pressureLossPsi: 0.1 }, undefined, true)).label, "3/4 <-> 3/4 MPT"); // CHANGE
    assert.equal(api.__test.fittingSizePairGroupForPart(part("thread_same_fpt", "3/4 FPT to 3/4 barb", "fitting", "in_stock", 2, 1, 1, "fpt", "3/4", "barb", "3/4", { pressureLossPsi: 0.1 }, undefined, true)).label, "3/4 <-> 3/4 FPT"); // NEW
    assert.equal(api.__test.fittingSizePairGroupForPart(part("thread_to_thread", "3/4 FPT to 3/4 MPT", "fitting", "in_stock", 2, 1, 1, "fpt", "3/4", "mpt", "3/4", { pressureLossPsi: 0.1 })).label, "3/4 FPT <-> 3/4 MPT"); // NEW
    assert.equal(api.__test.fittingSizePairGroupForPart({ id: "flipped", name: "1/2 in barb to 3/4 in MPT adapter", category: "fitting", stockState: "in_stock", cost: 2, connectionFlipped: true, connectors: { inputs: 1, outputs: 1, input: { type: "mpt", nominalSize: "3/4" }, output: { type: "barb", nominalSize: "1/2", pipeConnection: true } }, specs: { pressureLossPsi: 0.1 } }).label, "1/2 <-> 3/4 MPT"); // CHANGE
    const pairGroups = api.__test.fittingIntentPartGroups([ // NEW
        part("reduce", "3/4 barb to 1/2 barb", "fitting", "in_stock", 2, 1, 1, "barb", "3/4", "barb", "1/2", { pressureLossPsi: 0.1 }, undefined, true), // NEW
        part("expand", "1/2 barb to 3/4 barb", "fitting", "in_stock", 2, 1, 1, "barb", "1/2", "barb", "3/4", { pressureLossPsi: 0.1 }, undefined, true) // NEW
    ]).find(group => group.id === "change_size").childGroups; // NEW
    assert.equal(JSON.stringify(pairGroups.map(group => [group.label, group.parts.map(item => item.id)])), JSON.stringify([["1/2 <-> 3/4", ["reduce", "expand"]]])); // NEW
    const threadGroups = api.__test.fittingIntentPartGroups([ // NEW
        part("barb_to_fpt", "3/4 barb to 3/4 FPT", "fitting", "in_stock", 2, 1, 1, "barb", "3/4", "fpt", "3/4", { pressureLossPsi: 0.1 }, undefined, true), // NEW
        part("barb_to_mpt", "3/4 barb to 3/4 MPT", "fitting", "in_stock", 2, 1, 1, "barb", "3/4", "mpt", "3/4", { pressureLossPsi: 0.1 }, undefined, true), // NEW
        part("fpt_to_mpt", "3/4 FPT to 3/4 MPT", "fitting", "in_stock", 2, 1, 1, "fpt", "3/4", "mpt", "3/4", { pressureLossPsi: 0.1 }) // NEW
    ]).find(group => group.id === "thread_adapters").childGroups; // NEW
    assert.ok(threadGroups.some(group => group.label === "3/4 <-> 3/4 FPT" && group.parts.some(item => item.id === "barb_to_fpt"))); // NEW
    assert.ok(threadGroups.some(group => group.label === "3/4 <-> 3/4 MPT" && group.parts.some(item => item.id === "barb_to_mpt"))); // NEW
    assert.ok(threadGroups.some(group => group.label === "3/4 FPT <-> 3/4 MPT" && group.parts.some(item => item.id === "fpt_to_mpt"))); // NEW
}); // NEW

test("source commit creates one undoable edit at the latest click point and HUD follows zoom events", async () => {
    const { api, graph, model, moduleCell, actions } = loadPlugin();
    api.writeCatalog(moduleCell, sampleCatalog());
    actions.get("trellisIrrigationPlanner").funct();
    assert.equal(graph.container.querySelector(".trellis-irrigation-source-form"), null);
    graph.fireMouseMove(310, 180);
    clickButton(graph.container, "Create Source");
    assert.ok(graph.container.querySelector(".trellis-irrigation-source-form"));
    model.completedEdits = [];
    clickButton(graph.container, "Commit Source");
    const sourceAssembly = assemblyCells(moduleCell, api)[0];
    assert.equal(model.completedEdits.length, 1);
    assert.equal(sourceAssembly.getAttribute(api.attrs.ASSEMBLY_TYPE), "source");
    assert.equal(sourceAssembly.geometry.x, 310);
    assert.equal(sourceAssembly.geometry.y, 180);
    assert.equal(graph.getSelectionCell(), sourceAssembly);
    const sourcePart = api.__test.firstAssemblyPart(sourceAssembly);
    assertAssemblyPartPlannerManagedStyle(sourcePart);
    const profile = JSON.parse(sourcePart.getAttribute(api.attrs.ENDPOINT_PROFILE_JSON));
    assert.equal(profile.connectorType, "barb");
    assert.equal(profile.pipeConnection, false);
    graph.view.scale = 1.4;
    graph.view.fire("scale");
    assert.ok(graph.container.querySelector(".trellis-irrigation-mode-hud"));
    const writesAfterCommit = model.valuesWritten;
    await new Promise(resolve => setTimeout(resolve, 260));
    assert.equal(model.valuesWritten, writesAfterCommit);
});

test("source and part assemblies store compact stack row geometry", () => { // NEW
    const { api, moduleCell } = loadPlugin(); // NEW
    const catalog = sampleCatalog(); // NEW
    catalog.items.push(part("direct_a", "Direct A", "fitting", "in_stock", 1, 1, 1, "barb", "3/4", "mght", "3/4", { pressureLossPsi: 0.1 }, undefined, true)); // NEW
    catalog.items.push(part("direct_b", "Direct B", "fitting", "in_stock", 1, 1, 1, "fght", "3/4", "mght", "3/4")); // NEW
    catalog.items.push(part("direct_c", "Direct C", "fitting", "in_stock", 1, 1, 1, "fght", "3/4", "mght", "3/4")); // NEW
    catalog.items.push(part("direct_d", "Direct D", "fitting", "in_stock", 1, 1, 1, "fght", "3/4", "mght", "3/4")); // NEW
    api.writeCatalog(moduleCell, catalog); // NEW
    const source = api.__test.createSourceAssembly(moduleCell, "Well", { connectorType: "barb", nominalSize: "3/4" }, { x: 30, y: 40 }); // NEW
    assertSwimlaneAssemblyStyle(source.assembly); // NEW
    assert.equal(source.assembly.geometry.height, 62); // NEW
    assert.equal(api.__test.firstAssemblyPart(source.assembly).geometry.y, 28); // NEW
    const assembly = api.__test.createPartAssembly(moduleCell, catalog.items.find(item => item.id === "direct_c"), { x: 260, y: 40 }).assembly; // NEW
    assert.equal(assembly.geometry.height, 62); // NEW
    assert.equal(api.__test.firstAssemblyPart(assembly).geometry.y, 28); // NEW
    assert.ok(api.__test.applyConnectionPartChoice(moduleCell, { cell: api.__test.firstAssemblyPart(assembly), role: "input", index: 0 }, catalog.items.find(item => item.id === "direct_b")).cell); // NEW
    assert.ok(api.__test.applyConnectionPartChoice(moduleCell, { cell: api.__test.firstAssemblyPart(assembly), role: "input", index: 0 }, catalog.items.find(item => item.id === "direct_a")).cell); // NEW
    assert.ok(api.__test.applyConnectionPartChoice(moduleCell, { cell: api.__test.lastAssemblyPart(assembly), role: "output", index: 0 }, catalog.items.find(item => item.id === "direct_d")).cell); // NEW
    assert.equal(JSON.stringify(api.__test.assemblyPartCells(assembly).map(cell => cell.geometry.y)), JSON.stringify([28, 62, 96, 130])); // CHANGE
    assert.equal(assembly.geometry.height, 164); // NEW
    assert.equal(JSON.stringify(api.__test.assemblyPartCells(assembly).map(cell => cell.getAttribute(api.attrs.CATALOG_PART_ID))), JSON.stringify(["direct_a", "direct_b", "direct_c", "direct_d"])); // CHANGE
}); // NEW

test("irrigation mode exposes active state and normalizes invalid entry selection", () => {
    const { api, graph, moduleCell, document } = loadPlugin();
    const group = appendChild(moduleCell, makeXmlCell(document, "plantGroup", { tiler_group: "1", label: "Lettuce" }, { x: 40, y: 40, width: 90, height: 60 }));
    graph.setSelectionCell(group);
    assert.equal(api.isIrrigationModeActive(), false);
    api.openIrrigationMode(moduleCell, { preserveViewport: true });
    assert.equal(api.isIrrigationModeActive(), true);
    assert.equal(api.isIrrigationModeActive(moduleCell), true);
    assert.equal(api.getActiveIrrigationModule(), moduleCell);
    assert.equal(graph.getSelectionCell(), moduleCell);
    assert.match(graph.container.querySelector(".trellis-irrigation-mode-hud").textContent, /Irrigation Mode/);
    api.closeIrrigationMode();
    assert.equal(api.isIrrigationModeActive(), false);
    assert.equal(api.getActiveIrrigationModule(), null);
    assert.equal(graph.container.querySelector(".trellis-irrigation-mode-hud"), null);
});

test("irrigation mode HUD renders only for active-module irrigation selections", () => {
    const { api, graph, moduleCell, bed, root, document } = loadPlugin();
    api.writeCatalog(moduleCell, sampleCatalog());
    const otherModule = appendChild(root, makeXmlCell(document, "otherModule", { garden_module: "1", label: "Other" }, { x: 900, y: 0, width: 300, height: 220 }));
    const plantGroup = appendChild(moduleCell, makeXmlCell(document, "plantGroup", { tiler_group: "1", label: "Lettuce" }, { x: 40, y: 40, width: 90, height: 60 }));
    const assembly = api.__test.createPartAssembly(moduleCell, api.readCatalog(moduleCell).items.find(item => item.id === "filter"), { x: 30, y: 40 }).assembly;
    const source = api.__test.createSourceAssembly(moduleCell, "Well", { connectorType: "barb", nominalSize: "3/4", usableFlowGpm: 5, staticPressurePsi: 45 }, { x: 30, y: 180 });
    const connection = api.__test.createAssemblyConnection(moduleCell, { cellId: api.__test.firstAssemblyPart(source.assembly).getId(), role: "output", index: 0 }, { cellId: api.__test.firstAssemblyPart(assembly).getId(), role: "input", index: 0 });
    assert.equal(connection.ok, true, connection.reason);
    api.openIrrigationMode(moduleCell, { preserveViewport: true });
    assert.match(graph.container.querySelector(".trellis-irrigation-mode-hud").textContent, /Irrigation Mode/);
    graph.setSelectionCell(bed);
    assert.match(graph.container.querySelector(".trellis-irrigation-mode-hud").textContent, /Garden Bed/);
    graph.setSelectionCell(assembly);
    assert.ok(graph.container.querySelector(".trellis-irrigation-local-hud"));
    graph.setSelectionCell(connection.edge);
    assert.ok(graph.container.querySelector(".trellis-irrigation-connection-hud"));
    assert.equal(inlineConnectionActions(graph.container).length, 0);
    assert.ok(buttonTexts(graph.container).includes("Disconnect"));
    graph.setSelectionCell(plantGroup);
    assert.equal(graph.container.querySelector(".trellis-irrigation-mode-hud"), null);
    graph.setSelectionCell(otherModule);
    assert.equal(graph.container.querySelector(".trellis-irrigation-mode-hud"), null);
});

test("Add Part groups global options and creates one undoable unconnected assembly without context", () => {
    const { api, graph, model, moduleCell, actions } = loadPlugin();
    api.writeCatalog(moduleCell, sampleCatalog());
    actions.get("trellisIrrigationPlanner").funct();
    assert.match(graph.container.textContent, /Add Part/);
    const header = irrigationHeader(graph.container);
    assert.deepEqual(buttonTexts(header), ["Build", "Analysis", "BOM", "Catalog", "Exit"]); // CHANGE
    assert.match(buttonByText(header, "BOM").getAttribute("style"), /border:\s*1px solid (?:#2563eb|rgb\(37,\s*99,\s*235\))/);
    assert.match(buttonByText(header, "Catalog").getAttribute("style"), /border:\s*1px solid (?:#2563eb|rgb\(37,\s*99,\s*235\))/);
    assert.equal(hudSectionTitles(graph.container).includes("Tools"), false);
    graph.fireMouseMove(360, 220);
    clickButton(graph.container, "Add Part");
    const form = graph.container.querySelector(".trellis-irrigation-add-assembly-form");
    assert.ok(form, "Missing Add Part form");
    const select = form.querySelector(".trellis-irrigation-add-part-picker");
    assert.ok(select, "Missing Add Part picker");
    const groups = Array.from(select.querySelectorAll("optgroup")).map(group => group.label);
    assert.ok(groups.includes("In stock / Filters")); // CHANGE
    assert.ok(groups.includes("In stock / Fittings / Thread adapters / 3/4 <-> 3/4 FPT")); // CHANGE
    assert.ok(groups.includes("Needs purchase / Drip tape")); // CHANGE
    select.value = "filter";
    model.completedEdits = [];
    clickButton(form, "Add Part");
    const partAssembly = assemblyCells(moduleCell, api)[0];
    assert.equal(model.completedEdits.length, 1);
    assert.equal(partAssembly.getAttribute(api.attrs.ASSEMBLY_TYPE), "parts");
    assert.equal(api.__test.firstAssemblyPart(partAssembly).getAttribute(api.attrs.CATALOG_PART_ID), "filter");
    assert.doesNotMatch(graph.container.textContent, /Create Source/);
    assert.doesNotMatch(graph.container.textContent, /Add Part/);
});

test("selected inner assembly parts expose contextual bottom delete action", () => {
    const { api, graph, moduleCell } = loadPlugin();
    api.writeCatalog(moduleCell, sampleCatalog());
    const assembly = api.__test.createPartAssembly(moduleCell, api.readCatalog(moduleCell).items.find(item => item.id === "filter"), { x: 30, y: 40 }).assembly;
    const partCell = api.__test.firstAssemblyPart(assembly);
    api.openIrrigationMode(moduleCell, { preserveViewport: true });
    graph.setSelectionCell(assembly);
    assert.equal(buttonTexts(graph.container).includes("Delete Part"), false);
    assert.equal(dangerButton(graph.container).textContent.trim(), "Delete Assembly");
    assert.match(dangerButton(graph.container).getAttribute("style") || "", /background:\s*(?:#b91c1c|rgb\(185,\s*28,\s*28\))/); // NEW
    graph.setSelectionCell(partCell);
    const buttons = buttonTexts(graph.container);
    assert.equal(buttons.includes("Delete Part"), true);
    assert.equal(dangerButton(graph.container).textContent.trim(), "Delete Part");
    assert.equal(buttons.includes("Delete Assembly"), false);
    assert.equal(buttons.includes("Add Part"), false);
    assert.equal(buttons.includes("Reverse Assembly"), false);
});

test("water source overlay title edits source and assembly labels", () => {
    const { api, graph, moduleCell, document } = loadPlugin();
    api.writeCatalog(moduleCell, sampleCatalog());
    const source = api.__test.createSourceAssembly(moduleCell, "Well", { connectorType: "barb", nominalSize: "3/4", usableFlowGpm: 5, staticPressurePsi: 45 }, { x: 30, y: 40 });
    api.openIrrigationMode(moduleCell, { preserveViewport: true });
    graph.setSelectionCell(source.assembly);
    let title = graph.container.querySelector(".trellis-irrigation-source-title-input");
    assert.ok(title, "Missing editable water source title");
    assert.ok(irrigationHeader(graph.container).contains(title));
    assert.ok(graph.container.querySelector(".trellis-irrigation-source-edit"));
    assert.equal(buttonTexts(graph.container).includes("Add Part"), false);
    assert.match(buttonByText(graph.container, "Save Source").getAttribute("style"), /#188038|rgb\(24,\s*128,\s*56\)/);

    graph.setSelectionCell(source.source);
    title = graph.container.querySelector(".trellis-irrigation-source-title-input");
    assert.ok(title, "Missing editable water source title for selected source endpoint");
    assert.ok(graph.container.querySelector(".trellis-irrigation-source-edit"));

    const inlineAdapter = appendChild(source.assembly, makeXmlCell(document, "source_inline_adapter", { [api.attrs.COMPONENT]: "1", [api.attrs.COMPONENT_TYPE]: "fitting", [api.attrs.CATALOG_PART_ID]: "fpt_to_barb", label: "Inline adapter" }, { x: 20, y: 90, width: 150, height: 34 }));
    graph.setSelectionCell(inlineAdapter);
    assert.equal(graph.container.querySelector(".trellis-irrigation-source-title-input"), null);
    assert.equal(graph.container.querySelector(".trellis-irrigation-source-edit"), null);
    assert.match(irrigationHeader(graph.container).textContent, /Inline adapter/);
    assert.equal(buttonTexts(graph.container).includes("Delete Part"), true);

    graph.setSelectionCell(source.source);
    title = graph.container.querySelector(".trellis-irrigation-source-title-input");
    title.value = "Main Water";
    blurInput(title);
    assert.equal(source.assembly.getAttribute("label"), "Main Water");
    assert.equal(source.source.getAttribute("label"), "Main Water");
    assert.equal(JSON.parse(source.source.getAttribute(api.attrs.ENDPOINT_PROFILE_JSON)).label, "Main Water");
});

test("water source connector fields lock after downstream assembly connection", () => {
    const { api, graph, moduleCell } = loadPlugin();
    api.writeCatalog(moduleCell, sampleCatalog());
    const source = api.__test.createSourceAssembly(moduleCell, "Well", { connectorType: "barb", nominalSize: "3/4", usableFlowGpm: 5, staticPressurePsi: 45 }, { x: 30, y: 40 });
    api.openIrrigationMode(moduleCell, { preserveViewport: true });
    graph.setSelectionCell(source.assembly);
    assert.equal(selectByLabel(graph.container, "Connector").disabled, false);
    assert.equal(selectByLabel(graph.container, "Size").disabled, false);

    const filter = api.__test.createPartAssembly(moduleCell, api.readCatalog(moduleCell).items.find(item => item.id === "filter"), { x: 260, y: 40 });
    const connection = api.__test.createAssemblyConnection(moduleCell, { cellId: api.__test.firstAssemblyPart(source.assembly).getId(), role: "output", index: 0 }, { cellId: api.__test.firstAssemblyPart(filter.assembly).getId(), role: "input", index: 0 });
    assert.equal(connection.ok, true, connection.reason);
    graph.setSelectionCell(source.assembly);
    assert.equal(selectByLabel(graph.container, "Connector").disabled, true);
    assert.equal(selectByLabel(graph.container, "Size").disabled, true);
    assert.equal(inputByLabel(graph.container, "Flow gpm").disabled, false);
    assert.equal(inputByLabel(graph.container, "Static psi").disabled, false);
});

test("water source connector fields lock when source assembly contains downstream parts", () => {
    const { api, graph, moduleCell, document } = loadPlugin();
    api.writeCatalog(moduleCell, sampleCatalog());
    const source = api.__test.createSourceAssembly(moduleCell, "Well", { connectorType: "barb", nominalSize: "3/4", usableFlowGpm: 5, staticPressurePsi: 45 }, { x: 30, y: 40 });
    appendChild(source.assembly, makeXmlCell(document, "source_inline_adapter", { [api.attrs.COMPONENT]: "1", [api.attrs.COMPONENT_TYPE]: "fitting", [api.attrs.CATALOG_PART_ID]: "fpt_to_barb", label: "Inline adapter" }, { x: 20, y: 90, width: 150, height: 34 }));
    api.openIrrigationMode(moduleCell, { preserveViewport: true });
    graph.setSelectionCell(source.assembly);
    assert.equal(selectByLabel(graph.container, "Connector").disabled, true);
    assert.equal(selectByLabel(graph.container, "Size").disabled, true);
});

test("inner assembly parts remain selectable while native moves are guarded", () => {
    const { api, graph, moduleCell } = loadPlugin();
    api.writeCatalog(moduleCell, sampleCatalog());
    const assembly = api.__test.createPartAssembly(moduleCell, api.readCatalog(moduleCell).items.find(item => item.id === "filter"), { x: 30, y: 40 }).assembly;
    const partCell = api.__test.firstAssemblyPart(assembly);
    api.openIrrigationMode(moduleCell, { preserveViewport: true });
    graph.setSelectionCell(partCell);
    assert.equal(graph.getSelectionCell(), partCell);
    assert.equal(buttonTexts(graph.container).includes("Delete Part"), true);
    const partGeometry = Object.assign({}, partCell.geometry);
    const childOrder = assembly.children.map(cell => cell.getId());
    assert.deepEqual(graph.moveCells([partCell], 0, 80, false, null), [partCell]);
    assert.deepEqual(partCell.geometry, partGeometry);
    assert.deepEqual(assembly.children.map(cell => cell.getId()), childOrder);
    assert.equal(graph.movedCells, undefined);
    const assemblyGeometry = Object.assign({}, assembly.geometry);
    assert.deepEqual(graph.moveCells([assembly], 12, 18, false, null), [assembly]);
    assert.equal(assembly.geometry.x, assemblyGeometry.x + 12);
    assert.equal(assembly.geometry.y, assemblyGeometry.y + 18);
    const guardedPartGeometry = Object.assign({}, partCell.geometry);
    const movedAssemblyGeometry = Object.assign({}, assembly.geometry);
    assert.deepEqual(graph.moveCells([partCell, assembly], 7, 11, false, null), [assembly]);
    assert.deepEqual(partCell.geometry, guardedPartGeometry);
    assert.equal(assembly.geometry.x, movedAssemblyGeometry.x + 7);
    assert.equal(assembly.geometry.y, movedAssemblyGeometry.y + 11);
    assert.deepEqual(graph.movedCells.slice(-1), [assembly]);
});

test("Delete Part splits downstream assembly and updates reports in one redoable edit", () => {
    const { api, graph, model, moduleCell, bed } = loadPlugin();
    api.writeCatalog(moduleCell, sampleCatalog());
    const catalog = api.readCatalog(moduleCell);
    const source = api.__test.createSourceAssembly(moduleCell, "Half inch source", { connectorType: "barb", nominalSize: "1/2", method: "drip", pipeConnection: true, usableFlowGpm: 5, staticPressurePsi: 45 }, { x: 30, y: 40 });
    const assembly = api.__test.createPartAssembly(moduleCell, catalog.items.find(item => item.id === "pipe_half"), { x: 30, y: 160 }).assembly;
    const first = api.__test.firstAssemblyPart(assembly);
    const middleCreated = api.__test.createPartAssembly(moduleCell, catalog.items.find(item => item.id === "pipe_half"), { x: 260, y: 160 });
    const lastCreated = api.__test.createPartAssembly(moduleCell, catalog.items.find(item => item.id === "pipe_half"), { x: 490, y: 160 });
    const middle = middleCreated.partCell;
    const last = lastCreated.partCell;
    appendChild(assembly, middle); middle.parent = assembly; model.remove(middleCreated.assembly);
    appendChild(assembly, last); last.parent = assembly; model.remove(lastCreated.assembly);
    first.geometry.y = 28; middle.geometry.y = 62; last.geometry.y = 96; // CHANGE
    const bedAssembly = api.__test.createBedAssembly(moduleCell, bed, { x: 30, y: 360 });
    assert.equal(api.__test.createAssemblyConnection(moduleCell, { cellId: api.__test.firstAssemblyPart(source.assembly).getId(), role: "output", index: 0 }, { cellId: first.getId(), role: "input", index: 0 }).ok, true);
    assert.equal(api.__test.createAssemblyConnection(moduleCell, { cellId: last.getId(), role: "output", index: 0 }, { cellId: bedAssembly.assembly.getId(), role: "input", index: 0 }).ok, true);
    assert.equal(api.__test.syncHudGraphState(moduleCell).length, 1);
    api.openIrrigationMode(moduleCell, { preserveViewport: true });
    graph.setSelectionCell(middle);
    model.completedEdits = [];
    clickButton(graph.container, "Delete Part");
    assert.equal(model.completedEdits.length, 1);
    assert.equal(JSON.stringify(api.__test.assemblyPartCells(assembly).map(cell => cell.getId())), JSON.stringify([first.getId()]));
    const disconnected = assemblyCells(moduleCell, api).find(cell => cell !== assembly && api.__test.assemblyPartCells(cell).some(partCell => partCell === last));
    assert.ok(disconnected, "expected downstream parts to move into a disconnected assembly");
    assert.equal(JSON.stringify(api.__test.assemblyPartCells(disconnected).map(cell => cell.getId())), JSON.stringify([last.getId()]));
    const disconnectedPaths = api.__test.syncHudGraphState(moduleCell);
    assert.equal(disconnectedPaths.length, 1);
    assert.equal(disconnectedPaths[0].disconnectedFromSource, true);
    assert.ok(moduleCell.getAttribute(api.attrs.REPORT_JSON));
});

test("context Add Part suppresses upstream singleton categories only after a source route exists", () => {
    const { api, moduleCell } = loadPlugin();
    api.writeCatalog(moduleCell, sampleCatalog());
    const disconnected = api.__test.createPartAssembly(moduleCell, api.readCatalog(moduleCell).items.find(item => item.id === "filter"), { x: 30, y: 40 });
    let context = api.__test.addPartContextFromPort(moduleCell, { cellId: api.__test.firstAssemblyPart(disconnected.assembly).getId(), role: "output", index: 0 });
    let ids = api.__test.addPartPickerParts({ moduleCell }, context).map(item => item.id);
    assert.ok(ids.includes("filter"), "Disconnected branches should not suppress singleton setup parts.");
    const source = api.__test.createSourceAssembly(moduleCell, "Source", { connectorType: "barb", nominalSize: "3/4", method: "drip", pipeConnection: true, usableFlowGpm: 5, staticPressurePsi: 45 }, { x: 30, y: 180 });
    const connected = api.__test.createPartAssembly(moduleCell, api.readCatalog(moduleCell).items.find(item => item.id === "filter"), { x: 30, y: 320 });
    const connection = api.__test.createAssemblyConnection(moduleCell, { cellId: api.__test.firstAssemblyPart(source.assembly).getId(), role: "output", index: 0 }, { cellId: api.__test.firstAssemblyPart(connected.assembly).getId(), role: "input", index: 0 });
    assert.equal(connection.ok, true, connection.reason);
    context = api.__test.addPartContextFromPort(moduleCell, { cellId: api.__test.firstAssemblyPart(connected.assembly).getId(), role: "output", index: 0 });
    ids = api.__test.addPartPickerParts({ moduleCell }, context).map(item => item.id);
    assert.equal(ids.includes("filter"), false);
    assert.ok(ids.includes("regulator"));
    assert.ok(ids.includes("valve"));
    assert.equal(api.__test.upstreamSingletonCategories(moduleCell, context.row).has("filter"), true);
});

test("exposed assembly outlet Add Part lists direct pipe-thread candidates", () => { // CHANGE
    const { api, moduleCell } = loadPlugin();
    const catalog = { items: [
        part("threaded_source", "Threaded Source", "valve", "in_stock", 10, 1, 1, "fpt", "3/4", "mpt", "3/4", { maxFlowGpm: 8 }),
        part("direct_filter", "Direct Filter", "filter", "in_stock", 10, 1, 1, "fpt", "3/4", "mpt", "3/4", { pressureLossPsi: 1 }), // CHANGE
        part("same_gender_thread", "Same Gender Thread", "fitting", "in_stock", 4, 1, 1, "mpt", "3/4", "mpt", "3/4", { pressureLossPsi: 0.1 }) // NEW
    ] };
    api.writeCatalog(moduleCell, catalog);
    const assembly = api.__test.createPartAssembly(moduleCell, catalog.items[0], { x: 30, y: 40 }).assembly;
    const source = api.__test.firstAssemblyPart(assembly);
    const context = api.__test.addPartContextFromPort(moduleCell, { cellId: source.getId(), role: "output", index: 0 });
    const ids = api.__test.addPartPickerParts({ moduleCell }, context).map(item => item.id);
    assert.equal(ids.includes("direct_filter"), true); // CHANGE
    assert.equal(ids.includes("same_gender_thread"), false); // NEW
    const result = api.__test.applyConnectionPartChoice(moduleCell, context.row, catalog.items[1]);
    assert.ok(result.cell, result.message); // CHANGE
    assert.equal(JSON.stringify(api.__test.assemblyPartCells(assembly).map(cell => cell.getAttribute(api.attrs.CATALOG_PART_ID))), JSON.stringify(["threaded_source", "direct_filter"])); // NEW
    assert.equal(api.__test.collectAssemblyEdges(moduleCell).length, 0); // NEW
}); // CHANGE

test("exposed assembly outlet Add Part lists direct hose-thread candidates", () => { // NEW
    const { api, moduleCell } = loadPlugin(); // NEW
    const catalog = { items: [ // NEW
        part("hose_source", "Hose Source", "fitting", "in_stock", 4, 1, 1, "fght", "3/4", "mght", "3/4", { pressureLossPsi: 0.1 }), // NEW
        part("fght_adapter", "FGHT Adapter", "fitting", "in_stock", 4, 1, 1, "fght", "3/4", "mpt", "3/4", { pressureLossPsi: 0.1 }), // NEW
        part("same_gender_hose", "Same Gender Hose", "fitting", "in_stock", 4, 1, 1, "mght", "3/4", "mpt", "3/4", { pressureLossPsi: 0.1 }) // NEW
    ] }; // NEW
    api.writeCatalog(moduleCell, catalog); // NEW
    const assembly = api.__test.createPartAssembly(moduleCell, catalog.items[0], { x: 30, y: 40 }).assembly; // NEW
    const source = api.__test.firstAssemblyPart(assembly); // NEW
    const context = api.__test.addPartContextFromPort(moduleCell, { cellId: source.getId(), role: "output", index: 0 }); // NEW
    const ids = api.__test.addPartPickerParts({ moduleCell }, context).map(item => item.id); // NEW
    assert.equal(ids.includes("fght_adapter"), true); // NEW
    assert.equal(ids.includes("same_gender_hose"), false); // NEW
    const result = api.__test.applyConnectionPartChoice(moduleCell, context.row, catalog.items[1]); // NEW
    assert.ok(result.cell, result.message); // NEW
    assert.equal(JSON.stringify(api.__test.assemblyPartCells(assembly).map(cell => cell.getAttribute(api.attrs.CATALOG_PART_ID))), JSON.stringify(["hose_source", "fght_adapter"])); // NEW
    assert.equal(api.__test.collectAssemblyEdges(moduleCell).length, 0); // NEW
}); // NEW

test("exposed pipe outlet Add Part still creates external pipe assemblies", () => { // NEW
    const { api, moduleCell } = loadPlugin(); // NEW
    const catalog = sampleCatalog(); // NEW
    api.writeCatalog(moduleCell, catalog); // NEW
    const assembly = api.__test.createPartAssembly(moduleCell, catalog.items.find(item => item.id === "filter"), { x: 30, y: 40 }).assembly; // NEW
    const source = api.__test.firstAssemblyPart(assembly); // NEW
    const context = api.__test.addPartContextFromPort(moduleCell, { cellId: source.getId(), role: "output", index: 0 }); // NEW
    const ids = api.__test.addPartPickerParts({ moduleCell }, context).map(item => item.id); // NEW
    assert.equal(ids.includes("regulator"), true); // NEW
    const result = api.__test.applyConnectionPartChoice(moduleCell, context.row, catalog.items.find(item => item.id === "regulator")); // NEW
    assert.ok(result.cell, result.message); // NEW
    assert.equal(JSON.stringify(api.__test.assemblyPartCells(assembly).map(cell => cell.getAttribute(api.attrs.CATALOG_PART_ID))), JSON.stringify(["filter"])); // NEW
    const edge = api.__test.collectAssemblyEdges(moduleCell)[0]; // NEW
    assert.ok(edge, "expected exposed pipe outlet to create a pipe edge"); // NEW
    assert.equal(edge.getAttribute(api.attrs.PIPE_EDGE), "1"); // NEW
    assert.equal(edge.getAttribute(api.attrs.PIPE_PART_ID), "pipe_cheap"); // NEW
});

test("exposed pipe outlet Add Part lists flipped canonical thread adapters", () => { // NEW
    const { api, moduleCell } = loadPlugin(); // NEW
    const catalog = { items: [ // NEW
        part("push_source", "Push Source", "fitting", "in_stock", 4, 1, 1, "push_connect", "1/2", "push_connect", "1/2", { pressureLossPsi: 0.1 }, undefined, true), // NEW
        part("pipe_half_push", "1/2 push pipe", "pipe_tubing", "in_stock", 0, 1, 1, "push_connect", "1/2", "push_connect", "1/2", { innerDiameterIn: 0.6 }, 0.32, true), // NEW
        { id: "mpt_to_push_adapter", name: "MPT to push adapter", category: "fitting", stockState: "in_stock", cost: 4, connectors: { inputs: 1, outputs: 1, input: { type: "mpt", nominalSize: "1/2" }, output: { type: "push_connect", nominalSize: "1/2", pipeConnection: true } }, specs: { pressureLossPsi: 0.2 } } // NEW
    ] }; // NEW
    api.writeCatalog(moduleCell, catalog); // NEW
    const assembly = api.__test.createPartAssembly(moduleCell, catalog.items[0], { x: 30, y: 40 }).assembly; // NEW
    const source = api.__test.firstAssemblyPart(assembly); // NEW
    const context = api.__test.addPartContextFromPort(moduleCell, { cellId: source.getId(), role: "output", index: 0 }); // NEW
    const pickerParts = api.__test.addPartPickerParts({ moduleCell }, context); // CHANGE
    const ids = pickerParts.map(item => item.id); // CHANGE
    assert.equal(ids.includes("mpt_to_push_adapter"), true); // NEW
    assert.equal(pickerParts.find(item => item.id === "mpt_to_push_adapter").name, "1/2\" push-to-connect: MPT adapter"); // CHANGE
    const result = api.__test.applyConnectionPartChoice(moduleCell, context.row, catalog.items[2]); // NEW
    assert.ok(result.cell, result.message); // NEW
    const inserted = api.__test.firstAssemblyPart(result.cell); // NEW
    assert.equal(inserted.getAttribute(api.attrs.CATALOG_PART_ID), "mpt_to_push_adapter"); // NEW
    assert.equal(inserted.getAttribute(api.attrs.PART_FLIPPED), "1"); // NEW
    assert.equal(inserted.getAttribute("label"), "1/2\" push-to-connect: MPT adapter"); // CHANGE
    const edge = api.__test.collectAssemblyEdges(moduleCell)[0]; // NEW
    assert.ok(edge, "expected flipped canonical adapter to connect by pipe edge"); // NEW
    assert.equal(edge.getAttribute(api.attrs.PIPE_EDGE), "1"); // NEW
    assert.equal(edge.getAttribute(api.attrs.PIPE_PART_ID), "pipe_half_push"); // NEW
    assertEdgeAnchors(edge, { exitY: "1", entryY: "0", entryPerimeter: "0" }); // CHANGE
}); // NEW

test("normal orientation Add Part keeps canonical adapter name", () => { // NEW
    const { api, moduleCell } = loadPlugin(); // NEW
    const catalog = { items: [ // NEW
        part("thread_source", "Thread Source", "fitting", "in_stock", 4, 1, 1, "mpt", "1/2", "fpt", "1/2", { pressureLossPsi: 0.1 }), // NEW
        { id: "mpt_to_push_adapter", name: "MPT to push adapter", category: "fitting", stockState: "in_stock", cost: 4, connectors: { inputs: 1, outputs: 1, input: { type: "mpt", nominalSize: "1/2" }, output: { type: "push_connect", nominalSize: "1/2", pipeConnection: true } }, specs: { pressureLossPsi: 0.2 } } // NEW
    ] }; // NEW
    api.writeCatalog(moduleCell, catalog); // NEW
    const assembly = api.__test.createPartAssembly(moduleCell, catalog.items[0], { x: 30, y: 40 }).assembly; // NEW
    const source = api.__test.firstAssemblyPart(assembly); // NEW
    const context = api.__test.addPartContextFromPort(moduleCell, { cellId: source.getId(), role: "output", index: 0 }); // NEW
    const pickerPart = api.__test.addPartPickerParts({ moduleCell }, context).find(item => item.id === "mpt_to_push_adapter"); // NEW
    assert.equal(pickerPart.name, "MPT to push adapter"); // NEW
    const result = api.__test.applyConnectionPartChoice(moduleCell, context.row, catalog.items[1]); // NEW
    assert.ok(result.cell, result.message); // NEW
    assert.equal(result.cell.getAttribute(api.attrs.PART_FLIPPED), null); // NEW
    assert.equal(result.cell.getAttribute("label"), "MPT to push adapter"); // NEW
}); // NEW

test("inactive irrigation selection shows entry button and opens irrigation mode", async () => {
    const { api, graph, moduleCell } = loadPlugin();
    api.writeCatalog(moduleCell, sampleCatalog());
    const assembly = api.__test.createPartAssembly(moduleCell, api.readCatalog(moduleCell).items.find(item => item.id === "filter"), { x: 30, y: 40 }).assembly;
    graph.setSelectionCell(assembly);
    await nextTick();
    const entry = graph.container.querySelector(".trellis-irrigation-enter-mode");
    assert.ok(entry);
    assert.equal(entry.textContent, "Enter Irrigation Design Mode");
    entry.click();
    assert.ok(graph.container.querySelector(".trellis-irrigation-mode-hud"));
    assert.equal(graph.container.querySelector(".trellis-irrigation-enter-mode"), null);
});

test("selected part and assembly overlays render labeled connection rows with disabled empty choices", () => {
    const { api, graph, moduleCell, bed } = loadPlugin();
    api.writeCatalog(moduleCell, sampleCatalog());
    const assembly = api.__test.createPartAssembly(moduleCell, api.readCatalog(moduleCell).items.find(item => item.id === "filter"), { x: 30, y: 40 }).assembly;
    const regulator = api.__test.createPartAssembly(moduleCell, api.readCatalog(moduleCell).items.find(item => item.id === "regulator"), { x: 30, y: 160 }).partCell;
    appendChild(assembly, regulator);
    regulator.parent = assembly;
    regulator.geometry.y = 62; // CHANGE
    api.openIrrigationMode(moduleCell, { preserveViewport: true });
    graph.setSelectionCell(api.__test.firstAssemblyPart(assembly));
    assert.ok(connectionRow(graph.container, "Inlet 1"));
    assert.ok(connectionRow(graph.container, "Outlet 1"));
    graph.setSelectionCell(assembly);
    assert.equal(graph.container.querySelectorAll(".trellis-irrigation-connection-row").length, 2);
    const bedAssembly = api.__test.createBedAssembly(moduleCell, bed, { x: 320, y: 40 });
    graph.setSelectionCell(bedAssembly.assembly);
    assert.equal(graph.container.querySelectorAll(".trellis-irrigation-connection-row").length, 0);
});

test("connection combobox groups choices by safety and collapsible catalog category", () => {
    const { api, graph, moduleCell } = loadPlugin();
    const catalog = sampleCatalog(); // CHANGE
    catalog.items.push(part("reduce_3_4_to_1_2", "3/4 barb to 1/2 barb reducer", "fitting", "in_stock", 2, 1, 1, "barb", "3/4", "barb", "1/2", { pressureLossPsi: 0.1 }, undefined, true)); // NEW
    catalog.items.push(part("expand_1_2_to_3_4", "1/2 barb to 3/4 barb adapter", "fitting", "in_stock", 2, 1, 1, "barb", "1/2", "barb", "3/4", { pressureLossPsi: 0.1 }, undefined, true)); // NEW
    catalog.items.push(part("mpt_to_3_4_barb", "3/4 MPT to 3/4 barb adapter", "fitting", "in_stock", 4, 1, 1, "mpt", "3/4", "barb", "3/4", { pressureLossPsi: 0.1 }, undefined, true)); // NEW
    api.writeCatalog(moduleCell, catalog); // CHANGE
    const assembly = api.__test.createPartAssembly(moduleCell, api.readCatalog(moduleCell).items.find(item => item.id === "filter"), { x: 30, y: 40 }).assembly;
    api.openIrrigationMode(moduleCell, { preserveViewport: true });
    graph.setSelectionCell(api.__test.firstAssemblyPart(assembly));
    const combobox = connectionCombobox(graph.container, "Outlet 1");
    const trigger = combobox.querySelector(".trellis-irrigation-connection-combobox-trigger");
    const hud = graph.container.querySelector(".trellis-irrigation-mode-hud");
    trigger.getBoundingClientRect = () => ({ left: 310, right: 620, top: 520, bottom: 550, width: 310, height: 30 });
    hud.getBoundingClientRect = () => ({ left: 200, right: 640, top: 380, bottom: 780, width: 440, height: 400 });
    trigger.click();
    const panel = connectionComboboxPanel(combobox);
    assert.equal(panel.parentNode, graph.container.ownerDocument.body);
    assert.equal(panel.style.position, "fixed");
    assert.equal(panel.style.left, "200px");
    assert.equal(panel.style.width, "440px");
    assert.equal(panel.querySelector(".trellis-irrigation-connection-combobox-safety-label").textContent, "Keeps connection");
    const categoryLabels = Array.from(panel.querySelectorAll(".trellis-irrigation-connection-combobox-category")).map(node => node.textContent.replace(/^[>v] /, "").replace(/ \(.+\)$/, ""));
    assert.deepEqual(categoryLabels, ["Filters", "Regulators", "Valves", "Fittings", "Drip tape"]); // CHANGE
    assert.deepEqual(connectionComboboxOptionIds(combobox), ["filter"]);
    const fittingCategory = Array.from(panel.querySelectorAll(".trellis-irrigation-connection-combobox-category")).find(node => node.textContent.includes("Fittings")); // CHANGE
    fittingCategory.click(); // NEW
    const fittingSubgroups = Array.from(connectionComboboxPanel(combobox).querySelectorAll(".trellis-irrigation-connection-combobox-fitting-subgroup")).map(node => node.textContent.replace(/^[>v] /, "").replace(/ \(.+\)$/, "")); // NEW
    assert.ok(fittingSubgroups.includes("Change size")); // NEW
    assert.ok(fittingSubgroups.includes("Thread adapters")); // NEW
    assert.equal(connectionComboboxPanel(combobox).querySelectorAll(".trellis-irrigation-connection-combobox-fitting-subgroup").length > 0, true); // NEW
    assert.equal(connectionComboboxPanel(combobox).querySelectorAll(".trellis-irrigation-connection-combobox-fitting-subgroup[data-category-key*='regulator']").length, 0); // NEW
    const sizePairLabels = Array.from(connectionComboboxPanel(combobox).querySelectorAll(".trellis-irrigation-connection-combobox-fitting-size-pair")).map(node => node.textContent.replace(/^[>v] /, "").replace(/ \(.+\)$/, "")); // NEW
    assert.ok(sizePairLabels.includes("1/2 <-> 3/4")); // NEW
    Array.from(connectionComboboxPanel(combobox).querySelectorAll(".trellis-irrigation-connection-combobox-fitting-subgroup")).find(node => node.textContent.includes("Thread adapters")).click(); // NEW
    const threadSizePairLabels = Array.from(connectionComboboxPanel(combobox).querySelectorAll(".trellis-irrigation-connection-combobox-fitting-size-pair")).map(node => node.textContent.replace(/^[>v] /, "").replace(/ \(.+\)$/, "")); // NEW
    assert.ok(threadSizePairLabels.includes("3/4 <-> 3/4 FPT")); // CHANGE
    assert.ok(threadSizePairLabels.includes("3/4 <-> 3/4 MPT")); // NEW
    Array.from(connectionComboboxPanel(combobox).querySelectorAll(".trellis-irrigation-connection-combobox-category")).find(node => node.textContent.includes("Fittings")).click(); // CHANGE
    const regulatorCategory = Array.from(panel.querySelectorAll(".trellis-irrigation-connection-combobox-category")).find(node => node.textContent.includes("Regulators")); // CHANGE
    regulatorCategory.focus();
    regulatorCategory.click();
    assert.ok(connectionComboboxPanel(combobox), "Category toggles should keep the combobox open");
    assert.ok(connectionComboboxPanel(combobox).contains(graph.container.ownerDocument.activeElement), "Category toggles should restore focus inside the combobox");
    assert.deepEqual(connectionComboboxOptionIds(combobox), ["filter", "regulator"]);
});

test("connection combobox persists collapsed category state per user", () => {
    const { api, graph, moduleCell } = loadPlugin();
    api.writeCatalog(moduleCell, sampleCatalog());
    const assembly = api.__test.createPartAssembly(moduleCell, api.readCatalog(moduleCell).items.find(item => item.id === "filter"), { x: 30, y: 40 }).assembly;
    api.openIrrigationMode(moduleCell, { preserveViewport: true });
    graph.setSelectionCell(api.__test.firstAssemblyPart(assembly));
    let combobox = openConnectionCombobox(graph.container, "Outlet 1");
    connectionComboboxPanel(combobox).querySelector(".trellis-irrigation-connection-combobox-category").click();
    assert.equal(connectionComboboxOptionIds(combobox).includes("filter"), false);
    graph.setSelectionCell(api.__test.firstAssemblyPart(assembly));
    combobox = openConnectionCombobox(graph.container, "Outlet 1");
    assert.equal(connectionComboboxOptionIds(combobox).includes("filter"), false);
    assert.match(graph.container.ownerDocument.defaultView.localStorage.getItem("trellis.irrigation.connectionCombobox.collapsed.v1"), /"keep:filter":true/);
});

test("connection combobox search reveals matching collapsed categories", () => {
    const { api, graph, moduleCell } = loadPlugin();
    api.writeCatalog(moduleCell, sampleCatalog());
    const assembly = api.__test.createPartAssembly(moduleCell, api.readCatalog(moduleCell).items.find(item => item.id === "filter"), { x: 30, y: 40 }).assembly;
    api.openIrrigationMode(moduleCell, { preserveViewport: true });
    graph.setSelectionCell(api.__test.firstAssemblyPart(assembly));
    const combobox = openConnectionCombobox(graph.container, "Outlet 1");
    const search = connectionComboboxPanel(combobox).querySelector(".trellis-irrigation-connection-combobox-search");
    search.value = "drip";
    search.dispatchEvent(new graph.container.ownerDocument.defaultView.Event("input", { bubbles: true }));
    assert.deepEqual(connectionComboboxOptionIds(combobox), ["drip_tape"]);
    search.value = "barb";
    search.dispatchEvent(new graph.container.ownerDocument.defaultView.Event("input", { bubbles: true }));
    assert.ok(connectionComboboxOptionIds(combobox).includes("regulator"));
    search.value = "3/4";
    search.dispatchEvent(new graph.container.ownerDocument.defaultView.Event("input", { bubbles: true }));
    assert.ok(connectionComboboxOptionIds(combobox).includes("valve"));
});

test("connection combobox shows reversed names for flipped-compatible parts", () => { // NEW
    const { api, graph, moduleCell } = loadPlugin(); // NEW
    const catalog = { items: [ // NEW
        part("push_source", "Push Source", "fitting", "in_stock", 4, 1, 1, "push_connect", "1/2", "push_connect", "1/2", { pressureLossPsi: 0.1 }, undefined, true), // NEW
        part("pipe_half_push", "1/2 push pipe", "pipe_tubing", "in_stock", 0, 1, 1, "push_connect", "1/2", "push_connect", "1/2", { innerDiameterIn: 0.6 }, 0.32, true), // NEW
        { id: "mpt_to_push_adapter", name: "MPT to push adapter", category: "fitting", stockState: "in_stock", cost: 4, connectors: { inputs: 1, outputs: 1, input: { type: "mpt", nominalSize: "1/2" }, output: { type: "push_connect", nominalSize: "1/2", pipeConnection: true } }, specs: { pressureLossPsi: 0.2 } } // NEW
    ] }; // NEW
    api.writeCatalog(moduleCell, catalog); // NEW
    const assembly = api.__test.createPartAssembly(moduleCell, catalog.items[0], { x: 30, y: 40 }).assembly; // NEW
    api.openIrrigationMode(moduleCell, { preserveViewport: true }); // NEW
    graph.setSelectionCell(api.__test.firstAssemblyPart(assembly)); // NEW
    const combobox = openConnectionCombobox(graph.container, "Outlet 1"); // NEW
    const search = connectionComboboxPanel(combobox).querySelector(".trellis-irrigation-connection-combobox-search"); // NEW
    search.value = "push-to-connect: MPT"; // CHANGE
    search.dispatchEvent(new graph.container.ownerDocument.defaultView.Event("input", { bubbles: true })); // NEW
    const option = connectionComboboxPanel(combobox).querySelector(".trellis-irrigation-connection-combobox-option[data-part-id='mpt_to_push_adapter']"); // NEW
    assert.ok(option, "expected reversed-name combobox search to find canonical adapter"); // NEW
    assert.match(option.textContent, /1\/2" push-to-connect: MPT adapter/); // CHANGE
}); // NEW

test("connection combobox keyboard, focus loss, and outside-click interactions do not write diagram state", async () => {
    const { api, graph, model, moduleCell } = loadPlugin();
    api.writeCatalog(moduleCell, sampleCatalog());
    const assembly = api.__test.createPartAssembly(moduleCell, api.readCatalog(moduleCell).items.find(item => item.id === "filter"), { x: 30, y: 40 }).assembly;
    api.openIrrigationMode(moduleCell, { preserveViewport: true });
    graph.setSelectionCell(api.__test.firstAssemblyPart(assembly));
    const writesBeforeOpen = model.valuesWritten;
    let combobox = openConnectionCombobox(graph.container, "Outlet 1");
    const search = connectionComboboxPanel(combobox).querySelector(".trellis-irrigation-connection-combobox-search");
    search.dispatchEvent(new graph.container.ownerDocument.defaultView.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    assert.equal(graph.container.ownerDocument.querySelector(".trellis-irrigation-connection-combobox-panel"), null);
    combobox = openConnectionCombobox(graph.container, "Outlet 1");
    const focusSearch = connectionComboboxPanel(combobox).querySelector(".trellis-irrigation-connection-combobox-search");
    const outsideInput = graph.container.ownerDocument.createElement("input");
    graph.container.ownerDocument.body.appendChild(outsideInput);
    outsideInput.focus();
    focusSearch.dispatchEvent(new graph.container.ownerDocument.defaultView.FocusEvent("focusout", { bubbles: true }));
    await nextTick();
    assert.equal(graph.container.ownerDocument.querySelector(".trellis-irrigation-connection-combobox-panel"), null);
    assert.equal(model.valuesWritten, writesBeforeOpen);
    combobox = openConnectionCombobox(graph.container, "Outlet 1");
    graph.container.ownerDocument.body.dispatchEvent(new graph.container.ownerDocument.defaultView.MouseEvent("mousedown", { bubbles: true }));
    assert.equal(graph.container.ownerDocument.querySelector(".trellis-irrigation-connection-combobox-panel"), null);
    combobox = openConnectionCombobox(graph.container, "Outlet 1");
    const searchAgain = connectionComboboxPanel(combobox).querySelector(".trellis-irrigation-connection-combobox-search");
    searchAgain.dispatchEvent(new graph.container.ownerDocument.defaultView.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
    graph.container.ownerDocument.activeElement.dispatchEvent(new graph.container.ownerDocument.defaultView.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    assert.notDeepEqual(api.__test.assemblyPartCells(assembly).map(cell => cell.getAttribute(api.attrs.CATALOG_PART_ID)), ["filter"]);
    assert.equal(model.valuesWritten > writesBeforeOpen, true);
});

test("connection dropdown creates external pipe assemblies and makes occupied pipe rows read-only", () => {
    const { api, graph, moduleCell } = loadPlugin();
    api.writeCatalog(moduleCell, sampleCatalog());
    const assembly = api.__test.createPartAssembly(moduleCell, api.readCatalog(moduleCell).items.find(item => item.id === "filter"), { x: 30, y: 40 }).assembly;
    api.openIrrigationMode(moduleCell, { preserveViewport: true });
    graph.setSelectionCell(api.__test.firstAssemblyPart(assembly));
    chooseConnectionPart(graph.container, "Outlet 1", "regulator");
    assert.equal(JSON.stringify(api.__test.assemblyPartCells(assembly).map(cell => cell.getAttribute(api.attrs.CATALOG_PART_ID))), JSON.stringify(["filter"]));
    const downstream = assemblyCells(moduleCell, api).find(cell => cell !== assembly && api.__test.firstAssemblyPart(cell).getAttribute(api.attrs.CATALOG_PART_ID) === "regulator");
    assert.ok(downstream);
    const edge = api.__test.collectAssemblyEdges(moduleCell)[0];
    assert.ok(edge);
    assert.equal(edge.getAttribute(api.attrs.PIPE_EDGE), "1");
    assert.equal(edge.source, api.__test.firstAssemblyPart(assembly));
    assert.equal(edge.target, api.__test.firstAssemblyPart(downstream));
    assertEdgeAnchors(edge, { exitY: "1", entryY: "0", exitX: "0.5", entryX: "0.5" }); // NEW
    graph.setSelectionCell(api.__test.firstAssemblyPart(assembly));
    assertConnectionRowReadOnly(graph.container, "Outlet 1");
    assert.equal(JSON.stringify(api.__test.assemblyPartCells(assembly).map(cell => cell.getAttribute(api.attrs.CATALOG_PART_ID))), JSON.stringify(["filter"]));
    assert.equal(assemblyCells(moduleCell, api).filter(cell => cell.getAttribute(api.attrs.ASSEMBLY_TYPE) === "parts").length, 2);
});

test("first assembly inlet direct Add Part inserts at the start of the assembly", () => {
    const { api, moduleCell } = loadPlugin();
    const catalog = { items: [
        part("direct_downstream", "Direct Downstream", "filter", "in_stock", 10, 1, 1, "fpt", "3/4", "mpt", "3/4", { pressureLossPsi: 1 }),
        part("direct_upstream", "Direct Upstream", "fitting", "in_stock", 4, 1, 1, "fght", "3/4", "mpt", "3/4", { pressureLossPsi: 0.2 })
    ] };
    api.writeCatalog(moduleCell, catalog);
    const assembly = api.__test.createPartAssembly(moduleCell, catalog.items[0], { x: 30, y: 40 }).assembly;
    const downstream = api.__test.firstAssemblyPart(assembly);
    const result = api.__test.applyConnectionPartChoice(moduleCell, { cell: downstream, role: "input", index: 0 }, catalog.items[1]);
    assert.ok(result.cell, result.message);
    assert.equal(JSON.stringify(api.__test.assemblyPartCells(assembly).map(cell => cell.getAttribute(api.attrs.CATALOG_PART_ID))), JSON.stringify(["direct_upstream", "direct_downstream"]));
    assert.equal(api.__test.collectAssemblyEdges(moduleCell).length, 0);
});

test("selected inlet dropdown inserts direct parts at the start of the assembly", () => {
    const { api, graph, moduleCell } = loadPlugin();
    const catalog = { items: [
        part("direct_downstream", "Direct Downstream", "filter", "in_stock", 10, 1, 1, "fpt", "3/4", "mpt", "3/4", { pressureLossPsi: 1 }),
        part("direct_upstream", "Direct Upstream", "fitting", "in_stock", 4, 1, 1, "fght", "3/4", "mpt", "3/4", { pressureLossPsi: 0.2 })
    ] };
    api.writeCatalog(moduleCell, catalog);
    const assembly = api.__test.createPartAssembly(moduleCell, catalog.items[0], { x: 30, y: 40 }).assembly;
    api.openIrrigationMode(moduleCell, { preserveViewport: true });
    graph.setSelectionCell(assembly);
    assert.equal(buttonTexts(graph.container).includes("Add Part"), false);
    chooseConnectionPart(graph.container, "Inlet 1", "direct_upstream");
    assert.equal(JSON.stringify(api.__test.assemblyPartCells(assembly).map(cell => cell.getAttribute(api.attrs.CATALOG_PART_ID))), JSON.stringify(["direct_upstream", "direct_downstream"]));
    assert.equal(api.__test.collectAssemblyEdges(moduleCell).length, 0);
});

test("first assembly inlet pipe Add Part creates a separate upstream assembly", () => {
    const { api, moduleCell } = loadPlugin();
    const catalog = sampleCatalog();
    api.writeCatalog(moduleCell, catalog);
    const assembly = api.__test.createPartAssembly(moduleCell, catalog.items.find(item => item.id === "filter"), { x: 30, y: 180 }).assembly;
    const filter = api.__test.firstAssemblyPart(assembly);
    const result = api.__test.applyConnectionPartChoice(moduleCell, { cell: filter, role: "input", index: 0 }, catalog.items.find(item => item.id === "regulator"));
    assert.ok(result.cell, result.message);
    assert.equal(JSON.stringify(api.__test.assemblyPartCells(assembly).map(cell => cell.getAttribute(api.attrs.CATALOG_PART_ID))), JSON.stringify(["filter"]));
    const upstreamAssembly = assemblyCells(moduleCell, api).find(cell => cell !== assembly && api.__test.firstAssemblyPart(cell).getAttribute(api.attrs.CATALOG_PART_ID) === "regulator");
    assert.ok(upstreamAssembly, "expected added pipe part to live in a separate upstream assembly");
    const edge = api.__test.collectAssemblyEdges(moduleCell).find(edge => edge.source === api.__test.firstAssemblyPart(upstreamAssembly) && edge.target === filter);
    assert.ok(edge, "expected upstream assembly to connect to the original inlet");
    assert.equal(edge.getAttribute(api.attrs.PIPE_EDGE), "1");
    assert.equal(edge.getAttribute(api.attrs.PIPE_PART_ID), "pipe_cheap");
    assertEdgeAnchors(edge, { exitY: "1", entryY: "0", exitX: "0.5", entryX: "0.5" }); // NEW
});

test("internal assembly inlets stay read-only after a direct inlet insertion", () => {
    const { api, graph, moduleCell } = loadPlugin();
    const catalog = { items: [
        part("direct_downstream", "Direct Downstream", "filter", "in_stock", 10, 1, 1, "fpt", "3/4", "mpt", "3/4", { pressureLossPsi: 1 }),
        part("direct_upstream", "Direct Upstream", "fitting", "in_stock", 4, 1, 1, "fght", "3/4", "mpt", "3/4", { pressureLossPsi: 0.2 })
    ] };
    api.writeCatalog(moduleCell, catalog);
    const assembly = api.__test.createPartAssembly(moduleCell, catalog.items[0], { x: 30, y: 40 }).assembly;
    const downstream = api.__test.firstAssemblyPart(assembly);
    api.__test.applyConnectionPartChoice(moduleCell, { cell: downstream, role: "input", index: 0 }, catalog.items[1]);
    api.openIrrigationMode(moduleCell, { preserveViewport: true });
    graph.setSelectionCell(downstream);
    assertConnectionRowReadOnly(graph.container, "Inlet 1");
});

test("selected port badges connect with automatic pipe choice and disconnect selected connections", () => {
    const { api, graph, moduleCell } = loadPlugin();
    api.writeCatalog(moduleCell, sampleCatalog());
    const source = api.__test.createSourceAssembly(moduleCell, "Well", { connectorType: "barb", nominalSize: "3/4", method: "drip", pipeConnection: true, usableFlowGpm: 5, staticPressurePsi: 45 }, { x: 30, y: 40 });
    const filter = api.__test.createPartAssembly(moduleCell, api.readCatalog(moduleCell).items.find(item => item.id === "filter"), { x: 30, y: 180 });
    api.openIrrigationMode(moduleCell, { preserveViewport: true });
    graph.setSelectionCells([source.assembly, filter.assembly]);
    clickPort(graph.container, /Outlet 1 free/);
    clickPort(graph.container, /Inlet 1 free/);
    assert.equal(graph.container.querySelector(".trellis-irrigation-mode-hud"), null);
    assert.equal(inlineConnectionActions(graph.container).length, 1);
    assert.equal(inlineConnectionActions(graph.container)[0].textContent, "Connect");
    assert.equal(buttonTexts(graph.container).filter(text => text === "Connect").length, 1);
    assert.equal(buttonTexts(graph.container).includes("Suggest Connection"), false);
    clickButton(graph.container, "Connect");
    const edge = api.__test.collectAssemblyEdges(moduleCell)[0];
    assert.ok(edge);
    assert.equal(edge.getAttribute(api.attrs.PIPE_PART_ID), "pipe_cheap");
    assert.equal(edge.getAttribute("label"), "3/4");
    graph.setSelectionCell(source.assembly);
    const outletRow = assertConnectionRowReadOnly(graph.container, "Outlet 1");
    assert.equal(outletRow.querySelector(".trellis-irrigation-pipe-row"), null);
    assert.doesNotMatch(outletRow.textContent, /Pipe:|cheap poly|planned|completed|Part added/i);
    graph.setSelectionCell(edge);
    assertConnectionHud(graph.container, /Pipe:\s*3\/4/);
    assert.equal(inlineConnectionActions(graph.container).length, 0);
    graph.setSelectionCells([source.assembly, filter.assembly]);
    clickPort(graph.container, /Outlet 1 connected/);
    assert.ok(portBadgesInState(graph.container, "selected").length >= 2);
    assertInlineConnectionAction(graph.container, "Disconnect");
    assert.equal(buttonTexts(graph.container).includes("Disconnect Parts"), false);
    clickButton(graph.container, "Disconnect");
    assert.equal(api.__test.collectAssemblyEdges(moduleCell).length, 0);
});

test("same-role free badges show Flip and Connect and flip the lower disconnected fitting", () => {
    const { api, graph, moduleCell } = loadPlugin();
    const catalog = flipConnectCatalog();
    api.writeCatalog(moduleCell, catalog);
    const upper = api.__test.createPartAssembly(moduleCell, catalog.items.find(item => item.id === "male_out_fit"), { x: 30, y: 40 });
    const lower = api.__test.createPartAssembly(moduleCell, catalog.items.find(item => item.id === "female_out_fit"), { x: 30, y: 180 });
    const upperPart = api.__test.firstAssemblyPart(upper.assembly);
    const lowerPart = api.__test.firstAssemblyPart(lower.assembly);
    assert.equal(api.__test.connectionDecisionForPorts(moduleCell, { cellId: upperPart.getId(), role: "output", index: 0 }, { cellId: lowerPart.getId(), role: "output", index: 0 }).ok, false);
    assert.equal(api.__test.flipConnectPlanForPorts(moduleCell, [{ cellId: upperPart.getId(), role: "output", index: 0 }, { cellId: lowerPart.getId(), role: "output", index: 0 }]).flipCell, lowerPart);
    api.openIrrigationMode(moduleCell, { preserveViewport: true });
    graph.setSelectionCells([upper.assembly, lower.assembly]);
    clickPort(graph.container, /Outlet 1 free.*MGHT/);
    assert.equal(portBadgesInState(graph.container, "compatible").some(node => /Outlet 1 free compatible.*FGHT/.test(node.title)), true);
    clickPort(graph.container, /Outlet 1 free.*FGHT/);
    assert.equal(buttonTexts(graph.container).filter(text => text === "Connect").length, 0);
    assertInlineConnectionAction(graph.container, "Flip and Connect");
    clickButton(graph.container, "Flip and Connect");
    assert.equal(api.__test.isPartCellFlipped(lowerPart), true);
    assert.equal(api.__test.isPartCellFlipped(upperPart), false);
    assert.equal(lowerPart.parent, upper.assembly);
});

test("Flip and Connect flips the disconnected other fitting when one selected part is connected", () => {
    const { api, graph, moduleCell } = loadPlugin();
    const catalog = flipConnectCatalog();
    api.writeCatalog(moduleCell, catalog);
    const source = api.__test.createSourceAssembly(moduleCell, "Hose", { connectorType: "mght", nominalSize: "3/4", usableFlowGpm: 5, staticPressurePsi: 45 }, { x: 30, y: 40 });
    const upper = api.__test.createPartAssembly(moduleCell, catalog.items.find(item => item.id === "male_out_fit"), { x: 30, y: 180 });
    const upperPart = api.__test.firstAssemblyPart(upper.assembly);
    assert.equal(api.__test.createAssemblyConnection(moduleCell, { cellId: api.__test.firstAssemblyPart(source.assembly).getId(), role: "output", index: 0 }, { cellId: upperPart.getId(), role: "input", index: 0 }).ok, true);
    const lower = api.__test.createPartAssembly(moduleCell, catalog.items.find(item => item.id === "female_out_fit"), { x: 300, y: 180 });
    const lowerPart = api.__test.firstAssemblyPart(lower.assembly);
    const plan = api.__test.flipConnectPlanForPorts(moduleCell, [{ cellId: upperPart.getId(), role: "output", index: 0 }, { cellId: lowerPart.getId(), role: "output", index: 0 }]);
    assert.equal(plan.ok, true, plan.reason);
    assert.equal(plan.flipCell, lowerPart);
    api.openIrrigationMode(moduleCell, { preserveViewport: true });
    graph.setSelectionCells([source.assembly, lower.assembly]);
    clickPort(graph.container, /Outlet 1 free.*MGHT/);
    clickPort(graph.container, /Outlet 1 free.*FGHT/);
    clickButton(graph.container, "Flip and Connect");
    assert.equal(api.__test.isPartCellFlipped(lowerPart), true);
    assert.equal(api.__test.isPartCellFlipped(upperPart), false);
    assert.equal(lowerPart.parent, source.assembly);
});

test("Flip and Connect is hidden when both selected parts already have any connection", () => {
    const { api, graph, moduleCell } = loadPlugin();
    const catalog = flipConnectCatalog();
    api.writeCatalog(moduleCell, catalog);
    const sourceA = api.__test.createSourceAssembly(moduleCell, "Hose A", { connectorType: "mght", nominalSize: "3/4", usableFlowGpm: 5, staticPressurePsi: 45 }, { x: 30, y: 40 });
    const sourceB = api.__test.createSourceAssembly(moduleCell, "Hose B", { connectorType: "mght", nominalSize: "3/4", usableFlowGpm: 5, staticPressurePsi: 45 }, { x: 300, y: 40 });
    const upper = api.__test.createPartAssembly(moduleCell, catalog.items.find(item => item.id === "male_out_fit"), { x: 30, y: 180 });
    const lower = api.__test.createPartAssembly(moduleCell, catalog.items.find(item => item.id === "female_out_fit"), { x: 300, y: 180 });
    const upperPart = api.__test.firstAssemblyPart(upper.assembly);
    const lowerPart = api.__test.firstAssemblyPart(lower.assembly);
    assert.equal(api.__test.createAssemblyConnection(moduleCell, { cellId: api.__test.firstAssemblyPart(sourceA.assembly).getId(), role: "output", index: 0 }, { cellId: upperPart.getId(), role: "input", index: 0 }).ok, true);
    assert.equal(api.__test.createAssemblyConnection(moduleCell, { cellId: api.__test.firstAssemblyPart(sourceB.assembly).getId(), role: "output", index: 0 }, { cellId: lowerPart.getId(), role: "input", index: 0 }).ok, true);
    const plan = api.__test.flipConnectPlanForPorts(moduleCell, [{ cellId: upperPart.getId(), role: "output", index: 0 }, { cellId: lowerPart.getId(), role: "output", index: 0 }]);
    assert.equal(plan.ok, false);
    assert.match(plan.reason, /Both selected parts/);
    api.openIrrigationMode(moduleCell, { preserveViewport: true });
    graph.setSelectionCells([sourceA.assembly, sourceB.assembly]);
    clickPort(graph.container, /Outlet 1 free.*MGHT/);
    clickPort(graph.container, /Outlet 1 free.*FGHT/);
    assert.equal(buttonTexts(graph.container).includes("Flip and Connect"), false);
    assert.equal(buttonTexts(graph.container).filter(text => text === "Connect").length, 0);
});

test("Flip and Connect falls back to the only flippable fitting when the lower preferred part is not reversible", () => {
    const { api, graph, moduleCell } = loadPlugin();
    const catalog = flipConnectCatalog();
    api.writeCatalog(moduleCell, catalog);
    const upper = api.__test.createPartAssembly(moduleCell, catalog.items.find(item => item.id === "male_out_fit"), { x: 30, y: 40 });
    const lower = api.__test.createPartAssembly(moduleCell, catalog.items.find(item => item.id === "female_out_filter"), { x: 30, y: 220 });
    const upperPart = api.__test.firstAssemblyPart(upper.assembly);
    const lowerPart = api.__test.firstAssemblyPart(lower.assembly);
    const plan = api.__test.flipConnectPlanForPorts(moduleCell, [{ cellId: upperPart.getId(), role: "output", index: 0 }, { cellId: lowerPart.getId(), role: "output", index: 0 }]);
    assert.equal(plan.ok, true, plan.reason);
    assert.equal(plan.flipCell, upperPart);
    api.openIrrigationMode(moduleCell, { preserveViewport: true });
    graph.setSelectionCells([upper.assembly, lower.assembly]);
    clickPort(graph.container, /Outlet 1 free.*MGHT/);
    clickPort(graph.container, /Outlet 1 free.*FGHT/);
    clickButton(graph.container, "Flip and Connect");
    assert.equal(api.__test.isPartCellFlipped(upperPart), true);
    assert.equal(api.__test.isPartCellFlipped(lowerPart), false);
    assert.equal(upperPart.parent, lower.assembly);
});

test("only one-inlet one-outlet fittings are reversible for flip and connect", () => {
    const { api, moduleCell } = loadPlugin();
    const catalog = flipConnectCatalog();
    api.writeCatalog(moduleCell, catalog);
    assert.equal(api.__test.isReversibleFittingPart(catalog.items.find(item => item.id === "male_out_fit")), true);
    assert.equal(api.__test.isReversibleFittingPart(catalog.items.find(item => item.id === "female_out_filter")), false);
    const first = api.__test.createPartAssembly(moduleCell, catalog.items.find(item => item.id === "female_out_filter"), { x: 30, y: 40 });
    const second = api.__test.createPartAssembly(moduleCell, catalog.items.find(item => item.id === "female_out_filter"), { x: 30, y: 180 });
    const firstPart = api.__test.firstAssemblyPart(first.assembly);
    const secondPart = api.__test.firstAssemblyPart(second.assembly);
    const plan = api.__test.flipConnectPlanForPorts(moduleCell, [{ cellId: firstPart.getId(), role: "output", index: 0 }, { cellId: secondPart.getId(), role: "output", index: 0 }]);
    assert.equal(plan.ok, false);
    assert.match(plan.reason, /No reversible fitting/);
});

test("flipped fitting instances keep stored badge positions and reverse connector labels", () => { // CHANGE
    const { api, graph, moduleCell } = loadPlugin();
    const catalog = flipConnectCatalog();
    api.writeCatalog(moduleCell, catalog);
    const assembly = api.__test.createPartAssembly(moduleCell, catalog.items.find(item => item.id === "male_out_fit"), { x: 30, y: 120 });
    const partCell = api.__test.firstAssemblyPart(assembly.assembly);
    assert.equal(api.__test.portConnectorForCell(moduleCell, partCell, "input").type, "fght");
    assert.equal(api.__test.portConnectorForCell(moduleCell, partCell, "output").type, "mght");
    api.__test.setPartCellFlipped(partCell, true);
    assert.equal(api.__test.portConnectorForCell(moduleCell, partCell, "input").type, "mght");
    assert.equal(api.__test.portConnectorForCell(moduleCell, partCell, "output").type, "fght");
    api.openIrrigationMode(moduleCell, { preserveViewport: true });
    graph.setSelectionCell(assembly.assembly);
    const inlet = portBadges(graph.container).find(node => /Inlet 1 free.*MGHT/.test(node.title)); // CHANGE
    const outlet = portBadges(graph.container).find(node => /Outlet 1 free.*FGHT/.test(node.title)); // CHANGE
    assert.ok(inlet, "expected flipped stored input to stay on the inlet badge with the catalogue output label"); // CHANGE
    assert.ok(outlet, "expected flipped stored output to stay on the outlet badge with the catalogue input label"); // CHANGE
    assert.ok(parseInt(outlet.style.top, 10) > parseInt(inlet.style.top, 10), "stored outlet badge should remain below stored inlet badge"); // CHANGE
});

test("flipped connected fitting keeps occupied stored input on inlet side without changing edge target attrs", () => { // CHANGE
    const { api, graph, moduleCell } = loadPlugin(); // CHANGE
    const catalog = { items: [ // CHANGE
        part("barb_source_fit", "Barb Source Fit", "fitting", "in_stock", 4, 1, 1, "barb", "3/4", "barb", "3/4", { pressureLossPsi: 0.1 }, undefined, true), // CHANGE
        part("reversible_barb_fit", "Reversible Barb Fit", "fitting", "in_stock", 4, 1, 1, "barb", "3/4", "barb", "3/4", { pressureLossPsi: 0.1 }, undefined, true), // CHANGE
        part("pipe_cheap", "3/4 cheap poly", "pipe_tubing", "in_stock", 0, 1, 1, "barb", "3/4", "barb", "3/4", { innerDiameterIn: 0.824, hazenWilliamsC: 150 }, 0.25, true) // CHANGE
    ] }; // CHANGE
    api.writeCatalog(moduleCell, catalog); // CHANGE
    const source = api.__test.createPartAssembly(moduleCell, catalog.items[0], { x: 30, y: 40 }); // CHANGE
    const flipped = api.__test.createPartAssembly(moduleCell, catalog.items[1], { x: 30, y: 180 }); // CHANGE
    const sourcePart = api.__test.firstAssemblyPart(source.assembly); // CHANGE
    const flippedPart = api.__test.firstAssemblyPart(flipped.assembly); // CHANGE
    api.__test.setPartCellFlipped(flippedPart, true); // CHANGE
    const connected = api.__test.createAssemblyConnection(moduleCell, { cellId: sourcePart.getId(), role: "output", index: 0 }, { cellId: flippedPart.getId(), role: "input", index: 0 }); // CHANGE
    assert.equal(connected.ok, true, connected.reason); // CHANGE
    const edge = api.__test.collectAssemblyEdges(moduleCell)[0]; // CHANGE
    assert.equal(edge.target, flippedPart); // CHANGE
    assert.equal(edge.getAttribute(api.attrs.EDGE_TARGET_PORT), "0"); // CHANGE
    assertEdgeAnchors(edge, { exitY: "1", entryY: "0", entryPerimeter: "0" }); // CHANGE
    api.openIrrigationMode(moduleCell, { preserveViewport: true }); // CHANGE
    graph.setSelectionCells([source.assembly, flipped.assembly]); // CHANGE
    assert.ok(portBadgesInState(graph.container, "occupied").some(node => /Inlet 1 connected.*3\/4/.test(node.title)), "stored input should stay displayed as an occupied inlet"); // CHANGE
    graph.setSelectionCell(flipped.assembly); // CHANGE
    const inletRow = assertConnectionRowReadOnly(graph.container, "Inlet 1"); // CHANGE
    assert.match(inletRow.textContent, /connected: Barb Source Fit/); // CHANGE
    assert.match(connectionRow(graph.container, "Outlet 1").textContent, /Available: 3\/4 downstream connection/); // CHANGE
}); // CHANGE

test("flipped connected fitting keeps occupied stored output on outlet side without changing edge source attrs", () => { // CHANGE
    const { api, graph, moduleCell } = loadPlugin(); // CHANGE
    const catalog = { items: [ // CHANGE
        part("reversible_barb_fit", "Reversible Barb Fit", "fitting", "in_stock", 4, 1, 1, "barb", "3/4", "barb", "3/4", { pressureLossPsi: 0.1 }, undefined, true), // CHANGE
        part("barb_target_fit", "Barb Target Fit", "fitting", "in_stock", 4, 1, 1, "barb", "3/4", "barb", "3/4", { pressureLossPsi: 0.1 }, undefined, true), // CHANGE
        part("pipe_cheap", "3/4 cheap poly", "pipe_tubing", "in_stock", 0, 1, 1, "barb", "3/4", "barb", "3/4", { innerDiameterIn: 0.824, hazenWilliamsC: 150 }, 0.25, true) // CHANGE
    ] }; // CHANGE
    api.writeCatalog(moduleCell, catalog); // CHANGE
    const flipped = api.__test.createPartAssembly(moduleCell, catalog.items[0], { x: 30, y: 40 }); // CHANGE
    const target = api.__test.createPartAssembly(moduleCell, catalog.items[1], { x: 30, y: 180 }); // CHANGE
    const flippedPart = api.__test.firstAssemblyPart(flipped.assembly); // CHANGE
    const targetPart = api.__test.firstAssemblyPart(target.assembly); // CHANGE
    api.__test.setPartCellFlipped(flippedPart, true); // CHANGE
    const connected = api.__test.createAssemblyConnection(moduleCell, { cellId: flippedPart.getId(), role: "output", index: 0 }, { cellId: targetPart.getId(), role: "input", index: 0 }); // CHANGE
    assert.equal(connected.ok, true, connected.reason); // CHANGE
    const edge = api.__test.collectAssemblyEdges(moduleCell)[0]; // CHANGE
    assert.equal(edge.source, flippedPart); // CHANGE
    assert.equal(edge.getAttribute(api.attrs.EDGE_SOURCE_PORT), "0"); // CHANGE
    assertEdgeAnchors(edge, { exitY: "1", exitPerimeter: "0", entryY: "0" }); // CHANGE
    api.openIrrigationMode(moduleCell, { preserveViewport: true }); // CHANGE
    graph.setSelectionCells([flipped.assembly, target.assembly]); // CHANGE
    assert.ok(portBadgesInState(graph.container, "occupied").some(node => /Outlet 1 connected.*3\/4/.test(node.title)), "stored output should stay displayed as an occupied outlet"); // CHANGE
    graph.setSelectionCell(flipped.assembly); // CHANGE
    const outletRow = assertConnectionRowReadOnly(graph.container, "Outlet 1"); // CHANGE
    assert.match(outletRow.textContent, /connected: Barb Target Fit/); // CHANGE
    assert.match(connectionRow(graph.container, "Inlet 1").textContent, /Available: 3\/4 upstream connection/); // CHANGE
}); // CHANGE

test("connection HUD hides port row and updates pipe edge style", () => {
    const { api, graph, moduleCell } = loadPlugin();
    api.writeCatalog(moduleCell, sampleCatalog());
    const source = api.__test.createSourceAssembly(moduleCell, "Well", { connectorType: "barb", nominalSize: "3/4", method: "drip", pipeConnection: true, usableFlowGpm: 5, staticPressurePsi: 45 }, { x: 30, y: 40 });
    const filter = api.__test.createPartAssembly(moduleCell, api.readCatalog(moduleCell).items.find(item => item.id === "filter"), { x: 30, y: 180 });
    const connection = api.__test.createAssemblyConnection(moduleCell, { cellId: api.__test.firstAssemblyPart(source.assembly).getId(), role: "output", index: 0 }, { cellId: api.__test.firstAssemblyPart(filter.assembly).getId(), role: "input", index: 0 });
    assert.equal(connection.ok, true, connection.reason);
    const edge = connection.edge;
    api.openIrrigationMode(moduleCell, { preserveViewport: true });
    graph.setSelectionCell(edge);
    let hud = assertConnectionHud(graph.container, /Pipe:\s*3\/4/);
    assert.doesNotMatch(hud.textContent, /Outlet 1\s*->\s*Inlet 1/);
    assert.ok(buttonTexts(hud).includes("Straight"));
    assert.ok(buttonTexts(hud).includes("Curved"));
    assert.equal(Array.from(hud.querySelectorAll("button")).find(node => node.textContent.trim() === "Straight").getAttribute("aria-pressed"), "true");
    assert.equal(api.__test.pipeEdgeStyleMode(edge), "straight");

    clickExactButton(hud, "Curved");
    assert.equal(edge.getAttribute(api.attrs.PIPE_EDGE), "1");
    assert.equal(edge.getAttribute(api.attrs.PIPE_PART_ID), "pipe_cheap");
    assert.equal(api.__test.pipeEdgeStyleMode(edge), "curved");
    assert.equal(styleToken(edge.style, "curved"), "1");
    api.__test.setPipeEdgeState(edge, api.__test.partStates.completed);
    assert.equal(api.__test.pipeEdgeStyleMode(edge), "curved");
    assert.equal(styleToken(edge.style, "strokeColor"), "#82b366");
    assert.equal(styleToken(edge.style, "dashed"), "1");

    graph.setSelectionCell(edge);
    hud = assertConnectionHud(graph.container, /Pipe:\s*3\/4/);
    assert.equal(Array.from(hud.querySelectorAll("button")).find(node => node.textContent.trim() === "Curved").getAttribute("aria-pressed"), "true");
    clickExactButton(hud, "Straight");
    assert.equal(api.__test.pipeEdgeStyleMode(edge), "straight");
    assert.equal(styleToken(edge.style, "curved"), "");
    assert.equal(edge.getAttribute(api.attrs.PIPE_EDGE), "1");
    assert.equal(edge.getAttribute(api.attrs.PIPE_PART_ID), "pipe_cheap");
});

test("inline port action controls avoid SVG overlay panes", () => {
    const { api, graph, moduleCell } = loadPlugin({ svgOverlayPane: true });
    api.writeCatalog(moduleCell, sampleCatalog());
    const source = api.__test.createSourceAssembly(moduleCell, "Well", { connectorType: "barb", nominalSize: "3/4", method: "drip", pipeConnection: true, usableFlowGpm: 5, staticPressurePsi: 45 }, { x: 30, y: 40 });
    const filter = api.__test.createPartAssembly(moduleCell, api.readCatalog(moduleCell).items.find(item => item.id === "filter"), { x: 30, y: 180 });
    api.openIrrigationMode(moduleCell, { preserveViewport: true });
    graph.setSelectionCells([source.assembly, filter.assembly]);
    clickPort(graph.container, /Outlet 1 free/);
    clickPort(graph.container, /Inlet 1 free/);
    const action = assertInlineConnectionAction(graph.container, "Connect");
    assert.equal(action.parentNode.parentNode, graph.container);
    assert.equal(graph.view.overlayPane.querySelector(".trellis-irrigation-inline-connection-action"), null);
});

test("inline port action controls anchor to port badge DOM rect with graph scroll", () => {
    const { api, graph, moduleCell, document } = loadPlugin({ svgOverlayPane: true, clientWidth: 500, clientHeight: 360 });
    const originalRect = document.defaultView.HTMLElement.prototype.getBoundingClientRect;
    graph.container.scrollLeft = 40;
    graph.container.scrollTop = 25;
    graph.container.getBoundingClientRect = () => ({ left: 100, right: 600, top: 50, bottom: 410, width: 500, height: 360 });
    document.defaultView.HTMLElement.prototype.getBoundingClientRect = function () {
        if (this.classList && this.classList.contains("trellis-irrigation-port-badge") && /Inlet 1/.test(this.title || "")) return { left: 320, right: 340, top: 210, bottom: 228, width: 20, height: 18 };
        return originalRect.call(this);
    };
    try {
        api.writeCatalog(moduleCell, sampleCatalog());
        const source = api.__test.createSourceAssembly(moduleCell, "Well", { connectorType: "barb", nominalSize: "3/4", method: "drip", pipeConnection: true, usableFlowGpm: 5, staticPressurePsi: 45 }, { x: 30, y: 40 });
        const filter = api.__test.createPartAssembly(moduleCell, api.readCatalog(moduleCell).items.find(item => item.id === "filter"), { x: 30, y: 180 });
        api.openIrrigationMode(moduleCell, { preserveViewport: true });
        graph.setSelectionCells([source.assembly, filter.assembly]);
        clickPort(graph.container, /Outlet 1 free/);
        clickPort(graph.container, /Inlet 1 free/);
        const action = assertInlineConnectionAction(graph.container, "Connect");
        assert.equal(action.parentNode.parentNode, graph.container);
        assert.equal(action.style.left, "286px");
        assert.equal(action.style.top, "180px");
    } finally {
        document.defaultView.HTMLElement.prototype.getBoundingClientRect = originalRect;
    }
});

test("internal connection badge selection shows only inline disconnect and stays mutually exclusive", () => {
    const { api, graph, moduleCell } = loadPlugin();
    const catalog = sampleCatalog();
    catalog.items.push(part("direct_a", "Direct A", "fitting", "in_stock", 1, 1, 1, "barb", "3/4", "mght", "3/4", { pressureLossPsi: 0.1 }, undefined, true));
    catalog.items.push(part("direct_b", "Direct B", "fitting", "in_stock", 1, 1, 1, "fght", "3/4", "mght", "3/4"));
    catalog.items.push(part("direct_c", "Direct C", "fitting", "in_stock", 1, 1, 1, "fght", "3/4", "mght", "3/4"));
    api.writeCatalog(moduleCell, catalog);
    const assembly = api.__test.createPartAssembly(moduleCell, api.readCatalog(moduleCell).items.find(item => item.id === "direct_c"), { x: 30, y: 40 }).assembly;
    api.__test.applyConnectionPartChoice(moduleCell, { cell: api.__test.firstAssemblyPart(assembly), role: "input", index: 0 }, api.readCatalog(moduleCell).items.find(item => item.id === "direct_b"));
    api.__test.applyConnectionPartChoice(moduleCell, { cell: api.__test.firstAssemblyPart(assembly), role: "input", index: 0 }, api.readCatalog(moduleCell).items.find(item => item.id === "direct_a"));
    const source = api.__test.createSourceAssembly(moduleCell, "Well", { connectorType: "barb", nominalSize: "3/4", method: "drip", pipeConnection: true, usableFlowGpm: 5, staticPressurePsi: 45 }, { x: 320, y: 40 });
    api.openIrrigationMode(moduleCell, { preserveViewport: true });
    assert.equal(api.__test.createAssemblyConnection(moduleCell, { cellId: api.__test.firstAssemblyPart(source.assembly).getId(), role: "output", index: 0 }, { cellId: api.__test.firstAssemblyPart(assembly).getId(), role: "input", index: 0 }).ok, true);
    graph.setSelectionCells([source.assembly, assembly]);
    assert.equal(internalConnectionBadges(graph.container).length, 2);
    internalConnectionBadges(graph.container)[0].click();
    assert.equal(selectedInternalConnectionBadges(graph.container).length, 1);
    assertInlineConnectionAction(graph.container, "Disconnect");
    assert.equal(buttonTexts(graph.container).includes("Disconnect Parts"), false);
    internalConnectionBadges(graph.container)[1].click();
    assert.equal(selectedInternalConnectionBadges(graph.container).length, 1);
    assertInlineConnectionAction(graph.container, "Disconnect");
    assert.equal(buttonTexts(graph.container).includes("Disconnect Parts"), false);
    selectedInternalConnectionBadges(graph.container)[0].click();
    assert.ok(graph.container.querySelector(".trellis-irrigation-local-hud"));
    assert.equal(inlineConnectionActions(graph.container).length, 0);
    internalConnectionBadges(graph.container)[0].click();
    assert.equal(selectedInternalConnectionBadges(graph.container).length, 1);
    clickPort(graph.container, /Outlet 1 connected/);
    assert.equal(selectedInternalConnectionBadges(graph.container).length, 0);
    assert.equal(graph.container.querySelectorAll(".trellis-irrigation-selected-pipe-highlight").length, 1);
    assertInlineConnectionAction(graph.container, "Disconnect");
    graph.setSelectionCell(assembly);
    internalConnectionBadges(graph.container)[0].click();
    assert.equal(graph.container.querySelectorAll(".trellis-irrigation-selected-pipe-highlight").length, 0);
    assert.equal(selectedInternalConnectionBadges(graph.container).length, 1);
    assertInlineConnectionAction(graph.container, "Disconnect");
});

test("free selected port badges FIFO-replace incompatible second ports", () => {
    const { api, graph, moduleCell } = loadPlugin();
    api.writeCatalog(moduleCell, sampleCatalog());
    const source = api.__test.createSourceAssembly(moduleCell, "Well", { connectorType: "barb", nominalSize: "3/4", method: "drip", pipeConnection: true, usableFlowGpm: 5, staticPressurePsi: 45 }, { x: 30, y: 40 });
    const valve = api.__test.createPartAssembly(moduleCell, api.readCatalog(moduleCell).items.find(item => item.id === "valve"), { x: 30, y: 180 });
    api.openIrrigationMode(moduleCell, { preserveViewport: true });
    graph.setSelectionCells([source.assembly, valve.assembly]);
    clickPort(graph.container, /Outlet 1 free/);
    clickPort(graph.container, /Inlet 1 free/);
    assert.deepEqual(selectedPortBadgeLabels(graph.container), ["3/4", "3/4"]);
    clickPort(graph.container, /Outlet 2 free/);
    assert.deepEqual(selectedPortBadgeLabels(graph.container), ["3/4"]);
    clickPort(graph.container, /Outlet 2 free selected/);
    assert.deepEqual(selectedPortBadgeLabels(graph.container), []);
});

test("free port selection keeps at most two ports and one port per part", () => {
    const { api, moduleCell } = loadPlugin();
    api.writeCatalog(moduleCell, sampleCatalog());
    const upstream = api.__test.createPartAssembly(moduleCell, api.readCatalog(moduleCell).items.find(item => item.id === "valve"), { x: 30, y: 40 });
    const alternateUpstream = api.__test.createPartAssembly(moduleCell, api.readCatalog(moduleCell).items.find(item => item.id === "valve"), { x: 260, y: 40 });
    const downstream = api.__test.createPartAssembly(moduleCell, api.readCatalog(moduleCell).items.find(item => item.id === "filter"), { x: 30, y: 180 });
    const upstreamPart = api.__test.firstAssemblyPart(upstream.assembly);
    const alternatePart = api.__test.firstAssemblyPart(alternateUpstream.assembly);
    const downstreamPart = api.__test.firstAssemblyPart(downstream.assembly);
    const session = { moduleCell, selectedPorts: [], selectedBoundaries: [] };
    api.__test.toggleSelectedPort(session, { cellId: downstreamPart.getId(), role: "input", index: 0 });
    api.__test.toggleSelectedPort(session, { cellId: upstreamPart.getId(), role: "output", index: 0 });
    assert.deepEqual(selectedPortKeys(api, session), [downstreamPart.getId() + ":input:0", upstreamPart.getId() + ":output:0"].sort());
    api.__test.toggleSelectedPort(session, { cellId: upstreamPart.getId(), role: "output", index: 1 });
    assert.deepEqual(selectedPortKeys(api, session), [downstreamPart.getId() + ":input:0", upstreamPart.getId() + ":output:1"].sort());
    api.__test.toggleSelectedPort(session, { cellId: alternatePart.getId(), role: "output", index: 0 });
    assert.deepEqual(selectedPortKeys(api, session), [alternatePart.getId() + ":output:0"].sort());
    api.__test.toggleSelectedPort(session, { cellId: alternatePart.getId(), role: "input", index: 0 });
    assert.deepEqual(selectedPortKeys(api, session), [alternatePart.getId() + ":input:0"].sort());
});

test("free port selection FIFO-replaces opposite-role connector-incompatible ports", () => {
    const { api, moduleCell } = loadPlugin();
    const catalog = { items: [
        part("threaded_target", "Threaded target", "fitting", "in_stock", 5, 1, 1, "fght", "3/4", "mpt", "3/4", { pressureLossPsi: 0.1 })
    ] };
    api.writeCatalog(moduleCell, catalog);
    const source = api.__test.createSourceAssembly(moduleCell, "Well", { connectorType: "barb", nominalSize: "3/4", method: "drip", pipeConnection: true, usableFlowGpm: 5, staticPressurePsi: 45 }, { x: 30, y: 40 });
    const adapter = api.__test.createPartAssembly(moduleCell, catalog.items[0], { x: 260, y: 40 });
    const adapterPart = api.__test.firstAssemblyPart(adapter.assembly);
    const session = { moduleCell, selectedPorts: [], selectedBoundaries: [] };
    api.__test.toggleSelectedPort(session, { cellId: source.assembly.getId(), role: "output", index: 0 });
    api.__test.toggleSelectedPort(session, { cellId: adapterPart.getId(), role: "input", index: 0 });
    assert.deepEqual(selectedPortKeys(api, session), [adapterPart.getId() + ":input:0"].sort());
});

test("port badges show size-only pipe labels and size-plus-type threaded labels", () => {
    const { api, graph, moduleCell } = loadPlugin();
    api.writeCatalog(moduleCell, sampleCatalog());
    api.__test.createSourceAssembly(moduleCell, "Well", { connectorType: "barb", nominalSize: "3/4", method: "drip", pipeConnection: true, usableFlowGpm: 5, staticPressurePsi: 45 }, { x: 30, y: 40 });
    api.__test.createPartAssembly(moduleCell, api.readCatalog(moduleCell).items.find(item => item.id === "fght_to_mpt"), { x: 280, y: 40 });
    api.openIrrigationMode(moduleCell, { preserveViewport: true });
    const labels = portBadges(graph.container).map(node => node.textContent.trim()).sort();
    assert.ok(labels.includes("3/4"), "pipe-style barb badge should show size only");
    assert.ok(labels.includes("3/4 FGHT"), "threaded inlet badge should include connector type");
    assert.ok(labels.includes("3/4 MPT"), "threaded outlet badge should include connector type");
    assert.equal(labels.some(label => /^I\d|O\d$/.test(label)), false);
});

test("selecting a free port clears the selected occupied edge port pair", () => {
    const { api, graph, moduleCell } = loadPlugin();
    api.writeCatalog(moduleCell, sampleCatalog());
    const source = api.__test.createSourceAssembly(moduleCell, "Well", { connectorType: "barb", nominalSize: "3/4", method: "drip", pipeConnection: true, usableFlowGpm: 5, staticPressurePsi: 45 }, { x: 30, y: 40 });
    const filter = api.__test.createPartAssembly(moduleCell, api.readCatalog(moduleCell).items.find(item => item.id === "filter"), { x: 30, y: 180 });
    api.__test.createAssemblyConnection(moduleCell, { cellId: api.__test.firstAssemblyPart(source.assembly).getId(), role: "output", index: 0 }, { cellId: api.__test.firstAssemblyPart(filter.assembly).getId(), role: "input", index: 0 });
    api.openIrrigationMode(moduleCell, { preserveViewport: true });
    graph.setSelectionCells([source.assembly, filter.assembly]);
    clickPort(graph.container, /Outlet 1 connected/);
    assert.equal(portBadgesInState(graph.container, "selected").filter(node => /connected selected/.test(node.title)).length, 2);
    clickPort(graph.container, /Outlet 1 free/);
    const selected = portBadgesInState(graph.container, "selected");
    assert.equal(selected.length, 1);
    assert.match(selected[0].title, /free selected/);
    assert.equal(selected.filter(node => /connected selected/.test(node.title)).length, 0);
});

test("pipe edge stroke width is proportional to nominal pipe size", () => {
    const { api, moduleCell } = loadPlugin();
    const catalog = sampleCatalog();
    catalog.items.push(part("pipe_quarter", "1/4 micro", "pipe_tubing", "in_stock", 0, 1, 1, "barb", "1/4", "barb", "1/4", { innerDiameterIn: 0.17, hazenWilliamsC: 150 }, 0.12, true));
    catalog.items.push(part("pipe_one", "1 inch mainline", "pipe_tubing", "in_stock", 0, 1, 1, "barb", "1", "barb", "1", { innerDiameterIn: 1.049, hazenWilliamsC: 150 }, 0.9, true));
    catalog.items.push(part("filter_quarter", "1/4 filter", "filter", "in_stock", 4, 1, 1, "barb", "1/4", "barb", "1/4", { pressureLossPsi: 0.1 }, undefined, true));
    catalog.items.push(part("filter_half", "1/2 filter", "filter", "in_stock", 4, 1, 1, "barb", "1/2", "barb", "1/2", { pressureLossPsi: 0.1 }, undefined, true));
    catalog.items.push(part("filter_one", "1 inch filter", "filter", "in_stock", 4, 1, 1, "barb", "1", "barb", "1", { pressureLossPsi: 0.1 }, undefined, true));
    api.writeCatalog(moduleCell, catalog);
    [["1/4", "filter_quarter", "1"], ["1/2", "filter_half", "2"], ["3/4", "filter", "3"], ["1", "filter_one", "4"]].forEach(([size, filterId, expected], index) => {
        const source = api.__test.createSourceAssembly(moduleCell, "Source " + size, { connectorType: "barb", nominalSize: size, pipeConnection: true, usableFlowGpm: 5, staticPressurePsi: 45 }, { x: 30 + index * 180, y: 40 });
        const filter = api.__test.createPartAssembly(moduleCell, catalog.items.find(item => item.id === filterId), { x: 30 + index * 180, y: 180 });
        const connection = api.__test.createAssemblyConnection(moduleCell, { cellId: api.__test.firstAssemblyPart(source.assembly).getId(), role: "output", index: 0 }, { cellId: api.__test.firstAssemblyPart(filter.assembly).getId(), role: "input", index: 0 });
        assert.equal(connection.ok, true);
        assert.equal(styleToken(connection.edge.style, "strokeWidth"), expected);
    });
});

test("direct link edges do not receive proportional pipe stroke widths", () => {
    const { api, moduleCell } = loadPlugin();
    const catalog = { items: [
        part("direct_valve", "Direct Valve", "valve", "in_stock", 10, 1, 2, "fpt", "3/4", "mpt", "3/4", { maxFlowGpm: 8 }),
        part("direct_filter", "Direct Filter", "filter", "in_stock", 10, 1, 1, "fpt", "3/4", "mpt", "3/4", { pressureLossPsi: 1 })
    ] };
    api.writeCatalog(moduleCell, catalog);
    const valve = api.__test.createPartAssembly(moduleCell, catalog.items[0], { x: 30, y: 40 });
    const filter = api.__test.createPartAssembly(moduleCell, catalog.items[1], { x: 30, y: 180 });
    const connection = api.__test.createAssemblyConnection(moduleCell, { cellId: api.__test.firstAssemblyPart(valve.assembly).getId(), role: "output", index: 0 }, { cellId: api.__test.firstAssemblyPart(filter.assembly).getId(), role: "input", index: 0 });
    assert.equal(connection.ok, true);
    assert.equal(connection.edge.getAttribute(api.attrs.DIRECT_LINK_EDGE), "1");
    assert.equal(styleToken(connection.edge.style, "strokeWidth"), "");
});

test("reused generated pipe edges are restyled from the current pipe part", () => {
    const { api, graph, moduleCell, bed } = loadPlugin();
    api.writeCatalog(moduleCell, sampleCatalog());
    const source = api.__test.createSourceEndpoint(moduleCell, "Source", { connectorType: "mght", nominalSize: "1/2", usableFlowGpm: 5, staticPressurePsi: 45 });
    const target = api.__test.createBedEndpoint(bed, "Target", { connectorType: "fght", nominalSize: "1/2" });
    const reusable = graph.insertEdge(moduleCell, "oldGenerated", "", source, target, "edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;strokeColor=#4d8f6f;strokeWidth=9;");
    api.__test.writePaths(moduleCell, [{ id: "reuse_path", sourceEndpointId: source.getId(), targetEndpointId: target.getId(), pipePartId: "pipe_cheap", pipeEdgeIds: [reusable.getId()], componentCellIds: [] }]);
    const staged = api.__test.stagePath({ id: "reuse_path", sourceEndpoint: source, targetEndpoint: target, pipePartId: "pipe_half", bedDemand: { flowGpm: 0, operatingPressurePsi: 0 } });
    const committed = api.__test.commitStagedPath(moduleCell, staged);
    assert.equal(committed.blockingErrors, undefined);
    assert.equal(committed.pipeEdgeIds[0], reusable.getId());
    assert.equal(styleToken(reusable.style, "strokeWidth"), "2");
});

test("irrigation mode renders global port badges and highlights compatible free targets", () => {
    const { api, graph, moduleCell } = loadPlugin();
    api.writeCatalog(moduleCell, sampleCatalog());
    const source = api.__test.createSourceAssembly(moduleCell, "Well", { connectorType: "barb", nominalSize: "3/4", method: "drip", pipeConnection: true, usableFlowGpm: 5, staticPressurePsi: 45 }, { x: 30, y: 40 });
    const filter = api.__test.createPartAssembly(moduleCell, api.readCatalog(moduleCell).items.find(item => item.id === "filter"), { x: 280, y: 40 });
    api.__test.createPartAssembly(moduleCell, api.readCatalog(moduleCell).items.find(item => item.id === "fght_to_mpt"), { x: 520, y: 40 });
    api.openIrrigationMode(moduleCell, { preserveViewport: true });
    assert.equal(portBadges(graph.container).length, 5);
    clickPort(graph.container, /Outlet 1 free/);
    assert.equal(portBadgesInState(graph.container, "selected").length, 1);
    assert.equal(portBadgesInState(graph.container, "compatible").length, 1);
    assert.match(portBadgesInState(graph.container, "compatible")[0].title, /Inlet 1 free compatible/);
    portBadgesInState(graph.container, "compatible")[0].click();
    assert.equal(portBadgesInState(graph.container, "compatible").length, 0);
    assert.equal(graph.container.querySelector(".trellis-irrigation-mode-hud"), null);
    assert.equal(inlineConnectionActions(graph.container).length, 1);
    assert.equal(inlineConnectionActions(graph.container)[0].textContent, "Connect");
    assert.equal(buttonTexts(graph.container).filter(text => text === "Connect").length, 1);
    assert.equal(graph.getSelectionCell(), filter.assembly);
    clickButton(graph.container, "Connect");
    assert.equal(api.__test.collectAssemblyEdges(moduleCell).length, 1);
    assert.ok(graph.container.querySelector(".trellis-irrigation-mode-hud"));
    assert.equal(inlineConnectionActions(graph.container).length, 0);
    graph.setSelectionCells([source.assembly, filter.assembly]);
    assert.ok(portBadgesInState(graph.container, "occupied").length >= 2);
    assert.equal(portBadgesInState(graph.container, "compatible").length, 0);
    clickPort(graph.container, /Outlet 1 connected/);
    assert.equal(graph.container.querySelectorAll(".trellis-irrigation-selected-pipe-highlight").length, 1);
    assert.ok(portBadgesInState(graph.container, "selected").length >= 2);
    assertInlineConnectionAction(graph.container, "Disconnect");
    assert.equal(buttonTexts(graph.container).includes("Disconnect Parts"), false);
    clickButton(graph.container, "Disconnect");
    assert.equal(graph.container.querySelectorAll(".trellis-irrigation-selected-pipe-highlight").length, 0);
});

test("single selected port compatibility scan stays quiet while highlighting targets", () => {
    const consoleLogs = [];
    const { api, graph, moduleCell } = loadPlugin({ consoleLogs });
    api.writeCatalog(moduleCell, sampleCatalog());
    api.__test.createSourceAssembly(moduleCell, "Well", { connectorType: "barb", nominalSize: "3/4", method: "drip", pipeConnection: true, usableFlowGpm: 5, staticPressurePsi: 45 }, { x: 30, y: 40 });
    api.__test.createPartAssembly(moduleCell, api.readCatalog(moduleCell).items.find(item => item.id === "filter"), { x: 280, y: 40 });
    api.__test.createPartAssembly(moduleCell, api.readCatalog(moduleCell).items.find(item => item.id === "fght_to_mpt"), { x: 520, y: 40 });
    api.openIrrigationMode(moduleCell, { preserveViewport: true });
    consoleLogs.length = 0;
    clickPort(graph.container, /Outlet 1 free/);
    assert.equal(portBadgesInState(graph.container, "selected").length, 1);
    assert.equal(portBadgesInState(graph.container, "compatible").length, 1);
    const labels = irrigationLogLabels(consoleLogs);
    assert.equal(labels.some(label => /flipConnectPlan:/.test(label)), false);
    assert.equal(labels.some(label => label === "[Trellis Irrigation] connectorConnectionMode:rejected"), false);
});

test("direct compatible reversible ports prefer Connect over Flip and Connect", () => {
    const { api, graph, moduleCell } = loadPlugin();
    const catalog = flipConnectCatalog();
    api.writeCatalog(moduleCell, catalog);
    const upper = api.__test.createPartAssembly(moduleCell, catalog.items.find(item => item.id === "male_out_fit"), { x: 30, y: 40 });
    const lower = api.__test.createPartAssembly(moduleCell, catalog.items.find(item => item.id === "female_out_fit"), { x: 30, y: 180 });
    api.openIrrigationMode(moduleCell, { preserveViewport: true });
    graph.setSelectionCells([upper.assembly, lower.assembly]);
    clickPort(graph.container, /Outlet 1 free.*MGHT/);
    const compatibleInlet = portBadgesInState(graph.container, "compatible").find(node => /Inlet 1 free compatible.*FGHT/.test(node.title));
    assert.ok(compatibleInlet, "expected compatible reversible inlet");
    compatibleInlet.click();
    assertInlineConnectionAction(graph.container, "Connect");
    assert.equal(buttonTexts(graph.container).includes("Flip and Connect"), false);
});

test("stored direct pair with flipped target still uses stored-role Connect", () => { // CHANGE
    const consoleLogs = [];
    const { api, graph, moduleCell } = loadPlugin({ consoleLogs });
    const catalog = flipConnectCatalog();
    api.writeCatalog(moduleCell, catalog);
    const upper = api.__test.createPartAssembly(moduleCell, catalog.items.find(item => item.id === "male_out_fit"), { x: 30, y: 40 });
    const lower = api.__test.createPartAssembly(moduleCell, catalog.items.find(item => item.id === "female_out_fit"), { x: 30, y: 180 });
    const upperPart = api.__test.firstAssemblyPart(upper.assembly);
    const lowerPart = api.__test.firstAssemblyPart(lower.assembly);
    api.__test.setPartCellFlipped(lowerPart, true);
    const storedSource = { cellId: upperPart.getId(), role: "output", index: 0 };
    const storedTarget = { cellId: lowerPart.getId(), role: "input", index: 0 };
    assert.equal(api.__test.connectionDecisionForPorts(moduleCell, storedSource, storedTarget).ok, true);
    api.openIrrigationMode(moduleCell, { preserveViewport: true });
    graph.setSelectionCells([upper.assembly, lower.assembly]);
    consoleLogs.length = 0;
    clickPort(graph.container, /Outlet 1 free.*MGHT/);
    const compatibleStoredInlet = portBadgesInState(graph.container, "compatible").find(node => /Inlet 1 free compatible.*FGHT/.test(node.title)); // CHANGE
    assert.ok(compatibleStoredInlet, "expected flipped stored inlet to remain a compatible inlet"); // CHANGE
    compatibleStoredInlet.click();
    assertInlineConnectionAction(graph.container, "Connect"); // CHANGE
    assert.equal(buttonTexts(graph.container).includes("Flip and Connect"), false); // CHANGE
    assert.equal(irrigationLogsWithLabel(consoleLogs, "inlineConnectionAction:visual-direct-rejected").length, 0); // CHANGE
    clickButton(graph.container, "Connect"); // CHANGE
    assert.equal(api.__test.isPartCellFlipped(lowerPart), true); // CHANGE
    assert.equal(api.__test.isPartCellFlipped(upperPart), false);
    assert.equal(lowerPart.parent, upper.assembly);
    assert.equal(portBadgesInState(graph.container, "selected").length, 0);
});

test("Flip and Connect keeps pipe edge anchors stored-role based and reverses badge labels", () => { // CHANGE
    const { api, graph, moduleCell } = loadPlugin(); // NEW
    const catalog = { items: [ // NEW
        part("push_valve", "Push Valve", "valve", "in_stock", 10, 1, 2, "push_connect", "1/2", "push_connect", "1/2", { maxFlowGpm: 8 }, undefined, true), // NEW
        { id: "reversible_push_fit", name: "Reversible Push Fit", category: "fitting", stockState: "in_stock", cost: 4, connectors: { inputs: 1, outputs: 1, input: { type: "mpt", nominalSize: "1/2" }, output: { type: "push_connect", nominalSize: "1/2", pipeConnection: true } }, specs: { pressureLossPsi: 0.1 } }, // CHANGE
        part("pipe_half_push", "1/2 push pipe", "pipe_tubing", "in_stock", 0, 1, 1, "push_connect", "1/2", "push_connect", "1/2", { innerDiameterIn: 0.6 }, 0.32, true) // NEW
    ] }; // NEW
    api.writeCatalog(moduleCell, catalog); // NEW
    const source = api.__test.createPartAssembly(moduleCell, catalog.items[0], { x: 30, y: 40 }); // NEW
    const target = api.__test.createPartAssembly(moduleCell, catalog.items[1], { x: 30, y: 200 }); // NEW
    const sourcePart = api.__test.firstAssemblyPart(source.assembly); // NEW
    const targetPart = api.__test.firstAssemblyPart(target.assembly); // NEW
    api.openIrrigationMode(moduleCell, { preserveViewport: true }); // NEW
    graph.setSelectionCells([source.assembly, target.assembly]); // NEW
    clickPort(graph.container, /Outlet 2 free.*1\/2/); // NEW
    const compatibleOutlet = portBadgesInState(graph.container, "compatible").find(node => /Outlet 1 free compatible.*1\/2/.test(node.title)); // NEW
    assert.ok(compatibleOutlet, "expected target outlet to be flip-connect compatible"); // NEW
    compatibleOutlet.click(); // NEW
    clickButton(graph.container, "Flip and Connect"); // NEW
    assert.equal(api.__test.isPartCellFlipped(targetPart), true); // NEW
    const edge = api.__test.collectAssemblyEdges(moduleCell)[0]; // NEW
    assert.ok(edge, "expected Flip and Connect to create a pipe edge"); // NEW
    assert.equal(edge.source, sourcePart); // NEW
    assert.equal(edge.target, targetPart); // NEW
    assert.equal(edge.getAttribute(api.attrs.EDGE_SOURCE_PORT), "1"); // NEW
    assert.equal(edge.getAttribute(api.attrs.EDGE_TARGET_PORT), "0"); // NEW
    assertEdgeAnchors(edge, { exitX: "0.67", exitY: "1", entryY: "0" }); // CHANGE
    assert.ok(portBadges(graph.container).some(node => /Inlet 1 connected.*1\/2/.test(node.title)), "flipped stored inlet should show the catalogue output connector label"); // NEW
    assert.ok(portBadges(graph.container).some(node => /Outlet 1 free.*1\/2 MPT/.test(node.title)), "flipped stored outlet should show the catalogue input connector label"); // NEW
}); // NEW

test("same-role reversible pipe size mismatch FIFO-replaces the previous selected port", () => {
    const consoleLogs = [];
    const { api, graph, moduleCell } = loadPlugin({ consoleLogs });
    const catalog = { items: [
        part("upper_pipe_fit", "Upper pipe fitting", "fitting", "in_stock", 4, 1, 1, "barb", "3/4", "barb", "1/2", { pressureLossPsi: 0.1 }, undefined, true),
        part("lower_pipe_fit", "Lower pipe fitting", "fitting", "in_stock", 4, 1, 1, "barb", "3/4", "barb", "1/4", { pressureLossPsi: 0.1 }, undefined, true)
    ] };
    api.writeCatalog(moduleCell, catalog);
    const upper = api.__test.createPartAssembly(moduleCell, catalog.items[0], { x: 30, y: 40 });
    const lower = api.__test.createPartAssembly(moduleCell, catalog.items[1], { x: 30, y: 180 });
    api.openIrrigationMode(moduleCell, { preserveViewport: true });
    graph.setSelectionCells([upper.assembly, lower.assembly]);
    clickPort(graph.container, /Outlet 1 free.*1\/2/);
    consoleLogs.length = 0;
    clickPort(graph.container, /Outlet 1 free.*1\/4/);
    assert.equal(portBadgesInState(graph.container, "selected").length, 1); // CHANGE
    assert.match(portBadgesInState(graph.container, "selected")[0].title, /Outlet 1 free selected.*1\/4/); // CHANGE
    assert.equal(inlineConnectionActions(graph.container).length, 0);
    assert.equal(buttonTexts(graph.container).includes("Connect"), false);
    assert.equal(buttonTexts(graph.container).includes("Flip and Connect"), false);
    const summaries = irrigationLogsWithLabel(consoleLogs, "inlineConnectionAction:flip-size-mismatch");
    assert.equal(summaries.length, 0); // CHANGE
});

test("multi-output dropdowns create branches and make occupied branch rows read-only", () => {
    const { api, graph, moduleCell } = loadPlugin();
    api.writeCatalog(moduleCell, sampleCatalog());
    const valveAssembly = api.__test.createPartAssembly(moduleCell, api.readCatalog(moduleCell).items.find(item => item.id === "valve"), { x: 30, y: 40 }).assembly;
    const valve = api.__test.firstAssemblyPart(valveAssembly);
    api.openIrrigationMode(moduleCell, { preserveViewport: true });
    graph.setSelectionCell(valve);
    chooseConnectionPart(graph.container, "Outlet 2", "filter");
    let edges = api.__test.collectAssemblyEdges(moduleCell);
    assert.equal(edges.length, 1);
    assert.equal(edges[0].getAttribute(api.attrs.EDGE_SOURCE_PORT), "1");
    assert.equal(edges[0].target.getAttribute(api.attrs.CATALOG_PART_ID), "filter");
    assert.equal(edges[0].getAttribute(api.attrs.PIPE_EDGE), "1");
    assert.equal(edges[0].getAttribute(api.attrs.PIPE_PART_ID), "pipe_cheap");
    graph.setSelectionCell(valve);
    assertConnectionRowReadOnly(graph.container, "Outlet 2");
    edges = api.__test.collectAssemblyEdges(moduleCell);
    assert.equal(edges.length, 1);
    assert.equal(edges[0].target.getAttribute(api.attrs.CATALOG_PART_ID), "filter");
    assert.equal(edges[0].getAttribute(api.attrs.PIPE_EDGE), "1");
    assert.equal(edges[0].getAttribute(api.attrs.PIPE_PART_ID), "pipe_cheap");
    assert.equal(assemblyCells(moduleCell, api).filter(cell => cell.getAttribute(api.attrs.ASSEMBLY_TYPE) === "parts").length, 2);
});

test("occupied branch replacement keeps stored-role anchors for flipped canonical parts", () => { // CHANGE
    const { api, moduleCell } = loadPlugin(); // CHANGE
    const catalog = { items: [ // NEW
        part("push_valve", "Push Valve", "valve", "in_stock", 10, 1, 2, "push_connect", "1/2", "push_connect", "1/2", { maxFlowGpm: 8 }, undefined, true), // NEW
        part("push_filter", "Push Filter", "filter", "in_stock", 10, 1, 1, "push_connect", "1/2", "push_connect", "1/2", { pressureLossPsi: 1 }, undefined, true), // NEW
        part("pipe_half_push", "1/2 push pipe", "pipe_tubing", "in_stock", 0, 1, 1, "push_connect", "1/2", "push_connect", "1/2", { innerDiameterIn: 0.6 }, 0.32, true), // NEW
        { id: "mpt_to_push_adapter", name: "MPT to push adapter", category: "fitting", stockState: "in_stock", cost: 4, connectors: { inputs: 1, outputs: 1, input: { type: "mpt", nominalSize: "1/2" }, output: { type: "push_connect", nominalSize: "1/2", pipeConnection: true } }, specs: { pressureLossPsi: 0.2 } } // NEW
    ] }; // NEW
    api.writeCatalog(moduleCell, catalog); // NEW
    const valveAssembly = api.__test.createPartAssembly(moduleCell, catalog.items[0], { x: 30, y: 40 }).assembly; // NEW
    const valve = api.__test.firstAssemblyPart(valveAssembly); // NEW
    let result = api.__test.applyConnectionPartChoice(moduleCell, { cell: valve, role: "output", index: 1 }, catalog.items[1]); // CHANGE
    assert.ok(result.cell, result.message); // NEW
    let edge = api.__test.collectAssemblyEdges(moduleCell)[0]; // NEW
    assert.equal(edge.getAttribute(api.attrs.EDGE_SOURCE_PORT), "1"); // NEW
    assert.equal(edge.getAttribute(api.attrs.EDGE_TARGET_PORT), "0"); // NEW
    assertEdgeAnchors(edge, { exitX: "0.67", exitY: "1", entryY: "0" }); // NEW
    result = api.__test.applyConnectionPartChoice(moduleCell, { cell: valve, role: "output", index: 1 }, catalog.items[3]); // CHANGE
    assert.ok(result.cell, result.message); // NEW
    edge = api.__test.collectAssemblyEdges(moduleCell)[0]; // NEW
    assert.equal(edge.getAttribute(api.attrs.EDGE_SOURCE_PORT), "1"); // NEW
    assert.equal(edge.getAttribute(api.attrs.EDGE_TARGET_PORT), "0"); // NEW
    assert.equal(edge.target.getAttribute(api.attrs.CATALOG_PART_ID), "mpt_to_push_adapter"); // NEW
    assert.equal(edge.target.getAttribute(api.attrs.PART_FLIPPED), "1"); // NEW
    assertEdgeAnchors(edge, { exitX: "0.67", exitY: "1", entryY: "0" }); // CHANGE
}); // NEW

test("occupied direct branch rows stay read-only without reclassifying links", () => {
    const { api, graph, moduleCell } = loadPlugin();
    const catalog = { items: [
        part("direct_valve", "Direct Valve", "valve", "in_stock", 10, 1, 2, "fpt", "3/4", "mpt", "3/4", { maxFlowGpm: 8 }),
        part("direct_filter", "Direct Filter", "filter", "in_stock", 10, 1, 1, "fpt", "3/4", "mpt", "3/4", { pressureLossPsi: 1 }),
        part("direct_regulator", "Direct Regulator", "regulator", "in_stock", 10, 1, 1, "fpt", "3/4", "mpt", "3/4", { pressureLossPsi: 1 })
    ] };
    api.writeCatalog(moduleCell, catalog);
    const valveAssembly = api.__test.createPartAssembly(moduleCell, catalog.items.find(item => item.id === "direct_valve"), { x: 30, y: 40 }).assembly;
    const valve = api.__test.firstAssemblyPart(valveAssembly);
    const filterAssembly = api.__test.createPartAssembly(moduleCell, catalog.items.find(item => item.id === "direct_filter"), { x: 30, y: 180 }).assembly;
    const filter = api.__test.firstAssemblyPart(filterAssembly);
    const connection = api.__test.createAssemblyConnection(moduleCell, { cellId: valve.getId(), role: "output", index: 1 }, { cellId: filter.getId(), role: "input", index: 0 });
    assert.equal(connection.ok, true, connection.reason);
    api.openIrrigationMode(moduleCell, { preserveViewport: true });
    graph.setSelectionCell(valve);
    let edge = api.__test.collectAssemblyEdges(moduleCell)[0];
    assert.equal(edge.getAttribute(api.attrs.DIRECT_LINK_EDGE), "1");
    assert.notEqual(edge.getAttribute(api.attrs.PIPE_EDGE), "1");
    assert.equal(edge.getAttribute(api.attrs.PIPE_PART_ID) || "", "");
    assert.equal(edge.getAttribute("label"), "3/4 MPT -> 3/4 FPT");
    graph.setSelectionCell(valve);
    assertConnectionRowReadOnly(graph.container, "Outlet 2");
    const edges = api.__test.collectAssemblyEdges(moduleCell);
    assert.equal(edges.length, 1);
    edge = edges[0];
    assert.equal(edge.target.getAttribute(api.attrs.CATALOG_PART_ID), "direct_filter");
    assert.equal(edge.getAttribute(api.attrs.DIRECT_LINK_EDGE), "1");
    assert.notEqual(edge.getAttribute(api.attrs.PIPE_EDGE), "1");
    assert.equal(edge.getAttribute(api.attrs.PIPE_PART_ID) || "", "");
    assert.equal(edge.getAttribute("label"), "3/4 MPT -> 3/4 FPT");
});

test("internal connection badges show compact right-side connectors with detailed titles", () => {
    const { api, graph, moduleCell } = loadPlugin();
    const catalog = { items: [
        part("direct_filter", "Direct Filter", "filter", "in_stock", 10, 1, 1, "fpt", "3/4", "mpt", "3/4", { pressureLossPsi: 1 }),
        part("direct_regulator", "Direct Regulator", "regulator", "in_stock", 10, 1, 1, "fpt", "3/4", "mpt", "3/4", { pressureLossPsi: 1 })
    ] };
    api.writeCatalog(moduleCell, catalog);
    const assembly = api.__test.createPartAssembly(moduleCell, catalog.items[0], { x: 30, y: 40 }).assembly;
    api.__test.applyConnectionPartChoice(moduleCell, { cell: api.__test.firstAssemblyPart(assembly), role: "input", index: 0 }, catalog.items[1]);
    api.openIrrigationMode(moduleCell, { preserveViewport: true });
    graph.setSelectionCell(assembly);
    const badge = internalConnectionBadges(graph.container)[0];
    assert.equal(badge.textContent.trim(), "C");
    assert.match(badge.title, /3\/4 MPT -> 3\/4 FPT/);
    const parts = api.__test.assemblyPartCells(assembly);
    const assemblyGeo = assembly.geometry;
    const up = parts[0].geometry;
    const down = parts[1].geometry;
    assert.equal(badge.style.left, Math.round(assemblyGeo.x + Math.max(up.x + up.width, down.x + down.width) + 4) + "px");
    assert.equal(badge.style.top, Math.round(assemblyGeo.y + (up.y + up.height + down.y) / 2 - 11) + "px");
});

test("occupied pipe branch rows stay read-only when matching tubing is unavailable", () => {
    const { api, graph, moduleCell } = loadPlugin();
    const catalog = sampleCatalog();
    api.writeCatalog(moduleCell, catalog);
    const valveAssembly = api.__test.createPartAssembly(moduleCell, catalog.items.find(item => item.id === "valve"), { x: 30, y: 40 }).assembly;
    const valve = api.__test.firstAssemblyPart(valveAssembly);
    api.openIrrigationMode(moduleCell, { preserveViewport: true });
    graph.setSelectionCell(valve);
    chooseConnectionPart(graph.container, "Outlet 1", "filter");
    assert.equal(api.__test.collectAssemblyEdges(moduleCell)[0].getAttribute(api.attrs.PIPE_PART_ID), "pipe_cheap");
    api.writeCatalog(moduleCell, { items: catalog.items.filter(item => item.category !== "pipe_tubing") });
    graph.setSelectionCell(valve);
    assertConnectionRowReadOnly(graph.container, "Outlet 1");
    const edges = api.__test.collectAssemblyEdges(moduleCell);
    assert.equal(edges.length, 1);
    assert.equal(edges[0].target.getAttribute(api.attrs.CATALOG_PART_ID), "filter");
    assert.equal(moduleCell.children.some(cell => cell.getAttribute && cell.getAttribute(api.attrs.PIPE_PART_ID) === ""), false);
});

test("occupied incompatible branch rows stay read-only until explicitly disconnected", () => {
    const { api, graph, moduleCell } = loadPlugin();
    const catalog = sampleCatalog();
    catalog.items.push(part("barb_to_mpt", "Barb to MPT", "fitting", "in_stock", 6, 1, 1, "barb", "3/4", "mpt", "3/4", {}));
    catalog.items.push(part("mpt_device", "MPT Device", "filter", "in_stock", 12, 1, 1, "mpt", "3/4", "mpt", "3/4", {}));
    api.writeCatalog(moduleCell, catalog);
    const valveAssembly = api.__test.createPartAssembly(moduleCell, catalog.items.find(item => item.id === "valve"), { x: 30, y: 40 }).assembly;
    const branchAssembly = api.__test.createPartAssembly(moduleCell, catalog.items.find(item => item.id === "barb_to_mpt"), { x: 30, y: 180 }).assembly;
    const second = api.__test.createPartAssembly(moduleCell, catalog.items.find(item => item.id === "mpt_device"), { x: 30, y: 300 }).partCell;
    appendChild(branchAssembly, second);
    second.parent = branchAssembly;
    second.geometry.y = 62; // CHANGE
    const valve = api.__test.firstAssemblyPart(valveAssembly);
    api.__test.createAssemblyConnection(moduleCell, { cellId: valve.getId(), role: "output", index: 0 }, { cellId: api.__test.firstAssemblyPart(branchAssembly).getId(), role: "input", index: 0 });
    const assemblyCountBefore = assemblyCells(moduleCell, api).filter(cell => cell.getAttribute(api.attrs.ASSEMBLY_TYPE) === "parts").length;
    api.openIrrigationMode(moduleCell, { preserveViewport: true });
    graph.setSelectionCell(valve);
    assertConnectionRowReadOnly(graph.container, "Outlet 1");
    const edges = api.__test.collectAssemblyEdges(moduleCell);
    assert.equal(edges.length, 1);
    assert.equal(edges[0].target.getAttribute(api.attrs.CATALOG_PART_ID), "barb_to_mpt");
    assert.equal(api.__test.firstAssemblyPart(branchAssembly).getAttribute(api.attrs.CATALOG_PART_ID), "barb_to_mpt");
    assert.equal(assemblyCells(moduleCell, api).filter(cell => cell.getAttribute(api.attrs.ASSEMBLY_TYPE) === "parts").length, assemblyCountBefore);
});

test("drag-created compatible edges normalize into one redoable edit", () => {
    const { api, graph, model, moduleCell } = loadPlugin();
    api.writeCatalog(moduleCell, sampleCatalog());
    const source = api.__test.createSourceAssembly(moduleCell, "Spray Source", { connectorType: "barb", nominalSize: "3/4", method: "sprinkler", pipeConnection: true, usableFlowGpm: 5, staticPressurePsi: 45 }, { x: 30, y: 40 });
    const filter = api.__test.createPartAssembly(moduleCell, api.readCatalog(moduleCell).items.find(item => item.id === "filter"), { x: 30, y: 180 });
    api.openIrrigationMode(moduleCell, { preserveViewport: true });
    const edge = graph.insertEdge(moduleCell, null, "", source.assembly, filter.assembly, "");
    model.completedEdits = [];
    graph.fireCellsAdded([edge]);
    assert.equal(model.completedEdits.length, 1);
    assert.equal(edge.getAttribute(api.attrs.PIPE_EDGE), "1");
    assert.equal(edge.getAttribute(api.attrs.PIPE_PART_ID), "pipe_cheap");
    assert.equal(edge.source, api.__test.firstAssemblyPart(source.assembly));
    assert.equal(edge.target, api.__test.firstAssemblyPart(filter.assembly));
    assert.ok(moduleCell.getAttribute(api.attrs.REPORT_JSON));
});

test("removed irrigation assemblies clean related edges in one redoable edit", () => {
    const { api, graph, model, moduleCell } = loadPlugin();
    api.writeCatalog(moduleCell, sampleCatalog());
    const source = api.__test.createSourceAssembly(moduleCell, "Source", { connectorType: "barb", nominalSize: "3/4", pipeConnection: true, usableFlowGpm: 5, staticPressurePsi: 45 }, { x: 30, y: 40 });
    const filter = api.__test.createPartAssembly(moduleCell, api.readCatalog(moduleCell).items.find(item => item.id === "filter"), { x: 30, y: 180 });
    const result = api.__test.createAssemblyConnection(moduleCell, { cellId: api.__test.firstAssemblyPart(source.assembly).getId(), role: "output", index: 0 }, { cellId: api.__test.firstAssemblyPart(filter.assembly).getId(), role: "input", index: 0 });
    assert.equal(result.ok, true, result.reason);
    const edge = api.__test.collectAssemblyEdges(moduleCell)[0];
    api.openIrrigationMode(moduleCell, { preserveViewport: true });
    model.completedEdits = [];
    graph.fireCellsRemoved([filter.assembly]);
    assert.equal(model.completedEdits.length, 1);
    assert.equal(model.removedCells.includes(edge), true);
    assert.ok(moduleCell.getAttribute(api.attrs.REPORT_JSON));
});

test("undo redo replay guard keeps add and remove listeners refresh-only", () => {
    const { api, graph, model, moduleCell, undoManager } = loadPlugin();
    api.writeCatalog(moduleCell, sampleCatalog());
    const source = api.__test.createSourceAssembly(moduleCell, "Spray Source", { connectorType: "barb", nominalSize: "3/4", method: "sprinkler", pipeConnection: true, usableFlowGpm: 5, staticPressurePsi: 45 }, { x: 30, y: 40 });
    const filter = api.__test.createPartAssembly(moduleCell, api.readCatalog(moduleCell).items.find(item => item.id === "filter"), { x: 30, y: 180 });
    api.openIrrigationMode(moduleCell, { preserveViewport: true });
    const edge = graph.insertEdge(moduleCell, null, "", source.assembly, filter.assembly, "");
    const writesBeforeReplay = model.valuesWritten;
    undoManager.onUndo = function () { graph.fireCellsAdded([edge]); };
    undoManager.undo();
    assert.equal(edge.getAttribute(api.attrs.PIPE_EDGE), null);
    assert.equal(model.valuesWritten, writesBeforeReplay);
    const removedBeforeReplay = model.removedCells.length;
    undoManager.onRedo = function () { graph.fireCellsRemoved([api.__test.firstAssemblyPart(filter.assembly)]); };
    undoManager.redo();
    assert.equal(model.removedCells.length, removedBeforeReplay);
});

test("1 inch barb connections auto-select 1 inch poly pipe edges", () => {
    const { api, moduleCell } = loadPlugin();
    api.writeCatalog(moduleCell, api.starterCatalog());
    const catalog = api.readCatalog(moduleCell);
    const source = api.__test.createSourceAssembly(moduleCell, "One inch source", { connectorType: "barb", nominalSize: "1", method: "drip", pipeConnection: true, usableFlowGpm: 10, staticPressurePsi: 45 }, { x: 30, y: 40 });
    const coupler = api.__test.createPartAssembly(moduleCell, catalog.items.find(item => item.id === "barb_coupler_1"), { x: 30, y: 180 });
    const connection = api.__test.createAssemblyConnection(moduleCell, { cellId: api.__test.firstAssemblyPart(source.assembly).getId(), role: "output", index: 0 }, { cellId: api.__test.firstAssemblyPart(coupler.assembly).getId(), role: "input", index: 0 });
    assert.equal(connection.ok, true, connection.reason);
    const edge = api.__test.collectAssemblyEdges(moduleCell)[0];
    assert.equal(edge.getAttribute(api.attrs.PIPE_PART_ID), "poly_mainline_1");
});

test("1/2 inch paths can suggest a 1/4 inch transfer barb into micro emitters", () => {
    const { api, moduleCell } = loadPlugin();
    api.writeCatalog(moduleCell, api.starterCatalog());
    const catalog = api.readCatalog(moduleCell);
    const source = api.__test.createSourceAssembly(moduleCell, "Half inch source", { connectorType: "barb", nominalSize: "1/2", method: "drip", pipeConnection: true, usableFlowGpm: 3, staticPressurePsi: 35 }, { x: 30, y: 40 });
    const emitter = api.__test.createPartAssembly(moduleCell, catalog.items.find(item => item.id === "micro_emitter_1_0_gph"), { x: 30, y: 180 });
    const sourcePort = { cellId: api.__test.firstAssemblyPart(source.assembly).getId(), role: "output", index: 0 };
    const targetPort = { cellId: api.__test.firstAssemblyPart(emitter.assembly).getId(), role: "input", index: 0 };
    const suggestions = api.__test.bridgeSuggestionsForPorts(moduleCell, sourcePort, targetPort);
    assert.ok(suggestions.some(suggestion => suggestion.partIds.includes("transfer_barb_1_2_to_1_4")));
});

test("Suggest Connection only proposes neutral adapter and fitting bridge parts", () => {
    const { api, moduleCell } = loadPlugin();
    const catalog = { items: [
        part("bridge_adapter", "Bridge Adapter", "fitting", "in_stock", 5, 1, 1, "fght", "3/4", "fpt", "3/4", { pressureLossPsi: 0.1 }),
        part("bridge_source_adapter", "Bridge Source Adapter", "source_adapter", "in_stock", 4, 1, 1, "fght", "3/4", "fpt", "3/4", { pressureLossPsi: 0.1 }),
        part("bridge_multi_output_tee", "Bridge Multi Output Tee", "fitting", "in_stock", 6, 1, 2, "fght", "3/4", "fpt", "3/4", { pressureLossPsi: 0.1 }),
        part("functional_filter", "Functional Filter", "filter", "in_stock", 20, 1, 1, "fght", "3/4", "fpt", "3/4", { pressureLossPsi: 1 }),
        part("functional_regulator", "Functional Regulator", "regulator", "in_stock", 18, 1, 1, "fght", "3/4", "fpt", "3/4", { pressureLossPsi: 1 }),
        part("functional_valve", "Functional Valve", "valve", "in_stock", 26, 1, 1, "fght", "3/4", "fpt", "3/4", { pressureLossPsi: 1, maxFlowGpm: 8 }),
        part("functional_emitter", "Functional Emitter", "emitter", "in_stock", 3, 1, 1, "fght", "3/4", "fpt", "3/4", { flowGpm: 0.5 }),
        part("functional_drip_tape", "Functional Drip Tape", "drip_tape", "in_stock", 0, 1, 1, "fght", "3/4", "fpt", "3/4", { flowGpm: 1.2 }, 0.4),
        part("target_threaded", "Target Threaded", "fitting", "in_stock", 4, 1, 1, "mpt", "3/4", "mpt", "3/4", { pressureLossPsi: 0.1 })
    ] };
    api.writeCatalog(moduleCell, catalog);
    const source = api.__test.createSourceAssembly(moduleCell, "Hose", { connectorType: "mght", nominalSize: "3/4", method: "drip", usableFlowGpm: 5, staticPressurePsi: 45 }, { x: 30, y: 40 });
    const target = api.__test.createPartAssembly(moduleCell, catalog.items.find(item => item.id === "target_threaded"), { x: 30, y: 180 });
    const suggestions = api.__test.bridgeSuggestionsForPorts(moduleCell, { cellId: api.__test.firstAssemblyPart(source.assembly).getId(), role: "output", index: 0 }, { cellId: api.__test.firstAssemblyPart(target.assembly).getId(), role: "input", index: 0 });
    const suggestedIds = suggestions.flatMap(suggestion => suggestion.partIds);
    assert.ok(suggestedIds.includes("bridge_adapter") || suggestedIds.includes("bridge_source_adapter"));
    ["bridge_multi_output_tee", "functional_filter", "functional_regulator", "functional_valve", "functional_emitter", "functional_drip_tape"].forEach(id => assert.equal(suggestedIds.includes(id), false, id));
});

test("thread-to-pipe starter adapters bridge threaded sources to pipe-style targets", () => {
    const { api, moduleCell } = loadPlugin();
    api.writeCatalog(moduleCell, api.starterCatalog());
    const catalog = api.readCatalog(moduleCell);
    const source = api.__test.createSourceAssembly(moduleCell, "Threaded source", { connectorType: "fpt", nominalSize: "1/2", method: "drip", usableFlowGpm: 5, staticPressurePsi: 45 }, { x: 30, y: 40 });
    const target = api.__test.createPartAssembly(moduleCell, catalog.items.find(item => item.id === "twist_lock_coupler_1_2"), { x: 30, y: 240 });
    const sourcePort = { cellId: api.__test.firstAssemblyPart(source.assembly).getId(), role: "output", index: 0 };
    const targetPort = { cellId: api.__test.firstAssemblyPart(target.assembly).getId(), role: "input", index: 0 };
    const suggestion = api.__test.bridgeSuggestionsForPorts(moduleCell, sourcePort, targetPort).find(entry => entry.partIds.includes("mpt_to_1_2_twist_lock_adapter"));
    assert.ok(suggestion, "expected MPT to twist-lock bridge suggestion");
    assert.ok(suggestion.labels.includes("1/2\" MPT: twist-lock adapter")); // CHANGE
    const plan = api.__test.ConnectionChainPlanner.planBridge(moduleCell, sourcePort, targetPort, suggestion.partIds.map(id => catalog.items.find(item => item.id === id)));
    assert.equal(plan.ok, true, plan.reason);
    assert.equal(JSON.stringify(plan.hops.map(hop => hop.mode)), JSON.stringify(["direct", "pipe"]));
    const applied = api.__test.ConnectionChainPlanner.applyBridge(moduleCell, plan);
    assert.equal(applied.ok, true, applied.reason);
    const pipeEdges = api.__test.collectAssemblyEdges(moduleCell).filter(edge => edge.getAttribute(api.attrs.PIPE_EDGE) === "1");
    assert.ok(pipeEdges.some(edge => edge.getAttribute(api.attrs.PIPE_PART_ID) === "poly_distribution_1_2"));
});

test("pipe-to-thread starter adapters bridge pipe-style sources to threaded targets", () => {
    const { api, moduleCell, model } = loadPlugin();
    api.writeCatalog(moduleCell, api.starterCatalog());
    const catalog = api.readCatalog(moduleCell);
    const source = api.__test.createPartAssembly(moduleCell, catalog.items.find(item => item.id === "push_connect_coupler_1_2"), { x: 30, y: 40 });
    const target = api.__test.createPartAssembly(moduleCell, catalog.items.find(item => item.id === "fpt_coupler_1_2"), { x: 30, y: 240 });
    const downstream = api.__test.createPartAssembly(moduleCell, catalog.items.find(item => item.id === "fpt_coupler_1_2"), { x: 30, y: 300 }); // CHANGE
    downstream.partCell.geometry.y = 62; // CHANGE
    model.add(target.assembly, downstream.partCell); // CHANGE
    model.remove(downstream.assembly); // CHANGE
    const sourcePort = { cellId: api.__test.firstAssemblyPart(source.assembly).getId(), role: "output", index: 0 };
    const targetPort = { cellId: api.__test.firstAssemblyPart(target.assembly).getId(), role: "input", index: 0 };
    const suggestion = api.__test.bridgeSuggestionsForPorts(moduleCell, sourcePort, targetPort).find(entry => JSON.stringify(entry.partIds) === JSON.stringify(["mpt_to_1_2_push_connect_adapter"])); // CHANGE
    assert.ok(suggestion, "expected flipped MPT to push-connect bridge suggestion"); // CHANGE
    assert.equal(JSON.stringify(suggestion.parts), JSON.stringify([{ partId: "mpt_to_1_2_push_connect_adapter", flipped: true }])); // NEW
    assert.equal(JSON.stringify(suggestion.labels), JSON.stringify(["1/2\" push-to-connect: MPT adapter"])); // CHANGE
    const plan = api.__test.ConnectionChainPlanner.planBridge(moduleCell, sourcePort, targetPort, suggestion.parts.map(entry => ({ part: catalog.items.find(item => item.id === entry.partId), flipped: entry.flipped }))); // CHANGE
    assert.equal(plan.ok, true, plan.reason);
    assert.equal(plan.partEntries[0].flipped, true); // NEW
    assert.equal(JSON.stringify(plan.hops.map(hop => hop.mode)), JSON.stringify(["pipe", "direct"]));
    const targetPosition = { x: target.assembly.geometry.x, y: target.assembly.geometry.y }; // CHANGE
    const applied = api.__test.ConnectionChainPlanner.applyBridge(moduleCell, plan);
    assert.equal(applied.ok, true, applied.reason);
    const external = assemblyCells(moduleCell, api).filter(cell => ![source.assembly, target.assembly].includes(cell)); // NEW
    assert.equal(external.length, 0); // CHANGE
    assert.equal(target.assembly.geometry.x, targetPosition.x); // CHANGE
    assert.equal(target.assembly.geometry.y, targetPosition.y); // CHANGE
    assert.equal(assemblyCells(moduleCell, api).includes(target.assembly), true); // CHANGE
    assert.equal(api.__test.firstAssemblyPart(target.assembly).getAttribute(api.attrs.PART_FLIPPED), "1"); // CHANGE
    assert.equal(api.__test.firstAssemblyPart(target.assembly).getAttribute("label"), "1/2\" push-to-connect: MPT adapter"); // CHANGE
    assert.equal(JSON.stringify(api.__test.assemblyPartCells(target.assembly).map(cell => cell.getAttribute(api.attrs.CATALOG_PART_ID))), JSON.stringify(["mpt_to_1_2_push_connect_adapter", "fpt_coupler_1_2", "fpt_coupler_1_2"])); // CHANGE
    assert.equal(JSON.stringify(target.assembly.children.filter(cell => cell.getAttribute && cell.getAttribute(api.attrs.COMPONENT) === "1").map(cell => cell.getAttribute(api.attrs.CATALOG_PART_ID))), JSON.stringify(["mpt_to_1_2_push_connect_adapter", "fpt_coupler_1_2", "fpt_coupler_1_2"])); // NEW
    const directEdges = api.__test.collectAssemblyEdges(moduleCell).filter(edge => edge.getAttribute(api.attrs.DIRECT_LINK_EDGE) === "1"); // CHANGE
    assert.equal(directEdges.length, 0); // CHANGE
    const pipeEdges = api.__test.collectAssemblyEdges(moduleCell).filter(edge => edge.getAttribute(api.attrs.PIPE_EDGE) === "1");
    assert.equal(pipeEdges.length, 1); // CHANGE
    assert.ok(pipeEdges.some(edge => edge.getAttribute(api.attrs.PIPE_PART_ID) === "poly_distribution_1_2"));
});

test("non-pipe connector types create direct assembly merges instead of pipe edges", () => {
    const { api, moduleCell } = loadPlugin();
    const catalog = { items: [part("plain_filter", "Plain Filter", "filter", "in_stock", 10, 1, 1, "fpt", "3/4", "mpt", "3/4", { pressureLossPsi: 1 })] };
    api.writeCatalog(moduleCell, catalog);
    const source = api.__test.createSourceAssembly(moduleCell, "Plain Source", { connectorType: "mpt", nominalSize: "3/4", method: "drip", usableFlowGpm: 5, staticPressurePsi: 45 }, { x: 30, y: 40 });
    const filter = api.__test.createPartAssembly(moduleCell, catalog.items[0], { x: 30, y: 180 });
    const result = api.__test.createAssemblyConnection(moduleCell, { cellId: api.__test.firstAssemblyPart(source.assembly).getId(), role: "output", index: 0 }, { cellId: api.__test.firstAssemblyPart(filter.assembly).getId(), role: "input", index: 0 });
    assert.equal(result.ok, true, result.reason);
    assert.equal(result.mode, "merge");
    assert.equal(api.__test.collectAssemblyEdges(moduleCell).length, 0);
    assert.equal(JSON.stringify(api.__test.assemblyPartCells(source.assembly).map(cell => cell.getAttribute(api.attrs.CATALOG_PART_ID)).filter(Boolean)), JSON.stringify(["plain_filter"]));
    assert.equal(assemblyCells(moduleCell, api).includes(filter.assembly), false);
});

test("unflagged barb connectors infer pipe edges when matching pipe exists", () => {
    const { api, moduleCell } = loadPlugin();
    const catalog = { items: [
        part("plain_barb_filter", "Plain Barb Filter", "filter", "in_stock", 10, 1, 1, "barb", "3/4", "barb", "3/4", { pressureLossPsi: 1 }),
        part("plain_barb_pipe", "Plain Barb Pipe", "pipe_tubing", "in_stock", 0, 1, 1, "barb", "3/4", "barb", "3/4", { innerDiameterIn: 0.824, hazenWilliamsC: 150 }, 0.25)
    ] };
    api.writeCatalog(moduleCell, catalog);
    const source = api.__test.createSourceAssembly(moduleCell, "Plain Barb Source", { connectorType: "barb", nominalSize: "3/4", method: "drip", pipeConnection: false, usableFlowGpm: 5, staticPressurePsi: 45 }, { x: 30, y: 40 });
    const filter = api.__test.createPartAssembly(moduleCell, catalog.items[0], { x: 30, y: 180 });
    const result = api.__test.createAssemblyConnection(moduleCell, { cellId: api.__test.firstAssemblyPart(source.assembly).getId(), role: "output", index: 0 }, { cellId: api.__test.firstAssemblyPart(filter.assembly).getId(), role: "input", index: 0 });
    assert.equal(result.ok, true, result.reason);
    assert.equal(result.edge.getAttribute(api.attrs.PIPE_EDGE), "1");
    assert.equal(result.edge.getAttribute(api.attrs.PIPE_PART_ID), "plain_barb_pipe");
    assert.equal(api.__test.collectAssemblyEdges(moduleCell).length, 1);
});

test("pipe-required connections block when no compatible pipe part exists", () => {
    const { api, moduleCell } = loadPlugin();
    const catalog = { items: [part("pipe_filter", "Pipe Filter", "filter", "in_stock", 10, 1, 1, "barb", "3/4", "barb", "3/4", { pressureLossPsi: 1 }, undefined, true)] };
    api.writeCatalog(moduleCell, catalog);
    const source = api.__test.createSourceAssembly(moduleCell, "Pipe Source", { connectorType: "barb", nominalSize: "3/4", method: "drip", pipeConnection: true, usableFlowGpm: 5, staticPressurePsi: 45 }, { x: 30, y: 40 });
    const filter = api.__test.createPartAssembly(moduleCell, catalog.items[0], { x: 30, y: 180 });
    const result = api.__test.createAssemblyConnection(moduleCell, { cellId: api.__test.firstAssemblyPart(source.assembly).getId(), role: "output", index: 0 }, { cellId: api.__test.firstAssemblyPart(filter.assembly).getId(), role: "input", index: 0 });
    assert.equal(result.ok, false);
    assert.match(result.reason, /No compatible pipe part/);
    assert.equal(api.__test.collectAssemblyEdges(moduleCell).length, 0);
});

test("ConnectorRules facade preserves connection decision rejection contracts", () => {
    const { api, moduleCell } = loadPlugin();
    const catalog = sampleCatalog();
    api.writeCatalog(moduleCell, catalog);
    const upstream = api.__test.createPartAssembly(moduleCell, catalog.items.find(item => item.id === "filter"), { x: 30, y: 40 });
    const downstream = api.__test.createPartAssembly(moduleCell, catalog.items.find(item => item.id === "regulator"), { x: 30, y: 180 });
    const extra = api.__test.createPartAssembly(moduleCell, catalog.items.find(item => item.id === "valve"), { x: 300, y: 180 });
    const upstreamPart = api.__test.firstAssemblyPart(upstream.assembly);
    const downstreamPart = api.__test.firstAssemblyPart(downstream.assembly);
    const extraPart = api.__test.firstAssemblyPart(extra.assembly);
    const invalidRole = api.__test.ConnectorRules.connectionDecision(moduleCell, { cellId: upstreamPart.getId(), role: "input", index: 0 }, { cellId: downstreamPart.getId(), role: "input", index: 0 });
    assert.equal(invalidRole.ok, false);
    assert.match(invalidRole.reason, /one output port and one inlet/);
    const sameCell = api.__test.ConnectorRules.connectionDecision(moduleCell, { cellId: upstreamPart.getId(), role: "output", index: 0 }, { cellId: upstreamPart.getId(), role: "input", index: 0 });
    assert.equal(sameCell.ok, false);
    assert.match(sameCell.reason, /cannot connect to itself/);
    const connected = api.__test.ConnectorRules.createAssemblyConnection(moduleCell, { cellId: upstreamPart.getId(), role: "output", index: 0 }, { cellId: downstreamPart.getId(), role: "input", index: 0 });
    assert.equal(connected.ok, true, connected.reason);
    const occupied = api.__test.ConnectorRules.connectionDecision(moduleCell, { cellId: upstreamPart.getId(), role: "output", index: 0 }, { cellId: extraPart.getId(), role: "input", index: 0 });
    assert.equal(occupied.ok, false);
    assert.match(occupied.reason, /already connected/);
    const cycle = api.__test.ConnectorRules.connectionDecision(moduleCell, { cellId: downstreamPart.getId(), role: "output", index: 0 }, { cellId: upstreamPart.getId(), role: "input", index: 0 });
    assert.equal(cycle.ok, false);
    assert.match(cycle.reason, /must remain a tree/);
});

test("Suggest Connection eligibility rejects structural failures before connector search", () => {
    const { api, graph, moduleCell } = loadPlugin();
    const catalog = { items: [
        part("multi_input_a", "Multi Input A", "fitting", "in_stock", 5, 2, 1, "barb", "3/4", "barb", "3/4", { pressureLossPsi: 0.1 }, undefined, true),
        part("multi_input_b", "Multi Input B", "fitting", "in_stock", 5, 2, 1, "barb", "3/4", "barb", "3/4", { pressureLossPsi: 0.1 }, undefined, true),
        part("multi_pipe", "Multi Pipe", "pipe_tubing", "in_stock", 0, 1, 1, "barb", "3/4", "barb", "3/4", { innerDiameterIn: 0.824 }, 0.25, true),
        part("fght_to_barb", "FGHT to barb", "fitting", "in_stock", 5, 1, 1, "fght", "3/4", "barb", "3/4", { pressureLossPsi: 0.1 }, undefined, true)
    ] };
    api.writeCatalog(moduleCell, catalog);
    const source = api.__test.createSourceAssembly(moduleCell, "Hose", { connectorType: "mght", nominalSize: "3/4", method: "drip", usableFlowGpm: 5, staticPressurePsi: 45 }, { x: 30, y: 40 });
    const same = api.__test.createPartAssembly(moduleCell, catalog.items[0], { x: 30, y: 180 }).assembly;
    const downstream = api.__test.createPartAssembly(moduleCell, catalog.items[1], { x: 300, y: 180 }).assembly;
    const samePart = api.__test.firstAssemblyPart(same);
    const downstreamPart = api.__test.firstAssemblyPart(downstream);
    const sameCell = api.__test.bridgeSuggestionEligibility(moduleCell, { cellId: samePart.getId(), role: "output", index: 0 }, { cellId: samePart.getId(), role: "input", index: 0 });
    assert.equal(sameCell.ok, false);
    assert.match(sameCell.reason, /cannot connect to itself/);
    const connected = api.__test.createAssemblyConnection(moduleCell, { cellId: samePart.getId(), role: "output", index: 0 }, { cellId: downstreamPart.getId(), role: "input", index: 0 });
    assert.equal(connected.ok, true, connected.reason);
    const occupied = api.__test.bridgeSuggestionEligibility(moduleCell, { cellId: samePart.getId(), role: "output", index: 0 }, { cellId: downstreamPart.getId(), role: "input", index: 1 });
    assert.equal(occupied.ok, false);
    assert.match(occupied.reason, /already connected/);
    const cycle = api.__test.bridgeSuggestionEligibility(moduleCell, { cellId: downstreamPart.getId(), role: "output", index: 0 }, { cellId: samePart.getId(), role: "input", index: 1 });
    assert.equal(cycle.ok, false);
    assert.match(cycle.reason, /must remain a tree/);
    const bridgeable = api.__test.bridgeSuggestionEligibility(moduleCell, { cellId: api.__test.firstAssemblyPart(source.assembly).getId(), role: "output", index: 0 }, { cellId: samePart.getId(), role: "input", index: 1 });
    assert.equal(bridgeable.ok, true, bridgeable.reason);
    api.openIrrigationMode(moduleCell, { preserveViewport: true });
    graph.setSelectionCell(same.assembly || same);
    clickPort(graph.container, /Outlet 1 connected/);
    assert.equal(buttonTexts(graph.container).includes("Suggest Connection"), false);
});

test("Suggest Connection is hidden for non-boundary assembly part selections", () => {
    const { api, moduleCell } = loadPlugin();
    const catalog = sampleCatalog();
    api.writeCatalog(moduleCell, catalog);
    const upstream = api.__test.createPartAssembly(moduleCell, catalog.items.find(item => item.id === "filter"), { x: 30, y: 40 });
    const upstreamSecond = api.__test.createPartAssembly(moduleCell, catalog.items.find(item => item.id === "regulator"), { x: 30, y: 160 }).partCell;
    appendChild(upstream.assembly, upstreamSecond);
    upstreamSecond.parent = upstream.assembly;
    upstreamSecond.geometry.y = 62; // CHANGE
    const downstream = api.__test.createPartAssembly(moduleCell, catalog.items.find(item => item.id === "valve"), { x: 300, y: 40 });
    const downstreamSecond = api.__test.createPartAssembly(moduleCell, catalog.items.find(item => item.id === "regulator"), { x: 300, y: 160 }).partCell;
    appendChild(downstream.assembly, downstreamSecond);
    downstreamSecond.parent = downstream.assembly;
    downstreamSecond.geometry.y = 62; // CHANGE
    const firstUpstreamPart = api.__test.firstAssemblyPart(upstream.assembly);
    const lastDownstreamPart = api.__test.lastAssemblyPart(downstream.assembly);
    const sourceNotLast = api.__test.bridgeSuggestionEligibility(moduleCell, { cellId: firstUpstreamPart.getId(), role: "output", index: 0 }, { cellId: api.__test.firstAssemblyPart(downstream.assembly).getId(), role: "input", index: 0 });
    assert.equal(sourceNotLast.ok, false);
    assert.match(sourceNotLast.reason, /last part/);
    const targetNotFirst = api.__test.bridgeSuggestionEligibility(moduleCell, { cellId: api.__test.lastAssemblyPart(upstream.assembly).getId(), role: "output", index: 0 }, { cellId: lastDownstreamPart.getId(), role: "input", index: 0 });
    assert.equal(targetNotFirst.ok, false);
    assert.match(targetNotFirst.reason, /first part/);
});

test("branch direct connections and bed direct connections use direct-link edges", () => {
    const { api, moduleCell, bed } = loadPlugin();
    const catalog = { items: [
        part("plain_valve", "Plain Valve", "valve", "in_stock", 10, 1, 2, "fpt", "3/4", "mpt", "3/4", { maxFlowGpm: 8 }),
        part("plain_filter", "Plain Filter", "filter", "in_stock", 10, 1, 1, "fpt", "3/4", "mpt", "3/4", { pressureLossPsi: 1 })
    ] };
    api.writeCatalog(moduleCell, catalog);
    const valveAssembly = api.__test.createPartAssembly(moduleCell, catalog.items[0], { x: 30, y: 40 }).assembly;
    const filterAssembly = api.__test.createPartAssembly(moduleCell, catalog.items[1], { x: 30, y: 180 }).assembly;
    const branch = api.__test.createAssemblyConnection(moduleCell, { cellId: api.__test.firstAssemblyPart(valveAssembly).getId(), role: "output", index: 1 }, { cellId: api.__test.firstAssemblyPart(filterAssembly).getId(), role: "input", index: 0 });
    assert.equal(branch.ok, true, branch.reason);
    assert.equal(branch.mode, "direct");
    assert.equal(branch.edge.getAttribute(api.attrs.DIRECT_LINK_EDGE), "1");
    bed.value.setAttribute(api.attrs.BED_PORTS_JSON, JSON.stringify({ inputs: 1, outputs: 1, input: { type: "fght", nominalSize: "3/4", method: "drip", pipeConnection: false }, output: { type: "fght", nominalSize: "3/4", method: "drip", pipeConnection: false } }));
    const source = api.__test.createSourceAssembly(moduleCell, "Hose", { connectorType: "mght", nominalSize: "3/4", method: "drip", usableFlowGpm: 5, staticPressurePsi: 45 }, { x: 300, y: 40 });
    const bedAssembly = api.__test.createBedAssembly(moduleCell, bed, { x: 300, y: 180 });
    const direct = api.__test.createAssemblyConnection(moduleCell, { cellId: api.__test.firstAssemblyPart(source.assembly).getId(), role: "output", index: 0 }, { cellId: bedAssembly.assembly.getId(), role: "input", index: 0 });
    assert.equal(direct.ok, true, direct.reason);
    assert.equal(direct.mode, "direct");
    assert.equal(direct.edge.getAttribute(api.attrs.DIRECT_LINK_EDGE), "1");
    assert.equal(assemblyCells(moduleCell, api).includes(bedAssembly.assembly), true);
});

test("drag-created incompatible irrigation edges are removed with a warning", () => {
    const { api, graph, moduleCell } = loadPlugin();
    api.writeCatalog(moduleCell, sampleCatalog());
    const source = api.__test.createSourceAssembly(moduleCell, "Hose Source", { connectorType: "mght", nominalSize: "3/4", method: "drip", usableFlowGpm: 5, staticPressurePsi: 45 }, { x: 30, y: 40 });
    const filter = api.__test.createPartAssembly(moduleCell, api.readCatalog(moduleCell).items.find(item => item.id === "filter"), { x: 30, y: 180 });
    api.openIrrigationMode(moduleCell, { preserveViewport: true });
    const edge = graph.insertEdge(moduleCell, null, "", source.assembly, filter.assembly, "");
    graph.fireCellsAdded([edge]);
    assert.equal(moduleCell.children.includes(edge), false);
    assert.match(graph.container.textContent, /Connection removed/);
});

test("Suggest Connection appends direct source prefix before pipe bridge boundaries", () => {
    const { api, graph, moduleCell } = loadPlugin();
    api.writeCatalog(moduleCell, sampleCatalog());
    const source = api.__test.createSourceAssembly(moduleCell, "Hose", { connectorType: "mght", nominalSize: "3/4", method: "drip", usableFlowGpm: 5, staticPressurePsi: 45 }, { x: 30, y: 40 });
    const target = api.__test.createPartAssembly(moduleCell, api.readCatalog(moduleCell).items.find(item => item.id === "drip_tape"), { x: 30, y: 220 });
    assertSwimlaneAssemblyStyle(source.assembly);
    assertSwimlaneAssemblyStyle(target.assembly);
    api.openIrrigationMode(moduleCell, { preserveViewport: true });
    graph.setSelectionCells([source.assembly, target.assembly]);
    clickPort(graph.container, /Outlet 1 free/);
    clickPort(graph.container, /Inlet 1 free/);
    const hud = graph.container.querySelector(".trellis-irrigation-suggest-only-hud");
    assert.ok(hud, "Missing stripped Suggest Connection HUD");
    assert.equal(graph.container.querySelector(".trellis-irrigation-local-hud"), null);
    assert.equal(hud.querySelector(".trellis-irrigation-hud-header-title").textContent, "Suggest Connection");
    assert.equal(inlineConnectionActions(graph.container).length, 0);
    ["Connect", "BOM", "Catalog", "Exit", "Delete Assembly", "Edit Zones", "Reset Zone", "Planned", "Completed", "Add Part"].forEach(text => assert.equal(buttonTexts(hud).includes(text), false, text));
    assert.equal(hud.querySelectorAll(".trellis-irrigation-connection-row").length, 0);
    assert.equal(hud.querySelector(".trellis-irrigation-zone-controls"), null);
    assert.equal(hud.querySelector(".trellis-irrigation-source-edit"), null);
    assert.equal(querySelectByLabel(hud, "Inlet part"), null);
    assert.equal(querySelectByLabel(hud, "Outlet part"), null);
    assert.match(hud.textContent, /In stock/);
    assert.match(hud.textContent, /Needs purchase/);
    clickButton(graph.container, "FGHT to MPT adapter");
    assert.equal(portBadgesInState(graph.container, "selected").length, 0);
    const sourcePartIds = api.__test.assemblyPartCells(source.assembly).map(cell => cell.getAttribute(api.attrs.CATALOG_PART_ID)).filter(Boolean);
    const targetPartIds = api.__test.assemblyPartCells(target.assembly).map(cell => cell.getAttribute(api.attrs.CATALOG_PART_ID)).filter(Boolean);
    assert.equal(JSON.stringify(sourcePartIds), JSON.stringify(["fght_to_mpt", "fpt_to_barb"]));
    assert.equal(JSON.stringify(targetPartIds), JSON.stringify(["drip_tape"]));
    assert.equal(assemblyCells(moduleCell, api).filter(cell => ![source.assembly, target.assembly].includes(cell)).length, 0);
    const edges = api.__test.collectAssemblyEdges(moduleCell);
    assert.equal(edges.length, 1);
    assert.equal(edges[0].getAttribute(api.attrs.PIPE_EDGE), "1");
});

test("Suggest Connection keeps bridge parts after the first pipe boundary external", () => {
    const { api, moduleCell } = loadPlugin();
    api.writeCatalog(moduleCell, api.starterCatalog());
    const catalog = api.readCatalog(moduleCell);
    const source = api.__test.createSourceAssembly(moduleCell, "Hose", { connectorType: "mght", nominalSize: "3/4", method: "drip", usableFlowGpm: 5, staticPressurePsi: 45 }, { x: 30, y: 40 });
    const target = api.__test.createPartAssembly(moduleCell, catalog.items.find(item => item.id === "drip_tape_8mil_12in"), { x: 30, y: 360 });
    const sourcePort = { cellId: api.__test.firstAssemblyPart(source.assembly).getId(), role: "output", index: 0 };
    const targetPort = { cellId: api.__test.firstAssemblyPart(target.assembly).getId(), role: "input", index: 0 };
    const partIds = ["fght_to_3_4_barb_adapter", "reducer_3_4_to_1_2_barb"];
    const plan = api.__test.ConnectionChainPlanner.planBridge(moduleCell, sourcePort, targetPort, partIds.map(id => catalog.items.find(item => item.id === id)));
    assert.equal(plan.ok, true, plan.reason);
    assert.equal(JSON.stringify(plan.hops.map(hop => hop.mode)), JSON.stringify(["direct", "pipe", "pipe"]));
    const applied = api.__test.ConnectionChainPlanner.applyBridge(moduleCell, plan);
    assert.equal(applied.ok, true, applied.reason);
    assert.equal(JSON.stringify(api.__test.assemblyPartCells(source.assembly).map(cell => cell.getAttribute(api.attrs.CATALOG_PART_ID)).filter(Boolean)), JSON.stringify(["fght_to_3_4_barb_adapter"]));
    assert.equal(JSON.stringify(api.__test.assemblyPartCells(target.assembly).map(cell => cell.getAttribute(api.attrs.CATALOG_PART_ID))), JSON.stringify(["drip_tape_8mil_12in"]));
    const external = assemblyCells(moduleCell, api).filter(cell => ![source.assembly, target.assembly].includes(cell));
    assert.equal(external.length, 1);
    assert.equal(external[0].getAttribute("label"), "Assembly");
    assert.equal(JSON.stringify(api.__test.assemblyPartCells(external[0]).map(cell => cell.getAttribute(api.attrs.CATALOG_PART_ID))), JSON.stringify(["reducer_3_4_to_1_2_barb"]));
    const edges = api.__test.collectAssemblyEdges(moduleCell);
    assert.equal(edges.length, 2);
    assert.equal(JSON.stringify(edges.map(edge => edge.getAttribute(api.attrs.PIPE_EDGE))), JSON.stringify(["1", "1"]));
    assert.equal(JSON.stringify(edges.map(edge => edge.getAttribute(api.attrs.PART_STATE))), JSON.stringify([api.__test.partStates.planned, api.__test.partStates.planned]));
});

test("Suggest Connection applies all-pipe barb bridge chains as separate assemblies and pipe edges", () => {
    const { api, moduleCell } = loadPlugin();
    api.writeCatalog(moduleCell, api.starterCatalog());
    const catalog = api.readCatalog(moduleCell);
    const source = api.__test.createPartAssembly(moduleCell, catalog.items.find(item => item.id === "barb_tee_3_4"), { x: 30, y: 40 });
    const target = api.__test.createPartAssembly(moduleCell, catalog.items.find(item => item.id === "micro_emitter_1_0_gph"), { x: 30, y: 360 });
    const sourcePort = { cellId: api.__test.firstAssemblyPart(source.assembly).getId(), role: "output", index: 0 };
    const targetPort = { cellId: api.__test.firstAssemblyPart(target.assembly).getId(), role: "input", index: 0 };
    const suggestion = api.__test.bridgeSuggestionsForPorts(moduleCell, sourcePort, targetPort).find(entry => JSON.stringify(entry.partIds) === JSON.stringify(["reducer_3_4_to_1_2_barb", "transfer_barb_1_2_to_1_4"]));
    assert.ok(suggestion, "expected reducer plus transfer barb suggestion");
    const plan = api.__test.ConnectionChainPlanner.planBridge(moduleCell, sourcePort, targetPort, suggestion.partIds.map(id => catalog.items.find(item => item.id === id)));
    assert.equal(plan.ok, true, plan.reason);
    assert.equal(JSON.stringify(plan.hops.map(hop => hop.mode)), JSON.stringify(["pipe", "pipe", "pipe"]));
    const applied = api.__test.ConnectionChainPlanner.applyBridge(moduleCell, plan);
    assert.equal(applied.ok, true, applied.reason);
    assert.equal(JSON.stringify(api.__test.assemblyPartCells(source.assembly).map(cell => cell.getAttribute(api.attrs.CATALOG_PART_ID))), JSON.stringify(["barb_tee_3_4"]));
    assert.equal(JSON.stringify(api.__test.assemblyPartCells(target.assembly).map(cell => cell.getAttribute(api.attrs.CATALOG_PART_ID))), JSON.stringify(["micro_emitter_1_0_gph"]));
    const bridgePartAssemblies = assemblyCells(moduleCell, api).filter(cell => ![source.assembly, target.assembly].includes(cell)).map(cell => api.__test.assemblyPartCells(cell).map(partCell => partCell.getAttribute(api.attrs.CATALOG_PART_ID)));
    assert.equal(JSON.stringify(bridgePartAssemblies), JSON.stringify([["reducer_3_4_to_1_2_barb"], ["transfer_barb_1_2_to_1_4"]]));
    assert.equal(JSON.stringify(assemblyCells(moduleCell, api).filter(cell => ![source.assembly, target.assembly].includes(cell)).map(cell => cell.getAttribute("label"))), JSON.stringify(["Assembly", "Assembly"]));
    const edges = api.__test.collectAssemblyEdges(moduleCell);
    assert.equal(edges.length, 3);
    assert.equal(JSON.stringify(edges.map(edge => edge.getAttribute(api.attrs.PIPE_EDGE))), JSON.stringify(["1", "1", "1"]));
    assert.equal(JSON.stringify(edges.map(edge => edge.getAttribute(api.attrs.PIPE_PART_ID))), JSON.stringify(["poly_mainline_3_4", "poly_distribution_1_2", "micro_tubing_1_4"]));
    assert.equal(JSON.stringify(edges.map(edge => edge.getAttribute(api.attrs.PART_STATE))), JSON.stringify([api.__test.partStates.planned, api.__test.partStates.planned, api.__test.partStates.planned]));
});

test("BOM counts generated pipe edges by size and lifecycle without explicit waypoints", () => { // NEW
    const { api, moduleCell } = loadPlugin(); // NEW
    api.writeCatalog(moduleCell, api.starterCatalog()); // NEW
    const catalog = api.readCatalog(moduleCell); // NEW
    const source = api.__test.createPartAssembly(moduleCell, catalog.items.find(item => item.id === "barb_tee_3_4"), { x: 30, y: 40 }); // NEW
    const target = api.__test.createPartAssembly(moduleCell, catalog.items.find(item => item.id === "micro_emitter_1_0_gph"), { x: 30, y: 360 }); // NEW
    const sourcePort = { cellId: api.__test.firstAssemblyPart(source.assembly).getId(), role: "output", index: 0 }; // NEW
    const targetPort = { cellId: api.__test.firstAssemblyPart(target.assembly).getId(), role: "input", index: 0 }; // NEW
    const suggestion = api.__test.bridgeSuggestionsForPorts(moduleCell, sourcePort, targetPort).find(entry => JSON.stringify(entry.partIds) === JSON.stringify(["reducer_3_4_to_1_2_barb", "transfer_barb_1_2_to_1_4"])); // NEW
    assert.ok(suggestion, "expected reducer plus transfer barb suggestion"); // NEW
    const plan = api.__test.ConnectionChainPlanner.planBridge(moduleCell, sourcePort, targetPort, suggestion.partIds.map(id => catalog.items.find(item => item.id === id))); // NEW
    assert.equal(plan.ok, true, plan.reason); // NEW
    const applied = api.__test.ConnectionChainPlanner.applyBridge(moduleCell, plan); // NEW
    assert.equal(applied.ok, true, applied.reason); // NEW
    const edges = api.__test.collectAssemblyEdges(moduleCell).filter(edge => edge.getAttribute(api.attrs.PIPE_EDGE) === "1"); // NEW
    assert.equal(JSON.stringify(edges.map(edge => edge.getAttribute(api.attrs.PIPE_PART_ID))), JSON.stringify(["poly_mainline_3_4", "poly_distribution_1_2", "micro_tubing_1_4"])); // NEW
    assert.equal(edges.every(edge => !edge.geometry.points.length), true); // NEW
    let bom = api.__test.buildBomRows(moduleCell); // NEW
    ["poly_mainline_3_4", "poly_distribution_1_2", "micro_tubing_1_4"].forEach(function (partId) { // NEW
        const row = bom.rows.find(entry => entry.partId === partId); // NEW
        assert.ok(row, "missing planned pipe row " + partId); // NEW
        assert.ok(row.requiredQuantity > 0, "expected measured fallback quantity for " + partId); // NEW
    }); // NEW
    api.__test.setPipeEdgeState(edges[0], api.__test.partStates.completed); // NEW
    api.__test.setPipeEdgeState(edges[2], api.__test.partStates.completed); // NEW
    bom = api.__test.buildBomRows(moduleCell); // NEW
    assert.equal(bom.rows.some(row => row.partId === "poly_mainline_3_4"), false); // NEW
    assert.equal(bom.rows.some(row => row.partId === "poly_distribution_1_2"), true); // NEW
    assert.equal(bom.rows.some(row => row.partId === "micro_tubing_1_4"), false); // NEW
    assert.equal(bom.completedRows.some(row => row.partId === "poly_mainline_3_4"), true); // NEW
    assert.equal(bom.completedRows.some(row => row.partId === "micro_tubing_1_4"), true); // NEW
}); // NEW

test("direct-only Suggest Connection still merges through the downstream assembly", () => {
    const { api, moduleCell } = loadPlugin();
    const catalog = { items: [
        part("fght_to_mpt_direct_bridge", "FGHT to MPT direct bridge", "source_adapter", "in_stock", 5, 1, 1, "fght", "3/4", "mpt", "3/4", { pressureLossPsi: 0.1 }),
        part("fpt_target", "FPT target", "fitting", "in_stock", 4, 1, 1, "fpt", "3/4", "mpt", "3/4", { pressureLossPsi: 0.1 })
    ] };
    api.writeCatalog(moduleCell, catalog);
    const source = api.__test.createSourceAssembly(moduleCell, "Hose", { connectorType: "mght", nominalSize: "3/4", method: "drip", usableFlowGpm: 5, staticPressurePsi: 45 }, { x: 30, y: 40 });
    const target = api.__test.createPartAssembly(moduleCell, catalog.items.find(item => item.id === "fpt_target"), { x: 30, y: 220 });
    const sourcePort = { cellId: api.__test.firstAssemblyPart(source.assembly).getId(), role: "output", index: 0 };
    const targetPort = { cellId: api.__test.firstAssemblyPart(target.assembly).getId(), role: "input", index: 0 };
    const suggestion = api.__test.bridgeSuggestionsForPorts(moduleCell, sourcePort, targetPort)[0];
    assert.equal(JSON.stringify(suggestion.partIds), JSON.stringify(["fght_to_mpt_direct_bridge"]));
    const plan = api.__test.ConnectionChainPlanner.planBridge(moduleCell, sourcePort, targetPort, [catalog.items[0]]);
    assert.equal(plan.ok, true, plan.reason);
    assert.equal(plan.hasPipe, false);
    const applied = api.__test.ConnectionChainPlanner.applyBridge(moduleCell, plan);
    assert.equal(applied.ok, true, applied.reason);
    assert.equal(api.__test.collectAssemblyEdges(moduleCell).length, 0);
    assert.equal(JSON.stringify(api.__test.assemblyPartCells(source.assembly).map(cell => cell.getAttribute(api.attrs.CATALOG_PART_ID)).filter(Boolean)), JSON.stringify(["fght_to_mpt_direct_bridge", "fpt_target"]));
    assert.equal(assemblyCells(moduleCell, api).includes(target.assembly), false);
});

test("stale bridge plans fail before creating partial bridge assemblies or edges", () => {
    const { api, moduleCell } = loadPlugin();
    api.writeCatalog(moduleCell, api.starterCatalog());
    const catalog = api.readCatalog(moduleCell);
    const source = api.__test.createSourceAssembly(moduleCell, "Three quarter source", { connectorType: "barb", nominalSize: "3/4", method: "drip", pipeConnection: true, usableFlowGpm: 5, staticPressurePsi: 45 }, { x: 30, y: 40 });
    const target = api.__test.createPartAssembly(moduleCell, catalog.items.find(item => item.id === "micro_emitter_1_0_gph"), { x: 30, y: 360 });
    const sourcePort = { cellId: api.__test.firstAssemblyPart(source.assembly).getId(), role: "output", index: 0 };
    const targetPort = { cellId: api.__test.firstAssemblyPart(target.assembly).getId(), role: "input", index: 0 };
    const parts = ["reducer_3_4_to_1_2_barb", "transfer_barb_1_2_to_1_4"].map(id => catalog.items.find(item => item.id === id));
    const plan = api.__test.ConnectionChainPlanner.planBridge(moduleCell, sourcePort, targetPort, parts);
    assert.equal(plan.ok, true, plan.reason);
    const occupier = api.__test.createSourceAssembly(moduleCell, "Quarter inch source", { connectorType: "barb", nominalSize: "1/4", method: "drip", pipeConnection: true, usableFlowGpm: 1, staticPressurePsi: 30 }, { x: 360, y: 40 });
    const occupied = api.__test.createAssemblyConnection(moduleCell, { cellId: api.__test.firstAssemblyPart(occupier.assembly).getId(), role: "output", index: 0 }, targetPort);
    assert.equal(occupied.ok, true, occupied.reason);
    const assemblyCount = assemblyCells(moduleCell, api).length;
    const edgeCount = api.__test.collectAssemblyEdges(moduleCell).length;
    const applied = api.__test.ConnectionChainPlanner.applyBridge(moduleCell, plan);
    assert.equal(applied.ok, false);
    assert.match(applied.reason, /already connected/);
    assert.equal(assemblyCells(moduleCell, api).length, assemblyCount);
    assert.equal(api.__test.collectAssemblyEdges(moduleCell).length, edgeCount);
    assert.equal(assemblyCells(moduleCell, api).some(cell => /Bridge/.test(cell.getAttribute("label") || "")), false);
});

test("bed assemblies sync to linked beds, apply templates, and assembly reports ignore legacy objects", () => {
    const { api, graph, moduleCell, bed, bed2, document, model } = loadPlugin();
    api.writeCatalog(moduleCell, addDripTapeBomParts(sampleCatalog()));
    const source = api.__test.createSourceAssembly(moduleCell, "Well", { connectorType: "barb", nominalSize: "1/2", method: "drip", pipeConnection: true, usableFlowGpm: 5, staticPressurePsi: 45 }, { x: 30, y: 40 });
    const originalBedGeometry = Object.assign({}, bed.geometry);
    const bedAssembly = api.__test.createBedAssembly(moduleCell, bed, { x: 30, y: 220 });
    assert.equal(bedAssembly.assembly.parent, moduleCell);
    assert.deepEqual(bed.geometry, originalBedGeometry);
    assert.deepEqual(bedAssembly.assembly.geometry, originalBedGeometry);
    assert.equal(bedAssembly.assembly.getAttribute("irrigation_linked_bed_id"), bed.getId());
    assert.equal(bedAssembly.assembly.getAttribute("bed_fit_width"), "1");
    assert.equal(bedAssembly.assembly.getAttribute("bed_fit_height"), "1");
    assert.equal(api.__test.isBedAssembly(bedAssembly.assembly), true);
    assertRegularBedAssemblyStyle(bedAssembly.assembly);
    const legacy = api.__test.createBedEndpoint(bed2, "Legacy inlet", { connectorType: "barb", nominalSize: "3/4", method: "drip" });
    legacy.value.setAttribute(api.attrs.GENERATED, "1");
    const legacyLayout = appendChild(bed, makeXmlCell(document, "legacy_layout", { [api.attrs.BED_LAYOUT]: "1", label: "Legacy template label" }, { x: 8, y: 8, width: 80, height: 16 }));
    const connection = api.__test.createAssemblyConnection(moduleCell, { cellId: api.__test.firstAssemblyPart(source.assembly).getId(), role: "output", index: 0 }, { cellId: bedAssembly.assembly.getId(), role: "input", index: 0 });
    assert.equal(connection.ok, true, connection.reason);
    api.openIrrigationMode(moduleCell, { preserveViewport: true });
    graph.setSelectionCell(bedAssembly.assembly);
    assert.equal(graph.orderedCells.includes(bedAssembly.assembly), true);
    assert.ok(graph.undoSuppressedCalls > 0);
    assert.deepEqual(hudSectionTitles(graph.container).slice(0, 2), ["Bed Assembly", "Zone"]); // CHANGE
    assert.equal(hudSectionTitles(graph.container).includes("Inlet/Outlet"), false);
    assert.equal(hudSectionTitles(graph.container).includes("Tools"), false);
    assert.equal(hudSectionTitles(graph.container).includes("Manage"), false);
    const overlayHeader = irrigationHeader(graph.container);
    assert.deepEqual(buttonTexts(overlayHeader), ["Planned", "Completed", "Build", "Analysis", "BOM", "Catalog", "Exit"]); // CHANGE
    assert.equal(lifecycleToggle(graph.container).querySelector('[aria-pressed="true"]').textContent, "Planned");
    assert.equal(dangerButton(graph.container).textContent.trim(), "Delete Assembly");
    assert.equal(buttonTexts(graph.container).includes("New Zone"), false);
    assert.equal(buttonTexts(graph.container).includes("Edit Zones"), true);
    assert.equal(buttonTexts(graph.container).includes("Reset Zone"), true);
    const zoneSection = Array.from(graph.container.querySelectorAll(".trellis-irrigation-hud-section")).find(section => (section.querySelector(".trellis-irrigation-hud-section-title") || {}).textContent === "Zone");
    assert.ok(zoneSection, "Missing Zone section");
    assert.deepEqual(buttonTexts(zoneSection), ["Edit Zones", "Reset Zone"]);
    assert.match(Array.from(zoneSection.querySelectorAll("button")).find(button => button.textContent === "Edit Zones").getAttribute("style") || "", /border:\s*1px solid (?:#2563eb|rgb\(37,\s*99,\s*235\))/);
    assert.match(buttonByText(zoneSection, "Reset Zone").getAttribute("style") || "", /border:\s*1px solid (?:#b91c1c|rgb\(185,\s*28,\s*28\))/);
    assert.match(buttonByText(zoneSection, "Reset Zone").getAttribute("style") || "", /background:\s*(?:#b91c1c|rgb\(185,\s*28,\s*28\))/); // NEW
    assert.equal(Array.from(zoneSection.querySelectorAll(".trellis-irrigation-hud-section-title")).some(node => node.textContent === "Manage"), false);
    assert.equal(graph.container.querySelectorAll(".trellis-irrigation-connection-row").length, 0);
    const bedLabels = Array.from(graph.container.querySelectorAll("label")).map(label => label.textContent);
    ["Inlets", "Outlets", "Input connector", "Input size", "Output connector", "Output size", "Catalog part"].forEach(label => {
        assert.equal(bedLabels.some(text => text.startsWith(label)), false, "Removed field still rendered: " + label);
    });
    assert.equal(Array.from(graph.container.querySelectorAll("label")).some(label => label.textContent.startsWith("Pipe/tubing")), false);
    const hud = graph.container.querySelector(".trellis-irrigation-mode-hud");
    const hudStyle = hud.getAttribute("style") || "";
    assert.match(hudStyle, /width:\s*min\(640px,\s*calc\(100vw - 32px\)\)/);
    assert.match(hudStyle, /max-width:\s*min\(640px,\s*calc\(100vw - 32px\)\)/);
    assert.match(hudStyle, /box-sizing:\s*border-box/);
    assert.match(hudStyle, /overflow:\s*hidden/);
    const bedForm = graph.container.querySelector(".trellis-irrigation-bed-inlet-form");
    assert.match(bedForm.getAttribute("style"), /grid-template-columns:\s*minmax\(0,\s*1fr\) minmax\(0,\s*1fr\)/);
    assert.ok(bedForm.querySelector(".trellis-irrigation-bed-template-layout-column"));
    assert.ok(bedForm.querySelector(".trellis-irrigation-bed-template-parts-column"));
    assert.deepEqual(Array.from(bedForm.querySelector(".trellis-irrigation-bed-template-parts-column").querySelectorAll("label")).map(labelCaption), ["Inlet part", "Row part", "Row takeoff part", "Emitter/device part", "Row end cap", "Header end cap", "Outlet part"]); // CHANGE
    assertBoundedStyle(bedForm, "bed template form");
    assertBoundedStyle(graph.container.querySelector(".trellis-irrigation-hud-section"), "HUD section");
    Array.from(bedForm.querySelectorAll("label")).forEach((label, index) => assertBoundedStyle(label, "bed template label " + index));
    Array.from(bedForm.querySelectorAll("input,select")).forEach((control, index) => assertBoundedStyle(control, "bed template control " + index));
    const initialRowsInput = inputByLabel(graph.container, "Rows");
    const initialEmitterInput = inputByLabel(graph.container, "Emitter");
    assert.equal(initialRowsInput.type, "number");
    assert.equal(initialRowsInput.min, "1");
    assert.equal(initialRowsInput.step, "1");
    assert.equal(initialEmitterInput.type, "number");
    assert.equal(initialEmitterInput.min, "1");
    assert.equal(initialEmitterInput.step, "1");
    assert.equal(Array.from(graph.container.querySelectorAll("button")).some(button => button.textContent.includes("Apply Bed Layout")), false);
    assert.ok(selectByLabel(graph.container, "Row orientation"));
    assert.equal(querySelectByLabel(graph.container, "Template"), null); // CHANGE
    assert.ok(selectByLabel(graph.container, "Inlet part"));
    assert.ok(selectByLabel(graph.container, "Outlet part"));
    ["Emitter/device part", "Header end cap", "Outlet part"].forEach(label => assert.match(selectByLabel(graph.container, label).parentNode.getAttribute("style") || "", /display:\s*(flex|none)/));
    const templateSummary = graph.container.querySelector(".trellis-irrigation-bed-template-summary");
    assert.ok(templateSummary, "Missing bed template summary");
    const templateSummaryLines = templateSummary.textContent.split("\n");
    assert.equal(templateSummaryLines.length, 2);
    assert.match(templateSummaryLines[0], /^Rows \d+ x \d+\.\d{2} m = \d+\.\d{2} row m$/);
    assert.match(templateSummaryLines[1], /^Supply .+, demand \d+\.\d{2} gpm, \d+ PSI$/);
    assert.doesNotMatch(templateSummary.textContent, /Anchor:|BOM:/);
    assert.doesNotMatch(graph.container.textContent, /Select inlet\/outlet badges/);
    changeSelectByLabel(graph.container, "Inlet part", "fpt_to_half_barb");
    changeSelectByLabel(graph.container, "Row part", "drip_tape_8mil_12in"); // CHANGE
    changeSelectByLabel(graph.container, "Row takeoff part", "barb_tee_1_2"); // CHANGE
    changeSelectByLabel(graph.container, "Row end cap", "end_cap_1_2_barb"); // CHANGE
    changeSelectByLabel(graph.container, "Header end cap", "end_cap_1_2_barb");
    assert.equal(bedLayoutRows(bedAssembly.assembly, api).length, 2);
    let leakedKeypress = false;
    graph.container.addEventListener("keypress", function () { leakedKeypress = true; bedAssembly.assembly.value.setAttribute("label", "3"); });
    const protectedRowsInput = inputByLabel(graph.container, "Rows");
    protectedRowsInput.dispatchEvent(new graph.container.ownerDocument.defaultView.Event("keypress", { bubbles: true, cancelable: true }));
    assert.equal(leakedKeypress, false);
    assert.equal(bedAssembly.assembly.getAttribute("label"), "Drip tape 12 in"); // CHANGE
    model.completedEdits = [];
    const rowInput = inputTextByLabel(graph.container, "Rows", "3");
    assert.match(graph.container.querySelector(".trellis-irrigation-bed-template-summary").textContent, /^Rows 3 x /);
    assert.equal(bedLayoutRows(bedAssembly.assembly, api).length, 2);
    assert.equal(model.completedEdits.length, 0);
    blurInput(rowInput);
    assert.equal(model.completedEdits.length, 1);
    assert.equal(bedLayoutRows(bedAssembly.assembly, api).length, 3);
    const emitterInput = inputTextByLabel(graph.container, "Emitter", "8");
    blurInput(emitterInput);
    assert.equal(bedAssembly.assembly.getAttribute("label"), "Drip tape 12 in"); // CHANGE
    assert.equal(bed.getAttribute("label"), "Bed 1");
    const template = api.__test.readBedAssemblyTemplateRecord(moduleCell, bedAssembly.assembly);
    assert.equal(template.templateModel, "bom");
    assert.equal(template.spacing.rows, 3);
    assert.equal(template.spacing.emitterInches, 12);
    assert.equal(template.anchorPartId, "drip_tape_8mil_12in");
    assert.equal(template.inletPartId, "fpt_to_half_barb");
    assert.deepEqual(Array.from(template.partIds), ["fpt_to_half_barb", "drip_tape_8mil_12in", "barb_tee_1_2", "end_cap_1_2_barb", "poly_distribution_1_2"]);
    assert.equal(template.requiredParts[0].partId, "drip_tape_8mil_12in");
    assert.ok(template.requiredParts[0].quantityMeters > 0);
    const assemblyRows = bedLayoutRows(bedAssembly.assembly, api);
    assert.deepEqual(assemblyRows.map(cell => cell.getAttribute("label")), ["Drip tape line", "Drip tape line", "Drip tape line"]); // CHANGE
    assert.equal(assemblyRows.some(cell => /drip tape bed|drip_tape_bed/i.test(cell.getAttribute("label") || "")), false);
    assert.equal(legacyLayout.parent, bed);
    assert.equal(bed.children.includes(legacyLayout), true);
    assert.equal(model.removedCells.includes(legacyLayout), false);
    assert.equal(Array.from(graph.container.querySelectorAll("button")).some(button => /Contract bed assembly|Expand to linked bed size/.test(button.title)), false);
    const prePartialSyncGeometry = Object.assign({}, bedAssembly.assembly.geometry);
    bed.geometry = { x: 140, y: 130, width: 180, height: 96 };
    model.completedEdits = [];
    api.__test.syncLinkedBedAssemblyToBed(moduleCell, bedAssembly.assembly, bed, { fitWidth: true, fitHeight: false });
    assert.equal(model.completedEdits.length, 1);
    assert.equal(JSON.stringify(bedAssembly.assembly.geometry), JSON.stringify({ x: bed.geometry.x, y: prePartialSyncGeometry.y, width: bed.geometry.width, height: prePartialSyncGeometry.height }));
    assert.equal(bedAssembly.assembly.getAttribute("bed_fit_width"), "1");
    assert.equal(bedAssembly.assembly.getAttribute("bed_fit_height"), "0");
    assert.equal(descendants(bedAssembly.assembly, cell => cell.getAttribute && cell.getAttribute(api.attrs.BED_LAYOUT) === "1").length, 3);
    model.completedEdits = [];
    api.__test.syncLinkedBedAssemblyToBed(moduleCell, bedAssembly.assembly, bed, { fitWidth: true, fitHeight: true });
    assert.equal(model.completedEdits.length, 1);
    assert.equal(JSON.stringify(bedAssembly.assembly.geometry), JSON.stringify(bed.geometry));
    assert.equal(bedAssembly.assembly.getAttribute("bed_fit_width"), "1");
    assert.equal(bedAssembly.assembly.getAttribute("bed_fit_height"), "1");
    assert.equal(descendants(bedAssembly.assembly, cell => cell.getAttribute && cell.getAttribute(api.attrs.BED_LAYOUT) === "1").length, 3);
    const paths = api.__test.syncHudGraphState(moduleCell);
    assert.equal(paths.length, 1);
    assert.equal(paths[0].targetBedId, bed.getId());
    assert.equal(moduleCell.getAttribute(api.attrs.PATHS_JSON), null);
    const summary = JSON.parse(moduleCell.getAttribute(api.attrs.REPORT_JSON)).summary;
    assert.equal(Math.round(summary.percentIrrigated), 71);
});

test("direct bed template commits create assembly-owned visual rows", () => {
    const { api, moduleCell, bed } = loadPlugin();
    const catalog = addDripTapeBomParts(sampleCatalog()); // CHANGE
    catalog.items.push(part("overhead_sprinkler_head_30psi", "Overhead sprinkler head", "sprinkler", "in_stock", 14, 1, 1, "barb", "1/2", "barb", "1/2", { flowGpm: 2.5, operatingPressurePsi: 30 }, undefined, true)); // CHANGE
    api.writeCatalog(moduleCell, catalog); // CHANGE
    commitRecipeBedAssembly(api, moduleCell, bed, "bed_one", "overhead_sprinkler_block", 3, "width", { inletPartId: "fpt_to_half_barb", rowPartId: "poly_distribution_1_2", emitterPartId: "overhead_sprinkler_head_30psi", rowTakeoffPartId: "barb_tee_1_2", rowEndCapPartId: "end_cap_1_2_barb", headerEndCapPartId: "end_cap_1_2_barb", emitterSpacingIn: 12 }); // CHANGE
    const bedAssemblies = assemblyCells(moduleCell, api).filter(cell => cell.getAttribute(api.attrs.ASSEMBLY_TYPE) === "bed");
    assert.equal(bedAssemblies.length, 1);
    const assembly = bedAssemblies[0];
    assert.equal(assembly.parent, moduleCell);
    assert.equal(JSON.stringify(assembly.geometry), JSON.stringify(bed.geometry));
    assert.equal(assembly.getAttribute("label"), "Sprinkler 12 in"); // CHANGE
    assertRegularBedAssemblyStyle(assembly);
    assert.ok(assembly.getAttribute(api.attrs.BED_TEMPLATE_JSON));
    assert.equal(api.__test.assemblyPartCells(assembly).length, 0);
    assert.equal(api.__test.readBedAssemblyTemplateRecord(moduleCell, assembly).irrigationType, "sprinkler"); // NEW
    const rows = descendants(assembly, cell => cell.getAttribute && cell.getAttribute(api.attrs.BED_LAYOUT) === "1");
    assert.deepEqual(rows.map(cell => cell.getAttribute("label")), ["Sprinkler line", "Sprinkler line", "Sprinkler line"]);
});

test("multiple bed assemblies on one bed own independent templates and derive method labels", () => {
    const { api, moduleCell, bed } = loadPlugin();
    const catalog = addDripTapeBomParts(sampleCatalog()); // CHANGE
    catalog.items.push(part("microspray_stake_20psi", "Microspray stake", "microspray", "in_stock", 8, 1, 1, "barb", "1/2", "barb", "1/2", { flowGpm: 1.5, operatingPressurePsi: 20 }, undefined, true)); // CHANGE
    api.writeCatalog(moduleCell, catalog); // CHANGE
    const dripAssembly = api.__test.createBedAssembly(moduleCell, bed, { x: 30, y: 220 }).assembly;
    const sprayAssembly = api.__test.createBedAssembly(moduleCell, bed, { x: 30, y: 360 }).assembly;
    commitRecipeBedAssembly(api, moduleCell, dripAssembly, "drip_path", "drip_tape_bed", 2, "width", { inletPartId: "fpt_to_half_barb", rowPartId: "drip_tape_8mil_12in", rowTakeoffPartId: "barb_tee_1_2", rowEndCapPartId: "end_cap_1_2_barb", headerEndCapPartId: "end_cap_1_2_barb", emitterSpacingIn: 12 }); // CHANGE
    commitRecipeBedAssembly(api, moduleCell, sprayAssembly, "spray_path", "nursery_microspray", 2, "width", { inletPartId: "fpt_to_half_barb", rowPartId: "poly_distribution_1_2", emitterPartId: "microspray_stake_20psi", rowTakeoffPartId: "barb_tee_1_2", rowEndCapPartId: "end_cap_1_2_barb", headerEndCapPartId: "end_cap_1_2_barb", emitterSpacingIn: 12 }); // CHANGE

    const dripTemplate = api.__test.readBedAssemblyTemplateRecord(moduleCell, dripAssembly);
    const sprayTemplate = api.__test.readBedAssemblyTemplateRecord(moduleCell, sprayAssembly);
    assert.equal(bed.getAttribute(api.attrs.BED_TEMPLATE_JSON), null);
    assert.equal(dripTemplate.templateId, "drip_tape_bed");
    assert.equal(sprayTemplate.templateId, "nursery_microspray");
    assert.deepEqual(Array.from(api.__test.getBedIrrigationMethods(moduleCell, bed).map(method => method.label)), ["Drip tape", "Microspray"]);
});

test("bed assemblies reject child drops and moved assemblies are lifted back to the module", () => {
    const { api, graph, model, root, moduleCell, bed, document } = loadPlugin();
    api.__test.commitBedTemplate(moduleCell, "bed_one", bed, { templateId: "overhead_sprinkler_block" });
    const assembly = assemblyCells(moduleCell, api).find(cell => cell.getAttribute(api.attrs.ASSEMBLY_TYPE) === "bed");
    const plainContainer = appendChild(moduleCell, makeXmlCell(document, "plain_container", { label: "Plain container" }, { x: 40, y: 36, width: 300, height: 220 }));
    const orphanAssembly = appendChild(root, makeXmlCell(document, "orphan_bed_assembly", { [api.attrs.ASSEMBLY]: "1", [api.attrs.ASSEMBLY_TYPE]: "bed", label: "Orphan Bed Assembly" }, { x: 10, y: 10, width: 100, height: 60 }));
    assert.ok(assembly, "Expected committed bed assembly");
    assert.equal(graph.isValidDropTarget(bed, [assembly]), false);
    assert.equal(graph.isValidDropTarget(plainContainer, [assembly]), false);
    assert.equal(graph.isValidDropTarget(root, [assembly]), false);
    assert.equal(graph.isValidDropTarget(moduleCell, [assembly]), true);
    assert.equal(graph.isValidDropTarget(root, [orphanAssembly]), true);
    const rows = bedLayoutRows(assembly, api);
    assert.equal(rows.length, 3);
    const before = absoluteGeometry(assembly);
    const bedAbs = absoluteGeometry(bed);
    assembly.geometry = { x: before.x - bedAbs.x, y: before.y - bedAbs.y, width: before.width, height: before.height };
    model.add(bed, assembly);
    graph.fireCellsMoved([assembly]);
    assert.equal(assembly.parent, moduleCell);
    assert.deepEqual(absoluteGeometry(assembly), before);
    rows.forEach(row => assert.equal(row.parent, assembly));
});

test("linked bed geometry events refresh bed assembly rows and saved template metrics", () => {
    const harness = loadPlugin();
    const { api, graph, moduleCell, bed } = harness;
    const assembly = createCommittedDripTapeBedAssembly(harness, bed);
    const beforeTemplate = api.__test.readBedAssemblyTemplateRecord(moduleCell, assembly);
    const beforeRows = bedLayoutRows(assembly, api);
    const beforeFirstRow = beforeRows[0];
    const beforeFirstGeometry = Object.assign({}, beforeFirstRow.geometry);
    bed.geometry = { x: 140, y: 130, width: 180, height: 120 };
    graph.fireCellsResized([bed]);
    const afterTemplate = api.__test.readBedAssemblyTemplateRecord(moduleCell, assembly);
    const afterRows = bedLayoutRows(assembly, api);
    assert.equal(JSON.stringify(assembly.geometry), JSON.stringify(bed.geometry));
    assert.equal(afterRows.length, beforeRows.length);
    assert.equal(afterRows[0], beforeFirstRow);
    assert.notEqual(JSON.stringify(afterRows[0].geometry), JSON.stringify(beforeFirstGeometry));
    assert.ok(afterTemplate.rowLengthMeters > beforeTemplate.rowLengthMeters);
    assert.ok(afterTemplate.totalRowMeters > beforeTemplate.totalRowMeters);
    const beforeRequiredMeters = beforeTemplate.requiredParts.reduce((sum, entry) => sum + Number(entry.quantityMeters || 0), 0);
    const afterRequiredMeters = afterTemplate.requiredParts.reduce((sum, entry) => sum + Number(entry.quantityMeters || 0), 0);
    assert.ok(afterRequiredMeters > beforeRequiredMeters);
    bed.geometry = { x: 200, y: 170, width: 180, height: 120 };
    graph.fireCellsMoved([bed], 60, 40);
    assert.equal(JSON.stringify(assembly.geometry), JSON.stringify(bed.geometry));
    bedLayoutRows(assembly, api).forEach(row => assert.equal(row.parent, assembly));
    const disconnectedPaths = api.__test.syncHudGraphState(moduleCell);
    assert.equal(disconnectedPaths.length, 1);
    assert.equal(disconnectedPaths[0].disconnectedFromSource, true);
});

test("moving a bed assembly to another bed relinks and carries template data", () => {
    const harness = loadPlugin();
    const { api, graph, moduleCell, bed, bed2 } = harness;
    const assembly = createCommittedDripTapeBedAssembly(harness, bed);
    const originalTemplate = api.__test.readBedAssemblyTemplateRecord(moduleCell, assembly);
    const originalPorts = JSON.parse(bed.getAttribute(api.attrs.BED_PORTS_JSON));
    assembly.geometry = Object.assign({}, bed2.geometry);
    graph.fireCellsMoved([assembly], bed2.geometry.x - bed.geometry.x, bed2.geometry.y - bed.geometry.y);
    assert.equal(assembly.getAttribute(api.attrs.LINKED_BED_ID), bed2.getId());
    assert.equal(bed.getAttribute(api.attrs.BED_TEMPLATE_JSON), null);
    assert.equal(bed.getAttribute(api.attrs.BED_PORTS_JSON), null);
    const movedTemplate = api.__test.readBedAssemblyTemplateRecord(moduleCell, assembly);
    const movedPorts = JSON.parse(bed2.getAttribute(api.attrs.BED_PORTS_JSON));
    assert.equal(movedTemplate.templateId, originalTemplate.templateId);
    assert.equal(movedTemplate.inletPartId, originalTemplate.inletPartId);
    assert.deepEqual(movedPorts.input, originalPorts.input);
    assert.equal(JSON.stringify(assembly.geometry), JSON.stringify(bed2.geometry));
    bedLayoutRows(assembly, api).forEach(row => assert.equal(row.parent, assembly));
    const savedAfterRelink = assembly.getAttribute(api.attrs.BED_TEMPLATE_JSON);
    assembly.geometry = { x: 520, y: 360, width: 120, height: 60 };
    graph.fireCellsMoved([assembly], 240, 240);
    assert.equal(assembly.getAttribute(api.attrs.LINKED_BED_ID), bed2.getId());
    assert.equal(assembly.getAttribute(api.attrs.BED_TEMPLATE_JSON), savedAfterRelink);
});

test("relinking preserves old bed template while another assembly still uses it", () => {
    const harness = loadPlugin();
    const { api, graph, moduleCell, bed, bed2 } = harness;
    const firstAssembly = createCommittedDripTapeBedAssembly(harness, bed);
    const secondAssembly = api.__test.createBedAssembly(moduleCell, bed, { x: 30, y: 320 }).assembly;
    assert.equal(secondAssembly.getAttribute(api.attrs.LINKED_BED_ID), bed.getId());
    const savedTemplate = firstAssembly.getAttribute(api.attrs.BED_TEMPLATE_JSON);
    firstAssembly.geometry = Object.assign({}, bed2.geometry);
    graph.fireCellsMoved([firstAssembly], bed2.geometry.x - bed.geometry.x, bed2.geometry.y - bed.geometry.y);
    assert.equal(firstAssembly.getAttribute(api.attrs.LINKED_BED_ID), bed2.getId());
    assert.equal(firstAssembly.getAttribute(api.attrs.BED_TEMPLATE_JSON), savedTemplate);
});

test("missing required catalog parts preserve saved metrics while refreshing row geometry", () => {
    const harness = loadPlugin();
    const { api, graph, moduleCell, bed } = harness;
    const assembly = createCommittedDripTapeBedAssembly(harness, bed);
    const beforeTemplate = api.__test.readBedAssemblyTemplateRecord(moduleCell, assembly);
    const beforeRowGeometry = Object.assign({}, bedLayoutRows(assembly, api)[0].geometry);
    api.writeCatalog(moduleCell, sampleCatalog());
    bed.geometry = { x: 120, y: 120, width: 220, height: 120 };
    graph.fireCellsResized([bed]);
    const afterTemplate = api.__test.readBedAssemblyTemplateRecord(moduleCell, assembly);
    assert.equal(afterTemplate.totalRowMeters, beforeTemplate.totalRowMeters);
    assert.equal(afterTemplate.requiredParts[0].quantityMeters, beforeTemplate.requiredParts[0].quantityMeters);
    const afterRowGeometry = bedLayoutRows(assembly, api)[0].geometry;
    assert.notEqual(JSON.stringify(afterRowGeometry), JSON.stringify(beforeRowGeometry));
});

test("syncing legacy swimlane bed assemblies does not restyle them", () => {
    const { api, moduleCell, bed, document } = loadPlugin();
    const legacyAssembly = appendChild(moduleCell, makeXmlCell(document, "legacy_bed_assembly", { [api.attrs.ASSEMBLY]: "1", [api.attrs.ASSEMBLY_TYPE]: "bed", [api.attrs.LINKED_BED_ID]: bed.getId(), label: "Legacy Bed Assembly" }, Object.assign({}, bed.geometry)));
    legacyAssembly.style = "swimlane;whiteSpace=wrap;html=1;childLayout=stackLayout;horizontalStack=0;rounded=1;fillColor=#ffffff;strokeColor=#666666;";
    api.__test.syncLinkedBedAssemblyToBed(moduleCell, legacyAssembly, bed, { fitWidth: true, fitHeight: true });
    assert.match(legacyAssembly.style, /(?:^|;)swimlane(?:;|$)/);
    assert.equal(styleToken(legacyAssembly.style, "childLayout"), "stackLayout");
    assert.equal(styleToken(legacyAssembly.style, "horizontalStack"), "0");
});

test("syncing existing regular bed assemblies moves labels above the bed edge", () => { // CHANGE
    const { api, moduleCell, bed } = loadPlugin(); // CHANGE
    const bedAssembly = api.__test.createBedAssembly(moduleCell, bed, { x: 30, y: 220 }).assembly; // CHANGE
    bedAssembly.style = "rounded=1;whiteSpace=wrap;html=1;container=1;recursiveResize=0;collapsible=0;editable=0;fillColor=none;strokeColor=#666666;fontStyle=1;fontSize=14;align=center;verticalAlign=top;spacingTop=6;spacingLeft=6;spacingRight=6;labelBackgroundColor=#ffffff;"; // CHANGE
    api.__test.syncLinkedBedAssemblyToBed(moduleCell, bedAssembly, bed, { fitWidth: true, fitHeight: true }); // CHANGE
    assertRegularBedAssemblyStyle(bedAssembly); // CHANGE
}); // CHANGE

test("bed assembly BOM parts persist and drive inlet/outlet connector compatibility", () => {
    const { api, graph, moduleCell, bed } = loadPlugin();
    const catalog = addDripTapeBomParts(sampleCatalog());
    catalog.items.push(part("spray_3_4", "Spray 3/4", "sprinkler", "in_stock", 9, 1, 1, "barb", "3/4", "barb", "3/4", { pressureLossPsi: 0.2 }, undefined, true));
    api.writeCatalog(moduleCell, catalog);
    const bedAssembly = api.__test.createBedAssembly(moduleCell, bed, { x: 240, y: 120 });
    assertRegularBedAssemblyStyle(bedAssembly.assembly);
    api.openIrrigationMode(moduleCell, { preserveViewport: true });
    graph.setSelectionCell(bedAssembly.assembly);
    const inlet = selectByLabel(graph.container, "Inlet part");
    const outlet = selectByLabel(graph.container, "Outlet part");
    const orientation = selectByLabel(graph.container, "Row orientation");
    assert.equal(orientation.value, "width");
    assert.ok(Array.from(inlet.querySelectorAll("optgroup")).some(group => group.label === "Fittings / Thread adapters / 1/2 <-> 3/4 FPT")); // CHANGE
    assert.equal(Array.from(graph.container.querySelectorAll("label")).some(label => label.textContent.startsWith("Pipe/tubing")), false);
    assert.equal(Array.from(inlet.options).some(option => option.value === "pipe_cheap"), false);
    assert.equal(Array.from(outlet.options).some(option => option.value === "pipe_cheap"), false);
    assert.equal(Array.from(inlet.options).some(option => option.value === "drip_tape_8mil_12in"), true);
    assert.equal(Array.from(outlet.options).some(option => option.value === "drip_tape_8mil_12in"), false);
    assert.equal(Array.from(inlet.options).some(option => option.value === "fpt_to_half_barb"), true);
    assert.equal(Array.from(outlet.options).some(option => option.value === "half_barb_to_3_4_barb"), false);
    assert.equal(Array.from(inlet.options).some(option => option.value === "half_barb_plug"), false);
    assert.equal(Array.from(inlet.options).some(option => option.value === "filter"), false);
    assert.equal(Array.from(inlet.options).some(option => option.value === "spray_3_4"), false);
    changeSelectByLabel(graph.container, "Inlet part", "fpt_to_half_barb");
    assert.equal(Array.from(selectByLabel(graph.container, "Outlet part").options).some(option => option.value === "half_barb_to_3_4_barb"), true);
    changeSelectByLabel(graph.container, "Row part", "drip_tape_8mil_12in"); // CHANGE
    changeSelectByLabel(graph.container, "Row takeoff part", "barb_tee_1_2"); // CHANGE
    changeSelectByLabel(graph.container, "Row end cap", "end_cap_1_2_barb"); // CHANGE
    changeSelectByLabel(graph.container, "Outlet part", "half_barb_to_3_4_barb");
    changeSelectByLabel(graph.container, "Row orientation", "height");
    const template = api.__test.readBedAssemblyTemplateRecord(moduleCell, bedAssembly.assembly);
    assert.equal(template.templateModel, "bom");
    assert.equal(template.inletPartId, "fpt_to_half_barb");
    assert.equal(template.outletPartId, "half_barb_to_3_4_barb");
    assert.equal(template.pipePartId, "");
    assert.equal(template.anchorPartId, "drip_tape_8mil_12in");
    assert.equal(template.rowOrientation, "height");
    assert.deepEqual(Array.from(template.partIds), ["fpt_to_half_barb", "half_barb_to_3_4_barb", "drip_tape_8mil_12in", "barb_tee_1_2", "end_cap_1_2_barb", "poly_distribution_1_2"]);
    assert.equal(template.requiredParts[0].partId, "drip_tape_8mil_12in");
    assert.ok(template.requiredParts[0].quantityMeters > 0);
    assert.ok(template.demand.flowGpm > 1.2);
    const ports = JSON.parse(bed.getAttribute(api.attrs.BED_PORTS_JSON));
    assert.equal(ports.inputs, 1);
    assert.equal(ports.outputs, 1);
    assert.equal(ports.input.type, "fpt");
    assert.equal(ports.input.nominalSize, "3/4");
    assert.equal(ports.output.type, "barb");
    assert.equal(ports.output.nominalSize, "3/4");
    assert.equal(JSON.stringify(api.__test.portConnectorForCell(moduleCell, bedAssembly.assembly, "input")), JSON.stringify(ports.input));
    assert.equal(JSON.stringify(api.__test.portConnectorForCell(moduleCell, bedAssembly.assembly, "output")), JSON.stringify(ports.output));
    const rows = descendants(bedAssembly.assembly, cell => cell.getAttribute && cell.getAttribute(api.attrs.BED_LAYOUT) === "1");
    assert.ok(rows[0].geometry.height > rows[0].geometry.width);
    const source = api.__test.createSourceAssembly(moduleCell, "Hose", { connectorType: "mpt", nominalSize: "3/4", usableFlowGpm: 5, staticPressurePsi: 45 }, { x: 30, y: 40 });
    const direct = api.__test.createAssemblyConnection(moduleCell, { cellId: api.__test.firstAssemblyPart(source.assembly).getId(), role: "output", index: 0 }, { cellId: bedAssembly.assembly.getId(), role: "input", index: 0 });
    assert.equal(direct.ok, true, direct.reason);
    assert.equal(direct.edge.getAttribute(api.attrs.DIRECT_LINK_EDGE), "1");
    const filter = api.__test.createPartAssembly(moduleCell, catalog.items.find(item => item.id === "filter"), { x: 460, y: 120 });
    const outletConnection = api.__test.createAssemblyConnection(moduleCell, { cellId: bedAssembly.assembly.getId(), role: "output", index: 0 }, { cellId: api.__test.firstAssemblyPart(filter.assembly).getId(), role: "input", index: 0 });
    assert.equal(outletConnection.ok, true, outletConnection.reason);
    assert.equal(outletConnection.edge.getAttribute(api.attrs.PIPE_EDGE), "1");
    assert.equal(outletConnection.edge.getAttribute(api.attrs.PIPE_PART_ID), "pipe_cheap");
});

test("bed assembly inlet supply size filters rows takeoffs and reversed option names", () => { // NEW
    const { api, graph, moduleCell, bed } = loadPlugin(); // NEW
    const catalog = addDripTapeBomParts(sampleCatalog()); // NEW
    catalog.items.push(part("end_cap_3_4_barb", "3/4 barb header cap", "cap_end", "in_stock", 1.5, 1, 0, "barb", "3/4", "", "", { pressureLossPsi: 0 }, undefined, true)); // NEW
    catalog.items.push(part("reverse_reducer_takeoff", "1/2 barb to 3/4 barb reducer", "fitting", "in_stock", 3, 1, 1, "barb", "1/2", "barb", "3/4", { pressureLossPsi: 0.2 }, undefined, true)); // NEW
    api.writeCatalog(moduleCell, catalog); // NEW
    const bedAssembly = api.__test.createBedAssembly(moduleCell, bed, { x: 240, y: 120 }); // NEW
    api.openIrrigationMode(moduleCell, { preserveViewport: true }); // NEW
    graph.setSelectionCell(bedAssembly.assembly); // NEW

    changeSelectByLabel(graph.container, "Inlet part", "fpt_to_barb"); // NEW
    const rowOptions = Array.from(selectByLabel(graph.container, "Row part").options).map(option => option.value); // NEW
    assert.ok(rowOptions.includes("drip_tape_8mil_12in")); // NEW
    changeSelectByLabel(graph.container, "Row part", "drip_tape_8mil_12in"); // NEW
    const takeoff = selectByLabel(graph.container, "Row takeoff part"); // NEW
    assert.ok(Array.from(takeoff.options).some(option => option.value === "barb_tee_3_4_to_1_2")); // NEW
    assert.equal(Array.from(takeoff.options).some(option => option.value === "barb_tee_1_2"), false); // NEW
    assert.match(Array.from(takeoff.options).find(option => option.value === "reverse_reducer_takeoff").textContent, /3\/4": 1\/2" barb adapter/); // NEW
    assert.match(Array.from(selectByLabel(graph.container, "Outlet part").options).find(option => option.value === "half_barb_to_3_4_barb").textContent, /3\/4": 1\/2" barb adapter/); // NEW

    changeSelectByLabel(graph.container, "Row takeoff part", "barb_tee_3_4_to_1_2"); // NEW
    changeSelectByLabel(graph.container, "Row end cap", "end_cap_1_2_barb"); // NEW
    changeSelectByLabel(graph.container, "Header end cap", "end_cap_3_4_barb"); // NEW
    const template = api.__test.readBedAssemblyTemplateRecord(moduleCell, bedAssembly.assembly); // NEW
    assert.equal(template.supplyPipePartId, "poly_mainline_3_4"); // NEW
    assert.equal(template.rowPartId, "drip_tape_8mil_12in"); // NEW
    assert.equal(template.rowTakeoffPartId, "barb_tee_3_4_to_1_2"); // NEW
    const ports = JSON.parse(bed.getAttribute(api.attrs.BED_PORTS_JSON)); // NEW
    assert.equal(ports.input.nominalSize, "3/4"); // NEW
    assert.equal(ports.outputs, 0); // NEW
}); // NEW

test("bed assembly labels soaker rows without emitter spacing", () => { // NEW
    const { api, graph, moduleCell, bed } = loadPlugin(); // NEW
    const catalog = addDripTapeBomParts(sampleCatalog()); // NEW
    catalog.items.push(part("soaker_row_line_1_2", "1/2 soaker row line", "dripline", "in_stock", 30, 1, 1, "barb", "1/2", "barb", "1/2", { flowGpm: 1.3, emitterFlowGph: 0.8, emitterSpacingIn: 12, wettedWidthIn: 18, operatingPressurePsi: 10 }, 0.3, true)); // NEW
    api.writeCatalog(moduleCell, catalog); // NEW
    const bedAssembly = api.__test.createBedAssembly(moduleCell, bed, { x: 240, y: 120 }); // NEW
    api.openIrrigationMode(moduleCell, { preserveViewport: true }); // NEW
    graph.setSelectionCell(bedAssembly.assembly); // NEW
    changeSelectByLabel(graph.container, "Inlet part", "fpt_to_half_barb"); // NEW
    changeSelectByLabel(graph.container, "Row part", "soaker_row_line_1_2"); // NEW
    changeSelectByLabel(graph.container, "Row takeoff part", "barb_tee_1_2"); // NEW
    changeSelectByLabel(graph.container, "Row end cap", "end_cap_1_2_barb"); // NEW
    changeSelectByLabel(graph.container, "Header end cap", "end_cap_1_2_barb"); // NEW
    const template = api.__test.readBedAssemblyTemplateRecord(moduleCell, bedAssembly.assembly); // NEW
    assert.equal(bedAssembly.assembly.getAttribute("label"), "Soaker hose"); // NEW
    assert.equal(template.irrigationType, "soaker_hose"); // NEW
    assert.deepEqual(bedLayoutRows(bedAssembly.assembly, api).map(cell => cell.getAttribute("label")), ["Soaker hose", "Soaker hose"]); // NEW
    assert.deepEqual(Array.from(api.__test.getBedIrrigationMethods(moduleCell, bed).map(method => method.label)), ["Soaker hose"]); // NEW
}); // NEW

test("connected bed assembly inlet and outlet part selectors lock by connected port", () => {
    const { api, graph, moduleCell, bed, bed2 } = loadPlugin();
    const catalog = addDripTapeBomParts(sampleCatalog());
    api.writeCatalog(moduleCell, catalog);
    api.openIrrigationMode(moduleCell, { preserveViewport: true });

    const inletLockedBed = createConfiguredDripTapeBedAssembly(api, graph, moduleCell, bed, { x: 240, y: 120 });
    const source = api.__test.createSourceAssembly(moduleCell, "Hose", { connectorType: "mpt", nominalSize: "3/4", usableFlowGpm: 5, staticPressurePsi: 45 }, { x: 30, y: 40 });
    const inletConnection = api.__test.createAssemblyConnection(moduleCell, { cellId: api.__test.firstAssemblyPart(source.assembly).getId(), role: "output", index: 0 }, { cellId: inletLockedBed.getId(), role: "input", index: 0 });
    assert.equal(inletConnection.ok, true, inletConnection.reason);
    graph.setSelectionCell(inletLockedBed);
    assert.equal(selectByLabel(graph.container, "Inlet part").disabled, true);
    assert.equal(selectByLabel(graph.container, "Outlet part").disabled, false);

    const outletOnlyBed = createConfiguredDripTapeBedAssembly(api, graph, moduleCell, bed2, { x: 440, y: 120 });
    const outletFilter = api.__test.createPartAssembly(moduleCell, catalog.items.find(item => item.id === "filter"), { x: 650, y: 120 });
    const outletOnlyConnection = api.__test.createAssemblyConnection(moduleCell, { cellId: outletOnlyBed.getId(), role: "output", index: 0 }, { cellId: api.__test.firstAssemblyPart(outletFilter.assembly).getId(), role: "input", index: 0 });
    assert.equal(outletOnlyConnection.ok, true, outletOnlyConnection.reason);
    graph.setSelectionCell(outletOnlyBed);
    assert.equal(selectByLabel(graph.container, "Inlet part").disabled, true); // CHANGE
    assert.equal(selectByLabel(graph.container, "Outlet part").disabled, true);

    const downstreamFilter = api.__test.createPartAssembly(moduleCell, catalog.items.find(item => item.id === "filter"), { x: 460, y: 320 });
    const outletConnection = api.__test.createAssemblyConnection(moduleCell, { cellId: inletLockedBed.getId(), role: "output", index: 0 }, { cellId: api.__test.firstAssemblyPart(downstreamFilter.assembly).getId(), role: "input", index: 0 });
    assert.equal(outletConnection.ok, true, outletConnection.reason);
    graph.setSelectionCell(inletLockedBed);
    assert.equal(selectByLabel(graph.container, "Inlet part").disabled, true);
    assert.equal(selectByLabel(graph.container, "Outlet part").disabled, true);
});

test("locked bed assembly part selectors preserve values during template refresh", () => {
    const { api, graph, moduleCell, bed } = loadPlugin();
    const catalog = addDripTapeBomParts(sampleCatalog());
    api.writeCatalog(moduleCell, catalog);
    api.openIrrigationMode(moduleCell, { preserveViewport: true });
    const bedAssembly = createConfiguredDripTapeBedAssembly(api, graph, moduleCell, bed, { x: 240, y: 120 });
    const source = api.__test.createSourceAssembly(moduleCell, "Hose", { connectorType: "mpt", nominalSize: "3/4", usableFlowGpm: 5, staticPressurePsi: 45 }, { x: 30, y: 40 });
    const inletConnection = api.__test.createAssemblyConnection(moduleCell, { cellId: api.__test.firstAssemblyPart(source.assembly).getId(), role: "output", index: 0 }, { cellId: bedAssembly.getId(), role: "input", index: 0 });
    assert.equal(inletConnection.ok, true, inletConnection.reason);
    const filter = api.__test.createPartAssembly(moduleCell, catalog.items.find(item => item.id === "filter"), { x: 460, y: 120 });
    const outletConnection = api.__test.createAssemblyConnection(moduleCell, { cellId: bedAssembly.getId(), role: "output", index: 0 }, { cellId: api.__test.firstAssemblyPart(filter.assembly).getId(), role: "input", index: 0 });
    assert.equal(outletConnection.ok, true, outletConnection.reason);
    graph.setSelectionCell(bedAssembly);
    assert.equal(selectByLabel(graph.container, "Inlet part").value, "fpt_to_half_barb");
    assert.equal(selectByLabel(graph.container, "Outlet part").value, "half_barb_to_3_4_barb");

    changeSelectByLabel(graph.container, "Row orientation", "height");
    graph.setSelectionCell(bedAssembly);
    assert.equal(selectByLabel(graph.container, "Inlet part").disabled, true);
    assert.equal(selectByLabel(graph.container, "Outlet part").disabled, true);
    assert.equal(selectByLabel(graph.container, "Inlet part").value, "fpt_to_half_barb");
    assert.equal(selectByLabel(graph.container, "Outlet part").value, "half_barb_to_3_4_barb");
});

test("bed inlet role uses the selected non-pipe part upstream side", () => {
    const { api, graph, moduleCell, bed } = loadPlugin();
    const catalog = addDripTapeBomParts(sampleCatalog());
    catalog.items.push(part("threaded_inline", "Threaded inline", "fitting", "in_stock", 5, 1, 1, "fght", "3/4", "barb", "1/2", { pressureLossPsi: 0.2 }, undefined, true)); // CHANGE
    catalog.items.push(part("barb_header_cap_1_2", "1/2 barb header cap", "cap_end", "in_stock", 1, 1, 0, "barb", "1/2", "", "", { pressureLossPsi: 0 }, undefined, true)); // CHANGE
    api.writeCatalog(moduleCell, catalog);
    const bedAssembly = api.__test.createBedAssembly(moduleCell, bed, { x: 240, y: 120 });
    api.openIrrigationMode(moduleCell, { preserveViewport: true });
    graph.setSelectionCell(bedAssembly.assembly);
    changeSelectByLabel(graph.container, "Inlet part", "threaded_inline");
    changeSelectByLabel(graph.container, "Row part", "drip_tape_8mil_12in"); // CHANGE
    changeSelectByLabel(graph.container, "Row takeoff part", "barb_tee_1_2"); // CHANGE
    changeSelectByLabel(graph.container, "Row end cap", "end_cap_1_2_barb"); // CHANGE
    changeSelectByLabel(graph.container, "Header end cap", "barb_header_cap_1_2"); // CHANGE
    const ports = JSON.parse(bed.getAttribute(api.attrs.BED_PORTS_JSON));
    assert.equal(ports.input.type, "fght");
    assert.equal(ports.input.nominalSize, "3/4");
    assert.equal(ports.outputs, 0);
});

test("selected bed assembly ports do not show Add Part placement UI", () => {
    const { api, graph, moduleCell, bed } = loadPlugin();
    const catalog = addDripTapeBomParts(sampleCatalog());
    catalog.items.push(part("bed_feed_adapter", "Bed feed adapter", "fitting", "in_stock", 6, 1, 1, "fght", "3/4", "mpt", "3/4", { pressureLossPsi: 0.2 }));
    api.writeCatalog(moduleCell, catalog);
    const bedAssembly = api.__test.createBedAssembly(moduleCell, bed, { x: 240, y: 120 });
    api.openIrrigationMode(moduleCell, { preserveViewport: true });
    graph.setSelectionCell(bedAssembly.assembly);
    changeSelectByLabel(graph.container, "Inlet part", "fpt_to_half_barb");
    changeSelectByLabel(graph.container, "Row part", "drip_tape_8mil_12in"); // CHANGE
    changeSelectByLabel(graph.container, "Row takeoff part", "barb_tee_1_2"); // CHANGE
    changeSelectByLabel(graph.container, "Row end cap", "end_cap_1_2_barb"); // CHANGE
    changeSelectByLabel(graph.container, "Outlet part", "half_barb_to_3_4_barb");
    graph.setSelectionCell(bedAssembly.assembly);
    assert.equal(graph.container.querySelectorAll(".trellis-irrigation-connection-row").length, 0);

    clickPort(graph.container, /Inlet 1 free/);
    assert.equal(graph.container.querySelector(".trellis-irrigation-add-part-picker"), null);
    assert.equal(buttonTexts(graph.container).includes("Add Part"), false);
    assert.equal(api.__test.collectAssemblyEdges(moduleCell).length, 0);
    assert.ok(portBadgesInState(graph.container, "selected").length >= 1);

    graph.setSelectionCell(bedAssembly.assembly);
    clickPort(graph.container, /Outlet 1 free/);
    assert.equal(graph.container.querySelector(".trellis-irrigation-add-part-picker"), null);
    assert.equal(buttonTexts(graph.container).includes("Add Part"), false);
    assert.equal(api.__test.collectAssemblyEdges(moduleCell).length, 0);
});

test("unconnected bed inlet port renders only the selected inlet selector", () => {
    const { api, graph, moduleCell, bed } = loadPlugin();
    api.writeCatalog(moduleCell, addDripTapeBomParts(sampleCatalog()));
    const bedAssembly = api.__test.createBedAssembly(moduleCell, bed, { x: 240, y: 120 });
    api.openIrrigationMode(moduleCell, { preserveViewport: true });
    graph.setSelectionCell(bedAssembly.assembly);
    changeSelectByLabel(graph.container, "Inlet part", "fpt_to_half_barb");
    changeSelectByLabel(graph.container, "Row part", "drip_tape_8mil_12in"); // CHANGE
    changeSelectByLabel(graph.container, "Row takeoff part", "barb_tee_1_2"); // CHANGE
    changeSelectByLabel(graph.container, "Row end cap", "end_cap_1_2_barb"); // CHANGE
    changeSelectByLabel(graph.container, "Outlet part", "half_barb_to_3_4_barb");

    clickPort(graph.container, /Inlet 1 free/);

    const hud = graph.container.querySelector(".trellis-irrigation-port-only-hud");
    assert.ok(hud, "Missing port-only HUD");
    assert.match(hud.querySelector(".trellis-irrigation-hud-header-title").textContent, /FPT to 1\/2 barb/);
    assert.ok(selectByLabel(hud, "Inlet part"));
    ["Outlet part", "Template", "Row orientation", "Rows", "Emitter/device part", "Header end cap"].forEach(label => assert.equal(querySelectByLabel(hud, label), null, label));
    ["BOM", "Catalog", "Exit", "Delete Assembly", "Edit Zones", "Reset Zone", "Planned", "Completed"].forEach(text => assert.equal(buttonTexts(hud).includes(text), false, text));
    assert.equal(hud.querySelector(".trellis-irrigation-bed-template-summary"), null);
    assert.equal(hud.querySelector(".trellis-irrigation-connection-row"), null);
});

test("unconnected bed outlet port renders only outlet selector and clears header end cap on change", () => {
    const { api, graph, moduleCell, bed } = loadPlugin();
    const catalog = addDripTapeBomParts(sampleCatalog());
    catalog.items.push(part("half_barb_to_1_barb", "1/2 barb to 1 barb", "fitting", "in_stock", 4, 1, 1, "barb", "1/2", "barb", "1", { pressureLossPsi: 0.2 }, undefined, true));
    api.writeCatalog(moduleCell, catalog);
    const bedAssembly = api.__test.createBedAssembly(moduleCell, bed, { x: 240, y: 120 });
    api.openIrrigationMode(moduleCell, { preserveViewport: true });
    graph.setSelectionCell(bedAssembly.assembly);
    changeSelectByLabel(graph.container, "Inlet part", "fpt_to_half_barb");
    changeSelectByLabel(graph.container, "Row part", "drip_tape_8mil_12in"); // CHANGE
    changeSelectByLabel(graph.container, "Row takeoff part", "barb_tee_1_2"); // CHANGE
    changeSelectByLabel(graph.container, "Row end cap", "end_cap_1_2_barb"); // CHANGE
    changeSelectByLabel(graph.container, "Header end cap", "end_cap_1_2_barb");
    let template = api.__test.readBedAssemblyTemplateRecord(moduleCell, bedAssembly.assembly);
    assert.equal(template.headerEndCapPartId, "end_cap_1_2_barb");
    graph.setSelectionCell(bedAssembly.assembly);
    changeSelectByLabel(graph.container, "Outlet part", "half_barb_to_3_4_barb");
    graph.setSelectionCell(bedAssembly.assembly);

    clickPort(graph.container, /Outlet 1 free/);
    const hud = graph.container.querySelector(".trellis-irrigation-port-only-hud");
    assert.ok(hud, "Missing port-only HUD");
    assert.ok(selectByLabel(hud, "Outlet part"));
    assert.equal(querySelectByLabel(hud, "Header end cap"), null);
    changeSelectByLabel(hud, "Outlet part", "half_barb_to_1_barb");

    template = api.__test.readBedAssemblyTemplateRecord(moduleCell, bedAssembly.assembly);
    assert.equal(template.outletPartId, "half_barb_to_1_barb");
    assert.equal(template.headerEndCapPartId, "");
});

test("unconnected regular part port renders only the single connection combobox", () => {
    const { api, graph, moduleCell } = loadPlugin();
    const catalog = addDripTapeBomParts(sampleCatalog());
    api.writeCatalog(moduleCell, catalog);
    const assembly = api.__test.createPartAssembly(moduleCell, catalog.items.find(item => item.id === "filter"), { x: 240, y: 120 });
    api.openIrrigationMode(moduleCell, { preserveViewport: true });
    graph.setSelectionCell(assembly.assembly);

    clickPort(graph.container, /Outlet 1 free/);

    const hud = graph.container.querySelector(".trellis-irrigation-port-only-hud");
    assert.ok(hud, "Missing port-only HUD");
    assert.match(hud.querySelector(".trellis-irrigation-hud-header-title").textContent, /Filter/);
    assert.equal(hud.querySelectorAll(".trellis-irrigation-connection-combobox").length, 1);
    assert.equal(hud.querySelectorAll(".trellis-irrigation-connection-row").length, 0);
    assert.equal(querySelectByLabel(hud, "Inlet part"), null);
    ["BOM", "Catalog", "Exit", "Delete Assembly", "Planned", "Completed"].forEach(text => assert.equal(buttonTexts(hud).includes(text), false, text));
});

test("graph cell selection clears selected port badge state and restores normal HUD", () => {
    const { api, graph, moduleCell, bed } = loadPlugin();
    api.writeCatalog(moduleCell, addDripTapeBomParts(sampleCatalog()));
    const bedAssembly = api.__test.createBedAssembly(moduleCell, bed, { x: 240, y: 120 });
    api.openIrrigationMode(moduleCell, { preserveViewport: true });
    graph.setSelectionCell(bedAssembly.assembly);
    changeSelectByLabel(graph.container, "Inlet part", "fpt_to_half_barb");
    changeSelectByLabel(graph.container, "Row part", "drip_tape_8mil_12in"); // CHANGE
    changeSelectByLabel(graph.container, "Row takeoff part", "barb_tee_1_2"); // CHANGE
    changeSelectByLabel(graph.container, "Row end cap", "end_cap_1_2_barb"); // CHANGE
    changeSelectByLabel(graph.container, "Outlet part", "half_barb_to_3_4_barb");
    clickPort(graph.container, /Inlet 1 free/);
    assert.ok(graph.container.querySelector(".trellis-irrigation-port-only-hud"));
    assert.ok(portBadgesInState(graph.container, "selected").length >= 1);

    graph.fireClick(bedAssembly.assembly);

    assert.equal(graph.container.querySelector(".trellis-irrigation-port-only-hud"), null);
    assert.ok(graph.container.querySelector(".trellis-irrigation-local-hud"));
    assert.equal(portBadgesInState(graph.container, "selected").length, 0);
    assert.ok(selectByLabel(graph.container, "Inlet part"));
    assert.ok(selectByLabel(graph.container, "Outlet part"));
});

test("connected port badge does not enter unconnected port-only selector mode", () => {
    const { api, graph, moduleCell, bed } = loadPlugin();
    api.writeCatalog(moduleCell, addDripTapeBomParts(sampleCatalog()));
    const bedAssembly = api.__test.createBedAssembly(moduleCell, bed, { x: 240, y: 120 });
    const source = api.__test.createSourceAssembly(moduleCell, "Hose", { connectorType: "mpt", nominalSize: "3/4", usableFlowGpm: 5, staticPressurePsi: 45 }, { x: 30, y: 40 });
    api.openIrrigationMode(moduleCell, { preserveViewport: true });
    graph.setSelectionCell(bedAssembly.assembly);
    changeSelectByLabel(graph.container, "Inlet part", "fpt_to_half_barb");
    changeSelectByLabel(graph.container, "Row part", "drip_tape_8mil_12in"); // CHANGE
    changeSelectByLabel(graph.container, "Row takeoff part", "barb_tee_1_2"); // CHANGE
    changeSelectByLabel(graph.container, "Row end cap", "end_cap_1_2_barb"); // CHANGE
    changeSelectByLabel(graph.container, "Outlet part", "half_barb_to_3_4_barb");
    const connected = api.__test.createAssemblyConnection(moduleCell, { cellId: api.__test.firstAssemblyPart(source.assembly).getId(), role: "output", index: 0 }, { cellId: bedAssembly.assembly.getId(), role: "input", index: 0 });
    assert.equal(connected.ok, true, connected.reason);
    graph.setSelectionCell(bedAssembly.assembly);

    clickPort(graph.container, /Inlet 1 connected/);

    assert.equal(graph.container.querySelector(".trellis-irrigation-port-only-hud"), null);
    assert.ok(portBadgesInState(graph.container, "selected").some(node => /Inlet 1 connected selected/.test(node.title)));
});

test("bed template anchor selection uses largest pipe-like required part deterministically", () => {
    const { api } = loadPlugin();
    const catalog = { items: [
        part("pipe_half", "1/2 pipe", "pipe_tubing", "in_stock", 0, 1, 1, "barb", "1/2", "barb", "1/2", { innerDiameterIn: 0.6 }, 0.3, true),
        part("pipe_quarter", "1/4 pipe", "pipe_tubing", "in_stock", 0, 1, 1, "barb", "1/4", "barb", "1/4", { innerDiameterIn: 0.17 }, 0.1, true),
        part("soaker_half", "1/2 soaker", "dripline", "in_stock", 10, 1, 1, "barb", "1/2", "barb", "1/2", { flowGpm: 0.8, flowGpmPerMeter: 0.8, operatingPressurePsi: 10 }, 0.4, true),
        part("drip_half", "1/2 dripline", "dripline", "in_stock", 10, 1, 1, "barb", "1/2", "barb", "1/2", { flowGpm: 1, flowGpmPerMeter: 1, operatingPressurePsi: 12 }, 0.4, true)
    ] };
    assert.equal(api.__test.resolveTemplateAnchorPart(catalog, [{ partId: "pipe_quarter" }, { partId: "pipe_half" }]).id, "pipe_half");
    assert.equal(api.__test.resolveTemplateAnchorPart(catalog, [{ partId: "soaker_half" }]).id, "soaker_half");
    assert.equal(api.__test.resolveTemplateAnchorPart(catalog, [{ partId: "drip_half" }, { partId: "pipe_half" }]).id, "pipe_half");
});

test("bed template BOM quantities, flow, pressure, and meter costs scale from row meters", () => {
    const { api } = loadPlugin();
    const catalog = addDripTapeBomParts(sampleCatalog());
    const bom = api.__test.computeBedTemplateBom(catalog, { width: 90, height: 45 }, "drip_tape_bed", 3, "width");
    assert.ok(Math.abs(bom.rowLengthMeters - 1) < 0.0001);
    assert.ok(Math.abs(bom.totalRowMeters - 3) < 0.0001);
    assert.ok(Math.abs(bom.requiredParts[0].quantityMeters - 3) < 0.0001);
    assert.ok(Math.abs(bom.demand.flowGpm - 3.6) < 0.0001);
    assert.equal(bom.demand.operatingPressurePsi, 10);
    assert.ok(Math.abs(api.__test.partCostForRequiredMeters(catalog, "drip_tape_8mil_12in", 3) - (0.42 * (3 / 0.3048))) < 0.0001);
});

test("bed recipe UI toggles self-emitting and device row controls", () => {
    const { api, graph, moduleCell, bed } = loadPlugin();
    const catalog = addDripTapeBomParts(sampleCatalog());
    catalog.items.push(part("overhead_sprinkler_head_30psi", "Overhead sprinkler head", "sprinkler", "in_stock", 14, 1, 1, "barb", "1/2", "barb", "1/2", { flowGpm: 2.5, operatingPressurePsi: 30 }, undefined, true));
    api.writeCatalog(moduleCell, catalog);
    const bedAssembly = api.__test.createBedAssembly(moduleCell, bed, { x: 240, y: 120 });
    api.openIrrigationMode(moduleCell, { preserveViewport: true });
    graph.setSelectionCell(bedAssembly.assembly);
    const outletLabel = selectByLabel(graph.container, "Outlet part").parentNode;
    assert.match(outletLabel.getAttribute("style") || "", /display:\s*none/);
    assert.match(selectByLabel(graph.container, "Emitter/device part").parentNode.getAttribute("style") || "", /display:\s*none/);
    assert.match(selectByLabel(graph.container, "Header end cap").parentNode.getAttribute("style") || "", /display:\s*flex/);
    assert.match(inputByLabel(graph.container, "Rows").parentNode.getAttribute("style") || "", /display:\s*none/); // NEW
    assert.match(inputByLabel(graph.container, "Row spacing").parentNode.getAttribute("style") || "", /display:\s*none/); // NEW
    assert.match(inputByLabel(graph.container, "Emitter spacing in").parentNode.getAttribute("style") || "", /display:\s*none/); // NEW
    assert.equal(inputByLabel(graph.container, "Emitter spacing in").disabled, true);
    changeSelectByLabel(graph.container, "Inlet part", "fpt_to_half_barb");
    assert.match(selectByLabel(graph.container, "Outlet part").parentNode.getAttribute("style") || "", /display:\s*flex/);
    assert.match(selectByLabel(graph.container, "Header end cap").parentNode.getAttribute("style") || "", /display:\s*flex/);
    assert.match(inputByLabel(graph.container, "Rows").parentNode.getAttribute("style") || "", /display:\s*none/); // NEW
    assert.match(inputByLabel(graph.container, "Row spacing").parentNode.getAttribute("style") || "", /display:\s*none/); // NEW
    assert.match(inputByLabel(graph.container, "Emitter spacing in").parentNode.getAttribute("style") || "", /display:\s*none/); // NEW
    changeSelectByLabel(graph.container, "Row part", "poly_distribution_1_2"); // CHANGE
    assert.match(inputByLabel(graph.container, "Rows").parentNode.getAttribute("style") || "", /display:\s*flex/); // NEW
    assert.match(inputByLabel(graph.container, "Row spacing").parentNode.getAttribute("style") || "", /display:\s*flex/); // NEW
    assert.match(inputByLabel(graph.container, "Emitter spacing in").parentNode.getAttribute("style") || "", /display:\s*flex/); // NEW
    assert.match(selectByLabel(graph.container, "Emitter/device part").parentNode.getAttribute("style") || "", /display:\s*flex/); // CHANGE
    assert.equal(inputByLabel(graph.container, "Emitter spacing in").disabled, false); // CHANGE
    changeSelectByLabel(graph.container, "Row part", "drip_tape_8mil_12in"); // CHANGE
    assert.match(inputByLabel(graph.container, "Rows").parentNode.getAttribute("style") || "", /display:\s*flex/); // NEW
    assert.match(inputByLabel(graph.container, "Row spacing").parentNode.getAttribute("style") || "", /display:\s*flex/); // NEW
    assert.match(inputByLabel(graph.container, "Emitter spacing in").parentNode.getAttribute("style") || "", /display:\s*none/); // NEW
    assert.match(selectByLabel(graph.container, "Emitter/device part").parentNode.getAttribute("style") || "", /display:\s*none/); // CHANGE
    assert.equal(inputByLabel(graph.container, "Emitter spacing in").disabled, true); // CHANGE
    changeSelectByLabel(graph.container, "Row takeoff part", "barb_tee_1_2"); // CHANGE
    changeSelectByLabel(graph.container, "Row end cap", "end_cap_1_2_barb"); // CHANGE
    changeSelectByLabel(graph.container, "Header end cap", "end_cap_1_2_barb");
    assert.equal(selectByLabel(graph.container, "Outlet part").value, "");
    assert.match(selectByLabel(graph.container, "Outlet part").parentNode.getAttribute("style") || "", /display:\s*none/);
    let template = api.__test.readBedAssemblyTemplateRecord(moduleCell, bedAssembly.assembly);
    assert.equal(template.headerEndCapPartId, "end_cap_1_2_barb");
    assert.equal(template.outletPartId, "");
    changeSelectByLabel(graph.container, "Header end cap", "");
    assert.match(selectByLabel(graph.container, "Header end cap").parentNode.getAttribute("style") || "", /display:\s*flex/);
    assert.match(selectByLabel(graph.container, "Outlet part").parentNode.getAttribute("style") || "", /display:\s*flex/);
    changeSelectByLabel(graph.container, "Outlet part", "half_barb_to_3_4_barb");
    assert.equal(selectByLabel(graph.container, "Header end cap").value, "");
    assert.match(selectByLabel(graph.container, "Header end cap").parentNode.getAttribute("style") || "", /display:\s*none/);
    template = api.__test.readBedAssemblyTemplateRecord(moduleCell, bedAssembly.assembly);
    assert.equal(template.headerEndCapPartId, "");
    assert.equal(template.outletPartId, "half_barb_to_3_4_barb");
    assert.equal(querySelectByLabel(graph.container, "Template"), null); // CHANGE
});

test("legacy bed terminal choices prefer outlet and clear header on next commit", () => {
    const { api, graph, moduleCell, bed } = loadPlugin();
    api.writeCatalog(moduleCell, addDripTapeBomParts(sampleCatalog()));
    const bedAssembly = api.__test.createBedAssembly(moduleCell, bed, { x: 240, y: 120 }).assembly;
    const legacyTemplate = { templateModel: "bom", recipeVersion: 1, templateId: "drip_tape_bed", irrigationType: "drip_tape", inletPartId: "fpt_to_half_barb", outletPartId: "half_barb_to_3_4_barb", rowPartId: "drip_tape_8mil_12in", emitterPartId: "", rowTakeoffPartId: "barb_tee_1_2", rowEndCapPartId: "end_cap_1_2_barb", headerEndCapPartId: "end_cap_1_2_barb", supplyPipePartId: "poly_distribution_1_2", spacing: { rows: 2, emitterInches: 12, rowSpacingCm: 100 }, requiredParts: [], resolvedBomParts: [], partIds: ["fpt_to_half_barb", "half_barb_to_3_4_barb", "drip_tape_8mil_12in", "barb_tee_1_2", "end_cap_1_2_barb", "poly_distribution_1_2"] };
    bedAssembly.value.setAttribute(api.attrs.BED_TEMPLATE_JSON, JSON.stringify(legacyTemplate));
    api.openIrrigationMode(moduleCell, { preserveViewport: true });
    graph.setSelectionCell(bedAssembly);
    assert.equal(selectByLabel(graph.container, "Outlet part").value, "half_barb_to_3_4_barb");
    assert.equal(selectByLabel(graph.container, "Header end cap").value, "");
    assert.match(selectByLabel(graph.container, "Header end cap").parentNode.getAttribute("style") || "", /display:\s*none/);
    assert.equal(JSON.parse(bedAssembly.getAttribute(api.attrs.BED_TEMPLATE_JSON)).headerEndCapPartId, "end_cap_1_2_barb");
    const rows = inputTextByLabel(graph.container, "Rows", "3");
    blurInput(rows);
    const template = api.__test.readBedAssemblyTemplateRecord(moduleCell, bedAssembly);
    assert.equal(template.outletPartId, "half_barb_to_3_4_barb");
    assert.equal(template.headerEndCapPartId, "");
    assert.equal(template.irrigationType, "drip_tape"); // NEW
    assert.equal(bedAssembly.getAttribute("label"), "Drip tape 12 in"); // NEW
});

test("overhead sprinkler bed recipe resolves precise BOM roles", () => {
    const { api } = loadPlugin();
    const catalog = addDripTapeBomParts(sampleCatalog());
    catalog.items.push(part("overhead_sprinkler_head_30psi", "Overhead sprinkler head", "sprinkler", "in_stock", 14, 1, 1, "barb", "1/2", "barb", "1/2", { flowGpm: 2.5, operatingPressurePsi: 30 }, undefined, true));
    const bom = api.__test.computeBedTemplateBom(catalog, { width: 306, height: 178 }, "overhead_sprinkler_block", 3, "width", { inletPartId: "fpt_to_half_barb", rowPartId: "poly_distribution_1_2", emitterPartId: "overhead_sprinkler_head_30psi", rowTakeoffPartId: "barb_tee_1_2", rowEndCapPartId: "end_cap_1_2_barb", headerEndCapPartId: "end_cap_1_2_barb", emitterSpacingIn: 12 });
    const byRole = Object.fromEntries(bom.recipe.resolvedBomParts.map(entry => [entry.role, entry]));
    assert.equal(byRole.inlet.partId, "fpt_to_half_barb");
    assert.equal(byRole.supply_pipe.partId, "poly_distribution_1_2");
    assert.equal(byRole.row_line.partId, "poly_distribution_1_2");
    assert.equal(byRole.row_takeoff.quantity, 3);
    assert.equal(byRole.row_end_cap.quantity, 3);
    assert.equal(byRole.header_end_cap.quantity, 1);
    assert.equal(byRole.emitter_device.partId, "overhead_sprinkler_head_30psi");
    assert.equal(byRole.emitter_device.quantity, 36);
});

test("moved bed supply line persists while BOM length remains formula based", () => {
    const harness = loadPlugin();
    const { api, moduleCell, bed } = harness;
    const assembly = createCommittedDripTapeBedAssembly(harness, bed);
    const beforeTemplate = api.__test.readBedAssemblyTemplateRecord(moduleCell, assembly);
    const beforeSupply = bedSupplyLines(assembly, api)[0];
    assert.ok(beforeSupply, "Missing generated supply line");
    const beforeSupplyMeters = beforeTemplate.resolvedBomParts.find(entry => entry.role === "supply_pipe").quantity;
    beforeSupply.geometry = Object.assign({}, beforeSupply.geometry, { x: beforeSupply.geometry.x + 24 });
    api.__test.commitBedTemplate(moduleCell, beforeTemplate.pathId, assembly, beforeTemplate);
    const afterTemplate = api.__test.readBedAssemblyTemplateRecord(moduleCell, assembly);
    const afterSupply = bedSupplyLines(assembly, api)[0];
    assert.equal(afterSupply.geometry.x, beforeSupply.geometry.x);
    assert.equal(afterTemplate.resolvedBomParts.find(entry => entry.role === "supply_pipe").quantity, beforeSupplyMeters);
});

test("bed assembly Exit closes before recipe field blur can rerender overlays", () => {
    const { api, graph, moduleCell, bed } = loadPlugin();
    api.writeCatalog(moduleCell, addDripTapeBomParts(sampleCatalog()));
    const bedAssembly = api.__test.createBedAssembly(moduleCell, bed, { x: 240, y: 120 });
    api.openIrrigationMode(moduleCell, { preserveViewport: true });
    graph.setSelectionCell(bedAssembly.assembly);
    const rows = inputTextByLabel(graph.container, "Rows", "3");
    assert.ok(graph.container.querySelector(".trellis-irrigation-mode-hud"));
    const exit = Array.from(graph.container.querySelectorAll("button")).find(node => node.textContent.trim() === "Exit");
    assert.ok(exit, "Missing Exit button");
    dispatchDomEvent(exit, "pointerdown");
    blurInput(rows);
    assert.equal(api.isIrrigationModeActive(), false);
    assertNoActiveIrrigationOverlays(graph.container);
});

test("bed assembly port-only HUD hides Exit and clears on graph selection without add-part UI", () => {
    const { api, graph, moduleCell, bed } = loadPlugin();
    api.writeCatalog(moduleCell, addDripTapeBomParts(sampleCatalog()));
    const bedAssembly = api.__test.createBedAssembly(moduleCell, bed, { x: 240, y: 120 });
    api.openIrrigationMode(moduleCell, { preserveViewport: true });
    graph.setSelectionCell(bedAssembly.assembly);
    clickPort(graph.container, /Inlet 1 free/);
    assert.equal(graph.container.querySelector(".trellis-irrigation-add-part-picker"), null);
    assert.ok(portBadgesInState(graph.container, "selected").length >= 1);
    const exit = Array.from(graph.container.querySelectorAll("button")).find(node => node.textContent.trim() === "Exit");
    assert.equal(exit, undefined);
    graph.setSelectionCell(bedAssembly.assembly);
    assert.equal(api.isIrrigationModeActive(), true);
    assert.equal(graph.container.querySelector(".trellis-irrigation-port-only-hud"), null);
    assert.ok(graph.container.querySelector(".trellis-irrigation-local-hud"));
    assert.equal(graph.container.querySelector(".trellis-irrigation-add-part-picker"), null);
});

test("bed template auto-apply blocks missing required parts and rejects one-sided boundary parts", () => {
    const { api, graph, moduleCell, bed } = loadPlugin();
    api.writeCatalog(moduleCell, sampleCatalog());
    const bedAssembly = api.__test.createBedAssembly(moduleCell, bed, { x: 240, y: 120 });
    api.openIrrigationMode(moduleCell, { preserveViewport: true });
    graph.setSelectionCell(bedAssembly.assembly);
    const rowInput = inputTextByLabel(graph.container, "Rows", "3");
    blurInput(rowInput);
    assert.equal(bed.getAttribute(api.attrs.BED_TEMPLATE_JSON), null);
    assert.match(graph.container.textContent, /required .*missing.*drip_tape_8mil_12in|Missing required parts: drip_tape_8mil_12in/i);

    const catalog = addDripTapeBomParts(sampleCatalog());
    const anchor = catalog.items.find(item => item.id === "drip_tape_8mil_12in");
    assert.equal(api.__test.boundaryMatchForAnchor(catalog.items.find(item => item.id === "half_barb_plug"), anchor), null);
    assert.equal(api.__test.boundaryMatchForAnchor(catalog.items.find(item => item.id === "fpt_to_half_barb"), anchor).externalConnector.type, "fpt");
    assert.equal(api.__test.boundaryMatchForAnchor(catalog.items.find(item => item.id === "half_barb_to_3_4_barb"), anchor).externalConnector.nominalSize, "3/4");
});

test("invalid bed template auto-apply preserves the previous saved layout", () => {
    const { api, graph, moduleCell, bed } = loadPlugin();
    api.writeCatalog(moduleCell, addDripTapeBomParts(sampleCatalog()));
    const bedAssembly = api.__test.createBedAssembly(moduleCell, bed, { x: 240, y: 120 });
    api.openIrrigationMode(moduleCell, { preserveViewport: true });
    graph.setSelectionCell(bedAssembly.assembly);
    changeSelectByLabel(graph.container, "Inlet part", "fpt_to_half_barb");
    changeSelectByLabel(graph.container, "Row part", "drip_tape_8mil_12in"); // CHANGE
    changeSelectByLabel(graph.container, "Row takeoff part", "barb_tee_1_2"); // CHANGE
    changeSelectByLabel(graph.container, "Row end cap", "end_cap_1_2_barb"); // CHANGE
    changeSelectByLabel(graph.container, "Header end cap", "end_cap_1_2_barb");
    assert.equal(api.__test.readBedAssemblyTemplateRecord(moduleCell, bedAssembly.assembly).spacing.rows, 2);
    assert.equal(bedLayoutRows(bedAssembly.assembly, api).length, 2);
    api.writeCatalog(moduleCell, sampleCatalog());
    graph.setSelectionCell(bedAssembly.assembly);
    const rowInput = inputTextByLabel(graph.container, "Rows", "4");
    blurInput(rowInput);
    assert.match(graph.container.textContent, /required .*missing.*drip_tape_8mil_12in|Missing required parts: drip_tape_8mil_12in/i);
    assert.equal(api.__test.readBedAssemblyTemplateRecord(moduleCell, bedAssembly.assembly).spacing.rows, 2);
    assert.equal(bedLayoutRows(bedAssembly.assembly, api).length, 2);
});

test("irrigation mode rendering does not write derived zone or path state", () => {
    const { api, graph, model, moduleCell, bed } = loadPlugin();
    api.writeCatalog(moduleCell, sampleCatalog());
    const source = api.__test.createSourceAssembly(moduleCell, "Well", { connectorType: "barb", nominalSize: "1/2", pipeConnection: true, usableFlowGpm: 5, staticPressurePsi: 45 }, { x: 30, y: 40 });
    const bedAssembly = api.__test.createBedAssembly(moduleCell, bed, { x: 30, y: 220 });
    assert.equal(api.__test.createAssemblyConnection(moduleCell, { cellId: api.__test.firstAssemblyPart(source.assembly).getId(), role: "output", index: 0 }, { cellId: bedAssembly.assembly.getId(), role: "input", index: 0 }).ok, true);
    const writesBeforeOpen = model.valuesWritten;
    api.openIrrigationMode(moduleCell, { preserveViewport: true });
    graph.setSelectionCell(bedAssembly.assembly);
    graph.view.fire("scale");
    assert.equal(model.valuesWritten, writesBeforeOpen);
    assert.equal(moduleCell.getAttribute(api.attrs.PATHS_JSON), null);
    assert.equal(moduleCell.getAttribute(api.attrs.ZONES_JSON), null);
});

test("opening zone manager is read-only", () => {
    const { api, graph, model, moduleCell, ui, bed } = loadPlugin();
    api.writeCatalog(moduleCell, sampleCatalog());
    const bedAssembly = api.__test.createBedAssembly(moduleCell, bed, { x: 240, y: 120 });
    api.openIrrigationMode(moduleCell, { preserveViewport: true });
    graph.setSelectionCell(bedAssembly.assembly);
    const writesBeforeOpen = model.valuesWritten;
    model.completedEdits = [];
    clickButton(graph.container, "Edit Zones");
    assert.ok(ui.lastDialog);
    assert.match(ui.lastDialog.textContent, /New Manual Zone/);
    assert.equal(model.valuesWritten, writesBeforeOpen);
    assert.equal(model.completedEdits.length, 0);
});

test("explicit report sync writes stable summaries but not the legacy path cache", () => {
    const { api, model, moduleCell, bed } = loadPlugin();
    api.writeCatalog(moduleCell, sampleCatalog());
    const source = api.__test.createSourceAssembly(moduleCell, "Well", { connectorType: "barb", nominalSize: "1/2", pipeConnection: true, usableFlowGpm: 5, staticPressurePsi: 45 }, { x: 30, y: 40 });
    const bedAssembly = api.__test.createBedAssembly(moduleCell, bed, { x: 30, y: 220 });
    api.__test.commitBedTemplate(moduleCell, "bed_one", bed, { templateId: "drip_tape_bed" });
    assert.equal(api.__test.createAssemblyConnection(moduleCell, { cellId: api.__test.firstAssemblyPart(source.assembly).getId(), role: "output", index: 0 }, { cellId: bedAssembly.assembly.getId(), role: "input", index: 0 }).ok, true);
    const paths = api.__test.syncHudGraphState(moduleCell);
    assert.equal(paths.length, 1);
    assert.ok(moduleCell.getAttribute(api.attrs.REPORT_JSON));
    assert.ok(moduleCell.getAttribute(api.attrs.DASHBOARD_JSON));
    assert.equal(JSON.parse(moduleCell.getAttribute(api.attrs.REPORT_JSON)).summary.generatedAt, undefined);
    const writesAfterFirstSync = model.valuesWritten;
    api.__test.syncHudGraphState(moduleCell);
    assert.equal(model.valuesWritten, writesAfterFirstSync);
    assert.equal(moduleCell.getAttribute(api.attrs.PATHS_JSON), null);
});

test("internal architecture facades expose domain seams without changing public contracts", () => {
    const { api, moduleCell } = loadPlugin();
    assert.equal(api.readCatalog, api.__test.IrrigationCatalog.read);
    assert.equal(api.generateReport, api.__test.ReportModel.generate);
    assert.equal(api.openIrrigationMode, api.__test.HudController.open);
    assert.equal(api.zoneSummary, api.__test.ZoneModel.summary);
    assert.equal(api.assignBedsToZone, api.__test.ZoneModel.assignBeds);
    assert.equal(api.__test.deriveAssemblyPaths, api.__test.ReportModel.deriveAssemblyPaths);
    assert.equal(api.__test.createAssemblyConnection, api.__test.ConnectorRules.createAssemblyConnection);
    assert.equal(api.__test.validatePortConnection, api.__test.ConnectorRules.validatePortConnection);
    assert.equal(api.__test.connectionDecisionForPorts, api.__test.ConnectorRules.connectionDecision);
    assert.equal(api.__test.autoPipePartIdForConnection, api.__test.ConnectorRules.autoPipePartIdForConnection);
    assert.equal(api.__test.calculatePathHydraulics, api.__test.Hydraulics.calculatePath);
    assert.equal(api.__test.validateSharedCapacity, api.__test.Hydraulics.validateSharedCapacity);
    moduleCell.value.setAttribute(api.attrs.CATALOG_JSON, "{bad json");
    assert.deepEqual(api.__test.GraphStore.readJsonAttr(moduleCell, api.attrs.CATALOG_JSON, { items: [] }), { items: [] });
    const normalized = api.__test.IrrigationCatalog.normalizePart(part("filter", "Filter", "filter", "in_stock", 10, 1, 1, "barb", "3/4", "barb", "3/4", { pressureLossPsi: 1 }, undefined, true));
    assert.equal(api.__test.IrrigationCatalog.validatePart(normalized).ok, true);
    assert.equal(api.__test.ConnectorRules.connectorMatches({ type: "mght", nominalSize: "3/4" }, { type: "fght", nominalSize: "3/4" }).ok, true);
    assert.equal(api.__test.Hydraulics.estimatePath({ catalog: { items: [] }, sourceProfile: { usableFlowGpm: 1, staticPressurePsi: 30 }, bedDemand: { flowGpm: 1, operatingPressurePsi: 10 } }).ok, true);
    assert.equal(api.__test.ZoneModel.normalize({ id: "z", originType: "manual" }).id, "z");
});

test("ZoneModel preserves inferred zones, manual overrides, ambiguous beds, and unzoned beds", () => {
    const { api, moduleCell, bed, bed2 } = loadPlugin();
    const catalog = sampleCatalog();
    catalog.items.push(part("timer_two", "Two Zone Timer", "controller_timer", "in_stock", 40, 1, 2, "barb", "1/2", "barb", "1/2", { maxFlowGpm: 3 }, undefined, true));
    api.writeCatalog(moduleCell, catalog);
    const timer = api.__test.createPartAssembly(moduleCell, catalog.items.find(item => item.id === "timer_two"), { x: 30, y: 40 });
    const bedOne = api.__test.createBedAssembly(moduleCell, bed, { x: 30, y: 180 });
    const bedTwo = api.__test.createBedAssembly(moduleCell, bed2, { x: 30, y: 320 });
    assert.equal(api.__test.ConnectorRules.createAssemblyConnection(moduleCell, { cellId: api.__test.firstAssemblyPart(timer.assembly).getId(), role: "output", index: 0 }, { cellId: bedOne.assembly.getId(), role: "input", index: 0 }).ok, true);
    const zones = api.__test.ZoneModel.sync(moduleCell);
    assert.equal(zones.length, 2);
    assert.equal(JSON.stringify(zones[0].inferredBedIds), JSON.stringify([bedOne.assembly.getId()]));
    const summary = api.__test.ZoneModel.summary(moduleCell, zones, []);
    assert.equal(summary.emptyZoneCount, 1);
    assert.equal(JSON.stringify(summary.unzonedBedIds), JSON.stringify([bedTwo.assembly.getId()]));
    const manual = api.__test.ZoneModel.createManual(moduleCell, "North", [bedTwo.assembly.getId()]);
    assert.equal(api.__test.ZoneModel.resolveMembership(moduleCell, api.__test.ZoneModel.read(moduleCell)).assignment.get(bedTwo.assembly.getId()).zoneId, manual.id);
    api.__test.ZoneModel.resetBedOverrides(moduleCell, [bedTwo.assembly.getId()]);
    assert.equal(api.__test.ZoneModel.resolveMembership(moduleCell, api.__test.ZoneModel.read(moduleCell)).assignment.has(bedTwo.assembly.getId()), false);
    const ambiguous = api.__test.ZoneModel.resolveMembership(moduleCell, [
        api.__test.ZoneModel.normalize({ id: "zone_a", inferredBedIds: [bedOne.assembly.getId()] }),
        api.__test.ZoneModel.normalize({ id: "zone_b", inferredBedIds: [bedOne.assembly.getId()] })
    ]);
    assert.equal(JSON.stringify(ambiguous.ambiguousBedIds), JSON.stringify([bedOne.assembly.getId()]));
    assert.equal(ambiguous.assignment.has(bedOne.assembly.getId()), false);
});

test("report model builds summaries before explicit persistence", () => {
    const { api, model, moduleCell, bed } = loadPlugin();
    api.writeCatalog(moduleCell, sampleCatalog());
    const source = api.__test.createSourceAssembly(moduleCell, "Well", { connectorType: "barb", nominalSize: "1/2", pipeConnection: true, usableFlowGpm: 5, staticPressurePsi: 45 }, { x: 30, y: 40 });
    const bedAssembly = api.__test.createBedAssembly(moduleCell, bed, { x: 30, y: 220 });
    api.__test.commitBedTemplate(moduleCell, "bed_one", bed, { templateId: "drip_tape_bed" });
    assert.equal(api.__test.createAssemblyConnection(moduleCell, { cellId: api.__test.firstAssemblyPart(source.assembly).getId(), role: "output", index: 0 }, { cellId: bedAssembly.assembly.getId(), role: "input", index: 0 }).ok, true);
    const writesBeforeBuild = model.valuesWritten;
    const paths = api.__test.deriveAssemblyPaths(moduleCell);
    const summary = api.__test.ReportModel.buildSummary(moduleCell, { paths });
    assert.equal(model.valuesWritten, writesBeforeBuild);
    assert.equal(moduleCell.getAttribute(api.attrs.REPORT_JSON), null);
    assert.ok(summary.percentIrrigated > 0);
    const writesBeforePersist = model.valuesWritten;
    api.__test.ReportModel.persistSummary(moduleCell, summary);
    assert.equal(model.valuesWritten, writesBeforePersist + 2);
    assert.ok(moduleCell.getAttribute(api.attrs.REPORT_JSON));
    assert.ok(moduleCell.getAttribute(api.attrs.DASHBOARD_JSON));
    assert.equal(moduleCell.getAttribute(api.attrs.PATHS_JSON), null);
    assert.equal(moduleCell.getAttribute(api.attrs.ZONES_JSON), null);
});

test("irrigation part lifecycle defaults legacy BOM parts to planned", () => {
    const { api, moduleCell, filterPart, bedAssembly, pipeEdges } = createLifecycleBomFixture();
    filterPart.value.removeAttribute(api.attrs.PART_STATE);
    pipeEdges[0].value.removeAttribute(api.attrs.PART_STATE);
    const template = api.__test.readBedAssemblyTemplateRecord(moduleCell, bedAssembly);
    delete template.partState;
    bedAssembly.value.setAttribute(api.attrs.BED_TEMPLATE_JSON, JSON.stringify(template));
    const rows = api.__test.buildBomRows(moduleCell);
    assert.equal(api.__test.partStateForCell(filterPart), api.__test.partStates.planned);
    assert.ok(rows.rows.some(row => row.partId === "filter_half_lifecycle"));
    assert.ok(rows.rows.some(row => row.partId === "drip_tape_8mil_12in"));
    assert.ok(rows.rows.some(row => row.partId === "poly_distribution_1_2"));
    assert.equal(rows.completedRows.length, 0);
});

test("completed irrigation parts move to completed BOM rows and preserve total design value", () => {
    const { api, moduleCell, filterPart, bedAssembly, pipeEdges } = createLifecycleBomFixture();
    api.__test.setPartCellState(filterPart, api.__test.partStates.completed);
    api.__test.setPipeEdgeState(pipeEdges[0], api.__test.partStates.completed);
    api.__test.setBedTemplatePartState(moduleCell, bedAssembly, api.__test.partStates.completed);
    const rows = api.__test.buildBomRows(moduleCell);
    assert.equal(rows.rows.some(row => row.partId === "filter_half_lifecycle"), false);
    assert.equal(rows.rows.some(row => row.partId === "drip_tape_8mil_12in"), false);
    assert.ok(rows.rows.some(row => row.partId === "poly_distribution_1_2"), "The uncompleted pipe edge should remain planned.");
    assert.ok(rows.completedRows.some(row => row.partId === "filter_half_lifecycle"));
    assert.ok(rows.completedRows.some(row => row.partId === "drip_tape_8mil_12in"));
    assert.ok(rows.completedRows.some(row => row.partId === "poly_distribution_1_2"));
    const summary = api.__test.ReportModel.buildSummary(moduleCell, { paths: api.__test.deriveAssemblyPaths(moduleCell) });
    assert.equal(summary.purchaseNeededCount, rows.rows.filter(row => row.shortageQuantity > 0).length);
    assert.equal(summary.completedPartCount, rows.completedRows.length);
    assert.ok(summary.completedDesignValue > 0);
    assert.equal(summary.totalDesignValue, summary.plannedDesignValue + summary.completedDesignValue);
    assert.equal(summary.completedParts.some(row => row.partId === "filter_half_lifecycle"), true);
});

test("HUD lifecycle actions mark selected assemblies completed and planned", () => {
    const { api, graph, moduleCell } = loadPlugin();
    api.writeCatalog(moduleCell, sampleCatalog());
    const assembly = api.__test.createPartAssembly(moduleCell, api.readCatalog(moduleCell).items.find(item => item.id === "filter"), { x: 30, y: 40 }).assembly;
    const partCell = api.__test.firstAssemblyPart(assembly);
    api.openIrrigationMode(moduleCell, { preserveViewport: true });
    graph.setSelectionCell(assembly);
    assert.deepEqual(buttonTexts(lifecycleToggle(graph.container)), ["Planned", "Completed"]);
    assert.equal(lifecycleToggle(graph.container).querySelector('[aria-pressed="true"]').textContent, "Planned");
    clickButton(lifecycleToggle(graph.container), "Completed");
    assert.equal(partCell.getAttribute(api.attrs.PART_STATE), api.__test.partStates.completed);
    assert.equal(styleToken(partCell.style, "fillColor"), "#e8f5e9");
    assert.equal(styleToken(assembly.style, "fillColor"), "#e8f5e9");
    assert.equal(lifecycleToggle(graph.container).querySelector('[aria-pressed="true"]').textContent, "Completed");
    clickButton(lifecycleToggle(graph.container), "Planned");
    assert.equal(partCell.getAttribute(api.attrs.PART_STATE), api.__test.partStates.planned);
    assert.equal(styleToken(partCell.style, "fillColor"), "#ffffff");
    assert.equal(styleToken(assembly.style, "fillColor"), "#ffffff");
});

test("HUD lifecycle actions mark standalone branchpoint catalog endpoints completed", () => {
    const { api, graph, moduleCell, branchpoint } = createLifecycleBranchpointFixture();
    api.openIrrigationMode(moduleCell, { preserveViewport: true });
    graph.setSelectionCell(branchpoint);
    clickButton(lifecycleToggle(graph.container), "Completed");
    assert.equal(branchpoint.getAttribute(api.attrs.PART_STATE), api.__test.partStates.completed);
    assert.equal(styleToken(branchpoint.style, "fillColor"), "#e8f5e9");
    const rows = api.__test.buildBomRows(moduleCell);
    assert.equal(rows.rows.some(row => row.partId === "branch_filter_lifecycle"), false);
    assert.equal(rows.completedRows.some(row => row.partId === "branch_filter_lifecycle"), true);
});

test("HUD lifecycle actions show both directions for mixed selections", () => {
    const { api, graph, moduleCell } = loadPlugin();
    api.writeCatalog(moduleCell, sampleCatalog());
    const planned = api.__test.createPartAssembly(moduleCell, api.readCatalog(moduleCell).items.find(item => item.id === "filter"), { x: 30, y: 40 }).assembly;
    const completed = api.__test.createPartAssembly(moduleCell, api.readCatalog(moduleCell).items.find(item => item.id === "regulator"), { x: 220, y: 40 }).assembly;
    api.__test.setPartCellState(api.__test.firstAssemblyPart(completed), api.__test.partStates.completed);
    api.openIrrigationMode(moduleCell, { preserveViewport: true });
    graph.setSelectionCells([planned, completed]);
    assert.deepEqual(buttonTexts(lifecycleToggle(graph.container)), ["Planned", "Completed"]);
    assert.equal(lifecycleToggle(graph.container).querySelectorAll('[aria-pressed="true"]').length, 0);
});

test("HUD lifecycle actions mark selected pipe edges completed", () => {
    const { api, graph, moduleCell, pipeEdges } = createLifecycleBomFixture();
    api.__test.setPipeEdgeState(pipeEdges[1], api.__test.partStates.completed);
    api.openIrrigationMode(moduleCell, { preserveViewport: true });
    graph.setSelectionCell(pipeEdges[0]);
    clickButton(lifecycleToggle(graph.container), "Completed");
    assert.equal(pipeEdges[0].getAttribute(api.attrs.PART_STATE), api.__test.partStates.completed);
    assert.equal(styleToken(pipeEdges[0].style, "strokeColor"), "#82b366");
    assert.equal(styleToken(pipeEdges[0].style, "dashed"), "1");
    const rows = api.__test.buildBomRows(moduleCell);
    assert.equal(rows.rows.some(row => row.partId === "poly_distribution_1_2"), false);
    assert.equal(rows.completedRows.some(row => row.partId === "poly_distribution_1_2"), true);
});

test("HUD lifecycle actions mark selected bed assemblies completed and refresh reports", () => {
    const { api, graph, moduleCell, bedAssembly } = createLifecycleBomFixture();
    api.openIrrigationMode(moduleCell, { preserveViewport: true });
    graph.setSelectionCell(bedAssembly);
    clickButton(lifecycleToggle(graph.container), "Completed");
    const template = api.__test.readBedAssemblyTemplateRecord(moduleCell, bedAssembly);
    assert.equal(template.partState, api.__test.partStates.completed);
    const layoutRows = bedLayoutRows(bedAssembly, api);
    assert.ok(layoutRows.length > 0);
    assert.equal(layoutRows.every(row => row.getAttribute(api.attrs.PART_STATE) === api.__test.partStates.completed), true);
    assert.equal(layoutRows.every(row => styleToken(row.style, "fillColor") === "#e8f5e9"), true);
    const rows = api.__test.buildBomRows(moduleCell);
    assert.equal(rows.rows.some(row => row.partId === "drip_tape_8mil_12in"), false);
    assert.equal(rows.completedRows.some(row => row.partId === "drip_tape_8mil_12in"), true);
    const summary = api.readDashboardSummary(moduleCell);
    assert.equal(summary.completedParts.some(row => row.partId === "drip_tape_8mil_12in"), true);
});

test("multi-pipe assembly hydraulics sum per-segment pipe losses", () => {
    const { api, moduleCell, bed } = loadPlugin();
    const catalog = sampleCatalog();
    catalog.items.push(part("reducer_3_4_to_1_2", "Reducer", "fitting", "in_stock", 4, 1, 1, "barb", "3/4", "barb", "1/2", { pressureLossPsi: 0.3 }, undefined, true));
    api.writeCatalog(moduleCell, catalog);
    const source = api.__test.createSourceAssembly(moduleCell, "Well", { connectorType: "barb", nominalSize: "3/4", pipeConnection: true, usableFlowGpm: 5, staticPressurePsi: 45 }, { x: 30, y: 40 });
    const filter = api.__test.createPartAssembly(moduleCell, catalog.items.find(item => item.id === "filter"), { x: 30, y: 160 });
    const reducer = api.__test.createPartAssembly(moduleCell, catalog.items.find(item => item.id === "reducer_3_4_to_1_2"), { x: 30, y: 280 });
    const bedAssembly = api.__test.createBedAssembly(moduleCell, bed, { x: 30, y: 400 });
    api.__test.commitBedTemplate(moduleCell, "bed_one", bed, { templateId: "drip_tape_bed" });
    assert.equal(api.__test.createAssemblyConnection(moduleCell, { cellId: api.__test.firstAssemblyPart(source.assembly).getId(), role: "output", index: 0 }, { cellId: api.__test.firstAssemblyPart(filter.assembly).getId(), role: "input", index: 0 }).ok, true);
    assert.equal(api.__test.createAssemblyConnection(moduleCell, { cellId: api.__test.firstAssemblyPart(filter.assembly).getId(), role: "output", index: 0 }, { cellId: api.__test.firstAssemblyPart(reducer.assembly).getId(), role: "input", index: 0 }).ok, true);
    assert.equal(api.__test.createAssemblyConnection(moduleCell, { cellId: api.__test.firstAssemblyPart(reducer.assembly).getId(), role: "output", index: 0 }, { cellId: bedAssembly.assembly.getId(), role: "input", index: 0 }).ok, true);
    const edges = api.__test.collectAssemblyEdges(moduleCell);
    edges.forEach(edge => setMeasuredEdgeLength(edge, edge.getAttribute(api.attrs.PIPE_PART_ID) === "pipe_half" ? 25 : 40));
    const pathRecord = api.__test.syncHudGraphState(moduleCell)[0];
    const calculated = api.__test.Hydraulics.calculatePath(moduleCell, pathRecord);
    const segments = api.__test.Hydraulics.pipeSegmentsForPath(moduleCell, pathRecord);
    const expectedPipeLoss = pathRecord.pipeSegments.reduce((sum, segment) => {
        const pipe = catalog.items.find(item => item.id === segment.pipePartId);
        return sum + api.__test.hazenWilliamsPsiLoss({ lengthFt: segment.lengthFt, flowGpm: pathRecord.hydraulic.flowGpm, diameterIn: pipe.specs.innerDiameterIn, c: pipe.specs.hazenWilliamsC });
    }, 0);
    assert.equal(pathRecord.pipeSegments.length, 3);
    assert.equal(segments.length, 3);
    assert.ok(pathRecord.pipeSegments.some(segment => segment.pipePartId === "pipe_half"));
    assert.equal(calculated.flowGpm, pathRecord.hydraulic.flowGpm);
    assert.ok(Math.abs(calculated.pressureLossPsi - pathRecord.hydraulic.pressureLossPsi) < 0.0001);
    assert.ok(Math.abs(pathRecord.hydraulic.pressureLossPsi - (expectedPipeLoss + 2 + 0.3)) < 0.0001);
});

test("missing pipe edge geometry blocks hydraulic completeness", () => {
    const { api, moduleCell, bed } = loadPlugin();
    api.writeCatalog(moduleCell, sampleCatalog());
    const source = api.__test.createSourceAssembly(moduleCell, "Well", { connectorType: "barb", nominalSize: "1/2", pipeConnection: true, usableFlowGpm: 5, staticPressurePsi: 45 }, { x: 30, y: 40 });
    const bedAssembly = api.__test.createBedAssembly(moduleCell, bed, { x: 30, y: 220 });
    api.__test.commitBedTemplate(moduleCell, "bed_one", bed, { templateId: "drip_tape_bed" });
    assert.equal(api.__test.createAssemblyConnection(moduleCell, { cellId: api.__test.firstAssemblyPart(source.assembly).getId(), role: "output", index: 0 }, { cellId: bedAssembly.assembly.getId(), role: "input", index: 0 }).ok, true);
    const pathRecord = api.__test.syncHudGraphState(moduleCell)[0];
    const summary = JSON.parse(moduleCell.getAttribute(api.attrs.REPORT_JSON)).summary;
    assert.equal(pathRecord.hydraulic.ok, false);
    assert.ok(pathRecord.hydraulic.warnings.includes("Pipe edge length is missing; pressure loss was not estimated."));
    assert.equal(Math.round(summary.completeness), 0);
    assert.ok(summary.criticalWarnings.includes("Pipe edge length is missing; pressure loss was not estimated."));
});

test("daisy-chained bed assemblies use cumulative downstream demand", () => {
    const { api, moduleCell, bed, bed2 } = loadPlugin();
    api.writeCatalog(moduleCell, sampleCatalog());
    const source = api.__test.createSourceAssembly(moduleCell, "Half inch source", { connectorType: "barb", nominalSize: "1/2", method: "drip", pipeConnection: true, usableFlowGpm: 5, staticPressurePsi: 45 }, { x: 30, y: 40 });
    const bedOne = api.__test.createBedAssembly(moduleCell, bed, { x: 30, y: 180 });
    const bedTwo = api.__test.createBedAssembly(moduleCell, bed2, { x: 30, y: 320 });
    api.__test.commitBedTemplate(moduleCell, "bed_one", bed, { templateId: "drip_tape_bed", spacing: { rows: 2, emitterInches: 12 } });
    api.__test.commitBedTemplate(moduleCell, "bed_two", bed2, { templateId: "drip_tape_bed", spacing: { rows: 2, emitterInches: 12 } });
    assert.equal(api.__test.createAssemblyConnection(moduleCell, { cellId: api.__test.firstAssemblyPart(source.assembly).getId(), role: "output", index: 0 }, { cellId: bedOne.assembly.getId(), role: "input", index: 0 }).ok, true);
    assert.equal(api.__test.createAssemblyConnection(moduleCell, { cellId: bedOne.assembly.getId(), role: "output", index: 0 }, { cellId: bedTwo.assembly.getId(), role: "input", index: 0 }).ok, true);
    const paths = api.__test.syncHudGraphState(moduleCell);
    const pathOne = paths.find(path => path.targetBedId === bed.getId());
    const pathTwo = paths.find(path => path.targetBedId === bed2.getId());
    assert.equal(pathOne.hydraulic.flowGpm, 1); // CHANGE
    assert.equal(pathTwo.hydraulic.flowGpm, 0.5); // CHANGE
});

test("public API is mode-focused while legacy path helpers remain isolated under __test", () => {
    const { api } = loadPlugin();
    ["openIrrigationMode", "closeIrrigationMode", "openCatalogManager", "generateReport", "readDashboardSummary"].forEach(name => assert.equal(typeof api[name], "function", name));
    ["stagePath", "commitStagedPath", "commitBedTemplate", "createSourceEndpoint", "createBedEndpoint", "createBranchpointEndpoint"].forEach(name => assert.equal(api[name], undefined, name));
    ["deriveAssemblyPaths", "createAssemblyConnection", "bridgeSuggestionsForPorts"].forEach(name => assert.equal(typeof api.__test[name], "function", name));
});

test("irrigation planner registration and dashboard wiring remain present", () => {
    const appSource = fs.readFileSync(path.join(PROJECT_ROOT, "drawio/src/main/webapp/js/diagramly/App.js"), "utf8");
    const bundledSource = fs.readFileSync(path.join(PROJECT_ROOT, "drawio/src/main/webapp/js/app.min.js"), "utf8");
    const dashboardSource = fs.readFileSync(path.join(PROJECT_ROOT, "drawio/src/main/webapp/plugins/garden_planner_plugins/Garden_Dashboard.js"), "utf8");
    assert.match(appSource, /'gardenIrrigationPlanner': 'plugins\/garden_planner_plugins\/Garden_Irrigation_Planner\.js'/);
    assert.match(bundledSource, /gardenEquipment gardenIrrigationPlanner/);
    assert.match(dashboardSource, /irrigation_dashboard_summary_json/);
    assert.match(dashboardSource, /openIrrigationPlannerForDashboard/);
});
