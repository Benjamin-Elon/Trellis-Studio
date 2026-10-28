/** Native Chromium checks for selection/hover attribution and local toggle behavior. // NEW */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
const webapp = path.resolve(__dirname, '../../drawio/src/main/webapp');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'trellis-attribution-'));
app.setPath('userData', profile); app.disableHardwareAcceleration(); app.commandLine.appendSwitch('in-process-gpu');
app.whenReady().then(async () => { // NEW
    const win = new BrowserWindow({ show: false, width: 1050, height: 760, webPreferences: { sandbox: false, backgroundThrottling: false } });
    const run = source => win.webContents.executeJavaScript(source);
    const settle = () => run('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    try {
        const host = path.join(profile, 'host.html');
        fs.writeFileSync(host, '<!doctype html><body style="margin:0;background:#fafafa"><div id="graph" style="position:absolute;inset:0"></div></body>');
        await win.loadFile(host); await run('window.mxLoadResources=false;window.mxLoadStylesheets=false;');
        for (const file of ['mxgraph/mxClient.js', 'js/trellis-edit-context.js', 'js/trellis-object-attribution.js', 'js/trellis-permission-core.js']) await run(fs.readFileSync(path.join(webapp, file), 'utf8') + '\n;void 0;'); // CHANGE
        await run(`
            window.graph = new mxGraph(document.getElementById('graph')); graph.isSpecialColor=()=>false;
            graph.convertValueToString=cell=>cell.getAttribute?.('label')||'';
            const editor=new mxEventSource();editor.graph=graph;editor.undoManager=new mxUndoManager();
            window.actions=new Map();window.ui={editor,getCurrentFile:()=>null,hideDialog(){},
                actions:{get:key=>actions.get(key),addAction(key,funct){const action={funct,setToggleAction(){},setSelectedCallback(){}};actions.set(key,action);return action;}},
                menus:{get:()=>null}};
            window.Draw={loadPlugin:callback=>callback(ui)};
            void 0;
        `);
        await run(fs.readFileSync(path.join(webapp, 'js/trellis-permission-core.js'), 'utf8')); // NEW: mirror the production dependency order.
        await run(fs.readFileSync(path.join(webapp, 'plugins/garden_planner_plugins/Trellis_Users.js'), 'utf8'));
        await run('Trellis.users.enableUsers("Alice","1234");');
        await run(fs.readFileSync(path.join(webapp, 'plugins/garden_planner_plugins/Created_Change_Map.js'), 'utf8'));
        await run(`
            const value=mxUtils.createXmlDocument().createElement('object');value.setAttribute('label','Generated planting');
            window.cell=graph.__trellisEditContext.scope('generated-content',()=>graph.insertVertex(null,'planting',value,140,130,250,110,'rounded=1;fillColor=#e5efdc;strokeColor=#75935e;fontSize=16;'));
            graph.setSelectionCell(cell);
            window.snapshot=()=>({xml:mxUtils.getXml(new mxCodec().encode(graph.model)),selection:graph.getSelectionCells().map(c=>c.id),badges:[...document.querySelectorAll('[data-trellis-attribution]')].map(b=>({text:b.textContent,label:b.getAttribute('aria-label'),bounds:{x:b.offsetLeft,y:b.offsetTop,width:b.offsetWidth,height:b.offsetHeight}}))});
            void 0;
        `);
        await settle(); const selected = await run('snapshot()');
        assert.equal(selected.badges.length, 1); assert.match(selected.badges[0].text, /Created by Alice.*Last edited by Alice/);
        assert.ok(selected.badges[0].bounds.y >= 244); assert.ok(selected.badges[0].bounds.width > 100);
        const output = path.resolve(__dirname, '../../.test-artifacts/object-attribution'); fs.mkdirSync(output, { recursive: true });
        fs.writeFileSync(path.join(output, 'attribution.png'), (await win.webContents.capturePage()).toPNG());
        await run('actions.get("trellisShowObjectAttribution").funct();'); await settle();
        const hidden = await run('snapshot()'); assert.equal(hidden.badges.length, 0); assert.equal(hidden.xml, selected.xml); assert.deepEqual(hidden.selection, selected.selection);
        await run('actions.get("trellisShowObjectAttribution").funct(); graph.clearSelection();'); await settle();
        win.webContents.sendInputEvent({ type: 'mouseMove', x: 230, y: 170 }); await settle();
        assert.equal((await run('snapshot()')).badges.length, 1);
        win.webContents.sendInputEvent({ type: 'mouseMove', x: 600, y: 400 }); await settle();
        assert.equal((await run('snapshot()')).badges.length, 0);
        await run('graph.setSelectionCell(cell);void 0;'); await settle(); // CHANGE
        assert.equal((await run('snapshot()')).badges.length, 1);
        console.log('Native object attribution checks passed'); win.destroy(); app.exit(0);
    } catch (error) { console.error(error); win.destroy(); app.exit(1); }
});
