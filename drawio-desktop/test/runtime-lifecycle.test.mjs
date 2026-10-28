/** Real filesystem checks for cleanup retention and bounded runtime observations. */ // CHANGE
import test from 'node:test'; // CHANGE
import assert from 'node:assert/strict'; // CHANGE
import fs from 'node:fs/promises'; // CHANGE
import os from 'node:os'; // CHANGE
import path from 'node:path'; // CHANGE
import { cleanupRuntimeServices, waitForRuntime } from './helpers/runtime-lifecycle.mjs'; // CHANGE

test('runtime cleanup attempts all owners and preserves profile on any unconfirmed exit', async t => { // CHANGE
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'trellis-cleanup-test-')); t.after(() => fs.rm(root, { recursive: true, force: true })); // CHANGE
    let otherStopped = false; // CHANGE
    await assert.rejects(cleanupRuntimeServices([{ stop: async () => { throw new Error('daemon alive'); } }, { stop: async () => { otherStopped = true; return { ok: true }; } }], root), /preserved runtime profile/); // CHANGE
    assert.equal(otherStopped, true); await fs.access(root); // CHANGE
    await cleanupRuntimeServices([{ stop: async () => ({ ok: true }) }], root); await assert.rejects(fs.access(root), { code: 'ENOENT' }); // CHANGE
}); // CHANGE

test('runtime phase bounds include a hung observation and retain its phase name', async () => { // CHANGE
    await assert.rejects(waitForRuntime('blocked directory membership', () => new Promise(() => {}), 25), /blocked directory membership: Observation exceeded/); // CHANGE
}); // CHANGE
