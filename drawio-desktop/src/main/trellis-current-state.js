/** Protocol 4 current-state persistence. Ordinary operations never enumerate an archive. */ // NEW
import path from 'node:path'; // NEW
import { readJson, LIMITS } from './trellis-input-policy.js'; // NEW
import { canonical, digest, signRecord, verifyRecord, safeId, makeId, inspectDiagram } from './trellis-share-protocol.js'; // NEW
import { applyChanges, diffObjects, objects, authorityFor, invitationAcceptance, rosterChangeAllowed, HOLD_MS, HANDOFF_MS, REQUEST_GRACE_MS, PRESENCE_MS } from './trellis-collaboration-protocol.js'; // CHANGE
import { validatePermissionChanges } from './trellis-permission-policy.js'; // NEW
import { validateProjectNameChange } from './trellis-project-naming.js'; // NEW

export const CURRENT_PROTOCOL = 4; // NEW
export const CHECKPOINT_INTERVAL = 30; // NEW
const sameActor = (left, right) => left.deviceId === right.deviceId && left.sessionId === right.sessionId && left.userId === right.userId; // NEW
const overlaps = (left, right) => left === '*' || right === '*' || left === right; // NEW

/** Invitation holds remain valid only while their exact account-acceptance change is authorized. */ // NEW
function holdAuthorized(state, hold, time) { // NEW
    if (authorityFor(state.xml, hold.key, hold.userId, { at: time }) > 0) return true; // NEW
    if (!hold.usersPolicyAction || !hold.policyChanges) return false; // NEW
    try { return invitationAcceptance(state.xml, applyChanges(state.xml, hold.policyChanges), hold.userId, time); } catch (_) { return false; } // NEW
} // NEW

/** Reserve a released object for its highest-authority eligible waiter, preserving accepted queue order. */ // NEW
function reserveReleased(state, holds, time) { // NEW
    const reservations = state.reservations.filter(item => item.until > time && authorityFor(state.xml, item.key, item.userId, { at: time }) > 0); // CHANGE
    for (const hold of holds) { // NEW
        const endedAt = Math.min(hold.expiresAt ?? time, time); // NEW
        if (endedAt + HANDOFF_MS <= time) continue; // NEW
        const candidates = (hold.requesters || []).filter(item => authorityFor(state.xml, hold.key, item.userId, { at: time }) > 0); // NEW
        candidates.sort((a, b) => authorityFor(state.xml, hold.key, b.userId, { at: time }) - authorityFor(state.xml, hold.key, a.userId, { at: time })); // NEW
        if (candidates.length) reservations.push({ key: hold.key, ...candidates[0], previousSession: hold.sessionId, until: endedAt + HANDOFF_MS }); // NEW
    } // NEW
    return reservations; // NEW
} // NEW

/** Expiry projects current holds forward; historical claims cannot overturn accepted changes. */ // NEW
export function expireCurrentState(state, time) { // NEW
    const holds = [], released = []; // CHANGE
    for (const hold of state.holds) ((hold.expiresAt === null || hold.expiresAt > time) && holdAuthorized(state, hold, time) ? holds : released).push(hold); // CHANGE
    return { ...state, holds, presence: state.presence.filter(item => item.at + PRESENCE_MS > time), reservations: reserveReleased(state, released, time) }; // CHANGE
} // NEW

