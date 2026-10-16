// NEW: Behavioral coverage for the sharing service with isolated local profiles and a fake REST peer.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { EventEmitter } from 'node:events';
import { pathToFileURL } from 'node:url'; // NEW
import { assertSharingFileAccess } from '../src/main/trellis-sharing-files.js'; // NEW
import { createSyncthingService } from '../src/main/trellis-syncthing-service.js';
import { inspectDiagram, preserveAccess, hasCanvasAccess, encodeBlock, decodeBlock, digest, canonical, signRecord, inviteFingerprint } from '../src/main/trellis-share-protocol.js';

const device = letter => Array(8).fill(letter.repeat(7)).join('-');
const fixtureInviteExpiry = Date.now() + 86400000; // NEW: pages in a fixture share the same user-store timestamp even under CPU load.
const escape = value => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
function xml(options = {}) {
    const store = { usersEnabled: true, users: [{ id: 'admin', name: 'Admin', admin: true }, { id: 'alice', name: 'Alice', email: 'alice@example.org', admin: false }, { id: 'bob', name: 'Bob', email: 'bob@example.org', admin: true }], pendingUsers: [{ id: 'invite-user', email: 'invite@example.org' }], invites: [{ id: 'invite-1', email: 'invite@example.org', pendingUserId: 'invite-user', scopeCellIds: ['board'], createdBy: 'admin', status: 'pending', expiresAt: fixtureInviteExpiry }], ...options.store };
    return '<mxGraphModel><root><mxCell id="0"/><object id="1" trellis_history_id="diagram-1" trellis_users_json="' + escape(JSON.stringify(store)) + '"><mxCell parent="0"/></object><object id="board" label="' + (options.label || 'Board') + '" trellis_owner_user_id="' + (options.owner || 'admin') + '" trellis_access_user_ids_json="' + escape(JSON.stringify(options.grants || ['alice', 'invite-user', 'bob'])) + '"' + (options.open ? ' trellis_access_open="1"' : '') + '><mxCell parent="1" vertex="1" style="' + (options.style || '') + '"/></object></root></mxGraphModel>';
}
async function fixture(t, letter = 'A') {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'trellis-sharing-test-'));
    const binaryRoot = path.join(root, 'binaries');
    const binaryDir = path.join(binaryRoot, 'win32-x64');
    await fs.mkdir(binaryDir, { recursive: true });
    const binary = Buffer.from('test binary');
    await fs.writeFile(path.join(binaryDir, 'syncthing.exe'), binary);
    await fs.writeFile(path.join(binaryDir, 'manifest.json'), JSON.stringify({ version: '2.1.6', platform: 'win32', arch: 'x64', binarySha256: digest(binary) }));
    const userDataPath = path.join(root, 'profile');
    const home = path.join(userDataPath, 'trellis-sharing', 'syncthing');
    await fs.mkdir(home, { recursive: true });
    await fs.writeFile(path.join(home, 'config.xml'), '<configuration version="37"/>');
    const calls = [];
    let config = { folders: [{ id: 'default' }], devices: [], defaults: { folder: {}, device: {} }, options: {} };
    let process;
    let spawnCount = 0;
    let statusGate = null; // NEW: simulate a REST response crossing explicit shutdown.
    let shutdownGate = null, shutdownExits = true, killExits = true, shutdownError = false; const processes = []; // NEW
    const connections = {};
    const service = createSyncthingService({ userDataPath, documentsPath: path.join(root, 'documents'), binaryRoot, platform: 'win32', arch: 'x64', setStartup: async enabled => calls.push({ startup: enabled }), spawn(executable, args, opts) {
        spawnCount++;
        calls.push({ executable, args, opts });
        process = new EventEmitter();
        processes.push(process); process.kill = () => { process.kills = (process.kills || 0) + 1; if (killExits) process.emit('exit', 0); return true; }; // CHANGE
        return process;
    }, fetch: async (url, opts) => {
        const endpoint = new URL(url).pathname.slice(6);
        calls.push({ endpoint, method: opts.method, data: opts.body && JSON.parse(opts.body) });
        let result = {};
        if (endpoint === 'system/status') { if (statusGate) await statusGate; result = { myID: device(letter) }; } // CHANGE
        else if (endpoint === 'config') { if (opts.method === 'PUT') config = JSON.parse(opts.body); else result = structuredClone(config); }
        else if (endpoint === 'system/connections') result = { connections };
        else if (endpoint === 'db/status') result = { state: 'idle', needTotalItems: 0 };
        else if (endpoint === 'system/shutdown') { const target = process; if (shutdownGate) await shutdownGate; if (shutdownExits) target.emit('exit', 0); if (shutdownError) throw new Error('Shutdown response disconnected'); } // CHANGE
        return { ok: true, text: async () => JSON.stringify(result) };
    } });
    t.after(async () => { await service.stop(); await fs.rm(root, { recursive: true, force: true }); });
    return { service, root, calls, connections, config: () => config, spawnCount: () => spawnCount, userDataPath, crash: () => process.emit('exit', 1), setStatusGate: gate => { statusGate = gate; }, processes, setShutdown: (gate, exits = true, error = false) => { shutdownGate = gate; shutdownExits = exits; shutdownError = error; }, setKillExits: value => { killExits = value; } }; // CHANGE
}
async function setup(f, content = xml()) {
    const source = path.join(f.root, 'original.drawio');
    await fs.writeFile(source, content);
    f.service.setContext(1, { diagramPath: source, diagramId: 'diagram-1', userId: 'admin' });
    const result = await f.service.setupCanvas(1, { diagramPath: source, diagramId: 'diagram-1', xml: content });
    return { source, result };
}

