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
    "Garden_Beds.js" // CHANGE
); // NEW

class TestCell { // NEW
    constructor(id, value = "", style = "") { // NEW
        this.id = id; // NEW
        this.value = value; // NEW
        this.style = style; // NEW
        this.children = []; // NEW
    } // NEW

    getId() { return this.id; } // NEW
    getStyle() { return this.style; } // NEW

    getAttribute(key) { // NEW
        return this.value && this.value.nodeType === 1 ? this.value.getAttribute(key) : null; // NEW
    } // NEW
} // NEW

class TestModel { // NEW
    constructor(root) { // NEW
        this.root = root; // NEW
        this.valuesWritten = 0; // NEW
        this.listeners = new Map(); // NEW
    } // NEW

    getRoot() { return this.root; } // NEW
    getParent(cell) { return cell && cell.parent ? cell.parent : null; } // NEW
    getChildCount(cell) { return cell && cell.children ? cell.children.length : 0; } // NEW
    getChildAt(cell, index) { return cell.children[index]; } // NEW
    setValue(cell, value) { cell.value = value; this.valuesWritten++; } // NEW
    beginUpdate() {} // NEW
    endUpdate() {} // NEW
    addListener(name, fn) { // CHANGE
        if (!this.listeners.has(name)) this.listeners.set(name, []); // NEW
        this.listeners.get(name).push(fn); // NEW
    } // CHANGE
    fire(name) { (this.listeners.get(name) || []).forEach(fn => fn(this, {})); } // NEW
} // NEW

function appendChild(parent, child) { // NEW
    child.parent = parent; // NEW
    parent.children.push(child); // NEW
    return child; // NEW
} // NEW

function makeXmlCell(document, id, attrs, style = "") { // NEW
    const node = document.implementation.createDocument("", "", null).createElement("object"); // NEW
    Object.entries(attrs || {}).forEach(([key, value]) => node.setAttribute(key, value)); // NEW
    return new TestCell(id, node, style); // NEW
} // NEW

function loadPlugin(options = {}) { // NEW
    const dom = new JSDOM("<!doctype html><body><div id='graph'></div></body>"); // NEW
    const document = dom.window.document; // NEW
    const root = new TestCell("root"); // NEW
    const moduleCell = appendChild(root, makeXmlCell(document, "module", { garden_module: "1", label: "Garden" }, "swimlane;module=1")); // NEW
    const bed = appendChild(moduleCell, makeXmlCell(document, "bed", { garden_bed: "1", label: "Bed 1" })); // NEW
    const bed2 = appendChild(moduleCell, makeXmlCell(document, "bed2", { garden_bed: "1", label: "Bed 2" })); // NEW
    const model = new TestModel(root); // NEW
    const contributors = []; // NEW
    const graph = { // NEW
        __states: new Map([[bed, { x: 10, y: 20, width: 100, height: 60 }], [bed2, { x: 130, y: 20, width: 100, height: 60 }]]), // NEW
        container: document.getElementById("graph"), // NEW
        popupMenuHandler: {}, // NEW
        getModel() { return model; }, // NEW
        getSelectionCells() { return options.selectedCells || []; }, // NEW
        getSelectionCell() { return (options.selectedCells || [])[0] || null; }, // NEW
        getSelectionModel() { return { addListener() {} }; }, // NEW
        view: { // NEW
            getState: cell => graph.__states.get(cell), // NEW
            addListener() {} // NEW
        }, // NEW
        addListener() {} // NEW
    }; // NEW
    const ui = { // NEW
        editor: { graph }, // NEW
        alert(message) { ui.lastAlert = message; }, // NEW
        showDialog(div) { ui.lastDialog = div; }, // NEW
        hideDialog() { ui.hidden = true; } // NEW
    }; // NEW
    const context = { // NEW
        window: dom.window, // NEW
        document, // NEW
        console, // NEW
        setTimeout(fn) { fn(); }, // NEW
        Draw: { loadPlugin(callback) { callback(ui); } }, // NEW
        mxEvent: { CHANGE: "change", SCALE: "scale", TRANSLATE: "translate", SCALE_AND_TRANSLATE: "scaleAndTranslate", DESTROY: "destroy" }, // NEW
        mxUtils: { // NEW
            createXmlDocument() { return document.implementation.createDocument("", "", null); }, // NEW
            button(label, fn) { const button = document.createElement("button"); button.textContent = label; button.addEventListener("click", fn); return button; } // NEW
        } // NEW
    }; // NEW
    dom.window.TrellisContextMenu = { // NEW
        install() {}, // NEW
        register(contributor) { contributors.push(contributor); } // NEW
    }; // NEW

    vm.runInNewContext(fs.readFileSync(PLUGIN_PATH, "utf8"), context, { filename: PLUGIN_PATH }); // NEW
    return { api: dom.window.TrellisGardenBeds, legacyApi: dom.window.TrellisBedConditions, contributors, graph, model, root, moduleCell, bed, bed2, ui, document }; // CHANGE
} // NEW

