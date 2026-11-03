/** Real Chromium decoding/playback complements controlled lifecycle tests. */ // NEW
const test = require('node:test'); // NEW
const assert = require('node:assert/strict'); // NEW
const path = require('node:path'); // NEW
const { spawnSync } = require('node:child_process'); // NEW
test('bundled narration plays the short prompt, planning prompt, and oath with networking disabled', { timeout: 110000 }, () => { // NEW
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; // NEW
    const result = spawnSync(require('electron'), [path.join(__dirname, 'helpers/narration-electron.cjs')], { env, windowsHide: true, encoding: 'utf8', timeout: 105000 }); // NEW
    const diagnostics = [result.stdout, result.stderr].filter(Boolean).join('\n'); // NEW
    assert.equal(result.error, undefined, diagnostics); assert.equal(result.status, 0, diagnostics); assert.match(result.stdout, /Offline narration checks passed/); // NEW
}); // NEW
