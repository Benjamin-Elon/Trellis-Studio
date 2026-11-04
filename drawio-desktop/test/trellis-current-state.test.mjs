/** Exercise real signed persistence and production save/view adapters without historical replay. */ // NEW
import test from 'node:test'; // NEW
import assert from 'node:assert/strict'; // NEW
import fs from 'node:fs/promises'; // NEW
import os from 'node:os'; // NEW
import path from 'node:path'; // NEW
import crypto from 'node:crypto'; // NEW
import { createCollaborationStore } from '../src/main/trellis-collaboration-store.js'; // NEW
import { createCurrentStateStore, applyCurrentEvent, expireCurrentState, CHECKPOINT_BYTES } from '../src/main/trellis-current-state.js'; // CHANGE
import { objects, diffObjects, REQUEST_GRACE_MS, HANDOFF_MS } from '../src/main/trellis-collaboration-protocol.js'; // CHANGE
import { signRecord, digest, canonical, inspectDiagram } from '../src/main/trellis-share-protocol.js'; // NEW

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

test('save and initialization always return complete independently versioned accepted policy, including duplicate retries', async t => { // CHANGE
    const f = await fixture(t), opened = await f.store.action(1, 'admin', { kind: 'open-view', explicitRefresh: true }), first = opened.collaboration; assert.ok(first.policy); assert.ok(Number.isSafeInteger(first.policyRevision)); // CHANGE
    const get = await f.store.action(1, 'admin', { kind: 'get' }); assert.ok(get.collaboration.policy); assert.equal(get.collaboration.policyRevision, first.policyRevision); // CHANGE
    const xml = diagram('Accepted'), input = { kind: 'save', proposalId: 'policy-save', baseXml: diagram(), xml, explicitRefresh: true }, saved = await f.store.action(1, 'admin', input); assert.equal(saved.ok, true); assert.ok(saved.collaboration.policy); assert.ok(saved.collaboration.policyRevision > first.policyRevision); // CHANGE
    const retry = await f.store.action(1, 'admin', input); assert.equal(retry.duplicate, true); assert.ok(retry.collaboration.policy); assert.equal(retry.collaboration.policyRevision, saved.collaboration.policyRevision); // CHANGE
}); // CHANGE
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
    const commit = signRecord({ schema: 4, shareId: 'garden', diagramId: 'diagram', kind: 'commit', epoch: head.epoch, sequence: 1, previous: head.hash, acceptedAt: claim.payload.at, proposal: claim, contentHash: digest(diagram()) }, f.keys.privateKey); // CHANGE
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
    assert.ok(recoveries.at(-1).proposal.id, 'The original submission ID survives alongside the draft.'); // NEW
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

test('proposal receipts survive restart, return the original result, and reject ID collisions', async t => { // NEW
    const f = await fixture(t), core = createCurrentStateStore(f.parameters), actor = { userId: 'admin', sessionId: 'retry-window' }; // NEW
    const first = await core.append(actor, 'view', { id: 'retry', targets: [] }); // NEW
    const sequence = (await core.read()).sequence, restarted = createCurrentStateStore(f.parameters); // NEW
    assert.deepEqual(await restarted.append(actor, 'view', { id: 'retry', targets: [] }), first); // NEW
    assert.equal((await restarted.read()).sequence, sequence); // NEW
    await assert.rejects(restarted.append(actor, 'view', { id: 'retry', targets: [key] }), /ID was reused/); // NEW
    await assert.rejects(restarted.append({ ...actor, userId: 'visitor' }, 'view', { id: 'retry', targets: [] }), /ID was reused/); // NEW
}); // NEW

