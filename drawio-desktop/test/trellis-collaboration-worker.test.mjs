/** NEW: Off-thread replay preserves arbitration results and the main event loop. */
import test from 'node:test'; // NEW
import assert from 'node:assert/strict'; // NEW
import { replay } from '../src/main/trellis-collaboration-protocol.js'; // NEW
import { replayInWorker } from '../src/main/trellis-collaboration-worker.js'; // NEW
import { replayCacheBudget } from '../src/main/trellis-save-cache.js'; // NEW

const xml = '<mxGraphModel><root><mxCell id="0"/><object id="1" trellis_users_json="{&quot;users&quot;:[{&quot;id&quot;:&quot;admin&quot;,&quot;admin&quot;:true}]}"><mxCell parent="0"/></object></root></mxGraphModel>'; // NEW
test('worker replay preserves results while the caller processes timer events', async () => { // NEW
    const records = Array.from({ length: 1000 }, (_, i) => ({ id: 'view-' + i, kind: 'view', clock: i + 1, parents: i ? ['view-' + (i - 1)] : [], deviceId: 'A', sessionId: 'session', userId: 'admin', at: i + 1, targets: [] })); // NEW
    let beats = 0; const timer = setInterval(() => beats++, 1); // NEW
    try { // NEW
        const result = await replayInWorker(xml, records, 2000); // NEW
        assert.ok(beats > 0, 'Journal replay must yield to the caller event loop.'); // NEW
        assert.deepEqual(result, replay(xml, records, 2000)); // NEW
    } finally { clearInterval(timer); } // NEW
}); // NEW
test('worker validation errors propagate without returning a partial projection', async () => { // NEW
    const invalid = { id: 'bad', kind: 'claim', clock: 0, parents: [], userId: 'admin', sessionId: 's', deviceId: 'A', at: 1 }; // NEW
    await assert.rejects(replayInWorker(xml, [invalid], 2000), /Invalid collaboration record clock/); // NEW
    assert.deepEqual(await replayInWorker(xml, [], 2000), replay(xml, [], 2000)); // NEW: a failed worker cannot poison subsequent reads.
}); // NEW

test('parallel successful and failed workers release their bounded parsing reservations', async () => { // NEW
    const invalid = { id: 'bad', kind: 'claim', clock: 0, parents: [], userId: 'admin', sessionId: 's', deviceId: 'A', at: 1 }; // NEW
    const results = await Promise.allSettled([replayInWorker(xml, [], 2000), replayInWorker(xml, [invalid], 2000), replayInWorker(xml, [], 2000)]); // NEW
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 2); // NEW
    // The error event precedes exit; a successful follow-up also proves the shared budget remains usable. // NEW
    await replayInWorker(xml, [], 2000); assert.equal(Atomics.load(new Int32Array(replayCacheBudget), 0), 0); // NEW
}); // NEW
