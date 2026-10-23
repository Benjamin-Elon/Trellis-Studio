// NEW: Opt-in smoke test using the actual pinned binary, isolated from the user's profile.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { XMLSerializer } from '@xmldom/xmldom'; // CHANGE
import { spawn } from 'node:child_process'; // CHANGE
import { createSyncthingService } from '../src/main/trellis-syncthing-service.js';
import { inspectDiagram, parseXml } from '../src/main/trellis-share-protocol.js'; // CHANGE

async function eventually(check, timeout = 60000) {
    const deadline = Date.now() + timeout;
    let lastError;
    while (Date.now() < deadline) {
        try { if (await check()) return; } catch (err) { lastError = err; }
        await new Promise(resolve => setTimeout(resolve, 500));
    }
    throw lastError || new Error('Real Syncthing transfer did not converge before the timeout.');
}

test('bundled Syncthing generates a private identity, starts its API, registers a folder, and stops', { skip: process.env.TRELLIS_SYNCTHING_RUNTIME_TEST !== '1', timeout: 45000 }, async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'trellis-syncthing-runtime-'));
    const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const service = createSyncthingService({ userDataPath: path.join(root, 'profile'), documentsPath: path.join(root, 'documents'), binaryRoot: path.join(project, 'vendor', 'syncthing'), setStartup: async () => {} });
    t.after(async () => { await service.stop(); await fs.rm(root, { recursive: true, force: true }); });
    const started = await service.start();
    assert.match(started.deviceId, /^[A-Z2-7-]{63}$/);
    const xml = '<mxGraphModel><root><mxCell id="0"/><object id="1" trellis_history_id="runtime-diagram" trellis_users_json="{&quot;usersEnabled&quot;:true,&quot;users&quot;:[{&quot;id&quot;:&quot;admin&quot;,&quot;name&quot;:&quot;Admin&quot;,&quot;admin&quot;:true}]}"><mxCell parent="0"/></object></root></mxGraphModel>';
    const source = path.join(root, 'Runtime.drawio');
    await fs.writeFile(source, xml);
    service.setContext(1, { diagramPath: source, diagramId: 'runtime-diagram', userId: 'admin' });
    const canvas = await service.setupCanvas(1, { diagramPath: source, diagramId: 'runtime-diagram', xml });
    assert.equal(canvas.managed, true);
    await service.poll();
    assert.notEqual(service.listStatus()[0].state, 'unavailable');
    await service.stop();
    assert.equal(service.listStatus()[0].state, 'unavailable');
});