/** Validate a single transaction against accepted content, retaining every domain check. */ // NEW
export function validateCurrentEdit(state, proposal) { // NEW
    const proposed = applyChanges(state.xml, proposal.changes); // NEW
    const context = { at: proposal.at }; // NEW
    const bootstrap = state.holds.some(hold => proposal.claimIds?.includes(hold.claimId) && hold.usersPolicyAction) && invitationAcceptance(state.xml, proposed, proposal.userId, proposal.at); // NEW
    if (!Array.isArray(proposal.targets) || !proposal.targets.length || proposal.targets.some(key => !state.holds.some(hold => hold.key === key && sameActor(hold, proposal) && proposal.claimIds?.includes(hold.claimId)) || !bootstrap && authorityFor(state.xml, key, proposal.userId, context) < 1)) throw new Error('The editing hold expired or another editor has priority.'); // NEW
    if (diffObjects(state.xml, proposed).targets.some(key => !proposal.targets.includes(key))) throw new Error('The group edit did not acquire every dependent object.'); // NEW
    const decision = validatePermissionChanges(state.xml, proposed, proposal.userId, proposal.at); // NEW
    if (!decision.allowed) throw new Error(decision.reason); // NEW
    validateProjectNameChange(state.xml, proposed, proposal.userId); // NEW
    const before = inspectDiagram(state.xml).store, after = inspectDiagram(proposed).store; // NEW
    if (canonical(before) !== canonical(after) && !rosterChangeAllowed(before, after, proposal.userId, state.xml, proposal.at)) throw new Error('The roster change is not an authorized invitation or account action.'); // NEW
    return proposed; // NEW
} // NEW

