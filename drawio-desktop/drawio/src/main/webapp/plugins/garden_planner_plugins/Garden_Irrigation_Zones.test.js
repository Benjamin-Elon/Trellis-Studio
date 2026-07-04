import assert from "assert"; // NEW
import fs from "fs"; // NEW
import path from "path"; // NEW
import vm from "vm"; // NEW
import { fileURLToPath } from "url"; // NEW

const __filename = fileURLToPath(import.meta.url); // NEW
const __dirname = path.dirname(__filename); // NEW

function makeXmlNode(attrs) { // NEW
    return { // NEW
        nodeType: 1, // NEW
        attrs: Object.assign({}, attrs || {}), // NEW
        getAttribute(key) { return this.attrs[key]; }, // NEW
        setAttribute(key, value) { this.attrs[key] = String(value); }, // NEW
        removeAttribute(key) { delete this.attrs[key]; }, // NEW
        cloneNode() { return makeXmlNode(this.attrs); } // NEW
    }; // NEW
} // NEW

function makeCell(id, attrs, geometry) { // NEW
    return { // NEW
        id, // NEW
        value: makeXmlNode(attrs), // NEW
        geometry: geometry || {}, // NEW
        children: [], // NEW
        parent: null, // NEW
        source: null, // NEW
        target: null, // NEW
        getId() { return this.id; }, // NEW
        getAttribute(key) { return this.value && this.value.getAttribute ? this.value.getAttribute(key) : undefined; }, // NEW
        getGeometry() { return this.geometry; } // NEW
    }; // NEW
} // NEW

function addChild(parent, child) { // NEW
    child.parent = parent; // NEW
    parent.children.push(child); // NEW
    return child; // NEW
} // NEW

function edge(id, source, target, attrs) { // NEW
    const e = makeCell(id, attrs || {}); // NEW
    e.source = source; // NEW
    e.target = target; // NEW
    return e; // NEW
} // NEW

function installPlugin(moduleCell) { // NEW
    const callbacks = []; // NEW
    let nextId = 1; // NEW
    function absoluteGeometry(cell) { // NEW
        const geo = cell && cell.geometry || {}; // NEW
        let x = Number(geo.x || 0); // NEW
        let y = Number(geo.y || 0); // NEW
        let parent = cell && cell.parent; // NEW
        while (parent) { const parentGeo = parent.geometry || {}; x += Number(parentGeo.x || 0); y += Number(parentGeo.y || 0); parent = parent.parent; } // NEW
        return { x, y, width: Number(geo.width || 80), height: Number(geo.height || 40) }; // NEW
    } // NEW
    function removeCell(cell) { // NEW
        const parent = cell && cell.parent; // NEW
        if (parent && parent.children) { const index = parent.children.indexOf(cell); if (index >= 0) parent.children.splice(index, 1); } // NEW
        if (cell) cell.parent = null; // NEW
    } // NEW
    const model = { // NEW
        getChildCount(cell) { return (cell && cell.children && cell.children.length) || 0; }, // NEW
        getChildAt(cell, index) { return cell.children[index]; }, // NEW
        getParent(cell) { return cell && cell.parent; }, // NEW
        getGeometry(cell) { return cell && cell.geometry; }, // NEW
        setValue(cell, value) { cell.value = value; }, // NEW
        setGeometry(cell, geometry) { cell.geometry = geometry; }, // NEW
        setTerminal(edgeCell, terminal, isSource) { if (isSource) edgeCell.source = terminal; else edgeCell.target = terminal; }, // NEW
        add(parent, cell, index) { if (cell.parent) removeCell(cell); cell.parent = parent; if (!parent.children) parent.children = []; parent.children.splice(index == null ? parent.children.length : index, 0, cell); }, // NEW
        remove: removeCell, // NEW
        beginUpdate() {}, // NEW
        endUpdate() {}, // NEW
        addListener() {} // NEW
    }; // NEW
    const graph = { // NEW
        container: { appendChild() {}, removeChild() {}, style: {} }, // NEW
        view: { scale: 1, translate: { x: 0, y: 0 }, addListener() {}, getState(cell) { return Object.assign({ cell }, absoluteGeometry(cell)); } }, // CHANGE
        getModel() { return model; }, // NEW
        getSelectionCell() { return moduleCell; }, // NEW
        getSelectionCells() { return [moduleCell]; }, // NEW
        getSelectionModel() { return { addListener() {} }; }, // NEW
        addListener() {}, // NEW
        addMouseListener() {}, // CHANGE
        insertVertex(parent, id, label, x, y, width, height) { return addChild(parent, makeCell(id || "v" + nextId++, { label: label || "" }, { x, y, width, height })); }, // NEW
        insertEdge(parent, id, label, source, target) { return addChild(parent, edge(id || "e" + nextId++, source, target, { label: label || "" })); } // NEW
    }; // NEW
    global.window = { TrellisIrrigationPlanner: null }; // NEW
    global.document = { // NEW
        createElement() { return { style: {}, children: [], childNodes: [], appendChild(child) { this.children.push(child); this.childNodes.push(child); }, addEventListener() {}, setAttribute() {}, textContent: "", className: "" }; }, // NEW
        createTextNode(text) { return { textContent: text }; }, // NEW
        implementation: { createDocument() { return { createElement() { return makeXmlNode({}); } }; } } // NEW
    }; // NEW
    global.Draw = { loadPlugin(fn) { callbacks.push(fn); } }; // NEW
    global.mxEvent = { CHANGE: "change", CLICK: "click", CELLS_ADDED: "cellsAdded", ADD_CELLS: "addCells", CELLS_REMOVED: "cellsRemoved", REMOVE_CELLS: "removeCells", SCALE: "scale", TRANSLATE: "translate", SCALE_AND_TRANSLATE: "scaleAndTranslate" }; // CHANGE
    global.mxUtils = { createXmlDocument() { return { createElement() { return makeXmlNode({}); } }; } }; // NEW
    const pluginPath = path.join(__dirname, "Garden_Irrigation_Planner.js"); // NEW
    vm.runInThisContext(fs.readFileSync(pluginPath, "utf8"), { filename: pluginPath }); // NEW
    callbacks[0]({ editor: { graph }, actions: { addAction() {} } }); // NEW
    return { graph, api: graph.__trellisIrrigationPlanner }; // NEW
} // NEW

