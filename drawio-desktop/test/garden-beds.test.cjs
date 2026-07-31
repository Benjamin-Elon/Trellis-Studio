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
    "Garden_Beds.js"
);

class TestCell {
    constructor(id, value = "", style = "") {
        this.id = id;
        this.value = value;
        this.style = style;
        this.children = [];
    }

    getId() { return this.id; }
    getStyle() { return this.style; }

    getAttribute(key) {
        return this.value && this.value.nodeType === 1 ? this.value.getAttribute(key) : null;
    }
}

class TestModel {
    constructor(root) {
        this.root = root;
        this.valuesWritten = 0;
        this.listeners = new Map();
    }

    getRoot() { return this.root; }
    getParent(cell) { return cell && cell.parent ? cell.parent : null; }
    getChildCount(cell) { return cell && cell.children ? cell.children.length : 0; }
    getChildAt(cell, index) { return cell.children[index]; }
    setValue(cell, value) { cell.value = value; this.valuesWritten++; }
    beginUpdate() {}
    endUpdate() {}
    addListener(name, fn) {
        if (!this.listeners.has(name)) this.listeners.set(name, []);
        this.listeners.get(name).push(fn);
    }
    fire(name) { (this.listeners.get(name) || []).forEach(fn => fn(this, {})); }
}

function appendChild(parent, child) {
    child.parent = parent;
    parent.children.push(child);
    return child;
}

function makeXmlCell(document, id, attrs, style = "") {
    const node = document.implementation.createDocument("", "", null).createElement("object");
    Object.entries(attrs || {}).forEach(([key, value]) => node.setAttribute(key, value));
    return new TestCell(id, node, style);
}

function loadPlugin(options = {}) {
    const dom = new JSDOM("<!doctype html><body><div id='graph'></div></body>");
    if (options.innerHeight != null) Object.defineProperty(dom.window, "innerHeight", { value: options.innerHeight, configurable: true });
    const document = dom.window.document;
    const root = new TestCell("root");
    const moduleCell = appendChild(root, makeXmlCell(document, "module", { garden_module: "1", label: "Garden" }, "swimlane;module=1"));
    const bed = appendChild(moduleCell, makeXmlCell(document, "bed", { garden_bed: "1", label: "Bed 1" }));
    const bed2 = appendChild(moduleCell, makeXmlCell(document, "bed2", { garden_bed: "1", label: "Bed 2" }));
    const model = new TestModel(root);
    const contributors = [];
    const graph = {
        __states: new Map([[bed, { x: 10, y: 20, width: 100, height: 60 }], [bed2, { x: 130, y: 20, width: 100, height: 60 }]]),
        container: document.getElementById("graph"),
        popupMenuHandler: {},
        getModel() { return model; },
        getSelectionCells() { return options.selectedCells || []; },
        getSelectionCell() { return (options.selectedCells || [])[0] || null; },
        getSelectionModel() { return { addListener() {} }; },
        view: {
            getState: cell => graph.__states.get(cell),
            addListener() {}
        },
        addListener() {}
    };
    if (options.irrigationMethods) graph.__trellisIrrigationPlanner = { getBedIrrigationMethods() { return options.irrigationMethods; } };
    const ui = {
        editor: { graph },
        alert(message) { ui.lastAlert = message; },
        showDialog(div, width, height, modal, closable) { ui.lastDialog = div; ui.lastDialogArgs = { width, height, modal, closable }; },
        hideDialog() { ui.hidden = true; }
    };
    const context = {
        window: dom.window,
        document,
        console,
        setTimeout(fn) { fn(); },
        Draw: { loadPlugin(callback) { callback(ui); } },
        mxEvent: { CHANGE: "change", SCALE: "scale", TRANSLATE: "translate", SCALE_AND_TRANSLATE: "scaleAndTranslate", DESTROY: "destroy" },
        mxUtils: {
            createXmlDocument() { return document.implementation.createDocument("", "", null); },
            button(label, fn) { const button = document.createElement("button"); button.textContent = label; button.addEventListener("click", fn); return button; }
        }
    };
    dom.window.TrellisContextMenu = {
        install() {},
        register(contributor) { contributors.push(contributor); }
    };

    vm.runInNewContext(fs.readFileSync(PLUGIN_PATH, "utf8"), context, { filename: PLUGIN_PATH });
    return { api: dom.window.TrellisGardenBeds, legacyApi: dom.window.TrellisBedConditions, contributors, graph, model, root, moduleCell, bed, bed2, ui, document };
}

function getDialogButton(ui, label) {
    const buttons = Array.from(ui.lastDialog.querySelectorAll("button"));
    const button = buttons.find(entry => entry.textContent === label);
    assert.ok(button, "missing dialog button " + label);
    return button;
}

function getDialogButtonLabels(ui) {
    return Array.from(ui.lastDialog.querySelectorAll("button")).map(button => button.textContent);
}

function chooseDialogPreset(ui, key) {
    const presetSelect = getDialogFieldControl(ui, "Preset");
    assert.ok(presetSelect, "missing preset select");
    presetSelect.value = key;
    presetSelect.dispatchEvent(new ui.lastDialog.ownerDocument.defaultView.Event("change"));
}

