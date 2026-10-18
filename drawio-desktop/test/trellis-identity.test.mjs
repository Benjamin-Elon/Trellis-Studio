// NEW: Device-targeted setup, credential changes, branch resolution, and isolation.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto'; // NEW: test encryption is injected; these tests never access real OS credentials.
import vm from 'node:vm'; // NEW
import { createIdentityService } from '../src/main/trellis-identity-service.js';
const p = globalThis.TrellisIdentityProtocol;
async function fixture(t, name, overrides = {}) { // CHANGE: restart services against the same isolated profile and protection provider.
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'trellis-identity-' + name + '-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const storageKey = randomBytes(32); // NEW
    const options = { root, transportFactory: async identityId => ({ getTransportIdentity: async () => ({ deviceId: name + '-' + identityId, publicKey: 'test-transport-public' }), configureIdentityMetadata: async () => ({ ok: true }), stop: async () => {} }), adoptTransport: async () => {}, protectPending: text => Buffer.from(text).toString('base64'), unprotectPending: text => Buffer.from(text, 'base64').toString(), ...overrides }; // CHANGE: transport fixtures also support revocation shutdown.
    options.protectSession ??= text => { const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', storageKey, iv); const data = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]); return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64'); }; // NEW
    options.unprotectSession ??= text => { const data = Buffer.from(text, 'base64'), decipher = createDecipheriv('aes-256-gcm', storageKey, data.subarray(0, 12)); decipher.setAuthTag(data.subarray(12, 28)); return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString('utf8'); }; // NEW
    const restart = overrides => createIdentityService({ ...options, ...overrides }); // NEW
    return { root, service: restart(), restart, unprotectSession: options.unprotectSession }; // CHANGE
}
async function syncEvents(from, to, identityId) {
    const source = path.join(from.service.metadataRoot(identityId), 'events');
    await fs.mkdir(path.join(to.service.metadataRoot(identityId), 'events'), { recursive: true });
    for (const name of await fs.readdir(source)) await fs.copyFile(path.join(source, name), path.join(to.service.metadataRoot(identityId), 'events', name));
}
async function pair(a, b) {
    const { request } = await b.service.createPairRequest({ deviceName: 'Second device' });
    const { setup } = await a.service.approvePairRequest({ request });
    const result = await b.service.importSetup({ setup, password: 'first-password' });
    return { request, setup, identityId: result.identityId };
}
test('creation and targeted setup protect credentials and are resumable', async t => {
    const a = await fixture(t, 'a'), b = await fixture(t, 'b'), wrong = await fixture(t, 'wrong');
    const created = await a.service.create({ username: 'Alice', password: 'first-password' });
    const { request, setup, identityId } = await pair(a, b);
    assert.equal(identityId, created.session.identityId);
    assert.equal(JSON.stringify(setup).includes('first-password'), false);
    assert.equal(JSON.stringify(await fs.readFile(path.join(a.root, identityId, 'device.json'), 'utf8')).includes('"d"'), false);
    assert.deepEqual((await a.service.approvePairRequest({ request })).setup, setup);
    assert.equal((await b.service.importSetup({ setup, password: 'irrelevant' })).alreadyImported, true);
    await assert.rejects(wrong.service.importSetup({ setup, password: 'first-password' }));
    await b.service.unlock({ identityId, password: 'first-password' });
    assert.notEqual(a.service.session().deviceId, b.service.session().deviceId);
    assert.equal(b.service.session().username, 'Alice');
    await b.service.lock(); // CHANGE: credential removal is asynchronous.
    await assert.rejects(b.service.changePassword({ currentPassword: 'first-password', password: 'x' }), /Log in/);
});
test('concurrent passwords retain branches and resolve with authenticated new credential', async t => {
    const a = await fixture(t, 'a'), b = await fixture(t, 'b');
    await a.service.create({ username: 'Alice', password: 'first-password' });
    const { identityId } = await pair(a, b);
    await b.service.unlock({ identityId, password: 'first-password' });
    await a.service.changePassword({ currentPassword: 'first-password', password: 'a-password' });
    await b.service.changePassword({ currentPassword: 'first-password', password: 'b-password' });
    await syncEvents(a, b, identityId); await syncEvents(b, a, identityId);
    assert.equal((await a.service.state(identityId)).passwordHeads.length, 2);
    await assert.rejects(a.service.requireSession(true), /password changed/); // NEW: received concurrent changes invalidate the old authentication.
    await a.service.unlock({ identityId, password: 'a-password' }); // NEW: authenticate a current branch before resolving the conflict.
    await assert.rejects(a.service.changePassword({ currentPassword: 'a-password', password: 'merged' }), /Confirm/);
    await a.service.changePassword({ currentPassword: 'b-password', password: 'merged', resolveConflict: true });
    await syncEvents(a, b, identityId);
    await b.service.lock(); // CHANGE
    await assert.rejects(b.service.unlock({ identityId, password: 'b-password' }), /Incorrect/);
    await b.service.unlock({ identityId, password: 'merged' });
    assert.equal(b.service.session().passwordConflict, false);
});
test('multiple identities remain separate and revoked devices cannot unlock', async t => {
    const a = await fixture(t, 'a'), b = await fixture(t, 'b');
    const first = await a.service.create({ username: 'Alice', password: 'first-password' });
    const { identityId } = await pair(a, b);
    const deviceId = (await b.service.state(identityId)).devices.find(d => d.name === 'Second device').id;
    await a.service.removeDevice({ deviceId });
    await syncEvents(a, b, identityId);
    await assert.rejects(b.service.unlock({ identityId, password: 'first-password' }), /removed/);
    await a.service.lock(); // CHANGE
    const second = await a.service.create({ username: 'Bob', password: 'bob-password' });
    assert.notEqual(first.session.identityId, second.session.identityId);
    assert.equal((await a.service.list()).identities.length, 2);
    await assert.rejects(a.service.unlock({ identityId, password: 'first-password' }), /Log out/);
});
test('signed event tampering and wrong encryption contexts fail closed', async () => {
    const signer = await p.keyPair();
    const record = await p.sign({ a: 1 }, signer.privateKey);
    assert.equal(await p.verify(record, signer.publicKey), true);
    record.payload.a = 2;
    assert.equal(await p.verify(record, signer.publicKey), false);
    const key = crypto.getRandomValues(new Uint8Array(32));
    const envelope = await p.seal({ data: 'secret' }, key, 'identity:a');
    await assert.rejects(p.open(envelope, key, 'identity:b'));
});

