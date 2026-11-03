const assert = require('node:assert/strict'); // NEW
const path = require('node:path'); // NEW
const { spawnSync } = require('node:child_process'); // NEW
const test = require('node:test'); // NEW

/** Exercise actual Chromium input independently of unrelated main-process startup code. */ // NEW
test('native Quickstart companions drag, follow dialogs, cancel before picker Escape, and preserve graph state', { timeout: 95000 }, () => { // CHANGE
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; // NEW
    const result = spawnSync(require('electron'), [path.join(__dirname, 'helpers/quickstart-drag-electron.cjs')], { env, windowsHide: true, encoding: 'utf8', timeout: 90000 }); // CHANGE: bound the expanded native gesture and screenshot scenarios on busy Windows hosts.
    const diagnostics = [result.stdout, result.stderr].filter(Boolean).join('\n'); // NEW
    assert.equal(result.error, undefined, diagnostics); assert.equal(result.status, 0, diagnostics); // NEW
    assert.match(result.stdout, /Native Quickstart drag checks passed/); // NEW
}); // NEW
