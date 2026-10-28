/** Native lock/relaunch checks own their child handles and never touch installed profiles. */ // NEW
const test = require('node:test'); // NEW
const assert = require('node:assert/strict'); // NEW
const fs = require('node:fs/promises'); // NEW
const os = require('node:os'); // NEW
const path = require('node:path'); // NEW
const { spawn, execFile } = require('node:child_process'); // NEW
const helper = path.join(__dirname, 'helpers/trellis-lifecycle-electron.cjs'); // NEW
const profileRuns = new Map(); // NEW: profile teardown awaits every child even after an assertion fails.

/** Parent deadline requests normal Quit, then kills only its own recorded process tree. */ // NEW
function launch(profile, mode = 'quit', forceColor) { // CHANGE: scope color overrides to the children exercising readiness reporting.
    const env = { ...process.env, TRELLIS_LIFECYCLE_PROFILE: profile, TRELLIS_LIFECYCLE_MODE: mode }; delete env.ELECTRON_RUN_AS_NODE; // NEW
    if (forceColor !== undefined) env.FORCE_COLOR = forceColor; // CHANGE: exercise both console formats without changing the parent environment.
    const child = spawn(require('electron'), [helper, '--no-sandbox'], { env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }); // CHANGE: only test children disable Chromium's inner sandbox; the trailing switch is not forwarded as an input file.
    let output = '', stderr = '', closed = false, forceTimer, forced = false; // CHANGE
    const readyWindows = new Set(), readinessWaiters = new Set(); // CHANGE: every owner window must initialize independently.
    function settleReadiness() { // CHANGE: scanning complete lines also handles markers split across stdout chunks.
        for (const match of output.matchAll(/^LIFECYCLE_READY: (\d+)\r?\n/gm)) readyWindows.add(Number(match[1])); // CHANGE
        for (const waiter of readinessWaiters) { // CHANGE
            if (readyWindows.size < waiter.count && !closed) continue; // CHANGE
            readinessWaiters.delete(waiter); waiter.resolve(readyWindows.size >= waiter.count); // CHANGE
        } // CHANGE
    } // CHANGE
    function waitForReadyWindows(count) { // CHANGE: child exit and the existing parent deadline bound every wait.
        return new Promise(resolve => { readinessWaiters.add({ count, resolve }); settleReadiness(); }); // CHANGE
    } // CHANGE
    child.stdout.on('data', data => { output += data; settleReadiness(); }); // CHANGE
    child.stderr.on('data', data => { stderr += data; }); // NEW
    const terminate = () => { // NEW
        if (child.exitCode != null || child.signalCode != null) return result; // CHANGE
        void fs.writeFile(path.join(profile, String(child.pid) + '.quit'), '').catch(() => {}); // CHANGE: request shutdown through this test-owned profile only. // NEW
        if (forceTimer) return result; // CHANGE
        forceTimer = setTimeout(() => { // NEW
            if (child.exitCode != null || child.signalCode != null) return; // NEW
            forced = true; // NEW
            if (process.platform === 'win32') execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {}); // NEW: exact test-owned PID, never a name-based kill.
            else child.kill('SIGKILL'); // NEW
        }, 16000); // NEW
        return result; // NEW
    }; // NEW
    const deadline = setTimeout(terminate, 50000); // NEW
    const result = new Promise((resolve, reject) => { // NEW
        child.once('error', error => { clearTimeout(deadline); clearTimeout(forceTimer); closed = true; settleReadiness(); reject(error); }); // CHANGE
        child.once('close', (code, signal) => { clearTimeout(deadline); clearTimeout(forceTimer); closed = true; settleReadiness(); resolve({ code, signal, output, stderr, forced }); }); // CHANGE
    }); // NEW
    const record = { child, waitForReadyWindows, result, terminate, get diagnostics() { return stderr + output; } }; // CHANGE
    const runs = profileRuns.get(profile) || []; runs.push(record); profileRuns.set(profile, runs); return record; // NEW
} // NEW
async function profile(t) { // NEW
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'trellis-lifecycle-')); // NEW
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir())); assert.ok(path.basename(directory).startsWith('trellis-lifecycle-')); // NEW: verify the exact owned deletion target before registering teardown.
    t.after(async () => { // CHANGE
        const runs = profileRuns.get(directory) || []; // CHANGE
        await Promise.allSettled(runs.map(run => run.terminate())); profileRuns.delete(directory); // CHANGE
        for (const run of runs) assert.ok(run.child.pid == null || run.child.exitCode != null || run.child.signalCode != null, 'Test-owned child is still running: ' + run.child.pid); // CHANGE
        await fs.rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); // NEW
        await assert.rejects(fs.stat(directory), { code: 'ENOENT' }); // CHANGE: confirm the validated temporary profile was released and removed.
    }); // NEW
    return directory; // NEW
} // NEW
function successful(result, expectedWindows = 1) { // CHANGE: a duplicate process must exit cleanly without creating any windows.
    const diagnostics = result.stderr + result.output; // CHANGE
    assert.equal(result.forced, false, diagnostics + '\nParent forced termination after the cleanup deadline.'); // CHANGE
    assert.equal(result.code, 0, diagnostics); assert.equal(result.signal, null, diagnostics); // CHANGE
    assert.doesNotMatch(result.stderr + result.output, /LIFECYCLE_(?:UNCAUGHT|UNHANDLED|TIMEOUT|ERROR)|Object has been destroyed/); // NEW
    const exit = result.output.match(/^LIFECYCLE_EXIT: (.+)\r?$/m); assert.ok(exit, diagnostics); // CHANGE
    const state = JSON.parse(exit[1]); // CHANGE
    assert.equal(state.ready, expectedWindows > 0, diagnostics); assert.equal(state.windows, expectedWindows, diagnostics); // CHANGE
    assert.equal(state.initialized, expectedWindows, diagnostics); assert.equal(state.alive, 0, diagnostics); // CHANGE
    assert.match(result.output, /^LIFECYCLE_NATIVE_QUIT\r?$/m, diagnostics); // CHANGE
} // NEW
test('production window close, explicit Quit and timer-triggered Quit release profiles for immediate relaunch', { timeout: 180000 }, async t => { // NEW
    const directory = await profile(t); // NEW
    for (const mode of ['close', 'quit', 'timeout', 'quit']) { const run = launch(directory, mode); t.after(run.terminate); successful(await run.result); } // NEW
}); // NEW
test('opening a document with a retained draft offers production recovery', { timeout: 90000 }, async t => { // NEW
    const directory = await profile(t), run = launch(directory, 'draft-recovery'); t.after(run.terminate); // NEW
    const result = await run.result; successful(result); assert.match(result.output, /^LIFECYCLE_DRAFT_RECOVERY: offered\r?$/m); // NEW
}); // NEW
for (const forceColor of ['0', '1']) { // CHANGE: the owner must remain reachable with numeric console coloring disabled or enabled.
    test('a second instance is rejected while the owning profile stays reachable: FORCE_COLOR=' + forceColor, { timeout: 120000 }, async t => { // CHANGE
        const directory = await profile(t), owner = launch(directory, 'hold', forceColor); t.after(owner.terminate); // CHANGE
        assert.equal(await owner.waitForReadyWindows(1), true, owner.diagnostics); // CHANGE
        const second = launch(directory, 'quit', forceColor); t.after(second.terminate); const duplicate = await second.result; // CHANGE
        successful(duplicate, 0); assert.doesNotMatch(duplicate.output, /LIFECYCLE_READY/); // CHANGE
        assert.equal(await owner.waitForReadyWindows(2), true, owner.diagnostics); // CHANGE: the owning process creates a window for the rejected second launch.
        owner.terminate(); successful(await owner.result, 2); // CHANGE
    }); // CHANGE
} // CHANGE
test('overlapping production tests use independent profiles and release both', { timeout: 120000 }, async t => { // NEW
    const a = launch(await profile(t)), b = launch(await profile(t)); t.after(a.terminate); t.after(b.terminate); // NEW
    const results = await Promise.all([a.result, b.result]); results.forEach(result => successful(result)); // CHANGE: Array.forEach's index is not the expected window count.
}); // NEW
