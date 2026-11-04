/** Behavioral tests for unordered peers, rejected proposals, and timed handoffs. // NEW */
import test from 'node:test'; // NEW
import assert from 'node:assert/strict'; // NEW
import fs from 'node:fs/promises'; // NEW
import os from 'node:os'; // NEW
import path from 'node:path'; // NEW
import crypto from 'node:crypto'; // NEW
import zlib from 'node:zlib'; // NEW
import { DOMParser } from '@xmldom/xmldom'; // CHANGE
import { replay, diffObjects, applyChanges, revertDraftChanges, objects, authorityFor, rosterChangeAllowed, HOLD_MS, HANDOFF_MS, PRESENCE_MS, CLOCK_SKEW_MS } from '../src/main/trellis-collaboration-protocol.js'; // CHANGE
import { createCollaborationStore } from '../src/main/trellis-collaboration-store.js'; // NEW
import { createProjectTransport } from '../src/main/trellis-project-transport.js'; // NEW
const escaped = s => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); // NEW
const key = id => JSON.stringify(['', id]); // NEW
const store = { usersEnabled: true, users: [{ id: 'alice', name: 'Alice' }, { id: 'bob', name: 'Bob' }, { id: 'admin', name: 'Admin', admin: true }] }; // NEW
function canvas(a = 'A', b = 'B') { // NEW
    return '<mxGraphModel><root><mxCell id="0"/><object id="1" trellis_users_json="' + escaped(JSON.stringify(store)) + '"><mxCell parent="0"/></object><object id="a" label="' + a + '" trellis_owner_user_id="alice"><mxCell vertex="1" parent="1"><mxGeometry x="0" y="0" width="10" height="10" as="geometry"/></mxCell></object><object id="b" label="' + b + '" trellis_owner_user_id="bob"><mxCell vertex="1" parent="1"/></object></root></mxGraphModel>'; // NEW
} // NEW
const record = (id, kind, sessionId, userId, fields = {}) => ({ id, kind, schema: 3, sessionId, userId, deviceId: sessionId, clock: 1, parents: [], at: 1000, ...fields }); // NEW
const claim = (id, session, user, targets, fields) => record(id, 'claim', session, user, { targets, ...fields }); // NEW
const edit = (id, holder, before, after, fields = {}) => record(id, 'edit', holder.sessionId, holder.userId, { ...diffObjects(before, after), claimIds: [holder.id], clock: holder.clock + 1, parents: [holder.id], at: holder.at + 1, ...fields }); // NEW
test('net-zero document claims preserve accepted state without acquiring holds or rejecting Undo batches', async t => { // CHANGE
    const { a } = await peers(t), initial = canvas(); // CHANGE
    await a.journal.action(1, 'alice', { kind: 'open-view', explicitRefresh: true }); // CHANGE
    const before = await a.journal.read(); // CHANGE
    for (const xml of [initial, initial.replace('<mxGraphModel>', '<mxGraphModel dx="200" dy="100">')]) { // CHANGE: local viewport changes also produce no shared content delta.
        const result = await a.journal.action(1, 'alice', { kind: 'claim', baseXml: initial, xml, explicitRefresh: true }); // CHANGE
        assert.equal(result.ok, true); assert.equal(result.xml, undefined); assert.deepEqual(result.collaboration.holds, []); // CHANGE
    } // CHANGE
    const after = await a.journal.read(); assert.equal(after.xml, before.xml); assert.deepEqual(after.records, before.records); // CHANGE
    await assert.rejects(a.journal.action(1, 'alice', { kind: 'claim', targets: [] }), /Select the object/); // CHANGE: retain the guard for an actual missing selection.
}); // CHANGE
test('request-driven holds survive idle periods; legacy records retain idle expiry', () => { // NEW
    const initial = canvas(), held = claim('held', 'A', 'alice', [key('a')], { holdPolicy: 'request' }); // NEW
    const state = replay(initial, [held], held.at + HOLD_MS * 100); assert.equal(state.holds.length, 1); assert.equal(state.holds[0].expiresAt, null); // NEW
    assert.equal(replay(initial, [{ ...held, holdPolicy: undefined }], held.at + HOLD_MS).holds.length, 0); // NEW
    const request = record('ask', 'request', 'B', 'admin', { at: held.at + HOLD_MS * 100, clock: 2, parents: [held.id], claimIds: [held.id] }); // NEW
    const active = replay(initial, [held, request], request.at + 1); assert.equal(active.holds[0].expiresAt, request.at + HOLD_MS); assert.equal(active.holds[0].requesters[0].userId, 'admin'); // NEW
    const repeat = { ...request, id: 'again', clock: 3, parents: [request.id], at: request.at + HOLD_MS - 1 }; // NEW
    assert.equal(replay(initial, [held, request, repeat], request.at + HOLD_MS).holds.length, 0); // NEW
}); // NEW
test('local rollback retains independent objects and closes over a multi-object action', () => { // NEW
    const initial = canvas(), draft = canvas('Unsaved A', 'Unsaved B'); // NEW
    const partial = revertDraftChanges(initial, draft, [key('a')]); assert.equal(objects(partial.xml).get(key('a')).label, 'A'); assert.equal(objects(partial.xml).get(key('b')).label, 'Unsaved B'); // NEW
    assert.equal(revertDraftChanges(initial, draft, [key('a')], [[key('a'), key('b')]]).xml, initial); // NEW
}); // NEW
test('dead-session cleanup preserves a live local window and keeps recovery data private', async t => { // NEW
    const { a, b, transfer, restart } = await peers(t); // NEW
    const own = await a.journal.action(1, 'alice', { kind: 'claim', targets: [key('a')] }); // NEW
    await a.journal.action(2, 'admin', { kind: 'open-view', explicitRefresh: true }); // NEW
    assert.ok((await a.journal.read()).holds.some(hold => hold.claimId === own.collaboration.holds[0].claimId)); // NEW
    a.journal.forget(2); // CHANGE: another live local window is retired explicitly before restart.
    const restarted = restart('A'); const opened = await restarted.journal.action(4, 'alice', { kind: 'open-view', explicitRefresh: true }); // NEW
    assert.equal(opened.collaboration.holds.some(hold => hold.userId === 'alice'), false); assert.equal(opened.collaboration.holds.some(hold => hold.userId === 'bob'), false); // CHANGE: remote activity lifetime is covered by the signed activity-service tests. // NEW
    const recovered = await restarted.journal.action(4, 'alice', { kind: 'recover-holds', baseXml: canvas(), xml: canvas('Private', 'Retained'), targets: [key('a')], editorDrafts: [{ kind: 'year-planner', targets: [key('a')], year: 2026, plan: { incomplete: true } }] }); // NEW
    assert.equal(objects(recovered.xml).get(key('b')).label, 'Retained'); assert.equal(JSON.parse(await fs.readFile(recovered.editorDataPath, 'utf8')).editors[0].year, 2026); // NEW
    const copy = recovered.collaboration.recoveries.find(copy => copy.recoveryPath === recovered.recoveryPath); // NEW
    assert.equal((await restarted.journal.action(4, 'alice', { kind: 'recovery-data', filename: copy.filename })).data.editors[0].kind, 'year-planner'); // NEW
    await fs.writeFile(path.join(path.dirname(recovered.recoveryPath), 'index.json'), '[]'); // NEW: simulate interruption before the recovery index was committed.
    const rediscovered = await restarted.journal.action(4, 'alice', { kind: 'get' }); assert.equal(rediscovered.collaboration.recoveries.find(item => item.filename === copy.filename).editorDataPath, recovered.editorDataPath); // NEW
    await assert.rejects(restarted.journal.action(4, 'alice', { kind: 'recovery-data', filename: '../signing-key.json' }), /Unknown editor recovery/); // NEW
}); // NEW
test('explicit views save independent local edits without displaying or reverting signed peer changes', async t => { // NEW
    const { a, b, transfer, restart } = await peers(t), initial = canvas();
    await a.journal.action(1, 'alice', { kind: 'open-view', explicitRefresh: true });
    assert.equal((await b.journal.action(2, 'bob', { kind: 'save', baseXml: initial, xml: canvas('A', 'B1') })).ok, true);
    await transfer(b, a);
    const saved = await a.journal.action(1, 'alice', { kind: 'save', explicitRefresh: true, baseXml: initial, xml: canvas('A2', 'B') });
    assert.equal(saved.ok, true); assert.equal(saved.xml, undefined);
    const accepted = await a.journal.action(1, 'alice', { kind: 'history-state', explicitRefresh: true });
    assert.equal(objects(accepted.xml).get(key('a')).label, 'A2'); assert.equal(objects(accepted.xml).get(key('b')).label, 'B1');
    const viewed = await a.journal.action(1, 'alice', { kind: 'open-view', explicitRefresh: true });
    assert.equal(objects(viewed.xml).get(key('b')).label, 'B'); assert.equal(viewed.groups.length, 1);
    const stale = await a.journal.action(1, 'alice', { kind: 'claim', explicitRefresh: true, targets: [key('b')] });
    assert.equal(stale.ok, false); assert.equal(stale.staleView, true);
    const review = await a.journal.action(1, 'alice', { kind: 'review', explicitRefresh: true });
    const prepared = await a.journal.action(1, 'alice', { kind: 'prepare-refresh', token: review.token, explicitRefresh: true });
    await a.journal.action(1, 'alice', { kind: 'ack-refresh', receipt: prepared.receipt, explicitRefresh: true });
    const reopened = await restart('A').journal.action(3, 'alice', { kind: 'open-view', explicitRefresh: true });
    assert.equal(objects(reopened.xml).get(key('b')).label, 'B1'); assert.equal(reopened.groups.length, 0);
}); // NEW
test('independent peer edits converge regardless of arrival order without whole-file overwrite', () => { // NEW
    const initial = canvas(), a = claim('claim-a', 'A', 'alice', [key('a')]), b = claim('claim-b', 'B', 'bob', [key('b')]); // NEW
    const records = [a, edit('edit-a', a, initial, canvas('Alice')), b, edit('edit-b', b, initial, canvas('A', 'Bob'))]; // NEW
    const forward = replay(initial, records, 2000), reverse = replay(initial, [...records].reverse(), 2000); // NEW
    assert.equal(forward.xml, reverse.xml); assert.equal(forward.accepted.length, 2); // NEW
    assert.equal(objects(forward.xml).get(key('a')).label, 'Alice'); assert.equal(objects(forward.xml).get(key('b')).label, 'Bob'); // NEW
}); // NEW
test('concurrent higher authority fences the losing transaction; equal rank uses stable order', () => { // NEW
    const initial = canvas(), owner = claim('owner', 'Z', 'alice', [key('a')]), admin = claim('admin-claim', 'A', 'admin', [key('a')]); // NEW
    const result = replay(initial, [owner, edit('owner-edit', owner, initial, canvas('Owner')), admin, edit('admin-edit', admin, initial, canvas('Admin'))], 2000); // NEW
    assert.equal(objects(result.xml).get(key('a')).label, 'Admin'); assert.ok(result.rejected.some(r => r.id === 'owner-edit')); // NEW
    const first = claim('first', 'A', 'alice', [key('a')]), second = claim('second', 'B', 'alice', [key('a')]); // NEW
    assert.equal(replay(initial, [second, first], 2000).holds[0].claimId, first.id); // NEW
}); // NEW
test('viewing never holds objects and heartbeats do not renew edit activity', () => { // NEW
    const initial = canvas(), held = claim('held', 'A', 'alice', [key('a')]); // NEW
    const view = record('view', 'view', 'A', 'alice', { targets: [key('a')], parents: ['held'], clock: 2, at: HOLD_MS }); // NEW
    assert.equal(replay(initial, [view], HOLD_MS).holds.length, 0); // NEW
    assert.equal(replay(initial, [held, view], held.at + HOLD_MS).holds.length, 0); // NEW
}); // NEW

