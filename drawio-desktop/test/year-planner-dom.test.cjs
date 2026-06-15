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

function findStrip(document, id) { // CHANGE
    return document.querySelector(`[data-year-plan-strip="${id}"]`); // NEW
} // NEW

function findStripHeader(document, id) { // NEW
    const strip = findStrip(document, id); // NEW
    return strip ? strip.querySelector(".yp-strip-header") : null; // NEW
} // NEW

function findStripDetails(document, id) { // NEW
    const strip = findStrip(document, id); // NEW
    return strip ? strip.querySelector(".yp-strip-details") : null; // NEW
} // NEW

function setStripExpanded(document, id, expanded) { // NEW
    const header = findStripHeader(document, id); // NEW
    assert.ok(header); // NEW
    if ((header.getAttribute("aria-expanded") === "true") !== expanded) header.click(); // NEW
    return findStripHeader(document, id); // NEW
} // NEW

function findCsaStrip(document) { // CHANGE
    return findStripHeader(document, "csa"); // CHANGE
} // CHANGE

function findAddCropSelect(document) { // NEW
    return Array.from(document.querySelectorAll("select")).find(select => // NEW
        Array.from(select.options).some(option => option.textContent === "-- Select crop --") // NEW
    ) || null; // NEW
} // NEW

function optionGroupLabels(select) { // NEW
    return Array.from(select.querySelectorAll("optgroup")).map(group => group.label); // NEW
} // NEW

function optionLabels(group) { // NEW
    return Array.from(group.querySelectorAll("option")).map(option => option.textContent); // NEW
} // NEW

function findEditorBox(harness) { // NEW
    const removeCrop = harness.findButton("Remove crop"); // NEW
    return removeCrop ? removeCrop.parentElement.parentElement : null; // NEW
} // NEW

function chartLegendButtons(document) { // NEW
    return Array.from(document.querySelectorAll(".yp-chart-legend-item")); // NEW
} // NEW

function canvasAxisLabels(canvas) { // NEW
    return (canvas.__canvasOperations || []) // NEW
        .filter(operation => operation.method === "fillText" && / kg$/.test(operation.text)) // NEW
        .map(operation => operation.text); // NEW
} // NEW

test("modal renders four ordered strips with the expected defaults and crop tabs", async t => { // CHANGE
    const harness = createYearPlannerHarness();
    t.after(() => harness.dom.window.close());
    savePlan(harness, 2026);

    await harness.openModal(2026);

    assert.match(harness.document.body.textContent, /2026 · 1 crop/);
    const tabLabels = Array.from(harness.document.querySelectorAll("button"))
        .map(button => button.textContent.trim())
        .filter(label => ["Basics", "Packages", "Advanced"].includes(label)); // CHANGE
    assert.deepEqual(tabLabels, ["Basics", "Packages", "Advanced"]); // CHANGE
    const strips = Array.from(harness.document.querySelectorAll("[data-year-plan-strip]")); // NEW
    assert.deepEqual(strips.map(strip => strip.dataset.yearPlanStrip), ["crop-plan", "demand", "csa", "plan-check"]); // CHANGE
    assert.deepEqual(strips.map(strip => strip.querySelector(".yp-strip-title").textContent), ["Crop Plan", "Demand", "CSA", "Plan Check"]); // CHANGE
    assert.doesNotMatch(harness.document.body.textContent, /Diagnostics/);

    const csaStrip = findCsaStrip(harness.document);
    assert.ok(csaStrip);
    assert.match(csaStrip.textContent, /CSA\s*Off/); // CHANGE
    assert.equal(csaStrip.getAttribute("aria-expanded"), "false");
    assert.equal(findStripHeader(harness.document, "demand").getAttribute("aria-expanded"), "true"); // NEW
    assert.equal(findStripHeader(harness.document, "crop-plan").getAttribute("aria-expanded"), "true"); // NEW
    assert.equal(findStripHeader(harness.document, "plan-check").getAttribute("aria-expanded"), "false"); // NEW
    assert.equal(harness.findButton("Add component"), null);
});

test("empty plans show Demand and Crop Plan guidance", async t => { // NEW
    const harness = createYearPlannerHarness(); // NEW
    t.after(() => harness.dom.window.close()); // NEW
    await harness.openModal(2026); // NEW

    assert.match(findStripDetails(harness.document, "demand").textContent, /Add or select a crop in Crop Plan/); // NEW
    assert.match(findStripDetails(harness.document, "crop-plan").textContent, /Add or select a crop to edit its plan/); // NEW
    assert.match(findStripHeader(harness.document, "demand").textContent, /No crop selected/); // NEW
    assert.match(findStripHeader(harness.document, "crop-plan").textContent, /0 crops.*No crop selected/); // NEW
}); // NEW

test("strip expansion survives year changes, template application, and clearing", async t => { // NEW
    const harness = createYearPlannerHarness(); // NEW
    t.after(() => harness.dom.window.close()); // NEW
    savePlan(harness, 2026); // NEW
    const template = harness.api.PlanSchema.serializeForPersistence(harness.api.PlanSchema.createEmptyPlan(2026), { forTemplate: true }); // NEW
    template.templateBaseYear = 2026; // NEW
    template.year = null; // NEW
    harness.api.PlanRepository.saveTemplateByName("Empty layout", template); // NEW
    await harness.openModal(2026); // NEW

    setStripExpanded(harness.document, "csa", true); // NEW
    setStripExpanded(harness.document, "demand", false); // NEW
    setStripExpanded(harness.document, "crop-plan", false); // NEW
    setStripExpanded(harness.document, "plan-check", true); // NEW
    const assertLayout = () => assert.deepEqual( // NEW
        ["csa", "demand", "crop-plan", "plan-check"].map(id => findStripHeader(harness.document, id).getAttribute("aria-expanded")), // NEW
        ["true", "false", "false", "true"] // NEW
    ); // NEW

    const yearInput = Array.from(harness.document.querySelectorAll('input[type="number"]')).find(input => input.value === "2026"); // NEW
    harness.setControlValue(yearInput, 2027, "change"); // NEW
    assertLayout(); // NEW

    const templateSelect = Array.from(harness.document.querySelectorAll("select")).find(select => // NEW
        Array.from(select.options).some(option => option.textContent === "Empty layout") // NEW
    ); // NEW
    templateSelect.value = "Empty layout"; // NEW
    harness.findButton("Apply").click(); // NEW
    assertLayout(); // NEW

    harness.findButton("Clear").click(); // NEW
    assertLayout(); // NEW
}); // NEW

