// NEW: Shared offline ordering, validation, and acknowledgment behavior.
import test from 'node:test';
import assert from 'node:assert/strict';
import '../drawio/src/main/webapp/js/trellis-field-protocol.js';
const p = globalThis.TrellisFieldProtocol;
const stamp = (time, deviceId = 'phone', counter = 1) => ({ time, deviceId, counter });
const work = () => ({ schema: 1, kind: 'field-work', packageId: 'package', diagramId: 'garden', workerId: 'alice', exportedAt: 1, tasks: [{ id: 'task', progress: { state: 'TODO', completedDay: null }, annotation: '', plannedDay: '2026-10-01', versions: {}, locations: [] }], gardens: [], acknowledgments: [] });
const update = (field, value, version = stamp(10)) => ({ schema: 1, kind: 'task-updates', diagramId: 'garden', workerId: 'alice', operations: [{ id: version.deviceId + ':' + version.counter, taskId: 'task', field, value, version }] });

/** Planting frames retain their stable identities and geometry without accepting CSS-injection strings. */ // NEW
test('whole-garden packages retain typed planting groups and validate rotations', () => { // NEW
    const region = { id: 'planting-group', kind: 'planting-group', x: 40, y: 50, width: 100, height: 60, rotation: 37 }; // NEW
    const value = { ...work(), gardens: [{ id: 'garden-frame', png: 'data:image/png;base64,AA==', width: 600, height: 400, regions: [region] }] }; // NEW
    assert.deepEqual(p.validateWork(value).gardens[0].regions[0], region); // NEW
    assert.throws(() => p.validateWork({ ...value, gardens: [{ ...value.gardens[0], regions: [{ ...region, rotation: '0) scale(0' }] }] }), /rotation/); // NEW
    assert.throws(() => p.validateWork({ ...value, gardens: [{ ...value.gardens[0], regions: [{ ...region, kind: 'task-board' }] }] }), /object kind/); // NEW
}); // NEW
test('different fields survive both import orders and replay is idempotent', () => {
    const a = update('progress', { state: 'DONE', completedDay: '2026-09-30' });
    const b = update('annotation', 'Watered', stamp(11, 'desktop'));
    const ab = p.mergeUpdates(p.mergeUpdates(work(), a).work, b).work;
    const ba = p.mergeUpdates(p.mergeUpdates(work(), b).work, a).work;
    assert.deepEqual(ab.tasks, ba.tasks);
    assert.equal(ab.tasks[0].plannedDay, '2026-10-01');
    assert.equal(ab.tasks[0].progress.completedDay, '2026-09-30');
    assert.deepEqual(p.mergeUpdates(ab, a).work, ab);
});
test('equal timestamps use stable device and counter ordering; older edits lose', () => {
    const first = p.mergeUpdates(work(), update('annotation', 'new', stamp(20, 'z', 2))).work;
    assert.equal(p.mergeUpdates(first, update('annotation', 'old', stamp(20, 'a'))).outcomes[0].status, 'superseded');
    assert.equal(p.mergeUpdates(first, update('annotation', 'next', stamp(20, 'z', 3))).work.tasks[0].annotation, 'next');
});
test('complete validation precedes permission callbacks and rejects wrong diagrams', () => {
    let calls = 0;
    const bad = update('annotation', 'ok');
    bad.operations.push({ ...bad.operations[0], id: 'phone:2', field: 'assignment', version: stamp(11, 'phone', 2) });
    assert.throws(() => p.mergeUpdates(work(), bad, { canApply() { calls++; return true; } }), /Unsupported/);
    assert.equal(calls, 0);
    assert.throws(() => p.mergeUpdates(work(), { ...update('annotation', 'ok'), diagramId: 'other' }), /another/);
});
test('missing and no-longer-permitted objects report terminal outcomes without creation', () => {
    const deleted = work(); deleted.tasks = [];
    assert.equal(p.mergeUpdates(deleted, update('annotation', 'x')).outcomes[0].status, 'missing-object');
    assert.equal(p.mergeUpdates(work(), update('annotation', 'x'), { canApply: () => false }).outcomes[0].status, 'permission-rejected');
    assert.equal(p.mergeUpdates(deleted, update('annotation', 'x'), { hasObject: () => true }).outcomes[0].status, 'permission-rejected'); // NEW: an object omitted after reassignment is different from a deleted original.
});
test('refresh retains pending edits until an actual desktop acknowledgment arrives', () => {
    const local = update('annotation', 'pending');
    const fresh = p.refreshWork(work(), local);
    assert.equal(fresh.pending.operations.length, 1);
    assert.equal(fresh.work.tasks[0].annotation, 'pending');
    const acknowledged = p.mergeUpdates(work(), local).work;
    assert.equal(p.refreshWork(acknowledged, local).pending.operations.length, 0);
});
test('annotations count Unicode points and completion days are real calendar dates', () => {
    assert.equal(Array.from(p.normalizeAnnotation('🌱'.repeat(45))).length, 40);
    assert.equal(p.normalizeAnnotation(' a\n b '), 'a b');
    assert.throws(() => p.progress({ state: 'DONE', completedDay: '2026-02-30' }), /completion/);
});
