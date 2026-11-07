/** Run native overlay checks in an isolated Electron profile. // NEW */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawn } = require('node:child_process');
/** Run the same painted-layout checks with either plugin installed first. */ // NEW
async function checkStackedAttribution(order) { // NEW
    const env = { ...process.env, TRELLIS_TEST_OVERLAY_ORDER: order }; delete env.ELECTRON_RUN_AS_NODE; // CHANGE
    const child = spawn(require('electron'), [path.join(__dirname, 'helpers/object-attribution-electron.cjs')], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = ''; child.stdout.on('data', data => { output += data; }); child.stderr.on('data', data => { output += data; });
    const timeout = setTimeout(() => child.kill(), 115000); // CHANGE: allow the expanded layout scenarios to complete on slower Chromium runs.
    try { const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); }); assert.equal(code, 0, output); assert.match(output, /Native object attribution checks passed/); } finally { clearTimeout(timeout); }
} // NEW
for (const order of ['attribution-first', 'dimensions-first']) { // NEW: exercise both listener and plugin initialization orders.
    test('native stacked attribution follows hover/selection without modifying the diagram (' + order + ')', { timeout: 120000 }, () => checkStackedAttribution(order)); // CHANGE
} // NEW
