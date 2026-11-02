/** Bounded data-only analysis; reconstruction has one slot and never owns files or signing keys. */ // CHANGE
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads'; // CHANGE
import { canonical, digest } from './trellis-share-protocol.js'; // CHANGE
import { diffObjects } from './trellis-collaboration-protocol.js'; // CHANGE
import { replayCacheBudget, saveCache } from './trellis-save-cache.js'; // NEW: retain the existing shared replay-cache budget.
import { LIMITS } from './trellis-input-policy.js'; // CHANGE
import '../../drawio/src/main/webapp/js/trellis-reference-core.js'; // CHANGE
const pending = []; let active = 0, reconstructing = 0; const MAX_ACTIVE = 2, MAX_PENDING = 16; // CHANGE
const aborted = () => Object.assign(new Error('Garden verification was canceled. Files and drafts were preserved.'), { code: 'ABORT_ERR' }); // CHANGE
/** Release a running slot only after exit, including timeout and cancellation. */ // CHANGE
function drain() { // CHANGE
    while (active < MAX_ACTIVE) { // CHANGE
        pending.sort((left, right) => Number(left.options.priority === 'background') - Number(right.options.priority === 'background')); // NEW
        const index = pending.findIndex(job => job.operation !== 'current-state' || reconstructing === 0); // CHANGE
        if (index < 0) return; // CHANGE
        const job = pending.splice(index, 1)[0]; if (job.options.signal?.aborted) { job.finish(aborted()); continue; } // CHANGE
        active++; if (job.operation === 'current-state') reconstructing++; // CHANGE
        let worker, result, failure; const cacheOwner = new SharedArrayBuffer(4); // CHANGE // CHANGE
        try { worker = new Worker(new URL(import.meta.url), { workerData: { operation: job.operation, input: job.input, cacheBudget: replayCacheBudget, cacheOwner }, execArgv: [], resourceLimits: { maxOldGenerationSizeMb: job.operation === 'current-state' ? LIMITS.heap : 192 } }); } // CHANGE
        catch (error) { active--; if (job.operation === 'current-state') reconstructing--; job.finish(error); continue; } // CHANGE
        job.cancel = () => { failure = aborted(); void worker.terminate(); }; // CHANGE
        const timeout = setTimeout(() => { failure = Object.assign(new Error('Garden verification exceeded its processing deadline. Files and drafts were preserved.'), { code: 'REPLAY_TIMEOUT' }); void worker.terminate(); }, Math.max(1, Math.min(LIMITS.timeout, job.options.timeoutMs || LIMITS.timeout))); // CHANGE
        worker.on('message', message => { // CHANGE
            if (message.progress) { try { job.options.onProgress?.(message.progress); } catch (_) {} } // NEW: diagnostics never change verification.
            else if (message.reference) { // CHANGE
                Promise.resolve().then(() => { if (!/^[a-f0-9]{64}$/.test(message.reference)) throw new Error('Invalid reference snapshot address.'); return job.options.loadReference?.(message.reference); }).then(raw => { if (!failure) worker.postMessage({ reference: message.reference, raw }); }, error => { if (!failure) worker.postMessage({ reference: message.reference, error: error.message }); }); // CHANGE
            } else if (message.error) failure = Object.assign(new Error(message.error), { code: message.code }); else result = message.result; // CHANGE
        }); // CHANGE
        worker.once('error', error => { failure = error; }); // CHANGE
        worker.once('exit', code => { clearTimeout(timeout); Atomics.sub(new Int32Array(replayCacheBudget), 0, Atomics.exchange(new Int32Array(cacheOwner), 0, 0)); active--; if (job.operation === 'current-state') reconstructing--; job.finish(failure || (code || result === undefined ? new Error('Document analysis stopped before returning a result.') : null), result); drain(); }); // CHANGE
    } // CHANGE
} // CHANGE
/** User opening requests precede queued maintenance; duplicate work is coalesced by the project owner. */ // CHANGE
export function analyzeDocument(operation, input, options = {}) { // CHANGE
    if (options.signal?.aborted) return Promise.reject(aborted()); // CHANGE
    if (pending.length >= MAX_PENDING) return Promise.reject(new Error('Document analysis is busy. Your draft is retained; retry after the active operations finish.')); // CHANGE
    return new Promise((resolve, reject) => { // CHANGE
        const job = { operation, input, options, cancel: null, finish(error, result) { options.signal?.removeEventListener('abort', cancel); error ? reject(error) : resolve(result); } }; // CHANGE
        const cancel = () => { const index = pending.indexOf(job); if (index >= 0) { pending.splice(index, 1); job.finish(aborted()); drain(); } else job.cancel?.(); }; // CHANGE
        options.signal?.addEventListener('abort', cancel, { once: true }); // CHANGE
        if (options.priority === 'background') pending.push(job); else { const index = pending.findIndex(item => item.options.priority === 'background'); pending.splice(index < 0 ? pending.length : index, 0, job); } // CHANGE
        drain(); // CHANGE
    }); // CHANGE
} // CHANGE
/** Promote a selected garden without duplicating its queued reconstruction. */ // NEW
export function prioritizeAnalysis(signal) { for (const job of pending) if (job.options.signal === signal) job.options.priority = 'user'; } // NEW
if (!isMainThread) { // CHANGE
    const requests = new Map(); // CHANGE
    parentPort.on('message', message => { const request = requests.get(message.reference); if (request) { requests.delete(message.reference); message.error ? request.reject(new Error(message.error)) : request.resolve(message.raw); } }); // CHANGE
    void (async () => { // CHANGE: finish module initialization before loading the shared reducer.
    try { // CHANGE
        let result; // CHANGE
        if (workerData.operation === 'reference') { globalThis.TrellisReferenceCore.validate(workerData.input); result = digest(globalThis.TrellisReferenceCore.canonical(workerData.input)); } // CHANGE
        else if (workerData.operation === 'diff') result = diffObjects(workerData.input.before, workerData.input.after); // CHANGE
        else if (workerData.operation === 'current-state') { // CHANGE
            const { verifyCurrentEvidence } = await import('./trellis-current-state.js'); // CHANGE
            result = await verifyCurrentEvidence(workerData.input, hash => new Promise((resolve, reject) => { requests.set(hash, { resolve, reject }); parentPort.postMessage({ reference: hash }); }), progress => parentPort.postMessage({ progress })); // CHANGE
        } else throw new Error('Unsupported document analysis.'); // CHANGE
        parentPort.postMessage({ result }); // CHANGE
    } catch (error) { parentPort.postMessage({ error: error.message, code: error.code }); } finally { saveCache.clear(); parentPort.close(); } // CHANGE
    })(); // NEW
} // CHANGE
