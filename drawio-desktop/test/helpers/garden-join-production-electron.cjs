require('../../src/main/trellis-asset-scheme.cjs'); // NEW: production protocol privileges must precede app readiness.
/** Production app driver, restricted to a test-owned temporary profile and local commands. */ // CHANGE
const fs = require('node:fs'); // NEW
const path = require('node:path'); // NEW
const os = require('node:os'); // NEW
const { pathToFileURL } = require('node:url'); // NEW
const { app, dialog, session, ipcMain } = require('electron'); // CHANGE
const project = path.resolve(__dirname, '../..'), profile = path.resolve(process.env.TRELLIS_JOIN_TEST_PROFILE || ''); // NEW
if (path.dirname(profile) !== os.tmpdir() || !path.basename(profile).startsWith('trellis-garden-join-electron-')) throw new Error('Use an isolated garden join test profile.'); // NEW
for (const name of ['app-data', 'documents', 'session']) fs.mkdirSync(path.join(profile, name), { recursive: true }); // NEW
try { fs.unlinkSync(path.join(profile, 'driver-command.json')); } catch (error) { if (error.code !== 'ENOENT') throw error; } // NEW: restarting must not replay the previous process's quit command.
app.setPath('appData', path.join(profile, 'app-data')); app.setPath('documents', path.join(profile, 'documents')); app.setPath('sessionData', path.join(profile, 'session')); // NEW
app.disableHardwareAcceleration(); app.commandLine.appendSwitch('in-process-gpu'); app.commandLine.appendSwitch('no-sandbox'); // CHANGE: match the existing restricted-environment Electron fixtures; production settings are unchanged.
let window, lastCommand = 0, queue = Promise.resolve(), nativePort; // CHANGE
const stage = text => fs.appendFileSync(path.join(profile, 'driver-stage.log'), new Date().toISOString() + ' ' + text + '\n'); // CHANGE
function logRegistrations() { const root = path.join(app.getPath('userData'), 'trellis-identities'); for (const id of fs.existsSync(root) ? fs.readdirSync(root) : []) { const file = path.join(root, id, 'transport/canvases.json'); if (fs.existsSync(file)) { const records = JSON.parse(fs.readFileSync(file, 'utf8')); stage('Registrations: ' + JSON.stringify(records.map(({ shareId, diagramId, folderId, folderPath, diagramPath, filename, protocolVersion, pending, members }) => ({ shareId, diagramId, folderId, folderPath, diagramPath, filename, protocolVersion, pending, memberCount: members?.length })))); } } } // NEW: diagnostics omit invitations, credentials, and signing keys.
const quit = app.quit.bind(app); app.quit = () => { stage('Quit requested: ' + new Error().stack); return quit(); }; // NEW
ipcMain.on('rendererReq', (_event, args) => { if (['exit', 'trellisIdentity', 'windowAction'].includes(args.action)) stage('IPC: ' + args.action + ' / ' + args.method); }); // NEW
const childProcesses = require('node:child_process'), spawnProcess = childProcesses.spawn; childProcesses.spawn = (executable, args, options) => { const child = spawnProcess(executable, args, options); if (String(executable).includes('syncthing')) { nativePort = args.find(arg => arg.startsWith('--gui-address='))?.split(':').pop() || nativePort; stage('Spawn: ' + JSON.stringify(args) + ' / ' + child.pid); child.once('exit', code => stage('Child exit: ' + child.pid + ' / ' + code)); child.once('error', error => stage('Child error: ' + error.message)); } return child; }; require('node:module').syncBuiltinESMExports(); // CHANGE: observe the actual command-line GUI port; Syncthing does not save this override in config.xml.
app.on('browser-window-created', (_event, created) => { window = created; stage('Window created'); created.hide(); created.webContents.setBackgroundThrottling(false); created.webContents.on('console-message', event => { if (event.level === 'error') stage('Renderer: ' + event.message); }); created.webContents.on('did-finish-load', () => stage('Loaded ' + created.webContents.getURL())); created.webContents.on('did-fail-load', (_event, code, description) => stage('Load failed: ' + code + ' / ' + description)); created.webContents.on('render-process-gone', (_event, details) => stage('Renderer stopped: ' + JSON.stringify(details))); }); // CHANGE
const reply = (id, result, error) => process.stdout.write('JOIN_RPC:' + JSON.stringify({ id, result, error }) + '\n'); // NEW
process.on('unhandledRejection', error => { stage('Unhandled: ' + error.stack); reply('ready', null, error.stack); app.quit(); }); // NEW
async function evaluate(code) { return window.webContents.executeJavaScript(code, true); } // NEW
async function until(code) { // NEW
    const deadline = Date.now() + 90000; // NEW
    while (Date.now() < deadline) { if (window && await Promise.race([evaluate(code).catch(() => false), new Promise(resolve => setTimeout(() => resolve(false), 2000))])) return; await new Promise(resolve => setTimeout(resolve, 100)); } // CHANGE
    throw new Error('Production app readiness timed out: ' + code + ' / ' + window?.webContents.getURL()); // CHANGE
} // NEW
/** Only fixture-native REST credentials are read, and never returned to the parent or renderer. */ // NEW
async function nativeTransport(peer) { // NEW
    const identity = await evaluate('trellisIdentity.getSession()'); // NEW
    const folder = path.join(app.getPath('userData'), 'trellis-identities', identity.identityId, 'transport'); // NEW
    const configXml = fs.readFileSync(path.join(folder, 'syncthing/config.xml'), 'utf8'), logPath = path.join(folder, 'syncthing.log'), log = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : ''; // CHANGE: GUI address persists in config even when this binary does not create its requested log file.
    const candidates = [nativePort, ...[...log.matchAll(/(?:http:\/\/127\.0\.0\.1:|GUI and API listening on 127\.0\.0\.1:)(\d+)/g)].map(match => match[1]).reverse()].filter(Boolean); // CHANGE
    const gui = configXml.match(/<gui[\s\S]*?<address>127\.0\.0\.1:(\d+)<\/address>/); if (gui) candidates.push(gui[1]); // NEW
    const headers = { 'X-API-Key': fs.readFileSync(path.join(folder, 'api-key'), 'utf8') }; // NEW
    for (const port of [...new Set(candidates)]) { // NEW
        try { // NEW
            const base = 'http://127.0.0.1:' + port + '/rest/', response = await fetch(base + 'config', { headers, signal: AbortSignal.timeout(1000) }); if (!response.ok) continue; const config = await response.json(); // NEW
            if (peer) { const device = config.devices.find(device => device.deviceID === peer.deviceId); if (device) { device.addresses = [peer.address]; await fetch(base + 'config', { method: 'PUT', headers, body: JSON.stringify(config), signal: AbortSignal.timeout(3000) }); } } // NEW
            const status = await (await fetch(base + 'system/status', { headers })).json(), address = config.options.listenAddresses.find(address => address.startsWith('tcp://')); // NEW
            return { deviceId: status.myID, address: address.replace('0.0.0.0', '127.0.0.1') }; // NEW
        } catch (_) {} // NEW
    } // NEW
    throw new Error('The isolated fixture transport API is not ready.'); // NEW
} // NEW
async function run() { // NEW
    stage('Electron ready'); await app.whenReady(); session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => callback({ cancel: true })); // CHANGE
    const acquireLock = app.requestSingleInstanceLock.bind(app); app.requestSingleInstanceLock = (...args) => { const locked = acquireLock(...args); stage('Instance lock: ' + locked + ' / ' + app.getPath('userData')); return locked; }; // NEW
    stage('Main import'); await import(pathToFileURL(path.join(project, 'src/main/electron.js'))); stage('Renderer bootstrap'); // CHANGE
    await until('!!window.Draw?.loadPlugin && !!window.TrellisGardenHome && !!window.trellisGardenJoin'); // NEW
    stage('Plugin callback'); await evaluate('new Promise(resolve => Draw.loadPlugin(ui => { window.joinTestUi = ui; resolve(); }))'); stage('License launcher'); // CHANGE
    await evaluate("(()=>{const loaded=joinTestUi.fileLoaded;joinTestUi.fileLoaded=function(){const result=loaded.apply(this,arguments);Promise.resolve(result).then(()=>{window.joinInitialFileLoaded=true});return result}})()"); // CHANGE: plugin availability precedes the host's asynchronous startup file load.
    await until('!!window.joinInitialFileLoaded && !joinTestUi.openingFile'); // NEW: a late startup load must not replace the guide under test.
    await evaluate("(async()=>{localStorage.setItem('trellis.licenseWizard.v2', JSON.stringify({version:'2',path:'personal',contactGuidance:false,oathCompletedAt:new Date().toISOString(),name:'Join Test',signature:'Join Test',email:'join@example.test'})); joinTestUi.hideDialog(false); await joinTestUi.showSplash(true)})()"); // CHANGE
    await until("!!joinTestUi.dialog?.container.querySelector('[data-join-project]')"); stage('Ready'); reply('ready', true); // CHANGE
} // NEW
const ready = run(); ready.catch(error => { stage('Startup failed: ' + error.stack); reply('ready', null, error.stack); app.quit(); }); // CHANGE
const commands = setInterval(() => { // CHANGE: Electron's Windows GUI entry does not reliably deliver piped stdin.
        let command; try { command = JSON.parse(fs.readFileSync(path.join(profile, 'driver-command.json'), 'utf8')); } catch (_) { return; } // NEW
        if (command.id === lastCommand) return; lastCommand = command.id; stage('Command ' + command.id + ': ' + (command.kind || 'evaluate')); // NEW
        queue = queue.then(async () => { // NEW
            try { // NEW
                if (command.kind === 'quit') { logRegistrations(); dialog.showMessageBoxSync = () => 1; dialog.showMessageBox = async () => ({ response: 1 }); reply(command.id, true); app.quit(); return; } // NEW
                await ready; let result; // CHANGE
                if (command.kind === 'native') result = await nativeTransport(command.peer); // NEW
                else if (command.kind === 'capture') { const filename = path.join(profile, 'join-guide.png'); fs.writeFileSync(filename, (await window.webContents.capturePage()).toPNG()); result = filename; } // NEW
                else result = await evaluate(command.code); // NEW
                reply(command.id, result); stage('Completed ' + command.id); // CHANGE
            } catch (error) { logRegistrations(); reply(command.id, null, error.stack); } // NEW
        }); // NEW
}, 50); // CHANGE
app.once('will-quit', () => clearInterval(commands)); // NEW