test('remembered creation and unlock restore across service restart without exposing secrets', async t => { // NEW
    const f = await fixture(t, 'remember'), filename = path.join(f.root, 'remembered-session.json'); // NEW
    const made = await f.service.create({ username: 'Alice', password: 'first-password', keepLoggedIn: true }); // NEW
    const text = await fs.readFile(filename, 'utf8'); // NEW
    assert.equal(text.includes('first-password'), false); assert.equal(text.includes('vaultKey'), false); assert.equal(text.includes('privateKey'), false); // NEW
    assert.deepEqual(Object.keys(made.session).sort(), ['deviceId', 'identityId', 'passwordConflict', 'username']); // NEW
    const restarted = f.restart(); await restarted.initialize(); // NEW
    assert.deepEqual(restarted.session(), made.session); // NEW
    await restarted.lock(); assert.equal(restarted.session(), null); // NEW
    await assert.rejects(fs.readFile(filename), { code: 'ENOENT' }); // NEW
    assert.equal((await f.restart().list()).session, null); // NEW
    await restarted.unlock({ identityId: made.session.identityId, password: 'first-password', keepLoggedIn: true }); // NEW
    assert.deepEqual((await f.restart().list()).session, made.session); // NEW
}); // NEW

test('omitted and unchecked persistence remain temporary and erase previous remembered access', async t => { // NEW
    const f = await fixture(t, 'temporary'); // NEW
    const made = await f.service.create({ username: 'Alice', password: 'first-password' }); // NEW
    assert.equal((await f.restart().list()).session, null); // NEW
    await f.service.unlock({ identityId: made.session.identityId, password: 'first-password', keepLoggedIn: true }); // NEW
    await assert.rejects(f.service.unlock({ identityId: made.session.identityId, password: 'wrong', keepLoggedIn: false }), /Incorrect/); // NEW
    assert.equal((await f.restart().list()).session.identityId, made.session.identityId); // NEW: a failed login must not alter the preference.
    await f.service.unlock({ identityId: made.session.identityId, password: 'first-password', keepLoggedIn: false }); // NEW
    assert.equal((await f.restart().list()).session, null); // NEW
    await f.service.unlock({ identityId: made.session.identityId, password: 'first-password', keepLoggedIn: true }); // NEW
    await f.service.unlock({ identityId: made.session.identityId, password: 'first-password' }); // NEW
    assert.equal((await f.restart().list()).session, null); // NEW
}); // NEW

