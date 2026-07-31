const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const PLUGIN_PATH = path.join(
    __dirname,
    "..",
    "drawio",
    "src",
    "main",
    "webapp",
    "plugins",
    "garden_planner_plugins",
    "Trellis_Context_Menu.js"
);

function loadRegistry() {
    const pluginCallbacks = [];
    const context = {
        window: {
            console: { error() {} }
        },
        Draw: {
            loadPlugin(callback) { pluginCallbacks.push(callback); }
        }
    };

    vm.runInNewContext(fs.readFileSync(PLUGIN_PATH, "utf8"), context, { filename: PLUGIN_PATH });
    return { registry: context.window.TrellisContextMenu, pluginCallbacks };
}

function createUi(labels) {
    const popupMenuHandler = {
        factoryMethod(menu) {
            labels.push("base");
            menu.addItem("Base");
        }
    };

    return {
        editor: {
            graph: { popupMenuHandler }
        }
    };
}

test("Trellis context menu contributors run in deterministic priority order", () => {
    const labels = [];
    const { registry, pluginCallbacks } = loadRegistry();
    const ui = createUi(labels);
    const menu = { addItem(label) { labels.push(label); } };

    pluginCallbacks.forEach(callback => callback(ui));
    registry.register({ id: "tidy", priority: 900, addItems(menu) { menu.addItem("Tidy"); } });
    registry.register({ id: "modules", priority: 100, addItems(menu) { menu.addItem("Modules"); } });
    registry.register({ id: "scheduler", priority: 400, addItems(menu) { menu.addItem("Scheduler"); } });

    ui.editor.graph.popupMenuHandler.factoryMethod(menu, null, null);

    assert.deepEqual(labels, ["base", "Base", "Modules", "Scheduler", "Tidy"]);
    assert.deepEqual(Array.from(registry._getOrderedIdsForTests()), ["modules", "scheduler", "tidy"]);
});

test("Trellis context menu install is idempotent for the same popup handler", () => {
    const labels = [];
    const { registry } = loadRegistry();
    const ui = createUi(labels);
    const menu = { addItem(label) { labels.push(label); } };

    registry.install(ui);
    registry.install(ui);
    registry.register({ id: "a", priority: 1, addItems(menu) { menu.addItem("A"); } });

    ui.editor.graph.popupMenuHandler.factoryMethod(menu, null, null);

    assert.deepEqual(labels, ["base", "Base", "A"]);
});
