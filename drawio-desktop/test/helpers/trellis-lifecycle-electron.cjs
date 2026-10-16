/** Exercise the production main process with throwaway profiles and hidden windows. */ // NEW
const fs = require('node:fs'); // NEW
const path = require('node:path'); // NEW
const os = require('node:os'); // NEW
const { pathToFileURL } = require('node:url'); // NEW
const { app, dialog, ipcMain, session } = require('electron'); // CHANGE
const profile = process.env.TRELLIS_LIFECYCLE_PROFILE; // NEW
const mode = process.env.TRELLIS_LIFECYCLE_MODE || 'quit'; // NEW
if (!profile || path.dirname(path.resolve(profile)) !== path.resolve(os.tmpdir()) || !path.basename(profile).startsWith('trellis-lifecycle-')) throw new Error('Only an isolated lifecycle profile is accepted.'); // NEW
for (const name of ['app-data', 'documents', 'user-data', 'session-' + process.pid]) fs.mkdirSync(path.join(profile, name), { recursive: true }); // NEW
app.setPath('appData', path.join(profile, 'app-data')); app.setPath('documents', path.join(profile, 'documents')); // NEW
app.setPath('userData', path.join(profile, 'user-data')); app.setPath('sessionData', path.join(profile, 'session-' + process.pid)); // NEW
app.disableHardwareAcceleration(); app.commandLine.appendSwitch('in-process-gpu'); // NEW
const windows = [], initializedWindows = new Set(), readinessCleanups = new Set(); let quitStarted = false, quitTimer; // CHANGE
dialog.showErrorBox = (title, message) => { console.error('LIFECYCLE_ERROR:', title, message); }; // NEW
dialog.showMessageBoxSync = (_window, options) => options.title === 'Confirm' ? 1 : 0; // NEW: only isolated sample documents are discarded.
process.on('uncaughtException', error => { console.error('LIFECYCLE_UNCAUGHT:', error.stack); app.exit(1); }); // NEW
process.on('unhandledRejection', error => { console.error('LIFECYCLE_UNHANDLED:', error.stack || error); app.exit(1); }); // NEW
const bound = setTimeout(() => { console.error('LIFECYCLE_TIMEOUT'); app.quit(); setTimeout(() => app.exit(1), 16000).unref(); }, 45000); // NEW
function quit() { if (quitStarted) return; quitStarted = true; mode === 'close' && windows[0] && !windows[0].isDestroyed() ? windows[0].close() : app.quit(); } // NEW
app.on('quit', () => console.log('LIFECYCLE_NATIVE_QUIT')); // NEW
app.on('will-quit', () => { // CHANGE: remove pending per-window listeners even when startup or shutdown fails.
    clearTimeout(bound); clearTimeout(quitTimer); clearInterval(control); // CHANGE
    for (const cleanup of readinessCleanups) cleanup(); // CHANGE
    console.log('LIFECYCLE_EXIT:', JSON.stringify({ ready: windows.length > 0 && initializedWindows.size === windows.length, windows: windows.length, initialized: initializedWindows.size, alive: windows.filter(win => !win.isDestroyed()).length, handles: process._getActiveHandles().map(handle => handle.constructor.name) })); // CHANGE
}); // CHANGE
/** Observe the same document-load and sender-scoped app signals used by production startup. */ // CHANGE
function watchWindowReadiness(win) { // CHANGE
    const contents = win.webContents, contentsId = contents.id; let loaded = false, appReady = false; // CHANGE
    const cleanup = () => { ipcMain.removeListener('app-load-finished', receive); contents.removeListener('did-finish-load', didLoad); win.removeListener('closed', closed); readinessCleanups.delete(cleanup); }; // CHANGE
    const finish = () => { // CHANGE
        if (win.isDestroyed() || !loaded || !appReady) return; // CHANGE
        initializedWindows.add(contentsId); cleanup(); console.log('LIFECYCLE_READY:', contentsId); // CHANGE
        if (mode !== 'hold' && !quitTimer) quitTimer = setTimeout(quit, mode === 'timeout' ? 30 : 0); // CHANGE: schedule Close/Quit only after the production close handshake is installed.
    }; // CHANGE
    const receive = event => { if (!win.isDestroyed() && event.sender.id === contentsId && event.senderFrame === contents.mainFrame) { appReady = true; finish(); } }; // CHANGE
    const didLoad = () => { loaded = true; finish(); }; // CHANGE
    const closed = () => { console.error('LIFECYCLE_ERROR: window closed before readiness:', contentsId); cleanup(); }; // CHANGE
    readinessCleanups.add(cleanup); ipcMain.on('app-load-finished', receive); contents.on('did-finish-load', didLoad); win.once('closed', closed); // CHANGE
} // CHANGE
app.on('browser-window-created', (_event, win) => { // CHANGE
    windows.push(win); win.hide(); win.webContents.setBackgroundThrottling(false); // CHANGE: hidden test windows must finish startup without background scheduling delays.
    win.webContents.on('render-process-gone', (_event, details) => console.error('LIFECYCLE_ERROR: renderer', details.reason)); // NEW
    watchWindowReadiness(win); // CHANGE
}); // NEW
const control = setInterval(() => { if (fs.existsSync(path.join(profile, String(process.pid) + '.quit'))) quit(); }, 100); // CHANGE: Windows GUI Electron does not provide reliable piped stdin.
app.whenReady().then(() => { // CHANGE: configure only the isolated session before production starts creating windows.
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => callback({ cancel: true })); // CHANGE: external fonts and scripts cannot delay lifecycle readiness.
    return import(pathToFileURL(path.join(__dirname, '../../src/main/electron.js'))); // CHANGE
}).catch(error => { console.error(error); app.exit(1); }); // CHANGE
