/** Exercise real signed persistence and production save/view adapters without historical replay. */ // NEW
import test from 'node:test'; // NEW
import assert from 'node:assert/strict'; // NEW
import fs from 'node:fs/promises'; // NEW
import os from 'node:os'; // NEW
import path from 'node:path'; // NEW
import crypto from 'node:crypto'; // NEW
import { createCollaborationStore } from '../src/main/trellis-collaboration-store.js'; // NEW
import { createCurrentStateStore, applyCurrentEvent, expireCurrentState } from '../src/main/trellis-current-state.js'; // CHANGE
import { objects, diffObjects, REQUEST_GRACE_MS, HANDOFF_MS } from '../src/main/trellis-collaboration-protocol.js'; // CHANGE
import { signRecord, digest, canonical } from '../src/main/trellis-share-protocol.js'; // NEW

const key = '["","a"]'; // NEW
function diagram(label = 'Initial', extra = '') { // NEW
    const users = JSON.stringify({ usersEnabled: true, users: [{ id: 'admin', name: 'Admin', admin: true }, { id: 'visitor', name: 'Visitor' }] }).replaceAll('"', '&quot;'); // NEW
    return '<mxGraphModel><root><mxCell id="0"/><object id="1" trellis_users_json="' + users + '"><mxCell parent="0"/></object><object id="a" label="' + label + '"><mxCell vertex="1" parent="1"/></object>' + extra + '</root></mxGraphModel>'; // NEW
} // NEW
async function fixture(t, options = {}) { // NEW
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'trellis-current-state-')); // NEW
    t.after(async () => { // NEW
        assert.equal(path.dirname(root), path.resolve(os.tmpdir())); assert.ok(path.basename(root).startsWith('trellis-current-state-')); // NEW
        await fs.rm(root, { recursive: true, force: true }); // NEW
    }); // NEW
    const pair = crypto.generateKeyPairSync('ed25519'), keys = { publicKey: pair.publicKey.export({ type: 'spki', format: 'pem' }), privateKey: pair.privateKey }; // NEW
    const canvas = { protocolVersion: 4, shareId: 'garden', diagramId: 'diagram', filename: 'Garden.drawio', folderPath: root, diagramPath: path.join(root, 'Garden.drawio'), coordinatorDeviceId: 'A', coordinatorPublicKey: keys.publicKey, members: [{ deviceId: 'A', userId: 'admin', publicKey: keys.publicKey }] }; // NEW
    const writeAtomic = async (filename, contents) => { await fs.mkdir(path.dirname(filename), { recursive: true }); await fs.writeFile(filename + '.tmp', contents); await fs.rename(filename + '.tmp', filename); }; // NEW
    const writeImmutable = async (filename, value) => { await fs.mkdir(path.dirname(filename), { recursive: true }); await fs.writeFile(filename, JSON.stringify(value), { flag: 'wx' }); }; // NEW
    const timings = [], parameters = { canvas, keys, deviceId: 'A', profile: path.join(root, 'private'), writeAtomic, writeImmutable, onTiming: item => timings.push(item), ...options }; // NEW
    const create = () => createCollaborationStore(parameters), store = create(); // NEW
    await store.initialize(diagram()); // NEW
    return { root, canvas, keys, timings, store, create, parameters }; // NEW
} // NEW

test('ordinary production saves apply current transactions, preserve views, and restart without archives', async t => { // NEW
    const f = await fixture(t); // NEW
    await f.store.action(1, 'admin', { kind: 'open-view', explicitRefresh: true }); // NEW
    let xml = diagram(); // NEW
    for (let i = 1; i <= 32; i++) { // CHANGE: cross the periodic checkpoint boundary with atomic save decisions.
        const next = diagram('Edit-' + i), result = await f.store.action(1, 'admin', { kind: 'save', baseXml: xml, xml: next, explicitRefresh: true }); // NEW
        assert.equal(result.ok, true); xml = next; // NEW
    } // NEW
    const state = await f.store.snapshot(); // NEW
    assert.equal(objects(state.xml).get(key).label, 'Edit-32'); // CHANGE
    assert.ok(state.records.length <= 1, 'Attribution retains current objects, not prior edits.'); // NEW
    const recoveryIndex = JSON.parse(await fs.readFile(path.join(f.parameters.profile, 'recovery', f.canvas.shareId, 'index.json'), 'utf8')); // NEW
    assert.deepEqual(recoveryIndex, [], 'Acknowledged saves do not accumulate full private staging snapshots.'); // NEW
    assert.ok(f.timings.filter(item => item.phase === 'read').every(item => item.replayCount === 0 && item.historicalRecordsRead === 0)); // NEW
    const directory = path.join(f.root, '.trellis', 'collaboration-v4'), head = JSON.parse(await fs.readFile(path.join(directory, 'heads', 'A.json'), 'utf8')).payload; // NEW
    assert.ok(head.sequence - head.checkpointSequence <= 30); // NEW
    for (let sequence = 1; sequence <= head.checkpointSequence; sequence++) await fs.unlink(path.join(directory, 'epochs', head.epoch, String(sequence).padStart(12, '0') + '.json')); // NEW
    const restarted = f.create(); // NEW
    assert.equal(objects((await restarted.snapshot()).xml).get(key).label, 'Edit-32'); // CHANGE
    const saved = await restarted.action(2, 'admin', { kind: 'save', baseXml: xml, xml: diagram('After restart') }); // NEW
    assert.equal(saved.ok, true); // NEW
}); // NEW

