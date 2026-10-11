const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const PLUGIN_PATH = path.join(__dirname, "..", "drawio", "src", "main", "webapp", "plugins", "garden_planner_plugins", "Allocate_Planner.js");
const YEAR_PLANNER_PATH = path.join(__dirname, "..", "drawio", "src", "main", "webapp", "plugins", "garden_planner_plugins", "Year_Planner.js");
const SOURCE = fs.readFileSync(PLUGIN_PATH, "utf8");

function makeNode(ownerDocument) {
    function selectorMatches(candidate, selector) {
        const raw = String(selector || "");
        if (raw.charAt(0) === ".") return String(candidate.className || "").split(/\s+/).includes(raw.slice(1));
        const attrExists = /^\[([^=\]]+)\]$/.exec(raw);
        if (attrExists) return candidate.getAttribute(attrExists[1]) != null;
        const attr = /^\[([^=\]]+)="([^"]*)"\]$/.exec(raw);
        if (attr) return candidate.getAttribute(attr[1]) === attr[2];
        return false;
    }
    const node = {
        style: {}, dataset: {}, // CHANGE: shared HTML previews use owner metadata.
        children: [],
        attributes: new Map(),
        listeners: new Map(),
        className: "",
        ownerDocument,
        parentNode: null,
        appendChild(child) { this.children.push(child); child.parentNode = this; if (!child.ownerDocument) child.ownerDocument = this.ownerDocument; return child; },
        removeChild(child) { this.children = this.children.filter(item => item !== child); child.parentNode = null; if (this.ownerDocument && this.ownerDocument.activeElement === child) this.ownerDocument.activeElement = null; },
        replaceChildren(...children) { this.innerHTML = ''; children.forEach(child => this.appendChild(child)); }, // CHANGE: required-default guidance uses the standard DOM replacement operation.
        setAttribute(key, value) { this.attributes.set(String(key), String(value)); if (String(key) === "class") this.className = String(value); },
        getAttribute(key) { return this.attributes.get(String(key)) || null; },
        addEventListener(type, fn) { const key = String(type || ""); this.listeners.set(key, (this.listeners.get(key) || []).concat(fn)); },
        removeEventListener(type, fn) { const key = String(type || ""); this.listeners.set(key, (this.listeners.get(key) || []).filter(item => item !== fn)); },
        dispatchEvent(evt) { (this.listeners.get(String(evt && evt.type || "")) || []).forEach(fn => fn.call(this, evt)); return true; },
        click() { this.dispatchEvent({ type: "click", target: this }); },
        focus() { if (this.ownerDocument) this.ownerDocument.activeElement = this; },
        blur() { if (this.ownerDocument && this.ownerDocument.activeElement === this) this.ownerDocument.activeElement = null; },
        contains(target) { return this === target || this.children.some(child => child && typeof child.contains === "function" && child.contains(target)); },
        querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
        querySelectorAll(selector) { const out = []; (function visit(candidate) { if (selectorMatches(candidate, selector)) out.push(candidate); (candidate.children || []).forEach(visit); })(this); return out; },
        set innerHTML(_) { const active = this.ownerDocument && this.ownerDocument.activeElement; if (active && active !== this && this.contains(active)) this.ownerDocument.activeElement = null; this.children.forEach(child => { child.parentNode = null; }); this.children = []; }, // CHANGE: fake DOM now models focus loss when a focused descendant subtree is cleared.
        get innerHTML() { return ""; }
    };
    return node;
}

function makeEventSource(target = {}) {
    const listeners = new Map();
    target.addListener = function (eventName, fn) {
        const key = String(eventName || "");
        listeners.set(key, (listeners.get(key) || []).concat(fn));
    };
    target.removeListener = function (fn) {
        listeners.forEach((items, key) => listeners.set(key, items.filter(item => item !== fn)));
    };
    target.fireEvent = function (eventName, event = { getProperty: () => null }) { // CHANGE: model-edit scenarios provide actual change payloads.
        (listeners.get(String(eventName || "")) || []).slice().forEach(fn => fn(target, event)); // CHANGE
    };
    return target;
}

function loadAllocatePlugin() {
    const document = {
        activeElement: null,
        body: null,
        createTextNode(text) { const node = makeNode(document); node.textContent = text; return node; }, // CHANGE: review labels include text nodes.
        createElement: () => makeNode(document),
        createElementNS: () => makeNode(document)
    };
    const root = makeNode(document);
    const graphContainer = makeNode(document);
    graphContainer.getBoundingClientRect = () => ({ left: 20, top: 30 });
    graphContainer.scrollLeft = 7;
    graphContainer.scrollTop = 11;
    document.body = root;
    root.appendChild(graphContainer);
    const view = makeEventSource({
        scale: 1,
        translate: { x: 0, y: 0 },
        getState(cell) {
            if (!cell) return null;
            if (cell.__state) return cell.__state;
            const geo = cell.getGeometry ? cell.getGeometry() : null;
            if (!geo) return null;
            const scale = Number(this.scale) || 1;
            const tr = this.translate || { x: 0, y: 0 };
            return {
                x: (Number(geo.x) + Number(tr.x || 0)) * scale,
                y: (Number(geo.y) + Number(tr.y || 0)) * scale,
                width: Math.max(1, Number(geo.width || 1) * scale),
                height: Math.max(1, Number(geo.height || 1) * scale)
            };
        }
    });
    const graphEvents = makeEventSource({});
    const model = makeEventSource({ getCell: () => null, getParent: cell => cell && cell.parent || null, beginUpdate() {}, endUpdate() {} }); // CHANGE: selections can resolve planting children and garden ancestors.
    const selection = makeEventSource({ cells: [] }); // CHANGE
    const graph = {
        container: graphContainer,
        view,
        getView: () => view,
        getModel: () => model, // CHANGE
        getSelectionModel: () => selection, getSelectionCells: () => selection.cells, getSelectionCell: () => selection.cells[0] || null, // CHANGE
        setSelectionCells(cells) { selection.cells = cells; selection.fireEvent('change'); }, // CHANGE
        setSelectionCell(cell) { this.setSelectionCells(cell ? [cell] : []); }, // CHANGE
        addListener: graphEvents.addListener,
        removeListener: graphEvents.removeListener
    };
    const windowEvents = new Map(); // CHANGE: required-default saves use the same browser notifications as the real scheduler.
    const window = {
        USL: {},
        Trellis: {},
        getComputedStyle(node) { return { position: node && node.style && node.style.position || "static" }; },
        addEventListener(type, listener) { windowEvents.set(type, (windowEvents.get(type) || []).concat(listener)); }, // CHANGE
        removeEventListener(type, listener) { windowEvents.set(type, (windowEvents.get(type) || []).filter(item => item !== listener)); }, // CHANGE
        dispatchEvent(event) { (windowEvents.get(event.type) || []).forEach(listener => listener(event)); }, // CHANGE
        localStorage: {
            getItem() { return null; },
            setItem() {}
        }
    };
    const context = vm.createContext({
        Date,
        JSON,
        Math,
        Number,
        Object,
        Promise,
        String,
        Map,
        setTimeout,
        clearTimeout,
        document,
        window,
        mxEvent: {
            CELLS_MOVED: "cellsMoved",
            CELLS_RESIZED: "cellsResized",
            CELLS_ADDED: "cellsAdded",
            CELLS_REMOVED: "cellsRemoved",
            CHANGE: "change",
            SCALE: "scale",
            TRANSLATE: "translate",
            SCALE_AND_TRANSLATE: "scaleAndTranslate",
            REPAINT: "repaint"
        },
        Draw: { loadPlugin(callback) { callback({ editor: { graph }, showDialog(node) { document.lastDialog = node; root.appendChild(node); }, hideDialog() { if (document.lastDialog) root.removeChild(document.lastDialog); document.lastDialog = null; } }); } } // CHANGE: exercise the explicit review/create action.
    });
    const plantingSource = fs.readFileSync(path.join(path.dirname(PLUGIN_PATH), 'Planting_Group.js'), 'utf8'); // CHANGE
    const sharedDrawing = plantingSource.slice(plantingSource.indexOf('const GRAPH_OVERLAY_LAYER_CLASS'), plantingSource.indexOf('    const plantingPreview =')); // CHANGE
    context.previewGraph = graph; // CHANGE
    vm.runInContext('(function(graph){ const GRAPH_OVERLAY_Z={ANNOTATION:10000,CONNECTION:10010,CONTROL:10020,CONTROL_TOP:10030}; ' + sharedDrawing + '; graph.__trellisPlantingGroup={preview:createPlantingPreviewRenderer()}; })(previewGraph);', context); // CHANGE: run the production shared renderer in this focused harness.
    vm.runInContext(SOURCE, context, { filename: PLUGIN_PATH });
    const api = window.USL.allocate.__test;
    api.__window = window;
    api.__root = root;
    api.__graphContainer = graphContainer; // CHANGE: graph-local overlay assertions inspect the container, not document.body.
    api.__document = document; // CHANGE: focus regression tests inspect the fake DOM active element.
    api.__graph = graph; // CHANGE: zoom anchoring tests mutate the fake mxGraph view.
    api.__fireViewEvent = name => view.fireEvent(name); // CHANGE
    return api;
}

function collectText(node, out = []) {
    if (!node) return out;
    if (node.textContent) out.push(String(node.textContent));
    (node.children || []).forEach(child => collectText(child, out));
    return out;
}

async function waitUntil(predicate, timeoutMs = 250) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        if (predicate()) return;
        await new Promise(resolve => setTimeout(resolve, 10));
    }
}

test("Allocate opportunity model groups actionable, unresolved, and satisfied crops", () => {
    const api = loadAllocatePlugin();
    const plan = {
        crops: [
            { id: "lettuce", plantId: "1", plant: "Lettuce", method: "direct_sow.field", kgPerPlant: 1 },
            { id: "rhubarb", plantId: "2", plant: "Rhubarb", method: "transplant.field", lifecycle: "perennial" },
            { id: "carrot", plantId: "3", plant: "Carrot", method: "direct_sow.field" }
        ]
    };
    const coverage = {
        cropSummaries: [
            { cropId: "lettuce", targetKg: 10, shortKg: 4, status: "short" },
            { cropId: "rhubarb", targetKg: 8, shortKg: 2, status: "short" },
            { cropId: "carrot", targetKg: 5, shortKg: 0, status: "satisfied" }
        ],
        weekSummaries: [{ weekIndex: 13, shortKg: 4 }]
    };

    const model = api.buildOpportunityModel(plan, coverage);

    assert.deepEqual(model.actionable.map(crop => crop.cropId), ["lettuce"]);
    assert.deepEqual(model.unresolved.map(crop => crop.cropId), ["rhubarb"]);
    assert.deepEqual(model.satisfied.map(crop => crop.cropId), ["carrot"]);
    assert.deepEqual(model.actionableWeekIndices, [13]);
});

test("Allocate opportunity model can narrow actionable crops to the selected week", () => {
    const api = loadAllocatePlugin();
    const plan = {
        crops: [
            { id: "lettuce", plantId: "1", plant: "Lettuce", method: "direct_sow.field" },
            { id: "carrot", plantId: "2", plant: "Carrot", method: "direct_sow.field" }
        ]
    };
    const coverage = {
        cropSummaries: [
            { cropId: "lettuce", targetKg: 10, shortKg: 4 },
            { cropId: "carrot", targetKg: 10, shortKg: 4 }
        ],
        weekSummaries: [
            { weekIndex: 13, shortKg: 4, cropShortages: [{ cropId: "lettuce", shortKg: 4 }] },
            { weekIndex: 14, shortKg: 4, cropShortages: [{ cropId: "carrot", shortKg: 4 }] }
        ]
    };

    const model = api.buildOpportunityModel(plan, coverage, { weekIndex: 14 });

    assert.deepEqual(model.actionable.map(crop => crop.cropId), ["carrot"]);
    assert.deepEqual(model.actionableWeekIndices, [13, 14]);
});

