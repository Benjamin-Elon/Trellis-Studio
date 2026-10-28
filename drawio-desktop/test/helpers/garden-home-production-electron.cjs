require('../../src/main/trellis-asset-scheme.cjs'); // NEW: production protocol privileges must precede app readiness.
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
const foldResume = process.env.TRELLIS_SECTION_FOLDS_TEST === 'restore' ? process.env.TRELLIS_SECTION_FOLDS_PROFILE : null; // NEW: a second app process verifies the first process's saved fold choices.
if (process.env.TRELLIS_SECTION_FOLDS_TEST === 'restore' && (!foldResume || path.dirname(path.resolve(foldResume)) !== require('node:os').tmpdir() || !path.basename(foldResume).startsWith('trellis-garden-home-production-'))) throw new Error('Fold restore requires an isolated production smoke profile.'); // NEW
const profile = resume?.profile || foldResume || fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'trellis-garden-home-production-')); // CHANGE: resume only this helper's sample identity after a build or test interruption.
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
        const emergency = setTimeout(() => { console.error('Production smoke cleanup exceeded its bound.'); for (const child of ownedChildren) if (child.exitCode == null && child.signalCode == null) child.kill('SIGKILL'); app.exit(code || 1); }, process.env.TRELLIS_GARDEN_PROJECTS_TEST === '1' ? 25000 : 16000); emergency.unref(); // CHANGE: allow document preparation plus the production transport's graceful/forced shutdown bounds in the extended project suite.
        if (controlServer) { controlServer.closeAllConnections(); await new Promise(resolve => controlServer.close(resolve)); controlServer = null; } // NEW
        // Only this isolated fixture's documents are approved for discard during cleanup. // NEW
        const confirm = dialog.showMessageBoxSync; dialog.showMessageBoxSync = (...args) => args.at(-1)?.title === 'Confirm' ? 1 : confirm(...args); // NEW
        app.once('will-quit', event => { event.preventDefault(); clearTimeout(emergency); console.log('PRODUCTION_CLEANUP:', JSON.stringify({ code, ownedChildrenAlive: [...ownedChildren].filter(child => child.exitCode == null && child.signalCode == null).length })); app.exit(ownedChildren.size ? 1 : code); }); // NEW: resources have stopped before preserving the test result's exit code.
        app.quit(); // NEW
    })(); // NEW
    return cleanupTask; // NEW
} // NEW
function smokeTimeout() { console.error('Production smoke timed out at: ' + smokeStage); const snapshot = window?.webContents.executeJavaScript("({body:document.body.innerText.slice(0,2000),queued:window.App?.DrawPlugins?.length,callback:String(window.Draw?.loadPlugin).slice(0,300),status:document.querySelector('.trellis-splash-login-status')?.textContent})"); Promise.race([snapshot, new Promise(resolve => setTimeout(resolve, 2000))]).then(value => console.error('Smoke state:', JSON.stringify(value))).finally(() => cleanup(1)); } // CHANGE // NEW
const timeout = setTimeout(smokeTimeout, physicalMode ? 1800000 : process.env.TRELLIS_GARDEN_PROJECTS_TEST === '1' ? 180000 : 120000); // CHANGE: the project suite also exercises Trash, shared renaming, suffix migration, and durable saves.
const stopFile = process.env.TRELLIS_SMOKE_STOP_FILE; // NEW
if (stopFile && (path.basename(stopFile) !== 'stop' || path.dirname(path.dirname(stopFile)) !== require('node:os').tmpdir() || !path.basename(path.dirname(stopFile)).startsWith('trellis-smoke-run-'))) throw new Error('Invalid parent smoke control path.'); // NEW
const parentControl = stopFile ? setInterval(() => { if (fs.existsSync(stopFile)) void cleanup(1); }, 200) : null; parentControl?.unref(); // NEW

