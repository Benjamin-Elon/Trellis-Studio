/** Bounded, disposable reuse of exact inputs; never a source of current authority. */ // NEW
import { isMainThread, workerData } from 'node:worker_threads'; // CHANGE

/** Entries are private to their caller; estimates include keys and retained structures. */ // NEW
export function createSaveCache(limitBytes = 64 * 1024 * 1024, sharedBytes = null, ownedBytes = null) { // CHANGE
    const entries = new Map(); let bytes = 0, hits = 0, misses = 0, evictions = 0; // NEW
    function get(key) { // NEW
        const entry = entries.get(key); // NEW
        if (!entry) { misses++; return undefined; } // NEW
        entries.delete(key); entries.set(key, entry); hits++; return entry.value; // NEW
    } // NEW
    function set(key, value, estimatedBytes) { // NEW
        const old = entries.get(key); if (old) { bytes -= old.bytes; if (sharedBytes) Atomics.sub(sharedBytes, 0, old.bytes); if (ownedBytes) Atomics.sub(ownedBytes, 0, old.bytes); entries.delete(key); } // CHANGE
        const size = Math.ceil(estimatedBytes + key.length * 2 + 128); // NEW
        if (!Number.isFinite(size) || size < 0 || size > limitBytes) return value; // NEW
        function evict() { const first = entries.keys().next().value, removed = entries.get(first).bytes; bytes -= removed; if (sharedBytes) Atomics.sub(sharedBytes, 0, removed); if (ownedBytes) Atomics.sub(ownedBytes, 0, removed); entries.delete(first); evictions++; } // CHANGE
        while (bytes + size > limitBytes && entries.size) evict(); // CHANGE
        if (sharedBytes) { // NEW: all concurrent replay workers share one reservation budget.
            for (;;) { // NEW
                const reserved = Atomics.load(sharedBytes, 0); // NEW
                if (reserved + size > limitBytes) { if (entries.size) { evict(); continue; } return value; } // NEW
                if (Atomics.compareExchange(sharedBytes, 0, reserved, reserved + size) === reserved) { if (ownedBytes) Atomics.add(ownedBytes, 0, size); break; } // CHANGE
            } // NEW
        } // NEW
        entries.set(key, { value, bytes: size }); bytes += size; return value; // NEW
    } // NEW
    return { get, set, clear() { if (sharedBytes) Atomics.sub(sharedBytes, 0, bytes); if (ownedBytes) Atomics.sub(ownedBytes, 0, bytes); entries.clear(); bytes = 0; }, stats: () => ({ bytes, entries: entries.size, hits, misses, evictions, limitBytes }) }; // CHANGE
} // NEW

// Reserve 96 MiB for current main-process evidence and 48 MiB shared by transient replay workers. // CHANGE
export const replayCacheBudget = isMainThread ? new SharedArrayBuffer(4) : workerData?.cacheBudget; // NEW
export const saveCache = createSaveCache(isMainThread ? 96 * 1024 * 1024 : replayCacheBudget ? 48 * 1024 * 1024 : 0, !isMainThread && replayCacheBudget ? new Int32Array(replayCacheBudget) : null, !isMainThread && workerData?.cacheOwner ? new Int32Array(workerData.cacheOwner) : null); // CHANGE: keep a bounded working set of current/base/proposed object indexes; no historical collaboration results are retained.
