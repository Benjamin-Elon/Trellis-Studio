/** Signed resets, dependency delivery and cleanup boundaries use isolated on-disk projects. */ // NEW
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { createHistoryService } from '../src/main/trellis-history-service.js';
import { createHistoryTransport } from '../src/main/trellis-history-transport.js';
import { normalizeDocument } from '../src/main/trellis-history-codec.js';

function xml(label = 'Current') {
    return '<mxfile><diagram id="page"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>' + Array.from({ length: 60 }, (_, i) => `<object id="g-${i}" label="${i === 0 ? label : crypto.createHash('sha256').update(String(i)).digest('hex')}"><mxCell parent="1" vertex="1"/></object>`).join('') + '</root></mxGraphModel></diagram></mxfile>';
}
async function fixture(t, options = {}) { // NEW
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'history-transport-')), folderPath = path.join(root, 'project'); await fs.mkdir(folderPath);
    const keys = crypto.generateKeyPairSync('ed25519'), canvas = { shareId: 'share-a', diagramId: 'document-a', folderPath, diagramPath: path.join(folderPath, 'Garden.drawio'), coordinatorDeviceId: 'device-a', coordinatorPublicKey: keys.publicKey, members: [{ deviceId: 'device-a', publicKey: keys.publicKey }], membershipVersion: 0 };
    await fs.writeFile(canvas.diagramPath, xml());
    const store = createHistoryService({ Database: DatabaseSync, dbPath: ':memory:', ...options }); // NEW
    await store.run('initialize', { diagramId: canvas.diagramId, xml: xml() });
    const writeImmutable = async (filename, value) => { await fs.mkdir(path.dirname(filename), { recursive: true }); const text = JSON.stringify(value); try { await fs.writeFile(filename, text, { flag: 'wx' }); } catch (e) { if (e.code !== 'EEXIST' || await fs.readFile(filename, 'utf8') !== text) throw e; } };
    const transport = createHistoryTransport({ canvas, deviceId: 'device-a', keys, history: () => store, profile: root, writeImmutable });
    t.after(async () => { store.close(); await fs.rm(root, { recursive: true, force: true }); });
    return { root, canvas, store, transport, keys, writeImmutable };
}

test('reset is durable, rejects replay, deletes legacy exports and preserves live content and journals', async t => {
    const f = await fixture(t), legacy = path.join(f.canvas.folderPath, '.trellis', 'history'), journal = path.join(f.canvas.folderPath, '.trellis', 'collaboration-v3');
    await fs.mkdir(legacy, { recursive: true }); await fs.writeFile(path.join(legacy, 'old.json'), 'old'); await fs.mkdir(journal); await fs.writeFile(path.join(journal, 'genesis.json'), 'keep');
    const result = await f.transport.importAll();
    assert.equal(await fs.readFile(f.canvas.diagramPath, 'utf8'), xml()); assert.equal(await fs.readFile(path.join(journal, 'genesis.json'), 'utf8'), 'keep');
    await assert.rejects(fs.stat(legacy), /ENOENT/);
    const before = await f.store.run('list', { diagramId: 'document-a' }); await f.transport.importAll();
    assert.equal((await f.store.run('list', { diagramId: 'document-a' }))[0].id, before[0].id);
    await fs.mkdir(legacy); await fs.writeFile(path.join(legacy, 'delayed.json'), 'old'); await f.transport.importAll(); await assert.rejects(fs.stat(legacy), /ENOENT/);
    const markerPath = path.join(f.canvas.folderPath, '.trellis', 'history-v2', 'reset.json'), marker = JSON.parse(await fs.readFile(markerPath)); marker.payload.generation = 'forged'; await fs.writeFile(markerPath, JSON.stringify(marker));
    await assert.rejects(f.transport.importAll(), /verified/);
    assert.equal((await f.store.run('statistics', { diagramId: 'document-a' })).generation, result.generation);
});

test('shared exports use published bases and reject a revision that differs from the saved diagram', async t => {
    const f = await fixture(t); await f.transport.importAll();
    const record = async (label, id) => f.store.run('record', { diagramId: 'document-a', xml: xml(label), metadata: { id, actorUserId: 'alice' } });
    await record('Private', 'private-a'); const first = await record('Saved', 'saved-a');
    await f.transport.publish(xml('Saved'), [first.id]);
    await record('Private 2', 'private-b'); const next = await record('Saved 2', 'saved-b');
    await f.transport.publish(xml('Saved 2'), [next.id]);
    const result = await f.transport.importAll(), entry = result.entries.find(item => item.revision.id === next.id);
    assert.equal(entry.record.kind, 'delta'); assert.equal(entry.record.baseRevisionId, first.id); assert.equal(entry.revision.parentRevisionId, first.id);
    assert.ok(!result.entries.some(item => item.revision.id.startsWith('private')));
    await assert.rejects(f.transport.publish(xml('Other'), [next.id]), /saved whole/);
    assert.equal((await f.store.run('read', { revisionId: next.id })).xml, normalizeDocument(xml('Saved 2')));
});

