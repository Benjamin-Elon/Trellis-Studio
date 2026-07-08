const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { JSDOM } = require("jsdom");

const projectRoot = path.resolve(__dirname, "..");
const pluginPath = path.join(projectRoot, "drawio/src/main/webapp/plugins/garden_planner_plugins/Trellis_UI_Cleanup.js");

const ACTION_LABELS = {
    synchronize: "Synchronize",
    pageSetup: "Page Setup",
    close: "Close",
    exit: "Exit",
    undo: "Undo",
    redo: "Redo",
    cut: "Cut",
    copy: "Copy",
    copyAsImage: "Copy As Image",
    copyAsSvg: "Copy As SVG",
    paste: "Paste",
    delete: "Delete",
    duplicate: "Duplicate",
    findReplace: "Find/Replace",
    editData: "Edit Data",
    editTooltip: "Edit Tooltip",
    editStyle: "Edit Style",
    editGeometry: "Edit Geometry",
    edit: "Edit",
    editLink: "Edit Link",
    openLink: "Open Link",
    selectVertices: "Select Vertices",
    selectEdges: "Select Edges",
    selectAll: "Select All",
    selectNone: "Select None",
    lockUnlock: "Lock/Unlock",
    grid: "Grid",
    guides: "Guides",
    format: "Format",
    toggleShapes: "Shapes",
    pageTabs: "Page Tabs",
    ruler: "Ruler",
    search: "Search",
    scratchpad: "Scratchpad",
    outline: "Outline",
    layers: "Layers",
    tags: "Tags",
    comments: "Comments",
    pageView: "Page View",
    pageScale: "Page Scale",
    tooltips: "Tooltips",
    animations: "Animations",
    connectionArrows: "Connection Arrows",
    connectionPoints: "Connection Points",
    resetView: "Reset View",
    zoomIn: "Zoom In",
    zoomOut: "Zoom Out",
    fullscreen: "Fullscreen",
    toFront: "To Front",
    toBack: "To Back",
    bringForward: "Bring Forward",
    sendBackward: "Send Backward",
    group: "Group",
    ungroup: "Ungroup",
    removeFromGroup: "Remove From Group",
    clearWaypoints: "Clear Waypoints",
    autosize: "Autosize",
    plugins: "Plugins",
    trellisRestoreBuiltInDatabase: "Restore Built-in Trellis Database...",
    desktopResetZoom: "Actual Size",
    desktopZoomIn: "Zoom In",
    desktopZoomOut: "Zoom Out"
};

class TestMenu {
    constructor(document) {
        this.document = document;
        this.table = document.createElement("table");
        this.tbody = document.createElement("tbody");
        this.table.appendChild(this.tbody);
        this.div = document.createElement("div");
        this.div.appendChild(this.table);
    }

    addItem(title, image, funct, parent) {
        const owner = parent || this;
        if (!owner.tbody) owner.tbody = this.document.createElement("tbody");

        const row = this.document.createElement("tr");
        const icon = this.document.createElement("td");
        const label = this.document.createElement("td");
        label.textContent = title;
        row.appendChild(icon);
        row.appendChild(label);
        owner.tbody.appendChild(row);
        return row;
    }

    addSeparator(parent) {
        const owner = parent || this;
        if (!owner.tbody) owner.tbody = this.document.createElement("tbody");

        const row = this.document.createElement("tr");
        const cell = this.document.createElement("td");
        cell.className = "mxPopupMenuSeparator";
        row.appendChild(cell);
        owner.tbody.appendChild(row);
        return row;
    }

    getVisibleLabels(parent) {
        const owner = parent || this;
        return Array.from(owner.tbody.children)
            .filter(row => row.style.display !== "none")
            .map(row => row.textContent.trim())
            .filter(Boolean);
    }

    getSubmenu(title, parent) {
        const owner = parent || this;
        return Array.from(owner.tbody.children).find(row => row.textContent.trim() === title);
    }

    getSubmenuLabels(title, parent) {
        const submenu = this.getSubmenu(title, parent);
        if (!submenu || !submenu.tbody) return [];
        return this.getVisibleLabels(submenu);
    }
}

function readProjectFile(relPath) {
    return fs.readFileSync(path.join(projectRoot, relPath), "utf8");
}

function makeSubmenuEntry(label, childLabels = []) {
    return {
        funct(menu, parent) {
            childLabels.forEach(childLabel => menu.addItem(childLabel, null, null, parent));
        },
        isEnabled() {
            return true;
        },
        label
    };
}

