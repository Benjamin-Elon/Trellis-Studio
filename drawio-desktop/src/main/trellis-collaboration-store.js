/** Durable signed collaboration journal; Syncthing transports the files unchanged. // NEW
 * Each mutation is serialized locally. Only genesis/records/assets synchronize; // NEW
 * materialized XML and rejected proposals remain local. // NEW */
import fs from 'node:fs/promises'; // NEW
import path from 'node:path'; // NEW
import { naming, withProjectName, validateProjectNameChange } from './trellis-project-naming.js'; // NEW
import { digest, makeId, signRecord, verifyRecord, safeId, inspectDiagram } from './trellis-share-protocol.js'; // NEW
import { diffObjects, applyChanges, authorityFor, invitationAcceptance, objects, logicalKey, targetsForObject, COLLABORATION_VERSION, HOLD_MS } from './trellis-collaboration-protocol.js'; // CHANGE
import { replayInWorker } from './trellis-collaboration-worker.js'; // NEW: verified journal replay must not block the Electron main thread.
export function createCollaborationStore({ canvas, deviceId, keys, profile, now = Date.now, writeAtomic, writeImmutable, prepareXml = async xml => xml, beforeMaterialize = async () => {} }) { // CHANGE
    const directory = path.join(canvas.folderPath, '.trellis', 'collaboration-v2'), sessions = new Map(); // NEW
    let queue = Promise.resolve(), latest = null, recoveryPaths = []; // NEW
    const sessionFor = (callerId, userId) => { const key = callerId + ':' + userId; if (!sessions.has(key)) sessions.set(key, makeId()); return sessions.get(key); }; // NEW
    function serialized(operation) { const next = queue.then(operation); queue = next.catch(() => {}); return next; } // NEW
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
    } // NEW
    async function read() { // NEW
        const indexFile = path.join(profile, 'recovery', canvas.shareId, 'index.json'); // NEW
        const savedCopies = await fs.readFile(indexFile, 'utf8').then(JSON.parse).catch(err => { if (err.code === 'ENOENT') return []; throw err; }); // NEW
        recoveryPaths = savedCopies.filter(p => /^local-[a-f0-9-]{36}\.drawio$/.test(p.filename) || p.filename === canvas.filename).map(p => ({ ...p, recoveryPath: path.join(profile, 'recovery', canvas.shareId, p.filename) })); // NEW
        const genesis = JSON.parse(await fs.readFile(path.join(directory, 'genesis.json'), 'utf8')); // NEW
        if (!verifyRecord(genesis, canvas.genesisCoordinatorPublicKey || canvas.coordinatorPublicKey) || genesis.payload.schema !== COLLABORATION_VERSION || genesis.payload.shareId !== canvas.shareId || genesis.payload.diagramId !== canvas.diagramId || digest(genesis.payload.xml) !== genesis.payload.hash) throw new Error('The project snapshot could not be verified.'); // CHANGE: handover retains the original signed genesis.
        const records = [], errors = []; // NEW
        const names = await fs.readdir(path.join(directory, 'records')).catch(err => { if (err.code === 'ENOENT') return []; throw err; }); // NEW
        const members = new Map(canvas.members.map(m => [m.deviceId, m])); // NEW
        for (const name of names.sort()) if (/^[a-zA-Z0-9_-]+\.json$/.test(name)) { // NEW
            try { // NEW
                const filename = path.join(directory, 'records', name), stat = await fs.stat(filename); // NEW
                if (stat.size > 128 * 1024 * 1024) throw new Error('Collaboration record is too large.'); // NEW
                const record = JSON.parse(await fs.readFile(filename, 'utf8')), r = record.payload; // NEW
                const retired = (canvas.retiredMembers || []).find(m => m.deviceId === r?.deviceId && m.recordIds?.includes(r?.id)); // NEW
                const member = members.get(r?.deviceId) || retired; // NEW
                if (!r || r.id + '.json' !== name || r.schema !== COLLABORATION_VERSION || r.shareId !== canvas.shareId || r.diagramId !== canvas.diagramId || !member || !verifyRecord(record, member.publicKey) || !['claim', 'activity', 'edit', 'view', 'request', 'release'].includes(r.kind) || !Number.isSafeInteger(r.clock) || r.clock < 1 || !Number.isFinite(r.at) || !Array.isArray(r.parents) || r.parents.some(id => typeof id !== 'string') || r.targets && (!Array.isArray(r.targets) || r.targets.some(k => typeof k !== 'string'))) throw new Error('Invalid or unapproved collaboration record.'); // NEW
                if (r.at > now() + HOLD_MS) throw new Error('This peer clock is more than five minutes ahead. Correct its clock before sharing edits.'); // NEW
                safeId(r.id); safeId(r.sessionId); validateFields(r); records.push({ ...r, retiredAt: members.has(r.deviceId) ? null : retired?.retiredAt }); // NEW: never trust a record's own retirement claim.
            } catch (err) { errors.push({ filename: name, reason: err.message }); } // NEW
        } // NEW
        const map = new Map(records.map(r => [r.id, r])); // NEW
        let valid = records.filter(r => { const malformed = r.parents.some(id => map.has(id) && map.get(id).clock >= r.clock); if (malformed) errors.push({ filename: r.id + '.json', reason: 'Invalid causal clock.' }); return !malformed; }); // NEW
        const refused = new Set(errors.map(e => e.filename.replace(/\.json$/, ''))); let changed = true; // NEW
        while (changed) { changed = false; valid = valid.filter(r => { if (!r.parents.some(id => refused.has(id))) return true; refused.add(r.id); errors.push({ filename: r.id + '.json', reason: 'This proposal depends on a rejected or retired peer record.' }); changed = true; return false; }); } // NEW
        const state = await replayInWorker(genesis.payload.xml, valid, now()); // CHANGE: retain restored validation, queue ordering and materialization safeguards around off-thread replay.
        const knownProposals = new Set(records.filter(r => r.kind === 'edit').map(r => 'local-' + r.id + '.drawio')); // NEW
        const preservedNames = await fs.readdir(path.join(profile, 'recovery', canvas.shareId)).catch(err => { if (err.code === 'ENOENT') return []; throw err; }); // NEW
        for (const filename of preservedNames) if (/^local-[a-f0-9-]{36}\.drawio$/.test(filename) && !knownProposals.has(filename) && !recoveryPaths.some(p => p.filename === filename)) recoveryPaths.push({ filename, recoveryPath: path.join(profile, 'recovery', canvas.shareId, filename), reason: 'Interrupted local proposal preserved before publication.' }); // NEW: a crash between archival and journal publication leaves a discoverable recovery copy.
        if (canvas.filename && preservedNames.includes(canvas.filename) && !recoveryPaths.some(p => p.filename === canvas.filename)) recoveryPaths.push({ filename: canvas.filename, recoveryPath: path.join(profile, 'recovery', canvas.shareId, canvas.filename), reason: 'Verified full backup from sharing setup.' }); // CHANGE: the initial full backup remains accessible from the collaboration overview.
        for (const r of records) if (refused.has(r.id)) state.rejected.push({ id: r.id, reason: errors.find(e => e.filename === r.id + '.json')?.reason || 'Rejected predecessor.' }); // NEW
        for (const rejection of state.rejected) { // NEW
            const record = records.find(r => r.id === rejection.id && r.deviceId === deviceId && r.kind === 'edit'); // NEW
            if (!record || recoveryPaths.some(p => p.filename === 'local-' + record.id + '.drawio')) continue; // NEW
            const filename = 'local-' + record.id + '.drawio', recoveryPath = path.join(profile, 'recovery', canvas.shareId, filename); // NEW
            if (await fs.stat(recoveryPath).then(s => s.isFile()).catch(() => false)) recoveryPaths.push({ filename, recoveryPath, reason: rejection.reason }); // NEW
        } // NEW
        latest = { ...state, records: valid, errors, snapshotHash: genesis.payload.hash }; // NEW
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
        await writeImmutable(path.join(directory, 'records', payload.id + '.json'), signRecord(payload, keys.privateKey)); // NEW
        return payload; // NEW
    } // NEW
    async function preserve(xml, reason) { // NEW
        const filename = 'local-' + makeId() + '.drawio', recoveryPath = path.join(profile, 'recovery', canvas.shareId, filename); // NEW
        await writeAtomic(recoveryPath, xml); recoveryPaths.push({ filename, recoveryPath, reason }); // NEW
        await writeAtomic(path.join(profile, 'recovery', canvas.shareId, 'index.json'), JSON.stringify(recoveryPaths)); return recoveryPath; // NEW
    } // NEW
    async function materialize(state) { // NEW
        if (canvas.localRemoved || canvas.projectRetired) return; // NEW: queued refreshes must never recreate a retired projection.
        await beforeMaterialize(state.xml); // NEW: naming runs inside the same queue as every projection write.
        if (canvas.localRemoved || canvas.projectRetired) return; // NEW
        const existing = await fs.readFile(canvas.diagramPath, 'utf8').catch(err => { if (err.code === 'ENOENT') return null; throw err; }); // NEW
        const markerPath = path.join(profile, 'recovery', canvas.shareId, 'projection.json'); // NEW
        const marker = await fs.readFile(markerPath, 'utf8').then(JSON.parse).catch(err => { if (err.code === 'ENOENT') return null; throw err; }); // NEW
        if (existing && existing !== state.xml && digest(existing) !== (marker?.hash || state.snapshotHash)) await preserve(existing, 'External or interrupted local changes were preserved before rebuilding the project.'); // NEW
        if (existing !== state.xml) await writeAtomic(canvas.diagramPath, state.xml); // NEW
        const hash = digest(state.xml); // CHANGE: unchanged polling must not rewrite the recovery marker.
        if (marker?.hash !== hash) await writeAtomic(markerPath, JSON.stringify({ hash })); // CHANGE
    } // NEW
    async function refresh() { return serialized(async () => { const previous = latest; const state = await read(); latest = previous; await materialize(state); latest = state; return publicState(state); }); } // NEW
    function publicState(state, sessionId) { // NEW
        const parsed = inspectDiagram(state.xml), roster = parsed.store.users || [], labels = new Map(); // CHANGE: presentation needs labels, not a second full object serialization/hash index.
        const pageIds = new Map(parsed.document.pages.map(page => [page.doc, page.container?.getAttribute('id') || ''])); // CHANGE
        for (const cell of parsed.cells) labels.set(JSON.stringify([pageIds.get(cell.node.ownerDocument), cell.id]), cell.node.getAttribute('label') || cell.node.getAttribute('value') || cell.id); // CHANGE
        const identify = value => ({ ...value, name: roster.find(u => u.id === value.userId)?.name || 'Unknown user', objectLabel: value.key === '*' ? 'project structure' : labels.get(value.key), objects: value.targets?.map(key => ({ key, label: labels.get(key) })) }); // CHANGE: retain labels for other pages and invisible objects.
        return { protocolVersion: COLLABORATION_VERSION, sessionId, hash: digest(state.xml), holds: state.holds.map(identify), reservations: state.reservations.map(identify), presence: state.presence.map(identify), pending: state.pending.length, errors: state.errors, rejected: state.rejected, recoveries: recoveryPaths }; // NEW
    } // NEW
    /** A no-peer action still writes a signed durable proposal and succeeds locally. */ // NEW
    async function action(callerId, userId, input) { // NEW
        return serialized(async () => { // NEW
            if (canvas.revoked || canvas.pending) throw new Error('This computer is not approved to edit this project.'); // NEW
            const actor = { userId, sessionId: sessionFor(callerId, userId) }; // NEW
            let state = await read(), journalChanged = false; const authorityContext = {}; // CHANGE: reuse the authorized snapshot until this action appends a record.
            const roster = inspectDiagram(state.xml).store; // NEW
            if (input.kind === 'projectName') { // NEW
                if (!roster.users?.some(user => user.id === userId && user.admin && !user.disabled)) throw new Error('Only an active project administrator can change the shared project name.'); // NEW
                input = { kind: 'save', baseXml: state.xml, xml: withProjectName(state.xml, naming.projectName(input.name)) }; // NEW
            } // NEW
            if (!roster.users?.some(u => u.id === userId && !u.disabled) && !roster.invites?.some(i => i.pendingUserId === userId && i.status === 'pending' && i.expiresAt > now())) throw new Error('Log in with an active project user.'); // NEW
            if (input.kind === 'get') { // NEW
                await materialize(state); // NEW
            } else if (input.kind === 'view') { // NEW
                const index = objects(state.xml); const targets = [...new Set((input.objects || []).filter(k => index.has(k)).map(k => logicalKey(index, k)))]; // NEW
                const previous = state.records.filter(r => r.sessionId === actor.sessionId && r.kind === 'view').sort((a, b) => b.clock - a.clock)[0]; // NEW
                if (!previous || JSON.stringify(previous.targets) !== JSON.stringify(targets) || now() - previous.at >= HOLD_MS / 2) { await append(state, actor, 'view', { targets }); journalChanged = true; } // CHANGE
            } else if (input.kind === 'request') { // NEW
                const holds = state.holds.filter(h => (input.targets || []).includes(h.key) && h.sessionId !== actor.sessionId); // NEW
                if (holds.some(h => authorityFor(state.xml, h.key, userId, authorityContext) < 1)) throw new Error('You cannot request editing access to this object.'); // CHANGE
                await append(state, actor, 'request', { claimIds: [...new Set(holds.map(h => h.claimId))] }); // NEW
                journalChanged = true; // CHANGE
            } else if (input.kind === 'release') { // NEW
                await append(state, actor, 'release', input.targets === undefined ? {} : { targets: input.targets }); // CHANGE: omitted fields must stay omitted after signing and JSON serialization.
                journalChanged = true; // CHANGE
            } else if (input.kind === 'claim' || input.kind === 'save') { // NEW
                if (input.kind === 'save') input = { ...input, xml: await prepareXml(input.xml) }; // CHANGE
                let delta; // CHANGE: full-proposal diffing already constructs its own validated object indexes.
                if (input.kind === 'claim' && !input.xml) { const index = objects(state.xml); delta = { changes: [{}], targets: [...new Set((input.targets || []).filter(k => index.has(k)).flatMap(k => targetsForObject(index, k)))] }; } // CHANGE
                else delta = diffObjects(input.baseXml, input.xml); // CHANGE
                if (input.kind === 'claim' && !delta.targets.length) throw new Error('Select the object to edit first.'); // NEW
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
                        return { ok: false, reason, recoveryPath, xml: state.xml, collaboration: publicState(state, actor.sessionId) }; // NEW
                    } // NEW
                    let holds = state.holds.filter(h => delta.targets.includes(h.key) && h.sessionId === actor.sessionId); // NEW
                    if (delta.targets.some(k => !holds.some(h => h.key === k))) { // NEW
                        await append(state, actor, 'claim', { targets: delta.targets, ...(accountSetup ? { usersPolicyAction: true, policyChanges: delta.changes } : {}) }); state = await read(); // NEW
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
                        state = await read(); const rejection = state.rejected.find(r => r.id === edit.id); // NEW
                        if (rejection) { const recoveryPath = await preserve(input.xml, rejection.reason); return { ok: false, ...rejection, recoveryPath, xml: state.xml, collaboration: publicState(state, actor.sessionId) }; } // NEW
                        if (!state.accepted.includes(edit.id)) throw new Error('Changes are preserved locally but are waiting for missing predecessor records.'); // NEW
                    } // NEW
                } // NEW
            } else throw new Error('Unsupported collaboration action.'); // NEW
            if (journalChanged) state = await read(); // CHANGE: claim/edit writes already refreshed state; read-only actions need one replay.
            if (input.kind === 'save') await materialize(state); // NEW: even a no-op save must refresh the durable local projection.
            return { ok: true, xml: state.xml, collaboration: publicState(state, actor.sessionId) }; // NEW
        }); // NEW
    } // NEW
    return { initialize, refresh, action, read, snapshot: () => serialized(read), runExclusive: serialized, saveRecovery: xml => serialized(async () => { await read(); const recoveryPath = await preserve(xml, 'Manually saved recovery copy.'); return { recoveryPath, filename: path.basename(recoveryPath) }; }), flush: () => queue, forget: callerId => { for (const key of [...sessions.keys()]) if (key.startsWith(callerId + ':')) { const userId = key.slice(String(callerId).length + 1); action(callerId, userId, { kind: 'release' }).catch(() => {}).finally(() => sessions.delete(key)); } } }; // CHANGE
} // NEW
