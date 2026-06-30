const assert = require("node:assert/strict"); // NEW
const fs = require("node:fs"); // NEW
const path = require("node:path"); // NEW
const test = require("node:test"); // NEW
const vm = require("node:vm"); // NEW
const { JSDOM } = require("jsdom"); // NEW

const PLUGIN_PATH = path.join( // NEW
    __dirname, // NEW
    "..", // NEW
    "drawio", // NEW
    "src", // NEW
    "main", // NEW
    "webapp", // NEW
    "plugins", // NEW
    "garden_planner_plugins", // NEW
    "Garden_Equipment.js" // NEW
); // NEW

class TestCell { // NEW
    constructor(id, value = "") { // NEW
        this.id = id; // NEW
        this.value = value; // NEW
        this.children = []; // NEW
    } // NEW

    getAttribute(key) { // NEW
        return this.value && this.value.nodeType === 1 ? this.value.getAttribute(key) : null; // NEW
    } // NEW
} // NEW

class TestModel { // NEW
    constructor(root) { this.root = root; this.valuesWritten = 0; } // NEW
    getRoot() { return this.root; } // NEW
    getParent(cell) { return cell && cell.parent ? cell.parent : null; } // NEW
    getChildCount(cell) { return cell && cell.children ? cell.children.length : 0; } // NEW
    getChildAt(cell, index) { return cell.children[index]; } // NEW
    setValue(cell, value) { cell.value = value; this.valuesWritten += 1; } // NEW
    beginUpdate() {} // NEW
    endUpdate() {} // NEW
} // NEW

function appendChild(parent, child) { // NEW
    child.parent = parent; // NEW
    parent.children.push(child); // NEW
    return child; // NEW
} // NEW

function makeXmlCell(document, id, attrs) { // NEW
    const node = document.implementation.createDocument("", "", null).createElement("object"); // NEW
    Object.entries(attrs || {}).forEach(([key, value]) => node.setAttribute(key, value)); // NEW
    return new TestCell(id, node); // NEW
} // NEW

function loadPlugin(options = {}) { // NEW
    const dom = new JSDOM("<!doctype html><body></body>"); // NEW
    const document = dom.window.document; // NEW
    const root = new TestCell("root"); // NEW
    const moduleCell = appendChild(root, makeXmlCell(document, "module", { garden_module: "1", label: "Garden" })); // NEW
    const taskCell = appendChild(moduleCell, makeXmlCell(document, "task", { task_type_id: "pruning" })); // NEW
    const model = new TestModel(root); // NEW
    const actions = new Map(); // NEW
    const graph = { // NEW
        popupMenuHandler: {}, // NEW
        getModel() { return model; }, // NEW
        getSelectionCells() { return options.selectedCells || [moduleCell]; }, // NEW
        fireEvent() {} // NEW
    }; // NEW
    const ui = { // NEW
        editor: { graph }, // NEW
        actions: { // NEW
            addAction(id, fn) { actions.set(id, { funct: fn, label: id }); }, // NEW
            get(id) { return actions.get(id); } // NEW
        }, // NEW
        menus: { get() { return { funct() {} }; }, addMenuItems() {} } // NEW
    }; // NEW
    if (options.plantOptions) { // NEW
        dom.window.USL = { scheduler: { listPlantOptions: async () => options.plantOptions } }; // NEW
    } // NEW
    if (options.bedConditionGroups) { // NEW
        dom.window.TrellisGardenBeds = { listConditionOptionGroups: () => options.bedConditionGroups }; // NEW
    } // NEW
    const context = { // NEW
        window: dom.window, // NEW
        document, // NEW
        console, // NEW
        Blob: dom.window.Blob, // NEW
        URL: dom.window.URL, // NEW
        FileReader: dom.window.FileReader, // NEW
        CustomEvent: dom.window.CustomEvent, // NEW
        setTimeout(fn) { fn(); }, // NEW
        alert(message) { context.lastAlert = message; }, // NEW
        confirm(message) { context.lastConfirm = message; return options.confirmResult !== false; }, // NEW
        prompt(message, value) { context.lastPrompt = message; return options.promptValue || value; }, // NEW
        Draw: { loadPlugin(callback) { callback(ui); } } // NEW
    }; // NEW
    vm.runInNewContext(fs.readFileSync(PLUGIN_PATH, "utf8"), context, { filename: PLUGIN_PATH }); // NEW
    return { api: graph.__trellisEquipment, graph, model, root, moduleCell, taskCell, document, context, actions }; // NEW
} // NEW

