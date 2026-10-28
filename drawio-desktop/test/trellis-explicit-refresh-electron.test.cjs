/** Exercise the shipped renderer and native patcher against the actual signed journal. */ // NEW
const test = require('node:test'), assert = require('node:assert/strict'), path = require('node:path');
const { spawnSync } = require('node:child_process');
test('native explicit refresh preserves unseen content, scopes patches, and rolls back failed checkpoints', { timeout: 100000 }, () => {
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    const result = spawnSync(require('electron'), [path.join(__dirname, 'helpers/explicit-refresh-electron.cjs')], { env, windowsHide: true, encoding: 'utf8', timeout: 95000 });
    assert.equal(result.error, undefined, result.stderr); assert.equal(result.status, 0, result.stdout + '\n' + result.stderr);
    assert.match(result.stdout, /"ok":true/);
});
