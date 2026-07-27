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
        this.geometry = null; // NEW
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
    getGeometry(cell) { return cell && cell.geometry ? cell.geometry : null; } // CHANGE
    setGeometry(cell, geometry) { if (cell) cell.geometry = geometry; } // CHANGE
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
    const tiler1 = appendChild(layer, new TestCell("tiler1", { tiler_group: "1", ...(options.tiler1Attrs || {}) })); // CHANGE
    const extraCells = []; // NEW
    const bedAssemblies = []; // NEW
    if (options.bedAssembly) bedAssemblies.push(appendChild(layer, new TestCell("bedAssembly", { irrigation_assembly: "1", irrigation_assembly_type: "bed" }))); // NEW
    if (options.secondBedAssembly) bedAssemblies.push(appendChild(layer, new TestCell("bedAssembly2", { irrigation_assembly: "1", irrigation_assembly_type: "bed" }))); // NEW
    if (options.outsideBedAssembly) bedAssemblies.push(appendChild(layer, new TestCell("outsideBedAssembly", { irrigation_assembly: "1", irrigation_assembly_type: "bed" }))); // NEW

    if (options.secondTiler) { // NEW
        extraCells.push(appendChild(layer, new TestCell("tiler2", { tiler_group: "1", ...(options.tiler2Attrs || {}) }))); // CHANGE
    } // NEW

    const model = new TestModel(root); // NEW
    let selectedCells = [tiler1]; // NEW
    const selectionChangeListeners = []; // NEW
    const selectionModel = { // NEW
        addListener(event, listener) { if (event === "change") selectionChangeListeners.push(listener); } // NEW
    }; // NEW
    function fireSelectionChange() { selectionChangeListeners.forEach(listener => listener()); } // NEW
    function makeGeometry(state) { // NEW
        return { // NEW
            x: state.x, // NEW
            y: state.y, // NEW
            width: state.width, // NEW
            height: state.height, // NEW
            clone() { return makeGeometry(this); } // NEW
        }; // NEW
    } // NEW
    const states = new Map([ // NEW
        [bed, options.bedState || { x: 0, y: 0, width: 100, height: 100 }], // CHANGE
        [tiler1, options.tiler1State || (options.tilerOutsideBed ? { x: 130, y: 20, width: 20, height: 20 } : { x: 10, y: 10, width: 20, height: 20 })] // CHANGE
    ]); // NEW

    if (extraBeds[0]) states.set(extraBeds[0], options.bed2State || { x: 40, y: 40, width: 100, height: 100 }); // CHANGE
    if (extraCells[0]) states.set(extraCells[0], options.tiler2State || { x: 50, y: 50, width: 20, height: 20 }); // CHANGE
    if (bedAssemblies[0]) states.set(bedAssemblies[0], options.bedAssemblyState || { x: 20, y: 20, width: 30, height: 20 }); // NEW
    if (bedAssemblies[1]) states.set(bedAssemblies[1], options.bedAssembly2State || { x: 60, y: 20, width: 24, height: 20 }); // NEW
    if (bedAssemblies[2]) states.set(bedAssemblies[2], options.outsideBedAssemblyState || { x: 140, y: 20, width: 24, height: 20 }); // NEW
    states.forEach((state, cell) => { cell.geometry = makeGeometry(state); }); // NEW

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
        getCellStyle() { return { rotation: 0 }; }, // NEW
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
        }, // CHANGE
        mxConstants: { STYLE_ROTATION: "rotation" } // NEW
    }; // NEW

    vm.runInNewContext(fs.readFileSync(PLUGIN_PATH, "utf8"), context, { filename: PLUGIN_PATH }); // NEW
    return { document, graph, layer, bed, bed2: extraBeds[0] || null, tiler1, tiler2: extraCells[0] || null, bedAssembly: bedAssemblies[0] || null, bedAssembly2: bedAssemblies[1] || null, outsideBedAssembly: bedAssemblies[2] || null, getSelected: () => selectedCells.slice() }; // CHANGE
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

test("navigator source no longer contains day-count overlap badge machinery", () => { // NEW
    const source = fs.readFileSync(PLUGIN_PATH, "utf8"); // NEW
    assert.doesNotMatch(source, /badgePrev|badgeNext|styleOverlapBadge|updateOverlapValuesFor|positionOverlapBadgesFor/); // NEW
    assert.doesNotMatch(source, /OVERLAP_BADGE|inclusiveOverlapDays/); // NEW
}); // NEW

