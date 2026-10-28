/** Community behavior against real identity, library, journal, crypto, and isolated REST transports. */ // NEW
import test from 'node:test'; // NEW
import assert from 'node:assert/strict'; // NEW
import fs from 'node:fs/promises'; // NEW
import path from 'node:path'; // NEW
import os from 'node:os'; // NEW
import crypto from 'node:crypto'; // NEW
import { EventEmitter } from 'node:events'; // NEW
import { createIdentityService } from '../src/main/trellis-identity-service.js'; // NEW
import { createGardenLibraryService } from '../src/main/trellis-garden-library-service.js'; // NEW
import { createSyncthingService } from '../src/main/trellis-syncthing-service.js'; // NEW
import { createGardenCommunityService } from '../src/main/trellis-garden-community-service.js'; // NEW
import { inspectDiagram, digest } from '../src/main/trellis-share-protocol.js'; // CHANGE
import { reduceCommunity, communityHash, verifyGardenEvidence } from '../src/main/trellis-community-protocol.js'; // NEW

async function fixture(t, username = 'Alice', cities = []) { // NEW
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'trellis-community-')), binaries = path.join(root, 'binaries', 'win32-x64'), services = new Map(), logs = [], configs = new Map(); // NEW
    await fs.mkdir(binaries, { recursive: true }); await fs.writeFile(path.join(binaries, 'syncthing.exe'), 'fake'); await fs.writeFile(path.join(binaries, 'manifest.json'), JSON.stringify({ version: '2.1.6', platform: 'win32', arch: 'x64', binarySha256: digest('fake') })); // NEW
    async function makeTransport(identityId, profileRoot) { // NEW
        if (services.has(identityId)) return services.get(identityId); // NEW
        const profilePath = path.join(profileRoot, 'transport'); await fs.mkdir(path.join(profilePath, 'syncthing'), { recursive: true }); await fs.writeFile(path.join(profilePath, 'syncthing', 'config.xml'), '<configuration version="37"/>'); // NEW
        let config = { folders: [], devices: [], defaults: { folder: {}, device: {} }, options: {} }, child; configs.set(identityId, () => config); // NEW
        const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567', deviceId = Array.from({ length: 8 }, () => [...crypto.randomBytes(7)].map(n => alphabet[n % 32]).join('')).join('-'); // NEW
        const service = createSyncthingService({ listCities: async () => cities, profilePath, userDataPath: profileRoot, documentsPath: root, canvasesRoot: path.join(root, 'gardens', identityId), binaryRoot: path.dirname(binaries), platform: 'win32', arch: 'x64', setStartup: async () => {}, spawn() { child = new EventEmitter(); child.kill = () => child.emit('exit', 0); return child; }, fetch: async (url, args) => { // NEW
            const endpoint = new URL(url).pathname.slice(6); logs.push({ identityId, endpoint, method: args.method }); let result = {}; // NEW
            if (endpoint === 'system/status') result = { myID: deviceId }; // NEW
            else if (endpoint === 'config') { if (args.method === 'PUT') config = JSON.parse(args.body); else result = structuredClone(config); } // NEW
            else if (endpoint === 'system/connections') result = { connections: {} }; // NEW
            else if (endpoint.startsWith('config/folders/') && args.method === 'DELETE') config.folders = config.folders.filter(f => f.id !== decodeURIComponent(endpoint.slice(15))); // NEW
            else if (endpoint === 'system/shutdown') child.emit('exit', 0); // NEW
            return { ok: true, text: async () => JSON.stringify(result) }; // NEW
        } }); services.set(identityId, service); return service; // NEW
    } // NEW
    const identities = createIdentityService({ root: path.join(root, 'identities'), transportFactory: makeTransport, adoptTransport: async () => {}, protectPending: text => text, unprotectPending: text => text }); // NEW
    const library = createGardenLibraryService({ identities, listCities: async () => cities, legacyService: () => makeTransport('legacy', path.join(root, 'legacy')) }), communities = createGardenCommunityService({ identities, library }); // NEW
    t.after(async () => { for (const service of services.values()) await service.stop(); await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }); // CHANGE: tolerate Windows directory locks after all owned work stops.
    await identities.create({ username, password: 'community-password' }); // NEW
    const identityId = identities.session().identityId, daemon = await identities.transport(identityId); // NEW
    async function garden(name = 'First garden') { // NEW
        const created = await library.create({ name }); const xml = await fs.readFile(created.path, 'utf8'), state = inspectDiagram(xml), cell = state.cells.find(c => c.id === '1'); cell.node.setAttribute('garden_module', '1'); cell.node.setAttribute('label', name); // NEW
        daemon.setContext('fixture', { diagramPath: created.path, diagramId: created.entry.diagramId, userId: created.entry.workerId }); // NEW
        const saved = await daemon.collaborationAction('fixture', { shareId: created.entry.shareId, kind: 'save', baseXml: xml, xml: state.document.serialize() }); assert.equal(saved.ok, true, saved.reason); await daemon.collaborationAction('fixture', { shareId: created.entry.shareId, kind: 'release' }); return created; // NEW
    } // NEW
    async function edit(created, mutate) { // NEW
        const xml = await fs.readFile(created.path, 'utf8'), state = inspectDiagram(xml); await mutate(state); // NEW
        for (const cell of state.cells) if (cell.node.hasAttribute('trellis_users_json')) cell.node.setAttribute('trellis_users_json', JSON.stringify(state.store)); // NEW
        daemon.setContext('fixture', { diagramPath: created.path, diagramId: created.entry.diagramId, userId: created.entry.workerId }); // NEW
        const saved = await daemon.collaborationAction('fixture', { shareId: created.entry.shareId, kind: 'save', baseXml: xml, xml: state.document.serialize(), usersPolicyAction: true }); assert.equal(saved.ok, true, saved.reason); if (!state.store.users.find(u => u.id === created.entry.workerId)?.disabled) await daemon.collaborationAction('fixture', { shareId: created.entry.shareId, kind: 'release' }); // CHANGE
    } // NEW
    return { root, identities, identityId, daemon, library, communities, garden, edit, configs, logs, makeTransport }; // CHANGE
} // NEW

