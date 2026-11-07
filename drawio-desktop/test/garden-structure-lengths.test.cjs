const test = require('node:test'); // NEW
const assert = require('node:assert/strict'); // NEW
const { fixture, read } = require('./helpers/garden-structures-harness.cjs'); // NEW
const labels = f => [...f.w.document.querySelectorAll('[data-trellis-structure-length]')]; // NEW

/** Storage is replaceable because the mxGraph fixture intentionally has an opaque origin. */ // NEW
function preferences(f) { // NEW
    const values = new Map(); // NEW
    Object.defineProperty(f.w, 'localStorage', { configurable: true, value: { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value) } }); // NEW
    let actor = 'a', diagram = 'diagram-a'; // NEW
    f.w.Trellis.users = { getCurrentUser: () => ({ id: actor }), getDiagramKey: options => { assert.equal(options.create, false); return diagram; } }; // NEW
    f.ui.currentPage = { id: 'page-a' }; // NEW
    return { values, actor(value) { actor = value; }, diagram(value) { diagram = value; } }; // NEW
} // NEW

test('page-wide labels default hidden, survive deselection, use each garden’s units, and never edit XML/history/export', async t => { // NEW
    const f = fixture(t, { plugins: ['Garden_Scale.js'] }); preferences(f); // NEW
    const first = f.api.create(f.garden), otherGarden = f.graph.insertVertex(null, 'other-garden', f.value({ garden_module: '1', unit_system: 'imperial' }), 1200, 100, 600, 600); // NEW
    f.api.create(otherGarden); f.graph.clearSelection(); await f.tick(); assert.equal(labels(f).length, 0); // NEW
    const before = f.serialized(); f.undo.clear(); f.graph.setEnabled(false); f.api.setShowSideLengths(true); // NEW
    assert.equal(labels(f).length, 8); assert.equal(labels(f)[0].textContent, '2.00 m'); assert.equal(labels(f)[4].textContent, '6 ft 7 in'); // NEW
    assert.equal(f.api.getShowSideLengths(), true); assert.equal(f.serialized(), before); assert.equal(f.undo.history.length, 0); // NEW
    const doc = f.w.mxUtils.createXmlDocument(), svg = doc.createElementNS(f.w.mxConstants.NS_SVG, 'svg'); doc.appendChild(svg); // NEW
    new f.w.mxImageExport().drawState(f.graph.view.getState(first), new f.w.mxSvgCanvas2D(svg)); assert.doesNotMatch(f.w.mxUtils.getXml(svg), /2\.00 m|trellis-structure-length/); // NEW
    assert.match(f.w.document.head.textContent, /@media print.*trellis-structure-length/); // NEW
    f.api.setShowSideLengths(false); assert.equal(labels(f).length, 0); assert.equal(f.serialized(), before); // NEW
}); // NEW

test('physical edges include the closing segment and stay correct through rotation, flips, zoom, translation and pan', async t => { // NEW
    const f = fixture(t, { plugins: ['Garden_Scale.js'] }), cell = f.api.create(f.garden); // NEW
    await f.api.editFootprint(cell); const p = f.api.getDraft().points; f.api.moveCorner(0, [p[0][0] + 45, p[0][1] + 30]); f.api.done(); // NEW
    f.api.setShowSideLengths(true); const expected = Array.from(f.api.footprint(cell)).map((p, i, points) => f.graph.__gardenScaleController.formatLengthFromUnits(Math.hypot(p[0] - points[(i + 1) % points.length][0], p[1] - points[(i + 1) % points.length][1]), cell)); // NEW
    f.model.setStyle(cell, cell.style + 'rotation=125;flipH=1;flipV=1;'); f.graph.view.scaleAndTranslate(1.8, 32, 18); f.graph.panGraph(20, 12); await f.tick(); // NEW
    assert.deepEqual(labels(f).map(node => node.textContent), expected); // NEW
    for (const node of labels(f)) { const angle = Number(node.style.transform.match(/rotate\(([-\d.e]+)rad\)/)[1]); assert.ok(Math.abs(angle) <= Math.PI / 2 + 1e-9); assert.equal(node.style.pointerEvents, 'none'); } // NEW
    await f.api.editFootprint(cell); const point = f.api.getDraft().points[0], next = f.api.getDraft().points[1]; f.api.insertCorner(0, [(point[0] + next[0]) / 2, (point[1] + next[1]) / 2]); await f.tick(); // NEW
    assert.equal(labels(f).length, 5); assert.ok(labels(f).every(node => node.parentNode === f.graph.shiftPreview2)); // NEW
    f.graph.panGraph(0, 0); assert.ok(labels(f).every(node => node.parentNode === f.graph.container)); // NEW
}); // NEW

