const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const PLUGIN_PATH = path.join(
    __dirname,
    "..",
    "drawio",
    "src",
    "main",
    "webapp",
    "plugins",
    "garden_planner_plugins",
    "Year_planner.js"
);

class TestCell {
    constructor(id, attributes = {}) {
        this.id = id;
        this.children = [];
        this.attributes = new Map(Object.entries(attributes).map(([key, value]) => [key, String(value)]));
    }

    getId() {
        return this.id;
    }

    getAttribute(key) {
        return this.attributes.has(key) ? this.attributes.get(key) : null;
    }
}

function createHarness() {
    const root = new TestCell("root");
    const cells = new Map([[root.id, root]]);
    const model = {
        beginUpdate() {},
        endUpdate() {},
        getRoot: () => root,
        getCell: id => cells.get(String(id)) || null,
        getChildCount: cell => cell.children.length,
        getChildAt: (cell, index) => cell.children[index]
    };
    const graph = {
        getModel: () => model,
        setAttributeForCell(cell, key, value) {
            if (value == null) cell.attributes.delete(key);
            else cell.attributes.set(key, String(value));
        },
        refresh() {},
        addListener() {},
        removeListener() {}
    };
    const listeners = new Map();
    const window = {
        __USL_YEAR_PLANNER_TEST_HOOK__: true,
        addEventListener(type, handler) {
            listeners.set(type, handler);
        },
        removeEventListener(type, handler) {
            if (listeners.get(type) === handler) listeners.delete(type);
        },
        dispatchEvent() {}
    };
    const context = vm.createContext({
        console,
        CustomEvent: class CustomEvent {
            constructor(type, options) {
                this.type = type;
                this.detail = options && options.detail;
            }
        },
        Date,
        JSON,
        Map,
        Math,
        Number,
        Object,
        Set,
        String,
        window,
        Draw: {
            loadPlugin(callback) {
                callback({ editor: { graph } });
            }
        }
    });

    vm.runInContext(fs.readFileSync(PLUGIN_PATH, "utf8"), context, { filename: PLUGIN_PATH });

    function addCell(parent, cell) {
        parent.children.push(cell);
        cells.set(cell.id, cell);
        return cell;
    }

    return { api: window.__uslYearPlannerTestApi, root, addCell, TestCell };
}

function emptyCrop(overrides = {}) {
    return {
        id: "crop_1",
        plantId: "1",
        plant: "Tomato",
        varietyId: null,
        variety: "",
        kgPerPlant: 1,
        germRate: 0.8,
        shelfLifeDays: 0,
        packages: [{ unit: "kg", baseType: "kg", baseQty: 1 }],
        market: [],
        ...overrides
    };
}

test("PlanSchema normalizes legacy yield fields and strips runtime-only persistence fields", () => {
    const { api } = createHarness();
    const plan = {
        year: 2025,
        cropFilterId: "crop_1",
        crops: [{
            ...emptyCrop(),
            kgPerPlant: 2,
            __baseKgPerPlant: 1.5,
            __kgpp_lastAuto: 2,
            __actualHarvestWeeklyKg: [1],
            __sync_lastHarvestStart: "2025-01-01",
            savePackagesAsDefault: true,
            market: [{ qty: 1, unit: "kg", from: "2025-01-01", to: "2025-01-02", __baseTo: "2025-01-02" }]
        }]
    };

    api.PlanSchema.normalizeForRuntime(plan, 2025);
    assert.equal(plan.crops[0].baseKgPerPlant, 1.5);
    assert.equal(plan.crops[0].kgPerPlantMode, "auto");

    const serialized = api.PlanSchema.serializeForPersistence(plan);
    assert.deepEqual(JSON.parse(JSON.stringify(serialized)), {
        year: 2025,
        crops: [{
            id: "crop_1",
            plantId: "1",
            plant: "Tomato",
            varietyId: null,
            variety: "",
            kgPerPlant: 2,
            germRate: 0.8,
            shelfLifeDays: 0,
            packages: [{ unit: "kg", baseType: "kg", baseQty: 1 }],
            market: [{ qty: 1, unit: "kg", from: "2025-01-01", to: "2025-01-02" }],
            baseKgPerPlant: 1.5,
            kgPerPlantMode: "auto"
        }],
        version: 1,
        weekStartDow: 1,
        csa: { enabled: false, boxesPerWeek: 0, start: "", end: "", components: [] }
    });
});

