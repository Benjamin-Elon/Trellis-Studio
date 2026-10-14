/** Build a pinned native Syncthing engine with verified Go and Android toolchains. // NEW */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cache = path.join(root, '.tool-cache');
const version = '2.1.6';
await fs.mkdir(cache, { recursive: true });
const exists = async file => fs.access(file).then(() => true, () => false);
async function fetchBytes(url) { const response = await fetch(url, { signal: AbortSignal.timeout(300000) }); if (!response.ok) throw new Error('Download failed: ' + response.status + ' ' + url); return Buffer.from(await response.arrayBuffer()); }
function run(command, args, options = {}) { return new Promise((resolve, reject) => { const child = spawn(command, args, { windowsHide: true, stdio: 'inherit', ...options }); child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(new Error(command + ' exited ' + code))); }); }
const platform = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'darwin' : 'linux';
const arch = process.arch === 'arm64' ? 'arm64' : 'amd64';
const toolchainCache = path.join(cache, 'go1.26.2-' + platform + '-' + arch); // CHANGE: never overlay two Go distributions with incompatible source files.
const goRoot = path.join(toolchainCache, 'go'); // CHANGE
const go = path.join(goRoot, 'bin', process.platform === 'win32' ? 'go.exe' : 'go');
if (!await exists(go) || !(await fs.readFile(path.join(goRoot, 'VERSION'), 'utf8')).startsWith('go1.26.2')) { // CHANGE: cached earlier toolchains do not silently bypass the pinned version.
    const releases = JSON.parse((await fetchBytes('https://go.dev/dl/?mode=json&include=all')).toString());
    const release = releases.find(item => item.version === 'go1.26.2'); // CHANGE: match the pinned Syncthing source's declared minimum.
    const file = release?.files.find(item => item.os === platform && item.arch === arch && item.kind === 'archive');
    if (!file) throw new Error('Pinned Go toolchain is unavailable.');
    const bytes = await fetchBytes('https://go.dev/dl/' + file.filename);
    if (crypto.createHash('sha256').update(bytes).digest('hex') !== file.sha256) throw new Error('Go toolchain checksum mismatch.');
    const archive = path.join(cache, file.filename); await fs.writeFile(archive, bytes);
    await fs.mkdir(toolchainCache, { recursive: true }); // CHANGE
    await run('tar', ['-xf', archive, '-C', toolchainCache]); // CHANGE
}
const sourceRoot = path.join(cache, 'syncthing-' + version);
if (!await exists(path.join(sourceRoot, 'go.mod'))) {
    const zip = path.join(cache, 'syncthing-source.zip');
    const source = await fetchBytes('https://codeload.github.com/syncthing/syncthing/zip/refs/tags/v' + version); // CHANGE: Syncthing uses application v2 tags with an unversioned Go module path.
    if (crypto.createHash('sha256').update(source).digest('hex') !== '5b234479956cc9a66f3b4252c81b477281b8e438f0c20371154bb6cd6e2b4798') throw new Error('Pinned Syncthing source archive changed.'); // CHANGE: verify independently inspected source bytes.
    await fs.writeFile(zip, source); // CHANGE
    await run('tar', ['-xf', zip, '-C', cache]);
    // GitHub's archive already expands to syncthing-<version>. // CHANGE
}
const targets = [{ goarch: 'arm64', abi: 'arm64-v8a' }]; // CHANGE: physical-device APK targets 64-bit ARM; x86 emulators need a separate NDK cross-link build.
for (const target of targets) {
    const destination = path.join(root, 'android', 'app', 'src', 'main', 'jniLibs', target.abi); await fs.mkdir(destination, { recursive: true });
    const output = path.join(destination, 'libsyncthing.so');
    if (await exists(output)) continue;
    const env = { ...process.env, GOOS: 'android', GOARCH: target.goarch, CGO_ENABLED: '0', GOCACHE: path.join(cache, 'go-build'), GOMODCACHE: path.join(cache, 'go-mod'), GOTOOLCHAIN: 'local' };
    await run(go, ['build', '-trimpath', '-buildmode=pie', '-tags', 'netgo,osusergo,noupgrade,noassets', '-ldflags', '-s -w -checklinkname=0 -X github.com/syncthing/syncthing/lib/build.Version=v' + version, '-o', output, './cmd/syncthing'], { cwd: sourceRoot, env }); // CHANGE: Android interface enumeration's pinned anet dependency documents this linker flag: https://github.com/wlynxg/anet.
    console.log('Built Android engine:', target.abi);
}
await fs.copyFile(path.join(sourceRoot, 'LICENSE'), path.join(root, 'www', 'SYNCTHING-LICENSE.txt'));