function getDialogButton(ui, label) { // NEW
    const buttons = Array.from(ui.lastDialog.querySelectorAll("button")); // NEW
    const button = buttons.find(entry => entry.textContent === label); // NEW
    assert.ok(button, "missing dialog button " + label); // NEW
    return button; // NEW
} // NEW

function getDialogButtonLabels(ui) { // NEW
    return Array.from(ui.lastDialog.querySelectorAll("button")).map(button => button.textContent); // NEW
} // NEW

function chooseDialogPreset(ui, key) { // NEW
    const presetSelect = ui.lastDialog.querySelector("select"); // NEW
    assert.ok(presetSelect, "missing preset select"); // NEW
    presetSelect.value = key; // NEW
    presetSelect.dispatchEvent(new ui.lastDialog.ownerDocument.defaultView.Event("change")); // NEW
} // NEW

function getSelectedBedOverlays(graph) { // NEW
    return Array.from(graph.container.querySelectorAll(".trellis-bed-conditions-overlay")); // NEW
} // NEW

function overlayText(overlays) { // NEW
    return overlays.map(overlay => overlay.textContent).join("\n"); // NEW
} // NEW

function plainRows(rows) { // NEW
    return JSON.parse(JSON.stringify(rows)); // NEW
} // NEW

test("garden beds no longer register bed condition context menu actions", () => { // CHANGE
    const { api, legacyApi, contributors } = loadPlugin(); // CHANGE
    assert.equal(contributors.length, 0); // CHANGE
    assert.equal(legacyApi, api); // NEW
    assert.equal(api.readDefaultBedConditions, undefined); // NEW
    assert.equal(api.writeDefaultBedConditions, undefined); // NEW
}); // NEW

test("bed conditions persist, mirror, and clear safely", () => { // CHANGE
    const { api, bed } = loadPlugin(); // CHANGE
    api.writeBedConditions(bed, { // NEW
        sunExposure: "part_shade", // NEW
        soilMoisture: "bogus", // NEW
        irrigation: "drip", // NEW
        trellis: "available", // NEW
        notes: "Gets fence shade.", // NEW
        tags: ["near_path", "near_path"] // NEW
    }); // NEW

    const stored = JSON.parse(bed.getAttribute("bed_conditions_json")); // NEW
    assert.equal(bed.getAttribute("label"), "Bed 1"); // NEW
    assert.equal(stored.soilMoisture, "unknown"); // NEW
    assert.equal(bed.getAttribute("sun_exposure"), "part_shade"); // NEW
    assert.equal(bed.getAttribute("irrigation"), "drip"); // NEW
    assert.equal(bed.getAttribute("trellis"), "available"); // NEW
    assert.equal(bed.getAttribute("season_extension"), "unknown"); // NEW
    assert.equal(bed.getAttribute("crop_protection"), "unknown"); // NEW
    assert.deepEqual(stored.tags, ["near_path"]); // NEW

    const effective = api.getDisplayBedConditions(bed); // CHANGE
    assert.equal(effective.sunExposure, "part_shade"); // NEW
    assert.equal(effective.soilTexture, "unknown"); // CHANGE
    assert.equal(effective.irrigation, "drip"); // NEW
    assert.equal(effective.trellis, "available"); // NEW
    assert.equal(effective.seasonExtension, "unknown"); // NEW
    assert.equal(effective.cropProtection, "unknown"); // NEW

    api.clearBedConditions(bed); // NEW
    assert.equal(bed.getAttribute("bed_conditions_json"), null); // NEW
    assert.equal(bed.getAttribute("sun_exposure"), null); // NEW
    assert.equal(bed.getAttribute("season_extension"), null); // NEW
    assert.equal(bed.getAttribute("crop_protection"), null); // NEW
    assert.equal(bed.getAttribute("label"), "Bed 1"); // NEW
}); // NEW

