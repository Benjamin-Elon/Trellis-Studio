import { listBounded, readBounded, readJson, parseJson, LIMITS, REVISION, fail, diagnostic } from './trellis-input-policy.js'; // NEW
/** Durable signed collaboration journal; Syncthing transports the files unchanged. // NEW
 * Each mutation is serialized locally. Only genesis/records/assets synchronize; // NEW
 * materialized XML and rejected proposals remain local. // NEW */
import fs from 'node:fs/promises'; // NEW
import path from 'node:path'; // NEW
import { naming, withProjectName, validateProjectNameChange } from './trellis-project-naming.js'; // NEW
import { digest, makeId, signRecord, verifyRecord, safeId, inspectDiagram, canonical } from './trellis-share-protocol.js'; // CHANGE
import { diffObjects, applyChanges, revertDraftChanges, authorityFor, invitationAcceptance, objects, logicalKey, targetsForObject, COLLABORATION_VERSION, PRESENCE_MS, CLOCK_SKEW_MS } from './trellis-collaboration-protocol.js'; // CHANGE
import { replayInWorker } from './trellis-collaboration-worker.js'; // NEW: verified journal replay must not block the Electron main thread.
import { createObjectViews } from './trellis-object-views.js'; // CHANGE
import { saveCache } from './trellis-save-cache.js'; // NEW
import { permissions, permissionSnapshot, validatePermissionChanges } from './trellis-permission-policy.js'; // NEW
import { reviewDraft, resolveDraft } from './trellis-draft-conflicts.js'; // NEW
export function createCollaborationStore({ canvas, deviceId, keys, profile, now = Date.now, writeAtomic, writeImmutable, prepareXml = async xml => xml, beforeMaterialize = async () => {}, beforeCommit = () => [], onTiming = () => {}, onVerified = () => {}, replayWorker = replayInWorker }) { // CHANGE
    let nextOperationId = 0, activeOperationId = 0; // NEW
    const timing = sample => { try { onTiming({ operationId: activeOperationId, ...sample }); } catch (_) {} }; // NEW: observers cannot fail a durable operation.
    const directory = path.join(canvas.folderPath, '.trellis', 'collaboration-v3'), sessions = new Map(); // NEW
    const replayCacheKey = 'replay:' + REVISION + ':' + digest(JSON.stringify([profile, directory, canvas.shareId, canvas.diagramId])); // NEW: one replaceable result per project, within the existing main-process cache budget.
    let queue = Promise.resolve(), latest = null, recoveryPaths = []; // NEW
    const views = createObjectViews({ profile, canvas, writeAtomic, now }); // NEW: private, serialized by this store's existing journal queue.
    const checkpointRetries = new Map(); // NEW: a failed private write must not republish an already accepted local edit on retry.
    let policyXml = null, policySnapshot = null, policyHash = null; const policySent = new Map(); // NEW
    const sessionFor = (callerId, userId) => { const key = callerId + ':' + userId; if (!sessions.has(key)) sessions.set(key, makeId()); return sessions.get(key); }; // NEW
    let pendingRefresh = null; // NEW: only adjacent refresh requests may share work.
    function serialized(operation, kind = 'action') { // CHANGE
        const queued = performance.now(), operationId = ++nextOperationId; if (kind !== 'refresh') pendingRefresh = null; // NEW: mutations fence refresh coalescing.
        const next = queue.then(async () => { const started = performance.now(); activeOperationId = operationId; try { return await operation(); } finally { timing({ phase: 'queue', kind, waitMs: started - queued, durationMs: performance.now() - started }); activeOperationId = 0; } }); // CHANGE
        queue = next.catch(() => {}); return next; // CHANGE
    } // CHANGE
    /** Retain a content-addressed verification proof; every read hashes current bytes and validates current authority. */ // CHANGE
    function verifiedRecord(text, publicKey, counters) { // NEW
        const cacheKey = 'signature:' + REVISION + ':' + digest(JSON.stringify([canvas.shareId, canvas.diagramId, publicKey, text])); // NEW
        const cached = saveCache.get(cacheKey); // NEW
        if (cached === true) { counters.hits++; return parseJson(text, LIMITS.record); } // CHANGE: the cryptographic key binds project identity, the current signer key, and every byte; no mutable payload is retained.
        counters.misses++; const record = parseJson(text, LIMITS.record); // NEW
        if (!verifyRecord(record, publicKey)) throw new Error('Invalid or unapproved collaboration signature.'); // NEW
        saveCache.set(cacheKey, true, 8); return record; // CHANGE: compact proofs leave room for replay results within the same bounded cache.
    } // NEW
    /** Diagnose malformed signed peer data before it reaches the pure reducer. */ // NEW
    function validateFields(record) { // NEW
        const objectId = key => { // NEW
            if (key === '*') return true; // NEW
            try { const pair = JSON.parse(key); return Array.isArray(pair) && pair.length === 2 && pair.every(part => typeof part === 'string') && !!pair[1]; } catch (_) { return false; } // NEW
        }; // NEW
        if (typeof record.userId !== 'string' || !record.userId || record.claimIds && (!Array.isArray(record.claimIds) || record.claimIds.some(id => typeof id !== 'string')) || record.targets?.some(key => !objectId(key))) throw new Error('Invalid collaboration author or object references.'); // NEW
        if (record.kind === 'edit' && (!Array.isArray(record.changes) || record.changes.some(change => !change || !objectId(change.key) || change.before !== null && typeof change.before !== 'string' || change.xml !== null && typeof change.xml !== 'string'))) throw new Error('Invalid object-change transaction.'); // NEW
    } // NEW
    async function initialize(xml) { // NEW
        if (canvas.coordinatorDeviceId !== deviceId) throw new Error('Only the approved coordinator may create the project snapshot.'); // NEW
        inspectDiagram(xml); objects(xml); // NEW
        await writeImmutable(path.join(directory, 'genesis.json'), signRecord({ schema: COLLABORATION_VERSION, shareId: canvas.shareId, diagramId: canvas.diagramId, xml, hash: digest(xml) }, keys.privateKey)); // NEW
        onVerified({ xml }); // NEW: independent status authorization uses the most recent verified roster.
    } // NEW
    /** Reuse only a successful, caller-independent replay before its next clock transition. */ // NEW
    let failedReplay = null; // NEW: unchanged timeouts do not restart on each background poll.
    async function replayState(xml, records, fingerprint, time, cacheable, retry) {
        if (!retry && failedReplay?.fingerprint === fingerprint) throw failedReplay.error; // NEW // NEW
        const cached = saveCache.get(replayCacheKey); // NEW
        if (cacheable && cached?.fingerprint === fingerprint && time >= cached.observedAt && time < cached.state.nextChangeAt) { // NEW
            cached.observedAt = time; return { state: structuredClone(cached.state), replayCacheHit: true }; // NEW: backward clocks and exact expiry boundaries require replay.
        } // NEW
        let state; try { state = await replayWorker(xml, records, time, reuse => timing({ phase: 'replay cache', ...reuse })); failedReplay = null; } catch (error) { if (error.code === 'REPLAY_TIMEOUT' || error.code === 'ERR_WORKER_OUT_OF_MEMORY') failedReplay = { fingerprint, error }; throw error; } // CHANGE // NEW
        const estimatedBytes = JSON.stringify(state).length * 4 + fingerprint.length * 2 + 768; // NEW: avoid cloning results that cannot fit the existing budget.
        if (cacheable && estimatedBytes <= saveCache.stats().limitBytes) saveCache.set(replayCacheKey, { fingerprint, observedAt: time, state: structuredClone(state) }, estimatedBytes); // NEW
        else saveCache.set(replayCacheKey, null, Infinity); // NEW: oversized replacement removes any previous success without retaining failed validation or a duplicate large result.
        return { state, replayCacheHit: false }; // NEW
    } // NEW
    async function read(retry = false) { // NEW
        const started = performance.now(), readTime = now(); // CHANGE: one clock sample governs validation and the replay cache's validity interval.
        const trust = { coordinatorDeviceId: canvas.coordinatorDeviceId, coordinatorPublicKey: canvas.coordinatorPublicKey, genesisCoordinatorPublicKey: canvas.genesisCoordinatorPublicKey, members: structuredClone(canvas.members), retiredMembers: structuredClone(canvas.retiredMembers || []) }; // NEW: verification and its cache fingerprint must describe the same trust snapshot.
        const indexFile = path.join(profile, 'recovery', canvas.shareId, 'index.json'); // NEW
        const savedCopies = await readJson(indexFile) /* CHANGE */.catch(err => { if (err.code === 'ENOENT') return []; throw err; }); // NEW
        recoveryPaths = savedCopies.filter(p => /^local-[a-f0-9-]{36}\.drawio$/.test(p.filename) || p.filename === canvas.filename).map(p => ({ ...p, recoveryPath: path.join(profile, 'recovery', canvas.shareId, p.filename) })); // NEW
        const counters = { hits: 0, misses: 0 }; // NEW
        let genesis, genesisText; try { genesisText = await readBounded(path.join(directory, 'genesis.json'), LIMITS.record); genesis = verifiedRecord(genesisText, trust.genesisCoordinatorPublicKey || trust.coordinatorPublicKey, counters); } catch (_) { throw new Error('The project snapshot could not be verified.'); } // CHANGE
        if (genesis.payload.schema !== COLLABORATION_VERSION || genesis.payload.shareId !== canvas.shareId || genesis.payload.diagramId !== canvas.diagramId || digest(genesis.payload.xml) !== genesis.payload.hash) throw new Error('The project snapshot could not be verified.'); // CHANGE
        const records = [], errors = [], recordHashes = []; const readBudget = { used: Buffer.byteLength(genesisText), maximum: LIMITS.replay }; // CHANGE // CHANGE: fingerprint the observed bytes, including changes that leave parsed payloads identical.
        const names = await listBounded(path.join(directory, 'records')).catch(err => { if (err.code === 'ENOENT') return []; throw err; }); // NEW
        const members = new Map(trust.members.map(m => [m.deviceId, m])); // CHANGE
        async function readRecord({ name, size, error }) { // CHANGE: metadata batches bound both file count and ordinary input bytes.
            try { // NEW
                if (error) throw error; // NEW
                const filename = path.join(directory, 'records', name); // CHANGE
                if (size > 128 * 1024 * 1024) throw new Error('Collaboration record is too large.'); // NEW
                const text = await readBounded(filename, LIMITS.record, 'utf8', readBudget), envelope = parseJson(text, LIMITS.record), candidate = envelope?.payload; if (!envelope || typeof envelope.signature !== 'string' || !candidate || typeof candidate !== 'object') fail('INVALID_SCHEMA', 'Invalid collaboration envelope.'); // CHANGE: read bytes even for previously verified immutable records.
                const signer = members.get(candidate?.deviceId) || trust.retiredMembers.find(m => m.deviceId === candidate?.deviceId && m.recordIds?.includes(candidate?.id)); // CHANGE
                if (!signer) throw new Error('Invalid or unapproved collaboration record.'); // NEW
                const record = verifiedRecord(text, signer.publicKey, counters), r = record.payload; // NEW
                const retired = trust.retiredMembers.find(m => m.deviceId === r?.deviceId && m.recordIds?.includes(r?.id)); // CHANGE
                const member = members.get(r?.deviceId) || retired; // NEW
                if (!r || r.id + '.json' !== name || r.schema !== COLLABORATION_VERSION || r.shareId !== canvas.shareId || r.diagramId !== canvas.diagramId || !member || !['claim', 'activity', 'edit', 'view', 'request', 'release'].includes(r.kind) || !Number.isSafeInteger(r.clock) || r.clock < 1 || !Number.isFinite(r.at) || !Array.isArray(r.parents) || r.parents.some(id => typeof id !== 'string') || r.targets && (!Array.isArray(r.targets) || r.targets.some(k => typeof k !== 'string'))) throw new Error('Invalid or unapproved collaboration record.'); // CHANGE
                if (r.at > readTime + CLOCK_SKEW_MS) throw new Error('This peer clock is more than five minutes ahead. Correct its clock before sharing edits.'); // CHANGE
                if (r.kind === 'claim' && r.holdPolicy !== undefined && r.holdPolicy !== 'request') throw new Error('Unsupported editing hold policy.'); // NEW
                safeId(r.id); safeId(r.sessionId); validateFields(r); return { hash: digest(text), record: { ...r, retiredAt: members.has(r.deviceId) ? null : retired?.retiredAt } }; // CHANGE: never trust a record's own retirement claim.
            } catch (err) { return { error: { filename: name, ...diagnostic(err, name) } }; } // NEW
        } // NEW
        const sortedNames = names.filter(name => /^[a-zA-Z0-9_-]+\.json$/.test(name)).sort();
        if (sortedNames.length > LIMITS.records) fail('REPLAY_LIMIT', 'Journal record limit exceeded.'); let inputBytes = Buffer.byteLength(genesisText); // NEW // NEW
        for (let offset = 0; offset < sortedNames.length; offset += 32) { // NEW
            const metadata = await Promise.all(sortedNames.slice(offset, offset + 32).map(async name => { // NEW
                try { return { name, size: (await fs.stat(path.join(directory, 'records', name))).size }; } catch (error) { return { name, size: 0, error }; } // NEW
            })); // NEW
            for (const entry of metadata) { inputBytes += entry.size; if (inputBytes > LIMITS.replay) fail('REPLAY_LIMIT', 'Journal byte limit exceeded.'); } // NEW
            const groups = []; let group = [], bytes = 0; // NEW
            for (const entry of metadata) { // NEW
                if (group.length && bytes + entry.size > 8 * 1024 * 1024) { groups.push(group); group = []; bytes = 0; } // NEW
                group.push(entry); bytes += entry.size; // NEW: a single larger record is read alone under the existing 128 MiB limit.
            } // NEW
            if (group.length) groups.push(group); // NEW
            for (const entries of groups) for (const result of await Promise.all(entries.map(readRecord))) { // NEW
                if (result.error?.code === 'REPLAY_LIMIT') fail('REPLAY_LIMIT', 'Journal byte limit exceeded while reading.'); // NEW: an aggregate failure never publishes a partial projection.
                if (result.record) { records.push(result.record); recordHashes.push(result.hash); } else errors.push(result.error); // CHANGE: preserve the original sorted diagnostics and reducer input.
            } // NEW
        } // NEW
        const map = new Map(records.map(r => [r.id, r])); // NEW
        let valid = records.filter(r => { const malformed = r.parents.some(id => map.has(id) && map.get(id).clock >= r.clock); if (malformed) errors.push({ filename: r.id + '.json', reason: 'Invalid causal clock.' }); return !malformed; }); // NEW
        const refused = new Set(errors.map(e => e.filename.replace(/\.json$/, ''))), dependents = new Map(); for (const record of valid) for (const parent of record.parents) { if (!dependents.has(parent)) dependents.set(parent, []); dependents.get(parent).push(record.id); } // CHANGE: propagate rejected ancestry once per edge.
        const rejectedQueue = [...refused]; for (let offset = 0; offset < rejectedQueue.length; offset++) for (const id of dependents.get(rejectedQueue[offset]) || []) if (!refused.has(id)) { refused.add(id); rejectedQueue.push(id); errors.push({ filename: id + '.json', code: 'INVALID_REFERENCE', reason: 'This proposal depends on a rejected or retired peer record.' }); } // NEW
        valid = valid.filter(record => !refused.has(record.id)); // NEW
        const verified = performance.now(); // NEW
        const fingerprint = digest(JSON.stringify([genesisText, recordHashes, trust])); // NEW: byte changes, trust changes, and retired-record allowlists fence reuse.
        const { state, replayCacheHit } = await replayState(genesis.payload.xml, valid, fingerprint, readTime, !errors.length, retry); // CHANGE: recovery annotations below never mutate cached evidence.
        timing({ phase: 'read', verificationMs: verified - started, replayMs: performance.now() - verified, replayCount: replayCacheHit ? 0 : 1, replayCacheHit, records: valid.length, cacheHits: counters.hits, cacheMisses: counters.misses, cacheBytes: saveCache.stats().bytes }); // CHANGE
        const knownProposals = new Set(records.filter(r => r.kind === 'edit').map(r => 'local-' + r.id + '.drawio')); // NEW
        const preservedNames = await fs.readdir(path.join(profile, 'recovery', canvas.shareId)).catch(err => { if (err.code === 'ENOENT') return []; throw err; }); // NEW
        for (const filename of preservedNames) if (/^local-[a-f0-9-]{36}\.drawio$/.test(filename) && !knownProposals.has(filename) && !recoveryPaths.some(p => p.filename === filename)) { // CHANGE
            const recoveryPath = path.join(profile, 'recovery', canvas.shareId, filename), editorDataPath = preservedNames.includes(filename + '.editors.json') ? recoveryPath + '.editors.json' : undefined; // NEW
            recoveryPaths.push({ filename, recoveryPath, ...(editorDataPath ? { editorDataPath } : {}), reason: 'Interrupted local proposal preserved before publication.' }); // NEW: interrupted index writes retain discoverable editor companions too.
        } // NEW
        if (canvas.filename && preservedNames.includes(canvas.filename) && !recoveryPaths.some(p => p.filename === canvas.filename)) recoveryPaths.push({ filename: canvas.filename, recoveryPath: path.join(profile, 'recovery', canvas.shareId, canvas.filename), reason: 'Verified full backup from sharing setup.' }); // CHANGE: the initial full backup remains accessible from the collaboration overview.
        for (const r of records) if (refused.has(r.id)) state.rejected.push({ id: r.id, reason: errors.find(e => e.filename === r.id + '.json')?.reason || 'Rejected predecessor.' }); // NEW
        for (const rejection of state.rejected) { // NEW
            const record = records.find(r => r.id === rejection.id && r.deviceId === deviceId && r.kind === 'edit'); // NEW
            if (!record || recoveryPaths.some(p => p.filename === 'local-' + record.id + '.drawio')) continue; // NEW
            const filename = 'local-' + record.id + '.drawio', recoveryPath = path.join(profile, 'recovery', canvas.shareId, filename); // NEW
            if (await fs.stat(recoveryPath).then(s => s.isFile()).catch(() => false)) recoveryPaths.push({ filename, recoveryPath, reason: rejection.reason }); // NEW
        } // NEW
        latest = { ...state, records: valid, errors, snapshotHash: genesis.payload.hash }; // NEW
        onVerified(latest); // NEW: status processing consumes this evidence without waiting for replay.
        if (recoveryPaths.length !== savedCopies.length) await writeAtomic(indexFile, JSON.stringify(recoveryPaths)); // NEW
        return latest; // NEW
    } // NEW
    async function append(state, actor, kind, fields) { // NEW
        const visible = state.records.filter(r => !state.pending.includes(r.id)); // NEW
        const referenced = new Set(visible.flatMap(r => r.parents || [])); // NEW
        const parents = visible.filter(r => !referenced.has(r.id)).map(r => r.id).sort(); // NEW
        if (state.records.some(r => r.clock >= Number.MAX_SAFE_INTEGER - 1)) throw new Error('A peer published an invalid causal clock.'); // NEW
        const clock = state.records.reduce((highest, record) => Math.max(highest, record.clock), 0) + 1; // NEW: long journals cannot exceed the JavaScript argument-count limit.
        const payload = { schema: COLLABORATION_VERSION, id: makeId(), shareId: canvas.shareId, diagramId: canvas.diagramId, deviceId, userId: actor.userId, sessionId: actor.sessionId, kind, at: now(), clock, parents, ...fields }; // NEW
        const written = performance.now(); // NEW
        await writeImmutable(path.join(directory, 'records', payload.id + '.json'), signRecord(payload, keys.privateKey));
        timing({ phase: 'journal write', durationMs: performance.now() - written }); // NEW // NEW
        return payload; // NEW
    } // NEW
    async function preserve(xml, reason, editorDrafts = []) { // CHANGE
        if (!Array.isArray(editorDrafts) || editorDrafts.some(editor => !editor || !['planting', 'year-planner'].includes(editor.kind) || !Array.isArray(editor.targets))) throw new Error('Invalid editor recovery data.'); // NEW
        const filename = 'local-' + makeId() + '.drawio', recoveryPath = path.join(profile, 'recovery', canvas.shareId, filename); // NEW
        await writeAtomic(recoveryPath, xml); // CHANGE
        const editorDataPath = editorDrafts.length ? recoveryPath + '.editors.json' : undefined; // NEW
        if (editorDataPath) await writeAtomic(editorDataPath, JSON.stringify({ schema: 1, diagramId: canvas.diagramId, at: now(), reason, editors: editorDrafts })); // NEW
        recoveryPaths.push({ filename, recoveryPath, reason, ...(editorDataPath ? { editorDataPath } : {}) }); // CHANGE
        await writeAtomic(path.join(profile, 'recovery', canvas.shareId, 'index.json'), JSON.stringify(recoveryPaths)); return recoveryPath; // NEW
    } // NEW
    async function materialize(state) { // NEW
        const started = performance.now(); // NEW
        if (canvas.localRemoved || canvas.projectRetired) return; // NEW: queued refreshes must never recreate a retired projection.
        await beforeMaterialize(state.xml); // NEW: naming runs inside the same queue as every projection write.
        if (canvas.localRemoved || canvas.projectRetired) return; // NEW
        const existing = await fs.readFile(canvas.diagramPath, 'utf8').catch(err => { if (err.code === 'ENOENT') return null; throw err; }); // NEW
        const markerPath = path.join(profile, 'recovery', canvas.shareId, 'projection.json'); // NEW
        const marker = await readJson(markerPath) /* CHANGE */.catch(err => { if (err.code === 'ENOENT') return null; throw err; }); // NEW
        if (existing && existing !== state.xml && digest(existing) !== (marker?.hash || state.snapshotHash)) await preserve(existing, 'External or interrupted local changes were preserved before rebuilding the project.'); // NEW
        if (existing !== state.xml) await writeAtomic(canvas.diagramPath, state.xml); // NEW
        const hash = digest(state.xml); // CHANGE: unchanged polling must not rewrite the recovery marker.
        if (marker?.hash !== hash) await writeAtomic(markerPath, JSON.stringify({ hash })); // CHANGE
        timing({ phase: 'materialize', durationMs: performance.now() - started, wroteProjection: existing !== state.xml, bytes: Buffer.byteLength(state.xml) }); // NEW
    } // NEW
    function refresh() { // CHANGE
        if (pendingRefresh) return pendingRefresh; // NEW: do not enqueue identical background work repeatedly.
        const task = serialized(async () => { if (pendingRefresh === task) pendingRefresh = null; const previous = latest; const state = await read(); latest = previous; await materialize(state); latest = state; return publicState(state); }, 'refresh'); // CHANGE: an arrival during the active read can request one further refresh.
        pendingRefresh = task; task.finally(() => { if (pendingRefresh === task) pendingRefresh = null; }).catch(() => {}); return task; // NEW
    } // CHANGE
    function publicState(state, sessionId, forcePolicy = false) { // CHANGE
        const parsed = inspectDiagram(state.xml), roster = parsed.store.users || [], labels = new Map(); // CHANGE: presentation needs labels, not a second full object serialization/hash index.
        const pageIds = new Map(parsed.document.pages.map(page => [page.doc, page.container?.getAttribute('id') || ''])); // CHANGE
        for (const cell of parsed.cells) labels.set(JSON.stringify([pageIds.get(cell.node.ownerDocument), cell.id]), cell.node.getAttribute('label') || cell.node.getAttribute('value') || cell.id); // CHANGE
        const identify = value => ({ ...value, name: roster.find(u => u.id === value.userId)?.name || 'Unknown user', requesters: value.requesters?.map(requester => ({ ...requester, name: roster.find(u => u.id === requester.userId)?.name || 'Unknown user' })), objectLabel: value.key === '*' ? 'project structure' : labels.get(value.key), objects: value.targets?.map(key => ({ key, label: labels.get(key) })) }); // CHANGE
        if (policyXml !== state.xml) { // NEW: policy is live metadata, independent of the displayed object XML.
            const permission = permissionSnapshot(parsed); // NEW
            policySnapshot = { store: parsed.store, cells: Object.values(permission.cells), teams: Object.fromEntries(roster.map(user => [user.id, permissions.activeTeams(permission, user.id)])) }; // CHANGE: transmit complete plain policy facts independently of displayed content.
            policyHash = digest(canonical(policySnapshot)); policyXml = state.xml;
        }
        const policy = sessionId && (forcePolicy || policySent.get(sessionId) !== policyHash) ? policySnapshot : undefined; // CHANGE: reopening can reset renderer policy while the actor's journal session survives.
        if (policy) policySent.set(sessionId, policyHash); // NEW
        return { protocolVersion: COLLABORATION_VERSION, sessionId, hash: digest(state.xml), policyHash, policy, holds: state.holds.map(identify), reservations: state.reservations.map(identify), presence: state.presence.map(identify), pending: state.pending.length, errors: state.errors, rejected: state.rejected, recoveries: recoveryPaths }; // CHANGE
    } // NEW
    /** A no-peer action still writes a signed durable proposal and succeeds locally. */ // NEW
    async function action(callerId, userId, input) { // NEW
        const actor = { callerId, userId, sessionId: sessionFor(callerId, userId) }; // NEW: capture ownership before entering the queue; a closing window cannot recreate its session.
        return serialized(async () => { // NEW
            if (canvas.revoked || canvas.pending) throw new Error('This computer is not approved to edit this project.'); // NEW
            const cachedRead = ['changes', 'review', 'ack-refresh', 'history-state'].includes(input.kind); // NEW: these read the latest verified state; refresh preparation and every edit re-read the journal.
            let state = cachedRead && latest ? latest : await read(input.retry === true), journalChanged = false; const authorityContext = { at: now() }; // CHANGE: local checks use an explicit operation time.
            if (input.kind === 'open-view' || input.kind === 'get') { // NEW: only this process owns the live local session registry.
                const active = new Set(sessions.values()), abandoned = new Map(); // NEW
                for (const hold of state.holds) if (hold.deviceId === deviceId && !active.has(hold.sessionId)) abandoned.set(hold.sessionId, hold); // NEW
                for (const hold of abandoned.values()) { await append(state, hold, 'release', {}); state = await read(); } // NEW
            } // NEW
            if (input.kind === 'recover-holds') { // NEW: private recovery remains possible after editing authority is revoked.
                inspectDiagram(input.xml); inspectDiagram(input.baseXml); // NEW
                const recovered = revertDraftChanges(input.baseXml, input.xml, input.targets || [], input.actions || []); // NEW
                const recoveryPath = await preserve(input.xml, input.reason || 'Editing hold ended; affected unsaved actions were reverted.', input.editorDrafts || []); // NEW
                return { ok: true, ...recovered, recoveryPath, editorDataPath: recoveryPaths.at(-1).editorDataPath, collaboration: publicState(state, actor.sessionId) }; // NEW
            } // NEW
            if (input.kind === 'recovery-data') { // NEW: derive paths locally; a renderer may select only an indexed recovery filename.
                const copy = recoveryPaths.find(copy => copy.filename === input.filename && copy.editorDataPath); // NEW
                if (!copy || !/^local-[a-f0-9-]{36}\.drawio$/.test(copy.filename)) throw new Error('Unknown editor recovery copy.'); // NEW
                const data = await readJson(path.join(profile, 'recovery', canvas.shareId, copy.filename + '.editors.json')) /* CHANGE */; // NEW
                return { ok: true, data, collaboration: publicState(state, actor.sessionId) }; // NEW
            } // NEW
            const roster = inspectDiagram(state.xml).store; // NEW
            const actorKey = JSON.stringify([callerId, userId]), checkpoint = checkpointRetries.get(actorKey); // NEW
            if (checkpoint && ['save', 'projectName'].includes(input.kind)) { // CHANGE: complete the accepted save checkpoint before deriving any subsequent local changes.
                await views.saved(actor, checkpoint.baseXml, checkpoint.xml);
                checkpointRetries.delete(actorKey);
                if (input.baseXml === checkpoint.baseXml) input = { ...input, baseXml: checkpoint.xml };
            }
            if (input.kind === 'projectName') { // NEW
                if (!roster.users?.some(user => user.id === userId && user.admin && !user.disabled)) throw new Error('Only an active project administrator can change the shared project name.'); // NEW
                const ownView = views.get(actor), baseXml = ownView?.xml || state.xml; // NEW: a window's own rename follows its freshness and remembered-object boundary.
                input = { kind: 'save', baseXml, xml: withProjectName(baseXml, naming.projectName(input.name)), explicitRefresh: !!ownView }; // CHANGE
            } // NEW
            if (!roster.users?.some(u => u.id === userId && !u.disabled) && !roster.invites?.some(i => i.pendingUserId === userId && i.status === 'pending' && i.expiresAt > now())) { // CHANGE
                if (input.explicitRefresh) { // CHANGE: revoke live renderer authority without losing a submitted diagram proposal.
                    const recoveryPath = input.kind === 'save' && input.xml ? await preserve(input.xml, 'The submitting user is no longer active.') : undefined;
                    return { ok: false, reason: 'Log in with an active project user.', recoveryPath, collaboration: publicState(state, actor.sessionId, true) };
                }
                throw new Error('Log in with an active project user.');
            }
            if (input.kind === 'draft-review') return { ok: true, review: reviewDraft(input.baseXml, input.xml, state.xml), collaboration: publicState(state, actor.sessionId) }; // NEW
            if (input.kind === 'draft-resolve') { // NEW
                const resolution = resolveDraft(input.baseXml, input.xml, state.xml, input); // NEW
                if (!resolution.ok) return { ...resolution, collaboration: publicState(state, actor.sessionId) }; // NEW
                if (input.mode === 'later') return { ok: true, resolution, collaboration: publicState(state, actor.sessionId) }; // NEW
                await preserve(input.xml, 'Original draft retained before explicit conflict resolution.', input.editorDrafts || []); // NEW
                if (input.mode === 'accepted') { await views.saved(actor, input.baseXml, resolution.baseXml); return { ok: true, resolution, collaboration: publicState(state, actor.sessionId) }; } // NEW
                input = { kind: 'save', baseXml: state.xml, xml: resolution.xml, resolution, originalBaseXml: input.baseXml }; // NEW: all submitted content still passes ordinary claim and permission validation.
            } // NEW
            if (['open-view', 'reset-view', 'changes', 'review', 'prepare-refresh', 'ack-refresh'].includes(input.kind)) { // NEW
                const started = performance.now(), result = await views.action(actor, input, state); // NEW
                timing({ phase: input.kind, durationMs: performance.now() - started }); // NEW
                return { ok: true, ...result, objectViews: 1, collaboration: publicState(state, actor.sessionId, ['open-view', 'reset-view'].includes(input.kind)) }; // CHANGE
            } // NEW
            if (input.kind === 'history-state') return { ok: true, xml: state.xml, collaboration: publicState(state, actor.sessionId) }; // NEW
            if (input.explicitRefresh && ['claim', 'save'].includes(input.kind) && !views.get(actor)) return { ok: false, reason: 'Open or explicitly recover your remembered objects before editing.', collaboration: publicState(state, actor.sessionId) }; // NEW
            if (input.kind === 'get') { // NEW
                await materialize(state); // NEW
            } else if (input.kind === 'view') { // NEW
                const index = objects(state.xml); const targets = [...new Set((input.objects || []).filter(k => index.has(k)).map(k => logicalKey(index, k)))]; // NEW
                const previous = state.records.filter(r => r.sessionId === actor.sessionId && r.kind === 'view').sort((a, b) => b.clock - a.clock)[0]; // NEW
                if (!previous || JSON.stringify(previous.targets) !== JSON.stringify(targets) || now() - previous.at >= PRESENCE_MS / 2) { await append(state, actor, 'view', { targets }); journalChanged = true; } // CHANGE
            } else if (input.kind === 'request') { // NEW
                const holds = state.holds.filter(h => (input.targets || []).includes(h.key) && h.sessionId !== actor.sessionId); // NEW
                if (holds.some(h => authorityFor(state.xml, h.key, userId, authorityContext) < 1)) throw new Error('You cannot request editing access to this object.'); // CHANGE
                await append(state, actor, 'request', { claimIds: [...new Set(holds.map(h => h.claimId))] }); // NEW
                journalChanged = true; // CHANGE
            } else if (input.kind === 'release') { // NEW
                await append(state, actor, 'release', input.targets === undefined ? {} : { targets: input.targets }); // CHANGE: omitted fields must stay omitted after signing and JSON serialization.
                journalChanged = true; // CHANGE
            } else if (input.kind === 'claim' || input.kind === 'save') { // NEW
                if (input.kind === 'save') { const started = performance.now(); input = { ...input, xml: await prepareXml(input.xml) }; timing({ phase: 'assets', durationMs: performance.now() - started }); } // CHANGE
                let delta; // CHANGE: full-proposal diffing already constructs its own validated object indexes.
                if (input.kind === 'claim' && !input.xml) { const index = objects(state.xml); delta = { changes: [{}], targets: [...new Set((input.targets || []).filter(k => index.has(k)).flatMap(k => targetsForObject(index, k)))] }; } // CHANGE
                else delta = diffObjects(input.baseXml, input.xml); // CHANGE
                if (input.kind === 'save' && delta.changes.length) { // NEW
                    const permission = validatePermissionChanges(input.baseXml, input.xml, userId, now(), { policy: permissionSnapshot(inspectDiagram(state.xml)) }); // NEW
                    if (!permission.allowed) { const recoveryPath = await preserve(input.xml, permission.reason); return { ok: false, code: 'PERMISSION_DENIED', reason: permission.reason, recoveryPath, collaboration: publicState(state, actor.sessionId) }; } // NEW: reject the complete proposal before selecting independent conflict-free groups.
                } // NEW
                if (input.kind === 'save' && !input.resolution) { // NEW
                    const review = reviewDraft(input.baseXml, input.xml, state.xml); // NEW
                    if (review.groups.some(group => group.conflict) && !review.canApplyNonConflicting) { const recoveryPath = await preserve(input.xml, 'Conflicting local draft preserved for review.'); return { ok: false, code: 'CONFLICT', staleView: !!input.explicitRefresh, reason: 'The object changed; review conflicting changes before applying them.', review, recoveryPath, collaboration: publicState(state, actor.sessionId) }; } // NEW
                    if (review.groups.some(group => group.conflict || group.alreadyApplied)) { // NEW
                        const originalBaseXml = input.baseXml, resolution = resolveDraft(input.baseXml, input.xml, state.xml, { token: review.token, mode: 'non-conflicting' }); // NEW
                        await preserve(input.xml, 'Draft retained while independent groups are applied.'); // NEW
                        input = { ...input, baseXml: state.xml, xml: resolution.xml, resolution, originalBaseXml: originalBaseXml, explicitRefresh: false }; delta = diffObjects(input.baseXml, input.xml); // NEW
                    } // NEW
                } // NEW
                if (input.kind === 'save' && delta.changes.length) { const blocked = await beforeCommit(actor, delta.targets); if (blocked.length) { const recoveryPath = await preserve(input.xml, 'A connected editor still holds this group.'); return { ok: false, code: 'EDITING_BUSY', reason: 'Another connected user is editing this object. Your draft is preserved.', blocked, recoveryPath, collaboration: publicState(state, actor.sessionId) }; } } // NEW
                const view = input.explicitRefresh && views.get(actor); // NEW
                const missing = input.kind === 'save' && Array.isArray(input.claimIds) ? delta.targets.filter(key => !state.holds.some(h => h.key === key && h.sessionId === actor.sessionId && input.claimIds.includes(h.claimId))) : []; // NEW
                const denied = delta.targets.filter(key => authorityFor(state.xml, key, userId, authorityContext) < 1); // NEW
                if (input.kind === 'save' && delta.changes.length && missing.length) { // NEW
                    const reason = 'The editing hold expired or was replaced. Recover and revert its affected unsaved actions before saving.'; // CHANGE
                    const recoveryPath = await preserve(input.xml, reason); // NEW
                    return { ok: false, code: 'HOLD_LOST', targets: missing, reason, recoveryPath, xml: input.explicitRefresh ? undefined : state.xml, collaboration: publicState(state, actor.sessionId) }; // CHANGE
                } // NEW
                if (view && delta.changes.length) { // NEW: stale views cannot acquire holds or publish reversions, even through a delayed form.
                    const pending = views.pending(actor, state); // CHANGE
                    const intersects = group => group.targets.includes('*') || delta.targets.includes('*') || group.targets.some(key => delta.targets.includes(key)); // NEW
                    if (pending.some(intersects)) return { ok: false, staleView: true, reason: 'Refresh this object and its related changes before editing. Unapplied dialog entries were discarded.', collaboration: publicState(state, actor.sessionId) }; // NEW
                } // NEW
                if (input.kind === 'claim' && !delta.targets.length && (!input.xml || delta.changes.length)) throw new Error('Select the object to edit first.'); // CHANGE: a supplied document with no net content change needs no hold; rejecting it would roll back a completed Undo batch.
                if (delta.changes.length) { // NEW
                    if (input.xml) validateProjectNameChange(input.baseXml, input.xml, userId, state.xml); // CHANGE: target-only claims contain no naming edit to validate.
                    const blocked = state.holds.filter(h => (delta.targets.includes(h.key) || h.key === '*' || delta.targets.includes('*')) && h.sessionId !== actor.sessionId); // NEW
                    const reserved = state.reservations.filter(h => delta.targets.includes(h.key) && h.sessionId !== actor.sessionId); // NEW
                    if (blocked.length || reserved.length) { // NEW
                        const reason = 'Another user is editing or has the next editing turn. The entire action was rejected.'; // NEW
                        const recoveryPath = await preserve(input.xml || state.xml, reason); // NEW
                        return { ok: false, reason, blocked, recoveryPath, xml: state.xml, collaboration: publicState(state, actor.sessionId) }; // NEW
                    } // NEW
                    const stale = input.kind === 'save' && Array.isArray(input.claimIds) && delta.targets.some(key => !state.holds.some(h => h.key === key && h.sessionId === actor.sessionId && input.claimIds.includes(h.claimId))); // NEW
                    const usersAction = !!input.usersPolicyAction || state.records.some(r => r.kind === 'claim' && r.sessionId === actor.sessionId && r.deviceId === deviceId && r.usersPolicyAction && state.holds.some(h => h.claimId === r.id)); // NEW
                    let accountSetup = false; if (usersAction && input.xml) try { accountSetup = invitationAcceptance(state.xml, applyChanges(state.xml, delta.changes), userId, now()); } catch (_) {} // NEW: reuse the signed Users bootstrap after validating its saved invitation transition.
                    if (stale || !accountSetup && delta.targets.some(k => authorityFor(state.xml, k, userId, authorityContext) < 1)) { // CHANGE
                        const reason = stale ? 'This draft belongs to an expired or replaced editing hold. Begin a new edit before applying it.' : 'This edit includes an object you can no longer manage.'; // NEW
                        const recoveryPath = await preserve(input.xml || state.xml, reason); // NEW
                        return { ok: false, code: 'HOLD_LOST', targets: stale ? delta.targets : denied, reason, recoveryPath, xml: state.xml, collaboration: publicState(state, actor.sessionId) }; // CHANGE
                    } // NEW
                    let holds = state.holds.filter(h => delta.targets.includes(h.key) && h.sessionId === actor.sessionId); // NEW
                    if (delta.targets.some(k => !holds.some(h => h.key === k))) { // NEW
                        await append(state, actor, 'claim', { targets: delta.targets, holdPolicy: 'request', ...(accountSetup ? { usersPolicyAction: true, policyChanges: delta.changes } : {}) }); state = await read(); // CHANGE
                        holds = state.holds.filter(h => delta.targets.includes(h.key) && h.sessionId === actor.sessionId); // NEW
                        if (delta.targets.some(key => !holds.some(h => h.key === key))) { // NEW
                            const reason = 'A concurrent editing claim has priority. Your entire action was preserved locally.'; // NEW
                            const recoveryPath = await preserve(input.xml || state.xml, reason); // NEW
                            return { ok: false, reason, recoveryPath, xml: state.xml, collaboration: publicState(state, actor.sessionId) }; // NEW
                        } // NEW
                    } else if (input.kind === 'claim') { await append(state, actor, 'activity', { targets: delta.targets, claimIds: [...new Set(holds.map(h => h.claimId))] }); journalChanged = true; } // CHANGE: activity renews a hold without publishing private form fields.
                    if (input.kind === 'save') { // NEW
                        const id = makeId(); // NEW
                        await writeAtomic(path.join(profile, 'recovery', canvas.shareId, 'local-' + id + '.drawio'), input.xml); // NEW: keep the exact submitted proposal before any peer can reject it, including after restart.
                        const edit = await append(state, actor, 'edit', { id, targets: delta.targets, changes: delta.changes, claimIds: [...new Set(holds.map(h => h.claimId))] }); // NEW
                        await append({ ...state, records: [...state.records, edit] }, actor, 'release', { targets: delta.targets }); // NEW: durable claims protect this commit only; live leases are reported independently.
                        state = await read(); const rejection = state.rejected.find(r => r.id === edit.id); // NEW
                        if (rejection) { const recoveryPath = await preserve(input.xml, rejection.reason); const ended = delta.targets.filter(key => !state.holds.some(hold => hold.key === key && hold.sessionId === actor.sessionId)); return { ok: false, ...rejection, ...(ended.length ? { code: 'HOLD_LOST', targets: ended } : {}), recoveryPath, xml: state.xml, collaboration: publicState(state, actor.sessionId) }; } // CHANGE
                        if (!state.accepted.includes(edit.id)) throw new Error('Changes are preserved locally but are waiting for missing predecessor records.'); // NEW
                    } // NEW
                } // NEW
            } else throw new Error('Unsupported collaboration action.'); // NEW
            if (journalChanged) state = await read(); // CHANGE: claim/edit writes already refreshed state; read-only actions need one replay.
            if (input.kind === 'save' && input.explicitRefresh && views.get(actor)) checkpointRetries.set(actorKey, { baseXml: input.baseXml, xml: input.xml }); // NEW: projection-write failure must also leave an idempotent accepted-save retry.
            if (input.kind === 'save') await materialize(state); // NEW: even a no-op save must refresh the durable local projection.
            if (input.kind === 'save' && input.explicitRefresh && views.get(actor)) { // CHANGE
                await views.saved(actor, input.baseXml, input.xml);
                checkpointRetries.delete(actorKey);
            }
            if (input.resolution && views.get(actor)) await views.saved(actor, input.originalBaseXml, input.resolution.baseXml); // NEW
            return { ok: true, resolution: input.resolution, xml: input.explicitRefresh ? undefined : state.xml, objectViews: 1, collaboration: publicState(state, actor.sessionId) }; // CHANGE: status and save replies never carry incoming canvas content in explicit mode.
        }); // NEW
    } // NEW
    /** Remove ownership immediately, then release the captured generation without touching a replacement session. */ // NEW
    function forget(callerId) { // NEW
        views.forget(callerId); // NEW
        for (const key of checkpointRetries.keys()) if (JSON.parse(key)[0] === callerId) checkpointRetries.delete(key); // NEW: a reopened window must not replay a previous window's outstanding private write.
        for (const [key, sessionId] of [...sessions]) if (key.startsWith(callerId + ':')) { // NEW
            const actor = { userId: key.slice(String(callerId).length + 1), sessionId }; sessions.delete(key); policySent.delete(sessionId); // NEW
            serialized(async () => { const state = await read(); await append(state, actor, 'release', {}); }).catch(() => {}); // NEW
        } // NEW
    } // NEW
    return { initialize, refresh, action, read, sessionFor, peek: () => latest, snapshot: () => serialized(read), runExclusive: serialized, saveRecovery: (xml, editorDrafts = []) => serialized(async () => { await read(); const recoveryPath = await preserve(xml, 'Manually saved recovery copy.', editorDrafts); return { recoveryPath, filename: path.basename(recoveryPath), editorDataPath: recoveryPaths.at(-1).editorDataPath }; }), flush: () => queue, forget }; // CHANGE
} // NEW
