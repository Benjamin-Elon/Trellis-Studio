const assert = require('node:assert/strict'); // CHANGE
const fs = require('node:fs'); // CHANGE
const path = require('node:path'); // CHANGE
const test = require('node:test'); // CHANGE
const { loadPlantTilerMxGraph } = require('./helpers/plant-tiler-mxgraph-harness.cjs'); // CHANGE
const plugins = path.join(__dirname, '../drawio/src/main/webapp/plugins/garden_planner_plugins'); // CHANGE

/** Run real deferred module parenting alongside the production planting factory and mxGraph history. */ // CHANGE
function fixture() { // CHANGE
    const h = loadPlantTilerMxGraph(); // CHANGE
    h.window.eval(fs.readFileSync(path.join(plugins, 'Modules_Standalone.js'), 'utf8')); // CHANGE
    h.bedCell = h.bed(150, 300); // CHANGE
    h.proposal = h.tiler.proposePlantingGeometry({ bedCell: h.bedCell, fillAvailableBed: true, spacingXCm: 30, spacingYCm: 30 }); // CHANGE
    h.circles = () => Object.values(h.graph.model.cells).filter(cell => cell.getAttribute?.('plant_tiler') === '1'); // CHANGE
    h.create = (proposal = h.proposal) => h.tiler.createPlantingFromProposal({ moduleCell: h.moduleCell, proposal, attributes: { plant_name: 'Basil', plant_abbr: 'BAS', plant_yield: '0.1' } }, { select: false }); // CHANGE
    h.flush = () => new Promise(resolve => h.window.setTimeout(resolve, 40)); // CHANGE
    return h; // CHANGE
} // CHANGE

test('one proposal creates only final circles, honors deferred selection, and round-trips with LOD and history', async () => { // CHANGE
    const h = fixture(); // CHANGE
    try { // CHANGE
        h.graph.setSelectionCell(h.bedCell); h.undoManager.clear(); // CHANGE
        const added = []; // CHANGE
        h.graph.addListener(h.window.mxEvent.CELLS_ADDED, (_sender, event) => added.push(...event.getProperty('cells').filter(cell => cell.getAttribute?.('plant_tiler') === '1'))); // CHANGE
        const group = h.create(); // CHANGE
        assert.equal(added.length, h.proposal.plantCount); assert.ok(added.every(cell => cell.getAttribute('label') === 'BAS')); // CHANGE
        await h.flush(); // CHANGE
        assert.equal(h.graph.getSelectionCell(), h.bedCell); // CHANGE
        assert.equal(h.circles().length, h.proposal.plantCount); assert.ok(h.circles().every(cell => cell.parent === group)); // CHANGE
        h.undoManager.undo(); await h.flush(); assert.equal(h.graph.model.getCell(group.id), undefined); assert.equal(h.circles().length, 0); // CHANGE
        h.undoManager.redo(); await h.flush(); assert.equal(h.circles().length, h.proposal.plantCount); // CHANGE
        h.tiler.setPlantingGroupDetail(group, false); await h.flush(); assert.equal(h.circles().length, 0); // CHANGE
        h.tiler.setPlantingGroupDetail(group, true); await h.flush(); assert.equal(h.circles().length, h.proposal.plantCount); // CHANGE
        const xml = h.window.mxUtils.getXml(new h.window.mxCodec().encode(h.graph.model)); // CHANGE
        const restored = new h.window.mxGraphModel(); new h.window.mxCodec().decode(h.window.mxUtils.parseXml(xml).documentElement, restored); // CHANGE
        const circles = Object.values(restored.cells).filter(cell => cell.getAttribute?.('plant_tiler') === '1'); // CHANGE
        assert.equal(circles.length, h.proposal.plantCount); assert.ok(circles.every(cell => cell.parent.id === group.id)); // CHANGE
    } finally { h.close(); } // CHANGE
}); // CHANGE

test('deferred module callbacks cannot resurrect circles replaced by retile, removed groups, or immediate Undo', async () => { // CHANGE
    const h = fixture(); // CHANGE
    try { // CHANGE
        const group = h.create(); // CHANGE
        h.tiler.retileGroup(h.graph, group); // CHANGE: replace the first set before its deferred parenting runs.
        await h.flush(); // CHANGE
        assert.equal(h.circles().length, h.proposal.plantCount); assert.ok(h.circles().every(cell => cell.parent === group)); // CHANGE
        h.graph.removeCells([group]); await h.flush(); assert.equal(h.circles().length, 0); // CHANGE
        h.undoManager.clear(); const next = h.create(); h.undoManager.undo(); await h.flush(); // CHANGE
        assert.equal(h.graph.model.getCell(next.id), undefined); assert.equal(h.circles().length, 0); // CHANGE
    } finally { h.close(); } // CHANGE
}); // CHANGE

test('collapsed proposals generate one summary without first expanding circles', async () => { // CHANGE
    const h = fixture(); // CHANGE
    try { // CHANGE
        const added = []; h.graph.addListener(h.window.mxEvent.CELLS_ADDED, (_sender, event) => added.push(...event.getProperty('cells'))); // CHANGE
        const group = h.create({ ...h.proposal, lodCollapsed: true }); await h.flush(); // CHANGE
        assert.equal(added.filter(cell => cell.getAttribute?.('plant_tiler') === '1').length, 0); // CHANGE
        assert.equal(h.graph.getChildVertices(group).filter(cell => cell.getAttribute('lod_summary') === '1').length, 1); // CHANGE
    } finally { h.close(); } // CHANGE
}); // CHANGE

test('failed circle generation removes the provisional group and its pending additions', async () => { // CHANGE
    const h = fixture(); // CHANGE
    try { // CHANGE
        const addCells = h.graph.addCells; // CHANGE
        h.graph.addCells = function (cells) { const result = addCells.apply(this, arguments); if (cells.some(cell => cell.getAttribute?.('plant_tiler') === '1')) throw new Error('Injected rendering failure'); return result; }; // CHANGE
        assert.throws(() => h.create(), /Injected rendering failure/); // CHANGE
        h.graph.addCells = addCells; await h.flush(); // CHANGE
        assert.equal(h.circles().length, 0); assert.equal(Object.values(h.graph.model.cells).filter(cell => cell.getAttribute?.('tiler_group') === '1').length, 0); // CHANGE
        const group = h.create(); await h.flush(); assert.ok(h.circles().every(cell => cell.parent === group)); // CHANGE
    } finally { h.close(); } // CHANGE
}); // CHANGE
