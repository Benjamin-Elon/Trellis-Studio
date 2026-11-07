const assert = require('node:assert/strict'); // NEW
const fs = require('node:fs'); // NEW
const os = require('node:os'); // NEW
const path = require('node:path'); // NEW
const { app, BrowserWindow } = require('electron'); // NEW
const webapp = path.resolve(__dirname, '../../drawio/src/main/webapp'); // NEW
app.commandLine.appendSwitch('disable-gpu'); app.disableHardwareAcceleration(); app.commandLine.appendSwitch('in-process-gpu'); // NEW
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'trellis-task-card-toggle-'))); // NEW

/** Native input exercises mxGraph's selection ordering and shared drag suppression in Chromium. */ // NEW
app.whenReady().then(async () => { // NEW
    const win = new BrowserWindow({ show: false, width: 1100, height: 800, webPreferences: { sandbox: false, backgroundThrottling: false } }); // NEW
    try { // NEW
        await win.loadURL('data:text/html,' + encodeURIComponent('<!doctype html><body style="margin:0"><div id="graph" style="position:absolute;left:40px;top:40px;width:1000px;height:700px;overflow:auto"></div></body>')); // NEW
        const run = script => win.webContents.executeJavaScript(script); // NEW
        await run('window.mxLoadResources=false;window.mxLoadStylesheets=false;'); // NEW
        await run(fs.readFileSync(path.join(webapp, 'mxgraph/mxClient.js'), 'utf8')); // NEW
        const cleanup = fs.readFileSync(path.join(webapp, 'plugins/garden_planner_plugins/Trellis_UI_Cleanup.js'), 'utf8'); // NEW
        await run(cleanup.slice(0, cleanup.indexOf('\nDraw.loadPlugin'))); // NEW
        await run(` // NEW
            window.errors=[];window.addEventListener('error',event=>errors.push(event.message)); // NEW
            window.graph=new mxGraph(document.getElementById('graph'));graph.setHtmlLabels(true);graph.setGridEnabled(false); // NEW
            graph.isSpecialColor=()=>false;graph.getCompositeParent=cell=>cell; // NEW
            graph.convertValueToString=cell=>cell.getAttribute?.('label')||String(cell.value||''); // NEW
            window.api=Trellis.ui.installOverlayVisibility(graph); // NEW
            window.Draw={loadPlugin:callback=>callback({editor:{graph,addListener(){}},actions:{get:()=>null,addAction:()=>({})}})}; // NEW
            window.frames=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))); // NEW
            window.xml=attrs=>{const node=mxUtils.createXmlDocument().createElement('object');for(const [key,value]of Object.entries(attrs))node.setAttribute(key,value);return node;}; // NEW
            void 0; // NEW
        `); // NEW
        await run(` // NEW
            window.board=graph.insertVertex(null,'board',xml({board_key:'KANBAN_BOARD',task_view_mode:'FULL',label:'Tasks'}),100,100,700,500,'swimlane;startSize=28;'); // NEW
            window.lane=graph.insertVertex(board,'lane',xml({lane_key:'TODO',status:'TODO',label:'TODO'}),20,40,200,420,'swimlane;startSize=40;'); // NEW
            window.card=graph.insertVertex(lane,'task-a',xml({kanban_card:'1',title:'Water',label:'Water'}),20,60,160,80,'rounded=1;fillColor=#e5e7eb;'); // NEW
            window.other=graph.insertVertex(lane,'task-b',xml({kanban_card:'1',title:'Harvest',label:'Harvest'}),20,160,160,80,'rounded=1;fillColor=#e5e7eb;'); // NEW
            graph.view.validate(); // NEW
            void 0; // NEW
        `); // NEW
        await run(fs.readFileSync(path.join(webapp, 'plugins/garden_planner_plugins/Garden_Task_Manager.js'), 'utf8')); // NEW
        await run(fs.readFileSync(path.join(webapp, 'plugins/garden_planner_plugins/Deep_Click_Through.js'), 'utf8')); // NEW
        await run(` // NEW
            window.panel=document.querySelector('.trellis-task-selected-card-actions'); // NEW
            window.snapshot=()=>({selected:graph.getSelectionCells().map(cell=>cell.id),display:getComputedStyle(panel).display}); // NEW
            window.point=cell=>{const s=graph.view.getState(cell),r=graph.container.getBoundingClientRect();return {x:Math.round(r.left+s.x+30),y:Math.round(r.top+s.y+25)};}; // NEW
            void 0; // NEW
        `); // NEW
        await run('frames()'); // NEW
        const start = await run('point(card)'); // NEW
        const mouse = (type, point, extra = {}) => win.webContents.sendInputEvent({ type, ...point, button: 'left', clickCount: 1, ...extra }); // NEW
        mouse('mouseDown', start); mouse('mouseUp', start); await run('frames()'); // NEW
        assert.deepEqual(await run('snapshot()'), { selected: ['task-a'], display: 'flex' }); // NEW
        const before = await run('mxUtils.getXml(new mxCodec().encode(graph.model))'); // NEW: first selection initializes existing board preferences before measuring toggles.
        for (const display of ['none', 'flex']) { // NEW
            mouse('mouseDown', start); mouse('mouseUp', start); await run('frames()'); // NEW
            assert.deepEqual(await run('snapshot()'), { selected: ['task-a'], display }); // NEW
        } // NEW
        assert.equal(await run('mxUtils.getXml(new mxCodec().encode(graph.model))'), before, 'click toggles must preserve model data'); // NEW
        mouse('mouseDown', start); mouse('mouseUp', start); await run('frames()'); // NEW
        await run('graph.refresh();graph.view.setScale(1.1);frames()'); // NEW
        assert.equal((await run('snapshot()')).display, 'none', 'view refresh must respect dismissal'); // NEW
        const scaled = await run('point(card)'); // NEW
        mouse('mouseDown', scaled); mouse('mouseUp', scaled); await run('frames()'); // NEW
        assert.equal((await run('snapshot()')).display, 'flex'); // NEW
        mouse('mouseDown', scaled); // NEW
        assert.equal((await run('snapshot()')).display, 'flex', 'a press alone must retain the panel'); // NEW
        const moved = { x: scaled.x + 60, y: scaled.y + 35 }; // NEW
        mouse('mouseMove', moved); await run('frames()'); // NEW
        assert.equal(await run('api.isSuppressed()'), true); // NEW
        mouse('mouseUp', moved); await run('frames()'); // NEW
        assert.equal((await run('snapshot()')).display, 'flex', 'drag release must not dismiss'); // NEW
        const current = await run('point(card)'); // NEW
        mouse('mouseDown', current); mouse('mouseMove', { x: current.x + 20, y: current.y }); await run('frames()'); // NEW: flush native movement so Chromium cannot coalesce the outbound and return events.
        mouse('mouseMove', current); await run('frames()'); mouse('mouseUp', current); await run('frames()'); // NEW
        assert.equal((await run('snapshot()')).display, 'flex', 'returning to the press after movement is still a drag'); // NEW
        mouse('mouseDown', current); mouse('mouseUp', current); await run('frames()'); // NEW
        assert.equal((await run('snapshot()')).display, 'none'); // NEW
        const next = await run('point(other)'); // NEW
        mouse('mouseDown', next); mouse('mouseUp', next); await run('frames()'); // NEW
        assert.deepEqual(await run('snapshot()'), { selected: ['task-b'], display: 'flex' }); // NEW
        assert.deepEqual(await run('errors'), []); // NEW
        console.log('Native task card selection, toggling, refresh and drag checks passed'); // NEW
    } finally { win.destroy(); } // NEW
    app.quit(); // NEW
}).catch(error => { console.error(error.stack || error); app.exit(1); }); // NEW
