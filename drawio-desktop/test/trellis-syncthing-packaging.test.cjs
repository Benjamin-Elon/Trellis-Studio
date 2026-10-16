// NEW: Verify resource placement and startup/tray contracts without OS registration.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const vm = require('node:vm'); // NEW
const { fileURLToPath, pathToFileURL } = require('node:url'); // CHANGE: fixtures use valid file URLs on Windows too.
const { Arch } = require('electron-builder');
const packageSyncthing = require('../build/syncthing.cjs');

async function packagingFixture(t, platform, architecture) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'trellis-package-test-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const source = path.join(root, 'vendor/syncthing', platform + '-' + architecture);
    await fs.mkdir(source, { recursive: true });
    const filename = platform === 'win32' ? 'syncthing.exe' : 'syncthing';
    const binary = Buffer.from('isolated packaging fixture');
    const manifest = { version: '2.1.6', platform, arch: architecture, binarySha256: crypto.createHash('sha256').update(binary).digest('hex') };
    await fs.writeFile(path.join(source, filename), binary);
    await fs.writeFile(path.join(source, 'manifest.json'), JSON.stringify(manifest));
    await fs.writeFile(path.join(source, 'LICENSE.txt'), 'Upstream license notice');
    const context = { electronPlatformName: platform, arch: Arch[architecture], appOutDir: path.join(root, 'output'), packager: { projectDir: root, appInfo: { productFilename: 'Trellis' }, platformSpecificBuildOptions: {} } };
    const resources = platform === 'darwin' ? path.join(context.appOutDir, 'Trellis.app/Contents/Resources') : path.join(context.appOutDir, 'resources');
    return { source, filename, binary, context, target: path.join(resources, 'syncthing', platform + '-' + architecture) };
}

for (const platform of ['win32', 'darwin', 'linux']) {
    for (const architecture of ['x64', 'arm64']) {
        test('packages matching ' + platform + '-' + architecture + ' binary and notices outside ASAR', { skip: platform === 'darwin' && process.platform === 'darwin' }, async t => {
            const f = await packagingFixture(t, platform, architecture);
            await packageSyncthing(f.context);
            assert.deepEqual(await fs.readFile(path.join(f.target, f.filename)), f.binary);
            assert.equal(await fs.readFile(path.join(f.target, 'LICENSE.txt'), 'utf8'), 'Upstream license notice');
            assert.equal(JSON.parse(await fs.readFile(path.join(f.target, 'manifest.json'), 'utf8')).arch, architecture);
        });
    }
}

test('packaging rejects missing or modified binaries and does not bundle legacy architectures', async t => {
    const f = await packagingFixture(t, 'win32', 'x64');
    await fs.writeFile(path.join(f.source, f.filename), 'tampered');
    await assert.rejects(packageSyncthing(f.context), /integrity/);
    await fs.rm(path.join(f.source, 'manifest.json'));
    await assert.rejects(packageSyncthing(f.context), /Prepare Syncthing/);
    f.context.arch = Arch.ia32;
    await packageSyncthing(f.context);
    await assert.rejects(fs.access(f.context.appOutDir));
});

test('all release configurations exclude unselected vendor binaries from ASAR', async () => {
    const directory = path.join(__dirname, '..');
    const configurations = (await fs.readdir(directory)).filter(name => /^electron-builder.*\.json$/.test(name));
    for (const name of configurations) {
        const config = JSON.parse(await fs.readFile(path.join(directory, name), 'utf8'));
        assert.ok(config.files.includes('!vendor{,/**}') || config.files.includes('!vendor/syncthing/**'), name); // CHANGE: whole-vendor exclusion also keeps every unselected binary outside ASAR.
    }
});

test('Linux startup uses persistent AppImage path and rejects entry injection', async () => {
    const { getLinuxStartupCommand } = await import('../src/main/trellis-sharing-tray.js');
    const runtime = { execPath: '/tmp/.mount-Trellis/trellis', env: { APPIMAGE: '/home/person/Trellis 100%.AppImage' } };
    assert.equal(getLinuxStartupCommand({ isPackaged: true }, runtime), '"/home/person/Trellis 100%%.AppImage" --trellis-background');
    assert.equal(getLinuxStartupCommand({ isPackaged: false, getAppPath: () => '/work/Trellis' }, runtime), '"/tmp/.mount-Trellis/trellis" "/work/Trellis" --trellis-background');
    assert.throws(() => getLinuxStartupCommand({ isPackaged: true }, { ...runtime, env: { APPIMAGE: '/home/person/evil\nExec=other' } }), /Cannot register/);
});

