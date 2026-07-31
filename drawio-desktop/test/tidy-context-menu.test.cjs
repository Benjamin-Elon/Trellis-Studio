const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { JSDOM } = require("jsdom");

const PLUGIN_PATH = path.join(
    __dirname,
    "..",
    "drawio",
    "src",
    "main",
    "webapp",
    "plugins",
    "garden_planner_plugins",
    "Tidy_Context_Menu.js"
);

const ACTION_LABELS = {
    cut: "Cut",
    copy: "Copy",
    copyAsImage: "Copy As Image",
    copyAsSvg: "Copy As SVG",
    duplicate: "Duplicate",
    toFront: "To Front",
    toBack: "To Back",
    bringForward: "Bring Forward",
    sendBackward: "Send Backward",
    editStyle: "Edit Style",
    editData: "Edit Data",
    editLink: "Edit Link",
    editConnectionPoints: "Edit Connection Points",
    setAsDefaultStyle: "Set As Default Style"
};

class TestCell {
    constructor(attributes = {}) {
        this.attributes = new Map(Object.entries(attributes));
    }

    getAttribute(key) {
        return this.attributes.has(key) ? this.attributes.get(key) : null;
    }
}

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
        if (!owner.tbody) {
            owner.tbody = this.document.createElement("tbody");
        }

        const row = this.document.createElement("tr");
        row.className = "mxPopupMenuItem";
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
        if (!owner.tbody) {
            owner.tbody = this.document.createElement("tbody");
        }

        const row = this.document.createElement("tr");
        const cell = this.document.createElement("td");
        cell.className = "mxPopupMenuSeparator";
        row.appendChild(cell);
        owner.tbody.appendChild(row);
    }

    getTopLevelLabels() {
        return Array.from(this.tbody.children)
            .filter(row => row.style.display !== "none")
            .map(row => row.textContent.trim())
            .filter(Boolean);
    }

    getSubmenuLabels(title) {
        const parent = Array.from(this.tbody.children).find(row => row.textContent.trim() === title);
        if (!parent || !parent.tbody) return [];
        return Array.from(parent.tbody.children)
            .map(row => row.textContent.trim())
            .filter(Boolean);
    }
}

function seedStandardRows(menu) {
    Object.values(ACTION_LABELS).forEach(label => menu.addItem(label));
}

function loadTidyContributor(selectedCells = []) {
    const dom = new JSDOM("<!doctype html><body></body>");
    const contributors = [];
    const graph = {
        getSelectionCells() { return selectedCells; },
        getTooltipForCell() { return "tooltip"; }
    };
    const ui = {
        editor: { graph },
        actions: {
            get(actionKey) {
                return { label: ACTION_LABELS[actionKey] || actionKey, funct() {} };
            }
        }
    };
    const context = {
        window: dom.window,
        document: dom.window.document,
        console,
        Draw: { loadPlugin(callback) { callback(ui); } }
    };

    dom.window.console = console;
    dom.window.TrellisContextMenu = {
        install() {},
        register(contributor) { contributors.push(contributor); }
    };

    vm.runInNewContext(fs.readFileSync(PLUGIN_PATH, "utf8"), context, { filename: PLUGIN_PATH });
    assert.equal(contributors.length, 1);
    return { contributor: contributors[0], graph, document: dom.window.document };
}

test("tidy menu applies standard action submenus to regular cells", () => {
    const { contributor, document } = loadTidyContributor();
    const menu = new TestMenu(document);
    seedStandardRows(menu);

    contributor.addItems(menu, new TestCell(), null);

    assert.equal(menu.getTopLevelLabels().includes("Standard draw.io actions"), false);
    assert.deepEqual(menu.getTopLevelLabels().filter(label => [
        "Copy / Paste",
        "Move / Arrange",
        "Edit Shape",
        "Style"
    ].includes(label)), [
        "Copy / Paste",
        "Move / Arrange",
        "Edit Shape",
        "Style"
    ]);
    assert.deepEqual(menu.getSubmenuLabels("Copy / Paste"), [
        "Cut",
        "Copy",
        "Copy As Image",
        "Copy As SVG",
        "Duplicate"
    ]);
    assert.equal(menu.getTopLevelLabels().includes("Cut"), false);
    assert.equal(menu.getTopLevelLabels().includes("To Front"), false);
    assert.equal(menu.getTopLevelLabels().includes("Edit Style"), false);
});

test("tidy menu keeps Trellis cells under the standard actions parent", () => {
    const { contributor, document } = loadTidyContributor();
    const menu = new TestMenu(document);
    seedStandardRows(menu);

    contributor.addItems(menu, new TestCell({ garden_bed: "1" }), null);

    assert.ok(menu.getTopLevelLabels().includes("Standard draw.io actions"));
    assert.deepEqual(menu.getSubmenuLabels("Standard draw.io actions"), [
        "Copy / Paste",
        "Move / Arrange",
        "Edit Shape",
        "Style"
    ]);
    assert.equal(menu.getTopLevelLabels().includes("Copy / Paste"), false);
});

test("tidy menu leaves blank canvas menus unchanged when no selection exists", () => {
    const { contributor, document } = loadTidyContributor();
    const menu = new TestMenu(document);
    seedStandardRows(menu);

    contributor.addItems(menu, null, null);

    assert.equal(menu.getTopLevelLabels().includes("Standard draw.io actions"), false);
    assert.equal(menu.getTopLevelLabels().includes("Cut"), true);
});

test("tidy menu still suppresses Trellis tooltips without suppressing regular cells", () => {
    const { graph } = loadTidyContributor();

    assert.equal(graph.getTooltipForCell(new TestCell({ garden_bed: "1" })), "");
    assert.equal(graph.getTooltipForCell(new TestCell({ lane_key: "TODO" })), "");
    assert.equal(graph.getTooltipForCell(new TestCell({ irrigation_generated: "1" })), "");
    assert.equal(graph.getTooltipForCell(new TestCell({ irrigation_assembly: "1" })), "");
    assert.equal(graph.getTooltipForCell(new TestCell({ irrigation_pipe_edge: "1" })), "");
    assert.equal(graph.getTooltipForCell(new TestCell({ irrigation_direct_link_edge: "1" })), "");
    assert.equal(graph.getTooltipForCell(new TestCell({ irrigation_component: "1" })), "");
    assert.equal(graph.getTooltipForCell(new TestCell()), "tooltip");
});