test('logout precedes identity switching and serializes concurrent authentication', async t => { // NEW
    const f = await fixture(t, 'switch'); // NEW
    const alice = await f.service.create({ username: 'Alice', password: 'first-password', keepLoggedIn: true }); // NEW
    await f.service.lock(); // NEW
    const bob = await f.service.create({ username: 'Bob', password: 'bob-password', keepLoggedIn: true }); // NEW
    await assert.rejects(f.service.unlock({ identityId: alice.session.identityId, password: 'first-password' }), /Log out/); // NEW
    const logout = f.service.lock(), login = f.service.unlock({ identityId: alice.session.identityId, password: 'first-password', keepLoggedIn: true }); // NEW
    await Promise.all([logout, login]); // NEW
    assert.equal((await f.restart().list()).session.identityId, alice.session.identityId); // NEW
    assert.notEqual(f.service.session().identityId, bob.session.identityId); // NEW
    const authenticating = f.service.unlock({ identityId: alice.session.identityId, password: 'first-password', keepLoggedIn: true }), ending = f.service.lock(); // NEW
    await Promise.all([authenticating, ending]); assert.equal(f.service.session(), null); // NEW
    assert.equal((await f.restart().list()).session, null); // NEW
}); // NEW

test('OS protection and credential-file write failures allow a temporary session with a notice', async t => { // NEW
    const f = await fixture(t, 'unavailable', { protectSession() { throw new Error('OS protection unavailable'); } }); // NEW
    const made = await f.service.create({ username: 'Alice', password: 'first-password', keepLoggedIn: true }); // NEW
    assert.equal(made.persistenceWarning, 'You’re logged in, but Trellis couldn’t keep you logged in. Enter your password next time.'); // NEW
    assert.equal(f.service.session().username, 'Alice'); assert.equal((await f.restart().list()).session, null); // NEW
    const filename = path.join(f.root, 'remembered-session.json'); // NEW
    const writing = f.restart({ protectSession: () => 'test-protected-credential' }); // NEW
    const rename = t.mock.method(fs, 'rename', async () => { throw new Error('Disk write failed'); }); // NEW: atomic commit failure leaves no previous credential behind.
    const result = await writing.unlock({ identityId: made.session.identityId, password: 'first-password', keepLoggedIn: true }); // NEW
    rename.mock.restore(); // NEW
    assert.equal(result.persistenceWarning, made.persistenceWarning); assert.equal(writing.session().username, 'Alice'); // NEW
    await assert.rejects(fs.stat(filename), { code: 'ENOENT' }); // NEW
}); // NEW