async function flushPromises() { // NEW
    for (let i = 0; i < 6; i++) await Promise.resolve(); // CHANGE
} // NEW

function fieldElement(document, labelText) { // NEW
    const field = Array.from(document.querySelectorAll(".trellis-eq-field")).find(entry => { // NEW
        const label = entry.querySelector("label"); // NEW
        return label && label.textContent === labelText; // NEW
    }); // NEW
    assert.ok(field, "missing field " + labelText); // NEW
    return field; // NEW
} // NEW

function clickButton(document, label) { // NEW
    const button = Array.from(document.querySelectorAll("button")).find(entry => entry.textContent === label); // NEW
    assert.ok(button, "missing button " + label); // NEW
    button.click(); // NEW
} // NEW

function clickText(document, selector, text) { // NEW
    const element = Array.from(document.querySelectorAll(selector)).find(entry => entry.textContent.includes(text)); // NEW
    assert.ok(element, "missing text " + text); // NEW
    element.click(); // NEW
    return element; // NEW
} // NEW

function fieldInput(document, labelText) { // NEW
    const field = Array.from(document.querySelectorAll(".trellis-eq-field")).find(entry => { // NEW
        const label = entry.querySelector("label"); // NEW
        return label && label.textContent === labelText; // NEW
    }); // NEW
    assert.ok(field, "missing field " + labelText); // NEW
    const input = field.querySelector("input, textarea, select"); // NEW
    assert.ok(input, "missing input for " + labelText); // NEW
    return input; // NEW
} // NEW

function typeValue(document, input, value) { // NEW
    input.focus(); // NEW
    input.value = value; // NEW
    input.dispatchEvent(new document.defaultView.Event("input", { bubbles: true })); // NEW
} // NEW

test("defaults normalize legacy frequency effects to hours multipliers", () => { // NEW
    const { api } = loadPlugin(); // NEW
    const timer = api.defaults.equipment.find(item => item.id === "eq_drip_timer"); // NEW
    assert.ok(timer, "expected drip timer default"); // NEW
    assert.equal(timer.efficiencyEffects[0].effectType, "hours_multiplier"); // NEW
    assert.match(timer.efficiencyEffects[0].notes, /Converted from frequency_multiplier/); // NEW
}); // NEW

test("defaults include scheduler task type integration records", () => { // NEW
    const { api } = loadPlugin(); // NEW
    const ids = new Set(api.defaults.taskTypes.map(item => item.id)); // NEW
    ["general", "seedling_starting", "hardening_off", "thinning_check"].forEach(id => { // NEW
        assert.equal(ids.has(id), true, "missing task type " + id); // NEW
    }); // NEW
}); // NEW

test("yearly replacement reserve counts owned capital only", () => { // NEW
    const { api } = loadPlugin(); // NEW
    assert.equal(api.__test.yearlyReplacementReserve({ status: "owned", replacementCost: 1200, resaleValue: 900, maintenanceCost: 99, expectedLifespanYears: 4 }), 300); // NEW
    assert.equal(api.__test.yearlyReplacementReserve({ status: "needs_repair", replacementCost: 600, expectedLifespanYears: 3 }), 200); // NEW
    ["rented", "borrowed", "wishlist", "unavailable"].forEach(status => { // NEW
        assert.equal(api.__test.yearlyReplacementReserve({ status, replacementCost: 1000, expectedLifespanYears: 1 }), 0); // NEW
    }); // NEW
    assert.equal(api.__test.yearlyReplacementReserve({ status: "owned", replacementCost: 500, expectedLifespanYears: 0 }), 0); // NEW
    assert.equal(api.__test.yearlyReplacementReserve({ status: "owned", replacementCost: -500, expectedLifespanYears: 5 }), 0); // NEW
}); // NEW

