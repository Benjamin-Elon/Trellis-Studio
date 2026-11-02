/** Native preview coordinates must survive independent growth and view rendering before release. */ // CHANGE
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'); // CHANGE
const { loadPlantTilerMxGraph } = require('./helpers/plant-tiler-mxgraph-harness.cjs'); // CHANGE

function fixture(t, { html = 0, scale = 1, angle = 0 } = {}) { // CHANGE
    const h = loadPlantTilerMxGraph(), { graph, window: w } = h; t.after(h.close); // CHANGE
    const NativeDate = w.Date; w.Date = class extends NativeDate { constructor(...args) { super(...(args.length ? args : [2026, 0, 21, 12])); } }; // CHANGE
    w.eval(fs.readFileSync(path.join(__dirname, '../drawio/src/main/webapp/plugins/garden_planner_plugins/Garden_Scheduler_Shared_Core.js'), 'utf8')); // CHANGE
    const value = attrs => { const node = w.mxUtils.createXmlDocument().createElement('object'); Object.entries(attrs).forEach(([key, entry]) => node.setAttribute(key, entry)); return node; }; // CHANGE
    const group = graph.insertVertex(h.moduleCell, 'crop', value({ tiler_group: '1', bed_auto_fit: '0', sow_date: '2026-01-01', germ_date: '2026-01-11', harvest_start: '2026-01-31', harvest_end: '2026-02-10', method_id: 'direct_sow.field' }), 100, 100, 200, 160, 'fillColor=none;rotation=' + angle); // CHANGE
    const circle = (id, x) => graph.insertVertex(group, id, value({ plant_tiler: '1', auto: '0', label: 'CIL' }), x, 50, 20, 20, 'shape=ellipse;align=center;verticalAlign=middle;html=' + html); // CHANGE
    graph.isHtmlLabel = cell => graph.getCellStyle(cell).html == 1; graph.getCompositeParent = cell => cell; // CHANGE
    const a = circle('a', 50), b = circle('b', 90), growth = graph.__trellisPlantingGroup.growth, handler = graph.graphHandler; // CHANGE
    graph.view.scaleAndTranslate(scale, 10, 20); growth.refresh(); h.undoManager.clear(); handler.maxLivePreview = 32; handler.allowLivePreview = true; // CHANGE
    const xml = () => w.mxUtils.getXml(h.ui.getXmlFileData()), frame = () => new Promise(resolve => w.requestAnimationFrame(resolve)); // CHANGE
    function paint(cell) { // CHANGE
        const state = graph.view.getState(cell), ellipse = [...state.shape.node.querySelectorAll('ellipse')].find(node => node.getAttribute('stroke') === '#111827'); // CHANGE
        return { x: state.shape.bounds.x, y: state.shape.bounds.y, labelX: state.text.bounds.getCenterX(), labelY: state.text.bounds.getCenterY(), radius: Number(ellipse.getAttribute('rx')), outline: !!state.shape.node.querySelector('ellipse[stroke="#2563eb"]'), stateX: state.x, stateY: state.y }; // CHANGE
    } // CHANGE
    function start(cells = [a], dx = 30, dy = 10) { // CHANGE
        graph.setSelectionCells(cells); graph.isMouseDown = true; const state = graph.view.getState(cells[0]); handler.start(cells[0], state.getCenterX(), state.getCenterY(), cells); // CHANGE
        handler.currentDx = dx; handler.currentDy = dy; handler.checkPreview(); handler.updatePreview(); assert.equal(handler.livePreviewActive, true); assert.equal(handler.livePreviewUsed, true); // CHANGE
    } // CHANGE
    return { ...h, w, group, a, b, growth, handler, xml, frame, paint, start }; // CHANGE
} // CHANGE

for (const html of [0, 1]) for (const transformed of [false, true]) test(`live ${html ? 'HTML' : 'SVG'} circle previews survive growth, revalidation and recreated states${transformed ? ' at rotated zoom' : ''}`, async t => { // CHANGE
    const h = fixture(t, { html, angle: transformed ? 25 : 0, scale: transformed ? 1.6 : 1 }), initial = h.paint(h.a), baseline = h.xml(); h.start(); // CHANGE
    const expected = h.paint(h.a); assert.equal(expected.x, initial.x + 30); assert.equal(expected.y, initial.y + 10); // CHANGE
    assert.ok(Math.abs(expected.labelX - initial.labelX - 30) < 1e-6); assert.ok(Math.abs(expected.labelY - initial.labelY - 10) < 1e-6); // CHANGE
    h.growth.setShowHarvestSize(h.moduleCell, true); // CHANGE
    for (let pass = 0; pass < 3; pass++) { // CHANGE
        h.growth.refresh(); h.graph.view.revalidate(); assert.deepEqual(h.paint(h.a), expected); // CHANGE
        h.graph.refresh(); assert.deepEqual(h.paint(h.a), expected); await h.frame(); await h.frame(); assert.deepEqual(h.paint(h.a), expected); // CHANGE
    } // CHANGE
    assert.equal(h.paint(h.b).outline, true); assert.equal(h.xml(), baseline); assert.equal(h.undoManager.history.length, 0); // CHANGE
    h.handler.currentDx = 45; h.handler.currentDy = 15; h.handler.updatePreview(); // CHANGE
    assert.equal(h.paint(h.a).x, initial.x + 45); assert.equal(h.paint(h.a).y, initial.y + 15); // CHANGE
    h.handler.reset(); await h.frame(); assert.equal(h.paint(h.a).x, initial.x); assert.equal(h.paint(h.a).outline, true); assert.equal(h.xml(), baseline); // CHANGE
}); // CHANGE