test('permission failures retain the exact draft and never publish an accepted transaction', async t => { // NEW
    const f = await fixture(t), before = await f.store.snapshot(); // NEW
    const result = await f.store.action(1, 'visitor', { kind: 'save', baseXml: before.xml, xml: diagram('Forbidden') }); // NEW
    assert.equal(result.ok, false); assert.equal(result.code, 'PERMISSION_DENIED'); // NEW
    assert.equal(await fs.readFile(result.recoveryPath, 'utf8'), diagram('Forbidden')); // NEW
    assert.equal((await f.store.snapshot()).sequence, before.sequence); // NEW
}); // NEW

test('delete-only commits remain acknowledged without retaining lifetime deletion metadata', async t => { // NEW
    const f = await fixture(t); // NEW
    const added = diagram('Initial', '<object id="temporary"><mxCell parent="1" vertex="1"/></object>'); // NEW
    assert.equal((await f.store.action(1, 'admin', { kind: 'save', baseXml: diagram(), xml: added })).ok, true); // NEW
    assert.equal((await f.store.action(1, 'admin', { kind: 'save', baseXml: added, xml: diagram() })).ok, true); // NEW
    const state = await f.store.snapshot(); assert.equal(state.attribution['["","temporary"]'], undefined); // NEW
}); // NEW

test('checkpoint failure prevents acceptance beyond the bounded tail and permits retry', async t => { // NEW
    const f = await fixture(t); let failCheckpoint = false; // NEW
    const core = createCurrentStateStore({ ...f.parameters, writeImmutable: async (filename, value) => { if (failCheckpoint && filename.includes('checkpoints')) throw new Error('Injected disk failure'); return f.parameters.writeImmutable(filename, value); } }); // NEW
    await core.read(); // NEW
    const actor = { userId: 'admin', sessionId: 'window' }; // NEW
    for (let i = 0; i < 30; i++) await core.append(actor, 'view', { targets: [] }); // NEW
    failCheckpoint = true; await assert.rejects(core.append(actor, 'view', { targets: [] }), /Injected disk failure/); // NEW
    assert.equal((await core.read()).sequence, 30); // NEW
    failCheckpoint = false; await core.append(actor, 'view', { targets: [] }); assert.equal((await core.read()).sequence, 31); // NEW
}); // NEW

test('signed but unauthorized follower decisions are rejected against current permissions', async t => { // NEW
    const f = await fixture(t), directory = path.join(f.root, '.trellis', 'collaboration-v4'); // NEW
    const headFile = path.join(directory, 'heads', 'A.json'), head = JSON.parse(await fs.readFile(headFile, 'utf8')).payload; // NEW
    const claim = signRecord({ schema: 4, shareId: 'garden', diagramId: 'diagram', id: 'bad-claim', deviceId: 'A', userId: 'visitor', sessionId: 'bad-window', kind: 'claim', at: Date.now(), targets: [key] }, f.keys.privateKey); // NEW
    const commit = signRecord({ schema: 4, shareId: 'garden', diagramId: 'diagram', kind: 'commit', epoch: head.epoch, sequence: 1, previous: head.hash, proposal: claim, contentHash: digest(diagram()) }, f.keys.privateKey); // NEW
    await f.parameters.writeImmutable(path.join(directory, 'epochs', head.epoch, '000000000001.json'), commit); // NEW
    await f.parameters.writeAtomic(headFile, JSON.stringify(signRecord({ ...head, sequence: 1, hash: digest(canonical(commit)) }, f.keys.privateKey))); // NEW
    await assert.rejects(f.create().snapshot(), /access changed/); // NEW
}); // NEW