test("legacy module default attributes are ignored", () => { // CHANGE
    const { api, moduleCell, bed, model, document } = loadPlugin(); // CHANGE
    moduleCell.value.setAttribute("default_bed_conditions_json", JSON.stringify({ // NEW
        schemaVersion: 1, // NEW
        sunExposure: "full_sun", // NEW
        soilTexture: "loamy", // NEW
        irrigation: "manual" // NEW
    })); // NEW

    assert.equal(bed.getAttribute("bed_conditions_json"), null); // NEW
    const newBed = appendChild(moduleCell, makeXmlCell(document, "newBed", { garden_bed: "1", label: "New Bed" })); // NEW
    model.fire("change"); // NEW

    assert.equal(newBed.getAttribute("bed_conditions_json"), null); // CHANGE
    assert.equal(newBed.getAttribute("sun_exposure"), null); // CHANGE
    assert.equal(bed.getAttribute("bed_conditions_json"), null); // NEW
    assert.equal(moduleCell.getAttribute("default_bed_conditions_json").indexOf("full_sun") >= 0, true); // NEW

    const effective = api.getDisplayBedConditions(bed); // CHANGE
    assert.equal(effective.sunExposure, "unknown"); // NEW
    assert.equal(effective.soilTexture, "unknown"); // NEW
    assert.equal(effective.irrigation, "unknown"); // NEW
}); // NEW

test("invalid JSON and invalid enum values normalize to non-throwing fallbacks", () => { // CHANGE
    const { api, bed } = loadPlugin(); // NEW
    bed.value.setAttribute("bed_conditions_json", "{not-json"); // NEW

    assert.equal(api.readBedConditions(bed).sunExposure, "unknown"); // NEW
    assert.equal(api._test.parseProfileRecord(bed, "bed_conditions_json").invalid, true); // NEW
    assert.equal(api._test.normalizeProfile({ sunExposure: "lava", trellis: "maybe" }).sunExposure, "unknown"); // NEW
    assert.equal(api._test.normalizeProfile({ sunExposure: "lava", trellis: "maybe" }).trellis, "unknown"); // CHANGE
}); // NEW

test("bed dialog exposes copy, paste, and clear actions", () => { // CHANGE
    const setup = loadPlugin(); // NEW
    const { api, bed, bed2, ui } = setup; // CHANGE
    api.writeBedConditions(bed, { sunExposure: "full_sun", irrigation: "drip", trellis: "available" }); // NEW

    api._test.showConditionEditorDialog(bed); // CHANGE
    assert.deepEqual(getDialogButtonLabels(ui), ["Copy", "Paste", "Clear", "Cancel", "Save"]); // CHANGE
    getDialogButton(ui, "Copy").click(); // CHANGE

    setup.graph.getSelectionCells = () => [bed, bed2]; // NEW
    api._test.showConditionEditorDialog(bed2); // CHANGE
    getDialogButton(ui, "Paste").click(); // CHANGE

    assert.equal(bed2.getAttribute("sun_exposure"), "full_sun"); // NEW
    assert.equal(bed2.getAttribute("irrigation"), "drip"); // NEW
    assert.equal(bed2.getAttribute("trellis"), "available"); // NEW

    setup.graph.getSelectionCells = () => [bed2]; // NEW
    api._test.showConditionEditorDialog(bed2); // CHANGE
    getDialogButton(ui, "Clear").click(); // CHANGE
    assert.equal(bed2.getAttribute("bed_conditions_json"), null); // NEW
}); // NEW

test("selected bed overlays render for garden-bed-only selections", () => { // NEW
    const { api, bed, bed2, graph, root } = loadPlugin(); // NEW
    api.writeBedConditions(bed, { sunExposure: "full_sun", irrigation: "drip", trellis: "available" }); // NEW
    api.writeBedConditions(bed2, { soilMoisture: "moist", drainage: "slow" }); // NEW

    graph.getSelectionCells = () => [bed]; // NEW
    api._test.syncSelectedBedOverlays(); // NEW
    let overlays = getSelectedBedOverlays(graph); // NEW
    assert.equal(overlays.length, 1); // NEW
    assert.match(overlays[0].textContent, /Set Bed Conditions/); // NEW
    assert.match(overlays[0].textContent, /Sun exposureFull sun/); // NEW
    assert.equal(overlays[0].style.left, "0px"); // NEW
    assert.equal(Number.parseInt(overlays[0].style.top, 10) >= 20, true); // CHANGE

    graph.getSelectionCells = () => [bed, bed2]; // NEW
    api._test.syncSelectedBedOverlays(); // NEW
    overlays = getSelectedBedOverlays(graph); // NEW
    assert.equal(overlays.length, 2); // NEW
    assert.match(overlayText(overlays), /Soil moistureMoist/); // NEW

    graph.getSelectionCells = () => [bed, root]; // NEW
    api._test.syncSelectedBedOverlays(); // NEW
    assert.equal(getSelectedBedOverlays(graph).length, 0); // NEW

    graph.getSelectionCells = () => []; // NEW
    api._test.syncSelectedBedOverlays(); // NEW
    assert.equal(getSelectedBedOverlays(graph).length, 0); // NEW
}); // NEW

