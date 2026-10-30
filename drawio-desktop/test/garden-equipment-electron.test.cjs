/** Exercise production equipment and task controls in real hidden Chromium. */ // NEW
const assert = require('node:assert/strict'); // NEW
const path = require('node:path'); // NEW
const { spawnSync } = require('node:child_process'); // NEW
const test = require('node:test'); // NEW

test('equipment planning renders compactly and keyboard tool selection persists in the real task overlay', { timeout: 125000 }, () => { // NEW
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; // NEW
    const result = spawnSync(require('electron'), [path.join(__dirname, 'helpers/garden-equipment-electron.cjs')], { env, windowsHide: true, encoding: 'utf8', timeout: 120000 }); // NEW
    assert.equal(result.error, undefined, result.stderr || result.stdout); // NEW
    assert.equal(result.status, 0, result.stderr || result.stdout); // NEW
    assert.match(result.stdout, /EQUIPMENT_RESULT:/); // NEW
}); // NEW
