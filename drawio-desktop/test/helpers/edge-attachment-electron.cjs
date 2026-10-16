/** Use the shipped runtime, plugin and native mouse dispatch; keep the installed Trellis profile untouched. */ // NEW
const assert = require('node:assert/strict'); // NEW
const fs = require('node:fs'); // NEW
const path = require('node:path'); // NEW
const { app, BrowserWindow } = require('electron'); // NEW
const project = path.resolve(__dirname, '../..'), webapp = path.join(project, 'drawio/src/main/webapp'); // NEW
const output = path.join(project, '.test-artifacts/edge-attachment', String(process.pid)); // NEW
app.disableHardwareAcceleration(); app.commandLine.appendSwitch('in-process-gpu'); // NEW
app.setPath('userData', fs.mkdtempSync(path.join(app.getPath('temp'), 'trellis-edge-attachment-'))); // NEW
const delay = ms => new Promise(resolve => setTimeout(resolve, ms)); // NEW

app.whenReady().then(async () => { // NEW
    const win = new BrowserWindow({ show: false, width: 1000, height: 720, webPreferences: { sandbox: false, backgroundThrottling: false } }); // NEW
    win.webContents.on('console-message', event => { if (event.message && /Error/.test(event.message)) console.error('RENDERER: ' + event.message); }); // CHANGE
    const evaluate = source => win.webContents.executeJavaScript(source); // NEW
    async function snapshot(name) { await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))'); await delay(50); fs.mkdirSync(output, { recursive: true }); fs.writeFileSync(path.join(output, name + '.png'), (await win.webContents.capturePage()).toPNG()); } // CHANGE
    try { // NEW
        await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<!doctype html><html><body style="margin:0;background:#f6faf5"><div id="graph" style="position:relative;width:100vw;height:100vh;overflow:hidden"></div></body></html>')); // NEW
        await evaluate('window.mxLoadResources=false;window.mxLoadStylesheets=false;window.urlParams={};'); // NEW
        await evaluate(fs.readFileSync(path.join(webapp, 'js/app.min.js'), 'utf8') + '\n;void 0;'); // NEW
        await evaluate(` // NEW
            const style=document.createElement('style');style.textContent=${JSON.stringify(fs.readFileSync(path.join(webapp, 'mxgraph/css/common.css'), 'utf8') + '\n' + fs.readFileSync(path.join(webapp, 'styles/grapheditor.css'), 'utf8'))};document.head.appendChild(style); // NEW
            window.graph=new Graph(document.getElementById('graph')); // NEW
            graph.view.getCanvas().ownerSVGElement.style.position='absolute'; // NEW
            window.ui={editor:{graph},menus:{get:()=>null},actions:{get:()=>null},hoverIcons:new HoverIcons(graph)};window.Draw={loadPlugin:fn=>fn(ui)};void 0; // CHANGE
        `); // NEW
        await evaluate(fs.readFileSync(path.join(webapp, 'plugins/garden_planner_plugins/Trellis_UI_Cleanup.js'), 'utf8') + '\n;void 0;'); // NEW
        await evaluate(` // NEW
            graph.setConnectable(true);graph.setPanning(false);graph.gridEnabled=false;graph.graphHandler.guidesEnabled=false; // NEW
            window.a=graph.insertVertex(null,'a','Source',140,140,120,70,'rounded=1;whiteSpace=wrap;html=1;fillColor=#ffffff;fontSize=16;'); // NEW
            window.b=graph.insertVertex(null,'b','Destination',500,140,120,70,'rounded=1;whiteSpace=wrap;html=1;fillColor=#ffffff;fontSize=16;'); // NEW
            graph.model.beginUpdate();try{window.edge=graph.insertEdge(null,'u','',a,b,'edgeStyle=orthogonalEdgeStyle;rounded=0;endArrow=block;strokeWidth=2;');const geo=edge.geometry.clone();geo.points=[new mxPoint(200,360),new mxPoint(560,360)];graph.model.setGeometry(edge,geo);}finally{graph.model.endUpdate();} // NEW
            window.undo=new mxUndoManager();graph.model.addListener(mxEvent.UNDO,(_s,e)=>undo.undoableEditHappened(e.getProperty('edit'))); // NEW
            window.read=()=>{const s=graph.view.getState(edge);return {points:s.absolutePoints.map(p=>({x:p.x,y:p.y})),painted:s.shape.points.map(p=>({x:p.x,y:p.y})),target:{x:b.geometry.x,y:b.geometry.y},style:edge.style,live:!!graph.graphHandler.livePreviewUsed};};void 0; // NEW
        `); // NEW
        win.webContents.focus(); await snapshot('before'); const before = await evaluate('read()'); // NEW
        win.webContents.sendInputEvent({ type: 'mouseDown', x: 560, y: 175, button: 'left', clickCount: 1 }); await delay(40); // NEW
        win.webContents.sendInputEvent({ type: 'mouseMove', x: 590, y: 190, button: 'left', modifiers: ['leftButtonDown'] }); await delay(40); // NEW
        win.webContents.sendInputEvent({ type: 'mouseMove', x: 650, y: 220, button: 'left', modifiers: ['leftButtonDown'] }); await delay(60); // NEW
        const preview = await evaluate('read()'); assert.equal(preview.live, true, 'native gesture must use live preview'); assert.deepEqual(preview.target, before.target); // NEW
        assert.equal(preview.painted.length, 4); assert.ok(Math.abs(preview.painted[2].x - preview.painted[3].x) < 0.1); // NEW
        await snapshot('drag-preview'); win.webContents.sendInputEvent({ type: 'mouseUp', x: 650, y: 220, button: 'left', clickCount: 1 }); await delay(80); // NEW
        const committed = await evaluate('read()'); assert.equal(committed.points.length, 4); assert.ok(committed.target.x > before.target.x); // NEW
        assert.ok(Math.abs(committed.points[3].x - committed.target.x - 60) < 0.1); assert.equal(committed.points[1].y, 360); // NEW
        assert.deepEqual(committed.painted, preview.painted); assert.equal(await evaluate('undo.history.length'), 1); await snapshot('committed'); // NEW
        await evaluate('undo.undo();void 0;'); assert.deepEqual((await evaluate('read()')).points, before.points); // NEW
        await evaluate('undo.redo();void 0;'); assert.deepEqual((await evaluate('read()')).points, committed.points); // NEW
        const arrow = await evaluate(`(() => { // NEW
            graph.removeCells(graph.getChildCells(graph.getDefaultParent()));graph.clearSelection(); // NEW
            window.c=graph.insertVertex(null,'c','Drag from left',500,300,150,80,'rounded=1;whiteSpace=wrap;html=1;fillColor=#ffffff;fontSize=16;'); // NEW
            window.d=graph.insertVertex(null,'d','Arrive at bottom',140,140,150,80,'rounded=1;whiteSpace=wrap;html=1;fillColor=#ffffff;fontSize=16;'); // NEW
            ui.hoverIcons.setCurrentState(graph.view.getState(c));ui.hoverIcons.repaint();ui.hoverIcons.setDisplay('');undo.clear(); // CHANGE
            const r=ui.hoverIcons.arrowLeft.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2),width:r.width}; // NEW
        })()`); assert.ok(arrow.width > 0, 'the native hover arrow must be visible: ' + JSON.stringify(arrow)); // CHANGE
        win.webContents.debugger.attach('1.3'); // NEW
        await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', x: arrow.x, y: arrow.y }); await delay(60); // CHANGE
        await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mousePressed', x: arrow.x, y: arrow.y, button: 'left', buttons: 1, clickCount: 1 }); await delay(40); // CHANGE
        await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 430, y: 340, button: 'left', buttons: 1 }); await delay(60); // CHANGE
        await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 215, y: 220, button: 'left', buttons: 1 }); await delay(100); // CHANGE
        const arrowPreview = await evaluate(`(() => {const h=graph.connectionHandler;if(!h.edgeState||!h.edgeState.absolutePoints)throw new Error('The hover-arrow gesture must produce a routed preview.');return {style:h.edgeState.style,points:h.edgeState.absolutePoints.map(p=>({x:p.x,y:p.y}))};})()`); // CHANGE
        assert.equal(arrowPreview.style.sourcePortConstraint, 'west'); assert.equal(arrowPreview.style.targetPortConstraint, 'south'); // NEW
        await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 215, y: 220, button: 'left', buttons: 0, clickCount: 1 }); await delay(80); // CHANGE
        const arrowCommitted = await evaluate(`(() => {window.edge=graph.getSelectionCell();return {source:edge.source.id,target:edge.target.id,style:graph.getCurrentCellStyle(edge),points:graph.view.getState(edge).absolutePoints.map(p=>({x:p.x,y:p.y}))};})()`); // NEW
        assert.equal(arrowCommitted.source, 'c'); assert.equal(arrowCommitted.target, 'd'); assert.equal(arrowCommitted.style.sourcePortConstraint, 'west'); assert.equal(arrowCommitted.style.targetPortConstraint, 'south'); // NEW
        assert.deepEqual(arrowCommitted.points, arrowPreview.points); assert.equal(await evaluate('undo.history.length'), 1); // NEW
        const clearanceState = await evaluate(`(() => {const geo=edge.geometry.clone();geo.points=[new mxPoint(500,540),new mxPoint(215,540)];graph.model.setGeometry(edge,geo);const s=graph.view.getState(edge);return {points:s.absolutePoints.map(p=>({x:p.x,y:p.y})),painted:s.shape.points.map(p=>({x:p.x,y:p.y}))};})()`); // CHANGE
        const clearance = clearanceState.points; assert.deepEqual(clearanceState.painted, clearance, 'the SVG renderer must paint the corrected clearance bends'); // NEW
        assert.equal(clearance[0].x, 500); assert.equal(clearance[0].y, 340); assert.ok(clearance[1].x < 500, 'the first segment must leave left'); assert.equal(clearance[1].y, 340); // CHANGE
        assert.ok(clearance.some(p=>p.y===540), 'the crossbar must stay at y=540'); await snapshot('chosen-sides-clearance'); // CHANGE
        console.log('EDGE_ATTACHMENT_RESULT:' + JSON.stringify({ ok: true, preview: preview.painted, committed: committed.points, arrowDeparture: arrowCommitted.style.sourcePortConstraint, arrowArrival: arrowCommitted.style.targetPortConstraint, screenshots: output })); // CHANGE
        win.destroy(); app.exit(0); // NEW
    } catch (error) { console.error(error.stack || error); win.destroy(); app.exit(1); } // NEW
}); // NEW
