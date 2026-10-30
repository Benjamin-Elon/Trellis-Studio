const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { JSDOM } = require("jsdom");

const PLUGIN_PATH = path.join(
    __dirname,
    "..",
    "drawio",
    "src",
    "main",
    "webapp",
    "plugins",
    "garden_planner_plugins",
    "Garden_Equipment.js"
);

class TestCell {
    constructor(id, value = "") {
        this.id = id;
        this.value = value;
        this.children = [];
    }

    getAttribute(key) {
        return this.value && this.value.nodeType === 1 ? this.value.getAttribute(key) : null;
    }
}

class TestModel {
    constructor(root) { this.root = root; this.valuesWritten = 0; }
    getRoot() { return this.root; }
    getParent(cell) { return cell && cell.parent ? cell.parent : null; }
    getChildCount(cell) { return cell && cell.children ? cell.children.length : 0; }
    getChildAt(cell, index) { return cell.children[index]; }
    setValue(cell, value) { cell.value = value; this.valuesWritten += 1; }
    beginUpdate() {}
    endUpdate() {}
}

function appendChild(parent, child) {
    child.parent = parent;
    parent.children.push(child);
    return child;
}

function makeXmlCell(document, id, attrs) {
    const node = document.implementation.createDocument("", "", null).createElement("object");
    Object.entries(attrs || {}).forEach(([key, value]) => node.setAttribute(key, value));
    return new TestCell(id, node);
}

function loadPlugin(options = {}) {
    const dom = new JSDOM("<!doctype html><body></body>");
    const document = dom.window.document;
    const root = new TestCell("root");
    const moduleCell = appendChild(root, makeXmlCell(document, "module", { garden_module: "1", label: "Garden" }));
    const taskCell = appendChild(moduleCell, makeXmlCell(document, "task", { task_type_id: "pruning" }));
    const model = new TestModel(root);
    const actions = new Map();
    const graph = {
        popupMenuHandler: {},
        getModel() { return model; },
        getSelectionCells() { return options.selectedCells || [moduleCell]; },
        fireEvent() {}
    };
    const ui = {
        editor: { graph },
        actions: {
            addAction(id, fn) { actions.set(id, { funct: fn, label: id }); },
            get(id) { return actions.get(id); }
        },
        menus: { get() { return { funct() {} }; }, addMenuItems() {} }
    };
    if (options.plantOptions) {
        dom.window.USL = { scheduler: { listPlantOptions: async () => options.plantOptions } };
    }
    if (options.bedConditionGroups) {
        dom.window.TrellisGardenBeds = { listConditionOptionGroups: () => options.bedConditionGroups };
    }
    const context = {
        window: dom.window,
        document,
        console,
        Blob: dom.window.Blob,
        URL: dom.window.URL,
        FileReader: dom.window.FileReader,
        CustomEvent: dom.window.CustomEvent,
        setTimeout(fn) { fn(); },
        alert(message) { context.lastAlert = message; },
        confirm(message) { context.lastConfirm = message; return options.confirmResult !== false; },
        prompt(message, value) { context.lastPrompt = message; return options.promptValue || value; },
        Draw: { loadPlugin(callback) { callback(ui); } }
    };
    vm.runInNewContext(fs.readFileSync(PLUGIN_PATH, "utf8"), context, { filename: PLUGIN_PATH });
    return { api: graph.__trellisEquipment, graph, model, root, moduleCell, taskCell, document, context, actions };
}

async function flushPromises() {
    for (let i = 0; i < 6; i++) await Promise.resolve();
}

function fieldElement(document, labelText) {
    const field = Array.from(document.querySelectorAll(".trellis-eq-field")).find(entry => {
        const label = entry.querySelector("label");
        return label && label.textContent === labelText;
    });
    assert.ok(field, "missing field " + labelText);
    return field;
}

function clickButton(document, label) {
    const button = Array.from(document.querySelectorAll("button")).find(entry => entry.textContent === label);
    assert.ok(button, "missing button " + label);
    button.click();
}

/** Open the new editor disclosures and the shared planning-settings picker. */ // NEW
function openSection(document, key) { // NEW
    const section = document.querySelector('.trellis-eq-section[data-section="' + key + '"]'); // NEW
    assert.ok(section, 'missing section ' + key); section.open = true; // NEW
} // NEW

function openPlanningSettings(document, key) { // NEW
    if (!document.querySelector('select[aria-label="Planning settings"]')) clickButton(document, 'Planning settings'); // NEW
    const select = document.querySelector('select[aria-label="Planning settings"]'); // NEW
    select.value = key; select.dispatchEvent(new document.defaultView.Event('change', { bubbles: true })); // NEW
} // NEW

function clickText(document, selector, text) {
    const element = Array.from(document.querySelectorAll(selector)).find(entry => entry.textContent.includes(text));
    assert.ok(element, "missing text " + text);
    element.click();
    return element;
}

function fieldInput(document, labelText) {
    const field = Array.from(document.querySelectorAll(".trellis-eq-field")).find(entry => {
        const label = entry.querySelector("label");
        return label && label.textContent === labelText;
    });
    assert.ok(field, "missing field " + labelText);
    const input = field.querySelector("input, textarea, select");
    assert.ok(input, "missing input for " + labelText);
    return input;
}

function typeValue(document, input, value) {
    input.focus();
    input.value = value;
    input.dispatchEvent(new document.defaultView.Event("input", { bubbles: true }));
}

test("defaults normalize legacy frequency effects to hours multipliers", () => {
    const { api } = loadPlugin();
    const timer = api.defaults.equipment.find(item => item.id === "eq_drip_timer");
    assert.ok(timer, "expected drip timer default");
    assert.equal(timer.efficiencyEffects[0].effectType, "hours_multiplier");
    assert.match(timer.efficiencyEffects[0].notes, /Converted from frequency_multiplier/);
});

test("defaults include scheduler task type integration records", () => {
    const { api } = loadPlugin();
    const ids = new Set(api.defaults.taskTypes.map(item => item.id));
    ["general", "seedling_starting", "hardening_off", "thinning_check"].forEach(id => {
        assert.equal(ids.has(id), true, "missing task type " + id);
    });
});

