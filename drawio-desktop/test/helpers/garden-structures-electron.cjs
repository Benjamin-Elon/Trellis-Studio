const assert = require('node:assert/strict'); // NEW
const fs = require('node:fs'); // NEW
const os = require('node:os'); // NEW
const path = require('node:path'); // NEW
const { app, BrowserWindow } = require('electron'); // NEW
const { PDFDocument, rgb } = require('@cantoo/pdf-lib'); // NEW
const { runtimeScripts, historyScripts, editorFocusSource, read } = require('./garden-structures-harness.cjs'); // CHANGE
app.commandLine.appendSwitch('disable-gpu'); app.commandLine.appendSwitch('in-process-gpu'); app.disableHardwareAcceleration(); // NEW
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'trellis-structures-electron-'))); // NEW

/** Real pointer events exercise native custom handles, dialogs, draft preservation, SVG, and PDF output. */ // NEW
app.whenReady().then(async () => { // NEW
    const win = new BrowserWindow({ show: false, width: 1200, height: 900, webPreferences: { sandbox: false, backgroundThrottling: false } }); // NEW
    try { // NEW
        await win.loadURL('data:text/html,' + encodeURIComponent('<!doctype html><body style="margin:0"><div id="graph" style="position:absolute;left:20px;top:20px;width:1150px;height:840px;overflow:auto"></div></body>')); // NEW
        const run = async code => { // NEW
            let timeout; // NEW
            try { return await Promise.race([win.webContents.executeJavaScript(code), new Promise((_resolve, reject) => { timeout = setTimeout(() => reject(new Error('Renderer timed out: ' + code.slice(0, 180))), 10000); })]); } finally { clearTimeout(timeout); } // NEW
        }; // NEW
        await run('window.mxLoadResources=false;window.mxLoadStylesheets=false;'); // NEW
        await run(read('mxgraph/mxClient.js') + '\nvoid 0;'); for (const script of runtimeScripts()) await run(script + '\nvoid 0;'); // NEW
        for (const script of historyScripts()) await run(script + '\nvoid 0;'); // NEW
        await run(` // NEW
            window.graph=new mxGraph(document.getElementById('graph')); graph.isSpecialColor=()=>false;graph.getCompositeParent=cell=>cell;
            graph.graphHandler.isPropagateSelectionCell=()=>false;graph.container.tabIndex=0;
            graph.convertValueToString=cell=>cell.getAttribute?.('label')||'';
            window.undoManager=new mxUndoManager();graph.model.addListener(mxEvent.UNDO,(_sender,event)=>undoManager.undoableEditHappened(event.getProperty('edit')));
            window.ui=installStructureHistoryUi(graph,undoManager);window.Draw={loadPlugin:fn=>fn(ui)};
            (function(graph,ui){${editorFocusSource()}})(graph,ui);
            Trellis.ui.installOverlayVisibility(graph);window.frames=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
            window.value=attrs=>{const n=mxUtils.createXmlDocument().createElement('object');Object.entries(attrs).forEach(([k,v])=>n.setAttribute(k,v));return n};void 0;
        `); // NEW
        await run('window.keys=ui.createKeyHandler(ui.editor);void 0;'); // NEW
        for (const name of ['Planting_Group.js', 'Garden_Scale.js', 'Garden_Structures.js']) await run(read('plugins/garden_planner_plugins/' + name)); // NEW
        await run(`window.garden=graph.insertVertex(null,'garden',value({garden_module:'1',label:'Garden'}),30,30,1050,750,'module=1;');graph.setSelectionCell(garden);frames()`); // NEW
        assert.equal(await run(`[...document.querySelectorAll('button')].some(b=>b.textContent==='Add Structure'&&!b.disabled)`), true, await run('JSON.stringify({buttons:[...document.querySelectorAll("button")].map(b=>[b.textContent,b.disabled]),overlay:graph.__plantTilerGardenModuleOverlayInstalled,selection:graph.getSelectionCell()?.id})')); // NEW
        await run(`[...document.querySelectorAll('button')].find(b=>b.textContent==='Add Structure').click();window.cell=graph.getSelectionCell();window.api=graph.__trellisStructures;frames()`); // NEW
        assert.equal(await run(`cell.getAttribute('garden_structure')`), '1'); // NEW
        const position = selector => run(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return{x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}})()`); // CHANGE
        const mouse = (type, point) => win.webContents.sendInputEvent({ type, ...point, button: 'left', clickCount: 1 }); // CHANGE
        const key = (keyCode, modifiers = []) => { win.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers }); }; // NEW
        const clickAt = async point => { mouse('mouseDown', point); mouse('mouseUp', point); await run('frames()'); }; // NEW
        const panelVisible = () => run('getComputedStyle(document.querySelector(".trellis-structure-overlay")).display===\'flex\''); // NEW
        const nameSelector = '[aria-label="Structure name"]'; // NEW
        win.webContents.focus(); assert.equal(await run('document.hasFocus()'), true); // NEW: hidden windows need native web focus for real focus/blur delivery.
        await clickAt(await position(nameSelector)); key('A', ['control']); await run('frames()'); await win.webContents.insertText('Tool shed'); await run('frames()'); // CHANGE
        assert.deepEqual(await run('({focus:document.activeElement.matches(\'[aria-label="Structure name"]\'),value:document.activeElement.value})'), { focus: true, value: 'Tool shed' }); // NEW
        key('Home'); key('Right'); key('Right'); key('Delete'); key('Backspace'); await run('frames()'); // NEW
        assert.deepEqual(await run('({value:document.activeElement.value,caret:document.activeElement.selectionStart})'), { value: 'Tl shed', caret: 1 }); // NEW
        await run('graph.view.setTranslate(5,8);frames()'); assert.equal(await run('document.activeElement.matches(\'[aria-label="Structure name"]\')'), true); // NEW
        key('A', ['control']); await run('frames()'); assert.equal(await run('document.activeElement.selectionEnd-document.activeElement.selectionStart'), 7); // NEW
        await win.webContents.insertText('Tool shed'); key('Return'); await run('frames()'); assert.equal(await run('cell.getAttribute("label")'), 'Tool shed'); // CHANGE
        await clickAt(await position(nameSelector)); key('A', ['control']); await run('frames()'); await win.webContents.insertText('Discard name'); key('Escape'); await run('frames()'); // CHANGE
        assert.equal(await run('document.activeElement.value'), 'Tool shed'); assert.equal(await panelVisible(), true); // CHANGE
        key('A', ['control']); await run('frames()'); await win.webContents.insertText('Garden shed'); // CHANGE
        const cellCenter = await run('(()=>{const s=graph.view.getState(cell),r=graph.container.getBoundingClientRect();return{x:Math.round(r.left+s.x+s.width/2),y:Math.round(r.top+s.y+s.height/2)}})()'); // NEW
        await clickAt(cellCenter); assert.equal(await run('cell.getAttribute("label")'), 'Garden shed'); assert.equal(await panelVisible(), false); // NEW
        await clickAt(cellCenter); assert.equal(await panelVisible(), true); // NEW
        await run('graph.clearSelection();frames()'); await clickAt(cellCenter); assert.equal(await panelVisible(), true); // NEW: the first click selects without dismissal.
        await clickAt(cellCenter); assert.equal(await panelVisible(), false); await run('graph.refresh(cell);frames()'); assert.equal(await panelVisible(), false); // NEW
        await clickAt(cellCenter); assert.equal(await panelVisible(), true); // NEW
        await run('api.editFootprint(cell)'); await run('frames()'); // NEW
        await clickAt(cellCenter); assert.equal(await panelVisible(), true); // NEW: footprint Done/Cancel cannot be toggled away.
        const originalPoints = await run('JSON.stringify(api.getDraft().points)'); // NEW
        const original = await run('mxUtils.getXml(new mxCodec().encode(graph.getModel()))'); // NEW
        const handles = await run('document.querySelectorAll("[data-structure-handle]").length'); assert.equal(handles, 8); // NEW
        const drag = async (selector, dx, dy) => { const p = await position(selector); mouse('mouseDown', p); mouse('mouseMove', { x: p.x + dx, y: p.y + dy }); await run('frames()'); mouse('mouseUp', { x: p.x + dx, y: p.y + dy }); await run('frames()'); }; // NEW
        await drag('[data-structure-handle="corner-0"]', 30, 20); // NEW
        assert.notEqual(await run('JSON.stringify(api.getDraft().points)'), originalPoints); // NEW
        assert.equal(await run('mxUtils.getXml(new mxCodec().encode(graph.getModel()))'), original); // NEW
        assert.equal(await run(`!!api.getDraft() && !document.querySelector('.trellis-structure-overlay').querySelector('button').disabled`), true); // NEW
        await drag('[data-structure-handle="edge-1"]', -40, 0); assert.equal(await run('api.getDraft().points.length'), 5); // NEW
        const corner = await position('[data-structure-handle="corner-2"]'); mouse('mouseDown', corner); mouse('mouseUp', corner); await run('frames()'); // NEW
        win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Delete' }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Delete' }); await run('frames()'); // NEW
        assert.equal(await run('api.getDraft().points.length'), 4); assert.equal(await run('graph.getModel().contains(cell)'), true); // NEW
        await drag('[data-structure-handle="edge-1"]', -30, 0); assert.equal(await run('api.getDraft().points.length'), 5); // NEW
        await run('document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}));void 0;'); // NEW
        assert.equal(await run('!!document.querySelector(".trellis-structure-discard")'), true); // NEW
        await run(`[...document.querySelectorAll('.trellis-structure-discard button')].find(b=>b.textContent==='Keep Editing').click();frames()`); assert.equal(await run('api.getDraft().points.length'), 5); // NEW
        await run(`window.panel=document.querySelector('.trellis-structure-overlay');window.before=api.getDraft().points;graph.__trellisOverlayVisibility.begin('test');void 0;`); // NEW
        assert.equal(await run('getComputedStyle(panel).display'), 'none'); // NEW
        await run(`graph.__trellisOverlayVisibility.end('test');graph.view.setScale(.9);frames()`); assert.equal(await run('getComputedStyle(panel).display'), 'flex'); // NEW
        assert.equal(await run('JSON.stringify(before)===JSON.stringify(api.getDraft().points)'), true); // NEW
        assert.equal(await run('api.done()'), true); await run('frames()'); assert.equal(await run('api.getDraft()'), null); // NEW
        assert.equal(await run('JSON.parse(cell.getAttribute("structure_footprint_json")).points.length'), 5); // NEW
        assert.equal(await run('!!graph.view.getState(cell).shape.stencil'), true); // NEW
        await run('window.historyIndex=undoManager.indexOfNextAdd;window.savedFootprint=cell.getAttribute("structure_footprint_json");api.editFootprint(cell)'); // NEW
        key('Z', ['control']); await run('frames()'); assert.equal(await run('api.getDraft()'), null); assert.equal(await run('undoManager.indexOfNextAdd'), await run('historyIndex')); // NEW
        key('Z', ['control']); await run('frames()'); assert.equal(await run('undoManager.indexOfNextAdd'), await run('historyIndex-1')); // NEW
        await run('api.editFootprint(cell)'); key('Y', ['control']); await run('frames()'); assert.equal(await run('api.getDraft()'), null); // NEW
        key('Y', ['control']); await run('frames()'); assert.equal(await run('cell.getAttribute("structure_footprint_json")===savedFootprint'), true); // NEW
        await run('api.editFootprint(cell);'); await run('const p=api.getDraft().points[0];api.moveCorner(0,[p[0]+10,p[1]+10]);graph.container.focus();void 0;'); // NEW
        key('Z', ['control']); await run('frames()'); assert.equal(await run('!!document.querySelector(".trellis-structure-discard")'), true); // NEW
        await run('undoManager.redo();ui.actions.get("undo").funct();void 0;'); assert.equal(await run('document.querySelectorAll(".trellis-structure-discard").length'), 1); // NEW
        await clickAt(await position('.trellis-structure-discard button')); assert.equal(await run('!!api.getDraft()'), true); // NEW
        await run('graph.container.focus();void 0;'); key('Y', ['control']); await run('frames()'); // NEW
        await clickAt(await position('.trellis-structure-discard button:last-child')); assert.equal(await run('api.getDraft()'), null); assert.equal(await run('undoManager.indexOfNextAdd'), await run('historyIndex')); // NEW
        const paths = await run(`(()=>{const doc=mxUtils.createXmlDocument(),svg=doc.createElementNS(mxConstants.NS_SVG,'svg');doc.appendChild(svg);new mxImageExport().drawState(graph.view.getState(cell),new mxSvgCanvas2D(svg));return [...svg.querySelectorAll('path')].map(p=>p.getAttribute('d'))})()`); // NEW
        assert.ok(paths.some(d => /Z/i.test(d))); // NEW
        const projection = await PDFDocument.create(), page = projection.addPage([1200, 900]); for (const d of paths) page.drawSvgPath(d, { x: 0, y: 900, borderColor: rgb(.28, .33, .41), borderWidth: 2 }); // NEW
        const pdf = await projection.save(); assert.equal((await PDFDocument.load(pdf)).getPageCount(), 1); // NEW
        if (process.argv.includes('--native-pdf')) { const nativePdf = await win.webContents.printToPDF({ printBackground: true }); assert.equal(nativePdf.subarray(0, 5).toString(), '%PDF-'); } // NEW: independent host printing service is opt-in, matching existing projection tests.
        console.log('Chromium structures: native focus/typing, click toggles, guarded Undo/Redo, corner/midpoint drags, overlay restoration and SVG/PDF projections passed'); // CHANGE
    } finally { win.destroy(); } // NEW
    app.quit(); // NEW
}).catch(error => { console.error(error.stack || error); app.exit(1); }); // NEW