test("Allocate week option labels summarize date, shortage, and current status", () => {
    const api = loadAllocatePlugin();
    const plan = {
        crops: [
            { id: "cilantro", plantId: "1", plant: "Cilantro", method: "direct_sow.field" },
            { id: "radish", plantId: "2", plant: "Radish", method: "direct_sow.field" }
        ]
    };
    const coverage = {
        cropSummaries: [
            { cropId: "cilantro", targetKg: 10, shortKg: 6 },
            { cropId: "radish", targetKg: 5, shortKg: 2 }
        ],
        weekSummaries: [
            { weekIndex: 23, start: "2027-06-07", shortKg: 6, cropShortages: [{ cropId: "cilantro", shortKg: 6 }] },
            { weekIndex: 24, start: "2027-06-14", shortKg: 2, cropShortages: [{ cropId: "radish", shortKg: 2 }] }
        ]
    };
    const state = {
        plan,
        coverage,
        weekIndex: 23,
        opportunityModel: Object.assign(
            api.buildOpportunityModel(plan, coverage, { weekIndex: 23 }),
            { actionable: [], unresolved: [{ cropId: "cilantro" }] }
        )
    };

    assert.equal(api.buildWeekOptionLabel(state, 23), "Week 24 - 2027-06-07 - 6.0 kg short - 1 issue");
    assert.equal(api.buildWeekOptionLabel(state, 24), "Week 25 - 2027-06-14 - 2.0 kg short - 1 actionable");
});


test("Allocate sow-week schedule groups future demand by returned start date", async () => {
    const api = loadAllocatePlugin();
    const lifecycleRequests = [];
    api.__window.USL.scheduler = {
        async resolvePlantForPlanCrop() {
            return {
                ok: true,
                plant: { plant_id: 1, plant_name: "Cilantro", spacing_cm: 10, yield_per_plant_kg: 1 },
                plantId: "1",
                varietyId: "",
                varietyName: "",
                label: "Cilantro"
            };
        },
        async proposeLifecycleForDemandWindow(options) {
            lifecycleRequests.push(options);
            return {
                ok: true,
                status: "compatible",
                startISO: "2027-05-01",
                primaryDateISO: "2027-05-01",
                attributePatch: { sow_date: "2027-05-01", harvest_start: "2027-06-07", harvest_end: "2027-06-14" },
                warnings: [],
                taskPreview: []
            };
        }
    };
    api.__window.USL.tiler = {
        readBedProfile() { return {}; },
        proposePlantingGeometry(input) {
            assert.equal(input.entryISO, "2027-05-01");
            return { ok: true, status: "compatible", capacity: 12, geometry: { x: 0, y: 0, width: 100, height: 40 }, slots: [] };
        }
    };
    api.__window.USL.planningCore = {
        recommendPlantCount() { return { plantCount: 3, reachableShortKg: 3 }; },
        simulateCandidatePlanting() { return { demandServedKg: 3 }; }
    };
    const plan = {
        crops: [{ id: "cilantro", plantId: "1", plant: "Cilantro", method: "direct_sow.field", kgPerPlant: 1 }]
    };
    const coverage = {
        totals: { targetKg: 3, shortKg: 3 },
        cropSummaries: [{ cropId: "cilantro", targetKg: 3, shortKg: 3 }],
        weekSummaries: [
            { weekIndex: 17, start: "2027-05-01", targetKg: 0, shortKg: 0, cropShortages: [] },
            { weekIndex: 23, start: "2027-06-07", targetKg: 3, shortKg: 3, cropShortages: [{ cropId: "cilantro", label: "Cilantro", shortKg: 3 }] }
        ]
    };
    const state = { moduleCell: {}, year: 2027, plan, coverage, city: {}, beds: [{ getAttribute: () => "Bed 1" }], occupancy: [], weekIndex: 23 };

    state.actionSchedule = await api.buildSowWeekSchedule(state);
    state.weekIndex = state.actionSchedule.actionableWeekIndices[0];
    state.opportunityModel = api.buildSowWeekOpportunityModel(state, state.weekIndex);

    assert.deepEqual(Array.from(state.actionSchedule.actionableWeekIndices), [17]);
    assert.equal(state.opportunityModel.actionable[0].cropId, "cilantro");
    assert.equal(state.opportunityModel.actionable[0].allocationDemandWeekIndex, 23);
    assert.equal(state.opportunityModel.actionable[0].allocationActionStartISO, "2027-05-01");
    assert.equal(api.buildWeekOptionLabel(state, 17), "Week 18 - 2027-05-01 - 1 sow action - 3.0 kg future demand");
    assert.equal(lifecycleRequests[0].targetStartISO, "2027-06-07");
    assert.equal(lifecycleRequests[0].targetEndISO, "2027-06-13");
    assert.equal(lifecycleRequests[0].weekStartISO, undefined);
});

test("Allocate progress text reports row and action counts", () => {
    const api = loadAllocatePlugin();
    const text = api.scheduleProgressText({
        scheduleProgress: {
            phase: "checking beds",
            processedRows: 2,
            totalRows: 5,
            foundActions: 1
        }
    });

    assert.match(text, /2 of 5 demand rows/);
    assert.match(text, /1 action found/);
});

test("Allocate open renders a progress state before sow-week scheduling completes", async () => {
    const api = loadAllocatePlugin();
    let lifecycleCalls = 0;
    const moduleCell = { id: "module-1" };
    const bed = {
        id: "bed-1",
        getAttribute(key) { return key === "label" ? "Bed 1" : ""; },
        getGeometry() { return { x: 0, y: 0, width: 120, height: 40 }; }
    };
    const plan = {
        crops: [
            { id: "cilantro", plantId: "1", plant: "Cilantro", method: "direct_sow.field", kgPerPlant: 1 },
            { id: "radish", plantId: "2", plant: "Radish", method: "direct_sow.field", kgPerPlant: 1 }
        ]
    };
    const coverage = {
        totals: { targetKg: 5, shortKg: 5 },
        cropSummaries: [
            { cropId: "cilantro", targetKg: 3, shortKg: 3 },
            { cropId: "radish", targetKg: 2, shortKg: 2 }
        ],
        weekSummaries: [
            { weekIndex: 17, start: "2027-05-01", targetKg: 0, shortKg: 0, cropShortages: [] },
            { weekIndex: 23, start: "2027-06-07", targetKg: 3, shortKg: 3, cropShortages: [{ cropId: "cilantro", label: "Cilantro", shortKg: 3 }] },
            { weekIndex: 24, start: "2027-06-14", targetKg: 2, shortKg: 2, cropShortages: [{ cropId: "radish", label: "Radish", shortKg: 2 }] }
        ]
    };
    api.__window.USL.scheduler = {
        async resolveCityForModule() { return { ok: true, city: { name: "Test" } }; },
        async resolvePlantForPlanCrop() {
            return { ok: true, plant: { plant_id: 1, plant_name: "Cilantro", spacing_cm: 10, yield_per_plant_kg: 1 }, plantId: "1", varietyId: "", varietyName: "", label: "Cilantro" };
        },
        async proposeLifecycleForDemandWindow() {
            lifecycleCalls += 1;
            await new Promise(resolve => setTimeout(resolve, 20));
            return {
                ok: true,
                status: "compatible",
                startISO: "2027-05-01",
                primaryDateISO: "2027-05-01",
                attributePatch: { sow_date: "2027-05-01", harvest_start: "2027-06-07", harvest_end: "2027-06-14" },
                warnings: [],
                taskPreview: []
            };
        }
    };
    api.__window.USL.planningCore = {
        loadPlanForYear() { return plan; },
        computeYearCoverage() { return coverage; },
        recommendPlantCount() { return { plantCount: 3, reachableShortKg: 3 }; },
        simulateCandidatePlanting() { return { demandServedKg: 3 }; }
    };
    api.__window.USL.tiler = {
        listGardenBeds() { return [bed]; },
        listPlantingFootprints() { return []; },
        readBedProfile() { return {}; },
        proposePlantingGeometry() { return { ok: true, status: "compatible", capacity: 12, geometry: { x: 0, y: 0, width: 100, height: 40 }, slots: [] }; }
    };

    const state = await api.__window.USL.allocate.open(moduleCell, 2027);

    assert.equal(state.scheduleProgress.phase, "scanning demand");
    assert.equal(state.scheduleProgress.processedRows, 0);
    assert.equal(state.scheduleProgress.totalRows, 2);
    assert.match(api.scheduleProgressText(state), /0 of 2 demand rows/);

    const weekSelect = state.hudRefs.weekSelect;
    weekSelect.focus();
    await waitUntil(() => state.scheduleProgress.processedRows >= 1);
    assert.equal(api.__document.activeElement, weekSelect); // CHANGE: progress renders must not replace the focused week dropdown.

    const cropSelect = state.hudRefs.cropSelect;
    cropSelect.focus();

    await waitUntil(() => state.scheduleProgress.phase === "complete");

    assert.equal(api.__document.activeElement, cropSelect); // CHANGE: final progress render must keep the focused crop dropdown stable.
    assert.equal(state.scheduleProgress.phase, "complete");
    assert.equal(state.scheduleProgress.processedRows, 2);
    assert.equal(state.scheduleProgress.totalRows, 2);
    assert.equal(state.scheduleProgress.foundActions, 2);
    assert.deepEqual(Array.from(state.actionSchedule.actionableWeekIndices), [17]);
    assert.equal(lifecycleCalls, 2);
    assert.ok(collectText(api.__root).includes("Create planting")); // CHANGE

    cropSelect.value = "cilantro";
    cropSelect.dispatchEvent({ type: "change", target: cropSelect });
    api.__graph.setSelectionCell(state.beds[0]); // CHANGE: a proposal now requires an explicit bed selection.
    await waitUntil(() => !!state.draft);

    const controlLayer = api.__graphContainer.querySelector(".trellis-graph-control-layer");
    const allocateLayer = api.__graphContainer.querySelector(".trellis-allocate-overlay-layer");
    const badge = api.__graphContainer.querySelector('[data-bed-id="bed-1"]');
    const annotationLayer = api.__graphContainer.querySelector(".trellis-graph-annotation-layer");
    const ghost = api.__graphContainer.querySelector(".trellis-allocate-ghost");
    assert.ok(controlLayer, "expected Allocate to create the shared graph control layer"); // CHANGE
    assert.equal(allocateLayer.parentNode, controlLayer); // CHANGE: Allocate badges should be graph-local controls, not body-fixed nodes.
    assert.equal(badge.parentNode, allocateLayer); // CHANGE
    assert.equal(badge.textContent, "Good fit"); assert.match(badge.title, /Cilantro/); // CHANGE: details move to the accessible tooltip. // CHANGE
    assert.match(badge.style.cssText, /position:absolute/); // CHANGE
    assert.equal(badge.style.left, "6px"); // CHANGE: bed badge position follows the rendered bed state, not scroll math.
    assert.equal(badge.style.top, "6px"); // CHANGE
    assert.equal(ghost.parentNode, annotationLayer); // CHANGE: draft ghost sits below controls on the graph annotation layer.
    assert.match(ghost.style.cssText, /position:absolute/); // CHANGE
    assert.match(ghost.style.cssText, /left:0/); // CHANGE
    assert.match(ghost.style.cssText, /top:0/); // CHANGE

    api.__window.USL.allocate.close("cache-test");
    const reopened = await api.__window.USL.allocate.open(moduleCell, 2027);

    assert.equal(reopened.scheduleProgress.phase, "complete");
    assert.equal(reopened.scheduleProgress.foundActions, 2);
    assert.deepEqual(Array.from(reopened.actionSchedule.actionableWeekIndices), [17]);
    assert.equal(lifecycleCalls, 2);
});

test("Allocate graph proposal coordinates convert directly to screen coordinates", () => {
    const api = loadAllocatePlugin();
    const point = api.graphPointToScreen(50, 80);

    assert.equal(point.left, 70);
    assert.equal(point.top, 110);
    assert.equal(point.scale, 1);
});

test("Allocate graph overlay coordinates are relative to the graph container", () => {
    const api = loadAllocatePlugin();
    const point = api.graphPointToContainer(50, 80);

    assert.equal(point.left, 50); // CHANGE // CHANGE: graph-local overlays include container scroll, not viewport origin.
    assert.equal(point.top, 80); // CHANGE: graph content scrolls without added offsets. // CHANGE
    assert.equal(point.scale, 1);
});