test('a thousand presence records reuse unchanged hold authority without extending its deadline', t => { // CHANGE
    const initial = canvas(), held = claim('held', 'A', 'alice', [key('a')]); let parses = 0; const parse = DOMParser.prototype.parseFromString; // CHANGE
    t.mock.method(DOMParser.prototype, 'parseFromString', function (...args) { parses++; return parse.apply(this, args); }); // CHANGE
    const views = Array.from({ length: 1000 }, (_, i) => record('view-' + i, 'view', 'B', 'bob', { targets: [key('b')], parents: [i ? 'view-' + (i - 1) : 'held'], clock: i + 2, at: held.at + i + 1 })); // CHANGE
    const active = replay(initial, [held, ...views], 3000); assert.equal(active.holds.length, 1); assert.equal(active.holds[0].expiresAt, held.at + HOLD_MS); // CHANGE
    assert.ok(parses < 50, 'Read-only history must not repeatedly parse the complete document for the same hold.'); // CHANGE
    assert.equal(replay(initial, [held, ...views], held.at + HOLD_MS).holds.length, 0); // CHANGE
}); // CHANGE
test('action-local authority parsing is shared across targets and invalidated by policy changes', t => { // CHANGE
    let parses = 0; const parse = DOMParser.prototype.parseFromString, context = {}, initial = canvas(); // CHANGE
    t.mock.method(DOMParser.prototype, 'parseFromString', function (...args) { parses++; return parse.apply(this, args); }); // CHANGE
    assert.equal(authorityFor(initial, key('a'), 'alice', context), 3); const first = parses; // CHANGE
    assert.equal(authorityFor(initial, key('b'), 'alice', context), 0); assert.equal(parses, first); // CHANGE
    const revoked = initial.replace('trellis_owner_user_id="alice"', 'trellis_owner_user_id="bob"'); assert.equal(authorityFor(revoked, key('a'), 'alice', context), 0); assert.ok(parses > first); // CHANGE
    assert.equal(authorityFor(initial, key('a'), 'alice', context), 3); // NEW: changing back cannot retain the intervening revocation.
    for (let attempt = 0; attempt < 2; attempt++) assert.throws(() => authorityFor('<!DOCTYPE forbidden>' + initial, key('a'), 'alice', context), error => error.code === 'INVALID_XML'); // CHANGE: failed parsing cannot poison the authority cache; assert the structured diagnostic.
}); // CHANGE
test('ordinary edits in a wide model do not reparse policy for each unchanged protected field', t => { // CHANGE
    const initial = canvas().replace('</root>', Array.from({ length: 200 }, (_, i) => '<object id="extra-' + i + '"><mxCell vertex="1" parent="1"/></object>').join('') + '</root>'), changed = initial.replace('label="A"', 'label="Changed"'), held = claim('wide-claim', 'A', 'alice', [key('a')]), transaction = edit('wide-edit', held, initial, changed); // CHANGE
    let parses = 0; const parse = DOMParser.prototype.parseFromString; t.mock.method(DOMParser.prototype, 'parseFromString', function (...args) { parses++; return parse.apply(this, args); }); // CHANGE
    assert.deepEqual(replay(initial, [held, transaction], 2000).accepted, ['wide-edit']); assert.ok(parses < 100, 'Unchanged protected fields must not trigger a full policy parse per cell.'); // CHANGE
}); // CHANGE
test('release request deadline never extends, finishing edits survive, and cooldown protects the requester', () => { // NEW
    const initial = canvas(), held = claim('held', 'A', 'alice', [key('a')]); // NEW
    const request = record('request', 'request', 'B', 'admin', { claimIds: ['held'], parents: ['held'], clock: 2, at: 2000 }); // NEW
    const finish = edit('finish', held, initial, canvas('Finished'), { parents: ['request'], clock: 3, at: 2000 + HOLD_MS / 2 }); // NEW
    const repeat = { ...request, id: 'repeat', parents: ['finish'], clock: 4, at: finish.at }; // NEW
    const deadline = request.at + HOLD_MS, records = [held, request, finish, repeat]; // NEW
    const ready = replay(initial, records, deadline); assert.equal(ready.holds.length, 0); assert.equal(ready.reservations[0].sessionId, 'B'); // NEW
    assert.equal(objects(ready.xml).get(key('a')).label, 'Finished'); // NEW
    const reclaim = claim('reclaim', 'A', 'alice', [key('a')], { parents: ['repeat'], clock: 5, at: deadline + 1 }); // NEW
    assert.ok(replay(initial, [...records, reclaim], reclaim.at).rejected.some(r => r.id === 'reclaim')); // NEW
    const later = { ...reclaim, id: 'later', at: deadline + HANDOFF_MS, parents: ['reclaim'], clock: 6 }; // NEW
    assert.equal(replay(initial, [...records, reclaim, later], later.at).holds[0].sessionId, 'A'); // NEW
}); // NEW
test('missing predecessors wait and stale base versions cannot overwrite newer objects', () => { // NEW
    const initial = canvas(), held = claim('held', 'A', 'alice', [key('a')]), change = edit('edit', held, initial, canvas('New')); // NEW
    assert.deepEqual(replay(initial, [change], 2000).pending, ['edit']); // NEW
    assert.throws(() => applyChanges(canvas('Other'), diffObjects(initial, canvas('New')).changes), /changed/); // NEW
    assert.equal(replay(initial, [change, held], 2000).accepted.length, 1); assert.throws(() => replay(initial, [change, held, held], 2000), /records/); // CHANGE: duplicate record identities are rejected. // NEW
}); // NEW
test('group actions reject atomically and generated plant tiles use their planting lock', () => { // NEW
    const initial = canvas(), a = claim('a', 'A', 'alice', [key('a')]), blocked = claim('blocked', 'B', 'admin', [key('a'), key('b')], { clock: 2, parents: ['a'] }); // NEW
    const result = replay(initial, [a, blocked, edit('batch', blocked, initial, canvas('X', 'Y'))], 2000); // NEW
    assert.equal(result.accepted.length, 0); assert.equal(result.xml, initial); // NEW
    const planting = initial.replace('id="a" label=', 'id="a" planting_id="planting" label=').replace('</root>', '<mxCell id="tile" vertex="1" parent="a" value="Old"/></root>'); // NEW
    assert.ok(diffObjects(planting, planting.replace('value="Old"', 'value="New"')).targets.includes(key('a'))); // NEW
    const deletion = diffObjects(initial, initial.replace(/<object id="a".*?<\/object>/, '')); assert.ok(deletion.targets.includes(key('a'))); // NEW
}); // NEW
test('saved causal handoffs preserve previous edits; stale lock generations cannot write', () => { // NEW
    const initial = canvas(), a = claim('a', 'A', 'alice', [key('a')]), saved = edit('saved', a, initial, canvas('Saved')); // NEW
    const released = record('released', 'release', 'A', 'alice', { parents: ['saved'], clock: 3, targets: [key('a')], at: 2000 }); // NEW
    const b = claim('b', 'B', 'admin', [key('a')], { parents: ['released'], clock: 4, at: 2001 }); // NEW
    const stale = edit('stale', a, canvas('Saved'), canvas('Late'), { parents: ['b'], clock: 5, at: 2002 }); // NEW
    const result = replay(initial, [a, saved, released, b, stale], 3000); // NEW
    assert.equal(objects(result.xml).get(key('a')).label, 'Saved'); assert.ok(result.rejected.some(r => r.id === 'stale')); // NEW
}); // NEW
async function peers(t, initialXml = canvas(), options = {}) { // CHANGE // NEW
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'trellis-collaboration-')); t.after(() => fs.rm(root, { recursive: true, force: true })); // NEW
    const keys = crypto.generateKeyPairSync('ed25519'), publicKey = keys.publicKey.export({ type: 'spki', format: 'pem' }), privateKey = keys.privateKey.export({ type: 'pkcs8', format: 'pem' }); // NEW
    let time = 1000; const now = () => time; // NEW
    const writeAtomic = async (file, text) => { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, text); }; // NEW
    const writeImmutable = async (file, value) => { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, JSON.stringify(value), { flag: 'wx' }); }; // NEW
    const members = ['A', 'B'].map(deviceId => ({ deviceId, publicKey, userId: deviceId === 'A' ? 'alice' : 'admin' })); // NEW
    function make(id) { const entry = { protocolVersion: 4, shareId: 'project', diagramId: 'diagram', folderPath: path.join(root, 'accepted'), diagramPath: path.join(root, 'accepted', 'Canvas.drawio'), members, coordinatorDeviceId: 'A', coordinatorPublicKey: publicKey }; return { entry, journal: createCollaborationStore({ ...options, canvas: entry, deviceId: 'A', keys: { publicKey, privateKey }, profile: path.join(root, 'profile-' + id), writeAtomic, writeImmutable, now }) }; } // CHANGE: independent clients submit to the same authorized coordinator, without a disabled peer proposal path.
    const a = make('A'), b = make('B'); await a.journal.initialize(initialXml); // NEW
    async function transfer(from, to) { assert.equal(from.entry.folderPath, to.entry.folderPath); await to.journal.refresh(); } // CHANGE: accepted coordinator state is already shared; clients refresh independently.
    await transfer(a, b); return { a, b, transfer, keys: { publicKey, privateKey }, restart: id => make(id), advance: ms => { time += ms; } }; // NEW
} // NEW
for (const mode of ['accepted', 'mine', 'non-conflicting', 'later']) test('signed conflict resolution: ' + mode + ' preserves complete groups and original recovery', async t => { // NEW
    const own = xml => xml.replace('trellis_owner_user_id="bob"', 'trellis_owner_user_id="alice"'), initial = own(canvas()), mine = own(canvas('My A', 'My B')); // NEW
    const { a, b, transfer } = await peers(t, initial); await a.journal.action(1, 'alice', { kind: 'open-view', explicitRefresh: true }); // NEW
    assert.equal((await b.journal.action(2, 'alice', { kind: 'save', baseXml: initial, xml: own(canvas('Peer A')) })).ok, true); await transfer(b, a); // NEW
    const reviewed = await a.journal.action(1, 'alice', { kind: 'draft-review', baseXml: initial, xml: mine }); // NEW
    const result = await a.journal.action(1, 'alice', { kind: 'draft-resolve', baseXml: initial, xml: mine, token: reviewed.review.token, mode }); assert.equal(result.ok, true); // NEW
    const accepted = objects((await a.journal.read()).xml); // NEW
    assert.equal(accepted.get(key('a')).label, mode === 'mine' ? 'My A' : 'Peer A'); // NEW
    assert.equal(accepted.get(key('b')).label, ['mine', 'non-conflicting'].includes(mode) ? 'My B' : 'B'); // NEW
    if (mode === 'later') assert.equal(result.resolution.remainingXml, mine); // NEW
    else { const copies = await Promise.all(result.collaboration.recoveries.map(copy => fs.readFile(copy.recoveryPath, 'utf8'))); assert.ok(copies.includes(mine), 'The complete original proposal must remain recoverable.'); if (mode === 'non-conflicting') assert.deepEqual(result.resolution.remaining, [key('a')]); } // CHANGE
}); // NEW
test('resolution rechecks the accepted base on every race and current live editing access', async t => { // NEW
    let blocked = false; const initial = canvas(), mine = canvas('Mine'); // NEW
    const { a, b, transfer } = await peers(t, initial, { beforeCommit: () => blocked ? [{ key: key('a'), userId: 'bob' }] : [] }); // NEW
    await a.journal.action(1, 'alice', { kind: 'open-view', explicitRefresh: true }); // NEW
    for (let race = 0; race < 2; race++) { // NEW
        const reviewed = await a.journal.action(1, 'alice', { kind: 'draft-review', baseXml: initial, xml: mine }), baseXml = (await b.journal.read()).xml; // NEW
        assert.equal((await b.journal.action(2, 'alice', { kind: 'save', baseXml, xml: canvas('Peer ' + race) })).ok, true); await transfer(b, a); // NEW
        const stale = await a.journal.action(1, 'alice', { kind: 'draft-resolve', baseXml: initial, xml: mine, token: reviewed.review.token, mode: 'mine' }); assert.equal(stale.staleReview, true); // NEW
    } // NEW
    const reviewed = await a.journal.action(1, 'alice', { kind: 'draft-review', baseXml: initial, xml: mine }); blocked = true; // NEW
    const denied = await a.journal.action(1, 'alice', { kind: 'draft-resolve', baseXml: initial, xml: mine, token: reviewed.review.token, mode: 'mine' }); assert.equal(denied.ok, false); assert.equal(denied.code, 'EDITING_BUSY'); assert.equal(objects((await a.journal.read()).xml).get(key('a')).label, 'Peer 1'); // NEW
}); // NEW
test('revoking the author after review prevents applying a preserved proposal', async t => { // NEW
    const initial = canvas(), mine = canvas('Mine'), { a, b, transfer } = await peers(t, initial); // NEW
    const reviewed = await a.journal.action(1, 'alice', { kind: 'draft-review', baseXml: initial, xml: mine }); // NEW
    const revoked = initial.replace(escaped(JSON.stringify(store)), escaped(JSON.stringify({ ...store, users: store.users.map(user => user.id === 'alice' ? { ...user, disabled: true } : user) }))); // NEW
    assert.equal((await b.journal.action(2, 'admin', { kind: 'save', baseXml: initial, xml: revoked })).ok, true); await transfer(b, a); // NEW
    await assert.rejects(a.journal.action(1, 'alice', { kind: 'draft-resolve', baseXml: initial, xml: mine, token: reviewed.review.token, mode: 'mine' }), /active project user/); assert.equal(objects((await a.journal.read()).xml).get(key('a')).label, 'A'); // NEW
}); // NEW
// CHANGE: v3 archive/replay fixtures are replaced by the accepted-state guarantees in docs/test-repair-coverage.md.









