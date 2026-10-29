/** Exercise first-attempt creation, readiness delays, retry, history and reopening through the actual production UI. */ // NEW
const assert = require('node:assert/strict'); // NEW
const fs = require('node:fs'); // NEW
module.exports = async function firstOpen({ window, until }) { // NEW
    const run = source => window.webContents.executeJavaScript(source, true); // NEW
    const wait = (source, label) => until(() => run(source), label, 20000); // NEW
    await run(`trellisIdentity.create({username:'First Open',password:'first-open-test-password'}).then(()=>true)`); // NEW
    await wait(`document.querySelector('.trellis-splash-login-status')?.textContent==='Logged in as First Open'`, 'first-open identity'); // NEW
    for (const [index, mode] of ['delayed', 'warm', 'retry'].entries()) { // NEW
        await run(`while(smokeUi.dialogs?.length)smokeUi.hideDialog();smokeUi.pickFile();void 0;`); // NEW
        await wait(`!!smokeUi.__trellisGardenHome.privateRows?.querySelector('.trellis-home-form') || [...document.querySelectorAll('button')].some(button=>button.textContent==='Create New Private Garden Project'&&!button.disabled)`, 'private project creation controls'); // NEW
        if (mode === 'delayed') await run(`window.firstOpenReady=Trellis.sharing.whenDocumentReady;window.firstOpenGate=new Promise(resolve=>window.releaseFirstOpen=resolve);Trellis.sharing.whenDocumentReady=()=>firstOpenGate.then(()=>firstOpenReady());void 0;`); // NEW
        if (mode === 'retry') await run(`window.firstOpenFactory=smokeUi.editor.graph.__trellisModules.createModuleAtPoint;smokeUi.editor.graph.__trellisModules.createModuleAtPoint=function(){this.createModuleAtPoint=firstOpenFactory;throw new Error('Injected starter failure');};void 0;`); // NEW
        const name = 'First open ' + mode; // NEW
        await run(`(()=>{const root=smokeUi.__trellisGardenHome.projectsRoot;[...root.querySelectorAll('button')].find(button=>button.textContent==='Create New Private Garden Project').click();root.querySelector('input[aria-label="Project name"]').value=${JSON.stringify(name)};root.querySelector('form').requestSubmit();root.querySelector('form')?.requestSubmit();})()`); // NEW
        if (mode === 'delayed') { // NEW
            await wait(`!!smokeUi.getCurrentFile()?.fileObject?.path?.includes('First open delayed')`, 'created project opens while readiness is delayed'); // NEW
            assert.equal(await run(`Object.values(smokeUi.editor.graph.model.cells).filter(cell=>cell.getAttribute?.('garden_module')==='1').length`), 0); // NEW
            await run(`Trellis.sharing.whenDocumentReady=firstOpenReady;releaseFirstOpen();void 0;`); // NEW
        } // NEW
        if (mode === 'retry') { // NEW
            await wait(`[...document.querySelectorAll('button')].some(button=>button.textContent==='Retry opening created project')`, 'recoverable first attempt'); // NEW
            assert.equal(await run(`trellisGardenLibrary.list().then(result=>result.gardens.length)`), index + 1); // NEW
            await run(`window.firstOpenRecovery=document.querySelector('.trellis-home-open');[...firstOpenRecovery.querySelectorAll('button')].find(button=>button.textContent==='Retry opening created project').click();void 0;`); // NEW
            await wait(`!firstOpenRecovery.isConnected`, 'retry opens the existing project'); // NEW
        } // NEW
        await wait(`(()=>{const error=document.querySelector('.trellis-home-open');if(error)throw new Error(error.textContent);return !smokeUi.__trellisGardenHome.creating&&!smokeUi.getCurrentFile()?.__trellisSaveBatch&&Object.values(smokeUi.editor.graph.model.cells).some(cell=>cell.getAttribute?.('garden_module')==='1');})()`, 'complete starter cluster on first opening'); // NEW
        await run(`Trellis.history.refresh().then(()=>Trellis.history.flushForSharing()).then(()=>true)`); // NEW
        await wait(`!!smokeUi.editor.graph.__ccHistoryStorage && Number.isFinite(smokeUi.editor.graph.__ccHistoryStorage.historyBytes)`, 'initialized native history'); // NEW
        const state = await run(`(()=>{const graph=smokeUi.editor.graph,file=smokeUi.getCurrentFile();return {counts:['garden_module','team_module','task_module','roadmap_module'].map(flag=>Object.values(graph.model.cells).filter(cell=>cell.getAttribute?.(flag)==='1').length),path:file.fileObject.path,conflict:!!file.inConflictState,history:Trellis.history.list().length,size:graph.__ccDiagramStorageBytes,warning:graph.__ccHistoryWarning||'',status:smokeUi.editor.getStatus()};})()`); // NEW
        assert.deepEqual(state.counts, [1, 1, 1, 1]); assert.equal(state.conflict, false); assert.ok(state.history > 0); assert.ok(state.size > 0); assert.equal(state.warning, ''); // NEW
        assert.doesNotMatch(state.status, /file has been modified|Shared history export failed/i); // NEW
        const projects = await run(`trellisGardenLibrary.list().then(result=>result.gardens.map(entry=>({name:entry.projectName||entry.name,pending:entry.starterPending,path:entry.path})))`); // NEW
        assert.equal(projects.length, index + 1); assert.equal(projects.find(entry => entry.path === state.path).pending, false); // NEW
        await run(`while(smokeUi.dialogs?.length)smokeUi.hideDialog();new Promise((resolve,reject)=>smokeUi.getCurrentFile().save(false,()=>resolve(true),reject))`); // NEW
        await run(`smokeUi.fileLoaded(null,true).then(()=>TrellisGardenHome.openPath(smokeUi,${JSON.stringify(state.path)})).then(()=>Trellis.sharing.whenDocumentReady()).then(()=>Trellis.history.refresh()).then(()=>true)`); // NEW
        assert.deepEqual(await run(`['garden_module','team_module','task_module','roadmap_module'].map(flag=>Object.values(smokeUi.editor.graph.model.cells).filter(cell=>cell.getAttribute?.(flag)==='1').length)`), [1, 1, 1, 1]); // NEW
        if (mode === 'delayed') { // NEW: exercise the real watcher and status event delegation against this fixture's saved file.
            const accepted = fs.readFileSync(state.path, 'utf8'); fs.writeFileSync(state.path, accepted + '\n<!-- External test edit -->'); // NEW
            await wait(`!!smokeUi.statusContainer.querySelector('[data-action="statusFunction"] button')`, 'external modification recovery notice'); // NEW
            window.webContents.focus(); await run(`smokeUi.statusContainer.querySelector('[data-action="statusFunction"] button').focus();void 0;`); // NEW
            window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' }); window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' }); // NEW
            await wait(`!!document.querySelector('.trellis-collaboration-dialog [aria-label="Canvas collaboration"]')`, 'keyboard activation opens current project sharing'); // NEW
            assert.equal(fs.readFileSync(state.path, 'utf8'), accepted); // NEW: unexpected bytes were preserved, never imported as accepted project content.
            await run(`[...document.querySelector('.trellis-collaboration-dialog').querySelectorAll('button')].find(button=>button.textContent==='Close').click();void 0;`); // NEW
        } // NEW
    } // NEW
}; // NEW