test("Allocate bed badges stay anchored to distinct rendered bed states after zoom", async () => {
    const api = loadAllocatePlugin();
    let geometryCalls = 0;
    const moduleCell = { id: "module-1" };
    const bed1 = {
        id: "bed-1",
        getAttribute(key) { return key === "label" ? "Bed 1" : ""; },
        getGeometry() { return { x: 0, y: 0, width: 120, height: 40 }; }
    };
    const bed2 = {
        id: "bed-2",
        getAttribute(key) { return key === "label" ? "Bed 2" : ""; },
        getGeometry() { return { x: 200, y: 80, width: 140, height: 50 }; }
    };
    const plan = { crops: [{ id: "cilantro", plantId: "1", plant: "Cilantro", method: "direct_sow.field", kgPerPlant: 1 }] };
    const coverage = {
        totals: { targetKg: 2, shortKg: 2 },
        cropSummaries: [{ cropId: "cilantro", targetKg: 2, shortKg: 2 }],
        weekSummaries: [
            { weekIndex: 17, start: "2027-05-01", targetKg: 0, shortKg: 0, cropShortages: [] },
            { weekIndex: 23, start: "2027-06-07", targetKg: 2, shortKg: 2, cropShortages: [{ cropId: "cilantro", label: "Cilantro", shortKg: 2 }] }
        ]
    };
    api.__window.USL.scheduler = {
        async resolveCityForModule() { return { ok: true, city: { name: "Test" } }; },
        async resolvePlantForPlanCrop() {
            return { ok: true, plant: { plant_id: 1, plant_name: "Cilantro", spacing_cm: 10, yield_per_plant_kg: 1 }, plantId: "1", varietyId: "", varietyName: "", label: "Cilantro" };
        },
        async proposeLifecycleForDemandWindow() {
            return {
                ok: true,
                status: "compatible",
                startISO: "2027-05-01",
                primaryDateISO: "2027-05-01",
                attributePatch: { sow_date: "2027-05-01", harvest_start: "2027-06-07", harvest_end: "2027-06-14" },
                warnings: [],
                taskPreview: []
            };
        }
    };
    api.__window.USL.planningCore = {
        loadPlanForYear() { return plan; },
        computeYearCoverage() { return coverage; },
        recommendPlantCount() { return { plantCount: 2, reachableShortKg: 2 }; },
        simulateCandidatePlanting() { return { demandServedKg: 2 }; }
    };
    api.__window.USL.tiler = {
        listGardenBeds() { return [bed1, bed2]; },
        listPlantingFootprints() { return []; },
        readBedProfile() { return {}; },
        proposePlantingGeometry() {
            geometryCalls += 1;
            return { ok: true, status: "compatible", capacity: 12, geometry: { x: 0, y: 0, width: 100, height: 40 }, slots: [] };
        }
    };

    const state = await api.__window.USL.allocate.open(moduleCell, 2027);
    await waitUntil(() => state.scheduleProgress.phase === "complete");
    state.hudRefs.cropSelect.value = "cilantro";
    state.hudRefs.cropSelect.dispatchEvent({ type: "change", target: state.hudRefs.cropSelect });
    await waitUntil(() => !!api.__graphContainer.querySelector('[data-bed-id="bed-2"]'));

    const badge1 = api.__graphContainer.querySelector('[data-bed-id="bed-1"]');
    const badge2 = api.__graphContainer.querySelector('[data-bed-id="bed-2"]');
    assert.equal(badge1.style.left, "6px"); // CHANGE: badges are anchored per bed, not stacked.
    assert.equal(badge1.style.top, "6px"); // CHANGE
    assert.equal(badge2.style.left, "206px"); // CHANGE
    assert.equal(badge2.style.top, "86px"); // CHANGE

    const callsBeforeZoom = geometryCalls;
    api.__graph.view.scale = 2;
    api.__graph.view.translate = { x: 10, y: 5 };
    api.__fireViewEvent("scaleAndTranslate");

    assert.equal(geometryCalls, callsBeforeZoom); // CHANGE: view-only anchoring must not recompute allocation fit.
    assert.equal(badge1.style.left, "26px"); // CHANGE: x=(0+10)*2 + 6.
    assert.equal(badge1.style.top, "16px"); // CHANGE
    assert.equal(badge2.style.left, "426px"); // CHANGE
    assert.equal(badge2.style.top, "176px"); // CHANGE
});

test("Allocate close cancels a pending sow-week schedule job", async () => {
    const api = loadAllocatePlugin();
    let lifecycleCalls = 0;
    const moduleCell = { id: "module-1" };
    const bed = {
        id: "bed-1",
        getAttribute() { return ""; },
        getGeometry() { return { x: 0, y: 0, width: 120, height: 40 }; }
    };
    const plan = {
        crops: [{ id: "cilantro", plantId: "1", plant: "Cilantro", method: "direct_sow.field", kgPerPlant: 1 }]
    };
    const coverage = {
        totals: { targetKg: 3, shortKg: 3 },
        cropSummaries: [{ cropId: "cilantro", targetKg: 3, shortKg: 3 }],
        weekSummaries: [{ weekIndex: 23, start: "2027-06-07", targetKg: 3, shortKg: 3, cropShortages: [{ cropId: "cilantro", label: "Cilantro", shortKg: 3 }] }]
    };
    api.__window.USL.scheduler = {
        async resolveCityForModule() { return { ok: true, city: {} }; },
        async resolvePlantForPlanCrop() {
            return { ok: true, plant: { plant_id: 1, plant_name: "Cilantro", spacing_cm: 10, yield_per_plant_kg: 1 }, plantId: "1" };
        },
        async proposeLifecycleForDemandWindow() {
            lifecycleCalls += 1;
            return { ok: false, reason: "should not run after cancellation" };
        }
    };
    api.__window.USL.planningCore = {
        loadPlanForYear() { return plan; },
        computeYearCoverage() { return coverage; },
        recommendPlantCount() { return { plantCount: 3, reachableShortKg: 3 }; },
        simulateCandidatePlanting() { return { demandServedKg: 3 }; }
    };
    api.__window.USL.tiler = {
        listGardenBeds() { return [bed]; },
        listPlantingFootprints() { return []; },
        readBedProfile() { return {}; },
        proposePlantingGeometry() { return { ok: true, status: "compatible", capacity: 12, geometry: {}, slots: [] }; }
    };

    const state = await api.__window.USL.allocate.open(moduleCell, 2027);
    api.__window.USL.allocate.close("test");
    await new Promise(resolve => setTimeout(resolve, 20));

    assert.equal(state.closed, true);
    assert.equal(state.scheduleProgress.phase, "cancelled");
    assert.equal(state.scheduleProgress.processedRows, 0);
    assert.equal(lifecycleCalls, 0);
});

test("Allocate reuses lifecycle and bed-result checks for repeated crop and bed evaluations", async () => {
    const api = loadAllocatePlugin();
    let lifecycleCalls = 0;
    const bed = {
        id: "bed-1",
        getAttribute() { return ""; },
        getGeometry() { return { x: 0, y: 0, width: 120, height: 40 }; }
    };
    api.__window.USL.scheduler = {
        async resolvePlantForPlanCrop() {
            return { ok: true, plant: { plant_id: 1, plant_name: "Radish", spacing_cm: 10, yield_per_plant_kg: 1 }, plantId: "1" };
        },
        async proposeLifecycleForDemandWindow() {
            lifecycleCalls += 1;
            return {
                ok: true,
                status: "compatible",
                startISO: "2027-04-01",
                primaryDateISO: "2027-04-01",
                attributePatch: { sow_date: "2027-04-01", harvest_start: "2027-05-01", harvest_end: "2027-05-08" },
                warnings: [],
                taskPreview: []
            };
        }
    };
    api.__window.USL.tiler = {
        readBedProfile() { return {}; },
        proposePlantingGeometry() { return { ok: true, status: "compatible", capacity: 12, geometry: { x: 0, y: 0, width: 100, height: 40 }, slots: [] }; }
    };
    api.__window.USL.planningCore = {
        recommendPlantCount() { return { plantCount: 3, reachableShortKg: 3 }; },
        simulateCandidatePlanting() { return { demandServedKg: 3 }; }
    };
    const state = {
        moduleCell: {},
        year: 2027,
        plan: { crops: [{ id: "radish", plantId: "1", plant: "Radish", method: "direct_sow.field", kgPerPlant: 1 }] },
        coverage: {
            weekSummaries: [{ weekIndex: 17, start: "2027-05-01", targetKg: 3, shortKg: 3 }]
        },
        city: {},
        beds: [bed],
        occupancy: [],
        weekIndex: 17,
        lifecycleCache: new Map(),
        bedResultCache: new Map(),
        scheduleProgress: api.createScheduleProgress("checking beds", 1)
    };
    const crop = { id: "radish", cropId: "radish", plantId: "1", plant: "Radish", method: "direct_sow.field", kgPerPlant: 1 };

    const first = await api.computeBedResult(state, crop, bed);
    const second = await api.computeBedResult(state, crop, bed);

    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.equal(lifecycleCalls, 1);
    assert.ok(state.scheduleProgress.cacheHits >= 1);
});

test("Allocate debug snapshot explains first demand and shortage weeks", () => {
    const api = loadAllocatePlugin();
    const state = {
        year: 2027,
        weekIndex: 23,
        plan: {
            demands: [{ id: "market", channelId: "farm_store", cropId: "cilantro", qty: 6, unit: "kg", from: "2027-06-01", to: "2027-06-30" }],
            selfSufficiency: { enabled: true, lines: [{ id: "self", cropId: "radish", qty: 1, unit: "kg", from: "2027-05-01", to: "2027-05-31" }] },
            csa: { enabled: true, boxesPerWeek: 10, start: "2027-07-01", end: "2027-08-01", components: [{ cropId: "cilantro", qty: 1, unit: "kg" }] }
        },
        coverage: {
            totals: { targetKg: 12, shortKg: 6 },
            weekSummaries: [
                { weekIndex: 18, start: "2027-05-03", targetKg: 4, shortKg: 0, cropShortages: [] },
                { weekIndex: 23, start: "2027-06-07", targetKg: 6, shortKg: 6, cropShortages: [{ cropId: "cilantro", label: "Cilantro", shortKg: 6 }] }
            ]
        },
        opportunityModel: { actionable: [], unresolved: [{ cropId: "cilantro" }], satisfied: [] }
    };

    const snapshot = api.buildAllocationDebugSnapshot(state);

    assert.equal(snapshot.selectedWeek.week, 24);
    assert.equal(snapshot.firstDemandWeek.week, 19);
    assert.equal(snapshot.firstShortageWeek.week, 24);
    assert.equal(snapshot.weeks[1].cropShortageCount, 1);
    assert.equal(snapshot.weeks[1].cropShortages, "Cilantro 6.0 kg");
    assert.equal(snapshot.opportunityCounts.unresolved, 1);
    assert.equal(snapshot.demandRanges.map(row => row.kind).join("|"), "demand|self|csa|csa_component");
});

test("Allocate debug snapshot tolerates empty demand collections", () => {
    const api = loadAllocatePlugin();

    assert.doesNotThrow(() => api.buildAllocationDebugSnapshot({
        year: 2027,
        weekIndex: 0,
        plan: {},
        coverage: { totals: {}, weekSummaries: [] },
        opportunityModel: {}
    }));

    const snapshot = api.buildAllocationDebugSnapshot({ plan: null, coverage: null, opportunityModel: null });
    assert.equal(snapshot.demandRanges.length, 0);
    assert.equal(snapshot.weeks.length, 0);
    assert.equal(snapshot.firstDemandWeek, null);
    assert.equal(snapshot.firstShortageWeek, null);
});