test('mixed profiles disable preconfigured legacy folders and retain local files across native restart and resume', { skip: process.env.TRELLIS_SYNCTHING_RUNTIME_TEST !== '1', timeout: 90000 }, async t => { // CHANGE
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'trellis-local-only-runtime-')), project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'); // CHANGE
    const profile = path.join(root, 'profile'), directory = path.join(profile, 'trellis-sharing'), documents = path.join(root, 'documents'), launches = [], services = []; // CHANGE
    const options = { userDataPath: profile, documentsPath: documents, binaryRoot: path.join(project, 'vendor', 'syncthing'), setStartup: async () => {}, spawn(binary, args, settings) { launches.push(args); return spawn(binary, args, settings); } }; // CHANGE
    t.after(async () => { for (const service of services) await service.stop(); await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); }); // CHANGE
    const first = createSyncthingService(options); services.push(first); // CHANGE
    const xml = '<mxGraphModel><root><mxCell id="0"/><object id="1" trellis_history_id="mixed-diagram" trellis_users_json="{&quot;usersEnabled&quot;:true,&quot;users&quot;:[{&quot;id&quot;:&quot;admin&quot;,&quot;admin&quot;:true}]}"><mxCell parent="0"/></object></root></mxGraphModel>'; // CHANGE
    first.setContext(1, { diagramId: 'mixed-diagram', userId: 'admin' }); const current = await first.setupCanvas(1, { diagramId: 'mixed-diagram', xml }); await first.stop(); // CHANGE
    const folderPath = path.join(documents, 'Trellis', 'Shared Canvases', 'old-garden'), old = { shareId: 'old-garden', diagramId: 'mixed-diagram', protocolVersion: 1, folderId: 'trellis-old-garden', folderPath, filename: 'Old.drawio', diagramPath: path.join(folderPath, 'Old.drawio'), label: 'Retained old garden' }; // CHANGE
    await fs.mkdir(folderPath, { recursive: true }); await fs.writeFile(old.diagramPath, xml); // CHANGE
    const registryFile = path.join(directory, 'canvases.json'), saved = JSON.parse(await fs.readFile(registryFile, 'utf8')); saved.push(old); await fs.writeFile(registryFile, JSON.stringify(saved)); // CHANGE
    const configFile = path.join(directory, 'syncthing', 'config.xml'), config = parseXml(await fs.readFile(configFile, 'utf8')); // CHANGE
    const oldFolder = Array.from(config.getElementsByTagName('folder')).find(node => node.getAttribute('id') === current.folderId).cloneNode(true); // CHANGE
    oldFolder.setAttribute('id', old.folderId); oldFolder.setAttribute('path', old.folderPath); oldFolder.setAttribute('paused', 'false'); config.documentElement.appendChild(oldFolder); // CHANGE
    await fs.writeFile(configFile, new XMLSerializer().serializeToString(config)); // CHANGE
    const reopened = createSyncthingService(options); services.push(reopened); // CHANGE
    assert.equal((await reopened.shareInfo({ diagramPath: old.diagramPath })).localOnly, true); assert.equal(launches.filter(args => args[0] === 'serve').length, 1); // CHANGE
    const noOldFolder = async () => { const document = parseXml(await fs.readFile(configFile, 'utf8')); const ids = Array.from(document.getElementsByTagName('folder')).map(node => node.getAttribute('id')); return !ids.includes(old.folderId) && ids.includes(current.folderId); }; // CHANGE
    await reopened.start(); await eventually(noOldFolder, 30000); // CHANGE
    await reopened.setPaused({ paused: true }); await reopened.setPaused({ paused: false }); await eventually(noOldFolder, 30000); // CHANGE
    await reopened.stop(); await reopened.start(); await eventually(noOldFolder, 30000); // CHANGE
    assert.ok(launches.filter(args => args[0] === 'serve').every(args => args.includes('--paused'))); // CHANGE
    assert.equal(await fs.readFile(old.diagramPath, 'utf8'), xml); assert.deepEqual(JSON.parse(await fs.readFile(registryFile, 'utf8')).find(canvas => canvas.shareId === old.shareId), old); // CHANGE
}); // CHANGE

