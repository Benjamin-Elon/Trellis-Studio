/** NEW: Diagnose the real splash with normal GPU/network defaults and parent-bounded cleanup.
 * Run scripts/run-production-smoke.cjs with TRELLIS_SPLASH_DIAGNOSTIC=1. // NEW
 * The default profile is disposable; TRELLIS_SPLASH_PROFILE=live requires a closed-profile backup first. // NEW
 * TRELLIS_SPLASH_COMPLETED=1 seeds only a temporary license; TRELLIS_SPLASH_NAVIGATE=1 exercises temporary projects. // NEW
 * TRELLIS_SPLASH_TRACE=1 records a timeline; TRELLIS_SPLASH_INSPECTOR=1 exposes a loopback main-process inspector. // NEW
 * Logs, settings snapshots and results stay in the ignored .test-artifacts/splash-freeze directory. // NEW
 */
const fs = require('node:fs'); // NEW
const os = require('node:os'); // NEW
const path = require('node:path'); // NEW
const { pathToFileURL } = require('node:url'); // NEW
const { app, contentTracing, session } = require('electron'); // NEW
const inspector = require('node:inspector'); // NEW
const project = path.resolve(__dirname, '../..'); // NEW
const live = process.env.TRELLIS_SPLASH_PROFILE === 'live'; // NEW: only explicit baseline/validation runs use the backed-up normal profile.
const output = path.join(project, '.test-artifacts/splash-freeze', 'run-' + Date.now() + '-' + process.pid); // NEW
fs.mkdirSync(output, { recursive: true }); // NEW
if (process.env.TRELLIS_SPLASH_INSPECTOR === '1') { inspector.open(0, '127.0.0.1'); fs.writeFileSync(path.join(output, 'main-inspector-url.txt'), inspector.url()); } // NEW: opt-in access for inspecting a blocked main thread from an independent process.
const events = fs.createWriteStream(path.join(output, 'events.jsonl')); // NEW
let window, timer, pending = false, finishing = false, started = Date.now(), healthySince = null, beats = 0, settingsSaved = false, lastBeat = null, maxGapMs = 0, completedSeeded = false, loggedIn = false; // NEW
const observeMs = Number(process.env.TRELLIS_SPLASH_OBSERVE_MS || 30000); // NEW
const traceEnabled = process.env.TRELLIS_SPLASH_TRACE === '1'; // NEW: timeline tracing is opt-in; ordinary validation uses normal startup behavior.
const profile = live ? null : fs.mkdtempSync(path.join(os.tmpdir(), 'trellis-splash-diagnostic-')); // NEW
if (profile) { // NEW: override appData too because the main process pins userData to appData/draw.io.
    for (const name of ['app-data', 'documents', 'session', 'app-data/draw.io']) fs.mkdirSync(path.join(profile, name)); // NEW
    for (const [key, name] of [['appData', 'app-data'], ['documents', 'documents'], ['sessionData', 'session'], ['userData', 'app-data/draw.io']]) app.setPath(key, path.join(profile, name)); // NEW
} // NEW
else app.setPath('userData', path.join(app.getPath('appData'), 'draw.io')); // NEW: safeStorage loads its profile encryption key at app readiness, before the diagnostic imports the production entry point.
if (process.env.TRELLIS_SPLASH_DISABLE_GPU === '1') app.disableHardwareAcceleration(); // NEW: opt-in comparison, never the baseline.

/** Record timing and bounded diagnostics without dumping credentials or document contents. */ // NEW
function record(event, detail) { // NEW
    const entry = { ms: Date.now() - started, event, detail }; // NEW
    events.write(JSON.stringify(entry) + '\n'); // NEW
    if (event !== 'heartbeat') console.log('SPLASH_DIAGNOSTIC:', JSON.stringify(entry)); // NEW
} // NEW

/** Bound renderer requests independently of the renderer's own event loop. */ // NEW
function bounded(promise, ms = 3000) { // NEW
    let deadline; // NEW
    return Promise.race([promise, new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error('Renderer request timed out')), ms); })]).finally(() => clearTimeout(deadline)); // NEW
} // NEW

