const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { JSDOM } = require("jsdom");

const projectRoot = path.resolve(__dirname, "..");
const pluginPath = path.join(projectRoot, "drawio/src/main/webapp/plugins/garden_planner_plugins/Trellis_Database_Tools.js");

function readProjectFile(relPath) {
    return fs.readFileSync(path.join(projectRoot, relPath), "utf8");
}

function loadPlugin(options = {}) {
    const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://app.test/" });
    const callbacks = [];
    let restoreCalls = 0;
    const context = {
        window: dom.window,
        document: dom.window.document,
        console,
        Promise,
        Error,
        String,
        setTimeout,
        clearTimeout,
        Draw: {
            loadPlugin(callback) {
                callbacks.push(callback);
            }
        }
    };
    context.window.trellisApp = {
        restoreBuiltInDatabase() {
            restoreCalls += 1;
            if (options.restoreError) return Promise.reject(options.restoreError);
            return Promise.resolve(options.restoreResult || {
                dbPath: "C:/Users/user/AppData/Roaming/draw.io/trellis_database/Trellis_database.sqlite",
                backupPath: "C:/Users/user/AppData/Roaming/draw.io/trellis_database/Trellis_database.20260629120000.bak.sqlite",
                sourcePath: "C:/Program Files/Trellis/resources/trellis_database/Trellis_database.sqlite"
            });
        }
    };

    vm.runInNewContext(readProjectFile("drawio/src/main/webapp/plugins/garden_planner_plugins/Trellis_Database_Tools.js"), context, { filename: pluginPath });
    return { context, callbacks, document: dom.window.document, restoreCalls: () => restoreCalls };
}

function createUi() {
    const actions = {};
    const extrasMenu = {
        funct(menu) {
            menu.items.push("base-extras");
        }
    };
    const shown = [];

    return {
        shown,
        ui: {
            dialog: { bg: { style: {} }, container: { style: {} } }, // NEW
            actions: {
                addAction(id, funct) {
                    actions[id] = { funct };
                },
                get(id) {
                    return actions[id];
                }
            },
            menus: {
                get(name) {
                    return name === "extras" ? extrasMenu : null;
                },
                addMenuItems(menu, items) {
                    menu.items.push(...items);
                }
            },
            showDialog(node, width, height, modal, closable) {
                shown.push({ node, width, height, modal, closable });
            },
            hideDialog() {}
        },
        actions,
        extrasMenu
    };
}

async function settle() {
    await Promise.resolve();
    await new Promise(resolve => setTimeout(resolve, 0));
    await Promise.resolve();
}

function findButton(root, label) {
    return Array.from(root.querySelectorAll("button")).find(button => button.textContent === label);
}

test("Trellis database tools registers Extras restore action and confirms before restoring", async () => {
    const harness = loadPlugin();
    const { ui, actions, extrasMenu, shown } = createUi();

    harness.callbacks[0](ui);

    assert.equal(actions.trellisRestoreBuiltInDatabase.label, "Restore Built-in Trellis Database...");
    const menu = { items: [] };
    extrasMenu.funct(menu, null);
    assert.deepEqual(menu.items, ["base-extras", "-", "trellisRestoreBuiltInDatabase"]);

    actions.trellisRestoreBuiltInDatabase.funct();
    assert.equal(shown.length, 1);
    assert.equal(ui.dialog.container.style.zIndex, "2000000000"); // NEW
    assert.equal(ui.dialog.bg.style.zIndex, "1999999999"); // NEW
    assert.match(shown[0].node.textContent, /replace the local AppData Trellis database/);
    assert.equal(harness.restoreCalls(), 0);

    findButton(shown[0].node, "Restore built-in database").click();
    await settle();

    assert.equal(harness.restoreCalls(), 1);
    assert.match(shown[0].node.textContent, /Built-in database restored/);
    assert.match(shown[0].node.textContent, /Backup/);
    assert.match(shown[0].node.textContent, /Reopen any active Trellis dialogs/);
});