test('membership queries use verified snapshots without materializing or overwriting external drafts', async t => { // NEW
    const roster = { usersEnabled: true, users: [{ id: 'alice', admin: true, portableIdentityId: 'identity' }] }; // NEW
    const xml = canvas().replace(escaped(JSON.stringify(store)), escaped(JSON.stringify(roster))), samples = []; // NEW
    const { a } = await peers(t, xml, { onTiming: sample => samples.push(sample) }); await a.journal.refresh(); // NEW
    const external = xml.replace('label="A"', 'label="Private external draft"'); await fs.writeFile(a.entry.diagramPath, external); // NEW
    const transport = createProjectTransport({ initialize: async () => {}, registry: () => [a.entry], collaborationStore: () => a.journal, now: () => 1000 }); // NEW
    samples.length = 0; const input = { shareId: 'project', userId: 'alice', identityId: 'identity' }; // NEW
    assert.equal((await transport.projectActions(input)).canDelete, true); assert.equal((await transport.projectActions(input)).canDelete, true); // NEW
    assert.equal(await fs.readFile(a.entry.diagramPath, 'utf8'), external); assert.equal(samples.filter(sample => sample.phase === 'materialize').length, 0); // NEW
    assert.ok(samples.filter(sample => sample.phase === 'read').every(sample => sample.replayCount === 0)); // NEW
    assert.equal((await a.journal.snapshot()).errors.length, 0); // NEW
}); // NEW