/** Copy only the already authorized shared folder, emulating delayed Syncthing delivery. */ // NEW
async function deliver(from, to, created) { // NEW
    const a = (await from.daemon.listCanvases()).find(c => c.shareId === created.entry.shareId), b = (await to.daemon.listCanvases()).find(c => c.shareId === created.entry.shareId); // NEW
    await fs.cp(path.join(a.folderPath, '.trellis'), path.join(b.folderPath, '.trellis'), { recursive: true, force: true }); await to.daemon.poll(); // NEW
} // NEW
async function shareWith(owner, recipient, created, admin = false) { // NEW
    const userId = crypto.randomUUID(); // NEW
    await owner.edit(created, state => { state.store.users.push({ id: userId, name: 'Bob', email: 'bob@example.org', portableIdentityId: recipient.identityId, admin, disabled: false }); state.cells.find(c => c.id === '1').node.setAttribute('trellis_access_user_ids_json', JSON.stringify([userId])); }); // NEW
    const invite = await owner.daemon.createDeviceInvite('fixture', { shareId: created.entry.shareId, userId }), joined = await recipient.daemon.joinCanvas({ block: invite.block }); // NEW
    await owner.daemon.requestMembership('fixture', { shareId: created.entry.shareId, operation: 'approve', reply: joined.reply }); await owner.daemon.poll(); await deliver(owner, recipient, created); // NEW
    const imported = await recipient.library.importCurrent({ path: joined.diagramPath, diagramId: created.entry.diagramId, userId }); assert.equal(imported.ok, true); // NEW
    return { userId, path: joined.diagramPath }; // NEW
} // NEW
async function deliverChannel(from, to, kind, id) { // NEW
    const area = kind === 'community' ? 'community-data' : 'community-requests'; // NEW
    await fs.cp(path.join(from.identities.identityRoot(from.identityId), area, id), path.join(to.identities.identityRoot(to.identityId), area, id), { recursive: true, force: true }); // NEW
} // NEW

test('discovery reads current verified state on every explicit call without retaining a service snapshot', async t => { // NEW
    const f = await fixture(t), garden = await f.garden(), created = await f.communities.create({ diagramId: garden.entry.diagramId, name: 'Snapshot community' }); // NEW
    const verify = f.library.verifiedRecords; let registrationReads = 0; t.mock.method(f.library, 'verifiedRecords', (...args) => { if (String(args[1]).endsWith('community-registrations')) registrationReads++; return verify(...args); }); // NEW
    const [first, concurrent] = await Promise.all([f.communities.list({ scope: 'discovery' }), f.communities.list({ scope: 'discovery' })]); assert.equal(registrationReads, 2); assert.deepEqual(first, concurrent); // NEW
    assert.ok(first.communities[0].gardens[0].joined); first.communities[0].name = 'Client mutation'; // NEW
    await f.communities.describeGarden({ communityId: created.communityId, diagramId: garden.entry.diagramId, description: 'Changed after opening' }); // NEW
    assert.equal((await f.communities.list({ scope: 'accessible' })).communities[0].gardens[0].description, 'Changed after opening'); // NEW
    const retained = await f.communities.list({ scope: 'discovery' }); assert.equal(retained.communities[0].name, 'Snapshot community'); assert.equal(retained.communities[0].gardens[0].description, 'Changed after opening'); // NEW
    const previous = f.identities.session().generation; await f.identities.lock(); await f.identities.unlock({ identityId: f.identityId, password: 'community-password' }); assert.ok(f.identities.session().generation > previous); // NEW
    assert.equal((await f.communities.list({ scope: 'discovery' })).communities[0].gardens[0].description, 'Changed after opening'); await assert.rejects(f.communities.list({ scope: 'invalid' }), /scope/); // NEW
}); // NEW

test('a failed first discovery read is retryable and browsing does not wait for background maintenance', async t => { // NEW
    const f = await fixture(t), garden = await f.garden(); await f.communities.create({ diagramId: garden.entry.diagramId, name: 'Read while syncing' }); // NEW
    const verify = f.library.verifiedRecords; let fail = true; t.mock.method(f.library, 'verifiedRecords', (...args) => { if (fail && String(args[1]).endsWith('community-registrations')) { fail = false; throw new Error('Discovery unavailable'); } return verify(...args); }); // NEW
    await assert.rejects(f.communities.list({ scope: 'discovery' }), /unavailable/); assert.equal((await f.communities.list({ scope: 'discovery' })).communities.length, 1); // NEW
    let release, entered; const waiting = new Promise(resolve => { entered = resolve; }), gate = new Promise(resolve => { release = resolve; }), configure = f.daemon.configureMetadataChannel; // NEW
    t.mock.method(f.daemon, 'configureMetadataChannel', async (...args) => { entered(); await gate; return configure(...args); }); // NEW
    const background = f.communities.refresh(f.identityId); await waiting; // NEW
    try { // NEW
        const listing = await Promise.race([f.communities.list({ scope: 'accessible' }), new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('Browsing waited for maintenance')), 2000); timer.unref(); })]); assert.equal(listing.communities.length, 1); // NEW
    } finally { release(); await background; } // NEW
}); // NEW