test("debounced Demand typing preserves the focused control", async t => { // NEW
    const harness = createYearPlannerHarness(); // NEW
    t.after(() => harness.dom.window.close()); // NEW
    savePlan(harness, 2026, plan => { // NEW
        plan.crops[0].market = [{ qty: 1, unit: "kg", from: "2026-06-01", to: "2026-06-07" }]; // NEW
    }); // NEW
    const session = await harness.openModal(2026); // NEW
    const qty = findStripDetails(harness.document, "demand").querySelector('input[type="number"]'); // NEW
    qty.focus(); // NEW
    harness.setControlValue(qty, 7); // NEW
    await harness.settle(130); // NEW

    assert.equal(harness.document.activeElement, qty); // NEW
    assert.equal(qty.isConnected, true); // NEW
    assert.equal(qty.value, "7"); // NEW
    assert.equal(session.plan.crops[0].market[0].qty, 7); // NEW
}); // NEW

test("Add crop prioritizes garden crops and groups remaining plants by lifecycle", async t => { // NEW
    const harness = createYearPlannerHarness({ // NEW
        plants: [ // NEW
            { plant_id: 1, plant_name: "Tomato", yield_per_plant_kg: 1, default_planting_method: "direct_sow.field", annual: 1, biennial: 0, perennial: 0 }, // NEW
            { plant_id: 2, plant_name: "Asparagus", yield_per_plant_kg: 0.2, default_planting_method: "transplant.field", annual: 0, biennial: 0, perennial: 1 }, // NEW
            { plant_id: 3, plant_name: "Beet", yield_per_plant_kg: 0.3, default_planting_method: "direct_sow.field", annual: 0, biennial: 1, perennial: 0 }, // NEW
            { plant_id: 4, plant_name: "Mystery", yield_per_plant_kg: 0.4, default_planting_method: "direct_sow.field", annual: 0, biennial: 0, perennial: 0 }, // NEW
            { plant_id: 5, plant_name: "Basil", yield_per_plant_kg: 0.1, default_planting_method: "transplant.field", annual: 1, biennial: 0, perennial: 0 }, // NEW
            { plant_id: 6, plant_name: "Conflicted", yield_per_plant_kg: 0.5, default_planting_method: "direct_sow.field", annual: 1, biennial: 1, perennial: 0 } // NEW
        ] // NEW
    }); // NEW
    t.after(() => harness.dom.window.close()); // NEW
    harness.addCell(harness.moduleCell, new harness.TestCell("tomato-a", { tiler_group: "1", plant_id: "1", plant_name: "Tomato" })); // NEW
    harness.addCell(harness.moduleCell, new harness.TestCell("tomato-b", { tiler_group: "1", plant_id: "1", plant_name: "Tomato" })); // NEW

    await harness.openModal(2026); // NEW
    await harness.settle(10); // NEW

    const select = findAddCropSelect(harness.document); // NEW
    assert.ok(select); // NEW
    assert.deepEqual(optionGroupLabels(select), [ // NEW
        "Crops in this garden, not yet in plan", // NEW
        "Annual crops", // NEW
        "Biennial crops", // NEW
        "Perennial crops", // NEW
        "Uncategorized crops" // NEW
    ]); // NEW
    const groups = Array.from(select.querySelectorAll("optgroup")); // NEW
    assert.deepEqual(optionLabels(groups[0]), ["Tomato"]); // NEW
    assert.deepEqual(optionLabels(groups[1]), ["Basil"]); // NEW
    assert.deepEqual(optionLabels(groups[2]), ["Beet"]); // NEW
    assert.deepEqual(optionLabels(groups[3]), ["Asparagus"]); // NEW
    assert.deepEqual(optionLabels(groups[4]), ["Conflicted", "Mystery"]); // NEW
}); // NEW

test("Garden variety resolution preserves identity, applies yield override, and refreshes after add and remove", async t => { // NEW
    const harness = createYearPlannerHarness({ // NEW
        plants: [{ plant_id: 1, plant_name: "Tomato", yield_per_plant_kg: 1, default_planting_method: "direct_sow.field", annual: 1, biennial: 0, perennial: 0 }], // NEW
        varietiesByPlantId: { // NEW
            "1": [{ variety_id: 10, plant_id: 1, variety_name: "Roma", overrides_json: JSON.stringify({ yield_per_plant_kg: 2.5 }) }] // NEW
        } // NEW
    }); // NEW
    t.after(() => harness.dom.window.close()); // NEW
    harness.addCell(harness.moduleCell, new harness.TestCell("roma-a", { tiler_group: "1", plant_id: "1", plant_name: "Tomato", variety_name: " roma " })); // NEW
    harness.addCell(harness.moduleCell, new harness.TestCell("roma-b", { tiler_group: "1", plant_id: "1", plant_name: "Tomato", variety_name: "Roma" })); // NEW

    const session = await harness.openModal(2026); // NEW
    await harness.settle(10); // NEW
    let select = findAddCropSelect(harness.document); // NEW
    let gardenGroup = Array.from(select.querySelectorAll("optgroup")).find(group => group.label.startsWith("Crops in this garden")); // NEW
    assert.deepEqual(optionLabels(gardenGroup), ["Tomato - Roma"]); // NEW

    select.value = gardenGroup.querySelector("option").value; // NEW
    harness.findButton("Add crop").click(); // NEW
    await harness.settle(10); // NEW
    assert.equal(session.plan.crops.length, 1); // NEW
    assert.equal(session.plan.crops[0].varietyId, 10); // NEW
    assert.equal(session.plan.crops[0].variety, "Roma"); // NEW
    assert.equal(session.plan.crops[0].baseKgPerPlant, 1); // NEW
    assert.equal(session.plan.crops[0].kgPerPlant, 2.5); // NEW

    select = findAddCropSelect(harness.document); // NEW
    assert.equal(Array.from(select.querySelectorAll("optgroup")).some(group => group.label.startsWith("Crops in this garden")), false); // NEW
    assert.deepEqual(optionLabels(Array.from(select.querySelectorAll("optgroup")).find(group => group.label === "Annual crops")), ["Tomato"]); // NEW

    harness.findButton("Remove crop").click(); // NEW
    await harness.settle(10); // NEW
    select = findAddCropSelect(harness.document); // NEW
    gardenGroup = Array.from(select.querySelectorAll("optgroup")).find(group => group.label.startsWith("Crops in this garden")); // NEW
    assert.deepEqual(optionLabels(gardenGroup), ["Tomato - Roma"]); // NEW
}); // NEW

