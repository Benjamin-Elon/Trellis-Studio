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
function launch(profile, mode = 'quit') { // NEW
    const env = { ...process.env, TRELLIS_LIFECYCLE_PROFILE: profile, TRELLIS_LIFECYCLE_MODE: mode }; delete env.ELECTRON_RUN_AS_NODE; // NEW
    const child = spawn(require('electron'), [helper], { env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }); // NEW
    let output = '', stderr = '', settleReady, readySeen = false, forceTimer, forced = false; // NEW
    const ready = new Promise(resolve => { settleReady = resolve; }); // NEW
    child.stdout.on('data', data => { output += data; if (!readySeen && output.includes('LIFECYCLE_READY')) { readySeen = true; settleReady(true); } }); // NEW
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
        child.once('error', error => { clearTimeout(deadline); clearTimeout(forceTimer); settleReady(false); reject(error); }); // NEW
        child.once('close', (code, signal) => { clearTimeout(deadline); clearTimeout(forceTimer); settleReady(false); resolve({ code, signal, output, stderr, forced }); }); // NEW
    }); // NEW
    const record = { child, ready, result, terminate }; // CHANGE
    const runs = profileRuns.get(profile) || []; runs.push(record); profileRuns.set(profile, runs); return record; // NEW
} // NEW
async function profile(t) { // NEW
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'trellis-lifecycle-')); // NEW
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir())); assert.ok(path.basename(directory).startsWith('trellis-lifecycle-')); // NEW: verify the exact owned deletion target before registering teardown.
    t.after(async () => { // CHANGE
        await Promise.allSettled((profileRuns.get(directory) || []).map(run => run.terminate())); profileRuns.delete(directory); // NEW
        await fs.rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); // NEW
    }); // NEW
    return directory; // NEW
} // NEW
function successful(result) { // NEW
    assert.equal(result.code, 0, result.stderr + result.output + (result.forced ? '\nParent forced termination after the cleanup deadline.' : '')); assert.equal(result.signal, null); // NEW
    assert.doesNotMatch(result.stderr + result.output, /LIFECYCLE_(?:UNCAUGHT|UNHANDLED|TIMEOUT|ERROR)|Object has been destroyed/); // NEW
    assert.match(result.output, /LIFECYCLE_EXIT:/); // NEW
} // NEW
test('production window close, explicit Quit and timer-triggered Quit release profiles for immediate relaunch', { timeout: 180000 }, async t => { // NEW
    const directory = await profile(t); // NEW
    for (const mode of ['close', 'quit', 'timeout', 'quit']) { const run = launch(directory, mode); t.after(run.terminate); successful(await run.result); } // NEW
}); // NEW
test('a second instance is rejected while the owning profile stays reachable', { timeout: 120000 }, async t => { // NEW
    const directory = await profile(t), owner = launch(directory, 'hold'); t.after(owner.terminate); // NEW
    assert.equal(await owner.ready, true); // NEW
    const second = launch(directory); t.after(second.terminate); const duplicate = await second.result; // NEW
    assert.equal(duplicate.code, 0, duplicate.stderr + duplicate.output); assert.doesNotMatch(duplicate.output, /LIFECYCLE_READY/); // NEW
    owner.terminate(); successful(await owner.result); // NEW
}); // NEW
test('overlapping production tests use independent profiles and release both', { timeout: 120000 }, async t => { // NEW
    const a = launch(await profile(t)), b = launch(await profile(t)); t.after(a.terminate); t.after(b.terminate); // NEW
    const results = await Promise.all([a.result, b.result]); results.forEach(successful); // NEW
}); // NEW
