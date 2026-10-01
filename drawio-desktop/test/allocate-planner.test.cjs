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
        style: {},
        children: [],
        attributes: new Map(),
        listeners: new Map(),
        className: "",
        ownerDocument,
        parentNode: null,
        appendChild(child) { this.children.push(child); child.parentNode = this; if (!child.ownerDocument) child.ownerDocument = this.ownerDocument; return child; },
        removeChild(child) { this.children = this.children.filter(item => item !== child); child.parentNode = null; if (this.ownerDocument && this.ownerDocument.activeElement === child) this.ownerDocument.activeElement = null; },
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
    target.fireEvent = function (eventName) {
        (listeners.get(String(eventName || "")) || []).slice().forEach(fn => fn(target, { getProperty: () => null }));
    };
    return target;
}

function loadAllocatePlugin() {
    const document = {
        activeElement: null,
        body: null,
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
    const graph = {
        container: graphContainer,
        view,
        getView: () => view,
        getModel: () => ({
            getCell: () => null,
            getParent: () => null,
            beginUpdate() {},
            endUpdate() {}
        }),
        addListener: graphEvents.addListener,
        removeListener: graphEvents.removeListener
    };
    const window = {
        USL: {},
        Trellis: {},
        getComputedStyle(node) { return { position: node && node.style && node.style.position || "static" }; },
        addEventListener() {},
        removeEventListener() {},
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
        Draw: { loadPlugin(callback) { callback({ editor: { graph }, showDialog() {}, hideDialog() {} }); } }
    });
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
    assert.ok(collectText(api.__root).includes("Review Schedule"));

    cropSelect.value = "cilantro";
    cropSelect.dispatchEvent({ type: "change", target: cropSelect });
    await waitUntil(() => !!state.draft);

    const controlLayer = api.__graphContainer.querySelector(".trellis-graph-control-layer");
    const allocateLayer = api.__graphContainer.querySelector(".trellis-allocate-overlay-layer");
    const badge = api.__graphContainer.querySelector('[data-bed-id="bed-1"]');
    const annotationLayer = api.__graphContainer.querySelector(".trellis-graph-annotation-layer");
    const ghost = api.__graphContainer.querySelector(".trellis-allocate-ghost");
    assert.ok(controlLayer, "expected Allocate to create the shared graph control layer"); // CHANGE
    assert.equal(allocateLayer.parentNode, controlLayer); // CHANGE: Allocate badges should be graph-local controls, not body-fixed nodes.
    assert.equal(badge.parentNode, allocateLayer); // CHANGE
    assert.match(badge.textContent, /Cilantro/); // CHANGE
    assert.match(badge.style.cssText, /position:absolute/); // CHANGE
    assert.equal(badge.style.left, "6px"); // CHANGE: bed badge position follows the rendered bed state, not scroll math.
    assert.equal(badge.style.top, "6px"); // CHANGE
    assert.equal(ghost.parentNode, annotationLayer); // CHANGE: draft ghost sits below controls on the graph annotation layer.
    assert.match(ghost.style.cssText, /position:absolute/); // CHANGE
    assert.match(ghost.style.cssText, /left:7px/); // CHANGE
    assert.match(ghost.style.cssText, /top:11px/); // CHANGE

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

    assert.equal(point.left, 57); // CHANGE: graph-local overlays include container scroll, not viewport origin.
    assert.equal(point.top, 91); // CHANGE
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
    assert.match(SOURCE, /Review Schedule/);
    assert.match(SOURCE, /graphPointToContainer\(geo\.x, geo\.y\)/); // CHANGE: draft ghosts render in graph-local overlay coordinates.
    assert.match(SOURCE, /vegHeightCm: context\.plantResolution\.plant\.veg_height_cm \|\| null/);
    assert.match(SOURCE, /vegHeightCm: d\.geometry\.vegHeightCm \|\| null/);
});

test("Year Planner no longer owns the Allocate launcher", () => {
    const yearPlanner = fs.readFileSync(YEAR_PLANNER_PATH, "utf8");
    assert.doesNotMatch(yearPlanner, /const AllocateModeController/);
    assert.doesNotMatch(yearPlanner, /window\.addEventListener\("usl:allocatePlanRequested"/);
    assert.match(yearPlanner, /loadPlanForYear/);
});
