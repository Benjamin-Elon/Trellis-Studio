// NEW: Behavioral coverage for the sharing service with isolated local profiles and a fake REST peer.
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite'; // NEW
import { createHistoryService } from '../src/main/trellis-history-service.js'; // NEW
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
import { replay } from '../src/main/trellis-collaboration-protocol.js'; // NEW
import { inspectDiagram, hasCanvasAccess, encodeBlock, decodeBlock, digest, canonical, signRecord, inviteFingerprint } from '../src/main/trellis-share-protocol.js'; // CHANGE

const device = letter => Array(8).fill(letter.repeat(7)).join('-');
const fixtureInviteExpiry = Date.now() + 86400000; // NEW: pages in a fixture share the same user-store timestamp even under CPU load.
const escape = value => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
function xml(options = {}) {
    const store = { usersEnabled: true, users: [{ id: 'admin', name: 'Admin', admin: true }, { id: 'alice', name: 'Alice', email: 'alice@example.org', admin: false }, { id: 'bob', name: 'Bob', email: 'bob@example.org', admin: true }], pendingUsers: [{ id: 'invite-user', email: 'invite@example.org' }], invites: [{ id: 'invite-1', email: 'invite@example.org', pendingUserId: 'invite-user', scopeCellIds: ['board'], createdBy: 'admin', status: 'pending', expiresAt: fixtureInviteExpiry }], ...options.store };
    return '<mxGraphModel><root><mxCell id="0"/><object id="1" trellis_history_id="diagram-1" trellis_users_json="' + escape(JSON.stringify(store)) + '"><mxCell parent="0"/></object><object id="board" label="' + (options.label || 'Board') + '" trellis_owner_user_id="' + (options.owner || 'admin') + '" trellis_access_user_ids_json="' + escape(JSON.stringify(options.grants || ['alice', 'invite-user', 'bob'])) + '"' + (options.open ? ' trellis_access_open="1"' : '') + '><mxCell parent="1" vertex="1" style="' + (options.style || '') + '"/></object></root></mxGraphModel>';
}
async function fixture(t, letter = 'A', options = {}) {
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
    let configurationFail = false; // CHANGE
    let statusGate = null; // NEW: simulate a REST response crossing explicit shutdown.
    let shutdownGate = null, shutdownExits = true, killExits = true, shutdownError = false; const processes = []; // NEW
    const connections = {}; let connectionsFail = false; // CHANGE
    const histories = createHistoryService({ Database: DatabaseSync, dbPath: ':memory:' }); // NEW
    const service = createSyncthingService({ ...options, historyService: () => histories, userDataPath, documentsPath: path.join(root, 'documents'), binaryRoot, platform: 'win32', arch: 'x64', setStartup: async enabled => calls.push({ startup: enabled }), spawn(executable, args, opts) {
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
        else if (endpoint === 'config') { if (opts.method === 'PUT' && configurationFail) throw new Error('Configuration cleanup failed'); if (opts.method === 'PUT') config = JSON.parse(opts.body); else result = structuredClone(config); }
        else if (endpoint === 'system/connections') { if (connectionsFail) throw new Error('Connections unavailable'); result = { connections }; } // CHANGE
        else if (endpoint === 'db/status') result = { state: 'idle', needTotalItems: 0 };
        else if (endpoint === 'system/shutdown') { const target = process; if (shutdownGate) await shutdownGate; if (shutdownExits) target.emit('exit', 0); if (shutdownError) throw new Error('Shutdown response disconnected'); } // CHANGE
        return { ok: true, text: async () => JSON.stringify(result) };
    } });
    t.after(async () => { await service.stop(); histories.close(); await fs.rm(root, { recursive: true, force: true }); });
    return { service, histories, root, calls, connections, setConfigurationFail: value => { configurationFail = value; }, setConnectionsFail: value => { connectionsFail = value; }, config: () => config, spawnCount: () => spawnCount, userDataPath, crash: () => process.emit('exit', 1), setStatusGate: gate => { statusGate = gate; }, processes, setShutdown: (gate, exits = true, error = false) => { shutdownGate = gate; shutdownExits = exits; shutdownError = error; }, setKillExits: value => { killExits = value; } }; // CHANGE
}
async function setup(f, content = xml()) {
    const source = path.join(f.root, 'original.drawio');
    await fs.writeFile(source, content);
    f.service.setContext(1, { diagramPath: source, diagramId: 'diagram-1', userId: 'admin' });
    const result = await f.service.setupCanvas(1, { diagramPath: source, diagramId: 'diagram-1', xml: content });
    return { source, result };
}

test('scoped activity and private recovery complete while a content commit is stalled, and reject a changed author', { timeout: 20000 }, async t => { // NEW
    let block = false, release, entered; const gate = new Promise(resolve => { release = resolve; }), waiting = new Promise(resolve => { entered = resolve; }); // NEW
    t.after(release); // NEW
    const f = await fixture(t, 'A', { replayWorker: async (xml, records, time) => { if (block) { entered(); await gate; } return replay(xml, records, time); } }); // NEW
    const { result } = await setup(f), baseXml = await fs.readFile(result.diagramPath, 'utf8'), key = '["","board"]'; // NEW
    await f.service.activityAction(1, { shareId: result.shareId, kind: 'claim', targets: [key] }); // NEW
    block = true; let completed = false; const save = f.service.collaborationAction(1, { shareId: result.shareId, kind: 'save', baseXml, xml: baseXml.replace('label="Bed"', 'label="Changed"') }).finally(() => { completed = true; }); // NEW
    await waiting; const activity = await f.service.activityAction(1, { shareId: result.shareId, kind: 'publish', expectedUserId: 'admin', revision: 1, pending: [key] }); // NEW
    assert.equal(activity.collaboration.pendingChanges[0].userId, 'admin'); assert.equal(completed, false); // NEW
    await f.service.recoveryAction(1, { shareId: result.shareId, kind: 'checkpoint', expectedUserId: 'admin', revision: 1, baseXml, xml: baseXml.replace('label="Bed"', 'label="Draft"'), editorDrafts: [] }); // NEW
    assert.equal((await f.service.recoveryAction(1, { shareId: result.shareId, kind: 'restore' })).drafts.length, 1); assert.equal(completed, false); // NEW
    f.service.setContext(1, { diagramPath: result.diagramPath, diagramId: 'diagram-1', userId: 'alice' }); // NEW
    await assert.rejects(f.service.recoveryAction(1, { shareId: result.shareId, kind: 'checkpoint', expectedUserId: 'admin' }), /author changed/); // NEW
    block = false; release(); await save; // NEW
}); // NEW

