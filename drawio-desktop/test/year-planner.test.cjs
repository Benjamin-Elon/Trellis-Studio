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
    "Year_Planner.js"
);
const PLUGIN_SOURCE = fs.readFileSync(PLUGIN_PATH, "utf8");

class TestCell {
    constructor(id, attributes = {}) {
        this.id = id;
        this.children = [];
        this.attributes = new Map(Object.entries(attributes).map(([key, value]) => [key, String(value)]));
        this.visible = true;
        this.connectable = true;
    }

    getId() {
        return this.id;
    }

    getAttribute(key) {
        return this.attributes.has(key) ? this.attributes.get(key) : null;
    }

    setVisible(value) {
        this.visible = Boolean(value);
    }

    setConnectable(value) {
        this.connectable = Boolean(value);
    }
}

function createHarness() {
    const root = new TestCell("root");
    const cells = new Map([[root.id, root]]);
    const document = {
        createElement() {
            const attributes = new Map();
            return {
                attributes,
                setAttribute(name, value) { attributes.set(String(name), String(value)); }
            };
        }
    };
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
        getDefaultParent: () => root,
        insertVertex(parent, id, value) {
            const cell = new TestCell(id || `cell_${cells.size}`);
            cell.value = value;
            for (const [name, attributeValue] of (value?.attributes || [])) cell.attributes.set(name, attributeValue);
            parent.children.push(cell);
            cells.set(cell.id, cell);
            return cell;
        },
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
        document,
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

    vm.runInContext(PLUGIN_SOURCE, context, { filename: PLUGIN_PATH });

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
        ...overrides
    };
}

function addDemand(plan, overrides = {}) {
    const line = {
        id: `demand_${plan.demands.length + 1}`,
        channelId: "farm_store",
        cropId: "crop_1",
        qty: 1,
        unit: "kg",
        frequency: "week",
        everyN: 1,
        from: "2026-06-01",
        to: "2026-06-07",
        priority: "target",
        price: null,
        notes: "",
        ...overrides
    };
    plan.demands.push(line);
    return line;
}

function codes(results) {
    return Array.from(results || []).map(error => error && error.code);
}

function messages(results) {
    return Array.from(results || []).map(error => String(error && error.message || ""));
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
            baseKgPerPlant: 1.5,
            kgPerPlantMode: "auto"
        }],
        version: 2,
        weekStartDow: 1,
        demandChannels: [
            { id: "farm_store", label: "Farm Store", type: "farm_store" },
            { id: "restaurant_1", label: "Restaurant 1", type: "restaurant" },
            { id: "farmers_market", label: "Farmers Market", type: "market" },
            { id: "wholesale", label: "Wholesale", type: "wholesale" }
        ],
        demands: [],
        csa: { enabled: false, boxesPerWeek: 0, start: "", end: "", salePricePerBox: null, salePriceMode: "auto", components: [] }
    });
});

test("PlanSchema normalizes weekStartDow to an integer from zero through six", () => {
    const { api } = createHarness();
    for (const [input, expected] of [[0, 0], ["6", 6], [2.9, 2], [-1, 1], [7, 1], ["bad", 1]]) {
        const plan = { year: 2026, weekStartDow: input, crops: [] };
        api.PlanSchema.normalizeForRuntime(plan, 2026);
        assert.equal(plan.weekStartDow, expected);
        assert.equal(api.PlanMath.computePlanWeekly(plan, []).weeks[0].iso, api.PlanMath.buildWeekStartsForYearLocal(2026, expected)[0].iso);
    }
});

test("PlanSchema adds default demand channels only when the collection is absent", () => {
    const { api } = createHarness();
    const missing = { year: 2026, crops: [] };
    const intentionallyEmpty = { year: 2026, crops: [], demandChannels: [], demands: [] };
    api.PlanSchema.normalizeForRuntime(missing, 2026);
    api.PlanSchema.normalizeForRuntime(intentionallyEmpty, 2026);
    assert.deepEqual(Array.from(missing.demandChannels, channel => channel.id), ["farm_store", "restaurant_1", "farmers_market", "wholesale"]);
    assert.deepEqual(Array.from(intentionallyEmpty.demandChannels), []);
    assert.equal(missing.version, 2);
});

test("Planting-method SQL starts directly with SQL text", () => {
    const functionSource = PLUGIN_SOURCE.match(/async function queryPlantingMethodsForPlantId[\s\S]*?return await queryAll\(sql, \[pid\]\);/);
    assert.ok(functionSource);
    assert.doesNotMatch(functionSource[0], /const sql = `\s*\/\//);
    assert.match(functionSource[0], /const sql = `\s*SELECT pm\.method_id/);
});

test("PlanSchema detects duplicate crop identities and validates invalid units", () => {
    const { api } = createHarness();
    const plan = api.PlanSchema.createEmptyPlan(2025);
    plan.crops.push(emptyCrop(), emptyCrop({ id: "crop_2" }));

    assert.equal(api.PlanSchema.findDuplicateCrop(plan, "1", null, "crop_1").id, "crop_2");
    assert.equal(api.PlanSchema.findFirstDuplicateCrop(plan).key, "pid:1|vid:");

    plan.crops[1].varietyId = 9;
    addDemand(plan, { unit: "crate", from: "", to: "" });
    const errors = Array.from(api.PlanSchema.validate(plan));
    assert.ok(codes(errors).includes("demand.line_missing_dates"));
    assert.ok(codes(errors).includes("demand.line_unresolved_unit"));
});

test("PlanSchema rejects duplicate crop package units", () => {
    const { api } = createHarness();
    const crop = emptyCrop({ packages: [
        { unit: "kg", baseType: "kg", baseQty: 1, price: 2 },
        { unit: " KG ", baseType: "kg", baseQty: 2, price: 3 }
    ] });
    const errors = Array.from(api.PlanSchema.validateCrop(crop));
    assert.ok(codes(errors).includes("crop.package_duplicate_unit"));
    assert.ok(messages(errors).some(message => message.includes("unique package unit")));
});

test("PlanSchema strips legacy demand prices from persisted plans", () => {
    const { api } = createHarness();
    const plan = api.PlanSchema.createEmptyPlan(2026);
    plan.crops.push(emptyCrop());
    addDemand(plan, { price: 7 });
    const serialized = api.PlanSchema.serializeForPersistence(plan);
    assert.equal(Object.prototype.hasOwnProperty.call(serialized.demands[0], "price"), false);
});

