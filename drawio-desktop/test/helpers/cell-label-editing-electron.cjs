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
    try { // NEW
        await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<!doctype html><html><body style="margin:0;background:white"><div id="graph" style="position:relative;width:100vw;height:100vh;overflow:hidden"></div></body></html>')); // NEW
        await evaluate('window.mxLoadResources=false;window.mxLoadStylesheets=false;window.urlParams={};'); // NEW
        await evaluate(fs.readFileSync(path.join(webapp, 'js/app.min.js'), 'utf8') + '\n;void 0;'); // NEW
        await evaluate(` // NEW
            const style=document.createElement('style');style.textContent=${JSON.stringify(fs.readFileSync(path.join(webapp, 'mxgraph/css/common.css'), 'utf8') + '\n' + fs.readFileSync(path.join(webapp, 'styles/grapheditor.css'), 'utf8'))};document.head.appendChild(style); // NEW
            window.graph=new Graph(document.getElementById('graph')); // NEW
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
        await evaluate('graph.setSelectionCell(cell);graph.startEditingAtCell(cell);void 0;'); await delay(50); // NEW
        type('Draft text'); await delay(50); // NEW
        const before = await evaluate(`(() => { window.activeDraft=graph.cellEditor.textarea;const selection=getSelection();window.savedCaret={node:selection.anchorNode,offset:selection.anchorOffset};return {draft:activeDraft.textContent,focused:document.activeElement===activeDraft,labelHidden:getComputedStyle(graph.view.getState(cell).text.node).visibility};})()`); // NEW
        assert.deepEqual(before, { draft: 'Draft text', focused: true, labelHidden: 'hidden' }); // NEW
        await snapshot('typing'); // NEW
        const refreshed = await evaluate(`(() => {for(let i=0;i<3;i++)graph.refresh();const selection=getSelection();return {sameEditor:graph.cellEditor.textarea===activeDraft,focused:document.activeElement===activeDraft,sameCaret:selection.anchorNode===savedCaret.node&&selection.anchorOffset===savedCaret.offset,labelHidden:getComputedStyle(graph.view.getState(cell).text.node).visibility,otherVisible:getComputedStyle(graph.view.getState(graph.model.getCell('other')).text.node).visibility};})()`); // NEW
        assert.deepEqual(refreshed, { sameEditor: true, focused: true, sameCaret: true, labelHidden: 'hidden', otherVisible: 'visible' }); // NEW
        assert.equal(await evaluate('(() => {const r=activeDraft.getBoundingClientRect(),s=graph.view.getState(cell);return r.left>=s.x&&r.right<=s.x+s.width+2&&r.top>=s.y&&r.bottom<=s.y+s.height;})()'), true, 'the native draft must remain inside its shape'); // NEW
        type(' continues'); await delay(50); // NEW
        assert.equal(await evaluate('activeDraft.textContent'), 'Draft text continues'); // NEW
        await snapshot('after-refresh'); // NEW
        await evaluate('graph.stopEditing(false);void 0;'); await delay(50); // NEW
        assert.equal(await evaluate('cell.value'), 'Draft text continues'); // NEW
        assert.equal(await evaluate('getComputedStyle(graph.view.getState(cell).text.node).visibility'), 'visible'); // NEW
        await snapshot('committed'); // NEW
        await evaluate('graph.startEditingAtCell(cell);void 0;'); await delay(50); type('Cancelled draft'); await delay(50); // NEW
        await evaluate('graph.refresh();graph.stopEditing(true);void 0;'); await delay(50); // NEW
        assert.equal(await evaluate('cell.value'), 'Draft text continues'); // NEW
        assert.equal(await evaluate('getComputedStyle(graph.view.getState(cell).text.node).visibility'), 'visible'); // NEW
        await snapshot('cancelled'); // NEW
        console.log('LABEL_EDITING_RESULT:' + JSON.stringify({ ok: true, before, refreshed, screenshots: output })); // NEW
        win.destroy(); app.exit(0); // NEW
    } catch (error) { console.error(error.stack || error); win.destroy(); app.exit(1); } // NEW
}); // NEW