test('signed city summaries support directory distances and unchanged polls retain their evidence revision', async t => { // NEW
    const city = { cityId: 'origin', name: 'Origin', region: 'Region', country: 'Country', latitude: 0, longitude: 0 }; // NEW
    const f = await fixture(t, 'Alice', [city]), garden = await f.garden(); await f.edit(garden, state => state.cells.find(cell => cell.id === '1').node.setAttribute('city_id', city.cityId)); // NEW
    await f.library.setReferenceCity({ cityId: city.cityId }); const created = await f.communities.create({ diagramId: garden.entry.diagramId, name: 'Located gardens' }); // NEW
    const first = (await f.daemon.communities.garden({ shareId: garden.entry.shareId })).proof; assert.equal(first.payload.moduleCities[0].cityId, city.cityId); assert.equal(first.payload.locationsComplete, true); // NEW
    await f.daemon.poll(); const second = (await f.daemon.communities.garden({ shareId: garden.entry.shareId })).proof; assert.deepEqual(second, first); // NEW
    const listing = (await f.communities.list()).communities.find(community => community.id === created.communityId).gardens[0]; assert.equal(listing.distanceKm, 0); assert.equal(listing.people.userCount, 1); assert.equal(listing.people.onlineCount, 1); // NEW
    const library = (await f.library.list()).gardens[0]; assert.equal(listing.people.memberKeys[0], library.people.memberKeys[0]); assert.equal(library.summary.members, undefined); // NEW
    const anchor = { shareId: garden.entry.shareId, diagramId: garden.entry.diagramId, genesisCoordinatorPublicKey: first.payload.descriptor.genesisCoordinatorPublicKey }; // CHANGE
    const invalid = await f.daemon.communities.sign({ ...first.payload, moduleCities: [{ ...city, latitude: 91 }] }); assert.throws(() => verifyGardenEvidence(invalid, anchor), /location/i); // CHANGE
    const { moduleCities, gardenModuleCount, locationsComplete, userCount, ...legacyFields } = first.payload; const legacy = await f.daemon.communities.sign(legacyFields); assert.doesNotThrow(() => verifyGardenEvidence(legacy, anchor)); // NEW
    await f.edit(garden, state => state.cells.find(cell => cell.id === '1').node.setAttribute('city_id', 'missing')); const changed = (await f.daemon.communities.garden({ shareId: garden.entry.shareId })).proof; assert.ok(changed.payload.revision > first.payload.revision); assert.equal(changed.payload.locationsComplete, false); // NEW
}); // NEW

test('create, admit, describe, detach, archive, and restart preserve existing gardens', async t => { // NEW
    const f = await fixture(t), first = await f.garden(), second = await f.garden('Second garden'), original = first.entry.diagramId; // NEW
    let retried = false; const rename = fs.rename; if (process.platform === 'win32') t.mock.method(fs, 'rename', async (from, to) => { if (!retried && String(to).includes('community-bindings')) { retried = true; throw Object.assign(new Error('Transient destination lock'), { code: 'EPERM' }); } return rename(from, to); }); // NEW
    const created = await f.communities.create({ diagramId: original, name: 'Our neighborhood', description: 'Grow together', gardenDescription: 'The first plot' }); // NEW
    assert.equal(created.status, 'completed'); let listing = await f.communities.list(); assert.deepEqual(listing.errors, []); assert.equal(listing.communities.length, 1); // NEW
    if (process.platform === 'win32') assert.equal(retried, true); // NEW
    assert.equal(listing.communities[0].gardens[0].description, 'The first plot'); assert.equal(listing.communities[0].gardens[0].joined, true); // NEW
    await f.communities.addGarden({ communityId: created.communityId, diagramId: second.entry.diagramId, description: 'Second plot' }); // NEW
    listing = await f.communities.list(); assert.equal(listing.communities[0].gardens.length, 2); // NEW
    await f.communities.describeGarden({ communityId: created.communityId, diagramId: original, description: 'Updated description' }); // NEW
    assert.equal((await f.communities.list()).communities[0].gardens.find(g => g.diagramId === original).description, 'Updated description'); // NEW
    const restarted = createGardenCommunityService({ identities: f.identities, library: f.library }); assert.equal((await restarted.list()).communities.length, 1); // NEW
    await restarted.detachGarden({ communityId: created.communityId, diagramId: original }); assert.equal((await restarted.list()).communities[0].gardens.length, 1); // NEW
    await restarted.detachGarden({ communityId: created.communityId, diagramId: second.entry.diagramId }); assert.equal((await restarted.list()).communities.length, 0); // NEW
    assert.equal((await f.library.list()).gardens.length, 2); assert.equal(first.entry.diagramId, original); // NEW
}); // NEW

test('community evidence rejects forged coordinator and forged administrator changes', async t => { // NEW
    const f = await fixture(t), first = await f.garden(), created = await f.communities.create({ diagramId: first.entry.diagramId, name: 'Protected community' }); // NEW
    const base = path.join(f.identities.identityRoot(f.identityId), 'community-data', created.communityId), changes = await Promise.all((await fs.readdir(path.join(base, 'records'))).map(n => fs.readFile(path.join(base, 'records', n), 'utf8').then(JSON.parse))), genesis = changes.find(r => r.payload.kind === 'create'); // NEW
    assert.throws(() => verifyGardenEvidence({ ...genesis.payload.data.evidence, signature: 'forged' }, genesis.payload.data.anchor), /coordinator/); // NEW
    const forged = await f.daemon.communities.sign({ schema: 1, id: 'forged', communityId: created.communityId, kind: 'details', clock: 2, parents: [genesis.payload.id], actorIdentityId: 'somebody-else', data: { name: 'Taken over', description: '' } }); // NEW
    const reduced = reduceCommunity([...changes, forged], communityHash(genesis)); assert.equal(reduced.community.name, 'Protected community'); assert.equal(reduced.rejected.length, 1); // NEW
    await assert.rejects(f.communities.setAdministrators({ communityId: created.communityId, identityIds: ['outsider'] }), /current community members/); // NEW
    const left = await f.daemon.communities.sign({ schema: 1, id: 'concurrent-a', communityId: created.communityId, kind: 'details', clock: 2, parents: [genesis.payload.id], actorIdentityId: f.identityId, data: { name: 'A', description: '' } }), right = await f.daemon.communities.sign({ ...left.payload, id: 'concurrent-z', data: { name: 'Z', description: '' } }); // NEW
    assert.equal(reduceCommunity([...changes, left, right], communityHash(genesis)).community.name, 'Z'); assert.equal(reduceCommunity([right, left, ...changes], communityHash(genesis)).community.name, 'Z'); // NEW
    const changedGeneration = await f.daemon.communities.sign({ ...genesis.payload.data.evidence.payload, revision: 100, binding: { communityId: created.communityId, generation: 'new-association' } }); // NEW
    const stale = reduceCommunity(changes, communityHash(genesis), [changedGeneration]); assert.equal(stale.archived, true); assert.equal(stale.members.size, 0); // NEW
    const canvas = (await f.daemon.listCanvases()).find(c => c.shareId === first.entry.shareId), sharedMetadata = path.join(canvas.folderPath, '.trellis', 'garden-community'); // NEW
    await fs.writeFile(path.join(sharedMetadata, 'binding.json'), JSON.stringify({ communityId: 'forged-community', generation: 'forged' })); // NEW
    await fs.writeFile(path.join(sharedMetadata, 'evidence.json'), JSON.stringify({ payload: { ...genesis.payload.data.evidence.payload, revision: 999, binding: { communityId: 'forged-community', generation: 'forged' } }, signature: 'forged' })); // NEW
    const refreshed = await f.daemon.communities.garden({ shareId: first.entry.shareId }); verifyGardenEvidence(refreshed.proof, genesis.payload.data.anchor); assert.equal(refreshed.proof.payload.binding.communityId, created.communityId); // NEW
}); // NEW