test('late climate results update unrelated circles while moving circles retain their original ratio until cleanup', async t => { // CHANGE
    const h = fixture(t), requests = new Map(); h.w.USL.scheduler.resolvePlantGrowthContext = cell => new Promise(resolve => requests.set(cell, resolve)); // CHANGE
    h.growth.refresh(); await Promise.resolve(); await Promise.resolve(); const initial = h.paint(h.a), otherRadius = h.paint(h.b).radius; h.start(); // CHANGE
    const rates = {}; for (let day = 11; day <= 30; day++) rates['2026-01-' + day] = day < 21 ? 10 : 0; // CHANGE
    requests.get(h.group)({ dailyRates: rates }); await Promise.resolve(); await h.frame(); await h.frame(); // CHANGE
    assert.equal(h.growth.estimate(h.group).areaRatio, 1); assert.equal(h.paint(h.a).radius, initial.radius); assert.ok(h.paint(h.b).radius > otherRadius); assert.equal(h.paint(h.a).x, initial.x + 30); // CHANGE
    h.graph.view.revalidate(); h.graph.refresh(); await h.frame(); assert.equal(h.paint(h.a).radius, initial.radius); // CHANGE
    h.handler.reset(); await h.frame(); assert.ok(h.paint(h.a).radius > initial.radius); assert.equal(h.paint(h.a).x, initial.x); // CHANGE
}); // CHANGE

test('multiple moving circles share the native offset and release commits one contained Undo action', async t => { // CHANGE
    const h = fixture(t), before = [h.paint(h.a), h.paint(h.b)], geometries = [h.a.geometry.clone(), h.b.geometry.clone()]; h.start([h.a, h.b], 999, 10); // CHANGE
    h.growth.setShowHarvestSize(h.moduleCell, true); h.graph.view.revalidate(); // CHANGE
    for (const [i, cell] of [h.a, h.b].entries()) { assert.equal(h.paint(cell).x, before[i].x + 999); assert.ok(cell.geometry.equals(geometries[i])); } // CHANGE
    h.handler.mouseUp(h.graph, { isConsumed: () => false, getCell: () => null, getEvent: () => ({ type: 'mouseup', clientX: 999, clientY: 200 }), consume() {} }); await h.frame(); // CHANGE
    assert.equal(h.undoManager.history.length, 1); assert.equal(h.a.parent, h.group); assert.equal(h.b.parent, h.group); // CHANGE
    assert.ok(h.b.geometry.x + h.b.geometry.width <= h.group.geometry.width + 1e-6); assert.equal(h.b.geometry.x - h.a.geometry.x, geometries[1].x - geometries[0].x); // CHANGE
    assert.equal(h.paint(h.a).outline, true); h.undoManager.undo(); assert.ok(h.a.geometry.equals(geometries[0])); h.undoManager.redo(); assert.ok(h.b.geometry.x > geometries[1].x); // CHANGE
}); // CHANGE

for (const event of ['escape', 'blur', 'pointercancel', 'touchcancel', 'fileLoaded', 'pageSelected']) test(`${event} cancels the preview without changing authored content or Undo`, async t => { // CHANGE
    const h = fixture(t), baseline = h.xml(), initial = h.paint(h.a); h.start(); h.growth.setShowHarvestSize(h.moduleCell, true); // CHANGE
    if (event === 'escape') h.graph.fireEvent(new h.w.mxEventObject(h.w.mxEvent.ESCAPE)); // CHANGE
    else if (event === 'fileLoaded' || event === 'pageSelected') h.ui.editor.fireEvent(new h.w.mxEventObject(event)); // CHANGE
    else h.w.dispatchEvent(new h.w.Event(event)); // CHANGE
    await h.frame(); assert.equal(h.handler.first, null); assert.equal(h.paint(h.a).x, initial.x); assert.equal(h.paint(h.a).outline, true); assert.equal(h.xml(), baseline); assert.equal(h.undoManager.history.length, 0); // CHANGE
    h.graph.view.revalidate(); assert.equal(h.paint(h.a).x, initial.x); // CHANGE
}); // CHANGE

