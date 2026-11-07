/** Verify the loading card in production Chromium and IPC using only the disposable smoke profile. */ // NEW
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'); // NEW
module.exports = async function gardenLoading({ window, until, profile, output }) { // NEW
    const run = source => window.webContents.executeJavaScript(source, true); // NEW
    const wait = (source, label) => until(() => run(source), label, 20000); // NEW
    const filename = path.join(profile, 'Loading garden.drawio'); // NEW
    fs.writeFileSync(filename, '<mxfile><diagram id="one" name="First"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel></diagram><diagram id="two" name="Second"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel></diagram></mxfile>'); // NEW
    await run(`window.loadingOriginalRead=smokeUi.readGraphFile;smokeUi.readGraphFile=function(...args){window.releaseLoadingRead=()=>loadingOriginalRead.apply(this,args);};window.loadingResult=null;TrellisGardenHome.openPath(smokeUi,${JSON.stringify(filename)}).then(value=>loadingResult=value,error=>loadingResult=String(error));void 0;`); // NEW
    await wait(`document.querySelector('[data-open-stage=read][data-state=active]')&&!!window.releaseLoadingRead`, 'loading card reading stage'); // NEW
    assert.equal(await run(`document.querySelector('.trellis-garden-loading').contains(document.activeElement)`), true); // NEW
    assert.equal(await run(`document.querySelector('.trellis-garden-loading progress').hasAttribute('value')`), false); // NEW
    fs.writeFileSync(path.join(output, 'garden-loading-reading.png'), (await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG()); // NEW
    window.webContents.focus(); window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Tab' }); window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Tab' }); // NEW
    assert.equal(await run(`document.querySelector('.trellis-garden-loading').contains(document.activeElement)`), true); // NEW
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' }); window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' }); // NEW
    await wait(`loadingResult===false&&!document.querySelector('.trellis-garden-loading')`, 'keyboard cancellation'); // NEW
    await run(`releaseLoadingRead();smokeUi.readGraphFile=loadingOriginalRead;void 0;`); // NEW
    await new Promise(resolve => setTimeout(resolve, 250)); assert.equal(await run(`smokeUi.getCurrentFile()===null`), true); // NEW
    const recovery = path.join(profile, '.$Loading garden.drawio.dtmp'); fs.copyFileSync(filename, recovery); // NEW
    await run(`window.loadingSamples=[];window.loadingObserver=new MutationObserver(()=>{const bar=document.querySelector('.trellis-garden-loading progress');if(bar)loadingSamples.push({stage:document.querySelector('[data-open-stage][data-state=active]')?.dataset.openStage,value:bar.getAttribute('value'),max:bar.max});});loadingObserver.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['value','max','data-state']});window.loadingResult=null;TrellisGardenHome.openPath(smokeUi,${JSON.stringify(filename)}).then(value=>loadingResult=value,error=>loadingResult=String(error));void 0;`); // NEW
    await wait(`!!smokeUi.dialog?.container.textContent.includes(mxResources.get('unsavedChanges'))`, 'native recovery prompt before replacement'); // NEW
    assert.equal(await run(`document.querySelector('.trellis-garden-loading').hidden&&smokeUi.getCurrentFile()===null`), true); // NEW
    await run(`[...smokeUi.dialog.container.querySelectorAll('button')].find(button=>button.textContent===mxResources.get('ignore')).click();void 0;`); // NEW
    await wait(`loadingResult!==null`, 'multi-page garden completes loading'); // NEW
    assert.equal(await run('loadingResult'), true); assert.equal(await run('smokeUi.pages.length'), 2); // NEW
    assert.equal(await run(`loadingSamples.some(sample=>sample.stage==='validate'&&sample.max===2&&sample.value!==null)`), true); // NEW
    assert.equal(await run(`!document.querySelector('.trellis-garden-loading')&&!smokeUi.__trellisGardenOpening`), true); // NEW
    assert.equal(fs.existsSync(recovery), true); fs.unlinkSync(recovery); // NEW: Ignore leaves the disposable recovery data intact.
    await run(`loadingObserver.disconnect();smokeUi.editor.graph.__trellisQuickstart?.close();void 0;`); // NEW
    await run(`trellisIdentity.create({username:'Loading Fixture',password:'loading-fixture-password'}).then(()=>true)`); // NEW
    await wait(`smokeUi.__trellisGardenHome.session?.username==='Loading Fixture'`, 'loading identity'); // NEW
    const project = await run(`trellisGardenLibrary.create({name:'Managed loading garden'})`); // NEW
    await run(`window.loadingCards=new Set();window.downloadSeen=false;window.downloadObserver=new MutationObserver(()=>{const card=document.querySelector('.trellis-garden-loading');if(card){loadingCards.add(card);if(card.querySelector('[data-open-stage=download][data-state=active]'))downloadSeen=true;}});downloadObserver.observe(document.body,{subtree:true,childList:true});window.loadingResult=null;TrellisGardenHome.openPath(smokeUi,null,{download:${JSON.stringify(project.entry.diagramId)}}).then(value=>loadingResult=value,error=>loadingResult=String(error));void 0;`); // NEW
    await wait(`!!smokeUi.dialog?.container.querySelector('[data-trellis-quickstart=settings-save]')`, 'required starter settings after loading'); // CHANGE
    assert.equal(await run(`!document.querySelector('.trellis-garden-loading')&&!smokeUi.__trellisGardenOpening`), true); // CHANGE
    await run(`(()=>{const form=smokeUi.dialog.container,units=form.querySelector('[data-trellis-quickstart=settings-units]');units.value='metric';units.dispatchEvent(new Event('change',{bubbles:true}));form.querySelector('[data-trellis-quickstart=settings-save]').click();})()`); // CHANGE
    await wait(`loadingResult!==null`, 'managed garden access and starter readiness'); // NEW
    assert.equal(await run('loadingResult'), true); // NEW
    assert.equal(await run(`Trellis.users.isLoggedIn()&&!document.querySelector('.trellis-garden-loading')`), true); // NEW
    assert.equal(await run(`Object.values(smokeUi.editor.graph.model.cells).filter(cell=>cell.getAttribute?.('garden_module')==='1').length`), 1); // NEW
    assert.equal(await run(`downloadObserver.disconnect();downloadSeen&&loadingCards.size===1`), true); // NEW
    fs.writeFileSync(path.join(output, 'garden-loading-checks.json'), JSON.stringify({ ok: true, keyboardCancellation: true, measuredPages: true, recoveryPrompt: true, continuousDownload: true, managedReadiness: true })); // NEW
}; // NEW
