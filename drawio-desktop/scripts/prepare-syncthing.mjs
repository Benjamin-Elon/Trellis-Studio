// NEW: Fetch pinned upstream distributions, verify archives, and stage binaries outside ASAR.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { SYNCTHING_VERSION } from '../src/main/trellis-share-protocol.js';

const run = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const platforms = { win32: 'windows', darwin: 'macos', linux: 'linux' };
const architectures = { x64: 'amd64', arm64: 'arm64' };
const base = `https://github.com/syncthing/syncthing/releases/download/v${SYNCTHING_VERSION}/`;
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
async function download(name) {
    const response = await fetch(base + name, { signal: AbortSignal.timeout(120000) });
    if (!response.ok) throw new Error(`Download failed for ${name}: ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
}
const args = process.argv.slice(2);
const targets = args.includes('--all') ? Object.keys(platforms).flatMap(platform => Object.keys(architectures).map(arch => [platform, arch])) : [[args[0] || process.platform, args[1] || process.arch]];
const checksumBytes = await download('sha256sum.txt.asc'); // CHANGE: upstream publishes a clearsigned checksum list.
if (hash(checksumBytes) !== '1a4199996799db57d80f45f581de0d2b0d2cd5e248217e37a132d61a5f22c8aa') throw new Error('Pinned upstream checksum list changed.');
const sums = new Map(checksumBytes.toString().split(/\r?\n/).map(line => /^([a-f0-9]{64})\s+\*?(.+)$/.exec(line)).filter(Boolean).map(match => [match[2], match[1]]));
for (const [platform, arch] of targets) {
    if (!platforms[platform] || !architectures[arch]) throw new Error(`Unsupported target: ${platform}-${arch}`);
    const stem = `syncthing-${platforms[platform]}-${architectures[arch]}-v${SYNCTHING_VERSION}`;
    const archiveName = stem + (platform === 'linux' ? '.tar.gz' : '.zip'); // CHANGE: macOS distributions also use ZIP.
    const archive = await download(archiveName);
    if (hash(archive) !== sums.get(archiveName)) throw new Error(`Checksum mismatch: ${archiveName}`);
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'trellis-syncthing-'));
    try {
        const archivePath = path.join(temporary, archiveName);
        await fs.writeFile(archivePath, archive);
        const unpacked = path.join(temporary, 'unpacked');
        await fs.mkdir(unpacked);
        // tar on supported Windows versions also extracts ZIP archives; no shell interpolation.
        await run('tar', ['-xf', archivePath, '-C', unpacked]);
        const extracted = path.join(unpacked, stem);
        const destination = path.join(root, 'vendor', 'syncthing', platform + '-' + arch);
        await fs.mkdir(destination, { recursive: true });
        const binaryName = platform === 'win32' ? 'syncthing.exe' : 'syncthing';
        const binary = await fs.readFile(path.join(extracted, binaryName));
        await fs.writeFile(path.join(destination, binaryName), binary, { mode: 0o755 });
        for (const name of await fs.readdir(extracted)) if (/^(LICENSE|AUTHORS|README)/i.test(name)) await fs.copyFile(path.join(extracted, name), path.join(destination, name));
        await fs.writeFile(path.join(destination, 'manifest.json'), JSON.stringify({ version: SYNCTHING_VERSION, platform, arch, archiveName, archiveSha256: hash(archive), binarySha256: hash(binary) }, null, 2));
        console.log(`Verified and staged Syncthing ${SYNCTHING_VERSION}: ${platform}-${arch}`);
    } finally { await fs.rm(temporary, { recursive: true, force: true }); }
}
