/** Full application regression in a disposable profile; use the established production fixture and cleanup. */ // NEW
const test = require('node:test'), assert = require('node:assert/strict'), path = require('node:path'); // NEW
const { spawn } = require('node:child_process'); // NEW
test('private projects initialize on first opening, recover without duplicates and retain history after reopening', { timeout: 195000 }, async () => { // NEW
    const env = { ...process.env, TRELLIS_FIRST_OPEN_TEST: '1' }; delete env.ELECTRON_RUN_AS_NODE; // NEW
    const child = spawn(process.execPath, [path.join(__dirname, '../scripts/run-production-smoke.cjs')], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); // NEW
    let output = ''; child.stdout.on('data', data => { output += data; }); child.stderr.on('data', data => { output += data; }); // NEW
    const deadline = setTimeout(() => child.kill(), 180000); // NEW: the existing production runner performs owned process-tree cleanup before this outer bound.
    try { const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); }); assert.equal(code, 0, output); assert.match(output, /FIRST_OPEN_PROJECT_RESULT:passed/); } finally { clearTimeout(deadline); } // NEW
}); // NEW
