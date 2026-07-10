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
    "Year_Planner.js" // CHANGE
);
const PLUGIN_SOURCE = fs.readFileSync(PLUGIN_PATH, "utf8"); // NEW

class TestCell {
    constructor(id, attributes = {}) {
        this.id = id;
        this.children = [];
        this.attributes = new Map(Object.entries(attributes).map(([key, value]) => [key, String(value)]));
        this.visible = true; // NEW
        this.connectable = true; // NEW
    }

    getId() {
        return this.id;
    }

    getAttribute(key) {
        return this.attributes.has(key) ? this.attributes.get(key) : null;
    }

    setVisible(value) {
        this.visible = Boolean(value); // NEW
    }

    setConnectable(value) {
        this.connectable = Boolean(value); // NEW
    }
}

function createHarness() {
    const root = new TestCell("root");
    const cells = new Map([[root.id, root]]);
    const document = { // NEW
        createElement() { // NEW
            const attributes = new Map(); // NEW
            return { // NEW
                attributes, // NEW
                setAttribute(name, value) { attributes.set(String(name), String(value)); } // NEW
            }; // NEW
        } // NEW
    }; // NEW
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
        getDefaultParent: () => root, // NEW
        insertVertex(parent, id, value) { // NEW
            const cell = new TestCell(id || `cell_${cells.size}`); // NEW
            cell.value = value; // NEW
            for (const [name, attributeValue] of (value?.attributes || [])) cell.attributes.set(name, attributeValue); // NEW
            parent.children.push(cell); // NEW
            cells.set(cell.id, cell); // NEW
            return cell; // NEW
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
        document, // NEW
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

    vm.runInContext(PLUGIN_SOURCE, context, { filename: PLUGIN_PATH }); // CHANGE

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

function addDemand(plan, overrides = {}) { // NEW
    const line = { // NEW
        id: `demand_${plan.demands.length + 1}`, // NEW
        channelId: "farm_store", // NEW
        cropId: "crop_1", // NEW
        qty: 1, // NEW
        unit: "kg", // NEW
        frequency: "week", // NEW
        everyN: 1, // NEW
        from: "2026-06-01", // NEW
        to: "2026-06-07", // NEW
        priority: "target", // NEW
        price: null, // NEW
        notes: "", // NEW
        ...overrides // NEW
    }; // NEW
    plan.demands.push(line); // NEW
    return line; // NEW
} // NEW

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
            market: [{ qty: 1, unit: "kg", from: "2025-01-01", to: "2025-01-02", __baseTo: "2025-01-02" }] // CHANGE
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
        version: 2, // CHANGE
        weekStartDow: 1,
        demandChannels: [ // NEW
            { id: "farm_store", label: "Farm Store", type: "farm_store" }, // NEW
            { id: "restaurant_1", label: "Restaurant 1", type: "restaurant" }, // NEW
            { id: "farmers_market", label: "Farmers Market", type: "market" }, // NEW
            { id: "wholesale", label: "Wholesale", type: "wholesale" } // NEW
        ], // NEW
        demands: [], // NEW
        csa: { enabled: false, boxesPerWeek: 0, start: "", end: "", components: [] }
    });
});

test("PlanSchema normalizes weekStartDow to an integer from zero through six", () => { // NEW
    const { api } = createHarness(); // NEW
    for (const [input, expected] of [[0, 0], ["6", 6], [2.9, 2], [-1, 1], [7, 1], ["bad", 1]]) { // NEW
        const plan = { year: 2026, weekStartDow: input, crops: [] }; // NEW
        api.PlanSchema.normalizeForRuntime(plan, 2026); // NEW
        assert.equal(plan.weekStartDow, expected); // NEW
        assert.equal(api.PlanMath.computePlanWeekly(plan, []).weeks[0].iso, api.PlanMath.buildWeekStartsForYearLocal(2026, expected)[0].iso); // NEW
    } // NEW
}); // NEW

test("PlanSchema adds default demand channels only when the collection is absent", () => { // NEW
    const { api } = createHarness(); // NEW
    const missing = { year: 2026, crops: [] }; // NEW
    const intentionallyEmpty = { year: 2026, crops: [], demandChannels: [], demands: [] }; // NEW
    api.PlanSchema.normalizeForRuntime(missing, 2026); // NEW
    api.PlanSchema.normalizeForRuntime(intentionallyEmpty, 2026); // NEW
    assert.deepEqual(Array.from(missing.demandChannels, channel => channel.id), ["farm_store", "restaurant_1", "farmers_market", "wholesale"]); // NEW
    assert.deepEqual(Array.from(intentionallyEmpty.demandChannels), []); // NEW
    assert.equal(missing.version, 2); // NEW
}); // NEW

test("Planting-method SQL starts directly with SQL text", () => { // NEW
    const functionSource = PLUGIN_SOURCE.match(/async function queryPlantingMethodsForPlantId[\s\S]*?return await queryAll\(sql, \[pid\]\);/); // NEW
    assert.ok(functionSource); // NEW
    assert.doesNotMatch(functionSource[0], /const sql = `\s*\/\//); // NEW
    assert.match(functionSource[0], /const sql = `\s*SELECT pm\.method_id/); // NEW
}); // NEW

test("PlanSchema detects duplicate crop identities and validates invalid units", () => {
    const { api } = createHarness();
    const plan = api.PlanSchema.createEmptyPlan(2025);
    plan.crops.push(emptyCrop(), emptyCrop({ id: "crop_2" }));

    assert.equal(api.PlanSchema.findDuplicateCrop(plan, "1", null, "crop_1").id, "crop_2");
    assert.equal(api.PlanSchema.findFirstDuplicateCrop(plan).key, "pid:1|vid:");

    plan.crops[1].varietyId = 9;
    addDemand(plan, { unit: "crate", from: "", to: "" }); // CHANGE
    const errors = Array.from(api.PlanSchema.validate(plan));
    assert.ok(errors.some(error => error.includes("missing dates"))); // CHANGE
    assert.ok(errors.some(error => error.includes("does not resolve to kg")));
});

