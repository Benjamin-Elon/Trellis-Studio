const assert = require('node:assert/strict'); // NEW
const path = require('node:path'); // NEW
const { spawnSync } = require('node:child_process'); // NEW
const test = require('node:test'); // NEW

test('sharing and retained invitation delivery preserve native focus, copy, and small-window layout', { timeout: 60000 }, () => { // NEW
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; // NEW
    const result = spawnSync(require('electron'), [path.join(__dirname, 'helpers/garden-share-focus-electron.cjs')], { env, windowsHide: true, encoding: 'utf8', timeout: 55000 }); // NEW
    assert.equal(result.error, undefined, result.stderr || result.stdout); // NEW
    assert.equal(result.status, 0, result.stderr || result.stdout); // NEW
    assert.match(result.stdout, /INVITE_DELIVERY:passed/); // NEW
}); // NEW