/** Publish fixture mutations through the same journal as the editor. */ // CHANGE
async function save(f, canvas, content) { // CHANGE
    const baseXml = await fs.readFile(canvas.diagramPath, 'utf8'); // CHANGE
    const result = await f.service.collaborationAction(1, { shareId: canvas.shareId, kind: 'save', baseXml, xml: content }); // CHANGE
    assert.equal(result.ok, true, result.reason); // CHANGE
    await f.service.collaborationAction(1, { shareId: canvas.shareId, kind: 'release' }); // CHANGE
    return result; // CHANGE
} // CHANGE

/** Seed the saved format produced before object collaboration, without running an old client. */ // CHANGE
async function oldCanvas(f, options = {}) { // CHANGE
    const shareId = options.id || 'old-garden', folderPath = path.join(f.root, 'documents', 'Trellis', 'Shared Canvases', shareId); // CHANGE
    const canvas = { shareId, diagramId: 'diagram-1', folderId: (options.version === 2 ? 'trellis-v2-' : 'trellis-') + shareId, folderPath, diagramPath: path.join(folderPath, 'Old.drawio'), filename: 'Old.drawio', label: 'Old garden', ...options.fields }; // CHANGE
    if (options.version !== undefined) canvas.protocolVersion = options.version; // CHANGE
    await fs.mkdir(folderPath, { recursive: true }); // CHANGE
    if (!options.missing) await fs.writeFile(canvas.diagramPath, xml()); // CHANGE
    const filename = path.join(f.userDataPath, 'trellis-sharing', 'canvases.json'); // CHANGE
    const saved = await fs.readFile(filename, 'utf8').then(JSON.parse).catch(error => { if (error.code === 'ENOENT') return []; throw error; }); // CHANGE
    saved.push(canvas); await fs.writeFile(filename, JSON.stringify(saved)); // CHANGE
    return canvas; // CHANGE
} // CHANGE

for (const version of [undefined, 1, 2]) test('old protocol ' + version + ' opens locally without starting sharing and survives new v3 creation', async t => { // CHANGE
    const f = await fixture(t), old = await oldCanvas(f, { version }); // CHANGE
    f.config().folders.push({ id: old.folderId, path: old.folderPath, paused: false }); // CHANGE
    await f.service.initialize(); const info = await f.service.shareInfo({ diagramPath: old.diagramPath }); // CHANGE
    assert.equal(info.managed, false); assert.equal(info.localOnly, true); assert.equal(info.state, 'localOnly'); assert.equal(info.available, true); // CHANGE
    assert.equal(f.service.hasCanvases(), false); assert.equal(f.service.hasBackgroundWork(), false); assert.equal(f.spawnCount(), 0); // CHANGE
    f.service.setContext(1, { diagramPath: old.diagramPath, diagramId: old.diagramId, userId: 'admin' }); // CHANGE
    await assert.rejects(f.service.collaborationAction(1, { shareId: old.shareId, kind: 'get' }), /Sharing is disabled/); // CHANGE
    await assert.rejects(f.service.setupCanvas(1, { diagramPath: old.diagramPath, diagramId: old.diagramId, xml: xml() }), /Sharing is disabled/); // CHANGE
    await assert.rejects(f.service.registerLibraryDownload({ shareId: old.shareId, protocolVersion: 3 }), /Sharing is disabled/); // CHANGE
    await assert.rejects(f.service.requestMembership(1, { shareId: old.shareId, operation: 'approve' }), /Sharing is disabled/); // CHANGE
    await assert.rejects(f.service.setPaused({ shareId: old.shareId, paused: false }), /Sharing is disabled/); // CHANGE
    assert.equal(f.spawnCount(), 0); // CHANGE
    const { result } = await setup(f); assert.equal(result.protocolVersion, 3); // CHANGE
    assert.equal(f.config().folders.some(folder => folder.id === old.folderId), false); // CHANGE
    await f.service.setPaused({ paused: true }); await f.service.setPaused({ paused: false }); // CHANGE
    assert.equal(f.config().folders.some(folder => folder.id === old.folderId), false); // CHANGE
    const saved = JSON.parse(await fs.readFile(path.join(f.userDataPath, 'trellis-sharing', 'canvases.json'), 'utf8')); // CHANGE
    assert.deepEqual(saved.find(canvas => canvas.shareId === old.shareId), old); assert.equal(saved.length, 2); // CHANGE
    await f.service.stop(); await f.service.start(); assert.equal(f.config().folders.some(folder => folder.id === old.folderId), false); // CHANGE
    assert.equal(await fs.readFile(old.diagramPath, 'utf8'), xml()); // CHANGE
}); // CHANGE

test('mixed invalid registrations are reported and retained without blocking a valid project', async t => { // CHANGE
    const f = await fixture(t), old = await oldCanvas(f), invalid = [null, { ...old, shareId: 'future', protocolVersion: 3 }, { ...old, diagramPath: path.join(f.root, 'outside.drawio') }]; // CHANGE
    const filename = path.join(f.userDataPath, 'trellis-sharing', 'canvases.json'); await fs.writeFile(filename, JSON.stringify([old, ...invalid])); // CHANGE
    const { result } = await setup(f); assert.equal(result.protocolVersion, 3); assert.equal(f.service.getRegistrationIssues().length, 3); // CHANGE
    const saved = JSON.parse(await fs.readFile(filename, 'utf8')); assert.deepEqual(saved.slice(0, 4), [old, ...invalid]); // CHANGE
    assert.equal((await f.service.listCanvases()).filter(canvas => canvas.localOnly).length, 1); // CHANGE
}); // CHANGE