test('logout deletion failure is reported and cannot claim that remembered access was removed', async t => { // NEW
    const f = await fixture(t, 'delete'), filename = path.join(f.root, 'remembered-session.json'); // NEW
    await f.service.create({ username: 'Alice', password: 'first-password', keepLoggedIn: true }); // NEW
    const record = await fs.readFile(filename); await fs.rm(filename); await fs.mkdir(filename); await fs.writeFile(path.join(filename, 'blocked'), 'fixture'); // NEW: a nonempty directory reliably rejects nonrecursive credential removal.
    await assert.rejects(f.service.lock()); assert.equal(f.service.session().username, 'Alice'); // NEW
    await fs.rm(path.join(filename, 'blocked')); await fs.rmdir(filename); await fs.writeFile(filename, record); // NEW
    assert.equal((await f.restart().list()).session.username, 'Alice'); // NEW
    await f.service.lock(); assert.equal((await f.restart().list()).session, null); // NEW
}); // NEW

test('corrupt, unavailable, stale and mismatched credentials fail closed during restoration', async t => { // NEW
    const f = await fixture(t, 'corrupt'), filename = path.join(f.root, 'remembered-session.json'); // NEW
    const made = await f.service.create({ username: 'Alice', password: 'first-password', keepLoggedIn: true }); // NEW
    const record = await fs.readFile(filename, 'utf8'); // NEW
    const unavailable = f.restart({ unprotectSession() { throw new Error('Cannot decrypt on this OS account'); } }); // NEW
    assert.equal((await unavailable.list()).session, null); await assert.rejects(fs.stat(filename), { code: 'ENOENT' }); // NEW
    for (const invalid of ['{', JSON.stringify({ schema: 99, secrets: 'x' }), JSON.stringify({ schema: 1, secrets: 'corrupt-ciphertext' })]) { // NEW
        await fs.writeFile(filename, invalid); assert.equal((await f.restart().list()).session, null); await assert.rejects(fs.stat(filename), { code: 'ENOENT' }); // NEW
    } // NEW
    const envelope = JSON.parse(record); // NEW
    const saved = JSON.parse(f.unprotectSession(envelope.secrets)); // NEW
    for (const mutation of [{ schema: 99 }, { vaultKey: 'short' }, { passwordHeads: ['stale-password'] }, { identityId: '../outside' }, { deviceId: 'another-device' }]) { // NEW
        const mutating = f.restart({ unprotectSession: () => JSON.stringify({ ...saved, ...mutation }) }); // NEW: exercise decrypted record validation independently of ciphertext authentication.
        await fs.writeFile(filename, record); assert.equal((await mutating.list()).session, null); // NEW
    } // NEW
    await fs.writeFile(filename, record); // NEW
    const devicePath = path.join(f.root, made.session.identityId, 'device.json'), device = JSON.parse(await fs.readFile(devicePath)); // NEW
    await fs.writeFile(devicePath, JSON.stringify({ ...device, deviceId: 'another-device' })); // NEW
    assert.equal((await f.restart().list()).session, null); // NEW
    const wrongSigner = await p.keyPair(), vaultKey = Buffer.from(saved.vaultKey, 'base64'); // NEW
    await fs.writeFile(devicePath, JSON.stringify({ ...device, vault: await p.seal(wrongSigner.privateKey, vaultKey, saved.identityId + ':' + saved.deviceId) })); await fs.writeFile(filename, record); // NEW
    assert.equal((await f.restart().list()).session, null); vaultKey.fill(0); // NEW: a decryptable vault must also match the approved device public key.
    await fs.rm(devicePath); await fs.writeFile(filename, record); assert.equal((await f.restart().list()).session, null); // NEW
    await assert.rejects(fs.stat(filename), { code: 'ENOENT' }); // NEW: missing device credentials invalidate the saved record.
    await fs.writeFile(devicePath, JSON.stringify(device)); await fs.writeFile(filename, record); // NEW
    const indexPath = path.join(f.root, 'identities.json'), index = JSON.parse(await fs.readFile(indexPath)); index[0].genesisHash = 'changed'; await fs.writeFile(indexPath, JSON.stringify(index)); // NEW
    assert.equal((await f.restart().list()).session, null); // NEW
    assert.equal(envelope.schema, 1); // NEW
}); // NEW

