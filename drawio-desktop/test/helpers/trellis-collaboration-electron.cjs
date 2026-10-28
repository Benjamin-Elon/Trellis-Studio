/** Native Chromium interaction and visual QA of the production collaboration dialog. // NEW */
const assert = require('node:assert/strict'); // NEW
const fs = require('node:fs'), path = require('node:path'); // NEW
const { app, BrowserWindow } = require('electron'); // NEW
app.disableHardwareAcceleration(); app.commandLine.appendSwitch('in-process-gpu'); // NEW
app.setPath('userData', fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'trellis-collaboration-ui-'))); // NEW
const project = path.resolve(__dirname, '../..'), output = path.join(project, '.test-artifacts', 'collaboration'); // NEW
fs.mkdirSync(output, { recursive: true }); // NEW
async function click(win, label) { // NEW
    const point = await win.webContents.executeJavaScript(`(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent === ${JSON.stringify(label)}); if (!b) throw new Error('Missing button'); const r = b.getBoundingClientRect(); return {x: Math.round(r.left+r.width/2), y: Math.round(r.top+r.height/2)}; })()`); // NEW
    win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point }); win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point }); // NEW
    await new Promise(resolve => setTimeout(resolve, 50)); // NEW
} // NEW
app.whenReady().then(async () => { // NEW
    const win = new BrowserWindow({ show: false, width: 1040, height: 800, webPreferences: { sandbox: false, backgroundThrottling: false } }); // NEW
    win.webContents.on('console-message', event => { if (event.level === 'error') console.error('Renderer:', event.message); }); // NEW
    try { // NEW
        await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<!doctype html><body style="margin:0;background:#edf3e8;font-family:Arial"><div style="padding:18px;background:white;border-bottom:1px solid #ccc">Community garden · Trellis</div><div id="graph" tabindex="0" style="position:relative;height:720px"><div style="position:absolute;left:50px;top:50px;width:240px;height:160px;background:#d9e9c5;border:1px solid #54823b;padding:10px">Planting A</div></div></body>')); // NEW
        const cleanup = fs.readFileSync(path.join(project, 'drawio/src/main/webapp/plugins/garden_planner_plugins/Trellis_UI_Cleanup.js'), 'utf8'); // NEW
        const plugin = fs.readFileSync(path.join(project, 'drawio/src/main/webapp/plugins/garden_planner_plugins/Trellis_Syncthing.js'), 'utf8'); // NEW
        const baselinePlugin = 'window.__trellisLiveUpdatesForBenchmark=true;\n' + plugin; // NEW: retain the existing live-path comparison; the explicit fixture exercises the new default against a real journal.
        const setupResult = await win.webContents.executeJavaScript(` (() => { try { // NEW
            window.calls = []; window.editorEvents = 0;
            const xml = '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel>';
            const info = { managed: true, ok: true, protocolVersion: 3, shareId: 'garden', diagramId: 'diagram', diagramPath: 'C:/test/Garden.drawio', folderLabel: 'Community garden', deviceId: 'local' };
            const state = { ...info, state: 'upToDate', connectedCollaborators: 1, collaborators: [{id:'alice', name:'Alice'}], collaboration: { holds:[{key:JSON.stringify(['','planting']), userId:'alice', name:'Alice', sessionId:'remote', expiresAt:Date.now()+300000}], presence:[], recoveries:[] } };
            const file = { data:xml, fileObject:{path:info.diagramPath}, getTitle:()=> 'Community garden.drawio', isModified:()=>false, setModified(){}, save(_r,done){done();}, fileSaved(_x,_d,done){done();} };
            const graph = {container:document.getElementById('graph'), getDefaultParent:()=>({getAttribute:()=> 'diagram'}), getModel:()=>({getCell:id=>id==='planting'? {id,label:'Planting A',getAttribute:k=>k==='label'?'Planting A':null}:null}), view:{getState:()=>({x:50,y:50,width:240,height:160})}, getSelectionCells:()=>[], refresh(){}};
            window.Trellis={users:{getCurrentUser:()=>({id:'admin'}), isAdmin:()=>true, listUsers:()=>[{id:'alice',name:'Alice',email:'alice@example.org'}]},history:{getDiagramId:()=> 'diagram'}};
            window.trellisShare={setContext:async()=>{}, getStatus:async()=>({canvases:[state]}),getSyncthingShareInfo:async()=>info,importHistory:async()=>({entries:[]}), onStatus:callback=>{window.fireStatus=callback;}, listRequests:async()=>({members:[],requests:[]}), createDeviceInvite:async()=>({block:'INVITATION',email:'alice@example.org'}), collaborationAction:async payload=>{window.calls.push(payload);return {ok:true,xml,collaboration:state.collaboration};}};
            window.ui={editor:{graph,setStatus(){},addListener(){}},getCurrentFile:()=>file,getFileData:()=>xml,watchFile:async()=>{},menus:{get:()=>null},actions:{addAction:()=>({})}};
            window.Draw={loadPlugin:fn=>fn(window.ui)};
            ${cleanup.slice(0, cleanup.indexOf('Draw.loadPlugin'))}
            ${baselinePlugin}
            window.Trellis.sharing.showSharingDialog(); return null; } catch (error) { return error.stack; } })()
        `); if (setupResult) throw new Error(setupResult); // NEW
        await new Promise(resolve => setTimeout(resolve, 120)); // NEW
        assert.equal(await win.webContents.executeJavaScript("document.querySelector('[role=dialog]').getAttribute('aria-label')"), 'Canvas collaboration'); // NEW
        fs.writeFileSync(path.join(output, 'overview.png'), (await win.webContents.capturePage()).toPNG()); // NEW
        await click(win, 'Approve a computer'); // NEW
        await win.webContents.executeJavaScript("['mousedown','mouseup','click','keydown','keypress','keyup'].forEach(type=>document.addEventListener(type,e=>{window.editorEvents++;e.preventDefault();document.getElementById('graph').focus();})); document.querySelector('textarea').focus();"); // NEW
        win.webContents.focus(); // NEW: hidden native fixtures must explicitly focus their web contents before keyboard injection.
        for (const character of 'approval-reply') win.webContents.sendInputEvent({ type: 'char', keyCode: character }); // NEW
        await new Promise(resolve => setTimeout(resolve, 50)); // NEW
        const typed = await win.webContents.executeJavaScript("({value:document.querySelector('textarea').value,editorEvents:window.editorEvents,focused:document.activeElement===document.querySelector('textarea')})"); // NEW
        assert.equal(typed.value, 'approval-reply'); assert.equal(typed.editorEvents, 0); assert.equal(typed.focused, true); // NEW
        fs.writeFileSync(path.join(output, 'approval.png'), (await win.webContents.capturePage()).toPNG()); // NEW
        win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' }); await new Promise(resolve => setTimeout(resolve, 50)); // NEW
        assert.equal(await win.webContents.executeJavaScript("!!document.querySelector('.trellis-collaboration-dialog')"), false); // NEW
        await click(win, 'Alice · editing'); // NEW
        assert.equal(await win.webContents.executeJavaScript("document.activeElement.textContent"), 'Request release', 'Pinning gives keyboard access to coordination actions'); // NEW
        win.webContents.sendInputEvent({ type: 'mouseMove', x: 900, y: 700 }); await new Promise(resolve => setTimeout(resolve, 150)); // NEW
        assert.equal(await win.webContents.executeJavaScript("!!document.querySelector('[aria-label=\"Activity for Planting A\"]')"), true, 'Pinned popovers survive pointer departure'); // NEW
        await win.webContents.executeJavaScript("(async()=>{ui.editor.graph.view.getState=()=>({x:80,y:90,width:300,height:200});window.fireStatus((await window.trellisShare.getStatus()).canvases);})()"); // NEW
        assert.equal(await win.webContents.executeJavaScript("document.querySelector('[data-object-key]').style.left"), '384px', 'Badges follow graph view geometry'); // NEW
        win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' }); await new Promise(resolve => setTimeout(resolve, 50)); // NEW
        assert.equal(await win.webContents.executeJavaScript("!!document.querySelector('[aria-label=\"Activity for Planting A\"]')"), false); // NEW
        await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<!doctype html><div id="graph" style="position:relative;width:800px;height:600px"></div>')); // NEW
        await win.webContents.executeJavaScript('window.mxLoadResources=false;window.mxLoadStylesheets=false;'); // NEW
        await win.webContents.executeJavaScript(fs.readFileSync(path.join(project, 'drawio/src/main/webapp/mxgraph/mxClient.js'), 'utf8')); // NEW
        await win.webContents.executeJavaScript(` // NEW
            window.graph = new mxGraph(document.getElementById('graph')); graph.isSpecialColor=()=>false;graph.getCompositeParent=cell=>cell;graph.convertValueToString=cell=>cell.value?.getAttribute?.('label')||'';
            const value = mxUtils.createXmlDocument().createElement('object'); value.setAttribute('label','Planting'); value.setAttribute('planting_id','planting');
            window.planting = graph.insertVertex(null,'planting',value,40,40,180,100);
            window.calls = []; window.modified = false; window.rawSaves = 0; window.persisted = '';
            const serialize = () => mxUtils.getXml(new mxCodec().encode(graph.model));
            graph.model.addListener(mxEvent.CHANGE,()=>window.modified=true);
            window.currentFile = {data:serialize(), fileObject:{path:'C:/test/Live.drawio'},getTitle:()=> 'Live.drawio',isModified:()=>window.modified,setModified:x=>window.modified=x,save(_r,done){window.rawSaves++;done();},fileSaved(_x,_d,done){done();}};
            window.liveInfo = {ok:true,managed:true,protocolVersion:3,shareId:'live',diagramId:'live',diagramPath:currentFile.fileObject.path};
            window.holds = [];
            window.Trellis = {users:{getCurrentUser:()=>({id:'admin'}),isAdmin:()=>true,listUsers:()=>[]}};
            window.trellisShare = {setContext:async()=>{},getStatus:async()=>({canvases:[{...liveInfo,state:'upToDate',connectedCollaborators:0}]}),getSyncthingShareInfo:async()=>liveInfo,importHistory:async()=>({entries:[]}),onStatus:()=>{},collaborationAction:async payload=>{window.calls.push(payload);if(payload.kind==='claim'){await new Promise(r=>setTimeout(r,40));window.holds=[{key:JSON.stringify(['','planting']),sessionId:'local',userId:'admin',name:'Admin',expiresAt:Date.now()+300000}];}if(payload.kind==='release')window.holds=[];if(payload.kind==='save')window.persisted=payload.xml;return{ok:true,xml:payload.xml||serialize(),collaboration:{sessionId:'local',holds:window.holds,presence:[],reservations:[],recoveries:[]}};}};
            window.electron = {request:(_args,done)=>done({mtimeMs:1})};
            window.ui = {editor:{graph,autosave:false,addListener(){},setStatus(){}},getCurrentFile:()=>currentFile,getFileData:serialize,watchFile:async()=>{},actions:{addAction:()=>({})},menus:{get:()=>null},setFileData:xml=>new mxCodec(mxUtils.parseXml(xml)).decode(mxUtils.parseXml(xml).documentElement,graph.model)};
            window.Draw={loadPlugin:fn=>fn(ui)};
            ${baselinePlugin}
            void 0;
        `); // NEW
        await new Promise(resolve => setTimeout(resolve, 80)); // NEW
        await win.webContents.executeJavaScript("graph.setSelectionCell(planting); void 0;"); await new Promise(resolve => setTimeout(resolve, 50)); // NEW
        assert.equal(await win.webContents.executeJavaScript("calls.some(c=>c.kind==='claim')"), false, 'Viewing must not acquire a hold'); // NEW
        await win.webContents.executeJavaScript("for(const label of ['First character','Typing continues']){const next=planting.value.cloneNode(true);next.setAttribute('label',label);graph.model.setValue(planting,next);} void 0;"); // NEW
        await win.webContents.executeJavaScript("new Promise((resolve,reject)=>currentFile.save(false,resolve,reject))"); // NEW
        const modelResult = await win.webContents.executeJavaScript("({label:planting.value.getAttribute('label'),rawSaves,modified,autosave:currentFile.isAutosave(),saved:!!persisted.includes('Typing continues')})"); // NEW
        assert.deepEqual(modelResult, { label: 'Typing continues', rawSaves: 0, modified: false, autosave: true, saved: true }); // NEW
        const releasesBefore = await win.webContents.executeJavaScript("calls.filter(c=>c.kind==='release').length"); // NEW
        await win.webContents.executeJavaScript("graph.stopEditing(false); void 0;"); await new Promise(resolve => setTimeout(resolve, 80)); // NEW
        assert.equal(await win.webContents.executeJavaScript("calls.filter(c=>c.kind==='release').length"), releasesBefore, 'An idle editingStopped event must not release the hold'); // NEW
        await win.webContents.executeJavaScript("graph.cellLabelChanged=(cell,label)=>{const next=cell.value.cloneNode(true);next.setAttribute('label',label);graph.model.setValue(cell,next);};graph.startEditingAtCell(planting);graph.cellEditor.textarea.innerText='Native label draft'; void 0;"); // NEW
        await new Promise(resolve => setTimeout(resolve, 80)); // NEW
        await win.webContents.executeJavaScript("new Promise((resolve,reject)=>currentFile.save(false,resolve,reject))"); // NEW
        assert.equal(await win.webContents.executeJavaScript("graph.isEditing()"), true, 'Autosave must preserve the native label editor'); // NEW
        await win.webContents.executeJavaScript("graph.stopEditing(false); void 0;"); await new Promise(resolve => setTimeout(resolve, 150)); // NEW
        assert.equal(await win.webContents.executeJavaScript("planting.value.getAttribute('label')"), 'Native label draft'); // NEW
        assert.equal(await win.webContents.executeJavaScript("persisted.includes('Native label draft')"), true, 'Closing the form must save finishing edits before release'); // NEW
        await win.webContents.executeJavaScript("graph.clearSelection(); void 0;"); await new Promise(resolve => setTimeout(resolve, 150)); // NEW
        assert.equal(await win.webContents.executeJavaScript("calls.some(c=>c.kind==='release')"), true); // NEW
        const claimsBeforeUsersAction = await win.webContents.executeJavaScript("calls.filter(c=>c.kind==='claim').length"); // NEW
        await win.webContents.executeJavaScript("graph.__trellisUsersInternalChange=true;try{const next=planting.value.cloneNode(true);next.setAttribute('trellis_access_grants_json','[]');graph.model.setValue(planting,next);}finally{graph.__trellisUsersInternalChange=false;}void 0;"); // NEW
        await win.webContents.executeJavaScript("new Promise((resolve,reject)=>currentFile.save(false,resolve,reject))"); // NEW
        assert.ok(await win.webContents.executeJavaScript("calls.filter(c=>c.kind==='claim').length") > claimsBeforeUsersAction, 'Authorized local Users mutations participate in locking'); // NEW
        assert.equal(await win.webContents.executeJavaScript("persisted.includes('trellis_access_grants_json')"), true); // NEW
        console.log(JSON.stringify({ ok: true, nativeTyping: typed, realGraph: modelResult, screenshots: output })); win.destroy(); app.exit(0); // NEW
    } catch (err) { console.error(err); win.destroy(); app.exit(1); } // NEW
}); // NEW
