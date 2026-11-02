const test = require('node:test'), assert = require('node:assert/strict'), path = require('node:path'), { spawnSync } = require('node:child_process'); // CHANGE
test('native pointer drags keep plant circles inside their owning group', { timeout: 125000 }, () => { // CHANGE
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; // CHANGE
    const result = spawnSync(require('electron'), [path.join(__dirname, 'helpers/planting-circle-containment-electron.cjs')], { env, windowsHide: true, encoding: 'utf8', timeout: 120000 }); // CHANGE
    assert.equal(result.error, undefined, result.stderr || result.stdout); assert.equal(result.status, 0, result.stderr || result.stdout); assert.match(result.stdout, /CIRCLE_CONTAINMENT_RESULT:/); // CHANGE
    assert.match(result.stdout, /CIRCLE_PREVIEW_RESULT:/); // CHANGE
}); // CHANGE
