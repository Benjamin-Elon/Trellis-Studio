/** Native Chromium runs shipped plugins; controlled IPC avoids network transports and installed profiles. */ // CHANGE
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'); // CHANGE
const { app, BrowserWindow, ipcMain } = require('electron'); // CHANGE
const project = path.resolve(__dirname, '../..'), webapp = path.join(project, 'drawio/src/main/webapp'), profile = fs.mkdtempSync(path.join(os.tmpdir(), 'trellis-edit-lifecycle-')); // CHANGE
app.setPath('userData', profile); app.disableHardwareAcceleration(); app.commandLine.appendSwitch('in-process-gpu'); app.commandLine.appendSwitch('no-sandbox'); // CHANGE
let win; const timeout = setTimeout(() => { console.error('Native editing fixture timed out'); win?.destroy(); app.exit(1); }, 90000); // CHANGE
app.whenReady().then(async () => { // CHANGE
    try { // CHANGE
        const { inspectDiagram } = await import('../../src/main/trellis-share-protocol.js'), { permissionSnapshot, validatePermissionChanges } = await import('../../src/main/trellis-permission-policy.js'); // CHANGE
        let accepted = '', revision = 1; // CHANGE
        ipcMain.handle('editing-policy', (_event, input) => { // CHANGE
            if (input.initial) accepted = input.xml; // CHANGE
            if (input.save) { const result = validatePermissionChanges(accepted, input.xml, input.actor, Date.now()); if (!result.allowed) throw new Error(result.reason); accepted = input.xml; revision++; } // CHANGE
            const snapshot = permissionSnapshot(inspectDiagram(accepted)); return { revision, xml: accepted, policy: { store: snapshot.store, cells: Object.values(snapshot.cells), teams: {} } }; // CHANGE
        }); // CHANGE
        win = new BrowserWindow({ show: false, width: 1100, height: 850, webPreferences: { sandbox: false, nodeIntegration: true, contextIsolation: false, backgroundThrottling: false } }); // CHANGE
        win.webContents.on('console-message', event => { if (event.level === 'error' || event.message.startsWith('CLUSTER_STAGE:')) console.log(event.message); }); // CHANGE
        const host = path.join(profile, 'host.html'); fs.writeFileSync(host, '<!doctype html><body style="margin:0"><div id="graph" style="position:absolute;inset:0"></div></body>'); await win.loadFile(host); // CHANGE
        const run = source => win.webContents.executeJavaScript(source), load = name => run(fs.readFileSync(path.join(webapp, name), 'utf8') + '\n;void 0;'); // CHANGE
        await run('window.mxLoadResources=false;window.mxLoadStylesheets=false;window.urlParams={};'); console.log('NATIVE_STAGE: app runtime'); await load('js/app.min.js'); // CHANGE
        await run(` // CHANGE
            window.graph=new Graph(document.getElementById('graph'));window.nativeUndo=new mxUndoManager();graph.model.addListener(mxEvent.UNDO,(_sender,event)=>nativeUndo.undoableEditHappened(event.getProperty('edit'))); // CHANGE
            window.smokeUi={editor:Object.assign(new mxEventSource(),{graph,undoManager:nativeUndo,setStatus(text){this.status=text;},getStatus(){return this.status||'';}}),actions:{get(){return null;},addAction(){return{};}},menus:{get(){return null;}},hideDialog(){},alert(){},watchFile:async()=>{},getFileData:()=>mxUtils.getXml(new mxCodec().encode(graph.model))}; // CHANGE
            window.Draw={loadPlugin:callback=>callback(smokeUi)};window.valueDocument=mxUtils.createXmlDocument();window.value=attrs=>{const node=valueDocument.createElement('object');for(const[key,text]of Object.entries(attrs))node.setAttribute(key,String(text));return node;};window.write=(cell,attrs)=>{const node=cell.value.cloneNode(true);for(const[key,text]of Object.entries(attrs))node.setAttribute(key,String(text));graph.model.setValue(cell,node);};void 0; // CHANGE
        `); // CHANGE
        console.log('NATIVE_STAGE: permission and editing plugins');
        for (const name of ['js/trellis-permission-core.js', 'js/trellis-edit-context.js', 'js/trellis-sync-contract.js', 'js/trellis-incoming-changes.js', 'js/trellis-background-saving.js', 'js/trellis-editing-holds.js', 'plugins/garden_planner_plugins/Trellis_Users.js']) await load(name); // CHANGE
        await run(`(async()=>{ // CHANGE
            Trellis.users.enableUsers('Admin','1111');window.nativeDiagramId=Trellis.users.getDiagramKey({create:true});window.nativePolicy=await require('electron').ipcRenderer.invoke('editing-policy',{initial:true,xml:smokeUi.getFileData()}); // CHANGE
            window.nativeFile={data:nativePolicy.xml,fileObject:{path:'C:/fixture/Editing.drawio'},modified:false,isModified(){return this.modified;},setModified(value){this.modified=value;},clearAutosave(){},contentChanged(){},saveDraft(){},fileSaved(_xml,_descriptor,done){done();},save(){throw Error('Unexpected unmanaged save');}};smokeUi.getCurrentFile=()=>nativeFile;smokeUi.setFileData=xml=>{const document=mxUtils.parseXml(xml);graph.model.setRoot(new mxCodec(document).decode(document.documentElement).getRoot());}; // CHANGE
            window.nativeHolds=new Map();window.nativeObservation=0;window.nativeInfo={managed:true,protocolVersion:5,shareId:'native-fixture',diagramId:nativeDiagramId,diagramPath:nativeFile.fileObject.path};window.nativeActivity=()=>({sessionId:'native',actorUserId:Trellis.users.getCurrentUser()?.id,observationRevision:++nativeObservation,holds:[...nativeHolds.values()],presence:[],reservations:[],pendingChanges:[]}); // CHANGE
            window.electron={request(_input,done){done({mtimeMs:1});}};window.trellisShare={setContext:async()=>{},getStatus:async()=>({canvases:[{...nativeInfo,state:'upToDate'}]}),getSyncthingShareInfo:async()=>nativeInfo,onStatus(){},onActivity(listener){window.nativeActivityListener=listener;},importHistory:async()=>({entries:[]}),recoveryAction:async()=>({ok:true,drafts:[]}),saveRecoveryCopy:async()=>({recoveryPath:'fixture recovery'}),activityAction:async input=>{if(input.kind==='claim')for(const key of input.targets||[])nativeHolds.set(key,{key,claimId:key,sessionId:'native',expiresAt:Date.now()+30000});if(input.kind==='release')for(const key of input.targets||[])nativeHolds.delete(key);return{ok:true,collaboration:nativeActivity()};},collaborationAction:async input=>{if(input.kind==='save')nativePolicy=await require('electron').ipcRenderer.invoke('editing-policy',{save:true,xml:input.xml,actor:Trellis.users.getCurrentUser()?.id});return{ok:true,xml:nativePolicy.xml,groups:[],collaboration:{...nativeActivity(),policyRevision:nativePolicy.revision,policy:nativePolicy.policy,hash:'revision-'+nativePolicy.revision}};}}; // CHANGE
        })()`); // CHANGE
        console.log('NATIVE_STAGE: sharing'); await load('plugins/garden_planner_plugins/Trellis_Syncthing.js'); await run('new Promise(resolve=>setTimeout(resolve,100))'); // CHANGE
        for (const name of ['Garden_Roadmap_Core.js', 'Garden_Roadmap_Manager.js', 'Garden_Task_Manager.js', 'Modules_Standalone.js', 'Planting_Group.js', 'Garden_Scheduler_Shared_Core.js', 'Garden_Scheduler_Annual_Core.js', 'Garden_Scheduler_Perennial_Core.js']) await load('plugins/garden_planner_plugins/' + name); // CHANGE
        await run(`Trellis.users.login('Admin','1111');graph.model.addListener(mxEvent.CHANGE,(_sender,event)=>{if(!event.getProperty('edit')?.__trellisUsersRejected&&!graph.__trellisSharingApplying)nativeFile.modified=true;});void 0;`); // CHANGE
        await require('./editing-lifecycle-production.cjs')({ run, win, project }); clearTimeout(timeout); win.destroy(); app.exit(0); // CHANGE
    } catch (error) { console.error(error); clearTimeout(timeout); win?.destroy(); app.exit(1); } // CHANGE
}); // CHANGE