test('editing forces live labels, rejects invalid edits, and restores the preference through Done, Cancel and history dismissal', async t => { // NEW
    const f = fixture(t, { plugins: ['Planting_Group.js', 'Garden_Scale.js'], history: true }), cell = f.api.create(f.garden); await f.tick(); // NEW
    await f.api.editFootprint(cell); assert.equal(labels(f).length, 4); assert.equal(f.api.getShowSideLengths(), false); // NEW
    const original = labels(f).map(node => node.textContent), handler = f.graph.selectionCellsHandler.getHandler(cell), handle = handler.customHandles[0], bounds = new f.w.mxRectangle(0, 0, cell.geometry.width, cell.geometry.height); // NEW
    handle.setPosition(bounds, new f.w.mxPoint(25, 15)); assert.notDeepEqual(labels(f).map(node => node.textContent), original); handle.reset(); // NEW
    assert.deepEqual(labels(f).map(node => node.textContent), original); // NEW
    assert.equal(f.api.moveCorner(0, [5000, 5000]), false); await f.tick(); assert.deepEqual(labels(f).map(node => node.textContent), original); // NEW
    const p = f.api.getDraft().points; f.api.insertCorner(0, [(p[0][0] + p[1][0]) / 2, p[0][1]]); await f.tick(); assert.equal(labels(f).length, 5); // NEW
    f.api.removeCorner(1); await f.tick(); assert.equal(labels(f).length, 4); f.api.done(); await f.tick(); assert.equal(labels(f).length, 0); // NEW
    await f.api.editFootprint(cell); await f.api.cancel(); await f.tick(); assert.equal(labels(f).length, 0); // NEW
    f.api.setShowSideLengths(true); await f.api.editFootprint(cell); f.api.setShowSideLengths(false); assert.equal(labels(f).length, 4); // NEW
    f.ui.actions.get('undo').funct(); await f.tick(); assert.equal(f.api.getDraft(), null); assert.equal(labels(f).length, 0); // NEW
}); // NEW

test('preferences isolate users, diagrams and pages, persist across reload, and respond to storage events', async t => { // NEW
    const f = fixture(t, { plugins: ['Garden_Scale.js'] }), prefs = preferences(f); f.api.create(f.garden); f.api.setShowSideLengths(true); // NEW
    prefs.actor('b'); assert.equal(f.api.getShowSideLengths(), false); prefs.actor('a'); assert.equal(f.api.getShowSideLengths(), true); // NEW
    f.ui.currentPage = { id: 'page-b' }; assert.equal(f.api.getShowSideLengths(), false); f.ui.currentPage = { id: 'page-a' }; // NEW
    prefs.diagram('diagram-b'); assert.equal(f.api.getShowSideLengths(), false); prefs.diagram('diagram-a'); // NEW
    f.w.dispatchEvent(new f.w.Event('trellisUsersSessionChanged')); await f.tick(); assert.equal(f.api.getShowSideLengths(), true); // NEW
    const key = [...prefs.values.keys()][0]; prefs.values.set(key, 'false'); f.w.dispatchEvent(new f.w.StorageEvent('storage', { key })); await f.tick(); assert.equal(labels(f).length, 0); // NEW
    prefs.values.set(key, 'true'); f.w.dispatchEvent(new f.w.StorageEvent('storage', { key })); await f.tick(); assert.equal(labels(f).length, 4); // NEW
    prefs.values.set(key, '{broken'); f.w.dispatchEvent(new f.w.StorageEvent('storage', { key })); await f.tick(); assert.equal(f.api.getShowSideLengths(), false); // NEW
    f.w.localStorage.getItem = () => { throw new Error('blocked'); }; f.w.localStorage.setItem = () => { throw new Error('blocked'); }; // NEW
    f.api.setShowSideLengths(true); assert.equal(f.api.getShowSideLengths(), true); f.w.dispatchEvent(new f.w.Event('trellisUsersSessionChanged')); await f.tick(); assert.equal(labels(f).length, 4); // NEW
}); // NEW

