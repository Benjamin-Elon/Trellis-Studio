import assert from "assert";
import fs from "fs";
import path from "path";
import vm from "vm";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PX_PER_CM = 5;
const DRAW_SCALE = 0.18;
const CM_PER_INCH = 2.54;

function cmToUnits(cm) {
    return Number(cm || 0) * PX_PER_CM * DRAW_SCALE;
}

function inchesToUnits(inches) {
    return cmToUnits(Number(inches || 0) * CM_PER_INCH);
}

function makeXmlNode(attrs) {
    return {
        nodeType: 1,
        attrs: Object.assign({}, attrs || {}),
        getAttribute(key) { return this.attrs[key]; },
        setAttribute(key, value) { this.attrs[key] = String(value); },
        removeAttribute(key) { delete this.attrs[key]; },
        cloneNode() { return makeXmlNode(this.attrs); }
    };
}

function makeCell(id, attrs, geometry) {
    return {
        id,
        value: makeXmlNode(attrs),
        geometry: geometry || {},
        children: [],
        parent: null,
        source: null,
        target: null,
        getId() { return this.id; },
        getAttribute(key) { return this.value && this.value.getAttribute ? this.value.getAttribute(key) : undefined; },
        getGeometry() { return this.geometry; }
    };
}

function addChild(parent, child) {
    child.parent = parent;
    parent.children.push(child);
    return child;
}

function edge(id, source, target, attrs) {
    const e = makeCell(id, attrs || {});
    e.source = source;
    e.target = target;
    return e;
}

function installPlugin(moduleCell) {
    const callbacks = [];
    let nextId = 1;
    const selection = { cells: [moduleCell] }; // CHANGE
    function absoluteGeometry(cell) {
        const geo = cell && cell.geometry || {};
        let x = Number(geo.x || 0);
        let y = Number(geo.y || 0);
        let parent = cell && cell.parent;
        while (parent) { const parentGeo = parent.geometry || {}; x += Number(parentGeo.x || 0); y += Number(parentGeo.y || 0); parent = parent.parent; }
        return { x, y, width: Number(geo.width || 80), height: Number(geo.height || 40) };
    }
    function removeCell(cell) {
        const parent = cell && cell.parent;
        if (parent && parent.children) { const index = parent.children.indexOf(cell); if (index >= 0) parent.children.splice(index, 1); }
        if (cell) cell.parent = null;
    }
    const model = {
        getChildCount(cell) { return (cell && cell.children && cell.children.length) || 0; },
        getChildAt(cell, index) { return cell.children[index]; },
        getParent(cell) { return cell && cell.parent; },
        getGeometry(cell) { return cell && cell.geometry; },
        setValue(cell, value) { cell.value = value; },
        setGeometry(cell, geometry) { cell.geometry = geometry; },
        setTerminal(edgeCell, terminal, isSource) { if (isSource) edgeCell.source = terminal; else edgeCell.target = terminal; },
        add(parent, cell, index) { if (cell.parent) removeCell(cell); cell.parent = parent; if (!parent.children) parent.children = []; parent.children.splice(index == null ? parent.children.length : index, 0, cell); },
        remove: removeCell,
        beginUpdate() {},
        endUpdate() {},
        addListener() {}
    };
    const graph = {
        container: { appendChild() {}, removeChild() {}, style: {} },
        view: { scale: 1, translate: { x: 0, y: 0 }, addListener() {}, getState(cell) { return Object.assign({ cell }, absoluteGeometry(cell)); } },
        getModel() { return model; },
        getSelectionCell() { return selection.cells[0] || null; }, // CHANGE
        getSelectionCells() { return selection.cells.slice(); }, // CHANGE
        setSelectionCell(cell) { selection.cells = cell ? [cell] : []; }, // CHANGE
        setSelectionCells(cells) { selection.cells = (cells || []).slice(); }, // CHANGE
        getSelectionModel() { return { addListener() {} }; },
        addListener() {},
        addMouseListener() {},
        insertVertex(parent, id, label, x, y, width, height) { return addChild(parent, makeCell(id || "v" + nextId++, { label: label || "" }, { x, y, width, height })); },
        insertEdge(parent, id, label, source, target) { return addChild(parent, edge(id || "e" + nextId++, source, target, { label: label || "" })); }
    };
    global.window = { TrellisIrrigationPlanner: null, addEventListener() {}, removeEventListener() {} };
    global.document = {
        createElement() { return { style: {}, children: [], childNodes: [], appendChild(child) { this.children.push(child); this.childNodes.push(child); }, addEventListener() {}, setAttribute() {}, textContent: "", className: "" }; },
        createTextNode(text) { return { textContent: text }; },
        implementation: { createDocument() { return { createElement() { return makeXmlNode({}); } }; } }
    };
    global.Draw = { loadPlugin(fn) { callbacks.push(fn); } };
    global.mxEvent = { CHANGE: "change", CLICK: "click", CELLS_ADDED: "cellsAdded", ADD_CELLS: "addCells", CELLS_REMOVED: "cellsRemoved", REMOVE_CELLS: "removeCells", SCALE: "scale", TRANSLATE: "translate", SCALE_AND_TRANSLATE: "scaleAndTranslate" };
    global.mxUtils = { createXmlDocument() { return { createElement() { return makeXmlNode({}); } }; } };
    const pluginPath = path.join(__dirname, "Garden_Irrigation_Planner.js");
    vm.runInThisContext(fs.readFileSync(pluginPath, "utf8"), { filename: pluginPath });
    callbacks[0]({ editor: { graph }, actions: { addAction() {} } });
    return { graph, api: graph.__trellisIrrigationPlanner, selection }; // CHANGE
}

