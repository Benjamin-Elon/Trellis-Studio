/** Device-local encrypted provider keys. This module has no renderer or network access. */ // NEW
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const providers = ['openai', 'fdc']; // NEW
export function createApiKeyStore({ root, protect, unprotect }) { // NEW
    function filename(identityId, provider) {
        if (!/^[A-Za-z0-9_-]{1,160}$/.test(identityId) || !providers.includes(provider)) throw new Error('Unsupported API key owner or provider.');
        return path.join(root, identityId, 'api-keys', provider + '.json'); // NEW: outside synchronized identity metadata.
    }
    async function read(identityId, provider) {
        let text;
        try { text = await fs.readFile(filename(identityId, provider), 'utf8'); }
        catch (error) { if (error.code === 'ENOENT') return ''; throw new Error('API key storage could not be read.'); }
        try {
            const envelope = JSON.parse(text);
            if (envelope.schema !== 1 || envelope.identityId !== identityId || envelope.provider !== provider || typeof envelope.encrypted !== 'string') throw new Error();
            const key = await unprotect(envelope.encrypted);
            if (typeof key !== 'string' || !key.trim()) throw new Error();
            return key;
        } catch (_) { throw new Error('Stored API key could not be decrypted; remove and replace it.'); } // NEW: never include native errors or credential values.
    }
    async function status(identityId) {
        const result = {};
        for (const provider of providers) {
            try { result[provider] = (await read(identityId, provider)) ? 'configured' : 'missing'; }
            catch (_) { result[provider] = 'storage-error'; }
        }
        return result;
    }
    async function save(identityId, provider, value) {
        const destination = filename(identityId, provider);
        if (typeof value !== 'string' || !value.trim() || Buffer.byteLength(value, 'utf8') > 2560 || value.includes('\0')) throw new Error('Enter a nonblank API key of at most 2560 UTF-8 bytes.');
        const key = value.trim();
        let encrypted;
        try {
            encrypted = await protect(key);
            if (typeof encrypted !== 'string' || !encrypted || await unprotect(encrypted) !== key) throw new Error();
        } catch (_) { throw new Error('Secure API key storage is unavailable; the previous key was preserved.'); }
        const temporary = destination + '.' + randomUUID() + '.tmp';
        try {
            await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
            await fs.writeFile(temporary, JSON.stringify({ schema: 1, identityId, provider, encrypted }), { mode: 0o600, flag: 'wx' });
            await fs.rename(temporary, destination); // NEW: replace only after encryption and verification succeed.
        } catch (_) { throw new Error('API key could not be saved; the previous key was preserved.'); }
        finally { await fs.rm(temporary, { force: true }).catch(() => {}); }
    }
    async function remove(identityId, provider) {
        try { await fs.rm(filename(identityId, provider), { force: true }); }
        catch (_) { throw new Error('API key could not be removed.'); }
    }
    return { status, save, remove, read }; // NEW: read is main-process-only; never exposed by IPC.
}
