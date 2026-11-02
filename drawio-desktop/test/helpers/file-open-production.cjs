/** Native Browse/IPC, stacked ErrorDialog, keyboard focus and two-page document regression. */ // NEW
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'); // NEW

module.exports = async function fileOpenProduction({ window, until, profile, project, output, select }) { // NEW
    const run = source => window.webContents.executeJavaScript(source, true); // NEW
    const wait = (source, label) => until(() => run(source), label, 20000); // NEW
    const directory = path.join(profile, 'file-open-fixtures'); fs.mkdirSync(directory, { recursive: true }); // NEW
    const external = path.join(directory, 'ecosystem-and-experience.drawio'), malformed = path.join(directory, 'malformed.drawio'); // NEW
    const generated = path.join(project, 'docs/diagrams/trellis-ecosystem-and-experience.drawio'); // NEW
    if (fs.existsSync(generated)) fs.copyFileSync(generated, external); // NEW: exercise the reported file from an allowed user-document location.
    else fs.writeFileSync(external, '<mxfile><diagram id="one" name="First"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel></diagram><diagram id="two" name="Second"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel></diagram></mxfile>'); // NEW: retain two-page coverage if documentation artifacts are absent.
    fs.writeFileSync(malformed, '<mxfile><diagram><bad/></diagram></mxfile>'); // NEW
    await run(`smokeUi.pickFile();void 0;`); // NEW
    await wait(`!!smokeUi.__trellisGardenHome.projectsRoot?.isConnected`, 'file-open project library'); // NEW
    select([external]); // NEW
    await run(`window.browseButton=()=>[...smokeUi.__trellisGardenHome.projectsRoot.querySelectorAll('button')].find(button=>button.textContent==='Browse files…');browseButton().click();void 0;`); // NEW
    await wait(`!smokeUi.openingFile&&smokeUi.getCurrentFile()?.fileObject?.path===${JSON.stringify(external)}&&!smokeUi.__trellisGardenHome.projectsRoot.isConnected`, 'external two-page diagram opens'); // NEW
    assert.equal(await run('smokeUi.pages.length'), 2); // NEW
    await run('smokeUi.editor.graph.__trellisQuickstart?.close();void 0;'); // NEW: dismiss the unrelated first-open tutorial in this isolated dialog regression.
    await run(`window.openFileBeforeFailure=smokeUi.getCurrentFile();window.pageNamesBeforeFailure=smokeUi.pages.map(page=>page.getName());smokeUi.pickFile();void 0;`); // NEW
    await wait(`!!smokeUi.__trellisGardenHome.projectsRoot?.isConnected`, 'library over open diagram'); // NEW
    await run(`window.failureLibrary=smokeUi.__trellisGardenHome.projectsRoot;window.failureBrowse=browseButton();window.dialogDepthBeforeFailure=smokeUi.dialogs.length;const state=smokeUi.__trellisGardenHome;state.searchControl.value='retain my search';state.searchControl.dispatchEvent(new Event('input'));const spacer=document.createElement('div');spacer.style.height='1200px';state.projectsBody.append(spacer);state.projectsBody.scrollTop=180;window.scrollBeforeFailure=state.projectsBody.scrollTop;void 0;`); // NEW: ensure scroll preservation is tested with real overflow.
    await run(`new Promise((resolve,reject)=>openFileBeforeFailure.save(false,resolve,reject))`); // NEW: persist first-open plugin metadata in the disposable copy before testing navigation failures.
    await wait('!openFileBeforeFailure.isModified()&&!openFileBeforeFailure.savingFile', 'external diagram metadata saved'); // NEW
    const cases = [ // NEW
        { name: 'protected', filename: fs.existsSync(generated) ? generated : path.join(project, 'package.json'), message: 'This file is inside Trellis’s application folder. Copy it to Documents or another folder, then open the copy.' }, // NEW
        { name: 'missing', filename: path.join(directory, 'missing.drawio'), message: 'ENOENT' }, // NEW
        { name: 'malformed', filename: malformed, message: 'invalid diagram page' } // NEW
    ]; // NEW
    for (const example of cases) { // NEW
        select([example.filename]); await run('failureBrowse.focus({preventScroll:true});failureBrowse.click();void 0;'); // CHANGE: setting up keyboard focus must not itself move the scroll position under test.
        await wait(`smokeUi.dialogs.length===dialogDepthBeforeFailure+1&&smokeUi.dialog.container.textContent.includes('Couldn’t open this file')`, example.name + ' opening error dialog').catch(async error => { // CHANGE: retain native state if another dialog or navigation interrupts the expected error.
            console.error('FILE_OPEN_FAILURE', await run(`JSON.stringify({depth:smokeUi.dialogs.length,expected:dialogDepthBeforeFailure+1,dialogs:smokeUi.dialogs.map(dialog=>dialog.container.textContent.slice(0,1500)),browseConnected:failureBrowse.isConnected,browseDisabled:failureBrowse.disabled,library:failureLibrary.isConnected,status:smokeUi.__trellisGardenHome.projectsStatus.textContent,modified:smokeUi.getCurrentFile()?.isModified()})`)); throw error; // NEW
        }); // CHANGE
        const observed = await run(`({message:smokeUi.dialog.container.textContent,sameFile:smokeUi.getCurrentFile()===openFileBeforeFailure,library:failureLibrary.isConnected,search:smokeUi.__trellisGardenHome.searchControl.value,scroll:smokeUi.__trellisGardenHome.projectsBody.scrollTop,pages:smokeUi.pages.map(page=>page.getName())})`); // NEW
        assert.ok(observed.message.includes(example.message), observed.message); assert.equal(observed.sameFile, true); assert.equal(observed.library, true); assert.equal(observed.search, 'retain my search'); assert.equal(observed.scroll, await run('scrollBeforeFailure')); assert.deepEqual(observed.pages, await run('pageNamesBeforeFailure')); // NEW
        if (example.name === 'protected') { await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true }); await new Promise(resolve => setTimeout(resolve, 150)); fs.writeFileSync(path.join(output, 'file-open-protected-error.png'), (await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG()); } // NEW
        assert.equal(await run('smokeUi.dialog.container.contains(document.activeElement)'), true); // NEW
        window.webContents.focus(); window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' }); window.webContents.sendInputEvent({ type: 'char', keyCode: '\r' }); window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' }); // CHANGE: send the same complete Enter sequence used by the existing native form tests.
        await wait('smokeUi.dialogs.length===dialogDepthBeforeFailure&&document.activeElement===failureBrowse', example.name + ' error dismissal returns to Browse').catch(async error => { console.error('FILE_OPEN_DISMISSAL', await run(`JSON.stringify({depth:smokeUi.dialogs.length,expected:dialogDepthBeforeFailure,active:document.activeElement?.outerHTML,button:failureBrowse.outerHTML,connected:failureBrowse.isConnected,dialogs:smokeUi.dialogs.map(dialog=>dialog.container.textContent.slice(0,300))})`)); throw error; }); // CHANGE
        assert.equal(await run('smokeUi.__trellisGardenHome.projectsBody.scrollTop===scrollBeforeFailure'), true); // NEW
    } // NEW
    select([]); await run('failureBrowse.click();void 0;'); await new Promise(resolve => setTimeout(resolve, 250)); // NEW
    assert.equal(await run('smokeUi.dialogs.length===dialogDepthBeforeFailure&&smokeUi.getCurrentFile()===openFileBeforeFailure&&failureLibrary.isConnected'), true); // NEW
    await run(`failureLibrary.querySelector('input[aria-label="Search garden projects"]').value='';smokeUi.hideDialog();void 0;`); // NEW
}; // NEW
