const assert = require('node:assert/strict'); // NEW
const path = require('node:path'); // NEW
const { spawnSync } = require('node:child_process'); // NEW
const test = require('node:test'); // NEW
test('Chromium structure focus, toggles, history, handles and portable rendering', { timeout: 125000 }, () => { // CHANGE: native focus and history scenarios extend the interaction smoke.
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; // NEW
    const result = spawnSync(require('electron'), [path.join(__dirname, 'helpers/garden-structures-electron.cjs')], { env, windowsHide: true, encoding: 'utf8', timeout: 120000 }); // CHANGE
    assert.equal(result.error, undefined, result.stderr || result.stdout); assert.equal(result.status, 0, result.stderr || result.stdout); // NEW
    assert.match(result.stdout, /Chromium structures:.*SVG\/PDF projections passed/); // NEW
}); // NEW