function buildZoneFixture() { // NEW
    const moduleCell = makeCell("module", { garden_module: "1" }); // NEW
    const source = addChild(moduleCell, makeCell("source", { irrigation_endpoint: "1", irrigation_endpoint_type: "source", irrigation_endpoint_profile_json: JSON.stringify({ usableFlowGpm: 3, staticPressurePsi: 45, connectorType: "fght", nominalSize: "3/4" }), label: "Hose" })); // NEW
    const timerLane = addChild(moduleCell, makeCell("timerLane", { irrigation_assembly: "1", irrigation_assembly_type: "parts" })); // NEW
    const timer = addChild(timerLane, makeCell("timer", { irrigation_component: "1", irrigation_component_type: "controller_timer", irrigation_catalog_part_id: "timer_4", label: "Four Outlet Timer" })); // NEW
    const bedA = addChild(moduleCell, makeCell("bedA", { irrigation_assembly: "1", irrigation_assembly_type: "bed", label: "Bed A" })); // NEW
    const bedB = addChild(moduleCell, makeCell("bedB", { irrigation_assembly: "1", irrigation_assembly_type: "bed", label: "Bed B" })); // NEW
    const bedC = addChild(moduleCell, makeCell("bedC", { irrigation_assembly: "1", irrigation_assembly_type: "bed", label: "Bed C" })); // NEW
    addChild(moduleCell, edge("sourceTimer", source, timer, { irrigation_pipe_edge: "1", irrigation_edge_source_port: "0", irrigation_edge_target_port: "0" })); // NEW
    addChild(moduleCell, edge("timerA", timer, bedA, { irrigation_pipe_edge: "1", irrigation_edge_source_port: "0", irrigation_edge_target_port: "0" })); // NEW
    addChild(moduleCell, edge("timerB", timer, bedB, { irrigation_pipe_edge: "1", irrigation_edge_source_port: "0", irrigation_edge_target_port: "0" })); // NEW
    addChild(moduleCell, edge("timerC", timer, bedC, { irrigation_pipe_edge: "1", irrigation_edge_source_port: "1", irrigation_edge_target_port: "0" })); // NEW
    const installed = installPlugin(moduleCell); // NEW
    installed.api.writeCatalog(moduleCell, { items: [{ id: "timer_4", name: "4 outlet timer", category: "controller_timer", stockState: "in_stock", connectors: { inputs: 1, outputs: 4, input: { type: "fght", nominalSize: "3/4" }, output: { type: "mght", nominalSize: "3/4", maxFlowGpm: 3 } }, specs: {} }] }); // NEW
    const paths = [ // CHANGE
        { id: "pathA", targetEndpointId: "bedA", bedDemand: { flowGpm: 1.2 }, hydraulic: { marginPsi: 8 } }, // NEW
        { id: "pathB", targetEndpointId: "bedB", bedDemand: { flowGpm: 1.0 }, hydraulic: { marginPsi: 7 } }, // NEW
        { id: "pathC", targetEndpointId: "bedC", bedDemand: { flowGpm: 4.0 }, hydraulic: { marginPsi: -1 } } // NEW
    ]; // CHANGE
    return Object.assign({ moduleCell, source, timer, bedA, bedB, bedC, paths }, installed); // CHANGE
} // NEW

