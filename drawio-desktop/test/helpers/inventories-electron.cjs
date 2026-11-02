/** Inspect inventory navigation, native keyboard editing and Home/editor parity in hidden Chromium. */ // NEW
const assert = require('node:assert/strict'); // NEW
const fs = require('node:fs'); // NEW
const path = require('node:path'); // NEW
const { app, BrowserWindow } = require('electron'); // NEW
const project = path.resolve(__dirname, '../..'), webapp = path.join(project, 'drawio/src/main/webapp'), output = path.join(project, '.test-artifacts/inventories'); // NEW
app.disableHardwareAcceleration(); app.commandLine.appendSwitch('disable-gpu'); app.commandLine.appendSwitch('in-process-gpu'); // NEW
const profile = path.join(app.getPath('temp'), 'trellis-inventories-' + process.pid); fs.mkdirSync(profile, { recursive: true }); app.setPath('userData', profile); // NEW
app.whenReady().then(async () => { // NEW
    const win = new BrowserWindow({ show: false, width: 1440, height: 980, webPreferences: { sandbox: false, backgroundThrottling: false } }); // NEW
    win.webContents.on('console-message', event => { if (event.level === 'error') console.error('Renderer: ' + event.message); }); // NEW
    const run = code => win.webContents.executeJavaScript(code), delay = ms => new Promise(resolve => setTimeout(resolve, ms)); // NEW
    async function capture(name) { // NEW
        await delay(150); await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true }); // NEW
        await run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))'); fs.mkdirSync(output, { recursive: true }); // NEW
        fs.writeFileSync(path.join(output, name + '.png'), (await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG()); // NEW
    } // NEW
    try { // NEW
        await win.loadURL('data:text/html,' + encodeURIComponent('<!doctype html><meta charset="utf-8"><body style="margin:0;background:#edf3ed;font:14px Arial"><button id="inventory" style="margin:18px">Inventories ▾</button><textarea id="plan" style="margin:18px;display:block">Unsaved Year Planner draft</textarea><div id="graph" style="width:100%;height:700px"></div></body>')); // NEW
        await run('window.mxLoadResources=false;window.mxLoadStylesheets=false;'); await run(fs.readFileSync(path.join(webapp, 'mxgraph/mxClient.js'), 'utf8')); // NEW
        await run(String.raw` // NEW
            window.graph=new mxGraph(document.getElementById('graph'));graph.isSpecialColor=()=>false;window.ui={editor:{graph}}; // NEW
            window.Draw={loadPlugin:callback=>callback(ui)};window.alerts=[];window.alert=message=>alerts.push(message);window.confirm=()=>false; // NEW
            const value=mxUtils.createXmlDocument().createElement('object');value.setAttribute('garden_module','1');value.setAttribute('label','Kitchen garden'); // NEW
            window.garden=graph.insertVertex(null,'garden',value,20,20,900,500,''); // NEW
        `); // NEW
        for (const filename of ['js/trellis-reference-core.js', 'plugins/garden_planner_plugins/Trellis_Allocation_Core.js', 'plugins/garden_planner_plugins/Trellis_Seeds_Core.js', 'plugins/garden_planner_plugins/Trellis_Inventories.js']) await run(fs.readFileSync(path.join(webapp, filename), 'utf8')); // NEW
        await run(String.raw` // NEW
            window.fixtureCounter=0;window.references=TrellisReferenceCore.capture({schema:{Plants:{columns:[{name:'plant_id',type:'INTEGER',pk:1},{name:'plant_name',type:'TEXT',pk:0}],pk:['plant_id'],foreignKeys:[]}},tables:{Plants:[{plant_id:1,plant_name:'Tomato'}]}},null,{},()=> 'fixture-'+ ++fixtureCounter); // NEW
            window.cropRef=Object.keys(references.bindings)[0];garden.value.setAttribute('trellis_references_json',JSON.stringify(references)); // NEW
            garden.value.setAttribute('trellis_seeds_json',JSON.stringify(TrellisSeedsCore.normalize({version:1,initialized:true,items:[{cropRef,seeds:100}]}))); // NEW
            garden.value.setAttribute('plan_year_json',JSON.stringify({2026:{year:2026,crops:[{cropRef,seedsReq:40}]}})); // NEW
            document.getElementById('plan').focus(); // NEW
            TrellisInventories.showMenu(document.getElementById('inventory'),{ui,garden}); // NEW
            [...document.querySelector('[role=menu]').querySelectorAll('button')].find(button=>button.textContent==='Seeds').click(); // NEW
        `); // NEW
        await delay(100); assert.equal(await run('!!document.querySelector("[role=dialog]")'), true); // NEW
        await run(`window.quantity=document.querySelectorAll('tbody tr input')[1];quantity.focus();quantity.select();void 0;`); // NEW
        await win.webContents.insertText('75'); // NEW
        assert.equal(await run('document.activeElement===quantity'), true); // NEW
        await run(`quantity.dispatchEvent(new Event('change'));[...document.querySelectorAll('button')].find(button=>button.textContent==='Save').click();void 0;`); await delay(100); // NEW
        assert.equal(await run('JSON.parse(garden.value.getAttribute("trellis_seeds_json")).items[0].seeds'), 75); // NEW
        assert.equal(await run('document.getElementById("plan").value'), 'Unsaved Year Planner draft'); // NEW
        await capture('inventory-desktop'); win.setSize(780, 780); await delay(100); await capture('inventory-compact'); // NEW
        const layout = await run(`(()=>{const dialog=document.querySelector('[role=dialog]'),rect=dialog.getBoundingClientRect();return {viewport:innerWidth,left:rect.left,right:rect.right,width:rect.width,close:[...dialog.querySelectorAll('button')].find(button=>button.textContent==='Close').getBoundingClientRect().right};})()`); // NEW
        assert.ok(layout.left >= 0 && layout.right <= layout.viewport && layout.close <= layout.right, JSON.stringify(layout)); // NEW
        await run(`[...document.querySelectorAll('button')].find(button=>button.textContent==='Close').click();void 0;`); // NEW
        assert.equal(await run('document.activeElement.id'), 'inventory'); // NEW: return to the launcher after its popup is removed. // NEW
        await run(String.raw` // NEW
            window.homeCalls=[];window.gardenRef={diagramId:'project',pageId:'page',gardenId:'garden'}; // NEW
            window.trellisInventories={list:async()=>({gardens:[{...gardenRef,name:'Kitchen garden'}]}),read:async()=>({garden:gardenRef,seeds:JSON.parse(garden.value.getAttribute('trellis_seeds_json')),plans:JSON.parse(garden.value.getAttribute('plan_year_json')),references,canEdit:true}),saveSeeds:async input=>{homeCalls.push(input);garden.value.setAttribute('trellis_seeds_json',JSON.stringify({...input.base,items:input.items}));}}; // NEW
            TrellisInventories.openSeeds(); // NEW
        `); await delay(100); // NEW
        assert.equal(await run(`document.querySelectorAll('tbody tr input')[1].value`), '75'); // NEW
        await run(`const quantity=document.querySelectorAll('tbody tr input')[1];quantity.value='60';quantity.dispatchEvent(new Event('change'));[...document.querySelectorAll('button')].find(button=>button.textContent==='Save').click();void 0;`); await delay(100); // NEW
        assert.equal(await run('homeCalls[0].base.items[0].seeds'), 75); assert.equal(await run('homeCalls[0].items[0].seeds'), 60); // NEW
        assert.equal(await run('alerts.length'), 0); // NEW
        console.log('INVENTORIES_RESULT:' + JSON.stringify({ layout, screenshots: output })); win.destroy(); app.exit(0); // NEW
    } catch (error) { console.error(error.stack || error); try { await capture('failure'); } catch (_) {} win.destroy(); app.exit(1); } // NEW
}); // NEW