test('structurally corrupt registry files remain errors and are never overwritten', async t => { // CHANGE
    for (const bytes of ['{broken', '{}']) { // CHANGE
        const f = await fixture(t), filename = path.join(f.userDataPath, 'trellis-sharing', 'canvases.json'); // CHANGE
        await fs.writeFile(filename, bytes); await assert.rejects(f.service.start()); // CHANGE
        assert.equal(f.spawnCount(), 0); assert.equal(await fs.readFile(filename, 'utf8'), bytes); // CHANGE
    } // CHANGE
}); // CHANGE

test('local-only assets are scoped to the watched document and directory aliases cannot escape its folder', async t => { // CHANGE
    const f = await fixture(t), old = await oldCanvas(f), assets = path.join(old.folderPath, 'assets'), relativePath = 'assets/0123456789abcdef.png'; // CHANGE
    await fs.mkdir(assets); await fs.writeFile(path.join(old.folderPath, relativePath), 'image bytes'); // CHANGE
    await f.service.initialize(); f.service.setContext(1, { diagramPath: old.diagramPath, diagramId: old.diagramId, userId: 'admin' }); // CHANGE
    const asset = await f.service.assetPath(1, { shareId: old.shareId, relativePath }); assert.equal(await fs.readFile(asset, 'utf8'), 'image bytes'); // CHANGE
    assert.equal(await f.service.isManagedAssetRequest(1, pathToFileURL(asset).href), true); assert.equal(await f.service.isManagedAssetRequest(999, pathToFileURL(asset).href), false); // CHANGE
    await assert.rejects(f.service.assetPath(1, { shareId: old.shareId, relativePath: '../api-key' }), /Invalid/); // CHANGE
    const outside = path.join(f.root, 'outside'); await fs.mkdir(outside); await fs.writeFile(path.join(outside, '0123456789abcdef.png'), 'private bytes'); // CHANGE
    await fs.rename(assets, assets + '-retained'); await fs.symlink(outside, assets, 'junction'); // CHANGE
    await assert.rejects(f.service.assetPath(1, { shareId: old.shareId, relativePath }), /outside/); assert.equal(f.spawnCount(), 0); // CHANGE
}); // CHANGE

test('missing local-only files are unavailable and their registrations remain intact', async t => { // CHANGE
    const f = await fixture(t), old = await oldCanvas(f, { missing: true, fields: { localRemoved: true } }); // CHANGE
    const [listed] = await f.service.listCanvases(); assert.equal(listed.localOnly, true); assert.equal(listed.available, false); assert.equal(listed.path, null); // CHANGE
    const info = await f.service.shareInfo({ diagramPath: old.diagramPath }); assert.equal(info.managed, false); assert.equal(info.assetBaseUrl, undefined); assert.equal(f.spawnCount(), 0); // CHANGE
}); // CHANGE

test('failed configuration cleanup stops the paused daemon while local diagrams remain openable', async t => { // CHANGE
    const f = await fixture(t), old = await oldCanvas(f); f.config().folders.push({ id: old.folderId, path: old.folderPath, paused: false }); // CHANGE
    f.setConfigurationFail(true); await assert.rejects(f.service.start(), /Configuration cleanup failed/); // CHANGE
    assert.ok(f.calls.find(call => call.args?.[0] === 'serve').args.includes('--paused')); assert.ok(f.calls.some(call => call.endpoint === 'system/shutdown')); assert.equal(f.service.memberConnections().available, false); // CHANGE
    const local = await f.service.shareInfo({ diagramPath: old.diagramPath }); assert.equal(local.localOnly, true); assert.equal(local.available, true); // CHANGE
    assert.equal(await fs.readFile(old.diagramPath, 'utf8'), xml()); // CHANGE
}); // CHANGE

test('a retained file restored on disk is local-only even when its old registration was marked removed', async t => { // CHANGE
    const f = await fixture(t); await oldCanvas(f, { fields: { localRemoved: true } }); // CHANGE
    const [local] = await f.service.listCanvases(); assert.equal(local.available, true); assert.equal(local.localOnly, true); assert.equal(f.service.hasBackgroundWork(), false); // CHANGE
}); // CHANGE

test('a new service instance reopens a valid v3 registration and replays its saved journal offline', async t => { // CHANGE
    const f = await fixture(t), { result } = await setup(f); // CHANGE
    const saved = await save(f, result, result.xml.replace('label="Board"', 'label="Saved before restart"')); // CHANGE
    await f.service.stop(); // CHANGE
    const reopened = createSyncthingService({ userDataPath: f.userDataPath, documentsPath: path.join(f.root, 'documents'), binaryRoot: path.join(f.root, 'binaries'), platform: 'win32', arch: 'x64' }); // CHANGE
    t.after(() => reopened.stop()); // CHANGE
    const [canvas] = await reopened.listCanvases(); assert.equal(canvas.protocolVersion, 3); assert.equal(canvas.available, true); // CHANGE
    reopened.setContext(1, { diagramPath: canvas.path, diagramId: 'diagram-1', userId: 'admin' }); // CHANGE
    const restored = await reopened.collaborationAction(1, { shareId: canvas.shareId, kind: 'get' }); // CHANGE
    assert.equal(restored.xml, saved.xml); assert.match(restored.xml, /Saved before restart/); // CHANGE
}); // CHANGE

