/** Opt-in signed-journal workload. Main-process timings and payload sizes are separate from native renderer timings. */ // NEW
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { createCollaborationStore } from '../src/main/trellis-collaboration-store.js';
import { createProjectTransport } from '../src/main/trellis-project-transport.js'; // NEW

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'trellis-refresh-benchmark-'));
const keyPair = crypto.generateKeyPairSync('ed25519');
const keys = { publicKey: keyPair.publicKey.export({ type: 'spki', format: 'pem' }), privateKey: keyPair.privateKey };
const writeAtomic = async (filename, contents) => { await fs.mkdir(path.dirname(filename), { recursive: true }); const temporary = filename + '.tmp'; await fs.writeFile(temporary, contents); await fs.rename(temporary, filename); };
const writeImmutable = async (filename, value) => { await fs.mkdir(path.dirname(filename), { recursive: true }); await fs.writeFile(filename, JSON.stringify(value), { flag: 'wx' }); };
function diagram(count, changed = 0, privateGarden = false) { // CHANGE
    const users = JSON.stringify({ usersEnabled: true, users: [{ id: 'alice', name: 'Alice', admin: true }, ...(privateGarden ? [] : [{ id: 'bob', name: 'Bob', admin: true }])] }).replaceAll('"', '&quot;'); // CHANGE
    return '<mxGraphModel><root><mxCell id="0"/><object id="1" trellis_users_json="' + users + '"><mxCell parent="0"/></object>' + Array.from({ length: count }, (_, i) => '<object id="object-' + i + '" label="' + (i < changed ? 'Updated ' : 'Original ') + i + '"><mxCell parent="1" vertex="1"><mxGeometry x="' + i * 10 + '" y="0" width="10" height="10" as="geometry"/></mxCell></object>').join('') + '</root></mxGraphModel>';
}
const results = [];
try {
    for (const [count, changed] of [[200, 100], [2000, 100], [2000, 1000]]) {
        const folder = path.join(profile, count + '-' + changed), samples = [];
        const canvas = { shareId: 'benchmark-' + count + '-' + changed, diagramId: 'diagram', filename: 'Canvas.drawio', folderPath: folder, diagramPath: path.join(folder, 'Canvas.drawio'), coordinatorDeviceId: 'device', coordinatorPublicKey: keys.publicKey, members: [{ deviceId: 'device', publicKey: keys.publicKey }] };
        const journal = createCollaborationStore({ canvas, deviceId: 'device', keys, profile: path.join(folder, 'private'), writeAtomic, writeImmutable, onTiming: sample => samples.push(sample) });
        const before = diagram(count), after = diagram(count, changed);
        await journal.initialize(before); await journal.action(1, 'alice', { kind: 'open-view', explicitRefresh: true });
        const saveStart = performance.now(); await journal.action(2, 'bob', { kind: 'save', baseXml: before, xml: after }); const saveMs = performance.now() - saveStart;
        const legacyStart = performance.now(), legacy = await journal.action(1, 'alice', { kind: 'get' }); const legacyReadMs = performance.now() - legacyStart;
        const pollStart = performance.now(); await journal.action(1, 'alice', { kind: 'get', explicitRefresh: true }); // NEW: measure the verification/projection read required before deriving summaries.
        const notificationStart = performance.now(), notification = await journal.action(1, 'alice', { kind: 'changes', explicitRefresh: true }); const notificationMs = performance.now() - notificationStart, notificationPollMs = performance.now() - pollStart; // CHANGE
        const review = await journal.action(1, 'alice', { kind: 'review', explicitRefresh: true });
        const prepareStart = performance.now(), prepared = await journal.action(1, 'alice', { kind: 'prepare-refresh', explicitRefresh: true, token: review.token }); const prepareMs = performance.now() - prepareStart;
        const ackStart = performance.now(); await journal.action(1, 'alice', { kind: 'ack-refresh', explicitRefresh: true, receipt: prepared.receipt }); const acknowledgementMs = performance.now() - ackStart;
        const historyFolder = path.join(folder, 'history-reuse'), historySamples = [], historyReuse = []; // NEW
        const historyCanvas = { ...canvas, shareId: canvas.shareId + '-history', folderPath: historyFolder, diagramPath: path.join(historyFolder, canvas.filename) }; // NEW
        const history = createCollaborationStore({ canvas: historyCanvas, deviceId: 'device', keys, profile: path.join(historyFolder, 'private'), writeAtomic, writeImmutable, onTiming: sample => historySamples.push(sample) }); // NEW
        const initial = diagram(count, 0, true), updated = diagram(count, changed, true); // NEW
        await history.initialize(initial); await writeAtomic(historyCanvas.diagramPath, initial); // NEW
        const transport = createProjectTransport({ initialize: async () => {}, registry: () => [historyCanvas], collaborationStore: () => history, now: Date.now }); // NEW
        async function measureHistory(scenario, operation, iterations = 1) { // NEW: count actual work separately from elapsed time on this machine.
            const offset = historySamples.length, started = performance.now(); // NEW
            for (let iteration = 0; iteration < iterations; iteration++) await operation(); // NEW
            const durationMs = performance.now() - started, events = historySamples.slice(offset), reads = events.filter(sample => sample.phase === 'read'); // NEW
            historyReuse.push({ scenario, iterations, durationMs, meanMs: durationMs / iterations, reads: reads.length, replays: reads.reduce((sum, sample) => sum + sample.replayCount, 0), replayHits: reads.filter(sample => sample.replayCacheHit).length, materializations: events.filter(sample => sample.phase === 'materialize').length, projectionsWritten: events.filter(sample => sample.phase === 'materialize' && sample.wroteProjection).length, queueWaitMs: events.filter(sample => sample.phase === 'queue').reduce((sum, sample) => sum + sample.waitMs, 0) }); // NEW
        } // NEW
        await measureHistory('cold snapshot', () => history.snapshot()); // NEW
        await measureHistory('warm unchanged snapshot', () => history.snapshot(), 5); // NEW
        await measureHistory('changed history', () => history.action(1, 'alice', { kind: 'save', baseXml: initial, xml: updated })); // NEW
        await measureHistory('unchanged background refresh', () => history.refresh(), 3); // NEW
        await measureHistory('private membership query', () => transport.projectActions({ shareId: historyCanvas.shareId, userId: 'alice' }), 5); // NEW
        const result = { objects: count, changed, saveMs, legacyReadMs, notificationMs, notificationPollMs, prepareMs, acknowledgementMs, legacyXmlBytes: Buffer.byteLength(legacy.xml), notificationBytes: Buffer.byteLength(JSON.stringify(notification.groups)), groups: notification.groups.length, changedObjects: notification.groups.reduce((sum, group) => sum + group.objects.length, 0), rendererXmlDecodesForNotifications: 0, rssBytes: process.memoryUsage().rss, work: { reads: samples.filter(sample => sample.phase === 'read').length, replays: samples.filter(sample => sample.phase === 'read').reduce((sum, sample) => sum + sample.replayCount, 0), verifiedRecords: samples.filter(sample => sample.phase === 'read').reduce((sum, sample) => sum + sample.records, 0), projectionsWritten: samples.filter(sample => sample.phase === 'materialize' && sample.wroteProjection).length }, historyReuse, samples }; // CHANGE
        results.push(result); console.log(JSON.stringify({ ...result, samples: undefined }));
    }
    const output = path.join(project, '.test-artifacts/explicit-refresh/benchmark.json'); await fs.mkdir(path.dirname(output), { recursive: true }); await fs.writeFile(output, JSON.stringify({ results, note: 'Development observations. Main-process measurements exclude renderer parsing/rendering; native renderer timings are in timings.json.' }, null, 2));
} finally { // CHANGE: verify the owned temporary target before recursive cleanup on Windows.
    if (path.dirname(path.resolve(profile)) !== path.resolve(os.tmpdir()) || !path.basename(profile).startsWith('trellis-refresh-benchmark-')) throw new Error('Unexpected benchmark cleanup target.');
    await fs.rm(profile, { recursive: true, force: true });
}
