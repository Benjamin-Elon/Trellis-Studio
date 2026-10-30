const test = require('node:test'); // NEW
const assert = require('node:assert/strict'); // NEW
const { fixture, read } = require('./helpers/garden-structures-harness.cjs'); // NEW
const plain = value => JSON.parse(JSON.stringify(value)); // NEW
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, a + ' != ' + b); // NEW

test('creation fits boundaries and tiny gardens, uses a native stencil, and undoes once', async t => { // NEW
    const f = fixture(t, { width: 120, height: 70 }); // NEW
    const cell = f.api.create(f.garden, { x: 1000, y: -100 }); await f.tick(); // NEW
    const geometry = cell.geometry; assert.deepEqual([geometry.x, geometry.y, geometry.width, geometry.height], [50, 0, 70, 70]); // NEW
    assert.equal(cell.parent, f.garden); assert.equal(cell.getAttribute('label'), 'Structure'); assert.equal(cell.isConnectable(), false); // NEW
    const state = f.graph.view.getState(cell); assert.ok(state.shape.stencil); assert.ok(state.shape.node.querySelector('path')); // NEW
    assert.equal(f.undo.history.length, 1); f.undo.undo(); assert.equal(f.model.contains(cell), false); f.undo.redo(); assert.equal(f.model.contains(cell), true); // NEW
    assert.ok(f.w.document.querySelector('.trellis-structure-overlay')); // NEW
}); // NEW

test('creation converts nested absolute coordinates correctly through zoom, translation, and pan', t => { // NEW
    const f = fixture(t); const root = f.graph.insertVertex(null, 'outer', f.value({ label: 'Outer' }), 400, 300, 2000, 1500); f.graph.addCell(f.garden, root); // NEW
    f.graph.view.scaleAndTranslate(1.5, 35, -12); f.graph.panGraph(20, 10); // NEW
    const state = f.graph.view.getState(f.garden), origin = { x: state.x / 1.5 - 35, y: state.y / 1.5 + 12 }; // NEW
    const cell = f.api.create(f.garden, { x: origin.x + 350, y: origin.y + 290 }); // NEW
    close(cell.geometry.x, 260); close(cell.geometry.y, 200); assert.equal(cell.geometry.width, 180); // NEW
}); // NEW

test('polygon validation accepts concavity and rejects crossings, touching, overlapping edges, duplicates, and zero area', t => { // NEW
    const f = fixture(t), valid = f.api.validPolygon; // NEW
    assert.equal(valid([[0, 0], [3, 0], [3, 1], [1, 1], [1, 3], [0, 3]]), true); // NEW
    for (const points of [[], [[0, 0], [1, 1]], [[0, 0], [1, 1], [2, 2]], [[0, 0], [2, 2], [0, 2], [2, 0]], [[0, 0], [2, 0], [1, 0], [2, 2], [0, 2]], [[0, 0], [2, 0], [2, 2], [0, 0], [0, 2]], [[0, 0], [1, 0], [1, 0], [0, 1]], [[0, 0], [NaN, 0], [0, 1]]]) assert.equal(valid(points), false, JSON.stringify(points)); // NEW
}); // NEW

test('draft corner operations leave the model untouched and Done commits a concave outline in one undo step', async t => { // NEW
    const f = fixture(t), cell = f.api.create(f.garden, { x: 500, y: 400 }); f.undo.clear(); // NEW
    const original = f.serialized(); assert.equal(await f.api.editFootprint(cell), true); // NEW
    const points = f.api.getDraft().points, a = points[0], b = points[1], c = points[2]; // NEW
    assert.equal(f.api.insertCorner(1, [b[0] - 70, (b[1] + c[1]) / 2]), true); // NEW
    assert.equal(f.api.moveCorner(0, [a[0] - 30, a[1] + 10]), true); // NEW
    assert.equal(f.serialized(), original); assert.equal(f.undo.history.length, 0); // NEW
    assert.equal(f.api.done(), true); assert.equal(f.undo.history.length, 1); assert.equal(JSON.parse(cell.getAttribute('structure_footprint_json')).points.length, 5); // NEW
    const saved = f.serialized(); f.undo.undo(); assert.equal(f.serialized(), original); f.undo.redo(); assert.equal(f.serialized(), saved); // NEW
    assert.equal(f.api.getDraft(), null); // NEW
}); // NEW

