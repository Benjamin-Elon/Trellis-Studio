const test = require('node:test'); // CHANGE
const assert = require('node:assert/strict'); // CHANGE
const { fixture } = require('./helpers/garden-structures-harness.cjs'); // CHANGE
const close = (a, b, message = '') => assert.ok(Math.abs(a - b) < 1e-6, `${message}: ${a} != ${b}`); // CHANGE
const pointer = { altKey: false }; // CHANGE

/** Real plugins, model guards, history, and renderer; setup runs with presets disabled. */ // CHANGE
function setup(t, options = {}) { // CHANGE
    const f = fixture(t, { width: 1600, height: 1200, ...options, plugins: ['Planting_Group.js', ...(options.plugins || [])] }); // CHANGE
    f.model.setStyle(f.garden, 'module=1;'); // CHANGE: match production garden identity used by the planting controller.
    f.graph.setExtendParents(false); f.graph.setConstrainChildren(false); // CHANGE
    for (const id of ['small', 'medium', 'large']) f.garden.value.setAttribute(`default_path_${id}_enabled`, '0'); // CHANGE
    f.snap = f.graph.__trellisPlantingGroup.pathSnap; // CHANGE
    f.object = (kind, id, x, y, angle = 0, width = 120, height = 100) => { // CHANGE
        let cell; // CHANGE
        if (kind === 'bed') cell = f.graph.insertVertex(f.garden, id, f.value({ garden_bed: '1', label: id }), x, y, width, height, `rotation=${angle};`); // CHANGE
        else { // CHANGE
            cell = f.api.create(f.garden); // CHANGE
            f.model.setGeometry(cell, new f.w.mxGeometry(x, y, width, height)); // CHANGE
            f.graph.setCellStyles('rotation', String(angle), [cell]); // CHANGE
        } // CHANGE
        return cell; // CHANGE
    }; // CHANGE
    f.preset = (width, id = 'small') => { f.garden.value.setAttribute(`default_path_${id}_enabled`, '1'); f.garden.value.setAttribute(`default_path_${id}_width_cm`, String(width / 0.9)); }; // CHANGE
    return f; // CHANGE
} // CHANGE

/** Independent distance oracle uses the bundled point-to-segment primitive and native transformed corners. */ // CHANGE
function outline(f, cell, geometry = cell.geometry) { // CHANGE
    if (cell.getAttribute('garden_structure') === '1') return f.api.footprint(cell, geometry); // CHANGE
    const { x, y, width, height } = geometry, center = new f.w.mxPoint(x + width / 2, y + height / 2); // CHANGE
    const angle = Number(f.graph.getCellStyle(cell).rotation || 0) * Math.PI / 180; // CHANGE
    return [[x, y], [x + width, y], [x + width, y + height], [x, y + height]].map(([px, py]) => { const p = f.w.mxUtils.getRotatedPoint(new f.w.mxPoint(px, py), Math.cos(angle), Math.sin(angle), center); return [p.x, p.y]; }); // CHANGE
} // CHANGE
function distance(f, a, b, geometry = a.geometry) { // CHANGE
    const left = outline(f, a, geometry), right = outline(f, b); let best = Infinity; // CHANGE
    for (const [vertices, edges] of [[left, right], [right, left]]) for (const p of vertices) for (let i = 0; i < edges.length; i++) { // CHANGE
        const q = edges[i], r = edges[(i + 1) % edges.length]; // CHANGE
        best = Math.min(best, f.w.mxUtils.ptSegDistSq(q[0], q[1], r[0], r[1], p[0], p[1])); // CHANGE
    } // CHANGE
    return Math.sqrt(best); // CHANGE
} // CHANGE

