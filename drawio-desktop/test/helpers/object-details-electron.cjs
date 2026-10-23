/** Real input, menus, selection and rendering with production Graph, Actions, Menus and Toolbar definitions. */ // NEW
const assert = require('node:assert/strict'); // NEW
const fs = require('node:fs'); // NEW
const path = require('node:path'); // NEW
const { pathToFileURL } = require('node:url'); // NEW
const { app, BrowserWindow, session } = require('electron'); // NEW
const { PDFDocument } = require('@cantoo/pdf-lib'); // NEW
const { parse } = require('@babel/parser'), traverse = require('@babel/traverse').default; // NEW
const project = path.resolve(__dirname, '../..'), webapp = path.join(project, 'drawio/src/main/webapp'); // NEW
const output = path.join(project, '.test-artifacts/object-details', String(process.pid)); // NEW
app.disableHardwareAcceleration(); app.commandLine.appendSwitch('in-process-gpu'); // NEW
app.setPath('userData', fs.mkdtempSync(path.join(app.getPath('temp'), 'trellis-details-'))); // NEW
const delay = ms => new Promise(resolve => setTimeout(resolve, ms)); // NEW
let stage = 'startup'; const watchdog = setTimeout(() => { console.error('Object details smoke stalled at ' + stage); app.exit(1); }, 90000); // CHANGE: include real ResizeObserver delivery across the added manipulation scenarios.
app.once('will-quit', () => clearTimeout(watchdog)); // NEW