test("PlanSchema exposes CSA validation independently from the full plan", () => {
    const { api } = createHarness();
    const plan = api.PlanSchema.createEmptyPlan(2026);
    plan.crops.push(emptyCrop());
    plan.csa.enabled = true;
    plan.csa.components.push({ cropId: "crop_1", qty: 1, unit: "crate", start: "", end: "" });
    const csaErrors = Array.from(api.PlanSchema.validateCsa(plan));
    assert.ok(codes(csaErrors).includes("csa.invalid_boxes_per_week"));
    assert.ok(codes(csaErrors).includes("csa.component_missing_dates"));
    assert.ok(codes(csaErrors).includes("csa.component_unresolved_unit"));
    assert.ok(Array.from(api.PlanSchema.validate(plan)).length >= csaErrors.length);
});

test("PlanSchema rejects reversed demand and effective CSA date ranges", () => {
    const { api } = createHarness();
    const plan = api.PlanSchema.createEmptyPlan(2026);
    const crop = emptyCrop();
    plan.crops.push(crop);
    addDemand(plan, { from: "2026-07-01", to: "2026-06-01" });
    plan.csa.enabled = true;
    plan.csa.boxesPerWeek = 10;
    plan.csa.start = "2026-09-30";
    plan.csa.end = "2026-06-01";
    plan.csa.components.push({ cropId: crop.id, qty: 1, unit: "kg", everyNWeeks: 1, start: "", end: "" });

    const demandErrors = Array.from(api.PlanSchema.validateDemand(plan));
    const csaErrors = Array.from(api.PlanSchema.validateCsa(plan));
    assert.ok(codes(demandErrors).includes("demand.line_reversed_dates"));
    assert.ok(codes(csaErrors).includes("csa.reversed_date_range"));
    assert.ok(codes(csaErrors).includes("csa.component_reversed_dates"));
});

test("PlanMath excludes reversed demand ranges while retaining explicit valid CSA components", () => {
    const { api } = createHarness();
    const plan = api.PlanSchema.createEmptyPlan(2026);
    const crop = emptyCrop();
    plan.crops.push(crop);
    addDemand(plan, { qty: 5, from: "2026-07-01", to: "2026-06-01" });
    plan.csa.enabled = true;
    plan.csa.boxesPerWeek = 10;
    plan.csa.start = "2026-09-30";
    plan.csa.end = "2026-06-01";
    plan.csa.components.push(
        { cropId: crop.id, qty: 2, unit: "kg", everyNWeeks: 1, start: "", end: "" },
        { cropId: crop.id, qty: 1, unit: "kg", everyNWeeks: 1, start: "2026-06-01", end: "2026-06-07" }
    );
    const warnings = [];

    const weekly = api.PlanMath.computePlanWeekly(plan, warnings);
    assert.equal(weekly.targetTotal.reduce((sum, value) => sum + value, 0), 10);
    assert.ok(warnings.some(warning => warning.includes("Demand line skipped (start date after end date)")));
    assert.ok(warnings.some(warning => warning.includes("CSA component skipped (start date after end date)")));
});

test("PlanMath rejects reversed manual harvest windows without producing supply", () => {
    const { api } = createHarness();
    const plan = api.PlanSchema.createEmptyPlan(2026);
    const crop = emptyCrop({
        useActualHarvest: false, actualPlants: 10, harvestStart: "2026-07-10", harvestEnd: "2026-07-01"
    });
    plan.crops.push(crop);
    const warnings = [];
    const weekly = api.PlanMath.computePlanWeekly(plan, warnings);
    assert.equal(weekly.supplyTotal.reduce((sum, value) => sum + value, 0), 0);
    assert.ok(warnings.some(warning => warning.includes("harvest start date after end date")));
    assert.ok(codes(api.PlanSchema.validateCrop(crop)).includes("crop.reversed_harvest_window"));
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
    addDemand(plan, { from: "2024-02-29", to: "2024-03-02" });

    api.PlanRepository.savePlanForYear(moduleCell, 2024, plan);
    assert.equal(api.PlanRepository.loadPlanForYear(moduleCell, 2024).crops[0].harvestStart, "2024-02-29");
    api.PlanRepository.deletePlanForYear(moduleCell, 2024);
    assert.equal(api.PlanRepository.loadPlanForYear(moduleCell, 2024), null);

    const template = api.PlanSchema.serializeForPersistence(plan, { forTemplate: true });
    template.templateBaseYear = 2024;
    template.year = null;
    api.PlanRepository.saveTemplateByName("Leap", template);
    assert.deepEqual(Array.from(api.PlanRepository.listTemplateNames()), ["Leap"]);
    api.PlanRepository.saveTemplateByName(" Leap ", { overwritten: true });
    assert.equal(api.PlanRepository.loadTemplateByName("Leap").overwritten, true);
    api.PlanRepository.saveTemplateByName("Leap", template);
    const shifted = api.PlanRepository.rekeyTemplateToPlan(api.PlanRepository.loadTemplateByName("Leap"), 2025);
    assert.equal(shifted.crops[0].harvestStart, "2025-02-28");
    assert.equal(shifted.csa.components[0].start, "2025-02-28");
    assert.equal(shifted.csa.components[0].cropId, shifted.crops[0].id);
    assert.equal(shifted.demands[0].from, "2025-02-28");
    assert.equal(shifted.demands[0].cropId, shifted.crops[0].id);
    api.PlanRepository.deleteTemplateByName("Leap");
    assert.deepEqual(Array.from(api.PlanRepository.listTemplateNames()), []);

    api.PlanRepository.saveDefaultsForPlant("1", [{ unit: "box", baseType: "kg", baseQty: 2 }]);
    assert.equal(api.PlanRepository.getDefaultsForPlant("1")[0].unit, "box");
    const metadataCell = root.children.find(cell => cell.getAttribute("usl_year_planner_metadata") === "1");
    assert.ok(metadataCell);
    assert.equal(metadataCell.visible, false);
    assert.ok(metadataCell.getAttribute("plan_year_templates"));
    assert.ok(metadataCell.getAttribute("plan_unit_defaults"));
});