/** Evaluate before page load completes, with errors and async work bounded by the main process. */ // NEW
async function evaluate(expression, timeout = 3000) { // NEW
    const value = await bounded(window.webContents.debugger.sendCommand('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }), timeout); // NEW
    if (value.exceptionDetails) throw new Error(value.exceptionDetails.exception?.description || value.exceptionDetails.text); // NEW
    return value.result.value; // NEW
} // NEW

/** Exercise Create, Open and Home against a disposable identity and project, never the live profile. */ // NEW
async function navigateFixture() { // NEW
    if (live) throw new Error('Navigation fixtures require an isolated profile.'); // NEW
    async function until(expression, label) { // NEW
        const deadline = Date.now() + 30000; // NEW
        while (Date.now() < deadline) { if (await evaluate(expression)) { record('navigation', label); return; } await new Promise(resolve => setTimeout(resolve, 200)); } // NEW
        throw new Error('Navigation timed out: ' + label); // NEW
    } // NEW
    await until("!!document.querySelector('[data-project-launcher=create]')", 'Create control'); // NEW
    await evaluate("document.querySelector('[data-project-launcher=create]').click()"); // NEW
    await until("!!window.splashDiagnosticUi.__trellisGardenHome.panel?.textContent.includes('Create identity')", 'identity controls'); // NEW
    await evaluate("(()=>{const panel=splashDiagnosticUi.__trellisGardenHome.panel;[...panel.querySelectorAll('button')].find(b=>b.textContent==='Create identity').click();panel.querySelector('input[aria-label=Username]').value='Splash diagnostic';panel.querySelector('input[type=password]').value='isolated-splash-fixture-password';panel.querySelector('form').requestSubmit();})()"); // NEW
    await until("splashDiagnosticUi.__trellisGardenHome.session?.username === 'Splash diagnostic'", 'fixture identity'); // CHANGE: the restored account menu moves login text out of the identity panel.
    await evaluate("(()=>{const state=splashDiagnosticUi.__trellisGardenHome;[...state.projectsRoot.querySelectorAll('button')].find(b=>b.textContent==='Create New Private Garden Project').click();state.creationForm.querySelector('input[aria-label=\"Project name\"]').value='Splash fixture';state.creationForm.requestSubmit();})()"); // CHANGE: use the restored project form rather than the separate identity form.
    await until("(()=>{const ui=splashDiagnosticUi;const error=document.querySelector('.trellis-home-open');if(error)throw new Error(error.textContent);return !ui.__trellisGardenHome.creating&&!!ui.getCurrentFile()?.fileObject?.path;})()", 'created project'); // NEW
    const filename = await evaluate('splashDiagnosticUi.getCurrentFile().fileObject.path'); // NEW
    if (!path.resolve(filename).startsWith(path.resolve(profile) + path.sep)) throw new Error('Fixture escaped the temporary profile.'); // NEW
    await until("Object.values(splashDiagnosticUi.editor.graph.model.cells).some(c=>c.value?.getAttribute?.('garden_module')==='1')", 'starter garden'); // NEW
    await evaluate("new Promise((resolve,reject)=>splashDiagnosticUi.getCurrentFile().save(false,resolve,reject))", 15000); // NEW
    await evaluate("splashDiagnosticUi.actions.get('trellisHome').funct()"); // NEW
    await until("!!document.querySelector('[data-project-launcher=open]')", 'returned Home'); // NEW
    await evaluate("document.querySelector('[data-project-launcher=open]').click()"); // NEW
    await until("[...document.querySelectorAll('.trellis-home-garden')].some(row=>row.textContent.includes('Splash fixture'))", 'Open project listing'); // NEW
    await evaluate("(()=>{const row=[...document.querySelectorAll('.trellis-home-garden')].find(row=>row.textContent.includes('Splash fixture'));[...row.querySelectorAll('button')].find(b=>b.textContent==='Open').click();})()"); // NEW
    await until('splashDiagnosticUi.getCurrentFile()?.fileObject?.path === ' + JSON.stringify(filename) + " && !document.querySelector('.trellis-projects-root')", 'reopened fixture'); // NEW
    await evaluate("splashDiagnosticUi.actions.get('trellisHome').funct()"); // NEW
    await until("!!document.querySelector('.trellis-splash-root')", 'Home after reopening'); // NEW
    fs.writeFileSync(path.join(output, 'navigation.json'), JSON.stringify({ create: true, open: true, home: true, filename }, null, 2)); // NEW
} // NEW

/** Stop tracing and request the production shutdown path; the existing parent owns emergency termination. */ // NEW
async function finish(code) { // NEW
    if (finishing) return; // NEW
    finishing = true; clearInterval(timer); clearInterval(parentControl); // NEW
    if (traceEnabled) { try { await bounded(contentTracing.stopRecording(path.join(output, 'trace.json')), 15000); } catch (error) { record('trace-error', error.message); code = 1; } } // NEW
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ code, live, profile, output, beats, maxGapMs, loggedIn, versions: process.versions }, null, 2)); // NEW
    record('finished', { code, output, beats }); // NEW
    events.end(); // NEW
    app.once('will-quit', event => { event.preventDefault(); app.exit(code); }); // NEW
    app.quit(); // NEW
} // NEW