test("PlanSchema rejects duplicate crop package units", () => { // NEW
    const { api } = createHarness(); // NEW
    const crop = emptyCrop({ packages: [ // NEW
        { unit: "kg", baseType: "kg", baseQty: 1, price: 2 }, // NEW
        { unit: " KG ", baseType: "kg", baseQty: 2, price: 3 } // NEW
    ] }); // NEW
    const errors = Array.from(api.PlanSchema.validateCrop(crop)); // NEW
    assert.ok(errors.some(error => error.includes('duplicate package unit "KG"'))); // NEW
}); // NEW

test("PlanSchema strips legacy demand prices from persisted plans", () => { // NEW
    const { api } = createHarness(); // NEW
    const plan = api.PlanSchema.createEmptyPlan(2026); // NEW
    plan.crops.push(emptyCrop()); // NEW
    addDemand(plan, { price: 7 }); // NEW
    const serialized = api.PlanSchema.serializeForPersistence(plan); // NEW
    assert.equal(Object.prototype.hasOwnProperty.call(serialized.demands[0], "price"), false); // NEW
}); // NEW

test("PlanSchema exposes CSA validation independently from the full plan", () => { // NEW
    const { api } = createHarness(); // NEW
    const plan = api.PlanSchema.createEmptyPlan(2026); // NEW
    plan.crops.push(emptyCrop()); // NEW
    plan.csa.enabled = true; // NEW
    plan.csa.components.push({ cropId: "crop_1", qty: 1, unit: "crate", start: "", end: "" }); // NEW
    const csaErrors = Array.from(api.PlanSchema.validateCsa(plan)); // NEW
    assert.ok(csaErrors.some(error => error.includes("boxes/week"))); // NEW
    assert.ok(csaErrors.some(error => error.includes("missing dates"))); // NEW
    assert.ok(csaErrors.some(error => error.includes("does not resolve to kg"))); // NEW
    assert.ok(Array.from(api.PlanSchema.validate(plan)).length >= csaErrors.length); // NEW
}); // NEW

test("PlanSchema rejects reversed demand and effective CSA date ranges", () => { // CHANGE
    const { api } = createHarness(); // NEW
    const plan = api.PlanSchema.createEmptyPlan(2026); // NEW
    const crop = emptyCrop(); // CHANGE
    plan.crops.push(crop); // NEW
    addDemand(plan, { from: "2026-07-01", to: "2026-06-01" }); // NEW
    plan.csa.enabled = true; // NEW
    plan.csa.boxesPerWeek = 10; // NEW
    plan.csa.start = "2026-09-30"; // NEW
    plan.csa.end = "2026-06-01"; // NEW
    plan.csa.components.push({ cropId: crop.id, qty: 1, unit: "kg", everyNWeeks: 1, start: "", end: "" }); // NEW

    const demandErrors = Array.from(api.PlanSchema.validateDemand(plan)); // CHANGE
    const csaErrors = Array.from(api.PlanSchema.validateCsa(plan)); // NEW
    assert.ok(demandErrors.some(error => error.includes("start date after end date"))); // CHANGE
    assert.ok(csaErrors.some(error => error === "CSA start date is after CSA end date.")); // NEW
    assert.ok(csaErrors.some(error => error.includes("has start date after end date"))); // NEW
}); // NEW

test("PlanMath excludes reversed demand ranges while retaining explicit valid CSA components", () => { // NEW
    const { api } = createHarness(); // NEW
    const plan = api.PlanSchema.createEmptyPlan(2026); // NEW
    const crop = emptyCrop(); // CHANGE
    plan.crops.push(crop); // NEW
    addDemand(plan, { qty: 5, from: "2026-07-01", to: "2026-06-01" }); // NEW
    plan.csa.enabled = true; // NEW
    plan.csa.boxesPerWeek = 10; // NEW
    plan.csa.start = "2026-09-30"; // NEW
    plan.csa.end = "2026-06-01"; // NEW
    plan.csa.components.push( // NEW
        { cropId: crop.id, qty: 2, unit: "kg", everyNWeeks: 1, start: "", end: "" }, // NEW
        { cropId: crop.id, qty: 1, unit: "kg", everyNWeeks: 1, start: "2026-06-01", end: "2026-06-07" } // NEW
    ); // NEW
    const warnings = []; // NEW

    const weekly = api.PlanMath.computePlanWeekly(plan, warnings); // NEW
    assert.equal(weekly.targetTotal.reduce((sum, value) => sum + value, 0), 10); // NEW
    assert.ok(warnings.some(warning => warning.includes("Demand line skipped (start date after end date)"))); // CHANGE
    assert.ok(warnings.some(warning => warning.includes("CSA component skipped (start date after end date)"))); // NEW
}); // NEW

