const assert = require("node:assert/strict"); // NEW
const fs = require("node:fs"); // NEW
const path = require("node:path"); // NEW
const test = require("node:test"); // NEW
const vm = require("node:vm"); // NEW

const projectRoot = path.resolve(__dirname, ".."); // NEW
const settingsPath = path.join(projectRoot, "drawio/src/main/webapp/js/diagramly/Settings.js"); // NEW
const initPath = path.join(projectRoot, "drawio/src/main/webapp/js/diagramly/Init.js"); // NEW
const appPath = path.join(projectRoot, "drawio/src/main/webapp/js/diagramly/App.js"); // NEW
const appBundlePath = path.join(projectRoot, "drawio/src/main/webapp/js/app.min.js"); // NEW
const integrateBundlePath = path.join(projectRoot, "drawio/src/main/webapp/js/integrate.min.js"); // NEW

const trellisDefaultPluginIds = [ // NEW
    "trellisUpdatesLinks", // NEW
    "trellisDatabaseTools", // NEW
    "trellisUiCleanup", // NEW
    "trellisUsers", // NEW
    "trellisContextMenu", // NEW
    "gardenSuccession", // NEW
    "plantTiler", // NEW
    "gardenTasks", // NEW
    "gardenModules", // NEW
    "gardenParenting", // NEW
    "gardenScheduler", // NEW
    "gardenClickThrough", // NEW
    "gardenLinking", // NEW
    "tidyContextMenu", // NEW
    "createdChangeMap", // NEW
    "gardenDashboard", // NEW
    "gardenPlanner", // NEW
    "gardenScale", // NEW
    "gardenBeds", // NEW
    "gardenEquipment", // NEW
    "gardenIrrigationPlanner" // NEW
]; // NEW

const trellisDefaultPluginPaths = [ // NEW
    "plugins/garden_planner_plugins/Trellis_Updates_Links.js", // NEW
    "plugins/garden_planner_plugins/Trellis_Database_Tools.js", // NEW
    "plugins/garden_planner_plugins/Trellis_UI_Cleanup.js", // NEW
    "plugins/garden_planner_plugins/Trellis_Users.js", // NEW
    "plugins/garden_planner_plugins/Trellis_Context_Menu.js", // NEW
    "plugins/garden_planner_plugins/Bed_Succession_Navigator.js", // NEW
    "plugins/garden_planner_plugins/Plant_Tiler.js", // NEW
    "plugins/garden_planner_plugins/Garden_Task_Manager.js", // NEW
    "plugins/garden_planner_plugins/Modules_Standalone.js", // NEW
    "plugins/garden_planner_plugins/Planting_Group_Parenting_Controls.js", // NEW
    "plugins/garden_planner_plugins/Garden_Scheduler_Dialog.js", // NEW
    "plugins/garden_planner_plugins/Deep_Click_Through.js", // NEW
    "plugins/garden_planner_plugins/Vertex_Linking_Standalone.js", // NEW
    "plugins/garden_planner_plugins/Tidy_Context_Menu.js", // NEW
    "plugins/garden_planner_plugins/Created_Change_Map.js", // NEW
    "plugins/garden_planner_plugins/Garden_Dashboard.js", // NEW
    "plugins/garden_planner_plugins/Year_Planner.js", // NEW
    "plugins/garden_planner_plugins/Garden_Scale.js", // NEW
    "plugins/garden_planner_plugins/Garden_Beds.js", // NEW
    "plugins/garden_planner_plugins/Garden_Equipment.js", // NEW
    "plugins/garden_planner_plugins/Garden_Irrigation_Planner.js" // NEW
]; // NEW

function readProjectFile(filePath) { // NEW
    return fs.readFileSync(filePath, "utf8"); // NEW
} // NEW