test('production save retries cannot reapply an earlier edit after later content changes', async t => { // NEW
    const f = await fixture(t), input = { kind: 'save', proposalId: 'production-save', baseXml: diagram(), xml: diagram('First acceptance') }; // NEW
    assert.equal((await f.store.action(1, 'admin', input)).ok, true); // NEW
    await f.store.action(1, 'admin', { kind: 'save', baseXml: input.xml, xml: diagram() }); // NEW
    const before = await f.store.snapshot(), restarted = f.create(); // NEW
    const result = await restarted.action(2, 'admin', input); // NEW
    assert.equal(result.duplicate, true); assert.equal(result.acceptedPosition.sequence, 1); // NEW
    assert.equal((await restarted.snapshot()).sequence, before.sequence); assert.equal(result.xml, diagram()); // NEW
    await assert.rejects(restarted.action(2, 'admin', { ...input, xml: diagram('ID collision') }), /ID was reused/); // NEW
}); // NEW

test('interrupted receipt persistence repairs the exact decision before a retry is acknowledged', async t => { // NEW
    const f = await fixture(t); let interrupt = true; // NEW
    const core = createCurrentStateStore({ ...f.parameters, writeImmutable: async (filename, value) => { if (interrupt && filename.includes(path.sep + 'receipts' + path.sep)) { interrupt = false; throw new Error('Interrupted receipt write'); } return f.parameters.writeImmutable(filename, value); } }); // NEW
    const actor = { userId: 'admin', sessionId: 'retry-window' }, fields = { id: 'interrupted-receipt', targets: [] }; // NEW
    await assert.rejects(core.append(actor, 'view', fields), /Interrupted receipt/); // NEW
    await core.append(actor, 'view', fields); // NEW
    assert.equal((await core.read()).sequence, 1); // NEW
    assert.equal((await createCurrentStateStore(f.parameters).read()).sequence, 1); // NEW
}); // NEW

test('direct concurrent core operations share one accepted sequence', async t => { // NEW
    const f = await fixture(t), core = createCurrentStateStore(f.parameters), actor = { userId: 'admin', sessionId: 'concurrent-window' }; // NEW
    await Promise.all(Array.from({ length: 32 }, (_, index) => core.append(actor, 'view', { id: 'parallel-' + index, targets: [] }))); // NEW
    assert.equal((await core.read()).sequence, 32); // NEW
    const resumed = await createCurrentStateStore(f.parameters).read(); // NEW
    assert.equal(resumed.sequence, 32); assert.ok(Object.keys(resumed.objectVersions).length > 0); // NEW
}); // NEW

test('even a trusted coordinator cannot publish a structurally inconsistent checkpoint', async t => { // NEW
    const f = await fixture(t), core = createCurrentStateStore(f.parameters), headFile = path.join(core.directory, 'heads', 'A.json'); // NEW
    const originalHead = JSON.parse(await fs.readFile(headFile, 'utf8')).payload; // NEW
    const original = JSON.parse(await fs.readFile(path.join(core.directory, 'checkpoints', originalHead.checkpointId + '.json'), 'utf8')).payload; // NEW
    for (const mutate of [payload => { payload.state.holds = {}; }, payload => { payload.state.objectVersions[key].hash = 'f'.repeat(64); }, payload => { payload.deviceId = 'unapproved'; }, payload => { payload.state.sequence++; }]) { // NEW
        const payload = structuredClone(original); mutate(payload); const envelope = signRecord(payload, f.keys.privateKey), id = digest(canonical(envelope)); // NEW
        await f.parameters.writeImmutable(path.join(core.directory, 'checkpoints', id + '.json'), envelope); // NEW
        await f.parameters.writeAtomic(headFile, JSON.stringify(signRecord({ ...originalHead, checkpointId: id }, f.keys.privateKey))); // NEW
        await assert.rejects(createCurrentStateStore(f.parameters).read(), /Invalid checkpoint/); // NEW
    } // NEW
}); // NEW

