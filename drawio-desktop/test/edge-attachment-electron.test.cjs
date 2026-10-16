/** Exercise native Chromium drag input in a separate hidden application profile. */ // NEW
const test = require('node:test'); // NEW
const assert = require('node:assert/strict'); // NEW
const path = require('node:path'); // NEW
const { spawn } = require('node:child_process'); // NEW

test('native U movement and hover-arrow connection preserve chosen sides in preview and commit', { timeout: 60000 }, async () => { // CHANGE
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; // NEW
    const child = spawn(require('electron'), [path.join(__dirname, 'helpers/edge-attachment-electron.cjs')], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); // NEW
    let output = '', errors = ''; child.stdout.on('data', data => { output += data; }); child.stderr.on('data', data => { errors += data; }); // NEW
    const deadline = setTimeout(() => child.kill(), 45000); // NEW
    try { // NEW
        const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); }); // NEW
        assert.equal(code, 0, errors + output); assert.match(output, /EDGE_ATTACHMENT_RESULT:.*"ok":true/, errors + output); console.log(output.trim()); // NEW
    } finally { clearTimeout(deadline); } // NEW
}); // NEW
