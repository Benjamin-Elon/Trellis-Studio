const assert = require("node:assert/strict"); // NEW
const fs = require("node:fs"); // NEW
const path = require("node:path"); // NEW
const test = require("node:test"); // NEW
const vm = require("node:vm"); // NEW
const { JSDOM } = require("jsdom"); // NEW

const PLUGIN_PATH = path.join( // NEW
    __dirname, // NEW
    "..", // NEW
    "drawio", // NEW
    "src", // NEW
    "main", // NEW
    "webapp", // NEW
    "plugins", // NEW
    "garden_planner_plugins", // NEW
    "Bed_Succession_Navigator.js" // NEW
); // NEW

class TestCell { // NEW
    constructor(id, attrs = {}) { // NEW
        this.id = id; // NEW
        this.attrs = { ...attrs }; // NEW
        this.children = []; // NEW
    } // NEW

    getAttribute(key) { return this.attrs[key] || null; } // NEW
} // NEW

class TestModel { // NEW
    constructor(root) { this.root = root; } // NEW
    getRoot() { return this.root; } // NEW
    getParent(cell) { return cell && cell.parent ? cell.parent : null; } // NEW
    getChildCount(cell) { return cell && cell.children ? cell.children.length : 0; } // NEW
    getChildAt(cell, index) { return cell.children[index]; } // NEW
    getCell(id) { return this.findCell(this.root, id); } // NEW
    isVertex(cell) { return !!cell && cell !== this.root; } // NEW
    getGeometry() { return null; } // NEW
    setGeometry() {} // NEW
    beginUpdate() {} // NEW
    endUpdate() {} // NEW
    addListener() {} // NEW

    add(parent, child, index) { // NEW
        const oldParent = this.getParent(child); // NEW
        if (oldParent) oldParent.children = oldParent.children.filter(entry => entry !== child); // NEW
        child.parent = parent; // NEW
        parent.children.splice(Math.min(index, parent.children.length), 0, child); // NEW
    } // NEW

    findCell(cell, id) { // NEW
        if (!cell) return null; // NEW
        if (cell.id === id) return cell; // NEW
        for (const child of cell.children || []) { // NEW
            const found = this.findCell(child, id); // NEW
            if (found) return found; // NEW
        } // NEW
        return null; // NEW
    } // NEW
} // NEW

function appendChild(parent, child) { // NEW
    child.parent = parent; // NEW
    parent.children.push(child); // NEW
    return child; // NEW
} // NEW

function makeHarness(options = {}) { // NEW
    const dom = new JSDOM("<!doctype html><body><div id='graph'></div><div id='overlay'></div></body>"); // NEW
    const document = dom.window.document; // NEW
    const root = new TestCell("root"); // NEW
    const layer = appendChild(root, new TestCell("layer")); // NEW
    const bed = appendChild(layer, new TestCell("bed", { garden_bed: "1" })); // NEW
    const extraBeds = []; // NEW
    if (options.secondBed) extraBeds.push(appendChild(layer, new TestCell("bed2", { garden_bed: "1" }))); // NEW
    const tiler1 = appendChild(layer, new TestCell("tiler1", { tiler_group: "1" })); // NEW
    const extraCells = []; // NEW

    if (options.secondTiler) { // NEW
        extraCells.push(appendChild(layer, new TestCell("tiler2", { tiler_group: "1" }))); // NEW
    } // NEW

    const model = new TestModel(root); // NEW
    let selectedCells = [tiler1]; // NEW
    const selectionChangeListeners = []; // NEW
    const selectionModel = { // NEW
        addListener(event, listener) { if (event === "change") selectionChangeListeners.push(listener); } // NEW
    }; // NEW
    function fireSelectionChange() { selectionChangeListeners.forEach(listener => listener()); } // NEW
    const states = new Map([ // NEW
        [bed, { x: 0, y: 0, width: 100, height: 100 }], // NEW
        [tiler1, options.tilerOutsideBed ? { x: 130, y: 20, width: 20, height: 20 } : { x: 10, y: 10, width: 20, height: 20 }] // NEW
    ]); // NEW

    if (extraBeds[0]) states.set(extraBeds[0], { x: 40, y: 40, width: 100, height: 100 }); // NEW
    if (extraCells[0]) states.set(extraCells[0], { x: 50, y: 50, width: 20, height: 20 }); // NEW

    const graph = { // NEW
        container: document.getElementById("graph"), // NEW
        view: { // NEW
            overlayPane: document.getElementById("overlay"), // NEW
            getState(cell) { return states.get(cell) || null; }, // NEW
            addListener() {} // NEW
        }, // NEW
        getView() { return this.view; }, // NEW
        getModel() { return model; }, // NEW
        getDefaultParent() { return layer; }, // NEW
        getSelectionCell() { return selectedCells[0] || null; }, // NEW
        getSelectionCells() { return selectedCells.slice(); }, // NEW
        setSelectionCell(cell) { selectedCells = cell ? [cell] : []; fireSelectionChange(); }, // CHANGE
        setSelectionCells(cells) { selectedCells = cells.slice(); fireSelectionChange(); }, // CHANGE
        getChildVertices(parent) { return (parent.children || []).filter(child => model.isVertex(child)); }, // NEW
        getSelectionModel() { return selectionModel; }, // CHANGE
        addListener() {}, // NEW
        refresh() {}, // NEW
        orderCells() {}, // NEW
        setCellStyles() {} // NEW
    }; // NEW

    const context = { // NEW
        window: dom.window, // NEW
        document, // NEW
        console: { debug() {}, log() {}, warn() {}, error() {} }, // NEW
        getComputedStyle: dom.window.getComputedStyle.bind(dom.window), // NEW
        setTimeout(fn) { fn(); }, // NEW
        requestAnimationFrame(fn) { return fn(); }, // NEW
        cancelAnimationFrame() {}, // NEW
        Draw: { loadPlugin(callback) { callback({ editor: { graph } }); } }, // NEW
        mxEvent: { // NEW
            ADD_CELLS: "addCells", // NEW
            CELLS_MOVED: "cellsMoved", // NEW
            CELLS_RESIZED: "cellsResized", // NEW
            CHANGE: "change", // NEW
            REDO: "redo", // NEW
            REMOVE_CELLS: "removeCells", // NEW
            REPAINT: "repaint", // NEW
            SCALE_AND_TRANSLATE: "scaleAndTranslate", // NEW
            UNDO: "undo", // NEW
            consume(evt) { if (evt && evt.preventDefault) evt.preventDefault(); } // NEW
        } // NEW
    }; // NEW

    vm.runInNewContext(fs.readFileSync(PLUGIN_PATH, "utf8"), context, { filename: PLUGIN_PATH }); // NEW
    return { document, graph, layer, bed, bed2: extraBeds[0] || null, tiler1, tiler2: extraCells[0] || null, getSelected: () => selectedCells.slice() }; // CHANGE
} // NEW