test("selected bed overlay opens the bed conditions editor", () => { // NEW
    const { api, bed, graph, ui } = loadPlugin(); // NEW
    graph.getSelectionCells = () => [bed]; // NEW
    api._test.syncSelectedBedOverlays(); // NEW

    const button = getSelectedBedOverlays(graph)[0].querySelector("button"); // NEW
    assert.equal(button.textContent, "Set Bed Conditions"); // NEW
    button.click(); // NEW
    assert.deepEqual(getDialogButtonLabels(ui), ["Copy", "Paste", "Clear", "Cancel", "Save"]); // CHANGE
}); // NEW

test("preset identity persists as selected baseline until cleared", () => { // CHANGE
    const { api, bed, ui } = loadPlugin(); // CHANGE

    api._test.showConditionEditorDialog(bed); // NEW
    chooseDialogPreset(ui, "sunny_vegetable"); // NEW
    getDialogButton(ui, "Save").click(); // NEW
    let stored = JSON.parse(bed.getAttribute("bed_conditions_json")); // NEW
    assert.equal(stored.presetKey, "sunny_vegetable"); // NEW

    api._test.showConditionEditorDialog(bed); // NEW
    ui.lastDialog.querySelectorAll("select")[1].value = "shade"; // NEW
    getDialogButton(ui, "Save").click(); // NEW
    stored = JSON.parse(bed.getAttribute("bed_conditions_json")); // NEW
    assert.equal(stored.presetKey, "sunny_vegetable"); // CHANGE

    api._test.showConditionEditorDialog(bed); // NEW
    assert.equal(ui.lastDialog.querySelector("select").value, "sunny_vegetable"); // NEW
    ui.lastDialog.querySelector("select").value = ""; // NEW
    getDialogButton(ui, "Save").click(); // NEW
    stored = JSON.parse(bed.getAttribute("bed_conditions_json")); // NEW
    assert.equal(stored.presetKey, undefined); // NEW

    api._test.showConditionEditorDialog(bed); // NEW
    chooseDialogPreset(ui, "sunny_vegetable"); // NEW
    ui.lastDialog.querySelectorAll("select")[10].value = "sheltered"; // CHANGE
    getDialogButton(ui, "Save").click(); // NEW
    stored = JSON.parse(bed.getAttribute("bed_conditions_json")); // NEW
    assert.equal(stored.presetKey, "sunny_vegetable"); // NEW
    assert.equal(stored.windExposure, "sheltered"); // NEW
}); // NEW

test("greenhouse preset persists new infrastructure fields and allows extra protection", () => { // NEW
    const { api, bed, ui } = loadPlugin(); // NEW

    api._test.showConditionEditorDialog(bed); // NEW
    chooseDialogPreset(ui, "greenhouse"); // NEW
    getDialogButton(ui, "Save").click(); // NEW
    let stored = JSON.parse(bed.getAttribute("bed_conditions_json")); // NEW
    assert.equal(stored.presetKey, "greenhouse"); // NEW
    assert.equal(stored.seasonExtension, "greenhouse"); // NEW
    assert.equal(stored.cropProtection, "unknown"); // NEW
    assert.equal(stored.bedUse, "seed_starting"); // NEW
    assert.equal(bed.getAttribute("season_extension"), "greenhouse"); // NEW
    assert.equal(bed.getAttribute("crop_protection"), "unknown"); // NEW

    api._test.showConditionEditorDialog(bed); // NEW
    ui.lastDialog.querySelectorAll("select")[9].value = "shade_cloth"; // NEW
    getDialogButton(ui, "Save").click(); // NEW
    stored = JSON.parse(bed.getAttribute("bed_conditions_json")); // NEW
    assert.equal(stored.presetKey, "greenhouse"); // NEW
    assert.equal(stored.cropProtection, "shade_cloth"); // NEW
}); // NEW

