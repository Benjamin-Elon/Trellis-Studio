/** Native performance fixture: production entry, visible window, normal graphics, disposable remembered account. */ // NEW
require('../../src/main/trellis-asset-scheme.cjs'); // NEW
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'); // NEW
const { pathToFileURL } = require('node:url'); // NEW
const { app, Tray, dialog } = require('electron'); // NEW
let loginItem = { openAtLogin: false }; app.setLoginItemSettings = value => { loginItem = { ...value }; }; app.getLoginItemSettings = () => ({ ...loginItem }); // NEW: fixture creation cannot change the user's OS sign-in registration.
const profile = path.resolve(process.env.TRELLIS_STARTUP_PROFILE || ''); // NEW
if (path.dirname(profile) !== path.resolve(os.tmpdir()) || !path.basename(profile).startsWith('trellis-responsive-startup-')) throw new Error('A disposable startup profile is required.'); // NEW
const seed = process.env.TRELLIS_STARTUP_SEED === '1', output = process.env.TRELLIS_STARTUP_OUTPUT; // NEW
for (const [key, relative] of [['appData', 'app-data'], ['userData', 'app-data/draw.io'], ['documents', 'documents'], ['sessionData', 'session']]) { const directory = path.join(profile, relative); fs.mkdirSync(directory, { recursive: true }); app.setPath(key, directory); } // NEW
const started = performance.now() - (process.env.TRELLIS_STARTUP_STARTED_AT ? Date.now() - Number(process.env.TRELLIS_STARTUP_STARTED_AT) : 0); let window, trayMs = null, shellMs = null, lastBeat = performance.now(), maxMainGapMs = 0, finished = false; // CHANGE
const phases = {}; // NEW
const startedWall = Number(process.env.TRELLIS_STARTUP_STARTED_AT) || Date.now(); // CHANGE
/** Record readiness in the renderer even when the observer's own setup or IPC response is delayed. */ // NEW
const observeSource = `(()=>{if(window.startupBeats)return;window.startupParts={};window.startupBeats={last:performance.now(),maximum:0,observe:false};new PerformanceObserver(list=>{window.startupLongTasks=(window.startupLongTasks||[]).concat(list.getEntries().map(entry=>({start:entry.startTime,duration:entry.duration})));}).observe({type:'longtask',buffered:true});setInterval(()=>{const t=performance.now();if(startupBeats.observe)startupBeats.maximum=Math.max(startupBeats.maximum,t-startupBeats.last);startupBeats.last=t;const image=document.querySelector('.trellis-splash-bg-image'),actions=document.querySelector('.trellis-splash-actions');const conditions={background:image?.complete&&image.naturalWidth>0,controls:actions?.getBoundingClientRect().height>0&&[...actions.querySelectorAll('button')].every(button=>!button.disabled),login:document.querySelector('.trellis-splash-login-status')?.textContent==='Logged in as Startup Fixture'};for(const key of Object.keys(conditions))if(conditions[key]&&!startupParts[key])startupParts[key]=Date.now();if(!window.startupShellReadyAt&&Object.values(conditions).every(Boolean))window.startupShellReadyAt=Date.now();},100);})()`; // CHANGE
const originalMenu = Tray.prototype.setContextMenu; // NEW
Tray.prototype.setContextMenu = function(menu) { if (trayMs === null) trayMs = performance.now() - started; return originalMenu.call(this, menu); }; // NEW
const heartbeat = setInterval(() => { const time = performance.now(); if (shellMs !== null) maxMainGapMs = Math.max(maxMainGapMs, time - lastBeat); lastBeat = time; }, 100); // NEW
const deadline = setTimeout(() => void finish(1, { error: 'Native startup fixture exceeded 120 seconds.' }), 120000); // NEW
async function finish(code, result) { // NEW
    if (finished) return; finished = true; clearInterval(heartbeat); clearTimeout(deadline); // NEW
    fs.writeFileSync(output, JSON.stringify({ code, shellMs, trayMs, maxMainGapMs, phases, ...result }, null, 2)); console.log('RESPONSIVE_STARTUP:', JSON.stringify({ code, shellMs, trayMs, maxMainGapMs, phases, ...result })); // CHANGE
    dialog.showMessageBoxSync = () => 0; app.once('will-quit', event => { event.preventDefault(); app.exit(code); }); app.quit(); // NEW
} // NEW
async function evaluate(expression) { // NEW
    const response = await window.webContents.debugger.sendCommand('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); // NEW
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text); return response.result.value; // NEW
} // NEW
async function until(expression, timeoutMs = 30000) { // NEW
    const deadline = performance.now() + timeoutMs; while (performance.now() < deadline) { const value = await evaluate(expression); if (value) return value; await new Promise(resolve => setTimeout(resolve, 100)); } throw new Error('Native readiness timed out: ' + expression.slice(0, 100)); // NEW
} // NEW
app.on('browser-window-created', (_event, created) => { // NEW
    window = created; created.show(); created.webContents.setBackgroundThrottling(false); // NEW
    phases.windowMs = performance.now() - started; created.webContents.on('dom-ready', () => { phases.domMs = performance.now() - started; }); // NEW
    created.webContents.debugger.attach('1.3'); // NEW
    created.webContents.debugger.on('message', (_event, method, detail) => { if (method === 'Runtime.executionContextCreated' && detail.context.auxData?.isDefault) void created.webContents.debugger.sendCommand('Runtime.evaluate', { expression: observeSource, contextId: detail.context.id }); }); void created.webContents.debugger.sendCommand('Runtime.enable'); // NEW
    void created.webContents.debugger.sendCommand('Page.enable').then(() => created.webContents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: observeSource })); // CHANGE
    created.webContents.once('render-process-gone', (_event, detail) => void finish(1, { error: 'Renderer exited: ' + detail.reason })); // NEW
}); // NEW
void (async () => { // NEW
    await app.whenReady(); await import(pathToFileURL(path.resolve(__dirname, '../../src/main/electron.js'))); // NEW
    while (!window) await new Promise(resolve => setTimeout(resolve, 10)); // NEW
    await until("!!window.Draw?.loadPlugin && !!window.TrellisGardenHome"); // NEW
    phases.scriptsMs = performance.now() - started; await evaluate('Draw.loadPlugin(ui=>window.startupUi=ui);true'); // NEW
    if (seed) { // CHANGE: measured launches observe controls without waiting for diagnostic plugin registration.
        await evaluate('Draw.loadPlugin(ui=>window.startupUi=ui);true'); await until('!!window.startupUi'); // CHANGE
        await evaluate("localStorage.setItem('trellis.licenseWizard.v2',JSON.stringify({version:'2',path:'personal',contactGuidance:false,oathCompletedAt:'2026-01-01T00:00:00Z',name:'Startup fixture',signature:'Startup fixture',email:'fixture@example.test'}));startupUi.hideDialog();startupUi.showSplash(true);true"); // CHANGE
    } // NEW
    await until("(()=>{const image=document.querySelector('.trellis-splash-bg-image'),actions=document.querySelector('.trellis-splash-actions');return !!image?.complete&&image.naturalWidth>0&&!!actions&&actions.getBoundingClientRect().height>0&&[...actions.querySelectorAll('button')].every(button=>!button.disabled);})()"); // NEW
    if (seed) { // NEW
        await evaluate("trellisIdentity.create({username:'Startup Fixture',password:'disposable-startup-test-password',keepLoggedIn:true}).then(()=>true)"); // NEW
        const garden = await evaluate("trellisGardenLibrary.create({name:'Startup regression garden'})"); // NEW
        fs.writeFileSync(path.join(profile, 'garden.json'), JSON.stringify(garden)); await finish(0, { seeded: true }); return; // NEW
    } // NEW
    await until("document.querySelector('.trellis-splash-login-status')?.textContent==='Logged in as Startup Fixture'"); // NEW
    while (trayMs === null) await new Promise(resolve => setTimeout(resolve, 10)); // NEW
    await evaluate(observeSource); shellMs = (await evaluate('window.startupShellReadyAt')) - startedWall || performance.now() - started; lastBeat = performance.now(); await evaluate('startupBeats.observe=true;startupBeats.last=performance.now();true'); // CHANGE
    phases.renderer = await evaluate("({parts:window.startupParts,file:!!window.startupUi?.getCurrentFile(),palettes:document.querySelectorAll('.geSidebarContainer .geSidebar').length,longTasks:window.startupLongTasks,resources:performance.getEntriesByType('resource').filter(entry=>entry.duration>200).map(entry=>({name:entry.name.split('/').at(-1),start:entry.startTime,duration:entry.duration}))})"); for (const key of Object.keys(phases.renderer.parts || {})) phases.renderer.parts[key] -= startedWall; // CHANGE
    const garden = JSON.parse(fs.readFileSync(path.join(profile, 'garden.json'), 'utf8')), verificationStart = performance.now(); // NEW
    await evaluate('trellisGardenLibrary.prepareOpen({path:' + JSON.stringify(garden.path) + '})'); // NEW
    const verificationMs = performance.now() - verificationStart; await new Promise(resolve => setTimeout(resolve, 500)); // NEW
    const maxRendererGapMs = await evaluate('startupBeats.maximum'); // NEW
    fs.writeFileSync(output + '.png', (await window.webContents.capturePage()).toPNG()); // NEW
    await finish(shellMs <= 5000 && trayMs <= 5000 && maxMainGapMs < 1000 && maxRendererGapMs < 1000 ? 0 : 1, { verificationMs, maxRendererGapMs, loggedIn: true }); // NEW
})().catch(async error => { let state; try { state = await evaluate("({ready:document.readyState,splash:!!document.querySelector('.trellis-splash-root'),image:document.querySelector('.trellis-splash-bg-image')?.outerHTML,actions:document.querySelector('.trellis-splash-actions')?.outerHTML,license:!!localStorage.getItem('trellis.licenseWizard.v2')})"); } catch (_) {} await finish(1, { error: error.stack, state }); }); // CHANGE
