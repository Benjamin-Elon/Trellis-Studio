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
        mxEvent: { CHANGE: "change", CLICK: "click", SCALE: "scale", TRANSLATE: "translate", SCALE_AND_TRANSLATE: "scaleAndTranslate", getClientX(evt) { return evt && evt.clientX || 0; }, getClientY(evt) { return evt && evt.clientY || 0; } }, // NEW
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

function part(id, name, category, stockState, cost, inputs, outputs, inputType, inputSize, outputType, outputSize, specs = {}, unitCost) { // NEW
    return { // NEW
        id, name, category, stockState, cost, unitCost, // NEW
        connectors: { inputs, outputs, input: { type: inputType, nominalSize: inputSize, method: "drip" }, output: { type: outputType, nominalSize: outputSize, method: "drip", maxFlowGpm: specs.maxFlowGpm } }, // NEW
        specs // NEW
    }; // NEW
} // NEW

function sampleCatalog() { // NEW
    return { items: [ // NEW
        part("filter", "Filter", "filter", "in_stock", 20, 1, 1, "barb", "3/4", "barb", "3/4", { pressureLossPsi: 2 }), // NEW
        part("regulator", "Regulator", "regulator", "in_stock", 18, 1, 1, "barb", "3/4", "barb", "3/4", { pressureLossPsi: 1 }), // NEW
        part("valve", "Valve", "valve", "in_stock", 30, 1, 2, "barb", "3/4", "barb", "3/4", { pressureLossPsi: 1, maxFlowGpm: 8 }), // NEW
        part("pipe_cheap", "3/4 cheap poly", "pipe_tubing", "in_stock", 0, 1, 1, "barb", "3/4", "barb", "3/4", { innerDiameterIn: 0.824, hazenWilliamsC: 150 }, 0.25), // NEW
        part("pipe_costly", "3/4 costly poly", "pipe_tubing", "in_stock", 0, 1, 1, "barb", "3/4", "barb", "3/4", { innerDiameterIn: 0.824, hazenWilliamsC: 150 }, 0.75), // NEW
        part("ght_to_mpt", "GHT to MPT adapter", "fitting", "in_stock", 5, 1, 1, "ght", "3/4", "mpt", "3/4", { pressureLossPsi: 0.2 }), // NEW
        part("mpt_to_barb", "MPT to barb adapter", "fitting", "in_stock", 4, 1, 1, "mpt", "3/4", "barb", "3/4", { pressureLossPsi: 0.2 }), // NEW
        part("ght_to_barb_backorder", "GHT to barb direct adapter", "fitting", "out_of_stock", 9, 1, 1, "ght", "3/4", "barb", "3/4", { pressureLossPsi: 0.2 }), // NEW
        part("drip_tape", "Drip Tape", "drip_tape", "out_of_stock", 45, 1, 1, "barb", "3/4", "barb", "3/4", { flowGpm: 1.2, operatingPressurePsi: 10 }) // NEW
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

function assemblyCells(moduleCell, api) { // NEW
    return descendants(moduleCell, cell => cell.getAttribute && cell.getAttribute(api.attrs.ASSEMBLY) === "1"); // NEW
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
    assert.ok(selects.some(select => Array.from(select.options).some(option => option.value === "ght"))); // NEW
    assert.ok(selects.some(select => Array.from(select.options).some(option => option.value === "3/4"))); // NEW
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
    assert.ok(api.__test.firstAssemblyPart(sourceAssembly).getAttribute(api.attrs.ENDPOINT_PROFILE_JSON).includes("ght")); // NEW
    graph.view.scale = 1.4; // NEW
    graph.view.fire("scale"); // NEW
    assert.ok(graph.container.querySelector(".trellis-irrigation-mode-hud")); // NEW
}); // NEW

test("Add Part appears only without irrigation selection and creates an unconnected assembly", () => { // NEW
    const { api, graph, moduleCell, actions } = loadPlugin(); // NEW
    api.writeCatalog(moduleCell, sampleCatalog()); // NEW
    actions.get("trellisIrrigationPlanner").funct(); // NEW
    assert.match(graph.container.textContent, /Add Part/); // NEW
    graph.fireMouseMove(360, 220); // NEW
    clickButton(graph.container, "Add Part"); // NEW
    const form = graph.container.querySelector(".trellis-irrigation-add-assembly-form"); // NEW
    const select = form.querySelector("select"); // CHANGE
    select.value = "filter"; // NEW
    clickButton(form, "Add Part"); // CHANGE
    const partAssembly = assemblyCells(moduleCell, api)[0]; // NEW
    assert.equal(partAssembly.getAttribute(api.attrs.ASSEMBLY_TYPE), "parts"); // NEW
    assert.equal(api.__test.firstAssemblyPart(partAssembly).getAttribute(api.attrs.CATALOG_PART_ID), "filter"); // NEW
    assert.equal(partAssembly.geometry.x, 360); // NEW
    assert.doesNotMatch(graph.container.textContent, /Create Source/); // NEW
    assert.doesNotMatch(graph.container.textContent, /Add Part/); // NEW
}); // NEW

test("selected port badges connect with automatic pipe choice and disconnect selected connections", () => { // NEW
    const { api, graph, moduleCell } = loadPlugin(); // NEW
    api.writeCatalog(moduleCell, sampleCatalog()); // NEW
    const source = api.__test.createSourceAssembly(moduleCell, "Well", { connectorType: "barb", nominalSize: "3/4", method: "drip", usableFlowGpm: 5, staticPressurePsi: 45 }, { x: 30, y: 40 }); // CHANGE
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

test("Bridge Connection renders stock-grouped suggestions and applies a bridge into the downstream assembly", () => { // NEW
    const { api, graph, moduleCell } = loadPlugin(); // NEW
    api.writeCatalog(moduleCell, sampleCatalog()); // NEW
    const source = api.__test.createSourceAssembly(moduleCell, "Hose", { connectorType: "ght", nominalSize: "3/4", method: "drip", usableFlowGpm: 5, staticPressurePsi: 45 }, { x: 30, y: 40 }); // NEW
    const target = api.__test.createPartAssembly(moduleCell, api.readCatalog(moduleCell).items.find(item => item.id === "drip_tape"), { x: 30, y: 220 }); // NEW
    api.openIrrigationMode(moduleCell, { preserveViewport: true }); // NEW
    graph.setSelectionCells([source.assembly, target.assembly]); // NEW
    clickPort(graph.container, /Outlet 1 free/); // NEW
    clickPort(graph.container, /Inlet 1 free/); // NEW
    assert.match(graph.container.textContent, /Bridge Connection/); // NEW
    clickButton(graph.container, "Bridge Connection"); // NEW
    assert.match(graph.container.textContent, /In stock/); // NEW
    assert.match(graph.container.textContent, /Needs purchase/); // NEW
    clickButton(graph.container, "GHT to MPT adapter"); // NEW
    const partIds = api.__test.assemblyPartCells(target.assembly).map(cell => cell.getAttribute(api.attrs.CATALOG_PART_ID)).filter(Boolean); // NEW
    assert.equal(JSON.stringify(partIds.slice(0, 3)), JSON.stringify(["ght_to_mpt", "mpt_to_barb", "drip_tape"])); // CHANGE
    assert.equal(api.__test.collectAssemblyEdges(moduleCell).length, 3); // NEW
}); // NEW

test("bed assemblies expand/contract, apply templates, and assembly reports ignore legacy objects", () => { // NEW
    const { api, graph, moduleCell, bed, bed2 } = loadPlugin(); // NEW
    api.writeCatalog(moduleCell, sampleCatalog()); // NEW
    const source = api.__test.createSourceAssembly(moduleCell, "Well", { connectorType: "barb", nominalSize: "1/2", method: "drip", usableFlowGpm: 5, staticPressurePsi: 45 }, { x: 30, y: 40 }); // CHANGE
    const bedAssembly = api.__test.createBedAssembly(moduleCell, bed, { x: 30, y: 220 }); // NEW
    const legacy = api.__test.createBedEndpoint(bed2, "Legacy inlet", { connectorType: "barb", nominalSize: "3/4", method: "drip" }); // NEW
    legacy.value.setAttribute(api.attrs.GENERATED, "1"); // NEW
    const connection = api.__test.createAssemblyConnection(moduleCell, { cellId: api.__test.firstAssemblyPart(source.assembly).getId(), role: "output", index: 0 }, { cellId: api.__test.firstAssemblyPart(bedAssembly.assembly).getId(), role: "input", index: 0 }); // CHANGE
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
    assert.ok(descendants(bedAssembly.assembly, cell => cell.getAttribute && cell.getAttribute(api.attrs.BED_LAYOUT) === "1").length > 0); // NEW
    const paths = api.__test.syncHudGraphState(moduleCell); // NEW
    assert.equal(paths.length, 1); // NEW
    assert.equal(paths[0].targetBedId, bed.getId()); // NEW
    assert.doesNotMatch(moduleCell.getAttribute(api.attrs.PATHS_JSON), /Legacy inlet/); // NEW
    const summary = JSON.parse(moduleCell.getAttribute(api.attrs.REPORT_JSON)).summary; // NEW
    assert.equal(Math.round(summary.percentIrrigated), 50); // NEW
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
