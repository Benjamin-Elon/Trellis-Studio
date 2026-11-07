/** Protocol 5 current-state persistence. Ordinary operations never enumerate an archive. */ // CHANGE
import path from 'node:path'; // NEW
import crypto from 'node:crypto'; // NEW
import fs from 'node:fs/promises'; // NEW
import { readJson, LIMITS } from './trellis-input-policy.js'; // NEW
import { SYNC_PROTOCOL, canonical, digest, signRecord, verifyRecord, safeId, makeId, inspectDiagram, withDiagramInspectionCache } from './trellis-share-protocol.js'; // NEW
import { applyChanges, diffObjects, objects, authorityFor, invitationAcceptance, rosterChangeAllowed, HOLD_MS, HANDOFF_MS, REQUEST_GRACE_MS, PRESENCE_MS } from './trellis-collaboration-protocol.js'; // CHANGE
import { validatePermissionChanges } from './trellis-permission-policy.js'; // NEW
import { validateProjectNameChange } from './trellis-project-naming.js'; // NEW
import { analyzeDocument, prioritizeAnalysis } from './trellis-analysis-worker.js'; // NEW: bounded verification keeps cold reconstruction off the main thread.
import { readBounded, parseJson } from './trellis-input-policy.js'; // NEW: large signed envelopes are parsed by the verification worker.
import { withReferenceResolver } from './trellis-reference-snapshots.js'; // NEW: public evidence uses the existing project-scoped resolution boundary.

export const CURRENT_PROTOCOL = SYNC_PROTOCOL.garden; // NEW
export const CHECKPOINT_INTERVAL = 30; // NEW
export const CHECKPOINT_BYTES = 4 * 1024 * 1024; // NEW: expensive short tails also receive a restart checkpoint.
const sameActor = (left, right) => left.deviceId === right.deviceId && left.sessionId === right.sessionId && left.userId === right.userId; // NEW
const overlaps = (left, right) => left === '*' || right === '*' || left === right; // NEW

/** Invitation holds remain valid only while their exact account-acceptance change is authorized. */ // NEW
function holdAuthorized(state, hold, time, context) { // CHANGE: one immutable policy is shared across the expiry pass.
    if (authorityFor(state.xml, hold.key, hold.userId, context) > 0) return true; // CHANGE
    if (!hold.usersPolicyAction || !hold.policyChanges) return false; // NEW
    try { return invitationAcceptance(state.xml, applyChanges(state.xml, hold.policyChanges), hold.userId, time); } catch (_) { return false; } // NEW
} // NEW

/** Reserve a released object for its highest-authority eligible waiter, preserving accepted queue order. */ // NEW
function reserveReleased(state, holds, time, context = { at: time }) { // CHANGE: actor/time checks remain live while parsing is reused.
    const reservations = state.reservations.filter(item => item.until > time && authorityFor(state.xml, item.key, item.userId, context) > 0); // CHANGE
    for (const hold of holds) { // NEW
        const endedAt = Math.min(hold.expiresAt ?? time, time); // NEW
        if (endedAt + HANDOFF_MS <= time) continue; // NEW
        const candidates = (hold.requesters || []).filter(item => authorityFor(state.xml, hold.key, item.userId, context) > 0); // CHANGE
        candidates.sort((a, b) => authorityFor(state.xml, hold.key, b.userId, context) - authorityFor(state.xml, hold.key, a.userId, context)); // CHANGE
        if (candidates.length) reservations.push({ key: hold.key, ...candidates[0], previousSession: hold.sessionId, until: endedAt + HANDOFF_MS }); // NEW
    } // NEW
    return reservations; // NEW
} // NEW

/** Expiry projects current holds forward; historical claims cannot overturn accepted changes. */ // NEW
function expireState(state, time, context) { // CHANGE: one evaluation shares parsed policy across recursive save stages.
    const holds = [], released = []; // CHANGE: this context never survives a state or clock change.
    for (const hold of state.holds) ((hold.expiresAt === null || hold.expiresAt > time) && holdAuthorized(state, hold, time, context) ? holds : released).push(hold); // CHANGE
    return { ...state, holds, presence: state.presence.filter(item => item.at + PRESENCE_MS > time), reservations: reserveReleased(state, released, time, context) }; // CHANGE
} // NEW

/** Public expiry never retains policy across calls or clock changes. */ // NEW
export function expireCurrentState(state, time) { return expireState(state, time, { at: time }); } // NEW