function buildZoneFixture() {
    const moduleCell = makeCell("module", { garden_module: "1" });
    const source = addChild(moduleCell, makeCell("source", { irrigation_endpoint: "1", irrigation_endpoint_type: "source", irrigation_endpoint_profile_json: JSON.stringify({ usableFlowGpm: 3, staticPressurePsi: 45, connectorType: "fght", nominalSize: "3/4" }), label: "Hose" }));
    const timerLane = addChild(moduleCell, makeCell("timerLane", { irrigation_assembly: "1", irrigation_assembly_type: "parts" }));
    const timer = addChild(timerLane, makeCell("timer", { irrigation_component: "1", irrigation_component_type: "controller_timer", irrigation_catalog_part_id: "timer_4", label: "Four Outlet Timer" }));
    const bedA = addChild(moduleCell, makeCell("bedA", { irrigation_assembly: "1", irrigation_assembly_type: "bed", label: "Bed A" }));
    const bedB = addChild(moduleCell, makeCell("bedB", { irrigation_assembly: "1", irrigation_assembly_type: "bed", label: "Bed B" }));
    const bedC = addChild(moduleCell, makeCell("bedC", { irrigation_assembly: "1", irrigation_assembly_type: "bed", label: "Bed C" }));
    addChild(moduleCell, edge("sourceTimer", source, timer, { irrigation_pipe_edge: "1", irrigation_edge_source_port: "0", irrigation_edge_target_port: "0" }));
    addChild(moduleCell, edge("timerA", timer, bedA, { irrigation_pipe_edge: "1", irrigation_edge_source_port: "0", irrigation_edge_target_port: "0" }));
    addChild(moduleCell, edge("timerB", timer, bedB, { irrigation_pipe_edge: "1", irrigation_edge_source_port: "0", irrigation_edge_target_port: "0" }));
    addChild(moduleCell, edge("timerC", timer, bedC, { irrigation_pipe_edge: "1", irrigation_edge_source_port: "1", irrigation_edge_target_port: "0" }));
    const installed = installPlugin(moduleCell);
    installed.api.writeCatalog(moduleCell, { items: [{ id: "timer_4", name: "4 outlet timer", category: "controller_timer", stockState: "in_stock", connectors: { inputs: 1, outputs: 4, input: { type: "fght", nominalSize: "3/4" }, output: { type: "mght", nominalSize: "3/4", maxFlowGpm: 3 } }, specs: {} }] });
    const paths = [
        { id: "pathA", targetEndpointId: "bedA", bedDemand: { flowGpm: 1.2 }, hydraulic: { marginPsi: 8 } },
        { id: "pathB", targetEndpointId: "bedB", bedDemand: { flowGpm: 1.0 }, hydraulic: { marginPsi: 7 } },
        { id: "pathC", targetEndpointId: "bedC", bedDemand: { flowGpm: 4.0 }, hydraulic: { marginPsi: -1 } }
    ];
    return Object.assign({ moduleCell, source, timer, bedA, bedB, bedC, paths }, installed);
}

function partCatalog() {
    return { items: [
        { id: "valve", name: "Valve", category: "valve", stockState: "in_stock", connectors: { inputs: 1, outputs: 1, input: { type: "barb", nominalSize: "3/4" }, output: { type: "barb", nominalSize: "3/4" } }, specs: {} },
        { id: "filter", name: "Filter", category: "filter", stockState: "in_stock", connectors: { inputs: 1, outputs: 1, input: { type: "barb", nominalSize: "3/4" }, output: { type: "barb", nominalSize: "3/4" } }, specs: {} },
        { id: "regulator", name: "Regulator", category: "regulator", stockState: "in_stock", connectors: { inputs: 1, outputs: 1, input: { type: "barb", nominalSize: "3/4" }, output: { type: "barb", nominalSize: "3/4" } }, specs: {} },
        { id: "timer_multi", name: "Multi Timer", category: "controller_timer", stockState: "in_stock", connectors: { inputs: 1, outputs: 3, input: { type: "barb", nominalSize: "3/4" }, output: { type: "barb", nominalSize: "3/4" } }, specs: {} },
        { id: "pipe", name: "Pipe", category: "pipe_tubing", stockState: "in_stock", connectors: { inputs: 1, outputs: 1, input: { type: "barb", nominalSize: "3/4", pipeConnection: true }, output: { type: "barb", nominalSize: "3/4", pipeConnection: true } }, specs: { innerDiameterIn: 0.824 } }
    ] };
}

function directCatalog() {
    return { items: [
        { id: "direct_source", name: "Direct Source", category: "valve", stockState: "in_stock", connectors: { inputs: 1, outputs: 1, input: { type: "fght", nominalSize: "3/4" }, output: { type: "mght", nominalSize: "3/4" } }, specs: {} },
        { id: "direct_insert", name: "Direct Insert", category: "filter", stockState: "in_stock", connectors: { inputs: 1, outputs: 1, input: { type: "fght", nominalSize: "3/4" }, output: { type: "mght", nominalSize: "3/4" } }, specs: {} }
    ] };
}

function catalogPart(catalog, id) {
    return catalog.items.find(part => part.id === id);
}

function partCell(id, partId, label, y) {
    return makeCell(id, { irrigation_component: "1", irrigation_component_type: partId === "timer_multi" ? "controller_timer" : partId, irrigation_catalog_part_id: partId, label }, { x: 20, y, width: 150, height: 34 });
}

function buildInternalAssemblyFixture() {
    const moduleCell = makeCell("module_internal", { garden_module: "1" });
    const assembly = addChild(moduleCell, makeCell("assembly", { irrigation_assembly: "1", irrigation_assembly_type: "parts", label: "Assembly" }, { x: 40, y: 50, width: 210, height: 178 }));
    const a = addChild(assembly, partCell("partA", "valve", "A", 44));
    const b = addChild(assembly, partCell("partB", "filter", "B", 94));
    const c = addChild(assembly, partCell("partC", "regulator", "C", 144));
    const installed = installPlugin(moduleCell);
    installed.api.writeCatalog(moduleCell, partCatalog());
    return Object.assign({ moduleCell, assembly, a, b, c }, installed);
}

function buildSinglePartAssemblyFixture() {
    const moduleCell = makeCell("module_single", { garden_module: "1" });
    const assembly = addChild(moduleCell, makeCell("assembly_single", { irrigation_assembly: "1", irrigation_assembly_type: "parts", label: "Assembly" }, { x: 40, y: 50, width: 210, height: 78 }));
    const a = addChild(assembly, partCell("singlePart", "valve", "Valve", 44));
    const installed = installPlugin(moduleCell);
    installed.api.writeCatalog(moduleCell, partCatalog());
    return Object.assign({ moduleCell, assembly, a }, installed);
}

