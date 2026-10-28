require('../../src/main/trellis-asset-scheme.cjs'); // NEW: production protocol privileges must precede app readiness.
/** Shipped bundle, production CSP/filter, and production renderer isolation. */ // NEW
const { app, BrowserWindow, session, protocol } = require('electron'); // NEW
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), http = require('node:http'), vm = require('node:vm'), assert = require('node:assert/strict'); // NEW
const { pathToFileURL, fileURLToPath } = require('node:url'); // NEW
const project = path.resolve(__dirname, '../..'), webapp = path.join(project, 'drawio/src/main/webapp'), directory = fs.mkdtempSync(path.join(os.tmpdir(), 'trellis-content-native-')); // NEW
app.setPath('userData', path.join(directory, 'profile')); app.disableHardwareAcceleration(); app.commandLine.appendSwitch('in-process-gpu'); // NEW
let win, other, server; const requests = []; // NEW
app.whenReady().then(async () => { // NEW
    const watchdog = setTimeout(() => { console.error('Security fixture timed out'); app.exit(1); }, 55000); // NEW
    try { // NEW
        const { createAssetBroker } = await import(pathToFileURL(path.join(project, 'src/main/trellis-asset-policy.js'))); // NEW
        const { assertSharingFileAccess } = await import(pathToFileURL(path.join(project, 'src/main/trellis-sharing-files.js'))); // NEW
        const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aR2kAAAAASUVORK5CYII=', 'base64'); // NEW
        const broker = createAssetBroker({ currentContext: id => win && id === win.webContents.id ? 'native-garden' : null, readImage: async () => ({ bytes: png, mime: 'image/png' }) }); // NEW
        protocol.handle('trellis-asset', request => broker.response(request)); // NEW
        const main = fs.readFileSync(path.join(project, 'src/main/electron.js'), 'utf8'), ast = require('@babel/parser').parse(main, { sourceType: 'module' }); let requestCallback; // NEW
        require('@babel/traverse').default(ast, { noScope: true, CallExpression({ node }) { if (node.callee.type === 'MemberExpression' && node.callee.property.name === 'onBeforeRequest') requestCallback = node.arguments[1]; } }); // NEW
        const anchor = "'Content-Security-Policy': [", start = main.indexOf(anchor) + anchor.length, csp = vm.runInNewContext(main.slice(start, main.indexOf(']', start)), {}); // NEW
        session.defaultSession.webRequest.onHeadersReceived((_details, callback) => callback({ responseHeaders: { 'Content-Security-Policy': [csp] } })); // NEW
        const filter = vm.runInNewContext(main.slice(requestCallback.start, requestCallback.end), { app, path, fileURLToPath, assertSharingFileAccess, codeUrl: pathToFileURL(webapp).href + '/', pluginsCodeUrl: pathToFileURL(directory).href + '/', isPluginsEnabled: () => true, assetBroker: broker, console }); // NEW
        session.defaultSession.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, filter); // NEW
        server = http.createServer((request, response) => { requests.push(request.url); response.end('unexpected network request'); }); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); // NEW
        const fixture = path.join(directory, 'fixture.html'); fs.writeFileSync(fixture, '<!doctype html><body><img src="http://127.0.0.1:' + server.address().port + '/initial-load"><div id="graph"></div></body>'); // NEW
        win = new BrowserWindow({ show: false, width: 800, height: 600, webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true } }); // NEW
        await win.loadFile(fixture); const run = code => win.webContents.executeJavaScript(code); // NEW
        await run('window.mxLoadResources=false;window.mxLoadStylesheets=false;window.urlParams={};'); // NEW
        for (const file of ['js/trellis-content-policy.js', 'js/app.min.js', 'js/trellis-content-install.js']) await run(fs.readFileSync(path.join(webapp, file), 'utf8') + '\n;void 0;'); // NEW
        const url = 'http://127.0.0.1:' + server.address().port + '/tracking', base = broker.baseUrl(win.webContents.id, 'native'); // NEW
        const plugin = fs.readFileSync(path.join(webapp, 'plugins/garden_planner_plugins/Modules_Standalone.js'), 'utf8'), helper = plugin.slice(plugin.indexOf('    function getCellDisplayText(cell)'), plugin.indexOf('    function getCellRawLabel(cell)')); // NEW
        await run(helper + '\n;void 0;'); await run('window.probeURL=' + JSON.stringify(url) + ';window.assetURL=' + JSON.stringify(base + 'assets/0123456789abcdef.png') + ';'); // NEW
        const icons = await run(fs.readFileSync(path.join(__dirname, 'content-security-icons-renderer.js'), 'utf8')); // NEW
        win.webContents.sendInputEvent({ type: 'mouseMove', x: icons.x, y: icons.y }); // NEW
        win.webContents.sendInputEvent({ type: 'mouseDown', x: icons.x, y: icons.y, button: 'left', clickCount: 1 }); // NEW
        win.webContents.sendInputEvent({ type: 'mouseMove', x: icons.x + 40, y: icons.y + 30, button: 'left' }); // NEW
        win.webContents.sendInputEvent({ type: 'mouseUp', x: icons.x + 40, y: icons.y + 30, button: 'left', clickCount: 1 }); // NEW
        const resized = await run('new Promise(resolve=>setTimeout(()=>resolve({width:iconCell.geometry.width,height:iconCell.geometry.height}),100))'); // NEW
        assert.ok(resized.width > 200 && resized.height > 140, 'Native handle drag did not resize the selected garden: ' + JSON.stringify(resized)); // NEW
        await run('iconGraph.destroy();document.getElementById("graph").replaceChildren();void 0;'); // NEW
        await run('window.navigatorGraph=new Graph(document.getElementById("graph"));window.Draw={loadPlugin:callback=>callback({editor:{graph:navigatorGraph,undoManager:new mxUndoManager()}})};void 0;'); // NEW
        await run(fs.readFileSync(path.join(webapp, 'plugins/garden_planner_plugins/Bed_Succession_Navigator.js'), 'utf8') + '\n;void 0;'); // NEW
        const navigatorIcons = await run(fs.readFileSync(path.join(__dirname, 'content-security-navigator-renderer.js'), 'utf8')); // NEW
        assert.equal(navigatorIcons.controls.length, 5); assert.equal(navigatorIcons.cleanNotice, true); assert.equal(requests.length, 0); // NEW
        await run('navigatorGraph.destroy();document.getElementById("graph").replaceChildren();void 0;'); // NEW
        const result = await run(fs.readFileSync(path.join(__dirname, 'content-security-renderer.js'), 'utf8')); // NEW
        assert.equal(result.text, 'Garden 🌱'); assert.equal(result.executed, false); assert.equal(result.rejected, true); assert.equal(result.svgRejected, true); assert.equal(result.hasRequire, 'undefined'); assert.equal(result.loaded, true, 'Verified protocol image failed to load'); assert.equal(requests.length, 0, JSON.stringify(requests)); // NEW
        other = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true } }); await other.loadFile(fixture); // NEW
        const crossWindow = await other.webContents.executeJavaScript('new Promise(resolve => { const image = new Image(); image.onload = () => resolve(true); image.onerror = () => resolve(false); image.src = ' + JSON.stringify(base + 'assets/0123456789abcdef.png') + '; setTimeout(() => resolve(false), 3000); })'); assert.equal(crossWindow, false); other.destroy(); other = null; // NEW
        assert.equal(win.webContents.getLastWebPreferences().sandbox, true); assert.equal(win.webContents.getLastWebPreferences().contextIsolation, true); // NEW
        console.log(JSON.stringify({ ok: true, remoteRequests: requests.length, compiledRuntime: true, sandbox: true, icons, navigatorIcons, resized, ...result })); // NEW
        clearTimeout(watchdog); win.destroy(); server.close(); app.exit(0); // NEW
    } catch (error) { console.error(error.stack); clearTimeout(watchdog); if (win) win.destroy(); if (other) other.destroy(); server?.close(); app.exit(1); } // NEW
}); // NEW