test('initialization waits for OS restoration exactly once across concurrent queries', async t => { // NEW
    const f = await fixture(t, 'initialize'); const made = await f.service.create({ username: 'Alice', password: 'first-password', keepLoggedIn: true }); // NEW
    let resume, entered, calls = 0; // NEW
    const gate = new Promise(resolve => { resume = resolve; }), ready = new Promise(resolve => { entered = resolve; }); // NEW
    const restarted = f.restart({ unprotectSession: async text => { calls++; entered(); await gate; return f.unprotectSession(text); } }); // NEW
    const listing = restarted.list(), initializing = restarted.initialize(); await ready; // NEW
    assert.equal(restarted.session(), null); assert.equal(calls, 1); resume(); // NEW
    await initializing; assert.deepEqual((await listing).session, made.session); assert.equal(calls, 1); // NEW
}); // NEW

test('local password changes retain the preference and remote changes revoke remembered and active sessions', async t => { // NEW
    const a = await fixture(t, 'password-a'), b = await fixture(t, 'password-b'); // NEW
    await a.service.create({ username: 'Alice', password: 'first-password', keepLoggedIn: true }); // NEW
    const { identityId } = await pair(a, b); // NEW
    await b.service.unlock({ identityId, password: 'first-password', keepLoggedIn: true }); // NEW
    const oldB = await fs.readFile(path.join(b.root, 'remembered-session.json')); // NEW
    await a.service.changePassword({ currentPassword: 'first-password', password: 'new-password' }); // NEW
    assert.equal((await a.restart().list()).session.username, 'Alice'); // NEW
    await syncEvents(a, b, identityId); await b.service.refresh(); // NEW
    assert.equal(b.service.session(), null); assert.equal((await b.restart().list()).session, null); // NEW
    await fs.writeFile(path.join(b.root, 'remembered-session.json'), oldB); assert.equal((await b.restart().list()).session, null); // NEW: stale records also fail before background refresh.
    await b.service.unlock({ identityId, password: 'new-password', keepLoggedIn: true }); // NEW
    await b.service.changePassword({ currentPassword: 'new-password', password: 'b-password' }); // NEW
    await syncEvents(b, a, identityId); await assert.rejects(a.service.requireSession(), /password changed/); // NEW
    assert.equal(a.service.session(), null); // NEW
    await a.service.unlock({ identityId, password: 'b-password', keepLoggedIn: false }); // NEW
    await a.service.changePassword({ currentPassword: 'b-password', password: 'temporary-password' }); // NEW
    assert.equal((await a.restart().list()).session, null); // NEW: changing a temporary session's password must not enable persistence.
}); // NEW

test('received and self device removal erase persistence while ordinary pairing preserves it', async t => { // NEW
    const a = await fixture(t, 'revoke-a'), b = await fixture(t, 'revoke-b'); // NEW
    await a.service.create({ username: 'Alice', password: 'first-password', keepLoggedIn: true }); // NEW
    const { identityId } = await pair(a, b); // NEW
    assert.equal((await a.restart().list()).session.username, 'Alice'); // NEW
    await b.service.unlock({ identityId, password: 'first-password', keepLoggedIn: true }); // NEW
    const oldB = await fs.readFile(path.join(b.root, 'remembered-session.json')); // NEW
    await a.service.removeDevice({ deviceId: b.service.session().deviceId }); await syncEvents(a, b, identityId); // NEW
    await b.service.refresh(); assert.equal(b.service.session(), null); // NEW
    await fs.writeFile(path.join(b.root, 'remembered-session.json'), oldB); assert.equal((await b.restart().list()).session, null); // NEW
    const c = await fixture(t, 'revoke-c'); await pair(a, c); // NEW
    await a.service.removeDevice({ deviceId: a.service.session().deviceId }); assert.equal(a.service.session(), null); // NEW
    assert.equal((await a.restart().list()).session, null); // NEW
}); // NEW