test('an interrupted head write recovers its durable decision without accepting a duplicate edit', async t => { // NEW
    const f = await fixture(t); let failed = false; // NEW
    const store = createCollaborationStore({ ...f.parameters, writeAtomic: async (filename, contents) => { // NEW
        if (!failed && filename.endsWith(path.join('heads', 'A.json')) && JSON.parse(contents).payload.sequence === 1) { failed = true; throw new Error('Interrupted head write'); } // CHANGE
        return f.parameters.writeAtomic(filename, contents); // NEW
    } }); // NEW
    await assert.rejects(store.action(1, 'admin', { kind: 'save', baseXml: diagram(), xml: diagram('Durable') }), /Interrupted head/); // NEW
    const recoveries = JSON.parse(await fs.readFile(path.join(f.parameters.profile, 'recovery', f.canvas.shareId, 'index.json'), 'utf8')); // NEW
    assert.equal(await fs.readFile(recoveries.at(-1).recoveryPath, 'utf8'), diagram('Durable'), 'Interrupted submissions remain indexed for local recovery.'); // NEW
    const restarted = f.create(); // NEW
    assert.equal(objects((await restarted.snapshot()).xml).get(key).label, 'Durable'); // NEW
    const before = (await restarted.snapshot()).sequence; // NEW
    assert.equal((await restarted.action(2, 'admin', { kind: 'save', baseXml: diagram(), xml: diagram('Durable') })).ok, true); // NEW
    assert.equal((await restarted.snapshot()).lastEditId, (await store.snapshot()).lastEditId); // NEW
    assert.ok((await restarted.snapshot()).sequence <= before + 1); // NEW
}); // NEW

test('lagging replicas load the current checkpoint without reading its archived predecessors', async t => { // NEW
    const f = await fixture(t), follower = f.create(); await follower.snapshot(); // NEW
    let xml = diagram(); // NEW
    for (let i = 0; i < 32; i++) { const next = diagram('Update-' + i); await f.store.action(1, 'admin', { kind: 'save', baseXml: xml, xml: next }); xml = next; } // CHANGE
    const directory = path.join(f.root, '.trellis', 'collaboration-v4'), head = JSON.parse(await fs.readFile(path.join(directory, 'heads', 'A.json'), 'utf8')).payload; // NEW
    for (let sequence = 1; sequence <= head.checkpointSequence; sequence++) await fs.unlink(path.join(directory, 'epochs', head.epoch, String(sequence).padStart(12, '0') + '.json')); // NEW
    assert.equal(objects((await follower.snapshot()).xml).get(key).label, 'Update-31'); // CHANGE
}); // NEW

test('callers cannot mutate accepted state, attribution, or active holds through a snapshot', async t => { // NEW
    const f = await fixture(t); // NEW
    await f.store.action(1, 'admin', { kind: 'save', baseXml: diagram(), xml: diagram('Accepted') }); // NEW
    await f.store.action(1, 'admin', { kind: 'claim', targets: [key] }); // NEW
    const snapshot = await f.store.snapshot(); // NEW
    snapshot.xml = diagram('Forged'); snapshot.holds[0].userId = 'visitor'; snapshot.attribution[key].userId = 'visitor'; // NEW
    const verified = await f.store.snapshot(); // NEW
    assert.equal(objects(verified.xml).get(key).label, 'Accepted'); // NEW
    assert.equal(verified.holds[0].userId, 'admin'); assert.equal(verified.attribution[key].userId, 'admin'); // NEW
}); // NEW

test('malformed and tampered checkpoints fail without falling back to archive replay', async t => { // NEW
    const f = await fixture(t), directory = path.join(f.root, '.trellis', 'collaboration-v4'); // NEW
    const head = JSON.parse(await fs.readFile(path.join(directory, 'heads', 'A.json'), 'utf8')).payload; // NEW
    const checkpointFile = path.join(directory, 'checkpoints', head.checkpointId + '.json'); // NEW
    const original = await fs.readFile(checkpointFile, 'utf8'), checkpoint = JSON.parse(original); // NEW
    checkpoint.payload.state.xml = diagram('Forged'); // NEW
    await fs.writeFile(checkpointFile, JSON.stringify(checkpoint)); // NEW
    await assert.rejects(f.create().snapshot(), /checkpoint failed verification/); // NEW
    await fs.writeFile(checkpointFile, original); // NEW
    assert.equal(objects((await f.create().snapshot()).xml).get(key).label, 'Initial'); // NEW
}); // NEW