test("PlanRepository migrates legacy root maps on the first diagram-level write", () => {
    const { api, root } = createHarness();
    root.attributes.set("plan_year_templates", JSON.stringify({ Legacy: { year: 2024 } }));
    root.attributes.set("plan_unit_defaults", JSON.stringify({ 9: [{ unit: "bunch", baseType: "kg", baseQty: 1 }] }));

    assert.deepEqual(Array.from(api.PlanRepository.listTemplateNames()), ["Legacy"]);
    api.PlanRepository.saveTemplateByName("Current", { year: 2026 });

    const metadataCell = root.children.find(cell => cell.getAttribute("usl_year_planner_metadata") === "1");
    assert.ok(metadataCell);
    assert.equal(root.getAttribute("plan_year_templates"), null);
    assert.equal(root.getAttribute("plan_unit_defaults"), null);
    assert.deepEqual(Array.from(api.PlanRepository.listTemplateNames()), ["Current", "Legacy"]);
    assert.equal(api.PlanRepository.getDefaultsForPlant("9")[0].unit, "bunch");
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
    assert.deepEqual(JSON.parse(JSON.stringify(facts.actualHarvestDateRangeByCropKey.get("pid:1|vid:"))), {
        start: "2024-12-29",
        end: "2025-06-07"
    });
});

test("DiagramPlanReader resolves legacy variety names and rejects malformed harvest ranges", () => {
    const { api, root, addCell, TestCell: Cell } = createHarness();
    const moduleCell = addCell(root, new Cell("module"));
    addCell(moduleCell, new Cell("roma-early", {
        tiler_group: "1", plant_id: "1", plant_name: "Tomato", variety_name: " roma ", plant_count: "2",
        season_start_year: "2026", harvest_start: "2026-06-03", harvest_end: "2026-06-05"
    }));
    addCell(moduleCell, new Cell("roma-late", {
        tiler_group: "1", plant_id: "1", plant_name: "Tomato", variety_name: "Roma", plant_count: "3",
        season_start_year: "2026", harvest_start: "2026-07-10", harvest_end: "2026-07-12"
    }));
    addCell(moduleCell, new Cell("reversed", {
        tiler_group: "1", plant_id: "2", plant_name: "Carrot", plant_count: "4",
        season_start_year: "2026", harvest_start: "2026-08-10", harvest_end: "2026-08-01"
    }));
    addCell(moduleCell, new Cell("incomplete", {
        tiler_group: "1", plant_id: "3", plant_name: "Lettuce", plant_count: "1",
        season_start_year: "2026", harvest_start: "2026-09-01"
    }));
    addCell(moduleCell, new Cell("unmatched", {
        tiler_group: "1", plant_id: "1", plant_name: "Tomato", variety_name: "Unknown", plant_count: "1",
        season_start_year: "2026", harvest_start: "2026-10-01", harvest_end: "2026-10-02"
    }));
    const plan = api.PlanSchema.createEmptyPlan(2026);
    plan.crops.push(
        emptyCrop({ id: "roma", varietyId: 10, variety: "Roma" }),
        emptyCrop({ id: "carrot", plantId: "2", plant: "Carrot" }),
        emptyCrop({ id: "lettuce", plantId: "3", plant: "Lettuce" })
    );
    const facts = api.DiagramPlanReader.readYearFacts(
        moduleCell,
        2026,
        api.PlanMath.buildWeekStartsForYearLocal(2026, 1),
        new Map([["pid:1|vid:10", 1], ["pid:2|vid:", 1], ["pid:3|vid:", 1]]),
        plan
    );

    assert.equal(facts.actualPlantsByCropKey.get("pid:1|vid:10"), 5);
    assert.deepEqual(JSON.parse(JSON.stringify(facts.actualHarvestDateRangeByCropKey.get("pid:1|vid:10"))), {
        start: "2026-06-03", end: "2026-07-12"
    });
    assert.equal(facts.actualHarvestDateRangeByCropKey.has("pid:2|vid:"), false);
    assert.equal(facts.actualHarvestDateRangeByCropKey.has("pid:3|vid:"), false);
    assert.ok(facts.diagnostics.some(message => message.includes("start date after end date")));
    assert.ok(facts.diagnostics.some(message => message.includes("incomplete")));
    assert.ok(facts.diagnostics.some(message => message.includes("no unique planned variety match")));
});

test("DiagramPlanReader reports ambiguous planned legacy variety matches", () => {
    const { api, root, addCell, TestCell: Cell } = createHarness();
    const moduleCell = addCell(root, new Cell("module"));
    addCell(moduleCell, new Cell("roma", {
        tiler_group: "1", plant_id: "1", plant_name: "Tomato", variety_name: "Roma", plant_count: "1",
        season_start_year: "2026", harvest_start: "2026-06-01", harvest_end: "2026-06-02"
    }));
    const plan = api.PlanSchema.createEmptyPlan(2026);
    plan.crops.push(
        emptyCrop({ id: "roma-a", varietyId: 10, variety: "Roma" }),
        emptyCrop({ id: "roma-b", varietyId: 11, variety: " roma " })
    );
    const facts = api.DiagramPlanReader.readYearFacts(
        moduleCell, 2026, api.PlanMath.buildWeekStartsForYearLocal(2026, 1), new Map(), plan
    );
    assert.equal(facts.actualPlantsByCropKey.size, 0);
    assert.ok(facts.diagnostics.some(message => message.includes("matches multiple planned varieties")));
});

test("DiagramPlanReader returns normalized garden crop candidates and ignores groups without plant identity", () => {
    const { api, root, addCell, TestCell: Cell } = createHarness();
    const moduleCell = addCell(root, new Cell("module"));
    addCell(moduleCell, new Cell("valid", {
        tiler_group: "1",
        plant_id: " 12 ",
        plant_name: " Tomato ",
        variety_id: " 34 ",
        variety_name: " Roma "
    }));
    addCell(moduleCell, new Cell("missing-id", { tiler_group: "1", plant_name: "Carrot" }));
    addCell(moduleCell, new Cell("not-a-group", { plant_id: "99", plant_name: "Ignored" }));

    assert.deepEqual(JSON.parse(JSON.stringify(api.DiagramPlanReader.readGardenCropCandidates(moduleCell))), [{
        plantId: "12",
        plantName: "Tomato",
        varietyId: "34",
        varietyName: "Roma"
    }]);
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
        harvestEnd: "2025-08-07"
    }));
    addDemand(plan, { qty: 2, from: "2025-08-01", to: "2025-08-07" });

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
        harvestEnd: ""
    }));
    addDemand(plan, { from: "", to: "" });

    const runtime = api.PlanRuntimeService.recalculate(moduleCell, 2025, plan);
    const derived = runtime.derivedByCropId.get("crop_1");

    assert.equal(derived.harvestStart, "2025-09-03");
    assert.equal(derived.harvestEnd, "2025-09-09");
    assert.ok(derived.actualHarvestWeeklyKg.some(value => value > 0));
    assert.ok(runtime.warnings.some(warning => warning.includes("missing dates")));
});

