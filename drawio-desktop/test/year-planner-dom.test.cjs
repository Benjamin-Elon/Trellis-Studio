const assert = require("node:assert/strict");
const test = require("node:test");
const {
    createYearPlannerHarness,
    makePlanCrop
} = require("./helpers/year-planner-harness.cjs");

function savePlan(harness, year, configure) {
    const plan = harness.api.PlanSchema.createEmptyPlan(year);
    plan.crops.push(makePlanCrop());
    if (configure) configure(plan);
    harness.api.PlanRepository.savePlanForYear(harness.moduleCell, year, plan);
    return plan;
}

function addDemand(plan, overrides = {}) {
    const line = {
        id: `demand_${plan.demands.length + 1}`, channelId: "farm_store", cropId: "crop_1",
        qty: 1, unit: "kg", frequency: "week", everyN: 1,
        from: "2026-06-01", to: "2026-06-07", priority: "target", price: null, notes: "",
        ...overrides
    };
    plan.demands.push(line);
    return line;
}

function findStrip(document, id) {
    return document.querySelector(`[data-year-plan-strip="${id}"]`);
}

function findStripHeader(document, id) {
    const strip = findStrip(document, id);
    return strip ? strip.querySelector(".yp-strip-header") : null;
}

function findStripDetails(document, id) {
    const strip = findStrip(document, id);
    return strip ? strip.querySelector(".yp-strip-details") : null;
}

function setStripExpanded(document, id, expanded) {
    const header = findStripHeader(document, id);
    assert.ok(header);
    if ((header.getAttribute("aria-expanded") === "true") !== expanded) header.click();
    return findStripHeader(document, id);
}

function findCsaStrip(document) {
    return findStripHeader(document, "csa");
}

function findAddCropSelect(document) {
    return Array.from(document.querySelectorAll("select")).find(select =>
        Array.from(select.options).some(option => option.textContent === "-- Select crop --")
    ) || null;
}

function findCropFilterSelect(document) {
    return Array.from(document.querySelectorAll("select")).find(select =>
        Array.from(select.options).some(option => option.textContent === "-- All crops --")
    ) || null;
}

function findCropCard(document, label) {
    return Array.from(document.querySelectorAll(".yp-crop-card")).find(card => card.textContent.includes(label)) || null;
}

function findCropCardById(document, cropId) {
    return document.querySelector(`.yp-crop-card[data-crop-id="${cropId}"]`);
}

function findDemandPriceInput(document) {
    const line = findStripDetails(document, "demand").querySelector("[data-demand-line-id]");
    const label = Array.from(line.querySelectorAll("label")).find(item => item.querySelector("span") && item.querySelector("span").textContent === "Price");
    return label ? label.querySelector('input[type="number"]') : null;
}

function findKpiText(document, label) {
    const tile = Array.from(document.querySelectorAll(".yp-kpi-tile")).find(item => item.textContent.includes(label));
    return tile ? tile.textContent.replace(/\s+/g, " ").trim() : "";
}

function planCheckTotalsCropNames(document) {
    const table = findStripDetails(document, "plan-check").querySelector("table");
    return table ? Array.from(table.querySelectorAll("tbody tr")).map(row => row.cells[0].textContent.trim()) : [];
}

function planCheckTotalsRows(document) {
    const table = findStripDetails(document, "plan-check").querySelector("table");
    if (!table) return [];
    const headers = Array.from(table.querySelectorAll("thead th")).map(cell => cell.textContent.trim());
    return Array.from(table.querySelectorAll("tbody tr")).map(row => {
        const values = Array.from(row.cells).map(cell => cell.textContent.trim());
        return Object.fromEntries(headers.map((header, index) => [header, values[index] || ""]));
    });
}

function planCheckTotalsColumnIndex(document, headerText) {
    const table = findStripDetails(document, "plan-check").querySelector("table");
    const headers = table ? Array.from(table.querySelectorAll("thead th")).map(cell => cell.textContent.trim()) : [];
    return headers.indexOf(headerText);
}

function optionGroupLabels(select) {
    return Array.from(select.querySelectorAll("optgroup")).map(group => group.label);
}

function optionLabels(group) {
    return Array.from(group.querySelectorAll("option")).map(option => option.textContent);
}

function findEditorBox(harness) {
    const removeCrop = harness.findButton("Remove crop");
    return removeCrop ? removeCrop.parentElement.parentElement : null;
}

function findEditorField(harness, labelText) {
    const editor = findEditorBox(harness);
    return Array.from(editor.querySelectorAll("label")).find(label => {
        const title = label.querySelector("span");
        return title && title.textContent.trim() === labelText;
    }) || null;
}

function findYearPlanField(document, field, filters = {}) {
    const controls = Array.from(document.querySelectorAll(`[data-year-plan-field="${field}"]`));
    return controls.find(control => Object.entries(filters).every(([key, value]) => String(control.dataset[key] || "") === String(value))) || null;
}

function openDiagnostics(document, labelPattern) {
    const triggers = Array.from(document.querySelectorAll(".yp-diagnostics-trigger"));
    const trigger = triggers.find(button => labelPattern.test(button.getAttribute("aria-label") || button.parentElement.textContent));
    assert.ok(trigger);
    const popover = trigger.parentElement.querySelector(".yp-diagnostics-popover");
    assert.ok(popover);
    if (popover.hidden) trigger.click();
    assert.equal(popover.hidden, false);
    return { trigger, popover };
}

function clickDiagnosticItem(popover, messagePattern) {
    const item = Array.from(popover.querySelectorAll(".yp-diagnostics-item")).find(button => messagePattern.test(button.textContent));
    assert.ok(item);
    item.click();
    return item;
}

function chartLegendButtons(document) {
    return Array.from(document.querySelectorAll(".yp-chart-legend-item"));
}

function canvasAxisLabels(canvas) {
    return (canvas.__canvasOperations || [])
        .filter(operation => operation.method === "fillText" && / kg$/.test(operation.text))
        .map(operation => operation.text);
}

function planHero(document) {
    const hero = document.querySelector(".yp-plan-hero");
    assert.ok(hero);
    return hero;
}

function heroKpiTiles(document) {
    return Array.from(planHero(document).querySelectorAll(".yp-kpi-tile"));
}

function heroKpiLabels(document) {
    return heroKpiTiles(document).map(tile => tile.querySelector(".yp-kpi-label").textContent);
}

function attentionStrip(document) {
    const strip = document.querySelector(".yp-attention-strip");
    assert.ok(strip);
    return strip;
}

function assertHeroOverviewOnly(document) {
    const hero = planHero(document);
    const overviewText = [".yp-plan-hero-head", ".yp-kpi-grid"].map(selector => hero.querySelector(selector).textContent).join("");
    assert.equal(heroKpiTiles(document).length, 4);
    assert.deepEqual(heroKpiLabels(document), ["Crops", "Target", "Usable supply", "Total revenue"]);
    assert.doesNotMatch(overviewText, /Plan Health|Worst shortage|Short weeks|Expired/);
}

function yearPlannerStyleText(document) {
    const style = document.querySelector(".yp-modal-card style");
    assert.ok(style);
    return style.textContent.replace(/\s+/g, " ");
}