function runZoneTests() {
    const { moduleCell, api, paths } = buildZoneFixture();
    const zones = api.syncZones(moduleCell);
    assert.strictEqual(zones.length, 4);
    assert.deepStrictEqual(zones[0].inferredBedIds.sort(), ["bedA", "bedB"]);
    assert.deepStrictEqual(zones[1].inferredBedIds, ["bedC"]);
    assert.deepStrictEqual(zones[2].inferredBedIds, []);
    const summary = api.zoneSummary(moduleCell, zones, paths);
    assert.strictEqual(summary.zoneCount, 4);
    assert.strictEqual(summary.emptyZoneCount, 2);
    assert.strictEqual(summary.overCapacityZoneCount, 1);
    assert.strictEqual(summary.zones[1].warnings.includes("Zone demand exceeds source usable flow."), true);
    api.assignBedsToZone(moduleCell, zones[0].id, ["bedC"]);
    const assigned = api.resolveEffectiveZoneMembership(moduleCell, api.readZones(moduleCell));
    assert.strictEqual(assigned.assignment.get("bedC").zoneId, zones[0].id);
    api.resetBedZoneOverrides(moduleCell, ["bedC"]);
    const reset = api.resolveEffectiveZoneMembership(moduleCell, api.syncZones(moduleCell));
    assert.strictEqual(reset.assignment.get("bedC").zoneId, zones[1].id);
    const manual = api.createManualZone(moduleCell, "North Beds", ["bedA"]);
    const manualSummary = api.zoneSummary(moduleCell, api.readZones(moduleCell), paths);
    assert.strictEqual(api.resolveEffectiveZoneMembership(moduleCell, api.readZones(moduleCell)).assignment.get("bedA").zoneId, manual.id);
    assert.strictEqual(manualSummary.zones.find(zone => zone.id === manual.id).status, "unknown");
}

function runBoundaryDisconnectTests() {
    const { moduleCell, api, assembly, a, b, c } = buildInternalAssemblyFixture();
    const boundaries = api.__test.internalConnectionBoundariesForSelection(moduleCell, [assembly]);
    assert.strictEqual(boundaries.length, 2);
    assert.strictEqual(api.__test.disconnectBoundary(moduleCell, boundaries[0].boundary), true);
    assert.deepStrictEqual(api.__test.assemblyPartCells(assembly).map(cell => cell.id), ["partA"]);
    const split = moduleCell.children.find(cell => cell !== assembly && cell.getAttribute("irrigation_assembly") === "1");
    assert.deepStrictEqual(api.__test.assemblyPartCells(split).map(cell => cell.id), ["partB", "partC"]);
    assert.strictEqual(split.geometry.x, assembly.geometry.x);
    assert.strictEqual(split.geometry.y, assembly.geometry.y + assembly.geometry.height + 40);
    assert.strictEqual(a.parent, assembly);
    assert.strictEqual(b.parent, split);
    assert.strictEqual(c.parent, split);
}

function runMixedDisconnectTests() {
    const fixture = buildZoneFixture();
    const { moduleCell, api, timer, bedC } = fixture;
    const internalFixture = buildInternalAssemblyFixture();
    const internalAssembly = internalFixture.assembly;
    moduleCell.children.push(internalAssembly);
    internalAssembly.parent = moduleCell;
    api.writeCatalog(moduleCell, partCatalog());
    const external = api.__test.boundaryForPort(moduleCell, { cellId: timer.id, role: "output", index: 1 });
    const internal = api.__test.internalConnectionBoundariesForSelection(moduleCell, [internalAssembly])[0].boundary;
    assert.ok(api.__test.collectAssemblyEdges(moduleCell).some(item => item.target === bedC));
    assert.strictEqual(api.__test.disconnectBoundaries(moduleCell, [external, internal, internal]), 2);
    assert.strictEqual(api.__test.collectAssemblyEdges(moduleCell).some(item => item.target === bedC), false);
    assert.deepStrictEqual(api.__test.assemblyPartCells(internalAssembly).map(cell => cell.id), ["partA"]);
}

function runDeletePartTests() {
    const { moduleCell, api, assembly, b } = buildInternalAssemblyFixture();
    assert.strictEqual(api.__test.deleteAssemblyPartCell(moduleCell, b), true);
    assert.deepStrictEqual(api.__test.assemblyPartCells(assembly).map(cell => cell.id), ["partA"]);
    const split = moduleCell.children.find(cell => cell !== assembly && cell.getAttribute("irrigation_assembly") === "1");
    assert.deepStrictEqual(api.__test.assemblyPartCells(split).map(cell => cell.id), ["partC"]);
    assert.strictEqual(moduleCell.children.some(cell => cell.id === "partB"), false);
}

function runExternalEdgePathTests() {
    const { moduleCell, api, timer, bedC } = buildZoneFixture();
    assert.ok(api.__test.deriveAssemblyPaths(moduleCell).some(pathItem => pathItem.targetEndpointId === "bedC"));
    const bedCY = bedC.geometry.y || 0;
    const boundary = api.__test.boundaryForPort(moduleCell, { cellId: timer.id, role: "output", index: 1 });
    assert.strictEqual(api.__test.disconnectBoundary(moduleCell, boundary), true);
    assert.strictEqual(bedC.parent, moduleCell);
    assert.strictEqual(bedC.geometry.y || 0, bedCY);
    const disconnectedPath = api.__test.deriveAssemblyPaths(moduleCell).find(pathItem => pathItem.targetEndpointId === "bedC");
    assert.ok(disconnectedPath);
    assert.strictEqual(disconnectedPath.sourceEndpointId, "");
    assert.strictEqual(disconnectedPath.disconnectedFromSource, true);
    assert.deepStrictEqual(disconnectedPath.hydraulic.warnings, ["Irrigation tree is disconnected from a source."]);
}

