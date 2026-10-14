/** Run the Guide against real Chromium dialogs and mxGraph undo/serialization. */ // CHANGE
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

test('Task Guide renders on desktop and narrow viewports and preserves real undo and save/reopen', { timeout: 125000 }, () => {
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    const result = spawnSync(require('electron'), [path.join(__dirname, 'helpers/garden-guide-electron.cjs')], { env, windowsHide: true, encoding: 'utf8', timeout: 120000 });
    assert.equal(result.error, undefined, result.stderr || result.stdout);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /GUIDE_RESULT:/);
});
