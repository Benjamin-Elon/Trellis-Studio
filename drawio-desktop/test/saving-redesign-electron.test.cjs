/** Real editor regression for the reported bed-then-Dill trigger, using private identities and files. */ // NEW
const test = require('node:test'), assert = require('node:assert/strict'), path = require('node:path'), { spawn } = require('node:child_process'); // NEW
test('bed then Dill stays stable during pointer input in protocol 5', { timeout: 610000 }, async () => { // CHANGE
    const env = { ...process.env, TRELLIS_REDESIGN_PROTOCOL: '5' }; delete env.ELECTRON_RUN_AS_NODE; delete env.TRELLIS_REDESIGN_INCIDENT; // CHANGE: permanent tests do not depend on private incident data.
    const child = spawn(require('electron'), [path.join(__dirname, 'helpers/module-clusters-production-electron.cjs'), '--saving-redesign'], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); let output = ''; // NEW
    const capture = data => { output = (output + data).slice(-1024 * 1024); console.log(String(data).trim()); }; child.stdout.on('data', capture); child.stderr.on('data', capture); // NEW
    const timer = setTimeout(() => child.kill(), 600000); // NEW
    try { const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); }); assert.equal(code, 0, output); assert.match(output, /"mutations":0,"stable":true/); assert.match(output, /"rejections":\[\]/); } finally { clearTimeout(timer); } // NEW
}); // NEW
