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
    const releaseCalls = [];
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
            return Promise.resolve(Object.assign({
                productName: "Trellis Studio",
                version: "1.1.2",
                repoUrl: "https://github.com/Benjamin-Elon/trellis-studio",
                releasesUrl: "https://github.com/Benjamin-Elon/trellis-studio/releases",
                issuesUrl: "https://github.com/Benjamin-Elon/trellis-studio/issues",
                isPackaged: true,
                canCheckForUpdates: true
            }, options.appInfo || {}));
        }
    };
    if (options.includeGetReleases !== false) {
        context.window.trellisApp.getReleases = function () {
            releaseCalls.push("trellisApp.getReleases");
            if (options.releaseError) return Promise.reject(options.releaseError);
            return Promise.resolve(options.releases || []);
        };
    }
    context.window.open = href => openedLinks.push(href);

    vm.runInNewContext(readProjectFile("drawio/src/main/webapp/plugins/garden_planner_plugins/Trellis_Updates_Links.js"), context, { filename: pluginPath });
    return { context, callbacks, sentMessages, openedLinks, releaseCalls, document: dom.window.document };
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
            dialog: { bg: { style: {} }, container: { style: {} } },
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
        throw new Error("renderer fetch should not be used when bridge exists");
    };
    const releases = [{
        tag_name: "v1.1.3",
        name: "Trellis 1.1.3",
        published_at: "2026-06-27T00:00:00Z",
        html_url: "https://github.com/Benjamin-Elon/trellis-studio/releases/tag/v1.1.3",
        body: "One useful change for gardeners."
    }];
    const mxUtils = {
        get(url, success) {
            assert.equal(url, "plugins/garden_planner_plugins/trellis_changelog.json");
            success({ getText: () => JSON.stringify({ version: 1, entries: [{ version: "1.1.2", date: "2026-06-28", items: ["Bundled changelog entry."] }] }) });
        }
    };
    const { callbacks, sentMessages, releaseCalls } = loadPlugin({ fetch: fakeFetch, mxUtils, releases });
    const { ui, actions, shown } = createUi();

    callbacks.forEach(callback => callback(ui));
    assert.equal(actions.trellisUpdatesLinks.label, "Trellis Updates & Links");

    const menu = { items: [] };
    ui.menus.get("help").funct(menu, null);
    assert.deepEqual(menu.items, ["base-help", "-", "trellisUpdatesLinks"]);

    actions.trellisUpdatesLinks.funct();
    await settle();

    assert.equal(shown.length, 1);
    assert.equal(ui.dialog.container.style.zIndex, "2000000000");
    assert.equal(ui.dialog.bg.style.zIndex, "1999999999");
    assert.equal(shown[0].width, 960);
    assert.equal(shown[0].height, 620);
    assert.equal(shown[0].node.querySelectorAll("[role='tab']").length, 0);
    assert.equal(shown[0].node.querySelectorAll(".trellis-updates-pane").length, 2);
    assert.match(shown[0].node.textContent, /Support/);
    assert.match(shown[0].node.textContent, /Project/);
    assert.match(shown[0].node.textContent, /Contact/);
    assert.doesNotMatch(shown[0].node.textContent, /Patreon/i);
    assert.match(shown[0].node.textContent, /Trellis Studio 1\.1\.2/);
    assert.match(shown[0].node.textContent, /Trellis 1\.1\.3/);
    assert.match(shown[0].node.textContent, /Bundled changelog entry/);
    assert.equal(findButton(shown[0].node, "Retry"), undefined);

    findButton(shown[0].node, "Check for updates").click();
    assert.deepEqual(sentMessages.at(-1), { action: "checkForUpdates", args: undefined });
    assert.deepEqual(releaseCalls, ["trellisApp.getReleases"]);
});

test("Trellis updates falls back to direct release fetch without bridge", async () => {
    const fetchCalls = [];
    const fakeFetch = async url => {
        fetchCalls.push(String(url));
        return {
            ok: true,
            async json() {
                return [{ tag_name: "v1.1.4", name: "Direct release", published_at: "2026-06-28T00:00:00Z", html_url: "https://github.com/release", body: "" }];
            }
        };
    };
    const mxUtils = {
        get(url, success) {
            success({ getText: () => JSON.stringify({ version: 1, entries: [] }) });
        }
    };
    const { callbacks } = loadPlugin({ fetch: fakeFetch, mxUtils, includeGetReleases: false });
    const { ui, actions, shown } = createUi();

    callbacks.forEach(callback => callback(ui));
    actions.trellisUpdatesLinks.funct();
    await settle();

    assert.match(shown[0].node.textContent, /Direct release/);
    assert.ok(fetchCalls.some(url => url.includes("api.github.com") && url.includes("per_page=10")));
});

test("Trellis updates dialog remains visible but disables update checks for developer builds", async () => {
    const fakeFetch = async () => ({
        ok: true,
        async json() { return []; }
    });
    const mxUtils = {
        get(url, success) {
            success({ getText: () => JSON.stringify({ version: 1, entries: [] }) });
        }
    };
    const { callbacks, sentMessages } = loadPlugin({ fetch: fakeFetch, mxUtils, appInfo: { isPackaged: false, canCheckForUpdates: false } });
    const { ui, actions, shown } = createUi();

    callbacks.forEach(callback => callback(ui));
    actions.trellisUpdatesLinks.funct();
    await settle();

    assert.equal(shown.length, 1);
    assert.match(shown[0].node.textContent, /Update checks are disabled in developer builds/);
    const updateButton = findButton(shown[0].node, "Check for updates");
    assert.equal(updateButton.disabled, true);
    updateButton.click();
    assert.equal(sentMessages.length, 0);
});