test("modal renders four ordered strips with the expected defaults and crop tabs", async t => {
    const harness = createYearPlannerHarness();
    t.after(() => harness.dom.window.close());
    savePlan(harness, 2026);

    await harness.openModal(2026);

    assert.equal(Number(harness.document.body.firstElementChild.style.zIndex), 2000000000);
    assert.match(planHero(harness.document).textContent, /2026 Year Plan/);
    const tabLabels = Array.from(harness.document.querySelectorAll("button"))
        .map(button => button.textContent.trim())
        .filter(label => ["Basics", "Packages", "Advanced"].includes(label));
    assert.deepEqual(tabLabels, ["Basics", "Packages"]);
    const strips = Array.from(harness.document.querySelectorAll("[data-year-plan-strip]"));
    assert.deepEqual(strips.map(strip => strip.dataset.yearPlanStrip), ["crop-plan", "demand", "csa", "plan-check"]);
    assert.deepEqual(strips.map(strip => strip.querySelector(".yp-strip-title").textContent), ["Crop Plan", "Demand", "CSA", "Plan Check"]);
    assert.doesNotMatch(harness.document.body.textContent, /Diagnostics/);

    const csaStrip = findCsaStrip(harness.document);
    assert.ok(csaStrip);
    assert.match(csaStrip.textContent, /Status\s*Off/);
    assert.equal(csaStrip.getAttribute("aria-expanded"), "false");
    assert.equal(findStripHeader(harness.document, "demand").getAttribute("aria-expanded"), "true");
    assert.equal(findStripHeader(harness.document, "crop-plan").getAttribute("aria-expanded"), "true");
    assert.equal(findStripHeader(harness.document, "plan-check").getAttribute("aria-expanded"), "false");
    const styleText = yearPlannerStyleText(harness.document);
    assert.match(styleText, /\.yp-dashboard-grid\{display:grid;grid-template-columns:minmax\(340px,32%\) minmax\(0,1fr\)/);
    assert.match(styleText, /\.yp-strip-header\{box-sizing:border-box;display:flex;[^}]*padding:9px 12px 9px 10px/);
    assert.match(styleText, /\.yp-strip-toggle\{[^}]*white-space:nowrap/);
    assert.match(styleText, /\.yp-crop-card-top\{[^}]*flex-wrap:wrap/);
    assert.match(styleText, /\.yp-crop-card \.yp-chip\{white-space:normal;overflow-wrap:anywhere\}/);
    const cropPlanToggle = findStripHeader(harness.document, "crop-plan").querySelector(".yp-strip-toggle");
    assert.equal(cropPlanToggle.textContent, "Collapse");
    assert.equal(cropPlanToggle.children.length, 0);
    assert.equal(harness.findButton("Add component"), null);
});

test("Crop Plan Basics separates editable controls, derived totals, tooltips, and yield reset", async t => {
    const harness = createYearPlannerHarness({
        methods: [
            { method_id: "direct_sow.field", method_name: "Direct sow", method_category_id: "direct_sow" },
            { method_id: "transplant.field", method_name: "Transplant", method_category_id: "transplant" }
        ]
    });
    t.after(() => harness.dom.window.close());
    savePlan(harness, 2026, plan => { addDemand(plan, { qty: 5 }); });
    const session = await harness.openModal(2026);
    await harness.settle(10);

    let editor = findEditorBox(harness);
    assert.equal(harness.findButton("Advanced"), null);
    assert.doesNotMatch(editor.textContent, /Crop ID|Plant ID|Variety ID|Yield override state/);
    assert.ok(findEditorField(harness, "Planting method"));

    const useActual = Array.from(editor.querySelectorAll("label.yp-row")).find(label => label.textContent.includes("Use actual harvest"));
    const syncHarvest = Array.from(editor.querySelectorAll("label.yp-row")).find(label => label.textContent.includes("Sync demand to harvest window"));
    assert.match(useActual.title, /actual harvest records/);
    assert.match(syncHarvest.title, /matching demand and CSA dates/);

    const method = findEditorField(harness, "Planting method").querySelector("select");
    assert.equal(method.value, "direct_sow.field");
    method.value = "transplant.field";
    method.dispatchEvent(new harness.window.Event("change", { bubbles: true }));
    assert.equal(session.plan.crops[0].method, "transplant.field");

    const totals = editor.querySelector(".yp-derived-totals");
    assert.ok(totals);
    assert.deepEqual(Array.from(totals.querySelectorAll(".yp-derived-label")).map(label => label.textContent), ["Actual plants", "Plants required", "Seeds required"]);
    assert.deepEqual(Array.from(totals.querySelectorAll(".yp-derived-value")).map(value => value.textContent), ["0", "5", "7"]);
    assert.match(editor.querySelector(".yp-harvest-empty").textContent, /No actual harvest recorded/);

    let kgField = findEditorField(harness, "kg/plant");
    assert.match(kgField.querySelector(".yp-yield-hint").textContent, /Using 1 kg\/plant default/);
    harness.setControlValue(kgField.querySelector('input[type="number"]'), 2);
    await harness.settle(130);
    editor = findEditorBox(harness);
    assert.deepEqual(Array.from(editor.querySelectorAll(".yp-derived-value")).map(value => value.textContent), ["0", "3", "4"]);
    kgField = findEditorField(harness, "kg/plant");
    assert.match(kgField.querySelector(".yp-yield-hint").textContent, /Manual override/);
    kgField.querySelector("button").click();
    await harness.settle(10);
    kgField = findEditorField(harness, "kg/plant");
    assert.equal(kgField.querySelector('input[type="number"]').value, "1");
    assert.match(kgField.querySelector(".yp-yield-hint").textContent, /Using 1 kg\/plant default/);
});

test("Basics actual harvest timeline renders diagram-backed weekly harvest", async t => {
    const harness = createYearPlannerHarness();
    t.after(() => harness.dom.window.close());
    harness.addCell(harness.moduleCell, new harness.TestCell("actual-harvest", { tiler_group: "1", plant_id: "1", plant_name: "Tomato", plant_count: "12", season_start_year: "2026", harvest_start: "2026-07-01", harvest_end: "2026-07-21" }));
    savePlan(harness, 2026, plan => { plan.crops[0].useActualHarvest = true; });
    await harness.openModal(2026);
    await harness.settle(10);

    const editor = findEditorBox(harness);
    const totals = editor.querySelector(".yp-derived-totals");
    assert.equal(Array.from(totals.querySelectorAll(".yp-derived-value"))[0].textContent, "12");
    const timeline = editor.querySelector(".yp-harvest-timeline");
    assert.ok(timeline);
    assert.ok(timeline.querySelectorAll(".yp-harvest-bar").length >= 52);
    assert.ok(Array.from(timeline.querySelectorAll(".yp-harvest-bar")).some(bar => /kg actual harvest/.test(bar.title) && !/0\.00 kg/.test(bar.title)));
});

test("Packages render labeled compact package rows", async t => {
    const harness = createYearPlannerHarness();
    t.after(() => harness.dom.window.close());
    savePlan(harness, 2026);
    await harness.openModal(2026);
    harness.findButton("Packages").click();

    const editor = findEditorBox(harness);
    const row = editor.querySelector(".yp-package-row");
    assert.ok(row);
    assert.deepEqual(Array.from(row.querySelectorAll(".yp-package-title")).map(title => title.textContent), ["Unit", "Quantity", "Base", "Price"]);
    assert.equal(editor.querySelector(".yp-package-line"), null);
});

test("empty plans show Demand and Crop Plan guidance", async t => {
    const harness = createYearPlannerHarness();
    t.after(() => harness.dom.window.close());
    await harness.openModal(2026);

    assertHeroOverviewOnly(harness.document);
    assert.equal(attentionStrip(harness.document).style.display, "none");
    assert.match(findStripDetails(harness.document, "demand").textContent, /No demand lines in this channel/);
    assert.match(findStripDetails(harness.document, "crop-plan").textContent, /Add or select a crop to edit its plan/);
    assert.match(findStripHeader(harness.document, "demand").textContent, /Channels\s*4.*Lines\s*0/);
    assert.match(findStripHeader(harness.document, "crop-plan").textContent, /Crops\s*0.*No crop selected/);
});

test("hero stays overview-only for clean and unsaved clean plans", async t => {
    const harness = createYearPlannerHarness();
    t.after(() => harness.dom.window.close());
    savePlan(harness, 2026);
    await harness.openModal(2026);

    assertHeroOverviewOnly(harness.document);
    assert.match(planHero(harness.document).textContent, /Status\s*OK/);
    assert.doesNotMatch(planHero(harness.document).textContent, /Unsaved/);
    assert.equal(attentionStrip(harness.document).style.display, "none");

    const kgInput = Array.from(harness.document.querySelectorAll("label")).find(label => label.textContent.includes("kg/plant")).querySelector('input[type="number"]');
    harness.setControlValue(kgInput, 1.5);
    await harness.settle(130);

    assertHeroOverviewOnly(harness.document);
    assert.match(planHero(harness.document).textContent, /Unsaved/);
    assert.equal(attentionStrip(harness.document).style.display, "none");
});

test("Needs attention surfaces problems while the hero remains simple", async t => {
    const scenarios = [
        {
            name: "shortage",
            configure: plan => addDemand(plan, { qty: 20 }),
            expected: /Tomato short/
        },
        {
            name: "expired harvest",
            setup: harness => harness.addCell(harness.moduleCell, new harness.TestCell("expired-harvest", { tiler_group: "1", plant_id: "1", plant_name: "Tomato", plant_count: "10", season_start_year: "2026", harvest_start: "2026-01-05", harvest_end: "2026-01-11" })),
            configure: plan => { plan.crops[0].useActualHarvest = false; plan.crops[0].harvestStart = "2026-01-05"; plan.crops[0].harvestEnd = "2026-01-11"; addDemand(plan, { from: "2026-01-12", to: "2026-01-18" }); },
            expected: /Expired/
        },
        {
            name: "missing crop data",
            configure: plan => { plan.crops[0].plantId = ""; addDemand(plan); },
            expected: /Tomato missing data/
        },
        {
            name: "invalid demand dates",
            configure: plan => addDemand(plan, { from: "2026-07-01", to: "2026-06-01" }),
            expected: /Demand dates invalid/
        },
        {
            name: "CSA errors",
            configure: plan => { plan.csa.enabled = true; plan.csa.boxesPerWeek = 0; },
            expected: /CSA setup issues/
        }
    ];

    for (const scenario of scenarios) {
        const harness = createYearPlannerHarness();
        t.after(() => harness.dom.window.close());
        if (scenario.setup) scenario.setup(harness);
        savePlan(harness, 2026, scenario.configure);
        await harness.openModal(2026);

        assertHeroOverviewOnly(harness.document);
        assert.equal(attentionStrip(harness.document).style.display, "block", scenario.name);
        assert.match(attentionStrip(harness.document).textContent, scenario.expected, scenario.name);
    }
});

test("crop diagnostics popover navigates to invalid basics and package fields", async t => {
    const harness = createYearPlannerHarness();
    t.after(() => harness.dom.window.close());
    savePlan(harness, 2026, plan => {
        plan.crops[0].kgPerPlant = 0;
        plan.crops[0].baseKgPerPlant = null;
        plan.crops[0].packages[0].baseQty = 0;
        addDemand(plan);
    });
    await harness.openModal(2026);

    let diagnostics = openDiagnostics(harness.document, /Tomato diagnostics/);
    assert.match(diagnostics.popover.textContent, /Enter kg\/plant greater than 0/);
    assert.match(diagnostics.popover.textContent, /Enter package quantity greater than 0/);
    clickDiagnosticItem(diagnostics.popover, /kg\/plant/);
    assert.equal(harness.document.activeElement, findYearPlanField(harness.document, "kgPerPlant", { cropId: "crop_1" }));

    diagnostics = openDiagnostics(harness.document, /Tomato diagnostics/);
    clickDiagnosticItem(diagnostics.popover, /package quantity/);
    assert.ok(harness.findButton("Basics"));
    assert.equal(harness.document.activeElement, findYearPlanField(harness.document, "baseQty", { cropId: "crop_1", packageIndex: "0" }));
});

test("duplicate crop identity diagnostics attach to the second crop and focus variety", async t => {
    const harness = createYearPlannerHarness();
    t.after(() => harness.dom.window.close());
    savePlan(harness, 2026, plan => {
        plan.crops.push(makePlanCrop({ id: "crop_2" }));
    });
    await harness.openModal(2026);
    setStripExpanded(harness.document, "plan-check", true);

    assert.equal(findCropCardById(harness.document, "crop_1").querySelector(".yp-diagnostics-trigger"), null);
    assert.ok(findCropCardById(harness.document, "crop_2").querySelector(".yp-diagnostics-trigger"));
    const cropRows = findStripDetails(harness.document, "plan-check").querySelectorAll("table:first-of-type tbody tr");
    const statusColumn = planCheckTotalsColumnIndex(harness.document, "Status");
    assert.equal(cropRows[0].cells[statusColumn].querySelector(".yp-diagnostics-trigger"), null);
    assert.ok(cropRows[1].cells[statusColumn].querySelector(".yp-diagnostics-trigger"));

    findCropCardById(harness.document, "crop_2").click();
    await harness.settle(10);
    const diagnostics = openDiagnostics(harness.document, /Tomato diagnostics/);
    assert.match(diagnostics.popover.textContent, /Each plant\/variety can appear only once/);
    clickDiagnosticItem(diagnostics.popover, /plant\/variety/);
    assert.equal(findCropCardById(harness.document, "crop_2").dataset.selected, "true");
    assert.equal(harness.document.activeElement, findYearPlanField(harness.document, "varietyId", { cropId: "crop_2" }));
});

test("missing plant diagnostics fall back to the trigger instead of disabled Plant", async t => {
    const harness = createYearPlannerHarness();
    t.after(() => harness.dom.window.close());
    savePlan(harness, 2026, plan => {
        plan.crops[0].id = "crop_missing";
        plan.crops[0].plantId = "";
        plan.crops[0].plant = "";
    });
    await harness.openModal(2026);

    const diagnostics = openDiagnostics(harness.document, /crop_missing diagnostics/);
    clickDiagnosticItem(diagnostics.popover, /Choose a plant/);
    assert.equal(findStripHeader(harness.document, "crop-plan").getAttribute("aria-expanded"), "true");
    assert.equal(findYearPlanField(harness.document, "plantId", { cropId: "crop_missing" }).disabled, true);
    assert.equal(harness.document.activeElement, diagnostics.trigger);
});

test("CSA diagnostics popover navigates to global and component fields", async t => {
    const scenarios = [
        {
            name: "boxes",
            configure: plan => { plan.csa.enabled = true; plan.csa.boxesPerWeek = 0; },
            message: /boxes\/week/,
            field: "boxesPerWeek",
            filters: {}
        },
        {
            name: "component dates",
            configure: plan => { plan.crops[0].harvestStart = ""; plan.crops[0].harvestEnd = ""; plan.csa.enabled = true; plan.csa.boxesPerWeek = 10; plan.csa.components = [{ cropId: "crop_1", qty: 1, unit: "kg", everyNWeeks: 1, start: "", end: "" }]; },
            message: /component dates/,
            field: "start",
            filters: { csaComponentIndex: "0" }
        },
        {
            name: "unit",
            configure: plan => { plan.csa.enabled = true; plan.csa.boxesPerWeek = 10; plan.csa.start = "2026-06-01"; plan.csa.end = "2026-06-07"; plan.csa.components = [{ cropId: "crop_1", qty: 1, unit: "crate", everyNWeeks: 1, start: "2026-06-01", end: "2026-06-07" }]; },
            message: /valid CSA unit/,
            field: "unit",
            filters: { csaComponentIndex: "0" }
        },
        {
            name: "missing crop",
            configure: plan => { plan.csa.enabled = true; plan.csa.boxesPerWeek = 10; plan.csa.components = [{ cropId: "missing_crop", qty: 1, unit: "kg", everyNWeeks: 1, start: "2026-06-01", end: "2026-06-07" }]; },
            message: /Choose a crop/,
            field: "cropId",
            filters: { csaComponentIndex: "0" }
        }
    ];

    for (const scenario of scenarios) {
        const harness = createYearPlannerHarness();
        t.after(() => harness.dom.window.close());
        savePlan(harness, 2026, scenario.configure);
        await harness.openModal(2026);
        const diagnostics = openDiagnostics(harness.document, /CSA setup issues/);
        clickDiagnosticItem(diagnostics.popover, scenario.message);
        assert.equal(findStripHeader(harness.document, "csa").getAttribute("aria-expanded"), "true", scenario.name);
        assert.equal(harness.document.activeElement, findYearPlanField(harness.document, scenario.field, scenario.filters), scenario.name);
    }
});

test("save failure focuses diagnostics trigger and unavailable actual harvest is disabled", async t => {
    const harness = createYearPlannerHarness();
    t.after(() => harness.dom.window.close());
    const saved = savePlan(harness, 2026, plan => {
        plan.crops[0].kgPerPlant = 0;
        plan.crops[0].baseKgPerPlant = null;
        plan.crops[0].useActualHarvest = true;
        addDemand(plan);
    });
    const session = await harness.openModal(2026);
    const useActual = findYearPlanField(harness.document, "useActualHarvest", { cropId: "crop_1" });
    assert.equal(useActual.disabled, true);
    assert.equal(useActual.checked, false);
    assert.equal(session.plan.crops[0].useActualHarvest, false);

    harness.findButton("Save").click();
    assert.match(harness.document.body.textContent, /Validation failed/);
    assert.ok(harness.document.activeElement.classList.contains("yp-diagnostics-trigger"));
    assert.equal(saved.crops[0].useActualHarvest, true);
});

test("strip expansion survives year changes, template application, and clearing", async t => {
    const harness = createYearPlannerHarness();
    t.after(() => harness.dom.window.close());
    savePlan(harness, 2026);
    const template = harness.api.PlanSchema.serializeForPersistence(harness.api.PlanSchema.createEmptyPlan(2026), { forTemplate: true });
    template.templateBaseYear = 2026;
    template.year = null;
    harness.api.PlanRepository.saveTemplateByName("Empty layout", template);
    await harness.openModal(2026);

    setStripExpanded(harness.document, "csa", true);
    setStripExpanded(harness.document, "demand", false);
    setStripExpanded(harness.document, "crop-plan", false);
    setStripExpanded(harness.document, "plan-check", true);
    const assertLayout = () => assert.deepEqual(
        ["csa", "demand", "crop-plan", "plan-check"].map(id => findStripHeader(harness.document, id).getAttribute("aria-expanded")),
        ["true", "false", "false", "true"]
    );

    const yearInput = Array.from(harness.document.querySelectorAll('input[type="number"]')).find(input => input.value === "2026");
    harness.setControlValue(yearInput, 2027, "change");
    assertLayout();

    const templateSelect = Array.from(harness.document.querySelectorAll("select")).find(select =>
        Array.from(select.options).some(option => option.textContent === "Empty layout")
    );
    templateSelect.value = "Empty layout";
    harness.findButton("Apply template").click();
    assertLayout();

    harness.findButton("Clear").click();
    assertLayout();
});

test("debounced Demand typing preserves the focused control", async t => {
    const harness = createYearPlannerHarness();
    t.after(() => harness.dom.window.close());
    savePlan(harness, 2026, plan => {
        addDemand(plan);
    });
    const session = await harness.openModal(2026);
    const qty = findStripDetails(harness.document, "demand").querySelector('input[type="number"]');
    qty.focus();
    harness.setControlValue(qty, 7);
    await harness.settle(130);

    assert.equal(harness.document.activeElement, qty);
    assert.equal(qty.isConnected, true);
    assert.equal(qty.value, "7");
    assert.equal(session.plan.demands[0].qty, 7);
});

test("Demand channels support editing, collapse state, safe removal, and labeled line controls", async t => {
    const harness = createYearPlannerHarness();
    t.after(() => harness.dom.window.close());
    savePlan(harness, 2026, plan => { plan.crops[0].packages[0].price = 2; addDemand(plan, { qty: 5, price: 99 }); });
    const session = await harness.openModal(2026);
    const demandDetails = findStripDetails(harness.document, "demand");
    let channels = demandDetails.querySelectorAll("[data-demand-channel-id]");
    assert.equal(channels.length, 4);
    assert.match(channels[0].textContent, /Demand 5\.0 kg.*Potential \$10\.00.*Fulfilled \$0\.00/);
    assert.match(channels[0].textContent, /Crop.*Qty.*Unit.*Frequency.*Every.*From.*To.*Priority.*Price.*Notes.*Remove/);
    assert.equal(Array.from(channels[0].querySelectorAll("button")).find(button => button.textContent === "Remove channel").disabled, true);

    Array.from(channels[0].querySelectorAll("button")).find(button => button.textContent === "Collapse").click();
    channels = demandDetails.querySelectorAll("[data-demand-channel-id]");
    assert.equal(channels[0].querySelector(".yp-demand-channel-details").style.display, "none");
    assert.equal("collapsedDemandChannelIds" in session.plan, false);

    const emptyRemove = Array.from(channels[1].querySelectorAll("button")).find(button => button.textContent === "Remove channel");
    assert.equal(emptyRemove.disabled, false);
    emptyRemove.click();
    assert.equal(session.plan.demandChannels.length, 3);
    harness.findButton("Add channel").click();
    assert.equal(session.plan.demandChannels.length, 4);
    channels = findStripDetails(harness.document, "demand").querySelectorAll("[data-demand-channel-id]");
    const added = channels[channels.length - 1];
    const name = added.querySelector('input[aria-label="Channel name"]');
    harness.setControlValue(name, "Chef Pickup");
    await harness.settle(120);
    assert.equal(session.plan.demandChannels.at(-1).label, "Chef Pickup");
    const type = added.querySelector('select[aria-label="Channel type"]');
    type.value = "restaurant";
    type.dispatchEvent(new harness.window.Event("change", { bubbles: true }));
    assert.equal(session.plan.demandChannels.at(-1).type, "restaurant");
    Array.from(added.querySelectorAll("button")).find(button => button.textContent === "Add demand line").click();
    assert.equal(session.plan.demands.length, 2);
    assert.equal(session.plan.demands.at(-1).channelId, session.plan.demandChannels.at(-1).id);
});

test("Demand price is read-only and follows matching package price edits", async t => {
    const harness = createYearPlannerHarness();
    t.after(() => harness.dom.window.close());
    savePlan(harness, 2026, plan => { plan.crops[0].packages[0].price = 2; addDemand(plan, { qty: 5, price: 99 }); });
    const session = await harness.openModal(2026);
    let demandPrice = findDemandPriceInput(harness.document);
    assert.ok(demandPrice);
    assert.equal(demandPrice.readOnly, true);
    assert.equal(demandPrice.value, "2");

    harness.setControlValue(demandPrice, 123);
    await harness.settle(120);
    assert.equal(Object.prototype.hasOwnProperty.call(session.plan.demands[0], "price"), false);

    harness.findButton("Packages").click();
    const packageNumbers = findEditorBox(harness).querySelectorAll('input[type="number"]');
    harness.setControlValue(packageNumbers[1], 4);
    await harness.settle(130);

    demandPrice = findDemandPriceInput(harness.document);
    assert.equal(demandPrice.readOnly, true);
    assert.equal(demandPrice.value, "4");
    assert.match(findStripHeader(harness.document, "demand").textContent, /Potential\s*\$20\.00/);
});

test("Demand quantity edits update visible sales and total revenue", async t => {
    const harness = createYearPlannerHarness();
    t.after(() => harness.dom.window.close());
    harness.addCell(harness.moduleCell, new harness.TestCell("tomato-sales", { tiler_group: "1", plant_id: "1", plant_name: "Tomato", plant_count: "10", season_start_year: "2026", harvest_start: "2026-06-01", harvest_end: "2026-06-07" }));
    savePlan(harness, 2026, plan => { plan.crops[0].harvestStart = "2026-06-01"; plan.crops[0].harvestEnd = "2026-06-07"; plan.crops[0].packages[0].price = 2; addDemand(plan, { qty: 2 }); });
    const session = await harness.openModal(2026);

    assert.match(findKpiText(harness.document, "Total revenue"), /\$4\.00/);
    assert.match(findStripHeader(harness.document, "demand").textContent, /Potential\s*\$4\.00.*Fulfilled\s*\$4\.00/);
    const qty = findStripDetails(harness.document, "demand").querySelector("[data-demand-line-id] input[type='number']");
    harness.setControlValue(qty, 4);
    await harness.settle(130);

    assert.equal(session.plan.demands[0].qty, 4);
    assert.match(findKpiText(harness.document, "Total revenue"), /\$8\.00/);
    assert.match(findStripHeader(harness.document, "demand").textContent, /Potential\s*\$8\.00.*Fulfilled\s*\$8\.00/);
});

test("CSA box pricing updates component value, sale value, reset, and total revenue", async t => {
    const harness = createYearPlannerHarness();
    t.after(() => harness.dom.window.close());
    harness.addCell(harness.moduleCell, new harness.TestCell("tomato-csa", { tiler_group: "1", plant_id: "1", plant_name: "Tomato", plant_count: "10", season_start_year: "2026", harvest_start: "2026-06-01", harvest_end: "2026-06-07" }));
    savePlan(harness, 2026, plan => { plan.crops[0].harvestStart = "2026-06-01"; plan.crops[0].harvestEnd = "2026-06-07"; plan.crops[0].packages[0].price = 2; addDemand(plan, { qty: 9 }); });
    const session = await harness.openModal(2026);
    findCsaStrip(harness.document).click();

    const enabled = findYearPlanField(harness.document, "enabled");
    enabled.checked = true;
    enabled.dispatchEvent(new harness.window.Event("change", { bubbles: true }));
    harness.setControlValue(findYearPlanField(harness.document, "boxesPerWeek"), 1);
    harness.setControlValue(findYearPlanField(harness.document, "start"), "2026-06-01", "change");
    harness.setControlValue(findYearPlanField(harness.document, "end"), "2026-06-07", "change");
    harness.findButton("Add component").click();
    await harness.settle(130);

    assert.equal(findYearPlanField(harness.document, "componentValuePerBox").value, "2.00");
    assert.equal(findYearPlanField(harness.document, "salePricePerBox").value, "2.00");
    assert.match(findKpiText(harness.document, "Total revenue"), /\$20\.00/);
    assert.match(findStripHeader(harness.document, "csa").textContent, /Component value\s*\$2\.00.*Sale value\s*\$2\.00.*Potential\s*\$2\.00.*Fulfilled\s*\$2\.00/);

    const sale = findYearPlanField(harness.document, "salePricePerBox");
    harness.setControlValue(sale, 5);
    await harness.settle(130);
    assert.equal(session.plan.csa.salePriceMode, "manual");
    assert.match(findKpiText(harness.document, "Total revenue"), /\$23\.00/);

    Array.from(findStripDetails(harness.document, "csa").querySelectorAll("button")).find(button => button.textContent === "Reset").click();
    await harness.settle(130);
    assert.equal(session.plan.csa.salePriceMode, "auto");
    assert.equal(findYearPlanField(harness.document, "salePricePerBox").value, "2.00");
    assert.match(findKpiText(harness.document, "Total revenue"), /\$20\.00/);

    harness.findButton("Packages").click();
    harness.setControlValue(findYearPlanField(harness.document, "price", { cropId: "crop_1", packageIndex: "0" }), 4);
    await harness.settle(130);
    assert.equal(findDemandPriceInput(harness.document).value, "4");
    assert.equal(findYearPlanField(harness.document, "componentValuePerBox").value, "4.00");
    assert.equal(findYearPlanField(harness.document, "salePricePerBox").value, "4.00");
    assert.match(findKpiText(harness.document, "Total revenue"), /\$40\.00/);
});

test("Add crop prioritizes garden crops and groups remaining plants by lifecycle", async t => {
    const harness = createYearPlannerHarness({
        plants: [
            { plant_id: 1, plant_name: "Tomato", yield_per_plant_kg: 1, default_planting_method: "direct_sow.field", annual: 1, biennial: 0, perennial: 0 },
            { plant_id: 2, plant_name: "Asparagus", yield_per_plant_kg: 0.2, default_planting_method: "transplant.field", annual: 0, biennial: 0, perennial: 1 },
            { plant_id: 3, plant_name: "Beet", yield_per_plant_kg: 0.3, default_planting_method: "direct_sow.field", annual: 0, biennial: 1, perennial: 0 },
            { plant_id: 4, plant_name: "Mystery", yield_per_plant_kg: 0.4, default_planting_method: "direct_sow.field", annual: 0, biennial: 0, perennial: 0 },
            { plant_id: 5, plant_name: "Basil", yield_per_plant_kg: 0.1, default_planting_method: "transplant.field", annual: 1, biennial: 0, perennial: 0 },
            { plant_id: 6, plant_name: "Conflicted", yield_per_plant_kg: 0.5, default_planting_method: "direct_sow.field", annual: 1, biennial: 1, perennial: 0 }
        ]
    });
    t.after(() => harness.dom.window.close());
    harness.addCell(harness.moduleCell, new harness.TestCell("tomato-a", { tiler_group: "1", plant_id: "1", plant_name: "Tomato" }));
    harness.addCell(harness.moduleCell, new harness.TestCell("tomato-b", { tiler_group: "1", plant_id: "1", plant_name: "Tomato" }));

    await harness.openModal(2026);
    await harness.settle(10);

    const select = findAddCropSelect(harness.document);
    assert.ok(select);
    assert.deepEqual(optionGroupLabels(select), [
        "Crops in this garden, not yet in plan",
        "Annual crops",
        "Biennial crops",
        "Perennial crops",
        "Uncategorized crops"
    ]);
    const groups = Array.from(select.querySelectorAll("optgroup"));
    assert.deepEqual(optionLabels(groups[0]), ["Tomato"]);
    assert.deepEqual(optionLabels(groups[1]), ["Basil"]);
    assert.deepEqual(optionLabels(groups[2]), ["Beet"]);
    assert.deepEqual(optionLabels(groups[3]), ["Asparagus"]);
    assert.deepEqual(optionLabels(groups[4]), ["Conflicted", "Mystery"]);
});

test("Garden variety resolution preserves identity, applies yield override, and refreshes after add and remove", async t => {
    const harness = createYearPlannerHarness({
        plants: [{ plant_id: 1, plant_name: "Tomato", yield_per_plant_kg: 1, default_planting_method: "direct_sow.field", annual: 1, biennial: 0, perennial: 0 }],
        varietiesByPlantId: {
            "1": [{ variety_id: 10, plant_id: 1, variety_name: "Roma", overrides_json: JSON.stringify({ yield_per_plant_kg: 2.5 }) }]
        }
    });
    t.after(() => harness.dom.window.close());
    harness.addCell(harness.moduleCell, new harness.TestCell("roma-a", { tiler_group: "1", plant_id: "1", plant_name: "Tomato", variety_name: " roma " }));
    harness.addCell(harness.moduleCell, new harness.TestCell("roma-b", { tiler_group: "1", plant_id: "1", plant_name: "Tomato", variety_name: "Roma" }));

    const session = await harness.openModal(2026);
    await harness.settle(10);
    let select = findAddCropSelect(harness.document);
    let gardenGroup = Array.from(select.querySelectorAll("optgroup")).find(group => group.label.startsWith("Crops in this garden"));
    assert.deepEqual(optionLabels(gardenGroup), ["Tomato - Roma"]);

    select.value = gardenGroup.querySelector("option").value;
    harness.findButton("Add crop").click();
    await harness.settle(10);
    assert.equal(session.plan.crops.length, 1);
    assert.equal(session.plan.crops[0].varietyId, 10);
    assert.equal(session.plan.crops[0].variety, "Roma");
    assert.equal(session.plan.crops[0].baseKgPerPlant, 1);
    assert.equal(session.plan.crops[0].kgPerPlant, 2.5);

    select = findAddCropSelect(harness.document);
    assert.equal(Array.from(select.querySelectorAll("optgroup")).some(group => group.label.startsWith("Crops in this garden")), false);
    assert.deepEqual(optionLabels(Array.from(select.querySelectorAll("optgroup")).find(group => group.label === "Annual crops")), ["Tomato"]);

    harness.findButton("Remove crop").click();
    await harness.settle(10);
    select = findAddCropSelect(harness.document);
    gardenGroup = Array.from(select.querySelectorAll("optgroup")).find(group => group.label.startsWith("Crops in this garden"));
    assert.deepEqual(optionLabels(gardenGroup), ["Tomato - Roma"]);
});

test("Centralized Demand remains visible and removes lines with their crop", async t => {
    const harness = createYearPlannerHarness();
    t.after(() => harness.dom.window.close());
    savePlan(harness, 2026, plan => {
        addDemand(plan);
        plan.crops.push(makePlanCrop({
            id: "crop_2",
            plantId: "2",
            plant: "Carrot"
        }));
        addDemand(plan, { id: "demand_2", cropId: "crop_2", qty: 4, from: "2026-07-01", to: "2026-07-07" });
    });
    const session = await harness.openModal(2026);
    const cropPlanDetails = findStripDetails(harness.document, "crop-plan");
    const carrotButton = Array.from(cropPlanDetails.querySelectorAll(".yp-crop-card")).find(button => button.textContent.includes("Carrot"));
    carrotButton.click();

    assert.match(findStripHeader(harness.document, "demand").textContent, /Lines\s*2/);
    assert.equal(findStripDetails(harness.document, "demand").querySelectorAll("[data-demand-line-id]").length, 2);
    harness.findButton("Remove crop").click();
    assert.equal(session.plan.crops.length, 1);
    assert.equal(session.plan.demands.length, 1);
    assert.match(findStripHeader(harness.document, "demand").textContent, /Lines\s*1/);
    assert.equal(findStripDetails(harness.document, "demand").querySelector('input[type="number"]').value, "1");
});

test("crop selection syncs Crop Plan and Plan Check while preserving all-crop filter selection", async t => {
    const harness = createYearPlannerHarness();
    t.after(() => harness.dom.window.close());
    savePlan(harness, 2026, plan => {
        plan.crops.push(makePlanCrop({ id: "crop_2", plantId: "2", plant: "Carrot" }));
    });
    const session = await harness.openModal(2026);
    setStripExpanded(harness.document, "plan-check", true);

    const cropFilter = findCropFilterSelect(harness.document);
    assert.ok(cropFilter);
    assert.equal(cropFilter.value, "");

    findCropCard(harness.document, "Carrot").click();
    assert.equal(session.plan.cropFilterId, "crop_2");
    assert.equal(cropFilter.value, "crop_2");
    assert.match(findEditorBox(harness).textContent, /Carrot/);
    assert.equal(findCropCard(harness.document, "Carrot").dataset.selected, "true");

    cropFilter.value = "";
    cropFilter.dispatchEvent(new harness.window.Event("change", { bubbles: true }));
    assert.equal(session.plan.cropFilterId, "");
    assert.match(findEditorBox(harness).textContent, /Carrot/);
    assert.equal(findCropCard(harness.document, "Carrot").dataset.selected, "true");

    cropFilter.value = "crop_1";
    cropFilter.dispatchEvent(new harness.window.Event("change", { bubbles: true }));
    assert.equal(session.plan.cropFilterId, "crop_1");
    assert.match(findEditorBox(harness).textContent, /Tomato/);
    assert.equal(findCropCard(harness.document, "Tomato").dataset.selected, "true");
});

test("Needs attention crop clicks expand related strips and sync Plan Check", async t => {
    const harness = createYearPlannerHarness();
    t.after(() => harness.dom.window.close());
    savePlan(harness, 2026, plan => {
        plan.crops.push(makePlanCrop({ id: "crop_2", plantId: "2", plant: "Carrot" }));
        addDemand(plan, { id: "demand_2", cropId: "crop_2", qty: 3 });
    });
    await harness.openModal(2026);
    setStripExpanded(harness.document, "crop-plan", false);
    setStripExpanded(harness.document, "plan-check", false);

    const attentionButton = Array.from(attentionStrip(harness.document).querySelectorAll("button")).find(button => /Carrot short/.test(button.textContent));
    assert.ok(attentionButton);
    attentionButton.click();

    assert.equal(findStripHeader(harness.document, "crop-plan").getAttribute("aria-expanded"), "true");
    assert.equal(findStripHeader(harness.document, "plan-check").getAttribute("aria-expanded"), "true");
    assert.equal(findCropFilterSelect(harness.document).value, "crop_2");
    assert.match(findEditorBox(harness).textContent, /Carrot/);
});

test("crop add and remove paths keep Plan Check filter aligned with valid crop selection", async t => {
    const harness = createYearPlannerHarness();
    t.after(() => harness.dom.window.close());
    savePlan(harness, 2026, plan => {
        plan.crops.push(makePlanCrop({ id: "crop_2", plantId: "2", plant: "Carrot" }));
    });
    const session = await harness.openModal(2026);
    setStripExpanded(harness.document, "plan-check", true);

    const cropFilter = findCropFilterSelect(harness.document);
    cropFilter.value = "crop_2";
    cropFilter.dispatchEvent(new harness.window.Event("change", { bubbles: true }));
    harness.findButton("Remove crop").click();
    assert.equal(session.plan.crops.length, 1);
    assert.equal(findCropFilterSelect(harness.document).value, "crop_1");
    assert.deepEqual(planCheckTotalsCropNames(harness.document), ["Tomato"]);

    harness.findButton("Remove crop").click();
    assert.equal(session.plan.crops.length, 0);
    assert.equal(findCropFilterSelect(harness.document).value, "");
    assert.match(findStripDetails(harness.document, "crop-plan").textContent, /Add or select a crop/);
    assert.deepEqual(planCheckTotalsCropNames(harness.document), ["No crops."]);
});

test("adding a crop selects it and syncs Plan Check filter", async t => {
    const harness = createYearPlannerHarness();
    t.after(() => harness.dom.window.close());
    const plan = harness.api.PlanSchema.createEmptyPlan(2026);
    harness.api.PlanRepository.savePlanForYear(harness.moduleCell, 2026, plan);
    const session = await harness.openModal(2026);

    const select = findAddCropSelect(harness.document);
    const annualGroup = Array.from(select.querySelectorAll("optgroup")).find(group => group.label === "Annual crops");
    select.value = annualGroup.querySelector("option").value;
    harness.findButton("Add crop").click();
    await harness.settle(10);

    assert.equal(session.plan.crops.length, 1);
    assert.equal(findCropFilterSelect(harness.document).value, session.plan.crops[0].id);
    assert.match(findEditorBox(harness).textContent, /Tomato/);
});

test("Unavailable garden records are skipped while deleted persisted varieties remain selectable", async t => {
    const harness = createYearPlannerHarness({
        plants: [{ plant_id: 1, plant_name: "Tomato", yield_per_plant_kg: 1.25, default_planting_method: "direct_sow.field", annual: 1, biennial: 0, perennial: 0 }],
        varietiesByPlantId: {
            "1": [
                { variety_id: 10, plant_id: 1, variety_name: "Roma", overrides_json: null },
                { variety_id: 11, plant_id: 1, variety_name: " roma ", overrides_json: null }
            ]
        }
    });
    t.after(() => harness.dom.window.close());
    harness.addCell(harness.moduleCell, new harness.TestCell("deleted-variety", { tiler_group: "1", plant_id: "1", plant_name: "Tomato", variety_id: "99", variety_name: "Old Favorite" }));
    harness.addCell(harness.moduleCell, new harness.TestCell("ambiguous-variety", { tiler_group: "1", plant_id: "1", plant_name: "Tomato", variety_name: "Roma" }));
    harness.addCell(harness.moduleCell, new harness.TestCell("missing-plant", { tiler_group: "1", plant_id: "2", plant_name: "Missing" }));

    const session = await harness.openModal(2026);
    await harness.settle(10);
    const select = findAddCropSelect(harness.document);
    const gardenGroup = Array.from(select.querySelectorAll("optgroup")).find(group => group.label.startsWith("Crops in this garden"));
    assert.deepEqual(optionLabels(gardenGroup), ["Tomato - Old Favorite"]);
    assert.match(harness.document.body.textContent, /Skipped 2 unavailable garden crops/);

    select.value = gardenGroup.querySelector("option").value;
    harness.findButton("Add crop").click();
    await harness.settle(10);
    assert.equal(session.plan.crops[0].varietyId, 99);
    assert.equal(session.plan.crops[0].variety, "Old Favorite");
    assert.equal(session.plan.crops[0].kgPerPlant, 1.25);
});

test("Add crop options refresh after year changes, template application, and reset", async t => {
    const harness = createYearPlannerHarness();
    t.after(() => harness.dom.window.close());
    harness.addCell(harness.moduleCell, new harness.TestCell("tomato", { tiler_group: "1", plant_id: "1", plant_name: "Tomato" }));
    const savedPlan = savePlan(harness, 2026);
    const template = harness.api.PlanSchema.serializeForPersistence(savedPlan, { forTemplate: true });
    template.templateBaseYear = 2026;
    template.year = null;
    harness.api.PlanRepository.saveTemplateByName("Tomato Template", template);

    await harness.openModal(2026);
    await harness.settle(10);
    let select = findAddCropSelect(harness.document);
    assert.equal(Array.from(select.querySelectorAll("optgroup")).some(group => group.label.startsWith("Crops in this garden")), false);

    const yearInput = Array.from(harness.document.querySelectorAll('input[type="number"]')).find(input => input.value === "2026");
    harness.setControlValue(yearInput, 2027, "change");
    await harness.settle(10);
    select = findAddCropSelect(harness.document);
    assert.deepEqual(optionLabels(Array.from(select.querySelectorAll("optgroup")).find(group => group.label.startsWith("Crops in this garden"))), ["Tomato"]);

    const templateSelect = Array.from(harness.document.querySelectorAll("select")).find(candidate =>
        Array.from(candidate.options).some(option => option.textContent === "-- Select template --")
    );
    templateSelect.value = "Tomato Template";
    harness.findButton("Apply template").click();
    await harness.settle(10);
    select = findAddCropSelect(harness.document);
    assert.equal(Array.from(select.querySelectorAll("optgroup")).some(group => group.label.startsWith("Crops in this garden")), false);

    harness.findButton("Clear").click();
    await harness.settle(10);
    select = findAddCropSelect(harness.document);
    assert.deepEqual(optionLabels(Array.from(select.querySelectorAll("optgroup")).find(group => group.label.startsWith("Crops in this garden"))), ["Tomato"]);
});

test("Footer and reset action follow the currently loaded year", async t => {
    const harness = createYearPlannerHarness();
    t.after(() => harness.dom.window.close());
    savePlan(harness, 2026);
    await harness.openModal(2026);

    assert.match(harness.document.body.textContent, /Loaded saved plan/);
    assert.ok(harness.findButton("Reset"));

    const yearInput = Array.from(harness.document.querySelectorAll('input[type="number"]')).find(input => input.value === "2026");
    harness.setControlValue(yearInput, 2027, "change");
    await harness.settle(10);
    assert.match(harness.document.body.textContent, /New plan/);
    assert.ok(harness.findButton("Clear"));

    harness.findButton("Save").click();
    assert.ok(harness.findButton("Reset"));
    assert.match(harness.document.body.textContent, /Last saved/);

    harness.findButton("Reset").click();
    assert.ok(harness.findButton("Clear"));
    assert.match(harness.document.body.textContent, /New plan/);
});

test("Stale Add crop loads cannot replace newer grouped options", async t => {
    let resolveFirst;
    let resolveSecond;
    let loadCount = 0;
    const firstLoad = new Promise(resolve => { resolveFirst = resolve; });
    const secondLoad = new Promise(resolve => { resolveSecond = resolve; });
    const harness = createYearPlannerHarness({
        getPlantsBasicCached: async () => (++loadCount === 1 ? firstLoad : secondLoad)
    });
    t.after(() => harness.dom.window.close());
    const template = harness.api.PlanSchema.createEmptyPlan(2026);
    template.templateBaseYear = 2026;
    template.year = null;
    harness.api.PlanRepository.saveTemplateByName("Empty", template);

    await harness.openModal(2026);
    const templateSelect = Array.from(harness.document.querySelectorAll("select")).find(candidate =>
        Array.from(candidate.options).some(option => option.textContent === "-- Select template --")
    );
    templateSelect.value = "Empty";
    harness.findButton("Apply template").click();
    resolveSecond([{ plant_id: 2, plant_name: "Newer", yield_per_plant_kg: 1, default_planting_method: "direct_sow.field", annual: 1, biennial: 0, perennial: 0 }]);
    await harness.settle(10);
    resolveFirst([{ plant_id: 1, plant_name: "Stale", yield_per_plant_kg: 1, default_planting_method: "direct_sow.field", annual: 1, biennial: 0, perennial: 0 }]);
    await harness.settle(10);

    const select = findAddCropSelect(harness.document);
    const annualGroup = Array.from(select.querySelectorAll("optgroup")).find(group => group.label === "Annual crops");
    assert.deepEqual(optionLabels(annualGroup), ["Newer"]);
    assert.equal(select.disabled, false);
    assert.equal(harness.findButton("Add crop").disabled, false);
});

test("Plan Check summary follows the crop filter and chart hover shows inventory details", async t => {
    const harness = createYearPlannerHarness();
    t.after(() => harness.dom.window.close());
    savePlan(harness, 2026, plan => {
        addDemand(plan, { qty: 2 });
        plan.crops.push(makePlanCrop({
            id: "crop_2",
            plantId: "2",
            plant: "Carrot"
        }));
        addDemand(plan, { id: "demand_2", cropId: "crop_2", qty: 3 });
    });

    await harness.openModal(2026);
    setStripExpanded(harness.document, "plan-check", true);

    const summary = harness.document.querySelector(".yp-plan-check-summary");
    const cropFilter = findCropFilterSelect(harness.document);
    const planCheckHeaderSummary = findStripHeader(harness.document, "plan-check").querySelector(".yp-strip-summary");
    assert.ok(summary);
    assert.ok(cropFilter);
    assert.equal(planCheckHeaderSummary.textContent.trim(), "");
    assert.equal(planCheckHeaderSummary.querySelector(".yp-chip"), null);
    assert.match(summary.textContent, /Target\s*5\.0 kg/);
    assert.match(summary.textContent, /Short weeks\s*1/);
    assert.deepEqual(planCheckTotalsCropNames(harness.document), ["Tomato", "Carrot"]);
    assert.match(findStripDetails(harness.document, "plan-check").textContent, /Channels[\s\S]*Priorities[\s\S]*Shortage weeks[\s\S]*Revenue:/);

    cropFilter.value = "crop_1";
    cropFilter.dispatchEvent(new harness.window.Event("change", { bubbles: true }));
    assert.match(summary.textContent, /Target\s*2\.0 kg/);
    assert.doesNotMatch(summary.textContent, /Target\s*5\.0 kg/);
    assert.deepEqual(planCheckTotalsCropNames(harness.document), ["Tomato"]);

    const canvas = harness.document.querySelector("canvas");
    const tooltip = harness.document.querySelector(".yp-plan-chart-tooltip");
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 900, height: 240, right: 900, bottom: 240 });
    canvas.dispatchEvent(new harness.window.MouseEvent("mousemove", { bubbles: true, clientX: 60, clientY: 100 }));
    assert.equal(tooltip.style.display, "block");
    assert.match(tooltip.textContent, /Week of/);
    assert.match(tooltip.textContent, /Available:/);
    assert.match(tooltip.textContent, /Inventory:/);
    canvas.dispatchEvent(new harness.window.MouseEvent("mouseleave", { bubbles: true }));
    assert.equal(tooltip.style.display, "none");
});

