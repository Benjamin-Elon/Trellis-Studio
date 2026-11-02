/** Real Chromium pointer gestures must reach the production circle containment boundary. */ // CHANGE
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'); // CHANGE
const { app, BrowserWindow } = require('electron'); // CHANGE
const webapp = path.resolve(__dirname, '../../drawio/src/main/webapp'); // CHANGE
app.disableHardwareAcceleration(); app.commandLine.appendSwitch('disable-gpu'); app.commandLine.appendSwitch('in-process-gpu'); // CHANGE: use the same Chromium setup as the existing native fixtures.
const profile = path.join(app.getPath('temp'), 'trellis-circle-containment-' + process.pid); fs.mkdirSync(profile, { recursive: true }); app.setPath('userData', profile); // CHANGE
app.whenReady().then(async () => { // CHANGE
    const win = new BrowserWindow({ show: false, width: 1000, height: 800, webPreferences: { sandbox: false, backgroundThrottling: false } }); // CHANGE
    win.webContents.on('console-message', event => { if (event.level === 'error') process.stderr.write(event.message + '\n'); }); // CHANGE
    const run = source => win.webContents.executeJavaScript('try {\n' + source + '\n} catch(error) { console.error(error.stack); throw error; }'), settle = () => run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))'); // CHANGE: expose renderer failures instead of Electron's generic execution error.
    const mouse = (type, x, y) => win.webContents.sendInputEvent({ type, x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1 }); // CHANGE
    try { // CHANGE
        const host = path.join(profile, 'host.html'); fs.writeFileSync(host, '<!doctype html><body style="margin:0"><div id="graph" style="position:absolute;inset:0"></div></body>'); await win.loadFile(host); // CHANGE
        await run('window.mxLoadResources=false;window.mxLoadStylesheets=false;'); await run(fs.readFileSync(path.join(webapp, 'mxgraph/mxClient.js'), 'utf8')); // CHANGE
        await run(` // CHANGE
            const NativeDate=Date;window.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[2026,0,21,12]));}}; // CHANGE
            window.graph=new mxGraph(document.getElementById('graph'));graph.isSpecialColor=()=>false;graph.setDropEnabled(true);graph.isCellMovable=()=>true; // CHANGE
            graph.convertValueToString=cell=>cell.getAttribute?.('label')||'';graph.getCompositeParent=cell=>cell; // CHANGE
            graph.setHtmlLabels(true);graph.isHtmlLabel=cell=>graph.getCellStyle(cell).html==1;graph.graphHandler.maxLivePreview=32; // CHANGE: match the full editor rather than mxClient's outline-only default.
            window.undo=new mxUndoManager();graph.model.addListener(mxEvent.UNDO,(_,event)=>undo.undoableEditHappened(event.getProperty('edit'))); // CHANGE
            window.ui={editor:Object.assign(new mxEventSource(),{graph,undoManager:undo}),actions:{get:()=>null},getXmlFileData:()=>new mxCodec().encode(graph.model),getCurrentFile:()=>null,hideDialog(){}}; // CHANGE
            window.Draw={loadPlugin:callback=>callback(ui)};window.errors=[];addEventListener('error',event=>errors.push(event.message));void 0; // CHANGE
        `); // CHANGE
        for (const name of ['js/trellis-local-view.js', 'js/trellis-edit-context.js', 'plugins/garden_planner_plugins/Garden_Scheduler_Shared_Core.js', 'plugins/garden_planner_plugins/Planting_Group.js', 'plugins/garden_planner_plugins/Deep_Click_Through.js']) await run(fs.readFileSync(path.join(webapp, name), 'utf8')); // CHANGE
        await run(` // CHANGE
            const value=attrs=>{const node=mxUtils.createXmlDocument().createElement('object');Object.entries(attrs).forEach(([key,entry])=>node.setAttribute(key,entry));return node;}; // CHANGE
            window.garden=graph.insertVertex(null,'garden',value({garden_module:'1'}),0,0,950,750,'fillColor=none;strokeColor=none;'); // CHANGE
            window.group=graph.insertVertex(garden,'crop',value({tiler_group:'1',bed_auto_fit:'0',sow_date:'2026-01-01',germ_date:'2026-01-11',harvest_start:'2026-01-31',harvest_end:'2026-02-10',method_id:'direct_sow.field'}),100,100,200,160,'strokeColor=#000000;fillColor=none;'); // CHANGE
            window.other=graph.insertVertex(garden,'other',value({tiler_group:'1',bed_auto_fit:'0'}),500,100,200,160,'strokeColor=#000000;fillColor=none;'); // CHANGE
            window.tile=graph.insertVertex(group,'tile',value({plant_tiler:'1',auto:'0',label:'CIL'}),50,50,20,20,'shape=ellipse;fillColor=#ffffff;movable=1;resizable=0;align=center;verticalAlign=middle;html=0;'); // CHANGE
            window.sibling=graph.insertVertex(group,'sibling',value({plant_tiler:'1',auto:'0',label:'CIL'}),100,50,20,20,'shape=ellipse;fillColor=#ffffff;movable=1;resizable=0;align=center;verticalAlign=middle;html=0;'); // CHANGE
            window.growth=graph.__trellisPlantingGroup.growth;growth.refresh(); // CHANGE
            window.center=()=>{const state=graph.view.getState(tile),box=graph.container.getBoundingClientRect();return{x:box.x+state.x+state.width/2,y:box.y+state.y+state.height/2};}; // CHANGE
            window.state=()=>({parent:tile.parent.id,x:tile.geometry.x,y:tile.geometry.y,width:tile.geometry.width,height:tile.geometry.height,groupWidth:group.geometry.width,groupHeight:group.geometry.height,edits:undo.history.length,errors}); // CHANGE
            window.painted=(cell=tile)=>{const state=graph.view.getState(cell),ellipse=state.shape.node.querySelector('ellipse[stroke="#111827"]'),circle=ellipse.getBoundingClientRect(),glyph=state.text.node.querySelector('text')||Array.from(state.text.node.querySelectorAll('div')).findLast(node=>!node.childElementCount)||state.text.node,label=glyph.getBoundingClientRect();return{x:circle.x+circle.width/2,y:circle.y+circle.height/2,labelX:label.x+label.width/2,labelY:label.y+label.height/2,radius:Number(ellipse.getAttribute('rx')),outline:!!state.shape.node.querySelector('ellipse[stroke="#2563eb"]')};}; // CHANGE: measure the visible glyph, not mxGraph's oversized HTML foreignObject wrapper.
            window.modelChanges=0;graph.model.addListener(mxEvent.CHANGE,()=>modelChanges++); // CHANGE
            graph.setSelectionCell(tile);undo.clear();void 0; // CHANGE
        `); // CHANGE
        for (const html of [0, 1]) { // CHANGE
            await run(`graph.setCellStyles('html','${html}',[tile]);graph.view.scaleAndTranslate(${html ? 1.4 : 1},10,10);delete USL.scheduler.resolvePlantGrowthContext;growth.invalidate();growth.setShowHarvestSize(garden,false);growth.refresh();graph.setSelectionCell(tile);undo.clear();modelChanges=0;window.beforeXml=mxUtils.getXml(ui.getXmlFileData());void 0;`); // CHANGE
            await settle(); const baseline = await run('painted()'), origin = await run('center()'); // CHANGE
            mouse('mouseDown', origin.x, origin.y); mouse('mouseMove', origin.x + 10, origin.y); await settle(); mouse('mouseMove', origin.x + 40, origin.y + 20); await settle(); // CHANGE
            const native = await run('({active:graph.graphHandler.livePreviewActive,used:graph.graphHandler.livePreviewUsed,dx:graph.graphHandler.currentDx,dy:graph.graphHandler.currentDy})'); assert.equal(native.active, true); assert.equal(native.used, true); // CHANGE
            const checkPreview = async () => { const paint = await run('painted()'); for (const [key, delta] of [['x',native.dx],['y',native.dy],['labelX',native.dx],['labelY',native.dy]]) assert.ok(Math.abs(paint[key]-baseline[key]-delta)<1.5, JSON.stringify({html,key,paint,baseline,native})); assert.equal(paint.radius,baseline.radius); assert.equal(paint.outline,false); }; // CHANGE
            await checkPreview(); await run('window.deliverGrowth=null;window.climateContext=null;USL.scheduler.resolvePlantGrowthContext=cell=>cell===group?(climateContext?Promise.resolve(climateContext):new Promise(resolve=>deliverGrowth=resolve)):Promise.resolve({});growth.refresh();void 0;'); await settle(); // CHANGE
            await run(`const rates={};for(let day=11;day<=30;day++)rates['2026-01-'+day]=day<21?10:0;climateContext={dailyRates:rates};deliverGrowth(climateContext);growth.setShowHarvestSize(garden,true);void 0;`); await settle(); // CHANGE
            for (let frame = 0; frame < 3; frame++) { await run('growth.refresh();graph.view.revalidate();void 0;'); await checkPreview(); await run('graph.refresh();void 0;'); await checkPreview(); await settle(); await checkPreview(); } // CHANGE
            assert.equal(await run('growth.estimate(group).areaRatio'),1); assert.equal(await run('painted(sibling).outline'),true); assert.ok(await run('painted(sibling).radius')>baseline.radius); // CHANGE
            assert.equal(await run('modelChanges'),0); assert.equal(await run('mxUtils.getXml(ui.getXmlFileData())===beforeXml'),true); // CHANGE
            mouse('mouseUp',origin.x+40,origin.y+20); await settle(); const committed=await run('state()'); assert.equal(committed.edits,1); assert.equal(committed.parent,'crop'); assert.equal(await run('painted().outline'),true); assert.ok(await run('painted().radius')>baseline.radius); // CHANGE
            await run('undo.undo();undo.clear();void 0;'); await settle(); assert.equal(await run('tile.geometry.x'),50); assert.equal(await run('tile.geometry.y'),50); // CHANGE
        } // CHANGE
        await run('graph.view.scaleAndTranslate(1,0,0);void 0;'); // CHANGE: retain the original boundary and no-op gesture checks below.
        await settle(); const start = await run('center()'); // CHANGE
        mouse('mouseDown', start.x, start.y); mouse('mouseMove', start.x + 10, start.y); await settle(); mouse('mouseMove', 600, 150); await settle(); mouse('mouseUp', 600, 150); await settle(); // CHANGE
        const moved = await run('state()'); assert.equal(moved.parent, 'crop'); assert.equal(moved.x, 180); assert.ok(moved.y >= 0 && moved.y <= 140); assert.equal(moved.width, 20); assert.equal(moved.height, 20); assert.equal(moved.groupWidth, 200); assert.equal(moved.groupHeight, 160); assert.equal(moved.edits, 1); assert.deepEqual(moved.errors, []); // CHANGE
        const edge = await run('center()'); mouse('mouseDown', edge.x, edge.y); mouse('mouseMove', edge.x + 100, edge.y); await settle(); mouse('mouseUp', edge.x + 100, edge.y); await settle(); // CHANGE
        const unchanged = await run('state()'); assert.equal(unchanged.edits, 1); assert.equal(unchanged.x, 180); // CHANGE
        await run('undo.undo();void 0;'); const restored = await run('state()'); assert.equal(restored.x, 50); assert.equal(restored.y, 50); assert.equal(restored.parent, 'crop'); // CHANGE
        process.stdout.write('CIRCLE_CONTAINMENT_RESULT: native pointer drag stays inside its planting and no-op drags add no edit\n'); // CHANGE
        process.stdout.write('CIRCLE_PREVIEW_RESULT: SVG and HTML artwork stays at the live offset through growth and view refreshes before release\n'); // CHANGE
    } finally { win.destroy(); } // CHANGE
    app.quit(); // CHANGE
}).catch(error => { process.stderr.write(error.stack + '\n'); app.exit(1); }); // CHANGE
