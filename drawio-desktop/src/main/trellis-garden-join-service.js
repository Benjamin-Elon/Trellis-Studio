import { parseJson, listBounded, readJson as readBoundedJson, readBounded, LIMITS } from './trellis-input-policy.js'; // NEW
/** Device-local joining journal; transport approval and Users remain the access authorities. */ // NEW
import fs from 'node:fs/promises'; // NEW
import path from 'node:path'; // NEW
import crypto from 'node:crypto'; // NEW
import { decodeBlock, encodeBlock, inspectDiagram, hasCanvasAccess, safeId } from './trellis-share-protocol.js'; // CHANGE

/** Extract exactly one invitation, including normal quoted plain-text email formatting. */ // NEW
export function parseGardenInvitation(text, now = Date.now(), allowExpired = false) { // CHANGE
    if (typeof text !== 'string' || text.length > 65536) throw new Error('Paste one complete invitation email (up to 64 KB).'); // NEW
    const clean = text.replace(/^\s*(?:>\s*)+/gm, ''), marker = '-----BEGIN TRELLIS INVITE-----'; // NEW
    if (clean.split(marker).length !== 2) throw new Error('Paste exactly one complete Trellis invitation. Remove older invitations from the email thread.'); // NEW
    let invite; try { invite = decodeBlock('INVITE', clean); } catch (error) { if (error.code === 'INVALID_JSON' || error instanceof SyntaxError) throw new Error('The invitation is damaged. Copy the complete invitation again or ask the sender for a new one.'); throw error; } // CHANGE
    safeId(invite.inviteId); safeId(invite.pendingUserId); // NEW
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(invite.email || '') || (!invite.code && !invite.deviceSetup)) throw new Error('The invitation is incomplete. Ask the sender for a new invitation.'); // NEW
    if (!Number.isFinite(invite.expiresAt) || !allowExpired && invite.expiresAt <= now) throw new Error('This invitation has expired. Ask the sender for a new invitation.'); // CHANGE
    if (invite.folderId !== 'trellis-v3-' + invite.shareId || !invite.coordinatorPublicKey || path.basename(invite.filename || '') !== invite.filename || !/\.drawio$/i.test(invite.filename)) throw new Error('The invitation contains invalid project details.'); // NEW
    return invite; // NEW
} // NEW

