/** Production-window checks: real permissions, scheduler, task generation and Chromium navigation. */ // CHANGE
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'); // CHANGE
module.exports = async function ({ run, win, project }) { // CHANGE
    console.log('EDITING_STAGE: ready');
    await run('(async()=>{await Trellis.sharing.whenDocumentReady();while(smokeUi.dialog)smokeUi.hideDialog();await Trellis.sharing.settleObjectEdits();window.editLifecycleErrors=[];addEventListener("error",event=>editLifecycleErrors.push(event.error?.stack||event.message));})()'); // CHANGE
    const webapp = path.join(project, 'drawio/src/main/webapp'); // CHANGE
    // Reload only the scheduler's opt-in test surface; all model, permission, sharing and task plugins remain the shipped instances. // CHANGE
    const schedulerSource = fs.readFileSync(path.join(webapp, 'plugins/garden_planner_plugins/Garden_Scheduler_Dialog.js'), 'utf8'); // CHANGE
    await run('window.savedLoadPlugin=Draw.loadPlugin;Draw.loadPlugin=callback=>callback(smokeUi);window.__TRELLIS_PLANTING_SCHEDULER_TEST__=true;void 0'); // CHANGE
    try { await run(schedulerSource + '\n;void 0;'); } finally { await run('Draw.loadPlugin=savedLoadPlugin;delete window.__TRELLIS_PLANTING_SCHEDULER_TEST__;void 0'); } // CHANGE
    console.log('EDITING_STAGE: planting and task transaction');
    await run(`(async()=>{ // CHANGE
        window.editGarden=graph.__trellisModules.createModuleAtPoint({x:12000,y:12000},'garden'); // CHANGE
        await new Promise(resolve=>setTimeout(resolve,100));while(smokeUi.dialog)smokeUi.hideDialog();await Trellis.sharing.settleObjectEdits(); // CHANGE
        window.editBed=graph.insertVertex(editGarden,null,value({garden_bed:'1',label:'Editing regression bed'}),200,200,150,300,'dashed=1;');await Trellis.sharing.settleObjectEdits(); // CHANGE
        console.log('CLUSTER_STAGE: editing planting setup');window.editHooks=__TRELLIS_PLANTING_SCHEDULER_TEST_HOOKS__; // CHANGE
        const plant=new editHooks.PlantModel({plant_id:1,plant_name:'Basil',abbr:'BAS',annual:1,biennial:0,perennial:0,days_maturity:30,days_germ:5,days_transplant:0,harvest_window_days:7,spacing_cm:30,tbase_c:5,tmin_c:0}); // CHANGE
        const city=new editHooks.CityClimate({city_id:1,city_name:'Regression',...Object.fromEntries(Array.from({length:12},(_,i)=>[['avg_monthly_high_c'+(i+1),25],['avg_monthly_low_c'+(i+1),15]]).flat())}); // CHANGE
        window.editInputs=new editHooks.ScheduleInputs({plant,city,planningMode:'annual',methodId:'direct_sow.field',methodCategoryId:'direct_sow',startISO:'2026-04-01',seasonStartYear:2026,seasonEndISO:'2026-12-31',harvestWindowDays:7,policy:{}}); // CHANGE
        window.saveBedRegression=async()=>{const result=editHooks.computeScheduleResult(editInputs),creation=await editHooks.prepareBedScheduleCreation(smokeUi,editBed,editInputs,result);return editHooks.applyScheduleToGraph(smokeUi,editBed,editInputs,{result,createTargetCell:creation.createTargetCell,taskTemplate:{version:2,rules:[{id:'water',title:'Water',startAnchorStage:'SOW',endMode:'fixed_days',durationDays:0}]}});}; // CHANGE
        window.editGroupIds=()=>Object.values(graph.model.cells).filter(cell=>cell.getAttribute?.('tiler_group')==='1').map(cell=>cell.id); // CHANGE
        window.rejectNextPlanting=true;graph.model.addListener(mxEvent.CHANGE,(_sender,event)=>{const edit=event.getProperty('edit');if(rejectNextPlanting&&editGroupIds().length&&!edit.undone&&!edit.__trellisUsersRejected){rejectNextPlanting=false;edit.__trellisUsersRejected=true;edit.__trellisUsersRejectedReason='Native test rejection';edit.undo();}}); // CHANGE
        console.log('CLUSTER_STAGE: editing first rejection');try{await saveBedRegression();throw Error('Expected native rejection');}catch(error){if(!/Native test rejection/.test(error.message))throw Error('First attempt: '+error.message);} // CHANGE
        if(editGroupIds().length)throw Error('Rejected planting survived');console.log('CLUSTER_STAGE: editing retry');try{await saveBedRegression();}catch(error){throw Error('Retry: '+error.message);}if(editGroupIds().length!==1)throw Error('Retry did not create exactly one planting'); // CHANGE
        console.log('CLUSTER_STAGE: editing persistence');await Trellis.sharing.settleObjectEdits();window.editSavedGroup=graph.model.getCell(editGroupIds()[0]);if(!Object.values(graph.model.cells).some(cell=>String(cell.getAttribute?.('linkedTo')||'').split(',').includes(editSavedGroup.id)))throw Error('Generated task missing'); // CHANGE
        return true; // CHANGE
    })()`); // CHANGE
    console.log('EDITING_STAGE: scheduler blocker and manual retry'); // CHANGE
    await run(`(async()=>{ // CHANGE
        window.originalScheduleBridge=window.dbBridge;window.originalScheduleShow=smokeUi.showDialog;window.originalScheduleHide=smokeUi.hideDialog; // CHANGE
        window.schedulerMethod={method_id:'direct_sow.field',method_category_id:'direct_sow',method_name:'Field direct sow',tasks_required_json:'{}'}; // CHANGE
        window.schedulerPlant=new editHooks.PlantModel({plant_id:1,plant_name:'Cilantro',abbr:'CIL',annual:1,biennial:0,perennial:0,days_maturity:30,days_germ:5,days_transplant:0,harvest_window_days:7,spacing_cm:30,tbase_c:5,tmin_c:0,topt_low_c:15,topt_high_c:25,tmax_c:40,default_planting_method:'direct_sow.field',default_planting_method_category:'direct_sow'}); // CHANGE
        window.schedulerCity={city_id:1,city_name:'Regression',latitude:45,last_spring_frost_doy:1,...Object.fromEntries(Array.from({length:12},(_,i)=>[['avg_monthly_high_c'+(i+1),25],['avg_monthly_low_c'+(i+1),15]]).flat())}; // CHANGE
        window.dbBridge={resolvePath:async()=>({dbPath:'native-scheduler'}),open:async()=>({dbId:'native-scheduler'}),close:async()=>({}),exec:async()=>({}),query:async(_id,sql)=>({rows:/FROM\\s+Plants\\b/i.test(sql)?[schedulerPlant]:/FROM\\s+Cities\\b/i.test(sql)?[schedulerCity]:/FROM\\s+PlantAllowedMethodCategories\\b/i.test(sql)?[{plant_id:1,method_category_id:'direct_sow',method_category_name:'Direct sow'}]:/FROM\\s+PlantingMethods\\b/i.test(sql)?[schedulerMethod]:[]})}; // CHANGE
        smokeUi.showDialog=(node,_width,_height,_modal,_closable,close)=>{smokeUi.dialog={node,close};node.style.cssText+=';position:fixed;inset:12px;z-index:2000000000;background:white;overflow:auto';document.body.append(node);}; // CHANGE
        smokeUi.hideDialog=()=>{const dialog=smokeUi.dialog;if(!dialog)return;smokeUi.dialog=null;dialog.node.remove();dialog.close?.();}; // CHANGE
        write(editGarden,{city_id:'1',city_name:'Regression'});window.blockerBed=graph.insertVertex(editGarden,null,value({garden_bed:'1',label:'Manual retry bed'}),500,200,150,300,'dashed=1;');await Trellis.sharing.settleObjectEdits(); // CHANGE
        window.blockerLayerKey=JSON.stringify([smokeUi.currentPage?.getId?.()||'',graph.model.getParent(editGarden).id]); // CHANGE
        nativeHolds.set(blockerLayerKey,{key:blockerLayerKey,claimId:'other-session-layer',sessionId:'earlier-window',userId:Trellis.users.getCurrentUser().id,objectLabel:'Containing layer'});nativeActivityListener({...nativeInfo,collaboration:nativeActivity()}); // CHANGE
        window.openBlockedScheduler=()=>USL.scheduler.openBedScheduleDialog(smokeUi,blockerBed);window.schedulerButton=label=>[...smokeUi.dialog.node.querySelectorAll('button')].find(button=>button.textContent===label); // CHANGE
        await openBlockedScheduler();window.blockedForm=smokeUi.dialog.node;window.blockedControls=()=>[...blockedForm.querySelectorAll('input,select,textarea')].map(field=>[field.value,field.checked]); // CHANGE
        window.controlsBeforeBlockedSave=JSON.stringify(blockedControls());window.beforeBlockedSave=smokeUi.getFileData();window.beforeBlockedGroups=editGroupIds().length;schedulerButton('Save').click(); // CHANGE
    })()`); // CHANGE
    const waitForScheduler = async predicate => { const deadline=Date.now()+20000;while(!await run(predicate)){if(Date.now()>deadline)throw Error('Scheduler did not settle: '+await run('smokeUi.dialog?.node.innerText'));await new Promise(resolve=>setTimeout(resolve,30));} }; // CHANGE
    await waitForScheduler('!schedulerButton("Save").disabled && /Schedule and task updates deferred:/.test(blockedForm.textContent)'); // CHANGE
    assert.match(await run('blockedForm.textContent'), /Containing layer.*entries remain.*click Save again/); // CHANGE
    assert.equal(await run('JSON.stringify(blockedControls())'), await run('controlsBeforeBlockedSave')); // CHANGE
    assert.equal(await run('smokeUi.getFileData()'), await run('beforeBlockedSave')); // CHANGE
    assert.equal(await run('graph.__trellisEditContext.deferred.size'), 0); // CHANGE
    await run('schedulerButton("Cancel").click();void 0'); assert.equal(await run('!!smokeUi.dialog'), false); // CHANGE
    assert.equal(await run('editGroupIds().length'), await run('beforeBlockedGroups')); // CHANGE
    await run('(async()=>{await openBlockedScheduler();blockedForm=smokeUi.dialog.node;schedulerButton("Save").click();})()'); // CHANGE
    await waitForScheduler('!schedulerButton("Save").disabled && /Schedule and task updates deferred:/.test(blockedForm.textContent)'); // CHANGE
    await run('nativeHolds.delete(blockerLayerKey);nativeActivityListener({...nativeInfo,collaboration:nativeActivity()});schedulerButton("Save").click();void 0'); // CHANGE
    await waitForScheduler('!smokeUi.dialog || (!schedulerButton("Save").disabled && /Scheduling error:/.test(blockedForm.textContent))'); // CHANGE
    assert.equal(await run('!!smokeUi.dialog'), false, await run('blockedForm.textContent')); // CHANGE
    assert.equal(await run('editGroupIds().length'), (await run('beforeBlockedGroups'))+1); // CHANGE
    assert.equal(await run('graph.__trellisEditContext.deferred.size'), 0); // CHANGE
    await run('(async()=>{await Trellis.sharing.settleObjectEdits();window.dbBridge=originalScheduleBridge;smokeUi.showDialog=originalScheduleShow;smokeUi.hideDialog=originalScheduleHide;})()'); // CHANGE
    console.log('EDITING_STAGE: navigation');
    await run(` // CHANGE
        window.editPanel=document.createElement('section');editPanel.dataset.nativeEditPanel='';editPanel.style.cssText='position:fixed;z-index:12000;left:40px;top:70px;padding:14px;background:white;border:1px solid #888';editPanel.innerHTML='<label>Draft <input value="saved"></label><button>Next section</button>';document.body.append(editPanel); // CHANGE
        window.editField=editPanel.querySelector('input');window.editMoves=0;window.editHandle=Trellis.sharing.registerEditor({kind:'planting',title:'Native test section',element:editPanel,targets:[JSON.stringify([smokeUi.currentPage?.getId?.()||'',editSavedGroup.id])],capture:()=>({text:editField.value}),save:()=>{write(editSavedGroup,{label:editField.value});return true;},restore:draft=>{editField.value=draft.text;},discard(){}}); // CHANGE
        editField.addEventListener('input',()=>editHandle.touch());editPanel.querySelector('button').onclick=()=>editHandle.transition(()=>{editMoves++;});editField.focus();editField.select();void 0; // CHANGE
    `); // CHANGE
    await win.webContents.insertText('native unfinished draft'); // CHANGE
    const until = async predicate => { const deadline=Date.now()+15000; while(!await run(predicate)){if(Date.now()>deadline)throw Error('Native action did not settle: '+predicate);await new Promise(resolve=>setTimeout(resolve,30));} }; // CHANGE
    const click = async selector => { const point = await run(`(()=>{const b=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return{x:Math.round(b.x+b.width/2),y:Math.round(b.y+b.height/2)}})()`); for (const type of ['mouseMove', 'mouseDown', 'mouseUp']) win.webContents.sendInputEvent({ type, ...point, button: 'left', clickCount: 1 }); await run('new Promise(resolve=>setTimeout(resolve,80))'); }; // CHANGE
    await click('[data-native-edit-panel] > button'); // CHANGE
    assert.equal(await run('!!document.querySelector("[data-trellis-edit-decision]")'), true); // CHANGE
    await click('[data-trellis-edit-decision] button:last-child'); await until('!document.querySelector("[data-trellis-edit-decision]")'); assert.equal(await run('editMoves'), 0); assert.equal(await run('editField.value'), 'native unfinished draft'); // CHANGE
    await run('editPanel.querySelector("button").click();void 0'); await click('[data-trellis-edit-decision] button:nth-of-type(2)'); await until('editField.value==="saved" && editMoves===1'); assert.equal(await run('editField.value'), 'saved'); assert.equal(await run('editMoves'), 1); // CHANGE
    await run('editField.focus();editField.select();void 0'); await win.webContents.insertText('native committed draft'); await run('editPanel.querySelector("button").click();void 0'); await click('[data-trellis-edit-decision] button:first-of-type'); await until('editMoves===2'); // CHANGE
    assert.equal(await run('editSavedGroup.getAttribute("label")'), 'native committed draft'); assert.equal(await run('editMoves'), 2); // CHANGE
    await run('(async()=>{graph.setSelectionCell(editSavedGroup);await Trellis.sharing.settleObjectEdits();await new Promise(resolve=>setTimeout(resolve,100));})()'); // CHANGE
    assert.equal(await run('Trellis.sharing.automationHolds().some(hold=>hold.local&&hold.active&&hold.key===JSON.stringify([smokeUi.currentPage?.getId?.()||"",editSavedGroup.id]))'), false); // CHANGE: current selection may retain a hold, but the committed editor is inactive.
    await run('(async()=>{graph.clearSelection();await Trellis.sharing.settleObjectEdits();await new Promise(resolve=>setTimeout(resolve,100));})()'); // CHANGE
    assert.equal(await run('Trellis.sharing.automationHolds().some(hold=>hold.local&&hold.key===JSON.stringify([smokeUi.currentPage?.getId?.()||"",editSavedGroup.id]))'), false); // CHANGE: leaving the planting releases the retained hold.
    assert.deepEqual(await run('editLifecycleErrors'), []); // CHANGE
    const directory = path.join(project, '.test-artifacts/editing-lifecycle'); fs.mkdirSync(directory, { recursive: true }); fs.writeFileSync(path.join(directory, 'native-editing.png'), (await win.webContents.capturePage()).toPNG()); // CHANGE
    console.log('Native editing lifecycle, planting rejection and retry passed'); // CHANGE
}; // CHANGE