function partCatalog() { // NEW
    return { items: [ // NEW
        { id: "valve", name: "Valve", category: "valve", stockState: "in_stock", connectors: { inputs: 1, outputs: 1, input: { type: "barb", nominalSize: "3/4" }, output: { type: "barb", nominalSize: "3/4" } }, specs: {} }, // NEW
        { id: "filter", name: "Filter", category: "filter", stockState: "in_stock", connectors: { inputs: 1, outputs: 1, input: { type: "barb", nominalSize: "3/4" }, output: { type: "barb", nominalSize: "3/4" } }, specs: {} }, // NEW
        { id: "regulator", name: "Regulator", category: "regulator", stockState: "in_stock", connectors: { inputs: 1, outputs: 1, input: { type: "barb", nominalSize: "3/4" }, output: { type: "barb", nominalSize: "3/4" } }, specs: {} }, // NEW
        { id: "timer_multi", name: "Multi Timer", category: "controller_timer", stockState: "in_stock", connectors: { inputs: 1, outputs: 3, input: { type: "barb", nominalSize: "3/4" }, output: { type: "barb", nominalSize: "3/4" } }, specs: {} }, // NEW
        { id: "pipe", name: "Pipe", category: "pipe_tubing", stockState: "in_stock", connectors: { inputs: 1, outputs: 1, input: { type: "barb", nominalSize: "3/4", pipeConnection: true }, output: { type: "barb", nominalSize: "3/4", pipeConnection: true } }, specs: {} } // NEW
    ] }; // NEW
} // NEW

function partCell(id, partId, label, y) { // NEW
    return makeCell(id, { irrigation_component: "1", irrigation_component_type: partId === "timer_multi" ? "controller_timer" : partId, irrigation_catalog_part_id: partId, label }, { x: 20, y, width: 150, height: 34 }); // NEW
} // NEW

function buildInternalAssemblyFixture() { // NEW
    const moduleCell = makeCell("module_internal", { garden_module: "1" }); // NEW
    const assembly = addChild(moduleCell, makeCell("assembly", { irrigation_assembly: "1", irrigation_assembly_type: "parts", label: "Assembly" }, { x: 40, y: 50, width: 210, height: 178 })); // NEW
    const a = addChild(assembly, partCell("partA", "valve", "A", 44)); // NEW
    const b = addChild(assembly, partCell("partB", "filter", "B", 94)); // NEW
    const c = addChild(assembly, partCell("partC", "regulator", "C", 144)); // NEW
    const installed = installPlugin(moduleCell); // NEW
    installed.api.writeCatalog(moduleCell, partCatalog()); // NEW
    return Object.assign({ moduleCell, assembly, a, b, c }, installed); // NEW
} // NEW