test("Trellis database tools reports restore failures without hiding the error", async () => {
    const harness = loadPlugin({ restoreError: new Error("backup failed") });
    const { ui, actions, shown } = createUi();

    harness.callbacks[0](ui);
    actions.trellisRestoreBuiltInDatabase.funct();
    findButton(shown[0].node, "Restore built-in database").click();
    await settle();

    assert.equal(harness.restoreCalls(), 1);
    assert.match(shown[0].node.textContent, /Restore failed/);
    assert.match(shown[0].node.textContent, /backup failed/);
});

test("Trellis database tools shows locked-file restore errors as failures", async () => {
    const busyError = new Error("EBUSY: resource busy or locked, unlink 'C:\\Users\\user\\AppData\\Roaming\\draw.io\\trellis_database\\Trellis_database.sqlite'");
    const harness = loadPlugin({ restoreError: busyError });
    const { ui, actions, shown } = createUi();

    harness.callbacks[0](ui);
    actions.trellisRestoreBuiltInDatabase.funct();
    findButton(shown[0].node, "Restore built-in database").click();
    await settle();

    assert.equal(harness.restoreCalls(), 1);
    assert.match(shown[0].node.textContent, /Restore failed/);
    assert.match(shown[0].node.textContent, /EBUSY: resource busy or locked/);
    assert.doesNotMatch(shown[0].node.textContent, /Built-in database restored/);
});

test("Trellis database restore bridge and default plugin registration are wired", () => {
    const appSource = readProjectFile("drawio/src/main/webapp/js/diagramly/App.js");
    const bundledSource = readProjectFile("drawio/src/main/webapp/js/app.min.js");
    const integrateSource = readProjectFile("drawio/src/main/webapp/js/integrate.min.js");
    const preloadSource = readProjectFile("src/main/electron-preload.js");
    const electronSource = readProjectFile("src/main/electron.js");

    assert.match(preloadSource, /restoreBuiltInDatabase\(\)/);
    assert.match(preloadSource, /action: 'restoreBuiltInTrellisDatabase'/);
    assert.match(electronSource, /function restoreBuiltInTrellisDatabase\(options\)/);
    assert.match(electronSource, /case 'restoreBuiltInTrellisDatabase': \/\/ NEW/);
    assert.match(electronSource, /backupPath/);
    assert.match(electronSource, /sourcePath/);
    assert.match(electronSource, /fs\.copyFileSync\(sourcePath, dbPath\)/);
    assert.doesNotMatch(electronSource, /fs\.unlinkSync\(dbPath\)/);
    assert.doesNotMatch(electronSource, /fs\.renameSync\(tempPath, dbPath\)/);
    assert.doesNotMatch(electronSource, /fs\.unlinkSync\(livePath\)/);
    assert.match(electronSource, /restoreBuiltInTrellisDatabase\(\{ dbName, seedRelPath: effectiveSeedRel \}\)\.dbPath/); // CHANGE
    assert.match(electronSource, /ensureCreatedDb\(livePath\)/); // NEW
    assert.match(preloadSource, /createIfMissing: !!opts\.createIfMissing/); // NEW

    assert.match(appSource, /'trellisDatabaseTools': 'plugins\/garden_planner_plugins\/Trellis_Database_Tools\.js'/);
    assert.match(appSource, /'trellisUiCleanup': 'plugins\/garden_planner_plugins\/Trellis_UI_Cleanup\.js'/); // NEW
    assert.match(appSource, /App\.loadPlugins\(App\.trellisDefaultPlugins\); \/\/ CHANGE/); // CHANGE
    assert.match(bundledSource, /'trellisDatabaseTools': 'plugins\/garden_planner_plugins\/Trellis_Database_Tools\.js'/);
    assert.match(bundledSource, /'trellisUiCleanup': 'plugins\/garden_planner_plugins\/Trellis_UI_Cleanup\.js'/); // NEW
    assert.match(bundledSource, /App\.loadPlugins\(App\.trellisDefaultPlugins\)/); // CHANGE
    assert.match(integrateSource, /trellisDatabaseTools:"plugins\/garden_planner_plugins\/Trellis_Database_Tools\.js",trellisUiCleanup:"plugins\/garden_planner_plugins\/Trellis_UI_Cleanup\.js"/); // CHANGE
    assert.match(integrateSource, /App\.loadPlugins\(App\.trellisDefaultPlugins\)/); // CHANGE
});