function getDialogSection(ui, title) {
    const body = ui.lastDialog.querySelector("[data-bed-conditions-dialog-body='1']");
    assert.ok(body, "missing dialog body");
    const section = Array.from(body.children).find(child => child.firstChild && child.firstChild.textContent === title);
    assert.ok(section, "missing dialog section " + title);
    return section;
}

function getSectionFieldLabels(ui, title) {
    return Array.from(getDialogSection(ui, title).children)
        .filter(child => child.tagName === "LABEL")
        .map(child => child.firstChild.textContent);
}

function getDialogFieldControl(ui, labelText) {
    const labels = Array.from(ui.lastDialog.querySelectorAll("label"));
    const label = labels.find(entry => entry.firstChild && entry.firstChild.textContent === labelText);
    assert.ok(label, "missing dialog field " + labelText);
    const control = label.querySelector("select, input, textarea");
    assert.ok(control, "missing dialog control " + labelText);
    return control;
}

function chooseSeasonExtension(ui, value) {
    const seasonSelect = getDialogFieldControl(ui, "Season extension");
    assert.ok(seasonSelect, "missing season extension select");
    seasonSelect.value = value;
    seasonSelect.dispatchEvent(new ui.lastDialog.ownerDocument.defaultView.Event("change"));
}

function getSelectedBedOverlays(graph) {
    return Array.from(graph.container.querySelectorAll(".trellis-bed-conditions-overlay"));
}

function overlayText(overlays) {
    return overlays.map(overlay => overlay.textContent).join("\n");
}

function getOverlayNameInput(overlay) {
    const input = overlay.querySelector("input[aria-label='User name']");
    assert.ok(input, "missing overlay bed name input");
    return input;
}