test('new setup rejects explicit old versions and descriptors require v3 before launch', async t => { // CHANGE
    const f = await fixture(t), source = path.join(f.root, 'original.drawio'), content = xml(); // CHANGE
    await fs.writeFile(source, content); // CHANGE
    for (const version of [1, 2, 4]) await assert.rejects(f.service.setupCanvas(1, { diagramPath: source, diagramId: 'diagram-1', xml: content, protocolVersion: version }), /Unsupported.*protocol/); // CHANGE
    for (const version of [undefined, 1, 2, 4]) await assert.rejects(f.service.registerLibraryDownload({ shareId: 'unsupported', protocolVersion: version }), /Unsupported.*protocol/); // CHANGE
    assert.equal(f.spawnCount(), 0); assert.equal(f.service.hasCanvases(), false); assert.equal(await fs.readFile(source, 'utf8'), content); // CHANGE
}); // CHANGE

test('handoffs reject unsupported schemas or protocols without starting the recipient or approving devices', async t => { // CHANGE
    const a = await fixture(t, 'A'), b = await fixture(t, 'B'), { result } = await setup(a); // CHANGE
    const invitation = decodeBlock('INVITE', (await a.service.createInviteBlock(1, { shareId: result.shareId, inviteId: 'invite-1', code: 'ABCDE' })).block); // CHANGE
    for (const fields of [{ schema: 1 }, { schema: 3 }, { protocolVersion: undefined }, { protocolVersion: 1 }, { protocolVersion: 2 }, { protocolVersion: 4 }]) { // CHANGE
        const block = encodeBlock('INVITE', { ...invitation, ...fields }); // CHANGE
        await assert.rejects(b.service.joinCanvas({ block }), /Unsupported.*protocol/); // CHANGE
    } // CHANGE
    assert.equal(b.spawnCount(), 0); assert.equal(b.service.hasCanvases(), false); // CHANGE
    const joined = await b.service.joinCanvas({ block: encodeBlock('INVITE', invitation) }), reply = decodeBlock('REPLY', joined.reply); // CHANGE
    for (const fields of [{ schema: 1 }, { schema: 3 }, { protocolVersion: undefined }, { protocolVersion: 1 }, { protocolVersion: 2 }, { protocolVersion: 4 }]) { // CHANGE
        const request = await a.service.requestMembership(1, { shareId: result.shareId, operation: 'approve', reply: encodeBlock('REPLY', { ...reply, ...fields }) }); // CHANGE
        const item = (await a.service.listRequests(1, { shareId: result.shareId })).requests.find(item => item.id === request.requestId); // CHANGE
        assert.equal(item.status, 'rejected'); assert.match(item.reason, /Unsupported.*protocol/); // CHANGE
    } // CHANGE
    assert.equal((await a.service.listRequests(1, { shareId: result.shareId })).members.length, 1); // CHANGE
}); // CHANGE

test('v3 sharing synchronizes only assets and protocol files, and local conflict copies do not block processing', async t => { // CHANGE
    const f = await fixture(t), { result } = await setup(f); // CHANGE
    const ignore = f.calls.filter(call => call.endpoint === 'db/ignores').at(-1).data.ignore; // CHANGE
    assert.deepEqual(ignore, ['/.trellis/**/*.tmp', '!/assets', '!/assets/**', '!/.trellis', '!/.trellis/**', '**']); // CHANGE
    assert.equal(f.config().folders.find(folder => folder.id === result.folderId).fsWatcherDelayS, 0.5); // CHANGE
    const filename = path.join(result.folderPath, 'original.sync-conflict-retained.drawio'); await fs.writeFile(filename, 'retained conflict'); // CHANGE
    await f.service.poll(); assert.equal(f.service.listStatus()[0].state, 'upToDate'); assert.equal(await fs.readFile(filename, 'utf8'), 'retained conflict'); // CHANGE
    const genesis = JSON.parse(await fs.readFile(path.join(result.folderPath, '.trellis', 'collaboration-v3', 'genesis.json'), 'utf8')); assert.equal(genesis.payload.schema, 3); // CHANGE
    const membership = JSON.parse(await fs.readFile(path.join(result.folderPath, '.trellis', 'membership', '000000000001.json'), 'utf8')); assert.equal(membership.payload.schema, 1); // CHANGE
}); // CHANGE

test('member connection observations expire and are invalidated by polling failure and shutdown', async t => { // NEW
    let clock = Date.now(); const f = await fixture(t, 'A', { now: () => clock }); await setup(f); f.connections[device('B')] = { connected: true }; // NEW
    await f.service.poll(); assert.equal(f.service.memberConnections().available, true); assert.equal(f.service.memberConnections().connections[device('B')].connected, true); // NEW
    clock += 15000; assert.equal(f.service.memberConnections().available, false); await f.service.poll(); assert.equal(f.service.memberConnections().available, true); // NEW
    f.setConnectionsFail(true); await assert.rejects(f.service.poll(), /Connections unavailable/); assert.equal(f.service.memberConnections().available, false); // NEW
    f.setConnectionsFail(false); await f.service.poll(); assert.equal(f.service.memberConnections().available, true); await f.service.stop(); assert.equal(f.service.memberConnections().available, false); // NEW
}); // NEW

test('presence sampling continues while garden processing is blocked', async t => { // NEW
    t.mock.timers.enable({ apis: ['setInterval'] }); let clock = Date.now(); const f = await fixture(t, 'A', { now: () => clock }); const { result } = await setup(f); // NEW
    const read = fs.readFile; let release, entered; const gate = new Promise(resolve => { release = resolve; }), waiting = new Promise(resolve => { entered = resolve; }); let blocked = false; // NEW
    t.mock.method(fs, 'readFile', async (...args) => { if (!blocked && String(args[0]) === result.diagramPath) { blocked = true; entered(); await gate; } return read(...args); }); // NEW
    const processing = f.service.poll(); await waiting; // NEW
    try { // NEW
        clock += 5000; f.connections[device('B')] = { connected: true }; t.mock.timers.tick(5000); // NEW
        for (let i = 0; i < 10 && !f.service.memberConnections().connections[device('B')]?.connected; i++) await new Promise(resolve => setImmediate(resolve)); // NEW
        assert.equal(f.service.memberConnections().connections[device('B')].connected, true); // NEW
    } finally { release(); await processing; t.mock.restoreAll(); } // NEW
}); // NEW