test("PlanMath rejects reversed manual harvest windows without producing supply", () => { // NEW
    const { api } = createHarness(); // NEW
    const plan = api.PlanSchema.createEmptyPlan(2026); // NEW
    const crop = emptyCrop({ // NEW
        useActualHarvest: false, actualPlants: 10, harvestStart: "2026-07-10", harvestEnd: "2026-07-01" // NEW
    }); // NEW
    plan.crops.push(crop); // NEW
    const warnings = []; // NEW
    const weekly = api.PlanMath.computePlanWeekly(plan, warnings); // NEW
    assert.equal(weekly.supplyTotal.reduce((sum, value) => sum + value, 0), 0); // NEW
    assert.ok(warnings.some(warning => warning.includes("harvest start date after end date"))); // NEW
    assert.ok(api.PlanSchema.validateCrop(crop).some(error => error.includes("harvest start date is after harvest end date"))); // NEW
}); // NEW

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
    addDemand(plan, { from: "2024-02-29", to: "2024-03-02" }); // NEW

    api.PlanRepository.savePlanForYear(moduleCell, 2024, plan);
    assert.equal(api.PlanRepository.loadPlanForYear(moduleCell, 2024).crops[0].harvestStart, "2024-02-29");
    api.PlanRepository.deletePlanForYear(moduleCell, 2024);
    assert.equal(api.PlanRepository.loadPlanForYear(moduleCell, 2024), null);

    const template = api.PlanSchema.serializeForPersistence(plan, { forTemplate: true });
    template.templateBaseYear = 2024;
    template.year = null;
    api.PlanRepository.saveTemplateByName("Leap", template);
    assert.deepEqual(Array.from(api.PlanRepository.listTemplateNames()), ["Leap"]);
    api.PlanRepository.saveTemplateByName(" Leap ", { overwritten: true }); // NEW
    assert.equal(api.PlanRepository.loadTemplateByName("Leap").overwritten, true); // NEW
    api.PlanRepository.saveTemplateByName("Leap", template); // NEW
    const shifted = api.PlanRepository.rekeyTemplateToPlan(api.PlanRepository.loadTemplateByName("Leap"), 2025);
    assert.equal(shifted.crops[0].harvestStart, "2025-02-28");
    assert.equal(shifted.csa.components[0].start, "2025-02-28");
    assert.equal(shifted.csa.components[0].cropId, shifted.crops[0].id);
    assert.equal(shifted.demands[0].from, "2025-02-28"); // NEW
    assert.equal(shifted.demands[0].cropId, shifted.crops[0].id); // NEW
    api.PlanRepository.deleteTemplateByName("Leap");
    assert.deepEqual(Array.from(api.PlanRepository.listTemplateNames()), []);

    api.PlanRepository.saveDefaultsForPlant("1", [{ unit: "box", baseType: "kg", baseQty: 2 }]);
    assert.equal(api.PlanRepository.getDefaultsForPlant("1")[0].unit, "box");
    const metadataCell = root.children.find(cell => cell.getAttribute("usl_year_planner_metadata") === "1"); // NEW
    assert.ok(metadataCell); // NEW
    assert.equal(metadataCell.visible, false); // NEW
    assert.ok(metadataCell.getAttribute("plan_year_templates")); // NEW
    assert.ok(metadataCell.getAttribute("plan_unit_defaults")); // NEW
});

test("PlanRepository migrates legacy root maps on the first diagram-level write", () => { // NEW
    const { api, root } = createHarness(); // NEW
    root.attributes.set("plan_year_templates", JSON.stringify({ Legacy: { year: 2024 } })); // NEW
    root.attributes.set("plan_unit_defaults", JSON.stringify({ 9: [{ unit: "bunch", baseType: "kg", baseQty: 1 }] })); // NEW

    assert.deepEqual(Array.from(api.PlanRepository.listTemplateNames()), ["Legacy"]); // NEW
    api.PlanRepository.saveTemplateByName("Current", { year: 2026 }); // NEW

    const metadataCell = root.children.find(cell => cell.getAttribute("usl_year_planner_metadata") === "1"); // NEW
    assert.ok(metadataCell); // NEW
    assert.equal(root.getAttribute("plan_year_templates"), null); // NEW
    assert.equal(root.getAttribute("plan_unit_defaults"), null); // NEW
    assert.deepEqual(Array.from(api.PlanRepository.listTemplateNames()), ["Current", "Legacy"]); // NEW
    assert.equal(api.PlanRepository.getDefaultsForPlant("9")[0].unit, "bunch"); // NEW
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
    assert.deepEqual(JSON.parse(JSON.stringify(facts.actualHarvestDateRangeByCropKey.get("pid:1|vid:"))), { // NEW
        start: "2024-12-29", // NEW
        end: "2025-06-07" // NEW
    }); // NEW
});

test("DiagramPlanReader resolves legacy variety names and rejects malformed harvest ranges", () => { // NEW
    const { api, root, addCell, TestCell: Cell } = createHarness(); // NEW
    const moduleCell = addCell(root, new Cell("module")); // NEW
    addCell(moduleCell, new Cell("roma-early", { // NEW
        tiler_group: "1", plant_id: "1", plant_name: "Tomato", variety_name: " roma ", plant_count: "2", // NEW
        season_start_year: "2026", harvest_start: "2026-06-03", harvest_end: "2026-06-05" // NEW
    })); // NEW
    addCell(moduleCell, new Cell("roma-late", { // NEW
        tiler_group: "1", plant_id: "1", plant_name: "Tomato", variety_name: "Roma", plant_count: "3", // NEW
        season_start_year: "2026", harvest_start: "2026-07-10", harvest_end: "2026-07-12" // NEW
    })); // NEW
    addCell(moduleCell, new Cell("reversed", { // NEW
        tiler_group: "1", plant_id: "2", plant_name: "Carrot", plant_count: "4", // NEW
        season_start_year: "2026", harvest_start: "2026-08-10", harvest_end: "2026-08-01" // NEW
    })); // NEW
    addCell(moduleCell, new Cell("incomplete", { // NEW
        tiler_group: "1", plant_id: "3", plant_name: "Lettuce", plant_count: "1", // NEW
        season_start_year: "2026", harvest_start: "2026-09-01" // NEW
    })); // NEW
    addCell(moduleCell, new Cell("unmatched", { // NEW
        tiler_group: "1", plant_id: "1", plant_name: "Tomato", variety_name: "Unknown", plant_count: "1", // NEW
        season_start_year: "2026", harvest_start: "2026-10-01", harvest_end: "2026-10-02" // NEW
    })); // NEW
    const plan = api.PlanSchema.createEmptyPlan(2026); // NEW
    plan.crops.push( // NEW
        emptyCrop({ id: "roma", varietyId: 10, variety: "Roma" }), // NEW
        emptyCrop({ id: "carrot", plantId: "2", plant: "Carrot" }), // NEW
        emptyCrop({ id: "lettuce", plantId: "3", plant: "Lettuce" }) // NEW
    ); // NEW
    const facts = api.DiagramPlanReader.readYearFacts( // NEW
        moduleCell, // NEW
        2026, // NEW
        api.PlanMath.buildWeekStartsForYearLocal(2026, 1), // NEW
        new Map([["pid:1|vid:10", 1], ["pid:2|vid:", 1], ["pid:3|vid:", 1]]), // NEW
        plan // NEW
    ); // NEW

    assert.equal(facts.actualPlantsByCropKey.get("pid:1|vid:10"), 5); // NEW
    assert.deepEqual(JSON.parse(JSON.stringify(facts.actualHarvestDateRangeByCropKey.get("pid:1|vid:10"))), { // NEW
        start: "2026-06-03", end: "2026-07-12" // NEW
    }); // NEW
    assert.equal(facts.actualHarvestDateRangeByCropKey.has("pid:2|vid:"), false); // NEW
    assert.equal(facts.actualHarvestDateRangeByCropKey.has("pid:3|vid:"), false); // NEW
    assert.ok(facts.diagnostics.some(message => message.includes("start date after end date"))); // NEW
    assert.ok(facts.diagnostics.some(message => message.includes("incomplete"))); // NEW
    assert.ok(facts.diagnostics.some(message => message.includes("no unique planned variety match"))); // NEW
}); // NEW

