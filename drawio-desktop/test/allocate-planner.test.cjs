const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const PLUGIN_PATH = path.join(__dirname, "..", "drawio", "src", "main", "webapp", "plugins", "garden_planner_plugins", "Allocate_Planner.js");
const YEAR_PLANNER_PATH = path.join(__dirname, "..", "drawio", "src", "main", "webapp", "plugins", "garden_planner_plugins", "Year_Planner.js");
const SOURCE = fs.readFileSync(PLUGIN_PATH, "utf8");

function makeNode() {
    return {
        style: {},
        children: [],
        attributes: new Map(),
        appendChild(child) { this.children.push(child); child.parentNode = this; return child; },
        removeChild(child) { this.children = this.children.filter(item => item !== child); child.parentNode = null; },
        setAttribute(key, value) { this.attributes.set(String(key), String(value)); },
        getAttribute(key) { return this.attributes.get(String(key)) || null; },
        addEventListener() {},
        removeEventListener() {},
        querySelector() { return null; },
        set innerHTML(_) { this.children = []; },
        get innerHTML() { return ""; }
    };
}

function loadAllocatePlugin() {
    const root = makeNode();
    const document = {
        body: root,
        createElement: () => makeNode(),
        createElementNS: () => makeNode()
    };
    const graph = {
        container: { getBoundingClientRect: () => ({ left: 0, top: 0 }) },
        view: { scale: 1, translate: { x: 0, y: 0 } },
        getModel: () => ({
            getCell: () => null,
            getParent: () => null,
            beginUpdate() {},
            endUpdate() {}
        }),
        addListener() {},
        removeListener() {}
    };
    const window = {
        USL: {},
        Trellis: {},
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
        String,
        document,
        window,
        Draw: { loadPlugin(callback) { callback({ editor: { graph }, showDialog() {}, hideDialog() {} }); } }
    });
    vm.runInContext(SOURCE, context, { filename: PLUGIN_PATH });
    const api = window.USL.allocate.__test;
    api.__window = window;
    return api;
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

    const categoryOnly = api.resolveCropMethodContext({ method: "direct_sow" });
    assert.equal(categoryOnly.ok, false);
    assert.equal(categoryOnly.methodId, "direct_sow");
    assert.equal(categoryOnly.methodCategoryId, "");
    assert.equal(categoryOnly.reason, "Year Plan method must be a concrete method like direct_sow.field.");
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

test("Allocate plugin owns launch, draft review, and one-transaction create contracts", () => {
    assert.match(SOURCE, /const ALLOCATE_EVENT = "usl:allocatePlanRequested"/);
    assert.match(SOURCE, /window\.USL\.scheduler\.openDraftScheduleDialog/);
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
    assert.match(SOURCE, /vegHeightCm: context\.plantResolution\.plant\.veg_height_cm \|\| null/);
    assert.match(SOURCE, /vegHeightCm: d\.geometry\.vegHeightCm \|\| null/);
});

test("Year Planner no longer owns the Allocate launcher", () => {
    const yearPlanner = fs.readFileSync(YEAR_PLANNER_PATH, "utf8");
    assert.doesNotMatch(yearPlanner, /const AllocateModeController/);
    assert.doesNotMatch(yearPlanner, /window\.addEventListener\("usl:allocatePlanRequested"/);
    assert.match(yearPlanner, /loadPlanForYear/);
});
