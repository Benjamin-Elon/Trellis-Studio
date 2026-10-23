/** Real main/preload/Home persistence checks; all files and credentials belong to an isolated test profile. */ // NEW
const assert = require('node:assert/strict'); // NEW
const fs = require('node:fs'); // NEW
const os = require('node:os'); // NEW
const path = require('node:path'); // NEW
const { pathToFileURL } = require('node:url'); // NEW
const { app, dialog, session } = require('electron'); // NEW
const project = path.resolve(__dirname, '../..'); // NEW
const profile = path.resolve(process.env.TRELLIS_LOGIN_TEST_PROFILE || ''); // NEW
const phase = process.env.TRELLIS_LOGIN_TEST_PHASE; // NEW
if (path.dirname(profile) !== os.tmpdir() || !path.basename(profile).startsWith('trellis-identity-login-electron-') || !['create', 'restore', 'logged-out'].includes(phase)) throw new Error('Use only the isolated login test profile and a supported test phase.'); // NEW
const output = path.join(project, '.test-artifacts', 'identity-login', path.basename(profile)); // NEW
fs.mkdirSync(output, { recursive: true }); // NEW
for (const name of ['app-data', 'documents', 'session']) fs.mkdirSync(path.join(profile, name), { recursive: true }); // NEW
app.setPath('appData', path.join(profile, 'app-data')); app.setPath('documents', path.join(profile, 'documents')); app.setPath('sessionData', path.join(profile, 'session')); // NEW
app.disableHardwareAcceleration(); app.commandLine.appendSwitch('in-process-gpu'); // NEW
let window, stage = 'starting'; // NEW
app.on('browser-window-created', (_event, created) => { window = created; created.hide(); created.webContents.setBackgroundThrottling(false); created.webContents.on('did-fail-load', (_event, code, message) => console.error('Login test load failed:', code, message)); created.webContents.on('console-message', event => { if (event.level === 'error') console.error('Login test renderer:', event.message); }); }); // NEW
process.on('unhandledRejection', error => { console.error('Login test unhandled error:', error); app.exit(1); }); // NEW: expose asynchronous bootstrap failures instead of hanging on renderer readiness.
const timeout = setTimeout(() => { console.error('Identity login production smoke timed out: ' + phase + ' / ' + stage + ' / ' + window?.webContents.getURL()); app.exit(1); }, 120000); // NEW
app.once('will-quit', () => clearTimeout(timeout)); // NEW: keep the failure bound active until native shutdown actually finishes.
/** Bound polling to the readiness condition; no arbitrary startup delay is needed. */ // NEW
async function until(expression, label) { // NEW
    stage = label; // NEW
    const deadline = Date.now() + 90000; // NEW
    while (Date.now() < deadline) { // NEW
        const result = window && await window.webContents.executeJavaScript(expression).catch(() => false); // NEW
        if (result) return result; // NEW
        await new Promise(resolve => setTimeout(resolve, 200)); // NEW
    } // NEW
    console.error('Login UI state:', await window.webContents.executeJavaScript("({mode:loginTestUi.__trellisGardenHome.mode,version:loginTestUi.__trellisGardenHome.renderVersion,panel:loginTestUi.__trellisGardenHome.panel?.textContent,connected:loginTestUi.__trellisGardenHome.panel?.isConnected,dialogCount:loginTestUi.dialogs?.length})")); // NEW
    throw new Error('Timed out waiting for ' + label); // NEW
} // NEW
async function run() { // NEW
    stage = 'Electron ready'; await app.whenReady(); // NEW
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => callback({ cancel: true })); // NEW: external fonts and update pages must not delay this isolated local smoke.
    stage = 'main import'; // NEW
    await import(pathToFileURL(path.join(project, 'src/main/electron.js'))); // NEW
    await app.whenReady(); // NEW
    await until('!!window.Draw?.loadPlugin && !!window.TrellisGardenHome && !!window.trellisIdentity', 'Home and preload'); // NEW
    stage = 'editor plugin callback'; await window.webContents.executeJavaScript("new Promise(resolve => Draw.loadPlugin(ui => { window.loginTestUi = ui; resolve(); }));"); // NEW
    await window.webContents.executeJavaScript("localStorage.setItem('trellis.licenseWizard.v2', JSON.stringify({ version:'2', path:'personal', contactGuidance:false, oathCompletedAt:new Date().toISOString(), name:'Login Test', signature:'Login Test', email:'login@example.test' })); loginTestUi.hideDialog(); loginTestUi.showSplash(true);"); // NEW
    await until("(()=>{const root=loginTestUi.dialog?.container?.querySelector('.trellis-splash-root');return !!root?.querySelector('.trellis-splash-login-status')&&root.querySelector('.trellis-splash-actions')?.style.display!=='none';})()", 'splash launch readiness'); // NEW: enter through the same revealed launcher as a user, after startup completes.
    await window.webContents.executeJavaScript("loginTestUi.dialog.container.querySelector('[data-project-launcher=open]').click()"); // NEW
    const remembered = path.join(app.getPath('userData'), 'trellis-identities', 'remembered-session.json'); // NEW
    if (phase === 'create') { // NEW
        await until("loginTestUi.__trellisGardenHome.panel?.textContent.includes('Log in')", 'logged-out Home'); // NEW
        await until("(()=>{const panel=loginTestUi.__trellisGardenHome.panel;if(!panel?.isConnected)return false;if(!panel.querySelector('input[aria-label=Username]'))[...panel.querySelectorAll('button')].find(b=>b.textContent==='Create identity')?.click();const name=panel.querySelector('input[aria-label=Username]'),password=panel.querySelector('input[type=password]'),keep=panel.querySelector('input[type=checkbox]');if(!name||!password||!keep)return false;if(!keep.checked)throw new Error('Remembered login must default to checked.');name.value='Restart Test';password.value='isolated-login-test-password';panel.querySelector('form').requestSubmit();return true;})()", 'creation form submission'); // NEW: initial splash replacement must not occur between fixture input operations.
        const session = await until("trellisIdentity.getSession().then(session=>session?.username==='Restart Test'&&session)", 'created identity'); // NEW
        await until("loginTestUi.__trellisGardenHome.accountHost?.textContent.includes('Restart Test')", 'completed creation'); // NEW: wait for persistence and the form submission result, not an intermediate service session.
        assert.equal(fs.existsSync(remembered), true); assert.equal(fs.readFileSync(remembered, 'utf8').includes('isolated-login-test-password'), false); // NEW
        fs.writeFileSync(path.join(profile, 'expected-session.json'), JSON.stringify(session)); // NEW
        await window.webContents.executeJavaScript("(async()=>{window.loginTestGarden=await trellisGardenLibrary.create({name:'Logout test garden'}); await TrellisGardenHome.openPath(loginTestUi,loginTestGarden.path); loginTestUi.getCurrentFile().setModified(true);})()"); // NEW
        const savedRecord = fs.readFileSync(remembered, 'utf8'); // NEW
        const original = dialog.showMessageBox; dialog.showMessageBox = async () => ({ response: 0 }); // NEW: exercise the real unsaved-document handshake with a canceled native prompt.
        try { assert.deepEqual(await window.webContents.executeJavaScript('trellisIdentity.lock()'), { ok: false, canceled: true }); } finally { dialog.showMessageBox = original; } // NEW
        assert.equal(fs.readFileSync(remembered, 'utf8'), savedRecord); // NEW
        assert.equal(await window.webContents.executeJavaScript('loginTestUi.getCurrentFile().isModified()'), true); // NEW
        assert.deepEqual(await window.webContents.executeJavaScript('trellisIdentity.getSession()'), session); // NEW
        await window.webContents.executeJavaScript('loginTestUi.getCurrentFile().setModified(false);'); // NEW
    } else if (phase === 'restore') { // NEW
        const expected = JSON.parse(fs.readFileSync(path.join(profile, 'expected-session.json'))); // NEW
        assert.deepEqual(await window.webContents.executeJavaScript('trellisIdentity.getSession()'), expected); // NEW
        await until("loginTestUi.__trellisGardenHome.accountHost?.textContent.includes('Restart Test')", 'restored Home identity'); // NEW
        stage = 'restored identity logout'; const original = dialog.showMessageBox; dialog.showMessageBox = async () => ({ response: 1 }); // NEW: restored sample diagrams may normalize after opening; this phase explicitly approves their discard.
        try { assert.deepEqual(await window.webContents.executeJavaScript('trellisIdentity.lock()'), { ok: true }); } finally { dialog.showMessageBox = original; } // NEW
        assert.equal(fs.existsSync(remembered), false); assert.equal(await window.webContents.executeJavaScript('trellisIdentity.getSession()'), null); // NEW
        await until("(()=>{const panel=loginTestUi.__trellisGardenHome.panel;if(!panel?.isConnected)return false;if(!panel.querySelector('input[type=password]'))[...panel.querySelectorAll('button')].find(b=>b.textContent==='Log in')?.click();return panel.querySelector('input[type=checkbox]')?.checked===true;})()", 'checked login form'); // NEW
    } else { // NEW
        assert.equal(await window.webContents.executeJavaScript('trellisIdentity.getSession()'), null); // NEW
        assert.equal(fs.existsSync(remembered), false); // NEW
        await until("loginTestUi.__trellisGardenHome.panel?.textContent.includes('Log in')", 'logged-out restart'); // NEW
    } // NEW
    fs.writeFileSync(path.join(output, phase + '.json'), JSON.stringify({ ok: true, phase, osProtectedStorage: true, ...(phase === 'create' ? { canceledLogoutPreservesDraft: true, checkedByDefault: true } : {}) }, null, 2)); // NEW
    console.log(JSON.stringify({ ok: true, phase, output })); stage = 'shutdown'; dialog.showMessageBoxSync = () => 1; app.quit(); // NEW: discard only late normalization in this sample fixture and stop transports through production shutdown.
} // NEW
run().catch(error => { console.error('Login test failed at ' + stage, error); clearTimeout(timeout); app.exit(1); }); // NEW
