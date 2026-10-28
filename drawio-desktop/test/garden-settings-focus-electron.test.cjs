const assert = require('node:assert/strict'); // NEW
const path = require('node:path'); // NEW
const { spawnSync } = require('node:child_process'); // NEW
const test = require('node:test'); // NEW
// NEW: exercise the real main process, preload, editor and companion plugins in one isolated profile.
test('garden creation settings retain native input through companion initialization and city loading', { timeout: 150000 }, () => { // NEW
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; // NEW
    const result = spawnSync(require('electron'), [path.join(__dirname, 'helpers/garden-settings-focus-electron.cjs')], { env, windowsHide: true, encoding: 'utf8', timeout: 145000 }); // NEW
    const diagnostics = [result.stdout, result.stderr].filter(Boolean).join('\n'); // CHANGE: stderr must not hide the renderer state captured on stdout.
    assert.equal(result.error, undefined, diagnostics); // CHANGE
    assert.equal(result.status, 0, diagnostics); // CHANGE
    assert.match(result.stdout, /GARDEN_SETTINGS_FOCUS:passed/); // NEW
}); // NEW