test('a garden cannot be admitted to two communities and cancelled admission keeps garden access', async t => { // NEW
    const f = await fixture(t), a = await f.garden('A'), b = await f.garden('B'); // NEW
    const ca = await f.communities.create({ diagramId: a.entry.diagramId, name: 'A community' }), cb = await f.communities.create({ diagramId: b.entry.diagramId, name: 'B community' }); // NEW
    await assert.rejects(f.communities.addGarden({ communityId: cb.communityId, diagramId: a.entry.diagramId }), /Detach|current community/); // NEW
    await f.communities.detachGarden({ communityId: ca.communityId, diagramId: a.entry.diagramId }); // NEW
    await f.communities.addGarden({ communityId: cb.communityId, diagramId: a.entry.diagramId }); // NEW
    assert.equal((await f.communities.list()).communities[0].gardens.length, 2); // NEW
}); // NEW

test('private envelopes authenticate channel context and exclude unrelated devices', async t => { // NEW
    const a = await fixture(t, 'Alice'), b = await fixture(t, 'Bob'), stranger = await fixture(t, 'Charlie'); // NEW
    const endpoints = [await a.daemon.communities.endpoint(), await b.daemon.communities.endpoint()], encrypted = await a.daemon.communities.seal({ note: 'private words' }, endpoints, 'channel'); // NEW
    assert.equal(JSON.stringify(encrypted).includes('private words'), false); assert.deepEqual(await b.daemon.communities.open(encrypted, 'channel'), { note: 'private words' }); // NEW
    assert.equal(await stranger.daemon.communities.open(encrypted, 'channel'), null); await assert.rejects(b.daemon.communities.open(encrypted, 'different-channel'), /Invalid/); // NEW
    encrypted.payload.body.data = encrypted.payload.body.data.replace(/^./, c => c === 'A' ? 'B' : 'A'); await assert.rejects(b.daemon.communities.open(encrypted, 'channel'), /Invalid/); // NEW
}); // NEW

test('metadata channels survive pause/resume and daemon restart without sharing identity catalogs', async t => { // NEW
    const f = await fixture(t), first = await f.garden(), created = await f.communities.create({ diagramId: first.entry.diagramId, name: 'Persistent community' }); // NEW
    const config = () => f.configs.get(f.identityId)(); assert.ok(config().folders.some(c => c.id === 'trellis-community-' + created.communityId)); // NEW
    const folder = config().folders.find(c => c.id === 'trellis-community-' + created.communityId); assert.match(folder.path, /community-data/); assert.doesNotMatch(folder.path, /metadata/); // NEW
    await f.daemon.setPaused({ paused: true }); assert.equal(config().folders.find(c => c.id === folder.id).paused, true); // NEW
    await f.daemon.configureMetadataChannel({ kind: 'access-request', id: 'paused-request', directory: path.join(f.root, 'paused-request'), devices: [] }); assert.equal(config().folders.find(c => c.id === 'trellis-access-request-paused-request').paused, true); // NEW
    await f.daemon.stop(); await f.daemon.start(); assert.equal(config().folders.find(c => c.id === folder.id).paused, true); // NEW
    await f.daemon.setPaused({ paused: false }); assert.equal(config().folders.find(c => c.id === folder.id).paused, false); // NEW
    const ownDevice = (await f.daemon.communities.endpoint()).payload.deviceId, metadata = { identityId: f.identityId, directory: f.identities.metadataRoot(f.identityId), devices: [{ syncthingId: ownDevice, name: 'Current' }, { syncthingId: 'revoked-peer', name: 'Paired' }] }; // NEW
    await f.daemon.configureIdentityMetadata(metadata); await f.daemon.configureMetadataChannel({ kind: 'access-request', id: 'paired-request', directory: path.join(f.root, 'paired-request'), devices: [ownDevice, 'revoked-peer'] }); // NEW
    await f.daemon.configureIdentityMetadata({ ...metadata, devices: metadata.devices.slice(0, 1) }); assert.deepEqual(config().folders.find(c => c.id === 'trellis-access-request-paired-request').devices, [{ deviceID: ownDevice }]); // NEW
}); // NEW

