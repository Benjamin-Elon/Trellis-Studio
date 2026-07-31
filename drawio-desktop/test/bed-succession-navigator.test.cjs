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
    "Bed_Succession_Navigator.js"
);

class TestCell {
    constructor(id, attrs = {}) {
        this.id = id;
        this.attrs = { ...attrs };
        this.children = [];
        this.geometry = null;
    }

    getAttribute(key) { return this.attrs[key] || null; }
}

class TestModel {
    constructor(root) { this.root = root; }
    getRoot() { return this.root; }
    getParent(cell) { return cell && cell.parent ? cell.parent : null; }
    getChildCount(cell) { return cell && cell.children ? cell.children.length : 0; }
    getChildAt(cell, index) { return cell.children[index]; }
    getCell(id) { return this.findCell(this.root, id); }
    isVertex(cell) { return !!cell && cell !== this.root; }
    getGeometry(cell) { return cell && cell.geometry ? cell.geometry : null; }
    setGeometry(cell, geometry) { if (cell) cell.geometry = geometry; }
    beginUpdate() {}
    endUpdate() {}
    addListener() {}

    add(parent, child, index) {
        const oldParent = this.getParent(child);
        if (oldParent) oldParent.children = oldParent.children.filter(entry => entry !== child);
        child.parent = parent;
        parent.children.splice(Math.min(index, parent.children.length), 0, child);
    }

    findCell(cell, id) {
        if (!cell) return null;
        if (cell.id === id) return cell;
        for (const child of cell.children || []) {
            const found = this.findCell(child, id);
            if (found) return found;
        }
        return null;
    }
}

function appendChild(parent, child) {
    child.parent = parent;
    parent.children.push(child);
    return child;
}

function makeHarness(options = {}) {
    const dom = new JSDOM("<!doctype html><body><div id='graph'></div><div id='overlay'></div></body>");
    const document = dom.window.document;
    const root = new TestCell("root");
    const layer = appendChild(root, new TestCell("layer"));
    const bed = appendChild(layer, new TestCell("bed", { garden_bed: "1" }));
    const extraBeds = [];
    if (options.secondBed) extraBeds.push(appendChild(layer, new TestCell("bed2", { garden_bed: "1" })));
    const tiler1 = appendChild(layer, new TestCell("tiler1", { tiler_group: "1", ...(options.tiler1Attrs || {}) }));
    const extraCells = [];
    const bedAssemblies = [];
    if (options.bedAssembly) bedAssemblies.push(appendChild(layer, new TestCell("bedAssembly", { irrigation_assembly: "1", irrigation_assembly_type: "bed" })));
    if (options.secondBedAssembly) bedAssemblies.push(appendChild(layer, new TestCell("bedAssembly2", { irrigation_assembly: "1", irrigation_assembly_type: "bed" })));
    if (options.outsideBedAssembly) bedAssemblies.push(appendChild(layer, new TestCell("outsideBedAssembly", { irrigation_assembly: "1", irrigation_assembly_type: "bed" })));

    if (options.secondTiler) {
        extraCells.push(appendChild(layer, new TestCell("tiler2", { tiler_group: "1", ...(options.tiler2Attrs || {}) })));
    }

    const model = new TestModel(root);
    let selectedCells = [tiler1];
    const selectionChangeListeners = [];
    const selectionModel = {
        addListener(event, listener) { if (event === "change") selectionChangeListeners.push(listener); }
    };
    function fireSelectionChange() { selectionChangeListeners.forEach(listener => listener()); }
    function makeGeometry(state) {
        return {
            x: state.x,
            y: state.y,
            width: state.width,
            height: state.height,
            clone() { return makeGeometry(this); }
        };
    }
    const states = new Map([
        [bed, options.bedState || { x: 0, y: 0, width: 100, height: 100 }],
        [tiler1, options.tiler1State || (options.tilerOutsideBed ? { x: 130, y: 20, width: 20, height: 20 } : { x: 10, y: 10, width: 20, height: 20 })]
    ]);

    if (extraBeds[0]) states.set(extraBeds[0], options.bed2State || { x: 40, y: 40, width: 100, height: 100 });
    if (extraCells[0]) states.set(extraCells[0], options.tiler2State || { x: 50, y: 50, width: 20, height: 20 });
    if (bedAssemblies[0]) states.set(bedAssemblies[0], options.bedAssemblyState || { x: 20, y: 20, width: 30, height: 20 });
    if (bedAssemblies[1]) states.set(bedAssemblies[1], options.bedAssembly2State || { x: 60, y: 20, width: 24, height: 20 });
    if (bedAssemblies[2]) states.set(bedAssemblies[2], options.outsideBedAssemblyState || { x: 140, y: 20, width: 24, height: 20 });
    states.forEach((state, cell) => { cell.geometry = makeGeometry(state); });

    const graph = {
        container: document.getElementById("graph"),
        view: {
            overlayPane: document.getElementById("overlay"),
            getState(cell) { return states.get(cell) || null; },
            addListener() {}
        },
        getView() { return this.view; },
        getModel() { return model; },
        getDefaultParent() { return layer; },
        getSelectionCell() { return selectedCells[0] || null; },
        getSelectionCells() { return selectedCells.slice(); },
        setSelectionCell(cell) { selectedCells = cell ? [cell] : []; fireSelectionChange(); },
        setSelectionCells(cells) { selectedCells = cells.slice(); fireSelectionChange(); },
        getChildVertices(parent) { return (parent.children || []).filter(child => model.isVertex(child)); },
        getCellStyle() { return { rotation: 0 }; },
        getSelectionModel() { return selectionModel; },
        addListener() {},
        refresh() {},
        orderCells() {},
        setCellStyles() {}
    };

    const context = {
        window: dom.window,
        document,
        console: { debug() {}, log() {}, warn() {}, error() {} },
        getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
        setTimeout(fn) { fn(); },
        requestAnimationFrame(fn) { return fn(); },
        cancelAnimationFrame() {},
        Draw: { loadPlugin(callback) { callback({ editor: { graph } }); } },
        mxEvent: {
            ADD_CELLS: "addCells",
            CELLS_MOVED: "cellsMoved",
            CELLS_RESIZED: "cellsResized",
            CHANGE: "change",
            REDO: "redo",
            REMOVE_CELLS: "removeCells",
            REPAINT: "repaint",
            SCALE_AND_TRANSLATE: "scaleAndTranslate",
            UNDO: "undo",
            consume(evt) { if (evt && evt.preventDefault) evt.preventDefault(); }
        },
        mxConstants: { STYLE_ROTATION: "rotation" }
    };

    vm.runInNewContext(fs.readFileSync(PLUGIN_PATH, "utf8"), context, { filename: PLUGIN_PATH });
    return { document, graph, layer, bed, bed2: extraBeds[0] || null, tiler1, tiler2: extraCells[0] || null, bedAssembly: bedAssemblies[0] || null, bedAssembly2: bedAssemblies[1] || null, outsideBedAssembly: bedAssemblies[2] || null, getSelected: () => selectedCells.slice() };
}

