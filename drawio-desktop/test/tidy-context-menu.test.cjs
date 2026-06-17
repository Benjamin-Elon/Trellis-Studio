const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { JSDOM } = require("jsdom");

const PLUGIN_PATH = path.join( // NEW
    __dirname, // NEW
    "..", // NEW
    "drawio", // NEW
    "src", // NEW
    "main", // NEW
    "webapp", // NEW
    "plugins", // NEW
    "garden_planner_plugins", // NEW
    "Tidy_context_menu.js" // NEW
); // NEW

const ACTION_LABELS = { // NEW
    cut: "Cut", // NEW
    copy: "Copy", // NEW
    copyAsImage: "Copy As Image", // NEW
    copyAsSvg: "Copy As SVG", // NEW
    duplicate: "Duplicate", // NEW
    toFront: "To Front", // NEW
    toBack: "To Back", // NEW
    bringForward: "Bring Forward", // NEW
    sendBackward: "Send Backward", // NEW
    editStyle: "Edit Style", // NEW
    editData: "Edit Data", // NEW
    editLink: "Edit Link", // NEW
    editConnectionPoints: "Edit Connection Points", // NEW
    setAsDefaultStyle: "Set As Default Style" // NEW
}; // NEW

class TestCell { // NEW
    constructor(attributes = {}) { // NEW
        this.attributes = new Map(Object.entries(attributes)); // NEW
    } // NEW

    getAttribute(key) { // NEW
        return this.attributes.has(key) ? this.attributes.get(key) : null; // NEW
    } // NEW
} // NEW

class TestMenu { // NEW
    constructor(document) { // NEW
        this.document = document; // NEW
        this.table = document.createElement("table"); // NEW
        this.tbody = document.createElement("tbody"); // NEW
        this.table.appendChild(this.tbody); // NEW
        this.div = document.createElement("div"); // NEW
        this.div.appendChild(this.table); // NEW
    } // NEW

    addItem(title, image, funct, parent) { // NEW
        const owner = parent || this; // NEW
        if (!owner.tbody) { // NEW
            owner.tbody = this.document.createElement("tbody"); // NEW
        } // NEW

        const row = this.document.createElement("tr"); // NEW
        row.className = "mxPopupMenuItem"; // NEW
        const icon = this.document.createElement("td"); // NEW
        const label = this.document.createElement("td"); // NEW
        label.textContent = title; // NEW
        row.appendChild(icon); // NEW
        row.appendChild(label); // NEW
        owner.tbody.appendChild(row); // NEW
        return row; // NEW
    } // NEW

    addSeparator(parent) { // NEW
        const owner = parent || this; // NEW
        if (!owner.tbody) { // NEW
            owner.tbody = this.document.createElement("tbody"); // NEW
        } // NEW

        const row = this.document.createElement("tr"); // NEW
        const cell = this.document.createElement("td"); // NEW
        cell.className = "mxPopupMenuSeparator"; // NEW
        row.appendChild(cell); // NEW
        owner.tbody.appendChild(row); // NEW
    } // NEW

    getTopLevelLabels() { // NEW
        return Array.from(this.tbody.children) // NEW
            .filter(row => row.style.display !== "none") // NEW
            .map(row => row.textContent.trim()) // NEW
            .filter(Boolean); // NEW
    } // NEW

    getSubmenuLabels(title) { // NEW
        const parent = Array.from(this.tbody.children).find(row => row.textContent.trim() === title); // NEW
        if (!parent || !parent.tbody) return []; // NEW
        return Array.from(parent.tbody.children) // NEW
            .map(row => row.textContent.trim()) // NEW
            .filter(Boolean); // NEW
    } // NEW
} // NEW

function seedStandardRows(menu) { // NEW
    Object.values(ACTION_LABELS).forEach(label => menu.addItem(label)); // NEW
} // NEW

