import { readJson } from './trellis-input-policy.js'; // NEW
/** Incremental accepted-state collaboration; Syncthing transports signed decisions unchanged. // NEW
 * Each mutation is serialized locally. Only checkpoints/decisions/assets synchronize; // NEW
 * materialized XML and rejected proposals remain local. // NEW */
import fs from 'node:fs/promises'; // NEW
import path from 'node:path'; // NEW
import { naming, withProjectName, validateProjectNameChange } from './trellis-project-naming.js'; // NEW
import { digest, makeId, inspectDiagram, canonical } from './trellis-share-protocol.js'; // CHANGE
import { diffObjects, applyChanges, revertDraftChanges, authorityFor, invitationAcceptance, objects, logicalKey, targetsForObject, COLLABORATION_VERSION, PRESENCE_MS } from './trellis-collaboration-protocol.js'; // CHANGE
import { createCurrentStateStore } from './trellis-current-state.js'; // CHANGE: accepted state replaces historical arbitration.
import { createObjectViews } from './trellis-object-views.js'; // CHANGE
import { permissions, permissionSnapshot, validatePermissionChanges } from './trellis-permission-policy.js'; // NEW
import { reviewDraft, resolveDraft } from './trellis-draft-conflicts.js'; // NEW
export function createCollaborationStore({ canvas, deviceId, keys, profile, now = Date.now, writeAtomic, writeImmutable, prepareXml = async xml => xml, beforeMaterialize = async () => {}, beforeCommit = () => [], onTiming = () => {}, onVerified = () => {} }) { // CHANGE
    let nextOperationId = 0, activeOperationId = 0; // NEW
    const timing = sample => { try { onTiming({ operationId: activeOperationId, ...sample }); } catch (_) {} }; // NEW: observers cannot fail a durable operation.
    const sessions = new Map(); // CHANGE
    const current = createCurrentStateStore({ canvas, deviceId, keys, writeAtomic, writeImmutable, now, onTiming: timing }); // CHANGE
    let queue = Promise.resolve(), latest = null, recoveryPaths = []; // NEW
    const views = createObjectViews({ profile, canvas, writeAtomic, now }); // NEW: private, serialized by this store's existing journal queue.
    const checkpointRetries = new Map(); // NEW: a failed private write must not republish an already accepted local edit on retry.
    let policyXml = null, policySnapshot = null, policyHash = null, presentation = null; const policySent = new Map(); // CHANGE: the current presentation is reused across unchanged state reads.
    const sessionFor = (callerId, userId) => { const key = callerId + ':' + userId; if (!sessions.has(key)) sessions.set(key, makeId()); return sessions.get(key); }; // NEW
    let pendingRefresh = null; // NEW: only adjacent refresh requests may share work.
    function serialized(operation, kind = 'action') { // CHANGE
        const queued = performance.now(), operationId = ++nextOperationId; if (kind !== 'refresh') pendingRefresh = null; // NEW: mutations fence refresh coalescing.
        const next = queue.then(async () => { const started = performance.now(); activeOperationId = operationId; try { return await operation(); } finally { timing({ phase: 'queue', kind, waitMs: started - queued, durationMs: performance.now() - started }); activeOperationId = 0; } }); // CHANGE
        queue = next.catch(() => {}); return next; // CHANGE
    } // CHANGE
    let recoveryLoaded = false; // CHANGE
    /** Initialize one verified state; no historical collaboration records are consulted. */ // CHANGE
    async function initialize(xml) { const state = await current.initialize(xml); onVerified(state); return state; } // CHANGE
    /** Read a small signed head and only new accepted changes; load recovery metadata once. */ // CHANGE
    async function read() { // CHANGE
        if (!recoveryLoaded) { // CHANGE
            const saved = await readJson(path.join(profile, 'recovery', canvas.shareId, 'index.json')).catch(error => { if (error.code === 'ENOENT') return []; throw error; }); // CHANGE
            if (!Array.isArray(saved)) throw new Error('Invalid private recovery index.'); // CHANGE
            recoveryPaths = saved.filter(item => item && typeof item.filename === 'string' && (/^local-[a-f0-9-]{36}\.drawio$/.test(item.filename) || item.filename === canvas.filename)).map(item => ({ ...item, recoveryPath: path.join(profile, 'recovery', canvas.shareId, item.filename) })); // CHANGE
            recoveryLoaded = true; // CHANGE
        } // CHANGE
        latest = await current.read(); onVerified(latest); return latest; // CHANGE
    } // CHANGE
    async function preserve(xml, reason, editorDrafts = []) { // CHANGE
        if (!Array.isArray(editorDrafts) || editorDrafts.some(editor => !editor || !['planting', 'year-planner'].includes(editor.kind) || !Array.isArray(editor.targets))) throw new Error('Invalid editor recovery data.'); // NEW
        const filename = 'local-' + makeId() + '.drawio', recoveryPath = path.join(profile, 'recovery', canvas.shareId, filename); // NEW
        await writeAtomic(recoveryPath, xml); // CHANGE
        const editorDataPath = editorDrafts.length ? recoveryPath + '.editors.json' : undefined; // NEW
        if (editorDataPath) await writeAtomic(editorDataPath, JSON.stringify({ schema: 1, diagramId: canvas.diagramId, at: now(), reason, editors: editorDrafts })); // NEW
        recoveryPaths.push({ filename, recoveryPath, reason, ...(editorDataPath ? { editorDataPath } : {}) }); // CHANGE
        await writeAtomic(path.join(profile, 'recovery', canvas.shareId, 'index.json'), JSON.stringify(recoveryPaths)); return recoveryPath; // NEW
    } // NEW
    let projectionRecoveryPath = null; const notifiedProjectionRecoveries = new Map(); // NEW: notify each live session once, including recoveries found by background materialization.
    async function materialize(state) { // NEW
        const started = performance.now(); // NEW
        if (canvas.localRemoved || canvas.projectRetired) return; // NEW: queued refreshes must never recreate a retired projection.
        await beforeMaterialize(state.xml); // NEW: naming runs inside the same queue as every projection write.
        if (canvas.localRemoved || canvas.projectRetired) return; // NEW
        const existing = await fs.readFile(canvas.diagramPath, 'utf8').catch(err => { if (err.code === 'ENOENT') return null; throw err; }); // NEW
        const markerPath = path.join(profile, 'recovery', canvas.shareId, 'projection.json'); // NEW
        const marker = await readJson(markerPath) /* CHANGE */.catch(err => { if (err.code === 'ENOENT') return null; throw err; }); // NEW
        if (existing && existing !== state.xml && digest(existing) !== (marker?.hash || state.snapshotHash)) projectionRecoveryPath = await preserve(existing, 'External or interrupted local changes were preserved before rebuilding the project.'); // CHANGE
        if (existing !== state.xml) await writeAtomic(canvas.diagramPath, state.xml); // NEW
        const hash = digest(state.xml); // CHANGE: unchanged polling must not rewrite the recovery marker.
        if (marker?.hash !== hash) await writeAtomic(markerPath, JSON.stringify({ hash })); // CHANGE
        timing({ phase: 'materialize', durationMs: performance.now() - started, wroteProjection: existing !== state.xml, bytes: Buffer.byteLength(state.xml) }); // NEW
        return { hash }; // CHANGE: this hash describes the verified journal projection.
    } // NEW
    function refresh() { // CHANGE
        if (pendingRefresh) return pendingRefresh; // NEW: do not enqueue identical background work repeatedly.
        const task = serialized(async () => { if (pendingRefresh === task) pendingRefresh = null; const previous = latest; const state = await read(); latest = previous; await materialize(state); latest = state; return publicState(state); }, 'refresh'); // CHANGE: an arrival during the active read can request one further refresh.
        pendingRefresh = task; task.finally(() => { if (pendingRefresh === task) pendingRefresh = null; }).catch(() => {}); return task; // NEW
    } // CHANGE
    function publicState(state, sessionId, forcePolicy = false) { // CHANGE
        if (policyXml !== state.xml) { // NEW: policy is live metadata, independent of the displayed object XML.
            const parsed = inspectDiagram(state.xml), roster = parsed.store.users || [], labels = new Map(); // CHANGE
            const pageIds = new Map(parsed.document.pages.map(page => [page.doc, page.container?.getAttribute('id') || ''])); // CHANGE
            for (const cell of parsed.cells) labels.set(JSON.stringify([pageIds.get(cell.node.ownerDocument), cell.id]), cell.node.getAttribute('label') || cell.node.getAttribute('value') || cell.id); // CHANGE
            const permission = permissionSnapshot(parsed); // NEW
            policySnapshot = { store: parsed.store, cells: Object.values(permission.cells), teams: Object.fromEntries(roster.map(user => [user.id, permissions.activeTeams(permission, user.id)])) }; // CHANGE: transmit complete plain policy facts independently of displayed content.
            policyHash = digest(canonical(policySnapshot)); policyXml = state.xml;
            presentation = { labels, names: new Map(roster.map(user => [user.id, user.name])), hash: digest(state.xml) }; // CHANGE
        }
        const identify = value => ({ ...value, name: presentation.names.get(value.userId) || 'Unknown user', requesters: value.requesters?.map(requester => ({ ...requester, name: presentation.names.get(requester.userId) || 'Unknown user' })), objectLabel: value.key === '*' ? 'project structure' : presentation.labels.get(value.key), objects: value.targets?.map(key => ({ key, label: presentation.labels.get(key) })) }); // CHANGE
        const policy = sessionId && (forcePolicy || policySent.get(sessionId) !== policyHash) ? policySnapshot : undefined; // CHANGE: reopening can reset renderer policy while the actor's journal session survives.
        if (policy) policySent.set(sessionId, policyHash); // NEW
        return { protocolVersion: COLLABORATION_VERSION, sessionId, hash: presentation.hash, policyHash, policy, holds: state.holds.map(identify), reservations: state.reservations.map(identify), presence: state.presence.map(identify), pending: state.pending.length, errors: state.errors, rejected: state.rejected, recoveries: recoveryPaths }; // CHANGE
    } // NEW
    /** A no-peer action still writes a signed durable proposal and succeeds locally. */ // NEW
    async function action(callerId, userId, input) { // NEW
        const actor = { callerId, userId, sessionId: sessionFor(callerId, userId) }; // NEW: capture ownership before entering the queue; a closing window cannot recreate its session.
        return serialized(async () => { // NEW
            if (canvas.revoked || canvas.pending) throw new Error('This computer is not approved to edit this project.'); // NEW
            const cachedRead = ['changes', 'review', 'ack-refresh', 'history-state'].includes(input.kind); // NEW: these read the latest verified state; refresh preparation and every edit re-read the journal.
            let state = cachedRead && latest ? latest : await read(input.retry === true), journalChanged = false, projection, stagedRecovery; const authorityContext = { at: now() }; // CHANGE: local checks use an explicit operation time.
            if (input.kind === 'checkpoint') { // NEW: main-process lifecycle callers checkpoint the same resident state used by production saves.
                await current.checkpoint(); state = await read(); // NEW
                return { ok: true, epoch: state.epoch, sequence: state.sequence, hash: state.headHash, collaboration: publicState(state, actor.sessionId) }; // NEW
            } // NEW
            if (input.kind === 'open-view' || input.kind === 'get') { // NEW: only this process owns the live local session registry.
                const active = new Set(sessions.values()), abandoned = new Map(); // NEW
                for (const hold of state.holds) if (hold.deviceId === deviceId && !active.has(hold.sessionId)) abandoned.set(hold.sessionId, hold); // NEW
                for (const hold of abandoned.values()) { await current.append(hold, 'release', {}); state = await read(); } // NEW
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
                projection = await materialize(state); // CHANGE
                if (projection && projectionRecoveryPath && notifiedProjectionRecoveries.get(actor.sessionId) !== projectionRecoveryPath) { projection.externalRecoveryPath = projectionRecoveryPath; notifiedProjectionRecoveries.set(actor.sessionId, projectionRecoveryPath); } // NEW: a background refresh may have preserved the external write before its watcher is serviced.
            } else if (input.kind === 'view') { // NEW
                const index = objects(state.xml); const targets = [...new Set((input.objects || []).filter(k => index.has(k)).map(k => logicalKey(index, k)))]; // NEW
                const previous = state.records.filter(r => r.sessionId === actor.sessionId && r.kind === 'view').sort((a, b) => b.clock - a.clock)[0]; // NEW
                if (!previous || JSON.stringify(previous.targets) !== JSON.stringify(targets) || now() - previous.at >= PRESENCE_MS / 2) { await current.append(actor, 'view', { targets }); journalChanged = true; } // CHANGE
            } else if (input.kind === 'request') { // NEW
                const holds = state.holds.filter(h => (input.targets || []).includes(h.key) && h.sessionId !== actor.sessionId); // NEW
                if (holds.some(h => authorityFor(state.xml, h.key, userId, authorityContext) < 1)) throw new Error('You cannot request editing access to this object.'); // CHANGE
                await current.append(actor, 'request', { claimIds: [...new Set(holds.map(h => h.claimId))] }); // NEW
                journalChanged = true; // CHANGE
            } else if (input.kind === 'release') { // NEW
                await current.append(actor, 'release', input.targets === undefined ? {} : { targets: input.targets }); // CHANGE: omitted fields must stay omitted after signing and JSON serialization.
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
                if (input.kind === 'save' && !input.resolution && input.baseXml !== state.xml) { // NEW
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
                    if (input.kind === 'claim' && delta.targets.some(k => !holds.some(h => h.key === k))) { // CHANGE: saves acquire transient holds atomically with their accepted content.
                        await current.append(actor, 'claim', { targets: delta.targets, holdPolicy: 'request', ...(accountSetup ? { usersPolicyAction: true, policyChanges: delta.changes } : {}) }); state = await read(); // CHANGE
                        holds = state.holds.filter(h => delta.targets.includes(h.key) && h.sessionId === actor.sessionId); // NEW
                        if (delta.targets.some(key => !holds.some(h => h.key === key))) { // NEW
                            const reason = 'A concurrent editing claim has priority. Your entire action was preserved locally.'; // NEW
                            const recoveryPath = await preserve(input.xml || state.xml, reason); // NEW
                            return { ok: false, reason, recoveryPath, xml: state.xml, collaboration: publicState(state, actor.sessionId) }; // NEW
                        } // NEW
                    } else if (input.kind === 'claim') { await current.append(actor, 'activity', { targets: delta.targets, claimIds: [...new Set(holds.map(h => h.claimId))] }); journalChanged = true; } // CHANGE: activity renews a hold without publishing private form fields.
                    if (input.kind === 'save') { // NEW
                        const id = makeId(); // NEW
                        stagedRecovery = await preserve(input.xml, 'Submitted work retained until acceptance and local save completion.'); // CHANGE: index the exact pending proposal so interrupted acceptance remains recoverable.
                        const edit = await current.append(actor, 'save', { id, targets: delta.targets, changes: delta.changes, ...(accountSetup ? { usersPolicyAction: true } : {}) }); // CHANGE
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
            if (stagedRecovery) { // NEW: remove only this successful proposal's staging copy; retained older recovery data is untouched.
                const retained = recoveryPaths.filter(item => item.recoveryPath !== stagedRecovery); // NEW
                await writeAtomic(path.join(profile, 'recovery', canvas.shareId, 'index.json'), JSON.stringify(retained)); // NEW
                recoveryPaths = retained; await fs.unlink(stagedRecovery); // NEW
            } // NEW
            return { ok: true, projection, resolution: input.resolution, xml: input.explicitRefresh ? undefined : state.xml, objectViews: 1, collaboration: publicState(state, actor.sessionId) }; // CHANGE: status and save replies never carry incoming canvas content in explicit mode.
        }); // NEW
    } // NEW
    /** Remove ownership immediately, then release the captured generation without touching a replacement session. */ // NEW
    function forget(callerId) { // NEW
        views.forget(callerId); // NEW
        for (const key of checkpointRetries.keys()) if (JSON.parse(key)[0] === callerId) checkpointRetries.delete(key); // NEW: a reopened window must not replay a previous window's outstanding private write.
        for (const [key, sessionId] of [...sessions]) if (key.startsWith(callerId + ':')) { // NEW
            const actor = { userId: key.slice(String(callerId).length + 1), sessionId }; sessions.delete(key); policySent.delete(sessionId); notifiedProjectionRecoveries.delete(sessionId); // NEW
            serialized(async () => { const state = await read(); await current.append(actor, 'release', {}); }).catch(() => {}); // NEW
        } // NEW
    } // NEW
    return { initialize, refresh, action, read, checkpoint: () => serialized(current.checkpoint, 'checkpoint'), sessionFor, peek: () => latest, snapshot: () => serialized(read), runExclusive: serialized, saveRecovery: (xml, editorDrafts = []) => serialized(async () => { await read(); const recoveryPath = await preserve(xml, 'Manually saved recovery copy.', editorDrafts); return { recoveryPath, filename: path.basename(recoveryPath), editorDataPath: recoveryPaths.at(-1).editorDataPath }; }), flush: () => queue, forget }; // CHANGE
} // NEW
