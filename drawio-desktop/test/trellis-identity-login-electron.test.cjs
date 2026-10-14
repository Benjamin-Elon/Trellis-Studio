/** Optional production smoke: three actual Electron processes share only a temporary profile. */ // NEW
const test = require('node:test'); // NEW
const assert = require('node:assert/strict'); // NEW
const fs = require('node:fs/promises'); // NEW
const os = require('node:os'); // NEW
const path = require('node:path'); // NEW
const { spawn } = require('node:child_process'); // NEW
const project = path.resolve(__dirname, '..'); // NEW
test('Home login survives process restart, canceled logout preserves drafts, and completed logout forgets access', { skip: process.env.TRELLIS_IDENTITY_LOGIN_ELECTRON_TEST !== '1', timeout: 390000 }, async t => { // NEW
    const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'trellis-identity-login-electron-')); // NEW
    t.after(async () => { // NEW
        const resolved = path.resolve(profile); // NEW
        assert.equal(path.dirname(resolved), os.tmpdir()); assert.ok(path.basename(resolved).startsWith('trellis-identity-login-electron-')); // NEW: verify the absolute owned target before recursive cleanup.
        await fs.rm(resolved, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); // NEW
    }); // NEW
    for (const phase of ['create', 'restore', 'logged-out']) { // NEW
        const env = { ...process.env, TRELLIS_LOGIN_TEST_PROFILE: profile, TRELLIS_LOGIN_TEST_PHASE: phase }; delete env.ELECTRON_RUN_AS_NODE; // NEW
        await new Promise((resolve, reject) => { // NEW
            const child = spawn(process.execPath, [path.join(project, 'node_modules/electron/cli.js'), path.join(__dirname, 'helpers/identity-login-production-electron.cjs')], { cwd: project, env, windowsHide: true }); // NEW
            let output = ''; child.stdout.on('data', data => { output += data; }); child.stderr.on('data', data => { output += data; }); // NEW
            const timeout = setTimeout(() => { child.kill(); reject(new Error('Electron phase timed out: ' + phase + '\n' + output.slice(-8000))); }, 125000); // NEW
            child.once('error', error => { clearTimeout(timeout); reject(error); }); // NEW
            child.once('exit', code => { clearTimeout(timeout); if (code === 0) resolve(); else reject(new Error('Electron ' + phase + ' failed (' + code + '):\n' + output)); }); // NEW
        }); // NEW
    } // NEW
}); // NEW