test('v2 peers exchange object records and preserve independent autosaves with the coordinator offline', { skip: process.env.TRELLIS_SYNCTHING_RUNTIME_TEST !== '1', timeout: 180000 }, async t => { // NEW
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'trellis-collaboration-mesh-')); // NEW
    const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), addresses = new Map(); // NEW
    const services = ['coordinator', 'alice', 'bob'].map(name => createSyncthingService({ userDataPath: path.join(root, name, 'profile'), documentsPath: path.join(root, name, 'documents'), binaryRoot: path.join(project, 'vendor', 'syncthing'), setStartup: async () => {}, onListening: ({ deviceId, port }) => addresses.set(deviceId, ['tcp://127.0.0.1:' + port]), deviceAddresses: id => addresses.get(id) || ['dynamic'] })); // NEW
    t.after(async () => { for (const service of services) await service.stop(); await fs.rm(root, { recursive: true, force: true }); }); // NEW
    const [a, b, c] = services; for (const service of services) await service.start(); // NEW
    const users = ['admin', 'alice', 'bob'].map(id => ({ id, name: id, email: id + '@example.org', admin: true })); // NEW
    const xml = '<mxGraphModel><root><mxCell id="0"/><object id="1" trellis_history_id="mesh-v2" trellis_users_json="' + JSON.stringify({ usersEnabled: true, users, invites: [] }).replace(/"/g, '&quot;') + '"><mxCell parent="0"/></object><object id="bed-a" label="Bed A" trellis_owner_user_id="alice"><mxCell vertex="1" parent="1"/></object><object id="bed-b" label="Bed B" trellis_owner_user_id="bob"><mxCell vertex="1" parent="1"/></object></root></mxGraphModel>'; // NEW
    const source = path.join(root, 'Community.drawio'); await fs.writeFile(source, xml); a.setContext(1, { diagramPath: source, diagramId: 'mesh-v2', userId: 'admin' }); // NEW
    const shared = await a.setupCanvas(1, { diagramPath: source, diagramId: 'mesh-v2', xml, protocolVersion: 2 }); // NEW
    const invitedB = await a.createDeviceInvite(1, { shareId: shared.shareId, userId: 'alice' }), joinedB = await b.joinCanvas({ block: invitedB.block }); // NEW
    const invitedC = await a.createDeviceInvite(1, { shareId: shared.shareId, userId: 'bob' }), joinedC = await c.joinCanvas({ block: invitedC.block }); // NEW
    await a.requestMembership(1, { shareId: shared.shareId, operation: 'approve', reply: joinedB.reply }); await a.requestMembership(1, { shareId: shared.shareId, operation: 'approve', reply: joinedC.reply }); // NEW
    await eventually(async () => { for (const service of services) await service.poll(); return (await fs.readFile(joinedB.diagramPath, 'utf8')) === shared.xml && (await fs.readFile(joinedC.diagramPath, 'utf8')) === shared.xml; }); // NEW
    b.setContext(2, { diagramPath: joinedB.diagramPath, diagramId: 'mesh-v2', userId: 'alice' }); c.setContext(3, { diagramPath: joinedC.diagramPath, diagramId: 'mesh-v2', userId: 'bob' }); // NEW
    await a.stop(); // NEW
    assert.equal((await b.collaborationAction(2, { shareId: shared.shareId, kind: 'save', baseXml: shared.xml, xml: shared.xml.replace('Bed A', 'Alice changed A') })).ok, true); // NEW
    assert.equal((await c.collaborationAction(3, { shareId: shared.shareId, kind: 'save', baseXml: shared.xml, xml: shared.xml.replace('Bed B', 'Bob changed B') })).ok, true); // NEW
    await eventually(async () => { await b.poll(); await c.poll(); const bx = await fs.readFile(joinedB.diagramPath, 'utf8'), cx = await fs.readFile(joinedC.diagramPath, 'utf8'); return bx === cx && bx.includes('Alice changed A') && bx.includes('Bob changed B'); }); // NEW
    assert.equal(a.listStatus()[0].state, 'unavailable'); // NEW
    const records = await fs.readdir(path.join(joinedB.diagramPath, '..', '.trellis', 'collaboration-v2', 'records')); assert.ok(records.length >= 4); // NEW
}); // NEW