function runReverseAndBadgeLayoutTests() {
    const moduleCell = makeCell("module_reverse", { garden_module: "1" });
    const assembly = addChild(moduleCell, makeCell("assembly_reverse", { irrigation_assembly: "1", irrigation_assembly_type: "parts", label: "Assembly" }, { x: 10, y: 20, width: 210, height: 128 }));
    const single = addChild(assembly, partCell("single", "valve", "Single", 44));
    const multi = addChild(assembly, partCell("multi", "timer_multi", "Multi", 94));
    const installed = installPlugin(moduleCell);
    installed.api.writeCatalog(moduleCell, partCatalog());
    assert.strictEqual(installed.api.__test.assemblyCanReverse(moduleCell, assembly), false);
    multi.parent.children.splice(multi.parent.children.indexOf(multi), 1);
    multi.parent = null;
    assert.strictEqual(installed.api.__test.assemblyCanReverse(moduleCell, assembly), true);
    const outputNode = { style: {} };
    installed.api.__test.positionPortBadge(outputNode, single, "output", 0, 3);
    assert.strictEqual(outputNode.style.left, "53px");
    assert.strictEqual(outputNode.style.top, "102px");
    const inputNode = { style: {} };
    installed.api.__test.positionPortBadge(inputNode, single, "input", 2, 3);
    assert.strictEqual(inputNode.style.left, "128px");
    assert.strictEqual(inputNode.style.top, "38px");
}

function dragEvt(cell, x, y) { // CHANGE
    return { getCell() { return cell; }, getEvent() { return { clientX: x, clientY: y }; } }; // CHANGE
} // CHANGE

function runIrrigationDragSuppressionTests() { // CHANGE
    const moduleCell = makeCell("module_drag", { garden_module: "1" }); // CHANGE
    const assembly = addChild(moduleCell, makeCell("assembly_drag", { irrigation_assembly: "1", irrigation_assembly_type: "parts", label: "Assembly" }, { x: 10, y: 20, width: 210, height: 78 })); // CHANGE
    addChild(assembly, partCell("dragPart", "valve", "Valve", 44)); // CHANGE
    const bedAssembly = addChild(moduleCell, makeCell("bed_drag", { irrigation_assembly: "1", irrigation_assembly_type: "bed", label: "Bed" }, { x: 240, y: 20, width: 120, height: 80 })); // CHANGE
    const plain = addChild(moduleCell, makeCell("plain_drag", { label: "Plain" }, { x: 400, y: 20, width: 80, height: 40 })); // CHANGE
    const installed = installPlugin(moduleCell); // CHANGE
    installed.graph.setSelectionCell(assembly); // CHANGE
    const session = installed.api.openIrrigationMode(moduleCell, { selectCell: assembly, preserveViewport: true }); // CHANGE
    assert.ok(session); // CHANGE

    assert.strictEqual(installed.api.__test.beginIrrigationDragCandidate(session, dragEvt(assembly, 10, 10)), true); // CHANGE
    assert.strictEqual(installed.api.__test.updateIrrigationDragSuppression(session, dragEvt(assembly, 12, 11)), false); // CHANGE
    assert.strictEqual(session.suppressHudDuringDrag, false); // CHANGE
    assert.strictEqual(installed.api.__test.finishIrrigationDragSuppression(session), false); // CHANGE

    assert.strictEqual(installed.api.__test.beginIrrigationDragCandidate(session, dragEvt(assembly, 10, 10)), true); // CHANGE
    assert.strictEqual(installed.api.__test.updateIrrigationDragSuppression(session, dragEvt(assembly, 20, 10)), true); // CHANGE
    assert.strictEqual(session.suppressHudDuringDrag, true); // CHANGE
    assert.strictEqual(installed.api.__test.finishIrrigationDragSuppression(session), true); // CHANGE
    assert.strictEqual(session.suppressHudDuringDrag, false); // CHANGE
    assert.strictEqual(installed.api.__test.isIrrigationHudSelectionTarget(session, assembly), true); // CHANGE

    installed.graph.setSelectionCell(plain); // CHANGE
    assert.strictEqual(installed.api.__test.beginIrrigationDragCandidate(session, dragEvt(plain, 10, 10)), false); // CHANGE
    assert.strictEqual(installed.api.__test.updateIrrigationDragSuppression(session, dragEvt(plain, 30, 10)), false); // CHANGE
    assert.strictEqual(session.suppressHudDuringDrag, false); // CHANGE

    installed.graph.setSelectionCells([assembly, bedAssembly]); // CHANGE
    assert.strictEqual(installed.api.__test.beginIrrigationDragCandidate(session, dragEvt(assembly, 10, 10)), true); // CHANGE
    assert.strictEqual(installed.api.__test.updateIrrigationDragSuppression(session, dragEvt(assembly, 10, 18)), true); // CHANGE
    assert.strictEqual(installed.api.__test.finishIrrigationDragSuppression(session), true); // CHANGE

    installed.graph.setSelectionCells([assembly, plain]); // CHANGE
    assert.strictEqual(installed.api.__test.beginIrrigationDragCandidate(session, dragEvt(assembly, 10, 10)), false); // CHANGE
    assert.strictEqual(installed.api.__test.updateIrrigationDragSuppression(session, dragEvt(assembly, 10, 18)), false); // CHANGE
    installed.api.closeIrrigationMode(); // CHANGE
} // CHANGE

function irrigationLayoutRows(assembly) {
    return assembly.children.filter(cell => cell.getAttribute("irrigation_bed_layout") === "1");
}

function rowCenterInches(row, axis) {
    const geo = row.geometry || {};
    const units = axis === "x" ? Number(geo.x || 0) + Number(geo.width || 0) / 2 : Number(geo.y || 0) + Number(geo.height || 0) / 2;
    return units / (PX_PER_CM * DRAW_SCALE) / CM_PER_INCH;
}

