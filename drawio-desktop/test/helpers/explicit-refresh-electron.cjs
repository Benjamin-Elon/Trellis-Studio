/** Isolated real Chromium + signed collaboration store: notifications, saves, native patches and rollback. */ // NEW
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const assert = require('node:assert/strict');
const project = path.resolve(__dirname, '../..'), webapp = path.join(project, 'drawio/src/main/webapp');
let window, journal, failCheckpoint = false, clockOffset = 0; // CHANGE
const directory = require('node:fs').mkdtempSync(path.join(os.tmpdir(), 'trellis-explicit-refresh-')); // NEW
app.setPath('userData', path.join(directory, 'browser')); // NEW: isolate the profile before Chromium starts.
const measurements = [];
const benchmark = process.argv.includes('--benchmark'), bursts = []; // NEW
app.disableHardwareAcceleration(); app.commandLine.appendSwitch('in-process-gpu');
async function evaluate(code) { try { return await window.webContents.executeJavaScript(code, true); } catch (error) { throw new Error('Native script failed: ' + code.slice(0, 240) + '\n' + error.message); } } // CHANGE
async function until(expression) {
    const deadline = Date.now() + (benchmark ? 60000 : 15000); // CHANGE
    while (Date.now() < deadline) { if (await evaluate(expression)) return; await new Promise(resolve => setTimeout(resolve, 30)); }
    throw new Error('Timed out: ' + expression + '\n' + await evaluate('JSON.stringify(window.statuses)'));
}
async function reviewAndClick() {
    await evaluate("document.querySelector('[data-incoming-toolbar] button').click(); void 0;");
    await until("[...document.querySelectorAll('.trellis-incoming-review button')].some(button => button.textContent === 'Refresh All' && !button.disabled)");
    await evaluate("[...document.querySelectorAll('.trellis-incoming-review button')].find(button => button.textContent === 'Refresh All').click(); void 0;");
}
app.whenReady().then(async () => {
    const timeout = setTimeout(() => { console.error('Explicit refresh fixture timed out'); app.exit(1); }, benchmark ? 240000 : 90000); // CHANGE
    try {
        const { createCollaborationStore } = await import(pathToFileURL(path.join(project, 'src/main/trellis-collaboration-store.js')));
        const { generateKeyPairSync } = crypto, pair = generateKeyPairSync('ed25519');
        const keys = { publicKey: pair.publicKey.export({ type: 'spki', format: 'pem' }), privateKey: pair.privateKey };
        const canvas = { shareId: 'native-refresh', diagramId: 'native-diagram', filename: 'Canvas.drawio', folderPath: path.join(directory, 'share'), diagramPath: path.join(directory, 'share/Canvas.drawio'), coordinatorDeviceId: 'device', coordinatorPublicKey: keys.publicKey, members: [{ deviceId: 'device', publicKey: keys.publicKey }] };
        const writeAtomic = async (filename, contents) => {
            if (failCheckpoint && filename.includes('object-views')) throw new Error('Simulated checkpoint failure');
            await fs.mkdir(path.dirname(filename), { recursive: true }); const temporary = filename + '.tmp'; await fs.writeFile(temporary, contents); await fs.rename(temporary, filename);
        };
        const writeImmutable = async (filename, record) => { await fs.mkdir(path.dirname(filename), { recursive: true }); await fs.writeFile(filename, JSON.stringify(record), { flag: 'wx' }); };
        journal = createCollaborationStore({ canvas, deviceId: 'device', keys, profile: path.join(directory, 'private'), now: () => Date.now() + clockOffset, writeAtomic, writeImmutable, onTiming: sample => measurements.push(sample) }); // CHANGE
        ipcMain.handle('fixture-initialize', (_event, xml) => journal.initialize(xml));
        ipcMain.handle('fixture-action', (event, input) => journal.action(event.sender.id, 'alice', input));
        ipcMain.handle('fixture-recovery', (_event, input) => journal.saveRecovery(input.xml, input.editorDrafts || [])); // NEW
        window = new BrowserWindow({ width: 1100, height: 780, show: false, webPreferences: { nodeIntegration: true, contextIsolation: false, backgroundThrottling: false } });
        window.webContents.on('console-message', event => { if (event.level === 'error') console.error(event.message); }); // CHANGE
        const html = path.join(directory, 'fixture.html'); await fs.writeFile(html, '<!doctype html><body style="margin:0"><div id="graph" style="position:relative;width:1080px;height:720px;overflow:auto;border:1px solid #ccc"></div></body>'); await window.loadFile(html); // CHANGE: native persistent preferences need a non-opaque origin.
        await evaluate('window.mxLoadResources=false;window.mxLoadStylesheets=false;window.urlParams={};');
        await evaluate(await fs.readFile(path.join(webapp, 'js/app.min.js'), 'utf8'));
        await evaluate(`
            window.graph = new Graph(document.getElementById('graph')); window.editor = new mxEventSource(); editor.graph=graph; editor.undoManager=new mxUndoManager();editor.extractGraphModel=Editor.prototype.extractGraphModel; // CHANGE: exercise the real XML decoder used by draft rollback.
            graph.model.addListener(mxEvent.UNDO,(_s,event)=>editor.undoManager.undoableEditHappened(event.getProperty('edit')));
            const xmlDocument=mxUtils.createXmlDocument(), metadata=xmlDocument.createElement('object');
            metadata.setAttribute('trellis_history_id','native-diagram'); metadata.setAttribute('trellis_users_json',JSON.stringify({usersEnabled:true,users:[{id:'alice',name:'Alice',admin:true},{id:'bob',name:'Bob',admin:true}]})); graph.model.setValue(graph.getDefaultParent(),metadata);
            const value=label=>{const node=xmlDocument.createElement('object');node.setAttribute('label',label);return node;};
            window.a=graph.insertVertex(null,'a',value('A1'),60,120,180,90); a.value.setAttribute('garden_module','1');
            window.b=graph.insertVertex(null,'b',value('B0'),380,120,180,90);
            window.bulk=[];graph.model.beginUpdate();try{for(let i=0;i<${benchmark ? 2000 : 0};i++)bulk.push(graph.insertVertex(null,'bulk-'+i,value('Original '+i),i%40*30,1000+Math.floor(i/40)*30,20,20));}finally{graph.model.endUpdate();} // NEW
            const page=new DiagramPage(mxUtils.parseXml('<diagram id="page-a" name="Garden"/>').documentElement);page.root=graph.model.root;page.viewState={};
            window.statuses=[];window.rendererMeasurements=[];window.TrellisSyncTiming=sample=>rendererMeasurements.push(sample);
            window.current={ui:null,data:'',fileObject:{path:${JSON.stringify(canvas.diagramPath)}},modified:false,isModified(){return this.modified},setModified(value){this.modified=value},save(){throw new Error('Raw save forbidden')},fileSaved(_xml,_descriptor,done){done()},getTitle:()=> 'Canvas.drawio',patch:DrawioFile.prototype.patch};
            const actionMap=new Map(); window.ui=Object.create(EditorUi.prototype);Object.assign(ui,{editor,pages:[page],currentPage:page,getCurrentFile:()=>current,watchFile:async()=>{},handleFileChange(){},menus:{get:()=>null},actions:{addAction(name,fn){const action={funct:fn};actionMap.set(name,action);return action}},getXmlFileData(){const doc=mxUtils.createXmlDocument(),file=doc.createElement('mxfile'),diagram=doc.createElement('diagram');diagram.setAttribute('id','page-a');diagram.setAttribute('name','Garden');diagram.appendChild(new mxCodec(doc).encode(graph.model));file.appendChild(diagram);return file},getFileData(){return mxUtils.getXml(this.getXmlFileData())}});current.ui=ui;current.data=ui.getFileData();editor.setStatus=message=>statuses.push(message);
            graph.model.addListener(mxEvent.CHANGE,()=>{if(!graph.__trellisSharingApplying)current.modified=true});
            graph.__trellisModules={clusters:{getCluster:()=>({id:'garden-cluster',modules:[a,b]}),revealCell(){}}};
            window.Trellis={users:{getCurrentUser:()=>({id:'alice'}),revalidateCurrentSession(){}}};
            const {ipcRenderer}=require('electron');window.fixtureClaims=0;window.trellisShare={setContext:async()=>{},getStatus:async()=>({canvases:[{protocolVersion:3,shareId:'native-refresh',diagramPath:current.fileObject.path,state:'upToDate'}]}),getSyncthingShareInfo:async()=>({ok:true,managed:true,protocolVersion:3,shareId:'native-refresh',diagramId:'native-diagram',diagramPath:current.fileObject.path}),collaborationAction:async input=>{if(input.kind==='claim')fixtureClaims++;try{return await ipcRenderer.invoke('fixture-action',input)}finally{if(input.kind==='claim')fixtureClaims--}},saveRecoveryCopy:input=>ipcRenderer.invoke('fixture-recovery',input),onStatus:()=>()=>{},importHistory:async()=>({entries:[]})}; // CHANGE
            window.electron={request:(_input,done)=>done({mtimeMs:1})};window.Draw={loadPlugin:fn=>fn(ui)};
            ipcRenderer.invoke('fixture-initialize',current.data);
        `);
        for (const file of ['js/trellis-local-view.js', 'js/trellis-incoming-changes.js', 'js/trellis-editing-holds.js', 'plugins/garden_planner_plugins/Trellis_Syncthing.js']) await evaluate(await fs.readFile(path.join(webapp, file), 'utf8')); // CHANGE
        await until("window.Trellis.sharing?.isExplicitRefresh() && !window.Trellis.sharing.isPendingCell(a)");
        const output = path.join(project, '.test-artifacts/explicit-refresh'); await fs.mkdir(output, { recursive: true }); // CHANGE
        if (!benchmark) { // NEW: keep the large workload separate from the small failure/race scenarios.
        const initial = (await journal.snapshot()).xml;
        const peer = await journal.action(999, 'bob', { kind: 'save', baseXml: initial, xml: initial.replace('label="B0"', 'label="B1"') }); assert.equal(peer.ok, true);
        await evaluate('ui.handleFileChange({mtimeMs:2},null,current); void 0;');
        await until('Trellis.sharing.getPendingChanges().length === 1');
        assert.equal(await evaluate("b.value.getAttribute('label')"), 'B0');
        assert.equal(await evaluate("document.querySelectorAll('[data-incoming-cluster]').length"), 1);
        await evaluate("const next=a.value.cloneNode(true);next.setAttribute('label','A2');graph.model.setValue(a,next);void 0;");
        await evaluate('new Promise((resolve,reject)=>current.save(false,resolve,reject))');
        assert.equal(await evaluate("b.value.getAttribute('label')"), 'B0'); assert.match((await journal.snapshot()).xml, /label="B1"/);
        await evaluate("document.querySelector('[data-incoming-toolbar] button').click();void 0;");
        await until("document.querySelector('.trellis-incoming-review')?.textContent.includes('Before / after')");
        await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))'); // NEW: capture the fully painted native review.
        await fs.writeFile(path.join(output, 'review.png'), (await window.webContents.capturePage()).toPNG());
        await evaluate("window.nativeAction=trellisShare.collaborationAction;window.dropAckReply=true;trellisShare.collaborationAction=async input=>{if(input.kind==='ack-refresh')await new Promise(resolve=>window.finishAck=resolve);const result=await nativeAction(input);if(input.kind==='ack-refresh'&&dropAckReply){dropAckReply=false;throw new Error('Injected lost acknowledgement reply')}return result};void 0;"); // CHANGE
        await evaluate("[...document.querySelectorAll('.trellis-incoming-review button')].find(button=>button.textContent==='Refresh All').click();void 0;");
        await until("b.value.getAttribute('label') === 'B1' && typeof finishAck === 'function'"); // NEW
        await evaluate("document.body.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));[...document.querySelectorAll('.trellis-incoming-review button')].find(button=>button.textContent==='Close').click();const typing=a.value.cloneNode(true);typing.setAttribute('label','A3');graph.model.setValue(a,typing);window.saveSettled=false;window.queuedSave=new Promise((resolve,reject)=>current.save(false,resolve,reject)).then(()=>saveSettled=true);void 0;"); // NEW
        await evaluate('new Promise(resolve=>setTimeout(resolve,30))'); // NEW
        assert.equal(await evaluate('saveSettled'), false, 'Autosave waits for the incoming object checkpoint'); // NEW
        assert.equal(await evaluate('current.isModified()'), true, 'Typing on an unrelated object during acknowledgement remains dirty'); // NEW
        await evaluate('finishAck();trellisShare.collaborationAction=nativeAction;void 0;'); // NEW
        await until("b.value.getAttribute('label') === 'B1' && Trellis.sharing.getPendingChanges().length === 0");
        await evaluate('queuedSave'); // NEW
        assert.match((await journal.snapshot()).xml, /label="A3"/); // NEW
        const nextBase = (await journal.snapshot()).xml;
        await journal.action(999, 'bob', { kind: 'save', baseXml: nextBase, xml: nextBase.replace('label="B1"', 'label="B2"') });
        await evaluate('ui.handleFileChange({mtimeMs:3},null,current);void 0;'); await until('Trellis.sharing.getPendingChanges().length === 1');
        failCheckpoint = true; await reviewAndClick(); await until("statuses.some(message=>message.includes('Refresh failed'))");
        assert.equal(await evaluate("b.value.getAttribute('label')"), 'B1', 'A failed checkpoint must restore the actual native object');
        assert.equal(await evaluate('Trellis.sharing.getPendingChanges().length'), 1);
        failCheckpoint = false;
        await evaluate("[...document.querySelectorAll('.trellis-incoming-review button')].find(button=>button.textContent==='Refresh All').click();void 0;");
        await until("b.value.getAttribute('label') === 'B2' && Trellis.sharing.getPendingChanges().length === 0");
        const patchBase = (await journal.snapshot()).xml; // NEW: a native application failure must restore actual object preimages, too.
        await journal.action(999, 'bob', { kind: 'save', baseXml: patchBase, xml: patchBase.replace('label="B2"', 'label="B3"') });
        await evaluate('ui.handleFileChange({mtimeMs:4},null,current);void 0;'); await until('Trellis.sharing.getPendingChanges().length===1');
        await evaluate("window.nativePatch=current.patch;window.failPatchOnce=true;current.patch=function(){const result=nativePatch.apply(this,arguments);if(failPatchOnce){failPatchOnce=false;throw new Error('Injected native patch failure')}return result};void 0;");
        await reviewAndClick(); await until("statuses.some(message=>message.includes('Injected native patch failure'))");
        assert.equal(await evaluate("b.value.getAttribute('label')"), 'B2'); assert.equal(await evaluate('Trellis.sharing.getPendingChanges().length'), 1);
        await evaluate("[...document.querySelectorAll('.trellis-incoming-review button')].find(button=>button.textContent==='Refresh All').click();void 0;");
        await until("b.value.getAttribute('label') === 'B3' && Trellis.sharing.getPendingChanges().length===0");
        await journal.action(999, 'bob', { kind: 'release' }); // NEW
        const beforeExpiry = await evaluate("a.value.getAttribute('label')"); // NEW
        await evaluate("const expired=a.value.cloneNode(true);expired.setAttribute('label','Expired local A');graph.model.setValue(a,expired);window.expiredAction=editor.undoManager.history.at(-1);void 0;"); // NEW
        await until("fixtureClaims===0 && Trellis.sharing.getStatus()?.collaboration?.holds?.some(hold=>hold.key==='[\"page-a\",\"a\"]')"); await evaluate('new Promise(resolve=>setTimeout(resolve,0))'); // CHANGE
        await evaluate("const survivor=b.value.cloneNode(true);survivor.setAttribute('label','Surviving local B');graph.model.setValue(b,survivor);void 0;"); // NEW
        await until("fixtureClaims===0 && Trellis.sharing.getStatus()?.collaboration?.holds?.some(hold=>hold.key==='[\"page-a\",\"b\"]'&&hold.userId==='alice')"); await evaluate('new Promise(resolve=>setTimeout(resolve,0))'); // CHANGE
        await journal.action(999, 'bob', { kind: 'request', targets: ['["page-a","a"]'] }); clockOffset = 300001; // NEW
        await evaluate('new Promise((resolve,reject)=>current.save(false,resolve,reject))'); // NEW
        assert.equal(await evaluate("a.value.getAttribute('label')"), beforeExpiry); assert.equal(await evaluate("b.value.getAttribute('label')"), 'Surviving local B'); // NEW
        assert.equal(await evaluate('editor.undoManager.history.includes(expiredAction)'), false); assert.equal(await evaluate('current.isModified()'), false); // NEW
        const recovered = await journal.snapshot(); assert.doesNotMatch(recovered.xml, /Expired local A/); assert.match(recovered.xml, /Surviving local B/); // NEW
        await evaluate('editor.undoManager.undo();void 0;'); assert.notEqual(await evaluate("a.value.getAttribute('label')"), 'Expired local A'); // NEW
        await evaluate('editor.undoManager.redo();void 0;'); assert.notEqual(await evaluate("a.value.getAttribute('label')"), 'Expired local A'); // NEW
        } // NEW
        if (benchmark) for (const changed of [100, 1000]) { // NEW: actual Chromium notification and native patch work are measured separately from journal preparation.
            console.log('Benchmark burst:', changed); // NEW
            const base = (await journal.snapshot()).xml;
            let proposal = base; for (let i = 0; i < changed; i++) proposal = proposal.replace('label="' + (changed === 1000 && i < 100 ? 'Burst 100 ' : 'Original ') + i + '"', 'label="Burst ' + changed + ' ' + i + '"');
            const saveStart = performance.now(); assert.equal((await journal.action(999, 'bob', { kind: 'save', baseXml: base, xml: proposal })).ok, true); const saveMs = performance.now() - saveStart;
            const before = await evaluate('rendererMeasurements.length');
            const notifyStart = performance.now(); await evaluate('ui.handleFileChange({mtimeMs:10},null,current);void 0;'); await until('Trellis.sharing.getPendingChanges().reduce((sum,group)=>sum+group.objects.length,0)===' + changed); const notificationMs = performance.now() - notifyStart;
            assert.equal(await evaluate("bulk[0].value.getAttribute('label')"), changed === 100 ? 'Original 0' : 'Burst 100 0');
            const refreshStart = performance.now(); await reviewAndClick(); await until('Trellis.sharing.getPendingChanges().length===0'); const refreshMs = performance.now() - refreshStart;
            bursts.push({ objects: 2000, changed, saveMs, notificationMs, refreshMs, renderer: await evaluate('rendererMeasurements.slice(' + before + ')'), memory: await evaluate('process.getProcessMemoryInfo()') }); // CHANGE
            console.log(JSON.stringify(bursts[bursts.length - 1])); // NEW: retain completed workloads if a later workload fails.
        }
        const renderer = await evaluate('rendererMeasurements');
        await fs.writeFile(path.join(output, benchmark ? 'native-benchmark.json' : 'timings.json'), JSON.stringify({ main: measurements, renderer, bursts }, null, 2)); // CHANGE
        console.log(JSON.stringify({ ok: true, screenshot: path.join(output, 'review.png'), renderer }));
        clearTimeout(timeout); window.destroy(); app.exit(0);
    } catch (error) { console.error(error); if (window && !window.isDestroyed()) { console.error(await evaluate('JSON.stringify(window.statuses)').catch(() => '')); window.destroy(); } clearTimeout(timeout); app.exit(1); }
});
