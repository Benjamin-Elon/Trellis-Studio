/** Smoke the real main process, preload, index, plugin loader, and home controls in an isolated profile. */ // NEW
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { app, BrowserWindow, dialog, session } = require('electron'); // CHANGE
const childProcess = require('node:child_process'), { syncBuiltinESMExports } = require('node:module'); // NEW
const ownedChildren = new Set(), originalSpawn = childProcess.spawn; // NEW
childProcess.spawn = (...args) => { const child = originalSpawn(...args); if (child.pid != null) ownedChildren.add(child); child.once('exit', () => ownedChildren.delete(child)); child.once('close', () => ownedChildren.delete(child)); return child; }; syncBuiltinESMExports(); // NEW: the isolated helper records actual owned handles for emergency cleanup.
const project = path.resolve(__dirname, '../..');
const physicalMode = process.env.TRELLIS_PHYSICAL_ANDROID_TEST === '1'; // NEW
const diagnosticMode = process.env.TRELLIS_TEST_DEBUG === '1'; if (diagnosticMode) app.commandLine.appendSwitch('remote-debugging-port', '9223'); // NEW: expose only this isolated test window for bounded failure inspection.
const output = path.join(project, '.test-artifacts', 'garden-home-production', String(process.pid)); // CHANGE: each run has independent Chromium database locks.
const resume = physicalMode && process.env.TRELLIS_PHYSICAL_RESUME === '1' ? JSON.parse(fs.readFileSync(path.join(project, '.test-artifacts/android-physical/control.json'), 'utf8')) : null; // NEW
if (resume && (path.dirname(resume.profile) !== require('node:os').tmpdir() || !path.basename(resume.profile).startsWith('trellis-garden-home-production-'))) throw new Error('Resume requires the isolated test profile.'); // NEW
const profile = resume?.profile || fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'trellis-garden-home-production-')); // CHANGE: resume only this helper's sample identity after a build or test interruption.
fs.mkdirSync(output, { recursive: true }); // NEW
for (const name of ['app-data', 'documents', 'session', 'user-data']) fs.mkdirSync(path.join(profile, name), { recursive: true }); // CHANGE
app.setPath('appData', path.join(profile, 'app-data')); // CHANGE
app.setPath('documents', path.join(profile, 'documents')); // CHANGE
app.setPath('userData', path.join(profile, 'user-data')); app.setPath('sessionData', path.join(profile, 'session')); // CHANGE
app.disableHardwareAcceleration(); app.commandLine.appendSwitch('in-process-gpu');
let window, smokeStage = "starting"; // CHANGE
app.on('browser-window-created', (_event, created) => { window = created; created.hide(); created.webContents.on('render-process-gone', (_event, details) => { console.error('Production renderer exited:', details.reason); void cleanup(1); }); created.webContents.on('did-fail-load', (_event, code, description) => console.error('Production load failed:', code, description)); created.webContents.setBackgroundThrottling(false); created.webContents.on('console-message', (_event, details, message) => { if ((details.level || details) === 'error' || details === 3) console.error('Renderer:', details.message || message); }); }); // CHANGE: a deliberately hidden test window must retain normal active-editor scheduling.
let controlServer = null, cleanupTask = null; // NEW
/** All test exit paths use production Quit before a last-resort bounded exit. */ // NEW
function cleanup(code) { // NEW
    if (cleanupTask) return cleanupTask; // NEW
    clearTimeout(timeout); clearInterval(parentControl); // CHANGE
    cleanupTask = (async () => { // NEW
        const emergency = setTimeout(() => { console.error('Production smoke cleanup exceeded its bound.'); for (const child of ownedChildren) if (child.exitCode == null && child.signalCode == null) child.kill('SIGKILL'); app.exit(code || 1); }, 16000); emergency.unref(); // NEW
        if (controlServer) { controlServer.closeAllConnections(); await new Promise(resolve => controlServer.close(resolve)); controlServer = null; } // NEW
        // Only this isolated fixture's documents are approved for discard during cleanup. // NEW
        const confirm = dialog.showMessageBoxSync; dialog.showMessageBoxSync = (...args) => args.at(-1)?.title === 'Confirm' ? 1 : confirm(...args); // NEW
        app.once('will-quit', event => { event.preventDefault(); clearTimeout(emergency); console.log('PRODUCTION_CLEANUP:', JSON.stringify({ code, ownedChildrenAlive: [...ownedChildren].filter(child => child.exitCode == null && child.signalCode == null).length })); app.exit(ownedChildren.size ? 1 : code); }); // NEW: resources have stopped before preserving the test result's exit code.
        app.quit(); // NEW
    })(); // NEW
    return cleanupTask; // NEW
} // NEW
function smokeTimeout() { console.error('Production smoke timed out at: ' + smokeStage); const snapshot = window?.webContents.executeJavaScript("({body:document.body.innerText.slice(0,2000),queued:window.App?.DrawPlugins?.length,callback:String(window.Draw?.loadPlugin).slice(0,300),status:document.querySelector('.trellis-splash-login-status')?.textContent})"); Promise.race([snapshot, new Promise(resolve => setTimeout(resolve, 2000))]).then(value => console.error('Smoke state:', JSON.stringify(value))).finally(() => cleanup(1)); } // CHANGE // NEW
const timeout = setTimeout(smokeTimeout, physicalMode ? 1800000 : 120000); // CHANGE
const stopFile = process.env.TRELLIS_SMOKE_STOP_FILE; // NEW
if (stopFile && (path.basename(stopFile) !== 'stop' || path.dirname(path.dirname(stopFile)) !== require('node:os').tmpdir() || !path.basename(path.dirname(stopFile)).startsWith('trellis-smoke-run-'))) throw new Error('Invalid parent smoke control path.'); // NEW
const parentControl = stopFile ? setInterval(() => { if (fs.existsSync(stopFile)) void cleanup(1); }, 200) : null; parentControl?.unref(); // NEW