test("yearly replacement reserve counts owned capital only", () => {
    const { api } = loadPlugin();
    assert.equal(api.__test.yearlyReplacementReserve({ status: "owned", replacementCost: 1200, resaleValue: 900, maintenanceCost: 99, expectedLifespanYears: 4 }), 300);
    assert.equal(api.__test.yearlyReplacementReserve({ status: "needs_repair", replacementCost: 600, expectedLifespanYears: 3 }), 200);
    ["rented", "borrowed", "wishlist", "unavailable"].forEach(status => {
        assert.equal(api.__test.yearlyReplacementReserve({ status, replacementCost: 1000, expectedLifespanYears: 1 }), 0);
    });
    assert.equal(api.__test.yearlyReplacementReserve({ status: "owned", replacementCost: 500, expectedLifespanYears: 0 }), 0);
    assert.equal(api.__test.yearlyReplacementReserve({ status: "owned", replacementCost: -500, expectedLifespanYears: 5 }), 0);
});

test("equipment dialog shows yearly reserve tile and native tooltips", () => {
    const { api, moduleCell, document } = loadPlugin();
    api.writeEquipmentInventory(moduleCell, [
        { id: "eq_owned", name: "Owned Tool", status: "owned", replacementCost: 1000, resaleValue: 900, maintenanceCost: 999, expectedLifespanYears: 5, capabilities: [], relevantTaskTypes: [], efficiencyEffects: [] },
        { id: "eq_repair", name: "Repair Tool", status: "needs_repair", replacementCost: 600, expectedLifespanYears: 3, capabilities: [], relevantTaskTypes: [], efficiencyEffects: [] },
        { id: "eq_rented", name: "Rented Tool", status: "rented", replacementCost: 1000, expectedLifespanYears: 1, capabilities: [], relevantTaskTypes: [], efficiencyEffects: [] }
    ]);
    api.openDialog(moduleCell);
    const overlay = document.querySelector(".trellis-eq-overlay");
    assert.equal(document.defaultView.getComputedStyle(overlay).zIndex, "2000000000");
    const closeButton = document.querySelector(".trellis-eq-close"); // NEW
    assert.equal(closeButton.getAttribute("data-trellis-button-variant"), "close"); // NEW
    assert.match(closeButton.getAttribute("style") || "", /background:\s*(?:#fff|rgb\(255,\s*255,\s*255\))/); // NEW
    const title = document.querySelector(".trellis-eq-title");
    assert.equal(title.textContent, "Equipment & Workload Planning"); // NEW
    const reserveTile = Array.from(document.querySelectorAll(".trellis-eq-tile")).find(tile => tile.textContent.includes("Yearly Replacement"));
    assert.ok(reserveTile, "missing yearly replacement reserve tile");
    assert.match(reserveTile.textContent, /\$400/);
    assert.equal(reserveTile.title, "Estimated yearly reserve to replace owned equipment: replacement cost divided by expected lifespan.");
    assert.equal(document.querySelector(".trellis-eq-tab").title, "Configure tools and see their planned uses."); // NEW
    assert.equal(Array.from(document.querySelectorAll("button")).find(button => button.textContent === "Save").title, "Save equipment changes to the selected garden module.");
    openSection(document, 'maintenance'); // NEW
    assert.equal(fieldInput(document, "Replacement Cost ($)").title, "Gross future cost to replace this item; used in yearly replacement reserve estimates.");
    assert.equal(fieldInput(document, "Maintenance Cost ($)").title, "Recurring maintenance cost each interval; separate from replacement reserve.");
    openSection(document, 'taskTypes'); openSection(document, 'suitability'); // NEW
    assert.equal(document.querySelector(".trellis-eq-checklist-search").title, "Search visible options by display name.");
    assert.match(document.querySelector(".trellis-eq-check-group-head input").title, /Select or clear all/);
});

test("equipment inventory persists with existing module attribute schema", () => {
    const { api, moduleCell } = loadPlugin();
    const inventory = api.readEquipmentInventory(moduleCell);
    api.writeEquipmentInventory(moduleCell, inventory.slice(0, 1));
    const raw = JSON.parse(moduleCell.getAttribute(api.attrs.EQUIPMENT_INVENTORY_JSON));
    assert.equal(raw.version, 1);
    assert.equal(raw.items.length, 1);
    assert.equal(raw.items[0].id, inventory[0].id);
});

test("validation blocks missing references and invalid effect rows", () => {
    const { api } = loadPlugin();
    const report = api.__test.validateEquipmentState(
        [{ id: "eq_bad", name: "Bad", capabilities: ["missing_cap"], relevantTaskTypes: ["missing_task"], efficiencyEffects: [{ taskTypeId: "missing_task", effectType: "hours_multiplier", multiplier: 0, minimumScale: { value: 1, unit: "tasks" } }] }],
        [],
        []
    );
    assert.ok(report.errors >= 3);
    assert.match(report.items.map(item => item.message).join("\n"), /missing task type/); // CHANGE
    assert.doesNotMatch(report.items.map(item => item.message).join("\n"), /capability/); // CHANGE
});

test("capability rename repairs equipment and task type references", () => {
    const { api } = loadPlugin();
    const state = {
        capabilities: [{ id: "old_cap", name: "Old" }],
        inventory: [{ id: "eq", name: "Tool", capabilities: ["old_cap"], relevantTaskTypes: [], efficiencyEffects: [] }],
        taskTypes: [{ id: "task", name: "Task", requiredCapabilities: ["old_cap"], optionalCapabilities: [], recommendedCapabilities: [] }]
    };
    assert.equal(api.__test.renameCapabilityId(state, "old_cap", "new_cap"), true);
    assert.deepEqual(Array.from(state.inventory[0].capabilities), ["new_cap"]);
    assert.deepEqual(Array.from(state.taskTypes[0].requiredCapabilities), ["new_cap"]);
    assert.equal(state.capabilities[0].id, "new_cap");
});

test("task type delete removes dependent links and effects", () => {
    const { api } = loadPlugin();
    const state = {
        capabilities: [],
        inventory: [{ id: "eq", name: "Tool", capabilities: [], relevantTaskTypes: ["task"], efficiencyEffects: [{ taskTypeId: "task", effectType: "hours_multiplier", multiplier: 0.8, minimumScale: { value: 0, unit: "tasks" } }] }],
        taskTypes: [{ id: "task", name: "Task", requiredCapabilities: [], optionalCapabilities: [], recommendedCapabilities: [] }]
    };
    assert.equal(api.__test.deleteTaskTypeId(state, "task"), true);
    assert.deepEqual(Array.from(state.inventory[0].relevantTaskTypes), []);
    assert.deepEqual(Array.from(state.inventory[0].efficiencyEffects), []);
    assert.deepEqual(state.taskTypes, []);
});

test("import preview merges with imported records winning", () => {
    const { api } = loadPlugin();
    const state = {
        inventory: [{ id: "eq_a", name: "Old", capabilities: [], relevantTaskTypes: [], efficiencyEffects: [] }, { id: "eq_b", name: "Keep", capabilities: [], relevantTaskTypes: [], efficiencyEffects: [] }],
        taskTypes: [],
        capabilities: []
    };
    const preview = api.__test.buildImportPreview(state, { equipment: [{ id: "eq_a", name: "New", capabilities: [], relevantTaskTypes: [], efficiencyEffects: [] }] });
    assert.equal(preview.report.errors, 0);
    assert.equal(preview.inventory.find(item => item.id === "eq_a").name, "New");
    assert.equal(preview.inventory.find(item => item.id === "eq_b").name, "Keep");
});

test("structured effect editor can add and persist an effect", () => {
    const { api, moduleCell, document } = loadPlugin();
    api.openDialog(moduleCell);
    openSection(document, 'effects'); // CHANGE
    clickButton(document, "Add Effect");
    clickButton(document, "Save");
    const saved = api.readEquipmentInventory(moduleCell);
    assert.ok(saved[0].efficiencyEffects.length >= 1);
    assert.equal(saved[0].efficiencyEffects.at(-1).effectType, "hours_multiplier");
});

test("typing names does not replace the focused input", () => {
    const { api, moduleCell, document } = loadPlugin();
    api.openDialog(moduleCell);
    const equipmentName = fieldInput(document, "Name");
    typeValue(document, equipmentName, "Wheelbarrow Pro");
    assert.equal(document.activeElement, equipmentName);
    assert.equal(document.body.contains(equipmentName), true);

    openPlanningSettings(document, 'taskTypes'); // NEW
    const taskName = fieldInput(document, "Name");
    typeValue(document, taskName, "Bed Prep Custom");
    assert.equal(document.activeElement, taskName);
    assert.equal(document.body.contains(taskName), true);

    assert.equal(Array.from(document.querySelector('select[aria-label="Planning settings"]').options).some(option => option.value === 'capabilities'), false); // CHANGE

});

test("typing checklist search and notes keeps focus", () => {
    const { api, moduleCell, document } = loadPlugin();
    api.openDialog(moduleCell);
    openSection(document, 'taskTypes'); openSection(document, 'suitability'); // NEW
    const search = document.querySelector(".trellis-eq-checklist-search");
    assert.ok(search, "missing checklist search");
    typeValue(document, search, "prun");
    assert.equal(document.activeElement, search);
    assert.equal(document.body.contains(search), true);

    openSection(document, 'notes'); // NEW
    const notes = fieldInput(document, "Notes");
    typeValue(document, notes, "Stored by the back gate");
    assert.equal(document.activeElement, notes);
    assert.equal(document.body.contains(notes), true);
});

test("Helps with shows task names and supports keyboard focus and category selection", () => { // CHANGE
    const h = loadPlugin(); h.api.openDialog(h.moduleCell); openSection(h.document, 'taskTypes'); // CHANGE
    const field = fieldElement(h.document, 'Helps with'); // CHANGE
    assert.match(field.textContent, /Pruning/); assert.doesNotMatch(field.textContent, /pruning_hand/); // CHANGE
    const option = field.querySelector('input[value="pruning"]'); option.focus(); option.click(); // CHANGE
    assert.equal(h.document.activeElement.value, 'pruning'); // CHANGE
    assert.equal(h.document.querySelector('[data-section="taskTypes"]').open, true); // NEW
    const group = h.document.querySelector('[data-section="taskTypes"] .trellis-eq-check-group-head input'); group.click(); // CHANGE
    clickButton(h.document, 'Save'); // CHANGE
    assert.equal(h.api.readEquipmentInventory(h.moduleCell)[0].taskTypeLinksVersion, 1); // CHANGE
});

test("task registry groups category first with canonical before other tasks", () => {
    const { api, moduleCell, document } = loadPlugin();
    const taskTypes = api.readTaskTypeRegistry(moduleCell);
    taskTypes.push({ id: "custom_planting", name: "Custom Planting", category: "planting", allowedQuantityBases: ["tasks"], defaultQuantityBasis: "tasks", baseHoursPerUnit: { tasks: 1 }, requiredCapabilities: [], optionalCapabilities: [], recommendedCapabilities: [] });
    api.writeTaskTypeRegistry(moduleCell, taskTypes);
    api.openDialog(moduleCell);
    openPlanningSettings(document, 'taskTypes'); // NEW
    const rows = Array.from(document.querySelectorAll(".trellis-eq-table tbody tr")).map(row => row.textContent);
    const plantingIndex = rows.findIndex(text => text === "Planting");
    assert.ok(plantingIndex >= 0, "missing planting category");
    assert.equal(rows[plantingIndex + 1], "Canonical Tasks");
    assert.ok(rows.findIndex(text => text.includes("Direct Sowing")) > plantingIndex + 1, "canonical task should follow canonical subheading");
    const otherIndex = rows.findIndex((text, index) => index > plantingIndex && text === "Other Tasks");
    assert.ok(otherIndex > plantingIndex, "other tasks should be inside planting category");
    assert.ok(rows.findIndex(text => text.includes("Custom Planting")) > otherIndex, "custom task should be under other tasks");
});

test("loaded crop and bed checklists preserve unmatched legacy preferences on save", async () => { // NEW
    const { api, moduleCell, document } = loadPlugin({
        plantOptions: [{ id: "10", name: "Tomato", annual: 1, biennial: 0, perennial: 0 }]
    });
    api.writeEquipmentInventory(moduleCell, [{
        id: "eq_legacy", name: "Legacy Tool", category: "other", capabilities: [], relevantTaskTypes: [], relevantCropIds: ["10", "missing_crop"], relevantBedConditions: ["sunExposure:full_sun", "seasonExtension:greenhouse", "cropProtection:shade_cloth", "legacy_condition"], efficiencyEffects: []
    }]);
    api.openDialog(moduleCell);
    await flushPromises();
    clickButton(document, "Save");
    const saved = api.readEquipmentInventory(moduleCell)[0];
    assert.deepEqual(Array.from(saved.relevantCropIds), ["10", "missing_crop"]); // NEW
    assert.deepEqual(Array.from(saved.relevantBedConditions), ["sunExposure:full_sun", "seasonExtension:greenhouse", "cropProtection:shade_cloth", "legacy_condition"]); // NEW
});

test("equipment setup removes preference and capability controls without fetching crop catalogs", () => { // CHANGE
    const h = loadPlugin(); let requests = 0; h.context.window.USL = { scheduler: { listPlantOptions() { requests++; throw new Error('Not needed'); } } }; // CHANGE
    h.api.openDialog(h.moduleCell); openSection(h.document, 'suitability'); // CHANGE
    const labels = Array.from(h.document.querySelectorAll('.trellis-eq-field > label'), label => label.textContent); // CHANGE
    for (const removed of ['Relevant Crops', 'Relevant Bed Conditions', 'Capabilities', 'People required (minimum)', 'Supported operators (maximum)']) assert.equal(labels.includes(removed), false); // CHANGE
    assert.equal(h.document.querySelector('[data-section="capabilities"]'), null); assert.equal(requests, 0); // CHANGE
    assert.doesNotMatch(h.document.querySelector('.trellis-eq-top').textContent, /Missing Required|Capabilities|Recommended/); // CHANGE
    openPlanningSettings(h.document, 'taskTypes'); clickText(h.document, '.trellis-eq-editor-tab', 'Time & quantity'); // CHANGE
    assert.doesNotMatch(h.document.querySelector('.trellis-eq-editor-panel').textContent, /Required Capabilities|Optional Capabilities|Recommended Capabilities/); // CHANGE
});

test("legacy preferences and capabilities survive save while no longer appearing in setup", () => { // CHANGE
    const h = loadPlugin(); // CHANGE
    h.api.writeEquipmentInventory(h.moduleCell, [{ id: 'legacy', name: 'Legacy', capabilities: ['pruning_hand'], relevantCropIds: ['unknown_crop'], relevantBedConditions: ['unknown_condition'] }]); // CHANGE
    h.api.openDialog(h.moduleCell); clickButton(h.document, 'Save'); // CHANGE
    const saved = h.api.readEquipmentInventory(h.moduleCell)[0]; // CHANGE
    assert.deepEqual(Array.from(saved.relevantCropIds), ['unknown_crop']); assert.deepEqual(Array.from(saved.relevantBedConditions), ['unknown_condition']); assert.deepEqual(Array.from(saved.capabilities), ['pruning_hand']); // CHANGE
    assert.ok(saved.relevantTaskTypes.includes('pruning')); assert.equal(saved.taskTypeLinksVersion, 1); // CHANGE
});

test("equipment warnings describe saved selections without declaring capabilities required", () => { // CHANGE
    const h = loadPlugin(); h.api.writeEquipmentInventory(h.moduleCell, []); // CHANGE
    assert.equal(h.api.buildTaskEquipmentWarnings(h.taskCell, h.moduleCell).length, 0); // CHANGE
    h.api.writeEquipmentInventory(h.moduleCell, [{ id: 'broken', name: 'Broken pruners', status: 'needs_repair', relevantTaskTypes: ['pruning'] }]); h.taskCell.value.setAttribute('task_equipment_ids', '["broken"]'); // CHANGE
    const warnings = h.api.buildTaskEquipmentWarnings(h.taskCell, h.moduleCell); // CHANGE
    assert.match(warnings.map(warning => warning.message).join(' '), /Broken pruners.*repair/); // CHANGE
    assert.equal(warnings.some(warning => warning.capabilityId || warning.type === 'missing_required_equipment'), false); // CHANGE
    h.api.openDialog(h.moduleCell); openPlanningSettings(h.document, 'warnings'); assert.match(h.document.querySelector('.trellis-eq-warning-list').textContent, /Broken pruners/); // CHANGE
});

test("equipment date fields calculate replacement dates with override support", () => {
    const { api, moduleCell, document } = loadPlugin();
    api.openDialog(moduleCell);
    openSection(document, 'maintenance'); // NEW
    const lifespan = fieldInput(document, "Expected Lifespan (years)");
    const purchase = fieldInput(document, "Purchase Date");
    const override = fieldInput(document, "Override Replacement Date");
    const replacement = fieldInput(document, "Replacement Date");

    assert.equal(purchase.type, "date");
    assert.equal(replacement.type, "date");
    assert.equal(replacement.disabled, true);
    typeValue(document, lifespan, "1");
    typeValue(document, purchase, "2024-02-29");
    assert.equal(replacement.value, "2025-02-28");

    override.checked = true;
    override.dispatchEvent(new document.defaultView.Event("change", { bubbles: true }));
    assert.equal(replacement.disabled, false);
    typeValue(document, replacement, "2030-01-01");
    clickButton(document, "Save");
    const saved = api.readEquipmentInventory(moduleCell)[0];
    assert.equal(saved.replacementDateOverride, true);
    assert.equal(saved.replacementDate, "2030-01-01");
});

test("date normalization infers legacy overrides and blocks invalid saved dates", () => {
    const { api, moduleCell, document, context } = loadPlugin();
    assert.equal(api.__test.calculateReplacementDate("2024-02-29", 1), "2025-02-28");
    const calculated = api.__test.normalizeEquipment({ id: "eq_calc", name: "Calc", purchaseDate: "2020-01-15", expectedLifespanYears: 5 });
    assert.equal(calculated.replacementDateOverride, false);
    assert.equal(calculated.replacementDate, "2025-01-15");
    const overridden = api.__test.normalizeEquipment({ id: "eq_override", name: "Override", purchaseDate: "2020-01-15", expectedLifespanYears: 5, replacementDate: "2026-01-15" });
    assert.equal(overridden.replacementDateOverride, true);
    assert.equal(overridden.replacementDate, "2026-01-15");

    api.writeEquipmentInventory(moduleCell, [{ id: "eq_bad_date", name: "Bad Date", purchaseDate: "2024-02-31", capabilities: [], relevantTaskTypes: [], efficiencyEffects: [] }]);
    api.openDialog(moduleCell);
    clickButton(document, "Save");
    assert.equal(context.lastAlert, "Fix equipment validation errors before saving.");
});

/** Real graph-linked tasks exercise the same context used by both interfaces. */ // NEW
function equipmentPlanningFixture() { // NEW
    const h = loadPlugin(); // NEW
    const bed = appendChild(h.moduleCell, makeXmlCell(h.document, 'bed', { garden_bed: '1', bed_conditions_json: JSON.stringify({ soilTexture: 'clay', sunExposure: 'full_sun' }) })); // NEW
    const source = appendChild(bed, makeXmlCell(h.document, 'planting', { tiler_group: '1', plant_id: '10', plant_count: '20', linkedTo: h.taskCell.id })); // NEW
    h.taskCell.value.setAttribute('linkedTo', source.id); // NEW
    h.taskCell.value.setAttribute('task_quantity_basis', 'plants'); // NEW
    h.taskCell.value.setAttribute('task_quantity_value', '20'); // NEW
    h.context.window.USL = { plantingGroup: { readPlantingFootprint: () => ({ x: 0, y: 0, width: 180, height: 90 }), graphUnitsToCm: units => units / 0.9 } }; // NEW
    return { ...h, bed, source }; // NEW
} // NEW

function planningTool(id, options = {}) { // NEW
    return { id, name: id, status: 'owned', capabilities: ['pruning_hand'], relevantTaskTypes: [], skillLevelRequired: 'none', efficiencyEffects: [], ...options }; // NEW
} // NEW

test('equipment ranking uses time rather than historical crop or bed preferences without mutating tasks', () => { // NEW
    const h = equipmentPlanningFixture(); // NEW
    h.api.writeEquipmentInventory(h.moduleCell, [ // NEW
        planningTool('fit', { relevantCropIds: ['10'], relevantBedConditions: ['soilTexture:clay'], efficiencyEffects: [{ taskTypeId: 'pruning', multiplier: 0.9 }] }), // NEW
        planningTool('fast', { relevantCropIds: ['99'], efficiencyEffects: [{ taskTypeId: 'pruning', multiplier: 0.5 }] }), // NEW
        planningTool('wish', { status: 'wishlist' }) // NEW
    ]); // NEW
    const before = h.model.valuesWritten, value = h.taskCell.value.outerHTML; // NEW
    const result = h.api.recommendForTask(h.taskCell, h.moduleCell); // NEW
    assert.deepEqual(Array.from(result.available, item => item.equipment.id), ['fast', 'fit']); // NEW
    assert.doesNotMatch(result.available.flatMap(item => [...item.reasons, ...item.unknown]).join(' '), /crop|bed conditions|capability/i); // NEW
    assert.equal(result.opportunities[0].equipment.id, 'wish'); // NEW
    assert.equal(h.model.valuesWritten, before); assert.equal(h.taskCell.value.outerHTML, value); // NEW
}); // NEW

test('equipment context derives crop, bed, plants, area and an unknown crew from linked plan data', () => { // NEW
    const h = equipmentPlanningFixture(); // NEW
    h.taskCell.value.removeAttribute('task_quantity_value'); // NEW
    let result = h.api.resolvePlanningContext(h.taskCell, h.moduleCell); // NEW
    assert.equal(result.cropId, '10'); assert.equal(result.bedConditions.soilTexture, 'clay'); // NEW
    assert.equal(result.quantities.plants, 20); assert.equal(result.quantities.m2, 2); assert.equal(result.quantities.beds, 1); // NEW
    assert.equal(result.quantity.value, 20); assert.equal(result.crewSize, null); // NEW
    h.taskCell.value.setAttribute('task_quantity_value', '0'); // NEW
    assert.equal(h.api.resolvePlanningContext(h.taskCell, h.moduleCell).quantity.value, 0); // NEW
    h.taskCell.value.setAttribute('task_quantity_basis', 'row_meters'); h.taskCell.value.removeAttribute('task_quantity_value'); // NEW
    assert.equal(h.api.resolvePlanningContext(h.taskCell, h.moduleCell).quantity, null); // NEW
}); // NEW

test('crew checks use distinct valid assignees and keep unknown skill and zero scale bounds conditional', () => { // NEW
    const h = equipmentPlanningFixture(); // NEW
    const roles = ['r1', 'r2', 'r3'].map(id => appendChild(h.moduleCell, makeXmlCell(h.document, id, { role_card: '1' }))); // NEW
    h.api.writeEquipmentInventory(h.moduleCell, [planningTool('crew', { crewSizeMin: 2, crewSizeMax: 2, skillLevelRequired: 'advanced', minimumUsefulScale: { value: 0, unit: 'row_meters' } })]); // NEW
    let result = h.api.recommendForTask(h.taskCell, h.moduleCell); // NEW
    assert.match(result.available[0].unknown.join(' '), /crew not assigned/); // NEW
    h.taskCell.value.setAttribute('task_assignee_role_ids_json', JSON.stringify(['r1', 'r1', 'deleted'])); // NEW
    assert.match(h.api.recommendForTask(h.taskCell, h.moduleCell).opportunities[0].unmet.join(' '), /1 assigned/); // NEW
    h.taskCell.value.setAttribute('task_assignee_role_ids_json', JSON.stringify(roles.map(role => role.id))); // NEW
    result = h.api.recommendForTask(h.taskCell, h.moduleCell); // NEW
    assert.equal(result.available.length, 1); assert.equal(result.context.crewSize, 3); // NEW
    assert.match(result.available[0].unknown.join(' '), /operator skill/); // NEW
    assert.doesNotMatch(result.available[0].unknown.join(' '), /job size/); // NEW
}); // NEW

test('selected tools retain legacy IDs, explicit no tools, suggestions and unavailable selections', () => { // NEW
    const h = equipmentPlanningFixture(); // NEW
    h.api.writeEquipmentInventory(h.moduleCell, [planningTool('a'), planningTool('b', { status: 'needs_repair' })]); // NEW
    h.taskCell.value.setAttribute('task_equipment_ids', 'a,b,deleted'); // NEW
    let result = h.api.recommendForTask(h.taskCell, h.moduleCell); // NEW
    assert.deepEqual(Array.from(result.selection), ['a', 'b', 'deleted']); // NEW
    assert.match(result.selected[1].unmet.join(' '), /repair/); assert.match(result.selected[2].unmet.join(' '), /Missing/); // NEW
    h.taskCell.value.setAttribute('task_planning_override_json', JSON.stringify({ equipmentIds: [] })); // NEW
    assert.equal(h.api.recommendForTask(h.taskCell, h.moduleCell).selection.length, 0); // NEW
    h.taskCell.value.setAttribute('task_planning_override_json', JSON.stringify({ equipmentIds: null })); // NEW
    assert.equal(h.api.recommendForTask(h.taskCell, h.moduleCell).selection, null); // NEW
}); // NEW

test('selected tool estimates use the best nonstackable effect, explicit stacking and one overhead per tool', () => { // NEW
    const h = equipmentPlanningFixture(); // NEW
    const effect = (multiplier, stackable = false) => ({ taskTypeId: 'pruning', multiplier, stackable }); // NEW
    h.api.writeEquipmentInventory(h.moduleCell, [planningTool('a', { setupTimeHours: 0.1, efficiencyEffects: [effect(0.8), effect(0.7)] }), planningTool('b', { cleanupTimeHours: 0.2, efficiencyEffects: [effect(0.5, true)] })]); // NEW
    const context = h.api.resolvePlanningContext(h.taskCell, h.moduleCell); // NEW
    const result = h.api.estimatePlanningSelection(context, ['a', 'a', 'b']); // NEW
    const type = context.taskType; // NEW
    assert.ok(Math.abs(result.estimatedHours - (20 * type.baseHoursPerUnit.plants * 0.35 + type.defaultSetupTimeHours + type.defaultCleanupTimeHours + 0.3)) < 1e-9); // NEW
    context.quantity = null; // NEW
    assert.equal(h.api.estimatePlanningSelection(context, ['a']).estimatedHours, null); // NEW
}); // NEW

test('draft equipment preview uses detached values and never replaces accepted task estimates', () => { // NEW
    const h = equipmentPlanningFixture(); // NEW
    h.api.writeEquipmentInventory(h.moduleCell, [planningTool('accepted')]); // NEW
    h.taskCell.value.setAttribute('task_estimated_hours', '7'); // NEW
    const before = h.model.valuesWritten; // NEW
    const preview = h.api.recommendForTask(h.taskCell, h.moduleCell, { inventory: [h.api.__test.normalizeEquipment(planningTool('draft', { efficiencyEffects: [{ taskTypeId: 'pruning', multiplier: 0.4 }] }))], draftPreview: true }); // NEW
    assert.equal(preview.context.draftPreview, true); assert.equal(preview.candidates[0].equipment.id, 'draft'); // NEW
    assert.equal(h.api.recommendForTask(h.taskCell, h.moduleCell).candidates[0].equipment.id, 'accepted'); // NEW
    assert.equal(h.taskCell.getAttribute('task_estimated_hours'), '7'); assert.equal(h.model.valuesWritten, before); // NEW
}); // NEW

test('equipment editor presets preserve inventory ownership and optional sections remain collapsed', () => { // NEW
    const h = loadPlugin(); // NEW
    const before = h.api.readEquipmentInventory(h.moduleCell); // NEW
    h.api.openDialog(h.moduleCell); // NEW
    assert.equal(h.document.querySelectorAll('.trellis-eq-editor-tab').length, 0); // NEW
    assert.equal(h.document.querySelector('[data-section="maintenance"]').open, false); // NEW
    assert.equal(h.document.querySelector('[data-section="notes"]').open, false); // NEW
    const preset = h.document.querySelector('select[aria-label="Add equipment from preset"]'); // NEW
    preset.value = 'eq_wheelbarrow'; preset.dispatchEvent(new h.document.defaultView.Event('change', { bubbles: true })); // NEW
    clickButton(h.document, 'Save'); // NEW
    const saved = h.api.readEquipmentInventory(h.moduleCell); // NEW
    assert.equal(saved.length, before.length + 1); // NEW
    assert.equal(saved.at(-1).status, 'wishlist'); assert.notEqual(saved.at(-1).id, 'eq_wheelbarrow'); // NEW
    before.forEach(item => assert.equal(saved.find(value => value.id === item.id).status, item.status)); // NEW
}); // NEW

test('equipment planned task lists exclude completed work and other gardens', () => { // NEW
    const h = equipmentPlanningFixture(); // NEW
    const other = appendChild(h.root, makeXmlCell(h.document, 'other', { garden_module: '1' })); // NEW
    appendChild(other, makeXmlCell(h.document, 'foreign-task', { task_type_id: 'pruning' })); // NEW
    appendChild(h.moduleCell, makeXmlCell(h.document, 'done-task', { task_type_id: 'pruning', status: 'DONE' })); // NEW
    assert.deepEqual(Array.from(h.api.listPlanningTasks(h.moduleCell), item => item.id), ['task']); // NEW
}); // NEW


test('public task-hour estimates never automatically use merely available equipment', () => { // NEW
    const h = equipmentPlanningFixture(); // NEW
    h.api.writeEquipmentInventory(h.moduleCell, [planningTool('fast', { efficiencyEffects: [{ taskTypeId: 'pruning', multiplier: 0.5 }] })]); // NEW
    const advisory = h.api.estimateTaskHours({ cell: h.taskCell }, { moduleCell: h.moduleCell }); // NEW
    const selected = h.api.estimateTaskHours({ cell: h.taskCell, equipmentIds: ['fast'] }, { moduleCell: h.moduleCell }); // NEW
    assert.ok(selected.estimatedHours < advisory.estimatedHours); // NEW
    h.taskCell.value.setAttribute('task_quantity_basis', 'row_meters'); h.taskCell.value.removeAttribute('task_quantity_value'); // NEW
    assert.equal(h.api.estimateTaskHours({ cell: h.taskCell }, { moduleCell: h.moduleCell }).estimatedHours, null); // NEW
}); // NEW

test('legacy link conversion preserves direct, effect and capability matches without writing accepted values', () => { // NEW
    const h = loadPlugin(); // NEW
    const types = ['required', 'optional', 'recommended'].map(kind => ({ id: 'custom_' + kind, name: kind, [kind + 'Capabilities']: ['legacy_cutting'] })); // NEW
    h.api.writeTaskTypeRegistry(h.moduleCell, types); // NEW
    const legacy = { version: 1, items: [{ id: 'legacy', name: 'Legacy', capabilities: ['legacy_cutting'], relevantTaskTypes: ['pruning'], efficiencyEffects: [{ taskTypeId: 'harvesting', multiplier: 0.5 }] }] }; // NEW
    h.moduleCell.value.setAttribute(h.api.attrs.EQUIPMENT_INVENTORY_JSON, JSON.stringify(legacy)); // NEW
    const before = h.moduleCell.value.outerHTML, writes = h.model.valuesWritten; // NEW
    const converted = h.api.readEquipmentInventory(h.moduleCell)[0]; // NEW
    assert.deepEqual(Array.from(converted.relevantTaskTypes).sort(), ['custom_optional', 'custom_recommended', 'custom_required', 'harvesting', 'pruning']); // NEW
    assert.equal(converted.taskTypeLinksVersion, 1); assert.equal(h.model.valuesWritten, writes); assert.equal(h.moduleCell.value.outerHTML, before); // NEW
    h.api.openDialog(h.moduleCell); assert.equal(h.moduleCell.value.outerHTML, before); clickButton(h.document, 'Save'); // NEW
    const stored = JSON.parse(h.moduleCell.getAttribute(h.api.attrs.EQUIPMENT_INVENTORY_JSON)).items[0]; // NEW
    assert.equal(stored.taskTypeLinksVersion, 1); assert.deepEqual(Array.from(stored.capabilities), ['legacy_cutting']); // NEW
    h.document.querySelector('.trellis-eq-close').click(); stored.relevantTaskTypes = []; h.api.writeEquipmentInventory(h.moduleCell, [stored]); // NEW
    h.api.openDialog(h.moduleCell); clickButton(h.document, 'Save'); // NEW
    assert.deepEqual(Array.from(h.api.readEquipmentInventory(h.moduleCell)[0].relevantTaskTypes), []); // NEW
}); // NEW

test('explicit task links prevent capabilities or inactive effects from restoring removed matches', () => { // NEW
    const h = equipmentPlanningFixture(); // NEW
    h.api.writeEquipmentInventory(h.moduleCell, [planningTool('inactive', { taskTypeLinksVersion: 1, relevantTaskTypes: [], efficiencyEffects: [{ taskTypeId: 'pruning', multiplier: 0.5 }] })]); // NEW
    h.taskCell.value.setAttribute('task_equipment_ids', '["inactive"]'); // NEW
    let result = h.api.recommendForTask(h.taskCell, h.moduleCell); // NEW
    assert.equal(result.candidates.length, 0); assert.equal(result.selection[0], 'inactive'); assert.equal(result.selected[0].relevant, false); // NEW
    assert.equal(result.estimate.estimatedHours, result.estimate.baselineHours); assert.match(result.estimate.problems.join(' '), /excluded/); // NEW
    const inventory = h.api.readEquipmentInventory(h.moduleCell); inventory[0].relevantTaskTypes = ['pruning']; h.api.writeEquipmentInventory(h.moduleCell, inventory); // NEW
    result = h.api.recommendForTask(h.taskCell, h.moduleCell); assert.equal(result.candidates.length, 1); assert.ok(result.estimate.estimatedHours < result.estimate.baselineHours); // NEW
}); // NEW

test('time rules target linked types and stay saved but inactive when a link is removed', () => { // NEW
    const h = loadPlugin(); // NEW
    h.api.writeEquipmentInventory(h.moduleCell, [{ id: 'tool', name: 'Tool', taskTypeLinksVersion: 1, relevantTaskTypes: ['pruning'], efficiencyEffects: [{ taskTypeId: 'harvesting', multiplier: 0.4 }] }]); // NEW
    h.api.openDialog(h.moduleCell); openSection(h.document, 'effects'); // NEW
    assert.match(h.document.querySelector('[data-section="effects"]').textContent, /Inactive: Harvesting/); // NEW
    const select = h.document.querySelector('.trellis-eq-row-editor select'); // NEW
    assert.deepEqual(Array.from(select.options).filter(option => !option.disabled).map(option => option.value), ['pruning']); // NEW
    assert.equal(h.document.querySelector('.trellis-eq-row-editor input').disabled, true); // NEW
    clickButton(h.document, 'Add Effect'); clickButton(h.document, 'Save'); // NEW
    let saved = h.api.readEquipmentInventory(h.moduleCell)[0]; assert.equal(saved.efficiencyEffects[0].multiplier, 0.4); assert.equal(saved.efficiencyEffects[1].taskTypeId, 'pruning'); // NEW
    saved.relevantTaskTypes = []; h.api.writeEquipmentInventory(h.moduleCell, [saved]); h.document.querySelector('.trellis-eq-close').click(); h.api.openDialog(h.moduleCell); openSection(h.document, 'effects'); // NEW
    assert.equal(Array.from(h.document.querySelectorAll('button')).find(button => button.textContent === 'Add Effect').disabled, true); // NEW
    assert.equal(h.api.readEquipmentInventory(h.moduleCell)[0].efficiencyEffects.length, 2); // NEW
}); // NEW

test('crew controls share an accessible operator range and retain focus while maintaining whole-number bounds', () => { // NEW
    const h = loadPlugin(); h.api.openDialog(h.moduleCell); openSection(h.document, 'suitability'); // NEW
    const group = h.document.querySelector('fieldset.trellis-eq-crew-range'), inputs = group.querySelectorAll('input'); // NEW
    assert.equal(group.querySelector('legend').textContent, 'People required to operate this tool'); // NEW
    const [minimum, maximum] = inputs; assert.notEqual(minimum.getAttribute('aria-label'), maximum.getAttribute('aria-label')); // NEW
    assert.equal(minimum.min, '1'); assert.equal(minimum.step, '1'); assert.equal(minimum.value, '1'); assert.equal(maximum.value, '1'); // NEW
    typeValue(h.document, minimum, '3'); assert.equal(maximum.value, '3'); assert.equal(maximum.min, '3'); assert.equal(h.document.activeElement, minimum); // NEW
    assert.match(h.document.querySelector('[data-section="suitability"] > summary').textContent, /3 operators/); // NEW
    typeValue(h.document, maximum, '2'); assert.equal(maximum.value, '3'); typeValue(h.document, maximum, '4.4'); assert.equal(maximum.value, '4'); // NEW
    typeValue(h.document, minimum, '0'); assert.equal(minimum.value, '1'); typeValue(h.document, minimum, '2'); // NEW
    clickButton(h.document, 'Save'); const tool = h.api.readEquipmentInventory(h.moduleCell)[0]; assert.equal(tool.crewSizeMin, 2); assert.equal(tool.crewSizeMax, 4); // NEW
    for (const bounds of [{ crewSizeMin: 0, crewSizeMax: 1 }, { crewSizeMin: 2, crewSizeMax: 1 }, { crewSizeMin: 1.5, crewSizeMax: 2 }]) assert.ok(h.api.__test.validateEquipmentState([{ id: 'bad', name: 'Bad', ...bounds }], [], []).errors > 0); // NEW
}); // NEW

test('import conversion uses the merged registry and respects explicit empty links on repeated round trips', () => { // NEW
    const h = loadPlugin(), state = { inventory: [], taskTypes: [], capabilities: [] }; // NEW
    const payload = { equipment: [{ id: 'legacy', name: 'Legacy', capabilities: ['custom_cap'], relevantCropIds: ['saved_crop'], relevantBedConditions: ['saved_condition'] }], taskTypes: [{ id: 'custom_task', name: 'Custom', requiredCapabilities: ['custom_cap'] }], capabilities: [{ id: 'custom_cap', name: 'Legacy capability' }] }; // NEW
    const preview = h.api.__test.buildImportPreview(state, payload); assert.equal(preview.report.errors, 0); assert.deepEqual(Array.from(preview.inventory[0].relevantTaskTypes), ['custom_task']); // NEW
    preview.inventory[0].relevantTaskTypes = []; // NEW
    const repeated = h.api.__test.buildImportPreview(state, { equipment: preview.inventory, taskTypes: preview.taskTypes, capabilities: preview.capabilities }); // NEW
    assert.deepEqual(Array.from(repeated.inventory[0].relevantTaskTypes), []); assert.deepEqual(Array.from(repeated.inventory[0].relevantCropIds), ['saved_crop']); assert.deepEqual(Array.from(repeated.inventory[0].relevantBedConditions), ['saved_condition']); assert.equal(repeated.capabilities[0].id, 'custom_cap'); // NEW
}); // NEW

test('legacy conversion uses only scoped task definitions and keeps unknown direct links as saved values', () => { // NEW
    const h = loadPlugin(), raw = { id: 'tool', name: 'Tool', capabilities: ['pruning_hand'], relevantTaskTypes: ['retired_type'] }; // NEW
    const result = h.api.__test.normalizePlanningEquipment(raw, [{ id: 'scoped', optionalCapabilities: ['pruning_hand'] }]); // NEW
    assert.deepEqual(Array.from(result.relevantTaskTypes), ['retired_type', 'scoped']); assert.equal(result.relevantTaskTypes.includes('pruning'), false); assert.equal(raw.taskTypeLinksVersion, undefined); // NEW
    h.api.writeEquipmentInventory(h.moduleCell, [result]); h.taskCell.value.setAttribute('task_type_id', 'retired_type'); // NEW
    assert.match(h.api.recommendForTask(h.taskCell, h.moduleCell).context.problems.join(' '), /available task type/); // NEW
}); // NEW

test('export retains conversion markers and historical fields for a repeatable import round trip', () => { // NEW
    const h = loadPlugin(); // NEW
    h.api.writeEquipmentInventory(h.moduleCell, [{ id: 'exported', name: 'Exported', taskTypeLinksVersion: 1, relevantTaskTypes: [], capabilities: ['pruning_hand'], relevantCropIds: ['crop'], relevantBedConditions: ['condition'], efficiencyEffects: [{ taskTypeId: 'pruning', multiplier: 0.5 }] }]); // NEW
    let payload; h.context.Blob = class { constructor(parts) { payload = JSON.parse(parts.join('')); } }; // NEW
    h.context.URL = { createObjectURL: () => 'blob:equipment-export', revokeObjectURL() {} }; h.document.defaultView.HTMLAnchorElement.prototype.click = function () {}; // NEW
    h.api.openDialog(h.moduleCell); clickButton(h.document, 'Export…'); // NEW
    assert.equal(payload.equipment[0].taskTypeLinksVersion, 1); assert.deepEqual(payload.equipment[0].capabilities, ['pruning_hand']); assert.deepEqual(payload.equipment[0].relevantCropIds, ['crop']); assert.deepEqual(payload.equipment[0].relevantBedConditions, ['condition']); // NEW
    const restored = h.api.__test.buildImportPreview({ inventory: [], taskTypes: [], capabilities: [] }, payload); // NEW
    assert.equal(restored.report.errors, 0); assert.deepEqual(Array.from(restored.inventory[0].relevantTaskTypes), []); assert.equal(restored.inventory[0].efficiencyEffects[0].multiplier, 0.5); assert.equal(restored.capabilities.length, payload.capabilities.length); // NEW
}); // NEW
