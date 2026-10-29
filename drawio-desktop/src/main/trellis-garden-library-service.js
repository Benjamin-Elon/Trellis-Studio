import { saveCache } from './trellis-save-cache.js'; // NEW
import { REVISION, listBounded, readJson as readBoundedJson, readBounded, LIMITS } from './trellis-input-policy.js'; // NEW
/** Identity-scoped catalog orchestration over the existing managed-canvas service. // NEW */
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { digest, inspectDiagram, diagramDocument, hasCanvasAccess } from './trellis-share-protocol.js';
import { cityRecord, projectSummary, nearestDistance } from './trellis-project-summary.js'; // CHANGE
import { projectPeople } from './trellis-project-people.js'; // NEW
import { createGardenLifecycle } from './trellis-garden-lifecycle.js'; // NEW
import { createLibraryNaming } from './trellis-library-naming.js'; // NEW
import { naming, withProjectName } from './trellis-project-naming.js'; // NEW
import { referenceCore as references } from './trellis-reference-database.js'; // NEW
import { referenceEditor } from './trellis-reference-policy.js'; // NEW
import { projectLifecycle } from './trellis-project-trash.js'; // NEW
const p = globalThis.TrellisIdentityProtocol;
const uuid = () => crypto.randomUUID();
const safe = value => { if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(value)) throw new Error('Invalid garden identifier.'); return value; };
const escape = value => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
async function readJson(filename, budget) { return await readBoundedJson(filename, LIMITS.metadata, budget) /* CHANGE: bound received JSON before parsing. */; }
async function writeJson(filename, value) { await fs.mkdir(path.dirname(filename), { recursive: true }); await fs.writeFile(filename, JSON.stringify(value), { flag: 'wx', mode: 0o600 }); }