for (const [moving, stationary] of [['bed', 'bed'], ['bed', 'structure'], ['structure', 'bed'], ['structure', 'structure']]) { // CHANGE
    for (const [angle, otherAngle] of [[0, 0], [35, 35], [0, -25], [27, -38], [90, 0]]) { // CHANGE
        test(`${moving} at ${angle} snaps to ${stationary} at ${otherAngle} with exact clearance and one undo`, t => { // CHANGE
            const f = setup(t), active = f.object(moving, 'moving', 550, 350, angle), other = f.object(stationary, 'stationary', 300, 350, otherAngle); // CHANGE
            const proposed = active.geometry.clone(); proposed.x -= 3; proposed.y += 2; // CHANGE
            const width = distance(f, active, other, proposed) - 6; f.preset(width); f.undo.clear(); // CHANGE
            const original = f.serialized(), evaluation = f.snap.evaluate(active, proposed); // CHANGE
            assert.equal(evaluation.candidates.filter(c => c.activeSnap).length, 1); // CHANGE
            close(Math.hypot(evaluation.dx, evaluation.dy), 6, 'smallest correction'); // CHANGE
            f.graph.moveCells([active], -3, 2, false, null, pointer); // CHANGE
            close(distance(f, active, other), width, 'actual outline clearance'); // CHANGE
            close(active.geometry.x, proposed.x + evaluation.dx); close(active.geometry.y, proposed.y + evaluation.dy); // CHANGE
            close(Number(f.graph.getCellStyle(active).rotation), angle); assert.equal(f.undo.history.length, 1); // CHANGE
            const saved = f.serialized(); f.undo.undo(); assert.equal(f.serialized(), original); f.undo.redo(); assert.equal(f.serialized(), saved); // CHANGE
        }); // CHANGE
    } // CHANGE
} // CHANGE

test('angled corner-to-corner snapping works in all four directions', t => { // CHANGE
    const f = setup(t), other = f.object('structure', 'other', 700, 500, -20); // CHANGE
    const active = f.object('structure', 'active', 350, 200, 25); // CHANGE
    for (const [x, y] of [[350, 200], [1050, 200], [350, 850], [1050, 850]]) { // CHANGE
        f.model.setGeometry(active, new f.w.mxGeometry(x, y, 120, 100)); // CHANGE
        const target = distance(f, active, other) - 5; f.preset(target); // CHANGE
        const evaluation = f.snap.evaluate(active); assert.ok(evaluation.candidates[0].segment); // CHANGE
        f.graph.moveCells([active], 0, 0, false, null, pointer); close(distance(f, active, other), target); // CHANGE
    } // CHANGE
}); // CHANGE

test('two-axis structure spacing retains legacy bands and competes with a smaller angled correction', t => { // CHANGE
    const f = setup(t), active = f.object('structure', 'active', 500, 500); // CHANGE
    f.object('bed', 'left', 300, 500); f.object('structure', 'above', 500, 300); f.preset(85); // CHANGE
    let evaluation = f.snap.evaluate(active); // CHANGE
    close(evaluation.dx, 5); close(evaluation.dy, -15); assert.equal(evaluation.candidates.filter(c => c.activeSnap).length, 2); // CHANGE
    const angled = f.object('bed', 'angled', 750, 500, 30), target = distance(f, active, angled) - 2; f.preset(target, 'medium'); // CHANGE
    evaluation = f.snap.evaluate(active); close(Math.hypot(evaluation.dx, evaluation.dy), 2); // CHANGE
    assert.equal(evaluation.candidates.filter(c => c.activeSnap).length, 1); assert.equal(evaluation.candidates.find(c => c.activeSnap).bed, angled); // CHANGE
}); // CHANGE

