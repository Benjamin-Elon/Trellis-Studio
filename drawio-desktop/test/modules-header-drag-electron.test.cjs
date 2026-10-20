const assert = require('node:assert/strict'); // NEW
const path = require('node:path'); // NEW
const { spawnSync } = require('node:child_process'); // NEW
const test = require('node:test'); // NEW

/** Run header and handle gestures in Chromium using the production mxGraph handler. */ // NEW
test('native module header drags preserve collapse state and deletion targets', { timeout: 90000 }, () => { // NEW
    const env = { ...process.env }; // NEW
    delete env.ELECTRON_RUN_AS_NODE; // NEW
    const result = spawnSync(require('electron'), [path.join(__dirname, 'helpers/modules-header-drag-electron.cjs')], { env, windowsHide: true, encoding: 'utf8', timeout: 85000 }); // NEW
    const diagnostics = [result.stdout, result.stderr].filter(Boolean).join('\n'); // NEW
    assert.equal(result.error, undefined, diagnostics); // NEW
    assert.equal(result.status, 0, diagnostics); // NEW
    assert.match(result.stdout, /Native module header, handle, and cleanup checks passed/); // NEW
}); // NEW
