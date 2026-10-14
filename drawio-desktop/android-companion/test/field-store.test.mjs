/** Verify persistent offline operations, concurrent edits, and interrupted transactions. */ // NEW
import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { openStore } from '../www/field-store.js';
import '../../drawio/src/main/webapp/js/trellis-field-protocol.js';
const protocol = globalThis.TrellisFieldProtocol;
const initial = () => ({ work: { schema: 1, kind: 'field-work', packageId: 'package', diagramId: 'diagram', workerId: 'worker', exportedAt: 1, tasks: [{ id: 'task', progress: { state: 'TODO', completedDay: null }, annotation: '', versions: {}, locations: [] }], gardens: [], acknowledgments: [] }, pending: { schema: 1, kind: 'task-updates', diagramId: 'diagram', workerId: 'worker', operations: [] } });
const makeOperation = (counter, text) => ({ id: 'phone:' + counter, taskId: 'task', field: 'annotation', value: text, version: { time: 10, deviceId: 'phone', counter } });
const overlay = (work, pending) => protocol.refreshWork(work, pending).work;

test('rapid edits allocate distinct counters and survive reopening the store', async () => {
    const first = await openStore(); await first.put('work:rapid', initial());
    await Promise.all(Array.from({ length: 20 }, (_, i) => first.recordOperation('counter:rapid', 'work:rapid', counter => makeOperation(counter, 'Edit ' + i), overlay)));
    const restarted = await openStore(), saved = await restarted.get('work:rapid');
    assert.equal(saved.pending.operations.length, 20);
    assert.deepEqual(saved.pending.operations.map(op => op.version.counter), Array.from({ length: 20 }, (_, i) => i + 1));
    assert.equal((await restarted.get('counter:rapid')).counter, 20);
    assert.equal(saved.display.tasks[0].annotation, 'Edit 19');
});
test('failed update rolls back both the operation and allocated counter', async () => {
    const store = await openStore(); await store.put('work:failed', initial());
    await assert.rejects(store.recordOperation('counter:failed', 'work:failed', () => { throw new Error('Interrupted write'); }, overlay));
    assert.equal(await store.get('counter:failed'), undefined);
    assert.equal((await store.get('work:failed')).pending.operations.length, 0);
    const retried = await store.recordOperation('counter:failed', 'work:failed', counter => makeOperation(counter, 'Retry'), overlay);
    assert.equal(retried.pending.operations[0].id, 'phone:1');
});
test('an arriving package cannot overwrite edits committed during refresh', async () => {
    const store = await openStore(); await store.put('work:refresh', initial());
    const incoming = { ...initial().work, exportedAt: 2 };
    await Promise.all([
        store.recordOperation('counter:refresh', 'work:refresh', counter => makeOperation(counter, 'Offline edit'), overlay),
        store.update('work:refresh', saved => ({ ...saved, work: incoming, display: overlay(incoming, saved.pending) }))
    ]);
    const saved = await store.get('work:refresh');
    assert.equal(saved.pending.operations.length, 1);
    assert.equal(saved.display.tasks[0].annotation, 'Offline edit');
    assert.equal(saved.work.exportedAt, 2);
});
