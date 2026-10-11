// NEW: macOS signing changes signature bytes, but must not change the verified program.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** Use Apple's own signature removal on a disposable copy, never mutate the shipped executable. */
export async function unsignedMacHash(filename) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'trellis-binary-check-'));
    const copy = path.join(directory, 'syncthing');
    try {
        await fs.copyFile(filename, copy);
        await fs.chmod(copy, 0o700);
        try { await run('/usr/bin/codesign', ['--remove-signature', copy], { timeout: 10000 }); }
        catch (err) { if (!/not signed at all/i.test(err.stderr || '')) throw err; }
        return crypto.createHash('sha256').update(await fs.readFile(copy)).digest('hex');
    } finally { await fs.rm(directory, { recursive: true, force: true }); }
}

export async function verifyMacResigning(filename, manifest) {
    if (!manifest.unsignedMacSha256) return false;
    try {
        await run('/usr/bin/codesign', ['--verify', '--strict', filename], { timeout: 10000 });
        return await unsignedMacHash(filename) === manifest.unsignedMacSha256;
    } catch (_) { return false; }
}
