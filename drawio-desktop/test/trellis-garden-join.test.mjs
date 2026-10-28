/** Joining journal tests use isolated profiles and the production invitation/parser boundaries. */ // NEW
import test from 'node:test'; // NEW
import assert from 'node:assert/strict'; // NEW
import fs from 'node:fs/promises'; // NEW
import os from 'node:os'; // NEW
import path from 'node:path'; // NEW
import { createGardenJoinService, parseGardenInvitation } from '../src/main/trellis-garden-join-service.js'; // NEW
import { encodeBlock } from '../src/main/trellis-share-protocol.js'; // NEW
const invite = overrides => ({ protocolVersion: 3, shareId: 'share', diagramId: 'diagram', inviteId: 'invitation', pendingUserId: 'member', email: 'member@example.org', expiresAt: Date.now() + 86400000, deviceId: Array(8).fill('AAAAAAA').join('-'), coordinatorPublicKey: 'public-key', folderId: 'trellis-v3-share', filename: 'Garden.drawio', label: 'Community garden', code: 'SECRET-CODE', ...overrides }); // NEW
const block = overrides => encodeBlock('INVITE', invite(overrides)); // NEW
const xml = (identityId = '', diagramId = 'diagram') => '<mxGraphModel><root><mxCell id="0"/><object id="1" trellis_access_open="1" trellis_users_diagram_id="' + diagramId + '" trellis_users_json="' + JSON.stringify({ usersEnabled: true, users: identityId ? [{ id: 'member', name: 'Member', portableIdentityId: identityId }] : [], invites: [{ id: 'invitation', pendingUserId: 'member', status: 'pending' }] }).replace(/"/g, '&quot;') + '"><mxCell parent="0"/></object></root></mxGraphModel>'; // CHANGE

async function fixture(t, options = {}) { // NEW
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'trellis-join-')), filename = path.join(root, 'Garden.drawio'), registry = []; // NEW
    let session = { identityId: 'identity-a', generation: 1, username: 'Member' }, joins = 0, imports = 0, watched = filename, reason = '', failImport = false; // NEW
    const transport = { // NEW
        async listCanvases() { return registry; }, listStatus: () => registry.map(row => ({ shareId: row.shareId, state: row.pending ? 'awaitingApproval' : 'syncing', reason })), // NEW
        async joinCanvas({ block: text }) { const parsed = parseGardenInvitation(text); joins++; registry.push({ shareId: parsed.shareId, diagramId: parsed.diagramId, path: filename, pending: true, available: false }); if (options.crashAfterRegistration) { options.crashAfterRegistration = false; throw new Error('Interrupted after registration'); } }, // NEW
        async resumeJoin({ inviteId }) { assert.equal(inviteId, 'invitation'); return { reply: 'approval-reply' }; } // NEW
    }; // NEW
    const identities = { session: () => session, requireSession: async () => { if (!session) throw new Error('Locked'); }, identityRoot: id => path.join(root, id), transport: async id => { assert.equal(id, session.identityId); return transport; } }; // NEW
    const library = { async importCurrent(input) { imports++; assert.equal(input.path, filename); if (failImport) { failImport = false; throw new Error('Catalog disk full'); } return { path: filename }; } }; // NEW
    const make = extra => createGardenJoinService({ identities, library, protect: text => Buffer.from(text).toString('base64'), unprotect: text => Buffer.from(text, 'base64').toString(), validateWatchedPath: async (_caller, candidate) => { if (candidate !== watched) throw new Error('Wrong watched project'); }, ...options, ...extra }); // NEW
    t.after(() => fs.rm(root, { recursive: true, force: true })); // NEW
    return { root, filename, registry, make, transport, service: make(), joins: () => joins, imports: () => imports, switchIdentity: value => { session = value; }, setWatched: value => { watched = value; }, setReason: value => { reason = value; }, failImport: () => { failImport = true; }, ready: async (identityId = '') => { Object.assign(registry[0], { pending: false, available: true }); await fs.writeFile(filename, xml(identityId)); } }; // NEW
} // NEW