test("selection visual refresh event refreshes selected planting overlays", () => { // NEW
    const source = fs.readFileSync(PLUGIN_PATH, "utf8"); // NEW
    assert.match(source, /const TRELLIS_SELECTION_VISUALS_REFRESH_EVENT = 'trellisSelectionVisualsRefresh';/); // NEW
    assert.match(source, /graph\.addListener\(TRELLIS_SELECTION_VISUALS_REFRESH_EVENT,\s*function \(\) \{ rafDebounce\(refreshAllForSelectionOrAnchor\); \}\);/); // NEW
}); // NEW

test("selected singleton tiler on a garden bed shows only the bed-select control", () => { // NEW
    const { document, getSelected } = makeHarness(); // CHANGE
    const selectBeds = visibleImageByAlt(document, "Select bed"); // CHANGE

    assert.ok(selectBeds, "expected visible bed-select button"); // NEW
    assert.equal(selectBeds.style.left, "0px"); // CHANGE
    assert.equal(visibleImageByTitle(document, "Previous"), undefined); // NEW
    assert.equal(visibleImageByTitle(document, "Next"), undefined); // NEW
    assert.equal(visibleImageByAlt(document, "Select"), undefined); // NEW

    selectBeds.dispatchEvent(new document.defaultView.MouseEvent("click", { bubbles: true, cancelable: true })); // NEW
    assert.equal(getSelected().length, 1); // CHANGE
    assert.equal(getSelected()[0].id, "bed"); // CHANGE
}); // NEW

test("occupied bed move unit resolves bed plus contained planting groups", () => { // NEW
    const { graph, bed, bed2, tiler1 } = makeHarness({ secondBed: true }); // NEW
    const api = graph.__trellisBedSuccessionNavigator; // NEW
    const unitFromGroup = api.resolveOccupiedBedMoveUnit(tiler1); // NEW
    const unitFromBed = api.resolveOccupiedBedMoveUnit(bed); // NEW
    assert.deepEqual(JSON.parse(JSON.stringify(unitFromGroup.cells.map(cell => cell.id))), ["bed", "tiler1"]); // CHANGE
    assert.deepEqual(JSON.parse(JSON.stringify(unitFromBed.cells.map(cell => cell.id))), ["bed", "tiler1"]); // CHANGE
    assert.equal(api.resolveOccupiedBedMoveUnit(bed2), null); // NEW
}); // NEW

test("occupied bed move unit includes centered bed irrigation assemblies", () => { // NEW
    const { graph, bed, tiler1, bedAssembly, bedAssembly2, outsideBedAssembly } = makeHarness({ bedAssembly: true, secondBedAssembly: true, outsideBedAssembly: true }); // NEW
    const api = graph.__trellisBedSuccessionNavigator; // NEW
    const expected = ["bed", "bedAssembly", "bedAssembly2", "tiler1"]; // NEW
    const unitFromBed = api.resolveOccupiedBedMoveUnit(bed); // NEW
    const unitFromGroup = api.resolveOccupiedBedMoveUnit(tiler1); // NEW
    const unitFromAssembly = api.resolveOccupiedBedMoveUnit(bedAssembly); // NEW
    assert.deepEqual(JSON.parse(JSON.stringify(unitFromBed.cells.map(cell => cell.id))), expected); // CHANGE
    assert.deepEqual(JSON.parse(JSON.stringify(unitFromGroup.cells.map(cell => cell.id))), expected); // CHANGE
    assert.deepEqual(JSON.parse(JSON.stringify(unitFromAssembly.cells.map(cell => cell.id))), expected); // CHANGE
    assert.deepEqual(JSON.parse(JSON.stringify(unitFromBed.bedAssemblies.map(cell => cell.id))), ["bedAssembly", "bedAssembly2"]); // CHANGE
    assert.deepEqual(JSON.parse(JSON.stringify(unitFromBed.plantingGroups.map(cell => cell.id))), ["tiler1"]); // CHANGE
    assert.equal(api.resolveOccupiedBedMoveUnit(outsideBedAssembly), null); // NEW
}); // NEW

