const assert = require('node:assert/strict'); // CHANGE
const path = require('node:path'); // CHANGE
const { spawnSync } = require('node:child_process'); // CHANGE
const test = require('node:test'); // CHANGE

/** Exercise the real Chromium renderer for bed preview omission, commit, and diagram history. */ // CHANGE
test('Electron bed previews omit circles and restore upright labels on rotation commit', { timeout: 125000 }, () => { // CHANGE
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; // CHANGE
    const result = spawnSync(require('electron'), [path.join(__dirname, 'helpers/bed-transform-preview-electron.cjs')], { env, windowsHide: true, encoding: 'utf8', timeout: 120000 }); // CHANGE
    assert.equal(result.error, undefined, result.stderr || result.stdout); // CHANGE
    assert.equal(result.status, 0, result.stderr || result.stdout); // CHANGE
    assert.match(result.stdout, /Chromium preview\/commit and drag checks passed/); // CHANGE
}); // CHANGE
