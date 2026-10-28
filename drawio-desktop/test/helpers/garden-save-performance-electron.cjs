/** Native production components in an isolated profile; excludes mail handlers and live transport. */ // NEW
const { app, BrowserWindow, ipcMain } = require('electron'); // NEW
const fs = require('node:fs/promises'), syncFs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto'); // NEW
const { pathToFileURL } = require('node:url'), { execFileSync } = require('node:child_process'); // NEW
const parser = require('@babel/parser'), traverse = require('@babel/traverse').default, assert = require('node:assert/strict'); // NEW
const project = process.env.TRELLIS_SAVE_PROJECT || path.resolve(__dirname, '../..'), webapp = path.join(project, 'drawio/src/main/webapp'); // NEW
const baseline = process.argv.includes('--baseline'), smoke = process.argv.includes('--smoke'), stress = process.argv.includes('--stress'); // NEW
const badgeOnly = process.argv.includes('--badges'); // NEW: renderer latency is measured independently from save execution and network delivery.
const stallContent = badgeOnly && process.argv.includes('--stall-content'); // NEW
let blockContent = false, releaseContent, enteredContent; const checkpointAttempts = []; // NEW: bounded diagnostics record timing only, never recovery contents.
const requestedMode = process.argv.find(arg => arg.startsWith('--mode='))?.slice(7); // NEW
if (requestedMode && !['local','private','shared'].includes(requestedMode)) throw new Error('Invalid benchmark mode.'); // NEW
const sampleCount = smoke ? 1 : 30, recordCount = process.argv.includes('--fresh') ? 0 : stress ? 10000 : 1000; // CHANGE: measure genuinely new projects separately from accumulated journal history.
const output = process.env.TRELLIS_SAVE_OUTPUT || path.join(project, '.test-artifacts/save-performance'), frozen = process.env.TRELLIS_SAVE_SOURCE_ROOT; // CHANGE
const sourceInput = frozen ? path.join(frozen, 'main') : baseline ? path.join(output, 'baseline/main') : path.join(project, 'src/main'); // NEW
const sources = path.join(output, 'runtime-' + process.pid); // NEW: imports are relocated in a disposable copy, never in frozen sources. // NEW
const profile = syncFs.mkdtempSync(path.join(os.tmpdir(), 'trellis-save-performance-')); app.setPath('userData', path.join(profile, 'browser')); // NEW
syncFs.writeFileSync(path.join(profile,'owner.json'),JSON.stringify({pid:process.pid,script:__filename})); // NEW
app.on('window-all-closed', () => {}); // NEW: serial cases own app shutdown, including failure reporting.
app.disableHardwareAcceleration(); app.commandLine.appendSwitch('in-process-gpu'); // NEW
let window, journal, activity, drafts, createActivity, createDrafts, transactions, canvas, protocol, timings = [], started = Date.now(), exitCode = 1; // CHANGE
const report = { baseline, smoke, stress, sampleCount, recordCount, complete: false, accepted: false, cases: [], stages: [], hardware: { platform: process.platform, arch: process.arch, cpu: os.cpus()[0]?.model, cores: os.cpus().length, memoryBytes: os.totalmem(), electron: process.versions.electron }, profile, pid: process.pid, sourceRoot: frozen || sourceInput, sourceRevision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: project, encoding: 'utf8', windowsHide: true }).trim() }; // NEW
const target = process.env.TRELLIS_SAVE_REPORT || path.join(output, `${baseline ? 'before' : 'after'}-${stress ? 'stress-' : ''}${Date.now()}.json`); // CHANGE
const persist = async () => { await fs.mkdir(output, { recursive: true }); await fs.writeFile(target, JSON.stringify(report, null, 2)); }; // NEW
const writeAtomic = async (filename, contents) => { const start = performance.now(); await fs.mkdir(path.dirname(filename), { recursive: true }); const temporary = filename + '.' + crypto.randomUUID() + '.tmp'; await fs.writeFile(temporary, contents); for (let attempt = 0; ; attempt++) { try { await fs.rename(temporary, filename); break; } catch (error) { if (!['EPERM', 'EBUSY', 'EACCES'].includes(error.code) || attempt >= 4) throw error; await new Promise(resolve => setTimeout(resolve, 25 * (attempt + 1))); } } timings.push({ phase: 'disk write', durationMs: performance.now() - start, bytes: Buffer.byteLength(contents) }); }; // CHANGE: use the production Windows retry policy for native diagnostics.
const writeImmutable = async (filename, record) => { await fs.mkdir(path.dirname(filename), { recursive: true }); await fs.writeFile(filename, JSON.stringify(record), { flag: 'wx' }); }; // NEW
const evaluate = async code => { let timer; try { return await Promise.race([window.webContents.executeJavaScript(code, true), new Promise((_resolve,reject)=>{timer=setTimeout(()=>reject(new Error('Renderer did not settle: '+code.slice(0,120))),120000)})]); } finally {clearTimeout(timer)} }; // CHANGE
function extract(source, name) { // NEW
    let found; traverse(parser.parse(source, { sourceType: 'unambiguous' }), { noScope: true, FunctionDeclaration(entry) { if (entry.node.id?.name === name) found = source.slice(entry.node.start, entry.node.end); } }); // NEW
    assert.ok(found, name); return found; // NEW
} // NEW
async function seed(xml, keys) { // NEW
    const { objects } = await import(pathToFileURL(path.join(sources, 'trellis-collaboration-protocol.js'))); // NEW
    const { XMLSerializer } = require('@xmldom/xmldom'), cell = objects(xml).get('["page-a","a"]'); let priorHash = cell.hash, parent = null; // NEW
    for (let index = 0; index < recordCount; index++) { // NEW
        const group = Math.floor(index / 50), position = index % 50, id = 'seed-' + index; // NEW
        const record = { schema: 3, shareId: canvas.shareId, diagramId: canvas.diagramId, deviceId: canvas.members.length > 1 ? 'peer' : 'device', userId: 'alice', sessionId: 'seed-session', id, kind: 'view', clock: index + 1, at: started, parents: parent ? [parent] : [], targets: [] }; // NEW
        if (position === 0) { record.kind = 'claim'; record.targets = [cell.key]; } // NEW
        if (position === 1) { // NEW
            const node = cell.node.cloneNode(true); node.setAttribute('label', group === recordCount / 50 - 1 ? 'A0' : 'Historical ' + group); // NEW
            const content = new XMLSerializer().serializeToString(node); // NEW
            const next = objects('<mxfile><diagram id="page-a"><mxGraphModel><root>' + content + '</root></mxGraphModel></diagram></mxfile>').get(cell.key); // NEW
            Object.assign(record, { kind: 'edit', targets: [cell.key], changes: [{ key: cell.key, before: priorHash, xml: content }], claimIds: ['seed-' + (index - 1)] }); priorHash = next.hash; // NEW
        } // NEW
        if (position === 2) { record.kind = 'release'; record.targets = [cell.key]; } // NEW
        await writeImmutable(path.join(canvas.folderPath, '.trellis/collaboration-v3/records', id + '.json'), protocol.signRecord(record, keys.privateKey)); parent = id; // NEW
    } // NEW
} // NEW
async function runCase(mode, keys, createStore, nativeMethods, inviteFunction) { // NEW
    timings = []; const directory = path.join(profile, mode); await fs.mkdir(directory, { recursive: true }); // NEW
    canvas = { protocolVersion: 3, shareId: 'benchmark-' + mode, diagramId: 'save-diagram', filename: 'Garden.drawio', folderId: 'fixture', folderPath: directory, diagramPath: path.join(directory, 'Garden.drawio'), coordinatorDeviceId: 'device', coordinatorPublicKey: keys.publicKey, members: [{ deviceId: 'device', publicKey: keys.publicKey, userId: 'alice' }], membershipVersion: 1 }; // NEW
    console.log('SAVE_STAGE', mode, 'browser'); // NEW
    if (mode === 'shared' || badgeOnly) canvas.members.push({ deviceId: 'peer', publicKey: keys.publicKey, userId: 'alice' }); // CHANGE
    window = new BrowserWindow({ show: false, width: 1000, height: 720, webPreferences: { nodeIntegration: true, contextIsolation: false, backgroundThrottling: false, offscreen: badgeOnly } }); // CHANGE: offscreen rendering produces frames in the hidden badge fixture.
    window.webContents.on('console-message',(_event,...details)=>console.log('RENDERER',...details.filter(value=>typeof value==='string'||typeof value==='number'))); // NEW
    const html = path.join(directory, 'fixture.html'); await fs.writeFile(html, '<!doctype html><body><div id="graph" style="width:950px;height:650px;overflow:auto"></div></body>'); await window.loadFile(html); // NEW
    console.log('SAVE_STAGE', mode, 'loaded'); // NEW
    await evaluate('window.mxLoadResources=false;window.mxLoadStylesheets=false;window.urlParams={};'); await evaluate(await fs.readFile(frozen ? path.join(frozen, 'browser-js/app.min.js') : path.join(webapp, 'js/app.min.js'), 'utf8')); // NEW
    console.log('SAVE_STAGE', mode, 'core'); // NEW
    await evaluate(` // NEW
        window.graph=new Graph(document.getElementById('graph'));window.editor=new mxEventSource();Object.setPrototypeOf(editor,Editor.prototype);editor.graph=graph;editor.undoManager=new mxUndoManager(); // NEW
        window.statuses=[];window.rendererTimings=[];window.TrellisSyncTiming=value=>rendererTimings.push(value);editor.setStatus=message=>statuses.push(message);editor.autosave=false;editor.isChromelessView=()=>false; // NEW
        const doc=mxUtils.createXmlDocument(), metadata=doc.createElement('object');metadata.setAttribute('trellis_history_id','save-diagram');metadata.setAttribute('trellis_users_json',JSON.stringify({usersEnabled:true,users:[{id:'alice',name:'Alice',admin:true}],pendingUsers:[{id:'guest',email:'guest@example.org'}],invites:[{id:'invite',createdBy:'alice',email:'guest@example.org',pendingUserId:'guest',scopeCellIds:['a'],codeSalt:'fixture-salt',codeHash:${JSON.stringify(protocol.inviteFingerprint('CODE','fixture-salt'))},status:'pending',expiresAt:Date.now()+86400000}]}));graph.model.setValue(graph.getDefaultParent(),metadata); // NEW
        window.a=graph.insertVertex(null,'a','A0',10,10,100,50);const value=doc.createElement('object');value.setAttribute('label','A0');graph.model.setValue(a,value); // NEW
        graph.model.beginUpdate();try{for(let i=0;i<100;i++){const value=doc.createElement('object');value.setAttribute('label','Garden '+i);value.setAttribute('notes','garden planning '.repeat(1350));graph.insertVertex(null,'bulk-'+i,value,i%10*110,100+Math.floor(i/10)*60,100,50);}}finally{graph.model.endUpdate();} // NEW
        const page=new DiagramPage(mxUtils.parseXml('<diagram id="page-a" name="Garden"/>').documentElement);page.root=graph.model.root;page.viewState={}; // NEW
        window.ui=Object.create(EditorUi.prototype);Object.assign(ui,{editor,pages:[page],currentPage:page,fileNode:mxUtils.parseXml('<mxfile compressed="false"/>').documentElement,getCurrentFile:()=>window.current,watchFile:async()=>{},handleFileChange(){},menus:{get:()=>null},actions:{addAction(name,fn){return {funct:fn}}},getXmlFileData(){const doc=mxUtils.createXmlDocument(),file=doc.createElement('mxfile'),diagram=doc.createElement('diagram');diagram.setAttribute('id','page-a');diagram.setAttribute('name','Garden');diagram.appendChild(new mxCodec(doc).encode(graph.model));file.appendChild(diagram);return file},getFileData(){return mxUtils.getXml(this.getXmlFileData())}}); // NEW
        console.log('SAVE_RENDER_STAGE','graph-ready');window.current=new LocalFile(ui,'','Garden.drawio',false,null,null,true);console.log('SAVE_RENDER_STAGE','file-ready');current.fileObject={path:${JSON.stringify(canvas.diagramPath)},name:'Garden.drawio'};current.data=ui.getFileData();current.isAutosave=()=>false;current.isAutosaveOptional=()=>true; // NEW
        current.contentChanged=function(){};current.addToRecent=function(){};current.removeDraft=function(){}; // NEW: isolate automatic timer scheduling while exercising the production save methods.
        graph.model.addListener(mxEvent.CHANGE,()=>{if(!graph.__trellisSharingApplying)current.setModified(true)}); // NEW
        console.log('SAVE_RENDER_STAGE','metadata-ready');const {ipcRenderer}=require('electron');window.electron={request:(input,done,error)=>ipcRenderer.invoke('save-performance-native',input).then(done,error)};window.autoSaveEnabled=false; // NEW
        window.Trellis={users:{getCurrentUser:()=>({id:'alice'}),revalidateCurrentSession(){}}};window.Draw={loadPlugin:fn=>fn(ui)}; // NEW
        window.trellisShare={setContext:async()=>{},getStatus:async()=>({canvases:${mode === 'local' ? '[]' : "[{diagramPath:current.fileObject.path,state:'upToDate'}]"}}),getSyncthingShareInfo:async()=>(${JSON.stringify({ ...canvas, ok: true, managed: mode !== 'local' })}),collaborationAction:input=>ipcRenderer.invoke('save-performance-action',input),activityAction:input=>ipcRenderer.invoke('save-performance-activity-action',input),recoveryAction:input=>ipcRenderer.invoke('save-performance-recovery',input),onActivity:listener=>{const receive=(_event,data)=>listener(data);ipcRenderer.on('save-performance-activity',receive);return ()=>ipcRenderer.removeListener('save-performance-activity',receive)},createInviteBlock:input=>ipcRenderer.invoke('save-performance-invite',input),onStatus:()=>()=>{},importHistory:async()=>({entries:[]})}; // NEW
        window.editFixture=()=>{const next=a.value.cloneNode(true);next.setAttribute('label','Edit '+Date.now()+' '+Math.random());graph.model.setValue(a,next)}; // NEW
        window.inviteFixture=()=>{const parent=graph.getDefaultParent(),next=parent.value.cloneNode(true),store=JSON.parse(next.getAttribute('trellis_users_json'));store.invites[0].expiresAt=Date.now()+86400000;next.setAttribute('trellis_users_json',JSON.stringify(store));graph.model.setValue(parent,next)}; // NEW: preparation must commit invitation metadata, not an unrelated garden edit.
        void 0; // NEW: executeJavaScript must not attempt to serialize the last function assignment.
    `); // NEW
    console.log('SAVE_STAGE', mode, 'graph'); // NEW
    for (const [name, source] of nativeMethods) await evaluate(`LocalFile.prototype.${name}=(${source});void 0;`); // NEW
    console.log('SAVE_STAGE', mode, 'native'); // NEW
    const xml = await evaluate('current.data'); await writeAtomic(canvas.diagramPath, xml); // NEW
    const contentGate = new Promise(resolve => { releaseContent = resolve; }); // NEW
    journal = mode === 'local' ? null : createStore({ canvas, deviceId: 'device', keys, profile: path.join(directory, 'private'), writeAtomic, writeImmutable, prepareXml: async content => protocol.inspectDiagram(content).document.serialize(), onTiming: sample => timings.push(sample), replayWorker: stallContent ? async (xml, records, time) => { if (blockContent) { enteredContent?.(); await contentGate; } return transactions.replay(xml, records, time); } : undefined }); // CHANGE
    if (journal) { await journal.initialize(xml); await seed(xml, keys); activity = createActivity({ canvas, deviceId: 'device', keys, sessionFor: journal.sessionFor, writeAtomic, authorize: user => user === 'alice', onChange: () => { if (window && !window.isDestroyed()) window.webContents.send('save-performance-activity', { shareId: canvas.shareId, diagramPath: canvas.diagramPath, collaboration: activity.snapshot(journal.sessionFor(1, 'alice')) }); } }); drafts = createDrafts({ profile: path.join(directory, 'private'), canvas, writeAtomic }); } // NEW
    console.log('SAVE_STAGE', mode, 'seeded'); // NEW
    const coldStart = performance.now(); // NEW
    for (const file of ['js/trellis-local-view.js', 'js/trellis-incoming-changes.js', 'js/trellis-background-saving.js']) await evaluate(await fs.readFile(frozen ? path.join(frozen, 'browser-js', file.slice(3)) : path.join(webapp, file), 'utf8')); // NEW
    const plugin = frozen ? path.join(frozen, 'plugins/Trellis_Syncthing.js') : baseline ? path.join(output, 'baseline/plugins/Trellis_Syncthing.js') : path.join(webapp, 'plugins/garden_planner_plugins/Trellis_Syncthing.js'); await evaluate(await fs.readFile(plugin, 'utf8')); // NEW
    if (journal) await evaluate('Trellis.sharing.refresh()'); // NEW
    const result = { mode, configuredPeers: mode === 'shared' ? 1 : 0, bytes: Buffer.byteLength(xml), records: journal ? recordCount : 0, coldMs: performance.now() - coldStart, samples: {}, p95: {}, timings }; // NEW
    console.log('SAVE_STAGE', mode, 'ready'); // NEW
    report.cases.push(result); await persist(); // NEW
    if (badgeOnly) { // NEW
        assert.ok(activity, 'Badge diagnostics require a managed project.'); // NEW
        const peer = createActivity({ canvas, deviceId: 'peer', keys, sessionFor: () => 'peer-window', writeAtomic, authorize: user => user === 'alice' }); // NEW
        try { // NEW
            let stalledAt; if (stallContent) { const entered = new Promise(resolve => { enteredContent = resolve; }); blockContent = true; await evaluate('editFixture();window.stalledSave=new Promise((resolve,reject)=>current.save(false,resolve,reject));void 0'); await entered; stalledAt = performance.now(); } // NEW
            await peer.action(2, 'alice', { kind: 'claim', targets: ['["page-a","bulk-1"]'] }); await activity.scan(); // NEW
            await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))'); await evaluate('rendererTimings.length=0;void 0'); // NEW
            for (let index = 0; index < 30; index++) { // NEW
                await evaluate('editFixture();void 0'); // NEW
                await peer.action(2, 'alice', { kind: 'publish', revision: index + 1, objects: [JSON.stringify(['page-a', 'bulk-' + (index % 2 + 1)])], pending: ['["page-a","bulk-1"]'], saveState: 'pending' }); await activity.scan(); // CHANGE
                await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))'); // NEW
                if (stallContent) await new Promise(resolve => setTimeout(resolve, 2000)); // NEW: sixty real seconds with content replay held, not a simulated timer.
            } // NEW
            result.badges = {}; const observations = await evaluate('rendererTimings'); // NEW
            for (const phase of ['pending badge', 'pending badge paint', 'activity render', 'activity paint']) { const samples = observations.filter(sample => sample.phase === phase).map(sample => sample.durationMs).sort((a,b)=>a-b); assert.ok(samples.length >= 30, phase + ' requires thirty observations.'); const p95 = samples[Math.ceil(samples.length * .95) - 1]; result.badges[phase] = { samples: samples.length, p95 }; assert.ok(p95 <= 100, phase + ' exceeded 100 ms p95: ' + p95); } // NEW
            await fs.writeFile(path.join(output, 'status-v3-badges.png'), (await window.webContents.capturePage()).toPNG()); // NEW
            if (stallContent) { result.stall = { durationMs: performance.now() - stalledAt, checkpointAttempts: checkpointAttempts.filter(at => at >= stalledAt).length }; assert.ok(result.stall.durationMs >= 60000); assert.ok(result.stall.checkpointAttempts >= 5, 'Recovery must continue every ten seconds during the stalled save.'); blockContent = false; releaseContent(); await evaluate('stalledSave'); assert.equal(await evaluate('current.isModified()'), true, 'An older completion must retain newer pending edits.'); } // NEW
        } finally { blockContent = false; releaseContent(); await peer.close(); } // CHANGE
    } // NEW
    const operations = badgeOnly ? [] : journal ? ['manual', 'autosave', 'overlap', 'unchanged', 'invitation'] : ['manual', 'autosave', 'overlap', 'unchanged']; // CHANGE
    for (const operation of operations) { // NEW
        result.samples[operation] = []; // NEW
        for (let index = 0; index < sampleCount; index++) { // NEW
            const duration = await evaluate(`(async()=>{const start=performance.now();${operation === 'unchanged' ? '' : operation === 'invitation' ? 'inviteFixture();' : 'editFixture();'}const save=()=>new Promise((resolve,reject)=>current.save(false,resolve,reject));${operation === 'invitation' ? "const draft=await Trellis.sharing.prepareInvite({invite:{id:'invite'},code:'CODE',emailDraft:{to:'guest@example.org',subject:'Invitation',body:'Join the garden'}});if(!draft.body.includes('TRELLIS'))throw Error('Incomplete invitation');" : operation === 'overlap' ? 'await Promise.all([save(),save(),save()]);' : 'await save();'}return performance.now()-start})()`); // NEW
            result.samples[operation].push(duration); await persist(); // NEW
        } // NEW
        result.p95[operation] = result.samples[operation].slice().sort((a,b)=>a-b)[Math.ceil(sampleCount*.95)-1]; console.log(mode, operation, result.p95[operation].toFixed(1)); // NEW
    } // NEW
    result.timings = timings; result.rendererTimings = await evaluate('rendererTimings'); result.statuses = await evaluate('statuses'); await activity?.close(); activity = null; drafts = null; window.destroy(); window = null; await persist(); // NEW
} // NEW
app.whenReady().then(async () => { // NEW
    const watchdog = setTimeout(() => { report.error = 'Benchmark watchdog expired'; void persist().finally(() => app.exit(1)); }, 45 * 60 * 1000); // NEW
    try { // NEW
        await fs.cp(sourceInput, sources, { recursive: true }); // NEW
        for (const name of await fs.readdir(sources)) if (name.endsWith('.js')) { const filename = path.join(sources, name), source = await fs.readFile(filename, 'utf8'); await fs.writeFile(filename, source.replace(/(['"])(\.\.\/\.\.\/drawio\/[^'"]+)\1/g, (_match, _quote, relative) => JSON.stringify(pathToFileURL(frozen && path.resolve(project, 'src/main', relative).startsWith(path.join(webapp,'js') + path.sep) ? path.join(frozen,'browser-js',path.relative(path.join(webapp,'js'),path.resolve(project,'src/main',relative))) : path.resolve(project, 'src/main', relative)).href))); } // NEW
        protocol = await import(pathToFileURL(path.join(sources, 'trellis-share-protocol.js'))); const { createCollaborationStore } = await import(pathToFileURL(path.join(sources, 'trellis-collaboration-store.js'))); // NEW
        transactions = await import(pathToFileURL(path.join(sources, 'trellis-collaboration-protocol.js'))); ({ createActivityService: createActivity } = await import(pathToFileURL(path.join(sources, 'trellis-activity-service.js')))); ({ createDraftStore: createDrafts } = await import(pathToFileURL(path.join(sources, 'trellis-draft-store.js')))); // NEW
        const pair = crypto.generateKeyPairSync('ed25519'), keys = { publicKey: pair.publicKey.export({ type: 'spki', format: 'pem' }), privateKey: pair.privateKey }; // NEW
        const desktop = await fs.readFile(frozen ? path.join(frozen, 'browser-js/diagramly/ElectronApp.js') : path.join(webapp, 'js/diagramly/ElectronApp.js'), 'utf8'), nativeMethods = new Map(); // NEW
        traverse(parser.parse(desktop), { noScope: true, AssignmentExpression(entry) { if (/^LocalFile\.prototype\.(save|saveFile|saveAs)$/.test(desktop.slice(entry.node.left.start, entry.node.left.end))) nativeMethods.set(entry.node.left.property.name, desktop.slice(entry.node.right.start, entry.node.right.end)); } }); // NEW
        const inviteSource = extract(await fs.readFile(path.join(sources, 'trellis-syncthing-service.js'), 'utf8'), 'createInviteBlock'); // NEW
        const inviteFunction = new Function('canvasById','authorizeCanvas','canvasState','activeAdmin','inviteFingerprint','now','encodeBlock','deviceId', 'return (' + inviteSource + ')')((id) => { assert.equal(id, canvas.shareId); return canvas; }, () => ({ userId: 'alice' }), async () => protocol.inspectDiagram(await fs.readFile(canvas.diagramPath, 'utf8')), protocol.activeAdmin, protocol.inviteFingerprint, Date.now, protocol.encodeBlock, 'device'); // NEW
        ipcMain.handle('save-performance-action', async (_event, input) => { if (['claim', 'view', 'request', 'release'].includes(input.kind)) return activity.action(1, 'alice', { ...input, targets: input.targets || (input.xml ? transactions.diffObjects(input.baseXml, input.xml).targets : []) }); const { claimIds, ...content } = input; const result = await journal.action(1, 'alice', content); if (result.collaboration) result.collaboration = { ...result.collaboration, ...activity.snapshot(journal.sessionFor(1, 'alice')) }; return result; }); // CHANGE: mirror the production adapter, including activity enrichment of content responses.
        ipcMain.handle('save-performance-activity-action', (_event, input) => activity.action(1, 'alice', input)); // NEW
        ipcMain.handle('save-performance-recovery', (_event, input) => { if (input.kind === 'restore') return drafts.restore('alice'); checkpointAttempts.push(performance.now()); return drafts.checkpoint('alice', journal.sessionFor(1, 'alice'), input); }); // CHANGE
        ipcMain.handle('save-performance-invite', (_event, input) => inviteFunction(1, input)); // NEW
        ipcMain.handle('save-performance-native', async (_event, input) => { if (input.action === 'saveFile') await writeAtomic(input.fileObject.path, input.data); return { mtimeMs: Date.now() }; }); // NEW
        for (const mode of requestedMode ? [requestedMode] : stress || badgeOnly ? ['private'] : ['local', 'private', 'shared']) await runCase(mode, keys, createCollaborationStore, nativeMethods, inviteFunction); // CHANGE
        report.complete = true; report.badgeOnly = badgeOnly; report.accepted = !badgeOnly && !smoke && !stress && report.cases.every(result => Object.values(result.p95).every(value => value <= 5000)); // CHANGE
        report.notes = ['Native Graph, desktop save functions, sharing renderer, journal store and invitation-block function; isolated IPC/profile boundaries.', 'Shared is an approved-peer component fixture; live Syncthing transport, full plugin startup, external mail and rendering responsiveness are covered separately.', 'Invitation samples mutate native pending-invitation metadata before preparation; the Users form and its initial in-memory creation are tested separately.', 'Autosave measures the production save(false) execution after its timer fires; timer debounce is excluded.', 'XML has 100 garden objects with notes; journal mixes 20 edits, claims, releases and viewing records per 1000 initial records.']; // NEW
        await persist(); console.log('REPORT', target); exitCode = report.complete && (badgeOnly || smoke || stress || report.accepted) ? 0 : 1; // CHANGE
    } catch (error) { console.error('SAVE_FAILURE',error); report.error = error.stack; await persist(); if (window) { try { report.statuses = await evaluate('statuses'); } catch (_) {} window.destroy(); } await persist(); console.error(error); exitCode = 1; } // NEW
    finally { clearTimeout(watchdog); app.exit(exitCode); } // CHANGE: parent runner removes the isolated Chromium profile after process exit. // NEW
}); // NEW