test('retrying a failed private checkpoint does not republish an accepted local save', async t => { // NEW
    const { a } = await peers(t); await a.journal.action(1, 'alice', { kind: 'open-view' });
    const writeFile = fs.writeFile; let fail = true;
    t.mock.method(fs, 'writeFile', async (filename, ...args) => { if (fail && String(filename).includes('object-views') && String(filename).endsWith('.json')) throw new Error('Checkpoint disk failure'); return writeFile(filename, ...args); });
    const input = { kind: 'save', explicitRefresh: true, baseXml: canvas(), xml: canvas('Saved once') };
    await assert.rejects(a.journal.action(1, 'alice', input), /Checkpoint disk failure/);
    assert.equal((await a.journal.read()).accepted.length, 1);
    fail = false; const retried = await a.journal.action(1, 'alice', input);
    assert.equal(retried.ok, true); assert.equal((await a.journal.read()).accepted.length, 1);
    assert.match((await a.journal.action(1, 'alice', { kind: 'open-view' })).xml, /Saved once/);
});

test('an originating window adopts its project rename while another window remains pending', async t => { // NEW
    const initial = canvas().replace('id="1" trellis_users_json=', 'id="1" trellis_history_id="diagram" trellis_project_name="Old" trellis_users_json='), { a } = await peers(t, initial);
    await a.journal.action(1, 'admin', { kind: 'open-view' }); await a.journal.action(2, 'admin', { kind: 'open-view' });
    const renamed = await a.journal.action(1, 'admin', { kind: 'projectName', name: 'New' }); assert.equal(renamed.ok, true);
    const own = await a.journal.action(1, 'admin', { kind: 'open-view' }), other = await a.journal.action(2, 'admin', { kind: 'open-view' });
    assert.match(own.xml, /trellis_project_name="New"/); assert.equal(own.groups.length, 0);
    assert.match(other.xml, /trellis_project_name="Old"/); assert.equal(other.groups.length, 1);
    const staleRename = await a.journal.action(2, 'admin', { kind: 'projectName', name: 'Another' }); assert.equal(staleRename.staleView, true);
});