test("Plan Check chart summary revenue follows crop filter and CSA value attribution", async t => {
    const harness = createYearPlannerHarness({ plants: [
        { plant_id: 1, plant_name: "Tomato", yield_per_plant_kg: 1, default_planting_method: "direct_sow.field", annual: 1, biennial: 0, perennial: 0 },
        { plant_id: 2, plant_name: "Lettuce", yield_per_plant_kg: 1, default_planting_method: "direct_sow.field", annual: 1, biennial: 0, perennial: 0 }
    ] });
    t.after(() => harness.dom.window.close());
    harness.addCell(harness.moduleCell, new harness.TestCell("tomato-supply", { tiler_group: "1", plant_id: "1", plant_name: "Tomato", plant_count: "10", season_start_year: "2026", harvest_start: "2026-06-01", harvest_end: "2026-06-07" }));
    harness.addCell(harness.moduleCell, new harness.TestCell("lettuce-supply", { tiler_group: "1", plant_id: "2", plant_name: "Lettuce", plant_count: "1", season_start_year: "2026", harvest_start: "2026-06-01", harvest_end: "2026-06-07" }));
    savePlan(harness, 2026, plan => {
        Object.assign(plan.crops[0], { actualPlants: 10, harvestStart: "2026-06-01", harvestEnd: "2026-06-07", packages: [{ unit: "kg", baseType: "kg", baseQty: 1, price: 5 }] });
        plan.crops.push(makePlanCrop({ id: "crop_2", plantId: "2", plant: "Lettuce", actualPlants: 1, harvestStart: "2026-06-01", harvestEnd: "2026-06-07", packages: [{ unit: "kg", baseType: "kg", baseQty: 1, price: 3 }] }));
        addDemand(plan, { cropId: "crop_1", qty: 10, unit: "kg", from: "2026-06-01", to: "2026-06-07" });
        plan.csa.enabled = true;
        plan.csa.boxesPerWeek = 2;
        plan.csa.start = "2026-06-01";
        plan.csa.end = "2026-06-07";
        plan.csa.salePriceMode = "auto";
        plan.csa.salePricePerBox = 0;
        plan.csa.components = [
            { cropId: "crop_1", qty: 1, unit: "kg", everyNWeeks: 1, start: "", end: "" },
            { cropId: "crop_2", qty: 1, unit: "kg", everyNWeeks: 1, start: "", end: "" }
        ];
    });

    await harness.openModal(2026);
    setStripExpanded(harness.document, "plan-check", true);
    const summary = harness.document.querySelector(".yp-plan-check-summary");
    const cropFilter = findCropFilterSelect(harness.document);
    assert.ok(summary);
    assert.ok(cropFilter);
    assert.match(summary.textContent, /Total potential\s*\$66\.00/);
    assert.match(summary.textContent, /Total fulfilled\s*\$48\.00/);
    assert.deepEqual(planCheckTotalsRows(harness.document).map(row => [row.Crop, row.Potential, row.Fulfilled]), [["Tomato", "$60.00", "$45.00"], ["Lettuce", "$6.00", "$3.00"]]);

    cropFilter.value = "crop_1";
    cropFilter.dispatchEvent(new harness.window.Event("change", { bubbles: true }));
    assert.match(summary.textContent, /Total potential\s*\$60\.00/);
    assert.match(summary.textContent, /Total fulfilled\s*\$45\.00/);
    assert.deepEqual(planCheckTotalsRows(harness.document).map(row => [row.Crop, row.Potential, row.Fulfilled]), [["Tomato", "$60.00", "$45.00"]]);

    cropFilter.value = "crop_2";
    cropFilter.dispatchEvent(new harness.window.Event("change", { bubbles: true }));
    assert.match(summary.textContent, /Total potential\s*\$6\.00/);
    assert.match(summary.textContent, /Total fulfilled\s*\$3\.00/);
    assert.deepEqual(planCheckTotalsRows(harness.document).map(row => [row.Crop, row.Potential, row.Fulfilled]), [["Lettuce", "$6.00", "$3.00"]]);
});