test("PlanRuntimeService includes prior-year cross-year harvest as carryover supply without editable crop rows", () => {
    const { api, root, addCell, TestCell: Cell } = createHarness();
    const moduleCell = addCell(root, new Cell("module"));
    const prior = api.PlanSchema.createEmptyPlan(2026);
    prior.crops.push(emptyCrop({
        id: "prior_crop",
        actualPlants: 10,
        useActualHarvest: false,
        harvestStart: "2026-12-29",
        harvestEnd: "2027-01-10"
    }));
    api.PlanRepository.savePlanForYear(moduleCell, 2026, prior);
    const current = api.PlanSchema.createEmptyPlan(2027);
    current.crops.push(emptyCrop({ id: "crop_1", actualPlants: 0, useActualHarvest: false, harvestStart: "", harvestEnd: "" }));
    addDemand(current, { from: "2027-01-04", to: "2027-01-10", qty: 5 });

    const runtime = api.PlanRuntimeService.recalculate(moduleCell, 2027, current);
    const weekly = runtime.weekly.perCrop.get("crop_1");

    assert.equal(current.crops.length, 1);
    assert.equal(current.crops[0].id, "crop_1");
    assert.ok(Math.abs(weekly.supply.reduce((sum, value) => sum + value, 0) - (100 / 13)) < 0.0001);
    assert.equal(weekly.usableSupply.reduce((sum, value) => sum + value, 0), 5);
    assert.ok(runtime.warnings.some(warning => warning.includes("carryover supply")));
    assert.equal(api.PlanSchema.stripRuntimeFields(current).__carryoverCrops, undefined);
});

test("PlanMath inventory uses conservative weekly shelf-life buckets and FIFO consumption", () => {
    const { api } = createHarness();
    const weeks = [{ iso: "2026-01-05" }, { iso: "2026-01-12" }, { iso: "2026-01-19" }, { iso: "2026-01-26" }];

    for (const shelfLifeDays of [0, 3, 7]) {
        const result = api.PlanMath.buildUsableSupplySeries([10, 0], [0, 5], shelfLifeDays, weeks.slice(0, 2));
        assert.deepEqual(Array.from(result.usableSupply), [0, 0]);
        assert.deepEqual(Array.from(result.expired), [0, 10]);
        assert.deepEqual(Array.from(result.short), [0, 5]);
    }

    const eightDays = api.PlanMath.buildUsableSupplySeries([10, 0], [0, 5], 8, weeks.slice(0, 2));
    assert.deepEqual(Array.from(eightDays.availableSupply), [10, 10]);
    assert.deepEqual(Array.from(eightDays.usableSupply), [0, 5]);
    assert.deepEqual(Array.from(eightDays.endingInventory), [10, 5]);

    const fifo = api.PlanMath.buildUsableSupplySeries([5, 5, 0], [0, 3, 6], 14, weeks.slice(0, 3));
    assert.deepEqual(Array.from(fifo.usableSupply), [0, 3, 5]);
    assert.deepEqual(Array.from(fifo.expired), [0, 0, 2]);
    assert.deepEqual(Array.from(fifo.short), [0, 0, 1]);

    const longLife = api.PlanMath.buildUsableSupplySeries([4, 0, 0, 0], [0, 0, 0, 0], 21, weeks);
    assert.deepEqual(Array.from(longLife.endingInventory), [4, 4, 4, 0]);
    assert.deepEqual(Array.from(longLife.expired), [0, 0, 0, 4]);
});

test("PlanMath expands daily, weekly, and prorated monthly demand on calendar anchors", () => {
    const { api } = createHarness();
    const weeks = api.PlanMath.buildWeekStartsForYearLocal(2024, 1);
    const daily = Array(weeks.length).fill(0);
    const weekly = Array(weeks.length).fill(0);
    const monthly = Array(weeks.length).fill(0);
    const leapPartial = Array(weeks.length).fill(0);

    api.PlanMath.addDailyDemandAcrossWeeks(daily, weeks, "2024-02-28", "2024-03-03", 2, 2);
    api.PlanMath.addWeeklyDemandAcrossWeeks(weekly, weeks, "2024-01-03", "2024-01-21", 5, 2, 1);
    api.PlanMath.addMonthlyDemandAcrossWeeks(monthly, weeks, "2024-01-16", "2024-03-15", 31, 2);
    api.PlanMath.addMonthlyDemandAcrossWeeks(leapPartial, weeks, "2024-02-15", "2024-02-29", 29, 1);

    assert.equal(daily.reduce((sum, value) => sum + value, 0), 6);
    assert.equal(weekly.reduce((sum, value) => sum + value, 0), 10);
    assert.equal(monthly.reduce((sum, value) => sum + value, 0), 31);
    assert.equal(leapPartial.reduce((sum, value) => sum + value, 0), 15);
});