test('whole emails and nested quoting parse one invitation; incomplete, ambiguous and expired inputs fail', () => { // NEW
    assert.equal(parseGardenInvitation('Hello gardener\n\n' + block() + '\nSignature').label, 'Community garden'); // NEW
    assert.equal(parseGardenInvitation(block().split('\n').map(line => '> > ' + line).join('\r\n')).inviteId, 'invitation'); // NEW
    for (const text of ['member@example.org', block() + '\n' + block(), block().replace('END TRELLIS INVITE', 'MISSING END'), 'x'.repeat(65537)]) assert.throws(() => parseGardenInvitation(text), /invitation|sharing block|64 KB/i); // NEW
    assert.throws(() => parseGardenInvitation(block({ expiresAt: 1 })), /expired/); assert.throws(() => parseGardenInvitation(block({ protocolVersion: 1 })), /Unsupported/); // NEW
    assert.throws(() => parseGardenInvitation(block({ filename: '../bad.drawio' })), /invalid project/i); // NEW
}); // NEW

test('preview has no transport side effects or secrets; requests resume across restarts without duplicate registration', async t => { // NEW
    const f = await fixture(t); const preview = await f.service.preview({ text: block() }); assert.equal(preview.email, 'member@example.org'); assert.equal(preview.code, undefined); assert.equal(f.joins(), 0); // CHANGE
    const joined = await f.service.start({ text: 'Full email\n' + block(), displayName: 'Volunteer', senderEmail: 'sender@example.org' }); assert.equal(joined.state, 'waiting'); assert.equal(joined.reply, 'approval-reply'); // NEW
    const restarted = f.make(), resumed = await restarted.resume({ id: joined.id }); assert.equal(resumed.reply, joined.reply); assert.equal(f.joins(), 1); // NEW
    await restarted.start({ text: block() }); assert.equal(f.joins(), 1); const listed = await restarted.list(); assert.equal(listed.requests.length, 1); assert.equal(listed.requests[0].code, undefined); assert.equal(listed.requests[0].reply, undefined); // NEW
    const journal = await fs.readFile(path.join(f.root, 'identity-a/local-joins', joined.id + '.json'), 'utf8'); assert.doesNotMatch(journal, /SECRET-CODE|Full email|BEGIN TRELLIS/); // NEW
}); // NEW

test('a journal written before an interrupted registration reconstructs the same approval exchange', async t => { // NEW
    const f = await fixture(t, { crashAfterRegistration: true }); await assert.rejects(f.service.start({ text: block() }), /Interrupted/); // NEW
    const restarted = f.make(), [request] = (await restarted.list()).requests; assert.equal((await restarted.resume({ id: request.id })).reply, 'approval-reply'); assert.equal(f.joins(), 1); // NEW
}); // NEW

test('readiness requires approval and a valid matching diagram; unavailable peers do not imply approval', async t => { // NEW
    const f = await fixture(t), request = await f.service.start({ text: block() }); await fs.writeFile(f.filename, xml()); f.registry[0].available = true; f.setReason('Sender offline'); // NEW
    let state = (await f.service.list()).requests[0]; assert.equal(state.state, 'waiting'); assert.equal(state.reason, 'Sender offline'); // NEW
    f.registry[0].pending = false; f.registry[0].available = false; assert.equal((await f.service.list()).requests[0].state, 'downloading'); // NEW
    await f.ready(); assert.equal((await f.service.list()).requests[0].state, 'ready'); // NEW
    await fs.writeFile(f.filename, xml('', 'different')); state = (await f.service.list()).requests[0]; assert.equal(state.state, 'downloading'); assert.match(state.reason, /does not match/); // NEW
    f.registry[0].revoked = true; assert.equal((await f.service.resume({ id: request.id })).state, 'revoked'); // NEW
}); // NEW

test('completion secrets require the watched project, linkage must be saved, and catalog failure retries without losing progress', async t => { // NEW
    const f = await fixture(t), request = await f.service.start({ text: block() }); await f.ready(); // NEW
    f.setWatched('another-file'); await assert.rejects(f.service.prepare({ id: request.id }), /Wrong watched/); f.setWatched(f.filename); // NEW
    assert.equal((await f.service.prepare({ id: request.id })).code, 'SECRET-CODE'); await assert.rejects(f.service.complete({ id: request.id }), /save your identity linkage/); // NEW
    await f.ready('identity-a'); f.failImport(); await assert.rejects(f.service.complete({ id: request.id }), /Catalog disk full/); assert.equal((await f.make().list()).requests.length, 1); // NEW
    const complete = await f.make().complete({ id: request.id }); assert.equal(complete.state, 'complete'); assert.equal((await f.service.list()).requests.length, 0); // NEW
    assert.equal((await f.service.preview({ text: block({ expiresAt: 1 }) })).alreadyJoined, true); // NEW: an old email can locate its already accepted, authorized project.
    assert.equal((await f.service.start({ text: block() })).state, 'complete'); const journal = JSON.parse(await fs.readFile(path.join(f.root, 'identity-a/local-joins', request.id + '.json'), 'utf8')); assert.equal(journal.secrets, null); // NEW
}); // NEW