test("interactive chart legend controls drawing and hover details without changing Plan Check", async t => {
    const harness = createYearPlannerHarness();
    t.after(() => harness.dom.window.close());
    savePlan(harness, 2026, plan => {
        addDemand(plan, { qty: 20 });
    });
    const template = harness.api.PlanSchema.serializeForPersistence(harness.api.PlanSchema.createEmptyPlan(2026), { forTemplate: true });
    template.templateBaseYear = 2026;
    template.year = null;
    harness.api.PlanRepository.saveTemplateByName("Legend template", template);

    await harness.openModal(2026);
    setStripExpanded(harness.document, "plan-check", true);

    const legend = harness.document.querySelector(".yp-chart-legend");
    const buttons = chartLegendButtons(harness.document);
    const initialCanvas = harness.document.querySelector("canvas");
    assert.ok(legend);
    assert.equal(legend.getAttribute("role"), "group");
    assert.equal(harness.window.getComputedStyle(legend).flexWrap, "wrap");
    setStripExpanded(harness.document, "plan-check", false);
    assert.equal(findStripDetails(harness.document, "plan-check").style.display, "none");
    setStripExpanded(harness.document, "plan-check", true);
    assert.equal(harness.document.querySelector("canvas"), initialCanvas);
    assert.equal(harness.document.querySelector(".yp-chart-legend"), legend);
    assert.deepEqual(buttons.map(button => button.textContent), [
        "Target demand",
        "Available supply",
        "Usable supply",
        "Harvest",
        "Shortage",
        "Expired"
    ]);
    assert.deepEqual(buttons.map(button => button.querySelector(".yp-chart-legend-swatch").dataset.kind), [
        "line",
        "dashed-line",
        "line",
        "bar",
        "area",
        "point"
    ]);
    for (const button of buttons) {
        assert.equal(button.tagName, "BUTTON");
        assert.equal(button.type, "button");
        assert.equal(button.getAttribute("aria-pressed"), "true");
        assert.match(button.title, /Click to hide/);
        assert.match(button.getAttribute("aria-label"), /Currently shown/);
    }
    assert.match(harness.document.querySelector(".yp-chart-legend-help").textContent, /calculations and totals are unchanged/);

    const canvas = harness.document.querySelector("canvas");
    const tooltip = harness.document.querySelector(".yp-plan-chart-tooltip");
    const summaryBefore = harness.document.querySelector(".yp-plan-check-summary").textContent;
    const axisBefore = canvasAxisLabels(canvas);
    const targetButton = buttons[0];
    targetButton.dispatchEvent(new harness.window.MouseEvent("click", { bubbles: true, detail: 0 }));
    assert.equal(targetButton.getAttribute("aria-pressed"), "false");
    assert.match(targetButton.title, /Click to show/);
    assert.deepEqual(canvasAxisLabels(canvas), axisBefore);
    assert.equal(harness.document.querySelector(".yp-plan-check-summary").textContent, summaryBefore);
    assert.equal((canvas.__canvasOperations || []).some(operation => operation.method === "stroke" && operation.strokeStyle === "#222"), false);

    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 900, height: 240, right: 900, bottom: 240 });
    canvas.dispatchEvent(new harness.window.MouseEvent("mousemove", { bubbles: true, clientX: 60, clientY: 100 }));
    assert.doesNotMatch(tooltip.textContent, /Target:/);
    assert.match(tooltip.textContent, /Available:/);
    assert.match(tooltip.textContent, /Inventory:/);

    const cropFilter = Array.from(harness.document.querySelectorAll("select")).find(select =>
        Array.from(select.options).some(option => option.textContent === "-- All crops --")
    );
    cropFilter.value = "crop_1";
    cropFilter.dispatchEvent(new harness.window.Event("change", { bubbles: true }));
    assert.equal(targetButton.getAttribute("aria-pressed"), "false");

    for (const button of buttons.slice(1)) button.click();
    assert.equal(harness.document.querySelector(".yp-plan-chart-hidden-message").style.display, "block");
    assert.deepEqual(canvasAxisLabels(canvas), axisBefore);
    assert.equal(harness.document.querySelector(".yp-plan-check-summary").textContent, summaryBefore);
    const dataStyles = new Set(["#222", "#1f7a3d", "#62a96b", "rgba(66, 133, 244, 0.34)", "rgba(214, 57, 57, 0.20)", "#d97706"]);
    assert.equal((canvas.__canvasOperations || []).some(operation => dataStyles.has(operation.strokeStyle) || dataStyles.has(operation.fillStyle)), false);

    const yearInput = Array.from(harness.document.querySelectorAll('input[type="number"]')).find(input => input.value === "2026");
    yearInput.value = "2027";
    yearInput.dispatchEvent(new harness.window.Event("change", { bubbles: true }));
    assert.equal(yearInput.value, "2027");
    assert.equal(chartLegendButtons(harness.document)[0].getAttribute("aria-pressed"), "false");
    assert.equal(harness.document.querySelector(".yp-plan-chart-hidden-message").style.display, "block");

    const templateSelect = Array.from(harness.document.querySelectorAll("select")).find(select =>
        Array.from(select.options).some(option => option.textContent === "Legend template")
    );
    templateSelect.value = "Legend template";
    templateSelect.dispatchEvent(new harness.window.Event("change", { bubbles: true }));
    harness.findButton("Apply template").click();
    assert.equal(chartLegendButtons(harness.document)[0].getAttribute("aria-pressed"), "false");

    harness.findButton("Close").click();
    await harness.openModal(2026);
    setStripExpanded(harness.document, "plan-check", true);
    assert.equal(chartLegendButtons(harness.document)[0].getAttribute("aria-pressed"), "true");
});