test("PlanMath allocates CSA first, then priority and channel order, with requested and fulfilled revenue", () => {
    const { api } = createHarness();
    const plan = api.PlanSchema.createEmptyPlan(2026);
    const crop = emptyCrop({ actualPlants: 10, useActualHarvest: false, harvestStart: "2026-06-01", harvestEnd: "2026-06-07", packages: [{ unit: "kg", baseType: "kg", baseQty: 1, price: 2 }] });
    plan.crops.push(crop);
    plan.csa.enabled = true;
    plan.csa.boxesPerWeek = 1;
    plan.csa.start = "2026-06-01";
    plan.csa.end = "2026-06-07";
    plan.csa.components.push({ cropId: crop.id, qty: 2, unit: "kg", everyNWeeks: 1, start: "", end: "" });
    addDemand(plan, { id: "farm_target", channelId: "farm_store", qty: 6, priority: "target", price: 99 });
    addDemand(plan, { id: "restaurant_committed", channelId: "restaurant_1", qty: 6, priority: "committed", price: 99 });

    const weekly = api.PlanMath.computePlanWeekly(plan, []);
    const farm = weekly.perDemandLine.get("farm_target");
    const restaurant = weekly.perDemandLine.get("restaurant_committed");
    assert.equal(weekly.csa.usableSupply.reduce((sum, value) => sum + value, 0), 2);
    assert.equal(restaurant.usableSupply.reduce((sum, value) => sum + value, 0), 6);
    assert.equal(farm.usableSupply.reduce((sum, value) => sum + value, 0), 2);
    assert.equal(farm.short.reduce((sum, value) => sum + value, 0), 4);

    const dashboard = api.YearPlanDashboard.compute(plan, { weekly, cropTotals: api.PlanMath.computePlanCropTotals(plan, weekly), warnings: [] });
    assert.equal(dashboard.potentialRevenue, 24);
    assert.equal(dashboard.fulfilledRevenue, 16);
    assert.equal(dashboard.csaMetric.potentialRevenue, 4);
    assert.equal(dashboard.csaMetric.fulfilledRevenue, 4);
    assert.equal(dashboard.totalPotentialRevenue, 28);
    assert.equal(dashboard.totalFulfilledRevenue, 20);
    assert.equal(dashboard.channelMetricsById.get("restaurant_1").status, "OK");
    assert.equal(dashboard.channelMetricsById.get("farm_store").shortKg, 4);
    assert.equal(dashboard.priorityMetrics.find(metric => metric.priority === "committed").usableSupplyKg, 6);
});

test("PlanMath derives CSA box value and prorates CSA revenue by component fulfillment", () => {
    const { api } = createHarness();
    const plan = api.PlanSchema.createEmptyPlan(2026);
    plan.crops.push(emptyCrop({ id: "tomato", plantId: "1", plant: "Tomato", actualPlants: 10, useActualHarvest: false, harvestStart: "2026-06-01", harvestEnd: "2026-06-07", packages: [{ unit: "kg", baseType: "kg", baseQty: 1, price: 5 }] }));
    plan.crops.push(emptyCrop({ id: "lettuce", plantId: "2", plant: "Lettuce", actualPlants: 1, useActualHarvest: false, harvestStart: "2026-06-01", harvestEnd: "2026-06-07", packages: [{ unit: "kg", baseType: "kg", baseQty: 1, price: 3 }] }));
    plan.csa.enabled = true;
    plan.csa.boxesPerWeek = 2;
    plan.csa.start = "2026-06-01";
    plan.csa.end = "2026-06-07";
    plan.csa.components = [
        { cropId: "tomato", qty: 1, unit: "kg", everyNWeeks: 1, start: "", end: "" },
        { cropId: "lettuce", qty: 1, unit: "kg", everyNWeeks: 1, start: "", end: "" }
    ];
    addDemand(plan, { cropId: "tomato", qty: 10, unit: "kg" });

    const warnings = [];
    const weekly = api.PlanMath.computePlanWeekly(plan, warnings);
    const dashboard = api.YearPlanDashboard.compute(plan, { weekly, cropTotals: api.PlanMath.computePlanCropTotals(plan, weekly), warnings });

    assert.equal(weekly.csa.componentValuePerBox, 8);
    assert.equal(weekly.csa.salePricePerBox, 8);
    assert.equal(weekly.csa.boxFillRatio.reduce((max, value) => Math.max(max, value), 0), 0.5);
    assert.equal(dashboard.csaMetric.potentialRevenue, 16);
    assert.equal(dashboard.csaMetric.fulfilledRevenue, 8);
    assert.equal(weekly.csa.potentialRevenueByCropId.get("tomato").reduce((sum, value) => sum + value, 0), 10);
    assert.equal(weekly.csa.fulfilledRevenueByCropId.get("tomato").reduce((sum, value) => sum + value, 0), 5);
    assert.equal(weekly.csa.potentialRevenueByCropId.get("lettuce").reduce((sum, value) => sum + value, 0), 6);
    assert.equal(weekly.csa.fulfilledRevenueByCropId.get("lettuce").reduce((sum, value) => sum + value, 0), 3);
    assert.equal(dashboard.fulfilledRevenue, 40);
    assert.equal(dashboard.totalFulfilledRevenue, 48);
});

test("PlanMath counts missing CSA component prices as zero with a non-blocking warning", () => {
    const { api } = createHarness();
    const plan = api.PlanSchema.createEmptyPlan(2026);
    plan.crops.push(emptyCrop({ actualPlants: 2, useActualHarvest: false, harvestStart: "2026-06-01", harvestEnd: "2026-06-07", packages: [{ unit: "kg", baseType: "kg", baseQty: 1, price: null }] }));
    plan.csa.enabled = true;
    plan.csa.boxesPerWeek = 1;
    plan.csa.start = "2026-06-01";
    plan.csa.end = "2026-06-07";
    plan.csa.components = [{ cropId: "crop_1", qty: 1, unit: "kg", everyNWeeks: 1, start: "", end: "" }];

    const warnings = [];
    const weekly = api.PlanMath.computePlanWeekly(plan, warnings);

    assert.equal(weekly.csa.componentValuePerBox, 0);
    assert.equal(weekly.csa.potentialRevenue.reduce((sum, value) => sum + value, 0), 0);
    assert.ok(warnings.some(warning => /counted as \$0/.test(warning)));
    assert.equal(api.PlanSchema.validateCsa(plan).some(error => /price/i.test(error.message)), false);
});

test("PlanMath prices demand from exact package unit matches only", () => {
    const { api } = createHarness();
    const plan = api.PlanSchema.createEmptyPlan(2026);
    const crop = emptyCrop({
        actualPlants: 20,
        useActualHarvest: false,
        harvestStart: "2026-06-01",
        harvestEnd: "2026-06-07",
        packages: [
            { unit: "kg", baseType: "kg", baseQty: 1, price: 3 },
            { unit: "box", baseType: "kg", baseQty: 2, price: 10 }
        ]
    });
    plan.crops.push(crop);
    addDemand(plan, { id: "kg_line", qty: 4, unit: "kg", price: 100 });
    addDemand(plan, { id: "box_line", qty: 2, unit: "box", price: 100 });
    addDemand(plan, { id: "lb_line", qty: 1, unit: "lb", price: 100 });
    assert.equal(api.PlanMath.resolvePackagePriceForUnit(crop, " KG "), 3);
    assert.equal(Number.isFinite(api.PlanMath.resolvePackagePriceForUnit(crop, "lb")), false);

    const weekly = api.PlanMath.computePlanWeekly(plan, []);
    assert.equal(weekly.perDemandLine.get("kg_line").potentialRevenue.reduce((sum, value) => sum + value, 0), 12);
    assert.equal(weekly.perDemandLine.get("box_line").potentialRevenue.reduce((sum, value) => sum + value, 0), 20);
    assert.equal(weekly.perDemandLine.get("lb_line").potentialRevenue.reduce((sum, value) => sum + value, 0), 0);
    assert.equal(weekly.perDemandLine.get("lb_line").fulfilledRevenue.reduce((sum, value) => sum + value, 0), 0);
});