test("DiagramPlanReader reports ambiguous planned legacy variety matches", () => { // NEW
    const { api, root, addCell, TestCell: Cell } = createHarness(); // NEW
    const moduleCell = addCell(root, new Cell("module")); // NEW
    addCell(moduleCell, new Cell("roma", { // NEW
        tiler_group: "1", plant_id: "1", plant_name: "Tomato", variety_name: "Roma", plant_count: "1", // NEW
        season_start_year: "2026", harvest_start: "2026-06-01", harvest_end: "2026-06-02" // NEW
    })); // NEW
    const plan = api.PlanSchema.createEmptyPlan(2026); // NEW
    plan.crops.push( // NEW
        emptyCrop({ id: "roma-a", varietyId: 10, variety: "Roma" }), // NEW
        emptyCrop({ id: "roma-b", varietyId: 11, variety: " roma " }) // NEW
    ); // NEW
    const facts = api.DiagramPlanReader.readYearFacts( // NEW
        moduleCell, 2026, api.PlanMath.buildWeekStartsForYearLocal(2026, 1), new Map(), plan // NEW
    ); // NEW
    assert.equal(facts.actualPlantsByCropKey.size, 0); // NEW
    assert.ok(facts.diagnostics.some(message => message.includes("matches multiple planned varieties"))); // NEW
}); // NEW

test("DiagramPlanReader returns normalized garden crop candidates and ignores groups without plant identity", () => { // NEW
    const { api, root, addCell, TestCell: Cell } = createHarness(); // NEW
    const moduleCell = addCell(root, new Cell("module")); // NEW
    addCell(moduleCell, new Cell("valid", { // NEW
        tiler_group: "1", // NEW
        plant_id: " 12 ", // NEW
        plant_name: " Tomato ", // NEW
        variety_id: " 34 ", // NEW
        variety_name: " Roma " // NEW
    })); // NEW
    addCell(moduleCell, new Cell("missing-id", { tiler_group: "1", plant_name: "Carrot" })); // NEW
    addCell(moduleCell, new Cell("not-a-group", { plant_id: "99", plant_name: "Ignored" })); // NEW

    assert.deepEqual(JSON.parse(JSON.stringify(api.DiagramPlanReader.readGardenCropCandidates(moduleCell))), [{ // NEW
        plantId: "12", // NEW
        plantName: "Tomato", // NEW
        varietyId: "34", // NEW
        varietyName: "Roma" // NEW
    }]); // NEW
}); // NEW

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
    addDemand(plan, { qty: 2, from: "2025-08-01", to: "2025-08-07" }); // NEW

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
    addDemand(plan, { from: "", to: "" }); // NEW

    const runtime = api.PlanRuntimeService.recalculate(moduleCell, 2025, plan);
    const derived = runtime.derivedByCropId.get("crop_1");

    assert.equal(derived.harvestStart, "2025-09-03"); // CHANGE
    assert.equal(derived.harvestEnd, "2025-09-09"); // CHANGE
    assert.ok(derived.actualHarvestWeeklyKg.some(value => value > 0));
    assert.ok(runtime.warnings.some(warning => warning.includes("missing dates")));
});

test("PlanRuntimeService includes prior-year cross-year harvest as carryover supply without editable crop rows", () => { // NEW
    const { api, root, addCell, TestCell: Cell } = createHarness(); // NEW
    const moduleCell = addCell(root, new Cell("module")); // NEW
    const prior = api.PlanSchema.createEmptyPlan(2026); // NEW
    prior.crops.push(emptyCrop({ // NEW
        id: "prior_crop", // NEW
        actualPlants: 10, // NEW
        useActualHarvest: false, // NEW
        harvestStart: "2026-12-29", // NEW
        harvestEnd: "2027-01-10" // NEW
    })); // NEW
    api.PlanRepository.savePlanForYear(moduleCell, 2026, prior); // NEW
    const current = api.PlanSchema.createEmptyPlan(2027); // NEW
    current.crops.push(emptyCrop({ id: "crop_1", actualPlants: 0, useActualHarvest: false, harvestStart: "", harvestEnd: "" })); // NEW
    addDemand(current, { from: "2027-01-04", to: "2027-01-10", qty: 5 }); // NEW

    const runtime = api.PlanRuntimeService.recalculate(moduleCell, 2027, current); // NEW
    const weekly = runtime.weekly.perCrop.get("crop_1"); // NEW

    assert.equal(current.crops.length, 1); // NEW
    assert.equal(current.crops[0].id, "crop_1"); // NEW
    assert.ok(Math.abs(weekly.supply.reduce((sum, value) => sum + value, 0) - (100 / 13)) < 0.0001); // CHANGED
    assert.equal(weekly.usableSupply.reduce((sum, value) => sum + value, 0), 5); // NEW
    assert.ok(runtime.warnings.some(warning => warning.includes("carryover supply"))); // NEW
    assert.equal(api.PlanSchema.stripRuntimeFields(current).__carryoverCrops, undefined); // NEW
}); // NEW

