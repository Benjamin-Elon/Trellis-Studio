/** A failed production-strength renderer startup is not a skipped security check. */ // NEW
const test = require('node:test'), assert = require('node:assert/strict'), path = require('node:path'), { spawnSync } = require('node:child_process'); // NEW
test('shipped runtime blocks document requests with sandbox and context isolation enabled', { timeout: 65000 }, () => { // NEW
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; // NEW
    const result = spawnSync(require('electron'), [path.join(__dirname, 'helpers/content-security-electron.cjs')], { env, windowsHide: true, encoding: 'utf8', timeout: 60000 }); // NEW
    assert.equal(result.error, undefined, result.stdout + '\n' + result.stderr); assert.equal(result.status, 0, result.stdout + '\n' + result.stderr); assert.match(result.stdout, /"ok":true/); // NEW
}); // NEW


test('production main export renders safe images without changing embedded source', { timeout: 65000 }, () => { // NEW
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; // NEW
    const result = spawnSync(require('electron'), [path.join(__dirname, 'helpers/content-security-export-electron.cjs')], { env, windowsHide: true, encoding: 'utf8', timeout: 60000 }); // NEW
    assert.equal(result.error, undefined, result.stdout + '\n' + result.stderr); assert.equal(result.status, 0, result.stdout + '\n' + result.stderr); assert.match(result.stdout, /"productionExport":true/); // NEW
}); // NEW