test("condition option groups expose season extension and crop protection", () => { // NEW
    const { api } = loadPlugin(); // NEW
    const groups = api.listConditionOptionGroups(); // NEW
    const season = groups.find(group => group.id === "seasonExtension"); // NEW
    const protection = groups.find(group => group.id === "cropProtection"); // NEW
    assert.ok(season, "missing season extension group"); // NEW
    assert.ok(protection, "missing crop protection group"); // NEW
    assert.deepEqual(plainRows(season.options.map(option => option.id)), ["seasonExtension:none", "seasonExtension:row_cover", "seasonExtension:low_tunnel", "seasonExtension:cold_frame", "seasonExtension:greenhouse", "seasonExtension:high_tunnel", "seasonExtension:heated_greenhouse"]); // CHANGE
    assert.deepEqual(plainRows(protection.options.map(option => option.id)), ["cropProtection:none", "cropProtection:shade_cloth", "cropProtection:insect_netting", "cropProtection:bird_netting", "cropProtection:hail_netting"]); // CHANGE
}); // NEW

test("overlay summary shows presets, extras, and set values without unknowns", () => { // NEW
    const { api, bed } = loadPlugin(); // NEW

    let rows = api._test.buildOverlayRows(api.writeBedConditions(bed, { // NEW
        presetKey: "sunny_vegetable", // NEW
        sunExposure: "full_sun", // NEW
        soilMoisture: "moderate", // NEW
        drainage: "normal", // NEW
        soilTexture: "loamy", // NEW
        fertility: "high", // NEW
        irrigation: "manual", // NEW
        trellis: "none", // NEW
        seasonExtension: "none", // NEW
        cropProtection: "shade_cloth", // NEW
        bedUse: "annuals", // NEW
        windExposure: "exposed" // NEW
    })); // NEW
    assert.deepEqual(plainRows(rows), [ // CHANGE
        { label: "Preset", value: "Sunny vegetable bed" }, // NEW
        { type: "heading", label: "Additional" }, // NEW
        { label: "Irrigation", value: "Manual" }, // NEW
        { label: "Crop protection", value: "Shade cloth" }, // NEW
        { label: "Wind exposure", value: "Exposed" } // NEW
    ]); // NEW

    rows = api._test.buildOverlayRows(api.writeBedConditions(bed, { // NEW
        presetKey: "sunny_vegetable", // NEW
        sunExposure: "shade", // NEW
        soilMoisture: "moderate", // NEW
        drainage: "normal", // NEW
        soilTexture: "loamy", // NEW
        fertility: "high", // NEW
        irrigation: "manual", // NEW
        bedUse: "annuals" // NEW
    })); // NEW
    assert.deepEqual(plainRows(rows), [ // NEW
        { label: "Preset", value: "Sunny vegetable bed" }, // NEW
        { type: "heading", label: "Preset overrides" }, // NEW
        { label: "Sun exposure", value: "Shade" }, // NEW
        { type: "heading", label: "Additional" }, // NEW
        { label: "Irrigation", value: "Manual" } // NEW
    ]); // NEW

    rows = api._test.buildOverlayRows(api.writeBedConditions(bed, { // NEW
        sunExposure: "part_shade", // NEW
        soilMoisture: "unknown", // NEW
        irrigation: "drip", // NEW
        trellis: "none", // NEW
        seasonExtension: "none", // NEW
        cropProtection: "none", // NEW
        bedUse: "perennials" // NEW
    })); // NEW
    assert.deepEqual(plainRows(rows), [ // NEW
        { label: "Sun exposure", value: "Part shade" }, // NEW
        { label: "Irrigation", value: "Drip" }, // NEW
        { label: "Bed use", value: "Perennials" } // NEW
    ]); // NEW
}); // NEW