/** Validate a single transaction against accepted content, retaining every domain check. */ // NEW
export function validateCurrentEdit(state, proposal, context = { at: proposal.at }) { // NEW
    const proposed = applyChanges(state.xml, proposal.changes); // NEW
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
function applyEvent(previous, proposal, context) { // CHANGE
    if (!proposal || !['claim', 'release', 'request', 'view', 'activity', 'edit', 'save'].includes(proposal.kind) || typeof proposal.userId !== 'string' || !proposal.userId || !Number.isFinite(proposal.at)) throw new Error('Invalid current-state proposal.'); // CHANGE
    safeId(proposal.id); safeId(proposal.sessionId); safeId(proposal.deviceId); // NEW
    if (proposal.targets && (!Array.isArray(proposal.targets) || proposal.targets.some(key => { // NEW
        if (key === '*') return false; // NEW
        try { const pair = JSON.parse(key); return !Array.isArray(pair) || pair.length !== 2 || pair.some(part => typeof part !== 'string') || !pair[1]; } catch (_) { return true; } // NEW
    }))) throw new Error('Invalid proposal targets.'); // NEW
    if (proposal.kind === 'save') { // NEW: transient holds, validation, and release form one indivisible accepted decision.
        const claimed = applyEvent(previous, { ...proposal, kind: 'claim', holdPolicy: 'request', policyChanges: proposal.changes }, context); // NEW
        const edited = applyEvent(claimed, { ...proposal, kind: 'edit', claimIds: [proposal.id] }, context); // NEW
        return applyEvent(edited, { ...proposal, kind: 'release' }, context); // NEW
    } // NEW
    let state = expireState(previous, proposal.at, context); // NEW
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
        state = { ...state, holds: state.holds.filter(hold => !released.includes(hold)).map(hold => ({ ...hold, requesters: hold.requesters.filter(item => !sameActor(item, proposal)) })), reservations: reserveReleased(state, released, proposal.at, context).filter(item => !sameActor(item, proposal)), presence: state.presence.filter(item => !sameActor(item, proposal)) }; // CHANGE
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
        const xml = validateCurrentEdit(state, proposal, context), index = objects(xml), attribution = { ...state.attribution }, objectVersions = { ...state.objectVersions }; // CHANGE
        for (const key of Object.keys(objectVersions)) if (!index.has(key)) delete objectVersions[key]; // NEW: deleted-object versions never accumulate with lifetime edits.
        if (proposal.changes.some(change => change.key === '*')) { for (const key of Object.keys(attribution)) delete attribution[key]; } // NEW
        for (const key of proposal.changes.some(change => change.key === '*') ? index.keys() : proposal.changes.map(change => change.key)) { // NEW
            if (index.has(key)) attribution[key] = { id: proposal.id, kind: 'edit', userId: proposal.userId, deviceId: proposal.deviceId, at: proposal.authoredAt ?? proposal.at, key, hash: index.get(key).hash, targets: proposal.targets }; // CHANGE: coordinator acceptance time controls permission checks without rewriting author time.
            else delete attribution[key]; // NEW: resident attribution is bounded by current objects, never lifetime deletions.
            if (index.has(key)) objectVersions[key] = { version: (state.sequence || 0) + 1, hash: index.get(key).hash }; // NEW
        } // NEW
        state = { ...state, xml, attribution, objectVersions, lastEditId: proposal.id }; // CHANGE
    } else throw new Error('Unsupported protocol 5 transaction.'); // CHANGE
    return expireState(state, proposal.at, context); // CHANGE: policy revocation ends holds at the accepted policy change, never at a later observer's clock.
} // NEW

/** Scope parsed policy to exactly one accepted event; XML changes invalidate authorityFor's existing context. */ // NEW
export function applyCurrentEvent(previous, proposal) { return applyEvent(previous, proposal, { at: proposal?.at }); } // NEW

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