test("Demand follows Crop Plan selection and removal", async t => { // NEW
    const harness = createYearPlannerHarness(); // NEW
    t.after(() => harness.dom.window.close()); // NEW
    savePlan(harness, 2026, plan => { // NEW
        plan.crops[0].market = [{ qty: 1, unit: "kg", from: "2026-06-01", to: "2026-06-07" }]; // NEW
        plan.crops.push(makePlanCrop({ // NEW
            id: "crop_2", // NEW
            plantId: "2", // NEW
            plant: "Carrot", // NEW
            market: [{ qty: 4, unit: "kg", from: "2026-07-01", to: "2026-07-07" }] // NEW
        })); // NEW
    }); // NEW
    const session = await harness.openModal(2026); // NEW
    const cropPlanDetails = findStripDetails(harness.document, "crop-plan"); // NEW
    const carrotButton = Array.from(cropPlanDetails.querySelectorAll("button")).find(button => button.textContent.includes("Carrot")); // NEW
    carrotButton.click(); // NEW

    assert.match(findStripHeader(harness.document, "demand").textContent, /Carrot.*1 demand line/); // NEW
    assert.equal(findStripDetails(harness.document, "demand").querySelector('input[type="number"]').value, "4"); // NEW
    harness.findButton("Remove crop").click(); // NEW
    assert.equal(session.plan.crops.length, 1); // NEW
    assert.match(findStripHeader(harness.document, "demand").textContent, /Tomato.*1 demand line/); // NEW
    assert.equal(findStripDetails(harness.document, "demand").querySelector('input[type="number"]').value, "1"); // NEW
}); // NEW

test("Unavailable garden records are skipped while deleted persisted varieties remain selectable", async t => { // NEW
    const harness = createYearPlannerHarness({ // NEW
        plants: [{ plant_id: 1, plant_name: "Tomato", yield_per_plant_kg: 1.25, default_planting_method: "direct_sow.field", annual: 1, biennial: 0, perennial: 0 }], // NEW
        varietiesByPlantId: { // NEW
            "1": [ // NEW
                { variety_id: 10, plant_id: 1, variety_name: "Roma", overrides_json: null }, // NEW
                { variety_id: 11, plant_id: 1, variety_name: " roma ", overrides_json: null } // NEW
            ] // NEW
        } // NEW
    }); // NEW
    t.after(() => harness.dom.window.close()); // NEW
    harness.addCell(harness.moduleCell, new harness.TestCell("deleted-variety", { tiler_group: "1", plant_id: "1", plant_name: "Tomato", variety_id: "99", variety_name: "Old Favorite" })); // NEW
    harness.addCell(harness.moduleCell, new harness.TestCell("ambiguous-variety", { tiler_group: "1", plant_id: "1", plant_name: "Tomato", variety_name: "Roma" })); // NEW
    harness.addCell(harness.moduleCell, new harness.TestCell("missing-plant", { tiler_group: "1", plant_id: "2", plant_name: "Missing" })); // NEW

    const session = await harness.openModal(2026); // NEW
    await harness.settle(10); // NEW
    const select = findAddCropSelect(harness.document); // NEW
    const gardenGroup = Array.from(select.querySelectorAll("optgroup")).find(group => group.label.startsWith("Crops in this garden")); // NEW
    assert.deepEqual(optionLabels(gardenGroup), ["Tomato - Old Favorite"]); // NEW
    assert.match(harness.document.body.textContent, /Skipped 2 unavailable garden crops/); // NEW

    select.value = gardenGroup.querySelector("option").value; // NEW
    harness.findButton("Add crop").click(); // NEW
    await harness.settle(10); // NEW
    assert.equal(session.plan.crops[0].varietyId, 99); // NEW
    assert.equal(session.plan.crops[0].variety, "Old Favorite"); // NEW
    assert.equal(session.plan.crops[0].kgPerPlant, 1.25); // NEW
}); // NEW