test('corner removal respects the minimum and invalid operations retain the valid draft', async t => { // NEW
    const f = fixture(t), cell = f.api.create(f.garden); await f.api.editFootprint(cell); // NEW
    const original = plain(f.api.getDraft().points); assert.equal(f.api.moveCorner(0, [2000, 2000]), false); assert.deepEqual(plain(f.api.getDraft().points), original); // NEW
    assert.equal(f.api.removeCorner(0), true); assert.equal(f.api.removeCorner(0), false); assert.equal(f.api.getDraft().points.length, 3); // NEW
    assert.equal(f.api.done(), true); // NEW
}); // NEW

test('rotated and flipped rebasing preserves edited world positions, including expansion beyond the old rectangle', async t => { // NEW
    const f = fixture(t), cell = f.api.create(f.garden); f.model.setStyle(cell, cell.style + 'rotation=35;flipH=1;'); // NEW
    await f.api.editFootprint(cell); const draft = f.api.getDraft(), p = draft.points[1]; assert.equal(f.api.moveCorner(1, [p[0] + 40, p[1] + 20]), true); // NEW
    const before = f.api.getDraft().points, geometry = cell.geometry, angle = 35 * Math.PI / 180, cx = geometry.x + geometry.width / 2, cy = geometry.y + geometry.height / 2; // NEW
    const expected = before.map(([x, y]) => [cx - (x - cx) * Math.cos(angle) - (y - cy) * Math.sin(angle), cy - (x - cx) * Math.sin(angle) + (y - cy) * Math.cos(angle)]); // NEW
    assert.equal(f.api.done(), true); f.api.footprint(cell).forEach((point, i) => point.forEach((n, axis) => close(n, expected[i][axis]))); // NEW
}); // NEW

test('Cancel and Escape require discard approval only for changed drafts', async t => { // NEW
    const f = fixture(t), cell = f.api.create(f.garden); await f.api.editFootprint(cell); await f.api.cancel(); assert.equal(f.api.getDraft(), null); // NEW
    await f.api.editFootprint(cell); const p = f.api.getDraft().points[0]; f.api.moveCorner(0, [p[0] + 20, p[1] + 10]); // NEW
    const pending = f.api.cancel(); f.choose('Keep Editing'); await pending; assert.ok(f.api.getDraft()); // NEW
    f.w.document.dispatchEvent(new f.w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); f.choose('Discard Changes'); await f.tick(); assert.equal(f.api.getDraft(), null); // NEW
}); // NEW

test('selection and mode switches preserve a changed draft until discard is approved', async t => { // NEW
    const f = fixture(t), cell = f.api.create(f.garden), other = f.graph.insertVertex(f.garden, null, 'Other', 10, 10, 20, 20); // NEW
    await f.api.editFootprint(cell); const p = f.api.getDraft().points[0]; f.api.moveCorner(0, [p[0] + 20, p[1] + 10]); // NEW
    f.graph.setSelectionCell(other); f.choose('Keep Editing'); await f.tick(); assert.equal(f.graph.getSelectionCell(), cell); assert.ok(f.api.getDraft()); // NEW
    const modes = f.w.Trellis.interactionModes, request = modes.requestAsync('allocate', 'next', {}); assert.equal(modes.getActive().mode, 'structure-footprint'); f.choose('Keep Editing'); assert.equal(await request, null); // NEW
    f.graph.setSelectionCell(other); f.choose('Discard Changes'); await f.tick(); assert.equal(f.graph.getSelectionCell(), other); assert.equal(modes.getActive(), null); // NEW
    await f.api.editFootprint(cell); const q = f.api.getDraft().points[0]; f.api.moveCorner(0, [q[0] + 30, q[1] + 10]); // NEW
    const accepted = modes.requestAsync('irrigation', 'next', {}); f.choose('Discard Changes'); assert.equal((await accepted).mode, 'irrigation'); assert.equal(f.api.getDraft(), null); // NEW
}); // NEW

