const assert = require('node:assert/strict'); // NEW
const fs = require('node:fs'); // NEW
const os = require('node:os'); // NEW
const path = require('node:path'); // NEW
const { app, BrowserWindow } = require('electron'); // NEW
const webapp = path.resolve(__dirname, '../../drawio/src/main/webapp'); // NEW
app.commandLine.appendSwitch('disable-gpu'); // NEW
app.disableHardwareAcceleration(); // NEW
app.commandLine.appendSwitch('in-process-gpu'); // NEW
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'trellis-module-drag-'))); // NEW

/** Load real module and drag plugins; only shell UI services are stubbed. */ // NEW
async function initialize(win) { // NEW
    await win.loadURL('data:text/html,' + encodeURIComponent('<!doctype html><body style="margin:0"><div id="graph" style="position:absolute;left:40px;top:40px;width:1100px;height:800px;overflow:auto"></div></body>')); // NEW
    const run = script => win.webContents.executeJavaScript(script); // NEW
    await run('window.mxLoadResources=false;window.mxLoadStylesheets=false;'); // NEW
    await run(fs.readFileSync(path.join(webapp, 'mxgraph/mxClient.js'), 'utf8')); // NEW
    await run(`
        window.errors=[];window.prompts=[];window.alerts=[];window.cleanupCalls=[];
        window.addEventListener('error',event=>errors.push(event.message));
        window.graph=new mxGraph(document.getElementById('graph'));
        graph.setHtmlLabels(true);graph.setDropEnabled(true);graph.setGridEnabled(false);
        graph.graphHandler.removeEmptyParents=true;
        graph.isSpecialColor=()=>false;graph.getCompositeParent=cell=>cell;
        graph.getCurrentCellStyle=cell=>graph.getCellStyle(cell);
        graph.convertValueToString=cell=>cell.getAttribute?.('label') || String(cell.value || '');
        window.confirm=message=>{prompts.push(String(message));return false;};
        window.alert=message=>alerts.push(String(message));
        window.Draw={loadPlugin:callback=>callback({editor:{graph,addListener(){}},actions:{get:()=>null,addAction:()=>({})},alert:window.alert})};
        window.frames=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        void 0;
    `); // NEW
    for (const name of ['Modules_Standalone.js', 'Deep_Click_Through.js']) { // NEW
        await run(fs.readFileSync(path.join(webapp, 'plugins/garden_planner_plugins', name), 'utf8')); // NEW
    } // NEW
    await run(`
        const remove=graph.removeCells;
        graph.removeCells=function(cells,includeEdges){
            cleanupCalls.push({ids:cells?.map(cell=>cell.id),includeEdges,handle:!!graph.__trellisWorkspaceHandleDragActive});
            return remove.apply(this,arguments);
        };
        window.moduleCell=graph.__trellisModules.createModuleAtPoint({x:100,y:100},'regular');
        window.child=graph.insertVertex(moduleCell,'module-content','Content',30,55,60,25);
        graph.setSelectionCell(moduleCell);graph.view.validate();
        window.snapshot=()=>{
            const geo=graph.getCellGeometry(moduleCell);
            return {x:geo.x,y:geo.y,collapsed:graph.isCellCollapsed(moduleCell),
                moduleExists:graph.model.getCell(moduleCell.id)===moduleCell,
                childExists:graph.model.getCell(child.id)===child,childParent:graph.model.getParent(child)===moduleCell,
                prompts:prompts.slice(),alerts:alerts.slice(),errors:errors.slice()};
        };
        void 0;
    `); // NEW
    await run('frames()'); // NEW
    return run; // NEW
} // NEW

/** Send native input and wait for handler work and overlay refresh to settle. */ // NEW
async function drag(win, run, start) { // NEW
    const mouse = (type, x, y) => win.webContents.sendInputEvent({ type, x, y, button: 'left', clickCount: 1 }); // NEW
    mouse('mouseDown', start.x, start.y); // NEW
    await run('frames()'); // NEW
    mouse('mouseMove', start.x + 60, start.y + 45); // NEW
    await run('frames()'); // NEW
    mouse('mouseUp', start.x + 60, start.y + 45); // NEW
    await run('frames()'); // NEW
} // NEW

