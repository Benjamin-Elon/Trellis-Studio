/** Verify orchestration and invalidation without launching native services recursively. */ // CHANGE
import test from 'node:test'; // CHANGE
import assert from 'node:assert/strict'; // CHANGE
import fs from 'node:fs/promises'; // CHANGE
import os from 'node:os'; // CHANGE
import path from 'node:path'; // CHANGE
import { fullSuiteCommands, runFullSuite } from '../scripts/test-full-suite.mjs'; // CHANGE

test('full suite enables every opt-in once and keeps independent suites in order', () => { // CHANGE
    const suites = fullSuiteCommands('/tmp/full'); // CHANGE
    assert.deepEqual(suites.map(suite => suite.name), ['node', 'python', 'android-host', 'android-jvm', 'android-native-ownership', 'production-home']); // CHANGE
    assert.deepEqual(Object.values(suites[0].env), ['1', '1', '1', '1', '1']); // CHANGE
    assert.ok(suites[3].args.includes(':app:testDebugUnitTest')); // CHANGE
    assert.ok(suites[3].args.includes('--rerun-tasks')); // CHANGE: a full validation must execute JVM tests even when source hashes are unchanged.
}); // CHANGE

test('full suite continues after failure and reports changing inputs independently', async t => { // CHANGE
    const output = await fs.mkdtemp(path.join(os.tmpdir(), 'trellis-full-runner-')); t.after(() => fs.rm(output, { recursive: true, force: true })); // CHANGE
    let read = 0, active = false; const seen = []; // CHANGE
    const result = await runFullSuite(output, { suites: [{ name: 'first' }, { name: 'second' }], manifest: async () => ({ 'source.js': ++read === 1 ? 'before' : 'after' }), execute: async suite => { assert.equal(active, false); active = true; await new Promise(resolve => setTimeout(resolve, 5)); seen.push(suite.name); active = false; return { exitCode: seen.length === 1 ? 1 : 0 }; } }); // CHANGE
    assert.deepEqual(seen, ['first', 'second']); assert.equal(result.status, 'failed'); assert.equal(result.sourceStable, false); assert.deepEqual(result.changedSources, ['source.js']); // CHANGE
    assert.equal(JSON.parse(await fs.readFile(path.join(output, 'summary.json'))).suites.length, 2); // CHANGE
    const invalidated = await runFullSuite(output, { suites: [{ name: 'only' }], manifest: async () => ({ 'source.js': String(++read) }), execute: async () => ({ exitCode: 0 }) }); // CHANGE
    assert.equal(invalidated.status, 'invalidated'); // CHANGE
}); // CHANGE