test('revoked explicit views receive live policy without receiving canvas contents', async t => { // NEW
    const { a } = await peers(t); await a.journal.action(1, 'alice', { kind: 'open-view', explicitRefresh: true });
    const disabled = canvas().replace('&quot;id&quot;:&quot;alice&quot;', '&quot;disabled&quot;:true,&quot;id&quot;:&quot;alice&quot;');
    await a.journal.action(2, 'admin', { kind: 'save', baseXml: canvas(), xml: disabled });
    const result = await a.journal.action(1, 'alice', { kind: 'get', explicitRefresh: true });
    assert.equal(result.ok, false); assert.equal(result.xml, undefined); assert.equal(result.collaboration.policy.store.users.find(user => user.id === 'alice').disabled, true);
    const rejected = await a.journal.action(1, 'alice', { kind: 'save', explicitRefresh: true, baseXml: disabled, xml: disabled.replace('label="A"', 'label="Unsubmitted draft"') }); // NEW
    assert.equal(rejected.ok, false); assert.match(await fs.readFile(rejected.recoveryPath, 'utf8'), /Unsubmitted draft/);
});

test('compressed multiple pages use page-specific cell identities and preserve independent edits', () => { // NEW
    const page = text => zlib.deflateRawSync(Buffer.from(encodeURIComponent(text))).toString('base64'); // NEW
    const initial = '<mxfile><diagram id="p1">' + page(canvas()) + '</diagram><diagram id="p2">' + page(canvas()) + '</diagram></mxfile>'; // NEW
    const a = claim('a', 'A', 'alice', [JSON.stringify(['p1', 'a'])]), b = claim('b', 'B', 'bob', [JSON.stringify(['p2', 'b'])]); // NEW
    const afterA = initial.replace(page(canvas()), page(canvas('Page one'))); // NEW
    const bXml = '<mxfile><diagram id="p1">' + page(canvas()) + '</diagram><diagram id="p2">' + page(canvas('A', 'Page two')) + '</diagram></mxfile>'; // NEW
    const result = replay(initial, [a, b, edit('ea', a, initial, afterA), edit('eb', b, initial, bXml)], 2000); // NEW
    assert.equal(result.rejected.length, 0); assert.equal(objects(result.xml).get(JSON.stringify(['p1', 'a'])).label, 'Page one'); assert.equal(objects(result.xml).get(JSON.stringify(['p2', 'b'])).label, 'Page two'); // NEW
}); // NEW
test('three independent sessions converge and undo is another version-checked transaction', () => { // NEW
    const initial = canvas().replace('</root>', '<object id="c" label="C" trellis_owner_user_id="admin"><mxCell vertex="1" parent="1"/></object></root>'); // NEW
    const claims = [claim('a', 'A', 'alice', [key('a')]), claim('b', 'B', 'bob', [key('b')]), claim('c', 'C', 'admin', [key('c')])]; // NEW
    const edits = claims.map((c, i) => edit('e' + i, c, initial, initial.replace('label="' + ['A', 'B', 'C'][i] + '"', 'label="Changed ' + i + '"'))); // NEW
    const records = [...claims, ...edits], forward = replay(initial, records, 2000); // NEW
    assert.equal(forward.xml, replay(initial, [...records].reverse(), 2000).xml); assert.equal(forward.accepted.length, 3); // NEW
    const undoXml = forward.xml.replace('label="Changed 0"', 'label="A"'), undo = edit('undo', claims[0], forward.xml, undoXml, { parents: edits.map(e => e.id), clock: 3, at: 2001 }); // NEW
    assert.equal(objects(replay(initial, [...records, undo], 2002).xml).get(key('a')).label, 'A'); // NEW
}); // NEW
test('bound form activity renews a hold, while revoked users cannot save', async t => { // NEW
    const { a, advance } = await peers(t); // NEW
    const first = await a.journal.action(1, 'alice', { kind: 'claim', targets: [key('a')] }); assert.equal(first.collaboration.holds.length, 1); // NEW
    advance(HOLD_MS - 1000); await a.journal.action(1, 'alice', { kind: 'claim', targets: [key('a')] }); advance(2000); // NEW
    assert.equal((await a.journal.refresh()).holds.length, 1); // NEW
    const changed = canvas(); // NEW
    await assert.rejects(a.journal.action(2, 'removed-user', { kind: 'save', baseXml: changed, xml: canvas('Forbidden') }), /active project user/); // NEW
}); // NEW
test('expired and replaced renderer generations preserve drafts instead of silently reacquiring', async t => { // NEW
    const { a, advance } = await peers(t); // NEW
    const held = await a.journal.action(1, 'alice', { kind: 'claim', targets: [key('a')] }); // NEW
    const claimIds = held.collaboration.holds.map(h => h.claimId); // CHANGE
    await a.journal.action(2, 'admin', { kind: 'request', targets: [key('a')] }); advance(HOLD_MS + HANDOFF_MS + 1); // NEW: test an expired hold explicitly under either supported lifetime policy.
    const stale = await a.journal.action(1, 'alice', { kind: 'save', baseXml: canvas(), xml: canvas('Delayed draft'), claimIds }); // NEW
    assert.equal(stale.ok, false); assert.match(stale.reason, /expired/); assert.match(await fs.readFile(stale.recoveryPath, 'utf8'), /Delayed draft/); // NEW
    assert.equal(stale.collaboration.holds.length, 0); assert.equal(objects(stale.xml).get(key('a')).label, 'A'); // NEW
    advance(HANDOFF_MS); // NEW: preserve the next requester's opportunity before acquiring a new generation.
    const fresh = await a.journal.action(1, 'alice', { kind: 'claim', targets: [key('a')] }); // NEW
    const saved = await a.journal.action(1, 'alice', { kind: 'save', baseXml: canvas(), xml: canvas('New edit'), claimIds: fresh.collaboration.holds.map(h => h.claimId) }); // NEW
    assert.equal(saved.ok, true); // NEW
}); // NEW
test('late stale activity cannot defeat a fresh concurrent claim after abandonment', () => { // NEW
    const initial = canvas(), old = claim('old', 'A', 'admin', [key('a')]); // NEW
    const late = record('late', 'activity', 'A', 'admin', { parents: ['old'], clock: 2, at: old.at + HOLD_MS + 10, targets: [key('a')], claimIds: ['old'] }); // NEW
    const fresh = claim('fresh', 'B', 'alice', [key('a')], { at: old.at + HOLD_MS + 20 }); // NEW
    const result = replay(initial, [old, late, fresh], fresh.at); // NEW
    assert.equal(result.holds[0].claimId, 'fresh'); // NEW
}); // NEW
test('a different approved device cannot borrow a session to release or edit its hold', () => { // NEW
    const initial = canvas(), held = claim('held', 'shared-session', 'alice', [key('a')], { deviceId: 'A' }); // NEW
    const stolen = record('stolen', 'release', 'shared-session', 'alice', { deviceId: 'B', parents: ['held'], clock: 2, at: 2000 }); // NEW
    const proposal = { ...edit('forged-edit', held, initial, canvas('Borrowed'), { parents: ['stolen'], clock: 3, at: 2001 }), deviceId: 'B' }; // NEW
    const result = replay(initial, [held, stolen, proposal], 2002); // NEW
    assert.equal(result.holds[0].deviceId, 'A'); assert.equal(result.accepted.length, 0); // NEW
}); // NEW
test('active team grants participate in arbitration; archived teams do not', () => { // NEW
    const initial = canvas().replace('trellis_owner_user_id="alice"', 'trellis_access_grants_json="' + escaped(JSON.stringify([{ subjectType: 'team', teamId: 'gardeners', capabilities: ['manage_scope_content'] }])) + '"').replace('</root>', '<object id="team" trellis_team_section="1" trellis_team_id="gardeners"><mxCell vertex="1" parent="1"/></object><object id="role" trellis_role_user_id="alice"><mxCell vertex="1" parent="team" style="role_card=1;"/></object></root>'); // NEW
    const held = claim('team-claim', 'A', 'alice', [key('a')]); // NEW
    assert.equal(replay(initial, [held], 2000).holds.length, 1); // NEW
    assert.equal(replay(initial.replace('trellis_team_section="1"', 'trellis_team_section="1" trellis_team_archived="1"'), [held], 2000).holds.length, 0); // NEW
}); // NEW
test('a rejected roster proposal cannot manufacture authority for a dependent concurrent claim', () => { // NEW
    const initial = canvas(), losing = claim('losing-policy', 'Z', 'admin', [key('1')]), winning = claim('winning-policy', 'A', 'admin', [key('1')]); // NEW
    const promoted = { ...store, users: store.users.map(u => u.id === 'bob' ? { ...u, admin: true } : u) }; // NEW
    const changed = initial.replace(escaped(JSON.stringify(store)), escaped(JSON.stringify(promoted))); // NEW
    const policy = edit('rejected-policy', losing, initial, changed); // NEW
    const owner = claim('owner', 'C', 'alice', [key('a')]); // NEW
    const dependent = claim('dependent', 'B', 'bob', [key('a')], { parents: [policy.id], clock: 3, at: 1002 }); // NEW
    const saved = edit('owner-edit', owner, initial, canvas('Owner survives')); // NEW
    const result = replay(initial, [losing, winning, policy, owner, dependent, saved], 2000); // NEW
    assert.ok(result.accepted.includes(saved.id)); assert.ok(result.rejected.some(r => r.id === dependent.id)); // NEW
    assert.equal(result.xml, replay(initial, [saved, dependent, owner, policy, winning, losing], 2000).xml); // NEW
}); // NEW
test('existing Users grant-management and unowned-module claims remain valid', () => { // NEW
    const grant = capabilities => escaped(JSON.stringify([{ userId: 'alice', capabilities }])); // NEW
    const initial = canvas().replace('trellis_owner_user_id="alice"', 'garden_module="1" trellis_owner_user_id="bob" trellis_access_grants_json="' + grant(['manage_scope_content', 'manage_access']) + '"'); // NEW
    const changed = initial.replace(grant(['manage_scope_content', 'manage_access']), grant(['manage_scope_content', 'manage_access', 'create_plantings'])); // NEW
    const manager = claim('manager', 'A', 'alice', [key('a')]); // NEW
    assert.equal(replay(initial, [manager, edit('grant-update', manager, initial, changed)], 2000).accepted.length, 1); // NEW
    const unowned = canvas().replace('trellis_owner_user_id="alice"', 'garden_module="1"'); // NEW
    const claimed = unowned.replace('garden_module="1"', 'garden_module="1" trellis_owner_user_id="alice"'); // NEW
    const user = claim('user', 'A', 'alice', [key('a')]); // NEW
    assert.equal(replay(unowned, [user, edit('claim-module', user, unowned, claimed)], 2000).accepted.length, 1); // NEW
}); // NEW
test('generated tasks, reciprocal links and nested deletions acquire their logical dependencies', () => { // NEW
    const initial = canvas().replace('id="a" label=', 'id="a" tiler_group="1" label=').replace('</root>', '<object id="task" kanban_card="1" linkedTo="a" label="Task"><mxCell vertex="1" parent="1"/></object><mxCell id="child" parent="b" vertex="1"/><mxCell id="grandchild" parent="child" vertex="1"/></root>'); // NEW
    const task = diffObjects(initial, initial.replace('label="Task"', 'label="Changed task"')); // NEW
    assert.ok(task.targets.includes(key('a'))); assert.ok(task.targets.includes(key('task'))); // NEW
    const linked = diffObjects(initial, initial.replace('linkedTo="a"', 'linkedTo="b"')); // NEW
    assert.ok(linked.targets.includes(key('a'))); assert.ok(linked.targets.includes(key('b'))); // NEW
    const removed = initial.replace(/<object id="b".*?<\/object>/, '').replace(/<mxCell id="child"[^>]*\/>/, '').replace(/<mxCell id="grandchild"[^>]*\/>/, ''); // NEW
    const deletion = diffObjects(initial, removed); assert.ok(deletion.targets.includes(key('grandchild'))); // NEW
}); // NEW
test('visitor invitation acceptance preserves Users-generated role setup atomically', async t => { // NEW
    const beforeStore = { ...store, pendingUsers: [{ id: 'guest', email: 'guest@example.org' }], invites: [{ id: 'invitation', pendingUserId: 'guest', email: 'guest@example.org', status: 'pending', expiresAt: 1000000, codeHash: 'verified', scopeCellIds: ['a'] }] }; // NEW
    const initial = canvas().replace(escaped(JSON.stringify(store)), escaped(JSON.stringify(beforeStore))).replace('id="a" label=', 'id="a" garden_module="1" label=').replace('</root>', '<object id="team" team_module="1" trellis_garden_module_id="a" trellis_owner_user_id="admin"><mxCell vertex="1" parent="1"/></object></root>'); // NEW
    const afterStore = { ...beforeStore, users: [...beforeStore.users, { id: 'guest', email: 'guest@example.org', name: 'Guest' }], pendingUsers: [], invites: beforeStore.invites.map(i => ({ ...i, status: 'accepted' })) }; // NEW
    const after = initial.replace(escaped(JSON.stringify(beforeStore)), escaped(JSON.stringify(afterStore))).replace('</root>', '<object id="role" trellis_role_user_id="guest" trellis_role_garden_module_id="a" trellis_role_team_module_id="team"><mxCell vertex="1" parent="team" style="role_card=1;"/></object></root>'); // NEW
    const { a } = await peers(t, initial); // NEW
    const denied = await a.journal.action(1, 'guest', { kind: 'claim', baseXml: initial, xml: after }); assert.equal(denied.ok, false); // NEW
    const claim = await a.journal.action(1, 'guest', { kind: 'claim', baseXml: initial, xml: after, usersPolicyAction: true }); assert.equal(claim.ok, true); // NEW
    const saved = await a.journal.action(1, 'guest', { kind: 'save', baseXml: initial, xml: after, claimIds: claim.collaboration.holds.map(h => h.claimId) }); // NEW
    assert.equal(saved.ok, true); assert.ok(objects(saved.xml).has(key('role'))); // NEW
    const escalated = after.replace(escaped(JSON.stringify(afterStore)), escaped(JSON.stringify({ ...afterStore, users: afterStore.users.map(u => u.id === 'guest' ? { ...u, admin: true } : u) }))); // NEW
    const escalation = await a.journal.action(1, 'guest', { kind: 'save', baseXml: after, xml: escalated }); assert.equal(escalation.ok, false); // NEW
}); // NEW

