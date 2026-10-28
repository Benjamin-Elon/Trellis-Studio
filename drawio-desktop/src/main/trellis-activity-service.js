/** Signed, replaceable activity snapshots. No operation reads or replays the content journal. */ // NEW
import fs from 'node:fs/promises'; // NEW
import { watch } from 'node:fs'; // NEW
import path from 'node:path'; // NEW
import { digest, signRecord, verifyRecord, safeId } from './trellis-share-protocol.js'; // NEW
import { readBounded } from './trellis-input-policy.js'; // NEW

export const HEARTBEAT_MS = 5000; // NEW
export const LEASE_MS = 30000; // NEW
const MAX_TARGETS = 2048, MAX_BYTES = 256 * 1024; // NEW
const intersects = (a, b) => a === '*' || b === '*' || a === b; // NEW

/** Ownership is advisory coordination; content permissions and base hashes remain authoritative. */ // NEW
export function createActivityService({ canvas, deviceId, keys, sessionFor, writeAtomic, authorize = () => true, canClaim = () => true, monotonic = () => performance.now(), now = Date.now, onChange = () => {} }) { // CHANGE
    const directory = path.join(canvas.folderPath, '.trellis', 'activity-v3'), entries = new Map(), local = new Map(); // NEW
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
        if (value?.schema !== 3 || value.shareId !== canvas.shareId || value.diagramId !== canvas.diagramId || !Number.isSafeInteger(value.sequence) || value.sequence < 1 || !Number.isSafeInteger(value.revision) || value.revision < 0) throw new Error('Invalid activity identity or revision.'); // NEW
        safeId(value.deviceId); safeId(value.sessionId); safeId(value.userId); // NEW
        for (const field of ['viewing', 'editing', 'pending']) targets(value[field]); // NEW
        if (!Array.isArray(value.requests) || value.requests.length > MAX_TARGETS || value.requests.some(request => !request || typeof request.key !== 'string' || typeof request.claimId !== 'string' || !Number.isFinite(request.at))) throw new Error('Invalid activity requests.'); // NEW
        if (!['pending', 'saving', 'saved', 'failed', 'conflict'].includes(value.saveState) || typeof value.online !== 'boolean') throw new Error('Invalid activity state.'); // NEW
        if (!authorize(value.userId) || canvas.revoked || canvas.pending || canvas.projectRetired) throw new Error('Inactive activity author.'); // NEW
        if (value.editing.some(key => !canClaim(value.userId, key))) throw new Error('Unauthorized editing activity.'); // NEW
        return value; // NEW
    } // NEW
    function snapshot(sessionId) { // NEW
        const time = monotonic(), sessions = [], presence = [], pendingChanges = [], candidates = []; // NEW
        for (const entry of entries.values()) { // NEW
            const value = entry.value; if (!authorize(value.userId) || !canvas.members.some(member => member.deviceId === value.deviceId)) continue; // NEW
            const fresh = value.online && entry.confirmed && time - entry.receivedAt < LEASE_MS; // NEW
            sessions.push({ userId: value.userId, deviceId: value.deviceId, sessionId: value.sessionId, online: !!fresh, saveState: value.saveState, revision: value.revision }); // NEW
            const viewed = fresh ? value.viewing : [...new Set([...value.viewing, ...value.editing])]; if (viewed.length) presence.push({ ...sessions.at(-1), targets: viewed }); // CHANGE: last-known activity remains visible without granting an expired reservation.
            if (value.pending.length) pendingChanges.push({ ...sessions.at(-1), targets: value.pending }); // NEW
            if (fresh) for (const key of value.editing.filter(key => canClaim(value.userId, key))) candidates.push({ key, userId: value.userId, deviceId: value.deviceId, sessionId: value.sessionId, claimId: digest(keyFor(value) + ':' + key), expiresAt: now() + Math.max(0, LEASE_MS - (time - entry.receivedAt)) }); // CHANGE
        } // NEW
        candidates.sort((a, b) => a.claimId < b.claimId ? -1 : a.claimId > b.claimId ? 1 : 0); // NEW
        const holds = []; // NEW
        for (const candidate of candidates) if (!holds.some(hold => intersects(hold.key, candidate.key) && (hold.deviceId !== candidate.deviceId || hold.sessionId !== candidate.sessionId))) { // NEW
            const requests = [...entries.values()].filter(entry => entry.confirmed && entry.value.online && time - entry.receivedAt < LEASE_MS).flatMap(entry => entry.value.requests.filter(request => request.claimId === candidate.claimId).map(request => ({ ...request, userId: entry.value.userId }))); // NEW
            const deadline = requests.length ? Math.min(...requests.map(request => request.at + 300000)) : null; // NEW
            if (!deadline || now() < deadline) holds.push({ ...candidate, requested: !!deadline, requesters: requests, expiresAt: deadline ? Math.min(candidate.expiresAt, deadline) : candidate.expiresAt }); // NEW
        } // NEW
        return { protocolVersion: 3, sessionId, holds, reservations: [], presence, pendingChanges, sessions }; // NEW
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
                    if (previous && (value.sequence <= previous.value.sequence || value.revision < previous.value.revision || value.userId !== previous.value.userId)) return; // CHANGE: a newer envelope cannot regress its model revision or change the session's author.
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
        let value = local.get(key); // NEW
        if (!value) { value = { schema: 3, shareId: canvas.shareId, diagramId: canvas.diagramId, deviceId, userId, sessionId, sequence: 1, revision: 0, viewing: [], editing: [], pending: [], requests: [], saveState: 'saved', online: true }; local.set(key, value); } // NEW
        if (input.kind === 'snapshot') return { ok: true, collaboration: snapshot(sessionId) }; // NEW
        if (input.kind === 'claim') { // NEW
            const requested = targets(input.targets), state = snapshot(sessionId); // NEW
            const blocked = state.holds.filter(hold => (hold.sessionId !== sessionId || hold.deviceId !== deviceId) && requested.some(key => intersects(key, hold.key))); // NEW
            if (blocked.length) return { ok: false, reason: 'Another connected user is editing this object.', blocked, collaboration: state }; // NEW
            value.editing = targets([...value.editing, ...requested]); // NEW
        } else if (input.kind === 'release') value.editing = input.targets ? value.editing.filter(key => !targets(input.targets).includes(key)) : []; // NEW
        else if (input.kind === 'request') { const state = snapshot(sessionId); for (const hold of state.holds.filter(hold => targets(input.targets).some(key => intersects(key, hold.key)))) if (!value.requests.some(request => request.claimId === hold.claimId)) value.requests.push({ key: hold.key, claimId: hold.claimId, at: now() }); } // NEW
        else if (!['view', 'publish', 'close'].includes(input.kind)) throw new Error('Unsupported activity operation.'); // NEW
        if (input.objects) value.viewing = targets(input.objects); // NEW
        if (input.pending) value.pending = targets(input.pending); // NEW
        if (input.revision !== undefined) { if (!Number.isSafeInteger(input.revision) || input.revision < value.revision) throw new Error('Stale activity revision.'); value.revision = input.revision; } // NEW
        if (input.saveState) value.saveState = input.saveState; // NEW
        value.online = input.kind !== 'close'; // NEW
        if (!value.online) { value.editing = []; value.viewing = []; } // NEW
        await publish(value); return { ok: true, collaboration: snapshot(sessionId) }; // NEW
    } // NEW
    function forget(callerId) { for (const [key, value] of local) if (key.startsWith(callerId + ':')) { value.online = false; value.editing = []; value.viewing = []; publish(value).catch(() => {}); local.delete(key); } } // NEW
    async function close() { closed = true; clearInterval(timer); clearTimeout(notifyTimer); watcher?.close(); await Promise.allSettled([...local.values()].map(value => value.writeTask)); await scanTask?.catch(() => {}); } // NEW
    return { start, scan, action, snapshot, forget, close }; // NEW
} // NEW