/** Trust the pinned coordinator's attestation, while rejecting malformed or inconsistent snapshots. */ // NEW
export function validateCurrentCheckpoint(saved, incoming, genesisHash, canvas) { // NEW
    const value = saved.state, hash = candidate => typeof candidate === 'string' && /^[a-f0-9]{64}$/.test(candidate); // NEW
    if (saved.kind !== 'checkpoint' || saved.deviceId !== canvas.coordinatorDeviceId || value?.sequence !== incoming.checkpointSequence || value.epoch !== incoming.epoch || value.snapshotHash !== genesisHash || !hash(value.headHash) || !Number.isSafeInteger(saved.membershipVersion) || saved.membershipVersion < 0 || !Array.isArray(saved.members) || new Set(saved.members.map(member => member?.deviceId)).size !== saved.members.length) throw new Error('Invalid checkpoint position or membership.'); // NEW
    if (value.sequence === incoming.sequence && value.headHash !== incoming.hash) throw new Error('Invalid checkpoint head hash.'); // NEW
    if (value.sequence === 0 && digest(value.xml) !== genesisHash) throw new Error('Invalid checkpoint initial content.'); // NEW
    const index = objects(value.xml), map = candidate => candidate && typeof candidate === 'object' && !Array.isArray(candidate); // NEW
    if (!map(value.attribution) || !map(value.objectVersions) || Object.keys(value.objectVersions).length !== index.size || !['holds', 'presence', 'reservations'].every(key => Array.isArray(value[key]))) throw new Error('Invalid checkpoint current state.'); // NEW
    for (const [key, object] of index) { const version = value.objectVersions[key]; if (!version || !Number.isSafeInteger(version.version) || version.version < 0 || version.version > value.sequence || version.hash !== object.hash) throw new Error('Invalid checkpoint object version.'); } // NEW
    for (const [key, item] of Object.entries(value.attribution)) { if (!index.has(key) || item.key !== key || item.hash !== index.get(key).hash || item.kind !== 'edit' || typeof item.userId !== 'string' || !Number.isFinite(item.at)) throw new Error('Invalid checkpoint attribution.'); safeId(item.id); safeId(item.deviceId); } // NEW
    function actor(item) { // NEW
        if (!item || typeof item.userId !== 'string' || !item.userId) throw new Error('Invalid checkpoint actor.'); // NEW
        safeId(item.deviceId); safeId(item.sessionId); // NEW
    } // NEW
    for (const hold of value.holds) { // CHANGE
        if (!hold || hold.key !== '*' && !index.has(hold.key) || !Number.isFinite(hold.activeAt) || hold.expiresAt !== null && !Number.isFinite(hold.expiresAt) || !Array.isArray(hold.requesters)) throw new Error('Invalid checkpoint editing hold.'); // CHANGE
        actor(hold); safeId(hold.claimId); // NEW
        for (const requester of hold.requesters) actor(requester); // NEW
    } // NEW
    for (const member of saved.members) { // CHANGE
        safeId(member.deviceId); // NEW
        if (typeof member.userId !== 'string' || typeof member.publicKey !== 'string' || !member.publicKey) throw new Error('Invalid checkpoint member.'); // CHANGE
        try { crypto.createPublicKey(member.publicKey); } catch (_) { throw new Error('Invalid checkpoint member key.'); } // NEW
    } // NEW
    for (const item of value.presence) { // CHANGE
        actor(item); safeId(item.id); // NEW
        if (item.kind !== 'view' || !Number.isFinite(item.at)) throw new Error('Invalid checkpoint presence.'); // CHANGE
    } // NEW
    for (const item of value.reservations) { // CHANGE
        actor(item); // NEW
        if (item.key !== '*' && !index.has(item.key) || !Number.isFinite(item.until)) throw new Error('Invalid checkpoint reservation.'); // CHANGE
    } // NEW
    return value; // NEW: caller publishes resident state only after all checks succeed.
} // NEW

/** Verify one immutable checkpoint/tail bundle using the same reducers as live acceptance. No writes or private keys. */ // NEW
async function verifyEvidence(input, loadReference, onProgress, references) { // CHANGE
    const { canvas, incoming, deviceId } = input, protocol = canvas.protocolVersion || CURRENT_PROTOCOL; // NEW
    if (protocol !== CURRENT_PROTOCOL) throw new Error('Unsupported garden storage protocol. Only protocol 5 is supported.'); // CHANGE
    const verify = (envelope, key) => { const value = envelope?.payload; if (value?.schema !== protocol || value.shareId !== canvas.shareId || value.diagramId !== canvas.diagramId || !verifyRecord(envelope, key)) throw new Error('Invalid protocol 5 scope or signature.'); return value; }; // CHANGE
    const decode = raw => typeof raw === 'string' ? parseJson(raw, LIMITS.record) : raw; // NEW
    const attemptedReferences = new Set(), core = globalThis.TrellisReferenceCore; // CHANGE
    async function hydrate(xml) { // NEW
        if (!core || !xml.includes(core.ATTR)) return; // NEW
        for (const cell of inspectDiagram(xml).cells) { // NEW
            const raw = cell.node.getAttribute(core.ATTR); if (!raw) continue; const pointer = JSON.parse(raw); // NEW
            if (!core.externalReference(pointer) || attemptedReferences.has(pointer.digest)) continue; // CHANGE
            attemptedReferences.add(pointer.digest); // NEW: missing definitions affect their own garden, not unrelated edits. // NEW
            const text = await loadReference(pointer.digest).catch(() => undefined); // CHANGE: domain validation still rejects edits that require unavailable definitions. // NEW
            if (text === undefined) continue; // NEW
            const value = parseJson(text, LIMITS.diagram); // NEW
            if (digest(text) !== pointer.digest || core.canonical(value) !== text) throw new Error('Reference snapshot failed content verification.'); // NEW
            references.set(pointer.digest, core.freeze(core.validate(value))); // NEW
        } // NEW
    } // NEW
    const total = (input.checkpoint ? 1 : 0) + input.commits.length + (input.orphan ? 1 : 0); let completed = 0; // CHANGE
    const report = () => { try { onProgress({ phase: 'verification-progress', completed, total }); } catch (_) {} }; report(); // CHANGE
    let next = input.state; // NEW
    if (input.checkpoint) { // NEW
        const genesis = decode(input.genesis); verify(genesis, canvas.genesisCoordinatorPublicKey || canvas.coordinatorPublicKey); // NEW
        if (genesis.payload.kind !== 'genesis' || digest(genesis.payload.xml) !== genesis.payload.hash) throw new Error('The project snapshot could not be verified.'); // NEW
        const envelope = decode(input.checkpoint); // NEW
        if (digest(canonical(envelope)) !== incoming.checkpointId) throw new Error('The checkpoint failed verification.'); // NEW
        const saved = verify(envelope, canvas.coordinatorPublicKey); await hydrate(saved.state.xml); // NEW
        next = validateCurrentCheckpoint(saved, incoming, genesis.payload.hash, canvas); completed++; report(); // CHANGE
    } // NEW
    const apply = async (raw, sequence) => { // NEW
        const started = performance.now(); // NEW
        const envelope = decode(raw), decision = verify(envelope, canvas.coordinatorPublicKey); // NEW
        if (decision.kind !== 'commit' || decision.epoch !== next.epoch || decision.sequence !== sequence || decision.previous !== next.headHash || !Number.isFinite(decision.acceptedAt)) throw new Error('Missing or invalid accepted predecessor.'); // NEW
        const author = decision.proposal?.payload?.deviceId, key = author === deviceId ? input.publicKey : canvas.members.find(member => member.deviceId === author)?.publicKey; // NEW
        const proposal = verify(decision.proposal, key); // NEW
        if (proposal.changes) await hydrate(applyChanges(next.xml, proposal.changes)); // NEW
        const changed = applyCurrentEvent(next, { ...proposal, at: decision.acceptedAt, authoredAt: proposal.at }); // NEW
        if (digest(changed.xml) !== decision.contentHash) throw new Error('Accepted content hash mismatch.'); // NEW
        next = { ...changed, sequence, headHash: digest(canonical(envelope)) }; // NEW
        onProgress({ phase: 'verification-commit', sequence, durationMs: performance.now() - started }); completed++; report(); // CHANGE
        return envelope; // NEW
    }; // NEW
    for (const raw of input.commits) await apply(raw, next.sequence + 1); // NEW
    if (next.sequence !== incoming.sequence || next.headHash !== incoming.hash) throw new Error('Accepted head hash mismatch.'); // NEW
    const orphan = input.orphan ? await apply(input.orphan, next.sequence + 1) : null; // NEW
    return { state: next, orphan }; // NEW
} // NEW

