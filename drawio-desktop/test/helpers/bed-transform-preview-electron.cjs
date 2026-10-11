const assert = require('node:assert/strict'); // CHANGE
const fs = require('node:fs'); // CHANGE
const path = require('node:path'); // CHANGE
const { app, BrowserWindow } = require('electron'); // CHANGE
const root = process.env.TRELLIS_PREVIEW_ROOT || path.resolve(__dirname, '../..'); // CHANGE
const work = process.env.TRELLIS_BED_PREVIEW_OUTPUT || path.join(require('node:os').tmpdir(), 'trellis-bed-preview-' + process.pid); fs.mkdirSync(work, { recursive: true }); // CHANGE
app.commandLine.appendSwitch('disable-gpu'); app.disableHardwareAcceleration(); app.commandLine.appendSwitch('in-process-gpu'); // CHANGE: use the existing renderer tests' software-rendering setup on restricted Windows hosts.
const profile = path.join(work, 'bed-transform-electron-profile'); fs.mkdirSync(profile, { recursive: true }); app.setPath('userData', profile); // CHANGE

/** Render production plugins in Chromium, checking circle omission and upright labels alongside preview bounds. */ // CHANGE
app.whenReady().then(async () => { // CHANGE
    const win = new BrowserWindow({ show: false, width: 1100, height: 800, webPreferences: { sandbox: false, backgroundThrottling: false } }); // CHANGE
    try { // CHANGE
        await win.loadURL('data:text/html,' + encodeURIComponent('<!doctype html><body style="margin:0;background:#fafbf8"><div id="graph" style="position:relative;width:1080px;height:780px;overflow:auto"></div></body>')); // CHANGE
        await win.webContents.executeJavaScript('window.mxLoadResources=false;window.mxLoadStylesheets=false;'); // CHANGE
        const webapp = path.join(root, 'drawio/src/main/webapp'); // CHANGE
        await win.webContents.executeJavaScript(fs.readFileSync(path.join(webapp, 'mxgraph/mxClient.js'), 'utf8')); // CHANGE
        await win.webContents.executeJavaScript(` // CHANGE
            window.graph = new mxGraph(document.getElementById('graph')); // CHANGE
            graph.setHtmlLabels(true); graph.setExtendParents(false); graph.setConstrainChildren(false); // CHANGE
            graph.isSpecialColor=()=>false; graph.getCompositeParent=cell=>cell; // CHANGE
            graph.convertValueToString=cell=>cell.value && cell.value.getAttribute ? cell.value.getAttribute('label') || '' : String(cell.value || ''); // CHANGE
            window.undoManager = new mxUndoManager(); graph.model.addListener(mxEvent.UNDO,(_,e)=>undoManager.undoableEditHappened(e.getProperty('edit'))); // CHANGE
            window.Draw={loadPlugin:callback=>callback({editor:{graph,undoManager},actions:{get:()=>null,addAction:()=>({})},hideDialog(){},handleError(error){throw error;}})}; // CHANGE
            void 0; // CHANGE
        `); // CHANGE
        for (const plugin of ['Planting_Group.js', 'Bed_Succession_Navigator.js', 'Deep_Click_Through.js', 'Garden_Irrigation_Planner.js']) { // CHANGE
            await win.webContents.executeJavaScript(fs.readFileSync(path.join(webapp, 'plugins/garden_planner_plugins', plugin), 'utf8')); // CHANGE
        } // CHANGE
        await win.webContents.executeJavaScript(` // CHANGE
            const value=attrs=>{const node=mxUtils.createXmlDocument().createElement('object');for(const [key,val]of Object.entries(attrs))node.setAttribute(key,val);return node;}; // CHANGE
            window.garden=graph.insertVertex(null,'garden',value({garden_module:'1',label:'Garden'}),60,50,1100,900,'fillColor=#f6f7ef;strokeColor=none;'); // CHANGE
            window.bed=graph.insertVertex(garden,'bed',value({garden_bed:'1',label:'Bed'}),180,180,420,300,'fillColor=#dde5b5;strokeColor=#687c43;rotation=0;'); // CHANGE
            window.group=graph.insertVertex(garden,'crop',value({tiler_group:'1',bed_auto_fit:'0',label:'Carrots',plant_abbr:'CAR',plant_count_actual:'3'}),215,245,170,130,'fillColor=#f3efe0;strokeColor=#8d7e58;rotation=0;locked=1;'); // CHANGE
            window.plants=[];for(let i=0;i<3;i++)plants.push(graph.insertVertex(group,'plant'+i,value({plant_tiler:'1',auto:i===1?'1':'0',dirty:i===1?'0':'1',label:'C'}),20+i*45,65,24,24,'shape=ellipse;fillColor=#f49a34;strokeColor=#bd6427;rotation='+ (i===0?15:0) +';html='+(i===1?1:0)+';')); // CHANGE: cover generated/manual circles and SVG/HTML labels, including an old tilted label.
            window.assembly=graph.insertVertex(garden,'irrigation',value({irrigation_assembly:'1',irrigation_assembly_type:'bed',label:'Irrigation'}),425,330,100,80,'fillColor=#d8e8f3;strokeColor=#40729b;rotation=0;locked=1;'); // CHANGE
            window.part=graph.insertVertex(assembly,'part',value({irrigation_part:'1',label:'Pipe'}),10,30,70,12,'fillColor=#5999c4;strokeColor=#296388;rotation=0;'); // CHANGE
            window.hidden=graph.insertVertex(garden,'future',value({tiler_group:'1',bed_auto_fit:'0',label:'Future crop'}),350,210,60,50); // CHANGE
            graph.model.setVisible(hidden,false);graph.view.validate();undoManager.clear(); // CHANGE
            window.snapshot=()=>mxUtils.getXml(new mxCodec().encode(graph.model)); // CHANGE
            window.rect=node=>{const b=node.getBoundingClientRect();return {x:b.x,y:b.y,width:b.width,height:b.height};}; // CHANGE
            window.waitFrame=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))); // CHANGE
            void 0; // CHANGE
        `); // CHANGE
        const checks = []; // CHANGE
        for (const scale of [0.75, 1.2]) { // CHANGE
            const before = await win.webContents.executeJavaScript(`graph.view.setScale(${scale});graph.view.setTranslate(20,10);graph.setSelectionCell(bed);snapshot();`); // CHANGE
            const originalCenters = await win.webContents.executeJavaScript(`[bed,...plants].map(cell=>{const s=graph.view.getState(cell);return {x:s.getCenterX(),y:s.getCenterY(),visibility:[s.shape.node.style.visibility,s.text.node.style.visibility]};});`); // CHANGE: verify omitted circles still receive the complete committed transform.
            await win.webContents.executeJavaScript(` // CHANGE
                window.preview=graph.__trellisBedTransforms.createPreview([bed]);preview.update(()=>({delta:37}));waitFrame(); // CHANGE
            `); // CHANGE
            const previewBounds = await win.webContents.executeJavaScript(` // CHANGE
                ['crop','irrigation','part'].map(id=>rect(document.querySelector('[data-trellis-bed-preview-cell="'+id+'"][data-trellis-bed-preview-kind="shape"]'))); // CHANGE: circle renderers are deliberately absent from the preview.
            `); // CHANGE
            const circlePreview = await win.webContents.executeJavaScript(`plants.map(cell=>({copies:document.querySelectorAll('[data-trellis-bed-preview-cell="'+cell.id+'"]').length,visibility:[graph.view.getState(cell).shape.node.style.visibility,graph.view.getState(cell).text.node.style.visibility]}));`); // CHANGE
            for (const circle of circlePreview) { assert.equal(circle.copies, 0); assert.deepEqual(circle.visibility, ['hidden', 'hidden']); } // CHANGE
            await win.webContents.capturePage(); await new Promise(resolve => setTimeout(resolve, 300)); // CHANGE: refresh the hidden window's compositor before saving visual evidence.
            const shot = await win.webContents.capturePage(); fs.writeFileSync(path.join(work, 'bed-preview-' + scale + '.png'), shot.toPNG()); // CHANGE
            assert.equal(await win.webContents.executeJavaScript('snapshot()'), before, 'preview writes no model changes'); // CHANGE
            await win.webContents.executeJavaScript(`preview.clear();graph.setCellStyles('rotation','37',[bed]);waitFrame();`); // CHANGE
            const committedBounds = await win.webContents.executeJavaScript(`['crop','irrigation','part'].map(id=>rect(graph.view.getState(graph.model.getCell(id)).shape.node));`); // CHANGE
            const committedCircles = await win.webContents.executeJavaScript(`plants.map(cell=>{const s=graph.view.getState(cell);return {x:s.getCenterX(),y:s.getCenterY(),rotation:Number(s.style.rotation||0),visibility:[s.shape.node.style.visibility,s.text.node.style.visibility]};});`); // CHANGE
            committedCircles.forEach((circle,index)=>{ // CHANGE
                const pivot=originalCenters[0], original=originalCenters[index+1], radians=37*Math.PI/180, dx=original.x-pivot.x, dy=original.y-pivot.y; // CHANGE
                assert.ok(Math.abs(circle.x-(pivot.x+dx*Math.cos(radians)-dy*Math.sin(radians)))<0.01); // CHANGE
                assert.ok(Math.abs(circle.y-(pivot.y+dx*Math.sin(radians)+dy*Math.cos(radians)))<0.01); // CHANGE
                assert.equal(circle.rotation,0); assert.deepEqual(circle.visibility,original.visibility); // CHANGE
            }); // CHANGE
            for (let i = 0; i < previewBounds.length; i++) for (const axis of ['x','y','width','height']) { // CHANGE
                assert.ok(Math.abs(previewBounds[i][axis] - committedBounds[i][axis]) < 3, `scale ${scale} member ${i} ${axis}: preview ${previewBounds[i][axis]}, commit ${committedBounds[i][axis]}`); // CHANGE
            } // CHANGE
            await win.webContents.capturePage(); await new Promise(resolve => setTimeout(resolve, 300)); // CHANGE: capture the committed circles rather than a stale preview frame.
            const committed = await win.webContents.capturePage(); fs.writeFileSync(path.join(work, 'bed-commit-' + scale + '.png'), committed.toPNG()); // CHANGE
            await win.webContents.executeJavaScript('undoManager.undo();waitFrame();'); // CHANGE
            assert.equal(await win.webContents.executeJavaScript('snapshot()'), before, 'one undo restores diagram'); // CHANGE
            checks.push({ scale, previewBounds, committedBounds, circlePreview, committedCircles }); // CHANGE
        } // CHANGE
        const drag = await win.webContents.executeJavaScript(` // CHANGE
            (async()=>{ // CHANGE
                graph.setSelectionCell(bed);undoManager.clear();const before=bed.geometry.x, childBefore=hidden.geometry.x; // CHANGE
                const circleVisibility=plants.map(cell=>{const s=graph.view.getState(cell);return [s.shape.node.style.visibility,s.text.node.style.visibility];}); // CHANGE
                const handler=graph.graphHandler;handler.start(bed,350,350,[bed]);handler.currentDx=48;handler.currentDy=24; // CHANGE
                handler.livePreviewUsed=true;handler.livePreviewActive=true;handler.updatePreview();await waitFrame(); // CHANGE
                const circlesHidden=plants.every(cell=>{const s=graph.view.getState(cell);return s.shape.node.style.visibility==='hidden'&&s.text.node.style.visibility==='hidden'&&!document.querySelector('[data-trellis-bed-preview-cell="'+cell.id+'"]');}); // CHANGE
                const hasMarker=!!handler.shape;const me=new mxMouseEvent(new MouseEvent('mouseup',{clientX:398,clientY:374}),graph.view.getState(bed));me.graphX=398;me.graphY=374; // CHANGE
                handler.mouseUp(graph,me);await waitFrame(); // CHANGE
                const circlesRestored=plants.every((cell,index)=>{const s=graph.view.getState(cell);return s.shape.node.style.visibility===circleVisibility[index][0]&&s.text.node.style.visibility===circleVisibility[index][1];}); // CHANGE
                return {hasMarker,circlesHidden,circlesRestored,bedDelta:bed.geometry.x-before,hiddenDelta:hidden.geometry.x-childBefore,remaining:document.querySelectorAll('[data-trellis-bed-transform-preview]').length,undos:undoManager.history.length}; // CHANGE
            })(); // CHANGE
        `); // CHANGE
        assert.equal(drag.hasMarker, true); assert.equal(drag.remaining, 0); assert.equal(drag.undos, 1); assert.ok(drag.bedDelta > 0); assert.equal(drag.hiddenDelta, drag.bedDelta); // CHANGE
        assert.equal(drag.circlesHidden,true); assert.equal(drag.circlesRestored,true); // CHANGE
        fs.writeFileSync(path.join(work, 'bed-transform-visual-result.json'), JSON.stringify({ ok: true, checks, drag }, null, 2)); // CHANGE
        console.log('Chromium preview/commit and drag checks passed.'); // CHANGE
    } catch (error) { fs.writeFileSync(path.join(work, 'bed-transform-visual-error.txt'), error.stack); console.error(error); process.exitCode = 1; } // CHANGE
    finally { win.destroy(); app.quit(); } // CHANGE
}); // CHANGE
