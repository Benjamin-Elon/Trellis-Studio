import { listBounded, readJson as readBoundedJson, readBounded, LIMITS, diagnostic } from './trellis-input-policy.js'; // NEW
/** Versioned timeline transport. Collaboration genesis/records are never modified here. */ // NEW
import fs from 'node:fs/promises';
import path from 'node:path';
import { digest, safeId, signRecord, verifyRecord, canonical } from './trellis-share-protocol.js';
import { normalizeDocument, decodePayload } from './trellis-history-codec.js';

export function createHistoryTransport({ canvas, deviceId, keys, history, profile, writeImmutable, writeAtomic }) { // CHANGE
    const directory = path.join(canvas.folderPath, '.trellis', 'history-v2');
    const expectedGeneration = 'history-v2-' + digest(canvas.shareId).slice(0, 32); // NEW: this one-time upgrade has one stable, non-replayable epoch per share.
    let queue = Promise.resolve(), lastPublished = null, lastPruning = null, resetProof = null; // CHANGE
    const receivedHeads = new Map(); // NEW: current issuer positions, never a list of all published revisions.
    const run = (method, input) => history().run(method, { diagramId: canvas.diagramId, ...input });
    const signer = id => canvas.members.find(member => member.deviceId === id)?.publicKey;
    /** Membership handovers record the former coordinator's exclusive upper version bound. */ // NEW
    function coordinatorKey(payload) {
        if (!Number.isInteger(payload.membershipVersion) || payload.membershipVersion < 0 || payload.membershipVersion > canvas.membershipVersion) return null;
        const history = canvas.coordinatorHistory || [];
        for (let i = 0; i < history.length; i++) if (history[i].deviceId === payload.issuerDeviceId && payload.membershipVersion >= (history[i - 1]?.version || 0) && payload.membershipVersion < history[i].version) return history[i].publicKey;
        return payload.issuerDeviceId === canvas.coordinatorDeviceId && payload.membershipVersion >= (history.at(-1)?.version || 0) ? canvas.coordinatorPublicKey : null;
    }
    const signed = payload => signRecord({ ...payload, issuerDeviceId: deviceId }, keys.privateKey);
    async function optional(filename) { try { return await readBoundedJson(filename, LIMITS.history) /* CHANGE: bound actual history bytes. */; } catch (error) { if (error.code === 'ENOENT') return null; throw error; } }
    async function readRecord(filename, budget) {
        const stat = await fs.stat(filename); // CHANGE
        if (stat.size > 180 * 1024 * 1024) throw new Error('History record exceeds its size limit.');
        return await readBoundedJson(filename, LIMITS.history, budget) /* CHANGE: bound received JSON before parsing. */;
    }
    /** Validate an independently recoverable baseline before accepting a reset marker. */ // NEW
    function validateReset(record) {
        const p = record?.payload;
        if (!p || p.version !== 2 || p.shareId !== canvas.shareId || p.diagramId !== canvas.diagramId || !verifyRecord(record, coordinatorKey(p)) || p.baseline?.version !== 2 || p.baseline.generation !== p.generation || p.baseline.revision.diagramHistoryId !== canvas.diagramId || p.baseline.record.kind !== 'full') throw new Error('Shared history reset could not be verified.');
        safeId(p.generation); safeId(p.baseline.revision.id);
        if (p.generation !== expectedGeneration) throw new Error('Shared history reset belongs to a retired generation.'); // NEW
        const xml = normalizeDocument(decodePayload(Buffer.from(p.baseline.record.payload, 'base64')));
        if (digest(xml) !== p.baseline.record.hash) throw new Error('Shared history reset baseline is corrupt.');
        return { ...p, xml };
    }
    async function ensureReset() {
        let record = await optional(path.join(directory, 'reset.json'));
        if (!record) {
            if (deviceId !== canvas.coordinatorDeviceId) return null;
            const xml = await readBounded(canvas.diagramPath, LIMITS.diagram) /* CHANGE */;
            const generation = expectedGeneration, baselineId = generation + '-baseline'; // CHANGE
            await run('reset', { generation, baselineId, xml, timestamp: Date.now() });
            const baseline = await run('export', { revisionId: baselineId, forceFull: true });
            record = signed({ version: 2, shareId: canvas.shareId, diagramId: canvas.diagramId, generation, membershipVersion: canvas.membershipVersion || 0, baseline });
            validateReset(record);
            await writeImmutable(path.join(directory, 'reset.json'), record);
        }
        const fingerprint = digest(canonical(record)), authority = coordinatorKey(record.payload); // CHANGE
        const reset = resetProof?.fingerprint === fingerprint && resetProof.authority === authority ? resetProof.reset : validateReset(record); // CHANGE: cached verification remains bound to current trust as well as the bytes.
        resetProof = { fingerprint, authority, reset }; // CHANGE
        await run('reset', { generation: reset.generation, baselineId: reset.baseline.revision.id, xml: reset.xml, metadata: reset.baseline.revision, timestamp: reset.baseline.revision.timestamp });
        return reset;
    }
    function validEntry(record, reset) {
        const p = record?.payload, entry = p?.entry;
        if (!p || p.version !== 2 || p.shareId !== canvas.shareId || p.diagramId !== canvas.diagramId || !verifyRecord(record, signer(p.issuerDeviceId)) || entry?.version !== 2 || entry.generation !== reset.generation || entry.revision.diagramHistoryId !== canvas.diagramId) throw new Error('Unapproved or retired shared history record.');
        safeId(entry.revision.id); return entry;
    }
    async function publish(savedXml, revisionIds) {
        for (const id of revisionIds) if (!await run('has', { revisionId: safeId(id) })) throw new Error('Unknown shared history revision.'); // CHANGE: exporting one save does not list the timeline.
        const reset = await ensureReset();
        if (!reset) throw new Error('Waiting for the coordinator to reset shared history.');
        const savedHash = digest(normalizeDocument(savedXml));
        for (const id of revisionIds) {
            let entry;
            try { entry = await run('export', { revisionId: id, baseRevisionId: lastPublished?.revision.id, baseState: lastPublished?.record }); }
            catch (error) { if (id === reset.baseline.revision.id) throw error; continue; } // A reset may have retired a queued pre-reset revision. // NEW
            if (entry.generation !== reset.generation) throw new Error('History from a previous sharing identity remains local. Record a new saved revision before publishing.'); // NEW
            if (entry.record.hash !== savedHash) throw new Error('Only history matching the saved whole diagram may be published.');
            entry.revision.parentRevisionId = lastPublished?.revision.id || reset.baseline.revision.id;
            const target = path.join(directory, reset.generation, 'records', safeId(id) + '.json');
            const existing = await optional(target);
            if (existing) entry = validEntry(existing, reset);
            else await writeImmutable(target, signed({ version: 2, shareId: canvas.shareId, diagramId: canvas.diagramId, entry }));
            await writeAtomic(path.join(directory, 'heads', safeId(deviceId) + '.json'), JSON.stringify(signed({ version: 2, shareId: canvas.shareId, diagramId: canvas.diagramId, generation: reset.generation, revisionId: entry.revision.id, hash: entry.record.hash }))); // NEW
            lastPublished = entry;
        }
        // CHANGE: pruning is explicit maintenance; publishing a save never scans archives.
        return { ok: true, generation: reset.generation, reset: reset.baseline }; // NEW: recursive disk accounting is requested only when storage details are open.
    }
    /** Anchors and signed tombstones precede physical deletion, making interruption retryable. */ // NEW
    async function prune(reset) {
        if (deviceId !== canvas.coordinatorDeviceId) return;
        await run('prune');
        const removed = await run('retired');
        if (!removed.length) return;
        const pruningKey = digest(canonical([removed.slice().sort(), (await run('anchors')).sort()])); // NEW
        if (lastPruning === pruningKey) return; // NEW: unchanged maintenance never republishes anchors or scans all history exports.
        const anchors = [], publicRecords = new Map(), retired = new Set(removed); // CHANGE
        for (const name of await listBounded(path.join(directory, reset.generation, 'records')).catch(error => { if (error.code === 'ENOENT') return []; throw error; })) if (/^[a-zA-Z0-9_-]+\.json$/.test(name)) { // NEW
            const entry = validEntry(await readRecord(path.join(directory, reset.generation, 'records', name)), reset); publicRecords.set(entry.revision.id, entry); // NEW
        } // NEW
        const needed = new Set((await run('anchors')).filter(id => publicRecords.has(id) && !retired.has(id))); // NEW: private unsaved anchors never leave this device.
        for (const entry of publicRecords.values()) if (!retired.has(entry.revision.id) && retired.has(entry.record.baseRevisionId)) needed.add(entry.revision.id); // NEW: wire dependencies can differ from local dependencies.
        for (const revisionId of needed) {
            const anchor = await run('export', { revisionId, forceFull: true });
            const name = revisionId + '-' + anchor.record.hash + '.json';
            await writeImmutable(path.join(directory, reset.generation, 'anchors', name), signed({ version: 2, shareId: canvas.shareId, diagramId: canvas.diagramId, entry: anchor }));
            anchors.push(name);
        }
        const payload = { version: 2, shareId: canvas.shareId, diagramId: canvas.diagramId, generation: reset.generation, membershipVersion: canvas.membershipVersion || 0, sequence: removed.length, removed: removed.sort(), anchors: anchors.sort() }; // CHANGE
        const manifestName = digest(canonical(payload)) + '.json'; // NEW
        await writeImmutable(path.join(directory, reset.generation, 'pruning', manifestName), signed(payload));
        for (const id of removed) await fs.rm(path.join(directory, reset.generation, 'records', safeId(id) + '.json'), { force: true });
        for (const name of await listBounded(path.join(directory, reset.generation, 'pruning'))) if (/^[a-f0-9]+\.json$/.test(name) && name !== manifestName) await fs.rm(path.join(directory, reset.generation, 'pruning', name), { force: true }); // NEW
        for (const name of await listBounded(path.join(directory, reset.generation, 'anchors'))) if (/^[a-zA-Z0-9_-]+\.json$/.test(name) && !anchors.includes(name)) await fs.rm(path.join(directory, reset.generation, 'anchors', name), { force: true }); // NEW
        await clearRetiredArchives(reset.generation, removed); // NEW
        await run('compact');
        lastPruning = pruningKey; // NEW: only mark work complete after durable publication and cleanup.
    }
    /** Syncthing may archive remote deletions; clear only files retired by a verified manifest. */ // NEW
    async function clearRetiredArchives(generation, removed) {
        const root = path.join(canvas.folderPath, '.stversions', '.trellis', 'history-v2', safeId(generation));
        const project = await fs.realpath(canvas.folderPath);
        for (const kind of ['records', 'anchors']) {
            const folder = path.join(root, kind);
            try {
                const resolved = await fs.realpath(folder);
                if (resolved !== path.join(project, '.stversions', '.trellis', 'history-v2', generation, kind)) throw new Error('History archive cleanup path is outside its project.');
                for (const item of await listBounded(folder, { withFileTypes: true })) {
                    if (!item.isFile() || item.isSymbolicLink()) continue;
                    const matches = removed.some(id => item.name === id + '.json' || item.name.startsWith(id + '.json~') || item.name.startsWith(id + '~') && item.name.endsWith('.json') || kind === 'anchors' && item.name.startsWith(id + '-'));
                    if (matches) await fs.rm(path.join(folder, item.name), { force: true });
                }
            } catch (error) { if (error.code !== 'ENOENT') throw error; }
        }
    }
    async function importAll(knownIds = []) {
        const reset = await ensureReset();
        if (!reset) return { ok: true, entries: [], errors: [], waitingForCoordinator: true };
        const root = path.join(directory, reset.generation), errors = [], entries = [], known = new Set(knownIds), budget = { used: 0, maximum: LIMITS.replay }; // CHANGE
        // Prefer the newest cumulative signed manifest; older manifests can arrive after compaction. // NEW
        const manifests = []; // NEW
        for (const name of (await listBounded(path.join(root, 'pruning')).catch(error => { if (error.code === 'ENOENT') return []; throw error; })).sort()) {
            if (!/^[a-f0-9]+\.json$/.test(name)) continue;
            try {
                const record = await readRecord(path.join(root, 'pruning', name), budget), p = record.payload;
                if (p?.version !== 2 || p.shareId !== canvas.shareId || p.diagramId !== canvas.diagramId || p.generation !== reset.generation || digest(canonical(Object.fromEntries(Object.entries(p).filter(([key]) => key !== 'issuerDeviceId')))) + '.json' !== name || !verifyRecord(record, coordinatorKey(p))) throw new Error('Invalid history pruning authority.');
                if (!Array.isArray(p.removed) || !Array.isArray(p.anchors) || p.sequence !== p.removed.length) throw new Error('Invalid history pruning manifest.'); // NEW
                manifests.push(p); // NEW
            } catch (error) { if (error.code === 'REPLAY_LIMIT') throw error; errors.push({ filename: name, ...diagnostic(error, name) }); }
        }
        const manifest = manifests.sort((a, b) => b.sequence - a.sequence)[0]; // NEW
        if (manifest) { // NEW
            try {
                const p = manifest, anchors = [];
                for (const anchorName of p.anchors) {
                    if (!/^[a-zA-Z0-9_-]+\.json$/.test(anchorName)) throw new Error('Invalid history anchor filename.');
                    anchors.push(validEntry(await readRecord(path.join(root, 'anchors', anchorName), budget), reset));
                }
                await run('applyPrune', { anchors, removed: p.removed });
                for (const id of p.removed) await fs.rm(path.join(root, 'records', safeId(id) + '.json'), { force: true });
                await clearRetiredArchives(reset.generation, p.removed); // NEW
            } catch (error) { if (error.code === 'REPLAY_LIMIT') throw error; errors.push({ filename: 'pruning', ...diagnostic(error) }); }
        }
        const retiredIds = new Set(await run('retired')); // NEW
        for (const name of (await listBounded(path.join(root, 'records')).catch(error => { if (error.code === 'ENOENT') return []; throw error; })).sort()) {
            if (/^[a-zA-Z0-9_-]+\.json$/.test(name) && retiredIds.has(name.slice(0, -5))) { await fs.rm(path.join(root, 'records', name), { force: true }); continue; } // NEW
            if (!/^[a-zA-Z0-9_-]+\.json$/.test(name) || known.has(name.slice(0, -5))) continue;
            try {
                const entry = validEntry(await readRecord(path.join(root, 'records', name), budget), reset);
                if (entry.revision.id + '.json' !== name) throw new Error('History filename identity mismatch.');
                await run('import', { entry }); entries.push(entry);
            } catch (error) { if (error.code === 'REPLAY_LIMIT') throw error; errors.push({ filename: name, ...diagnostic(error, name) }); } // CHANGE
        }
        return { ok: true, generation: reset.generation, reset: reset.baseline, entries, errors };
    }
    /** Import current issuer heads and their bounded storage dependencies; timeline browsing is separate. */ // CHANGE
    async function maintain() { // CHANGE
        const reset = await ensureReset(); // NEW
        if (!reset) return { ok: true, entries: [], errors: [], waitingForCoordinator: true }; // NEW
        const entries = [], errors = [], root = path.join(directory, reset.generation, 'records'); // NEW
        async function importDependency(id, visiting = new Set()) { // NEW
            safeId(id); // NEW
            if (visiting.has(id) || visiting.size > 30) throw new Error('Invalid or excessive history dependency chain.'); // NEW
            if (await run('has', { revisionId: id }) && !(await run('describe', { revisionId: id })).pending) return; // CHANGE: a received delta with a missing base is not complete.
            visiting.add(id); // NEW
            const entry = validEntry(await readRecord(path.join(root, id + '.json')), reset); // NEW
            if (entry.revision.id !== id) throw new Error('History filename identity mismatch.'); // NEW
            if (entry.record.kind === 'delta') await importDependency(entry.record.baseRevisionId, visiting); // NEW
            await run('import', { entry }); entries.push(entry); visiting.delete(id); // NEW
        } // NEW
        for (const member of canvas.members) { // NEW
            try { // NEW
                const record = await optional(path.join(directory, 'heads', safeId(member.deviceId) + '.json')); // NEW
                if (!record) continue; // NEW
                const payload = record.payload; // NEW
                if (payload?.version !== 2 || payload.shareId !== canvas.shareId || payload.diagramId !== canvas.diagramId || payload.generation !== reset.generation || payload.issuerDeviceId !== member.deviceId || !verifyRecord(record, member.publicKey)) throw new Error('Invalid history head signature.'); // NEW
                const proof = digest(canonical(record)); // NEW
                if (receivedHeads.get(member.deviceId) === proof && await run('has', { revisionId: payload.revisionId }) && !(await run('describe', { revisionId: payload.revisionId })).pending) continue; // CHANGE
                await importDependency(payload.revisionId); // NEW
                const revision = await run('describe', { revisionId: payload.revisionId }); // NEW
                if (revision.pending || revision.diagramHash !== payload.hash || revision.generation !== reset.generation) throw new Error('History head content mismatch.'); // CHANGE
                receivedHeads.set(member.deviceId, proof); // NEW
            } catch (error) { errors.push({ filename: member.deviceId, ...diagnostic(error, member.deviceId) }); } // NEW
        } // NEW
        return { ok: true, generation: reset.generation, reset: reset.baseline, entries, errors }; // NEW
    }
    async function directoryBytes(directoryPath) {
        let total = 0;
        for (const item of await listBounded(directoryPath, { withFileTypes: true }).catch(error => { if (error.code === 'ENOENT') return []; throw error; })) { // NEW
            if (item.isSymbolicLink()) continue;
            const filename = path.join(directoryPath, item.name);
            if (item.isDirectory()) total += await directoryBytes(filename);
            else if (item.isFile()) try { total += (await fs.stat(filename)).size; } catch (error) { if (error.code !== 'ENOENT') throw error; } // NEW: tolerate a concurrent verified cleanup.
        }
        return total;
    }
    async function statistics() {
        const archiveBytes = await directoryBytes(path.join(canvas.folderPath, '.stversions', '.trellis', 'history-v2')); // NEW
        const legacyBytes = await directoryBytes(path.join(canvas.folderPath, '.trellis', 'history')) + await directoryBytes(path.join(canvas.folderPath, '.stversions', '.trellis', 'history')); // NEW
        return { historyBytes: await directoryBytes(directory) + archiveBytes + legacyBytes, archiveBytes, legacyBytes, collaborationBytes: await directoryBytes(path.join(canvas.folderPath, '.trellis', 'collaboration-v3')), recoveryBytes: await directoryBytes(path.join(profile, 'recovery', canvas.shareId)) }; // CHANGE
    }
    function serialized(work) { const result = queue.then(work); queue = result.catch(() => {}); return result; }
    return { publish: (...args) => serialized(() => publish(...args)), importAll: (...args) => serialized(() => importAll(...args)), maintain: () => serialized(maintain), prune: () => serialized(async () => { const reset = await ensureReset(); if (reset) await prune(reset); }), statistics }; // CHANGE: destructive maintenance is never an ordinary save side effect.
}
