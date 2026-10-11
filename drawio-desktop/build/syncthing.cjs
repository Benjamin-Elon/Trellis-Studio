// NEW: Add only the matching checked binary and license notices to packaged resources.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { Arch } = require('electron-builder');
module.exports = async function packageSyncthing(context) {
    const platform = context.electronPlatformName;
    const arch = Arch[context.arch];
    const resources = platform === 'darwin' ? path.join(context.appOutDir, context.packager.appInfo.productFilename + '.app', 'Contents', 'Resources') : path.join(context.appOutDir, 'resources');
    const target = path.join(resources, 'syncthing', platform + '-' + arch);
    if (!['x64', 'arm64'].includes(arch)) return; // NEW: legacy targets deliberately report unavailable at runtime.
    const source = path.join(context.packager.projectDir, 'vendor', 'syncthing', platform + '-' + arch);
    let manifest;
    try { manifest = JSON.parse(await fs.readFile(path.join(source, 'manifest.json'), 'utf8')); }
    catch (_) { throw new Error(`Prepare Syncthing before packaging: npm run syncthing:prepare -- ${platform} ${arch}`); }
    const filename = platform === 'win32' ? 'syncthing.exe' : 'syncthing';
    const binary = await fs.readFile(path.join(source, filename));
    const digest = crypto.createHash('sha256').update(binary).digest('hex');
    if (manifest.version !== '2.1.6' || manifest.platform !== platform || manifest.arch !== arch || digest !== manifest.binarySha256) throw new Error('Syncthing bundle integrity check failed.');
    await fs.mkdir(target, { recursive: true });
    for (const name of await fs.readdir(source)) await fs.copyFile(path.join(source, name), path.join(target, name));
    if (platform !== 'win32') await fs.chmod(path.join(target, filename), 0o755);
    if (platform === 'darwin' && process.platform === 'darwin') { // NEW: pin program contents across release code signing.
        const { unsignedMacHash } = await import('../src/main/trellis-binary-integrity.js');
        manifest.unsignedMacSha256 = await unsignedMacHash(path.join(target, filename));
        await fs.writeFile(path.join(target, 'manifest.json'), JSON.stringify(manifest, null, 2));
        const signing = context.packager.platformSpecificBuildOptions;
        signing.binaries = [...(signing.binaries || []), path.join(target, filename)];
    }
};
