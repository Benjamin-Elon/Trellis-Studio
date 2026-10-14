// NEW: Real daemon identity pairing, catalog transfer, and selective diagram download.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto'; // NEW
import { fileURLToPath } from 'node:url';
import { createSyncthingService } from '../src/main/trellis-syncthing-service.js';
import { createIdentityService } from '../src/main/trellis-identity-service.js';
import { createGardenLibraryService } from '../src/main/trellis-garden-library-service.js';
import '../drawio/src/main/webapp/js/trellis-field-protocol.js'; // NEW
const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
test('real paired desktops download a garden and resume an interrupted signed field package', { skip: process.env.TRELLIS_SYNCTHING_RUNTIME_TEST !== '1', timeout: 240000 }, async t => { // CHANGE
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'trellis-identity-runtime-')), addresses = new Map(), all = [];
    async function client(name) {
        const base = path.join(root, name), services = new Map();
        const transportFactory = async (identityId, profileRoot) => {
            if (!services.has(identityId)) {
                const service = createSyncthingService({ userDataPath: profileRoot, profilePath: path.join(profileRoot, 'transport'), documentsPath: base, canvasesRoot: path.join(base, 'gardens', identityId), binaryRoot: path.join(project, 'vendor/syncthing'), setStartup: async () => {}, onListening: ({ deviceId, port }) => addresses.set(deviceId, ['tcp://127.0.0.1:' + port]), deviceAddresses: id => addresses.get(id) || ['dynamic'], fetch: async (url, input) => { // CHANGE
                    if (input.method === 'PUT' && new URL(url).pathname === '/rest/config') { // NEW
                        const config = JSON.parse(input.body); Object.assign(config.options, { maxSendKbps: 128, maxRecvKbps: 128, limitBandwidthInLan: true }); input = { ...input, body: JSON.stringify(config) }; // NEW: keep a large loopback transfer observable before its atomic rename.
                    } // NEW
                    return fetch(url, input); // NEW: exercise the actual bundled daemon and authenticated REST boundary.
                } }); // CHANGE
                services.set(identityId, service); all.push(service);
            }
            return services.get(identityId);
        };
        const identities = createIdentityService({ root: path.join(base, 'identities'), transportFactory, protectPending: text => text, unprotectPending: text => text, adoptTransport: async (oldId, newId, target) => { await services.get(oldId).stop(); services.delete(oldId); await fs.rename(path.join(base, 'identities', oldId, 'transport'), path.join(target, 'transport')); } });
        const library = createGardenLibraryService({ identities, legacyService: () => transportFactory('legacy', path.join(base, 'legacy')) });
        return { identities, library };
    }
    t.after(async () => { for (const service of all) await service.stop(); await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); }); // CHANGE: Windows can retain briefly closed database handles.
    const a = await client('a'), b = await client('b');
    const made = await a.identities.create({ username: 'Alice', password: 'runtime-password' });
    const garden = await a.library.create({ name: 'Runtime garden' });
    const request = (await b.identities.createPairRequest()).request;
    const setup = (await a.identities.approvePairRequest({ request })).setup;
    await b.identities.importSetup({ setup, password: 'runtime-password' });
    await b.identities.unlock({ identityId: made.session.identityId, password: 'runtime-password' });
    async function until(condition, label = 'Peer transfer') { const deadline = Date.now() + 60000; while (Date.now() < deadline) { if (await condition()) return; await new Promise(resolve => setTimeout(resolve, 500)); } throw new Error(label + ' timed out.'); } // CHANGE: report which transfer stage failed.
    await until(async () => (await b.library.list()).gardens.length === 1);
    assert.equal((await b.library.list()).gardens[0].available, false);
    await b.library.download({ diagramId: garden.entry.diagramId });
    await until(async () => { await a.library.processDownloads(made.session.identityId); return (await b.library.list()).gardens[0].available; });
    const downloaded = (await b.library.list()).gardens[0];
    assert.match(await fs.readFile(downloaded.path, 'utf8'), /mxGraphModel/);
    const identityId = made.session.identityId, workerId = crypto.randomUUID(), taskId = crypto.randomUUID(); // NEW
    const work = globalThis.TrellisFieldProtocol.validateWork({ schema: 1, kind: 'field-work', diagramId: garden.entry.diagramId, workerId, packageId: crypto.randomUUID(), exportedAt: Date.now(), gardens: [], acknowledgments: [], tasks: [{ id: taskId, title: 'Transfer fixture', instructions: crypto.randomBytes(3 * 1024 * 1024).toString('base64'), progress: { state: 'TODO', completedDay: null }, annotation: '', versions: {}, locations: [] }] }); // NEW: incompressible test data exercises multiple native transfer blocks without real diagram information.
    const signed = await a.identities.signAction('field-work', { work }), bytes = Buffer.from(JSON.stringify(signed)); // NEW
    const relative = path.join('field', garden.entry.diagramId, workerId, 'work'), source = path.join(a.identities.metadataRoot(identityId), relative), receiver = path.join(b.identities.metadataRoot(identityId), relative), filename = signed.payload.id + '.json'; // NEW
    await fs.mkdir(source, { recursive: true }); await fs.writeFile(path.join(source, filename), bytes, { flag: 'wx' }); // NEW
    let partial; // NEW
    await until(async () => { // NEW
        for (const name of await fs.readdir(receiver).catch(error => { if (error.code === 'ENOENT') return []; throw error; })) { // NEW
            if (!(name.startsWith('.syncthing.') || name.startsWith('~syncthing~')) || !name.endsWith('.tmp')) continue; // CHANGE: the real Windows engine uses a different temporary-file prefix.
            const candidate = path.join(receiver, name); if ((await fs.stat(candidate)).size > 0) { partial = candidate; return true; } // NEW
        } // NEW
        return false; // NEW
    }, 'Partial field-package download'); // CHANGE
    await assert.rejects(fs.stat(path.join(receiver, filename)), { code: 'ENOENT' }); // NEW
    assert.deepEqual(await b.library.verifiedRecords(identityId, receiver), [], 'An incomplete transfer must not enter the signed package inbox.'); // NEW
    const transport = await b.identities.transport(identityId), stopped = await transport.stop({ deadline: Date.now() }); assert.equal(stopped.forced, true); // NEW: interrupt only the receiver's owned daemon without graceful transfer completion.
    const preservedBytes = (await fs.stat(partial)).size; assert.ok(preservedBytes > 0); // NEW
    await transport.start(); // NEW
    await until(async () => { try { return (await fs.stat(path.join(receiver, filename))).isFile(); } catch (error) { if (error.code === 'ENOENT') return false; throw error; } }, 'Resumed field-package download'); // CHANGE
    const received = await fs.readFile(path.join(receiver, filename)); assert.equal(crypto.createHash('sha256').update(received).digest('hex'), crypto.createHash('sha256').update(bytes).digest('hex')); // NEW
    const verified = await b.library.verifiedRecords(identityId, receiver); assert.equal(verified.length, 1); assert.equal(verified[0].payload.work.packageId, work.packageId); assert.deepEqual(verified[0].payload.work.acknowledgments, []); // NEW: complete delivery is still not a desktop acknowledgment.
    t.diagnostic('Interrupted signed field package resumed: ' + bytes.length + ' bytes, preserved temporary file, matching SHA-256 and signature, no acknowledgment.'); // NEW
    await a.identities.lock(); // CHANGE: await completion of device-local credential cleanup.
    assert.equal((await b.library.list()).gardens[0].available, true);
});
