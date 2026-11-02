/** Shipped runtime and plugins run in a hidden native window with isolated, controlled IPC. */ // CHANGE
const test = require('node:test'), assert = require('node:assert/strict'), path = require('node:path'), { spawn } = require('node:child_process'); // CHANGE
test('native editor transitions and planting rejection are recoverable', { timeout: 180000 }, async () => { // CHANGE
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; // CHANGE
    const child = spawn(require('electron'), [path.join(__dirname, 'helpers/editing-lifecycle-electron.cjs')], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); let output = ''; // CHANGE
    console.log('Editing regression process', child.pid); child.stdout.on('data', data => { output += data; process.stdout.write(data); }); child.stderr.on('data', data => { output += data; }); const timer = setTimeout(() => child.kill(), 170000); // CHANGE
    try { const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); }); assert.equal(code, 0, output); assert.match(output, /Native editing lifecycle, planting rejection and retry passed/); } finally { clearTimeout(timer); } // CHANGE
}); // CHANGE