/** All writes are serialized; every asynchronous boundary rechecks the captured login. */ // NEW
export function createGardenJoinService({ identities, library, protect, unprotect, validateWatchedPath = async () => {} }) { // NEW
    const temporary = new Map(); let queue = Promise.resolve(); // NEW
    const idFor = invite => crypto.createHash('sha256').update(invite.shareId + ':' + invite.inviteId).digest('hex'); // NEW
    const directory = session => path.join(identities.identityRoot(session.identityId), 'local-joins'); // NEW
    function capture(input = {}) { // NEW
        const session = identities.session(); // NEW
        if (!session || input.identityId && input.identityId !== session.identityId || input.generation !== undefined && input.generation !== session.generation) throw new Error('Your identity changed. Reopen the invitation using the intended identity.'); // NEW
        return { ...session }; // NEW
    } // NEW
    function check(session) { const current = identities.session(); if (!current || current.identityId !== session.identityId || current.generation !== session.generation) throw new Error('Your identity changed. Reopen the invitation.'); } // NEW
    function serialized(action) { const result = queue.then(action); queue = result.catch(() => {}); return result; } // NEW
    async function save(session, record) { // NEW
        check(session); const folder = directory(session); await fs.mkdir(folder, { recursive: true }); check(session); // NEW
        const filename = path.join(folder, record.id + '.json'), next = filename + '.tmp'; // NEW
        await fs.writeFile(next, JSON.stringify(record), { mode: 0o600, flush: true }); check(session); await fs.rename(next, filename); check(session); // CHANGE
    } // NEW
    async function load(session, id) { // NEW
        if (!/^[a-f0-9]{64}$/.test(id || '')) throw new Error('Invalid invitation request.'); // NEW
        const record = await readBoundedJson(path.join(directory(session), id + '.json')) /* CHANGE: bound received JSON before parsing. */; check(session); // NEW
        if (record.id !== id || record.identityId !== session.identityId) throw new Error('This invitation belongs to another identity.'); // NEW
        return record; // NEW
    } // NEW
    async function secrets(session, record) { // NEW
        check(session); const saved = temporary.get(session.identityId + ':' + record.id); // NEW
        if (saved) return saved; // NEW
        if (!record.secrets) throw new Error('Paste this invitation again to resume. Credential protection was unavailable when joining.'); // NEW
        let result; try { result = parseJson(await unprotect(record.secrets)); } catch (_) { throw new Error('This computer could not unlock the invitation. Paste it again to resume.'); } // NEW
        check(session); return result; // NEW
    } // NEW
    function summary(invite) { return { shareId: invite.shareId, diagramId: invite.diagramId, label: String(invite.label || 'Garden project'), email: invite.email, expiresAt: invite.expiresAt, deviceSetup: !!invite.deviceSetup, senderEmail: String(invite.senderEmail || '') }; } // NEW
    async function preview(input) { // NEW
        const invite = parseGardenInvitation(input.text, Date.now(), true); // NEW
        if (invite.expiresAt <= Date.now()) { // NEW
            if (identities.session()) { // NEW
                const session = capture(input); let record; try { record = await load(session, idFor(invite)); } catch (error) { if (error.code !== 'ENOENT') throw error; } // NEW
                if (record) { const current = await status(session, record, await transport(session)); if (['ready', 'complete'].includes(current.state)) return { ...summary(invite), alreadyJoined: true }; } // NEW
            } // NEW
            throw new Error('This invitation has expired. Ask the sender for a new invitation.'); // NEW
        } // NEW
        return summary(invite); // NEW
    } // NEW
    async function transport(session) { const service = await identities.transport(session.identityId); check(session); return service; } // NEW
    /** Readiness verifies the approved registration and the downloaded diagram, not just its existence. */ // NEW
    async function status(session, record, service) { // NEW
        check(session); const result = { id: record.id, ...record.project, displayName: record.displayName, senderEmail: record.senderEmail, warning: record.warning || '', state: 'waiting', reason: '' }; // NEW
        const canvas = (await service.listCanvases()).find(row => row.shareId === record.project.shareId); check(session); // NEW
        const observed = service.listStatus().find(row => row.shareId === record.project.shareId); // NEW
        if (canvas?.joinInviteId && canvas.joinInviteId !== record.inviteId) return { ...result, state: 'revoked', reason: 'A newer invitation replaced this request. Resume the newer invitation.' }; // NEW
        if (canvas?.revoked || canvas?.retired || canvas?.fenced || observed?.state === 'revoked') return { ...result, state: 'revoked', reason: 'Access was removed. Ask the sender for a fresh invitation.' }; // CHANGE
        if (record.project.expiresAt <= Date.now()) { // NEW
            let accepted = false; if (canvas?.available && !canvas.pending) { try { const state = inspectDiagram(await readBounded(canvas.path, LIMITS.diagram) /* CHANGE */); accepted = state.store.users?.some(user => user.id === record.userId && user.portableIdentityId === session.identityId && !user.disabled); } catch (_) {} check(session); } // NEW
            if (!accepted) return { ...result, state: 'expired', reason: 'This invitation has expired. Ask the sender for a new invitation.' }; // NEW
        } // NEW
        if (!canvas || canvas.pending) return { ...result, reason: observed?.reason || '', connection: observed?.state }; // NEW
        if (!canvas.available) return { ...result, state: 'downloading', reason: observed?.reason || canvas.reason || '', connection: observed?.state }; // NEW
        try { // NEW
            const state = inspectDiagram(await readBounded(canvas.path, LIMITS.diagram) /* CHANGE */); check(session); // NEW
            const matches = state.cells.some(cell => cell.node.getAttribute('trellis_users_diagram_id') === record.project.diagramId || cell.node.getAttribute('trellis_history_id') === record.project.diagramId); // NEW
            if (!matches) throw new Error('The downloaded project does not match the invitation.'); // NEW
            const user = state.store.users?.find(user => user.id === record.userId), invitation = state.store.invites?.find(invite => invite.id === record.inviteId && invite.pendingUserId === record.userId); // NEW
            if (user?.disabled || !record.project.deviceSetup && !user && invitation?.status !== 'pending') return { ...result, state: 'revoked', reason: 'The invitation or project account was removed. Ask the sender for a fresh invitation.' }; // NEW
            if (record.completed && (!user || user.portableIdentityId !== session.identityId || !hasCanvasAccess(state, user.id))) return { ...result, state: 'revoked', reason: 'This identity no longer has access to the invited project.' }; // CHANGE
            return { ...result, state: record.completed ? 'complete' : 'ready', path: canvas.path }; // CHANGE
        } catch (error) { check(session); return { ...result, state: 'downloading', reason: error.message }; } // NEW
    } // NEW
    async function start(input) { // NEW
        const session = capture(input); await identities.requireSession(); check(session); // NEW
        const invite = parseGardenInvitation(input.text, Date.now(), true), id = idFor(invite), service = await transport(session); // CHANGE
        let record; try { record = await load(session, id); } catch (error) { if (error.code !== 'ENOENT' && error.code !== 'INVALID_JSON' && !(error instanceof SyntaxError)) throw error; } // CHANGE: repasting repairs a corrupt local journal without replacing transport registration.
        if (record?.completed) return status(session, record, service); // NEW
        if (invite.expiresAt <= Date.now()) { // NEW
            if (record) { const current = await status(session, record, service); if (current.state === 'ready') return resumeWith(session, record, service); } // NEW
            throw new Error('This invitation has expired. Ask the sender for a new invitation.'); // NEW
        } // NEW
        const senderEmail = String(input.senderEmail || invite.senderEmail || '').trim(), displayName = String(input.displayName || session.username).trim(); // NEW
        if (!displayName || displayName.length > 160) throw new Error('Enter a display name of up to 160 characters.'); // NEW
        if (senderEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(senderEmail)) throw new Error('Enter a valid sender email, or leave it blank and copy the approval reply.'); // NEW
        const secret = { block: encodeBlock('INVITE', invite), code: invite.code || '' }; // NEW
        record = record || { id, identityId: session.identityId, project: summary(invite), userId: invite.pendingUserId, inviteId: invite.inviteId }; // NEW
        Object.assign(record, { project: summary(invite), displayName, senderEmail, warning: '' }); // CHANGE: a resent invitation can renew its code and expiry without creating another request.
        try { record.secrets = await protect(JSON.stringify(secret)); check(session); } catch (_) { check(session); record.secrets = null; record.warning = 'Progress is saved, but paste the invitation again after restarting Trellis because operating-system credential protection is unavailable.'; temporary.set(session.identityId + ':' + id, secret); } // NEW
        await save(session, record); // NEW: journal before transport registration so a crash can resume the same request.
        return resumeWith(session, record, service, secret.block); // CHANGE
    } // NEW
    async function resumeWith(session, record, service, renewedBlock) { // CHANGE
        if (record.completed) return status(session, record, service); // NEW
        let canvas = (await service.listCanvases()).find(row => row.shareId === record.project.shareId); check(session); // NEW
        if (!canvas || canvas.retired) { const secret = await secrets(session, record); await service.joinCanvas({ block: secret.block, senderEmail: record.senderEmail }); check(session); } // CHANGE
        const renewed = renewedBlock ? await service.resumeJoin({ shareId: record.project.shareId, inviteId: record.inviteId, block: renewedBlock }) : null; check(session); // NEW: allow a fresh invitation to replace an unapproved request before evaluating its new progress.
        const current = await status(session, record, service); // NEW
        if (['expired', 'revoked'].includes(current.state)) return current; // NEW
        const reply = renewed || await service.resumeJoin({ shareId: record.project.shareId, inviteId: record.inviteId }); check(session); // CHANGE
        return { ...current, reply: reply.reply }; // NEW
    } // NEW
    async function list(input) { // NEW
        const session = capture(input), service = await transport(session), folder = directory(session); // NEW
        const names = await listBounded(folder).catch(error => { if (error.code === 'ENOENT') return []; throw error; }); check(session); // NEW
        const requests = [], errors = []; // NEW
        for (const name of names.filter(name => /^[a-f0-9]{64}\.json$/.test(name))) { // NEW
            try { const record = await load(session, name.slice(0, -5)); if (!record.completed) requests.push(await status(session, record, service)); } catch (error) { check(session); errors.push('An invitation could not be restored. Paste it again to retry.'); } // NEW
        } // NEW
        return { requests, errors }; // NEW
    } // NEW
    async function resume(input) { const session = capture(input); await identities.requireSession(); check(session); const record = await load(session, input.id); return resumeWith(session, record, await transport(session)); } // CHANGE
    /** Supply acceptance secrets only to the window already watching this ready project. */ // NEW
    async function prepare(input, callerId) { // NEW
        const session = capture(input); await identities.requireSession(); check(session); const record = await load(session, input.id), current = await status(session, record, await transport(session)); // CHANGE
        if (!['ready', 'complete'].includes(current.state)) throw new Error(current.reason || 'Wait for approval and download before opening the project.'); // NEW
        await validateWatchedPath(callerId, current.path); check(session); // NEW
        const saved = inspectDiagram(await readBounded(current.path, LIMITS.diagram) /* CHANGE */); check(session); // NEW
        const alreadyAccepted = saved.store.users?.some(user => user.id === record.userId && user.portableIdentityId === session.identityId && !user.disabled); // NEW
        let code = ''; if (!record.project.deviceSetup && !record.completed && !alreadyAccepted) code = (await secrets(session, record)).code; // CHANGE
        return { ...current, userId: record.userId, code, identityId: session.identityId, generation: session.generation }; // CHANGE
    } // NEW
    async function complete(input, callerId) { // NEW
        const session = capture(input); await identities.requireSession(); check(session); const record = await load(session, input.id), current = await status(session, record, await transport(session)); // CHANGE
        if (!['ready', 'complete'].includes(current.state)) throw new Error(current.reason || 'The project is not ready.'); // NEW
        await validateWatchedPath(callerId, current.path); check(session); // NEW
        const state = inspectDiagram(await readBounded(current.path, LIMITS.diagram) /* CHANGE */); check(session); // NEW
        if (!state.store.users?.some(user => user.id === record.userId && !user.disabled && user.portableIdentityId === session.identityId)) throw new Error('Finish accepting the invitation and save your identity linkage before adding the project.'); // NEW
        if (record.completed) return current; // NEW: completion acknowledgments are idempotent after a lost renderer response.
        const result = await library.importCurrent({ path: current.path, diagramId: record.project.diagramId, userId: record.userId }); check(session); // NEW
        Object.assign(record, { completed: true, path: result.path, secrets: null, warning: '' }); await save(session, record); temporary.delete(session.identityId + ':' + record.id); // NEW
        return { ...current, state: 'complete', path: result.path }; // NEW
    } // NEW
    return { preview, start: input => serialized(() => start(input)), list, resume: input => serialized(() => resume(input)), prepare, complete: (input, callerId) => serialized(() => complete(input, callerId)) }; // CHANGE
} // NEW
