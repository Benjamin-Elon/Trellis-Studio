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
    constructor(root) { this.root = root; this.valuesWritten = 0; this.updateDepth = 0; this.removedCells = []; } // NEW
    getRoot() { return this.root; } // NEW
    getParent(cell) { return cell && cell.parent ? cell.parent : null; } // NEW
    getChildCount(cell) { return cell && cell.children ? cell.children.length : 0; } // NEW
    getChildAt(cell, index) { return cell.children[index]; } // NEW
    getGeometry(cell) { return cell && cell.geometry; } // NEW
    setValue(cell, value) { cell.value = value; this.valuesWritten += 1; } // NEW
    setGeometry(cell, value) { cell.geometry = value; } // NEW
    remove(cell) { // NEW
        this.removedCells.push(cell); // NEW
        if (cell && cell.parent && cell.parent.children) cell.parent.children = cell.parent.children.filter(child => child !== cell); // NEW
    } // NEW
    beginUpdate() { this.updateDepth += 1; } // NEW
    endUpdate() { this.updateDepth -= 1; } // NEW
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
    const dom = new JSDOM("<!doctype html><body><div id='graph'></div></body>"); // NEW
    const document = dom.window.document; // NEW
    const root = new TestCell("root"); // NEW
    const moduleCell = appendChild(root, makeXmlCell(document, "module", { garden_module: "1", label: "Garden" }, { x: 0, y: 0, width: 720, height: 520 })); // NEW
    const bed = appendChild(moduleCell, makeXmlCell(document, "bed", { garden_bed: "1", label: "Bed 1" }, { x: 120, y: 120, width: 120, height: 60 })); // NEW
    const bed2 = appendChild(moduleCell, makeXmlCell(document, "bed2", { garden_bed: "1", label: "Bed 2" }, { x: 280, y: 120, width: 120, height: 60 })); // NEW
    const container = document.getElementById("graph"); // NEW
    Object.defineProperty(container, "clientWidth", { value: options.clientWidth || 1000, configurable: true }); // NEW
    Object.defineProperty(container, "clientHeight", { value: options.clientHeight || 700, configurable: true }); // NEW
    const model = new TestModel(root); // NEW
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
        container, // NEW
        view: { // NEW
            overlayPane: container, // NEW
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
        getCellAt() { return null; }, // NEW
        insertVertex(parent, id, label, x, y, width, height, style) { return appendChild(parent, new TestCell(id || "v" + nextId++, label || "", { x, y, width, height }, style || "")); }, // NEW
        insertEdge(parent, id, label, source, target, style) { // NEW
            const edge = appendChild(parent, new TestCell(id || "e" + nextId++, label || "", { points: [] }, style || "")); // NEW
            edge.source = source; // NEW
            edge.target = target; // NEW
            return edge; // NEW
        } // NEW
    }; // NEW
    const ui = { // NEW
        editor: { graph }, // NEW
        actions: { addAction(id, fn) { actions.set(id, { funct: fn }); } }, // NEW
        showDialog(node) { ui.lastDialog = node; ui.hidden = false; ui.showCount = (ui.showCount || 0) + 1; }, // NEW
        hideDialog() { ui.hidden = true; ui.hideCount = (ui.hideCount || 0) + 1; }, // NEW
        alert(message) { ui.lastAlert = message; } // NEW
    }; // NEW
    const context = { // NEW
        window: dom.window, // NEW
        document, // NEW
        console: { log() {} }, // NEW
        Date, // NEW
        setTimeout, // NEW
        clearTimeout, // NEW
        alert(message) { context.lastAlert = message; }, // NEW
        Draw: { loadPlugin(callback) { callback(ui); } }, // NEW
        mxEvent: { CHANGE: "change", CLICK: "click", CELLS_ADDED: "cellsAdded", ADD_CELLS: "addCells", SCALE: "scale", TRANSLATE: "translate", SCALE_AND_TRANSLATE: "scaleAndTranslate", getClientX(evt) { return evt && evt.clientX || 0; }, getClientY(evt) { return evt && evt.clientY || 0; } }, // CHANGE
        mxUtils: { // NEW
            convertPoint(_container, x, y) { return { x, y }; }, // NEW
            createXmlDocument() { return document.implementation.createDocument("", "", null); }, // NEW
            htmlEntities(value) { return String(value).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[ch])); }, // NEW
            button(label, fn) { const button = document.createElement("button"); button.textContent = label; button.addEventListener("click", fn); return button; } // NEW
        } // NEW
    }; // NEW
    vm.runInNewContext(fs.readFileSync(PLUGIN_PATH, "utf8"), context, { filename: PLUGIN_PATH }); // NEW
    return { api: graph.__trellisIrrigationPlanner, graph, model, root, moduleCell, bed, bed2, document, ui, actions }; // NEW
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

