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
import { referenceCore as references } from '../src/main/trellis-reference-database.js'; // NEW
async function fixture(t, options = {}) { // CHANGE
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'trellis-library-'));
    const binaries = path.join(root, 'binaries', 'win32-x64'); await fs.mkdir(binaries, { recursive: true });
    await fs.writeFile(path.join(binaries, 'syncthing.exe'), 'fake'); await fs.writeFile(path.join(binaries, 'manifest.json'), JSON.stringify({ version: '2.1.6', platform: 'win32', arch: 'x64', binarySha256: digest('fake') }));
    const services = new Map(), logs = [];
    async function makeTransport(identityId, profileRoot) {
        if (services.has(identityId)) return services.get(identityId);
        const profilePath = path.join(profileRoot, 'transport'); await fs.mkdir(path.join(profilePath, 'syncthing'), { recursive: true });
        await fs.writeFile(path.join(profilePath, 'syncthing', 'config.xml'), '<configuration version="37"/>');
        const canvasesRoot = path.join(root, 'gardens', identityId); // CHANGE
        await options.seedTransport?.({ identityId, profileRoot, profilePath, canvasesRoot }); // CHANGE: load production-format legacy fixtures before the first transport initialization.
        let config = { folders: [], devices: [], defaults: { folder: {}, device: {} }, options: {} }, child;
        const service = createSyncthingService({ profilePath, userDataPath: profileRoot, documentsPath: root, canvasesRoot, binaryRoot: path.dirname(binaries), platform: 'win32', arch: 'x64', setStartup: async () => {}, spawn() { child = new EventEmitter(); child.kill = () => child.emit('exit', 0); return child; }, fetch: async (url, args) => {
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

/** Preserve the historical on-disk registration and ordinary XML while seeding an isolated profile. */ // CHANGE
async function seedOldLibrary({ identityId, profilePath, canvasesRoot }, options = {}) { // CHANGE
    const shareId = options.shareId || 'old-share', diagramId = options.diagramId || 'old-diagram', workerId = 'old-worker', folderPath = path.join(canvasesRoot, shareId); // CHANGE
    const record = { shareId, diagramId, folderId: (options.version === 2 ? 'trellis-v2-' : 'trellis-') + shareId, folderPath, diagramPath: path.join(folderPath, 'Old.drawio'), filename: 'Old.drawio', label: 'Retained garden', localRemoved: !!options.missing }; // CHANGE: v2 fixtures use their historical folder identifier.
    if (options.version !== undefined) record.protocolVersion = options.version; // CHANGE
    const store = JSON.stringify({ usersEnabled: true, users: [{ id: workerId, name: 'Alice', admin: true, portableIdentityId: identityId }], invites: [] }).replace(/"/g, '&quot;'); // CHANGE
    const xml = '<mxGraphModel><root><mxCell id="0"/><object id="1" trellis_history_id="' + diagramId + '" trellis_users_json="' + store + '"><mxCell parent="0"/></object></root></mxGraphModel>'; // CHANGE
    await fs.mkdir(folderPath, { recursive: true }); if (!options.missing) await fs.writeFile(record.diagramPath, xml); // CHANGE
    await fs.writeFile(path.join(profilePath, 'canvases.json'), JSON.stringify([record])); // CHANGE
    return { record, xml, workerId }; // CHANGE
} // CHANGE

for (const version of [undefined, 1, 2]) test('old library protocol ' + version + ' stays hidden across reload and restart while its data and current projects remain intact', async t => { // CHANGE
    let old; const f = await fixture(t, { seedTransport: async paths => { old ||= await seedOldLibrary(paths, { version }); } }); // CHANGE: restarting the transport must read existing data without reseeding it.
    const identityId = f.identities.session().identityId; // CHANGE
    const entry = { name: 'Old signed name', diagramId: old.record.diagramId, shareId: old.record.shareId, workerId: old.workerId, ownerIdentityId: identityId }; // CHANGE
    if (version !== undefined) entry.protocolVersion = version; // CHANGE
    const record = await f.identities.signAction('garden-record', { entry }), directory = path.join(f.identities.metadataRoot(identityId), 'catalog'); // CHANGE
    await fs.mkdir(directory, { recursive: true }); await fs.writeFile(path.join(directory, record.payload.id + '.json'), JSON.stringify(record)); // CHANGE
    const retained = [['assets/retained.png', 'retained asset'], ['.trellis/history/snapshot.xml', old.xml], ['recovery/retained.drawio', old.xml]]; // CHANGE
    for (const [relative, contents] of retained) { const filename = path.join(old.record.folderPath, relative); await fs.mkdir(path.dirname(filename), { recursive: true }); await fs.writeFile(filename, contents); } // CHANGE
    const before = f.logs.length, result = await f.library.list(); // CHANGE
    assert.equal(result.errors.length, 0); assert.deepEqual(result.gardens, []); assert.equal(f.logs.length, before); // CHANGE
    assert.deepEqual((await f.library.list({ diagramId: entry.diagramId })).gardens, []); // CHANGE: targeted reloads must also hide old catalog entries.
    assert.equal((await f.library.catalog(identityId)).length, 0); // CHANGE
    await f.library.processDownloads(identityId); assert.equal(f.logs.length, before); // CHANGE
    await assert.rejects(f.library.download({ diagramId: entry.diagramId }), /Sharing is disabled/); // CHANGE
    await assert.rejects(f.library.rename({ diagramId: entry.diagramId, name: 'Changed' }), /Sharing is disabled/); // CHANGE
    await assert.rejects(f.library.duplicate({ diagramId: entry.diagramId }), /Sharing is disabled/); // CHANGE
    const created = []; for (const name of ['New private', 'New shared', 'New community']) { const project = await f.library.create({ name }); assert.equal(project.entry.protocolVersion, 3); created.push(project.entry.diagramId); } // CHANGE
    assert.deepEqual((await f.library.list()).gardens.map(garden => garden.diagramId).sort(), created.sort()); // CHANGE
    await (await f.identities.transport(identityId)).stop(); f.services.delete(identityId); // CHANGE: recreate identity, transport and library services against the same on-disk profile.
    const restartedIdentities = createIdentityService({ root: path.join(f.root, 'identities'), transportFactory: f.makeTransport, adoptTransport: async () => {}, protectPending: text => text, unprotectPending: text => text }); // CHANGE
    await restartedIdentities.unlock({ identityId, password: 'library-password' }); // CHANGE
    const restartedLibrary = createGardenLibraryService({ identities: restartedIdentities, legacyService: f.legacyService }); // CHANGE
    const restarted = (await restartedLibrary.list()).gardens; assert.deepEqual(restarted.map(garden => garden.diagramId).sort(), created); assert.ok(restarted.every(garden => garden.available)); // CHANGE
    const saved = JSON.parse(await fs.readFile(path.join(f.identities.identityRoot(identityId), 'transport', 'canvases.json'), 'utf8')); // CHANGE
    assert.deepEqual(saved.find(item => item.shareId === old.record.shareId), old.record); assert.equal(await fs.readFile(old.record.diagramPath, 'utf8'), old.xml); // CHANGE
    for (const [relative, contents] of retained) assert.equal(await fs.readFile(path.join(old.record.folderPath, relative), 'utf8'), contents); // CHANGE
    assert.equal(await fs.readFile(path.join(directory, record.payload.id + '.json'), 'utf8'), JSON.stringify(record)); // CHANGE
}); // CHANGE

for (const version of [undefined, 1, 2]) test('old protocol ' + version + ' registrations without a catalog stay hidden whether available or missing', async t => { // CHANGE
    let old; const f = await fixture(t, { seedTransport: async paths => { old = await seedOldLibrary(paths, { version }); } }); // CHANGE
    const listed = await f.library.list(); assert.deepEqual(listed.gardens, []); assert.equal(listed.errors.length, 0); assert.equal(await fs.readFile(old.record.diagramPath, 'utf8'), old.xml); // CHANGE
    await fs.unlink(old.record.diagramPath); assert.equal((await f.library.list()).gardens.length, 0); // CHANGE
    const filename = path.join(f.identities.identityRoot(f.identities.session().identityId), 'transport', 'canvases.json'); // CHANGE
    assert.deepEqual(JSON.parse(await fs.readFile(filename, 'utf8')), [old.record]); // CHANGE
}); // CHANGE

test('application-wide old files stay hidden without scanning or enrolling them into the current identity transport', async t => { // CHANGE
    let old, scans = 0; const f = await fixture(t, { seedTransport: async paths => { if (paths.identityId === 'legacy') old = await seedOldLibrary(paths); }, listLegacyLocalCanvases: async () => { scans++; return (await (await f.legacyService()).listCanvases()).filter(item => item.localOnly); } }); // CHANGE
    await f.legacyService(); assert.deepEqual((await f.library.list()).gardens, []); assert.equal(scans, 0); // CHANGE
    const current = await f.identities.transport(f.identities.session().identityId); assert.equal((await current.listCanvases()).length, 0); // CHANGE
    assert.deepEqual((await f.library.list()).gardens, []); assert.equal(await fs.readFile(old.record.diagramPath, 'utf8'), old.xml); // CHANGE
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(f.root, 'legacy', 'transport', 'canvases.json'), 'utf8')), [old.record]); // CHANGE
}); // CHANGE

test('a current catalog descriptor cannot expose an old local registration', async t => { // NEW
    let old; const f = await fixture(t, { seedTransport: async paths => { old = await seedOldLibrary(paths, { version: 2 }); } }); // NEW
    const identityId = f.identities.session().identityId, entry = { name: 'Old registration', diagramId: old.record.diagramId, shareId: old.record.shareId, workerId: old.workerId, ownerIdentityId: identityId, protocolVersion: 3 }; // NEW
    const record = await f.identities.signAction('garden-record', { entry }), directory = path.join(f.identities.metadataRoot(identityId), 'catalog'); // NEW
    await fs.mkdir(directory, { recursive: true }); await fs.writeFile(path.join(directory, record.payload.id + '.json'), JSON.stringify(record)); // NEW
    const result = await f.library.list(); assert.deepEqual(result.gardens, []); assert.equal(result.errors.length, 0); assert.equal(await fs.readFile(old.record.diagramPath, 'utf8'), old.xml); // NEW
}); // NEW

/** Write fixtures through the signed v2 journal rather than changing its disposable projection. */ // NEW
async function saveProject(f, created, xml) { // NEW
    const service = await f.identities.transport(f.identities.session().identityId); // NEW
    service.setContext('fixture-save', { diagramPath: created.path, diagramId: created.entry.diagramId, userId: created.entry.workerId }); // NEW
    const result = await service.collaborationAction('fixture-save', { shareId: created.entry.shareId, kind: 'save', baseXml: await fs.readFile(created.path, 'utf8').catch(async error => { if (error.code !== 'ENOENT') throw error; await service.collaborationAction('fixture-save', { shareId: created.entry.shareId, kind: 'get' }); return fs.readFile(created.path, 'utf8'); }), xml }); // NEW
    assert.equal(result.ok, true, result.reason); // NEW
    const released = await service.collaborationAction('fixture-save', { shareId: created.entry.shareId, kind: 'release' }).catch(() => null); if (released) assert.equal(released.collaboration.holds.length, 0, JSON.stringify(released.collaboration)); // CHANGE
} // NEW

/** Opt-in real-service benchmark; count expensive work as well as elapsed time. */ // NEW
test('dialog listing benchmark reports cold warm and long-history work', { skip: !process.env.TRELLIS_DIALOG_BENCHMARK }, async t => { // NEW
    const f = await fixture(t), created = await f.library.create({ name: 'Benchmark garden' }), daemon = await f.identities.transport(f.identities.session().identityId); // NEW
    const counts = { reads: 0, writes: 0, historyReads: 0, registryScans: 0, naming: 0, verification: 0, namingMs: 0, verificationMs: 0 }; // NEW
    for (const [object, key, counter] of [[fs, 'readFile', 'reads'], [fs, 'writeFile', 'writes'], [daemon, 'listCanvases', 'registryScans'], [daemon, 'setProjectNaming', 'naming'], [f.identities, 'state', 'verification']]) { // NEW
        const original = object[key]; t.mock.method(object, key, async function(...args) { // NEW
            counts[counter]++; if (key === 'readFile' && String(args[0]).replaceAll('\\', '/').includes('/collaboration-v3/records/')) counts.historyReads++; // CHANGE
            const start = performance.now(); try { return await original.apply(this, args); } finally { if (counter === 'naming' || counter === 'verification') counts[counter + 'Ms'] += performance.now() - start; } // NEW
        }); // NEW
    } // NEW
    async function measure(label) { // NEW
        for (const key of Object.keys(counts)) counts[key] = 0; const start = performance.now(); const result = await f.library.list(); // NEW
        t.diagnostic(JSON.stringify({ label, milliseconds: +(performance.now() - start).toFixed(1), gardens: result.gardens.length, ...counts })); // NEW
    } // NEW
    await measure('cold'); await measure('warm'); // NEW
    for (let i = 0; i < 20; i++) await f.library.rename({ diagramId: created.entry.diagramId, name: 'History ' + i }); // NEW
    await measure('long-history'); // NEW
}); // NEW

test('listing batches trust and registry reads without journal replay or filesystem writes', async t => { // NEW
    const f = await fixture(t), first = await f.library.create({ name: 'One' }); await f.library.create({ name: 'Two' }); // NEW
    const daemon = await f.identities.transport(f.identities.session().identityId), list = daemon.listCanvases, state = f.identities.state, read = fs.readFile; let scans = 0, trust = 0, journals = 0; // NEW
    t.mock.method(daemon, 'listCanvases', async (...args) => { scans++; return list(...args); }); // NEW
    t.mock.method(f.identities, 'state', async (...args) => { trust++; return state(...args); }); // NEW
    t.mock.method(fs, 'readFile', async (...args) => { if (String(args[0]).includes('collaboration-v3')) journals++; return read(...args); }); // NEW
    for (const [object, key] of [[daemon, 'setProjectNaming'], [fs, 'writeFile'], [fs, 'rename']]) t.mock.method(object, key, () => { throw new Error('Listing performed maintenance: ' + key); }); // NEW
    const result = await f.library.list(); assert.equal(result.gardens.length, 2); assert.ok(result.gardens.find(garden => garden.diagramId === first.entry.diagramId).canRename); // NEW
    assert.equal(scans, 1); assert.equal(trust, 1); assert.equal(journals, 0); t.mock.restoreAll(); // NEW
}); // NEW

test('library reference proposals use the signed journal, correct page and identity-linked worker, with idempotent delivery', async t => { // NEW
    const f = await fixture(t), created = await f.library.create({ name: 'Reference recipient' }), state = inspectDiagram(await fs.readFile(created.path, 'utf8')), page = state.document.pages[0], doc = page.doc; // NEW
    const store = references.capture({ schema: { Plants: { columns: [{ name: 'plant_id', type: 'INTEGER', pk: 1 }, { name: 'plant_name', type: 'TEXT', pk: 0 }], pk: ['plant_id'], foreignKeys: [] } }, tables: { Plants: [{ plant_id: 1, plant_name: 'Basil' }] } }); // NEW
    const object = doc.createElement('object'); object.setAttribute('id', 'recipient'); object.setAttribute('garden_module', '1'); object.setAttribute('label', 'Recipient'); object.setAttribute('trellis_owner_user_id', created.entry.workerId); object.setAttribute(references.ATTR, JSON.stringify(store)); // NEW
    const cell = doc.createElement('mxCell'); cell.setAttribute('vertex', '1'); cell.setAttribute('parent', '1'); object.appendChild(cell); doc.getElementsByTagName('root')[0].appendChild(object); await saveProject(f, created, state.document.serialize()); // NEW
    const listing = await f.library.referenceTemplates(), template = listing.templates.find(item => item.source.gardenId === 'recipient'); assert.ok(template); assert.equal(template.canPropose, true); // NEW
    const [entity, rid] = Object.entries(store.manifests[store.current].heads)[0], old = store.revisions[rid], candidate = references.publish(store, [references.revision(entity, old.kind, { plant_name: 'Updated Basil' })]), proposal = references.proposal(store, candidate, 'source-worker', { diagramId: 'source-diagram' }, template.source); // NEW
    const input = { ...template.source, proposal }; assert.equal((await f.library.sendReferenceProposal(input)).ok, true); assert.equal((await f.library.sendReferenceProposal(input)).duplicate, true); // NEW
    await assert.rejects(f.library.sendReferenceProposal({ ...input, pageId: 'another-page' }), /Editing access/); // NEW
    const transport = await f.identities.transport(f.identities.session().identityId); transport.setContext('read-references', { diagramPath: created.path, diagramId: created.entry.diagramId, userId: created.entry.workerId }); // NEW
    const snapshot = await transport.collaborationAction('read-references', { shareId: created.entry.shareId, kind: 'get' }), saved = inspectDiagram(snapshot.xml).cells.find(cell => cell.id === 'recipient'), log = JSON.parse(saved.node.getAttribute(references.PROPOSALS)); transport.forgetContext('read-references'); // NEW
    assert.equal(log.requests.length, 1); assert.equal(log.requests[0].author, created.entry.workerId); assert.equal(log.requests[0].source.originalAuthor, 'source-worker'); assert.equal(saved.node.getAttribute(references.ATTR), JSON.stringify(store)); // NEW
}); // NEW
test('shared names and personal filenames preserve identity while suffixes stay outside shared descriptors', async t => { // NEW
    const f = await fixture(t), created = await f.library.create({ name: 'Community/Garden' }), id = created.entry.diagramId; // NEW
    assert.equal(path.basename(created.path), 'Community-Garden.drawio'); assert.equal(created.entry.protocolVersion, 3); // NEW
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
    for (const cell of state.cells) if (cell.node.hasAttribute('trellis_users_json')) cell.node.setAttribute('trellis_users_json', JSON.stringify(state.store)); // CHANGE
    const document = state.document.pages[0].doc, module = document.createElement('object'), cell = document.createElement('mxCell'); module.setAttribute('id', 'accessible-garden'); module.setAttribute('garden_module', '1'); module.setAttribute('trellis_access_open', '1'); cell.setAttribute('parent', '1'); module.appendChild(cell); document.getElementsByTagName('root')[0].appendChild(module); // NEW: access belongs to a real scope, not the metadata layer.
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
test('coordinator replacement retains the identity library worker and follows the new local project', async t => { // CHANGE
    const f = await fixture(t), created = await f.library.create({ name: 'Community' }); // NEW
    const service = await f.identities.transport(f.identities.session().identityId); // NEW
    service.setContext(10, { diagramPath: created.path, diagramId: created.entry.diagramId, userId: created.entry.workerId }); // NEW
    const replacement = await service.recovery(10, { shareId: created.entry.shareId }); // CHANGE
    await f.library.processDownloads(f.identities.session().identityId); // CHANGE: replacement adoption is background maintenance.
    const row = (await f.library.list()).gardens.find(g => g.diagramId === created.entry.diagramId); // NEW
    assert.equal(row.path, replacement.diagramPath); assert.equal(row.workerId, created.entry.workerId); assert.equal(row.name, 'Community'); // NEW
    assert.equal((await f.library.getEntry(created.entry.diagramId)).shareId, replacement.shareId); // NEW
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

test('signed project descriptors with unsupported protocols are isolated from valid library entries', async t => { // CHANGE
    const f = await fixture(t), created = await f.library.create({ name: 'Current project' }); // CHANGE
    const directory = path.join(f.identities.metadataRoot(f.identities.session().identityId), 'catalog'); // CHANGE
    for (const version of [undefined, 1, 2, 4]) { // CHANGE
        const entry = { ...created.entry, diagramId: 'unsupported-' + version, shareId: 'unsupported-' + version, protocolVersion: version }; // CHANGE
        if (version === undefined) delete entry.protocolVersion; // CHANGE: omitted wire fields must also be omitted before signing.
        const record = await f.identities.signAction('garden-record', { entry }); // CHANGE
        await fs.writeFile(path.join(directory, record.payload.id + '.json'), JSON.stringify(record)); // CHANGE
    } // CHANGE
    const result = await f.library.list(); assert.equal(result.gardens.length, 1); assert.equal(result.gardens[0].diagramId, created.entry.diagramId); assert.equal(result.errors.length, 1); // CHANGE: recognized old metadata stays hidden without being reported as a protocol failure.
    assert.equal((await f.library.getEntry(created.entry.diagramId)).diagramId, created.entry.diagramId); // CHANGE: old or future records for other projects cannot block a current project.
    await assert.rejects(f.library.getEntry('unsupported-1'), /Sharing is disabled/); // CHANGE
}); // CHANGE

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
    parsed.store.users[0].disabled = true; parsed.store.users.push({ id: 'replacement-admin', admin: true }); document.getElementsByTagName('object')[0].setAttribute('trellis_users_json', JSON.stringify(parsed.store)); await saveProject(f, created, parsed.document.serialize()); // NEW
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
    assert.equal((await f.library.actions({ diagramId: created.entry.diagramId })).canDelete, true); // NEW: warm the dialog's eligibility read before membership changes.
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
