/** Signed, replaceable activity snapshots. No operation reads or replays the content journal. */ // NEW
import fs from 'node:fs/promises'; // NEW
import { watch } from 'node:fs'; // NEW
import path from 'node:path'; // NEW
import { digest, makeId, signRecord, verifyRecord, safeId } from './trellis-share-protocol.js'; // CHANGE
import { readBounded } from './trellis-input-policy.js'; // NEW

export const HEARTBEAT_MS = 5000; // NEW
export const LEASE_MS = 30000; // NEW
export const REQUEST_MS = 300000; // CHANGE: presence expires independently; only a release request gives ownership a deadline.
const MAX_TARGETS = 2048, MAX_BYTES = 256 * 1024; // NEW
const intersects = (a, b) => a === '*' || b === '*' || a === b; // NEW
let observationRevision = 0; // CHANGE: process-wide IPC ordering survives activity-service replacement; never enters signed peer records.

/** Ownership is advisory coordination; content permissions and base hashes remain authoritative. */ // NEW
export function createActivityService({ canvas, deviceId, keys, sessionFor, writeAtomic, authorize = () => true, canClaim = () => true, monotonic = () => performance.now(), now = Date.now, onChange = () => {} }) { // CHANGE
    const directory = path.join(canvas.folderPath, '.trellis', 'activity-v' + (canvas.protocolVersion || 4)), entries = new Map(), local = new Map(), departing = new Set(); // CHANGE
    let watcher, timer, scanTask, scanAgain = false, closed = false, fingerprint = '', notifyTimer, initializing; // NEW
    const keyFor = value => value.deviceId + ':' + value.sessionId; // NEW
    function targets(values = []) { // NEW
        if (!Array.isArray(values) || values.length > MAX_TARGETS) throw new Error('Invalid activity targets.'); // NEW
        return [...new Set(values.map(key => { // NEW
            if (key === '*') return key; // NEW
            const pair = JSON.parse(key); // NEW
            if (!Array.isArray(pair) || pair.length !== 2 || pair.some(part => typeof part !== 'string') || !pair[1] || key.length > 2048) throw new Error('Invalid activity object.'); // NEW
            return key; // NEW
        }))].sort(); // NEW
    } // NEW
    function validate(value) { // NEW
        if (value?.schema !== (canvas.protocolVersion || 4) || value.shareId !== canvas.shareId || value.diagramId !== canvas.diagramId || !Number.isSafeInteger(value.sequence) || value.sequence < 1 || !Number.isSafeInteger(value.revision) || value.revision < 0) throw new Error('Invalid activity identity or revision.'); // NEW
        safeId(value.deviceId); safeId(value.sessionId); safeId(value.userId); // NEW
        for (const field of ['viewing', 'editing', 'pending']) targets(value[field]); // NEW
        if (!Array.isArray(value.claims) || value.claims.length !== value.editing.length || new Set(value.claims.map(claim => claim?.key)).size !== value.claims.length || value.claims.some(claim => !claim || !value.editing.includes(claim.key) || typeof claim.claimId !== 'string' || !/^[a-f0-9]{64}$/.test(claim.claimId))) throw new Error('Invalid activity claims.'); // CHANGE
        if (!Array.isArray(value.requests) || value.requests.length > MAX_TARGETS || value.requests.some(request => !request || typeof request.key !== 'string' || typeof request.claimId !== 'string' || !/^[a-f0-9]{64}$/.test(request.claimId) || !Number.isFinite(request.at) || request.cancelledAt !== null && (!Number.isFinite(request.cancelledAt) || request.cancelledAt < request.at))) throw new Error('Invalid activity requests.'); // CHANGE
        targets(value.requests.map(request => request.key)); // CHANGE
        if (!['pending', 'saving', 'saved', 'failed', 'conflict'].includes(value.saveState) || typeof value.online !== 'boolean') throw new Error('Invalid activity state.'); // NEW
        if (!authorize(value.userId) || canvas.revoked || canvas.pending || canvas.projectRetired) throw new Error('Inactive activity author.'); // NEW
        if (value.editing.some(key => !canClaim(value.userId, key))) throw new Error('Unauthorized editing activity.'); // NEW
        return value; // NEW
    } // NEW
    /** Cancellation before a request's deadline withdraws it; an elapsed deadline is terminal. */ // CHANGE
    function requestsFor(candidate) { // CHANGE
        const requests = []; // CHANGE
        for (const { value } of entries.values()) { // CHANGE
            if (value.deviceId === candidate.deviceId && value.sessionId === candidate.sessionId || !authorize(value.userId) || !canClaim(value.userId, candidate.key) || !canvas.members.some(member => member.deviceId === value.deviceId)) continue; // CHANGE: signed peer requests must also have editing authority for the held object.
            for (const request of value.requests) { // CHANGE
                if (request.key !== candidate.key || request.claimId !== candidate.claimId || request.cancelledAt !== null && request.cancelledAt < request.at + REQUEST_MS) continue; // CHANGE
                requests.push({ ...request, userId: value.userId, deviceId: value.deviceId, sessionId: value.sessionId }); // CHANGE
            } // CHANGE
        } // CHANGE
        return requests; // CHANGE
    } // CHANGE
    /** Explicit exit cancels outstanding requests without erasing evidence of a completed expiry. */ // CHANGE
    function endSession(value) { // CHANGE
        const at = now(); // CHANGE
        value.online = false; value.editing = []; value.claims = []; value.viewing = []; value.pending = []; // CHANGE: ending activity retires its notice without declaring a save or deleting private recovery.
        for (const request of value.requests) if (request.cancelledAt === null) request.cancelledAt = Math.max(request.at, at); // CHANGE
    } // CHANGE
    /** Replaceable snapshots may advance presence, but cannot rewrite an observed request or reopen a session. */ // CHANGE
    function advances(previous, value) { // CHANGE
        if (!previous) return true; // CHANGE
        if (value.sequence <= previous.sequence || value.revision < previous.revision || value.userId !== previous.userId || !previous.online && value.online) return false; // CHANGE
        return previous.requests.every(request => value.requests.some(next => next.key === request.key && next.claimId === request.claimId && next.at === request.at && (request.cancelledAt === null || next.cancelledAt === request.cancelledAt))); // CHANGE
    } // CHANGE
    function snapshot(sessionId, actorUserId) { // CHANGE
        const time = monotonic(), sessions = [], presence = [], pendingChanges = [], candidates = []; // NEW
        for (const entry of entries.values()) { // NEW
            const value = entry.value; if (!authorize(value.userId) || !canvas.members.some(member => member.deviceId === value.deviceId)) continue; // NEW
            const fresh = !canvas.revoked && !canvas.pending && !canvas.projectRetired && !canvas.projectFenced && value.online && entry.confirmed && time - entry.receivedAt < LEASE_MS; // CHANGE
            sessions.push({ userId: value.userId, deviceId: value.deviceId, sessionId: value.sessionId, online: !!fresh, saveState: value.saveState, revision: value.revision }); // NEW
            const viewed = fresh ? value.viewing : [...new Set([...value.viewing, ...value.editing])]; if (viewed.length) presence.push({ ...sessions.at(-1), targets: viewed }); // CHANGE: presence can be stale while signed ownership remains effective.
            if (value.online && value.pending.length) pendingChanges.push({ ...sessions.at(-1), targets: value.pending }); // CHANGE: signed closure retires historical notices; heartbeat expiry alone preserves pending work.
            if (value.online && !canvas.revoked && !canvas.pending && !canvas.projectRetired && !canvas.projectFenced) for (const claim of value.claims.filter(claim => canClaim(value.userId, claim.key))) candidates.push({ ...claim, userId: value.userId, deviceId: value.deviceId, sessionId: value.sessionId, online: !!fresh }); // CHANGE
        } // NEW
        candidates.sort((a, b) => a.claimId < b.claimId ? -1 : a.claimId > b.claimId ? 1 : 0); // NEW
        const holds = []; // NEW
        for (const candidate of candidates) if (!holds.some(hold => intersects(hold.key, candidate.key) && (hold.deviceId !== candidate.deviceId || hold.sessionId !== candidate.sessionId))) { // NEW
            const requests = requestsFor(candidate), deadline = requests.length ? Math.min(...requests.map(request => request.at + REQUEST_MS)) : null; // CHANGE
            if (deadline === null || now() < deadline) holds.push({ ...candidate, requested: deadline !== null, requestDeadline: deadline, requesters: requests, expiresAt: deadline }); // CHANGE
        } // NEW
        const losses = []; // CHANGE: report reasons from current authority, rather than guessing from a renderer deadline.
        for (const entry of entries.values()) if (entry.value.deviceId === deviceId && entry.value.sessionId === sessionId) for (const { key, claimId } of entry.value.claims) if (!holds.some(hold => hold.deviceId === deviceId && hold.sessionId === sessionId && hold.claimId === claimId)) { // CHANGE
            const accessChanged = canvas.revoked || canvas.pending || canvas.projectRetired || canvas.projectFenced || !authorize(entry.value.userId) || !canClaim(entry.value.userId, key); // CHANGE
            const requested = requestsFor({ key, claimId, deviceId, sessionId }).some(request => now() >= request.at + REQUEST_MS); // CHANGE
            losses.push({ key, claimId, code: accessChanged ? 'ACCESS_CHANGED' : requested ? 'HANDOFF_EXPIRED' : 'CONCURRENT_EDITOR', reason: accessChanged ? 'Your access to this object changed.' : requested ? 'The requested editing handoff deadline ended.' : 'Another concurrent editor has priority for this object.' }); // CHANGE
        } // CHANGE
        return { protocolVersion: canvas.protocolVersion || 4, observationRevision: ++observationRevision, actorUserId, sessionId, holds, losses, reservations: [], presence, pendingChanges, sessions }; // CHANGE
    } // NEW
    function announce() { // NEW
        if (closed) return; // NEW
        const value = snapshot(), next = JSON.stringify([value.sessions, value.presence, value.pendingChanges, value.holds.map(({ expiresAt, ...hold }) => hold)]); // NEW
        if (next !== fingerprint) { fingerprint = next; try { onChange(value); } catch (_) {} } // NEW
    } // NEW
    async function scan() { // NEW
        if (closed) return; // NEW
        if (scanTask) { scanAgain = true; return scanTask; } // NEW
        scanTask = (async () => { do { // NEW
            scanAgain = false; // NEW
            const names = await fs.readdir(directory).catch(error => { if (error.code === 'ENOENT') return []; throw error; }); // NEW
            if (names.length > 4096) throw new Error('Too many activity snapshots.'); // NEW
            for (let offset = 0; offset < names.length; offset += 16) await Promise.all(names.slice(offset, offset + 16).filter(name => /^[a-f0-9]{64}\.json$/.test(name)).map(async name => { // NEW
                try { // NEW
                    const envelope = JSON.parse(await readBounded(path.join(directory, name), MAX_BYTES)), value = validate(envelope.payload); // NEW
                    const member = canvas.members.find(member => member.deviceId === value.deviceId); // NEW
                    if (!member || !verifyRecord(envelope, member.publicKey) || name !== digest(keyFor(value)) + '.json') return; // NEW
                    const key = keyFor(value), previous = entries.get(key); // NEW
                    if (!advances(previous?.value, value)) return; // CHANGE: duplicates, reordered status and request rewrites cannot renew or reverse handoff decisions.
                    entries.set(key, { value, confirmed: !!previous, receivedAt: monotonic() }); // NEW
                } catch (_) { /* Invalid peer status is ignored; it cannot modify content or authority. */ } // NEW
            })); // NEW
            announce(); // NEW
        } while (scanAgain && !closed); })().finally(() => { scanTask = null; }); // NEW
        return scanTask; // NEW
    } // NEW
    async function start() { // NEW
        if (initializing) return initializing; // NEW
        initializing = (async () => { // NEW
            await fs.mkdir(directory, { recursive: true, mode: 0o700 }); // NEW
            if (closed) return; // NEW
            watcher = watch(directory, () => { if (!notifyTimer) notifyTimer = setTimeout(() => { notifyTimer = null; scan().catch(() => {}); }, 20); }); // NEW
            watcher.on('error', () => {}); watcher.unref(); // NEW
            await scan(); timer = setInterval(() => { announce(); scan().catch(() => {}); }, 1000); timer.unref(); // NEW
        })(); // NEW
        return initializing; // NEW
    } // NEW
    async function publish(value) { // NEW
        validate(value); value.sequence++; // NEW
        const { pendingText, writeTask, ...payload } = value; // NEW: queue internals and promises never enter signed peer metadata.
        const envelope = signRecord(payload, keys.privateKey), text = JSON.stringify(envelope); // NEW
        if (Buffer.byteLength(text) > MAX_BYTES) throw new Error('Activity snapshot is too large.'); // NEW
        entries.set(keyFor(value), { value: structuredClone(payload), confirmed: true, receivedAt: monotonic() }); announce(); // NEW
        // Each session has its own write chain; replace pending snapshots instead of queuing heartbeats. // NEW
        value.pendingText = text; // NEW
        if (!value.writeTask) value.writeTask = Promise.resolve().then(async () => { try { while (value.pendingText) { const next = value.pendingText; value.pendingText = null; await writeAtomic(path.join(directory, digest(keyFor(value)) + '.json'), next); } } finally { value.writeTask = null; } }); // CHANGE: trailing publications cannot attach after the writer has drained but before its slot is released.
        await value.writeTask; // NEW
    } // NEW
    async function action(callerId, userId, input) { // NEW
        await start(); if (closed) throw new Error('Activity service is closed.'); // NEW
        const sessionId = sessionFor(callerId, userId), key = String(callerId) + ':' + userId; // NEW
        if (input.kind === 'snapshot') return { ok: true, collaboration: snapshot(sessionId, userId) }; // CHANGE: reads must not create or replace a session's persisted ownership.
        let value = local.get(key); // NEW
        if (!value) { const stored = entries.get(keyFor({ deviceId, sessionId }))?.value; value = stored ? structuredClone(stored) : { schema: canvas.protocolVersion || 4, shareId: canvas.shareId, diagramId: canvas.diagramId, deviceId, userId, sessionId, sequence: 1, revision: 0, viewing: [], editing: [], claims: [], pending: [], requests: [], saveState: 'saved', online: true }; local.set(key, value); } // CHANGE: resume the signed sequence and generation after an activity-service restart.
        if (!value.online || value.userId !== userId) throw new Error('This editing session is closed.'); // CHANGE: delayed callbacks cannot reopen a completed session.
        if (!authorize(userId) || canvas.revoked || canvas.pending || canvas.projectRetired || canvas.projectFenced) throw new Error('Inactive activity author.'); // CHANGE
        const requested = input.targets === undefined ? undefined : targets(input.targets); // CHANGE
        if (input.claimIds !== undefined && (!Array.isArray(input.claimIds) || input.claimIds.length > MAX_TARGETS || input.claimIds.some(id => typeof id !== 'string'))) throw new Error('Invalid activity claim references.'); // CHANGE
        if (input.revision !== undefined && (!Number.isSafeInteger(input.revision) || input.revision < value.revision)) throw new Error('Stale activity revision.'); // CHANGE: reject invalid inputs before mutating the session.
        if (input.objects) targets(input.objects); if (input.pending) targets(input.pending); // CHANGE
        if (input.saveState && !['pending', 'saving', 'saved', 'failed', 'conflict'].includes(input.saveState)) throw new Error('Invalid activity state.'); // CHANGE
        if (input.kind === 'claim') { // NEW
            const wanted = requested || [], state = snapshot(sessionId, userId); // CHANGE
            if (wanted.some(key => !canClaim(userId, key))) throw new Error('Unauthorized editing activity.'); // CHANGE
            if (value.claims.some(claim => wanted.includes(claim.key) && !state.holds.some(hold => hold.claimId === claim.claimId))) return { ok: false, code: 'HOLD_LOST', reason: 'The editing hold ended. Open a fresh editor to continue.', collaboration: state }; // CHANGE: an expired editor must release its generation before acquiring another.
            const blocked = state.holds.filter(hold => (hold.sessionId !== sessionId || hold.deviceId !== deviceId) && wanted.some(key => intersects(key, hold.key))); // CHANGE
            if (blocked.length) return { ok: false, reason: 'Another editor holds this object. Request release to take over.', blocked, collaboration: state }; // CHANGE
            const editing = targets([...value.editing, ...wanted]); // CHANGE
            for (const key of wanted.filter(key => !value.editing.includes(key))) value.claims.push({ key, claimId: digest(keyFor(value) + ':' + key + ':' + makeId()) }); // CHANGE
            value.editing = editing; // CHANGE
        } else if (input.kind === 'release') { // CHANGE
            value.claims = value.claims.filter(claim => requested && !requested.includes(claim.key) || input.claimIds && !input.claimIds.includes(claim.claimId)); // CHANGE: a delayed release cannot remove a replacement generation.
            value.editing = value.claims.map(claim => claim.key); // CHANGE
        } // CHANGE
        else if (input.kind === 'request') { // CHANGE
            const wanted = requested || [], state = snapshot(sessionId, userId); // CHANGE
            const held = state.holds.filter(hold => (hold.deviceId !== deviceId || hold.sessionId !== sessionId) && wanted.some(key => intersects(key, hold.key))); // CHANGE
            if (wanted.some(key => !canClaim(userId, key)) || held.some(hold => !canClaim(userId, hold.key))) throw new Error('Unauthorized release request.'); // CHANGE
            const additions = held.filter(hold => !value.requests.some(request => request.claimId === hold.claimId)).map(hold => ({ key: hold.key, claimId: hold.claimId, at: now(), cancelledAt: null })); // CHANGE
            if (value.requests.length + additions.length > MAX_TARGETS) throw new Error('Too many activity requests.'); // CHANGE
            value.requests.push(...additions); // CHANGE
        } // CHANGE
        else if (!['view', 'publish', 'close'].includes(input.kind)) throw new Error('Unsupported activity operation.'); // NEW
        if (input.objects) value.viewing = targets(input.objects); // NEW
        if (input.pending) value.pending = targets(input.pending); // NEW
        if (input.revision !== undefined) value.revision = input.revision; // CHANGE
        if (input.saveState) value.saveState = input.saveState; // NEW
        if (input.kind === 'close') endSession(value); // CHANGE
        await publish(value); return { ok: true, collaboration: snapshot(sessionId, userId) }; // CHANGE
    } // NEW
    function forget(callerId) { // CHANGE
        for (const [key, value] of local) if (key.startsWith(callerId + ':')) { // CHANGE
            endSession(value); const task = publish(value).catch(() => {}).finally(() => departing.delete(task)); departing.add(task); local.delete(key); // CHANGE
        } // CHANGE
    } // CHANGE
    async function close() { closed = true; clearInterval(timer); clearTimeout(notifyTimer); watcher?.close(); await Promise.allSettled([...local.values()].map(value => value.writeTask).concat([...departing])); await scanTask?.catch(() => {}); } // CHANGE: exit publications must reach disk even after their session has left the local map.
    return { start, scan, action, snapshot, forget, close }; // NEW
} // NEW
