const assert = require('node:assert/strict'); // NEW
const path = require('node:path'); // NEW
const { spawnSync } = require('node:child_process'); // NEW
const test = require('node:test'); // NEW
test('Chromium structure focus, history, handles, side lengths, view options, rotated path snapping and portable rendering', { timeout: 155000 }, () => { // CHANGE: allow the additional native dropdown, measurement and print-media scenarios.
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; // NEW
    const result = spawnSync(require('electron'), [path.join(__dirname, 'helpers/garden-structures-electron.cjs')], { env, windowsHide: true, encoding: 'utf8', timeout: 150000 }); // CHANGE
    assert.equal(result.error, undefined, result.stderr || result.stdout); assert.equal(result.status, 0, result.stderr || result.stdout); // NEW
    assert.match(result.stdout, /Chromium structures:.*SVG\/PDF projections passed/); // NEW
}); // NEW
