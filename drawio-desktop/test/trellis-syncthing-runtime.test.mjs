// NEW: Opt-in smoke test using the actual pinned binary, isolated from the user's profile.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createSyncthingService } from '../src/main/trellis-syncthing-service.js';
import { decodeBlock, inspectDiagram } from '../src/main/trellis-share-protocol.js';

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

test('three real devices transfer canvas data through a mesh while the coordinator is stopped', { skip: process.env.TRELLIS_SYNCTHING_RUNTIME_TEST !== '1', timeout: 180000 }, async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'trellis-syncthing-mesh-'));
    const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const addresses = new Map();
    const services = ['a', 'b', 'c'].map(name => createSyncthingService({ userDataPath: path.join(root, name, 'profile'), documentsPath: path.join(root, name, 'documents'), binaryRoot: path.join(project, 'vendor', 'syncthing'), setStartup: async () => {}, onListening: ({ deviceId, port }) => addresses.set(deviceId, ['tcp://127.0.0.1:' + port]), deviceAddresses: deviceId => addresses.get(deviceId) || ['dynamic'] }));
    t.after(async () => { for (const service of services) await service.stop(); await fs.rm(root, { recursive: true, force: true }); });
    const [a, b, c] = services;
    for (const service of services) await service.start();
    const store = { usersEnabled: true, users: [{ id: 'admin', name: 'Admin', admin: true }], pendingUsers: [{ id: 'recipient', email: 'recipient@example.org' }], invites: [{ id: 'invite', email: 'recipient@example.org', pendingUserId: 'recipient', createdBy: 'admin', status: 'pending', expiresAt: Date.now() + 86400000 }] };
    const escapedStore = JSON.stringify(store).replace(/"/g, '&quot;');
    const xml = '<mxGraphModel><root><mxCell id="0"/><object id="1" trellis_history_id="mesh-diagram" trellis_users_json="' + escapedStore + '"><mxCell parent="0"/></object><object id="board" label="Original" trellis_owner_user_id="admin" trellis_access_user_ids_json="[&quot;recipient&quot;]"><mxCell parent="1" vertex="1"/></object></root></mxGraphModel>';
    const source = path.join(root, 'Mesh.drawio');
    await fs.writeFile(source, xml);
    a.setContext(1, { diagramPath: source, diagramId: 'mesh-diagram', userId: 'admin' });
    const shared = await a.setupCanvas(1, { diagramPath: source, diagramId: 'mesh-diagram', xml });
    const invite = await a.createInviteBlock(1, { shareId: shared.shareId, inviteId: 'invite', code: 'ABCD' });
    const joinedB = await b.joinCanvas({ block: invite.block });
    const joinedC = await c.joinCanvas({ block: invite.block });
    await a.requestMembership(1, { shareId: shared.shareId, operation: 'approve', reply: joinedB.reply });
    await a.requestMembership(1, { shareId: shared.shareId, operation: 'approve', reply: joinedC.reply });
    await eventually(async () => {
        for (const service of services) await service.poll();
        return (await fs.readFile(joinedB.diagramPath, 'utf8')) === shared.xml && (await fs.readFile(joinedC.diagramPath, 'utf8')) === shared.xml && !b.listStatus()[0].pending && !c.listStatus()[0].pending;
    });
    await a.stop();
    const changed = shared.xml.replace('Original', 'Changed offline coordinator');
    await fs.writeFile(joinedB.diagramPath, changed);
    await eventually(async () => (await fs.readFile(joinedC.diagramPath, 'utf8')) === changed);
    assert.equal(inspectDiagram(await fs.readFile(joinedC.diagramPath, 'utf8')).cells.find(cell => cell.id === 'board').node.getAttribute('label'), 'Changed offline coordinator');
    assert.equal(a.listStatus()[0].state, 'unavailable');
    assert.notEqual(decodeBlock('REPLY', joinedB.reply).deviceId, decodeBlock('REPLY', joinedC.reply).deviceId);
});
