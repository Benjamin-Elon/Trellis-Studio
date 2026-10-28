/** Real mxGraph, Quickstart, and native input; only application-shell services are stubbed. */ // NEW
const assert = require('node:assert/strict'); // NEW
const fs = require('node:fs'); // NEW
const os = require('node:os'); // NEW
const path = require('node:path'); // NEW
const { app, BrowserWindow } = require('electron'); // NEW
const webapp = path.resolve(__dirname, '../../drawio/src/main/webapp'); // NEW
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'trellis-quickstart-drag-')); // NEW
app.setPath('userData', profile); app.disableHardwareAcceleration(); app.commandLine.appendSwitch('in-process-gpu'); // NEW

app.whenReady().then(async () => { // NEW
    const win = new BrowserWindow({ show: false, width: 1100, height: 850, webPreferences: { sandbox: false, backgroundThrottling: false } }); // NEW
    const run = expression => win.webContents.executeJavaScript(expression); // NEW
    const settle = () => run('new Promise(resolve=>setTimeout(()=>requestAnimationFrame(()=>requestAnimationFrame(resolve)),50))'); // NEW
    const mouse = (type, x, y) => win.webContents.sendInputEvent({ type, x, y, button: 'left', clickCount: 1 }); // NEW
    try { // NEW
        const host = path.join(profile, 'host.html'); // NEW
        fs.writeFileSync(host, '<!doctype html><body style="margin:0"><div id="graph" style="position:absolute;inset:0;overflow:hidden"></div><button data-trellis-quickstart="add-bed" style="position:absolute;right:20px;top:20px">Add Garden Bed</button></body>'); // NEW
        await win.loadFile(host); // NEW
        await run('window.mxLoadResources=false;window.mxLoadStylesheets=false;'); // NEW
        await run(fs.readFileSync(path.join(webapp, 'mxgraph/mxClient.js'), 'utf8')); // NEW
        await run('window.Editor={};' + fs.readFileSync(path.join(webapp, 'js/grapheditor/Editor.js'), 'utf8').match(/Editor\.moveImage = '[^']+';/)[0]); // NEW
        await run(`
            window.graph=new mxGraph(document.getElementById('graph'));
            const value=mxUtils.createXmlDocument().createElement('object');
            for(const [key,val] of Object.entries({garden_module:'1',garden_name:'Native garden',city_id:'1',unit_system:'metric',default_bed_width_cm:'80',default_bed_length_cm:'300'}))value.setAttribute(key,val);
            window.garden=graph.insertVertex(graph.getDefaultParent(),'garden',value,500,100,300,300);graph.setSelectionCell(garden);
            graph.__trellisUsers={getCurrentUser:()=>({id:'native',portableIdentityId:'native'}),isLoggedIn:()=>true,canEditCell:()=>true};
            window.ui=Object.assign(new mxEventSource(),{editor:Object.assign(new mxEventSource(),{graph}),getCurrentFile:()=>({getTitle:()=> 'Native test'}),actions:{addAction:()=>({})},menus:{get:()=>null}});
            window.Draw={loadPlugin:fn=>fn(ui)};window.errors=[];window.addEventListener('error',event=>errors.push(event.message));
            window.snapshot=()=>{const card=document.querySelector('.trellis-quickstart-card'),box=card.getBoundingClientRect(),handle=card.querySelector('[data-trellis-quickstart-drag-handle]').getBoundingClientRect();return {x:box.left,y:box.top,right:box.right,bottom:box.bottom,width:innerWidth,height:innerHeight,grip:{x:Math.round(handle.left+handle.width/2),y:Math.round(handle.top+handle.height/2)},xml:mxUtils.getXml(new mxCodec().encode(graph.model)),selection:graph.getSelectionCells().map(cell=>cell.id),saved:graph.__trellisQuickstart.getState().preferences.position}};
            void 0;
        `); // NEW
        await run(fs.readFileSync(path.join(webapp, 'plugins/garden_planner_plugins/Garden_Quickstart.js'), 'utf8')); // NEW
        await run('graph.__trellisQuickstart.show()'); await settle(); // NEW
        const before = await run('snapshot()'); // NEW
        mouse('mouseDown', before.grip.x, before.grip.y); await settle(); // NEW
        mouse('mouseMove', before.grip.x + 60, before.grip.y + 45); await run('graph.__trellisQuickstart.refresh()'); await settle(); // NEW
        mouse('mouseUp', before.grip.x + 60, before.grip.y + 45); await settle(); // NEW
        const after = await run('snapshot()'); // NEW
        assert.equal(after.x, before.x + 60); assert.equal(after.y, before.y + 45); // NEW
        assert.equal(after.xml, before.xml); assert.deepEqual(after.selection, before.selection); assert.deepEqual(after.saved, { x: after.x, y: after.y }); // NEW
        await run('graph.__trellisQuickstart.refresh()'); await settle(); assert.equal((await run('snapshot()')).x, after.x); // NEW

        mouse('mouseDown', after.grip.x, after.grip.y); mouse('mouseMove', after.grip.x + 40, after.grip.y + 30); await settle(); // NEW
        win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' }); await settle(); // NEW
        mouse('mouseUp', after.grip.x + 40, after.grip.y + 30); await settle(); // NEW
        const cancelled = await run('snapshot()'); assert.equal(cancelled.x, after.x); assert.equal(cancelled.y, after.y); // NEW
        await run("document.querySelector('[data-trellis-quickstart-drag-handle]').focus()"); // NEW
        win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Right' }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Right' }); await settle(); // NEW
        assert.equal((await run('snapshot()')).x, after.x + 16); // NEW

        await run("window.modal=document.createElement('div');document.body.appendChild(modal);ui.dialog={container:modal};graph.__trellisQuickstart.refresh()"); await settle(); // NEW
        assert.equal(await run("document.querySelector('[data-trellis-quickstart-drag-handle]').hidden"), true); // NEW
        await run('ui.dialog=null;graph.__trellisQuickstart.refresh()'); await settle(); await run('modal.remove()'); // NEW
        assert.equal(await run("document.querySelector('[data-trellis-quickstart-drag-handle]').hidden"), false); // NEW
        const saved = (await run('snapshot()')).saved; // NEW
        await run('graph.__trellisQuickstart.close();graph.__trellisQuickstart.show()'); await settle(); // NEW
        const restored = await run('snapshot()'); assert.equal(restored.x, saved.x); assert.equal(restored.y, saved.y); // NEW
        win.setSize(460, 720); await settle(); const narrow = await run('snapshot()'); // NEW
        assert.ok(narrow.x >= 8 && narrow.right <= narrow.width - 8 && narrow.y >= 8 && narrow.bottom <= narrow.height - 8, JSON.stringify(narrow)); // NEW
        assert.equal(narrow.xml, before.xml); assert.deepEqual(narrow.selection, before.selection); assert.deepEqual(await run('errors'), []); // NEW
        const output = path.resolve(__dirname, '../../.test-artifacts'); fs.mkdirSync(output, { recursive: true }); // NEW
        fs.writeFileSync(path.join(output, 'quickstart-drag-electron.png'), (await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG()); // NEW
        console.log('Native Quickstart drag checks passed'); // NEW
    } finally { win.destroy(); } // NEW
    app.quit(); // NEW
}).catch(error => { console.error(error.stack || error); app.exit(1); }); // NEW
