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
import { inspectDiagram, digest } from '../src/main/trellis-share-protocol.js';
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
    await f.library.rename({ diagramId: created.entry.diagramId, name: 'Renamed' });
    assert.equal((await f.library.list()).gardens[0].path, created.path);
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
    document.getElementsByTagName('object')[0].setAttribute('trellis_users_json', JSON.stringify(parsed.store)); await fs.writeFile(created.path, parsed.document.serialize()); // NEW
    await f.library.setReferenceCity({ cityId: 'city' }); // NEW
    let project = (await f.library.list()).gardens[0]; assert.equal(project.classification, 'shared'); assert.equal(project.userCount, 2); assert.equal(project.distanceKm, 0); // NEW
    await fs.unlink(created.path); project = (await f.library.list()).gardens[0]; // NEW
    assert.equal(project.classification, 'shared'); assert.equal(project.userCount, 2); assert.equal(project.metadataStale, true); assert.equal(project.moduleCities.length, 1); // NEW
    parsed.store.users[1].disabled = true; document.getElementsByTagName('object')[0].setAttribute('trellis_users_json', JSON.stringify(parsed.store)); await fs.writeFile(created.path, parsed.document.serialize()); // NEW
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
    await fs.writeFile(created.path, parsed.document.serialize()); await f.library.setReferenceCity({ cityId: 'city' }); assert.equal((await f.library.list()).gardens[0].distanceKm, 0); // NEW
    catalog = []; const cached = (await f.library.list()).gardens[0]; assert.equal(cached.moduleCities[0].name, 'Known city'); assert.equal(cached.metadataStale, true); assert.equal(cached.distanceKm, 0); // NEW
    parsed.store.users[0].disabled = true; document.getElementsByTagName('object')[0].setAttribute('trellis_users_json', JSON.stringify(parsed.store)); await fs.writeFile(created.path, parsed.document.serialize()); // NEW
    assert.equal((await f.library.list()).gardens.length, 0); // NEW
}); // NEW

test('starter completion survives later empty saves and verifies the registered saved project', async t => { // NEW
    const f = await fixture(t), created = await f.library.create({ name: 'Starter lifecycle' }); // NEW
    assert.equal((await f.library.list()).gardens[0].starterPending, true); // NEW
    await assert.rejects(f.library.completeStarter({ path: created.path }), /Save the starter garden/); // NEW
    const xml = await fs.readFile(created.path, 'utf8'); // NEW
    await fs.writeFile(created.path, xml.replace('</root>', '<object id="garden" garden_module="1"><mxCell parent="1" vertex="1"/></object></root>')); // NEW
    const copy = path.join(f.root, 'copy.drawio'); await fs.copyFile(created.path, copy); // NEW
    await assert.rejects(f.library.completeStarter({ path: copy }), /registered garden project/); // NEW
    await f.library.completeStarter({ path: created.path }); assert.equal((await f.library.getEntry(created.entry.diagramId)).starterPending, false); // NEW
    await fs.writeFile(created.path, xml); assert.equal((await f.library.list()).gardens[0].starterPending, false); // NEW
    let folder = path.join(f.root, 'copies'); await fs.mkdir(folder); await fs.copyFile(created.path, path.join(folder, 'Copy.drawio')); // NEW
    const localLibrary = createGardenLibraryService({ identities: f.identities, legacyService: f.legacyService, getLocalFolder: () => folder }); // NEW
    assert.equal((await localLibrary.listLocal()).gardens[0].diagramId, created.entry.diagramId); // NEW
}); // NEW
