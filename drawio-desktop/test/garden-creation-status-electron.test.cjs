/** Isolate native trusted-input verification from the installed editor and user profiles. */ // NEW
const test = require('node:test'), assert = require('node:assert/strict'), path = require('node:path'), { spawn } = require('node:child_process'); // NEW
test('new garden status stays summarized and editing labels require genuine native input', { timeout: 90000 }, async () => { // NEW
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; // NEW
    const child = spawn(require('electron'), [path.join(__dirname, 'helpers/garden-creation-status-electron.cjs')], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); let output = ''; // NEW
    child.stdout.on('data', data => { output += data; }); child.stderr.on('data', data => { output += data; }); // NEW
    const timeout = setTimeout(() => child.kill(), 85000); // NEW
    try { const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); }); assert.equal(code, 0, output); assert.match(output, /Native garden creation status and trusted-input checks passed/); } finally { clearTimeout(timeout); } // NEW
}); // NEW
