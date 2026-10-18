const assert = require('node:assert/strict'); // CHANGE
const path = require('node:path'); // CHANGE
const { spawnSync } = require('node:child_process'); // CHANGE
const test = require('node:test'); // CHANGE

test('Allocate and spacing stay visibly aligned in the real Electron mxGraph renderer', { timeout: 125000 }, () => { // CHANGE: allow the expanded real-plugin fixture to run on busy Windows hosts.
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; // CHANGE
    const result = spawnSync(require('electron'), [path.join(__dirname, 'helpers/planting-preview-electron.cjs')], { env, windowsHide: true, encoding: 'utf8', timeout: 120000 }); // CHANGE
    assert.equal(result.error, undefined, result.stderr || result.stdout); // CHANGE: retain renderer diagnostics if process startup or execution fails.
    assert.equal(result.status, 0, result.stderr || result.stdout); // CHANGE
    assert.match(result.stdout, /PREVIEW_RESULT:/); // CHANGE
    const marker = result.stdout.match(/^PREVIEW_RESULT:(.+)\r?$/m); // CHANGE: successful termination must preserve the complete result line.
    assert.ok(marker, result.stderr || result.stdout); // CHANGE
    assert.doesNotThrow(() => JSON.parse(marker[1]), 'Preview result JSON must not be truncated'); // CHANGE
}); // CHANGE