/** Keep document reuse local to one evidence bundle; never cache authority across operations. */ // NEW
export function verifyCurrentEvidence(input, loadReference = async () => undefined, onProgress = () => {}) { const references = new Map(); return withReferenceResolver(hash => references.get(hash), () => withDiagramInspectionCache(() => verifyEvidence(input, loadReference, onProgress, references))); } // CHANGE

/** Signed checkpoint plus a bounded tail is the restart boundary; archives are write-only here. */ // NEW
export function createCurrentStateStore({ canvas, deviceId, keys, profile, writeAtomic, writeImmutable, references, now = Date.now, onTiming = () => {} }) { // CHANGE
    if (typeof profile !== 'string' || !profile) throw new Error('Private coordinator storage is required.'); // NEW
    const CURRENT_PROTOCOL = canvas.protocolVersion || SYNC_PROTOCOL.garden; if (!SYNC_PROTOCOL.supportedGardens.includes(CURRENT_PROTOCOL)) throw new Error('Unsupported garden storage protocol. Only protocol 5 is supported.'); // CHANGE: one engine, scoped wire codecs.
    const directory = path.join(canvas.folderPath, '.trellis', 'collaboration-v' + CURRENT_PROTOCOL); // CHANGE
    let state = null, head = null, checkpointDue = false, needsRecovery = false, queue = Promise.resolve(); // CHANGE
    let acceptedTailBytes = 0, checkpointBase = -1, checkpointTask = null, verificationGeneration = 0, activeGeneration = 0, controller = new AbortController(); // CHANGE
    const assertActive = generation => { if (generation !== verificationGeneration || controller.signal.aborted) throw Object.assign(new Error('Garden verification was canceled. Files were preserved.'), { code: 'ABORT_ERR' }); }; // NEW
    function cancelVerification() { controller.abort(); verificationGeneration++; controller = new AbortController(); } // NEW: obsolete workers cannot publish or advance the accepted position.
    const serialized = operation => { const generation = verificationGeneration; const next = queue.then(() => { assertActive(generation); activeGeneration = generation; return references ? references.run(operation) : operation(); }); queue = next.catch(() => {}); return next; }; // CHANGE: reference authority belongs to this project, including async restart validation.
    const publicKey = id => id === deviceId ? keys.publicKey : canvas.members.find(member => member.deviceId === id)?.publicKey; // NEW
    const headFile = () => path.join(directory, 'heads', safeId(canvas.coordinatorDeviceId) + '.json'); // NEW
    const recordFile = (epoch, sequence) => path.join(directory, 'epochs', safeId(epoch), String(sequence).padStart(12, '0') + '.json'); // NEW
    const receiptFile = id => path.join(directory, 'receipts', safeId(id) + '.json'); // NEW: exact-ID lookup never enumerates accepted archives.
    const pendingFile = id => path.join(profile, 'pending-proposals', safeId(canvas.shareId), safeId(id) + '.json'); // NEW: private signed pending intent survives a crash before durable acceptance.
    const positionFile = path.join(profile, 'accepted-positions', safeId(canvas.shareId), safeId(deviceId) + '.json'); let positionLoaded = false, position = null; // NEW
    const requestHash = proposal => digest(canonical(Object.fromEntries(Object.entries(proposal).filter(([key]) => !['at', 'sessionId'].includes(key))))); // CHANGE: reopening a local window may change its generated session/clock; the full signed payload and original session remain immutable in pending intent and receipts.
    const scope = payload => payload?.schema === CURRENT_PROTOCOL && payload.shareId === canvas.shareId && payload.diagramId === canvas.diagramId; // NEW
    function verify(envelope, key) { // NEW
        if (!scope(envelope?.payload) || !verifyRecord(envelope, key)) throw new Error('Invalid protocol 5 scope or signature.'); // CHANGE
        return envelope.payload; // NEW
    } // NEW
    /** A private signed high-water mark prevents rollback across process restarts. */ // NEW
    async function checkPosition(incoming) { // NEW
        if (!positionLoaded) { // NEW
            const envelope = await readJson(positionFile, LIMITS.metadata).catch(error => { if (error.code === 'ENOENT') return null; throw error; }); // NEW
            if (envelope) { const saved = verify(envelope, keys.publicKey); if (saved.kind !== 'verified-position' || saved.deviceId !== deviceId || !Number.isSafeInteger(saved.sequence) || saved.sequence < 0 || typeof saved.hash !== 'string' || !/^[a-f0-9]{64}$/.test(saved.hash)) throw new Error('Invalid private accepted position.'); position = saved; } // NEW
            positionLoaded = true; // NEW
        } // NEW
        if (position && (position.epoch !== incoming.epoch || incoming.sequence < position.sequence || incoming.sequence === position.sequence && incoming.hash !== position.hash)) throw new Error('Coordinator head regressed or diverged from the private accepted position.'); // NEW
    } // NEW
    async function rememberPosition(value) { // NEW
        assertActive(activeGeneration); // NEW
        if (position?.epoch === value.epoch && position.sequence === value.sequence && position.hash === value.headHash) return; // NEW
        const next = { schema: CURRENT_PROTOCOL, shareId: canvas.shareId, diagramId: canvas.diagramId, kind: 'verified-position', deviceId, epoch: value.epoch, sequence: value.sequence, hash: value.headHash }; // NEW
        await writeAtomic(positionFile, JSON.stringify(signRecord(next, keys.privateKey))); position = next; positionLoaded = true; // NEW
    } // NEW
    async function immutable(filename, envelope) { // NEW
        assertActive(activeGeneration); // NEW
        try { await writeImmutable(filename, envelope); } catch (error) { // NEW
            if (error.code !== 'EEXIST' || canonical(await readJson(filename, LIMITS.record)) !== canonical(envelope)) throw error; // NEW
        } // NEW
        assertActive(activeGeneration); // NEW: an immutable write may finish during cancellation, but cannot enable later publication.
    } // NEW
    async function publishHead(next) { // NEW
        assertActive(activeGeneration); // NEW
        await writeAtomic(headFile(), JSON.stringify(signRecord({ schema: CURRENT_PROTOCOL, shareId: canvas.shareId, diagramId: canvas.diagramId, ...next }, keys.privateKey))); // NEW
        assertActive(activeGeneration); // NEW
        head = next; // NEW
    } // NEW
    /** A receipt is recoverable from its exact durable decision before acknowledgement. */ // NEW
    async function recordReceipt(envelope) { // NEW
        const decision = envelope.payload, proposal = decision.proposal; // NEW
        const payload = { schema: CURRENT_PROTOCOL, shareId: canvas.shareId, diagramId: canvas.diagramId, kind: 'receipt', deviceId, id: proposal.payload.id, requestHash: requestHash(proposal.payload), payloadHash: digest(canonical(proposal.payload)), epoch: decision.epoch, sequence: decision.sequence, acceptedAt: decision.acceptedAt, commitHash: digest(canonical(envelope)), proposal, result: { accepted: true } }; // CHANGE
        await immutable(receiptFile(payload.id), signRecord(payload, keys.privateKey)); // NEW
    } // NEW
    /** Resolve one accepted proposal without reading its historical decision or replaying it. */ // NEW
    async function receipt(id) { // NEW
        if (!state || needsRecovery) await read(); // NEW
        const envelope = await readJson(receiptFile(id), LIMITS.record).catch(error => { if (error.code === 'ENOENT') return null; throw error; }); // NEW
        if (!envelope) return null; // NEW
        const value = verify(envelope, canvas.coordinatorPublicKey), proposal = value.proposal?.payload; // NEW
        if (value.kind !== 'receipt' || value.id !== id || value.deviceId !== canvas.coordinatorDeviceId || value.epoch !== state.epoch || !Number.isSafeInteger(value.sequence) || value.sequence < 1 || value.sequence > state.sequence || !scope(proposal) || proposal.id !== id || value.requestHash !== requestHash(proposal) || value.payloadHash !== digest(canonical(proposal)) || !verifyRecord(value.proposal, publicKey(proposal.deviceId))) throw new Error('Invalid proposal receipt.'); // NEW
        return value; // NEW
    } // NEW
    /** Reuse the exact original author signature when an unaccepted save is retried. */ // NEW
    async function prepareProposal(request) { // NEW
        if (request.kind !== 'save') return signRecord(request, keys.privateKey); // NEW
        const pending = await readJson(pendingFile(request.id), LIMITS.record).catch(error => { if (error.code === 'ENOENT') return null; throw error; }); // NEW
        if (pending) { // NEW
            const previous = verify(pending, keys.publicKey); // NEW
            if (requestHash(previous) !== requestHash(request)) throw new Error('Proposal ID was reused with different contents.'); // NEW
            return pending; // NEW
        } // NEW
        const proposal = signRecord(request, keys.privateKey); // NEW
        await immutable(pendingFile(request.id), proposal); return proposal; // NEW
    } // NEW
    /** Validate time-sensitive rules at the coordinator's accepted time, retaining signed author attribution. */ // NEW
    function applyDecision(previous, proposal, acceptedAt) { // NEW
        if (!Number.isFinite(acceptedAt)) throw new Error('Invalid coordinator acceptance time.'); // NEW
        return applyCurrentEvent(previous, { ...proposal, at: acceptedAt, authoredAt: proposal.at }); // NEW
    } // NEW
    async function acknowledge(id) { // NEW
        const accepted = await receipt(id); // NEW
        if (!accepted) throw new Error('Cannot acknowledge an unaccepted proposal.'); // NEW
        await fs.rm(pendingFile(id), { force: true }); // NEW: failed acknowledgement remains directly retryable through the receipt.
    } // NEW
    async function checkpoint(refresh = true) { // CHANGE
        const started = performance.now(); // NEW
        if (canvas.coordinatorDeviceId !== deviceId) throw new Error('Only the approved coordinator may publish a checkpoint.'); // NEW
        if (refresh || !state) await read(); // CHANGE: a public checkpoint must cover the current accepted head, including decisions received since the last local operation.
        const payload = { schema: CURRENT_PROTOCOL, shareId: canvas.shareId, diagramId: canvas.diagramId, kind: 'checkpoint', deviceId, state, members: canvas.members, membershipVersion: canvas.membershipVersion || 0 }; // NEW
        const envelope = signRecord(payload, keys.privateKey), checkpointId = digest(canonical(envelope)); // NEW
        await immutable(path.join(directory, 'checkpoints', checkpointId + '.json'), envelope); // NEW
        await publishHead({ ...head, checkpointId, checkpointSequence: state.sequence }); // NEW
        checkpointDue = false; acceptedTailBytes = 0; checkpointBase = state.sequence; // CHANGE
        onTiming({ phase: 'checkpoint', durationMs: performance.now() - started, sequence: state.sequence, replayCount: 0, historicalRecordsRead: 0 }); // CHANGE
    } // NEW
    async function initialize(xml) { // NEW
        if (canvas.coordinatorDeviceId !== deviceId) throw new Error('Only the approved coordinator may create the project snapshot.'); // NEW
        const index = objects(xml); // CHANGE
        const genesis = signRecord({ schema: CURRENT_PROTOCOL, shareId: canvas.shareId, diagramId: canvas.diagramId, kind: 'genesis', deviceId, xml, hash: digest(xml) }, keys.privateKey); // NEW
        const existing = await readJson(path.join(directory, 'genesis.json'), LIMITS.record).catch(error => { if (error.code === 'ENOENT') return null; throw error; }); // NEW
        if (existing) { // NEW
            if (canonical(existing) !== canonical(genesis)) throw new Error('The project already has a different initial snapshot.'); // NEW
            return read(); // NEW: repeated setup must never reset an accepted position.
        } // NEW
        await immutable(path.join(directory, 'genesis.json'), genesis); // NEW
        state = { xml, sequence: 0, epoch: 'initial-' + safeId(deviceId), headHash: digest(canonical(genesis)), snapshotHash: digest(xml), attribution: {}, objectVersions: Object.fromEntries([...index].map(([key, object]) => [key, { version: 0, hash: object.hash }])), holds: [], presence: [], reservations: [] }; // CHANGE
        head = { deviceId, epoch: state.epoch, sequence: 0, hash: state.headHash }; // NEW
        await checkpoint(false); // CHANGE: initialization has not published its first head yet.
        await rememberPosition(state); // NEW
        return currentSnapshot(state, now()); // NEW
    } // NEW
    /** Coalesce soft-budget snapshots; an accepted save is never reported failed by later maintenance. */ // CHANGE
    function scheduleCheckpoint() { // CHANGE
        if (checkpointTask || acceptedTailBytes < CHECKPOINT_BYTES || canvas.coordinatorDeviceId !== deviceId) return; // CHANGE
        const generation = verificationGeneration; // CHANGE
        checkpointTask = new Promise(resolve => setImmediate(resolve)).then(() => serialized(async () => { // CHANGE
            assertActive(generation); if (acceptedTailBytes >= CHECKPOINT_BYTES && !canvas.localRemoved && !canvas.projectRetired && !canvas.projectFenced && !canvas.revoked) await checkpoint(); // CHANGE
        })).catch(error => { onTiming({ phase: 'checkpoint-error', code: error.code || 'CHECKPOINT_FAILED', retryable: true }); }).finally(() => { checkpointTask = null; }); // CHANGE
    } // CHANGE
    /** Read small heads on the owner; all large evidence and domain replay are verified in a bounded worker. */ // CHANGE
    async function read(options = {}) { // CHANGE
        const started = performance.now(), generation = verificationGeneration; let applied = 0, batch = 0; // CHANGE
        for (;;) { // CHANGE
            assertActive(generation); batch++; // CHANGE
            onTiming({ phase: 'verification-progress', batch, message: batch > 1 ? 'Checking additional changes…' : 'Checking current garden state…' }); // CHANGE
            const envelope = await readJson(headFile(), LIMITS.metadata), incoming = verify(envelope, canvas.coordinatorPublicKey); // CHANGE
            if (incoming.epoch !== 'initial-' + safeId(canvas.coordinatorDeviceId)) throw new Error('The coordinator epoch has not been authorized.'); // CHANGE
            if (incoming.deviceId !== canvas.coordinatorDeviceId || !Number.isSafeInteger(incoming.sequence) || incoming.sequence < 0 || !Number.isSafeInteger(incoming.checkpointSequence) || incoming.checkpointSequence < 0 || incoming.checkpointSequence > incoming.sequence || incoming.sequence - incoming.checkpointSequence > CHECKPOINT_INTERVAL || !/^[a-f0-9]{64}$/.test(incoming.checkpointId)) throw new Error('Invalid current-state head.'); // CHANGE
            await checkPosition(incoming); assertActive(generation); // CHANGE
            if (state && (incoming.epoch !== state.epoch || incoming.sequence < state.sequence || incoming.sequence === state.sequence && incoming.hash !== state.headHash)) throw new Error('Coordinator head regressed or diverged.'); // CHANGE
            const cold = !state || incoming.checkpointSequence > state.sequence, first = cold ? incoming.checkpointSequence : state.sequence; // CHANGE
            const budget = { used: 0, maximum: LIMITS.replay }, raw = filename => readBounded(filename, LIMITS.record, 'utf8', budget); // CHANGE
            const genesis = cold ? await raw(path.join(directory, 'genesis.json')) : null; // CHANGE
            const checkpointEnvelope = cold ? await raw(path.join(directory, 'checkpoints', incoming.checkpointId + '.json')) : null; // CHANGE
            const commits = []; for (let sequence = first + 1; sequence <= incoming.sequence; sequence++) { assertActive(generation); commits.push(await raw(recordFile(incoming.epoch, sequence))); } // CHANGE
            const orphan = canvas.coordinatorDeviceId === deviceId && incoming.sequence - incoming.checkpointSequence < CHECKPOINT_INTERVAL ? await raw(recordFile(incoming.epoch, incoming.sequence + 1)).catch(error => { if (error.code === 'ENOENT') return null; throw error; }) : null; // CHANGE
            let result = { state, orphan: null }; // CHANGE
            if (cold || commits.length || orphan) { // CHANGE
                const publicCanvas = structuredClone({ protocolVersion: CURRENT_PROTOCOL, shareId: canvas.shareId, diagramId: canvas.diagramId, coordinatorDeviceId: canvas.coordinatorDeviceId, coordinatorPublicKey: canvas.coordinatorPublicKey, genesisCoordinatorPublicKey: canvas.genesisCoordinatorPublicKey, members: canvas.members }), authority = canonical(publicCanvas), startingState = state; // CHANGE
                result = await analyzeDocument('current-state', { canvas: publicCanvas, deviceId, publicKey: keys.publicKey, incoming, state: cold ? null : state, genesis, checkpoint: checkpointEnvelope, commits, orphan }, { signal: controller.signal, priority: options.priority, loadReference: hash => references?.readForVerification?.(hash), onProgress: sample => onTiming({ ...sample, batch, ...(sample.phase === 'verification-progress' ? { message: batch > 1 ? 'Checking additional changes…' : 'Verifying garden…' } : {}) }) }); // CHANGE
                assertActive(generation); // CHANGE
                if (state !== startingState || authority !== canonical({ ...publicCanvas, protocolVersion: canvas.protocolVersion || SYNC_PROTOCOL.garden, shareId: canvas.shareId, diagramId: canvas.diagramId, coordinatorDeviceId: canvas.coordinatorDeviceId, coordinatorPublicKey: canvas.coordinatorPublicKey, genesisCoordinatorPublicKey: canvas.genesisCoordinatorPublicKey, members: canvas.members })) throw Object.assign(new Error('Garden authority changed during verification. Retry checking this garden.'), { code: 'STALE_VERIFICATION' }); // NEW
            } // CHANGE
            const observed = verify(await readJson(headFile(), LIMITS.metadata), canvas.coordinatorPublicKey); assertActive(generation); // CHANGE
            if (checkpointBase !== incoming.checkpointSequence) { // CHANGE
                acceptedTailBytes = 0; for (let sequence = incoming.checkpointSequence + 1; sequence <= first; sequence++) acceptedTailBytes += Buffer.byteLength(await raw(recordFile(incoming.epoch, sequence))); // CHANGE
                checkpointBase = incoming.checkpointSequence; // CHANGE
            } // CHANGE
            acceptedTailBytes += commits.reduce((total, text) => total + Buffer.byteLength(text), 0); // CHANGE
            assertActive(generation); state = result.state; applied += commits.length; head = incoming; // CHANGE
            if (observed.epoch !== incoming.epoch || observed.sequence !== incoming.sequence || observed.hash !== incoming.hash || observed.checkpointId !== incoming.checkpointId) { // CHANGE
                if (result.orphan) { state = null; checkpointBase = -1; acceptedTailBytes = 0; } // CHANGE
                continue; // CHANGE
            } // CHANGE
            if (result.orphan) { // CHANGE
                await recordReceipt(result.orphan); assertActive(generation); // CHANGE
                await publishHead({ ...head, sequence: state.sequence, hash: state.headHash }); applied++; acceptedTailBytes += Buffer.byteLength(orphan); // CHANGE
            } // CHANGE
            checkpointDue = state.sequence - head.checkpointSequence >= CHECKPOINT_INTERVAL; // CHANGE
            await rememberPosition(state); assertActive(generation); needsRecovery = false; // CHANGE
            onTiming({ phase: 'read', durationMs: performance.now() - started, replayCount: 0, historicalRecordsRead: 0, commitsApplied: applied, checkpointSequence: head.checkpointSequence, acceptedTailBytes }); // CHANGE
            scheduleCheckpoint(); return currentSnapshot(state, now()); // CHANGE
        } // CHANGE
    } // CHANGE
    async function append(actor, kind, fields = {}) { // NEW
        if (!state || needsRecovery) await read(); // CHANGE
        if (canvas.coordinatorDeviceId !== deviceId) throw Object.assign(new Error('Waiting for the coordinator to accept this proposal.'), { code: 'COORDINATOR_REQUIRED' }); // NEW
        const request = { ...fields, schema: CURRENT_PROTOCOL, shareId: canvas.shareId, diagramId: canvas.diagramId, id: fields.id || makeId(), deviceId, userId: actor.userId, sessionId: actor.sessionId, kind, at: now() }; // CHANGE: caller fields cannot override the authenticated scope or actor.
        const accepted = await receipt(request.id); // CHANGE
        if (accepted) { // CHANGE
            if (accepted.requestHash !== requestHash(request)) throw new Error('Proposal ID was reused with different contents.'); // CHANGE
            return accepted.proposal.payload; // CHANGE: retries return the original acceptance time and position.
        } // NEW
        if (checkpointDue) await checkpoint(); // CHANGE
        const proposal = await prepareProposal(request), acceptedAt = now(); // CHANGE
        const validationStarted = performance.now(); // NEW
        if (references && proposal.payload.changes) await references.hydrate(applyChanges(state.xml, proposal.payload.changes)); // CHANGE
        actor.assertActive?.(); // NEW: a private proposal or dependency write cannot preserve an obsolete document/author context through acceptance.
        const next = applyDecision(state, proposal.payload, acceptedAt), sequence = state.sequence + 1; // CHANGE
        onTiming({ phase: 'validation', durationMs: performance.now() - validationStarted, kind, sequence }); // NEW
        const durableStarted = performance.now(); // NEW
        const envelope = signRecord({ schema: CURRENT_PROTOCOL, shareId: canvas.shareId, diagramId: canvas.diagramId, kind: 'commit', epoch: state.epoch, sequence, previous: state.headHash, acceptedAt, proposal, contentHash: digest(next.xml) }, keys.privateKey); // CHANGE
        needsRecovery = true; // NEW
        await immutable(recordFile(state.epoch, sequence), envelope); // NEW
        await recordReceipt(envelope); // NEW
        const updated = { ...next, sequence, headHash: digest(canonical(envelope)) }; // NEW
        await publishHead({ ...head, sequence, hash: updated.headHash }); // NEW
        await rememberPosition(updated); // NEW
        state = updated; checkpointDue = sequence - head.checkpointSequence >= CHECKPOINT_INTERVAL; needsRecovery = false; // CHANGE
        acceptedTailBytes += Buffer.byteLength(JSON.stringify(envelope)); scheduleCheckpoint(); // NEW
        onTiming({ phase: 'acceptance', durationMs: performance.now() - durableStarted, sequence, replayCount: 0, historicalRecordsRead: 0 }); // CHANGE
        return proposal.payload; // NEW
    } // NEW
    return { initialize: xml => serialized(() => initialize(xml)), read: options => serialized(() => read(options)), cancelVerification, prioritizeVerification: () => prioritizeAnalysis(controller.signal), maintenance: () => checkpointTask || Promise.resolve(), receipt: id => serialized(() => receipt(id)), acknowledge: id => serialized(() => acknowledge(id)), append: (actor, kind, fields) => serialized(() => append(actor, kind, fields)), checkpoint: () => serialized(checkpoint), directory }; // CHANGE
} // NEW
