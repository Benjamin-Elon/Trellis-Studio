/** Behavioral tests for unordered peers, rejected proposals, and timed handoffs. // NEW */
import test from 'node:test'; // NEW
import assert from 'node:assert/strict'; // NEW
import fs from 'node:fs/promises'; // NEW
import os from 'node:os'; // NEW
import path from 'node:path'; // NEW
import crypto from 'node:crypto'; // NEW
import zlib from 'node:zlib'; // NEW
import { DOMParser } from '@xmldom/xmldom'; // CHANGE
import { signRecord } from '../src/main/trellis-share-protocol.js'; // NEW
import { replay, diffObjects, applyChanges, objects, authorityFor, HOLD_MS, HANDOFF_MS } from '../src/main/trellis-collaboration-protocol.js'; // CHANGE
import { createCollaborationStore } from '../src/main/trellis-collaboration-store.js'; // NEW
const escaped = s => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); // NEW
const key = id => JSON.stringify(['', id]); // NEW
const store = { usersEnabled: true, users: [{ id: 'alice', name: 'Alice' }, { id: 'bob', name: 'Bob' }, { id: 'admin', name: 'Admin', admin: true }] }; // NEW
function canvas(a = 'A', b = 'B') { // NEW
    return '<mxGraphModel><root><mxCell id="0"/><object id="1" trellis_users_json="' + escaped(JSON.stringify(store)) + '"><mxCell parent="0"/></object><object id="a" label="' + a + '" trellis_owner_user_id="alice"><mxCell vertex="1" parent="1"><mxGeometry x="0" y="0" width="10" height="10" as="geometry"/></mxCell></object><object id="b" label="' + b + '" trellis_owner_user_id="bob"><mxCell vertex="1" parent="1"/></object></root></mxGraphModel>'; // NEW
} // NEW
const record = (id, kind, sessionId, userId, fields = {}) => ({ id, kind, schema: 2, sessionId, userId, deviceId: sessionId, clock: 1, parents: [], at: 1000, ...fields }); // NEW
const claim = (id, session, user, targets, fields) => record(id, 'claim', session, user, { targets, ...fields }); // NEW
const edit = (id, holder, before, after, fields = {}) => record(id, 'edit', holder.sessionId, holder.userId, { ...diffObjects(before, after), claimIds: [holder.id], clock: holder.clock + 1, parents: [holder.id], at: holder.at + 1, ...fields }); // NEW
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
    for (let attempt = 0; attempt < 2; attempt++) assert.throws(() => authorityFor('<!DOCTYPE forbidden>' + initial, key('a'), 'alice', context), /Invalid diagram XML/); // NEW: failed parsing cannot poison the authority cache.
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
    assert.equal(replay(initial, [change, held, held], 2000).accepted.length, 1); // NEW
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
async function peers(t, initialXml = canvas()) { // NEW
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'trellis-collaboration-')); t.after(() => fs.rm(root, { recursive: true, force: true })); // NEW
    const keys = crypto.generateKeyPairSync('ed25519'), publicKey = keys.publicKey.export({ type: 'spki', format: 'pem' }), privateKey = keys.privateKey.export({ type: 'pkcs8', format: 'pem' }); // NEW
    let time = 1000; const now = () => time; // NEW
    const writeAtomic = async (file, text) => { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, text); }; // NEW
    const writeImmutable = async (file, value) => { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, JSON.stringify(value), { flag: 'wx' }); }; // NEW
    const members = ['A', 'B'].map(deviceId => ({ deviceId, publicKey, userId: deviceId === 'A' ? 'alice' : 'admin' })); // NEW
    function make(id) { const entry = { shareId: 'project', diagramId: 'diagram', folderPath: path.join(root, id), diagramPath: path.join(root, id, 'Canvas.drawio'), members, coordinatorDeviceId: 'A', coordinatorPublicKey: publicKey }; return { entry, journal: createCollaborationStore({ canvas: entry, deviceId: id, keys: { publicKey, privateKey }, profile: path.join(root, 'profile-' + id), writeAtomic, writeImmutable, now }) }; } // NEW
    const a = make('A'), b = make('B'); await a.journal.initialize(initialXml); // NEW
    async function transfer(from, to) { const src = path.join(from.entry.folderPath, '.trellis'), dest = path.join(to.entry.folderPath, '.trellis'); await fs.cp(src, dest, { recursive: true, force: true }); } // NEW
    await transfer(a, b); return { a, b, transfer, keys: { publicKey, privateKey }, restart: id => make(id), advance: ms => { time += ms; } }; // NEW
} // NEW
test('durable peer journals recover a losing saved proposal after reconnection and restart', async t => { // NEW
    const { a, b, transfer, restart } = await peers(t); const initial = canvas(); // NEW
    const savedA = await a.journal.action(1, 'alice', { kind: 'save', baseXml: initial, xml: canvas('Alice') }); assert.equal(savedA.ok, true); // NEW
    const savedB = await b.journal.action(2, 'admin', { kind: 'save', baseXml: initial, xml: canvas('Admin') }); assert.equal(savedB.ok, true); // NEW
    await transfer(b, a); await transfer(a, b); await a.journal.refresh(); await b.journal.refresh(); // NEW
    assert.equal(await fs.readFile(a.entry.diagramPath, 'utf8'), await fs.readFile(b.entry.diagramPath, 'utf8')); // NEW
    const fresh = restart('A'), state = await fresh.journal.refresh(); assert.ok(state.recoveries.length); // NEW
    assert.match(await fs.readFile(state.recoveries[0].recoveryPath, 'utf8'), /Alice/); // NEW
}); // NEW