/** Bound readiness waits so a broken production loading step reports its location. */ // NEW
async function until(check, label = 'renderer readiness') { // CHANGE
    smokeStage = label; console.log('SMOKE_STAGE:', label); // NEW // CHANGE
    const deadline = Date.now() + 180000; // CHANGE: this production loader can be delayed by unrelated external font requests.
    let result; while (!(result = await check())) { // CHANGE: return the same observed state rather than reading across an asynchronous redraw.
        if (Date.now() > deadline) throw new Error('Timed out waiting for ' + label); // NEW
        await new Promise(resolve => setTimeout(resolve, 200)); // CHANGE
    } // NEW
    return result; // NEW
}
/** The production profile remains untouched; this helper owns every artifact it creates. */ // NEW
async function run() {
    await app.whenReady(); // NEW
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => callback({ cancel: true })); // NEW: external resources cannot delay this isolated UI smoke.
    await import(pathToFileURL(path.join(project, 'src/main/electron.js')));
    await app.whenReady(); await until(async () => !!window, 'initial window creation'); // CHANGE: core script readiness below is independent of blocked external font loads.
    await until(() => window.webContents.executeJavaScript('!!window.Draw?.loadPlugin && !!window.TrellisGardenHome').catch(() => false), 'home scripts'); // CHANGE
    console.log('Production home scripts ready.'); // NEW
    smokeStage = 'editor plugin callback'; // NEW
    await window.webContents.executeJavaScript(`new Promise(resolve => Draw.loadPlugin(ui => { window.smokeUi = ui; resolve(); }));`);
    await window.webContents.executeJavaScript(`localStorage.setItem('trellis.licenseWizard.v2', JSON.stringify({ version: '2', path: 'personal', contactGuidance: false, oathCompletedAt: new Date().toISOString(), name: 'Smoke Test', signature: 'Smoke Test', email: 'smoke@example.test' })); smokeUi.hideDialog(); smokeUi.showSplash(true);`);
    const splash = await until(() => window.webContents.executeJavaScript(`(()=>{const panel=document.querySelector('.trellis-splash-login-status');return panel?.textContent==='Not logged in'?{controls:panel.textContent,afterLicense:panel.previousElementSibling.classList.contains('trellis-license-contact-panel'),installed:!!smokeUi.__trellisGardenHome,fieldInstalled:!!smokeUi.__trellisFieldRuntime}:false;})()`), 'logged-out splash status'); // CHANGE
    assert.equal(splash.controls, 'Not logged in'); // CHANGE
    assert.equal(splash.afterLicense, true); assert.equal(splash.installed, true); assert.equal(splash.fieldInstalled, true); // CHANGE
    if (process.env.TRELLIS_GARDEN_PROJECTS_TEST === '1') { await runProjectSmoke(); await cleanup(0); return; } // NEW
    if (resume) { // NEW
        await window.webContents.executeJavaScript(`(async()=>{await trellisIdentity.unlock({identityId:${JSON.stringify(resume.identityId)},password:'local-smoke-password'});window.smokeGarden=(await trellisGardenLibrary.list()).gardens.find(g=>g.name==='Production garden');if(!smokeGarden)throw new Error('Missing sample garden.');await TrellisGardenHome.openPath(smokeUi,smokeGarden.path);})()`); // NEW
        await until(() => window.webContents.executeJavaScript('!!Trellis?.users?.getCurrentUser()?.portableIdentityId'), 'restored sample login'); // NEW
        await preparePhysicalDesktop(false); return; // NEW
    } // NEW
    await window.webContents.executeJavaScript(`(async () => { window.smokeIdentity = await trellisIdentity.create({ username: 'Production Smoke', password: 'local-smoke-password' }); window.smokeGarden = await trellisGardenLibrary.create({ name: 'Production garden' }); await TrellisGardenHome.openPath(smokeUi, smokeGarden.path); })();`); // CHANGE
    await until(() => window.webContents.executeJavaScript('!!Trellis?.users?.getCurrentUser()?.portableIdentityId'));
    assert.equal(await window.webContents.executeJavaScript('Trellis.users.getCurrentUser().portableIdentityId === smokeIdentity.session.identityId'), true);
    if (process.env.TRELLIS_SMOKE_EXIT_MODE === 'failure') throw new Error('Injected production smoke failure after owned transport creation.'); // NEW
    if (process.env.TRELLIS_SMOKE_EXIT_MODE === 'timeout') { smokeTimeout(); return; } // NEW: exercise the real timeout cleanup without waiting two minutes.
    await window.webContents.executeJavaScript(`smokeUi.pickFile();`);
    await until(() => window.webContents.executeJavaScript("document.querySelector('.trellis-projects-root')?.textContent.includes('Production garden')"), 'project browser'); // CHANGE
    const opening = await window.webContents.executeJavaScript("Array.from(document.querySelectorAll('.trellis-projects-section h3')).map(node => node.textContent)"); // CHANGE
    assert.deepEqual(opening, ['Shared garden projects', 'Private garden projects']); // CHANGE
    await window.webContents.executeJavaScript("Array.from(document.querySelectorAll('.trellis-projects-root button')).find(b => b.textContent === 'Close').click();"); // CHANGE
    assert.equal(await window.webContents.executeJavaScript('smokeUi.getCurrentFile().fileObject.path === smokeGarden.path'), true);
    const field = await window.webContents.executeJavaScript(`(async () => { // NEW: real renderer commands, preview pixels, durable save, and acknowledgment publication.
        const graph = smokeUi.editor.graph, worker = Trellis.users.getCurrentUser();
        const value = attributes => { const node = mxUtils.createXmlDocument().createElement('object'); for (const [name, text] of Object.entries(attributes)) node.setAttribute(name, text); return node; };
        const garden = graph.insertVertex(null, 'smoke-garden', value({ garden_module: '1', label: 'Field preview' }), 400, 300, 600, 400, 'module=1;'); // CHANGE: exercise the real garden-module discovery path.
        const bed = graph.insertVertex(garden, 'smoke-bed', value({ garden_bed: '1', label: 'Blue bed' }), 40, 50, 120, 90, 'fillColor=#0000ff;strokeColor=none;'); // CHANGE
        const planting = graph.insertVertex(bed, 'smoke-planting-group', value({ tiler_group: '1', label: 'Blue planting group', plant_name: 'Lettuce', linkedTo: 'smoke-task' }), 10, 10, 90, 60, 'fillColor=#0000ff;strokeColor=none;'); // CHANGE: production task/group links are reciprocal.
        graph.insertVertex(garden, 'smoke-plant', value({ plant_tiler: '1', label: 'Red plant' }), 350, 210, 45, 45, 'fillColor=#ff0000;strokeColor=none;'); // CHANGE
        const unrelated = graph.insertVertex(garden, 'smoke-unrelated', value({ kanban_card: '1', title: 'Unrelated private instructions' }), 170, 50, 100, 90, 'fillColor=#00ff00;'); // NEW
        const role = graph.insertVertex(null, 'smoke-role', value({ trellis_role_user_id: worker.id }), 10, 300, 100, 60);
        const taskModule = graph.insertVertex(null, 'smoke-task-module', value({ task_module: '1', label: 'Field work' }), 10, 10, 600, 250); // CHANGE
        const template = graph.__trellisTaskManager.ensureMainBoardInTaskModule(taskModule), board = template.board, lane = template.lanes.TODO; // CHANGE: use the production template and every real workflow lane.
        const task = graph.insertVertex(lane, 'smoke-task', value({ kanban_card: '1', title: 'Water lettuce group', workflow_state: 'TODO', task_assignee_role_ids_json: JSON.stringify([role.id]), linkedTo: planting.id, start: '2026-10-01', end: '2026-10-01', assigned_day: '2026-10-01' }), 10, 10, 160, 100); // CHANGE
        graph.setSelectionCell(task);
        const previewChecks = [];
        for (const scale of [0.7, 1.4]) {
            graph.view.setScale(scale); graph.view.setTranslate(23, 17); graph.view.validate();
            const work = await Trellis.field.snapshot(true), preview = work.gardens.find(item => item.id === garden.value.getAttribute('trellis_field_object_id'));
            if (!preview) throw new Error('Missing garden preview.');
            if (preview.regions.some(region => region.id === unrelated.value.getAttribute('trellis_field_object_id'))) throw new Error('Preview contains unrelated task data.'); // NEW
            if (preview.width < 600 || preview.height < 400) throw new Error('Preview cropped the whole garden to a linked object.'); // NEW
            const region = preview.regions.find(item => item.id === planting.value.getAttribute('trellis_field_object_id')); // CHANGE
            if (region?.kind !== 'planting-group' || work.tasks.find(item=>item.title==='Water lettuce group').locations.join() !== region.id) throw new Error('Task highlights its bed instead of the linked planting group.'); // NEW
            const image = await new Promise((resolve, reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = reject; image.src = preview.png; });
            const canvas = document.createElement('canvas'); canvas.width = preview.width; canvas.height = preview.height; const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
            const pixel = [...context.getImageData(Math.floor(region.x + region.width * 0.25), Math.floor(region.y + region.height * 0.25), 1, 1).data];
            if (pixel[2] < 240 || pixel[0] > 20 || pixel[1] > 20) throw new Error('Preview region is misaligned: ' + JSON.stringify({ region, pixel, scale }));
            if (graph.getSelectionCell() !== task) throw new Error('Preview changed editor selection.');
            previewChecks.push({ scale, pixel, wholeGarden: true, plantingGroupLinked: true }); window.smokeWork = work; // CHANGE
        }
        graph.model.remove(unrelated); // NEW: the deliberately invalid privacy fixture must not keep triggering Task Manager's orphan placement during command/Undo checks.
        smokeUi.editor.undoManager.clear(); // CHANGE: save the stable task-board fixture after clearing its creation history.
        await new Promise((resolve, reject) => smokeUi.getCurrentFile().save(false, resolve, reject));
        await trellisField.publishWork({ work: smokeWork });
        const update = { schema: 1, kind: 'task-updates', diagramId: smokeWork.diagramId, workerId: worker.id, operations: [{ id: 'smoke-phone:1', taskId: task.value.getAttribute('trellis_field_object_id'), field: 'progress', value: { state: 'DONE', completedDay: '2026-09-30' }, version: { time: Date.now() + 1000, deviceId: 'smoke-phone', counter: 1 } }] };
        await trellisField.importUpdates({ updates: update }); // CHANGE
        const incomingDeadline = Date.now() + 30000; // NEW: the background poll can already own the processing guard when an import completes.
        while (task.value.getAttribute('workflow_state') !== 'DONE' && Date.now() < incomingDeadline) { // NEW
            if (smokeUi.getCurrentFile().isModified()) await new Promise((resolve, reject) => smokeUi.getCurrentFile().save(false, resolve, reject)); // NEW: only this fixture's delayed board normalization is saved here.
            await Trellis.field.processIncoming(); await new Promise(resolve => setTimeout(resolve, 100)); // NEW
        } // NEW
        if (task.value.getAttribute('workflow_state') !== 'DONE') throw new Error('Field command did not apply: ' + JSON.stringify({ state: task.value.getAttribute('workflow_state'), modified: smokeUi.getCurrentFile().isModified(), conflict:smokeUi.getCurrentFile().inConflictState,status:smokeUi.editor.status,taskId:task.value.getAttribute('trellis_field_object_id'),roleOwner:role.value.getAttribute('trellis_role_user_id'),worker:worker.id,packets:(await trellisField.pendingUpdates({diagramId:smokeWork.diagramId})).packages.length, acknowledgments: graph.getDefaultParent().value?.getAttribute?.('trellis_field_acknowledgments_json') })); // CHANGE: report only this fixture's public state when processing fails.
        if (task.value.getAttribute('start') !== '2026-10-01' || task.value.getAttribute('completed') !== '2026-09-30') throw new Error('Field update changed planned day or completion calendar day.');
        const saved = await new Promise((resolve, reject) => electron.request({ action: 'readFile', filename: smokeGarden.path, encoding: 'utf8' }, resolve, reject));
        const savedModel = mxUtils.getXml(Editor.extractGraphModel(mxUtils.parseXml(saved).documentElement)); // CHANGE: saved desktop files may contain compressed pages.
        if (!savedModel.includes('smoke-phone:1') || !savedModel.includes('applied')) throw new Error('Acknowledgment was not saved in diagram.'); // CHANGE
        const undo = smokeUi.editor.undoManager, beforeUndo = undo.history.map(edit => edit.changes.map(change => ({type:change.constructor.name,cell:change.cell?.id||change.child?.id,parent:change.parent?.id,currentParent:change.child?.parent?.id,fieldReceipt:!!change.cell?.value?.getAttribute?.('trellis_field_acknowledgments_json')}))); undo.undo(); // CHANGE: diagnostics contain only change kinds and public test object identifiers.
        if (task.value.getAttribute('workflow_state') !== 'TODO' || !graph.getDefaultParent().value.getAttribute('trellis_field_acknowledgments_json').includes('smoke-phone:1')) throw new Error('Mobile Undo lost its command or operation receipt: '+JSON.stringify({state:task.value.getAttribute('workflow_state'),receipts:graph.getDefaultParent().value.getAttribute('trellis_field_acknowledgments_json'),beforeUndo})); // CHANGE
        if (!undo.canRedo()) throw new Error('Field-version metadata trimmed Redo.'); undo.redo(); // NEW
        if (task.value.getAttribute('workflow_state') !== 'DONE') throw new Error('Mobile Redo did not restore its task command.'); // NEW
        Trellis.taskCommands.commitCardPatch(task, { card_note: 'Undo annotation test' }, { reflow: false }); undo.undo(); // NEW
        if (task.value.getAttribute('card_note')) throw new Error('Field bookkeeping added an extra desktop Undo step.'); // NEW
        if (!undo.canRedo()) throw new Error('Desktop Undo lost Redo.'); undo.redo(); // NEW
        if (task.value.getAttribute('card_note') !== 'Undo annotation test') throw new Error('Desktop annotation Redo failed.'); undo.undo(); // NEW
        await new Promise((resolve, reject) => smokeUi.getCurrentFile().save(false, resolve, reject)); // NEW
        await Trellis.field.processIncoming();
        if (task.value.getAttribute('card_note')) throw new Error('An acknowledged phone edit replayed after Undo.'); // NEW
        Trellis.taskCommands.commitCardPatch(task, { card_note: 'Automatic saved desktop edit' }, { reflow: false }); // NEW
        await new Promise((resolve, reject) => smokeUi.getCurrentFile().save(false, resolve, reject)); await Trellis.field.processIncoming(); // NEW
        return { previewChecks, desktopFieldApplication: true, persistedAcknowledgment: true, plannedDayPreserved: true, undoRedoPreserved: true, diagramId: smokeWork.diagramId, workerId: worker.id }; // CHANGE
    })();`); // NEW
    const identitySession = await window.webContents.executeJavaScript('trellisIdentity.getSession()'); // NEW
    const workDirectory = path.join(app.getPath('userData'), 'trellis-identities', identitySession.identityId, 'metadata', 'field', field.diagramId, field.workerId, 'work'); // NEW
    await until(async () => fs.readdirSync(workDirectory).map(name => JSON.parse(fs.readFileSync(path.join(workDirectory, name), 'utf8'))).some(record => record.payload.work.tasks.find(task => task.title === 'Water lettuce group')?.annotation === 'Automatic saved desktop edit'), 'automatic saved field publication'); // CHANGE: the existing background poll may already own the processing guard.
    const publishedFiles = fs.readdirSync(workDirectory); // NEW: inspect the actual signed outbox, not a renderer return value.
    await window.webContents.executeJavaScript(`(async()=>{Trellis.taskCommands.commitCardPatch(smokeUi.editor.graph.model.getCell('smoke-task'),{card_note:'Unpublished draft'},{reflow:false});await Trellis.field.processIncoming();})()`); // NEW
    assert.equal(fs.readdirSync(workDirectory).length, publishedFiles.length, 'A draft cannot trigger background field publication.'); // NEW
    await window.webContents.executeJavaScript(`(async()=>{smokeUi.editor.undoManager.undo();await new Promise((resolve,reject)=>smokeUi.getCurrentFile().save(false,resolve,reject));await Trellis.field.processIncoming();})()`); // NEW
    const stableCount = fs.readdirSync(workDirectory).length; await window.webContents.executeJavaScript('Trellis.field.processIncoming()'); // NEW
    assert.equal(fs.readdirSync(workDirectory).length, stableCount, 'An unchanged poll cannot create another package.'); // NEW
    field.automaticSavedRefresh = true; field.draftPreserved = true; field.unchangedPollSkipped = true; // NEW
    fs.writeFileSync(path.join(output, 'home.png'), (await window.webContents.capturePage()).toPNG());
    const result = { ok: true, productionLoading: true, managedCreateAndOpen: true, linkedLogin: true, openingChoice: opening, canceledWithoutReplacement: true, ...field }; fs.writeFileSync(path.join(output, 'checks.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result)); // CHANGE: save the verification record directly rather than depending on Windows console redirection.
    if (physicalMode) { await preparePhysicalDesktop(); return; } // NEW: retain this isolated desktop for the paired phone's automatic round trip.
    await cleanup(0); // CHANGE: verify the real production quit lifecycle.

}
/** Hold a real editor with sample tasks; loopback control supports only the test's narrow actions. */ // NEW
async function preparePhysicalDesktop(seed = true) { // CHANGE
    const http = require('node:http'), crypto = require('node:crypto'); // NEW
    await window.webContents.executeJavaScript(`(async () => {
        const graph=smokeUi.editor.graph, role=graph.model.getCell('smoke-role'), board=graph.model.getCell('smoke-task')?.parent?.parent, lane=graph.model.getCell('smoke-lane')||Object.values(graph.model.cells).find(cell=>cell.parent===board&&cell.value?.getAttribute?.('lane_key')==='TODO'); // CHANGE: resumed legacy fixtures and newly created production templates share the same task lane.
        const today=new Date(), day=today.getFullYear()+'-'+String(today.getMonth()+1).padStart(2,'0')+'-'+String(today.getDate()).padStart(2,'0');
        for(const [id,title] of ${JSON.stringify(seed ? [['phone-progress','Phone watering test'],['phone-note','Phone annotation test']] : [])}) { // CHANGE: resumed tests preserve existing tasks and pending operations.
            const value=mxUtils.createXmlDocument().createElement('object');
            for(const [name,text] of Object.entries({kanban_card:'1',title,workflow_state:'TODO',notes:'Sample data for the Moto G Power physical test.',start:day,end:day,assigned_day:day,task_assignee_role_ids_json:JSON.stringify([role.id]),linkedTo:'smoke-bed'}))value.setAttribute(name,text);
            graph.insertVertex(lane,id,value,10,10,160,100);
        }
        TrellisGardenHome.saveJson=async()=>false;
        ${seed ? 'await Trellis.field.exportWork();' : ''} // CHANGE: resuming must exercise automatic acknowledgment retry without a manual export.
    })();`); // NEW
    if (process.env.TRELLIS_PHYSICAL_LAYOUT_TEST === '1') await window.webContents.executeJavaScript(`(async()=>{ // NEW: migrate only this temporary sample garden for the whole-layout physical test.
        const graph=smokeUi.editor.graph,model=graph.model,bed=model.getCell('smoke-bed'),garden=model.getCell('smoke-garden'),unrelated=model.getCell('smoke-unrelated'); // CHANGE
        graph.setCellStyles('module','1',[garden]); // NEW: legacy sample rectangles need Trellis's actual module style before invoking its planting command.
        if(unrelated)model.remove(unrelated);
        let group=Object.values(model.cells).find(cell=>cell.value?.getAttribute?.('trellis_field_test_group')==='1'); // CHANGE
        const cards=['smoke-task','phone-progress','phone-note'].map(id=>model.getCell(id)).filter(Boolean); // NEW
        model.beginUpdate(); // NEW: creation and reciprocal links form one valid fixture transaction.
        try { // NEW
            if(!group){const geometry=bed.geometry.clone();geometry.width=220;geometry.height=240;model.setGeometry(bed,geometry);group=USL.plantingGroup.createPlantingFromProposal({graph,moduleCell:garden,proposal:{geometry:{x:50,y:60,width:140,height:170},plantCount:1,spacingXCm:30,spacingYCm:30,vegDiameterCm:10,sharedFootprint:true},attributes:{label:'Lettuce planting group',plant_name:'Lettuce',plant_abbr:'LET',trellis_field_test_group:'1',linkedTo:cards.map(card=>card.id).join(',')}},{select:false,insideUpdate:true});} // CHANGE: reuse the production planting command and reciprocal-link contract.
            const groupValue=group.value.cloneNode(true);groupValue.setAttribute('linkedTo',cards.map(card=>card.id).join(','));model.setValue(group,groupValue); // NEW
            for(const card of cards){const value=card.value.cloneNode(true);value.setAttribute('linkedTo',group.id);model.setValue(card,value);} // CHANGE
        } finally { model.endUpdate(); } // NEW
        if(!model.contains(group))throw new Error('The linked test planting did not enter the document.'); // CHANGE
        await (graph.__trellisUsers||Trellis.users).restorePortableLogin(); // NEW: any diagram reload during fixture migration must finish restoring its already-linked identity.
        await Trellis.field.exportWork();
    })()`); // NEW
    const token = crypto.randomBytes(32).toString('hex'); // NEW
    const directory = path.join(project, '.test-artifacts', 'android-physical'); fs.mkdirSync(directory, { recursive: true }); // NEW
    const server = controlServer = http.createServer(async (request, response) => { // NEW
        if (request.headers.authorization !== 'Bearer ' + token) { response.writeHead(403).end(); return; } // NEW
        try { // NEW
            let result; // NEW
            if (request.url === '/pair' && request.method === 'POST') { // NEW
                let body = ''; for await (const chunk of request) { body += chunk; if (body.length > 65536) throw new Error('Request too large.'); } // NEW
                const payload = JSON.parse(body); if (payload.payload?.device?.kind !== 'android') throw new Error('Only the physical Android test request is accepted.'); // NEW
                result = await window.webContents.executeJavaScript('(async()=>trellisIdentity.approvePairRequest({request:' + JSON.stringify(payload) + '}))()'); // NEW
            } else if (request.url === '/state') { // NEW
                result = await window.webContents.executeJavaScript('(async()=>{const work=await Trellis.field.snapshot(false),file=smokeUi.getCurrentFile();return {diagramId:work.diagramId,workerId:work.workerId,tasks:work.tasks,acknowledgments:work.acknowledgments,gardens:work.gardens.length,modified:file.isModified(),conflicted:!!file.inConflictState,saving:!!file.savingFile,status:smokeUi.editor.status};})()'); // CHANGE: retain production save/conflict/error state for physical acknowledgment diagnostics.
            } else if (request.url === '/export' && request.method === 'POST') { // NEW
                await window.webContents.executeJavaScript('Trellis.field.exportWork()'); result = { ok: true }; // NEW
            } else if (request.url === '/stop' && request.method === 'POST') { // NEW
                result = { ok: true }; setTimeout(() => { void cleanup(0); }, 100); // CHANGE: send the control response before shared production cleanup.

            } else throw new Error('Unsupported physical-test action.'); // NEW
            response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(result)); // NEW
        } catch (error) { response.writeHead(500, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ error: error.message })); } // NEW
    }); // NEW
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); // NEW
    const session = await window.webContents.executeJavaScript('trellisIdentity.getSession()'); // NEW
    fs.writeFileSync(path.join(directory, 'control.json'), JSON.stringify({ url: 'http://127.0.0.1:' + server.address().port, token, identityId: session.identityId, username: session.username, password: 'local-smoke-password', profile, userData: app.getPath('userData') }), { mode: 0o600 }); // NEW: this isolated test password never unlocks user identities.
    console.log(JSON.stringify({ physicalDesktopReady: true, identityId: session.identityId, username: session.username, sampleTasks: 2 })); // NEW
} // NEW
run().catch(error => { console.error(error); if (diagnosticMode) { clearTimeout(timeout); setTimeout(() => { void cleanup(1); }, 180000).unref(); } else void cleanup(1); }); // CHANGE: failure, diagnostics and timeout share the same owned-resource exit.

