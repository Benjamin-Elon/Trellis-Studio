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
    "Planting_Group_Parenting_Controls.js"
);

class TestCell {
    constructor(id, attrs = {}, geometry = null) {
        this.id = id;
        this.attrs = Object.assign({}, attrs);
        this.geometry = geometry;
        this.children = [];
    }

    getAttribute(key) { return this.attrs[key] || null; }
}

class TestModel {
    constructor(root) { this.root = root; this.updateDepth = 0; }
    getRoot() { return this.root; }
    getParent(cell) { return cell && cell.parent ? cell.parent : null; }
    getChildCount(cell) { return cell && cell.children ? cell.children.length : 0; }
    getChildAt(cell, index) { return cell.children[index]; }
    getGeometry(cell) { return cell && cell.geometry ? cell.geometry : null; }
    setGeometry(cell, geometry) { if (cell) cell.geometry = geometry; }
    beginUpdate() { this.updateDepth += 1; }
    endUpdate() { this.updateDepth -= 1; }
    add(parent, child, index) {
        const oldParent = this.getParent(child);
        if (oldParent && oldParent.children) oldParent.children = oldParent.children.filter(entry => entry !== child);
        child.parent = parent;
        parent.children = parent.children || [];
        const insertAt = typeof index === "number" ? Math.min(index, parent.children.length) : parent.children.length;
        parent.children.splice(insertAt, 0, child);
        return child;
    }
}

function geometry(x, y, width, height) {
    return {
        x, y, width, height,
        clone() { return geometry(this.x, this.y, this.width, this.height); }
    };
}

function appendChild(parent, child) {
    child.parent = parent;
    parent.children.push(child);
    return child;
}

function absoluteGeometry(cell) {
    const geo = cell && cell.geometry || { x: 0, y: 0, width: 0, height: 0 };
    let x = Number(geo.x || 0);
    let y = Number(geo.y || 0);
    let parent = cell && cell.parent;
    while (parent) {
        const parentGeo = parent.geometry || {};
        x += Number(parentGeo.x || 0);
        y += Number(parentGeo.y || 0);
        parent = parent.parent;
    }
    return { x, y, width: Number(geo.width || 0), height: Number(geo.height || 0) };
}

function makeHarness() {
    const dom = new JSDOM("<!doctype html><body><div id='graph'></div></body>");
    const document = dom.window.document;
    const root = new TestCell("root", {}, geometry(0, 0, 0, 0));
    const layer = appendChild(root, new TestCell("layer", {}, geometry(0, 0, 0, 0)));
    const group = appendChild(layer, new TestCell("group", { tiler_group: "1" }, geometry(100, 50, 120, 80)));
    const tile = appendChild(group, new TestCell("tile", { plant_tiler: "1", auto: "1" }, geometry(10, 12, 8, 8)));
    const summary = appendChild(group, new TestCell("summary", { lod_summary: "1" }, geometry(30, 20, 16, 16)));
    const plain = appendChild(layer, new TestCell("plain", {}, geometry(240, 70, 30, 20)));
    const nestedGroup = appendChild(layer, new TestCell("nestedGroup", { tiler_group: "1" }, geometry(260, 120, 40, 30)));
    const model = new TestModel(root);
    const graphListeners = new Map();
    const graph = {
        container: document.getElementById("graph"),
        view: {
            scale: 1,
            translate: { x: 0, y: 0 },
            getState(cell) { return absoluteGeometry(cell); }
        },
        getModel() { return model; },
        getDefaultParent() { return layer; },
        addListener(event, listener) {
            if (!graphListeners.has(event)) graphListeners.set(event, []);
            graphListeners.get(event).push(listener);
        },
        fireCellsMoved(cells) {
            (graphListeners.get("cellsMoved") || []).forEach(listener => listener(this, { getProperty(key) { return key === "cells" ? cells : null; } }));
        },
        isValidDropTarget() { return true; },
        refresh() { this.refreshCount = (this.refreshCount || 0) + 1; }
    };
    const context = {
        window: dom.window,
        document,
        Draw: { loadPlugin(callback) { callback({ editor: { graph } }); } },
        mxEvent: { CELLS_MOVED: "cellsMoved" }
    };

    vm.runInNewContext(fs.readFileSync(PLUGIN_PATH, "utf8"), context, { filename: PLUGIN_PATH });
    return { graph, model, root, layer, group, tile, summary, plain, nestedGroup };
}

test("planting groups reject plain child drops on the group or descendants", () => {
    const { graph, group, tile, plain, layer } = makeHarness();

    assert.equal(graph.isValidDropTarget(group, [plain]), false);
    assert.equal(graph.isValidDropTarget(tile, [plain]), false);
    assert.equal(graph.isValidDropTarget(layer, [plain]), true);
});

test("generated planting children stay inside planting groups after move events", () => {
    const { graph, group, tile, summary } = makeHarness();

    graph.fireCellsMoved([tile, summary]);

    assert.equal(tile.parent, group);
    assert.equal(summary.parent, group);
});

test("leaked plain children are ejected from planting groups with geometry preserved", () => {
    const { graph, model, layer, group, plain } = makeHarness();
    plain.geometry = geometry(14, 18, 30, 20);
    model.add(group, plain);
    const before = absoluteGeometry(plain);

    graph.fireCellsMoved([plain]);

    assert.equal(plain.parent, layer);
    assert.deepEqual(absoluteGeometry(plain), before);
    assert.equal(graph.refreshCount, 1);
});

test("tiler-group-to-tiler-group drops are rejected and repaired", () => {
    const { graph, model, layer, group, nestedGroup } = makeHarness();
    nestedGroup.geometry = geometry(22, 24, 40, 30);
    model.add(group, nestedGroup);
    const before = absoluteGeometry(nestedGroup);

    assert.equal(graph.isValidDropTarget(group, [nestedGroup]), false);
    graph.fireCellsMoved([nestedGroup]);

    assert.equal(nestedGroup.parent, layer);
    assert.deepEqual(absoluteGeometry(nestedGroup), before);
});