test("Allocate resolves crop method context from explicit and legacy dotted methods", () => {
    const api = loadAllocatePlugin();

    const explicit = api.resolveCropMethodContext({ method: "direct_sow.field", methodCategoryId: "direct_sow" });
    assert.equal(explicit.ok, true);
    assert.equal(explicit.methodId, "direct_sow.field");
    assert.equal(explicit.methodCategoryId, "direct_sow");

    const inferred = api.resolveCropMethodContext({ method: "direct_sow.field" });
    assert.equal(inferred.ok, true);
    assert.equal(inferred.methodId, "direct_sow.field");
    assert.equal(inferred.methodCategoryId, "direct_sow");

    const repaired = api.resolveCropMethodContext({ method: "direct_sow.field", methodCategoryId: "transplant" });
    assert.equal(repaired.ok, true);
    assert.equal(repaired.methodId, "direct_sow.field");
    assert.equal(repaired.methodCategoryId, "direct_sow");
    assert.equal(repaired.repairedMethodCategoryId, true);

    const categoryOnly = api.resolveCropMethodContext({ method: "direct_sow" });
    assert.equal(categoryOnly.ok, false);
    assert.equal(categoryOnly.methodId, "direct_sow");
    assert.equal(categoryOnly.methodCategoryId, "");
    assert.equal(categoryOnly.reason, "Year Plan method must be a concrete method like direct_sow.field.");

    const unsupported = api.resolveCropMethodContext({ method: "legacy.method", methodCategoryId: "legacy" });
    assert.equal(unsupported.ok, false);
    assert.equal(unsupported.methodId, "legacy.method");
    assert.equal(unsupported.methodCategoryId, "legacy");
    assert.equal(unsupported.reason, "Unsupported Year Plan method: legacy.method.");
});

test("Allocate bed result creates max-fit partial draft when full recommendation is oversized", async () => {
    const api = loadAllocatePlugin();
    const calls = [];
    const lifecycleRequests = [];
    api.__window.USL.scheduler = {
        async resolvePlantForPlanCrop() {
            return {
                ok: true,
                plant: { plant_id: 15, plant_name: "Radish", spacing_x_cm: 30, spacing_y_cm: 9, yield_per_plant_kg: 0.025 },
                plantId: "15",
                varietyId: "",
                varietyName: "",
                label: "Radish"
            };
        },
        async proposeLifecycle(options) {
            lifecycleRequests.push(options);
            return {
                ok: true,
                status: "compatible",
                primaryDateISO: "2027-05-01",
                attributePatch: { harvest_start: "2027-06-13", harvest_end: "2027-10-18" },
                warnings: [],
                taskPreview: []
            };
        }
    };
    api.__window.USL.tiler = {
        readBedProfile() { return {}; },
        proposePlantingGeometry(input) {
            calls.push(input.plantCount);
            if (input.plantCount === 800) return { ok: false, reason: "insufficient_space", capacity: 48 };
            assert.equal(input.plantCount, 48);
            return { ok: true, status: "compatible", capacity: 48, geometry: { x: 0, y: 0, width: 100, height: 40 }, slots: [] };
        }
    };
    api.__window.USL.planningCore = {
        recommendPlantCount() { return { plantCount: 800, reachableShortKg: 20 }; },
        simulateCandidatePlanting(input) {
            return { demandServedKg: input.candidate.plantCount * input.candidate.kgPerPlant };
        }
    };
    const state = {
        moduleCell: {},
        year: 2027,
        plan: { crops: [] },
        city: {},
        coverage: { weekSummaries: [{ weekIndex: 23, start: "2027-06-13" }] },
        weekIndex: 23,
        occupancy: []
    };

    const result = await api.computeBedResult(state, { id: "radish", cropId: "radish", plantId: "15", plant: "Radish", method: "direct_sow.field", kgPerPlant: 0.025 }, { getAttribute: () => "" });

    assert.equal(result.ok, true);
    assert.equal(result.status, "warning");
    assert.equal(result.partialPlanting, true);
    assert.equal(result.fullPlantCount, 800);
    assert.equal(result.plantCount, 48);
    assert.ok(Math.abs(result.demandServedKg - 1.2) < 1e-9);
    assert.deepEqual(calls, [800, 48]);
    assert.equal(lifecycleRequests[0].methodId, "direct_sow.field");
    assert.equal(lifecycleRequests[0].methodCategoryId, "direct_sow");
    assert.match(result.warnings.join("\n"), /Partial allocation: 48 of 800 plants fit in this bed\./);
});

test("Allocate bed result keeps full-fit draft semantics", async () => {
    const api = loadAllocatePlugin();
    const lifecycleRequests = [];
    api.__window.USL.scheduler = {
        async resolvePlantForPlanCrop() {
            return {
                ok: true,
                plant: { plant_id: 1, plant_name: "Lettuce", spacing_cm: 30, yield_per_plant_kg: 1 },
                plantId: "1",
                varietyId: "",
                varietyName: "",
                label: "Lettuce"
            };
        },
        async proposeLifecycle(options) {
            lifecycleRequests.push(options);
            return {
                ok: true,
                status: "compatible",
                primaryDateISO: "2027-04-01",
                attributePatch: { harvest_start: "2027-06-01", harvest_end: "2027-06-30" },
                warnings: [],
                taskPreview: []
            };
        }
    };
    api.__window.USL.tiler = {
        readBedProfile() { return {}; },
        proposePlantingGeometry(input) {
            assert.equal(input.plantCount, 10);
            return { ok: true, status: "compatible", capacity: 48, geometry: { x: 0, y: 0, width: 100, height: 40 }, slots: [] };
        }
    };
    api.__window.USL.planningCore = {
        recommendPlantCount() { return { plantCount: 10, reachableShortKg: 10 }; },
        simulateCandidatePlanting(input) {
            assert.equal(input.candidate.plantCount, 10);
            return { demandServedKg: 10 };
        }
    };
    const state = {
        moduleCell: {},
        year: 2027,
        plan: { crops: [] },
        city: {},
        coverage: { weekSummaries: [{ weekIndex: 22, start: "2027-06-01" }] },
        weekIndex: 22,
        occupancy: []
    };

    const result = await api.computeBedResult(state, { id: "lettuce", cropId: "lettuce", plantId: "1", plant: "Lettuce", method: "direct_sow.field", methodCategoryId: "direct_sow", kgPerPlant: 1 }, { getAttribute: () => "" });

    assert.equal(result.ok, true);
    assert.equal(result.status, "compatible");
    assert.equal(result.partialPlanting, false);
    assert.equal(result.fullPlantCount, 10);
    assert.equal(result.plantCount, 10);
    assert.equal(result.demandServedKg, 10);
    assert.equal(lifecycleRequests[0].methodId, "direct_sow.field");
    assert.equal(lifecycleRequests[0].methodCategoryId, "direct_sow");
});

test("Allocate repairs mismatched Year Plan method categories before lifecycle scheduling", async () => {
    const api = loadAllocatePlugin();
    const lifecycleRequests = [];
    api.__window.USL.scheduler = {
        async resolvePlantForPlanCrop() {
            return {
                ok: true,
                plant: { plant_id: 1, plant_name: "Lettuce", spacing_cm: 30, yield_per_plant_kg: 1 },
                plantId: "1",
                varietyId: "",
                varietyName: "",
                label: "Lettuce"
            };
        },
        async proposeLifecycle(options) {
            lifecycleRequests.push(options);
            return {
                ok: true,
                status: "compatible",
                primaryDateISO: "2027-04-01",
                attributePatch: { harvest_start: "2027-06-01", harvest_end: "2027-06-30" },
                warnings: [],
                taskPreview: []
            };
        }
    };
    api.__window.USL.tiler = {
        readBedProfile() { return {}; },
        proposePlantingGeometry() {
            return { ok: true, status: "compatible", capacity: 48, geometry: { x: 0, y: 0, width: 100, height: 40 }, slots: [] };
        }
    };
    api.__window.USL.planningCore = {
        recommendPlantCount() { return { plantCount: 10, reachableShortKg: 10 }; },
        simulateCandidatePlanting() { return { demandServedKg: 10 }; }
    };
    const state = {
        moduleCell: {},
        year: 2027,
        plan: { crops: [] },
        city: {},
        coverage: { weekSummaries: [{ weekIndex: 22, start: "2027-06-01" }] },
        weekIndex: 22,
        occupancy: []
    };

    const crop = { id: "lettuce", cropId: "lettuce", plantId: "1", plant: "Lettuce", method: "direct_sow.field", methodCategoryId: "transplant", kgPerPlant: 1 };
    const result = await api.computeBedResult(state, crop, { getAttribute: () => "" });

    assert.equal(result.ok, true);
    assert.equal(crop.methodCategoryId, "transplant");
    assert.equal(lifecycleRequests[0].methodId, "direct_sow.field");
    assert.equal(lifecycleRequests[0].methodCategoryId, "direct_sow");
});

test("Allocate bed result reports category-only Year Plan methods before lifecycle scheduling", async () => {
    const api = loadAllocatePlugin();
    let lifecycleCalled = false;
    api.__window.USL.scheduler = {
        async resolvePlantForPlanCrop() {
            return {
                ok: true,
                plant: { plant_id: 1, plant_name: "Radish", spacing_cm: 10, yield_per_plant_kg: 1 },
                plantId: "1",
                varietyId: "",
                varietyName: "",
                label: "Radish"
            };
        },
        async proposeLifecycle() {
            lifecycleCalled = true;
            return { ok: true };
        }
    };
    api.__window.USL.tiler = {
        readBedProfile() { return {}; },
        proposePlantingGeometry() { return { ok: true, status: "compatible", capacity: 1, geometry: {}, slots: [] }; }
    };
    api.__window.USL.planningCore = {
        recommendPlantCount() { return { plantCount: 1, reachableShortKg: 1 }; },
        simulateCandidatePlanting() { return { demandServedKg: 1 }; }
    };
    const state = {
        moduleCell: {},
        year: 2027,
        plan: { crops: [] },
        city: {},
        coverage: { weekSummaries: [{ weekIndex: 22, start: "2027-06-01" }] },
        weekIndex: 22,
        occupancy: []
    };

    const result = await api.computeBedResult(state, { id: "radish", cropId: "radish", plantId: "1", plant: "Radish", method: "direct_sow", kgPerPlant: 1 }, { getAttribute: () => "" });

    assert.equal(result.ok, false);
    assert.equal(result.reason, "Year Plan method must be a concrete method like direct_sow.field.");
    assert.equal(lifecycleCalled, false);
});

test("Allocate bed result reports unsupported concrete methods before lifecycle scheduling", async () => {
    const api = loadAllocatePlugin();
    let lifecycleCalled = false;
    api.__window.USL.scheduler = {
        async resolvePlantForPlanCrop() {
            return {
                ok: true,
                plant: { plant_id: 1, plant_name: "Radish", spacing_cm: 10, yield_per_plant_kg: 1 },
                plantId: "1",
                varietyId: "",
                varietyName: "",
                label: "Radish"
            };
        },
        async proposeLifecycle() {
            lifecycleCalled = true;
            return { ok: true };
        }
    };
    api.__window.USL.tiler = {
        readBedProfile() { return {}; },
        proposePlantingGeometry() { return { ok: true, status: "compatible", capacity: 1, geometry: {}, slots: [] }; }
    };
    api.__window.USL.planningCore = {
        recommendPlantCount() { return { plantCount: 1, reachableShortKg: 1 }; },
        simulateCandidatePlanting() { return { demandServedKg: 1 }; }
    };
    const state = {
        moduleCell: {},
        year: 2027,
        plan: { crops: [] },
        city: {},
        coverage: { weekSummaries: [{ weekIndex: 22, start: "2027-06-01" }] },
        weekIndex: 22,
        occupancy: []
    };

    const result = await api.computeBedResult(state, { id: "radish", cropId: "radish", plantId: "1", plant: "Radish", method: "legacy.method", methodCategoryId: "legacy", kgPerPlant: 1 }, { getAttribute: () => "" });

    assert.equal(result.ok, false);
    assert.equal(result.reason, "Unsupported Year Plan method: legacy.method.");
    assert.equal(lifecycleCalled, false);
});

