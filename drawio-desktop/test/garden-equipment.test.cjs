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
    assert.equal(title.textContent, "Garden Equipment & Workload Assumptions");
    const reserveTile = Array.from(document.querySelectorAll(".trellis-eq-tile")).find(tile => tile.textContent.includes("Yearly Replacement"));
    assert.ok(reserveTile, "missing yearly replacement reserve tile");
    assert.match(reserveTile.textContent, /\$400/);
    assert.equal(reserveTile.title, "Estimated yearly reserve to replace owned equipment: replacement cost divided by expected lifespan.");
    assert.equal(document.querySelector(".trellis-eq-tab").title, "Open Inventory tab.");
    assert.equal(Array.from(document.querySelectorAll("button")).find(button => button.textContent === "Save").title, "Save equipment changes to the selected garden module.");
    clickText(document, ".trellis-eq-editor-tab", "Maintenance & Costs");
    assert.equal(fieldInput(document, "Replacement Cost ($)").title, "Gross future cost to replace this item; used in yearly replacement reserve estimates.");
    assert.equal(fieldInput(document, "Maintenance Cost ($)").title, "Recurring maintenance cost each interval; separate from replacement reserve.");
    clickText(document, ".trellis-eq-editor-tab", "Capabilities & Tasks");
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
    assert.match(report.items.map(item => item.message).join("\n"), /missing capability/);
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
    const effectsTab = Array.from(document.querySelectorAll(".trellis-eq-editor-tab")).find(entry => entry.textContent === "Efficiency Effects");
    assert.ok(effectsTab, "missing equipment effects tab");
    effectsTab.click();
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

    clickText(document, ".trellis-eq-tab", "Task Types");
    const taskName = fieldInput(document, "Name");
    typeValue(document, taskName, "Bed Prep Custom");
    assert.equal(document.activeElement, taskName);
    assert.equal(document.body.contains(taskName), true);

    clickText(document, ".trellis-eq-tab", "Capabilities");
    const capabilityName = fieldInput(document, "Name");
    typeValue(document, capabilityName, "Custom Capability Name");
    assert.equal(document.activeElement, capabilityName);
    assert.equal(document.body.contains(capabilityName), true);
});

test("typing checklist search and notes keeps focus", () => {
    const { api, moduleCell, document } = loadPlugin();
    api.openDialog(moduleCell);
    clickText(document, ".trellis-eq-editor-tab", "Capabilities & Tasks");
    const search = document.querySelector(".trellis-eq-checklist-search");
    assert.ok(search, "missing checklist search");
    typeValue(document, search, "prun");
    assert.equal(document.activeElement, search);
    assert.equal(document.body.contains(search), true);

    clickText(document, ".trellis-eq-editor-tab", "Notes");
    const notes = fieldInput(document, "Notes");
    typeValue(document, notes, "Stored by the back gate");
    assert.equal(document.activeElement, notes);
    assert.equal(document.body.contains(notes), true);
});

test("grouped equipment links show display names and bulk select whole crop categories", async () => {
    const { api, moduleCell, document } = loadPlugin({
        plantOptions: [
            { id: "10", name: "Tomato", annual: 1, biennial: 0, perennial: 0 },
            { id: "11", name: "Parsley", annual: 0, biennial: 1, perennial: 0 },
            { id: "12", name: "Rhubarb", annual: 0, biennial: 0, perennial: 1 }
        ]
    });
    api.openDialog(moduleCell);
    await flushPromises();
    clickText(document, ".trellis-eq-editor-tab", "Capabilities & Tasks");

    const capabilityField = fieldElement(document, "Capabilities");
    assert.match(capabilityField.textContent, /Hand Pruning/);
    assert.doesNotMatch(capabilityField.textContent, /pruning_hand/);
    const pruningGroup = Array.from(capabilityField.querySelectorAll(".trellis-eq-check-group-head span")).find(entry => entry.textContent === "Pruning");
    assert.ok(pruningGroup, "missing promoted pruning group");

    const cropsField = fieldElement(document, "Relevant Crops");
    assert.match(cropsField.textContent, /Annuals/);
    assert.match(cropsField.textContent, /Biennials/);
    assert.match(cropsField.textContent, /Perennials/);
    const annualGroup = Array.from(cropsField.querySelectorAll(".trellis-eq-check-group")).find(entry => entry.getAttribute("data-group-name") === "Annuals");
    assert.ok(annualGroup, "missing annual crop group");
    annualGroup.querySelector(".trellis-eq-check-group-head input").click();
    clickButton(document, "Save");
    assert.deepEqual(Array.from(api.readEquipmentInventory(moduleCell)[0].relevantCropIds), ["10"]);
});

