/** Real hidden Chromium coverage complements pure accounting and authenticated-service tests. */ // NEW
const assert = require('node:assert/strict'); // NEW
const path = require('node:path'); // NEW
const { spawnSync } = require('node:child_process'); // NEW
const test = require('node:test'); // NEW
test('desktop inventories preserve drafts and keyboard focus across editor and Home access', { timeout: 125000 }, () => { // NEW
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; // NEW
    const result = spawnSync(require('electron'), [path.join(__dirname, 'helpers/inventories-electron.cjs')], { env, windowsHide: true, encoding: 'utf8', timeout: 120000 }); // NEW
    assert.equal(result.error, undefined, result.stderr || result.stdout); assert.equal(result.status, 0, result.stderr || result.stdout); assert.match(result.stdout, /INVENTORIES_RESULT:/); // NEW
}); // NEW