function dispatchInputKey(input, key) {
    input.dispatchEvent(new input.ownerDocument.defaultView.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
}

function plainRows(rows) {
    return JSON.parse(JSON.stringify(rows));
}

test("garden beds no longer register bed condition context menu actions", () => {
    const { api, legacyApi, contributors } = loadPlugin();
    assert.equal(contributors.length, 0);
    assert.equal(legacyApi, api);
    assert.equal(api.readDefaultBedConditions, undefined);
    assert.equal(api.writeDefaultBedConditions, undefined);
});

test("bed conditions persist, mirror, and clear safely", () => {
    const { api, bed } = loadPlugin();
    api.writeBedConditions(bed, {
        sunExposure: "part_shade",
        soilMoisture: "bogus",
        irrigation: "drip",
        trellis: "available",
        notes: "Gets fence shade.",
        tags: ["near_path", "near_path"]
    });

    const stored = JSON.parse(bed.getAttribute("bed_conditions_json"));
    assert.equal(bed.getAttribute("label"), "Bed 1");
    assert.equal(stored.soilMoisture, "unknown");
    assert.equal(bed.getAttribute("sun_exposure"), "part_shade");
    assert.equal(bed.getAttribute("irrigation"), "unknown");
    assert.equal(bed.getAttribute("trellis"), "available");
    assert.equal(bed.getAttribute("season_extension"), "unknown");
    assert.equal(bed.getAttribute("crop_protection"), "unknown");
    assert.equal(Object.prototype.hasOwnProperty.call(stored, "tags"), false);

    const effective = api.getDisplayBedConditions(bed);
    assert.equal(effective.sunExposure, "part_shade");
    assert.equal(effective.soilTexture, "unknown");
    assert.equal(effective.irrigation, "unknown");
    assert.equal(effective.trellis, "available");
    assert.equal(effective.seasonExtension, "unknown");
    assert.equal(effective.cropProtection, "unknown");
    assert.equal(Object.prototype.hasOwnProperty.call(effective, "tags"), false);

    api.clearBedConditions(bed);
    assert.equal(bed.getAttribute("bed_conditions_json"), null);
    assert.equal(bed.getAttribute("sun_exposure"), null);
    assert.equal(bed.getAttribute("season_extension"), null);
    assert.equal(bed.getAttribute("crop_protection"), null);
    assert.equal(bed.getAttribute("label"), "Bed 1");
});

test("bed identity persists separately and generates the visible label", () => {
    const { api, bed } = loadPlugin();
    api.writeBedConditions(bed, { bedType: "raised_bed", bedHeightCm: 45.72, userBedName: "East tomatoes", sunExposure: "full_sun" });

    const stored = JSON.parse(bed.getAttribute("bed_conditions_json"));
    assert.equal(stored.bedType, "raised_bed");
    assert.equal(stored.bedHeightCm, 45.72);
    assert.equal(stored.userBedName, "East tomatoes");
    assert.equal(bed.getAttribute("bed_type"), "raised_bed");
    assert.equal(bed.getAttribute("bed_height_cm"), "45.72");
    assert.equal(bed.getAttribute("user_bed_name"), "East tomatoes");
    assert.equal(bed.getAttribute("label"), "Raised bed (45.7 cm) - East tomatoes");
    assert.deepEqual(plainRows(api._test.buildOverlayRows(api.getDisplayBedConditions(bed))), [{ label: "Sun exposure", value: "Full sun" }]);
});

test("bed identity dialog saves metric height and user name", () => {
    const { api, bed, ui } = loadPlugin();
    api._test.showConditionEditorDialog(bed);

    assert.deepEqual(getSectionFieldLabels(ui, "Bed Identity"), ["Bed type", "Height (cm)", "User name"]);
    getDialogFieldControl(ui, "Bed type").value = "hugelkultur";
    getDialogFieldControl(ui, "Height (cm)").value = "60";
    getDialogFieldControl(ui, "User name").value = "North berm";
    getDialogButton(ui, "Save").click();

    const stored = JSON.parse(bed.getAttribute("bed_conditions_json"));
    assert.equal(stored.bedType, "hugelkultur");
    assert.equal(stored.bedHeightCm, 60);
    assert.equal(stored.userBedName, "North berm");
    assert.equal(bed.getAttribute("label"), "Hugelkultur (60 cm) - North berm");
});

test("bed identity follows imperial module units without changing stored centimeters", () => {
    const { api, moduleCell, bed, model, ui } = loadPlugin();
    moduleCell.value.setAttribute("unit_system", "imperial");
    api.writeBedConditions(bed, { bedType: "raised_bed", bedHeightCm: 45.72, userBedName: "East tomatoes" });
    assert.equal(bed.getAttribute("label"), "Raised bed (18 in) - East tomatoes");

    api._test.showConditionEditorDialog(bed);
    assert.equal(getDialogFieldControl(ui, "Height (in)").value, "18");
    getDialogFieldControl(ui, "Height (in)").value = "24";
    getDialogButton(ui, "Save").click();
    assert.equal(JSON.parse(bed.getAttribute("bed_conditions_json")).bedHeightCm, 60.96);
    assert.equal(bed.getAttribute("label"), "Raised bed (24 in) - East tomatoes");

    moduleCell.value.setAttribute("unit_system", "metric");
    model.fire("change");
    assert.equal(JSON.parse(bed.getAttribute("bed_conditions_json")).bedHeightCm, 60.96);
    assert.equal(bed.getAttribute("label"), "Raised bed (61 cm) - East tomatoes");
});

test("existing labels are not migrated into bed identity by default", () => {
    const { api, bed } = loadPlugin();
    assert.equal(api.readBedConditions(bed).userBedName, "");
    api.writeBedConditions(bed, { sunExposure: "shade" });
    assert.equal(bed.getAttribute("label"), "Bed 1");
    api.writeBedConditions(bed, { bedType: "field" });
    assert.equal(bed.getAttribute("label"), "Field");
});

test("legacy module default attributes are ignored", () => {
    const { api, moduleCell, bed, model, document } = loadPlugin();
    moduleCell.value.setAttribute("default_bed_conditions_json", JSON.stringify({
        schemaVersion: 1,
        sunExposure: "full_sun",
        soilTexture: "loamy",
        irrigation: "manual"
    }));

    assert.equal(bed.getAttribute("bed_conditions_json"), null);
    const newBed = appendChild(moduleCell, makeXmlCell(document, "newBed", { garden_bed: "1", label: "New Bed" }));
    model.fire("change");

    assert.equal(newBed.getAttribute("bed_conditions_json"), null);
    assert.equal(newBed.getAttribute("sun_exposure"), null);
    assert.equal(bed.getAttribute("bed_conditions_json"), null);
    assert.equal(moduleCell.getAttribute("default_bed_conditions_json").indexOf("full_sun") >= 0, true);

    const effective = api.getDisplayBedConditions(bed);
    assert.equal(effective.sunExposure, "unknown");
    assert.equal(effective.soilTexture, "unknown");
    assert.equal(effective.irrigation, "unknown");
});

test("irrigation is read-only and derived from irrigation bed assemblies", () => {
    const { api, bed, graph, ui } = loadPlugin({ irrigationMethods: [{ id: "drip_tape", label: "Drip tape" }, { id: "microspray", label: "Microspray" }] });
    api.writeBedConditions(bed, { irrigation: "drip" });

    const effective = api.getDisplayBedConditions(bed);
    assert.equal(JSON.parse(bed.getAttribute("bed_conditions_json")).irrigation, "unknown");
    assert.equal(effective.irrigation, "Drip tape, Microspray");

    api._test.showConditionEditorDialog(bed);
    const readOnly = ui.lastDialog.querySelector("[data-bed-derived-irrigation='1']");
    assert.ok(readOnly, "missing read-only derived irrigation field");
    assert.equal(readOnly.textContent, "Drip tape, Microspray");
    assert.equal(Array.from(ui.lastDialog.querySelectorAll("label")).find(label => label.firstChild && label.firstChild.textContent === "Irrigation").querySelector("select"), null);

    graph.getSelectionCells = () => [bed];
    api._test.syncSelectedBedOverlays();
    assert.match(getSelectedBedOverlays(graph)[0].textContent, /IrrigationDrip tape, Microspray/);
});

test("derived irrigation shows unknown in the editor and stays hidden in overlays when no assemblies exist", () => {
    const { api, bed, graph, ui } = loadPlugin({ irrigationMethods: [] });
    api.writeBedConditions(bed, { irrigation: "drip" });

    api._test.showConditionEditorDialog(bed);
    assert.equal(ui.lastDialog.querySelector("[data-bed-derived-irrigation='1']").textContent, "Unknown");

    graph.getSelectionCells = () => [bed];
    api._test.syncSelectedBedOverlays();
    assert.doesNotMatch(getSelectedBedOverlays(graph)[0].textContent, /Irrigation/);
});

test("invalid JSON and invalid enum values normalize to non-throwing fallbacks", () => {
    const { api, bed } = loadPlugin();
    bed.value.setAttribute("bed_conditions_json", "{not-json");

    assert.equal(api.readBedConditions(bed).sunExposure, "unknown");
    assert.equal(api._test.parseProfileRecord(bed, "bed_conditions_json").invalid, true);
    assert.equal(api._test.normalizeProfile({ sunExposure: "lava", trellis: "maybe" }).sunExposure, "unknown");
    assert.equal(api._test.normalizeProfile({ sunExposure: "lava", trellis: "maybe" }).trellis, "unknown");
});

test("legacy tags are tolerated but omitted from normalized bed profiles", () => {
    const { api, bed } = loadPlugin();
    bed.value.setAttribute("bed_conditions_json", JSON.stringify({ tags: ["near_path"], notes: "Legacy note" }));

    assert.equal(api.readBedConditions(bed).notes, "Legacy note");
    assert.equal(Object.prototype.hasOwnProperty.call(api.readBedConditions(bed), "tags"), false);
    const stored = api.writeBedConditions(bed, api.readBedConditions(bed));
    assert.equal(Object.prototype.hasOwnProperty.call(stored, "tags"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(JSON.parse(bed.getAttribute("bed_conditions_json")), "tags"), false);
});

test("bed dialog exposes copy, paste, and clear actions", () => {
    const setup = loadPlugin();
    const { api, bed, bed2, ui } = setup;
    api.writeBedConditions(bed, { bedType: "raised_bed", bedHeightCm: 30, userBedName: "Cloned name", sunExposure: "full_sun", irrigation: "drip", trellis: "available" });

    api._test.showConditionEditorDialog(bed);
    assert.deepEqual(getDialogButtonLabels(ui), ["Set as defaults", "Copy", "Paste", "Clear", "Cancel", "Save"]);
    getDialogButton(ui, "Copy").click();

    setup.graph.getSelectionCells = () => [bed, bed2];
    api._test.showConditionEditorDialog(bed2);
    getDialogButton(ui, "Paste").click();

    assert.equal(bed2.getAttribute("sun_exposure"), "full_sun");
    assert.equal(bed2.getAttribute("irrigation"), "unknown");
    assert.equal(bed2.getAttribute("trellis"), "available");
    assert.equal(bed2.getAttribute("bed_type"), "raised_bed");
    assert.equal(bed2.getAttribute("user_bed_name"), "Cloned name");
    assert.equal(bed2.getAttribute("label"), "Raised bed (30 cm) - Cloned name");

    setup.graph.getSelectionCells = () => [bed2];
    api._test.showConditionEditorDialog(bed2);
    getDialogButton(ui, "Clear").click();
    assert.equal(JSON.parse(bed2.getAttribute("bed_conditions_json")).sunExposure, "unknown");
    assert.equal(bed2.getAttribute("sun_exposure"), null);
    assert.equal(bed2.getAttribute("bed_type"), "raised_bed");
    assert.equal(bed2.getAttribute("user_bed_name"), "Cloned name");
    assert.equal(bed2.getAttribute("label"), "Raised bed (30 cm) - Cloned name");
});

test("selected bed overlays render for garden-bed-only selections", () => {
    const { api, bed, bed2, graph, root } = loadPlugin();
    api.writeBedConditions(bed, { sunExposure: "full_sun", irrigation: "drip", trellis: "available" });
    api.writeBedConditions(bed2, { soilMoisture: "moist", drainage: "slow" });

    graph.getSelectionCells = () => [bed];
    api._test.syncSelectedBedOverlays();
    let overlays = getSelectedBedOverlays(graph);
    assert.equal(overlays.length, 1);
    assert.equal(overlays[0].children[0], getOverlayNameInput(overlays[0]));
    assert.equal(overlays[0].children[1].textContent, "Set Bed Conditions");
    assert.equal(overlays[0].children[0].style.display, "block");
    assert.equal(overlays[0].children[1].style.display, "block");
    assert.equal(overlays[0].children[0].style.width, "100%");
    assert.equal(overlays[0].children[1].style.width, "100%");
    assert.equal(getOverlayNameInput(overlays[0]).value, "");
    assert.match(overlays[0].textContent, /Set Bed Conditions/);
    assert.match(overlays[0].textContent, /Sun exposureFull sun/);
    assert.equal(overlays[0].style.left, "-188px");
    assert.equal(Number.parseInt(overlays[0].style.top, 10) >= 20, true);

    graph.getSelectionCells = () => [bed, bed2];
    api._test.syncSelectedBedOverlays();
    overlays = getSelectedBedOverlays(graph);
    assert.equal(overlays.length, 2);
    assert.match(overlayText(overlays), /Soil moistureMoist/);

    graph.getSelectionCells = () => [bed, root];
    api._test.syncSelectedBedOverlays();
    assert.equal(getSelectedBedOverlays(graph).length, 0);

    graph.getSelectionCells = () => [];
    api._test.syncSelectedBedOverlays();
    assert.equal(getSelectedBedOverlays(graph).length, 0);
});

test("selected bed overlays are suppressed while irrigation mode is active", () => {
    const { api, bed, graph } = loadPlugin();
    const pluginWindow = graph.container.ownerDocument.defaultView;
    api.writeBedConditions(bed, { sunExposure: "full_sun", irrigation: "drip" });
    graph.getSelectionCells = () => [bed];
    pluginWindow.TrellisIrrigationPlanner = { isIrrigationModeActive() { return false; } };
    api._test.syncSelectedBedOverlays();
    assert.equal(getSelectedBedOverlays(graph).length, 1);
    pluginWindow.TrellisIrrigationPlanner = { isIrrigationModeActive() { return true; } };
    api._test.syncSelectedBedOverlays();
    assert.equal(getSelectedBedOverlays(graph).length, 0);
});

test("selected bed overlay opens the bed conditions editor", () => {
    const { api, bed, graph, ui } = loadPlugin();
    graph.getSelectionCells = () => [bed];
    api._test.syncSelectedBedOverlays();

    const button = getSelectedBedOverlays(graph)[0].querySelector("button");
    assert.equal(button.textContent, "Set Bed Conditions");
    button.click();
    assert.deepEqual(getDialogButtonLabels(ui), ["Set as defaults", "Copy", "Paste", "Clear", "Cancel", "Save"]);
});

test("selected bed overlay edits user names without changing conditions", () => {
    const { api, bed, graph } = loadPlugin();
    api.writeBedConditions(bed, { bedType: "raised_bed", bedHeightCm: 45.72, irrigation: "drip", notes: "Keep watered." });
    graph.getSelectionCells = () => [bed];
    api._test.syncSelectedBedOverlays();
    const input = getOverlayNameInput(getSelectedBedOverlays(graph)[0]);

    input.value = "East Bed";
    input.dispatchEvent(new input.ownerDocument.defaultView.Event("blur"));
    assert.equal(bed.getAttribute("label"), "Raised bed (45.7 cm) - East Bed");
    let stored = JSON.parse(bed.getAttribute("bed_conditions_json"));
    assert.equal(stored.userBedName, "East Bed");
    assert.equal(stored.irrigation, "unknown");
    assert.equal(stored.notes, "Keep watered.");

    api._test.syncSelectedBedOverlays();
    const enterInput = getOverlayNameInput(getSelectedBedOverlays(graph)[0]);
    enterInput.value = "West Bed";
    dispatchInputKey(enterInput, "Enter");
    assert.equal(bed.getAttribute("label"), "Raised bed (45.7 cm) - West Bed");
    stored = JSON.parse(bed.getAttribute("bed_conditions_json"));
    assert.equal(stored.userBedName, "West Bed");
    assert.equal(stored.irrigation, "unknown");
});

test("selected bed overlay escape reverts and blank user names keep prefix only", () => {
    const { api, bed, graph } = loadPlugin();
    api.writeBedConditions(bed, { bedType: "raised_bed", bedHeightCm: 45.72, userBedName: "Initial" });
    graph.getSelectionCells = () => [bed];
    api._test.syncSelectedBedOverlays();
    let input = getOverlayNameInput(getSelectedBedOverlays(graph)[0]);

    input.value = "Draft Bed";
    dispatchInputKey(input, "Escape");
    assert.equal(input.value, "Initial");
    assert.equal(bed.getAttribute("label"), "Raised bed (45.7 cm) - Initial");

    input.value = "   ";
    input.dispatchEvent(new input.ownerDocument.defaultView.Event("blur"));
    assert.equal(bed.getAttribute("label"), "Raised bed (45.7 cm)");
    api._test.syncSelectedBedOverlays();
    input = getOverlayNameInput(getSelectedBedOverlays(graph)[0]);
    assert.equal(input.value, "");
});

test("selected bed overlay position is not clamped to the viewport", () => {
    const { api, bed, graph } = loadPlugin();
    graph.__states.set(bed, { x: 5, y: -80, width: 100, height: 60 });
    graph.getSelectionCells = () => [bed];
    api._test.syncSelectedBedOverlays();
    const overlay = getSelectedBedOverlays(graph)[0];
    assert.ok(Number.parseFloat(overlay.style.left) < 0);
    assert.ok(Number.parseFloat(overlay.style.top) < 0);
});

test("selected bed overlay autosizes from conditions but not bed names", () => {
    const { api, bed, graph } = loadPlugin();
    graph.__states.set(bed, { x: 420, y: 20, width: 100, height: 60 });
    api.writeBedConditions(bed, { irrigation: "drip" });
    graph.getSelectionCells = () => [bed];
    api._test.syncSelectedBedOverlays();
    let overlay = getSelectedBedOverlays(graph)[0];
    const shortWidth = Number.parseInt(overlay.style.width, 10);
    assert.equal(shortWidth, 190);

    getOverlayNameInput(overlay).value = "A very long bed name that should not control the overlay width";
    getOverlayNameInput(overlay).dispatchEvent(new overlay.ownerDocument.defaultView.Event("blur"));
    api._test.syncSelectedBedOverlays();
    overlay = getSelectedBedOverlays(graph)[0];
    assert.equal(Number.parseInt(overlay.style.width, 10), shortWidth);

    api.writeBedConditions(bed, { irrigation: "self_watering", notes: "This condition note is intentionally long enough to widen the overlay panel." });
    api._test.syncSelectedBedOverlays();
    overlay = getSelectedBedOverlays(graph)[0];
    const wideWidth = Number.parseInt(overlay.style.width, 10);
    assert.equal(wideWidth > shortWidth, true);
    assert.equal(overlay.style.left, Math.round(420 - wideWidth - 8) + "px");
});

test("preset identity persists as selected baseline until cleared", () => {
    const { api, bed, ui } = loadPlugin();

    api._test.showConditionEditorDialog(bed);
    chooseDialogPreset(ui, "sunny_vegetable");
    getDialogButton(ui, "Save").click();
    let stored = JSON.parse(bed.getAttribute("bed_conditions_json"));
    assert.equal(stored.presetKey, "sunny_vegetable");

    api._test.showConditionEditorDialog(bed);
    getDialogFieldControl(ui, "Sun exposure").value = "shade";
    getDialogButton(ui, "Save").click();
    stored = JSON.parse(bed.getAttribute("bed_conditions_json"));
    assert.equal(stored.presetKey, "sunny_vegetable");

    api._test.showConditionEditorDialog(bed);
    assert.equal(getDialogFieldControl(ui, "Preset").value, "sunny_vegetable");
    getDialogFieldControl(ui, "Preset").value = "";
    getDialogButton(ui, "Save").click();
    stored = JSON.parse(bed.getAttribute("bed_conditions_json"));
    assert.equal(stored.presetKey, undefined);

    api._test.showConditionEditorDialog(bed);
    chooseDialogPreset(ui, "sunny_vegetable");
    getDialogFieldControl(ui, "Wind exposure").value = "sheltered";
    getDialogButton(ui, "Save").click();
    stored = JSON.parse(bed.getAttribute("bed_conditions_json"));
    assert.equal(stored.presetKey, "sunny_vegetable");
    assert.equal(stored.windExposure, "sheltered");
});

test("greenhouse preset persists new infrastructure fields and allows extra protection", () => {
    const { api, bed, ui } = loadPlugin();

    api._test.showConditionEditorDialog(bed);
    chooseDialogPreset(ui, "greenhouse");
    getDialogButton(ui, "Save").click();
    let stored = JSON.parse(bed.getAttribute("bed_conditions_json"));
    assert.equal(stored.presetKey, "greenhouse");
    assert.equal(stored.bedType, "unknown");
    assert.equal(stored.bedHeightCm, null);
    assert.equal(stored.userBedName, "");
    assert.equal(stored.seasonExtension, "greenhouse");
    assert.equal(stored.seasonExtensionAirOffsetC, 3);
    assert.equal(stored.seasonExtensionSoilOffsetC, 2);
    assert.equal(stored.seasonExtensionFrostShiftDays, -21);
    assert.equal(stored.cropProtection, "unknown");
    assert.equal(stored.bedUse, "seed_starting");
    assert.equal(bed.getAttribute("season_extension"), "greenhouse");
    assert.equal(bed.getAttribute("crop_protection"), "unknown");

    api._test.showConditionEditorDialog(bed);
    getDialogFieldControl(ui, "Crop protection").value = "shade_cloth";
    getDialogButton(ui, "Save").click();
    stored = JSON.parse(bed.getAttribute("bed_conditions_json"));
    assert.equal(stored.presetKey, "greenhouse");
    assert.equal(stored.cropProtection, "shade_cloth");
});

test("condition option groups expose season extension and crop protection", () => {
    const { api } = loadPlugin();
    const groups = api.listConditionOptionGroups();
    const season = groups.find(group => group.id === "seasonExtension");
    const protection = groups.find(group => group.id === "cropProtection");
    assert.equal(groups.find(group => group.id === "irrigation"), undefined);
    assert.ok(season, "missing season extension group");
    assert.ok(protection, "missing crop protection group");
    assert.deepEqual(plainRows(season.options.map(option => option.id)), ["seasonExtension:none", "seasonExtension:row_cover", "seasonExtension:low_tunnel", "seasonExtension:cold_frame", "seasonExtension:greenhouse", "seasonExtension:high_tunnel", "seasonExtension:heated_greenhouse"]);
    assert.deepEqual(plainRows(protection.options.map(option => option.id)), ["cropProtection:none", "cropProtection:shade_cloth", "cropProtection:insect_netting", "cropProtection:bird_netting", "cropProtection:hail_netting"]);
});

test("overlay summary shows presets, extras, and set values without unknowns", () => {
    const { api, bed } = loadPlugin();

    let rows = api._test.buildOverlayRows(api.writeBedConditions(bed, {
        presetKey: "sunny_vegetable",
        sunExposure: "full_sun",
        soilMoisture: "moderate",
        drainage: "normal",
        soilTexture: "loamy",
        fertility: "high",
        irrigation: "manual",
        trellis: "none",
        seasonExtension: "none",
        cropProtection: "shade_cloth",
        bedUse: "annuals",
        windExposure: "exposed"
    }));
    assert.deepEqual(plainRows(rows), [
        { label: "Preset", value: "Sunny vegetable bed" },
        { type: "heading", label: "Additional" },
        { label: "Crop protection", value: "Shade cloth" },
        { label: "Wind exposure", value: "Exposed" }
    ]);

    rows = api._test.buildOverlayRows(api.writeBedConditions(bed, {
        presetKey: "sunny_vegetable",
        sunExposure: "shade",
        soilMoisture: "moderate",
        drainage: "normal",
        soilTexture: "loamy",
        fertility: "high",
        irrigation: "manual",
        bedUse: "annuals"
    }));
    assert.deepEqual(plainRows(rows), [
        { label: "Preset", value: "Sunny vegetable bed" },
        { type: "heading", label: "Preset overrides" },
        { label: "Sun exposure", value: "Shade" }
    ]);

    rows = api._test.buildOverlayRows(api.writeBedConditions(bed, {
        sunExposure: "part_shade",
        soilMoisture: "unknown",
        irrigation: "drip",
        trellis: "none",
        seasonExtension: "none",
        cropProtection: "none",
        bedUse: "perennials"
    }));
    assert.deepEqual(plainRows(rows), [
        { label: "Sun exposure", value: "Part shade" },
        { label: "Bed use", value: "Perennials" }
    ]);

    rows = api._test.buildOverlayRows(api.writeBedConditions(bed, {
        irrigation: "drip",
        notes: "Water deeply after transplanting."
    }));
    assert.deepEqual(plainRows(rows), [
        { type: "notes", label: "Notes", value: "Water deeply after transplanting." }
    ]);
});

test("selected bed overlay renders notes as a labeled bottom block", () => {
    const { api, bed, graph } = loadPlugin();
    api.writeBedConditions(bed, { irrigation: "drip", notes: "Water deeply after transplanting." });

    graph.getSelectionCells = () => [bed];
    api._test.syncSelectedBedOverlays();
    const overlay = getSelectedBedOverlays(graph)[0];
    const blocks = Array.from(overlay.children).map(child => child.textContent);
    assert.equal(blocks[blocks.length - 1], "NotesWater deeply after transplanting.");
    assert.match(overlay.textContent, /NotesWater deeply after transplanting\.$/);
});

test("season extension defaults and overrides normalize for scheduler use", () => {
    const { api } = loadPlugin();
    assert.deepEqual(plainRows(api._test.seasonExtensionDefaults("greenhouse")), { airOffsetC: 3, soilOffsetC: 2, frostShiftDays: -21, minAirTempC: null });
    assert.deepEqual(plainRows(api._test.seasonExtensionEffects({ seasonExtension: "row_cover" })), { seasonExtension: "row_cover", airOffsetC: 0.5, soilOffsetC: 0.5, frostShiftDays: -3, minAirTempC: null });
    assert.deepEqual(plainRows(api._test.seasonExtensionEffects({
        seasonExtension: "heated_greenhouse",
        seasonExtensionAirOffsetC: 4,
        seasonExtensionSoilOffsetC: 2.25,
        seasonExtensionFrostShiftDays: -30,
        seasonExtensionMinAirTempC: 6
    })), { seasonExtension: "heated_greenhouse", airOffsetC: 4, soilOffsetC: 2.25, frostShiftDays: -30, minAirTempC: 6 });
    const normalized = api._test.normalizeProfile({ seasonExtension: "greenhouse", season_extension_air_offset_c: "4.5", season_extension_min_air_temp_c: "7" });
    assert.equal(normalized.seasonExtension, "greenhouse");
    assert.equal(normalized.seasonExtensionAirOffsetC, 4.5);
    assert.equal(normalized.seasonExtensionMinAirTempC, null);
});

test("advanced season extension UI is conditional and saves metric overrides", () => {
    const { api, bed, ui } = loadPlugin();
    api._test.showConditionEditorDialog(bed);
    const advanced = ui.lastDialog.querySelector("[data-bed-season-extension-advanced='1']");
    assert.ok(advanced, "missing advanced season extension section");
    assert.equal(advanced.style.display, "none");
    chooseSeasonExtension(ui, "greenhouse");
    assert.equal(advanced.style.display, "block");
    assert.match(advanced.textContent, /Defaults: air \+3 C, soil \+2 C, frost -21 days/);
    const inputs = advanced.querySelectorAll("input[type='number']");
    assert.equal(inputs[0].value, "3");
    assert.equal(inputs[1].value, "2");
    assert.equal(inputs[2].value, "-21");
    inputs[0].value = "4.5";
    inputs[1].value = "2.25";
    inputs[2].value = "-30";
    inputs[3].value = "6";
    getDialogButton(ui, "Save").click();
    const stored = JSON.parse(bed.getAttribute("bed_conditions_json"));
    assert.equal(stored.seasonExtension, "greenhouse");
    assert.equal(stored.seasonExtensionAirOffsetC, 4.5);
    assert.equal(stored.seasonExtensionSoilOffsetC, 2.25);
    assert.equal(stored.seasonExtensionFrostShiftDays, -30);
    assert.equal(stored.seasonExtensionMinAirTempC, null);
    assert.equal(bed.getAttribute("season_extension_air_offset_c"), "4.5");
});

test("advanced season extension UI converts imperial display temperatures to stored Celsius", () => {
    const { api, moduleCell, bed, ui } = loadPlugin();
    moduleCell.value.setAttribute("unit_system", "imperial");
    api._test.showConditionEditorDialog(bed);
    const advanced = ui.lastDialog.querySelector("[data-bed-season-extension-advanced='1']");
    chooseSeasonExtension(ui, "heated_greenhouse");
    assert.match(advanced.textContent, /Defaults: air \+9 F, soil \+5\.4 F, frost -45 days, min 41 F/);
    const inputs = advanced.querySelectorAll("input[type='number']");
    assert.equal(inputs[0].value, "41");
    assert.equal(inputs[1].value, "37.4");
    assert.equal(inputs[2].value, "-45");
    assert.equal(inputs[3].value, "41");
    inputs[0].value = "41";
    inputs[1].value = "37.4";
    inputs[2].value = "-60";
    inputs[3].value = "50";
    getDialogButton(ui, "Save").click();
    const stored = JSON.parse(bed.getAttribute("bed_conditions_json"));
    assert.equal(stored.seasonExtension, "heated_greenhouse");
    assert.equal(stored.seasonExtensionAirOffsetC, 5);
    assert.equal(stored.seasonExtensionSoilOffsetC, 3);
    assert.equal(stored.seasonExtensionFrostShiftDays, -60);
    assert.equal(stored.seasonExtensionMinAirTempC, 10);
});

test("season extension defaults save on parent module and populate later dialogs", () => {
    const { api, moduleCell, bed, ui } = loadPlugin();
    api._test.showConditionEditorDialog(bed);
    chooseSeasonExtension(ui, "greenhouse");
    const advanced = ui.lastDialog.querySelector("[data-bed-season-extension-advanced='1']");
    const inputs = advanced.querySelectorAll("input[type='number']");
    inputs[0].value = "4.5";
    inputs[1].value = "2.25";
    inputs[2].value = "-30";
    getDialogButton(ui, "Set as defaults").click();
    const moduleDefaults = JSON.parse(moduleCell.getAttribute("season_extension_defaults_json"));
    assert.deepEqual(plainRows(moduleDefaults.defaults.greenhouse), { airOffsetC: 4.5, soilOffsetC: 2.25, frostShiftDays: -30, minAirTempC: null });
    assert.equal(bed.getAttribute("bed_conditions_json"), null);
    getDialogButton(ui, "Cancel").click();

    api._test.showConditionEditorDialog(bed);
    chooseSeasonExtension(ui, "greenhouse");
    const nextInputs = ui.lastDialog.querySelector("[data-bed-season-extension-advanced='1']").querySelectorAll("input[type='number']");
    assert.equal(nextInputs[0].value, "4.5");
    assert.equal(nextInputs[1].value, "2.25");
    assert.equal(nextInputs[2].value, "-30");
    assert.deepEqual(plainRows(api._test.seasonExtensionEffects({ seasonExtension: "greenhouse" })), { seasonExtension: "greenhouse", airOffsetC: 3, soilOffsetC: 2, frostShiftDays: -21, minAirTempC: null });
});

test("advanced season extension controls sit at the bottom of infrastructure", () => {
    const { api, bed, ui } = loadPlugin();
    api._test.showConditionEditorDialog(bed);
    const advanced = ui.lastDialog.querySelector("[data-bed-season-extension-advanced='1']");
    assert.ok(advanced, "missing advanced section");
    assert.equal(advanced.parentNode.firstChild.textContent, "Infrastructure");
    assert.equal(advanced.parentNode.lastElementChild, advanced);
});

test("wind exposure and frost risk live under growing conditions", () => {
    const { api, bed, ui } = loadPlugin();
    api._test.showConditionEditorDialog(bed);

    assert.deepEqual(getSectionFieldLabels(ui, "Growing Conditions"), [
        "Sun exposure",
        "Wind exposure",
        "Frost risk",
        "Soil moisture",
        "Drainage",
        "Soil texture",
        "Fertility"
    ]);
    assert.deepEqual(getSectionFieldLabels(ui, "Infrastructure"), [
        "Irrigation",
        "Trellis",
        "Season extension",
        "Crop protection"
    ]);
    assert.deepEqual(getSectionFieldLabels(ui, "Use"), ["Bed use", "Notes"]);
});

test("bed condition dialog caps to viewport and scrolls its body", () => {
    const { api, bed, ui } = loadPlugin({ innerHeight: 520 });
    api._test.showConditionEditorDialog(bed);
    const body = ui.lastDialog.querySelector("[data-bed-conditions-dialog-body='1']");
    assert.equal(ui.lastDialogArgs.height, 440);
    assert.equal(ui.lastDialog.style.display, "flex");
    assert.equal(ui.lastDialog.style.maxHeight, "440px");
    assert.equal(body.style.overflowY, "auto");
    assert.equal(body.style.minHeight, "0px");
});