function createLocalStorage(initial = {}) { // NEW
    const store = new Map(Object.entries(initial)); // NEW
    return { // NEW
        getItem(key) { // NEW
            return store.has(key) ? store.get(key) : null; // NEW
        }, // NEW
        setItem(key, value) { // NEW
            store.set(key, String(value)); // NEW
        }, // NEW
        removeItem(key) { // NEW
            store.delete(key); // NEW
        }, // NEW
        dump() { // NEW
            return Object.fromEntries(store); // NEW
        } // NEW
    }; // NEW
} // NEW

function loadSettings(options = {}) { // NEW
    const localStorage = createLocalStorage(options.localStorage); // NEW
    const context = { // NEW
        window: { console }, // NEW
        console, // NEW
        screen: { width: 1200 }, // NEW
        urlParams: options.urlParams || {}, // NEW
        isLocalStorage: options.isLocalStorage !== false, // NEW
        localStorage, // NEW
        JSON, // NEW
        Array, // NEW
        Editor: { // NEW
            settingsKey: ".drawio-config", // NEW
            configVersion: 1, // NEW
            config: null, // NEW
            defaultCustomLibraries: [] // NEW
        }, // NEW
        EditorUi: { isElectronApp: options.isElectronApp !== false }, // NEW
        Sidebar: function Sidebar() {}, // NEW
        mxGraph: function mxGraph() {}, // NEW
        mxGraphView: function mxGraphView() {}, // NEW
        mxConstants: { POINTS: "pt" }, // NEW
        mxUtils: { // NEW
            isLightDarkColor() { return false; }, // NEW
            indexOf(array, value) { return array.indexOf(value); }, // NEW
            remove(value, array) { // NEW
                const index = array.indexOf(value); // NEW
                if (index >= 0) array.splice(index, 1); // NEW
            } // NEW
        } // NEW
    }; // NEW
    context.Sidebar.prototype.defaultEntries = ["general"]; // NEW
    context.mxGraph.prototype.pageFormat = { width: 850, height: 1100 }; // NEW
    context.mxGraphView.prototype.defaultGridColor = "#d0d0d0"; // NEW
    context.mxGraphView.prototype.defaultDarkGridColor = "#6e6e6e"; // NEW

    vm.runInNewContext(readProjectFile(settingsPath), context, { filename: settingsPath }); // NEW
    return { mxSettings: context.mxSettings, localStorage }; // NEW
} // NEW

function storedConfig(config) { // NEW
    return JSON.stringify(Object.assign({ // NEW
        language: "", // NEW
        configVersion: 1, // NEW
        customFonts: [], // NEW
        libraries: ["general"], // NEW
        customLibraries: [], // NEW
        recentColors: [], // NEW
        formatWidth: "240", // NEW
        createTarget: false, // NEW
        pageFormat: { width: 850, height: 1100 }, // NEW
        search: true, // NEW
        gridColor: "#d0d0d0", // NEW
        darkGridColor: "#6e6e6e", // NEW
        darkMode: "auto", // NEW
        resizeImages: null, // NEW
        openCounter: 0, // NEW
        version: 18, // NEW
        unit: "pt", // NEW
        isRulerOn: false // NEW
    }, config)); // NEW
} // NEW

function hostArray(values) { // NEW
    return Array.from(values); // NEW
} // NEW

test("fresh Electron settings use Trellis startup defaults", () => { // NEW
    const { mxSettings } = loadSettings(); // NEW

    assert.equal(mxSettings.getShowStartScreen(), true); // NEW
    assert.equal(mxSettings.getAutosave(), true); // NEW
    assert.deepEqual(hostArray(mxSettings.getPlugins()), trellisDefaultPluginPaths); // CHANGE
    assert.deepEqual(hostArray(mxSettings.getTrellisDefaultPluginIds()), trellisDefaultPluginIds); // CHANGE
    assert.deepEqual(hostArray(mxSettings.getTrellisDefaultPluginPaths()), trellisDefaultPluginPaths); // CHANGE
}); // NEW