/** Apply exactly one authorized coordinator decision without consulting prior journal records. */ // NEW
export function applyCurrentEvent(previous, proposal) { // NEW
    if (!proposal || !['claim', 'release', 'request', 'view', 'activity', 'edit', 'save'].includes(proposal.kind) || typeof proposal.userId !== 'string' || !proposal.userId || !Number.isFinite(proposal.at)) throw new Error('Invalid current-state proposal.'); // CHANGE
    safeId(proposal.id); safeId(proposal.sessionId); safeId(proposal.deviceId); // NEW
    if (proposal.targets && (!Array.isArray(proposal.targets) || proposal.targets.some(key => { // NEW
        if (key === '*') return false; // NEW
        try { const pair = JSON.parse(key); return !Array.isArray(pair) || pair.length !== 2 || pair.some(part => typeof part !== 'string') || !pair[1]; } catch (_) { return true; } // NEW
    }))) throw new Error('Invalid proposal targets.'); // NEW
    if (proposal.kind === 'save') { // NEW: transient holds, validation, and release form one indivisible accepted decision.
        const claimed = applyCurrentEvent(previous, { ...proposal, kind: 'claim', holdPolicy: 'request', policyChanges: proposal.changes }); // NEW
        const edited = applyCurrentEvent(claimed, { ...proposal, kind: 'edit', claimIds: [proposal.id] }); // NEW
        return applyCurrentEvent(edited, { ...proposal, kind: 'release' }); // NEW
    } // NEW
    let state = expireCurrentState(previous, proposal.at); // NEW
    const context = { at: proposal.at }; // NEW
    if (proposal.kind === 'claim') { // NEW
        const targets = proposal.targets || []; // NEW
        const bootstrap = proposal.usersPolicyAction && proposal.policyChanges && invitationAcceptance(state.xml, applyChanges(state.xml, proposal.policyChanges), proposal.userId, proposal.at); // NEW
        if (!targets.length || targets.some(key => !bootstrap && authorityFor(state.xml, key, proposal.userId, context) < 1 || state.holds.some(hold => overlaps(hold.key, key) && !sameActor(hold, proposal)) || state.reservations.some(item => overlaps(item.key, key) && !sameActor(item, proposal)))) throw new Error('Another editing hold has priority, or access changed.'); // CHANGE
        const holds = state.holds.filter(hold => !targets.includes(hold.key)); // NEW
        for (const key of targets) { // CHANGE
            const previous = state.holds.find(hold => hold.key === key && sameActor(hold, proposal)); // NEW
            const expiry = proposal.holdPolicy === 'request' ? null : proposal.at + HOLD_MS; // NEW
            holds.push({ key, claimId: proposal.id, deviceId: proposal.deviceId, sessionId: proposal.sessionId, userId: proposal.userId, activeAt: proposal.at, expiresAt: previous?.requested ? Math.min(previous.expiresAt, expiry ?? Infinity) : expiry, ...(bootstrap ? { usersPolicyAction: true, policyChanges: proposal.policyChanges } : {}), ...(previous?.requested ? { requested: true } : {}), requesters: previous?.requesters || [] }); // NEW
        } // NEW
        state = { ...state, holds, reservations: state.reservations.filter(item => !targets.some(key => overlaps(item.key, key))) }; // CHANGE
    } else if (proposal.kind === 'release') { // NEW
        const released = state.holds.filter(hold => sameActor(hold, proposal) && (!proposal.targets || proposal.targets.includes(hold.key))); // NEW
        state = { ...state, holds: state.holds.filter(hold => !released.includes(hold)).map(hold => ({ ...hold, requesters: hold.requesters.filter(item => !sameActor(item, proposal)) })), reservations: reserveReleased(state, released, proposal.at).filter(item => !sameActor(item, proposal)), presence: state.presence.filter(item => !sameActor(item, proposal)) }; // CHANGE
    } else if (proposal.kind === 'request') { // NEW
        state = { ...state, holds: state.holds.map(hold => { // NEW
            if (!proposal.claimIds?.includes(hold.claimId) || sameActor(hold, proposal)) return hold; // NEW
            if (authorityFor(state.xml, hold.key, proposal.userId, context) < 1) throw new Error('You cannot request editing access to this object.'); // NEW
            const requesters = hold.requesters.some(item => sameActor(item, proposal)) ? hold.requesters : [...hold.requesters, { deviceId: proposal.deviceId, sessionId: proposal.sessionId, userId: proposal.userId }]; // NEW
            return { ...hold, requested: true, requesters, expiresAt: Math.min(hold.expiresAt ?? Infinity, proposal.at + REQUEST_GRACE_MS) }; // NEW
        }) }; // NEW
    } else if (proposal.kind === 'view') { // NEW
        state = { ...state, presence: [...state.presence.filter(item => !sameActor(item, proposal)), proposal] }; // NEW
    } else if (proposal.kind === 'activity') { // NEW
        state = { ...state, holds: state.holds.map(hold => sameActor(hold, proposal) && proposal.claimIds?.includes(hold.claimId) ? { ...hold, activeAt: proposal.at, expiresAt: hold.expiresAt === null ? null : hold.requested ? Math.min(hold.expiresAt, proposal.at + HOLD_MS) : proposal.at + HOLD_MS } : hold) }; // CHANGE: activity cannot postpone a requested handoff.
    } else if (proposal.kind === 'edit') { // NEW
        const xml = validateCurrentEdit(state, proposal), index = objects(xml), attribution = { ...state.attribution }; // NEW
        if (proposal.changes.some(change => change.key === '*')) { for (const key of Object.keys(attribution)) delete attribution[key]; } // NEW
        for (const key of proposal.changes.some(change => change.key === '*') ? index.keys() : proposal.changes.map(change => change.key)) { // NEW
            if (index.has(key)) attribution[key] = { id: proposal.id, kind: 'edit', userId: proposal.userId, deviceId: proposal.deviceId, at: proposal.at, key, hash: index.get(key).hash, targets: proposal.targets }; // NEW
            else delete attribution[key]; // NEW: resident attribution is bounded by current objects, never lifetime deletions.
        } // NEW
        state = { ...state, xml, attribution, lastEditId: proposal.id }; // NEW
    } else throw new Error('Unsupported protocol 4 transaction.'); // NEW
    return expireCurrentState(state, proposal.at); // CHANGE: policy revocation ends holds at the accepted policy change, never at a later observer's clock.
} // NEW

/** Present only active claims and current object attribution to existing review code. */ // NEW
export function currentSnapshot(state, time) { // NEW
    const projected = structuredClone(expireCurrentState(state, time)), grouped = new Map(); // CHANGE: callers cannot mutate resident accepted evidence.
    for (const item of Object.values(projected.attribution)) { // NEW
        if (!grouped.has(item.id)) grouped.set(item.id, { id: item.id, kind: 'edit', userId: item.userId, deviceId: item.deviceId, at: item.at, targets: item.targets, changes: [] }); // NEW
        grouped.get(item.id).changes.push({ key: item.key, hash: item.hash }); // NEW
    } // NEW
    const edits = [...grouped.values()], claims = new Map(); // NEW
    for (const hold of projected.holds) { // NEW
        if (!claims.has(hold.claimId)) claims.set(hold.claimId, { ...hold, id: hold.claimId, kind: 'claim', targets: [] }); // NEW
        claims.get(hold.claimId).targets.push(hold.key); // NEW
    } // NEW
    return { ...projected, records: [...edits, ...claims.values(), ...projected.presence], accepted: [...new Set([...edits.map(item => item.id), ...(projected.lastEditId ? [projected.lastEditId] : [])])], rejected: [], pending: [], errors: [] }; // NEW
} // NEW

