import assert from "assert"; // CHANGE
import fs from "fs"; // CHANGE
import path from "path"; // CHANGE
import vm from "vm"; // CHANGE
import { fileURLToPath } from "url"; // NEW

const __filename = fileURLToPath(import.meta.url); // NEW
const __dirname = path.dirname(__filename); // NEW

function createElement() {
    return {
        style: {},
        textContent: "",
        innerHTML: "",
        clientWidth: 80,
        offsetWidth: 80,
        parentNode: null,
        children: [],
        appendChild(child) {
            child.parentNode = this;
            this.children.push(child);
        },
        removeChild(child) {
            this.children = this.children.filter(item => item !== child);
            child.parentNode = null;
        },
        addEventListener() {
        }
    };
}

function makeCell(id, attrs, geometry) {
    return {
        id,
        attrs: attrs || {},
        geometry: geometry || { width: 0, height: 0 },
        getId() { return this.id; },
        getAttribute(key) { return this.attrs[key]; },
        getGeometry() { return this.geometry; }
    };
}

function installPlugin(cells, parents, selection) {
    const callbacks = [];
    const container = createElement();
    const listeners = [];
    const model = {
        getParent(cell) { return parents.get(cell) || null; },
        addListener() { listeners.push(arguments); }
    };
    const graph = {
        container,
        view: {
            scale: 1,
            getState(cell) {
                const geo = cell.getGeometry();
                return { cell, x: 10, y: 20, width: geo.width, height: geo.height, style: {} };
            },
            addListener() { listeners.push(arguments); }
        },
        getModel() { return model; },
        getSelectionCells() { return selection.cells; },
        getSelectionModel() { return { addListener() { listeners.push(arguments); } }; },
        getCellStyle(cell) { return cell.attrs.style || {}; },
        addListener() { listeners.push(arguments); }
    };

    global.window = {
        getComputedStyle() { return { position: "relative" }; }
    };
    global.document = { createElement };
    global.Draw = { loadPlugin(fn) { callbacks.push(fn); } };
    global.mxConstants = { STYLE_ROTATION: "rotation" };
    global.mxEvent = {
        CHANGE: "change",
        SCALE: "scale",
        TRANSLATE: "translate",
        SCALE_AND_TRANSLATE: "scaleAndTranslate",
        DESTROY: "destroy",
        LABEL_HANDLE: -1,
        ROTATION_HANDLE: -2,
        CUSTOM_HANDLE: -100
    };
    global.mxUtils = {
        getBoundingBox(bounds) { return bounds; }
    };
    global.mxVertexHandler = function () {};
    global.mxVertexHandler.prototype.mouseDown = function () { this.index = this.__handle; };
    global.mxVertexHandler.prototype.mouseUp = function () { this.index = null; };
    global.mxVertexHandler.prototype.reset = function () { this.index = null; };
    global.mxVertexHandler.prototype.updateHint = function () {
        if (this.hint) this.hint.innerHTML = "native";
    };

    const pluginPath = path.join(__dirname, "Garden_Scale.js");
    const source = fs.readFileSync(pluginPath, "utf8");
    vm.runInThisContext(source, { filename: pluginPath });
    callbacks[0]({ editor: { graph } });

    return { graph, container, api: global.window.TrellisGardenScale._test };
}

function cmToUnits(cm) {
    return cm * 5 * 0.18;
}

function run() {
    const moduleMetric = makeCell("moduleMetric", { garden_module: "1", unit_system: "metric" });
    const moduleImperial = makeCell("moduleImperial", { garden_module: "1", unit_system: "imperial" });
    const bed = makeCell("bed", { garden_bed: "1" }, { width: cmToUnits(121.92), height: cmToUnits(243.84) });
    const group = makeCell("group", { tiler_group: "1" }, { width: cmToUnits(100), height: cmToUnits(200) + 21 });
    const outsideBed = makeCell("outsideBed", { garden_bed: "1" }, { width: cmToUnits(100), height: cmToUnits(200) });
    const plain = makeCell("plain", {}, { width: cmToUnits(100), height: cmToUnits(200) });
    const plant = makeCell("plant", { plant_tiler: "1" }, { width: 10, height: 10 });

    const parents = new Map([
        [bed, moduleImperial],
        [group, moduleMetric],
        [plant, group]
    ]);
    const selection = { cells: [bed] };
    const { graph, api, container } = installPlugin([moduleMetric, moduleImperial, bed, group, outsideBed, plain], parents, selection);

    assert.strictEqual(api.formatMetricLengthCm(99.94), "99.9 cm");
    assert.strictEqual(api.formatMetricLengthCm(100), "1.00 m");
    assert.strictEqual(api.formatImperialLengthCm(121.92), "4 ft 0 in");
    assert.strictEqual(api.formatImperialLengthCm(47.6 * 2.54), "4 ft 0 in");
    assert.strictEqual(api.resolveUnitSystem(bed), "imperial");
    assert.strictEqual(api.resolveUnitSystem(group), "metric");
    assert.strictEqual(api.resolveUnitSystem(outsideBed), "metric");

    assert.strictEqual(api.formatCellDimensions(bed), "4 ft 0 in x 8 ft 0 in");
    assert.strictEqual(api.formatCellDimensions(group), "1.00 m x 2.00 m");
    assert.strictEqual(api.resolveTargetCellForOverlay(plant), group);

    const handler = {
        state: { cell: bed },
        graph: { view: { scale: 1 } },
        index: 0,
        hint: { innerHTML: "native" },
        unscaledBounds: { width: cmToUnits(152.4), height: cmToUnits(304.8) }
    };
    api.replaceResizeHintText(handler);
    assert.strictEqual(handler.hint.innerHTML, "5 ft 0 in x 10 ft 0 in");

    const wrappedHandler = new global.mxVertexHandler();
    wrappedHandler.state = { cell: bed };
    wrappedHandler.graph = graph;
    wrappedHandler.index = 0;
    wrappedHandler.hint = { innerHTML: "" };
    wrappedHandler.unscaledBounds = { width: cmToUnits(182.88), height: cmToUnits(365.76) };
    wrappedHandler.updateHint({});
    assert.strictEqual(wrappedHandler.hint.innerHTML, "6 ft 0 in x 12 ft 0 in");

    const nonGardenHandler = {
        state: { cell: plain },
        graph: { view: { scale: 1 } },
        index: 0,
        hint: { innerHTML: "native" },
        unscaledBounds: { width: cmToUnits(152.4), height: cmToUnits(304.8) }
    };
    api.replaceResizeHintText(nonGardenHandler);
    assert.strictEqual(nonGardenHandler.hint.innerHTML, "native");

    assert.strictEqual(container.children.length, 1);
    assert.strictEqual(container.children[0].textContent, "4 ft 0 in x 8 ft 0 in");
    global.window.TrellisGardenScale._test.markResizeTarget({ state: { cell: bed } }, true);
    assert.strictEqual(api.activeResizeCellIds.has("bed"), true);
    assert.strictEqual(container.children[0].style.display, "none");
    global.window.TrellisGardenScale._test.markResizeTarget({ state: { cell: bed } }, false);
    assert.strictEqual(api.activeResizeCellIds.has("bed"), false);
    assert.strictEqual(container.children[0].style.display, "");
}

run();
console.log("Garden_Scale tests passed");