test('a member discovers another garden and receives approved scoped access without an invite or automatic download', async t => { // NEW
    const alice = await fixture(t), bob = await fixture(t, 'Bob'), first = await alice.garden('Shared entry'), second = await alice.garden('Other garden'); // NEW
    const created = await alice.communities.create({ diagramId: first.entry.diagramId, name: 'Neighborhood' }); await alice.communities.addGarden({ communityId: created.communityId, diagramId: second.entry.diagramId, description: 'Discover me' }); // NEW
    await shareWith(alice, bob, first); await alice.communities.refresh(alice.identityId); await deliver(alice, bob, first); // NEW
    await bob.communities.refresh(bob.identityId); await deliverChannel(alice, bob, 'community', created.communityId); // NEW
    const listing = await bob.communities.list(); assert.deepEqual(listing.errors, []); assert.equal(listing.communities.length, 1); // NEW
    const discovered = listing.communities[0].gardens.find(g => g.diagramId === second.entry.diagramId); assert.equal(discovered.joined, false); assert.equal(discovered.description, 'Discover me'); assert.equal('members' in discovered, false); assert.equal((await bob.daemon.listCanvases()).length, 1); // NEW
    const sent = await bob.communities.requestAccess({ communityId: created.communityId, diagramId: second.entry.diagramId, preset: 'gardener', note: 'I would like to help' }); assert.equal(sent.status, 'queued'); // NEW
    await deliverChannel(bob, alice, 'community', created.communityId); await alice.communities.refresh(alice.identityId); await deliverChannel(bob, alice, 'request', sent.id); // NEW
    const incoming = await alice.communities.listRequests(); assert.equal(incoming.requests.length, 1); assert.equal(incoming.requests[0].canDecide, true); // NEW
    await alice.communities.decideAccess({ requestId: sent.id, approved: true, preset: 'gardener', scopes: incoming.requests[0].scopes, note: 'Welcome' }); // NEW
    await deliverChannel(alice, bob, 'request', sent.id); await bob.communities.refresh(bob.identityId); // NEW
    const available = (await bob.library.list()).gardens.find(g => g.diagramId === second.entry.diagramId); assert.ok(available); assert.equal(available.available, false); // NEW
    assert.equal((await bob.daemon.listCanvases()).length, 1); assert.equal((await bob.communities.listRequests()).requests[0].status, 'approved'); // NEW
    const policy = inspectDiagram(await fs.readFile(second.path, 'utf8')), linked = policy.store.users.find(u => u.portableIdentityId === bob.identityId); assert.ok(linked && !linked.admin); // NEW
    const grant = JSON.parse(policy.cells.find(c => c.id === '1').node.getAttribute('trellis_access_grants_json')).find(g => g.userId === linked.id); assert.equal(grant.preset, 'gardener'); assert.equal(grant.capabilities.includes('manage_access'), false); // NEW
    await bob.library.download({ diagramId: second.entry.diagramId }); await deliver(alice, bob, second); const downloaded = (await bob.daemon.listCanvases()).find(g => g.shareId === second.entry.shareId); assert.equal(downloaded.pending, false); assert.equal(downloaded.available, true); // NEW
    await alice.edit(second, state => { state.store.users.find(u => u.id === linked.id).disabled = true; }); await alice.communities.refresh(alice.identityId); await deliver(alice, bob, second); await deliverChannel(alice, bob, 'community', created.communityId); // NEW
    const again = await bob.communities.requestAccess({ communityId: created.communityId, diagramId: second.entry.diagramId, preset: 'visitor' }); assert.notEqual(again.id, sent.id); // NEW
    await deliverChannel(bob, alice, 'community', created.communityId); await alice.communities.refresh(alice.identityId); await deliverChannel(bob, alice, 'request', again.id); // NEW
    const renewed = (await alice.communities.listRequests()).requests.find(r => r.id === again.id); await alice.communities.decideAccess({ requestId: again.id, approved: true, preset: 'visitor', scopes: renewed.scopes }); // NEW
    await deliverChannel(alice, bob, 'request', again.id); await bob.communities.refresh(bob.identityId); // NEW
    const entitlement = await bob.library.getEntry(second.entry.diagramId); assert.notEqual(entitlement.workerId, linked.id); assert.equal(entitlement.communityGrantId, again.id); // NEW
    await bob.communities.refresh(bob.identityId); assert.equal((await bob.library.getEntry(second.entry.diagramId)).communityGrantId, again.id); // NEW
    await bob.library.download({ diagramId: second.entry.diagramId }); await deliver(alice, bob, second); assert.equal((await bob.daemon.listCanvases()).find(g => g.shareId === second.entry.shareId).available, true); // NEW
}); // NEW

test('pending requests survive last-garden removal and a private approval restores membership', async t => { // NEW
    const alice = await fixture(t), bob = await fixture(t, 'Bob'), first = await alice.garden('Entry'), second = await alice.garden('Destination'); // NEW
    const created = await alice.communities.create({ diagramId: first.entry.diagramId, name: 'Community' }); await alice.communities.addGarden({ communityId: created.communityId, diagramId: second.entry.diagramId }); // NEW
    const member = await shareWith(alice, bob, first); await alice.communities.refresh(alice.identityId); await deliver(alice, bob, first); await bob.communities.refresh(bob.identityId); await deliverChannel(alice, bob, 'community', created.communityId); // NEW
    const sent = await bob.communities.requestAccess({ communityId: created.communityId, diagramId: second.entry.diagramId, note: 'Keep this request' }); // NEW
    await deliverChannel(bob, alice, 'community', created.communityId); await alice.communities.refresh(alice.identityId); await deliverChannel(bob, alice, 'request', sent.id); // NEW
    await alice.edit(first, state => { state.store.users.find(u => u.id === member.userId).disabled = true; }); // NEW
    await alice.communities.refresh(alice.identityId); await deliverChannel(alice, bob, 'community', created.communityId); await bob.communities.refresh(bob.identityId); // NEW
    assert.equal((await bob.communities.list()).communities.length, 0); assert.equal((await bob.communities.listRequests()).requests.length, 1); // NEW
    const folder = bob.configs.get(bob.identityId)().folders.find(f => f.id === 'trellis-community-' + created.communityId); assert.equal(folder.paused, true); // NEW
    assert.equal(bob.configs.get(bob.identityId)().folders.find(f => f.id === 'trellis-access-request-' + sent.id).paused, false); // NEW
    const incoming = (await alice.communities.listRequests()).requests[0]; await alice.communities.decideAccess({ requestId: sent.id, approved: true, scopes: incoming.scopes, preset: 'visitor' }); // NEW
    await deliverChannel(alice, bob, 'request', sent.id); const restarted = createGardenCommunityService({ identities: bob.identities, library: bob.library }); await restarted.refresh(bob.identityId); // NEW
    assert.ok((await bob.library.list()).gardens.some(g => g.diagramId === second.entry.diagramId)); // NEW
    await alice.communities.refresh(alice.identityId); await deliverChannel(alice, bob, 'community', created.communityId); assert.equal((await restarted.list()).communities.length, 1); // NEW
}); // NEW

