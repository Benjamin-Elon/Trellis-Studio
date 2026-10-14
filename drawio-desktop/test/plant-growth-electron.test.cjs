const assert = require('node:assert/strict'); // NEW
const path = require('node:path'); // NEW
const { spawnSync } = require('node:child_process'); // NEW
const test = require('node:test'); // NEW

test('growth circles, badges and dashboard checkbox work in the real Chromium renderer', { timeout: 125000 }, () => { // NEW
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; // NEW
    const result = spawnSync(require('electron'), [path.join(__dirname, 'helpers/plant-growth-electron.cjs')], { env, windowsHide: true, encoding: 'utf8', timeout: 120000 }); // NEW
    assert.equal(result.error, undefined, result.stderr || result.stdout); // NEW
    assert.equal(result.status, 0, result.stderr || result.stdout); // NEW
    assert.match(result.stdout, /GROWTH_RESULT:/); // NEW
    process.stdout.write(result.stdout.match(/GROWTH_RESULT:[^\n]*/)[0] + '\n'); // NEW: preserve the Chromium diagnostic summary in the test report.
}); // NEW
