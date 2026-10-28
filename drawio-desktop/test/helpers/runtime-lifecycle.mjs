/** Shared bounds and owned-profile cleanup for real daemon integration tests. */ // CHANGE
import fs from 'node:fs/promises'; // CHANGE
import os from 'node:os'; // CHANGE
import path from 'node:path'; // CHANGE

/** Label a single awaited workflow step, including startup calls before convergence polling begins. */ // CHANGE
export async function runtimeOperation(label, operation, timeoutMs = 60000) { // CHANGE
    const started = Date.now(); let timer, outcome = 'failed'; console.log('RUNTIME_OPERATION:', JSON.stringify({ label, phase: 'started', at: started })); // CHANGE
    try { const result = await Promise.race([operation(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(label + ' exceeded its operation bound')), timeoutMs); })]); outcome = 'passed'; return result; } // CHANGE
    finally { clearTimeout(timer); console.log('RUNTIME_OPERATION:', JSON.stringify({ label, outcome, at: Date.now(), elapsedMs: Date.now() - started })); } // CHANGE
} // CHANGE

/** Bound each observation as well as convergence; a hung observation must terminate the phase. */ // CHANGE
export async function waitForRuntime(label, check, timeoutMs = 60000) { // CHANGE
    const started = Date.now(), deadline = started + timeoutMs; let lastError; // CHANGE
    console.log('RUNTIME_PHASE:', JSON.stringify({ label, phase: 'started', at: started })); // CHANGE
    try { // CHANGE
        while (Date.now() < deadline) { // CHANGE
            let timer; // CHANGE
            try { // CHANGE
                const result = await Promise.race([check(), new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error('Observation exceeded its operation bound'), { code: 'RUNTIME_OPERATION_TIMEOUT' })), Math.min(15000, deadline - Date.now())); })]); // CHANGE
                if (result) return; // CHANGE
            } catch (error) { if (error.code === 'RUNTIME_OPERATION_TIMEOUT') throw error; lastError = error; } // CHANGE
            finally { clearTimeout(timer); } // CHANGE
            await new Promise(resolve => setTimeout(resolve, Math.min(400, Math.max(0, deadline - Date.now())))); // CHANGE
        } // CHANGE
        throw new Error(lastError?.message || 'did not converge'); // CHANGE
    } catch (error) { throw new Error(label + ': ' + error.message, { cause: error }); } // CHANGE
    finally { console.log('RUNTIME_PHASE:', JSON.stringify({ label, phase: 'finished', at: Date.now(), elapsedMs: Date.now() - started, lastError: lastError?.code || lastError?.name })); } // CHANGE
} // CHANGE

/** Try every owned service; never remove a profile whose daemon failed to exit. */ // CHANGE
export async function cleanupRuntimeServices(services, root) { // CHANGE
    const resolved = path.resolve(root); // CHANGE
    if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('trellis-')) throw new Error('Unexpected runtime cleanup root: ' + resolved); // CHANGE
    const results = await Promise.allSettled(services.map(service => service.stop())); // CHANGE
    const failures = results.filter(result => result.status === 'rejected'); // CHANGE
    console.log('RUNTIME_CLEANUP:', JSON.stringify({ root: resolved, at: Date.now(), services: results.map(result => result.status === 'fulfilled' ? result.value : { error: result.reason.message }) })); // CHANGE
    if (failures.length) throw new AggregateError(failures.map(result => result.reason), 'Owned daemon still unconfirmed; preserved runtime profile ' + resolved); // CHANGE
    await fs.rm(resolved, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); // CHANGE: retry Windows lock release only after all owned exits are confirmed.
} // CHANGE