app.on('browser-window-created', (_event, created) => { // NEW
    window = created; // NEW
    record('window-created', created.id); // NEW
    const contents = created.webContents; // NEW
    contents.on('console-message', details => { if (details.level === 'error') record('console-error', { message: details.message, source: details.sourceId, line: details.lineNumber }); }); // NEW
    contents.on('did-fail-load', (_event, code, description, url) => record('load-failed', { code, description, url })); // NEW
    contents.on('render-process-gone', (_event, details) => { record('renderer-exit', details); void finish(1); }); // NEW
    created.on('unresponsive', () => record('unresponsive', created.id)); // NEW
    contents.on('dom-ready', () => record('dom-ready', contents.getURL())); // NEW
    contents.on('did-finish-load', () => record('did-finish-load', contents.getURL())); // NEW
    try { // NEW: install error capture before the first document's scripts execute.
        contents.debugger.attach('1.3'); // NEW
        const resources = new Map(); // NEW
        contents.debugger.on('message', (_event, method, params) => { // NEW
            if (method === 'Network.requestWillBeSent') resources.set(params.requestId, params.request.url); // NEW
            if (method === 'Network.loadingFinished') resources.delete(params.requestId); // NEW
            if (method === 'Network.loadingFailed') { record('resource-failed', { error: params.errorText, type: params.type, url: resources.get(params.requestId) }); resources.delete(params.requestId); } // NEW
            if (method === 'Runtime.exceptionThrown') record('exception', params.exceptionDetails); // NEW
        }); // NEW
        void contents.debugger.sendCommand('Network.enable'); void contents.debugger.sendCommand('Runtime.enable'); // NEW
        void contents.debugger.sendCommand('Page.enable').then(() => contents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: "window.addEventListener('error', e => console.error('SPLASH_ERROR', e.message, e.filename, e.lineno, e.error?.stack)); window.addEventListener('unhandledrejection', e => console.error('SPLASH_REJECTION', e.reason?.stack || String(e.reason)));" })).catch(error => record('debugger-error', error.message)); // NEW
    } catch (error) { record('debugger-error', error.message); } // NEW
}); // NEW

const parentControl = setInterval(() => { if (process.env.TRELLIS_SMOKE_STOP_FILE && fs.existsSync(process.env.TRELLIS_SMOKE_STOP_FILE)) void finish(1); }, 200); // NEW