test('a signed older head cannot roll back a restarted device', async t => { // NEW
    const f = await fixture(t), core = createCurrentStateStore(f.parameters), headFile = path.join(core.directory, 'heads', 'A.json'); // NEW
    const initialHead = await fs.readFile(headFile, 'utf8'); // NEW
    await f.store.action(1, 'admin', { kind: 'save', baseXml: diagram(), xml: diagram('Verified newer state') }); // NEW
    const newerHead = await fs.readFile(headFile, 'utf8'); // NEW
    await f.parameters.writeAtomic(headFile, initialHead); // NEW
    await assert.rejects(f.create().snapshot(), /private accepted position/); // NEW
    assert.equal(await fs.readFile(f.canvas.diagramPath, 'utf8'), diagram('Verified newer state')); // NEW
    await f.parameters.writeAtomic(headFile, newerHead); // NEW
    assert.equal((await f.create().snapshot()).sequence, 1); // NEW
}); // NEW

test('an unapproved epoch cannot authorize itself in a signed head and checkpoint', async t => { // NEW
    const f = await fixture(t), core = createCurrentStateStore(f.parameters), headFile = path.join(core.directory, 'heads', 'A.json'); // NEW
    const head = JSON.parse(await fs.readFile(headFile, 'utf8')).payload; // NEW
    await f.parameters.writeAtomic(headFile, JSON.stringify(signRecord({ ...head, epoch: 'self-appointed-epoch' }, f.keys.privateKey))); // NEW
    await assert.rejects(f.create().snapshot(), /epoch has not been authorized/); // NEW
}); // NEW

test('public coordination replies never expose mutable policy or recovery caches', async t => { // NEW
    const f = await fixture(t), reply = await f.store.action(1, 'admin', { kind: 'open-view', explicitRefresh: true }); // NEW
    reply.collaboration.policy.store.users[0].admin = false; // NEW
    reply.collaboration.recoveries.push({ filename: 'injected.drawio' }); // NEW
    const next = await f.store.action(2, 'admin', { kind: 'open-view', explicitRefresh: true }); // NEW
    assert.equal(next.collaboration.policy.store.users[0].admin, true); // NEW
    assert.deepEqual(next.collaboration.recoveries, []); // NEW
}); // NEW

test('a private accepted-position failure remains recoverable without duplicate acceptance', async t => { // NEW
    const f = await fixture(t); let fail = true; // NEW
    const core = createCurrentStateStore({ ...f.parameters, writeAtomic: async (filename, contents) => { // NEW
        if (fail && filename.includes(path.sep + 'accepted-positions' + path.sep) && JSON.parse(contents).payload.sequence === 1) { fail = false; throw new Error('Interrupted private position'); } // NEW
        return f.parameters.writeAtomic(filename, contents); // NEW
    } }); // NEW
    const actor = { userId: 'admin', sessionId: 'position-window' }, fields = { id: 'position-retry', targets: [] }; // NEW
    await assert.rejects(core.append(actor, 'view', fields), /Interrupted private position/); // NEW
    const retried = await core.append(actor, 'view', fields); // NEW
    assert.equal(retried.id, fields.id); assert.equal((await core.read()).sequence, 1); // NEW
    assert.equal((await createCurrentStateStore(f.parameters).read()).sequence, 1); // NEW
}); // NEW

test('a save interrupted before decision persistence reuses its original signature and author time', async t => { // NEW
    let time = 1000; const f = await fixture(t, { now: () => time }); let interrupt = true; // NEW
    const core = createCurrentStateStore({ ...f.parameters, writeImmutable: async (filename, value) => { // NEW
        if (interrupt && filename.includes(path.sep + 'epochs' + path.sep)) { interrupt = false; throw new Error('Interrupted before durable decision'); } // NEW
        return f.parameters.writeImmutable(filename, value); // NEW
    } }); // NEW
    const actor = { userId: 'admin', sessionId: 'original-window' }, fields = { id: 'pending-signature', ...diffObjects(diagram(), diagram('Signed before interruption')) }; // NEW
    await assert.rejects(core.append(actor, 'save', fields), /Interrupted before durable decision/); // NEW
    const filename = path.join(f.parameters.profile, 'pending-proposals', 'garden', fields.id + '.json'), pending = JSON.parse(await fs.readFile(filename, 'utf8')); // NEW
    assert.equal(pending.payload.at, 1000); time = 2000; // NEW
    const restarted = createCurrentStateStore(f.parameters); await restarted.append(actor, 'save', fields); // NEW
    const receipt = await restarted.receipt(fields.id); // NEW
    assert.deepEqual(receipt.proposal, pending); assert.equal(receipt.acceptedAt, 2000); // NEW
    assert.equal((await restarted.read()).attribution[key].at, 1000); // NEW
    await restarted.acknowledge(fields.id); await assert.rejects(fs.access(filename), { code: 'ENOENT' }); // NEW
}); // NEW