test("template input controls save state and saves without a native prompt", async t => {
    const harness = createYearPlannerHarness();
    t.after(() => harness.dom.window.close());
    savePlan(harness, 2026);
    await harness.openModal(2026);

    const nameInput = harness.document.querySelector('input[placeholder="Template name"]');
    const saveTemplate = harness.findButton("Save template");
    const templateSelect = Array.from(harness.document.querySelectorAll("select"))
        .find(select => Array.from(select.options).some(option => option.textContent === "-- Select template --"));

    assert.ok(nameInput);
    assert.ok(saveTemplate);
    assert.ok(templateSelect);
    assert.equal(saveTemplate.disabled, true);

    harness.setControlValue(nameInput, "Market Plan");
    assert.equal(saveTemplate.disabled, false);
    saveTemplate.click();

    assert.deepEqual(Array.from(harness.api.PlanRepository.listTemplateNames()), ["Market Plan"]);
    assert.equal(templateSelect.value, "Market Plan");
    assert.equal(nameInput.value, "Market Plan");

    harness.setControlValue(nameInput, "   ");
    assert.equal(saveTemplate.disabled, true);
    templateSelect.value = "Market Plan";
    templateSelect.dispatchEvent(new harness.window.Event("change", { bubbles: true }));
    assert.equal(nameInput.value, "Market Plan");
    assert.equal(saveTemplate.disabled, false);
});

