/** Main-process identity owner: protected credentials, signed events and pairing. // NEW */
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { createApiKeyStore } from './trellis-api-key-store.js'; // NEW
import '../../drawio/src/main/webapp/js/trellis-identity-protocol.js'; // NEW: the same Web Crypto module is bundled on Android.
const protocol = globalThis.TrellisIdentityProtocol;
const id = () => crypto.randomUUID();
const validId = value => { if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(value)) throw new Error('Invalid identity identifier.'); return value; };
async function atomic(filename, value) {
    await fs.mkdir(path.dirname(filename), { recursive: true, mode: 0o700 });
    const temporary = filename + '.' + id() + '.tmp';
    try { await fs.writeFile(temporary, JSON.stringify(value), { mode: 0o600 }); await fs.rename(temporary, filename); }
    finally { await fs.rm(temporary, { force: true }); }
}
async function json(filename) { return JSON.parse(await fs.readFile(filename, 'utf8')); }

/** Services are injected so identity tests never launch a daemon or touch user files. // CHANGE
 * protectSession/unprotectSession wrap strings with device-local OS protection and may be asynchronous. // NEW
 * They are only required for remembered login; public sessions never expose encrypted or raw credentials. // NEW
 */ // NEW
export function createIdentityService(options) {
    const root = path.resolve(options.root);
    const apiKeyStore = createApiKeyStore({ root, protect: options.protectSession, unprotect: options.unprotectSession }); // NEW: reuse the existing OS encryption boundary.
    let apiKeyOwner = null, apiKeySessionToken = null; // NEW: bind dialogs to a particular authenticated session, including re-login.
    const events = new EventEmitter();
    const transports = new Map();
    let index = [], active = null, initialized, loginGeneration = 0; // CHANGE: distinguish repeated logins by the same identity without retaining credentials in caches.
    let queue = Promise.resolve();
    const now = options.now || Date.now;
    const rememberedPath = path.join(root, 'remembered-session.json'); // NEW: device-local; never included in identity metadata synchronization.
    const persistenceWarning = 'You’re logged in, but Trellis couldn’t keep you logged in. Enter your password next time.'; // NEW
    const identityRoot = identityId => path.join(root, validId(identityId));
    const metadataRoot = identityId => path.join(identityRoot(identityId), 'metadata');
    const run = fn => { const task = queue.then(fn); queue = task.catch(() => {}); return task; };
    function notify() { events.emit('change', session()); }
    async function initialize() {
        if (!initialized) initialized = (async () => {
            await fs.mkdir(root, { recursive: true, mode: 0o700 });
            index = await json(path.join(root, 'identities.json')).catch(err => { if (err.code === 'ENOENT') return []; throw err; });
            if (!Array.isArray(index)) throw new Error('Invalid identity registry.');
            await restoreRememberedSession(); // NEW: finish restoration before any bridge query sees the session.
        })();
        return initialized;
    }
    async function persistIndex() { await atomic(path.join(root, 'identities.json'), index); }
    async function transport(identityId) {
        if (!transports.has(identityId)) transports.set(identityId, await options.transportFactory(identityId, identityRoot(identityId)));
        return transports.get(identityId);
    }
    async function state(identityId) {
        const entry = index.find(item => item.id === identityId);
        if (!entry) throw new Error('Identity is not installed on this device.');
        const directory = path.join(metadataRoot(identityId), 'events');
        const names = await fs.readdir(directory);
        const records = await Promise.all(names.filter(name => /^[A-Za-z0-9_-]+\.json$/.test(name)).map(name => json(path.join(directory, name))));
        const result = await protocol.reduceEvents(records, identityId);
        if (await protocol.fingerprint(result.genesis) !== entry.genesisHash) throw new Error('Identity trust anchor changed.');
        return result;
    }
    async function writeEvent(identityId, record) {
        const filename = path.join(metadataRoot(identityId), 'events', validId(record.payload.id) + '.json');
        await fs.mkdir(path.dirname(filename), { recursive: true, mode: 0o700 });
        try { await fs.writeFile(filename, JSON.stringify(record), { flag: 'wx', mode: 0o600 }); }
        catch (err) { if (err.code !== 'EEXIST' || protocol.canonical(await json(filename)) !== protocol.canonical(record)) throw err; }
    }
    function session() { return active ? { identityId: active.identityId, username: active.username, deviceId: active.deviceId, passwordConflict: !!active.passwordConflict, generation: loginGeneration } : null; } // CHANGE
    /** Validate inside the operation queue; internal callers must not enqueue recursively. */ // NEW
    async function requireSessionState(allowConflict = false) { // CHANGE
        await initialize(); // NEW
        if (!active) throw new Error('Log in to your Trellis identity first.');
        const current = await state(active.identityId);
        const reason = await validateActiveSession(current); // CHANGE: received password changes invalidate active and remembered access.
        if (reason) throw new Error(reason); // NEW
        active.passwordConflict = current.passwordHeads.length > 1;
        if (active.passwordConflict && !allowConflict) throw new Error('Resolve the password conflict before changing identity settings.');
        return current;
    }
    async function requireSession(allowConflict = false) { // NEW
        return run(() => requireSessionState(allowConflict)); // NEW
    } // NEW
    /** Erase in-memory credentials without changing the remembered-login preference. */ // NEW
    function clearActiveSession() { // CHANGE
        if (active) { active.vaultKey.fill(0); active.privateKey = null; active = null; } // CHANGE
    } // NEW
    /** Explicit logout succeeds only after the restorable credential has been removed. */ // NEW
    async function lock() { // CHANGE
        return run(async () => { // NEW
            await initialize(); // NEW
            await fs.rm(rememberedPath, { force: true }); // NEW: deletion errors must reach the logout caller.
            clearActiveSession(); notify(); return { ok: true }; // NEW
        }); // NEW
    } // NEW
    function passwordHeads(current) { // NEW: order-independent credential version, excluding ordinary membership events.
        return current.passwordHeads.map(head => head.payload.id).sort(); // NEW
    } // NEW
    /** A revoked device or changed password must lose access even if cleanup fails. */ // NEW
    async function validateActiveSession(current) { // NEW
        const removed = !current.devices.some(device => device.id === active.deviceId); // NEW
        const changed = protocol.canonical(passwordHeads(current)) !== protocol.canonical(active.passwordHeads); // NEW
        if (!removed && !changed) return; // NEW
        clearActiveSession(); notify(); // NEW: background invalidation preserves unsaved renderer documents.
        await fs.rm(rememberedPath, { force: true }); // NEW
        return removed ? 'This device was removed from the identity.' : 'The identity password changed. Log in again.'; // NEW
    } // NEW
    /** Never save a raw password or signing key; OS protection wraps the independent vault key. */ // NEW
    async function rememberSession(enabled) { // NEW
        try { // NEW: cleanup failure must not leave a newly authenticated session active without a successful result.
            await fs.rm(rememberedPath, { force: true }); // NEW: no previous restorable credential may survive an opt-out or failed replacement.
            active.keepLoggedIn = false; // NEW
            if (!enabled) return undefined; // NEW
            try { // NEW
                const secrets = await options.protectSession(JSON.stringify({ schema: 1, identityId: active.identityId, deviceId: active.deviceId, passwordHeads: active.passwordHeads, vaultKey: Buffer.from(active.vaultKey).toString('base64') })); // NEW
                await atomic(rememberedPath, { schema: 1, secrets }); // NEW
                active.keepLoggedIn = true; // NEW
                return undefined; // NEW
            } catch (_) { // NEW: authentication can succeed as a temporary session when secure persistence fails.
                await fs.rm(rememberedPath, { force: true }); // NEW: surface cleanup failure rather than claim that the session is temporary.
                return persistenceWarning; // NEW
            } // NEW
        } catch (err) { clearActiveSession(); notify(); throw err; } // NEW
    } // NEW
    /** Restore once, fail closed, and keep the Home password-login path available. */ // NEW
    async function restoreRememberedSession() { // NEW
        let vaultKey; // NEW
        try { // NEW
            const envelope = await json(rememberedPath); // NEW
            if (envelope.schema !== 1 || typeof envelope.secrets !== 'string') throw new Error('Invalid remembered session.'); // NEW
            const saved = JSON.parse(await options.unprotectSession(envelope.secrets)); // NEW
            if (saved.schema !== 1 || !Array.isArray(saved.passwordHeads) || typeof saved.vaultKey !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(saved.vaultKey)) throw new Error('Invalid remembered credentials.'); // NEW
            const current = await state(validId(saved.identityId)); // NEW: verifies the installed trust anchor and signed event history.
            const entry = index.find(item => item.id === saved.identityId); // NEW
            const device = await json(path.join(identityRoot(saved.identityId), 'device.json')); // NEW
            if (device.deviceId !== validId(saved.deviceId) || entry.deviceId !== saved.deviceId || !current.devices.some(item => item.id === saved.deviceId) || protocol.canonical(passwordHeads(current)) !== protocol.canonical(saved.passwordHeads)) throw new Error('Remembered access is no longer valid.'); // NEW
            vaultKey = Buffer.from(saved.vaultKey, 'base64'); // NEW
            const privateKey = await protocol.open(device.vault, vaultKey, saved.identityId + ':' + saved.deviceId); // NEW
            const proof = await protocol.sign({ identityId: saved.identityId, deviceId: saved.deviceId }, privateKey); // NEW
            if (!await protocol.verify(proof, current.devices.find(item => item.id === saved.deviceId).publicKey)) throw new Error('The device signing key does not match its membership.'); // NEW
            active = { identityId: saved.identityId, username: current.username, deviceId: saved.deviceId, vaultKey, privateKey, passwordConflict: current.passwordHeads.length > 1, passwordHeads: saved.passwordHeads, keepLoggedIn: true }; loginGeneration++; // CHANGE: a fresh login owns fresh browsing snapshots.
            vaultKey = null; notify(); // NEW: ownership of the key transfers to the active session.
        } catch (_) { // NEW: also discard a record whose device vault or identity files are missing.
            try { await fs.rm(rememberedPath, { force: true }); } catch (_) { /* NEW: invalid credentials never activate; explicit logout still reports deletion errors. */ } // NEW
        } finally { vaultKey?.fill(0); } // NEW
    }
    async function list() {
        await initialize();
        return { identities: await Promise.all(index.map(async entry => {
            try { const current = await state(entry.id); return { id: entry.id, username: current.username, passwordConflict: current.passwordHeads.length > 1, revoked: !current.devices.some(device => device.id === entry.deviceId) }; }
            catch (err) { return { id: entry.id, username: entry.username, error: err.message }; }
        })), session: session() };
    }
    /** keepLoggedIn defaults to false; persistenceWarning reports successful authentication without persistence. */ // NEW
    async function create(input) {
        return run(async () => {
            await initialize();
            if (active) throw new Error('Log out before creating another identity.');
            const username = String(input.username || '').trim();
            if (!username || username.length > 80) throw new Error('Enter a username of at most 80 characters.');
            if (index.some(entry => entry.username.toLowerCase() === username.toLowerCase())) throw new Error('That username already exists on this computer.');
            const identityId = id(), deviceId = id(), eventId = id();
            const signer = await protocol.keyPair(), vaultKey = crypto.randomBytes(32);
            const credential = await protocol.protectPassword(vaultKey, input.password, identityId + ':' + eventId);
            const daemon = await transport(identityId);
            const info = await daemon.getTransportIdentity();
            const device = { id: deviceId, publicKey: signer.publicKey, syncthingId: info.deviceId, sharingPublicKey: info.publicKey, name: input.deviceName || 'Desktop', kind: 'desktop' }; // NEW
            const genesis = await protocol.sign({ schema: 1, id: eventId, identityId, kind: 'genesis', author: deviceId, parents: [], username, device, credential, time: now() }, signer.privateKey);
            await writeEvent(identityId, genesis);
            await atomic(path.join(identityRoot(identityId), 'device.json'), { deviceId, vault: await protocol.seal(signer.privateKey, vaultKey, identityId + ':' + deviceId) });
            const entry = { id: identityId, username, deviceId, genesisHash: await protocol.fingerprint(genesis) };
            index.push(entry); await persistIndex();
            active = { identityId, username, deviceId, vaultKey, privateKey: signer.privateKey, passwordConflict: false, passwordHeads: [eventId], keepLoggedIn: false }; loginGeneration++; // CHANGE: a fresh login owns fresh browsing snapshots.
            await daemon.configureIdentityMetadata({ identityId, directory: metadataRoot(identityId), devices: [device] });
            const warning = await rememberSession(input.keepLoggedIn === true); // NEW
            notify(); return { ok: true, session: session(), ...(warning ? { persistenceWarning: warning } : {}) }; // CHANGE
        });
    }
    async function unlockRecord(current, password) {
        for (const head of current.passwordHeads) {
            try { return await protocol.unlockPassword(head.payload.credential, password, current.identityId + ':' + head.payload.id); }
            catch (_) { /* A different concurrent password can still authenticate its branch. */ }
        }
        throw new Error('Incorrect password.');
    }
    /** Authenticate the password before replacing the saved preference; failed authentication leaves it unchanged. */ // NEW
    async function unlock(input) {
        return run(async () => {
            await initialize();
            if (active && active.identityId !== input.identityId) throw new Error('Log out before switching identities.');
            const current = await state(validId(input.identityId));
            const device = await json(path.join(identityRoot(input.identityId), 'device.json'));
            if (!current.devices.some(entry => entry.id === device.deviceId)) throw new Error('This device was removed from the identity.');
            const vaultKey = await unlockRecord(current, input.password);
            let privateKey;
            try { privateKey = await protocol.open(device.vault, vaultKey, input.identityId + ':' + device.deviceId); }
            catch (err) { vaultKey.fill(0); throw err; }
            clearActiveSession(); active = { identityId: input.identityId, username: current.username, deviceId: device.deviceId, vaultKey, privateKey, passwordConflict: current.passwordHeads.length > 1, passwordHeads: passwordHeads(current), keepLoggedIn: false }; loginGeneration++; // CHANGE: a fresh login owns fresh browsing snapshots.
            const warning = await rememberSession(input.keepLoggedIn === true); // NEW
            notify(); return { ok: true, session: session(), ...(warning ? { persistenceWarning: warning } : {}) }; // CHANGE
        });
    }
    async function changePassword(input) {
        return run(async () => {
            const current = await requireSessionState(true); // CHANGE: already serialized by run.
            if (current.passwordHeads.length > 1 && !input.resolveConflict) throw new Error('Confirm that the new password resolves the conflicting changes.');
            const verified = await unlockRecord(current, input.currentPassword);
            try { if (!crypto.timingSafeEqual(verified, active.vaultKey)) throw new Error('Credential vault does not match this device.'); }
            finally { verified.fill(0); }
            const eventId = id();
            const credential = await protocol.protectPassword(active.vaultKey, input.password, active.identityId + ':' + eventId);
            await writeEvent(active.identityId, await protocol.sign({ schema: 1, id: eventId, identityId: active.identityId, kind: 'password', author: active.deviceId, parents: current.heads, credential, time: now() }, active.privateKey));
            active.passwordConflict = false; active.passwordHeads = [eventId]; // CHANGE: locally changed password keeps this authenticated device active.
            const warning = await rememberSession(active.keepLoggedIn); // NEW: preserve the prior preference with the new credential version.
            notify(); return { ok: true, session: session(), ...(warning ? { persistenceWarning: warning } : {}) }; // CHANGE
        });
    }
    /** Pending request keys are protected by the OS; no existing password is exported. */
    async function createPairRequest(input = {}) {
        return run(async () => {
            await initialize();
            const requestId = id(), provisionalId = 'pending-' + requestId;
            const exchange = await protocol.keyPair('ECDH'), signer = await protocol.keyPair(), deviceId = id();
            const daemon = await transport(provisionalId), info = await daemon.getTransportIdentity();
            const payload = { schema: 1, kind: 'identity-request', requestId, device: { id: deviceId, publicKey: signer.publicKey, syncthingId: info.deviceId, sharingPublicKey: info.publicKey, name: String(input.deviceName || 'New desktop').slice(0, 80), kind: input.kind === 'android' ? 'android' : 'desktop' }, exchangeKey: exchange.publicKey, expiresAt: now() + 14 * 86400000 }; // NEW
            await atomic(path.join(root, 'requests', requestId + '.json'), { request: payload, secrets: options.protectPending(JSON.stringify({ exchange: exchange.privateKey, signer: signer.privateKey })) });
            return { ok: true, request: await protocol.sign(payload, signer.privateKey) };
        });
    }
    async function approvePairRequest(input) {
        return run(async () => {
            const current = await requireSessionState(); // CHANGE: already serialized by run.
            const request = input.request, p = request?.payload;
            if (!p || p.schema !== 1 || p.kind !== 'identity-request' || p.expiresAt <= now() || !await protocol.verify(request, p.device.publicKey)) throw new Error('Device request is invalid or expired.');
            validId(p.requestId); validId(p.device.id);
            const receiptPath = path.join(identityRoot(active.identityId), 'setups', p.requestId + '.json'); // NEW: exporting a lost setup package is resumable.
            const receipt = await json(receiptPath).catch(err => { if (err.code === 'ENOENT') return null; throw err; }); // NEW
            if (receipt) { // NEW
                if (receipt.requestHash !== await protocol.fingerprint(request)) throw new Error('Pairing request identifier was reused.'); // NEW
                await writeEvent(active.identityId, receipt.addition); // NEW: resume a crash between receipt and membership publication.
                await (await transport(active.identityId)).configureIdentityMetadata({ identityId: active.identityId, directory: metadataRoot(active.identityId), devices: (await state(active.identityId)).devices }); // NEW
                return { ok: true, setup: receipt.setup, alreadyApproved: true }; // NEW
            } // NEW
            if (current.devices.some(device => device.id === p.device.id) || current.revoked.includes(p.device.id)) throw new Error('Device already enrolled or revoked.');
            const addition = await protocol.sign({ schema: 1, id: id(), identityId: active.identityId, kind: 'add-device', author: active.deviceId, parents: current.heads, device: p.device, requestId: p.requestId, time: now() }, active.privateKey);
            const records = [...current.records, addition];
            const ephemeral = await protocol.keyPair('ECDH'), shared = await protocol.sharedKey(ephemeral.privateKey, p.exchangeKey);
            let envelope;
            try { envelope = await protocol.seal({ records }, shared, p.requestId + ':' + p.device.id); }
            finally { shared.fill(0); }
            const setup = await protocol.sign({ schema: 1, kind: 'identity-setup', requestId: p.requestId, targetDeviceId: p.device.id, identityId: active.identityId, author: active.deviceId, exchangeKey: ephemeral.publicKey, envelope, expiresAt: p.expiresAt }, active.privateKey);
            await atomic(receiptPath, { requestHash: await protocol.fingerprint(request), setup, addition }); // CHANGE: keep a public signed event for crash recovery.
            await writeEvent(active.identityId, addition);
            const next = await state(active.identityId);
            await (await transport(active.identityId)).configureIdentityMetadata({ identityId: active.identityId, directory: metadataRoot(active.identityId), devices: next.devices });
            notify(); return { ok: true, setup };
        });
    }
    async function importSetup(input) {
        return run(async () => {
            await initialize();
            if (active) throw new Error('Log out before connecting another identity.');
            const setup = input.setup, p = setup?.payload;
            if (!p || p.schema !== 1 || p.kind !== 'identity-setup') throw new Error('Unsupported setup package.');
            validId(p.requestId); validId(p.identityId);
            const existing = index.find(entry => entry.requestId === p.requestId);
            if (existing) return { ok: true, alreadyImported: true, identityId: existing.id };
            if (index.some(entry => entry.id === p.identityId)) throw new Error('This identity is already installed; setup will not overwrite it.');
            if (p.expiresAt <= now()) throw new Error('Setup package has expired.');
            const pending = await json(path.join(root, 'requests', p.requestId + '.json'));
            if (pending.request.device.id !== p.targetDeviceId) throw new Error('Setup targets another device.');
            const secrets = JSON.parse(options.unprotectPending(pending.secrets));
            const shared = await protocol.sharedKey(secrets.exchange, p.exchangeKey);
            let content;
            try { content = await protocol.open(p.envelope, shared, p.requestId + ':' + p.targetDeviceId); }
            finally { shared.fill(0); }
            const current = await protocol.reduceEvents(content.records, p.identityId);
            const author = current.devices.find(device => device.id === p.author);
            const target = current.devices.find(device => device.id === p.targetDeviceId);
            if (!author || !target || protocol.canonical(target.publicKey) !== protocol.canonical(pending.request.device.publicKey) || !await protocol.verify(setup, author.publicKey)) throw new Error('Setup approval is invalid.');
            const vaultKey = await unlockRecord(current, input.password);
            try {
                for (const record of content.records) await writeEvent(p.identityId, record);
                await atomic(path.join(identityRoot(p.identityId), 'device.json'), { deviceId: p.targetDeviceId, vault: await protocol.seal(secrets.signer, vaultKey, p.identityId + ':' + p.targetDeviceId) });
                await options.adoptTransport('pending-' + p.requestId, p.identityId, identityRoot(p.identityId));
                transports.delete('pending-' + p.requestId);
                const entry = { id: p.identityId, username: current.username, deviceId: p.targetDeviceId, requestId: p.requestId, genesisHash: await protocol.fingerprint(current.genesis) };
                index.push(entry); await persistIndex();
                await (await transport(p.identityId)).configureIdentityMetadata({ identityId: p.identityId, directory: metadataRoot(p.identityId), devices: current.devices });
                await fs.rm(path.join(root, 'requests', p.requestId + '.json'), { force: true });
                notify(); return { ok: true, identityId: p.identityId };
            } finally { vaultKey.fill(0); }
        });
    }
    async function removeDevice(input) {
        return run(async () => {
            const current = await requireSessionState(); // CHANGE: already serialized by run.
            if (!current.devices.some(device => device.id === input.deviceId) || current.devices.length < 2) throw new Error('Keep at least one approved device.');
            const identityId = active.identityId; // NEW: self-removal clears active credentials before any fallible transport work.
            await writeEvent(identityId, await protocol.sign({ schema: 1, id: id(), identityId, kind: 'remove-device', author: active.deviceId, parents: current.heads, deviceId: input.deviceId, time: now() }, active.privateKey)); // CHANGE
            if (input.deviceId === active.deviceId) { clearActiveSession(); notify(); await fs.rm(rememberedPath, { force: true }); } // CHANGE: self-revocation forgets this device's remembered credential.
            await (await transport(identityId)).configureIdentityMetadata({ identityId, directory: metadataRoot(identityId), devices: (await state(identityId)).devices }); // CHANGE
            notify(); return { ok: true };
        });
    }
    /** Background refresh is serialized with login/logout and may invalidate access. */ // CHANGE
    async function refresh() {
        return run(async () => { // NEW
            await initialize(); // CHANGE
            for (const entry of index) { // CHANGE
                const current = await state(entry.id); // CHANGE
                if (active?.identityId === entry.id) { // NEW: revoke access before any transport configuration that can fail.
                    await validateActiveSession(current); // NEW
                    if (active) active.passwordConflict = current.passwordHeads.length > 1; // NEW
                } // NEW
                if (current.devices.some(device => device.id === entry.deviceId)) await (await transport(entry.id)).configureIdentityMetadata({ identityId: entry.id, directory: metadataRoot(entry.id), devices: current.devices }); // CHANGE
                else await transports.get(entry.id)?.stop(); // NEW: revocation stops an existing daemon without creating a replacement. // CHANGE
            } // CHANGE
            return session(); // CHANGE
        }); // NEW
    }
    /** Sign business records without exporting private credentials to the renderer. */ // NEW
    async function signAction(kind, value) { // NEW
        return run(async () => { // NEW: a logout cannot clear the signing key midway through an action.
            const current = await requireSessionState(); // CHANGE
            return protocol.sign({ ...value, schema: 1, id: id(), identityId: active.identityId, author: active.deviceId, kind, time: now(), identityHeads: current.heads }, active.privateKey); // NEW: callers cannot override signature context.
        }); // NEW
    }
    /** Main-process-only archive encryption shares the existing vault across paired devices. */ // NEW
    async function communityArchive(method, value, context) { // NEW
        return run(async () => { // NEW
            await requireSessionState(); // NEW
            if (typeof context !== 'string' || !context.startsWith('trellis-community-request:')) throw new Error('Invalid community archive context.'); // NEW
            if (method === 'seal') return protocol.seal(value, active.vaultKey, context); // NEW
            if (method === 'open') return protocol.open(value, active.vaultKey, context); // NEW
            throw new Error('Unsupported community archive operation.'); // NEW
        }); // NEW
    } // NEW
    /** Credential operations share the identity queue so logout/profile changes cannot cross a write. */ // NEW
    async function apiKeys(method, input = {}) { // NEW
        return run(async () => {
            await requireSessionState();
            if (apiKeyOwner !== active) { apiKeyOwner = active; apiKeySessionToken = id(); }
            if (!['status', 'save', 'remove'].includes(method)) throw new Error('Unsupported API key operation.');
            if (method !== 'status' && input.sessionToken !== apiKeySessionToken) throw new Error('Your profile session changed. Reopen API keys.');
            const identityId = active.identityId; // NEW: ownership never comes from renderer input.
            if (method === 'save') await apiKeyStore.save(identityId, input.provider, input.value);
            if (method === 'remove') await apiKeyStore.remove(identityId, input.provider);
            return { identityId, username: active.username, sessionToken: apiKeySessionToken, providers: await apiKeyStore.status(identityId) };
        });
    }
    return { communityArchive, initialize, list, create, unlock, lock, session, requireSession, state, changePassword, createPairRequest, approvePairRequest, importSetup, removeDevice, refresh, transport, metadataRoot, identityRoot, signAction, apiKeys, onChange: listener => events.on('change', listener) }; // CHANGE
}