test('an unaccepted production submission resumes under the same user after its window restarts', async t => { // NEW
    const f = await fixture(t); let interrupt = true; // NEW
    const store = createCollaborationStore({ ...f.parameters, writeImmutable: async (filename, value) => { // NEW
        if (interrupt && filename.includes(path.sep + 'epochs' + path.sep)) { interrupt = false; throw new Error('Interrupted pending production submission'); } // NEW
        return f.parameters.writeImmutable(filename, value); // NEW
    } }); // NEW
    const input = { kind: 'save', proposalId: 'restart-pending', baseXml: diagram(), xml: diagram('Resumed pending submission') }; // NEW
    await assert.rejects(store.action(1, 'admin', input), /Interrupted pending production submission/); // NEW
    const filename = path.join(f.parameters.profile, 'pending-proposals', 'garden', input.proposalId + '.json'), pending = JSON.parse(await fs.readFile(filename, 'utf8')); // NEW
    const reopened = f.create(); assert.equal((await reopened.action(2, 'admin', input)).ok, true); // NEW
    const receipt = await createCurrentStateStore(f.parameters).receipt(input.proposalId); // NEW
    assert.deepEqual(receipt.proposal, pending); assert.equal(receipt.sequence, 1); // NEW
    await assert.rejects(fs.access(filename), { code: 'ENOENT' }); // NEW
}); // NEW

/** Hold validation must scale with state changes, never with the number of held objects. */ // NEW
test('one expiry evaluation shares parsing across many holds and invalidates on policy change', async t => { // NEW
    const { DOMParser } = await import('@xmldom/xmldom'); // NEW
    const extra = Array.from({ length: 80 }, (_, i) => '<object id="wide-' + i + '"><mxCell parent="1" vertex="1"/></object>').join(''); // NEW
    const xml = diagram('Initial', extra), hold = id => ({ key: JSON.stringify(['', id]), claimId: 'claim', deviceId: 'A', sessionId: 'window', userId: 'admin', activeAt: 1, expiresAt: null, requesters: [] }); // NEW
    const state = { xml, holds: [hold('a')], presence: [], reservations: [] }; // NEW
    let parses = 0; const original = DOMParser.prototype.parseFromString; // NEW
    t.mock.method(DOMParser.prototype, 'parseFromString', function (...args) { parses++; return original.apply(this, args); }); // NEW
    assert.equal(expireCurrentState(state, 100).holds.length, 1); const one = parses; parses = 0; // NEW
    const wide = { ...state, holds: [hold('a'), ...Array.from({ length: 80 }, (_, i) => hold('wide-' + i))] }; // NEW
    assert.equal(expireCurrentState(wide, 100).holds.length, 81); assert.equal(parses, one); // NEW
    const revoked = { ...wide, xml: xml.replace('&quot;admin&quot;:true', '&quot;disabled&quot;:true') }; // NEW
    assert.equal(expireCurrentState(revoked, 101).holds.length, 0); // NEW
    assert.equal(expireCurrentState(wide, 102).holds.length, 81); // NEW
}); // NEW

test('oversized accepted tails receive a coalesced checkpoint below the count limit', async t => { // NEW
    const f = await fixture(t), core = createCurrentStateStore(f.parameters), before = await core.read(); // NEW
    await core.append({ userId: 'admin', sessionId: 'window' }, 'release', { id: 'large-record', note: 'x'.repeat(CHECKPOINT_BYTES) }); // NEW
    await core.maintenance(); // NEW
    const head = JSON.parse(await fs.readFile(path.join(core.directory, 'heads', 'A.json'), 'utf8')).payload; // NEW
    assert.equal(head.sequence, before.sequence + 1); assert.equal(head.checkpointSequence, head.sequence); // NEW
    assert.equal((await createCurrentStateStore(f.parameters).read()).sequence, head.sequence); // NEW
}); // NEW