test("invalid enabled CSA auto-expands CSA and Plan Check", async t => {
    const harness = createYearPlannerHarness();
    t.after(() => harness.dom.window.close());
    savePlan(harness, 2026, plan => {
        plan.csa.enabled = true;
        plan.csa.boxesPerWeek = 0;
    });

    await harness.openModal(2026);

    const csaStrip = findCsaStrip(harness.document);
    assert.ok(csaStrip);
    assert.equal(csaStrip.getAttribute("aria-expanded"), "true");
    assert.match(csaStrip.textContent, /Boxes\/week\s*0/);
    assert.ok(harness.findButton("Add component"));
    assert.equal(findStripHeader(harness.document, "plan-check").getAttribute("aria-expanded"), "true");
    assert.match(harness.document.body.textContent, /CSA enabled but boxes\/week is not set/);
});

test("CSA summary updates as controls and components change", async t => {
    const harness = createYearPlannerHarness();
    t.after(() => harness.dom.window.close());
    savePlan(harness, 2026);
    const session = await harness.openModal(2026);

    let csaStrip = findCsaStrip(harness.document);
    csaStrip.click();
    csaStrip = findCsaStrip(harness.document);
    const csaBox = csaStrip.parentElement;
    const enabled = csaBox.querySelector('input[type="checkbox"]');
    const boxes = csaBox.querySelector('input[type="number"]');
    const dates = csaBox.querySelectorAll('input[type="date"]');

    enabled.checked = true;
    enabled.dispatchEvent(new harness.window.Event("change", { bubbles: true }));
    harness.setControlValue(boxes, 25);
    harness.setControlValue(dates[0], "2026-06-01", "change");
    harness.setControlValue(dates[1], "2026-09-30", "change");
    harness.findButton("Add component").click();

    csaStrip = findCsaStrip(harness.document);
    assert.match(csaStrip.textContent, /Boxes\/week\s*25/);
    assert.match(csaStrip.textContent, /Jun 01[-–]Sep 30/);
    assert.match(csaStrip.textContent, /Components\s*1/);

    await harness.settle(120);
    assert.equal(session.plan.csa.components.length, 1);
    assert.ok(findStripHeader(harness.document, "plan-check"));
    assert.equal(harness.api.PlanSchema.validateCsa(session.plan).length, 0);
});

