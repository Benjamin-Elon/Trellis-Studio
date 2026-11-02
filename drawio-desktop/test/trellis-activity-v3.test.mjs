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
import { signRecord, digest, canonical } from '../src/main/trellis-share-protocol.js'; // CHANGE

const target = '["page","a"]'; // NEW
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
    const filename = path.join(f.canvas.folderPath, '.trellis/activity-v4', digest('device:session-1') + '.json'), old = JSON.parse(await fs.readFile(filename, 'utf8')); // CHANGE
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
    const names = await fs.readdir(path.join(f.canvas.folderPath, '.trellis/activity-v4')); for (const name of names) { const value = JSON.parse(await fs.readFile(path.join(f.canvas.folderPath, '.trellis/activity-v4', name), 'utf8')); assert.equal(value.payload.observationRevision, undefined); } // CHANGE
}); // CHANGE
test('handoff keeps its five-minute deadline independently of renewed thirty-second heartbeats', async t => { // CHANGE
    const f = await fixture(t), activity = f.activity(); await activity.action(1, 'alice', { kind: 'claim', targets: [target] }); const requested = await activity.action(2, 'alice', { kind: 'request', targets: [target] }); // CHANGE
    assert.equal(requested.collaboration.holds[0].requestDeadline, REQUEST_MS); assert.equal(requested.collaboration.holds[0].expiresAt, REQUEST_MS); // CHANGE
    f.time(290000); await activity.action(2, 'alice', { kind: 'publish' }); const renewed = await activity.action(1, 'alice', { kind: 'publish' }); assert.equal(renewed.collaboration.holds[0].requestDeadline, 300000); // CHANGE
    f.time(300000); const expired = await activity.action(1, 'alice', { kind: 'snapshot' }); assert.equal(expired.collaboration.holds.length, 0); assert.equal(expired.collaboration.losses[0].code, 'HANDOFF_EXPIRED'); // CHANGE
}); // CHANGE
test('inactivity, sleep and activity-service restart retain the same signed ownership generation', async t => { // CHANGE
    const f = await fixture(t), first = f.activity(); // CHANGE
    const claimed = await first.action(1, 'alice', { kind: 'claim', targets: [target], revision: 3 }), claimId = claimed.collaboration.holds[0].claimId; // CHANGE
    f.time(86400000); const idle = await first.action(1, 'alice', { kind: 'snapshot' }); // CHANGE
    assert.equal(idle.collaboration.holds[0].expiresAt, null); assert.equal(idle.collaboration.holds[0].online, false); assert.deepEqual(idle.collaboration.losses, []); // CHANGE
    await first.close(); const restarted = f.activity(); await restarted.start(); // CHANGE
    assert.equal(restarted.snapshot().holds[0].claimId, claimId); assert.equal(restarted.snapshot().holds[0].online, false); // CHANGE
    const resumed = await restarted.action(1, 'alice', { kind: 'publish', revision: 4 }); // CHANGE
    assert.equal(resumed.collaboration.holds[0].claimId, claimId); assert.equal(resumed.collaboration.holds[0].online, true); // CHANGE
    await restarted.action(1, 'alice', { kind: 'claim', targets: [target] }); assert.equal(restarted.snapshot().holds[0].claimId, claimId); // CHANGE
}); // CHANGE
test('a stalled activity write cannot expire ownership or block a read-only loss confirmation', async t => { // CHANGE
    const f = await fixture(t); let blocked = false, release; const gate = new Promise(resolve => { release = resolve; }); t.after(release); // CHANGE
    const activity = f.activity('device', { writeAtomic: async (...args) => { if (blocked) await gate; return f.writeAtomic(...args); } }); // CHANGE
    const claimed = await activity.action(1, 'alice', { kind: 'claim', targets: [target] }); blocked = true; // CHANGE
    const publication = activity.action(1, 'alice', { kind: 'publish', revision: 1 }); await new Promise(resolve => setImmediate(resolve)); f.time(REQUEST_MS * 2); // CHANGE
    const confirmed = await activity.action(1, 'alice', { kind: 'snapshot' }); // CHANGE
    assert.equal(confirmed.collaboration.holds[0].claimId, claimed.collaboration.holds[0].claimId); assert.equal(confirmed.collaboration.holds[0].expiresAt, null); assert.deepEqual(confirmed.collaboration.losses, []); // CHANGE
    release(); await publication; // CHANGE
}); // CHANGE
test('stale requester presence, repeated requests and delayed delivery keep the original deadline', async t => { // CHANGE
    const f = await fixture(t), owner = f.activity(), requester = f.activity('peer'); // CHANGE
    await owner.action(1, 'alice', { kind: 'claim', targets: [target] }); await requester.start(); // CHANGE
    f.time(1000); await requester.action(2, 'alice', { kind: 'request', targets: [target] }); // CHANGE
    f.time(250000); const repeated = await requester.action(2, 'alice', { kind: 'request', targets: [target] }); // CHANGE
    assert.equal(repeated.collaboration.holds[0].requestDeadline, 1000 + REQUEST_MS); // CHANGE
    await owner.scan(); assert.equal(owner.snapshot().holds[0].requestDeadline, 1000 + REQUEST_MS); // CHANGE
    f.time(1000 + REQUEST_MS); const expired = await owner.action(1, 'alice', { kind: 'publish' }); // CHANGE
    assert.deepEqual(expired.collaboration.holds, []); assert.equal(expired.collaboration.losses[0].code, 'HANDOFF_EXPIRED'); // CHANGE
    const refused = await owner.action(1, 'alice', { kind: 'claim', targets: [target] }); assert.equal(refused.ok, false); assert.equal(refused.code, 'HOLD_LOST'); // CHANGE
}); // CHANGE
test('explicit requester close or window cleanup cancels a pending request and cannot reopen its session', async t => { // CHANGE
    for (const exit of ['close', 'forget']) await t.test(exit, async t => { // CHANGE
        const f = await fixture(t), activity = f.activity(); // CHANGE
        await activity.action(1, 'alice', { kind: 'claim', targets: [target] }); await activity.action(2, 'alice', { kind: 'request', targets: [target] }); // CHANGE
        f.time(10000); if (exit === 'close') await activity.action(2, 'alice', { kind: 'close' }); else { activity.forget(2); await activity.close(); } // CHANGE
        const restarted = f.activity(); await restarted.start(); f.time(REQUEST_MS * 2); // CHANGE
        assert.equal(restarted.snapshot().holds.length, 1); assert.equal(restarted.snapshot().holds[0].expiresAt, null); // CHANGE
        await assert.rejects(restarted.action(2, 'alice', { kind: 'publish' }), /closed/); // CHANGE
    }); // CHANGE
}); // CHANGE
test('requester exit after the deadline preserves expiry through restart and later owner heartbeats', async t => { // CHANGE
    const f = await fixture(t), activity = f.activity(); // CHANGE
    await activity.action(1, 'alice', { kind: 'claim', targets: [target] }); await activity.action(2, 'alice', { kind: 'request', targets: [target] }); // CHANGE
    f.time(REQUEST_MS); await activity.action(2, 'alice', { kind: 'close' }); await activity.close(); // CHANGE
    const restarted = f.activity(); await restarted.start(); const resumed = await restarted.action(1, 'alice', { kind: 'publish' }); // CHANGE
    assert.deepEqual(resumed.collaboration.holds, []); assert.equal(resumed.collaboration.losses[0].code, 'HANDOFF_EXPIRED'); // CHANGE
    assert.equal((await restarted.action(3, 'alice', { kind: 'claim', targets: [target] })).ok, true); // CHANGE
}); // CHANGE
test('multiple requesters retain their own deadlines when an earlier request is cancelled', async t => { // CHANGE
    const f = await fixture(t), activity = f.activity(); await activity.action(1, 'alice', { kind: 'claim', targets: [target] }); // CHANGE
    await activity.action(2, 'alice', { kind: 'request', targets: [target] }); f.time(10000); await activity.action(3, 'alice', { kind: 'request', targets: [target] }); // CHANGE
    f.time(20000); const cancelled = await activity.action(2, 'alice', { kind: 'close' }); // CHANGE
    assert.equal(cancelled.collaboration.holds[0].requestDeadline, 10000 + REQUEST_MS); assert.equal(cancelled.collaboration.holds[0].requesters.length, 1); // CHANGE
    f.time(REQUEST_MS); assert.equal(activity.snapshot().holds.length, 1); f.time(10000 + REQUEST_MS); assert.deepEqual(activity.snapshot().holds, []); // CHANGE
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
    await peer.action(2, 'bob', { kind: 'request', targets: [target] }); await owner.scan(); f.time(REQUEST_MS * 2); // CHANGE
    assert.equal(owner.snapshot().holds.length, 1); assert.equal(owner.snapshot().holds[0].requested, false); // CHANGE
}); // CHANGE
test('new acquisitions have distinct generations and old handoff requests never expire them', async t => { // CHANGE
    const f = await fixture(t), activity = f.activity(); // CHANGE
    const original = await activity.action(1, 'alice', { kind: 'claim', targets: [target] }), firstId = original.collaboration.holds[0].claimId; // CHANGE
    await activity.action(2, 'alice', { kind: 'request', targets: [target] }); await activity.action(1, 'alice', { kind: 'release', targets: [target] }); // CHANGE
    const fresh = await activity.action(1, 'alice', { kind: 'claim', targets: [target] }); // CHANGE
    assert.notEqual(fresh.collaboration.holds[0].claimId, firstId); assert.equal(fresh.collaboration.holds[0].requested, false); // CHANGE
    await activity.action(1, 'alice', { kind: 'release', targets: [target], claimIds: [firstId] }); assert.equal(activity.snapshot().holds[0].claimId, fresh.collaboration.holds[0].claimId); // CHANGE: a delayed old editor cannot release the new generation.
    f.time(REQUEST_MS); const current = await activity.action(1, 'alice', { kind: 'publish' }); // CHANGE
    assert.equal(current.collaboration.holds.length, 1); assert.equal(current.collaboration.holds[0].expiresAt, null); assert.deepEqual(current.collaboration.losses, []); // CHANGE
}); // CHANGE
test('reordered signed snapshots and attempts to rewrite requests cannot resurrect expired ownership', async t => { // CHANGE
    const f = await fixture(t), owner = f.activity(), requester = f.activity('peer'); // CHANGE
    await owner.action(1, 'alice', { kind: 'claim', targets: [target] }); await requester.start(); // CHANGE
    await requester.action(2, 'alice', { kind: 'request', targets: [target] }); await owner.scan(); // CHANGE
    const file = path.join(f.canvas.folderPath, '.trellis/activity-v4', digest('peer:session-2') + '.json'), envelope = JSON.parse(await fs.readFile(file, 'utf8')); // CHANGE
    f.time(REQUEST_MS); assert.deepEqual(owner.snapshot().holds, []); // CHANGE
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
    const canvas = { protocolVersion: 4, shareId: 'project', diagramId: 'diagram', folderPath: path.join(root, 'project'), diagramPath: path.join(root, 'project', 'Garden.drawio'), coordinatorDeviceId: 'device', coordinatorPublicKey: keys.publicKey, members: [{ deviceId: 'device', userId: 'alice', publicKey: keys.publicKey }, { deviceId: 'peer', userId: 'alice', publicKey: keys.publicKey }] }; // NEW
    let time = 0; const mono = () => time; // NEW
    const writeAtomic = async (file, value) => { await fs.mkdir(path.dirname(file), { recursive: true }); const temp = file + '.' + crypto.randomUUID() + '.tmp'; await fs.writeFile(temp, value); for (let attempt = 0; ; attempt++) { try { await fs.rename(temp, file); break; } catch (error) { if (!['EPERM', 'EBUSY', 'EACCES'].includes(error.code) || attempt >= 4) throw error; await new Promise(resolve => setTimeout(resolve, 25 * (attempt + 1))); } } }; // CHANGE: match production's bounded Windows scanner retry.
    const services = []; const activity = (id = 'device', options = {}) => { const service = createActivityService({ canvas, deviceId: id, keys, sessionFor: caller => 'session-' + caller, writeAtomic, monotonic: mono, now: mono, authorize: user => user === 'alice', ...options }); services.push(service); return service; }; // CHANGE
    t.after(async () => { for (const service of services) await service.close(); }); // NEW
    return { root, canvas, keys, writeAtomic, activity, time: value => { time = value; } }; // NEW
} // NEW
test('remote presence requires fresh progression while disconnected ownership blocks ordinary claims', async t => { // CHANGE
    const f = await fixture(t), peer = f.activity('peer'), local = f.activity(); // NEW
    await peer.action(2, 'alice', { kind: 'claim', targets: [target] }); await local.start(); assert.equal(local.snapshot().holds.length, 1); assert.equal(local.snapshot().holds[0].expiresAt, null); assert.equal(local.snapshot().holds[0].online, false); // CHANGE
    f.time(5000); await peer.action(2, 'alice', { kind: 'publish', pending: [target], revision: 1 }); await local.scan(); assert.equal(local.snapshot().holds.length, 1); // NEW
    f.time(5000 + LEASE_MS - 1); await local.scan(); assert.equal(local.snapshot().holds.length, 1); // NEW
    f.time(5000 + LEASE_MS); await local.scan(); assert.equal(local.snapshot().holds.length, 1); assert.equal(local.snapshot().pendingChanges[0].online, false); // CHANGE
    assert.equal(local.snapshot().presence[0].online, false); assert.deepEqual(local.snapshot().presence[0].targets, [target]); // CHANGE
    assert.equal((await local.action(1, 'alice', { kind: 'claim', targets: [target] })).ok, false); // CHANGE
    await local.action(1, 'alice', { kind: 'request', targets: [target] }); f.time(5000 + LEASE_MS + REQUEST_MS); // CHANGE
    assert.equal((await local.action(1, 'alice', { kind: 'claim', targets: [target] })).ok, true); // CHANGE: takeover needs neither a fresh heartbeat nor an acknowledgment from the owner.
}); // NEW
test('viewing-only startup snapshots remain explicitly unconfirmed until a fresh heartbeat arrives', async t => { // NEW
    const f = await fixture(t), peer = f.activity('peer'), local = f.activity(); // NEW
    await peer.action(2, 'alice', { kind: 'view', objects: [target] }); await local.start(); // NEW
    assert.equal(local.snapshot().presence[0].online, false); assert.equal(local.snapshot().holds.length, 0); // NEW
    f.time(5000); await peer.action(2, 'alice', { kind: 'publish' }); await local.scan(); assert.equal(local.snapshot().presence[0].online, true); // NEW
}); // NEW
test('concurrent announcements persist the latest signed revision independently for each window', async t => { // NEW
    const f = await fixture(t), activity = f.activity(); await activity.start(); // NEW
    await Promise.all(Array.from({ length: 32 }, (_, revision) => activity.action(1, 'alice', { kind: 'publish', pending: [target], revision: revision + 1 }))); // NEW
    await activity.action(2, 'alice', { kind: 'publish', revision: 3, objects: [target] }); // NEW
    const directory = path.join(f.canvas.folderPath, '.trellis/activity-v4'), records = await Promise.all((await fs.readdir(directory)).filter(name => name.endsWith('.json')).map(name => fs.readFile(path.join(directory, name), 'utf8').then(JSON.parse))); // NEW
    assert.equal(records.length, 2); assert.equal(records.find(record => record.payload.sessionId === 'session-1').payload.revision, 32); assert.equal(records.find(record => record.payload.sessionId === 'session-2').payload.revision, 3); // NEW
}); // NEW
test('forged signatures, wrong projects, stale revisions and inactive users never become active status', async t => { // NEW
    const f = await fixture(t), service = f.activity(); await service.start(); // NEW
    const payload = { schema: 4, shareId: 'project', diagramId: 'diagram', deviceId: 'peer', sessionId: 'forged', userId: 'alice', sequence: 1, revision: 1, viewing: [], editing: [target], claims: [{ key: target, claimId: digest('forged') }], pending: [target], requests: [], saveState: 'pending', online: true }; // CHANGE
    const file = path.join(f.canvas.folderPath, '.trellis/activity-v4', digest('peer:forged') + '.json'); // NEW
    for (const envelope of [{ payload, signature: 'fake' }, signRecord({ ...payload, schema: 2 }, f.keys.privateKey), signRecord({ ...payload, shareId: 'other' }, f.keys.privateKey), signRecord({ ...payload, userId: 'inactive' }, f.keys.privateKey)]) { await f.writeAtomic(file, JSON.stringify(envelope)); await service.scan(); assert.equal(service.snapshot().sessions.length, 0); } // CHANGE
    await assert.rejects(service.action(1, 'inactive', { kind: 'publish' }), /Inactive/); // NEW
    await service.action(1, 'alice', { kind: 'publish', revision: 2 }); await assert.rejects(service.action(1, 'alice', { kind: 'publish', revision: 1 }), /Stale/); // NEW
}); // NEW
test('a higher sequence with an older model revision cannot refresh presence or change ownership', async t => { // CHANGE
    const f = await fixture(t), peer = f.activity('peer'), local = f.activity(); // NEW
    await peer.action(2, 'alice', { kind: 'claim', targets: [target], revision: 2 }); await local.start(); f.time(5000); await peer.action(2, 'alice', { kind: 'publish' }); await local.scan(); // NEW
    const file = path.join(f.canvas.folderPath, '.trellis/activity-v4', digest('peer:session-2') + '.json'), envelope = JSON.parse(await fs.readFile(file, 'utf8')); // NEW
    f.time(34000); await f.writeAtomic(file, JSON.stringify(signRecord({ ...envelope.payload, sequence: envelope.payload.sequence + 1, revision: 1 }, f.keys.privateKey))); await local.scan(); // NEW
    assert.equal(local.snapshot().sessions[0].revision, 2); f.time(35000); assert.equal(local.snapshot().holds.length, 1); assert.equal(local.snapshot().sessions[0].online, false); // CHANGE
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
