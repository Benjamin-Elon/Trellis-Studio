const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const PLUGIN_PATH = path.join( // NEW
    __dirname, // NEW
    "..", // NEW
    "drawio", // NEW
    "src", // NEW
    "main", // NEW
    "webapp", // NEW
    "plugins", // NEW
    "garden_planner_plugins", // NEW
    "Trellis_Context_Menu.js" // NEW
); // NEW

function loadRegistry() { // NEW
    const pluginCallbacks = []; // NEW
    const context = { // NEW
        window: { // NEW
            console: { error() {} } // NEW
        }, // NEW
        Draw: { // NEW
            loadPlugin(callback) { pluginCallbacks.push(callback); } // NEW
        } // NEW
    }; // NEW

    vm.runInNewContext(fs.readFileSync(PLUGIN_PATH, "utf8"), context, { filename: PLUGIN_PATH }); // NEW
    return { registry: context.window.TrellisContextMenu, pluginCallbacks }; // NEW
} // NEW

function createUi(labels) { // NEW
    const popupMenuHandler = { // NEW
        factoryMethod(menu) { // NEW
            labels.push("base"); // NEW
            menu.addItem("Base"); // NEW
        } // NEW
    }; // NEW

    return { // NEW
        editor: { // NEW
            graph: { popupMenuHandler } // NEW
        } // NEW
    }; // NEW
} // NEW

test("Trellis context menu contributors run in deterministic priority order", () => { // NEW
    const labels = []; // NEW
    const { registry, pluginCallbacks } = loadRegistry(); // NEW
    const ui = createUi(labels); // NEW
    const menu = { addItem(label) { labels.push(label); } }; // NEW

    pluginCallbacks.forEach(callback => callback(ui)); // NEW
    registry.register({ id: "tidy", priority: 900, addItems(menu) { menu.addItem("Tidy"); } }); // NEW
    registry.register({ id: "modules", priority: 100, addItems(menu) { menu.addItem("Modules"); } }); // NEW
    registry.register({ id: "scheduler", priority: 400, addItems(menu) { menu.addItem("Scheduler"); } }); // NEW

    ui.editor.graph.popupMenuHandler.factoryMethod(menu, null, null); // NEW

    assert.deepEqual(labels, ["base", "Base", "Modules", "Scheduler", "Tidy"]); // NEW
    assert.deepEqual(Array.from(registry._getOrderedIdsForTests()), ["modules", "scheduler", "tidy"]); // CHANGE
}); // NEW

test("Trellis context menu install is idempotent for the same popup handler", () => { // NEW
    const labels = []; // NEW
    const { registry } = loadRegistry(); // NEW
    const ui = createUi(labels); // NEW
    const menu = { addItem(label) { labels.push(label); } }; // NEW

    registry.install(ui); // NEW
    registry.install(ui); // NEW
    registry.register({ id: "a", priority: 1, addItems(menu) { menu.addItem("A"); } }); // NEW

    ui.editor.graph.popupMenuHandler.factoryMethod(menu, null, null); // NEW

    assert.deepEqual(labels, ["base", "Base", "A"]); // NEW
}); // NEW