test("empty stored plugin settings are normalized to the full Trellis default set", () => { // NEW
    const { mxSettings, localStorage } = loadSettings({ // NEW
        localStorage: { // NEW
            ".drawio-config": storedConfig({ plugins: [], showStartScreen: false, autosave: true }) // NEW
        } // NEW
    }); // NEW

    assert.deepEqual(hostArray(mxSettings.getPlugins()), trellisDefaultPluginPaths); // CHANGE
    assert.deepEqual(JSON.parse(localStorage.getItem(".drawio-config")).plugins, trellisDefaultPluginPaths); // NEW
}); // NEW

test("non-empty stored plugin settings are preserved", () => { // NEW
    const customPlugins = ["plugins/custom.js"]; // NEW
    const { mxSettings } = loadSettings({ // NEW
        localStorage: { // NEW
            ".drawio-config": storedConfig({ plugins: customPlugins, showStartScreen: false, autosave: true }) // NEW
        } // NEW
    }); // NEW

    assert.deepEqual(hostArray(mxSettings.getPlugins()), customPlugins); // CHANGE
}); // NEW

test("old draw.io autosave transition no longer forces Trellis autosave off", () => { // NEW
    const { mxSettings, localStorage } = loadSettings({ // NEW
        localStorage: { // NEW
            ".drawio-config": storedConfig({ plugins: ["plugins/custom.js"], showStartScreen: false, autosave: false }), // NEW
            "._autoSaveTrans_": "1" // NEW
        } // NEW
    }); // NEW

    assert.equal(mxSettings.getAutosave(), true); // NEW
    assert.equal(localStorage.getItem(".trellisStartupDefaults.v1"), "1"); // NEW
    assert.equal(JSON.parse(localStorage.getItem(".drawio-config")).autosave, true); // NEW
}); // NEW

test("Trellis splash is not suppressed by stored false Electron preference", () => { // NEW
    const initSource = readProjectFile(initPath); // NEW

    assert.match(initSource, /!window\.mxIsElectron && showSplash == false && urlParams\['splash'\] == null/); // NEW
    assert.match(initSource, /urlParams\['splash'\] = '0'/); // NEW
}); // NEW

test("Trellis plugin defaults stay aligned across source and bundled runtime", () => { // NEW
    const settingsSource = readProjectFile(settingsPath); // NEW
    const appSource = readProjectFile(appPath); // NEW
    const appBundleSource = readProjectFile(appBundlePath); // NEW
    const integrateBundleSource = readProjectFile(integrateBundlePath); // NEW

    for (const pluginId of trellisDefaultPluginIds) { // NEW
        assert.match(settingsSource, new RegExp(`${pluginId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}['"]?[:,]`)); // NEW
        assert.match(appSource, new RegExp(`['"]${pluginId}['"]`)); // NEW
        assert.match(appBundleSource, new RegExp(pluginId)); // NEW
        assert.match(integrateBundleSource, new RegExp(pluginId)); // NEW
    } // NEW

    for (const pluginPath of trellisDefaultPluginPaths) { // NEW
        assert.match(settingsSource, new RegExp(pluginPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))); // NEW
        assert.match(appSource, new RegExp(pluginPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))); // NEW
        assert.match(appBundleSource, new RegExp(pluginPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))); // NEW
        assert.match(integrateBundleSource, new RegExp(pluginPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))); // NEW
    } // NEW

    assert.match(appSource, /App\.trellisDefaultPlugins = App\.publicPlugin\.slice\(\); \/\/ NEW/); // NEW
    assert.match(appSource, /App\.loadPlugins\(App\.trellisDefaultPlugins\); \/\/ CHANGE/); // NEW
    assert.match(appBundleSource, /App\.trellisDefaultPlugins=App\.publicPlugin\.slice\(\)/); // NEW
    assert.match(appBundleSource, /App\.loadPlugins\(App\.trellisDefaultPlugins\)/); // NEW
    assert.match(integrateBundleSource, /App\.trellisDefaultPlugins=App\.publicPlugin\.slice\(\)/); // NEW
    assert.match(integrateBundleSource, /App\.loadPlugins\(App\.trellisDefaultPlugins\)/); // NEW
}); // NEW
