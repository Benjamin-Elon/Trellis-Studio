/** Identity-scoped catalog orchestration over the existing managed-canvas service. // NEW */
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { inspectDiagram, diagramDocument, hasCanvasAccess } from './trellis-share-protocol.js';
import { cityRecord, projectSummary, averageDistance } from './trellis-project-summary.js'; // NEW
import { createGardenLifecycle } from './trellis-garden-lifecycle.js'; // NEW
import { createLibraryNaming } from './trellis-library-naming.js'; // NEW
import { naming, withProjectName } from './trellis-project-naming.js'; // NEW
const p = globalThis.TrellisIdentityProtocol;
const uuid = () => crypto.randomUUID();
const safe = value => { if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(value)) throw new Error('Invalid garden identifier.'); return value; };
const escape = value => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
async function readJson(filename) { return JSON.parse(await fs.readFile(filename, 'utf8')); }
async function writeJson(filename, value) { await fs.mkdir(path.dirname(filename), { recursive: true }); await fs.writeFile(filename, JSON.stringify(value), { flag: 'wx', mode: 0o600 }); }

export function createGardenLibraryService({ identities, legacyService, listCities = async () => [], getLocalFolder = () => '', getTrashRoot = () => path.join(getLocalFolder(), '.trellis-trash'), beforeRetire, setLocalFolder, validateLocalPath = async () => {}, validateStandalonePath = validateLocalPath }) { // CHANGE
    const privatePath = identityId => path.join(identities.identityRoot(identityId), 'local-gardens');
    const catalogPath = identityId => path.join(identities.metadataRoot(identityId), 'catalog');
    const own = () => { const session = identities.session(); if (!session) throw new Error('Log in to Garden library first.'); return session; };
    const virtualCaller = identityId => 'identity-library:' + identityId;
    async function verifiedRecords(identityId, directory, errors) { // CHANGE: list views can isolate an unverifiable record while mutation paths remain strict.
        const current = await identities.state(identityId);
        const keys = new Map(current.records.filter(record => record.payload.device).map(record => [record.payload.device.id, record.payload.device.publicKey]));
        const names = await fs.readdir(directory).catch(err => { if (err.code === 'ENOENT') return []; throw err; });
        const records = [];
        for (const name of names.filter(name => /^[A-Za-z0-9_-]+\.json$/.test(name))) {
            try { // NEW
                const record = await readJson(path.join(directory, name)), data = record.payload;
                if (!data || data.identityId !== identityId || !keys.has(data.author) || !await p.verify(record, keys.get(data.author))) throw new Error('Library signature is invalid.');
                records.push(record);
            } catch (error) { if (!errors) throw error; errors.push('Project metadata could not be verified: ' + name); } // NEW
        }
        return records.sort((a, b) => a.payload.time - b.payload.time || (a.payload.id < b.payload.id ? -1 : 1));
    }
    async function catalog(identityId, errors) { // CHANGE
        const entries = new Map();
        for (const record of await verifiedRecords(identityId, catalogPath(identityId), errors)) { // CHANGE
            try { // NEW
                const data = record.payload;
                if (data.kind !== 'garden-record' || !data.entry) throw new Error('Unsupported library record.');
                if (typeof data.entry.name !== 'string' || !data.entry.name.trim()) throw new Error('Invalid project name in library metadata.'); // NEW
                safe(data.entry.diagramId); safe(data.entry.shareId);
                entries.set(data.entry.diagramId, data.entry);
            } catch (error) { if (!errors) throw error; errors.push('Unsupported project metadata: ' + record.payload.id); } // NEW
        }
        return [...entries.values()];
    }
    async function publish(entry) {
        const session = own(), record = await identities.signAction('garden-record', { entry });
        if (record.payload.identityId !== session.identityId || entry.ownerIdentityId && entry.ownerIdentityId !== session.identityId) throw new Error('The active identity changed before project metadata could be saved.'); // NEW
        await writeJson(path.join(catalogPath(session.identityId), record.payload.id + '.json'), record);
        return entry;
    }
    async function localSource(identityId, diagramId) {
        return readJson(path.join(privatePath(identityId), safe(diagramId) + '.json')).catch(err => { if (err.code === 'ENOENT') return null; throw err; });
    }
    async function setLocalSource(identityId, diagramId, value) {
        const directory = privatePath(identityId); await fs.mkdir(directory, { recursive: true });
        const filename = path.join(directory, safe(diagramId) + '.json'), temporary = filename + '.' + uuid() + '.tmp';
        await fs.writeFile(temporary, JSON.stringify(value), { mode: 0o600 }); await fs.rename(temporary, filename);
    }
    async function sourceService(identityId, local) { return local?.legacy ? legacyService() : identities.transport(identityId); }
    const lifecycle = createGardenLifecycle({ identities, own, catalog, verifiedRecords, localSource, setLocalSource, sourceService, getLocalFolder, getTrashRoot, validateLocalPath, validateStandalonePath, beforeRetire }); // NEW
    const projectNaming = createLibraryNaming({ identities, own, getEntry, catalog, localSource, setLocalSource, sourceService, verifiedRecords, writeJson, publish }); // NEW
    /** Use the same city catalog for module resolution and the identity reference city. */ // NEW
    async function cities() { return { ok: true, cities: (await listCities()).map(cityRecord).filter(city => city && city.cityId) }; } // NEW
    async function getReferenceCity() { // NEW
        const session = own(), records = await verifiedRecords(session.identityId, path.join(identities.metadataRoot(session.identityId), 'reference-city')); // NEW
        const record = records.filter(record => record.payload.kind === 'reference-city').at(-1); // NEW
        return { ok: true, city: record ? cityRecord(record.payload.city) : null }; // NEW
    } // NEW
    /** Signed profile records live outside authentication events and synchronize with metadata. */ // NEW
    async function setReferenceCity(input = {}) { // NEW
        const session = own(); // NEW
        const matches = input.cityId == null ? [] : (await cities()).cities.filter(city => city.cityId === String(input.cityId)); // NEW
        if (input.cityId != null && matches.length !== 1) throw new Error('Choose a city with usable coordinates.'); // NEW
        const city = matches[0] || null, record = await identities.signAction('reference-city', { city }); // NEW
        if (record.payload.identityId !== session.identityId) throw new Error('The active identity changed before the reference city could be saved.'); // NEW
        await writeJson(path.join(identities.metadataRoot(session.identityId), 'reference-city', record.payload.id + '.json'), record); // NEW
        return { ok: true, city }; // NEW
    } // NEW
    async function configureLocalFolder(folder) { // NEW
        const resolved = path.resolve(folder), stat = await fs.stat(resolved); // NEW
        if (!stat.isDirectory()) throw new Error('Choose a local garden projects folder.'); // NEW
        if (!setLocalFolder) throw new Error('Folder settings are unavailable.'); // NEW
        await setLocalFolder(resolved); return { ok: true, folder: resolved }; // NEW
    } // NEW
    /** A direct-folder scan stays available without an unlocked identity or transport. */ // NEW
    async function listLocal() { // NEW
        const folder = getLocalFolder(), gardens = []; // NEW
        if (!folder) return { ok: true, folder, gardens }; // NEW
        const entries = await fs.readdir(folder, { withFileTypes: true }).catch(error => { if (error.code === 'ENOENT') return []; throw error; }); // NEW
        const cityList = await cities().then(result => result.cities).catch(() => null); // CHANGE
        for (const entry of entries.filter(entry => entry.isFile() && /\.drawio$/i.test(entry.name) && !/\.sync-conflict-/i.test(entry.name))) { // NEW
            const filename = path.join(folder, entry.name), garden = { name: entry.name.replace(/\.drawio$/i, ''), path: filename, folderPath: folder, source: 'local', classification: 'private', shared: false, available: true, conflicts: [], seeds: 0, userCount: null, moduleCities: [] }; // NEW
            try { // NEW
                await validateLocalPath(filename); // NEW
                Object.assign(garden, projectSummary(await fs.readFile(filename, 'utf8'), cityList || [], false)); // CHANGE
            } catch (error) { garden.available = false; garden.reason = error.message; } // NEW
            gardens.push(garden); // NEW
        } // NEW
        gardens.sort((a, b) => a.name.localeCompare(b.name)); return { ok: true, folder, gardens }; // NEW
    } // NEW
    async function list() {
        const session = own();
        await lifecycle.processLifecycle(session.identityId); // NEW
        const errors = [], entries = await catalog(session.identityId, errors), daemon = await identities.transport(session.identityId); // CHANGE
        const registered = await daemon.listCanvases();
        const cityList = await cities().then(result => result.cities).catch(() => null); // CHANGE
        const reference = await getReferenceCity().then(result => result.city).catch(() => null); // NEW
        const result = [];
        for (const entry of entries) {
            const retirement = await lifecycle.lifecycle(session.identityId, entry.diagramId); // NEW
            if (retirement.state !== 'active' || retirement.pending) continue; // NEW
            let source, local, summary = entry.summary || null, stale = true, metadataError = ''; // CHANGE
            try { // NEW
                source = await localSource(session.identityId, entry.diagramId); // CHANGE
                if (retirement.record?.operation === 'restore' && source?.lifecycleStatus) continue; // NEW: failed restoration stays reviewable in Trash.
                const localList = source?.legacy ? await (await legacyService()).listCanvases() : registered; // CHANGE
                local = localList.find(canvas => canvas.shareId === entry.shareId);
                const replacement = localList.find(canvas => canvas.protocolVersion === 2 && canvas.replacesShareId === entry.shareId && canvas.diagramId === entry.diagramId && canvas.available); // NEW: an admin upgrade keeps this identity's library entry attached to the replacement.
                if (replacement) { const descriptor = await (source?.legacy ? await legacyService() : daemon).libraryDescriptor(replacement.shareId); const updated = { ...entry, ...descriptor, name: entry.name, workerId: entry.workerId }; await publish(updated); Object.assign(entry, updated); local = replacement; } // NEW
 // CHANGE
                if (local?.available) { // NEW
                    const descriptor = await (await sourceService(session.identityId, source)).libraryDescriptor(entry.shareId); // NEW
                    if (descriptor.coordinatorDeviceId !== entry.coordinatorDeviceId) { Object.assign(entry, descriptor, { name: entry.name }); await publish(entry); } // NEW
                    const knownCities = new Map((cityList || []).map(city => [city.cityId, city])); // NEW
                    const cachedCities = new Map((summary?.moduleCities || []).filter(city => !knownCities.has(city.cityId)).map(city => [city.cityId, city])); // NEW
                    const fresh = projectSummary(await fs.readFile(local.path, 'utf8'), [...knownCities.values(), ...cachedCities.values()], true, Date.now(), entry.workerId); // CHANGE: retain signed coordinates absent from this device's city catalog and revalidate the linked user's access.
                    stale = cityList == null || fresh.moduleCities.some(city => cachedCities.has(city.cityId)); // NEW
                    if (stale && summary?.updatedAt) fresh.updatedAt = summary.updatedAt; // NEW
                    const comparable = value => JSON.stringify(value && { ...value, updatedAt: 0 }); // NEW
                    if (comparable(fresh) !== comparable(summary) || entry.starterPending === true && fresh.gardenModuleCount > 0) { // CHANGE
                        summary = fresh; // NEW
                        try { await publish({ ...entry, summary, shared: summary.classification === 'shared', starterPending: entry.starterPending === true && fresh.gardenModuleCount === 0 }); } // CHANGE
                        catch (error) { metadataError = 'Summary could not be saved: ' + error.message; } // NEW
                    } // NEW
                } // NEW
            } catch (error) { metadataError = error.message; } // NEW
            if (!source?.departing && (summary?.accessible === false || local?.state === 'revoked')) continue; // CHANGE: a pending departure remains visible until its signed acknowledgement.
            const classification = summary?.classification || (entry.shared ? 'shared' : 'private'); // NEW
            result.push({ ...entry, summary, classification, shared: classification === 'shared', starterPending: entry.starterPending === true && !summary?.gardenModuleCount, source: 'library', userCount: summary?.userCount ?? null, moduleCities: summary?.moduleCities || [], gardenModuleCount: summary?.gardenModuleCount ?? null, summaryUpdatedAt: summary?.updatedAt || null, metadataStale: stale, metadataError, distanceKm: averageDistance(reference, summary?.moduleCities), seeds: local?.seeds ?? null, path: local?.path || null, folderPath: local?.folderPath || null, available: !!local?.available, state: local?.state || 'not-downloaded', reason: local?.reason || (!local?.available ? 'Download from another approved device.' : ''), conflicts: local?.conflicts || [], keepOffline: !!source?.keepOffline }); // CHANGE
            result.at(-1).departing = !!source?.departing; // NEW
            Object.assign(result.at(-1), await projectNaming.describe(session.identityId, entry).catch(error => ({ canRename: false, canEditSuffix: false, namingError: error.message }))); // NEW
        }
        result.sort((a, b) => a.name.localeCompare(b.name) || a.diagramId.localeCompare(b.diagramId));
        return { ok: true, gardens: result, errors }; // CHANGE
    }
    async function getEntry(diagramId) {
        const session = own(), entry = (await catalog(session.identityId)).find(item => item.diagramId === diagramId);
        if (!entry) throw new Error('Garden is not in this identity library.');
        await lifecycle.assertActive(session.identityId, diagramId); // NEW
        return entry;
    }
    /** Import only a saved diagram that explicitly links this authenticated identity. */
    async function importCurrent(input) {
        const session = own(); await identities.requireSession();
        const xml = await fs.readFile(input.path, 'utf8'), diagram = inspectDiagram(xml);
        const retirement = input.diagramId ? await lifecycle.lifecycle(session.identityId, input.diagramId) : { state: 'active' }; // CHANGE
        if (retirement.state !== 'left' && input.diagramId) await lifecycle.assertActive(session.identityId, input.diagramId); // NEW
        const user = (diagram.store.users || []).find(entry => entry.id === input.userId && entry.portableIdentityId === session.identityId && !entry.disabled);
        if (!user || !hasCanvasAccess(diagram, user.id)) throw new Error('Log in to the diagram and link your identity before importing it.');
        const legacy = await legacyService(), legacyList = await legacy.listCanvases();
        const identityDaemon = await identities.transport(session.identityId), identityList = await identityDaemon.listCanvases(); // NEW
        const matchesPath = entry => entry.available && !entry.pending && !entry.revoked && path.resolve(entry.path) === path.resolve(input.path); // NEW
        const legacyExisting = legacyList.find(matchesPath), identityExisting = identityList.find(matchesPath), existing = legacyExisting || identityExisting; // CHANGE
        if (retirement.state === 'left' && (!existing?.rejoined || existing.diagramId !== input.diagramId)) throw new Error('Rejoin through a fresh approved invitation before adding this project again.'); // NEW
        let daemon, managed, descriptor;
        if (existing) { daemon = legacyExisting ? legacy : identityDaemon; descriptor = await daemon.libraryDescriptor(existing.shareId); } // CHANGE
        else {
            daemon = await identities.transport(session.identityId);
            daemon.setContext(virtualCaller(session.identityId), { diagramPath: input.path, diagramId: input.diagramId, userId: user.id });
            managed = await daemon.setupCanvas(virtualCaller(session.identityId), { diagramPath: input.path, diagramId: input.diagramId, xml, protocolVersion: 2 }); // CHANGE: newly managed imports use the local-projection transport.
            descriptor = await daemon.libraryDescriptor(managed.shareId);
        }
        const entry = { ...descriptor, workerId: user.id, shared: !!existing, ownerIdentityId: session.identityId };
        await setLocalSource(session.identityId, entry.diagramId, { legacy: !!legacyExisting, keepOffline: true }); // CHANGE
        await publish(entry);
        if (retirement.state === 'left') await lifecycle.completeRejoin(entry); // NEW
        return { ok: true, entry, path: managed?.diagramPath || input.path };
    }
    async function create(input = {}) {
        const session = own(); await identities.requireSession();
        const diagramId = uuid(), workerId = uuid();
        const name = naming.projectName(input.name || 'New garden'); // CHANGE
        if (!name) throw new Error('Enter a garden name.');
        const store = { schemaVersion: 1, usersEnabled: true, users: [{ id: workerId, name: session.username, portableIdentityId: session.identityId, admin: true, disabled: false, pinSalt: '', pinHash: '', createdAt: Date.now() }], pendingUsers: [], invites: [], accessRequests: [], accessMessages: [] };
        const xml = '<mxGraphModel><root><mxCell id="0"/><object id="1" trellis_users_diagram_id="' + diagramId + '" trellis_history_id="' + diagramId + '" trellis_users_json="' + escape(JSON.stringify(store)) + '"><mxCell parent="0"/></object></root></mxGraphModel>';
        const daemon = await identities.transport(session.identityId);
        daemon.setContext(virtualCaller(session.identityId), { diagramId, userId: workerId });
        const namedXml = withProjectName(xml, name); // NEW
        const managed = await daemon.setupCanvas(virtualCaller(session.identityId), { diagramId, xml: namedXml, protocolVersion: 2, filename: naming.filename(name) }); // CHANGE
        const entry = { ...(await daemon.libraryDescriptor(managed.shareId)), name, projectName: name, workerId, shared: false, ownerIdentityId: session.identityId, starterPending: true, summary: projectSummary(namedXml, [], true) }; // CHANGE
        await publish(entry); await setLocalSource(session.identityId, diagramId, { keepOffline: true });
        return { ok: true, entry, path: managed.diagramPath };
    }
    /** Finish starter setup only for the saved, registered project owned by this library entry. */ // NEW
    async function completeStarter(input = {}) { // NEW
        const session = own(); await identities.requireSession(); // NEW
        const xml = await fs.readFile(input.path, 'utf8'), initial = projectSummary(xml, [], true); // NEW
        const entry = await getEntry(initial.diagramId); // NEW
        const source = await localSource(session.identityId, entry.diagramId), daemon = await sourceService(session.identityId, source); // NEW
        const local = (await daemon.listCanvases()).find(canvas => canvas.shareId === entry.shareId); // NEW
        const canonical = filename => process.platform === 'win32' ? path.resolve(filename).toLowerCase() : path.resolve(filename); // NEW
        if (!local?.available || canonical(local.path) !== canonical(input.path)) throw new Error('Finish setup for the registered garden project.'); // NEW
        const cityList = await cities().then(result => result.cities).catch(() => entry.summary?.moduleCities || []); // NEW
        const summary = projectSummary(xml, cityList, true, Date.now(), entry.workerId); // NEW
        if (!summary.accessible || !summary.gardenModuleCount) throw new Error('Save the starter garden before finishing project setup.'); // NEW
        await publish({ ...entry, starterPending: false, summary, shared: summary.classification === 'shared' }); // NEW
        return { ok: true }; // NEW
    } // NEW
    async function rename(input) {
        return projectNaming.rename(input); // CHANGE: main-process administrator and identity checks precede the shared edit.
    }
    /** Copies retain attribution but gain fresh document/cell/task identities. */
    async function duplicate(input) {
        const session = own(), entry = await getEntry(input.diagramId);
        const local = (await list()).gardens.find(item => item.diagramId === entry.diagramId);
        if (!local.available) throw new Error('Download the garden before duplicating it.');
        const xml = await fs.readFile(local.path, 'utf8'), document = diagramDocument(xml), diagramId = uuid();
        for (const page of document.pages) {
            const objects = Array.from(page.doc.getElementsByTagName('*')), replacement = new Map(); // CHANGE: xmldom collections are array-like, not iterables.
            for (const node of objects) if (node.hasAttribute('id') && !['0', '1'].includes(node.getAttribute('id'))) replacement.set(node.getAttribute('id'), uuid());
            for (const node of objects) {
                for (const attr of Array.from(node.attributes)) { // CHANGE
                    if (replacement.has(attr.value)) node.setAttribute(attr.name, replacement.get(attr.value));
                    else if (['trellis_task_sync_id', 'trellis_field_object_id'].includes(attr.name)) node.setAttribute(attr.name, uuid());
                    else if (['trellis_field_versions_json', 'trellis_field_acknowledgments_json'].includes(attr.name)) node.removeAttribute(attr.name);
                    else if (attr.name === 'linkedTo') node.setAttribute(attr.name, attr.value.split(',').map(value => replacement.get(value.trim()) || value.trim()).join(',')); // NEW: links follow copied object identities.
                    else if (attr.name === 'task_assignee_role_ids_json') node.setAttribute(attr.name, JSON.stringify(JSON.parse(attr.value).map(value => replacement.get(value) || value))); // NEW
                }
                if (node.hasAttribute('trellis_users_json')) {
                    const store = JSON.parse(node.getAttribute('trellis_users_json'));
                    for (const user of store.users || []) user.admin = user.id === entry.workerId;
                    node.setAttribute('trellis_users_json', JSON.stringify(store));
                    node.setAttribute('trellis_users_diagram_id', diagramId); node.setAttribute('trellis_history_id', diagramId);
                }
            }
        }
        const daemon = await identities.transport(session.identityId);
        daemon.setContext(virtualCaller(session.identityId), { diagramId, userId: entry.workerId });
        const copyName = naming.projectName(input.name || Array.from(local.projectName || entry.projectName || entry.name).slice(0, 115).join('') + ' copy'); // NEW
        const managed = await daemon.setupCanvas(virtualCaller(session.identityId), { diagramId, xml: withProjectName(document.serialize(), copyName), protocolVersion: 2, assetBasePath: path.dirname(local.path), filename: naming.filename(copyName) }); // CHANGE
        const copy = { ...(await daemon.libraryDescriptor(managed.shareId)), name: copyName, projectName: copyName, workerId: entry.workerId, shared: false, ownerIdentityId: session.identityId }; // CHANGE
        await publish(copy); await setLocalSource(session.identityId, diagramId, { keepOffline: true });
        return { ok: true, entry: copy, path: managed.diagramPath };
    }
    async function download(input) {
        const session = own(), entry = await getEntry(input.diagramId), current = await identities.requireSession();
        const daemon = await identities.transport(session.identityId), device = current.devices.find(item => item.id === session.deviceId);
        const record = await identities.signAction('garden-download', { diagramId: entry.diagramId, shareId: entry.shareId, workerId: entry.workerId, device });
        await writeJson(path.join(identities.metadataRoot(session.identityId), 'downloads', record.payload.id + '.json'), record);
        const result = await daemon.registerLibraryDownload(entry);
        await setLocalSource(session.identityId, entry.diagramId, { keepOffline: !!input.keepOffline });
        return result;
    }
    async function setOffline(input) {
        const session = own(), entry = await getEntry(input.diagramId), local = await localSource(session.identityId, entry.diagramId);
        await setLocalSource(session.identityId, entry.diagramId, { ...local, keepOffline: !!input.enabled });
        if (input.enabled && !(await list()).gardens.find(g => g.diagramId === entry.diagramId).available) return download({ diagramId: entry.diagramId, keepOffline: true });
        return { ok: true };
    }
    async function removeLocal(input) {
        const session = own(), entry = await getEntry(input.diagramId), local = await localSource(session.identityId, entry.diagramId);
        const daemon = await sourceService(session.identityId, local);
        await daemon.removeLibraryDownload({ shareId: entry.shareId, confirmLoss: input.confirmLoss });
        await setLocalSource(session.identityId, entry.diagramId, { ...local, keepOffline: false });
        return { ok: true };
    }
    /** Signed self-device requests cannot approve somebody else's shared access. */
    async function processDownloads(identityId) {
        await lifecycle.processLifecycle(identityId); // NEW
        const entries = await catalog(identityId);
        for (const record of await verifiedRecords(identityId, path.join(identities.metadataRoot(identityId), 'downloads'))) {
            const request = record.payload, entry = entries.find(item => item.diagramId === request.diagramId && item.workerId === request.workerId);
            if (!entry || request.kind !== 'garden-download') continue;
            const retirement = await lifecycle.lifecycle(identityId, entry.diagramId); // NEW
            if (retirement.state !== 'active' || retirement.pending) continue; // NEW
            const local = await localSource(identityId, entry.diagramId);
            if (!local) continue;
            const current = await identities.state(identityId), device = current.devices.find(item => item.id === request.device?.id);
            if (!device || device.kind !== 'desktop' || p.canonical(device) !== p.canonical(request.device)) continue;
            const daemon = await sourceService(identityId, local);
            try { await daemon.approveLibraryDevice({ shareId: entry.shareId, userId: entry.workerId, deviceId: device.syncthingId, publicKey: device.sharingPublicKey }); }
            catch (err) { if (!/needs approval/.test(err.message)) throw err; }
        }
        for (const entry of entries) { const retirement = await lifecycle.lifecycle(identityId, entry.diagramId); if (retirement.state === 'active' && !retirement.pending) await projectNaming.reconcile(identityId, [entry]); } // CHANGE
    }
    return { list, create, completeStarter, importCurrent, rename, setSuffix: projectNaming.setSuffix, duplicate, download, setOffline, removeLocal, getEntry, catalog, verifiedRecords, processDownloads, cities, getReferenceCity, setReferenceCity, listLocal, configureLocalFolder, ...lifecycle }; // CHANGE
}