test('background checkpoint failure preserves acceptance and retries without duplicating the proposal', async t => { // NEW
    const f = await fixture(t); let fail = true; // NEW
    const core = createCurrentStateStore({ ...f.parameters, writeImmutable: async (filename, value) => { if (fail && filename.includes('checkpoints')) throw new Error('Injected snapshot failure'); return f.parameters.writeImmutable(filename, value); } }); // NEW
    await core.read(); const input = { id: 'large-retry', note: 'x'.repeat(CHECKPOINT_BYTES) }, actor = { userId: 'admin', sessionId: 'window' }; // NEW
    await core.append(actor, 'release', input); await core.maintenance(); assert.equal((await core.read()).sequence, 1); // NEW
    fail = false; await core.maintenance(); await core.append(actor, 'release', input); assert.equal((await core.read()).sequence, 1); // NEW
}); // NEW

test('worker deadlines and cancellation preserve evidence and release the reconstruction slot', async t => { // NEW
    const { analyzeDocument } = await import('../src/main/trellis-analysis-worker.js'); // NEW
    await assert.rejects(analyzeDocument('current-state', {}, { timeoutMs: 1 }), error => error.code === 'REPLAY_TIMEOUT'); // NEW
    const controller = new AbortController(), task = analyzeDocument('current-state', {}, { signal: controller.signal }); // NEW
    controller.abort(); await assert.rejects(task, error => error.code === 'ABORT_ERR'); // NEW
    const f = await fixture(t); assert.equal((await f.create().snapshot()).xml, diagram()); // NEW
}); // NEW

test('verification-local decoded DOM reuse cannot be mutated or bypass smaller limits', async () => { // NEW
    const { withDiagramInspectionCache, diagramDocument } = await import('../src/main/trellis-share-protocol.js'); // NEW
    await withDiagramInspectionCache(async () => { // NEW
        const xml = diagram(), first = diagramDocument(xml); first.pages[0].doc.documentElement.setAttribute('untrusted', 'true'); // NEW
        assert.equal(diagramDocument(xml).pages[0].doc.documentElement.hasAttribute('untrusted'), false); // NEW
        assert.throws(() => diagramDocument(xml, 1), error => error.code === 'INPUT_LIMIT'); // NEW
        assert.throws(() => diagramDocument('<!DOCTYPE bad>' + xml), error => error.code === 'INVALID_XML'); // NEW
    }); // NEW
}); // NEW

test('a head advancing during cold verification is caught up before readiness', async t => { // NEW
    const f = await fixture(t), writer = createCurrentStateStore(f.parameters); await writer.read(); // NEW
    await writer.append({ userId: 'admin', sessionId: 'writer' }, 'save', { id: 'first', ...diffObjects(diagram(), diagram('First')) }); // NEW
    const filename = path.join(writer.directory, 'heads', 'A.json'), open = fs.open; let reads = 0; // CHANGE
    t.mock.method(fs, 'open', async (...args) => { // CHANGE
        if (String(args[0]) === filename && ++reads === 2) await writer.append({ userId: 'admin', sessionId: 'writer' }, 'save', { id: 'second', ...diffObjects(diagram('First'), diagram('Second')) }); // NEW
        return open(...args); // CHANGE
    }); // NEW
    const state = await createCurrentStateStore(f.parameters).read(); assert.equal(state.sequence, 2); assert.match(state.xml, /Second/); // NEW
    assert.equal(JSON.parse(await fs.readFile(path.join(f.parameters.profile, 'accepted-positions', 'garden', 'A.json'), 'utf8')).payload.sequence, 2); // NEW
}); // NEW