test("Add crop options refresh after year changes, template application, and reset", async t => { // NEW
    const harness = createYearPlannerHarness(); // NEW
    t.after(() => harness.dom.window.close()); // NEW
    harness.addCell(harness.moduleCell, new harness.TestCell("tomato", { tiler_group: "1", plant_id: "1", plant_name: "Tomato" })); // NEW
    const savedPlan = savePlan(harness, 2026); // NEW
    const template = harness.api.PlanSchema.serializeForPersistence(savedPlan, { forTemplate: true }); // NEW
    template.templateBaseYear = 2026; // NEW
    template.year = null; // NEW
    harness.api.PlanRepository.saveTemplateByName("Tomato Template", template); // NEW

    await harness.openModal(2026); // NEW
    await harness.settle(10); // NEW
    let select = findAddCropSelect(harness.document); // NEW
    assert.equal(Array.from(select.querySelectorAll("optgroup")).some(group => group.label.startsWith("Crops in this garden")), false); // NEW

    const yearInput = Array.from(harness.document.querySelectorAll('input[type="number"]')).find(input => input.value === "2026"); // NEW
    harness.setControlValue(yearInput, 2027, "change"); // NEW
    await harness.settle(10); // NEW
    select = findAddCropSelect(harness.document); // NEW
    assert.deepEqual(optionLabels(Array.from(select.querySelectorAll("optgroup")).find(group => group.label.startsWith("Crops in this garden"))), ["Tomato"]); // NEW

    const templateSelect = Array.from(harness.document.querySelectorAll("select")).find(candidate => // NEW
        Array.from(candidate.options).some(option => option.textContent === "-- Select template --") // NEW
    ); // NEW
    templateSelect.value = "Tomato Template"; // NEW
    harness.findButton("Apply").click(); // NEW
    await harness.settle(10); // NEW
    select = findAddCropSelect(harness.document); // NEW
    assert.equal(Array.from(select.querySelectorAll("optgroup")).some(group => group.label.startsWith("Crops in this garden")), false); // NEW

    harness.findButton("Clear").click(); // CHANGE
    await harness.settle(10); // NEW
    select = findAddCropSelect(harness.document); // NEW
    assert.deepEqual(optionLabels(Array.from(select.querySelectorAll("optgroup")).find(group => group.label.startsWith("Crops in this garden"))), ["Tomato"]); // NEW
}); // NEW

test("Footer and reset action follow the currently loaded year", async t => { // NEW
    const harness = createYearPlannerHarness(); // NEW
    t.after(() => harness.dom.window.close()); // NEW
    savePlan(harness, 2026); // NEW
    await harness.openModal(2026); // NEW

    assert.match(harness.document.body.textContent, /Loaded saved plan/); // NEW
    assert.ok(harness.findButton("Reset")); // NEW

    const yearInput = Array.from(harness.document.querySelectorAll('input[type="number"]')).find(input => input.value === "2026"); // NEW
    harness.setControlValue(yearInput, 2027, "change"); // NEW
    await harness.settle(10); // NEW
    assert.match(harness.document.body.textContent, /New plan/); // NEW
    assert.ok(harness.findButton("Clear")); // NEW

    harness.findButton("Save").click(); // NEW
    assert.ok(harness.findButton("Reset")); // NEW
    assert.match(harness.document.body.textContent, /Last saved/); // NEW

    harness.findButton("Reset").click(); // NEW
    assert.ok(harness.findButton("Clear")); // NEW
    assert.match(harness.document.body.textContent, /New plan/); // NEW
}); // NEW

test("Stale Add crop loads cannot replace newer grouped options", async t => { // NEW
    let resolveFirst; // NEW
    let resolveSecond; // NEW
    let loadCount = 0; // NEW
    const firstLoad = new Promise(resolve => { resolveFirst = resolve; }); // NEW
    const secondLoad = new Promise(resolve => { resolveSecond = resolve; }); // NEW
    const harness = createYearPlannerHarness({ // NEW
        getPlantsBasicCached: async () => (++loadCount === 1 ? firstLoad : secondLoad) // NEW
    }); // NEW
    t.after(() => harness.dom.window.close()); // NEW
    const template = harness.api.PlanSchema.createEmptyPlan(2026); // NEW
    template.templateBaseYear = 2026; // NEW
    template.year = null; // NEW
    harness.api.PlanRepository.saveTemplateByName("Empty", template); // NEW

    await harness.openModal(2026); // NEW
    const templateSelect = Array.from(harness.document.querySelectorAll("select")).find(candidate => // NEW
        Array.from(candidate.options).some(option => option.textContent === "-- Select template --") // NEW
    ); // NEW
    templateSelect.value = "Empty"; // NEW
    harness.findButton("Apply").click(); // NEW
    resolveSecond([{ plant_id: 2, plant_name: "Newer", yield_per_plant_kg: 1, default_planting_method: "direct_sow.field", annual: 1, biennial: 0, perennial: 0 }]); // NEW
    await harness.settle(10); // NEW
    resolveFirst([{ plant_id: 1, plant_name: "Stale", yield_per_plant_kg: 1, default_planting_method: "direct_sow.field", annual: 1, biennial: 0, perennial: 0 }]); // NEW
    await harness.settle(10); // NEW

    const select = findAddCropSelect(harness.document); // NEW
    const annualGroup = Array.from(select.querySelectorAll("optgroup")).find(group => group.label === "Annual crops"); // NEW
    assert.deepEqual(optionLabels(annualGroup), ["Newer"]); // NEW
    assert.equal(select.disabled, false); // NEW
    assert.equal(harness.findButton("Add crop").disabled, false); // NEW
}); // NEW

test("Plan Check summary follows the crop filter and chart hover shows inventory details", async t => { // NEW
    const harness = createYearPlannerHarness(); // NEW
    t.after(() => harness.dom.window.close()); // NEW
    savePlan(harness, 2026, plan => { // NEW
        plan.crops[0].market = [{ qty: 2, unit: "kg", from: "2026-06-01", to: "2026-06-07" }]; // NEW
        plan.crops.push(makePlanCrop({ // NEW
            id: "crop_2", // NEW
            plantId: "2", // NEW
            plant: "Carrot", // NEW
            market: [{ qty: 3, unit: "kg", from: "2026-06-01", to: "2026-06-07" }] // NEW
        })); // NEW
    }); // NEW

    await harness.openModal(2026); // NEW
    setStripExpanded(harness.document, "plan-check", true); // CHANGE

    const summary = harness.document.querySelector(".yp-plan-check-summary"); // NEW
    const cropFilter = Array.from(harness.document.querySelectorAll("select")).find(select => // NEW
        Array.from(select.options).some(option => option.textContent === "-- All crops --") // NEW
    ); // NEW
    assert.ok(summary); // NEW
    assert.ok(cropFilter); // NEW
    assert.match(summary.textContent, /Target:\s*5\.0 kg/); // NEW
    assert.match(summary.textContent, /Short weeks:\s*1/); // NEW

    cropFilter.value = "crop_1"; // NEW
    cropFilter.dispatchEvent(new harness.window.Event("change", { bubbles: true })); // NEW
    assert.match(summary.textContent, /Target:\s*2\.0 kg/); // NEW
    assert.doesNotMatch(summary.textContent, /Target:\s*5\.0 kg/); // NEW

    const canvas = harness.document.querySelector("canvas"); // NEW
    const tooltip = harness.document.querySelector(".yp-plan-chart-tooltip"); // NEW
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 900, height: 240, right: 900, bottom: 240 }); // NEW
    canvas.dispatchEvent(new harness.window.MouseEvent("mousemove", { bubbles: true, clientX: 60, clientY: 100 })); // NEW
    assert.equal(tooltip.style.display, "block"); // NEW
    assert.match(tooltip.textContent, /Week of/); // NEW
    assert.match(tooltip.textContent, /Available:/); // NEW
    assert.match(tooltip.textContent, /Inventory:/); // NEW
    canvas.dispatchEvent(new harness.window.MouseEvent("mouseleave", { bubbles: true })); // NEW
    assert.equal(tooltip.style.display, "none"); // NEW
}); // NEW

