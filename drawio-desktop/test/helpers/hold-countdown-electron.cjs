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
        console.log('Native hold countdown checks passed'); win.destroy(); app.exit(0); // NEW
    } catch (error) { console.error(error); win.destroy(); app.exit(1); } // NEW
}); // NEW