function visibleControls(document) {
    return Array.from(document.querySelectorAll("img, div")).filter(el => el.style.display !== "none");
}

function visibleImageByAlt(document, alt) {
    return visibleControls(document).find(el => el.tagName === "IMG" && el.alt === alt);
}

function visibleImageByTitle(document, title) {
    return visibleControls(document).find(el => el.tagName === "IMG" && el.title === title);
}

function childOrder(parent) {
    return (parent.children || []).map(child => child.id);
}

test("navigator source no longer contains day-count overlap badge machinery", () => {
    const source = fs.readFileSync(PLUGIN_PATH, "utf8");
    assert.doesNotMatch(source, /badgePrev|badgeNext|styleOverlapBadge|updateOverlapValuesFor|positionOverlapBadgesFor/);
    assert.doesNotMatch(source, /OVERLAP_BADGE|inclusiveOverlapDays/);
});

test("selection visual refresh event refreshes selected planting overlays", () => {
    const source = fs.readFileSync(PLUGIN_PATH, "utf8");
    assert.match(source, /const TRELLIS_SELECTION_VISUALS_REFRESH_EVENT = 'trellisSelectionVisualsRefresh';/);
    assert.match(source, /graph\.addListener\(TRELLIS_SELECTION_VISUALS_REFRESH_EVENT,\s*function \(\) \{ rafDebounce\(refreshAllForSelectionOrAnchor\); \}\);/);
});

test("selected singleton tiler on a garden bed shows only the bed-select control", () => {
    const { document, getSelected } = makeHarness();
    const selectBeds = visibleImageByAlt(document, "Select bed");

    assert.ok(selectBeds, "expected visible bed-select button");
    assert.equal(selectBeds.style.left, "0px");
    assert.equal(visibleImageByTitle(document, "Previous"), undefined);
    assert.equal(visibleImageByTitle(document, "Next"), undefined);
    assert.equal(visibleImageByAlt(document, "Select"), undefined);

    selectBeds.dispatchEvent(new document.defaultView.MouseEvent("click", { bubbles: true, cancelable: true }));
    assert.equal(getSelected().length, 1);
    assert.equal(getSelected()[0].id, "bed");
});

