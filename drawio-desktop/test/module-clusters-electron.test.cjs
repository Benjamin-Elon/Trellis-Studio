const assert = require('node:assert/strict'); // NEW
const path = require('node:path'); // NEW
const { spawnSync } = require('node:child_process'); // NEW
const test = require('node:test'); // NEW

/** Exercise the production plugins and native renderer in an isolated Chromium session. */ // NEW
test('module clusters bound expansion, city rendering, neighborhoods and complete saves', { timeout: 180000 }, () => { // NEW
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; // NEW
    const result = spawnSync(require('electron'), [path.join(__dirname, 'helpers/module-clusters-electron.cjs')], { env, windowsHide: true, encoding: 'utf8', timeout: 175000 }); // NEW
    const diagnostics = [result.stdout, result.stderr].filter(Boolean).join('\n'); // NEW
    assert.equal(result.error, undefined, diagnostics); assert.equal(result.status, 0, diagnostics); // NEW
    assert.match(result.stdout, /Nearest neighborhoods, overlap, city limits, stable panning and complete saves passed/); // NEW
}); // NEW