function loadTidyContributor(selectedCells = []) { // NEW
    const dom = new JSDOM("<!doctype html><body></body>"); // NEW
    const contributors = []; // NEW
    const graph = { // NEW
        getSelectionCells() { return selectedCells; }, // NEW
        getTooltipForCell() { return "tooltip"; } // NEW
    }; // NEW
    const ui = { // NEW
        editor: { graph }, // NEW
        actions: { // NEW
            get(actionKey) { // NEW
                return { label: ACTION_LABELS[actionKey] || actionKey, funct() {} }; // NEW
            } // NEW
        } // NEW
    }; // NEW
    const context = { // NEW
        window: dom.window, // NEW
        document: dom.window.document, // NEW
        console, // NEW
        Draw: { loadPlugin(callback) { callback(ui); } } // NEW
    }; // NEW

    dom.window.console = console; // NEW
    dom.window.TrellisContextMenu = { // NEW
        install() {}, // NEW
        register(contributor) { contributors.push(contributor); } // NEW
    }; // NEW

    vm.runInNewContext(fs.readFileSync(PLUGIN_PATH, "utf8"), context, { filename: PLUGIN_PATH }); // NEW
    assert.equal(contributors.length, 1); // NEW
    return { contributor: contributors[0], graph, document: dom.window.document }; // NEW
} // NEW

test("tidy menu applies standard action submenus to regular cells", () => { // NEW
    const { contributor, document } = loadTidyContributor(); // NEW
    const menu = new TestMenu(document); // NEW
    seedStandardRows(menu); // NEW

    contributor.addItems(menu, new TestCell(), null); // NEW

    assert.equal(menu.getTopLevelLabels().includes("Standard draw.io actions"), false); // CHANGE
    assert.deepEqual(menu.getTopLevelLabels().filter(label => [ // CHANGE
        "Copy / Paste", // NEW
        "Move / Arrange", // NEW
        "Edit Shape", // NEW
        "Style" // NEW
    ].includes(label)), [ // NEW
        "Copy / Paste", // NEW
        "Move / Arrange", // NEW
        "Edit Shape", // NEW
        "Style" // NEW
    ]); // CHANGE
    assert.deepEqual(menu.getSubmenuLabels("Copy / Paste"), [ // NEW
        "Cut", // NEW
        "Copy", // NEW
        "Copy As Image", // NEW
        "Copy As SVG", // NEW
        "Duplicate" // NEW
    ]); // NEW
    assert.equal(menu.getTopLevelLabels().includes("Cut"), false); // NEW
    assert.equal(menu.getTopLevelLabels().includes("To Front"), false); // NEW
    assert.equal(menu.getTopLevelLabels().includes("Edit Style"), false); // NEW
}); // NEW

test("tidy menu keeps Trellis cells under the standard actions parent", () => { // NEW
    const { contributor, document } = loadTidyContributor(); // NEW
    const menu = new TestMenu(document); // NEW
    seedStandardRows(menu); // NEW

    contributor.addItems(menu, new TestCell({ garden_bed: "1" }), null); // NEW

    assert.ok(menu.getTopLevelLabels().includes("Standard draw.io actions")); // NEW
    assert.deepEqual(menu.getSubmenuLabels("Standard draw.io actions"), [ // NEW
        "Copy / Paste", // NEW
        "Move / Arrange", // NEW
        "Edit Shape", // NEW
        "Style" // NEW
    ]); // NEW
    assert.equal(menu.getTopLevelLabels().includes("Copy / Paste"), false); // NEW
}); // NEW

test("tidy menu leaves blank canvas menus unchanged when no selection exists", () => { // NEW
    const { contributor, document } = loadTidyContributor(); // NEW
    const menu = new TestMenu(document); // NEW
    seedStandardRows(menu); // NEW

    contributor.addItems(menu, null, null); // NEW

    assert.equal(menu.getTopLevelLabels().includes("Standard draw.io actions"), false); // NEW
    assert.equal(menu.getTopLevelLabels().includes("Cut"), true); // NEW
}); // NEW

test("tidy menu still suppresses Trellis tooltips without suppressing regular cells", () => { // NEW
    const { graph } = loadTidyContributor(); // NEW

    assert.equal(graph.getTooltipForCell(new TestCell({ garden_bed: "1" })), ""); // NEW
    assert.equal(graph.getTooltipForCell(new TestCell()), "tooltip"); // NEW
}); // NEW
