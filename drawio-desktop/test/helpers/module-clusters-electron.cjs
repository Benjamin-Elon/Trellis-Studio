const assert = require('node:assert/strict'); // NEW
const fs = require('node:fs'); // NEW
const path = require('node:path'); // NEW
const os = require('node:os'); // NEW
const http = require('node:http'); // NEW
const { execFileSync } = require('node:child_process'); // NEW
const { app, BrowserWindow } = require('electron'); // NEW
const webapp = path.resolve(__dirname, '../../drawio/src/main/webapp'); // NEW
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'trellis-clusters-'))); // NEW
app.commandLine.appendSwitch('disable-background-timer-throttling'); // NEW
app.commandLine.appendSwitch('disable-renderer-backgrounding'); // NEW
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion,IntensiveWakeUpThrottling'); // NEW
app.commandLine.appendSwitch('js-flags', '--expose-gc'); // NEW: release generated fixture intermediates before timing a real decode.
app.disableHardwareAcceleration(); app.commandLine.appendSwitch('in-process-gpu'); // NEW: use the repository's stable isolated-test renderer on this Windows host.
const benchmark = process.argv.includes('--benchmark'); // NEW
const baseline = process.argv.includes('--baseline'); // NEW
let server; // NEW

/** Use a private loopback origin so preference tests exercise real localStorage. */ // NEW
async function initialize(win) { // NEW
    server = http.createServer((_request, response) => { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><body style="margin:0"><div id="graph" style="position:absolute;inset:40px;overflow:auto"></div></body>'); }); // NEW
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); // NEW
    await win.loadURL('http://127.0.0.1:' + server.address().port); // NEW
    const run = script => { if(process.argv.includes('--trace'))console.log('RUN:',script.slice(0,90).replace(/\s+/g,' '));return win.webContents.executeJavaScript(script); }; // NEW
    await run('window.mxLoadResources=false;window.mxLoadStylesheets=false;'); // NEW
    await run(fs.readFileSync(path.join(webapp, 'mxgraph/mxClient.js'), 'utf8')); // NEW
    await run('window.urlParams={grid:"0"};window.DOM_PURIFY_CONFIG={};window.Editor=function(){};window.EditorUi=function(){};void 0;'); // NEW: use the production Graph class without returning a function across Electron IPC.
    await run(fs.readFileSync(path.join(webapp, 'js/sanitizer/purify.min.js'), 'utf8') + '\n;void 0;'); // NEW
    await run(fs.readFileSync(path.join(webapp, 'js/grapheditor/Graph.js'), 'utf8') + '\n;void 0;'); // NEW
    await run(` // NEW
        window.errors=[]; window.addEventListener('error',event=>errors.push(event.message)); // NEW
        window.graph=new Graph(document.getElementById('graph')); // NEW
        graph.useCssTransforms=true;graph.currentScale=1;graph.currentTranslate=new mxPoint(0,0); // NEW: match the desktop editor's normal pan/zoom path.
        graph.setHtmlLabels(true); graph.setGridEnabled(false); // NEW
        graph.getCurrentCellStyle=cell=>graph.getCellStyle(cell); // NEW
        graph.getCompositeParent=cell=>cell; graph.isSpecialColor=()=>-1; // NEW
        graph.convertValueToString=cell=>cell.getAttribute?.('label')||String(cell.value||''); // NEW
        window.editor=new mxEventSource(); editor.graph=graph; // NEW
        window.ui={editor,actions:{get:()=>null,addAction:()=>({})},getCurrentFile:()=>({}),alert:message=>{throw Error(message);}}; // NEW
        ui.getFileData=()=>mxUtils.getXml(new mxCodec().encode(graph.model)); // NEW
        ui.downloadRequestBuilder=(filename,format)=>({format,xml:ui.getFileData(),from:3,to:4,allPages:1}); // NEW
        window.Trellis={users:{getDiagramKey:()=> 'cluster-test',getCurrentUser:()=>({id:'test-user'})}}; // NEW
        window.TrellisContextMenu={install(){},register(){}}; // NEW
        window.Draw={loadPlugin:callback=>callback(ui)}; // NEW
        window.frames=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))); // NEW
        window.valueDocument=mxUtils.createXmlDocument(); // NEW
        window.value=attributes=>{const node=valueDocument.createElement('object');Object.entries(attributes).forEach(([key,text])=>node.setAttribute(key,String(text)));return node;}; // NEW
        window.makeModule=(id,x=0,attributes={},parent=graph.getDefaultParent())=>{ // NEW
            const cell=new mxCell(value({label:id,...attributes}),new mxGeometry(x,50,180,120),'swimlane;module=1;html=1;collapsible=1;'); // NEW
            cell.id=id;cell.vertex=true;cell.collapsed=true;graph.model.add(parent,cell);return cell; // NEW
        }; // NEW
        window.makeContent=(parent,id,attributes={})=>{ // NEW
            const cell=new mxCell(value({label:id,...attributes}),new mxGeometry(10,30,30,20),'html=1;'); // NEW
            cell.id=id;cell.vertex=true;graph.model.add(parent,cell);return cell; // NEW
        }; // NEW
        window.write=(cell,attrs)=>{const node=cell.value.cloneNode(true);Object.entries(attrs).forEach(([key,text])=>node.setAttribute(key,String(text)));graph.model.setValue(cell,node);}; // NEW
        window.undo=new mxUndoManager(); graph.model.addListener(mxEvent.UNDO,(_sender,event)=>undo.undoableEditHappened(event.getProperty('edit'))); // NEW
        void 0; // NEW
    `); // NEW
    for (const name of ['Modules_Standalone.js', 'Garden_Dashboard.js', 'Vertex_Linking_Standalone.js']) { // NEW
        const source = baseline ? execFileSync('git', ['show', 'HEAD:drawio-desktop/drawio/src/main/webapp/plugins/garden_planner_plugins/' + name], { cwd: path.resolve(__dirname, '../../..'), encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }) : fs.readFileSync(path.join(webapp, 'plugins/garden_planner_plugins', name), 'utf8'); // NEW
        await run(source + '\n//# sourceURL=' + name); // NEW
    } // NEW
    await run('window.clusters=graph.__trellisModules.clusters;frames()'); // NEW
    return run; // NEW
} // NEW

/** Native transactions, renderer states and undo all run inside Chromium, without a model double. */ // NEW
async function behavior(run) { // NEW
    await run(` // NEW
        graph.model.beginUpdate(); // NEW
        try { // NEW
            window.a=makeModule('a',0,{garden_module:1,city_id:'1',city_name:'Springfield',region_name:'North'}); // NEW
            window.b=makeModule('b',300,{garden_module:1,city_id:'1',city_name:'Springfield',region_name:'North'}); // NEW
            window.c=makeModule('c',600,{garden_module:1,city_id:'2',city_name:'Springfield',region_name:'South'}); // NEW
            window.team=makeModule('team',200,{team_module:1,trellis_garden_module_id:'a'}); // NEW
            window.nested=makeModule('nested',5,{},a); // NEW
            window.standalone=makeModule('standalone',900); // NEW
            window.leaf=makeContent(a,'leaf'); // NEW
            window.otherLeaf=makeContent(c,'other-leaf'); // NEW
            write(leaf,{linkedTo:otherLeaf.id}); // NEW
        } finally {graph.model.endUpdate();} // NEW
        void 0; // NEW
    `); // NEW
    assert.deepEqual(await run('[clusters.snapshot().clusters,clusters.getCluster(a)===clusters.getCluster(team),clusters.getCluster(a)===clusters.getCluster(nested),clusters.getCluster(a)!==clusters.getCluster(c)]'), [4, true, true, true]); // NEW
    await run('graph.foldCells(false,false,[a]);graph.foldCells(false,false,[b]);graph.setSelectionCell(a);undo.clear();graph.foldCells(false,false,[c]);void 0;'); // NEW
    assert.deepEqual(await run('[a.collapsed,b.collapsed,c.collapsed,clusters.snapshot().expanded.length,undo.history.length]'), [false, true, false, 2, 1]); // NEW
    await run('undo.undo();void 0;'); // NEW
    assert.deepEqual(await run('[a.collapsed,b.collapsed,c.collapsed,clusters.snapshot().expanded.length]'), [false, false, true, 2]); // NEW
    await run('undo.redo();void 0;'); // NEW
    assert.deepEqual(await run('[a.collapsed,b.collapsed,c.collapsed]'), [false, true, false]); // NEW
    await run('graph.foldCells(true,false,[a,b,c]);graph.foldCells(false,false,[b,a,c]);void 0;'); // NEW
    assert.deepEqual(await run('[a.collapsed,b.collapsed,c.collapsed]'), [false, false, true]); // NEW
    await run('graph.foldCells(false,false,[nested]);graph.foldCells(false,false,[c]);graph.foldCells(false,false,[b]);void 0;'); // NEW
    assert.deepEqual(await run('[a.collapsed,nested.collapsed,clusters.snapshot().expanded.length]'), [true,true,2]); // NEW: eviction includes nested members and leaves no hidden expansion slot behind.
    await run('graph.foldCells(true,false,[a,b,c,nested]);graph.foldCells(false,false,[b,a]);void 0;'); // NEW
    await run('graph.setSelectionCell(a);graph.model.setCollapsed(c,false);void 0;'); // NEW
    assert.deepEqual(await run('[a.collapsed,b.collapsed,c.collapsed]'), [false,true,false]); // NEW: direct native collapse changes reveal their requested cluster before eviction.
    await run('write(b,{linkedTo:"c,missing"});write(c,{linkedTo:"b"});void 0;'); // NEW
    assert.equal(await run('clusters.getCluster(b)===clusters.getCluster(c)'), true); // NEW
    await run('write(c,{linkedTo:"a"});void 0;'); // NEW
    assert.equal(await run('clusters.getCluster(a)===clusters.getCluster(c)'), true); // NEW
    await run('clusters.setCity("id:1");void 0;'); // NEW
    assert.deepEqual(await run('[clusters.isRendered(c),clusters.cityForGarden(clusters.focusForCity(c))]'), [true,'id:1']); // NEW: mixed-city components render whole, while city focus still chooses a matching garden.
    await run('write(b,{linkedTo:""});write(c,{linkedTo:""});void 0;'); // NEW
    assert.equal(await run('clusters.getCluster(a)!==clusters.getCluster(c)'), true); // NEW
    const labels = await run('clusters.getCities().map(city=>city.label)'); // NEW
    assert.ok(labels.includes('Springfield — North') && labels.includes('Springfield — South')); // NEW
    await run('window.USL={scheduler:{resolveCityForModule:async cell=>({ok:true,city:{city_name:cell.getAttribute("city_name"),region_name:cell.getAttribute("region_name"),country_name:"Test Country"}})}};clusters.getCities();frames()'); // NEW
    assert.ok((await run('clusters.getCities().map(city=>city.label)')).includes('Springfield — North, Test Country')); // NEW: use existing city resolution when geographic labels are stored in the city database.
    await run('clusters.setCity("id:1");graph.view.validate();void 0;'); // NEW
    assert.deepEqual(await run('[!!graph.view.getState(a),!!graph.view.getState(c),graph.model.isVisible(c),!!graph.model.getCell("c"),c.collapsed]'), [true, false, true, true, true]); // NEW
    assert.deepEqual(await run('(()=>{const request=ui.downloadRequestBuilder("view.pdf","pdf",true);const doc=mxUtils.parseXml(request.xml);const exported=new mxCodec(doc).decode(doc.documentElement);return [!!exported.getCell("a"),!!exported.getCell("c"),request.from,request.allPages,ui.getFileData().includes(\'id="c"\')];})()'), [true,false,null,null,true]); // NEW
    await run('graph.setSelectionCell(otherLeaf);void 0;'); // NEW
    assert.deepEqual(await run('[clusters.getCity(),clusters.isRendered(c)]'), ['id:2', true]); // NEW
    await run('clusters.setCity("none");void 0;'); // NEW
    assert.deepEqual(await run('[clusters.isRendered(standalone),clusters.isRendered(a)]'), [true, false]); // NEW
    await run('clusters.setCity("id:1");editor.fireEvent(new mxEventObject("fileLoaded"));void 0;'); // NEW
    assert.equal(await run('clusters.getCity()'), 'id:1'); // NEW
    const scans = await run('clusters.snapshot().stats.fullScans'); // NEW
    const builds = await run('clusters.snapshot().stats.topologyBuilds'); // NEW
    await run('write(leaf,{label:"Edited bed"});void 0;'); // NEW
    assert.equal(await run('clusters.snapshot().stats.fullScans'), scans); // NEW
    await run('makeContent(a,"another-bed");void 0;'); // NEW
    assert.equal(await run('clusters.snapshot().stats.topologyBuilds'), builds); // NEW
    await run('graph.setSelectionCell(a);frames()'); // NEW
    await run('document.querySelector(".trellis-garden-dashboard-picker-button").click();frames()'); // NEW
    assert.deepEqual(await run('[!!document.querySelector(".trellis-garden-dashboard-city-select"),document.querySelector(".trellis-garden-dashboard-city-select").nextElementSibling.type,document.querySelectorAll(".trellis-garden-dashboard-picker-row").length]'), [true, 'search', 2]); // NEW
    await run('document.querySelector(".trellis-garden-dashboard-picker-button").click();void 0;'); // NEW
    // Replacing the root exercises page indexes and legacy excess-expansion normalization. // NEW
    await run(` // NEW
        localStorage.setItem('trellis.gardenDashboard.lastGarden.v1:cluster-test:default-page:user:test-user','loaded-3'); // NEW
        const next=new mxCell();const layer=new mxCell();next.insert(layer); // NEW
        for(let i=0;i<4;i++){const cell=new mxCell(value({label:'loaded-'+i,garden_module:1}),new mxGeometry(i*200,0,160,100),'swimlane;module=1;');cell.id='loaded-'+i;cell.vertex=true;layer.insert(cell);} // NEW
        graph.model.setRoot(next);editor.fireEvent(new mxEventObject('fileLoaded'));void 0; // NEW
    `); // NEW
    assert.deepEqual(await run('[clusters.snapshot().clusters,clusters.snapshot().expanded.length,clusters.listGardens().length]'), [4, 2, 4]); // NEW
    assert.equal(await run('graph.model.getCell("loaded-3").collapsed'), false); // NEW
    await run('graph.model.beginUpdate();try{clusters.listGardens().forEach(cell=>write(cell,{city_id:"only",city_name:"Only City"}));}finally{graph.model.endUpdate();}clusters.setCity("none");void 0;'); // NEW
    assert.deepEqual(await run('[clusters.getCity(),clusters.snapshot().rendered.length,clusters.focusForCity()]'), ['none',0,null]); // NEW
    await run('window.previousPageRoot=graph.model.getRoot();ui.currentPage={id:"another-page"};graph.model.rootChanged(new mxGraphModel().getRoot());graph.view.validate();void 0;'); // NEW
    assert.deepEqual(await run('[clusters.snapshot().clusters,clusters.getCity(),graph.view.states.getValues().every(state=>graph.model.getCell(state.cell.id)===state.cell)]'), [0,'all',true]); // NEW
    await run('ui.currentPage=null;graph.model.rootChanged(previousPageRoot);graph.view.validate();void 0;'); // NEW
    assert.deepEqual(await run('[clusters.snapshot().clusters,clusters.getCity()]'), [4,'none']); // NEW: city preferences and states remain local across the native direct-root page path.
    assert.deepEqual(await run('errors'), []); // NEW
    console.log('Cluster behavior, native undo, city filtering, picker and root replacement passed'); // NEW
} // NEW

/** Deterministic summaries keep planting counts realistic without materializing every plant circle. */ // NEW
async function scale(run) { // NEW
    let graphRendering = true; // NEW
    await run(fs.readFileSync(path.join(__dirname, 'module-cluster-fixture.js'), 'utf8')); // NEW
    // Exercise large neighborhoods even in the regular correctness suite. // NEW
    if (!baseline) { // NEW
    graphRendering = await run('graph.view.isRendering()'); // NEW
    await run('graph.view.clear();graph.view.setRendering(false);void 0;'); // NEW: large policy checks need real cell states, while the separately invoked benchmark measures actual paint.
    await run('graph.model.setRoot(makeFixture(1200));clusters.setCity("all");void 0;'); // NEW
    assert.equal(await run('clusters.snapshot().rendered.length'), 1000); // NEW
    await run('graph.foldCells(false,false,[graph.model.getCell("g0"),graph.model.getCell("g1")]);void 0;'); // NEW
    assert.ok(await run('clusters.snapshot().rendered.length<1000')); // NEW
    const before = await run('clusters.snapshot().rendered'); // NEW
    await run('graph.view.setTranslate(10,20);graph.zoomTo(.8);void 0;'); // NEW
    assert.deepEqual(await run('clusters.snapshot().rendered'), before); // NEW
    await run('graph.foldCells(true,false,[graph.model.getCell("g1")]);clusters.setCity("id:0");void 0;'); // NEW
    assert.equal(await run('clusters.snapshot().rendered.length'), 240); // NEW
    await run('clusters.setCity("all");graph.foldCells(false,false,[graph.model.getCell("g1199")]);void 0;'); // NEW
    assert.ok(await run('clusters.isRendered(graph.model.getCell("g0"))&&clusters.isRendered(graph.model.getCell("g1199"))')); // NEW
    const encodedCount = await run('(()=>{const xml=mxUtils.getXml(new mxCodec().encode(graph.model));return (xml.match(/garden_module="1"/g)||[]).length})()'); // NEW
    assert.equal(encodedCount, 1200); // NEW
    await run('graph.model.beginUpdate();try{for(let i=0;i<1199;i++)write(graph.model.getCell("g"+i),{linkedTo:"g"+(i+1)});}finally{graph.model.endUpdate();}void 0;'); // NEW
    assert.deepEqual(await run('[clusters.snapshot().clusters,clusters.snapshot().rendered.length,clusters.getCluster(graph.model.getCell("g0")).gardens.length]'), [1,1,1200]); // NEW: the whole-component policy intentionally allows a large connected group to exceed a fixed module workload.
    console.log('Nearest neighborhoods, overlap, city limits, stable panning and complete saves passed'); // NEW
    await run('graph.view.clear();graph.view.setRendering(' + graphRendering + ');void 0;'); // NEW
    } // NEW
    if (benchmark) { // NEW
        const result = await run('benchmarkFixture(5000,' + !baseline + ',' + (process.argv.includes('--profile') ? 5 : 25) + ')'); // NEW
        result.environment = { timestamp: new Date().toISOString(), platform: process.platform, electron: process.versions.electron, cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, totalMemoryBytes: os.totalmem(), plugins: ['Modules_Standalone', 'Garden_Dashboard', 'Vertex_Linking_Standalone'], softwareRendering: true }; // NEW
        result.rendererMemoryKiB = app.getAppMetrics().filter(metric => metric.type === 'Tab').map(metric => metric.memory); // NEW: retain process working-set evidence alongside JavaScript heap and state counts.
        const directory = path.resolve(__dirname, '../../.test-artifacts/module-clusters'); // NEW
        fs.mkdirSync(directory,{recursive:true}); // NEW
        fs.writeFileSync(path.join(directory,baseline?'baseline.json':'benchmark.json'), JSON.stringify(result,null,2)); // NEW
        console.log('BENCHMARK:',JSON.stringify({...result,snapshot:result.snapshot&&{...result.snapshot,rendered:result.snapshot.rendered.length}})); // NEW
    } // NEW
} // NEW

app.whenReady().then(async()=>{ // NEW
    const win=new BrowserWindow({show:false,width:1400,height:1000,webPreferences:{sandbox:false,backgroundThrottling:false,offscreen:true}}); // NEW: hidden interactive windows throttle animation frames; offscreen rendering provides a measurable frame clock.
    win.webContents.setFrameRate(60); // NEW
    win.webContents.on('console-message',event=>{if(event.level==='error')console.error('Renderer:',event.message);else if(event.message?.startsWith('CLUSTER_STAGE:'))console.log(event.message);}); // NEW
    try { // NEW
        const run=await initialize(win); // NEW
        if(process.argv.includes('--profile')) { win.webContents.debugger.attach('1.3');await win.webContents.debugger.sendCommand('Profiler.enable');await win.webContents.debugger.sendCommand('Profiler.start'); } // NEW
        if(process.argv.includes('--clock')) console.log('CLOCK:',await run('(async()=>{const times=[];for(let i=0;i<5;i++){const t=performance.now();await frames();times.push(performance.now()-t);}return times;})()')); // NEW
        else {if(!baseline)await behavior(run);await scale(run);} // NEW
    } // NEW
    finally { // NEW
        if(process.argv.includes('--profile')) { const {profile}=await win.webContents.debugger.sendCommand('Profiler.stop');const directory=path.resolve(__dirname,'../../.test-artifacts/module-clusters');fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(path.join(directory,baseline?'baseline.cpuprofile':'renderer.cpuprofile'),JSON.stringify(profile)); } // NEW
        win.destroy();if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));} // NEW
    } // NEW
    app.exit(0); // NEW: the isolated graph fixture has released its window, HTTP sockets and profiling output.
}).catch(error=>{console.error(error.stack||error);app.exit(1);}); // NEW