/** Bound readiness waits so a broken production loading step reports its location. */ // NEW
async function until(check, label = 'renderer readiness', timeoutMs = 180000) { // CHANGE: short input checks fail promptly while production loading retains its existing bound.
    smokeStage = label; console.log('SMOKE_STAGE:', label); // NEW // CHANGE
    const deadline = Date.now() + timeoutMs; // CHANGE: this production loader can be delayed by unrelated external font requests.
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
    await window.webContents.executeJavaScript(`new Promise(resolve => Draw.loadPlugin(ui => { window.smokeUi = ui; const loaded = ui.fileLoaded; ui.fileLoaded = function() { const result = loaded.apply(this, arguments); Promise.resolve(result).then(() => { window.smokeInitialFileLoaded = true; }); return result; }; resolve(); }));`); // CHANGE
    await until(() => window.webContents.executeJavaScript('!!window.smokeInitialFileLoaded && !smokeUi.openingFile'), 'initial file load'); // CHANGE: the startup file must finish before the smoke opens its own garden.
    await window.webContents.executeJavaScript(`localStorage.setItem('trellis.licenseWizard.v2', JSON.stringify({ version: '2', path: 'personal', contactGuidance: false, oathCompletedAt: new Date().toISOString(), name: 'Smoke Test', signature: 'Smoke Test', email: 'smoke@example.test' })); smokeUi.hideDialog(); smokeUi.showSplash(true);`);
    if (foldResume) { // NEW: verify durable preferences after the previous Electron app has quit completely.
        await until(() => window.webContents.executeJavaScript("document.querySelector('.trellis-splash-login-status')?.textContent === 'Logged in as Fold Smoke'"), 'app restart identity'); // NEW
        await window.webContents.executeJavaScript('smokeUi.pickFile()'); // NEW
        await until(() => window.webContents.executeJavaScript('!!smokeUi.__trellisGardenHome.projectsRoot?.__focused'), 'app restart fold preferences'); // NEW
        assert.deepEqual(await window.webContents.executeJavaScript('(()=>{const state=smokeUi.__trellisGardenHome;return {private:state.privateRows.hidden,shared:state.sharedRows.hidden};})()'), { private: true, shared: false }); // NEW
        const result = { ok: true, appRestartPersistence: true, output }; // NEW
        fs.writeFileSync(path.join(output, 'projects-folded-app-restarted.png'), (await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG()); // NEW
        fs.writeFileSync(path.join(output, 'section-folds-checks.json'), JSON.stringify(result, null, 2)); console.log('SECTION_FOLDS_SMOKE:', JSON.stringify(result)); // NEW
        await cleanup(0); return; // NEW
    } // NEW
    const splash = await until(() => window.webContents.executeJavaScript(`(()=>{const panel=document.querySelector('.trellis-splash-login-status');return panel?.textContent==='Not logged in'?{controls:panel.textContent,afterLicense:panel.previousElementSibling.classList.contains('trellis-license-contact-panel'),installed:!!smokeUi.__trellisGardenHome,fieldInstalled:!!smokeUi.__trellisFieldRuntime}:false;})()`), 'logged-out splash status'); // CHANGE
    assert.equal(splash.controls, 'Not logged in'); // CHANGE
    assert.equal(splash.afterLicense, true); assert.equal(splash.installed, true); assert.equal(splash.fieldInstalled, true); // CHANGE
    if (process.env.TRELLIS_QUICKSTART_SMOKE === '1') { // NEW
        const result = await require('./quickstart-production.cjs')({ window, until, output }); // NEW
        fs.writeFileSync(path.join(output, 'quickstart-checks.json'), JSON.stringify(result, null, 2)); console.log('QUICKSTART_SMOKE:', JSON.stringify(result)); // NEW
        await cleanup(0); return; // NEW
    } // NEW
    if (process.env.TRELLIS_HOME_NAVIGATION_TEST === '1') { // NEW: test Home independently of the field-package workflows.
        const result = await require('./home-navigation-production.cjs')({ app, dialog, BrowserWindow, primary: window, profile, until }); // NEW
        fs.writeFileSync(path.join(output, 'home-navigation-checks.json'), JSON.stringify(result, null, 2)); console.log('HOME_NAVIGATION_SMOKE:', JSON.stringify(result)); // NEW
        await cleanup(0); return; // NEW
    } // NEW
    if (process.env.TRELLIS_GARDEN_COMMUNITIES_TEST === '1') { await runCommunitySmoke(); await cleanup(0); return; } // NEW
    if (process.env.TRELLIS_SECTION_FOLDS_TEST === '1') { // NEW: exercise section controls without running unrelated field-package workflows.
        await window.webContents.executeJavaScript("trellisIdentity.create({username:'Fold Smoke',password:'local-fold-smoke-password',keepLoggedIn:true})"); // NEW
        const result = { ok: true, ...await runSectionFoldSmoke(), profile, output }; // NEW
        fs.writeFileSync(path.join(output, 'section-folds-checks.json'), JSON.stringify(result, null, 2)); console.log('SECTION_FOLDS_SMOKE:', JSON.stringify(result)); // NEW
        await cleanup(0); return; // NEW
    } // NEW
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
    const opening = await window.webContents.executeJavaScript("Array.from(document.querySelectorAll('.trellis-projects-section h3')).map(node => (node.querySelector('.trellis-projects-title') || node).textContent)"); // CHANGE: fold symbols are controls, not part of the static section title.
    assert.deepEqual(opening.slice(0, 3), ['Garden communities', 'Shared garden projects', 'Private garden projects']); // CHANGE
    await window.webContents.executeJavaScript("Array.from(document.querySelectorAll('.trellis-projects-root button')).find(b => b.textContent === 'Close').click();"); // CHANGE
    assert.equal(await window.webContents.executeJavaScript('smokeUi.getCurrentFile().fileObject.path === smokeGarden.path'), true);
    await window.webContents.executeJavaScript('Trellis.sharing.refresh()'); // CHANGE: load the current collaboration base before authoring fixture cells.
    const field = await window.webContents.executeJavaScript(`(async () => { // NEW: real renderer commands, preview pixels, durable save, and acknowledgment publication.
        const graph = smokeUi.editor.graph, worker = Trellis.users.getCurrentUser();
        const value = attributes => { const node = mxUtils.createXmlDocument().createElement('object'); for (const [name, text] of Object.entries(attributes)) node.setAttribute(name, text); return node; };
        const garden = graph.insertVertex(null, 'smoke-garden', value({ garden_module: '1', label: 'Field preview' }), 400, 300, 600, 400, 'module=1;'); // CHANGE: exercise the real garden-module discovery path.
        if (graph.model.getCell(garden.id) !== garden) throw new Error('Initial garden insertion failed: ' + JSON.stringify({ id: garden.id, parent: garden.parent?.id, modelCells: Object.keys(graph.model.cells), attrs: garden.value?.outerHTML, root: graph.model.root?.id, defaultParent: graph.getDefaultParent()?.id, admin: Trellis.users.isAdmin(), sharing: Trellis.sharing.context(), status: smokeUi.editor.status })); // CHANGE
        graph.__trellisModules.clusters.revealCell(garden); graph.foldCells(false, false, [garden]); // CHANGE: insert children against the full authored container before testing folded rendering.
        const bed = graph.insertVertex(garden, 'smoke-bed', value({ garden_bed: '1', label: 'Blue bed' }), 40, 50, 120, 90, 'fillColor=#0000ff;strokeColor=none;'); // CHANGE
        const planting = graph.insertVertex(bed, 'smoke-planting-group', value({ tiler_group: '1', label: 'Blue planting group', plant_name: 'Lettuce', linkedTo: 'smoke-task' }), 10, 10, 90, 60, 'fillColor=#0000ff;strokeColor=none;'); // CHANGE: production task/group links are reciprocal.
        graph.insertVertex(garden, 'smoke-plant', value({ plant_tiler: '1', label: 'Red plant' }), 350, 210, 45, 45, 'fillColor=#ff0000;strokeColor=none;'); // CHANGE
        const unrelated = graph.insertVertex(garden, 'smoke-unrelated', value({ trellis_role_user_id: worker.id, label: 'Unrelated private role' }), 170, 50, 100, 90, 'fillColor=#00ff00;role_card=1;'); // CHANGE: a valid private role avoids an orphan task's perpetual board reparenting.
        const denied = graph.insertVertex(garden, 'smoke-denied', value({ label: 'Denied preview secret' }), 250, 50, 50, 50, 'fillColor=#00ff00;'); // CHANGE
        graph.insertVertex(denied, 'smoke-denied-child', value({ label: 'Denied descendant secret' }), 0, 0, 20, 20); // CHANGE
        const allowedDescendant = graph.insertVertex(denied, 'smoke-allowed-child', value({ label: 'Allowed descendant' }), 25, 25, 20, 20, 'fillColor=#ff0000;'); // CHANGE: explicit child access survives a denied ancestor without revealing that ancestor's label or shape.
        graph.insertEdge(garden, 'smoke-denied-edge', value({ label: 'Denied endpoint secret' }), bed, denied); // CHANGE
        const role = graph.insertVertex(null, 'smoke-role', value({ trellis_role_user_id: worker.id }), 10, 300, 100, 60);
        const taskModule = graph.insertVertex(null, 'smoke-task-module', value({ task_module: '1', label: 'Field work' }), 10, 10, 600, 250); // CHANGE
        const template = graph.__trellisTaskManager.ensureMainBoardInTaskModule(taskModule), board = template.board, lane = template.lanes.TODO; // CHANGE: use the production template and every real workflow lane.
        const task = graph.insertVertex(lane, 'smoke-task', value({ kanban_card: '1', title: 'Water lettuce group', workflow_state: 'TODO', task_assignee_role_ids_json: JSON.stringify([role.id]), linkedTo: planting.id, start: '2026-10-01', end: '2026-10-01', assigned_day: '2026-10-01' }), 10, 10, 160, 100); // CHANGE
        graph.setSelectionCell(task);
        if (graph.model.getCell(garden.id) !== garden) throw new Error('Garden fixture was not inserted into the live model: ' + JSON.stringify({ id: garden.id, parent: garden.parent?.id, modelCells: Object.keys(graph.model.cells), attrs: garden.value?.outerHTML })); // CHANGE
        const originalUsers = graph.__trellisUsers; graph.__trellisUsers = Object.assign(Object.create(originalUsers || Trellis.users), { isAdmin: () => false, getAccessSummary: cell => ({ effectiveOpen: cell !== denied && cell.id !== 'smoke-denied-child' }) }); // CHANGE: exercise per-cell permissions and a connector with a denied endpoint.
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); // CHANGE: settle scheduled module/board normalization before observing rendering-only invariants.
        if (graph.model.getCell(garden.id) !== garden) throw new Error('Garden fixture replaced during scheduled normalization.'); // CHANGE
        await Trellis.field.snapshot(true); // CHANGE: assign persistent IDs before observing rendering-only invariants.
        if (graph.model.getCell(garden.id) !== garden) throw new Error('Garden fixture replaced during first preview.'); // CHANGE
        const previewChecks = [];
        const foldPreferences = () => JSON.stringify(Object.entries(localStorage).filter(([key]) => key.startsWith('trellis.local-folds.')).sort()); // CHANGE: unrelated background preferences may persist during asynchronous rasterization.
        const convertImages = smokeUi.editor.convertImages; smokeUi.editor.convertImages = function(svg) { window.smokePreviewSvg = mxUtils.getXml(svg); return convertImages.apply(this, arguments); }; // CHANGE: preserve the actual production SVG on a raster-alignment failure.
        for (const [scale, mode] of [[0.7, 'current'], [1.4, 'folded'], [1, 'city-hidden']]) { // CHANGE
            graph.view.setScale(scale); graph.view.setTranslate(23, 17); graph.view.validate();
            if (mode === 'folded') graph.foldCells(true, false, [garden]); // CHANGE
            if (mode === 'city-hidden') { graph.model.setVisible(garden, false); graph.view.validate(); } // CHANGE: city filtering removes live states using visibility.
            graph.setSelectionCell(task); // CHANGE: establish the selection being preserved after native fold controls finish changing their own selection.
            const before = mxUtils.getXml(new mxCodec().encode(graph.model)), selection = graph.getSelectionCells().slice(), history = smokeUi.editor.undoManager.indexOfNextAdd, preferences = foldPreferences(), hosts = document.body.children.length; // CHANGE
            const work = await Trellis.field.snapshot(true), preview = work.gardens.find(item => item.id === garden.value.getAttribute('trellis_field_object_id'));
            window.smokePreviewPng = preview?.png; // CHANGE
            const unchanged = { model: before === mxUtils.getXml(new mxCodec().encode(graph.model)), history: history === smokeUi.editor.undoManager.indexOfNextAdd, preferences: preferences === foldPreferences(), hosts: hosts === document.body.children.length, selection: selection.length === graph.getSelectionCells().length && selection.every((cell, index) => graph.getSelectionCells()[index] === cell) }; // CHANGE
            if (Object.values(unchanged).some(value => !value)) throw new Error('Preview changed editor state: ' + JSON.stringify({ mode, unchanged, historyBefore: history, historyAfter: smokeUi.editor.undoManager.indexOfNextAdd, edits: smokeUi.editor.undoManager.history.slice(history).map(edit => edit.changes.map(change => ({ type: change.constructor.name, id: change.cell?.id || change.child?.id }))) })); // CHANGE
            if (!preview) throw new Error('Missing garden preview: ' + JSON.stringify({ mode, expected: garden.value.getAttribute('trellis_field_object_id'), gardens: work.gardens.map(item => ({ id: item.id, name: item.name })), liveGardens: Object.values(graph.model.cells).filter(cell => cell.getAttribute?.('garden_module') === '1').map(cell => ({ id: cell.id, fieldId: cell.getAttribute('trellis_field_object_id'), visible: cell.visible, collapsed: cell.collapsed })), sameGraph: graph === smokeUi.editor.graph })); // CHANGE
            if (preview.regions.some(region => region.id === unrelated.value.getAttribute('trellis_field_object_id'))) throw new Error('Preview contains unrelated task data.'); // NEW
            if (preview.regions.some(region => /Denied/.test(region.label))) throw new Error('Preview leaked denied cells or connector endpoints.'); // CHANGE
            if (/Denied|Unrelated|smoke-denied-edge|smoke-denied-child/.test(window.smokePreviewSvg)) throw new Error('Preview SVG leaked private subtree or endpoint content.'); // CHANGE
            if (!preview.regions.some(region => region.id === allowedDescendant.getAttribute('trellis_field_object_id'))) throw new Error('Preview lost an explicitly readable descendant of a denied container.'); // CHANGE
            if (preview.width < 600 || preview.height < 400) throw new Error('Preview cropped the whole garden to a linked object.'); // NEW
            const region = preview.regions.find(item => item.id === planting.value.getAttribute('trellis_field_object_id')); // CHANGE
            if (region?.kind !== 'planting-group' || work.tasks.find(item=>item.title==='Water lettuce group').locations.join() !== region.id) throw new Error('Task highlights its bed instead of the linked planting group.'); // NEW
            const image = await new Promise((resolve, reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = reject; image.src = preview.png; });
            const canvas = document.createElement('canvas'); canvas.width = preview.width; canvas.height = preview.height; const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
            const pixel = [...context.getImageData(Math.floor(region.x + region.width * 0.25), Math.floor(region.y + region.height * 0.25), 1, 1).data];
            if (pixel[2] < 240 || pixel[0] > 20 || pixel[1] > 20) throw new Error('Preview region is misaligned: ' + JSON.stringify({ region, pixel, scale, liveStyle: planting.style, effectiveStyle: graph.view.getState(planting)?.style })); // CHANGE
            if (graph.getSelectionCell() !== task) throw new Error('Preview changed editor selection.');
            previewChecks.push({ scale, mode, pixel, wholeGarden: true, plantingGroupLinked: true, permissionsFiltered: true, liveStatePreserved: true }); window.smokeWork = work; // CHANGE
        }
        const svgExport = Graph.prototype.getSvg, hostsBeforeFailure = document.body.children.length; let exportFailed = false; // CHANGE
        try { Graph.prototype.getSvg = function() { if (this !== graph) throw new Error('Injected isolated export failure'); return svgExport.apply(this, arguments); }; await Trellis.field.snapshot(true); } // CHANGE
        catch (error) { if (error.message !== 'Injected isolated export failure') throw error; exportFailed = true; } // CHANGE
        finally { Graph.prototype.getSvg = svgExport; } // CHANGE
        if (!exportFailed || document.body.children.length !== hostsBeforeFailure) throw new Error('Failed preview leaked its render graph or swallowed the export error.'); // CHANGE
        graph.__trellisUsers = originalUsers; graph.model.setVisible(garden, true); // CHANGE
        smokeUi.editor.convertImages = convertImages; // CHANGE
        graph.model.remove(denied); graph.model.remove(graph.model.getCell('smoke-denied-edge')); // CHANGE
        graph.model.remove(unrelated); // CHANGE: remove the privacy fixture before command/Undo checks.
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
        const automaticTarget = Object.values(graph.model.cells).find(cell => cell.getAttribute?.('trellis_field_object_id') === task.getAttribute('trellis_field_object_id')); // CHANGE: stable field identity survives replacement of the collaboration projection's cell objects and IDs.
        const automaticEdit = automaticTarget && Trellis.taskCommands.commitCardPatch(automaticTarget, { card_note: 'Automatic saved desktop edit' }, { reflow: false }); // CHANGE
        if (!automaticEdit || automaticTarget.getAttribute('card_note') !== 'Automatic saved desktop edit') throw new Error('Automatic desktop edit was rejected before publication: ' + JSON.stringify({ automaticEdit, targetFound: !!automaticTarget, sameCell: automaticTarget === task, saving: smokeUi.getCurrentFile().savingFile, collaborationSaving: smokeUi.getCurrentFile().__trellisCollaborativeSaving, tasks: Object.values(graph.model.cells).filter(cell=>cell.getAttribute?.('kanban_card')==='1').map(cell=>({id:cell.id,title:cell.getAttribute('title'),fieldId:cell.getAttribute('trellis_field_object_id')})) })); // CHANGE
        await new Promise((resolve, reject) => smokeUi.getCurrentFile().save(false, resolve, reject)); await Trellis.field.processIncoming(); // NEW
        return { previewChecks, desktopFieldApplication: true, persistedAcknowledgment: true, plannedDayPreserved: true, undoRedoPreserved: true, diagramId: smokeWork.diagramId, workerId: worker.id }; // CHANGE
    })();`); // NEW
    const identitySession = await window.webContents.executeJavaScript('trellisIdentity.getSession()'); // NEW
    const workDirectory = path.join(app.getPath('userData'), 'trellis-identities', identitySession.identityId, 'metadata', 'field', field.diagramId, field.workerId, 'work'); // NEW
    await until(async () => fs.readdirSync(workDirectory).map(name => JSON.parse(fs.readFileSync(path.join(workDirectory, name), 'utf8'))).some(record => record.payload.work.tasks.find(task => task.title === 'Water lettuce group')?.annotation === 'Automatic saved desktop edit'), 'automatic saved field publication', 15000); // CHANGE: cover three background polls and report a bounded operation failure.
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
/** Exercise the production section controls with Chromium input and reload persisted renderer state. */ // NEW
async function runSectionFoldSmoke() { // NEW
    const expression = code => window.webContents.executeJavaScript(code); // NEW
    await expression('smokeUi.pickFile()'); // NEW
    await until(() => expression('!!smokeUi.__trellisGardenHome.projectsRoot?.__focused && !smokeUi.__trellisGardenHome.projectsRoot.__refreshing && !!smokeUi.__trellisGardenHome.referenceHost.querySelector(".trellis-city-picker")'), 'fold controls ready'); // NEW: wait for reference-city layout and the first list refresh before locating the button.
    window.webContents.focus(); // NEW: send native input to this isolated hidden renderer.
    const position = await expression("(()=>{const state=smokeUi.__trellisGardenHome,button=state.projectSectionToggles.private;button.scrollIntoView({block:'center'});const rect=button.getBoundingClientRect();return {x:Math.round(rect.x+rect.width/2),y:Math.round(rect.y+rect.height/2)};})()"); // NEW
    window.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...position }); window.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...position }); // NEW
    await until(() => expression('smokeUi.__trellisGardenHome.privateRows.hidden'), 'mouse fold', 5000); // NEW
    assert.equal(await expression('smokeUi.__trellisGardenHome.privateRows.parentNode.querySelector("button:not(.trellis-projects-toggle)").hidden'), true); // NEW
    await expression('smokeUi.__trellisGardenHome.projectSectionToggles.private.focus()'); // NEW
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Space' }); window.webContents.sendInputEvent({ type: 'char', keyCode: ' ' }); window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Space' }); // NEW: native activation includes the character event, matching actual keyboard input.
    await until(() => expression('!smokeUi.__trellisGardenHome.privateRows.hidden'), 'keyboard unfold', 5000); // NEW
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' }); window.webContents.sendInputEvent({ type: 'char', keyCode: '\r' }); window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' }); // NEW
    await until(() => expression('smokeUi.__trellisGardenHome.privateRows.hidden'), 'keyboard fold', 5000); // NEW
    const originalSize = window.getSize(); window.setSize(500, 650); // NEW
    await expression('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))'); // NEW
    const compact = await expression('(()=>{const state=smokeUi.__trellisGardenHome,root=state.projectsRoot;return {overflow:root.scrollWidth>root.clientWidth+1,width:root.getBoundingClientRect().width,viewport:innerWidth,hidden:state.privateRows.hidden};})()'); // NEW
    assert.equal(compact.overflow, false); assert.ok(compact.width <= compact.viewport); assert.equal(compact.hidden, true); // NEW
    fs.writeFileSync(path.join(output, 'projects-folded-small.png'), (await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG()); // NEW
    window.setSize(...originalSize); // NEW
    const identity = await expression('smokeUi.__trellisGardenHome.session.identityId'); // NEW
    const loaded = new Promise(resolve => window.webContents.once('did-finish-load', resolve)); window.webContents.reload(); await loaded; // NEW
    await until(() => expression('!!window.Draw?.loadPlugin && !!window.TrellisGardenHome').catch(() => false), 'restarted home scripts'); // NEW
    await expression('new Promise(resolve => Draw.loadPlugin(ui => { window.smokeUi = ui; resolve(); }))'); // NEW
    await expression('smokeUi.pickFile()'); // NEW
    await until(() => expression('!!smokeUi.__trellisGardenHome.projectsRoot?.__focused'), 'restarted project sections'); // NEW
    assert.deepEqual(await expression('(()=>{const state=smokeUi.__trellisGardenHome;return {identity:state.session?.identityId,private:state.privateRows.hidden,shared:state.sharedRows.hidden,focusHidden:!!document.activeElement.closest("[hidden]")};})()'), { identity, private: true, shared: false, focusHidden: false }); // NEW
    fs.writeFileSync(path.join(output, 'projects-folded-restarted.png'), (await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG()); // NEW
    await expression('smokeUi.hideDialog()'); // NEW: leave the isolated sample folded for the next app process to verify.
    return { mouse: true, keyboardSpaceAndEnter: true, compactLayout: true, rendererRestartPersistence: true }; // NEW
} // NEW
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
run().catch(async error => { // CHANGE: preserve public fixture pixels and vector data before the shared owned-resource cleanup.
    console.error(error); // CHANGE
    try { const state = await Promise.race([window?.webContents.executeJavaScript('({status:smokeUi.editor.status,modified:smokeUi.getCurrentFile()?.isModified(),saving:smokeUi.getCurrentFile()?.savingFile,editable:smokeUi.getCurrentFile()?.isEditable?.(),loggedIn:Trellis.users?.isLoggedIn(),liveTaskNote:smokeUi.editor.graph.model.getCell("smoke-task")?.getAttribute("card_note"),diagnostics:TrellisContentPolicy?.diagnostics()})'), new Promise(resolve => setTimeout(resolve, 2000))]); console.error('PRODUCTION_FAILURE_STATE:', JSON.stringify(state)); } catch (_) {} // CHANGE: operation diagnostics omit credentials and user document content.
    try { const preview = await Promise.race([window?.webContents.executeJavaScript('({svg:window.smokePreviewSvg,png:window.smokePreviewPng})'), new Promise(resolve => setTimeout(resolve, 2000))]); if (preview?.svg) fs.writeFileSync(path.join(output, 'failed-preview.svg'), preview.svg); if (preview?.png) fs.writeFileSync(path.join(output, 'failed-preview.png'), Buffer.from(preview.png.split(',')[1], 'base64')); } catch (_) {} // CHANGE
    if (diagnosticMode) { clearTimeout(timeout); setTimeout(() => { void cleanup(1); }, 180000).unref(); } else void cleanup(1); // CHANGE
}); // CHANGE

/** Focused community creation/discovery controls use the real renderer, preload and main process. */ // NEW
async function runCommunitySmoke() { // NEW
    const expression = code => window.webContents.executeJavaScript(code), wait = (code, label) => until(() => expression(code), label); // NEW
    await expression("(async()=>{await trellisIdentity.create({username:'Community Smoke',password:'isolated-community-smoke-password'});TrellisGardenHome.showProjects(smokeUi);})()"); // NEW
    await wait("!!smokeUi.__trellisGardenHome.session&&!![...smokeUi.__trellisGardenHome.projectsRoot.querySelectorAll('button')].find(b=>b.textContent==='Create Garden Community'&&!b.disabled)", 'community controls'); // NEW
    await expression("(()=>{const root=smokeUi.__trellisGardenHome.projectsRoot;[...root.querySelectorAll('button')].find(b=>b.textContent==='Create Garden Community').click();root.querySelector('input[aria-label=\"Community name\"]').value='Smoke neighborhood';root.querySelector('input[aria-label=\"Community description\"]').value='Nearby gardens';root.querySelector('input[aria-label=\"New garden name\"]').value='First community garden';root.querySelector('input[aria-label=\"Garden description\"]').value='Orchid volunteers';root.querySelector('.trellis-project-action form').requestSubmit();})()"); // NEW
    await wait("(()=>{const state=smokeUi.__trellisGardenHome,error=document.querySelector('.trellis-project-action form [aria-live]')?.textContent||document.querySelector('.trellis-home-open')?.textContent;if(error)throw new Error(error);return state.communities?.some(c=>c.name==='Smoke neighborhood');})()", 'create community and first garden'); // NEW
    const result = await expression("(()=>{const state=smokeUi.__trellisGardenHome,group=state.communitiesRows.querySelector('details[data-project-details^=\"community:\"]');group.open=true;return {community:state.communities[0].name,gardens:state.communities[0].gardens.length,joined:state.communities[0].gardens[0].joined,privateRows:state.privateRows.textContent,description:group.textContent.includes('Orchid volunteers'),administrator:group.textContent.includes('Community administrators: You')};})()"); // NEW
    assert.equal(result.community, 'Smoke neighborhood'); assert.equal(result.gardens, 1); assert.equal(result.joined, true); assert.equal(result.description, true); assert.equal(result.administrator, true); assert.doesNotMatch(result.privateRows, /First community garden/); // NEW
    await expression("(()=>{const root=smokeUi.__trellisGardenHome.projectsRoot,search=root.querySelector('input[aria-label=\"Search garden projects\"]');search.value='orchid';search.dispatchEvent(new Event('input'));})()"); // NEW
    assert.match(await expression('smokeUi.__trellisGardenHome.communitiesRows.textContent'), /Smoke neighborhood/); // NEW
    fs.writeFileSync(path.join(output, 'communities.png'), (await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG()); // NEW
    window.setSize(500, 650); await expression('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))'); // NEW
    assert.equal(await expression('(()=>{const root=smokeUi.__trellisGardenHome.projectsRoot;return root.scrollWidth>root.clientWidth+1;})()'), false); // NEW
    fs.writeFileSync(path.join(output, 'communities-small.png'), (await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG()); // NEW
    fs.writeFileSync(path.join(output, 'community-checks.json'), JSON.stringify({ ok: true, ...result, smallWindow: true, output }, null, 2)); console.log('COMMUNITY_SMOKE:', JSON.stringify({ ok: true, ...result, smallWindow: true, output })); // NEW
} // NEW

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
    await wait("smokeUi.__trellisGardenHome.accountHost?.textContent.includes('Project Smoke')", 'library identity creation'); // NEW
    await wait("(()=>{const state=smokeUi.__trellisGardenHome,button=[...state.projectsRoot.querySelectorAll('button')].find(button=>button.textContent==='Create New Private Garden Project');return state.session&&!state.creating&&button&&!button.disabled;})()", 'private creation controls ready'); // NEW
    await expression("(()=>{const root=smokeUi.__trellisGardenHome.projectsRoot;[...root.querySelectorAll('button')].find(b=>b.textContent==='Create New Private Garden Project').click();root.querySelector('input[aria-label=\"Project name\"]').value='Private starter fixture';root.querySelector('form').requestSubmit();})()"); // NEW
    await wait("(()=>{const error=document.querySelector('.trellis-home-open');if(error)throw new Error(error.textContent);const graph=smokeUi.editor.graph;return !smokeUi.__trellisGardenHome.creating&&Object.values(graph.model.cells).some(cell=>cell.value?.getAttribute?.('garden_module')==='1');})()", 'private starter creation'); // NEW
    const starter = await expression("(()=>{const cells=Object.values(smokeUi.editor.graph.model.cells);return ['garden_module','team_module','task_module','roadmap_module'].map(flag=>cells.filter(cell=>cell.value?.getAttribute?.(flag)==='1').length);})()"); // NEW
    assert.deepEqual(starter, [1, 1, 1, 1]); // NEW
    await expression("(async()=>{await new Promise((resolve,reject)=>smokeUi.getCurrentFile().save(false,resolve,reject));TrellisGardenHome.showProjects(smokeUi,{focus:'create'});})()"); // NEW
    await wait("document.querySelector('.trellis-projects-root')?.textContent.includes('Private starter fixture')", 'private project listing'); // NEW
    await capture('projects-private.png'); // CHANGE // NEW
    assert.equal(await expression("smokeUi.__trellisGardenHome.projectsRoot.textContent.includes('Remove from this device') || smokeUi.__trellisGardenHome.projectsRoot.textContent.includes('Keep available offline')"), false); // NEW
    assert.equal(await expression("[...smokeUi.__trellisGardenHome.projectsRoot.querySelectorAll('button')].every(button=>button.classList.contains('trellis-button'))"), true); // CHANGE
    await expression("(()=>{const row=[...smokeUi.__trellisGardenHome.privateRows.querySelectorAll('.trellis-home-garden')].find(row=>row.textContent.includes('Private starter fixture'));row.querySelector('.trellis-project-menu').open=true;[...row.querySelectorAll('button')].find(button=>button.textContent==='Move to Trash…').click();})()"); // CHANGE
    await wait("document.querySelector('.trellis-project-confirmation')?.textContent.includes('Pending invitations')", 'private deletion confirmation'); // CHANGE
    const confirmation = await expression("(()=>{const state=smokeUi.__trellisGardenHome,prompt=state.confirmation,button=prompt.controls.firstChild;return {stacked:smokeUi.dialogs.at(-1).container.firstChild===prompt.panel&&smokeUi.dialogs.some(dialog=>dialog.container.firstChild===state.projectsRoot),focusedCancel:document.activeElement.textContent==='Cancel',inertLibrary:state.projectsRoot.inert,color:getComputedStyle(button).color,background:getComputedStyle(button).backgroundColor};})()"); // CHANGE: allow unrelated preexisting host dialogs while checking actual ownership.
    console.log('PROJECT_CONFIRMATION:', JSON.stringify(confirmation)); await capture('projects-delete-confirmation.png'); // CHANGE: preserve rendered evidence before assertions.
    assert.equal(confirmation.stacked, true); assert.equal(confirmation.focusedCancel, true); assert.equal(confirmation.inertLibrary, true); assert.equal(confirmation.color, 'rgb(255, 255, 255)'); assert.equal(confirmation.background, 'rgb(185, 28, 28)'); // CHANGE
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Tab' }); window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Tab' }); // CHANGE
    await wait("document.activeElement===smokeUi.__trellisGardenHome.confirmation.controls.firstChild", 'confirmation keyboard containment'); // CHANGE
    const originalSize = window.getSize(); window.setSize(500, 480); await new Promise(resolve => setTimeout(resolve, 250)); // CHANGE
    const promptSize = await expression("(()=>{const panel=document.querySelector('.trellis-project-confirmation'),rect=panel.parentNode.getBoundingClientRect();return {inside:rect.left>=0&&rect.top>=0&&rect.right<=innerWidth&&rect.bottom<=innerHeight,overflow:panel.scrollWidth>panel.clientWidth+1};})()"); // CHANGE
    assert.equal(promptSize.inside, true); assert.equal(promptSize.overflow, false); await capture('projects-delete-confirmation-small.png'); // CHANGE
    window.setSize(...originalSize); await new Promise(resolve => setTimeout(resolve, 250)); // CHANGE
    await capture('projects-delete-confirmation.png'); // NEW
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' }); window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' }); // CHANGE
    await wait("!smokeUi.__trellisGardenHome.confirmation&&document.activeElement?.getAttribute('data-project-focus')?.endsWith(':menu')", 'confirmation cancellation and restored focus'); // CHANGE
    await expression("(()=>{const row=[...smokeUi.__trellisGardenHome.privateRows.querySelectorAll('.trellis-home-garden')].find(row=>row.textContent.includes('Private starter fixture'));row.querySelector('.trellis-project-menu').open=true;[...row.querySelectorAll('button')].find(button=>button.textContent==='Move to Trash…').click();})()"); // CHANGE
    await wait("document.querySelector('.trellis-project-confirmation')?.textContent.includes('Pending invitations')", 'reopened deletion confirmation'); // CHANGE
    await expression("[...document.querySelectorAll('.trellis-project-confirmation button')].find(button=>button.textContent==='Move to Trash'||button.textContent==='Save and move to Trash').click()"); // CHANGE
    await wait("!smokeUi.__trellisGardenHome.privateRows.textContent.includes('Private starter fixture')&&!document.querySelector('.trellis-project-confirmation')", 'private project removed from list'); // CHANGE
    await expression("[...smokeUi.__trellisGardenHome.projectsRoot.querySelectorAll('button')].find(button=>button.textContent==='Trash').click()"); // NEW
    await wait("!smokeUi.__trellisGardenHome.trashSection.hidden&&smokeUi.__trellisGardenHome.trashRows.textContent.includes('Private starter fixture')", 'retained project in Trash'); // NEW
    await capture('projects-trash.png'); // NEW
    await expression("smokeUi.__trellisGardenHome.trashRows.querySelector('button').click()"); // NEW
    await wait("smokeUi.__trellisGardenHome.trashRows.textContent.includes('Trash is empty')", 'private restoration'); // NEW
    await expression("[...smokeUi.__trellisGardenHome.projectsRoot.querySelectorAll('button')].find(button=>button.textContent==='Projects').click()"); // NEW
    await wait("smokeUi.__trellisGardenHome.privateRows.textContent.includes('Private starter fixture')", 'restored project in active list'); // NEW
    await wait("(()=>{const state=smokeUi.__trellisGardenHome,button=[...state.projectsRoot.querySelectorAll('button')].find(button=>button.textContent==='Create Garden Community');return state.session&&!state.creating&&button&&!button.disabled;})()", 'community creation controls ready'); // CHANGE
    await expression("(()=>{const root=smokeUi.__trellisGardenHome.projectsRoot;[...root.querySelectorAll('button')].find(b=>b.textContent==='Create Garden Community').click();root.querySelector('input[aria-label=\"Community name\"]').value='Fixture neighborhood';const select=root.querySelector('select[aria-label=\"Garden project\"]');select.value='__new';select.dispatchEvent(new Event('change'));root.querySelector('input[aria-label=\"New garden name\"]').value='Shared starter fixture';root.querySelector('.trellis-project-action form').requestSubmit();})()"); // CHANGE
    await wait("(()=>{const state=smokeUi.__trellisGardenHome,error=document.querySelector('.trellis-project-action form [aria-live]')?.textContent||document.querySelector('.trellis-home-open')?.textContent;if(error)throw new Error(error);return state.communities?.some(c=>c.name==='Fixture neighborhood')&&!state.actionPanel?.isConnected;})()", 'community first garden creation'); // CHANGE: wait for the submitted form to close before opening another modal.
    await expression("smokeUi.hideDialog();Promise.resolve(smokeUi.actions.get('trellisShareGardenProject').funct())"); // NEW: community creation keeps the existing explicit invitation action available.
    await wait("(()=>{const error=document.querySelector('.trellis-home-open');if(error)throw new Error(error.textContent);return !!document.querySelector('input[placeholder=\"Recipient email\"]');})()", 'existing invitation handoff'); // NEW
    await capture('projects-invite.png'); // CHANGE // NEW
    await expression("[...smokeUi.dialog.container.querySelectorAll('button')].find(button=>button.textContent==='Cancel').click()"); // CHANGE: target the active invitation dialog, not retained forms underneath it.
    await wait("!smokeUi.dialog?.container?.querySelector('input[placeholder=\"Recipient email\"]')", 'invitation canceled'); // NEW
    await expression("if(smokeUi.dialog?.container?.textContent.includes('Share garden canvas'))smokeUi.hideDialog()"); // NEW: cancel the retained scope selector as well before editing the canvas fixture.
    smokeStage = 'collaborator fixture and saved city'; // NEW
    await expression("(async()=>{const graph=smokeUi.editor.graph;const created=Trellis.users.createUser('Fixture collaborator','fixture-pin',false);if(!created.ok)throw new Error(created.reason);const admin=Trellis.users.setUserAdmin(created.user.id,true);if(!admin.ok)throw new Error(admin.reason);await Trellis.sharing.settleObjectEdits();const catalog=await trellisGardenLibrary.cities();if(!catalog.cities.length)throw new Error('Missing bundled city catalog');const city=catalog.cities[0];await trellisGardenLibrary.setReferenceCity({cityId:city.cityId});const garden=Object.values(graph.model.cells).find(cell=>cell.value?.getAttribute?.('garden_module')==='1'),value=garden.value.cloneNode(true);value.setAttribute('city_id',city.cityId);graph.model.setValue(garden,value);if(graph.model.getCell(garden.id).getAttribute('city_id')!==city.cityId)throw new Error('The fixture city edit was rejected before saving.');await new Promise((resolve,reject)=>smokeUi.getCurrentFile().save(false,resolve,reject));TrellisGardenHome.showProjects(smokeUi,{focus:'open'});})()"); // NEW
    await wait("(()=>{const state=smokeUi.__trellisGardenHome;if(state.projectsStatus.textContent)throw new Error(state.projectsStatus.textContent);return state.communitiesRows?.querySelector('.trellis-home-garden')&&state.communitiesRows.textContent.includes('2 users');})()", 'membership classification'); // CHANGE: directory discovery can arrive before the locally refreshed membership/projection.
    assert.match(await expression('smokeUi.__trellisGardenHome.communitiesRows.textContent'), /2 users/); // NEW
    assert.match(await expression('smokeUi.__trellisGardenHome.communitiesRows.textContent'), /Fixture neighborhood/); // CHANGE
    await expression("smokeUi.__trellisGardenHome.communitiesRows.querySelector('details[data-project-details^=\"community:\"] > summary').click()"); // NEW

    const controlPosition = await expression("(()=>{const row=smokeUi.__trellisGardenHome.communitiesRows.querySelector('.trellis-home-garden'),button=row.querySelector('button');return {left:button.getBoundingClientRect().left,top:button.getBoundingClientRect().top};})()"); // NEW
    await expression("smokeUi.__trellisGardenHome.communitiesRows.querySelector('.trellis-project-menu').open=true;new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))"); // NEW
    const expandedPosition = await expression("(()=>{const button=smokeUi.__trellisGardenHome.communitiesRows.querySelector('.trellis-home-garden button');return {left:button.getBoundingClientRect().left,top:button.getBoundingClientRect().top};})()"); // NEW
    assert.ok(Math.abs(controlPosition.left-expandedPosition.left)<1); // NEW
    await expression("(()=>{const row=smokeUi.__trellisGardenHome.communitiesRows.querySelector('.trellis-home-garden'),more=[...row.querySelectorAll('details')].find(node=>node.classList.contains('trellis-project-menu'));more.open=true;[...row.querySelectorAll('button')].find(button=>button.textContent==='Rename').click();})()"); // NEW
    await wait("smokeUi.dialog?.container?.querySelector('input')?.value==='Shared starter fixture'", 'application rename dialog'); // NEW
    await expression("(()=>{const dialog=smokeUi.dialog.container;dialog.querySelector('input').value='Renamed shared starter fixture';[...dialog.querySelectorAll('button')].find(button=>button.textContent==='Rename').click();})()"); // NEW
    await wait("smokeUi.__trellisGardenHome.communitiesRows?.textContent.includes('Renamed shared starter fixture')", 'project metadata rename'); // NEW
    await wait("smokeUi.getCurrentFile().fileObject.name==='Renamed shared starter fixture.drawio'&&smokeUi.editor.graph.getModel().getCell('1').getAttribute('trellis_project_name')==='Renamed shared starter fixture'", 'shared filename and editor baseline'); // NEW
    await expression("(()=>{const file=smokeUi.getCurrentFile();file.__smokeAutosave=file.isAutosave;file.isAutosave=()=>false;const graph=smokeUi.editor.graph,garden=Object.values(graph.model.cells).find(cell=>cell.value?.getAttribute?.('garden_module')==='1'),value=garden.value.cloneNode(true);value.setAttribute('naming_test_note','unsaved garden detail');graph.model.setValue(garden,value);const row=smokeUi.__trellisGardenHome.communitiesRows.querySelector('.trellis-home-garden');row.querySelector('.trellis-project-menu').open=true;[...row.querySelectorAll('button')].find(button=>button.textContent==='Edit my suffix').click();const field=document.querySelector('input[aria-label=\"My suffix\"]');field.value='Coordinator: west';field.dispatchEvent(new Event('input'));[...document.querySelectorAll('.trellis-project-action button')].find(button=>button.textContent==='Save suffix').click();})()"); // NEW
    await wait("smokeUi.getCurrentFile().fileObject.name==='Renamed shared starter fixture - Coordinator- west.drawio'&&!document.querySelector('.trellis-project-action')", 'personal filename update with an unsaved draft'); // NEW
    assert.equal(await expression("smokeUi.getCurrentFile().isModified()&&Object.values(smokeUi.editor.graph.model.cells).some(cell=>cell.value?.getAttribute?.('naming_test_note')==='unsaved garden detail')"), true); // NEW
    await expression("(async()=>{const file=smokeUi.getCurrentFile();file.isAutosave=file.__smokeAutosave;delete file.__smokeAutosave;await new Promise((resolve,reject)=>file.save(false,resolve,reject));})()"); // NEW
    const savedNaming = await expression("(async()=>{const file=smokeUi.getCurrentFile(),xml=(await fsBridge.readText(file.fileObject.path)).data;return {path:file.fileObject.path,saved:xml.includes('unsaved garden detail'),privateSuffix:xml.includes('Coordinator: west'),display:file.__trellisDisplayName,title:document.title};})()"); // NEW
    assert.equal(savedNaming.saved, true); assert.equal(savedNaming.privateSuffix, false); assert.equal(savedNaming.display, 'Renamed shared starter fixture - Coordinator: west'); assert.match(savedNaming.title, /Coordinator: west/); // NEW
 // NEW
    const geometry = await expression("(()=>{const root=smokeUi.__trellisGardenHome.projectsRoot,input=root.querySelector('input[aria-label=\"Search garden projects\"]');input.focus();input.value='starter';input.dispatchEvent(new Event('input'));return {oneScroll:!root.querySelector('.trellis-home-list'),search:input.value};})()"); assert.equal(geometry.oneScroll, true); // NEW
    await expression("smokeUi.__trellisGardenHome.projectLoadHeaders.communities.reload.click()"); // NEW
    await wait("smokeUi.__trellisGardenHome.communitiesRows?.textContent.includes('2 users')", 'project refresh'); // NEW
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
    const result = { ok: true, splashIdentityStatus: true, signedOutLocalFiles: true, relocatedIdentityControls: true, starter, invitationHandoff: true, membershipClassification: true, communityGrouping: true, metadataRename: true, personalFilename: true, suffixPrivacy: true, unsavedEditPreserved: true, trashAndRestore: true, keyboardNavigation: true, smallWindow: small, output }; // CHANGE
    fs.writeFileSync(path.join(output, 'projects-checks.json'), JSON.stringify(result, null, 2)); console.log('PROJECTS_SMOKE:', JSON.stringify(result)); // NEW
} // NEW
