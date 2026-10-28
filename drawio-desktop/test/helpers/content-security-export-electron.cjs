/** Exercise the actual main-process export callback, preload, compiled renderer and CSP. */ // NEW
require('../../src/main/trellis-asset-scheme.cjs'); // NEW
const { app, BrowserWindow, ipcMain, dialog } = require('electron'); // NEW
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), http = require('node:http'), assert = require('node:assert/strict'); // NEW
const { pathToFileURL } = require('node:url'); // NEW
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'trellis-security-export-')), windows = [], preferences = [], requests = []; let server; // NEW
for (const name of ['app-data', 'documents', 'profile']) fs.mkdirSync(path.join(directory, name)); // NEW
app.setPath('appData', path.join(directory, 'app-data')); app.setPath('documents', path.join(directory, 'documents')); app.setPath('userData', path.join(directory, 'profile')); // NEW
app.disableHardwareAcceleration(); app.commandLine.appendSwitch('in-process-gpu'); dialog.showErrorBox = (_title, message) => { throw new Error(message); }; // NEW
app.on('browser-window-created', (_event, window) => { windows.push(window); preferences.push(window.webContents.getLastWebPreferences()); window.hide(); window.webContents.on('console-message', event => { if (event.level === 'error') console.error('Export renderer:', event.message); }); }); // NEW
const deadline = setTimeout(() => { console.error('Production export timed out'); app.exit(1); }, 55000); // NEW
app.whenReady().then(async () => { // NEW
    try { // NEW
        server = http.createServer((request, response) => { requests.push(request.url); response.end('unexpected'); }); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); // NEW
        console.log('EXPORT_STAGE: production import'); await import(pathToFileURL(path.resolve(__dirname, '../../src/main/electron.js'))); // NEW
        console.log('EXPORT_STAGE: owner load'); const owner = windows[0]; assert.ok(owner, 'Production owner window was not created'); // NEW
        if (owner.webContents.isLoading()) await new Promise(resolve => owner.webContents.once('did-finish-load', resolve)); // NEW
        const png = 'data:image/png,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aR2kAAAAASUVORK5CYII='; // NEW
        const xml = '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="a" parent="1" vertex="1" value="Garden 🌱"><mxGeometry x="10" y="10" width="120" height="60" as="geometry"/></mxCell><mxCell id="b" parent="1" vertex="1" style="shape=image;image=' + png + ';"><mxGeometry x="20" y="80" width="50" height="50" as="geometry"/></mxCell><mxCell id="c" parent="1" vertex="1" style="shape=image;image=http://127.0.0.1:' + server.address().port + '/export;"><mxGeometry x="90" y="80" width="50" height="50" as="geometry"/></mxCell></root></mxGraphModel>'; // NEW
        const args = { format: 'svg', xml, scale: 1, border: 0 }, source = args.xml; // NEW
        console.log('EXPORT_STAGE: render request'); const svg = await new Promise((resolve, reject) => { const event = { sender: owner.webContents, senderFrame: owner.webContents.mainFrame, reply(channel, data) { if (channel === 'export-success') { event.finalize?.(); resolve(data); } else if (channel === 'export-error') reject(new Error(JSON.stringify(data))); } }; ipcMain.emit('export', event, args, true); }); // NEW
        assert.match(svg, /Garden/); assert.match(svg, /data:image\/png/); assert.doesNotMatch(svg, /127\.0\.0\.1/); assert.equal(args.xml, source); assert.equal(requests.length, 0); // NEW
        assert.equal(preferences[1].contextIsolation, true); assert.equal(preferences[1].sandbox, true); // NEW
        console.log(JSON.stringify({ ok: true, productionExport: true, remoteRequests: requests.length })); clearTimeout(deadline); server.close(); app.exit(0); // NEW
    } catch (error) { console.error(error.stack); clearTimeout(deadline); server?.close(); app.exit(1); } // NEW
}); // NEW