test("equipment dialog shows yearly reserve tile and native tooltips", () => { // NEW
    const { api, moduleCell, document } = loadPlugin(); // NEW
    api.writeEquipmentInventory(moduleCell, [ // NEW
        { id: "eq_owned", name: "Owned Tool", status: "owned", replacementCost: 1000, resaleValue: 900, maintenanceCost: 999, expectedLifespanYears: 5, capabilities: [], relevantTaskTypes: [], efficiencyEffects: [] }, // NEW
        { id: "eq_repair", name: "Repair Tool", status: "needs_repair", replacementCost: 600, expectedLifespanYears: 3, capabilities: [], relevantTaskTypes: [], efficiencyEffects: [] }, // NEW
        { id: "eq_rented", name: "Rented Tool", status: "rented", replacementCost: 1000, expectedLifespanYears: 1, capabilities: [], relevantTaskTypes: [], efficiencyEffects: [] } // NEW
    ]); // NEW
    api.openDialog(moduleCell); // NEW
    const title = document.querySelector(".trellis-eq-title"); // NEW
    assert.equal(title.textContent, "Garden Equipment & Workload Assumptions"); // NEW
    const reserveTile = Array.from(document.querySelectorAll(".trellis-eq-tile")).find(tile => tile.textContent.includes("Yearly Replacement")); // NEW
    assert.ok(reserveTile, "missing yearly replacement reserve tile"); // NEW
    assert.match(reserveTile.textContent, /\$400/); // NEW
    assert.equal(reserveTile.title, "Estimated yearly reserve to replace owned equipment: replacement cost divided by expected lifespan."); // NEW
    assert.equal(document.querySelector(".trellis-eq-tab").title, "Open Inventory tab."); // NEW
    assert.equal(Array.from(document.querySelectorAll("button")).find(button => button.textContent === "Save").title, "Save equipment changes to the selected garden module."); // NEW
    clickText(document, ".trellis-eq-editor-tab", "Maintenance & Costs"); // NEW
    assert.equal(fieldInput(document, "Replacement Cost ($)").title, "Gross future cost to replace this item; used in yearly replacement reserve estimates."); // NEW
    assert.equal(fieldInput(document, "Maintenance Cost ($)").title, "Recurring maintenance cost each interval; separate from replacement reserve."); // NEW
    clickText(document, ".trellis-eq-editor-tab", "Capabilities & Tasks"); // NEW
    assert.equal(document.querySelector(".trellis-eq-checklist-search").title, "Search visible options by display name."); // NEW
    assert.match(document.querySelector(".trellis-eq-check-group-head input").title, /Select or clear all/); // NEW
}); // NEW

test("equipment inventory persists with existing module attribute schema", () => { // NEW
    const { api, moduleCell } = loadPlugin(); // NEW
    const inventory = api.readEquipmentInventory(moduleCell); // NEW
    api.writeEquipmentInventory(moduleCell, inventory.slice(0, 1)); // NEW
    const raw = JSON.parse(moduleCell.getAttribute(api.attrs.EQUIPMENT_INVENTORY_JSON)); // NEW
    assert.equal(raw.version, 1); // NEW
    assert.equal(raw.items.length, 1); // NEW
    assert.equal(raw.items[0].id, inventory[0].id); // NEW
}); // NEW

test("validation blocks missing references and invalid effect rows", () => { // NEW
    const { api } = loadPlugin(); // NEW
    const report = api.__test.validateEquipmentState( // NEW
        [{ id: "eq_bad", name: "Bad", capabilities: ["missing_cap"], relevantTaskTypes: ["missing_task"], efficiencyEffects: [{ taskTypeId: "missing_task", effectType: "hours_multiplier", multiplier: 0, minimumScale: { value: 1, unit: "tasks" } }] }], // NEW
        [], // NEW
        [] // NEW
    ); // NEW
    assert.ok(report.errors >= 3); // NEW
    assert.match(report.items.map(item => item.message).join("\n"), /missing capability/); // NEW
}); // NEW

