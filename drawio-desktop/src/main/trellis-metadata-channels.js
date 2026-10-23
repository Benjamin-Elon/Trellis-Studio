/** Durable allowlisted metadata folders; private identity folders are never reused for community peers. */ // NEW
import fs from 'node:fs/promises'; // NEW
import path from 'node:path'; // NEW
import { canonical, safeId } from './trellis-share-protocol.js'; // NEW

export function createMetadataChannels({ profile, initialize, start, api, writeAtomic, isReady, isPaused, peerAllowed, generation, canConfigure, deviceAddresses, scheduleConfiguration }) { // CHANGE
    const filename = path.join(profile, 'metadata-channels.json'); // NEW
    let channels, queue = Promise.resolve(); // NEW
    async function load() { // NEW
        if (!channels) channels = await fs.readFile(filename, 'utf8').then(JSON.parse).catch(error => { if (error.code === 'ENOENT') return []; throw error; }); // NEW
        if (!Array.isArray(channels)) throw new Error('Invalid metadata channel registry.'); // NEW
        return channels; // NEW
    } // NEW
    async function configureNow() { // CHANGE
        if (!isReady()) return; // NEW
        const currentGeneration = generation(), config = await api('config'); // NEW
        for (const channel of await load()) { // NEW
            const devices = channel.devices.filter(peer => peerAllowed?.(peer) !== false); // NEW
            for (const peer of devices) if (!config.devices.some(d => d.deviceID === peer)) config.devices.push({ ...(config.defaults?.device || {}), deviceID: peer, addresses: deviceAddresses ? deviceAddresses(peer) : ['dynamic'], introducer: false, autoAcceptFolders: false }); // CHANGE
            const folder = { ...(config.defaults?.folder || {}), id: channel.folderId, path: channel.directory, label: channel.label, type: 'sendreceive', paused: channel.paused || channel.disabled, devices: devices.map(deviceID => ({ deviceID })), fsWatcherEnabled: true, fsWatcherDelayS: 1, rescanIntervalS: 300, maxConflicts: -1 }; // CHANGE
            const index = config.folders.findIndex(f => f.id === channel.folderId); // NEW
            if (index < 0) config.folders.push(folder); else config.folders[index] = { ...config.folders[index], ...folder }; // NEW
        } // NEW
        if (generation() !== currentGeneration || !canConfigure()) return; // NEW
        await api('config', 'PUT', config); // NEW
    } // NEW
    const configureAll = () => scheduleConfiguration(configureNow); // NEW: share the garden/identity configuration mutex.
    /** The caller supplies an internal path; renderer payloads never reach this method directly. */ // NEW
    async function configure(input) { // NEW
        const operation = queue.then(async () => { // NEW
            await initialize(); const entries = await load(), id = safeId(input.id), folderId = 'trellis-' + input.kind + '-' + id; // NEW
            if (!['community', 'access-request'].includes(input.kind) || !Array.isArray(input.devices) || input.devices.some(d => typeof d !== 'string' || !d)) throw new Error('Invalid metadata channel.'); // NEW
            const previous = entries.find(c => c.folderId === folderId), next = { folderId, directory: path.resolve(input.directory), label: input.kind === 'community' ? 'Trellis garden community' : 'Trellis private access request', devices: [...new Set(input.devices)].sort(), disabled: !!input.disabled, paused: previous?.paused ?? !!isPaused?.() }; // CHANGE: newly registered channels inherit Pause All.
            if (previous && previous.directory !== next.directory) throw new Error('Metadata channel path cannot change.'); // NEW
            if (canonical(previous || null) === canonical(next)) return { ok: true }; // NEW
            await fs.mkdir(next.directory, { recursive: true, mode: 0o700 }); // NEW
            if (previous) Object.assign(previous, next); else entries.push(next); // NEW
            await writeAtomic(filename, JSON.stringify(entries)); // NEW
            if (!canConfigure()) return { ok: true, queued: true }; // NEW
            try { if (!isReady()) await start(); else await configureAll(); return { ok: true }; } // NEW
            catch (error) { return { ok: true, queued: true, reason: error.message }; } // NEW
        }); // NEW
        queue = operation.catch(() => {}); return operation; // NEW
    } // NEW
    async function pause(paused) { for (const channel of await load()) channel.paused = !!paused; await writeAtomic(filename, JSON.stringify(channels)); await configureAll(); } // NEW
    return { load, configure, configureAll, pause }; // NEW
} // NEW