test("PlanMath inventory uses conservative weekly shelf-life buckets and FIFO consumption", () => { // NEW
    const { api } = createHarness(); // NEW
    const weeks = [{ iso: "2026-01-05" }, { iso: "2026-01-12" }, { iso: "2026-01-19" }, { iso: "2026-01-26" }]; // NEW

    for (const shelfLifeDays of [0, 3, 7]) { // NEW
        const result = api.PlanMath.buildUsableSupplySeries([10, 0], [0, 5], shelfLifeDays, weeks.slice(0, 2)); // NEW
        assert.deepEqual(Array.from(result.usableSupply), [0, 0]); // NEW
        assert.deepEqual(Array.from(result.expired), [0, 10]); // NEW
        assert.deepEqual(Array.from(result.short), [0, 5]); // NEW
    } // NEW

    const eightDays = api.PlanMath.buildUsableSupplySeries([10, 0], [0, 5], 8, weeks.slice(0, 2)); // NEW
    assert.deepEqual(Array.from(eightDays.availableSupply), [10, 10]); // NEW
    assert.deepEqual(Array.from(eightDays.usableSupply), [0, 5]); // NEW
    assert.deepEqual(Array.from(eightDays.endingInventory), [10, 5]); // NEW

    const fifo = api.PlanMath.buildUsableSupplySeries([5, 5, 0], [0, 3, 6], 14, weeks.slice(0, 3)); // NEW
    assert.deepEqual(Array.from(fifo.usableSupply), [0, 3, 5]); // NEW
    assert.deepEqual(Array.from(fifo.expired), [0, 0, 2]); // NEW
    assert.deepEqual(Array.from(fifo.short), [0, 0, 1]); // NEW

    const longLife = api.PlanMath.buildUsableSupplySeries([4, 0, 0, 0], [0, 0, 0, 0], 21, weeks); // NEW
    assert.deepEqual(Array.from(longLife.endingInventory), [4, 4, 4, 0]); // NEW
    assert.deepEqual(Array.from(longLife.expired), [0, 0, 0, 4]); // NEW
}); // NEW

test("PlanMath expands daily, weekly, and prorated monthly demand on calendar anchors", () => { // NEW
    const { api } = createHarness(); // NEW
    const weeks = api.PlanMath.buildWeekStartsForYearLocal(2024, 1); // NEW
    const daily = Array(weeks.length).fill(0); // NEW
    const weekly = Array(weeks.length).fill(0); // NEW
    const monthly = Array(weeks.length).fill(0); // NEW
    const leapPartial = Array(weeks.length).fill(0); // NEW

    api.PlanMath.addDailyDemandAcrossWeeks(daily, weeks, "2024-02-28", "2024-03-03", 2, 2); // NEW
    api.PlanMath.addWeeklyDemandAcrossWeeks(weekly, weeks, "2024-01-03", "2024-01-21", 5, 2, 1); // NEW
    api.PlanMath.addMonthlyDemandAcrossWeeks(monthly, weeks, "2024-01-16", "2024-03-15", 31, 2); // NEW
    api.PlanMath.addMonthlyDemandAcrossWeeks(leapPartial, weeks, "2024-02-15", "2024-02-29", 29, 1); // NEW

    assert.equal(daily.reduce((sum, value) => sum + value, 0), 6); // NEW
    assert.equal(weekly.reduce((sum, value) => sum + value, 0), 10); // NEW
    assert.equal(monthly.reduce((sum, value) => sum + value, 0), 31); // NEW
    assert.equal(leapPartial.reduce((sum, value) => sum + value, 0), 15); // NEW
}); // NEW

test("PlanMath allocates CSA first, then priority and channel order, with requested and fulfilled revenue", () => { // NEW
    const { api } = createHarness(); // NEW
    const plan = api.PlanSchema.createEmptyPlan(2026); // NEW
    const crop = emptyCrop({ actualPlants: 10, useActualHarvest: false, harvestStart: "2026-06-01", harvestEnd: "2026-06-07", packages: [{ unit: "kg", baseType: "kg", baseQty: 1, price: 2 }] }); // CHANGE
    plan.crops.push(crop); // NEW
    plan.csa.enabled = true; // NEW
    plan.csa.boxesPerWeek = 1; // NEW
    plan.csa.start = "2026-06-01"; // NEW
    plan.csa.end = "2026-06-07"; // NEW
    plan.csa.components.push({ cropId: crop.id, qty: 2, unit: "kg", everyNWeeks: 1, start: "", end: "" }); // NEW
    addDemand(plan, { id: "farm_target", channelId: "farm_store", qty: 6, priority: "target", price: 99 }); // CHANGE
    addDemand(plan, { id: "restaurant_committed", channelId: "restaurant_1", qty: 6, priority: "committed", price: 99 }); // CHANGE

    const weekly = api.PlanMath.computePlanWeekly(plan, []); // NEW
    const farm = weekly.perDemandLine.get("farm_target"); // NEW
    const restaurant = weekly.perDemandLine.get("restaurant_committed"); // NEW
    assert.equal(weekly.csa.usableSupply.reduce((sum, value) => sum + value, 0), 2); // NEW
    assert.equal(restaurant.usableSupply.reduce((sum, value) => sum + value, 0), 6); // NEW
    assert.equal(farm.usableSupply.reduce((sum, value) => sum + value, 0), 2); // NEW
    assert.equal(farm.short.reduce((sum, value) => sum + value, 0), 4); // NEW

    const dashboard = api.YearPlanDashboard.compute(plan, { weekly, cropTotals: api.PlanMath.computePlanCropTotals(plan, weekly), warnings: [] }); // NEW
    assert.equal(dashboard.potentialRevenue, 24); // NEW
    assert.equal(dashboard.fulfilledRevenue, 16); // NEW
    assert.equal(dashboard.channelMetricsById.get("restaurant_1").status, "OK"); // NEW
    assert.equal(dashboard.channelMetricsById.get("farm_store").shortKg, 4); // NEW
    assert.equal(dashboard.priorityMetrics.find(metric => metric.priority === "committed").usableSupplyKg, 6); // NEW
}); // NEW

