// NEW: Main-process owner of managed canvases, Syncthing, and per-canvas membership.
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { EventEmitter } from 'node:events';
import { SYNCTHING_VERSION, SHARE_SCHEMA, digest, makeId, safeId, canonical, signRecord, verifyRecord, parseXml, inspectDiagram, activeAdmin, hasCanvasAccess, encodeBlock, decodeBlock, inviteFingerprint } from './trellis-share-protocol.js'; // CHANGE
import { XMLSerializer } from '@xmldom/xmldom'; // NEW: configuration edits use the same structured XML parser.
import { verifyMacResigning } from './trellis-binary-integrity.js'; // NEW
import { assertSharingFileAccess } from './trellis-sharing-files.js'; // NEW
import { createCollaborationStore } from './trellis-collaboration-store.js'; // NEW
import { createHistoryTransport } from './trellis-history-transport.js'; // NEW
import { createProjectTransport } from './trellis-project-transport.js'; // NEW
import { naming, projectName } from './trellis-project-naming.js'; // NEW
import { createProjectionNaming } from './trellis-projection-naming.js'; // NEW
import { createMetadataChannels } from './trellis-metadata-channels.js'; // NEW
import { createCommunityTransport } from './trellis-community-transport.js'; // NEW

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const exists = async filename => { try { await fs.access(filename); return true; } catch (_) { return false; } };
const samePath = (a, b) => process.platform === 'win32' ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase() : path.resolve(a) === path.resolve(b);
/** Count complete serving devices, not people; incomplete telemetry is never zero. */ // NEW
export async function countProjectSeeds({ members, deviceId, connections, hasLocalCopy, completion }) { // NEW
    const candidates = [...new Set(members.map(member => member.deviceId))].filter(id => id === deviceId ? hasLocalCopy : connections[id]?.connected); // NEW
    const results = await Promise.allSettled(candidates.map(async id => { // NEW
        const status = await completion(id); // NEW
        if (id !== deviceId && ['paused', 'notSharing'].includes(status.remoteState)) return false; // NEW
        if (id !== deviceId && status.remoteState !== 'valid' || !Number.isFinite(status.completion) || !Number.isFinite(status.needItems) || !Number.isFinite(status.globalItems)) throw new Error('Seed availability is unknown.'); // NEW
        return status.globalItems > 0 && status.completion === 100 && status.needItems === 0; // NEW
    })); // NEW
    return results.some(result => result.status === 'rejected') ? null : results.filter(result => result.value === true).length; // NEW
} // NEW
async function writeAtomic(filename, data) {
    await fs.mkdir(path.dirname(filename), { recursive: true });
    const temporary = filename + '.' + makeId() + '.tmp';
    try { // CHANGE
        await fs.writeFile(temporary, data, { mode: 0o600, flush: true }); // CHANGE: acknowledge preservation only after flush and atomic replacement.
        for (let attempt = 0; ; attempt++) { // NEW: Windows scanners can briefly hold an otherwise writable destination.
            try { await fs.rename(temporary, filename); break; } // NEW
            catch (error) { if (process.platform !== 'win32' || !['EPERM', 'EBUSY', 'EACCES'].includes(error.code) || attempt >= 4) throw error; await sleep(25 * (attempt + 1)); } // NEW
        } // NEW
    } // CHANGE
    finally { await fs.rm(temporary, { force: true }); }
}
async function writeImmutable(filename, value) {
    const serialized = JSON.stringify(value);
    await fs.mkdir(path.dirname(filename), { recursive: true });
    try { await fs.writeFile(filename, serialized, { flag: 'wx', mode: 0o600, flush: true }); } // CHANGE: signed records must be durable before reporting save success.
    catch (err) { if (err.code !== 'EEXIST' || await fs.readFile(filename, 'utf8') !== serialized) throw err; }
}
async function freePort() {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => resolve(port)); });
    });
}
function localReference(value, base) {
    if (!value || /^(?:data:|https?:|mxgraph\.|#)/i.test(value)) return null;
    if (/^file:/i.test(value)) return fileURLToPath(value);
    if (/^[a-z][a-z0-9+.-]*:/i.test(value) && !/^[a-z]:[\\/]/i.test(value)) return null;
    return path.resolve(base, decodeURIComponent(value));
}
/** Visit explicit image/link references through XML and HTML parsers, never directory scans. */
async function relocateAssets(state, base, destination, privatePaths) { // CHANGE: never export the installation's private service files as diagram assets.
    const copied = new Map();
    const missing = new Set();
    async function replace(value) {
        const source = localReference(value, base);
        if (!source) return value;
        for (const privatePath of privatePaths) await assertSharingFileAccess(source, privatePath); // CHANGE: identity vaults and sibling transports are private too.
        const stat = await fs.stat(source).catch(() => null);
        if (!stat || !stat.isFile()) { missing.add(source); return value; }
        if (!copied.has(source)) {
            const bytes = await fs.readFile(source);
            const name = digest(bytes).slice(0, 16) + path.extname(source).toLowerCase();
            const relative = 'assets/' + name;
            await fs.mkdir(path.join(destination, 'assets'), { recursive: true });
            await fs.writeFile(path.join(destination, relative), bytes, { flag: 'wx' }).catch(async err => {
                if (err.code !== 'EEXIST' || digest(await fs.readFile(path.join(destination, relative))) !== digest(bytes)) throw err;
            });
            copied.set(source, relative);
        }
        return copied.get(source);
    }
    for (const page of state.document.pages) for (const node of Array.from(page.doc.getElementsByTagName('*'))) {
        if (node.hasAttribute('style')) {
            const tokens = node.getAttribute('style').split(';');
            for (let i = 0; i < tokens.length; i++) if (tokens[i].startsWith('image=')) tokens[i] = 'image=' + await replace(tokens[i].slice(6));
            node.setAttribute('style', tokens.join(';'));
        }
        for (const attr of ['link', 'href', 'src']) if (node.hasAttribute(attr)) {
            const value = node.getAttribute(attr);
            node.setAttribute(attr, await replace(value));
        }
        // Draw.io HTML labels are XML attribute values; parse only labels with explicit local media.
        for (const attr of ['label', 'value']) {
            const label = node.getAttribute(attr);
            if (!label || !/<(?:img|a)\b/i.test(label)) continue;
            const { DOMParser, XMLSerializer } = await import('@xmldom/xmldom');
            const html = new DOMParser().parseFromString('<div>' + label + '</div>', 'text/html');
            for (const image of Array.from(html.getElementsByTagName('img'))) if (image.hasAttribute('src')) image.setAttribute('src', await replace(image.getAttribute('src')));
            for (const link of Array.from(html.getElementsByTagName('a'))) if (link.hasAttribute('href')) link.setAttribute('href', await replace(link.getAttribute('href'))); // CHANGE: relative local links are explicit assets too; web links remain unchanged.
            const serializer = new XMLSerializer();
            node.setAttribute(attr, Array.from(html.documentElement.childNodes).map(child => serializer.serializeToString(child)).join(''));
        }
    }
    if (missing.size) throw new Error('Referenced local asset is missing or not a file:\n' + [...missing].join('\n'));
}

export function createSyncthingService(options) {
    const events = new EventEmitter();
    const profile = options.profilePath || path.join(options.userDataPath, 'trellis-sharing'); // CHANGE: isolate each portable identity's daemon and secrets.
    const canvasesRoot = options.canvasesRoot || path.join(options.documentsPath, 'Trellis', 'Shared Canvases'); // CHANGE: retain legacy paths by default.
    const registryPath = path.join(profile, 'canvases.json');
    let registry = [];
    let retainedRecords = [], localCanvases = [], registrationIssues = []; // CHANGE
    const localAvailability = new Map(); // CHANGE
    const localOnlyReason = 'Sharing is disabled for this old project. It opens as a local file.'; // CHANGE
    let keys;
    let deviceId = '';
    let apiKey = '';
    let apiAddress = '';
    let child = null;
    let identityChild = null;
    let lifecycleGeneration = 0;
    let initialization;
    let starting;
    let stopping = null; // NEW: concurrent stops own the same child-exit observation.
    const requests = new Set(); // NEW: shutdown aborts in-flight REST calls before they can mutate readiness.
    let stopped = true;
    let retries = 0;
    let restartTimer = null; // NEW: one bounded restart schedule per daemon lifecycle.
    let timer;
    let presenceTimer, presenceTask; // NEW: connection observations cannot wait for garden journal replay.
    let polling = false, pollTask = null, pollRequested = false; // CHANGE
    let lastError = '';
    let runtimeReady = false;
    let connectionSnapshot = null; // NEW: ephemeral observations, never persisted or sent to the renderer.
    let identitySync = null; // NEW: catalog/events have their own folder, independent of downloaded diagrams.
    let configurationQueue = Promise.resolve(); // NEW: prevent concurrent folder configuration from losing unrelated updates.
    const sessions = new Map();
    const statuses = new Map();
    const collaborationStores = new Map(); // NEW: journals are scoped to the transport and project.
    const fetchApi = options.fetch || globalThis.fetch;
    const launch = options.spawn || spawn;
    const now = options.now || Date.now;
    const projectionNaming = createProjectionNaming({ profile, persist, sessions, writeAtomic, beforeRename: options.beforeProjectionRename }); // NEW
    const projectTransport = createProjectTransport({ initialize, start, api, persist, configureCanvas, publishMembership, writeImmutable, writeAtomic, collaborationStore, detach: detachProject, validateManaged, profile, now, emit, beforeRetire: (canvas, input) => communities.retire(canvas, input), deviceId: () => deviceId, keys: () => keys, registry: () => registry, runtimeReady: () => runtimeReady }); // CHANGE
    const metadataChannels = createMetadataChannels({ profile, initialize, start, api, writeAtomic, isReady: () => runtimeReady, isPaused: () => identitySync?.paused, peerAllowed: peer => !identitySync?.revokedSyncthingIds?.includes(peer), generation: () => lifecycleGeneration, canConfigure: () => !stopping && options.canStart?.() !== false, deviceAddresses: options.deviceAddresses, scheduleConfiguration }); // CHANGE
    const communities = createCommunityTransport({ profile, initialize, writeAtomic, writeImmutable, persist, configureCanvas, publishMembership, collaborationStore, canvasState, listCities: options.listCities, descriptor: libraryDescriptor, known: shareId => registry.find(c => c.shareId === shareId), reset: shareId => { collaborationStores.delete(shareId); statuses.delete(shareId); }, deviceId: () => deviceId || registry.find(c => c.localDeviceId)?.localDeviceId, keys: () => keys }); // CHANGE

    /** Internal services may count verified members against a recent daemon observation. */ // NEW
    function memberConnections() { // NEW
        const available = runtimeReady && !stopped && connectionSnapshot?.generation === lifecycleGeneration && now() - connectionSnapshot.at < 15000; // NEW
        const revoked = new Set(identitySync?.revokedSyncthingIds || []); // NEW
        return { available: !!available, deviceId, paused: !!identitySync?.paused, connections: available ? Object.fromEntries(Object.entries(connectionSnapshot.connections).filter(([id]) => !revoked.has(id))) : {} }; // NEW
    } // NEW

    async function initialize() {
        if (initialization) return initialization;
        initialization = (async () => {
            await fs.mkdir(profile, { recursive: true, mode: 0o700 });
            const savedRegistry = await fs.readFile(registryPath, 'utf8').then(JSON.parse).catch(err => { if (err.code === 'ENOENT') return []; throw err; }); // CHANGE
            if (!Array.isArray(savedRegistry)) throw new Error('Invalid sharing registry.'); // CHANGE
            loadRegistrations(savedRegistry); // CHANGE: isolate unsupported entries without discarding retained local data.
            await Promise.all(localCanvases.map(localCanvasListing)); // CHANGE: validate local paths before advertising them to a renderer.
            identitySync = await fs.readFile(path.join(profile, 'identity-sync.json'), 'utf8').then(JSON.parse).catch(err => { if (err.code === 'ENOENT') return null; throw err; }); // NEW
            const keyPath = path.join(profile, 'signing-key.json');
            if (await exists(keyPath)) keys = JSON.parse(await fs.readFile(keyPath, 'utf8'));
            else {
                const generated = crypto.generateKeyPairSync('ed25519');
                keys = { publicKey: generated.publicKey.export({ type: 'spki', format: 'pem' }), privateKey: generated.privateKey.export({ type: 'pkcs8', format: 'pem' }) };
                await writeAtomic(keyPath, JSON.stringify(keys));
            }
            apiKey = await fs.readFile(path.join(profile, 'api-key'), 'utf8').catch(err => { if (err.code === 'ENOENT') return crypto.randomBytes(32).toString('hex'); throw err; });
            await writeAtomic(path.join(profile, 'api-key'), apiKey);
        })();
        return initialization;
    }
    async function persist() { await writeAtomic(registryPath, JSON.stringify([...retainedRecords, ...registry])); } // CHANGE: creating or editing a current share must retain old registrations.
    /** Only validated current registrations may enter transport or collaboration operations. */ // CHANGE
    function loadRegistrations(saved) { // CHANGE
        registry = []; retainedRecords = []; localCanvases = []; registrationIssues = []; // CHANGE
        for (const [index, canvas] of saved.entries()) { // CHANGE
            try { // CHANGE
                safeId(canvas?.shareId); safeId(canvas.diagramId); validateManaged(canvas); // CHANGE
                if (typeof canvas.filename !== 'string' || path.basename(canvas.filename) !== canvas.filename || !/\.drawio$/i.test(canvas.filename)) throw new Error('Invalid diagram filename.'); // CHANGE
                const current = canvas.protocolVersion === 2 && canvas.folderId === 'trellis-v2-' + canvas.shareId; // CHANGE
                const local = (canvas.protocolVersion === undefined || canvas.protocolVersion === 1) && canvas.folderId === 'trellis-' + canvas.shareId; // CHANGE
                if (!current && !local) throw new Error('Unsupported sharing registration.'); // CHANGE
                if (current) { // CHANGE
                    if (!Array.isArray(canvas.members) || registry.some(entry => entry.shareId === canvas.shareId || samePath(entry.diagramPath, canvas.diagramPath))) throw new Error('Invalid or duplicate current registration.'); // CHANGE
                    registry.push(canvas); // CHANGE
                } else { retainedRecords.push(canvas); localCanvases.push(canvas); } // CHANGE
            } catch (error) { // CHANGE
                retainedRecords.push(canvas); // CHANGE
                registrationIssues.push({ index, shareId: typeof canvas?.shareId === 'string' ? canvas.shareId : undefined, reason: error.message }); // CHANGE
            } // CHANGE
        } // CHANGE
    } // CHANGE
    /** Resolve retained documents inside their configured root, including through directory aliases. */ // CHANGE
    async function localCanvasListing(canvas) { // CHANGE
        let available = false, reason = localOnlyReason; // CHANGE
        try { // CHANGE
            validateManaged(canvas); // CHANGE
            const [root, folder, filename] = await Promise.all([fs.realpath(canvasesRoot), fs.realpath(canvas.folderPath), fs.realpath(canvas.diagramPath)]); // CHANGE
            if (!samePath(path.dirname(folder), root) || !samePath(path.dirname(filename), folder)) throw new Error('Retained diagram is outside managed storage.'); // CHANGE
            available = !canvas.projectRetired && (await fs.stat(filename)).isFile(); // CHANGE
        } catch (error) { if (error.code !== 'ENOENT') { reason = error.message; if (!registrationIssues.some(issue => issue.shareId === canvas.shareId && issue.reason === reason)) registrationIssues.push({ shareId: canvas.shareId, reason }); } } // CHANGE
        localAvailability.set(canvas, available); // CHANGE
        return { ...localCanvasStatus(canvas), available, path: available ? canvas.diagramPath : null, folderPath: available ? canvas.folderPath : null, filename: canvas.filename, name: canvas.label || canvas.filename, projectName: canvas.projectName || '', reason: available ? localOnlyReason : reason === localOnlyReason ? 'No local copy.' : reason }; // CHANGE
    } // CHANGE
    function localCanvasStatus(canvas) { // CHANGE
        return { localOnly: true, managed: false, protocolVersion: canvas.protocolVersion ?? 1, state: 'localOnly', shareId: canvas.shareId, diagramId: canvas.diagramId, label: canvas.label, diagramPath: localAvailability.get(canvas) ? canvas.diagramPath : null, available: !!localAvailability.get(canvas), localRemoved: !!canvas.localRemoved, pending: false, seeds: 0, connectedCollaborators: 0, collaborators: [], reason: localOnlyReason }; // CHANGE
    } // CHANGE
    /** Only library orchestration may enable a personal filename; this method is not renderer-dispatched. */ // NEW
    async function setProjectNaming(input) { // NEW
        await initialize(); const canvas = canvasById(input.shareId); // NEW
        if (canvas.localRemoved || canvas.pending || canvas.revoked || canvas.projectRetired || canvas.projectFenced) throw new Error('Download an active project before changing its name.'); // NEW
        const store = collaborationStore(canvas), snapshot = await store.snapshot(), state = inspectDiagram(snapshot.xml); // NEW
        const user = state.store.users?.find(user => user.id === input.userId && user.portableIdentityId === input.identityId && !user.disabled); // NEW
        if (!user || !hasCanvasAccess(state, user.id)) throw new Error('This identity is not linked to an active project member.'); // NEW
        if (input.name !== undefined || !projectName(state) && user.admin && input.fallbackName) { // NEW
            const result = await store.action('project-name:' + input.identityId, user.id, { kind: 'projectName', name: input.name ?? input.fallbackName }); // NEW
            await store.action('project-name:' + input.identityId, user.id, { kind: 'release' }); // NEW
            if (!result.ok) throw new Error(result.reason || 'Project rename could not be accepted.'); // NEW
        } // NEW
        canvas.namingEnabled = input.personalProjection !== false; canvas.namingSuffix = canvas.namingEnabled ? naming.suffix(input.suffix || '') : ''; // CHANGE: never personalize a legacy projection shared by local identities.
        await store.refresh(); await persist(); // NEW
        return canvasListing(canvas); // CHANGE: a naming edit does not rescan unrelated canvases.
    } // NEW
    function collaborationStore(canvas) { // NEW
        if (!collaborationStores.has(canvas.shareId)) collaborationStores.set(canvas.shareId, createCollaborationStore({ canvas, deviceId: deviceId || canvas.localDeviceId, keys, profile, now, writeAtomic, writeImmutable, beforeMaterialize: xml => projectionNaming.reconcile(canvas, xml), prepareXml: async xml => { const parsed = inspectDiagram(xml); await relocateAssets(parsed, canvas.folderPath, canvas.folderPath, options.privatePaths || [profile]); return parsed.document.serialize(); } })); // NEW
        return collaborationStores.get(canvas.shareId); // NEW
    } // NEW
    async function collaborationAction(callerId, input) { // NEW
        await initialize(); const canvas = canvasById(input.shareId), session = authorizeCanvas(callerId, canvas); // NEW
        const result = await collaborationStore(canvas).action(callerId, session.userId, input); // NEW
        if (result.collaboration) statuses.set(canvas.shareId, { ...(statuses.get(canvas.shareId) || {}), collaboration: result.collaboration }); // NEW
        emit(); return result; // NEW
    } // NEW
    function emit() { events.emit('status', listStatus()); }
    function listStatus(callerId) {
        return registry.map(canvas => {
            const status = statuses.get(canvas.shareId) || {};
            const session = sessions.get(callerId);
            const localUserId = session && samePath(session.diagramPath, canvas.diagramPath) ? session.userId : canvas.members.find(member => member.deviceId === deviceId)?.userId;
            const collaborators = (status.collaborators || []).filter(user => user.id !== localUserId);
            return { shareId: canvas.shareId, diagramId: canvas.diagramId, label: canvas.label, diagramPath: canvas.diagramPath, pending: !!canvas.pending, state: canvas.paused ? 'paused' : 'syncing', reason: lastError, ...status, collaborators, seeds: runtimeReady ? status.seeds ?? null : null, connectedCollaborators: status.connectedCollaborators == null ? null : collaborators.length, ...(!runtimeReady ? { state: 'unavailable', reason: lastError || 'Syncthing is not running.', connectedCollaborators: null } : {}) }; // CHANGE
        }).concat(localCanvases.map(localCanvasStatus)); // CHANGE: counts exclude the current window's actor; tray-only devices use their associated account.
    }
    async function api(endpoint, method = 'GET', data, timeoutMs = 10000) { // CHANGE: shutdown shares the application's graceful deadline.
        if (!apiAddress) throw new Error('Syncthing is not running.');
        const generation = lifecycleGeneration, controller = new AbortController(); // NEW
        const shutdown = endpoint === 'system/shutdown'; // NEW
        if (!shutdown && stopped) throw new Error('Sharing startup was cancelled.'); // NEW
        if (!shutdown) requests.add(controller); // NEW
        const timeout = setTimeout(() => controller.abort(), Math.max(1, timeoutMs)); // NEW
        try { // NEW
            const response = await fetchApi(apiAddress + '/rest/' + endpoint, { method, headers: { 'X-API-Key': apiKey, ...(data === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: data === undefined ? undefined : JSON.stringify(data), signal: controller.signal }); // CHANGE
            if (!response.ok) throw new Error('Syncthing request failed (' + response.status + ').'); // CHANGE
            const text = await response.text(); // CHANGE
            if (!shutdown && (stopped || generation !== lifecycleGeneration)) throw new Error('Sharing startup was cancelled.'); // NEW
            return text ? JSON.parse(text) : null; // CHANGE
        } finally { clearTimeout(timeout); requests.delete(controller); } // NEW
    }
    async function binaryPath() {
        const platform = options.platform || process.platform;
        const arch = options.arch || process.arch;
        if (!['win32', 'darwin', 'linux'].includes(platform) || !['x64', 'arm64'].includes(arch)) throw new Error('Syncthing sharing is unavailable for this platform.');
        const dir = path.join(options.binaryRoot, platform + '-' + arch);
        const executable = path.join(dir, platform === 'win32' ? 'syncthing.exe' : 'syncthing');
        const manifest = JSON.parse(await fs.readFile(path.join(dir, 'manifest.json'), 'utf8').catch(() => { throw new Error('Bundled Syncthing sharing is unavailable. Run the Syncthing bundle preparation step.'); }));
        if (manifest.version !== SYNCTHING_VERSION || manifest.platform !== platform || manifest.arch !== arch) throw new Error('Bundled Syncthing integrity check failed.');
        if (digest(await fs.readFile(executable)) !== manifest.binarySha256 && !(platform === 'darwin' && process.platform === 'darwin' && await verifyMacResigning(executable, manifest))) throw new Error('Bundled Syncthing integrity check failed.'); // CHANGE: macOS release signing is allowed, code changes are not.
        return executable;
    }
    function scheduleRestart() { // NEW: startup failures and crashes share the same finite retry budget.
        if (stopped || restartTimer) return;
        if (retries >= 3) { lastError = 'Syncthing stopped. Restart sharing from the tray.'; emit(); return; }
        const generation = lifecycleGeneration;
        restartTimer = setTimeout(() => {
            restartTimer = null;
            if (!stopped && lifecycleGeneration === generation) start().catch(err => { lastError = err.message; emit(); });
        }, ++retries * 1000);
        restartTimer.unref();
    }
    async function start() {
        if (stopping || options.canStart?.() === false) throw new Error('Sharing startup was cancelled.'); // NEW
        if (stopped && !starting && (child || identityChild)) throw new Error('A previous Syncthing process has not exited.'); // NEW: never overlap a replacement with failed owned-child termination.
        const requestedGeneration = lifecycleGeneration; // NEW: initialization can overlap an explicit Quit too.
        await initialize();
        if (lifecycleGeneration !== requestedGeneration) throw new Error('Sharing startup was cancelled.');
        if (runtimeReady) return { ok: true, deviceId };
        if (starting) return starting;
        const startGeneration = lifecycleGeneration;
        const operation = (async () => {
            await options.beforeStart?.(); // NEW: signed lifecycle metadata fences retired folders before Syncthing can announce them.
            const executable = await binaryPath();
            if (lifecycleGeneration !== startGeneration || options.canStart?.() === false) throw new Error('Sharing startup was cancelled.'); // NEW: do not launch generation after a slow binary integrity check.
            const syncthingHome = path.join(profile, 'syncthing'); // NEW: generate identity without starting an unrelated default folder.
            const configPath = path.join(syncthingHome, 'config.xml');
            if (!await exists(configPath)) {
                await fs.mkdir(syncthingHome, { recursive: true });
                await new Promise((resolve, reject) => {
                    const generator = launch(executable, ['generate', '--home=' + syncthingHome], { windowsHide: true, stdio: 'ignore' });
                    identityChild = generator;
                    const timeout = setTimeout(() => { generator.kill(); reject(new Error('Syncthing identity generation timed out.')); }, 15000);
                    generator.once('error', err => { clearTimeout(timeout); if (identityChild === generator) identityChild = null; reject(err); }); // CHANGE
                    generator.once('exit', code => { clearTimeout(timeout); if (identityChild === generator) identityChild = null; code === 0 ? resolve() : reject(new Error('Syncthing identity generation failed.')); }); // CHANGE
                });
                if (lifecycleGeneration !== startGeneration) throw new Error('Sharing startup was cancelled.'); // NEW
                const config = parseXml(await fs.readFile(configPath, 'utf8'));
                if (lifecycleGeneration !== startGeneration) throw new Error('Sharing startup was cancelled.'); // NEW
                for (const folder of Array.from(config.getElementsByTagName('folder'))) if (folder.parentNode === config.documentElement) folder.parentNode.removeChild(folder);
                await writeAtomic(configPath, new XMLSerializer().serializeToString(config));
            }
            if (lifecycleGeneration !== startGeneration) throw new Error('Sharing startup was cancelled.'); // NEW: Quit during identity generation must not launch a later orphan.
            if (stopped) retries = 0; // NEW: explicit restarts reset the crash budget.
            stopped = false;
            const port = await freePort();
            apiAddress = 'http://127.0.0.1:' + port;
            const syncPort = await freePort();
            if (stopped || lifecycleGeneration !== startGeneration) throw new Error('Sharing startup was cancelled.'); // NEW: Quit can occur while port allocation is awaiting the OS.
            child = launch(executable, ['serve', '--home=' + path.join(profile, 'syncthing'), '--gui-address=127.0.0.1:' + port, '--no-browser', '--no-upgrade', '--no-restart', '--paused', '--log-file=' + path.join(profile, 'syncthing.log'), '--log-max-size=1048576', '--log-max-old-files=3'], { windowsHide: true, stdio: 'ignore', env: { ...process.env, STGUIAPIKEY: apiKey, STMONITORED: 'yes', STNOUPGRADE: '1' } });
            const running = child; // NEW: an old child's delayed exit cannot clear a replacement daemon.
            running.on('error', err => { if (child !== running) return; if (!running.pid) child = null; lastError = err.message; runtimeReady = false; emit(); }); // CHANGE
            running.once('exit', () => { // CHANGE
                if (child !== running) return; // NEW
                child = null;
                const wasReady = runtimeReady;
                runtimeReady = false;
                if (wasReady) scheduleRestart(); // CHANGE: failed startup schedules from its catch handler after cleanup.
            });
            let status;
            for (let attempt = 0; attempt < 60; attempt++) {
                if (stopped || lifecycleGeneration !== startGeneration) throw new Error('Sharing startup was cancelled.'); // NEW: never restore readiness after an explicit shutdown.
                if (!child) throw new Error(lastError || 'Syncthing exited during startup.');
                try { status = await api('system/status'); break; } catch (_) { await sleep(250); }
            }
            if (!status) throw new Error('Syncthing startup timed out.');
            if (stopped || lifecycleGeneration !== startGeneration) throw new Error('Sharing startup was cancelled.'); // NEW: a late status reply after Quit is cancellation, not a broken API.
            deviceId = status.myID;
            const config = await api('config');
            // Fresh instances must not share Syncthing's unrelated default Sync folder.
            const metadataIds = new Set((await metadataChannels.load()).map(channel => channel.folderId)); // NEW
            config.folders = config.folders.filter(folder => registry.some(canvas => canvas.folderId === folder.id && !canvas.localRemoved) || folder.id === identitySync?.folderId || metadataIds.has(folder.id)); // CHANGE: retain explicitly registered metadata channels only.
            config.options.autoUpgradeIntervalH = 0;
            config.options.startBrowser = false;
            config.options.urAccepted = -1;
            config.options.crashReportingEnabled = false;
            config.options.globalAnnounceEnabled = true;
            config.options.localAnnounceEnabled = true;
            config.options.relaysEnabled = true;
            config.options.listenAddresses = ['tcp://0.0.0.0:' + syncPort, 'quic://0.0.0.0:' + syncPort, 'dynamic+https://relays.syncthing.net/endpoint'];
            if (options.onListening) options.onListening({ deviceId, port: syncPort }); // NEW: diagnostic/test observer, never exposed over IPC.
            await api('config', 'PUT', config);
            if (stopped || lifecycleGeneration !== startGeneration) throw new Error('Sharing startup was cancelled.'); // NEW: configuration requests can overlap Quit.
            runtimeReady = true;
            lastError = '';
            for (const canvas of registry) if (!canvas.localRemoved) await configureCanvas(canvas); // CHANGE
            if (identitySync) await configureMetadataFolder(); // NEW
            await metadataChannels.configureAll(); // NEW
            if (stopped || lifecycleGeneration !== startGeneration) throw new Error('Sharing startup was cancelled.'); // NEW
            if (!timer) { timer = setInterval(() => { if (!polling) void poll().catch(err => { lastError = err.message; emit(); }); }, 5000); timer.unref(); } // CHANGE: background ticks do not repeatedly extend an active explicit refresh.
            if (!presenceTimer) { presenceTimer = setInterval(() => { void sampleConnections().then(() => { if (!stopped) emit(); }).catch(() => {}); }, 5000); presenceTimer.unref(); } // NEW
            emit();
            return { ok: true, deviceId };
        })().catch(async err => { // CHANGE: transient startup failures retry without allowing Quit to resurrect the child.
            if (lifecycleGeneration !== startGeneration) throw err; // NEW: an obsolete startup cannot clear replacement readiness.
            const retry = !stopped && options.canStart?.() !== false;
            lastError = err.message;
            runtimeReady = false;
            if (retry) { await stop(); stopped = false; scheduleRestart(); } // CHANGE: an obsolete startup must not stop a replacement or resurrect after Quit.
            throw err;
        }).finally(() => { if (starting === operation) starting = null; }); // CHANGE
        starting = operation; return operation; // CHANGE
    }
    /** Stop only children launched by this service; successful completion requires their exit. */ // NEW
    function stop({ deadline = Date.now() + 10000 } = {}) { // CHANGE
        if (stopping) return stopping; // NEW
        lifecycleGeneration++; starting = null; // CHANGE: a canceled startup cannot block a later explicit restart.
        clearTimeout(restartTimer); // NEW: no scheduled launch survives explicit shutdown.
        restartTimer = null;
        stopped = true;
        connectionSnapshot = null; // NEW
        for (const controller of requests) controller.abort(); // NEW
        clearInterval(timer);
        clearInterval(presenceTimer); presenceTimer = null; // NEW
        timer = null;
        runtimeReady = false;
        const owned = [...new Set([child, identityChild].filter(Boolean))]; // NEW
        stopping = Promise.resolve().then(async () => { // NEW
            await bounded(Promise.all([pollTask?.catch(() => {}), presenceTask?.catch(() => {}), configurationQueue.catch(() => {})]), deadline); // NEW: canceled scans/configuration must finish before callers can dispose profile files.
            await bounded(Promise.all([...collaborationStores.values()].map(store => store.flush())), deadline); // NEW: finish local durability before daemon shutdown.
            const observations = owned.map(process => observeExit(process)); // NEW: subscribe before REST or kill can synchronously emit exit.
            let forced = false; const shutdownAvailable = !!apiAddress; // CHANGE
            try { // NEW
                if (identityChild) { forced = true; identityChild.kill(); } // NEW
                if (child && Date.now() < deadline) { // NEW
                    // A fake or broken REST implementation must not bypass the wall-clock bound. // NEW
                    await bounded(api('system/shutdown', 'POST', undefined, deadline - Date.now()).catch(() => {}), deadline); // NEW
                } // NEW
                if (shutdownAvailable) await bounded(Promise.all(observations.map(observation => observation.exited)), deadline); // CHANGE // NEW
                const remaining = observations.filter(observation => !observation.done); // NEW
                if (remaining.length) { // NEW
                    forced = true; options.onLifecycle?.({ phase: 'forced termination', pids: remaining.map(observation => observation.process.pid) }); // NEW
                    for (const observation of remaining) observation.process.kill('SIGKILL'); // NEW
                    await bounded(Promise.all(remaining.map(observation => observation.exited)), Date.now() + 3000); // NEW
                    if (remaining.some(observation => !observation.done)) throw new Error('A Trellis-owned Syncthing process did not exit after forced termination.'); // NEW
                } // NEW
                return { ok: true, forced }; // NEW
            } finally { // NEW
                for (const observation of observations) observation.dispose(); // NEW
                apiAddress = ''; emit(); // NEW
            } // NEW
        }).finally(() => { stopping = null; }); // NEW
        return stopping; // NEW
    } // CHANGE
    /** Observe actual exit without treating ChildProcess.killed as proof of termination. */ // NEW
    function observeExit(process) { // NEW
        const observation = { process, done: process.exitCode != null || process.signalCode != null }; // NEW
        let receive; // NEW
        observation.exited = observation.done ? Promise.resolve() : new Promise(resolve => { receive = () => { observation.done = true; resolve(); }; process.once('exit', receive); }); // NEW
        observation.dispose = () => { if (receive) process.removeListener('exit', receive); }; // NEW
        return observation; // NEW
    } // NEW
    /** Bound waits while removing their timer immediately on early completion. */ // NEW
    async function bounded(task, deadline) { // NEW
        let timeout; // NEW
        try { await Promise.race([task, new Promise(resolve => { timeout = setTimeout(resolve, Math.max(0, deadline - Date.now())); })]); } // NEW
        finally { clearTimeout(timeout); } // NEW
    } // NEW
    function canvasById(id) {
        const canvas = registry.find(entry => entry.shareId === safeId(id));
        if (!canvas) throw new Error(localCanvases.some(entry => entry.shareId === id) ? localOnlyReason : 'This canvas is not registered for sharing.'); // CHANGE
        return canvas;
    }
    async function canvasState(canvas) { return inspectDiagram(await fs.readFile(canvas.diagramPath, 'utf8')); }
    function setContext(callerId, context) {
        if (!context || !context.diagramId) { sessions.delete(callerId); return; } // CHANGE: unsaved canvases have identity before a filename.
        sessions.set(callerId, { diagramPath: context.diagramPath ? path.resolve(context.diagramPath) : path.join(options.documentsPath, '.trellis-unsaved-' + safeId(context.diagramId)), diagramId: String(context.diagramId), userId: String(context.userId || '') });
    }
    function authorizeCanvas(callerId, canvas) {
        const session = sessions.get(callerId);
        if (!session || !samePath(session.diagramPath, canvas.diagramPath) || session.diagramId !== canvas.diagramId) throw new Error('Open this shared canvas before changing its sharing settings.');
        return session;
    }
    async function requireAdmin(callerId, canvas) {
        const session = authorizeCanvas(callerId, canvas);
        const state = await canvasState(canvas);
        if (!activeAdmin(state, session.userId)) throw new Error('A logged-in canvas admin is required. Save account changes first.');
        return { session, state };
    }
    /** Every whole-configuration update shares one queue, including independent metadata channels. */ // NEW
    function scheduleConfiguration(work) { // NEW
        const generation = lifecycleGeneration, task = configurationQueue.then(() => { if (generation !== lifecycleGeneration || stopped || !runtimeReady) return; return work(); }); // NEW
        configurationQueue = task.catch(() => {}); return task; // NEW
    } // NEW
    function configureCanvas(canvas) { return scheduleConfiguration(() => configureCanvasNow(canvas)); } // NEW
    async function configureCanvasNow(canvas) { // CHANGE
        if (canvas.localRemoved || canvas.projectRetired || canvas.projectFenced) return; // CHANGE: retired folders cannot be recreated by late configuration.
        await fs.mkdir(canvas.folderPath, { recursive: true });
        const config = await api('config');
        const departing = (canvas.departureCommits || []).filter(commit => !commit.deliveryComplete).map(commit => (canvas.retiredMembers || []).find(member => member.deviceId === commit.deviceId)).filter(Boolean); // NEW: retain only the receipt channel until departure delivery completes.
        const peers = [...(canvas.pending ? canvas.bootstrapMembers || canvas.members || [] : canvas.members || []), ...departing].filter(peer => !identitySync?.revokedSyncthingIds?.includes(peer.deviceId)); // CHANGE: identity device removal also stops this installation's managed diagram transfers.
        for (const peer of peers) { // CHANGE: restore registered devices from --paused without touching other installations.
            const existing = config.devices.find(entry => entry.deviceID === peer.deviceId);
            const addresses = options.deviceAddresses ? options.deviceAddresses(peer.deviceId) : ['dynamic']; // NEW: explicit addresses support isolated acceptance tests.
            if (existing) { existing.paused = false; existing.introducer = false; existing.autoAcceptFolders = false; existing.addresses = addresses; }
            else config.devices.push({ ...(config.defaults?.device || {}), deviceID: peer.deviceId, name: peer.name || peer.userId || 'Trellis collaborator', addresses, paused: false, introducer: false, autoAcceptFolders: false });
        }
        const folder = { ...(config.defaults?.folder || {}), id: canvas.folderId, label: canvas.label, path: canvas.folderPath, type: 'sendreceive', paused: !!canvas.paused, devices: [...new Set([deviceId, ...peers.map(peer => peer.deviceId)])].map(id => ({ deviceID: id })), fsWatcherEnabled: true, fsWatcherDelayS: 0.5, rescanIntervalS: 3600, maxConflicts: -1, versioning: { type: 'simple', params: { keep: '20', cleanoutDays: '0' } } }; // CHANGE: coordination records use a short watcher debounce.
        const index = config.folders.findIndex(entry => entry.id === canvas.folderId);
        if (index < 0) config.folders.push(folder); else config.folders[index] = { ...config.folders[index], ...folder };
        await api('config', 'PUT', config);
        await api('db/ignores?folder=' + encodeURIComponent(canvas.folderId), 'POST', { ignore: ['/.trellis/**/*.tmp', '!/assets', '!/assets/**', '!/.trellis', '!/.trellis/**', '**'] }); // CHANGE: v2 never synchronizes the mutable local diagram.
    }
    /** Registry-only library listing never launches Syncthing or requires a graph. */ // NEW
    async function listCanvases() { // CHANGE
        await initialize(); return Promise.all([...registry.map(canvasListing), ...localCanvases.map(localCanvasListing)]); // CHANGE
    } // CHANGE
    /** Serialize one registry entry, sharing availability checks with targeted edits. */ // NEW
    async function canvasListing(canvas) { // NEW
        let available = false, reason = '';
        try { const stat = await fs.stat(canvas.diagramPath); available = stat.isFile() && !canvas.localRemoved; }
        catch (err) { if (err.code !== 'ENOENT') reason = err.message; }
        return { projectName: canvas.projectName || '', filename: canvas.filename, filenamePending: !!canvas.filenamePending, namingError: canvas.namingError || '', protocolVersion: 2, replacesShareId: canvas.replacesShareId || null, shareId: canvas.shareId, diagramId: canvas.diagramId, name: canvas.label, path: canvas.diagramPath, folderPath: canvas.folderPath, available, seeds: runtimeReady && !canvas.paused && !canvas.revoked ? statuses.get(canvas.shareId)?.seeds ?? null : null, pending: !!canvas.pending, revoked: !!canvas.revoked, rejoined: !!canvas.rejoined, retired: !!canvas.projectRetired, fenced: !!canvas.projectFenced, localRemoved: !!canvas.localRemoved, reason: reason || (!available ? canvas.pending ? 'Waiting for download or approval.' : 'No local copy.' : ''), state: statuses.get(canvas.shareId)?.state || (canvas.paused ? 'paused' : runtimeReady ? 'syncing' : 'offline') }; // CHANGE
    } // NEW
    /** Expose only public transport identity for targeted device provisioning. */ // NEW
    async function getTransportIdentity() { // NEW
        await start();
        return { deviceId, publicKey: keys.publicKey };
    }
    function configureMetadataFolder() { return scheduleConfiguration(configureMetadataFolderNow); } // NEW
    async function configureMetadataFolderNow() { // CHANGE
        if (!identitySync || !runtimeReady) return;
        const config = await api('config');
        const peers = identitySync.devices;
        for (const configured of config.devices) if (identitySync.revokedSyncthingIds?.includes(configured.deviceID)) configured.paused = true; // NEW: retain protocol history while disconnecting removed identity peers.
        for (const peer of peers) {
            const existing = config.devices.find(entry => entry.deviceID === peer.syncthingId);
            if (existing) { existing.paused = false; existing.autoAcceptFolders = false; }
            else config.devices.push({ ...(config.defaults?.device || {}), deviceID: peer.syncthingId, name: peer.name, addresses: options.deviceAddresses ? options.deviceAddresses(peer.syncthingId) : ['dynamic'], paused: false, introducer: false, autoAcceptFolders: false });
        }
        const folder = { ...(config.defaults?.folder || {}), id: identitySync.folderId, label: 'Trellis identity library', path: identitySync.directory, type: 'sendreceive', paused: !!identitySync.paused, devices: peers.map(peer => ({ deviceID: peer.syncthingId })), fsWatcherEnabled: true, fsWatcherDelayS: 1, rescanIntervalS: 300, maxConflicts: -1 };
        const index = config.folders.findIndex(entry => entry.id === folder.id);
        if (index < 0) config.folders.push(folder); else config.folders[index] = { ...config.folders[index], ...folder };
        await api('config', 'PUT', config);
    }
    /** Persist metadata configuration separately from diagram registrations. */ // NEW
    async function configureIdentityMetadata(input) { // NEW
        const generation = lifecycleGeneration; // NEW
        await initialize();
        if (generation !== lifecycleGeneration || stopping || options.canStart?.() === false) throw new Error('Sharing startup was cancelled.'); // NEW
        const devices = input.devices.map(device => ({ syncthingId: device.syncthingId, name: device.name })); // CHANGE
        const activeIds = new Set(devices.map(device => device.syncthingId)); // NEW
        const revokedSyncthingIds = [...new Set([...(identitySync?.revokedSyncthingIds || []), ...(identitySync?.devices || []).filter(device => !activeIds.has(device.syncthingId)).map(device => device.syncthingId)])]; // NEW: persist revocations across restarts and later diagram configuration.
        const next = { folderId: 'trellis-identity-' + safeId(input.identityId), directory: path.resolve(input.directory), devices, revokedSyncthingIds, paused: !!identitySync?.paused }; // CHANGE: preserve tray pause across identity refresh and restart.
        if (next.devices.some(device => typeof device.syncthingId !== 'string')) throw new Error('Incomplete paired-device transport identity.');
        const changed = canonical(next) !== canonical(identitySync);
        identitySync = next;
        await fs.mkdir(next.directory, { recursive: true });
        if (changed) await writeAtomic(path.join(profile, 'identity-sync.json'), JSON.stringify(next));
        if (generation !== lifecycleGeneration || stopping || options.canStart?.() === false) throw new Error('Sharing startup was cancelled.'); // NEW
        if (!runtimeReady) await start();
        else if (changed) {
            if (generation === lifecycleGeneration && !stopped) { for (const canvas of registry) if (!canvas.localRemoved) await configureCanvas(canvas); await configureMetadataFolder(); await metadataChannels.configureAll(); } // CHANGE: identity revocations also remove peers from community and request folders.
        }
        return { ok: true };
    }
    /** A paired identity may enroll itself only where its linked user is an admin. */ // NEW
    async function approveLibraryDevice(input) { // CHANGE
        await initialize(); const canvas = canvasById(input.shareId); // CHANGE
        await start(); const state = await canvasState(canvas); // CHANGE
        if (canvas.coordinatorDeviceId !== deviceId || !activeAdmin(state, input.userId)) throw new Error('This shared garden needs approval from its coordinator/admin.');
        if (!canvas.members.some(member => member.deviceId === input.deviceId)) {
            crypto.createPublicKey(input.publicKey);
            await publishMembership(canvas, [...canvas.members, { deviceId: input.deviceId, publicKey: input.publicKey, userId: input.userId }]);
            await configureCanvas(canvas);
        }
        return { ok: true, members: canvas.members };
    }
    /** Register a download using a verified library descriptor, never a remote path. */ // NEW
    async function registerLibraryDownload(input) { // NEW
        if (input.protocolVersion !== 2) throw new Error('Unsupported Trellis sharing protocol. Only version 2 descriptors are supported.'); // CHANGE
        await initialize(); // CHANGE
        if (localCanvases.some(canvas => canvas.shareId === input.shareId)) throw new Error(localOnlyReason); // CHANGE
        await start();
        let canvas = registry.find(entry => entry.shareId === input.shareId);
        if (canvas?.projectRetired || canvas?.departureRequestId) throw new Error('Restore the project or finish leaving before downloading it.'); // NEW
        const folderPath = path.join(canvasesRoot, safeId(input.shareId));
        if (!canvas) {
            if (path.basename(input.filename) !== input.filename || !/\.drawio$/i.test(input.filename)) throw new Error('Invalid garden filename.');
            canvas = { protocolVersion: 2, localDeviceId: deviceId, shareId: input.shareId, diagramId: safeId(input.diagramId), folderId: 'trellis-v2-' + input.shareId, folderPath, diagramPath: path.join(folderPath, input.filename), filename: input.filename, label: input.name, coordinatorDeviceId: input.originCoordinatorDeviceId || input.coordinatorDeviceId, coordinatorPublicKey: input.genesisCoordinatorPublicKey || input.coordinatorPublicKey, genesisCoordinatorPublicKey: input.genesisCoordinatorPublicKey, membershipVersion: 0, members: input.members, bootstrapMembers: input.members, joinMembershipVersion: input.communityGrantId ? Math.max(0, input.membershipVersion - 1) : input.membershipVersion || 0, pending: true, createdAt: now() }; // CHANGE: a verified community grant already includes this device's approval.
            registry.push(canvas);
        }
        canvas.localRemoved = false; canvas.paused = false;
        await persist(); await configureCanvas(canvas); emit();
        return { ok: true, path: canvas.diagramPath };
    }
    /** Authorize and detach before touching managed files, including while the daemon is stopped. */ // NEW
    function validateManaged(canvas) { // NEW
        const resolved = path.resolve(canvas.folderPath), parent = path.resolve(canvasesRoot); // NEW
        if (path.dirname(resolved) !== parent || path.basename(resolved) !== canvas.shareId || path.dirname(path.resolve(canvas.diagramPath)) !== resolved || path.basename(canvas.diagramPath) !== canvas.filename) throw new Error('Garden removal path is outside managed storage.'); // NEW
    } // NEW
    async function detachProject(canvas) { // NEW
        validateManaged(canvas); // NEW
        if (runtimeReady) { // CHANGE: an unavailable project may already have had its download detached.
            return scheduleConfiguration(async () => { const config = await api('config'); if (config.folders.some(folder => folder.id === canvas.folderId)) await api('config/folders/' + encodeURIComponent(canvas.folderId), 'DELETE'); }); // CHANGE
        } // NEW
        const filename = path.join(profile, 'syncthing', 'config.xml'); // NEW
        const xml = await fs.readFile(filename, 'utf8').catch(error => { if (error.code === 'ENOENT') return null; throw error; }); // NEW
        if (!xml) return; // NEW
        const document = parseXml(xml); // NEW
        for (const folder of Array.from(document.getElementsByTagName('folder'))) if (folder.getAttribute('id') === canvas.folderId) folder.parentNode.removeChild(folder); // NEW
        await writeAtomic(filename, new XMLSerializer().serializeToString(document)); // NEW
    } // NEW
    /** Detach before local deletion, so Syncthing cannot announce a tombstone. */ // NEW
    async function removeLibraryDownload(input) { // NEW
        await initialize();
        const canvas = canvasById(input.shareId);
        if (input.confirmLoss !== true) throw new Error('Confirm local removal, including possible unsynced or last-copy loss.');
        const resolved = path.resolve(canvas.folderPath), parent = path.resolve(canvasesRoot);
        if (path.dirname(resolved) !== parent || path.basename(resolved) !== canvas.shareId) throw new Error('Garden removal path is outside managed storage.');
        canvas.localRemoved = true; await persist();
        if (runtimeReady) { await scheduleConfiguration(() => api('config/folders/' + encodeURIComponent(canvas.folderId), 'DELETE')); await api('system/config/insync').catch(() => {}); } // CHANGE
        else {
            const filename = path.join(profile, 'syncthing', 'config.xml');
            const document = parseXml(await fs.readFile(filename, 'utf8'));
            for (const folder of Array.from(document.getElementsByTagName('folder'))) if (folder.getAttribute('id') === canvas.folderId) folder.parentNode.removeChild(folder);
            await writeAtomic(filename, new XMLSerializer().serializeToString(document));
        }
        await fs.rm(resolved, { recursive: true, force: true }); emit();
        return { ok: true };
    }
    /** Public catalog descriptors contain no local filesystem or daemon secrets. */ // NEW
    async function libraryDescriptor(shareId) { // NEW
        await initialize(); const canvas = canvasById(shareId);
        return { protocolVersion: 2, replacesShareId: canvas.replacesShareId || null, shareId: canvas.shareId, diagramId: canvas.diagramId, filename: 'Garden.drawio', name: canvas.projectName || canvas.label, coordinatorDeviceId: canvas.coordinatorDeviceId, coordinatorPublicKey: canvas.coordinatorPublicKey, originCoordinatorDeviceId: canvas.coordinatorHistory?.[0]?.deviceId || canvas.coordinatorDeviceId, genesisCoordinatorPublicKey: canvas.genesisCoordinatorPublicKey || canvas.coordinatorPublicKey, membershipVersion: canvas.membershipVersion, members: canvas.members }; // CHANGE
    }
    async function shareInfo(context = {}) {
        await initialize();
        let startupReason = ''; // CHANGE: looking up an unmanaged document must not start a transport.
        const retained = localCanvases.find(entry => context.diagramPath && samePath(entry.diagramPath, context.diagramPath)); // CHANGE
        if (retained) { // CHANGE
            const local = await localCanvasListing(retained); // CHANGE
            return { ok: true, ...local, assetBaseUrl: local.available ? pathToFileURL(retained.folderPath + path.sep).href : undefined }; // CHANGE
        } // CHANGE
        let canvas = registry.find(entry => context.diagramPath && samePath(entry.diagramPath, context.diagramPath));
        if (!canvas && context.diagramPath) { // NEW: recognize external renames without adopting unrelated neighboring files.
            const renamed = registry.find(entry => samePath(entry.folderPath, path.dirname(context.diagramPath)));
            if (renamed && !await exists(renamed.diagramPath) && /\.drawio$/i.test(context.diagramPath)) { // CHANGE
                const state = inspectDiagram(await fs.readFile(context.diagramPath, 'utf8'));
                if (!state.cells.some(cell => cell.node.getAttribute('trellis_history_id') === renamed.diagramId)) throw new Error('Renamed canvas has a different diagram identity.');
                renamed.diagramPath = path.resolve(context.diagramPath);
                renamed.filename = path.basename(context.diagramPath);
                try { await start(); } catch (err) { startupReason = err.message; } // CHANGE: only a recognized managed rename needs transport configuration.
                if (runtimeReady) await configureCanvas(renamed); // CHANGE: retain local rename recognition during transport failure.
                await persist();
                canvas = renamed;
            }
        }
        if (!canvas) return { ok: !startupReason, managed: false, deviceId, reason: startupReason || 'Set up a managed sharing folder for this canvas.' }; // CHANGE
        if (!runtimeReady && !startupReason) try { await start(); } catch (err) { startupReason = err.message; } // CHANGE: managed projects retain local editing during transport failure.
        return { ok: true, managed: true, protocolVersion: 2, deviceId: deviceId || canvas.localDeviceId, shareId: canvas.shareId, diagramId: canvas.diagramId, createdAt: canvas.createdAt, folderId: canvas.folderId, folderLabel: canvas.label, folderPath: canvas.folderPath, assetBaseUrl: pathToFileURL(canvas.folderPath + path.sep).href, diagramPath: canvas.diagramPath, coordinatorDeviceId: canvas.coordinatorDeviceId, coordinatorPublicKey: canvas.coordinatorPublicKey, membershipVersion: canvas.membershipVersion || 0, reason: startupReason }; // CHANGE
    }
    async function setupCanvas(callerId, input) {
        if (input.protocolVersion !== undefined && input.protocolVersion !== 2) throw new Error('Unsupported Trellis sharing protocol. Only version 2 shares can be created.'); // CHANGE
        await initialize(); // CHANGE
        if (input.diagramPath && localCanvases.some(entry => samePath(entry.folderPath, path.dirname(path.resolve(input.diagramPath))))) throw new Error(localOnlyReason); // CHANGE
        await start();
        const session = sessions.get(callerId);
        if (!session || session.diagramId !== input.diagramId || !session.userId) throw new Error('Log in to the canvas before sharing.');
        const source = input.diagramPath ? path.resolve(input.diagramPath) : null;
        if (source && !samePath(source, session.diagramPath)) throw new Error('Canvas path does not match the open document.');
        if (source && registry.some(entry => samePath(entry.diagramPath, source))) return shareInfo({ diagramPath: source });
        const xml = String(input.xml || (source ? await fs.readFile(source, 'utf8') : ''));
        const state = inspectDiagram(xml);
        if (!state.cells.some(cell => cell.node.getAttribute('trellis_history_id') === input.diagramId || cell.node.getAttribute('trellis_users_diagram_id') === input.diagramId)) throw new Error('Canvas identity does not match its saved metadata.'); // NEW
        if (!hasCanvasAccess(state, session.userId)) throw new Error('The current user has no canvas access.');
        if (source && digest(await fs.readFile(source, 'utf8')) !== digest(xml)) throw new Error('Save the canvas before moving it into sharing.');
        const shareId = makeId();
        const folderPath = path.join(canvasesRoot, shareId);
        const filename = path.basename(input.filename || source || 'Garden.drawio');
        if (!/\.drawio$/i.test(filename)) throw new Error('Save this canvas as an XML .drawio file before sharing.');
        const diagramPath = path.join(folderPath, filename);
        const canvas = { shareId, diagramId: safeId(input.diagramId), protocolVersion: 2, replacesShareId: input.replacesShareId || null, localDeviceId: deviceId, folderId: 'trellis-v2-' + shareId, folderPath, diagramPath, filename, label: filename.replace(/\.drawio$/i, ''), coordinatorDeviceId: deviceId, coordinatorPublicKey: keys.publicKey, membershipVersion: 0, createdAt: now(), members: [{ deviceId, userId: session.userId, publicKey: keys.publicKey }], paused: false }; // CHANGE
        let registered = false;
        try {
            await fs.mkdir(folderPath, { recursive: true });
            await relocateAssets(state, source ? path.dirname(source) : input.assetBasePath || options.documentsPath, folderPath, options.privatePaths || [profile]); // CHANGE: duplicate/import snapshots reuse explicit asset relocation and installation privacy boundaries.
            const relocated = state.document.serialize();
            await writeAtomic(diagramPath, relocated);
            await collaborationStore(canvas).initialize(relocated); // CHANGE: complete verified snapshot bootstraps delta synchronization.
            if (digest(await fs.readFile(diagramPath, 'utf8')) !== digest(relocated)) throw new Error('Canvas relocation verification failed.');
            await writeAtomic(path.join(profile, 'recovery', shareId, filename), xml);
            if (digest(await fs.readFile(path.join(profile, 'recovery', shareId, filename), 'utf8')) !== digest(xml)) throw new Error('The full sharing backup could not be verified.'); // NEW: verify the complete recovery input before retiring its source.
            registry.push(canvas);
            registered = true;
            await persist();
            await publishMembership(canvas, canvas.members);
            await configureCanvas(canvas);
            // Recheck the source to avoid deleting a concurrently saved external version.
            if (source) { if (digest(await fs.readFile(source, 'utf8')) !== digest(xml)) throw new Error('The source changed during sharing setup.'); await fs.unlink(source); }
            setContext(callerId, { ...session, diagramPath });
            const startup = await enableStartup();
            emit();
            return { ...(await shareInfo({ diagramPath })), xml: relocated, filename, startup };
        } catch (err) {
            if (registered) { registry = registry.filter(entry => entry !== canvas); await persist(); try { await api('config/folders/' + encodeURIComponent(canvas.folderId), 'DELETE'); } catch (_) { } }
            // Destination is exclusively this transaction's UUID directory.
            if (!registered || !source || await exists(source)) await fs.rm(folderPath, { recursive: true, force: true });
            throw err;
        }
    }
    async function enableStartup() {
        try { // CHANGE: honor later user opt-outs rather than re-enabling startup on every Share/Join.
            const marker = path.join(profile, 'startup-configured');
            if (await exists(marker)) return { ok: true, alreadyConfigured: true };
            if (!options.setStartup) throw new Error('Startup registration is unavailable on this desktop.');
            await options.setStartup(true);
            await writeAtomic(marker, '1');
            return { ok: true };
        }
        catch (err) { return { ok: false, reason: err.message }; }
    }
    async function publishMembership(canvas, members, lifecycle = {}) { // CHANGE
        if (canvas.coordinatorDeviceId !== deviceId) throw new Error('Only the designated coordinator can publish membership.');
        const retiredMembers = [...(canvas.retiredMembers || [])]; // NEW: signed cutoffs preserve known historical records after device removal.
        for (const member of canvas.members.filter(m => !members.some(next => next.deviceId === m.deviceId))) { // CHANGE: both protocols retain signer keys for departure receipt delivery.
            const directory = path.join(canvas.folderPath, '.trellis', 'collaboration-v2', 'records'), recordIds = []; // NEW
            for (const name of await fs.readdir(directory).catch(() => [])) if (/^[a-zA-Z0-9_-]+\.json$/.test(name)) { // CHANGE
                try { const record = JSON.parse(await fs.readFile(path.join(directory, name), 'utf8')); if (record.payload?.deviceId === member.deviceId && record.payload?.shareId === canvas.shareId && record.payload.id + '.json' === name && verifyRecord(record, member.publicKey)) recordIds.push(record.payload.id); } catch (_) {} // NEW
            } // NEW
            retiredMembers.push({ ...member, recordIds: recordIds.sort(), retiredAt: now() }); // NEW
        } // NEW
        const payload = { schema: SHARE_SCHEMA, shareId: canvas.shareId, diagramId: canvas.diagramId, version: (canvas.membershipVersion || 0) + 1, coordinatorDeviceId: deviceId, members, retiredMembers, timestamp: now(), ...lifecycle }; // CHANGE
        const record = signRecord(payload, keys.privateKey);
        await writeImmutable(path.join(canvas.folderPath, '.trellis', 'membership', String(payload.version).padStart(12, '0') + '.json'), record);
        canvas.members = members;
        canvas.retiredMembers = retiredMembers; // NEW
        canvas.membershipVersion = payload.version;
        applyCoordinatorTransition(canvas, payload); // NEW
        await persist();
    }
    async function createInviteBlock(callerId, input) {
        const canvas = canvasById(input.shareId);
        const session = authorizeCanvas(callerId, canvas);
        const state = await canvasState(canvas);
        const invite = (state.store.invites || []).find(entry => entry.id === input.inviteId && entry.status === 'pending' && entry.expiresAt > now());
        if (!invite || !(activeAdmin(state, session.userId) || invite.createdBy === session.userId)) throw new Error('Save a valid invitation before preparing its sharing block.');
        if (!input.code || typeof input.code !== 'string') throw new Error('An invite code is required.');
        if (invite.codeHash && invite.codeHash !== inviteFingerprint(input.code, invite.codeSalt)) throw new Error('The invitation code has rotated. Prepare the current invitation instead.');
        return { ok: true, block: encodeBlock('INVITE', { schema: 2, protocolVersion: 2, shareId: canvas.shareId, diagramId: canvas.diagramId, deviceId: canvas.coordinatorDeviceId, senderDeviceId: deviceId, coordinatorDeviceId: canvas.coordinatorDeviceId, coordinatorPublicKey: canvas.coordinatorPublicKey, originCoordinatorDeviceId: canvas.coordinatorHistory?.[0]?.deviceId || canvas.coordinatorDeviceId, genesisCoordinatorPublicKey: canvas.genesisCoordinatorPublicKey || canvas.coordinatorPublicKey, folderId: canvas.folderId, filename: 'Garden.drawio', label: canvas.projectName || canvas.label, inviteId: invite.id, email: invite.email, pendingUserId: invite.pendingUserId, code: input.code, codeHash: invite.codeHash || null, expiresAt: invite.expiresAt, membershipVersion: canvas.membershipVersion }) }; // CHANGE: preserve sender identity separately from the fixed coordinator.
    }
    /** Issue a separate device setup invitation without recreating an existing account. */
    async function createDeviceInvite(callerId, input) {
        const canvas = canvasById(input.shareId);
        const { session, state } = await requireAdmin(callerId, canvas);
        const user = (state.store.users || []).find(entry => entry.id === input.userId && !entry.disabled);
        if (!user || !user.email || !hasCanvasAccess(state, user.id, now())) throw new Error('Select an active user with an email and canvas access.');
        const setup = signRecord({ schema: SHARE_SCHEMA, id: makeId(), shareId: canvas.shareId, diagramId: canvas.diagramId, issuerDeviceId: deviceId, actorUserId: session.userId, userId: user.id, email: user.email, expiresAt: now() + 14 * 86400000 }, keys.privateKey);
        return { ok: true, email: user.email, block: encodeBlock('INVITE', { schema: 2, protocolVersion: 2, shareId: canvas.shareId, diagramId: canvas.diagramId, deviceId: canvas.coordinatorDeviceId, senderDeviceId: deviceId, coordinatorDeviceId: canvas.coordinatorDeviceId, coordinatorPublicKey: canvas.coordinatorPublicKey, originCoordinatorDeviceId: canvas.coordinatorHistory?.[0]?.deviceId || canvas.coordinatorDeviceId, genesisCoordinatorPublicKey: canvas.genesisCoordinatorPublicKey || canvas.coordinatorPublicKey, folderId: canvas.folderId, filename: 'Garden.drawio', label: canvas.projectName || canvas.label, inviteId: setup.payload.id, email: user.email, pendingUserId: user.id, expiresAt: setup.payload.expiresAt, membershipVersion: canvas.membershipVersion, deviceSetup: setup }) }; // CHANGE
    }
    async function joinCanvas(input) {
        const invite = decodeBlock('INVITE', input.block); // CHANGE
        await start();
        if (!invite.email || (!invite.code && !invite.deviceSetup) || invite.expiresAt <= now()) throw new Error('The canvas invitation has expired or is incomplete.');
        if (invite.folderId !== 'trellis-v2-' + invite.shareId || !invite.coordinatorPublicKey) throw new Error('Invalid canvas sharing details.'); // CHANGE
        if (path.basename(invite.filename || '') !== invite.filename || !/\.drawio$/i.test(invite.filename)) throw new Error('Invalid shared canvas filename.');
        const previous = registry.find(entry => entry.shareId === invite.shareId); // CHANGE
        if (previous && (previous.projectRetired !== 'left' || !Number.isSafeInteger(invite.membershipVersion) || invite.membershipVersion < previous.membershipVersion || (previous.retiredInviteIds || []).includes(invite.inviteId) || previous.joinInvite?.inviteId === invite.inviteId)) throw new Error('This device has already joined this canvas, or the invitation predates departure. Request a fresh invitation.'); // CHANGE
        const folderPath = path.join(canvasesRoot, invite.shareId);
        if (await exists(folderPath)) throw new Error('The destination folder already exists. Choose recovery instead of overwriting it.');
        const canvas = { protocolVersion: 2, localDeviceId: deviceId, shareId: invite.shareId, diagramId: invite.diagramId, folderId: invite.folderId, filename: invite.filename, diagramPath: path.join(folderPath, invite.filename), folderPath, label: invite.label, coordinatorDeviceId: invite.originCoordinatorDeviceId || invite.deviceId, coordinatorPublicKey: invite.genesisCoordinatorPublicKey || invite.coordinatorPublicKey, genesisCoordinatorPublicKey: invite.genesisCoordinatorPublicKey, membershipVersion: 0, createdAt: now(), pending: true, members: [{ deviceId: invite.deviceId, publicKey: invite.coordinatorPublicKey, userId: '' }], joinInvite: { inviteId: invite.inviteId, pendingUserId: invite.pendingUserId, email: invite.email, expiresAt: invite.expiresAt } }; // CHANGE
        canvas.joinMembershipVersion = invite.membershipVersion || 0; canvas.bootstrapMembers = [...canvas.members]; // NEW
        await fs.mkdir(folderPath, { recursive: true });
        if (previous) { canvas.rejoined = true; registry = registry.filter(entry => entry !== previous); collaborationStores.delete(previous.shareId); } // NEW
        registry.push(canvas);
        try { await persist(); await configureCanvas(canvas); }
        catch (err) { registry = registry.filter(entry => entry !== canvas); if (previous) registry.push(previous); await persist(); try { await api('config/folders/' + encodeURIComponent(canvas.folderId), 'DELETE'); } catch (_) {} await fs.rm(folderPath, { recursive: true, force: true }); throw err; } // CHANGE
        const reply = encodeBlock('REPLY', { schema: 2, protocolVersion: 2, shareId: invite.shareId, diagramId: invite.diagramId, deviceId, publicKey: keys.publicKey, inviteId: invite.inviteId, userId: invite.pendingUserId, email: invite.email, expiresAt: invite.expiresAt, codeHash: invite.codeHash || null, ...(invite.deviceSetup ? { deviceSetup: invite.deviceSetup } : {}) }); // CHANGE
        const startup = await enableStartup();
        emit();
        return { ok: true, reply, diagramPath: canvas.diagramPath, startup, emailDraft: { to: input.senderEmail || '', subject: 'Trellis canvas device approval', body: 'Please approve this device for the canvas invitation.\n\n' + reply } };
    }
    async function requestMembership(callerId, input) { // CHANGE
        await initialize(); const canvas = canvasById(input.shareId); // CHANGE
        await start();
        const { session } = await requireAdmin(callerId, canvas);
        if (!['approve', 'remove'].includes(input.operation)) throw new Error('Unsupported membership operation.');
        const request = { schema: SHARE_SCHEMA, id: makeId(), shareId: canvas.shareId, diagramId: canvas.diagramId, version: canvas.membershipVersion, actorUserId: session.userId, deviceId, operation: input.operation, reply: input.reply || null, targetDeviceId: input.targetDeviceId || null, createdAt: now() };
        await writeImmutable(path.join(canvas.folderPath, '.trellis', 'requests', request.id + '.json'), signRecord(request, keys.privateKey));
        await poll();
        return { ok: true, requestId: request.id, status: 'pending' };
    }
    async function processRequests(canvas, state) {
        const dir = path.join(canvas.folderPath, '.trellis', 'requests');
        for (const name of await fs.readdir(dir).catch(() => [])) {
            if (!/^[a-zA-Z0-9_-]+\.json$/.test(name)) continue;
            const ackPath = path.join(canvas.folderPath, '.trellis', 'acknowledgements', name);
            if (await exists(ackPath)) continue;
            let request; // CHANGE: corrupt requests are rejected without blocking the queue.
            let reason = '';
            try {
                const record = JSON.parse(await fs.readFile(path.join(dir, name), 'utf8'));
                request = record.payload;
                if (!request || request.id + '.json' !== name || request.shareId !== canvas.shareId || request.diagramId !== canvas.diagramId) throw new Error('Request belongs to another canvas.');
                const member = canvas.members.find(entry => entry.deviceId === request.deviceId); // CHANGE: admins may log in on an already approved computer.
                if (!member || !verifyRecord(record, member.publicKey) || !activeAdmin(state, request.actorUserId)) throw new Error('Request does not belong to an active admin on an approved device.');
                if (request.version !== canvas.membershipVersion) throw new Error('Membership changed. Refresh and resubmit this request.');
                let members = canvas.members.slice();
                if (request.operation === 'approve') {
                    const reply = decodeBlock('REPLY', request.reply);
                    const invite = (state.store.invites || []).find(entry => entry.id === reply.inviteId && entry.pendingUserId === reply.userId && entry.email.toLowerCase() === reply.email.toLowerCase());
                    let validInvitation = invite && ['pending', 'accepted'].includes(invite.status) && (invite.status !== 'pending' || invite.expiresAt > now()) && (!invite.codeHash || invite.codeHash === reply.codeHash);
                    if (reply.deviceSetup) {
                        const setup = reply.deviceSetup.payload;
                        const issuer = canvas.members.find(entry => entry.deviceId === setup?.issuerDeviceId);
                        const user = (state.store.users || []).find(entry => entry.id === reply.userId && !entry.disabled);
                        validInvitation = issuer && verifyRecord(reply.deviceSetup, issuer.publicKey) && activeAdmin(state, setup.actorUserId) && setup.shareId === canvas.shareId && setup.diagramId === canvas.diagramId && setup.id === reply.inviteId && setup.userId === reply.userId && setup.email === reply.email && setup.expiresAt > now() && user?.email === reply.email;
                        if ((await fs.readdir(path.join(canvas.folderPath, '.trellis', 'device-setups')).catch(() => [])).includes(reply.inviteId + '.json')) throw new Error('This device setup invitation was already used.');
                    }
                    if (reply.shareId !== canvas.shareId || reply.diagramId !== canvas.diagramId || !validInvitation || reply.expiresAt <= now() || !hasCanvasAccess(state, reply.userId, now())) throw new Error('Invitation is mismatched, revoked, expired, or has no access.');
                    if (!reply.publicKey || members.some(entry => entry.deviceId === reply.deviceId)) throw new Error('Device already approved or reply is incomplete.');
                    crypto.createPublicKey(reply.publicKey);
                    members.push({ deviceId: reply.deviceId, userId: reply.userId, publicKey: reply.publicKey });
                    if (reply.deviceSetup) await writeImmutable(path.join(canvas.folderPath, '.trellis', 'device-setups', safeId(reply.inviteId) + '.json'), signRecord({ setupId: reply.inviteId, deviceId: reply.deviceId }, keys.privateKey));
                } else if (request.operation === 'remove') {
                    if (request.targetDeviceId === canvas.coordinatorDeviceId) throw new Error('Recover the canvas to replace its coordinator.');
                    members = members.filter(entry => entry.deviceId !== request.targetDeviceId);
                } else throw new Error('Unsupported membership operation.');
                await publishMembership(canvas, members);
                await configureCanvas(canvas);
            } catch (err) { reason = err.message; }
            await writeImmutable(ackPath, signRecord({ schema: SHARE_SCHEMA, requestId: request?.id || name.slice(0, -5), shareId: canvas.shareId, status: reason ? 'rejected' : 'applied', reason, membershipVersion: canvas.membershipVersion, timestamp: now() }, keys.privateKey));
        }
    }
    /** A transition is signed by the previously pinned coordinator, then pins its successor. */ // NEW
    function applyCoordinatorTransition(canvas, payload) { // NEW
        if (payload.departure) { canvas.departureCommits = [...(canvas.departureCommits || []), { ...payload.departure, membershipVersion: payload.version }]; } // CHANGE
        if (!payload.nextCoordinator) return; // NEW
        const next = payload.nextCoordinator; // NEW
        if (!payload.members.some(m => m.deviceId === next.deviceId && m.publicKey === next.publicKey)) throw new Error('The successor is not an approved remaining member.'); // NEW
        crypto.createPublicKey(next.publicKey); // NEW
        canvas.genesisCoordinatorPublicKey ||= canvas.coordinatorPublicKey; // NEW
        canvas.coordinatorHistory = [...(canvas.coordinatorHistory || []), { deviceId: canvas.coordinatorDeviceId, publicKey: canvas.coordinatorPublicKey, version: payload.version }]; // NEW
        canvas.coordinatorDeviceId = next.deviceId; canvas.coordinatorPublicKey = next.publicKey; // NEW
    } // NEW
    async function applyMembership(canvas) {
        const dir = path.join(canvas.folderPath, '.trellis', 'membership');
        const names = (await fs.readdir(dir).catch(() => [])).filter(name => /^\d{12}\.json$/.test(name)).sort(); // CHANGE: replay the signed coordinator chain in order.
        for (const name of names) {
            const record = JSON.parse(await fs.readFile(path.join(dir, name), 'utf8'));
            const payload = record.payload;
            if (payload.version <= canvas.membershipVersion) continue; // NEW
            if (!verifyRecord(record, canvas.coordinatorPublicKey) || payload.shareId !== canvas.shareId || payload.diagramId !== canvas.diagramId || payload.coordinatorDeviceId !== canvas.coordinatorDeviceId || !Array.isArray(payload.members)) throw new Error('Invalid canvas membership signature.');
            if (payload.version !== canvas.membershipVersion + 1) throw new Error('Waiting for a predecessor membership record.'); // CHANGE
            if (new Set(payload.members.map(entry => entry.deviceId)).size !== payload.members.length) throw new Error('Duplicate canvas membership devices.');
            canvas.members = payload.members;
            canvas.retiredMembers = payload.retiredMembers || []; // NEW: this cutoff is verified with the pinned coordinator key above.
            canvas.membershipVersion = payload.version;
            applyCoordinatorTransition(canvas, payload); // NEW
            const included = payload.members.some(entry => entry.deviceId === deviceId);
            if (canvas.pending && (!included || payload.version <= (canvas.joinMembershipVersion || 0))) { await persist(); continue; } // CHANGE: historical inclusion cannot approve a fresh rejoin.
            if (!included && !canvas.departureRequestId) { canvas.paused = true; canvas.revoked = true; } // CHANGE: keep the departure receipt channel alive until acknowledged.
            else { if (canvas.pending) { canvas.revoked = false; canvas.paused = false; } canvas.pending = false; } // CHANGE
            await persist();
            await configureCanvas(canvas);
        }
    }
    /** Explicit refresh callers wait for delivery already in progress and coalesce one follow-up scan. */ // NEW
    function poll() { // NEW
        pollRequested = true; if (pollTask) return pollTask; if (!runtimeReady) return Promise.resolve(); // NEW
        const generation = lifecycleGeneration; // NEW
        pollTask = (async () => { do { pollRequested = false; await pollOnce(); } while (pollRequested && runtimeReady && !stopped && generation === lifecycleGeneration); })().finally(() => { pollTask = null; }); // NEW
        return pollTask; // NEW
    } // NEW
    /** Coalesce one lightweight daemon request; lifecycle checks reject late observations. */ // NEW
    function sampleConnections(force = false) { // CHANGE
        if (presenceTask) return presenceTask; // NEW
        if (!runtimeReady || stopped) return Promise.resolve({}); // NEW
        if (!force && connectionSnapshot?.generation === lifecycleGeneration && now() - connectionSnapshot.at < 1000) return Promise.resolve(connectionSnapshot.connections); // CHANGE
        const generation = lifecycleGeneration; // NEW
        const task = api('system/connections').then(result => { // NEW
            if (stopped || generation !== lifecycleGeneration) return {}; // NEW
            const connections = result.connections || {}; connectionSnapshot = { connections, at: now(), generation }; return connections; // NEW
        }).catch(error => { if (generation === lifecycleGeneration) connectionSnapshot = null; throw error; }).finally(() => { if (presenceTask === task) presenceTask = null; }); // NEW
        presenceTask = task; return task; // NEW
    } // NEW
    async function pollOnce() { // CHANGE
        if (polling || !runtimeReady) return;
        const generation = lifecycleGeneration; // NEW
        polling = true;
        try {
            const connections = await sampleConnections(true); // CHANGE: an explicit poll must observe failures immediately.
            if (stopped || generation !== lifecycleGeneration) return; // NEW
            connectionSnapshot = { connections, at: now(), generation }; // NEW
            for (const canvas of registry) {
                if (stopped || generation !== lifecycleGeneration) return; // NEW
                if (canvas.localRemoved) continue; // NEW: a retained catalog registration is not a materialized sync folder.
                try {
                    await applyMembership(canvas);
                    await projectTransport.refresh(canvas); // NEW
                    const collaboration = !canvas.pending ? await collaborationStore(canvas).refresh() : null; // CHANGE: replay immutable records before reading this computer's projection.
                    const state = await exists(canvas.diagramPath) ? await canvasState(canvas) : null;
                    let historyWarning = ''; // NEW: history maintenance failures must not stop document collaboration.
                    if (state && options.historyService && !canvas.pending && !canvas.revoked) try { const maintenance = await historyTransport(canvas).maintain(); if (maintenance.errors?.length) historyWarning = maintenance.errors[0].reason; } catch (error) { historyWarning = error.message; } // NEW
                    if (state && canvas.coordinatorDeviceId === deviceId) { // CHANGE
                        const members = canvas.members.filter(member => member.deviceId === deviceId || hasCanvasAccess(state, member.userId, now()));
                        if (members.length !== canvas.members.length) { await publishMembership(canvas, members); await configureCanvas(canvas); }
                        await processRequests(canvas, state);
                    }
                    if (state) await communities.refresh(canvas); // CHANGE
                    const users = new Map();
                    if (state) for (const member of canvas.members) {
                        const user = (state.store.users || []).find(entry => entry.id === member.userId && !entry.disabled);
                        if (member.deviceId !== deviceId && user && connections[member.deviceId]?.connected) users.set(user.id, { id: user.id, name: user.name });
                    }
                    const db = await api('db/status?folder=' + encodeURIComponent(canvas.folderId));
                    if (stopped || generation !== lifecycleGeneration) return; // NEW
                    const eligibleMembers = canvas.members.filter(member => !identitySync?.revokedSyncthingIds?.includes(member.deviceId) && (!state || hasCanvasAccess(state, member.userId, now()))); // NEW
                    const seeds = canvas.paused || canvas.revoked ? 0 : await countProjectSeeds({ members: eligibleMembers, deviceId, connections, hasLocalCopy: !!state, completion: peerId => api('db/completion?folder=' + encodeURIComponent(canvas.folderId) + (peerId === deviceId ? '' : '&device=' + encodeURIComponent(peerId))) }); // NEW
                    if (stopped || generation !== lifecycleGeneration) return; // NEW
                    statuses.set(canvas.shareId, { state: canvas.revoked ? 'revoked' : canvas.pending ? 'awaitingApproval' : canvas.paused ? 'paused' : db.state === 'idle' && !db.needTotalItems ? 'upToDate' : 'syncing', folderSequence: Number.isSafeInteger(db.sequence) ? db.sequence : null, connectedCollaborators: users.size, collaborators: [...users.values()], connectedPeers: canvas.members.filter(m => m.deviceId !== deviceId && connections[m.deviceId]?.connected).length, seeds, collaboration, protocolVersion: 2, coordinatorConnected: canvas.coordinatorDeviceId === deviceId || !!connections[canvas.coordinatorDeviceId]?.connected, historyWarning, reason: '' }); // CHANGE: folder sequence also detects assets transferred entirely between status ticks.
                } catch (err) { if (stopped || generation !== lifecycleGeneration) return; statuses.set(canvas.shareId, { state: 'unavailable', connectedCollaborators: null, reason: err.message }); } // CHANGE
            }
            emit();
        } catch (error) { connectionSnapshot = null; throw error; } finally { polling = false; } // CHANGE
    }
    async function setPaused(input) { // CHANGE
        await initialize(); // CHANGE
        if (input.shareId) canvasById(input.shareId); // CHANGE: a local-only target cannot launch a sharing daemon.
        await start();
        const targets = input.shareId ? [canvasById(input.shareId)] : registry.filter(canvas => !canvas.localRemoved && !canvas.revoked); // CHANGE: retired folders must not block Resume All for active shares and identity metadata.
        for (const canvas of targets) { if (canvas.revoked && !input.paused) throw new Error('This device has been removed from the canvas.'); canvas.paused = !!input.paused; await configureCanvas(canvas); }
        await persist();
        if (!input.shareId && identitySync) { identitySync.paused = !!input.paused; await writeAtomic(path.join(profile, 'identity-sync.json'), JSON.stringify(identitySync)); await configureMetadataFolder(); } // NEW: Pause All includes the identity catalog/events folder.
        if (!input.shareId) await metadataChannels.pause(input.paused); // NEW
        emit();
        return { ok: true };
    }
    async function setPausedForContext(callerId, input) { // NEW: renderer controls only its open canvas; tray may control all.
        authorizeCanvas(callerId, canvasById(input.shareId));
        return setPaused(input);
    }
    async function listRequests(callerId, input) {
        const canvas = canvasById(input.shareId);
        authorizeCanvas(callerId, canvas);
        const dir = path.join(canvas.folderPath, '.trellis', 'requests');
        const result = [];
        for (const name of await fs.readdir(dir).catch(() => [])) if (/^[a-zA-Z0-9_-]+\.json$/.test(name)) {
            const record = JSON.parse(await fs.readFile(path.join(dir, name), 'utf8'));
            const ack = await fs.readFile(path.join(canvas.folderPath, '.trellis', 'acknowledgements', name), 'utf8').then(JSON.parse).catch(() => null);
            const confirmed = ack && verifyRecord(ack, canvas.coordinatorPublicKey) && ack.payload.shareId === canvas.shareId && ack.payload.requestId === record.payload?.id && ['applied', 'rejected'].includes(ack.payload.status); // NEW: a valid acknowledgement for another request cannot complete this approval.
            result.push({ id: record.payload?.id, operation: record.payload?.operation, status: confirmed ? ack.payload.status : 'pending', reason: confirmed ? ack.payload.reason : '' }); // CHANGE
        }
        const state = await canvasState(canvas); // NEW
        const eligibleUsers = (state.store.users || []).filter(user => !user.disabled && user.email && hasCanvasAccess(state, user.id, now())).map(user => ({ id: user.id, name: user.name, email: user.email })); // NEW
        return { ok: true, requests: result, eligibleUsers, members: canvas.members.map(member => ({ deviceId: member.deviceId, userId: member.userId })) }; // CHANGE
    }
    async function saveRecoveryCopy(callerId, input) {
        const canvas = canvasById(input.shareId);
        authorizeCanvas(callerId, canvas);
        inspectDiagram(input.xml);
        return { ok: true, ...(await collaborationStore(canvas).saveRecovery(input.xml)) }; // CHANGE: journal recovery stays private and indexed.
    }
    async function assetPath(callerId, input) {
        await initialize(); // CHANGE
        const canvas = registry.find(entry => entry.shareId === input.shareId) || localCanvases.find(entry => entry.shareId === input.shareId); // CHANGE
        if (!canvas) throw new Error('Unknown diagram assets.'); // CHANGE
        authorizeCanvas(callerId, canvas);
        if (localCanvases.includes(canvas) && !(await localCanvasListing(canvas)).available) throw new Error('Local diagram is unavailable.'); // CHANGE
        if (!/^assets\/[a-f0-9]{16}(?:\.[a-z0-9_-]+)?$/.test(input.relativePath || '')) throw new Error('Invalid shared asset reference.');
        const filename = await fs.realpath(path.join(canvas.folderPath, input.relativePath));
        const root = await fs.realpath(path.join(canvas.folderPath, 'assets'));
        if (!samePath(path.dirname(root), await fs.realpath(canvas.folderPath))) throw new Error('Assets are outside the registered diagram folder.'); // CHANGE
        if (path.relative(root, filename).startsWith('..') || path.isAbsolute(path.relative(root, filename)) || !(await fs.stat(filename)).isFile()) throw new Error('Shared asset is outside the managed assets directory.');
        return filename;
    }
    /** Permit only image requests for this renderer's registered, explicitly copied assets. */
    async function isManagedAssetRequest(callerId, requestUrl) { // NEW: used only by Electron's file-request filter, not exposed over IPC.
        try {
            const filename = fileURLToPath(requestUrl);
            const session = sessions.get(callerId);
            const canvas = [...registry, ...localCanvases].find(entry => session && samePath(entry.diagramPath, session.diagramPath) && entry.diagramId === session.diagramId); // CHANGE
            if (!canvas || !samePath(path.dirname(filename), path.join(canvas.folderPath, 'assets'))) return false;
            await assetPath(callerId, { shareId: canvas.shareId, relativePath: 'assets/' + path.basename(filename) });
            return true;
        } catch (_) { return false; }
    }
    const historyTransports = new Map(); // NEW
    function historyTransport(canvas) { // NEW
        if (!options.historyService) throw new Error('Document history service is unavailable.');
        if (!historyTransports.has(canvas.shareId)) historyTransports.set(canvas.shareId, createHistoryTransport({ canvas, deviceId: deviceId || canvas.localDeviceId, keys, profile, history: options.historyService, writeImmutable }));
        return historyTransports.get(canvas.shareId);
    }
    async function exportHistory(callerId, input) { // CHANGE
        const canvas = canvasById(input.shareId); authorizeCanvas(callerId, canvas);
        const savedXml = await fs.readFile(canvas.diagramPath, 'utf8');
        if (digest(savedXml) !== input.savedHash) throw new Error('History does not match the saved canvas version.');
        for (const entry of input.entries || []) if (entry.revision?.diagramHistoryId !== canvas.diagramId || !Number.isFinite(entry.revision.timestamp)) throw new Error('Invalid shared history entry.');
        return historyTransport(canvas).publish(savedXml, (input.entries || []).map(entry => safeId(entry.revision.id)));
    }
    async function importHistory(callerId, input) { // CHANGE
        const canvas = canvasById(input.shareId); authorizeCanvas(callerId, canvas);
        return historyTransport(canvas).importAll(input.knownIds || []);
    }
    async function historyStorage(callerId, input) { // NEW
        const canvas = canvasById(input.shareId); authorizeCanvas(callerId, canvas);
        return historyTransport(canvas).statistics();
    }
    async function recovery(callerId, input) {
        const old = canvasById(input.shareId);
        await requireAdmin(callerId, old);
        const xml = await fs.readFile(old.diagramPath, 'utf8');
        // Retire locally first. Existing remote peers retain their old share until re-paired.
        const wasPaused = old.paused;
        old.paused = true;
        await configureCanvas(old);
        const session = sessions.get(callerId);
        sessions.set(callerId, { ...session, diagramPath: path.join(old.folderPath, 'recovery-source.drawio') });
        const source = sessions.get(callerId).diagramPath;
        await writeAtomic(source, xml);
        try { const result = await setupCanvas(callerId, { diagramPath: source, diagramId: old.diagramId, filename: old.filename, xml, protocolVersion: 2, replacesShareId: old.shareId }); await persist(); return result; } // CHANGE
        catch (err) { sessions.set(callerId, session); old.paused = wasPaused; await configureCanvas(old); await persist(); throw err; }
        finally { await fs.rm(source, { force: true }); }
    }
    return { memberConnections, communities, configureMetadataChannel: metadataChannels.configure, hasBackgroundWork: () => registry.some(canvas => !canvas.localRemoved && !canvas.revoked), backgroundStatus: () => ({ state: !runtimeReady ? 'unavailable' : identitySync?.paused ? 'paused' : 'syncing', reason: lastError }), initialize, start, stop, poll, setProjectNaming, collaborationAction, shareInfo, setupCanvas, createInviteBlock, createDeviceInvite, joinCanvas, requestMembership, listRequests, setPaused, setPausedForContext, saveRecoveryCopy, assetPath, isManagedAssetRequest, exportHistory, importHistory, historyStorage, recovery, setContext, forgetContext: id => { sessions.delete(id); for (const store of collaborationStores.values()) store.forget(id); }, listStatus, hasCanvases: () => registry.length > 0, onStatus: listener => { events.on('status', listener); return () => events.off('status', listener); }, savedHash: digest, listCanvases, getRegistrationIssues: () => registrationIssues.map(issue => ({ ...issue })), getTransportIdentity, configureIdentityMetadata, approveLibraryDevice, registerLibraryDownload, removeLibraryDownload, libraryDescriptor, ...projectTransport }; // CHANGE: reuse the managed sharing engine for identity and community metadata.
}
