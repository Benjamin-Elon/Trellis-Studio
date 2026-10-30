const assert = require('node:assert/strict'); // NEW
const test = require('node:test'); // NEW
const { fixture, read } = require('./helpers/garden-structures-harness.cjs'); // NEW

/** Dispatch through rendered native shapes so selection and mouse-listener ordering match the editor. */ // NEW
function mouse(f, cell, type, options = {}, target) { // NEW
    const state = f.graph.view.getState(cell); // NEW
    (target || state.shape.node).dispatchEvent(new f.w.MouseEvent(type, { bubbles: true, clientX: state.x + state.width / 2, clientY: state.y + state.height / 2, ...options })); // NEW
} // NEW
const shown = f => f.w.document.querySelector('.trellis-structure-overlay')?.style.display === 'flex'; // NEW
async function click(f, cell, options) { mouse(f, cell, 'mousedown', options); mouse(f, cell, 'mouseup', options); await f.tick(); } // NEW
function changeDraft(f) { const p = f.api.getDraft().points[0]; assert.equal(f.api.moveCorner(0, [p[0] + 20, p[1] + 10]), true); } // NEW
const historyOptions = { history: true, plugins: ['Planting_Group.js'] }; // NEW

test('name input isolates garden-style events without preventing normal input defaults', async t => { // NEW
    const f = fixture(t, { editorFocus: true }), cell = f.api.create(f.garden); await f.tick(); // NEW
    const input = f.w.document.querySelector('[aria-label="Structure name"]'), reached = []; // NEW
    const types = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'keydown', 'keypress', 'keyup']; // NEW
    for (const type of types) f.graph.container.addEventListener(type, () => reached.push(type)); // NEW
    input.focus(); input.value = 'Tool shed'; input.setSelectionRange(2, 5); // NEW
    for (const type of types) { // NEW
        const event = type.startsWith('key') ? new f.w.KeyboardEvent(type, { key: 'a', bubbles: true, cancelable: true }) : new f.w.MouseEvent(type, { bubbles: true, cancelable: true }); // NEW
        input.dispatchEvent(event); assert.equal(event.defaultPrevented, false, type + ' retains its default'); // NEW
    } // NEW
    assert.equal(f.w.document.activeElement, input); assert.deepEqual(reached, []); assert.equal(input.selectionStart, 2); assert.equal(input.selectionEnd, 5); // NEW
    f.graph.view.setScale(1.1); await f.tick(); assert.equal(f.w.document.activeElement, input); assert.equal(input.value, 'Tool shed'); // NEW
    input.blur(); assert.equal(cell.getAttribute('label'), 'Tool shed'); // NEW
}); // NEW

test('first selection shows the panel, repeat clicks toggle, and dismissal survives refreshes until selection changes', async t => { // NEW
    const f = fixture(t), cell = f.api.create(f.garden); f.graph.clearSelection(); await f.tick(); // NEW
    await click(f, cell); assert.equal(shown(f), true); assert.equal(f.graph.getSelectionCell(), cell); // NEW
    const before = f.serialized(); await click(f, cell); assert.equal(shown(f), false); // NEW
    f.graph.view.setScale(1.1); f.graph.view.setTranslate(10, 5); f.graph.panGraph(5, 5); f.graph.refresh(cell); await f.tick(); assert.equal(shown(f), false); // NEW
    f.graph.view.setScale(1); f.graph.view.setTranslate(0, 0); f.graph.panGraph(0, 0); await f.tick(); // NEW
    assert.equal(f.serialized(), before); await click(f, cell); assert.equal(shown(f), true); // NEW
    await click(f, cell); const geometry = cell.geometry.clone(); geometry.x += 10; f.model.setGeometry(cell, geometry); await f.tick(); assert.equal(shown(f), false); await click(f, cell); // NEW
    await click(f, cell); assert.equal(shown(f), false); f.graph.setSelectionCell(f.garden); f.graph.setSelectionCell(cell); await f.tick(); assert.equal(shown(f), true); // NEW
}); // NEW

