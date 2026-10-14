/**
 * Portable identity primitives implemented by the platform Web Crypto API. // NEW
 * Private signing keys stay device-local; setup envelopes target an ECDH key. // NEW
 * Password records wrap an independent random vault key, never a raw password. // NEW
 */
(function(root) {
    'use strict';
    const encoder = new TextEncoder(), decoder = new TextDecoder();
    const subtle = () => root.crypto.subtle;
    const bytes = value => typeof value === 'string' ? encoder.encode(value) : value;
    const b64 = value => { let s = ''; for (const b of new Uint8Array(value)) s += String.fromCharCode(b); return btoa(s); };
    const un64 = value => Uint8Array.from(atob(value), ch => ch.charCodeAt(0));
    function canonical(value) {
        if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
        if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
        return JSON.stringify(value);
    }
    async function fingerprint(value) {
        return [...new Uint8Array(await subtle().digest('SHA-256', bytes(canonical(value))))].map(b => b.toString(16).padStart(2, '0')).join('');
    }
    async function keyPair(kind = 'ECDSA') {
        const keys = await subtle().generateKey({ name: kind, namedCurve: 'P-256' }, true, kind === 'ECDH' ? ['deriveBits'] : ['sign', 'verify']);
        return { publicKey: await subtle().exportKey('jwk', keys.publicKey), privateKey: await subtle().exportKey('jwk', keys.privateKey) };
    }
    async function sign(payload, privateKey) {
        const key = await subtle().importKey('jwk', privateKey, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
        return { payload, signature: b64(await subtle().sign({ name: 'ECDSA', hash: 'SHA-256' }, key, bytes(canonical(payload)))) };
    }
    async function verify(record, publicKey) {
        try {
            const key = await subtle().importKey('jwk', publicKey, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
            return await subtle().verify({ name: 'ECDSA', hash: 'SHA-256' }, key, un64(record.signature), bytes(canonical(record.payload)));
        } catch (_) { return false; }
    }
    /** Authenticate contextual identifiers as well as the encrypted content. */
    async function seal(value, rawKey, context) {
        const iv = root.crypto.getRandomValues(new Uint8Array(12));
        const key = await subtle().importKey('raw', rawKey, 'AES-GCM', false, ['encrypt']);
        return { iv: b64(iv), data: b64(await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: bytes(context) }, key, bytes(JSON.stringify(value)))) };
    }
    async function open(envelope, rawKey, context) {
        const key = await subtle().importKey('raw', rawKey, 'AES-GCM', false, ['decrypt']);
        return JSON.parse(decoder.decode(await subtle().decrypt({ name: 'AES-GCM', iv: un64(envelope.iv), additionalData: bytes(context) }, key, un64(envelope.data))));
    }
    async function passwordKey(password, salt, iterations) {
        if (typeof password !== 'string' || !password.length || password.length > 1024) throw new Error('Enter a password of at most 1024 characters.');
        if (!Number.isSafeInteger(iterations) || iterations < 600000 || iterations > 2000000) throw new Error('Invalid credential derivation parameters.');
        const source = await subtle().importKey('raw', bytes(password), 'PBKDF2', false, ['deriveBits']);
        return new Uint8Array(await subtle().deriveBits({ name: 'PBKDF2', salt: un64(salt), iterations, hash: 'SHA-256' }, source, 256));
    }
    async function protectPassword(vaultKey, password, context) {
        const salt = b64(root.crypto.getRandomValues(new Uint8Array(16))), iterations = 600000;
        const key = await passwordKey(password, salt, iterations);
        try { return { algorithm: 'PBKDF2-SHA256/AES-256-GCM', salt, iterations, envelope: await seal({ vaultKey: b64(vaultKey) }, key, context) }; }
        finally { key.fill(0); }
    }
    async function unlockPassword(record, password, context) {
        if (record.algorithm !== 'PBKDF2-SHA256/AES-256-GCM') throw new Error('Unsupported password record.');
        const key = await passwordKey(password, record.salt, record.iterations);
        try { return un64((await open(record.envelope, key, context)).vaultKey); }
        finally { key.fill(0); }
    }
    async function sharedKey(privateKey, publicKey) {
        const own = await subtle().importKey('jwk', privateKey, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
        const peer = await subtle().importKey('jwk', publicKey, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
        return new Uint8Array(await subtle().deriveBits({ name: 'ECDH', public: peer }, own, 256));
    }
    /** Every event carries parents; branch heads never depend on wall clocks. */
    async function reduceEvents(records, expectedIdentityId) {
        const pending = new Map();
        for (const record of records) {
            const p = record && record.payload;
            if (!p || p.schema !== 1 || p.identityId !== expectedIdentityId || typeof p.id !== 'string' || !Array.isArray(p.parents)) throw new Error('Invalid identity event.');
            if (pending.has(p.id) && canonical(pending.get(p.id)) !== canonical(record)) throw new Error('Conflicting identity event identifier.');
            pending.set(p.id, record);
        }
        const accepted = new Map(), devices = new Map(), revoked = new Set();
        let genesis = null;
        while (pending.size) {
            let progress = false;
            for (const [id, record] of [...pending].sort(([a], [b]) => a < b ? -1 : 1)) {
                const p = record.payload;
                if (!p.parents.every(parent => accepted.has(parent))) continue;
                const lineage = new Map(); // NEW: authorize against causal parents, independent of remote file arrival order.
                function collect(parent) { if (lineage.has(parent)) return; const value = accepted.get(parent); if (!value) return; lineage.set(parent, value); for (const ancestor of value.payload.parents) collect(ancestor); } // NEW
                for (const parent of p.parents) collect(parent); // NEW
                const ancestorDevices = new Map(), ancestorRevocations = new Set(); // NEW
                for (const value of lineage.values()) { const event = value.payload; if (event.device) ancestorDevices.set(event.device.id, event.device); if (event.kind === 'remove-device') ancestorRevocations.add(event.deviceId); } // NEW
                const signer = p.kind === 'genesis' ? p.device : ancestorDevices.get(p.author); // CHANGE
                if (!signer || ancestorRevocations.has(p.author) || !await verify(record, signer.publicKey)) throw new Error('Identity event signature or membership is invalid.'); // CHANGE
                if (p.kind === 'genesis') {
                    if (genesis || p.parents.length || p.author !== p.device.id || !p.username || !p.credential) throw new Error('Invalid identity genesis.');
                    genesis = record; devices.set(p.device.id, p.device);
                } else if (!genesis) throw new Error('Missing identity genesis.');
                else if (p.kind === 'add-device') {
                    if (!p.device || ancestorDevices.has(p.device.id) || ancestorRevocations.has(p.device.id)) throw new Error('Device already enrolled or revoked.'); // CHANGE
                    devices.set(p.device.id, p.device);
                } else if (p.kind === 'remove-device') {
                    revoked.add(p.deviceId); devices.delete(p.deviceId);
                } else if (p.kind !== 'password') throw new Error('Unsupported identity event.');
                accepted.set(id, record); pending.delete(id); progress = true;
            }
            if (!progress) break; // Incomplete remote transfers remain pending until their parents arrive.
        }
        if (!genesis) throw new Error('Identity genesis is unavailable.');
        const ancestor = (child, target, seen = new Set()) => {
            if (seen.has(child)) return false;
            seen.add(child);
            return (accepted.get(child)?.payload.parents || []).some(parent => parent === target || ancestor(parent, target, seen));
        };
        const all = [...accepted.values()];
        const credentials = all.filter(r => r.payload.credential);
        const passwordHeads = credentials.filter(a => !credentials.some(b => a !== b && ancestor(b.payload.id, a.payload.id)));
        const heads = all.filter(a => !all.some(b => b.payload.parents.includes(a.payload.id))).map(r => r.payload.id);
        return { identityId: expectedIdentityId, username: genesis.payload.username, genesis, devices: [...devices.values()].filter(device => !revoked.has(device.id)), revoked: [...revoked], passwordHeads, heads, records: all, pending: [...pending.values()] }; // CHANGE: concurrent revocation wins for future authorization.
    }
    root.TrellisIdentityProtocol = Object.freeze({ canonical, fingerprint, keyPair, sign, verify, seal, open, b64, un64, protectPassword, unlockPassword, sharedKey, reduceEvents });
})(typeof globalThis !== 'undefined' ? globalThis : window);