test("interactive chart legend controls drawing and hover details without changing Plan Check", async t => { // NEW
    const harness = createYearPlannerHarness(); // NEW
    t.after(() => harness.dom.window.close()); // NEW
    savePlan(harness, 2026, plan => { // NEW
        plan.crops[0].market = [{ qty: 20, unit: "kg", from: "2026-06-01", to: "2026-06-07" }]; // NEW
    }); // NEW
    const template = harness.api.PlanSchema.serializeForPersistence(harness.api.PlanSchema.createEmptyPlan(2026), { forTemplate: true }); // NEW
    template.templateBaseYear = 2026; // NEW
    template.year = null; // NEW
    harness.api.PlanRepository.saveTemplateByName("Legend template", template); // NEW

    await harness.openModal(2026); // NEW
    setStripExpanded(harness.document, "plan-check", true); // CHANGE

    const legend = harness.document.querySelector(".yp-chart-legend"); // NEW
    const buttons = chartLegendButtons(harness.document); // NEW
    const initialCanvas = harness.document.querySelector("canvas"); // NEW
    assert.ok(legend); // NEW
    assert.equal(legend.getAttribute("role"), "group"); // NEW
    assert.equal(harness.window.getComputedStyle(legend).flexWrap, "wrap"); // NEW
    setStripExpanded(harness.document, "plan-check", false); // NEW
    assert.equal(findStripDetails(harness.document, "plan-check").style.display, "none"); // NEW
    setStripExpanded(harness.document, "plan-check", true); // NEW
    assert.equal(harness.document.querySelector("canvas"), initialCanvas); // NEW
    assert.equal(harness.document.querySelector(".yp-chart-legend"), legend); // NEW
    assert.deepEqual(buttons.map(button => button.textContent), [ // NEW
        "Target demand", // NEW
        "Available supply", // NEW
        "Usable supply", // NEW
        "Harvest", // NEW
        "Shortage", // NEW
        "Expired" // NEW
    ]); // NEW
    assert.deepEqual(buttons.map(button => button.querySelector(".yp-chart-legend-swatch").dataset.kind), [ // NEW
        "line", // NEW
        "dashed-line", // NEW
        "line", // NEW
        "bar", // NEW
        "area", // NEW
        "point" // NEW
    ]); // NEW
    for (const button of buttons) { // NEW
        assert.equal(button.tagName, "BUTTON"); // NEW
        assert.equal(button.type, "button"); // NEW
        assert.equal(button.getAttribute("aria-pressed"), "true"); // NEW
        assert.match(button.title, /Click to hide/); // NEW
        assert.match(button.getAttribute("aria-label"), /Currently shown/); // NEW
    } // NEW
    assert.match(harness.document.querySelector(".yp-chart-legend-help").textContent, /calculations and totals are unchanged/); // NEW

    const canvas = harness.document.querySelector("canvas"); // NEW
    const tooltip = harness.document.querySelector(".yp-plan-chart-tooltip"); // NEW
    const summaryBefore = harness.document.querySelector(".yp-plan-check-summary").textContent; // NEW
    const axisBefore = canvasAxisLabels(canvas); // NEW
    const targetButton = buttons[0]; // NEW
    targetButton.dispatchEvent(new harness.window.MouseEvent("click", { bubbles: true, detail: 0 })); // NEW
    assert.equal(targetButton.getAttribute("aria-pressed"), "false"); // NEW
    assert.match(targetButton.title, /Click to show/); // NEW
    assert.deepEqual(canvasAxisLabels(canvas), axisBefore); // NEW
    assert.equal(harness.document.querySelector(".yp-plan-check-summary").textContent, summaryBefore); // NEW
    assert.equal((canvas.__canvasOperations || []).some(operation => operation.method === "stroke" && operation.strokeStyle === "#222"), false); // NEW

    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 900, height: 240, right: 900, bottom: 240 }); // NEW
    canvas.dispatchEvent(new harness.window.MouseEvent("mousemove", { bubbles: true, clientX: 60, clientY: 100 })); // NEW
    assert.doesNotMatch(tooltip.textContent, /Target:/); // NEW
    assert.match(tooltip.textContent, /Available:/); // NEW
    assert.match(tooltip.textContent, /Inventory:/); // NEW

    const cropFilter = Array.from(harness.document.querySelectorAll("select")).find(select => // NEW
        Array.from(select.options).some(option => option.textContent === "-- All crops --") // NEW
    ); // NEW
    cropFilter.value = "crop_1"; // NEW
    cropFilter.dispatchEvent(new harness.window.Event("change", { bubbles: true })); // NEW
    assert.equal(targetButton.getAttribute("aria-pressed"), "false"); // NEW

    for (const button of buttons.slice(1)) button.click(); // NEW
    assert.equal(harness.document.querySelector(".yp-plan-chart-hidden-message").style.display, "block"); // NEW
    assert.deepEqual(canvasAxisLabels(canvas), axisBefore); // NEW
    assert.equal(harness.document.querySelector(".yp-plan-check-summary").textContent, summaryBefore); // NEW
    const dataStyles = new Set(["#222", "#1f7a3d", "#62a96b", "rgba(66, 133, 244, 0.34)", "rgba(214, 57, 57, 0.20)", "#d97706"]); // NEW
    assert.equal((canvas.__canvasOperations || []).some(operation => dataStyles.has(operation.strokeStyle) || dataStyles.has(operation.fillStyle)), false); // NEW

    const yearInput = Array.from(harness.document.querySelectorAll('input[type="number"]')).find(input => input.value === "2026"); // NEW
    yearInput.value = "2027"; // NEW
    yearInput.dispatchEvent(new harness.window.Event("change", { bubbles: true })); // NEW
    assert.equal(yearInput.value, "2027"); // NEW
    assert.equal(chartLegendButtons(harness.document)[0].getAttribute("aria-pressed"), "false"); // NEW
    assert.equal(harness.document.querySelector(".yp-plan-chart-hidden-message").style.display, "block"); // NEW

    const templateSelect = Array.from(harness.document.querySelectorAll("select")).find(select => // NEW
        Array.from(select.options).some(option => option.textContent === "Legend template") // NEW
    ); // NEW
    templateSelect.value = "Legend template"; // NEW
    templateSelect.dispatchEvent(new harness.window.Event("change", { bubbles: true })); // NEW
    harness.findButton("Apply").click(); // CHANGE
    assert.equal(chartLegendButtons(harness.document)[0].getAttribute("aria-pressed"), "false"); // NEW

    harness.findButton("Close").click(); // NEW
    await harness.openModal(2026); // NEW
    setStripExpanded(harness.document, "plan-check", true); // CHANGE
    assert.equal(chartLegendButtons(harness.document)[0].getAttribute("aria-pressed"), "true"); // NEW
}); // NEW

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
    assert.match(csaStrip.textContent, /0 boxes\/week/);
    assert.ok(harness.findButton("Add component"));
    assert.equal(findStripHeader(harness.document, "plan-check").getAttribute("aria-expanded"), "true"); // CHANGE
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
    assert.match(csaStrip.textContent, /25 boxes\/week/);
    assert.match(csaStrip.textContent, /Jun 01–Sep 30/);
    assert.match(csaStrip.textContent, /1 component/);

    await harness.settle(120);
    assert.equal(session.plan.csa.components.length, 1);
    assert.ok(findStripHeader(harness.document, "plan-check")); // CHANGE
    assert.equal(harness.api.PlanSchema.validateCsa(session.plan).length, 0);
});