test("PlanMath prices demand from exact package unit matches only", () => { // NEW
    const { api } = createHarness(); // NEW
    const plan = api.PlanSchema.createEmptyPlan(2026); // NEW
    const crop = emptyCrop({ // NEW
        actualPlants: 20, // NEW
        useActualHarvest: false, // NEW
        harvestStart: "2026-06-01", // NEW
        harvestEnd: "2026-06-07", // NEW
        packages: [ // NEW
            { unit: "kg", baseType: "kg", baseQty: 1, price: 3 }, // NEW
            { unit: "box", baseType: "kg", baseQty: 2, price: 10 } // NEW
        ] // NEW
    }); // NEW
    plan.crops.push(crop); // NEW
    addDemand(plan, { id: "kg_line", qty: 4, unit: "kg", price: 100 }); // NEW
    addDemand(plan, { id: "box_line", qty: 2, unit: "box", price: 100 }); // NEW
    addDemand(plan, { id: "lb_line", qty: 1, unit: "lb", price: 100 }); // NEW
    assert.equal(api.PlanMath.resolvePackagePriceForUnit(crop, " KG "), 3); // NEW
    assert.equal(Number.isFinite(api.PlanMath.resolvePackagePriceForUnit(crop, "lb")), false); // NEW

    const weekly = api.PlanMath.computePlanWeekly(plan, []); // NEW
    assert.equal(weekly.perDemandLine.get("kg_line").potentialRevenue.reduce((sum, value) => sum + value, 0), 12); // NEW
    assert.equal(weekly.perDemandLine.get("box_line").potentialRevenue.reduce((sum, value) => sum + value, 0), 20); // NEW
    assert.equal(weekly.perDemandLine.get("lb_line").potentialRevenue.reduce((sum, value) => sum + value, 0), 0); // NEW
    assert.equal(weekly.perDemandLine.get("lb_line").fulfilledRevenue.reduce((sum, value) => sum + value, 0), 0); // NEW
}); // NEW

test("PlanMath breaks equal-priority shortages by stored channel order", () => { // NEW
    const { api } = createHarness(); // NEW
    const plan = api.PlanSchema.createEmptyPlan(2026); // NEW
    plan.crops.push(emptyCrop({ actualPlants: 8, useActualHarvest: false, harvestStart: "2026-06-01", harvestEnd: "2026-06-07" })); // NEW
    addDemand(plan, { id: "later", channelId: "restaurant_1", qty: 5, priority: "committed" }); // NEW
    addDemand(plan, { id: "earlier", channelId: "farm_store", qty: 5, priority: "committed" }); // NEW
    const weekly = api.PlanMath.computePlanWeekly(plan, []); // NEW
    assert.equal(weekly.perDemandLine.get("earlier").usableSupply.reduce((sum, value) => sum + value, 0), 5); // NEW
    assert.equal(weekly.perDemandLine.get("later").usableSupply.reduce((sum, value) => sum + value, 0), 3); // NEW
}); // NEW

test("PlanMath keeps raw harvest stable and never pools inventory across crops", () => { // NEW
    const { api } = createHarness(); // NEW
    function makeWeeklyPlan(shelfLifeDays) { // NEW
        const plan = api.PlanSchema.createEmptyPlan(2026); // NEW
        plan.crops.push(emptyCrop({ // NEW
            useActualHarvest: false, // NEW
            actualPlants: 10, // NEW
            shelfLifeDays, // NEW
            harvestStart: "2026-01-05", // NEW
            harvestEnd: "2026-01-11" // CHANGE
        })); // NEW
        addDemand(plan, { qty: 5, from: "2026-01-12", to: "2026-01-18" }); // NEW
        return api.PlanMath.computePlanWeekly(plan, []); // NEW
    } // NEW

    const shortLife = makeWeeklyPlan(0); // NEW
    const stored = makeWeeklyPlan(8); // NEW
    assert.equal(shortLife.supplyTotal.reduce((sum, value) => sum + value, 0), 10); // NEW
    assert.equal(stored.supplyTotal.reduce((sum, value) => sum + value, 0), 10); // NEW
    assert.equal(shortLife.usableSupplyTotal.reduce((sum, value) => sum + value, 0), 0); // NEW
    assert.equal(stored.usableSupplyTotal.reduce((sum, value) => sum + value, 0), 5); // NEW

    const plan = api.PlanSchema.createEmptyPlan(2026); // NEW
    plan.crops.push( // NEW
        emptyCrop({ id: "harvest", actualPlants: 10, useActualHarvest: false, shelfLifeDays: 8, harvestStart: "2026-01-05", harvestEnd: "2026-01-11" }), // NEW
        emptyCrop({ id: "demand", plantId: "2", plant: "Carrot", actualPlants: 0, useActualHarvest: false, shelfLifeDays: 8 }) // CHANGE
    ); // NEW
    addDemand(plan, { cropId: "demand", qty: 5, from: "2026-01-12", to: "2026-01-18" }); // NEW
    const weekly = api.PlanMath.computePlanWeekly(plan, []); // NEW
    const demandSeries = weekly.perCrop.get("demand"); // NEW
    assert.equal(demandSeries.usableSupply.reduce((sum, value) => sum + value, 0), 0); // NEW
    assert.equal(demandSeries.short.reduce((sum, value) => sum + value, 0), 5); // NEW
    assert.equal(weekly.usableSupplyTotal.reduce((sum, value) => sum + value, 0), 0); // NEW
}); // NEW

