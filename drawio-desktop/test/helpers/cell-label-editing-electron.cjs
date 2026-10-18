/** Verify native Chromium typing, caret continuity and painting in an isolated hidden window. */ // NEW
const assert = require('node:assert/strict'); // NEW
const fs = require('node:fs'); // NEW
const path = require('node:path'); // NEW
const { app, BrowserWindow } = require('electron'); // NEW
const project = path.resolve(__dirname, '../..'), webapp = path.join(project, 'drawio/src/main/webapp'); // NEW
const output = path.join(project, '.test-artifacts/cell-label-editing', String(process.pid)); // NEW
app.disableHardwareAcceleration(); app.commandLine.appendSwitch('in-process-gpu'); // NEW
app.setPath('userData', fs.mkdtempSync(path.join(app.getPath('temp'), 'trellis-label-editing-'))); // NEW
const delay = ms => new Promise(resolve => setTimeout(resolve, ms)); // NEW

app.whenReady().then(async () => { // NEW
    const win = new BrowserWindow({ show: false, width: 1000, height: 720, webPreferences: { sandbox: false, backgroundThrottling: false } }); // NEW: match the repository's existing isolated Chromium helpers.
    const evaluate = source => win.webContents.executeJavaScript(source); // NEW
    async function snapshot(name) { // NEW
        await delay(60); fs.mkdirSync(output, { recursive: true }); // NEW
        fs.writeFileSync(path.join(output, name + '.png'), (await win.webContents.capturePage()).toPNG()); // NEW
    } // NEW
    function type(text) { for (const character of text) win.webContents.sendInputEvent({ type: 'char', keyCode: character }); } // NEW
    /** Observe readiness or native input delivery without repairing focus, selection or text. */ // CHANGE
    async function waitFor(source, description) { // CHANGE
        const deadline = Date.now() + 2000; let timer; // CHANGE
        try { // CHANGE
            const ready = await Promise.race([ // CHANGE: bound stalled renderer evaluation as well as the polling loop.
                (async () => { while (Date.now() < deadline) { if (await evaluate(source)) return true; await delay(20); } return false; })(), // CHANGE
                new Promise(resolve => { timer = setTimeout(() => resolve(false), 2000); }) // CHANGE
            ]); // CHANGE
            assert.equal(ready, true, description + ' must complete within 2000 ms'); // CHANGE
        } finally { clearTimeout(timer); } // CHANGE
    } // CHANGE
    try { // NEW
        await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<!doctype html><html><body style="margin:0;background:white"><div id="graph" style="position:relative;width:100vw;height:100vh;overflow:hidden"></div></body></html>')); // NEW
        await evaluate('window.mxLoadResources=false;window.mxLoadStylesheets=false;window.urlParams={};'); // NEW
        await evaluate(fs.readFileSync(path.join(webapp, 'js/app.min.js'), 'utf8') + '\n;void 0;'); // NEW
        await evaluate(` // NEW
            const style=document.createElement('style');style.textContent=${JSON.stringify(fs.readFileSync(path.join(webapp, 'mxgraph/css/common.css'), 'utf8') + '\n' + fs.readFileSync(path.join(webapp, 'styles/grapheditor.css'), 'utf8'))};document.head.appendChild(style); // NEW
            window.graph=new Graph(document.getElementById('graph')); // NEW
            window.nativeInputEvents=[]; // CHANGE: retain native delivery and focus observations for a failing run.
            for(const type of ['beforeinput','input','focusin','focusout'])document.addEventListener(type,event=>nativeInputEvents.push({type:event.type,data:event.data??null,inputType:event.inputType??null,target:event.target.nodeName,text:event.target.textContent}),true); // CHANGE
            graph.view.getCanvas().ownerSVGElement.style.position='absolute'; // NEW: reproduce EditorUi's SVG root positioning in this graph-only host.
            window.ui={editor:{graph},menus:{get:()=>null},actions:{get:()=>null}}; // NEW
            window.Draw={loadPlugin:fn=>fn(ui)}; void 0; // NEW
        `); // NEW
        for (const name of ['Trellis_UI_Cleanup.js', 'Garden_Roadmap_Core.js', 'Garden_Roadmap_Manager.js']) { // NEW
            await evaluate(fs.readFileSync(path.join(webapp, 'plugins/garden_planner_plugins', name), 'utf8') + '\n;void 0;'); // NEW
        } // NEW
        await evaluate(` // NEW
            window.cell=graph.insertVertex(null,'ordinary','Serve 1 year, get acclimated',160,180,460,170,'rounded=1;whiteSpace=wrap;html=1;fontSize=28;'); // NEW
            graph.insertVertex(null,'other','Unrelated label remains visible',160,420,460,90,'whiteSpace=wrap;html=1;fontSize=22;'); void 0; // NEW
        `); await delay(100); // NEW
        win.webContents.focus(); // NEW: hidden test windows still need their web contents focused for native input dispatch.
        await evaluate('graph.setSelectionCell(cell);graph.startEditingAtCell(cell);void 0;'); // CHANGE
        await waitFor('!!graph.cellEditor.textarea && document.activeElement===graph.cellEditor.textarea', 'Initial editor readiness'); // CHANGE
        type('Draft text'); await waitFor('graph.cellEditor.textarea?.textContent === "Draft text"', 'Initial native typing'); // CHANGE
        const before = await evaluate(`(() => { window.activeDraft=graph.cellEditor.textarea;const selection=getSelection();window.savedCaret={node:selection.anchorNode,offset:selection.anchorOffset};return {draft:activeDraft.textContent,focused:document.activeElement===activeDraft,labelHidden:getComputedStyle(graph.view.getState(cell).text.node).visibility};})()`); // NEW
        assert.deepEqual(before, { draft: 'Draft text', focused: true, labelHidden: 'hidden' }); // NEW
        await snapshot('typing'); // NEW
        const refreshed = await evaluate(`(() => {for(let i=0;i<3;i++)graph.refresh();const selection=getSelection();return {sameEditor:graph.cellEditor.textarea===activeDraft,focused:document.activeElement===activeDraft,sameCaret:selection.anchorNode===savedCaret.node&&selection.anchorOffset===savedCaret.offset,labelHidden:getComputedStyle(graph.view.getState(cell).text.node).visibility,otherVisible:getComputedStyle(graph.view.getState(graph.model.getCell('other')).text.node).visibility};})()`); // NEW
        assert.deepEqual(refreshed, { sameEditor: true, focused: true, sameCaret: true, labelHidden: 'hidden', otherVisible: 'visible' }); // NEW
        assert.equal(await evaluate('(() => {const r=activeDraft.getBoundingClientRect(),s=graph.view.getState(cell);return r.left>=s.x&&r.right<=s.x+s.width+2&&r.top>=s.y&&r.bottom<=s.y+s.height;})()'), true, 'the native draft must remain inside its shape'); // NEW
        type(' continues'); await waitFor('activeDraft.textContent === "Draft text continues"', 'Native typing after refresh'); // CHANGE: never refocus, reposition the caret or resend dropped input.
        assert.equal(await evaluate('activeDraft.textContent'), 'Draft text continues'); // NEW
        assert.equal(await evaluate('graph.cellEditor.textarea===activeDraft && document.activeElement===activeDraft'), true, 'continued typing must preserve the focused editor'); // CHANGE
        await snapshot('after-refresh'); // NEW
        await evaluate('graph.stopEditing(false);void 0;'); await delay(50); // NEW
        assert.equal(await evaluate('cell.value'), 'Draft text continues'); // NEW
        assert.equal(await evaluate('getComputedStyle(graph.view.getState(cell).text.node).visibility'), 'visible'); // NEW
        await snapshot('committed'); // NEW
        await evaluate('graph.startEditingAtCell(cell);void 0;'); // CHANGE
        await waitFor('!!graph.cellEditor.textarea && document.activeElement===graph.cellEditor.textarea', 'Cancellation editor readiness'); // CHANGE
        type('Cancelled draft'); await waitFor('graph.cellEditor.textarea?.textContent === "Cancelled draft"', 'Cancelled native draft typing'); // CHANGE
        await evaluate('graph.refresh();graph.stopEditing(true);void 0;'); await delay(50); // NEW
        assert.equal(await evaluate('cell.value'), 'Draft text continues'); // NEW
        assert.equal(await evaluate('getComputedStyle(graph.view.getState(cell).text.node).visibility'), 'visible'); // NEW
        await snapshot('cancelled'); // NEW
        console.log('LABEL_EDITING_RESULT:' + JSON.stringify({ ok: true, before, refreshed, screenshots: output })); // NEW
        win.destroy(); app.exit(0); // NEW
    } catch (error) { // CHANGE: preserve the original failure even if renderer inspection or capture is unavailable.
        console.error(error.stack || error); // CHANGE
        try { // CHANGE
            const diagnostics = await Promise.race([evaluate(`(() => { // CHANGE
                const editor=window.graph?.cellEditor,draft=editor?.textarea||window.activeDraft,selection=getSelection(); // CHANGE
                const describe=node=>node?{name:node.nodeName,type:node.nodeType,text:node.textContent,id:node.id||null,className:node.getAttribute?.('class')||null}:null; // CHANGE
                return {text:draft?.textContent??null,html:draft?.innerHTML??null,codePoints:Array.from(draft?.textContent||'',character=>'U+'+character.codePointAt(0).toString(16).toUpperCase().padStart(4,'0')),sameEditor:!!draft&&editor?.textarea===window.activeDraft,connected:draft?.isConnected??false,editingCellId:editor?.editingCell?.id??null,activeElement:describe(document.activeElement),focused:!!draft&&document.activeElement===draft,selection:{anchor:describe(selection.anchorNode),anchorOffset:selection.anchorOffset,focus:describe(selection.focusNode),focusOffset:selection.focusOffset,collapsed:selection.isCollapsed,sameCaret:!!window.savedCaret&&selection.anchorNode===savedCaret.node&&selection.anchorOffset===savedCaret.offset},inputEvents:window.nativeInputEvents||[]}; // CHANGE
            })()`), delay(1000).then(() => ({ error: 'Renderer diagnostics timed out' }))]); // CHANGE
            console.error('LABEL_EDITING_DIAGNOSTICS:' + JSON.stringify({ ...diagnostics, webContentsFocused: win.webContents.isFocused(), screenshots: output })); // CHANGE
        } catch (diagnosticError) { console.error('LABEL_EDITING_DIAGNOSTICS_ERROR:' + String(diagnosticError)); } // CHANGE
        try { await Promise.race([snapshot('failure'), delay(1000)]); } // CHANGE: a screenshot is best-effort and cannot postpone failure indefinitely.
        catch (captureError) { console.error('LABEL_EDITING_SCREENSHOT_ERROR:' + String(captureError)); } // CHANGE
        win.destroy(); app.exit(1); // CHANGE
    } // CHANGE
}); // NEW