test('tray Open action never interprets Electron MenuItem as a diagram filename', { skip: process.platform === 'linux' }, async () => {
    const { createSharingTray } = await import('../src/main/trellis-sharing-tray.js');
    let template, tooltip; // CHANGE: verify the tray public name.
    let unsubscribed = false;
    let destroyed = false;
    const opened = [];
    const pause = [];
    class FakeTray extends EventEmitter {
        setToolTip(value) { tooltip = value; } // CHANGE
        setContextMenu(menu) { template = menu; }
        destroy() { destroyed = true; }
    }
    const controller = await createSharingTray({ app: { quit() {} }, Tray: FakeTray, Menu: { buildFromTemplate: items => items }, nativeImage: { createFromPath: () => ({ isEmpty: () => false, resize() { return this; } }) }, iconPath: 'fixture.png', service: { listStatus: () => [{ label: 'Canvas', diagramPath: '/canvas.drawio', state: 'upToDate', connectedCollaborators: 2 }], onStatus: () => () => { unsubscribed = true; }, setPaused: async options => pause.push(options) }, openWindow: filename => opened.push(filename), store: { get: () => false } });
    assert.equal(tooltip, 'Trellis OS sharing'); // CHANGE
    assert.ok(template.some(item => item.label === 'Quit Trellis OS')); // CHANGE
    template.find(item => item.label === 'Open Trellis OS').click({ label: 'MenuItem' }); // CHANGE: Trellis OS branding.
    template.find(item => item.label && item.label.startsWith('Canvas:')).click();
    template.find(item => item.label === 'Pause All Syncing').click();
    assert.deepEqual(opened, [undefined, '/canvas.drawio']);
    assert.deepEqual(pause, [{ paused: true }]);
    controller.dispose();
    assert.equal(unsubscribed, true);
    assert.equal(destroyed, true);
});

test('unsupported sign-in registration is reported without persisting a success flag', { skip: process.platform === 'linux' }, async () => {
    const { setSharingStartup } = await import('../src/main/trellis-sharing-tray.js');
    let persisted = false;
    await assert.rejects(setSharingStartup({ isPackaged: true, setLoginItemSettings() {}, getLoginItemSettings: () => ({ openAtLogin: false }) }, true, { set() { persisted = true; } }), /did not enable/);
    assert.equal(persisted, false);
});

test('a native menu failure disposes the partial tray and its status subscription', { skip: process.platform === 'linux' }, async () => { // NEW
    const { createSharingTray } = await import('../src/main/trellis-sharing-tray.js'); let destroyed = false, unsubscribed = false; // NEW
    class BrokenTray extends EventEmitter { setToolTip() {} setContextMenu() { throw new Error('Menu failed'); } destroy() { destroyed = true; } } // NEW
    await assert.rejects(createSharingTray({ app: {}, Tray: BrokenTray, Menu: { buildFromTemplate: value => value }, nativeImage: { createFromPath: () => ({ isEmpty: () => false, resize() { return this; } }) }, iconPath: 'sample', service: { listStatus: () => [], onStatus: () => () => { unsubscribed = true; } }, openWindow() {}, store: { get: () => false } }), /Menu failed/); // NEW
    assert.equal(destroyed, true); assert.equal(unsubscribed, true); // NEW
}); // NEW

test('Electron file filter allows managed images only and always blocks private files', async () => { // NEW: execute the production callback rather than duplicating its decision logic.
    const source = await fs.readFile(path.join(__dirname, '../src/main/electron.js'), 'utf8');
    const ast = require('@babel/parser').parse(source, { sourceType: 'module' });
    let callback;
    require('@babel/traverse').default(ast, { noScope: true, CallExpression(entry) { const node = entry.node; if (node.callee.type === 'MemberExpression' && node.callee.property.name === 'onBeforeRequest') callback = node.arguments[1]; } });
    assert.ok(callback);
    const calls = [];
    const uri = relative => pathToFileURL(path.join(os.tmpdir(), relative)).href; // NEW
    const filter = vm.runInNewContext(source.slice(callback.start, callback.end), { console: { log() {} }, path, fileURLToPath, app: { getPath: () => os.tmpdir() }, codeUrl: uri('app') + '/', pluginsCodeUrl: uri('plugins') + '/', isPluginsEnabled: () => true, assertSharingFileAccess: async filename => { if (filename.endsWith('secret')) throw new Error('Private'); }, identityTransports: new Map(), sharingService: { isManagedAssetRequest: async (caller, url) => { calls.push([caller, url]); return url.endsWith('managed.png'); } } }); // CHANGE: the production callback now consults identity transports too.
    const check = async (url, type = 'image') => { let result; await filter({ url, resourceType: type, webContentsId: 7 }, value => { result = value; }); return !!result.cancel; };
    assert.equal(await check(uri('shared/managed.png')), false);
    assert.equal(await check(uri('shared/managed.png'), 'script'), true);
    assert.equal(await check(uri('shared/managed.png'), 'xhr'), true);
    assert.equal(await check(uri('outside/other.png')), true);
    assert.equal(await check(uri('plugins/secret')), true);
    assert.equal(await check(uri('app/image.png')), false);
    assert.equal(calls.every(call => call[0] === 7), true);
});