test("PlanMath breaks equal-priority shortages by stored channel order", () => {
    const { api } = createHarness();
    const plan = api.PlanSchema.createEmptyPlan(2026);
    plan.crops.push(emptyCrop({ actualPlants: 8, useActualHarvest: false, harvestStart: "2026-06-01", harvestEnd: "2026-06-07" }));
    addDemand(plan, { id: "later", channelId: "restaurant_1", qty: 5, priority: "committed" });
    addDemand(plan, { id: "earlier", channelId: "farm_store", qty: 5, priority: "committed" });
    const weekly = api.PlanMath.computePlanWeekly(plan, []);
    assert.equal(weekly.perDemandLine.get("earlier").usableSupply.reduce((sum, value) => sum + value, 0), 5);
    assert.equal(weekly.perDemandLine.get("later").usableSupply.reduce((sum, value) => sum + value, 0), 3);
});

test("PlanMath keeps raw harvest stable and never pools inventory across crops", () => {
    const { api } = createHarness();
    function makeWeeklyPlan(shelfLifeDays) {
        const plan = api.PlanSchema.createEmptyPlan(2026);
        plan.crops.push(emptyCrop({
            useActualHarvest: false,
            actualPlants: 10,
            shelfLifeDays,
            harvestStart: "2026-01-05",
            harvestEnd: "2026-01-11"
        }));
        addDemand(plan, { qty: 5, from: "2026-01-12", to: "2026-01-18" });
        return api.PlanMath.computePlanWeekly(plan, []);
    }

    const shortLife = makeWeeklyPlan(0);
    const stored = makeWeeklyPlan(8);
    assert.equal(shortLife.supplyTotal.reduce((sum, value) => sum + value, 0), 10);
    assert.equal(stored.supplyTotal.reduce((sum, value) => sum + value, 0), 10);
    assert.equal(shortLife.usableSupplyTotal.reduce((sum, value) => sum + value, 0), 0);
    assert.equal(stored.usableSupplyTotal.reduce((sum, value) => sum + value, 0), 5);

    const plan = api.PlanSchema.createEmptyPlan(2026);
    plan.crops.push(
        emptyCrop({ id: "harvest", actualPlants: 10, useActualHarvest: false, shelfLifeDays: 8, harvestStart: "2026-01-05", harvestEnd: "2026-01-11" }),
        emptyCrop({ id: "demand", plantId: "2", plant: "Carrot", actualPlants: 0, useActualHarvest: false, shelfLifeDays: 8 })
    );
    addDemand(plan, { cropId: "demand", qty: 5, from: "2026-01-12", to: "2026-01-18" });
    const weekly = api.PlanMath.computePlanWeekly(plan, []);
    const demandSeries = weekly.perCrop.get("demand");
    assert.equal(demandSeries.usableSupply.reduce((sum, value) => sum + value, 0), 0);
    assert.equal(demandSeries.short.reduce((sum, value) => sum + value, 0), 5);
    assert.equal(weekly.usableSupplyTotal.reduce((sum, value) => sum + value, 0), 0);
});

test("PlanMath builds filtered and aggregate chart models with additive flow summaries", () => {
    const { api } = createHarness();
    const weekly = {
        weeks: [{ iso: "2026-01-05" }, { iso: "2026-01-12" }],
        targetTotal: [5, 7],
        supplyTotal: [8, 2],
        availableSupplyTotal: [8, 4],
        usableSupplyTotal: [5, 3],
        shortTotal: [0, 4],
        surplusTotal: [3, 1],
        expiredTotal: [0, 2],
        endingInventoryTotal: [3, 1],
        perCrop: new Map([["a", {
            target: [2, 4],
            supply: [5, 0],
            availableSupply: [5, 3],
            usableSupply: [2, 3],
            short: [0, 1],
            surplus: [3, 0],
            expired: [0, 0],
            endingInventory: [3, 0]
        }]])
    };

    const filtered = api.PlanMath.buildPlanChartModel(weekly, "a");
    assert.equal(filtered[1].shortKg, 1);
    assert.equal(filtered[0].harvestKg, 5);
    const aggregateSummary = api.PlanMath.summarizePlanChartModel(api.PlanMath.buildPlanChartModel(weekly, ""));
    assert.deepEqual(JSON.parse(JSON.stringify(aggregateSummary)), {
        targetKg: 12,
        harvestKg: 10,
        usableSupplyKg: 8,
        shortKg: 4,
        expiredKg: 2,
        worstShortageKg: 4,
        worstShortageWeek: "2026-01-12",
        shortWeeks: 1
    });
});

test("PlanRuntimeService syncs demand to harvest dates and collapses legacy shelf extensions", () => {
    const { api } = createHarness();
    const crop = emptyCrop({
        syncharvest: true,
        shelfLifeDays: 14,
        harvestStart: "2026-06-01",
        harvestEnd: "2026-06-07"
    });
    const plan = api.PlanSchema.createEmptyPlan(2026);
    plan.crops.push(crop);
    addDemand(plan, { from: "2026-06-01", to: "2026-06-21" });
    plan.csa.enabled = true;
    plan.csa.start = "2026-06-01";
    plan.csa.end = "2026-06-30";
    plan.csa.components.push({ cropId: crop.id, qty: 1, unit: "kg", start: "2026-06-01", end: "2026-06-21" });

    api.PlanRuntimeService.syncCropDatesIfEnabled(plan, crop, { hs: "2026-06-01", he: "2026-06-07", availEnd: "2026-06-21" });
    assert.equal(plan.demands[0].to, "2026-06-07");
    assert.equal(plan.csa.components[0].end, "2026-06-07");
    assert.equal(api.PlanRuntimeService.cropAvailableEndYmd(crop), "2026-06-07");
});