test('main-process protection rejects unavailable encryption and the Linux plaintext backend', async () => { // NEW
    const source = await fs.readFile(new URL('../src/main/electron.js', import.meta.url), 'utf8'); // NEW
    const start = source.indexOf('function assertRememberedIdentityProtection()'), end = source.indexOf('async function getIdentityService()', start); // NEW
    assert.ok(start >= 0 && end > start); // NEW
    const check = (platform, available, backend) => vm.runInNewContext(source.slice(start, end) + '\nassertRememberedIdentityProtection();', { process: { platform }, safeStorage: { isEncryptionAvailable: () => available, getSelectedStorageBackend: () => backend } }); // NEW: exercise the actual production guard without booting Electron.
    assert.throws(() => check('win32', false), /unavailable/); assert.throws(() => check('linux', true, 'basic_text'), /unavailable/); // NEW
    assert.doesNotThrow(() => check('win32', true)); assert.doesNotThrow(() => check('linux', true, 'gnome_libsecret')); // NEW
}); // NEW

test('self-revocation clears access even if the transport cannot publish its new membership', async t => { // NEW
    let failing = false; // NEW
    const a = await fixture(t, 'self-failure', { transportFactory: async identityId => ({ getTransportIdentity: async () => ({ deviceId: 'transport-' + identityId, publicKey: 'test-public' }), configureIdentityMetadata: async () => { if (failing) throw new Error('Transport unavailable'); return { ok: true }; } }) }); // NEW
    const b = await fixture(t, 'self-peer'); await a.service.create({ username: 'Alice', password: 'first-password', keepLoggedIn: true }); await pair(a, b); // NEW
    const deviceId = a.service.session().deviceId; failing = true; // NEW
    await assert.rejects(a.service.removeDevice({ deviceId }), /Transport unavailable/); // NEW
    assert.equal(a.service.session(), null); assert.equal((await a.restart().list()).session, null); // NEW
    await assert.rejects(fs.stat(path.join(a.root, 'remembered-session.json')), { code: 'ENOENT' }); // NEW
}); // NEW

test('API keys require sign-in and isolate profiles without exposing values', async t => { // NEW
    const a = await fixture(t, 'api-keys');
    await assert.rejects(a.service.apiKeys('status'), /Log in/);
    const alice = await a.service.create({ username: 'Alice', password: 'first-password' });
    const initial = await a.service.apiKeys('status');
    const saved = await a.service.apiKeys('save', { provider: 'openai', value: 'synthetic-alice-api-key', sessionToken: initial.sessionToken, identityId: 'attacker-supplied-profile' });
    assert.equal(saved.identityId, alice.session.identityId);
    assert.equal(saved.providers.openai, 'configured');
    assert.equal(JSON.stringify(saved).includes('synthetic-alice-api-key'), false);
    const disk = await fs.readFile(path.join(a.root, saved.identityId, 'api-keys/openai.json'), 'utf8');
    assert.equal(disk.includes('synthetic-alice-api-key'), false);
    const peer = await fixture(t, 'api-key-pairing'); // NEW: device setup transfers identity records, never local provider credentials.
    const paired = await pair(a, peer);
    assert.equal(JSON.stringify(paired.setup).includes('api-keys'), false);
    await peer.service.unlock({ identityId: paired.identityId, password: 'first-password' });
    assert.equal((await peer.service.apiKeys('status')).providers.openai, 'missing');
    await assert.rejects(a.service.apiKeys('read', {}), /Unsupported/);
    await assert.rejects(a.service.apiKeys('save', { provider: '../../escape', value: 'bad', sessionToken: saved.sessionToken }), /Unsupported/);
    await assert.rejects(a.service.apiKeys('save', { provider: 'openai', value: '   ', sessionToken: saved.sessionToken }), /nonblank/);
    await a.service.lock();
    await a.service.create({ username: 'Bob', password: 'bob-password' });
    assert.equal((await a.service.apiKeys('status')).providers.openai, 'missing');
    await assert.rejects(a.service.apiKeys('remove', { provider: 'openai', sessionToken: saved.sessionToken }), /session changed/);
    await a.service.lock();
    const restarted = a.restart();
    await restarted.unlock({ identityId: alice.session.identityId, password: 'first-password' });
    const restored = await restarted.apiKeys('status');
    assert.equal(restored.providers.openai, 'configured');
    await assert.rejects(restarted.apiKeys('remove', { provider: 'openai', sessionToken: saved.sessionToken }), /session changed/);
    assert.equal((await restarted.apiKeys('remove', { provider: 'openai', sessionToken: restored.sessionToken })).providers.openai, 'missing');
});