test('stale external data, deletion, permission loss, and malformed footprints never overwrite saved data', async t => { // NEW
    const f = fixture(t), cell = f.api.create(f.garden); await f.api.editFootprint(cell); // NEW
    const p = f.api.getDraft().points[0]; f.api.moveCorner(0, [p[0] + 20, p[1] + 10]); // NEW
    const changed = cell.value.cloneNode(true); changed.setAttribute('label', 'Remote name'); f.model.setValue(cell, changed); const saved = f.serialized(); // NEW
    assert.equal(f.api.done(), false); assert.match(f.api.getDraft().error, /changed elsewhere/); assert.equal(f.serialized(), saved); // NEW
    const cancel = f.api.cancel(); f.choose('Discard Changes'); await cancel; // NEW
    await f.api.editFootprint(cell); f.w.Trellis.users = { canEditCell: () => false }; assert.equal(f.api.done(), false); await f.api.cancel(); f.w.Trellis.users = null; // NEW
    const invalid = cell.value.cloneNode(true); invalid.setAttribute('structure_footprint_json', '{broken'); f.model.setValue(cell, invalid); const broken = f.serialized(); // NEW
    assert.equal(await f.api.editFootprint(cell), false); assert.equal(f.serialized(), broken); // NEW
    assert.throws(() => { f.w.Trellis.users = { canEditCell: () => false }; f.api.create(f.garden); }, /editable/); // NEW
}); // NEW

test('transforms stay within the garden and garden shrinking preserves structure geometry', t => { // NEW
    const f = fixture(t), cell = f.api.create(f.garden, { x: 1000, y: 700 }), original = cell.geometry; // NEW
    const outside = original.clone(); outside.x = 2000; f.model.setGeometry(cell, outside); assert.equal(cell.geometry, original); // NEW
    const resize = original.clone(); resize.width = 2000; f.graph.resizeCells([cell], [resize]); assert.equal(cell.geometry, original); // NEW
    const style = cell.style; f.graph.setCellStyles('rotation', '45', [cell]); assert.equal(cell.style, style); // NEW
    f.model.setStyle(cell, style + 'rotation=0;rotation=45;'); assert.equal(cell.style, style); // NEW: the final native style key determines containment.
    const gardenSize = f.garden.geometry.clone(); gardenSize.width = 40; gardenSize.height = 40; f.graph.resizeCells([f.garden], [gardenSize]); // NEW
    assert.ok(f.garden.geometry.width >= original.x + original.width); assert.ok(f.garden.geometry.height >= original.y + original.height); assert.equal(cell.geometry, original); // NEW
    assert.equal(f.graph.isValidDropTarget(cell, []), false); // NEW
}); // NEW

test('name editing preserves focused drafts, handles Escape/default names, and removal undoes once', async t => { // NEW
    const f = fixture(t), cell = f.api.create(f.garden); await f.tick(); f.undo.clear(); // NEW
    const input = f.w.document.querySelector('[aria-label="Structure name"]'); input.focus(); input.value = 'Draft shed'; f.graph.view.setScale(1.2); await f.tick(); // NEW
    assert.equal(f.w.document.querySelector('[aria-label="Structure name"]'), input); assert.equal(input.value, 'Draft shed'); // NEW
    input.dispatchEvent(new f.w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); input.blur(); assert.equal(cell.getAttribute('label'), 'Structure'); // NEW
    input.focus(); input.value = 'Tool shed'; input.dispatchEvent(new f.w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); assert.equal(cell.getAttribute('label'), 'Tool shed'); assert.equal(f.undo.history.length, 1); // NEW
    input.focus(); input.value = ' '; input.blur(); assert.equal(cell.getAttribute('label'), 'Structure'); // NEW
    f.undo.clear(); Array.from(f.w.document.querySelectorAll('.trellis-structure-overlay button')).find(node => node.textContent === 'Remove Structure').click(); assert.equal(f.model.contains(cell), false); assert.equal(f.undo.history.length, 1); f.undo.undo(); assert.equal(f.model.contains(cell), true); // NEW
}); // NEW

test('native codec, cloning and SVG export preserve portable outlines and scale uses garden units', async t => { // NEW
    const f = fixture(t, { plugins: ['Garden_Scale.js'] }), cell = f.api.create(f.garden); await f.tick(); // NEW
    const clone = f.graph.cloneCells([cell])[0]; f.graph.addCell(clone, f.garden); assert.equal(clone.getAttribute('structure_footprint_json'), cell.getAttribute('structure_footprint_json')); // NEW
    const encoded = new f.w.mxCodec().encode(f.model), restored = new f.w.mxGraphModel(); new f.w.mxCodec(encoded.ownerDocument).decode(encoded, restored); // NEW
    assert.equal(restored.getCell(cell.id).getAttribute('structure_footprint_json'), cell.getAttribute('structure_footprint_json')); // NEW
    const doc = f.w.mxUtils.createXmlDocument(), root = doc.createElementNS(f.w.mxConstants.NS_SVG, 'svg'); doc.appendChild(root); const canvas = new f.w.mxSvgCanvas2D(root); new f.w.mxImageExport().drawState(f.graph.view.getState(cell), canvas); // NEW
    assert.ok(root.querySelector('path')); assert.ok(root.querySelector('path').getAttribute('d').includes('Z')); // NEW
    assert.match(f.w.document.body.textContent, /2\.00 m/); // NEW
    const value = f.garden.value.cloneNode(true); value.setAttribute('unit_system', 'imperial'); f.model.setValue(f.garden, value); await f.tick(); assert.match(f.w.document.body.textContent, /6 ft 7 in/); // NEW
    assert.match(read('plugins/garden_planner_plugins/Planting_Group.js'), /"garden_structure",/); // NEW
}); // NEW

