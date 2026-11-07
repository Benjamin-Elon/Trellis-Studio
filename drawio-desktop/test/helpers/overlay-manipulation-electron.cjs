const assert = require('node:assert/strict'); // NEW
const fs = require('node:fs'); // NEW
const path = require('node:path'); // NEW
const { app, BrowserWindow } = require('electron'); // NEW
const webapp = path.resolve(__dirname, '../../drawio/src/main/webapp'); // NEW
app.commandLine.appendSwitch('disable-gpu'); app.disableHardwareAcceleration(); app.commandLine.appendSwitch('in-process-gpu'); // NEW
const profile = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'trellis-overlay-electron-')); app.setPath('userData', profile); // NEW

/** Verify real CSS precedence, pointer hit-testing, native handlers, and the first restored frame in Chromium. */ // NEW
app.whenReady().then(async () => { // NEW
    const win = new BrowserWindow({ show: false, width: 1200, height: 900, webPreferences: { sandbox: false, backgroundThrottling: false } }); // NEW
    try { // NEW
        await win.loadURL('data:text/html,' + encodeURIComponent('<!doctype html><body style="margin:0"><button id="fixed">Toolbar</button><div id="graph" style="position:absolute;left:120px;top:40px;width:1050px;height:800px;overflow:auto"></div></body>')); // NEW
        const run = script => win.webContents.executeJavaScript(script).catch(error => { throw new Error(error.message + '\nRenderer script:\n' + script, { cause: error }); }); // CHANGE: surface the failing browser step when a native regression fails.
        await run('window.mxLoadResources=false;window.mxLoadStylesheets=false;'); // NEW
        await run(fs.readFileSync(path.join(webapp, 'mxgraph/mxClient.js'), 'utf8')); // NEW
        const cleanup = fs.readFileSync(path.join(webapp, 'plugins/garden_planner_plugins/Trellis_UI_Cleanup.js'), 'utf8'); // NEW
        await run(cleanup.slice(0, cleanup.indexOf('\nDraw.loadPlugin'))); // NEW
        await run(`
            window.graph=new mxGraph(document.getElementById('graph')); graph.setHtmlLabels(true); graph.setDropEnabled(true);
            graph.isSpecialColor=()=>false; graph.getCompositeParent=cell=>cell;
            graph.convertValueToString=cell=>cell.getAttribute?.('label') || String(cell.value || '');
            window.api=Trellis.ui.installOverlayVisibility(graph);
            window.Draw={loadPlugin:callback=>callback({editor:{graph},actions:{get:()=>null,addAction:()=>({})}})};
            window.frames=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
            window.display=node=>getComputedStyle(node).display;
            window.xml=attrs=>{const node=mxUtils.createXmlDocument().createElement('object');for(const [key,value]of Object.entries(attrs))node.setAttribute(key,value);return node;};
            void 0;
        `); // NEW
        for (const name of ['Planting_Group.js', 'Garden_Beds.js', 'Bed_Succession_Navigator.js', 'Deep_Click_Through.js']) await run(fs.readFileSync(path.join(webapp, 'plugins/garden_planner_plugins', name), 'utf8')); // NEW
        await run(`
            window.garden=graph.insertVertex(null,'garden',xml({garden_module:'1',label:'Garden'}),20,20,950,700);
            window.bed=graph.insertVertex(garden,'bed',xml({garden_bed:'1',label:'Bed'}),240,200,320,200);
            window.crop=graph.insertVertex(garden,'crop',xml({tiler_group:'1',label:'Crop',bed_auto_fit:'0'}),280,240,140,90);
            window.panel=document.createElement('div');panel.style.cssText='position:absolute;left:650px;top:250px;width:220px;height:120px;background:white;pointer-events:auto;display:flex;z-index:10030';
            panel.innerHTML='<input value="unsaved draft">';graph.container.appendChild(panel);api.mark(panel);window.input=panel.firstChild;
            window.hidden=document.createElement('div');hidden.style.display='none';document.body.appendChild(hidden);api.mark(hidden);
            window.annotation=new mxPolyline([new mxPoint(200,200),new mxPoint(800,400)],'#2563eb',2);annotation.init(graph.view.overlayPane);annotation.redraw();api.mark(annotation.node);
            window.restored=[];graph.addListener('trellisOverlayVisibilityChanged',(_sender,event)=>{if(event.getProperty('suppressed'))return;const panel=document.querySelector('.trellis-bed-conditions-overlay'),state=graph.view.getState(bed);if(panel&&state)restored.push(Math.abs(parseFloat(panel.style.top)-(state.y+(state.height-panel.offsetHeight)/2))<=1);});
            graph.setSelectionCell(bed);graph.view.validate();void 0;
        `); // NEW
        await run('frames()'); // NEW
        const bedPanelCount = await run('document.querySelectorAll(".trellis-bed-conditions-overlay").length'); assert.ok(bedPanelCount); // NEW
        const start = await run('(()=>{const s=graph.view.getState(bed),r=graph.container.getBoundingClientRect();return {x:Math.round(r.left+s.x+25),y:Math.round(r.top+s.y+25)}})()'); // NEW
        const mouse = (type, x, y) => win.webContents.sendInputEvent({ type, x, y, button: 'left', clickCount: 1 }); // NEW
        mouse('mouseDown', start.x, start.y); // NEW
        assert.equal(await run('display(panel)'), 'flex'); // NEW
        mouse('mouseMove', start.x + 60, start.y + 45); await run('frames()'); // NEW
        assert.equal(await run('api.isSuppressed()'), true); // NEW
        assert.equal(await run('display(annotation.node)'), 'none'); // NEW: the same policy covers SVG annotations.
        const hiddenCheck = await run(`(()=>{const r=panel.getBoundingClientRect();return {display:display(panel),bedPanels:[...document.querySelectorAll('.trellis-bed-conditions-overlay')].map(display),fixed:display(document.getElementById('fixed')),hit:panel.contains(document.elementFromPoint(120+700,40+300)),preview:!!(graph.graphHandler.shape||graph.graphHandler.livePreviewActive)}})()`); // NEW
        assert.equal(hiddenCheck.display, 'none'); hiddenCheck.bedPanels.forEach(value => assert.equal(value, 'none')); assert.notEqual(hiddenCheck.fixed, 'none'); assert.equal(hiddenCheck.hit, false); assert.equal(hiddenCheck.preview, true); // NEW
        mouse('mouseUp', start.x + 60, start.y + 45); await run('frames()'); // NEW
        assert.equal(await run('restored[0]'), true); assert.notEqual(await run('display(annotation.node)'), 'none'); // NEW: the first restored frame is already measured and aligned.
        assert.deepEqual(await run('({display:display(panel),same:panel.firstChild===input,draft:input.value,hidden:display(hidden),active:api.isSuppressed()})'), { display: 'flex', same: true, draft: 'unsaved draft', hidden: 'none', active: false }); // NEW
        assert.equal(await run('panel.contains(document.elementFromPoint(120+700,40+300))'), true); // NEW
        const aligned = await run(`(()=>{const panel=document.querySelector('.trellis-bed-conditions-overlay'),state=graph.view.getState(bed);return Math.abs(parseFloat(panel.style.top)-(state.y+(state.height-panel.offsetHeight)/2))<=1})()`); assert.equal(aligned, true); // NEW

        // Handle moves use document gesture listeners; Escape must detach them and preserve geometry. // NEW
        await run(`graph.__trellisWorkspaceDragPolicy.beginHandleDragForTests(bed,new MouseEvent('mousedown',{clientX:${start.x},clientY:${start.y},button:0}));void 0;`); // NEW
        assert.equal(await run('display(panel)'), 'flex'); // NEW
        await run(`document.dispatchEvent(new PointerEvent(mxClient.IS_POINTER?'pointermove':'mousemove',{clientX:${start.x + 90},clientY:${start.y + 70},pointerType:'mouse',bubbles:true}));void 0;`); await run('frames()'); // NEW
        assert.equal(await run('display(panel)'), 'none'); // NEW
        const beforeCancel = await run('JSON.stringify(graph.getCellGeometry(bed))'); // NEW
        await run('graph.escape();frames()'); assert.equal(await run('display(panel)'), 'flex'); // NEW
        await run(`document.dispatchEvent(new PointerEvent(mxClient.IS_POINTER?'pointermove':'mousemove',{clientX:${start.x + 160},clientY:${start.y + 100},pointerType:'mouse',bubbles:true}));document.dispatchEvent(new PointerEvent(mxClient.IS_POINTER?'pointerup':'mouseup',{pointerType:'mouse',bubbles:true}));void 0;`); // NEW
        assert.equal(await run('JSON.stringify(graph.getCellGeometry(bed))'), beforeCancel); assert.equal(await run('graph.__trellisWorkspaceHandleDragActive'), false); // NEW

        for (const rotation of [false, true]) { // NEW
            await run(`window.vh=new mxVertexHandler(graph.view.getState(bed));vh.start(600,440,${rotation ? 'mxEvent.ROTATION_HANDLE' : '7'});vh.mouseMove(graph,new mxMouseEvent(new MouseEvent('mousemove',{clientX:650,clientY:490}),graph.view.getState(bed)));void 0;`); // NEW
            assert.equal(await run('display(panel)'), 'none'); // NEW
            assert.notEqual(await run('display((vh.preview||vh.selectionBorder).node)'), 'none'); // NEW
            await run('vh.reset();vh.destroy();frames()'); assert.equal(await run('display(panel)'), 'flex'); // NEW
        } // NEW
        await run(`window.source=new mxDragSource(document.getElementById('fixed'),()=>{});source.createPreviewElement=()=>document.createElement('div');source.dragEnter(graph,new MouseEvent('mousemove'));source.currentGraph=graph;void 0;`); // NEW
        assert.equal(await run('display(panel)'), 'none'); assert.notEqual(await run('display(source.previewElement)'), 'none'); // NEW
        await run('source.dragExit(graph);source.currentGraph=null;frames()'); assert.equal(await run('display(panel)'), 'flex'); // NEW
        await run('source.dragEnter(graph,new MouseEvent("mousemove"));source.currentGraph=graph;source.reset();frames()'); assert.equal(await run('display(panel)'), 'flex'); // NEW
        // A planting frame may own the native event while click-through selection resolves its gap to the bed. // NEW
        await run(` // NEW
            graph.clearSelection();graph.removeCells([garden]);panel.remove();annotation.destroy(); // NEW
            window.garden=graph.insertVertex(null,'occupied-garden',xml({garden_module:'1',label:'Garden'}),20,20,950,700,'swimlane;module=1;'); // NEW: action controls require a real garden module ancestor.
            window.bed=graph.insertVertex(garden,'occupied-bed',xml({garden_bed:'1',label:'Occupied bed'}),240,200,320,200); // NEW
            window.crop=graph.insertVertex(garden,'occupied-crop',xml({tiler_group:'1',label:'Carrots',bed_auto_fit:'0'}),240,200,320,200,'shape=rectangle;fillColor=none;strokeColor=#000000;dashed=1;verticalAlign=top;'); // NEW
            window.plant=graph.insertVertex(crop,'occupied-plant',xml({plant_tiler:'1',label:'C'}),280,80,30,30,'ellipse;fillColor=#f49a34;'); // NEW: keep direct plant clicks clear of the gap-anchored action toolbar.
            window.bedClickTrace=[];graph.addListener(mxEvent.FIRE_MOUSE_EVENT,(_sender,event)=>{ // NEW
                if(event.getProperty('eventName')!==mxEvent.MOUSE_DOWN)return; // NEW
                const me=event.getProperty('event'),point=mxUtils.convertPoint(graph.container,me.getX(),me.getY()); // NEW
                bedClickTrace.push({raw:me.getCell()?.id,hit:graph.getCellAt(point.x,point.y)?.id}); // NEW
            }); // NEW
            void 0; // NEW
        `); // NEW
        for (const scale of [1, 1.25]) { // NEW
            await run(`graph.clearSelection();graph.view.setScale(${scale});graph.view.setTranslate(17,23);graph.view.validate();graph.container.scrollLeft=35;graph.container.scrollTop=20;frames();`); // NEW
            const gap = await run(`(()=>{const state=graph.view.getState(crop),rect=graph.container.getBoundingClientRect();const x=Math.round(rect.left-graph.container.scrollLeft+state.x+30*graph.view.scale),y=Math.round(rect.top-graph.container.scrollTop+state.y+60*graph.view.scale);return {x,y,frameHit:state.shape.node.contains(document.elementFromPoint(x,y))};})()`); // NEW
            assert.equal(gap.frameHit, true, 'native hit must belong to the transparent planting frame'); // NEW
            const before = await run('mxUtils.getXml(new mxCodec().encode(graph.model))'); // NEW
            for (const visible of [true, false, true]) { // NEW: initial selection, dismissal, then reopening.
                mouse('mouseDown', gap.x, gap.y); // NEW
                if (!visible) assert.equal(await run('document.querySelectorAll(".trellis-bed-conditions-overlay").length'), 1, 'press retains conditions'); // NEW
                mouse('mouseUp', gap.x, gap.y); await run('frames()'); // NEW
                const actual = await run(`({selected:graph.getSelectionCells().map(cell=>cell.id),conditions:document.querySelectorAll('.trellis-bed-conditions-overlay').length,actions:document.querySelector('.trellis-garden-module-label-controls')?.parentNode.style.display ?? null,hidden:graph.__plantTilerIsBedOverlayHidden(bed),trace:bedClickTrace.at(-1)})`); // NEW
                assert.deepEqual(actual, { selected: ['occupied-bed'], conditions: visible ? 1 : 0, actions: visible ? 'flex' : 'none', hidden: !visible, trace: { raw: 'occupied-crop', hit: 'occupied-bed' } }); // NEW
            } // NEW
            assert.equal(await run('mxUtils.getXml(new mxCodec().encode(graph.model))'), before, 'native toggles preserve diagram data'); // NEW
            const circle = await run(`(()=>{const state=graph.view.getState(plant),rect=graph.container.getBoundingClientRect();const x=Math.round(rect.left-graph.container.scrollLeft+state.getCenterX()),y=Math.round(rect.top-graph.container.scrollTop+state.getCenterY()),target=document.elementFromPoint(x,y);return {x,y,plantHit:state.shape.node.contains(target)||!!state.text?.node.contains(target),target:target?.outerHTML.slice(0,600)};})()`); // NEW
            assert.equal(circle.plantHit, true, 'native plant click must reach its circle or label: ' + JSON.stringify(circle)); // NEW
            mouse('mouseDown', circle.x, circle.y); mouse('mouseUp', circle.x, circle.y); await run('frames()'); // NEW
            assert.deepEqual(await run('graph.getSelectionCells().map(cell=>cell.id)'), ['occupied-crop'], 'plant clicks retain group selection'); // NEW
            assert.equal(await run('graph.__plantTilerIsBedOverlayHidden(bed)'), false); // NEW
        } // NEW
        console.log('Chromium overlay visibility, hit-testing, native move/handle/resize/rotation/library, occupied-bed toggling and restoration checks passed'); // CHANGE
    } finally { win.destroy(); } // NEW
    app.quit(); // NEW
}).catch(error => { console.error(error.stack || error); app.exit(1); }); // NEW