test('drag thresholds, final release distance and selection round-trips cannot toggle panels', async t => { // NEW
    const f = fixture(t), cell = f.api.create(f.garden); await f.tick(); const state = f.graph.view.getState(cell), x = state.x + state.width / 2, y = state.y + state.height / 2; // NEW
    mouse(f, cell, 'mousedown'); mouse(f, cell, 'mousemove', { clientX: x + 3, clientY: y }); mouse(f, cell, 'mouseup', { clientX: x + 3, clientY: y }); await f.tick(); assert.equal(shown(f), false); // NEW
    await click(f, cell); // NEW
    mouse(f, cell, 'mousedown'); mouse(f, cell, 'mousemove', { clientX: x + 4, clientY: y }); mouse(f, cell, 'mousemove'); mouse(f, cell, 'mouseup'); await f.tick(); assert.equal(shown(f), true); // NEW
    mouse(f, cell, 'mousedown'); mouse(f, cell, 'mouseup', { clientX: x + 4, clientY: y }); await f.tick(); assert.equal(shown(f), true); // NEW
    mouse(f, cell, 'mousedown'); f.graph.setSelectionCell(f.garden); f.graph.setSelectionCell(cell); mouse(f, cell, 'mouseup'); await f.tick(); assert.equal(shown(f), true); // NEW
}); // NEW

test('modifiers, alternate buttons, double-click presses, controls and native handles do not toggle', async t => { // NEW
    const f = fixture(t), cell = f.api.create(f.garden); await f.tick(); // NEW
    for (const options of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }, { button: 2 }, { detail: 2 }]) { // NEW
        await click(f, cell, options); f.graph.setSelectionCell(cell); await f.tick(); assert.equal(shown(f), true, JSON.stringify(options)); // NEW
    } // NEW
    mouse(f, cell, 'mousedown'); mouse(f, cell, 'mouseup', { ctrlKey: true }); f.graph.setSelectionCell(cell); await f.tick(); assert.equal(shown(f), true); // CHANGE: native Control release can change selection; it must not create manual dismissal.
    const input = f.w.document.querySelector('[aria-label="Structure name"]'); mouse(f, cell, 'mousedown', {}, input); mouse(f, cell, 'mouseup', {}, input); await f.tick(); assert.equal(shown(f), true); // NEW
    const handle = f.graph.selectionCellsHandler.getHandler(cell).sizers[0], point = { clientX: handle.bounds.getCenterX(), clientY: handle.bounds.getCenterY() }; // NEW
    mouse(f, cell, 'mousedown', point, handle.node); mouse(f, cell, 'mouseup', point, handle.node); await f.tick(); assert.equal(shown(f), true); // NEW
}); // NEW

test('outside release, cancellation and blur invalidate pending clicks; footprint editing keeps controls visible', async t => { // NEW
    const f = fixture(t), cell = f.api.create(f.garden); await f.tick(); // NEW
    for (const event of ['mouseup', 'pointerup', 'pointercancel', 'blur']) { // NEW
        mouse(f, cell, 'mousedown'); f.w.dispatchEvent(new f.w.Event(event)); mouse(f, cell, 'mouseup'); await f.tick(); assert.equal(shown(f), true, event); // NEW
    } // NEW
    mouse(f, cell, 'mousedown'); f.w.document.body.dispatchEvent(new f.w.MouseEvent('mouseup', { bubbles: true })); mouse(f, cell, 'mouseup'); await f.tick(); assert.equal(shown(f), true); // NEW
    await f.api.editFootprint(cell); await click(f, cell); assert.equal(shown(f), true); assert.match(f.w.document.querySelector('.trellis-structure-overlay').textContent, /DoneCancel/); await f.api.cancel(); // NEW
}); // NEW

for (const direction of ['undo', 'redo']) test(`${direction} closes unchanged footprint editors with empty stacks and refreshes action availability`, async t => { // NEW
    const f = fixture(t, historyOptions), cell = f.api.create(f.garden); f.undo.clear(); await f.api.editFootprint(cell); // NEW
    assert.equal(f.ui.canUndo(), true); assert.equal(f.ui.canRedo(), true); assert.equal(f.ui.actions.get(direction).isEnabled(), true); // NEW
    const before = f.serialized(); f.ui.actions.get(direction).funct(); // NEW
    assert.equal(f.api.getDraft(), null); assert.equal(f.serialized(), before); assert.equal(f.undo.history.length, 0); assert.equal(f.ui.canUndo(), false); assert.equal(f.ui.canRedo(), false); // NEW
    assert.equal(f.graph.__trellisPlantingPreviewDrafts.has('structure-footprint'), false); // NEW
}); // NEW