function runBedRowSpacingGeometryTests() {
    const moduleCell = makeCell("module_spacing", { garden_module: "1", unit_system: "imperial" });
    const installed = installPlugin(moduleCell);
    const assembly = addChild(moduleCell, makeCell("assembly_spacing", { irrigation_assembly: "1", irrigation_assembly_type: "bed", label: "Legacy Label" }, { x: 0, y: 0, width: inchesToUnits(48), height: inchesToUnits(30) }));
    const record = { templateId: "overhead_sprinkler_block", irrigationType: "sprinkler", rowOrientation: "width", spacing: { rows: 2, emitterInches: 12, rowSpacingCm: 15 * CM_PER_INCH } };
    installed.api.__test.createBedTemplateLayoutCells(assembly, "path_spacing", record, assembly.geometry);
    const rows = irrigationLayoutRows(assembly);
    assert.strictEqual(rows.length, 2);
    assert.strictEqual(Math.round(installed.api.__test.rowSpacingCmForRows(assembly.geometry, 2, "width") / CM_PER_INCH), 15);
    assert.strictEqual(Math.round(rowCenterInches(rows[0], "y") * 10) / 10, 7.5);
    assert.strictEqual(Math.round(rowCenterInches(rows[1], "y") * 10) / 10, 22.5);
    assert.strictEqual(installed.api.__test.rowsForRowSpacingCm(assembly.geometry, 12 * CM_PER_INCH, "width", 2), 3);
    assert.strictEqual(Math.round(installed.api.__test.rowSpacingCmForRows(assembly.geometry, 3, "width") / CM_PER_INCH), 10);
    assert.strictEqual(Math.round(installed.api.__test.rowSpacingCmForRows(assembly.geometry, 2, "height") / CM_PER_INCH), 24);
    assert.strictEqual(installed.api.__test.rowsForRowSpacingCm(assembly.geometry, 0, "width", 2), 0);
    assert.strictEqual(installed.api.__test.rowSpacingCmForRows(assembly.geometry, 0, "width"), 0);
    const zeroBom = installed.api.__test.computeBedTemplateBom({ items: [] }, assembly.geometry, "overhead_sprinkler_block", 0, "width");
    assert.strictEqual(zeroBom.rowCount, 0);
    assert.strictEqual(zeroBom.totalRowMeters, 0);
    assert.strictEqual(zeroBom.demand.flowGpm, 0);
    assert.strictEqual(zeroBom.demand.operatingPressurePsi, 0);
    assert.deepStrictEqual(zeroBom.missingPartIds, []);
    assert.ok(zeroBom.requiredParts.every(part => part.quantityMeters === 0));
    installed.api.__test.createBedTemplateLayoutCells(assembly, "path_spacing", { templateId: "overhead_sprinkler_block", irrigationType: "sprinkler", rowOrientation: "width", spacing: { rows: 0, emitterInches: 12, rowSpacingCm: 0 } }, assembly.geometry);
    assert.strictEqual(irrigationLayoutRows(assembly).length, 0);
    const zeroCommit = installed.api.__test.commitBedTemplate(moduleCell, "path_zero_commit", assembly, { templateId: "overhead_sprinkler_block", templateModel: "bom", irrigationType: "sprinkler", rowOrientation: "width", spacing: { rows: 0, emitterInches: 12 } });
    assert.strictEqual(zeroCommit.spacing.rows, 0);
    assert.strictEqual(zeroCommit.spacing.rowSpacingCm, 0);
    assert.strictEqual(zeroCommit.demand.flowGpm, 0);
    assert.strictEqual(zeroCommit.demand.operatingPressurePsi, 0);
    assert.strictEqual(irrigationLayoutRows(assembly).length, 0);
}

function runBedAssemblyLabelModeTests() {
    const moduleCell = makeCell("module_label_mode", { garden_module: "1" });
    const bed = addChild(moduleCell, makeCell("bed_label_mode", { garden_bed: "1", label: "Bed" }, { x: 0, y: 0, width: inchesToUnits(48), height: inchesToUnits(30) }));
    const hiddenAssembly = addChild(moduleCell, makeCell("assembly_hidden_label", { irrigation_assembly: "1", irrigation_assembly_type: "bed", irrigation_linked_bed_id: "bed_label_mode", label: "Overhead sprinkler block" }, { x: 0, y: 0, width: inchesToUnits(48), height: inchesToUnits(30) }));
    const installed = installPlugin(moduleCell);
    installed.api.__test.commitBedTemplate(moduleCell, "path_hidden_label", hiddenAssembly, { templateId: "overhead_sprinkler_block", templateModel: "bom", irrigationType: "sprinkler", rowOrientation: "width", spacing: { rows: 2, emitterInches: 12 } });
    assert.strictEqual(hiddenAssembly.getAttribute("label"), undefined);
    const oldRecord = { templateId: "overhead_sprinkler_block", templateModel: "bom", irrigationType: "sprinkler", rowOrientation: "width", spacing: { rows: 2, emitterInches: 12 } };
    const legacyAssembly = addChild(moduleCell, makeCell("assembly_legacy_label", { irrigation_assembly: "1", irrigation_assembly_type: "bed", irrigation_linked_bed_id: "bed_label_mode", label: "Legacy sprinkler label", irrigation_bed_template_json: JSON.stringify(oldRecord) }, { x: 0, y: 0, width: inchesToUnits(48), height: inchesToUnits(30) }));
    installed.api.__test.syncLinkedBedAssemblyToBed(moduleCell, legacyAssembly, bed, { inTransaction: true });
    assert.strictEqual(legacyAssembly.getAttribute("label"), "Legacy sprinkler label");
}

function runDropdownPipeOutputCreatesExternalAssemblyTest() {
    const { moduleCell, api, assembly, a } = buildSinglePartAssemblyFixture();
    const result = api.__test.applyConnectionPartChoice(moduleCell, { cell: a, role: "output", index: 0 }, catalogPart(partCatalog(), "filter"));
    const createdAssembly = result.cell;
    assert.ok(createdAssembly && createdAssembly !== assembly);
    assert.deepStrictEqual(api.__test.assemblyPartCells(assembly).map(cell => cell.id), ["singlePart"]);
    assert.deepStrictEqual(api.__test.assemblyPartCells(createdAssembly).map(cell => cell.getAttribute("irrigation_catalog_part_id")), ["filter"]);
    const pipeEdge = moduleCell.children.find(cell => cell.getAttribute("irrigation_pipe_edge") === "1");
    assert.ok(pipeEdge);
    assert.strictEqual(pipeEdge.source, a);
    assert.strictEqual(pipeEdge.target, api.__test.firstAssemblyPart(createdAssembly));
}