function visibleControls(document) { // NEW
    return Array.from(document.querySelectorAll("img, div")).filter(el => el.style.display !== "none"); // NEW
} // NEW

function visibleImageByAlt(document, alt) { // NEW
    return visibleControls(document).find(el => el.tagName === "IMG" && el.alt === alt); // NEW
} // NEW

function visibleImageByTitle(document, title) { // NEW
    return visibleControls(document).find(el => el.tagName === "IMG" && el.title === title); // NEW
} // NEW

function childOrder(parent) { // NEW
    return (parent.children || []).map(child => child.id); // NEW
} // NEW

test("selected singleton tiler on a garden bed shows only the bed-select control", () => { // NEW
    const { document, getSelected } = makeHarness(); // CHANGE
    const selectBeds = visibleImageByAlt(document, "Select beds"); // NEW

    assert.ok(selectBeds, "expected visible bed-select button"); // NEW
    assert.equal(visibleImageByTitle(document, "Previous"), undefined); // NEW
    assert.equal(visibleImageByTitle(document, "Next"), undefined); // NEW
    assert.equal(visibleImageByAlt(document, "Select"), undefined); // NEW

    selectBeds.dispatchEvent(new document.defaultView.MouseEvent("click", { bubbles: true, cancelable: true })); // NEW
    assert.equal(getSelected().length, 1); // CHANGE
    assert.equal(getSelected()[0].id, "bed"); // CHANGE
}); // NEW

test("selected singleton tiler outside garden beds does not show the bed-select control", () => { // NEW
    const { document } = makeHarness({ tilerOutsideBed: true }); // NEW
    assert.equal(visibleImageByAlt(document, "Select beds"), undefined); // NEW
}); // NEW

test("two selected tilers in the same garden bed keep succession controls and bed-select", () => { // NEW
    const { document } = makeHarness({ secondTiler: true }); // NEW

    assert.ok(visibleImageByAlt(document, "Select beds"), "expected visible bed-select button"); // NEW
    assert.ok(visibleImageByAlt(document, "Select"), "expected visible cluster-select button"); // NEW
    assert.ok(visibleImageByTitle(document, "Previous"), "expected visible previous button"); // NEW
    assert.ok(visibleImageByTitle(document, "Next"), "expected visible next button"); // NEW
}); // NEW

test("bed-select returns beds behind tilers after selecting a tiler", () => { // NEW
    const { document, graph, layer, bed, tiler1 } = makeHarness(); // NEW
    const selectBeds = visibleImageByAlt(document, "Select beds"); // NEW

    assert.deepEqual(childOrder(layer), ["bed", "tiler1"]); // NEW
    selectBeds.dispatchEvent(new document.defaultView.MouseEvent("click", { bubbles: true, cancelable: true })); // NEW
    assert.deepEqual(childOrder(layer), ["tiler1", "bed"]); // NEW

    graph.setSelectionCells([tiler1]); // NEW
    assert.deepEqual(childOrder(layer), ["bed", "tiler1"]); // NEW
    assert.deepEqual(Array.from(graph.getSelectionCells(), cell => cell.id), ["tiler1"]); // CHANGE
}); // NEW

test("multiple selected garden beds remain temporarily in front", () => { // NEW
    const { document, graph, layer, bed, bed2 } = makeHarness({ secondBed: true, secondTiler: true }); // NEW
    const selectBeds = visibleImageByAlt(document, "Select beds"); // NEW

    selectBeds.dispatchEvent(new document.defaultView.MouseEvent("click", { bubbles: true, cancelable: true })); // NEW
    assert.deepEqual(Array.from(graph.getSelectionCells(), cell => cell.id), ["bed", "bed2"]); // CHANGE
    assert.deepEqual(childOrder(layer), ["tiler1", "tiler2", "bed", "bed2"]); // NEW

    graph.setSelectionCells([bed, bed2]); // NEW
    assert.deepEqual(childOrder(layer), ["tiler1", "tiler2", "bed", "bed2"]); // NEW
}); // NEW

test("bed-select selects every significantly overlapping bed under the cluster", () => { // NEW
    const { document, graph } = makeHarness({ secondBed: true, secondTiler: true }); // NEW
    const selectBeds = visibleImageByAlt(document, "Select beds"); // NEW

    selectBeds.dispatchEvent(new document.defaultView.MouseEvent("click", { bubbles: true, cancelable: true })); // NEW
    assert.deepEqual(Array.from(graph.getSelectionCells(), cell => cell.id), ["bed", "bed2"]); // CHANGE
}); // NEW
