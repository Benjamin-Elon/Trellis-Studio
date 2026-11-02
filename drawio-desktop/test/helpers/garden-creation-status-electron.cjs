/** Real Chromium input, shipped graph/factories and collaboration hooks; only IPC and persistence are mocked. */ // NEW
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'); // NEW
const { app, BrowserWindow, ipcMain } = require('electron'); // NEW
const webapp = path.resolve(__dirname, '../../drawio/src/main/webapp'), profile = fs.mkdtempSync(path.join(os.tmpdir(), 'trellis-creation-status-')); // NEW
app.setPath('userData', profile); app.disableHardwareAcceleration(); app.commandLine.appendSwitch('in-process-gpu'); // NEW
app.whenReady().then(async () => { // NEW
    const { inspectDiagram } = await import('../../src/main/trellis-share-protocol.js'), { permissionSnapshot } = await import('../../src/main/trellis-permission-policy.js'); // NEW
    ipcMain.handle('creation-status-policy', (_event, xml) => { const snapshot = permissionSnapshot(inspectDiagram(xml)); return { store: snapshot.store, cells: Object.values(snapshot.cells), teams: {} }; }); // NEW
    const win = new BrowserWindow({ show: false, width: 1150, height: 850, webPreferences: { sandbox: false, nodeIntegration: true, contextIsolation: false, backgroundThrottling: false } }); // NEW
    win.webContents.on('console-message', event => { if (event.level === 'error') console.error(event.message, event.sourceId || '', event.lineNumber || ''); }); // NEW
    const run = source => win.webContents.executeJavaScript(source), frames = () => run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))'); // NEW
    const load = async name => run(fs.readFileSync(path.join(webapp, name), 'utf8') + '\n;void 0;'); // NEW
    try { // NEW
        const host = path.join(profile, 'host.html'); fs.writeFileSync(host, '<!doctype html><body style="margin:0"><div id="graph" style="position:absolute;inset:0;overflow:auto"></div></body>'); await win.loadFile(host); // NEW
        await run('window.policyFor=(()=>{const ipc=require("electron").ipcRenderer;return xml=>ipc.invoke("creation-status-policy",xml)})();window.require=undefined;window.module=undefined;window.exports=undefined;window.mxLoadResources=false;window.mxLoadStylesheets=false;window.urlParams={};void 0;'); await load('js/app.min.js'); // NEW: libraries see their production browser environment; the sole test IPC closure stays private.
        await run(` // NEW
            window.graph=new Graph(document.getElementById('graph'));window.editor=Object.assign(new mxEventSource(),{graph,undoManager:new mxUndoManager(),setStatus(){}}); // NEW
            graph.model.addListener(mxEvent.UNDO,(_sender,event)=>editor.undoManager.undoableEditHappened(event.getProperty('edit'))); // NEW
            window.creationErrors=[];addEventListener('error',event=>creationErrors.push(event.error?.stack||event.message)); // NEW
            window.fixtureFile={data:'',fileObject:{path:'C:/fixture/Garden.drawio'},modified:false,isModified(){return this.modified},setModified(value){this.modified=value},clearAutosave(){},contentChanged(){},saveDraft(){},fileSaved(_data,_descriptor,done){done()},save(){throw Error('Native fallback save')}}; // NEW
            window.ui={editor,getCurrentFile:()=>fixtureFile,getFileData:()=>mxUtils.getXml(new mxCodec().encode(graph.model)),hideDialog(){},alert(){},watchFile:async()=>{},actions:{get:()=>null,addAction:()=>({})},menus:{get:()=>null}}; // NEW
            window.Draw={loadPlugin:callback=>callback(ui)};window.electron={request:(_input,done)=>done({mtimeMs:1})};void 0; // NEW
        `); // NEW
        for (const name of ['trellis-permission-core', 'trellis-edit-context', 'trellis-sync-contract', 'trellis-incoming-changes', 'trellis-background-saving', 'trellis-editing-holds']) await load('js/' + name + '.js'); // NEW
        await load('plugins/garden_planner_plugins/Trellis_Users.js'); // NEW
        await run(`(async()=>{ // NEW
            Trellis.users.enableUsers('Admin','1111');window.diagramId=Trellis.users.getDiagramKey({create:true});window.acceptedXml=ui.getFileData();fixtureFile.data=acceptedXml; // NEW
            window.policyRevision=1;window.activityRevision=0;window.held=new Map();window.activityCalls=[];window.pendingKeys=[];window.pendingState='saved'; // NEW
            window.activity=()=>({sessionId:'local',actorUserId:Trellis.users.getCurrentUser()?.id,observationRevision:++activityRevision,holds:[...held.values()],presence:[],reservations:[],pendingChanges:pendingKeys.length?[{sessionId:'local',userId:Trellis.users.getCurrentUser()?.id,online:true,saveState:pendingState,targets:pendingKeys}]:[]}); // NEW
            window.acceptedPolicy=await policyFor(acceptedXml); // NEW
            window.contentState=()=>({...activity(),policyRevision,policy:acceptedPolicy,hash:'accepted-'+policyRevision}); // NEW
            window.shareInfo={managed:true,protocolVersion:4,shareId:'fixture',diagramId,diagramPath:fixtureFile.fileObject.path}; // NEW
            window.trellisShare={setContext:async()=>{},getStatus:async()=>({canvases:[{...shareInfo,state:'upToDate'}]}),getSyncthingShareInfo:async()=>shareInfo,onStatus(){},onActivity(){},importHistory:async()=>({entries:[]}),recoveryAction:async()=>({ok:true,drafts:[]}),saveRecoveryCopy:async()=>({recoveryPath:'fixture recovery'}), // NEW
                activityAction:async input=>{activityCalls.push(input);if(input.kind==='claim')for(const key of input.targets)held.set(key,{key,sessionId:'local',userId:Trellis.users.getCurrentUser().id,claimId:key,expiresAt:Date.now()+30000});if(input.kind==='release')for(const key of input.targets||[...held.keys()])held.delete(key);if(input.kind==='publish'){pendingKeys=input.pending;pendingState=input.saveState}return{ok:true,collaboration:activity()}}, // NEW
                collaborationAction:async input=>{if(input.kind==='save'){acceptedXml=input.xml;acceptedPolicy=await policyFor(acceptedXml);policyRevision++}return{ok:true,xml:acceptedXml,groups:[],collaboration:contentState()}}}; // NEW
            window.badges=()=>[...document.querySelectorAll('[data-object-key]')].map(node=>({key:node.dataset.objectKey,text:node.textContent}));window.keyFor=cell=>JSON.stringify(['',String(cell.id)]);void 0; })(); // NEW
        `); // NEW
        await load('plugins/garden_planner_plugins/Trellis_Syncthing.js'); await frames(); // NEW
        for (const name of ['Garden_Roadmap_Core', 'Garden_Roadmap_Manager', 'Garden_Task_Manager', 'Modules_Standalone']) await load('plugins/garden_planner_plugins/' + name + '.js'); // NEW
        await run('Trellis.users.login("Admin","1111");graph.model.addListener(mxEvent.CHANGE,(_sender,event)=>{if(!event.getProperty("edit").__trellisUsersRejected&&!graph.__trellisSharingApplying)fixtureFile.modified=true});activityCalls.length=0;window.garden=graph.__trellisModules.createModuleAtPoint({x:30,y:40},"garden");void 0;'); await frames(); // NEW
        assert.deepEqual(await run('badges().map(badge=>badge.key)'), [await run('keyFor(garden)')]); // NEW
        assert.equal(await run('badges().some(badge=>badge.text.includes("editing"))'), false); // NEW
        assert.deepEqual(await run('[...new Set(activityCalls.filter(call=>call.kind==="claim").flatMap(call=>call.targets))]'), [await run('keyFor(garden)')]); // NEW
        await run('window.settings=document.createElement("section");settings.className="geDialog";settings.dataset.collaborationObjectId=garden.id;settings.innerHTML="<input name=gardenName>";document.body.append(settings);settings.firstChild.focus();void 0;'); await frames(); // NEW
        assert.equal(await run('badges().some(badge=>badge.text.includes("editing"))'), false, 'opening/focusing settings is not genuine editing'); // NEW
        await win.webContents.insertText('Native settings draft'); await frames(); // NEW
        assert.equal(await run('badges().some(badge=>badge.key===keyFor(garden)&&badge.text.includes("editing"))'), true); // NEW
        await run('settings.remove();void 0;'); await frames(); // NEW
        assert.equal(await run('badges().some(badge=>badge.text.includes("editing"))'), false, 'cancelling an uncommitted draft resumes suppression'); // NEW
        assert.equal(await run('held.has(keyFor(garden))'), true, 'hiding a label never removes its actual hold'); // NEW
        await run('(async()=>{window.team=graph.model.getCell(garden.getAttribute("trellis_team_module_id"));window.privateForm=document.createElement("section");privateForm.innerHTML="<input name=notes>";document.body.append(privateForm);window.privateEditor=Trellis.sharing.registerEditor({kind:"inventory",element:privateForm,targets:[keyFor(team)],capture:()=>({notes:privateForm.firstChild.value}),save:()=>false,discard(){}});await privateEditor.acquire();privateForm.firstChild.focus();})();'); await frames(); // NEW
        assert.equal(await run('badges().some(badge=>badge.key===keyFor(team)&&badge.text.includes("editing"))'), false); // NEW
        await win.webContents.insertText('Private team draft'); await frames(); // NEW
        assert.equal(await run('badges().some(badge=>badge.key===keyFor(team)&&badge.text.includes("editing"))'), true, 'registered-editor targets do not inherit the selected garden target'); // NEW
        await run('privateEditor.dispose(false);privateForm.remove();void 0;'); await frames(); // NEW
        assert.equal(await run('badges().some(badge=>badge.text.includes("editing"))'), false); // NEW
        await run('graph.setSelectionCell(garden);graph.startEditingAtCell(garden);void 0;'); await frames(); // NEW
        assert.equal(await run('badges().some(badge=>badge.text.includes("editing"))'), false); // NEW
        await win.webContents.insertText('Native label draft'); await frames(); // NEW
        assert.equal(await run('badges().some(badge=>badge.key===keyFor(garden)&&badge.text.includes("editing"))'), true); // NEW
        await run('graph.stopEditing(true);void 0;'); await frames(); // NEW
        assert.equal(await run('badges().some(badge=>badge.text.includes("editing"))'), false); // NEW
        assert.deepEqual(await run('creationErrors'), []); // NEW
        const output = path.resolve(__dirname, '../../.test-artifacts/garden-creation-status'); fs.mkdirSync(output, { recursive: true }); // NEW
        fs.writeFileSync(path.join(output, 'one-garden-summary.png'), (await win.webContents.capturePage()).toPNG()); // NEW
        console.log('Native garden creation status and trusted-input checks passed'); win.destroy(); app.exit(0); // NEW
    } catch (error) { console.error(error); win.destroy(); app.exit(1); } // NEW
}); // NEW