test('v3 setup isolates records, keeps a backup, and permits local saving after transport stops', async t => { // CHANGE
    const f = await fixture(t), { result: shared } = await setup(f); // CHANGE
    assert.equal(shared.protocolVersion, 3); assert.match(shared.folderId, /^trellis-v3-/); // CHANGE
    const ignores = f.calls.filter(c => c.endpoint === 'db/ignores').at(-1).data.ignore; assert.equal(ignores.includes('!/' + path.basename(shared.diagramPath)), false); // NEW
    await f.service.stop(); // NEW
    const local = await f.service.collaborationAction(1, { shareId: shared.shareId, kind: 'save', baseXml: shared.xml, xml: shared.xml.replace('label="Board"', 'label="Local edit"') }); // NEW
    assert.equal(local.ok, true); assert.match(await fs.readFile(shared.diagramPath, 'utf8'), /Local edit/); // NEW
    const backup = local.collaboration.recoveries.find(copy => copy.reason.includes('Verified full backup')); assert.ok(backup); assert.equal(await fs.readFile(backup.recoveryPath, 'utf8'), shared.xml); // CHANGE: the full setup backup is accessible through the collaboration overview.
    const known = await f.service.shareInfo({ diagramPath: shared.diagramPath }); assert.equal(known.managed, true); // NEW
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
test('diagram parser supports compressed pages and rejects unsafe or duplicate page identities', () => { // CHANGE
    const current = xml({ owner: 'admin' });
    const compressed = zlib.deflateRawSync(Buffer.from(encodeURIComponent(current))).toString('base64');
    const state = inspectDiagram('<mxfile><diagram id="page">' + compressed + '</diagram></mxfile>');
    assert.equal(state.store.users[0].id, 'admin');
    assert.equal(hasCanvasAccess(state, 'alice'), true);
    assert.throws(() => inspectDiagram('<mxfile><diagram id="a">' + xml() + '</diagram><diagram id="a">' + xml() + '</diagram></mxfile>'), /unique(?: safe)? page/); // CHANGE: shared content validation also requires safe page identifiers.
    assert.throws(() => inspectDiagram('<!DOCTYPE foo [<!ENTITY x SYSTEM "file:///secret">]><mxGraphModel/>'), /Document entities are disabled/); // CHANGE: preserve rejection coverage with the shared validator's precise error.
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

test('unmanaged share lookup does not launch Syncthing or register a folder', async t => { // CHANGE
    const f = await fixture(t), result = await f.service.shareInfo({ diagramPath: path.join(f.root, 'local.drawio') }); // CHANGE
    assert.equal(result.ok, true); assert.equal(result.managed, false); assert.equal(f.spawnCount(), 0); // CHANGE
    assert.equal(f.calls.some(call => call.endpoint || call.startup), false); // CHANGE
}); // CHANGE
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
    assert.equal((await b.service.resumeJoin({ shareId: result.shareId, inviteId: 'invite-1' })).reply, joined.reply); // NEW: a restart resumes the same signed approval payload.
    await assert.rejects(b.service.resumeJoin({ shareId: result.shareId, inviteId: 'another-invite' }), /different invitation/); // NEW
    const renewed = encodeBlock('INVITE', { ...invite, code: 'RENEWED', codeHash: 'renewed-hash', expiresAt: invite.expiresAt + 86400000 }); // NEW
    assert.equal(decodeBlock('REPLY', (await b.service.resumeJoin({ shareId: result.shareId, inviteId: 'invite-1', block: renewed })).reply).codeHash, 'renewed-hash'); // NEW
    await assert.rejects(b.service.resumeJoin({ shareId: result.shareId, inviteId: 'invite-1', block: encodeBlock('INVITE', { ...invite, pendingUserId: 'other-user' }) }), /does not match/); // NEW
    const fresh = { ...invite, inviteId: 'fresh-invite', pendingUserId: 'fresh-user' }; // NEW
    await assert.rejects(b.service.resumeJoin({ shareId: result.shareId, inviteId: fresh.inviteId, block: encodeBlock('INVITE', { ...fresh, email: 'other@example.org' }) }), /does not match/); // NEW
    await assert.rejects(b.service.resumeJoin({ shareId: result.shareId, inviteId: fresh.inviteId, block: encodeBlock('INVITE', { ...fresh, genesisCoordinatorPublicKey: 'foreign-key' }) }), /does not match/); // NEW
    const replacement = decodeBlock('REPLY', (await b.service.resumeJoin({ shareId: result.shareId, inviteId: fresh.inviteId, block: encodeBlock('INVITE', fresh) })).reply); assert.equal(replacement.userId, fresh.pendingUserId); assert.equal((await b.service.listCanvases())[0].joinInviteId, fresh.inviteId); // NEW
    await assert.rejects(b.service.resumeJoin({ shareId: result.shareId, inviteId: 'invite-1' }), /different invitation/); // NEW
    assert.equal((await b.service.listCanvases()).length, 1); // NEW
    await assert.rejects(b.service.joinCanvas({ block: block.block }), /already joined/);
    await assert.rejects(b.service.joinCanvas({ block: encodeBlock('INVITE', { ...invite, shareId: 'expired', expiresAt: 0 }) }), /expired/);
});
test('interrupted join configuration retains a reloadable pending registration without adopting unrelated folders', async t => { // NEW
    const a = await fixture(t, 'A'), b = await fixture(t, 'B'), { result } = await setup(a); // NEW
    const invitation = await a.service.createInviteBlock(1, { shareId: result.shareId, inviteId: 'invite-1', code: 'ABCDE' }); // NEW
    await b.service.start(); b.setConfigurationFail(true); await assert.rejects(b.service.joinCanvas({ block: invitation.block }), /Configuration cleanup failed/); // NEW
    const restored = createSyncthingService({ userDataPath: b.userDataPath, documentsPath: path.join(b.root, 'documents') }); // NEW
    const [pending] = await restored.listCanvases(); assert.equal(pending.shareId, result.shareId); assert.equal(pending.pending, true); assert.deepEqual(restored.getRegistrationIssues(), []); // NEW
    b.setConfigurationFail(false); assert.ok((await b.service.resumeJoin({ shareId: result.shareId, inviteId: 'invite-1' })).reply); assert.equal((await b.service.listCanvases()).length, 1); // NEW
    const unrelated = decodeBlock('INVITE', invitation.block); unrelated.shareId = 'unrelated'; unrelated.folderId = 'trellis-v3-unrelated'; // NEW
    const folder = path.join(b.root, 'documents/Trellis/Shared Canvases/unrelated'); await fs.mkdir(folder, { recursive: true }); await fs.writeFile(path.join(folder, 'keep.txt'), 'retain'); // NEW
    await assert.rejects(b.service.joinCanvas({ block: encodeBlock('INVITE', unrelated) }), /destination folder already exists/); assert.equal(await fs.readFile(path.join(folder, 'keep.txt'), 'utf8'), 'retain'); // NEW
}); // NEW
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
test('read-only visitor invitations qualify for native device approval without editing capabilities', async t => { // NEW
    const a = await fixture(t, 'A'), b = await fixture(t, 'B'); // NEW
    const content = xml({ grants: [] }).replace('trellis_access_user_ids_json="[]"', 'trellis_access_grants_json="' + escape(JSON.stringify([{ userId: 'invite-user', preset: 'visitor', capabilities: [] }])) + '"'); // NEW
    const state = inspectDiagram(content); assert.equal(hasCanvasAccess(state, 'invite-user'), true); assert.equal(hasCanvasAccess(inspectDiagram(content.replace('&quot;visitor&quot;', '&quot;none&quot;')), 'invite-user'), false); // NEW
    const { result } = await setup(a, content), invitation = await a.service.createInviteBlock(1, { shareId: result.shareId, inviteId: 'invite-1', code: 'ABCDE' }), joined = await b.service.joinCanvas({ block: invitation.block }); // NEW
    const request = await a.service.requestMembership(1, { shareId: result.shareId, operation: 'approve', reply: joined.reply }); // NEW
    const ack = JSON.parse(await fs.readFile(path.join(result.diagramPath, '..', '.trellis/acknowledgements', request.requestId + '.json'), 'utf8')); assert.equal(ack.payload.status, 'applied', ack.payload.reason); // NEW
}); // NEW
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
    const scoped = value => value.replace('id="board"', 'id="board" board_key="KANBAN_BOARD"'); // NEW: exercise access on an actual grant-bearing task board.
    const { result } = await setup(a, scoped(xml())); // CHANGE
    const block = await a.service.createInviteBlock(1, { shareId: result.shareId, inviteId: 'invite-1', code: 'ABCDE' });
    const joined = await b.service.joinCanvas({ block: block.block });
    await a.service.requestMembership(1, { shareId: result.shareId, operation: 'approve', reply: joined.reply });
    const state = inspectDiagram(result.xml);
    state.store.pendingUsers = [];
    state.store.invites[0].status = 'accepted';
    state.store.users.push({ id: 'invite-user', name: 'Invited', disabled: false });
    const content = scoped(xml({ store: state.store, grants: [], open: true })); // CHANGE
    await save(a, result, content); // CHANGE
    await a.service.poll();
    assert.equal((await a.service.listRequests(1, { shareId: result.shareId })).members.length, 2);
    state.store.users.find(user => user.id === 'invite-user').disabled = true;
    await save(a, result, scoped(xml({ store: state.store, grants: [], open: true }))); // CHANGE
    await a.service.poll();
    assert.equal((await a.service.listRequests(1, { shareId: result.shareId })).members.length, 1);
});
test('history export requires the saved file hash and validates immutable imports', async t => {
    const f = await fixture(t);
    const { result } = await setup(f);
    const reset = await f.service.importHistory(1, { shareId: result.shareId }); // NEW
    const revision = await f.histories.run('record', { diagramId: 'diagram-1', xml: result.xml, forceFull: true, metadata: { id: 'revision-1', actorUserId: 'alice', timestamp: Date.now() + 1000 } }); // NEW
    const entry = { revision, snapshot: { snapshotId: revision.id } }; // CHANGE
    await assert.rejects(f.service.exportHistory(1, { shareId: result.shareId, savedHash: 'bad', entries: [entry] }), /saved canvas/);
    await assert.rejects(f.service.exportHistory(1, { shareId: result.shareId, savedHash: digest(result.xml), entries: [{ ...entry, revision: { ...entry.revision, timestamp: undefined } }] }), /Invalid shared/); // NEW
    await f.service.exportHistory(1, { shareId: result.shareId, savedHash: digest(result.xml), entries: [entry] });
    await f.service.exportHistory(1, { shareId: result.shareId, savedHash: digest(result.xml), entries: [entry] });
    const imported = await f.service.importHistory(1, { shareId: result.shareId });
    assert.equal(imported.entries[0].revision.actorUserId, 'alice');
    assert.equal((await f.service.importHistory(1, { shareId: result.shareId, knownIds: ['revision-1'] })).entries.length, 0);
    const filename = path.join(result.folderPath, '.trellis', 'history-v2', reset.generation, 'records', 'revision-1.json');
    const record = JSON.parse(await fs.readFile(filename, 'utf8'));
    record.payload.entry.revision.actorUserId = 'forged'; // CHANGE
    await fs.writeFile(filename, JSON.stringify(record));
    assert.equal((await f.service.importHistory(1, { shareId: result.shareId })).errors.length, 1);
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
    await save(a, result, xml({ store })); // CHANGE
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

test('manual recovery copies stay private and indexed without blocking membership', async t => { // CHANGE
    const a = await fixture(t, 'A'), b = await fixture(t, 'B'), { result } = await setup(a); // CHANGE
    const block = await a.service.createInviteBlock(1, { shareId: result.shareId, inviteId: 'invite-1', code: 'ABCDE' }); // CHANGE
    const joined = await b.service.joinCanvas({ block: block.block }); // CHANGE
    const copy = await a.service.saveRecoveryCopy(1, { shareId: result.shareId, xml: xml({ label: 'Local recovery' }) }); // CHANGE
    assert.equal(copy.recoveryPath.startsWith(result.folderPath), false); // CHANGE
    assert.match(await fs.readFile(copy.recoveryPath, 'utf8'), /Local recovery/); // CHANGE
    const state = await a.service.collaborationAction(1, { shareId: result.shareId, kind: 'get' }); // CHANGE
    assert.ok(state.collaboration.recoveries.some(item => item.recoveryPath === copy.recoveryPath)); // CHANGE
    const request = await a.service.requestMembership(1, { shareId: result.shareId, operation: 'approve', reply: joined.reply }); // CHANGE
    assert.equal((await a.service.listRequests(1, { shareId: result.shareId })).requests.find(item => item.id === request.requestId).status, 'applied'); // CHANGE
}); // CHANGE

test('managed rename retains sharing identity while excluding the local projection', async t => { // CHANGE
    const f = await fixture(t);
    const { result } = await setup(f);
    const renamed = path.join(result.folderPath, 'Renamed.drawio');
    await fs.rename(result.diagramPath, renamed);
    const info = await f.service.shareInfo({ diagramPath: renamed });
    assert.equal(info.shareId, result.shareId);
    assert.equal(info.diagramPath, renamed);
    assert.ok(f.calls.filter(call => call.endpoint === 'db/ignores').every(call => !call.data.ignore.includes('!/Renamed.drawio'))); // CHANGE
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

/** A two-device shared folder exercises real signatures, membership replay, and both projections. */ // NEW
async function departurePair(t) { // CHANGE
    const a = await fixture(t, 'A'), b = await fixture(t, 'B'); // NEW
    const store = { usersEnabled: true, users: [{ id: 'admin', name: 'Owner', email: 'owner@example.org', admin: true, portableIdentityId: 'owner-identity' }, { id: 'invite-user', name: 'Guest', email: 'guest@example.org', admin: false, portableIdentityId: 'guest-identity' }], pendingUsers: [], invites: [] }; // NEW
    let { result } = await setup(a, xml({ store })); // NEW
    const invitation = await a.service.createDeviceInvite(1, { shareId: result.shareId, userId: 'invite-user' }); // NEW
    const joined = await b.service.joinCanvas({ block: invitation.block }); // NEW
    await a.service.requestMembership(1, { shareId: result.shareId, operation: 'approve', reply: joined.reply }); // NEW
    a.connections[device('B')] = { connected: true }; b.connections[device('A')] = { connected: true }; // NEW
    const folders = [result.folderPath, path.dirname(joined.diagramPath)]; // NEW
    async function copy(from, to) { await fs.cp(path.join(folders[from], '.trellis'), path.join(folders[to], '.trellis'), { recursive: true }); } // NEW
    async function pump() { // NEW
        await a.service.poll(); await copy(0, 1); // NEW
        await b.service.poll(); await copy(1, 0); await a.service.poll(); // NEW
    } // NEW
    await pump(); await pump(); // NEW
    return { a, b, result, joined, invitation, folders, pump, copy }; // NEW
} // NEW

test('v3 coordinator departure promotes a connected successor and preserves the project and genesis', async t => { // CHANGE
    const f = await departurePair(t), input = { shareId: f.result.shareId, userId: 'admin', identityId: 'owner-identity', successorUserId: 'invite-user' }; // CHANGE
    const eligibility = await f.a.service.projectActions(input); assert.equal(eligibility.requiresSuccessor, true); assert.equal(eligibility.canLeave, true); assert.deepEqual(eligibility.successors.map(u => u.id), ['invite-user']); // NEW
    assert.equal((await f.a.service.leaveProject(input)).complete, false); // NEW
    for (let step = 0; step < 5; step++) await f.pump(); // NEW
    const finished = await f.a.service.leaveProject(input); assert.equal(finished.complete, true, JSON.stringify(f.a.service.listStatus())); // NEW
    const info = await f.b.service.shareInfo({ diagramPath: f.joined.diagramPath }); assert.equal(info.coordinatorDeviceId, device('B')); // NEW
    const state = inspectDiagram(await fs.readFile(f.joined.diagramPath, 'utf8')); assert.equal(state.store.users.find(u => u.id === 'admin').disabled, true); assert.equal(state.store.users.find(u => u.id === 'invite-user').admin, true); // NEW
    await f.a.service.applyProjectLifecycle({ ...input, operation: 'left', recordId: crypto.randomUUID() }); // NEW
    await assert.rejects(fs.access(f.result.diagramPath)); assert.ok(await fs.readFile(f.joined.diagramPath, 'utf8')); // NEW
    assert.equal((await f.b.service.libraryDescriptor(f.result.shareId)).coordinatorDeviceId, device('B')); // NEW
    await assert.rejects(f.a.service.joinCanvas({ block: f.invitation.block }), /predates departure/); // NEW
}); // NEW

test('v3 ordinary member departure waits for an applied acknowledgement and retains the administrator', async t => { // CHANGE
    const f = await departurePair(t), input = { shareId: f.result.shareId, userId: 'invite-user', identityId: 'guest-identity' }; // CHANGE
    assert.equal((await f.b.service.projectActions(input)).canLeave, true); // NEW
    assert.equal((await f.b.service.leaveProject(input)).complete, false); // NEW
    for (let step = 0; step < 6; step++) await f.pump(); // NEW
    assert.equal((await f.b.service.leaveProject(input)).complete, true, JSON.stringify(f.b.service.listStatus())); // NEW
    const state = inspectDiagram(await fs.readFile(f.result.diagramPath, 'utf8')); assert.equal(state.store.users.find(u => u.id === 'admin').disabled, undefined); assert.equal(state.store.users.find(u => u.id === 'invite-user').disabled, true); // NEW
    assert.equal((await f.a.service.shareInfo({ diagramPath: f.result.diagramPath })).coordinatorDeviceId, device('A')); // NEW
}); // NEW

test('departure blocks offline successors and pending requests retain their files through a disconnection', async t => { // NEW
    const f = await departurePair(t), input = { shareId: f.result.shareId, userId: 'admin', identityId: 'owner-identity', successorUserId: 'invite-user' }; // NEW
    f.a.connections[device('B')].connected = false; // NEW
    assert.equal((await f.a.service.projectActions(input)).successors.length, 0); await assert.rejects(f.a.service.leaveProject(input), /connected/); // NEW
    f.a.connections[device('B')].connected = true; await f.a.service.leaveProject(input); f.a.connections[device('B')].connected = false; // NEW
    await f.pump(); assert.equal((await f.a.service.leaveProject(input)).complete, false); assert.ok(await fs.readFile(f.result.diagramPath, 'utf8')); // NEW
    f.a.connections[device('B')].connected = true; for (let step = 0; step < 5; step++) await f.pump(); assert.equal((await f.a.service.leaveProject(input)).complete, true); // NEW
}); // NEW

test('a forged handover manifest cannot replace the previously trusted coordinator', async t => { // NEW
    const f = await departurePair(t), signer = crypto.generateKeyPairSync('ed25519'); // NEW
    const descriptor = await f.a.service.libraryDescriptor(f.result.shareId); // NEW
    const forged = signRecord({ schema: 1, shareId: f.result.shareId, diagramId: 'diagram-1', version: 3, coordinatorDeviceId: device('A'), members: descriptor.members, nextCoordinator: { deviceId: device('B'), publicKey: descriptor.members.find(m => m.deviceId === device('B')).publicKey } }, signer.privateKey); // NEW
    await fs.writeFile(path.join(f.folders[1], '.trellis', 'membership', '000000000003.json'), JSON.stringify(forged)); await f.b.service.poll(); // NEW
    assert.match(f.b.service.listStatus()[0].reason, /signature/); assert.equal((await f.b.service.shareInfo({ diagramPath: f.joined.diagramPath })).coordinatorDeviceId, device('A')); // NEW
}); // NEW

test('v3 a fresh invitation reapproves a departed device without reviving its old setup', async t => { // CHANGE
    const f = await departurePair(t), input = { shareId: f.result.shareId, userId: 'admin', identityId: 'owner-identity', successorUserId: 'invite-user' }; // CHANGE
    await f.a.service.leaveProject(input); for (let step = 0; step < 5; step++) await f.pump(); assert.equal((await f.a.service.leaveProject(input)).complete, true); // NEW
    await f.a.service.applyProjectLifecycle({ ...input, operation: 'left', recordId: crypto.randomUUID() }); // NEW
    await assert.rejects(f.a.service.joinCanvas({ block: f.invitation.block }), /predates departure/); // NEW
    f.b.service.setContext(1, { diagramPath: f.joined.diagramPath, diagramId: 'diagram-1', userId: 'invite-user' }); // NEW
    const baseXml = await fs.readFile(f.joined.diagramPath, 'utf8'), state = inspectDiagram(baseXml), original = state.store.users.find(u => u.id === 'admin'); original.disabled = false; original.admin = false; // NEW
    for (const cell of state.cells) if (cell.node.hasAttribute('trellis_users_json')) cell.node.setAttribute('trellis_users_json', JSON.stringify(state.store)); // NEW
    assert.equal((await f.b.service.collaborationAction(1, { shareId: f.result.shareId, kind: 'save', baseXml, xml: state.document.serialize() })).ok, true); // CHANGE
    const invitation = await f.b.service.createDeviceInvite(1, { shareId: f.result.shareId, userId: 'admin' }), rejoined = await f.a.service.joinCanvas({ block: invitation.block }); // NEW
    await f.b.service.requestMembership(1, { shareId: f.result.shareId, operation: 'approve', reply: rejoined.reply }); // NEW
    await fs.cp(path.join(f.folders[1], '.trellis'), path.join(path.dirname(rejoined.diagramPath), '.trellis'), { recursive: true }); // NEW
    await f.a.service.poll(); // CHANGE: materialize the newly approved journal before inspecting its registration.
    const local = (await f.a.service.listCanvases()).find(canvas => canvas.shareId === f.result.shareId); assert.equal(local.pending, false); assert.equal(local.revoked, false); assert.equal(local.rejoined, true); assert.equal(local.available, true, JSON.stringify(f.a.service.listStatus())); // CHANGE
}); // NEW

test('an interrupted roster commit resumes after restartable storage failure without losing the successor', async t => { // NEW
    const f = await departurePair(t), input = { shareId: f.result.shareId, userId: 'admin', identityId: 'owner-identity', successorUserId: 'invite-user' }; // NEW
    await f.a.service.leaveProject(input); const write = fs.writeFile; // NEW
    const failure = t.mock.method(fs, 'writeFile', async (filename, ...args) => { if (String(filename) === path.join(f.folders[0], '.trellis', 'membership', '000000000003.json')) throw Object.assign(new Error('Injected disk full'), { code: 'ENOSPC' }); return write(filename, ...args); }); // NEW
    await f.pump(); assert.equal((await f.a.service.leaveProject(input)).complete, false); assert.ok(await fs.readFile(f.result.diagramPath, 'utf8')); // NEW
    failure.mock.restore(); for (let step = 0; step < 6; step++) await f.pump(); assert.equal((await f.a.service.leaveProject(input)).complete, true, JSON.stringify(f.a.service.listStatus())); // NEW
}); // NEW