test("capability rename repairs equipment and task type references", () => { // NEW
    const { api } = loadPlugin(); // NEW
    const state = { // NEW
        capabilities: [{ id: "old_cap", name: "Old" }], // NEW
        inventory: [{ id: "eq", name: "Tool", capabilities: ["old_cap"], relevantTaskTypes: [], efficiencyEffects: [] }], // NEW
        taskTypes: [{ id: "task", name: "Task", requiredCapabilities: ["old_cap"], optionalCapabilities: [], recommendedCapabilities: [] }] // NEW
    }; // NEW
    assert.equal(api.__test.renameCapabilityId(state, "old_cap", "new_cap"), true); // NEW
    assert.deepEqual(Array.from(state.inventory[0].capabilities), ["new_cap"]); // CHANGE
    assert.deepEqual(Array.from(state.taskTypes[0].requiredCapabilities), ["new_cap"]); // CHANGE
    assert.equal(state.capabilities[0].id, "new_cap"); // NEW
}); // NEW

test("task type delete removes dependent links and effects", () => { // NEW
    const { api } = loadPlugin(); // NEW
    const state = { // NEW
        capabilities: [], // NEW
        inventory: [{ id: "eq", name: "Tool", capabilities: [], relevantTaskTypes: ["task"], efficiencyEffects: [{ taskTypeId: "task", effectType: "hours_multiplier", multiplier: 0.8, minimumScale: { value: 0, unit: "tasks" } }] }], // NEW
        taskTypes: [{ id: "task", name: "Task", requiredCapabilities: [], optionalCapabilities: [], recommendedCapabilities: [] }] // NEW
    }; // NEW
    assert.equal(api.__test.deleteTaskTypeId(state, "task"), true); // NEW
    assert.deepEqual(Array.from(state.inventory[0].relevantTaskTypes), []); // CHANGE
    assert.deepEqual(Array.from(state.inventory[0].efficiencyEffects), []); // CHANGE
    assert.deepEqual(state.taskTypes, []); // NEW
}); // NEW

test("import preview merges with imported records winning", () => { // NEW
    const { api } = loadPlugin(); // NEW
    const state = { // NEW
        inventory: [{ id: "eq_a", name: "Old", capabilities: [], relevantTaskTypes: [], efficiencyEffects: [] }, { id: "eq_b", name: "Keep", capabilities: [], relevantTaskTypes: [], efficiencyEffects: [] }], // NEW
        taskTypes: [], // NEW
        capabilities: [] // NEW
    }; // NEW
    const preview = api.__test.buildImportPreview(state, { equipment: [{ id: "eq_a", name: "New", capabilities: [], relevantTaskTypes: [], efficiencyEffects: [] }] }); // NEW
    assert.equal(preview.report.errors, 0); // NEW
    assert.equal(preview.inventory.find(item => item.id === "eq_a").name, "New"); // NEW
    assert.equal(preview.inventory.find(item => item.id === "eq_b").name, "Keep"); // NEW
}); // NEW

test("structured effect editor can add and persist an effect", () => { // NEW
    const { api, moduleCell, document } = loadPlugin(); // NEW
    api.openDialog(moduleCell); // NEW
    const effectsTab = Array.from(document.querySelectorAll(".trellis-eq-editor-tab")).find(entry => entry.textContent === "Efficiency Effects"); // NEW
    assert.ok(effectsTab, "missing equipment effects tab"); // NEW
    effectsTab.click(); // NEW
    clickButton(document, "Add Effect"); // NEW
    clickButton(document, "Save"); // NEW
    const saved = api.readEquipmentInventory(moduleCell); // NEW
    assert.ok(saved[0].efficiencyEffects.length >= 1); // NEW
    assert.equal(saved[0].efficiencyEffects.at(-1).effectType, "hours_multiplier"); // NEW
}); // NEW