export function createGardenLibraryService({ identities, legacyService, listLegacyLocalCanvases = async () => [], listCities = async () => [], getLocalFolder = () => '', getTrashRoot = () => path.join(getLocalFolder(), '.trellis-trash'), beforeRetire, setLocalFolder, validateLocalPath = async () => {}, validateStandalonePath = validateLocalPath }) { // CHANGE
    const privatePath = identityId => path.join(identities.identityRoot(identityId), 'local-gardens');
    const catalogPath = identityId => path.join(identities.metadataRoot(identityId), 'catalog');
    const own = () => { const session = identities.session(); if (!session) throw new Error('Log in to Garden library first.'); return session; };
    const virtualCaller = identityId => 'identity-library:' + identityId;
    const summaries = new Map(); // NEW: process-local observations; authorization still uses current signed identity state.
    let summaryLogin = ''; // NEW
    identities.onChange?.(() => { const session = identities.session(), key = session ? session.identityId + ':' + session.generation : ''; if (summaryLogin !== key) { summaries.clear(); summaryLogin = key; } }); // NEW
    async function verifiedRecords(identityId, directory, errors, current) { // CHANGE: reuse one verified trust state within a listing.
        current ||= await identities.state(identityId); // CHANGE
        const keys = new Map(current.records.filter(record => record.payload.device).map(record => [record.payload.device.id, record.payload.device.publicKey]));
        const names = await listBounded(directory).catch(err => { if (err.code === 'ENOENT') return []; throw err; });
        const records = [], budget = { used: 0, maximum: LIMITS.replay }; // CHANGE
        for (const name of names.filter(name => /^[A-Za-z0-9_-]+\.json$/.test(name))) {
            try { // NEW
                const record = await readJson(path.join(directory, name), budget), data = record.payload;
                const key = keys.get(data?.author), token = 'library-signature:' + REVISION + ':' + digest(identityId + ':' + key + ':' + JSON.stringify(record)); // NEW
                if (!data || data.identityId !== identityId || !key || saveCache.get(token) !== true && !await p.verify(record, key)) throw new Error('Library signature is invalid.'); // CHANGE
                saveCache.set(token, true, 8); // NEW: changed bytes or trust keys always require verification.
                records.push(record);
            } catch (error) { if (!errors || error.code === 'REPLAY_LIMIT') throw error; errors.push('Project metadata could not be verified: ' + name); } // NEW
        }
        return records.sort((a, b) => a.payload.time - b.payload.time || (a.payload.id < b.payload.id ? -1 : 1));
    }
    async function catalog(identityId, errors, current, includeLocalOnly = false) { // CHANGE
        const entries = new Map();
        for (const record of await verifiedRecords(identityId, catalogPath(identityId), errors, current)) { // CHANGE
            try { // NEW
                const data = record.payload;
                if (data.kind !== 'garden-record' || !data.entry) throw new Error('Unsupported library record.');
                if (typeof data.entry.name !== 'string' || !data.entry.name.trim()) throw new Error('Invalid project name in library metadata.'); // NEW
                safe(data.entry.diagramId); safe(data.entry.shareId);
                const localOnly = data.entry.protocolVersion === undefined || [1, 2].includes(data.entry.protocolVersion); // CHANGE
                if (!localOnly && data.entry.protocolVersion !== 3) { // CHANGE
                    entries.delete(data.entry.diagramId); // CHANGE: a newer unsupported record cannot resurrect an older descriptor.
                    errors?.push('Unsupported project metadata: ' + record.payload.id); continue; // CHANGE
                } // CHANGE
                entries.set(data.entry.diagramId, localOnly ? { ...data.entry, localOnly: true } : data.entry); // CHANGE
            } catch (error) { if (!errors) throw error; errors.push('Unsupported project metadata: ' + record.payload.id); } // NEW
        }
        return [...entries.values()].filter(entry => includeLocalOnly || !entry.localOnly); // CHANGE
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
        const entries = await listBounded(folder, { withFileTypes: true }).catch(error => { if (error.code === 'ENOENT') return []; throw error; }); // NEW
        const cityList = await cities().then(result => result.cities).catch(() => null); // CHANGE
        for (const entry of entries.filter(entry => entry.isFile() && /\.drawio$/i.test(entry.name) && !/\.sync-conflict-/i.test(entry.name))) { // NEW
            const filename = path.join(folder, entry.name), garden = { name: entry.name.replace(/\.drawio$/i, ''), path: filename, folderPath: folder, source: 'local', classification: 'private', shared: false, available: true, seeds: 0, userCount: null, moduleCities: [] }; // CHANGE
            try { // NEW
                await validateLocalPath(filename); // NEW
                const { members, ...summary } = projectSummary(await readBounded(filename, LIMITS.diagram) /* CHANGE */, cityList || [], false); Object.assign(garden, summary); // CHANGE: portable rosters remain in the main process.
            } catch (error) { garden.available = false; garden.reason = error.message; } // NEW
            gardens.push(garden); // NEW
        } // NEW
        gardens.sort((a, b) => a.name.localeCompare(b.name)); return { ok: true, folder, gardens }; // NEW
    } // NEW
    async function list(input = {}) { // CHANGE: targeted mutation results reuse the same read-only path.
        const session = own();
        const current = await identities.state(session.identityId), errors = [], entries = await catalog(session.identityId, errors, current), daemon = await identities.transport(session.identityId); // CHANGE: Garden Projects lists current protocols without changing retained files or metadata.
        const [registered, retirements, suffixes] = await Promise.all([daemon.listCanvases(), lifecycle.lifecycleRecords(session.identityId, current), projectNaming.suffixes(session.identityId, current)]); // NEW
        errors.push(...(daemon.getRegistrationIssues?.() || []).map(issue => 'Sharing registration: ' + issue.reason)); // CHANGE
        let legacy, legacyList; // NEW: each transport registry is scanned at most once per view.
        const cityList = await cities().then(result => result.cities).catch(() => null); // CHANGE
        const referenceRecords = await verifiedRecords(session.identityId, path.join(identities.metadataRoot(session.identityId), 'reference-city'), [], current); // NEW
        const reference = cityRecord(referenceRecords.filter(record => record.payload.kind === 'reference-city').at(-1)?.payload.city); // CHANGE
        const result = [];
        if (input.diagramId !== undefined) safe(input.diagramId); // NEW
        for (const entry of entries.filter(entry => input.diagramId === undefined || entry.diagramId === input.diagramId)) {
            const retirement = projectLifecycle(retirements, entry.diagramId); // CHANGE
            if (retirement.state !== 'active' || retirement.pending) continue; // NEW
            const summaryKey = session.identityId + ':' + entry.diagramId; // NEW
            let source, local, diagram, summary = summaries.get(summaryKey) || entry.summary || null, stale = true, metadataError = ''; // CHANGE
            try { // NEW
                source = await localSource(session.identityId, entry.diagramId); // CHANGE
                if (retirement.record?.operation === 'restore' && source?.lifecycleStatus) continue; // NEW: failed restoration stays reviewable in Trash.
                if (source?.legacy && !legacyList) { legacy = await legacyService(); legacyList = await legacy.listCanvases(); } // NEW
                const localList = source?.legacy ? legacyList : registered; // CHANGE
                local = localList.find(canvas => canvas.shareId === entry.shareId); // CHANGE
                if (local?.localOnly) continue; // CHANGE: an old registration cannot become a visible project through a current catalog descriptor.
                const replacement = localList.find(canvas => canvas.protocolVersion === 3 && canvas.replacesShareId === entry.shareId && canvas.diagramId === entry.diagramId && canvas.available); // NEW: coordinator recovery keeps the library entry attached to the replacement.
                if (replacement) { Object.assign(entry, await (source?.legacy ? legacy : daemon).libraryDescriptor(replacement.shareId), { name: entry.name }); local = replacement; } // CHANGE: observing a replacement never publishes catalog records.
 // CHANGE
                if (local?.available) { // NEW
                    const descriptor = await (source?.legacy ? legacy : daemon).libraryDescriptor(entry.shareId); // CHANGE
                    if (descriptor.coordinatorDeviceId !== entry.coordinatorDeviceId) Object.assign(entry, descriptor, { name: entry.name }); // CHANGE
                    const knownCities = new Map((cityList || []).map(city => [city.cityId, city])); // NEW
                    const cachedCities = new Map((summary?.moduleCities || []).filter(city => !knownCities.has(city.cityId)).map(city => [city.cityId, city])); // NEW
                    diagram = inspectDiagram(await readBounded(local.path, LIMITS.diagram) /* CHANGE */); // NEW: summary and naming share one XML parse.
                    const fresh = projectSummary(diagram, [...knownCities.values(), ...cachedCities.values()], true, Date.now(), entry.workerId); // CHANGE
                    stale = cityList == null || fresh.moduleCities.some(city => cachedCities.has(city.cityId)); // NEW
                    if (stale && summary?.updatedAt) fresh.updatedAt = summary.updatedAt; // NEW
                    const comparable = value => JSON.stringify(value && { ...value, updatedAt: 0 }); // NEW
                    if (comparable(fresh) !== comparable(summary)) summary = fresh; // CHANGE
                    summaries.set(summaryKey, summary); // NEW: durable publication belongs to background maintenance.
                } // NEW
            } catch (error) { metadataError = error.message; } // CHANGE
            if (!source?.departing && (summary?.accessible === false || local?.state === 'revoked')) continue; // CHANGE: a pending departure remains visible until its signed acknowledgement.
            const classification = summary?.classification || (entry.shared ? 'shared' : 'private'); // NEW
            const transport = source?.legacy ? legacy : daemon; // CHANGE
            const descriptor = await transport?.libraryDescriptor(entry.shareId).catch(() => entry); // NEW: current approved devices supersede an older catalog descriptor.
            const members = summary?.members?.map(member => ({ ...member, devices: (descriptor?.members || []).filter(device => device.userId === member.userId) })); // CHANGE
            const people = projectPeople(members, session.identityId, transport?.memberConnections?.(), summary?.userCount ?? null); // CHANGE
            const { members: privateMembers, ...publicSummary } = summary || {}; // NEW
            result.push({ ...entry, summary, people, classification, shared: classification === 'shared', starterPending: entry.starterPending === true && !summary?.gardenModuleCount, source: 'library', userCount: summary?.userCount ?? null, moduleCities: summary?.moduleCities || [], gardenModuleCount: summary?.gardenModuleCount ?? null, locationsComplete: summary?.locationsComplete === true, summaryUpdatedAt: summary?.updatedAt || null, metadataStale: stale, metadataError, distanceKm: nearestDistance(reference, summary?.moduleCities), seeds: local?.seeds ?? null, path: local?.path || null, folderPath: local?.folderPath || null, available: !!local?.available, state: local?.state || 'not-downloaded', reason: local?.reason || (!local?.available ? 'Download from another approved device.' : ''), keepOffline: !!source?.keepOffline }); // CHANGE
            result.at(-1).summary = summary ? publicSummary : null; result.at(-1).departing = !!source?.departing; // CHANGE
            Object.assign(result.at(-1), projectNaming.inspect(session.identityId, entry, local, diagram, suffixes.get(entry.diagramId))); // CHANGE
        }
        if (identities.session()?.identityId !== session.identityId || identities.session()?.generation !== session.generation) throw new Error('The active identity changed while listing projects.'); // NEW
        result.sort((a, b) => a.name.localeCompare(b.name) || a.diagramId.localeCompare(b.diagramId));
        return { ok: true, gardens: result, errors }; // CHANGE
    }
    async function getEntry(diagramId) {
        const session = own(), entry = (await catalog(session.identityId, undefined, undefined, true)).find(item => item.diagramId === diagramId); // CHANGE
        if (!entry) throw new Error('Garden is not in this identity library.');
        if (entry.localOnly) throw new Error('Sharing is disabled for this old project. Open and save its local file instead.'); // CHANGE
        await lifecycle.assertActive(session.identityId, diagramId); // NEW
        return entry;
    }
    /** Import only a saved diagram that explicitly links this authenticated identity. */
    async function importCurrent(input) {
        const session = own(); await identities.requireSession();
        const xml = await readBounded(input.path, LIMITS.diagram) /* CHANGE */, diagram = inspectDiagram(xml);
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
        if (existing?.localOnly) throw new Error('Sharing is disabled for this old project. Open and save its local file instead.'); // CHANGE
        if (existing) { daemon = legacyExisting ? legacy : identityDaemon; descriptor = await daemon.libraryDescriptor(existing.shareId); } // CHANGE
        else {
            daemon = await identities.transport(session.identityId);
            daemon.setContext(virtualCaller(session.identityId), { diagramPath: input.path, diagramId: input.diagramId, userId: user.id });
            managed = await daemon.setupCanvas(virtualCaller(session.identityId), { diagramPath: input.path, diagramId: input.diagramId, xml, protocolVersion: 3 }); // CHANGE: newly managed imports use the local-projection transport.
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
        const xml = '<mxfile><diagram id="' + uuid() + '" name="Page-1">' + '<mxGraphModel><root><mxCell id="0"/><object id="1" trellis_users_diagram_id="' + diagramId + '" trellis_history_id="' + diagramId + '" trellis_users_json="' + escape(JSON.stringify(store)) + '"><mxCell parent="0"/></object></root></mxGraphModel>' + '</diagram></mxfile>'; // CHANGE: stable page identity precedes accepted policy, editor loading and the first save.
        const daemon = await identities.transport(session.identityId);
        daemon.setContext(virtualCaller(session.identityId), { diagramId, userId: workerId });
        const namedXml = withProjectName(xml, name); // NEW
        const managed = await daemon.setupCanvas(virtualCaller(session.identityId), { diagramId, xml: namedXml, protocolVersion: 3, filename: naming.filename(name) }); // CHANGE
        const entry = { ...(await daemon.libraryDescriptor(managed.shareId)), name, projectName: name, workerId, shared: false, ownerIdentityId: session.identityId, starterPending: true, summary: projectSummary(namedXml, [], true) }; // CHANGE
        await publish(entry); await setLocalSource(session.identityId, diagramId, { keepOffline: true });
        return { ok: true, entry, path: managed.diagramPath };
    }
    /** Finish starter setup only for the saved, registered project owned by this library entry. */ // NEW
    async function completeStarter(input = {}) { // NEW
        const session = own(); await identities.requireSession(); // NEW
        const xml = await readBounded(input.path, LIMITS.diagram) /* CHANGE */, initial = projectSummary(xml, [], true); // NEW
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
    async function rename(input, callerId) {
        return projectNaming.rename(input, callerId); // CHANGE: main-process administrator and identity checks precede the shared edit.
    }
    /** Copies retain attribution but gain fresh document/cell/task identities. */
    async function duplicate(input) {
        const session = own(), entry = await getEntry(input.diagramId);
        const local = (await list()).gardens.find(item => item.diagramId === entry.diagramId);
        if (!local.available) throw new Error('Download the garden before duplicating it.');
        const xml = await readBounded(local.path, LIMITS.diagram) /* CHANGE */, document = diagramDocument(xml), diagramId = uuid();
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
        const managed = await daemon.setupCanvas(virtualCaller(session.identityId), { diagramId, xml: withProjectName(document.serialize(), copyName), protocolVersion: 3, assetBasePath: path.dirname(local.path), filename: naming.filename(copyName) }); // CHANGE
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
        const catalogEntries = await catalog(identityId), entries = []; // CHANGE
        const registries = new Map(); // NEW: upgrades and coordinator changes reconcile during maintenance, never during reads.
        for (const entry of catalogEntries) { // CHANGE
            const source = await localSource(identityId, entry.diagramId), daemon = await sourceService(identityId, source); // NEW
            if (!registries.has(daemon)) registries.set(daemon, await daemon.listCanvases()); // NEW
            const canvases = registries.get(daemon); // CHANGE
            if (canvases.some(canvas => canvas.shareId === entry.shareId && canvas.localOnly)) continue; // CHANGE
            entries.push(entry); // CHANGE
            const replacement = canvases.find(canvas => canvas.protocolVersion === 3 && canvas.replacesShareId === entry.shareId && canvas.diagramId === entry.diagramId && canvas.available); // CHANGE
            const descriptor = await daemon.libraryDescriptor(replacement?.shareId || entry.shareId).catch(() => null); // NEW
            if (descriptor && (replacement || descriptor.coordinatorDeviceId !== entry.coordinatorDeviceId)) { Object.assign(entry, descriptor, { name: entry.name }); if (identities.session()?.identityId === identityId) await publish(entry); } // NEW
        } // NEW
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
        const records = await lifecycle.lifecycleRecords(identityId), active = entries.filter(entry => { const state = projectLifecycle(records, entry.diagramId); return state.state === 'active' && !state.pending; }); // NEW
        await projectNaming.reconcile(identityId, active, registries); // CHANGE: batch naming once, outside the listing path.
        if (identities.session()?.identityId === identityId) for (const entry of active) { // NEW
            const summary = summaries.get(identityId + ':' + entry.diagramId); // NEW
            if (summary && JSON.stringify({ ...summary, updatedAt: 0 }) !== JSON.stringify({ ...entry.summary, updatedAt: 0 })) await publish({ ...entry, summary, shared: summary.classification === 'shared', starterPending: entry.starterPending === true && !summary.gardenModuleCount }); // NEW
        } // NEW
    }
    /** Internal community integration resolves only signed library entries. */ // NEW
    async function communitySource(identityId, diagramId) { // NEW
        const entry = (await catalog(identityId)).find(e => e.diagramId === diagramId); // NEW
        if (!entry) return null; // NEW
        return { entry, daemon: await sourceService(identityId, await localSource(identityId, diagramId)) }; // NEW
    } // NEW
    /** The community service verifies coordinator authority before calling this internal method. */ // NEW
    async function acceptCommunityGrant(input) { // NEW
        const session = own(); await identities.requireSession(); // NEW
        const existing = (await catalog(session.identityId)).find(e => e.diagramId === input.descriptor.diagramId); // NEW
        if (existing?.communityGrantId !== input.requestId && !existing?.communityGrantIds?.includes(input.requestId)) { // CHANGE: older completed requests cannot replace a newer entitlement on replay.
            const state = await lifecycle.lifecycle(session.identityId, input.descriptor.diagramId); // NEW
            if (!['active', 'left'].includes(state.state)) throw new Error('Restore the garden before accepting new access.'); // NEW
            await (await identities.transport(session.identityId)).communities.prepareGrant({ ...input.descriptor, communityGrantId: input.requestId }); // NEW
            const entry = { ...existing, ...input.descriptor, name: input.descriptor.name, summary: null, workerId: input.workerId, ownerIdentityId: session.identityId, shared: true, communityGrantId: input.requestId, communityGrantIds: [...new Set([...(existing?.communityGrantIds || []), existing?.communityGrantId, input.requestId].filter(Boolean))] }; // CHANGE
            await publish(entry); if (state.state === 'left') await lifecycle.completeRejoin(entry); // NEW
            if (existing) await setLocalSource(session.identityId, entry.diagramId, { ...await localSource(session.identityId, entry.diagramId), departing: false, lifecycleStatus: '', lifecycleState: 'active' }); // NEW
        } // CHANGE
        return { ok: true }; // NEW
    } // NEW
    async function referenceTemplates() { // NEW: readable local projections only; no diagram download or filesystem write.
        const session = own(), templates = [], messages = [], errors = []; // NEW
        for (const entry of (await list()).gardens.filter(item => item.available && item.path)) { // NEW
            try { // NEW
                const state = inspectDiagram(await readBounded(entry.path, LIMITS.diagram) /* CHANGE */), user = state.store.users?.find(user => user.id === entry.workerId && user.portableIdentityId === session.identityId && !user.disabled); // NEW
                if (!user || !hasCanvasAccess(state, user.id)) continue; // NEW
                for (const cell of state.cells.filter(cell => cell.node.hasAttribute(references.ATTR))) { // NEW
                    const store = references.validate(JSON.parse(cell.node.getAttribute(references.ATTR))), settings = {}; // NEW
                    for (const attr of Array.from(cell.node.attributes)) if (['city_id', 'city_name', 'unit_system', 'default_bed_width_cm', 'default_bed_length_cm', 'module_external_margin', 'plant_circle_max_per_planting', 'plant_circle_max_total'].includes(attr.name) || /^default_path_.+_(?:width_cm|enabled)$/.test(attr.name)) settings[attr.name] = attr.value; // CHANGE
                    const margin = /(?:^|;)module_external_margin=([^;]+)/.exec(cell.node.getElementsByTagName('mxCell')[0]?.getAttribute('style') || ''); if (margin) settings.module_external_margin = margin[1]; // NEW
                    const geometry = cell.node.getElementsByTagName('mxGeometry')[0]; if (geometry) settings.geometry = { width: Number(geometry.getAttribute('width')), height: Number(geometry.getAttribute('height')) }; // NEW
                    const pageId = state.document.pages.find(page => page.doc === cell.node.ownerDocument)?.container?.getAttribute('id') || ''; // NEW
                    templates.push({ name: entry.name + ' / ' + (cell.node.getAttribute('garden_name') || cell.node.getAttribute('label') || cell.id), source: { diagramId: entry.diagramId, gardenId: cell.id, pageId }, references: references.template(store), settings, canPropose: referenceEditor(state, cell, user.id) }); // CHANGE
                    const log = JSON.parse(cell.node.getAttribute(references.PROPOSALS) || '{"version":1,"requests":[],"decisions":[]}'); // NEW
                    for (const proposal of log.requests.filter(item => item.author === user.id)) messages.push({ diagramId: entry.diagramId, gardenId: cell.id, gardenName: entry.name, proposalId: proposal.id, source: proposal.source, decisions: log.decisions.filter(item => item.proposalId === proposal.id), pending: proposal.changes.length - log.decisions.filter(item => item.proposalId === proposal.id).reduce((sum, item) => sum + item.items.length, 0) }); // NEW
                } // NEW
            } catch (error) { errors.push({ diagramId: entry.diagramId, message: error.message }); } // NEW
        } // NEW
        return { ok: true, templates, messages, errors }; // NEW
    } // NEW
    async function sendReferenceProposal(input) { // NEW: reuse signed object transactions and their recoverable concurrent-edit rejection.
        const session = own(); await identities.requireSession(); const entry = await getEntry(input.diagramId), source = await localSource(session.identityId, entry.diagramId), daemon = await sourceService(session.identityId, source); // NEW
        const local = (await daemon.listCanvases()).find(item => item.shareId === entry.shareId && item.available && item.protocolVersion === 3); // NEW
        if (!local) throw new Error('The receiving garden must be locally available with collaboration enabled.'); // NEW
        const caller = 'reference-proposal:' + session.identityId + ':' + uuid(); // NEW
        daemon.setContext(caller, { diagramPath: local.path, diagramId: entry.diagramId, userId: entry.workerId }); // NEW
        try { // NEW
            const snapshot = await daemon.collaborationAction(caller, { shareId: entry.shareId, kind: 'get' }), state = inspectDiagram(snapshot.xml), user = state.store.users?.find(user => user.id === entry.workerId && user.portableIdentityId === session.identityId && !user.disabled); // NEW
            const pages = state.document.pages.filter(page => input.pageId == null || (page.container?.getAttribute('id') || '') === input.pageId).map(page => page.doc); // NEW
            const cells = state.cells.filter(cell => pages.includes(cell.node.ownerDocument) && cell.id === input.gardenId && cell.node.hasAttribute(references.ATTR)); // CHANGE
            if (!user || cells.length !== 1 || !referenceEditor(state, cells[0], user.id)) throw new Error('Editing access to the receiving garden is required.'); // NEW
            const proposal = references.clone(references.validateProposal(input.proposal)); proposal.source.originalAuthor = proposal.author; proposal.author = user.id; proposal.target = { diagramId: entry.diagramId, gardenId: input.gardenId, pageId: input.pageId || '' }; // CHANGE
            const cell = cells[0], log = JSON.parse(cell.node.getAttribute(references.PROPOSALS) || '{"version":1,"requests":[],"decisions":[]}'); // NEW
            if (log.requests.some(item => item.id === proposal.id)) return { ok: true, duplicate: true }; // NEW
            const accepted = references.validate(JSON.parse(cell.node.getAttribute(references.ATTR))); proposal.changes = proposal.changes.filter(item => !item.dependency || !accepted.manifests[accepted.current].heads[item.entityId]); // NEW
            log.requests.push(proposal); references.logValid(log); cell.node.setAttribute(references.PROPOSALS, JSON.stringify(log)); // NEW
            return await daemon.collaborationAction(caller, { shareId: entry.shareId, kind: 'save', baseXml: snapshot.xml, xml: state.document.serialize() }); // NEW
        } finally { daemon.forgetContext(caller); } // NEW
    } // NEW
    return { referenceTemplates, sendReferenceProposal, communitySource, acceptCommunityGrant, list, create, completeStarter, importCurrent, rename, setSuffix: projectNaming.setSuffix, duplicate, download, setOffline, removeLocal, getEntry, catalog, verifiedRecords, processDownloads, cities, getReferenceCity, setReferenceCity, listLocal, configureLocalFolder, ...lifecycle }; // CHANGE
}