test("occupied bed move unit resolves bed plus contained planting groups", () => {
    const { graph, bed, bed2, tiler1 } = makeHarness({ secondBed: true });
    const api = graph.__trellisBedSuccessionNavigator;
    const unitFromGroup = api.resolveOccupiedBedMoveUnit(tiler1);
    const unitFromBed = api.resolveOccupiedBedMoveUnit(bed);
    assert.deepEqual(JSON.parse(JSON.stringify(unitFromGroup.cells.map(cell => cell.id))), ["bed", "tiler1"]);
    assert.deepEqual(JSON.parse(JSON.stringify(unitFromBed.cells.map(cell => cell.id))), ["bed", "tiler1"]);
    assert.equal(api.resolveOccupiedBedMoveUnit(bed2), null);
});

test("occupied bed move unit includes centered bed irrigation assemblies", () => {
    const { graph, bed, tiler1, bedAssembly, bedAssembly2, outsideBedAssembly } = makeHarness({ bedAssembly: true, secondBedAssembly: true, outsideBedAssembly: true });
    const api = graph.__trellisBedSuccessionNavigator;
    const expected = ["bed", "bedAssembly", "bedAssembly2", "tiler1"];
    const unitFromBed = api.resolveOccupiedBedMoveUnit(bed);
    const unitFromGroup = api.resolveOccupiedBedMoveUnit(tiler1);
    const unitFromAssembly = api.resolveOccupiedBedMoveUnit(bedAssembly);
    assert.deepEqual(JSON.parse(JSON.stringify(unitFromBed.cells.map(cell => cell.id))), expected);
    assert.deepEqual(JSON.parse(JSON.stringify(unitFromGroup.cells.map(cell => cell.id))), expected);
    assert.deepEqual(JSON.parse(JSON.stringify(unitFromAssembly.cells.map(cell => cell.id))), expected);
    assert.deepEqual(JSON.parse(JSON.stringify(unitFromBed.bedAssemblies.map(cell => cell.id))), ["bedAssembly", "bedAssembly2"]);
    assert.deepEqual(JSON.parse(JSON.stringify(unitFromBed.plantingGroups.map(cell => cell.id))), ["tiler1"]);
    assert.equal(api.resolveOccupiedBedMoveUnit(outsideBedAssembly), null);
});

test("bed unit selectors select bed, plantings, and irrigation assemblies", () => {
    const { document, graph, bed, tiler1, tiler2, bedAssembly, bedAssembly2, getSelected } = makeHarness({ secondTiler: true, bedAssembly: true, secondBedAssembly: true });
    graph.setSelectionCell(tiler1);

    const selectBed = visibleImageByAlt(document, "Select bed");
    const selectPlantings = visibleImageByAlt(document, "Select plantings");
    const selectAssembly = visibleImageByAlt(document, "Select irrigation assembly");
    assert.ok(selectBed, "expected bed selector");
    assert.ok(selectPlantings, "expected plantings selector");
    assert.ok(selectAssembly, "expected irrigation assembly selector");
    assert.notEqual(selectAssembly.src, selectPlantings.src);

    selectPlantings.dispatchEvent(new document.defaultView.MouseEvent("click", { bubbles: true, cancelable: true }));
    assert.deepEqual(JSON.parse(JSON.stringify(getSelected().map(cell => cell.id))), ["tiler1", "tiler2"]);

    graph.setSelectionCell(tiler1);
    visibleImageByAlt(document, "Select irrigation assembly").dispatchEvent(new document.defaultView.MouseEvent("click", { bubbles: true, cancelable: true }));
    assert.deepEqual(JSON.parse(JSON.stringify(getSelected().map(cell => cell.id))), ["bedAssembly", "bedAssembly2"]);

    graph.setSelectionCell(bedAssembly);
    visibleImageByAlt(document, "Select bed").dispatchEvent(new document.defaultView.MouseEvent("click", { bubbles: true, cancelable: true }));
    assert.deepEqual(JSON.parse(JSON.stringify(getSelected().map(cell => cell.id))), ["bed"]);

    const singleton = makeHarness({ bedAssembly: true });
    singleton.graph.setSelectionCell(singleton.bedAssembly);
    assert.equal(visibleImageByAlt(singleton.document, "Select irrigation assembly"), undefined);
});

