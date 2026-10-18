const assert = require('node:assert/strict'); // NEW
const fs = require('node:fs'); // NEW
const path = require('node:path'); // NEW
const { app, BrowserWindow } = require('electron'); // NEW
const root = path.resolve(__dirname, '../..'), webapp = path.join(root, 'drawio/src/main/webapp'); // NEW
app.commandLine.appendSwitch('disable-gpu'); app.commandLine.appendSwitch('in-process-gpu'); app.disableHardwareAcceleration(); // NEW
const profile = path.join(app.getPath('temp'), 'trellis-growth-preview-' + process.pid); fs.mkdirSync(profile, { recursive: true }); app.setPath('userData', profile); // NEW

/** Verify real Chromium paint, toolbar clicks, selection, dragging and rotated badge placement. */ // NEW
app.whenReady().then(async () => { // NEW
    const win = new BrowserWindow({ show: false, width: 1200, height: 800, webPreferences: { sandbox: false, backgroundThrottling: false } }); // NEW
    try { // NEW
        await win.loadURL('data:text/html,' + encodeURIComponent('<!doctype html><body style="margin:0;background:#f8fafc"><div id="graph" style="position:relative;width:1180px;height:760px;overflow:auto"></div></body>')); // NEW
        await win.webContents.executeJavaScript('window.mxLoadResources=false;window.mxLoadStylesheets=false;'); // NEW
        await win.webContents.executeJavaScript(fs.readFileSync(path.join(webapp, 'mxgraph/mxClient.js'), 'utf8')); // NEW
        await win.webContents.executeJavaScript(` // NEW
            const NativeDate=Date; window.Date=class extends NativeDate { constructor(...args){super(...(args.length?args:[2026,0,21,12]));} }; // NEW
            window.graph=new mxGraph(document.getElementById('graph')); graph.isSpecialColor=()=>false; // NEW
            graph.convertValueToString=cell=>cell.value?.getAttribute?.('label')||''; // NEW
            window.undoManager=new mxUndoManager(); graph.model.addListener(mxEvent.UNDO,(_,event)=>undoManager.undoableEditHappened(event.getProperty('edit'))); // NEW
            window.ui={editor:{graph,undoManager},actions:{get:()=>null},getCurrentFile:()=>({getId:()=> 'growth-preview'}),hideDialog(){}}; // NEW
            window.Draw={loadPlugin:callback=>callback(ui)}; void 0; // NEW
        `); // NEW
        for (const file of ['Garden_Scheduler_Shared_Core.js', 'Planting_Group.js', 'Garden_Dashboard.js']) await win.webContents.executeJavaScript(fs.readFileSync(path.join(webapp, 'plugins/garden_planner_plugins', file), 'utf8')); // NEW
        const result = await win.webContents.executeJavaScript(` // NEW
            (async()=>{ // NEW
                const xml=attrs=>{const node=mxUtils.createXmlDocument().createElement('object');for(const [key,value] of Object.entries(attrs))node.setAttribute(key,value);return node;}; // NEW
                const garden=graph.insertVertex(null,'garden',xml({garden_module:'1',label:'Growth estimates',current_year:'2026'}),100,115,1000,570,'module=1;fillColor=#eff6e8;strokeColor=#a3b18a;verticalAlign=top;fontSize=16;'); // NEW
                const group=(id,label,x,y,attrs={},angle=0)=>{const cell=graph.insertVertex(garden,id,xml({tiler_group:'1',label,plant_name:label,plant_abbr:'RAD',spacing_cm:'40',veg_diameter_cm:'40',sow_date:'2026-01-01',germ_date:'2026-01-11',harvest_start:'2026-01-31',harvest_end:'2026-02-10',...attrs}),x,y,240,150,'verticalAlign=top;fillColor=none;strokeColor=#9ca3af;rotation='+angle+';');USL.tiler.retileGroup(graph,cell);return cell;}; // NEW
                const growing=group('growing','Growing radishes',60,60), seed=group('seed','Seeds germinating',370,60,{germ_date:'2026-01-26'}); // NEW
                const harvest=group('harvest','Harvest window',680,60,{harvest_start:'2026-01-11',harvest_end:'2026-01-31'}); // NEW
                group('perennial','Establishing perennial',60,295,{perennial:'1',lifespan_start:'2025-12-02',days_maturity:'100'}); // NEW
                const rotated=group('rotated','Rotated planting',400,300,{},25); // NEW
                group('complete','Harvest complete',710,295,{sow_date:'2025-12-01',germ_date:'2025-12-11',harvest_start:'2026-01-01',harvest_end:'2026-01-11'}); // NEW
                graph.setSelectionCell(garden); await new Promise(resolve=>setTimeout(resolve,100)); // NEW
                const growth=graph.__trellisPlantingGroup.growth; growth.refresh(); // NEW
                const checkbox=document.querySelector('[data-trellis-harvest-size]'); if(!checkbox)throw new Error('Harvest-size checkbox did not mount'); // NEW
                const tile=graph.getChildVertices(growing).find(cell=>cell.getAttribute('plant_tiler')==='1'); // NEW
                const ellipses=()=>Array.from(graph.view.getState(tile).shape.node.querySelectorAll('ellipse')).filter(node=>node.getAttribute('visibility')!=='hidden'); // NEW
                const before=mxUtils.getXml(new mxCodec().encode(graph.model));undoManager.clear(); // NEW
                checkbox.click(); await new Promise(resolve=>requestAnimationFrame(resolve));growth.refresh(); const toggled=ellipses().length===2&&growth.getShowHarvestSize(garden); // NEW
                const unchanged=before===mxUtils.getXml(new mxCodec().encode(graph.model))&&undoManager.history.length===0; // NEW
                const initialBlack=ellipses().find(node=>node.getAttribute('stroke')==='#111827'), initialRadius=Number(initialBlack.getAttribute('rx')); // CHANGE
                const dashed=!!ellipses().find(node=>node.getAttribute('stroke')==='#2563eb')?.getAttribute('stroke-dasharray')&&!initialBlack.hasAttribute('stroke-dasharray'); // CHANGE
                checkbox.click();graph.setSelectionCell(growing);growth.refresh(); const groupOff=ellipses().length===1; // CHANGE
                graph.setSelectionCell(tile);growth.refresh(); const selected=ellipses().length===1; // CHANGE: selection cannot override an unchecked checkbox.
                graph.setSelectionCells([tile,seed]);growth.refresh(); const multiOff=[tile,graph.getChildVertices(seed).find(child=>child.getAttribute('plant_tiler')==='1')].every(child=>!graph.view.getState(child).shape.node.querySelector('ellipse[stroke="#2563eb"]')); // CHANGE
                const growthSizePreserved=Number(ellipses()[0].getAttribute('rx'))===initialRadius; // CHANGE
                graph.setSelectionCell(tile);growth.refresh(); // CHANGE: verify dragging a current-growth circle with outlines disabled.
                const centerBefore=Number(ellipses().at(-1).getAttribute('cx'));graph.moveCells([tile],12,5);growth.refresh(); // NEW
                const moved=Math.abs(Number(ellipses().at(-1).getAttribute('cx'))-centerBefore-12)<1; // NEW
                graph.setSelectionCell(garden); await new Promise(resolve=>setTimeout(resolve,100)); checkbox.click();growth.refresh(); // NEW
                const allGroupsOutlined=[growing,seed,harvest,rotated].every(cell=>graph.getChildVertices(cell).filter(child=>child.getAttribute('plant_tiler')==='1').every(child=>graph.view.getState(child).shape.node.querySelector('ellipse[stroke="#2563eb"]')?.hasAttribute('stroke-dasharray'))); // CHANGE
                graph.setSelectionCell(growing);growth.refresh(); const checkedSelection=ellipses().length===2; graph.setSelectionCell(garden);growth.refresh(); // CHANGE
                const badge=document.querySelector('[data-trellis-growth-badge="rotated"]'), box=badge.getBoundingClientRect(), title=graph.view.getState(rotated).text.node.getBoundingClientRect(); // NEW
                const labelChecks=[]; // CHANGE: inspect live glyphs synchronously, before any scheduled growth refresh can mask a flash.
                graph.isHtmlLabel=cell=>String(graph.getCellStyle(cell).html)==='1'; // CHANGE: native style parsing may represent the flag as a number.
                for(const html of [0,1]) { // CHANGE
                    const measure=(name,cell)=>{ // CHANGE
                        const state=graph.view.getState(cell), text=state.text; // CHANGE
                        if((text.dialect===mxConstants.DIALECT_STRICTHTML)!==!!html)throw new Error('Label fixture did not use the requested dialect'); // CHANGE
                        const glyph=text.node.querySelector('text')||Array.from(text.node.querySelectorAll('div')).findLast(node=>!node.childElementCount); // CHANGE
                        const ratio=Math.min(1,Math.max(Math.sqrt(growth.estimate(seed).areaRatio),Math.min(4,state.width)/state.width)); // CHANGE
                        const matrix=glyph.namespaceURI==='http://www.w3.org/2000/svg'?glyph.getScreenCTM():null; // CHANGE: SVG canvas fonts already include canvas scaling; HTML uses the native CSS scale.
                        const expected=Math.max(8,text.size*text.scale*ratio), actual=parseFloat(getComputedStyle(glyph).fontSize)*(matrix?Math.hypot(matrix.a,matrix.b):text.scale); // CHANGE
                        const glyphBounds=glyph.getBoundingClientRect(), circleBounds=state.shape.node.querySelector('ellipse[stroke="#111827"]').getBoundingClientRect(); // CHANGE
                        labelChecks.push({html,name,expected,actual,visible:getComputedStyle(text.node).visibility!=='hidden',centerError:Math.hypot(glyphBounds.x+glyphBounds.width/2-circleBounds.x-circleBounds.width/2,glyphBounds.y+glyphBounds.height/2-circleBounds.y-circleBounds.height/2)}); // CHANGE
                    }; // CHANGE
                    let seedTile=graph.getChildVertices(seed).find(cell=>cell.getAttribute('plant_tiler')==='1'); // CHANGE
                    graph.setCellStyles('html',String(html),[seedTile]); graph.refresh(seed); measure('initial native draw',seedTile); // CHANGE
                    graph.setSelectionCell(seed); measure('selection before animation frame',seedTile); // CHANGE
                    const growingTile=graph.getChildVertices(growing).find(cell=>cell.getAttribute('plant_tiler')==='1'); // CHANGE
                    graph.setCellStyles('html',String(html),[growingTile]); graph.refresh(growing); // CHANGE
                    const growingState=graph.view.getState(growingTile), growingText=growingState.text; // CHANGE
                    const growingGlyph=growingText.node.querySelector('text')||Array.from(growingText.node.querySelectorAll('div')).findLast(node=>!node.childElementCount); // CHANGE
                    const growingMatrix=growingGlyph.namespaceURI==='http://www.w3.org/2000/svg'?growingGlyph.getScreenCTM():null; // CHANGE
                    labelChecks.push({html,name:'proportional growing label',expected:Math.max(8,growingText.size*growingText.scale*Math.sqrt(growth.estimate(growing).areaRatio)),actual:parseFloat(getComputedStyle(growingGlyph).fontSize)*(growingMatrix?Math.hypot(growingMatrix.a,growingMatrix.b):growingText.scale),visible:getComputedStyle(growingText.node).visibility!=='hidden'}); // CHANGE
                    graph.refresh(seed); measure('forced redraw before animation frame',seedTile); // CHANGE
                    const preview=graph.__trellisBedTransforms.createPreview([], [seed]); preview.update(()=>({dx:5})); // CHANGE
                    graph.refresh(seed); // CHANGE: a native redraw during a preview must preserve the original's suppressed visibility.
                    preview.clear(); graph.refresh(seed); measure('preview cleanup',seedTile); // CHANGE
                    USL.tiler.setPlantingGroupDetail(seed,false); USL.tiler.setPlantingGroupDetail(seed,true); // CHANGE
                    seedTile=graph.getChildVertices(seed).find(cell=>cell.getAttribute('plant_tiler')==='1'); // CHANGE
                    graph.setCellStyles('html',String(html),[seedTile]); graph.refresh(seed); measure('LOD expansion before animation frame',seedTile); // CHANGE
                    graph.view.setScale(0.25); measure('minimum font at 25 percent zoom',seedTile); graph.view.setScale(1); // CHANGE
                    const state=graph.view.getState(seedTile), svg=document.createElementNS('http://www.w3.org/2000/svg','svg'); // CHANGE
                    state.text.paint(new mxSvgCanvas2D(svg)); const glyph=svg.querySelector('[font-size]')||Array.from(svg.querySelectorAll('div')).findLast(node=>node.style.fontSize); // CHANGE
                    if(!glyph||Math.abs(parseFloat(glyph.getAttribute('font-size')||glyph.style.fontSize)-state.text.size)>0.01)throw new Error('Export label lost its native font size'); // CHANGE
                } // CHANGE
                graph.setSelectionCell(garden); growth.refresh(); // CHANGE
                const checks={toggled,unchanged,selected,groupOff,multiOff,growthSizePreserved,dashed,checkedSelection,moved,allGroupsOutlined,labelChecks,gardenStyle:garden.style,selectedIds:graph.getSelectionCells().map(cell=>cell.id),checkboxDisabled:checkbox.disabled,checkboxChecked:checkbox.checked,outlineEnabled:growth.getShowHarvestSize(garden),ellipseCount:ellipses().length,badgeCount:document.querySelectorAll('[data-trellis-growth-badge]').length,rotatedBadgeVisible:box.width===30&&box.height===30&&Math.abs((box.top+15)-(title.top+title.height/2))<4}; // CHANGE
                return checks; // NEW
            })(); // NEW
        `); // NEW
        for (const key of ['toggled', 'unchanged', 'selected', 'groupOff', 'multiOff', 'growthSizePreserved', 'dashed', 'checkedSelection', 'moved', 'allGroupsOutlined', 'rotatedBadgeVisible']) assert.equal(result[key], true, JSON.stringify(result)); // CHANGE
        assert.equal(result.badgeCount, 6); // NEW
        for (const check of result.labelChecks) { assert.equal(check.visible, true, JSON.stringify(check)); assert.ok(Math.abs(check.actual-check.expected)<0.1, JSON.stringify(check)); if (check.centerError != null) assert.ok(check.centerError<2, JSON.stringify(check)); } // CHANGE: both dialects render centered text at the 8 px minimum before growth.refresh().
        assert.equal(result.checkboxDisabled, false); assert.equal(result.checkboxChecked, true); assert.equal(result.outlineEnabled, true); // NEW
        await win.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 150))))'); // NEW: let Chromium composite the final checkbox and outline frame before capture.
        const screenshot = await win.webContents.capturePage(); // NEW
        fs.mkdirSync(path.join(root, 'test-results'), { recursive: true }); fs.writeFileSync(path.join(root, 'test-results/plant-growth-verified.png'), screenshot.toPNG()); // NEW
        process.stdout.write('GROWTH_RESULT:' + JSON.stringify(result) + '\n'); // NEW
    } finally { win.destroy(); } // NEW
    app.quit(); // NEW
}).catch(error => { process.stderr.write(error.stack + '\n'); app.exit(1); }); // NEW