test("Trellis updates dialog shows inline GitHub fallback on fetch failure", async () => {
    const fakeFetch = async () => {
        throw new Error("renderer fetch should not be used when bridge exists");
    };
    const mxUtils = {
        get(url, success) {
            success({ getText: () => JSON.stringify({ version: 1, entries: [{ title: "Local fallback", items: ["Still available."] }] }) });
        }
    };
    const { callbacks, releaseCalls } = loadPlugin({ fetch: fakeFetch, mxUtils, releaseError: new Error("offline") });
    const { ui, actions, shown } = createUi();

    callbacks.forEach(callback => callback(ui));
    actions.trellisUpdatesLinks.funct();
    await settle();

    assert.match(shown[0].node.textContent, /Live GitHub releases are unavailable right now/);
    assert.match(shown[0].node.textContent, /Still available/);
    assert.ok(findButton(shown[0].node, "Retry"));
    findButton(shown[0].node, "Retry").click();
    await settle();
    assert.deepEqual(releaseCalls, ["trellisApp.getReleases", "trellisApp.getReleases"]);
});

test("Trellis updates integration is registered, default-loaded, and bridged", () => {
    const appSource = readProjectFile("drawio/src/main/webapp/js/diagramly/App.js");
    const bundledSource = readProjectFile("drawio/src/main/webapp/js/app.min.js");
    const integrateSource = readProjectFile("drawio/src/main/webapp/js/integrate.min.js");
    const preloadSource = readProjectFile("src/main/electron-preload.js");
    const electronSource = readProjectFile("src/main/electron.js");

    assert.match(appSource, /'trellisUpdatesLinks': 'plugins\/garden_planner_plugins\/Trellis_Updates_Links\.js'/);
    assert.match(appSource, /App\.trellisDefaultPlugins = App\.publicPlugin\.slice\(\); \/\/ NEW/);
    assert.match(appSource, /App\.loadPlugins\(App\.trellisDefaultPlugins\); \/\/ CHANGE/);
    assert.ok(appSource.indexOf("App.loadPlugins(App.trellisDefaultPlugins); // CHANGE") < appSource.indexOf("if (urlParams['plugins'] != '0' && urlParams['offline'] != '1')"));
    assert.match(bundledSource, /'trellisUpdatesLinks': 'plugins\/garden_planner_plugins\/Trellis_Updates_Links\.js'/);
    assert.match(bundledSource, /App\.trellisDefaultPlugins=App\.publicPlugin\.slice\(\)/);
    assert.match(bundledSource, /App\.loadPlugins\(App\.trellisDefaultPlugins\)/);
    assert.ok(bundledSource.indexOf('App.loadPlugins(App.trellisDefaultPlugins)') < bundledSource.indexOf('if("0"!=urlParams.plugins&&"1"!=urlParams.offline)'));
    assert.match(integrateSource, /trellisUpdatesLinks:"plugins\/garden_planner_plugins\/Trellis_Updates_Links\.js"/);
    assert.match(integrateSource, /App\.trellisDefaultPlugins=App\.publicPlugin\.slice\(\)/);
    assert.match(integrateSource, /App\.loadPlugins\(App\.trellisDefaultPlugins\)/);
    assert.ok(integrateSource.indexOf('App.loadPlugins(App.trellisDefaultPlugins)') < integrateSource.indexOf('if("0"!=urlParams.plugins&&"1"!=urlParams.offline)'));
    assert.match(preloadSource, /contextBridge\.exposeInMainWorld\('trellisApp'/);
    assert.match(preloadSource, /getReleases\(\) \{/);
    assert.match(preloadSource, /\{ action: 'getTrellisReleases' \},/);
    assert.match(preloadSource, /contextBridge\.exposeInMainWorld\('trellisShare'/);
    assert.match(preloadSource, /action: 'getTrellisSyncthingShareInfo'/);
    assert.match(preloadSource, /action: 'openTrellisEmailDraft'/);
    assert.match(electronSource, /case 'getTrellisAppInfo':/);
    assert.match(electronSource, /const trellisReleasesApiUrl = 'https:\/\/api\.github\.com\/repos\/Benjamin-Elon\/trellis-studio\/releases\?per_page=10';/);
    assert.match(electronSource, /const trellisReleasesTimeoutMs = 15000;/);
    assert.match(electronSource, /async function getTrellisReleases\(\) \{/);
    assert.match(electronSource, /fetch\(trellisReleasesApiUrl/);
    assert.match(electronSource, /controller\.abort\(\)/);
    assert.match(electronSource, /case 'getTrellisReleases':/);
    assert.match(electronSource, /case 'getTrellisSyncthingShareInfo':/);
    assert.match(electronSource, /case 'openTrellisEmailDraft':/);
    assert.match(electronSource, /mailto:/);
    assert.match(electronSource, /canCheckForUpdates: canCheckForUpdates\(\)/);
});