function part(id, name, category, stockState, cost, inputs, outputs, inputType, inputSize, outputType, outputSize, specs = {}, unitCost, pipeConnection = false) { // CHANGE
    return { // NEW
        id, name, category, stockState, cost, unitCost, // NEW
        connectors: { inputs, outputs, input: { type: inputType, nominalSize: inputSize, method: "drip", pipeConnection }, output: { type: outputType, nominalSize: outputSize, method: "drip", maxFlowGpm: specs.maxFlowGpm, pipeConnection } }, // CHANGE
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

function clickButton(root, text) { // NEW
    const button = Array.from(root.querySelectorAll("button")).find(node => node.textContent.includes(text)); // NEW
    assert.ok(button, "Missing button: " + text); // NEW
    button.click(); // NEW
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

function assemblyCells(moduleCell, api) { // NEW
    return descendants(moduleCell, cell => cell.getAttribute && cell.getAttribute(api.attrs.ASSEMBLY) === "1"); // NEW
} // NEW

function connectionRow(root, label) { // NEW
    const row = Array.from(root.querySelectorAll(".trellis-irrigation-connection-row")).find(node => node.textContent.includes(label)); // NEW
    assert.ok(row, "Missing connection row: " + label); // NEW
    return row; // NEW
} // NEW

function chooseConnectionPart(root, label, partId) { // NEW
    const select = connectionRow(root, label).querySelector("select"); // NEW
    assert.ok(select, "Missing connection dropdown: " + label); // NEW
    select.value = partId; // NEW
    select.dispatchEvent(new root.ownerDocument.defaultView.Event("change")); // NEW
    return select; // NEW
} // NEW

function nextTick() { // NEW
    return new Promise(resolve => setTimeout(resolve, 0)); // NEW
} // NEW

test("catalog manager renders category/size group headers, catalog filters, and connector dropdowns", () => { // CHANGE
    const { api, moduleCell, ui } = loadPlugin(); // NEW
    api.writeCatalog(moduleCell, sampleCatalog()); // NEW
    api.openCatalogManager(moduleCell); // NEW
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
    assert.ok(selects.some(select => Array.from(select.options).some(option => option.value === "pipe" && option.textContent === "Pipe"))); // CHANGE
    assert.doesNotMatch(ui.lastDialog.textContent, /\bID\b/); // CHANGE
    assert.doesNotMatch(ui.lastDialog.textContent, /Method/); // CHANGE
    assert.doesNotMatch(ui.lastDialog.textContent, /uses pipe/i); // CHANGE
    assert.doesNotMatch(ui.lastDialog.textContent, /Hazen-Williams/); // CHANGE
    assert.doesNotMatch(ui.lastDialog.textContent, /Pipe inner diameter/); // CHANGE
    ui.lastDialog.querySelector(".trellis-irrigation-catalog-connection-filter").value = ""; // CHANGE
    ui.lastDialog.querySelector(".trellis-irrigation-catalog-connection-filter").dispatchEvent(new ui.lastDialog.ownerDocument.defaultView.Event("change")); // CHANGE
    ui.lastDialog.querySelector("[data-part-id='pipe_cheap']").click(); // CHANGE
    assert.match(ui.lastDialog.textContent, /Unit cost per ft/); // CHANGE
    assert.match(ui.lastDialog.textContent, /Pipe inner diameter/); // CHANGE
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
        "twist_lock_adapter_1_4_to_1", // NEW
        "push_connect_coupler_1_4", // NEW
        "push_connect_tee_1_2", // NEW
        "push_connect_elbow_3_4", // NEW
        "push_connect_end_cap_1", // NEW
        "push_connect_adapter_1_to_1_4" // NEW
    ].forEach(id => assert.ok(ids.has(id), "Missing starter part " + id)); // NEW
    assert.equal(catalog.items.some(item => [item.connectors.input, item.connectors.output].some(connector => connector && connector.type === "ght")), false); // NEW
    assert.equal(catalog.items.find(item => item.id === "hose_splitter_2way_3_4_fght_mght").connectors.outputs, 2); // NEW
    assert.equal(catalog.items.find(item => item.id === "hose_splitter_4way_3_4_fght_mght").connectors.outputs, 4); // NEW
    assert.equal(catalog.items.find(item => item.id === "twist_lock_adapter_1_4_to_1").connectors.input.type, "pipe"); // CHANGE
    assert.equal(catalog.items.find(item => item.id === "push_connect_adapter_1_to_1_4").connectors.output.type, "pipe"); // CHANGE
    assert.equal(catalog.items.find(item => item.id === "poly_mainline_1").specs.hazenWilliamsC, 150); // CHANGE
    assert.equal(catalog.items.find(item => item.id === "pc_dripline_1_2").specs.minOperatingPressurePsi, 12); // CHANGE
    assert.equal(catalog.items.find(item => item.id === "pc_dripline_1_2").specs.operatingPressurePsi, undefined); // CHANGE
    catalog.items.forEach(item => assert.equal(api.validateCatalogPart(item).ok, true, item.id)); // NEW
}); // NEW

test("connector compatibility respects GHT and pipe-thread gender", () => { // NEW
    const { api } = loadPlugin(); // NEW
    const c = type => ({ type, nominalSize: "3/4", method: "drip" }); // NEW
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
    assert.equal(api.__test.connectorMatches(c("mght"), { type: "fght", nominalSize: "1/2", method: "drip" }).ok, false); // NEW
}); // NEW

test("hydraulics use minimum operating psi and warn over maximum operating psi", () => { // CHANGE
    const { api } = loadPlugin(); // CHANGE
    const catalog = { items: [part("spray", "Spray", "sprinkler", "in_stock", 10, 1, 1, "pipe", "1/2", "pipe", "1/2", { flowGpm: 1, minOperatingPressurePsi: 10, maxOperatingPressurePsi: 20, pressureLossPsi: 0 })] }; // CHANGE
    const result = api.__test.estimatePathHydraulics({ catalog, sourceProfile: { connectorType: "pipe", nominalSize: "1/2", usableFlowGpm: 2, staticPressurePsi: 45 }, bedDemand: { flowGpm: 1, operatingPressurePsi: 10 }, partIds: ["spray"], lengthFt: 0 }); // CHANGE
    assert.equal(result.requiredPressurePsi, 10); // CHANGE
    assert.equal(result.maxOperatingPressurePsi, 20); // CHANGE
    assert.match(result.warnings.join("\n"), /maximum operating pressure/); // CHANGE
}); // CHANGE

test("unit-cost line categories use route length when available", () => { // CHANGE
    const { api, moduleCell, bed, bed2 } = loadPlugin(); // CHANGE
    const catalog = { items: [part("dripline_costed", "Costed dripline", "dripline", "in_stock", 50, 1, 1, "pipe", "1/2", "pipe", "1/2", { flowGpm: 1, minOperatingPressurePsi: 10 }, 2)] }; // CHANGE
    const pathRecord = { sourceEndpointId: bed.getId(), targetEndpointId: bed2.getId() }; // CHANGE
    const lengthFt = api.__test.pathRouteLengthFeet(moduleCell, pathRecord); // CHANGE
    assert.ok(lengthFt > 0); // CHANGE
    assert.equal(api.__test.partCostForReport(moduleCell, catalog, pathRecord, "dripline_costed"), 2 * lengthFt); // CHANGE
}); // CHANGE

test("starter catalog upgrade merges new parts into existing catalogs without overwriting user edits", () => { // NEW
    const { api, moduleCell } = loadPlugin(); // NEW
    api.writeCatalog(moduleCell, { items: [ // NEW
        part("filter", "User Edited Filter", "filter", "in_stock", 99, 1, 1, "barb", "3/4", "barb", "3/4", { pressureLossPsi: 4 }), // NEW
        part("custom_micro", "Custom micro part", "fitting", "in_stock", 1, 1, 1, "barb", "1/4", "barb", "1/4", { pressureLossPsi: 0.1 }) // NEW
    ] }); // NEW
    const stored = JSON.parse(moduleCell.getAttribute(api.attrs.CATALOG_JSON)); // NEW
    stored.version = 1; // NEW
    moduleCell.value.setAttribute(api.attrs.CATALOG_JSON, JSON.stringify(stored)); // NEW
    const upgraded = api.seedStarterCatalogIfEmpty(moduleCell); // NEW
    const filter = upgraded.items.find(item => item.id === "filter"); // NEW
    assert.equal(upgraded.version, 3); // CHANGE
    assert.equal(filter.name, "User Edited Filter"); // NEW
    assert.equal(filter.cost, 99); // NEW
    assert.ok(upgraded.items.some(item => item.id === "poly_mainline_1")); // NEW
    assert.ok(upgraded.items.some(item => item.id === "micro_tubing_1_4")); // NEW
    assert.ok(upgraded.items.some(item => item.id === "twist_lock_adapter_1_4_to_1")); // NEW
    assert.ok(upgraded.items.some(item => item.id === "push_connect_adapter_1_to_1_4")); // NEW
    assert.ok(upgraded.items.some(item => item.id === "custom_micro")); // NEW
}); // NEW

test("source commit creates a source assembly at the latest click point and HUD follows zoom events", () => { // NEW
    const { api, graph, moduleCell, actions } = loadPlugin(); // NEW
    api.writeCatalog(moduleCell, sampleCatalog()); // NEW
    actions.get("trellisIrrigationPlanner").funct(); // NEW
    graph.fireMouseMove(310, 180); // NEW
    clickButton(graph.container, "Create Source"); // NEW
    clickButton(graph.container, "Commit Source"); // NEW
    const sourceAssembly = assemblyCells(moduleCell, api)[0]; // NEW
    assert.equal(sourceAssembly.getAttribute(api.attrs.ASSEMBLY_TYPE), "source"); // NEW
    assert.equal(sourceAssembly.geometry.x, 310); // NEW
    assert.equal(sourceAssembly.geometry.y, 180); // NEW
    assert.equal(graph.getSelectionCell(), sourceAssembly); // NEW
    assert.ok(api.__test.firstAssemblyPart(sourceAssembly).getAttribute(api.attrs.ENDPOINT_PROFILE_JSON).includes("mght")); // CHANGE
    graph.view.scale = 1.4; // NEW
    graph.view.fire("scale"); // NEW
    assert.ok(graph.container.querySelector(".trellis-irrigation-mode-hud")); // NEW
}); // NEW

test("Add Part groups global options and creates an unconnected assembly without context", () => { // CHANGE
    const { api, graph, moduleCell, actions } = loadPlugin(); // NEW
    api.writeCatalog(moduleCell, sampleCatalog()); // NEW
    actions.get("trellisIrrigationPlanner").funct(); // NEW
    assert.match(graph.container.textContent, /Add Part/); // NEW
    graph.fireMouseMove(360, 220); // NEW
    clickButton(graph.container, "Add Part"); // NEW
    const form = graph.container.querySelector(".trellis-irrigation-add-assembly-form"); // NEW
    const select = form.querySelector("select"); // CHANGE
    const groups = Array.from(select.querySelectorAll("optgroup")).map(group => group.label); // NEW
    assert.ok(groups.includes("In stock / Control & protection")); // NEW
    assert.ok(groups.includes("In stock / Distribution")); // NEW
    assert.ok(groups.includes("Needs purchase / Water application")); // NEW
    select.value = "filter"; // NEW
    clickButton(form, "Add Part"); // CHANGE
    const partAssembly = assemblyCells(moduleCell, api)[0]; // NEW
    assert.equal(partAssembly.getAttribute(api.attrs.ASSEMBLY_TYPE), "parts"); // NEW
    assert.equal(api.__test.firstAssemblyPart(partAssembly).getAttribute(api.attrs.CATALOG_PART_ID), "filter"); // NEW
    assert.equal(partAssembly.geometry.x, 360); // NEW
    assert.doesNotMatch(graph.container.textContent, /Create Source/); // NEW
    assert.match(graph.container.textContent, /Add Part/); // CHANGE
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
    const disabled = connectionRow(graph.container, "Inlet 1").querySelector("select"); // NEW
    assert.equal(disabled.disabled, true); // CHANGE
    assert.ok(connectionRow(graph.container, "Outlet 1")); // CHANGE
}); // NEW

test("connection dropdown inserts free same-lane parts and splits occupied internal chains", () => { // NEW
    const { api, graph, moduleCell } = loadPlugin(); // NEW
    api.writeCatalog(moduleCell, sampleCatalog()); // NEW
    const assembly = api.__test.createPartAssembly(moduleCell, api.readCatalog(moduleCell).items.find(item => item.id === "filter"), { x: 30, y: 40 }).assembly; // NEW
    api.openIrrigationMode(moduleCell, { preserveViewport: true }); // NEW
    graph.setSelectionCell(api.__test.firstAssemblyPart(assembly)); // NEW
    chooseConnectionPart(graph.container, "Outlet 1", "regulator"); // NEW
    assert.equal(JSON.stringify(api.__test.assemblyPartCells(assembly).map(cell => cell.getAttribute(api.attrs.CATALOG_PART_ID))), JSON.stringify(["filter", "regulator"])); // CHANGE
    graph.setSelectionCell(api.__test.firstAssemblyPart(assembly)); // NEW
    chooseConnectionPart(graph.container, "Outlet 1", "valve"); // NEW
    const assemblies = assemblyCells(moduleCell, api).filter(cell => cell.getAttribute(api.attrs.ASSEMBLY_TYPE) === "parts"); // NEW
    assert.equal(assemblies.length, 2); // NEW
    assert.equal(JSON.stringify(api.__test.assemblyPartCells(assembly).map(cell => cell.getAttribute(api.attrs.CATALOG_PART_ID))), JSON.stringify(["filter", "valve"])); // CHANGE
    const split = assemblies.find(cell => cell !== assembly); // NEW
    assert.equal(JSON.stringify(api.__test.assemblyPartCells(split).map(cell => cell.getAttribute(api.attrs.CATALOG_PART_ID))), JSON.stringify(["regulator"])); // CHANGE
    assert.ok(split.geometry.y > assembly.geometry.y); // NEW
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
    clickButton(graph.container, "Connect"); // NEW
    const edge = api.__test.collectAssemblyEdges(moduleCell)[0]; // NEW
    assert.ok(edge); // NEW
    assert.equal(edge.getAttribute(api.attrs.PIPE_PART_ID), "pipe_cheap"); // NEW
    graph.setSelectionCells([source.assembly, filter.assembly]); // NEW
    clickPort(graph.container, /Outlet 1 connected/); // NEW
    clickPort(graph.container, /Inlet 1 connected/); // NEW
    clickButton(graph.container, "Disconnect Selected"); // NEW
    assert.equal(api.__test.collectAssemblyEdges(moduleCell).length, 0); // NEW
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
    assert.match(graph.container.textContent, /Connect/); // NEW
    assert.equal(graph.getSelectionCell(), filter.assembly); // NEW
    clickButton(graph.container, "Connect"); // NEW
    assert.equal(api.__test.collectAssemblyEdges(moduleCell).length, 1); // NEW
    graph.setSelectionCells([source.assembly, filter.assembly]); // NEW
    assert.ok(portBadgesInState(graph.container, "occupied").length >= 2); // NEW
    assert.equal(portBadgesInState(graph.container, "compatible").length, 0); // NEW
    clickPort(graph.container, /Outlet 1 connected/); // NEW
    assert.equal(portBadgesInState(graph.container, "compatible").length, 0); // NEW
    clickPort(graph.container, /Inlet 1 connected/); // NEW
    assert.match(graph.container.textContent, /Disconnect Selected/); // NEW
}); // NEW

test("multi-output dropdowns create branches and replace reusable branch first parts", () => { // NEW
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
    graph.setSelectionCell(valve); // NEW
    chooseConnectionPart(graph.container, "Outlet 2", "regulator"); // NEW
    edges = api.__test.collectAssemblyEdges(moduleCell); // NEW
    assert.equal(edges.length, 1); // NEW
    assert.equal(edges[0].target.getAttribute(api.attrs.CATALOG_PART_ID), "regulator"); // NEW
    assert.equal(assemblyCells(moduleCell, api).filter(cell => cell.getAttribute(api.attrs.ASSEMBLY_TYPE) === "parts").length, 2); // NEW
}); // NEW

test("occupied branch dropdown disconnects incompatible old branch and creates a new branch", () => { // NEW
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
    chooseConnectionPart(graph.container, "Outlet 1", "filter"); // NEW
    const edges = api.__test.collectAssemblyEdges(moduleCell); // NEW
    assert.equal(edges.length, 1); // NEW
    assert.equal(edges[0].target.getAttribute(api.attrs.CATALOG_PART_ID), "filter"); // NEW
    assert.equal(api.__test.firstAssemblyPart(branchAssembly).getAttribute(api.attrs.CATALOG_PART_ID), "barb_to_mpt"); // NEW
    assert.equal(assemblyCells(moduleCell, api).filter(cell => cell.getAttribute(api.attrs.ASSEMBLY_TYPE) === "parts").length, assemblyCountBefore + 1); // CHANGE
}); // NEW

test("drag-created compatible edges normalize into Pipe Edges and ignore connector method", () => { // NEW
    const { api, graph, moduleCell } = loadPlugin(); // NEW
    api.writeCatalog(moduleCell, sampleCatalog()); // NEW
    const source = api.__test.createSourceAssembly(moduleCell, "Spray Source", { connectorType: "barb", nominalSize: "3/4", method: "sprinkler", pipeConnection: true, usableFlowGpm: 5, staticPressurePsi: 45 }, { x: 30, y: 40 }); // CHANGE
    const filter = api.__test.createPartAssembly(moduleCell, api.readCatalog(moduleCell).items.find(item => item.id === "filter"), { x: 30, y: 180 }); // NEW
    api.openIrrigationMode(moduleCell, { preserveViewport: true }); // NEW
    const edge = graph.insertEdge(moduleCell, null, "", source.assembly, filter.assembly, ""); // NEW
    graph.fireCellsAdded([edge]); // NEW
    assert.equal(edge.getAttribute(api.attrs.PIPE_EDGE), "1"); // NEW
    assert.equal(edge.getAttribute(api.attrs.PIPE_PART_ID), "pipe_cheap"); // NEW
    assert.equal(edge.source, api.__test.firstAssemblyPart(source.assembly)); // NEW
    assert.equal(edge.target, api.__test.firstAssemblyPart(filter.assembly)); // NEW
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

test("missing pipe flags create direct assembly merges instead of pipe edges", () => { // NEW
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

test("Suggest Connection renders stock-grouped suggestions and applies a bridge into the downstream assembly", () => { // CHANGE
    const { api, graph, moduleCell } = loadPlugin(); // NEW
    api.writeCatalog(moduleCell, sampleCatalog()); // NEW
    const source = api.__test.createSourceAssembly(moduleCell, "Hose", { connectorType: "mght", nominalSize: "3/4", method: "drip", usableFlowGpm: 5, staticPressurePsi: 45 }, { x: 30, y: 40 }); // CHANGE
    const target = api.__test.createPartAssembly(moduleCell, api.readCatalog(moduleCell).items.find(item => item.id === "drip_tape"), { x: 30, y: 220 }); // NEW
    api.openIrrigationMode(moduleCell, { preserveViewport: true }); // NEW
    graph.setSelectionCells([source.assembly, target.assembly]); // NEW
    clickPort(graph.container, /Outlet 1 free/); // NEW
    clickPort(graph.container, /Inlet 1 free/); // NEW
    assert.match(graph.container.textContent, /Suggest Connection/); // CHANGE
    clickButton(graph.container, "Suggest Connection"); // CHANGE
    assert.match(graph.container.textContent, /In stock/); // NEW
    assert.match(graph.container.textContent, /Needs purchase/); // NEW
    clickButton(graph.container, "FGHT to MPT adapter"); // CHANGE
    const partIds = api.__test.assemblyPartCells(source.assembly).map(cell => cell.getAttribute(api.attrs.CATALOG_PART_ID)).filter(Boolean); // CHANGE
    assert.equal(JSON.stringify(partIds.slice(0, 3)), JSON.stringify(["fght_to_mpt", "fpt_to_barb", "drip_tape"])); // CHANGE
    assert.equal(api.__test.collectAssemblyEdges(moduleCell).length, 0); // CHANGE
}); // NEW

test("bed assemblies expand/contract, apply templates, and assembly reports ignore legacy objects", () => { // NEW
    const { api, graph, moduleCell, bed, bed2 } = loadPlugin(); // NEW
    api.writeCatalog(moduleCell, sampleCatalog()); // NEW
    const source = api.__test.createSourceAssembly(moduleCell, "Well", { connectorType: "barb", nominalSize: "1/2", method: "drip", pipeConnection: true, usableFlowGpm: 5, staticPressurePsi: 45 }, { x: 30, y: 40 }); // CHANGE
    const bedAssembly = api.__test.createBedAssembly(moduleCell, bed, { x: 30, y: 220 }); // NEW
    const legacy = api.__test.createBedEndpoint(bed2, "Legacy inlet", { connectorType: "barb", nominalSize: "3/4", method: "drip" }); // NEW
    legacy.value.setAttribute(api.attrs.GENERATED, "1"); // NEW
    const connection = api.__test.createAssemblyConnection(moduleCell, { cellId: api.__test.firstAssemblyPart(source.assembly).getId(), role: "output", index: 0 }, { cellId: bedAssembly.assembly.getId(), role: "input", index: 0 }); // CHANGE
    assert.equal(connection.ok, true, connection.reason); // NEW
    api.openIrrigationMode(moduleCell, { preserveViewport: true }); // NEW
    graph.setSelectionCell(bedAssembly.assembly); // NEW
    const contract = Array.from(graph.container.querySelectorAll("button")).find(button => button.title === "Contract bed assembly"); // NEW
    assert.ok(contract); // NEW
    contract.click(); // NEW
    assert.equal(bedAssembly.assembly.geometry.width, 220); // NEW
    const expand = Array.from(graph.container.querySelectorAll("button")).find(button => button.title === "Expand to linked bed size"); // NEW
    assert.ok(expand); // NEW
    expand.click(); // NEW
    assert.equal(bedAssembly.assembly.geometry.width, bed.geometry.width); // NEW
    clickButton(graph.container, "Apply Bed Layout"); // NEW
    assert.ok(descendants(bed, cell => cell.getAttribute && cell.getAttribute(api.attrs.BED_LAYOUT) === "1").length > 0); // CHANGE
    const paths = api.__test.syncHudGraphState(moduleCell); // NEW
    assert.equal(paths.length, 1); // NEW
    assert.equal(paths[0].targetBedId, bed.getId()); // NEW
    assert.doesNotMatch(moduleCell.getAttribute(api.attrs.PATHS_JSON), /Legacy inlet/); // NEW
    const summary = JSON.parse(moduleCell.getAttribute(api.attrs.REPORT_JSON)).summary; // NEW
    assert.equal(Math.round(summary.percentIrrigated), 50); // NEW
}); // NEW

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

test("disconnected assemblies can be reversed, connected assemblies cannot", () => { // NEW
    const { api, graph, moduleCell } = loadPlugin(); // NEW
    api.writeCatalog(moduleCell, sampleCatalog()); // NEW
    const assembly = api.__test.createPartAssembly(moduleCell, api.readCatalog(moduleCell).items.find(item => item.id === "filter"), { x: 30, y: 40 }).assembly; // NEW
    const second = api.__test.createPartAssembly(moduleCell, api.readCatalog(moduleCell).items.find(item => item.id === "regulator"), { x: 30, y: 160 }).assembly; // NEW
    const extra = api.__test.createPartAssembly(moduleCell, api.readCatalog(moduleCell).items.find(item => item.id === "valve"), { x: 30, y: 260 }).partCell; // NEW
    appendChild(assembly, extra); // NEW
    extra.parent = assembly; // NEW
    extra.geometry.y = 94; // NEW
    api.openIrrigationMode(moduleCell, { preserveViewport: true }); // NEW
    graph.setSelectionCell(assembly); // NEW
    const before = api.__test.assemblyPartCells(assembly).map(cell => cell.getAttribute(api.attrs.CATALOG_PART_ID)); // NEW
    clickButton(graph.container, "Reverse Assembly"); // NEW
    const after = api.__test.assemblyPartCells(assembly).map(cell => cell.getAttribute(api.attrs.CATALOG_PART_ID)); // NEW
    assert.deepEqual(after, before.slice().reverse()); // NEW
    api.__test.createAssemblyConnection(moduleCell, { cellId: api.__test.lastAssemblyPart(assembly).getId(), role: "output", index: 0 }, { cellId: api.__test.firstAssemblyPart(second).getId(), role: "input", index: 0 }); // NEW
    graph.setSelectionCell(assembly); // NEW
    assert.doesNotMatch(graph.container.textContent, /Reverse Assembly/); // NEW
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
