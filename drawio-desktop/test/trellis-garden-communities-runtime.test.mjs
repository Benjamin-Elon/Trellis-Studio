/** Opt-in loopback peers use the bundled daemon and isolated profiles; no folders are copied by the test. */ // NEW
import test from 'node:test'; // NEW
import assert from 'node:assert/strict'; // NEW
import fs from 'node:fs/promises'; // NEW
import os from 'node:os'; // NEW
import path from 'node:path'; // NEW
import crypto from 'node:crypto'; // NEW
import { fileURLToPath } from 'node:url'; // NEW
import { createIdentityService } from '../src/main/trellis-identity-service.js'; // NEW
import { createGardenLibraryService } from '../src/main/trellis-garden-library-service.js'; // NEW
import { createSyncthingService } from '../src/main/trellis-syncthing-service.js'; // NEW
import { createGardenCommunityService } from '../src/main/trellis-garden-community-service.js'; // NEW
import { inspectDiagram } from '../src/main/trellis-share-protocol.js'; // NEW

test('real peers deliver an offline request and approve it after directory membership ends', { skip: process.env.TRELLIS_SYNCTHING_RUNTIME_TEST !== '1', timeout: 240000 }, async t => { // NEW
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'trellis-community-runtime-')), project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), addresses = new Map(), services = []; // NEW
    t.after(async () => { const stopped = await Promise.allSettled(services.map(service => service.stop())), failures = stopped.filter(result => result.status === 'rejected'); if (failures.length) throw new AggregateError(failures.map(result => result.reason), 'Could not stop every runtime-test service in ' + root); await fs.rm(root, { recursive: true, force: true }); }); // CHANGE: attempt every owned cleanup even when one daemon fails to stop.
    async function client(name) { // NEW
        const base = path.join(root, name), transports = new Map(); // NEW
        async function transportFactory(identityId, profileRoot) { // NEW
            if (!transports.has(identityId)) { // NEW
                const service = createSyncthingService({ profilePath: path.join(profileRoot, 'transport'), userDataPath: profileRoot, documentsPath: base, canvasesRoot: path.join(base, 'gardens', identityId), binaryRoot: path.join(project, 'vendor', 'syncthing'), setStartup: async () => {}, onListening: ({ deviceId, port }) => addresses.set(deviceId, ['tcp://127.0.0.1:' + port]), deviceAddresses: deviceId => addresses.get(deviceId) || ['dynamic'] }); // NEW
                transports.set(identityId, service); services.push(service); // NEW
            } // NEW
            return transports.get(identityId); // NEW
        } // NEW
        const identities = createIdentityService({ root: path.join(base, 'identities'), transportFactory, adoptTransport: async () => {}, protectPending: text => text, unprotectPending: text => text }); // NEW
        const library = createGardenLibraryService({ identities, legacyService: () => transportFactory('legacy', path.join(base, 'legacy')) }), communities = createGardenCommunityService({ identities, library }); // NEW
        await identities.create({ username: name, password: 'runtime-community-password' }); const identityId = identities.session().identityId, daemon = await identities.transport(identityId); // NEW
        async function edit(garden, mutate) { // NEW
            const xml = await fs.readFile(garden.path, 'utf8'), state = inspectDiagram(xml); mutate(state); // NEW
            for (const cell of state.cells) if (cell.node.hasAttribute('trellis_users_json')) cell.node.setAttribute('trellis_users_json', JSON.stringify(state.store)); // NEW
            daemon.setContext('runtime', { diagramPath: garden.path, diagramId: garden.entry.diagramId, userId: garden.entry.workerId }); // NEW
            const saved = await daemon.collaborationAction('runtime', { shareId: garden.entry.shareId, kind: 'save', baseXml: xml, xml: state.document.serialize(), usersPolicyAction: true }); assert.equal(saved.ok, true, saved.reason); await daemon.collaborationAction('runtime', { shareId: garden.entry.shareId, kind: 'release' }); // NEW
        } // NEW
        async function garden(name) { const created = await library.create({ name }); await edit(created, state => { state.cells.find(c => c.id === '1').node.setAttribute('garden_module', '1'); }); return created; } // NEW
        return { identities, library, communities, identityId, daemon, edit, garden }; // NEW
    } // NEW
    async function eventually(label, check, timeout = 60000) { // NEW
        const deadline = Date.now() + timeout; let error; // NEW
        while (Date.now() < deadline) { try { if (await check()) return; } catch (failure) { error = failure; } await new Promise(resolve => setTimeout(resolve, 400)); } // NEW
        throw new Error(label + ': ' + (error?.message || 'did not converge')); // NEW
    } // NEW
    const alice = await client('Alice'), bob = await client('Bob'), entry = await alice.garden('Entry'), target = await alice.garden('Target'), userId = crypto.randomUUID(); // NEW
    await alice.edit(entry, state => { state.store.users.push({ id: userId, name: 'Bob', email: 'bob@example.org', portableIdentityId: bob.identityId, admin: false, disabled: false }); state.cells.find(c => c.id === '1').node.setAttribute('trellis_access_user_ids_json', JSON.stringify([userId])); }); // NEW
    const invitation = await alice.daemon.createDeviceInvite('runtime', { shareId: entry.entry.shareId, userId }), joined = await bob.daemon.joinCanvas({ block: invitation.block }); // NEW
    await alice.daemon.requestMembership('runtime', { shareId: entry.entry.shareId, operation: 'approve', reply: joined.reply }); // NEW
    await eventually('Entry garden download', async () => { await bob.daemon.poll(); return (await bob.daemon.listCanvases()).some(c => c.shareId === entry.entry.shareId && c.available && !c.pending); }); // NEW
    await bob.library.importCurrent({ path: joined.diagramPath, diagramId: entry.entry.diagramId, userId }); // NEW
    const community = await alice.communities.create({ diagramId: entry.entry.diagramId, name: 'Runtime community' }); await alice.communities.addGarden({ communityId: community.communityId, diagramId: target.entry.diagramId }); // NEW
    await eventually('Community discovery', async () => { await alice.communities.refresh(alice.identityId); await bob.communities.refresh(bob.identityId); return (await bob.communities.list()).communities[0]?.gardens.length === 2; }); // NEW
    assert.equal((await bob.daemon.listCanvases()).length, 1); await alice.daemon.stop(); // NEW
    const request = await bob.communities.requestAccess({ communityId: community.communityId, diagramId: target.entry.diagramId, preset: 'visitor', note: 'Queued while the manager is offline' }); assert.equal(request.status, 'queued'); // NEW
    await alice.daemon.start(); // NEW
    await eventually('Offline request delivery', async () => { await alice.communities.refresh(alice.identityId); return (await alice.communities.listRequests()).requests.some(r => r.id === request.id && r.canDecide); }); // NEW
    await alice.communities.detachGarden({ communityId: community.communityId, diagramId: entry.entry.diagramId }); // NEW
    await eventually('Directory membership loss', async () => { await bob.daemon.poll(); await bob.communities.refresh(bob.identityId); return (await bob.communities.list()).communities.length === 0; }); // NEW
    assert.equal((await bob.communities.listRequests()).requests[0].id, request.id); // NEW
    const incoming = (await alice.communities.listRequests()).requests.find(r => r.id === request.id); await alice.communities.decideAccess({ requestId: request.id, approved: true, preset: 'visitor', scopes: incoming.scopes }); // NEW
    await eventually('Private response after directory exit', async () => { await alice.communities.refresh(alice.identityId); await bob.communities.refresh(bob.identityId); return (await bob.communities.listRequests()).requests.some(r => r.id === request.id && r.status === 'approved'); }); // NEW
    assert.ok((await bob.library.list()).gardens.some(g => g.diagramId === target.entry.diagramId && !g.available)); assert.equal((await bob.daemon.listCanvases()).length, 1); // NEW
    assert.equal((await bob.communities.list()).communities[0]?.id, community.communityId); // NEW
}); // NEW
