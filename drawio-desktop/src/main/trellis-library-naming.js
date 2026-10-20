/** Identity-scoped naming orchestration over existing signed metadata and managed transports. */ // NEW
import fs from 'node:fs/promises'; // NEW
import path from 'node:path'; // NEW
import { inspectDiagram, hasCanvasAccess } from './trellis-share-protocol.js'; // NEW
import { naming, projectName } from './trellis-project-naming.js'; // NEW
export function createLibraryNaming({ identities, own, getEntry, catalog, localSource, setLocalSource, sourceService, verifiedRecords, writeJson, publish }) { // NEW
    const directory = identityId => path.join(identities.metadataRoot(identityId), 'project-suffixes'); // NEW
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
    async function describe(identityId, entry, change = {}) { // NEW
        let { source, daemon, local } = await located(identityId, entry); // NEW
        const personalSuffix = await suffix(identityId, entry.diagramId); // NEW
        let shared = entry.projectName || '', canRename = false, namingError = '', namingReady = false, verifiedMember = !local?.available && entry.summary?.accessible !== false; // CHANGE
        const requiresNamingUpgrade = (local?.protocolVersion || entry.protocolVersion || 1) !== 2; // NEW
        if (local && (local.available || local.protocolVersion === 2 && !local.localRemoved) && !local.pending && !local.revoked && !local.retired && !local.fenced) { // CHANGE: recover an externally renamed local projection even while its registered path is missing.
            try { // NEW
                if (!requiresNamingUpgrade) local = await daemon.setProjectNaming({ shareId: entry.shareId, userId: entry.workerId, identityId, suffix: personalSuffix, fallbackName: identities.session()?.identityId === identityId ? entry.projectName || entry.name : undefined, personalProjection: !source?.legacy, ...change }); // CHANGE
                const state = inspectDiagram(await fs.readFile(local.path, 'utf8')); // NEW
                const user = state.store.users?.find(user => user.id === entry.workerId && user.portableIdentityId === identityId && !user.disabled); // NEW
                shared = projectName(state) || shared; // NEW
                namingReady = !!shared && !requiresNamingUpgrade && !!user && hasCanvasAccess(state, user.id); // NEW
                verifiedMember = !!user && hasCanvasAccess(state, user.id); // NEW
                if (source?.legacy && namingReady && !source.namingDownload && identities.session()?.identityId === identityId) { await requestPersonalCopy(own(), entry, source, daemon); source = { ...source, namingDownload: true }; } // NEW: upgrading also migrates the unsuffixed filename into identity-scoped storage.
                canRename = namingReady && !!user.admin; // NEW
                if (shared && shared !== entry.projectName && identities.session()?.identityId === identityId) { entry = { ...entry, projectName: shared, name: shared }; await publish(entry); } // NEW
            } catch (error) { namingError = error.message; if (change.name !== undefined) throw error; } // NEW
        } else if (change.name !== undefined) throw new Error('Download the project before renaming it.'); // NEW
        const displayName = naming.displayName(shared || entry.name, personalSuffix); // NEW
        return { projectName: shared, suffix: personalSuffix, displayName, name: displayName, filename: local?.filename || null, path: local?.path || null, folderPath: local?.folderPath || null, available: !!local?.available, canRename, canEditSuffix: verifiedMember && !!shared && !requiresNamingUpgrade, namingReady, requiresNamingUpgrade, filenamePending: !!local?.filenamePending || !!source?.legacy && namingReady, namingError: namingError || local?.namingError || (source?.legacy && namingReady ? 'Your personal project copy must download and receive device approval before its filename can change.' : '') }; // CHANGE
    } // NEW
    async function rename(input) { // NEW
        const session = own(); await identities.requireSession(); const entry = await getEntry(input.diagramId); // NEW
        const name = naming.projectName(input.name); // NEW
        const { local } = await located(session.identityId, entry); // NEW
        if ((local?.protocolVersion || entry.protocolVersion || 1) !== 2) throw new Error('An administrator must upgrade this project before renaming it.'); // NEW
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
        if (!current.canEditSuffix) throw new Error(current.requiresNamingUpgrade ? 'An administrator must upgrade this project before adding a suffix.' : 'An administrator must initialize the shared project name first.'); // NEW
        const { source, daemon } = await located(session.identityId, entry); // NEW
        if (source?.legacy && !source.namingDownload) await requestPersonalCopy(session, entry, source, daemon); // NEW
        const record = await identities.signAction('project-suffix', { diagramId: entry.diagramId, suffix: value }); // NEW
        if (record.payload.identityId !== session.identityId || identities.session()?.identityId !== session.identityId) throw new Error('The active identity changed before the suffix could be saved.'); // NEW
        await writeJson(path.join(directory(session.identityId), record.payload.id + '.json'), record); // NEW
        return { ok: true, ...await describe(session.identityId, entry) }; // NEW
    } // NEW
    async function reconcile(identityId, entries) { // NEW
        for (const entry of entries || await catalog(identityId)) { // NEW
            try { await describe(identityId, entry); } catch (_) {} // NEW: listing reports per-project errors; background refresh must still process other projects.
        } // NEW
    } // NEW
    return { describe, rename, setSuffix, reconcile }; // NEW
} // NEW