test('concurrent mode requests share a confirmation and only one replaces the draft owner', async t => { // NEW
    const f = fixture(t), cell = f.api.create(f.garden); await f.api.editFootprint(cell); const p = f.api.getDraft().points[0]; f.api.moveCorner(0, [p[0] + 10, p[1] + 10]); // NEW
    const modes = f.w.Trellis.interactionModes, first = modes.requestAsync('allocate', 'one', {}), second = modes.requestAsync('irrigation', 'two', {}); // NEW
    assert.equal(f.w.document.querySelectorAll('.trellis-structure-discard').length, 1); assert.equal(modes.request('other', 'legacy', {}), null); // NEW
    f.choose('Discard Changes'); const results = await Promise.all([first, second]); assert.equal(results.filter(Boolean).length, 1); assert.equal(modes.getActive().mode, 'allocate'); // NEW
}); // NEW

test('allocation and irrigation entry points wait for draft approval before initializing', async t => { // NEW
    const f = fixture(t, { plugins: ['Allocate_Planner.js', 'Garden_Irrigation_Planner.js'] }), cell = f.api.create(f.garden); await f.api.editFootprint(cell); // NEW
    const p = f.api.getDraft().points[0]; f.api.moveCorner(0, [p[0] + 10, p[1] + 10]); // NEW
    const original = f.serialized(), allocation = f.w.__trellisAllocatePlanRequestedHandler({ detail: { moduleCellId: f.garden.id, year: 2026 } }); // NEW
    f.choose('Keep Editing'); await allocation; assert.equal(f.serialized(), original); assert.equal(f.w.Trellis.interactionModes.getActive().mode, 'structure-footprint'); // NEW
    const irrigation = f.w.TrellisIrrigationPlanner.openIrrigationMode(f.garden); f.choose('Keep Editing'); assert.equal(await irrigation, null); // NEW
    assert.equal(f.serialized(), original); assert.equal(f.graph.getSelectionCell(), cell); // NEW
}); // NEW

test('deleted drafts retain Cancel and explanation, and plugin reload does not duplicate ownership', async t => { // NEW
    const f = fixture(t), cell = f.api.create(f.garden); await f.api.editFootprint(cell); const api = f.api; // NEW
    f.w.eval(read('plugins/garden_planner_plugins/Garden_Structures.js')); assert.equal(f.graph.__trellisStructures, api); // NEW
    f.model.remove(cell); await f.tick(); const panel = f.w.document.querySelector('.trellis-structure-overlay'); // NEW
    assert.equal(panel.style.display, 'flex'); assert.match(panel.textContent, /missing/); assert.equal(Array.from(panel.querySelectorAll('button')).find(node => node.textContent === 'Done').disabled, true); // NEW
    await f.api.cancel(); assert.equal(f.api.getDraft(), null); assert.equal(f.w.Trellis.interactionModes.getActive(), null); // NEW
}); // NEW

test('module containment integrates with structures and mixed moves without changing sibling footprints', async t => { // NEW
    const f = fixture(t, { plugins: ['Modules_Standalone.js'] }), cell = f.api.create(f.garden), sibling = f.api.create(f.garden, { x: 350, y: 350 }); // NEW
    const before = [cell.geometry.clone(), sibling.geometry.clone()]; f.graph.moveCells([cell, sibling], -2000, -2000); // NEW
    for (const object of [cell, sibling]) assert.equal(f.api.footprint(object).every(p => p[0] >= 0 && p[1] >= 0 && p[0] <= f.garden.geometry.width && p[1] <= f.garden.geometry.height), true); // NEW
    assert.equal(cell.geometry.width, before[0].width); assert.equal(sibling.geometry.width, before[1].width); // NEW
}); // NEW