test('read-only collaboration actions replay once and unchanged projections do not rewrite markers', async t => { // CHANGE
    const { a } = await peers(t); let reads = 0, markers = 0; const readFile = fs.readFile, writeFile = fs.writeFile; // CHANGE
    t.mock.method(fs, 'readFile', async (filename, ...args) => { if (path.basename(filename) === 'genesis.json') reads++; return readFile(filename, ...args); }); // CHANGE
    t.mock.method(fs, 'writeFile', async (filename, ...args) => { if (path.basename(filename) === 'projection.json') markers++; return writeFile(filename, ...args); }); // CHANGE
    await a.journal.action(1, 'alice', { kind: 'get' }); await a.journal.action(1, 'alice', { kind: 'get' }); // CHANGE
    assert.equal(reads, 2); assert.equal(markers, 1); // CHANGE
    await a.journal.action(1, 'alice', { kind: 'view', objects: [] }); const before = reads; // CHANGE
    await a.journal.action(1, 'alice', { kind: 'view', objects: [] }); assert.equal(reads - before, 1); // CHANGE
}); // CHANGE

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
test('missing remote predecessors cannot stall unrelated local autosaves', async t => { // NEW
    const { a, keys } = await peers(t), directory = path.join(a.entry.folderPath, '.trellis', 'collaboration-v2', 'records'); await fs.mkdir(directory, { recursive: true }); // NEW
    const orphan = { ...record('orphan', 'edit', 'remote', 'admin'), deviceId: 'A', shareId: 'project', diagramId: 'diagram', parents: ['missing'], clock: 10, targets: [key('b')], changes: [], claimIds: ['missing'] }; // NEW
    await fs.writeFile(path.join(directory, 'orphan.json'), JSON.stringify(signRecord(orphan, keys.privateKey))); // NEW
    const saved = await a.journal.action(1, 'alice', { kind: 'save', baseXml: canvas(), xml: canvas('Independent') }); // NEW
    assert.equal(saved.ok, true); assert.equal(saved.collaboration.pending, 1); assert.match(saved.xml, /Independent/); // NEW
}); // NEW
test('bound form activity renews a hold, while revoked users cannot save', async t => { // NEW
    const { a, advance } = await peers(t); // NEW
    const first = await a.journal.action(1, 'alice', { kind: 'claim', targets: [key('a')] }); assert.equal(first.collaboration.holds.length, 1); // NEW
    advance(HOLD_MS - 1000); await a.journal.action(1, 'alice', { kind: 'claim', targets: [key('a')] }); advance(2000); // NEW
    assert.equal((await a.journal.refresh()).holds.length, 1); // NEW
    const changed = canvas(); // NEW
    await assert.rejects(a.journal.action(2, 'removed-user', { kind: 'save', baseXml: changed, xml: canvas('Forbidden') }), /active project user/); // NEW
}); // NEW
test('a signed device retirement preserves known edits, frees its holds, and rejects unknown new records', async t => { // NEW
    const { a, b, transfer, keys, advance } = await peers(t); // NEW
    const saved = await b.journal.action(2, 'admin', { kind: 'save', baseXml: canvas(), xml: canvas('Known edit') }); assert.equal(saved.ok, true); // NEW
    await transfer(b, a); await a.journal.refresh(); // NEW
    const records = (await a.journal.read()).records.filter(r => r.deviceId === 'B'); advance(1000); // NEW
    a.entry.members = a.entry.members.filter(m => m.deviceId !== 'B'); a.entry.retiredMembers = [{ deviceId: 'B', publicKey: keys.publicKey, recordIds: records.map(r => r.id), retiredAt: 2000 }]; // NEW
    const state = await a.journal.refresh(); assert.match(await fs.readFile(a.entry.diagramPath, 'utf8'), /Known edit/); assert.equal(state.holds.length, 0); // NEW
    const later = { ...record('unapproved', 'claim', 'B', 'admin'), deviceId: 'B', shareId: 'project', diagramId: 'diagram', targets: [key('b')], at: 2000 }; // NEW
    await fs.writeFile(path.join(a.entry.folderPath, '.trellis', 'collaboration-v2', 'records', 'unapproved.json'), JSON.stringify(signRecord(later, keys.privateKey))); // NEW
    assert.ok((await a.journal.refresh()).errors.some(e => e.filename === 'unapproved.json')); // NEW
}); // NEW
test('invalid signatures do not enter replay and local save failures never report success', async t => { // NEW
    const { a } = await peers(t); const directory = path.join(a.entry.folderPath, '.trellis', 'collaboration-v2', 'records'); await fs.mkdir(directory, { recursive: true }); // NEW
    await fs.writeFile(path.join(directory, 'forged.json'), JSON.stringify({ payload: { ...record('forged', 'claim', 'fake', 'admin'), deviceId: 'A', targets: [key('a')], shareId: 'project', diagramId: 'diagram' }, signature: 'invalid' })); // NEW
    assert.equal((await a.journal.refresh()).errors.length, 1); // NEW
    const stale = await a.journal.action(1, 'alice', { kind: 'save', baseXml: canvas('Stale'), xml: canvas('New') }); assert.equal(stale.ok, false); assert.match(stale.reason, /changed/); // NEW
    await fs.unlink(a.entry.diagramPath); await fs.mkdir(a.entry.diagramPath); // CHANGE: create an actual write failure rather than swallowing EEXIST. // NEW
    await assert.rejects(a.journal.action(1, 'alice', { kind: 'save', baseXml: canvas(), xml: canvas('New') }), /directory|EISDIR|EPERM/); // NEW
}); // NEW
test('expired and replaced renderer generations preserve drafts instead of silently reacquiring', async t => { // NEW
    const { a, advance } = await peers(t); // NEW
    const held = await a.journal.action(1, 'alice', { kind: 'claim', targets: [key('a')] }); // NEW
    const claimIds = held.collaboration.holds.map(h => h.claimId); advance(HOLD_MS); // NEW
    const stale = await a.journal.action(1, 'alice', { kind: 'save', baseXml: canvas(), xml: canvas('Delayed draft'), claimIds }); // NEW
    assert.equal(stale.ok, false); assert.match(stale.reason, /expired/); assert.match(await fs.readFile(stale.recoveryPath, 'utf8'), /Delayed draft/); // NEW
    assert.equal(stale.collaboration.holds.length, 0); assert.equal(objects(stale.xml).get(key('a')).label, 'A'); // NEW
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
test('restart discovers a proposal archived before an interrupted journal publication', async t => { // NEW
    const { a, restart } = await peers(t), filename = 'local-' + crypto.randomUUID() + '.drawio'; // NEW
    const recoveryPath = path.join(a.entry.folderPath, '..', 'profile-A', 'recovery', 'project', filename); // NEW
    await fs.mkdir(path.dirname(recoveryPath), { recursive: true }); await fs.writeFile(recoveryPath, canvas('Interrupted edit')); // NEW
    const recovered = await restart('A').journal.refresh(); // NEW
    assert.equal(recovered.recoveries[0].recoveryPath, recoveryPath); assert.match(recovered.recoveries[0].reason, /Interrupted/); // NEW
    assert.match(await fs.readFile(recovered.recoveries[0].recoveryPath, 'utf8'), /Interrupted edit/); // NEW
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
