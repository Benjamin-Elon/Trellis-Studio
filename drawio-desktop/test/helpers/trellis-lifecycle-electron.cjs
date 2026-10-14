/** Exercise the production main process with throwaway profiles and hidden windows. */ // NEW
const fs = require('node:fs'); // NEW
const path = require('node:path'); // NEW
const os = require('node:os'); // NEW
const { pathToFileURL } = require('node:url'); // NEW
const { app, dialog } = require('electron'); // NEW
const profile = process.env.TRELLIS_LIFECYCLE_PROFILE; // NEW
const mode = process.env.TRELLIS_LIFECYCLE_MODE || 'quit'; // NEW
if (!profile || path.dirname(path.resolve(profile)) !== path.resolve(os.tmpdir()) || !path.basename(profile).startsWith('trellis-lifecycle-')) throw new Error('Only an isolated lifecycle profile is accepted.'); // NEW
for (const name of ['app-data', 'documents', 'user-data', 'session-' + process.pid]) fs.mkdirSync(path.join(profile, name), { recursive: true }); // NEW
app.setPath('appData', path.join(profile, 'app-data')); app.setPath('documents', path.join(profile, 'documents')); // NEW
app.setPath('userData', path.join(profile, 'user-data')); app.setPath('sessionData', path.join(profile, 'session-' + process.pid)); // NEW
app.disableHardwareAcceleration(); app.commandLine.appendSwitch('in-process-gpu'); // NEW
const windows = []; let quitStarted = false, ready = false; // NEW
dialog.showErrorBox = (title, message) => { console.error('LIFECYCLE_ERROR:', title, message); }; // NEW
dialog.showMessageBoxSync = (_window, options) => options.title === 'Confirm' ? 1 : 0; // NEW: only isolated sample documents are discarded.
process.on('uncaughtException', error => { console.error('LIFECYCLE_UNCAUGHT:', error.stack); app.exit(1); }); // NEW
process.on('unhandledRejection', error => { console.error('LIFECYCLE_UNHANDLED:', error.stack || error); app.exit(1); }); // NEW
const bound = setTimeout(() => { console.error('LIFECYCLE_TIMEOUT'); app.quit(); setTimeout(() => app.exit(1), 16000).unref(); }, 45000); // NEW
function quit() { if (quitStarted) return; quitStarted = true; mode === 'close' && windows[0] && !windows[0].isDestroyed() ? windows[0].close() : app.quit(); } // NEW
app.on('quit', () => console.log('LIFECYCLE_NATIVE_QUIT')); // NEW
app.on('will-quit', () => { clearTimeout(bound); clearInterval(control); console.log('LIFECYCLE_EXIT:', JSON.stringify({ ready, windows: windows.length, alive: windows.filter(win => !win.isDestroyed()).length, handles: process._getActiveHandles().map(handle => handle.constructor.name) })); }); // NEW
app.on('browser-window-created', (_event, win) => { // NEW
    windows.push(win); win.hide(); win.webContents.on('render-process-gone', (_event, details) => console.error('LIFECYCLE_ERROR: renderer', details.reason)); // NEW
    if (ready) return; // NEW
    setTimeout(() => { // CHANGE: test startup close independently of external font/MathJax loading. // NEW
        if (ready || win.isDestroyed()) return; ready = true; console.log('LIFECYCLE_READY'); // NEW
        if (mode !== 'hold') setTimeout(quit, mode === 'timeout' ? 30 : 300); // NEW
    }, 1000); // CHANGE
}); // NEW
const control = setInterval(() => { if (fs.existsSync(path.join(profile, String(process.pid) + '.quit'))) quit(); }, 100); // CHANGE: Windows GUI Electron does not provide reliable piped stdin.
import(pathToFileURL(path.join(__dirname, '../../src/main/electron.js'))).catch(error => { console.error(error); app.exit(1); }); // NEW