/** Two consecutive header moves expose both the unwanted fold and the next delete prompt. */ // NEW
async function verifyHeaders(win, run, collapsed) { // NEW
    await run(`graph.foldCells(${collapsed},false,[moduleCell]);graph.setSelectionCell(moduleCell);frames()`); // NEW
    const before = await run('snapshot()'); // NEW
    const cleanupStart = await run('cleanupCalls.length'); // NEW
    const positions = []; // NEW
    for (let pass = 0; pass < 2; pass += 1) { // NEW
        const start = await run(`(()=>{
            const state=graph.view.getState(moduleCell),rect=graph.container.getBoundingClientRect();
            return {x:Math.round(rect.left+state.x+state.width/2),y:Math.round(rect.top+state.y+12)};
        })()`); // NEW
        await drag(win, run, start); // NEW
        positions.push(await run('snapshot()')); // NEW
    } // NEW
    const cleanup = await run(`cleanupCalls.slice(${cleanupStart})`); // NEW
    console.log(JSON.stringify({ gesture: 'header', initiallyCollapsed: collapsed, positions, cleanup })); // NEW
    let previous = before; // NEW
    for (const state of positions) { // NEW
        assert.notEqual(state.x, previous.x, 'header drag must change horizontal position'); // NEW
        assert.notEqual(state.y, previous.y, 'header drag must change vertical position'); // NEW
        assert.equal(state.collapsed, collapsed, 'header drag must preserve collapsed state'); // NEW
        assert.equal(state.moduleExists && state.childExists && state.childParent, true); // NEW
        assert.deepEqual(state.prompts, []); // NEW
        assert.deepEqual(state.alerts, []); // NEW
        assert.deepEqual(state.errors, []); // NEW
        previous = state; // NEW
    } // NEW
    assert.equal(cleanup.length, 2, 'each native header drag must reach parent cleanup'); // NEW
    cleanup.forEach(call => assert.deepEqual(call, { ids: [], includeEdges: false, handle: false })); // NEW
} // NEW

/** Click the visible workspace handle and verify the existing guard protects the committed move. */ // NEW
async function verifyHandle(win, run) { // NEW
    await run('graph.foldCells(false,false,[moduleCell]);graph.setSelectionCell(moduleCell);graph.__trellisWorkspaceDragPolicy.refreshHandles();frames()'); // NEW
    const before = await run('snapshot()'); // NEW
    const cleanupStart = await run('cleanupCalls.length'); // NEW
    const start = await run(`(()=>{
        const handle=document.querySelector('[data-trellis-workspace-drag-handle="1"]');
        if(!handle)throw new Error('Selected module must have a workspace handle');
        const rect=handle.getBoundingClientRect();
        return {x:Math.round(rect.left+rect.width/2),y:Math.round(rect.top+rect.height/2)};
    })()`); // NEW
    await drag(win, run, start); // NEW
    const after = await run('snapshot()'); // NEW
    assert.notEqual(after.x, before.x); // NEW
    assert.notEqual(after.y, before.y); // NEW
    assert.equal(after.collapsed, false); // NEW
    assert.equal(after.moduleExists && after.childExists && after.childParent, true); // NEW
    assert.deepEqual(after.prompts, []); // NEW
    assert.deepEqual(after.alerts, []); // NEW
    assert.deepEqual(after.errors, []); // NEW
    assert.equal(await run('!!graph.__trellisWorkspaceHandleDragActive'), false); // NEW
    const cleanup = await run(`cleanupCalls.slice(${cleanupStart})`); // NEW
    assert.equal(cleanup.length, 1); // NEW
    assert.deepEqual(cleanup[0], { ids: [], includeEdges: false, handle: true }); // NEW
} // NEW

/** A real nonempty parent cleanup must remove its explicit target, preserving the selected module. */ // NEW
async function verifyParentCleanup(run) { // NEW
    await run(`
        window.emptyParent=graph.insertVertex(null,'ordinary-parent','',20,20,100,100,'fillColor=none;strokeColor=none;');
        window.leaf=graph.insertVertex(emptyParent,'ordinary-leaf','Leaf',20,20,40,25);
        void 0;
    `); // NEW
    await run('frames()'); // NEW
    assert.equal(await run('graph.model.getParent(emptyParent)===graph.getDefaultParent()'), true, 'cleanup fixture must remain outside the module'); // NEW
    const before = await run('snapshot()'); // NEW
    await run(`
        graph.setSelectionCell(moduleCell);graph.graphHandler.cell=leaf;
        graph.graphHandler.moveCells([leaf],150,0,false,graph.getDefaultParent(),null);
        graph.graphHandler.reset();void 0;
    `); // NEW
    assert.equal(await run('graph.model.getCell(emptyParent.id)==null'), true); // NEW
    assert.equal(await run('graph.model.getParent(leaf)===graph.getDefaultParent()'), true); // NEW
    assert.deepEqual(await run('cleanupCalls[cleanupCalls.length-1]'), { ids: ['ordinary-parent'], includeEdges: false, handle: false }); // NEW
    assert.deepEqual(await run('snapshot()'), before); // NEW
} // NEW

app.whenReady().then(async () => { // NEW
    const win = new BrowserWindow({ show: false, width: 1200, height: 900, webPreferences: { sandbox: false, backgroundThrottling: false } }); // NEW
    try { // NEW
        const run = await initialize(win); // NEW
        await verifyHeaders(win, run, false); // NEW
        await verifyHeaders(win, run, true); // NEW
        await verifyHandle(win, run); // NEW
        await verifyParentCleanup(run); // NEW
        console.log('Native module header, handle, and cleanup checks passed'); // NEW
    } finally { // NEW
        win.destroy(); // NEW
    } // NEW
    app.quit(); // NEW
}).catch(error => { console.error(error.stack || error); app.exit(1); }); // NEW