test("bed unit selectors select bed, plantings, and irrigation assemblies", () => { // NEW
    const { document, graph, bed, tiler1, tiler2, bedAssembly, bedAssembly2, getSelected } = makeHarness({ secondTiler: true, bedAssembly: true, secondBedAssembly: true }); // NEW
    graph.setSelectionCell(tiler1); // NEW

    const selectBed = visibleImageByAlt(document, "Select bed"); // CHANGE
    const selectPlantings = visibleImageByAlt(document, "Select plantings"); // NEW
    const selectAssembly = visibleImageByAlt(document, "Select irrigation assembly"); // NEW
    assert.ok(selectBed, "expected bed selector"); // NEW
    assert.ok(selectPlantings, "expected plantings selector"); // NEW
    assert.ok(selectAssembly, "expected irrigation assembly selector"); // NEW
    assert.notEqual(selectAssembly.src, selectPlantings.src); // NEW

    selectPlantings.dispatchEvent(new document.defaultView.MouseEvent("click", { bubbles: true, cancelable: true })); // NEW
    assert.deepEqual(JSON.parse(JSON.stringify(getSelected().map(cell => cell.id))), ["tiler1", "tiler2"]); // CHANGE

    graph.setSelectionCell(tiler1); // NEW
    visibleImageByAlt(document, "Select irrigation assembly").dispatchEvent(new document.defaultView.MouseEvent("click", { bubbles: true, cancelable: true })); // NEW
    assert.deepEqual(JSON.parse(JSON.stringify(getSelected().map(cell => cell.id))), ["bedAssembly", "bedAssembly2"]); // CHANGE

    graph.setSelectionCell(bedAssembly); // NEW
    visibleImageByAlt(document, "Select bed").dispatchEvent(new document.defaultView.MouseEvent("click", { bubbles: true, cancelable: true })); // NEW
    assert.deepEqual(JSON.parse(JSON.stringify(getSelected().map(cell => cell.id))), ["bed"]); // CHANGE

    const singleton = makeHarness({ bedAssembly: true }); // NEW
    singleton.graph.setSelectionCell(singleton.bedAssembly); // NEW
    assert.equal(visibleImageByAlt(singleton.document, "Select irrigation assembly"), undefined); // NEW
}); // NEW

test("bed unit selectors update click targets after switching beds", () => { // NEW
    const { document, graph, bed2, tiler1, tiler2, bedAssembly2, getSelected } = makeHarness({ // NEW
        secondBed: true, // NEW
        secondTiler: true, // NEW
        bedAssembly: true, // NEW
        secondBedAssembly: true, // NEW
        bed2State: { x: 200, y: 0, width: 90, height: 90 }, // NEW
        tiler2State: { x: 210, y: 10, width: 20, height: 20 }, // NEW
        bedAssemblyState: { x: 130, y: 20, width: 24, height: 20 }, // NEW
        bedAssembly2State: { x: 230, y: 20, width: 24, height: 20 } // NEW
    }); // NEW
    graph.setSelectionCell(tiler1); // NEW
    assert.equal(visibleImageByAlt(document, "Select irrigation assembly"), undefined); // NEW

    graph.setSelectionCell(tiler2); // NEW
    visibleImageByAlt(document, "Select bed").dispatchEvent(new document.defaultView.MouseEvent("click", { bubbles: true, cancelable: true })); // NEW
    assert.deepEqual(JSON.parse(JSON.stringify(getSelected().map(cell => cell.id))), ["bed2"]); // NEW

    graph.setSelectionCell(tiler2); // NEW
    visibleImageByAlt(document, "Select irrigation assembly").dispatchEvent(new document.defaultView.MouseEvent("click", { bubbles: true, cancelable: true })); // NEW
    assert.deepEqual(JSON.parse(JSON.stringify(getSelected().map(cell => cell.id))), ["bedAssembly2"]); // NEW
    assert.equal(getSelected()[0], bedAssembly2); // NEW
    assert.equal(bed2.getAttribute("garden_bed"), "1"); // NEW
}); // NEW

test("selected singleton tiler outside garden beds does not show the bed-select control", () => { // NEW
    const { document } = makeHarness({ tilerOutsideBed: true }); // NEW
    assert.equal(visibleImageByAlt(document, "Select bed"), undefined); // CHANGE
}); // NEW

