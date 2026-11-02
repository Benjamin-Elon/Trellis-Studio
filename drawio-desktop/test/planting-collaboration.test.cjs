/** Native collaboration regressions: one planting identity across children, drafts and deletion. */ // CHANGE
const test = require('node:test'); // CHANGE
const assert = require('node:assert/strict'); // CHANGE
const fs = require('node:fs'), path = require('node:path'); // CHANGE
const { fixture } = require('./helpers/managed-editing-harness.cjs'); // CHANGE

async function plantingFixture(t) { // CHANGE
    const h = await fixture(t), { graph, w } = h; // CHANGE
    const group = h.vertex('crop', null, { tiler_group: '1', label: 'Crop group' }); // CHANGE
    const circles = []; graph.model.beginUpdate(); // CHANGE
    try { for (let i = 0; i < 4; i++) { const value = w.mxUtils.createXmlDocument().createElement('object'); value.setAttribute('plant_tiler', '1'); circles.push(graph.insertVertex(group, 'circle-' + i, value, 10 + i * 25, 25, 20, 20, 'ellipse;')); } } // CHANGE
    finally { graph.model.endUpdate(); } // CHANGE
    await h.settle(); await h.save(); await h.settle(); h.activityCalls.length = 0; // CHANGE
    return { ...h, group, circles }; // CHANGE
} // CHANGE

test('selecting planting children reports one group view without claiming a hold', async t => { // CHANGE
    const h = await plantingFixture(t); h.graph.setSelectionCells(h.circles); await h.settle(); // CHANGE
    const view = h.activityCalls.find(call => call.kind === 'view'); assert.ok(view); assert.deepEqual(Array.from(view.objects), [h.key(h.group)]); // CHANGE
    assert.equal(h.activityCalls.some(call => call.kind === 'claim'), false); // CHANGE
    h.observe({ presence: [{ userId: 'bob', name: 'Bob', sessionId: 'remote', deviceId: 'peer', targets: h.circles.map(h.key) }] }); // CHANGE
    assert.deepEqual(h.badges().map(badge => badge.key), [h.key(h.group)]); assert.equal(h.badges()[0].text.match(/Bob · viewing/g).length, 1); // CHANGE
}); // CHANGE

test('circle edits retain the group hold across sibling navigation and successful saves, then release on leaving', async t => { // CHANGE
    const h = await plantingFixture(t), key = h.key(h.group), [a, b] = h.circles; // CHANGE
    h.graph.setSelectionCell(a); h.graph.moveCells([a], 2, 1); await h.settle(); // CHANGE
    assert.deepEqual(Array.from(h.activityCalls.find(call => call.kind === 'claim').targets), [key]); assert.ok(h.held.has(key)); // CHANGE
    h.activityCalls.length = 0; h.graph.setSelectionCell(b); await h.settle(); await h.save(); await h.settle(); // CHANGE
    assert.ok(h.held.has(key)); assert.equal(h.activityCalls.some(call => call.kind === 'release'), false); // CHANGE
    h.graph.clearSelection(); await h.settle(); assert.equal(h.held.has(key), false); assert.deepEqual(h.errors, []); // CHANGE
}); // CHANGE

test('deleting a detached circle claims its former planting and Undo/Redo never claims the orphan', async t => { // CHANGE
    const h = await plantingFixture(t), tile = h.circles[0], key = h.key(h.group); // CHANGE
    h.graph.removeCells([tile]); await h.settle(); // CHANGE
    assert.equal(tile.parent, null); assert.deepEqual(Array.from(h.activityCalls.find(call => call.kind === 'claim').targets), [key]); // CHANGE
    assert.equal(h.held.has(h.key(tile)), false); assert.ok(h.held.has(key)); // CHANGE
    h.undo.undo(); await h.settle(); assert.equal(tile.parent, h.group); h.undo.redo(); await h.settle(); assert.equal(tile.parent, null); // CHANGE
    assert.ok(h.activityCalls.filter(call => call.kind === 'claim').every(call => !call.targets.includes(h.key(tile)))); assert.deepEqual(h.errors, []); // CHANGE
}); // CHANGE