function createHarness() {
    const dom = new JSDOM("<!doctype html><html><body></body></html>");
    const document = dom.window.document;
    const calls = [];
    dom.window.setTimeout = fn => {
        fn();
        return 0;
    };

    const toolbarContainer = document.createElement("div");
    const mainToolbar = document.createElement("div");
    ["View", "Separator", "Zoom", "Undo", "Delete", "Insert"].forEach(label => {
        const node = document.createElement("button");
        node.textContent = label;
        mainToolbar.appendChild(node);
    });

    const toolbarEnd = document.createElement("div");
    toolbarEnd.className = "geToolbarEnd";
    ["Fullscreen", "Format", "Compact"].forEach(label => {
        const node = document.createElement("button");
        node.textContent = label;
        toolbarEnd.appendChild(node);
    });
    toolbarContainer.appendChild(toolbarEnd);

    const menuEntries = {
        file: {
            funct(menu, parent) {
                menu.addItem("New", null, null, parent);
                menu.addItem("Synchronize", null, null, parent);
                const newLibrary = menu.addItem("New Library", null, null, parent);
                newLibrary.tbody = document.createElement("tbody");
                const openLibrary = menu.addItem("Open Library", null, null, parent);
                openLibrary.tbody = document.createElement("tbody");
                menu.addItem("Page Setup", null, null, parent);
                menu.addItem("Save", null, null, parent);
                menu.addItem("Close", null, null, parent);
                menu.addItem("Exit", null, null, parent);
            }
        },
        edit: { funct(menu, parent) { menu.addItem("Old Edit", null, null, parent); } },
        view: { funct(menu, parent) { menu.addItem("Old View", null, null, parent); } },
        arrange: { funct(menu, parent) { menu.addItem("Old Arrange", null, null, parent); } },
        extras: {
            funct(menu, parent) {
                menu.addItem("Language", null, null, parent);
                menu.addItem("Plugins", null, null, parent);
                menu.addItem("Restore Built-in Trellis Database...", null, null, parent);
                menu.addItem("Configuration", null, null, parent);
            }
        },
        help: {
            funct(menu, parent) {
                menu.addItem("Keyboard Shortcuts", null, null, parent);
                menu.addItem("Actual Size", null, null, parent);
                menu.addItem("Zoom In", null, null, parent);
                menu.addItem("Zoom Out", null, null, parent);
                menu.addItem("About", null, null, parent);
                menu.addItem("Trellis Updates & Links", null, null, parent);
            }
        },
        newLibrary: makeSubmenuEntry("New Library", ["Blank Library"]),
        openLibraryFrom: makeSubmenuEntry("Open Library", ["Device"]),
        direction: makeSubmenuEntry("Direction"),
        turn: makeSubmenuEntry("Turn"),
        align: makeSubmenuEntry("Align"),
        distribute: makeSubmenuEntry("Distribute"),
        navigation: makeSubmenuEntry("Navigation"),
        insert: makeSubmenuEntry("Insert"),
        layout: makeSubmenuEntry("Layout")
    };

    const ui = {
        actions: {
            get(actionKey) {
                if (!Object.prototype.hasOwnProperty.call(ACTION_LABELS, actionKey)) return null;
                return {
                    label: ACTION_LABELS[actionKey],
                    funct() {
                        calls.push(["action", actionKey]);
                    }
                };
            }
        },
        menus: {
            get(name) {
                return menuEntries[name] || null;
            },
            addSubmenu(name, menu, parent, label) {
                const entry = menuEntries[name];
                if (!entry) return null;
                const submenu = menu.addItem(label || entry.label || name, null, null, parent);
                entry.funct(menu, submenu);
                return submenu;
            }
        },
        toolbar: { container: mainToolbar },
        toolbarContainer,
        setCompactMode(active, remember, delay) {
            calls.push(["compact", active, remember, delay]);
        },
        toggleShapesPanel(show) {
            calls.push(["shapes", show]);
        },
        toggleFormatPanel(show) {
            calls.push(["formatPanel", show]);
        }
    };

    const context = {
        window: dom.window,
        document,
        console,
        Draw: {
            loadPlugin(callback) {
                callback(ui);
            }
        }
    };

    vm.runInNewContext(readProjectFile("drawio/src/main/webapp/plugins/garden_planner_plugins/Trellis_UI_Cleanup.js"), context, { filename: pluginPath });
    return { document, ui, calls, menuEntries, mainToolbar, toolbarEnd };
}