test("PlanSchema detects duplicate crop identities and validates invalid units", () => {
    const { api } = createHarness();
    const plan = api.PlanSchema.createEmptyPlan(2025);
    plan.crops.push(emptyCrop(), emptyCrop({ id: "crop_2" }));

    assert.equal(api.PlanSchema.findDuplicateCrop(plan, "1", null, "crop_1").id, "crop_2");
    assert.equal(api.PlanSchema.findFirstDuplicateCrop(plan).key, "pid:1|vid:");

    plan.crops[1].varietyId = 9;
    plan.crops[0].market.push({ qty: 1, unit: "crate", from: "", to: "" });
    const errors = Array.from(api.PlanSchema.validate(plan));
    assert.ok(errors.some(error => error.includes("market line missing dates")));
    assert.ok(errors.some(error => error.includes("does not resolve to kg")));
});

test("PlanRepository round-trips plans, templates, defaults, and leap-day shifts", () => {
    const { api, root, addCell, TestCell: Cell } = createHarness();
    const moduleCell = addCell(root, new Cell("module"));
    const plan = api.PlanSchema.createEmptyPlan(2024);
    plan.crops.push(emptyCrop({
        harvestStart: "2024-02-29",
        harvestEnd: "2024-03-02"
    }));
    plan.csa.components.push({
        cropId: "crop_1",
        qty: 1,
        unit: "kg",
        everyNWeeks: 1,
        start: "2024-02-29",
        end: "2024-03-02"
    });

    api.PlanRepository.savePlanForYear(moduleCell, 2024, plan);
    assert.equal(api.PlanRepository.loadPlanForYear(moduleCell, 2024).crops[0].harvestStart, "2024-02-29");
    api.PlanRepository.deletePlanForYear(moduleCell, 2024);
    assert.equal(api.PlanRepository.loadPlanForYear(moduleCell, 2024), null);

    const template = api.PlanSchema.serializeForPersistence(plan, { forTemplate: true });
    template.templateBaseYear = 2024;
    template.year = null;
    api.PlanRepository.saveTemplateByName("Leap", template);
    assert.deepEqual(Array.from(api.PlanRepository.listTemplateNames()), ["Leap"]);
    const shifted = api.PlanRepository.rekeyTemplateToPlan(api.PlanRepository.loadTemplateByName("Leap"), 2025);
    assert.equal(shifted.crops[0].harvestStart, "2025-02-28");
    assert.equal(shifted.csa.components[0].start, "2025-02-28");
    assert.equal(shifted.csa.components[0].cropId, shifted.crops[0].id);
    api.PlanRepository.deleteTemplateByName("Leap");
    assert.deepEqual(Array.from(api.PlanRepository.listTemplateNames()), []);

    api.PlanRepository.saveDefaultsForPlant("1", [{ unit: "box", baseType: "kg", baseQty: 2 }]);
    assert.equal(api.PlanRepository.getDefaultsForPlant("1")[0].unit, "box");
});

test("DiagramPlanReader aggregates perennial and cross-year tiler facts with one crop key", () => {
    const { api, root, addCell, TestCell: Cell } = createHarness();
    const moduleCell = addCell(root, new Cell("module"));
    addCell(moduleCell, new Cell("perennial", {
        tiler_group: "1",
        plant_id: "1",
        variety_id: "",
        plant_count: "2",
        life_cycle: "perennial",
        season_start_year: "2023",
        harvest_start: "2025-06-01",
        harvest_end: "2025-06-07"
    }));
    addCell(moduleCell, new Cell("cross-year", {
        tiler_group: "1",
        plant_id: "1",
        variety_id: "",
        plant_count: "3",
        season_start_year: "2024",
        harvest_start: "2024-12-29",
        harvest_end: "2025-01-10"
    }));

    const weeks = api.PlanMath.buildWeekStartsForYearLocal(2025, 1);
    const facts = api.DiagramPlanReader.readYearFacts(
        moduleCell,
        2025,
        weeks,
        new Map([["pid:1|vid:", 2]])
    );

    assert.equal(facts.actualPlantsByCropKey.get("pid:1|vid:"), 5);
    const actualKg = facts.actualHarvestSeriesByCropKey.get("pid:1|vid:").reduce((sum, value) => sum + value, 0);
    assert.ok(actualKg > 4 && actualKg <= 10);
});