test('a registered child editor claims and pins its group identity', async t => { // CHANGE
    const h = await plantingFixture(t), panel = h.w.document.createElement('section'); h.w.document.body.append(panel); // CHANGE
    const editor = h.w.Trellis.sharing.registerEditor({ kind: 'details', targets: [h.key(h.circles[0])], element: panel, capture: () => ({ notes: 'Unapplied draft' }), save: async () => true, discard() {} }); // CHANGE
    await editor.acquire(); assert.ok(h.held.has(h.key(h.group))); assert.equal(h.held.has(h.key(h.circles[0])), false); // CHANGE
    assert.deepEqual(Array.from(h.w.Trellis.sharing.activeEditorTargets()), [h.key(h.group)]); // CHANGE
    await editor.dispose(); await h.settle(); assert.deepEqual(h.errors, []); // CHANGE
}); // CHANGE

test('received child holds and failures share a group badge while release requests keep the signed child target', async t => { // CHANGE
    const h = await plantingFixture(t), first = h.key(h.circles[0]), second = h.key(h.circles[1]); // CHANGE
    h.observe({ holds: [{ key: first, claimId: 'remote-child', userId: 'bob', name: 'Bob', sessionId: 'remote', deviceId: 'peer' }], presence: [{ userId: 'bob', name: 'Bob', sessionId: 'remote', deviceId: 'peer', targets: [first, second] }], pendingChanges: [{ userId: 'carol', name: 'Carol', sessionId: 'failed', deviceId: 'other', online: false, saveState: 'failed', targets: [second] }] }); // CHANGE
    assert.equal(h.badges().length, 1); assert.equal(h.badges()[0].key, h.key(h.group)); assert.match(h.badges()[0].text, /Bob · editing/); assert.match(h.badges()[0].text, /Carol · save failed/); assert.doesNotMatch(h.badges()[0].text, /Bob · viewing/); // CHANGE
    h.w.document.querySelector('[data-object-key]').click(); const request = [...h.w.document.querySelectorAll('button')].find(button => button.textContent === 'Request release'); assert.ok(request); request.click(); await h.settle(); // CHANGE
    assert.deepEqual(Array.from(h.activityCalls.find(call => call.kind === 'request').targets), [first]); // CHANGE
}); // CHANGE

test('automatic child changes do not claim activity and failed saves retain a selected planting hold', async t => { // CHANGE
    const h = await plantingFixture(t), tile = h.circles[0], key = h.key(h.group); // CHANGE
    h.graph.__trellisEditContext.scope('generated-content', () => h.graph.moveCells([tile], 1, 0)); await h.settle(); // CHANGE
    assert.equal(h.activityCalls.some(call => call.kind === 'claim'), false); await h.save(); await h.settle(); // CHANGE
    h.graph.setSelectionCell(tile); h.graph.moveCells([tile], 1, 0); await h.settle(); assert.ok(h.held.has(key)); // CHANGE
    h.failSave(true); await assert.rejects(h.save(), /Temporary save failure/); assert.ok(h.held.has(key)); assert.equal(h.file.isModified(), true); // CHANGE
    h.failSave(false); await h.save(); h.graph.clearSelection(); await h.settle(); assert.equal(h.held.has(key), false); // CHANGE
}); // CHANGE

test('Undo to the saved circle state clears group pending status and Redo restores it', async t => { // CHANGE
    const h = await plantingFixture(t), tile = h.circles[0]; h.graph.setSelectionCell(tile); h.graph.moveCells([tile], 2, 1); await h.settle(); // CHANGE
    assert.ok(h.badges().some(badge => badge.key === h.key(h.group) && badge.text.includes('pending project save'))); // CHANGE
    h.undo.undo(); await h.settle(); assert.equal(h.file.isModified(), false); assert.equal(h.badges().some(badge => badge.text.includes('pending project save')), false); // CHANGE
    h.undo.redo(); await h.settle(); assert.equal(h.file.isModified(), true); assert.ok(h.badges().some(badge => badge.text.includes('pending project save'))); // CHANGE
}); // CHANGE

