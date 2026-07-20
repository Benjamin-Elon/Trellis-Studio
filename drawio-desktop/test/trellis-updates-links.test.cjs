const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { JSDOM } = require("jsdom");

const projectRoot = path.resolve(__dirname, "..");
const pluginPath = path.join(projectRoot, "drawio/src/main/webapp/plugins/garden_planner_plugins/Trellis_Updates_Links.js");

function readProjectFile(relPath) {
    return fs.readFileSync(path.join(projectRoot, relPath), "utf8");
}

function loadPlugin(options = {}) {
    const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://app.test/" });
    const callbacks = [];
    const sentMessages = [];
    const openedLinks = [];
    const releaseCalls = []; // NEW
    const context = {
        window: dom.window,
        document: dom.window.document,
        console,
        Promise,
        Date,
        Number,
        String,
        Object,
        Array,
        Error,
        RegExp,
        setTimeout,
        clearTimeout,
        fetch: options.fetch,
        mxUtils: options.mxUtils,
        Draw: {
            loadPlugin(callback) {
                callbacks.push(callback);
            }
        }
    };
    context.window.electron = {
        sendMessage(action, args) {
            sentMessages.push({ action, args });
        },
        request(msg, callback) {
            if (msg.action === "openExternal") openedLinks.push(msg.url);
            if (callback) callback({});
        }
    };
    context.window.trellisApp = {
        getInfo() {
            return Promise.resolve(Object.assign({ // CHANGE
                productName: "Trellis Studio",
                version: "1.1.2",
                repoUrl: "https://github.com/Benjamin-Elon/trellis-studio",
                releasesUrl: "https://github.com/Benjamin-Elon/trellis-studio/releases",
                issuesUrl: "https://github.com/Benjamin-Elon/trellis-studio/issues",
                isPackaged: true, // NEW
                canCheckForUpdates: true // NEW
            }, options.appInfo || {})); // CHANGE
        }
    };
    if (options.includeGetReleases !== false) { // NEW
        context.window.trellisApp.getReleases = function () { // NEW
            releaseCalls.push("trellisApp.getReleases"); // NEW
            if (options.releaseError) return Promise.reject(options.releaseError); // NEW
            return Promise.resolve(options.releases || []); // NEW
        }; // NEW
    } // NEW
    context.window.open = href => openedLinks.push(href);

    vm.runInNewContext(readProjectFile("drawio/src/main/webapp/plugins/garden_planner_plugins/Trellis_Updates_Links.js"), context, { filename: pluginPath });
    return { context, callbacks, sentMessages, openedLinks, releaseCalls, document: dom.window.document }; // CHANGE
}

function createUi() {
    const actions = {};
    const helpMenu = {
        funct(menu) {
            menu.items.push("base-help");
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
                    return name === "help" ? helpMenu : null;
                },
                addMenuItems(menu, items) {
                    menu.items.push(...items);
                }
            },
            showDialog(node, width, height, modal, closable) {
                shown.push({ node, width, height, modal, closable });
            },
            openLink() {}
        },
        actions,
        helpMenu
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

test("Trellis updates helpers compare versions and sanitize release summaries", () => {
    const { context } = loadPlugin();
    const api = context.window.TrellisUpdatesLinks._test;

    assert.equal(api.compareVersions("v1.2.0", "1.1.9"), 1);
    assert.equal(api.compareVersions("1.1.2", "v1.1.2"), 0);
    assert.equal(api.compareVersions("1.1.2-rc.1", "1.1.2"), -1);
    assert.equal(api.compareVersions("1.1.2-rc.10", "1.1.2-rc.2"), 1);
    assert.equal(api.compareVersions("1.1.2+build.7", "1.1.2+build.1"), 0);
    assert.equal(api.compareVersions("bad", "1.1.2"), null);
    assert.equal(api.compareVersions("1.1.2-rc.01", "1.1.2-rc.1"), null);

    const summary = api.summarizeReleaseBody("## Notes\n* Added **safe** updates.\n```js\nalert(1)\n```", 80);
    assert.equal(summary.includes("```"), false);
    assert.match(summary, /Added safe updates/);
});

