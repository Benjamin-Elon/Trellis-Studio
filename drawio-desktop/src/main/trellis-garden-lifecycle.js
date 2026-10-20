/** Identity lifecycle orchestration, kept separate from catalog and download mechanics. */ // NEW
import fs from 'node:fs/promises'; // NEW
import path from 'node:path'; // NEW
import crypto from 'node:crypto'; // NEW
import { atomicJson, readOptional, moveRetained, projectLifecycle } from './trellis-project-trash.js'; // NEW

export function createGardenLifecycle({ identities, own, catalog, verifiedRecords, localSource, setLocalSource, sourceService, getLocalFolder, getTrashRoot, validateLocalPath, validateStandalonePath, beforeRetire = async () => {} }) { // NEW
    let queue = Promise.resolve(); // NEW
    const serialized = operation => { const next = queue.then(operation); queue = next.catch(() => {}); return next; }; // NEW
    const directory = identityId => path.join(identities.metadataRoot(identityId), 'project-lifecycle'); // NEW
    const records = async identityId => { // CHANGE: new identities have no journal or trust anchor yet.
        if (!await fs.stat(directory(identityId)).then(s => s.isDirectory()).catch(error => { if (error.code === 'ENOENT') return false; throw error; })) return []; // NEW
        return verifiedRecords(identityId, directory(identityId)); // NEW
    }; // NEW
    const lifecycle = async (identityId, diagramId) => projectLifecycle(await records(identityId), diagramId); // NEW
    const localRoot = () => path.resolve(getTrashRoot()); // NEW
    function localDirectory(id) { // NEW
        if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid Trash identifier.'); // NEW
        return path.join(localRoot(), id); // NEW
    } // NEW
    async function entryFor(identityId, diagramId) { // NEW
        const entry = (await catalog(identityId)).find(e => e.diagramId === diagramId); // NEW
        if (!entry) throw new Error('Garden is not in this identity library.'); // NEW
        return entry; // NEW
    } // NEW
    async function serviceFor(identityId, entry) { return sourceService(identityId, await localSource(identityId, entry.diagramId)); } // NEW
    async function publish(entry, operation, current, extra = {}) { // NEW
        const session = own(); // NEW
        const record = await identities.signAction('garden-lifecycle', { diagramId: entry.diagramId, operation, parents: current.heads, ...extra }); // NEW
        if (record.payload.identityId !== session.identityId) throw new Error('The active identity changed.'); // NEW
        await fs.mkdir(directory(session.identityId), { recursive: true }); // NEW
        await fs.writeFile(path.join(directory(session.identityId), record.payload.id + '.json'), JSON.stringify(record), { flag: 'wx', mode: 0o600, flush: true }); // NEW
        return record; // NEW
    } // NEW
    async function assertActive(identityId, diagramId) { // NEW
        const state = await lifecycle(identityId, diagramId); // NEW
        if (state.state !== 'active' || state.pending) throw new Error('This project is retired or has pending lifecycle records. Restore it from Trash before opening or changing it.'); // NEW
    } // NEW
    async function actions(input) { // NEW
        const session = own(), entry = await entryFor(session.identityId, input.diagramId); // NEW
        await assertActive(session.identityId, entry.diagramId); // NEW
        const daemon = await serviceFor(session.identityId, entry); // NEW
        const result = await daemon.projectActions({ shareId: entry.shareId, userId: entry.workerId, identityId: session.identityId }); // NEW
        if (result.available) return { ok: true, ...result }; // NEW
        return { ok: true, ...result, canDelete: entry.ownerIdentityId === session.identityId && entry.summary?.userCount === 1 && entry.summary?.accessible !== false, canLeave: false, reason: 'Download the project to verify its members before leaving.' }; // NEW
    } // NEW
    /** Background application also works while locked: records are already signed and verified. */ // NEW
    async function apply(identityId) { // NEW
        const all = await records(identityId); // NEW
        const entries = await catalog(identityId, []); // NEW: isolate unrelated bad catalog records during background processing.
        for (const entry of entries) { // NEW
            let state = projectLifecycle(all, entry.diagramId); // NEW
            const pendingSource = await localSource(identityId, entry.diagramId); // NEW
            if (state.state === 'active' && pendingSource?.departing && identities.session()?.identityId === identityId) { // NEW
                const daemon = await sourceService(identityId, pendingSource); // NEW
                const departure = await daemon.leaveProject({ shareId: entry.shareId, userId: entry.workerId, identityId }); // NEW
                if (departure.rejected) await setLocalSource(identityId, entry.diagramId, { ...pendingSource, departing: false, lifecycleStatus: departure.reason }); // NEW
                else if (departure.complete) { await publish(entry, 'left', state, { receipt: departure.receipt }); state = await lifecycle(identityId, entry.diagramId); } // NEW
            } // NEW
            if (!state.record || state.pending) continue; // NEW
            const source = await localSource(identityId, entry.diagramId); // NEW
            try { // NEW
                const daemon = await sourceService(identityId, source); // NEW
                if (state.state !== 'active') await beforeRetire({ identityId, diagramId: entry.diagramId, shareId: entry.shareId }); // NEW
                const result = await daemon.applyProjectLifecycle({ shareId: entry.shareId, userId: entry.workerId, identityId, operation: state.state, recordId: state.record.id }); // NEW
                await setLocalSource(identityId, entry.diagramId, { ...source, lifecycleStatus: result.reason || '', lifecycleState: state.state }); // NEW
            } catch (error) { // NEW
                await setLocalSource(identityId, entry.diagramId, { ...source, lifecycleStatus: error.message, lifecycleState: state.state }); // NEW
            } // NEW
        } // NEW
    } // NEW
    const processLifecycle = identityId => serialized(() => apply(identityId)); // NEW
    async function localEntry(id) { // NEW
        const folder = localDirectory(id), entry = await readOptional(path.join(folder, 'entry.json')); // NEW
        if (!entry || entry.trashId !== id || !['moving', 'trashed', 'restoring', 'purging'].includes(entry.state)) throw new Error('Local project is not in Trash.'); // NEW
        return { folder, entry }; // NEW
    } // NEW
    async function recoverLocal(folder, entry) { // NEW
        if (entry.state === 'moving') { // NEW
            await validateStandalonePath(entry.originalPath); // CHANGE
            await moveRetained(entry.originalPath, path.join(folder, 'project.drawio'), path.join(folder, 'move.json')); // NEW
            entry.state = 'trashed'; await atomicJson(path.join(folder, 'entry.json'), entry); // NEW
        } else if (entry.state === 'restoring') { // NEW
            await validateStandalonePath(entry.restorePath); // CHANGE
            await moveRetained(path.join(folder, 'project.drawio'), entry.restorePath, path.join(folder, 'restore.json')); // NEW
            await fs.rm(folder, { recursive: true, force: true }); // NEW
        } else if (entry.state === 'purging') await fs.rm(folder, { recursive: true, force: true }); // NEW
    } // NEW
    async function listTrash() { // NEW
        return serialized(async () => { // NEW
            const gardens = [], errors = [], session = identities.session(); // NEW
            if (session) { // NEW
                await apply(session.identityId); // NEW
                const all = await records(session.identityId); // NEW
                for (const entry of await catalog(session.identityId)) { // NEW
                    const state = projectLifecycle(all, entry.diagramId); // NEW
                    const source = await localSource(session.identityId, entry.diagramId); // NEW
                    const restoring = state.state === 'active' && state.record?.operation === 'restore' && !!source?.lifecycleStatus, purging = state.state === 'purged' && !!source?.lifecycleStatus; // NEW
                    if (state.state !== 'trashed' && !restoring && !purging) continue; // NEW
                    gardens.push({ ...entry, source: 'library', trashId: state.record.id, reason: source?.lifecycleStatus || '', deletedAt: state.record.time, restoring, purging }); // CHANGE
                } // NEW
            } // NEW
            const names = await fs.readdir(localRoot()).catch(error => { if (error.code === 'ENOENT') return []; throw error; }); // NEW
            for (const id of names.filter(name => /^[a-f0-9-]{36}$/.test(name))) { // NEW
                try { // NEW
                    const { folder, entry } = await localEntry(id); // CHANGE
                    try { await recoverLocal(folder, entry); } // NEW
                    catch (error) { gardens.push({ ...entry, source: 'local', reason: error.message, restoring: entry.state === 'restoring', purging: entry.state === 'purging' }); continue; } // NEW
                    if (entry.state === 'trashed') gardens.push({ ...entry, source: 'local' }); // NEW
                } catch (error) { errors.push('Local Trash: ' + error.message); } // NEW
            } // NEW
            return { ok: true, gardens, errors }; // NEW
        }); // NEW
    } // NEW
    async function trash(input) { // NEW
        return serialized(async () => { // NEW
            if (input.confirm !== true) throw new Error('Confirm moving this project to Trash.'); // NEW
            if (input.source === 'local') { // NEW
                const filename = path.resolve(input.path || ''), folder = path.resolve(getLocalFolder()); // NEW
                if (path.dirname(filename) !== folder || !/\.drawio$/i.test(filename) || /\.sync-conflict-/i.test(filename)) throw new Error('Choose a file from the configured local projects folder.'); // NEW
                await validateStandalonePath(filename); // CHANGE
                if (!(await fs.lstat(filename)).isFile()) throw new Error('Choose an ordinary project file.'); // NEW
                await beforeRetire({ path: filename }); // NEW
                const trashId = crypto.randomUUID(), retained = localDirectory(trashId); // NEW
                const entry = { trashId, name: path.basename(filename, path.extname(filename)), originalPath: filename, deletedAt: Date.now(), state: 'moving' }; // NEW
                await atomicJson(path.join(retained, 'entry.json'), entry); await recoverLocal(retained, entry); // NEW
                return { ok: true }; // NEW
            } // NEW
            const session = own(), entry = await entryFor(session.identityId, input.diagramId), eligibility = await actions(input); // NEW
            if (!eligibility.canDelete) throw new Error(eligibility.reason || 'Only a sole active administrator can delete this project. Use Leave project when other members remain.'); // NEW
            const state = await lifecycle(session.identityId, entry.diagramId); // NEW
            await publish(entry, 'trash', state); await apply(session.identityId); return { ok: true }; // NEW
        }); // NEW
    } // NEW
    async function restore(input) { // NEW
        return serialized(async () => { // NEW
            if (input.source === 'local') { // NEW
                const { folder, entry } = await localEntry(input.trashId); // NEW
                const basename = input.filename || path.basename(entry.originalPath); // NEW
                if (path.basename(basename) !== basename || !/^[^<>:"/\\|?*\x00-\x1f]+\.drawio$/i.test(basename) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(basename) || basename.length > 255) throw new Error('Enter a valid .drawio filename without folders.'); // CHANGE
                const restorePath = path.join(path.dirname(entry.originalPath), basename); await validateStandalonePath(restorePath); // CHANGE
                if (entry.state === 'restoring') { // NEW
                    if (restorePath !== entry.restorePath) throw new Error('Finish the pending restore using ' + path.basename(entry.restorePath) + ', or refresh Trash after resolving its filesystem error.'); // NEW
                    await recoverLocal(folder, entry); return { ok: true }; // NEW
                } // NEW
                if (await fs.lstat(restorePath).then(() => true).catch(error => { if (error.code === 'ENOENT') return false; throw error; })) throw new Error('The restore destination already exists. Choose another filename.'); // NEW
                await atomicJson(path.join(folder, 'entry.json'), { ...entry, state: 'restoring', restorePath }); // NEW
                await recoverLocal(folder, { ...entry, state: 'restoring', restorePath }); return { ok: true }; // NEW
            } // NEW
            const session = own(), entry = await entryFor(session.identityId, input.diagramId), state = await lifecycle(session.identityId, entry.diagramId); // NEW
            if (state.state === 'active' && state.record?.operation === 'restore' && input.trashId === state.record.id) { await apply(session.identityId); return { ok: true }; } // NEW
            if (state.state !== 'trashed' || input.trashId !== state.record.id) throw new Error('Trash changed. Refresh before restoring this project.'); // NEW
            await publish(entry, 'restore', state, { target: state.record.id }); await apply(session.identityId); return { ok: true }; // NEW
        }); // NEW
    } // NEW
    async function purge(input) { // NEW
        return serialized(async () => { // NEW
            if (input.confirm !== true) throw new Error('Confirm permanent deletion.'); // NEW
            if (input.source === 'local') { // NEW
                const { folder, entry } = await localEntry(input.trashId); // NEW
                await atomicJson(path.join(folder, 'entry.json'), { ...entry, state: 'purging' }); await fs.rm(folder, { recursive: true, force: true }); return { ok: true }; // NEW
            } // NEW
            const session = own(), entry = await entryFor(session.identityId, input.diagramId), state = await lifecycle(session.identityId, entry.diagramId); // NEW
            if (state.state === 'purged' && input.trashId === state.record.id) { await apply(session.identityId); return { ok: true }; } // NEW
            if (state.state !== 'trashed' || state.record.id !== input.trashId) throw new Error('Trash changed. Refresh before deleting permanently.'); // NEW
            const source = await localSource(session.identityId, entry.diagramId); // NEW
            if (source?.lifecycleStatus && !/Files unavailable|Waiting for/.test(source.lifecycleStatus)) throw new Error('Resolve the Trash problem or restore this project before deleting permanently.'); // NEW
            await publish(entry, 'purge', state, { target: state.record.id }); await apply(session.identityId); return { ok: true }; // NEW
        }); // NEW
    } // NEW
    async function leave(input) { // NEW
        return serialized(async () => { // NEW
            if (input.confirm !== true) throw new Error('Confirm leaving this project.'); // NEW
            const session = own(), entry = await entryFor(session.identityId, input.diagramId); await assertActive(session.identityId, entry.diagramId); // NEW
            const daemon = await serviceFor(session.identityId, entry); // NEW
            const result = await daemon.leaveProject({ ...input, shareId: entry.shareId, userId: entry.workerId, identityId: session.identityId }); // NEW
            if (result.rejected) throw new Error(result.reason); // NEW
            if (!result.complete) { const source = await localSource(session.identityId, entry.diagramId); await setLocalSource(session.identityId, entry.diagramId, { ...source, departing: true }); return result; } // NEW
            await publish(entry, 'left', await lifecycle(session.identityId, entry.diagramId), { receipt: result.receipt }); // NEW
            await apply(session.identityId); return { ok: true, complete: true }; // NEW
        }); // NEW
    } // NEW
    /** Fence folders before a daemon starts; applying file moves remains in the normal refresh queue. */ // NEW
    async function fenceTransport(identityId) { // NEW
        const all = await records(identityId); // NEW
        if (!all.length) return; // NEW
        for (const entry of await catalog(identityId, [])) { // NEW
            const state = projectLifecycle(all, entry.diagramId); // NEW
            if (state.state !== 'active' || state.pending) await (await serviceFor(identityId, entry)).fenceProject({ shareId: entry.shareId }); // NEW
        } // NEW
    } // NEW
    async function completeRejoin(entry) { // NEW
        const session = own(), state = await lifecycle(session.identityId, entry.diagramId); // NEW
        if (state.state !== 'left') throw new Error('Only a departed project can be rejoined.'); // NEW
        await publish(entry, 'rejoin', state, { target: state.record.id }); // NEW
    } // NEW
    return { actions, trash, restore, purge, leave, listTrash, processLifecycle, lifecycle, assertActive, fenceTransport, completeRejoin }; // NEW
} // NEW