/** Exercise only production project/identity UI in this helper's temporary profile. */ // NEW
async function runProjectSmoke() { // NEW
    const expression = value => window.webContents.executeJavaScript(value); // NEW
    const wait = (value, label) => until(() => expression(value), label); // NEW
    const capture = async name => { await expression('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))'); fs.writeFileSync(path.join(output, name), (await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG()); }; // NEW
    const localFolder = path.join(app.getPath('documents'), 'Trellis', 'Local Garden Projects'); fs.mkdirSync(localFolder, { recursive: true }); // NEW
    fs.writeFileSync(path.join(localFolder, 'Local fixture.drawio'), '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel>'); // NEW
    await wait("document.querySelector('.trellis-splash-actions')?.style.display !== 'none'", 'splash launch reveal'); // NEW
    await capture('splash-signed-out.png'); // CHANGE // NEW
    await expression("document.querySelector('[data-project-launcher=open]').click()"); // NEW
    await wait("document.querySelector('.trellis-projects-root')?.textContent.includes('Local fixture')", 'signed-out local project'); // NEW
    assert.equal(await expression("document.querySelector('.trellis-projects-root').textContent.includes('Log in')"), true); // NEW
    await expression("(()=>{const panel=smokeUi.__trellisGardenHome.panel;[...panel.querySelectorAll('button')].find(b=>b.textContent==='Create identity').click();panel.querySelector('input[aria-label=Username]').value='Project Smoke';panel.querySelector('input[type=password]').value='isolated-project-smoke-password';panel.querySelector('form').requestSubmit();})()"); // NEW
    await wait("smokeUi.__trellisGardenHome.panel?.textContent.includes('Logged in as Project Smoke')", 'library identity creation'); // NEW
    await expression("(()=>{const root=smokeUi.__trellisGardenHome.projectsRoot;[...root.querySelectorAll('button')].find(b=>b.textContent==='Create New Private Garden Project').click();root.querySelector('input[aria-label=\"Project name\"]').value='Private starter fixture';root.querySelector('form').requestSubmit();})()"); // NEW
    await wait("(()=>{const error=document.querySelector('.trellis-home-open');if(error)throw new Error(error.textContent);const graph=smokeUi.editor.graph;return !smokeUi.__trellisGardenHome.creating&&Object.values(graph.model.cells).some(cell=>cell.value?.getAttribute?.('garden_module')==='1');})()", 'private starter creation'); // NEW
    const starter = await expression("(()=>{const cells=Object.values(smokeUi.editor.graph.model.cells);return ['garden_module','team_module','task_module','roadmap_module'].map(flag=>cells.filter(cell=>cell.value?.getAttribute?.(flag)==='1').length);})()"); // NEW
    assert.deepEqual(starter, [1, 1, 1, 1]); // NEW
    await expression("(async()=>{await new Promise((resolve,reject)=>smokeUi.getCurrentFile().save(false,resolve,reject));TrellisGardenHome.showProjects(smokeUi,{focus:'create'});})()"); // NEW
    await wait("document.querySelector('.trellis-projects-root')?.textContent.includes('Private starter fixture')", 'private project listing'); // NEW
    await capture('projects-private.png'); // CHANGE // NEW
    await expression("(()=>{const root=smokeUi.__trellisGardenHome.projectsRoot;[...root.querySelectorAll('button')].find(b=>b.textContent==='Create New Shared Garden Project').click();root.querySelector('input[aria-label=\"Project name\"]').value='Shared starter fixture';root.querySelector('form').requestSubmit();})()"); // NEW
    await wait("(()=>{const error=document.querySelector('.trellis-home-open');if(error)throw new Error(error.textContent);return !!document.querySelector('input[placeholder=\"Recipient email\"]');})()", 'existing invitation handoff'); // NEW
    await capture('projects-invite.png'); // CHANGE // NEW
    await expression("[...document.querySelectorAll('button')].find(button=>button.textContent==='Cancel').click()"); // NEW
    await expression("(async()=>{const graph=smokeUi.editor.graph,garden=Object.values(graph.model.cells).find(cell=>cell.value?.getAttribute?.('garden_module')==='1');const created=Trellis.users.createUser('Fixture collaborator','fixture-pin',false);if(!created.ok)throw new Error(created.reason);const admin=Trellis.users.setUserAdmin(created.user.id,true);if(!admin.ok)throw new Error(admin.reason);const catalog=await trellisGardenLibrary.cities();if(!catalog.cities.length)throw new Error('Missing bundled city catalog');const city=catalog.cities[0];await trellisGardenLibrary.setReferenceCity({cityId:city.cityId});const value=garden.value.cloneNode(true);value.setAttribute('city_id',city.cityId);graph.model.setValue(garden,value);await new Promise((resolve,reject)=>smokeUi.getCurrentFile().save(false,resolve,reject));TrellisGardenHome.showProjects(smokeUi,{focus:'open'});})()"); // NEW
    await wait("smokeUi.__trellisGardenHome.sharedRows?.textContent.includes('Shared starter fixture')", 'membership classification'); // NEW
    assert.match(await expression('smokeUi.__trellisGardenHome.sharedRows.textContent'), /2 users/); // NEW
    assert.match(await expression('smokeUi.__trellisGardenHome.sharedRows.textContent'), /Under 25 km/);

    await expression("(()=>{const row=smokeUi.__trellisGardenHome.sharedRows.querySelector('.trellis-home-garden'),more=[...row.querySelectorAll('details')].find(node=>node.querySelector('summary').textContent==='More');more.open=true;[...row.querySelectorAll('button')].find(button=>button.textContent==='Rename').click();})()"); // NEW
    await wait("smokeUi.dialog?.container?.querySelector('input')?.value==='Shared starter fixture'", 'application rename dialog'); // NEW
    await expression("(()=>{const dialog=smokeUi.dialog.container;dialog.querySelector('input').value='Renamed shared starter fixture';[...dialog.querySelectorAll('button')].find(button=>button.textContent==='Rename').click();})()"); // NEW
    await wait("smokeUi.__trellisGardenHome.sharedRows?.textContent.includes('Renamed shared starter fixture')", 'project metadata rename'); // NEW
 // NEW
    const geometry = await expression("(()=>{const root=smokeUi.__trellisGardenHome.projectsRoot,input=root.querySelector('input[aria-label=\"Search garden projects\"]');input.focus();input.value='starter';input.dispatchEvent(new Event('input'));return {oneScroll:!root.querySelector('.trellis-home-list'),search:input.value};})()"); assert.equal(geometry.oneScroll, true); // NEW
    await expression("[...smokeUi.__trellisGardenHome.projectsRoot.querySelectorAll('button')].find(button=>button.textContent==='Refresh').click()"); // NEW
    await wait("smokeUi.__trellisGardenHome.sharedRows?.textContent.includes('2 users')", 'project refresh'); // NEW
    assert.equal(await expression("document.activeElement?.getAttribute('aria-label')"), 'Search garden projects'); // NEW
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Tab' }); window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Tab' }); // NEW
    await wait("document.activeElement?.tagName==='BUTTON'", 'keyboard navigation'); // NEW
    window.setSize(500, 650); await new Promise(resolve => setTimeout(resolve, 250)); // NEW
    const small = await expression("(()=>{const root=smokeUi.__trellisGardenHome.projectsRoot,rect=root.getBoundingClientRect();return {width:rect.width,height:rect.height,viewportWidth:innerWidth,viewportHeight:innerHeight,horizontalOverflow:root.scrollWidth>root.clientWidth+1};})()"); // NEW
    assert.equal(small.horizontalOverflow, false); assert.ok(small.width <= small.viewportWidth); assert.ok(small.height <= small.viewportHeight); // NEW
    await capture('projects-small.png'); // CHANGE // NEW
    await expression("[...smokeUi.__trellisGardenHome.projectsRoot.querySelectorAll('button')].find(button=>button.textContent==='Close').click();smokeUi.showSplash(true)"); // NEW
    await wait("document.querySelector('.trellis-splash-login-status')?.textContent==='Logged in as Project Smoke'", 'splash identity indication'); // NEW
    await capture('splash-signed-in.png'); // CHANGE // NEW
    const result = { ok: true, splashIdentityStatus: true, signedOutLocalFiles: true, relocatedIdentityControls: true, starter, invitationHandoff: true, membershipClassification: true, distanceBand: true, metadataRename: true, keyboardNavigation: true, smallWindow: small, output }; // NEW
    fs.writeFileSync(path.join(output, 'projects-checks.json'), JSON.stringify(result, null, 2)); console.log('PROJECTS_SMOKE:', JSON.stringify(result)); // NEW
} // NEW
