/** Production plugin loading, selection recovery, modal handoff, and narrow-window accessibility. */ // NEW
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

module.exports = async function quickstartProduction({ window, until, output }) { // NEW
    const run = expression => window.webContents.executeJavaScript(expression);
    const wait = (expression, label) => until(() => run(expression), label, 20000);
    const frames = () => run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))'); // NEW
    await run("trellisIdentity.create({username:'Quickstart Smoke',password:'isolated-quickstart-smoke-password',keepLoggedIn:true})");
    await run("TrellisGardenHome.showProjects(smokeUi,{focus:'create'})");
    await wait("!![...document.querySelectorAll('.trellis-projects-root button')].find(node=>node.textContent==='Create New Private Garden Project'&&!node.disabled)", 'quickstart project creation control');
    await run("(()=>{[...document.querySelectorAll('.trellis-projects-root button')].find(node=>node.textContent==='Create New Private Garden Project').click();const form=smokeUi.__trellisGardenHome.creationForm;form.querySelector('input').value='Quickstart garden';form.requestSubmit();})()");
    await wait("!smokeUi.__trellisGardenHome.creating && !!smokeUi.editor.graph.__trellisQuickstart && Object.values(smokeUi.editor.graph.model.cells).some(cell=>cell.value?.getAttribute?.('garden_module')==='1')", 'production quickstart plugin and starter garden');
    await run("(()=>{window.quickstartGarden=Object.values(smokeUi.editor.graph.model.cells).find(cell=>cell.value?.getAttribute?.('garden_module')==='1');smokeUi.hideDialog();smokeUi.editor.graph.clearSelection();smokeUi.actions.get('trellisQuickstart').funct();})()");
    await wait("!!document.querySelector('[data-quickstart-focus=layout]')", 'quickstart checklist');
    await run("document.querySelector('[data-quickstart-focus=layout]').click()");
    await wait("document.querySelector('.trellis-quickstart-card')?.textContent.includes('to show its layout controls')", 'explicit garden selection prompt');
    assert.equal(await run('smokeUi.editor.graph.getSelectionCount()'), 0);
    await run('smokeUi.editor.graph.setSelectionCell(quickstartGarden)');
    await wait("document.querySelector('.trellis-quickstart-card')?.textContent.includes('Finish Garden Settings first')", 'settings prerequisite after selection');

    const dragBefore = await run("(()=>{const handle=document.querySelector('[data-trellis-quickstart-drag-handle]'),box=handle.closest('section').getBoundingClientRect(),grip=handle.getBoundingClientRect(),graph=smokeUi.editor.graph;return {left:box.left,top:box.top,x:Math.round(grip.left+grip.width/2),y:Math.round(grip.top+grip.height/2),xml:mxUtils.getXml(new mxCodec().encode(graph.model)),selection:graph.getSelectionCells().map(cell=>cell.id),handleWidth:grip.width,icon:handle.querySelector('img').src};})()"); // NEW
    assert.equal(dragBefore.handleWidth, 18); assert.equal(dragBefore.icon, await run('Editor.moveImage')); // NEW
    window.webContents.sendInputEvent({ type: 'mouseDown', x: dragBefore.x, y: dragBefore.y, button: 'left', clickCount: 1 }); await frames(); // NEW
    window.webContents.sendInputEvent({ type: 'mouseMove', x: dragBefore.x + 60, y: dragBefore.y + 45, button: 'left' }); await frames(); // NEW
    await run('smokeUi.editor.graph.__trellisQuickstart.refresh()'); await frames(); // NEW: a render during dragging must not override movement.
    window.webContents.sendInputEvent({ type: 'mouseUp', x: dragBefore.x + 60, y: dragBefore.y + 45, button: 'left', clickCount: 1 }); await frames(); // NEW
    await wait("!document.querySelector('.trellis-quickstart-dragging')", 'mouse drag release'); // NEW
    await run('smokeUi.editor.graph.__trellisQuickstart.refresh()'); await frames(); // NEW
    const dragAfter = await run("(()=>{const box=document.querySelector('.trellis-quickstart-card').getBoundingClientRect(),graph=smokeUi.editor.graph;return {left:box.left,top:box.top,xml:mxUtils.getXml(new mxCodec().encode(graph.model)),selection:graph.getSelectionCells().map(cell=>cell.id),saved:graph.__trellisQuickstart.getState().preferences.position};})()"); // NEW
    assert.ok(Math.abs(dragAfter.left - dragBefore.left - 60) <= 1 && Math.abs(dragAfter.top - dragBefore.top - 45) <= 1, JSON.stringify({ dragBefore: { left: dragBefore.left, top: dragBefore.top }, dragAfter })); // NEW
    assert.equal(dragAfter.xml, dragBefore.xml); assert.deepEqual(dragAfter.selection, dragBefore.selection); // NEW
    assert.deepEqual(dragAfter.saved, { x: dragAfter.left, y: dragAfter.top }); // NEW
    fs.writeFileSync(path.join(output, 'quickstart-drag.png'), (await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG()); // NEW
    const position = await run("(()=>{const node=document.querySelector('[data-trellis-quickstart-drag-handle]');const before=node.closest('section').getBoundingClientRect().left;node.focus();node.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));const box=node.closest('section').getBoundingClientRect();return {before,left:box.left,right:box.right,width:innerWidth};})()"); // NEW
    assert.ok(position.left > position.before && position.right <= position.width, JSON.stringify(position)); // NEW: verify movement, not only containment.
    window.setSize(460, 720);
    await wait("innerWidth<=460", 'narrow quickstart viewport');
    const narrow = await run("(()=>{const node=document.querySelector('.trellis-quickstart-card'),box=node.getBoundingClientRect();return {left:box.left,right:box.right,width:innerWidth,overflow:node.scrollWidth>node.clientWidth+1};})()");
    assert.ok(narrow.left >= 0 && narrow.right <= narrow.width + 1 && !narrow.overflow, JSON.stringify(narrow));
    fs.writeFileSync(path.join(output, 'quickstart-narrow.png'), (await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG());
    window.setSize(1100, 850);
    await wait('innerWidth>=1000', 'restored quickstart viewport'); await frames(); // NEW

    window.setSize(1920, 1080); await wait('innerWidth>=1800', 'wide companion viewport'); // CHANGE
    await run("document.querySelector('[data-quickstart-focus=settings]').click();document.querySelector('[data-trellis-quickstart=settings]').click()"); // CHANGE
    await wait("!!smokeUi.dialog && !!smokeUi.editor.graph.__trellisQuickstart.getCompanion(smokeUi.dialog.container)", 'settings companion ownership'); // CHANGE
    const settingsCompanion = await run("(()=>{const card=document.querySelector('.trellis-quickstart-card'),box=card.getBoundingClientRect(),dialog=smokeUi.dialog.container.getBoundingClientRect(),handle=card.querySelector('[data-trellis-quickstart-drag-handle]');return {width:box.width,beside:box.left>=dialog.right+11||box.right<=dialog.left-11,visible:!handle.hidden,body:card.parentNode===document.body};})()"); // CHANGE
    assert.deepEqual(settingsCompanion, { width: 310, beside: true, visible: true, body: true }); // CHANGE
    fs.writeFileSync(path.join(output, 'quickstart-settings-companion.png'), (await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG()); // CHANGE
    await run("(()=>{const units=document.querySelector('[data-trellis-quickstart=settings-units]');units.value='metric';units.dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('[data-trellis-quickstart=settings-save]').click();})()"); // CHANGE: initialize the real garden references through the normal settings commit before opening its planner.
    await wait("!smokeUi.dialog && !!document.querySelector('[data-quickstart-focus=plan]')", 'canvas checklist after settings'); // CHANGE
    await run("document.querySelector('[data-quickstart-focus=plan]').click();window.dispatchEvent(new CustomEvent('usl:planYearRequested',{detail:{moduleCellId:quickstartGarden.id,year:smokeUi.editor.graph.__trellisQuickstart.capture().year}}))"); // CHANGE
    await wait("!!document.querySelector('[data-quickstart-surface=plan]') && !!smokeUi.editor.graph.__trellisQuickstart.getCompanion(document.querySelector('[data-quickstart-surface=plan]'))", 'year planner companion').catch(async error => { console.error('PLANNER_COMPANION_STATE:', JSON.stringify(await run("({gardenExists:!!smokeUi.editor.graph.model.getCell(quickstartGarden.id),handler:!!window.__uslYearPlannerGlobal?.planYearRequestedHandler,surfaces:[...document.querySelectorAll('[data-quickstart-surface]')].map(node=>node.dataset.quickstartSurface),dialog:smokeUi.dialog?.container?.textContent.slice(0,600)})"))); throw error; }); // CHANGE
    await wait("document.querySelector('.trellis-quickstart-card')?.textContent.includes('Step 1 of 7')", 'grouped planner guide'); // NEW
    const plannerPosition = await run("(()=>{const box=document.querySelector('.trellis-quickstart-card').getBoundingClientRect();return {x:box.left,bottom:innerHeight-box.bottom};})()"); assert.ok(Math.abs(plannerPosition.x-16)<=1&&Math.abs(plannerPosition.bottom-16)<=1, JSON.stringify(plannerPosition)); // NEW
    for (let step = 2; step <= 7; step++) { await run("[...document.querySelectorAll('.trellis-quickstart-card button')].find(node=>node.textContent==='Next').click()"); await wait(`document.querySelector('.trellis-quickstart-card')?.textContent.includes('Step ${step} of 7')`, 'planner group ' + step); } // NEW
    for (let step = 6; step >= 1; step--) { await run("[...document.querySelectorAll('.trellis-quickstart-card button')].find(node=>node.textContent==='Back').click()"); await wait(`document.querySelector('.trellis-quickstart-card')?.textContent.includes('Step ${step} of 7')`, 'planner previous group ' + step); } // NEW
    assert.equal(await run("!!document.querySelector('[data-quickstart-focus=read-aloud]')&&!document.querySelector('[data-quickstart-focus=read-aloud]').checked"), true); // NEW
    fs.writeFileSync(path.join(output, 'quickstart-plan-companion.png'), (await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG()); // CHANGE
    await until(() => run("!!document.querySelector('[data-trellis-quickstart=plan-add-crops]') && !document.querySelector('[data-trellis-quickstart=plan-add-crops]').disabled"), 'year planner catalog loaded', 60000); // CHANGE
    await run("document.querySelector('[data-trellis-quickstart=plan-add-crops]').click()"); // CHANGE
    await wait("!!document.querySelector('[data-quickstart-surface=crop-picker]') && !!smokeUi.editor.graph.__trellisQuickstart.getCompanion(document.querySelector('[data-quickstart-surface=crop-picker]'))", 'nested crop picker companion'); // CHANGE
    assert.equal(await run("document.querySelector('.trellis-quickstart-card').getBoundingClientRect().width"), 310); // CHANGE
    fs.writeFileSync(path.join(output, 'quickstart-picker-companion.png'), (await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG()); // CHANGE
    await run("document.querySelector('[data-quickstart-surface=crop-picker] .yp-picker-head button').click()"); // CHANGE
    await wait("!document.querySelector('[data-quickstart-surface=crop-picker]')", 'nested picker closed'); // CHANGE
    await wait("document.querySelector('.trellis-quickstart-card')?.textContent.includes('Step 1 of 7')", 'cancel restores grouped planner guidance'); // NEW
    await run("[...document.querySelector('[data-quickstart-surface=plan]').querySelectorAll('button')].find(node=>node.textContent==='Close').click()"); // CHANGE
    await wait("!document.querySelector('[data-quickstart-surface=plan]')", 'year planner closed'); // CHANGE
    window.setSize(1100, 850); await wait('innerWidth<1200', 'Projects viewport'); // CHANGE

    await run("TrellisGardenHome.showProjects(smokeUi,{highlight:'community-sharing',diagramId:smokeUi.editor.graph.__trellisQuickstart.capture().diagramId})");
    await wait("!!smokeUi.editor.graph.__trellisQuickstart.getCompanion(document.querySelector('.trellis-projects-root')) && !!document.querySelector('[data-trellis-quickstart=community-sharing]')", 'highlighted Projects handoff'); // CHANGE
    assert.equal(await run("document.querySelector('[data-trellis-quickstart-drag-handle]').hidden"), false); // CHANGE
    await run("[...document.querySelectorAll('.trellis-quickstart-card button')].find(node=>node.textContent==='Create a community').click()");
    await wait("document.querySelector('[data-trellis-quickstart=community-sharing]')?.textContent==='Create Garden Community'", 'community creation target');
    await run("document.querySelector('[data-trellis-quickstart=community-sharing]').click()");
    const community = await run("(()=>{const form=smokeUi.__trellisGardenHome.actionPanel.querySelector('form');return {selected:form.querySelector('select').value,expected:smokeUi.editor.graph.__trellisQuickstart.capture().diagramId};})()");
    assert.equal(community.selected, community.expected);
    await run("(()=>{const input=document.querySelector('input[aria-label=\"Community name\"]');input.value='Unsent smoke draft';input.focus();TrellisGardenHome.showProjects(smokeUi,{highlight:'community-sharing',diagramId:smokeUi.editor.graph.__trellisQuickstart.capture().diagramId,communityPath:'existing'});})()");
    assert.equal(await run("document.querySelector('input[aria-label=\"Community name\"]').value"), 'Unsent smoke draft');
    assert.equal(await run("document.activeElement.getAttribute('aria-label')"), 'Community name');
    fs.writeFileSync(path.join(output, 'quickstart-projects.png'), (await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG());
    await run('smokeUi.hideDialog()');
    await wait("!!document.querySelector('[data-quickstart-focus=layout]')", 'guide returns to diagram'); // CHANGE: the card stays under body in both modes.
    assert.equal(await run("document.querySelector('[data-trellis-quickstart-drag-handle]').hidden"), false); // NEW
    const savedPosition = await run('smokeUi.editor.graph.__trellisQuickstart.getState().preferences.position'); // NEW

    await run("(async()=>{smokeUi.editor.graph.__trellisQuickstart.close();await new Promise((resolve,reject)=>smokeUi.getCurrentFile().save(false,resolve,reject));await TrellisGardenHome.openPath(smokeUi,smokeUi.getCurrentFile().fileObject.path);})()");
    await wait("smokeUi.editor.graph.__trellisQuickstart.getState().offering && !![...document.querySelectorAll('.trellis-quickstart-card button')].find(node=>node.textContent==='Do not show again')", 'offer repeats on actual diagram reopen');
    assert.deepEqual(await run('smokeUi.editor.graph.__trellisQuickstart.getState().preferences.position'), savedPosition); // NEW
    assert.deepEqual(await run("(()=>{const box=document.querySelector('.trellis-quickstart-card').getBoundingClientRect();return {x:box.left,y:box.top};})()"), savedPosition); // NEW
    await run("[...document.querySelectorAll('.trellis-quickstart-card button')].find(node=>node.textContent==='Do not show again').click()");
    await run("TrellisGardenHome.openPath(smokeUi,smokeUi.getCurrentFile().fileObject.path)");
    assert.equal(await run('smokeUi.editor.graph.__trellisQuickstart.getState().offering'), false);
    await run("smokeUi.actions.get('trellisQuickstart').funct()");
    await wait("!!document.querySelector('.trellis-quickstart-card')", 'manual launch after suppression');
    return { pluginLoaded: true, selectionRecovery: true, mouseDrag: true, graphUnchanged: true, positionRestored: true, narrow, keyboardMove: true, settingsCompanion, plannerCompanion: true, nestedPickerCompanion: true, projectPreselection: true, draftRetained: true, repeatedOffer: true, suppression: true, manualReopen: true }; // CHANGE
};