test("Trellis updates plugin registers Help action and opens dialog", async () => {
    const fakeFetch = async () => {
        throw new Error("renderer fetch should not be used when bridge exists"); // NEW
    };
    const releases = [{ // NEW
        tag_name: "v1.1.3", // NEW
        name: "Trellis 1.1.3", // NEW
        published_at: "2026-06-27T00:00:00Z", // NEW
        html_url: "https://github.com/Benjamin-Elon/trellis-studio/releases/tag/v1.1.3", // CHANGE
        body: "One useful change for gardeners." // NEW
    }]; // NEW
    const mxUtils = {
        get(url, success) {
            assert.equal(url, "plugins/garden_planner_plugins/trellis_changelog.json");
            success({ getText: () => JSON.stringify({ version: 1, entries: [{ version: "1.1.2", date: "2026-06-28", items: ["Bundled changelog entry."] }] }) });
        }
    };
    const { callbacks, sentMessages, releaseCalls } = loadPlugin({ fetch: fakeFetch, mxUtils, releases }); // CHANGE
    const { ui, actions, shown } = createUi();

    callbacks.forEach(callback => callback(ui));
    assert.equal(actions.trellisUpdatesLinks.label, "Trellis Updates & Links");

    const menu = { items: [] };
    ui.menus.get("help").funct(menu, null);
    assert.deepEqual(menu.items, ["base-help", "-", "trellisUpdatesLinks"]);

    actions.trellisUpdatesLinks.funct();
    await settle();

    assert.equal(shown.length, 1);
    assert.equal(ui.dialog.container.style.zIndex, "2000000000"); // NEW
    assert.equal(ui.dialog.bg.style.zIndex, "1999999999"); // NEW
    assert.equal(shown[0].width, 960); // CHANGE
    assert.equal(shown[0].height, 620); // NEW
    assert.equal(shown[0].node.querySelectorAll("[role='tab']").length, 0); // NEW
    assert.equal(shown[0].node.querySelectorAll(".trellis-updates-pane").length, 2); // NEW
    assert.match(shown[0].node.textContent, /Support/); // NEW
    assert.match(shown[0].node.textContent, /Project/); // NEW
    assert.match(shown[0].node.textContent, /Contact/); // NEW
    assert.match(shown[0].node.textContent, /Trellis Studio 1\.1\.2/);
    assert.match(shown[0].node.textContent, /Trellis 1\.1\.3/);
    assert.match(shown[0].node.textContent, /Bundled changelog entry/);
    assert.equal(findButton(shown[0].node, "Retry"), undefined); // NEW

    findButton(shown[0].node, "Check for updates").click();
    assert.deepEqual(sentMessages.at(-1), { action: "checkForUpdates", args: undefined });
    assert.deepEqual(releaseCalls, ["trellisApp.getReleases"]); // CHANGE
});

test("Trellis updates falls back to direct release fetch without bridge", async () => { // NEW
    const fetchCalls = []; // NEW
    const fakeFetch = async url => { // NEW
        fetchCalls.push(String(url)); // NEW
        return { // NEW
            ok: true, // NEW
            async json() { // NEW
                return [{ tag_name: "v1.1.4", name: "Direct release", published_at: "2026-06-28T00:00:00Z", html_url: "https://github.com/release", body: "" }]; // NEW
            } // NEW
        }; // NEW
    }; // NEW
    const mxUtils = { // NEW
        get(url, success) { // NEW
            success({ getText: () => JSON.stringify({ version: 1, entries: [] }) }); // NEW
        } // NEW
    }; // NEW
    const { callbacks } = loadPlugin({ fetch: fakeFetch, mxUtils, includeGetReleases: false }); // NEW
    const { ui, actions, shown } = createUi(); // NEW

    callbacks.forEach(callback => callback(ui)); // NEW
    actions.trellisUpdatesLinks.funct(); // NEW
    await settle(); // NEW

    assert.match(shown[0].node.textContent, /Direct release/); // NEW
    assert.ok(fetchCalls.some(url => url.includes("api.github.com") && url.includes("per_page=10"))); // NEW
}); // NEW

test("Trellis updates dialog remains visible but disables update checks for developer builds", async () => { // NEW
    const fakeFetch = async () => ({ // NEW
        ok: true, // NEW
        async json() { return []; } // NEW
    }); // NEW
    const mxUtils = { // NEW
        get(url, success) { // NEW
            success({ getText: () => JSON.stringify({ version: 1, entries: [] }) }); // NEW
        } // NEW
    }; // NEW
    const { callbacks, sentMessages } = loadPlugin({ fetch: fakeFetch, mxUtils, appInfo: { isPackaged: false, canCheckForUpdates: false } }); // NEW
    const { ui, actions, shown } = createUi(); // NEW

    callbacks.forEach(callback => callback(ui)); // NEW
    actions.trellisUpdatesLinks.funct(); // NEW
    await settle(); // NEW

    assert.equal(shown.length, 1); // NEW
    assert.match(shown[0].node.textContent, /Update checks are disabled in developer builds/); // NEW
    const updateButton = findButton(shown[0].node, "Check for updates"); // NEW
    assert.equal(updateButton.disabled, true); // NEW
    updateButton.click(); // NEW
    assert.equal(sentMessages.length, 0); // NEW
}); // NEW