test('cancellation fences queued project requests and prevents late private writes', async t => { // NEW
    const f = await fixture(t); let entered, release, writes = 0; const waiting = new Promise(resolve => { entered = resolve; }), gate = new Promise(resolve => { release = resolve; }); // NEW
    const open = fs.open; let blocked = false; // CHANGE
    t.mock.method(fs, 'open', async (...args) => { if (!blocked && String(args[0]).includes(path.sep + 'checkpoints' + path.sep)) { blocked = true; entered(); await gate; } return open(...args); }); // CHANGE
    const store = createCollaborationStore({ ...f.parameters, writeAtomic: async (...args) => { writes++; return f.parameters.writeAtomic(...args); } }); // NEW
    const first = store.snapshot(), queued = store.snapshot(); const failures = Promise.all([assert.rejects(first, { code: 'ABORT_ERR' }), assert.rejects(queued, { code: 'ABORT_ERR' })]); // NEW
    await waiting; store.cancelVerification(); release(); await failures; await store.flush(); assert.equal(writes, 0); assert.equal(store.readiness(), 'deferred'); // NEW
    assert.equal((await store.snapshot()).xml, diagram()); // NEW
}); // NEW

test('accepted decision bytes trigger a checkpoint across records below the soft budget', async t => { // NEW
    const f = await fixture(t), core = createCurrentStateStore(f.parameters), actor = { userId: 'admin', sessionId: 'window' }; await core.read(); // NEW
    await core.append(actor, 'release', { id: 'near-budget', note: 'x'.repeat(CHECKPOINT_BYTES - 2048) }); await core.maintenance(); // NEW
    const headFile = path.join(core.directory, 'heads', 'A.json'); assert.equal(JSON.parse(await fs.readFile(headFile, 'utf8')).payload.checkpointSequence, 0); // NEW
    await core.append(actor, 'release', { id: 'cross-budget', note: 'x'.repeat(4096) }); await core.maintenance(); // NEW
    const head = JSON.parse(await fs.readFile(headFile, 'utf8')).payload; assert.equal(head.checkpointSequence, 2); // NEW
}); // NEW

test('membership changing while a worker verifies cannot publish the stale result', async t => { // NEW
    const f = await fixture(t), writer = createCurrentStateStore(f.parameters); await writer.read(); await writer.append({ userId: 'admin', sessionId: 'writer' }, 'save', { ...diffObjects(diagram(), diagram('New accepted content')) }); // NEW
    let changed = false, writes = 0; const reader = createCurrentStateStore({ ...f.parameters, writeAtomic: async (...args) => { writes++; return f.parameters.writeAtomic(...args); }, onTiming: sample => { if (!changed && sample.phase === 'verification-commit') { changed = true; f.canvas.members = [...f.canvas.members, { deviceId: 'B', userId: 'visitor', publicKey: f.keys.publicKey }]; } } }); // NEW
    await assert.rejects(reader.read(), { code: 'STALE_VERIFICATION' }); assert.equal(writes, 0); assert.match((await reader.read()).xml, /New accepted content/); // NEW
}); // NEW

test('a crashed verification worker leaves the head, projection and drafts intact and permits retry', async t => { // NEW
    const { Worker } = await import('node:worker_threads'), f = await fixture(t), core = createCurrentStateStore(f.parameters), headFile = path.join(core.directory, 'heads', 'A.json'), before = await fs.readFile(headFile, 'utf8'); // NEW
    const draft = path.join(f.parameters.profile, 'draft.drawio'); await fs.mkdir(f.parameters.profile, { recursive: true }); await fs.writeFile(draft, 'Unaccepted draft'); // NEW
    const emit = Worker.prototype.emit; let crash = true; t.mock.method(Worker.prototype, 'emit', function (event, ...args) { if (crash && event === 'online') { crash = false; void this.terminate(); } return emit.call(this, event, ...args); }); // NEW
    await assert.rejects(core.read(), /stopped before returning/); assert.equal(await fs.readFile(headFile, 'utf8'), before); assert.equal(await fs.readFile(draft, 'utf8'), 'Unaccepted draft'); // NEW
    assert.equal((await core.read()).xml, diagram()); // NEW
}); // NEW

