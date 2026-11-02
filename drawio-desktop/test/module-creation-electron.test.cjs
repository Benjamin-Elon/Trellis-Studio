/** Full-application module creation in test-owned profiles; no installed user data is opened. */ // CHANGE
const test = require('node:test'), assert = require('node:assert/strict'), path = require('node:path'), { spawn } = require('node:child_process'); // CHANGE
test('native private admin creation preserves peers and permissions through signed saves', { timeout: 180000 }, async () => { // CHANGE
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; const child = spawn(require('electron'), [path.join(__dirname, 'helpers/module-clusters-production-electron.cjs'), '--creation-regression'], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); let output = ''; // CHANGE
    child.stdout.on('data', data => { output += data; }); child.stderr.on('data', data => { output += data; }); const timeout = setTimeout(() => child.kill(), 170000); // CHANGE
    try { const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); }); assert.equal(code, 0, output); assert.match(output, /Native module creation permissions, placement, saves and rejection passed/); } finally { clearTimeout(timeout); } // CHANGE
}); // CHANGE