test("PlanMath builds filtered and aggregate chart models with additive flow summaries", () => { // NEW
    const { api } = createHarness(); // NEW
    const weekly = { // NEW
        weeks: [{ iso: "2026-01-05" }, { iso: "2026-01-12" }], // NEW
        targetTotal: [5, 7], // NEW
        supplyTotal: [8, 2], // NEW
        availableSupplyTotal: [8, 4], // NEW
        usableSupplyTotal: [5, 3], // NEW
        shortTotal: [0, 4], // NEW
        surplusTotal: [3, 1], // NEW
        expiredTotal: [0, 2], // NEW
        endingInventoryTotal: [3, 1], // NEW
        perCrop: new Map([["a", { // NEW
            target: [2, 4], // NEW
            supply: [5, 0], // NEW
            availableSupply: [5, 3], // NEW
            usableSupply: [2, 3], // NEW
            short: [0, 1], // NEW
            surplus: [3, 0], // NEW
            expired: [0, 0], // NEW
            endingInventory: [3, 0] // NEW
        }]]) // NEW
    }; // NEW

    const filtered = api.PlanMath.buildPlanChartModel(weekly, "a"); // NEW
    assert.equal(filtered[1].shortKg, 1); // NEW
    assert.equal(filtered[0].harvestKg, 5); // NEW
    const aggregateSummary = api.PlanMath.summarizePlanChartModel(api.PlanMath.buildPlanChartModel(weekly, "")); // NEW
    assert.deepEqual(JSON.parse(JSON.stringify(aggregateSummary)), { // NEW
        targetKg: 12, // NEW
        harvestKg: 10, // NEW
        usableSupplyKg: 8, // NEW
        shortKg: 4, // NEW
        expiredKg: 2, // NEW
        worstShortageKg: 4, // NEW
        worstShortageWeek: "2026-01-12", // NEW
        shortWeeks: 1 // NEW
    }); // NEW
}); // NEW

test("PlanRuntimeService syncs demand to harvest dates and collapses legacy shelf extensions", () => { // NEW
    const { api } = createHarness(); // NEW
    const crop = emptyCrop({ // NEW
        syncharvest: true, // NEW
        shelfLifeDays: 14, // NEW
        harvestStart: "2026-06-01", // NEW
        harvestEnd: "2026-06-07" // CHANGE
    }); // NEW
    const plan = api.PlanSchema.createEmptyPlan(2026); // NEW
    plan.crops.push(crop); // NEW
    addDemand(plan, { from: "2026-06-01", to: "2026-06-21" }); // NEW
    plan.csa.enabled = true; // NEW
    plan.csa.start = "2026-06-01"; // NEW
    plan.csa.end = "2026-06-30"; // NEW
    plan.csa.components.push({ cropId: crop.id, qty: 1, unit: "kg", start: "2026-06-01", end: "2026-06-21" }); // NEW

    api.PlanRuntimeService.syncCropDatesIfEnabled(plan, crop, { hs: "2026-06-01", he: "2026-06-07", availEnd: "2026-06-21" }); // NEW
    assert.equal(plan.demands[0].to, "2026-06-07"); // CHANGE
    assert.equal(plan.csa.components[0].end, "2026-06-07"); // NEW
    assert.equal(api.PlanRuntimeService.cropAvailableEndYmd(crop), "2026-06-07"); // NEW
}); // NEW

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