test("bed unit selectors update click targets after switching beds", () => {
    const { document, graph, bed2, tiler1, tiler2, bedAssembly2, getSelected } = makeHarness({
        secondBed: true,
        secondTiler: true,
        bedAssembly: true,
        secondBedAssembly: true,
        bed2State: { x: 200, y: 0, width: 90, height: 90 },
        tiler2State: { x: 210, y: 10, width: 20, height: 20 },
        bedAssemblyState: { x: 130, y: 20, width: 24, height: 20 },
        bedAssembly2State: { x: 230, y: 20, width: 24, height: 20 }
    });
    graph.setSelectionCell(tiler1);
    assert.equal(visibleImageByAlt(document, "Select irrigation assembly"), undefined);

    graph.setSelectionCell(tiler2);
    visibleImageByAlt(document, "Select bed").dispatchEvent(new document.defaultView.MouseEvent("click", { bubbles: true, cancelable: true }));
    assert.deepEqual(JSON.parse(JSON.stringify(getSelected().map(cell => cell.id))), ["bed2"]);

    graph.setSelectionCell(tiler2);
    visibleImageByAlt(document, "Select irrigation assembly").dispatchEvent(new document.defaultView.MouseEvent("click", { bubbles: true, cancelable: true }));
    assert.deepEqual(JSON.parse(JSON.stringify(getSelected().map(cell => cell.id))), ["bedAssembly2"]);
    assert.equal(getSelected()[0], bedAssembly2);
    assert.equal(bed2.getAttribute("garden_bed"), "1");
});

test("selected singleton tiler outside garden beds does not show the bed-select control", () => {
    const { document } = makeHarness({ tilerOutsideBed: true });
    assert.equal(visibleImageByAlt(document, "Select bed"), undefined);
});

test("two selected tilers in the same garden bed do not cluster unless they overlap", () => {
    const { document } = makeHarness({ secondTiler: true });

    assert.ok(visibleImageByAlt(document, "Select bed"), "expected visible bed-select button");
    assert.equal(visibleImageByAlt(document, "Select"), undefined);
    assert.equal(visibleImageByTitle(document, "Previous"), undefined);
    assert.equal(visibleImageByTitle(document, "Next"), undefined);
});

test("two selected tilers with five-percent overlap hide duplicate cluster select", () => {
    const { document } = makeHarness({ secondTiler: true, tiler2State: { x: 29, y: 10, width: 20, height: 20 } });

    const selectBeds = visibleImageByAlt(document, "Select bed");
    const selectCluster = visibleImageByAlt(document, "Select");
    const selectPlantings = visibleImageByAlt(document, "Select plantings");
    assert.ok(selectBeds, "expected visible bed-select button");
    assert.ok(selectPlantings, "expected visible plantings selector");
    assert.equal(selectCluster, undefined);
    assert.equal(selectBeds.style.left, "0px");
    assert.equal(selectPlantings.style.left, "26px");
    assert.equal(selectBeds.style.top, "-28px");
    assert.equal(selectPlantings.style.top, "-28px");
    assert.ok(visibleImageByTitle(document, "Previous"), "expected visible previous button");
    assert.ok(visibleImageByTitle(document, "Next"), "expected visible next button");
});

test("same-bed tilers touching edges do not cluster", () => {
    const { document } = makeHarness({ secondTiler: true, tiler2State: { x: 30, y: 10, width: 20, height: 20 } });

    assert.ok(visibleImageByAlt(document, "Select bed"), "expected visible bed-select button");
    assert.equal(visibleImageByAlt(document, "Select"), undefined);
    assert.equal(visibleImageByTitle(document, "Previous"), undefined);
    assert.equal(visibleImageByTitle(document, "Next"), undefined);
});

test("same-bed tilers below five-percent overlap do not cluster", () => {
    const { document } = makeHarness({ secondTiler: true, tiler2State: { x: 29.25, y: 10, width: 20, height: 20 } });

    assert.ok(visibleImageByAlt(document, "Select bed"), "expected visible bed-select button");
    assert.equal(visibleImageByAlt(document, "Select"), undefined);
    assert.equal(visibleImageByTitle(document, "Previous"), undefined);
    assert.equal(visibleImageByTitle(document, "Next"), undefined);
});