test('flips and redundant straight-side points stay eligible; irregular and malformed footprints are excluded', t => { // CHANGE
    const f = setup(t), active = f.object('structure', 'active', 550, 350, 30), other = f.object('bed', 'other', 300, 350); // CHANGE
    f.graph.setCellStyles('flipH', '1', [active]); f.graph.setCellStyles('flipV', '1', [active]); // CHANGE
    active.value.setAttribute('structure_footprint_json', JSON.stringify({ version: 1, points: [[0, 0], [0.5, 0], [1, 0], [1, 0.5], [1, 1], [0, 1]] })); // CHANGE
    const target = distance(f, active, other) - 6; f.preset(target); assert.ok(f.snap.evaluate(active).candidates.some(c => c.activeSnap)); // CHANGE
    const irregular = JSON.stringify({ version: 1, points: [[0, 0], [1, 0], [1, 1], [0.4, 0.6], [0, 1]] }); // CHANGE
    for (const data of [irregular, 'bad json', JSON.stringify({ version: 1, points: [[0, 0], [1, 0], [0, 1]] })]) { // CHANGE
        active.value.setAttribute('structure_footprint_json', data); // CHANGE
        assert.equal(f.snap.evaluate(active), null); assert.equal(f.snap.evaluate(other).candidates.some(c => c.bed === active), false); // CHANGE
        assert.equal(active.getAttribute('structure_footprint_json'), data); // CHANGE
    } // CHANGE
}); // CHANGE

test('disabled presets, tolerance boundaries, cap, overlap, and containment do not produce misleading snaps', t => { // CHANGE
    const f = setup(t), active = f.object('structure', 'active', 550, 350, 30), other = f.object('bed', 'other', 300, 350); // CHANGE
    assert.equal(f.snap.evaluate(active).candidates.length, 0); // CHANGE
    f.model.setGeometry(active, new f.w.mxGeometry(650, 350, 120, 100)); const cappedGap = distance(f, active, other); // CHANGE
    f.preset(cappedGap - 27); assert.ok(f.snap.evaluate(active).candidates.some(c => c.activeSnap)); // CHANGE
    f.preset(cappedGap - 27 + 1e-5); assert.ok(f.snap.evaluate(active).candidates.some(c => c.activeSnap)); // CHANGE
    f.preset(cappedGap - 27 - 1e-5); assert.equal(f.snap.evaluate(active).candidates.length, 0); // CHANGE
    f.model.setGeometry(active, new f.w.mxGeometry(550, 350, 120, 100)); const gap = distance(f, active, other); // CHANGE
    f.preset(gap / 1.25); assert.ok(f.snap.evaluate(active).candidates.some(c => c.activeSnap)); // CHANGE
    f.preset(gap / 1.25 + 1e-5); assert.ok(f.snap.evaluate(active).candidates.some(c => c.activeSnap)); // CHANGE
    f.preset(gap / 1.25 - 1e-5); assert.equal(f.snap.evaluate(active).candidates.length, 0); // CHANGE
    f.model.setGeometry(active, new f.w.mxGeometry(310, 350, 120, 100)); f.preset(54); assert.equal(f.snap.evaluate(active).candidates.length, 0); // CHANGE
    f.graph.setCellStyles('rotation', '0', [active]); f.model.setGeometry(active, new f.w.mxGeometry(420, 350, 120, 100)); // CHANGE
    assert.equal(f.snap.evaluate(active).candidates.length, 0); // CHANGE
    f.model.setGeometry(active, new f.w.mxGeometry(1455, 350, 120, 100)); f.graph.setCellStyles('rotation', '30', [active]); // CHANGE
    f.model.setGeometry(other, new f.w.mxGeometry(1200, 350, 120, 100)); f.preset(distance(f, active, other) + 25); // CHANGE
    assert.equal(f.snap.evaluate(active).candidates.filter(c => c.activeSnap).length, 0); // CHANGE
}); // CHANGE

test('equal corrections prefer smaller presets then stable neighbour IDs, independent of child order', t => { // CHANGE
    const f = setup(t), active = f.object('bed', 'active', 650, 350, 30); // CHANGE
    const a = f.object('bed', 'a', 400, 350, 30), b = f.object('bed', 'b', 900, 350, 30); // CHANGE
    const gap = distance(f, active, a); close(gap, distance(f, active, b)); // CHANGE
    f.preset(gap - 5); f.preset(gap + 5, 'medium'); // CHANGE
    const winner = () => f.snap.evaluate(active).candidates.find(c => c.activeSnap); // CHANGE
    close(winner().preset.target, gap - 5); assert.equal(winner().bed, a); // CHANGE
    f.model.add(f.garden, a); assert.equal(winner().bed, a); // CHANGE
}); // CHANGE

