/** Native Chromium editing and the actual desktop export renderer, isolated from the user's profile. */ // NEW
const assert = require('node:assert/strict'); // NEW
const path = require('node:path'); // NEW
const { spawnSync } = require('node:child_process'); // NEW
const test = require('node:test'); // NEW
test('object details reuse the shipped toolbar and render complete rich text in desktop exports', { timeout: 125000 }, () => { // NEW
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; // NEW
    const result = spawnSync(require('electron'), [path.join(__dirname, 'helpers/object-details-electron.cjs')], { env, windowsHide: true, encoding: 'utf8', timeout: 120000 }); // NEW
    assert.equal(result.error, undefined, result.stderr || result.stdout); // NEW
    assert.equal(result.status, 0, result.stderr || result.stdout); assert.match(result.stdout, /OBJECT_DETAILS_RESULT:/); // NEW
}); // NEW

test('extra-info dimensions survive manipulation with the real browser ResizeObserver', { timeout: 95000 }, () => { // NEW
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; // NEW
    const result = spawnSync(require('electron'), [path.join(__dirname, 'helpers/object-details-electron.cjs'), '--size-regression-only'], { env, windowsHide: true, encoding: 'utf8', timeout: 90000 }); // NEW
    assert.equal(result.error, undefined, result.stderr || result.stdout); assert.equal(result.status, 0, result.stderr || result.stdout); // NEW
    assert.match(result.stdout, /EXTRA_INFO_SIZE_PRESERVED:/); assert.match(result.stdout, /OBJECT_DETAILS_SIZE_RESULT:passed/); // NEW
}); // NEW
