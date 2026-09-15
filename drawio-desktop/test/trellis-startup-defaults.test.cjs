const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const projectRoot = path.resolve(__dirname, "..");
const settingsPath = path.join(projectRoot, "drawio/src/main/webapp/js/diagramly/Settings.js");
const initPath = path.join(projectRoot, "drawio/src/main/webapp/js/diagramly/Init.js");
const appPath = path.join(projectRoot, "drawio/src/main/webapp/js/diagramly/App.js");
const editorUiPath = path.join(projectRoot, "drawio/src/main/webapp/js/diagramly/EditorUi.js"); // NEW
const appBundlePath = path.join(projectRoot, "drawio/src/main/webapp/js/app.min.js");
const integrateBundlePath = path.join(projectRoot, "drawio/src/main/webapp/js/integrate.min.js");

const trellisDefaultPluginIds = [
    "trellisUpdatesLinks",
    "trellisDatabaseTools",
    "trellisUiCleanup",
    "trellisUsers",
    "trellisContextMenu",
    "gardenSuccession",
    "plantTiler",
    "gardenTasks",
    "gardenRoadmapCore", // NEW
    "gardenRoadmaps", // NEW
    "gardenModules",
    "gardenParenting",
    "gardenScheduler",
    "gardenClickThrough",
    "gardenLinking",
    "tidyContextMenu",
    "createdChangeMap",
    "gardenDashboard",
    "gardenPlanner",
    "gardenAllocate",
    "gardenScale",
    "gardenBeds",
    "gardenEquipment",
    "gardenIrrigationPlanner"
];

const trellisDefaultPluginPaths = [
    "plugins/garden_planner_plugins/Trellis_Updates_Links.js",
    "plugins/garden_planner_plugins/Trellis_Database_Tools.js",
    "plugins/garden_planner_plugins/Trellis_UI_Cleanup.js",
    "plugins/garden_planner_plugins/Trellis_Users.js",
    "plugins/garden_planner_plugins/Trellis_Context_Menu.js",
    "plugins/garden_planner_plugins/Bed_Succession_Navigator.js",
    "plugins/garden_planner_plugins/Plant_Tiler.js",
    "plugins/garden_planner_plugins/Garden_Task_Manager.js",
    "plugins/garden_planner_plugins/Garden_Roadmap_Core.js", // NEW
    "plugins/garden_planner_plugins/Garden_Roadmap_Manager.js", // NEW
    "plugins/garden_planner_plugins/Modules_Standalone.js",
    "plugins/garden_planner_plugins/Planting_Group_Parenting_Controls.js",
    "plugins/garden_planner_plugins/Garden_Scheduler_Dialog.js",
    "plugins/garden_planner_plugins/Deep_Click_Through.js",
    "plugins/garden_planner_plugins/Vertex_Linking_Standalone.js",
    "plugins/garden_planner_plugins/Tidy_Context_Menu.js",
    "plugins/garden_planner_plugins/Created_Change_Map.js",
    "plugins/garden_planner_plugins/Garden_Dashboard.js",
    "plugins/garden_planner_plugins/Year_Planner.js",
    "plugins/garden_planner_plugins/Allocate_Planner.js",
    "plugins/garden_planner_plugins/Garden_Scale.js",
    "plugins/garden_planner_plugins/Garden_Beds.js",
    "plugins/garden_planner_plugins/Garden_Equipment.js",
    "plugins/garden_planner_plugins/Garden_Irrigation_Planner.js"
];

function readProjectFile(filePath) {
    return fs.readFileSync(filePath, "utf8");
}

function createLocalStorage(initial = {}) {
    const store = new Map(Object.entries(initial));
    return {
        getItem(key) {
            return store.has(key) ? store.get(key) : null;
        },
        setItem(key, value) {
            store.set(key, String(value));
        },
        removeItem(key) {
            store.delete(key);
        },
        dump() {
            return Object.fromEntries(store);
        }
    };
}