test('structure creation and resizing snap once, preserve dimensions, and rotation stays in place', t => { // CHANGE
    const f = setup(t); f.object('bed', 'other', 300, 350); f.preset(54); f.undo.clear(); // CHANGE
    const created = f.api.create(f.garden, { x: 670, y: 500 }); // CHANGE
    close(created.geometry.x, 474); assert.equal(f.undo.history.length, 1); f.undo.undo(); assert.equal(f.model.contains(created), false); f.undo.redo(); // CHANGE
    const resized = new f.w.mxRectangle(480, 350, 150, 90); f.undo.clear(); // CHANGE
    f.graph.resizeCells([created], [resized]); close(created.geometry.x, 474); close(created.geometry.width, 150); close(created.geometry.height, 90); // CHANGE
    assert.equal(f.undo.history.length, 1); f.undo.undo(); close(created.geometry.width, 180); f.undo.redo(); // CHANGE
    const x = created.geometry.x, y = created.geometry.y; f.graph.setCellStyles('rotation', '30', [created]); close(created.geometry.x, x); close(created.geometry.y, y); // CHANGE
}); // CHANGE

test('Alt, keyboard nudges, cloning, reparenting, and ordinary multiple selection bypass snapping', t => { // CHANGE
    const f = setup(t), active = f.object('structure', 'active', 550, 350, 30), other = f.object('bed', 'other', 300, 350); // CHANGE
    f.preset(distance(f, active, other) - 5); // CHANGE
    for (const event of [null, { altKey: true }]) { const before = active.geometry.clone(); f.graph.moveCells([active], 1, 0, false, null, event); close(active.geometry.x, before.x + 1); close(active.geometry.y, before.y); } // CHANGE
    const before = active.geometry.clone(), baseline = f.graph.moveCells([active], 1, 0, true, f.garden, { altKey: true }); // CHANGE
    const cloneGeometry = baseline[0].geometry.clone(); f.graph.removeCells(baseline); // CHANGE
    const clones = f.graph.moveCells([active], 1, 0, true, f.garden, pointer); // CHANGE
    close(clones[0].geometry.x, cloneGeometry.x); close(clones[0].geometry.y, cloneGeometry.y); f.graph.removeCells(clones); // CHANGE
    f.graph.moveCells([active, other], 1, 0, false, null, pointer); close(active.geometry.x, before.x + 1); // CHANGE
    const target = f.graph.insertVertex(null, 'second', f.value({ garden_module: '1' }), 0, 0, 1600, 1200); // CHANGE
    const x = active.geometry.x; f.graph.moveCells([active], 1, 0, false, target, pointer); assert.equal(active.parent, target); close(active.geometry.x, x + 101); // CHANGE: native reparenting preserves world coordinates.
}); // CHANGE

test('rotated bed contents follow the final clearance correction, including workspace-handle movement', t => { // CHANGE
    const f = setup(t), active = f.object('bed', 'active', 550, 350, 30, 200, 160), other = f.object('structure', 'other', 300, 350, -10); // CHANGE
    const crop = f.graph.insertVertex(f.garden, 'crop', f.value({ tiler_group: '1', bed_auto_fit: '0' }), 620, 410, 20, 20, 'locked=1;'); // CHANGE
    f.preset(distance(f, active, other) - 5); f.undo.clear(); const x = active.geometry.x, cx = crop.geometry.x; // CHANGE
    f.graph.moveCells([active], 0, 0, false, null, pointer); close(crop.geometry.x - cx, active.geometry.x - x); assert.equal(f.undo.history.length, 1); // CHANGE
    f.undo.undo(); f.graph.__trellisWorkspaceHandleDragActive = true; // CHANGE
    f.graph.moveCells([active, crop], 0, 0, false, f.garden, pointer); close(crop.geometry.x - cx, active.geometry.x - x); // CHANGE
}); // CHANGE