test('page identity and independent objects survive planting activity aggregation', async t => { // CHANGE
    const h = await plantingFixture(t), tool = h.vertex('tool', null, { label: 'Independent tool' }); await h.settle(); await h.save(); await h.settle(); // CHANGE
    const otherRoot = new h.w.mxCell(), otherGroup = new h.w.mxCell(h.group.value.cloneNode(true)); otherGroup.id = h.group.id; otherRoot.insert(otherGroup); // CHANGE
    const otherCircle = new h.w.mxCell(h.circles[0].value.cloneNode(true)); otherCircle.id = h.circles[0].id; otherGroup.insert(otherCircle); // CHANGE
    const currentPage = h.ui.currentPage?.getId?.() || ''; h.ui.pages = [{ getId: () => currentPage, root: h.graph.model.getRoot() }, { getId: () => 'other-page', root: otherRoot }]; // CHANGE
    const otherKey = JSON.stringify(['other-page', String(otherCircle.id)]), missingKey = JSON.stringify(['missing-page', String(otherCircle.id)]); // CHANGE
    h.observe({ presence: [{ userId: 'bob', name: 'Bob', deviceId: 'peer', sessionId: 'remote', targets: [h.key(h.circles[0]), h.key(tool), otherKey, missingKey] }] }); // CHANGE
    assert.deepEqual(h.badges().map(badge => badge.key).sort(), [h.key(h.group), h.key(tool)].sort()); // CHANGE
    h.bridge.listRequests = async () => ({ members: [], requests: [] }); await h.w.Trellis.sharing.showSharingDialog(); await h.settle(); // CHANGE
    const descriptions = [...h.w.document.querySelectorAll('[data-activity-description]')].map(node => node.textContent); // CHANGE
    assert.ok(descriptions.some(text => /other page/.test(text) || /circle-0/.test(text)), 'unavailable page activity remains in the overview'); // CHANGE
}); // CHANGE

test('live preview redraws and cancellation produce no pending work or holds; release claims the group normally', async t => { // CHANGE
    const h = await plantingFixture(t), { graph, w } = h, tile = h.circles[0]; // CHANGE
    w.eval(fs.readFileSync(path.join(__dirname, '../drawio/src/main/webapp/plugins/garden_planner_plugins/Planting_Group.js'), 'utf8')); await h.settle(); await h.save(); // CHANGE
    graph.getCompositeParent = cell => cell; const handler = graph.graphHandler; handler.maxLivePreview = 32; handler.allowLivePreview = true; graph.setSelectionCell(tile); await h.settle(); // CHANGE
    const baseline = h.ui.getFileData(), history = h.undo.history.length; h.activityCalls.length = 0; // CHANGE
    const start = () => { const state = graph.view.getState(tile); graph.isMouseDown = true; handler.start(tile, state.getCenterX(), state.getCenterY(), [tile]); handler.currentDx = 10; handler.currentDy = 5; handler.checkPreview(); handler.updatePreview(); assert.equal(handler.livePreviewUsed, true); }; // CHANGE
    start(); graph.__trellisPlantingGroup.growth.setShowHarvestSize(null, true); graph.__trellisPlantingGroup.growth.refresh(); graph.view.revalidate(); graph.refresh(); await h.settle(); // CHANGE
    w.dispatchEvent(new w.Event('pointercancel')); await h.settle(); // CHANGE
    assert.equal(h.ui.getFileData(), baseline); assert.equal(h.file.isModified(), false); assert.equal(h.undo.history.length, history); assert.equal(h.activityCalls.some(call => call.kind === 'claim'), false); assert.equal(h.badges().some(badge => badge.text.includes('pending project save')), false); // CHANGE
    start(); handler.mouseUp(graph, { isConsumed: () => false, getCell: () => null, getEvent: () => ({ type: 'mouseup', clientX: 200, clientY: 200 }), consume() {} }); await h.settle(); // CHANGE
    assert.ok(h.activityCalls.some(call => call.kind === 'claim' && call.targets.includes(h.key(h.group)))); assert.equal(h.held.has(h.key(tile)), false); assert.equal(h.file.isModified(), true); assert.deepEqual(h.errors, []); // CHANGE
}); // CHANGE