test("Market date controls reject reversed ranges and expose reciprocal picker constraints", async t => { // CHANGE
    const harness = createYearPlannerHarness(); // NEW
    t.after(() => harness.dom.window.close()); // NEW
    savePlan(harness, 2026, plan => { // NEW
        plan.crops[0].market = [{ qty: 2, unit: "kg", from: "2026-06-01", to: "2026-06-07" }]; // NEW
    }); // NEW
    await harness.openModal(2026); // NEW
    setStripExpanded(harness.document, "demand", true); // CHANGE

    let editorDates = findStripDetails(harness.document, "demand").querySelectorAll('input[type="date"]'); // CHANGE
    assert.equal(editorDates[0].max, "2026-06-07"); // NEW
    assert.equal(editorDates[1].min, "2026-06-01"); // NEW
    harness.setControlValue(editorDates[1], "2026-06-14", "change"); // NEW
    setStripExpanded(harness.document, "plan-check", true); // CHANGE
    assert.match(harness.document.querySelector(".yp-plan-check-summary").textContent, /Target:\s*4\.0 kg/); // NEW

    editorDates = findStripDetails(harness.document, "demand").querySelectorAll('input[type="date"]'); // CHANGE
    harness.setControlValue(editorDates[0], "2026-06-08", "change"); // NEW
    assert.match(harness.document.querySelector(".yp-plan-check-summary").textContent, /Target:\s*2\.0 kg/); // NEW

    editorDates = findStripDetails(harness.document, "demand").querySelectorAll('input[type="date"]'); // CHANGE
    assert.equal(editorDates[0].max, "2026-06-14"); // NEW
    assert.equal(editorDates[1].min, "2026-06-08"); // NEW
    harness.setControlValue(editorDates[0], "2026-06-15", "change"); // NEW
    editorDates = findStripDetails(harness.document, "demand").querySelectorAll('input[type="date"]'); // CHANGE
    assert.equal(editorDates[0].value, "2026-06-08"); // CHANGE
    assert.equal(editorDates[1].value, "2026-06-14"); // NEW
    assert.match(harness.document.querySelector(".yp-plan-check-summary").textContent, /Target:\s*2\.0 kg/); // CHANGE
    assert.match(harness.document.body.textContent, /Market start date cannot be after end date/); // CHANGE
    const totalCells = harness.document.querySelectorAll(".yp-plan-check-grid table tbody tr td"); // CHANGE
    assert.equal(totalCells[1].textContent, "2.0"); // CHANGE

    harness.setControlValue(editorDates[0], "2026-06-14", "change"); // NEW
    editorDates = findStripDetails(harness.document, "demand").querySelectorAll('input[type="date"]'); // CHANGE
    assert.equal(editorDates[0].value, "2026-06-14"); // NEW
    assert.equal(editorDates[1].value, "2026-06-14"); // NEW
}); // NEW