test('a missing accepted predecessor remains retryable without advancing the projection', async t => { // NEW
    const f = await fixture(t); // NEW
    await f.store.action(1, 'admin', { kind: 'save', baseXml: diagram(), xml: diagram('Pending delivery') }); // NEW
    const directory = path.join(f.root, '.trellis', 'collaboration-v4'), head = JSON.parse(await fs.readFile(path.join(directory, 'heads', 'A.json'), 'utf8')).payload; // NEW
    const filename = path.join(directory, 'epochs', head.epoch, '000000000001.json'), delivered = await fs.readFile(filename); // CHANGE
    await fs.rename(filename, filename + '.delayed'); // NEW
    const follower = f.create(); await assert.rejects(follower.snapshot(), /ENOENT/); // NEW
    assert.equal(objects(await fs.readFile(f.canvas.diagramPath, 'utf8')).get(key).label, 'Pending delivery'); // NEW
    await fs.writeFile(filename, delivered); // NEW
    assert.equal(objects((await follower.snapshot()).xml).get(key).label, 'Pending delivery'); // NEW
}); // NEW

test('repeating initialization preserves accepted content and rejects a different baseline', async t => { // NEW
    const f = await fixture(t); // NEW
    await f.store.action(1, 'admin', { kind: 'save', baseXml: diagram(), xml: diagram('Preserved') }); // NEW
    const core = createCurrentStateStore(f.parameters), before = await core.read(); // NEW
    const repeated = await core.initialize(diagram()); // NEW
    assert.equal(repeated.sequence, before.sequence); assert.equal(repeated.xml, before.xml); // NEW
    await assert.rejects(core.initialize(diagram('Different baseline')), /different initial snapshot/); // NEW
}); // NEW

test('requested handoffs survive expiry, block the previous holder, and cannot be delayed by activity', () => { // NEW
    const event = (kind, sessionId, at, fields = {}) => ({ id: kind + '-' + sessionId + '-' + at, deviceId: 'A', userId: 'admin', sessionId, kind, at, ...fields }); // NEW
    let state = { xml: diagram(), attribution: {}, holds: [], presence: [], reservations: [] }; // NEW
    const claim = event('claim', 'holder', 1000, { targets: [key], holdPolicy: 'request' }); // NEW
    state = applyCurrentEvent(state, claim); // NEW
    state = applyCurrentEvent(state, event('request', 'waiter', 2000, { claimIds: [claim.id] })); // NEW
    state = applyCurrentEvent(state, event('activity', 'holder', 3000, { claimIds: [claim.id] })); // NEW
    assert.equal(state.holds[0].expiresAt, 2000 + REQUEST_GRACE_MS); // NEW
    state = applyCurrentEvent(state, event('claim', 'holder', 4000, { targets: [key], holdPolicy: 'request' })); // NEW
    assert.equal(state.holds[0].expiresAt, 2000 + REQUEST_GRACE_MS, 'Renewing a claim cannot bypass its requested handoff.'); // NEW
    const deadline = 2000 + REQUEST_GRACE_MS; // NEW
    state = expireCurrentState(state, deadline + 1); // NEW
    assert.equal(state.holds.length, 0); assert.equal(state.reservations[0].sessionId, 'waiter'); // NEW
    assert.equal(state.reservations[0].until, deadline + HANDOFF_MS); // NEW
    assert.throws(() => applyCurrentEvent(state, event('claim', 'holder', deadline + 2, { targets: [key] })), /priority/); // NEW
    state = applyCurrentEvent(state, event('claim', 'waiter', deadline + 3, { targets: [key] })); // NEW
    assert.equal(state.holds[0].sessionId, 'waiter'); assert.equal(state.reservations.length, 0); // NEW
}); // NEW

test('late expiry cannot restart a handoff reservation and release cancels a waiting request', () => { // NEW
    const event = (kind, sessionId, at, fields = {}) => ({ id: kind + '-' + sessionId + '-' + at, deviceId: 'A', userId: 'admin', sessionId, kind, at, ...fields }); // NEW
    const initial = { xml: diagram(), attribution: {}, holds: [], presence: [], reservations: [] }; // NEW
    const claim = event('claim', 'holder', 1000, { targets: [key], holdPolicy: 'request' }); // NEW
    const requested = applyCurrentEvent(applyCurrentEvent(initial, claim), event('request', 'waiter', 2000, { claimIds: [claim.id] })); // NEW
    assert.equal(expireCurrentState(requested, 2000 + REQUEST_GRACE_MS + HANDOFF_MS).reservations.length, 0); // NEW
    const cancelled = applyCurrentEvent(requested, event('release', 'waiter', 3000)); // NEW
    assert.equal(applyCurrentEvent(cancelled, event('release', 'holder', 4000)).reservations.length, 0); // NEW
}); // NEW
