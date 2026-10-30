/** Signed activity and private recovery remain independent of a blocked content replay. */ // NEW
import test from 'node:test'; // NEW
import assert from 'node:assert/strict'; // NEW
import fs from 'node:fs/promises'; // NEW
import path from 'node:path'; // NEW
import os from 'node:os'; // NEW
import crypto from 'node:crypto'; // NEW
import { createActivityService, LEASE_MS } from '../src/main/trellis-activity-service.js'; // NEW
import { createDraftStore } from '../src/main/trellis-draft-store.js'; // NEW
import { createCollaborationStore } from '../src/main/trellis-collaboration-store.js'; // NEW
import { signRecord, digest } from '../src/main/trellis-share-protocol.js'; // NEW

const target = '["page","a"]'; // NEW
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
    const services = []; const activity = (id = 'device') => { const service = createActivityService({ canvas, deviceId: id, keys, sessionFor: caller => 'session-' + caller, writeAtomic, monotonic: mono, now: mono, authorize: user => user === 'alice' }); services.push(service); return service; }; // NEW
    t.after(async () => { for (const service of services) await service.close(); }); // NEW
    return { root, canvas, keys, writeAtomic, activity, time: value => { time = value; } }; // NEW
} // NEW
test('remote snapshots require fresh progression; duplicates cannot renew a thirty-second lease', async t => { // NEW
    const f = await fixture(t), peer = f.activity('peer'), local = f.activity(); // NEW
    await peer.action(2, 'alice', { kind: 'claim', targets: [target] }); await local.start(); assert.equal(local.snapshot().holds.length, 0); // NEW
    f.time(5000); await peer.action(2, 'alice', { kind: 'publish', pending: [target], revision: 1 }); await local.scan(); assert.equal(local.snapshot().holds.length, 1); // NEW
    f.time(5000 + LEASE_MS - 1); await local.scan(); assert.equal(local.snapshot().holds.length, 1); // NEW
    f.time(5000 + LEASE_MS); await local.scan(); assert.equal(local.snapshot().holds.length, 0); assert.equal(local.snapshot().pendingChanges[0].online, false); // NEW
    assert.equal(local.snapshot().presence[0].online, false); assert.deepEqual(local.snapshot().presence[0].targets, [target]); // NEW: an expired editing report is visible without blocking the next editor.
    assert.equal((await local.action(1, 'alice', { kind: 'claim', targets: [target] })).ok, true); // NEW
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
    const payload = { schema: 4, shareId: 'project', diagramId: 'diagram', deviceId: 'peer', sessionId: 'forged', userId: 'alice', sequence: 1, revision: 1, viewing: [], editing: [target], pending: [target], requests: [], saveState: 'pending', online: true }; // NEW
    const file = path.join(f.canvas.folderPath, '.trellis/activity-v4', digest('peer:forged') + '.json'); // NEW
    for (const envelope of [{ payload, signature: 'fake' }, signRecord({ ...payload, schema: 2 }, f.keys.privateKey), signRecord({ ...payload, shareId: 'other' }, f.keys.privateKey), signRecord({ ...payload, userId: 'inactive' }, f.keys.privateKey)]) { await f.writeAtomic(file, JSON.stringify(envelope)); await service.scan(); assert.equal(service.snapshot().sessions.length, 0); } // CHANGE
    await assert.rejects(service.action(1, 'inactive', { kind: 'publish' }), /Inactive/); // NEW
    await service.action(1, 'alice', { kind: 'publish', revision: 2 }); await assert.rejects(service.action(1, 'alice', { kind: 'publish', revision: 1 }), /Stale/); // NEW
}); // NEW
test('a higher sequence with an older model revision cannot renew a remote reservation', async t => { // NEW
    const f = await fixture(t), peer = f.activity('peer'), local = f.activity(); // NEW
    await peer.action(2, 'alice', { kind: 'claim', targets: [target], revision: 2 }); await local.start(); f.time(5000); await peer.action(2, 'alice', { kind: 'publish' }); await local.scan(); // NEW
    const file = path.join(f.canvas.folderPath, '.trellis/activity-v4', digest('peer:session-2') + '.json'), envelope = JSON.parse(await fs.readFile(file, 'utf8')); // NEW
    f.time(34000); await f.writeAtomic(file, JSON.stringify(signRecord({ ...envelope.payload, sequence: envelope.payload.sequence + 1, revision: 1 }, f.keys.privateKey))); await local.scan(); // NEW
    assert.equal(local.snapshot().sessions[0].revision, 2); f.time(35000); assert.equal(local.snapshot().holds.length, 0); // NEW
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