test('initial identity self-link permits no role, credential, foreign-account or subsequent identity changes', () => { // NEW
    for (const existing of [undefined, '']) { // NEW
        const before = { ...store, users: store.users.map(user => user.id === 'alice' ? { ...user, ...(existing === undefined ? {} : { portableIdentityId: existing }) } : user) }; // NEW
        const linked = { ...before, users: before.users.map(user => user.id === 'alice' ? { ...user, portableIdentityId: 'portable-alice' } : user) }; // NEW
        assert.equal(rosterChangeAllowed(before, linked, 'alice', canvas(), 100), true); // NEW
        for (const field of [{ admin: true }, { disabled: true }, { pinHash: 'changed' }, { email: 'changed@example.org' }]) { const changed = { ...linked, users: linked.users.map(user => user.id === 'alice' ? { ...user, ...field } : user) }; assert.equal(rosterChangeAllowed(before, changed, 'alice', canvas(), 100), false); } // NEW
        assert.equal(rosterChangeAllowed(before, linked, 'bob', canvas(), 100), false); // NEW
        assert.equal(rosterChangeAllowed(linked, { ...linked, users: linked.users.map(user => user.id === 'alice' ? { ...user, portableIdentityId: 'foreign' } : user) }, 'alice', canvas(), 100), false); // NEW
    } // NEW
}); // NEW