test("YearPlanDashboard aggregates shortage and surplus without netting crops", () => {
    const { api } = createHarness();
    const plan = api.PlanSchema.createEmptyPlan(2026);
    const shortCrop = emptyCrop({ id: "short", plant: "Tomato", useActualHarvest: false, harvestStart: "2026-06-01", harvestEnd: "2026-06-30" });
    const surplusCrop = emptyCrop({ id: "surplus", plantId: "2", plant: "Carrot", useActualHarvest: false, harvestStart: "2026-06-01", harvestEnd: "2026-06-30" });
    const noDemandCrop = emptyCrop({ id: "none", plantId: "3", plant: "Lettuce", useActualHarvest: false });
    plan.crops.push(shortCrop, surplusCrop, noDemandCrop);
    const runtime = {
        warnings: [],
        cropTotals: [
            { crop: shortCrop, targetKg: 10, supplyKg: 4, plantsReq: 10, seedsReq: 13 },
            { crop: surplusCrop, targetKg: 5, supplyKg: 8, plantsReq: 5, seedsReq: 7 },
            { crop: noDemandCrop, targetKg: 0, supplyKg: 2, plantsReq: 0, seedsReq: 0 }
        ]
    };

    const dashboard = api.YearPlanDashboard.compute(plan, runtime);
    assert.equal(dashboard.targetKg, 15);
    assert.equal(dashboard.supplyKg, 14);
    assert.equal(dashboard.shortKg, 6);
    assert.equal(dashboard.surplusKg, 5);
    assert.equal(dashboard.cropMetricsById.get("short").status, "Short");
    assert.equal(dashboard.cropMetricsById.get("surplus").status, "Surplus");
    assert.equal(dashboard.cropMetricsById.get("none").status, "No demand");
    assert.ok(dashboard.badges.includes("Short"));
    assert.ok(dashboard.badges.includes("Surplus"));
    assert.ok(dashboard.badges.includes("Manual harvest dates"));
});

test("YearPlanDashboard classifies weekly timing and avoids inventory snapshot surplus double-counting", () => {
    const { api } = createHarness();
    const plan = api.PlanSchema.createEmptyPlan(2026);
    const crops = [
        emptyCrop({ id: "missing", plant: "Missing", kgPerPlant: null, harvestStart: "2026-01-01", harvestEnd: "2026-01-31" }),
        emptyCrop({ id: "none", plantId: "2", plant: "None", harvestStart: "2026-01-01", harvestEnd: "2026-01-31" }),
        emptyCrop({ id: "short", plantId: "3", plant: "Short", harvestStart: "2026-01-01", harvestEnd: "2026-01-31" }),
        emptyCrop({ id: "timing", plantId: "4", plant: "Timing", harvestStart: "2026-01-01", harvestEnd: "2026-01-31" }),
        emptyCrop({ id: "surplus", plantId: "5", plant: "Surplus", harvestStart: "2026-01-01", harvestEnd: "2026-01-31" }),
        emptyCrop({ id: "ok", plantId: "6", plant: "OK", harvestStart: "2026-01-01", harvestEnd: "2026-01-31" })
    ];
    plan.crops.push(...crops);
    const series = (target, supply, usable, short, surplus, expired, endingInventory) => ({
        target, supply, availableSupply: supply, usableSupply: usable, short, surplus, expired, endingInventory
    });
    const weekly = {
        weeks: [{ iso: "2026-01-05" }, { iso: "2026-01-12" }],
        perCrop: new Map([
            ["missing", series([1, 0], [1, 0], [1, 0], [0, 0], [0, 0], [0, 0], [0, 0])],
            ["none", series([0, 0], [2, 0], [0, 0], [0, 0], [2, 2], [0, 0], [2, 2])],
            ["short", series([0, 10], [4, 0], [0, 0], [0, 10], [4, 0], [0, 4], [4, 0])],
            ["timing", series([0, 10], [10, 0], [0, 0], [0, 10], [10, 0], [0, 10], [10, 0])],
            ["surplus", series([5, 0], [8, 0], [5, 0], [0, 0], [3, 3], [0, 0], [3, 3])],
            ["ok", series([5, 0], [5, 0], [5, 0], [0, 0], [0, 0], [0, 0], [0, 0])]
        ])
    };
    const cropTotals = crops.map(crop => ({ crop, targetKg: 0, supplyKg: 0, plantsReq: 1, seedsReq: 2 }));
    const dashboard = api.YearPlanDashboard.compute(plan, { weekly, cropTotals, warnings: [] });

    assert.equal(dashboard.cropMetricsById.get("missing").status, "Missing data");
    assert.equal(dashboard.cropMetricsById.get("none").status, "No demand");
    assert.equal(dashboard.cropMetricsById.get("short").status, "Short");
    assert.equal(dashboard.cropMetricsById.get("timing").status, "Expired / timing issue");
    assert.equal(dashboard.cropMetricsById.get("surplus").status, "Surplus");
    assert.equal(dashboard.cropMetricsById.get("surplus").surplusKg, 3);
    assert.equal(dashboard.cropMetricsById.get("ok").status, "OK");
    assert.ok(dashboard.badges.includes("Expired / timing issue"));
});

test("YearPlanDashboard treats zero supply as a full shortage and validation errors as missing data", () => {
    const { api } = createHarness();
    const plan = api.PlanSchema.createEmptyPlan(2026);
    const valid = emptyCrop({ id: "valid", useActualHarvest: true, harvestStart: "2026-06-01", harvestEnd: "2026-06-30" });
    const invalid = emptyCrop({ id: "invalid", plantId: "2", plant: "Bad", kgPerPlant: null, harvestStart: "2026-06-01", harvestEnd: "2026-06-30" });
    plan.crops.push(valid, invalid);
    const repeatedError = "Enter kg/plant greater than 0 for Bad.";
    const runtime = {
        warnings: [repeatedError, repeatedError],
        cropTotals: [
            { crop: valid, targetKg: 7, supplyKg: 0, plantsReq: 7, seedsReq: 9 },
            { crop: invalid, targetKg: 4, supplyKg: 0, plantsReq: NaN, seedsReq: NaN }
        ]
    };

    const dashboard = api.YearPlanDashboard.compute(plan, runtime);
    assert.equal(dashboard.cropMetricsById.get("valid").status, "Short");
    assert.equal(dashboard.cropMetricsById.get("valid").shortKg, 7);
    assert.equal(dashboard.cropMetricsById.get("invalid").status, "Missing data");
    assert.equal(dashboard.warningCount, 1);
    assert.deepEqual(Array.from(dashboard.diagnostics), [repeatedError]);
});

