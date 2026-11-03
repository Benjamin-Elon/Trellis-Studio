require('../../src/main/trellis-asset-scheme.cjs'); // NEW: production protocol privileges must precede app readiness.
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
app.on('second-instance', () => { setImmediate(() => process.stdout.write('LIFECYCLE_REUSED: ' + windows.filter(win => !win.isDestroyed()).length + '\n')); }); // NEW: acknowledge the owner processing a relaunch without depending on a delay.
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
        initializedWindows.add(contentsId); cleanup(); process.stdout.write('LIFECYCLE_READY: ' + contentsId + '\n'); // CHANGE: machine-readable IDs must not acquire FORCE_COLOR numeric formatting.
        if (mode === 'draft-recovery') { verifyDraftRecovery(win).then(quit).catch(error => { console.error('LIFECYCLE_ERROR:', error.stack); quit(); }); } // NEW: exercise recovery with real files and the production renderer.
        else if (mode === 'single-window') { verifySingleWindow(win).then(quit).catch(error => { console.error('LIFECYCLE_ERROR:', error.stack); quit(); }); } // NEW
        else if (mode !== 'hold' && !quitTimer) quitTimer = setTimeout(quit, mode === 'timeout' ? 30 : 0); // CHANGE: schedule Close/Quit only after the production close handshake is installed.
    }; // CHANGE
    const receive = event => { if (!win.isDestroyed() && event.sender.id === contentsId && event.senderFrame === contents.mainFrame) { appReady = true; finish(); } }; // CHANGE
    const didLoad = () => { loaded = true; finish(); }; // CHANGE
    const closed = () => { console.error('LIFECYCLE_ERROR: window closed before readiness:', contentsId); cleanup(); }; // CHANGE
    readinessCleanups.add(cleanup); ipcMain.on('app-load-finished', receive); contents.on('did-finish-load', didLoad); win.once('closed', closed); // CHANGE
} // CHANGE
/** Opening a document with a retained draft must still offer the existing recovery dialog. */ // NEW
async function verifyDraftRecovery(win) { // NEW
    const filename = path.join(profile, 'documents', 'Retained.drawio'), draftPath = path.join(profile, 'documents', '.$Retained.drawio.dtmp'); // NEW
    const saved = '<mxfile><diagram id="saved"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel></diagram></mxfile>'; // NEW
    const retained = saved.replace('id="saved"', 'id="retained"'); // NEW
    fs.writeFileSync(filename, saved); fs.writeFileSync(draftPath, retained); // NEW: both paths are inside the validated, test-owned temporary profile.
    const result = await win.webContents.executeJavaScript(`new Promise((resolve, reject) => Draw.loadPlugin(ui => { // NEW
        ui.hideDialog(); const OriginalDraftDialog = window.DraftDialog; // NEW
        window.DraftDialog = function(...args) { // NEW
            window.DraftDialog = OriginalDraftDialog; const dialog = new OriginalDraftDialog(...args), init = dialog.init; // NEW
            dialog.init = function() { init.apply(this, arguments); resolve({ data: args[2], visible: document.body.contains(dialog.container) }); }; return dialog; // NEW
        }; // NEW
        ui.readGraphFile(() => {}, reject, ${JSON.stringify(filename)}); // NEW
    }))`); // NEW
    if (!result.visible || result.data !== retained || fs.readFileSync(draftPath, 'utf8') !== retained) throw new Error('Retained draft recovery prompt was not preserved.'); // NEW
    await win.webContents.executeJavaScript('new Promise(resolve => Draw.loadPlugin(ui => { ui.hideDialog(); resolve(); }))'); // NEW
    console.log('LIFECYCLE_DRAFT_RECOVERY: offered'); // NEW
} // NEW
/** Native opening, legacy New IPC, and actual renderer decisions all reuse the production editor. */ // NEW
async function verifySingleWindow(win) { // NEW
    const assert = require('node:assert/strict'), first = path.join(profile, 'documents', 'First.drawio'), next = path.join(profile, 'documents', 'Next.drawio'); // NEW
    for (const [filename, id] of [[first, 'first'], [next, 'next']]) fs.writeFileSync(filename, '<mxfile><diagram id="' + id + '"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel></diagram></mxfile>'); // NEW
    const run = code => win.webContents.executeJavaScript(code); // NEW
    async function until(code) { // NEW
        const deadline = Date.now() + 10000; while (Date.now() < deadline) { if (await run(code)) return; await new Promise(resolve => setTimeout(resolve, 25)); } throw new Error('Single-window check timed out: ' + code + '\n' + await run('JSON.stringify({ dialog: singleUi.dialog?.container?.textContent?.slice(0,1200), spinner: singleUi.spinner?.active, errors: singleErrors, prompts: window.singlePromptDetails, action: singleUi.actions.get("new").funct.toString().slice(0,600), busy: document.querySelector(".trellis-editor-open-notice")?.textContent })')); // NEW
    } // NEW
    await run('new Promise(resolve => Draw.loadPlugin(ui => { window.singleUi = ui; window.singlePrompts = 0; window.singleErrors = []; ui.handleError = error => singleErrors.push(error.message); resolve(); }))'); // NEW
    await until('!singleUi.__trellisCheckingDrafts && !!singleUi.dialog?.container?.querySelector(".trellis-splash-root")'); await run('singleUi.hideDialog()'); // NEW: draft discovery owns startup until its real Home transition has finished.
    assert.equal(await run('TrellisGardenHome.openPath(singleUi, ' + JSON.stringify(first) + ')'), true); // NEW
    app.emit('second-instance', {}, [], profile, { args: [] }); app.emit('activate'); // NEW
    assert.equal(windows.length, 1); assert.equal(await run('singleUi.getCurrentFile().fileObject.path'), first); // NEW
    await run('singleUi.getCurrentFile().isAutosave = () => false; singleUi.getCurrentFile().setModified(true); window.singlePromptDetails = []; singleUi.confirm = (text, cancel) => { singlePrompts++; singlePromptDetails.push({ text, stack: new Error().stack }); cancel(); }; singleUi.actions.get("new").funct()'); // NEW: keep the deliberately dirty sample stable while testing discard decisions.
    await until('!!singleUi.__trellisGardenHome.projectsRoot?.isConnected'); assert.deepEqual(await run('singlePromptDetails'), []); assert.equal(windows.length, 1); // NEW
    await run('singleUi.hideDialog(); electron.sendMessage("newfile", { width: 1600 })'); await until('!!singleUi.__trellisGardenHome.projectsRoot?.isConnected'); // NEW
    assert.equal(windows.length, 1); await run('singleUi.hideDialog()'); // NEW
    app.emit('open-file', { preventDefault() {} }, first); // NEW
    app.emit('open-file', { preventDefault() {} }, next); await until('singlePrompts === 1 && !singleUi.__trellisGardenOpening'); // NEW
    assert.equal(await run('singleUi.getCurrentFile().fileObject.path'), first); // NEW
    await run('void (singleUi.confirm = (_text, _cancel, discard) => { singlePrompts++; discard(); })'); // NEW: native script evaluation must not try to clone a function result.
    app.emit('open-file', { preventDefault() {} }, next); await until('singleUi.getCurrentFile().fileObject.path === ' + JSON.stringify(next) + ' && !singleUi.__trellisGardenOpening'); // NEW
    assert.equal(await run('singlePrompts'), 2); assert.equal(windows.length, 1); // NEW
    await run('singleUi.getCurrentFile().savingFile = true'); app.emit('open-file', { preventDefault() {} }, first); await until('!!document.querySelector(".trellis-editor-open-notice")'); // NEW
    await run('singleUi.getCurrentFile().savingFile = false'); assert.equal(await run('singleUi.getCurrentFile().fileObject.path'), next); // NEW
    app.emit('open-file', { preventDefault() {} }, path.join(profile, 'documents', 'Missing.drawio')); await until('singleErrors.length === 1'); // NEW
    assert.equal(await run('singleUi.getCurrentFile().fileObject.path'), next); assert.equal(windows.length, 1); // NEW
    await run('singleUi.getCurrentFile().setModified(false)'); console.log('LIFECYCLE_SINGLE_WINDOW: passed'); // NEW
} // NEW
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