/** Signed checkpoint plus a bounded tail is the restart boundary; archives are write-only here. */ // NEW
export function createCurrentStateStore({ canvas, deviceId, keys, writeAtomic, writeImmutable, now = Date.now, onTiming = () => {} }) { // NEW
    const directory = path.join(canvas.folderPath, '.trellis', 'collaboration-v4'); // NEW
    let state = null, head = null, checkpointDue = false; // NEW
    const publicKey = id => id === deviceId ? keys.publicKey : canvas.members.find(member => member.deviceId === id)?.publicKey; // NEW
    const headFile = () => path.join(directory, 'heads', safeId(canvas.coordinatorDeviceId) + '.json'); // NEW
    const recordFile = (epoch, sequence) => path.join(directory, 'epochs', safeId(epoch), String(sequence).padStart(12, '0') + '.json'); // NEW
    const scope = payload => payload?.schema === CURRENT_PROTOCOL && payload.shareId === canvas.shareId && payload.diagramId === canvas.diagramId; // NEW
    function verify(envelope, key) { // NEW
        if (!scope(envelope?.payload) || !verifyRecord(envelope, key)) throw new Error('Invalid protocol 4 scope or signature.'); // NEW
        return envelope.payload; // NEW
    } // NEW
    async function immutable(filename, envelope) { // NEW
        try { await writeImmutable(filename, envelope); } catch (error) { // NEW
            if (error.code !== 'EEXIST' || canonical(await readJson(filename, LIMITS.record)) !== canonical(envelope)) throw error; // NEW
        } // NEW
    } // NEW
    async function publishHead(next) { // NEW
        await writeAtomic(headFile(), JSON.stringify(signRecord({ schema: CURRENT_PROTOCOL, shareId: canvas.shareId, diagramId: canvas.diagramId, ...next }, keys.privateKey))); // NEW
        head = next; // NEW
    } // NEW
    async function checkpoint(refresh = true) { // CHANGE
        const started = performance.now(); // NEW
        if (canvas.coordinatorDeviceId !== deviceId) throw new Error('Only the approved coordinator may publish a checkpoint.'); // NEW
        if (refresh || !state) await read(); // CHANGE: a public checkpoint must cover the current accepted head, including decisions received since the last local operation.
        const payload = { schema: CURRENT_PROTOCOL, shareId: canvas.shareId, diagramId: canvas.diagramId, kind: 'checkpoint', deviceId, state, members: canvas.members, membershipVersion: canvas.membershipVersion || 0 }; // NEW
        const envelope = signRecord(payload, keys.privateKey), checkpointId = digest(canonical(envelope)); // NEW
        await immutable(path.join(directory, 'checkpoints', checkpointId + '.json'), envelope); // NEW
        await publishHead({ ...head, checkpointId, checkpointSequence: state.sequence }); // NEW
        checkpointDue = false; // NEW
        onTiming({ phase: 'checkpoint', durationMs: performance.now() - started, sequence: state.sequence, replayCount: 0, historicalRecordsRead: 0 }); // CHANGE
    } // NEW
    async function initialize(xml) { // NEW
        if (canvas.coordinatorDeviceId !== deviceId) throw new Error('Only the approved coordinator may create the project snapshot.'); // NEW
        objects(xml); // NEW
        const genesis = signRecord({ schema: CURRENT_PROTOCOL, shareId: canvas.shareId, diagramId: canvas.diagramId, kind: 'genesis', deviceId, xml, hash: digest(xml) }, keys.privateKey); // NEW
        const existing = await readJson(path.join(directory, 'genesis.json'), LIMITS.record).catch(error => { if (error.code === 'ENOENT') return null; throw error; }); // NEW
        if (existing) { // NEW
            if (canonical(existing) !== canonical(genesis)) throw new Error('The project already has a different initial snapshot.'); // NEW
            return read(); // NEW: repeated setup must never reset an accepted position.
        } // NEW
        await immutable(path.join(directory, 'genesis.json'), genesis); // NEW
        state = { xml, sequence: 0, epoch: 'initial-' + safeId(deviceId), headHash: digest(canonical(genesis)), snapshotHash: digest(xml), attribution: {}, holds: [], presence: [], reservations: [] }; // NEW
        head = { deviceId, epoch: state.epoch, sequence: 0, hash: state.headHash }; // NEW
        await checkpoint(false); // CHANGE: initialization has not published its first head yet.
        return currentSnapshot(state, now()); // NEW
    } // NEW
    async function read() { // NEW
        const started = performance.now(); let applied = 0; // NEW
        const envelope = await readJson(headFile(), LIMITS.metadata); // NEW
        const incoming = verify(envelope, canvas.coordinatorPublicKey); // NEW
        if (incoming.deviceId !== canvas.coordinatorDeviceId || !Number.isSafeInteger(incoming.sequence) || incoming.sequence < 0 || !Number.isSafeInteger(incoming.checkpointSequence) || incoming.checkpointSequence < 0 || incoming.checkpointSequence > incoming.sequence || incoming.sequence - incoming.checkpointSequence > CHECKPOINT_INTERVAL || !/^[a-f0-9]{64}$/.test(incoming.checkpointId)) throw new Error('Invalid current-state head.'); // NEW
        if (state && (incoming.epoch !== state.epoch || incoming.sequence < state.sequence || incoming.sequence === state.sequence && incoming.hash !== state.headHash)) throw new Error('Coordinator head regressed or diverged.'); // NEW
        if (!state || incoming.checkpointSequence > state.sequence) { // NEW: lagging replicas jump to an authorized checkpoint instead of walking old commits.
            const genesis = await readJson(path.join(directory, 'genesis.json'), LIMITS.record); // NEW
            verify(genesis, canvas.genesisCoordinatorPublicKey || canvas.coordinatorPublicKey); // NEW
            if (genesis.payload.kind !== 'genesis' || digest(genesis.payload.xml) !== genesis.payload.hash) throw new Error('The project snapshot could not be verified.'); // NEW
            const checkpointEnvelope = await readJson(path.join(directory, 'checkpoints', incoming.checkpointId + '.json'), LIMITS.record); // NEW
            if (digest(canonical(checkpointEnvelope)) !== incoming.checkpointId) throw new Error('The checkpoint failed verification.'); // NEW
            const saved = verify(checkpointEnvelope, canvas.coordinatorPublicKey); // NEW
            if (saved.kind !== 'checkpoint' || saved.state?.sequence !== incoming.checkpointSequence || saved.state.epoch !== incoming.epoch || saved.state.snapshotHash !== genesis.payload.hash) throw new Error('Invalid checkpoint position.'); // NEW
            objects(saved.state.xml); state = saved.state; // NEW
        } // NEW
        let next = state; // NEW
        for (let sequence = state.sequence + 1; sequence <= incoming.sequence; sequence++) { // NEW
            const commit = await readJson(recordFile(incoming.epoch, sequence), LIMITS.record), decision = verify(commit, canvas.coordinatorPublicKey); // NEW
            if (decision.kind !== 'commit' || decision.epoch !== next.epoch || decision.sequence !== sequence || decision.previous !== next.headHash) throw new Error('Missing or invalid accepted predecessor.'); // NEW
            const proposal = verify(decision.proposal, publicKey(decision.proposal?.payload?.deviceId)); // NEW
            const changed = applyCurrentEvent(next, proposal); // NEW
            if (digest(changed.xml) !== decision.contentHash) throw new Error('Accepted content hash mismatch.'); // NEW
            next = { ...changed, sequence, headHash: digest(canonical(commit)) }; applied++; // NEW
        } // NEW
        if (next.headHash !== incoming.hash) throw new Error('Accepted head hash mismatch.'); // NEW
        state = next; head = incoming; checkpointDue = state.sequence - head.checkpointSequence >= CHECKPOINT_INTERVAL; // NEW
        if (canvas.coordinatorDeviceId === deviceId && !checkpointDue) { // NEW: recover a decision persisted before an interrupted head publication.
            const orphan = await readJson(recordFile(state.epoch, state.sequence + 1), LIMITS.record).catch(error => { if (error.code === 'ENOENT') return null; throw error; }); // NEW
            if (orphan) { // NEW
                const decision = verify(orphan, keys.publicKey), proposal = verify(decision.proposal, publicKey(decision.proposal?.payload?.deviceId)); // NEW
                if (decision.kind !== 'commit' || decision.epoch !== state.epoch || decision.sequence !== state.sequence + 1 || decision.previous !== state.headHash) throw new Error('Invalid interrupted accepted decision.'); // NEW
                const recovered = applyCurrentEvent(state, proposal); // NEW
                if (digest(recovered.xml) !== decision.contentHash) throw new Error('Interrupted decision content hash mismatch.'); // NEW
                const updated = { ...recovered, sequence: decision.sequence, headHash: digest(canonical(orphan)) }; // NEW
                await publishHead({ ...head, sequence: updated.sequence, hash: updated.headHash }); state = updated; applied++; // NEW
                checkpointDue = state.sequence - head.checkpointSequence >= CHECKPOINT_INTERVAL; // NEW
            } // NEW
        } // NEW
        onTiming({ phase: 'read', durationMs: performance.now() - started, replayCount: 0, historicalRecordsRead: 0, commitsApplied: applied }); // NEW
        return currentSnapshot(state, now()); // NEW
    } // NEW
    async function append(actor, kind, fields = {}) { // NEW
        if (!state) await read(); // NEW
        if (canvas.coordinatorDeviceId !== deviceId) throw Object.assign(new Error('Waiting for the coordinator to accept this proposal.'), { code: 'COORDINATOR_REQUIRED' }); // NEW
        if (checkpointDue) await checkpoint(); // NEW
        const proposal = signRecord({ ...fields, schema: CURRENT_PROTOCOL, shareId: canvas.shareId, diagramId: canvas.diagramId, id: fields.id || makeId(), deviceId, userId: actor.userId, sessionId: actor.sessionId, kind, at: now() }, keys.privateKey); // CHANGE: caller fields cannot override the authenticated scope or actor.
        const validationStarted = performance.now(); // NEW
        const next = applyCurrentEvent(state, proposal.payload), sequence = state.sequence + 1; // NEW
        onTiming({ phase: 'validation', durationMs: performance.now() - validationStarted, kind, sequence }); // NEW
        const durableStarted = performance.now(); // NEW
        const envelope = signRecord({ schema: CURRENT_PROTOCOL, shareId: canvas.shareId, diagramId: canvas.diagramId, kind: 'commit', epoch: state.epoch, sequence, previous: state.headHash, proposal, contentHash: digest(next.xml) }, keys.privateKey); // NEW
        await immutable(recordFile(state.epoch, sequence), envelope); // NEW
        const updated = { ...next, sequence, headHash: digest(canonical(envelope)) }; // NEW
        await publishHead({ ...head, sequence, hash: updated.headHash }); // NEW
        state = updated; checkpointDue = sequence - head.checkpointSequence >= CHECKPOINT_INTERVAL; // NEW
        onTiming({ phase: 'acceptance', durationMs: performance.now() - durableStarted, sequence, replayCount: 0, historicalRecordsRead: 0 }); // CHANGE
        return proposal.payload; // NEW
    } // NEW
    return { initialize, read, append, checkpoint, directory }; // NEW
} // NEW