test("YearPlanDashboard promotes a missing harvest window to missing data when demand exists", () => {
    const { api } = createHarness();
    const plan = api.PlanSchema.createEmptyPlan(2026);
    const crop = emptyCrop({ id: "window", plant: "Lettuce", harvestStart: "", harvestEnd: "" });
    plan.crops.push(crop);
    const dashboard = api.YearPlanDashboard.compute(plan, {
        warnings: [],
        cropTotals: [{ crop, targetKg: 3, supplyKg: 0, plantsReq: 3, seedsReq: 4 }]
    });
    assert.equal(dashboard.cropMetricsById.get("window").status, "Missing data");
    assert.ok(codes(dashboard.validationErrors).includes("crop.missing_harvest_window"));
});

test("YearPlanDashboard dirty snapshots ignore runtime fields and update after save baselines", () => {
    const { api } = createHarness();
    const plan = api.PlanSchema.createEmptyPlan(2026);
    plan.crops.push(emptyCrop());
    const state = api.YearPlanDashboard.createState(plan);

    api.YearPlanDashboard.markBaseline(state, plan, null);
    assert.equal(api.YearPlanDashboard.isDirty(state, plan), false);
    plan.crops[0].__actualHarvestWeeklyKg = [1, 2, 3];
    assert.equal(api.YearPlanDashboard.isDirty(state, plan), false);
    addDemand(plan, { qty: 2 });
    assert.equal(api.YearPlanDashboard.isDirty(state, plan), true);
    api.YearPlanDashboard.markBaseline(state, plan, new Date("2026-06-14T12:00:00Z"));
    assert.equal(api.YearPlanDashboard.isDirty(state, plan), false);
    plan.crops[0].savePackagesAsDefault = true;
    assert.equal(api.YearPlanDashboard.isDirty(state, plan), true);
    api.YearPlanDashboard.markBaseline(state, plan, null);
    assert.equal(api.YearPlanDashboard.isDirty(state, plan), false);
    assert.equal(state.validationState, "valid");
});

test("YearPlanDashboard builds compact status and CSA summaries without timezone parsing", () => {
    const { api } = createHarness();
    assert.equal(api.YearPlanDashboard.buildCompactStatus({ year: 2026, cropCount: 0, shortKg: 0, surplusKg: 0, dirty: false }), "2026 \u00b7 0 crops");
    assert.equal(api.YearPlanDashboard.buildCompactStatus({ year: 2026, cropCount: 1, shortKg: 12.4, surplusKg: 0, dirty: true }), "2026 \u00b7 1 crop \u00b7 Short 12.4 kg \u00b7 Unsaved");
    assert.equal(api.YearPlanDashboard.buildCompactStatus({ year: 2026, cropCount: 2, shortKg: 0, surplusKg: 3, dirty: false }), "2026 \u00b7 2 crops \u00b7 Surplus 3.0 kg");
    assert.equal(api.YearPlanDashboard.buildCsaSummary({ csa: { enabled: false } }), "CSA Box Plan: Off");
    assert.equal(api.YearPlanDashboard.buildCsaSummary({ csa: { enabled: true, boxesPerWeek: 25, start: "2026-06-01", end: "2026-09-30", components: [{}, {}] } }), "CSA Box Plan: 25 boxes/week \u00b7 Jun 01\u2013Sep 30 \u00b7 2 components");
});

test("YearPlanDashboard expands checks only when blocking errors first appear", () => {
    const { api } = createHarness();
    const state = api.YearPlanDashboard.createState({ crops: [] });
    assert.equal(state.csaExpanded, false);
    assert.equal(state.demandExpanded, true);
    assert.equal(state.cropPlanExpanded, true);
    assert.equal(state.planCheckExpanded, false);
    const invalid = { validationErrors: ["Plan error"] };
    let changes = api.YearPlanDashboard.syncExpansionState(state, invalid, ["CSA error"], []);
    assert.deepEqual(JSON.parse(JSON.stringify(changes)), { planCheckChanged: true, csaChanged: true, demandChanged: false });
    state.planCheckExpanded = false; state.csaExpanded = false;
    changes = api.YearPlanDashboard.syncExpansionState(state, invalid, ["CSA error"], []);
    assert.deepEqual(JSON.parse(JSON.stringify(changes)), { planCheckChanged: false, csaChanged: false, demandChanged: false });
    api.YearPlanDashboard.syncExpansionState(state, { validationErrors: [] }, [], []);
    changes = api.YearPlanDashboard.syncExpansionState(state, invalid, ["CSA error"], []);
    assert.deepEqual(JSON.parse(JSON.stringify(changes)), { planCheckChanged: true, csaChanged: true, demandChanged: false });
    state.planCheckExpanded = false; state.csaExpanded = false;
    changes = api.YearPlanDashboard.syncExpansionState(state, { validationErrors: [], diagnostics: ["Runtime warning"] }, [], []);
    assert.deepEqual(JSON.parse(JSON.stringify(changes)), { planCheckChanged: false, csaChanged: false, demandChanged: false });
});

test("YearPlanDashboard resolves selection after crop removal and preserves unknown methods", () => {
    const { api } = createHarness();
    const crops = [{ id: "a" }, { id: "b" }, { id: "c" }];
    assert.equal(api.YearPlanDashboard.resolveSelectedCropId(crops, "b", 0), "b");
    assert.equal(api.YearPlanDashboard.resolveSelectedCropId([{ id: "a" }, { id: "c" }], "b", 1), "c");
    assert.equal(api.YearPlanDashboard.resolveSelectedCropId([], "b", 0), "");

    const options = api.YearPlanDashboard.buildMethodOptions([
        { method_id: "direct_sow.field", method_name: "Direct sow" },
        { method_id: "direct_sow.field", method_name: "Duplicate" }
    ], "legacy.method");
    assert.deepEqual(JSON.parse(JSON.stringify(options)), [
        { value: "legacy.method", label: "legacy.method (legacy/unavailable)", unavailable: true },
        { value: "direct_sow.field", label: "Direct sow", unavailable: false }
    ]);
});