test("task registry groups category first with canonical before other tasks", () => {
    const { api, moduleCell, document } = loadPlugin();
    const taskTypes = api.readTaskTypeRegistry(moduleCell);
    taskTypes.push({ id: "custom_planting", name: "Custom Planting", category: "planting", allowedQuantityBases: ["tasks"], defaultQuantityBasis: "tasks", baseHoursPerUnit: { tasks: 1 }, requiredCapabilities: [], optionalCapabilities: [], recommendedCapabilities: [] });
    api.writeTaskTypeRegistry(moduleCell, taskTypes);
    api.openDialog(moduleCell);
    clickText(document, ".trellis-eq-tab", "Task Types");
    const rows = Array.from(document.querySelectorAll(".trellis-eq-table tbody tr")).map(row => row.textContent);
    const plantingIndex = rows.findIndex(text => text === "Planting");
    assert.ok(plantingIndex >= 0, "missing planting category");
    assert.equal(rows[plantingIndex + 1], "Canonical Tasks");
    assert.ok(rows.findIndex(text => text.includes("Direct Sowing")) > plantingIndex + 1, "canonical task should follow canonical subheading");
    const otherIndex = rows.findIndex((text, index) => index > plantingIndex && text === "Other Tasks");
    assert.ok(otherIndex > plantingIndex, "other tasks should be inside planting category");
    assert.ok(rows.findIndex(text => text.includes("Custom Planting")) > otherIndex, "custom task should be under other tasks");
});

test("loaded crop and bed checklists drop unmatched legacy tokens on save", async () => {
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
    assert.deepEqual(Array.from(saved.relevantCropIds), ["10"]);
    assert.deepEqual(Array.from(saved.relevantBedConditions), ["sunExposure:full_sun", "seasonExtension:greenhouse", "cropProtection:shade_cloth"]);
});

test("fallback bed condition groups include greenhouse infrastructure options", () => {
    const { api, moduleCell, document } = loadPlugin();
    api.writeEquipmentInventory(moduleCell, [{ id: "eq_greenhouse", name: "Greenhouse Tool", category: "other", capabilities: [], relevantTaskTypes: [], relevantCropIds: [], relevantBedConditions: ["seasonExtension:greenhouse", "cropProtection:shade_cloth"], efficiencyEffects: [] }]);
    api.openDialog(moduleCell);
    clickText(document, ".trellis-eq-editor-tab", "Capabilities & Tasks");
    const field = fieldElement(document, "Relevant Bed Conditions");
    assert.match(field.textContent, /Season extension/);
    assert.match(field.textContent, /Greenhouse/);
    assert.match(field.textContent, /Heated greenhouse/);
    assert.match(field.textContent, /Crop protection/);
    assert.match(field.textContent, /Shade cloth/);
    clickButton(document, "Save");
    assert.deepEqual(Array.from(api.readEquipmentInventory(moduleCell)[0].relevantBedConditions), ["seasonExtension:greenhouse", "cropProtection:shade_cloth"]);
});

test("crop fallback textarea preserves unmatched crop ids when catalog is unavailable", () => {
    const { api, moduleCell, document } = loadPlugin();
    api.writeEquipmentInventory(moduleCell, [{ id: "eq_crop_fallback", name: "Fallback Tool", capabilities: [], relevantTaskTypes: [], relevantCropIds: ["legacy_crop"], relevantBedConditions: [], efficiencyEffects: [] }]);
    api.openDialog(moduleCell);
    clickText(document, ".trellis-eq-editor-tab", "Capabilities & Tasks");
    const cropsField = fieldElement(document, "Relevant Crops");
    assert.ok(cropsField.querySelector("textarea"), "expected crop fallback textarea");
    clickButton(document, "Save");
    assert.deepEqual(Array.from(api.readEquipmentInventory(moduleCell)[0].relevantCropIds), ["legacy_crop"]);
});

test("equipment warnings resolve capability display names", () => {
    const { api, moduleCell, taskCell } = loadPlugin();
    api.writeEquipmentInventory(moduleCell, []);
    const warnings = api.buildTaskEquipmentWarnings(taskCell, moduleCell);
    const text = warnings.map(warning => warning.message).join("\n");
    assert.match(text, /Hand Pruning/);
    assert.doesNotMatch(text, /pruning_hand/);
});

test("equipment date fields calculate replacement dates with override support", () => {
    const { api, moduleCell, document } = loadPlugin();
    api.openDialog(moduleCell);
    clickText(document, ".trellis-eq-editor-tab", "Maintenance & Costs");
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
