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
    return window.USL.allocate.__test;
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

test("Allocate plugin owns launch, draft review, and one-transaction create contracts", () => {
    assert.match(SOURCE, /const ALLOCATE_EVENT = "usl:allocatePlanRequested"/);
    assert.match(SOURCE, /window\.USL\.scheduler\.openDraftScheduleDialog/);
    assert.match(SOURCE, /window\.USL\.tasks/);
    assert.match(SOURCE, /applySchedulerTaskReplacement/);
    assert.match(SOURCE, /action: "allocateCreate"/);
    assert.match(SOURCE, /category: "Garden scheduling"/);
    assert.match(SOURCE, /allocation_source: "year_plan"/);
    assert.match(SOURCE, /buildWeekOpportunityModel/);
    assert.match(SOURCE, /listPlantingFootprints/);
    assert.match(SOURCE, /currentBedContext/);
});

test("Year Planner no longer owns the Allocate launcher", () => {
    const yearPlanner = fs.readFileSync(YEAR_PLANNER_PATH, "utf8");
    assert.doesNotMatch(yearPlanner, /const AllocateModeController/);
    assert.doesNotMatch(yearPlanner, /window\.addEventListener\("usl:allocatePlanRequested"/);
    assert.match(yearPlanner, /loadPlanForYear/);
});
