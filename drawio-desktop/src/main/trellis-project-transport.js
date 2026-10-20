/** Managed project retirement and authenticated departure over the existing shared folder. */ // NEW
import fs from 'node:fs/promises'; // NEW
import path from 'node:path'; // NEW
import { atomicJson, readOptional, moveRetained } from './trellis-project-trash.js'; // NEW
import { inspectDiagram, activeAdmin, hasCanvasAccess, safeId, signRecord, verifyRecord, digest, makeId } from './trellis-share-protocol.js'; // NEW

export const PROJECT_LIFECYCLE_VERSION = 1; // NEW
export function createProjectTransport(context) { // NEW
    const { initialize, start, api, persist, configureCanvas, publishMembership, writeImmutable, writeAtomic, collaborationStore, detach, profile, now, emit } = context; // NEW
    const localId = () => context.deviceId(); // NEW
    const keys = () => context.keys(); // NEW
    const known = shareId => context.registry().find(c => c.shareId === shareId); // NEW
    const area = canvas => path.join(canvas.folderPath, '.trellis', 'project-lifecycle'); // NEW
    const retained = canvas => path.join(profile, 'project-trash', safeId(canvas.shareId)); // NEW
    const activeUsers = state => (state.store.users || []).filter(u => !u.disabled && hasCanvasAccess(state, u.id, now())); // NEW
    function linked(state, userId, identityId) { // NEW
        const user = activeUsers(state).find(u => u.id === userId); // NEW
        if (!user || identityId && user.portableIdentityId !== identityId) throw new Error('This identity is not linked to an active project member.'); // NEW
        return user; // NEW
    } // NEW
    async function readState(canvas, filename = canvas.diagramPath) { // NEW
        if (canvas.protocolVersion === 2 && filename === canvas.diagramPath && !canvas.localRemoved) await collaborationStore(canvas).refresh(); // NEW
        const xml = await fs.readFile(filename, 'utf8'); return { ...inspectDiagram(xml), baseXml: xml }; // CHANGE
    } // NEW
    async function saveRoster(canvas, state, actorId) { // NEW
        const baseXml = await fs.readFile(canvas.diagramPath, 'utf8'); // NEW
        if (state.baseXml !== baseXml) throw new Error('The project changed while its access update was being prepared. Its files were preserved; retry after synchronization.'); // NEW
        for (const cell of state.cells) if (cell.node.hasAttribute('trellis_users_json')) cell.node.setAttribute('trellis_users_json', JSON.stringify(state.store)); // NEW
        const xml = state.document.serialize(); // NEW
        if (canvas.protocolVersion === 2) { // NEW
            const result = await collaborationStore(canvas).action('project-lifecycle', actorId, { kind: 'save', baseXml, xml, usersPolicyAction: true }); // NEW
            if (!result.ok) throw new Error(result.reason || 'Project access changes are waiting for another edit.'); // NEW
            await collaborationStore(canvas).action('project-lifecycle', actorId, { kind: 'release' }); // CHANGE: release the actual metadata holds, including object-specific targets.
        } else await writeAtomic(canvas.diagramPath, xml); // NEW
    } // NEW
    async function capability(canvas, member, fresh = true) { // CHANGE
        const record = await readOptional(path.join(area(canvas), 'capabilities', safeId(member.deviceId) + '.json')); // NEW
        const p = record?.payload; // NEW
        return !!p && p.version === PROJECT_LIFECYCLE_VERSION && p.shareId === canvas.shareId && p.diagramId === canvas.diagramId && p.deviceId === member.deviceId && (!fresh || Math.abs(now() - p.at) < 30000) && verifyRecord(record, member.publicKey); // CHANGE
    } // NEW
    async function projectActions(input) { // NEW
        await initialize(); const canvas = known(input.shareId); // NEW
        if (!canvas || canvas.localRemoved || !await fs.stat(canvas.diagramPath).then(s => s.isFile()).catch(() => false)) return { available: false, canDelete: false, canLeave: false, successors: [] }; // NEW
        const state = await readState(canvas), user = linked(state, input.userId, input.identityId), users = activeUsers(state); // NEW
        if (users.length === 1) return { available: true, canDelete: !!user.admin, canLeave: false, successors: [], pendingInvitationCount: (state.store.invites || []).filter(i => i.status === 'pending').length }; // NEW
        let connections; // NEW
        try { await start(); connections = (await api('system/connections')).connections; if (!connections) throw new Error('No connection telemetry.'); } // NEW
        catch (_) { return { available: true, canDelete: false, canLeave: false, successors: [], reason: 'Connect to another project member before leaving.' }; } // NEW
        const successors = []; // NEW
        for (const candidate of users.filter(u => u.id !== user.id)) { // NEW
            const devices = []; // NEW
            for (const member of canvas.members.filter(m => m.userId === candidate.id && connections[m.deviceId]?.connected)) if (await capability(canvas, member)) devices.push(member.deviceId); // NEW
            if (devices.length) successors.push({ id: candidate.id, name: candidate.name || candidate.id, admin: !!candidate.admin, deviceIds: devices }); // NEW
        } // NEW
        const coordinator = canvas.members.find(m => m.deviceId === canvas.coordinatorDeviceId); // NEW
        const coordinatorAvailable = canvas.coordinatorDeviceId === localId() || coordinator && connections[coordinator.deviceId]?.connected && await capability(canvas, coordinator); // NEW
        const requiresSuccessor = !!user.admin && !users.some(u => u.id !== user.id && u.admin); // NEW
        const requiresCoordinator = canvas.members.some(m => m.deviceId === canvas.coordinatorDeviceId && m.userId === user.id); // NEW
        const eligible = requiresSuccessor ? successors : requiresCoordinator ? successors.filter(u => u.admin) : successors; // NEW
        let compatible = true; // NEW
        if (requiresCoordinator) for (const remaining of canvas.members.filter(m => m.userId !== user.id)) if (!await capability(canvas, remaining, false)) compatible = false; // NEW
        return { available: true, canDelete: false, canLeave: !!coordinatorAvailable && eligible.length > 0 && compatible, requiresSuccessor, requiresCoordinator, successors: eligible, reason: !compatible ? 'All remaining devices must update Trellis and connect once before coordination can be transferred.' : !coordinatorAvailable ? 'The project coordinator must be connected and support project departure.' : !eligible.length ? 'No eligible member is connected with a compatible version of Trellis.' : '' }; // CHANGE
    } // NEW
    /** Retain before purge, including when an offline device first receives a purge marker. */ // NEW
    async function applyProjectLifecycle(input) { // NEW
        await initialize(); const canvas = known(input.shareId); // NEW
        if (!canvas) return { ok: true, reason: input.operation === 'trashed' ? 'Files unavailable on this device. Invitation cancellation will apply when a project copy is reachable.' : '' }; // NEW
        context.validateManaged(canvas); // NEW
        const target = retained(canvas), receiptPath = path.join(profile, 'project-trash-journals', safeId(input.recordId) + '.json'); // NEW
        if (canvas.retirementComplete === input.operation && input.operation === 'trashed') return { ok: true, reason: canvas.retirementReason || '' }; // NEW
        if (input.operation === 'active') { // NEW
            if (!canvas.projectRetired || canvas.projectRetired === 'left' || canvas.projectRetired === 'purged') return { ok: true }; // NEW
            if (await fs.stat(target).then(() => true).catch(() => false)) await moveRetained(target, canvas.folderPath, receiptPath); // NEW
            canvas.projectRetired = null; canvas.projectFenced = false; canvas.retirementComplete = null; canvas.localRemoved = !await fs.stat(canvas.diagramPath).then(s => s.isFile()).catch(() => false); canvas.paused = false; // NEW
            await persist(); if (context.runtimeReady() && !canvas.localRemoved) await configureCanvas(canvas); emit(); return { ok: true }; // NEW
        } // NEW
        if (canvas.retirementComplete === input.operation && ['purged', 'left'].includes(input.operation)) return { ok: true }; // NEW
        const filename = canvas.localRemoved ? path.join(target, canvas.filename) : canvas.diagramPath; // NEW
        const present = await fs.stat(filename).then(s => s.isFile()).catch(() => false); // NEW
        if (input.operation !== 'left' && present) { // NEW
            const state = await readState(canvas, filename), user = linked(state, input.userId, input.identityId); // NEW
            if (!user.admin || activeUsers(state).some(u => u.id !== user.id)) throw new Error('Membership changed: other users have access. Restore this project and use Leave project. Files were preserved.'); // NEW
            const pending = (state.store.invites || []).filter(i => i.status === 'pending'); // NEW
            if (pending.length) { // NEW
                for (const invite of pending) invite.status = 'revoked'; // NEW
                if (canvas.localRemoved) { // NEW
                    for (const cell of state.cells) if (cell.node.hasAttribute('trellis_users_json')) cell.node.setAttribute('trellis_users_json', JSON.stringify(state.store)); // NEW
                    await writeAtomic(filename, state.document.serialize()); // NEW
                } else await saveRoster(canvas, state, user.id); // NEW
            } // NEW
        } // NEW
        if (input.operation === 'left' && present) { // NEW
            const state = await readState(canvas, filename), setups = await fs.readdir(path.join(canvas.folderPath, '.trellis', 'device-setups')).catch(error => { if (error.code === 'ENOENT') return []; throw error; }); // CHANGE
            canvas.retiredInviteIds = [...(state.store.invites || []).map(i => i.id), ...setups.map(name => name.replace(/\.json$/, ''))]; // NEW
        } // NEW
        const retire = async () => { // NEW: drain projection writes before moving the managed directory.
            canvas.localRemoved = true; canvas.projectRetired = input.operation; await persist(); // NEW
            await detach(canvas); // NEW
            if (input.operation === 'left') { // NEW
                await fs.rm(canvas.folderPath, { recursive: true, force: true }); await fs.rm(target, { recursive: true, force: true }); // NEW
            } else { // NEW
                if (await fs.stat(canvas.folderPath).then(() => true).catch(() => false)) await moveRetained(canvas.folderPath, target, receiptPath); // NEW
                if (input.operation === 'purged') await fs.rm(target, { recursive: true, force: true }); // NEW
            } // NEW
            canvas.retirementComplete = input.operation; canvas.retirementReason = !present && input.operation === 'trashed' ? 'Files unavailable on this device. Waiting for a paired device with a retained copy.' : ''; await persist(); // NEW
            emit(); return { ok: true, reason: canvas.retirementReason }; // NEW
        }; // NEW
        return canvas.protocolVersion === 2 ? collaborationStore(canvas).runExclusive(retire) : retire(); // NEW
    } // NEW
    function signedFor(record, canvas, type) { // NEW
        const p = record?.payload, member = canvas.members.find(m => m.deviceId === p?.deviceId); // NEW
        return p?.type === type && p.shareId === canvas.shareId && p.diagramId === canvas.diagramId && member && verifyRecord(record, member.publicKey) ? member : null; // NEW
    } // NEW
    async function leaveProject(input) { // NEW
        await initialize(); const canvas = known(input.shareId); // NEW
        if (!canvas) throw new Error('Download this project before leaving.'); // NEW
        if (canvas.departureRequestId) { // NEW
            const request = await readOptional(path.join(area(canvas), 'departures', canvas.departureRequestId + '.json')); // NEW
            if (request?.payload.userId !== input.userId || request.payload.identityId !== input.identityId) throw new Error('A different departure is already pending.'); // NEW
            const receipt = await readOptional(path.join(area(canvas), 'committed', canvas.departureRequestId + '.json')); // NEW
            const signer = receipt?.payload.deviceId === canvas.coordinatorDeviceId && canvas.coordinatorPublicKey; // NEW
            if (signer && receipt.payload.type === 'departure-committed' && receipt.payload.requestId === canvas.departureRequestId && receipt.payload.shareId === canvas.shareId && receipt.payload.diagramId === canvas.diagramId && receipt.payload.membershipVersion > request.payload.membershipVersion && !canvas.members.some(m => m.userId === input.userId) && verifyRecord(receipt, signer)) { // CHANGE
                const receivedPath = path.join(area(canvas), 'received', canvas.departureRequestId + '.json'); // NEW
                if (!await readOptional(receivedPath)) await writeImmutable(receivedPath, signRecord({ type: 'departure-received', shareId: canvas.shareId, diagramId: canvas.diagramId, requestId: canvas.departureRequestId, deviceId: localId() }, keys().privateKey)); // NEW
                const final = await readOptional(path.join(area(canvas), 'finalized', canvas.departureRequestId + '.json')); // NEW
                if (final?.payload.type === 'departure-finalized' && final.payload.requestId === canvas.departureRequestId && final.payload.shareId === canvas.shareId && final.payload.diagramId === canvas.diagramId && verifyRecord(final, signer)) return { ok: true, complete: true, receipt: final }; // NEW
            } // NEW
            const rejected = await readOptional(path.join(area(canvas), 'rejected', canvas.departureRequestId + '.json')); // NEW
            if (rejected?.payload.requestId === canvas.departureRequestId && rejected.payload.shareId === canvas.shareId && verifyRecord(rejected, canvas.coordinatorPublicKey)) { canvas.departureRequestId = null; await persist(); return { ok: false, complete: false, rejected: true, reason: rejected.payload.reason }; } // NEW
            return { ok: true, complete: false, reason: 'Leaving… Keep Trellis running until the connected member acknowledges departure.' }; // NEW
        } // NEW
        const eligibility = await projectActions(input); // NEW
        if (!eligibility.canLeave) throw new Error(eligibility.reason || 'You are the sole active user. Delete this project instead.'); // NEW
        const selected = eligibility.successors.find(u => u.id === input.successorUserId); // NEW
        if ((eligibility.requiresSuccessor || eligibility.requiresCoordinator) && !selected) throw new Error('Choose a connected successor before leaving.'); // NEW
        const witness = selected || eligibility.successors[0], id = makeId(); // NEW
        const request = signRecord({ type: 'departure', version: PROJECT_LIFECYCLE_VERSION, id, shareId: canvas.shareId, diagramId: canvas.diagramId, membershipVersion: canvas.membershipVersion, deviceId: localId(), userId: input.userId, identityId: input.identityId, successorUserId: selected?.id || null, witnessDeviceId: witness.deviceIds[0], at: now() }, keys().privateKey); // NEW
        await writeImmutable(path.join(area(canvas), 'departures', id + '.json'), request); // NEW
        canvas.departureRequestId = id; await persist(); emit(); // NEW
        return { ok: true, complete: false, reason: 'Leaving… Waiting for the connected member to acknowledge.' }; // NEW
    } // NEW
    /** Rate-limit presence writes so native filesystem watchers can transmit stable files. */ // NEW
    async function publishCapability(canvas) { // NEW
        const member = canvas.members.find(m => m.deviceId === localId()); // NEW
        if (member) { // CHANGE: leave time for the filesystem watcher to transmit a stable heartbeat.
            const filename = path.join(area(canvas), 'capabilities', safeId(localId()) + '.json'), previous = await readOptional(filename); // NEW
            if (!previous || now() - previous.payload.at >= 10000) await atomicJson(filename, signRecord({ version: PROJECT_LIFECYCLE_VERSION, shareId: canvas.shareId, diagramId: canvas.diagramId, deviceId: localId(), at: now() }, keys().privateKey)); // NEW
        } // NEW
    } // NEW
    /** Applied policy, receipt delivery, and finalization are distinct durable stages. */ // NEW
    async function advanceReceipt(canvas, request, commitment, name) { // NEW
        const r = request.payload; // NEW
        const state = await readState(canvas); // NEW
        if (activeUsers(state).some(u => u.id === commitment.userId) || !activeUsers(state).some(u => u.admin)) return; // NEW
        const proof = { type: 'departure-applied', requestId: r.id, shareId: canvas.shareId, diagramId: canvas.diagramId, deviceId: localId(), membershipVersion: commitment.membershipVersion, at: now() }; // NEW
        const appliedPath = path.join(area(canvas), 'applied', name); // NEW
        if (localId() === commitment.witnessDeviceId && !await readOptional(appliedPath)) await writeImmutable(appliedPath, signRecord(proof, keys().privateKey)); // CHANGE
        if (canvas.coordinatorDeviceId === localId()) { // NEW
            const applied = await readOptional(path.join(area(canvas), 'applied', name)); // NEW
            if (!signedFor(applied, canvas, 'departure-applied') || applied.payload.deviceId !== commitment.witnessDeviceId || applied.payload.requestId !== r.id || applied.payload.membershipVersion !== commitment.membershipVersion) return; // NEW
            const receiptPath = path.join(area(canvas), 'committed', name); // NEW
            if (!await readOptional(receiptPath)) await writeImmutable(receiptPath, signRecord({ ...proof, type: 'departure-committed' }, keys().privateKey)); // NEW
            const received = await readOptional(path.join(area(canvas), 'received', name)); // NEW
            const retired = (canvas.retiredMembers || []).find(m => m.deviceId === commitment.deviceId); // NEW
            if (received?.payload.type === 'departure-received' && received.payload.requestId === r.id && received.payload.shareId === canvas.shareId && received.payload.diagramId === canvas.diagramId && received.payload.deviceId === commitment.deviceId && retired && verifyRecord(received, retired.publicKey)) { // NEW
                const finalPath = path.join(area(canvas), 'finalized', name); // NEW
                if (!await readOptional(finalPath)) await writeImmutable(finalPath, signRecord({ ...proof, type: 'departure-finalized' }, keys().privateKey)); // NEW
                if (!commitment.deliveryComplete) { // NEW
                    await api('db/scan?folder=' + encodeURIComponent(canvas.folderId), 'POST'); // NEW
                    const completion = await api('db/completion?folder=' + encodeURIComponent(canvas.folderId) + '&device=' + encodeURIComponent(commitment.deviceId)); // NEW
                    if (completion.remoteState === 'notSharing' || completion.remoteState === 'valid' && completion.completion === 100 && completion.needItems === 0) { commitment.deliveryComplete = true; await persist(); await configureCanvas(canvas); } // NEW
                } // NEW
            } // NEW
        } // NEW
    } // NEW
    /** Revalidate the signed request before promoting, disabling, or changing membership. */ // NEW
    async function advanceDeparture(canvas, request, name) { // NEW
        const r = request.payload; // NEW
        const author = signedFor(request, canvas, 'departure'); // NEW
        if (!author || author.userId !== r.userId) return false; // NEW
        if (r.membershipVersion !== canvas.membershipVersion) { // NEW
            if (canvas.coordinatorDeviceId === localId()) await writeImmutable(path.join(area(canvas), 'rejected', name), signRecord({ type: 'departure-rejected', requestId: r.id, shareId: canvas.shareId, diagramId: canvas.diagramId, reason: 'Membership changed. Choose a connected successor and try leaving again.' }, keys().privateKey)); // NEW
            return false; // NEW
        } // NEW
        const state = await readState(canvas), resuming = canvas.pendingDeparture === r.id && canvas.coordinatorDeviceId === localId(); // NEW
        if (!resuming) linked(state, r.userId, r.identityId); // NEW
        const users = activeUsers(state), remaining = users.filter(u => u.id !== r.userId); // NEW
        if (!remaining.length) return false; // NEW
        const successor = remaining.find(u => u.id === r.successorUserId); // NEW
        const requiresSuccessor = !remaining.some(u => u.admin), transfer = canvas.members.some(m => m.deviceId === canvas.coordinatorDeviceId && m.userId === r.userId); // NEW
        const witness = canvas.members.find(m => m.deviceId === r.witnessDeviceId && remaining.some(u => u.id === m.userId)); // NEW
        if (!witness || requiresSuccessor && !successor || transfer && (!successor || !successor.admin && !requiresSuccessor) || successor && successor.id !== witness.userId) return false; // NEW
        if (transfer && (await Promise.all(canvas.members.filter(m => m.userId !== r.userId).map(m => capability(canvas, m, false)))).some(supported => !supported)) return false; // NEW
        if (localId() === witness.deviceId) { // NEW
            const db = await api('db/status?folder=' + encodeURIComponent(canvas.folderId)); // NEW
            if (db.needTotalItems !== 0 || (await context.conflictFiles(canvas)).length) return false; // NEW
            const filename = path.join(area(canvas), 'ready', name), previous = await readOptional(filename), snapshotHash = digest(state.document.serialize()); // NEW
            if (!previous || previous.payload.snapshotHash !== snapshotHash || now() - previous.payload.at >= 10000) await atomicJson(filename, signRecord({ type: 'departure-ready', requestId: r.id, shareId: canvas.shareId, diagramId: canvas.diagramId, deviceId: localId(), membershipVersion: canvas.membershipVersion, snapshotHash, at: now() }, keys().privateKey)); // CHANGE
        } // NEW
        if (canvas.coordinatorDeviceId !== localId()) return false; // NEW
        const ready = await readOptional(path.join(area(canvas), 'ready', name)), connections = (await api('system/connections')).connections || {}; // NEW
        if (!signedFor(ready, canvas, 'departure-ready') || ready.payload.deviceId !== witness.deviceId || ready.payload.requestId !== r.id || ready.payload.membershipVersion !== canvas.membershipVersion || !resuming && ready.payload.snapshotHash !== digest(state.document.serialize()) || Math.abs(now() - ready.payload.at) >= 30000 || witness.deviceId !== localId() && !connections[witness.deviceId]?.connected || !await capability(canvas, witness)) return false; // CHANGE
        if ((await context.conflictFiles(canvas)).length) return false; // NEW
        const coordinatorUser = canvas.members.find(m => m.deviceId === localId())?.userId; // NEW
        if (!activeAdmin(state, coordinatorUser) && !resuming) return false; // NEW
        canvas.pendingDeparture = r.id; await persist(); // NEW
        if (successor && requiresSuccessor) successor.admin = true; // NEW
        const departed = state.store.users.find(u => u.id === r.userId), alreadyDisabled = departed.disabled; departed.disabled = true; // NEW
        for (const invite of state.store.invites || []) if (invite.status === 'pending' && (invite.createdBy === r.userId || invite.pendingUserId === r.userId)) invite.status = 'revoked'; // NEW
        if (!alreadyDisabled) await saveRoster(canvas, state, coordinatorUser); // NEW
        const nextCoordinator = transfer ? { deviceId: witness.deviceId, publicKey: witness.publicKey } : null; // NEW
        await publishMembership(canvas, canvas.members.filter(m => m.userId !== r.userId), { nextCoordinator, departure: { requestId: r.id, userId: r.userId, deviceId: r.deviceId, witnessDeviceId: witness.deviceId } }); // NEW
        await configureCanvas(canvas); emit(); return true; // NEW
    } // NEW
    /** Orchestrate independent stages without abandoning an interrupted departure. */ // NEW
    async function refresh(canvas) { // NEW
        if (canvas.localRemoved || canvas.revoked || canvas.pending) return; // NEW
        await publishCapability(canvas); // NEW
        if (canvas.departureRequestId) { // NEW
            const ownRequest = await readOptional(path.join(area(canvas), 'departures', canvas.departureRequestId + '.json')); // NEW
            if (ownRequest) await leaveProject({ shareId: canvas.shareId, userId: ownRequest.payload.userId, identityId: ownRequest.payload.identityId }); // NEW
        } // NEW
        const names = await fs.readdir(path.join(area(canvas), 'departures')).catch(error => { if (error.code === 'ENOENT') return []; throw error; }); // NEW
        for (const name of names.filter(n => /^[A-Za-z0-9_-]+\.json$/.test(n)).sort()) { // NEW
            const request = await readOptional(path.join(area(canvas), 'departures', name)), r = request?.payload; // NEW
            if (!r || r.id + '.json' !== name || r.version !== PROJECT_LIFECYCLE_VERSION) continue; // NEW
            const commitment = (canvas.departureCommits || []).find(c => c.requestId === r.id); // NEW
            if (commitment) await advanceReceipt(canvas, request, commitment, name); // NEW
            else if (await advanceDeparture(canvas, request, name)) break; // NEW
        } // NEW
    } // NEW
    async function fenceProject(input) { await initialize(); const canvas = known(input.shareId); if (canvas && !canvas.projectFenced) { canvas.projectFenced = true; await persist(); } } // NEW
    return { projectActions, applyProjectLifecycle, leaveProject, refresh, fenceProject }; // NEW
} // NEW