test("selected cluster occupancy API returns schedule-ordered windows", () => {
    const { graph, tiler1 } = makeHarness({
        secondTiler: true,
        tiler2State: { x: 29, y: 10, width: 20, height: 20 },
        tiler1Attrs: { plant_name: "Tomato", sow_date: "2026-03-01", transplant_date: "2026-05-01", harvest_end: "2026-09-15" },
        tiler2Attrs: { plant_name: "Lettuce", sow_date: "2026-02-10", harvest_end: "2026-04-10" }
    });
    const api = graph.__trellisBedSuccessionNavigator;
    const result = api.getSelectedClusterOccupancy(tiler1);

    assert.equal(result.selectedId, "tiler1");
    assert.deepEqual(JSON.parse(JSON.stringify(result.items.map(item => item.cellId))), ["tiler2", "tiler1"]);
    assert.deepEqual(JSON.parse(JSON.stringify(result.items.map(item => [item.label, item.startISO, item.endISO]))), [
        ["Lettuce", "2026-02-10", "2026-04-10"],
        ["Tomato", "2026-05-01", "2026-09-15"]
    ]);
});

test("selected cluster occupancy uses perennial lifespan dates", () => {
    const { graph, tiler1 } = makeHarness({
        tiler1Attrs: { plant_name: "Asparagus", perennial: "1", lifespan_start: "2026-02-01", lifespan_end: "2028-12-31", sow_date: "2026-04-01", harvest_end: "2026-08-01" }
    });
    const result = graph.__trellisBedSuccessionNavigator.getSelectedClusterOccupancy(tiler1);
    assert.deepEqual(JSON.parse(JSON.stringify(result.items.map(item => [item.startISO, item.endISO]))), [["2026-02-01", "2028-12-31"]]);
});

test("selected cluster occupancy exposes derived relationship snapshots from either side", () => {
    const { graph, tiler1, tiler2 } = makeHarness({
        secondTiler: true,
        tiler2State: { x: 29, y: 10, width: 20, height: 20 },
        tiler1Attrs: { plant_name: "Tomato", sow_date: "2026-04-01", harvest_end: "2026-08-01" },
        tiler2Attrs: { plant_name: "Basil", sow_date: "2026-04-08", harvest_end: "2026-06-01", derived_mode: "companion", derived_source_group_id: "tiler1", companion_relation_id: "12", companion_rating: "1", companion_type: "interplant", companion_start_offset_days: "7", companion_recommended_start_offset_days: "3" }
    });
    const fromSource = graph.__trellisBedSuccessionNavigator.getSelectedClusterOccupancy(tiler1);
    assert.equal(fromSource.items.find(item => item.cellId === "tiler2").relationship.startOffsetDays, "7");
    const fromDerived = graph.__trellisBedSuccessionNavigator.getSelectedClusterOccupancy(tiler2);
    assert.equal(fromDerived.items.find(item => item.cellId === "tiler1").relationship.recommendedStartOffsetDays, "3");
});

test("bed-select returns beds behind tilers after selecting a tiler", () => {
    const { document, graph, layer, bed, tiler1 } = makeHarness();
    const selectBeds = visibleImageByAlt(document, "Select bed");

    assert.deepEqual(childOrder(layer), ["bed", "tiler1"]);
    selectBeds.dispatchEvent(new document.defaultView.MouseEvent("click", { bubbles: true, cancelable: true }));
    assert.deepEqual(childOrder(layer), ["tiler1", "bed"]);

    graph.setSelectionCells([tiler1]);
    assert.deepEqual(childOrder(layer), ["bed", "tiler1"]);
    assert.deepEqual(Array.from(graph.getSelectionCells(), cell => cell.id), ["tiler1"]);
});

test("selected containing garden bed remains temporarily in front", () => {
    const { document, graph, layer, bed } = makeHarness({ secondBed: true, secondTiler: true });
    const selectBeds = visibleImageByAlt(document, "Select bed");

    selectBeds.dispatchEvent(new document.defaultView.MouseEvent("click", { bubbles: true, cancelable: true }));
    assert.deepEqual(Array.from(graph.getSelectionCells(), cell => cell.id), ["bed"]);
    assert.deepEqual(childOrder(layer), ["bed2", "tiler1", "tiler2", "bed"]);

    graph.setSelectionCells([bed]);
    assert.deepEqual(childOrder(layer), ["bed2", "tiler1", "tiler2", "bed"]);
});

test("bed-select selects the containing bed when another bed overlaps the cluster", () => {
    const { document, graph } = makeHarness({ secondBed: true, secondTiler: true });
    const selectBeds = visibleImageByAlt(document, "Select bed");

    selectBeds.dispatchEvent(new document.defaultView.MouseEvent("click", { bubbles: true, cancelable: true }));
    assert.deepEqual(Array.from(graph.getSelectionCells(), cell => cell.id), ["bed"]);
});