test("CSA date controls reject reversed ranges and retain harvest-window clamping", async t => { // CHANGE
    const harness = createYearPlannerHarness(); // NEW
    t.after(() => harness.dom.window.close()); // NEW
    savePlan(harness, 2026, plan => { // NEW
        plan.csa.enabled = true; // NEW
        plan.csa.boxesPerWeek = 10; // NEW
        plan.csa.start = "2026-06-01"; // NEW
        plan.csa.end = "2026-06-30"; // NEW
        plan.csa.components = [{ cropId: plan.crops[0].id, qty: 1, unit: "kg", everyNWeeks: 1, start: "2026-06-01", end: "2026-06-07" }]; // NEW
    }); // NEW
    const session = await harness.openModal(2026); // NEW
    setStripExpanded(harness.document, "plan-check", true); // CHANGE
    findCsaStrip(harness.document).click(); // NEW

    let csaBox = findCsaStrip(harness.document).parentElement; // NEW
    let dates = csaBox.querySelectorAll('input[type="date"]'); // NEW
    assert.equal(dates[0].max, "2026-06-30"); // NEW
    assert.equal(dates[1].min, "2026-06-01"); // NEW
    harness.setControlValue(dates[0], "2026-07-01", "change"); // NEW
    csaBox = findCsaStrip(harness.document).parentElement; // NEW
    dates = csaBox.querySelectorAll('input[type="date"]'); // NEW
    assert.equal(dates[0].value, "2026-06-01"); // CHANGE
    assert.match(harness.document.body.textContent, /CSA start date cannot be after end date/); // CHANGE

    harness.setControlValue(dates[1], "2026-08-01", "change"); // NEW
    csaBox = findCsaStrip(harness.document).parentElement; // NEW
    dates = csaBox.querySelectorAll('input[type="date"]'); // NEW
    harness.setControlValue(dates[0], "2026-07-01", "change"); // NEW
    assert.doesNotMatch(harness.document.body.textContent, /CSA start date cannot be after end date/); // CHANGE

    csaBox = findCsaStrip(harness.document).parentElement; // NEW
    dates = csaBox.querySelectorAll('input[type="date"]'); // NEW
    harness.setControlValue(dates[2], "2026-05-01", "change"); // NEW
    csaBox = findCsaStrip(harness.document).parentElement; // NEW
    dates = csaBox.querySelectorAll('input[type="date"]'); // NEW
    assert.equal(session.plan.csa.components[0].start, "2026-06-01"); // NEW
    assert.equal(dates[2].value, "2026-06-01"); // NEW

    harness.setControlValue(dates[3], "2026-10-15", "change"); // NEW
    csaBox = findCsaStrip(harness.document).parentElement; // NEW
    dates = csaBox.querySelectorAll('input[type="date"]'); // NEW
    assert.equal(session.plan.csa.components[0].end, "2026-09-30"); // NEW
    assert.equal(dates[3].value, "2026-09-30"); // NEW

    harness.setControlValue(dates[2], "2026-09-20", "change"); // NEW
    csaBox = findCsaStrip(harness.document).parentElement; // NEW
    dates = csaBox.querySelectorAll('input[type="date"]'); // NEW
    harness.setControlValue(dates[3], "2026-09-10", "change"); // NEW
    csaBox = findCsaStrip(harness.document).parentElement; // NEW
    dates = csaBox.querySelectorAll('input[type="date"]'); // NEW
    assert.equal(dates[2].value, "2026-09-20"); // NEW
    assert.equal(dates[3].value, "2026-09-30"); // CHANGE
    assert.match(harness.document.body.textContent, /CSA component start date cannot be after end date/); // CHANGE
    assert.doesNotMatch(harness.document.querySelector(".yp-plan-check-summary").textContent, /Target:\s*0\.0 kg/); // CHANGE
}); // NEW

test("Harvest date controls reject reversed ranges and allow same-day windows", async t => { // NEW
    const harness = createYearPlannerHarness(); // NEW
    t.after(() => harness.dom.window.close()); // NEW
    const session = await harness.openModal(2026); // NEW
    const select = findAddCropSelect(harness.document); // NEW
    await harness.settle(10); // NEW
    const annualGroup = Array.from(select.querySelectorAll("optgroup")).find(group => group.label === "Annual crops"); // NEW
    select.value = annualGroup.querySelector("option").value; // NEW
    harness.findButton("Add crop").click(); // NEW
    await harness.settle(10); // NEW
    const crop = session.plan.crops[0]; // NEW
    crop.useActualHarvest = false; // NEW
    crop.harvestStart = "2026-06-01"; // NEW
    crop.harvestEnd = "2026-06-30"; // NEW
    harness.findButton("Basics").click(); // NEW

    let dates = findEditorBox(harness).querySelectorAll('input[type="date"]'); // NEW
    assert.equal(dates[0].max, "2026-06-30"); // NEW
    assert.equal(dates[1].min, "2026-06-01"); // NEW
    harness.setControlValue(dates[0], "2026-07-01", "change"); // NEW
    dates = findEditorBox(harness).querySelectorAll('input[type="date"]'); // NEW
    assert.equal(dates[0].value, "2026-06-01"); // NEW
    assert.equal(dates[1].value, "2026-06-30"); // NEW
    assert.match(harness.document.body.textContent, /Harvest start date cannot be after end date/); // NEW

    harness.setControlValue(dates[0], "2026-06-30", "change"); // NEW
    dates = findEditorBox(harness).querySelectorAll('input[type="date"]'); // NEW
    assert.equal(dates[0].value, "2026-06-30"); // NEW
    assert.equal(dates[1].value, "2026-06-30"); // NEW
}); // NEW

