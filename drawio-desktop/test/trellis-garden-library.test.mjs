// NEW: Managed-library orchestration against the real file service and isolated REST transport.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { createIdentityService } from '../src/main/trellis-identity-service.js';
import { createGardenLibraryService } from '../src/main/trellis-garden-library-service.js';
import { createSyncthingService } from '../src/main/trellis-syncthing-service.js';
import { inspectDiagram, diagramDocument, digest } from '../src/main/trellis-share-protocol.js'; // CHANGE
async function fixture(t, options = {}) { // CHANGE
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'trellis-library-'));
    const binaries = path.join(root, 'binaries', 'win32-x64'); await fs.mkdir(binaries, { recursive: true });
    await fs.writeFile(path.join(binaries, 'syncthing.exe'), 'fake'); await fs.writeFile(path.join(binaries, 'manifest.json'), JSON.stringify({ version: '2.1.6', platform: 'win32', arch: 'x64', binarySha256: digest('fake') }));
    const services = new Map(), logs = [];
    async function makeTransport(identityId, profileRoot) {
        if (services.has(identityId)) return services.get(identityId);
        const profilePath = path.join(profileRoot, 'transport'); await fs.mkdir(path.join(profilePath, 'syncthing'), { recursive: true });
        await fs.writeFile(path.join(profilePath, 'syncthing', 'config.xml'), '<configuration version="37"/>');
        let config = { folders: [], devices: [], defaults: { folder: {}, device: {} }, options: {} }, child;
        const service = createSyncthingService({ profilePath, userDataPath: profileRoot, documentsPath: root, canvasesRoot: path.join(root, 'gardens', identityId), binaryRoot: path.dirname(binaries), platform: 'win32', arch: 'x64', setStartup: async () => {}, spawn() { child = new EventEmitter(); child.kill = () => child.emit('exit', 0); return child; }, fetch: async (url, args) => {
            const endpoint = new URL(url).pathname.slice(6); logs.push({ identityId, endpoint, method: args.method }); let result = {};
            if (endpoint === 'system/status') result = { myID: 'A'.repeat(56) + '-device' };
            else if (endpoint === 'config') { if (args.method === 'PUT') config = JSON.parse(args.body); else result = structuredClone(config); }
            else if (endpoint.startsWith('config/folders/') && args.method === 'DELETE') config.folders = config.folders.filter(folder => folder.id !== decodeURIComponent(endpoint.slice(15)));
            else if (endpoint === 'system/shutdown') child.emit('exit', 0);
            return { ok: true, text: async () => JSON.stringify(result) };
        } });
        services.set(identityId, service); return service;
    }
    const identities = createIdentityService({ root: path.join(root, 'identities'), transportFactory: makeTransport, adoptTransport: async () => {}, protectPending: text => text, unprotectPending: text => text });
    const legacyService = () => makeTransport('legacy', path.join(root, 'legacy'));
    const library = createGardenLibraryService({ identities, legacyService, ...options }); // CHANGE
    t.after(async () => { for (const service of services.values()) await service.stop(); await fs.rm(root, { recursive: true, force: true }); });
    await identities.create({ username: 'Alice', password: 'library-password' });
    return { root, identities, library, logs, services, legacyService, makeTransport }; // CHANGE
}