function runDropdownPipeInputCreatesExternalAssemblyTest() {
    const { moduleCell, api, assembly, a } = buildInternalAssemblyFixture();
    const result = api.__test.applyConnectionPartChoice(moduleCell, { cell: a, role: "input", index: 0 }, catalogPart(partCatalog(), "filter"));
    const createdAssembly = result.cell;
    assert.ok(createdAssembly && createdAssembly !== assembly);
    assert.deepStrictEqual(api.__test.assemblyPartCells(assembly).map(cell => cell.id), ["partA", "partB", "partC"]);
    const createdPart = api.__test.firstAssemblyPart(createdAssembly);
    const pipeEdge = moduleCell.children.find(cell => cell.getAttribute("irrigation_pipe_edge") === "1");
    assert.ok(pipeEdge);
    assert.strictEqual(pipeEdge.source, createdPart);
    assert.strictEqual(pipeEdge.target, a);
}

function runDropdownDirectConnectorStillInsertsInlineTest() {
    const moduleCell = makeCell("module_dropdown_direct", { garden_module: "1" });
    const assembly = addChild(moduleCell, makeCell("assembly_direct", { irrigation_assembly: "1", irrigation_assembly_type: "parts", label: "Assembly" }, { x: 40, y: 50, width: 210, height: 78 }));
    const direct = addChild(assembly, partCell("directPart", "direct_source", "Direct Source", 44));
    const installed = installPlugin(moduleCell);
    const catalog = directCatalog();
    installed.api.writeCatalog(moduleCell, catalog);
    const result = installed.api.__test.applyConnectionPartChoice(moduleCell, { cell: direct, role: "input", index: 0 }, catalogPart(catalog, "direct_insert"));
    assert.strictEqual(result.cell.parent, assembly);
    assert.deepStrictEqual(installed.api.__test.assemblyPartCells(assembly).map(cell => cell.getAttribute("irrigation_catalog_part_id")), ["direct_insert", "direct_source"]);
    assert.strictEqual(moduleCell.children.filter(cell => cell.getAttribute("irrigation_assembly") === "1").length, 1);
    assert.strictEqual(moduleCell.children.some(cell => cell.getAttribute("irrigation_pipe_edge") === "1"), false);
}

function runExistingAssemblyPipeConnectionStillCreatesPipeEdgeTest() {
    const moduleCell = makeCell("module_existing_pipe", { garden_module: "1" });
    const upstream = addChild(moduleCell, makeCell("upstream", { irrigation_assembly: "1", irrigation_assembly_type: "parts", label: "Upstream" }, { x: 40, y: 50, width: 210, height: 78 }));
    const downstream = addChild(moduleCell, makeCell("downstream", { irrigation_assembly: "1", irrigation_assembly_type: "parts", label: "Downstream" }, { x: 40, y: 170, width: 210, height: 78 }));
    const source = addChild(upstream, partCell("sourceExisting", "valve", "Valve", 44));
    const target = addChild(downstream, partCell("targetExisting", "filter", "Filter", 44));
    const installed = installPlugin(moduleCell);
    installed.api.writeCatalog(moduleCell, partCatalog());
    const result = installed.api.__test.createAssemblyConnection(moduleCell, { cellId: source.id, role: "output", index: 0 }, { cellId: target.id, role: "input", index: 0 });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.mode, "pipe");
    assert.strictEqual(result.edge.getAttribute("irrigation_pipe_edge"), "1");
    assert.strictEqual(source.parent, upstream);
    assert.strictEqual(target.parent, downstream);
}

function runDropdownPipeFailureDoesNotLeaveAssemblyTest() {
    const { moduleCell, api, assembly, a } = buildSinglePartAssemblyFixture();
    const noPipeCatalog = partCatalog();
    noPipeCatalog.items = noPipeCatalog.items.filter(part => part.category !== "pipe_tubing");
    api.writeCatalog(moduleCell, noPipeCatalog);
    const result = api.__test.applyConnectionPartChoice(moduleCell, { cell: a, role: "output", index: 0 }, catalogPart(noPipeCatalog, "filter"));
    assert.strictEqual(result.cell, null);
    assert.match(result.message, /No compatible pipe part/);
    assert.deepStrictEqual(api.__test.assemblyPartCells(assembly).map(cell => cell.id), ["singlePart"]);
    assert.strictEqual(moduleCell.children.filter(cell => cell.getAttribute("irrigation_assembly") === "1").length, 1);
    assert.strictEqual(moduleCell.children.some(cell => cell.getAttribute("irrigation_pipe_edge") === "1"), false);
}

function bomCatalog() {
    return { items: [
        { id: "valve_bom", name: "Valve BOM", category: "valve", stockState: "in_stock", stockQuantity: 1, cost: 10, connectors: { inputs: 1, outputs: 1, input: { type: "barb", nominalSize: "3/4" }, output: { type: "barb", nominalSize: "3/4" } }, specs: {} },
        { id: "filter_bom", name: "Filter BOM", category: "filter", stockState: "out_of_stock", stockQuantity: 0, cost: 5, connectors: { inputs: 1, outputs: 1, input: { type: "barb", nominalSize: "3/4" }, output: { type: "barb", nominalSize: "3/4" } }, specs: {} },
        { id: "pipe_bom", name: "Pipe BOM", category: "pipe_tubing", stockState: "in_stock", stockQuantity: 3, cost: 2, unitCost: 2, connectors: { inputs: 1, outputs: 1, input: { type: "barb", nominalSize: "3/4", pipeConnection: true }, output: { type: "barb", nominalSize: "3/4", pipeConnection: true } }, specs: { innerDiameterIn: 0.824 } },
        { id: "drip_bom", name: "Drip BOM", category: "dripline", stockState: "out_of_stock", stockQuantity: 0, cost: 1, unitCost: 1, connectors: { inputs: 1, outputs: 1, input: { type: "barb", nominalSize: "1/2", pipeConnection: true }, output: { type: "barb", nominalSize: "1/2", pipeConnection: true } }, specs: { flowGpm: 0 } },
        { id: "emitter_bom", name: "Emitter BOM", category: "emitter", stockState: "out_of_stock", stockQuantity: 0, cost: 3, connectors: { inputs: 1, outputs: 1, input: { type: "barb", nominalSize: "3/4" }, output: { type: "barb", nominalSize: "3/4" } }, specs: {} }
    ] };
}