test("YearPlanDashboard classifies weekly timing and avoids inventory snapshot surplus double-counting", () => { // NEW
    const { api } = createHarness(); // NEW
    const plan = api.PlanSchema.createEmptyPlan(2026); // NEW
    const crops = [ // NEW
        emptyCrop({ id: "missing", plant: "Missing", kgPerPlant: null, harvestStart: "2026-01-01", harvestEnd: "2026-01-31" }), // NEW
        emptyCrop({ id: "none", plantId: "2", plant: "None", harvestStart: "2026-01-01", harvestEnd: "2026-01-31" }), // NEW
        emptyCrop({ id: "short", plantId: "3", plant: "Short", harvestStart: "2026-01-01", harvestEnd: "2026-01-31" }), // NEW
        emptyCrop({ id: "timing", plantId: "4", plant: "Timing", harvestStart: "2026-01-01", harvestEnd: "2026-01-31" }), // NEW
        emptyCrop({ id: "surplus", plantId: "5", plant: "Surplus", harvestStart: "2026-01-01", harvestEnd: "2026-01-31" }), // NEW
        emptyCrop({ id: "ok", plantId: "6", plant: "OK", harvestStart: "2026-01-01", harvestEnd: "2026-01-31" }) // NEW
    ]; // NEW
    plan.crops.push(...crops); // NEW
    const series = (target, supply, usable, short, surplus, expired, endingInventory) => ({ // NEW
        target, supply, availableSupply: supply, usableSupply: usable, short, surplus, expired, endingInventory // NEW
    }); // NEW
    const weekly = { // NEW
        weeks: [{ iso: "2026-01-05" }, { iso: "2026-01-12" }], // NEW
        perCrop: new Map([ // NEW
            ["missing", series([1, 0], [1, 0], [1, 0], [0, 0], [0, 0], [0, 0], [0, 0])], // NEW
            ["none", series([0, 0], [2, 0], [0, 0], [0, 0], [2, 2], [0, 0], [2, 2])], // NEW
            ["short", series([0, 10], [4, 0], [0, 0], [0, 10], [4, 0], [0, 4], [4, 0])], // NEW
            ["timing", series([0, 10], [10, 0], [0, 0], [0, 10], [10, 0], [0, 10], [10, 0])], // NEW
            ["surplus", series([5, 0], [8, 0], [5, 0], [0, 0], [3, 3], [0, 0], [3, 3])], // NEW
            ["ok", series([5, 0], [5, 0], [5, 0], [0, 0], [0, 0], [0, 0], [0, 0])] // NEW
        ]) // NEW
    }; // NEW
    const cropTotals = crops.map(crop => ({ crop, targetKg: 0, supplyKg: 0, plantsReq: 1, seedsReq: 2 })); // NEW
    const dashboard = api.YearPlanDashboard.compute(plan, { weekly, cropTotals, warnings: [] }); // NEW

    assert.equal(dashboard.cropMetricsById.get("missing").status, "Missing data"); // NEW
    assert.equal(dashboard.cropMetricsById.get("none").status, "No demand"); // NEW
    assert.equal(dashboard.cropMetricsById.get("short").status, "Short"); // NEW
    assert.equal(dashboard.cropMetricsById.get("timing").status, "Expired / timing issue"); // NEW
    assert.equal(dashboard.cropMetricsById.get("surplus").status, "Surplus"); // NEW
    assert.equal(dashboard.cropMetricsById.get("surplus").surplusKg, 3); // NEW
    assert.equal(dashboard.cropMetricsById.get("ok").status, "OK"); // NEW
    assert.ok(dashboard.badges.includes("Expired / timing issue")); // NEW
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
    addDemand(plan, { qty: 2 }); // CHANGE
    assert.equal(api.YearPlanDashboard.isDirty(state, plan), true); // NEW
    api.YearPlanDashboard.markBaseline(state, plan, new Date("2026-06-14T12:00:00Z")); // NEW
    assert.equal(api.YearPlanDashboard.isDirty(state, plan), false); // NEW
    plan.crops[0].savePackagesAsDefault = true; // NEW
    assert.equal(api.YearPlanDashboard.isDirty(state, plan), true); // NEW
    api.YearPlanDashboard.markBaseline(state, plan, null); // NEW
    assert.equal(api.YearPlanDashboard.isDirty(state, plan), false); // NEW
    assert.equal(state.validationState, "valid"); // NEW
}); // NEW

test("YearPlanDashboard builds compact status and CSA summaries without timezone parsing", () => { // NEW
    const { api } = createHarness(); // NEW
    assert.equal(api.YearPlanDashboard.buildCompactStatus({ year: 2026, cropCount: 0, shortKg: 0, surplusKg: 0, dirty: false }), "2026 \u00b7 0 crops"); // NEW
    assert.equal(api.YearPlanDashboard.buildCompactStatus({ year: 2026, cropCount: 1, shortKg: 12.4, surplusKg: 0, dirty: true }), "2026 \u00b7 1 crop \u00b7 Short 12.4 kg \u00b7 Unsaved"); // NEW
    assert.equal(api.YearPlanDashboard.buildCompactStatus({ year: 2026, cropCount: 2, shortKg: 0, surplusKg: 3, dirty: false }), "2026 \u00b7 2 crops \u00b7 Surplus 3.0 kg"); // NEW
    assert.equal(api.YearPlanDashboard.buildCsaSummary({ csa: { enabled: false } }), "CSA Box Plan: Off"); // NEW
    assert.equal(api.YearPlanDashboard.buildCsaSummary({ csa: { enabled: true, boxesPerWeek: 25, start: "2026-06-01", end: "2026-09-30", components: [{}, {}] } }), "CSA Box Plan: 25 boxes/week \u00b7 Jun 01\u2013Sep 30 \u00b7 2 components"); // NEW
}); // NEW

test("YearPlanDashboard expands checks only when blocking errors first appear", () => { // NEW
    const { api } = createHarness(); // NEW
    const state = api.YearPlanDashboard.createState({ crops: [] }); // NEW
    assert.equal(state.csaExpanded, false); // NEW
    assert.equal(state.demandExpanded, true); // NEW
    assert.equal(state.cropPlanExpanded, true); // NEW
    assert.equal(state.planCheckExpanded, false); // NEW
    const invalid = { validationErrors: ["Plan error"] }; // NEW
    let changes = api.YearPlanDashboard.syncExpansionState(state, invalid, ["CSA error"], []); // CHANGE
    assert.deepEqual(JSON.parse(JSON.stringify(changes)), { planCheckChanged: true, csaChanged: true, demandChanged: false }); // CHANGE
    state.planCheckExpanded = false; state.csaExpanded = false; // CHANGE
    changes = api.YearPlanDashboard.syncExpansionState(state, invalid, ["CSA error"], []); // CHANGE
    assert.deepEqual(JSON.parse(JSON.stringify(changes)), { planCheckChanged: false, csaChanged: false, demandChanged: false }); // CHANGE
    api.YearPlanDashboard.syncExpansionState(state, { validationErrors: [] }, [], []); // CHANGE
    changes = api.YearPlanDashboard.syncExpansionState(state, invalid, ["CSA error"], []); // CHANGE
    assert.deepEqual(JSON.parse(JSON.stringify(changes)), { planCheckChanged: true, csaChanged: true, demandChanged: false }); // CHANGE
    state.planCheckExpanded = false; state.csaExpanded = false; // CHANGE
    changes = api.YearPlanDashboard.syncExpansionState(state, { validationErrors: [], diagnostics: ["Runtime warning"] }, [], []); // CHANGE
    assert.deepEqual(JSON.parse(JSON.stringify(changes)), { planCheckChanged: false, csaChanged: false, demandChanged: false }); // CHANGE
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
