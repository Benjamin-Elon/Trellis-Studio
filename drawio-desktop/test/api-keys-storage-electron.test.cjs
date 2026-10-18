// NEW: Two Electron processes must decrypt the same isolated synthetic profile entry.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
test('profile API key OS encryption survives a fresh Electron process', { timeout: 45000 }, async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'trellis-api-key-storage-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    for (const mode of ['write', 'read']) {
        const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
        const result = await new Promise((resolve, reject) => {
            const child = spawn(require('electron'), [path.join(__dirname, 'helpers/api-keys-storage-electron.cjs'), mode, root], { env, windowsHide: true });
            let output = '';
            child.stdout.on('data', data => { output += data; }); child.stderr.on('data', data => { output += data; });
            child.once('error', reject); child.once('exit', code => resolve({ code, output }));
        });
        assert.equal(result.code, 0, result.output);
        assert.match(result.output, /OS encrypted profile key verified/);
    }
});