test('shutdown during an immutable checkpoint write cannot publish a late head', async t => { // NEW
    const f = await fixture(t); let entered, release, block = true; const waiting = new Promise(resolve => { entered = resolve; }), gate = new Promise(resolve => { release = resolve; }); // NEW
    const core = createCurrentStateStore({ ...f.parameters, writeImmutable: async (filename, value) => { if (block && filename.includes(path.sep + 'checkpoints' + path.sep)) { block = false; entered(); await gate; } return f.parameters.writeImmutable(filename, value); } }); // NEW
    await core.read(); await core.append({ userId: 'admin', sessionId: 'window' }, 'release', { id: 'checkpoint-shutdown', note: 'x'.repeat(CHECKPOINT_BYTES) }); // NEW
    await waiting; core.cancelVerification(); release(); await core.maintenance(); // NEW
    const headFile = path.join(core.directory, 'heads', 'A.json'), head = JSON.parse(await fs.readFile(headFile, 'utf8')).payload; assert.equal(head.sequence, 1); assert.equal(head.checkpointSequence, 0); // NEW
    await core.read(); await core.maintenance(); assert.equal(JSON.parse(await fs.readFile(headFile, 'utf8')).payload.checkpointSequence, 1); // NEW
}); // NEW

/** Policy intent is carried by the signed mutation; authority comes from accepted policy. */ // CHANGE
test('authorized coordinator policy changes pass while policy intent cannot authorize ownership, grants or roster changes', async t => { // CHANGE
    const f = await fixture(t), before = await f.store.snapshot(), created = diagram('Initial', '<object id="policy-garden" garden_module="1" trellis_owner_user_id="admin"><mxCell parent="1" vertex="1"/></object>'); // CHANGE
    assert.equal((await f.store.action(1, 'admin', { kind: 'save', baseXml: before.xml, xml: created })).ok, true); // CHANGE
    const state = inspectDiagram(created), module = state.cells.find(cell => cell.id === 'policy-garden'); // CHANGE
    module.node.setAttribute('garden_module', '1'); module.node.setAttribute('trellis_owner_user_id', 'admin'); module.node.setAttribute('trellis_access_user_ids_json', JSON.stringify(['visitor'])); // CHANGE
    const accepted = state.document.serialize(), saved = await f.store.action(1, 'admin', { kind: 'save', baseXml: created, xml: accepted, usersPolicyAction: true }); // CHANGE
    assert.equal(saved.ok, true, saved.reason); await f.store.action(1, 'admin', { kind: 'release' }); // CHANGE
    for (const change of ['ownership', 'grants', 'roster']) { // CHANGE
        const draft = inspectDiagram(accepted), cell = draft.cells.find(item => item.id === 'policy-garden'); // CHANGE
        if (change === 'ownership') cell.node.setAttribute('trellis_owner_user_id', 'visitor'); // CHANGE
        if (change === 'grants') cell.node.setAttribute('trellis_access_user_ids_json', JSON.stringify(['visitor', 'stranger'])); // CHANGE
        if (change === 'roster') { draft.store.users.find(user => user.id === 'visitor').admin = true; draft.cells.find(item => item.node.hasAttribute('trellis_users_json')).node.setAttribute('trellis_users_json', JSON.stringify(draft.store)); } // CHANGE
        const xml = draft.document.serialize(), result = await f.store.action(2, 'visitor', { kind: 'save', baseXml: accepted, xml, usersPolicyAction: true }); // CHANGE
        assert.equal(result.ok, false, change); assert.equal(result.code, 'PERMISSION_DENIED', change); assert.equal(await fs.readFile(result.recoveryPath, 'utf8'), xml); assert.equal((await f.store.snapshot()).xml, accepted); // CHANGE
    } // CHANGE
}); // CHANGE