/** Exercise hidden ancestor layout with the real details observer, not a generic input panel. */ // NEW
async function verifyManipulationSizing(win, evaluate, until) { // NEW
    await evaluate(fs.readFileSync(path.join(webapp, 'plugins/garden_planner_plugins/Deep_Click_Through.js'), 'utf8') + '\n;void 0;'); // NEW
    await evaluate(` // NEW
        window.editable=true;window.user='alice';graph.stopEditing(true);graph.view.setScale(1);graph.view.setTranslate(0,0);graph.panGraph(0,0); // NEW
        graph.container.scrollLeft=0;graph.container.scrollTop=0; // NEW
        const value=mxUtils.createXmlDocument().createElement('object');value.setAttribute('label','Sizing regression');value.setAttribute('trellis_details_html','<p>Preserve extra-info content</p>'); // NEW
        window.sizing=graph.insertVertex(null,'details-sizing',value,120,240,160,90,'html=1;whiteSpace=wrap;'); // NEW
        graph.setSelectionCell(sizing);graph.__trellisObjectDetails.refresh(); // NEW
        window.sizePanel=document.querySelector('[data-collaboration-object-id="details-sizing"]');window.sizeField=sizePanel.querySelector('.trellis-object-details-editor'); // NEW
        sizePanel.querySelector('[data-side=right]').click(); // NEW
        window.sizeFrames=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))); // NEW
        window.sizeKey=Object.keys(localStorage).find(key=>key.startsWith('trellis.details.view.v1:')&&key.includes('details-sizing')); // NEW
        window.sizeState=()=>({width:sizePanel.offsetWidth,height:sizePanel.offsetHeight,saved:localStorage.getItem(sizeKey),side:sizePanel.querySelector('[aria-pressed=true]').dataset.side,html:sizeField.innerHTML,same:sizePanel.querySelector('.trellis-object-details-editor')===sizeField}); // NEW
        window.sizeMouse=(x,y)=>{const r=graph.container.getBoundingClientRect();return graph.updateMouseEvent(new mxMouseEvent(new MouseEvent('mousemove',{clientX:r.left+x,clientY:r.top+y,button:0}),graph.view.getState(sizing)));}; // NEW
        void 0; // NEW
    `); // NEW
    await evaluate('sizeFrames()'); // NEW: settle selection-driven positioning before simulating the user's initial resize.
    await evaluate('sizePanel.style.width="360px";sizePanel.style.height="220px";void 0;'); // NEW
    await until('JSON.parse(localStorage.getItem(sizeKey)).width===360&&JSON.parse(localStorage.getItem(sizeKey)).height===220', 'sizing regression baseline'); // NEW
    const expected = await evaluate('sizeState()'); // NEW
    await evaluate(`window.sizeWrites=[];window.sizeSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key===sizeKey)sizeWrites.push(value);return sizeSetItem.call(this,key,value);};void 0;`); // NEW
    async function checkGesture(label, begin, end) { // NEW
        stage = 'extra-info size: ' + label; await begin(); // NEW
        await until('graph.__trellisOverlayVisibility.isSuppressed()', label + ' suppression'); await evaluate('sizeFrames()'); // NEW
        assert.equal(await evaluate('sizePanel.offsetWidth'), 0, label + ' actually hides the panel'); // NEW
        assert.equal(await evaluate('localStorage.getItem(sizeKey)'), expected.saved, label + ' must not persist zero-sized layout'); // NEW
        await end(); await evaluate('sizeFrames()'); // NEW
        assert.equal(await evaluate('graph.__trellisOverlayVisibility.isSuppressed()'), false, label); // NEW
        assert.deepEqual(await evaluate('sizeState()'), expected, label + ' preserves dimensions, side, content and editor identity'); // NEW
        assert.equal(await evaluate('sizeWrites.length'), 0, label + ' does not rewrite size preferences'); // NEW
    } // NEW
    const run = source => () => evaluate(source + ';void 0;'); // NEW
    const origin = await evaluate('(()=>{const s=graph.view.getState(sizing),r=graph.container.getBoundingClientRect();return {x:Math.round(r.left+s.x+40),y:Math.round(r.top+s.y+35)}})()'); // NEW
    await checkGesture('native move', async () => { // NEW
        win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...origin }); // NEW
        win.webContents.sendInputEvent({ type: 'mouseMove', x: origin.x + 45, y: origin.y + 25 }); // NEW
    }, async () => { win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, x: origin.x + 45, y: origin.y + 25 }); }); // NEW
    const handleBegin = `const r=graph.container.getBoundingClientRect(),s=graph.view.getState(sizing);window.sizeHandleStart={x:r.left+s.x+20,y:r.top+s.y+20};graph.__trellisWorkspaceDragPolicy.beginHandleDragForTests(sizing,new MouseEvent('mousedown',{clientX:sizeHandleStart.x,clientY:sizeHandleStart.y,button:0}));document.dispatchEvent(new PointerEvent(mxClient.IS_POINTER?'pointermove':'mousemove',{clientX:sizeHandleStart.x+40,clientY:sizeHandleStart.y+30,pointerType:'mouse',bubbles:true}));`; // NEW
    await checkGesture('handle move', run(handleBegin), run(`document.dispatchEvent(new PointerEvent(mxClient.IS_POINTER?'pointerup':'mouseup',{clientX:sizeHandleStart.x+40,clientY:sizeHandleStart.y+30,pointerType:'mouse',bubbles:true}));`)); // NEW
    for (const rotation of [false, true]) { // NEW
        const begin = `const s=graph.view.getState(sizing);window.sizeVertex=new mxVertexHandler(s);sizeVertex.rotationEnabled=true;sizeVertex.start(s.x+s.width,s.y+s.height,${rotation ? 'mxEvent.ROTATION_HANDLE' : '7'});sizeVertex.mouseMove(graph,sizeMouse(s.x+s.width+30,s.y+s.height+25));`; // NEW
        await checkGesture(rotation ? 'rotation' : 'resize', run(begin), run('const s=graph.view.getState(sizing);sizeVertex.mouseUp(graph,sizeMouse(s.x+s.width+30,s.y+s.height+25));sizeVertex.destroy()')); // NEW
    } // NEW
    const libraryBegin = `window.sizeSource=new mxDragSource(document.getElementById('normal-toolbar'),()=>{});sizeSource.createPreviewElement=()=>document.createElement('div');sizeSource.dragEnter(graph,new MouseEvent('mousemove'));sizeSource.currentGraph=graph;`; // NEW
    await checkGesture('library exit', run(libraryBegin), run('sizeSource.dragExit(graph);sizeSource.currentGraph=null;sizeSource.reset()')); // NEW
    await checkGesture('library drop', run(libraryBegin), run('sizeSource.currentPoint=new mxPoint(600,500);sizeSource.mouseUp(new MouseEvent("mouseup"))')); // NEW
    for (const ending of ['escape', 'pointercancel', 'blur']) { // NEW
        await checkGesture(ending, run(handleBegin), run(ending === 'escape' ? 'graph.escape()' : 'window.dispatchEvent(new Event("' + ending + '"))')); // NEW
    } // NEW
    await evaluate('Storage.prototype.setItem=sizeSetItem;sizePanel.style.width="420px";sizePanel.style.height="250px";void 0;'); // NEW
    await until('JSON.parse(localStorage.getItem(sizeKey)).width===420&&JSON.parse(localStorage.getItem(sizeKey)).height===250', 'real resizing still persists after suppression'); // NEW
    await evaluate('sizePanel.style.width="180px";sizePanel.style.height="100px";void 0;'); // NEW
    await until('JSON.parse(localStorage.getItem(sizeKey)).width===180&&JSON.parse(localStorage.getItem(sizeKey)).height===100', 'intentional minimum panel dimensions'); // NEW
    await evaluate('graph.clearSelection();graph.__trellisObjectDetails.refresh();graph.setSelectionCell(sizing);graph.__trellisObjectDetails.refresh();void 0;'); // NEW
    assert.deepEqual(await evaluate('(()=>{const panel=document.querySelector("[data-collaboration-object-id=details-sizing]");return [panel.offsetWidth,panel.offsetHeight,panel.querySelector("[aria-pressed=true]").dataset.side]})()'), [180, 100, 'right']); // NEW
    console.log('EXTRA_INFO_SIZE_PRESERVED: native/handle/resize/rotation/library/cancellation and subsequent user resizing'); // NEW
} // NEW
app.whenReady().then(async () => { // NEW
    const win = new BrowserWindow({ show: false, width: 1100, height: 850, webPreferences: { sandbox: false, backgroundThrottling: false } }); // NEW
    win.webContents.on('console-message', event => { if (event.level === 'error') console.error('Details renderer: ' + event.message); }); // NEW
    let exportWindow; const evaluate = source => win.webContents.executeJavaScript('try {\n' + source + '\n} catch (error) { console.error(error.stack); throw error; }'); // NEW
    /** Poll only observable readiness, without repairing caret, focus or dropped input. */ // NEW
    async function until(source, label, target = win) { // NEW
        const deadline = Date.now() + 5000; // NEW
        while (Date.now() < deadline) { if (await target.webContents.executeJavaScript(source)) return; await delay(20); } // NEW
        throw new Error('Timed out waiting for ' + label); // NEW
    } // NEW
    async function capture(target) { // NEW
        const deadline = Date.now() + 5000; // NEW
        while (Date.now() < deadline) { // NEW
            const frame = await target.webContents.capturePage({}, { stayHidden: true, stayAwake: true }); // NEW
            if (frame.toBitmap().some((value, index) => index % 4 !== 3 && value < 200)) return frame; // NEW
            await delay(40); // NEW: observe the first painted compositor frame without changing DOM, focus or input.
        } // NEW
        throw new Error('The hidden Chromium window did not paint its diagram.'); // NEW
    } // NEW
    async function screenshot(name) { fs.mkdirSync(output, { recursive: true }); fs.writeFileSync(path.join(output, name + '.png'), (await capture(win)).toPNG()); } // NEW
    async function clickElement(selector) { // NEW
        const point = await evaluate(`(() => { const rect=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:Math.round(rect.left+rect.width/2),y:Math.round(rect.top+rect.height/2)}; })()`); // NEW
        win.webContents.sendInputEvent({ type: 'mouseMove', ...point }); // NEW
        win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point }); // NEW
        await delay(30); // NEW: native event turns may run blur-triggered refreshes before mouseup.
        win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point }); // NEW
    } // NEW
    /** Select a rendered text run using pointer movement; measuring its bounds never changes the browser selection. */ // NEW
    async function dragText(selector) { // NEW
        const rect = await evaluate(`(() => { const element=document.querySelector(${JSON.stringify(selector)}),range=document.createRange();range.selectNodeContents(element);const rect=range.getBoundingClientRect();window.lastDrag={selector:${JSON.stringify(selector)},rect:rect.toJSON(),hit:document.elementFromPoint(rect.left+1,rect.top+rect.height/2)?.outerHTML,allowed:ui.isSelectionAllowed({target:element}),userSelect:getComputedStyle(element).userSelect};return rect.toJSON(); })()`); // CHANGE
        const y = Math.round(rect.top + rect.height / 2), left = Math.ceil(rect.left + 1), right = Math.floor(rect.right - 1); // NEW
        win.webContents.sendInputEvent({ type: 'mouseMove', x: left, y }); // NEW
        win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, x: left, y }); // NEW
        for (let step = 1; step <= 6; step++) { win.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(left + (right - left) * step / 6), y }); await delay(15); } // NEW
        win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, x: right, y }); // NEW
        await until('!!getSelection().toString()', 'native drag selection'); // NEW
    } // NEW
    try { // NEW
        fs.mkdirSync(output, { recursive: true }); // NEW
        session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => callback({ cancel: true })); // NEW
        const fixture = path.join(output, 'fixture.html'); // NEW
        fs.writeFileSync(fixture, '<!doctype html><html><head><meta charset="utf-8"><base href="' + pathToFileURL(webapp + path.sep).href + '"><script></script></head><body style="margin:0;background:#f8fafc"><div class="geToolbarContainer" id="toolbar" style="position:relative;height:36px;background:#fff;border-bottom:1px solid #ccc"></div><div id="graph" style="position:relative;width:100%;height:calc(100vh - 37px);overflow:auto;background:#f8fafc"></div></body></html>'); // CHANGE: match production's bounded canvas so focusing a label cannot scroll the toolbar offscreen.
        await win.loadFile(fixture); await evaluate('window.mxLoadResources=false;window.mxLoadStylesheets=false;window.urlParams={};'); // NEW
        await evaluate(fs.readFileSync(path.join(webapp, 'js/app.min.js'), 'utf8') + '\n;void 0;'); // NEW
        await evaluate(` // NEW
            mxResources.parse(${JSON.stringify(fs.readFileSync(path.join(webapp, 'resources/dia.txt'), 'utf8'))}); // NEW
            const css=document.createElement('style');css.textContent=${JSON.stringify(fs.readFileSync(path.join(webapp, 'mxgraph/css/common.css'), 'utf8') + '\n' + fs.readFileSync(path.join(webapp, 'styles/grapheditor.css'), 'utf8'))};document.head.appendChild(css); // NEW
            window.graph=new Graph(document.getElementById('graph'));graph.view.getCanvas().ownerSVGElement.style.position='absolute';graph.container.tabIndex=0; // NEW
            window.ui=Object.create(EditorUi.prototype);mxEventSource.call(ui);ui.editor=Object.create(Editor.prototype);mxEventSource.call(ui.editor);ui.editor.graph=graph;ui.editor.undoManager=new mxUndoManager();ui.destroyFunctions=[]; // NEW
            graph.model.addListener(mxEvent.UNDO,(_sender,event)=>ui.editor.undoManager.undoableEditHappened(event.getProperty('edit'))); // NEW
            ui.currentPage={getId:()=> 'page-a'};ui.getFileData=()=>mxUtils.getXml(new mxCodec().encode(graph.model));ui.isOwnGDriveDomain=()=>false;ui.isOffline=()=>true;ui.dialogs=[]; // NEW
            ui.handleError=error=>{throw error;};ui.actions=new Actions(ui);ui.menus=new Menus(ui); // NEW
            ui.toolbar=Object.create(Toolbar.prototype);Object.assign(ui.toolbar,{editorUi:ui,container:document.getElementById('toolbar')}); // NEW
            ui.toolbar.container.appendChild(Object.assign(document.createElement('span'),{id:'normal-toolbar',textContent:'Diagram toolbar'})); // NEW
            window.user='alice';window.editable=true;window.Trellis={users:{isEnabled:()=>true,getCurrentUser:()=>({id:user,name:user}),getAccessSummary:()=>({ownerUserId:'alice'}),getDiagramKey:()=> 'details-electron',canEditCell:()=>editable}};window.Draw={loadPlugin:fn=>fn(ui)}; // CHANGE: comments use the existing diagram identity and permission surface.
            window.selectText=element=>{element.focus();const range=document.createRange();range.selectNodeContents(element);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);}; // NEW
            window.menuItems=name=>{const rows=[];ui.menus.get(name).funct({addItem(label,icon,callback){const row=document.createElement('tr');row.innerHTML='<td></td><td></td>';rows.push({label,callback,row});return row;},addSeparator(){}});return rows;}; // NEW
            ui.showLinkDialog=(_value,_label,apply)=>{window.applyLink=apply;};ui.pickColor=(_value,apply)=>{window.applyColor=apply;}; // NEW
            void 0; // NEW
        `); // NEW
        const visibilitySource = fs.readFileSync(path.join(webapp, 'plugins/garden_planner_plugins/Trellis_UI_Cleanup.js'), 'utf8'); // NEW
        await evaluate(visibilitySource.slice(0, visibilitySource.indexOf('\nDraw.loadPlugin')) + '\n;Trellis.ui.installOverlayVisibility(graph);void 0;'); // NEW: production suppression without unrelated menu/toolbar cleanup.
        const editorUiSource = fs.readFileSync(path.join(webapp, 'js/grapheditor/EditorUi.js'), 'utf8'); // NEW
        let textEditing, hideToolbarElements; // CHANGE
        traverse(parse(editorUiSource), { VariableDeclarator({ node }) { if (node.id.name === 'textEditing') textEditing = editorUiSource.slice(node.init.start, node.init.end); if (node.id.name === 'hideToolbarElements') hideToolbarElements = editorUiSource.slice(node.init.start, node.init.end); } }); // CHANGE: exercise the production responsive toolbar rule.
        assert.ok(textEditing, 'the production EditorUi text selection gate must be installed'); // NEW
        await evaluate(`(function () { const graph=this.editor.graph;const textEditing=${textEditing};this.diagramContainer=graph.container;this.diagramContainer.onmousedown=this.diagramContainer.onselectstart=textEditing;window.originalSelectionAllowed=this.isSelectionAllowed; }).call(ui);void 0;`); // NEW: execute the real host gate with the shipped selection hook, not a permissive imitation.
        assert.ok(hideToolbarElements, 'the production toolbar visibility rule must be installed'); // NEW
        await evaluate(`(function () { window.refreshToolbarVisibility=${hideToolbarElements}; }).call(ui);void 0;`); // NEW
        assert.equal(await evaluate('ui.isSelectionAllowed({target:graph.container})'), false, 'canvas selection remains blocked outside label editing'); // NEW
        const bootstrap = fs.readFileSync(path.join(webapp, 'js/bootstrap.js'), 'utf8'); // NEW
        const loader = require('@babel/parser').parse(bootstrap).program.body.find(node => node.type === 'FunctionDeclaration' && node.id.name === 'mxscript'); // NEW
        await evaluate(bootstrap.slice(loader.start, loader.end) + ';mxscript("plugins/garden_planner_plugins/Trellis_Object_Details.js");void 0;'); // CHANGE: test production dependency loading instead of preloading helpers.
        await until('!!graph.__trellisObjectDetails && !!window.TrellisContextMenu?._getOrderedIdsForTests().includes("objectDetails")', 'details plugin and context menu dependencies'); // NEW
        if (process.argv.includes('--size-regression-only')) { // NEW: exercise real observers independently of native PDF printing availability.
            win.webContents.focus(); await verifyManipulationSizing(win, evaluate, until); // NEW
            console.log('OBJECT_DETAILS_SIZE_RESULT:passed'); win.destroy(); app.exit(0); return; // NEW
        } // NEW
        win.webContents.focus(); // NEW: a hidden test window must receive native focus before opening its field.
        await evaluate(` // NEW
            window.a=graph.insertVertex(null,'details-a','First object',220,110,220,90,'html=1;whiteSpace=wrap;rounded=1;'); // NEW
            const value=mxUtils.createXmlDocument().createElement('object');value.setAttribute('label','Second object');value.setAttribute('trellis_details_html','<p><b>Independent details</b> <a href="https://example.test/second">Nested link</a></p>'); // CHANGE: nested nodes exercise the selection exception beyond the editable root.
            window.b=graph.insertVertex(null,'details-b',value,690,110,200,90,'html=1;whiteSpace=wrap;rounded=1;'); // NEW
            graph.setSelectionCells([a,b]);graph.__trellisObjectDetails.open(a);window.field=document.querySelector('[data-collaboration-object-id="details-a"] .trellis-object-details-editor');void 0; // NEW
        `); // NEW
        await until('!!ui.getActiveRichTextTarget()&&document.activeElement===field', 'details focus and toolbar'); // NEW
        assert.equal(await evaluate('graph.isEditing()'), false, 'a details field is independent of the label editor'); // NEW
        stage = 'empty field placement with native pointer input'; // NEW
        await evaluate('graph.view.setTranslate(160,220);graph.__trellisObjectDetails.refresh();void 0;'); // NEW
        for (const side of ['above', 'below', 'left', 'right']) { // NEW
            await clickElement('[data-collaboration-object-id="details-a"] [data-side="' + side + '"]'); // NEW
            await until('!!document.querySelector("[data-collaboration-object-id=details-a] [data-side=' + side + '][aria-pressed=true]")', 'empty field ' + side + ' arrow to change placement without closing'); // NEW
            assert.equal(await evaluate('document.activeElement===field'), true, 'placement must preserve the focused empty field'); // NEW
        } // NEW
        await evaluate('graph.view.setTranslate(0,0);graph.__trellisObjectDetails.refresh();void 0;'); // NEW
        stage = 'native bullet button in an empty field'; // NEW
        await clickElement('.geToolbarContainer [title="Bulleted List"]'); // NEW
        await until('!!field.querySelector("ul > li")&&document.activeElement===field', 'bullet list at an empty caret'); // NEW
        assert.equal(await evaluate('document.querySelectorAll(".geToolbarContainer [title=\\"Bulleted List\\"]").length'), 1, 'exactly one visible bullet button'); // NEW
        assert.deepEqual(await evaluate('(()=>{const button=document.querySelector(".geToolbarContainer [title=\\"Bulleted List\\"]");return {afterUnderline:button.previousElementSibling.title.startsWith("Underline"),minWidth:button.dataset.minWidth,pressed:button.hasAttribute("aria-pressed")};})()'), { afterUnderline: true, minWidth: '460', pressed: false }); // NEW
        await clickElement('.geToolbarContainer [title="Bulleted List"]'); // NEW
        await until('!field.querySelector("ul")', 'toggle off the empty bullet list'); // NEW
        win.setSize(440, 850); await until('innerWidth<460', 'narrow toolbar viewport'); // NEW
        await evaluate('refreshToolbarVisibility();void 0;'); // NEW
        assert.equal(await evaluate('getComputedStyle(document.querySelector(".geToolbarContainer [title=\\"Bulleted List\\"]")).display'), 'none'); // NEW
        assert.equal(await evaluate('getComputedStyle(document.querySelector(".geToolbarContainer [title^=Underline]")).display'), 'none'); // NEW
        win.setSize(1100, 850); await until('innerWidth>1000', 'normal toolbar viewport'); // NEW
        await evaluate('refreshToolbarVisibility();void 0;'); // NEW
        assert.equal(await evaluate('(()=>{const button=document.querySelector(".geToolbarContainer [title=\\"Bulleted List\\"]"),rect=button.getBoundingClientRect();return getComputedStyle(button).display!=="none"&&rect.width>0&&rect.right<=innerWidth;})()'), true); // NEW
        win.webContents.focus(); for (const character of 'Native typing survives') win.webContents.sendInputEvent({ type: 'char', keyCode: character }); // NEW
        await until('field.textContent === "Native typing survives"', 'native input'); // NEW
        await evaluate('window.savedCaret={node:getSelection().anchorNode,offset:getSelection().anchorOffset};graph.refresh();graph.__trellisObjectDetails.refresh();void 0;'); // NEW
        assert.equal(await evaluate('document.activeElement===field&&getSelection().anchorNode===savedCaret.node&&getSelection().anchorOffset===savedCaret.offset'), true); // NEW
        await until('a.getAttribute("trellis_details_html")?.includes("Native typing survives")', 'typing-pause autosave'); // NEW
        stage = 'native badge reopen and text focus'; // NEW
        await clickElement('.trellis-object-details-badge[data-cell-id="details-a"]'); // NEW
        await until('!document.querySelector("[data-collaboration-object-id=details-a]")', 'badge to close details'); // NEW
        await clickElement('.trellis-object-details-badge[data-cell-id="details-a"]'); // NEW
        await until('!!document.querySelector("[data-collaboration-object-id=details-a] .trellis-object-details-editor")', 'badge to reopen details'); // NEW
        await evaluate('window.field=document.querySelector("[data-collaboration-object-id=details-a] .trellis-object-details-editor");void 0;'); // NEW
        await clickElement('[data-collaboration-object-id="details-a"] .trellis-object-details-editor'); // NEW
        await until('document.activeElement===field&&ui.getActiveRichTextTarget()?.element===field', 'reopened field to accept native focus'); // NEW
        assert.equal(await evaluate('!!getSelection().rangeCount&&field.contains(getSelection().anchorNode)&&field.contains(getSelection().focusNode)'), true, 'a native mouse click must place the caret inside the reopened editor'); // NEW
        win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'End', modifiers: ['control'] }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'End', modifiers: ['control'] }); // NEW
        win.webContents.sendInputEvent({ type: 'char', keyCode: '!' }); // NEW
        await until('field.textContent==="Native typing survives!"', 'native typing in a reopened field'); // NEW
        stage = 'native placement of populated fields'; // NEW
        await evaluate('graph.view.setTranslate(160,220);graph.__trellisObjectDetails.refresh();void 0;'); // NEW: keep all four placement controls inside the viewport.
        for (const side of ['above', 'below', 'left', 'right']) { // NEW
            await clickElement('[data-collaboration-object-id="details-a"] [data-side="' + side + '"]'); // NEW
            await until('!!document.querySelector("[data-collaboration-object-id=details-a] [data-side=' + side + '][aria-pressed=true]")', side + ' arrow to change placement'); // NEW
            assert.equal(await evaluate('document.activeElement===field'), true, 'placement preserves the reopened editor focus'); // NEW
        } // NEW
        await evaluate('graph.view.setTranslate(0,0);graph.__trellisObjectDetails.refresh();void 0;'); // NEW
        const originalStyle = await evaluate('a.style'); // NEW
        stage = 'native bullet selection, continuation and persistence'; // NEW
        await evaluate('selectText(field);ui.getActiveRichTextTarget().execute("insertHTML","<p>First bullet</p><p>Second bullet</p>");selectText(field);void 0;'); // NEW
        await clickElement('.geToolbarContainer [title="Bulleted List"]'); // NEW
        await until('field.querySelectorAll("ul > li").length===2', 'selected paragraphs to become separate bullet items'); // NEW
        assert.deepEqual(await evaluate('[...field.querySelectorAll("ul > li")].map(item=>item.textContent)'), ['First bullet', 'Second bullet']); // NEW
        await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));'); // NEW: capture the list after its compositor frame, rather than the preceding toolbar click.
        await screenshot('bullet-list'); // NEW
        await evaluate('const range=document.createRange();range.selectNodeContents(field.querySelector("li:last-child"));range.collapse(false);getSelection().removeAllRanges();getSelection().addRange(range);void 0;'); // NEW
        win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' }); win.webContents.sendInputEvent({ type: 'char', keyCode: '\r' }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' }); // NEW: native text insertion requires the character event as well as key events.
        await until('field.querySelectorAll("ul > li").length===3', 'Enter to continue the bullet list'); // NEW
        win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' }); win.webContents.sendInputEvent({ type: 'char', keyCode: '\r' }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' }); // NEW
        await until('field.querySelectorAll("ul > li").length===2&&!getSelection().anchorNode.parentElement.closest("li")', 'Enter on an empty item to exit the list'); // NEW
        assert.equal(await evaluate('graph.__trellisObjectDetails.flush()'), true); // NEW
        assert.equal(await evaluate('(()=>{const xml=mxUtils.parseXml(ui.getFileData()),restored=new mxGraphModel();new mxCodec(xml).decode(xml.documentElement,restored);const node=document.createElement("div");node.innerHTML=restored.getCell("details-a").getAttribute("trellis_details_html");return node.querySelectorAll("ul > li").length;})()'), 2, 'bullet HTML survives diagram XML serialization'); // NEW
        await clickElement('.trellis-object-details-badge[data-cell-id="details-a"]'); // NEW
        await until('!document.querySelector("[data-collaboration-object-id=details-a]")', 'close the saved bullet list'); // NEW
        await clickElement('.trellis-object-details-badge[data-cell-id="details-a"]'); // NEW
        await until('!!document.querySelector("[data-collaboration-object-id=details-a] .trellis-object-details-editor ul")', 'saved bullet list to reopen'); // NEW
        await evaluate('window.field=document.querySelector("[data-collaboration-object-id=details-a] .trellis-object-details-editor");selectText(field);void 0;'); // NEW
        await clickElement('.geToolbarContainer [title="Bulleted List"]'); // NEW
        await until('!field.querySelector("ul")&&field.textContent.includes("First bullet")&&field.textContent.includes("Second bullet")', 'toggle selected bullets off without losing their text'); // NEW
        await evaluate('selectText(field);ui.getActiveRichTextTarget().execute("insertHTML","Native typing survives!");void 0;'); // NEW: restore the existing formatting fixture after the list-specific scenarios.
        for (const command of ['bold', 'italic', 'underline', 'subscript', 'superscript']) { // NEW
            await evaluate(`selectText(field);ui.actions.get(${JSON.stringify(command)}).funct();void 0;`); // NEW
            assert.equal(await evaluate(`document.queryCommandState(${JSON.stringify(command)})`), true, command + ' targets the rich-text field'); // NEW
        } // NEW
        await evaluate('selectText(field);menuItems("fontFamily").find(item=>item.label==="Verdana").callback();void 0;'); // NEW
        assert.match(await evaluate('field.innerHTML'), /Verdana/i, 'font selection formats the current rich-text selection'); // NEW
        await evaluate('selectText(field);menuItems("fontSize").find(item=>item.label===24).callback();void 0;'); // NEW
        assert.equal(await evaluate('getComputedStyle(field.querySelector("font,span")).fontSize'), '24px'); // NEW
        assert.match(await evaluate('field.innerHTML'), /Verdana/i); // NEW
        await evaluate('selectText(field);menuItems("formatBlock").find(item=>item.label==="Heading 2").callback();void 0;'); // NEW
        assert.equal(await evaluate('!!field.querySelector("h2")'), true); // NEW
        await evaluate('selectText(field);ui.actions.get("fontColor").funct();applyColor("#dc2626");selectText(field);ui.actions.get("backgroundColor").funct();applyColor("#fef08a");void 0;'); // NEW
        assert.match(await evaluate('field.innerHTML'), /dc2626|220, 38, 38/i); // NEW
        assert.match(await evaluate('field.innerHTML'), /fef08a|254, 240, 138/i); // NEW
        await evaluate('selectText(field);ui.actions.get("link").funct();applyLink("https://example.test/details");void 0;'); // NEW
        assert.equal(await evaluate('field.querySelector("a")?.getAttribute("href")'), 'https://example.test/details'); // NEW
        const supported = await evaluate(`(() => { // NEW
            const menus=[];const original=ui.toolbar.addMenu;ui.toolbar.addMenu=function(menu,...args){menus.push(menu);return original.call(this,menu,...args);}; // NEW
            ui.toolbar.container.replaceChildren();ui.toolbar.createTextToolbar();ui.toolbar.addMenu=original; // NEW
            window.alignment=menus[3];window.formatting=menus[4];window.insertMenu=menus[5]; // NEW
            window.collect=menu=>{const rows=[];menu.funct({addItem(label,icon,callback){const row=document.createElement('tr');rows.push({label,icon,callback,row});return row;},addSeparator(){}});return rows;}; // NEW
            return {menus:menus.length,insert:collect(insertMenu).map(item=>item.label),hasCode:[...ui.toolbar.container.children].some(node=>node.title==='HTML')}; // NEW
        })()`); // NEW
        assert.equal(supported.menus, 6); assert.equal(supported.hasCode, false); assert.deepEqual(supported.insert, ['Insert Link']); // NEW
        await evaluate('selectText(field);collect(alignment)[2].callback();void 0;'); // NEW
        assert.match(await evaluate('field.innerHTML'), /text-align: right/); // NEW
        for (const [index, tag] of [[4, 'ol'], [5, 'ul']]) { // NEW
            await evaluate(`selectText(field);collect(formatting).at(-1).callback();collect(alignment)[${index}].callback();void 0;`); // NEW
            assert.equal(await evaluate(`!!field.querySelector(${JSON.stringify(tag)})`), true, 'existing toolbar list menu works'); // NEW
        } // NEW
        await evaluate('selectText(field);collect(alignment)[6].callback();collect(alignment)[7].callback();selectText(field);collect(formatting).at(-1).callback();void 0;'); // NEW
        assert.equal(await evaluate('a.style'), originalStyle, 'all toolbar formatting leaves object styles untouched'); // NEW
        assert.equal(await evaluate('a.getAttribute("label")'), 'First object'); // NEW
        await screenshot('rich-text'); // NEW

        stage = 'native rich-text selection and field switching'; // NEW
        await clickElement('[data-collaboration-object-id="details-a"] [data-side="below"]'); // NEW
        await clickElement('[data-collaboration-object-id="details-b"] .trellis-object-details-editor b'); // NEW
        await until('ui.getActiveRichTextTarget()?.cell===b', 'nested text click to activate the second field'); // NEW
        assert.equal(await evaluate('document.querySelector("[data-collaboration-object-id=details-b] .trellis-object-details-editor").contains(getSelection().anchorNode)'), true); // NEW
        const firstFieldHtml = await evaluate('field.innerHTML'); // NEW
        await dragText('[data-collaboration-object-id="details-b"] .trellis-object-details-editor b'); // NEW
        await clickElement('.geToolbarContainer [title^="Italic"]'); // NEW
        await until('document.queryCommandState("italic")', 'the native toolbar to format the second field selection'); // CHANGE: observe native click delivery rather than reading before mouseup is processed.
        assert.equal(await evaluate('field.innerHTML'), firstFieldHtml, 'switching fields cannot format the first field'); // NEW
        await clickElement('.geToolbarContainer [title="Bulleted List"]'); // NEW
        await until('!!document.querySelector("[data-collaboration-object-id=details-b] ul")', 'the bullet button to format the second field'); // NEW
        assert.equal(await evaluate('field.innerHTML'), firstFieldHtml, 'bullet formatting cannot change the previous field'); // NEW
        assert.equal(await evaluate('document.querySelectorAll(".geToolbarContainer [title=\\"Bulleted List\\"]").length'), 1, 'switching fields reuses one bullet button'); // NEW
        await evaluate('ui.actions.get("link").funct();window.staleLink=applyLink;void 0;'); // NEW
        await clickElement('[data-collaboration-object-id="details-a"] .trellis-object-details-editor'); // NEW
        await until('ui.getActiveRichTextTarget()?.cell===a', 'native switch back to the first field'); // NEW
        const beforeStaleLink = await evaluate('ui.getFileData()'); // NEW
        await evaluate('staleLink("https://example.test/stale");void 0;'); // NEW
        assert.equal(await evaluate('ui.getFileData()'), beforeStaleLink, 'a delayed dialog cannot format a different field'); // NEW
        await clickElement('[data-collaboration-object-id="details-b"] .trellis-object-details-editor a'); // NEW
        await dragText('[data-collaboration-object-id="details-b"] .trellis-object-details-editor a'); // NEW
        await evaluate('ui.showLinkDialog=EditorUi.prototype.showLinkDialog;ui.container=document.body;ui.actions.get("link").funct();void 0;'); // CHANGE: open the shipped modal to exercise actual dialog focus and selection restoration.
        await until('document.activeElement?.matches(".geDialog input[type=text]")', 'link dialog input focus'); // NEW
        for (const character of 'https://example.test/updated') win.webContents.sendInputEvent({ type: 'char', keyCode: character }); // NEW
        await until('document.querySelector(".geDialog input[type=text]")?.value==="https://example.test/updated"', 'native link dialog typing'); // NEW
        await clickElement('.geDialog .gePrimaryBtn'); // NEW
        await until('!document.querySelector(".geDialog")&&document.querySelector("[data-collaboration-object-id=details-b] a[href=\\"https://example.test/updated\\"]")!==null', 'link dialog to format the saved field selection'); // NEW
        await until('document.activeElement===graph.container', 'host focus restoration after the link dialog closes'); // NEW: observe draw.io's existing asynchronous close before beginning a new pointer gesture.
        await evaluate('graph.__trellisObjectDetails.flush();void 0;'); // NEW
        assert.match(await evaluate('b.getAttribute("trellis_details_html")'), /https:\/\/example.test\/updated/); // NEW

        stage = 'read-only native text selection'; // NEW
        const readOnlyHtml = await evaluate('b.getAttribute("trellis_details_html")'); // NEW
        const readOnlyEditorHtml = await evaluate('document.querySelector("[data-collaboration-object-id=details-b] .trellis-object-details-editor").innerHTML'); // NEW
        await evaluate('editable=false;graph.__trellisObjectDetails.refresh();void 0;'); // NEW
        await dragText('[data-collaboration-object-id="details-b"] .trellis-object-details-editor b'); // NEW
        assert.equal(await evaluate('document.querySelector("[data-collaboration-object-id=details-b] .trellis-object-details-editor").contentEditable'), 'false'); // NEW
        await evaluate('window.readOnlyCopy="";document.addEventListener("copy",event=>{readOnlyCopy=getSelection().toString();event.preventDefault();},{once:true,capture:true});void 0;'); // NEW: observe Copy without replacing the user's system clipboard.
        win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'c', modifiers: ['control'] }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'c', modifiers: ['control'] }); // NEW
        await until('!!readOnlyCopy', 'native copying of read-only selected text'); // NEW
        await evaluate('window.readOnlyKeySeen=false;document.querySelector("[data-collaboration-object-id=details-b] .trellis-object-details-editor").addEventListener("keypress",()=>{readOnlyKeySeen=true;},{once:true});void 0;'); // NEW
        win.webContents.sendInputEvent({ type: 'char', keyCode: 'X' }); // NEW
        await until('readOnlyKeySeen', 'read-only typing attempt to reach the field'); // NEW
        assert.equal(await evaluate('graph.__trellisObjectDetails.flush()'), true); // NEW
        assert.equal(await evaluate('b.getAttribute("trellis_details_html")'), readOnlyHtml, 'read-only selection grants no edit permission'); // NEW
        assert.equal(await evaluate('(()=>{const editor=document.querySelector("[data-collaboration-object-id=details-b] .trellis-object-details-editor"),target=TrellisDetailsToolbar.createTarget({element:editor,cell:b,canEdit:()=>editable,changed(){throw new Error("Read-only details changed");}});ui.__trellisDetailsToolbar.activate(target);const button=document.querySelector(".geToolbarContainer [title=\\"Bulleted List\\"]");button.click();target.dispose();ui.__trellisDetailsToolbar.deactivate();return editor.innerHTML;})()'), readOnlyEditorHtml, 'even a stale bullet button cannot format read-only details'); // NEW
        await evaluate('editable=true;graph.__trellisObjectDetails.refresh();void 0;'); // NEW

        stage = 'native deselection and reselection'; // NEW
        await clickElement('#graph'); // NEW: its center is the empty gap between the two panels.
        await until('graph.isSelectionEmpty()&&!document.querySelector(".trellis-object-details")', 'canvas click to deselect and close fields'); // NEW
        await evaluate('graph.view.getState(a).shape.node.setAttribute("data-test-object","a");void 0;'); // NEW
        await clickElement('[data-test-object="a"]'); // NEW
        await until('graph.isCellSelected(a)&&!!document.querySelector("[data-collaboration-object-id=details-a]")', 'shape click to reopen its field'); // NEW
        await evaluate('window.field=document.querySelector("[data-collaboration-object-id=details-a] .trellis-object-details-editor");void 0;'); // NEW
        await clickElement('[data-collaboration-object-id="details-a"] .trellis-object-details-editor'); // NEW
        await until('document.activeElement===field&&field.contains(getSelection().anchorNode)', 'reselected field to receive its caret from the mouse'); // NEW
        const beforeReselectionType = await evaluate('field.textContent'); // NEW
        win.webContents.sendInputEvent({ type: 'char', keyCode: 'R' }); // NEW
        await until('field.textContent!=='+JSON.stringify(beforeReselectionType), 'native typing after reselection'); // NEW

        await evaluate('graph.__trellisObjectDetails.flush();window.panel=field.closest("section");panel.querySelector("[data-side=right]").click();new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));'); // CHANGE: settle pending model refreshes before simulating a resize.
        await evaluate('panel.style.width="360px";panel.style.height="220px";void 0;'); // NEW
        await until('JSON.parse(localStorage.getItem(Object.keys(localStorage).find(key=>key.startsWith("trellis.details.view.v1:")&&key.includes("details-a")))).width===360', 'resize persistence'); // CHANGE: private comment drafts use their own storage namespace.
        const position = await evaluate('({left:parseFloat(panel.style.left),top:parseFloat(panel.style.top),width:panel.offsetWidth,height:panel.offsetHeight})'); // NEW
        assert.equal(position.left, 448); assert.equal(position.width, 360); assert.equal(position.height, 220); // NEW
        await evaluate('graph.useCssTransforms=true;graph.view.setScale(1.5);graph.__trellisObjectDetails.refresh();void 0;'); // NEW
        assert.equal(await evaluate('panel.offsetWidth'), 360); // NEW
        assert.equal(await evaluate('parseFloat(panel.style.left)'), 668, 'CSS-transform zoom keeps the field beside its owner'); // NEW
        await evaluate('graph.view.setScale(1);graph.view.revalidate();graph.__trellisObjectDetails.refresh();void 0;'); // NEW: restore zoom through the same CSS-transform path that painted the diagram.
        await evaluate('graph.__trellisObjectDetails.flush();ui.__trellisDetailsToolbar.deactivate();graph.clearSelection();graph.setSelectionCell(a);graph.__trellisObjectDetails.refresh();window.field=document.querySelector("[data-collaboration-object-id=details-a] .trellis-object-details-editor");window.panel=field.closest("section");void 0;'); // NEW
        assert.equal(await evaluate('panel.offsetWidth'), 360); assert.equal(await evaluate('panel.querySelector("[aria-pressed=true]").dataset.side'), 'right'); // NEW
        assert.equal(await evaluate('!!document.getElementById("normal-toolbar")'), true, 'the original top toolbar is restored'); // NEW

        await evaluate(`field.innerHTML='<h2>Export heading</h2>'+Array.from({length:24},(_,i)=>'<p>Paragraph '+i+' with wrapping details.</p>').join('')+'<p>FINAL EXPORT PARAGRAPH</p>';field.dispatchEvent(new InputEvent('input',{bubbles:true}));graph.__trellisObjectDetails.flush();void 0;`); // NEW
        assert.equal(await evaluate('graph.__trellisObjectDetails.flush()'), true, await evaluate('document.querySelector("[data-collaboration-object-id=details-a] [role=status]").textContent')); // NEW
        stage = 'comment tabs and native rich-text input'; // CHANGE
        await clickElement('[data-collaboration-object-id="details-a"] [data-details-tab="comments"]'); // CHANGE
        await evaluate('window.commentField=document.querySelector("[data-collaboration-object-id=details-a] .trellis-comment-editor");commentField.scrollIntoView({block:"nearest"});void 0;'); // CHANGE
        await clickElement('[data-collaboration-object-id="details-a"] .trellis-comment-editor'); // CHANGE
        for (const character of 'COMMENT EXCLUDED FROM EXPORT') win.webContents.sendInputEvent({ type: 'char', keyCode: character }); // CHANGE
        await until('commentField.textContent==="COMMENT EXCLUDED FROM EXPORT"', 'native comment typing'); // CHANGE
        await evaluate('selectText(commentField);ui.actions.get("bold").funct();void 0;'); // CHANGE
        assert.equal(await evaluate('!!commentField.querySelector("b,strong")'), true, 'comments reuse the shipped rich-text toolbar'); // CHANGE
        assert.equal(await evaluate('a.getAttribute("trellis_comments_json")||null'), null, 'comment input is private until Post'); // CHANGE
        await evaluate('document.querySelector("[data-collaboration-object-id=details-a] [data-comment-action=submit]").scrollIntoView({block:"nearest"});void 0;'); // CHANGE
        await clickElement('[data-collaboration-object-id="details-a"] [data-comment-action="submit"]'); // CHANGE
        await until('TrellisDetailsCore.parseComments(a.getAttribute("trellis_comments_json")).length===1&&commentField.textContent===""', 'explicit comment submission'); // CHANGE
        win.webContents.invalidate(); await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));'); // CHANGE: capture the comment compositor frame rather than a previously cached hidden-window image.
        await screenshot('comments'); // CHANGE
        await evaluate('const commentsValue=mxUtils.createXmlDocument().createElement("object");commentsValue.setAttribute("label","Comments only");commentsValue.setAttribute("trellis_comments_json",a.getAttribute("trellis_comments_json"));window.commentOnly=graph.insertVertex(null,"comments-only",commentsValue,1000,110,140,90);graph.addSelectionCell(commentOnly);graph.__trellisObjectDetails.refresh();void 0;'); // CHANGE
        assert.equal(await evaluate('document.querySelector("[data-collaboration-object-id=comments-only] [data-details-tab=comments]").getAttribute("aria-pressed")'), 'true'); // CHANGE
        assert.equal(await evaluate('graph.__trellisObjectDetails.exportProjection()["page-a"].some(record=>record.ownerId==="comments-only")'), false, 'comment-only badges stay out of rendered exports'); // CHANGE
        stage = 'native pipe alert interaction'; // CHANGE
        await evaluate(` // CHANGE
            graph.clearSelection();const value=mxUtils.createXmlDocument().createElement('object');value.setAttribute('label','Annotated pipe');value.setAttribute('irrigation_pipe_edge','1');value.setAttribute('trellis_details_html','<p>EDGE ANNOTATION EXPORTED</p>'); // CHANGE
            const now=Date.now();value.setAttribute('trellis_comments_json',JSON.stringify({version:2,comments:[{id:'pipe-alert',authorUserId:'alice',authorName:'alice',html:'<p>ALERT EXCLUDED FROM EXPORT</p>',createdAt:now,updatedAt:now,resolvedAt:null,resolvedByUserId:null,resolvedByName:null,isAlert:true}]})); // CHANGE
            window.alertEdge=graph.insertEdge(null,'alert-edge',value,a,b,'edgeStyle=orthogonalEdgeStyle;html=1;');graph.__trellisObjectDetails.refresh();void 0; // CHANGE
        `); // CHANGE
        assert.deepEqual(await evaluate(`(()=>{const badge=document.querySelector('[data-cell-id="alert-edge"]'),center=badge.firstElementChild;return [getComputedStyle(badge).backgroundColor,getComputedStyle(center).backgroundColor,getComputedStyle(badge).outlineColor,badge.title.includes('1 active alert')];})()`), ['rgb(30, 64, 175)', 'rgb(250, 204, 21)', 'rgb(220, 38, 38)', true]); // CHANGE
        await clickElement('[data-cell-id="alert-edge"]'); // CHANGE
        await until('graph.isCellSelected(alertEdge)&&document.querySelector("[data-collaboration-object-id=alert-edge] [data-details-tab=alerts]")?.getAttribute("aria-pressed")==="true"', 'native edge badge to select the pipe and open Alerts'); // CHANGE
        await evaluate('window.alertPanel=document.querySelector("[data-collaboration-object-id=alert-edge]");alertPanel.querySelector("[data-comment-action=resolve]").scrollIntoView({block:"nearest"});void 0;'); // CHANGE
        await clickElement('[data-collaboration-object-id="alert-edge"] [data-comment-action="resolve"]'); // CHANGE
        await until('TrellisDetailsCore.parseComments(alertEdge.getAttribute("trellis_comments_json"))[0].resolvedAt!==null&&!document.querySelector("[data-cell-id=alert-edge]").style.outline', 'resolution to clear the red signal'); // CHANGE
        await clickElement('[data-collaboration-object-id="alert-edge"] [data-comment-section="resolved"] summary'); // CHANGE
        await until('alertPanel.querySelector("[data-comment-section=resolved]").open', 'resolved alert history to expand'); // CHANGE
        await evaluate('alertPanel.querySelector("[data-comment-action=reopen]").scrollIntoView({block:"nearest"});void 0;'); // CHANGE
        await clickElement('[data-collaboration-object-id="alert-edge"] [data-comment-action="reopen"]'); // CHANGE
        await until('TrellisDetailsCore.parseComments(alertEdge.getAttribute("trellis_comments_json"))[0].resolvedAt===null&&!!document.querySelector("[data-cell-id=alert-edge]").style.outline', 'reopening to restore the alert outline'); // CHANGE
        assert.equal(await evaluate('alertPanel.querySelector("[data-details-tab=alerts]").getAttribute("aria-pressed")'), 'true'); // CHANGE
        win.webContents.invalidate(); await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));'); await screenshot('edge-alerts'); // CHANGE
        await evaluate('const value=commentOnly.value.cloneNode(true);value.setAttribute("trellis_comments_json",alertEdge.getAttribute("trellis_comments_json"));graph.model.setValue(commentOnly,value);graph.setSelectionCells([a,alertEdge,commentOnly]);graph.__trellisObjectDetails.refresh();void 0;'); // CHANGE
        assert.equal(await evaluate('graph.__trellisObjectDetails.exportProjection()["page-a"].some(record=>record.ownerId==="comments-only")'), false, 'alert-only badges also stay out of rendered exports'); // CHANGE
        const snapshot = await evaluate('graph.getExportVariables().__trellisDetailsProjection'); // NEW
        assert.ok(snapshot['page-a'].find(record => record.ownerId === 'details-a' && !record.badge).geometry.height > 500); // CHANGE: interaction order may place a short pipe annotation before the long description.
        const canonical = await evaluate('ui.getFileData()'); // NEW
        const selectedSvg = await evaluate('mxUtils.getXml(graph.getSvg(null,1,0,false,null,false))'); // NEW
        assert.match(selectedSvg, /FINAL EXPORT PARAGRAPH/); assert.doesNotMatch(selectedSvg, /Second object|Independent details/); // NEW
        const svg = await evaluate('mxUtils.getXml(graph.getSvg(null,1,0))'); // NEW
        assert.match(svg, /EDGE ANNOTATION EXPORTED/); assert.doesNotMatch(svg, /ALERT EXCLUDED FROM EXPORT|#dc2626/); // CHANGE
        assert.match(svg, /FINAL EXPORT PARAGRAPH/); assert.doesNotMatch(svg, /COMMENT EXCLUDED FROM EXPORT|Place details|Saved to diagram|trellis-object-details-editor|contenteditable/); // CHANGE
        assert.equal(await evaluate('ui.getFileData()'), canonical); // NEW
        fs.writeFileSync(path.join(output, 'details.svg'), svg); // NEW
        await screenshot('overlays'); // NEW

        exportWindow = new BrowserWindow({ show: false, width: 1200, height: 1000, webPreferences: { sandbox: false, backgroundThrottling: false } }); // NEW
        exportWindow.webContents.on('console-message', event => { if (event.level === 'error') console.error('Details export renderer: ' + event.message); }); // NEW
        await exportWindow.loadFile(path.join(webapp, 'export3.html')); // NEW
        await until('typeof render==="function"&&!!TrellisDetailsCore', 'desktop export renderer', exportWindow); // NEW
        await exportWindow.webContents.executeJavaScript('Editor.MathJaxRender=null;void 0;'); // NEW: this text-only fixture does not depend on asynchronous mathematics assets.
        const xml = '<mxfile><diagram id="page-a" name="Page 1">' + canonical + '</diagram><diagram id="page-b" name="Page 2">' + canonical + '</diagram></mxfile>'; // NEW
        const options = { xml, format: 'png', scale: 1, border: 0, extras: JSON.stringify({ globalVars: { __trellisDetailsProjection: snapshot } }) }; // NEW
        stage = 'PNG renderer'; await exportWindow.webContents.executeJavaScript('window.exportGraph=render(' + JSON.stringify(options) + ');void 0;'); // NEW
        await until('!!document.getElementById("LoadingComplete")', 'PNG rendering', exportWindow); // NEW
        assert.equal(await exportWindow.webContents.executeJavaScript('document.body.textContent.includes("FINAL EXPORT PARAGRAPH")'), true); // NEW
        assert.equal(await exportWindow.webContents.executeJavaScript('document.body.textContent.includes("COMMENT EXCLUDED FROM EXPORT")'), false, 'PNG projection excludes comments'); // CHANGE
        assert.equal(await exportWindow.webContents.executeJavaScript('document.body.textContent.includes("ALERT EXCLUDED FROM EXPORT")'), false, 'PNG projection excludes alerts'); assert.equal(await exportWindow.webContents.executeJavaScript('document.body.textContent.includes("EDGE ANNOTATION EXPORTED")'), true); // CHANGE
        assert.equal(await exportWindow.webContents.executeJavaScript('(()=>{const panel=Object.values(exportGraph.model.cells).find(cell=>cell.__trellisDetailsOwner?.id==="details-a"&&!String(cell.value).includes("&#9432;")),state=exportGraph.view.getState(panel),paragraph=[...state.text.node.querySelectorAll("p")].at(-1),bottom=paragraph.getBoundingClientRect().bottom;return bottom<=state.shape.node.getBoundingClientRect().bottom+2;})()'), true, 'expanded export bounds contain the final paragraph'); // CHANGE
        const png = await capture(exportWindow); fs.writeFileSync(path.join(output, 'export.png'), png.toPNG()); // NEW
        const pixels = png.toBitmap(); assert.ok(pixels.some((value, index) => index % 4 !== 3 && value < 200), 'the PNG must paint visible diagram content'); // NEW
        options.format = 'pdf'; options.allPages = '1'; options.pageWidth = 827; options.pageHeight = 1169; options.pageScale = 1; // NEW: mirror the dimensions supplied by the real desktop print request.
        stage = 'PDF renderer'; await exportWindow.webContents.executeJavaScript('window.exportGraph=render(' + JSON.stringify(options) + ');void 0;'); // NEW
        await until('!!document.getElementById("LoadingComplete")', 'PDF and print rendering', exportWindow); // NEW
        assert.equal(await exportWindow.webContents.executeJavaScript('document.body.textContent.includes("FINAL EXPORT PARAGRAPH")'), true); // NEW
        assert.equal(await exportWindow.webContents.executeJavaScript('document.body.textContent.includes("COMMENT EXCLUDED FROM EXPORT")'), false, 'PDF and print projections exclude comments'); // CHANGE
        assert.equal(await exportWindow.webContents.executeJavaScript('document.body.textContent.includes("ALERT EXCLUDED FROM EXPORT")'), false, 'PDF and print projections exclude alerts'); assert.equal(await exportWindow.webContents.executeJavaScript('document.body.textContent.includes("EDGE ANNOTATION EXPORTED")'), true); // CHANGE
        assert.equal(await evaluate('ui.getFileData()'), canonical, 'image and PDF export must never modify the live model'); // NEW
        stage = 'badge states and native keyboard activation'; // CHANGE
        await evaluate(` // CHANGE
            graph.clearSelection();graph.useCssTransforms=false;graph.view.scaleAndTranslate(1,0,0);graph.view.revalidate(); // CHANGE
            const posted=TrellisDetailsCore.parseComments(a.getAttribute('trellis_comments_json'))[0]; // CHANGE
            const resolved={...posted,resolvedAt:Date.now(),resolvedByUserId:'alice',resolvedByName:'alice'}; // CHANGE
            const cases=[['details','Details only',true,[]],['unresolved','Unresolved comments',false,[posted]],['both','Details + unresolved',true,[posted]],['resolved','Resolved comments',false,[resolved]],['empty','No extra content',false,[]]]; // CHANGE
            cases.forEach(([id,label,hasDetails,comments],index)=>{const value=mxUtils.createXmlDocument().createElement('object');value.setAttribute('label',label);if(hasDetails)value.setAttribute('trellis_details_html','<p>Saved details</p>');if(comments.length)value.setAttribute('trellis_comments_json',JSON.stringify({version:2,comments}));graph.insertVertex(null,'badge-'+id,value,30+index*205,300,180,70,'html=1;whiteSpace=wrap;rounded=1;');}); // CHANGE
            graph.__trellisObjectDetails.refresh();graph.container.scrollLeft=0;graph.container.scrollTop=0;window.scrollTo(0,0);void 0; // CHANGE
        `); // CHANGE
        const badgeStates = await evaluate(`['details','unresolved','both','resolved'].map(id=>{const badge=document.querySelector('[data-cell-id="badge-'+id+'"]'),center=badge.firstElementChild,bounds=badge.getBoundingClientRect(),inner=center.getBoundingClientRect();return {id,width:bounds.width,height:bounds.height,centerWidth:inner.width,outer:getComputedStyle(badge).backgroundColor,center:getComputedStyle(center).backgroundColor,inset:inner.left-bounds.left,label:badge.getAttribute('aria-label')};})`); // CHANGE
        assert.deepEqual(badgeStates.map(item => [item.width, item.height, item.centerWidth, item.inset]), Array.from({ length: 4 }, () => [20, 20, 14, 3])); // CHANGE
        assert.deepEqual(badgeStates.map(item => [item.outer, item.center]), [['rgb(30, 64, 175)', 'rgb(239, 246, 255)'], ['rgb(239, 246, 255)', 'rgb(250, 204, 21)'], ['rgb(30, 64, 175)', 'rgb(250, 204, 21)'], ['rgb(239, 246, 255)', 'rgb(239, 246, 255)']]); // CHANGE
        assert.equal(await evaluate('!!document.querySelector("[data-cell-id=badge-empty]")'), false); // CHANGE
        win.webContents.invalidate(); await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));'); // CHANGE
        await screenshot('badge-states'); // CHANGE
        win.webContents.focus(); win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Tab' }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Tab' }); // CHANGE
        await evaluate('document.querySelector("[data-cell-id=badge-both]").focus();void 0;'); // CHANGE
        assert.equal(await evaluate('document.activeElement.matches("[data-cell-id=badge-both]:focus-visible")'), true, 'the native keyboard focus indicator remains available'); // CHANGE
        win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' }); win.webContents.sendInputEvent({ type: 'char', keyCode: '\r' }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' }); // CHANGE
        await until('!!document.querySelector("[data-collaboration-object-id=badge-both]")&&document.querySelector("[data-cell-id=badge-both]").getAttribute("aria-expanded")==="true"', 'Enter to open the badge panel'); // CHANGE
        win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Space' }); win.webContents.sendInputEvent({ type: 'char', keyCode: ' ' }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Space' }); // CHANGE
        await until('!document.querySelector("[data-collaboration-object-id=badge-both]")&&document.querySelector("[data-cell-id=badge-both]").getAttribute("aria-expanded")==="false"', 'Space to close the badge panel'); // CHANGE
        await verifyManipulationSizing(win, evaluate, until); // NEW: validate observer behavior before invoking the independent native printing service.
        let pdfPages = null; // CHANGE
        if (!process.argv.includes('--projection-only')) { // CHANGE: independently verify render projections when the host printing service is unavailable.
            stage = 'native PDF printing'; const pdf = await exportWindow.webContents.printToPDF({ printBackground: true }); fs.writeFileSync(path.join(output, 'details.pdf'), pdf); // CHANGE
            const parsed = await PDFDocument.load(pdf); pdfPages = parsed.getPageCount(); assert.ok(pdfPages >= 2); // CHANGE
        } // CHANGE
        stage = 'controller teardown and normal label editing'; // NEW
        await evaluate('graph.__trellisObjectDetails.destroy();void 0;'); // NEW
        assert.equal(await evaluate('ui.isSelectionAllowed===originalSelectionAllowed'), true, 'teardown restores the original host selection hook'); // NEW
        assert.equal(await evaluate('ui.isSelectionAllowed({target:graph.container})'), false); // NEW
        await evaluate('graph.startEditingAtCell(a);void 0;'); // NEW
        await until('!!graph.cellEditor.textarea&&document.activeElement===graph.cellEditor.textarea', 'normal label editor after details teardown'); // NEW
        for (const character of 'Label input restored') win.webContents.sendInputEvent({ type: 'char', keyCode: character }); // NEW
        await until('graph.cellEditor.textarea.textContent==="Label input restored"', 'native label typing after details teardown'); // NEW
        await evaluate('ui.toolbar.container.replaceChildren();ui.toolbar.createTextToolbar();selectText(graph.cellEditor.textarea);void 0;'); // NEW
        await clickElement('.geToolbarContainer [title="Bulleted List"]'); // NEW
        await until('!!graph.cellEditor.textarea.querySelector("ul > li")', 'the shared bullet button to format a native shape label'); // NEW
        await evaluate('graph.stopEditing(false);void 0;'); // NEW
        assert.match(await evaluate('a.getAttribute("label")'), /<ul><li>Label input restored<\/li><\/ul>/); // CHANGE: the ordinary label persists native bullet HTML.
        console.log('OBJECT_DETAILS_RESULT:' + JSON.stringify({ ok: true, supported, position, pdfPages, screenshots: output })); // CHANGE
        exportWindow.destroy(); win.destroy(); app.exit(0); // NEW
    } catch (error) { // NEW
        console.error(error.stack || error); // NEW
        try { console.error('DETAILS_POINTER:' + JSON.stringify(await evaluate('window.lastDrag'))); } catch (_) { /* Pointer diagnostics must not hide the original failure. */ } // NEW
        if (exportWindow) try { console.error('DETAILS_EXPORT_STATE:' + JSON.stringify(await exportWindow.webContents.executeJavaScript('({text:document.body.textContent.slice(-1000),fonts:document.fonts.status,ready:!!document.getElementById("LoadingComplete"),cells:Object.keys(window.exportGraph?.model.cells||{}),bounds:document.getElementById("graph")?.getBoundingClientRect().toJSON()})'))); } catch (_) { /* Export diagnostics are best effort. */ } // NEW
        try { console.error('DETAILS_STATE:' + JSON.stringify(await evaluate('({html:window.field?.innerHTML,panels:[...document.querySelectorAll(".trellis-object-details")].map(panel=>({id:panel.dataset.collaborationObjectId,status:panel.querySelector("[role=status]").textContent,html:panel.querySelector(".trellis-object-details-editor").innerHTML})),toolbar:[...document.getElementById("toolbar").children].map(node=>node.title||node.textContent),focus:document.activeElement?.className,activeTarget:ui.getActiveRichTextTarget?.()?.cell.id,selection:getSelection().toString()})'))); await screenshot('failure'); } catch (_) { /* Preserve the original failure if rendering has stopped. */ } // CHANGE
        if (exportWindow) exportWindow.destroy(); win.destroy(); app.exit(1); // NEW
    } // NEW
}); // NEW