function bomPaths() {
    return [{
        id: "bom_path",
        partIds: ["valve_bom", "filter_bom"],
        pipeSegments: [{ pipePartId: "pipe_bom", lengthFt: 10 }],
        bedTemplate: { templateModel: "bom", requiredParts: [{ partId: "drip_bom", quantityMeters: 3.048 }], partIds: ["filter_bom"] }
    }];
}

function findBomRow(rows, partId) {
    return rows.find(row => row.partId === partId);
}

function feetToUnits(feet) {
    return cmToUnits(Number(feet || 0) * 30.48);
}

function setPipeLength(edgeCell, feet) {
    edgeCell.geometry = { points: [{ x: 0, y: 0 }, { x: feetToUnits(feet), y: 0 }] };
    return edgeCell;
}

function bedTemplateRecord(quantityMeters) {
    return { templateModel: "bom", requiredParts: [{ partId: "drip_bom", quantityMeters }], partIds: [] };
}

function writeBedTemplate(assembly, record) {
    assembly.value.setAttribute("irrigation_bed_template_json", JSON.stringify(record));
    return assembly;
}

function runBomAggregationTests() {
    const moduleCell = makeCell("module_bom", { garden_module: "1", unit_system: "imperial" });
    const installed = installPlugin(moduleCell);
    const bom = installed.api.__test.buildBomRows(moduleCell, { catalog: bomCatalog(), paths: bomPaths() });
    assert.strictEqual(findBomRow(bom.rows, "valve_bom").requiredQuantity, 1);
    assert.strictEqual(findBomRow(bom.rows, "filter_bom").requiredQuantity, 2);
    assert.strictEqual(findBomRow(bom.rows, "pipe_bom").requiredQuantity, 10);
    assert.strictEqual(Math.round(findBomRow(bom.rows, "drip_bom").requiredQuantity), 10);
    assert.strictEqual(findBomRow(bom.rows, "pipe_bom").shortageQuantity, 7);
    assert.strictEqual(findBomRow(bom.rows, "filter_bom").purchaseCost, 10);
}

function runBomSelectionAndMetricTests() {
    const moduleCell = makeCell("module_bom_metric", { garden_module: "1", unit_system: "metric" });
    const assembly = addChild(moduleCell, makeCell("assembly_bom", { irrigation_assembly: "1", irrigation_assembly_type: "parts" }));
    addChild(assembly, partCell("bomValveCell", "valve_bom", "Valve BOM", 20));
    const installed = installPlugin(moduleCell);
    const catalog = bomCatalog();
    const selected = installed.api.__test.buildBomRows(moduleCell, { catalog, paths: bomPaths(), selectedPartIds: ["filter_bom"] });
    assert.deepStrictEqual(selected.rows.map(row => row.partId), ["filter_bom"]);
    assert.deepStrictEqual(installed.api.__test.selectedCatalogPartIdsForSelection(moduleCell, makeCell("outside", {})), []);
    assert.deepStrictEqual(installed.api.__test.selectedCatalogPartIdsForSelection(moduleCell, assembly), ["valve_bom"]);
    const pipe = catalog.items.find(part => part.id === "pipe_bom");
    assert.strictEqual(Math.round(installed.api.__test.bomCanonicalQuantityToDisplay(10, pipe, moduleCell) * 1000), 3048);
    assert.strictEqual(Math.round(installed.api.__test.bomDisplayUnitCost(pipe, moduleCell) * 100), 656);
}

function runBomStockAndSummaryTests() {
    const moduleCell = makeCell("module_bom_summary", { garden_module: "1", unit_system: "imperial" });
    const installed = installPlugin(moduleCell);
    const normalized = installed.api.__test.normalizeCatalogPart({ id: "legacy", name: "Legacy", category: "filter", stockState: "unknown", connectors: { inputs: 1, outputs: 1, input: { type: "barb", nominalSize: "3/4" }, output: { type: "barb", nominalSize: "3/4" } }, specs: {} });
    assert.strictEqual(normalized.stockQuantity, 0);
    assert.strictEqual(installed.api.__test.stockStateForQuantity(0), "out_of_stock");
    assert.strictEqual(installed.api.__test.stockStateForQuantity(2), "in_stock");
    const summary = installed.api.__test.buildReportSummary(moduleCell, { catalog: bomCatalog(), paths: bomPaths(), beds: [] });
    assert.strictEqual(summary.purchaseNeededCost, 34);
    assert.strictEqual(summary.purchaseNeededCount, 3);
    assert.strictEqual(summary.totalDesignValue, 50);
}

