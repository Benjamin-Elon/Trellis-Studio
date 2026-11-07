/** Native Chromium checks for selection/hover attribution and local toggle behavior. // NEW */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
const webapp = path.resolve(__dirname, '../../drawio/src/main/webapp');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'trellis-attribution-'));
const dimensionsFirst = process.env.TRELLIS_TEST_OVERLAY_ORDER === 'dimensions-first'; // NEW

/** Check actual painted rectangles rather than layout declarations, including the CSS centering transform. */ // NEW
function assertStack(snapshot, id, withDimensions = true) { // NEW
    const badge = snapshot.badges.find(item => item.id === id), chip = snapshot.dimensions.find(item => item.id === id && item.visible); // NEW
    assert.ok(badge, 'Missing attribution for ' + id); // NEW
    assert.equal(!!chip, withDimensions, 'Dimension visibility for ' + id); // NEW
    const expectedCenter = Math.round(badge.object.x + badge.object.width / 2); // NEW
    assert.ok(Math.abs(badge.bounds.x + badge.bounds.width / 2 - expectedCenter) < 0.1, 'Attribution centered on ' + id); // NEW
    if (chip) { // NEW
        assert.ok(Math.abs(chip.bounds.x + chip.bounds.width / 2 - expectedCenter) < 0.1, 'Dimensions centered on ' + id); // NEW
        assert.equal(chip.bounds.y, Math.round(badge.object.y + badge.object.height + 8)); // NEW
        assert.equal(badge.bounds.y - chip.bounds.y - chip.bounds.height, 4, 'Four-pixel gap for ' + id); // NEW
    } else assert.equal(badge.bounds.y, Math.round(badge.object.y + badge.object.height + 8), 'No empty dimension row for ' + id); // NEW
} // NEW

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
        const scaleSource = fs.readFileSync(path.join(webapp, 'plugins/garden_planner_plugins/Garden_Scale.js'), 'utf8'); // NEW
        if (dimensionsFirst) await run(scaleSource); // NEW
        const changeMapSource = fs.readFileSync(path.join(webapp, 'plugins/garden_planner_plugins/Created_Change_Map.js'), 'utf8'); // CHANGE
        if (!dimensionsFirst) await run(changeMapSource); // NEW
        await run(`
            const value=mxUtils.createXmlDocument().createElement('object');value.setAttribute('label','Generated planting');
            value.setAttribute('tiler_group','1'); // NEW: exercise dimensions on a real logical planting group.
            window.cell=graph.__trellisEditContext.scope('generated-content',()=>graph.insertVertex(null,'planting',value,140,130,600,110,'rounded=1;fillColor=#e5efdc;strokeColor=#75935e;fontSize=16;')); // CHANGE
            graph.setSelectionCell(cell);
            window.bounds=node=>{const r=node.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};}; // NEW
            window.snapshot=()=>({xml:mxUtils.getXml(new mxCodec().encode(graph.model)),undo:ui.editor.undoManager.history.length,selection:graph.getSelectionCells().map(c=>c.id), // CHANGE
                dimensions:[...document.querySelectorAll('[data-trellis-dimensions]')].map(b=>({id:b.dataset.trellisDimensions,visible:getComputedStyle(b).display!=='none',bounds:bounds(b)})), // NEW
                badges:[...document.querySelectorAll('[data-trellis-attribution]')].map(b=>{const c=graph.model.getCell(b.dataset.trellisAttribution),state=graph.view.getState(c),r=mxUtils.getBoundingBox(state,Number(graph.getCellStyle(c).rotation)||0)||state;return{id:c.id,text:b.textContent,label:b.getAttribute('aria-label'),bounds:bounds(b),object:{x:r.x,y:r.y,width:r.width,height:r.height}};})}); // CHANGE
            void 0;
        `);
        if (dimensionsFirst) await run(changeMapSource); // NEW: attribution must also install correctly after a dimensioned object is already selected.
        await settle(); const initial = await run('snapshot()'); // CHANGE
        assertStack(initial, 'planting', dimensionsFirst); // NEW
        if (!dimensionsFirst) await run(scaleSource); // NEW: installing dimensions must immediately reposition existing attribution.
        await settle(); const selected = await run('snapshot()'); assertStack(selected, 'planting'); // NEW
        assert.equal(selected.xml, initial.xml); assert.equal(selected.undo, initial.undo); // NEW
        assert.equal(selected.badges.length, 1); assert.match(selected.badges[0].text, /Created by Alice.*Last edited by Alice/);
        assert.ok(selected.badges[0].bounds.y >= 244); assert.ok(selected.badges[0].bounds.width > 100);
        const output = path.resolve(__dirname, '../../.test-artifacts/object-attribution'); fs.mkdirSync(output, { recursive: true });
        fs.writeFileSync(path.join(output, 'attribution-' + (dimensionsFirst ? 'dimensions-first' : 'attribution-first') + '.png'), (await win.webContents.capturePage()).toPNG()); // CHANGE
        await run('actions.get("trellisShowObjectAttribution").funct();'); await settle();
        const hidden = await run('snapshot()'); assert.equal(hidden.badges.length, 0); assert.equal(hidden.xml, selected.xml); assert.deepEqual(hidden.selection, selected.selection);
        assert.equal(hidden.dimensions.filter(item => item.visible).length, 1); assert.equal(hidden.undo, selected.undo); // NEW
        await run('actions.get("trellisShowObjectAttribution").funct(); graph.clearSelection();'); await settle();
        win.webContents.sendInputEvent({ type: 'mouseMove', x: 230, y: 170 }); await settle();
        const hovered = await run('snapshot()'); assert.equal(hovered.badges.length, 1); assertStack(hovered, 'planting', false); // CHANGE
        assert.equal(hovered.dimensions.length, 0); assert.equal(hovered.xml, selected.xml); // NEW
        win.webContents.sendInputEvent({ type: 'mouseMove', x: 900, y: 400 }); await settle(); // CHANGE
        assert.equal((await run('snapshot()')).badges.length, 0);
        await run('graph.setSelectionCell(cell);void 0;'); await settle(); // CHANGE
        assert.equal((await run('snapshot()')).badges.length, 1);
        await run('const narrow=cell.geometry.clone();narrow.width=100;graph.model.setGeometry(cell,narrow);void 0;'); await settle(); // NEW
        const narrow = await run('snapshot()'); assertStack(narrow, 'planting'); // NEW
        fs.writeFileSync(path.join(output, 'stacked-narrow-' + (dimensionsFirst ? 'dimensions-first' : 'attribution-first') + '.png'), (await win.webContents.capturePage()).toPNG()); // NEW
        for (const scale of [.75, 1.4, 1.65, 2]) { // NEW: gaps remain fixed in screen pixels while geometry scales and pans.
            await run(`graph.view.scaleAndTranslate(${scale},17,23);void 0;`); await settle(); // NEW
            const zoomed = await run('snapshot()'); assertStack(zoomed, 'planting'); // NEW
            assert.equal(zoomed.xml, narrow.xml); assert.equal(zoomed.undo, narrow.undo); // NEW
        } // NEW
        await run('graph.view.scaleAndTranslate(1,0,0);graph.setCellStyles("rotation","35",[cell]);void 0;'); await settle(); // NEW
        assertStack(await run('snapshot()'), 'planting'); // NEW
        await run('graph.clearSelection();void 0;'); // NEW
        win.webContents.sendInputEvent({ type: 'mouseMove', x: 190, y: 185 }); await settle(); // NEW
        assertStack(await run('snapshot()'), 'planting', false); // NEW: standalone attribution also clears rotated bounds.
        win.webContents.sendInputEvent({ type: 'mouseMove', x: 900, y: 400 }); await settle(); // NEW
        await run('graph.setCellStyles("rotation","0",[cell]);graph.setSelectionCell(cell);void 0;'); // NEW
        for (const finish of ['reset', 'mouseUp']) { // NEW: native resize cancellation and completion restore the persistent stack.
            const before = await run('snapshot()'); // NEW
            await run(`
                window.handler=new mxVertexHandler(graph.view.getState(cell));handler.getHandleForEvent=()=>7;
                window.resizeEvent=new mxMouseEvent(new MouseEvent('mousedown',{clientX:240,clientY:240}),graph.view.getState(cell));
                handler.mouseDown(graph,resizeEvent);void 0;
            `); // NEW
            const resizing = await run('snapshot()'); assertStack(resizing, 'planting', false); // NEW
            assert.equal(await run('graph.__gardenScaleController.getOverlayPlacement(cell)'), null); // NEW
            await run(finish === 'reset' ? 'handler.reset();handler.destroy();void 0;' : 'handler.mouseUp(graph,resizeEvent);handler.destroy();void 0;'); await settle(); // NEW
            const restored = await run('snapshot()'); assertStack(restored, 'planting'); assert.equal(restored.xml, before.xml); // NEW
        } // NEW
        const cleanup = fs.readFileSync(path.join(webapp, 'plugins/garden_planner_plugins/Trellis_UI_Cleanup.js'), 'utf8'); // NEW
        await run(cleanup.slice(0, cleanup.indexOf('\nDraw.loadPlugin'))); // NEW
        await run('Trellis.ui.installOverlayVisibility(graph).begin("stack-test");graph.view.setTranslate(20,10);void 0;'); // NEW
        assert.equal(await run('getComputedStyle(document.querySelector("[data-trellis-attribution-layer]")).display'), 'none'); // NEW: suppression hides the owning layer, retaining each child's inline display.
        await run('graph.__trellisOverlayVisibility.end("stack-test");'); await settle(); assertStack(await run('snapshot()'), 'planting'); // NEW
        await run(`
            graph.view.setTranslate(0,0);
            const tileValue=mxUtils.createXmlDocument().createElement('object');tileValue.setAttribute('plant_tiler','1');tileValue.setAttribute('auto','1');
            window.tile=graph.__trellisEditContext.scope('derived-presentation',()=>graph.insertVertex(cell,'tile',tileValue,10,10,20,20));
            graph.setSelectionCells([tile,cell]);void 0;
        `); await settle(); // NEW
        const logical = await run('snapshot()'); assertStack(logical, 'planting'); assert.equal(logical.badges.length, 1); assert.equal(logical.dimensions.length, 1); // NEW
        await run(`
            window.many=Array.from({length:7},(_,i)=>{const value=mxUtils.createXmlDocument().createElement('object');value.setAttribute('garden_bed','1');return graph.insertVertex(null,'bed-'+i,value,40+(i%4)*240,400+Math.floor(i/4)*180,100,70);});
            graph.setSelectionCells(many);void 0;
        `); await settle(); // NEW
        const many = await run('snapshot()'); assert.equal(many.badges.length, 7); assert.equal(many.dimensions.length, 6); // NEW
        for (let i = 0; i < 7; i++) assertStack(many, 'bed-' + i, i < 6); // NEW
        await run('graph.setSelectionCell(many[6]);void 0;'); await settle(); // NEW
        const switched = await run('snapshot()'); assertStack(switched, 'bed-6'); assert.equal(switched.dimensions.length, 1); assert.equal(switched.xml, many.xml); // NEW
        await run('graph.setSelectionCell(cell);void 0;'); // NEW
        await run('ui.alert=()=>{}; graph.model.addListener(mxEvent.UNDO,(_sender,event)=>ui.editor.undoManager.undoableEditHappened(event.getProperty("edit")));'); // NEW
        await run(fs.readFileSync(path.join(webapp, 'plugins/garden_planner_plugins/Modules_Standalone.js'), 'utf8')); // NEW
        await run('window.garden=graph.__trellisModules.createModuleAtPoint({x:140,y:300},"garden");void 0;'); await settle(); // NEW
        assert.equal((await run('snapshot()')).badges.length, 0); // NEW
        await run('graph.clearSelection();void 0;'); // NEW
        const starterPoint = await run('(()=>{const state=graph.view.getState(garden);return{x:Math.round(state.x+40),y:Math.round(state.y+20)};})()'); // NEW
        win.webContents.sendInputEvent({ type: 'mouseMove', ...starterPoint }); await settle(); // NEW
        assert.equal((await run('snapshot()')).badges.length, 0); // NEW
        await run('graph.setSelectionCell(garden);ui.editor.undoManager.clear();const edited=garden.value.cloneNode(true);edited.setAttribute("label","My garden");graph.model.setValue(garden,edited);void 0;'); await settle(); // NEW
        assert.equal((await run('snapshot()')).badges.length, 1); // NEW
        await run('ui.editor.undoManager.undo();void 0;'); await settle(); // NEW
        assert.equal((await run('snapshot()')).badges.length, 0); // NEW
        await run('ui.editor.undoManager.redo();void 0;'); await settle(); // NEW
        assert.equal((await run('snapshot()')).badges.length, 1); // NEW
        console.log('Native object attribution checks passed'); win.destroy(); app.exit(0);
    } catch (error) { console.error(error); win.destroy(); app.exit(1); }
});