test("startup collapses header row, sidebars, and prunes toolbar controls", () => {
    const { calls, mainToolbar, toolbarEnd } = createHarness();

    assert.deepEqual(calls.filter(call => call[0] !== "action"), [
        ["compact", true, false, 0],
        ["shapes", false],
        ["formatPanel", false]
    ]);
    assert.deepEqual(Array.from(mainToolbar.children).map(node => node.textContent), ["View"]);
    assert.deepEqual(Array.from(toolbarEnd.children).map(node => node.textContent), ["Format", "Compact"]);
});

test("File keeps normal entries and moves only named draw.io entries to overflow", () => {
    const { document, menuEntries } = createHarness();
    const menu = new TestMenu(document);

    menuEntries.file.funct(menu, null);

    assert.deepEqual(menu.getVisibleLabels(), ["New", "Save", "More draw.io file options"]);
    assert.deepEqual(menu.getSubmenuLabels("More draw.io file options"), [
        "Synchronize",
        "New Library",
        "Open Library",
        "Page Setup",
        "Close",
        "Exit"
    ]);
});

test("Edit and Arrange expose a single escape-hatch submenu", () => {
    const { document, menuEntries } = createHarness();
    const editMenu = new TestMenu(document);
    const arrangeMenu = new TestMenu(document);

    menuEntries.edit.funct(editMenu, null);
    menuEntries.arrange.funct(arrangeMenu, null);

    assert.deepEqual(editMenu.getVisibleLabels(), ["More draw.io edit options"]);
    assert.ok(editMenu.getSubmenuLabels("More draw.io edit options").includes("Edit Style"));
    assert.ok(editMenu.getSubmenuLabels("More draw.io edit options").includes("Select All"));
    assert.deepEqual(arrangeMenu.getVisibleLabels(), ["More draw.io arrange options"]);
    assert.ok(arrangeMenu.getSubmenuLabels("More draw.io arrange options").includes("To Front"));
    assert.ok(arrangeMenu.getSubmenuLabels("More draw.io arrange options").includes("Group"));
});

test("View top level contains only Grid, Guides, and overflow", () => {
    const { document, menuEntries } = createHarness();
    const menu = new TestMenu(document);

    menuEntries.view.funct(menu, null);

    assert.deepEqual(menu.getVisibleLabels(), ["Grid", "Guides", "More draw.io view options"]);
    assert.ok(menu.getSubmenuLabels("More draw.io view options").includes("Format"));
    assert.ok(menu.getSubmenuLabels("More draw.io view options").includes("Zoom In"));
});

test("Extras keeps Plugins and Trellis database restore at top level", () => {
    const { document, menuEntries } = createHarness();
    const menu = new TestMenu(document);

    menuEntries.extras.funct(menu, null);

    assert.deepEqual(menu.getVisibleLabels(), [
        "Plugins",
        "Restore Built-in Trellis Database...",
        "More draw.io extras"
    ]);
    assert.deepEqual(menu.getSubmenuLabels("More draw.io extras"), ["Language", "Configuration"]);
});

test("Help moves only desktop zoom items into overflow", () => {
    const { document, menuEntries } = createHarness();
    const menu = new TestMenu(document);

    menuEntries.help.funct(menu, null);

    assert.deepEqual(menu.getVisibleLabels(), [
        "Keyboard Shortcuts",
        "About",
        "Trellis Updates & Links",
        "More draw.io help options"
    ]);
    assert.deepEqual(menu.getSubmenuLabels("More draw.io help options"), [
        "Actual Size",
        "Zoom In",
        "Zoom Out"
    ]);
});

test("plugin install guard prevents duplicate wrapping", () => {
    const harness = createHarness();
    const { document, menuEntries, ui } = harness;
    const context = {
        window: document.defaultView,
        document,
        console,
        Draw: {
            loadPlugin(callback) {
                callback(ui);
            }
        }
    };
    const menu = new TestMenu(document);

    vm.runInNewContext(readProjectFile("drawio/src/main/webapp/plugins/garden_planner_plugins/Trellis_UI_Cleanup.js"), context, { filename: pluginPath });
    menuEntries.view.funct(menu, null);

    assert.deepEqual(menu.getVisibleLabels(), ["Grid", "Guides", "More draw.io view options"]);
});