test("PlanRuntimeService recalculation is idempotent and preserves manual harvest dates", () => {
    const { api, root, addCell, TestCell: Cell } = createHarness();
    const moduleCell = addCell(root, new Cell("module"));
    addCell(moduleCell, new Cell("tiler", {
        tiler_group: "1",
        plant_id: "1",
        plant_count: "4",
        season_start_year: "2025",
        harvest_start: "2025-07-01",
        harvest_end: "2025-07-14"
    }));
    const plan = api.PlanSchema.createEmptyPlan(2025);
    plan.crops.push(emptyCrop({
        useActualHarvest: false,
        harvestStart: "2025-08-01",
        harvestEnd: "2025-08-07",
        market: [{ qty: 2, unit: "kg", from: "2025-08-01", to: "2025-08-07" }]
    }));

    const first = api.PlanRuntimeService.recalculate(moduleCell, 2025, plan);
    const firstSnapshot = JSON.stringify(plan);
    const second = api.PlanRuntimeService.recalculate(moduleCell, 2025, plan);

    assert.equal(plan.crops[0].actualPlants, 4);
    assert.equal(plan.crops[0].harvestStart, "2025-08-01");
    assert.equal(plan.crops[0].plantsReq, 4);
    assert.equal(JSON.stringify(plan), firstSnapshot);
    assert.equal(second.derivedByCropId.get("crop_1").actualPlants, 4);
    assert.equal(first.warnings.length, 0);
});

test("PlanRuntimeService derives actual harvest windows and returns calculation warnings", () => {
    const { api, root, addCell, TestCell: Cell } = createHarness();
    const moduleCell = addCell(root, new Cell("module"));
    addCell(moduleCell, new Cell("tiler", {
        tiler_group: "1",
        plant_id: "1",
        plant_count: "2",
        season_start_year: "2025",
        harvest_start: "2025-09-03",
        harvest_end: "2025-09-09"
    }));
    const plan = api.PlanSchema.createEmptyPlan(2025);
    plan.crops.push(emptyCrop({
        useActualHarvest: true,
        harvestStart: "",
        harvestEnd: "",
        market: [{ qty: 1, unit: "kg", from: "", to: "" }]
    }));

    const runtime = api.PlanRuntimeService.recalculate(moduleCell, 2025, plan);
    const derived = runtime.derivedByCropId.get("crop_1");

    assert.equal(derived.harvestStart, "2025-09-01");
    assert.equal(derived.harvestEnd, "2025-09-14");
    assert.ok(derived.actualHarvestWeeklyKg.some(value => value > 0));
    assert.ok(runtime.warnings.some(warning => warning.includes("missing dates")));
});

test("YearPlanDashboard aggregates shortage and surplus without netting crops", () => { // NEW
    const { api } = createHarness(); // NEW
    const plan = api.PlanSchema.createEmptyPlan(2026); // NEW
    const shortCrop = emptyCrop({ id: "short", plant: "Tomato", useActualHarvest: false, harvestStart: "2026-06-01", harvestEnd: "2026-06-30" }); // NEW
    const surplusCrop = emptyCrop({ id: "surplus", plantId: "2", plant: "Carrot", useActualHarvest: false, harvestStart: "2026-06-01", harvestEnd: "2026-06-30" }); // NEW
    const noDemandCrop = emptyCrop({ id: "none", plantId: "3", plant: "Lettuce", useActualHarvest: false }); // NEW
    plan.crops.push(shortCrop, surplusCrop, noDemandCrop); // NEW
    const runtime = { // NEW
        warnings: [],
        cropTotals: [
            { crop: shortCrop, targetKg: 10, supplyKg: 4, plantsReq: 10, seedsReq: 13 },
            { crop: surplusCrop, targetKg: 5, supplyKg: 8, plantsReq: 5, seedsReq: 7 },
            { crop: noDemandCrop, targetKg: 0, supplyKg: 2, plantsReq: 0, seedsReq: 0 }
        ]
    }; // NEW

    const dashboard = api.YearPlanDashboard.compute(plan, runtime); // NEW
    assert.equal(dashboard.targetKg, 15); // NEW
    assert.equal(dashboard.supplyKg, 14); // NEW
    assert.equal(dashboard.shortKg, 6); // NEW
    assert.equal(dashboard.surplusKg, 5); // NEW
    assert.equal(dashboard.cropMetricsById.get("short").status, "Short"); // NEW
    assert.equal(dashboard.cropMetricsById.get("surplus").status, "Surplus"); // NEW
    assert.equal(dashboard.cropMetricsById.get("none").status, "No demand"); // NEW
    assert.ok(dashboard.badges.includes("Short")); // NEW
    assert.ok(dashboard.badges.includes("Surplus")); // NEW
    assert.ok(dashboard.badges.includes("Manual harvest dates")); // NEW
}); // NEW

