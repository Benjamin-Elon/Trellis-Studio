/** Native Chromium interaction and visual QA of the production collaboration dialog. // NEW */
const assert = require('node:assert/strict'); // NEW
const fs = require('node:fs'), path = require('node:path'); // NEW
const { app, BrowserWindow } = require('electron'); // NEW
app.disableHardwareAcceleration(); app.commandLine.appendSwitch('in-process-gpu'); // NEW
app.setPath('userData', fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'trellis-collaboration-ui-'))); // NEW
const project = path.resolve(__dirname, '../..'), output = path.join(project, '.test-artifacts', 'collaboration'); // NEW
fs.mkdirSync(output, { recursive: true }); // NEW
async function click(win, label) { // NEW
    const point = await win.webContents.executeJavaScript(`(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent === ${JSON.stringify(label)}); if (!b) throw new Error('Missing button: ' + ${JSON.stringify(label)} + '; available: ' + [...document.querySelectorAll('button')].map(button=>button.textContent).join(', ')); const r = b.getBoundingClientRect(); return {x: Math.round(r.left+r.width/2), y: Math.round(r.top+r.height/2)}; })()`); // CHANGE: report the actual missing status control when native assertions fail.
    win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point }); win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point }); // NEW
    await new Promise(resolve => setTimeout(resolve, 50)); // NEW
} // NEW
app.whenReady().then(async () => { // NEW
    const win = new BrowserWindow({ show: false, width: 1040, height: 800, webPreferences: { sandbox: false, backgroundThrottling: false } }); // NEW
    win.webContents.on('console-message', event => { if (event.level === 'error') console.error('Renderer:', event.message); }); // NEW
    try { // NEW
        await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<!doctype html><body style="margin:0;background:#edf3e8;font-family:Arial"><div style="padding:18px;background:white;border-bottom:1px solid #ccc">Community garden · Trellis</div><div id="graph" tabindex="0" style="position:relative;height:720px"><div style="position:absolute;left:50px;top:50px;width:240px;height:160px;background:#d9e9c5;border:1px solid #54823b;padding:10px">Planting A</div></div></body>')); // NEW
        const cleanup = fs.readFileSync(path.join(project, 'drawio/src/main/webapp/plugins/garden_planner_plugins/Trellis_UI_Cleanup.js'), 'utf8'); // NEW
        await win.webContents.executeJavaScript(fs.readFileSync(path.join(project, 'drawio/src/main/webapp/js/trellis-sync-contract.js'), 'utf8')); // NEW: use the production protocol contract.
        const plugin = fs.readFileSync(path.join(project, 'drawio/src/main/webapp/plugins/garden_planner_plugins/Trellis_Syncthing.js'), 'utf8'); // NEW
        const baselinePlugin = 'window.__trellisLiveUpdatesForBenchmark=true;\n' + plugin; // NEW: retain the existing live-path comparison; the explicit fixture exercises the new default against a real journal.
        const setupResult = await win.webContents.executeJavaScript(` (() => { try { // NEW
            window.calls = []; window.editorEvents = 0;
            const xml = '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel>';
            const info = { managed: true, ok: true, protocolVersion: window.TrellisSyncContract.garden, shareId: 'garden', diagramId: 'diagram', diagramPath: 'C:/test/Garden.drawio', folderLabel: 'Community garden', deviceId: 'local' }; // CHANGE: exercise the supported production protocol.
            const state = { ...info, state: 'upToDate', connectedCollaborators: 1, collaborators: [{id:'alice', name:'Alice'}], collaboration: { holds:[{key:JSON.stringify(['','planting']), userId:'alice', name:'Alice', sessionId:'remote', expiresAt:Date.now()+300000}], presence:[], recoveries:[] } };
            const file = { data:xml, fileObject:{path:info.diagramPath}, getTitle:()=> 'Community garden.drawio', isModified:()=>false, setModified(){}, save(_r,done){done();}, fileSaved(_x,_d,done){done();} };
            const graph = {container:document.getElementById('graph'), getDefaultParent:()=>({getAttribute:()=> 'diagram'}), getModel:()=>({getCell:id=>id==='planting'? {id,label:'Planting A',getAttribute:k=>k==='label'?'Planting A':null}:null}), view:{getState:()=>({x:50,y:50,width:240,height:160})}, getSelectionCells:()=>[], refresh(){}};
            window.Trellis={users:{getCurrentUser:()=>({id:'admin'}), isAdmin:()=>true, listUsers:()=>[{id:'alice',name:'Alice',email:'alice@example.org'}]},history:{getDiagramId:()=> 'diagram'}};
            window.trellisShare={setContext:async()=>{}, getStatus:async()=>({canvases:[state]}),getSyncthingShareInfo:async()=>info,importHistory:async()=>({entries:[]}), onStatus:callback=>{window.fireStatus=callback;}, listRequests:async()=>({members:[],requests:[]}), createDeviceInvite:async()=>({block:'INVITATION',email:'alice@example.org'}), collaborationAction:async payload=>{window.calls.push(payload);return {ok:true,xml,collaboration:state.collaboration};}};
            window.ui={editor:{graph,setStatus(){},addListener(){}},getCurrentFile:()=>file,getFileData:()=>xml,watchFile:async()=>{},menus:{get:()=>null},actions:{addAction:()=>({})}};
            window.Draw={loadPlugin:fn=>fn(window.ui)};
            ${cleanup.slice(0, cleanup.indexOf('Draw.loadPlugin'))}
            window.setInterval=()=>0; // CHANGE: this status fixture supplies observations explicitly; later navigations restore native polling.
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
        const badgeStyle = await win.webContents.executeJavaScript("(()=>{const b=document.querySelector('[data-object-key]');b.dispatchEvent(new MouseEvent('mouseenter'));b.focus();const s=getComputedStyle(b);return{background:s.backgroundColor,opacity:s.opacity,color:s.color,border:s.borderTopColor,title:b.hasAttribute('title'),open:!!document.querySelector('[aria-label=\"Activity for Planting A\"]')}})()"); // CHANGE
        assert.deepEqual(badgeStyle, { background: 'rgba(255, 255, 255, 0.5)', opacity: '1', color: 'rgb(29, 78, 216)', border: 'rgb(37, 99, 235)', title: false, open: false }); // CHANGE
        for (const keyCode of ['Enter', 'Space']) { // CHANGE: verify actual Chromium button activation, including Space's character event.
            win.webContents.sendInputEvent({ type: 'keyDown', keyCode }); // CHANGE
            win.webContents.sendInputEvent({ type: 'char', keyCode: keyCode === 'Enter' ? '\r' : ' ' }); // CHANGE
            win.webContents.sendInputEvent({ type: 'keyUp', keyCode }); await new Promise(resolve => setTimeout(resolve, 50)); // CHANGE
            assert.equal(await win.webContents.executeJavaScript("document.activeElement.textContent"), 'Request release'); // CHANGE
            win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' }); await new Promise(resolve => setTimeout(resolve, 50)); // CHANGE
            assert.equal(await win.webContents.executeJavaScript("document.activeElement===document.querySelector('[data-object-key]')&&!document.querySelector('[aria-label=\"Activity for Planting A\"]')"), true); // CHANGE
            assert.equal(await win.webContents.executeJavaScript("getComputedStyle(document.activeElement).outlineStyle"), 'solid', 'Keyboard focus remains visible'); // CHANGE
        } // CHANGE
        await click(win, 'Alice · editing'); // CHANGE
        assert.equal(await win.webContents.executeJavaScript("getComputedStyle(document.querySelector('[aria-label=\"Activity for Planting A\"]')).zIndex"), '10030', 'First badge click opens top-layer details'); // CHANGE
        await click(win, 'Alice · editing'); // CHANGE
        assert.equal(await win.webContents.executeJavaScript("!!document.querySelector('[aria-label=\"Activity for Planting A\"]')"), false, 'A second badge click closes details'); // CHANGE
        await click(win, 'Alice · editing'); // CHANGE
        assert.equal(await win.webContents.executeJavaScript("getComputedStyle(document.querySelector('[aria-label=\"Activity for Planting A\"]')).zIndex"), '10030', 'Third badge click reopens details'); // CHANGE
        const layerPoint = await win.webContents.executeJavaScript(`(() => { // CHANGE: append a later ordinary control so DOM order alone cannot make details win.
            window.layerPanel=document.querySelector('[aria-label="Activity for Planting A"]'); // CHANGE
            const bounds=layerPanel.getBoundingClientRect();window.layerProbe=document.createElement('div'); // CHANGE
            layerProbe.style.cssText='position:fixed;left:'+bounds.left+'px;top:'+bounds.top+'px;width:'+bounds.width+'px;height:'+bounds.height+'px;background:white;z-index:10020'; // CHANGE
            window.layerProbeClicks=0;layerProbe.onclick=()=>layerProbeClicks++;document.body.appendChild(layerProbe); // CHANGE
            return {x:Math.round(bounds.left+20),y:Math.round(bounds.top+20)}; // CHANGE
        })()`); // CHANGE
        assert.equal(await win.webContents.executeJavaScript(`layerPanel.contains(document.elementFromPoint(${layerPoint.x},${layerPoint.y}))`), true, 'Details cover ordinary controls'); // CHANGE
        win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...layerPoint }); win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...layerPoint }); // CHANGE
        await new Promise(resolve => setTimeout(resolve, 50)); // CHANGE
        assert.deepEqual(await win.webContents.executeJavaScript('({open:layerPanel.isConnected,clicks:layerProbeClicks})'), { open: true, clicks: 0 }); // CHANGE
        await win.webContents.executeJavaScript("layerProbe.style.zIndex='2000000000';void 0;"); // CHANGE
        assert.equal(await win.webContents.executeJavaScript(`document.elementFromPoint(${layerPoint.x},${layerPoint.y})===layerProbe`), true, 'Modal backdrops cover details'); // CHANGE
        win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...layerPoint }); win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...layerPoint }); // CHANGE
        await new Promise(resolve => setTimeout(resolve, 50)); // CHANGE
        assert.deepEqual(await win.webContents.executeJavaScript('({open:layerPanel.isConnected,clicks:layerProbeClicks})'), { open: false, clicks: 1 }, 'Outside modal clicks keep their normal delivery and dismissal'); // CHANGE
        await win.webContents.executeJavaScript('layerProbe.remove();void 0;'); // CHANGE
        await click(win, 'Alice · editing'); await click(win, 'Close'); // CHANGE
        assert.equal(await win.webContents.executeJavaScript("document.activeElement===document.querySelector('[data-object-key]')"), true, 'Close restores the badge'); // CHANGE
        await win.webContents.executeJavaScript(`(async()=>{ // CHANGE: place a second badge clear of the first panel for native switching.
            window.switchState=(await trellisShare.getStatus()).canvases[0]; // CHANGE
            window.originalActivityModel=ui.editor.graph.getModel;window.originalActivityView=ui.editor.graph.view.getState; // CHANGE
            ui.editor.graph.getModel=()=>({...originalActivityModel(),getCell:id=>id==='other'?{id,getAttribute:name=>name==='label'?'Planting B':null}:originalActivityModel().getCell(id)}); // CHANGE
            ui.editor.graph.view.getState=cell=>cell.id==='other'?{x:700,y:50,width:100,height:80}:originalActivityView(cell); // CHANGE
            switchState.collaboration.holds.push({key:JSON.stringify(['','other']),userId:'bob',name:'Bob',sessionId:'other-remote'});fireStatus([switchState]); // CHANGE
        })()`); // CHANGE
        await click(win, 'Alice · editing'); await click(win, 'Bob · editing'); // CHANGE
        assert.deepEqual(await win.webContents.executeJavaScript("({first:!!document.querySelector('[aria-label=\"Activity for Planting A\"]'),second:!!document.querySelector('[aria-label=\"Activity for Planting B\"]')})"), { first: false, second: true }, 'Another badge switches directly to its details'); // CHANGE
        await click(win, 'Close'); // CHANGE
        await win.webContents.executeJavaScript("switchState.collaboration.holds=switchState.collaboration.holds.filter(hold=>hold.sessionId!=='other-remote');ui.editor.graph.getModel=originalActivityModel;ui.editor.graph.view.getState=originalActivityView;fireStatus([switchState]);void 0;"); // CHANGE
        await win.webContents.executeJavaScript("window.outsideClicks=0;document.getElementById('graph').addEventListener('click',()=>window.outsideClicks++);void 0;"); // CHANGE
        await click(win, 'Alice · editing'); // CHANGE
        win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, x: 900, y: 700 }); win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, x: 900, y: 700 }); await new Promise(resolve => setTimeout(resolve, 50)); // CHANGE
        assert.deepEqual(await win.webContents.executeJavaScript("({clicks:outsideClicks,open:!!document.querySelector('[aria-label=\"Activity for Planting A\"]'),focus:document.activeElement.id})"), { clicks: 1, open: false, focus: 'graph' }, 'Outside clicks dismiss details and still reach the graph'); // CHANGE
        for (const background of ['grid', 'bed', 'glyphs']) { // CHANGE: capture representative busy canvas backgrounds without changing production assets.
            await win.webContents.executeJavaScript(`(()=>{const graph=document.getElementById('graph');graph.style.backgroundColor=${JSON.stringify(background === 'grid' ? '#ffffff' : '#b8dca2')};graph.style.backgroundImage=${JSON.stringify(background === 'glyphs' ? "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='28' height='28'%3E%3Ccircle cx='14' cy='14' r='13' fill='%23cedc99' stroke='%23374125'/%3E%3Ctext x='4' y='18' font-size='11'%3EDILL%3C/text%3E%3C/svg%3E\")" : 'linear-gradient(#0001 1px,transparent 1px),linear-gradient(90deg,#0001 1px,transparent 1px)')};graph.style.backgroundSize=${JSON.stringify(background === 'glyphs' ? '28px 28px' : '12px 12px')};document.activeElement.blur();return new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));})()`); // CHANGE
            fs.writeFileSync(path.join(output, 'badge-' + background + '.png'), (await win.webContents.capturePage({ x: 270, y: 60, width: 330, height: 120 })).toPNG()); // CHANGE
        } // CHANGE
        await win.webContents.executeJavaScript("document.getElementById('graph').style.background='';void 0;"); // CHANGE
        await click(win, 'Alice · editing'); // NEW
        assert.equal(await win.webContents.executeJavaScript("document.activeElement.textContent"), 'Request release', 'Clicking gives keyboard access to coordination actions'); // CHANGE
        win.webContents.sendInputEvent({ type: 'mouseMove', x: 900, y: 700 }); await new Promise(resolve => setTimeout(resolve, 150)); // NEW
        assert.equal(await win.webContents.executeJavaScript("!!document.querySelector('[aria-label=\"Activity for Planting A\"]')"), true, 'Click-open details survive pointer departure'); // CHANGE
        await win.webContents.executeJavaScript("(async()=>{ui.editor.graph.view.getState=()=>({x:80,y:90,width:300,height:200});window.fireStatus((await window.trellisShare.getStatus()).canvases);})()"); // NEW
        assert.equal(await win.webContents.executeJavaScript("document.querySelector('[data-object-key]').style.left"), '384px', 'Badges follow graph view geometry'); // NEW
        win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' }); await new Promise(resolve => setTimeout(resolve, 50)); // NEW
        assert.equal(await win.webContents.executeJavaScript("!!document.querySelector('[aria-label=\"Activity for Planting A\"]')"), false); // NEW
        await win.webContents.executeJavaScript(`(async()=>{ // CHANGE
            window.statusFixture=(await trellisShare.getStatus()).canvases[0];window.statusRevision=0;window.statusCalls=[];statusFixture.connectedCollaborators=0; // CHANGE
            window.pendingStatus=[{userId:'alice',name:'Alice',deviceId:'peer',sessionId:'old-session',online:false,saveState:'pending',targets:[JSON.stringify(['','planting'])]}]; // CHANGE
            window.viewingStatus=[];window.statusSnapshot=()=>({sessionId:'native-local',actorUserId:'admin',observationRevision:++statusRevision,holds:[],presence:viewingStatus,reservations:[],pendingChanges:pendingStatus}); // CHANGE: drive fresh/expired presence through the same native activity path as pending-work notifications.
            trellisShare.activityAction=async input=>{statusCalls.push(input);return{ok:true,collaboration:statusSnapshot()}};statusFixture.collaboration=statusSnapshot();fireStatus([statusFixture]); // CHANGE
        })()`); // CHANGE
        await click(win, 'Alice · changed · pending project save · offline · status unconfirmed'); // CHANGE
        const pendingStatus = await win.webContents.executeJavaScript(`(()=>{const p=document.querySelector('[aria-label="Activity for Planting A"]');return{text:p.textContent,buttons:[...p.querySelectorAll('button')].filter(b=>!b.hidden).map(b=>b.textContent),focused:document.activeElement.textContent}})()`); // CHANGE
        assert.match(pendingStatus.text, /current save status is unknown/); assert.match(pendingStatus.text, /this notice does not block editing/); assert.match(pendingStatus.text, /Working locally\. No other computers are connected/); // CHANGE
        assert.deepEqual(pendingStatus.buttons, ['Close']); assert.equal(pendingStatus.focused, 'Close'); // CHANGE: automatic activity updates replace the manual refresh control.
        await win.webContents.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))'); // CHANGE: capture the committed pending-status frame in the hidden window.
        fs.writeFileSync(path.join(output, 'pending-without-hold.png'), (await win.webContents.capturePage()).toPNG()); // CHANGE
        await win.webContents.executeJavaScript('window.eventsBeforeStatus=editorEvents;window.focusedStatusControl=document.activeElement;window.statusPanel=document.querySelector(\'[aria-label="Activity for Planting A"]\');void 0;'); // CHANGE
        await win.webContents.executeJavaScript('pendingStatus=[];statusFixture.collaboration=statusSnapshot();fireStatus([statusFixture]);void 0;'); // CHANGE
        assert.deepEqual(await win.webContents.executeJavaScript('statusCalls.map(call=>call.kind)'), []); assert.equal(await win.webContents.executeJavaScript('editorEvents===eventsBeforeStatus'), true, 'Automatic updates do not reach graph shortcuts'); // CHANGE
        assert.equal(await win.webContents.executeJavaScript('document.activeElement===focusedStatusControl'), true, 'Live completion keeps keyboard focus'); // CHANGE
        assert.match(await win.webContents.executeJavaScript('statusPanel.textContent'), /No viewing activity, pending changes, or editing holds are currently reported for this object\./); // CHANGE
        await win.webContents.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))'); // CHANGE: wait for resolved-status paint before visual QA.
        fs.writeFileSync(path.join(output, 'resolved-pending-status.png'), (await win.webContents.capturePage()).toPNG()); // CHANGE
        win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' }); await new Promise(resolve => setTimeout(resolve, 50)); // CHANGE
        assert.equal(await win.webContents.executeJavaScript('statusPanel.isConnected'), false, 'Escape closes the pinned status dialog'); // CHANGE
        await win.webContents.executeJavaScript(`viewingStatus=[{userId:'bob',name:'Bob',deviceId:'peer',sessionId:'viewer',online:true,targets:[JSON.stringify(['','planting'])]}];statusFixture.collaboration=statusSnapshot();fireStatus([statusFixture]);void 0;`); // CHANGE
        await click(win, 'Bob · viewing'); // CHANGE
        await win.webContents.executeJavaScript('window.viewingPanel=document.querySelector(\'[aria-label="Activity for Planting A"]\');window.viewingClose=document.activeElement;viewingStatus=[];statusFixture.collaboration=statusSnapshot();fireStatus([statusFixture]);void 0;'); // CHANGE
        assert.deepEqual(await win.webContents.executeJavaScript('({open:viewingPanel.isConnected,badge:!!document.querySelector("[data-object-key]"),focused:document.activeElement===viewingClose})'), { open: true, badge: false, focused: true }, 'Automatic viewing expiry removes the badge and retains open details and keyboard focus'); // CHANGE
        assert.match(await win.webContents.executeJavaScript('viewingPanel.textContent'), /No viewing activity, pending changes, or editing holds/); // CHANGE
        await win.webContents.executeJavaScript(`viewingStatus=[{userId:'bob',name:'Bob',deviceId:'peer',sessionId:'viewer',online:true,targets:[JSON.stringify(['','planting'])]}];statusFixture.collaboration=statusSnapshot();fireStatus([statusFixture]);void 0;`); // CHANGE
        assert.match(await win.webContents.executeJavaScript('viewingPanel.textContent'), /Bob is viewing/); await click(win, 'Close'); // CHANGE
        assert.equal(await win.webContents.executeJavaScript('document.activeElement===document.querySelector("[data-object-key]")'), true, 'Close restores the reconnected viewing badge'); // CHANGE
        await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<!doctype html><div id="graph" style="position:relative;width:800px;height:600px"></div>')); // NEW
        await win.webContents.executeJavaScript(fs.readFileSync(path.join(project, 'drawio/src/main/webapp/js/trellis-sync-contract.js'), 'utf8')); // CHANGE: navigation creates a fresh renderer global.
        await win.webContents.executeJavaScript('window.mxLoadResources=false;window.mxLoadStylesheets=false;'); // NEW
        await win.webContents.executeJavaScript(fs.readFileSync(path.join(project, 'drawio/src/main/webapp/mxgraph/mxClient.js'), 'utf8')); // NEW
        await win.webContents.executeJavaScript(fs.readFileSync(path.join(project, 'drawio/src/main/webapp/js/trellis-editing-holds.js'), 'utf8')); // CHANGE: genuine label typing uses the production editing lifecycle.
        await win.webContents.executeJavaScript(` // NEW
            window.graph = new mxGraph(document.getElementById('graph')); graph.isSpecialColor=()=>false;graph.getCompositeParent=cell=>cell;graph.convertValueToString=cell=>cell.value?.getAttribute?.('label')||'';
            const value = mxUtils.createXmlDocument().createElement('object'); value.setAttribute('label','Planting'); value.setAttribute('planting_id','planting');
            window.planting = graph.insertVertex(null,'planting',value,40,40,180,100);
            window.calls = []; window.modified = false; window.rawSaves = 0; window.persisted = '';
            const serialize = () => mxUtils.getXml(new mxCodec().encode(graph.model));
            graph.model.addListener(mxEvent.CHANGE,()=>window.modified=true);
            window.currentFile = {data:serialize(), fileObject:{path:'C:/test/Live.drawio'},getTitle:()=> 'Live.drawio',isModified:()=>window.modified,setModified:x=>window.modified=x,save(_r,done){window.rawSaves++;done();},fileSaved(_x,_d,done){done();}};
            window.liveInfo = {ok:true,managed:true,protocolVersion:window.TrellisSyncContract.garden,shareId:'live',diagramId:'live',diagramPath:currentFile.fileObject.path}; // CHANGE: use the same supported contract for real-graph persistence.
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
        await win.webContents.executeJavaScript("graph.cellLabelChanged=(cell,label)=>{const next=cell.value.cloneNode(true);next.setAttribute('label',label);graph.model.setValue(cell,next);};graph.startEditingAtCell(planting);graph.cellEditor.textarea.innerText='';graph.cellEditor.textarea.focus(); void 0;"); // CHANGE: acquire through actual user input rather than a programmatic value replacement.
        await win.webContents.insertText('Native label draft'); // CHANGE
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