function runDisconnectedComponentBomTests() {
    const moduleCell = makeCell("module_disconnected_component", { garden_module: "1", unit_system: "imperial" });
    const upstream = addChild(moduleCell, makeCell("upstream_component", { irrigation_assembly: "1", irrigation_assembly_type: "parts" }));
    const valve = addChild(upstream, partCell("componentValve", "valve_bom", "Valve", 20));
    const filter = addChild(upstream, partCell("componentFilter", "filter_bom", "Filter", 70));
    const bed = writeBedTemplate(addChild(moduleCell, makeCell("componentBed", { irrigation_assembly: "1", irrigation_assembly_type: "bed", label: "Bed" }, { width: 100, height: 50 })), bedTemplateRecord(3.048));
    const downstream = addChild(moduleCell, makeCell("downstream_component", { irrigation_assembly: "1", irrigation_assembly_type: "parts" }));
    const emitter = addChild(downstream, partCell("componentEmitter", "emitter_bom", "Emitter", 20));
    setPipeLength(addChild(moduleCell, edge("componentFilterBed", filter, bed, { irrigation_pipe_edge: "1", irrigation_pipe_part_id: "pipe_bom", irrigation_edge_source_port: "0", irrigation_edge_target_port: "0" })), 10);
    setPipeLength(addChild(moduleCell, edge("componentBedEmitter", bed, emitter, { irrigation_pipe_edge: "1", irrigation_pipe_part_id: "pipe_bom", irrigation_edge_source_port: "0", irrigation_edge_target_port: "0" })), 5);
    const installed = installPlugin(moduleCell);
    installed.api.writeCatalog(moduleCell, bomCatalog());
    const components = installed.api.__test.deriveBomComponents(moduleCell);
    assert.strictEqual(components.length, 1);
    assert.strictEqual(components[0].disconnectedFromSource, true);
    assert.deepStrictEqual(components[0].cellIds.sort(), ["componentBed", "componentEmitter", "componentFilter", "componentValve"].sort());
    const bom = installed.api.__test.buildBomRows(moduleCell, { catalog: bomCatalog() });
    assert.strictEqual(findBomRow(bom.rows, "valve_bom").requiredQuantity, 1);
    assert.strictEqual(findBomRow(bom.rows, "filter_bom").requiredQuantity, 1);
    assert.strictEqual(findBomRow(bom.rows, "emitter_bom").requiredQuantity, 1);
    assert.strictEqual(Math.round(findBomRow(bom.rows, "pipe_bom").requiredQuantity), 15);
    assert.strictEqual(Math.round(findBomRow(bom.rows, "drip_bom").requiredQuantity), 10);
    assert.strictEqual(bom.disconnectedTreeCount, 1);
    const summary = installed.api.__test.buildReportSummary(moduleCell, { catalog: bomCatalog(), beds: [bed] });
    assert.strictEqual(summary.disconnectedTreeCount, 1);
    assert.strictEqual(summary.criticalWarnings.includes("Irrigation tree is disconnected from a source."), true);
    assert.strictEqual(summary.completeness, 0);
}

function runSharedTrunkComponentBomTests() {
    const moduleCell = makeCell("module_shared_component", { garden_module: "1", unit_system: "imperial" });
    const source = addChild(moduleCell, makeCell("sharedSource", { irrigation_endpoint: "1", irrigation_endpoint_type: "source", irrigation_endpoint_profile_json: JSON.stringify({ usableFlowGpm: 5, staticPressurePsi: 45, connectorType: "barb", nominalSize: "3/4", pipeConnection: true }), label: "Source" }));
    const trunk = addChild(moduleCell, makeCell("shared_trunk", { irrigation_assembly: "1", irrigation_assembly_type: "parts" }));
    const valve = addChild(trunk, partCell("sharedValve", "valve_bom", "Valve", 20));
    const bedA = writeBedTemplate(addChild(moduleCell, makeCell("sharedBedA", { irrigation_assembly: "1", irrigation_assembly_type: "bed", label: "Bed A" }, { width: 100, height: 50 })), bedTemplateRecord(3.048));
    const bedB = writeBedTemplate(addChild(moduleCell, makeCell("sharedBedB", { irrigation_assembly: "1", irrigation_assembly_type: "bed", label: "Bed B" }, { width: 100, height: 50 })), bedTemplateRecord(3.048));
    setPipeLength(addChild(moduleCell, edge("sharedSourceValve", source, valve, { irrigation_pipe_edge: "1", irrigation_pipe_part_id: "pipe_bom", irrigation_edge_source_port: "0", irrigation_edge_target_port: "0" })), 4);
    setPipeLength(addChild(moduleCell, edge("sharedValveBedA", valve, bedA, { irrigation_pipe_edge: "1", irrigation_pipe_part_id: "pipe_bom", irrigation_edge_source_port: "0", irrigation_edge_target_port: "0" })), 6);
    setPipeLength(addChild(moduleCell, edge("sharedValveBedB", valve, bedB, { irrigation_pipe_edge: "1", irrigation_pipe_part_id: "pipe_bom", irrigation_edge_source_port: "1", irrigation_edge_target_port: "0" })), 8);
    const installed = installPlugin(moduleCell);
    installed.api.writeCatalog(moduleCell, bomCatalog());
    const bom = installed.api.__test.buildBomRows(moduleCell, { catalog: bomCatalog() });
    assert.strictEqual(bom.components.length, 1);
    assert.strictEqual(bom.disconnectedTreeCount, 0);
    assert.strictEqual(findBomRow(bom.rows, "valve_bom").requiredQuantity, 1);
    assert.strictEqual(Math.round(findBomRow(bom.rows, "pipe_bom").requiredQuantity), 18);
    assert.strictEqual(Math.round(findBomRow(bom.rows, "drip_bom").requiredQuantity), 20);
}

function run() {
    runZoneTests();
    runBoundaryDisconnectTests();
    runMixedDisconnectTests();
    runDeletePartTests();
    runExternalEdgePathTests();
    runReverseAndBadgeLayoutTests();
    runIrrigationDragSuppressionTests(); // CHANGE
    runBedRowSpacingGeometryTests();
    runBedAssemblyLabelModeTests();
    runDropdownPipeOutputCreatesExternalAssemblyTest();
    runDropdownPipeInputCreatesExternalAssemblyTest();
    runDropdownDirectConnectorStillInsertsInlineTest();
    runExistingAssemblyPipeConnectionStillCreatesPipeEdgeTest();
    runDropdownPipeFailureDoesNotLeaveAssemblyTest();
    runBomAggregationTests();
    runBomSelectionAndMetricTests();
    runBomStockAndSummaryTests();
    runDisconnectedComponentBomTests();
    runSharedTrunkComponentBomTests();
}

run();
console.log("Garden_Irrigation_Zones tests passed");