test("typing names does not replace the focused input", () => { // NEW
    const { api, moduleCell, document } = loadPlugin(); // NEW
    api.openDialog(moduleCell); // NEW
    const equipmentName = fieldInput(document, "Name"); // NEW
    typeValue(document, equipmentName, "Wheelbarrow Pro"); // NEW
    assert.equal(document.activeElement, equipmentName); // NEW
    assert.equal(document.body.contains(equipmentName), true); // NEW

    clickText(document, ".trellis-eq-tab", "Task Types"); // NEW
    const taskName = fieldInput(document, "Name"); // NEW
    typeValue(document, taskName, "Bed Prep Custom"); // NEW
    assert.equal(document.activeElement, taskName); // NEW
    assert.equal(document.body.contains(taskName), true); // NEW

    clickText(document, ".trellis-eq-tab", "Capabilities"); // NEW
    const capabilityName = fieldInput(document, "Name"); // NEW
    typeValue(document, capabilityName, "Custom Capability Name"); // NEW
    assert.equal(document.activeElement, capabilityName); // NEW
    assert.equal(document.body.contains(capabilityName), true); // NEW
}); // NEW

test("typing checklist search and notes keeps focus", () => { // NEW
    const { api, moduleCell, document } = loadPlugin(); // NEW
    api.openDialog(moduleCell); // NEW
    clickText(document, ".trellis-eq-editor-tab", "Capabilities & Tasks"); // NEW
    const search = document.querySelector(".trellis-eq-checklist-search"); // NEW
    assert.ok(search, "missing checklist search"); // NEW
    typeValue(document, search, "prun"); // NEW
    assert.equal(document.activeElement, search); // NEW
    assert.equal(document.body.contains(search), true); // NEW

    clickText(document, ".trellis-eq-editor-tab", "Notes"); // NEW
    const notes = fieldInput(document, "Notes"); // NEW
    typeValue(document, notes, "Stored by the back gate"); // NEW
    assert.equal(document.activeElement, notes); // NEW
    assert.equal(document.body.contains(notes), true); // NEW
}); // NEW

test("grouped equipment links show display names and bulk select whole crop categories", async () => { // NEW
    const { api, moduleCell, document } = loadPlugin({ // NEW
        plantOptions: [ // NEW
            { id: "10", name: "Tomato", annual: 1, biennial: 0, perennial: 0 }, // NEW
            { id: "11", name: "Parsley", annual: 0, biennial: 1, perennial: 0 }, // NEW
            { id: "12", name: "Rhubarb", annual: 0, biennial: 0, perennial: 1 } // NEW
        ] // NEW
    }); // NEW
    api.openDialog(moduleCell); // NEW
    await flushPromises(); // NEW
    clickText(document, ".trellis-eq-editor-tab", "Capabilities & Tasks"); // NEW

    const capabilityField = fieldElement(document, "Capabilities"); // NEW
    assert.match(capabilityField.textContent, /Hand Pruning/); // NEW
    assert.doesNotMatch(capabilityField.textContent, /pruning_hand/); // NEW
    const pruningGroup = Array.from(capabilityField.querySelectorAll(".trellis-eq-check-group-head span")).find(entry => entry.textContent === "Pruning"); // NEW
    assert.ok(pruningGroup, "missing promoted pruning group"); // NEW

    const cropsField = fieldElement(document, "Relevant Crops"); // NEW
    assert.match(cropsField.textContent, /Annuals/); // NEW
    assert.match(cropsField.textContent, /Biennials/); // NEW
    assert.match(cropsField.textContent, /Perennials/); // NEW
    const annualGroup = Array.from(cropsField.querySelectorAll(".trellis-eq-check-group")).find(entry => entry.getAttribute("data-group-name") === "Annuals"); // NEW
    assert.ok(annualGroup, "missing annual crop group"); // NEW
    annualGroup.querySelector(".trellis-eq-check-group-head input").click(); // NEW
    clickButton(document, "Save"); // NEW
    assert.deepEqual(Array.from(api.readEquipmentInventory(moduleCell)[0].relevantCropIds), ["10"]); // CHANGE
}); // NEW

