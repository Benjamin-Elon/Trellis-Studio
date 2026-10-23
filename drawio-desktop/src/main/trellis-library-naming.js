/** Identity-scoped naming orchestration over existing signed metadata and managed transports. */ // NEW
import fs from 'node:fs/promises'; // NEW
import path from 'node:path'; // NEW
import { inspectDiagram, hasCanvasAccess } from './trellis-share-protocol.js'; // NEW
import { naming, projectName } from './trellis-project-naming.js'; // NEW
export function createLibraryNaming({ identities, own, getEntry, catalog, localSource, setLocalSource, sourceService, verifiedRecords, writeJson, publish }) { // NEW
    const directory = identityId => path.join(identities.metadataRoot(identityId), 'project-suffixes'); // NEW
    const reconciled = new Map(); // NEW: skip unchanged projections and immutable journal directories during maintenance.
    /** Read the signed suffix journal once for a complete library view. */ // NEW
    async function suffixes(identityId, current) { // NEW
        const result = new Map(); // NEW
        for (const record of await verifiedRecords(identityId, directory(identityId), undefined, current)) if (record.payload.kind === 'project-suffix') result.set(record.payload.diagramId, naming.suffix(record.payload.suffix)); // NEW
        return result; // NEW
    } // NEW
    /** Inspect a projection already read by the caller; browsing never reconciles files. */ // NEW
    function inspect(identityId, entry, local, state, personalSuffix = '') { // NEW
        const shared = state && projectName(state) || local?.projectName || entry.projectName || ''; // NEW
        const user = state?.store.users?.find(user => user.id === entry.workerId && user.portableIdentityId === identityId && !user.disabled); // NEW
        const verifiedMember = state ? !!user && hasCanvasAccess(state, user.id) : !local?.available && entry.summary?.accessible !== false; // NEW
        const namingReady = !!shared && !!user && verifiedMember; // CHANGE
        const displayName = naming.displayName(shared || entry.name, personalSuffix); // NEW
        return { projectName: shared, suffix: personalSuffix, displayName, name: displayName, filename: local?.filename || null, path: local?.path || null, folderPath: local?.folderPath || null, available: !!local?.available, canRename: namingReady && !!user.admin, canEditSuffix: verifiedMember && !!shared, namingReady, filenamePending: !!local?.filenamePending, namingError: local?.namingError || '' }; // CHANGE
    } // NEW
    async function suffix(identityId, diagramId) { // NEW
        const records = await verifiedRecords(identityId, directory(identityId)); // NEW
        const latest = records.filter(record => record.payload.kind === 'project-suffix' && record.payload.diagramId === diagramId).at(-1); // NEW
        return latest ? naming.suffix(latest.payload.suffix) : ''; // NEW
    } // NEW
    async function located(identityId, entry) { // NEW
        let source = await localSource(identityId, entry.diagramId), daemon = await sourceService(identityId, source); // NEW
        if (source?.legacy && source.namingDownload) { // NEW
            const personal = await identities.transport(identityId), copy = (await personal.listCanvases()).find(canvas => canvas.shareId === entry.shareId && canvas.available && !canvas.pending && !canvas.revoked); // NEW
            if (copy) { source = { ...source, legacy: false, namingDownload: false }; await setLocalSource(identityId, entry.diagramId, source); daemon = personal; } // NEW
        } // NEW
        return { source, daemon, local: (await daemon.listCanvases()).find(canvas => canvas.shareId === entry.shareId) }; // NEW
    } // NEW
    async function describe(identityId, entry, change = {}, observed) { // CHANGE
        let { source, daemon, local } = observed || await located(identityId, entry); // CHANGE
        const personalSuffix = observed ? observed.suffix : await suffix(identityId, entry.diagramId); // CHANGE
        let shared = entry.projectName || '', canRename = false, namingError = '', namingReady = false, verifiedMember = !local?.available && entry.summary?.accessible !== false; // CHANGE
        if (local && (local.available || !local.localRemoved) && !local.pending && !local.revoked && !local.retired && !local.fenced) { // CHANGE: recover an externally renamed local projection even while its registered path is missing.
            try { // NEW
                local = await daemon.setProjectNaming({ shareId: entry.shareId, userId: entry.workerId, identityId, suffix: personalSuffix, fallbackName: identities.session()?.identityId === identityId ? entry.projectName || entry.name : undefined, personalProjection: !source?.legacy, ...change }); // CHANGE
                const state = inspectDiagram(await fs.readFile(local.path, 'utf8')); // NEW
                const user = state.store.users?.find(user => user.id === entry.workerId && user.portableIdentityId === identityId && !user.disabled); // NEW
                shared = projectName(state) || shared; // NEW
                namingReady = !!shared && !!user && hasCanvasAccess(state, user.id); // CHANGE
                verifiedMember = !!user && hasCanvasAccess(state, user.id); // NEW
                if (source?.legacy && namingReady && !source.namingDownload && identities.session()?.identityId === identityId) { await requestPersonalCopy(own(), entry, source, daemon); source = { ...source, namingDownload: true }; } // CHANGE: application-wide sources retain access while the identity-scoped copy downloads.
                canRename = namingReady && !!user.admin; // NEW
                if (shared && shared !== entry.projectName && identities.session()?.identityId === identityId) { entry = { ...entry, projectName: shared, name: shared }; await publish(entry); } // NEW
            } catch (error) { namingError = error.message; if (change.name !== undefined) throw error; } // NEW
        } else if (change.name !== undefined) throw new Error('Download the project before renaming it.'); // NEW
        const displayName = naming.displayName(shared || entry.name, personalSuffix); // NEW
        return { projectName: shared, suffix: personalSuffix, displayName, name: displayName, filename: local?.filename || null, path: local?.path || null, folderPath: local?.folderPath || null, available: !!local?.available, canRename, canEditSuffix: verifiedMember && !!shared, namingReady, filenamePending: !!local?.filenamePending || !!source?.legacy && namingReady, namingError: namingError || local?.namingError || (source?.legacy && namingReady ? 'Your personal project copy must download and receive device approval before its filename can change.' : '') }; // CHANGE
    } // NEW
    async function rename(input) { // NEW
        const session = own(); await identities.requireSession(); const entry = await getEntry(input.diagramId); // NEW
        const name = naming.projectName(input.name); // NEW
        return { ok: true, ...await describe(session.identityId, entry, { name }) }; // NEW
    } // NEW
    /** Reuse download enrollment; retain the legacy source until the private projection is ready. */ // NEW
    async function requestPersonalCopy(session, entry, source, daemon) { // NEW
        const current = await identities.requireSession(), device = current.devices.find(device => device.id === session.deviceId); // NEW
        const descriptor = await daemon.libraryDescriptor(entry.shareId), personal = await identities.transport(session.identityId); // NEW
        await personal.registerLibraryDownload(descriptor); // NEW
        const record = await identities.signAction('garden-download', { diagramId: entry.diagramId, shareId: entry.shareId, workerId: entry.workerId, device }); // NEW
        await writeJson(path.join(identities.metadataRoot(session.identityId), 'downloads', record.payload.id + '.json'), record); // NEW
        await setLocalSource(session.identityId, entry.diagramId, { ...source, namingDownload: true }); // NEW
    } // NEW
    async function setSuffix(input) { // NEW
        const session = own(); await identities.requireSession(); const entry = await getEntry(input.diagramId), value = naming.suffix(input.suffix); // NEW
        const current = await describe(session.identityId, entry); // NEW
        if (!current.canEditSuffix) throw new Error('An administrator must initialize the shared project name first.'); // CHANGE
        const { source, daemon } = await located(session.identityId, entry); // NEW
        if (source?.legacy && !source.namingDownload) await requestPersonalCopy(session, entry, source, daemon); // NEW
        const record = await identities.signAction('project-suffix', { diagramId: entry.diagramId, suffix: value }); // NEW
        if (record.payload.identityId !== session.identityId || identities.session()?.identityId !== session.identityId) throw new Error('The active identity changed before the suffix could be saved.'); // NEW
        await writeJson(path.join(directory(session.identityId), record.payload.id + '.json'), record); // NEW
        return { ok: true, ...await describe(session.identityId, entry) }; // NEW
    } // NEW
    async function reconcile(identityId, entries, registries = new Map()) { // NEW
        const current = await identities.state(identityId), personalSuffixes = await suffixes(identityId, current); // NEW
        for (const entry of entries || await catalog(identityId)) { // NEW
            try { // CHANGE
                const source = await localSource(identityId, entry.diagramId), daemon = await sourceService(identityId, source); // NEW
                if (!registries.has(daemon)) registries.set(daemon, await daemon.listCanvases()); // NEW
                const local = registries.get(daemon).find(canvas => canvas.shareId === entry.shareId), personalSuffix = personalSuffixes.get(entry.diagramId) || ''; // NEW
                const stamp = async filename => fs.stat(filename).then(stat => [stat.mtimeMs, stat.ctimeMs, stat.size]).catch(error => { if (error.code === 'ENOENT') return null; throw error; }); // NEW
                const token = JSON.stringify([local, personalSuffix, entry.projectName, current.devices, local?.path && await stamp(local.path), local?.folderPath && await stamp(path.join(local.folderPath, '.trellis', 'collaboration-v2', 'records'))]); // NEW
                const key = identityId + ':' + entry.diagramId; // NEW
                if (reconciled.get(key) === token && !local?.filenamePending && !source?.namingDownload) continue; // NEW
                const result = await describe(identityId, entry, {}, source?.namingDownload ? undefined : { source, daemon, local, suffix: personalSuffix }); // NEW
                if (!result.namingError && !result.filenamePending) reconciled.set(key, token); // NEW
            } catch (_) {} // CHANGE: mutation and background paths retain recoverable failures without blocking other gardens.
        } // NEW
    } // NEW
    return { describe, inspect, suffixes, rename, setSuffix, reconcile }; // CHANGE
} // NEW
