/** Production loading feedback, cancellation, page measurement and managed readiness. */ // NEW
const test = require('node:test'), assert = require('node:assert/strict'), path = require('node:path'); // NEW
const { spawn } = require('node:child_process'); // NEW
test('garden loading card follows the production opening lifecycle', { timeout: 195000 }, async () => { // NEW
    const env = { ...process.env, TRELLIS_GARDEN_LOADING_TEST: '1' }; delete env.ELECTRON_RUN_AS_NODE; // NEW
    const child = spawn(process.execPath, [path.join(__dirname, '../scripts/run-production-smoke.cjs')], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); // NEW
    let output = ''; child.stdout.on('data', data => { output += data; }); child.stderr.on('data', data => { output += data; }); // NEW
    const deadline = setTimeout(() => child.kill(), 180000); // NEW
    try { const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); }); assert.equal(code, 0, output); assert.match(output, /GARDEN_LOADING_RESULT:passed/); } finally { clearTimeout(deadline); } // NEW
}); // NEW