test("task registry groups category first with canonical before other tasks", () => { // NEW
    const { api, moduleCell, document } = loadPlugin(); // NEW
    const taskTypes = api.readTaskTypeRegistry(moduleCell); // NEW
    taskTypes.push({ id: "custom_planting", name: "Custom Planting", category: "planting", allowedQuantityBases: ["tasks"], defaultQuantityBasis: "tasks", baseHoursPerUnit: { tasks: 1 }, requiredCapabilities: [], optionalCapabilities: [], recommendedCapabilities: [] }); // NEW
    api.writeTaskTypeRegistry(moduleCell, taskTypes); // NEW
    api.openDialog(moduleCell); // NEW
    clickText(document, ".trellis-eq-tab", "Task Types"); // NEW
    const rows = Array.from(document.querySelectorAll(".trellis-eq-table tbody tr")).map(row => row.textContent); // CHANGE
    const plantingIndex = rows.findIndex(text => text === "Planting"); // NEW
    assert.ok(plantingIndex >= 0, "missing planting category"); // NEW
    assert.equal(rows[plantingIndex + 1], "Canonical Tasks"); // CHANGE
    assert.ok(rows.findIndex(text => text.includes("Direct Sowing")) > plantingIndex + 1, "canonical task should follow canonical subheading"); // NEW
    const otherIndex = rows.findIndex((text, index) => index > plantingIndex && text === "Other Tasks"); // NEW
    assert.ok(otherIndex > plantingIndex, "other tasks should be inside planting category"); // NEW
    assert.ok(rows.findIndex(text => text.includes("Custom Planting")) > otherIndex, "custom task should be under other tasks"); // CHANGE
}); // NEW

test("loaded crop and bed checklists drop unmatched legacy tokens on save", async () => { // NEW
    const { api, moduleCell, document } = loadPlugin({ // NEW
        plantOptions: [{ id: "10", name: "Tomato", annual: 1, biennial: 0, perennial: 0 }] // NEW
    }); // NEW
    api.writeEquipmentInventory(moduleCell, [{ // NEW
        id: "eq_legacy", name: "Legacy Tool", category: "other", capabilities: [], relevantTaskTypes: [], relevantCropIds: ["10", "missing_crop"], relevantBedConditions: ["sunExposure:full_sun", "seasonExtension:greenhouse", "cropProtection:shade_cloth", "legacy_condition"], efficiencyEffects: [] // CHANGE
    }]); // NEW
    api.openDialog(moduleCell); // NEW
    await flushPromises(); // NEW
    clickButton(document, "Save"); // NEW
    const saved = api.readEquipmentInventory(moduleCell)[0]; // NEW
    assert.deepEqual(Array.from(saved.relevantCropIds), ["10"]); // CHANGE
    assert.deepEqual(Array.from(saved.relevantBedConditions), ["sunExposure:full_sun", "seasonExtension:greenhouse", "cropProtection:shade_cloth"]); // CHANGE
}); // NEW

test("fallback bed condition groups include greenhouse infrastructure options", () => { // NEW
    const { api, moduleCell, document } = loadPlugin(); // NEW
    api.writeEquipmentInventory(moduleCell, [{ id: "eq_greenhouse", name: "Greenhouse Tool", category: "other", capabilities: [], relevantTaskTypes: [], relevantCropIds: [], relevantBedConditions: ["seasonExtension:greenhouse", "cropProtection:shade_cloth"], efficiencyEffects: [] }]); // NEW
    api.openDialog(moduleCell); // NEW
    clickText(document, ".trellis-eq-editor-tab", "Capabilities & Tasks"); // NEW
    const field = fieldElement(document, "Relevant Bed Conditions"); // NEW
    assert.match(field.textContent, /Season extension/); // NEW
    assert.match(field.textContent, /Greenhouse/); // NEW
    assert.match(field.textContent, /Heated greenhouse/); // NEW
    assert.match(field.textContent, /Crop protection/); // NEW
    assert.match(field.textContent, /Shade cloth/); // NEW
    clickButton(document, "Save"); // NEW
    assert.deepEqual(Array.from(api.readEquipmentInventory(moduleCell)[0].relevantBedConditions), ["seasonExtension:greenhouse", "cropProtection:shade_cloth"]); // NEW
}); // NEW

