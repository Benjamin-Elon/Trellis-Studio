/** Exercise the main-process save boundary, revoked senders, and worker scope. */ // NEW
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { createFieldService } from '../src/main/trellis-field-service.js';
const version = { time: 10, deviceId: 'phone', counter: 1 };
const ack = { id: 'phone:1', taskId: 'task', field: 'progress', version, status: 'applied' };
const work = () => ({ schema: 1, kind: 'field-work', packageId: 'package', diagramId: 'diagram', workerId: 'worker', exportedAt: 1, tasks: [{ id: 'task', progress: { state: 'DONE', completedDay: '2026-09-30' }, annotation: '', versions: { progress: version }, locations: [] }], gardens: [], acknowledgments: [ack] });
const escape = text => text.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
async function fixture(t) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'trellis-field-service-')), filename = path.join(root, 'Garden.drawio');
    const session = { identityId: 'identity', deviceId: 'desktop' }, entry = { diagramId: 'diagram', workerId: 'worker', name: 'Kitchen garden' };
    let records = [];
    const identities = { requireSession: async () => {}, session: () => session, metadataRoot: () => root, state: async () => ({ devices: [{ id: 'desktop' }] }), signAction: async (kind, value) => ({ payload: { ...value, kind, id: crypto.randomUUID(), author: 'desktop' } }) };
    const library = { getEntry: async () => entry, list: async () => ({ gardens: [{ ...entry, path: filename, available: true }] }), verifiedRecords: async () => records };
    const service = createFieldService({ identities, library });
    t.after(() => fs.rm(root, { force: true, recursive: true }));
    async function save(state = 'DONE', versions = { progress: version }) {
        const xml = '<mxGraphModel><root><mxCell id="0"/><object id="1" trellis_field_acknowledgments_json="' + escape(JSON.stringify([ack])) + '"><mxCell parent="0"/></object><object id="card" trellis_field_object_id="task" workflow_state="' + state + '" completed="2026-09-30" trellis_field_versions_json="' + escape(JSON.stringify(versions)) + '"><mxCell parent="1" vertex="1"/></object></root></mxGraphModel>';
        await fs.writeFile(filename, xml);
        return { work: work(), path: filename, savedHash: crypto.createHash('sha256').update(xml).digest('hex') };
    }
    return { root, filename, service, save, setRecords: value => { records = value; } };
}
test('only the saved field value and version can publish an applied acknowledgment', async t => {
    const f = await fixture(t);
    assert.equal((await f.service.pendingUpdates({ diagramId: 'diagram' })).enabled, false); // NEW: an unopened field channel cannot cause background diagram mutation.
    await assert.rejects(f.service.acknowledge(await f.save('TODO')), /progress.*durably saved/);
    await assert.rejects(f.service.acknowledge(await f.save('DONE', {})), /version.*durably saved/);
    const input = await f.save(); await assert.rejects(f.service.acknowledge({ ...input, savedHash: 'bad' }), /Save the applied/);
    await assert.rejects(fs.access(path.join(f.root, 'field/diagram/worker/work')));
    const result = await f.service.acknowledge(input);
    assert.equal(result.work.name, 'Kitchen garden');
    const names = await fs.readdir(path.join(f.root, 'field/diagram/worker/work'));
    assert.equal(names.length, 1);
    assert.equal((await f.service.pendingUpdates({ diagramId: 'diagram' })).enabled, true); // NEW: publication enables restart-safe automatic refresh.
});
test('revoked signed senders are rejected by the command layer while other workers cannot enter the inbox', async t => {
    const f = await fixture(t), updates = { schema: 1, kind: 'task-updates', diagramId: 'diagram', workerId: 'worker', operations: [{ id: 'phone:1', taskId: 'task', field: 'annotation', value: 'Watered', version }] };
    f.setRecords([{ payload: { author: 'removed-phone', kind: 'task-updates', updates } }]);
    assert.equal((await f.service.pendingUpdates({ diagramId: 'diagram' })).packages[0].senderAuthorized, false);
    await assert.rejects(f.service.importUpdates({ updates: { ...updates, workerId: 'other' } }), /another worker/);
    await assert.rejects(f.service.publishWork({ work: { ...work(), workerId: 'other' } }), /linked worker/);
});