test('admin migration isolates v2 records, keeps a backup, and permits local saving after transport stops', async t => { // NEW
    const f = await fixture(t), { result: legacy } = await setup(f); // NEW
    const upgraded = await f.service.upgradeCollaboration(1, { shareId: legacy.shareId }); // NEW
    assert.equal(upgraded.protocolVersion, 2); assert.notEqual(upgraded.shareId, legacy.shareId); assert.match(upgraded.folderId, /^trellis-v2-/); // NEW
    assert.equal(await fs.readFile(legacy.diagramPath, 'utf8'), upgraded.xml); // NEW
    const ignores = f.calls.filter(c => c.endpoint === 'db/ignores').at(-1).data.ignore; assert.equal(ignores.includes('!/' + path.basename(upgraded.diagramPath)), false); // NEW
    await f.service.stop(); // NEW
    const local = await f.service.collaborationAction(1, { shareId: upgraded.shareId, kind: 'save', baseXml: upgraded.xml, xml: upgraded.xml.replace('label="Board"', 'label="Local edit"') }); // NEW
    assert.equal(local.ok, true); assert.match(await fs.readFile(upgraded.diagramPath, 'utf8'), /Local edit/); // NEW
    const backup = local.collaboration.recoveries.find(copy => copy.reason.includes('Verified full backup')); assert.ok(backup); assert.equal(await fs.readFile(backup.recoveryPath, 'utf8'), upgraded.xml); // NEW: the full migration backup is accessible through the collaboration overview.
    const known = await f.service.shareInfo({ diagramPath: upgraded.diagramPath }); assert.equal(known.managed, true); // NEW
}); // NEW
test('migration rejects unresolved native conflicts and unprivileged callers', async t => { // NEW
    const f = await fixture(t), { result } = await setup(f); // NEW
    f.service.setContext(2, { diagramPath: result.diagramPath, diagramId: 'diagram-1', userId: 'alice' }); // NEW
    await assert.rejects(f.service.upgradeCollaboration(2, { shareId: result.shareId }), /admin/); // NEW
    await fs.writeFile(path.join(result.folderPath, 'original.sync-conflict-20261011-120000-DEVICE.drawio'), xml()); // NEW
    await assert.rejects(f.service.upgradeCollaboration(1, { shareId: result.shareId }), /conflict/); // NEW
}); // NEW
test('approval completion requires the signed acknowledgement for that exact request', async t => { // NEW
    const a = await fixture(t, 'A'), b = await fixture(t, 'B'), { result } = await setup(a); // NEW
    const invitation = await a.service.createInviteBlock(1, { shareId: result.shareId, inviteId: 'invite-1', code: 'ABCDE' }); // NEW
    const joined = await b.service.joinCanvas({ block: invitation.block }); // NEW
    const first = await a.service.requestMembership(1, { shareId: result.shareId, operation: 'approve', reply: joined.reply }); // NEW
    const repeated = await a.service.requestMembership(1, { shareId: result.shareId, operation: 'approve', reply: joined.reply }); // NEW
    const directory = path.join(result.folderPath, '.trellis', 'acknowledgements'); // NEW
    await fs.copyFile(path.join(directory, first.requestId + '.json'), path.join(directory, repeated.requestId + '.json')); // NEW
    const item = (await a.service.listRequests(1, { shareId: result.shareId })).requests.find(request => request.id === repeated.requestId); // NEW
    assert.equal(item.status, 'pending'); // NEW
}); // NEW
test('diagram parser supports compressed pages and preserves protected access on resolution', () => {
    const current = xml({ owner: 'admin' });
    const compressed = zlib.deflateRawSync(Buffer.from(encodeURIComponent(current))).toString('base64');
    const state = inspectDiagram('<mxfile><diagram id="page">' + compressed + '</diagram></mxfile>');
    assert.equal(state.store.users[0].id, 'admin');
    assert.equal(hasCanvasAccess(state, 'alice'), true);
    const chosen = xml({ owner: 'alice', label: 'Changed' });
    const resolved = inspectDiagram(preserveAccess(chosen, current));
    const board = resolved.cells.find(cell => cell.id === 'board');
    assert.equal(board.node.getAttribute('trellis_owner_user_id'), 'admin');
    assert.equal(board.node.getAttribute('label'), 'Changed');
    assert.throws(() => inspectDiagram('<!DOCTYPE foo [<!ENTITY x SYSTEM "file:///secret">]><mxGraphModel/>'), /Invalid/);
});
test('startup is single-flight, private, pinned, and removes unrelated defaults', async t => {
    const f = await fixture(t);
    await Promise.all([f.service.start(), f.service.start(), f.service.start()]);
    assert.equal(f.spawnCount(), 1);
    const launch = f.calls.find(call => call.args);
    assert.ok(launch.args.includes('--no-upgrade'));
    assert.equal(launch.opts.windowsHide, true);
    assert.ok(launch.args.every(arg => !arg.includes('apikey')));
    assert.equal(f.config().folders.length, 0);
    const publicInfo = await f.service.shareInfo({});
    assert.equal(publicInfo.deviceId, device('A'));
    assert.equal(JSON.stringify(publicInfo).includes('privateKey'), false);
    assert.equal(JSON.stringify(publicInfo).includes('apiKey'), false);
});
test('managed setup moves a verified original and copies only explicitly referenced assets', async t => {
    const f = await fixture(t);
    await fs.writeFile(path.join(f.root, 'photo.png'), 'image bytes');
    await fs.writeFile(path.join(f.root, 'unrelated.txt'), 'private');
    const { source, result } = await setup(f, xml({ style: 'image=photo.png;' }));
    await assert.rejects(fs.access(source));
    assert.equal(await fs.readFile(path.join(f.root, 'unrelated.txt'), 'utf8'), 'private');
    assert.match(result.xml, /image=assets\//);
    assert.equal((await fs.readdir(path.join(result.folderPath, 'assets'))).length, 1);
    const asset = path.join(result.folderPath, 'assets', (await fs.readdir(path.join(result.folderPath, 'assets')))[0]); // NEW
    assert.equal(await f.service.isManagedAssetRequest(1, pathToFileURL(asset).href), true);
    assert.equal(await f.service.isManagedAssetRequest(999, pathToFileURL(asset).href), false);
    assert.equal(await f.service.isManagedAssetRequest(1, pathToFileURL(path.join(f.root, 'photo.png')).href), false);
    assert.equal(await fs.readFile(result.diagramPath, 'utf8'), result.xml);
    assert.equal(f.calls.some(call => call.startup === true), true);
    assert.equal((await fs.readdir(result.folderPath)).includes('unrelated.txt'), false);
    assert.ok(f.calls.some(call => call.endpoint === 'db/ignores' && call.data.ignore.includes('**')));
});
test('missing referenced asset leaves the original usable and no registered share', async t => {
    const f = await fixture(t);
    const source = path.join(f.root, 'original.drawio');
    const content = xml({ style: 'image=missing.png;' });
    await fs.writeFile(source, content);
    f.service.setContext(1, { diagramPath: source, diagramId: 'diagram-1', userId: 'admin' });
    await assert.rejects(f.service.setupCanvas(1, { diagramPath: source, diagramId: 'diagram-1', xml: content }), /asset is missing/);
    assert.equal(await fs.readFile(source, 'utf8'), content);
    assert.equal(f.service.hasCanvases(), false);
});
test('invite blocks exclude local paths; join produces a reply and rejects duplicate setup', async t => {
    const a = await fixture(t, 'A');
    const b = await fixture(t, 'B');
    const { result } = await setup(a);
    const block = await a.service.createInviteBlock(1, { shareId: result.shareId, inviteId: 'invite-1', code: 'ABCDE' });
    const invite = decodeBlock('INVITE', block.block);
    assert.equal(invite.email, 'invite@example.org');
    assert.equal(invite.senderDeviceId, device('A')); // NEW
    assert.equal(invite.coordinatorDeviceId, device('A')); // NEW
    assert.equal(invite.folderPath, undefined);
    const joined = await b.service.joinCanvas({ block: block.block, senderEmail: 'sender@example.org' });
    assert.equal(decodeBlock('REPLY', joined.reply).deviceId, device('B'));
    await assert.rejects(b.service.joinCanvas({ block: block.block }), /already joined/);
    await assert.rejects(b.service.joinCanvas({ block: encodeBlock('INVITE', { ...invite, shareId: 'expired', expiresAt: 0 }) }), /expired/);
});
test('approval validates admin identity, links device to pending user, and rejects replay', async t => {
    const a = await fixture(t, 'A');
    const b = await fixture(t, 'B');
    const { result } = await setup(a);
    const block = await a.service.createInviteBlock(1, { shareId: result.shareId, inviteId: 'invite-1', code: 'ABCDE' });
    const joined = await b.service.joinCanvas({ block: block.block });
    const request = await a.service.requestMembership(1, { shareId: result.shareId, operation: 'approve', reply: joined.reply });
    const requests = await a.service.listRequests(1, { shareId: result.shareId });
    assert.equal(requests.requests.find(item => item.id === request.requestId).status, 'applied');
    assert.ok(requests.members.some(member => member.deviceId === device('B') && member.userId === 'invite-user'));
    assert.equal(foldersFor(a).some(folder => folder.devices.some(peer => peer.deviceID === device('B'))), true);
    a.service.setContext(2, { diagramPath: result.diagramPath, diagramId: 'diagram-1', userId: 'alice' });
    await assert.rejects(a.service.requestMembership(2, { shareId: result.shareId, operation: 'remove', targetDeviceId: device('B') }), /admin/);
    const duplicate = await a.service.requestMembership(1, { shareId: result.shareId, operation: 'approve', reply: joined.reply });
    assert.equal((await a.service.listRequests(1, { shareId: result.shareId })).requests.find(item => item.id === duplicate.requestId).status, 'rejected');
});
function foldersFor(f) { return f.config().folders; }
test('three-device manifests form a mesh and retain queued remote-admin changes while coordinator is offline', async t => {
    const a = await fixture(t, 'A');
    const b = await fixture(t, 'B');
    const c = await fixture(t, 'C');
    const { result } = await setup(a);
    const block = await a.service.createInviteBlock(1, { shareId: result.shareId, inviteId: 'invite-1', code: 'ABCDE' });
    const joinB = await b.service.joinCanvas({ block: block.block });
    const joinC = await c.service.joinCanvas({ block: block.block });
    await a.service.requestMembership(1, { shareId: result.shareId, operation: 'approve', reply: joinB.reply });
    await a.service.requestMembership(1, { shareId: result.shareId, operation: 'approve', reply: joinC.reply });
    for (const f of [b, c]) {
        const local = f.service.listStatus()[0];
        await fs.writeFile(local.diagramPath, result.xml);
        await fs.cp(path.join(result.folderPath, '.trellis'), path.join(path.dirname(local.diagramPath), '.trellis'), { recursive: true });
        await f.service.poll();
        assert.equal(f.config().folders[0].devices.length, 3);
        assert.ok(f.config().devices.every(peer => peer.introducer === false));
    }
    const bCanvas = b.service.listStatus()[0];
    b.service.setContext(1, { diagramPath: bCanvas.diagramPath, diagramId: 'diagram-1', userId: 'bob' });
    const pending = await b.service.requestMembership(1, { shareId: result.shareId, operation: 'remove', targetDeviceId: device('C') });
    assert.equal((await b.service.listRequests(1, { shareId: result.shareId })).requests.find(item => item.id === pending.requestId).status, 'pending');
    // Copy the immutable request to simulate eventual transport after the coordinator reconnects.
    await fs.cp(path.join(path.dirname(bCanvas.diagramPath), '.trellis', 'requests'), path.join(result.folderPath, '.trellis', 'requests'), { recursive: true });
    await a.service.poll();
    assert.equal((await a.service.listRequests(1, { shareId: result.shareId })).requests.find(item => item.id === pending.requestId).status, 'applied');
    assert.equal(a.config().folders[0].devices.some(peer => peer.deviceID === device('C')), false);
});
test('disabled collaborators are removed but open access preserves effective membership', async t => {
    const a = await fixture(t, 'A');
    const b = await fixture(t, 'B');
    const { result } = await setup(a);
    const block = await a.service.createInviteBlock(1, { shareId: result.shareId, inviteId: 'invite-1', code: 'ABCDE' });
    const joined = await b.service.joinCanvas({ block: block.block });
    await a.service.requestMembership(1, { shareId: result.shareId, operation: 'approve', reply: joined.reply });
    const state = inspectDiagram(result.xml);
    state.store.pendingUsers = [];
    state.store.invites[0].status = 'accepted';
    state.store.users.push({ id: 'invite-user', name: 'Invited', disabled: false });
    const content = xml({ store: state.store, grants: [], open: true });
    await fs.writeFile(result.diagramPath, content);
    await a.service.poll();
    assert.equal((await a.service.listRequests(1, { shareId: result.shareId })).members.length, 2);
    state.store.users.find(user => user.id === 'invite-user').disabled = true;
    await fs.writeFile(result.diagramPath, xml({ store: state.store, grants: [], open: true }));
    await a.service.poll();
    assert.equal((await a.service.listRequests(1, { shareId: result.shareId })).members.length, 1);
});
test('history export requires the saved file hash and validates immutable imports', async t => {
    const f = await fixture(t);
    const { result } = await setup(f);
    const entry = { revision: { id: 'revision-1', diagramHistoryId: 'diagram-1', timestamp: Date.now() + 1000, snapshotId: 'snapshot-1', actorUserId: 'alice', parentRevisionId: 'older' }, snapshot: { snapshotId: 'snapshot-1', compressedXml: '<mxGraphModel/>', compressedKind: 'plain' } };
    await assert.rejects(f.service.exportHistory(1, { shareId: result.shareId, savedHash: 'bad', entries: [entry] }), /saved canvas/);
    await assert.rejects(f.service.exportHistory(1, { shareId: result.shareId, savedHash: digest(result.xml), entries: [{ ...entry, revision: { ...entry.revision, timestamp: undefined } }] }), /Invalid shared/); // NEW
    await f.service.exportHistory(1, { shareId: result.shareId, savedHash: digest(result.xml), entries: [entry] });
    await f.service.exportHistory(1, { shareId: result.shareId, savedHash: digest(result.xml), entries: [entry] });
    const imported = await f.service.importHistory(1, { shareId: result.shareId });
    assert.equal(imported.entries[0].revision.actorUserId, 'alice');
    assert.equal((await f.service.importHistory(1, { shareId: result.shareId, knownIds: ['revision-1'] })).entries.length, 0);
    const filename = path.join(result.folderPath, '.trellis', 'history', 'revision-1.json');
    const record = JSON.parse(await fs.readFile(filename, 'utf8'));
    record.payload.revision.actorUserId = 'forged';
    await fs.writeFile(filename, JSON.stringify(record));
    assert.equal((await f.service.importHistory(1, { shareId: result.shareId })).errors.length, 1);
});
test('only admins resolve conflicts, retaining inputs and current ownership', async t => {
    const f = await fixture(t);
    const { result } = await setup(f);
    const filename = 'original.sync-conflict-20261011-120000-DEVICE.drawio';
    await fs.writeFile(path.join(result.folderPath, filename), xml({ owner: 'alice', label: 'Conflict changes' }));
    await f.service.poll();
    assert.equal(f.service.listStatus()[0].state, 'conflict');
    f.service.setContext(2, { diagramPath: result.diagramPath, diagramId: 'diagram-1', userId: 'alice' });
    await assert.rejects(f.service.resolveConflict(2, { shareId: result.shareId, filename, expectedHash: digest(result.xml) }), /admin/);
    await assert.rejects(f.service.inspectConflict(1, { shareId: result.shareId, filename: '../secret' }), /Unknown/);
    await assert.rejects(f.service.resolveConflict(1, { shareId: result.shareId, filename, expectedHash: 'stale' }), /changed/);
    const inspected = await f.service.inspectConflict(2, { shareId: result.shareId, filename }); // NEW: regular collaborators may inspect, but cannot publish.
    assert.equal(inspected.currentHash, digest(result.xml));
    assert.equal(inspected.differences.changed, 1);
    assert.equal(inspected.differences.cells[0].cellId, 'board');
    const resolved = await f.service.resolveConflict(1, { shareId: result.shareId, filename, expectedHash: digest(result.xml) });
    assert.match(resolved.xml, /Conflict changes/);
    assert.equal(inspectDiagram(resolved.xml).cells.find(cell => cell.id === 'board').node.getAttribute('trellis_owner_user_id'), 'admin');
    assert.equal((await fs.readdir(resolved.recoveryPath)).length, 2);
    await assert.rejects(fs.access(path.join(result.folderPath, filename)));
});
test('forged membership is rejected and stopped services show unknown connection counts', async t => {
    const f = await fixture(t);
    const { result } = await setup(f);
    await f.service.poll();
    const generated = crypto.generateKeyPairSync('ed25519');
    const record = signRecord({ schema: 1, shareId: result.shareId, diagramId: 'diagram-1', version: 99, coordinatorDeviceId: device('A'), members: [] }, generated.privateKey);
    await fs.writeFile(path.join(result.folderPath, '.trellis', 'membership', '000000000099.json'), JSON.stringify(record));
    await f.service.poll();
    assert.match(f.service.listStatus()[0].reason, /signature/);
    await f.service.stop();
    assert.equal(f.service.listStatus()[0].connectedCollaborators, null);
    assert.equal(f.service.listStatus()[0].state, 'unavailable');
});

test('additional-device invitations preserve existing accounts, rotate independently, and count distinct users', async t => {
    const a = await fixture(t, 'A');
    const b = await fixture(t, 'B');
    const c = await fixture(t, 'C');
    const d = await fixture(t, 'D');
    const { result } = await setup(a);
    const setup1 = await a.service.createDeviceInvite(1, { shareId: result.shareId, userId: 'alice' });
    const joinedB = await b.service.joinCanvas({ block: setup1.block });
    await a.service.requestMembership(1, { shareId: result.shareId, operation: 'approve', reply: joinedB.reply });
    const replay = await c.service.joinCanvas({ block: setup1.block });
    const rejected = await a.service.requestMembership(1, { shareId: result.shareId, operation: 'approve', reply: replay.reply });
    assert.match((await a.service.listRequests(1, { shareId: result.shareId })).requests.find(request => request.id === rejected.requestId).reason, /already used/);
    const setup2 = await a.service.createDeviceInvite(1, { shareId: result.shareId, userId: 'alice' });
    const joinedD = await d.service.joinCanvas({ block: setup2.block });
    await a.service.requestMembership(1, { shareId: result.shareId, operation: 'approve', reply: joinedD.reply });
    a.connections[device('B')] = { connected: true };
    a.connections[device('D')] = { connected: true };
    await a.service.poll();
    assert.equal(a.service.listStatus()[0].connectedCollaborators, 1);
    assert.equal((await a.service.listRequests(1, { shareId: result.shareId })).members.filter(member => member.userId === 'alice').length, 2);
    assert.equal(inspectDiagram(await fs.readFile(result.diagramPath, 'utf8')).store.users.filter(user => user.id === 'alice').length, 1);
});

test('resending a Users invitation invalidates device replies prepared with the old code', async t => {
    const a = await fixture(t, 'A');
    const b = await fixture(t, 'B');
    const store = inspectDiagram(xml()).store;
    store.invites[0].codeSalt = 'salt';
    store.invites[0].codeHash = inviteFingerprint('ABCDE', 'salt');
    const { result } = await setup(a, xml({ store }));
    const block = await a.service.createInviteBlock(1, { shareId: result.shareId, inviteId: 'invite-1', code: 'ABCDE' });
    const joined = await b.service.joinCanvas({ block: block.block });
    store.invites[0].codeHash = inviteFingerprint('NEWCODE', 'salt');
    await fs.writeFile(result.diagramPath, xml({ store }));
    await assert.rejects(a.service.createInviteBlock(1, { shareId: result.shareId, inviteId: 'invite-1', code: 'ABCDE' }), /rotated/);
    const approval = await a.service.requestMembership(1, { shareId: result.shareId, operation: 'approve', reply: joined.reply });
    assert.equal((await a.service.listRequests(1, { shareId: result.shareId })).requests.find(request => request.id === approval.requestId).status, 'rejected');
});

test('receiving a pre-approval manifest does not revoke or pause a pending join', async t => {
    const a = await fixture(t, 'A');
    const b = await fixture(t, 'B');
    const { result } = await setup(a);
    const block = await a.service.createInviteBlock(1, { shareId: result.shareId, inviteId: 'invite-1', code: 'ABCDE' });
    const joined = await b.service.joinCanvas({ block: block.block });
    const remoteFolder = path.dirname(joined.diagramPath);
    await fs.cp(path.join(result.folderPath, '.trellis'), path.join(remoteFolder, '.trellis'), { recursive: true });
    await b.service.poll();
    assert.equal(b.service.listStatus()[0].state, 'awaitingApproval');
    assert.equal(b.config().folders[0].paused, false);
    await a.service.requestMembership(1, { shareId: result.shareId, operation: 'approve', reply: joined.reply });
    await fs.cp(path.join(result.folderPath, '.trellis'), path.join(remoteFolder, '.trellis'), { recursive: true });
    await fs.writeFile(joined.diagramPath, result.xml);
    await b.service.poll();
    assert.equal(b.service.listStatus()[0].pending, false);
    assert.equal(b.config().folders[0].paused, false);
});

test('unsaved conflicts defer membership and preserve a reviewable recovery copy outside sync', async t => {
    const a = await fixture(t, 'A');
    const b = await fixture(t, 'B');
    const { result } = await setup(a);
    const block = await a.service.createInviteBlock(1, { shareId: result.shareId, inviteId: 'invite-1', code: 'ABCDE' });
    const joined = await b.service.joinCanvas({ block: block.block });
    await a.service.setConflictState(1, { shareId: result.shareId, conflicted: true });
    const request = await a.service.requestMembership(1, { shareId: result.shareId, operation: 'approve', reply: joined.reply });
    assert.equal((await a.service.listRequests(1, { shareId: result.shareId })).requests.find(item => item.id === request.requestId).status, 'pending');
    const copy = await a.service.saveRecoveryCopy(1, { shareId: result.shareId, xml: xml({ label: 'Local recovery' }) });
    assert.equal(copy.recoveryPath.startsWith(result.folderPath), false);
    assert.match((await a.service.inspectConflict(1, { shareId: result.shareId, filename: copy.filename })).xml, /Local recovery/);
    await a.service.setConflictState(1, { shareId: result.shareId, conflicted: false });
    assert.equal((await a.service.listRequests(1, { shareId: result.shareId })).requests.find(item => item.id === request.requestId).status, 'applied');
});

test('managed rename retains sharing identity and updates the native ignore allowlist', async t => {
    const f = await fixture(t);
    const { result } = await setup(f);
    const renamed = path.join(result.folderPath, 'Renamed.drawio');
    await fs.rename(result.diagramPath, renamed);
    const info = await f.service.shareInfo({ diagramPath: renamed });
    assert.equal(info.shareId, result.shareId);
    assert.equal(info.diagramPath, renamed);
    assert.ok(f.calls.some(call => call.endpoint === 'db/ignores' && call.data.ignore.includes('!/Renamed.drawio')));
});

test('tampered binaries and unsupported architectures never launch', async t => {
    const f = await fixture(t);
    await fs.writeFile(path.join(f.root, 'binaries', 'win32-x64', 'syncthing.exe'), 'modified binary');
    await assert.rejects(f.service.start(), /integrity/);
    assert.equal(f.spawnCount(), 0);
    const unsupported = createSyncthingService({ userDataPath: path.join(f.root, 'unsupported'), documentsPath: path.join(f.root, 'documents'), binaryRoot: path.join(f.root, 'binaries'), platform: 'win32', arch: 'ia32' });
    t.after(() => unsupported.stop());
    await assert.rejects(unsupported.start(), /unavailable/);
});

test('failed coordinator recovery restores the original registration and editable context', async t => {
    const f = await fixture(t);
    const { result } = await setup(f);
    await fs.writeFile(result.diagramPath, xml({ style: 'image=missing-recovery.png;' }));
    await assert.rejects(f.service.recovery(1, { shareId: result.shareId }), /asset is missing/);
    assert.equal(f.config().folders.find(folder => folder.id === result.folderId).paused, false);
    assert.equal((await f.service.listRequests(1, { shareId: result.shareId })).members.length, 1);
    assert.equal(f.service.listStatus().length, 1);
    assert.equal((await fs.readdir(result.folderPath)).includes('recovery-source.drawio'), false);
});

test('conflict resolution preserves access by page identity when pages are reordered', () => { // NEW
    const current = '<mxfile><diagram id="a">' + xml({ owner: 'admin' }) + '</diagram><diagram id="b">' + xml({ owner: 'alice' }) + '</diagram></mxfile>';
    const chosen = '<mxfile><diagram id="b">' + xml({ owner: 'bob', label: 'Edited B' }) + '</diagram><diagram id="a">' + xml({ owner: 'bob', label: 'Edited A' }) + '</diagram></mxfile>';
    const resolved = inspectDiagram(preserveAccess(chosen, current));
    const boards = resolved.cells.filter(cell => cell.id === 'board');
    assert.equal(boards[0].node.getAttribute('trellis_owner_user_id'), 'alice');
    assert.equal(boards[1].node.getAttribute('trellis_owner_user_id'), 'admin');
    assert.throws(() => inspectDiagram('<mxfile><diagram id="a">' + xml() + '</diagram><diagram id="a">' + xml() + '</diagram></mxfile>'), /unique page/);
});

test('managed setup relocates relative HTML file links and retains web links', async t => { // NEW
    const f = await fixture(t);
    await fs.writeFile(path.join(f.root, 'notes.txt'), 'linked asset');
    const content = xml().replace('label="Board"', 'label="&lt;a href=&quot;notes.txt&quot;&gt;Notes&lt;/a&gt;&lt;a href=&quot;https://example.org&quot;&gt;Web&lt;/a&gt;"');
    const { result } = await setup(f, content);
    const label = inspectDiagram(result.xml).cells.find(cell => cell.id === 'board').node.getAttribute('label');
    assert.match(label, /href="assets\/[a-f0-9]{16}\.txt"/);
    assert.match(label, /href="https:\/\/example.org"/);
});

test('Quit during a pending startup response does not restore readiness or restart the child', async t => { // NEW
    const f = await fixture(t);
    let release;
    f.setStatusGate(new Promise(resolve => { release = resolve; }));
    const starting = f.service.start();
    const rejected = assert.rejects(starting, /cancelled/);
    while (!f.calls.some(call => call.endpoint === 'system/status')) await new Promise(resolve => setTimeout(resolve, 10));
    await f.service.stop();
    release();
    await rejected;
    assert.equal(f.spawnCount(), 1);
    f.setStatusGate(null);
    assert.equal((await f.service.start()).ok, true);
    assert.equal(f.spawnCount(), 2);
});

test('daemon crashes consume a bounded retry budget and explicit restart resets it', async t => { // NEW
    const f = await fixture(t);
    await f.service.start();
    for (let count = 2; count <= 4; count++) {
        f.crash();
        const deadline = Date.now() + 5000;
        while (f.spawnCount() < count && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
        assert.equal(f.spawnCount(), count);
        await f.service.start();
    }
    f.crash();
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(f.spawnCount(), 4);
    await f.service.stop();
    assert.equal((await f.service.start()).ok, true);
    assert.equal(f.spawnCount(), 5);
});

test('concurrent stops share one graceful shutdown and observe synchronous exit', async t => { // NEW
    const f = await fixture(t); await f.service.start(); // NEW
    const first = f.service.stop(); assert.equal(first, f.service.stop()); // NEW
    assert.deepEqual(await first, { ok: true, forced: false }); // NEW
    assert.equal(f.calls.filter(call => call.endpoint === 'system/shutdown').length, 1); // NEW
    assert.equal(f.processes[0].listenerCount('exit'), 0); // NEW: both the daemon owner and temporary observer released their listeners.
}); // NEW

test('unresponsive shutdown REST is bounded and forces only the owned daemon', async t => { // NEW
    const f = await fixture(t); await f.service.start(); // NEW
    let release; f.setShutdown(new Promise(resolve => { release = resolve; }), false); // NEW
    const before = Date.now(); const result = await f.service.stop({ deadline: before + 30 }); release(); // NEW
    assert.equal(result.forced, true); assert.equal(f.processes[0].kills, 1); assert.ok(Date.now() - before < 1500); // NEW
    assert.equal(f.processes[0].listenerCount('exit'), 0); // NEW
}); // NEW

test('a disconnected shutdown response still permits the daemon to finish gracefully', async t => { // NEW
    const f = await fixture(t); await f.service.start(); f.setShutdown(null, false, true); // NEW
    const stopping = f.service.stop({ deadline: Date.now() + 500 }); setTimeout(() => f.processes[0].emit('exit', 0), 30); // NEW
    assert.deepEqual(await stopping, { ok: true, forced: false }); assert.equal(f.processes[0].kills || 0, 0); // NEW
}); // NEW

test('a successful kill request without exit is reported as failed termination', async t => { // NEW
    const f = await fixture(t); await f.service.start(); f.setShutdown(null, false); f.setKillExits(false); // NEW
    const rejected = assert.rejects(f.service.stop({ deadline: Date.now() + 10 }), /did not exit/); // NEW
    await rejected; assert.equal(f.processes[0].kills, 1); await assert.rejects(f.service.start(), /previous Syncthing process/); f.setKillExits(true); f.setShutdown(null, true); // CHANGE
}); // NEW

test('Quit during identity generation observes its exit and never launches serve afterwards', async t => { // NEW
    const f = await fixture(t); await fs.rm(path.join(f.userDataPath, 'trellis-sharing/syncthing/config.xml')); // NEW
    const starting = f.service.start(), rejected = assert.rejects(starting, /cancelled/); // NEW
    while (!f.calls.some(call => call.args?.[0] === 'generate')) await new Promise(resolve => setTimeout(resolve, 5)); // NEW
    const concurrent = assert.rejects(f.service.start(), /cancelled/); // NEW: concurrent callers join generation rather than misidentifying it as a failed stop.
    await f.service.stop(); await Promise.all([rejected, concurrent]); assert.equal(f.spawnCount(), 1); // CHANGE
    assert.equal(f.calls.some(call => call.args?.[0] === 'serve'), false); assert.equal(f.processes[0].kills, 1); // NEW
}); // NEW

test('old startup replies cannot stop or clear a replacement daemon', async t => { // NEW
    const f = await fixture(t); let release; f.setStatusGate(new Promise(resolve => { release = resolve; })); // NEW
    const old = f.service.start(), rejected = assert.rejects(old, /cancelled/); // NEW
    while (!f.calls.some(call => call.endpoint === 'system/status')) await new Promise(resolve => setTimeout(resolve, 5)); // NEW
    await f.service.stop(); f.setStatusGate(null); await f.service.start(); release(); await rejected; // NEW
    assert.equal(f.spawnCount(), 2); assert.equal(f.service.backgroundStatus().state, 'syncing'); // NEW
    assert.equal(f.processes[1].kills || 0, 0); // NEW
}); // NEW

test('Pause All preserves identity metadata pause across refresh and restart', async t => { // NEW
    const f = await fixture(t); const input = { identityId: 'identity', directory: path.join(f.root, 'metadata'), devices: [{ syncthingId: device('A'), name: 'Desktop' }] }; // NEW
    await f.service.configureIdentityMetadata(input); await f.service.setPaused({ paused: true }); // NEW
    assert.equal(f.config().folders.find(folder => folder.id === 'trellis-identity-identity').paused, true); // NEW
    await f.service.configureIdentityMetadata(input); await f.service.stop(); await f.service.start(); // NEW
    assert.equal(f.config().folders.find(folder => folder.id === 'trellis-identity-identity').paused, true); // NEW
    await f.service.setPaused({ paused: false }); assert.equal(f.service.backgroundStatus().state, 'syncing'); // NEW
}); // NEW

test('private sharing paths cannot be read through generic IPC or copied as assets', async t => { // NEW
    const f = await fixture(t);
    await f.service.initialize();
    const profile = path.join(f.userDataPath, 'trellis-sharing');
    const secret = path.join(profile, 'api-key');
    for (const filename of [secret, path.join(profile, 'signing-key.json'), path.join(profile, 'syncthing', 'config.xml'), path.join(profile, 'syncthing', 'new-secret')]) await assert.rejects(assertSharingFileAccess(filename, profile), /Private sharing/);
    await assertSharingFileAccess(path.join(profile, 'recovery', 'local.drawio'), profile);
    await assertSharingFileAccess(path.join(f.root, 'normal.drawio'), profile);
    const content = xml({ style: 'image=' + pathToFileURL(secret).href + ';' });
    const source = path.join(f.root, 'original.drawio');
    await fs.writeFile(source, content);
    f.service.setContext(1, { diagramPath: source, diagramId: 'diagram-1', userId: 'admin' });
    await assert.rejects(f.service.setupCanvas(1, { diagramPath: source, diagramId: 'diagram-1', xml: content }), /Private sharing/);
    assert.equal(await fs.readFile(source, 'utf8'), content);
    const alias = path.join(f.root, 'alias');
    await fs.symlink(path.join(profile, 'syncthing'), alias, process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(assertSharingFileAccess(path.join(alias, 'new-secret'), profile), /Private sharing/);
});

test('automatic sign-in registration is one-time and does not override later opt-outs', async t => { // NEW
    const f = await fixture(t);
    const { result } = await setup(f);
    assert.equal(f.calls.filter(call => call.startup === true).length, 1);
    await f.service.recovery(1, { shareId: result.shareId });
    assert.equal(f.calls.filter(call => call.startup === true).length, 1);
});