test("two selected tilers in the same garden bed do not cluster unless they overlap", () => { // CHANGE
    const { document } = makeHarness({ secondTiler: true }); // NEW

    assert.ok(visibleImageByAlt(document, "Select bed"), "expected visible bed-select button"); // CHANGE
    assert.equal(visibleImageByAlt(document, "Select"), undefined); // CHANGE
    assert.equal(visibleImageByTitle(document, "Previous"), undefined); // CHANGE
    assert.equal(visibleImageByTitle(document, "Next"), undefined); // CHANGE
}); // NEW

test("two selected tilers with five-percent overlap hide duplicate cluster select", () => { // CHANGE
    const { document } = makeHarness({ secondTiler: true, tiler2State: { x: 29, y: 10, width: 20, height: 20 } }); // CHANGE

    const selectBeds = visibleImageByAlt(document, "Select bed"); // NEW
    const selectCluster = visibleImageByAlt(document, "Select"); // NEW
    const selectPlantings = visibleImageByAlt(document, "Select plantings"); // NEW
    assert.ok(selectBeds, "expected visible bed-select button"); // CHANGE
    assert.ok(selectPlantings, "expected visible plantings selector"); // NEW
    assert.equal(selectCluster, undefined); // CHANGE
    assert.equal(selectBeds.style.left, "0px"); // CHANGE
    assert.equal(selectPlantings.style.left, "26px"); // CHANGE
    assert.equal(selectBeds.style.top, "-28px"); // CHANGE
    assert.equal(selectPlantings.style.top, "-28px"); // CHANGE
    assert.ok(visibleImageByTitle(document, "Previous"), "expected visible previous button"); // NEW
    assert.ok(visibleImageByTitle(document, "Next"), "expected visible next button"); // NEW
}); // NEW

test("same-bed tilers touching edges do not cluster", () => { // NEW
    const { document } = makeHarness({ secondTiler: true, tiler2State: { x: 30, y: 10, width: 20, height: 20 } }); // NEW

    assert.ok(visibleImageByAlt(document, "Select bed"), "expected visible bed-select button"); // NEW
    assert.equal(visibleImageByAlt(document, "Select"), undefined); // NEW
    assert.equal(visibleImageByTitle(document, "Previous"), undefined); // NEW
    assert.equal(visibleImageByTitle(document, "Next"), undefined); // NEW
}); // NEW

test("same-bed tilers below five-percent overlap do not cluster", () => { // CHANGE
    const { document } = makeHarness({ secondTiler: true, tiler2State: { x: 29.25, y: 10, width: 20, height: 20 } }); // CHANGE

    assert.ok(visibleImageByAlt(document, "Select bed"), "expected visible bed-select button"); // NEW
    assert.equal(visibleImageByAlt(document, "Select"), undefined); // NEW
    assert.equal(visibleImageByTitle(document, "Previous"), undefined); // NEW
    assert.equal(visibleImageByTitle(document, "Next"), undefined); // NEW
}); // NEW

test("selected cluster occupancy API returns schedule-ordered windows", () => { // NEW
    const { graph, tiler1 } = makeHarness({ // NEW
        secondTiler: true, // NEW
        tiler2State: { x: 29, y: 10, width: 20, height: 20 }, // CHANGE
        tiler1Attrs: { plant_name: "Tomato", sow_date: "2026-03-01", transplant_date: "2026-05-01", harvest_end: "2026-09-15" }, // NEW
        tiler2Attrs: { plant_name: "Lettuce", sow_date: "2026-02-10", harvest_end: "2026-04-10" } // NEW
    }); // NEW
    const api = graph.__trellisBedSuccessionNavigator; // NEW
    const result = api.getSelectedClusterOccupancy(tiler1); // NEW

    assert.equal(result.selectedId, "tiler1"); // NEW
    assert.deepEqual(JSON.parse(JSON.stringify(result.items.map(item => item.cellId))), ["tiler2", "tiler1"]); // CHANGE
    assert.deepEqual(JSON.parse(JSON.stringify(result.items.map(item => [item.label, item.startISO, item.endISO]))), [ // CHANGE
        ["Lettuce", "2026-02-10", "2026-04-10"], // NEW
        ["Tomato", "2026-05-01", "2026-09-15"] // NEW
    ]); // NEW
}); // NEW

