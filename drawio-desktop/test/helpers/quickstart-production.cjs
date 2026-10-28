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

    await run("TrellisGardenHome.showProjects(smokeUi,{highlight:'community-sharing',diagramId:smokeUi.editor.graph.__trellisQuickstart.capture().diagramId})");
    await wait("!!document.querySelector('.trellis-projects-root .trellis-quickstart-card') && !!document.querySelector('[data-trellis-quickstart=community-sharing]')", 'highlighted Projects handoff');
    assert.equal(await run("document.querySelector('[data-trellis-quickstart-drag-handle]').hidden"), true); // NEW
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
    await wait("document.querySelector('.trellis-quickstart-card')?.parentNode===document.body", 'guide returns to diagram');
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
    return { pluginLoaded: true, selectionRecovery: true, mouseDrag: true, graphUnchanged: true, positionRestored: true, narrow, keyboardMove: true, projectPreselection: true, draftRetained: true, repeatedOffer: true, suppression: true, manualReopen: true }; // NEW
};