test("Demand date controls reject reversed ranges and expose reciprocal picker constraints", async t => {
    const harness = createYearPlannerHarness();
    t.after(() => harness.dom.window.close());
    savePlan(harness, 2026, plan => {
        addDemand(plan, { qty: 2 });
    });
    await harness.openModal(2026);
    setStripExpanded(harness.document, "demand", true);

    let editorDates = findStripDetails(harness.document, "demand").querySelectorAll('input[type="date"]');
    assert.equal(editorDates[0].max, "2026-06-07");
    assert.equal(editorDates[1].min, "2026-06-01");
    harness.setControlValue(editorDates[1], "2026-06-14", "change");
    setStripExpanded(harness.document, "plan-check", true);
    assert.match(harness.document.querySelector(".yp-plan-check-summary").textContent, /Target\s*4\.0 kg/);

    editorDates = findStripDetails(harness.document, "demand").querySelectorAll('input[type="date"]');
    harness.setControlValue(editorDates[0], "2026-06-08", "change");
    assert.match(harness.document.querySelector(".yp-plan-check-summary").textContent, /Target\s*2\.0 kg/);

    editorDates = findStripDetails(harness.document, "demand").querySelectorAll('input[type="date"]');
    assert.equal(editorDates[0].max, "2026-06-14");
    assert.equal(editorDates[1].min, "2026-06-08");
    harness.setControlValue(editorDates[0], "2026-06-15", "change");
    editorDates = findStripDetails(harness.document, "demand").querySelectorAll('input[type="date"]');
    assert.equal(editorDates[0].value, "2026-06-08");
    assert.equal(editorDates[1].value, "2026-06-14");
    assert.match(harness.document.querySelector(".yp-plan-check-summary").textContent, /Target\s*2\.0 kg/);
    assert.match(harness.document.body.textContent, /Demand line start date cannot be after end date/);
    const totalCells = harness.document.querySelectorAll(".yp-plan-check-grid table tbody tr td");
    assert.equal(totalCells[1].textContent, "2.0");

    harness.setControlValue(editorDates[0], "2026-06-14", "change");
    editorDates = findStripDetails(harness.document, "demand").querySelectorAll('input[type="date"]');
    assert.equal(editorDates[0].value, "2026-06-14");
    assert.equal(editorDates[1].value, "2026-06-14");
});