test('dual approval admits another administrator’s garden and succession rejects new records from a removed admin', async t => { // NEW
    const alice = await fixture(t), bob = await fixture(t, 'Bob'), first = await alice.garden('Entry'), bobGarden = await bob.garden('Bob garden'); // NEW
    const created = await alice.communities.create({ diagramId: first.entry.diagramId, name: 'Community' }); // NEW
    await shareWith(alice, bob, first, true); await alice.communities.refresh(alice.identityId); await deliver(alice, bob, first); await bob.communities.refresh(bob.identityId); await deliverChannel(alice, bob, 'community', created.communityId); // NEW
    await bob.communities.addGarden({ communityId: created.communityId, diagramId: bobGarden.entry.diagramId }); assert.equal((await bob.communities.list()).communities[0].gardens.length, 1); // NEW
    await deliverChannel(bob, alice, 'community', created.communityId); const pending = (await alice.communities.list()).communities[0].admissions; assert.equal(pending.length, 1); // NEW
    await alice.communities.decideAdmission({ communityId: created.communityId, admissionId: pending[0].id, approved: true }); await deliverChannel(alice, bob, 'community', created.communityId); await bob.communities.refresh(bob.identityId); // NEW
    assert.equal((await bob.communities.list()).communities[0].gardens.length, 2); // NEW
    const base = path.join(alice.identities.identityRoot(alice.identityId), 'community-data', created.communityId), changes = await Promise.all((await fs.readdir(path.join(base, 'records'))).map(n => fs.readFile(path.join(base, 'records', n), 'utf8').then(JSON.parse))), genesis = changes.find(r => r.payload.kind === 'create'); // CHANGE
    await alice.edit(first, state => { state.store.users.find(u => u.portableIdentityId === alice.identityId).disabled = true; }); await alice.communities.refresh(alice.identityId); await deliverChannel(alice, bob, 'community', created.communityId); // NEW
    let listing = await bob.communities.list(); assert.equal(listing.communities[0].automaticSuccessor, bob.identityId); // NEW
    await bob.communities.update({ communityId: created.communityId, name: 'Bob manages it', description: '' }); // NEW
    const forged = await alice.daemon.communities.sign({ schema: 1, id: 'after-removal', clock: 100, parents: [genesis.payload.id], kind: 'details', communityId: created.communityId, actorIdentityId: alice.identityId, data: { name: 'Stolen', description: '' } }); // NEW
    await fs.writeFile(path.join(bob.identities.identityRoot(bob.identityId), 'community-data', created.communityId, 'records', 'after-removal.json'), JSON.stringify(forged)); // NEW
    listing = await bob.communities.list(); assert.equal(listing.communities[0].name, 'Bob manages it'); // NEW
}); // NEW

test('deleting the last garden archives its community without recreating the project', async t => { // NEW
    const f = await fixture(t), first = await f.garden(), created = await f.communities.create({ diagramId: first.entry.diagramId, name: 'Community' }); // NEW
    await f.library.trash({ diagramId: first.entry.diagramId, confirm: true }); await f.communities.refresh(f.identityId); // CHANGE
    assert.equal((await f.communities.list()).communities.length, 0); assert.equal((await f.library.list()).gardens.length, 0); // NEW
    const trash = await f.library.listTrash(); assert.equal(trash.gardens.length, 1); assert.ok(await fs.stat(path.join(f.identities.identityRoot(f.identityId), 'community-data', created.communityId))); // NEW
}); // NEW

test('joining a later garden bootstraps the complete directory without downloading its other gardens', async t => { // NEW
    const alice = await fixture(t), bob = await fixture(t, 'Bob'), first = await alice.garden('First'), second = await alice.garden('Second'); // NEW
    const created = await alice.communities.create({ diagramId: first.entry.diagramId, name: 'Community' }); await alice.communities.addGarden({ communityId: created.communityId, diagramId: second.entry.diagramId }); // NEW
    await shareWith(alice, bob, second); await alice.communities.refresh(alice.identityId); await deliver(alice, bob, second); await bob.communities.refresh(bob.identityId); // NEW
    assert.equal(bob.configs.get(bob.identityId)().folders.find(f => f.id === 'trellis-community-' + created.communityId).paused, false); // NEW
    await deliverChannel(alice, bob, 'community', created.communityId); // NEW
    const listing = await bob.communities.list(); assert.equal(listing.communities.length, 1); assert.equal(listing.communities[0].gardens.length, 2); assert.equal(listing.communities[0].gardens.find(g => g.diagramId === second.entry.diagramId).joined, true); assert.equal((await bob.daemon.listCanvases()).length, 1); // NEW
}); // NEW

