/** Hidden Chromium verification using the production dialog and real mxGraph history. */ // CHANGE
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
const root = path.resolve(__dirname, '../..');
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('in-process-gpu');
const profile = path.join(app.getPath('temp'), 'trellis-guide-' + process.pid);
fs.mkdirSync(profile, { recursive: true }); app.setPath('userData', profile);

app.whenReady().then(async () => {
    const win = new BrowserWindow({ show: false, width: 1000, height: 800, webPreferences: { sandbox: false, backgroundThrottling: false } });
    win.webContents.on('console-message', event => { if (event.level === 'error') console.error('Renderer: ' + event.message); }); // CHANGE
    try {
        const webapp = path.join(root, 'drawio/src/main/webapp');
        await win.loadURL('data:text/html,' + encodeURIComponent('<!doctype html><body style="margin:0;background:#f1f5f9"><div id="graph" style="width:100%;height:100vh"></div></body>'));
        await win.webContents.executeJavaScript('window.mxLoadResources=false;window.mxLoadStylesheets=false;');
        await win.webContents.executeJavaScript(fs.readFileSync(path.join(webapp, 'mxgraph/mxClient.js'), 'utf8'));
        const editor = fs.readFileSync(path.join(webapp, 'js/grapheditor/Editor.js'), 'utf8');
        await win.webContents.executeJavaScript(String.raw`
            window.urlParams={}; window.Editor={crossImage:''}; window.TRELLIS_NATIVE_DIALOG_Z=1999999999;
            const style=document.createElement('style');style.textContent=${JSON.stringify(fs.readFileSync(path.join(webapp, 'styles/grapheditor.css'), 'utf8'))};document.head.appendChild(style);
            window.graph=new mxGraph(document.getElementById('graph'));
            graph.isSpecialColor=()=>false;graph.convertValueToString=cell=>cell.value&&cell.value.getAttribute?cell.value.getAttribute('title')||'':String(cell.value||''); // CHANGE: production draw.io supplies these renderer adapters.
            window.historyManager=new mxUndoManager();
            graph.getModel().addListener(mxEvent.UNDO,(_sender,event)=>historyManager.undoableEditHappened(event.getProperty('edit'))); // CHANGE
            window.ui={editor:{graph,undoManager:historyManager,fireEvent(){}},createDiv(name){const div=document.createElement('div');div.className=name;return div;},dialogs:[],
                showDialog(node,w,h,modal,closable,onClose){this.dialog=new Dialog(this,node,w,h,modal,closable,onClose);this.dialogs.push(this.dialog);},
                hideDialog(){if(this.dialog && this.dialog.close()===false)return false;this.dialogs.pop();this.dialog=this.dialogs.at(-1)||null;return true;}};
            window.Draw={loadPlugin:callback=>callback(ui)};
            window.Trellis={taskCommands:{commitCardPatch(card,attrs){const model=graph.getModel(),value=card.value.cloneNode(true);Object.entries(attrs).forEach(([key,val])=>val==null?value.removeAttribute(key):value.setAttribute(key,val));model.beginUpdate();try{model.setValue(card,value);}finally{model.endUpdate();}return true;}}};
            const value=mxUtils.createXmlDocument().createElement('object');value.setAttribute('kanban_card','1');value.setAttribute('title','Transplant tomatoes — coastal garden');value.setAttribute('plant_name','Tomato');value.setAttribute('scheduler_method_id','transplant.indoor'); // CHANGE: diagram metadata is XML, as it is in the production editor.
            value.setAttribute('task_instructions','1. Water seedlings before transplanting.\n2. Space plants according to the planting plan.\n3. Water the root zone and check establishment over the next few days.');
            value.setAttribute('task_instruction_provenance_json',JSON.stringify({status:'draft',sourceUrls:['https://example.test/gardening/tomatoes/planting-and-establishment'],sourceNote:'Draft based on supplied crop attributes. Adapt for local conditions.'}));
            window.card=graph.insertVertex(graph.getDefaultParent(),'guide-task',value,40,40,150,80);
            historyManager.clear();
            void 0;
        `);
        await win.webContents.executeJavaScript(editor.slice(editor.indexOf('function Dialog('), editor.indexOf('var ErrorDialog =')) + '\n;void 0;'); // CHANGE: do not send prototype functions through Electron IPC.
        const taskManager = fs.readFileSync(path.join(webapp, 'plugins/garden_planner_plugins/Garden_Task_Manager.js'), 'utf8'); // CHANGE
        await win.webContents.executeJavaScript(taskManager.slice(taskManager.indexOf('function applyTaskButtonStyle('), taskManager.indexOf('const SCHEDULE_PX_PER_HOUR')) + '\ngraph.__trellisTaskUi={applyButtonStyle:applyTaskButtonStyle};void 0;'); // CHANGE: preview uses production Task button styles.
        await win.webContents.executeJavaScript(fs.readFileSync(path.join(webapp, 'plugins/garden_planner_plugins/Garden_Guide.js'), 'utf8'));
        await win.webContents.executeJavaScript('USL.guide.open(card);void 0;');
        async function screenshot(name) {
            const directory = process.env.TRELLIS_GUIDE_SCREENSHOT_DIR;
            if (directory) { await new Promise(resolve => setTimeout(resolve, 150)); fs.mkdirSync(directory, { recursive: true }); fs.writeFileSync(path.join(directory, name + '.png'), (await win.webContents.capturePage()).toPNG()); } // CHANGE: hidden windows may suspend animation frames; the capture delay is bounded in the main process.
        }
        await screenshot('guide-desktop');
        const desktop = await win.webContents.executeJavaScript(`(function(){const input=document.querySelector('.trellis-task-guide textarea');input.value='Saved instructions';input.dispatchEvent(new Event('input'));input.dispatchEvent(new Event('blur'));const saved=card.value.getAttribute('task_instruction_override');input.value='Pending stale text';input.dispatchEvent(new Event('input'));historyManager.undo();return {saved,undone:card.value.getAttribute('task_instruction_override'),text:input.value};})()`); // CHANGE
        assert.equal(desktop.saved, 'Saved instructions'); assert.equal(desktop.undone, null, JSON.stringify(desktop)); assert.notEqual(desktop.text, 'Pending stale text');
        await win.webContents.executeJavaScript('new Promise(resolve=>setTimeout(resolve,550))');
        assert.equal(await win.webContents.executeJavaScript("card.value.getAttribute('task_instruction_override')"), null);
        await win.webContents.executeJavaScript(String.raw`const input=document.querySelector('.trellis-task-guide textarea');input.value='Saved on close\nSecond line';input.dispatchEvent(new Event('input'));ui.hideDialog();void 0;`); // CHANGE
        assert.equal(await win.webContents.executeJavaScript("card.value.getAttribute('task_instruction_override')"), 'Saved on close\nSecond line'); // CHANGE
        await win.webContents.executeJavaScript("const xml=mxUtils.getXml(new mxCodec().encode(graph.getModel()));const doc=mxUtils.parseXml(xml);const restored=new mxGraphModel();new mxCodec(doc).decode(doc.documentElement,restored);window.reopened=restored.getCell('guide-task').value.getAttribute('task_instruction_override');void 0;");
        assert.equal(await win.webContents.executeJavaScript('window.reopened'), 'Saved on close\nSecond line'); // CHANGE: XML save/reopen preserves line breaks.
        win.setSize(420, 650);
        await win.webContents.executeJavaScript('USL.guide.open(card);void 0;');
        const narrow = await win.webContents.executeJavaScript(`(function(){const root=document.querySelector('.trellis-task-guide'),input=root.querySelector('textarea'),box=input.getBoundingClientRect();return {width:innerWidth,rootWidth:root.clientWidth,scrollWidth:root.scrollWidth,left:box.left,right:box.right,buttons:root.querySelectorAll('button').length};})()`);
        assert.ok(narrow.scrollWidth <= narrow.rootWidth + 1, JSON.stringify(narrow));
        assert.ok(narrow.left >= 0 && narrow.right <= narrow.width, JSON.stringify(narrow));
        assert.ok(narrow.buttons >= 4);
        await screenshot('guide-narrow');
        console.log('GUIDE_RESULT:' + JSON.stringify({ desktop, narrow, reopened: 'Saved on close' }));
        win.destroy(); app.exit(0);
    } catch (error) { console.error(error.stack || error); win.destroy(); app.exit(1); }
});