/** Observe an untouched splash, then optionally exercise the fixture's navigation. */ // NEW
async function heartbeat() { // NEW
    if (pending || finishing || !window || window.isDestroyed()) return; // NEW
    pending = true; // NEW
    try { // NEW
        const snapshot = await evaluate("(()=>{if(window.Draw?.loadPlugin&&!window.splashDiagnosticRegistered){window.splashDiagnosticRegistered=true;Draw.loadPlugin(ui=>window.splashDiagnosticUi=ui);}return {ready:document.readyState,splash:!!document.querySelector('.trellis-splash-root'),ui:!!window.splashDiagnosticUi,actions:!!document.querySelector('.trellis-splash-actions'),home:!!window.TrellisGardenHome,plugins:window.mxSettings?.getPlugins?.(),config:localStorage.getItem('.drawio-config'),license:localStorage.getItem('trellis.licenseWizard.v2'),avatar:localStorage.getItem('trellis.splash.avatar.v1'),loggedIn:!!document.querySelector('.trellis-splash-login-status')?.textContent.startsWith('Logged in as '),nodes:document.getElementsByTagName('*').length};})()", healthySince == null ? 15000 : 3000); // CHANGE: allow startup parsing before observing the splash; retain the strict responsiveness bound afterward.
        loggedIn = snapshot.loggedIn; // NEW: verify remembered login without writing names or credentials into logs.
        if (!live && !completedSeeded && snapshot.ui && snapshot.splash && snapshot.ready === 'complete' && process.env.TRELLIS_SPLASH_COMPLETED === '1') { // CHANGE: wait for the initial splash before replacing its license state, avoiding reentrant startup.
            await evaluate("localStorage.setItem('trellis.licenseWizard.v2',JSON.stringify({version:'2',path:'personal',contactGuidance:false,oathCompletedAt:new Date().toISOString(),name:'Splash diagnostic',signature:'Splash diagnostic',email:'splash@example.test'}));splashDiagnosticUi.hideDialog();splashDiagnosticUi.showSplash(true)"); // NEW
            completedSeeded = true; healthySince = null; lastBeat = null; record('completed-license-seeded'); return; // NEW
        } // NEW
        if (!settingsSaved && snapshot.plugins) { // NEW: retain active settings privately in the ignored artifact folder.
            fs.writeFileSync(path.join(output, 'active-settings.json'), JSON.stringify(snapshot, null, 2)); // NEW
            record('active-settings', { plugins: snapshot.plugins, licensed: !!snapshot.license, avatar: !!snapshot.avatar }); // NEW
            settingsSaved = true; // NEW
        } // NEW
        const now = Date.now(), gap = lastBeat == null ? 0 : now - lastBeat; lastBeat = now; maxGapMs = Math.max(maxGapMs, gap); // NEW
        if (healthySince && gap > 3000) { record('main-thread-stall', { gap }); await finish(1); return; } // NEW: a resumed main loop must not count its stalled wall time as healthy observation.
        beats++; record('heartbeat', { ready: snapshot.ready, splash: snapshot.splash, actions: snapshot.actions, nodes: snapshot.nodes, gap }); // NEW
        if (snapshot.splash && healthySince == null) { healthySince = Date.now(); record('splash-visible'); } // NEW
        if (healthySince && Date.now() - healthySince >= observeMs) { if (process.env.TRELLIS_SPLASH_NAVIGATE === '1') await navigateFixture(); await finish(0); } // NEW
    } catch (error) { record('heartbeat-failed', error.message); await finish(1); } // NEW
    finally { pending = false; } // NEW
} // NEW

(async () => { // NEW
    record('starting', { live, profile, output, versions: process.versions, gpuDisabled: process.env.TRELLIS_SPLASH_DISABLE_GPU === '1', networkBlocked: process.env.TRELLIS_SPLASH_BLOCK_NETWORK === '1' }); // NEW
    await app.whenReady(); // NEW
    if (process.env.TRELLIS_SPLASH_BLOCK_NETWORK === '1') session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => callback({ cancel: true })); // NEW
    if (traceEnabled) await contentTracing.startRecording({ included_categories: ['devtools.timeline', 'v8', 'blink.user_timing'] }); // NEW: avoid Chromium CPU-sampler teardown crashes with Node worker threads; use the separate inspector for CPU stacks.
    await import(pathToFileURL(path.join(project, 'src/main/electron.js'))); // NEW
    timer = setInterval(() => { void heartbeat(); }, 1000); // NEW
    record('main-imported'); // NEW
})().catch(error => { record('fatal', error.stack); void finish(1); }); // NEW