function loadSettings(options = {}) {
    const localStorage = createLocalStorage(options.localStorage);
    const context = {
        window: { console },
        console,
        screen: { width: 1200 },
        urlParams: options.urlParams || {},
        isLocalStorage: options.isLocalStorage !== false,
        localStorage,
        JSON,
        Array,
        Editor: {
            settingsKey: ".drawio-config",
            configVersion: 1,
            config: null,
            defaultCustomLibraries: []
        },
        EditorUi: { isElectronApp: options.isElectronApp !== false },
        Sidebar: function Sidebar() {},
        mxGraph: function mxGraph() {},
        mxGraphView: function mxGraphView() {},
        mxConstants: { POINTS: "pt" },
        mxUtils: {
            isLightDarkColor() { return false; },
            indexOf(array, value) { return array.indexOf(value); },
            remove(value, array) {
                const index = array.indexOf(value);
                if (index >= 0) array.splice(index, 1);
            }
        }
    };
    context.Sidebar.prototype.defaultEntries = ["general"];
    context.mxGraph.prototype.pageFormat = { width: 850, height: 1100 };
    context.mxGraphView.prototype.defaultGridColor = "#d0d0d0";
    context.mxGraphView.prototype.defaultDarkGridColor = "#6e6e6e";

    vm.runInNewContext(readProjectFile(settingsPath), context, { filename: settingsPath });
    return { mxSettings: context.mxSettings, localStorage };
}

function storedConfig(config) {
    return JSON.stringify(Object.assign({
        language: "",
        configVersion: 1,
        customFonts: [],
        libraries: ["general"],
        customLibraries: [],
        recentColors: [],
        formatWidth: "240",
        createTarget: false,
        pageFormat: { width: 850, height: 1100 },
        search: true,
        gridColor: "#d0d0d0",
        darkGridColor: "#6e6e6e",
        darkMode: "auto",
        resizeImages: null,
        openCounter: 0,
        version: 18,
        unit: "pt",
        isRulerOn: false
    }, config));
}

function hostArray(values) {
    return Array.from(values);
}

test("fresh Electron settings use Trellis startup defaults", () => {
    const { mxSettings } = loadSettings();

    assert.equal(mxSettings.getShowStartScreen(), true);
    assert.equal(mxSettings.getAutosave(), true);
    assert.deepEqual(hostArray(mxSettings.getPlugins()), trellisDefaultPluginPaths);
    assert.deepEqual(hostArray(mxSettings.getTrellisDefaultPluginIds()), trellisDefaultPluginIds);
    assert.deepEqual(hostArray(mxSettings.getTrellisDefaultPluginPaths()), trellisDefaultPluginPaths);
});

test("empty stored plugin settings are normalized to the full Trellis default set", () => {
    const { mxSettings, localStorage } = loadSettings({
        localStorage: {
            ".drawio-config": storedConfig({ plugins: [], showStartScreen: false, autosave: true })
        }
    });

    assert.deepEqual(hostArray(mxSettings.getPlugins()), trellisDefaultPluginPaths);
    assert.deepEqual(JSON.parse(localStorage.getItem(".drawio-config")).plugins, trellisDefaultPluginPaths);
});

test("non-empty stored plugin settings are preserved", () => {
    const customPlugins = ["plugins/custom.js"];
    const { mxSettings } = loadSettings({
        localStorage: {
            ".drawio-config": storedConfig({ plugins: customPlugins, showStartScreen: false, autosave: true })
        }
    });

    assert.deepEqual(hostArray(mxSettings.getPlugins()), customPlugins);
});

