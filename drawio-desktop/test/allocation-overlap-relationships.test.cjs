const assert = require('node:assert/strict'); // CHANGE
const test = require('node:test'); // CHANGE
const { loadSchedulerHooks } = require('./helpers/garden-scheduler-harness.cjs'); // CHANGE

test('allocation relationship API reuses forward/inverse scheduler classification without changing pairs', async () => { // CHANGE
    const rows = [{ relation_id: 1, source_plant_id: 1, companion_plant_id: 2, rating: 2 }, { relation_id: 2, source_plant_id: 3, companion_plant_id: 1, rating: -1 }]; // CHANGE
    const writes = []; // CHANGE
    const bridge = { resolvePath: async () => ({ dbPath: 'relationships' }), open: async () => ({ dbId: 'relationships' }), close: async () => {}, // CHANGE
        query: async (id, sql) => ({ rows: sql.includes('FROM Companions c') ? rows : [] }), exec: async (id, sql) => { writes.push(sql); return {}; } }; // CHANGE
    const hooks = loadSchedulerHooks({ dbBridge: bridge }); // CHANGE
    const lookup = hooks.__testWindow.USL.scheduler.listAllocationOverlapRelationships; // CHANGE
    const result = await lookup(1); // CHANGE
    assert.deepEqual(Array.from(result, item => [item.companionPlantId, item.conflictKind]), [['2', 'companion'], ['3', 'incompatible']]); // CHANGE
    assert.equal(writes.some(sql => /(?:INSERT INTO|UPDATE|DELETE FROM)\s+Companions\b/i.test(sql)), false); // CHANGE
    const afterInitialization = writes.length; await lookup(1); assert.equal(writes.length, afterInitialization); // CHANGE
}); // CHANGE

test('allocation relationship API tolerates missing identities and unavailable reference data', async () => { // CHANGE
    const hooks = loadSchedulerHooks({ dbBridge: { resolvePath: async () => { throw new Error('Unavailable'); } } }); // CHANGE
    const lookup = hooks.__testWindow.USL.scheduler.listAllocationOverlapRelationships; // CHANGE
    assert.equal((await lookup('invalid')).length, 0); assert.equal((await lookup(1)).length, 0); // CHANGE
}); // CHANGE

test('bed relationship summaries include spatially separate crops, inclusive dates, repeated plantings, and undated occupancy', () => { // CHANGE
    const tools = loadSchedulerHooks().layoutTools; // CHANGE
    const item = (groupId, conflictKind, bedEntryISO = '2027-04-01', harvestEndISO = '2027-06-01', bedId = 'bed') => ({ groupId, plantId: '2', conflictKind, bedId, bedEntryISO, harvestEndISO, rect: { x: 10000, y: 10000, width: 1, height: 1 } }); // CHANGE
    const summary = tools.summarizeBedRelationships([item('c1', 'companion'), item('c2', 'companion'), item('c1', 'companion'), item('i', 'incompatible'), item('u', 'unknown'), item('undated', 'companion', ''), item('past', 'incompatible', '2027-01-01', '2027-03-31'), item('other-bed', 'incompatible', undefined, undefined, 'elsewhere')], 'bed', '2027-06-01', '2027-08-01'); // CHANGE
    assert.equal(summary.companion.length, 2); assert.equal(summary.incompatible.length, 1); assert.equal(summary.unknown.length, 1); assert.equal(summary.unresolved.length, 1); // CHANGE
    assert.equal(summary.companion[0].overlapStartISO, '2027-06-01'); assert.equal(summary.companion[0].overlapEndISO, '2027-06-01'); // CHANGE
    assert.equal(tools.summarizeBedRelationships([item('selected', 'companion')], 'bed', '2027-04-01', '2027-06-01', 'selected').companion.length, 0); // CHANGE
}); // CHANGE