for (const mutation of ['move', 'reparent', 'delete', 'ancestor-resize', 'root']) test(`external ${mutation} cancels an active preview and preserves the external model change`, async t => { // CHANGE
    const h = fixture(t); h.start(); // CHANGE
    if (mutation === 'move' || mutation === 'ancestor-resize') { const cell = mutation === 'move' ? h.a : h.group, geo = cell.geometry.clone(); if (cell === h.a) geo.x += 4; else geo.width += 10; h.graph.model.setGeometry(cell, geo); } // CHANGE
    else if (mutation === 'reparent') h.graph.model.add(h.moduleCell, h.a); // CHANGE
    else if (mutation === 'delete') h.graph.removeCells([h.a]); // CHANGE
    else h.graph.model.setRoot(new h.w.mxGraphModel().getRoot()); // CHANGE
    const committed = h.xml(); await h.frame(); assert.equal(h.handler.first, null); assert.equal(h.xml(), committed); assert.equal(h.undoManager.history.length, 1); // CHANGE
}); // CHANGE

test('clone mode and suspension restore original artwork and resume with a fresh native preview', async t => { // CHANGE
    const h = fixture(t), initial = h.paint(h.a); h.start(); h.handler.cloning = true; h.handler.checkPreview(); h.handler.updatePreview(); // CHANGE
    h.growth.setShowHarvestSize(h.moduleCell, true); h.growth.refresh(); assert.equal(h.paint(h.a).x, initial.x); assert.equal(h.paint(h.a).outline, true); // CHANGE
    h.handler.cloning = false; h.handler.checkPreview(); h.handler.updatePreview(); assert.equal(h.paint(h.a).x, initial.x + 30); // CHANGE
    h.handler.suspend(); h.growth.setShowHarvestSize(h.moduleCell, false); h.growth.refresh(); assert.equal(h.paint(h.a).x, initial.x); assert.equal(h.paint(h.a).outline, false); // CHANGE
    h.handler.resume(); h.handler.updatePreview(); h.graph.view.revalidate(); assert.equal(h.paint(h.a).x, initial.x + 30); assert.equal(h.paint(h.a).outline, false); h.handler.reset(); // CHANGE
}); // CHANGE

for (const native of [false, true]) test(`${native ? 'native preview' : 'ordinary'} redraw errors restore view coordinates and release frozen appearance`, async t => { // CHANGE
    const h = fixture(t), initial = h.paint(h.a), baseline = h.xml(); h.start(); // CHANGE
    const state = h.graph.view.getState(h.a), paint = state.shape.paintVertexShape; let throws = true; // CHANGE
    state.shape.paintVertexShape = function () { if (throws) { throws = false; throw new Error('Injected paint failure'); } return paint.apply(this, arguments); }; // CHANGE
    assert.throws(() => native ? h.handler.updatePreview() : h.graph.cellRenderer.redraw(state, true), /Injected paint failure/); // CHANGE
    assert.equal(h.handler.first, null); assert.equal(h.graph.view.getState(h.a).x, initial.stateX); h.growth.setShowHarvestSize(h.moduleCell, true); h.growth.refresh(); // CHANGE
    assert.equal(h.paint(h.a).x, initial.x); assert.equal(h.paint(h.a).outline, true); assert.equal(h.xml(), baseline); assert.equal(h.undoManager.history.length, 0); // CHANGE
}); // CHANGE

test('disposing during a drag removes guards and cancels queued preview refreshes', async t => { // CHANGE
    const h = fixture(t), initial = h.paint(h.a), baseline = h.xml(); h.start(); h.graph.refresh(); h.growth.dispose(); // CHANGE
    await h.frame(); assert.equal(h.handler.first, null); h.graph.view.revalidate(); assert.equal(h.graph.view.getState(h.a).shape.bounds.x, initial.x); assert.equal(h.xml(), baseline); assert.equal(h.undoManager.history.length, 0); // CHANGE
}); // CHANGE

test('destroying the native handler restores moving glyphs and prevents queued preview resurrection', async t => { // CHANGE
    const h = fixture(t), initial = h.paint(h.a), baseline = h.xml(); h.start(); h.graph.refresh(); h.handler.destroy(); // CHANGE
    h.growth.setShowHarvestSize(h.moduleCell, true); await h.frame(); h.graph.view.revalidate(); assert.equal(h.handler.first, null); assert.equal(h.paint(h.a).x, initial.x); assert.equal(h.paint(h.a).outline, true); assert.equal(h.xml(), baseline); // CHANGE
}); // CHANGE
