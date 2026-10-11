// NEW: Main-process owner of managed canvases, Syncthing, and per-canvas membership.
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { EventEmitter } from 'node:events';
import { SYNCTHING_VERSION, SHARE_SCHEMA, digest, makeId, safeId, canonical, signRecord, verifyRecord, parseXml, inspectDiagram, activeAdmin, hasCanvasAccess, preserveAccess, encodeBlock, decodeBlock, inviteFingerprint } from './trellis-share-protocol.js';
import { XMLSerializer } from '@xmldom/xmldom'; // NEW: configuration edits use the same structured XML parser.
import { verifyMacResigning } from './trellis-binary-integrity.js'; // NEW
import { compareDiagramVersions } from './trellis-share-protocol.js'; // NEW
import { assertSharingFileAccess } from './trellis-sharing-files.js'; // NEW

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const exists = async filename => { try { await fs.access(filename); return true; } catch (_) { return false; } };
const samePath = (a, b) => process.platform === 'win32' ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase() : path.resolve(a) === path.resolve(b);
async function writeAtomic(filename, data) {
    await fs.mkdir(path.dirname(filename), { recursive: true });
    const temporary = filename + '.' + makeId() + '.tmp';
    try { await fs.writeFile(temporary, data, { mode: 0o600 }); await fs.rename(temporary, filename); }
    finally { await fs.rm(temporary, { force: true }); }
}
async function writeImmutable(filename, value) {
    const serialized = JSON.stringify(value);
    await fs.mkdir(path.dirname(filename), { recursive: true });
    try { await fs.writeFile(filename, serialized, { flag: 'wx', mode: 0o600 }); }
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
async function relocateAssets(state, base, destination, profilePath) { // CHANGE: never export the installation's private service files as diagram assets.
    const copied = new Map();
    const missing = new Set();
    async function replace(value) {
        const source = localReference(value, base);
        if (!source) return value;
        await assertSharingFileAccess(source, profilePath); // NEW
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
    const profile = path.join(options.userDataPath, 'trellis-sharing');
    const canvasesRoot = path.join(options.documentsPath, 'Trellis', 'Shared Canvases');
    const registryPath = path.join(profile, 'canvases.json');
    let registry = [];
    let keys;
    let deviceId = '';
    let apiKey = '';
    let apiAddress = '';
    let child = null;
    let identityChild = null;
    let lifecycleGeneration = 0;
    let initialization;
    let starting;
    let stopped = true;
    let retries = 0;
    let restartTimer = null; // NEW: one bounded restart schedule per daemon lifecycle.
    let timer;
    let polling = false;
    let lastError = '';
    let runtimeReady = false;
    const sessions = new Map();
    const statuses = new Map();
    const localConflicts = new Map();
    const fetchApi = options.fetch || globalThis.fetch;
    const launch = options.spawn || spawn;
    const now = options.now || Date.now;

    async function initialize() {
        if (initialization) return initialization;
        initialization = (async () => {
            await fs.mkdir(profile, { recursive: true, mode: 0o700 });
            registry = await fs.readFile(registryPath, 'utf8').then(JSON.parse).catch(err => { if (err.code === 'ENOENT') return []; throw err; });
            if (!Array.isArray(registry)) throw new Error('Invalid sharing registry.');
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
    async function persist() { await writeAtomic(registryPath, JSON.stringify(registry)); }
    function emit() { events.emit('status', listStatus()); }
    function listStatus(callerId) {
        return registry.map(canvas => {
            const status = statuses.get(canvas.shareId) || {};
            const session = sessions.get(callerId);
            const localUserId = session && samePath(session.diagramPath, canvas.diagramPath) ? session.userId : canvas.members.find(member => member.deviceId === deviceId)?.userId;
            const collaborators = (status.collaborators || []).filter(user => user.id !== localUserId);
            return { shareId: canvas.shareId, diagramId: canvas.diagramId, label: canvas.label, diagramPath: canvas.diagramPath, pending: !!canvas.pending, state: canvas.paused ? 'paused' : 'syncing', reason: lastError, ...status, collaborators, connectedCollaborators: status.connectedCollaborators == null ? null : collaborators.length, ...(!runtimeReady ? { state: 'unavailable', reason: lastError || 'Syncthing is not running.', connectedCollaborators: null } : {}) };
        }); // CHANGE: counts exclude the current window's actor; tray-only devices use their associated account.
    }
    async function api(endpoint, method = 'GET', data) {
        if (!apiAddress) throw new Error('Syncthing is not running.');
        const response = await fetchApi(apiAddress + '/rest/' + endpoint, { method, headers: { 'X-API-Key': apiKey, ...(data === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: data === undefined ? undefined : JSON.stringify(data), signal: AbortSignal.timeout(10000) });
        if (!response.ok) throw new Error('Syncthing request failed (' + response.status + ').');
        const text = await response.text();
        return text ? JSON.parse(text) : null;
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
        const requestedGeneration = lifecycleGeneration; // NEW: initialization can overlap an explicit Quit too.
        await initialize();
        if (lifecycleGeneration !== requestedGeneration) throw new Error('Sharing startup was cancelled.');
        if (runtimeReady) return { ok: true, deviceId };
        if (starting) return starting;
        const startGeneration = lifecycleGeneration;
        starting = (async () => {
            const executable = await binaryPath();
            const syncthingHome = path.join(profile, 'syncthing'); // NEW: generate identity without starting an unrelated default folder.
            const configPath = path.join(syncthingHome, 'config.xml');
            if (!await exists(configPath)) {
                await fs.mkdir(syncthingHome, { recursive: true });
                await new Promise((resolve, reject) => {
                    const generator = launch(executable, ['generate', '--home=' + syncthingHome], { windowsHide: true, stdio: 'ignore' });
                    identityChild = generator;
                    const timeout = setTimeout(() => { generator.kill(); reject(new Error('Syncthing identity generation timed out.')); }, 15000);
                    generator.once('error', err => { clearTimeout(timeout); reject(err); });
                    generator.once('exit', code => { clearTimeout(timeout); identityChild = null; code === 0 ? resolve() : reject(new Error('Syncthing identity generation failed.')); });
                });
                const config = parseXml(await fs.readFile(configPath, 'utf8'));
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
            child.on('error', err => { lastError = err.message; runtimeReady = false; emit(); });
            child.on('exit', () => {
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
            config.folders = config.folders.filter(folder => registry.some(canvas => canvas.folderId === folder.id));
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
            for (const canvas of registry) await configureCanvas(canvas);
            if (!timer) { timer = setInterval(() => poll().catch(err => { lastError = err.message; emit(); }), 5000); timer.unref(); }
            emit();
            return { ok: true, deviceId };
        })().catch(async err => { // CHANGE: transient startup failures retry without allowing Quit to resurrect the child.
            const retry = !stopped && lifecycleGeneration === startGeneration;
            lastError = err.message;
            runtimeReady = false;
            await stop();
            if (retry) { stopped = false; scheduleRestart(); }
            throw err;
        }).finally(() => { starting = null; });
        return starting;
    }
    async function stop() {
        lifecycleGeneration++;
        clearTimeout(restartTimer); // NEW: no scheduled launch survives explicit shutdown.
        restartTimer = null;
        if (identityChild) { identityChild.kill(); identityChild = null; }
        stopped = true;
        clearInterval(timer);
        timer = null;
        if (child) {
            const processToStop = child;
            try { await api('system/shutdown', 'POST'); } catch (_) { processToStop.kill(); }
            if (child === processToStop) await Promise.race([new Promise(resolve => processToStop.once('exit', resolve)), sleep(3000)]); // CHANGE: shutdown can finish before the response arrives.
            if (child === processToStop) processToStop.kill();
        }
        runtimeReady = false;
        apiAddress = '';
        emit();
    }
    function canvasById(id) {
        const canvas = registry.find(entry => entry.shareId === safeId(id));
        if (!canvas) throw new Error('This canvas is not registered for sharing.');
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
    async function configureCanvas(canvas) {
        await fs.mkdir(canvas.folderPath, { recursive: true });
        const config = await api('config');
        const peers = canvas.members || [];
        for (const peer of peers) { // CHANGE: restore registered devices from --paused without touching other installations.
            const existing = config.devices.find(entry => entry.deviceID === peer.deviceId);
            const addresses = options.deviceAddresses ? options.deviceAddresses(peer.deviceId) : ['dynamic']; // NEW: explicit addresses support isolated acceptance tests.
            if (existing) { existing.paused = false; existing.introducer = false; existing.autoAcceptFolders = false; existing.addresses = addresses; }
            else config.devices.push({ ...(config.defaults?.device || {}), deviceID: peer.deviceId, name: peer.name || peer.userId || 'Trellis collaborator', addresses, paused: false, introducer: false, autoAcceptFolders: false });
        }
        const folder = { ...(config.defaults?.folder || {}), id: canvas.folderId, label: canvas.label, path: canvas.folderPath, type: 'sendreceive', paused: !!canvas.paused, devices: [...new Set([deviceId, ...peers.map(peer => peer.deviceId)])].map(id => ({ deviceID: id })), fsWatcherEnabled: true, fsWatcherDelayS: 2, rescanIntervalS: 3600, maxConflicts: -1, versioning: { type: 'simple', params: { keep: '20', cleanoutDays: '0' } } };
        const index = config.folders.findIndex(entry => entry.id === canvas.folderId);
        if (index < 0) config.folders.push(folder); else config.folders[index] = { ...config.folders[index], ...folder };
        await api('config', 'PUT', config);
        const ext = path.extname(canvas.filename); // NEW: only canvas data and explicit protocol directories synchronize.
        const stem = canvas.filename.slice(0, -ext.length);
        await api('db/ignores?folder=' + encodeURIComponent(canvas.folderId), 'POST', { ignore: ['!/' + canvas.filename, '!/' + stem + '.sync-conflict-*' + ext, '!/assets', '!/assets/**', '!/.trellis', '!/.trellis/**', '**'] });
    }
    async function shareInfo(context = {}) {
        await initialize();
        try { await start(); } catch (err) { return { ok: false, managed: false, reason: err.message }; }
        let canvas = registry.find(entry => context.diagramPath && samePath(entry.diagramPath, context.diagramPath));
        if (!canvas && context.diagramPath) { // NEW: recognize external renames without adopting unrelated neighboring files.
            const renamed = registry.find(entry => samePath(entry.folderPath, path.dirname(context.diagramPath)));
            if (renamed && !await exists(renamed.diagramPath) && /\.drawio$/i.test(context.diagramPath) && !(await conflictFiles(renamed)).length) {
                const state = inspectDiagram(await fs.readFile(context.diagramPath, 'utf8'));
                if (!state.cells.some(cell => cell.node.getAttribute('trellis_history_id') === renamed.diagramId)) throw new Error('Renamed canvas has a different diagram identity.');
                renamed.diagramPath = path.resolve(context.diagramPath);
                renamed.filename = path.basename(context.diagramPath);
                await configureCanvas(renamed);
                await persist();
                canvas = renamed;
            }
        }
        if (!canvas) return { ok: true, managed: false, deviceId, reason: 'Set up a managed sharing folder for this canvas.' };
        return { ok: true, managed: true, deviceId, shareId: canvas.shareId, diagramId: canvas.diagramId, createdAt: canvas.createdAt, folderId: canvas.folderId, folderLabel: canvas.label, folderPath: canvas.folderPath, assetBaseUrl: pathToFileURL(canvas.folderPath + path.sep).href, diagramPath: canvas.diagramPath, coordinatorDeviceId: canvas.coordinatorDeviceId, coordinatorPublicKey: canvas.coordinatorPublicKey, membershipVersion: canvas.membershipVersion || 0 };
    }
    async function setupCanvas(callerId, input) {
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
        const canvas = { shareId, diagramId: safeId(input.diagramId), folderId: 'trellis-' + shareId, folderPath, diagramPath, filename, label: filename.replace(/\.drawio$/i, ''), coordinatorDeviceId: deviceId, coordinatorPublicKey: keys.publicKey, membershipVersion: 0, createdAt: now(), members: [{ deviceId, userId: session.userId, publicKey: keys.publicKey }], paused: false };
        let registered = false;
        try {
            await fs.mkdir(folderPath, { recursive: true });
            await relocateAssets(state, source ? path.dirname(source) : options.documentsPath, folderPath, profile); // CHANGE
            const relocated = state.document.serialize();
            await writeAtomic(diagramPath, relocated);
            if (digest(await fs.readFile(diagramPath, 'utf8')) !== digest(relocated)) throw new Error('Canvas relocation verification failed.');
            await writeAtomic(path.join(profile, 'recovery', shareId, filename), xml);
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
    async function publishMembership(canvas, members) {
        if (canvas.coordinatorDeviceId !== deviceId) throw new Error('Only the designated coordinator can publish membership.');
        const payload = { schema: SHARE_SCHEMA, shareId: canvas.shareId, diagramId: canvas.diagramId, version: (canvas.membershipVersion || 0) + 1, coordinatorDeviceId: deviceId, members, timestamp: now() };
        const record = signRecord(payload, keys.privateKey);
        await writeImmutable(path.join(canvas.folderPath, '.trellis', 'membership', String(payload.version).padStart(12, '0') + '.json'), record);
        canvas.members = members;
        canvas.membershipVersion = payload.version;
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
        return { ok: true, block: encodeBlock('INVITE', { shareId: canvas.shareId, diagramId: canvas.diagramId, deviceId: canvas.coordinatorDeviceId, senderDeviceId: deviceId, coordinatorDeviceId: canvas.coordinatorDeviceId, coordinatorPublicKey: canvas.coordinatorPublicKey, folderId: canvas.folderId, filename: canvas.filename, label: canvas.label, inviteId: invite.id, email: invite.email, pendingUserId: invite.pendingUserId, code: input.code, codeHash: invite.codeHash || null, expiresAt: invite.expiresAt, membershipVersion: canvas.membershipVersion }) }; // CHANGE: preserve sender identity separately from the fixed coordinator.
    }
    /** Issue a separate device setup invitation without recreating an existing account. */
    async function createDeviceInvite(callerId, input) {
        const canvas = canvasById(input.shareId);
        const { session, state } = await requireAdmin(callerId, canvas);
        const user = (state.store.users || []).find(entry => entry.id === input.userId && !entry.disabled);
        if (!user || !user.email || !hasCanvasAccess(state, user.id, now())) throw new Error('Select an active user with an email and canvas access.');
        const setup = signRecord({ schema: SHARE_SCHEMA, id: makeId(), shareId: canvas.shareId, diagramId: canvas.diagramId, issuerDeviceId: deviceId, actorUserId: session.userId, userId: user.id, email: user.email, expiresAt: now() + 14 * 86400000 }, keys.privateKey);
        return { ok: true, email: user.email, block: encodeBlock('INVITE', { shareId: canvas.shareId, diagramId: canvas.diagramId, deviceId: canvas.coordinatorDeviceId, senderDeviceId: deviceId, coordinatorDeviceId: canvas.coordinatorDeviceId, coordinatorPublicKey: canvas.coordinatorPublicKey, folderId: canvas.folderId, filename: canvas.filename, label: canvas.label, inviteId: setup.payload.id, email: user.email, pendingUserId: user.id, expiresAt: setup.payload.expiresAt, deviceSetup: setup }) }; // CHANGE
    }
    async function joinCanvas(input) {
        await start();
        const invite = decodeBlock('INVITE', input.block);
        if (!invite.email || (!invite.code && !invite.deviceSetup) || invite.expiresAt <= now()) throw new Error('The canvas invitation has expired or is incomplete.');
        if (invite.folderId !== 'trellis-' + invite.shareId || !invite.coordinatorPublicKey) throw new Error('Invalid canvas sharing details.');
        if (path.basename(invite.filename || '') !== invite.filename || !/\.drawio$/i.test(invite.filename)) throw new Error('Invalid shared canvas filename.');
        if (registry.some(entry => entry.shareId === invite.shareId)) throw new Error('This device has already joined this canvas.');
        const folderPath = path.join(canvasesRoot, invite.shareId);
        if (await exists(folderPath)) throw new Error('The destination folder already exists. Choose recovery instead of overwriting it.');
        const canvas = { shareId: invite.shareId, diagramId: invite.diagramId, folderId: invite.folderId, filename: invite.filename, diagramPath: path.join(folderPath, invite.filename), folderPath, label: invite.label, coordinatorDeviceId: invite.deviceId, coordinatorPublicKey: invite.coordinatorPublicKey, membershipVersion: 0, createdAt: now(), pending: true, members: [{ deviceId: invite.deviceId, publicKey: invite.coordinatorPublicKey, userId: '' }], joinInvite: { inviteId: invite.inviteId, pendingUserId: invite.pendingUserId, email: invite.email, expiresAt: invite.expiresAt } };
        await fs.mkdir(folderPath, { recursive: true });
        registry.push(canvas);
        try { await persist(); await configureCanvas(canvas); }
        catch (err) { registry = registry.filter(entry => entry !== canvas); await persist(); try { await api('config/folders/' + encodeURIComponent(canvas.folderId), 'DELETE'); } catch (_) {} await fs.rm(folderPath, { recursive: true, force: true }); throw err; }
        const reply = encodeBlock('REPLY', { shareId: invite.shareId, diagramId: invite.diagramId, deviceId, publicKey: keys.publicKey, inviteId: invite.inviteId, userId: invite.pendingUserId, email: invite.email, expiresAt: invite.expiresAt, codeHash: invite.codeHash || null, ...(invite.deviceSetup ? { deviceSetup: invite.deviceSetup } : {}) });
        const startup = await enableStartup();
        emit();
        return { ok: true, reply, diagramPath: canvas.diagramPath, startup, emailDraft: { to: input.senderEmail || '', subject: 'Trellis canvas device approval', body: 'Please approve this device for the canvas invitation.\n\n' + reply } };
    }
    async function requestMembership(callerId, input) {
        await start();
        const canvas = canvasById(input.shareId);
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
    async function applyMembership(canvas) {
        const dir = path.join(canvas.folderPath, '.trellis', 'membership');
        const names = (await fs.readdir(dir).catch(() => [])).filter(name => /^\d{12}\.json$/.test(name)).sort().reverse();
        for (const name of names) {
            const record = JSON.parse(await fs.readFile(path.join(dir, name), 'utf8'));
            const payload = record.payload;
            if (!verifyRecord(record, canvas.coordinatorPublicKey) || payload.shareId !== canvas.shareId || payload.diagramId !== canvas.diagramId || payload.coordinatorDeviceId !== canvas.coordinatorDeviceId || !Array.isArray(payload.members)) throw new Error('Invalid canvas membership signature.');
            if (payload.version <= canvas.membershipVersion) break;
            if (new Set(payload.members.map(entry => entry.deviceId)).size !== payload.members.length) throw new Error('Duplicate canvas membership devices.');
            canvas.members = payload.members;
            canvas.membershipVersion = payload.version;
            const included = payload.members.some(entry => entry.deviceId === deviceId);
            if (!included && canvas.pending) continue; // NEW: a pre-approval manifest must not permanently revoke a joining device.
            if (!included) { canvas.paused = true; canvas.revoked = true; }
            else canvas.pending = false;
            await persist();
            await configureCanvas(canvas);
            break;
        }
    }
    async function conflictFiles(canvas) {
        const names = await fs.readdir(canvas.folderPath);
        const ext = path.extname(canvas.filename);
        const stem = canvas.filename.slice(0, -ext.length);
        return names.filter(name => name.startsWith(stem + '.sync-conflict-') && name.endsWith(ext));
    }
    async function poll() {
        if (polling || !runtimeReady) return;
        polling = true;
        try {
            const connections = (await api('system/connections')).connections || {};
            for (const canvas of registry) {
                try {
                    await applyMembership(canvas);
                    const conflicts = await conflictFiles(canvas);
                    const state = await exists(canvas.diagramPath) ? await canvasState(canvas) : null;
                    const locallyConflicted = [...localConflicts.values()].includes(canvas.shareId);
                    if (state && canvas.coordinatorDeviceId === deviceId && !conflicts.length && !locallyConflicted) {
                        const members = canvas.members.filter(member => member.deviceId === deviceId || hasCanvasAccess(state, member.userId, now()));
                        if (members.length !== canvas.members.length) { await publishMembership(canvas, members); await configureCanvas(canvas); }
                        await processRequests(canvas, state);
                    }
                    const users = new Map();
                    if (state) for (const member of canvas.members) {
                        const user = (state.store.users || []).find(entry => entry.id === member.userId && !entry.disabled);
                        if (member.deviceId !== deviceId && user && connections[member.deviceId]?.connected) users.set(user.id, { id: user.id, name: user.name });
                    }
                    const db = await api('db/status?folder=' + encodeURIComponent(canvas.folderId));
                    statuses.set(canvas.shareId, { state: canvas.revoked ? 'revoked' : conflicts.length || locallyConflicted ? 'conflict' : canvas.pending ? 'awaitingApproval' : canvas.paused ? 'paused' : db.state === 'idle' && !db.needTotalItems ? 'upToDate' : 'syncing', connectedCollaborators: users.size, collaborators: [...users.values()], conflicts, coordinatorConnected: canvas.coordinatorDeviceId === deviceId || !!connections[canvas.coordinatorDeviceId]?.connected, reason: '' });
                } catch (err) { statuses.set(canvas.shareId, { state: 'unavailable', connectedCollaborators: null, reason: err.message }); }
            }
            emit();
        } finally { polling = false; }
    }
    async function setPaused(input) {
        await start();
        const targets = input.shareId ? [canvasById(input.shareId)] : registry;
        for (const canvas of targets) { if (canvas.revoked && !input.paused) throw new Error('This device has been removed from the canvas.'); canvas.paused = !!input.paused; await configureCanvas(canvas); }
        await persist();
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
            result.push({ id: record.payload?.id, operation: record.payload?.operation, status: ack && verifyRecord(ack, canvas.coordinatorPublicKey) ? ack.payload.status : 'pending', reason: ack && verifyRecord(ack, canvas.coordinatorPublicKey) ? ack.payload.reason : '' });
        }
        return { ok: true, requests: result, members: canvas.members.map(member => ({ deviceId: member.deviceId, userId: member.userId })) };
    }
    async function inspectConflict(callerId, input) {
        const canvas = canvasById(input.shareId);
        authorizeCanvas(callerId, canvas);
        const choices = [canvas.filename, ...(await conflictFiles(canvas))];
        let filename;
        if (/^local-[a-f0-9-]{36}\.drawio$/.test(input.filename || '')) filename = path.join(profile, 'recovery', canvas.shareId, input.filename);
        else if (choices.includes(input.filename)) filename = path.join(canvas.folderPath, input.filename);
        else throw new Error('Unknown canvas conflict version.');
        const xml = await fs.readFile(filename, 'utf8');
        inspectDiagram(xml);
        const currentXml = await fs.readFile(canvas.diagramPath, 'utf8'); // NEW: bind the review summary to the same current version as its hash.
        return { ok: true, xml, currentHash: digest(currentXml), chosenHash: digest(xml), differences: compareDiagramVersions(currentXml, xml) }; // CHANGE
    }
    async function setConflictState(callerId, input) {
        const canvas = canvasById(input.shareId);
        authorizeCanvas(callerId, canvas);
        if (input.conflicted) localConflicts.set(callerId, canvas.shareId);
        else localConflicts.delete(callerId);
        await poll();
        return { ok: true };
    }
    async function saveRecoveryCopy(callerId, input) {
        const canvas = canvasById(input.shareId);
        authorizeCanvas(callerId, canvas);
        inspectDiagram(input.xml);
        const filename = 'local-' + makeId() + '.drawio';
        const recoveryPath = path.join(profile, 'recovery', canvas.shareId, filename);
        await writeAtomic(recoveryPath, input.xml);
        return { ok: true, filename, recoveryPath };
    }
    async function assetPath(callerId, input) {
        const canvas = canvasById(input.shareId);
        authorizeCanvas(callerId, canvas);
        if (!/^assets\/[a-f0-9]{16}(?:\.[a-z0-9_-]+)?$/.test(input.relativePath || '')) throw new Error('Invalid shared asset reference.');
        const filename = await fs.realpath(path.join(canvas.folderPath, input.relativePath));
        const root = await fs.realpath(path.join(canvas.folderPath, 'assets'));
        if (path.relative(root, filename).startsWith('..') || path.isAbsolute(path.relative(root, filename)) || !(await fs.stat(filename)).isFile()) throw new Error('Shared asset is outside the managed assets directory.');
        return filename;
    }
    /** Permit only image requests for this renderer's registered, explicitly copied assets. */
    async function isManagedAssetRequest(callerId, requestUrl) { // NEW: used only by Electron's file-request filter, not exposed over IPC.
        try {
            const filename = fileURLToPath(requestUrl);
            const session = sessions.get(callerId);
            const canvas = registry.find(entry => session && samePath(entry.diagramPath, session.diagramPath) && entry.diagramId === session.diagramId);
            if (!canvas || !samePath(path.dirname(filename), path.join(canvas.folderPath, 'assets'))) return false;
            await assetPath(callerId, { shareId: canvas.shareId, relativePath: 'assets/' + path.basename(filename) });
            return true;
        } catch (_) { return false; }
    }
    async function resolveConflict(callerId, input) {
        const canvas = canvasById(input.shareId);
        await requireAdmin(callerId, canvas);
        const chosen = await inspectConflict(callerId, input);
        const current = await fs.readFile(canvas.diagramPath, 'utf8');
        if (input.expectedHash !== digest(current)) throw new Error('Canvas changed during conflict review. Refresh before resolving.');
        if (input.expectedChosenHash && input.expectedChosenHash !== digest(chosen.xml)) throw new Error('Reviewed version changed. Inspect it again before publishing.');
        const resolved = preserveAccess(chosen.xml, current);
        const dir = path.join(profile, 'recovery', canvas.shareId, makeId());
        const conflicts = await conflictFiles(canvas);
        for (const filename of [canvas.filename, ...conflicts]) await writeAtomic(path.join(dir, filename), await fs.readFile(path.join(canvas.folderPath, filename)));
        await writeAtomic(canvas.diagramPath, resolved);
        for (const filename of conflicts) await fs.unlink(path.join(canvas.folderPath, filename));
        for (const [caller, shareId] of localConflicts) if (shareId === canvas.shareId) localConflicts.delete(caller);
        await poll();
        return { ok: true, xml: resolved, recoveryPath: dir };
    }
    async function exportHistory(callerId, input) {
        const canvas = canvasById(input.shareId);
        authorizeCanvas(callerId, canvas);
        if (statuses.get(canvas.shareId)?.state === 'conflict') throw new Error('Resolve the canvas conflict before publishing history.');
        if (digest(await fs.readFile(canvas.diagramPath, 'utf8')) !== input.savedHash) throw new Error('History does not match the saved canvas version.');
        for (const entry of input.entries || []) {
            const { revision, snapshot } = entry;
            if (revision.diagramHistoryId !== canvas.diagramId || !Number.isFinite(revision.timestamp) || revision.timestamp < canvas.createdAt || !snapshot || revision.snapshotId !== snapshot.snapshotId) throw new Error('Invalid shared history entry.'); // CHANGE: missing timestamps must not bypass the saved-only boundary.
            safeId(revision.id);
            safeId(snapshot.snapshotId);
            const payload = { schema: SHARE_SCHEMA, diagramId: canvas.diagramId, revision, snapshot };
            await writeImmutable(path.join(canvas.folderPath, '.trellis', 'history', revision.id + '.json'), { payload, checksum: digest(canonical(payload)) });
        }
        return { ok: true };
    }
    async function importHistory(callerId, input) {
        const canvas = canvasById(input.shareId);
        authorizeCanvas(callerId, canvas);
        const dir = path.join(canvas.folderPath, '.trellis', 'history');
        const entries = [];
        const errors = [];
        const known = new Set(input.knownIds || []);
        for (const name of await fs.readdir(dir).catch(() => [])) if (/^[a-zA-Z0-9_-]+\.json$/.test(name) && !known.has(name.slice(0, -5))) {
            try {
                const stat = await fs.stat(path.join(dir, name));
                if (stat.size > 128 * 1024 * 1024) throw new Error('History export is too large.');
                const record = JSON.parse(await fs.readFile(path.join(dir, name), 'utf8'));
                const entry = record.payload;
                if (record.checksum !== digest(canonical(entry)) || entry.schema !== SHARE_SCHEMA || entry.diagramId !== canvas.diagramId || entry.revision.diagramHistoryId !== canvas.diagramId || !Number.isFinite(entry.revision.timestamp) || entry.revision.id + '.json' !== name || entry.revision.snapshotId !== entry.snapshot.snapshotId) throw new Error('Invalid history export.'); // CHANGE
                entries.push({ revision: entry.revision, snapshot: entry.snapshot });
            } catch (err) { errors.push({ filename: name, reason: err.message }); }
        }
        return { ok: true, entries, errors };
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
        try { const result = await setupCanvas(callerId, { diagramPath: source, diagramId: old.diagramId, filename: old.filename, xml }); await persist(); return result; }
        catch (err) { sessions.set(callerId, session); old.paused = wasPaused; await configureCanvas(old); await persist(); throw err; }
        finally { await fs.rm(source, { force: true }); }
    }
    return { initialize, start, stop, poll, shareInfo, setupCanvas, createInviteBlock, createDeviceInvite, joinCanvas, requestMembership, listRequests, setPaused, setPausedForContext, setConflictState, saveRecoveryCopy, assetPath, isManagedAssetRequest, inspectConflict, resolveConflict, exportHistory, importHistory, recovery, setContext, forgetContext: id => { sessions.delete(id); localConflicts.delete(id); }, listStatus, hasCanvases: () => registry.length > 0, onStatus: listener => { events.on('status', listener); return () => events.off('status', listener); }, savedHash: digest }; // CHANGE
}