test('move and resize previews agree with commit under zoom and pan without writing the model', async t => { // CHANGE
    const f = setup(t), active = f.object('structure', 'active', 550, 350, 30), other = f.object('bed', 'other', 300, 350); // CHANGE
    f.preset(distance(f, active, other) - 6); f.graph.view.scaleAndTranslate(1.4, 20, 10); f.graph.panGraph(15, 7); f.graph.setSelectionCell(active); // CHANGE
    const original = f.serialized(), handler = f.graph.graphHandler, evaluation = f.snap.evaluate(active); // CHANGE
    handler.start(active, 700, 500, [active]); handler.currentDx = 0; handler.currentDy = 0; handler.updatePreview(); // CHANGE
    await new Promise(resolve => f.w.requestAnimationFrame(resolve)); // CHANGE
    assert.equal(f.serialized(), original); const wrapper = f.w.document.querySelector('[data-trellis-bed-transform-preview]'); assert.ok(wrapper); // CHANGE
    const translations = Array.from(wrapper.getAttribute('transform').matchAll(/translate\(([-\d.e]+)[ ,]([-\d.e]+)\)/g)); // CHANGE
    close(translations.reduce((sum, match) => sum + Number(match[1]), 0), evaluation.dx * 1.4); // CHANGE
    handler.reset(); assert.equal(f.w.document.querySelector('[data-trellis-bed-transform-preview]'), null); // CHANGE
    const resize = f.graph.selectionCellsHandler.getHandler(active); resize.index = 7; resize.unscaledBounds = new f.w.mxRectangle(550, 350, 130, 90); // CHANGE
    resize.bounds = new f.w.mxRectangle(0, 0, 182, 126); const expected = f.snap.evaluate(active, resize.unscaledBounds); // CHANGE
    f.snap.previewResize(resize); close(resize.unscaledBounds.x, 550 + expected.dx); close(resize.unscaledBounds.y, 350 + expected.dy); // CHANGE
    assert.equal(f.serialized(), original); const bounds = resize.unscaledBounds.clone(); resize.reset(); // CHANGE
    f.graph.resizeCells([active], [bounds]); close(active.geometry.x, bounds.x); close(active.geometry.y, bounds.y); close(active.geometry.width, 130); // CHANGE
}); // CHANGE

test('exact clearances create no numerical edits, locked objects reject apply, and geometry survives reopening', t => { // CHANGE
    const f = setup(t), active = f.object('structure', 'active', 550, 350, 33), other = f.object('bed', 'other', 300, 350, -17); // CHANGE
    f.preset(distance(f, active, other)); f.undo.clear(); const original = f.serialized(); // CHANGE
    assert.equal(f.snap.evaluate(active).dx, 0); assert.equal(f.snap.evaluate(active).dy, 0); // CHANGE
    f.snap.applyNoTxn(active); f.graph.moveCells([active], 0, 0, false, null, pointer); // CHANGE
    assert.equal(f.undo.history.length, 0); assert.equal(f.serialized(), original); // CHANGE
    f.preset(distance(f, active, other) - 5); const isCellLocked = f.graph.isCellLocked; f.graph.isCellLocked = cell => cell === active || isCellLocked.call(f.graph, cell); f.undo.clear(); // CHANGE: this mxGraph-only fixture supplies the editor's lock policy.
    assert.equal(f.snap.applyNoTxn(active), null); assert.equal(f.undo.history.length, 0); f.graph.isCellLocked = isCellLocked; // CHANGE
    const expected = f.snap.evaluate(active), xml = new f.w.mxCodec().encode(f.model); // CHANGE
    new f.w.mxCodec(xml.ownerDocument).decode(xml, f.model); // CHANGE
    const reopened = f.model.getCell(active.id), actual = f.snap.evaluate(reopened); close(actual.dx, expected.dx); close(actual.dy, expected.dy); // CHANGE
    assert.equal(reopened.getAttribute('structure_footprint_json'), active.getAttribute('structure_footprint_json')); // CHANGE
}); // CHANGE