test("Allocate plugin owns launch, draft review, and one-transaction create contracts", () => {
    assert.match(SOURCE, /const ALLOCATE_EVENT = "usl:allocatePlanRequested"/);
    assert.match(SOURCE, /openAllocationScheduleDialog/);
    assert.match(SOURCE, /resolveAllocationDefaultStatus/);
    assert.match(SOURCE, /window\.USL\.tasks/);
    assert.match(SOURCE, /applySchedulerTaskReplacement/);
    assert.match(SOURCE, /action: "allocateCreate"/);
    assert.match(SOURCE, /category: "Garden scheduling"/);
    assert.match(SOURCE, /allocation_source: "year_plan"/);
    assert.match(SOURCE, /allocation_partial/);
    assert.match(SOURCE, /allocation_demand_served_kg/);
    assert.match(SOURCE, /buildWeekOpportunityModel/);
    assert.match(SOURCE, /listPlantingFootprints/);
    assert.match(SOURCE, /currentBedContext/);
    assert.match(SOURCE, /Create planting/); // CHANGE
    assert.match(SOURCE, /renderer\.render\(state\.ownerId/); // CHANGE: draft ghosts render in graph-local overlay coordinates.
    assert.match(SOURCE, /vegHeightCm: context\.plantResolution\.plant\.veg_height_cm \|\| null/);
    assert.match(SOURCE, /state\.draft = rotateAllocationResult\(state, state\.draft\)/); // CHANGE: rotation shares the authoritative fitting and supply calculation.
});

test('coverage preview uses simulated fulfilled demand, including storage and expiry', () => { // CHANGE
    const { createYearPlannerHarness, makePlanCrop } = require('./helpers/year-planner-harness.cjs');
    const { api: planning } = createYearPlannerHarness();
    const allocate = loadAllocatePlugin();
    for (const shelfLifeDays of [0, 14]) {
        const plan = planning.PlanSchema.createEmptyPlan(2026);
        plan.crops.push(makePlanCrop({ shelfLifeDays }));
        plan.demands.push({ id: 'sales', channelId: 'farm_store', cropId: 'crop_1', qty: 5, unit: 'kg', frequency: 'week', everyN: 1, from: '2026-06-08', to: '2026-06-14', priority: 'target' });
        const original = JSON.stringify(plan);
        const simulation = planning.PlanningCore.simulateCandidatePlanting({ plan, year: 2026, candidate: { cropId: 'crop_1', plantCount: 10, kgPerPlant: 1, harvestStart: '2026-06-01', harvestEnd: '2026-06-07' } });
        const preview = allocate.buildCoveragePreview(simulation, 'crop_1');
        assert.equal(preview.rows.reduce((sum, row) => sum + row.demandKg, 0), 5);
        assert.equal(preview.rows.reduce((sum, row) => sum + row.beforeKg, 0), 0);
        assert.equal(preview.rows.reduce((sum, row) => sum + row.afterKg, 0), shelfLifeDays ? 5 : 0);
        assert.equal(preview.rows.reduce((sum, row) => sum + row.addedKg, 0), simulation.demandServedKg);
        assert.equal(JSON.stringify(plan), original);
    }
});

test('coverage preview rejects missing series instead of reporting zero coverage', () => { // CHANGE
    const api = loadAllocatePlugin();
    assert.equal(api.buildCoveragePreview({ demandServedKg: 1 }, 'crop'), null);
    const series = { target: [2], usableSupply: [1], short: [1] };
    const coverage = { weekStarts: [{ iso: '2026-01-05' }], weekly: { perCrop: new Map([['crop', series]]) } };
    assert.equal(api.buildCoveragePreview({ base: coverage, coverage }, 'missing'), null);
    series.usableSupply = [NaN];
    assert.equal(api.buildCoveragePreview({ base: coverage, coverage }, 'crop'), null);
});

test('coverage preview includes household, CSA, and sales demand and caps fulfillment at demand', () => { // CHANGE
    const { createYearPlannerHarness, makePlanCrop } = require('./helpers/year-planner-harness.cjs');
    const { api: planning } = createYearPlannerHarness();
    const allocate = loadAllocatePlugin();
    const plan = planning.PlanSchema.createEmptyPlan(2026);
    plan.crops.push(makePlanCrop());
    const demand = { cropId: 'crop_1', unit: 'kg', frequency: 'week', everyN: 1, from: '2026-06-01', to: '2026-06-07' };
    plan.selfSufficiency.lines.push({ ...demand, id: 'household', qty: 2 });
    plan.demands.push({ ...demand, id: 'sales', channelId: 'farm_store', qty: 4, priority: 'target' });
    Object.assign(plan.csa, { enabled: true, boxesPerWeek: 1, start: demand.from, end: demand.to, components: [{ cropId: 'crop_1', qty: 3, unit: 'kg', everyNWeeks: 1 }] });
    for (const plantCount of [4, 20]) {
        const simulation = planning.PlanningCore.simulateCandidatePlanting({ plan, year: 2026, candidate: { cropId: 'crop_1', plantCount, kgPerPlant: 1, harvestStart: demand.from, harvestEnd: demand.to } });
        const rows = allocate.buildCoveragePreview(simulation, 'crop_1').rows;
        assert.equal(rows.reduce((sum, row) => sum + row.demandKg, 0), 9);
        assert.equal(rows.reduce((sum, row) => sum + row.afterKg, 0), Math.min(plantCount, 9));
        assert.equal(rows.reduce((sum, row) => sum + row.shortKg, 0), Math.max(0, 9 - plantCount));
    }
});

test('allocation invalidates timing and geometry edits but ignores presentation-only changes', () => { // CHANGE
    const api = loadAllocatePlugin();
    assert.equal(api.allocationEditAffectsPlanning({ attribute: 'harvest_end' }), true);
    assert.equal(api.allocationEditAffectsPlanning({ geometry: {} }), true);
    assert.equal(api.allocationEditAffectsPlanning({ style: 'rotation=90', previous: 'rotation=0' }), true);
    assert.equal(api.allocationEditAffectsPlanning({ style: 'opacity=50;rotation=0', previous: 'opacity=100;rotation=0' }), false);
    const parent = {};
    assert.equal(api.allocationEditAffectsPlanning({ parent, previous: parent }), false);
});

/** Opens a real Allocate controller with deterministic scheduling and navigator spies. */ // CHANGE
async function previewSession({ selectBed = true, sharedButtons = false } = {}) { // CHANGE: exercise both normal and standalone button rendering.
    const api = loadAllocatePlugin();
    if (sharedButtons) { // CHANGE: load the production contract into the existing controller harness.
        api.__document.getElementById = id => api.__root.children.find(node => node.id === id) || null; // CHANGE
        const sharedSource = fs.readFileSync(path.join(path.dirname(PLUGIN_PATH), 'Trellis_UI_Cleanup.js'), 'utf8'); // CHANGE
        vm.runInNewContext(sharedSource.slice(0, sharedSource.indexOf('Draw.loadPlugin')), { window: api.__window, document: api.__document }); // CHANGE
    } // CHANGE
    const bed = { id: 'bed-preview', getAttribute: () => 'Bed', getGeometry: () => ({ x: 0, y: 0, width: 100, height: 40 }) };
    const crop = { id: 'crop', cropId: 'crop', plantId: '1', plant: 'Lettuce', label: 'Lettuce', method: 'direct_sow.field', kgPerPlant: 1 };
    const coverage = { totals: { targetKg: 4, shortKg: 4 }, cropSummaries: [{ cropId: 'crop', targetKg: 4, shortKg: 4 }], weekStarts: [{ iso: '2027-01-04' }, { iso: '2027-01-11' }], weekSummaries: [{ weekIndex: 0, start: '2027-01-04', targetKg: 0, shortKg: 0, cropShortages: [] }, { weekIndex: 1, start: '2027-01-11', targetKg: 4, shortKg: 4, cropShortages: [{ cropId: 'crop', shortKg: 4 }] }] };
    const lifecycle = { ok: true, status: 'compatible', startISO: '2027-01-04', primaryDateISO: '2027-01-04', attributePatch: { harvest_start: '2027-01-11', harvest_end: '2027-01-17' }, taskPreview: [], warnings: [] };
    const previews = [];
    const cleared = [];
    let creates = 0;
    api.__graph.__trellisBedSuccessionNavigator = { showAllocationPreview(input) { previews.push(input); }, clearAllocationPreview(ownerId) { cleared.push(ownerId); } };
    api.__window.USL.scheduler = {
        async resolveCityForModule() { return { ok: true, city: {} }; },
        async resolvePlantForPlanCrop() { return { ok: true, plant: { plant_name: 'Lettuce', spacing_cm: 10, yield_per_plant_kg: 1 } }; },
        async proposeLifecycleForDemandWindow() { return lifecycle; },
        async resolveAllocationDefaultStatus() { return { complete: false, missing: ['tasks'] }; }
    };
    const weekly = (usable, short) => ({ perCrop: new Map([['crop', { target: [0, 4], usableSupply: [0, usable], short: [0, short] }]]) });
    api.__window.USL.planningCore = {
        loadPlanForYear() { return { crops: [crop] }; }, computeYearCoverage() { return coverage; },
        recommendPlantCount() { return { plantCount: 4, reachableShortKg: 4 }; },
        simulateCandidatePlanting() { return { demandServedKg: 4, base: { ...coverage, weekly: weekly(0, 4) }, coverage: { ...coverage, weekly: weekly(4, 0) } }; }
    };
    api.__window.USL.tiler = { listGardenBeds: () => [bed], listPlantingFootprints: () => [], readBedProfile: () => ({}), proposePlantingGeometry: () => ({ ok: true, geometry: { x: 0, y: 0, width: 40, height: 20 }, slots: [] }), createPlantingFromProposal() { creates++; return { id: 'new' }; } };
    api.__window.USL.tasks = { applySchedulerTaskReplacement() {} };
    const state = await api.__window.USL.allocate.open({ id: 'module-preview' }, 2027);
    await waitUntil(() => state.scheduleProgress.phase === 'complete');
    state.hudRefs.cropSelect.value = 'crop';
    state.hudRefs.cropSelect.dispatchEvent({ type: 'change' });
    if (selectBed) api.__graph.setSelectionCell(bed); // CHANGE
    await waitUntil(() => selectBed ? !!state.draft : !!api.__graphContainer.querySelector('[data-bed-id="bed-preview"]')); // CHANGE
    if (selectBed) assert.ok(state.draft); // CHANGE
    return { api, state, bed, crop, lifecycle, previews, cleared, getCreates: () => creates }; // CHANGE
} // CHANGE

test('saving an edited schedule updates both previews without creating the planting', async () => { // CHANGE
    const harness = await previewSession({ sharedButtons: true }); // CHANGE: also verify shared styling preserves controller actions.
    const { api, state, lifecycle, previews } = harness;
    const close = state.hud.children[0].children.find(node => node.textContent === 'Close'); // CHANGE
    assert.equal(close.getAttribute('data-trellis-button-variant'), 'close'); assert.equal(close.style.border, '1px solid #b91c1c'); // CHANGE
    assert.equal(close.style.background, '#fff'); assert.equal(close.style.borderRadius, '6px'); assert.equal(close.style.padding, '6px 10px'); // CHANGE
    assert.equal(state.hudRefs.findBest.getAttribute('data-trellis-button-variant'), 'open'); assert.equal(state.hudRefs.create.getAttribute('data-trellis-button-variant'), 'add'); // CHANGE
    api.__window.USL.scheduler.openAllocationScheduleDialog = async (ui, draft, options) => {
        assert.equal(options.previewOnly, true);
        return { action: 'preview', draft: { ...draft, actionStartISO: '2027-01-05', lifecycle: { ...lifecycle, startISO: '2027-01-05', primaryDateISO: '2027-01-05' } } };
    };
    state.hudRefs.defaultsBox.querySelector('[data-allocation-missing-default="tasks"]').click(); // CHANGE: missing defaults have a separate setup link while Create stays disabled.
    await waitUntil(() => state.draft.actionStartISO === '2027-01-05' && !state.reviewing);
    assert.equal(state.draft.actionStartISO, '2027-01-05');
    assert.equal(previews.at(-1).entryISO, '2027-01-05');
    assert.equal(previews.at(-1).coveragePreview.rows[1].afterKg, 4);
    assert.equal(harness.getCreates(), 0);
    api.__window.USL.allocate.close();
    assert.equal(harness.cleared.at(-1), state.ownerId);
});

test('required-default checklist stays mounted through resize and its setup save enables direct creation without a scheduler loop', async () => { // CHANGE
    const h = await previewSession(), { api, state } = h; // CHANGE
    const link = state.hudRefs.defaultsBox.querySelector('[data-allocation-missing-default="tasks"]'); link.focus(); // CHANGE
    assert.equal(state.hudRefs.create.textContent, 'Create planting'); assert.equal(state.hudRefs.create.disabled, true); // CHANGE
    api.__window.dispatchEvent({ type: 'resize' }); assert.equal(state.hudRefs.defaultsBox.querySelector('[data-allocation-missing-default="tasks"]'), link); assert.equal(api.__document.activeElement, link); // CHANGE
    let saved = false, opened = 0; const tasks = [{ title: 'Saved recipe sow', startISO: '2027-01-04' }]; // CHANGE
    api.__window.USL.scheduler.resolveAllocationDefaultStatus = async () => ({ complete: saved, missing: saved ? [] : ['tasks'] }); // CHANGE
    api.__window.USL.scheduler.openAllocationScheduleDialog = async (ui, draft, options) => { // CHANGE
        opened++; assert.deepEqual(Array.from(options.requiredDefaults), ['tasks']); assert.equal(options.focusMissingDefault, 'tasks'); // CHANGE
        api.__window.dispatchEvent({ type: 'usl:growthStagesSaved', detail: { plantId: '1' } }); assert.equal(options.isCurrent(), true); // CHANGE: a setup's save notification must not cancel its own draft.
        saved = true; return { action: 'preview', draft: { ...draft, taskPreview: tasks, lifecycle: { ...draft.lifecycle, taskPreview: tasks } } }; // CHANGE
    }; // CHANGE
    link.click(); await waitUntil(() => !state.reviewing); assert.equal(h.getCreates(), 0); assert.equal(state.hudRefs.create.disabled, false); // CHANGE
    state.hudRefs.create.click(); await waitUntil(() => !state.reviewing); assert.equal(h.getCreates(), 1); assert.equal(opened, 1); assert.equal(api.__document.lastDialog, undefined); // CHANGE
    api.__window.USL.allocate.close(); // CHANGE
}); // CHANGE

test('a failed default lookup is separate from missing records and retry restores readiness without replacing the draft', async () => { // CHANGE
    const { api, state } = await previewSession(); const draft = state.draft; // CHANGE
    api.__window.USL.scheduler.resolveAllocationDefaultStatus = async () => { throw new Error('Default database unavailable'); }; // CHANGE
    state.defaultsLookup = null; api.__window.dispatchEvent({ type: 'resize' }); await waitUntil(() => !state.defaultsLookup.pending); // CHANGE
    assert.match(collectText(state.hudRefs.defaultsBox).join(' '), /Could not check required defaults.*Default database unavailable/); // CHANGE
    assert.equal(state.hudRefs.defaultsBox.querySelector('[data-allocation-missing-default]'), null); assert.equal(state.hudRefs.create.disabled, true); // CHANGE
    api.__window.USL.scheduler.resolveAllocationDefaultStatus = async () => ({ complete: true, missing: [] }); // CHANGE
    state.hudRefs.defaultsBox.children.find(node => node.textContent === 'Retry defaults check').click(); await waitUntil(() => !state.defaultsLookup.pending); // CHANGE
    assert.equal(state.hudRefs.create.disabled, false); assert.equal(state.draft, draft); api.__window.USL.allocate.close(); // CHANGE
}); // CHANGE

test('a late default lookup cannot enable creation for a newly selected method', async () => { // CHANGE
    const { api, state } = await previewSession(); let release; // CHANGE
    api.__window.USL.scheduler.resolveAllocationDefaultStatus = draft => draft.lifecycle?.methodId === 'transplant.indoor' ? Promise.resolve({ complete: false, missing: ['tasks'] }) : new Promise(resolve => { release = resolve; }); // CHANGE
    state.defaultsLookup = null; api.__window.dispatchEvent({ type: 'resize' }); await waitUntil(() => !!release); assert.equal(state.hudRefs.create.disabled, true); // CHANGE
    state.draft.lifecycle = { ...state.draft.lifecycle, methodId: 'transplant.indoor' }; api.__window.dispatchEvent({ type: 'resize' }); await waitUntil(() => !state.defaultsLookup.pending); // CHANGE
    release({ complete: true, missing: [] }); await new Promise(resolve => setTimeout(resolve, 10)); // CHANGE
    assert.equal(state.defaultsLookup.status.complete, false); assert.equal(state.hudRefs.create.disabled, true); api.__window.USL.allocate.close(); // CHANGE
}); // CHANGE

test('Create rereads saved defaults and rejects a formerly ready crop without opening setup or mutating the graph', async () => { // CHANGE
    const h = await previewSession(), { api, state } = h; let complete = true, setupCalls = 0; // CHANGE
    api.__window.USL.scheduler.resolveAllocationDefaultStatus = async () => ({ complete, missing: complete ? [] : ['method'] }); // CHANGE
    api.__window.USL.scheduler.openAllocationScheduleDialog = async () => { setupCalls++; }; // CHANGE
    state.defaultsLookup = null; api.__window.dispatchEvent({ type: 'resize' }); await waitUntil(() => !state.defaultsLookup.pending); assert.equal(state.hudRefs.create.disabled, false); // CHANGE
    complete = false; state.hudRefs.create.click(); await waitUntil(() => !state.reviewing); // CHANGE
    assert.equal(h.getCreates(), 0); assert.equal(setupCalls, 0); assert.equal(state.hudRefs.create.disabled, true); // CHANGE
    assert.ok(state.hudRefs.defaultsBox.querySelector('[data-allocation-missing-default="method"]')); api.__window.USL.allocate.close(); // CHANGE
}); // CHANGE

test('compatibility warnings always require confirmation even when a stored suppression preference exists', async () => { // CHANGE
    const h = await previewSession(), { api, state } = h; // CHANGE
    api.__window.localStorage.getItem = () => '1'; api.__window.USL.scheduler.resolveAllocationDefaultStatus = async () => ({ complete: true, missing: [] }); // CHANGE
    state.draft.taskPreview = [{ title: 'Sow' }]; state.draft.warnings = ['Unknown crop relationship']; // CHANGE
    state.hudRefs.create.click(); await waitUntil(() => !!api.__document.lastDialog); // CHANGE
    assert.match(collectText(api.__document.lastDialog).join(' '), /Unknown crop relationship/); assert.equal(h.getCreates(), 0); // CHANGE
    const cancel = api.__document.lastDialog.children.at(-1).children.find(node => node.textContent === 'Cancel'); // CHANGE
    assert.equal(cancel.getAttribute('data-trellis-button-variant'), 'close'); assert.match(cancel.style.cssText, /border:1px solid #b91c1c;.*background:#fff/); // CHANGE: standalone review retains outlined dismissal.
    assert.match(cancel.style.cssText, /border-radius:6px;padding:6px 10px/); // CHANGE
    assert.equal(collectText(api.__document.lastDialog).some(text => text.includes("Don't show again")), false); // CHANGE
    api.__document.lastDialog.children.at(-1).children.find(node => node.textContent === 'Cancel').click(); await waitUntil(() => !state.reviewing); api.__window.USL.allocate.close(); // CHANGE
}); // CHANGE

test('crop selection requires a canvas bed or the explicit Find best bed action', async () => { // CHANGE
    const { api, state, bed } = await previewSession({ selectBed: false });
    assert.equal(state.draft, null);
    assert.match(collectText(state.hudRefs.draftBox).join(' '), /Select a bed/);
    state.hudRefs.findBest.click();
    await waitUntil(() => !!state.draft);
    assert.equal(state.draft.bed, bed);
    assert.equal(api.__graph.getSelectionCell(), bed);
    api.__graph.setSelectionCell(state.moduleCell);
    assert.equal(state.draft, null);
    assert.equal(state.ghost, null);
    assert.equal(state.selectedCropId, 'crop');
    await waitUntil(() => !!api.__graphContainer.querySelector('[data-bed-id="bed-preview"]'));
    assert.equal(state.draft, null);
    api.__window.USL.allocate.close();
});

test('canvas groups resolve their bed, same-bed selections preserve edits, and bed switches reset schedules', async () => { // CHANGE
    const { api, state, bed, lifecycle } = await previewSession();
    const second = { id: 'second', getAttribute: key => key === 'label' ? 'Second' : null, getGeometry: () => ({ x: 200, y: 0, width: 100, height: 40 }) };
    state.beds.push(second);
    const reviewed = { ...state.draft, actionStartISO: '2027-01-05' };
    state.draft = reviewed;
    const group = { id: 'group', parent: state.moduleCell, getAttribute: key => key === 'tiler_group' ? '1' : null, getGeometry: () => ({ x: 5, y: 5, width: 10, height: 10 }) };
    const child = { id: 'child', parent: group, getAttribute: () => null };
    api.__graph.setSelectionCell(child);
    assert.equal(state.draft, reviewed);
    assert.equal(state.targetBedId, bed.id);
    api.__graph.setSelectionCell(second);
    assert.equal(state.draft, null);
    await waitUntil(() => !!state.draft);
    assert.equal(state.draft.bed, second);
    assert.equal(state.draft.actionStartISO, lifecycle.startISO);
    assert.equal(state.selectedCropId, 'crop');
    api.__window.USL.allocate.close();
});

test('unrelated, multi-selected, and foreign-module cells clear allocation targets', async () => { // CHANGE
    const { api, state, bed } = await previewSession();
    const foreign = { id: 'foreign', parent: { id: 'other-module' }, getAttribute: key => key === 'tiler_group' ? '1' : null, getGeometry: () => ({ x: 0, y: 0, width: 10, height: 10 }) };
    for (const cells of [[foreign], [bed, state.moduleCell], [], [{ id: 'other', getAttribute: () => null }]]) {
        api.__graph.setSelectionCells(cells);
        assert.equal(state.draft, null);
        assert.equal(state.targetBedId, '');
        assert.equal(state.ghost, null);
        assert.equal(state.hudRefs.create.disabled, true);
        api.__graph.setSelectionCell(bed);
        await waitUntil(() => !!state.draft);
    }
    api.__window.USL.allocate.close();
});

test('an unavailable selected bed explains its failure without substituting a suitable bed', async () => { // CHANGE
    const { api, state, bed } = await previewSession();
    const blocked = { id: 'blocked', getAttribute: () => null, getGeometry: () => ({ x: 200, y: 0, width: 100, height: 40 }) };
    state.beds.push(blocked);
    api.__window.USL.tiler.proposePlantingGeometry = input => input.bedCell === blocked ? { ok: false, capacity: 0 } : { ok: true, geometry: bed.getGeometry(), slots: [] };
    api.__graph.setSelectionCell(blocked);
    await waitUntil(() => !!state.targetFailure);
    assert.equal(state.draft, null);
    assert.match(state.targetFailure, /capacity/);
    assert.equal(api.__graph.getSelectionCell(), blocked);
    assert.equal(state.hudRefs.create.disabled, true);
    api.__window.USL.allocate.close();
});

test('Find best bed reports no fit and a crop or week change reevaluates the selected bed', async () => { // CHANGE
    const { api, state, bed } = await previewSession();
    const original = state.draft;
    state.hudRefs.cropSelect.dispatchEvent({ type: 'change' });
    await waitUntil(() => !!state.draft);
    assert.notEqual(state.draft, original);
    assert.equal(state.draft.bed, bed);
    const prior = state.draft;
    state.hudRefs.weekSelect.value = '0';
    state.hudRefs.weekSelect.dispatchEvent({ type: 'change' });
    await waitUntil(() => !!state.draft);
    assert.notEqual(state.draft, prior);
    assert.equal(state.draft.bed, bed);
    api.__graph.setSelectionCell(state.moduleCell);
    state.bedResultCache.clear();
    api.__window.USL.tiler.proposePlantingGeometry = () => ({ ok: false, capacity: 0 });
    state.hudRefs.findBest.click();
    await waitUntil(() => !state.findingBed);
    assert.match(state.noticeMessage, /No suitable bed/);
    assert.equal(state.draft, null);
    assert.equal(api.__graph.getSelectionCell(), state.moduleCell);
    api.__window.USL.allocate.close();
});

test('pending bed evaluations and editor results cannot restore a cleared module selection', async () => { // CHANGE
    const { api, state, bed, lifecycle } = await previewSession();
    let resolveEdit;
    api.__window.USL.scheduler.openAllocationScheduleDialog = () => new Promise(resolve => { resolveEdit = resolve; });
    state.hudRefs.defaultsBox.querySelector('[data-allocation-missing-default="tasks"]').click(); // CHANGE
    await waitUntil(() => !!resolveEdit);
    const draft = state.draft;
    api.__graph.setSelectionCell(state.moduleCell);
    resolveEdit({ action: 'preview', draft });
    await waitUntil(() => !state.reviewing);
    assert.equal(state.draft, null);
    state.lifecycleCache.clear(); state.bedResultCache.clear();
    let release;
    api.__window.USL.scheduler.proposeLifecycleForDemandWindow = () => new Promise(resolve => { release = resolve; });
    api.__graph.setSelectionCell(bed);
    await waitUntil(() => !!release);
    api.__graph.setSelectionCell(state.moduleCell);
    release(lifecycle);
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(state.draft, null);
    assert.equal(state.ghost, null);
    api.__window.USL.allocate.close();
});

test('Edit delegates to the scheduler and creation commits the exact reviewed tasks before deferred defaults', async () => { // CHANGE
    const harness = await previewSession();
    const { api, state } = harness;
    const tasks = [{ title: 'Reviewed sow task', startISO: '2027-01-04', endISO: '2027-01-04' }];
    let persisted = 0;
    let committedTasks;
    api.__window.USL.scheduler.resolveAllocationDefaultStatus = async () => ({ complete: true, missing: [] });
    api.__window.USL.scheduler.openAllocationScheduleDialog = async (ui, draft) => ({ action: 'preview', draft: { ...draft, taskPreview: tasks,
        lifecycle: { ...draft.lifecycle, taskPreview: tasks }, commitAllocationDefaults: async () => { assert.equal(harness.getCreates(), 1); assert.equal(committedTasks, tasks); persisted++; } } });
    api.__window.USL.tasks.applySchedulerTaskReplacement = input => { committedTasks = input.tasks; };
    state.hudRefs.create.click();
    await waitUntil(() => !!api.__document.lastDialog);
    assert.match(collectText(api.__document.lastDialog).join(' '), /without tasks/);
    api.__document.lastDialog.children.at(-1).children.find(node => node.textContent === 'Edit').click();
    await waitUntil(() => !state.reviewing);
    assert.equal(persisted, 0);
    assert.equal(state.draft.taskPreview, tasks);
    assert.match(state.noticeMessage, /Schedule updated/); // CHANGE
    state.hudRefs.create.click();
    await waitUntil(() => !state.reviewing);
    assert.equal(api.__document.lastDialog, null); // CHANGE: the accepted task-bearing clean preview creates directly.
    assert.equal(persisted, 1, state.noticeMessage); // CHANGE: include deferred-default failure details in commit assertions.
    assert.equal(state.noticeMessage, ''); // CHANGE: creation clears the prior editor notice.
    api.__window.USL.allocate.close();
});

test('scheduler cancellation and invalid edits retain the accepted proposal', async () => { // CHANGE
    const harness = await previewSession();
    const { api, state } = harness;
    const original = state.draft;
    api.__window.USL.scheduler.openAllocationScheduleDialog = async () => ({ action: 'cancel' });
    state.hudRefs.defaultsBox.querySelector('[data-allocation-missing-default="tasks"]').click(); // CHANGE
    await waitUntil(() => !state.reviewing);
    assert.equal(state.draft, original);
    api.__window.USL.scheduler.openAllocationScheduleDialog = async () => ({ action: 'preview', draft: { lifecycle: { ok: false, reason: 'Invalid edited timing' } } });
    state.hudRefs.defaultsBox.querySelector('[data-allocation-missing-default="tasks"]').click(); // CHANGE
    await waitUntil(() => !state.reviewing);
    assert.equal(state.draft, original);
    assert.match(state.noticeMessage, /Invalid edited timing/);
    assert.equal(harness.getCreates(), 0);
    api.__window.USL.allocate.close();
});

test('allocation revalidation preserves lifecycle preferences and supplies the created cell to deferred defaults', async () => { // CHANGE
    const { api, state } = await previewSession(); // CHANGE
    let savedCell, revalidated; // CHANGE
    api.__window.USL.scheduler.openAllocationScheduleDialog = async (ui, draft, options) => { // CHANGE
        assert.equal(draft.bedOccupancy, state.occupancy); // CHANGE
        const candidate = { ...draft, saveLifecycleDefaults: true, saveSpacingDefaults: true, lifecycleOverrides: { harvestWindowDays: 14 }, bedTimingComparisons: [{ cellId: 'other' }], commitAllocationDefaults: async cell => { savedCell = cell; } }; // CHANGE
        revalidated = await options.revalidateDraft(candidate); // CHANGE
        return { action: 'preview', draft: revalidated }; // CHANGE
    }; // CHANGE
    state.hudRefs.defaultsBox.querySelector('[data-allocation-missing-default="tasks"]').click(); await waitUntil(() => !state.reviewing); // CHANGE
    assert.ok(revalidated.ok); assert.equal(savedCell, undefined); // CHANGE
    assert.equal(state.draft.saveLifecycleDefaults, true); assert.equal(state.draft.saveSpacingDefaults, true); // CHANGE
    assert.equal(state.draft.lifecycleOverrides.harvestWindowDays, 14); assert.equal(state.draft.bedTimingComparisons[0].cellId, 'other'); // CHANGE
    api.__window.USL.scheduler.resolveAllocationDefaultStatus = async () => ({ complete: true, missing: [] }); // CHANGE
    state.hudRefs.create.click(); await waitUntil(() => !!api.__document.lastDialog); // CHANGE
    api.__document.lastDialog.children.at(-1).children.find(node => node.textContent === 'Create').click(); // CHANGE
    await waitUntil(() => !state.reviewing); // CHANGE
    assert.equal(savedCell.id, 'new'); // CHANGE
    api.__window.USL.allocate.close(); // CHANGE
}); // CHANGE

test('allocation failed creation skips defaults and a post-creation default failure uses the existing notice', async () => { // CHANGE
    const { api, state } = await previewSession(); // CHANGE
    let writes = 0; // CHANGE
    state.draft.commitAllocationDefaults = async () => { writes++; throw new Error('Default storage unavailable'); }; // CHANGE
    api.__window.USL.scheduler.resolveAllocationDefaultStatus = async () => ({ complete: true, missing: [] }); // CHANGE
    const create = api.__window.USL.tiler.createPlantingFromProposal; // CHANGE
    api.__window.USL.tiler.createPlantingFromProposal = () => { throw new Error('Planting creation unavailable'); }; // CHANGE
    state.hudRefs.create.click(); await waitUntil(() => !!api.__document.lastDialog); // CHANGE
    api.__document.lastDialog.children.at(-1).children.find(node => node.textContent === 'Create').click(); // CHANGE
    await waitUntil(() => !state.reviewing); // CHANGE
    assert.equal(writes, 0); assert.match(state.noticeMessage, /Planting creation unavailable/); // CHANGE
    api.__window.USL.tiler.createPlantingFromProposal = create; // CHANGE
    state.hudRefs.create.click(); await waitUntil(() => !!api.__document.lastDialog); // CHANGE
    api.__document.lastDialog.children.at(-1).children.find(node => node.textContent === 'Create').click(); // CHANGE
    await waitUntil(() => !state.reviewing); // CHANGE
    assert.equal(writes, 1); assert.match(state.noticeMessage, /Planting created, but reusable defaults could not be saved: Default storage unavailable/); // CHANGE
    api.__window.USL.allocate.close(); // CHANGE
}); // CHANGE

test('an accepted preview creates a planting and its tasks only after explicit review confirmation', async () => { // CHANGE
    const harness = await previewSession();
    const { api, state } = harness;
    let taskCreations = 0;
    let historyRuns = 0;
    const createPlanting = api.__window.USL.tiler.createPlantingFromProposal; // CHANGE
    state.draft.kgPerPlant = 0.7; state.draft.crop.kgPerPlantMode = 'manual'; // CHANGE
    state.draft.lifecycle.attributePatch.plant_yield = '1'; // CHANGE: the scheduler default must not override the reviewed Year Plan yield.
    api.__window.USL.tiler.createPlantingFromProposal = input => { assert.equal(input.attributes.plant_yield, '0.7'); return createPlanting(input); }; // CHANGE
    api.__window.USL.tasks.applySchedulerTaskReplacement = () => { taskCreations++; };
    api.__window.Trellis.history = { run(metadata, operation) { assert.equal(metadata.action, 'allocateCreate'); historyRuns++; return operation(); } };
    api.__window.USL.scheduler.resolveAllocationDefaultStatus = async () => ({ complete: true, missing: [] });
    state.hudRefs.create.click();
    await waitUntil(() => !!api.__document.lastDialog);
    assert.equal(harness.getCreates(), 0);
    const create = api.__document.lastDialog.children.at(-1).children.find(node => node.textContent === 'Create');
    assert.ok(create);
    create.click();
    await waitUntil(() => !state.reviewing);
    assert.equal(harness.getCreates(), 1);
    assert.equal(taskCreations, 1);
    assert.equal(historyRuns, 1);
    assert.equal(state.draft, null);
    api.__window.USL.allocate.close();
});

test('pending scheduler results cannot restore a closed or changed allocation proposal', async () => { // CHANGE
    const harness = await previewSession();
    const { api, state } = harness;
    let resolveEdit;
    api.__window.USL.scheduler.openAllocationScheduleDialog = () => new Promise(resolve => { resolveEdit = resolve; });
    state.hudRefs.defaultsBox.querySelector('[data-allocation-missing-default="tasks"]').click(); // CHANGE
    await waitUntil(() => !!resolveEdit);
    const previewCount = harness.previews.length;
    api.__window.USL.allocate.close();
    resolveEdit({ action: 'preview', draft: state.draft });
    await waitUntil(() => !state.reviewing);
    assert.equal(harness.previews.length, previewCount);
    assert.equal(harness.getCreates(), 0);
});

test('view changes preserve previews while meaningful model edits clear them immediately', async () => { // CHANGE
    const harness = await previewSession();
    const { api, state } = harness;
    const draft = state.draft;
    api.__fireViewEvent('scaleAndTranslate');
    assert.equal(state.draft, draft);
    const model = api.__graph.getModel();
    model.fireEvent('change', { getProperty: () => ({ changes: [{ style: 'opacity=50', previous: 'opacity=100' }] }) });
    assert.equal(state.draft, draft);
    model.fireEvent('change', { getProperty: () => ({ changes: [{ attribute: 'harvest_end' }] }) });
    assert.equal(state.draft, null);
    assert.equal(harness.cleared.at(-1), state.ownerId);
    api.__window.USL.allocate.close();
});

test('partial allocation chart and demand-served summary use one simulation of the fitting plant count', async () => { // CHANGE
    const harness = await previewSession();
    const { api, state } = harness;
    let simulationCalls = 0;
    api.__window.USL.tiler.proposePlantingGeometry = input => input.plantCount > 2 ? { ok: false, capacity: 2 } : { ok: true, capacity: 2, geometry: { x: 0, y: 0, width: 20, height: 20 }, slots: [] };
    api.__window.USL.planningCore.simulateCandidatePlanting = input => {
        simulationCalls++;
        assert.equal(input.candidate.plantCount, 2);
        const weekly = usable => ({ perCrop: new Map([['crop', { target: [0, 4], usableSupply: [0, usable], short: [0, 4 - usable] }]]) });
        return { demandServedKg: 2, base: { weekStarts: state.coverage.weekStarts, weekly: weekly(0) }, coverage: { weekly: weekly(2) } };
    };
    const result = await api.computeBedResult(state, { ...state.draft.crop, allocationLifecycle: harness.lifecycle }, state.draft.bed);
    assert.equal(result.plantCount, 2);
    assert.equal(result.partialPlanting, true);
    assert.equal(result.demandServedKg, 2);
    assert.equal(result.coveragePreview.rows[1].afterKg, 2);
    assert.equal(simulationCalls, 1);
    api.__window.USL.allocate.close();
});

test("Year Planner no longer owns the Allocate launcher", () => {
    const yearPlanner = fs.readFileSync(YEAR_PLANNER_PATH, "utf8");
    assert.doesNotMatch(yearPlanner, /const AllocateModeController/);
    assert.doesNotMatch(yearPlanner, /window\.addEventListener\("usl:allocatePlanRequested"/);
    assert.match(yearPlanner, /loadPlanForYear/);
});

// CHANGE: same-bed selection and view refresh must not replace an accepted ghost or reopen occupancy.
test('Allocate keeps accepted badge, ghost and preview while unrelated loading progress updates', async () => {
    const { api, state, bed, previews, cleared } = await previewSession();
    const badge = api.__graphContainer.querySelector('[data-bed-id="bed-preview"]');
    const ghost = api.__graphContainer.querySelector('.trellis-allocate-ghost');
    const draft = state.draft;
    const previewCount = previews.length; const clearCount = cleared.length;
    state.scheduleProgress.phase = 'checking beds'; state.scheduleProgress.processedRows += 1;
    api.__graph.setSelectionCell(bed);
    api.renderScheduleProgress(state); // CHANGE: run the real progress path, including overlay evaluation.

    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(state.draft, draft);
    assert.equal(api.__graphContainer.querySelector('[data-bed-id="bed-preview"]'), badge);
    assert.equal(api.__graphContainer.querySelector('.trellis-allocate-ghost'), ghost);
    assert.equal(previews.length, previewCount);
    assert.equal(cleared.length, clearCount);
    assert.equal(badge.textContent, 'Good fit');
    assert.match(badge.getAttribute('aria-label'), /Lettuce.*plants fit/s);
    api.__window.USL.allocate.close();
}); // CHANGE

/** Uses real tiler proposals with a deterministic supply simulation. */ // CHANGE
function fittedAllocationFixture(requested = 7) { // CHANGE
    const api = loadAllocatePlugin(); // CHANGE
    const geometry = require('./helpers/fitted-planting-harness.cjs').loadFittedPlantingGeometry(); // CHANGE
    const crop = { id: 'crop', cropId: 'crop', plantId: '1', label: 'Carrot', method: 'direct_sow.field', kgPerPlant: 0.1 }; // CHANGE
    const bed = { id: 'bed', getAttribute: () => '', getGeometry: () => ({ x: 40, y: 60, width: 100, height: 500 }) }; // CHANGE
    const counts = []; // CHANGE
    api.__window.USL.scheduler = { // CHANGE
        resolvePlantForPlanCrop: async () => ({ ok: true, plant: { plant_id: 1, plant_name: 'Carrot', spacing_x_cm: 20, spacing_y_cm: 30, veg_diameter_cm: 10 } }), // CHANGE
        proposeLifecycle: async () => ({ ok: true, status: 'compatible', primaryDateISO: '2027-04-01', attributePatch: { harvest_start: '2027-06-01', harvest_end: '2027-07-01' }, warnings: [], taskPreview: [] }), // CHANGE
        listAllocationOverlapRelationships: async () => [{ companionPlantId: '2', conflictKind: 'companion' }, { companionPlantId: '3', conflictKind: 'incompatible' }] // CHANGE
    }; // CHANGE
    api.__window.USL.tiler = { ...geometry, readBedProfile: () => ({}) }; // CHANGE
    api.__window.USL.planningCore = { // CHANGE
        recommendPlantCount: () => ({ plantCount: requested, reachableShortKg: requested * 0.1 }), // CHANGE
        simulateCandidatePlanting: input => { counts.push(input.candidate.plantCount); return { demandServedKg: Math.min(requested, input.candidate.plantCount) * 0.1 }; } // CHANGE
    }; // CHANGE
    const state = { moduleCell: {}, year: 2027, plan: {}, city: {}, weekIndex: 0, occupancy: [], coverage: { weekSummaries: [{ weekIndex: 0, start: '2027-06-01' }] } }; // CHANGE
    return { api, state, crop, bed, counts }; // CHANGE
} // CHANGE

test('fitted allocation updates count and supply without cumulative rounding during rotation', async () => { // CHANGE
    const { api, state, crop, bed, counts } = fittedAllocationFixture(); // CHANGE
    const initial = await api.computeBedResult(state, crop, bed); // CHANGE
    assert.equal(initial.plantCount, 10); assert.equal(initial.requestedPlantCount, 7); // CHANGE
    assert.equal(initial.projectedKg, 1); assert.ok(Math.abs(initial.demandServedKg - 0.7) < 1e-9); // CHANGE
    const rotated = api.rotateAllocationResult(state, initial); // CHANGE
    assert.equal(rotated.geometry.fitAxis, 'height'); assert.equal(rotated.plantCount, 18); // CHANGE
    assert.equal(rotated.geometry.spacingXCm, 20); assert.equal(rotated.geometry.spacingYCm, 30); // CHANGE
    const returned = api.rotateAllocationResult(state, rotated); // CHANGE
    assert.equal(returned.plantCount, 10); assert.equal(returned.requestedPlantCount, 7); // CHANGE
    assert.equal(returned.projectedKg, 1); assert.deepEqual(counts, [10, 18, 10]); // CHANGE
}); // CHANGE

test('partial fitted allocation uses complete-row capacity and recomputes it on the other axis', async () => { // CHANGE
    const { api, state, crop, bed, counts } = fittedAllocationFixture(800); // CHANGE
    const initial = await api.computeBedResult(state, crop, bed); // CHANGE
    assert.equal(initial.partialPlanting, true); assert.equal(initial.plantCount, 90); // CHANGE
    assert.equal(initial.fullPlantCount, 800); assert.equal(initial.requestedPlantCount, 800); // CHANGE
    const rotated = api.rotateAllocationResult(state, initial); // CHANGE
    assert.equal(rotated.plantCount, 90); assert.equal(rotated.fullPlantCount, 810); // CHANGE
    assert.equal(rotated.projectedKg, 9); assert.deepEqual(counts, [90, 90]); // CHANGE
}); // CHANGE

test('Allocate classifies every overlapping crop and lookup failures remain unknown', async () => { // CHANGE
    const { api, state, crop, bed } = fittedAllocationFixture(); // CHANGE
    state.occupancy = ['2', '3', '4'].map(plantId => ({ groupId: 'group-' + plantId, plantId, plantName: 'Crop ' + plantId, bedId: bed.id, plantingRect: { x: 0, y: 0, width: 1000, height: 1000 }, bedEntryISO: '2027-04-01', harvestEndISO: '2027-07-01' })); // CHANGE
    const result = await api.computeBedResult(state, crop, bed); // CHANGE
    assert.equal(result.ok, true); assert.equal(result.status, 'warning'); // CHANGE
    assert.match(result.warnings.join(' '), /Companion overlap with Crop 2/); // CHANGE
    assert.match(result.warnings.join(' '), /Incompatible overlap with Crop 3/); // CHANGE
    assert.match(result.warnings.join(' '), /Unknown relationship: overlap with Crop 4/); // CHANGE
    state.relationshipCache.clear(); // CHANGE
    api.__window.USL.scheduler.listAllocationOverlapRelationships = async () => { throw new Error('Database unavailable'); }; // CHANGE
    const unknown = await api.computeBedResult(state, crop, bed); // CHANGE
    assert.equal(unknown.ok, true); assert.equal(unknown.warnings.filter(item => /Unknown relationship/.test(item)).length, 3); // CHANGE
}); // CHANGE

test('rotated warned drafts update the HUD, ghost, timeline and reviewed creation metadata', async () => { // CHANGE
    const { api, state, bed, crop, previews } = await previewSession(); // CHANGE
    const geometry = require('./helpers/fitted-planting-harness.cjs').loadFittedPlantingGeometry(); // CHANGE
    api.__window.USL.tiler.proposePlantingGeometry = geometry.proposePlantingGeometry; // CHANGE
    api.__window.USL.scheduler.listAllocationOverlapRelationships = async () => [{ companionPlantId: '2', conflictKind: 'companion' }]; // CHANGE
    api.__window.USL.scheduler.resolveAllocationDefaultStatus = async () => ({ complete: true, missing: [] }); // CHANGE
    state.relationshipCache.clear(); state.bedResultCache.clear(); // CHANGE
    state.occupancy = [{ groupId: 'existing', bedId: bed.id, plantId: '2', plantName: 'Carrot', plantingRect: { x: -1000, y: -1000, width: 3000, height: 3000 }, bedEntryISO: '2027-01-01', harvestEndISO: '2027-12-31' }]; // CHANGE
    state.draft = await api.computeBedResult(state, crop, bed); // CHANGE
    const originalCount = state.draft.plantCount; // CHANGE
    state.moduleCell.getGeometry = () => ({ x: 300, y: 150, width: 1000, height: 1000 }); // CHANGE: moved gardens must not leave their preview at the origin.
    api.__graph.view.scale = 1.75; api.__graph.view.translate = { x: 5, y: 10 }; // CHANGE
    state.hudRefs.rotate.click(); // CHANGE
    assert.notEqual(state.draft.plantCount, originalCount); // CHANGE
    assert.match(collectText(state.hudRefs.draftBox).join(' '), /Companion overlap with Carrot/); // CHANGE
    assert.equal(state.ghost.querySelectorAll('.manual-link-spacing-preview-plant').length, state.draft.plantCount); // CHANGE
    assert.equal(parseFloat(state.ghost.querySelector('.manual-link-spacing-preview-group-frame').style.left), Math.round((state.draft.geometry.geometry.x + 300 + 5) * 1.75)); // CHANGE
    assert.equal(parseFloat(state.ghost.querySelector('.manual-link-spacing-preview-group-frame').style.top), Math.round((state.draft.geometry.geometry.y + 150 + 10) * 1.75)); // CHANGE
    assert.equal(previews.at(-1).plantingRect, state.draft.geometry.plantingRect); // CHANGE
    state.hudRefs.rotate.click(); assert.equal(state.draft.plantCount, originalCount); // CHANGE
    let created = null, transactions = 0; // CHANGE
    api.__window.USL.tiler.createPlantingFromProposal = input => { created = input; return { id: 'created' }; }; // CHANGE
    api.__window.Trellis.history = { run(metadata, operation) { transactions++; return operation(); } }; // CHANGE
    state.hudRefs.create.click(); await waitUntil(() => !!api.__document.lastDialog); // CHANGE
    const reviewed = state.draft; // CHANGE
    const create = api.__document.lastDialog.children.at(-1).children.find(node => node.textContent === 'Create anyway'); // CHANGE
    assert.ok(create); assert.equal(created, null); create.click(); await waitUntil(() => !state.reviewing); // CHANGE
    assert.equal(created.proposal.plantCount, reviewed.plantCount); assert.equal(created.insideUpdate, true); // CHANGE
    assert.match(created.attributes.allocation_override_json, /Companion overlap with Carrot/); assert.equal(transactions, 1); // CHANGE
    api.__window.USL.allocate.close(); // CHANGE
}); // CHANGE

test('Allocate recovers its preview notice when Planting Group becomes available', async () => { // CHANGE
    const { api, state } = await previewSession(); // CHANGE
    const owner = api.__graph.__trellisPlantingGroup; // CHANGE
    try { // CHANGE
        delete api.__graph.__trellisPlantingGroup; // CHANGE
        state.hudRefs.rotate.click(); // CHANGE
        assert.match(state.noticeMessage, /Planting preview unavailable/); // CHANGE
        api.__graph.__trellisPlantingGroup = owner; // CHANGE
        state.hudRefs.rotate.click(); // CHANGE
        assert.doesNotMatch(state.noticeMessage || '', /Planting preview unavailable/); // CHANGE
        assert.ok(api.__graphContainer.querySelector('.trellis-allocate-ghost')); // CHANGE
    } finally { api.__graph.__trellisPlantingGroup = owner; api.__window.USL.allocate.close(); } // CHANGE
}); // CHANGE