test('paired devices read private pending-request history through the identity vault and revoked devices cannot reopen it', async t => { // NEW
    const alice = await fixture(t), bob = await fixture(t, 'Bob'), first = await alice.garden('Entry'), second = await alice.garden('Other'); // NEW
    const created = await alice.communities.create({ diagramId: first.entry.diagramId, name: 'Community' }); await alice.communities.addGarden({ communityId: created.communityId, diagramId: second.entry.diagramId }); // NEW
    await shareWith(alice, bob, first); await alice.communities.refresh(alice.identityId); await deliver(alice, bob, first); await bob.communities.refresh(bob.identityId); await deliverChannel(alice, bob, 'community', created.communityId); // NEW
    const sent = await bob.communities.requestAccess({ communityId: created.communityId, diagramId: second.entry.diagramId, note: 'Private pairing history' }); // NEW
    const peer = createIdentityService({ root: path.join(bob.root, 'paired'), transportFactory: (id, profileRoot) => bob.makeTransport('peer-' + id, profileRoot), adoptTransport: async () => {}, protectPending: text => text, unprotectPending: text => text }); // NEW
    const request = await peer.createPairRequest({ deviceName: 'Paired reader' }), setup = await bob.identities.approvePairRequest({ request: request.request }); await peer.importSetup({ setup: setup.setup, password: 'community-password' }); await peer.unlock({ identityId: bob.identityId, password: 'community-password' }); // NEW
    await fs.cp(bob.identities.metadataRoot(bob.identityId), peer.metadataRoot(bob.identityId), { recursive: true }); // NEW
    const peerLibrary = createGardenLibraryService({ identities: peer, legacyService: async () => bob.daemon }), peerCommunities = createGardenCommunityService({ identities: peer, library: peerLibrary }); // NEW
    const history = await peerCommunities.listRequests(); assert.equal(history.requests.length, 1); assert.equal(history.requests[0].note, 'Private pairing history'); // NEW
    const area = path.join(bob.identities.metadataRoot(bob.identityId), 'community-message-archives', sent.id), archived = JSON.parse(await fs.readFile(path.join(area, (await fs.readdir(area))[0]), 'utf8')); assert.equal(JSON.stringify(archived).includes('Private pairing history'), false); // NEW
    await assert.rejects(alice.identities.communityArchive('open', archived.payload.envelope, 'trellis-community-request:' + sent.id + ':' + archived.payload.messageId)); // NEW
    const pairedDeviceId = peer.session().deviceId; await bob.identities.removeDevice({ deviceId: pairedDeviceId }); await fs.cp(bob.identities.metadataRoot(bob.identityId), peer.metadataRoot(bob.identityId), { recursive: true, force: true }); await peer.refresh(); await assert.rejects(peerCommunities.listRequests(), /Log in/); // NEW
}); // NEW

for (const outcome of ['moved', 'deleted', 'denied']) test('pending requests remain deliverable when the target is ' + outcome, async t => { // NEW
    const alice = await fixture(t), bob = await fixture(t, 'Bob'), first = await alice.garden('Entry'), target = await alice.garden('Target'); // NEW
    const created = await alice.communities.create({ diagramId: first.entry.diagramId, name: 'Original community' }); await alice.communities.addGarden({ communityId: created.communityId, diagramId: target.entry.diagramId }); // NEW
    await shareWith(alice, bob, first); await alice.communities.refresh(alice.identityId); await deliver(alice, bob, first); await bob.communities.refresh(bob.identityId); await deliverChannel(alice, bob, 'community', created.communityId); // NEW
    const sent = await bob.communities.requestAccess({ communityId: created.communityId, diagramId: target.entry.diagramId, note: 'Durable request' }); // NEW
    assert.equal((await bob.communities.requestAccess({ communityId: created.communityId, diagramId: target.entry.diagramId })).id, sent.id); // NEW
    await deliverChannel(bob, alice, 'community', created.communityId); await alice.communities.refresh(alice.identityId); await deliverChannel(bob, alice, 'request', sent.id); // NEW
    let destination; // NEW
    if (outcome === 'denied') { // NEW
        const decision = await bob.daemon.communities.sign({ schema: 1, id: 'forged-manager', kind: 'access-decision', actorIdentityId: bob.identityId, data: { requestId: sent.id, shareId: target.entry.shareId, approved: true } }); // NEW
        const envelope = await bob.daemon.communities.seal({ kind: 'decision', decision }, [await bob.daemon.communities.endpoint(), await alice.daemon.communities.endpoint()], sent.id); // NEW
        await fs.writeFile(path.join(bob.identities.identityRoot(bob.identityId), 'community-requests', sent.id, envelope.payload.id + '.json'), JSON.stringify(envelope)); await deliverChannel(bob, alice, 'request', sent.id); // NEW
    } // NEW
    if (outcome === 'moved') { // NEW
        await alice.communities.detachGarden({ communityId: created.communityId, diagramId: target.entry.diagramId }); // NEW
        destination = await alice.communities.create({ diagramId: target.entry.diagramId, name: 'Destination community' }); // NEW
    } else if (outcome === 'deleted') await alice.library.trash({ diagramId: target.entry.diagramId, confirm: true }); // NEW
    const restarted = createGardenCommunityService({ identities: alice.identities, library: alice.library }); await restarted.refresh(alice.identityId); // NEW
    if (outcome !== 'deleted') { // NEW
        const incoming = (await restarted.listRequests()).requests.find(r => r.id === sent.id); // NEW
        await assert.rejects(restarted.decideAccess({ requestId: sent.id, approved: true, preset: 'forged-role', scopes: incoming.scopes }), /valid access role/); // NEW
        if (outcome === 'denied') { // NEW
            assert.equal(incoming.canDecide, true); const concurrent = await Promise.allSettled([restarted.decideAccess({ requestId: sent.id, approved: false, note: 'Final response' }), restarted.decideAccess({ requestId: sent.id, approved: true, preset: 'visitor', scopes: incoming.scopes })]); // NEW
            assert.equal(concurrent[0].status, 'fulfilled'); assert.equal(concurrent[1].status, 'rejected'); // NEW
        } else await restarted.decideAccess({ requestId: sent.id, approved: true, preset: 'visitor', scopes: incoming.scopes, note: 'Final response' }); // NEW
        await assert.rejects(restarted.decideAccess({ requestId: sent.id, approved: false }), /already has a decision/); // NEW
    } // NEW
    await deliverChannel(alice, bob, 'request', sent.id); await bob.communities.refresh(bob.identityId); // NEW
    assert.equal((await bob.communities.listRequests()).requests[0].status, outcome === 'deleted' ? 'unavailable' : outcome === 'denied' ? 'denied' : 'approved'); // NEW
    assert.equal((await bob.daemon.listCanvases()).length, 1); // NEW
    if (destination) { // NEW
        await deliverChannel(alice, bob, 'community', destination.communityId); assert.ok((await bob.communities.list()).communities.some(c => c.id === destination.communityId)); // NEW
        await alice.edit(target, state => { state.store.users.find(u => u.portableIdentityId === bob.identityId).disabled = true; }); // NEW
        await restarted.refresh(alice.identityId); const revoked = inspectDiagram(await fs.readFile(target.path, 'utf8')).store.users.find(u => u.portableIdentityId === bob.identityId); // NEW
        await deliverChannel(bob, alice, 'request', sent.id); await restarted.refresh(alice.identityId); // NEW
        assert.equal(inspectDiagram(await fs.readFile(target.path, 'utf8')).store.users.find(u => u.id === revoked.id).disabled, true); // NEW
    } // NEW
}); // NEW

