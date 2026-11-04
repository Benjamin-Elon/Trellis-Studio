require('../../src/main/trellis-asset-scheme.cjs'); // NEW: production protocol privileges must precede app readiness.
/** Load the real application and plugin set against a private local garden. */ // NEW
const fs = require('node:fs'); // NEW
const path = require('node:path'); // NEW
const os = require('node:os'); // NEW
const { pathToFileURL } = require('node:url'); // NEW
const childProcess = require('node:child_process'), { syncBuiltinESMExports } = require('node:module'); // NEW
const ownedChildren = new Set(), originalSpawn = childProcess.spawn; // NEW
childProcess.spawn = (...args) => { const child = originalSpawn(...args); ownedChildren.add(child); child.once('exit', () => ownedChildren.delete(child)); return child; }; syncBuiltinESMExports(); // NEW
const { app, dialog, session } = require('electron'); // NEW
let testStartup = { openAtLogin: false }; app.getLoginItemSettings = () => ({ ...testStartup }); app.setLoginItemSettings = value => { testStartup = { ...testStartup, ...value }; }; // NEW: isolated garden creation must never change the user's OS startup registration.
const project = process.env.TRELLIS_RESPONSIVENESS_PROJECT || path.resolve(__dirname, '../..'); // CHANGE: frozen helpers retain the application resource root.
const responsiveness = process.argv.includes('--responsiveness') ? require('./small-diagram-responsiveness.cjs')({ project, app, session }) : null; // CHANGE: opt-in production timing matrix, separate from CPU profiling.
const output = path.join(project, '.test-artifacts/module-clusters'); // NEW
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'trellis-clusters-production-')); // NEW
for (const name of ['app-data', 'documents', 'session', 'user-data']) fs.mkdirSync(path.join(profile, name), { recursive: true }); // NEW
app.setPath('appData', path.join(profile, 'app-data')); app.setPath('documents', path.join(profile, 'documents')); // NEW
app.setPath('userData', path.join(profile, 'user-data')); app.setPath('sessionData', path.join(profile, 'session')); // NEW
if (!process.argv.includes('--saving-redesign')) { app.disableHardwareAcceleration(); app.commandLine.appendSwitch('in-process-gpu'); } // CHANGE: interaction qualification uses the application's normal graphics settings.
if (process.argv.includes('--creation-regression') || process.argv.includes('--saving-redesign')) app.commandLine.appendSwitch('no-sandbox'); // CHANGE: isolated native regression profiles must also run where Windows cannot initialize Chromium's renderer sandbox.
app.commandLine.appendSwitch('disable-renderer-backgrounding'); // NEW
app.commandLine.appendSwitch('disable-background-timer-throttling'); // NEW
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion,IntensiveWakeUpThrottling'); // NEW
app.commandLine.appendSwitch('js-flags', '--expose-gc'); // NEW
let win, stage = 'startup', closing = false; const rendererErrors = []; // NEW
app.on('browser-window-created', (_event, created) => { // NEW
    win = created; if (process.argv.includes('--saving-redesign')) created.showInactive(); else created.hide(); created.webContents.setBackgroundThrottling(false); // CHANGE: qualify a visible window while preserving focus in the user's session.
    created.webContents.on('console-message', event => { // NEW
        if (event.level === 'error') { console.error('Renderer:', event.message, event.sourceId || '', event.lineNumber || ''); if (event.message?.includes('Uncaught')) rendererErrors.push(event.message); } // CHANGE: retain source locations for failed production fixtures.
        else if (event.message?.startsWith('CLUSTER_STAGE:')) console.log(event.message); // NEW
    }); // NEW
    created.webContents.on('render-process-gone', (_event, details) => { if (!closing) { console.error('Renderer exited:', details); finish(1); } }); // NEW
}); // NEW
const timeout = setTimeout(() => { console.error('Production cluster validation timed out at', stage); finish(1); }, 600000); // NEW
let profileTimer = null, profileBusy = false, profileNumber = 0; // NEW
async function until(check, label) { // NEW
    stage = label; console.log('PRODUCTION_STAGE:', label); // NEW
    const deadline = Date.now() + 90000; // NEW
    while (!await check()) { if (Date.now() > deadline) throw Error('Timed out: ' + label); await new Promise(resolve => setTimeout(resolve, 200)); } // NEW
} // NEW
function finish(code) { // NEW
    if (closing) return; closing = true; clearTimeout(timeout); // NEW
    clearInterval(profileTimer); // NEW
    const emergency = setTimeout(() => { for(const child of ownedChildren)if(child.exitCode==null)child.kill('SIGKILL');app.exit(code || 1); }, 20000); // NEW
    const confirm = dialog.showMessageBoxSync; // NEW
    dialog.showMessageBoxSync = (...args) => args.at(-1)?.title === 'Confirm' ? 1 : confirm(...args); // NEW
    app.once('will-quit', event => { event.preventDefault(); clearTimeout(emergency); for(const child of ownedChildren)if(child.exitCode==null)child.kill('SIGKILL');app.exit(code); }); // NEW
    app.quit(); // NEW
} // NEW
process.on('SIGINT', () => finish(130)); process.on('SIGTERM', () => finish(143)); // NEW: interrupted profiling runs must release only their own subprocesses.
app.whenReady().then(async () => { // NEW
    if (process.env.TRELLIS_REDESIGN_SOURCE_ROOT) require('../../scripts/check-coordinator-qualification.cjs').verifyRuntime(project, process.env.TRELLIS_REDESIGN_SOURCE_ROOT); // NEW: qualification never measures a different checkout silently.
    if (process.argv.includes('--saving-redesign')) { // NEW: bounded transport timing excludes headers, bodies, and query strings.
        const originalFetch = globalThis.fetch; let samples = 0; // NEW
        globalThis.fetch = async function (url, options) { const started = performance.now(); try { return await originalFetch.apply(this, arguments); } catch (error) { if (samples++ < 32) console.log('CLUSTER_STAGE: local transport failure ' + JSON.stringify({ endpoint: new URL(url).pathname, elapsed: Math.round(performance.now() - started), reason: error.message })); throw error; } }; // NEW
    } // NEW
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => callback({ cancel: true })); // NEW
    responsiveness?.install(); // CHANGE: install source comparisons and main-process observers before importing production services.
    let applicationEntry = responsiveness?.entry || path.join(project, 'src/main/electron.js'); // CHANGE
    if (process.argv.includes('--saving-redesign') && process.env.TRELLIS_REDESIGN_PROTOCOL === '4') { // NEW: seed historical-format registrations using the same isolated-copy mechanics as responsiveness tests.
        const main = path.join(project, 'src/main'), staged = path.join(project, '.test-artifacts/saving-redesign/legacy-application-' + process.pid, 'main'); fs.mkdirSync(staged, { recursive: true }); fs.cpSync(main, staged, { recursive: true }); // NEW
        for (const name of fs.readdirSync(staged).filter(name => name.endsWith('.js'))) { // NEW
            const filename = path.join(staged, name), source = fs.readFileSync(filename, 'utf8'); // NEW
            fs.writeFileSync(filename, source.replace(/(['"])(\.\.\/\.\.\/drawio\/[^'"]+)\1/g, (_match, _quote, relative) => JSON.stringify(pathToFileURL(path.resolve(main, relative)).href))); // NEW
        } // NEW
        const library = path.join(staged, 'trellis-garden-library-service.js'); fs.writeFileSync(library, fs.readFileSync(library, 'utf8').replaceAll('protocolVersion: SYNC_PROTOCOL.newGarden', 'protocolVersion: SYNC_PROTOCOL.garden')); // NEW: only fixture creation chooses the historical format; edit/permission/save modules are exact copies.
        applicationEntry = path.join(staged, 'electron.js'); fs.writeFileSync(applicationEntry, fs.readFileSync(applicationEntry, 'utf8').replace('const __dirname = path.dirname(url.fileURLToPath(import.meta.url));', 'const __dirname = ' + JSON.stringify(main) + ';').replace("'./trellis-asset-scheme.cjs'", JSON.stringify(pathToFileURL(path.join(main, 'trellis-asset-scheme.cjs')).href))); // NEW: native assets retain their production locations without replacing Electron's module loader.
    } // NEW
    await import(pathToFileURL(applicationEntry)); // CHANGE
    await until(async () => !!win, 'application window'); // NEW
    const run = script => win.webContents.executeJavaScript(script); // NEW
    await until(() => run('!!window.Draw?.loadPlugin && !!window.TrellisGardenHome').catch(() => false), 'plugin loader'); // NEW
    await run('new Promise(resolve=>Draw.loadPlugin(ui=>{window.smokeUi=ui;const loaded=ui.fileLoaded;ui.fileLoaded=function(){const result=loaded.apply(this,arguments);Promise.resolve(result).then(()=>{window.clusterInitialFileLoaded=true});return result;};resolve();}));'); // CHANGE // NEW
    await until(() => run('!!window.clusterInitialFileLoaded && !smokeUi.openingFile'), 'initial file load'); // CHANGE: plugin installation precedes asynchronous startup; do not request a garden while the editor is busy.
    await run(`localStorage.setItem('trellis.licenseWizard.v2',JSON.stringify({version:'2',path:'personal',contactGuidance:false,oathCompletedAt:new Date().toISOString(),name:'Cluster Test',signature:'Cluster Test',email:'test@example.test'}));smokeUi.hideDialog();`); // NEW
    stage='test identity';console.log('PRODUCTION_STAGE:',stage); // NEW
    await run(`trellisIdentity.create({username:'Cluster benchmark',password:'local-test-password'})`); // NEW
    if (responsiveness) { await responsiveness.run({ win, run, profile, until }); finish(0); return; } // CHANGE
    stage='test garden creation';console.log('PRODUCTION_STAGE:',stage); // NEW
    await run(`(async()=>{window.sample=await trellisGardenLibrary.create({name:'Cluster benchmark'});})()`); // NEW
    stage='test garden opening';console.log('PRODUCTION_STAGE:',stage); // NEW
    await run(`TrellisGardenHome.openPath(smokeUi,sample.path).then(opened=>{if(!opened)throw Error('Fixture garden open refused: '+JSON.stringify({opening:smokeUi.openingFile,creating:smokeUi.__trellisGardenCreating,openingGarden:smokeUi.__trellisGardenOpening}));return true;})`); // CHANGE // NEW
    await until(() => run('!!smokeUi.editor.graph.__trellisModules?.clusters && !!smokeUi.getCurrentFile()'), 'opened test garden'); // NEW
    await run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))'); // NEW
    if (rendererErrors.length) throw Error('Production plugin startup failed: ' + rendererErrors.join('\n')); // NEW: a broken plugin set cannot provide an acceptance benchmark.
    await run(` // NEW
        window.graph=smokeUi.editor.graph;window.clusters=graph.__trellisModules.clusters;window.undo=smokeUi.editor.undoManager; // NEW
        window.frames=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))); // NEW
        window.valueDocument=mxUtils.createXmlDocument(); // NEW
        window.value=attrs=>{const node=valueDocument.createElement('object');Object.entries(attrs).forEach(([key,text])=>node.setAttribute(key,String(text)));return node;}; // NEW
        window.write=(cell,attrs)=>{const node=cell.value.cloneNode(true);Object.entries(attrs).forEach(([key,text])=>node.setAttribute(key,String(text)));graph.model.setValue(cell,node);}; // NEW
        void 0; // NEW
    `); // NEW
    if (process.argv.includes('--saving-redesign')) { await require('./saving-redesign-production.cjs')({ run, win, project, profile }); if (process.env.TRELLIS_REDESIGN_SOURCE_ROOT) require('../../scripts/check-coordinator-qualification.cjs').verifyRuntime(project, process.env.TRELLIS_REDESIGN_SOURCE_ROOT); finish(0); return; } // CHANGE: incident copies are exercised only in the test-owned identity/profile.
    if (process.argv.includes('--creation-regression')) { await require('./module-creation-production.cjs')({ run, win, project }); finish(0); return; } // CHANGE
    await run(fs.readFileSync(path.join(__dirname, 'module-cluster-fixture.js'), 'utf8')); // NEW
    const count = Number(process.env.TRELLIS_CLUSTER_COUNT || 5000); // NEW
    stage = 'production benchmark'; // NEW
    win.webContents.debugger.attach('1.3'); await win.webContents.debugger.sendCommand('Profiler.enable'); await win.webContents.debugger.sendCommand('Profiler.start'); // NEW
    profileTimer=setInterval(async()=>{ // NEW: retain bounded diagnostic evidence even if a production listener stalls validation.
        if(profileBusy||closing)return;profileBusy=true; // NEW
        try{const {profile}=await win.webContents.debugger.sendCommand('Profiler.stop');fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,'production-'+(++profileNumber)+'.cpuprofile'),JSON.stringify(profile));await win.webContents.debugger.sendCommand('Profiler.start');console.log('PRODUCTION_PROFILE:',profileNumber);}catch(error){console.error('Profile:',error.message);}finally{profileBusy=false;} // NEW
    },30000); // NEW
    const result = await run('benchmarkFixture(' + count + ',true,10)'); // NEW
    clearInterval(profileTimer);while(profileBusy)await new Promise(resolve=>setTimeout(resolve,50)); // NEW
    const { profile: cpuProfile } = await win.webContents.debugger.sendCommand('Profiler.stop'); // NEW
    fs.mkdirSync(output, { recursive: true }); fs.writeFileSync(path.join(output, 'production.cpuprofile'), JSON.stringify(cpuProfile)); // NEW
    stage = 'saving test garden'; // NEW
    const start = Date.now(); // NEW
    await run('new Promise((resolve,reject)=>smokeUi.getCurrentFile().save(false,resolve,reject))'); // NEW
    result.diskSaveMs = Date.now() - start; // NEW
    result.renderer = 'production application, software rendering, private profile'; // NEW
    fs.writeFileSync(path.join(output, 'production.json'), JSON.stringify(result, null, 2)); // NEW
    console.log('PRODUCTION_BENCHMARK:', JSON.stringify({ ...result, snapshot: { ...result.snapshot, rendered: result.snapshot.rendered.length } })); // NEW
    finish(0); // NEW
}).catch(error => { console.error(error.stack || error); finish(1); }); // NEW