test("crop fallback textarea preserves unmatched crop ids when catalog is unavailable", () => { // NEW
    const { api, moduleCell, document } = loadPlugin(); // NEW
    api.writeEquipmentInventory(moduleCell, [{ id: "eq_crop_fallback", name: "Fallback Tool", capabilities: [], relevantTaskTypes: [], relevantCropIds: ["legacy_crop"], relevantBedConditions: [], efficiencyEffects: [] }]); // NEW
    api.openDialog(moduleCell); // NEW
    clickText(document, ".trellis-eq-editor-tab", "Capabilities & Tasks"); // NEW
    const cropsField = fieldElement(document, "Relevant Crops"); // NEW
    assert.ok(cropsField.querySelector("textarea"), "expected crop fallback textarea"); // NEW
    clickButton(document, "Save"); // NEW
    assert.deepEqual(Array.from(api.readEquipmentInventory(moduleCell)[0].relevantCropIds), ["legacy_crop"]); // CHANGE
}); // NEW

test("equipment warnings resolve capability display names", () => { // NEW
    const { api, moduleCell, taskCell } = loadPlugin(); // NEW
    api.writeEquipmentInventory(moduleCell, []); // NEW
    const warnings = api.buildTaskEquipmentWarnings(taskCell, moduleCell); // NEW
    const text = warnings.map(warning => warning.message).join("\n"); // NEW
    assert.match(text, /Hand Pruning/); // NEW
    assert.doesNotMatch(text, /pruning_hand/); // NEW
}); // NEW

test("equipment date fields calculate replacement dates with override support", () => { // NEW
    const { api, moduleCell, document } = loadPlugin(); // NEW
    api.openDialog(moduleCell); // NEW
    clickText(document, ".trellis-eq-editor-tab", "Maintenance & Costs"); // NEW
    const lifespan = fieldInput(document, "Expected Lifespan (years)"); // NEW
    const purchase = fieldInput(document, "Purchase Date"); // NEW
    const override = fieldInput(document, "Override Replacement Date"); // NEW
    const replacement = fieldInput(document, "Replacement Date"); // NEW

    assert.equal(purchase.type, "date"); // NEW
    assert.equal(replacement.type, "date"); // NEW
    assert.equal(replacement.disabled, true); // NEW
    typeValue(document, lifespan, "1"); // NEW
    typeValue(document, purchase, "2024-02-29"); // NEW
    assert.equal(replacement.value, "2025-02-28"); // NEW

    override.checked = true; // NEW
    override.dispatchEvent(new document.defaultView.Event("change", { bubbles: true })); // NEW
    assert.equal(replacement.disabled, false); // NEW
    typeValue(document, replacement, "2030-01-01"); // NEW
    clickButton(document, "Save"); // NEW
    const saved = api.readEquipmentInventory(moduleCell)[0]; // NEW
    assert.equal(saved.replacementDateOverride, true); // NEW
    assert.equal(saved.replacementDate, "2030-01-01"); // NEW
}); // NEW

test("date normalization infers legacy overrides and blocks invalid saved dates", () => { // NEW
    const { api, moduleCell, document, context } = loadPlugin(); // NEW
    assert.equal(api.__test.calculateReplacementDate("2024-02-29", 1), "2025-02-28"); // NEW
    const calculated = api.__test.normalizeEquipment({ id: "eq_calc", name: "Calc", purchaseDate: "2020-01-15", expectedLifespanYears: 5 }); // NEW
    assert.equal(calculated.replacementDateOverride, false); // NEW
    assert.equal(calculated.replacementDate, "2025-01-15"); // NEW
    const overridden = api.__test.normalizeEquipment({ id: "eq_override", name: "Override", purchaseDate: "2020-01-15", expectedLifespanYears: 5, replacementDate: "2026-01-15" }); // NEW
    assert.equal(overridden.replacementDateOverride, true); // NEW
    assert.equal(overridden.replacementDate, "2026-01-15"); // NEW

    api.writeEquipmentInventory(moduleCell, [{ id: "eq_bad_date", name: "Bad Date", purchaseDate: "2024-02-31", capabilities: [], relevantTaskTypes: [], efficiencyEffects: [] }]); // NEW
    api.openDialog(moduleCell); // NEW
    clickButton(document, "Save"); // NEW
    assert.equal(context.lastAlert, "Fix equipment validation errors before saving."); // NEW
}); // NEW
