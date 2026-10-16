/** Exercise native inputs and mxGraph without opening the user's installed profile. */ // NEW
const test = require('node:test'); // NEW
const assert = require('node:assert/strict'); // NEW
const { spawn } = require('node:child_process'); // NEW
const path = require('node:path'); // NEW
test('collaboration forms isolate native inputs and graph saves preserve editing lifecycle', { timeout: 60000 }, async () => { // NEW
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; // NEW
    const child = spawn(require('electron'), [path.join(__dirname, 'helpers/trellis-collaboration-electron.cjs')], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); // NEW
    let output = '', errors = ''; // NEW
    child.stdout.on('data', data => { output += data; }); child.stderr.on('data', data => { errors += data; }); // NEW
    const deadline = setTimeout(() => child.kill(), 45000); // NEW: terminate only the test-owned Electron process.
    try { // NEW
        const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); }); // NEW
        assert.equal(code, 0, errors + output); assert.match(output, /"ok":true/, errors + output); // NEW
    } finally { clearTimeout(deadline); } // NEW
}); // NEW