for (const direction of ['undo', 'redo']) test(`${direction} asks before dismissing changed drafts and consumes repeated commands without moving history`, async t => { // NEW
    const f = fixture(t, historyOptions), cell = f.api.create(f.garden); // NEW
    if (direction === 'redo') { f.model.setStyle(cell, cell.style + 'fillColor=#ffff00;'); f.undo.undo(); } // NEW
    await f.api.editFootprint(cell); changeDraft(f); const before = f.serialized(), index = f.undo.indexOfNextAdd; // NEW
    f.ui[direction](); f.undo[direction](); f.ui.actions.get(direction).funct(); assert.equal(f.w.document.querySelectorAll('.trellis-structure-discard').length, 1); // NEW
    f.choose('Keep Editing'); await f.tick(); assert.ok(f.api.getDraft()); assert.equal(f.serialized(), before); assert.equal(f.undo.indexOfNextAdd, index); assert.equal(f.graph.getSelectionCell(), cell); // NEW
    f.undo[direction](); f.choose('Discard Changes'); await f.tick(); assert.equal(f.api.getDraft(), null); assert.equal(f.serialized(), before); assert.equal(f.undo.indexOfNextAdd, index); // NEW
    f.ui.actions.get(direction).funct(); assert.equal(f.undo.indexOfNextAdd, index + (direction === 'undo' ? -1 : 1)); // NEW
}); // NEW

test('guard rejection preserves every transient owner and stale approval cannot discard a replacement owner', async t => { // NEW
    const f = fixture(t, historyOptions), cell = f.api.create(f.garden); await f.api.editFootprint(cell); changeDraft(f); // NEW
    let discarded = 0, active = true; const owners = f.graph.__trellisPlantingPreviewDrafts; owners.set('other', { isActive: () => active, discard: () => { discarded++; active = false; } }); // NEW
    f.undo.undo(); f.choose('Keep Editing'); await f.tick(); assert.equal(discarded, 0); assert.ok(f.api.getDraft()); // NEW
    f.undo.redo(); const old = owners.get('structure-footprint'); owners.set('structure-footprint', { isActive: () => true, discard: () => { discarded++; } }); // NEW
    f.choose('Discard Changes'); await f.tick(); assert.equal(discarded, 0); assert.ok(f.api.getDraft()); // NEW
    owners.set('structure-footprint', old); owners.delete('other'); const cancel = f.api.cancel(); f.choose('Discard Changes'); await cancel; // CHANGE
}); // NEW

test('all discard approvals complete before any transient owner is discarded', async t => { // NEW
    const f = fixture(t, historyOptions), cell = f.api.create(f.garden); await f.api.editFootprint(cell); changeDraft(f); // NEW
    let approveOther, otherActive = true, discarded = 0; const owners = f.graph.__trellisPlantingPreviewDrafts, index = f.undo.indexOfNextAdd; // NEW
    owners.set('other', { isActive: () => otherActive, beforeDiscard: () => new Promise(resolve => { approveOther = resolve; }), discard: () => { otherActive = false; discarded++; } }); // NEW
    f.undo.undo(); f.choose('Discard Changes'); await f.tick(); assert.ok(approveOther); assert.equal(discarded, 0); assert.ok(f.api.getDraft()); // NEW
    approveOther(false); await f.tick(); assert.equal(discarded, 0); assert.ok(f.api.getDraft()); assert.equal(f.undo.indexOfNextAdd, index); // NEW
    f.undo.redo(); f.choose('Discard Changes'); await f.tick(); approveOther(true); await f.tick(); assert.equal(discarded, 1); assert.equal(f.api.getDraft(), null); assert.equal(f.undo.indexOfNextAdd, index); // NEW
}); // NEW

test('history owner registration survives plugin reload and is removed by graph destruction', async t => { // NEW
    const f = fixture(t, historyOptions), cell = f.api.create(f.garden); await f.api.editFootprint(cell); const undo = f.undo.undo; // NEW
    f.w.eval(read('plugins/garden_planner_plugins/Garden_Structures.js')); assert.equal(f.undo.undo, undo); // NEW
    const owners = f.graph.__trellisPlantingPreviewDrafts; assert.equal(owners.has('structure-footprint'), true); // NEW
    f.graph.destroy(); assert.equal(owners.has('structure-footprint'), false); // NEW
}); // NEW
