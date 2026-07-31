const assert = require("node:assert/strict"); // NEW
const fs = require("node:fs"); // NEW
const path = require("node:path"); // NEW
const test = require("node:test"); // NEW
const vm = require("node:vm"); // NEW
const { JSDOM } = require("jsdom"); // NEW

const PROJECT_ROOT = path.join(__dirname, ".."); // NEW
const PLUGIN_PATH = path.join(PROJECT_ROOT, "drawio", "src", "main", "webapp", "plugins", "garden_planner_plugins", "Garden_Irrigation_Planner.js"); // NEW

class TestCell { // NEW
    constructor(id, value = "", geometry = null, style = "") { // NEW
        this.id = id; // NEW
        this.value = value; // NEW
        this.geometry = geometry; // NEW
        this.style = style; // NEW
        this.children = []; // NEW
    } // NEW
    getId() { return this.id; } // NEW
    getGeometry() { return this.geometry; } // NEW
    getAttribute(key) { return this.value && this.value.nodeType === 1 ? this.value.getAttribute(key) : null; } // NEW
} // NEW

class TestModel { // NEW
    constructor(root) { this.root = root; this.valuesWritten = 0; this.geometryWritten = 0; this.updateDepth = 0; this.removedCells = []; this.completedEdits = []; this.pendingChanges = 0; this.listeners = new Map(); } // CHANGE
    getRoot() { return this.root; } // NEW
    getParent(cell) { return cell && cell.parent ? cell.parent : null; } // NEW
    getChildCount(cell) { return cell && cell.children ? cell.children.length : 0; } // NEW
    getChildAt(cell, index) { return cell.children[index]; } // NEW
    getGeometry(cell) { return cell && cell.geometry; } // NEW
    setValue(cell, value) { cell.value = value; this.valuesWritten += 1; this.recordChange("value"); } // CHANGE
    setGeometry(cell, value) { cell.geometry = value; this.geometryWritten += 1; this.recordChange("geometry"); } // CHANGE
    remove(cell) { // NEW
        this.removedCells.push(cell); // NEW
        if (cell && cell.parent && cell.parent.children) cell.parent.children = cell.parent.children.filter(child => child !== cell); // NEW
        this.recordChange("remove"); // NEW
    } // NEW
    add(parent, cell, index) { // NEW
        if (!parent || !cell) return cell; // NEW
        const oldParent = this.getParent(cell); // NEW
        if (oldParent && oldParent.children) oldParent.children = oldParent.children.filter(child => child !== cell); // NEW
        cell.parent = parent; // NEW
        if (!parent.children) parent.children = []; // NEW
        if (typeof index === "number") parent.children.splice(Math.min(index, parent.children.length), 0, cell); // NEW
        else parent.children.push(cell); // NEW
        this.recordChange("add"); // NEW
        return cell; // NEW
    } // NEW
    beginUpdate() { this.updateDepth += 1; } // NEW
    endUpdate() { this.updateDepth -= 1; if (this.updateDepth === 0 && this.pendingChanges > 0) { const edit = { changes: this.pendingChanges }; this.completedEdits.push(edit); this.pendingChanges = 0; this.fire("undo", edit); } } // CHANGE
    recordChange(_kind) { if (this.updateDepth > 0) this.pendingChanges += 1; else this.completedEdits.push({ changes: 1 }); } // NEW
    addListener(event, listener) { if (!this.listeners.has(event)) this.listeners.set(event, []); this.listeners.get(event).push(listener); } // NEW
    removeListener(listener) { this.listeners.forEach(list => { const index = list.indexOf(listener); if (index >= 0) list.splice(index, 1); }); } // NEW
    fire(event, edit) { (this.listeners.get(event) || []).forEach(listener => listener(this, { getProperty(key) { return key === "edit" ? edit : null; } })); } // NEW
} // NEW

function appendChild(parent, child) { // NEW
    child.parent = parent; // NEW
    parent.children.push(child); // NEW
    return child; // NEW
} // NEW

function makeXmlCell(document, id, attrs, geometry) { // NEW
    const node = document.implementation.createDocument("", "", null).createElement("object"); // NEW
    Object.entries(attrs || {}).forEach(([key, value]) => node.setAttribute(key, String(value))); // NEW
    return new TestCell(id, node, geometry || null); // NEW
} // NEW

function descendants(cell, predicate, out = []) { // NEW
    (cell.children || []).forEach(child => { // NEW
        if (!predicate || predicate(child)) out.push(child); // NEW
        descendants(child, predicate, out); // NEW
    }); // NEW
    return out; // NEW
} // NEW

function loadPlugin(options = {}) { // NEW
    const dom = new JSDOM(options.svgOverlayPane ? "<!doctype html><body><div id='graph'><svg><g id='overlay'></g></svg></div></body>" : "<!doctype html><body><div id='graph'></div></body>", { url: options.url || "https://trellis.test/" }); // CHANGE
    const document = dom.window.document; // NEW
    const consoleLogs = options.consoleLogs || []; // DIAGNOSTIC
    const root = new TestCell("root"); // NEW
    const moduleCell = appendChild(root, makeXmlCell(document, "module", { garden_module: "1", label: "Garden" }, { x: 0, y: 0, width: 720, height: 520 })); // NEW
    const bed = appendChild(moduleCell, makeXmlCell(document, "bed", { garden_bed: "1", label: "Bed 1" }, { x: 120, y: 120, width: 120, height: 60 })); // NEW
    const bed2 = appendChild(moduleCell, makeXmlCell(document, "bed2", { garden_bed: "1", label: "Bed 2" }, { x: 280, y: 120, width: 120, height: 60 })); // NEW
    const container = document.getElementById("graph"); // NEW
    const overlayPane = options.svgOverlayPane ? document.getElementById("overlay") : container; // NEW
    Object.defineProperty(container, "clientWidth", { value: options.clientWidth || 1000, configurable: true }); // NEW
    Object.defineProperty(container, "clientHeight", { value: options.clientHeight || 700, configurable: true }); // NEW
    const model = new TestModel(root); // NEW
    const undoManager = options.undoManager || { undoCalls: 0, redoCalls: 0, undo() { this.undoCalls += 1; if (this.onUndo) this.onUndo(); }, redo() { this.redoCalls += 1; if (this.onRedo) this.onRedo(); } }; // NEW
    let nextId = 1; // NEW
    const actions = new Map(); // NEW
    const selectionListeners = []; // NEW
    const graphListeners = new Map(); // NEW
    const mouseListeners = []; // NEW
    const viewListeners = new Map(); // NEW
    const graph = { // NEW
        selectionCell: options.selectedCell || moduleCell, // NEW
        selectionCells: options.selectedCells || null, // NEW
        scrolledCells: [], // NEW
        fittedWindows: [], // NEW
        scrolledRects: [], // NEW
        foldCalls: [], // NEW
        container, // NEW
        view: { // NEW
            overlayPane, // CHANGE
            scale: 1, // NEW
            translate: { x: 0, y: 0 }, // NEW
            getState(cell) { // NEW
                const absolute = absoluteGeometry(cell); // NEW
                return { x: absolute.x, y: absolute.y, width: absolute.width, height: absolute.height }; // NEW
            }, // NEW
            addListener(event, listener) { if (!viewListeners.has(event)) viewListeners.set(event, []); viewListeners.get(event).push(listener); }, // NEW
            removeListener(listener) { viewListeners.forEach(list => { const index = list.indexOf(listener); if (index >= 0) list.splice(index, 1); }); }, // NEW
            fire(event) { (viewListeners.get(event) || []).forEach(listener => listener()); } // NEW
        }, // NEW
        getModel() { return model; }, // NEW
        getDefaultParent() { return root; }, // NEW
        getSelectionCell() { return this.selectionCell; }, // NEW
        getSelectionCells() { return this.selectionCells || [this.selectionCell].filter(Boolean); }, // NEW
        setSelectionCell(cell) { this.selectionCell = cell; this.selectionCells = [cell].filter(Boolean); selectionListeners.forEach(listener => listener()); }, // NEW
        setSelectionCells(cells) { this.selectionCells = cells || []; this.selectionCell = this.selectionCells[0] || null; selectionListeners.forEach(listener => listener()); }, // NEW
        scrollCellToVisible(cell, center) { this.scrolledCells.push({ cell, center }); }, // NEW
        fitWindow(bounds, border) { this.fittedWindows.push({ bounds: Object.assign({}, bounds), border }); }, // NEW
        scrollRectToVisible(bounds) { this.scrolledRects.push(Object.assign({}, bounds)); }, // NEW
        getSelectionModel() { return { addListener(_event, listener) { selectionListeners.push(listener); }, removeListener(listener) { const index = selectionListeners.indexOf(listener); if (index >= 0) selectionListeners.splice(index, 1); } }; }, // NEW
        getView() { return this.view; }, // NEW
        addListener(event, listener) { if (!graphListeners.has(event)) graphListeners.set(event, []); graphListeners.get(event).push(listener); }, // NEW
        removeListener(listener) { graphListeners.forEach(list => { const index = list.indexOf(listener); if (index >= 0) list.splice(index, 1); }); }, // NEW
        addMouseListener(listener) { mouseListeners.push(listener); }, // NEW
        removeMouseListener(listener) { const index = mouseListeners.indexOf(listener); if (index >= 0) mouseListeners.splice(index, 1); }, // NEW
        fireClick(cell, x = 0, y = 0) { // NEW
            const event = { clientX: x, clientY: y }; // NEW
            (graphListeners.get("click") || []).forEach(listener => listener(this, { getProperty(key) { return key === "cell" ? cell : key === "event" ? event : null; } })); // NEW
        }, // NEW
        fireMouseMove(x = 0, y = 0) { // NEW
            const event = { clientX: x, clientY: y }; // NEW
            mouseListeners.forEach(listener => listener.mouseMove && listener.mouseMove(this, { getEvent() { return event; } })); // NEW
        }, // NEW
        fireCellsAdded(cells) { // NEW
            (graphListeners.get("cellsAdded") || []).forEach(listener => listener(this, { getProperty(key) { return key === "cells" ? cells : null; } })); // NEW
            (graphListeners.get("addCells") || []).forEach(listener => listener(this, { getProperty(key) { return key === "cells" ? cells : null; } })); // NEW
        }, // NEW
        fireCellsRemoved(cells) { // NEW
            (graphListeners.get("cellsRemoved") || []).forEach(listener => listener(this, { getProperty(key) { return key === "cells" ? cells : null; } })); // NEW
            (graphListeners.get("removeCells") || []).forEach(listener => listener(this, { getProperty(key) { return key === "cells" ? cells : null; } })); // NEW
        }, // NEW
        fireCellsMoved(cells, dx = 0, dy = 0) { // CHANGE
            (graphListeners.get("cellsMoved") || []).forEach(listener => listener(this, { getProperty(key) { return key === "cells" ? cells : key === "dx" ? dx : key === "dy" ? dy : null; } })); // CHANGE
        }, // NEW
        fireCellsResized(cells) { // NEW
            (graphListeners.get("cellsResized") || []).forEach(listener => listener(this, { getProperty(key) { return key === "cells" ? cells : null; } })); // NEW
        }, // NEW
        getCellAt() { return null; }, // NEW
        isValidDropTarget() { return true; }, // NEW
        moveCells(cells, dx = 0, dy = 0, _clone = false, target = null) { // NEW
            const moved = cells || []; // NEW
            moved.forEach(cell => { // NEW
                if (target) model.add(target, cell); // NEW
                if (cell && cell.geometry) cell.geometry = Object.assign({}, cell.geometry, { x: Number(cell.geometry.x || 0) + dx, y: Number(cell.geometry.y || 0) + dy }); // NEW
            }); // NEW
            this.movedCells = (this.movedCells || []).concat(moved); // NEW
            if (moved.length) this.fireCellsMoved(moved, dx, dy); // NEW
            return moved; // NEW
        }, // NEW
        updateAlternateBounds(_cell, geo) { // NEW
            if (!geo) return; // NEW
            if (!geo.alternateBounds) geo.alternateBounds = { x: 0, y: 0, width: 80, height: 30 }; // NEW
            geo.alternateBounds.x = Number(geo.x || 0); // NEW
            geo.alternateBounds.y = Number(geo.y || 0); // NEW
        }, // NEW
        isCellCollapsed(cell) { return !!(cell && cell.collapsed); }, // NEW
        foldCells(collapse, _recurse, cells) { // NEW
            this.foldCalls.push({ collapse: !!collapse, cells: cells || [] }); // NEW
            (cells || []).forEach(cell => { // NEW
                if (!cell || !cell.geometry) return; // NEW
                const geo = cloneGeometry(cell.geometry); // NEW
                this.updateAlternateBounds(cell, geo, collapse); // NEW
                const actual = { x: Number(geo.x || 0), y: Number(geo.y || 0), width: Number(geo.width || 0), height: Number(geo.height || 0) }; // NEW
                const alternate = geo.alternateBounds || actual; // NEW
                geo.x = Number(alternate.x || 0); // NEW
                geo.y = Number(alternate.y || 0); // NEW
                geo.width = Number(alternate.width || 0); // NEW
                geo.height = Number(alternate.height || 0); // NEW
                geo.alternateBounds = actual; // NEW
                model.setGeometry(cell, geo); // NEW
                cell.collapsed = !!collapse; // NEW
            }); // NEW
            return cells || []; // NEW
        }, // NEW
        __withUndoSuppressed(fn) { this.undoSuppressedCalls = (this.undoSuppressedCalls || 0) + 1; return fn(); }, // NEW
        orderCells(_back, cells) { this.orderedCells = (this.orderedCells || []).concat(cells || []); }, // NEW
        insertVertex(parent, id, label, x, y, width, height, style) { const cell = appendChild(parent, new TestCell(id || "v" + nextId++, label || "", { x, y, width, height }, style || "")); model.recordChange("insertVertex"); return cell; }, // CHANGE
        insertEdge(parent, id, label, source, target, style) { // NEW
            const edge = appendChild(parent, new TestCell(id || "e" + nextId++, label || "", { points: [] }, style || "")); // NEW
            edge.source = source; // NEW
            edge.target = target; // NEW
            model.recordChange("insertEdge"); // NEW
            return edge; // NEW
        } // NEW
    }; // NEW
    const ui = { // NEW
        editor: { graph, undoManager }, // CHANGE
        actions: { addAction(id, fn) { actions.set(id, { funct: fn }); } }, // NEW
        dialog: { bg: { style: {} }, container: { style: {} } }, // NEW
        showDialog(node) { ui.lastDialog = node; ui.hidden = false; ui.showCount = (ui.showCount || 0) + 1; }, // NEW
        hideDialog() { ui.hidden = true; ui.hideCount = (ui.hideCount || 0) + 1; }, // NEW
        alert(message) { ui.lastAlert = message; } // NEW
    }; // NEW
    const context = { // NEW
        window: dom.window, // NEW
        document, // NEW
        console: { log(...args) { consoleLogs.push(args); } }, // DIAGNOSTIC
        Date, // NEW
        setTimeout, // NEW
        clearTimeout, // NEW
        alert(message) { context.lastAlert = message; }, // NEW
        Draw: { loadPlugin(callback) { callback(ui); } }, // NEW
        mxEvent: { CHANGE: "change", CLICK: "click", CELLS_ADDED: "cellsAdded", ADD_CELLS: "addCells", CELLS_MOVED: "cellsMoved", CELLS_RESIZED: "cellsResized", CELLS_REMOVED: "cellsRemoved", REMOVE_CELLS: "removeCells", UNDO: "undo", REDO: "redo", SCALE: "scale", TRANSLATE: "translate", SCALE_AND_TRANSLATE: "scaleAndTranslate", getClientX(evt) { return evt && evt.clientX || 0; }, getClientY(evt) { return evt && evt.clientY || 0; } }, // CHANGE
        mxUtils: { // NEW
            convertPoint(_container, x, y) { return { x, y }; }, // NEW
            createXmlDocument() { return document.implementation.createDocument("", "", null); }, // NEW
            htmlEntities(value) { return String(value).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[ch])); }, // NEW
            button(label, fn) { const button = document.createElement("button"); button.textContent = label; button.addEventListener("click", fn); return button; } // NEW
        } // NEW
    }; // NEW
    vm.runInNewContext(fs.readFileSync(PLUGIN_PATH, "utf8"), context, { filename: PLUGIN_PATH }); // NEW
    return { api: graph.__trellisIrrigationPlanner, graph, model, root, moduleCell, bed, bed2, document, ui, actions, undoManager, consoleLogs }; // CHANGE
} // NEW

function absoluteGeometry(cell) { // NEW
    const geo = cell && cell.geometry || { x: 0, y: 0, width: 80, height: 30 }; // NEW
    let x = Number(geo.x || 0); // NEW
    let y = Number(geo.y || 0); // NEW
    let parent = cell && cell.parent; // NEW
    while (parent) { // NEW
        const parentGeo = parent.geometry || {}; // NEW
        x += Number(parentGeo.x || 0); // NEW
        y += Number(parentGeo.y || 0); // NEW
        parent = parent.parent; // NEW
    } // NEW
    return { x, y, width: Number(geo.width || 0), height: Number(geo.height || 0) }; // NEW
} // NEW

function cloneGeometry(geo) { // NEW
    const copy = Object.assign({}, geo || {}); // NEW
    if (geo && geo.alternateBounds) copy.alternateBounds = Object.assign({}, geo.alternateBounds); // NEW
    return copy; // NEW
} // NEW

function part(id, name, category, stockState, cost, inputs, outputs, inputType, inputSize, outputType, outputSize, specs = {}, unitCost, pipeConnection = false) { // CHANGE
    return { // NEW
        id, name, category, stockState, cost, unitCost, // NEW
        connectors: { inputs, outputs, input: { type: inputType, nominalSize: inputSize, pipeConnection }, output: { type: outputType, nominalSize: outputSize, maxFlowGpm: specs.maxFlowGpm, pipeConnection } }, // CHANGE
        specs // NEW
    }; // NEW
} // NEW

function sampleCatalog() { // NEW
    return { items: [ // NEW
        part("filter", "Filter", "filter", "in_stock", 20, 1, 1, "barb", "3/4", "barb", "3/4", { pressureLossPsi: 2 }, undefined, true), // CHANGE
        part("regulator", "Regulator", "regulator", "in_stock", 18, 1, 1, "barb", "3/4", "barb", "3/4", { pressureLossPsi: 1 }, undefined, true), // CHANGE
        part("valve", "Valve", "valve", "in_stock", 30, 1, 2, "barb", "3/4", "barb", "3/4", { pressureLossPsi: 1, maxFlowGpm: 8 }, undefined, true), // CHANGE
        part("pipe_cheap", "3/4 cheap poly", "pipe_tubing", "in_stock", 0, 1, 1, "barb", "3/4", "barb", "3/4", { innerDiameterIn: 0.824, hazenWilliamsC: 150 }, 0.25, true), // CHANGE
        part("pipe_costly", "3/4 costly poly", "pipe_tubing", "in_stock", 0, 1, 1, "barb", "3/4", "barb", "3/4", { innerDiameterIn: 0.824, hazenWilliamsC: 150 }, 0.75, true), // CHANGE
        part("pipe_half", "1/2 poly", "pipe_tubing", "in_stock", 0, 1, 1, "barb", "1/2", "barb", "1/2", { innerDiameterIn: 0.600, hazenWilliamsC: 150 }, 0.32, true), // NEW
        part("fght_to_mpt", "FGHT to MPT adapter", "fitting", "in_stock", 5, 1, 1, "fght", "3/4", "mpt", "3/4", { pressureLossPsi: 0.2 }), // CHANGE
        part("fpt_to_barb", "FPT to barb adapter", "fitting", "in_stock", 4, 1, 1, "fpt", "3/4", "barb", "3/4", { pressureLossPsi: 0.2 }, undefined, true), // CHANGE
        part("fght_to_barb_backorder", "FGHT to barb direct adapter", "fitting", "out_of_stock", 9, 1, 1, "fght", "3/4", "barb", "3/4", { pressureLossPsi: 0.2 }, undefined, true), // CHANGE
        part("drip_tape", "Drip Tape", "drip_tape", "out_of_stock", 45, 1, 1, "barb", "3/4", "barb", "3/4", { flowGpm: 1.2, operatingPressurePsi: 10 }, undefined, true) // CHANGE
    ] }; // NEW
} // NEW

function flipConnectCatalog() { // NEW
    return { items: [ // NEW
        part("male_out_fit", "Male outlet fitting", "fitting", "in_stock", 4, 1, 1, "fght", "3/4", "mght", "3/4", { pressureLossPsi: 0.1 }), // NEW
        part("female_out_fit", "Female outlet fitting", "fitting", "in_stock", 4, 1, 1, "fght", "3/4", "fght", "3/4", { pressureLossPsi: 0.1 }), // NEW
        part("female_out_filter", "Female outlet filter", "filter", "in_stock", 8, 1, 1, "fght", "3/4", "fght", "3/4", { pressureLossPsi: 0.2 }) // NEW
    ] }; // NEW
} // NEW

function addDripTapeBomParts(catalog) { // NEW
    catalog.items.push(part("poly_distribution_1_2", "1/2 in distribution tubing", "pipe_tubing", "in_stock", 0, 1, 1, "barb", "1/2", "barb", "1/2", { innerDiameterIn: 0.600, hazenWilliamsC: 150 }, 0.32, true)); // NEW
    catalog.items.push(part("poly_mainline_3_4", "3/4 in poly mainline tubing", "pipe_tubing", "in_stock", 0, 1, 1, "barb", "3/4", "barb", "3/4", { innerDiameterIn: 0.824, hazenWilliamsC: 150 }, 0.65, true)); // NEW
    catalog.items.push(part("barb_tee_1_2", "1/2 in barb tee", "fitting", "in_stock", 2, 1, 2, "barb", "1/2", "barb", "1/2", { pressureLossPsi: 0.2 }, undefined, true)); // NEW
    catalog.items.push(part("end_cap_1_2_barb", "1/2 in barb end cap", "cap_end", "in_stock", 1.25, 1, 0, "barb", "1/2", "", "", { pressureLossPsi: 0 }, undefined, true)); // NEW
    catalog.items.push(part("drip_tape_8mil_12in", "8 mil drip tape", "drip_tape", "in_stock", 0, 1, 1, "barb", "1/2", "barb", "1/2", { flowGpm: 1.2, flowGpmPerMeter: 1.2, emitterSpacingIn: 12, operatingPressurePsi: 10 }, 0.42, true)); // CHANGE
    catalog.items.push(part("fpt_to_half_barb", "FPT to 1/2 barb", "fitting", "in_stock", 4, 1, 1, "fpt", "3/4", "barb", "1/2", { pressureLossPsi: 0.2 }, undefined, true)); // NEW
    catalog.items.push(part("half_barb_to_3_4_barb", "1/2 barb to 3/4 barb", "fitting", "in_stock", 4, 1, 1, "barb", "1/2", "barb", "3/4", { pressureLossPsi: 0.2 }, undefined, true)); // NEW
    catalog.items.push(part("half_barb_plug", "1/2 barb plug", "fitting", "in_stock", 2, 1, 0, "barb", "1/2", "", "", { pressureLossPsi: 0 }, undefined, true)); // NEW
    return catalog; // NEW
} // NEW

function clickButton(root, text) { // NEW
    const button = Array.from(root.querySelectorAll("button")).find(node => node.textContent.includes(text)); // NEW
    assert.ok(button, "Missing button: " + text); // NEW
    button.click(); // NEW
    return button; // NEW
} // NEW

function clickExactButton(root, text) { // NEW
    const button = Array.from(root.querySelectorAll("button")).find(node => node.textContent.trim() === text); // NEW
    assert.ok(button, "Missing exact button: " + text); // NEW
    button.click(); // NEW
    return button; // NEW
} // NEW

function dispatchDomEvent(node, type) { // NEW
    node.dispatchEvent(new node.ownerDocument.defaultView.Event(type, { bubbles: true, cancelable: true })); // NEW
} // NEW

function assertNoActiveIrrigationOverlays(root) { // NEW
    [ // NEW
        ".trellis-irrigation-mode-hud", // NEW
        ".trellis-irrigation-port-badge", // NEW
        ".trellis-irrigation-warning-badge", // NEW
        ".trellis-irrigation-selected-pipe-highlight", // NEW
        ".trellis-irrigation-inline-connection-action" // NEW
    ].forEach(selector => assert.equal(root.querySelectorAll(selector).length, 0, selector)); // NEW
} // NEW

function buttonTexts(root) { // NEW
    return Array.from(root.querySelectorAll("button")).map(node => node.textContent.trim()).filter(Boolean); // NEW
} // NEW

function buttonByText(root, text) { // NEW
    const button = Array.from(root.querySelectorAll("button")).find(node => node.textContent.trim() === text); // NEW
    assert.ok(button, "Missing button: " + text); // NEW
    return button; // NEW
} // NEW

function clickPort(root, titlePattern) { // NEW
    const button = Array.from(root.querySelectorAll(".trellis-irrigation-port-badge")).find(node => titlePattern.test(node.title)); // NEW
    assert.ok(button, "Missing port badge: " + titlePattern); // NEW
    button.click(); // NEW
    return button; // NEW
} // NEW

function portBadges(root) { // NEW
    return Array.from(root.querySelectorAll(".trellis-irrigation-port-badge")); // NEW
} // NEW

function portBadgesInState(root, state) { // NEW
    return portBadges(root).filter(node => node.classList.contains("trellis-irrigation-port-badge-" + state)); // NEW
} // NEW

function inlineConnectionActions(root) { // NEW
    return Array.from(root.querySelectorAll(".trellis-irrigation-inline-connection-action")); // NEW
} // NEW

function assertInlineConnectionAction(root, label) { // NEW
    assert.equal(root.querySelector(".trellis-irrigation-mode-hud"), null, label + " should suppress the regular HUD"); // NEW
    const actions = inlineConnectionActions(root); // NEW
    assert.equal(actions.length, 1, "Expected one inline connection action"); // NEW
    assert.equal(actions[0].textContent, label); // NEW
    assert.equal(actions[0].parentNode && actions[0].parentNode.className, "trellis-irrigation-control-layer"); // NEW
    assert.equal(actions[0].parentNode && actions[0].parentNode.style.zIndex, "10020"); // NEW
    assert.equal(actions[0].style.zIndex, "10030"); // NEW
    return actions[0]; // NEW
} // NEW

function internalConnectionBadges(root) { // NEW
    return Array.from(root.querySelectorAll(".trellis-irrigation-internal-connection-badge")); // NEW
} // NEW

function selectedInternalConnectionBadges(root) { // NEW
    return internalConnectionBadges(root).filter(node => node.classList.contains("trellis-irrigation-internal-connection-badge-selected")); // NEW
} // NEW

function selectedPortBadgeLabels(root) { // NEW
    return portBadgesInState(root, "selected").map(node => node.textContent).sort(); // NEW
} // NEW

function selectedPortKeys(api, session) { // NEW
    return api.__test.selectedValidPorts(session).map(port => [port.cellId, port.role, String(port.index)].join(":")).sort(); // NEW
} // NEW
function irrigationLogLabels(logs) { // DIAGNOSTIC
    return (logs || []).map(args => String(args && args[0] || "")); // DIAGNOSTIC
} // DIAGNOSTIC
function irrigationLogsWithLabel(logs, label) { // DIAGNOSTIC
    const prefix = "[Trellis Irrigation] " + label; // DIAGNOSTIC
    return (logs || []).filter(args => String(args && args[0] || "") === prefix); // DIAGNOSTIC
} // DIAGNOSTIC

function assemblyCells(moduleCell, api) { // NEW
    return descendants(moduleCell, cell => cell.getAttribute && cell.getAttribute(api.attrs.ASSEMBLY) === "1"); // NEW
} // NEW

function setMeasuredEdgeLength(edge, lengthUnits) { // CHANGE
    edge.geometry.points = [{ x: 0, y: 0 }, { x: lengthUnits, y: 0 }]; // CHANGE
    return edge; // CHANGE
} // CHANGE

function styleToken(style, key) { // NEW
    const prefix = key + "="; // NEW
    const token = String(style || "").split(";").find(part => part.startsWith(prefix)); // NEW
    return token ? token.slice(prefix.length) : ""; // NEW
} // NEW

function assertRegularBedAssemblyStyle(assembly) { // NEW
    const style = String(assembly && assembly.style || ""); // NEW
    assert.doesNotMatch(style, /(?:^|;)swimlane(?:;|$)/, "bed assemblies must not use swimlanes"); // NEW
    assert.notEqual(styleToken(style, "childLayout"), "stackLayout", "bed assemblies must not stack generated layout rows"); // NEW
    assert.equal(styleToken(style, "horizontalStack"), "", "bed assemblies must not opt into swimlane horizontal stack behavior"); // NEW
    assert.equal(styleToken(style, "container"), "1", "bed assemblies should remain regular child-owning containers"); // NEW
    assert.equal(styleToken(style, "editable"), "0", "bed assembly titles should not capture canvas text focus"); // NEW
    assert.equal(styleToken(style, "verticalAlign"), "top", "bed assembly title should stay in the reserved top band"); // NEW
    assert.equal(styleToken(style, "fontStyle"), "1", "bed assembly title should remain visually distinct"); // NEW
} // NEW

function assertSwimlaneAssemblyStyle(assembly) { // NEW
    const style = String(assembly && assembly.style || ""); // NEW
    assert.match(style, /(?:^|;)swimlane(?:;|$)/, "source and part assemblies should remain swimlanes"); // NEW
    assert.equal(styleToken(style, "childLayout"), "stackLayout", "source and part assemblies should keep ordered stack layout"); // NEW
    assert.equal(styleToken(style, "horizontalStack"), "0", "source and part assemblies should keep vertical stacking"); // NEW
} // NEW

function assertAssemblyPartPlannerManagedStyle(partCell) { // CHANGE
    const style = String(partCell && partCell.style || ""); // NEW
    assert.equal(styleToken(style, "editable"), "0", "assembly parts should not be label-editable on the canvas"); // NEW
    assert.equal(styleToken(style, "movable"), "", "assembly parts should stay movable for compact draw.io stack layout"); // CHANGE
    assert.equal(styleToken(style, "selectable"), "", "assembly parts should remain selectable by default"); // NEW
    assert.equal(styleToken(style, "deletable"), "0", "assembly parts should be deleted through planner controls"); // NEW
    assert.equal(styleToken(style, "resizable"), "0", "assembly parts should not be manually resized"); // NEW
    assert.equal(styleToken(style, "connectable"), "0", "assembly parts should not expose raw draw.io connectors"); // NEW
} // NEW

function geometryCenter(geo) { // NEW
    return { x: Number(geo.x || 0) + Number(geo.width || 0) / 2, y: Number(geo.y || 0) + Number(geo.height || 0) / 2 }; // NEW
} // NEW

function connectionRow(root, label) { // NEW
    const row = Array.from(root.querySelectorAll(".trellis-irrigation-connection-row")).find(node => node.textContent.includes(label)); // NEW
    assert.ok(row, "Missing connection row: " + label); // NEW
    return row; // NEW
} // NEW

function chooseConnectionPart(root, label, partId) { // NEW
    const combobox = openConnectionCombobox(root, label); // CHANGE
    const panel = connectionComboboxPanel(combobox); // NEW
    const search = panel.querySelector(".trellis-irrigation-connection-combobox-search"); // CHANGE
    search.value = partId; // NEW
    search.dispatchEvent(new root.ownerDocument.defaultView.Event("input", { bubbles: true })); // NEW
    const option = panel.querySelector(".trellis-irrigation-connection-combobox-option[data-part-id='" + partId + "']"); // CHANGE
    assert.ok(option, "Missing connection combobox option: " + partId); // NEW
    option.click(); // CHANGE
    return combobox; // CHANGE
} // NEW

function connectionCombobox(root, label) { // NEW
    const combobox = connectionRow(root, label).querySelector(".trellis-irrigation-connection-combobox"); // NEW
    assert.ok(combobox, "Missing connection combobox: " + label); // NEW
    return combobox; // NEW
} // NEW

function openConnectionCombobox(root, label) { // NEW
    const combobox = connectionCombobox(root, label); // NEW
    const trigger = combobox.querySelector(".trellis-irrigation-connection-combobox-trigger"); // NEW
    assert.ok(trigger, "Missing connection combobox trigger: " + label); // NEW
    trigger.click(); // NEW
    assert.ok(connectionComboboxPanel(combobox), "Combobox should open: " + label); // CHANGE
    return combobox; // NEW
} // NEW

function connectionComboboxPanel(combobox) { // NEW
    const panel = combobox.querySelector(".trellis-irrigation-connection-combobox-panel") || combobox.ownerDocument.querySelector(".trellis-irrigation-connection-combobox-panel"); // NEW
    assert.ok(panel, "Missing connection combobox panel"); // NEW
    return panel; // NEW
} // NEW

function connectionComboboxOptionIds(combobox) { // NEW
    return Array.from(connectionComboboxPanel(combobox).querySelectorAll(".trellis-irrigation-connection-combobox-option")).map(node => node.getAttribute("data-part-id")); // CHANGE
} // NEW

function assertConnectionRowReadOnly(root, label) { // NEW
    const row = connectionRow(root, label); // NEW
    assert.equal(row.querySelector("select"), null, "Connected row should not expose replacement dropdown: " + label); // NEW
    assert.ok(row.querySelector(".trellis-irrigation-connection-status"), "Connected row should show read-only status: " + label); // NEW
    return row; // NEW
} // NEW

function assertConnectionHud(root, summaryPattern) { // NEW
    const hud = root.querySelector(".trellis-irrigation-connection-hud"); // NEW
    assert.ok(hud, "Missing Connection HUD"); // NEW
    assert.match(hud.textContent, /Connection/); // NEW
    if (summaryPattern) assert.match(hud.textContent, summaryPattern); // NEW
    assert.ok(hud.querySelector(".trellis-irrigation-danger-actions .trellis-irrigation-danger-button"), "Connection HUD should expose bottom danger action"); // CHANGE
    assert.ok(Array.from(hud.querySelectorAll(".trellis-irrigation-danger-actions button")).some(node => node.textContent === "Disconnect"), "Connection HUD should expose Disconnect"); // CHANGE
    assert.equal(hud.querySelector("select"), null, "Connection HUD should not expose replacement dropdowns"); // NEW
    return hud; // NEW
} // NEW

function assertBoundedStyle(node, label) { // NEW
    assert.ok(node, "Missing styled node: " + label); // NEW
    const style = node.getAttribute("style") || ""; // NEW
    assert.match(style, /min-width:\s*0/, label + " should allow grid/flex shrink"); // NEW
    assert.match(style, /max-width:\s*100%/, label + " should stay inside the HUD"); // NEW
    assert.match(style, /box-sizing:\s*border-box/, label + " should include borders in width"); // NEW
} // NEW

function selectByLabel(root, labelText) { // NEW
    const label = Array.from(root.querySelectorAll("label")).find(node => node.textContent.startsWith(labelText)); // NEW
    assert.ok(label, "Missing label: " + labelText); // NEW
    const select = label.querySelector("select"); // NEW
    assert.ok(select, "Missing select for label: " + labelText); // NEW
    return select; // NEW
} // NEW

function inputByLabel(root, labelText) { // NEW
    const label = Array.from(root.querySelectorAll("label")).find(node => node.textContent.startsWith(labelText)); // NEW
    assert.ok(label, "Missing label: " + labelText); // NEW
    const input = label.querySelector("input"); // NEW
    assert.ok(input, "Missing input for label: " + labelText); // NEW
    return input; // NEW
} // NEW

function labelCaption(label) { // NEW
    return Array.from(label.childNodes).filter(node => node.nodeType === 3).map(node => node.textContent).join("").trim(); // NEW
} // NEW

function changeSelectByLabel(root, labelText, value) { // NEW
    const select = selectByLabel(root, labelText); // NEW
    select.value = value; // NEW
    select.dispatchEvent(new root.ownerDocument.defaultView.Event("change", { bubbles: true })); // NEW
    return select; // NEW
} // NEW

function inputTextByLabel(root, labelText, value) { // NEW
    const input = inputByLabel(root, labelText); // NEW
    input.value = String(value); // NEW
    input.dispatchEvent(new root.ownerDocument.defaultView.Event("input", { bubbles: true })); // NEW
    return input; // NEW
} // NEW

function blurInput(input) { // NEW
    input.dispatchEvent(new input.ownerDocument.defaultView.Event("blur", { bubbles: false })); // NEW
} // NEW

function createConfiguredDripTapeBedAssembly(api, graph, moduleCell, bed, anchor) { // NEW
    const bedAssembly = api.__test.createBedAssembly(moduleCell, bed, anchor || { x: 240, y: 120 }).assembly; // NEW
    graph.setSelectionCell(bedAssembly); // NEW
    changeSelectByLabel(graph.container, "Inlet part", "fpt_to_half_barb"); // NEW
    changeSelectByLabel(graph.container, "Outlet part", "half_barb_to_3_4_barb"); // NEW
    graph.setSelectionCell(bedAssembly); // NEW
    return bedAssembly; // NEW
} // NEW

function bedLayoutRows(assembly, api) { // NEW
    return descendants(assembly, cell => cell.getAttribute && cell.getAttribute(api.attrs.BED_LAYOUT) === "1"); // NEW
} // NEW

function bedSupplyLines(assembly, api) { // NEW
    return descendants(assembly, cell => cell.getAttribute && cell.getAttribute(api.attrs.BED_SUPPLY_LINE) === "1"); // NEW
} // NEW

function createCommittedDripTapeBedAssembly(harness, bedCell) { // NEW
    const { api, graph, moduleCell } = harness; // NEW
    const targetBed = bedCell || harness.bed; // NEW
    api.writeCatalog(moduleCell, addDripTapeBomParts(sampleCatalog())); // NEW
    const created = api.__test.createBedAssembly(moduleCell, targetBed, { x: 30, y: 220 }); // NEW
    api.openIrrigationMode(moduleCell, { preserveViewport: true }); // NEW
    graph.setSelectionCell(created.assembly); // NEW
    changeSelectByLabel(graph.container, "Inlet part", "fpt_to_half_barb"); // NEW
    changeSelectByLabel(graph.container, "Header end cap", "end_cap_1_2_barb"); // NEW
    return created.assembly; // NEW
} // NEW

function createLifecycleBomFixture() { // NEW
    const harness = loadPlugin(); // NEW
    const { api, moduleCell, bed } = harness; // NEW
    const catalog = addDripTapeBomParts(sampleCatalog()); // NEW
    catalog.items.push(part("filter_half_lifecycle", "1/2 lifecycle filter", "filter", "out_of_stock", 20, 1, 1, "barb", "1/2", "barb", "1/2", { pressureLossPsi: 1 }, undefined, true)); // NEW
    api.writeCatalog(moduleCell, catalog); // NEW
    const source = api.__test.createSourceAssembly(moduleCell, "Half Source", { connectorType: "barb", nominalSize: "1/2", pipeConnection: true, usableFlowGpm: 5, staticPressurePsi: 45 }, { x: 30, y: 40 }); // NEW
    const filter = api.__test.createPartAssembly(moduleCell, catalog.items.find(item => item.id === "filter_half_lifecycle"), { x: 30, y: 170 }); // NEW
    const bedAssembly = api.__test.createBedAssembly(moduleCell, bed, { x: 30, y: 320 }); // NEW
    const bom = api.__test.computeBedTemplateBom(catalog, bedAssembly.assembly.geometry, "drip_tape_bed", 2, "width"); // NEW
    api.__test.commitBedTemplate(moduleCell, "bed_lifecycle", bedAssembly.assembly, { templateId: "drip_tape_bed", templateModel: "bom", irrigationType: bom.templateDef.lineKind, rowOrientation: bom.rowOrientation, rowLengthMeters: bom.rowLengthMeters, rowSpacingCm: bom.rowSpacingCm, totalRowMeters: bom.totalRowMeters, requiredParts: bom.requiredParts, anchorPartId: bom.anchorPartId, demand: bom.demand, spacing: { rows: bom.rowCount, emitterInches: 12, rowSpacingCm: bom.rowSpacingCm } }); // NEW
    assert.equal(api.__test.createAssemblyConnection(moduleCell, { cellId: api.__test.firstAssemblyPart(source.assembly).getId(), role: "output", index: 0 }, { cellId: api.__test.firstAssemblyPart(filter.assembly).getId(), role: "input", index: 0 }).ok, true); // NEW
    assert.equal(api.__test.createAssemblyConnection(moduleCell, { cellId: api.__test.firstAssemblyPart(filter.assembly).getId(), role: "output", index: 0 }, { cellId: bedAssembly.assembly.getId(), role: "input", index: 0 }).ok, true); // NEW
    const edges = api.__test.collectAssemblyEdges(moduleCell).filter(edge => edge.getAttribute(api.attrs.PIPE_EDGE) === "1"); // NEW
    edges.forEach(edge => setMeasuredEdgeLength(edge, 120)); // NEW
    return Object.assign(harness, { catalog, source, filter, filterPart: api.__test.firstAssemblyPart(filter.assembly), bedAssembly: bedAssembly.assembly, pipeEdges: edges }); // NEW
} // NEW

function createLifecycleBranchpointFixture() { // NEW
    const harness = loadPlugin(); // NEW
    const { api, moduleCell, bed } = harness; // NEW
    const catalog = addDripTapeBomParts(sampleCatalog()); // NEW
    catalog.items.push(part("branch_filter_lifecycle", "1/2 lifecycle branch filter", "filter", "out_of_stock", 20, 1, 1, "barb", "1/2", "barb", "1/2", { pressureLossPsi: 1 }, undefined, true)); // NEW
    api.writeCatalog(moduleCell, catalog); // NEW
    const source = api.__test.createSourceAssembly(moduleCell, "Half Source", { connectorType: "barb", nominalSize: "1/2", pipeConnection: true, usableFlowGpm: 5, staticPressurePsi: 45 }, { x: 30, y: 40 }); // NEW
    const branchpoint = api.__test.createBranchpointEndpoint(moduleCell, "Branch Filter", "branch_filter_lifecycle", { connectorType: "barb", nominalSize: "1/2", pipeConnection: true }); // NEW
    const bedAssembly = api.__test.createBedAssembly(moduleCell, bed, { x: 30, y: 320 }); // NEW
    const bom = api.__test.computeBedTemplateBom(catalog, bedAssembly.assembly.geometry, "drip_tape_bed", 2, "width"); // NEW
    api.__test.commitBedTemplate(moduleCell, "bed_branch_lifecycle", bedAssembly.assembly, { templateId: "drip_tape_bed", templateModel: "bom", irrigationType: bom.templateDef.lineKind, rowOrientation: bom.rowOrientation, rowLengthMeters: bom.rowLengthMeters, rowSpacingCm: bom.rowSpacingCm, totalRowMeters: bom.totalRowMeters, requiredParts: bom.requiredParts, anchorPartId: bom.anchorPartId, demand: bom.demand, spacing: { rows: bom.rowCount, emitterInches: 12, rowSpacingCm: bom.rowSpacingCm } }); // NEW
    assert.equal(api.__test.createAssemblyConnection(moduleCell, { cellId: api.__test.firstAssemblyPart(source.assembly).getId(), role: "output", index: 0 }, { cellId: branchpoint.getId(), role: "input", index: 0 }).ok, true); // NEW
    assert.equal(api.__test.createAssemblyConnection(moduleCell, { cellId: branchpoint.getId(), role: "output", index: 0 }, { cellId: bedAssembly.assembly.getId(), role: "input", index: 0 }).ok, true); // NEW
    const pipeEdges = api.__test.collectAssemblyEdges(moduleCell).filter(edge => edge.getAttribute(api.attrs.PIPE_EDGE) === "1"); // NEW
    pipeEdges.forEach(edge => setMeasuredEdgeLength(edge, 120)); // NEW
    return Object.assign(harness, { catalog, source, branchpoint, bedAssembly: bedAssembly.assembly, pipeEdges }); // NEW
} // NEW

function hudSectionTitles(root) { // NEW
    return Array.from(root.querySelectorAll(".trellis-irrigation-hud-section-title")).map(node => node.textContent); // NEW
} // NEW

function irrigationHeader(root) { // NEW
    const header = root.querySelector(".trellis-irrigation-hud-header"); // NEW
    assert.ok(header, "Missing irrigation HUD header"); // NEW
    return header; // NEW
} // NEW

function dangerButton(root) { // NEW
    const button = root.querySelector(".trellis-irrigation-danger-actions .trellis-irrigation-danger-button"); // NEW
    assert.ok(button, "Missing bottom danger button"); // NEW
    return button; // NEW
} // NEW

function lifecycleToggle(root) { // NEW
    const toggle = root.querySelector(".trellis-irrigation-lifecycle-toggle"); // NEW
    assert.ok(toggle, "Missing lifecycle toggle"); // NEW
    return toggle; // NEW
} // NEW

function assemblyFoldToggle(root) { // NEW
    const toggle = root.querySelector(".trellis-irrigation-assembly-fold-toggle"); // NEW
    assert.ok(toggle, "Missing assembly fold toggle"); // NEW
    return toggle; // NEW
} // NEW

function assertNoAssemblyFoldToggle(root) { // NEW
    assert.equal(root.querySelector(".trellis-irrigation-assembly-fold-toggle"), null); // NEW
} // NEW

function styleHasColor(node, hex, rgb) { // NEW
    const style = node && node.getAttribute("style") || ""; // NEW
    return style.indexOf(hex) >= 0 || style.indexOf(rgb) >= 0; // NEW
} // NEW

function activeOutlineStyleMatches(node) { // NEW
    return styleHasColor(node, "#d6b656", "rgb(214, 182, 86)"); // NEW
} // NEW

test("already-foldable irrigation assemblies collapse around their geometry center", () => { // NEW
    const { api, graph, moduleCell } = loadPlugin(); // NEW
    api.writeCatalog(moduleCell, sampleCatalog()); // NEW
    const assembly = api.__test.createPartAssembly(moduleCell, api.readCatalog(moduleCell).items.find(item => item.id === "filter"), { x: 30, y: 40 }).assembly; // NEW
    const beforeCenter = geometryCenter(assembly.geometry); // NEW

    assert.equal(api.__test.isCenterStableFoldAssembly(assembly), true); // NEW
    graph.foldCells(true, false, [assembly]); // NEW

    assert.deepEqual(geometryCenter(assembly.geometry), beforeCenter); // NEW
    assert.equal(assembly.geometry.width, 80); // NEW
    assert.equal(assembly.geometry.height, 30); // NEW
    assert.notEqual(assembly.geometry.x, 30); // NEW
}); // NEW

test("moved collapsed irrigation assemblies expand around their moved center", () => { // NEW
    const { api, graph, moduleCell } = loadPlugin(); // NEW
    api.writeCatalog(moduleCell, sampleCatalog()); // NEW
    const assembly = api.__test.createSourceAssembly(moduleCell, "Well", { connectorType: "barb", nominalSize: "3/4" }, { x: 30, y: 40 }).assembly; // NEW

    graph.foldCells(true, false, [assembly]); // NEW
    graph.moveCells([assembly], 42, 18); // NEW
    const movedCollapsedCenter = geometryCenter(assembly.geometry); // NEW
    graph.foldCells(false, false, [assembly]); // NEW

    assert.deepEqual(geometryCenter(assembly.geometry), movedCollapsedCenter); // NEW
    assert.equal(assembly.geometry.width, 210); // NEW
}); // NEW

test("center-stable folding excludes bed assemblies, modules, and generic cells", () => { // NEW
    const { api, graph, moduleCell, bed, document } = loadPlugin(); // NEW
    const bedAssembly = api.__test.createBedAssembly(moduleCell, bed, { x: 30, y: 220 }).assembly; // NEW
    const generic = appendChild(moduleCell, makeXmlCell(document, "generic", { label: "Generic" }, { x: 300, y: 40, width: 160, height: 90 })); // NEW

    assert.equal(api.__test.isCenterStableFoldAssembly(bedAssembly), false); // NEW
    assert.equal(api.__test.isCenterStableFoldAssembly(moduleCell), false); // NEW
    assert.equal(api.__test.isCenterStableFoldAssembly(generic), false); // NEW

    const genericTopLeft = { x: generic.geometry.x, y: generic.geometry.y }; // NEW
    graph.foldCells(true, false, [generic]); // NEW
    assert.deepEqual({ x: generic.geometry.x, y: generic.geometry.y }, genericTopLeft); // NEW
    assert.equal(styleToken(bedAssembly.style, "collapsible"), "0"); // NEW
}); // NEW

test("selected irrigation assembly shows bottom collapse and expand controls", () => { // CHANGE
    const { api, graph, moduleCell } = loadPlugin(); // CHANGE
    api.writeCatalog(moduleCell, sampleCatalog()); // NEW
    const assembly = api.__test.createPartAssembly(moduleCell, api.readCatalog(moduleCell).items.find(item => item.id === "filter"), { x: 30, y: 40 }).assembly; // CHANGE
    const beforeCenter = geometryCenter(assembly.geometry); // NEW
    api.openIrrigationMode(moduleCell, { preserveViewport: true }); // NEW
    graph.setSelectionCell(assembly); // NEW

    assert.ok(hudSectionTitles(graph.container).includes("Assemblies")); // NEW
    assert.deepEqual(buttonTexts(assemblyFoldToggle(graph.container)), ["Collapse Assembly"]); // NEW
    clickExactButton(assemblyFoldToggle(graph.container), "Collapse Assembly"); // CHANGE
    assert.equal(graph.foldCalls.at(-1).collapse, true); // NEW
    assert.equal(api.__test.isAssemblyCollapsed(assembly), true); // CHANGE
    assert.deepEqual(geometryCenter(assembly.geometry), beforeCenter); // NEW
    assert.deepEqual(buttonTexts(assemblyFoldToggle(graph.container)), ["Expand Assembly"]); // CHANGE

    clickExactButton(assemblyFoldToggle(graph.container), "Expand Assembly"); // CHANGE
    assert.equal(graph.foldCalls.at(-1).collapse, false); // NEW
    assert.equal(api.__test.isAssemblyCollapsed(assembly), false); // CHANGE
    assert.deepEqual(geometryCenter(assembly.geometry), beforeCenter); // NEW
}); // NEW

test("selected inner part resolves assembly collapse controls to its parent assembly", () => { // CHANGE
    const { api, graph, moduleCell } = loadPlugin(); // CHANGE
    api.writeCatalog(moduleCell, sampleCatalog()); // NEW
    const assembly = api.__test.createSourceAssembly(moduleCell, "Well", { connectorType: "barb", nominalSize: "3/4" }, { x: 30, y: 40 }).assembly; // CHANGE
    const sourcePart = api.__test.firstAssemblyPart(assembly); // CHANGE
    api.openIrrigationMode(moduleCell, { preserveViewport: true }); // NEW
    graph.setSelectionCell(sourcePart); // NEW

    assert.equal(api.__test.selectedFoldableAssemblies([sourcePart]).map(cell => cell.getId()).join(","), assembly.getId()); // CHANGE
    assert.deepEqual(buttonTexts(assemblyFoldToggle(graph.container)), ["Collapse Assembly"]); // NEW
    clickExactButton(assemblyFoldToggle(graph.container), "Collapse Assembly"); // NEW
    assert.equal(api.__test.isAssemblyCollapsed(assembly), true); // NEW
}); // NEW

test("mixed selected assembly fold states show both bottom controls", () => { // CHANGE
    const { api, graph, moduleCell } = loadPlugin(); // CHANGE
    api.writeCatalog(moduleCell, sampleCatalog()); // NEW
    const expanded = api.__test.createPartAssembly(moduleCell, api.readCatalog(moduleCell).items.find(item => item.id === "filter"), { x: 30, y: 40 }).assembly; // CHANGE
    const collapsed = api.__test.createPartAssembly(moduleCell, api.readCatalog(moduleCell).items.find(item => item.id === "regulator"), { x: 260, y: 40 }).assembly; // CHANGE
    graph.foldCells(true, false, [collapsed]); // NEW
    api.openIrrigationMode(moduleCell, { preserveViewport: true }); // NEW
    graph.setSelectionCells([expanded, collapsed]); // NEW

    assert.deepEqual(buttonTexts(assemblyFoldToggle(graph.container)), ["Collapse Assemblies", "Expand Assemblies"]); // CHANGE
    clickExactButton(assemblyFoldToggle(graph.container), "Collapse Assemblies"); // CHANGE
    assert.equal(api.__test.isAssemblyCollapsed(expanded), true); // CHANGE
    assert.equal(api.__test.isAssemblyCollapsed(collapsed), true); // CHANGE
    assert.deepEqual(buttonTexts(assemblyFoldToggle(graph.container)), ["Expand Assemblies"]); // NEW
}); // NEW

test("assembly fold controls exclude bed module generic and pipe-only selections", () => { // NEW
    const { api, graph, moduleCell, bed, document } = loadPlugin(); // NEW
    api.writeCatalog(moduleCell, sampleCatalog()); // NEW
    const source = api.__test.createSourceAssembly(moduleCell, "Well", { connectorType: "barb", nominalSize: "3/4", pipeConnection: true }, { x: 30, y: 40 }); // NEW
    const filter = api.__test.createPartAssembly(moduleCell, api.readCatalog(moduleCell).items.find(item => item.id === "filter"), { x: 260, y: 40 }); // NEW
    const bedAssembly = api.__test.createBedAssembly(moduleCell, bed, { x: 30, y: 220 }).assembly; // NEW
    const generic = appendChild(moduleCell, makeXmlCell(document, "generic_fold_control", { label: "Generic" }, { x: 460, y: 40, width: 120, height: 60 })); // NEW
    const connection = api.__test.createAssemblyConnection(moduleCell, { cellId: api.__test.firstAssemblyPart(source.assembly).getId(), role: "output", index: 0 }, { cellId: api.__test.firstAssemblyPart(filter.assembly).getId(), role: "input", index: 0 }); // NEW
    assert.equal(connection.ok, true, connection.reason); // NEW
    api.openIrrigationMode(moduleCell, { preserveViewport: true }); // NEW

    graph.setSelectionCell(bedAssembly); // NEW
    assertNoAssemblyFoldToggle(graph.container); // NEW
    graph.setSelectionCell(bed); // NEW
    assertNoAssemblyFoldToggle(graph.container); // NEW
    graph.setSelectionCell(moduleCell); // NEW
    assertNoAssemblyFoldToggle(graph.container); // NEW
    graph.setSelectionCell(connection.edge); // NEW
    assertNoAssemblyFoldToggle(graph.container); // NEW
    graph.setSelectionCell(generic); // NEW
    assert.equal(graph.container.querySelector(".trellis-irrigation-mode-hud"), null); // NEW
}); // NEW

function nextTick() { // NEW
    return new Promise(resolve => setTimeout(resolve, 0)); // NEW
} // NEW

test("catalog manager renders category/size group headers, catalog filters, and connector dropdowns", () => { // CHANGE
    const { api, moduleCell, ui } = loadPlugin(); // NEW
    api.writeCatalog(moduleCell, sampleCatalog()); // NEW
    api.openCatalogManager(moduleCell); // NEW
    assert.equal(ui.dialog.container.style.zIndex, "2000000000"); // NEW
    assert.equal(ui.dialog.bg.style.zIndex, "1999999999"); // NEW
    const groups = Array.from(ui.lastDialog.querySelectorAll(".trellis-irrigation-catalog-group")).map(row => row.textContent); // NEW
    assert.ok(groups.includes("filter / 3/4")); // NEW
    assert.ok(groups.includes("fitting / 3/4")); // NEW
    assert.ok(groups.includes("pipe tubing / 3/4")); // NEW
    const broadFilter = ui.lastDialog.querySelector(".trellis-irrigation-catalog-broad-filter"); // NEW
    const categoryFilter = ui.lastDialog.querySelector(".trellis-irrigation-catalog-category-filter"); // NEW
    const sizeFilter = ui.lastDialog.querySelector(".trellis-irrigation-catalog-size-filter"); // NEW
    const connectionFilter = ui.lastDialog.querySelector(".trellis-irrigation-catalog-connection-filter"); // NEW
    assert.ok(Array.from(broadFilter.options).some(option => option.value === "control_protection")); // NEW
    assert.ok(Array.from(categoryFilter.options).some(option => option.value === "fitting")); // NEW
    assert.ok(Array.from(sizeFilter.options).some(option => option.value === "3/4")); // NEW
    assert.ok(Array.from(connectionFilter.options).some(option => option.value === "3")); // NEW
    assert.match(ui.lastDialog.textContent, /Control & protection/); // NEW
    assert.match(ui.lastDialog.textContent, /3 total/); // NEW
    connectionFilter.value = "3"; // NEW
    connectionFilter.dispatchEvent(new ui.lastDialog.ownerDocument.defaultView.Event("change")); // NEW
    assert.ok(ui.lastDialog.querySelector("[data-part-id='valve']")); // NEW
    assert.equal(ui.lastDialog.querySelector("[data-part-id='filter']"), null); // NEW
    const selects = Array.from(ui.lastDialog.querySelectorAll(".trellis-irrigation-catalog-form select")); // NEW
    assert.ok(selects.some(select => Array.from(select.options).some(option => option.value === "mght"))); // CHANGE
    assert.ok(selects.some(select => Array.from(select.options).some(option => option.value === "fght"))); // NEW
    assert.ok(selects.some(select => Array.from(select.options).some(option => option.value === "3/4"))); // NEW
    assert.ok(selects.some(select => Array.from(select.options).some(option => option.value === "barb" && option.textContent === "barb"))); // CHANGE
    assert.equal(selects.some(select => Array.from(select.options).some(option => option.value === "pipe")), false); // CHANGE
    assert.doesNotMatch(ui.lastDialog.textContent, /\bID\b/); // CHANGE
    assert.doesNotMatch(ui.lastDialog.textContent, /Method/); // CHANGE
    assert.doesNotMatch(ui.lastDialog.textContent, /uses pipe/i); // CHANGE
    assert.doesNotMatch(ui.lastDialog.textContent, /Hazen-Williams/); // CHANGE
    assert.doesNotMatch(ui.lastDialog.textContent, /Pipe inner diameter/); // CHANGE
    ui.lastDialog.querySelector(".trellis-irrigation-catalog-connection-filter").value = ""; // CHANGE
    ui.lastDialog.querySelector(".trellis-irrigation-catalog-connection-filter").dispatchEvent(new ui.lastDialog.ownerDocument.defaultView.Event("change")); // CHANGE
    ui.lastDialog.querySelector("[data-part-id='pipe_cheap']").click(); // CHANGE
    assert.match(ui.lastDialog.textContent, /Unit cost per ft/); // CHANGE
    assert.match(ui.lastDialog.textContent, /Pipe size/); // NEW
    assert.match(ui.lastDialog.textContent, /Pipe inner diameter/); // CHANGE
    assert.doesNotMatch(ui.lastDialog.textContent, /Input type/); // NEW
    assert.doesNotMatch(ui.lastDialog.textContent, /Output type/); // NEW
    assert.doesNotMatch(ui.lastDialog.textContent, /Inputs/); // NEW
    assert.doesNotMatch(ui.lastDialog.textContent, /uses pipe/i); // NEW
    const formCategory = Array.from(ui.lastDialog.querySelectorAll(".trellis-irrigation-catalog-form label")).find(label => label.textContent.startsWith("Category")).querySelector("select"); // CHANGE
    formCategory.value = "fitting"; // CHANGE
    formCategory.dispatchEvent(new ui.lastDialog.ownerDocument.defaultView.Event("change")); // CHANGE
    assert.doesNotMatch(ui.lastDialog.textContent, /Unit cost per ft/); // CHANGE
    assert.doesNotMatch(ui.lastDialog.textContent, /Pipe inner diameter/); // CHANGE
    clickButton(ui.lastDialog, "Save Part"); // CHANGE
    const changed = api.readCatalog(moduleCell).items.find(item => item.id === "pipe_cheap"); // CHANGE
    assert.equal(changed.category, "fitting"); // CHANGE
    assert.equal(changed.unitCost, null); // CHANGE
    assert.equal(changed.specs.innerDiameterIn, null); // CHANGE
}); // NEW

test("catalog manager opens scoped to a selected inner part cell and can show all parts", () => { // NEW
    const { api, graph, moduleCell, ui } = loadPlugin(); // NEW
    const catalog = sampleCatalog(); // NEW
    api.writeCatalog(moduleCell, catalog); // NEW
    const selected = api.__test.createPartAssembly(moduleCell, catalog.items.find(item => item.id === "filter"), { x: 30, y: 40 }); // NEW
    graph.setSelectionCell(selected.partCell); // NEW
    api.openCatalogManager(moduleCell); // NEW
    assert.ok(ui.lastDialog.querySelector("[data-part-id='filter']")); // NEW
    assert.equal(ui.lastDialog.querySelector("[data-part-id='regulator']"), null); // NEW
    const name = inputByLabel(ui.lastDialog, "Name"); // NEW
    name.value = "Selected Filter"; // NEW
    clickButton(ui.lastDialog, "Save Part"); // NEW
    assert.equal(api.readCatalog(moduleCell).items.find(item => item.id === "filter").name, "Selected Filter"); // NEW
    clickButton(ui.lastDialog, "Show All"); // NEW
    assert.ok(ui.lastDialog.querySelector("[data-part-id='regulator']")); // NEW
}); // NEW

test("catalog manager treats selected assembly containers as their child catalogue parts", () => { // NEW
    const { api, graph, moduleCell, ui } = loadPlugin(); // NEW
    const catalog = sampleCatalog(); // NEW
    api.writeCatalog(moduleCell, catalog); // NEW
    const filter = api.__test.createPartAssembly(moduleCell, catalog.items.find(item => item.id === "filter"), { x: 30, y: 40 }); // NEW
    const regulator = api.__test.createPartAssembly(moduleCell, catalog.items.find(item => item.id === "regulator"), { x: 260, y: 40 }); // NEW
    graph.setSelectionCells([filter.assembly, regulator.assembly]); // NEW
    api.openCatalogManager(moduleCell); // NEW
    assert.ok(ui.lastDialog.querySelector("[data-part-id='filter']")); // NEW
    assert.ok(ui.lastDialog.querySelector("[data-part-id='regulator']")); // NEW
    assert.equal(ui.lastDialog.querySelector("[data-part-id='valve']"), null); // NEW
}); // NEW

test("catalog manager deduplicates selected diagram instances of the same catalogue part", () => { // NEW
    const { api, graph, moduleCell, ui } = loadPlugin(); // NEW
    const catalog = sampleCatalog(); // NEW
    api.writeCatalog(moduleCell, catalog); // NEW
    const first = api.__test.createPartAssembly(moduleCell, catalog.items.find(item => item.id === "filter"), { x: 30, y: 40 }); // NEW
    const second = api.__test.createPartAssembly(moduleCell, catalog.items.find(item => item.id === "filter"), { x: 260, y: 40 }); // NEW
    graph.setSelectionCells([first.partCell, second.partCell]); // NEW
    api.openCatalogManager(moduleCell); // NEW
    assert.equal(ui.lastDialog.querySelectorAll("[data-part-id='filter']").length, 1); // NEW
    assert.equal(ui.lastDialog.querySelector("[data-part-id='regulator']"), null); // NEW
}); // NEW

test("catalog manager falls back to full catalog when selected part ids are missing", () => { // NEW
    const { api, graph, moduleCell, ui } = loadPlugin(); // NEW
    const catalog = sampleCatalog(); // NEW
    api.writeCatalog(moduleCell, catalog); // NEW
    const missing = api.__test.createPartAssembly(moduleCell, part("missing_part", "Missing part", "filter", "in_stock", 1, 1, 1, "barb", "3/4", "barb", "3/4"), { x: 30, y: 40 }); // NEW
    graph.setSelectionCell(missing.partCell); // NEW
    api.openCatalogManager(moduleCell); // NEW
    assert.equal(ui.lastDialog.querySelector(".trellis-irrigation-catalog-show-all"), null); // NEW
    assert.ok(ui.lastDialog.querySelector("[data-part-id='filter']")); // NEW
    assert.ok(ui.lastDialog.querySelector("[data-part-id='regulator']")); // NEW
}); // NEW

test("catalog manager opens scoped to a selected pipe edge part", () => { // NEW
    const { api, graph, moduleCell, ui } = loadPlugin(); // NEW
    const catalog = sampleCatalog(); // NEW
    api.writeCatalog(moduleCell, catalog); // NEW
    const source = api.__test.createSourceAssembly(moduleCell, "Well", { connectorType: "barb", nominalSize: "3/4", method: "drip", pipeConnection: true, usableFlowGpm: 5, staticPressurePsi: 45 }, { x: 30, y: 40 }); // NEW
    const filter = api.__test.createPartAssembly(moduleCell, catalog.items.find(item => item.id === "filter"), { x: 30, y: 180 }); // NEW
    const connection = api.__test.createAssemblyConnection(moduleCell, { cellId: api.__test.firstAssemblyPart(source.assembly).getId(), role: "output", index: 0 }, { cellId: api.__test.firstAssemblyPart(filter.assembly).getId(), role: "input", index: 0 }); // NEW
    assert.equal(connection.ok, true, connection.reason); // NEW
    assert.equal(connection.edge.getAttribute(api.attrs.PIPE_PART_ID), "pipe_cheap"); // NEW
    graph.setSelectionCell(connection.edge); // NEW
    api.openCatalogManager(moduleCell); // NEW
    assert.ok(ui.lastDialog.querySelector(".trellis-irrigation-catalog-show-all")); // NEW
    assert.ok(ui.lastDialog.querySelector("[data-part-id='pipe_cheap']")); // NEW
    assert.equal(ui.lastDialog.querySelector("[data-part-id='filter']"), null); // NEW
}); // NEW

test("catalog manager ignores selected direct-link edges without pipe parts", () => { // NEW
    const { api, graph, moduleCell, ui } = loadPlugin(); // NEW
    const catalog = { items: [ // NEW
        part("direct_valve", "Direct Valve", "valve", "in_stock", 10, 1, 2, "fpt", "3/4", "mpt", "3/4", { maxFlowGpm: 8 }), // NEW
        part("direct_filter", "Direct Filter", "filter", "in_stock", 10, 1, 1, "fpt", "3/4", "mpt", "3/4", { pressureLossPsi: 1 }) // NEW
    ] }; // NEW
    api.writeCatalog(moduleCell, catalog); // NEW
    const valve = api.__test.createPartAssembly(moduleCell, catalog.items[0], { x: 30, y: 40 }); // NEW
    const filter = api.__test.createPartAssembly(moduleCell, catalog.items[1], { x: 30, y: 180 }); // NEW
    const connection = api.__test.createAssemblyConnection(moduleCell, { cellId: api.__test.firstAssemblyPart(valve.assembly).getId(), role: "output", index: 0 }, { cellId: api.__test.firstAssemblyPart(filter.assembly).getId(), role: "input", index: 0 }); // NEW
    assert.equal(connection.ok, true, connection.reason); // NEW
    assert.equal(connection.edge.getAttribute(api.attrs.DIRECT_LINK_EDGE), "1"); // NEW
    graph.setSelectionCell(connection.edge); // NEW
    api.openCatalogManager(moduleCell); // NEW
    assert.equal(ui.lastDialog.querySelector(".trellis-irrigation-catalog-show-all"), null); // NEW
    assert.ok(ui.lastDialog.querySelector("[data-part-id='direct_valve']")); // NEW
    assert.ok(ui.lastDialog.querySelector("[data-part-id='direct_filter']")); // NEW
}); // NEW

test("catalog manager opens selected bed assemblies to saved BOM catalogue parts", () => { // NEW
    const { api, graph, moduleCell, bed, ui } = loadPlugin(); // NEW
    const catalog = addDripTapeBomParts(sampleCatalog()); // NEW
    api.writeCatalog(moduleCell, catalog); // NEW
    const bedAssembly = api.__test.createBedAssembly(moduleCell, bed, { x: 30, y: 220 }); // NEW
    api.__test.commitBedTemplate(moduleCell, "bed_one", bed, { // NEW
        templateId: "drip_tape_bed", // NEW
        templateModel: "bom", // NEW
        inletPartId: "fpt_to_half_barb", // NEW
        outletPartId: "half_barb_to_3_4_barb", // NEW
        partIds: ["fpt_to_half_barb", "half_barb_to_3_4_barb"], // NEW
        requiredParts: [{ partId: "drip_tape_8mil_12in", quantityPerRowMeter: 1, quantityMeters: 3, unit: "m" }], // NEW
        anchorPartId: "drip_tape_8mil_12in", // NEW
        demand: { flowGpm: 1.2, operatingPressurePsi: 10 }, // NEW
        spacing: { rows: 2, emitterInches: 12 } // NEW
    }); // NEW
    graph.setSelectionCell(bedAssembly.assembly); // NEW
    api.openCatalogManager(moduleCell); // NEW
    assert.ok(ui.lastDialog.querySelector(".trellis-irrigation-catalog-show-all")); // NEW
    assert.ok(ui.lastDialog.querySelector("[data-part-id='fpt_to_half_barb']")); // NEW
    assert.ok(ui.lastDialog.querySelector("[data-part-id='half_barb_to_3_4_barb']")); // NEW
    assert.ok(ui.lastDialog.querySelector("[data-part-id='drip_tape_8mil_12in']")); // NEW
    assert.equal(ui.lastDialog.querySelectorAll("[data-part-id='drip_tape_8mil_12in']").length, 1); // NEW
    assert.equal(ui.lastDialog.querySelector("[data-part-id='filter']"), null); // NEW
}); // NEW

test("catalog manager deduplicates bed assembly role template and pipe part ids", () => { // NEW
    const { api, graph, moduleCell, bed, ui } = loadPlugin(); // NEW
    const catalog = addDripTapeBomParts(sampleCatalog()); // NEW
    api.writeCatalog(moduleCell, catalog); // NEW
    const bedAssembly = api.__test.createBedAssembly(moduleCell, bed, { x: 30, y: 220 }); // NEW
    bedAssembly.assembly.value.setAttribute(api.attrs.BED_TEMPLATE_JSON, JSON.stringify({ // CHANGE
        inletPartId: "drip_tape_8mil_12in", // NEW
        partIds: ["drip_tape_8mil_12in"], // NEW
        requiredParts: [{ partId: "drip_tape_8mil_12in" }], // NEW
        anchorPartId: "drip_tape_8mil_12in", // NEW
        pipePartId: "drip_tape_8mil_12in" // NEW
    })); // NEW
    graph.setSelectionCell(bedAssembly.assembly); // NEW
    api.openCatalogManager(moduleCell); // NEW
    assert.equal(ui.lastDialog.querySelectorAll("[data-part-id='drip_tape_8mil_12in']").length, 1); // NEW
    assert.equal(ui.lastDialog.querySelector("[data-part-id='filter']"), null); // NEW
}); // NEW

test("catalog manager falls back when selected bed assembly BOM parts are missing", () => { // NEW
    const { api, graph, moduleCell, bed, ui } = loadPlugin(); // NEW
    api.writeCatalog(moduleCell, sampleCatalog()); // NEW
    const bedAssembly = api.__test.createBedAssembly(moduleCell, bed, { x: 30, y: 220 }); // NEW
    bedAssembly.assembly.value.setAttribute(api.attrs.BED_TEMPLATE_JSON, JSON.stringify({ // CHANGE
        inletPartId: "missing_inlet", // NEW
        outletPartId: "missing_outlet", // NEW
        partIds: ["missing_inlet", "missing_outlet"], // NEW
        requiredParts: [{ partId: "missing_required" }], // NEW
        anchorPartId: "missing_required", // NEW
        pipePartId: "missing_pipe" // NEW
    })); // NEW
    graph.setSelectionCell(bedAssembly.assembly); // NEW
    api.openCatalogManager(moduleCell); // NEW
    assert.equal(ui.lastDialog.querySelector(".trellis-irrigation-catalog-show-all"), null); // NEW
    assert.ok(ui.lastDialog.querySelector("[data-part-id='filter']")); // NEW
    assert.ok(ui.lastDialog.querySelector("[data-part-id='regulator']")); // NEW
}); // NEW

test("pipe catalog editor saves one shared size without rejecting old asymmetric pipe data", () => { // NEW
    const { api, moduleCell, ui } = loadPlugin(); // NEW
    const legacyPipe = part("legacy_pipe", "Legacy asymmetric pipe", "pipe_tubing", "in_stock", 0, 2, 3, "twist_lock", "1/2", "push_connect", "3/4", { innerDiameterIn: 0.6, hazenWilliamsC: 150 }, 0.4, true); // NEW
    assert.equal(api.validateCatalogPart(legacyPipe).ok, true); // NEW
    api.writeCatalog(moduleCell, { items: [legacyPipe] }); // NEW
    api.openCatalogManager(moduleCell); // NEW
    ui.lastDialog.querySelector("[data-part-id='legacy_pipe']").click(); // NEW
    assert.match(ui.lastDialog.textContent, /Pipe size/); // NEW
    assert.doesNotMatch(ui.lastDialog.textContent, /Input type/); // NEW
    assert.doesNotMatch(ui.lastDialog.textContent, /Output type/); // NEW
    assert.doesNotMatch(ui.lastDialog.textContent, /uses pipe/i); // NEW
    const pipeSize = Array.from(ui.lastDialog.querySelectorAll(".trellis-irrigation-catalog-form label")).find(label => label.textContent.startsWith("Pipe size")).querySelector("select"); // NEW
    pipeSize.value = "1"; // NEW
    clickButton(ui.lastDialog, "Save Part"); // NEW
    const saved = api.readCatalog(moduleCell).items.find(item => item.id === "legacy_pipe"); // NEW
    assert.equal(saved.connectors.inputs, 1); // NEW
    assert.equal(saved.connectors.outputs, 1); // NEW
    assert.equal(saved.connectors.input.type, "barb"); // NEW
    assert.equal(saved.connectors.output.type, "barb"); // NEW
    assert.equal(saved.connectors.input.nominalSize, "1"); // NEW
    assert.equal(saved.connectors.output.nominalSize, "1"); // NEW
    assert.equal(saved.connectors.input.pipeConnection, false); // CHANGE
    assert.equal(saved.connectors.output.pipeConnection, false); // CHANGE
}); // NEW

test("starter catalog includes 1 inch and 1/4 inch poly/barb irrigation components", () => { // NEW
    const { api } = loadPlugin(); // NEW
    const catalog = api.starterCatalog(); // NEW
    const ids = new Set(catalog.items.map(item => item.id)); // NEW
    [ // NEW
        "poly_mainline_1", // NEW
        "barb_tee_1", // NEW
        "barb_elbow_1", // NEW
        "barb_coupler_1", // NEW
        "end_cap_1_barb", // NEW
        "reducer_1_to_3_4_barb", // NEW
        "adapter_3_4_to_1_barb", // NEW
        "micro_tubing_1_4", // NEW
        "micro_tee_1_4", // NEW
        "micro_elbow_1_4", // NEW
        "micro_coupler_1_4", // NEW
        "micro_goof_plug_1_4", // NEW
        "transfer_barb_1_2_to_1_4", // NEW
        "adapter_1_4_to_1_2_barb", // NEW
        "micro_emitter_0_5_gph", // NEW
        "micro_emitter_1_0_gph", // NEW
        "micro_emitter_2_0_gph", // NEW
        "micro_spray_stake_1_4", // CHANGE
        "hose_splitter_2way_3_4_fght_mght", // NEW
        "hose_splitter_4way_3_4_fght_mght", // CHANGE
        "twist_lock_coupler_1_4", // NEW
        "twist_lock_tee_1_2", // NEW
        "twist_lock_elbow_3_4", // NEW
        "twist_lock_end_cap_1", // NEW
        "twist_lock_adapter_1_4_to_1", // CHANGE
        "push_connect_coupler_1_4", // NEW
        "push_connect_tee_1_2", // NEW
        "push_connect_elbow_3_4", // NEW
        "push_connect_end_cap_1", // NEW
        "push_connect_adapter_1_to_1_4" // CHANGE
    ].forEach(id => assert.ok(ids.has(id), "Missing starter part " + id)); // NEW
    ["twist_lock_tubing_1_4", "twist_lock_tubing_1_2", "twist_lock_tubing_3_4", "twist_lock_tubing_1", "push_connect_tubing_1_4", "push_connect_tubing_1_2", "push_connect_tubing_3_4", "push_connect_tubing_1"].forEach(id => assert.equal(ids.has(id), false, "Removed family tubing should be absent: " + id)); // NEW
    assert.equal(catalog.items.some(item => [item.connectors.input, item.connectors.output].some(connector => connector && connector.type === "ght")), false); // NEW
    assert.equal(catalog.items.find(item => item.id === "hose_splitter_2way_3_4_fght_mght").connectors.outputs, 2); // NEW
    assert.equal(catalog.items.find(item => item.id === "hose_splitter_4way_3_4_fght_mght").connectors.outputs, 4); // NEW
    assert.equal(catalog.items.find(item => item.id === "twist_lock_adapter_1_4_to_1").connectors.input.type, "twist_lock"); // CHANGE
    assert.equal(catalog.items.find(item => item.id === "push_connect_adapter_1_to_1_4").connectors.output.type, "push_connect"); // CHANGE
    assert.equal(catalog.items.find(item => item.id === "twist_lock_coupler_1_2").connectors.input.pipeConnection, true); // NEW
    assert.equal(catalog.items.some(item => item.id === "push_connect_tubing_3_4"), false); // CHANGE
    assert.equal(catalog.items.some(item => [item.connectors.input, item.connectors.output].some(connector => connector && connector.type === "pipe")), false); // CHANGE
    assert.equal(catalog.items.some(item => [item.connectors.input, item.connectors.output].some(connector => connector && connector.method)), false); // NEW
    assert.equal(catalog.items.find(item => item.id === "poly_mainline_1").specs.hazenWilliamsC, 150); // CHANGE
    assert.equal(catalog.items.find(item => item.id === "pc_dripline_1_2").specs.minOperatingPressurePsi, 12); // CHANGE
    assert.equal(catalog.items.find(item => item.id === "pc_dripline_1_2").specs.operatingPressurePsi, undefined); // CHANGE
    catalog.items.forEach(item => assert.equal(api.validateCatalogPart(item).ok, true, item.id)); // NEW
}); // NEW

test("connector compatibility respects GHT and pipe-thread gender", () => { // NEW
    const { api } = loadPlugin(); // NEW
    const c = type => ({ type, nominalSize: "3/4" }); // CHANGE
    assert.equal(api.__test.shortCatalogPartName({ name: "3/4 in poly mainline tubing" }), "poly mainline tubing"); // NEW
    assert.equal(api.__test.normalizeEndpointProfile({ connectorType: "twist" }).connectorType, "twist_lock"); // NEW
    assert.equal(api.__test.normalizeEndpointProfile({ connectorType: "twist lock" }).connectorType, "twist_lock"); // NEW
    assert.equal(api.__test.normalizeEndpointProfile({ connectorType: "push connect" }).connectorType, "push_connect"); // NEW
    assert.equal(api.__test.normalizeEndpointProfile({ connectorType: "push-to-connect" }).connectorType, "push_connect"); // NEW
    assert.equal(api.__test.ConnectorRules.isPipeConnectorType("barb"), true); // NEW
    assert.equal(api.__test.ConnectorRules.isPipeConnectorType("twist lock"), true); // NEW
    assert.equal(api.__test.ConnectorRules.isPipeConnectorType("push-to-connect"), true); // NEW
    assert.equal(api.__test.ConnectorRules.isPipeConnectorType("mght"), false); // NEW
    assert.equal(api.__test.connectorMatches(c("mght"), c("fght")).ok, true); // NEW
    assert.equal(api.__test.connectorMatches(c("fght"), c("mght")).ok, true); // NEW
    assert.equal(api.__test.connectorMatches(c("mpt"), c("fpt")).ok, true); // NEW
    assert.equal(api.__test.connectorMatches(c("fpt"), c("mpt")).ok, true); // NEW
    assert.equal(api.__test.connectorMatches(c("mght"), c("mght")).ok, false); // NEW
    assert.equal(api.__test.connectorMatches(c("fpt"), c("fpt")).ok, false); // NEW
    assert.equal(api.__test.connectorMatches(c("barb"), c("barb")).ok, false); // CHANGE
    assert.equal(api.__test.connectorMatches(c("ght"), c("ght")).ok, false); // NEW
    assert.equal(api.__test.connectorMatches(c("ght"), c("fght")).ok, false); // NEW
    assert.equal(api.__test.connectorMatches(c("mght"), c("ght")).ok, false); // NEW
    assert.equal(api.__test.connectorMatches(c("quick_connect"), c("quick_connect")).ok, false); // NEW
    assert.match(api.__test.connectorMatches(c("ght"), c("ght")).reason, /Gendered GHT/); // NEW
    assert.match(api.__test.connectorMatches(c("quick_connect"), c("quick_connect")).reason, /Gendered connector/); // NEW
    assert.equal(api.__test.connectorMatches(c("mght"), { type: "fght", nominalSize: "1/2" }).ok, false); // CHANGE
}); // NEW

test("generated twist-lock and push-connect connectors infer pipe edges by size", () => { // CHANGE
    const { api, moduleCell } = loadPlugin(); // NEW
    api.writeCatalog(moduleCell, api.starterCatalog()); // NEW
    const catalog = api.readCatalog(moduleCell); // NEW
    const byId = id => catalog.items.find(item => item.id === id); // NEW
    assert.equal(byId("twist_lock_coupler_1_2").connectors.input.type, "twist_lock"); // NEW
    assert.equal(byId("twist_lock_coupler_1_2").connectors.input.pipeConnection, true); // NEW
    assert.equal(byId("push_connect_coupler_3_4").connectors.input.type, "push_connect"); // NEW
    assert.equal(byId("push_connect_coupler_3_4").connectors.input.pipeConnection, true); // NEW
    const twistSource = api.__test.createSourceAssembly(moduleCell, "Twist source", { connectorType: "twist_lock", nominalSize: "1/2", pipeConnection: true, usableFlowGpm: 4, staticPressurePsi: 35 }, { x: 30, y: 40 }); // NEW
    const twistCoupler = api.__test.createPartAssembly(moduleCell, byId("twist_lock_coupler_1_2"), { x: 30, y: 180 }); // NEW
    const twist = api.__test.createAssemblyConnection(moduleCell, { cellId: api.__test.firstAssemblyPart(twistSource.assembly).getId(), role: "output", index: 0 }, { cellId: api.__test.firstAssemblyPart(twistCoupler.assembly).getId(), role: "input", index: 0 }); // NEW
    assert.equal(twist.ok, true, twist.reason); // NEW
    assert.equal(twist.edge.getAttribute(api.attrs.PIPE_PART_ID), "poly_distribution_1_2"); // CHANGE
    const pushSource = api.__test.createSourceAssembly(moduleCell, "Push source", { connectorType: "push_connect", nominalSize: "3/4", pipeConnection: true, usableFlowGpm: 4, staticPressurePsi: 35 }, { x: 340, y: 40 }); // NEW
    const pushCoupler = api.__test.createPartAssembly(moduleCell, byId("push_connect_coupler_3_4"), { x: 340, y: 180 }); // NEW
    const push = api.__test.createAssemblyConnection(moduleCell, { cellId: api.__test.firstAssemblyPart(pushSource.assembly).getId(), role: "output", index: 0 }, { cellId: api.__test.firstAssemblyPart(pushCoupler.assembly).getId(), role: "input", index: 0 }); // NEW
    assert.equal(push.ok, true, push.reason); // NEW
    assert.equal(push.edge.getAttribute(api.attrs.PIPE_PART_ID), "poly_mainline_3_4"); // CHANGE
    const crossSource = api.__test.createSourceAssembly(moduleCell, "Cross source", { connectorType: "twist_lock", nominalSize: "3/4", pipeConnection: true, usableFlowGpm: 4, staticPressurePsi: 35 }, { x: 650, y: 40 }); // NEW
    const crossTarget = api.__test.createPartAssembly(moduleCell, byId("push_connect_coupler_3_4"), { x: 650, y: 180 }); // NEW
    const cross = api.__test.createAssemblyConnection(moduleCell, { cellId: api.__test.firstAssemblyPart(crossSource.assembly).getId(), role: "output", index: 0 }, { cellId: api.__test.firstAssemblyPart(crossTarget.assembly).getId(), role: "input", index: 0 }); // NEW
    assert.equal(cross.ok, true, cross.reason); // CHANGE
    assert.equal(cross.edge.getAttribute(api.attrs.PIPE_PART_ID), "poly_mainline_3_4"); // NEW
    const mismatchSource = api.__test.createSourceAssembly(moduleCell, "Mismatch source", { connectorType: "twist_lock", nominalSize: "3/4", pipeConnection: true, usableFlowGpm: 4, staticPressurePsi: 35 }, { x: 900, y: 40 }); // NEW
    const mismatchTarget = api.__test.createPartAssembly(moduleCell, byId("push_connect_coupler_1_2"), { x: 900, y: 180 }); // CHANGE
    const mismatch = api.__test.createAssemblyConnection(moduleCell, { cellId: api.__test.firstAssemblyPart(mismatchSource.assembly).getId(), role: "output", index: 0 }, { cellId: api.__test.firstAssemblyPart(mismatchTarget.assembly).getId(), role: "input", index: 0 }); // CHANGE
    assert.equal(mismatch.ok, false); // NEW
    assert.match(mismatch.reason, /Pipe Edge size mismatch/); // NEW
}); // NEW

test("hydraulics use minimum operating psi and warn over maximum operating psi", () => { // CHANGE
    const { api, model } = loadPlugin(); // CHANGE
    const catalog = { items: [part("spray", "Spray", "sprinkler", "in_stock", 10, 1, 1, "barb", "1/2", "barb", "1/2", { flowGpm: 1, minOperatingPressurePsi: 10, maxOperatingPressurePsi: 20, pressureLossPsi: 0 }, undefined, true)] }; // CHANGE
    const writesBeforeEstimate = model.valuesWritten; // NEW
    const result = api.__test.estimatePathHydraulics({ catalog, sourceProfile: { connectorType: "barb", nominalSize: "1/2", pipeConnection: true, usableFlowGpm: 2, staticPressurePsi: 45 }, bedDemand: { flowGpm: 1, operatingPressurePsi: 10 }, partIds: ["spray"], lengthFt: 0 }); // CHANGE
    assert.equal(model.valuesWritten, writesBeforeEstimate); // NEW
    assert.equal(result.requiredPressurePsi, 10); // CHANGE
    assert.equal(result.maxOperatingPressurePsi, 20); // CHANGE
    assert.match(result.warnings.join("\n"), /maximum operating pressure/); // CHANGE
}); // CHANGE

test("unit-cost line categories use route length when available", () => { // CHANGE
    const { api, moduleCell, bed, bed2 } = loadPlugin(); // CHANGE
    const catalog = { items: [part("dripline_costed", "Costed dripline", "dripline", "in_stock", 50, 1, 1, "barb", "1/2", "barb", "1/2", { flowGpm: 1, minOperatingPressurePsi: 10 }, 2, true)] }; // CHANGE
    const pathRecord = { sourceEndpointId: bed.getId(), targetEndpointId: bed2.getId() }; // CHANGE
    const lengthFt = api.__test.pathRouteLengthFeet(moduleCell, pathRecord); // CHANGE
    assert.ok(lengthFt > 0); // CHANGE
    assert.equal(api.__test.partCostForReport(moduleCell, catalog, pathRecord, "dripline_costed"), 2 * lengthFt); // CHANGE
}); // CHANGE

test("starter catalog upgrade merges new parts into existing catalogs without overwriting user edits", () => { // NEW
    const { api, moduleCell } = loadPlugin(); // NEW
    api.writeCatalog(moduleCell, { items: [ // NEW
        part("filter", "User Edited Filter", "filter", "in_stock", 99, 1, 1, "barb", "3/4", "barb", "3/4", { pressureLossPsi: 4 }), // NEW
        part("custom_micro", "Custom micro part", "fitting", "in_stock", 1, 1, 1, "barb", "1/4", "barb", "1/4", { pressureLossPsi: 0.1 }), // CHANGE
        part("twist_lock_tubing_custom", "Custom twist fitting with obsolete prefix", "fitting", "in_stock", 2, 1, 1, "twist_lock", "1/2", "twist_lock", "1/2", { pressureLossPsi: 0.1 }, undefined, true), // NEW
        part("twist_lock_tubing_1_2", "Obsolete twist tubing", "pipe_tubing", "in_stock", 0, 1, 1, "twist_lock", "1/2", "twist_lock", "1/2", { innerDiameterIn: 0.6 }, 0.4, true), // NEW
        part("push_connect_tubing_3_4", "Obsolete push tubing", "pipe_tubing", "in_stock", 0, 1, 1, "push_connect", "3/4", "push_connect", "3/4", { innerDiameterIn: 0.824 }, 0.5, true) // NEW
    ] }); // NEW
    const stored = JSON.parse(moduleCell.getAttribute(api.attrs.CATALOG_JSON)); // NEW
    stored.version = 1; // NEW
    moduleCell.value.setAttribute(api.attrs.CATALOG_JSON, JSON.stringify(stored)); // NEW
    const upgraded = api.seedStarterCatalogIfEmpty(moduleCell); // NEW
    const filter = upgraded.items.find(item => item.id === "filter"); // NEW
    assert.equal(upgraded.version, 4); // CHANGE
    assert.equal(filter.name, "User Edited Filter"); // NEW
    assert.equal(filter.cost, 99); // NEW
    assert.ok(upgraded.items.some(item => item.id === "poly_mainline_1")); // NEW
    assert.ok(upgraded.items.some(item => item.id === "micro_tubing_1_4")); // NEW
    assert.ok(upgraded.items.some(item => item.id === "twist_lock_adapter_1_4_to_1")); // NEW
    assert.ok(upgraded.items.some(item => item.id === "push_connect_adapter_1_to_1_4")); // NEW
    assert.ok(upgraded.items.some(item => item.id === "custom_micro")); // NEW
    assert.ok(upgraded.items.some(item => item.id === "twist_lock_tubing_custom")); // NEW
    assert.equal(upgraded.items.some(item => item.id === "twist_lock_tubing_1_2"), false); // NEW
    assert.equal(upgraded.items.some(item => item.id === "push_connect_tubing_3_4"), false); // NEW
}); // NEW

test("source commit creates one undoable edit at the latest click point and HUD follows zoom events", async () => { // CHANGE
    const { api, graph, model, moduleCell, actions } = loadPlugin(); // CHANGE
    api.writeCatalog(moduleCell, sampleCatalog()); // NEW
    actions.get("trellisIrrigationPlanner").funct(); // NEW
    assert.equal(graph.container.querySelector(".trellis-irrigation-source-form"), null); // NEW
    graph.fireMouseMove(310, 180); // NEW
    clickButton(graph.container, "Create Source"); // NEW
    assert.ok(graph.container.querySelector(".trellis-irrigation-source-form")); // NEW
    model.completedEdits = []; // NEW
    clickButton(graph.container, "Commit Source"); // NEW
    const sourceAssembly = assemblyCells(moduleCell, api)[0]; // NEW
    assert.equal(model.completedEdits.length, 1); // NEW
    assert.equal(sourceAssembly.getAttribute(api.attrs.ASSEMBLY_TYPE), "source"); // NEW
    assert.equal(sourceAssembly.geometry.x, 310); // NEW
    assert.equal(sourceAssembly.geometry.y, 180); // NEW
    assert.equal(graph.getSelectionCell(), sourceAssembly); // NEW
    const sourcePart = api.__test.firstAssemblyPart(sourceAssembly); // NEW
    assertAssemblyPartPlannerManagedStyle(sourcePart); // CHANGE
    const profile = JSON.parse(sourcePart.getAttribute(api.attrs.ENDPOINT_PROFILE_JSON)); // CHANGE
    assert.equal(profile.connectorType, "barb"); // CHANGE
    assert.equal(profile.pipeConnection, false); // CHANGE
    graph.view.scale = 1.4; // NEW
    graph.view.fire("scale"); // NEW
    assert.ok(graph.container.querySelector(".trellis-irrigation-mode-hud")); // NEW
    const writesAfterCommit = model.valuesWritten; // NEW
    await new Promise(resolve => setTimeout(resolve, 260)); // NEW
    assert.equal(model.valuesWritten, writesAfterCommit); // NEW
}); // NEW

test("irrigation mode exposes active state and normalizes invalid entry selection", () => { // NEW
    const { api, graph, moduleCell, document } = loadPlugin(); // NEW
    const group = appendChild(moduleCell, makeXmlCell(document, "plantGroup", { tiler_group: "1", label: "Lettuce" }, { x: 40, y: 40, width: 90, height: 60 })); // NEW
    graph.setSelectionCell(group); // NEW
    assert.equal(api.isIrrigationModeActive(), false); // NEW
    api.openIrrigationMode(moduleCell, { preserveViewport: true }); // NEW
    assert.equal(api.isIrrigationModeActive(), true); // NEW
    assert.equal(api.isIrrigationModeActive(moduleCell), true); // NEW
    assert.equal(api.getActiveIrrigationModule(), moduleCell); // NEW
    assert.equal(graph.getSelectionCell(), moduleCell); // NEW
    assert.match(graph.container.querySelector(".trellis-irrigation-mode-hud").textContent, /Irrigation Mode/); // NEW
    api.closeIrrigationMode(); // NEW
    assert.equal(api.isIrrigationModeActive(), false); // NEW
    assert.equal(api.getActiveIrrigationModule(), null); // NEW
    assert.equal(graph.container.querySelector(".trellis-irrigation-mode-hud"), null); // NEW
}); // NEW

test("irrigation mode HUD renders only for active-module irrigation selections", () => { // NEW
    const { api, graph, moduleCell, bed, root, document } = loadPlugin(); // NEW
    api.writeCatalog(moduleCell, sampleCatalog()); // NEW
    const otherModule = appendChild(root, makeXmlCell(document, "otherModule", { garden_module: "1", label: "Other" }, { x: 900, y: 0, width: 300, height: 220 })); // NEW
    const plantGroup = appendChild(moduleCell, makeXmlCell(document, "plantGroup", { tiler_group: "1", label: "Lettuce" }, { x: 40, y: 40, width: 90, height: 60 })); // NEW
    const assembly = api.__test.createPartAssembly(moduleCell, api.readCatalog(moduleCell).items.find(item => item.id === "filter"), { x: 30, y: 40 }).assembly; // NEW
    const source = api.__test.createSourceAssembly(moduleCell, "Well", { connectorType: "barb", nominalSize: "3/4", usableFlowGpm: 5, staticPressurePsi: 45 }, { x: 30, y: 180 }); // NEW
    const connection = api.__test.createAssemblyConnection(moduleCell, { cellId: api.__test.firstAssemblyPart(source.assembly).getId(), role: "output", index: 0 }, { cellId: api.__test.firstAssemblyPart(assembly).getId(), role: "input", index: 0 }); // NEW
    assert.equal(connection.ok, true, connection.reason); // NEW
    api.openIrrigationMode(moduleCell, { preserveViewport: true }); // NEW
    assert.match(graph.container.querySelector(".trellis-irrigation-mode-hud").textContent, /Irrigation Mode/); // NEW
    graph.setSelectionCell(bed); // NEW
    assert.match(graph.container.querySelector(".trellis-irrigation-mode-hud").textContent, /Garden Bed/); // NEW
    graph.setSelectionCell(assembly); // NEW
    assert.ok(graph.container.querySelector(".trellis-irrigation-local-hud")); // NEW
    graph.setSelectionCell(connection.edge); // NEW
    assert.ok(graph.container.querySelector(".trellis-irrigation-connection-hud")); // CHANGE
    assert.equal(inlineConnectionActions(graph.container).length, 0); // NEW
    assert.ok(buttonTexts(graph.container).includes("Disconnect")); // NEW
    graph.setSelectionCell(plantGroup); // NEW
    assert.equal(graph.container.querySelector(".trellis-irrigation-mode-hud"), null); // NEW
    graph.setSelectionCell(otherModule); // NEW
    assert.equal(graph.container.querySelector(".trellis-irrigation-mode-hud"), null); // NEW
}); // NEW

test("irrigation HUD no longer exposes Add Part placement controls", () => { // CHANGE
    const { api, graph, moduleCell, actions } = loadPlugin(); // CHANGE
    api.writeCatalog(moduleCell, sampleCatalog()); // NEW
    actions.get("trellisIrrigationPlanner").funct(); // NEW
    const header = irrigationHeader(graph.container); // NEW
    assert.deepEqual(buttonTexts(header), ["BOM", "Catalog", "Exit"]); // NEW
    assert.match(buttonByText(header, "BOM").getAttribute("style"), /border:\s*1px solid (?:#2563eb|rgb\(37,\s*99,\s*235\))/); // CHANGE
    assert.match(buttonByText(header, "Catalog").getAttribute("style"), /border:\s*1px solid (?:#2563eb|rgb\(37,\s*99,\s*235\))/); // CHANGE
    assert.equal(hudSectionTitles(graph.container).includes("Tools"), false); // NEW
    graph.fireMouseMove(360, 220); // NEW
    assert.equal(graph.container.querySelector(".trellis-irrigation-add-assembly-form"), null); // NEW
    assert.equal(graph.container.querySelector(".trellis-irrigation-add-part-picker"), null); // NEW
    assert.doesNotMatch(graph.container.textContent, /Add Part/); // CHANGE
    assert.match(graph.container.textContent, /Create Source/); // CHANGE
}); // NEW

test("selected inner assembly parts expose contextual bottom delete action", () => { // CHANGE
    const { api, graph, moduleCell } = loadPlugin(); // NEW
    api.writeCatalog(moduleCell, sampleCatalog()); // NEW
    const assembly = api.__test.createPartAssembly(moduleCell, api.readCatalog(moduleCell).items.find(item => item.id === "filter"), { x: 30, y: 40 }).assembly; // NEW
    const partCell = api.__test.firstAssemblyPart(assembly); // NEW
    api.openIrrigationMode(moduleCell, { preserveViewport: true }); // NEW
    graph.setSelectionCell(assembly); // NEW
    assert.equal(buttonTexts(graph.container).includes("Delete Part"), false); // NEW
    assert.equal(dangerButton(graph.container).textContent.trim(), "Delete Assembly"); // CHANGE
    graph.setSelectionCell(partCell); // NEW
    const buttons = buttonTexts(graph.container); // NEW
    assert.equal(buttons.includes("Delete Part"), true); // NEW
    assert.equal(dangerButton(graph.container).textContent.trim(), "Delete Part"); // NEW
    assert.equal(buttons.includes("Delete Assembly"), false); // CHANGE
    assert.equal(buttons.includes("Add Part"), false); // CHANGE
    assert.equal(buttons.includes("Reverse Assembly"), false); // NEW
}); // NEW

test("water source overlay title edits source and assembly labels", () => { // NEW
    const { api, graph, moduleCell, document } = loadPlugin(); // CHANGE
    api.writeCatalog(moduleCell, sampleCatalog()); // NEW
    const source = api.__test.createSourceAssembly(moduleCell, "Well", { connectorType: "barb", nominalSize: "3/4", usableFlowGpm: 5, staticPressurePsi: 45 }, { x: 30, y: 40 }); // NEW
    api.openIrrigationMode(moduleCell, { preserveViewport: true }); // NEW
    graph.setSelectionCell(source.assembly); // NEW
    let title = graph.container.querySelector(".trellis-irrigation-source-title-input"); // CHANGE
    assert.ok(title, "Missing editable water source title"); // NEW
    assert.ok(irrigationHeader(graph.container).contains(title)); // NEW
    assert.ok(graph.container.querySelector(".trellis-irrigation-source-edit")); // NEW
    assert.equal(buttonTexts(graph.container).includes("Add Part"), false); // NEW
    assert.match(buttonByText(graph.container, "Save Source").getAttribute("style"), /#188038|rgb\(24,\s*128,\s*56\)/); // CHANGE

    graph.setSelectionCell(source.source); // NEW
    title = graph.container.querySelector(".trellis-irrigation-source-title-input"); // NEW
    assert.ok(title, "Missing editable water source title for selected source endpoint"); // NEW
    assert.ok(graph.container.querySelector(".trellis-irrigation-source-edit")); // NEW

    const inlineAdapter = appendChild(source.assembly, makeXmlCell(document, "source_inline_adapter", { [api.attrs.COMPONENT]: "1", [api.attrs.COMPONENT_TYPE]: "fitting", [api.attrs.CATALOG_PART_ID]: "fpt_to_barb", label: "Inline adapter" }, { x: 20, y: 90, width: 150, height: 34 })); // NEW
    graph.setSelectionCell(inlineAdapter); // NEW
    assert.equal(graph.container.querySelector(".trellis-irrigation-source-title-input"), null); // NEW
    assert.equal(graph.container.querySelector(".trellis-irrigation-source-edit"), null); // NEW
    assert.match(irrigationHeader(graph.container).textContent, /Inline adapter/); // NEW
    assert.equal(buttonTexts(graph.container).includes("Delete Part"), true); // NEW

    graph.setSelectionCell(source.source); // NEW
    title = graph.container.querySelector(".trellis-irrigation-source-title-input"); // NEW
    title.value = "Main Water"; // NEW
    blurInput(title); // NEW
    assert.equal(source.assembly.getAttribute("label"), "Main Water"); // NEW
    assert.equal(source.source.getAttribute("label"), "Main Water"); // NEW
    assert.equal(JSON.parse(source.source.getAttribute(api.attrs.ENDPOINT_PROFILE_JSON)).label, "Main Water"); // NEW
}); // NEW

test("water source connector fields lock after downstream assembly connection", () => { // NEW
    const { api, graph, moduleCell } = loadPlugin(); // NEW
    api.writeCatalog(moduleCell, sampleCatalog()); // NEW
    const source = api.__test.createSourceAssembly(moduleCell, "Well", { connectorType: "barb", nominalSize: "3/4", usableFlowGpm: 5, staticPressurePsi: 45 }, { x: 30, y: 40 }); // NEW
    api.openIrrigationMode(moduleCell, { preserveViewport: true }); // NEW
    graph.setSelectionCell(source.assembly); // NEW
    assert.equal(selectByLabel(graph.container, "Connector").disabled, false); // NEW
    assert.equal(selectByLabel(graph.container, "Size").disabled, false); // NEW

    const filter = api.__test.createPartAssembly(moduleCell, api.readCatalog(moduleCell).items.find(item => item.id === "filter"), { x: 260, y: 40 }); // NEW
    const connection = api.__test.createAssemblyConnection(moduleCell, { cellId: api.__test.firstAssemblyPart(source.assembly).getId(), role: "output", index: 0 }, { cellId: api.__test.firstAssemblyPart(filter.assembly).getId(), role: "input", index: 0 }); // NEW
    assert.equal(connection.ok, true, connection.reason); // NEW
    graph.setSelectionCell(source.assembly); // NEW
    assert.equal(selectByLabel(graph.container, "Connector").disabled, true); // NEW
    assert.equal(selectByLabel(graph.container, "Size").disabled, true); // NEW
    assert.equal(inputByLabel(graph.container, "Flow gpm").disabled, false); // NEW
    assert.equal(inputByLabel(graph.container, "Static psi").disabled, false); // NEW
}); // NEW

test("water source connector fields lock when source assembly contains downstream parts", () => { // NEW
    const { api, graph, moduleCell, document } = loadPlugin(); // NEW
    api.writeCatalog(moduleCell, sampleCatalog()); // NEW
    const source = api.__test.createSourceAssembly(moduleCell, "Well", { connectorType: "barb", nominalSize: "3/4", usableFlowGpm: 5, staticPressurePsi: 45 }, { x: 30, y: 40 }); // NEW
    appendChild(source.assembly, makeXmlCell(document, "source_inline_adapter", { [api.attrs.COMPONENT]: "1", [api.attrs.COMPONENT_TYPE]: "fitting", [api.attrs.CATALOG_PART_ID]: "fpt_to_barb", label: "Inline adapter" }, { x: 20, y: 90, width: 150, height: 34 })); // NEW
    api.openIrrigationMode(moduleCell, { preserveViewport: true }); // NEW
    graph.setSelectionCell(source.assembly); // NEW
    assert.equal(selectByLabel(graph.container, "Connector").disabled, true); // NEW
    assert.equal(selectByLabel(graph.container, "Size").disabled, true); // NEW
}); // NEW

test("inner assembly parts remain selectable while native moves are guarded", () => { // NEW
    const { api, graph, moduleCell } = loadPlugin(); // NEW
    api.writeCatalog(moduleCell, sampleCatalog()); // NEW
    const assembly = api.__test.createPartAssembly(moduleCell, api.readCatalog(moduleCell).items.find(item => item.id === "filter"), { x: 30, y: 40 }).assembly; // NEW
    const partCell = api.__test.firstAssemblyPart(assembly); // NEW
    api.openIrrigationMode(moduleCell, { preserveViewport: true }); // NEW
    graph.setSelectionCell(partCell); // NEW
    assert.equal(graph.getSelectionCell(), partCell); // NEW
    assert.equal(buttonTexts(graph.container).includes("Delete Part"), true); // NEW
    const partGeometry = Object.assign({}, partCell.geometry); // NEW
    const childOrder = assembly.children.map(cell => cell.getId()); // NEW
    assert.deepEqual(graph.moveCells([partCell], 0, 80, false, null), [partCell]); // NEW
    assert.deepEqual(partCell.geometry, partGeometry); // NEW
    assert.deepEqual(assembly.children.map(cell => cell.getId()), childOrder); // NEW
    assert.equal(graph.movedCells, undefined); // NEW
    const assemblyGeometry = Object.assign({}, assembly.geometry); // NEW
    assert.deepEqual(graph.moveCells([assembly], 12, 18, false, null), [assembly]); // NEW
    assert.equal(assembly.geometry.x, assemblyGeometry.x + 12); // NEW
    assert.equal(assembly.geometry.y, assemblyGeometry.y + 18); // NEW
    const guardedPartGeometry = Object.assign({}, partCell.geometry); // NEW
    const movedAssemblyGeometry = Object.assign({}, assembly.geometry); // NEW
    assert.deepEqual(graph.moveCells([partCell, assembly], 7, 11, false, null), [assembly]); // NEW
    assert.deepEqual(partCell.geometry, guardedPartGeometry); // NEW
    assert.equal(assembly.geometry.x, movedAssemblyGeometry.x + 7); // NEW
    assert.equal(assembly.geometry.y, movedAssemblyGeometry.y + 11); // NEW
    assert.deepEqual(graph.movedCells.slice(-1), [assembly]); // NEW
}); // NEW

test("Delete Part splits downstream assembly and updates reports in one redoable edit", () => { // NEW
    const { api, graph, model, moduleCell, bed } = loadPlugin(); // NEW
    api.writeCatalog(moduleCell, sampleCatalog()); // NEW
    const catalog = api.readCatalog(moduleCell); // NEW
    const source = api.__test.createSourceAssembly(moduleCell, "Half inch source", { connectorType: "barb", nominalSize: "1/2", method: "drip", pipeConnection: true, usableFlowGpm: 5, staticPressurePsi: 45 }, { x: 30, y: 40 }); // NEW
    const assembly = api.__test.createPartAssembly(moduleCell, catalog.items.find(item => item.id === "pipe_half"), { x: 30, y: 160 }).assembly; // NEW
    const first = api.__test.firstAssemblyPart(assembly); // NEW
    const middleCreated = api.__test.createPartAssembly(moduleCell, catalog.items.find(item => item.id === "pipe_half"), { x: 260, y: 160 }); // NEW
    const lastCreated = api.__test.createPartAssembly(moduleCell, catalog.items.find(item => item.id === "pipe_half"), { x: 490, y: 160 }); // NEW
    const middle = middleCreated.partCell; // NEW
    const last = lastCreated.partCell; // NEW
    appendChild(assembly, middle); middle.parent = assembly; model.remove(middleCreated.assembly); // NEW
    appendChild(assembly, last); last.parent = assembly; model.remove(lastCreated.assembly); // NEW
    first.geometry.y = 44; middle.geometry.y = 94; last.geometry.y = 144; // NEW
    const bedAssembly = api.__test.createBedAssembly(moduleCell, bed, { x: 30, y: 360 }); // NEW
    assert.equal(api.__test.createAssemblyConnection(moduleCell, { cellId: api.__test.firstAssemblyPart(source.assembly).getId(), role: "output", index: 0 }, { cellId: first.getId(), role: "input", index: 0 }).ok, true); // NEW
    assert.equal(api.__test.createAssemblyConnection(moduleCell, { cellId: last.getId(), role: "output", index: 0 }, { cellId: bedAssembly.assembly.getId(), role: "input", index: 0 }).ok, true); // NEW
    assert.equal(api.__test.syncHudGraphState(moduleCell).length, 1); // NEW
    api.openIrrigationMode(moduleCell, { preserveViewport: true }); // NEW
    graph.setSelectionCell(middle); // NEW
    model.completedEdits = []; // NEW
    clickButton(graph.container, "Delete Part"); // NEW
    assert.equal(model.completedEdits.length, 1); // NEW
    assert.equal(JSON.stringify(api.__test.assemblyPartCells(assembly).map(cell => cell.getId())), JSON.stringify([first.getId()])); // CHANGE
    const disconnected = assemblyCells(moduleCell, api).find(cell => cell !== assembly && api.__test.assemblyPartCells(cell).some(partCell => partCell === last)); // NEW
    assert.ok(disconnected, "expected downstream parts to move into a disconnected assembly"); // NEW
    assert.equal(JSON.stringify(api.__test.assemblyPartCells(disconnected).map(cell => cell.getId())), JSON.stringify([last.getId()])); // CHANGE
    const disconnectedPaths = api.__test.syncHudGraphState(moduleCell); // CHANGE
    assert.equal(disconnectedPaths.length, 1); // CHANGE
    assert.equal(disconnectedPaths[0].disconnectedFromSource, true); // NEW
    assert.ok(moduleCell.getAttribute(api.attrs.REPORT_JSON)); // NEW
}); // NEW

test("context Add Part suppresses upstream singleton categories only after a source route exists", () => { // NEW
    const { api, moduleCell } = loadPlugin(); // NEW
    api.writeCatalog(moduleCell, sampleCatalog()); // NEW
    const disconnected = api.__test.createPartAssembly(moduleCell, api.readCatalog(moduleCell).items.find(item => item.id === "filter"), { x: 30, y: 40 }); // NEW
    let context = api.__test.addPartContextFromPort(moduleCell, { cellId: api.__test.firstAssemblyPart(disconnected.assembly).getId(), role: "output", index: 0 }); // NEW
    let ids = api.__test.addPartPickerParts({ moduleCell }, context).map(item => item.id); // NEW
    assert.ok(ids.includes("filter"), "Disconnected branches should not suppress singleton setup parts."); // NEW
    const source = api.__test.createSourceAssembly(moduleCell, "Source", { connectorType: "barb", nominalSize: "3/4", method: "drip", pipeConnection: true, usableFlowGpm: 5, staticPressurePsi: 45 }, { x: 30, y: 180 }); // NEW
    const connected = api.__test.createPartAssembly(moduleCell, api.readCatalog(moduleCell).items.find(item => item.id === "filter"), { x: 30, y: 320 }); // NEW
    const connection = api.__test.createAssemblyConnection(moduleCell, { cellId: api.__test.firstAssemblyPart(source.assembly).getId(), role: "output", index: 0 }, { cellId: api.__test.firstAssemblyPart(connected.assembly).getId(), role: "input", index: 0 }); // NEW
    assert.equal(connection.ok, true, connection.reason); // NEW
    context = api.__test.addPartContextFromPort(moduleCell, { cellId: api.__test.firstAssemblyPart(connected.assembly).getId(), role: "output", index: 0 }); // NEW
    ids = api.__test.addPartPickerParts({ moduleCell }, context).map(item => item.id); // NEW
    assert.equal(ids.includes("filter"), false); // NEW
    assert.ok(ids.includes("regulator")); // NEW
    assert.ok(ids.includes("valve")); // NEW
    assert.equal(api.__test.upstreamSingletonCategories(moduleCell, context.row).has("filter"), true); // NEW
}); // NEW

test("exposed assembly outlet Add Part filters out non-pipe inlet candidates", () => { // NEW
    const { api, moduleCell } = loadPlugin(); // NEW
    const catalog = { items: [ // NEW
        part("threaded_source", "Threaded Source", "valve", "in_stock", 10, 1, 1, "fpt", "3/4", "mpt", "3/4", { maxFlowGpm: 8 }), // NEW
        part("direct_filter", "Direct Filter", "filter", "in_stock", 10, 1, 1, "fpt", "3/4", "mpt", "3/4", { pressureLossPsi: 1 }) // NEW
    ] }; // NEW
    api.writeCatalog(moduleCell, catalog); // NEW
    const assembly = api.__test.createPartAssembly(moduleCell, catalog.items[0], { x: 30, y: 40 }).assembly; // NEW
    const source = api.__test.firstAssemblyPart(assembly); // NEW
    const context = api.__test.addPartContextFromPort(moduleCell, { cellId: source.getId(), role: "output", index: 0 }); // NEW
    const ids = api.__test.addPartPickerParts({ moduleCell }, context).map(item => item.id); // NEW
    assert.equal(ids.includes("direct_filter"), false); // NEW
    const result = api.__test.applyConnectionPartChoice(moduleCell, context.row, catalog.items[1]); // NEW
    assert.equal(result.cell, null); // NEW
    assert.match(result.message, /pipe-capable/); // NEW
}); // NEW

test("inactive irrigation selection shows entry button and opens irrigation mode", async () => { // NEW
    const { api, graph, moduleCell } = loadPlugin(); // NEW
    api.writeCatalog(moduleCell, sampleCatalog()); // NEW
    const assembly = api.__test.createPartAssembly(moduleCell, api.readCatalog(moduleCell).items.find(item => item.id === "filter"), { x: 30, y: 40 }).assembly; // NEW
    graph.setSelectionCell(assembly); // NEW
    await nextTick(); // NEW
    const entry = graph.container.querySelector(".trellis-irrigation-enter-mode"); // NEW
    assert.ok(entry); // NEW
    assert.equal(entry.textContent, "Enter Irrigation Design Mode"); // NEW
    entry.click(); // NEW
    assert.ok(graph.container.querySelector(".trellis-irrigation-mode-hud")); // NEW
    assert.equal(graph.container.querySelector(".trellis-irrigation-enter-mode"), null); // NEW
}); // NEW

test("selected part and assembly overlays render labeled connection rows with disabled empty choices", () => { // NEW
    const { api, graph, moduleCell, bed } = loadPlugin(); // NEW
    api.writeCatalog(moduleCell, sampleCatalog()); // NEW
    const assembly = api.__test.createPartAssembly(moduleCell, api.readCatalog(moduleCell).items.find(item => item.id === "filter"), { x: 30, y: 40 }).assembly; // NEW
    const regulator = api.__test.createPartAssembly(moduleCell, api.readCatalog(moduleCell).items.find(item => item.id === "regulator"), { x: 30, y: 160 }).partCell; // NEW
    appendChild(assembly, regulator); // NEW
    regulator.parent = assembly; // NEW
    regulator.geometry.y = 94; // NEW
    api.openIrrigationMode(moduleCell, { preserveViewport: true }); // NEW
    graph.setSelectionCell(api.__test.firstAssemblyPart(assembly)); // NEW
    assert.ok(connectionRow(graph.container, "Inlet 1")); // NEW
    assert.ok(connectionRow(graph.container, "Outlet 1")); // NEW
    graph.setSelectionCell(assembly); // NEW
    assert.equal(graph.container.querySelectorAll(".trellis-irrigation-connection-row").length, 2); // NEW
    const bedAssembly = api.__test.createBedAssembly(moduleCell, bed, { x: 320, y: 40 }); // NEW
    graph.setSelectionCell(bedAssembly.assembly); // CHANGE
    assert.equal(graph.container.querySelectorAll(".trellis-irrigation-connection-row").length, 0); // CHANGE
}); // NEW

test("connection combobox groups choices by safety and collapsible catalog category", () => { // NEW
    const { api, graph, moduleCell } = loadPlugin(); // NEW
    api.writeCatalog(moduleCell, sampleCatalog()); // NEW
    const assembly = api.__test.createPartAssembly(moduleCell, api.readCatalog(moduleCell).items.find(item => item.id === "filter"), { x: 30, y: 40 }).assembly; // NEW
    api.openIrrigationMode(moduleCell, { preserveViewport: true }); // NEW
    graph.setSelectionCell(api.__test.firstAssemblyPart(assembly)); // NEW
    const combobox = connectionCombobox(graph.container, "Outlet 1"); // CHANGE
    const trigger = combobox.querySelector(".trellis-irrigation-connection-combobox-trigger"); // NEW
    const hud = graph.container.querySelector(".trellis-irrigation-mode-hud"); // NEW
    trigger.getBoundingClientRect = () => ({ left: 310, right: 620, top: 520, bottom: 550, width: 310, height: 30 }); // NEW
    hud.getBoundingClientRect = () => ({ left: 200, right: 640, top: 380, bottom: 780, width: 440, height: 400 }); // NEW
    trigger.click(); // NEW
    const panel = connectionComboboxPanel(combobox); // NEW
    assert.equal(panel.parentNode, graph.container.ownerDocument.body); // NEW
    assert.equal(panel.style.position, "fixed"); // NEW
    assert.equal(panel.style.left, "200px"); // NEW
    assert.equal(panel.style.width, "440px"); // NEW
    assert.equal(panel.querySelector(".trellis-irrigation-connection-combobox-safety-label").textContent, "Keeps connection"); // CHANGE
    const categoryLabels = Array.from(panel.querySelectorAll(".trellis-irrigation-connection-combobox-category")).map(node => node.textContent.replace(/^[>v] /, "").replace(/ \(.+\)$/, "")); // CHANGE
    assert.deepEqual(categoryLabels, ["filter", "regulator", "valve", "fitting", "drip tape"]); // CHANGE
    assert.deepEqual(connectionComboboxOptionIds(combobox), ["filter"]); // NEW
    const regulatorCategory = Array.from(panel.querySelectorAll(".trellis-irrigation-connection-combobox-category")).find(node => node.textContent.includes("regulator")); // NEW
    regulatorCategory.focus(); // NEW
    regulatorCategory.click(); // CHANGE
    assert.ok(connectionComboboxPanel(combobox), "Category toggles should keep the combobox open"); // NEW
    assert.ok(connectionComboboxPanel(combobox).contains(graph.container.ownerDocument.activeElement), "Category toggles should restore focus inside the combobox"); // NEW
    assert.deepEqual(connectionComboboxOptionIds(combobox), ["filter", "regulator"]); // NEW
}); // NEW

test("connection combobox persists collapsed category state per user", () => { // NEW
    const { api, graph, moduleCell } = loadPlugin(); // NEW
    api.writeCatalog(moduleCell, sampleCatalog()); // NEW
    const assembly = api.__test.createPartAssembly(moduleCell, api.readCatalog(moduleCell).items.find(item => item.id === "filter"), { x: 30, y: 40 }).assembly; // NEW
    api.openIrrigationMode(moduleCell, { preserveViewport: true }); // NEW
    graph.setSelectionCell(api.__test.firstAssemblyPart(assembly)); // NEW
    let combobox = openConnectionCombobox(graph.container, "Outlet 1"); // NEW
    connectionComboboxPanel(combobox).querySelector(".trellis-irrigation-connection-combobox-category").click(); // CHANGE
    assert.equal(connectionComboboxOptionIds(combobox).includes("filter"), false); // NEW
    graph.setSelectionCell(api.__test.firstAssemblyPart(assembly)); // NEW
    combobox = openConnectionCombobox(graph.container, "Outlet 1"); // NEW
    assert.equal(connectionComboboxOptionIds(combobox).includes("filter"), false); // NEW
    assert.match(graph.container.ownerDocument.defaultView.localStorage.getItem("trellis.irrigation.connectionCombobox.collapsed.v1"), /"keep:filter":true/); // NEW
}); // NEW

test("connection combobox search reveals matching collapsed categories", () => { // NEW
    const { api, graph, moduleCell } = loadPlugin(); // NEW
    api.writeCatalog(moduleCell, sampleCatalog()); // NEW
    const assembly = api.__test.createPartAssembly(moduleCell, api.readCatalog(moduleCell).items.find(item => item.id === "filter"), { x: 30, y: 40 }).assembly; // NEW
    api.openIrrigationMode(moduleCell, { preserveViewport: true }); // NEW
    graph.setSelectionCell(api.__test.firstAssemblyPart(assembly)); // NEW
    const combobox = openConnectionCombobox(graph.container, "Outlet 1"); // NEW
    const search = connectionComboboxPanel(combobox).querySelector(".trellis-irrigation-connection-combobox-search"); // CHANGE
    search.value = "drip"; // NEW
    search.dispatchEvent(new graph.container.ownerDocument.defaultView.Event("input", { bubbles: true })); // NEW
    assert.deepEqual(connectionComboboxOptionIds(combobox), ["drip_tape"]); // NEW
    search.value = "barb"; // NEW
    search.dispatchEvent(new graph.container.ownerDocument.defaultView.Event("input", { bubbles: true })); // NEW
    assert.ok(connectionComboboxOptionIds(combobox).includes("regulator")); // NEW
    search.value = "3/4"; // NEW
    search.dispatchEvent(new graph.container.ownerDocument.defaultView.Event("input", { bubbles: true })); // NEW
    assert.ok(connectionComboboxOptionIds(combobox).includes("valve")); // NEW
}); // NEW

test("connection combobox keyboard, focus loss, and outside-click interactions do not write diagram state", async () => { // CHANGE
    const { api, graph, model, moduleCell } = loadPlugin(); // NEW
    api.writeCatalog(moduleCell, sampleCatalog()); // NEW
    const assembly = api.__test.createPartAssembly(moduleCell, api.readCatalog(moduleCell).items.find(item => item.id === "filter"), { x: 30, y: 40 }).assembly; // NEW
    api.openIrrigationMode(moduleCell, { preserveViewport: true }); // NEW
    graph.setSelectionCell(api.__test.firstAssemblyPart(assembly)); // NEW
    const writesBeforeOpen = model.valuesWritten; // NEW
    let combobox = openConnectionCombobox(graph.container, "Outlet 1"); // NEW
    const search = connectionComboboxPanel(combobox).querySelector(".trellis-irrigation-connection-combobox-search"); // CHANGE
    search.dispatchEvent(new graph.container.ownerDocument.defaultView.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); // NEW
    assert.equal(graph.container.ownerDocument.querySelector(".trellis-irrigation-connection-combobox-panel"), null); // CHANGE
    combobox = openConnectionCombobox(graph.container, "Outlet 1"); // NEW
    const focusSearch = connectionComboboxPanel(combobox).querySelector(".trellis-irrigation-connection-combobox-search"); // NEW
    const outsideInput = graph.container.ownerDocument.createElement("input"); // NEW
    graph.container.ownerDocument.body.appendChild(outsideInput); // NEW
    outsideInput.focus(); // NEW
    focusSearch.dispatchEvent(new graph.container.ownerDocument.defaultView.FocusEvent("focusout", { bubbles: true })); // NEW
    await nextTick(); // NEW
    assert.equal(graph.container.ownerDocument.querySelector(".trellis-irrigation-connection-combobox-panel"), null); // NEW
    assert.equal(model.valuesWritten, writesBeforeOpen); // NEW
    combobox = openConnectionCombobox(graph.container, "Outlet 1"); // NEW
    graph.container.ownerDocument.body.dispatchEvent(new graph.container.ownerDocument.defaultView.MouseEvent("mousedown", { bubbles: true })); // NEW
    assert.equal(graph.container.ownerDocument.querySelector(".trellis-irrigation-connection-combobox-panel"), null); // CHANGE
    combobox = openConnectionCombobox(graph.container, "Outlet 1"); // NEW
    const searchAgain = connectionComboboxPanel(combobox).querySelector(".trellis-irrigation-connection-combobox-search"); // CHANGE
    searchAgain.dispatchEvent(new graph.container.ownerDocument.defaultView.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true })); // NEW
    graph.container.ownerDocument.activeElement.dispatchEvent(new graph.container.ownerDocument.defaultView.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })); // NEW
    assert.notDeepEqual(api.__test.assemblyPartCells(assembly).map(cell => cell.getAttribute(api.attrs.CATALOG_PART_ID)), ["filter"]); // NEW
    assert.equal(model.valuesWritten > writesBeforeOpen, true); // NEW
}); // NEW

test("connection dropdown creates external pipe assemblies and makes occupied pipe rows read-only", () => { // FIX
    const { api, graph, moduleCell } = loadPlugin(); // NEW
    api.writeCatalog(moduleCell, sampleCatalog()); // NEW
    const assembly = api.__test.createPartAssembly(moduleCell, api.readCatalog(moduleCell).items.find(item => item.id === "filter"), { x: 30, y: 40 }).assembly; // NEW
    api.openIrrigationMode(moduleCell, { preserveViewport: true }); // NEW
    graph.setSelectionCell(api.__test.firstAssemblyPart(assembly)); // NEW
    chooseConnectionPart(graph.container, "Outlet 1", "regulator"); // NEW
    assert.equal(JSON.stringify(api.__test.assemblyPartCells(assembly).map(cell => cell.getAttribute(api.attrs.CATALOG_PART_ID))), JSON.stringify(["filter"])); // FIX
    const downstream = assemblyCells(moduleCell, api).find(cell => cell !== assembly && api.__test.firstAssemblyPart(cell).getAttribute(api.attrs.CATALOG_PART_ID) === "regulator"); // FIX
    assert.ok(downstream); // FIX
    const edge = api.__test.collectAssemblyEdges(moduleCell)[0]; // FIX
    assert.ok(edge); // FIX
    assert.equal(edge.getAttribute(api.attrs.PIPE_EDGE), "1"); // FIX
    assert.equal(edge.source, api.__test.firstAssemblyPart(assembly)); // FIX
    assert.equal(edge.target, api.__test.firstAssemblyPart(downstream)); // FIX
    graph.setSelectionCell(api.__test.firstAssemblyPart(assembly)); // NEW
    assertConnectionRowReadOnly(graph.container, "Outlet 1"); // CHANGE
    assert.equal(JSON.stringify(api.__test.assemblyPartCells(assembly).map(cell => cell.getAttribute(api.attrs.CATALOG_PART_ID))), JSON.stringify(["filter"])); // FIX
    assert.equal(assemblyCells(moduleCell, api).filter(cell => cell.getAttribute(api.attrs.ASSEMBLY_TYPE) === "parts").length, 2); // FIX
}); // NEW

test("first assembly inlet direct Add Part inserts at the start of the assembly", () => { // NEW
    const { api, moduleCell } = loadPlugin(); // NEW
    const catalog = { items: [ // NEW
        part("direct_downstream", "Direct Downstream", "filter", "in_stock", 10, 1, 1, "fpt", "3/4", "mpt", "3/4", { pressureLossPsi: 1 }), // NEW
        part("direct_upstream", "Direct Upstream", "fitting", "in_stock", 4, 1, 1, "fght", "3/4", "mpt", "3/4", { pressureLossPsi: 0.2 }) // NEW
    ] }; // NEW
    api.writeCatalog(moduleCell, catalog); // NEW
    const assembly = api.__test.createPartAssembly(moduleCell, catalog.items[0], { x: 30, y: 40 }).assembly; // NEW
    const downstream = api.__test.firstAssemblyPart(assembly); // NEW
    const result = api.__test.applyConnectionPartChoice(moduleCell, { cell: downstream, role: "input", index: 0 }, catalog.items[1]); // NEW
    assert.ok(result.cell, result.message); // NEW
    assert.equal(JSON.stringify(api.__test.assemblyPartCells(assembly).map(cell => cell.getAttribute(api.attrs.CATALOG_PART_ID))), JSON.stringify(["direct_upstream", "direct_downstream"])); // NEW
    assert.equal(api.__test.collectAssemblyEdges(moduleCell).length, 0); // NEW
}); // NEW

test("selected inlet dropdown inserts direct parts at the start of the assembly", () => { // CHANGE
    const { api, graph, moduleCell } = loadPlugin(); // NEW
    const catalog = { items: [ // NEW
        part("direct_downstream", "Direct Downstream", "filter", "in_stock", 10, 1, 1, "fpt", "3/4", "mpt", "3/4", { pressureLossPsi: 1 }), // NEW
        part("direct_upstream", "Direct Upstream", "fitting", "in_stock", 4, 1, 1, "fght", "3/4", "mpt", "3/4", { pressureLossPsi: 0.2 }) // NEW
    ] }; // NEW
    api.writeCatalog(moduleCell, catalog); // NEW
    const assembly = api.__test.createPartAssembly(moduleCell, catalog.items[0], { x: 30, y: 40 }).assembly; // NEW
    api.openIrrigationMode(moduleCell, { preserveViewport: true }); // NEW
    graph.setSelectionCell(assembly); // NEW
    assert.equal(buttonTexts(graph.container).includes("Add Part"), false); // NEW
    chooseConnectionPart(graph.container, "Inlet 1", "direct_upstream"); // CHANGE
    assert.equal(JSON.stringify(api.__test.assemblyPartCells(assembly).map(cell => cell.getAttribute(api.attrs.CATALOG_PART_ID))), JSON.stringify(["direct_upstream", "direct_downstream"])); // NEW
    assert.equal(api.__test.collectAssemblyEdges(moduleCell).length, 0); // NEW
}); // NEW

test("first assembly inlet pipe Add Part creates a separate upstream assembly", () => { // NEW
    const { api, moduleCell } = loadPlugin(); // NEW
    const catalog = sampleCatalog(); // NEW
    api.writeCatalog(moduleCell, catalog); // NEW
    const assembly = api.__test.createPartAssembly(moduleCell, catalog.items.find(item => item.id === "filter"), { x: 30, y: 180 }).assembly; // NEW
    const filter = api.__test.firstAssemblyPart(assembly); // NEW
    const result = api.__test.applyConnectionPartChoice(moduleCell, { cell: filter, role: "input", index: 0 }, catalog.items.find(item => item.id === "regulator")); // NEW
    assert.ok(result.cell, result.message); // NEW
    assert.equal(JSON.stringify(api.__test.assemblyPartCells(assembly).map(cell => cell.getAttribute(api.attrs.CATALOG_PART_ID))), JSON.stringify(["filter"])); // NEW
    const upstreamAssembly = assemblyCells(moduleCell, api).find(cell => cell !== assembly && api.__test.firstAssemblyPart(cell).getAttribute(api.attrs.CATALOG_PART_ID) === "regulator"); // NEW
    assert.ok(upstreamAssembly, "expected added pipe part to live in a separate upstream assembly"); // NEW
    const edge = api.__test.collectAssemblyEdges(moduleCell).find(edge => edge.source === api.__test.firstAssemblyPart(upstreamAssembly) && edge.target === filter); // NEW
    assert.ok(edge, "expected upstream assembly to connect to the original inlet"); // NEW
    assert.equal(edge.getAttribute(api.attrs.PIPE_EDGE), "1"); // NEW
    assert.equal(edge.getAttribute(api.attrs.PIPE_PART_ID), "pipe_cheap"); // NEW
}); // NEW

test("internal assembly inlets stay read-only after a direct inlet insertion", () => { // NEW
    const { api, graph, moduleCell } = loadPlugin(); // NEW
    const catalog = { items: [ // NEW
        part("direct_downstream", "Direct Downstream", "filter", "in_stock", 10, 1, 1, "fpt", "3/4", "mpt", "3/4", { pressureLossPsi: 1 }), // NEW
        part("direct_upstream", "Direct Upstream", "fitting", "in_stock", 4, 1, 1, "fght", "3/4", "mpt", "3/4", { pressureLossPsi: 0.2 }) // NEW
    ] }; // NEW
    api.writeCatalog(moduleCell, catalog); // NEW
    const assembly = api.__test.createPartAssembly(moduleCell, catalog.items[0], { x: 30, y: 40 }).assembly; // NEW
    const downstream = api.__test.firstAssemblyPart(assembly); // NEW
    api.__test.applyConnectionPartChoice(moduleCell, { cell: downstream, role: "input", index: 0 }, catalog.items[1]); // NEW
    api.openIrrigationMode(moduleCell, { preserveViewport: true }); // NEW
    graph.setSelectionCell(downstream); // NEW
    assertConnectionRowReadOnly(graph.container, "Inlet 1"); // NEW
}); // NEW

test("selected port badges connect with automatic pipe choice and disconnect selected connections", () => { // NEW
    const { api, graph, moduleCell } = loadPlugin(); // NEW
    api.writeCatalog(moduleCell, sampleCatalog()); // NEW
    const source = api.__test.createSourceAssembly(moduleCell, "Well", { connectorType: "barb", nominalSize: "3/4", method: "drip", pipeConnection: true, usableFlowGpm: 5, staticPressurePsi: 45 }, { x: 30, y: 40 }); // CHANGE
    const filter = api.__test.createPartAssembly(moduleCell, api.readCatalog(moduleCell).items.find(item => item.id === "filter"), { x: 30, y: 180 }); // NEW
    api.openIrrigationMode(moduleCell, { preserveViewport: true }); // NEW
    graph.setSelectionCells([source.assembly, filter.assembly]); // NEW
    clickPort(graph.container, /Outlet 1 free/); // NEW
    clickPort(graph.container, /Inlet 1 free/); // NEW
    assert.equal(graph.container.querySelector(".trellis-irrigation-mode-hud"), null); // NEW
    assert.equal(inlineConnectionActions(graph.container).length, 1); // NEW
    assert.equal(inlineConnectionActions(graph.container)[0].textContent, "Connect"); // NEW
    assert.equal(buttonTexts(graph.container).filter(text => text === "Connect").length, 1); // NEW
    assert.equal(buttonTexts(graph.container).includes("Suggest Connection"), false); // NEW
    clickButton(graph.container, "Connect"); // NEW
    const edge = api.__test.collectAssemblyEdges(moduleCell)[0]; // NEW
    assert.ok(edge); // NEW
    assert.equal(edge.getAttribute(api.attrs.PIPE_PART_ID), "pipe_cheap"); // NEW
    assert.equal(edge.getAttribute("label"), "3/4"); // NEW
    graph.setSelectionCell(source.assembly); // NEW
    const outletRow = assertConnectionRowReadOnly(graph.container, "Outlet 1"); // NEW
    assert.equal(outletRow.querySelector(".trellis-irrigation-pipe-row"), null); // NEW
    assert.doesNotMatch(outletRow.textContent, /Pipe:|cheap poly|planned|completed|Part added/i); // NEW
    graph.setSelectionCell(edge); // NEW
    assertConnectionHud(graph.container, /Pipe:\s*3\/4/); // CHANGE
    assert.equal(inlineConnectionActions(graph.container).length, 0); // NEW
    graph.setSelectionCells([source.assembly, filter.assembly]); // NEW
    clickPort(graph.container, /Outlet 1 connected/); // NEW
    assert.ok(portBadgesInState(graph.container, "selected").length >= 2); // CHANGE
    assertInlineConnectionAction(graph.container, "Disconnect"); // CHANGE
    assert.equal(buttonTexts(graph.container).includes("Disconnect Parts"), false); // NEW
    clickButton(graph.container, "Disconnect"); // CHANGE
    assert.equal(api.__test.collectAssemblyEdges(moduleCell).length, 0); // NEW
}); // NEW

test("same-role free badges show Flip and Connect and flip the lower disconnected fitting", () => { // NEW
    const { api, graph, moduleCell } = loadPlugin(); // NEW
    const catalog = flipConnectCatalog(); // NEW
    api.writeCatalog(moduleCell, catalog); // NEW
    const upper = api.__test.createPartAssembly(moduleCell, catalog.items.find(item => item.id === "male_out_fit"), { x: 30, y: 40 }); // NEW
    const lower = api.__test.createPartAssembly(moduleCell, catalog.items.find(item => item.id === "female_out_fit"), { x: 30, y: 180 }); // NEW
    const upperPart = api.__test.firstAssemblyPart(upper.assembly); // NEW
    const lowerPart = api.__test.firstAssemblyPart(lower.assembly); // NEW
    assert.equal(api.__test.connectionDecisionForPorts(moduleCell, { cellId: upperPart.getId(), role: "output", index: 0 }, { cellId: lowerPart.getId(), role: "output", index: 0 }).ok, false); // NEW
    assert.equal(api.__test.flipConnectPlanForPorts(moduleCell, [{ cellId: upperPart.getId(), role: "output", index: 0 }, { cellId: lowerPart.getId(), role: "output", index: 0 }]).flipCell, lowerPart); // NEW
    api.openIrrigationMode(moduleCell, { preserveViewport: true }); // NEW
    graph.setSelectionCells([upper.assembly, lower.assembly]); // NEW
    clickPort(graph.container, /Outlet 1 free.*MGHT/); // NEW
    assert.equal(portBadgesInState(graph.container, "compatible").some(node => /Outlet 1 free compatible.*FGHT/.test(node.title)), true); // NEW
    clickPort(graph.container, /Outlet 1 free.*FGHT/); // NEW
    assert.equal(buttonTexts(graph.container).filter(text => text === "Connect").length, 0); // NEW
    assertInlineConnectionAction(graph.container, "Flip and Connect"); // NEW
    clickButton(graph.container, "Flip and Connect"); // NEW
    assert.equal(api.__test.isPartCellFlipped(lowerPart), true); // NEW
    assert.equal(api.__test.isPartCellFlipped(upperPart), false); // NEW
    assert.equal(lowerPart.parent, upper.assembly); // NEW
}); // NEW

test("Flip and Connect flips the disconnected other fitting when one selected part is connected", () => { // NEW
    const { api, graph, moduleCell } = loadPlugin(); // NEW
    const catalog = flipConnectCatalog(); // NEW
    api.writeCatalog(moduleCell, catalog); // NEW
    const source = api.__test.createSourceAssembly(moduleCell, "Hose", { connectorType: "mght", nominalSize: "3/4", usableFlowGpm: 5, staticPressurePsi: 45 }, { x: 30, y: 40 }); // NEW
    const upper = api.__test.createPartAssembly(moduleCell, catalog.items.find(item => item.id === "male_out_fit"), { x: 30, y: 180 }); // NEW
    const upperPart = api.__test.firstAssemblyPart(upper.assembly); // NEW
    assert.equal(api.__test.createAssemblyConnection(moduleCell, { cellId: api.__test.firstAssemblyPart(source.assembly).getId(), role: "output", index: 0 }, { cellId: upperPart.getId(), role: "input", index: 0 }).ok, true); // NEW
    const lower = api.__test.createPartAssembly(moduleCell, catalog.items.find(item => item.id === "female_out_fit"), { x: 300, y: 180 }); // NEW
    const lowerPart = api.__test.firstAssemblyPart(lower.assembly); // NEW
    const plan = api.__test.flipConnectPlanForPorts(moduleCell, [{ cellId: upperPart.getId(), role: "output", index: 0 }, { cellId: lowerPart.getId(), role: "output", index: 0 }]); // NEW
    assert.equal(plan.ok, true, plan.reason); // NEW
    assert.equal(plan.flipCell, lowerPart); // NEW
    api.openIrrigationMode(moduleCell, { preserveViewport: true }); // NEW
    graph.setSelectionCells([source.assembly, lower.assembly]); // NEW
    clickPort(graph.container, /Outlet 1 free.*MGHT/); // NEW
    clickPort(graph.container, /Outlet 1 free.*FGHT/); // NEW
    clickButton(graph.container, "Flip and Connect"); // NEW
    assert.equal(api.__test.isPartCellFlipped(lowerPart), true); // NEW
    assert.equal(api.__test.isPartCellFlipped(upperPart), false); // NEW
    assert.equal(lowerPart.parent, source.assembly); // NEW
}); // NEW

test("Flip and Connect is hidden when both selected parts already have any connection", () => { // NEW
    const { api, graph, moduleCell } = loadPlugin(); // NEW
    const catalog = flipConnectCatalog(); // NEW
    api.writeCatalog(moduleCell, catalog); // NEW
    const sourceA = api.__test.createSourceAssembly(moduleCell, "Hose A", { connectorType: "mght", nominalSize: "3/4", usableFlowGpm: 5, staticPressurePsi: 45 }, { x: 30, y: 40 }); // NEW
    const sourceB = api.__test.createSourceAssembly(moduleCell, "Hose B", { connectorType: "mght", nominalSize: "3/4", usableFlowGpm: 5, staticPressurePsi: 45 }, { x: 300, y: 40 }); // NEW
    const upper = api.__test.createPartAssembly(moduleCell, catalog.items.find(item => item.id === "male_out_fit"), { x: 30, y: 180 }); // NEW
    const lower = api.__test.createPartAssembly(moduleCell, catalog.items.find(item => item.id === "female_out_fit"), { x: 300, y: 180 }); // NEW
    const upperPart = api.__test.firstAssemblyPart(upper.assembly); // NEW
    const lowerPart = api.__test.firstAssemblyPart(lower.assembly); // NEW
    assert.equal(api.__test.createAssemblyConnection(moduleCell, { cellId: api.__test.firstAssemblyPart(sourceA.assembly).getId(), role: "output", index: 0 }, { cellId: upperPart.getId(), role: "input", index: 0 }).ok, true); // NEW
    assert.equal(api.__test.createAssemblyConnection(moduleCell, { cellId: api.__test.firstAssemblyPart(sourceB.assembly).getId(), role: "output", index: 0 }, { cellId: lowerPart.getId(), role: "input", index: 0 }).ok, true); // NEW
    const plan = api.__test.flipConnectPlanForPorts(moduleCell, [{ cellId: upperPart.getId(), role: "output", index: 0 }, { cellId: lowerPart.getId(), role: "output", index: 0 }]); // NEW
    assert.equal(plan.ok, false); // NEW
    assert.match(plan.reason, /Both selected parts/); // NEW
    api.openIrrigationMode(moduleCell, { preserveViewport: true }); // NEW
    graph.setSelectionCells([sourceA.assembly, sourceB.assembly]); // NEW
    clickPort(graph.container, /Outlet 1 free.*MGHT/); // NEW
    clickPort(graph.container, /Outlet 1 free.*FGHT/); // NEW
    assert.equal(buttonTexts(graph.container).includes("Flip and Connect"), false); // NEW
    assert.equal(buttonTexts(graph.container).filter(text => text === "Connect").length, 0); // NEW
}); // NEW

test("Flip and Connect falls back to the only flippable fitting when the lower preferred part is not reversible", () => { // NEW
    const { api, graph, moduleCell } = loadPlugin(); // NEW
    const catalog = flipConnectCatalog(); // NEW
    api.writeCatalog(moduleCell, catalog); // NEW
    const upper = api.__test.createPartAssembly(moduleCell, catalog.items.find(item => item.id === "male_out_fit"), { x: 30, y: 40 }); // NEW
    const lower = api.__test.createPartAssembly(moduleCell, catalog.items.find(item => item.id === "female_out_filter"), { x: 30, y: 220 }); // NEW
    const upperPart = api.__test.firstAssemblyPart(upper.assembly); // NEW
    const lowerPart = api.__test.firstAssemblyPart(lower.assembly); // NEW
    const plan = api.__test.flipConnectPlanForPorts(moduleCell, [{ cellId: upperPart.getId(), role: "output", index: 0 }, { cellId: lowerPart.getId(), role: "output", index: 0 }]); // NEW
    assert.equal(plan.ok, true, plan.reason); // NEW
    assert.equal(plan.flipCell, upperPart); // NEW
    api.openIrrigationMode(moduleCell, { preserveViewport: true }); // NEW
    graph.setSelectionCells([upper.assembly, lower.assembly]); // NEW
    clickPort(graph.container, /Outlet 1 free.*MGHT/); // NEW
    clickPort(graph.container, /Outlet 1 free.*FGHT/); // NEW
    clickButton(graph.container, "Flip and Connect"); // NEW
    assert.equal(api.__test.isPartCellFlipped(upperPart), true); // NEW
    assert.equal(api.__test.isPartCellFlipped(lowerPart), false); // NEW
    assert.equal(upperPart.parent, lower.assembly); // NEW
}); // NEW

test("only one-inlet one-outlet fittings are reversible for flip and connect", () => { // NEW
    const { api, moduleCell } = loadPlugin(); // NEW
    const catalog = flipConnectCatalog(); // NEW
    api.writeCatalog(moduleCell, catalog); // NEW
    assert.equal(api.__test.isReversibleFittingPart(catalog.items.find(item => item.id === "male_out_fit")), true); // NEW
    assert.equal(api.__test.isReversibleFittingPart(catalog.items.find(item => item.id === "female_out_filter")), false); // NEW
    const first = api.__test.createPartAssembly(moduleCell, catalog.items.find(item => item.id === "female_out_filter"), { x: 30, y: 40 }); // NEW
    const second = api.__test.createPartAssembly(moduleCell, catalog.items.find(item => item.id === "female_out_filter"), { x: 30, y: 180 }); // NEW
    const firstPart = api.__test.firstAssemblyPart(first.assembly); // NEW
    const secondPart = api.__test.firstAssemblyPart(second.assembly); // NEW
    const plan = api.__test.flipConnectPlanForPorts(moduleCell, [{ cellId: firstPart.getId(), role: "output", index: 0 }, { cellId: secondPart.getId(), role: "output", index: 0 }]); // NEW
    assert.equal(plan.ok, false); // NEW
    assert.match(plan.reason, /No reversible fitting/); // NEW
}); // NEW

test("flipped fitting instances swap connector roles and vertical badge positions", () => { // NEW
    const { api, graph, moduleCell } = loadPlugin(); // NEW
    const catalog = flipConnectCatalog(); // NEW
    api.writeCatalog(moduleCell, catalog); // NEW
    const assembly = api.__test.createPartAssembly(moduleCell, catalog.items.find(item => item.id === "male_out_fit"), { x: 30, y: 120 }); // NEW
    const partCell = api.__test.firstAssemblyPart(assembly.assembly); // NEW
    assert.equal(api.__test.portConnectorForCell(moduleCell, partCell, "input").type, "fght"); // NEW
    assert.equal(api.__test.portConnectorForCell(moduleCell, partCell, "output").type, "mght"); // NEW
    api.__test.setPartCellFlipped(partCell, true); // NEW
    assert.equal(api.__test.portConnectorForCell(moduleCell, partCell, "input").type, "mght"); // NEW
    assert.equal(api.__test.portConnectorForCell(moduleCell, partCell, "output").type, "fght"); // NEW
    api.openIrrigationMode(moduleCell, { preserveViewport: true }); // NEW
    graph.setSelectionCell(assembly.assembly); // NEW
    const inlet = portBadges(graph.container).find(node => /Inlet 1 free/.test(node.title)); // NEW
    const outlet = portBadges(graph.container).find(node => /Outlet 1 free/.test(node.title)); // NEW
    assert.ok(inlet, "expected inlet badge"); // NEW
    assert.ok(outlet, "expected outlet badge"); // NEW
    assert.ok(parseInt(inlet.style.top, 10) > parseInt(outlet.style.top, 10), "flipped inlet badge should render below flipped outlet badge"); // NEW
}); // NEW

test("connection HUD hides port row and updates pipe edge style", () => { // NEW
    const { api, graph, moduleCell } = loadPlugin(); // NEW
    api.writeCatalog(moduleCell, sampleCatalog()); // NEW
    const source = api.__test.createSourceAssembly(moduleCell, "Well", { connectorType: "barb", nominalSize: "3/4", method: "drip", pipeConnection: true, usableFlowGpm: 5, staticPressurePsi: 45 }, { x: 30, y: 40 }); // NEW
    const filter = api.__test.createPartAssembly(moduleCell, api.readCatalog(moduleCell).items.find(item => item.id === "filter"), { x: 30, y: 180 }); // NEW
    const connection = api.__test.createAssemblyConnection(moduleCell, { cellId: api.__test.firstAssemblyPart(source.assembly).getId(), role: "output", index: 0 }, { cellId: api.__test.firstAssemblyPart(filter.assembly).getId(), role: "input", index: 0 }); // NEW
    assert.equal(connection.ok, true, connection.reason); // NEW
    const edge = connection.edge; // NEW
    api.openIrrigationMode(moduleCell, { preserveViewport: true }); // NEW
    graph.setSelectionCell(edge); // NEW
    let hud = assertConnectionHud(graph.container, /Pipe:\s*3\/4/); // NEW
    assert.doesNotMatch(hud.textContent, /Outlet 1\s*->\s*Inlet 1/); // NEW
    assert.ok(buttonTexts(hud).includes("Straight")); // NEW
    assert.ok(buttonTexts(hud).includes("Curved")); // NEW
    assert.equal(Array.from(hud.querySelectorAll("button")).find(node => node.textContent.trim() === "Straight").getAttribute("aria-pressed"), "true"); // CHANGE
    assert.equal(api.__test.pipeEdgeStyleMode(edge), "straight"); // NEW

    clickExactButton(hud, "Curved"); // NEW
    assert.equal(edge.getAttribute(api.attrs.PIPE_EDGE), "1"); // NEW
    assert.equal(edge.getAttribute(api.attrs.PIPE_PART_ID), "pipe_cheap"); // NEW
    assert.equal(api.__test.pipeEdgeStyleMode(edge), "curved"); // NEW
    assert.equal(styleToken(edge.style, "curved"), "1"); // NEW
    api.__test.setPipeEdgeState(edge, api.__test.partStates.completed); // NEW
    assert.equal(api.__test.pipeEdgeStyleMode(edge), "curved"); // NEW
    assert.equal(styleToken(edge.style, "strokeColor"), "#82b366"); // NEW
    assert.equal(styleToken(edge.style, "dashed"), "1"); // NEW

    graph.setSelectionCell(edge); // NEW
    hud = assertConnectionHud(graph.container, /Pipe:\s*3\/4/); // NEW
    assert.equal(Array.from(hud.querySelectorAll("button")).find(node => node.textContent.trim() === "Curved").getAttribute("aria-pressed"), "true"); // CHANGE
    clickExactButton(hud, "Straight"); // NEW
    assert.equal(api.__test.pipeEdgeStyleMode(edge), "straight"); // NEW
    assert.equal(styleToken(edge.style, "curved"), ""); // NEW
    assert.equal(edge.getAttribute(api.attrs.PIPE_EDGE), "1"); // NEW
    assert.equal(edge.getAttribute(api.attrs.PIPE_PART_ID), "pipe_cheap"); // NEW
}); // NEW

test("inline port action controls avoid SVG overlay panes", () => { // NEW
    const { api, graph, moduleCell } = loadPlugin({ svgOverlayPane: true }); // NEW
    api.writeCatalog(moduleCell, sampleCatalog()); // NEW
    const source = api.__test.createSourceAssembly(moduleCell, "Well", { connectorType: "barb", nominalSize: "3/4", method: "drip", pipeConnection: true, usableFlowGpm: 5, staticPressurePsi: 45 }, { x: 30, y: 40 }); // NEW
    const filter = api.__test.createPartAssembly(moduleCell, api.readCatalog(moduleCell).items.find(item => item.id === "filter"), { x: 30, y: 180 }); // NEW
    api.openIrrigationMode(moduleCell, { preserveViewport: true }); // NEW
    graph.setSelectionCells([source.assembly, filter.assembly]); // NEW
    clickPort(graph.container, /Outlet 1 free/); // NEW
    clickPort(graph.container, /Inlet 1 free/); // NEW
    const action = assertInlineConnectionAction(graph.container, "Connect"); // NEW
    assert.equal(action.parentNode.parentNode, graph.container); // NEW
    assert.equal(graph.view.overlayPane.querySelector(".trellis-irrigation-inline-connection-action"), null); // NEW
}); // NEW

test("inline port action controls anchor to port badge DOM rect with graph scroll", () => { // NEW
    const { api, graph, moduleCell, document } = loadPlugin({ svgOverlayPane: true, clientWidth: 500, clientHeight: 360 }); // NEW
    const originalRect = document.defaultView.HTMLElement.prototype.getBoundingClientRect; // NEW
    graph.container.scrollLeft = 40; // NEW
    graph.container.scrollTop = 25; // NEW
    graph.container.getBoundingClientRect = () => ({ left: 100, right: 600, top: 50, bottom: 410, width: 500, height: 360 }); // NEW
    document.defaultView.HTMLElement.prototype.getBoundingClientRect = function () { // NEW
        if (this.classList && this.classList.contains("trellis-irrigation-port-badge") && /Inlet 1/.test(this.title || "")) return { left: 320, right: 340, top: 210, bottom: 228, width: 20, height: 18 }; // NEW
        return originalRect.call(this); // NEW
    }; // NEW
    try { // NEW
        api.writeCatalog(moduleCell, sampleCatalog()); // NEW
        const source = api.__test.createSourceAssembly(moduleCell, "Well", { connectorType: "barb", nominalSize: "3/4", method: "drip", pipeConnection: true, usableFlowGpm: 5, staticPressurePsi: 45 }, { x: 30, y: 40 }); // NEW
        const filter = api.__test.createPartAssembly(moduleCell, api.readCatalog(moduleCell).items.find(item => item.id === "filter"), { x: 30, y: 180 }); // NEW
        api.openIrrigationMode(moduleCell, { preserveViewport: true }); // NEW
        graph.setSelectionCells([source.assembly, filter.assembly]); // NEW
        clickPort(graph.container, /Outlet 1 free/); // NEW
        clickPort(graph.container, /Inlet 1 free/); // NEW
        const action = assertInlineConnectionAction(graph.container, "Connect"); // NEW
        assert.equal(action.parentNode.parentNode, graph.container); // NEW
        assert.equal(action.style.left, "286px"); // NEW
        assert.equal(action.style.top, "180px"); // NEW
    } finally { // NEW
        document.defaultView.HTMLElement.prototype.getBoundingClientRect = originalRect; // NEW
    } // NEW
}); // NEW

test("internal connection badge selection shows only inline disconnect and stays mutually exclusive", () => { // CHANGE
    const { api, graph, moduleCell } = loadPlugin(); // NEW
    const catalog = sampleCatalog(); // FIX
    catalog.items.push(part("direct_a", "Direct A", "fitting", "in_stock", 1, 1, 1, "barb", "3/4", "mght", "3/4", { pressureLossPsi: 0.1 }, undefined, true)); // FIX
    catalog.items.push(part("direct_b", "Direct B", "fitting", "in_stock", 1, 1, 1, "fght", "3/4", "mght", "3/4")); // FIX
    catalog.items.push(part("direct_c", "Direct C", "fitting", "in_stock", 1, 1, 1, "fght", "3/4", "mght", "3/4")); // FIX
    api.writeCatalog(moduleCell, catalog); // FIX
    const assembly = api.__test.createPartAssembly(moduleCell, api.readCatalog(moduleCell).items.find(item => item.id === "direct_c"), { x: 30, y: 40 }).assembly; // CHANGE
    api.__test.applyConnectionPartChoice(moduleCell, { cell: api.__test.firstAssemblyPart(assembly), role: "input", index: 0 }, api.readCatalog(moduleCell).items.find(item => item.id === "direct_b")); // CHANGE
    api.__test.applyConnectionPartChoice(moduleCell, { cell: api.__test.firstAssemblyPart(assembly), role: "input", index: 0 }, api.readCatalog(moduleCell).items.find(item => item.id === "direct_a")); // CHANGE
    const source = api.__test.createSourceAssembly(moduleCell, "Well", { connectorType: "barb", nominalSize: "3/4", method: "drip", pipeConnection: true, usableFlowGpm: 5, staticPressurePsi: 45 }, { x: 320, y: 40 }); // NEW
    api.openIrrigationMode(moduleCell, { preserveViewport: true }); // NEW
    assert.equal(api.__test.createAssemblyConnection(moduleCell, { cellId: api.__test.firstAssemblyPart(source.assembly).getId(), role: "output", index: 0 }, { cellId: api.__test.firstAssemblyPart(assembly).getId(), role: "input", index: 0 }).ok, true); // NEW
    graph.setSelectionCells([source.assembly, assembly]); // CHANGE
    assert.equal(internalConnectionBadges(graph.container).length, 2); // NEW
    internalConnectionBadges(graph.container)[0].click(); // NEW
    assert.equal(selectedInternalConnectionBadges(graph.container).length, 1); // NEW
    assertInlineConnectionAction(graph.container, "Disconnect"); // CHANGE
    assert.equal(buttonTexts(graph.container).includes("Disconnect Parts"), false); // CHANGE
    internalConnectionBadges(graph.container)[1].click(); // NEW
    assert.equal(selectedInternalConnectionBadges(graph.container).length, 1); // CHANGE
    assertInlineConnectionAction(graph.container, "Disconnect"); // CHANGE
    assert.equal(buttonTexts(graph.container).includes("Disconnect Parts"), false); // CHANGE
    selectedInternalConnectionBadges(graph.container)[0].click(); // NEW
    assert.ok(graph.container.querySelector(".trellis-irrigation-local-hud")); // NEW
    assert.equal(inlineConnectionActions(graph.container).length, 0); // NEW
    internalConnectionBadges(graph.container)[0].click(); // NEW
    assert.equal(selectedInternalConnectionBadges(graph.container).length, 1); // NEW
    clickPort(graph.container, /Outlet 1 connected/); // NEW
    assert.equal(selectedInternalConnectionBadges(graph.container).length, 0); // NEW
    assert.equal(graph.container.querySelectorAll(".trellis-irrigation-selected-pipe-highlight").length, 1); // NEW
    assertInlineConnectionAction(graph.container, "Disconnect"); // NEW
    graph.setSelectionCell(assembly); // NEW
    internalConnectionBadges(graph.container)[0].click(); // NEW
    assert.equal(graph.container.querySelectorAll(".trellis-irrigation-selected-pipe-highlight").length, 0); // NEW
    assert.equal(selectedInternalConnectionBadges(graph.container).length, 1); // NEW
    assertInlineConnectionAction(graph.container, "Disconnect"); // NEW
}); // NEW

test("free selected port badges keep one port per part while allowing same-role selections", () => { // CHANGE
    const { api, graph, moduleCell } = loadPlugin(); // NEW
    api.writeCatalog(moduleCell, sampleCatalog()); // NEW
    const source = api.__test.createSourceAssembly(moduleCell, "Well", { connectorType: "barb", nominalSize: "3/4", method: "drip", pipeConnection: true, usableFlowGpm: 5, staticPressurePsi: 45 }, { x: 30, y: 40 }); // NEW
    const valve = api.__test.createPartAssembly(moduleCell, api.readCatalog(moduleCell).items.find(item => item.id === "valve"), { x: 30, y: 180 }); // NEW
    api.openIrrigationMode(moduleCell, { preserveViewport: true }); // NEW
    graph.setSelectionCells([source.assembly, valve.assembly]); // NEW
    clickPort(graph.container, /Outlet 1 free/); // NEW
    clickPort(graph.container, /Inlet 1 free/); // NEW
    assert.deepEqual(selectedPortBadgeLabels(graph.container), ["3/4", "3/4"]); // CHANGE
    clickPort(graph.container, /Outlet 2 free/); // NEW
    assert.deepEqual(selectedPortBadgeLabels(graph.container), ["3/4", "3/4"]); // CHANGE
    clickPort(graph.container, /Outlet 2 free selected/); // NEW
    assert.deepEqual(selectedPortBadgeLabels(graph.container), ["3/4"]); // CHANGE
}); // NEW

test("free port selection keeps at most two ports and one port per part", () => { // CHANGE
    const { api, moduleCell } = loadPlugin(); // NEW
    api.writeCatalog(moduleCell, sampleCatalog()); // NEW
    const upstream = api.__test.createPartAssembly(moduleCell, api.readCatalog(moduleCell).items.find(item => item.id === "valve"), { x: 30, y: 40 }); // NEW
    const alternateUpstream = api.__test.createPartAssembly(moduleCell, api.readCatalog(moduleCell).items.find(item => item.id === "valve"), { x: 260, y: 40 }); // NEW
    const downstream = api.__test.createPartAssembly(moduleCell, api.readCatalog(moduleCell).items.find(item => item.id === "filter"), { x: 30, y: 180 }); // NEW
    const upstreamPart = api.__test.firstAssemblyPart(upstream.assembly); // NEW
    const alternatePart = api.__test.firstAssemblyPart(alternateUpstream.assembly); // NEW
    const downstreamPart = api.__test.firstAssemblyPart(downstream.assembly); // NEW
    const session = { moduleCell, selectedPorts: [], selectedBoundaries: [] }; // NEW
    api.__test.toggleSelectedPort(session, { cellId: downstreamPart.getId(), role: "input", index: 0 }); // NEW
    api.__test.toggleSelectedPort(session, { cellId: upstreamPart.getId(), role: "output", index: 0 }); // NEW
    assert.deepEqual(selectedPortKeys(api, session), [downstreamPart.getId() + ":input:0", upstreamPart.getId() + ":output:0"].sort()); // NEW
    api.__test.toggleSelectedPort(session, { cellId: upstreamPart.getId(), role: "output", index: 1 }); // NEW
    assert.deepEqual(selectedPortKeys(api, session), [downstreamPart.getId() + ":input:0", upstreamPart.getId() + ":output:1"].sort()); // NEW
    api.__test.toggleSelectedPort(session, { cellId: alternatePart.getId(), role: "output", index: 0 }); // NEW
    assert.deepEqual(selectedPortKeys(api, session), [alternatePart.getId() + ":output:0", upstreamPart.getId() + ":output:1"].sort()); // CHANGE
    api.__test.toggleSelectedPort(session, { cellId: alternatePart.getId(), role: "input", index: 0 }); // NEW
    assert.deepEqual(selectedPortKeys(api, session), [alternatePart.getId() + ":input:0", upstreamPart.getId() + ":output:1"].sort()); // CHANGE
}); // NEW

test("port badges show size-only pipe labels and size-plus-type threaded labels", () => { // NEW
    const { api, graph, moduleCell } = loadPlugin(); // NEW
    api.writeCatalog(moduleCell, sampleCatalog()); // NEW
    api.__test.createSourceAssembly(moduleCell, "Well", { connectorType: "barb", nominalSize: "3/4", method: "drip", pipeConnection: true, usableFlowGpm: 5, staticPressurePsi: 45 }, { x: 30, y: 40 }); // NEW
    api.__test.createPartAssembly(moduleCell, api.readCatalog(moduleCell).items.find(item => item.id === "fght_to_mpt"), { x: 280, y: 40 }); // NEW
    api.openIrrigationMode(moduleCell, { preserveViewport: true }); // NEW
    const labels = portBadges(graph.container).map(node => node.textContent.trim()).sort(); // NEW
    assert.ok(labels.includes("3/4"), "pipe-style barb badge should show size only"); // NEW
    assert.ok(labels.includes("3/4 FGHT"), "threaded inlet badge should include connector type"); // NEW
    assert.ok(labels.includes("3/4 MPT"), "threaded outlet badge should include connector type"); // NEW
    assert.equal(labels.some(label => /^I\d|O\d$/.test(label)), false); // NEW
}); // NEW

test("selecting a free port clears the selected occupied edge port pair", () => { // NEW
    const { api, graph, moduleCell } = loadPlugin(); // NEW
    api.writeCatalog(moduleCell, sampleCatalog()); // NEW
    const source = api.__test.createSourceAssembly(moduleCell, "Well", { connectorType: "barb", nominalSize: "3/4", method: "drip", pipeConnection: true, usableFlowGpm: 5, staticPressurePsi: 45 }, { x: 30, y: 40 }); // NEW
    const filter = api.__test.createPartAssembly(moduleCell, api.readCatalog(moduleCell).items.find(item => item.id === "filter"), { x: 30, y: 180 }); // NEW
    api.__test.createAssemblyConnection(moduleCell, { cellId: api.__test.firstAssemblyPart(source.assembly).getId(), role: "output", index: 0 }, { cellId: api.__test.firstAssemblyPart(filter.assembly).getId(), role: "input", index: 0 }); // NEW
    api.openIrrigationMode(moduleCell, { preserveViewport: true }); // NEW
    graph.setSelectionCells([source.assembly, filter.assembly]); // NEW
    clickPort(graph.container, /Outlet 1 connected/); // NEW
    assert.equal(portBadgesInState(graph.container, "selected").filter(node => /connected selected/.test(node.title)).length, 2); // NEW
    clickPort(graph.container, /Outlet 1 free/); // NEW
    const selected = portBadgesInState(graph.container, "selected"); // NEW
    assert.equal(selected.length, 1); // NEW
    assert.match(selected[0].title, /free selected/); // NEW
    assert.equal(selected.filter(node => /connected selected/.test(node.title)).length, 0); // NEW
}); // NEW

test("pipe edge stroke width is proportional to nominal pipe size", () => { // NEW
    const { api, moduleCell } = loadPlugin(); // NEW
    const catalog = sampleCatalog(); // NEW
    catalog.items.push(part("pipe_quarter", "1/4 micro", "pipe_tubing", "in_stock", 0, 1, 1, "barb", "1/4", "barb", "1/4", { innerDiameterIn: 0.17, hazenWilliamsC: 150 }, 0.12, true)); // NEW
    catalog.items.push(part("pipe_one", "1 inch mainline", "pipe_tubing", "in_stock", 0, 1, 1, "barb", "1", "barb", "1", { innerDiameterIn: 1.049, hazenWilliamsC: 150 }, 0.9, true)); // NEW
    catalog.items.push(part("filter_quarter", "1/4 filter", "filter", "in_stock", 4, 1, 1, "barb", "1/4", "barb", "1/4", { pressureLossPsi: 0.1 }, undefined, true)); // NEW
    catalog.items.push(part("filter_half", "1/2 filter", "filter", "in_stock", 4, 1, 1, "barb", "1/2", "barb", "1/2", { pressureLossPsi: 0.1 }, undefined, true)); // NEW
    catalog.items.push(part("filter_one", "1 inch filter", "filter", "in_stock", 4, 1, 1, "barb", "1", "barb", "1", { pressureLossPsi: 0.1 }, undefined, true)); // NEW
    api.writeCatalog(moduleCell, catalog); // NEW
    [["1/4", "filter_quarter", "1"], ["1/2", "filter_half", "2"], ["3/4", "filter", "3"], ["1", "filter_one", "4"]].forEach(([size, filterId, expected], index) => { // NEW
        const source = api.__test.createSourceAssembly(moduleCell, "Source " + size, { connectorType: "barb", nominalSize: size, pipeConnection: true, usableFlowGpm: 5, staticPressurePsi: 45 }, { x: 30 + index * 180, y: 40 }); // NEW
        const filter = api.__test.createPartAssembly(moduleCell, catalog.items.find(item => item.id === filterId), { x: 30 + index * 180, y: 180 }); // NEW
        const connection = api.__test.createAssemblyConnection(moduleCell, { cellId: api.__test.firstAssemblyPart(source.assembly).getId(), role: "output", index: 0 }, { cellId: api.__test.firstAssemblyPart(filter.assembly).getId(), role: "input", index: 0 }); // NEW
        assert.equal(connection.ok, true); // NEW
        assert.equal(styleToken(connection.edge.style, "strokeWidth"), expected); // NEW
    }); // NEW
}); // NEW

test("direct link edges do not receive proportional pipe stroke widths", () => { // NEW
    const { api, moduleCell } = loadPlugin(); // NEW
    const catalog = { items: [ // NEW
        part("direct_valve", "Direct Valve", "valve", "in_stock", 10, 1, 2, "fpt", "3/4", "mpt", "3/4", { maxFlowGpm: 8 }), // CHANGE
        part("direct_filter", "Direct Filter", "filter", "in_stock", 10, 1, 1, "fpt", "3/4", "mpt", "3/4", { pressureLossPsi: 1 }) // NEW
    ] }; // NEW
    api.writeCatalog(moduleCell, catalog); // NEW
    const valve = api.__test.createPartAssembly(moduleCell, catalog.items[0], { x: 30, y: 40 }); // NEW
    const filter = api.__test.createPartAssembly(moduleCell, catalog.items[1], { x: 30, y: 180 }); // NEW
    const connection = api.__test.createAssemblyConnection(moduleCell, { cellId: api.__test.firstAssemblyPart(valve.assembly).getId(), role: "output", index: 0 }, { cellId: api.__test.firstAssemblyPart(filter.assembly).getId(), role: "input", index: 0 }); // NEW
    assert.equal(connection.ok, true); // NEW
    assert.equal(connection.edge.getAttribute(api.attrs.DIRECT_LINK_EDGE), "1"); // NEW
    assert.equal(styleToken(connection.edge.style, "strokeWidth"), ""); // NEW
}); // NEW

test("reused generated pipe edges are restyled from the current pipe part", () => { // NEW
    const { api, graph, moduleCell, bed } = loadPlugin(); // NEW
    api.writeCatalog(moduleCell, sampleCatalog()); // NEW
    const source = api.__test.createSourceEndpoint(moduleCell, "Source", { connectorType: "mght", nominalSize: "1/2", usableFlowGpm: 5, staticPressurePsi: 45 }); // NEW
    const target = api.__test.createBedEndpoint(bed, "Target", { connectorType: "fght", nominalSize: "1/2" }); // NEW
    const reusable = graph.insertEdge(moduleCell, "oldGenerated", "", source, target, "edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;strokeColor=#4d8f6f;strokeWidth=9;"); // NEW
    api.__test.writePaths(moduleCell, [{ id: "reuse_path", sourceEndpointId: source.getId(), targetEndpointId: target.getId(), pipePartId: "pipe_cheap", pipeEdgeIds: [reusable.getId()], componentCellIds: [] }]); // NEW
    const staged = api.__test.stagePath({ id: "reuse_path", sourceEndpoint: source, targetEndpoint: target, pipePartId: "pipe_half", bedDemand: { flowGpm: 0, operatingPressurePsi: 0 } }); // NEW
    const committed = api.__test.commitStagedPath(moduleCell, staged); // NEW
    assert.equal(committed.blockingErrors, undefined); // NEW
    assert.equal(committed.pipeEdgeIds[0], reusable.getId()); // NEW
    assert.equal(styleToken(reusable.style, "strokeWidth"), "2"); // NEW
}); // NEW

test("irrigation mode renders global port badges and highlights compatible free targets", () => { // NEW
    const { api, graph, moduleCell } = loadPlugin(); // NEW
    api.writeCatalog(moduleCell, sampleCatalog()); // NEW
    const source = api.__test.createSourceAssembly(moduleCell, "Well", { connectorType: "barb", nominalSize: "3/4", method: "drip", pipeConnection: true, usableFlowGpm: 5, staticPressurePsi: 45 }, { x: 30, y: 40 }); // CHANGE
    const filter = api.__test.createPartAssembly(moduleCell, api.readCatalog(moduleCell).items.find(item => item.id === "filter"), { x: 280, y: 40 }); // NEW
    api.__test.createPartAssembly(moduleCell, api.readCatalog(moduleCell).items.find(item => item.id === "fght_to_mpt"), { x: 520, y: 40 }); // CHANGE
    api.openIrrigationMode(moduleCell, { preserveViewport: true }); // NEW
    assert.equal(portBadges(graph.container).length, 5); // NEW
    clickPort(graph.container, /Outlet 1 free/); // NEW
    assert.equal(portBadgesInState(graph.container, "selected").length, 1); // NEW
    assert.equal(portBadgesInState(graph.container, "compatible").length, 1); // NEW
    assert.match(portBadgesInState(graph.container, "compatible")[0].title, /Inlet 1 free compatible/); // NEW
    portBadgesInState(graph.container, "compatible")[0].click(); // NEW
    assert.equal(portBadgesInState(graph.container, "compatible").length, 0); // NEW
    assert.equal(graph.container.querySelector(".trellis-irrigation-mode-hud"), null); // NEW
    assert.equal(inlineConnectionActions(graph.container).length, 1); // NEW
    assert.equal(inlineConnectionActions(graph.container)[0].textContent, "Connect"); // CHANGE
    assert.equal(buttonTexts(graph.container).filter(text => text === "Connect").length, 1); // NEW
    assert.equal(graph.getSelectionCell(), filter.assembly); // NEW
    clickButton(graph.container, "Connect"); // NEW
    assert.equal(api.__test.collectAssemblyEdges(moduleCell).length, 1); // NEW
    assert.ok(graph.container.querySelector(".trellis-irrigation-mode-hud")); // NEW
    assert.equal(inlineConnectionActions(graph.container).length, 0); // NEW
    graph.setSelectionCells([source.assembly, filter.assembly]); // NEW
    assert.ok(portBadgesInState(graph.container, "occupied").length >= 2); // NEW
    assert.equal(portBadgesInState(graph.container, "compatible").length, 0); // NEW
    clickPort(graph.container, /Outlet 1 connected/); // NEW
    assert.equal(graph.container.querySelectorAll(".trellis-irrigation-selected-pipe-highlight").length, 1); // NEW
    assert.ok(portBadgesInState(graph.container, "selected").length >= 2); // CHANGE
    assertInlineConnectionAction(graph.container, "Disconnect"); // CHANGE
    assert.equal(buttonTexts(graph.container).includes("Disconnect Parts"), false); // NEW
    clickButton(graph.container, "Disconnect"); // CHANGE
    assert.equal(graph.container.querySelectorAll(".trellis-irrigation-selected-pipe-highlight").length, 0); // NEW
}); // NEW

test("single selected port compatibility scan stays quiet while highlighting targets", () => { // DIAGNOSTIC
    const consoleLogs = []; // DIAGNOSTIC
    const { api, graph, moduleCell } = loadPlugin({ consoleLogs }); // DIAGNOSTIC
    api.writeCatalog(moduleCell, sampleCatalog()); // DIAGNOSTIC
    api.__test.createSourceAssembly(moduleCell, "Well", { connectorType: "barb", nominalSize: "3/4", method: "drip", pipeConnection: true, usableFlowGpm: 5, staticPressurePsi: 45 }, { x: 30, y: 40 }); // DIAGNOSTIC
    api.__test.createPartAssembly(moduleCell, api.readCatalog(moduleCell).items.find(item => item.id === "filter"), { x: 280, y: 40 }); // DIAGNOSTIC
    api.__test.createPartAssembly(moduleCell, api.readCatalog(moduleCell).items.find(item => item.id === "fght_to_mpt"), { x: 520, y: 40 }); // DIAGNOSTIC
    api.openIrrigationMode(moduleCell, { preserveViewport: true }); // DIAGNOSTIC
    consoleLogs.length = 0; // DIAGNOSTIC
    clickPort(graph.container, /Outlet 1 free/); // DIAGNOSTIC
    assert.equal(portBadgesInState(graph.container, "selected").length, 1); // DIAGNOSTIC
    assert.equal(portBadgesInState(graph.container, "compatible").length, 1); // DIAGNOSTIC
    const labels = irrigationLogLabels(consoleLogs); // DIAGNOSTIC
    assert.equal(labels.some(label => /flipConnectPlan:/.test(label)), false); // DIAGNOSTIC
    assert.equal(labels.some(label => label === "[Trellis Irrigation] connectorConnectionMode:rejected"), false); // DIAGNOSTIC
}); // DIAGNOSTIC

test("direct compatible reversible ports prefer Connect over Flip and Connect", () => { // DIAGNOSTIC
    const { api, graph, moduleCell } = loadPlugin(); // DIAGNOSTIC
    const catalog = flipConnectCatalog(); // DIAGNOSTIC
    api.writeCatalog(moduleCell, catalog); // DIAGNOSTIC
    const upper = api.__test.createPartAssembly(moduleCell, catalog.items.find(item => item.id === "male_out_fit"), { x: 30, y: 40 }); // DIAGNOSTIC
    const lower = api.__test.createPartAssembly(moduleCell, catalog.items.find(item => item.id === "female_out_fit"), { x: 30, y: 180 }); // DIAGNOSTIC
    api.openIrrigationMode(moduleCell, { preserveViewport: true }); // DIAGNOSTIC
    graph.setSelectionCells([upper.assembly, lower.assembly]); // DIAGNOSTIC
    clickPort(graph.container, /Outlet 1 free.*MGHT/); // DIAGNOSTIC
    const compatibleInlet = portBadgesInState(graph.container, "compatible").find(node => /Inlet 1 free compatible.*FGHT/.test(node.title)); // DIAGNOSTIC
    assert.ok(compatibleInlet, "expected compatible reversible inlet"); // DIAGNOSTIC
    compatibleInlet.click(); // DIAGNOSTIC
    assertInlineConnectionAction(graph.container, "Connect"); // DIAGNOSTIC
    assert.equal(buttonTexts(graph.container).includes("Flip and Connect"), false); // DIAGNOSTIC
}); // DIAGNOSTIC

test("same-role reversible pipe size mismatch shows no action and logs one size summary", () => { // DIAGNOSTIC
    const consoleLogs = []; // DIAGNOSTIC
    const { api, graph, moduleCell } = loadPlugin({ consoleLogs }); // DIAGNOSTIC
    const catalog = { items: [ // DIAGNOSTIC
        part("upper_pipe_fit", "Upper pipe fitting", "fitting", "in_stock", 4, 1, 1, "barb", "3/4", "barb", "1/2", { pressureLossPsi: 0.1 }, undefined, true), // DIAGNOSTIC
        part("lower_pipe_fit", "Lower pipe fitting", "fitting", "in_stock", 4, 1, 1, "barb", "3/4", "barb", "1/4", { pressureLossPsi: 0.1 }, undefined, true) // DIAGNOSTIC
    ] }; // DIAGNOSTIC
    api.writeCatalog(moduleCell, catalog); // DIAGNOSTIC
    const upper = api.__test.createPartAssembly(moduleCell, catalog.items[0], { x: 30, y: 40 }); // DIAGNOSTIC
    const lower = api.__test.createPartAssembly(moduleCell, catalog.items[1], { x: 30, y: 180 }); // DIAGNOSTIC
    api.openIrrigationMode(moduleCell, { preserveViewport: true }); // DIAGNOSTIC
    graph.setSelectionCells([upper.assembly, lower.assembly]); // DIAGNOSTIC
    clickPort(graph.container, /Outlet 1 free.*1\/2/); // DIAGNOSTIC
    consoleLogs.length = 0; // DIAGNOSTIC
    clickPort(graph.container, /Outlet 1 free.*1\/4/); // DIAGNOSTIC
    assert.equal(inlineConnectionActions(graph.container).length, 0); // DIAGNOSTIC
    assert.equal(buttonTexts(graph.container).includes("Connect"), false); // DIAGNOSTIC
    assert.equal(buttonTexts(graph.container).includes("Flip and Connect"), false); // DIAGNOSTIC
    const summaries = irrigationLogsWithLabel(consoleLogs, "inlineConnectionAction:flip-size-mismatch"); // DIAGNOSTIC
    assert.equal(summaries.length, 1); // DIAGNOSTIC
    assert.equal(summaries[0][1].attempts.length, 2); // DIAGNOSTIC
    const sizes = JSON.parse(JSON.stringify(summaries[0][1].attempts.map(attempt => [attempt.sourceConnector.nominalSize, attempt.targetConnector.nominalSize]).sort())); // DIAGNOSTIC
    assert.deepEqual(sizes, [["1/2", "1/4"], ["1/4", "1/2"]]); // DIAGNOSTIC
}); // DIAGNOSTIC

test("multi-output dropdowns create branches and make occupied branch rows read-only", () => { // CHANGE
    const { api, graph, moduleCell } = loadPlugin(); // NEW
    api.writeCatalog(moduleCell, sampleCatalog()); // NEW
    const valveAssembly = api.__test.createPartAssembly(moduleCell, api.readCatalog(moduleCell).items.find(item => item.id === "valve"), { x: 30, y: 40 }).assembly; // NEW
    const valve = api.__test.firstAssemblyPart(valveAssembly); // NEW
    api.openIrrigationMode(moduleCell, { preserveViewport: true }); // NEW
    graph.setSelectionCell(valve); // NEW
    chooseConnectionPart(graph.container, "Outlet 2", "filter"); // NEW
    let edges = api.__test.collectAssemblyEdges(moduleCell); // NEW
    assert.equal(edges.length, 1); // NEW
    assert.equal(edges[0].getAttribute(api.attrs.EDGE_SOURCE_PORT), "1"); // NEW
    assert.equal(edges[0].target.getAttribute(api.attrs.CATALOG_PART_ID), "filter"); // NEW
    assert.equal(edges[0].getAttribute(api.attrs.PIPE_EDGE), "1"); // NEW
    assert.equal(edges[0].getAttribute(api.attrs.PIPE_PART_ID), "pipe_cheap"); // NEW
    graph.setSelectionCell(valve); // NEW
    assertConnectionRowReadOnly(graph.container, "Outlet 2"); // CHANGE
    edges = api.__test.collectAssemblyEdges(moduleCell); // NEW
    assert.equal(edges.length, 1); // NEW
    assert.equal(edges[0].target.getAttribute(api.attrs.CATALOG_PART_ID), "filter"); // CHANGE
    assert.equal(edges[0].getAttribute(api.attrs.PIPE_EDGE), "1"); // NEW
    assert.equal(edges[0].getAttribute(api.attrs.PIPE_PART_ID), "pipe_cheap"); // NEW
    assert.equal(assemblyCells(moduleCell, api).filter(cell => cell.getAttribute(api.attrs.ASSEMBLY_TYPE) === "parts").length, 2); // NEW
}); // NEW

test("occupied direct branch rows stay read-only without reclassifying links", () => { // CHANGE
    const { api, graph, moduleCell } = loadPlugin(); // NEW
    const catalog = { items: [ // NEW
        part("direct_valve", "Direct Valve", "valve", "in_stock", 10, 1, 2, "fpt", "3/4", "mpt", "3/4", { maxFlowGpm: 8 }), // NEW
        part("direct_filter", "Direct Filter", "filter", "in_stock", 10, 1, 1, "fpt", "3/4", "mpt", "3/4", { pressureLossPsi: 1 }), // NEW
        part("direct_regulator", "Direct Regulator", "regulator", "in_stock", 10, 1, 1, "fpt", "3/4", "mpt", "3/4", { pressureLossPsi: 1 }) // NEW
    ] }; // NEW
    api.writeCatalog(moduleCell, catalog); // NEW
    const valveAssembly = api.__test.createPartAssembly(moduleCell, catalog.items.find(item => item.id === "direct_valve"), { x: 30, y: 40 }).assembly; // NEW
    const valve = api.__test.firstAssemblyPart(valveAssembly); // NEW
    const filterAssembly = api.__test.createPartAssembly(moduleCell, catalog.items.find(item => item.id === "direct_filter"), { x: 30, y: 180 }).assembly; // NEW
    const filter = api.__test.firstAssemblyPart(filterAssembly); // NEW
    const connection = api.__test.createAssemblyConnection(moduleCell, { cellId: valve.getId(), role: "output", index: 1 }, { cellId: filter.getId(), role: "input", index: 0 }); // NEW
    assert.equal(connection.ok, true, connection.reason); // NEW
    api.openIrrigationMode(moduleCell, { preserveViewport: true }); // NEW
    graph.setSelectionCell(valve); // NEW
    let edge = api.__test.collectAssemblyEdges(moduleCell)[0]; // NEW
    assert.equal(edge.getAttribute(api.attrs.DIRECT_LINK_EDGE), "1"); // NEW
    assert.notEqual(edge.getAttribute(api.attrs.PIPE_EDGE), "1"); // CHANGE
    assert.equal(edge.getAttribute(api.attrs.PIPE_PART_ID) || "", ""); // CHANGE
    assert.equal(edge.getAttribute("label"), "3/4 MPT -> 3/4 FPT"); // NEW
    graph.setSelectionCell(valve); // NEW
    assertConnectionRowReadOnly(graph.container, "Outlet 2"); // CHANGE
    const edges = api.__test.collectAssemblyEdges(moduleCell); // NEW
    assert.equal(edges.length, 1); // NEW
    edge = edges[0]; // NEW
    assert.equal(edge.target.getAttribute(api.attrs.CATALOG_PART_ID), "direct_filter"); // CHANGE
    assert.equal(edge.getAttribute(api.attrs.DIRECT_LINK_EDGE), "1"); // NEW
    assert.notEqual(edge.getAttribute(api.attrs.PIPE_EDGE), "1"); // CHANGE
    assert.equal(edge.getAttribute(api.attrs.PIPE_PART_ID) || "", ""); // CHANGE
    assert.equal(edge.getAttribute("label"), "3/4 MPT -> 3/4 FPT"); // NEW
}); // NEW

test("internal connection badges show compact right-side connectors with detailed titles", () => { // CHANGE
    const { api, graph, moduleCell } = loadPlugin(); // NEW
    const catalog = { items: [ // NEW
        part("direct_filter", "Direct Filter", "filter", "in_stock", 10, 1, 1, "fpt", "3/4", "mpt", "3/4", { pressureLossPsi: 1 }), // NEW
        part("direct_regulator", "Direct Regulator", "regulator", "in_stock", 10, 1, 1, "fpt", "3/4", "mpt", "3/4", { pressureLossPsi: 1 }) // NEW
    ] }; // NEW
    api.writeCatalog(moduleCell, catalog); // NEW
    const assembly = api.__test.createPartAssembly(moduleCell, catalog.items[0], { x: 30, y: 40 }).assembly; // NEW
    api.__test.applyConnectionPartChoice(moduleCell, { cell: api.__test.firstAssemblyPart(assembly), role: "input", index: 0 }, catalog.items[1]); // CHANGE
    api.openIrrigationMode(moduleCell, { preserveViewport: true }); // NEW
    graph.setSelectionCell(assembly); // NEW
    const badge = internalConnectionBadges(graph.container)[0]; // NEW
    assert.equal(badge.textContent.trim(), "C"); // CHANGE
    assert.match(badge.title, /3\/4 MPT -> 3\/4 FPT/); // NEW
    const parts = api.__test.assemblyPartCells(assembly); // NEW
    const assemblyGeo = assembly.geometry; // NEW
    const up = parts[0].geometry; // NEW
    const down = parts[1].geometry; // NEW
    assert.equal(badge.style.left, Math.round(assemblyGeo.x + Math.max(up.x + up.width, down.x + down.width) + 4) + "px"); // CHANGE
    assert.equal(badge.style.top, Math.round(assemblyGeo.y + (up.y + up.height + down.y) / 2 - 11) + "px"); // CHANGE
}); // NEW

test("occupied pipe branch rows stay read-only when matching tubing is unavailable", () => { // CHANGE
    const { api, graph, moduleCell } = loadPlugin(); // NEW
    const catalog = sampleCatalog(); // NEW
    api.writeCatalog(moduleCell, catalog); // NEW
    const valveAssembly = api.__test.createPartAssembly(moduleCell, catalog.items.find(item => item.id === "valve"), { x: 30, y: 40 }).assembly; // NEW
    const valve = api.__test.firstAssemblyPart(valveAssembly); // NEW
    api.openIrrigationMode(moduleCell, { preserveViewport: true }); // NEW
    graph.setSelectionCell(valve); // NEW
    chooseConnectionPart(graph.container, "Outlet 1", "filter"); // NEW
    assert.equal(api.__test.collectAssemblyEdges(moduleCell)[0].getAttribute(api.attrs.PIPE_PART_ID), "pipe_cheap"); // NEW
    api.writeCatalog(moduleCell, { items: catalog.items.filter(item => item.category !== "pipe_tubing") }); // NEW
    graph.setSelectionCell(valve); // NEW
    assertConnectionRowReadOnly(graph.container, "Outlet 1"); // CHANGE
    const edges = api.__test.collectAssemblyEdges(moduleCell); // NEW
    assert.equal(edges.length, 1); // CHANGE
    assert.equal(edges[0].target.getAttribute(api.attrs.CATALOG_PART_ID), "filter"); // NEW
    assert.equal(moduleCell.children.some(cell => cell.getAttribute && cell.getAttribute(api.attrs.PIPE_PART_ID) === ""), false); // NEW
}); // NEW

test("occupied incompatible branch rows stay read-only until explicitly disconnected", () => { // CHANGE
    const { api, graph, moduleCell } = loadPlugin(); // NEW
    const catalog = sampleCatalog(); // NEW
    catalog.items.push(part("barb_to_mpt", "Barb to MPT", "fitting", "in_stock", 6, 1, 1, "barb", "3/4", "mpt", "3/4", {})); // NEW
    catalog.items.push(part("mpt_device", "MPT Device", "filter", "in_stock", 12, 1, 1, "mpt", "3/4", "mpt", "3/4", {})); // NEW
    api.writeCatalog(moduleCell, catalog); // NEW
    const valveAssembly = api.__test.createPartAssembly(moduleCell, catalog.items.find(item => item.id === "valve"), { x: 30, y: 40 }).assembly; // NEW
    const branchAssembly = api.__test.createPartAssembly(moduleCell, catalog.items.find(item => item.id === "barb_to_mpt"), { x: 30, y: 180 }).assembly; // NEW
    const second = api.__test.createPartAssembly(moduleCell, catalog.items.find(item => item.id === "mpt_device"), { x: 30, y: 300 }).partCell; // NEW
    appendChild(branchAssembly, second); // NEW
    second.parent = branchAssembly; // NEW
    second.geometry.y = 94; // NEW
    const valve = api.__test.firstAssemblyPart(valveAssembly); // NEW
    api.__test.createAssemblyConnection(moduleCell, { cellId: valve.getId(), role: "output", index: 0 }, { cellId: api.__test.firstAssemblyPart(branchAssembly).getId(), role: "input", index: 0 }); // NEW
    const assemblyCountBefore = assemblyCells(moduleCell, api).filter(cell => cell.getAttribute(api.attrs.ASSEMBLY_TYPE) === "parts").length; // NEW
    api.openIrrigationMode(moduleCell, { preserveViewport: true }); // NEW
    graph.setSelectionCell(valve); // NEW
    assertConnectionRowReadOnly(graph.container, "Outlet 1"); // CHANGE
    const edges = api.__test.collectAssemblyEdges(moduleCell); // NEW
    assert.equal(edges.length, 1); // NEW
    assert.equal(edges[0].target.getAttribute(api.attrs.CATALOG_PART_ID), "barb_to_mpt"); // CHANGE
    assert.equal(api.__test.firstAssemblyPart(branchAssembly).getAttribute(api.attrs.CATALOG_PART_ID), "barb_to_mpt"); // NEW
    assert.equal(assemblyCells(moduleCell, api).filter(cell => cell.getAttribute(api.attrs.ASSEMBLY_TYPE) === "parts").length, assemblyCountBefore); // CHANGE
}); // NEW

test("drag-created compatible edges normalize into one redoable edit", () => { // CHANGE
    const { api, graph, model, moduleCell } = loadPlugin(); // CHANGE
    api.writeCatalog(moduleCell, sampleCatalog()); // NEW
    const source = api.__test.createSourceAssembly(moduleCell, "Spray Source", { connectorType: "barb", nominalSize: "3/4", method: "sprinkler", pipeConnection: true, usableFlowGpm: 5, staticPressurePsi: 45 }, { x: 30, y: 40 }); // CHANGE
    const filter = api.__test.createPartAssembly(moduleCell, api.readCatalog(moduleCell).items.find(item => item.id === "filter"), { x: 30, y: 180 }); // NEW
    api.openIrrigationMode(moduleCell, { preserveViewport: true }); // NEW
    const edge = graph.insertEdge(moduleCell, null, "", source.assembly, filter.assembly, ""); // NEW
    model.completedEdits = []; // NEW
    graph.fireCellsAdded([edge]); // NEW
    assert.equal(model.completedEdits.length, 1); // NEW
    assert.equal(edge.getAttribute(api.attrs.PIPE_EDGE), "1"); // NEW
    assert.equal(edge.getAttribute(api.attrs.PIPE_PART_ID), "pipe_cheap"); // NEW
    assert.equal(edge.source, api.__test.firstAssemblyPart(source.assembly)); // NEW
    assert.equal(edge.target, api.__test.firstAssemblyPart(filter.assembly)); // NEW
    assert.ok(moduleCell.getAttribute(api.attrs.REPORT_JSON)); // NEW
}); // NEW

test("removed irrigation assemblies clean related edges in one redoable edit", () => { // NEW
    const { api, graph, model, moduleCell } = loadPlugin(); // NEW
    api.writeCatalog(moduleCell, sampleCatalog()); // NEW
    const source = api.__test.createSourceAssembly(moduleCell, "Source", { connectorType: "barb", nominalSize: "3/4", pipeConnection: true, usableFlowGpm: 5, staticPressurePsi: 45 }, { x: 30, y: 40 }); // NEW
    const filter = api.__test.createPartAssembly(moduleCell, api.readCatalog(moduleCell).items.find(item => item.id === "filter"), { x: 30, y: 180 }); // NEW
    const result = api.__test.createAssemblyConnection(moduleCell, { cellId: api.__test.firstAssemblyPart(source.assembly).getId(), role: "output", index: 0 }, { cellId: api.__test.firstAssemblyPart(filter.assembly).getId(), role: "input", index: 0 }); // NEW
    assert.equal(result.ok, true, result.reason); // NEW
    const edge = api.__test.collectAssemblyEdges(moduleCell)[0]; // NEW
    api.openIrrigationMode(moduleCell, { preserveViewport: true }); // NEW
    model.completedEdits = []; // NEW
    graph.fireCellsRemoved([filter.assembly]); // NEW
    assert.equal(model.completedEdits.length, 1); // NEW
    assert.equal(model.removedCells.includes(edge), true); // NEW
    assert.ok(moduleCell.getAttribute(api.attrs.REPORT_JSON)); // NEW
}); // NEW

test("undo redo replay guard keeps add and remove listeners refresh-only", () => { // NEW
    const { api, graph, model, moduleCell, undoManager } = loadPlugin(); // NEW
    api.writeCatalog(moduleCell, sampleCatalog()); // NEW
    const source = api.__test.createSourceAssembly(moduleCell, "Spray Source", { connectorType: "barb", nominalSize: "3/4", method: "sprinkler", pipeConnection: true, usableFlowGpm: 5, staticPressurePsi: 45 }, { x: 30, y: 40 }); // NEW
    const filter = api.__test.createPartAssembly(moduleCell, api.readCatalog(moduleCell).items.find(item => item.id === "filter"), { x: 30, y: 180 }); // NEW
    api.openIrrigationMode(moduleCell, { preserveViewport: true }); // NEW
    const edge = graph.insertEdge(moduleCell, null, "", source.assembly, filter.assembly, ""); // NEW
    const writesBeforeReplay = model.valuesWritten; // NEW
    undoManager.onUndo = function () { graph.fireCellsAdded([edge]); }; // NEW
    undoManager.undo(); // NEW
    assert.equal(edge.getAttribute(api.attrs.PIPE_EDGE), null); // NEW
    assert.equal(model.valuesWritten, writesBeforeReplay); // NEW
    const removedBeforeReplay = model.removedCells.length; // NEW
    undoManager.onRedo = function () { graph.fireCellsRemoved([api.__test.firstAssemblyPart(filter.assembly)]); }; // NEW
    undoManager.redo(); // NEW
    assert.equal(model.removedCells.length, removedBeforeReplay); // NEW
}); // NEW

test("1 inch barb connections auto-select 1 inch poly pipe edges", () => { // NEW
    const { api, moduleCell } = loadPlugin(); // NEW
    api.writeCatalog(moduleCell, api.starterCatalog()); // NEW
    const catalog = api.readCatalog(moduleCell); // NEW
    const source = api.__test.createSourceAssembly(moduleCell, "One inch source", { connectorType: "barb", nominalSize: "1", method: "drip", pipeConnection: true, usableFlowGpm: 10, staticPressurePsi: 45 }, { x: 30, y: 40 }); // CHANGE
    const coupler = api.__test.createPartAssembly(moduleCell, catalog.items.find(item => item.id === "barb_coupler_1"), { x: 30, y: 180 }); // NEW
    const connection = api.__test.createAssemblyConnection(moduleCell, { cellId: api.__test.firstAssemblyPart(source.assembly).getId(), role: "output", index: 0 }, { cellId: api.__test.firstAssemblyPart(coupler.assembly).getId(), role: "input", index: 0 }); // NEW
    assert.equal(connection.ok, true, connection.reason); // NEW
    const edge = api.__test.collectAssemblyEdges(moduleCell)[0]; // NEW
    assert.equal(edge.getAttribute(api.attrs.PIPE_PART_ID), "poly_mainline_1"); // NEW
}); // NEW

test("1/2 inch paths can suggest a 1/4 inch transfer barb into micro emitters", () => { // NEW
    const { api, moduleCell } = loadPlugin(); // NEW
    api.writeCatalog(moduleCell, api.starterCatalog()); // NEW
    const catalog = api.readCatalog(moduleCell); // NEW
    const source = api.__test.createSourceAssembly(moduleCell, "Half inch source", { connectorType: "barb", nominalSize: "1/2", method: "drip", pipeConnection: true, usableFlowGpm: 3, staticPressurePsi: 35 }, { x: 30, y: 40 }); // CHANGE
    const emitter = api.__test.createPartAssembly(moduleCell, catalog.items.find(item => item.id === "micro_emitter_1_0_gph"), { x: 30, y: 180 }); // NEW
    const sourcePort = { cellId: api.__test.firstAssemblyPart(source.assembly).getId(), role: "output", index: 0 }; // NEW
    const targetPort = { cellId: api.__test.firstAssemblyPart(emitter.assembly).getId(), role: "input", index: 0 }; // NEW
    const suggestions = api.__test.bridgeSuggestionsForPorts(moduleCell, sourcePort, targetPort); // NEW
    assert.ok(suggestions.some(suggestion => suggestion.partIds.includes("transfer_barb_1_2_to_1_4"))); // NEW
}); // NEW

test("Suggest Connection only proposes neutral adapter and fitting bridge parts", () => { // NEW
    const { api, moduleCell } = loadPlugin(); // NEW
    const catalog = { items: [ // NEW
        part("bridge_adapter", "Bridge Adapter", "fitting", "in_stock", 5, 1, 1, "fght", "3/4", "fpt", "3/4", { pressureLossPsi: 0.1 }), // NEW
        part("bridge_source_adapter", "Bridge Source Adapter", "source_adapter", "in_stock", 4, 1, 1, "fght", "3/4", "fpt", "3/4", { pressureLossPsi: 0.1 }), // NEW
        part("bridge_multi_output_tee", "Bridge Multi Output Tee", "fitting", "in_stock", 6, 1, 2, "fght", "3/4", "fpt", "3/4", { pressureLossPsi: 0.1 }), // NEW
        part("functional_filter", "Functional Filter", "filter", "in_stock", 20, 1, 1, "fght", "3/4", "fpt", "3/4", { pressureLossPsi: 1 }), // NEW
        part("functional_regulator", "Functional Regulator", "regulator", "in_stock", 18, 1, 1, "fght", "3/4", "fpt", "3/4", { pressureLossPsi: 1 }), // NEW
        part("functional_valve", "Functional Valve", "valve", "in_stock", 26, 1, 1, "fght", "3/4", "fpt", "3/4", { pressureLossPsi: 1, maxFlowGpm: 8 }), // NEW
        part("functional_emitter", "Functional Emitter", "emitter", "in_stock", 3, 1, 1, "fght", "3/4", "fpt", "3/4", { flowGpm: 0.5 }), // NEW
        part("functional_drip_tape", "Functional Drip Tape", "drip_tape", "in_stock", 0, 1, 1, "fght", "3/4", "fpt", "3/4", { flowGpm: 1.2 }, 0.4), // NEW
        part("target_threaded", "Target Threaded", "fitting", "in_stock", 4, 1, 1, "mpt", "3/4", "mpt", "3/4", { pressureLossPsi: 0.1 }) // NEW
    ] }; // NEW
    api.writeCatalog(moduleCell, catalog); // NEW
    const source = api.__test.createSourceAssembly(moduleCell, "Hose", { connectorType: "mght", nominalSize: "3/4", method: "drip", usableFlowGpm: 5, staticPressurePsi: 45 }, { x: 30, y: 40 }); // NEW
    const target = api.__test.createPartAssembly(moduleCell, catalog.items.find(item => item.id === "target_threaded"), { x: 30, y: 180 }); // NEW
    const suggestions = api.__test.bridgeSuggestionsForPorts(moduleCell, { cellId: api.__test.firstAssemblyPart(source.assembly).getId(), role: "output", index: 0 }, { cellId: api.__test.firstAssemblyPart(target.assembly).getId(), role: "input", index: 0 }); // NEW
    const suggestedIds = suggestions.flatMap(suggestion => suggestion.partIds); // NEW
    assert.ok(suggestedIds.includes("bridge_adapter") || suggestedIds.includes("bridge_source_adapter")); // NEW
    ["bridge_multi_output_tee", "functional_filter", "functional_regulator", "functional_valve", "functional_emitter", "functional_drip_tape"].forEach(id => assert.equal(suggestedIds.includes(id), false, id)); // CHANGE
}); // NEW

test("non-pipe connector types create direct assembly merges instead of pipe edges", () => { // CHANGE
    const { api, moduleCell } = loadPlugin(); // NEW
    const catalog = { items: [part("plain_filter", "Plain Filter", "filter", "in_stock", 10, 1, 1, "fpt", "3/4", "mpt", "3/4", { pressureLossPsi: 1 })] }; // CHANGE
    api.writeCatalog(moduleCell, catalog); // NEW
    const source = api.__test.createSourceAssembly(moduleCell, "Plain Source", { connectorType: "mpt", nominalSize: "3/4", method: "drip", usableFlowGpm: 5, staticPressurePsi: 45 }, { x: 30, y: 40 }); // CHANGE
    const filter = api.__test.createPartAssembly(moduleCell, catalog.items[0], { x: 30, y: 180 }); // NEW
    const result = api.__test.createAssemblyConnection(moduleCell, { cellId: api.__test.firstAssemblyPart(source.assembly).getId(), role: "output", index: 0 }, { cellId: api.__test.firstAssemblyPart(filter.assembly).getId(), role: "input", index: 0 }); // NEW
    assert.equal(result.ok, true, result.reason); // NEW
    assert.equal(result.mode, "merge"); // NEW
    assert.equal(api.__test.collectAssemblyEdges(moduleCell).length, 0); // NEW
    assert.equal(JSON.stringify(api.__test.assemblyPartCells(source.assembly).map(cell => cell.getAttribute(api.attrs.CATALOG_PART_ID)).filter(Boolean)), JSON.stringify(["plain_filter"])); // CHANGE
    assert.equal(assemblyCells(moduleCell, api).includes(filter.assembly), false); // NEW
}); // NEW

test("unflagged barb connectors infer pipe edges when matching pipe exists", () => { // CHANGE
    const { api, moduleCell } = loadPlugin(); // CHANGE
    const catalog = { items: [ // CHANGE
        part("plain_barb_filter", "Plain Barb Filter", "filter", "in_stock", 10, 1, 1, "barb", "3/4", "barb", "3/4", { pressureLossPsi: 1 }), // CHANGE
        part("plain_barb_pipe", "Plain Barb Pipe", "pipe_tubing", "in_stock", 0, 1, 1, "barb", "3/4", "barb", "3/4", { innerDiameterIn: 0.824, hazenWilliamsC: 150 }, 0.25) // NEW
    ] }; // CHANGE
    api.writeCatalog(moduleCell, catalog); // CHANGE
    const source = api.__test.createSourceAssembly(moduleCell, "Plain Barb Source", { connectorType: "barb", nominalSize: "3/4", method: "drip", pipeConnection: false, usableFlowGpm: 5, staticPressurePsi: 45 }, { x: 30, y: 40 }); // CHANGE
    const filter = api.__test.createPartAssembly(moduleCell, catalog.items[0], { x: 30, y: 180 }); // CHANGE
    const result = api.__test.createAssemblyConnection(moduleCell, { cellId: api.__test.firstAssemblyPart(source.assembly).getId(), role: "output", index: 0 }, { cellId: api.__test.firstAssemblyPart(filter.assembly).getId(), role: "input", index: 0 }); // CHANGE
    assert.equal(result.ok, true, result.reason); // CHANGE
    assert.equal(result.edge.getAttribute(api.attrs.PIPE_EDGE), "1"); // CHANGE
    assert.equal(result.edge.getAttribute(api.attrs.PIPE_PART_ID), "plain_barb_pipe"); // CHANGE
    assert.equal(api.__test.collectAssemblyEdges(moduleCell).length, 1); // CHANGE
}); // CHANGE

test("pipe-required connections block when no compatible pipe part exists", () => { // NEW
    const { api, moduleCell } = loadPlugin(); // NEW
    const catalog = { items: [part("pipe_filter", "Pipe Filter", "filter", "in_stock", 10, 1, 1, "barb", "3/4", "barb", "3/4", { pressureLossPsi: 1 }, undefined, true)] }; // NEW
    api.writeCatalog(moduleCell, catalog); // NEW
    const source = api.__test.createSourceAssembly(moduleCell, "Pipe Source", { connectorType: "barb", nominalSize: "3/4", method: "drip", pipeConnection: true, usableFlowGpm: 5, staticPressurePsi: 45 }, { x: 30, y: 40 }); // NEW
    const filter = api.__test.createPartAssembly(moduleCell, catalog.items[0], { x: 30, y: 180 }); // NEW
    const result = api.__test.createAssemblyConnection(moduleCell, { cellId: api.__test.firstAssemblyPart(source.assembly).getId(), role: "output", index: 0 }, { cellId: api.__test.firstAssemblyPart(filter.assembly).getId(), role: "input", index: 0 }); // NEW
    assert.equal(result.ok, false); // NEW
    assert.match(result.reason, /No compatible pipe part/); // NEW
    assert.equal(api.__test.collectAssemblyEdges(moduleCell).length, 0); // NEW
}); // NEW

test("ConnectorRules facade preserves connection decision rejection contracts", () => { // NEW
    const { api, moduleCell } = loadPlugin(); // NEW
    const catalog = sampleCatalog(); // NEW
    api.writeCatalog(moduleCell, catalog); // NEW
    const upstream = api.__test.createPartAssembly(moduleCell, catalog.items.find(item => item.id === "filter"), { x: 30, y: 40 }); // NEW
    const downstream = api.__test.createPartAssembly(moduleCell, catalog.items.find(item => item.id === "regulator"), { x: 30, y: 180 }); // NEW
    const extra = api.__test.createPartAssembly(moduleCell, catalog.items.find(item => item.id === "valve"), { x: 300, y: 180 }); // NEW
    const upstreamPart = api.__test.firstAssemblyPart(upstream.assembly); // NEW
    const downstreamPart = api.__test.firstAssemblyPart(downstream.assembly); // NEW
    const extraPart = api.__test.firstAssemblyPart(extra.assembly); // NEW
    const invalidRole = api.__test.ConnectorRules.connectionDecision(moduleCell, { cellId: upstreamPart.getId(), role: "input", index: 0 }, { cellId: downstreamPart.getId(), role: "input", index: 0 }); // NEW
    assert.equal(invalidRole.ok, false); // NEW
    assert.match(invalidRole.reason, /one output port and one inlet/); // NEW
    const sameCell = api.__test.ConnectorRules.connectionDecision(moduleCell, { cellId: upstreamPart.getId(), role: "output", index: 0 }, { cellId: upstreamPart.getId(), role: "input", index: 0 }); // NEW
    assert.equal(sameCell.ok, false); // NEW
    assert.match(sameCell.reason, /cannot connect to itself/); // NEW
    const connected = api.__test.ConnectorRules.createAssemblyConnection(moduleCell, { cellId: upstreamPart.getId(), role: "output", index: 0 }, { cellId: downstreamPart.getId(), role: "input", index: 0 }); // NEW
    assert.equal(connected.ok, true, connected.reason); // NEW
    const occupied = api.__test.ConnectorRules.connectionDecision(moduleCell, { cellId: upstreamPart.getId(), role: "output", index: 0 }, { cellId: extraPart.getId(), role: "input", index: 0 }); // NEW
    assert.equal(occupied.ok, false); // NEW
    assert.match(occupied.reason, /already connected/); // NEW
    const cycle = api.__test.ConnectorRules.connectionDecision(moduleCell, { cellId: downstreamPart.getId(), role: "output", index: 0 }, { cellId: upstreamPart.getId(), role: "input", index: 0 }); // NEW
    assert.equal(cycle.ok, false); // NEW
    assert.match(cycle.reason, /must remain a tree/); // NEW
}); // NEW

test("Suggest Connection eligibility rejects structural failures before connector search", () => { // NEW
    const { api, graph, moduleCell } = loadPlugin(); // NEW
    const catalog = { items: [ // NEW
        part("multi_input_a", "Multi Input A", "fitting", "in_stock", 5, 2, 1, "barb", "3/4", "barb", "3/4", { pressureLossPsi: 0.1 }, undefined, true), // NEW
        part("multi_input_b", "Multi Input B", "fitting", "in_stock", 5, 2, 1, "barb", "3/4", "barb", "3/4", { pressureLossPsi: 0.1 }, undefined, true), // NEW
        part("multi_pipe", "Multi Pipe", "pipe_tubing", "in_stock", 0, 1, 1, "barb", "3/4", "barb", "3/4", { innerDiameterIn: 0.824 }, 0.25, true), // NEW
        part("fght_to_barb", "FGHT to barb", "fitting", "in_stock", 5, 1, 1, "fght", "3/4", "barb", "3/4", { pressureLossPsi: 0.1 }, undefined, true) // NEW
    ] }; // NEW
    api.writeCatalog(moduleCell, catalog); // NEW
    const source = api.__test.createSourceAssembly(moduleCell, "Hose", { connectorType: "mght", nominalSize: "3/4", method: "drip", usableFlowGpm: 5, staticPressurePsi: 45 }, { x: 30, y: 40 }); // NEW
    const same = api.__test.createPartAssembly(moduleCell, catalog.items[0], { x: 30, y: 180 }).assembly; // NEW
    const downstream = api.__test.createPartAssembly(moduleCell, catalog.items[1], { x: 300, y: 180 }).assembly; // NEW
    const samePart = api.__test.firstAssemblyPart(same); // NEW
    const downstreamPart = api.__test.firstAssemblyPart(downstream); // NEW
    const sameCell = api.__test.bridgeSuggestionEligibility(moduleCell, { cellId: samePart.getId(), role: "output", index: 0 }, { cellId: samePart.getId(), role: "input", index: 0 }); // NEW
    assert.equal(sameCell.ok, false); // NEW
    assert.match(sameCell.reason, /cannot connect to itself/); // NEW
    const connected = api.__test.createAssemblyConnection(moduleCell, { cellId: samePart.getId(), role: "output", index: 0 }, { cellId: downstreamPart.getId(), role: "input", index: 0 }); // NEW
    assert.equal(connected.ok, true, connected.reason); // NEW
    const occupied = api.__test.bridgeSuggestionEligibility(moduleCell, { cellId: samePart.getId(), role: "output", index: 0 }, { cellId: downstreamPart.getId(), role: "input", index: 1 }); // NEW
    assert.equal(occupied.ok, false); // NEW
    assert.match(occupied.reason, /already connected/); // NEW
    const cycle = api.__test.bridgeSuggestionEligibility(moduleCell, { cellId: downstreamPart.getId(), role: "output", index: 0 }, { cellId: samePart.getId(), role: "input", index: 1 }); // NEW
    assert.equal(cycle.ok, false); // NEW
    assert.match(cycle.reason, /must remain a tree/); // NEW
    const bridgeable = api.__test.bridgeSuggestionEligibility(moduleCell, { cellId: api.__test.firstAssemblyPart(source.assembly).getId(), role: "output", index: 0 }, { cellId: samePart.getId(), role: "input", index: 1 }); // NEW
    assert.equal(bridgeable.ok, true, bridgeable.reason); // NEW
    api.openIrrigationMode(moduleCell, { preserveViewport: true }); // NEW
    graph.setSelectionCell(same.assembly || same); // NEW
    clickPort(graph.container, /Outlet 1 connected/); // NEW
    assert.equal(buttonTexts(graph.container).includes("Suggest Connection"), false); // NEW
}); // NEW

test("Suggest Connection is hidden for non-boundary assembly part selections", () => { // NEW
    const { api, moduleCell } = loadPlugin(); // NEW
    const catalog = sampleCatalog(); // NEW
    api.writeCatalog(moduleCell, catalog); // NEW
    const upstream = api.__test.createPartAssembly(moduleCell, catalog.items.find(item => item.id === "filter"), { x: 30, y: 40 }); // NEW
    const upstreamSecond = api.__test.createPartAssembly(moduleCell, catalog.items.find(item => item.id === "regulator"), { x: 30, y: 160 }).partCell; // NEW
    appendChild(upstream.assembly, upstreamSecond); // NEW
    upstreamSecond.parent = upstream.assembly; // NEW
    upstreamSecond.geometry.y = 94; // NEW
    const downstream = api.__test.createPartAssembly(moduleCell, catalog.items.find(item => item.id === "valve"), { x: 300, y: 40 }); // NEW
    const downstreamSecond = api.__test.createPartAssembly(moduleCell, catalog.items.find(item => item.id === "regulator"), { x: 300, y: 160 }).partCell; // NEW
    appendChild(downstream.assembly, downstreamSecond); // NEW
    downstreamSecond.parent = downstream.assembly; // NEW
    downstreamSecond.geometry.y = 94; // NEW
    const firstUpstreamPart = api.__test.firstAssemblyPart(upstream.assembly); // NEW
    const lastDownstreamPart = api.__test.lastAssemblyPart(downstream.assembly); // NEW
    const sourceNotLast = api.__test.bridgeSuggestionEligibility(moduleCell, { cellId: firstUpstreamPart.getId(), role: "output", index: 0 }, { cellId: api.__test.firstAssemblyPart(downstream.assembly).getId(), role: "input", index: 0 }); // NEW
    assert.equal(sourceNotLast.ok, false); // NEW
    assert.match(sourceNotLast.reason, /last part/); // NEW
    const targetNotFirst = api.__test.bridgeSuggestionEligibility(moduleCell, { cellId: api.__test.lastAssemblyPart(upstream.assembly).getId(), role: "output", index: 0 }, { cellId: lastDownstreamPart.getId(), role: "input", index: 0 }); // NEW
    assert.equal(targetNotFirst.ok, false); // NEW
    assert.match(targetNotFirst.reason, /first part/); // NEW
}); // NEW

test("branch direct connections and bed direct connections use direct-link edges", () => { // NEW
    const { api, moduleCell, bed } = loadPlugin(); // NEW
    const catalog = { items: [ // NEW
        part("plain_valve", "Plain Valve", "valve", "in_stock", 10, 1, 2, "fpt", "3/4", "mpt", "3/4", { maxFlowGpm: 8 }), // CHANGE
        part("plain_filter", "Plain Filter", "filter", "in_stock", 10, 1, 1, "fpt", "3/4", "mpt", "3/4", { pressureLossPsi: 1 }) // CHANGE
    ] }; // NEW
    api.writeCatalog(moduleCell, catalog); // NEW
    const valveAssembly = api.__test.createPartAssembly(moduleCell, catalog.items[0], { x: 30, y: 40 }).assembly; // NEW
    const filterAssembly = api.__test.createPartAssembly(moduleCell, catalog.items[1], { x: 30, y: 180 }).assembly; // NEW
    const branch = api.__test.createAssemblyConnection(moduleCell, { cellId: api.__test.firstAssemblyPart(valveAssembly).getId(), role: "output", index: 1 }, { cellId: api.__test.firstAssemblyPart(filterAssembly).getId(), role: "input", index: 0 }); // NEW
    assert.equal(branch.ok, true, branch.reason); // NEW
    assert.equal(branch.mode, "direct"); // NEW
    assert.equal(branch.edge.getAttribute(api.attrs.DIRECT_LINK_EDGE), "1"); // NEW
    bed.value.setAttribute(api.attrs.BED_PORTS_JSON, JSON.stringify({ inputs: 1, outputs: 1, input: { type: "fght", nominalSize: "3/4", method: "drip", pipeConnection: false }, output: { type: "fght", nominalSize: "3/4", method: "drip", pipeConnection: false } })); // NEW
    const source = api.__test.createSourceAssembly(moduleCell, "Hose", { connectorType: "mght", nominalSize: "3/4", method: "drip", usableFlowGpm: 5, staticPressurePsi: 45 }, { x: 300, y: 40 }); // NEW
    const bedAssembly = api.__test.createBedAssembly(moduleCell, bed, { x: 300, y: 180 }); // NEW
    const direct = api.__test.createAssemblyConnection(moduleCell, { cellId: api.__test.firstAssemblyPart(source.assembly).getId(), role: "output", index: 0 }, { cellId: bedAssembly.assembly.getId(), role: "input", index: 0 }); // NEW
    assert.equal(direct.ok, true, direct.reason); // NEW
    assert.equal(direct.mode, "direct"); // NEW
    assert.equal(direct.edge.getAttribute(api.attrs.DIRECT_LINK_EDGE), "1"); // NEW
    assert.equal(assemblyCells(moduleCell, api).includes(bedAssembly.assembly), true); // NEW
}); // NEW

test("drag-created incompatible irrigation edges are removed with a warning", () => { // NEW
    const { api, graph, moduleCell } = loadPlugin(); // NEW
    api.writeCatalog(moduleCell, sampleCatalog()); // NEW
    const source = api.__test.createSourceAssembly(moduleCell, "Hose Source", { connectorType: "mght", nominalSize: "3/4", method: "drip", usableFlowGpm: 5, staticPressurePsi: 45 }, { x: 30, y: 40 }); // CHANGE
    const filter = api.__test.createPartAssembly(moduleCell, api.readCatalog(moduleCell).items.find(item => item.id === "filter"), { x: 30, y: 180 }); // NEW
    api.openIrrigationMode(moduleCell, { preserveViewport: true }); // NEW
    const edge = graph.insertEdge(moduleCell, null, "", source.assembly, filter.assembly, ""); // NEW
    graph.fireCellsAdded([edge]); // NEW
    assert.equal(moduleCell.children.includes(edge), false); // NEW
    assert.match(graph.container.textContent, /Connection removed/); // CHANGE
}); // NEW

test("Suggest Connection appends direct source prefix before pipe bridge boundaries", () => { // CHANGE
    const { api, graph, moduleCell } = loadPlugin(); // NEW
    api.writeCatalog(moduleCell, sampleCatalog()); // NEW
    const source = api.__test.createSourceAssembly(moduleCell, "Hose", { connectorType: "mght", nominalSize: "3/4", method: "drip", usableFlowGpm: 5, staticPressurePsi: 45 }, { x: 30, y: 40 }); // CHANGE
    const target = api.__test.createPartAssembly(moduleCell, api.readCatalog(moduleCell).items.find(item => item.id === "drip_tape"), { x: 30, y: 220 }); // NEW
    assertSwimlaneAssemblyStyle(source.assembly); // NEW
    assertSwimlaneAssemblyStyle(target.assembly); // NEW
    api.openIrrigationMode(moduleCell, { preserveViewport: true }); // NEW
    graph.setSelectionCells([source.assembly, target.assembly]); // NEW
    clickPort(graph.container, /Outlet 1 free/); // NEW
    clickPort(graph.container, /Inlet 1 free/); // NEW
    assert.ok(graph.container.querySelector(".trellis-irrigation-mode-hud")); // NEW
    assert.equal(inlineConnectionActions(graph.container).length, 0); // NEW
    assert.equal(buttonTexts(graph.container).includes("Connect"), false); // NEW
    assert.match(graph.container.textContent, /Suggest Connection/); // CHANGE
    assert.equal(graph.container.querySelectorAll(".trellis-irrigation-connection-row").length, 0); // NEW
    assert.equal(graph.container.querySelector(".trellis-irrigation-zone-controls"), null); // NEW
    assert.equal(graph.container.querySelector(".trellis-irrigation-source-edit"), null); // NEW
    assert.match(graph.container.textContent, /In stock/); // NEW
    assert.match(graph.container.textContent, /Needs purchase/); // NEW
    clickButton(graph.container, "FGHT to MPT adapter"); // CHANGE
    const sourcePartIds = api.__test.assemblyPartCells(source.assembly).map(cell => cell.getAttribute(api.attrs.CATALOG_PART_ID)).filter(Boolean); // CHANGE
    const targetPartIds = api.__test.assemblyPartCells(target.assembly).map(cell => cell.getAttribute(api.attrs.CATALOG_PART_ID)).filter(Boolean); // CHANGE
    assert.equal(JSON.stringify(sourcePartIds), JSON.stringify(["fght_to_mpt", "fpt_to_barb"])); // CHANGE
    assert.equal(JSON.stringify(targetPartIds), JSON.stringify(["drip_tape"])); // CHANGE
    assert.equal(assemblyCells(moduleCell, api).filter(cell => ![source.assembly, target.assembly].includes(cell)).length, 0); // CHANGE
    const edges = api.__test.collectAssemblyEdges(moduleCell); // CHANGE
    assert.equal(edges.length, 1); // CHANGE
    assert.equal(edges[0].getAttribute(api.attrs.PIPE_EDGE), "1"); // CHANGE
}); // NEW

test("Suggest Connection keeps bridge parts after the first pipe boundary external", () => { // NEW
    const { api, moduleCell } = loadPlugin(); // NEW
    api.writeCatalog(moduleCell, api.starterCatalog()); // NEW
    const catalog = api.readCatalog(moduleCell); // NEW
    const source = api.__test.createSourceAssembly(moduleCell, "Hose", { connectorType: "mght", nominalSize: "3/4", method: "drip", usableFlowGpm: 5, staticPressurePsi: 45 }, { x: 30, y: 40 }); // NEW
    const target = api.__test.createPartAssembly(moduleCell, catalog.items.find(item => item.id === "drip_tape_8mil_12in"), { x: 30, y: 360 }); // NEW
    const sourcePort = { cellId: api.__test.firstAssemblyPart(source.assembly).getId(), role: "output", index: 0 }; // NEW
    const targetPort = { cellId: api.__test.firstAssemblyPart(target.assembly).getId(), role: "input", index: 0 }; // NEW
    const partIds = ["fght_to_3_4_barb_adapter", "reducer_3_4_to_1_2_barb"]; // NEW
    const plan = api.__test.ConnectionChainPlanner.planBridge(moduleCell, sourcePort, targetPort, partIds.map(id => catalog.items.find(item => item.id === id))); // NEW
    assert.equal(plan.ok, true, plan.reason); // NEW
    assert.equal(JSON.stringify(plan.hops.map(hop => hop.mode)), JSON.stringify(["direct", "pipe", "pipe"])); // NEW
    const applied = api.__test.ConnectionChainPlanner.applyBridge(moduleCell, plan); // NEW
    assert.equal(applied.ok, true, applied.reason); // NEW
    assert.equal(JSON.stringify(api.__test.assemblyPartCells(source.assembly).map(cell => cell.getAttribute(api.attrs.CATALOG_PART_ID)).filter(Boolean)), JSON.stringify(["fght_to_3_4_barb_adapter"])); // NEW
    assert.equal(JSON.stringify(api.__test.assemblyPartCells(target.assembly).map(cell => cell.getAttribute(api.attrs.CATALOG_PART_ID))), JSON.stringify(["drip_tape_8mil_12in"])); // NEW
    const external = assemblyCells(moduleCell, api).filter(cell => ![source.assembly, target.assembly].includes(cell)); // NEW
    assert.equal(external.length, 1); // NEW
    assert.equal(external[0].getAttribute("label"), "Assembly"); // NEW
    assert.equal(JSON.stringify(api.__test.assemblyPartCells(external[0]).map(cell => cell.getAttribute(api.attrs.CATALOG_PART_ID))), JSON.stringify(["reducer_3_4_to_1_2_barb"])); // NEW
    const edges = api.__test.collectAssemblyEdges(moduleCell); // NEW
    assert.equal(edges.length, 2); // NEW
    assert.equal(JSON.stringify(edges.map(edge => edge.getAttribute(api.attrs.PIPE_EDGE))), JSON.stringify(["1", "1"])); // NEW
    assert.equal(JSON.stringify(edges.map(edge => edge.getAttribute(api.attrs.PART_STATE))), JSON.stringify([api.__test.partStates.planned, api.__test.partStates.planned])); // NEW
}); // NEW

test("Suggest Connection applies all-pipe barb bridge chains as separate assemblies and pipe edges", () => { // NEW
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
    assert.equal(JSON.stringify(plan.hops.map(hop => hop.mode)), JSON.stringify(["pipe", "pipe", "pipe"])); // CHANGE
    const applied = api.__test.ConnectionChainPlanner.applyBridge(moduleCell, plan); // NEW
    assert.equal(applied.ok, true, applied.reason); // NEW
    assert.equal(JSON.stringify(api.__test.assemblyPartCells(source.assembly).map(cell => cell.getAttribute(api.attrs.CATALOG_PART_ID))), JSON.stringify(["barb_tee_3_4"])); // CHANGE
    assert.equal(JSON.stringify(api.__test.assemblyPartCells(target.assembly).map(cell => cell.getAttribute(api.attrs.CATALOG_PART_ID))), JSON.stringify(["micro_emitter_1_0_gph"])); // CHANGE
    const bridgePartAssemblies = assemblyCells(moduleCell, api).filter(cell => ![source.assembly, target.assembly].includes(cell)).map(cell => api.__test.assemblyPartCells(cell).map(partCell => partCell.getAttribute(api.attrs.CATALOG_PART_ID))); // NEW
    assert.equal(JSON.stringify(bridgePartAssemblies), JSON.stringify([["reducer_3_4_to_1_2_barb"], ["transfer_barb_1_2_to_1_4"]])); // CHANGE
    assert.equal(JSON.stringify(assemblyCells(moduleCell, api).filter(cell => ![source.assembly, target.assembly].includes(cell)).map(cell => cell.getAttribute("label"))), JSON.stringify(["Assembly", "Assembly"])); // NEW
    const edges = api.__test.collectAssemblyEdges(moduleCell); // NEW
    assert.equal(edges.length, 3); // NEW
    assert.equal(JSON.stringify(edges.map(edge => edge.getAttribute(api.attrs.PIPE_EDGE))), JSON.stringify(["1", "1", "1"])); // CHANGE
    assert.equal(JSON.stringify(edges.map(edge => edge.getAttribute(api.attrs.PIPE_PART_ID))), JSON.stringify(["poly_mainline_3_4", "poly_distribution_1_2", "micro_tubing_1_4"])); // CHANGE
    assert.equal(JSON.stringify(edges.map(edge => edge.getAttribute(api.attrs.PART_STATE))), JSON.stringify([api.__test.partStates.planned, api.__test.partStates.planned, api.__test.partStates.planned])); // NEW
}); // NEW

test("direct-only Suggest Connection still merges through the downstream assembly", () => { // NEW
    const { api, moduleCell } = loadPlugin(); // NEW
    const catalog = { items: [ // NEW
        part("fght_to_mpt_direct_bridge", "FGHT to MPT direct bridge", "source_adapter", "in_stock", 5, 1, 1, "fght", "3/4", "mpt", "3/4", { pressureLossPsi: 0.1 }), // NEW
        part("fpt_target", "FPT target", "fitting", "in_stock", 4, 1, 1, "fpt", "3/4", "mpt", "3/4", { pressureLossPsi: 0.1 }) // NEW
    ] }; // NEW
    api.writeCatalog(moduleCell, catalog); // NEW
    const source = api.__test.createSourceAssembly(moduleCell, "Hose", { connectorType: "mght", nominalSize: "3/4", method: "drip", usableFlowGpm: 5, staticPressurePsi: 45 }, { x: 30, y: 40 }); // NEW
    const target = api.__test.createPartAssembly(moduleCell, catalog.items.find(item => item.id === "fpt_target"), { x: 30, y: 220 }); // NEW
    const sourcePort = { cellId: api.__test.firstAssemblyPart(source.assembly).getId(), role: "output", index: 0 }; // NEW
    const targetPort = { cellId: api.__test.firstAssemblyPart(target.assembly).getId(), role: "input", index: 0 }; // NEW
    const suggestion = api.__test.bridgeSuggestionsForPorts(moduleCell, sourcePort, targetPort)[0]; // NEW
    assert.equal(JSON.stringify(suggestion.partIds), JSON.stringify(["fght_to_mpt_direct_bridge"])); // CHANGE
    const plan = api.__test.ConnectionChainPlanner.planBridge(moduleCell, sourcePort, targetPort, [catalog.items[0]]); // NEW
    assert.equal(plan.ok, true, plan.reason); // NEW
    assert.equal(plan.hasPipe, false); // NEW
    const applied = api.__test.ConnectionChainPlanner.applyBridge(moduleCell, plan); // NEW
    assert.equal(applied.ok, true, applied.reason); // NEW
    assert.equal(api.__test.collectAssemblyEdges(moduleCell).length, 0); // NEW
    assert.equal(JSON.stringify(api.__test.assemblyPartCells(source.assembly).map(cell => cell.getAttribute(api.attrs.CATALOG_PART_ID)).filter(Boolean)), JSON.stringify(["fght_to_mpt_direct_bridge", "fpt_target"])); // CHANGE
    assert.equal(assemblyCells(moduleCell, api).includes(target.assembly), false); // NEW
}); // NEW

test("stale bridge plans fail before creating partial bridge assemblies or edges", () => { // NEW
    const { api, moduleCell } = loadPlugin(); // NEW
    api.writeCatalog(moduleCell, api.starterCatalog()); // NEW
    const catalog = api.readCatalog(moduleCell); // NEW
    const source = api.__test.createSourceAssembly(moduleCell, "Three quarter source", { connectorType: "barb", nominalSize: "3/4", method: "drip", pipeConnection: true, usableFlowGpm: 5, staticPressurePsi: 45 }, { x: 30, y: 40 }); // NEW
    const target = api.__test.createPartAssembly(moduleCell, catalog.items.find(item => item.id === "micro_emitter_1_0_gph"), { x: 30, y: 360 }); // NEW
    const sourcePort = { cellId: api.__test.firstAssemblyPart(source.assembly).getId(), role: "output", index: 0 }; // NEW
    const targetPort = { cellId: api.__test.firstAssemblyPart(target.assembly).getId(), role: "input", index: 0 }; // NEW
    const parts = ["reducer_3_4_to_1_2_barb", "transfer_barb_1_2_to_1_4"].map(id => catalog.items.find(item => item.id === id)); // NEW
    const plan = api.__test.ConnectionChainPlanner.planBridge(moduleCell, sourcePort, targetPort, parts); // NEW
    assert.equal(plan.ok, true, plan.reason); // NEW
    const occupier = api.__test.createSourceAssembly(moduleCell, "Quarter inch source", { connectorType: "barb", nominalSize: "1/4", method: "drip", pipeConnection: true, usableFlowGpm: 1, staticPressurePsi: 30 }, { x: 360, y: 40 }); // NEW
    const occupied = api.__test.createAssemblyConnection(moduleCell, { cellId: api.__test.firstAssemblyPart(occupier.assembly).getId(), role: "output", index: 0 }, targetPort); // NEW
    assert.equal(occupied.ok, true, occupied.reason); // NEW
    const assemblyCount = assemblyCells(moduleCell, api).length; // NEW
    const edgeCount = api.__test.collectAssemblyEdges(moduleCell).length; // NEW
    const applied = api.__test.ConnectionChainPlanner.applyBridge(moduleCell, plan); // NEW
    assert.equal(applied.ok, false); // NEW
    assert.match(applied.reason, /already connected/); // NEW
    assert.equal(assemblyCells(moduleCell, api).length, assemblyCount); // NEW
    assert.equal(api.__test.collectAssemblyEdges(moduleCell).length, edgeCount); // NEW
    assert.equal(assemblyCells(moduleCell, api).some(cell => /Bridge/.test(cell.getAttribute("label") || "")), false); // NEW
}); // NEW

test("bed assemblies sync to linked beds, apply templates, and assembly reports ignore legacy objects", () => { // CHANGE
    const { api, graph, moduleCell, bed, bed2, document, model } = loadPlugin(); // CHANGE
    api.writeCatalog(moduleCell, addDripTapeBomParts(sampleCatalog())); // CHANGE
    const source = api.__test.createSourceAssembly(moduleCell, "Well", { connectorType: "barb", nominalSize: "1/2", method: "drip", pipeConnection: true, usableFlowGpm: 5, staticPressurePsi: 45 }, { x: 30, y: 40 }); // CHANGE
    const originalBedGeometry = Object.assign({}, bed.geometry); // NEW
    const bedAssembly = api.__test.createBedAssembly(moduleCell, bed, { x: 30, y: 220 }); // NEW
    assert.equal(bedAssembly.assembly.parent, moduleCell); // NEW
    assert.deepEqual(bed.geometry, originalBedGeometry); // NEW
    assert.deepEqual(bedAssembly.assembly.geometry, originalBedGeometry); // NEW
    assert.equal(bedAssembly.assembly.getAttribute("irrigation_linked_bed_id"), bed.getId()); // NEW
    assert.equal(bedAssembly.assembly.getAttribute("bed_fit_width"), "1"); // NEW
    assert.equal(bedAssembly.assembly.getAttribute("bed_fit_height"), "1"); // NEW
    assert.equal(api.__test.isBedAssembly(bedAssembly.assembly), true); // NEW
    assertRegularBedAssemblyStyle(bedAssembly.assembly); // NEW
    const legacy = api.__test.createBedEndpoint(bed2, "Legacy inlet", { connectorType: "barb", nominalSize: "3/4", method: "drip" }); // NEW
    legacy.value.setAttribute(api.attrs.GENERATED, "1"); // NEW
    const legacyLayout = appendChild(bed, makeXmlCell(document, "legacy_layout", { [api.attrs.BED_LAYOUT]: "1", label: "Legacy template label" }, { x: 8, y: 8, width: 80, height: 16 })); // NEW
    const connection = api.__test.createAssemblyConnection(moduleCell, { cellId: api.__test.firstAssemblyPart(source.assembly).getId(), role: "output", index: 0 }, { cellId: bedAssembly.assembly.getId(), role: "input", index: 0 }); // CHANGE
    assert.equal(connection.ok, true, connection.reason); // NEW
    api.openIrrigationMode(moduleCell, { preserveViewport: true }); // NEW
    graph.setSelectionCell(bedAssembly.assembly); // NEW
    assert.equal(graph.orderedCells.includes(bedAssembly.assembly), true); // NEW
    assert.ok(graph.undoSuppressedCalls > 0); // NEW
    assert.deepEqual(hudSectionTitles(graph.container).slice(0, 2), ["Irrigation Template", "Zone"]); // CHANGE
    assert.equal(hudSectionTitles(graph.container).includes("Inlet/Outlet"), false); // NEW
    assert.equal(hudSectionTitles(graph.container).includes("Tools"), false); // CHANGE
    assert.equal(hudSectionTitles(graph.container).includes("Manage"), false); // CHANGE
    const overlayHeader = irrigationHeader(graph.container); // NEW
    assert.deepEqual(buttonTexts(overlayHeader), ["Planned", "Completed", "BOM", "Catalog", "Exit"]); // NEW
    assert.equal(lifecycleToggle(graph.container).querySelector('[aria-pressed="true"]').textContent, "Planned"); // NEW
    assert.equal(dangerButton(graph.container).textContent.trim(), "Delete Assembly"); // NEW
    assert.equal(buttonTexts(graph.container).includes("New Zone"), false); // NEW
    assert.equal(buttonTexts(graph.container).includes("Edit Zones"), true); // NEW
    assert.equal(buttonTexts(graph.container).includes("Reset Zone"), true); // NEW
    const zoneSection = Array.from(graph.container.querySelectorAll(".trellis-irrigation-hud-section")).find(section => (section.querySelector(".trellis-irrigation-hud-section-title") || {}).textContent === "Zone"); // NEW
    assert.ok(zoneSection, "Missing Zone section"); // NEW
    assert.deepEqual(buttonTexts(zoneSection), ["Edit Zones", "Reset Zone"]); // NEW
    assert.match(Array.from(zoneSection.querySelectorAll("button")).find(button => button.textContent === "Edit Zones").getAttribute("style") || "", /border:\s*1px solid (?:#2563eb|rgb\(37,\s*99,\s*235\))/); // CHANGE
    assert.match(buttonByText(zoneSection, "Reset Zone").getAttribute("style") || "", /border:\s*1px solid (?:#b91c1c|rgb\(185,\s*28,\s*28\))/); // NEW
    assert.equal(Array.from(zoneSection.querySelectorAll(".trellis-irrigation-hud-section-title")).some(node => node.textContent === "Manage"), false); // NEW
    assert.equal(graph.container.querySelectorAll(".trellis-irrigation-connection-row").length, 0); // NEW
    const bedLabels = Array.from(graph.container.querySelectorAll("label")).map(label => label.textContent); // NEW
    ["Inlets", "Outlets", "Input connector", "Input size", "Output connector", "Output size", "Catalog part"].forEach(label => { // NEW
        assert.equal(bedLabels.some(text => text.startsWith(label)), false, "Removed field still rendered: " + label); // NEW
    }); // NEW
    assert.equal(Array.from(graph.container.querySelectorAll("label")).some(label => label.textContent.startsWith("Pipe/tubing")), false); // CHANGE
    const hud = graph.container.querySelector(".trellis-irrigation-mode-hud"); // NEW
    const hudStyle = hud.getAttribute("style") || ""; // NEW
    assert.match(hudStyle, /width:\s*min\(640px,\s*calc\(100vw - 32px\)\)/); // CHANGE
    assert.match(hudStyle, /max-width:\s*min\(640px,\s*calc\(100vw - 32px\)\)/); // CHANGE
    assert.match(hudStyle, /box-sizing:\s*border-box/); // NEW
    assert.match(hudStyle, /overflow:\s*hidden/); // NEW
    const bedForm = graph.container.querySelector(".trellis-irrigation-bed-inlet-form"); // NEW
    assert.match(bedForm.getAttribute("style"), /grid-template-columns:\s*minmax\(0,\s*1fr\) minmax\(0,\s*1fr\)/); // CHANGE
    assert.ok(bedForm.querySelector(".trellis-irrigation-bed-template-layout-column")); // NEW
    assert.ok(bedForm.querySelector(".trellis-irrigation-bed-template-parts-column")); // NEW
    assert.deepEqual(Array.from(bedForm.querySelector(".trellis-irrigation-bed-template-parts-column").querySelectorAll("label")).map(labelCaption), ["Inlet part", "Row takeoff part", "Row part", "Emitter/device part", "Row end cap", "Header end cap", "Outlet part"]); // NEW
    assertBoundedStyle(bedForm, "bed template form"); // NEW
    assertBoundedStyle(graph.container.querySelector(".trellis-irrigation-hud-section"), "HUD section"); // NEW
    Array.from(bedForm.querySelectorAll("label")).forEach((label, index) => assertBoundedStyle(label, "bed template label " + index)); // NEW
    Array.from(bedForm.querySelectorAll("input,select")).forEach((control, index) => assertBoundedStyle(control, "bed template control " + index)); // NEW
    const initialRowsInput = inputByLabel(graph.container, "Rows"); // NEW
    const initialEmitterInput = inputByLabel(graph.container, "Emitter"); // CHANGE
    assert.equal(initialRowsInput.type, "number"); // NEW
    assert.equal(initialRowsInput.min, "1"); // NEW
    assert.equal(initialRowsInput.step, "1"); // NEW
    assert.equal(initialEmitterInput.type, "number"); // NEW
    assert.equal(initialEmitterInput.min, "1"); // NEW
    assert.equal(initialEmitterInput.step, "1"); // NEW
    assert.equal(Array.from(graph.container.querySelectorAll("button")).some(button => button.textContent.includes("Apply Bed Layout")), false); // CHANGE
    assert.ok(selectByLabel(graph.container, "Row orientation")); // NEW
    assert.ok(selectByLabel(graph.container, "Inlet part")); // NEW
    assert.ok(selectByLabel(graph.container, "Outlet part")); // NEW
    ["Emitter/device part", "Header end cap", "Outlet part"].forEach(label => assert.match(selectByLabel(graph.container, label).parentNode.getAttribute("style") || "", /display:\s*(flex|none)/)); // NEW
    const templateSummary = graph.container.querySelector(".trellis-irrigation-bed-template-summary"); // NEW
    assert.ok(templateSummary, "Missing bed template summary"); // NEW
    const templateSummaryLines = templateSummary.textContent.split("\n"); // NEW
    assert.equal(templateSummaryLines.length, 2); // NEW
    assert.match(templateSummaryLines[0], /^Rows \d+ x \d+\.\d{2} m = \d+\.\d{2} row m$/); // NEW
    assert.match(templateSummaryLines[1], /^Supply .+, demand \d+\.\d{2} gpm, \d+ PSI$/); // CHANGE
    assert.doesNotMatch(templateSummary.textContent, /Anchor:|BOM:/); // NEW
    assert.doesNotMatch(graph.container.textContent, /Select inlet\/outlet badges/); // NEW
    changeSelectByLabel(graph.container, "Inlet part", "fpt_to_half_barb"); // CHANGE
    changeSelectByLabel(graph.container, "Header end cap", "end_cap_1_2_barb"); // NEW
    assert.equal(bedLayoutRows(bedAssembly.assembly, api).length, 2); // NEW
    let leakedKeypress = false; // NEW
    graph.container.addEventListener("keypress", function () { leakedKeypress = true; bedAssembly.assembly.value.setAttribute("label", "3"); }); // NEW
    const protectedRowsInput = inputByLabel(graph.container, "Rows"); // NEW
    protectedRowsInput.dispatchEvent(new graph.container.ownerDocument.defaultView.Event("keypress", { bubbles: true, cancelable: true })); // CHANGE
    assert.equal(leakedKeypress, false); // NEW
    assert.equal(bedAssembly.assembly.getAttribute("label"), "Drip tape bed"); // NEW
    model.completedEdits = []; // NEW
    const rowInput = inputTextByLabel(graph.container, "Rows", "3"); // CHANGE
    assert.match(graph.container.querySelector(".trellis-irrigation-bed-template-summary").textContent, /^Rows 3 x /); // NEW
    assert.equal(bedLayoutRows(bedAssembly.assembly, api).length, 2); // NEW
    assert.equal(model.completedEdits.length, 0); // NEW
    blurInput(rowInput); // NEW
    assert.equal(model.completedEdits.length, 1); // NEW
    assert.equal(bedLayoutRows(bedAssembly.assembly, api).length, 3); // NEW
    const emitterInput = inputTextByLabel(graph.container, "Emitter", "8"); // CHANGE
    blurInput(emitterInput); // NEW
    assert.equal(bedAssembly.assembly.getAttribute("label"), "Drip tape bed"); // NEW
    assert.equal(bed.getAttribute("label"), "Bed 1"); // NEW
    const template = api.__test.readBedAssemblyTemplateRecord(moduleCell, bedAssembly.assembly); // CHANGE
    assert.equal(template.templateModel, "bom"); // NEW
    assert.equal(template.spacing.rows, 3); // NEW
    assert.equal(template.spacing.emitterInches, 12); // CHANGE
    assert.equal(template.anchorPartId, "drip_tape_8mil_12in"); // NEW
    assert.equal(template.inletPartId, "fpt_to_half_barb"); // NEW
    assert.deepEqual(Array.from(template.partIds), ["fpt_to_half_barb", "drip_tape_8mil_12in", "barb_tee_1_2", "end_cap_1_2_barb", "poly_distribution_1_2"]); // CHANGE
    assert.equal(template.requiredParts[0].partId, "drip_tape_8mil_12in"); // NEW
    assert.ok(template.requiredParts[0].quantityMeters > 0); // NEW
    const assemblyRows = bedLayoutRows(bedAssembly.assembly, api); // CHANGE
    assert.deepEqual(assemblyRows.map(cell => cell.getAttribute("label")), ["Drip line", "Drip line", "Drip line"]); // CHANGE
    assert.equal(assemblyRows.some(cell => /drip tape bed|drip_tape_bed/i.test(cell.getAttribute("label") || "")), false); // NEW
    assert.equal(legacyLayout.parent, bed); // NEW
    assert.equal(bed.children.includes(legacyLayout), true); // NEW
    assert.equal(model.removedCells.includes(legacyLayout), false); // NEW
    assert.equal(Array.from(graph.container.querySelectorAll("button")).some(button => /Contract bed assembly|Expand to linked bed size/.test(button.title)), false); // CHANGE
    const prePartialSyncGeometry = Object.assign({}, bedAssembly.assembly.geometry); // NEW
    bed.geometry = { x: 140, y: 130, width: 180, height: 96 }; // NEW
    model.completedEdits = []; // NEW
    api.__test.syncLinkedBedAssemblyToBed(moduleCell, bedAssembly.assembly, bed, { fitWidth: true, fitHeight: false }); // CHANGE
    assert.equal(model.completedEdits.length, 1); // NEW
    assert.equal(JSON.stringify(bedAssembly.assembly.geometry), JSON.stringify({ x: bed.geometry.x, y: prePartialSyncGeometry.y, width: bed.geometry.width, height: prePartialSyncGeometry.height })); // CHANGE
    assert.equal(bedAssembly.assembly.getAttribute("bed_fit_width"), "1"); // NEW
    assert.equal(bedAssembly.assembly.getAttribute("bed_fit_height"), "0"); // NEW
    assert.equal(descendants(bedAssembly.assembly, cell => cell.getAttribute && cell.getAttribute(api.attrs.BED_LAYOUT) === "1").length, 3); // NEW
    model.completedEdits = []; // NEW
    api.__test.syncLinkedBedAssemblyToBed(moduleCell, bedAssembly.assembly, bed, { fitWidth: true, fitHeight: true }); // NEW
    assert.equal(model.completedEdits.length, 1); // NEW
    assert.equal(JSON.stringify(bedAssembly.assembly.geometry), JSON.stringify(bed.geometry)); // CHANGE
    assert.equal(bedAssembly.assembly.getAttribute("bed_fit_width"), "1"); // NEW
    assert.equal(bedAssembly.assembly.getAttribute("bed_fit_height"), "1"); // NEW
    assert.equal(descendants(bedAssembly.assembly, cell => cell.getAttribute && cell.getAttribute(api.attrs.BED_LAYOUT) === "1").length, 3); // CHANGE
    const paths = api.__test.syncHudGraphState(moduleCell); // NEW
    assert.equal(paths.length, 1); // NEW
    assert.equal(paths[0].targetBedId, bed.getId()); // NEW
    assert.equal(moduleCell.getAttribute(api.attrs.PATHS_JSON), null); // CHANGE
    const summary = JSON.parse(moduleCell.getAttribute(api.attrs.REPORT_JSON)).summary; // NEW
    assert.equal(Math.round(summary.percentIrrigated), 71); // CHANGE
}); // NEW

test("direct bed template commits create assembly-owned visual rows", () => { // NEW
    const { api, moduleCell, bed } = loadPlugin(); // NEW
    api.__test.commitBedTemplate(moduleCell, "bed_one", bed, { templateId: "overhead_sprinkler_block" }); // NEW
    const bedAssemblies = assemblyCells(moduleCell, api).filter(cell => cell.getAttribute(api.attrs.ASSEMBLY_TYPE) === "bed"); // NEW
    assert.equal(bedAssemblies.length, 1); // NEW
    const assembly = bedAssemblies[0]; // NEW
    assert.equal(assembly.parent, moduleCell); // CHANGE
    assert.equal(JSON.stringify(assembly.geometry), JSON.stringify(bed.geometry)); // CHANGE
    assert.equal(assembly.getAttribute("label"), "Overhead sprinkler block"); // NEW
    assertRegularBedAssemblyStyle(assembly); // NEW
    assert.ok(assembly.getAttribute(api.attrs.BED_TEMPLATE_JSON)); // CHANGE
    assert.equal(api.__test.assemblyPartCells(assembly).length, 0); // NEW
    const rows = descendants(assembly, cell => cell.getAttribute && cell.getAttribute(api.attrs.BED_LAYOUT) === "1"); // NEW
    assert.deepEqual(rows.map(cell => cell.getAttribute("label")), ["Sprinkler line", "Sprinkler line", "Sprinkler line"]); // CHANGE
}); // NEW

test("multiple bed assemblies on one bed own independent templates and derive method labels", () => { // NEW
    const { api, moduleCell, bed } = loadPlugin(); // NEW
    const dripAssembly = api.__test.createBedAssembly(moduleCell, bed, { x: 30, y: 220 }).assembly; // NEW
    const sprayAssembly = api.__test.createBedAssembly(moduleCell, bed, { x: 30, y: 360 }).assembly; // NEW
    api.__test.commitBedTemplate(moduleCell, "drip_path", dripAssembly, { templateId: "drip_tape_bed" }); // NEW
    api.__test.commitBedTemplate(moduleCell, "spray_path", sprayAssembly, { templateId: "nursery_microspray" }); // NEW

    const dripTemplate = api.__test.readBedAssemblyTemplateRecord(moduleCell, dripAssembly); // NEW
    const sprayTemplate = api.__test.readBedAssemblyTemplateRecord(moduleCell, sprayAssembly); // NEW
    assert.equal(bed.getAttribute(api.attrs.BED_TEMPLATE_JSON), null); // NEW
    assert.equal(dripTemplate.templateId, "drip_tape_bed"); // NEW
    assert.equal(sprayTemplate.templateId, "nursery_microspray"); // NEW
    assert.deepEqual(Array.from(api.__test.getBedIrrigationMethods(moduleCell, bed).map(method => method.label)), ["Drip tape", "Microspray"]); // CHANGE
}); // NEW

test("bed assemblies reject child drops and moved assemblies are lifted back to the module", () => { // NEW
    const { api, graph, model, root, moduleCell, bed, document } = loadPlugin(); // NEW
    api.__test.commitBedTemplate(moduleCell, "bed_one", bed, { templateId: "overhead_sprinkler_block" }); // NEW
    const assembly = assemblyCells(moduleCell, api).find(cell => cell.getAttribute(api.attrs.ASSEMBLY_TYPE) === "bed"); // NEW
    const plainContainer = appendChild(moduleCell, makeXmlCell(document, "plain_container", { label: "Plain container" }, { x: 40, y: 36, width: 300, height: 220 })); // NEW
    const orphanAssembly = appendChild(root, makeXmlCell(document, "orphan_bed_assembly", { [api.attrs.ASSEMBLY]: "1", [api.attrs.ASSEMBLY_TYPE]: "bed", label: "Orphan Bed Assembly" }, { x: 10, y: 10, width: 100, height: 60 })); // NEW
    assert.ok(assembly, "Expected committed bed assembly"); // NEW
    assert.equal(graph.isValidDropTarget(bed, [assembly]), false); // NEW
    assert.equal(graph.isValidDropTarget(plainContainer, [assembly]), false); // NEW
    assert.equal(graph.isValidDropTarget(root, [assembly]), false); // NEW
    assert.equal(graph.isValidDropTarget(moduleCell, [assembly]), true); // NEW
    assert.equal(graph.isValidDropTarget(root, [orphanAssembly]), true); // NEW
    const rows = bedLayoutRows(assembly, api); // NEW
    assert.equal(rows.length, 3); // NEW
    const before = absoluteGeometry(assembly); // NEW
    const bedAbs = absoluteGeometry(bed); // NEW
    assembly.geometry = { x: before.x - bedAbs.x, y: before.y - bedAbs.y, width: before.width, height: before.height }; // NEW
    model.add(bed, assembly); // NEW
    graph.fireCellsMoved([assembly]); // NEW
    assert.equal(assembly.parent, moduleCell); // NEW
    assert.deepEqual(absoluteGeometry(assembly), before); // NEW
    rows.forEach(row => assert.equal(row.parent, assembly)); // NEW
}); // NEW

test("linked bed geometry events refresh bed assembly rows and saved template metrics", () => { // NEW
    const harness = loadPlugin(); // NEW
    const { api, graph, moduleCell, bed } = harness; // NEW
    const assembly = createCommittedDripTapeBedAssembly(harness, bed); // NEW
    const beforeTemplate = api.__test.readBedAssemblyTemplateRecord(moduleCell, assembly); // CHANGE
    const beforeRows = bedLayoutRows(assembly, api); // NEW
    const beforeFirstRow = beforeRows[0]; // NEW
    const beforeFirstGeometry = Object.assign({}, beforeFirstRow.geometry); // NEW
    bed.geometry = { x: 140, y: 130, width: 180, height: 120 }; // NEW
    graph.fireCellsResized([bed]); // NEW
    const afterTemplate = api.__test.readBedAssemblyTemplateRecord(moduleCell, assembly); // CHANGE
    const afterRows = bedLayoutRows(assembly, api); // NEW
    assert.equal(JSON.stringify(assembly.geometry), JSON.stringify(bed.geometry)); // CHANGE
    assert.equal(afterRows.length, beforeRows.length); // NEW
    assert.equal(afterRows[0], beforeFirstRow); // NEW
    assert.notEqual(JSON.stringify(afterRows[0].geometry), JSON.stringify(beforeFirstGeometry)); // CHANGE
    assert.ok(afterTemplate.rowLengthMeters > beforeTemplate.rowLengthMeters); // NEW
    assert.ok(afterTemplate.totalRowMeters > beforeTemplate.totalRowMeters); // NEW
    const beforeRequiredMeters = beforeTemplate.requiredParts.reduce((sum, entry) => sum + Number(entry.quantityMeters || 0), 0); // NEW
    const afterRequiredMeters = afterTemplate.requiredParts.reduce((sum, entry) => sum + Number(entry.quantityMeters || 0), 0); // NEW
    assert.ok(afterRequiredMeters > beforeRequiredMeters); // CHANGE
    bed.geometry = { x: 200, y: 170, width: 180, height: 120 }; // NEW
    graph.fireCellsMoved([bed], 60, 40); // NEW
    assert.equal(JSON.stringify(assembly.geometry), JSON.stringify(bed.geometry)); // CHANGE
    bedLayoutRows(assembly, api).forEach(row => assert.equal(row.parent, assembly)); // NEW
    const disconnectedPaths = api.__test.syncHudGraphState(moduleCell); // CHANGE
    assert.equal(disconnectedPaths.length, 1); // CHANGE
    assert.equal(disconnectedPaths[0].disconnectedFromSource, true); // NEW
}); // NEW

test("moving a bed assembly to another bed relinks and carries template data", () => { // NEW
    const harness = loadPlugin(); // NEW
    const { api, graph, moduleCell, bed, bed2 } = harness; // NEW
    const assembly = createCommittedDripTapeBedAssembly(harness, bed); // NEW
    const originalTemplate = api.__test.readBedAssemblyTemplateRecord(moduleCell, assembly); // CHANGE
    const originalPorts = JSON.parse(bed.getAttribute(api.attrs.BED_PORTS_JSON)); // NEW
    assembly.geometry = Object.assign({}, bed2.geometry); // NEW
    graph.fireCellsMoved([assembly], bed2.geometry.x - bed.geometry.x, bed2.geometry.y - bed.geometry.y); // NEW
    assert.equal(assembly.getAttribute(api.attrs.LINKED_BED_ID), bed2.getId()); // NEW
    assert.equal(bed.getAttribute(api.attrs.BED_TEMPLATE_JSON), null); // NEW
    assert.equal(bed.getAttribute(api.attrs.BED_PORTS_JSON), null); // NEW
    const movedTemplate = api.__test.readBedAssemblyTemplateRecord(moduleCell, assembly); // CHANGE
    const movedPorts = JSON.parse(bed2.getAttribute(api.attrs.BED_PORTS_JSON)); // NEW
    assert.equal(movedTemplate.templateId, originalTemplate.templateId); // NEW
    assert.equal(movedTemplate.inletPartId, originalTemplate.inletPartId); // NEW
    assert.deepEqual(movedPorts.input, originalPorts.input); // NEW
    assert.equal(JSON.stringify(assembly.geometry), JSON.stringify(bed2.geometry)); // CHANGE
    bedLayoutRows(assembly, api).forEach(row => assert.equal(row.parent, assembly)); // NEW
    const savedAfterRelink = assembly.getAttribute(api.attrs.BED_TEMPLATE_JSON); // CHANGE
    assembly.geometry = { x: 520, y: 360, width: 120, height: 60 }; // NEW
    graph.fireCellsMoved([assembly], 240, 240); // NEW
    assert.equal(assembly.getAttribute(api.attrs.LINKED_BED_ID), bed2.getId()); // NEW
    assert.equal(assembly.getAttribute(api.attrs.BED_TEMPLATE_JSON), savedAfterRelink); // CHANGE
}); // NEW

test("relinking preserves old bed template while another assembly still uses it", () => { // NEW
    const harness = loadPlugin(); // NEW
    const { api, graph, moduleCell, bed, bed2 } = harness; // NEW
    const firstAssembly = createCommittedDripTapeBedAssembly(harness, bed); // NEW
    const secondAssembly = api.__test.createBedAssembly(moduleCell, bed, { x: 30, y: 320 }).assembly; // NEW
    assert.equal(secondAssembly.getAttribute(api.attrs.LINKED_BED_ID), bed.getId()); // NEW
    const savedTemplate = firstAssembly.getAttribute(api.attrs.BED_TEMPLATE_JSON); // CHANGE
    firstAssembly.geometry = Object.assign({}, bed2.geometry); // NEW
    graph.fireCellsMoved([firstAssembly], bed2.geometry.x - bed.geometry.x, bed2.geometry.y - bed.geometry.y); // NEW
    assert.equal(firstAssembly.getAttribute(api.attrs.LINKED_BED_ID), bed2.getId()); // NEW
    assert.equal(firstAssembly.getAttribute(api.attrs.BED_TEMPLATE_JSON), savedTemplate); // CHANGE
}); // NEW

test("missing required catalog parts preserve saved metrics while refreshing row geometry", () => { // NEW
    const harness = loadPlugin(); // NEW
    const { api, graph, moduleCell, bed } = harness; // NEW
    const assembly = createCommittedDripTapeBedAssembly(harness, bed); // NEW
    const beforeTemplate = api.__test.readBedAssemblyTemplateRecord(moduleCell, assembly); // CHANGE
    const beforeRowGeometry = Object.assign({}, bedLayoutRows(assembly, api)[0].geometry); // NEW
    api.writeCatalog(moduleCell, sampleCatalog()); // NEW
    bed.geometry = { x: 120, y: 120, width: 220, height: 120 }; // NEW
    graph.fireCellsResized([bed]); // NEW
    const afterTemplate = api.__test.readBedAssemblyTemplateRecord(moduleCell, assembly); // CHANGE
    assert.equal(afterTemplate.totalRowMeters, beforeTemplate.totalRowMeters); // NEW
    assert.equal(afterTemplate.requiredParts[0].quantityMeters, beforeTemplate.requiredParts[0].quantityMeters); // NEW
    const afterRowGeometry = bedLayoutRows(assembly, api)[0].geometry; // NEW
    assert.notEqual(JSON.stringify(afterRowGeometry), JSON.stringify(beforeRowGeometry)); // CHANGE
}); // NEW

test("syncing legacy swimlane bed assemblies does not restyle them", () => { // NEW
    const { api, moduleCell, bed, document } = loadPlugin(); // NEW
    const legacyAssembly = appendChild(moduleCell, makeXmlCell(document, "legacy_bed_assembly", { [api.attrs.ASSEMBLY]: "1", [api.attrs.ASSEMBLY_TYPE]: "bed", [api.attrs.LINKED_BED_ID]: bed.getId(), label: "Legacy Bed Assembly" }, Object.assign({}, bed.geometry))); // NEW
    legacyAssembly.style = "swimlane;whiteSpace=wrap;html=1;childLayout=stackLayout;horizontalStack=0;rounded=1;fillColor=#ffffff;strokeColor=#666666;"; // NEW
    api.__test.syncLinkedBedAssemblyToBed(moduleCell, legacyAssembly, bed, { fitWidth: true, fitHeight: true }); // NEW
    assert.match(legacyAssembly.style, /(?:^|;)swimlane(?:;|$)/); // NEW
    assert.equal(styleToken(legacyAssembly.style, "childLayout"), "stackLayout"); // NEW
    assert.equal(styleToken(legacyAssembly.style, "horizontalStack"), "0"); // NEW
}); // NEW

test("bed assembly BOM parts persist and drive inlet/outlet connector compatibility", () => { // CHANGE
    const { api, graph, moduleCell, bed } = loadPlugin(); // NEW
    const catalog = addDripTapeBomParts(sampleCatalog()); // CHANGE
    catalog.items.push(part("spray_3_4", "Spray 3/4", "sprinkler", "in_stock", 9, 1, 1, "barb", "3/4", "barb", "3/4", { pressureLossPsi: 0.2 }, undefined, true)); // NEW
    api.writeCatalog(moduleCell, catalog); // NEW
    const bedAssembly = api.__test.createBedAssembly(moduleCell, bed, { x: 240, y: 120 }); // NEW
    assertRegularBedAssemblyStyle(bedAssembly.assembly); // NEW
    api.openIrrigationMode(moduleCell, { preserveViewport: true }); // NEW
    graph.setSelectionCell(bedAssembly.assembly); // NEW
    const inlet = selectByLabel(graph.container, "Inlet part"); // NEW
    const outlet = selectByLabel(graph.container, "Outlet part"); // NEW
    const orientation = selectByLabel(graph.container, "Row orientation"); // NEW
    assert.equal(orientation.value, "width"); // NEW
    assert.equal(Array.from(graph.container.querySelectorAll("label")).some(label => label.textContent.startsWith("Pipe/tubing")), false); // NEW
    assert.equal(Array.from(inlet.options).some(option => option.value === "pipe_cheap"), false); // NEW
    assert.equal(Array.from(outlet.options).some(option => option.value === "pipe_cheap"), false); // NEW
    assert.equal(Array.from(inlet.options).some(option => option.value === "drip_tape_8mil_12in"), true); // CHANGE
    assert.equal(Array.from(outlet.options).some(option => option.value === "drip_tape_8mil_12in"), false); // CHANGE
    assert.equal(Array.from(inlet.options).some(option => option.value === "fpt_to_half_barb"), true); // CHANGE
    assert.equal(Array.from(outlet.options).some(option => option.value === "half_barb_to_3_4_barb"), false); // CHANGE
    assert.equal(Array.from(inlet.options).some(option => option.value === "half_barb_plug"), false); // NEW
    assert.equal(Array.from(inlet.options).some(option => option.value === "filter"), false); // NEW
    assert.equal(Array.from(inlet.options).some(option => option.value === "spray_3_4"), false); // NEW
    changeSelectByLabel(graph.container, "Inlet part", "fpt_to_half_barb"); // CHANGE
    assert.equal(Array.from(selectByLabel(graph.container, "Outlet part").options).some(option => option.value === "half_barb_to_3_4_barb"), true); // NEW
    changeSelectByLabel(graph.container, "Outlet part", "half_barb_to_3_4_barb"); // CHANGE
    changeSelectByLabel(graph.container, "Row orientation", "height"); // CHANGE
    const template = api.__test.readBedAssemblyTemplateRecord(moduleCell, bedAssembly.assembly); // CHANGE
    assert.equal(template.templateModel, "bom"); // NEW
    assert.equal(template.inletPartId, "fpt_to_half_barb"); // CHANGE
    assert.equal(template.outletPartId, "half_barb_to_3_4_barb"); // CHANGE
    assert.equal(template.pipePartId, ""); // CHANGE
    assert.equal(template.anchorPartId, "drip_tape_8mil_12in"); // NEW
    assert.equal(template.rowOrientation, "height"); // CHANGE
    assert.deepEqual(Array.from(template.partIds), ["fpt_to_half_barb", "half_barb_to_3_4_barb", "drip_tape_8mil_12in", "barb_tee_1_2", "end_cap_1_2_barb", "poly_distribution_1_2"]); // CHANGE
    assert.equal(template.requiredParts[0].partId, "drip_tape_8mil_12in"); // NEW
    assert.ok(template.requiredParts[0].quantityMeters > 0); // NEW
    assert.ok(template.demand.flowGpm > 1.2); // NEW
    const ports = JSON.parse(bed.getAttribute(api.attrs.BED_PORTS_JSON)); // NEW
    assert.equal(ports.inputs, 1); // NEW
    assert.equal(ports.outputs, 1); // NEW
    assert.equal(ports.input.type, "fpt"); // CHANGE
    assert.equal(ports.input.nominalSize, "3/4"); // NEW
    assert.equal(ports.output.type, "barb"); // NEW
    assert.equal(ports.output.nominalSize, "3/4"); // NEW
    assert.equal(JSON.stringify(api.__test.portConnectorForCell(moduleCell, bedAssembly.assembly, "input")), JSON.stringify(ports.input)); // CHANGE
    assert.equal(JSON.stringify(api.__test.portConnectorForCell(moduleCell, bedAssembly.assembly, "output")), JSON.stringify(ports.output)); // CHANGE
    const rows = descendants(bedAssembly.assembly, cell => cell.getAttribute && cell.getAttribute(api.attrs.BED_LAYOUT) === "1"); // NEW
    assert.ok(rows[0].geometry.height > rows[0].geometry.width); // NEW
    const source = api.__test.createSourceAssembly(moduleCell, "Hose", { connectorType: "mpt", nominalSize: "3/4", usableFlowGpm: 5, staticPressurePsi: 45 }, { x: 30, y: 40 }); // CHANGE
    const direct = api.__test.createAssemblyConnection(moduleCell, { cellId: api.__test.firstAssemblyPart(source.assembly).getId(), role: "output", index: 0 }, { cellId: bedAssembly.assembly.getId(), role: "input", index: 0 }); // NEW
    assert.equal(direct.ok, true, direct.reason); // NEW
    assert.equal(direct.edge.getAttribute(api.attrs.DIRECT_LINK_EDGE), "1"); // NEW
    const filter = api.__test.createPartAssembly(moduleCell, catalog.items.find(item => item.id === "filter"), { x: 460, y: 120 }); // NEW
    const outletConnection = api.__test.createAssemblyConnection(moduleCell, { cellId: bedAssembly.assembly.getId(), role: "output", index: 0 }, { cellId: api.__test.firstAssemblyPart(filter.assembly).getId(), role: "input", index: 0 }); // NEW
    assert.equal(outletConnection.ok, true, outletConnection.reason); // NEW
    assert.equal(outletConnection.edge.getAttribute(api.attrs.PIPE_EDGE), "1"); // NEW
    assert.equal(outletConnection.edge.getAttribute(api.attrs.PIPE_PART_ID), "pipe_cheap"); // NEW
}); // NEW

test("connected bed assembly inlet and outlet part selectors lock by connected port", () => { // NEW
    const { api, graph, moduleCell, bed, bed2 } = loadPlugin(); // NEW
    const catalog = addDripTapeBomParts(sampleCatalog()); // NEW
    api.writeCatalog(moduleCell, catalog); // NEW
    api.openIrrigationMode(moduleCell, { preserveViewport: true }); // NEW

    const inletLockedBed = createConfiguredDripTapeBedAssembly(api, graph, moduleCell, bed, { x: 240, y: 120 }); // NEW
    const source = api.__test.createSourceAssembly(moduleCell, "Hose", { connectorType: "mpt", nominalSize: "3/4", usableFlowGpm: 5, staticPressurePsi: 45 }, { x: 30, y: 40 }); // NEW
    const inletConnection = api.__test.createAssemblyConnection(moduleCell, { cellId: api.__test.firstAssemblyPart(source.assembly).getId(), role: "output", index: 0 }, { cellId: inletLockedBed.getId(), role: "input", index: 0 }); // NEW
    assert.equal(inletConnection.ok, true, inletConnection.reason); // NEW
    graph.setSelectionCell(inletLockedBed); // NEW
    assert.equal(selectByLabel(graph.container, "Inlet part").disabled, true); // NEW
    assert.equal(selectByLabel(graph.container, "Outlet part").disabled, false); // NEW

    const outletOnlyBed = createConfiguredDripTapeBedAssembly(api, graph, moduleCell, bed2, { x: 440, y: 120 }); // NEW
    const outletFilter = api.__test.createPartAssembly(moduleCell, catalog.items.find(item => item.id === "filter"), { x: 650, y: 120 }); // NEW
    const outletOnlyConnection = api.__test.createAssemblyConnection(moduleCell, { cellId: outletOnlyBed.getId(), role: "output", index: 0 }, { cellId: api.__test.firstAssemblyPart(outletFilter.assembly).getId(), role: "input", index: 0 }); // NEW
    assert.equal(outletOnlyConnection.ok, true, outletOnlyConnection.reason); // NEW
    graph.setSelectionCell(outletOnlyBed); // NEW
    assert.equal(selectByLabel(graph.container, "Inlet part").disabled, false); // NEW
    assert.equal(selectByLabel(graph.container, "Outlet part").disabled, true); // NEW

    const downstreamFilter = api.__test.createPartAssembly(moduleCell, catalog.items.find(item => item.id === "filter"), { x: 460, y: 320 }); // NEW
    const outletConnection = api.__test.createAssemblyConnection(moduleCell, { cellId: inletLockedBed.getId(), role: "output", index: 0 }, { cellId: api.__test.firstAssemblyPart(downstreamFilter.assembly).getId(), role: "input", index: 0 }); // NEW
    assert.equal(outletConnection.ok, true, outletConnection.reason); // NEW
    graph.setSelectionCell(inletLockedBed); // NEW
    assert.equal(selectByLabel(graph.container, "Inlet part").disabled, true); // NEW
    assert.equal(selectByLabel(graph.container, "Outlet part").disabled, true); // NEW
}); // NEW

test("locked bed assembly part selectors preserve values during template refresh", () => { // NEW
    const { api, graph, moduleCell, bed } = loadPlugin(); // NEW
    const catalog = addDripTapeBomParts(sampleCatalog()); // NEW
    api.writeCatalog(moduleCell, catalog); // NEW
    api.openIrrigationMode(moduleCell, { preserveViewport: true }); // NEW
    const bedAssembly = createConfiguredDripTapeBedAssembly(api, graph, moduleCell, bed, { x: 240, y: 120 }); // NEW
    const source = api.__test.createSourceAssembly(moduleCell, "Hose", { connectorType: "mpt", nominalSize: "3/4", usableFlowGpm: 5, staticPressurePsi: 45 }, { x: 30, y: 40 }); // NEW
    const inletConnection = api.__test.createAssemblyConnection(moduleCell, { cellId: api.__test.firstAssemblyPart(source.assembly).getId(), role: "output", index: 0 }, { cellId: bedAssembly.getId(), role: "input", index: 0 }); // NEW
    assert.equal(inletConnection.ok, true, inletConnection.reason); // NEW
    const filter = api.__test.createPartAssembly(moduleCell, catalog.items.find(item => item.id === "filter"), { x: 460, y: 120 }); // NEW
    const outletConnection = api.__test.createAssemblyConnection(moduleCell, { cellId: bedAssembly.getId(), role: "output", index: 0 }, { cellId: api.__test.firstAssemblyPart(filter.assembly).getId(), role: "input", index: 0 }); // NEW
    assert.equal(outletConnection.ok, true, outletConnection.reason); // NEW
    graph.setSelectionCell(bedAssembly); // NEW
    assert.equal(selectByLabel(graph.container, "Inlet part").value, "fpt_to_half_barb"); // NEW
    assert.equal(selectByLabel(graph.container, "Outlet part").value, "half_barb_to_3_4_barb"); // NEW

    changeSelectByLabel(graph.container, "Row orientation", "height"); // NEW
    graph.setSelectionCell(bedAssembly); // NEW
    assert.equal(selectByLabel(graph.container, "Inlet part").disabled, true); // NEW
    assert.equal(selectByLabel(graph.container, "Outlet part").disabled, true); // NEW
    assert.equal(selectByLabel(graph.container, "Inlet part").value, "fpt_to_half_barb"); // NEW
    assert.equal(selectByLabel(graph.container, "Outlet part").value, "half_barb_to_3_4_barb"); // NEW
}); // NEW

test("bed inlet role uses the selected non-pipe part upstream side", () => { // NEW
    const { api, graph, moduleCell, bed } = loadPlugin(); // NEW
    const catalog = addDripTapeBomParts(sampleCatalog()); // NEW
    const anchor = catalog.items.find(item => item.id === "drip_tape_8mil_12in"); // NEW
    anchor.connectors.input = { type: "fght", nominalSize: "3/4" }; // NEW
    anchor.connectors.output = { type: "mght", nominalSize: "3/4" }; // NEW
    catalog.items.push(part("threaded_inline", "Threaded inline", "fitting", "in_stock", 5, 1, 1, "fght", "3/4", "mght", "3/4", { pressureLossPsi: 0.2 })); // NEW
    catalog.items.push(part("threaded_row_takeoff", "Threaded row takeoff", "fitting", "in_stock", 3, 1, 1, "barb", "3/4", "mght", "3/4", { pressureLossPsi: 0.1 }, undefined, true)); // NEW
    catalog.items.push(part("threaded_row_cap", "Threaded row cap", "cap_end", "in_stock", 1, 1, 0, "mght", "3/4", "", "", { pressureLossPsi: 0 }, undefined, false)); // NEW
    catalog.items.push(part("barb_header_cap_3_4", "3/4 barb header cap", "cap_end", "in_stock", 1, 1, 0, "barb", "3/4", "", "", { pressureLossPsi: 0 }, undefined, true)); // NEW
    api.writeCatalog(moduleCell, catalog); // NEW
    const bedAssembly = api.__test.createBedAssembly(moduleCell, bed, { x: 240, y: 120 }); // NEW
    api.openIrrigationMode(moduleCell, { preserveViewport: true }); // NEW
    graph.setSelectionCell(bedAssembly.assembly); // NEW
    changeSelectByLabel(graph.container, "Inlet part", "threaded_inline"); // NEW
    changeSelectByLabel(graph.container, "Header end cap", "barb_header_cap_3_4"); // NEW
    const ports = JSON.parse(bed.getAttribute(api.attrs.BED_PORTS_JSON)); // NEW
    assert.equal(ports.input.type, "fght"); // NEW
    assert.equal(ports.input.nominalSize, "3/4"); // NEW
    assert.equal(ports.outputs, 0); // NEW
}); // NEW

test("selected bed assembly ports do not show Add Part placement UI", () => { // CHANGE
    const { api, graph, moduleCell, bed } = loadPlugin(); // CHANGE
    const catalog = addDripTapeBomParts(sampleCatalog()); // NEW
    catalog.items.push(part("bed_feed_adapter", "Bed feed adapter", "fitting", "in_stock", 6, 1, 1, "fght", "3/4", "mpt", "3/4", { pressureLossPsi: 0.2 })); // CHANGE
    api.writeCatalog(moduleCell, catalog); // NEW
    const bedAssembly = api.__test.createBedAssembly(moduleCell, bed, { x: 240, y: 120 }); // NEW
    api.openIrrigationMode(moduleCell, { preserveViewport: true }); // NEW
    graph.setSelectionCell(bedAssembly.assembly); // NEW
    changeSelectByLabel(graph.container, "Inlet part", "fpt_to_half_barb"); // CHANGE
    changeSelectByLabel(graph.container, "Outlet part", "half_barb_to_3_4_barb"); // CHANGE
    graph.setSelectionCell(bedAssembly.assembly); // NEW
    assert.equal(graph.container.querySelectorAll(".trellis-irrigation-connection-row").length, 0); // NEW

    clickPort(graph.container, /Inlet 1 free/); // NEW
    assert.equal(graph.container.querySelector(".trellis-irrigation-add-part-picker"), null); // CHANGE
    assert.equal(buttonTexts(graph.container).includes("Add Part"), false); // NEW
    assert.equal(api.__test.collectAssemblyEdges(moduleCell).length, 0); // NEW
    assert.ok(portBadgesInState(graph.container, "selected").length >= 1); // CHANGE

    graph.setSelectionCell(bedAssembly.assembly); // CHANGE
    clickPort(graph.container, /Outlet 1 free/); // NEW
    assert.equal(graph.container.querySelector(".trellis-irrigation-add-part-picker"), null); // CHANGE
    assert.equal(buttonTexts(graph.container).includes("Add Part"), false); // NEW
    assert.equal(api.__test.collectAssemblyEdges(moduleCell).length, 0); // NEW
}); // NEW

test("bed template anchor selection uses largest pipe-like required part deterministically", () => { // NEW
    const { api } = loadPlugin(); // NEW
    const catalog = { items: [ // NEW
        part("pipe_half", "1/2 pipe", "pipe_tubing", "in_stock", 0, 1, 1, "barb", "1/2", "barb", "1/2", { innerDiameterIn: 0.6 }, 0.3, true), // NEW
        part("pipe_quarter", "1/4 pipe", "pipe_tubing", "in_stock", 0, 1, 1, "barb", "1/4", "barb", "1/4", { innerDiameterIn: 0.17 }, 0.1, true), // NEW
        part("soaker_half", "1/2 soaker", "dripline", "in_stock", 10, 1, 1, "barb", "1/2", "barb", "1/2", { flowGpm: 0.8, flowGpmPerMeter: 0.8, operatingPressurePsi: 10 }, 0.4, true), // NEW
        part("drip_half", "1/2 dripline", "dripline", "in_stock", 10, 1, 1, "barb", "1/2", "barb", "1/2", { flowGpm: 1, flowGpmPerMeter: 1, operatingPressurePsi: 12 }, 0.4, true) // NEW
    ] }; // NEW
    assert.equal(api.__test.resolveTemplateAnchorPart(catalog, [{ partId: "pipe_quarter" }, { partId: "pipe_half" }]).id, "pipe_half"); // NEW
    assert.equal(api.__test.resolveTemplateAnchorPart(catalog, [{ partId: "soaker_half" }]).id, "soaker_half"); // NEW
    assert.equal(api.__test.resolveTemplateAnchorPart(catalog, [{ partId: "drip_half" }, { partId: "pipe_half" }]).id, "pipe_half"); // NEW
}); // NEW

test("bed template BOM quantities, flow, pressure, and meter costs scale from row meters", () => { // NEW
    const { api } = loadPlugin(); // NEW
    const catalog = addDripTapeBomParts(sampleCatalog()); // NEW
    const bom = api.__test.computeBedTemplateBom(catalog, { width: 90, height: 45 }, "drip_tape_bed", 3, "width"); // NEW
    assert.ok(Math.abs(bom.rowLengthMeters - 1) < 0.0001); // CHANGE
    assert.ok(Math.abs(bom.totalRowMeters - 3) < 0.0001); // CHANGE
    assert.ok(Math.abs(bom.requiredParts[0].quantityMeters - 3) < 0.0001); // CHANGE
    assert.ok(Math.abs(bom.demand.flowGpm - 3.6) < 0.0001); // CHANGE
    assert.equal(bom.demand.operatingPressurePsi, 10); // NEW
    assert.ok(Math.abs(api.__test.partCostForRequiredMeters(catalog, "drip_tape_8mil_12in", 3) - (0.42 * (3 / 0.3048))) < 0.0001); // NEW
}); // NEW

test("bed recipe UI toggles self-emitting and device row controls", () => { // NEW
    const { api, graph, moduleCell, bed } = loadPlugin(); // NEW
    const catalog = addDripTapeBomParts(sampleCatalog()); // NEW
    catalog.items.push(part("overhead_sprinkler_head_30psi", "Overhead sprinkler head", "sprinkler", "in_stock", 14, 1, 1, "barb", "1/2", "barb", "1/2", { flowGpm: 2.5, operatingPressurePsi: 30 }, undefined, true)); // NEW
    api.writeCatalog(moduleCell, catalog); // NEW
    const bedAssembly = api.__test.createBedAssembly(moduleCell, bed, { x: 240, y: 120 }); // NEW
    api.openIrrigationMode(moduleCell, { preserveViewport: true }); // NEW
    graph.setSelectionCell(bedAssembly.assembly); // NEW
    const outletLabel = selectByLabel(graph.container, "Outlet part").parentNode; // NEW
    assert.match(outletLabel.getAttribute("style") || "", /display:\s*none/); // NEW
    assert.match(selectByLabel(graph.container, "Emitter/device part").parentNode.getAttribute("style") || "", /display:\s*none/); // NEW
    assert.match(selectByLabel(graph.container, "Header end cap").parentNode.getAttribute("style") || "", /display:\s*flex/); // NEW
    assert.equal(inputByLabel(graph.container, "Emitter spacing in").disabled, true); // NEW
    changeSelectByLabel(graph.container, "Inlet part", "fpt_to_half_barb"); // NEW
    assert.match(selectByLabel(graph.container, "Outlet part").parentNode.getAttribute("style") || "", /display:\s*flex/); // CHANGE
    assert.match(selectByLabel(graph.container, "Header end cap").parentNode.getAttribute("style") || "", /display:\s*flex/); // NEW
    changeSelectByLabel(graph.container, "Header end cap", "end_cap_1_2_barb"); // NEW
    assert.equal(selectByLabel(graph.container, "Outlet part").value, ""); // NEW
    assert.match(selectByLabel(graph.container, "Outlet part").parentNode.getAttribute("style") || "", /display:\s*none/); // NEW
    let template = api.__test.readBedAssemblyTemplateRecord(moduleCell, bedAssembly.assembly); // NEW
    assert.equal(template.headerEndCapPartId, "end_cap_1_2_barb"); // NEW
    assert.equal(template.outletPartId, ""); // NEW
    changeSelectByLabel(graph.container, "Header end cap", ""); // NEW
    assert.match(selectByLabel(graph.container, "Header end cap").parentNode.getAttribute("style") || "", /display:\s*flex/); // NEW
    assert.match(selectByLabel(graph.container, "Outlet part").parentNode.getAttribute("style") || "", /display:\s*flex/); // NEW
    changeSelectByLabel(graph.container, "Outlet part", "half_barb_to_3_4_barb"); // NEW
    assert.equal(selectByLabel(graph.container, "Header end cap").value, ""); // NEW
    assert.match(selectByLabel(graph.container, "Header end cap").parentNode.getAttribute("style") || "", /display:\s*none/); // NEW
    template = api.__test.readBedAssemblyTemplateRecord(moduleCell, bedAssembly.assembly); // NEW
    assert.equal(template.headerEndCapPartId, ""); // NEW
    assert.equal(template.outletPartId, "half_barb_to_3_4_barb"); // NEW
    changeSelectByLabel(graph.container, "Template", "overhead_sprinkler_block"); // NEW
    assert.match(selectByLabel(graph.container, "Emitter/device part").parentNode.getAttribute("style") || "", /display:\s*flex/); // CHANGE
    assert.equal(inputByLabel(graph.container, "Emitter spacing in").disabled, false); // NEW
}); // NEW

test("legacy bed terminal choices prefer outlet and clear header on next commit", () => { // NEW
    const { api, graph, moduleCell, bed } = loadPlugin(); // NEW
    api.writeCatalog(moduleCell, addDripTapeBomParts(sampleCatalog())); // NEW
    const bedAssembly = api.__test.createBedAssembly(moduleCell, bed, { x: 240, y: 120 }).assembly; // NEW
    const legacyTemplate = { templateModel: "bom", recipeVersion: 1, templateId: "drip_tape_bed", irrigationType: "drip_tape", inletPartId: "fpt_to_half_barb", outletPartId: "half_barb_to_3_4_barb", rowPartId: "drip_tape_8mil_12in", emitterPartId: "", rowTakeoffPartId: "barb_tee_1_2", rowEndCapPartId: "end_cap_1_2_barb", headerEndCapPartId: "end_cap_1_2_barb", supplyPipePartId: "poly_distribution_1_2", spacing: { rows: 2, emitterInches: 12, rowSpacingCm: 100 }, requiredParts: [], resolvedBomParts: [], partIds: ["fpt_to_half_barb", "half_barb_to_3_4_barb", "drip_tape_8mil_12in", "barb_tee_1_2", "end_cap_1_2_barb", "poly_distribution_1_2"] }; // NEW
    bedAssembly.value.setAttribute(api.attrs.BED_TEMPLATE_JSON, JSON.stringify(legacyTemplate)); // NEW
    api.openIrrigationMode(moduleCell, { preserveViewport: true }); // NEW
    graph.setSelectionCell(bedAssembly); // NEW
    assert.equal(selectByLabel(graph.container, "Outlet part").value, "half_barb_to_3_4_barb"); // NEW
    assert.equal(selectByLabel(graph.container, "Header end cap").value, ""); // NEW
    assert.match(selectByLabel(graph.container, "Header end cap").parentNode.getAttribute("style") || "", /display:\s*none/); // NEW
    assert.equal(JSON.parse(bedAssembly.getAttribute(api.attrs.BED_TEMPLATE_JSON)).headerEndCapPartId, "end_cap_1_2_barb"); // NEW
    const rows = inputTextByLabel(graph.container, "Rows", "3"); // NEW
    blurInput(rows); // NEW
    const template = api.__test.readBedAssemblyTemplateRecord(moduleCell, bedAssembly); // NEW
    assert.equal(template.outletPartId, "half_barb_to_3_4_barb"); // NEW
    assert.equal(template.headerEndCapPartId, ""); // NEW
}); // NEW

test("overhead sprinkler bed recipe resolves precise BOM roles", () => { // NEW
    const { api } = loadPlugin(); // NEW
    const catalog = addDripTapeBomParts(sampleCatalog()); // NEW
    catalog.items.push(part("overhead_sprinkler_head_30psi", "Overhead sprinkler head", "sprinkler", "in_stock", 14, 1, 1, "barb", "1/2", "barb", "1/2", { flowGpm: 2.5, operatingPressurePsi: 30 }, undefined, true)); // NEW
    const bom = api.__test.computeBedTemplateBom(catalog, { width: 306, height: 178 }, "overhead_sprinkler_block", 3, "width", { inletPartId: "fpt_to_half_barb", rowPartId: "poly_distribution_1_2", emitterPartId: "overhead_sprinkler_head_30psi", rowTakeoffPartId: "barb_tee_1_2", rowEndCapPartId: "end_cap_1_2_barb", headerEndCapPartId: "end_cap_1_2_barb", emitterSpacingIn: 12 }); // NEW
    const byRole = Object.fromEntries(bom.recipe.resolvedBomParts.map(entry => [entry.role, entry])); // NEW
    assert.equal(byRole.inlet.partId, "fpt_to_half_barb"); // NEW
    assert.equal(byRole.supply_pipe.partId, "poly_distribution_1_2"); // NEW
    assert.equal(byRole.row_line.partId, "poly_distribution_1_2"); // NEW
    assert.equal(byRole.row_takeoff.quantity, 3); // NEW
    assert.equal(byRole.row_end_cap.quantity, 3); // NEW
    assert.equal(byRole.header_end_cap.quantity, 1); // NEW
    assert.equal(byRole.emitter_device.partId, "overhead_sprinkler_head_30psi"); // NEW
    assert.equal(byRole.emitter_device.quantity, 36); // NEW
}); // NEW

test("moved bed supply line persists while BOM length remains formula based", () => { // NEW
    const harness = loadPlugin(); // NEW
    const { api, moduleCell, bed } = harness; // NEW
    const assembly = createCommittedDripTapeBedAssembly(harness, bed); // NEW
    const beforeTemplate = api.__test.readBedAssemblyTemplateRecord(moduleCell, assembly); // NEW
    const beforeSupply = bedSupplyLines(assembly, api)[0]; // NEW
    assert.ok(beforeSupply, "Missing generated supply line"); // NEW
    const beforeSupplyMeters = beforeTemplate.resolvedBomParts.find(entry => entry.role === "supply_pipe").quantity; // NEW
    beforeSupply.geometry = Object.assign({}, beforeSupply.geometry, { x: beforeSupply.geometry.x + 24 }); // NEW
    api.__test.commitBedTemplate(moduleCell, beforeTemplate.pathId, assembly, beforeTemplate); // NEW
    const afterTemplate = api.__test.readBedAssemblyTemplateRecord(moduleCell, assembly); // NEW
    const afterSupply = bedSupplyLines(assembly, api)[0]; // NEW
    assert.equal(afterSupply.geometry.x, beforeSupply.geometry.x); // NEW
    assert.equal(afterTemplate.resolvedBomParts.find(entry => entry.role === "supply_pipe").quantity, beforeSupplyMeters); // NEW
}); // NEW

test("bed assembly Exit closes before recipe field blur can rerender overlays", () => { // NEW
    const { api, graph, moduleCell, bed } = loadPlugin(); // NEW
    api.writeCatalog(moduleCell, addDripTapeBomParts(sampleCatalog())); // NEW
    const bedAssembly = api.__test.createBedAssembly(moduleCell, bed, { x: 240, y: 120 }); // NEW
    api.openIrrigationMode(moduleCell, { preserveViewport: true }); // NEW
    graph.setSelectionCell(bedAssembly.assembly); // NEW
    const rows = inputTextByLabel(graph.container, "Rows", "3"); // NEW
    assert.ok(graph.container.querySelector(".trellis-irrigation-mode-hud")); // NEW
    const exit = Array.from(graph.container.querySelectorAll("button")).find(node => node.textContent.trim() === "Exit"); // NEW
    assert.ok(exit, "Missing Exit button"); // NEW
    dispatchDomEvent(exit, "pointerdown"); // NEW
    blurInput(rows); // NEW
    assert.equal(api.isIrrigationModeActive(), false); // NEW
    assertNoActiveIrrigationOverlays(graph.container); // NEW
}); // NEW

test("bed assembly Exit clears selected port overlays without add-part UI", () => { // CHANGE
    const { api, graph, moduleCell, bed } = loadPlugin(); // NEW
    api.writeCatalog(moduleCell, addDripTapeBomParts(sampleCatalog())); // NEW
    const bedAssembly = api.__test.createBedAssembly(moduleCell, bed, { x: 240, y: 120 }); // NEW
    api.openIrrigationMode(moduleCell, { preserveViewport: true }); // NEW
    graph.setSelectionCell(bedAssembly.assembly); // NEW
    clickPort(graph.container, /Inlet 1 free/); // NEW
    assert.equal(graph.container.querySelector(".trellis-irrigation-add-part-picker"), null); // CHANGE
    assert.ok(portBadgesInState(graph.container, "selected").length >= 1); // NEW
    const exit = Array.from(graph.container.querySelectorAll("button")).find(node => node.textContent.trim() === "Exit"); // NEW
    assert.ok(exit, "Missing Exit button"); // NEW
    dispatchDomEvent(exit, "pointerdown"); // NEW
    assert.equal(api.isIrrigationModeActive(), false); // NEW
    assertNoActiveIrrigationOverlays(graph.container); // NEW
    assert.equal(graph.container.querySelector(".trellis-irrigation-add-part-picker"), null); // NEW
}); // NEW

test("bed template auto-apply blocks missing required parts and rejects one-sided boundary parts", () => { // CHANGE
    const { api, graph, moduleCell, bed } = loadPlugin(); // NEW
    api.writeCatalog(moduleCell, sampleCatalog()); // NEW
    const bedAssembly = api.__test.createBedAssembly(moduleCell, bed, { x: 240, y: 120 }); // NEW
    api.openIrrigationMode(moduleCell, { preserveViewport: true }); // NEW
    graph.setSelectionCell(bedAssembly.assembly); // NEW
    const rowInput = inputTextByLabel(graph.container, "Rows", "3"); // CHANGE
    blurInput(rowInput); // NEW
    assert.equal(bed.getAttribute(api.attrs.BED_TEMPLATE_JSON), null); // NEW
    assert.match(graph.container.textContent, /required .*missing.*drip_tape_8mil_12in|Missing required parts: drip_tape_8mil_12in/i); // CHANGE

    const catalog = addDripTapeBomParts(sampleCatalog()); // NEW
    const anchor = catalog.items.find(item => item.id === "drip_tape_8mil_12in"); // NEW
    assert.equal(api.__test.boundaryMatchForAnchor(catalog.items.find(item => item.id === "half_barb_plug"), anchor), null); // NEW
    assert.equal(api.__test.boundaryMatchForAnchor(catalog.items.find(item => item.id === "fpt_to_half_barb"), anchor).externalConnector.type, "fpt"); // NEW
    assert.equal(api.__test.boundaryMatchForAnchor(catalog.items.find(item => item.id === "half_barb_to_3_4_barb"), anchor).externalConnector.nominalSize, "3/4"); // NEW
}); // NEW

test("invalid bed template auto-apply preserves the previous saved layout", () => { // NEW
    const { api, graph, moduleCell, bed } = loadPlugin(); // NEW
    api.writeCatalog(moduleCell, addDripTapeBomParts(sampleCatalog())); // NEW
    const bedAssembly = api.__test.createBedAssembly(moduleCell, bed, { x: 240, y: 120 }); // NEW
    api.openIrrigationMode(moduleCell, { preserveViewport: true }); // NEW
    graph.setSelectionCell(bedAssembly.assembly); // NEW
    changeSelectByLabel(graph.container, "Inlet part", "fpt_to_half_barb"); // NEW
    changeSelectByLabel(graph.container, "Header end cap", "end_cap_1_2_barb"); // NEW
    assert.equal(api.__test.readBedAssemblyTemplateRecord(moduleCell, bedAssembly.assembly).spacing.rows, 2); // CHANGE
    assert.equal(bedLayoutRows(bedAssembly.assembly, api).length, 2); // NEW
    api.writeCatalog(moduleCell, sampleCatalog()); // NEW
    graph.setSelectionCell(bedAssembly.assembly); // NEW
    const rowInput = inputTextByLabel(graph.container, "Rows", "4"); // NEW
    blurInput(rowInput); // NEW
    assert.match(graph.container.textContent, /required .*missing.*drip_tape_8mil_12in|Missing required parts: drip_tape_8mil_12in/i); // CHANGE
    assert.equal(api.__test.readBedAssemblyTemplateRecord(moduleCell, bedAssembly.assembly).spacing.rows, 2); // CHANGE
    assert.equal(bedLayoutRows(bedAssembly.assembly, api).length, 2); // NEW
}); // NEW

test("irrigation mode rendering does not write derived zone or path state", () => { // CHANGE
    const { api, graph, model, moduleCell, bed } = loadPlugin(); // CHANGE
    api.writeCatalog(moduleCell, sampleCatalog()); // CHANGE
    const source = api.__test.createSourceAssembly(moduleCell, "Well", { connectorType: "barb", nominalSize: "1/2", pipeConnection: true, usableFlowGpm: 5, staticPressurePsi: 45 }, { x: 30, y: 40 }); // CHANGE
    const bedAssembly = api.__test.createBedAssembly(moduleCell, bed, { x: 30, y: 220 }); // CHANGE
    assert.equal(api.__test.createAssemblyConnection(moduleCell, { cellId: api.__test.firstAssemblyPart(source.assembly).getId(), role: "output", index: 0 }, { cellId: bedAssembly.assembly.getId(), role: "input", index: 0 }).ok, true); // CHANGE
    const writesBeforeOpen = model.valuesWritten; // CHANGE
    api.openIrrigationMode(moduleCell, { preserveViewport: true }); // CHANGE
    graph.setSelectionCell(bedAssembly.assembly); // CHANGE
    graph.view.fire("scale"); // CHANGE
    assert.equal(model.valuesWritten, writesBeforeOpen); // CHANGE
    assert.equal(moduleCell.getAttribute(api.attrs.PATHS_JSON), null); // CHANGE
    assert.equal(moduleCell.getAttribute(api.attrs.ZONES_JSON), null); // CHANGE
}); // CHANGE

test("opening zone manager is read-only", () => { // NEW
    const { api, graph, model, moduleCell, ui, bed } = loadPlugin(); // CHANGE
    api.writeCatalog(moduleCell, sampleCatalog()); // NEW
    const bedAssembly = api.__test.createBedAssembly(moduleCell, bed, { x: 240, y: 120 }); // NEW
    api.openIrrigationMode(moduleCell, { preserveViewport: true }); // NEW
    graph.setSelectionCell(bedAssembly.assembly); // NEW
    const writesBeforeOpen = model.valuesWritten; // NEW
    model.completedEdits = []; // NEW
    clickButton(graph.container, "Edit Zones"); // CHANGE
    assert.ok(ui.lastDialog); // NEW
    assert.match(ui.lastDialog.textContent, /New Manual Zone/); // NEW
    assert.equal(model.valuesWritten, writesBeforeOpen); // NEW
    assert.equal(model.completedEdits.length, 0); // NEW
}); // NEW

test("explicit report sync writes stable summaries but not the legacy path cache", () => { // CHANGE
    const { api, model, moduleCell, bed } = loadPlugin(); // CHANGE
    api.writeCatalog(moduleCell, sampleCatalog()); // CHANGE
    const source = api.__test.createSourceAssembly(moduleCell, "Well", { connectorType: "barb", nominalSize: "1/2", pipeConnection: true, usableFlowGpm: 5, staticPressurePsi: 45 }, { x: 30, y: 40 }); // CHANGE
    const bedAssembly = api.__test.createBedAssembly(moduleCell, bed, { x: 30, y: 220 }); // CHANGE
    api.__test.commitBedTemplate(moduleCell, "bed_one", bed, { templateId: "drip_tape_bed" }); // CHANGE
    assert.equal(api.__test.createAssemblyConnection(moduleCell, { cellId: api.__test.firstAssemblyPart(source.assembly).getId(), role: "output", index: 0 }, { cellId: bedAssembly.assembly.getId(), role: "input", index: 0 }).ok, true); // CHANGE
    const paths = api.__test.syncHudGraphState(moduleCell); // CHANGE
    assert.equal(paths.length, 1); // CHANGE
    assert.ok(moduleCell.getAttribute(api.attrs.REPORT_JSON)); // CHANGE
    assert.ok(moduleCell.getAttribute(api.attrs.DASHBOARD_JSON)); // CHANGE
    assert.equal(JSON.parse(moduleCell.getAttribute(api.attrs.REPORT_JSON)).summary.generatedAt, undefined); // NEW
    const writesAfterFirstSync = model.valuesWritten; // NEW
    api.__test.syncHudGraphState(moduleCell); // NEW
    assert.equal(model.valuesWritten, writesAfterFirstSync); // NEW
    assert.equal(moduleCell.getAttribute(api.attrs.PATHS_JSON), null); // CHANGE
}); // CHANGE

test("internal architecture facades expose domain seams without changing public contracts", () => { // NEW
    const { api, moduleCell } = loadPlugin(); // NEW
    assert.equal(api.readCatalog, api.__test.IrrigationCatalog.read); // NEW
    assert.equal(api.generateReport, api.__test.ReportModel.generate); // NEW
    assert.equal(api.openIrrigationMode, api.__test.HudController.open); // NEW
    assert.equal(api.zoneSummary, api.__test.ZoneModel.summary); // NEW
    assert.equal(api.assignBedsToZone, api.__test.ZoneModel.assignBeds); // NEW
    assert.equal(api.__test.deriveAssemblyPaths, api.__test.ReportModel.deriveAssemblyPaths); // NEW
    assert.equal(api.__test.createAssemblyConnection, api.__test.ConnectorRules.createAssemblyConnection); // NEW
    assert.equal(api.__test.validatePortConnection, api.__test.ConnectorRules.validatePortConnection); // NEW
    assert.equal(api.__test.connectionDecisionForPorts, api.__test.ConnectorRules.connectionDecision); // NEW
    assert.equal(api.__test.autoPipePartIdForConnection, api.__test.ConnectorRules.autoPipePartIdForConnection); // NEW
    assert.equal(api.__test.calculatePathHydraulics, api.__test.Hydraulics.calculatePath); // NEW
    assert.equal(api.__test.validateSharedCapacity, api.__test.Hydraulics.validateSharedCapacity); // NEW
    moduleCell.value.setAttribute(api.attrs.CATALOG_JSON, "{bad json"); // NEW
    assert.deepEqual(api.__test.GraphStore.readJsonAttr(moduleCell, api.attrs.CATALOG_JSON, { items: [] }), { items: [] }); // NEW
    const normalized = api.__test.IrrigationCatalog.normalizePart(part("filter", "Filter", "filter", "in_stock", 10, 1, 1, "barb", "3/4", "barb", "3/4", { pressureLossPsi: 1 }, undefined, true)); // NEW
    assert.equal(api.__test.IrrigationCatalog.validatePart(normalized).ok, true); // NEW
    assert.equal(api.__test.ConnectorRules.connectorMatches({ type: "mght", nominalSize: "3/4" }, { type: "fght", nominalSize: "3/4" }).ok, true); // NEW
    assert.equal(api.__test.Hydraulics.estimatePath({ catalog: { items: [] }, sourceProfile: { usableFlowGpm: 1, staticPressurePsi: 30 }, bedDemand: { flowGpm: 1, operatingPressurePsi: 10 } }).ok, true); // NEW
    assert.equal(api.__test.ZoneModel.normalize({ id: "z", originType: "manual" }).id, "z"); // NEW
}); // NEW

test("ZoneModel preserves inferred zones, manual overrides, ambiguous beds, and unzoned beds", () => { // NEW
    const { api, moduleCell, bed, bed2 } = loadPlugin(); // NEW
    const catalog = sampleCatalog(); // NEW
    catalog.items.push(part("timer_two", "Two Zone Timer", "controller_timer", "in_stock", 40, 1, 2, "barb", "1/2", "barb", "1/2", { maxFlowGpm: 3 }, undefined, true)); // NEW
    api.writeCatalog(moduleCell, catalog); // NEW
    const timer = api.__test.createPartAssembly(moduleCell, catalog.items.find(item => item.id === "timer_two"), { x: 30, y: 40 }); // NEW
    const bedOne = api.__test.createBedAssembly(moduleCell, bed, { x: 30, y: 180 }); // NEW
    const bedTwo = api.__test.createBedAssembly(moduleCell, bed2, { x: 30, y: 320 }); // NEW
    assert.equal(api.__test.ConnectorRules.createAssemblyConnection(moduleCell, { cellId: api.__test.firstAssemblyPart(timer.assembly).getId(), role: "output", index: 0 }, { cellId: bedOne.assembly.getId(), role: "input", index: 0 }).ok, true); // NEW
    const zones = api.__test.ZoneModel.sync(moduleCell); // NEW
    assert.equal(zones.length, 2); // NEW
    assert.equal(JSON.stringify(zones[0].inferredBedIds), JSON.stringify([bedOne.assembly.getId()])); // CHANGE
    const summary = api.__test.ZoneModel.summary(moduleCell, zones, []); // NEW
    assert.equal(summary.emptyZoneCount, 1); // NEW
    assert.equal(JSON.stringify(summary.unzonedBedIds), JSON.stringify([bedTwo.assembly.getId()])); // CHANGE
    const manual = api.__test.ZoneModel.createManual(moduleCell, "North", [bedTwo.assembly.getId()]); // NEW
    assert.equal(api.__test.ZoneModel.resolveMembership(moduleCell, api.__test.ZoneModel.read(moduleCell)).assignment.get(bedTwo.assembly.getId()).zoneId, manual.id); // NEW
    api.__test.ZoneModel.resetBedOverrides(moduleCell, [bedTwo.assembly.getId()]); // NEW
    assert.equal(api.__test.ZoneModel.resolveMembership(moduleCell, api.__test.ZoneModel.read(moduleCell)).assignment.has(bedTwo.assembly.getId()), false); // NEW
    const ambiguous = api.__test.ZoneModel.resolveMembership(moduleCell, [ // NEW
        api.__test.ZoneModel.normalize({ id: "zone_a", inferredBedIds: [bedOne.assembly.getId()] }), // NEW
        api.__test.ZoneModel.normalize({ id: "zone_b", inferredBedIds: [bedOne.assembly.getId()] }) // NEW
    ]); // NEW
    assert.equal(JSON.stringify(ambiguous.ambiguousBedIds), JSON.stringify([bedOne.assembly.getId()])); // CHANGE
    assert.equal(ambiguous.assignment.has(bedOne.assembly.getId()), false); // NEW
}); // NEW

test("report model builds summaries before explicit persistence", () => { // NEW
    const { api, model, moduleCell, bed } = loadPlugin(); // NEW
    api.writeCatalog(moduleCell, sampleCatalog()); // NEW
    const source = api.__test.createSourceAssembly(moduleCell, "Well", { connectorType: "barb", nominalSize: "1/2", pipeConnection: true, usableFlowGpm: 5, staticPressurePsi: 45 }, { x: 30, y: 40 }); // NEW
    const bedAssembly = api.__test.createBedAssembly(moduleCell, bed, { x: 30, y: 220 }); // NEW
    api.__test.commitBedTemplate(moduleCell, "bed_one", bed, { templateId: "drip_tape_bed" }); // NEW
    assert.equal(api.__test.createAssemblyConnection(moduleCell, { cellId: api.__test.firstAssemblyPart(source.assembly).getId(), role: "output", index: 0 }, { cellId: bedAssembly.assembly.getId(), role: "input", index: 0 }).ok, true); // NEW
    const writesBeforeBuild = model.valuesWritten; // NEW
    const paths = api.__test.deriveAssemblyPaths(moduleCell); // NEW
    const summary = api.__test.ReportModel.buildSummary(moduleCell, { paths }); // NEW
    assert.equal(model.valuesWritten, writesBeforeBuild); // NEW
    assert.equal(moduleCell.getAttribute(api.attrs.REPORT_JSON), null); // NEW
    assert.ok(summary.percentIrrigated > 0); // NEW
    const writesBeforePersist = model.valuesWritten; // NEW
    api.__test.ReportModel.persistSummary(moduleCell, summary); // NEW
    assert.equal(model.valuesWritten, writesBeforePersist + 2); // NEW
    assert.ok(moduleCell.getAttribute(api.attrs.REPORT_JSON)); // NEW
    assert.ok(moduleCell.getAttribute(api.attrs.DASHBOARD_JSON)); // NEW
    assert.equal(moduleCell.getAttribute(api.attrs.PATHS_JSON), null); // NEW
    assert.equal(moduleCell.getAttribute(api.attrs.ZONES_JSON), null); // NEW
}); // NEW

test("irrigation part lifecycle defaults legacy BOM parts to planned", () => { // NEW
    const { api, moduleCell, filterPart, bedAssembly, pipeEdges } = createLifecycleBomFixture(); // NEW
    filterPart.value.removeAttribute(api.attrs.PART_STATE); // NEW
    pipeEdges[0].value.removeAttribute(api.attrs.PART_STATE); // NEW
    const template = api.__test.readBedAssemblyTemplateRecord(moduleCell, bedAssembly); // NEW
    delete template.partState; // NEW
    bedAssembly.value.setAttribute(api.attrs.BED_TEMPLATE_JSON, JSON.stringify(template)); // NEW
    const rows = api.__test.buildBomRows(moduleCell); // NEW
    assert.equal(api.__test.partStateForCell(filterPart), api.__test.partStates.planned); // NEW
    assert.ok(rows.rows.some(row => row.partId === "filter_half_lifecycle")); // NEW
    assert.ok(rows.rows.some(row => row.partId === "drip_tape_8mil_12in")); // NEW
    assert.ok(rows.rows.some(row => row.partId === "poly_distribution_1_2")); // CHANGE
    assert.equal(rows.completedRows.length, 0); // NEW
}); // NEW

test("completed irrigation parts move to completed BOM rows and preserve total design value", () => { // NEW
    const { api, moduleCell, filterPart, bedAssembly, pipeEdges } = createLifecycleBomFixture(); // NEW
    api.__test.setPartCellState(filterPart, api.__test.partStates.completed); // NEW
    api.__test.setPipeEdgeState(pipeEdges[0], api.__test.partStates.completed); // NEW
    api.__test.setBedTemplatePartState(moduleCell, bedAssembly, api.__test.partStates.completed); // NEW
    const rows = api.__test.buildBomRows(moduleCell); // NEW
    assert.equal(rows.rows.some(row => row.partId === "filter_half_lifecycle"), false); // NEW
    assert.equal(rows.rows.some(row => row.partId === "drip_tape_8mil_12in"), false); // NEW
    assert.ok(rows.rows.some(row => row.partId === "poly_distribution_1_2"), "The uncompleted pipe edge should remain planned."); // CHANGE
    assert.ok(rows.completedRows.some(row => row.partId === "filter_half_lifecycle")); // NEW
    assert.ok(rows.completedRows.some(row => row.partId === "drip_tape_8mil_12in")); // NEW
    assert.ok(rows.completedRows.some(row => row.partId === "poly_distribution_1_2")); // CHANGE
    const summary = api.__test.ReportModel.buildSummary(moduleCell, { paths: api.__test.deriveAssemblyPaths(moduleCell) }); // NEW
    assert.equal(summary.purchaseNeededCount, rows.rows.filter(row => row.shortageQuantity > 0).length); // NEW
    assert.equal(summary.completedPartCount, rows.completedRows.length); // NEW
    assert.ok(summary.completedDesignValue > 0); // NEW
    assert.equal(summary.totalDesignValue, summary.plannedDesignValue + summary.completedDesignValue); // NEW
    assert.equal(summary.completedParts.some(row => row.partId === "filter_half_lifecycle"), true); // NEW
}); // NEW

test("HUD lifecycle actions mark selected assemblies completed and planned", () => { // NEW
    const { api, graph, moduleCell } = loadPlugin(); // NEW
    api.writeCatalog(moduleCell, sampleCatalog()); // NEW
    const assembly = api.__test.createPartAssembly(moduleCell, api.readCatalog(moduleCell).items.find(item => item.id === "filter"), { x: 30, y: 40 }).assembly; // NEW
    const partCell = api.__test.firstAssemblyPart(assembly); // NEW
    api.openIrrigationMode(moduleCell, { preserveViewport: true }); // NEW
    graph.setSelectionCell(assembly); // NEW
    assert.deepEqual(buttonTexts(lifecycleToggle(graph.container)), ["Planned", "Completed"]); // CHANGE
    assert.equal(lifecycleToggle(graph.container).querySelector('[aria-pressed="true"]').textContent, "Planned"); // NEW
    clickButton(lifecycleToggle(graph.container), "Completed"); // CHANGE
    assert.equal(partCell.getAttribute(api.attrs.PART_STATE), api.__test.partStates.completed); // NEW
    assert.equal(styleToken(partCell.style, "fillColor"), "#e8f5e9"); // NEW
    assert.equal(styleToken(assembly.style, "fillColor"), "#e8f5e9"); // NEW
    assert.equal(lifecycleToggle(graph.container).querySelector('[aria-pressed="true"]').textContent, "Completed"); // CHANGE
    clickButton(lifecycleToggle(graph.container), "Planned"); // CHANGE
    assert.equal(partCell.getAttribute(api.attrs.PART_STATE), api.__test.partStates.planned); // NEW
    assert.equal(styleToken(partCell.style, "fillColor"), "#ffffff"); // NEW
    assert.equal(styleToken(assembly.style, "fillColor"), "#ffffff"); // NEW
}); // NEW

test("HUD lifecycle actions mark standalone branchpoint catalog endpoints completed", () => { // NEW
    const { api, graph, moduleCell, branchpoint } = createLifecycleBranchpointFixture(); // NEW
    api.openIrrigationMode(moduleCell, { preserveViewport: true }); // NEW
    graph.setSelectionCell(branchpoint); // NEW
    clickButton(lifecycleToggle(graph.container), "Completed"); // CHANGE
    assert.equal(branchpoint.getAttribute(api.attrs.PART_STATE), api.__test.partStates.completed); // NEW
    assert.equal(styleToken(branchpoint.style, "fillColor"), "#e8f5e9"); // NEW
    const rows = api.__test.buildBomRows(moduleCell); // NEW
    assert.equal(rows.rows.some(row => row.partId === "branch_filter_lifecycle"), false); // NEW
    assert.equal(rows.completedRows.some(row => row.partId === "branch_filter_lifecycle"), true); // NEW
}); // NEW

test("HUD lifecycle actions show both directions for mixed selections", () => { // NEW
    const { api, graph, moduleCell } = loadPlugin(); // NEW
    api.writeCatalog(moduleCell, sampleCatalog()); // NEW
    const planned = api.__test.createPartAssembly(moduleCell, api.readCatalog(moduleCell).items.find(item => item.id === "filter"), { x: 30, y: 40 }).assembly; // NEW
    const completed = api.__test.createPartAssembly(moduleCell, api.readCatalog(moduleCell).items.find(item => item.id === "regulator"), { x: 220, y: 40 }).assembly; // NEW
    api.__test.setPartCellState(api.__test.firstAssemblyPart(completed), api.__test.partStates.completed); // NEW
    api.openIrrigationMode(moduleCell, { preserveViewport: true }); // NEW
    graph.setSelectionCells([planned, completed]); // NEW
    assert.deepEqual(buttonTexts(lifecycleToggle(graph.container)), ["Planned", "Completed"]); // CHANGE
    assert.equal(lifecycleToggle(graph.container).querySelectorAll('[aria-pressed="true"]').length, 0); // NEW
}); // NEW

test("HUD lifecycle actions mark selected pipe edges completed", () => { // NEW
    const { api, graph, moduleCell, pipeEdges } = createLifecycleBomFixture(); // NEW
    api.__test.setPipeEdgeState(pipeEdges[1], api.__test.partStates.completed); // NEW
    api.openIrrigationMode(moduleCell, { preserveViewport: true }); // NEW
    graph.setSelectionCell(pipeEdges[0]); // NEW
    clickButton(lifecycleToggle(graph.container), "Completed"); // CHANGE
    assert.equal(pipeEdges[0].getAttribute(api.attrs.PART_STATE), api.__test.partStates.completed); // NEW
    assert.equal(styleToken(pipeEdges[0].style, "strokeColor"), "#82b366"); // NEW
    assert.equal(styleToken(pipeEdges[0].style, "dashed"), "1"); // NEW
    const rows = api.__test.buildBomRows(moduleCell); // NEW
    assert.equal(rows.rows.some(row => row.partId === "poly_distribution_1_2"), false); // CHANGE
    assert.equal(rows.completedRows.some(row => row.partId === "poly_distribution_1_2"), true); // CHANGE
}); // NEW

test("HUD lifecycle actions mark selected bed assemblies completed and refresh reports", () => { // NEW
    const { api, graph, moduleCell, bedAssembly } = createLifecycleBomFixture(); // NEW
    api.openIrrigationMode(moduleCell, { preserveViewport: true }); // NEW
    graph.setSelectionCell(bedAssembly); // NEW
    clickButton(lifecycleToggle(graph.container), "Completed"); // CHANGE
    const template = api.__test.readBedAssemblyTemplateRecord(moduleCell, bedAssembly); // NEW
    assert.equal(template.partState, api.__test.partStates.completed); // NEW
    const layoutRows = bedLayoutRows(bedAssembly, api); // NEW
    assert.ok(layoutRows.length > 0); // NEW
    assert.equal(layoutRows.every(row => row.getAttribute(api.attrs.PART_STATE) === api.__test.partStates.completed), true); // NEW
    assert.equal(layoutRows.every(row => styleToken(row.style, "fillColor") === "#e8f5e9"), true); // NEW
    const rows = api.__test.buildBomRows(moduleCell); // NEW
    assert.equal(rows.rows.some(row => row.partId === "drip_tape_8mil_12in"), false); // NEW
    assert.equal(rows.completedRows.some(row => row.partId === "drip_tape_8mil_12in"), true); // NEW
    const summary = api.readDashboardSummary(moduleCell); // NEW
    assert.equal(summary.completedParts.some(row => row.partId === "drip_tape_8mil_12in"), true); // NEW
}); // NEW

test("multi-pipe assembly hydraulics sum per-segment pipe losses", () => { // CHANGE
    const { api, moduleCell, bed } = loadPlugin(); // CHANGE
    const catalog = sampleCatalog(); // CHANGE
    catalog.items.push(part("reducer_3_4_to_1_2", "Reducer", "fitting", "in_stock", 4, 1, 1, "barb", "3/4", "barb", "1/2", { pressureLossPsi: 0.3 }, undefined, true)); // CHANGE
    api.writeCatalog(moduleCell, catalog); // CHANGE
    const source = api.__test.createSourceAssembly(moduleCell, "Well", { connectorType: "barb", nominalSize: "3/4", pipeConnection: true, usableFlowGpm: 5, staticPressurePsi: 45 }, { x: 30, y: 40 }); // CHANGE
    const filter = api.__test.createPartAssembly(moduleCell, catalog.items.find(item => item.id === "filter"), { x: 30, y: 160 }); // CHANGE
    const reducer = api.__test.createPartAssembly(moduleCell, catalog.items.find(item => item.id === "reducer_3_4_to_1_2"), { x: 30, y: 280 }); // CHANGE
    const bedAssembly = api.__test.createBedAssembly(moduleCell, bed, { x: 30, y: 400 }); // CHANGE
    api.__test.commitBedTemplate(moduleCell, "bed_one", bed, { templateId: "drip_tape_bed" }); // CHANGE
    assert.equal(api.__test.createAssemblyConnection(moduleCell, { cellId: api.__test.firstAssemblyPart(source.assembly).getId(), role: "output", index: 0 }, { cellId: api.__test.firstAssemblyPart(filter.assembly).getId(), role: "input", index: 0 }).ok, true); // CHANGE
    assert.equal(api.__test.createAssemblyConnection(moduleCell, { cellId: api.__test.firstAssemblyPart(filter.assembly).getId(), role: "output", index: 0 }, { cellId: api.__test.firstAssemblyPart(reducer.assembly).getId(), role: "input", index: 0 }).ok, true); // CHANGE
    assert.equal(api.__test.createAssemblyConnection(moduleCell, { cellId: api.__test.firstAssemblyPart(reducer.assembly).getId(), role: "output", index: 0 }, { cellId: bedAssembly.assembly.getId(), role: "input", index: 0 }).ok, true); // CHANGE
    const edges = api.__test.collectAssemblyEdges(moduleCell); // CHANGE
    edges.forEach(edge => setMeasuredEdgeLength(edge, edge.getAttribute(api.attrs.PIPE_PART_ID) === "pipe_half" ? 25 : 40)); // CHANGE
    const pathRecord = api.__test.syncHudGraphState(moduleCell)[0]; // CHANGE
    const calculated = api.__test.Hydraulics.calculatePath(moduleCell, pathRecord); // NEW
    const segments = api.__test.Hydraulics.pipeSegmentsForPath(moduleCell, pathRecord); // NEW
    const expectedPipeLoss = pathRecord.pipeSegments.reduce((sum, segment) => { // CHANGE
        const pipe = catalog.items.find(item => item.id === segment.pipePartId); // CHANGE
        return sum + api.__test.hazenWilliamsPsiLoss({ lengthFt: segment.lengthFt, flowGpm: pathRecord.hydraulic.flowGpm, diameterIn: pipe.specs.innerDiameterIn, c: pipe.specs.hazenWilliamsC }); // CHANGE
    }, 0); // CHANGE
    assert.equal(pathRecord.pipeSegments.length, 3); // CHANGE
    assert.equal(segments.length, 3); // NEW
    assert.ok(pathRecord.pipeSegments.some(segment => segment.pipePartId === "pipe_half")); // CHANGE
    assert.equal(calculated.flowGpm, pathRecord.hydraulic.flowGpm); // NEW
    assert.ok(Math.abs(calculated.pressureLossPsi - pathRecord.hydraulic.pressureLossPsi) < 0.0001); // NEW
    assert.ok(Math.abs(pathRecord.hydraulic.pressureLossPsi - (expectedPipeLoss + 2 + 0.3)) < 0.0001); // CHANGE
}); // CHANGE

test("missing pipe edge geometry blocks hydraulic completeness", () => { // CHANGE
    const { api, moduleCell, bed } = loadPlugin(); // CHANGE
    api.writeCatalog(moduleCell, sampleCatalog()); // CHANGE
    const source = api.__test.createSourceAssembly(moduleCell, "Well", { connectorType: "barb", nominalSize: "1/2", pipeConnection: true, usableFlowGpm: 5, staticPressurePsi: 45 }, { x: 30, y: 40 }); // CHANGE
    const bedAssembly = api.__test.createBedAssembly(moduleCell, bed, { x: 30, y: 220 }); // CHANGE
    api.__test.commitBedTemplate(moduleCell, "bed_one", bed, { templateId: "drip_tape_bed" }); // CHANGE
    assert.equal(api.__test.createAssemblyConnection(moduleCell, { cellId: api.__test.firstAssemblyPart(source.assembly).getId(), role: "output", index: 0 }, { cellId: bedAssembly.assembly.getId(), role: "input", index: 0 }).ok, true); // CHANGE
    const pathRecord = api.__test.syncHudGraphState(moduleCell)[0]; // CHANGE
    const summary = JSON.parse(moduleCell.getAttribute(api.attrs.REPORT_JSON)).summary; // CHANGE
    assert.equal(pathRecord.hydraulic.ok, false); // CHANGE
    assert.ok(pathRecord.hydraulic.warnings.includes("Pipe edge length is missing; pressure loss was not estimated.")); // CHANGE
    assert.equal(Math.round(summary.completeness), 0); // CHANGE
    assert.ok(summary.criticalWarnings.includes("Pipe edge length is missing; pressure loss was not estimated.")); // CHANGE
}); // CHANGE

test("daisy-chained bed assemblies use cumulative downstream demand", () => { // NEW
    const { api, moduleCell, bed, bed2 } = loadPlugin(); // NEW
    api.writeCatalog(moduleCell, sampleCatalog()); // NEW
    const source = api.__test.createSourceAssembly(moduleCell, "Half inch source", { connectorType: "barb", nominalSize: "1/2", method: "drip", pipeConnection: true, usableFlowGpm: 5, staticPressurePsi: 45 }, { x: 30, y: 40 }); // NEW
    const bedOne = api.__test.createBedAssembly(moduleCell, bed, { x: 30, y: 180 }); // NEW
    const bedTwo = api.__test.createBedAssembly(moduleCell, bed2, { x: 30, y: 320 }); // NEW
    api.__test.commitBedTemplate(moduleCell, "bed_one", bed, { templateId: "drip_tape_bed", spacing: { rows: 2, emitterInches: 12 } }); // NEW
    api.__test.commitBedTemplate(moduleCell, "bed_two", bed2, { templateId: "drip_tape_bed", spacing: { rows: 2, emitterInches: 12 } }); // NEW
    assert.equal(api.__test.createAssemblyConnection(moduleCell, { cellId: api.__test.firstAssemblyPart(source.assembly).getId(), role: "output", index: 0 }, { cellId: bedOne.assembly.getId(), role: "input", index: 0 }).ok, true); // NEW
    assert.equal(api.__test.createAssemblyConnection(moduleCell, { cellId: bedOne.assembly.getId(), role: "output", index: 0 }, { cellId: bedTwo.assembly.getId(), role: "input", index: 0 }).ok, true); // NEW
    const paths = api.__test.syncHudGraphState(moduleCell); // NEW
    const pathOne = paths.find(path => path.targetBedId === bed.getId()); // NEW
    const pathTwo = paths.find(path => path.targetBedId === bed2.getId()); // NEW
    assert.equal(pathOne.hydraulic.flowGpm, 2.4); // NEW
    assert.equal(pathTwo.hydraulic.flowGpm, 1.2); // NEW
}); // NEW

test("public API is mode-focused while legacy path helpers remain isolated under __test", () => { // NEW
    const { api } = loadPlugin(); // NEW
    ["openIrrigationMode", "closeIrrigationMode", "openCatalogManager", "generateReport", "readDashboardSummary"].forEach(name => assert.equal(typeof api[name], "function", name)); // NEW
    ["stagePath", "commitStagedPath", "commitBedTemplate", "createSourceEndpoint", "createBedEndpoint", "createBranchpointEndpoint"].forEach(name => assert.equal(api[name], undefined, name)); // NEW
    ["deriveAssemblyPaths", "createAssemblyConnection", "bridgeSuggestionsForPorts"].forEach(name => assert.equal(typeof api.__test[name], "function", name)); // NEW
}); // NEW

test("irrigation planner registration and dashboard wiring remain present", () => { // NEW
    const appSource = fs.readFileSync(path.join(PROJECT_ROOT, "drawio/src/main/webapp/js/diagramly/App.js"), "utf8"); // NEW
    const bundledSource = fs.readFileSync(path.join(PROJECT_ROOT, "drawio/src/main/webapp/js/app.min.js"), "utf8"); // NEW
    const dashboardSource = fs.readFileSync(path.join(PROJECT_ROOT, "drawio/src/main/webapp/plugins/garden_planner_plugins/Garden_Dashboard.js"), "utf8"); // NEW
    assert.match(appSource, /'gardenIrrigationPlanner': 'plugins\/garden_planner_plugins\/Garden_Irrigation_Planner\.js'/); // NEW
    assert.match(bundledSource, /gardenEquipment gardenIrrigationPlanner/); // NEW
    assert.match(dashboardSource, /irrigation_dashboard_summary_json/); // NEW
    assert.match(dashboardSource, /openIrrigationPlannerForDashboard/); // NEW
}); // NEW