test('directory replay and cached browsing remain bounded for 100 gardens and 300 identities', async t => { // NEW
    const f = await fixture(t), first = await f.garden(), created = await f.communities.create({ diagramId: first.entry.diagramId, name: 'Benchmark' }); // NEW
    const base = path.join(f.identities.identityRoot(f.identityId), 'community-data', created.communityId), original = await Promise.all((await fs.readdir(path.join(base, 'records'))).map(n => fs.readFile(path.join(base, 'records', n), 'utf8').then(JSON.parse))), genesis = original.find(r => r.payload.kind === 'create'), template = genesis.payload.data.evidence.payload, all = [genesis], proofs = [genesis.payload.data.evidence]; // NEW
    let previous = genesis.payload.id; // NEW
    for (let i = 1; i < 100; i++) { // NEW
        const shareId = 'benchmark-share-' + i, diagramId = 'benchmark-garden-' + i, extra = Array.from({ length: 299 }, (_, n) => ({ identityId: 'benchmark-person-' + n, userId: 'benchmark-user-' + n, admin: false, manager: false, devices: [{ deviceId: 'benchmark-device-' + n, publicKey: template.descriptor.coordinatorPublicKey }] })), members = [template.members[0], ...extra]; // NEW
        const transportMembers = members.flatMap(m => m.devices.map(d => ({ ...d, userId: m.userId }))), membership = await f.daemon.communities.sign({ schema: 1, shareId, diagramId, version: 1, coordinatorDeviceId: template.descriptor.coordinatorDeviceId, members: transportMembers }); // NEW
        const descriptor = { ...template.descriptor, shareId, diagramId, membershipVersion: 1, members: transportMembers }, evidence = await f.daemon.communities.sign({ ...template, descriptor, membership: [membership], members, userCount: members.length, revision: 1, name: 'Garden ' + i }), anchor = { shareId, diagramId, genesisCoordinatorPublicKey: descriptor.genesisCoordinatorPublicKey }; proofs.push(evidence); // NEW
        const admission = await f.daemon.communities.sign({ schema: 1, id: 'benchmark-admission-' + i, communityId: created.communityId, parents: [previous], clock: i * 2, actorIdentityId: f.identityId, kind: 'admission', data: { evidence, anchor, description: '' } }); all.push(admission); // NEW
        const approval = await f.daemon.communities.sign({ schema: 1, id: 'benchmark-approval-' + i, communityId: created.communityId, parents: [admission.payload.id], clock: i * 2 + 1, actorIdentityId: f.identityId, kind: 'admit', data: { admissionId: admission.payload.id } }); all.push(approval); previous = approval.payload.id; // NEW
    } // NEW
    const started = performance.now(), result = reduceCommunity(all, communityHash(genesis), proofs), elapsed = performance.now() - started; // NEW
    assert.equal(result.gardens.length, 100); assert.equal(result.members.size, 300); assert.equal(result.rejected.length, 0); assert.ok(elapsed < 10000, 'Directory replay exceeded the 10-second regression bound.'); t.diagnostic('100 gardens / 300 identities: directory replay ' + elapsed.toFixed(0) + ' ms'); // NEW
    await Promise.all(all.map(r => fs.writeFile(path.join(base, 'records', r.payload.id + '.json'), JSON.stringify(r)))); await Promise.all(proofs.map(r => fs.writeFile(path.join(base, 'evidence', communityHash(r) + '.json'), JSON.stringify(r)))); // NEW
    await fs.writeFile(path.join(base, 'records', 'corrupt.json'), '{'); await fs.mkdir(path.join(base, 'records', 'directory.json')); // NEW
    assert.equal((await f.communities.list()).communities[0].gardens.length, 100); const browsing = performance.now(); // NEW
    for (let i = 0; i < 5; i++) assert.equal((await f.communities.list()).communities[0].gardens.length, 100); // NEW
    const average = (performance.now() - browsing) / 5; t.diagnostic('Validated cached listing average: ' + average.toFixed(0) + ' ms'); assert.ok(average < 1000, 'Cached browsing exceeded its one-second regression bound.'); t.diagnostic('Cached listing average: ' + average.toFixed(0) + ' ms'); // NEW
    const configured = performance.now(), devices = [...result.members].map((_, i) => 'benchmark-device-' + i), channel = { kind: 'community', id: created.communityId, directory: base, devices }; // NEW
    await f.daemon.configureMetadataChannel(channel); const puts = f.logs.filter(l => l.endpoint === 'config' && l.method === 'PUT').length; // NEW
    await f.daemon.configureMetadataChannel(channel); assert.equal(f.logs.filter(l => l.endpoint === 'config' && l.method === 'PUT').length, puts); // NEW
    assert.equal(f.configs.get(f.identityId)().folders.find(c => c.id === 'trellis-community-' + created.communityId).devices.length, 300); t.diagnostic('300-peer channel configuration and unchanged retry: ' + (performance.now() - configured).toFixed(0) + ' ms'); // NEW
}); // NEW
