/** Native graph regressions for shared editor commits, capture barriers and independent defaults. */ // CHANGE
const test = require('node:test'), assert = require('node:assert/strict'); // CHANGE
const { loadPlantTilerMxGraph } = require('./helpers/plant-tiler-mxgraph-harness.cjs'); // CHANGE
function fixture(t) { // CHANGE
    const h = loadPlantTilerMxGraph(); t.after(h.close); // CHANGE
    const context = h.window.TrellisEditContext.install(h.ui), cell = h.bed(150, 300); h.undoManager.clear(); // CHANGE
    const write = (target, value) => h.graph.model.execute(new h.window.mxCellAttributeChange(target, 'label', value)); // CHANGE
    return { ...h, context, cell, write }; // CHANGE
} // CHANGE
test('nested graph commands and finalization compensate completely while preserving Redo', t => { // CHANGE
    const h = fixture(t); h.write(h.cell, 'earlier'); h.undoManager.undo(); const history = h.undoManager.history.slice(), index = h.undoManager.indexOfNextAdd; // CHANGE
    assert.throws(() => h.context.apply({ cells: [h.cell], finalize() { h.context.apply({ cells: [h.cell] }, () => h.write(h.cell, 'finalizer')); throw new Error('render failed'); } }, () => { h.write(h.cell, 'outer'); h.context.apply({ cells: [h.cell] }, () => h.write(h.cell, 'inner')); }), /render failed/); // CHANGE
    assert.equal(h.cell.getAttribute('label'), 'Bed'); assert.deepEqual(h.undoManager.history, history); assert.equal(h.undoManager.indexOfNextAdd, index); // CHANGE
    h.undoManager.redo(); assert.equal(h.cell.getAttribute('label'), 'earlier'); // CHANGE
}); // CHANGE
test('save and recovery waiters see only compensated content', async t => { // CHANGE
    const h = fixture(t), captures = []; let save, checkpoint; // CHANGE
    assert.throws(() => h.context.apply({ cells: [h.cell], finalize() { save = h.context.whenSettled().then(() => captures.push(h.cell.getAttribute('label'))); checkpoint = h.context.whenSettled().then(() => captures.push(h.cell.getAttribute('label'))); assert.throws(h.context.assertCapturable, /Finish applying/); throw new Error('overlay failed'); } }, () => h.write(h.cell, 'provisional')), /overlay failed/); // CHANGE
    await Promise.all([save, checkpoint]); assert.deepEqual(captures, ['Bed', 'Bed']); // CHANGE
}); // CHANGE
test('preparation is coalesced and stale source versions cannot apply', async t => { // CHANGE
    const h = fixture(t); let release, prepared, applications = 0; // CHANGE
    const started = new Promise(resolve => { prepared = resolve; }); // CHANGE
    const options = { id: 'same-editor', cells: [h.cell], prepare: async () => { prepared(); await new Promise(resolve => { release = resolve; }); return { cells: [h.cell], apply() { applications++; h.write(h.cell, 'prepared'); } }; } }; // CHANGE
    const first = h.context.commit(options), second = h.context.commit(options); assert.equal(first, second); await started; h.write(h.cell, 'newer'); release(); // CHANGE
    const result = await first; assert.equal(result.status, 'stale'); assert.equal(applications, 0); assert.equal(h.cell.getAttribute('label'), 'newer'); // CHANGE
}); // CHANGE
test('nested generated blockers reject the whole action without deferred retries', t => { // CHANGE
    const h = fixture(t), other = h.bed(120, 200); let blocked = false; // CHANGE
    h.graph.__trellisSharing = { automationHolds: () => blocked ? [{ key: JSON.stringify(['', String(other.id)]), sessionId: 'peer' }] : [] }; // CHANGE
    assert.throws(() => h.context.apply({ cells: [h.cell] }, () => { h.write(h.cell, 'partial'); blocked = true; h.context.run('generated-content', { cells: () => [other], id: 'nested', deferredValue: [] }, () => h.write(other, 'wrong')); }), error => error.code === 'TRELLIS_EDIT_BLOCKED'); // CHANGE
    assert.equal(h.cell.getAttribute('label'), 'Bed'); assert.equal(h.context.deferred.size, 0); // CHANGE
}); // CHANGE
test('native permission rejection is an explicit rejected outcome', async t => { // CHANGE
    const h = fixture(t); h.graph.model.addListener(h.window.mxEvent.CHANGE, (_sender, event) => { const edit = event.getProperty('edit'); if (!edit.undone && !edit.__trellisUsersRejected) { edit.__trellisUsersRejected = true; edit.__trellisUsersRejectedReason = 'Access revoked'; edit.undo(); } }); // CHANGE
    const result = await h.context.commit({ cells: [h.cell], prepare: async () => ({ apply: () => h.write(h.cell, 'forbidden') }) }); // CHANGE
    assert.equal(result.status, 'rejected'); assert.match(result.reason, /Access revoked/); assert.equal(h.cell.getAttribute('label'), 'Bed'); assert.equal(h.undoManager.history.length, 0); // CHANGE
}); // CHANGE
test('failed rollback blocks later captures and freezes its recoverable editor', async t => { // CHANGE
    const h = fixture(t); let frozen = false; const refresh = h.graph.refresh; h.graph.refresh = () => { throw new Error('renderer broken'); }; // CHANGE
    assert.throws(() => h.context.apply({ cells: [h.cell], editor: { freeze() { frozen = true; } }, finalize() { throw new Error('finalize'); } }, () => h.write(h.cell, 'draft')), /finalize/); // CHANGE
    assert.equal(frozen, true); await assert.rejects(h.context.whenSettled(), /Saving is blocked/); assert.throws(h.context.assertCapturable, /Saving is blocked/); h.graph.refresh = refresh; // CHANGE
}); // CHANGE
test('default retries repeat only failed writes and never the canvas application', async t => { // CHANGE
    const h = fixture(t); let first = 0, second = 0, fail = true; h.context.apply({ cells: [h.cell] }, () => h.write(h.cell, 'applied')); // CHANGE
    const result = await h.context.saveDefaults({ id: 'defaults', tasks: [{ name: 'one', save: async () => { first++; } }, { name: 'two', save: async () => { second++; if (fail) throw new Error('storage unavailable'); } }] }); // CHANGE
    assert.equal(result.status, 'failed'); assert.equal(h.cell.getAttribute('label'), 'applied'); fail = false; assert.equal((await result.retry()).status, 'saved'); assert.equal(first, 1); assert.equal(second, 2); assert.equal(h.undoManager.history.length, 1); // CHANGE
}); // CHANGE
test('default retries cannot overwrite superseding choices or cross document generations', async t => { // CHANGE
    const h = fixture(t); let writes = 0; const old = await h.context.saveDefaults({ id: 'defaults', tasks: [{ name: 'old', save: async () => { throw new Error('try later'); } }] }); // CHANGE
    await h.context.saveDefaults({ id: 'defaults', tasks: [{ name: 'new', save: async () => { writes++; } }] }); const retry = await old.retry(); assert.equal(retry.status, 'failed'); assert.match(retry.failures[0].reason, /superseded/); assert.equal(writes, 1); // CHANGE
    const pending = await h.context.saveDefaults({ id: 'document', tasks: [{ name: 'local', save: async () => { throw new Error('failed'); } }] }); h.graph.model.setRoot(new h.window.mxGraphModel().getRoot()); assert.equal((await pending.retry()).status, 'failed'); // CHANGE
}); // CHANGE
test('newer draft fields invalidate preparation without applying the older capture', async t => { // CHANGE
    const h = fixture(t); let text = 'first', release, ready; const started = new Promise(resolve => { ready = resolve; }); // CHANGE
    const pending = h.context.commit({ cells: [h.cell], capture: () => ({ text }), prepare: async ({ draft }) => { ready(); await new Promise(resolve => { release = resolve; }); return { apply: () => h.write(h.cell, draft.text) }; } }); // CHANGE
    await started; text = 'newer'; release(); assert.equal((await pending).status, 'stale'); assert.equal(h.cell.getAttribute('label'), 'Bed'); assert.equal(text, 'newer'); // CHANGE
}); // CHANGE
test('declared asynchronous application is refused before its first graph write', t => { // CHANGE
    const h = fixture(t); assert.throws(() => h.context.apply({ cells: [h.cell] }, async () => { h.write(h.cell, 'invalid'); }), /must be synchronous/); assert.equal(h.cell.getAttribute('label'), 'Bed'); // CHANGE
}); // CHANGE
test('a newer default operation waits for older in-flight storage and wins last', async t => { // CHANGE
    const h = fixture(t), writes = []; let release, started; const ready = new Promise(resolve => { started = resolve; }); // CHANGE
    const older = h.context.saveDefaults({ id: 'same-crop', tasks: [{ name: 'old', save: async () => { started(); await new Promise(resolve => { release = resolve; }); writes.push('old'); } }] }); // CHANGE
    await ready; const newer = h.context.saveDefaults({ id: 'same-crop', tasks: [{ name: 'new', save: async () => { writes.push('new'); } }] }); // CHANGE
    await Promise.resolve(); assert.deepEqual(writes, []); release(); await Promise.all([older, newer]); assert.deepEqual(writes, ['old', 'new']); // CHANGE
}); // CHANGE
test('commit outcomes distinguish no-op writes and include actual new object targets', async t => { // CHANGE
    const h = fixture(t); const unchanged = await h.context.commit({ cells: [h.cell], prepare: async () => ({ apply: () => h.write(h.cell, 'Bed') }) }); assert.equal(unchanged.status, 'unchanged'); assert.deepEqual(Array.from(unchanged.targets), []); // CHANGE
    const added = await h.context.commit({ cells: [h.cell], prepare: async () => ({ apply: () => h.graph.insertVertex(h.moduleCell, null, 'New', 0, 0, 20, 20) }) }); assert.equal(added.status, 'applied'); assert.ok(added.operationId); assert.ok(added.targets.some(key => JSON.parse(key)[1] === added.value.id)); // CHANGE
}); // CHANGE
test('rollback also removes writes produced by restoring selection', t => { // CHANGE
    const h = fixture(t), other = h.bed(100, 100); h.graph.setSelectionCell(h.cell); h.undoManager.clear(); // CHANGE
    h.graph.getSelectionModel().addListener(h.window.mxEvent.CHANGE, () => h.write(other, 'selection decoration')); // CHANGE
    assert.throws(() => h.context.apply({ cells: [h.cell], finalize() { h.graph.setSelectionCell(other); throw new Error('selection rendering failed'); } }, () => h.write(h.cell, 'provisional')), /selection rendering failed/); // CHANGE
    assert.equal(h.cell.getAttribute('label'), 'Bed'); assert.equal(other.getAttribute('label'), 'Bed'); assert.equal(h.graph.getSelectionCell(), h.cell); assert.equal(h.undoManager.history.length, 0); h.context.assertCapturable(); // CHANGE
}); // CHANGE
test('failed creation cleanup includes detached descendants without releasing preexisting objects', async t => { // CHANGE
    const h = fixture(t); let released = []; h.graph.__trellisSharing = { automationHolds: () => [], releaseRemovedCreations: async ids => { released = ids; } }; // CHANGE
    let group, child; assert.throws(() => h.context.apply({ cells: [h.cell], finalize() { throw new Error('creation refresh failed'); } }, () => { group = h.graph.insertVertex(h.moduleCell, null, 'new group', 0, 0, 20, 20); child = h.graph.insertVertex(group, null, 'new child', 0, 0, 10, 10); h.graph.removeCells([h.cell]); }), /creation refresh failed/); // CHANGE
    await Promise.resolve(); await Promise.resolve(); assert.ok(released.includes(group.id)); assert.ok(released.includes(child.id)); assert.equal(released.includes(h.cell.id), false); assert.equal(h.graph.model.getCell(h.cell.id), h.cell); // CHANGE
}); // CHANGE
