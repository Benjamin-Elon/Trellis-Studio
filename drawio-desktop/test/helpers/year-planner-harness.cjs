const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { JSDOM } = require("jsdom");

const PLUGIN_PATH = path.join(
    __dirname,
    "..",
    "..",
    "drawio",
    "src",
    "main",
    "webapp",
    "plugins",
    "garden_planner_plugins",
    "Year_planner.js"
);
const PLUGIN_SOURCE = fs.readFileSync(PLUGIN_PATH, "utf8");

/** Minimal mxCell-compatible object used by repository and diagram-reader tests. */
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

function htmlEntities(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

function createCanvasContext(operations) { // CHANGE
    const context = { // NEW
        fillStyle: "", // NEW
        strokeStyle: "", // NEW
        lineWidth: 1, // NEW
        currentDash: [], // NEW
        arc(...args) { operations.push({ method: "arc", args }); }, // CHANGE
        beginPath() { operations.push({ method: "beginPath" }); }, // CHANGE
        clearRect() { operations.length = 0; }, // CHANGE
        fill() { operations.push({ method: "fill", fillStyle: context.fillStyle }); }, // CHANGE
        fillRect(...args) { operations.push({ method: "fillRect", args, fillStyle: context.fillStyle }); }, // CHANGE
        fillText(text, ...args) { operations.push({ method: "fillText", text: String(text), args, fillStyle: context.fillStyle }); }, // CHANGE
        lineTo(...args) { operations.push({ method: "lineTo", args }); }, // CHANGE
        moveTo(...args) { operations.push({ method: "moveTo", args }); }, // CHANGE
        setLineDash(dash) { context.currentDash = Array.from(dash || []); }, // CHANGE
        stroke() { operations.push({ method: "stroke", strokeStyle: context.strokeStyle, lineWidth: context.lineWidth, dash: Array.from(context.currentDash) }); } // CHANGE
    }; // NEW
    return context; // NEW
}

/**
 * Loads the production plugin into jsdom with deterministic graph and database adapters.
 * The returned helpers drive actual DOM events while keeping all persistence in memory.
 */
function createYearPlannerHarness(options = {}) {
    const dom = new JSDOM("<!doctype html><html><body></body></html>", {
        url: "http://localhost/"
    });
    const { window } = dom;
    const { document } = window;
    const root = new TestCell("root");
    const moduleCell = new TestCell("module", { label: "Test Garden" });
    root.children.push(moduleCell);
    const cells = new Map([[root.id, root], [moduleCell.id, moduleCell]]);
    const graphListeners = new Map();
    const confirmations = [];

    window.__USL_YEAR_PLANNER_TEST_HOOK__ = true;
    window.HTMLCanvasElement.prototype.getContext = function getContext() { // CHANGE
        if (!this.__canvasOperations) this.__canvasOperations = []; // NEW
        if (!this.__canvasContext) this.__canvasContext = createCanvasContext(this.__canvasOperations); // NEW
        return this.__canvasContext; // NEW
    }; // CHANGE
    window.URL.createObjectURL = () => "blob:test";
    window.URL.revokeObjectURL = () => {};

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
            if (value && value.attributes) { // NEW
                for (const attribute of Array.from(value.attributes)) cell.attributes.set(attribute.name, attribute.value); // NEW
            }
            parent.children.push(cell); // NEW
            cells.set(cell.id, cell); // NEW
            return cell; // NEW
        },
        setAttributeForCell(cell, key, value) {
            if (value == null) cell.attributes.delete(key);
            else cell.attributes.set(key, String(value));
        },
        refresh() {},
        addListener(eventName, handler) {
            const handlers = graphListeners.get(eventName) || [];
            handlers.push(handler);
            graphListeners.set(eventName, handlers);
        },
        removeListener(handler) {
            for (const [eventName, handlers] of graphListeners) {
                graphListeners.set(eventName, handlers.filter(candidate => candidate !== handler));
            }
        },
        fireEvent(event) {
            for (const handler of (graphListeners.get(event.name) || [])) handler(graph, event);
        }
    };

    class TestMxEventObject {
        constructor(name, ...properties) {
            this.name = name;
            this.properties = new Map();
            for (let index = 0; index < properties.length; index += 2) {
                this.properties.set(properties[index], properties[index + 1]);
            }
        }

        getProperty(key) {
            return this.properties.get(key);
        }
    }

    const context = vm.createContext({
        Blob: window.Blob,
        CustomEvent: window.CustomEvent,
        Date,
        Event: window.Event,
        JSON,
        Map,
        Math,
        MouseEvent: window.MouseEvent,
        Number,
        Object,
        Option: window.Option,
        Promise,
        Set,
        String,
        URL: window.URL,
        clearTimeout,
        confirm(message) {
            confirmations.push(String(message));
            return options.confirmResult !== false;
        },
        console,
        document,
        mxEventObject: TestMxEventObject,
        mxUtils: { htmlEntities },
        prompt() {
            throw new Error("Native prompt must not be used by the Year Planner.");
        },
        setTimeout,
        window,
        Draw: {
            loadPlugin(callback) {
                callback({ editor: { graph } });
            }
        }
    });

    vm.runInContext(PLUGIN_SOURCE, context, { filename: PLUGIN_PATH });
    const api = window.__uslYearPlannerTestApi;
    const plants = options.plants || [{
        plant_id: 1,
        plant_name: "Tomato",
        yield_per_plant_kg: 1,
        default_planting_method: "direct_sow.field",
        annual: 1, // CHANGE
        biennial: 0, // CHANGE
        perennial: 0 // CHANGE
    }];

    api.DbClient.getPlantsBasicCached = options.getPlantsBasicCached || (async () => plants); // CHANGE
    api.DbClient.invalidatePlantsBasicCache = options.invalidatePlantsBasicCache || (() => {}); // CHANGE
    api.DbClient.queryVarietiesByPlantId = async plantId => { // CHANGE
        if (typeof options.varietiesByPlantId === "function") return options.varietiesByPlantId(String(plantId)); // NEW
        if (options.varietiesByPlantId) return options.varietiesByPlantId[String(plantId)] || []; // NEW
        return options.varieties || []; // CHANGE
    }; // CHANGE
    api.DbClient.queryPlantingMethodsForPlantId = async () => options.methods || [{
        method_id: "direct_sow.field",
        method_name: "Direct sow",
        method_category_id: "direct_sow"
    }];

    function addCell(parent, cell) {
        parent.children.push(cell);
        cells.set(cell.id, cell);
        return cell;
    }

    async function settle(delayMs = 0) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
        await Promise.resolve();
    }

    async function openModal(year = 2026) {
        const session = api.YearPlanModalController.open(moduleCell, year);
        await settle();
        return session;
    }

    function findButton(label) {
        return Array.from(document.querySelectorAll("button"))
            .find(button => button.textContent.trim() === label) || null;
    }

    function setControlValue(control, value, eventType = "input") {
        control.value = String(value);
        control.dispatchEvent(new window.Event(eventType, { bubbles: true }));
    }

    return {
        api,
        addCell,
        confirmations,
        document,
        dom,
        findButton,
        graph,
        moduleCell,
        openModal,
        root,
        setControlValue,
        settle,
        TestCell,
        window
    };
}

/** Creates a valid crop suitable for modal interaction tests. */
function makePlanCrop(overrides = {}) {
    return {
        id: "crop_1",
        plantId: "1",
        plant: "Tomato",
        varietyId: null,
        variety: "",
        method: "direct_sow.field",
        harvestStart: "2026-06-01",
        harvestEnd: "2026-09-30",
        useActualHarvest: false,
        syncharvest: false,
        shelfLifeDays: 0,
        baseKgPerPlant: 1,
        kgPerPlant: 1,
        kgPerPlantMode: "auto",
        actualPlants: 0,
        germRate: 0.8,
        packages: [{ unit: "kg", baseType: "kg", baseQty: 1, price: null }],
        ...overrides
    };
}

module.exports = {
    createYearPlannerHarness,
    makePlanCrop,
    PLUGIN_PATH,
    PLUGIN_SOURCE,
    TestCell
};