test('unidentified pages retain isolated session settings and formatter readiness tolerates reverse plugin order', async t => { // NEW
    const f = fixture(t), originalRoot = f.model.getRoot(); f.api.create(f.garden); f.api.setShowSideLengths(true); assert.equal(labels(f).length, 0); // NEW
    f.w.eval(read('plugins/garden_planner_plugins/Garden_Scale.js')); await f.tick(); assert.equal(labels(f).length, 4); // NEW
    f.model.setRoot(f.model.createRoot()); await f.tick(); assert.equal(f.api.getShowSideLengths(), false); assert.equal(labels(f).length, 0); // NEW
    f.model.setRoot(originalRoot); await f.tick(); assert.equal(f.api.getShowSideLengths(), true); assert.equal(labels(f).length, 4); // NEW
}); // NEW

test('annotations follow visibility, removal, unit edits and suppression, while editing annotations stay visible', async t => { // NEW
    const f = fixture(t, { plugins: ['Garden_Scale.js'] }), cell = f.api.create(f.garden); f.api.setShowSideLengths(true); // NEW
    f.graph.__trellisOverlayVisibility.begin('gesture'); assert.ok(labels(f).every(node => node.style.display === 'none')); // NEW
    f.graph.__trellisOverlayVisibility.end('gesture'); await f.tick(); await f.api.editFootprint(cell); // NEW
    f.graph.__trellisOverlayVisibility.begin('gesture'); assert.ok(labels(f).every(node => node.style.display !== 'none')); // NEW
    f.graph.__trellisOverlayVisibility.end('gesture'); await f.api.cancel(); // NEW
    const value = f.garden.value.cloneNode(true); value.setAttribute('unit_system', 'imperial'); f.model.setValue(f.garden, value); await f.tick(); assert.equal(labels(f)[0].textContent, '6 ft 7 in'); // NEW
    f.model.setVisible(cell, false); await f.tick(); assert.equal(labels(f).length, 0); f.model.setVisible(cell, true); await f.tick(); assert.equal(labels(f).length, 4); // NEW
    const invalid = cell.value.cloneNode(true); invalid.setAttribute('structure_footprint_json', 'bad'); f.model.setValue(cell, invalid); await f.tick(); assert.equal(labels(f).length, 0); // NEW
    f.graph.removeCells([cell]); await f.tick(); assert.equal(labels(f).length, 0); // NEW
}); // NEW

test('length labels reserve space for the selected dimension chip and existing attribution card', async t => { // NEW
    const f = fixture(t, { plugins: ['Garden_Scale.js'] }), cell = f.api.create(f.garden); f.api.setShowSideLengths(true); await f.tick(); // NEW
    const chip = f.graph.__gardenScaleController.getOverlayPlacement(cell); assert.ok(chip); // NEW
    assert.ok(parseFloat(labels(f)[2].style.top) - 10 > chip.bottom + 3); // NEW
    const badge = f.w.document.createElement('div'); badge.dataset.trellisAttribution = cell.id; badge.style.left = chip.centerX + 'px'; badge.style.top = chip.bottom + 4 + 'px'; // NEW
    for (const text of ['Created by a gardener yesterday', 'Last edited by a gardener today']) { const line = f.w.document.createElement('div'); line.textContent = text; badge.appendChild(line); } // NEW
    f.graph.container.appendChild(badge); f.graph.view.validate(); await f.tick(); // NEW
    assert.ok(parseFloat(labels(f)[2].style.top) - 10 > chip.bottom + 4 + 42 + 3); // NEW
}); // NEW