test("YearPlanDashboard treats zero supply as a full shortage and validation errors as missing data", () => { // NEW
    const { api } = createHarness(); // NEW
    const plan = api.PlanSchema.createEmptyPlan(2026); // NEW
    const valid = emptyCrop({ id: "valid", useActualHarvest: true, harvestStart: "2026-06-01", harvestEnd: "2026-06-30" }); // NEW
    const invalid = emptyCrop({ id: "invalid", plantId: "2", plant: "Bad", kgPerPlant: null, harvestStart: "2026-06-01", harvestEnd: "2026-06-30" }); // NEW
    plan.crops.push(valid, invalid); // NEW
    const repeatedError = 'Crop "Bad" missing valid kg/plant.'; // NEW
    const runtime = { // NEW
        warnings: [repeatedError, repeatedError],
        cropTotals: [
            { crop: valid, targetKg: 7, supplyKg: 0, plantsReq: 7, seedsReq: 9 },
            { crop: invalid, targetKg: 4, supplyKg: 0, plantsReq: NaN, seedsReq: NaN }
        ]
    }; // NEW

    const dashboard = api.YearPlanDashboard.compute(plan, runtime); // NEW
    assert.equal(dashboard.cropMetricsById.get("valid").status, "Short"); // NEW
    assert.equal(dashboard.cropMetricsById.get("valid").shortKg, 7); // NEW
    assert.equal(dashboard.cropMetricsById.get("invalid").status, "Missing data"); // NEW
    assert.equal(dashboard.warningCount, 1); // NEW
    assert.deepEqual(Array.from(dashboard.diagnostics), [repeatedError]); // NEW
}); // NEW

test("YearPlanDashboard promotes a missing harvest window to missing data when demand exists", () => { // NEW
    const { api } = createHarness(); // NEW
    const plan = api.PlanSchema.createEmptyPlan(2026); // NEW
    const crop = emptyCrop({ id: "window", plant: "Lettuce", harvestStart: "", harvestEnd: "" }); // NEW
    plan.crops.push(crop); // NEW
    const dashboard = api.YearPlanDashboard.compute(plan, { // NEW
        warnings: [],
        cropTotals: [{ crop, targetKg: 3, supplyKg: 0, plantsReq: 3, seedsReq: 4 }]
    }); // NEW
    assert.equal(dashboard.cropMetricsById.get("window").status, "Missing data"); // NEW
    assert.ok(dashboard.validationErrors.some(error => error.includes("missing harvest window"))); // NEW
}); // NEW

test("YearPlanDashboard dirty snapshots ignore runtime fields and update after save baselines", () => { // NEW
    const { api } = createHarness(); // NEW
    const plan = api.PlanSchema.createEmptyPlan(2026); // NEW
    plan.crops.push(emptyCrop()); // NEW
    const state = api.YearPlanDashboard.createState(plan); // NEW

    api.YearPlanDashboard.markBaseline(state, plan, null); // NEW
    assert.equal(api.YearPlanDashboard.isDirty(state, plan), false); // NEW
    plan.crops[0].__actualHarvestWeeklyKg = [1, 2, 3]; // NEW
    assert.equal(api.YearPlanDashboard.isDirty(state, plan), false); // NEW
    plan.crops[0].market.push({ qty: 2, unit: "kg", from: "2026-06-01", to: "2026-06-07" }); // NEW
    assert.equal(api.YearPlanDashboard.isDirty(state, plan), true); // NEW
    api.YearPlanDashboard.markBaseline(state, plan, new Date("2026-06-14T12:00:00Z")); // NEW
    assert.equal(api.YearPlanDashboard.isDirty(state, plan), false); // NEW
    plan.crops[0].savePackagesAsDefault = true; // NEW
    assert.equal(api.YearPlanDashboard.isDirty(state, plan), true); // NEW
    api.YearPlanDashboard.markBaseline(state, plan, null); // NEW
    assert.equal(api.YearPlanDashboard.isDirty(state, plan), false); // NEW
    assert.equal(state.validationState, "valid"); // NEW
}); // NEW

test("YearPlanDashboard resolves selection after crop removal and preserves unknown methods", () => { // NEW
    const { api } = createHarness(); // NEW
    const crops = [{ id: "a" }, { id: "b" }, { id: "c" }]; // NEW
    assert.equal(api.YearPlanDashboard.resolveSelectedCropId(crops, "b", 0), "b"); // NEW
    assert.equal(api.YearPlanDashboard.resolveSelectedCropId([{ id: "a" }, { id: "c" }], "b", 1), "c"); // NEW
    assert.equal(api.YearPlanDashboard.resolveSelectedCropId([], "b", 0), ""); // NEW

    const options = api.YearPlanDashboard.buildMethodOptions([ // NEW
        { method_id: "direct_sow.field", method_name: "Direct sow" },
        { method_id: "direct_sow.field", method_name: "Duplicate" }
    ], "legacy.method"); // NEW
    assert.deepEqual(JSON.parse(JSON.stringify(options)), [ // NEW
        { value: "legacy.method", label: "legacy.method (legacy/unavailable)", unavailable: true },
        { value: "direct_sow.field", label: "Direct sow", unavailable: false }
    ]); // NEW
}); // NEW
