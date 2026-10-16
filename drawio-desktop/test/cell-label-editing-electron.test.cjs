/** Run native input verification without using the installed application's profile. */ // NEW
const test = require('node:test'); // NEW
const assert = require('node:assert/strict'); // NEW
const path = require('node:path'); // NEW
const { spawn } = require('node:child_process'); // NEW

test('native label typing survives background refresh with focus and caret intact', { timeout: 60000 }, async () => { // NEW
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; // NEW
    const child = spawn(require('electron'), [path.join(__dirname, 'helpers/cell-label-editing-electron.cjs')], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); // NEW
    let output = '', errors = ''; // NEW
    child.stdout.on('data', data => { output += data; }); child.stderr.on('data', data => { errors += data; }); // NEW
    const deadline = setTimeout(() => child.kill(), 45000); // NEW: bound only this test-owned child process.
    try { // NEW
        const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); }); // NEW
        assert.equal(code, 0, errors + output); assert.match(output, /LABEL_EDITING_RESULT:.*"ok":true/, errors + output); // NEW
        console.log(output.trim()); // NEW: expose the run-specific screenshots for visual verification.
    } finally { clearTimeout(deadline); } // NEW
}); // NEW
