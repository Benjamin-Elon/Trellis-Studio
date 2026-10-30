/** Hidden Chromium checks for equipment layout, keyboard controls, and real task-overlay persistence. */ // NEW
const assert = require('node:assert/strict'); // NEW
const fs = require('node:fs'); // NEW
const path = require('node:path'); // NEW
const { app, BrowserWindow } = require('electron'); // NEW
const project = path.resolve(__dirname, '../..'); // NEW
const output = process.env.TRELLIS_EQUIPMENT_SCREENSHOT_DIR || path.join(project, '.test-artifacts/equipment-planning'); // NEW
app.disableHardwareAcceleration(); // NEW
app.commandLine.appendSwitch('disable-gpu'); // NEW
app.commandLine.appendSwitch('in-process-gpu'); // NEW: use the repository's hidden Windows Chromium configuration.
const profile = path.join(app.getPath('temp'), 'trellis-equipment-' + process.pid); // NEW
fs.mkdirSync(profile, { recursive: true }); app.setPath('userData', profile); // NEW

app.whenReady().then(async () => { // NEW
    const win = new BrowserWindow({ show: false, width: 1440, height: 980, webPreferences: { sandbox: false, backgroundThrottling: false } }); // NEW
    const run = code => win.webContents.executeJavaScript(code); // NEW
    const delay = ms => new Promise(resolve => setTimeout(resolve, ms)); // NEW
    async function capture(name) { // NEW
        await delay(200); // NEW: allow a newly opened dialog to reach the hidden compositor.
        await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true }); // NEW: warm hidden compositor before inspecting a frame.
        await run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))'); // NEW
        await delay(100); fs.mkdirSync(output, { recursive: true }); // NEW
        fs.writeFileSync(path.join(output, name + '.png'), (await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG()); // NEW
    } // NEW
    win.webContents.on('console-message', event => { if (event.level === 'error') console.error('Renderer: ' + event.message); }); // NEW
    try { // NEW
        const webapp = path.join(project, 'drawio/src/main/webapp'); // NEW
        await win.loadURL('data:text/html,' + encodeURIComponent('<!doctype html><body style="margin:0;background:#eef3ef"><div id="graph" style="width:100%;height:100vh"></div></body>')); // NEW
        await run('window.mxLoadResources=false;window.mxLoadStylesheets=false;'); // NEW
        await run(fs.readFileSync(path.join(webapp, 'mxgraph/mxClient.js'), 'utf8')); // NEW
        await run(String.raw`
            window.graph=new mxGraph(document.getElementById('graph')); graph.setHtmlLabels(true);graph.isSpecialColor=()=>false;
            graph.convertValueToString=cell=>cell.value?.getAttribute?cell.value.getAttribute('label')||cell.value.getAttribute('title')||'':String(cell.value||'');
            window.historyManager=new mxUndoManager();graph.getModel().addListener(mxEvent.UNDO,(_sender,event)=>historyManager.undoableEditHappened(event.getProperty('edit')));
            const actions=new Map(); window.ui={editor:{graph,undoManager:historyManager,addListener(){},fireEvent(){}},actions:{addAction(id,fn){actions.set(id,{funct:fn});},get:id=>actions.get(id)},menus:{get(){return null;}},setStatus(){},handleError(error){throw error;}};
            window.Draw={loadPlugin:callback=>callback(ui)};window.TrellisContextMenu={install(){},register(){}};
            function cell(parent,id,attrs,x=0,y=0,w=180,h=80){const node=mxUtils.createXmlDocument().createElement('object');Object.entries(attrs).forEach(([key,value])=>node.setAttribute(key,value));return graph.insertVertex(parent,id,node,x,y,w,h,'');}
            window.garden=cell(null,'garden',{garden_module:'1',label:'Market garden'},20,20,1000,700);
            window.source=cell(garden,'planting',{tiler_group:'1',plant_id:'10',plant_count:'20',label:'Tomatoes',task_template_json:JSON.stringify({version:2,rules:[{id:'harvest',title:'Harvest tomatoes',taskTypeId:'harvesting',repeatMode:'none'}]})},0,0,180,100);
            window.taskModule=cell(null,'tasks',{task_module:'1'},40,40,1000,720);
            window.board=cell(taskModule,'board',{board_key:'MAIN_KANBAN_BOARD',task_view_mode:'FULL',label:'Garden tasks'},0,0,900,620);
            window.lane=cell(board,'lane',{lane_key:'TODO',status:'TODO'},0,0,200,500);
            window.card=cell(lane,'harvest-task',{kanban_card:'1',title:'Harvest tomatoes',task_type_id:'harvesting',task_quantity_basis:'plants',task_quantity_value:'20',workflow_state:'STAGED',linkedTo:'planting',scheduler_rule_id:'harvest',scheduler_task_key:'harvest::0',start:'2030-08-01',end:'2030-08-02',task_planning_override_json:'{}'},0,0,180,80);
            source.value.setAttribute('linkedTo',card.id);
            graph.__trellisModules={findExistingCompanionTask:target=>target===garden?taskModule:null};void 0;
        `); // NEW
        for (const name of ['Garden_Equipment.js', 'Garden_Task_Manager.js']) await run(fs.readFileSync(path.join(webapp, 'plugins/garden_planner_plugins', name), 'utf8')); // NEW
        await run(`const equipment=graph.__trellisEquipment, inventory=equipment.readEquipmentInventory(garden);inventory.forEach(item=>{if(item.status==='owned')item.skillLevelRequired='none';});equipment.writeEquipmentInventory(garden,inventory);equipment.openDialog(garden);[...document.querySelectorAll('.trellis-eq-table tbody tr')].find(row=>row.textContent.includes('Bypass Pruners')).click();void 0;`); // NEW
        const desktop = await run(`({tabs:document.querySelectorAll('.trellis-eq-editor-tab').length,maintenance:document.querySelector('[data-section="maintenance"]').open,tasks:document.querySelector('[data-section="plannedTasks"]').textContent})`); // NEW
        assert.equal(desktop.tabs, 0); assert.equal(desktop.maintenance, false); assert.match(desktop.tasks, /Harvest tomatoes/); // NEW
        await run(`const name=[...document.querySelectorAll('.trellis-eq-field')].find(field=>field.querySelector('label')?.textContent==='Name').querySelector('input');name.focus();name.select();void 0;`); // NEW
        await win.webContents.insertText('Precision pruners'); // NEW
        assert.equal(await run(`document.activeElement.value`), 'Precision pruners'); // NEW
        await capture('equipment-desktop'); // NEW
        await run(`document.querySelector('[data-section="taskTypes"]').open=true;const link=document.querySelector('[data-section="taskTypes"] input[value="pruning"]');link.focus();window.originalPruningLink=link.checked;void 0;`); // NEW
        win.webContents.focus(); win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Space' }); win.webContents.sendInputEvent({ type: 'char', keyCode: ' ' }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Space' }); await delay(100); // NEW
        assert.deepEqual(await run(`({focused:document.activeElement.value,checked:document.activeElement.checked})`), { focused: 'pruning', checked: !(await run(`originalPruningLink`)) }); // NEW
        await run(`document.querySelector('[data-section="taskTypes"] input[value="pruning"]').click();document.querySelector('[data-section="taskTypes"]').open=false;document.querySelector('[data-section="plannedTasks"]').open=false;document.querySelector('[data-section="suitability"]').open=true;document.querySelector('.trellis-eq-crew-range').scrollIntoView({block:'center'});void 0;`); // NEW
        const crew = await run(`(()=>{const group=document.querySelector('.trellis-eq-crew-range'),inputs=group.querySelectorAll('input');inputs[0].focus();inputs[0].value='3';inputs[0].dispatchEvent(new Event('input',{bubbles:true}));return {legend:group.querySelector('legend').textContent,min:inputs[0].value,max:inputs[1].value,focus:document.activeElement===inputs[0],labels:[...inputs].map(input=>input.getAttribute('aria-label'))};})()`); // NEW
        assert.equal(crew.min, '3'); assert.equal(crew.max, '3'); assert.equal(crew.focus, true); assert.notEqual(crew.labels[0], crew.labels[1]); // NEW
        await capture('equipment-crew'); // NEW
        await run(`const crewInputs=document.querySelectorAll('.trellis-eq-crew-range input');for(const input of crewInputs){input.value='1';input.dispatchEvent(new Event('input',{bubbles:true}));}void 0;`); // NEW
        win.setSize(540, 780); await delay(100); // NEW
        await run(`document.querySelector('.trellis-eq-overview').open=false;document.querySelector('.trellis-eq-crew-range').scrollIntoView({block:'center'});void 0;`); // CHANGE: inspect the grouped controls in the compact editing surface.
        const narrow = await run(`(()=>{const editor=document.querySelector('.trellis-eq-editor-panel'),box=editor.getBoundingClientRect();return {width:innerWidth,editorWidth:box.width,overflow:editor.scrollWidth>editor.clientWidth+1,fields:[...editor.querySelectorAll('input,select,textarea')].filter(node=>node.getBoundingClientRect().width>0).every(node=>{const r=node.getBoundingClientRect();return r.left>=box.left&&r.right<=box.right+1;})};})()`); // NEW
        await capture('equipment-narrow'); assert.equal(narrow.overflow, false, JSON.stringify(narrow)); assert.equal(narrow.fields, true, JSON.stringify(narrow)); // NEW
        await run(`[...document.querySelectorAll('button')].find(button=>button.textContent==='Save & Close').click();void 0;`); // NEW
        win.setSize(1100, 850); // NEW
        await run(`graph.setSelectionCell(card);graph.view.validate();void 0;`); await delay(200); // NEW
        const selector = '.trellis-task-equipment-dropdown'; // NEW
        assert.equal(await run(`!!document.querySelector('${selector}')`), true); // NEW
        await run(`document.querySelector('${selector} summary').focus();void 0;`); // NEW
        win.webContents.focus(); // NEW
        win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' }); win.webContents.sendInputEvent({ type: 'char', keyCode: '\r' }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' }); await delay(100); // NEW
        assert.equal(await run(`document.querySelector('${selector}').open`), true, 'Enter opens the native equipment disclosure'); // NEW
        await run(`for(const id of ['eq_bypass_pruners','eq_wheelbarrow']){const check=document.querySelector('${selector} input[value="'+id+'"]');check.click();}void 0;`); // NEW
        await capture('task-tools'); // NEW
        await run(`[...document.querySelectorAll('${selector} button')].find(button=>button.textContent==='Apply tools').click();void 0;`); await delay(150); // NEW
        const selected = await run(`({ids:JSON.parse(card.value.getAttribute('task_equipment_ids')),hours:Number(card.value.getAttribute('task_estimated_hours')),label:document.querySelector('${selector} summary').textContent,start:card.value.getAttribute('start'),end:card.value.getAttribute('end')})`); // NEW
        assert.deepEqual(selected.ids.sort(), ['eq_bypass_pruners', 'eq_wheelbarrow']); assert.ok(selected.hours > 0); assert.match(selected.label, /Selected tools/); // NEW
        assert.equal(selected.start, '2030-08-01'); assert.equal(selected.end, '2030-08-02'); // NEW
        await capture('task-selected-tools'); // NEW
        console.log('EQUIPMENT_RESULT:' + JSON.stringify({ desktop, narrow, selected, screenshots: output })); // NEW
        win.destroy(); app.exit(0); // NEW
    } catch (error) { console.error(error.stack || error); try { await capture('failure'); } catch (_) {} win.destroy(); app.exit(1); } // NEW
}); // NEW