test("old editor autosave transition no longer forces Trellis autosave off", () => { // CHANGE
    const { mxSettings, localStorage } = loadSettings({
        localStorage: {
            ".drawio-config": storedConfig({ plugins: ["plugins/custom.js"], showStartScreen: false, autosave: false }),
            "._autoSaveTrans_": "1"
        }
    });

    assert.equal(mxSettings.getAutosave(), true);
    assert.equal(localStorage.getItem(".trellisStartupDefaults.v1"), "1");
    assert.equal(JSON.parse(localStorage.getItem(".drawio-config")).autosave, true);
});

test("Trellis splash is not suppressed by stored false Electron preference", () => {
    const initSource = readProjectFile(initPath);

    assert.match(initSource, /!window\.mxIsElectron && showSplash == false && urlParams\['splash'\] == null/);
    assert.match(initSource, /urlParams\['splash'\] = '0'/);
});

test("Trellis plugin defaults stay aligned across source and bundled runtime", () => {
    const settingsSource = readProjectFile(settingsPath);
    const appSource = readProjectFile(appPath);
    const appBundleSource = readProjectFile(appBundlePath);
    const integrateBundleSource = readProjectFile(integrateBundlePath);

    for (const pluginId of trellisDefaultPluginIds) {
        assert.match(settingsSource, new RegExp(`${pluginId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}['"]?[:,]`));
        assert.match(appSource, new RegExp(`['"]${pluginId}['"]`));
        assert.match(appBundleSource, new RegExp(pluginId));
        assert.match(integrateBundleSource, new RegExp(pluginId));
    }

    for (const pluginPath of trellisDefaultPluginPaths) {
        assert.match(settingsSource, new RegExp(pluginPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
        assert.match(appSource, new RegExp(pluginPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
        assert.match(appBundleSource, new RegExp(pluginPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
        assert.match(integrateBundleSource, new RegExp(pluginPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }

    assert.match(appSource, /App\.trellisDefaultPlugins = App\.publicPlugin\.slice\(\); \/\/ NEW/);
    assert.match(appSource, /App\.loadPlugins\(App\.trellisDefaultPlugins\); \/\/ CHANGE/);
    assert.match(appBundleSource, /App\.trellisDefaultPlugins=App\.publicPlugin\.slice\(\)/);
    assert.match(appBundleSource, /App\.loadPlugins\(App\.trellisDefaultPlugins\)/);
    assert.match(integrateBundleSource, /App\.trellisDefaultPlugins=App\.publicPlugin\.slice\(\)/);
    assert.match(integrateBundleSource, /App\.loadPlugins\(App\.trellisDefaultPlugins\)/);
});

test("new blank diagram runtime flag is carried through fileLoaded", () => { // NEW
    const appSource = readProjectFile(appPath); // NEW
    const editorUiSource = readProjectFile(editorUiPath); // NEW
    const appBundleSource = readProjectFile(appBundlePath); // NEW
    const integrateBundleSource = readProjectFile(integrateBundlePath); // NEW

    assert.match(appSource, /var trellisNewBlankDiagram = data == this\.emptyDiagramXml;/); // NEW
    assert.match(appSource, /file\.trellisNewBlankDiagram = true;/); // NEW
    assert.match(editorUiSource, /new mxEventObject\('fileLoaded',[\s\S]*'trellisNewBlankDiagram', !!\(file && file\.trellisNewBlankDiagram\)/); // NEW
    assert.match(editorUiSource, /delete file\.trellisNewBlankDiagram;/); // NEW
    assert.match(appBundleSource, /trellisNewBlankDiagram/); // NEW
    assert.match(integrateBundleSource, /trellisNewBlankDiagram/); // NEW
}); // NEW

/** Extract an actual assignment, honoring strings/comments and balanced JS delimiters. */ // NEW
function runtimeAssignment(source, field) { // NEW
    const match = new RegExp('App\\.' + field + '\\s*=').exec(source); assert.ok(match, field); // NEW
    let depth = 0, quote = '', comment = ''; // NEW
    for (let i = match.index; i < source.length; i++) { // NEW
        const c = source[i], next = source[i + 1]; // NEW
        if (comment === 'line') { if (c === '\n') comment = ''; continue; } // NEW
        if (comment === 'block') { if (c === '*' && next === '/') { comment = ''; i++; } continue; } // NEW
        if (quote) { if (c === '\\') i++; else if (c === quote) quote = ''; continue; } // NEW
        if (c === '/' && next === '/') { comment = 'line'; i++; continue; } // NEW
        if (c === '/' && next === '*') { comment = 'block'; i++; continue; } // NEW
        if (c === '"' || c === "'") { quote = c; continue; } // NEW
        if ('([{'.includes(c)) depth++; else if (')]}'.includes(c)) depth--; // NEW
        if (c === ';' && depth === 0) return source.slice(match.index, i + 1); // NEW
    } // NEW
    throw new Error('Unterminated runtime assignment: ' + field); // NEW
} // NEW

for (const filePath of [appPath, appBundlePath, integrateBundlePath]) { // NEW
    test(path.basename(filePath) + ' actual registry, public list, and defaults register Roadmap dependencies', () => { // NEW
        const source = readProjectFile(filePath), context = { App: {} }; // NEW
        for (const field of ['pluginRegistry', 'publicPlugin', 'trellisDefaultPlugins']) vm.runInNewContext(runtimeAssignment(source, field), context); // NEW
        assert.deepEqual(Array.from(context.App.publicPlugin), trellisDefaultPluginIds); // NEW
        assert.deepEqual(Array.from(context.App.trellisDefaultPlugins), trellisDefaultPluginIds); // NEW
        trellisDefaultPluginIds.forEach((id, index) => assert.equal(context.App.pluginRegistry[id], trellisDefaultPluginPaths[index])); // NEW
        assert.ok(context.App.publicPlugin.indexOf('gardenRoadmapCore') < context.App.publicPlugin.indexOf('gardenRoadmaps')); // NEW
    }); // NEW

    test(path.basename(filePath) + ' waits for Core completion, deduplicates requests, and retries failures', () => { // CHANGE
        const source = readProjectFile(filePath), requests = []; // NEW
        assert.doesNotThrow(() => new vm.Script(source)); // NEW: a registered plugin is useless if its host bundle cannot parse.
        const context = { App: { pluginsLoaded: {}, embedModePluginsCount: 0 }, PLUGINS_BASE_PATH: '', window: { console: { error() {} }, drawDevUrl: '/dev/' }, console: { error() {} }, EditorUi: { debug() {} }, mxscript: (url, done, id, key, noWrite, fail) => requests.push({ url, done, fail }) }; // NEW
        for (const field of ['pluginRegistry', 'loadRoadmapPlugin', 'loadPlugins']) vm.runInNewContext(runtimeAssignment(source, field), context); // NEW
        context.App.loadPlugins(['gardenRoadmaps', 'gardenRoadmapCore', 'gardenRoadmaps'], true); // NEW
        assert.equal(requests.length, 1); assert.match(requests[0].url, /^\/dev\/.*Garden_Roadmap_Core.js$/); // NEW
        assert.equal(context.App.embedModePluginsCount, 1); // NEW
        assert.equal(context.App.pluginsLoaded[context.App.pluginRegistry.gardenRoadmaps], true); // NEW: stored-path loading must wait for dependencies too.
        requests[0].fail('injected failure'); assert.equal(context.App.embedModePluginsCount, 0); assert.equal(requests.length, 1); // NEW
        context.App.loadPlugins(['gardenRoadmaps']); assert.equal(requests.length, 2); requests[1].done(); // NEW
        assert.equal(requests.length, 3); assert.match(requests[2].url, /Garden_Roadmap_Manager.js$/); // CHANGE
        requests[2].done(); context.App.loadPlugins(['gardenRoadmapCore', 'gardenRoadmaps']); assert.equal(requests.length, 3); // CHANGE
    }); // NEW
} // NEW
