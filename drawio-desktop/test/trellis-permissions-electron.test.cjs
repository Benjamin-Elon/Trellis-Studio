/** Native permission regressions run in an isolated test-owned Electron process. */ // NEW
const test = require('node:test'), assert = require('node:assert/strict'), path = require('node:path'), { spawn } = require('node:child_process'); // NEW
test('native graph guards, signed saves and conflict resolution enforce current permissions and retain drafts', { timeout: 60000 }, async () => { // NEW
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; // NEW
    const child = spawn(require('electron'), [path.join(__dirname, 'helpers/trellis-permissions-electron.cjs')], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); // NEW
    let output = ''; child.stdout.on('data', value => { output += value; }); child.stderr.on('data', value => { output += value; }); // NEW
    const timer = setTimeout(() => child.kill(), 50000); // NEW
    try { const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); }); assert.equal(code, 0, output); assert.match(output, /"ok":true/); } finally { clearTimeout(timer); } // NEW
}); // NEW
