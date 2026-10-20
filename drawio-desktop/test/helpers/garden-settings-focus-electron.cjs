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
const databaseEvents = []; // NEW
app.on('browser-window-created', (_event, created) => { win = created; created.hide(); created.webContents.setBackgroundThrottling(false); created.webContents.on('console-message', event => { if (event.message?.startsWith('Focus regression renderer:')) console.error(event.message); }); }); // NEW
const delay = ms => new Promise(resolve => setTimeout(resolve, ms)); // NEW
const run = source => win.webContents.executeJavaScript('try {\n' + source + '\n} catch (error) { console.error("Focus regression renderer:", error.stack); throw error; }'); // NEW
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
    await run('new Promise(resolve=>Draw.loadPlugin(ui=>{window.focusUi=ui;resolve();}))'); // NEW
    await run(`localStorage.setItem('trellis.licenseWizard.v2',JSON.stringify({version:'2',path:'personal',contactGuidance:false,oathCompletedAt:new Date().toISOString(),name:'Focus Test',signature:'Focus Test',email:'focus@example.test'}));focusUi.hideDialog();focusUi.showSplash(true);`); // NEW
    await run(`(async()=>{await trellisIdentity.create({username:'Focus Test',password:'focus-test-password'});window.focusGarden=await trellisGardenLibrary.create({name:'Focus test'});await TrellisGardenHome.openPath(focusUi,focusGarden.path);})()`); // NEW
    await until('!!focusUi.editor.graph.__trellisModules && !!focusUi.editor.graph.__trellisTaskManager && !!focusUi.editor.graph.__trellisRoadmapManager && !!focusUi.getCurrentFile()', 'companion plugins'); // NEW
    await run(`window.graph=focusUi.editor.graph;window.focusFrames=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));window.gardenSearch=()=>document.querySelector('input[placeholder="Search city, country, or region"]');window.clusterCounts=()=>['garden_module','team_module','task_module','roadmap_module'].map(attr=>Object.values(graph.model.cells).filter(cell=>cell.getAttribute?.(attr)==='1').length);void 0;`); // NEW
    await run(`(async()=>{window.firstGarden=graph.__trellisModules.createModuleAtPoint({x:100,y:100},'garden');const value=firstGarden.value.cloneNode(true);value.setAttribute('city_id','1');value.setAttribute('city_name','Buenos Aires');value.setAttribute('unit_system','metric');graph.model.setValue(firstGarden,value);await new Promise((resolve,reject)=>focusUi.getCurrentFile().save(false,resolve,reject));})()`); // NEW
    await run('focusFrames()'); // NEW
    assert.deepEqual(await run('clusterCounts()'), [1, 1, 1, 1]); // NEW
    if (process.env.TRELLIS_SETTINGS_FOCUS_TRACE === '1') await run(fs.readFileSync(path.join(__dirname, 'garden-settings-focus-trace.js'), 'utf8')); // NEW: normal regressions must not depend on instrumented focus functions.
    // Hold only this sample window's Cities SELECT, preserving the production preload and SQL handler. // NEW
    const [handler] = ipcMain.listeners('rendererReq'); assert.ok(handler); // NEW
    ipcMain.removeListener('rendererReq', handler); // NEW
    ipcMain.on('rendererReq', (event, args) => { // NEW
        if (args.action === 'dbQuery' && /SELECT\s+\*\s+FROM\s+Cities\s+ORDER/i.test(args.sql || '')) { // NEW
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
    await run(`while(focusUi.dialogs?.length)focusUi.hideDialog();graph.view.setScale(1);graph.view.setTranslate(-${pass * 5000},0);graph.container.scrollLeft=0;graph.container.scrollTop=0;void 0;`); // NEW
    await run('focusFrames()'); // NEW
    const point = await run('(()=>{const rect=graph.container.getBoundingClientRect();return{x:Math.round(rect.left+180),y:Math.round(rect.top+160)};})()'); // NEW
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
    await run(`window.settingsBody=focusUi.dialog.container.firstChild;window.nameField=settingsBody.querySelector('input[type=text]');nameField.setAttribute('data-focus-name','1');gardenSearch().setAttribute('data-focus-search','1');gardenSearch().parentElement.previousElementSibling.setAttribute('data-focus-city','1');window.createdGarden=graph.getSelectionCell();void 0;`); // NEW
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
    await key('Tab'); assert.equal(await run('document.activeElement.type'), 'number'); // NEW
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
    // Opening a child dialog must not let delayed parent work reclaim focus. // NEW
    await click(await markButton('Manage...', 'manage')); await until('focusUi.dialogs.length===2', 'City Manager'); // NEW
    await run(`focusUi.dialog.container.querySelector('input:not([type]), input[type=text]').setAttribute('data-focus-manager','1');void 0;`); // NEW
    await replaceText('[data-focus-manager]', 'Manager draft'); // NEW
    assert.equal(await run('document.querySelector("[data-focus-manager]").value'), 'Manager draft'); // NEW
    await run('focusFrames()'); assert.equal(await run('document.activeElement.hasAttribute("data-focus-manager")'), true); // NEW
    await click(await markButton('Close', 'manager-close')); await until('focusUi.dialogs.length===1', 'parent settings restored'); // NEW
    await click(await markButton('Cancel', 'cancel')); await run('focusFrames()'); // NEW
    assert.equal(await run('focusUi.dialogs.length'), 0); await until('document.activeElement===graph.container', 'editor focus restoration'); // NEW: observe the editor's queued close callback without repairing it.
    assert.equal(await run('createdGarden.getAttribute("unit_system", "")'), ''); // NEW: Cancel must not persist draft settings or city selection.
    // Reopening the same settings manually is the comparison path from the report. // NEW
    await until('[...document.querySelectorAll("button")].some(node=>node.textContent==="Set Garden Settings" && node.offsetWidth>0)', 'manual settings action'); // NEW
    await click(await markButton('Set Garden Settings', 'manual', false)); await until('!!gardenSearch()', 'manual settings'); // NEW
    await run(`focusUi.dialog.container.querySelector('input[type=text]').setAttribute('data-focus-reopened','1');void 0;`); // NEW
    await replaceText('[data-focus-reopened]', 'Reopened'); // NEW
    assert.equal(await run('document.querySelector("[data-focus-reopened]").value'), 'Reopened'); // NEW
    if (pass === 1) { // NEW
        // Reach Units through native Tab order, then let its change handler populate dimension defaults. // NEW
        for (let step = 0; step < 8 && await run('document.activeElement.tagName!=="SELECT"'); step++) await key('Tab'); // NEW
        assert.equal(await run('document.activeElement.tagName'), 'SELECT'); // NEW
        await key('Down'); assert.equal(await run('document.activeElement.value'), 'metric'); // NEW
        await click(await markButton('OK', 'save')); await until('focusUi.dialogs.length===0', 'settings saved'); // NEW
        assert.equal(await run('createdGarden.getAttribute("garden_name")'), 'Reopened'); // NEW
        assert.equal(await run('createdGarden.getAttribute("unit_system")'), 'metric'); // NEW
        assert.ok(await run('createdGarden.getAttribute("city_id")')); // NEW
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
            const state = await run('({activeTag:document.activeElement.tagName,activeType:document.activeElement.type,documentFocus:document.hasFocus(),insideDialog:!!focusUi.dialog?.container.contains(document.activeElement),editing:graph.isEditing(),mouseDown:graph.isMouseDown})'); // NEW
            fs.writeFileSync(path.join(output, 'trace.json'), JSON.stringify({ stage, windowFocus: win.isFocused(), webFocus: win.webContents.isFocused(), state, databaseEvents, trace }, null, 2)); // NEW
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