/** Write fixtures through the signed v2 journal rather than changing its disposable projection. */ // NEW
async function saveProject(f, created, xml) { // NEW
    const service = await f.identities.transport(f.identities.session().identityId); // NEW
    service.setContext('fixture-save', { diagramPath: created.path, diagramId: created.entry.diagramId, userId: created.entry.workerId }); // NEW
    const result = await service.collaborationAction('fixture-save', { shareId: created.entry.shareId, kind: 'save', baseXml: await fs.readFile(created.path, 'utf8').catch(async error => { if (error.code !== 'ENOENT') throw error; await service.collaborationAction('fixture-save', { shareId: created.entry.shareId, kind: 'get' }); return fs.readFile(created.path, 'utf8'); }), xml }); // NEW
    assert.equal(result.ok, true, result.reason); // NEW
    const released = await service.collaborationAction('fixture-save', { shareId: created.entry.shareId, kind: 'release' }).catch(() => null); if (released) assert.equal(released.collaboration.holds.length, 0, JSON.stringify(released.collaboration)); // CHANGE
} // NEW
test('shared names and personal filenames preserve identity while suffixes stay outside shared descriptors', async t => { // NEW
    const f = await fixture(t), created = await f.library.create({ name: 'Community/Garden' }), id = created.entry.diagramId; // NEW
    assert.equal(path.basename(created.path), 'Community-Garden.drawio'); assert.equal(created.entry.protocolVersion, 2); // NEW
    const personalized = await f.library.setSuffix({ diagramId: id, suffix: 'Volunteer: west' }); // NEW
    assert.equal(personalized.name, 'Community/Garden - Volunteer: west'); assert.equal(personalized.filename, 'Community-Garden - Volunteer- west.drawio'); // NEW
    const service = await f.identities.transport(f.identities.session().identityId), descriptor = await service.libraryDescriptor(created.entry.shareId); // NEW
    assert.equal(descriptor.filename, 'Garden.drawio'); assert.ok(!JSON.stringify(descriptor).includes('Volunteer')); // NEW
    const before = await fs.readFile(personalized.path, 'utf8'); assert.ok(!before.includes('Volunteer')); assert.ok(before.includes(id)); // NEW
    await service.stop(); const renamed = await f.library.rename({ diagramId: id, name: 'New Garden' }); // NEW
    assert.equal(renamed.filename, 'New Garden - Volunteer- west.drawio'); assert.equal(renamed.suffix, 'Volunteer: west'); await assert.rejects(fs.access(personalized.path)); // NEW
    assert.equal((await f.library.list()).gardens[0].diagramId, id); assert.equal((await f.library.getEntry(id)).shareId, created.entry.shareId); // NEW
    const copy = await f.library.duplicate({ diagramId: id }); assert.equal(copy.entry.name, 'New Garden copy'); assert.notEqual(copy.entry.diagramId, id); // NEW
    const restoredController = createGardenLibraryService({ identities: f.identities, legacyService: f.legacyService }); // NEW
    assert.equal((await restoredController.list()).gardens.find(row => row.diagramId === id).suffix, 'Volunteer: west'); // NEW
    const cleared = await f.library.setSuffix({ diagramId: id, suffix: '' }); assert.equal(cleared.filename, 'New Garden.drawio'); // NEW
}); // NEW
test('forged rename actor fields cannot elevate a regular identity-linked member', async t => { // NEW
    const f = await fixture(t), created = await f.library.create({ name: 'Protected' }), state = inspectDiagram(await fs.readFile(created.path, 'utf8')); // NEW
    state.store.users[0].admin = false; state.store.users.push({ id: 'other-admin', admin: true }); // NEW
    for (const cell of state.cells) if (cell.node.hasAttribute('trellis_users_json')) { cell.node.setAttribute('trellis_users_json', JSON.stringify(state.store)); cell.node.setAttribute('trellis_access_open', '1'); } // NEW
    await saveProject(f, created, state.document.serialize()); // NEW
    await assert.rejects(f.library.rename({ diagramId: created.entry.diagramId, name: 'Forged', userId: 'other-admin', identityId: 'other' }), /administrator/); // NEW
    const personalized = await f.library.setSuffix({ diagramId: created.entry.diagramId, suffix: 'Gardener' }); assert.equal(personalized.projectName, 'Protected'); assert.equal(personalized.canRename, false); // NEW
}); // NEW
test('suffix metadata is signed, identity-isolated, and survives Trash and restore', async t => { // NEW
    const f = await fixture(t), created = await f.library.create({ name: 'Identity garden' }), session = f.identities.session(); // NEW
    const result = await f.library.setSuffix({ diagramId: created.entry.diagramId, suffix: 'My role' }); // NEW
    const records = await f.library.verifiedRecords(session.identityId, path.join(f.identities.metadataRoot(session.identityId), 'project-suffixes')); // NEW
    assert.equal(records.at(-1).payload.suffix, 'My role'); // NEW
    await f.library.trash({ diagramId: created.entry.diagramId, confirm: true }); const trash = (await f.library.listTrash()).gardens[0]; // NEW
    await f.library.restore({ diagramId: created.entry.diagramId, trashId: trash.trashId }); const restored = (await f.library.list()).gardens[0]; // NEW
    assert.equal(restored.path, result.path); assert.equal(restored.suffix, 'My role'); // NEW
    await f.identities.lock(); await f.identities.create({ username: 'Other identity', password: 'other-identity-password' }); const other = await f.library.create({ name: 'Identity garden' }); // NEW
    assert.equal((await f.library.list()).gardens[0].suffix, ''); assert.notEqual(other.path, restored.path); // NEW
}); // NEW
test('paired identity metadata carries suffix changes between controllers without changing the shared name', async t => { // NEW
    const f = await fixture(t), created = await f.library.create({ name: 'Paired garden' }); // NEW
    await f.library.setSuffix({ diagramId: created.entry.diagramId, suffix: 'My role' }); // NEW
    const peer = createIdentityService({ root: path.join(f.root, 'naming-peer'), transportFactory: f.makeTransport, adoptTransport: async () => {}, protectPending: text => text, unprotectPending: text => text }); // NEW
    const request = await peer.createPairRequest({ deviceName: 'Naming peer' }), approved = await f.identities.approvePairRequest({ request: request.request }); // NEW
    await peer.importSetup({ setup: approved.setup, password: 'library-password' }); const identityId = f.identities.session().identityId; // NEW
    await peer.unlock({ identityId, password: 'library-password' }); await fs.cp(f.identities.metadataRoot(identityId), peer.metadataRoot(identityId), { recursive: true }); // NEW
    const peerLibrary = createGardenLibraryService({ identities: peer, legacyService: f.legacyService }); // NEW
    assert.equal((await peerLibrary.list()).gardens[0].suffix, 'My role'); // NEW
    await peerLibrary.setSuffix({ diagramId: created.entry.diagramId, suffix: 'Updated role' }); // NEW
    await fs.cp(peer.metadataRoot(identityId), f.identities.metadataRoot(identityId), { recursive: true }); // NEW
    const local = (await f.library.list()).gardens[0]; assert.equal(local.suffix, 'Updated role'); assert.equal(local.projectName, 'Paired garden'); assert.equal(local.filename, 'Paired garden - Updated role.drawio'); // NEW
}); // NEW
test('v1 naming is gated until the existing upgrade adopts the current library name without another prompt', async t => { // NEW
    const f = await fixture(t), seed = await f.library.create({ name: 'Seed' }), service = await f.identities.transport(f.identities.session().identityId), diagramId = crypto.randomUUID(); // NEW
    const document = diagramDocument(await fs.readFile(seed.path, 'utf8')); // NEW
    for (const page of document.pages) for (const node of Array.from(page.doc.getElementsByTagName('*'))) { // NEW
        if (node.hasAttribute('trellis_history_id')) node.setAttribute('trellis_history_id', diagramId); // NEW
        if (node.hasAttribute('trellis_users_diagram_id')) node.setAttribute('trellis_users_diagram_id', diagramId); // NEW
        node.removeAttribute('trellis_project_name'); // NEW
    } // NEW
    service.setContext(42, { diagramId, userId: seed.entry.workerId }); // NEW
    const old = await service.setupCanvas(42, { diagramId, xml: document.serialize(), filename: 'Existing project.drawio', protocolVersion: 1 }); // NEW
    await f.library.importCurrent({ path: old.diagramPath, diagramId, userId: seed.entry.workerId }); // NEW
    await assert.rejects(f.library.rename({ diagramId, name: 'Too early' }), /upgrade/); await assert.rejects(f.library.setSuffix({ diagramId, suffix: 'Too early' }), /upgrade/); // NEW
    const upgraded = await service.upgradeCollaboration(42, { shareId: old.shareId }); // NEW
    const adopted = (await f.library.list()).gardens.find(row => row.diagramId === diagramId); // NEW
    assert.equal(adopted.projectName, 'Existing project'); assert.equal(adopted.suffix, ''); assert.equal(adopted.requiresNamingUpgrade, false); assert.equal((await f.library.getEntry(diagramId)).shareId, upgraded.shareId); // NEW
    const renamed = await f.library.setSuffix({ diagramId, suffix: 'Coordinator' }); assert.equal(renamed.filename, 'Existing project - Coordinator.drawio'); // NEW
}); // NEW
test('object collaboration migration retains the identity library worker and follows the new local project', async t => { // NEW
    const f = await fixture(t), created = await f.library.create({ name: 'Community' }); // NEW
    const service = await f.identities.transport(f.identities.session().identityId); // NEW
    service.setContext(10, { diagramPath: created.path, diagramId: created.entry.diagramId, userId: created.entry.workerId }); // NEW
    const upgraded = await service.upgradeCollaboration(10, { shareId: created.entry.shareId }); // NEW
    const row = (await f.library.list()).gardens.find(g => g.diagramId === created.entry.diagramId); // NEW
    assert.equal(row.path, upgraded.diagramPath); assert.equal(row.workerId, created.entry.workerId); assert.equal(row.name, 'Community'); // NEW
    assert.equal((await f.library.getEntry(created.entry.diagramId)).shareId, upgraded.shareId); // NEW
}); // NEW
test('creation, rename, duplication and local deletion retain stable catalog identities', async t => {
    const f = await fixture(t), created = await f.library.create({ name: 'Kitchen garden' });
    assert.equal((await f.library.list()).gardens[0].available, true);
    const renamed = await f.library.rename({ diagramId: created.entry.diagramId, name: 'Renamed' }); // CHANGE
    assert.equal(path.basename(renamed.path), 'Renamed.drawio'); assert.notEqual(renamed.path, created.path); created.path = renamed.path; // CHANGE
    const copy = await f.library.duplicate({ diagramId: created.entry.diagramId });
    assert.notEqual(copy.entry.diagramId, created.entry.diagramId); assert.notEqual(copy.entry.shareId, created.entry.shareId);
    await assert.rejects(f.library.removeLocal({ diagramId: created.entry.diagramId }), /Confirm/);
    await f.library.removeLocal({ diagramId: created.entry.diagramId, confirmLoss: true });
    await assert.rejects(fs.access(created.path));
    assert.equal((await f.library.list()).gardens.length, 2);
    assert.equal((await f.library.list()).gardens.find(g => g.diagramId === created.entry.diagramId).available, false);
    assert.equal(await fs.readFile(copy.path, 'utf8').then(() => true), true);
    assert.ok(f.logs.some(log => log.endpoint.startsWith('config/folders/') && log.method === 'DELETE'));
});
test('registry listing works stopped, and source changes/missing assets preserve the original', async t => {
    const f = await fixture(t), created = await f.library.create({ name: 'Garden' });
    const service = await f.identities.transport(f.identities.session().identityId); await service.stop();
    const before = f.logs.filter(log => log.endpoint === 'system/status').length;
    assert.equal((await service.listCanvases())[0].available, true);
    assert.equal(f.logs.filter(log => log.endpoint === 'system/status').length, before);
    const userId = created.entry.workerId, identityId = f.identities.session().identityId, diagramId = crypto.randomUUID();
    const source = path.join(f.root, 'original.drawio');
    const store = JSON.stringify({ usersEnabled: true, users: [{ id: userId, name: 'Alice', admin: true, portableIdentityId: identityId }] }).replace(/"/g, '&quot;');
    const xml = '<mxGraphModel><root><mxCell id="0"/><object id="1" trellis_users_diagram_id="' + diagramId + '" trellis_users_json="' + store + '"><mxCell parent="0"/></object><object id="asset"><mxCell parent="1" vertex="1" style="image=missing.png;"/></object></root></mxGraphModel>';
    await fs.writeFile(source, xml);
    await assert.rejects(f.library.importCurrent({ path: source, diagramId, userId }), /missing/);
    assert.equal(await fs.readFile(source, 'utf8'), xml);
    assert.equal((await f.library.list()).gardens.length, 1);
});

test('local listing is signed-out, direct-folder only, isolates bad diagrams and ignores conflict copies', async t => { // NEW
    let folder; // NEW
    const f = await fixture(t, { getLocalFolder: () => folder, setLocalFolder: value => { folder = value; } }); // NEW
    folder = path.join(f.root, 'local'); await fs.mkdir(path.join(folder, 'nested'), { recursive: true }); // NEW
    await fs.writeFile(path.join(folder, 'Valid.drawio'), '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel>'); // NEW
    await fs.writeFile(path.join(folder, 'Broken.drawio'), '<broken/>'); // NEW
    await fs.writeFile(path.join(folder, 'Valid.sync-conflict-copy.drawio'), '<broken/>'); // NEW
    await fs.writeFile(path.join(folder, 'nested', 'Hidden.drawio'), '<broken/>'); // NEW
    await f.identities.lock(); // NEW
    const local = await f.library.listLocal(); assert.deepEqual(local.gardens.map(garden => garden.name), ['Broken', 'Valid']); // NEW
    assert.equal(local.gardens[0].available, false); assert.equal(local.gardens[1].classification, 'private'); // NEW
    await f.library.configureLocalFolder(path.join(folder, 'nested')); assert.equal((await f.library.listLocal()).gardens[0].name, 'Hidden'); // NEW
}); // NEW
test('summaries reclassify joined users, persist locations, and retain details after local removal', async t => { // NEW
    const city = { city_id: 'city', city_name: 'Origin', latitude: 0, longitude: 0 }; // NEW
    const f = await fixture(t, { listCities: async () => [city] }), created = await f.library.create({ name: 'Shared fixture' }); // NEW
    const parsed = inspectDiagram(await fs.readFile(created.path, 'utf8')); parsed.store.users.push({ id: 'joined', admin: true }); // NEW
    const document = parsed.document.pages[0].doc, root = document.getElementsByTagName('root')[0], module = document.createElement('object'), cell = document.createElement('mxCell'); // NEW
    module.setAttribute('id', 'garden'); module.setAttribute('garden_module', '1'); module.setAttribute('city_id', 'city'); cell.setAttribute('parent', '1'); cell.setAttribute('vertex', '1'); module.appendChild(cell); root.appendChild(module); // NEW
    document.getElementsByTagName('object')[0].setAttribute('trellis_users_json', JSON.stringify(parsed.store)); await saveProject(f, created, parsed.document.serialize()); // NEW
    await f.library.setReferenceCity({ cityId: 'city' }); // NEW
    let project = (await f.library.list()).gardens[0]; assert.equal(project.classification, 'shared'); assert.equal(project.userCount, 2); assert.equal(project.distanceKm, 0); // NEW
    await fs.unlink(created.path); project = (await f.library.list()).gardens[0]; // NEW
    assert.equal(project.classification, 'shared'); assert.equal(project.userCount, 2); assert.equal(project.metadataStale, true); assert.equal(project.moduleCities.length, 1); // NEW
    parsed.store.users[1].disabled = true; document.getElementsByTagName('object')[0].setAttribute('trellis_users_json', JSON.stringify(parsed.store)); await saveProject(f, created, parsed.document.serialize()); // NEW
    project = (await f.library.list()).gardens[0]; assert.equal(project.classification, 'private'); assert.equal(project.path, created.path); // NEW
}); // NEW
test('reference cities are signed, persist across controller recreation, and reach a paired identity through metadata', async t => { // NEW
    const city = { city_id: 'city', city_name: 'Origin', latitude: 0, longitude: 0 }; // NEW
    const f = await fixture(t, { listCities: async () => [city] }); await f.library.setReferenceCity({ cityId: 'city' }); // NEW
    const peer = createIdentityService({ root: path.join(f.root, 'peer'), transportFactory: f.makeTransport, adoptTransport: async () => {}, protectPending: text => text, unprotectPending: text => text }); // NEW
    const request = await peer.createPairRequest({ deviceName: 'Peer' }), approved = await f.identities.approvePairRequest({ request: request.request }); // NEW
    await peer.importSetup({ setup: approved.setup, password: 'library-password' }); const identityId = f.identities.session().identityId; // NEW
    await peer.unlock({ identityId, password: 'library-password' }); // NEW
    await fs.cp(f.identities.metadataRoot(identityId), peer.metadataRoot(identityId), { recursive: true }); // NEW
    const peerLibrary = createGardenLibraryService({ identities: peer, legacyService: f.legacyService, listCities: async () => [city] }); // NEW
    assert.equal((await peerLibrary.getReferenceCity()).city.cityId, 'city'); // NEW
    await assert.rejects(peerLibrary.setReferenceCity({ cityId: 'missing' }), /usable coordinates/); // NEW
    await peerLibrary.setReferenceCity({ cityId: null }); assert.equal((await peerLibrary.getReferenceCity()).city, null); // NEW
}); // NEW

test('an unverifiable catalog record cannot hide valid projects and strict mutation reads still reject it', async t => { // NEW
    const f = await fixture(t), created = await f.library.create({ name: 'Valid project' }); // NEW
    const directory = path.join(f.identities.metadataRoot(f.identities.session().identityId), 'catalog'); // NEW
    await fs.writeFile(path.join(directory, 'tampered.json'), '{invalid'); // NEW
    const malformed = await f.identities.signAction('garden-record', { entry: { diagramId: 'missing-name', shareId: 'missing-name' } }); // NEW
    await fs.writeFile(path.join(directory, malformed.payload.id + '.json'), JSON.stringify(malformed)); // NEW
    const result = await f.library.list(); assert.equal(result.gardens[0].diagramId, created.entry.diagramId); assert.equal(result.errors.length, 2); // CHANGE // NEW
    await assert.rejects(f.library.catalog(f.identities.session().identityId)); // NEW
}); // NEW

test('signed location snapshots survive a missing city catalog and revoked project access removes the row', async t => { // NEW
    let catalog = [{ city_id: 'city', city_name: 'Known city', latitude: 0, longitude: 0 }]; // NEW
    const f = await fixture(t, { listCities: async () => catalog }), created = await f.library.create({ name: 'Cached geography' }); // NEW
    const parsed = inspectDiagram(await fs.readFile(created.path, 'utf8')), document = parsed.document.pages[0].doc; // NEW
    const module = document.createElement('object'), cell = document.createElement('mxCell'); module.setAttribute('id', 'garden'); module.setAttribute('garden_module', '1'); module.setAttribute('city_id', 'city'); cell.setAttribute('parent', '1'); module.appendChild(cell); document.getElementsByTagName('root')[0].appendChild(module); // NEW
    await saveProject(f, created, parsed.document.serialize()); await f.library.setReferenceCity({ cityId: 'city' }); assert.equal((await f.library.list()).gardens[0].distanceKm, 0); // NEW
    catalog = []; const cached = (await f.library.list()).gardens[0]; assert.equal(cached.moduleCities[0].name, 'Known city'); assert.equal(cached.metadataStale, true); assert.equal(cached.distanceKm, 0); // NEW
    parsed.store.users[0].disabled = true; document.getElementsByTagName('object')[0].setAttribute('trellis_users_json', JSON.stringify(parsed.store)); await saveProject(f, created, parsed.document.serialize()); // NEW
    assert.equal((await f.library.list()).gardens.length, 0); // NEW
}); // NEW

test('starter completion survives later empty saves and verifies the registered saved project', async t => { // NEW
    const f = await fixture(t), created = await f.library.create({ name: 'Starter lifecycle' }); // NEW
    assert.equal((await f.library.list()).gardens[0].starterPending, true); // NEW
    await assert.rejects(f.library.completeStarter({ path: created.path }), /Save the starter garden/); // NEW
    const xml = await fs.readFile(created.path, 'utf8'); // NEW
    await saveProject(f, created, xml.replace('</root>', '<object id="garden" garden_module="1"><mxCell parent="1" vertex="1"/></object></root>')); // NEW
    const copy = path.join(f.root, 'copy.drawio'); await fs.copyFile(created.path, copy); // NEW
    await assert.rejects(f.library.completeStarter({ path: copy }), /registered garden project/); // NEW
    await f.library.completeStarter({ path: created.path }); assert.equal((await f.library.getEntry(created.entry.diagramId)).starterPending, false); // NEW
    await saveProject(f, created, xml); assert.equal((await f.library.list()).gardens[0].starterPending, false); // NEW
    let folder = path.join(f.root, 'copies'); await fs.mkdir(folder); await fs.copyFile(created.path, path.join(folder, 'Copy.drawio')); // NEW
    const localLibrary = createGardenLibraryService({ identities: f.identities, legacyService: f.legacyService, getLocalFolder: () => folder }); // NEW
    assert.equal((await localLibrary.listLocal()).gardens[0].diagramId, created.entry.diagramId); // NEW
}); // NEW

/** Project retirement uses the real managed service and signed catalog. */ // NEW
test('Trash removes the row, cancels invitations, restores the same project, and supports a second deletion', async t => { // NEW
    const f = await fixture(t), created = await f.library.create({ name: 'Retain me' }); // NEW
    const parsed = inspectDiagram(await fs.readFile(created.path, 'utf8')); // NEW
    parsed.store.invites.push({ id: 'pending', status: 'pending', pendingUserId: 'invited', expiresAt: Date.now() + 86400000 }); // NEW
    for (const cell of parsed.cells) if (cell.node.hasAttribute('trellis_users_json')) cell.node.setAttribute('trellis_users_json', JSON.stringify(parsed.store)); // NEW
    await saveProject(f, created, parsed.document.serialize()); // NEW
    await assert.rejects(f.library.trash({ diagramId: created.entry.diagramId }), /Confirm/); // NEW
    await f.library.trash({ diagramId: created.entry.diagramId, confirm: true }); // NEW
    assert.equal((await f.library.list()).gardens.length, 0); assert.equal(await fs.access(created.path).then(() => true, () => false), false, JSON.stringify(await f.library.listTrash())); // CHANGE
    await assert.rejects(f.library.download({ diagramId: created.entry.diagramId }), /retired/); // NEW
    await assert.rejects(f.library.rename({ diagramId: created.entry.diagramId, name: 'Resurrection' }), /retired/); // NEW
    const trash = (await f.library.listTrash()).gardens; assert.equal(trash.length, 1); // NEW
    await f.library.restore({ diagramId: created.entry.diagramId, trashId: trash[0].trashId }); // NEW
    assert.equal((await f.library.list()).gardens[0].diagramId, created.entry.diagramId); // NEW
    assert.equal(inspectDiagram(await fs.readFile(created.path, 'utf8')).store.invites[0].status, 'revoked'); // NEW
    await f.library.trash({ diagramId: created.entry.diagramId, confirm: true }); // NEW
    await assert.rejects(fs.access(created.path)); assert.equal((await f.library.listTrash()).gardens.length, 1); // NEW
}); // NEW

test('purge persists a terminal record and stale catalog/download records cannot resurrect the project', async t => { // NEW
    const f = await fixture(t), created = await f.library.create({ name: 'Purge me' }), input = { diagramId: created.entry.diagramId, confirm: true }; // NEW
    await f.library.trash(input); const trash = (await f.library.listTrash()).gardens[0]; // NEW
    await f.library.purge({ ...input, trashId: trash.trashId }); // NEW
    assert.equal((await f.library.listTrash()).gardens.length, 0); assert.equal((await f.library.list()).gardens.length, 0); // NEW
    await f.library.processDownloads(f.identities.session().identityId); // NEW
    await assert.rejects(f.library.restore({ ...input, trashId: trash.trashId }), /Trash changed/); // NEW
    const service = await f.identities.transport(f.identities.session().identityId); // NEW
    await assert.rejects(service.registerLibraryDownload(created.entry), /Restore/); // NEW
    assert.equal((await f.library.catalog(f.identities.session().identityId)).length, 1); // NEW
}); // NEW

test('a project without a download can enter Trash and restore its unavailable library entry', async t => { // NEW
    const f = await fixture(t), created = await f.library.create({ name: 'No download' }); // NEW
    await f.library.removeLocal({ diagramId: created.entry.diagramId, confirmLoss: true }); // NEW
    await f.library.trash({ diagramId: created.entry.diagramId, confirm: true }); // NEW
    const trash = (await f.library.listTrash()).gardens[0]; assert.match(trash.reason, /unavailable|Waiting/); // NEW
    await f.library.restore({ diagramId: created.entry.diagramId, trashId: trash.trashId }); // NEW
    assert.equal((await f.library.list()).gardens[0].available, false); // NEW
}); // NEW

test('stale sole-user metadata cannot delete another member’s project', async t => { // NEW
    const f = await fixture(t), created = await f.library.create({ name: 'Membership changed' }); // NEW
    const parsed = inspectDiagram(await fs.readFile(created.path, 'utf8')); parsed.store.users.push({ id: 'other', admin: true }); // NEW
    for (const cell of parsed.cells) if (cell.node.hasAttribute('trellis_users_json')) cell.node.setAttribute('trellis_users_json', JSON.stringify(parsed.store)); // NEW
    await saveProject(f, created, parsed.document.serialize()); // NEW
    await assert.rejects(f.library.trash({ diagramId: created.entry.diagramId, confirm: true }), /sole|Leave|connect/i); // NEW
    assert.equal((await f.library.list()).gardens.length, 1); assert.equal((await f.library.listTrash()).gardens.length, 0); // NEW
}); // NEW

test('standalone Trash is signed-out, preserves neighboring assets, and never overwrites a restore collision', async t => { // NEW
    let folder; const f = await fixture(t, { getLocalFolder: () => folder }); // NEW
    folder = path.join(f.root, 'local-files'); await fs.mkdir(folder); // NEW
    const filename = path.join(folder, 'Local.drawio'); await fs.writeFile(filename, '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel>'); // NEW
    await fs.writeFile(path.join(folder, 'asset.png'), 'neighbor'); await f.identities.lock(); // NEW
    await f.library.trash({ source: 'local', path: filename, confirm: true }); // NEW
    assert.equal((await f.library.listLocal()).gardens.length, 0); assert.equal(await fs.readFile(path.join(folder, 'asset.png'), 'utf8'), 'neighbor'); // NEW
    const trash = (await f.library.listTrash()).gardens[0]; await fs.writeFile(filename, 'unrelated'); // NEW
    await assert.rejects(f.library.restore({ source: 'local', trashId: trash.trashId }), /already exists/); // NEW
    assert.equal(await fs.readFile(filename, 'utf8'), 'unrelated'); // NEW
    await f.library.restore({ source: 'local', trashId: trash.trashId, filename: 'Restored.drawio' }); // NEW
    assert.match(await fs.readFile(path.join(folder, 'Restored.drawio'), 'utf8'), /mxGraphModel/); // NEW
    await assert.rejects(f.library.trash({ source: 'local', path: path.join(f.root, 'outside.drawio'), confirm: true }), /configured/); // NEW
    assert.equal((await f.library.listTrash()).gardens.length, 0); // NEW
}); // NEW

test('paired lifecycle metadata converges and keeps late catalog updates out of the active list', async t => { // NEW
    const f = await fixture(t), created = await f.library.create({ name: 'Paired deletion' }); // NEW
    const peer = createIdentityService({ root: path.join(f.root, 'peer-trash'), transportFactory: f.makeTransport, adoptTransport: async () => {}, protectPending: text => text, unprotectPending: text => text }); // NEW
    const request = await peer.createPairRequest({ deviceName: 'Peer' }), approved = await f.identities.approvePairRequest({ request: request.request }); // NEW
    await peer.importSetup({ setup: approved.setup, password: 'library-password' }); const identityId = f.identities.session().identityId; await peer.unlock({ identityId, password: 'library-password' }); // NEW
    await f.library.trash({ diagramId: created.entry.diagramId, confirm: true }); // NEW
    await fs.cp(f.identities.metadataRoot(identityId), peer.metadataRoot(identityId), { recursive: true }); // NEW
    const peerLibrary = createGardenLibraryService({ identities: peer, legacyService: f.legacyService, getTrashRoot: () => path.join(f.root, 'unused-trash') }); // NEW
    assert.equal((await peerLibrary.list()).gardens.length, 0); const trash = (await peerLibrary.listTrash()).gardens[0]; // NEW
    await peerLibrary.restore({ diagramId: created.entry.diagramId, trashId: trash.trashId }); // NEW
    await fs.cp(peer.metadataRoot(identityId), f.identities.metadataRoot(identityId), { recursive: true }); // NEW
    assert.equal((await f.library.list()).gardens[0].diagramId, created.entry.diagramId); // NEW
}); // NEW
