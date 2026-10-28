/** Opt-in real-file journal stress; elapsed observations are not p95 acceptance. */ // NEW
import test from 'node:test'; // NEW
import assert from 'node:assert/strict'; // NEW
import fs from 'node:fs/promises'; // NEW
import os from 'node:os'; // NEW
import path from 'node:path'; // NEW
import crypto from 'node:crypto'; // NEW
import { fileURLToPath } from 'node:url'; // NEW
import { createCollaborationStore } from '../src/main/trellis-collaboration-store.js'; // NEW
import { diffObjects, replay } from '../src/main/trellis-collaboration-protocol.js'; // NEW
import { signRecord } from '../src/main/trellis-share-protocol.js'; // NEW

test('10,000 signed records preserve replay results across checked reuse and restart', { skip: process.env.TRELLIS_SAVE_STRESS_TEST !== '1', timeout: 240000 }, async t => { // NEW
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'trellis-save-stress-')); t.after(() => fs.rm(directory, { recursive: true, force: true })); // NEW
    const pair = crypto.generateKeyPairSync('ed25519'), keys = { publicKey: pair.publicKey.export({ type: 'spki', format: 'pem' }), privateKey: pair.privateKey }; // NEW
    const canvas = { shareId: 'stress', diagramId: 'diagram', folderPath: directory, diagramPath: path.join(directory, 'Garden.drawio'), coordinatorDeviceId: 'device', coordinatorPublicKey: keys.publicKey, members: [{ deviceId: 'device', publicKey: keys.publicKey }] }; // NEW
    const writeAtomic = async (filename, text) => { await fs.mkdir(path.dirname(filename), { recursive: true }); await fs.writeFile(filename + '.tmp', text); await fs.rename(filename + '.tmp', filename); }; // NEW
    const writeImmutable = async (filename, record) => { await fs.mkdir(path.dirname(filename), { recursive: true }); await fs.writeFile(filename, JSON.stringify(record), { flag: 'wx' }); }; // NEW
    const users = '{&quot;usersEnabled&quot;:true,&quot;users&quot;:[{&quot;id&quot;:&quot;admin&quot;,&quot;admin&quot;:true}]}'; // NEW
    const xml = '<mxGraphModel><root><mxCell id="0"/><object id="1" trellis_users_json="' + users + '"><mxCell parent="0"/></object><object id="a" label="Original"><mxCell vertex="1" parent="1"/></object>' + Array.from({ length: 100 }, (_, i) => '<object id="notes-' + i + '" notes="' + 'garden planning '.repeat(1350) + '"><mxCell vertex="1" parent="1"/></object>').join('') + '</root></mxGraphModel>'; // NEW
    const after = xml.replace('label="Original"', 'label="Updated"'), delta = diffObjects(xml, after), records = [], samples = []; // NEW
    for (let index = 0; index < 10000; index++) { // NEW
        const record = { schema: 3, shareId: canvas.shareId, diagramId: canvas.diagramId, deviceId: 'device', userId: 'admin', sessionId: 'session', id: 'record-' + index, clock: index + 1, parents: index ? ['record-' + (index - 1)] : [], at: 1000, kind: index === 0 ? 'claim' : index === 1 ? 'edit' : index === 2 ? 'release' : 'view', targets: index <= 2 ? delta.targets : [] }; // NEW
        if (index === 1) Object.assign(record, { changes: delta.changes, claimIds: ['record-0'] }); records.push(record); // NEW
    } // NEW
    const make = () => createCollaborationStore({ canvas, keys, deviceId: 'device', profile: path.join(directory, 'private'), now: () => 2000, writeAtomic, writeImmutable, onTiming: sample => samples.push(sample) }); // NEW
    const journal = make(); await journal.initialize(xml); // NEW
    for (let index = 0; index < records.length; index += 20) await Promise.all(records.slice(index, index + 20).map(record => writeImmutable(path.join(directory, '.trellis/collaboration-v3/records', record.id + '.json'), signRecord(record, keys.privateKey)))); // NEW
    const observations = []; let saved; // NEW
    for (const [label, store] of [['cold', journal], ['warm', journal], ['restart', make()]]) { // NEW
        const start = performance.now(), state = await store.snapshot(); observations.push({ label, durationMs: performance.now() - start }); // NEW
        assert.equal(state.records.length, 10000); assert.deepEqual(state.accepted, ['record-1']); assert.equal(state.errors.length, 0); assert.equal(state.xml, after); saved = state; // NEW
        assert.equal(samples.filter(sample => sample.phase === 'read').at(-1).replayCount, label === 'cold' ? 1 : 0); // NEW: compact verification evidence must leave this cacheable replay resident across long-history reads.
    } // NEW
    const expected = replay(xml, records, 2000); assert.equal(saved.xml, expected.xml); assert.deepEqual(saved.rejected, expected.rejected); assert.deepEqual(saved.pending, expected.pending); // NEW
    const output = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.test-artifacts/save-performance/stress-10000.json'); await fs.mkdir(path.dirname(output), { recursive: true }); // NEW
    await fs.writeFile(output, JSON.stringify({ complete: true, bytes: Buffer.byteLength(xml), records: 10000, edits: 1, observations, samples, note: 'Real signed files, warm reuse and a new store instance. One historical edit; native long-edit-history workload is measured separately.' }, null, 2)); // NEW
}); // NEW
