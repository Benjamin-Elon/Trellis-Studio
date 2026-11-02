/** Native module-style gestures and handoff controls, isolated from the installed application/profile. */ // NEW
const assert = require('node:assert/strict'); // NEW
const fs = require('node:fs'); // NEW
const os = require('node:os'); // NEW
const path = require('node:path'); // NEW
const { app, BrowserWindow } = require('electron'); // NEW
const webapp = path.resolve(__dirname, '../../drawio/src/main/webapp'), profile = fs.mkdtempSync(path.join(os.tmpdir(), 'trellis-hold-countdown-')); // NEW
app.setPath('userData', profile); app.disableHardwareAcceleration(); app.commandLine.appendSwitch('in-process-gpu'); // NEW
app.whenReady().then(async () => { // NEW
    const win = new BrowserWindow({ show: false, width: 1100, height: 850, webPreferences: { sandbox: false, backgroundThrottling: false } }); // NEW
    const run = source => win.webContents.executeJavaScript(source), settle = () => run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))'); // NEW
    const mouse = (type, x, y) => win.webContents.sendInputEvent({ type, x, y, button: 'left', clickCount: 1 }); // NEW
    try { // NEW
        const host = path.join(profile, 'host.html'); fs.writeFileSync(host, '<!doctype html><body style="margin:0"><div id="graph" style="position:absolute;inset:0"></div><input id="typing" value="Unfinished year plan" style="position:absolute;left:30px;top:30px"></body>'); await win.loadFile(host); // NEW
        await run('window.mxLoadResources=false;window.mxLoadStylesheets=false;'); await run(fs.readFileSync(path.join(webapp, 'mxgraph/mxClient.js'), 'utf8')); // NEW
        await run('window.Editor={};' + fs.readFileSync(path.join(webapp, 'js/grapheditor/Editor.js'), 'utf8').match(/Editor\.moveImage = '[^']+';/)[0]); // NEW
        await run(fs.readFileSync(path.join(webapp, 'js/trellis-editing-holds.js'), 'utf8')); // NEW
        await run(` // NEW
            window.graph=new mxGraph(document.getElementById('graph')); const cell=graph.insertVertex(graph.getDefaultParent(),'garden','Garden',100,150,250,200);graph.setSelectionCell(cell);
            window.calls=[];window.errors=[];addEventListener('error',event=>errors.push(event.message));window.target='["page","garden"]';
            window.holds=TrellisEditingHolds.create({editor:{graph}},{isCollaborative:()=>true,status:message=>calls.push(message),claim:async()=>({ok:true}),release:async()=>{calls.push('release');holds.update([],'local')},lose:async targets=>{calls.push('recover');holds.discard(targets);holds.update([],'local')}});
            holds.register({kind:'year-planner',targets:[target],capture:()=>({year:2026,plan:{notes:typing.value}}),save:async()=>{calls.push('save');return true},discard:()=>calls.push('discard')});
            window.request=()=>holds.update([{key:target,claimId:'claim',sessionId:'local',requested:true,expiresAt:Date.now()+300000,requesters:[{name:'Alice'}],objectLabel:'Garden year planner'}],'local');
            window.snapshot=()=>{const card=document.querySelector('[data-trellis-hold-countdown]'),box=card.getBoundingClientRect(),grip=card.querySelector('[data-trellis-hold-drag-handle]').getBoundingClientRect();return{x:box.left,y:box.top,right:box.right,bottom:box.bottom,width:innerWidth,height:innerHeight,grip:{x:Math.round(grip.left+grip.width/2),y:Math.round(grip.top+grip.height/2)},xml:mxUtils.getXml(new mxCodec().encode(graph.model)),selection:graph.getSelectionCells().map(c=>c.id)}};
            typing.focus();request();void 0;
        `); // NEW
        await settle(); assert.equal(await run('document.activeElement.id'), 'typing'); const before = await run('snapshot()'); // NEW
        mouse('mouseDown', before.grip.x, before.grip.y); mouse('mouseMove', before.grip.x - 80, before.grip.y + 40); await settle(); mouse('mouseUp', before.grip.x - 80, before.grip.y + 40); await settle(); // NEW
        const after = await run('snapshot()'); assert.equal(after.x, before.x - 80); assert.equal(after.y, before.y + 40); assert.equal(after.xml, before.xml); assert.deepEqual(after.selection, before.selection); // NEW
        mouse('mouseDown', after.grip.x, after.grip.y); mouse('mouseMove', after.grip.x - 30, after.grip.y + 30); await settle(); // NEW
        win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' }); await settle(); mouse('mouseUp', after.grip.x - 30, after.grip.y + 30); await settle(); // NEW
        assert.equal((await run('snapshot()')).x, after.x); assert.equal((await run('snapshot()')).y, after.y); // NEW
        await run('document.querySelector("[data-trellis-hold-drag-handle]").focus()'); win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Left' }); await settle(); assert.equal((await run('snapshot()')).x, after.x - 16); // NEW
        win.setSize(420, 440); await settle(); const narrow = await run('snapshot()'); assert.ok(narrow.x >= 8 && narrow.right <= narrow.width - 7); assert.ok(narrow.bottom <= narrow.height - 7); // NEW
        const output = path.resolve(__dirname, '../../.test-artifacts/request-holds'); fs.mkdirSync(output, { recursive: true }); fs.writeFileSync(path.join(output, 'countdown.png'), (await win.webContents.capturePage()).toPNG()); // NEW
        await run('[...document.querySelectorAll("[data-trellis-hold-countdown] button")].find(button=>button.textContent==="Save & release").click();void 0'); await settle(); // NEW
        assert.deepEqual(await run('calls'), ['save', 'release', 'discard']); assert.equal(await run('!!document.querySelector("[data-trellis-hold-countdown]")'), false); // NEW
        await run('holds.register({kind:"planting",targets:[target],capture:()=>({spacingX:"unfinished"}),save:async()=>true,discard:()=>calls.push("expired discard")});holds.update([{key:target,claimId:"expired",sessionId:"local",requested:true,expiresAt:Date.now()-1}],"local");void 0'); await settle(); // NEW
        assert.deepEqual((await run('calls')).slice(-2), ['recover', 'expired discard']); assert.equal(await run('mxUtils.getXml(new mxCodec().encode(graph.model))'), before.xml); assert.deepEqual(await run('errors'), []); // NEW
        win.setSize(1000, 760); // CHANGE
        await run(` // CHANGE
            window.review=document.createElement('section');review.style.cssText='position:fixed;left:30px;top:60px;width:550px;padding:18px;background:white;border:1px solid #888';review.innerHTML='<h2>Retained garden draft</h2><textarea style="width:95%;height:100px">Unfinished garden entries</textarea><button>Apply</button><button>Close</button>';document.body.append(review);
            window.submissions=0;window.closes=0;review.querySelector('textarea').addEventListener('blur',()=>submissions++);review.querySelector('button').addEventListener('click',()=>submissions++);review.lastChild.addEventListener('click',()=>closes++);
            window.retainedEditor=holds.register({kind:'inventory',element:review,targets:[target],capture:()=>({text:review.querySelector('textarea').value}),save:async()=>{submissions++;return true},discard:()=>{}});holds.freeze([target],'The requested editing handoff deadline ended.');holds.preservation([target],true);review.querySelector('textarea').focus();void 0; // CHANGE
        `); await settle(); // CHANGE
        win.webContents.sendInputEvent({ type: 'char', keyCode: 'X' }); await settle(); // CHANGE
        assert.equal(await run('review.querySelector("textarea").value'), 'Unfinished garden entries'); // CHANGE
        win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'S', modifiers: ['control'] }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'S', modifiers: ['control'] }); await settle(); // CHANGE
        await run('review.querySelector("button").click();review.querySelector("textarea").blur();void 0'); await settle(); assert.equal(await run('submissions'), 0); // CHANGE
        await run('review.querySelector("textarea").focus();review.querySelector("textarea").select();void 0'); assert.equal(await run('review.querySelector("textarea").selectionEnd-review.querySelector("textarea").selectionStart'), 'Unfinished garden entries'.length); // CHANGE
        assert.match(await run('review.querySelector("[role=alert]").textContent'), /private recovery draft has been saved/); // CHANGE
        fs.writeFileSync(path.join(output, 'frozen-editor.png'), (await win.webContents.capturePage()).toPNG()); // CHANGE
        await run('review.lastChild.click();void 0'); assert.equal(await run('closes'), 1); assert.equal(await run('retainedEditor.acquire().then(()=>false,()=>true)'), true); assert.equal(await run('submissions'), 0); // CHANGE
        await run(fs.readFileSync(path.join(webapp, 'js/trellis-sync-contract.js'), 'utf8')); await run(fs.readFileSync(path.join(webapp, 'js/trellis-background-saving.js'), 'utf8')); // CHANGE
        await run(` // CHANGE
            window.fakeTime=0;window.quietTimers=new Map();window.quietTimerId=0;const realBackground=TrellisBackgroundSaving;
            window.TrellisBackgroundSaving={...realBackground,create:options=>window.managedController=realBackground.create({...options,now:()=>fakeTime,setInterval:()=>1,clearInterval(){},setTimeout:(fn,delay)=>{quietTimers.set(++quietTimerId,{fn,at:fakeTime+delay});return quietTimerId},clearTimeout:id=>quietTimers.delete(id)})};
            window.managedFile={data:'<mxGraphModel><root/></mxGraphModel>',fileObject:{path:'C:/fixture/Garden.drawio'},isModified:()=>false,setModified(){throw Error('Private typing must not mark the graph dirty')},clearAutosave(){},save(){throw Error('Private typing must not save the graph')},fileSaved(){}};
            const source=()=>mxUtils.getXml(new mxCodec().encode(graph.model));managedFile.data=source();
            window.actorRevision=0;window.activityState=()=>({sessionId:'local',actorUserId:'alice',observationRevision:++actorRevision,holds:[],presence:[],reservations:[]});
            window.trellisShare={setContext:async()=>{},getStatus:async()=>({canvases:[{diagramPath:managedFile.fileObject.path,state:'upToDate'}]}),getSyncthingShareInfo:async()=>({managed:true,protocolVersion:4,shareId:'fixture',diagramId:'fixture',diagramPath:managedFile.fileObject.path}),activityAction:async()=>({ok:true,collaboration:activityState()}),recoveryAction:async()=>({ok:true,drafts:[]}),collaborationAction:async()=>({ok:true,xml:source(),collaboration:activityState()}),onStatus(){},onActivity(){},importHistory:async()=>({entries:[]})};
            window.Trellis={users:{getCurrentUser:()=>({id:'alice'}),listUsers:()=>[]},history:{getDiagramId:()=> 'fixture'}};window.__trellisLiveUpdatesForBenchmark=true;
            window.managedUi={editor:Object.assign(new mxEventSource(),{graph,setStatus(){}}),getCurrentFile:()=>managedFile,getFileData:source,currentPage:{getId:()=> 'page'},actions:{addAction:()=>({})},menus:{get:()=>null}};window.Draw={loadPlugin:fn=>fn(managedUi)};
            window.advanceQuiet=async time=>{fakeTime=time;for(const [id,timer]of quietTimers)if(timer.at<=time){quietTimers.delete(id);timer.fn()}for(let i=0;i<12;i++)await Promise.resolve()};void 0;
        `); await run(fs.readFileSync(path.join(webapp, 'plugins/garden_planner_plugins/Trellis_Syncthing.js'), 'utf8')); await settle(); // CHANGE
        assert.equal(await run('managedFile.autosaveDelay'), 20000); // CHANGE
        await run('window.activityForm=document.createElement("section");activityForm.dataset.trellisCollaborativeEditor="inventory";activityForm.innerHTML="<input name=notes><input type=search>";document.body.append(activityForm);window.quietFinished=false;managedController.waitForQuiet().then(()=>quietFinished=true);advanceQuiet(19999);activityForm.firstChild.focus();void 0'); // CHANGE
        await win.webContents.insertText('private form text'); await run('advanceQuiet(20000)'); assert.equal(await run('quietFinished'), false); // CHANGE
        await run('advanceQuiet(39998)'); assert.equal(await run('quietFinished'), false); await run('advanceQuiet(39999)'); assert.equal(await run('quietFinished'), true); assert.equal(await run('managedFile.isModified()'), false); // CHANGE
        await run('activityForm.lastChild.focus();quietFinished=false;managedController.activity();managedController.waitForQuiet().then(()=>quietFinished=true);advanceQuiet(59998);void 0'); await win.webContents.insertText('unrelated search'); await run('advanceQuiet(59999)'); assert.equal(await run('quietFinished'), true); // CHANGE
        console.log('Native hold countdown checks passed'); win.destroy(); app.exit(0); // NEW
    } catch (error) { console.error(error); win.destroy(); app.exit(1); } // NEW
}); // NEW