test("Existing reversed persisted dates remain visible, block saving, and can be corrected", async t => { // NEW
    const harness = createYearPlannerHarness(); // NEW
    t.after(() => harness.dom.window.close()); // NEW
    savePlan(harness, 2026, plan => { // NEW
        plan.crops[0].market = [{ qty: 1, unit: "kg", from: "2026-07-01", to: "2026-06-01" }]; // NEW
    }); // NEW
    const session = await harness.openModal(2026); // NEW
    setStripExpanded(harness.document, "demand", true); // CHANGE
    let dates = findStripDetails(harness.document, "demand").querySelectorAll('input[type="date"]'); // CHANGE
    assert.equal(dates[0].value, "2026-07-01"); // NEW
    assert.equal(dates[1].value, "2026-06-01"); // NEW
    assert.equal(dates[0].max, "2026-06-01"); // NEW
    assert.equal(dates[1].min, "2026-07-01"); // NEW

    harness.findButton("Save").click(); // NEW
    assert.match(harness.document.body.textContent, /Validation failed/); // NEW
    assert.equal(session.plan.crops[0].market[0].to, "2026-06-01"); // NEW

    dates = findStripDetails(harness.document, "demand").querySelectorAll('input[type="date"]'); // CHANGE
    harness.setControlValue(dates[1], "2026-07-01", "change"); // NEW
    assert.equal(session.plan.crops[0].market[0].to, "2026-07-01"); // NEW
    assert.equal(harness.api.PlanSchema.validateCrop(session.plan.crops[0]).some(error => error.includes("start date after end date")), false); // NEW
}); // NEW

test("Sync and harvest date changes keep expanded CSA and reopened Demand dates current", async t => { // NEW
    const harness = createYearPlannerHarness(); // NEW
    t.after(() => harness.dom.window.close()); // NEW
    savePlan(harness, 2026, plan => { // NEW
        plan.crops[0].market = [{ qty: 1, unit: "kg", from: "2026-05-01", to: "2026-09-30" }]; // NEW
        plan.csa.enabled = true; // NEW
        plan.csa.boxesPerWeek = 10; // NEW
        plan.csa.start = "2026-06-01"; // NEW
        plan.csa.end = "2026-09-30"; // NEW
        plan.csa.components = [{ cropId: plan.crops[0].id, qty: 1, unit: "kg", everyNWeeks: 1, start: "2026-06-01", end: "2026-09-30" }]; // NEW
    }); // NEW
    const session = await harness.openModal(2026); // NEW
    setStripExpanded(harness.document, "plan-check", true); // CHANGE
    findCsaStrip(harness.document).click(); // NEW

    let editor = findEditorBox(harness); // NEW
    const basicsChecks = editor.querySelectorAll('input[type="checkbox"]'); // NEW
    basicsChecks[1].checked = true; // NEW
    basicsChecks[1].dispatchEvent(new harness.window.Event("change", { bubbles: true })); // NEW
    assert.equal(session.plan.crops[0].market[0].from, "2026-06-01"); // NEW
    assert.equal(session.plan.crops[0].market[0].to, "2026-09-30"); // NEW

    let demandDates = findStripDetails(harness.document, "demand").querySelectorAll('input[type="date"]'); // CHANGE
    assert.equal(demandDates[0].value, "2026-06-01"); // NEW
    assert.equal(demandDates[1].value, "2026-09-30"); // NEW

    harness.findButton("Basics").click(); // NEW
    editor = findEditorBox(harness); // NEW
    const harvestDates = editor.querySelectorAll('input[type="date"]'); // NEW
    harness.setControlValue(harvestDates[1], "2026-09-15", "change"); // NEW
    const csaDates = findCsaStrip(harness.document).parentElement.querySelectorAll('input[type="date"]'); // NEW
    assert.equal(csaDates[3].value, "2026-09-15"); // NEW

    setStripExpanded(harness.document, "demand", false); // NEW
    setStripExpanded(harness.document, "demand", true); // NEW
    demandDates = findStripDetails(harness.document, "demand").querySelectorAll('input[type="date"]'); // CHANGE
    assert.equal(demandDates[0].value, "2026-06-01"); // NEW
    assert.equal(demandDates[1].value, "2026-09-15"); // NEW
}); // NEW

test("Harvest-window suggestions synchronize visible Demand and CSA date controls", async t => { // NEW
    const harness = createYearPlannerHarness(); // NEW
    t.after(() => harness.dom.window.close()); // NEW
    savePlan(harness, 2026, plan => { // NEW
        plan.crops[0].syncharvest = true; // NEW
        plan.crops[0].harvestStart = ""; // NEW
        plan.crops[0].harvestEnd = ""; // NEW
        plan.crops[0].market = [{ qty: 1, unit: "kg", from: "", to: "" }]; // NEW
        plan.csa.enabled = true; // NEW
        plan.csa.boxesPerWeek = 10; // NEW
        plan.csa.start = ""; // NEW
        plan.csa.end = ""; // NEW
        plan.csa.components = [{ cropId: plan.crops[0].id, qty: 1, unit: "kg", everyNWeeks: 1, start: "", end: "" }]; // NEW
    }); // NEW
    const session = await harness.openModal(2026); // NEW
    setStripExpanded(harness.document, "csa", true); // CHANGE
    setStripExpanded(harness.document, "demand", true); // CHANGE

    harness.window.dispatchEvent(new harness.window.CustomEvent("usl:harvestWindowsSuggested", { // NEW
        detail: { // NEW
            moduleCellId: harness.moduleCell.id, // NEW
            year: 2026, // NEW
            results: [{ cropId: session.plan.crops[0].id, harvestStart: "2026-07-01", harvestEnd: "2026-07-31" }] // NEW
        } // NEW
    })); // NEW

    const demandDates = findStripDetails(harness.document, "demand").querySelectorAll('input[type="date"]'); // CHANGE
    const csaDates = findCsaStrip(harness.document).parentElement.querySelectorAll('input[type="date"]'); // NEW
    assert.deepEqual(Array.from(demandDates).map(input => input.value), ["2026-07-01", "2026-07-31"]); // NEW
    assert.deepEqual(Array.from(csaDates).map(input => input.value), ["2026-07-01", "2026-07-31", "2026-07-01", "2026-07-31"]); // NEW
}); // NEW

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
    assert.match(harness.document.body.textContent, /Plan Year - 2026/);
    assert.equal(harness.document.body.children.length, 1);

    harness.window.dispatchEvent(new harness.window.CustomEvent("usl:planYearRequested", {
        detail: { moduleCellId: harness.moduleCell.id, year: 2027 }
    }));
    await harness.settle();
    assert.match(harness.document.body.textContent, /Plan Year - 2027/);
    assert.equal(harness.document.body.children.length, 1);
});