function runZoneTests() { // NEW
    const { moduleCell, api, paths } = buildZoneFixture(); // CHANGE
    const zones = api.syncZones(moduleCell); // NEW
    assert.strictEqual(zones.length, 4); // NEW
    assert.deepStrictEqual(zones[0].inferredBedIds.sort(), ["bedA", "bedB"]); // NEW
    assert.deepStrictEqual(zones[1].inferredBedIds, ["bedC"]); // NEW
    assert.deepStrictEqual(zones[2].inferredBedIds, []); // NEW
    const summary = api.zoneSummary(moduleCell, zones, paths); // CHANGE
    assert.strictEqual(summary.zoneCount, 4); // NEW
    assert.strictEqual(summary.emptyZoneCount, 2); // NEW
    assert.strictEqual(summary.overCapacityZoneCount, 1); // NEW
    assert.strictEqual(summary.zones[1].warnings.includes("Zone demand exceeds source usable flow."), true); // NEW
    api.assignBedsToZone(moduleCell, zones[0].id, ["bedC"]); // NEW
    const assigned = api.resolveEffectiveZoneMembership(moduleCell, api.readZones(moduleCell)); // NEW
    assert.strictEqual(assigned.assignment.get("bedC").zoneId, zones[0].id); // NEW
    api.resetBedZoneOverrides(moduleCell, ["bedC"]); // NEW
    const reset = api.resolveEffectiveZoneMembership(moduleCell, api.syncZones(moduleCell)); // NEW
    assert.strictEqual(reset.assignment.get("bedC").zoneId, zones[1].id); // NEW
    const manual = api.createManualZone(moduleCell, "North Beds", ["bedA"]); // NEW
    const manualSummary = api.zoneSummary(moduleCell, api.readZones(moduleCell), paths); // CHANGE
    assert.strictEqual(api.resolveEffectiveZoneMembership(moduleCell, api.readZones(moduleCell)).assignment.get("bedA").zoneId, manual.id); // NEW
    assert.strictEqual(manualSummary.zones.find(zone => zone.id === manual.id).status, "unknown"); // NEW
} // NEW

function runBoundaryDisconnectTests() { // NEW
    const { moduleCell, api, assembly, a, b, c } = buildInternalAssemblyFixture(); // NEW
    const boundaries = api.__test.internalConnectionBoundariesForSelection(moduleCell, [assembly]); // NEW
    assert.strictEqual(boundaries.length, 2); // NEW
    assert.strictEqual(api.__test.disconnectBoundary(moduleCell, boundaries[0].boundary), true); // NEW
    assert.deepStrictEqual(api.__test.assemblyPartCells(assembly).map(cell => cell.id), ["partA"]); // NEW
    const split = moduleCell.children.find(cell => cell !== assembly && cell.getAttribute("irrigation_assembly") === "1"); // NEW
    assert.deepStrictEqual(api.__test.assemblyPartCells(split).map(cell => cell.id), ["partB", "partC"]); // NEW
    assert.strictEqual(split.geometry.x, assembly.geometry.x); // NEW
    assert.strictEqual(split.geometry.y, assembly.geometry.y + assembly.geometry.height + 40); // NEW
    assert.strictEqual(a.parent, assembly); // NEW
    assert.strictEqual(b.parent, split); // NEW
    assert.strictEqual(c.parent, split); // NEW
} // NEW

function runMixedDisconnectTests() { // NEW
    const fixture = buildZoneFixture(); // NEW
    const { moduleCell, api, timer, bedC } = fixture; // NEW
    const internalFixture = buildInternalAssemblyFixture(); // NEW
    const internalAssembly = internalFixture.assembly; // NEW
    moduleCell.children.push(internalAssembly); // NEW
    internalAssembly.parent = moduleCell; // NEW
    api.writeCatalog(moduleCell, partCatalog()); // NEW
    const external = api.__test.boundaryForPort(moduleCell, { cellId: timer.id, role: "output", index: 1 }); // NEW
    const internal = api.__test.internalConnectionBoundariesForSelection(moduleCell, [internalAssembly])[0].boundary; // NEW
    assert.ok(api.__test.collectAssemblyEdges(moduleCell).some(item => item.target === bedC)); // NEW
    assert.strictEqual(api.__test.disconnectBoundaries(moduleCell, [external, internal, internal]), 2); // NEW
    assert.strictEqual(api.__test.collectAssemblyEdges(moduleCell).some(item => item.target === bedC), false); // NEW
    assert.deepStrictEqual(api.__test.assemblyPartCells(internalAssembly).map(cell => cell.id), ["partA"]); // NEW
} // NEW