test('production module containment accepts the evaluated clearance and rejects an out-of-garden correction', t => { // CHANGE
    const f = setup(t, { plugins: ['Modules_Standalone.js'] }), active = f.object('structure', 'active', 1455, 350, 30), other = f.object('bed', 'other', 1200, 350); // CHANGE
    const gap = distance(f, active, other); f.preset(gap + 25); f.undo.clear(); const before = active.geometry.clone(); // CHANGE
    f.graph.moveCells([active], 0, 0, false, null, pointer); close(active.geometry.x, before.x); assert.equal(f.undo.history.length, 0); // CHANGE
    f.preset(gap - 10); f.graph.moveCells([active], 0, 0, false, null, pointer); close(distance(f, active, other), gap - 10); // CHANGE
    assert.equal(f.undo.history.length, 1); // CHANGE
}); // CHANGE

test('angled guides use nested garden coordinates under zoom and pan, and hide for Alt or clone gestures', async t => { // CHANGE
    const f = setup(t), active = f.object('structure', 'active', 550, 350, 30), other = f.object('bed', 'other', 300, 350); // CHANGE
    const outer = f.graph.insertVertex(null, 'outer', f.value({ label: 'Outer' }), 250, 150, 2000, 1600); f.model.add(outer, f.garden); // CHANGE
    f.preset(distance(f, active, other) - 5); f.graph.view.scaleAndTranslate(1.5, 30, -5); f.graph.panGraph(12, 8); f.graph.setSelectionCell(active); // CHANGE
    const handler = f.graph.graphHandler; handler.start(active, 700, 500, [active]); handler.currentDx = 0; handler.currentDy = 0; f.graph.isMouseDown = true; f.graph.isMouseTrigger = true; // CHANGE
    handler.suspended = true; // CHANGE: freeze native movement while dispatching distinct pointer/modifier snapshots to the guide listener.
    const move = (altKey = false) => { // CHANGE
        const raw = new f.w.MouseEvent('mousemove', { clientX: 700, clientY: 500, altKey }); Object.defineProperty(raw, 'target', { value: f.graph.container }); // CHANGE
        f.graph.fireMouseEvent(f.w.mxEvent.MOUSE_MOVE, new f.w.mxMouseEvent(raw, f.graph.view.getState(active))); // CHANGE
    }; // CHANGE
    move(); await f.tick(); // CHANGE
    const candidate = f.snap.evaluate(active).candidates.find(c => c.activeSnap), line = f.w.document.querySelector('.trellis-path-snap-segment'), gardenState = f.graph.view.getState(f.garden); // CHANGE
    assert.ok(line); close(parseFloat(line.style.left), gardenState.x + candidate.segment.from.x * 1.5 + 12); // CHANGE
    close(parseFloat(line.style.top), gardenState.y + candidate.segment.from.y * 1.5 + 8); // CHANGE
    handler.cloning = true; move(); await f.tick(); assert.equal(f.w.document.querySelector('.trellis-path-snap-overlay').style.display, 'none'); // CHANGE
    handler.cloning = false; move(true); await f.tick(); assert.equal(f.w.document.querySelector('.trellis-path-snap-overlay')?.style.display, 'none'); // CHANGE
    f.graph.isMouseDown = false; handler.reset(); // CHANGE
    f.w.dispatchEvent(new f.w.KeyboardEvent('keyup', { key: 'Alt', altKey: false })); // CHANGE
    assert.equal(f.snap.applyNoTxn(active)?.applied, true, 'Alt release restores snapping without another pointer movement'); // CHANGE
}); // CHANGE