/** Native transport must deliver departure receipts before severing the departing peer. */ // NEW
test('project lifecycle v2 hands coordination to a real connected peer and admits a later device', { skip: process.env.TRELLIS_SYNCTHING_RUNTIME_TEST !== '1', timeout: 180000 }, async t => { // CHANGE
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'trellis-project-lifecycle-runtime-')), project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), addresses = new Map(); // NEW
    const services = ['owner', 'successor', 'later'].map(name => createSyncthingService({ userDataPath: path.join(root, name, 'profile'), documentsPath: path.join(root, name, 'documents'), binaryRoot: path.join(project, 'vendor/syncthing'), setStartup: async () => {}, onListening: ({ deviceId, port }) => addresses.set(deviceId, ['tcp://127.0.0.1:' + port]), deviceAddresses: id => addresses.get(id) || ['dynamic'] })); // NEW
    t.after(async () => { for (const service of services) await service.stop(); await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); }); // NEW
    const [a, b, c] = services; await a.start(); await b.start(); await c.start(); // NEW
    const users = [{ id: 'owner', name: 'Owner', email: 'owner@example.test', admin: true, portableIdentityId: 'owner-identity' }, { id: 'successor', name: 'Successor', email: 'successor@example.test', admin: false, portableIdentityId: 'successor-identity' }]; // NEW
    const xml = '<mxGraphModel><root><mxCell id="0"/><object id="1" trellis_history_id="lifecycle-runtime" trellis_users_json="' + JSON.stringify({ usersEnabled: true, users, invites: [] }).replace(/"/g, '&quot;') + '"><mxCell parent="0"/></object><object id="bed" label="Retained bed" trellis_access_user_ids_json="[&quot;successor&quot;]" trellis_owner_user_id="owner"><mxCell vertex="1" parent="1"/></object></root></mxGraphModel>'; // NEW
    a.setContext(1, { diagramId: 'lifecycle-runtime', userId: 'owner' }); const created = await a.setupCanvas(1, { diagramId: 'lifecycle-runtime', xml, protocolVersion: 2 }); // CHANGE
    const invite = await a.createDeviceInvite(1, { shareId: created.shareId, userId: 'successor' }), joined = await b.joinCanvas({ block: invite.block }); // NEW
    await a.requestMembership(1, { shareId: created.shareId, operation: 'approve', reply: joined.reply }); // NEW
    const leaving = { shareId: created.shareId, userId: 'owner', identityId: 'owner-identity', successorUserId: 'successor' }; // NEW
    await eventually(async () => { await a.poll(); await b.poll(); const eligibility = await a.projectActions(leaving); if (!eligibility.canLeave) throw new Error('Departure eligibility: ' + JSON.stringify({ eligibility, owner: a.listStatus(), successor: b.listStatus() })); return true; }); // CHANGE // NEW
    await a.leaveProject(leaving); let receipt; // NEW
    await eventually(async () => { await a.poll(); await b.poll(); receipt = await a.leaveProject(leaving); return receipt.complete; }, 90000); // NEW
    assert.equal(receipt.receipt.payload.type, 'departure-finalized'); const successor = await b.shareInfo({ diagramPath: joined.diagramPath }); // NEW
    assert.notEqual(successor.coordinatorDeviceId, created.coordinatorDeviceId); // NEW
    await a.applyProjectLifecycle({ ...leaving, operation: 'left', recordId: 'native-retirement' }); await assert.rejects(fs.access(created.diagramPath)); // NEW
    const snapshot = inspectDiagram(await fs.readFile(joined.diagramPath, 'utf8')); assert.equal(snapshot.store.users.find(u => u.id === 'owner').disabled, true); assert.equal(snapshot.store.users.find(u => u.id === 'successor').admin, true); // NEW
    b.setContext(1, { diagramPath: joined.diagramPath, diagramId: 'lifecycle-runtime', userId: 'successor' }); // NEW
    const laterInvite = await b.createDeviceInvite(1, { shareId: created.shareId, userId: 'successor' }), later = await c.joinCanvas({ block: laterInvite.block }); // NEW
    await b.requestMembership(1, { shareId: created.shareId, operation: 'approve', reply: later.reply }); // NEW
    await eventually(async () => { await b.poll(); await c.poll(); return (await c.listCanvases())[0].available && !c.listStatus()[0].pending; }); // NEW
    assert.equal(inspectDiagram(await fs.readFile(later.diagramPath, 'utf8')).store.users.find(u => u.id === 'successor').admin, true); // NEW
    t.diagnostic('Native lifecycle v2: signed handover, delivered final receipt, departing files retired, later device verified original genesis.'); // CHANGE
}); // NEW
