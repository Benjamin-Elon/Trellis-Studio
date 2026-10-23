/** Load the real application and plugin set against a private local garden. */ // NEW
const fs = require('node:fs'); // NEW
const path = require('node:path'); // NEW
const os = require('node:os'); // NEW
const { pathToFileURL } = require('node:url'); // NEW
const childProcess = require('node:child_process'), { syncBuiltinESMExports } = require('node:module'); // NEW
const ownedChildren = new Set(), originalSpawn = childProcess.spawn; // NEW
childProcess.spawn = (...args) => { const child = originalSpawn(...args); ownedChildren.add(child); child.once('exit', () => ownedChildren.delete(child)); return child; }; syncBuiltinESMExports(); // NEW
const { app, dialog, session } = require('electron'); // NEW
const project = process.env.TRELLIS_RESPONSIVENESS_PROJECT || path.resolve(__dirname, '../..'); // CHANGE: frozen helpers retain the application resource root.
const responsiveness = process.argv.includes('--responsiveness') ? require('./small-diagram-responsiveness.cjs')({ project, app, session }) : null; // CHANGE: opt-in production timing matrix, separate from CPU profiling.
const output = path.join(project, '.test-artifacts/module-clusters'); // NEW
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'trellis-clusters-production-')); // NEW
for (const name of ['app-data', 'documents', 'session', 'user-data']) fs.mkdirSync(path.join(profile, name), { recursive: true }); // NEW
app.setPath('appData', path.join(profile, 'app-data')); app.setPath('documents', path.join(profile, 'documents')); // NEW
app.setPath('userData', path.join(profile, 'user-data')); app.setPath('sessionData', path.join(profile, 'session')); // NEW
app.disableHardwareAcceleration(); app.commandLine.appendSwitch('in-process-gpu'); // NEW
app.commandLine.appendSwitch('disable-renderer-backgrounding'); // NEW
app.commandLine.appendSwitch('disable-background-timer-throttling'); // NEW
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion,IntensiveWakeUpThrottling'); // NEW
app.commandLine.appendSwitch('js-flags', '--expose-gc'); // NEW
let win, stage = 'startup', closing = false; const rendererErrors = []; // NEW
app.on('browser-window-created', (_event, created) => { // NEW
    win = created; created.hide(); created.webContents.setBackgroundThrottling(false); // NEW
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
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => callback({ cancel: true })); // NEW
    responsiveness?.install(); // CHANGE: install source comparisons and main-process observers before importing production services.
    await import(pathToFileURL(responsiveness?.entry || path.join(project, 'src/main/electron.js'))); // CHANGE
    await until(async () => !!win, 'application window'); // NEW
    const run = script => win.webContents.executeJavaScript(script); // NEW
    await until(() => run('!!window.Draw?.loadPlugin && !!window.TrellisGardenHome').catch(() => false), 'plugin loader'); // NEW
    await run('new Promise(resolve=>Draw.loadPlugin(ui=>{window.smokeUi=ui;resolve();}));'); // NEW
    await run(`localStorage.setItem('trellis.licenseWizard.v2',JSON.stringify({version:'2',path:'personal',contactGuidance:false,oathCompletedAt:new Date().toISOString(),name:'Cluster Test',signature:'Cluster Test',email:'test@example.test'}));smokeUi.hideDialog();`); // NEW
    stage='test identity';console.log('PRODUCTION_STAGE:',stage); // NEW
    await run(`trellisIdentity.create({username:'Cluster benchmark',password:'local-test-password'})`); // NEW
    if (responsiveness) { await responsiveness.run({ win, run, profile, until }); finish(0); return; } // CHANGE
    stage='test garden creation';console.log('PRODUCTION_STAGE:',stage); // NEW
    await run(`(async()=>{window.sample=await trellisGardenLibrary.create({name:'Cluster benchmark'});})()`); // NEW
    stage='test garden opening';console.log('PRODUCTION_STAGE:',stage); // NEW
    await run(`TrellisGardenHome.openPath(smokeUi,sample.path)`); // NEW
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