function runDeletePartTests() { // NEW
    const { moduleCell, api, assembly, b } = buildInternalAssemblyFixture(); // NEW
    assert.strictEqual(api.__test.deleteAssemblyPartCell(moduleCell, b), true); // NEW
    assert.deepStrictEqual(api.__test.assemblyPartCells(assembly).map(cell => cell.id), ["partA"]); // NEW
    const split = moduleCell.children.find(cell => cell !== assembly && cell.getAttribute("irrigation_assembly") === "1"); // NEW
    assert.deepStrictEqual(api.__test.assemblyPartCells(split).map(cell => cell.id), ["partC"]); // NEW
    assert.strictEqual(moduleCell.children.some(cell => cell.id === "partB"), false); // NEW
} // NEW

function runExternalEdgePathTests() { // NEW
    const { moduleCell, api, timer, bedC } = buildZoneFixture(); // NEW
    assert.ok(api.__test.deriveAssemblyPaths(moduleCell).some(pathItem => pathItem.targetEndpointId === "bedC")); // NEW
    const bedCY = bedC.geometry.y || 0; // NEW
    const boundary = api.__test.boundaryForPort(moduleCell, { cellId: timer.id, role: "output", index: 1 }); // NEW
    assert.strictEqual(api.__test.disconnectBoundary(moduleCell, boundary), true); // NEW
    assert.strictEqual(bedC.parent, moduleCell); // NEW
    assert.strictEqual(bedC.geometry.y || 0, bedCY); // NEW
    assert.strictEqual(api.__test.deriveAssemblyPaths(moduleCell).some(pathItem => pathItem.targetEndpointId === "bedC"), false); // NEW
} // NEW

function runReverseAndBadgeLayoutTests() { // NEW
    const moduleCell = makeCell("module_reverse", { garden_module: "1" }); // NEW
    const assembly = addChild(moduleCell, makeCell("assembly_reverse", { irrigation_assembly: "1", irrigation_assembly_type: "parts", label: "Assembly" }, { x: 10, y: 20, width: 210, height: 128 })); // NEW
    const single = addChild(assembly, partCell("single", "valve", "Single", 44)); // NEW
    const multi = addChild(assembly, partCell("multi", "timer_multi", "Multi", 94)); // NEW
    const installed = installPlugin(moduleCell); // NEW
    installed.api.writeCatalog(moduleCell, partCatalog()); // NEW
    assert.strictEqual(installed.api.__test.assemblyCanReverse(moduleCell, assembly), false); // NEW
    multi.parent.children.splice(multi.parent.children.indexOf(multi), 1); // NEW
    multi.parent = null; // NEW
    assert.strictEqual(installed.api.__test.assemblyCanReverse(moduleCell, assembly), true); // NEW
    const outputNode = { style: {} }; // NEW
    installed.api.__test.positionPortBadge(outputNode, single, "output", 0, 3); // NEW
    assert.strictEqual(outputNode.style.left, "57px"); // CHANGE
    assert.strictEqual(outputNode.style.top, "102px"); // NEW
    const inputNode = { style: {} }; // NEW
    installed.api.__test.positionPortBadge(inputNode, single, "input", 2, 3); // NEW
    assert.strictEqual(inputNode.style.left, "132px"); // CHANGE
    assert.strictEqual(inputNode.style.top, "38px"); // CHANGE
} // NEW

function run() { // NEW
    runZoneTests(); // CHANGE
    runBoundaryDisconnectTests(); // NEW
    runMixedDisconnectTests(); // NEW
    runDeletePartTests(); // NEW
    runExternalEdgePathTests(); // NEW
    runReverseAndBadgeLayoutTests(); // NEW
} // NEW

run(); // NEW
console.log("Garden_Irrigation_Zones tests passed"); // NEW