test("Trellis updates dialog shows inline GitHub fallback on fetch failure", async () => {
    const fakeFetch = async () => {
        throw new Error("renderer fetch should not be used when bridge exists"); // CHANGE
    };
    const mxUtils = {
        get(url, success) {
            success({ getText: () => JSON.stringify({ version: 1, entries: [{ title: "Local fallback", items: ["Still available."] }] }) });
        }
    };
    const { callbacks, releaseCalls } = loadPlugin({ fetch: fakeFetch, mxUtils, releaseError: new Error("offline") }); // CHANGE
    const { ui, actions, shown } = createUi();

    callbacks.forEach(callback => callback(ui));
    actions.trellisUpdatesLinks.funct();
    await settle();

    assert.match(shown[0].node.textContent, /Live GitHub releases are unavailable right now/); // CHANGE
    assert.match(shown[0].node.textContent, /Still available/);
    assert.ok(findButton(shown[0].node, "Retry"));
    findButton(shown[0].node, "Retry").click(); // NEW
    await settle(); // NEW
    assert.deepEqual(releaseCalls, ["trellisApp.getReleases", "trellisApp.getReleases"]); // NEW
});

test("Trellis updates integration is registered, default-loaded, and bridged", () => {
    const appSource = readProjectFile("drawio/src/main/webapp/js/diagramly/App.js");
    const bundledSource = readProjectFile("drawio/src/main/webapp/js/app.min.js");
    const integrateSource = readProjectFile("drawio/src/main/webapp/js/integrate.min.js");
    const preloadSource = readProjectFile("src/main/electron-preload.js");
    const electronSource = readProjectFile("src/main/electron.js");

    assert.match(appSource, /'trellisUpdatesLinks': 'plugins\/garden_planner_plugins\/Trellis_Updates_Links\.js'/);
    assert.match(appSource, /App\.loadPlugins\(\['trellisUpdatesLinks', 'trellisDatabaseTools', 'trellisUiCleanup', 'trellisUsers'\]\); \/\/ CHANGE/); // CHANGE
    assert.ok(appSource.indexOf("App.loadPlugins(['trellisUpdatesLinks', 'trellisDatabaseTools', 'trellisUiCleanup', 'trellisUsers']); // CHANGE") < appSource.indexOf("if (urlParams['plugins'] != '0' && urlParams['offline'] != '1')")); // CHANGE
    assert.match(bundledSource, /'trellisUpdatesLinks': 'plugins\/garden_planner_plugins\/Trellis_Updates_Links\.js'/);
    assert.match(bundledSource, /App\.loadPlugins\(\["trellisUpdatesLinks","trellisDatabaseTools","trellisUiCleanup","trellisUsers"\]\)/); // CHANGE
    assert.ok(bundledSource.indexOf('App.loadPlugins(["trellisUpdatesLinks","trellisDatabaseTools","trellisUiCleanup","trellisUsers"])') < bundledSource.indexOf('if("0"!=urlParams.plugins&&"1"!=urlParams.offline)')); // CHANGE
    assert.match(integrateSource, /trellisUpdatesLinks:"plugins\/garden_planner_plugins\/Trellis_Updates_Links\.js"/);
    assert.match(integrateSource, /App\.loadPlugins\(\["trellisUpdatesLinks","trellisDatabaseTools","trellisUiCleanup","trellisUsers"\]\)/); // CHANGE
    assert.ok(integrateSource.indexOf('App.loadPlugins(["trellisUpdatesLinks","trellisDatabaseTools","trellisUiCleanup","trellisUsers"])') < integrateSource.indexOf('if("0"!=urlParams.plugins&&"1"!=urlParams.offline)')); // CHANGE
    assert.match(preloadSource, /contextBridge\.exposeInMainWorld\('trellisApp'/);
    assert.match(preloadSource, /getReleases\(\) \{ \/\/ NEW/); // NEW
    assert.match(preloadSource, /\{ action: 'getTrellisReleases' \}, \/\/ NEW/); // NEW
    assert.match(preloadSource, /contextBridge\.exposeInMainWorld\('trellisShare'/); // NEW
    assert.match(preloadSource, /action: 'getTrellisSyncthingShareInfo'/); // NEW
    assert.match(preloadSource, /action: 'openTrellisEmailDraft'/); // NEW
    assert.match(electronSource, /case 'getTrellisAppInfo': \/\/ NEW/);
    assert.match(electronSource, /const trellisReleasesApiUrl = 'https:\/\/api\.github\.com\/repos\/Benjamin-Elon\/trellis-studio\/releases\?per_page=10'; \/\/ CHANGE/); // CHANGE
    assert.match(electronSource, /const trellisReleasesTimeoutMs = 15000; \/\/ NEW/); // NEW
    assert.match(electronSource, /async function getTrellisReleases\(\) \{ \/\/ NEW/); // NEW
    assert.match(electronSource, /fetch\(trellisReleasesApiUrl/); // NEW
    assert.match(electronSource, /controller\.abort\(\)/); // NEW
    assert.match(electronSource, /case 'getTrellisReleases': \/\/ NEW/); // NEW
    assert.match(electronSource, /case 'getTrellisSyncthingShareInfo': \/\/ NEW/); // NEW
    assert.match(electronSource, /case 'openTrellisEmailDraft': \/\/ NEW/); // NEW
    assert.match(electronSource, /mailto:/); // NEW
    assert.match(electronSource, /canCheckForUpdates: canCheckForUpdates\(\) \/\/ NEW/); // NEW
});