test('a noncoordinator waits without deleting old history until a signed reset is available', async t => {
    const f = await fixture(t), peerStore = createHistoryService({ Database: DatabaseSync, dbPath: ':memory:' }); t.after(() => peerStore.close());
    const peer = createHistoryTransport({ canvas: f.canvas, deviceId: 'device-b', keys: crypto.generateKeyPairSync('ed25519'), history: () => peerStore, profile: f.root, writeImmutable: f.writeImmutable });
    assert.equal((await peer.importAll()).waitingForCoordinator, true);
    const reset = await f.transport.importAll(); const result = await peer.importAll(); assert.equal(result.generation, reset.generation);
});

test('a verified coordinator handover preserves the original signed reset authority', async t => { // NEW
    const f = await fixture(t); const reset = await f.transport.importAll(), successor = crypto.generateKeyPairSync('ed25519');
    f.canvas.coordinatorHistory = [{ deviceId: 'device-a', publicKey: f.keys.publicKey, version: 1 }];
    f.canvas.coordinatorDeviceId = 'device-b'; f.canvas.coordinatorPublicKey = successor.publicKey; f.canvas.membershipVersion = 1; f.canvas.members = [{ deviceId: 'device-b', publicKey: successor.publicKey }];
    const transport = createHistoryTransport({ canvas: f.canvas, deviceId: 'device-b', keys: successor, history: () => f.store, profile: f.root, writeImmutable: f.writeImmutable });
    assert.equal((await transport.importAll()).generation, reset.generation);
}); // NEW

test('a delayed shared reset preserves new-format local revisions without publishing private content', async t => { // NEW
    const f = await fixture(t);
    const privateRevision = await f.store.run('record', { diagramId: 'document-a', xml: xml('Private before sharing'), metadata: { id: 'private-before-sharing' } });
    const result = await f.transport.importAll();
    assert.equal((await f.store.run('read', { revisionId: privateRevision.id })).xml, normalizeDocument(xml('Private before sharing')));
    assert.ok((await f.store.run('list', { diagramId: 'document-a' })).some(item => item.id === privateRevision.id && item.generation === result.generation));
    assert.deepEqual(result.entries, []);
}); // NEW

test('shared pruning anchors only published history, preserves peer private branches, and fences delayed files', async t => { // NEW
    const f = await fixture(t, { budget: 1 }); const reset = await f.transport.importAll();
    const record = (label, id) => f.store.run('record', { diagramId: 'document-a', xml: xml(label), metadata: { id } });
    const first = await record('First save', 'saved-first'); await f.transport.publish(xml('First save'), [first.id]);
    const root = path.join(f.canvas.folderPath, '.trellis', 'history-v2', reset.generation), firstPath = path.join(root, 'records', first.id + '.json'), delayed = await fs.readFile(firstPath);
    const archive = path.join(f.canvas.folderPath, '.stversions', '.trellis', 'history-v2', reset.generation, 'records'); await fs.mkdir(archive, { recursive: true }); await fs.writeFile(path.join(archive, first.id + '~20261022-000000.json'), delayed); // NEW
    const peerStore = createHistoryService({ Database: DatabaseSync, dbPath: ':memory:' }); t.after(() => peerStore.close());
    const peer = createHistoryTransport({ canvas: f.canvas, deviceId: 'device-b', keys: crypto.generateKeyPairSync('ed25519'), history: () => peerStore, profile: f.root, writeImmutable: f.writeImmutable });
    await peer.importAll(); await peerStore.run('baseline', { diagramId: 'document-a', xml: xml('First save') });
    const privatePeer = await peerStore.run('record', { diagramId: 'document-a', xml: xml('Peer private'), metadata: { id: 'peer-private' } });
    for (let i = 2; i < 112; i++) await record('Private ' + i, 'private-' + i);
    const last = await record('Final save', 'saved-last'); await f.transport.publish(xml('Final save'), [last.id]);
    const anchors = await fs.readdir(path.join(root, 'anchors'));
    assert.deepEqual(await fs.readdir(archive), []); // NEW: version archives must not defeat physical reclamation.
    assert.ok(anchors.length > 0); assert.ok(anchors.every(name => name.startsWith('saved-last-')));
    assert.ok(!(await fs.readdir(path.join(root, 'records'))).some(name => name.startsWith('private')));
    const imported = await peer.importAll(); assert.deepEqual(imported.errors, []);
    assert.equal((await peerStore.run('read', { revisionId: privatePeer.id })).xml, normalizeDocument(xml('Peer private')));
    assert.equal((await peerStore.run('read', { revisionId: last.id })).xml, normalizeDocument(xml('Final save')));
    await fs.writeFile(firstPath, delayed); await peer.importAll(); await assert.rejects(fs.stat(firstPath), /ENOENT/);
    assert.ok(!(await peerStore.run('list', { diagramId: 'document-a' })).some(item => item.id === first.id));
}); // NEW
