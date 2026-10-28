const test = require('node:test'); // NEW
const assert = require('node:assert/strict'); // NEW
const path = require('node:path'); // NEW
const { spawn } = require('node:child_process'); // NEW
test('native handoff popup drags, cancels, clamps, saves and expires without changing graph objects', { timeout: 60000 }, async () => { // NEW
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; // NEW
    const child = spawn(require('electron'), [path.join(__dirname, 'helpers/hold-countdown-electron.cjs')], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); // NEW
    let output = ''; child.stdout.on('data', data => { output += data; }); child.stderr.on('data', data => { output += data; }); // NEW
    const timeout = setTimeout(() => child.kill(), 55000); // NEW
    try { const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); }); assert.equal(code, 0, output); assert.match(output, /Native hold countdown checks passed/); } finally { clearTimeout(timeout); } // NEW
}); // NEW