test('session-only secrets give a restart notice and repasting restores completion inputs', async t => { // NEW
    const f = await fixture(t, { protect() { throw new Error('Protection unavailable'); } }), request = await f.service.start({ text: block() }); assert.match(request.warning, /paste.*again after restarting/); await f.ready(); // NEW
    assert.equal((await f.service.prepare({ id: request.id })).code, 'SECRET-CODE'); const restarted = f.make(); await assert.rejects(restarted.prepare({ id: request.id }), /Paste this invitation again/); // NEW
    await restarted.start({ text: block() }); assert.equal((await restarted.prepare({ id: request.id })).code, 'SECRET-CODE'); assert.equal(f.joins(), 1); // NEW
}); // NEW

test('requests cannot cross identities or a changed login generation', async t => { // NEW
    const f = await fixture(t), request = await f.service.start({ text: block() }); f.switchIdentity({ identityId: 'identity-b', generation: 2, username: 'Other' }); // NEW
    assert.equal((await f.service.list()).requests.length, 0); await assert.rejects(f.service.resume({ id: request.id }), { code: 'ENOENT' }); await assert.rejects(f.service.start({ text: block(), identityId: 'identity-a', generation: 1 }), /identity changed/); // NEW
    let finish; const slow = f.make({ protect: text => new Promise(resolve => { finish = () => resolve(text); }) }), starting = slow.start({ text: block() }); // NEW
    while (!finish) await new Promise(resolve => setImmediate(resolve)); f.switchIdentity({ identityId: 'identity-b', generation: 3, username: 'Other' }); finish(); await assert.rejects(starting, /identity changed/); assert.equal(f.joins(), 1); // NEW
}); // NEW

test('existing-member invitations are distinguished without creating a second collaborator', async t => { // NEW
    const f = await fixture(t), request = await f.service.start({ text: block({ code: undefined, deviceSetup: { payload: { id: 'setup' }, signature: 'signed' } }) }); // NEW
    assert.equal(request.deviceSetup, true); await f.ready(); const prepared = await f.service.prepare({ id: request.id }); assert.equal(prepared.code, ''); assert.equal(prepared.userId, 'member'); // NEW
}); // NEW

test('repasting repairs a damaged local journal and completed requests still honor lost project access', async t => { // NEW
    const f = await fixture(t), request = await f.service.start({ text: block() }), filename = path.join(f.root, 'identity-a/local-joins', request.id + '.json'); // NEW
    await fs.writeFile(filename, '{damaged'); assert.equal((await f.service.list()).errors.length, 1); await f.service.start({ text: block() }); assert.equal(f.joins(), 1); // NEW
    await f.ready('identity-a'); await f.service.complete({ id: request.id }); await f.service.complete({ id: request.id }); assert.equal(f.imports(), 1); // NEW
    await fs.writeFile(f.filename, xml('identity-a').replace('trellis_access_open="1"', '')); assert.equal((await f.service.start({ text: block() })).state, 'revoked'); // NEW
}); // NEW

test('a fresh invitation replaces an unapproved request and supersedes its old journal without another registration', async t => { // NEW
    const f = await fixture(t), first = await f.service.start({ text: block() }); // NEW
    f.transport.resumeJoin = async ({ inviteId }) => { f.registry[0].joinInviteId = inviteId; return { reply: 'fresh-approval-reply' }; }; // NEW
    const fresh = await f.service.start({ text: block({ inviteId: 'fresh-invitation' }) }); assert.equal(fresh.state, 'waiting'); assert.equal(fresh.reply, 'fresh-approval-reply'); assert.equal(f.joins(), 1); // NEW
    const old = (await f.service.list()).requests.find(request => request.id === first.id); assert.equal(old.state, 'revoked'); assert.match(old.reason, /newer invitation/); assert.equal((await f.service.resume({ id: first.id })).state, 'revoked'); // NEW
}); // NEW
