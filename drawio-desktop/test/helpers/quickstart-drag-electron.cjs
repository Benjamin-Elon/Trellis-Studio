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
        await run('window.__surfacePluginLoader=Draw.loadPlugin;Draw.loadPlugin=()=>{};' + fs.readFileSync(path.join(webapp, 'plugins/garden_planner_plugins/Trellis_UI_Cleanup.js'), 'utf8') + ';Draw.loadPlugin=window.__surfacePluginLoader;delete window.__surfacePluginLoader;void 0;'); // NEW: exercise shared surfaces during native interaction checks.
        await run('graph.__trellisQuickstart.show()'); await settle(); // NEW
        console.log('Quickstart native stage: canvas input'); // CHANGE
        const before = await run('snapshot()'); // NEW
        await run(` // CHANGE: prepend overlapping controls so hit-testing depends on layers rather than DOM order.
            window.layerProbe=document.createElement('button'); // CHANGE
            layerProbe.style.cssText='position:fixed;left:${before.x}px;top:${before.y}px;width:310px;height:80px;z-index:10030'; // CHANGE
            window.probeClicks=0;layerProbe.onclick=()=>probeClicks++;document.body.prepend(layerProbe); // CHANGE
        `); await settle(); // CHANGE
        assert.equal(await run(`document.elementFromPoint(${before.grip.x},${before.grip.y})===layerProbe`), true); // CHANGE
        mouse('mouseDown', before.grip.x, before.grip.y); mouse('mouseUp', before.grip.x, before.grip.y); await settle(); // CHANGE
        assert.equal(await run('probeClicks'), 1); // CHANGE
        await run("layerProbe.style.zIndex='2000000000'"); await settle(); // CHANGE: modal backdrops also cover the floating card.
        assert.equal(await run(`document.elementFromPoint(${before.grip.x},${before.grip.y})===layerProbe`), true); // CHANGE
        await run('layerProbe.remove()'); await settle(); // CHANGE
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
        console.log('Quickstart native stage: transformed dialog input'); // CHANGE

        await run(` // CHANGE: use a positioned workflow and a local overlay like Year Planner's pickers.
            window.modal=document.createElement('div');modal.dataset.quickstartSurface='plan'; // CHANGE
            modal.style.cssText='position:fixed;left:320px;top:320px;transform:translate(-50%,-50%);overflow:hidden;width:600px;height:600px;z-index:2000000000;background:white'; // CHANGE
            document.body.appendChild(modal);ui.dialog={container:modal};graph.__trellisQuickstart.refresh(); // CHANGE
        `); await settle(); // CHANGE
        assert.equal(await run("document.querySelector('[data-trellis-quickstart-drag-handle]').hidden"), false); // CHANGE
        const companion = await run('snapshot()'); // CHANGE
        assert.equal(await run("document.querySelector('.trellis-quickstart-card').getBoundingClientRect().width"), 310); assert.equal(companion.x, 16); assert.equal(companion.height - companion.bottom, 16); // CHANGE: Year Planner now defaults to viewport bottom left.
        mouse('mouseDown', companion.grip.x, companion.grip.y); mouse('mouseMove', companion.grip.x + 30, companion.grip.y - 35); mouse('mouseUp', companion.grip.x + 30, companion.grip.y - 35); await settle(); // CHANGE
        const movedCompanion = await run('snapshot()'); assert.equal(movedCompanion.x, companion.x + 30); assert.equal(movedCompanion.y, companion.y - 35); // CHANGE
        assert.deepEqual(movedCompanion.saved, companion.saved); // CHANGE
        await run("modal.style.left='340px'"); await settle(); assert.equal((await run('snapshot()')).x, movedCompanion.x + 20); // CHANGE
        console.log('Quickstart native stage: nested picker input'); // CHANGE
        await run(` // CHANGE: a local overlay does not clip or hide the body-level parent companion.
            window.pickerLayer=document.createElement('div');pickerLayer.style.cssText='position:absolute;inset:0;z-index:5;background:#fff'; // CHANGE
            modal.prepend(pickerLayer); // CHANGE
        `); await settle(); // CHANGE
        const covered = await run("(()=>{const box=document.querySelector('.trellis-quickstart-card header').getBoundingClientRect();return {x:Math.round(box.left+box.width/2),y:Math.round(box.top+box.height/2)}})()"); // CHANGE
        assert.equal(await run(`!!document.elementFromPoint(${covered.x},${covered.y}).closest('.trellis-quickstart-card')`), true); // CHANGE
        await run(` // CHANGE: the picker takes logical ownership while the companion stays outside clipped contents.
            window.picker=document.createElement('div');picker.dataset.quickstartSurface='crop-picker'; // CHANGE
            picker.style.cssText='position:relative;margin:20px;padding:12px;background:white';picker.setAttribute('role','dialog');pickerLayer.appendChild(picker); // CHANGE
            window.pickerDismissals=0;window.pickerEscape=event=>{if(event.key==='Escape'){pickerDismissals++;event.stopImmediatePropagation();}};window.addEventListener('keydown',pickerEscape,true); // CHANGE
        `); await settle(); // CHANGE
        assert.equal(await run("graph.__trellisQuickstart.getCompanion(picker)===document.querySelector('.trellis-quickstart-card')"), true); // CHANGE
        const pickerBefore = await run('snapshot()'); // CHANGE
        mouse('mouseDown', pickerBefore.grip.x, pickerBefore.grip.y); mouse('mouseMove', pickerBefore.grip.x + 40, pickerBefore.grip.y + 30); await settle(); // CHANGE
        win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' }); await settle(); // CHANGE
        mouse('mouseUp', pickerBefore.grip.x + 40, pickerBefore.grip.y + 30); await settle(); // CHANGE
        assert.equal(await run('pickerDismissals'), 0); assert.equal((await run('snapshot()')).x, pickerBefore.x); // CHANGE
        await run("window.removeEventListener('keydown',pickerEscape,true)"); // CHANGE
        console.log('Quickstart native stage: collapse and scrolling'); // CHANGE
        const collapse = await run("(()=>{const button=[...document.querySelectorAll('.trellis-quickstart-card button')].find(node=>node.textContent==='Collapse'),box=button.getBoundingClientRect();return {x:Math.round(box.left+box.width/2),y:Math.round(box.top+box.height/2)}})()"); // CHANGE
        assert.equal(await run(`document.elementFromPoint(${collapse.x},${collapse.y}).textContent==='Collapse'`), true); // CHANGE
        mouse('mouseDown', collapse.x, collapse.y); mouse('mouseUp', collapse.x, collapse.y); await settle(); // CHANGE
        assert.equal(await run('graph.__trellisQuickstart.getState().preferences.collapsed'), true); // CHANGE
        assert.equal(await run("document.querySelector('[aria-controls=trellis-quickstart-body]').textContent==='Expand'&&document.querySelector('[aria-controls=trellis-quickstart-body]').getAttribute('aria-expanded')==='false'"), true); // NEW
        mouse('mouseDown', collapse.x, collapse.y); mouse('mouseUp', collapse.x, collapse.y); await settle(); // CHANGE
        assert.equal(await run('graph.__trellisQuickstart.getState().preferences.collapsed'), false); // CHANGE
        await run("document.querySelector('.trellis-quickstart-card').style.maxHeight='100px'"); await settle(); // CHANGE
        await run("document.querySelector('.trellis-quickstart-body').scrollTop=1000"); // CHANGE
        assert.equal(await run("(()=>{const handle=document.querySelector('[data-trellis-quickstart-drag-handle]'),box=handle.getBoundingClientRect();return document.querySelector('.trellis-quickstart-body').scrollTop>0&&document.elementFromPoint(box.left+box.width/2,box.top+box.height/2)===handle;})()"), true); // CHANGE
        await run("document.querySelector('.trellis-quickstart-card').style.maxHeight=''"); await settle(); // CHANGE
        console.log('Quickstart native stage: canvas restoration'); // CHANGE
        await run('pickerLayer.remove()'); await settle(); assert.equal((await run('snapshot()')).x, movedCompanion.x + 20); // CHANGE
        assert.equal(await run("graph.__trellisQuickstart.getCompanion(modal)===document.querySelector('.trellis-quickstart-card')"), true); // CHANGE
        await run('modal.remove();ui.dialog=null;graph.__trellisQuickstart.refresh()'); await settle(); // CHANGE
        assert.equal(await run("document.querySelector('[data-trellis-quickstart-drag-handle]').hidden"), false); // NEW
        assert.equal(await run("getComputedStyle(document.querySelector('.trellis-quickstart-card')).zIndex"), '10020'); // CHANGE
        const saved = (await run('snapshot()')).saved; // NEW
        await run('graph.__trellisQuickstart.close();graph.__trellisQuickstart.show()'); await settle(); // NEW
        const restored = await run('snapshot()'); assert.equal(restored.x, saved.x); assert.equal(restored.y, saved.y); // NEW
        win.setSize(460, 720); await settle(); const narrow = await run('snapshot()'); // NEW
        assert.ok(narrow.x >= 8 && narrow.right <= narrow.width - 8 && narrow.y >= 8 && narrow.bottom <= narrow.height - 8, JSON.stringify(narrow)); // NEW
        assert.equal(narrow.xml, before.xml); assert.deepEqual(narrow.selection, before.selection); assert.deepEqual(await run('errors'), []); // NEW
        const output = path.resolve(__dirname, '../../.test-artifacts'); fs.mkdirSync(output, { recursive: true }); // NEW
        console.log('Quickstart native stage: system speech'); // NEW
        await run(` // NEW
            window.nativeSpeechResult={supported:!!(window.speechSynthesis&&window.SpeechSynthesisUtterance),status:'unavailable',voices:[]};
            if(nativeSpeechResult.supported){
                nativeSpeechResult.voices=speechSynthesis.getVoices().map(voice=>({name:voice.name,local:voice.localService}));
                window.originalSpeak=speechSynthesis.speak.bind(speechSynthesis);
                speechSynthesis.speak=speech=>{nativeSpeechResult.status='pending';const ended=speech.onend,failed=speech.onerror;speech.onend=event=>{nativeSpeechResult.status='ended';ended?.(event)};speech.onerror=event=>{nativeSpeechResult.status=event.error||'error';failed?.(event)};originalSpeak(speech)};
            }
            document.querySelector('[data-quickstart-focus=read-aloud]').click();void 0;
        `); await settle(); // NEW
        const speech = await run("new Promise(resolve=>{const deadline=Date.now()+8000;const poll=()=>{if(nativeSpeechResult.status!=='pending'||Date.now()>=deadline){nativeSpeechResult.voices=window.speechSynthesis?.getVoices().map(voice=>({name:voice.name,local:voice.localService}))||[];resolve(nativeSpeechResult)}else setTimeout(poll,100)};poll()})"); // NEW
        await run("document.querySelector('[data-quickstart-focus=read-aloud]').click();if(window.originalSpeak)speechSynthesis.speak=originalSpeak;void 0"); await settle(); // NEW
        fs.writeFileSync(path.join(output, 'quickstart-speech-electron.json'), JSON.stringify(speech, null, 2)); console.log('System speech result: ' + JSON.stringify(speech)); // NEW
        console.log('Quickstart native stage: screenshot'); // CHANGE
        fs.writeFileSync(path.join(output, 'quickstart-drag-electron.png'), (await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG()); // NEW
        console.log('Native Quickstart drag checks passed'); // NEW
    } finally { win.destroy(); } // NEW
    app.quit(); // NEW
}).catch(error => { console.error(error.stack || error); app.exit(1); }); // NEW