test("season extension defaults and overrides normalize for scheduler use", () => { // NEW
    const { api } = loadPlugin(); // NEW
    assert.deepEqual(plainRows(api._test.seasonExtensionDefaults("greenhouse")), { airOffsetC: 3, soilOffsetC: 2, frostShiftDays: -21, minAirTempC: null }); // CHANGED
    assert.deepEqual(plainRows(api._test.seasonExtensionEffects({ seasonExtension: "row_cover" })), { seasonExtension: "row_cover", airOffsetC: 0.5, soilOffsetC: 0.5, frostShiftDays: -3, minAirTempC: null }); // CHANGED
    assert.deepEqual(plainRows(api._test.seasonExtensionEffects({ // CHANGED
        seasonExtension: "heated_greenhouse", // NEW
        seasonExtensionAirOffsetC: 4, // NEW
        seasonExtensionSoilOffsetC: 2.25, // NEW
        seasonExtensionFrostShiftDays: -30, // NEW
        seasonExtensionMinAirTempC: 6 // NEW
    })), { seasonExtension: "heated_greenhouse", airOffsetC: 4, soilOffsetC: 2.25, frostShiftDays: -30, minAirTempC: 6 }); // CHANGED
    const normalized = api._test.normalizeProfile({ seasonExtension: "greenhouse", season_extension_air_offset_c: "4.5", season_extension_min_air_temp_c: "7" }); // CHANGED
    assert.equal(normalized.seasonExtension, "greenhouse"); // NEW
    assert.equal(normalized.seasonExtensionAirOffsetC, 4.5); // NEW
    assert.equal(normalized.seasonExtensionMinAirTempC, null); // NEW
}); // NEW

test("advanced season extension UI is conditional and saves metric overrides", () => { // NEW
    const { api, bed, ui } = loadPlugin(); // NEW
    api._test.showConditionEditorDialog(bed); // NEW
    const selects = ui.lastDialog.querySelectorAll("select"); // NEW
    const advanced = ui.lastDialog.querySelector("[data-bed-season-extension-advanced='1']"); // NEW
    assert.ok(advanced, "missing advanced season extension section"); // NEW
    assert.equal(advanced.style.display, "none"); // NEW
    selects[8].value = "greenhouse"; // NEW
    selects[8].dispatchEvent(new ui.lastDialog.ownerDocument.defaultView.Event("change")); // NEW
    assert.equal(advanced.style.display, "block"); // NEW
    assert.match(advanced.textContent, /Defaults: air \+3 C, soil \+2 C, frost -21 days/); // NEW
    const inputs = advanced.querySelectorAll("input[type='number']"); // NEW
    inputs[0].value = "4.5"; // NEW
    inputs[1].value = "2.25"; // NEW
    inputs[2].value = "-30"; // NEW
    inputs[3].value = "6"; // NEW
    getDialogButton(ui, "Save").click(); // NEW
    const stored = JSON.parse(bed.getAttribute("bed_conditions_json")); // NEW
    assert.equal(stored.seasonExtension, "greenhouse"); // NEW
    assert.equal(stored.seasonExtensionAirOffsetC, 4.5); // NEW
    assert.equal(stored.seasonExtensionSoilOffsetC, 2.25); // NEW
    assert.equal(stored.seasonExtensionFrostShiftDays, -30); // NEW
    assert.equal(stored.seasonExtensionMinAirTempC, null); // NEW
    assert.equal(bed.getAttribute("season_extension_air_offset_c"), "4.5"); // NEW
}); // NEW

test("advanced season extension UI converts imperial display temperatures to stored Celsius", () => { // NEW
    const { api, moduleCell, bed, ui } = loadPlugin(); // NEW
    moduleCell.value.setAttribute("unit_system", "imperial"); // NEW
    api._test.showConditionEditorDialog(bed); // NEW
    const selects = ui.lastDialog.querySelectorAll("select"); // NEW
    const advanced = ui.lastDialog.querySelector("[data-bed-season-extension-advanced='1']"); // NEW
    selects[8].value = "heated_greenhouse"; // NEW
    selects[8].dispatchEvent(new ui.lastDialog.ownerDocument.defaultView.Event("change")); // NEW
    assert.match(advanced.textContent, /Defaults: air \+9 F, soil \+5\.4 F, frost -45 days, min 41 F/); // NEW
    const inputs = advanced.querySelectorAll("input[type='number']"); // NEW
    inputs[0].value = "41"; // NEW
    inputs[1].value = "37.4"; // NEW
    inputs[2].value = "-60"; // NEW
    inputs[3].value = "50"; // NEW
    getDialogButton(ui, "Save").click(); // NEW
    const stored = JSON.parse(bed.getAttribute("bed_conditions_json")); // NEW
    assert.equal(stored.seasonExtension, "heated_greenhouse"); // NEW
    assert.equal(stored.seasonExtensionAirOffsetC, 5); // NEW
    assert.equal(stored.seasonExtensionSoilOffsetC, 3); // NEW
    assert.equal(stored.seasonExtensionFrostShiftDays, -60); // NEW
    assert.equal(stored.seasonExtensionMinAirTempC, 10); // NEW
}); // NEW