test("CSA date controls reject reversed ranges and retain harvest-window clamping", async t => {
    const harness = createYearPlannerHarness();
    t.after(() => harness.dom.window.close());
    savePlan(harness, 2026, plan => {
        plan.csa.enabled = true;
        plan.csa.boxesPerWeek = 10;
        plan.csa.start = "2026-06-01";
        plan.csa.end = "2026-06-30";
        plan.csa.components = [{ cropId: plan.crops[0].id, qty: 1, unit: "kg", everyNWeeks: 1, start: "2026-06-01", end: "2026-06-07" }];
    });
    const session = await harness.openModal(2026);
    setStripExpanded(harness.document, "plan-check", true);
    findCsaStrip(harness.document).click();

    let csaBox = findCsaStrip(harness.document).parentElement;
    let dates = csaBox.querySelectorAll('input[type="date"]');
    assert.equal(dates[0].max, "2026-06-30");
    assert.equal(dates[1].min, "2026-06-01");
    harness.setControlValue(dates[0], "2026-07-01", "change");
    csaBox = findCsaStrip(harness.document).parentElement;
    dates = csaBox.querySelectorAll('input[type="date"]');
    assert.equal(dates[0].value, "2026-06-01");
    assert.match(harness.document.body.textContent, /CSA start date cannot be after end date/);

    harness.setControlValue(dates[1], "2026-08-01", "change");
    csaBox = findCsaStrip(harness.document).parentElement;
    dates = csaBox.querySelectorAll('input[type="date"]');
    harness.setControlValue(dates[0], "2026-07-01", "change");
    assert.doesNotMatch(harness.document.body.textContent, /CSA start date cannot be after end date/);

    csaBox = findCsaStrip(harness.document).parentElement;
    dates = csaBox.querySelectorAll('input[type="date"]');
    harness.setControlValue(dates[2], "2026-05-01", "change");
    csaBox = findCsaStrip(harness.document).parentElement;
    dates = csaBox.querySelectorAll('input[type="date"]');
    assert.equal(session.plan.csa.components[0].start, "2026-06-01");
    assert.equal(dates[2].value, "2026-06-01");

    harness.setControlValue(dates[3], "2026-10-15", "change");
    csaBox = findCsaStrip(harness.document).parentElement;
    dates = csaBox.querySelectorAll('input[type="date"]');
    assert.equal(session.plan.csa.components[0].end, "2026-09-30");
    assert.equal(dates[3].value, "2026-09-30");

    harness.setControlValue(dates[2], "2026-09-20", "change");
    csaBox = findCsaStrip(harness.document).parentElement;
    dates = csaBox.querySelectorAll('input[type="date"]');
    harness.setControlValue(dates[3], "2026-09-10", "change");
    csaBox = findCsaStrip(harness.document).parentElement;
    dates = csaBox.querySelectorAll('input[type="date"]');
    assert.equal(dates[2].value, "2026-09-20");
    assert.equal(dates[3].value, "2026-09-30");
    assert.match(harness.document.body.textContent, /CSA component start date cannot be after end date/);
    assert.doesNotMatch(harness.document.querySelector(".yp-plan-check-summary").textContent, /Target\s*0\.0 kg/);
});

test("Harvest date controls reject reversed ranges and allow same-day windows", async t => {
    const harness = createYearPlannerHarness();
    t.after(() => harness.dom.window.close());
    const session = await harness.openModal(2026);
    const select = findAddCropSelect(harness.document);
    await harness.settle(10);
    const annualGroup = Array.from(select.querySelectorAll("optgroup")).find(group => group.label === "Annual crops");
    select.value = annualGroup.querySelector("option").value;
    harness.findButton("Add crop").click();
    await harness.settle(10);
    const crop = session.plan.crops[0];
    crop.useActualHarvest = false;
    crop.harvestStart = "2026-06-01";
    crop.harvestEnd = "2026-06-30";
    harness.findButton("Basics").click();

    let dates = findEditorBox(harness).querySelectorAll('input[type="date"]');
    assert.equal(dates[0].max, "2026-06-30");
    assert.equal(dates[1].min, "2026-06-01");
    harness.setControlValue(dates[0], "2026-07-01", "change");
    dates = findEditorBox(harness).querySelectorAll('input[type="date"]');
    assert.equal(dates[0].value, "2026-06-01");
    assert.equal(dates[1].value, "2026-06-30");
    assert.match(harness.document.body.textContent, /Harvest start date cannot be after end date/);

    harness.setControlValue(dates[0], "2026-06-30", "change");
    dates = findEditorBox(harness).querySelectorAll('input[type="date"]');
    assert.equal(dates[0].value, "2026-06-30");
    assert.equal(dates[1].value, "2026-06-30");
});

test("Existing reversed persisted dates remain visible, block saving, and can be corrected", async t => {
    const harness = createYearPlannerHarness();
    t.after(() => harness.dom.window.close());
    savePlan(harness, 2026, plan => {
        addDemand(plan, { from: "2026-07-01", to: "2026-06-01" });
    });
    const session = await harness.openModal(2026);
    setStripExpanded(harness.document, "demand", true);
    let dates = findStripDetails(harness.document, "demand").querySelectorAll('input[type="date"]');
    assert.equal(dates[0].value, "2026-07-01");
    assert.equal(dates[1].value, "2026-06-01");
    assert.equal(dates[0].max, "2026-06-01");
    assert.equal(dates[1].min, "2026-07-01");

    harness.findButton("Save").click();
    assert.match(harness.document.body.textContent, /Validation failed/);
    assert.equal(session.plan.demands[0].to, "2026-06-01");

    dates = findStripDetails(harness.document, "demand").querySelectorAll('input[type="date"]');
    harness.setControlValue(dates[1], "2026-07-01", "change");
    assert.equal(session.plan.demands[0].to, "2026-07-01");
    assert.equal(harness.api.PlanSchema.validateDemand(session.plan).some(error => error.code === "demand.line_reversed_dates"), false);
});

test("Sync and harvest date changes keep expanded CSA and reopened Demand dates current", async t => {
    const harness = createYearPlannerHarness();
    t.after(() => harness.dom.window.close());
    savePlan(harness, 2026, plan => {
        addDemand(plan, { from: "2026-05-01", to: "2026-09-30" });
        plan.csa.enabled = true;
        plan.csa.boxesPerWeek = 10;
        plan.csa.start = "2026-06-01";
        plan.csa.end = "2026-09-30";
        plan.csa.components = [{ cropId: plan.crops[0].id, qty: 1, unit: "kg", everyNWeeks: 1, start: "2026-06-01", end: "2026-09-30" }];
    });
    const session = await harness.openModal(2026);
    setStripExpanded(harness.document, "plan-check", true);
    findCsaStrip(harness.document).click();

    let editor = findEditorBox(harness);
    const basicsChecks = editor.querySelectorAll('input[type="checkbox"]');
    basicsChecks[1].checked = true;
    basicsChecks[1].dispatchEvent(new harness.window.Event("change", { bubbles: true }));
    assert.equal(session.plan.demands[0].from, "2026-06-01");
    assert.equal(session.plan.demands[0].to, "2026-09-30");

    let demandDates = findStripDetails(harness.document, "demand").querySelectorAll('input[type="date"]');
    assert.equal(demandDates[0].value, "2026-06-01");
    assert.equal(demandDates[1].value, "2026-09-30");

    harness.findButton("Basics").click();
    editor = findEditorBox(harness);
    const harvestDates = editor.querySelectorAll('input[type="date"]');
    harness.setControlValue(harvestDates[1], "2026-09-15", "change");
    const csaDates = findCsaStrip(harness.document).parentElement.querySelectorAll('input[type="date"]');
    assert.equal(csaDates[3].value, "2026-09-15");

    setStripExpanded(harness.document, "demand", false);
    setStripExpanded(harness.document, "demand", true);
    demandDates = findStripDetails(harness.document, "demand").querySelectorAll('input[type="date"]');
    assert.equal(demandDates[0].value, "2026-06-01");
    assert.equal(demandDates[1].value, "2026-09-15");
});

test("Harvest-window suggestions synchronize visible Demand and CSA date controls", async t => {
    const harness = createYearPlannerHarness();
    t.after(() => harness.dom.window.close());
    savePlan(harness, 2026, plan => {
        plan.crops[0].syncharvest = true;
        plan.crops[0].harvestStart = "";
        plan.crops[0].harvestEnd = "";
        addDemand(plan, { from: "", to: "" });
        plan.csa.enabled = true;
        plan.csa.boxesPerWeek = 10;
        plan.csa.start = "";
        plan.csa.end = "";
        plan.csa.components = [{ cropId: plan.crops[0].id, qty: 1, unit: "kg", everyNWeeks: 1, start: "", end: "" }];
    });
    const session = await harness.openModal(2026);
    setStripExpanded(harness.document, "csa", true);
    setStripExpanded(harness.document, "demand", true);

    harness.window.dispatchEvent(new harness.window.CustomEvent("usl:harvestWindowsSuggested", {
        detail: {
            moduleCellId: harness.moduleCell.id,
            year: 2026,
            results: [{ cropId: session.plan.crops[0].id, harvestStart: "2026-07-01", harvestEnd: "2026-07-31" }]
        }
    }));

    const demandDates = findStripDetails(harness.document, "demand").querySelectorAll('input[type="date"]');
    const csaDates = findCsaStrip(harness.document).parentElement.querySelectorAll('input[type="date"]');
    assert.deepEqual(Array.from(demandDates).map(input => input.value), ["2026-07-01", "2026-07-31"]);
    assert.deepEqual(Array.from(csaDates).map(input => input.value), ["2026-07-01", "2026-07-31", "2026-07-01", "2026-07-31"]);
});

test("dirty close uses the inline save-discard-cancel workflow", async t => {
    const harness = createYearPlannerHarness();
    t.after(() => harness.dom.window.close());
    savePlan(harness, 2026);
    await harness.openModal(2026);

    harness.findButton("Packages").click();
    harness.findButton("Add package").click();
    harness.findButton("Close").click();

    assert.match(harness.document.body.textContent, /Unsaved changes\./);
    assert.ok(harness.findButton("Save and Close"));
    assert.ok(harness.findButton("Discard"));
    assert.ok(harness.findButton("Cancel"));

    harness.findButton("Cancel").click();
    assert.equal(harness.findButton("Save and Close").parentElement.style.display, "none");
    assert.ok(harness.findButton("Close"));
});

test("public plan request event opens one modal and replaces the active session", async t => {
    const harness = createYearPlannerHarness();
    t.after(() => harness.dom.window.close());
    savePlan(harness, 2026);

    harness.window.dispatchEvent(new harness.window.CustomEvent("usl:planYearRequested", {
        detail: { moduleCellId: harness.moduleCell.id, year: 2026 }
    }));
    await harness.settle();
    assert.match(harness.document.body.textContent, /Plan Year 2026/);
    assert.equal(harness.document.body.children.length, 1);
    assert.equal(Number(harness.document.body.firstElementChild.style.zIndex), 2000000000);

    harness.window.dispatchEvent(new harness.window.CustomEvent("usl:planYearRequested", {
        detail: { moduleCellId: harness.moduleCell.id, year: 2027 }
    }));
    await harness.settle();
    assert.match(harness.document.body.textContent, /Plan Year 2027/);
    assert.equal(harness.document.body.children.length, 1);
});
