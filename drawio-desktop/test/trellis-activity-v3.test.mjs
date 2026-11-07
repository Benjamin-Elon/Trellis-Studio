/** Signed activity and private recovery remain independent of a blocked content replay. */ // NEW
import test from 'node:test'; // NEW
import assert from 'node:assert/strict'; // NEW
import fs from 'node:fs/promises'; // NEW
import path from 'node:path'; // NEW
import os from 'node:os'; // NEW
import crypto from 'node:crypto'; // NEW
import { createActivityService, LEASE_MS, REQUEST_MS } from '../src/main/trellis-activity-service.js'; // CHANGE
import { createDraftStore } from '../src/main/trellis-draft-store.js'; // NEW
import { createCollaborationStore } from '../src/main/trellis-collaboration-store.js'; // NEW
import { changedEditingInputs, objects } from '../src/main/trellis-collaboration-protocol.js'; // CHANGE
import { signRecord, digest, canonical } from '../src/main/trellis-share-protocol.js'; // CHANGE

const target = '["page","a"]'; // NEW
test('editing resume compares relevant saved objects, dependencies, structure and generated children', () => { // CHANGE
    const base = initial.replace('id="a" label=', 'id="a" tiler_group="1" label=').replace('</root>', '<object id="b" label="B"><mxCell vertex="1" parent="1"/></object><mxCell id="circle" vertex="1" parent="a"/></root>'); // CHANGE
    assert.deepEqual(changedEditingInputs(base, base.replace('label="B"', 'label="Unrelated"'), [target]), []); // CHANGE
    assert.deepEqual(changedEditingInputs(base, base.replace('label="A"', 'label="Peer edit"'), [target]), [target]); // CHANGE
    assert.ok(changedEditingInputs(base, base.replace('label="B"', 'label="Required"'), [target], ['["page","b"]']).includes('["page","b"]')); // CHANGE
    assert.ok(changedEditingInputs(base, base.replace('<mxCell id="circle" vertex="1" parent="a"/>', ''), [target]).includes('["page","circle"]')); // CHANGE
    assert.ok(changedEditingInputs(base, base.replace('</root>', '<mxCell id="new-circle" vertex="1" parent="a"/></root>'), [target]).includes('["page","new-circle"]')); // CHANGE
    assert.deepEqual(changedEditingInputs(base, base.replace('<diagram id="page">', '<diagram id="page" name="Changed">'), [target]), ['*']); // CHANGE
    assert.throws(() => changedEditingInputs(base, base, ['["page","missing"]']), /baseline is unavailable/); // CHANGE
}); // CHANGE
test('year-plan resume notices changed planting totals but ignores unrelated annotations', () => { // CHANGE
    const garden = initial.replace('id="a" label=', 'id="a" garden_module="1" label=').replace('</root>', '<object id="crop" planting_id="1" label="Crop"><mxCell vertex="1" parent="a"/></object><object id="barn" label="Barn"><mxCell vertex="1" parent="a"/></object></root>'); // CHANGE
    assert.deepEqual(changedEditingInputs(garden, garden.replace('label="Barn"', 'label="Other barn"'), [target], [], 'year-planner'), []); // CHANGE
    assert.ok(changedEditingInputs(garden, garden.replace('label="Crop"', 'label="More crop"'), [target], [], 'year-planner').includes('["page","crop"]')); // CHANGE
    assert.ok(changedEditingInputs(garden, garden.replace('</root>', '<object id="crop2" planting_id="2"><mxCell vertex="1" parent="a"/></object></root>'), [target], [], 'year-planner').includes('["page","crop2"]')); // CHANGE
}); // CHANGE
test('guarded resume re-reads accepted data before acquiring and returns a new terminal-safe activity claim', async t => { // CHANGE
    const f = await fixture(t); let journal, acquisitions = 0; // CHANGE
    const activity = f.activity('device', { sessionFor: (caller, user) => journal.sessionFor(caller, user) }); // CHANGE
    journal = createCollaborationStore({ canvas: f.canvas, deviceId: 'device', keys: f.keys, profile: f.root, writeImmutable: async (file, record) => { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, JSON.stringify(record), { flag: 'wx' }); }, writeAtomic: f.writeAtomic, now: f.now, acquireEditing: async (actor, input) => { acquisitions++; await activity.action(actor.callerId, actor.userId, { kind: 'release', targets: input.targets, claimIds: input.claimIds }); return activity.action(actor.callerId, actor.userId, { kind: 'claim', targets: input.targets }); } }); // CHANGE
    await journal.initialize(initial); const original = await activity.action(1, 'alice', { kind: 'claim', targets: [target] }), old = original.collaboration.holds[0].claimId; // CHANGE
    f.time(LEASE_MS); const expired = await activity.action(1, 'alice', { kind: 'publish' }); assert.equal(expired.collaboration.losses[0].code, 'SESSION_OFFLINE'); assert.equal(expired.collaboration.losses[0].reason, 'Editing hold released after 30 seconds offline.'); // CHANGE
    const resumed = await journal.action(1, 'alice', { kind: 'resume-holds', baseXml: initial, targets: [target], dependencies: [], claimIds: [old] }); // CHANGE
    assert.equal(resumed.ok, true); assert.equal(acquisitions, 1); assert.notEqual(resumed.collaboration.holds[0].claimId, old); // CHANGE
    await activity.action(1, 'alice', { kind: 'release', targets: [target], claimIds: [old] }); assert.equal(activity.snapshot().holds[0].claimId, resumed.collaboration.holds[0].claimId); // CHANGE
    await journal.action(2, 'alice', { kind: 'save', baseXml: initial, xml: initial.replace('label="A"', 'label="Peer changed"') }); // CHANGE
    const refused = await journal.action(1, 'alice', { kind: 'resume-holds', baseXml: initial, targets: [target] }); assert.equal(refused.code, 'EDITING_INPUTS_CHANGED'); assert.equal(acquisitions, 1); // CHANGE
}); // CHANGE
test('explicit discard preserves unrelated actions without attempting private recovery writes', async t => { // CHANGE
    const f = await fixture(t); let failRecovery = false, recoveryWrites = 0; // CHANGE
    const journal = createCollaborationStore({ canvas: f.canvas, deviceId: 'device', keys: f.keys, profile: f.root, writeImmutable: async (file, record) => { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, JSON.stringify(record), { flag: 'wx' }); }, writeAtomic: async (file, value) => { if (file.includes(path.sep + 'recovery' + path.sep)) { recoveryWrites++; if (failRecovery) throw new Error('Disk full'); } await f.writeAtomic(file, value); } }); // CHANGE
    const base = initial.replace('</root>', '<object id="b" label="B"><mxCell vertex="1" parent="1"/></object></root>'); // CHANGE
    await journal.initialize(base); await journal.action(1, 'alice', { kind: 'open-view' }); failRecovery = true; const before = recoveryWrites, draft = base.replace('label="A"', 'label="Abandon"').replace('label="B"', 'label="Keep"'); // CHANGE
    const discarded = await journal.action(1, 'alice', { kind: 'discard-holds', baseXml: base, xml: draft, targets: [target], actions: [[target], ['["page","b"]']] }); // CHANGE
    assert.equal(discarded.ok, true); assert.equal(objects(discarded.xml).get(target).label, 'A'); assert.equal(objects(discarded.xml).get('["page","b"]').label, 'Keep'); assert.equal(recoveryWrites, before); // CHANGE
    const grouped = await journal.action(1, 'alice', { kind: 'discard-holds', baseXml: base, xml: draft, targets: [target], actions: [[target, '["page","b"]']] }); assert.equal(objects(grouped.xml).get('["page","b"]').label, 'B'); // CHANGE
}); // CHANGE
test('recovery copies accept all recoverable editor kinds', async t => { // CHANGE
    const f = await fixture(t), journal = createCollaborationStore({ canvas: f.canvas, deviceId: 'device', keys: f.keys, profile: f.root, writeImmutable: async (file, record) => { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, JSON.stringify(record), { flag: 'wx' }); }, writeAtomic: f.writeAtomic }); await journal.initialize(initial); // CHANGE
    const kinds = ['planting', 'year-planner', 'inventory', 'details', 'label', 'object-form']; // CHANGE
    const recovered = await journal.action(1, 'alice', { kind: 'recover-holds', baseXml: initial, xml: initial, targets: [target], editorDrafts: kinds.map(kind => ({ kind, targets: [target], entries: 'retained' })) }); // CHANGE
    assert.equal(recovered.ok, true); assert.deepEqual(JSON.parse(await fs.readFile(recovered.editorDataPath, 'utf8')).editors.map(editor => editor.kind), kinds); // CHANGE
}); // CHANGE
test('closing or forgetting a pending session retires notices across restart without deleting private drafts', async t => { // CHANGE
    for (const operation of ['close', 'forget']) await t.test(operation, async t => { // CHANGE
        const f = await fixture(t), activity = f.activity(), drafts = createDraftStore({ profile: f.root, canvas: f.canvas, writeAtomic: f.writeAtomic }); // CHANGE
        const checkpoint = { revision: 1, baseXml: initial, xml: initial.replace('label="A"', 'label="Private work"'), editorDrafts: [] }; // CHANGE
        await drafts.checkpoint('alice', 'session-1', checkpoint); // CHANGE
        await drafts.retain('alice', 'session-1', { ...checkpoint, lossId: 'retained-loss', reason: 'Preserved private work.' }); // CHANGE
        await activity.action(1, 'alice', { kind: 'claim', targets: [target] }); // CHANGE
        await activity.action(1, 'alice', { kind: 'publish', pending: [target], revision: 1, saveState: 'failed' }); // CHANGE
        if (operation === 'close') await activity.action(1, 'alice', { kind: 'close' }); else activity.forget(1); // CHANGE
        await activity.close(); assert.equal(activity.snapshot().pendingChanges.length, 0); assert.equal(activity.snapshot().holds.length, 0); // CHANGE
        assert.equal(activity.snapshot().sessions[0].saveState, 'failed', 'retiring activity must not claim unfinished work was saved'); // CHANGE
        const restarted = f.activity(); await restarted.start(); await restarted.action(2, 'alice', { kind: 'publish', pending: [], saveState: 'saved' }); // CHANGE
        assert.deepEqual(restarted.snapshot().pendingChanges, []); // CHANGE
        const recovered = await drafts.restore('alice'); assert.equal(recovered.drafts.length, 2); assert.equal(recovered.drafts[0].xml, checkpoint.xml); assert.equal(recovered.drafts.find(draft => draft.retained).lossId, 'retained-loss'); // CHANGE
        assert.deepEqual((await drafts.restore('bob')).drafts, []); // CHANGE
    }); // CHANGE
}); // CHANGE
test('legacy signed closed-session pending records are ignored without rewriting their files', async t => { // CHANGE
    const f = await fixture(t), activity = f.activity(); await activity.action(1, 'alice', { kind: 'publish', pending: [target], saveState: 'pending' }); await activity.close(); // CHANGE
    const filename = path.join(f.canvas.folderPath, '.trellis/activity-v5', digest('device:session-1') + '.json'), old = JSON.parse(await fs.readFile(filename, 'utf8')); // CHANGE
    const text = JSON.stringify(signRecord({ ...old.payload, sequence: old.payload.sequence + 1, online: false }, f.keys.privateKey)); await f.writeAtomic(filename, text); // CHANGE
    const restarted = f.activity(); await restarted.start(); assert.deepEqual(restarted.snapshot().pendingChanges, []); // CHANGE
    assert.equal(await fs.readFile(filename, 'utf8'), text); // CHANGE
}); // CHANGE
test('unconfirmed pending-only sessions remain visible alongside a saved new session', async t => { // CHANGE
    const f = await fixture(t), activity = f.activity(); await activity.action(1, 'alice', { kind: 'publish', pending: [target], saveState: 'conflict' }); // CHANGE
    f.time(LEASE_MS); await activity.action(2, 'alice', { kind: 'publish', pending: [], saveState: 'saved' }); // CHANGE
    const snapshot = activity.snapshot(); assert.equal(snapshot.holds.length, 0); assert.equal(snapshot.pendingChanges.length, 1); assert.equal(snapshot.pendingChanges[0].online, false); assert.equal(snapshot.pendingChanges[0].saveState, 'conflict'); // CHANGE
}); // CHANGE
test('independent checkpoints preserve unsaved reference snapshots across restart and reject corrupt addresses', async t => { // NEW
    const f = await fixture(t), options = { profile: f.root, canvas: f.canvas, writeAtomic: f.writeAtomic }, drafts = createDraftStore(options), value = { version: 1, note: 'private definitions awaiting publication' }, hash = digest(canonical(value)); // NEW
    const input = { revision: 1, xml: initial, baseXml: initial, editorDrafts: [], references: { [hash]: value } }; // NEW
    await drafts.checkpoint('alice', 'window', input); assert.deepEqual((await createDraftStore(options).restore('alice')).drafts[0].references[hash], value); // NEW
    assert.throws(() => drafts.checkpoint('alice', 'window', { ...input, references: { ['0'.repeat(64)]: value } }), /verification/); // NEW
}); // NEW
test('activity observations increase across services and do not enter signed peer snapshots', async t => { // CHANGE
    const f = await fixture(t), first = f.activity(), second = f.activity('peer'); // CHANGE
    const a = await first.action(1, 'alice', { kind: 'claim', targets: [target] }), b = await second.action(2, 'alice', { kind: 'view', objects: [target] }); // CHANGE
    assert.ok(b.collaboration.observationRevision > a.collaboration.observationRevision); assert.ok(first.snapshot().observationRevision > b.collaboration.observationRevision); // CHANGE
    const names = await fs.readdir(path.join(f.canvas.folderPath, '.trellis/activity-v5')); for (const name of names) { const value = JSON.parse(await fs.readFile(path.join(f.canvas.folderPath, '.trellis/activity-v5', name), 'utf8')); assert.equal(value.payload.observationRevision, undefined); } // CHANGE
}); // CHANGE
test('handoff keeps its five-minute deadline independently of renewed thirty-second heartbeats', async t => { // CHANGE
    const f = await fixture(t), activity = f.activity(); await activity.action(1, 'alice', { kind: 'claim', targets: [target] }); const requested = await activity.action(2, 'alice', { kind: 'request', targets: [target] }); // CHANGE
    assert.equal(requested.collaboration.holds[0].requestDeadline, REQUEST_MS); assert.equal(requested.collaboration.holds[0].expiresAt, REQUEST_MS); // CHANGE
    await heartbeatUntil(f, activity, 1, 290000); await activity.action(2, 'alice', { kind: 'publish' }); const renewed = await activity.action(1, 'alice', { kind: 'publish' }); assert.equal(renewed.collaboration.holds[0].requestDeadline, 300000); // CHANGE: only requester presence is allowed to lapse in a connected-holder handoff.
    f.time(300000); const expired = await activity.action(1, 'alice', { kind: 'snapshot' }); assert.equal(expired.collaboration.holds.length, 0); assert.equal(expired.collaboration.losses[0].code, 'HANDOFF_EXPIRED'); // CHANGE
}); // CHANGE
test('thirty seconds without a heartbeat expires a generation through sleep, restart and delayed publication', async t => { // CHANGE
    const f = await fixture(t), first = f.activity(); // CHANGE
    const claimed = await first.action(1, 'alice', { kind: 'claim', targets: [target], revision: 3 }), claimId = claimed.collaboration.holds[0].claimId; // CHANGE
    f.time(LEASE_MS - 1); assert.equal(first.snapshot().holds[0].claimId, claimId); // CHANGE
    f.time(LEASE_MS); const idle = await first.action(1, 'alice', { kind: 'snapshot' }); // CHANGE
    assert.deepEqual(idle.collaboration.holds, []); assert.equal(idle.collaboration.losses[0].code, 'SESSION_OFFLINE'); // CHANGE
    await first.close(); const restarted = f.activity(); await restarted.start(); // CHANGE
    assert.deepEqual(restarted.snapshot().holds, []); // CHANGE
    const resumed = await restarted.action(1, 'alice', { kind: 'publish', revision: 4 }); // CHANGE
    assert.deepEqual(resumed.collaboration.holds, []); assert.equal(resumed.collaboration.losses[0].code, 'SESSION_OFFLINE'); // CHANGE
    assert.equal((await restarted.action(1, 'alice', { kind: 'claim', targets: [target] })).code, 'HOLD_LOST'); // CHANGE
    await restarted.action(1, 'alice', { kind: 'release', targets: [target], claimIds: [claimId] }); // CHANGE
    const fresh = await restarted.action(1, 'alice', { kind: 'claim', targets: [target] }); assert.notEqual(fresh.collaboration.holds[0].claimId, claimId); // CHANGE
}); // CHANGE
test('a stalled activity write cannot block read-only confirmation of offline loss', async t => { // CHANGE
    const f = await fixture(t); let blocked = false, release; const gate = new Promise(resolve => { release = resolve; }); t.after(release); // CHANGE
    const activity = f.activity('device', { writeAtomic: async (...args) => { if (blocked) await gate; return f.writeAtomic(...args); } }); // CHANGE
    const claimed = await activity.action(1, 'alice', { kind: 'claim', targets: [target] }); blocked = true; // CHANGE
    const publication = activity.action(1, 'alice', { kind: 'publish', revision: 1 }); await new Promise(resolve => setImmediate(resolve)); f.time(REQUEST_MS * 2); // CHANGE
    const confirmed = await activity.action(1, 'alice', { kind: 'snapshot' }); // CHANGE
    try { assert.deepEqual(confirmed.collaboration.holds, []); assert.equal(confirmed.collaboration.losses[0].claimId, claimed.collaboration.holds[0].claimId); assert.equal(confirmed.collaboration.losses[0].code, 'SESSION_OFFLINE'); } finally { release(); await publication; } // CHANGE
}); // CHANGE
test('stale requester presence, repeated requests and delayed delivery keep the original deadline', async t => { // CHANGE
    const f = await fixture(t), owner = f.activity(), requester = f.activity('peer'); // CHANGE
    await owner.action(1, 'alice', { kind: 'claim', targets: [target] }); await requester.start(); // CHANGE
    f.time(1000); await requester.action(2, 'alice', { kind: 'request', targets: [target] }); // CHANGE
    await heartbeatUntil(f, owner, 1, 250000, [requester]); const repeated = await requester.action(2, 'alice', { kind: 'request', targets: [target] }); // CHANGE
    assert.equal(repeated.collaboration.holds[0].requestDeadline, 1000 + REQUEST_MS); // CHANGE
    await owner.scan(); assert.equal(owner.snapshot().holds[0].requestDeadline, 1000 + REQUEST_MS); // CHANGE
    await heartbeatUntil(f, owner, 1, 1000 + REQUEST_MS, [requester]); const expired = await owner.action(1, 'alice', { kind: 'publish' }); // CHANGE
    assert.deepEqual(expired.collaboration.holds, []); assert.equal(expired.collaboration.losses[0].code, 'HANDOFF_EXPIRED'); // CHANGE
    const refused = await owner.action(1, 'alice', { kind: 'claim', targets: [target] }); assert.equal(refused.ok, false); assert.equal(refused.code, 'HOLD_LOST'); // CHANGE
}); // CHANGE
test('explicit requester close or window cleanup cancels a pending request and cannot reopen its session', async t => { // CHANGE
    for (const exit of ['close', 'forget']) await t.test(exit, async t => { // CHANGE
        const f = await fixture(t), activity = f.activity(); // CHANGE
        await activity.action(1, 'alice', { kind: 'claim', targets: [target] }); await activity.action(2, 'alice', { kind: 'request', targets: [target] }); // CHANGE
        f.time(10000); if (exit === 'close') await activity.action(2, 'alice', { kind: 'close' }); else activity.forget(2); await activity.close(); // CHANGE: restart replaces the service rather than running two owners of one device snapshot.
        const restarted = f.activity(); await restarted.start(); await heartbeatUntil(f, restarted, 1, REQUEST_MS * 2); // CHANGE
        assert.equal(restarted.snapshot().holds.length, 1); assert.equal(restarted.snapshot().holds[0].expiresAt, null); // CHANGE
        await assert.rejects(restarted.action(2, 'alice', { kind: 'publish' }), /closed/); // CHANGE
    }); // CHANGE
}); // CHANGE
test('requester exit after the deadline preserves expiry through restart and later owner heartbeats', async t => { // CHANGE
    const f = await fixture(t), activity = f.activity(); // CHANGE
    await activity.action(1, 'alice', { kind: 'claim', targets: [target] }); await activity.action(2, 'alice', { kind: 'request', targets: [target] }); // CHANGE
    await heartbeatUntil(f, activity, 1, REQUEST_MS); await activity.action(2, 'alice', { kind: 'close' }); await activity.close(); // CHANGE
    const restarted = f.activity(); await restarted.start(); const resumed = await restarted.action(1, 'alice', { kind: 'publish' }); // CHANGE
    assert.deepEqual(resumed.collaboration.holds, []); assert.equal(resumed.collaboration.losses[0].code, 'HANDOFF_EXPIRED'); // CHANGE
    assert.equal((await restarted.action(3, 'alice', { kind: 'claim', targets: [target] })).ok, true); // CHANGE
}); // CHANGE
test('multiple requesters retain their own deadlines when an earlier request is cancelled', async t => { // CHANGE
    const f = await fixture(t), activity = f.activity(); await activity.action(1, 'alice', { kind: 'claim', targets: [target] }); // CHANGE
    await activity.action(2, 'alice', { kind: 'request', targets: [target] }); await heartbeatUntil(f, activity, 1, 10000); await activity.action(3, 'alice', { kind: 'request', targets: [target] }); // CHANGE
    await heartbeatUntil(f, activity, 1, 20000); const cancelled = await activity.action(2, 'alice', { kind: 'close' }); // CHANGE
    assert.equal(cancelled.collaboration.holds[0].requestDeadline, 10000 + REQUEST_MS); assert.equal(cancelled.collaboration.holds[0].requesters.length, 1); // CHANGE
    await heartbeatUntil(f, activity, 1, REQUEST_MS); assert.equal(activity.snapshot().holds.length, 1); f.time(10000 + REQUEST_MS); assert.deepEqual(activity.snapshot().holds, []); // CHANGE
}); // CHANGE
test('requests cannot target the same session or an object the requester cannot edit', async t => { // CHANGE
    const f = await fixture(t), activity = f.activity('device', { authorize: user => ['alice', 'bob'].includes(user), canClaim: user => user === 'alice' }); // CHANGE
    await activity.action(1, 'alice', { kind: 'claim', targets: [target] }); // CHANGE
    const self = await activity.action(1, 'alice', { kind: 'request', targets: [target] }); assert.equal(self.collaboration.holds[0].requested, false); // CHANGE
    await assert.rejects(activity.action(2, 'bob', { kind: 'request', targets: [target] }), /Unauthorized release request/); // CHANGE
    assert.equal(activity.snapshot().holds[0].requested, false); // CHANGE
    const otherWindow = await activity.action(3, 'alice', { kind: 'request', targets: [target] }); assert.equal(otherWindow.collaboration.holds[0].requested, true); // CHANGE
}); // CHANGE
test('a signed peer request without object editing authority cannot start a handoff deadline', async t => { // CHANGE
    const f = await fixture(t), authorize = user => ['alice', 'bob'].includes(user); // CHANGE
    const owner = f.activity('device', { authorize, canClaim: user => user === 'alice' }), peer = f.activity('peer', { authorize }); // CHANGE
    await owner.action(1, 'alice', { kind: 'claim', targets: [target] }); await peer.start(); // CHANGE
    await peer.action(2, 'bob', { kind: 'request', targets: [target] }); await owner.scan(); await heartbeatUntil(f, owner, 1, REQUEST_MS * 2, [peer]); // CHANGE
    assert.equal(owner.snapshot().holds.length, 1); assert.equal(owner.snapshot().holds[0].requested, false); // CHANGE
}); // CHANGE
test('new acquisitions have distinct generations and old handoff requests never expire them', async t => { // CHANGE
    const f = await fixture(t), activity = f.activity(); // CHANGE
    const original = await activity.action(1, 'alice', { kind: 'claim', targets: [target] }), firstId = original.collaboration.holds[0].claimId; // CHANGE
    await activity.action(2, 'alice', { kind: 'request', targets: [target] }); await activity.action(1, 'alice', { kind: 'release', targets: [target] }); // CHANGE
    const fresh = await activity.action(1, 'alice', { kind: 'claim', targets: [target] }); // CHANGE
    assert.notEqual(fresh.collaboration.holds[0].claimId, firstId); assert.equal(fresh.collaboration.holds[0].requested, false); // CHANGE
    await activity.action(1, 'alice', { kind: 'release', targets: [target], claimIds: [firstId] }); assert.equal(activity.snapshot().holds[0].claimId, fresh.collaboration.holds[0].claimId); // CHANGE: a delayed old editor cannot release the new generation.
    await heartbeatUntil(f, activity, 1, REQUEST_MS); const current = await activity.action(1, 'alice', { kind: 'publish' }); // CHANGE
    assert.equal(current.collaboration.holds.length, 1); assert.equal(current.collaboration.holds[0].expiresAt, null); assert.deepEqual(current.collaboration.losses, []); // CHANGE
}); // CHANGE
test('reordered signed snapshots and attempts to rewrite requests cannot resurrect expired ownership', async t => { // CHANGE
    const f = await fixture(t), owner = f.activity(), requester = f.activity('peer'); // CHANGE
    await owner.action(1, 'alice', { kind: 'claim', targets: [target] }); await requester.start(); // CHANGE
    await requester.action(2, 'alice', { kind: 'request', targets: [target] }); await owner.scan(); // CHANGE
    const file = path.join(f.canvas.folderPath, '.trellis/activity-v5', digest('peer:session-2') + '.json'), envelope = JSON.parse(await fs.readFile(file, 'utf8')); // CHANGE
    await heartbeatUntil(f, owner, 1, REQUEST_MS, [requester]); assert.deepEqual(owner.snapshot().holds, []); // CHANGE
    for (const payload of [{ ...envelope.payload, sequence: envelope.payload.sequence - 1, requests: [] }, { ...envelope.payload, sequence: envelope.payload.sequence + 1, requests: [] }, { ...envelope.payload, sequence: envelope.payload.sequence + 1, requests: envelope.payload.requests.map(request => ({ ...request, at: REQUEST_MS })) }]) { // CHANGE
        await f.writeAtomic(file, JSON.stringify(signRecord(payload, f.keys.privateKey))); await owner.scan(); assert.deepEqual(owner.snapshot().holds, []); // CHANGE
    } // CHANGE
    await f.writeAtomic(file, JSON.stringify(envelope)); await owner.close(); const restarted = f.activity(); await restarted.start(); // CHANGE
    const resumed = await restarted.action(1, 'alice', { kind: 'publish' }); assert.deepEqual(resumed.collaboration.holds, []); assert.equal(resumed.collaboration.losses[0].code, 'HANDOFF_EXPIRED'); // CHANGE
}); // CHANGE
test('retained losses survive checkpoints, checkpoint discard and restart with author isolation and immutable retries', async t => { // CHANGE
    const f = await fixture(t), options = { profile: f.root, canvas: f.canvas, writeAtomic: f.writeAtomic }, store = createDraftStore(options); // CHANGE
    const input = { lossId: 'loss-a', reason: 'Access changed', revision: 1, baseXml: initial, xml: initial.replace('label="A"', 'label="Private"'), editorDrafts: [{ kind: 'label', targets: [target], text: 'unsubmitted' }] }; // CHANGE
    await Promise.all([store.retain('alice', 'window', input), store.retain('alice', 'window', input)]); // CHANGE
    await store.checkpoint('alice', 'window', { ...input, revision: 2, xml: initial, editorDrafts: [] }); await store.discard('alice', 'window', 2); // CHANGE
    const restart = createDraftStore(options), records = (await restart.restore('alice')).drafts; assert.equal(records.length, 1); assert.equal(records[0].retained, true); assert.equal(records[0].editorDrafts[0].text, 'unsubmitted'); assert.equal((await restart.restore('bob')).drafts.length, 0); // CHANGE
    await restart.retain('alice', 'window', input); await assert.rejects(restart.retain('alice', 'window', { ...input, xml: initial }), /different work/); assert.equal((await restart.restore('alice')).drafts.length, 1); // CHANGE
}); // CHANGE
test('a failed retention write remains retryable without losing a previous retained loss', async t => { // CHANGE
    const f = await fixture(t); let failing = false; const store = createDraftStore({ profile: f.root, canvas: f.canvas, writeAtomic: (file, value) => { if (failing) throw new Error('Disk full'); return f.writeAtomic(file, value); } }); // CHANGE
    const input = { lossId: 'first', reason: 'Heartbeat ended', revision: 1, baseXml: initial, xml: initial, editorDrafts: [{ kind: 'details', targets: [target], html: 'retained' }] }; // CHANGE
    await store.retain('alice', 'window', input); failing = true; await assert.rejects(store.retain('alice', 'window', { ...input, lossId: 'second' }), /Disk full/); assert.equal((await store.restore('alice')).drafts.length, 1); // CHANGE
    failing = false; await store.retain('alice', 'window', { ...input, lossId: 'second' }); assert.equal((await store.restore('alice')).drafts.length, 2); // CHANGE
}); // CHANGE
test('a close checkpoint waits for newer editor entries at the same model revision', async t => { // NEW
    const f = await fixture(t), releases = [], captures = []; // NEW
    const drafts = createDraftStore({ profile: f.root, canvas: f.canvas, writeAtomic: (file, value) => new Promise(resolve => { captures.push(JSON.parse(value)); releases.push(async () => { await f.writeAtomic(file, value); resolve(); }); }) }); // NEW
    const input = { revision: 1, xml: initial, baseXml: initial, editorDrafts: [] }; // NEW
    const first = drafts.checkpoint('alice', 'window', input); let closed = false; // NEW
    const close = drafts.checkpoint('alice', 'window', { ...input, editorDrafts: [{ kind: 'planting', targets: [target], data: 'new entry' }] }).then(() => { closed = true; }); // NEW
    await releases.shift()(); await first; await new Promise(resolve => setImmediate(resolve)); // NEW
    assert.equal(closed, false); assert.equal(captures.length, 2); await releases.shift()(); await close; // NEW
    assert.equal((await drafts.restore('alice')).drafts[0].editorDrafts[0].data, 'new entry'); // NEW
}); // NEW
const initial = '<mxfile><diagram id="page"><mxGraphModel><root><mxCell id="0"/><object id="1" trellis_users_json="{&quot;users&quot;:[{&quot;id&quot;:&quot;alice&quot;,&quot;admin&quot;:true}]}"><mxCell parent="0"/></object><object id="a" label="A"><mxCell vertex="1" parent="1"/></object></root></mxGraphModel></diagram></mxfile>'; // NEW
async function fixture(t) { // NEW
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'trellis-activity-v3-')); t.after(() => fs.rm(root, { recursive: true, force: true })); // NEW
    const pair = crypto.generateKeyPairSync('ed25519'), keys = { publicKey: pair.publicKey.export({ type: 'spki', format: 'pem' }), privateKey: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }) }; // NEW
    const canvas = { protocolVersion: 5, shareId: 'project', diagramId: 'diagram', folderPath: path.join(root, 'project'), diagramPath: path.join(root, 'project', 'Garden.drawio'), coordinatorDeviceId: 'device', coordinatorPublicKey: keys.publicKey, members: [{ deviceId: 'device', userId: 'alice', publicKey: keys.publicKey }, { deviceId: 'peer', userId: 'alice', publicKey: keys.publicKey }] }; // CHANGE
    let time = 0; const mono = () => time; // NEW
    const writeAtomic = async (file, value) => { await fs.mkdir(path.dirname(file), { recursive: true }); const temp = file + '.' + crypto.randomUUID() + '.tmp'; await fs.writeFile(temp, value); for (let attempt = 0; ; attempt++) { try { await fs.rename(temp, file); break; } catch (error) { if (!['EPERM', 'EBUSY', 'EACCES'].includes(error.code) || attempt >= 4) throw error; await new Promise(resolve => setTimeout(resolve, 25 * (attempt + 1))); } } }; // CHANGE: match production's bounded Windows scanner retry.
    const services = []; const activity = (id = 'device', options = {}) => { const service = createActivityService({ canvas, deviceId: id, keys, sessionFor: caller => 'session-' + caller, writeAtomic, monotonic: mono, now: mono, authorize: user => user === 'alice', ...options }); services.push(service); return service; }; // CHANGE
    t.after(async () => { for (const service of services) await service.close(); }); // NEW
    return { root, canvas, keys, writeAtomic, activity, now: mono, time: value => { time = value; } }; // CHANGE
} // NEW
/** Advance the test clock while the holder stays connected, independently of typing and requester presence. */ // CHANGE
async function heartbeatUntil(f, activity, caller, through, observers = []) { // CHANGE
    while (f.now() < through) { f.time(Math.min(through, f.now() + LEASE_MS / 2)); await activity.action(caller, 'alice', { kind: 'publish' }); for (const observer of observers) await observer.scan(); } // CHANGE
} // CHANGE
test('remote startup grace and fresh progression end in automatic takeover without a release request', async t => { // CHANGE
    const f = await fixture(t), peer = f.activity('peer'), local = f.activity(); // NEW
    await peer.action(2, 'alice', { kind: 'claim', targets: [target] }); await local.start(); assert.equal(local.snapshot().holds.length, 1); assert.equal(local.snapshot().holds[0].expiresAt, null); assert.equal(local.snapshot().holds[0].online, false); // CHANGE
    f.time(5000); await peer.action(2, 'alice', { kind: 'publish', pending: [target], revision: 1 }); await local.scan(); assert.equal(local.snapshot().holds.length, 1); // NEW
    f.time(5000 + LEASE_MS - 1); await local.scan(); assert.equal(local.snapshot().holds.length, 1); // NEW
    f.time(5000 + LEASE_MS); await local.scan(); assert.equal(local.snapshot().holds.length, 0); assert.equal(local.snapshot().pendingChanges[0].online, false); // CHANGE
    assert.deepEqual(local.snapshot().presence, []); // CHANGE: offline work stays in pendingChanges without being relabeled as viewing.
    assert.equal((await local.action(1, 'alice', { kind: 'claim', targets: [target] })).ok, true); // CHANGE
    await peer.scan(); const returned = await peer.action(2, 'alice', { kind: 'publish' }); // CHANGE
    assert.equal(returned.collaboration.losses[0].code, 'SESSION_OFFLINE'); assert.equal(returned.collaboration.holds.some(hold => hold.sessionId === 'session-2'), false); // CHANGE
}); // NEW
test('viewing-only startup snapshots stay hidden until a fresh heartbeat arrives', async t => { // CHANGE
    const f = await fixture(t), peer = f.activity('peer'), local = f.activity(); // NEW
    await peer.action(2, 'alice', { kind: 'view', objects: [target] }); await local.start(); // NEW
    assert.deepEqual(local.snapshot().presence, []); assert.equal(local.snapshot().holds.length, 0); // CHANGE
    f.time(5000); await peer.action(2, 'alice', { kind: 'publish' }); await local.scan(); assert.equal(local.snapshot().presence[0].online, true); // NEW
}); // NEW
test('the existing maintenance timer removes stale viewers and fresh progression restores them without a status refresh', async t => { // CHANGE
    const timers = [], interval = globalThis.setInterval; // CHANGE
    t.mock.method(globalThis, 'setInterval', (callback, delay, ...args) => { if (delay === 1000) timers.push(callback); return interval(callback, delay, ...args); }); // CHANGE: observe the production timer without adding a service interface or another timer.
    const f = await fixture(t), updates = [], owner = f.activity('peer'), observer = f.activity('device', { onChange: state => updates.push(state) }); // CHANGE
    await owner.action(2, 'alice', { kind: 'view', objects: [target] }); await observer.start(); // CHANGE
    assert.deepEqual(updates.at(-1).presence, []); assert.equal(timers.length, 2); // CHANGE
    f.time(5000); await owner.action(2, 'alice', { kind: 'publish' }); await observer.scan(); // CHANGE
    assert.equal(updates.at(-1).presence[0].online, true); assert.deepEqual(updates.at(-1).presence[0].targets, [target]); // CHANGE
    const filename = path.join(f.canvas.folderPath, '.trellis/activity-v5', digest('peer:session-2') + '.json'), text = await fs.readFile(filename, 'utf8'); // CHANGE
    f.time(5000 + LEASE_MS - 1); await observer.scan(); await observer.action(1, 'alice', { kind: 'snapshot' }); // CHANGE
    assert.equal(observer.snapshot().presence.length, 1); // CHANGE: duplicate reads and authority snapshots do not renew the viewer lease.
    f.time(5000 + LEASE_MS); timers[1](); // CHANGE: exercise automatic expiry before any UI interaction or explicit snapshot request.
    assert.deepEqual(updates.at(-1).presence, []); await observer.scan(); // CHANGE
    assert.equal(await fs.readFile(filename, 'utf8'), text); // CHANGE: retiring a viewing badge never deletes or rewrites the stored activity.
    const envelope = JSON.parse(text); // CHANGE
    await f.writeAtomic(filename, JSON.stringify(signRecord({ ...envelope.payload, sequence: envelope.payload.sequence - 1 }, f.keys.privateKey))); await observer.scan(); // CHANGE
    assert.deepEqual(observer.snapshot().presence, []); // CHANGE: delayed snapshots cannot resurrect an expired viewer.
    f.time(5000 + LEASE_MS + 5000); await owner.action(2, 'alice', { kind: 'publish' }); await observer.scan(); // CHANGE
    assert.equal(updates.at(-1).presence.length, 1); assert.equal(updates.at(-1).presence[0].online, true); // CHANGE
    f.time(5000 + LEASE_MS * 2); await owner.action(2, 'alice', { kind: 'publish' }); await observer.scan(); // CHANGE
    assert.equal(observer.snapshot().presence.length, 1); // CHANGE: continuing heartbeats keep passive viewing visible.
    await owner.action(2, 'alice', { kind: 'close' }); await observer.scan(); assert.deepEqual(observer.snapshot().presence, []); // CHANGE
}); // CHANGE
test('hiding unconfirmed viewers preserves startup hold grace and offline pending-work notices', async t => { // CHANGE
    const f = await fixture(t), owner = f.activity('peer'), observer = f.activity(); // CHANGE
    await owner.action(2, 'alice', { kind: 'claim', targets: [target] }); await owner.action(2, 'alice', { kind: 'view', objects: [target], pending: [target], saveState: 'failed' }); // CHANGE
    await observer.start(); assert.deepEqual(observer.snapshot().presence, []); assert.equal(observer.snapshot().holds.length, 1); // CHANGE
    assert.equal(observer.snapshot().pendingChanges[0].saveState, 'failed'); // CHANGE
    f.time(LEASE_MS - 1); assert.equal(observer.snapshot().holds.length, 1); assert.deepEqual(observer.snapshot().presence, []); // CHANGE
    f.time(LEASE_MS); await observer.scan(); assert.deepEqual(observer.snapshot().holds, []); assert.deepEqual(observer.snapshot().presence, []); // CHANGE
    assert.equal(observer.snapshot().pendingChanges[0].saveState, 'failed'); assert.equal(observer.snapshot().pendingChanges[0].online, false); // CHANGE
}); // CHANGE
test('connected passive editors keep their holds and startup records get only one thirty-second grace', async t => { // CHANGE
    const f = await fixture(t), owner = f.activity('peer'); // CHANGE
    const claimed = await owner.action(2, 'alice', { kind: 'claim', targets: [target] }); // CHANGE
    await heartbeatUntil(f, owner, 2, LEASE_MS * 3); // CHANGE: no input or graph activity accompanies these heartbeats.
    assert.equal(owner.snapshot().holds[0].claimId, claimed.collaboration.holds[0].claimId); await owner.close(); // CHANGE
    f.time(1000000); const observer = f.activity(); await observer.start(); // CHANGE
    assert.equal(observer.snapshot().holds[0].online, false); // CHANGE
    f.time(1000000 + LEASE_MS - 1); await observer.scan(); assert.equal(observer.snapshot().holds.length, 1); // CHANGE: rereading an unchanged signed snapshot cannot renew startup grace.
    f.time(1000000 + LEASE_MS); await observer.scan(); assert.equal(observer.snapshot().holds.length, 0); // CHANGE
    await observer.close(); const restarted = f.activity(); await restarted.start(); assert.equal(restarted.snapshot().holds.length, 0); // CHANGE
}); // CHANGE
test('offline expiry is persisted before takeover and a failed witness write retries safely', async t => { // CHANGE
    const f = await fixture(t); let failing = false; // CHANGE
    const activity = f.activity('device', { writeAtomic: async (...args) => { if (failing) throw new Error('Expiry disk full'); return f.writeAtomic(...args); } }); // CHANGE
    const claimed = await activity.action(1, 'alice', { kind: 'claim', targets: [target] }); // CHANGE
    f.time(LEASE_MS); failing = true; // CHANGE
    try { await assert.rejects(activity.action(2, 'alice', { kind: 'claim', targets: [target] }), /Expiry disk full/); assert.equal(activity.snapshot().holds.length, 0); } finally { failing = false; } // CHANGE
    const takeover = await activity.action(2, 'alice', { kind: 'claim', targets: [target] }); assert.equal(takeover.ok, true); // CHANGE
    const file = path.join(f.canvas.folderPath, '.trellis/activity-v5', digest('device:expiry-' + digest('alice')) + '.json'); // CHANGE
    const evidence = JSON.parse(await fs.readFile(file, 'utf8')).payload.requests[0]; // CHANGE
    assert.equal(evidence.claimId, claimed.collaboration.holds[0].claimId); assert.equal(evidence.kind, 'offline-expiry'); assert.equal(evidence.cancelledAt, null); // CHANGE
    await activity.action(2, 'alice', { kind: 'close' }); await activity.close(); // CHANGE
    const restarted = f.activity(); const resumed = await restarted.action(1, 'alice', { kind: 'publish' }); // CHANGE
    assert.equal(resumed.collaboration.losses[0].code, 'SESSION_OFFLINE'); assert.equal(resumed.collaboration.holds.length, 0); // CHANGE
}); // CHANGE
test('offline expiry cannot be rewritten or cancelled and an old release cannot end a fresh generation', async t => { // CHANGE
    const f = await fixture(t), observer = f.activity(), owner = f.activity('peer'); // CHANGE
    const original = await owner.action(2, 'alice', { kind: 'claim', targets: [target] }), claimId = original.collaboration.holds[0].claimId; // CHANGE
    await observer.start(); f.time(LEASE_MS); await observer.scan(); // CHANGE
    const file = path.join(f.canvas.folderPath, '.trellis/activity-v5', digest('device:expiry-' + digest('alice')) + '.json'), envelope = JSON.parse(await fs.readFile(file, 'utf8')); // CHANGE
    for (const requests of [[], envelope.payload.requests.map(request => ({ ...request, kind: undefined })), envelope.payload.requests.map(request => ({ ...request, cancelledAt: request.at }))]) { // CHANGE
        await f.writeAtomic(file, JSON.stringify(signRecord({ ...envelope.payload, sequence: envelope.payload.sequence + 1, requests }, f.keys.privateKey))); await observer.scan(); assert.equal(observer.snapshot().holds.length, 0); // CHANGE
    } // CHANGE
    await f.writeAtomic(file, JSON.stringify(envelope)); await owner.scan(); // CHANGE
    await owner.action(2, 'alice', { kind: 'release', targets: [target], claimIds: [claimId] }); // CHANGE
    const fresh = await owner.action(2, 'alice', { kind: 'claim', targets: [target] }); assert.equal(fresh.ok, true); assert.notEqual(fresh.collaboration.holds[0].claimId, claimId); // CHANGE
    await owner.action(2, 'alice', { kind: 'release', targets: [target], claimIds: [claimId] }); assert.equal(owner.snapshot().holds[0].claimId, fresh.collaboration.holds[0].claimId); // CHANGE
}); // CHANGE
test('expiry discovered during another witness write is durable before a concurrent takeover completes', async t => { // CHANGE
    const f = await fixture(t); let release, entered, block = false; // CHANGE
    const gate = new Promise(resolve => { release = resolve; }), started = new Promise(resolve => { entered = resolve; }); // CHANGE
    const activity = f.activity('device', { writeAtomic: async (file, text) => { if (block && JSON.parse(text).payload.sessionId.startsWith('expiry-')) { block = false; entered(); await gate; } return f.writeAtomic(file, text); } }); // CHANGE
    const second = '["page","b"]'; await activity.action(1, 'alice', { kind: 'claim', targets: [target] }); // CHANGE
    f.time(1000); await activity.action(2, 'alice', { kind: 'claim', targets: [second] }); // CHANGE
    f.time(LEASE_MS); block = true; const flushing = activity.scan(); await started; // CHANGE
    try { // CHANGE
        f.time(LEASE_MS + 1000); assert.equal(activity.snapshot().holds.length, 0); // CHANGE
        const takeover = activity.action(3, 'alice', { kind: 'claim', targets: [second] }); release(); await flushing; assert.equal((await takeover).ok, true); // CHANGE
        const file = path.join(f.canvas.folderPath, '.trellis/activity-v5', digest('device:expiry-' + digest('alice')) + '.json'); // CHANGE
        assert.deepEqual(JSON.parse(await fs.readFile(file, 'utf8')).payload.requests.map(request => request.key).sort(), [target, second].sort()); // CHANGE
    } finally { release(); await flushing; } // CHANGE
}); // CHANGE
test('terminal evidence rolls over bounded pages without renewing expired human sessions', async t => { // CHANGE
    const f = await fixture(t), activity = f.activity(), targets = Array.from({ length: 513 }, (_, index) => JSON.stringify(['page', String(index)])); // CHANGE
    await activity.action(1, 'alice', { kind: 'claim', targets }); f.time(LEASE_MS); await activity.scan(); // CHANGE
    const directory = path.join(f.canvas.folderPath, '.trellis/activity-v5'), records = await Promise.all((await fs.readdir(directory)).filter(name => name.endsWith('.json')).map(name => fs.readFile(path.join(directory, name), 'utf8').then(JSON.parse))); // CHANGE
    const witnesses = records.filter(record => record.payload.sessionId.startsWith('expiry-')); // CHANGE
    assert.equal(witnesses.length, 2); assert.equal(witnesses.reduce((total, record) => total + record.payload.requests.length, 0), targets.length); // CHANGE
    assert.ok(witnesses.every(record => record.payload.requests.length <= 512 && Buffer.byteLength(JSON.stringify(record)) < 256 * 1024)); // CHANGE
    assert.equal(activity.snapshot().sessions.length, 1); assert.equal(activity.snapshot().sessions[0].online, false); assert.equal(activity.snapshot().holds.length, 0); // CHANGE
    await activity.close(); const restarted = f.activity(); const resumed = await restarted.action(1, 'alice', { kind: 'publish' }); assert.equal(resumed.collaboration.losses.length, targets.length); // CHANGE
}); // CHANGE
test('offline expiry uses monotonic receipt time even when wall clocks jump backwards or forwards', async t => { // CHANGE
    const f = await fixture(t); let wall = 1000000; const activity = f.activity('device', { now: () => wall }); // CHANGE
    await activity.action(1, 'alice', { kind: 'claim', targets: [target] }); wall = -1000; // CHANGE
    f.time(LEASE_MS - 1); assert.equal(activity.snapshot().holds.length, 1); // CHANGE
    f.time(LEASE_MS); const lost = await activity.action(1, 'alice', { kind: 'publish' }); assert.equal(lost.collaboration.losses[0].code, 'SESSION_OFFLINE'); // CHANGE
    wall = 1000000000000; const returned = await activity.action(1, 'alice', { kind: 'publish' }); assert.equal(returned.collaboration.holds.length, 0); assert.equal(returned.collaboration.losses[0].code, 'SESSION_OFFLINE'); // CHANGE
}); // CHANGE
test('closing an already stopped service cannot expire ownership resumed by its replacement', async t => { // CHANGE
    const f = await fixture(t), first = f.activity(); await first.action(1, 'alice', { kind: 'claim', targets: [target] }); await first.close(); // CHANGE
    f.time(15000); const replacement = f.activity(); await replacement.action(1, 'alice', { kind: 'publish' }); // CHANGE
    f.time(LEASE_MS); await first.close(); assert.equal(replacement.snapshot().holds.length, 1); // CHANGE
    const names = await fs.readdir(path.join(f.canvas.folderPath, '.trellis/activity-v5')); assert.equal(names.filter(name => name.endsWith('.json')).length, 1); // CHANGE
}); // CHANGE
test('window cleanup during a terminal-witness flush prevents a delayed acquisition from reopening its session', async t => { // CHANGE
    const f = await fixture(t); let release, entered, block = false; const gate = new Promise(resolve => { release = resolve; }), started = new Promise(resolve => { entered = resolve; }); // CHANGE
    const activity = f.activity('device', { writeAtomic: async (file, text) => { if (block && JSON.parse(text).payload.sessionId.startsWith('expiry-')) { block = false; entered(); await gate; } return f.writeAtomic(file, text); } }); // CHANGE
    await activity.action(1, 'alice', { kind: 'claim', targets: [target] }); f.time(15000); await activity.action(2, 'alice', { kind: 'publish' }); // CHANGE
    f.time(LEASE_MS); block = true; const acquisition = activity.action(2, 'alice', { kind: 'claim', targets: ['["page","new"]'] }), refusal = assert.rejects(acquisition, /session is closed/); await started; // CHANGE
    try { activity.forget(2); release(); await refusal; assert.equal(activity.snapshot().holds.length, 0); } finally { release(); await refusal; } // CHANGE
}); // CHANGE
test('concurrent announcements persist the latest signed revision independently for each window', async t => { // NEW
    const f = await fixture(t), activity = f.activity(); await activity.start(); // NEW
    await Promise.all(Array.from({ length: 32 }, (_, revision) => activity.action(1, 'alice', { kind: 'publish', pending: [target], revision: revision + 1 }))); // NEW
    await activity.action(2, 'alice', { kind: 'publish', revision: 3, objects: [target] }); // NEW
    const directory = path.join(f.canvas.folderPath, '.trellis/activity-v5'), records = await Promise.all((await fs.readdir(directory)).filter(name => name.endsWith('.json')).map(name => fs.readFile(path.join(directory, name), 'utf8').then(JSON.parse))); // CHANGE
    assert.equal(records.length, 2); assert.equal(records.find(record => record.payload.sessionId === 'session-1').payload.revision, 32); assert.equal(records.find(record => record.payload.sessionId === 'session-2').payload.revision, 3); // NEW
}); // NEW
test('forged signatures, wrong projects, stale revisions and inactive users never become active status', async t => { // NEW
    const f = await fixture(t), service = f.activity(); await service.start(); // NEW
    const payload = { schema: 5, shareId: 'project', diagramId: 'diagram', deviceId: 'peer', sessionId: 'forged', userId: 'alice', sequence: 1, revision: 1, viewing: [], editing: [target], claims: [{ key: target, claimId: digest('forged') }], pending: [target], requests: [], saveState: 'pending', online: true }; // CHANGE
    const file = path.join(f.canvas.folderPath, '.trellis/activity-v5', digest('peer:forged') + '.json'); // CHANGE
    for (const envelope of [{ payload, signature: 'fake' }, signRecord({ ...payload, schema: 2 }, f.keys.privateKey), signRecord({ ...payload, shareId: 'other' }, f.keys.privateKey), signRecord({ ...payload, userId: 'inactive' }, f.keys.privateKey)]) { await f.writeAtomic(file, JSON.stringify(envelope)); await service.scan(); assert.equal(service.snapshot().sessions.length, 0); } // CHANGE
    await assert.rejects(service.action(1, 'inactive', { kind: 'publish' }), /Inactive/); // NEW
    await service.action(1, 'alice', { kind: 'publish', revision: 2 }); await assert.rejects(service.action(1, 'alice', { kind: 'publish', revision: 1 }), /Stale/); // NEW
}); // NEW
test('a higher sequence with an older model revision cannot refresh presence or change ownership', async t => { // CHANGE
    const f = await fixture(t), peer = f.activity('peer'), local = f.activity(); // NEW
    await peer.action(2, 'alice', { kind: 'claim', targets: [target], revision: 2 }); await local.start(); f.time(5000); await peer.action(2, 'alice', { kind: 'publish' }); await local.scan(); // NEW
    const file = path.join(f.canvas.folderPath, '.trellis/activity-v5', digest('peer:session-2') + '.json'), envelope = JSON.parse(await fs.readFile(file, 'utf8')); // CHANGE
    f.time(34000); await f.writeAtomic(file, JSON.stringify(signRecord({ ...envelope.payload, sequence: envelope.payload.sequence + 1, revision: 1 }, f.keys.privateKey))); await local.scan(); // NEW
    assert.equal(local.snapshot().sessions[0].revision, 2); f.time(35000); assert.equal(local.snapshot().holds.length, 0); assert.equal(local.snapshot().sessions[0].online, false); // CHANGE
}); // NEW
test('a current-state acceptance may remain blocked while independent status and recovery persist', async t => { // CHANGE
    const f = await fixture(t); let release, entered, block = false, completed = false; // CHANGE
    const gate = new Promise(resolve => { release = resolve; }); // NEW
    const waiting = new Promise(resolve => { entered = resolve; }); t.after(release); // NEW
    const journal = createCollaborationStore({ canvas: f.canvas, deviceId: 'device', keys: f.keys, profile: f.root, writeAtomic: f.writeAtomic, writeImmutable: async (file, record) => { if (block && record.payload.kind === 'commit') { entered(); await gate; } await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, JSON.stringify(record), { flag: 'wx' }); } }); // CHANGE
    await journal.initialize(initial); block = true; // CHANGE
    const stalled = journal.action(1,'alice',{kind:'save',baseXml:initial,xml:initial.replace('label="A"','label="Accepted"')}).finally(() => { completed = true; }); await waiting; // NEW
    const activity = f.activity(), drafts = createDraftStore({ profile: f.root, canvas: f.canvas, writeAtomic: f.writeAtomic }); // NEW
    for (let time = 0; time <= 60000; time += 5000) { f.time(time); await activity.action(1, 'alice', { kind: 'publish', pending: [target], revision: time / 5000 }); if (time && time % 10000 === 0) await drafts.checkpoint('alice', 'session-1', { revision: time / 5000, xml: initial.replace('label="A"', 'label="Offline"'), baseXml: initial, editorDrafts: [] }); } // NEW
    assert.equal(activity.snapshot().pendingChanges.length, 1); assert.equal((await drafts.restore('alice')).drafts[0].revision, 12); assert.equal(completed,false); release(); assert.equal((await stalled).ok,true); // CHANGE
}); // NEW
test('checkpoint restart, author isolation and a failed replacement preserve the previous valid draft', async t => { // NEW
    const f = await fixture(t); let fail = false; const options = { profile: f.root, canvas: f.canvas, writeAtomic: async (...args) => { if (fail) throw new Error('Disk full'); return f.writeAtomic(...args); } }; // NEW
    const drafts = createDraftStore(options), input = { revision: 1, xml: initial.replace('label="A"', 'label="Private"'), baseXml: initial, editorDrafts: [{ kind: 'year-planner', targets: [target], plan: { unfinished: true } }] }; // NEW
    await drafts.checkpoint('alice', 'session-1', input); fail = true; await assert.rejects(drafts.checkpoint('alice', 'session-1', { ...input, revision: 2 }), /Disk full/); // NEW
    const restarted = createDraftStore(options); assert.equal((await restarted.restore('alice')).drafts[0].revision, 1); assert.equal((await restarted.restore('bob')).drafts.length, 0); // NEW
}); // NEW

test('protocol 4 cannot create an activity service', () => { // CHANGE
    assert.throws(() => createActivityService({ canvas: { protocolVersion: 4 } }), /Only protocol 5/); // CHANGE
}); // CHANGE
