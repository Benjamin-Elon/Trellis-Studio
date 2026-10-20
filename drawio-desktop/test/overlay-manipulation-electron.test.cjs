const assert = require('node:assert/strict'); // NEW
const path = require('node:path'); // NEW
const { spawnSync } = require('node:child_process'); // NEW
const test = require('node:test'); // NEW

test('Chromium overlays stop intercepting drops and restore without losing drafts', { timeout: 90000 }, () => { // NEW
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; // NEW
    const result = spawnSync(require('electron'), [path.join(__dirname, 'helpers/overlay-manipulation-electron.cjs')], { env, windowsHide: true, encoding: 'utf8', timeout: 85000 }); // NEW
    assert.equal(result.error, undefined, result.stderr || result.stdout); // NEW
    assert.equal(result.status, 0, result.stderr || result.stdout); // NEW
    assert.match(result.stdout, /Chromium overlay visibility.*restoration checks passed/); // NEW
}); // NEW
