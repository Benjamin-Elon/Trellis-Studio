require('../../src/main/trellis-asset-scheme.cjs'); // NEW: production protocol privileges must precede app readiness.
/** Native-input regression against the real desktop entrypoint and plugin loader. */ // NEW
const assert = require('node:assert/strict'); // NEW
const fs = require('node:fs'); // NEW
const os = require('node:os'); // NEW
const path = require('node:path'); // NEW
const { pathToFileURL } = require('node:url'); // NEW
const childProcess = require('node:child_process'); // NEW
const { syncBuiltinESMExports } = require('node:module'); // NEW
const { app, dialog, ipcMain, session } = require('electron'); // NEW
const project = path.resolve(__dirname, '../..'); // NEW
const output = path.join(project, '.test-artifacts/garden-settings-focus', String(process.pid)); // NEW
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'trellis-settings-focus-')); // NEW
const foreground = process.env.TRELLIS_SETTINGS_FOCUS_FOREGROUND === '1'; // NEW: normal test runs follow the existing hidden Electron fixture convention.
const children = new Set(), originalSpawn = childProcess.spawn; // NEW
childProcess.spawn = (...args) => { const child = originalSpawn(...args); children.add(child); child.once('close', () => children.delete(child)); return child; }; syncBuiltinESMExports(); // NEW
for (const name of ['appData', 'documents', 'userData', 'sessionData']) { const dir = path.join(profile, name); fs.mkdirSync(dir); app.setPath(name, dir); } // NEW
app.disableHardwareAcceleration(); app.commandLine.appendSwitch('in-process-gpu'); // NEW
let win, stage = 'startup', heldQuery = null, holdCities = false, closing = false; // NEW
const runDeadline = Date.now() + 125000; // CHANGE: every operation shares the existing test-wide budget, including real identity/daemon startup.
const databaseEvents = [], collaborationEvents = []; // CHANGE: retain safe target-level diagnostics from this test's real IPC boundary.
app.on('browser-window-created', (_event, created) => { win = created; created.hide(); created.webContents.setBackgroundThrottling(false); created.webContents.on('console-message', event => { if (event.message?.startsWith('Focus regression renderer:')) console.error(event.message); }); }); // NEW
const delay = ms => new Promise(resolve => setTimeout(resolve, ms)); // NEW
/** Bound each renderer operation independently and identify the operation that stalled. */ // CHANGE
async function run(source, label = stage) { // CHANGE
    stage = label; let timer; // CHANGE
    try { return await Promise.race([win.webContents.executeJavaScript('try {\n' + source + '\n} catch (error) { console.error("Focus regression renderer:", error.stack); throw error; }'), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Renderer operation timed out: ' + label)), Math.max(1, runDeadline - Date.now())); })]); } // CHANGE: do not introduce a shorter startup deadline than the original 125-second watchdog.
    finally { clearTimeout(timer); } // CHANGE
} // CHANGE
const watchdog = setTimeout(() => { console.error('Focus regression stalled at ' + stage); void finish(1); }, 125000); // NEW

/** Readiness polling must never repair focus or replace missing native input. */ // NEW
async function until(source, label) { // NEW
    stage = label; const deadline = Date.now() + 15000; // NEW
    while (Date.now() < deadline) { if (await run(source).catch(() => false)) return; await delay(20); } // NEW
    throw new Error('Timed out waiting for ' + label); // NEW
} // NEW

/** Hit-test and click the real control; a successful DOM focus call is insufficient. */ // NEW
async function click(selector) { // NEW
    await run(`document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({block:'nearest'});focusFrames()`); // NEW: City Manager's footer is inside a scrolling form.
    const point = await run(`(() => { const node=document.querySelector(${JSON.stringify(selector)});if(!node)throw new Error('Missing test control');const rect=node.getBoundingClientRect();const x=Math.round(rect.left+rect.width/2),y=Math.round(rect.top+rect.height/2);if(!node.contains(document.elementFromPoint(x,y)))throw new Error('Control is covered: '+node.tagName);return{x,y}; })()`); // NEW
    for (const type of ['mouseMove', 'mouseDown', 'mouseUp']) win.webContents.sendInputEvent({ type, ...point, button: 'left', clickCount: 1 }); // NEW
    await run('focusFrames()'); // NEW
} // NEW
async function key(keyCode, modifiers = []) { // NEW
    for (const type of ['keyDown', 'keyUp']) win.webContents.sendInputEvent({ type, keyCode, modifiers }); // NEW
    await run('focusFrames()'); // NEW
} // NEW
async function type(text) { // NEW
    for (const keyCode of text) win.webContents.sendInputEvent({ type: 'char', keyCode }); // NEW
    await run('focusFrames()'); // NEW
} // NEW
async function replaceText(selector, text) { // NEW
    await click(selector); await key('A', ['control']); await type(text); // NEW
} // NEW
async function markButton(label, marker, topOnly = true) { // NEW
    await run(`(() => { const root=${topOnly ? 'focusUi.dialog.container' : 'document'};const node=[...root.querySelectorAll('button')].find(node=>node.textContent===${JSON.stringify(label)});if(!node)throw new Error('Missing '+${JSON.stringify(label)});node.setAttribute('data-focus-action',${JSON.stringify(marker)}); })()`); // NEW
    return '[data-focus-action="' + marker + '"]'; // NEW
} // NEW

/** Prepare a populated, saved diagram; the reported failure is adding a subsequent garden. */ // NEW
async function initialize() { // NEW
    await app.whenReady(); // NEW
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => callback({ cancel: true })); // NEW
    await import(pathToFileURL(path.join(project, 'src/main/electron.js'))); // NEW
    await until('!!window.Draw?.loadPlugin && !!window.TrellisGardenHome', 'production loader'); // NEW
    await run('new Promise(resolve=>Draw.loadPlugin(ui=>{window.focusUi=ui;const loaded=ui.fileLoaded;ui.fileLoaded=function(){const result=loaded.apply(this,arguments);Promise.resolve(result).then(()=>{window.focusInitialFileLoaded=true});return result;};resolve();}))', 'editor plugin callback'); // CHANGE
    await until('!!window.focusInitialFileLoaded && !focusUi.openingFile', 'initial file load'); // CHANGE: plugin installation precedes asynchronous startup loading.
    await run(`localStorage.setItem('trellis.licenseWizard.v2',JSON.stringify({version:'2',path:'personal',contactGuidance:false,oathCompletedAt:new Date().toISOString(),name:'Focus Test',signature:'Focus Test',email:'focus@example.test'}));focusUi.hideDialog();focusUi.showSplash(true);`); // NEW
    await run(`trellisIdentity.create({username:'Focus Test',password:'focus-test-password'}).then(()=>true)`, 'create identity'); // CHANGE
    await run(`trellisGardenLibrary.create({name:'Focus test'}).then(garden=>{window.focusGarden=garden;return true;})`, 'create library garden'); // CHANGE
    await run(`TrellisGardenHome.openPath(focusUi,focusGarden.path).then(()=>true)`, 'open library garden'); // CHANGE
    await until('!!focusUi.editor.graph.__trellisModules && !!focusUi.editor.graph.__trellisTaskManager && !!focusUi.editor.graph.__trellisRoadmapManager && !!focusUi.getCurrentFile()', 'companion plugins'); // NEW
    await run('Trellis.sharing.refresh()', 'initial collaboration base'); // CHANGE: settle the opened file's remembered view before authoring fixture cells.
    await run(`window.graph=focusUi.editor.graph;window.focusFrames=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));window.gardenSearch=()=>document.querySelector('input[placeholder="Search city, country, or region"]');window.clusterCounts=()=>['garden_module','team_module','task_module','roadmap_module'].map(attr=>Object.values(graph.model.cells).filter(cell=>cell.getAttribute?.(attr)==='1').length);void 0;`); // NEW
    await run(`window.firstGarden=graph.__trellisModules.createModuleAtPoint({x:100,y:100},'garden');const value=firstGarden.value.cloneNode(true);value.setAttribute('city_id','1');value.setAttribute('city_name','Buenos Aires');value.setAttribute('unit_system','metric');graph.model.setValue(firstGarden,value);void 0;`, 'create configured module'); // CHANGE
    await until('[...document.querySelectorAll("button")].some(node=>node.textContent==="Set Garden Settings" && node.offsetWidth>0)', 'initial settings action'); // CHANGE: the programmatic module factory selects the module; the visible action opens its settings.
    await run(`[...document.querySelectorAll('button')].find(button=>button.textContent==='Set Garden Settings' && button.offsetWidth>0).click();void 0;`, 'open initial garden settings'); // CHANGE
    await until('!!gardenSearch()', 'initial garden settings'); // CHANGE
    await run(`gardenSearch().value='Buenos';gardenSearch().dispatchEvent(new Event('input'));gardenSearch().dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));[...focusUi.dialog.container.querySelectorAll('button')].find(button=>button.textContent==='OK').click();void 0;`, 'accept initial garden settings'); // CHANGE: select the real city key and finalize its reference manifest instead of assuming city ID 1.
    await until('firstGarden.getAttribute("trellis_reference_pending","")!=="1" && focusUi.dialogs.length===0', 'initial garden references accepted'); // CHANGE
    await run(`new Promise((resolve,reject)=>focusUi.getCurrentFile().save(false,()=>resolve(true),reject))`, 'save configured module'); // CHANGE
    await run('focusFrames()'); // NEW
    assert.deepEqual(await run('clusterCounts()'), [1, 1, 1, 1]); // NEW
    if (process.env.TRELLIS_SETTINGS_FOCUS_TRACE === '1') await run(fs.readFileSync(path.join(__dirname, 'garden-settings-focus-trace.js'), 'utf8')); // NEW: normal regressions must not depend on instrumented focus functions.
    // Hold only this sample window's Cities SELECT, preserving the production preload and SQL handler. // NEW
    const [handler] = ipcMain.listeners('rendererReq'); assert.ok(handler); // NEW
    const { diffObjects } = await import(pathToFileURL(path.join(project, 'src/main/trellis-collaboration-protocol.js'))); // CHANGE
    ipcMain.removeListener('rendererReq', handler); // NEW
    ipcMain.on('rendererReq', (event, args) => { // NEW
        if (args.action === 'trellisShare' && args.method === 'collaborationAction') { const input = args.payload; let targets = input.targets; try { if (process.env.TRELLIS_SETTINGS_FOCUS_TRACE === '1' && input.xml && input.baseXml) targets = diffObjects(input.baseXml, input.xml).targets; } catch (error) { targets = [error.message]; } collaborationEvents.push({stage,kind:input.kind,targets}); } // CHANGE: expensive document-diff diagnostics are opt-in so they cannot change normal native timing.
        if ((args.action === 'dbQuery' || args.action === 'trellisReferences' && args.method === 'query') && /SELECT\s+\*\s+FROM\s+Cities\s+ORDER/i.test(args.sql || args.payload?.sql || '')) { // CHANGE: new gardens query their captured reference database through the production bridge.
            databaseEvents.push({ kind: 'cities-query', held: holdCities }); // NEW
            if (holdCities) { holdCities = false; heldQuery = () => { databaseEvents.push({ kind: 'cities-release' }); return handler(event, args); }; return; } // NEW
        } // NEW
        return handler(event, args); // NEW
    }); // NEW
    // Activate the test surface once before creation; never repair focus after opening a field. // NEW
    if (foreground) win.show(); else win.webContents.focus(); // NEW
    await until('document.hasFocus()', 'initial surface activation'); // NEW
} // NEW

/** Exercise the actual Add Garden Module overlay, with existing clusters left intact. */ // NEW
async function createGarden(pass, delayed) { // NEW
    stage = 'create garden ' + pass; holdCities = delayed; // NEW
    await run(`while(focusUi.dialogs?.length)focusUi.hideDialog();graph.view.setScale(1);const bounds=graph.getGraphBounds();const right=(bounds.x+bounds.width)/graph.view.scale-graph.view.translate.x;graph.view.setTranslate(-(right+1000),0);graph.container.scrollLeft=0;graph.container.scrollTop=0;graph.view.validate();void 0;`); // CHANGE: choose actual empty canvas beyond current content instead of assuming every module is narrower than 5,000 pixels.
    await run('focusFrames()'); // NEW
    const point = await run('(()=>{const rect=graph.container.getBoundingClientRect();for(const y of [250,350,450])for(const x of [180,380,580]){const hit=document.elementFromPoint(rect.left+x,rect.top+y);if(hit&&graph.container.contains(hit)&&!graph.getCellAt(x+graph.container.scrollLeft,y+graph.container.scrollTop))return{x:Math.round(rect.left+x),y:Math.round(rect.top+y)};}throw Error("No unobstructed empty canvas point");})()'); // CHANGE: the dashboard must not intercept the fixture gesture.
    for (const type of ['mouseMove', 'mouseDown', 'mouseUp']) win.webContents.sendInputEvent({ type, ...point, button: 'left', clickCount: 1 }); // NEW
    await until('!!document.querySelector(".trellis-root-module-overlay") && getComputedStyle(document.querySelector(".trellis-root-module-overlay")).display!=="none"', 'creation controls'); // NEW
    await click(await markButton('Add Garden Module', 'create-' + pass, false)); // NEW
    if (delayed) { // NEW
        const deadline = Date.now() + 10000; while (!heldQuery && Date.now() < deadline) await delay(20); // NEW
        assert.ok(heldQuery, 'the real city request must reach the held database boundary'); // NEW
        assert.equal(await run('!!gardenSearch()'), false); // NEW
        await run('focusFrames()'); const release = heldQuery; heldQuery = null; await release(); // NEW
    } // NEW
    await until('!!gardenSearch()', 'automatically opened settings'); // NEW
    await run(`window.settingsBody=focusUi.dialog.container.firstChild;window.nameField=settingsBody.querySelector('input[type=text]');nameField.setAttribute('data-focus-name','1');gardenSearch().setAttribute('data-focus-search','1');gardenSearch().parentElement.previousElementSibling.setAttribute('data-focus-city','1');window.createdGarden=graph.model.getCell(focusUi.dialog.container.querySelector('[data-quickstart-garden]').dataset.quickstartGarden);if(createdGarden?.getAttribute('garden_module')!=='1')throw Error('Settings did not identify its garden');void 0;`); // CHANGE: companion initialization may change selection; the settings surface carries the actual edited module ID.
    assert.deepEqual(await run('clusterCounts()'), Array(4).fill(pass + 1)); // NEW
    console.log('INITIAL_FOCUS:', JSON.stringify(await run('({name:document.activeElement===nameField,tag:document.activeElement.tagName,type:document.activeElement.type,documentFocus:document.hasFocus(),insideDialog:focusUi.dialog.container.contains(document.activeElement),editing:graph.isEditing(),mouseDown:graph.isMouseDown})'))); // NEW
    assert.equal(await run('document.activeElement===nameField'), true, 'new settings receive initial focus'); // NEW
    assert.equal(await run('document.hasFocus()'), true); if (foreground) assert.equal(win.isFocused(), true); assert.equal(win.webContents.isFocused(), true); // NEW
} // NEW

/** Browser-default editing, filtering and Escape must work after all creation callbacks. */ // NEW
async function verifyInputs(pass) { // NEW
    await replaceText('[data-focus-name]', 'Second garden'); // NEW
    assert.equal(await run('nameField.value'), 'Second garden'); // NEW
    await key('Left', ['shift']); assert.equal(await run('nameField.selectionEnd-nameField.selectionStart'), 1); await key('Backspace'); // NEW
    assert.equal(await run('nameField.value'), 'Second garde'); // NEW
    await key('A', ['control']); assert.equal(await run('nameField.selectionEnd-nameField.selectionStart'), 12); // NEW
    await type('Garden ' + pass); // NEW
    await key('Tab'); assert.equal(await run('document.activeElement.type'), 'select-one'); // CHANGE: Start from is now the first native control after the garden name.
    await key('Tab', ['shift']); assert.equal(await run('document.activeElement===nameField'), true); // NEW
    await click('[data-focus-city]'); assert.equal(await run('document.activeElement===gardenSearch()'), true); // NEW
    await type('zzzz-no-matching-city'); assert.equal(await run('gardenSearch().nextElementSibling.textContent'), 'No matching cities'); // NEW
    await replaceText('[data-focus-search]', 'Buenos'); // NEW
    assert.equal(await run('gardenSearch().nextElementSibling.querySelectorAll("button").length>0'), true); // NEW
    await key('Enter'); assert.equal(await run('gardenSearch().parentElement.style.display'), 'none'); // NEW
    assert.equal(await run('settingsBody.isConnected'), true); // NEW
    await click('[data-focus-city]'); await key('Escape'); // NEW
    assert.equal(await run('settingsBody.isConnected'), true, 'Escape closes only the city picker, not Garden Settings'); // NEW
    assert.equal(await run('gardenSearch().parentElement.style.display'), 'none'); // NEW
    assert.equal(await run('document.activeElement.hasAttribute("data-focus-city")'), true); // NEW
    await click(await markButton('Manage...', 'manage')); // CHANGE
    assert.equal(await run('focusUi.dialog.container.textContent.includes("Save the new garden before proposing city definition changes.")'), true); // CHANGE: unsaved reference scopes intentionally cannot open City Manager.
    assert.equal(await run('focusUi.dialogs.length'), 1); // CHANGE
    await click(await markButton('Cancel', 'cancel')); await run('focusFrames()'); // NEW
    assert.equal(await run('focusUi.dialogs.length'), 0); await until('document.activeElement===graph.container', 'editor focus restoration'); // NEW: observe the editor's queued close callback without repairing it.
    assert.equal(await run('createdGarden.getAttribute("unit_system", "")'), ''); // NEW: Cancel must not persist draft settings or city selection.
    // Reopening the same settings manually is the comparison path from the report. // NEW
    await until('[...document.querySelectorAll("button")].some(node=>node.textContent==="Set Garden Settings" && node.offsetWidth>0)', 'manual settings action'); // NEW
    await click(await markButton('Set Garden Settings', 'manual', false)); await until('!!gardenSearch()', 'manual settings'); // NEW
    assert.equal(await run('focusUi.dialog.container.querySelector("[data-quickstart-garden]").dataset.quickstartGarden'), await run('createdGarden.id'), 'manual settings reopen the same garden'); // CHANGE: distinguish a selection change from saving the wrong module.
    await run(`focusUi.dialog.container.querySelector('input[type=text]').setAttribute('data-focus-reopened','1');void 0;`); // NEW
    await replaceText('[data-focus-reopened]', 'Reopened'); // NEW
    assert.equal(await run('document.querySelector("[data-focus-reopened]").value'), 'Reopened'); // NEW
    if (pass === 1) { // NEW
        // Reach Units through native Tab order, then let its change handler populate dimension defaults. // NEW
        for (let step = 0; step < 16 && await run('!document.activeElement.querySelector?.("option[value=metric]")'); step++) await key('Tab'); // CHANGE: pass the new Start from selector and circle limits on the way to Units.
        assert.equal(await run('!!document.activeElement.querySelector("option[value=metric]")'), true); // CHANGE
        await key('Down'); assert.equal(await run('document.activeElement.value'), 'metric'); // NEW
        await click(await markButton('OK', 'save')); await until('focusUi.dialogs.length===0', 'settings saved'); // NEW
        console.log('SAVED_GARDEN:', JSON.stringify(await run('({id:createdGarden.id,same:graph.model.getCell(createdGarden.id)===createdGarden,name:graph.model.getCell(createdGarden.id)?.getAttribute("garden_name"),status:focusUi.editor.status,gardens:Object.values(graph.model.cells).filter(c=>c.getAttribute?.("garden_module")==="1").map(c=>({id:c.id,name:c.getAttribute("garden_name"),pending:c.getAttribute("trellis_reference_pending")}))})'))); // CHANGE: summarize saved state without dumping the embedded reference database into the child output buffer.
        assert.equal(await run('graph.model.getCell(createdGarden.id)?.getAttribute("garden_name")'), 'Reopened'); // CHANGE: assert persisted state from the live model.
        await run('window.createdGarden=graph.model.getCell(createdGarden.id);void 0;'); // CHANGE: subsequent assertions use the current collaboration projection after verifying the saved name.
        assert.equal(await run('createdGarden.getAttribute("unit_system")'), 'metric'); // NEW
        assert.ok(await run('createdGarden.getAttribute("city_id")')); // NEW
        await until('[...document.querySelectorAll("button")].some(node=>node.textContent==="Edit Garden Settings" && node.offsetWidth>0)', 'saved garden settings action'); // CHANGE: configured gardens expose the edit action.
        await click(await markButton('Edit Garden Settings', 'saved-manual', false)); await until('!!gardenSearch()', 'saved garden settings'); // CHANGE
        await click(await markButton('Manage...', 'saved-manage')); await until('focusUi.dialogs.length===2', 'City Manager'); // CHANGE: exercise nested focus only after the required reference manifest exists.
        await run(`focusUi.dialog.container.querySelector('input:not([type]), input[type=text]').setAttribute('data-focus-manager','1');void 0;`); // CHANGE
        await replaceText('[data-focus-manager]', 'Manager draft'); assert.equal(await run('document.querySelector("[data-focus-manager]").value'), 'Manager draft'); // CHANGE
        await run('focusFrames()'); assert.equal(await run('document.activeElement.hasAttribute("data-focus-manager")'), true); // CHANGE
        await click(await markButton('Close', 'manager-close')); await until('focusUi.dialogs.length===1', 'parent settings restored'); // CHANGE
        await click(await markButton('Cancel', 'saved-cancel')); // CHANGE
    } else { // NEW
        await click(await markButton('Cancel', 'manual-cancel')); // NEW
    } // NEW
} // NEW

/** Preserve diagnostics on failure and always stop this profile's owned transports. */ // NEW
async function finish(code) { // NEW
    if (closing) return; closing = true; clearTimeout(watchdog); // NEW
    const emergency = setTimeout(() => { for (const child of children) if (child.exitCode == null) child.kill(); app.exit(code || 1); }, 12000); // NEW
    try { // NEW
        if (win && !win.isDestroyed()) { // NEW
            fs.mkdirSync(output, { recursive: true }); // NEW
            const trace = await run('window.trellisGardenFocusTrace?.stop()'); // NEW
            const state = await run('({activeTag:document.activeElement.tagName,activeType:document.activeElement.type,documentFocus:document.hasFocus(),insideDialog:!!window.focusUi?.dialog?.container.contains(document.activeElement),editing:window.graph?.isEditing(),mouseDown:window.graph?.isMouseDown})'); // CHANGE: startup failures precede graph initialization and still need diagnostics.
            fs.writeFileSync(path.join(output, 'trace.json'), JSON.stringify({ stage, windowFocus: win.isFocused(), webFocus: win.webContents.isFocused(), state, databaseEvents, collaborationEvents, trace }, null, 2)); // CHANGE
            if (code) fs.writeFileSync(path.join(output, 'failure.png'), (await win.webContents.capturePage()).toPNG()); // NEW
        } // NEW
    } catch (error) { console.error('Diagnostic capture:', error.message); } // NEW
    dialog.showMessageBoxSync = () => 1; // NEW: discard only this fixture's unsaved sample document.
    app.once('will-quit', event => { event.preventDefault(); clearTimeout(emergency); app.exit(code); }); app.quit(); // NEW
} // NEW
(async () => { // NEW
    await initialize(); // NEW
    for (const [index, delayed] of [false, true].entries()) { await createGarden(index + 1, delayed); await verifyInputs(index + 1); } // NEW
    console.log('GARDEN_SETTINGS_FOCUS:passed'); await finish(0); // NEW
})().catch(async error => { console.error(stage + ': ' + (error.stack || error)); console.error('Diagnostics: ' + output); await finish(1); }); // NEW