test("selected cluster occupancy uses perennial lifespan dates", () => { // ADDED
    const { graph, tiler1 } = makeHarness({ // ADDED
        tiler1Attrs: { plant_name: "Asparagus", perennial: "1", lifespan_start: "2026-02-01", lifespan_end: "2028-12-31", sow_date: "2026-04-01", harvest_end: "2026-08-01" } // ADDED
    }); // ADDED
    const result = graph.__trellisBedSuccessionNavigator.getSelectedClusterOccupancy(tiler1); // ADDED
    assert.deepEqual(JSON.parse(JSON.stringify(result.items.map(item => [item.startISO, item.endISO]))), [["2026-02-01", "2028-12-31"]]); // ADDED
}); // ADDED

test("selected cluster occupancy exposes derived relationship snapshots from either side", () => { // ADDED
    const { graph, tiler1, tiler2 } = makeHarness({ // ADDED
        secondTiler: true, // ADDED
        tiler2State: { x: 29, y: 10, width: 20, height: 20 }, // ADDED
        tiler1Attrs: { plant_name: "Tomato", sow_date: "2026-04-01", harvest_end: "2026-08-01" }, // ADDED
        tiler2Attrs: { plant_name: "Basil", sow_date: "2026-04-08", harvest_end: "2026-06-01", derived_mode: "companion", derived_source_group_id: "tiler1", companion_relation_id: "12", companion_rating: "1", companion_type: "interplant", companion_start_offset_days: "7", companion_recommended_start_offset_days: "3" } // ADDED
    }); // ADDED
    const fromSource = graph.__trellisBedSuccessionNavigator.getSelectedClusterOccupancy(tiler1); // ADDED
    assert.equal(fromSource.items.find(item => item.cellId === "tiler2").relationship.startOffsetDays, "7"); // ADDED
    const fromDerived = graph.__trellisBedSuccessionNavigator.getSelectedClusterOccupancy(tiler2); // ADDED
    assert.equal(fromDerived.items.find(item => item.cellId === "tiler1").relationship.recommendedStartOffsetDays, "3"); // ADDED
}); // ADDED

test("bed-select returns beds behind tilers after selecting a tiler", () => { // NEW
    const { document, graph, layer, bed, tiler1 } = makeHarness(); // NEW
    const selectBeds = visibleImageByAlt(document, "Select bed"); // CHANGE

    assert.deepEqual(childOrder(layer), ["bed", "tiler1"]); // NEW
    selectBeds.dispatchEvent(new document.defaultView.MouseEvent("click", { bubbles: true, cancelable: true })); // NEW
    assert.deepEqual(childOrder(layer), ["tiler1", "bed"]); // NEW

    graph.setSelectionCells([tiler1]); // NEW
    assert.deepEqual(childOrder(layer), ["bed", "tiler1"]); // NEW
    assert.deepEqual(Array.from(graph.getSelectionCells(), cell => cell.id), ["tiler1"]); // CHANGE
}); // NEW

test("selected containing garden bed remains temporarily in front", () => { // CHANGE
    const { document, graph, layer, bed } = makeHarness({ secondBed: true, secondTiler: true }); // CHANGE
    const selectBeds = visibleImageByAlt(document, "Select bed"); // CHANGE

    selectBeds.dispatchEvent(new document.defaultView.MouseEvent("click", { bubbles: true, cancelable: true })); // NEW
    assert.deepEqual(Array.from(graph.getSelectionCells(), cell => cell.id), ["bed"]); // CHANGE
    assert.deepEqual(childOrder(layer), ["bed2", "tiler1", "tiler2", "bed"]); // CHANGE

    graph.setSelectionCells([bed]); // CHANGE
    assert.deepEqual(childOrder(layer), ["bed2", "tiler1", "tiler2", "bed"]); // CHANGE
}); // NEW

test("bed-select selects the containing bed when another bed overlaps the cluster", () => { // CHANGE
    const { document, graph } = makeHarness({ secondBed: true, secondTiler: true }); // NEW
    const selectBeds = visibleImageByAlt(document, "Select bed"); // CHANGE

    selectBeds.dispatchEvent(new document.defaultView.MouseEvent("click", { bubbles: true, cancelable: true })); // NEW
    assert.deepEqual(Array.from(graph.getSelectionCells(), cell => cell.id), ["bed"]); // CHANGE
}); // NEW
