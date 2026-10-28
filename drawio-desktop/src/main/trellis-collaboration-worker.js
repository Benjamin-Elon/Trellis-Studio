/** NEW: Replay verified journal payloads off the Electron main thread; no filesystem or transport access. */
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads'; // NEW
import { replay } from './trellis-collaboration-protocol.js'; // NEW
import { replayCacheBudget, saveCache } from './trellis-save-cache.js';
import { LIMITS, validateJson, textLimit, fail } from './trellis-input-policy.js'; // NEW // NEW

/** One worker owns one replay; errors reject before the caller materializes any XML. */ // NEW
export function replayInWorker(xml, records, time, onReuse = () => {}, options = {}) { // CHANGE
    textLimit(xml); validateJson(records); // NEW
    if (!Array.isArray(records) || records.length > LIMITS.records) fail('REPLAY_LIMIT', 'Replay record limit exceeded.'); // NEW
    let bytes = Buffer.byteLength(xml); for (const record of records) { bytes += Buffer.byteLength(JSON.stringify(record)); if (bytes > LIMITS.replay) fail('REPLAY_LIMIT', 'Replay byte limit exceeded.'); } // NEW
    return new Promise((resolve, reject) => { // NEW
        const cacheOwner = new SharedArrayBuffer(4); // NEW: the parent can reclaim a crashed worker's reservation after exit.
        const worker = new Worker(new URL(import.meta.url), { workerData: { xml, records, time, cacheBudget: replayCacheBudget, cacheOwner }, execArgv: [], resourceLimits: { maxOldGenerationSizeMb: Math.max(16, Math.min(LIMITS.heap, Number(options.heapMb) || LIMITS.heap)) } }); // CHANGE
        let received = false, result, failure; // CHANGE
        const timeout = setTimeout(() => { failure = Object.assign(new Error('Replay exceeded its processing deadline. Input and drafts were preserved.'), { code: 'REPLAY_TIMEOUT' }); void worker.terminate(); }, Math.max(1, Math.min(LIMITS.timeout, Number(options.timeoutMs) || LIMITS.timeout))); // NEW // NEW
        worker.once('message', value => { received = true; result = value; }); // NEW
        worker.once('error', error => { failure = error; }); // CHANGE: the queue stays occupied until worker exit. // NEW
        worker.once('exit', code => {
            clearTimeout(timeout); // NEW // CHANGE
            Atomics.sub(new Int32Array(replayCacheBudget), 0, Atomics.exchange(new Int32Array(cacheOwner), 0, 0)); // NEW
            if (!failure && received && code === 0) { try { onReuse(result.reuse); } catch (_) {} resolve(result.state); } else reject(failure || new Error('Collaboration replay worker exited before completing a result (' + code + ').')); // CHANGE
        }); // CHANGE
    }); // NEW
} // NEW

if (!isMainThread) { // CHANGE
    try { const state = replay(workerData.xml, workerData.records, workerData.time); parentPort.postMessage({ state, reuse: saveCache.stats() }); } finally { saveCache.clear(); } // CHANGE: successful and failed replays release every shared reservation.
} // CHANGE