test('an existing visitor can claim and save only its initial identity linkage in protected project metadata', async t => { // NEW
    const initial = canvas(), linkedStore = { ...store, users: store.users.map(user => user.id === 'alice' ? { ...user, portableIdentityId: 'portable-alice' } : user) }, linked = initial.replace(escaped(JSON.stringify(store)), escaped(JSON.stringify(linkedStore))); // NEW
    const { a } = await peers(t, initial); await a.journal.action(1, 'alice', { kind: 'open-view', explicitRefresh: true }); // NEW
    const invalid = await a.journal.action(1, 'alice', { kind: 'claim', baseXml: initial, xml: linked.replace('label="B"', 'label="Unauthorized"'), usersPolicyAction: true, explicitRefresh: true }); assert.equal(invalid.ok, false); // NEW
    const claimed = await a.journal.action(1, 'alice', { kind: 'claim', baseXml: initial, xml: linked, usersPolicyAction: true, explicitRefresh: true }); assert.equal(claimed.ok, true, claimed.reason); // NEW
    const saved = await a.journal.action(1, 'alice', { kind: 'save', baseXml: initial, xml: linked, claimIds: claimed.collaboration.holds.map(hold => hold.claimId), explicitRefresh: true }); assert.equal(saved.ok, true, saved.reason); // NEW
    const changed = linked.replace('portable-alice', 'foreign'), relinked = await a.journal.action(1, 'alice', { kind: 'claim', baseXml: linked, xml: changed, usersPolicyAction: true, explicitRefresh: true }); // NEW
    const denied = await a.journal.action(1, 'alice', { kind: 'save', baseXml: linked, xml: changed, claimIds: relinked.collaboration.holds.map(hold => hold.claimId), explicitRefresh: true }); assert.equal(denied.ok, false); assert.match(denied.reason, /roster change/); // NEW
}); // NEW


