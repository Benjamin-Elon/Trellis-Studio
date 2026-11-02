/** Five sequential, visible native launches; all accounts, changes and writes stay in disposable profiles. */ // NEW
import fs from 'node:fs/promises'; // NEW
import os from 'node:os'; // NEW
import path from 'node:path'; // NEW
import crypto from 'node:crypto'; // NEW
import { spawn, execFile } from 'node:child_process'; // NEW
import { createRequire } from 'node:module'; // NEW
import { createCurrentStateStore } from '../src/main/trellis-current-state.js'; // NEW
import { diffObjects } from '../src/main/trellis-collaboration-protocol.js'; // NEW
import { sourceManifest } from './test-full-suite.mjs'; // NEW: reuse the repository's source-integrity mechanism for native measurements.
const require = createRequire(import.meta.url), project = path.resolve(import.meta.dirname, '..'); // NEW
const reuse = process.argv[2], profile = reuse ? path.resolve(reuse) : await fs.mkdtemp(path.join(os.tmpdir(), 'trellis-responsive-startup-')), output = path.join(project, '.test-artifacts', 'responsive-startup', String(Date.now())); // CHANGE
if (path.dirname(profile) !== path.resolve(os.tmpdir()) || !path.basename(profile).startsWith('trellis-responsive-startup-')) throw new Error('Only disposable startup fixtures may be reused.'); // NEW
await fs.mkdir(output, { recursive: true }); // NEW
const sources = await sourceManifest(); await fs.writeFile(path.join(output, 'sources.json'), JSON.stringify(sources, null, 2)); // NEW
async function launch(name, seed = false) { // NEW
    const report = path.join(output, name + '.json'), log = await fs.open(path.join(output, name + '.log'), 'w'); // NEW
    const env = { ...process.env, TRELLIS_STARTUP_PROFILE: profile, TRELLIS_STARTUP_OUTPUT: report, TRELLIS_STARTUP_SEED: seed ? '1' : '0', TRELLIS_STARTUP_STARTED_AT: String(Date.now()) }; delete env.ELECTRON_RUN_AS_NODE; // CHANGE
    const child = spawn(require('electron'), [path.join(project, 'test/helpers/responsive-startup-electron.cjs')], { env, windowsHide: true, stdio: ['ignore', log.fd, log.fd] }); // NEW
    const deadline = setTimeout(() => { if (child.exitCode == null) { if (process.platform === 'win32') execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }); else child.kill('SIGKILL'); } }, 140000); // NEW
    try { const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); }); const result = JSON.parse(await fs.readFile(report, 'utf8').catch(() => JSON.stringify({ code: 1, error: 'Native process exited without a readiness report.' }))); console.log(name, JSON.stringify(result)); return { ...result, exitCode: code }; } finally { clearTimeout(deadline); await log.close(); } // CHANGE
} // NEW
async function fixture() { // NEW
if (!reuse) { const seeded = await launch('seed', true); if (seeded.code) throw new Error('Fixture seed failed; see ' + output); } // CHANGE
const identityRoot = path.join(profile, 'app-data/draw.io/trellis-identities'), index = JSON.parse(await fs.readFile(path.join(identityRoot, 'identities.json'), 'utf8')); // NEW
const transport = path.join(identityRoot, index[0].id, 'transport'), registryFile = path.join(transport, 'canvases.json'); // NEW
const registry = JSON.parse(await fs.readFile(registryFile, 'utf8')), garden = JSON.parse(await fs.readFile(path.join(profile, 'garden.json'), 'utf8')), canvas = registry.find(entry => entry.shareId === garden.entry.shareId), keys = JSON.parse(await fs.readFile(path.join(transport, 'signing-key.json'), 'utf8')); // CHANGE: retained registrations may precede the active project after persistence.
if (!canvas) throw new Error('The disposable fixture registration is missing.'); // NEW
if (reuse) return { registry, canvas, xml: await fs.readFile(canvas.diagramPath, 'utf8') }; // NEW
const writeAtomic = async (filename, value) => { const relative = path.relative(profile, path.resolve(filename)); if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Fixture write escaped its profile.'); await fs.mkdir(path.dirname(filename), { recursive: true }); const temp = filename + '.' + crypto.randomUUID() + '.tmp'; await fs.writeFile(temp, value); await fs.rename(temp, filename); }; // NEW
let allowCheckpoint = true; // NEW
const writeImmutable = async (filename, value) => { if (!allowCheckpoint && path.basename(path.dirname(filename)) === 'checkpoints') throw new Error('Fixture retains an oversized pre-repair tail.'); await fs.mkdir(path.dirname(filename), { recursive: true }); await fs.writeFile(filename, JSON.stringify(value), { flag: 'wx' }); }; // NEW
const store = createCurrentStateStore({ canvas, deviceId: canvas.localDeviceId, keys, profile: transport, writeAtomic, writeImmutable }); // NEW
let state = await store.read(), xml = state.xml; const actor = { userId: canvas.members.find(member => member.deviceId === canvas.localDeviceId).userId, sessionId: 'startup-fixture' }; // NEW
const extra = Array.from({ length: 64 }, (_, i) => '<object id="startup-' + i + '" label="Initial" data="' + 'x'.repeat(32700) + '"><mxCell vertex="1" parent="1"/></object>').join(''); // NEW
let next = xml.replace('</root>', extra + '</root>'), delta = diffObjects(xml, next); await store.append(actor, 'save', { ...delta }); xml = (await store.read()).xml; await store.checkpoint(); allowCheckpoint = false; // NEW
for (let i = 1; i <= 8; i++) { next = xml.replaceAll('label="' + (i === 1 ? 'Initial' : 'Change-' + (i - 1)) + '"', 'label="Change-' + i + '"'); delta = diffObjects(xml, next); await store.append(actor, 'save', { ...delta }); xml = (await store.read()).xml; } // NEW
await store.maintenance(); await writeAtomic(canvas.diagramPath, xml); // NEW
for (let i = 1; i <= 17; i++) { const shareId = 'historical-' + i, folderPath = path.join(path.dirname(canvas.folderPath), shareId); await fs.mkdir(folderPath, { recursive: true }); registry.push({ ...canvas, shareId, folderId: 'trellis-v' + (i < 10 ? 3 : canvas.protocolVersion) + '-' + shareId, protocolVersion: i < 10 ? 3 : canvas.protocolVersion, folderPath, diagramPath: path.join(folderPath, canvas.filename), ...(i >= 10 ? { projectRetired: 'trashed', projectFenced: true, localRemoved: true, retirementComplete: 'trashed' } : {}) }); } // NEW
await writeAtomic(registryFile, JSON.stringify(registry)); // NEW
const evidence = path.join(profile, 'cold-evidence'); await fs.cp(canvas.folderPath, evidence, { recursive: true }); // NEW
return { registry, canvas, xml }; // NEW
} // NEW
const { registry, canvas, xml } = await fixture(), evidence = path.join(profile, 'cold-evidence'); // NEW
const results = []; // NEW
for (let i = 1; i <= (process.env.TRELLIS_STARTUP_PROBE === '1' ? 1 : 5); i++) { // CHANGE: the explicit diagnostic probe does not count as five-launch acceptance.
    await fs.cp(evidence, canvas.folderPath, { recursive: true, force: true }); const result = await launch('launch-' + i); // NEW
    const head = JSON.parse(await fs.readFile(path.join(canvas.folderPath, '.trellis', 'collaboration-v' + canvas.protocolVersion, 'heads', canvas.coordinatorDeviceId + '.json'), 'utf8')).payload; // NEW
    result.acceptedSequence = head.sequence; result.checkpointSequence = head.checkpointSequence; if (!result.code && head.sequence !== head.checkpointSequence) { result.code = 1; result.error = 'The reconstructed oversized tail did not receive a checkpoint.'; } results.push(result); // NEW
} // NEW
const sourceUnchanged = JSON.stringify(sources) === JSON.stringify(await sourceManifest()); // NEW
await fs.writeFile(path.join(output, 'results.json'), JSON.stringify({ profile, bytes: Buffer.byteLength(xml), acceptedChanges: 8, registrations: registry.length, sourceUnchanged, results }, null, 2)); // CHANGE
console.log('Startup evidence:', output); if (!sourceUnchanged) console.error('Source changed during native validation; this run cannot establish acceptance.'); process.exitCode = sourceUnchanged && results.every(result => result.code === 0 && result.exitCode === 0) ? 0 : 1; // CHANGE
