/** NEW: Replay verified journal payloads off the Electron main thread; no filesystem or transport access. */
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads'; // NEW
import { replay } from './trellis-collaboration-protocol.js'; // NEW

/** One worker owns one replay; errors reject before the caller materializes any XML. */ // NEW
export function replayInWorker(xml, records, time) { // NEW
    return new Promise((resolve, reject) => { // NEW
        const worker = new Worker(new URL(import.meta.url), { workerData: { xml, records, time }, execArgv: [] }); // NEW: do not inherit inspector or test-runner flags.
        let received = false, result; // NEW
        worker.once('message', value => { received = true; result = value; }); // NEW
        worker.once('error', reject); // NEW
        worker.once('exit', code => { if (received && code === 0) resolve(result); else reject(new Error('Collaboration replay worker exited before completing a result (' + code + ').')); }); // NEW: serialized callers finish only after their worker is fully stopped.
    }); // NEW
} // NEW

if (!isMainThread) parentPort.postMessage(replay(workerData.xml, workerData.records, workerData.time)); // NEW: worker exits naturally after posting its deterministic result.