test('cached verification cannot freeze hold expiry or make current authorization stale', async t => { // NEW
    const { a, advance } = await peers(t); await a.journal.action(1, 'alice', { kind: 'claim', targets: [key('a')] }); // NEW
    assert.equal((await a.journal.read()).holds.length, 1); await a.journal.action(2, 'admin', { kind: 'request', targets: [key('a')] }); advance(HOLD_MS + 1); assert.equal((await a.journal.read()).holds.length, 0); // CHANGE: current request deadlines must be recomputed even with reused verification.
    const disabled = canvas().replace('&quot;id&quot;:&quot;alice&quot;', '&quot;disabled&quot;:true,&quot;id&quot;:&quot;alice&quot;'); // NEW
    await a.journal.action(2, 'admin', { kind: 'save', baseXml: canvas(), xml: disabled }); // NEW
    await assert.rejects(a.journal.action(1, 'alice', { kind: 'save', baseXml: disabled, xml: disabled }), /active project user/); // NEW
}); // NEW

test('only adjacent queued refreshes coalesce; an intervening action retains its ordering', async t => { // NEW
    const samples = [], { a } = await peers(t, canvas(), { onTiming: sample => samples.push(sample) }); let release; // NEW
    const gate = a.journal.runExclusive(() => new Promise(resolve => { release = resolve; })); await new Promise(setImmediate); // NEW
    const first = a.journal.refresh(), duplicate = a.journal.refresh(); assert.equal(first, duplicate); // NEW
    const action = a.journal.action(1, 'alice', { kind: 'get' }), later = a.journal.refresh(); assert.notEqual(first, later); // NEW
    release(); await Promise.all([gate, first, duplicate, action, later]); assert.deepEqual(samples.filter(s => s.phase === 'queue').slice(-3).map(s => s.kind), ['refresh', 'action', 'refresh']); // CHANGE: verify operation order rather than internal read counts. // NEW
}); // NEW




/** A permission failure must not be converted into the conflict resolver's partial-success path. */ // NEW
test('mixed permission failures preserve the complete draft without publishing an authorized subset', async t => { // NEW
    const initial = canvas(), { a } = await peers(t, initial), draft = canvas('Allowed A', 'Forbidden B'); // NEW
    const result = await a.journal.action(1, 'alice', { kind: 'save', baseXml: initial, xml: draft }); // NEW
    assert.equal(result.ok, false); assert.equal(result.code, 'PERMISSION_DENIED'); assert.equal(await fs.readFile(result.recoveryPath, 'utf8'), draft); // NEW
    const state = await a.journal.read(); assert.equal(state.xml, initial); assert.equal(state.records.filter(record => record.kind === 'edit').length, 0); // NEW
    const reviewed = await a.journal.action(1, 'alice', { kind: 'draft-review', baseXml: initial, xml: draft }); // NEW
    const resolved = await a.journal.action(1, 'alice', { kind: 'draft-resolve', baseXml: initial, xml: draft, token: reviewed.review.token, mode: 'mine' }); // NEW
    assert.equal(resolved.ok, false); assert.equal(resolved.code, 'PERMISSION_DENIED'); assert.equal((await a.journal.read()).xml, initial); // NEW
    assert.equal(await fs.readFile(resolved.recoveryPath, 'utf8'), draft); // NEW
}); // NEW

test('permission rejection precedes partial conflict handling and preserves the original complete proposal', async t => { // NEW
    const initial = canvas(), { a, b, transfer } = await peers(t, initial), draft = canvas('Conflicting A', 'Forbidden B'); // NEW
    const peer = await b.journal.action(2, 'admin', { kind: 'save', baseXml: initial, xml: canvas('Peer A') }); assert.equal(peer.ok, true); await transfer(b, a); // NEW
    const before = await a.journal.read(), result = await a.journal.action(1, 'alice', { kind: 'save', baseXml: initial, xml: draft }); // NEW
    assert.equal(result.code, 'PERMISSION_DENIED'); assert.equal(await fs.readFile(result.recoveryPath, 'utf8'), draft); assert.equal((await a.journal.read()).xml, before.xml); // NEW
}); // NEW

/** Watcher responses distinguish the app's verified projection from an externally modified file. */ // NEW
test('verified projection notifications preserve genuine external changes and identify their recovery copy', async t => { // NEW
    const { a } = await peers(t), own = await a.journal.action(1, 'alice', { kind: 'get' }); // NEW
    assert.ok(own.projection.hash); assert.equal(own.projection.externalRecoveryPath, undefined); // NEW
    const accepted = own.xml, external = accepted.replace('label="A"', 'label="External private draft"'); await fs.writeFile(a.entry.diagramPath, external); // NEW
    await a.journal.refresh(); // NEW: a background projection rebuild can win the race with the renderer watcher.
    const reconciled = await a.journal.action(1, 'alice', { kind: 'get' }); // NEW
    assert.ok(reconciled.projection.externalRecoveryPath); assert.equal(await fs.readFile(reconciled.projection.externalRecoveryPath, 'utf8'), external); // NEW
    assert.equal(await fs.readFile(a.entry.diagramPath, 'utf8'), accepted); assert.equal((await a.journal.read()).xml, accepted); // NEW
    assert.equal((await a.journal.action(1, 'alice', { kind: 'get' })).projection.externalRecoveryPath, undefined); // NEW
}); // NEW