test('profile API-key filesystem failures leave the previous encrypted entry intact', async t => { // NEW
    const a = await fixture(t, 'api-keys-disk-failure');
    const created = await a.service.create({ username: 'Alice', password: 'first-password' });
    const status = await a.service.apiKeys('status');
    await a.service.apiKeys('save', { provider: 'openai', value: 'synthetic-disk-key', sessionToken: status.sessionToken });
    const filename = path.join(a.root, created.session.identityId, 'api-keys/openai.json');
    const before = await fs.readFile(filename, 'utf8');
    const rename = fs.rename;
    fs.rename = async (source, target) => { if (target === filename) throw new Error('simulated disk error'); return rename(source, target); };
    try { await assert.rejects(a.service.apiKeys('save', { provider: 'openai', value: 'synthetic-replacement', sessionToken: status.sessionToken }), /previous key was preserved/); }
    finally { fs.rename = rename; }
    assert.equal(await fs.readFile(filename, 'utf8'), before);
    assert.deepEqual(await fs.readdir(path.dirname(filename)), ['openai.json']);
});

test('queued logout and profile changes reject stale API-key writes', async t => { // NEW
    const a = await fixture(t, 'api-keys-race');
    await a.service.create({ username: 'Alice', password: 'first-password' });
    const status = await a.service.apiKeys('status');
    const lock = a.service.lock();
    const create = a.service.create({ username: 'Bob', password: 'bob-password' });
    const stale = a.service.apiKeys('save', { provider: 'fdc', value: 'synthetic-stale-key', sessionToken: status.sessionToken });
    await lock; await create;
    await assert.rejects(stale, /session changed/);
    assert.equal((await a.service.apiKeys('status')).providers.fdc, 'missing');
});

test('encryption failures preserve previously saved profile keys', async t => { // NEW
    const a = await fixture(t, 'api-keys-failure');
    const created = await a.service.create({ username: 'Alice', password: 'first-password' });
    const initial = await a.service.apiKeys('status');
    await a.service.apiKeys('save', { provider: 'fdc', value: 'synthetic-original-key', sessionToken: initial.sessionToken });
    const filename = path.join(a.root, created.session.identityId, 'api-keys/fdc.json');
    const before = await fs.readFile(filename, 'utf8');
    const restarted = a.restart({ protectSession: () => { throw new Error('synthetic-sensitive-native-error'); } });
    await restarted.unlock({ identityId: created.session.identityId, password: 'first-password' });
    const status = await restarted.apiKeys('status');
    await assert.rejects(restarted.apiKeys('save', { provider: 'fdc', value: 'synthetic-replacement', sessionToken: status.sessionToken }), /previous key was preserved/);
    assert.equal(await fs.readFile(filename, 'utf8'), before);
    assert.equal((await restarted.apiKeys('status')).providers.fdc, 'configured');
});
