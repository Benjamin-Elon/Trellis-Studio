const assert = require('node:assert/strict'); // CHANGE
const fs = require('node:fs'); // CHANGE
const path = require('node:path'); // CHANGE
const { app, BrowserWindow } = require('electron'); // CHANGE
const { createRegularSpacingFixture } = require('./regular-spacing-preview.cjs'); // CHANGE
const root = process.env.TRELLIS_PREVIEW_ROOT || path.resolve(__dirname, '../..'); // CHANGE
app.commandLine.appendSwitch('disable-gpu'); // CHANGE
app.disableHardwareAcceleration(); app.commandLine.appendSwitch('in-process-gpu'); // CHANGE: software rendering avoids a separate GPU subprocess in restricted Windows test environments.
const profile = path.join(app.getPath('temp'), 'trellis-planting-preview-' + process.pid); fs.mkdirSync(profile, { recursive: true }); app.setPath('userData', profile); // CHANGE: the fixture never reuses the running application's encrypted cache.

/** Exercise production drawing inside Chromium with a scrollable, real mxGraph canvas. */ // CHANGE
app.whenReady().then(async () => { // CHANGE
    const win = new BrowserWindow({ show: false, width: 1000, height: 750, webPreferences: { sandbox: false, backgroundThrottling: false } }); // CHANGE
    try { // CHANGE
        await win.loadURL('data:text/html,' + encodeURIComponent('<!doctype html><body style="margin:0"><div id="graph" style="position:relative;width:900px;height:650px;overflow:auto"></div></body>')); // CHANGE
        await win.webContents.executeJavaScript('window.mxLoadResources=false;window.mxLoadStylesheets=false;'); // CHANGE
        const webapp = path.join(root, 'drawio/src/main/webapp'); // CHANGE
        await win.webContents.executeJavaScript(fs.readFileSync(path.join(webapp, 'mxgraph/mxClient.js'), 'utf8')); // CHANGE
        await win.webContents.executeJavaScript(` // CHANGE
            window.graph = new mxGraph(document.getElementById('graph')); // CHANGE
            graph.isSpecialColor=()=>false; // CHANGE
            graph.convertValueToString=cell=>cell.value && cell.value.getAttribute ? cell.value.getAttribute('label') || '' : String(cell.value || ''); // CHANGE
            window.Draw={loadPlugin:callback=>callback({editor:{graph},actions:{get:()=>null},hideDialog(){}})}; // CHANGE
            void 0; // CHANGE: Electron IPC cannot clone a callback object.
        `); // CHANGE
        await win.webContents.executeJavaScript(fs.readFileSync(path.join(webapp, 'plugins/garden_planner_plugins/Planting_Group.js'), 'utf8')); // CHANGE
        let allocate = fs.readFileSync(path.join(webapp, 'plugins/garden_planner_plugins/Allocate_Planner.js'), 'utf8'); // CHANGE
        // Expose the private drawing entry point only in this fixture, without replacing its implementation. // CHANGE
        allocate = allocate.replace('return { open, close, renderScheduleProgress,', 'return { renderGhost, open, close, renderScheduleProgress,'); // CHANGE
        allocate = allocate.replace('window.USL.allocate = Object.assign', 'window.previewAllocateController = AllocateController; window.USL.allocate = Object.assign'); // CHANGE
        await win.webContents.executeJavaScript(allocate); // CHANGE
        const result = await win.webContents.executeJavaScript(` // CHANGE
            (async () => { // CHANGE
                const xml=attrs=>{const node=mxUtils.createXmlDocument().createElement('object');for(const [key,value]of Object.entries(attrs))node.setAttribute(key,value);return node;}; // CHANGE
                const parent=graph.insertVertex(null,'outer','',70,50,3500,3500); // CHANGE
                const garden=graph.insertVertex(parent,'garden',xml({garden_module:'1',label:'Garden'}),200,150,2500,2500); // CHANGE
                const bed=graph.insertVertex(garden,'bed',xml({garden_bed:'1',label:'Bed'}),250,200,300,100,'fillColor=#afb576;'); // CHANGE
                const slots=Array.from({length:125},(_,i)=>({x:6+(i%25)*12,y:30+Math.floor(i/25)*13,r:4})); // CHANGE
                const state={ownerId:'allocate:fixture',moduleCell:garden,draft:{crop:{label:'Radish'},plantResolution:{plant:{plant_abbr:'RAD'}},status:'compatible',plantCount:125,geometry:{ok:true,geometry:{x:250,y:200,width:300,height:100},slots}}}; // CHANGE
                window.previewFixtureState=state; // CHANGE
                const serialize=()=>mxUtils.getXml(new mxCodec().encode(graph.getModel())); // CHANGE
                const rows=[], service=graph.__trellisPlantingGroup.preview; // CHANGE
                const capture=(name, redraw=true)=>{ // CHANGE
                    if(redraw)previewAllocateController.renderGhost(state); // CHANGE
                    const ghost=document.querySelector('.trellis-allocate-ghost'),frame=ghost.querySelector('.manual-link-spacing-preview-group-frame'); // CHANGE
                    const rect=frame.getBoundingClientRect(),target=graph.view.getState(bed).shape.node.getBoundingClientRect(),style=getComputedStyle(frame); // CHANGE
                    const canvas=graph.container.getBoundingClientRect(); // CHANGE
                    rows.push({name,deltaX:rect.x-target.x,deltaY:rect.y-target.y,width:rect.width,height:rect.height,circles:ghost.querySelectorAll('.manual-link-spacing-preview-plant').length,label:ghost.querySelector('.manual-link-spacing-preview-plant')?.textContent,display:style.display,visibility:style.visibility,inViewport:rect.right>canvas.left&&rect.left<canvas.right&&rect.bottom>canvas.top&&rect.top<canvas.bottom,parent:ghost.parentNode.className}); // CHANGE
                }; // CHANGE
                graph.view.scaleAndTranslate(1.35,5,10);graph.container.scrollLeft=300;graph.container.scrollTop=250; // CHANGE
                const before=serialize();capture('135% scrolled'); // CHANGE
                graph.container.scrollLeft=450;graph.container.scrollTop=320;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));capture('forward scroll',false); // CHANGE
                graph.container.scrollLeft=160;graph.container.scrollTop=110;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));capture('reverse scroll',false); // CHANGE
                graph.view.scaleAndTranslate(0.9,25,30);await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));capture('zoom and pan',false); // CHANGE
                graph.view.scaleAndTranslate(1.35,5,10);graph.container.scrollLeft=300;graph.container.scrollTop=250; // CHANGE
                const gm=graph.getModel(),geometry=garden.getGeometry().clone();geometry.x+=40;geometry.y+=25;gm.setGeometry(garden,geometry);capture('moved nested garden'); // CHANGE
                const modelAfterMove=serialize(); // CHANGE
                for(const rotation of [37,90,0]){graph.setCellStyles('rotation',String(rotation),[bed]);state.draft.geometry.rotation=rotation;capture('rotation '+rotation);} // CHANGE
                const modelAfterRotations=serialize(); // CHANGE
                state.draft.status='warning';capture('warning'); // CHANGE
                const warningBorder=document.querySelector('.trellis-allocate-ghost .manual-link-spacing-preview-group-frame').style.borderColor; // CHANGE
                const m=graph.view.getState(garden),scale=graph.view.scale,tr=graph.view.translate; // CHANGE
                const rect={x:m.x/scale-tr.x+250,y:m.y/scale-tr.y+200,width:300,height:100}; // CHANGE
                service.render('spacing',{className:'manual-link-spacing-preview',rows:[{rect,label:'Radish',circles:slots.map(s=>({x:rect.x+s.x,y:rect.y+s.y,r:s.r,label:'RAD'}))}]}); // CHANGE
                const spacing=document.querySelector('.manual-link-spacing-preview .manual-link-spacing-preview-group-frame').getBoundingClientRect(); // CHANGE
                const allocation=document.querySelector('.trellis-allocate-ghost .manual-link-spacing-preview-group-frame').getBoundingClientRect(); // CHANGE
                const sharedDelta={x:spacing.x-allocation.x,y:spacing.y-allocation.y}; // CHANGE
                service.clear('spacing');const allocateSurvived=!!document.querySelector('.trellis-allocate-ghost'); // CHANGE
                state.draft.geometry.lodCollapsed=true;state.draft.plantCount=301;previewAllocateController.renderGhost(state); // CHANGE
                const summary=document.querySelector('.planting-preview-summary').textContent; // CHANGE
                const summaryCircles=document.querySelectorAll('.trellis-allocate-ghost .manual-link-spacing-preview-plant').length; // CHANGE
                service.clear(state.ownerId);const cleared=!document.querySelector('.trellis-allocate-ghost'); // CHANGE
                return {rows,sharedDelta,warningBorder,allocateSurvived,summary,summaryCircles,cleared,unchanged:serialize()===modelAfterRotations,aliasIdentity:USL.tiler===USL.plantingGroup,baselineUnchanged:before===modelAfterMove}; // CHANGE
            })(); // CHANGE
        `); // CHANGE
        for (const row of result.rows) { // CHANGE
            assert.ok(Math.abs(row.deltaX) <= 2 && Math.abs(row.deltaY) <= 2, JSON.stringify(row)); // CHANGE: mxGraph stroke bounds differ by less than two CSS pixels.
            assert.equal(row.circles, 125); assert.equal(row.label, 'RAD'); // CHANGE
            assert.equal(row.visibility, 'visible'); assert.notEqual(row.display, 'none'); // CHANGE
            assert.ok(row.inViewport, row.name); assert.equal(row.parent, 'trellis-graph-annotation-layer'); // CHANGE
        } // CHANGE
        assert.deepEqual(result.sharedDelta, { x: 0, y: 0 }); // CHANGE
        assert.ok(result.allocateSurvived && result.cleared && result.unchanged && result.aliasIdentity); // CHANGE
        assert.equal(result.summary, '301 plants'); assert.equal(result.summaryCircles, 0); // CHANGE
        assert.match(result.warningBorder, /217, 119, 6/); // CHANGE
        await win.webContents.executeJavaScript(fs.readFileSync(path.join(webapp, 'plugins/garden_planner_plugins/Bed_Succession_Navigator.js'), 'utf8')); // CHANGE
        const panelChecks = await win.webContents.executeJavaScript(` // CHANGE
            (async () => { // CHANGE
                const body = document.createElement('div'); // CHANGE
                USL.scheduler = {layoutTools:{validateSpacingDraft:()=>({ok:true,errors:[]})}}; // CHANGE: domain validation is covered by integration tests; this fixture measures the production editor layout.
                let offsetDraft; const originalSlots=JSON.stringify(previewFixtureState.draft.geometry.slots); // CHANGE: rendering controls cannot modify existing plant positions.
                graph.__trellisPlantingSpacingEditor.render(body, {selectedId:'proposal',rows:[{cellId:'proposal',proposed:true,enabled:true,label:'Radish',spacingXCm:20,spacingYCm:30,offsetXCm:1/3,offsetYCm:-1/3}]}, {live:true,proposed:true,fitToDemand:true,onChange:rows=>{offsetDraft=rows;}}); // CHANGE: exercise rounded displays in Chromium with exact callback values.
                const bed = graph.getModel().getCell('bed'), fields = body.querySelectorAll('input[type=number]'), checks=[]; // CHANGE
                const input={ownerId:'allocate:panel-fixture',bedCell:bed,moduleCell:previewFixtureState.moduleCell,cropLabel:'Radish',year:2027,view:'spacing',spacingAvailable:true,spacingContent:body,onViewChange(){}}; // CHANGE
                const api=graph.__trellisBedSuccessionNavigator; // CHANGE
                for(const width of [900,320]) { // CHANGE
                    graph.container.style.width=width+'px';graph.view.scaleAndTranslate(1.1,0,0);graph.container.scrollLeft=500;graph.container.scrollTop=150; // CHANGE
                    const panel=api.showAllocationPreview(input);await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))); // CHANGE
                    const host=panel.querySelector('[data-allocation-spacing-host]'), bounds=host.getBoundingClientRect(); // CHANGE
                    checks.push({width,fieldsFit:[...fields].every(field=>{const rect=field.getBoundingClientRect();return rect.left>=bounds.left-1&&rect.right<=bounds.right+1;}),mounted:host.firstChild===body,applyHidden:[...body.querySelectorAll('button')].find(button=>button.textContent==='Apply').style.display==='none'}); // CHANGE
                    fields[0].focus();fields[0].value='12';graph.view.scaleAndTranslate(0.9,5,5);graph.container.scrollLeft+=30;graph.container.scrollTop+=20; // CHANGE
                    api.showAllocationPreview({...input,message:'Updating spacing preview...'}); // CHANGE
                    checks.at(-1).focusRetained=document.activeElement===fields[0]&&fields[0].value==='12'; // CHANGE
                    fields[2].focus();fields[2].blur();fields[2].dispatchEvent(new Event('change')); // CHANGE: focus and formatting cannot overwrite the exact offset.
                    checks.at(-1).offsetsRounded=fields[2].value==='0'&&fields[3].value==='0'; // CHANGE
                    checks.at(-1).offsetsExact=Number(offsetDraft[0].offsetXCm)===1/3&&Number(offsetDraft[0].offsetYCm)===-1/3; // CHANGE
                    checks.at(-1).plantsUnchanged=JSON.stringify(previewFixtureState.draft.geometry.slots)===originalSlots; // CHANGE
                } // CHANGE
                graph.container.style.width='900px';api.showAllocationPreview(input); // CHANGE
                return checks; // CHANGE
            })(); // CHANGE
        `); // CHANGE
        for (const check of panelChecks) assert.ok(check.fieldsFit && check.mounted && check.applyHidden && check.focusRetained && check.offsetsRounded && check.offsetsExact && check.plantsUnchanged, JSON.stringify(check)); // CHANGE
        result.panelChecks = panelChecks; // CHANGE
        if (process.env.TRELLIS_PREVIEW_SCREENSHOT) fs.writeFileSync(process.env.TRELLIS_PREVIEW_SCREENSHOT, (await win.webContents.capturePage()).toPNG()); // CHANGE
        await win.webContents.executeJavaScript(` // CHANGE
            window.__TRELLIS_PLANTING_SCHEDULER_TEST__=true; // CHANGE
            window.defaultFixturePlant={plant_id:1,plant_name:'Radish',annual:1,biennial:0,perennial:0,lifespan_years:1,overwinter_ok:0,days_maturity:30,days_transplant:0,days_germ:5,harvest_window_days:7,tbase_c:5,tmin_c:0,topt_low_c:15,topt_high_c:25,tmax_c:40,yield_per_plant_kg:1,spacing_cm:30}; // CHANGE
            window.defaultFixtureCity={city_id:1,city_name:'Test City',last_spring_frost_doy:1}; // CHANGE
            for(let month=1;month<=12;month++){defaultFixtureCity['avg_monthly_high_c'+month]=22;defaultFixtureCity['avg_monthly_low_c'+month]=18;} // CHANGE
            window.dbBridge={resolvePath:async()=>({dbPath:'electron-defaults'}),open:async()=>({dbId:'electron-defaults'}),close:async()=>{},exec:async()=>({}),query:async(id,sql)=>{ // CHANGE
                let rows=[]; // CHANGE
                if(/FROM\\s+Plants\\b/i.test(sql))rows=[defaultFixturePlant]; // CHANGE
                else if(/FROM\\s+Cities\\b/i.test(sql))rows=[defaultFixtureCity]; // CHANGE
                else if(/FROM\\s+PlantAllowedMethodCategories\\b/i.test(sql))rows=[{plant_id:1,method_category_id:'direct_sow',method_category_name:'Direct sow'}]; // CHANGE
                else if(/FROM\\s+PlantingMethods\\b/i.test(sql))rows=[{method_id:'direct_sow.field',method_category_id:'direct_sow',method_name:'Field direct sow',tasks_required_json:'{"sow":true,"prep":true}'}]; // CHANGE
                return {rows}; // CHANGE
            }}; // CHANGE
            window.defaultFixtureUi={editor:{graph},actions:{get:()=>null},showDialog(node){window.defaultFixtureDialog=node;node.style.cssText+=';position:fixed;top:20px;left:2vw;width:96vw;height:85vh;z-index:20000;box-shadow:0 2px 12px #aaa;';document.body.appendChild(node);},hideDialog(){defaultFixtureDialog?.remove();}}; // CHANGE
            window.Draw={loadPlugin:callback=>callback(defaultFixtureUi)};void 0; // CHANGE
        `); // CHANGE
        for (const name of ['Garden_Scheduler_Shared_Core.js','Garden_Scheduler_Annual_Core.js','Garden_Scheduler_Perennial_Core.js','Garden_Scheduler_Dialog.js']) { // CHANGE
            await win.webContents.executeJavaScript(fs.readFileSync(path.join(webapp,'plugins/garden_planner_plugins',name),'utf8')); // CHANGE
        } // CHANGE
        await win.webContents.executeJavaScript(` // CHANGE
            (async()=>{ // CHANGE
                const hooks=__TRELLIS_PLANTING_SCHEDULER_TEST_HOOKS__,plant=new hooks.PlantModel(defaultFixturePlant),city=new hooks.CityClimate(defaultFixtureCity); // CHANGE
                const draft={allocationYear:2027,moduleCell:previewFixtureState.moduleCell,bed:graph.getModel().getCell('bed'),city,crop:{plantId:'1',label:'Radish',method:'direct_sow.field'},plantResolution:{plant},actionStartISO:'2027-04-01',targetDemandStartISO:'2027-05-01',targetDemandEndISO:'2027-05-08'}; // CHANGE
                draft.lifecycle=await hooks.proposeLifecycle({plant,city,primaryDateISO:draft.actionStartISO,methodId:'direct_sow.field',methodCategoryId:'direct_sow',seasonStartYear:2027}); // CHANGE
                const status=await hooks.resolveAllocationDefaultStatus(draft); // CHANGE
                window.defaultFixturePending=hooks.openAllocationScheduleDialog(defaultFixtureUi,draft,{previewOnly:true,defaultStatus:status,requiredDefaults:status.missing,focusMissingDefault:'method'}); // CHANGE
                for(let attempt=0;attempt<400&&!window.defaultFixtureDialog;attempt++)await new Promise(resolve=>setTimeout(resolve,10)); // CHANGE
                if(!window.defaultFixtureDialog)throw new Error('Required-default scheduler did not open'); // CHANGE
            })(); // CHANGE
        `); // CHANGE
        const defaultChecks=[]; // CHANGE
        for (const width of [1000,600]) { // CHANGE
            win.setSize(width,850); // CHANGE
            defaultChecks.push(await win.webContents.executeJavaScript(` // CHANGE
                (async()=>{ // CHANGE
                    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))); // CHANGE
                    const dialog=defaultFixtureDialog,bounds=dialog.getBoundingClientRect(),checkbox=dialog.querySelector('[data-allocation-save-lifecycle]'),grown=dialog.querySelector('[data-allocation-save-grown-for]'); // CHANGE
                    const submit=[...dialog.querySelectorAll('button')].find(button=>button.textContent==='Save defaults & preview'),rect=submit.getBoundingClientRect(); // CHANGE
                    return {width:innerWidth,requiredLocked:checkbox.checked&&checkbox.disabled&&grown.checked&&grown.disabled,methodHighlighted:parseFloat(getComputedStyle(dialog.querySelector('[data-allocation-required-field="method"]').parentElement).outlineWidth)>0,summaryVisible:dialog.querySelector('[data-allocation-required-summary]').getBoundingClientRect().height>0,submitVisible:rect.width>0&&rect.left>=bounds.left-1&&rect.right<=bounds.right+1&&rect.bottom<=bounds.bottom+1,methodFocus:document.activeElement.closest('.usl-scheduler-row')?.textContent.includes('Planting method')}; // CHANGE: outline width varies with Chromium's device scale factor.
                })(); // CHANGE
            `)); // CHANGE
        } // CHANGE
        if(process.env.TRELLIS_DEFAULTS_SCREENSHOT)fs.writeFileSync(process.env.TRELLIS_DEFAULTS_SCREENSHOT,(await win.webContents.capturePage()).toPNG()); // CHANGE: preserve visual diagnostics even when a layout assertion fails.
        for (const check of defaultChecks) assert.ok(check.requiredLocked&&check.methodHighlighted&&check.summaryVisible&&check.submitVisible&&check.methodFocus,JSON.stringify(check)); // CHANGE
        result.defaultChecks=defaultChecks; // CHANGE
        await win.webContents.executeJavaScript(` // CHANGE
            (async()=>{ // CHANGE
                [...defaultFixtureDialog.querySelectorAll('button')].find(button=>button.textContent.startsWith('Tasks')).click(); // CHANGE
                for(let attempt=0;attempt<200&&!defaultFixtureDialog.querySelector('[data-allocation-save-tasks]');attempt++)await new Promise(resolve=>setTimeout(resolve,10)); // CHANGE
                const checkbox=defaultFixtureDialog.querySelector('[data-allocation-save-tasks]'); // CHANGE
                if(!checkbox?.checked||!checkbox.disabled||!defaultFixtureDialog.querySelector('[data-allocation-required-field="tasks"]')?.textContent.includes('Required default not saved'))throw new Error('Tasks required-default indicators are unavailable'); // CHANGE
                [...defaultFixtureDialog.querySelectorAll('button')].find(button=>button.textContent==='Cancel').click();await defaultFixturePending; // CHANGE
            })(); // CHANGE
        `); // CHANGE
        await win.webContents.executeJavaScript(` // CHANGE
            (async()=>{ // CHANGE
                const crop={id:'radish',plantId:'1',label:'Radish',plant:'Radish',method:'direct_sow.field',kgPerPlant:1},plan={year:2027,crops:[crop]}; // CHANGE
                const coverage={plan,totals:{targetKg:4,shortKg:4},cropSummaries:[{cropId:'radish',targetKg:4,shortKg:4}],weekStarts:[{iso:'2027-01-04'},{iso:'2027-01-11'}],weekSummaries:[{weekIndex:0,start:'2027-01-04',targetKg:0,shortKg:0,cropShortages:[]},{weekIndex:1,start:'2027-01-11',targetKg:4,shortKg:4,cropShortages:[{cropId:'radish',shortKg:4}]}]}; // CHANGE
                USL.scheduler.resolveCityForModule=async()=>({ok:true,city:defaultFixtureCity});USL.scheduler.listGrowthStagesForPlanCrop=undefined; // CHANGE
                USL.scheduler.proposeLifecycleForDemandWindow=async()=>({ok:true,status:'compatible',startISO:'2027-01-04',primaryDateISO:'2027-01-04',attributePatch:{sow_date:'2027-01-04',harvest_start:'2027-01-11',harvest_end:'2027-01-17'},taskPreview:[],warnings:[]}); // CHANGE
                const weekly=(usable,short)=>({perCrop:new Map([['radish',{target:[0,4],usableSupply:[0,usable],short:[0,short]}]])}); // CHANGE
                USL.planningCore={loadPlanForYear:()=>plan,computeYearCoverage:()=>coverage,recommendPlantCount:()=>({plantCount:4,reachableShortKg:4}),simulateCandidatePlanting:()=>({demandServedKg:4,base:{...coverage,weekly:weekly(0,4)},coverage:{...coverage,weekly:weekly(4,0)}})}; // CHANGE
                graph.setSelectionCell(graph.getModel().getCell('bed'));window.defaultControlsState=await USL.allocate.open(previewFixtureState.moduleCell,2027); // CHANGE
                for(let attempt=0;attempt<400&&defaultControlsState.scheduleProgress.phase!=='complete';attempt++)await new Promise(resolve=>setTimeout(resolve,10)); // CHANGE
                defaultControlsState.hudRefs.cropSelect.value='radish';defaultControlsState.hudRefs.cropSelect.dispatchEvent(new Event('change')); // CHANGE
                for(let attempt=0;attempt<400&&(!defaultControlsState.draft||defaultControlsState.defaultsLookup?.pending);attempt++)await new Promise(resolve=>setTimeout(resolve,10)); // CHANGE
                if(!defaultControlsState.draft)throw new Error('Allocation controls did not receive a draft'); // CHANGE
            })(); // CHANGE
        `); // CHANGE
        const controlChecks=[]; // CHANGE
        for(const width of [1000,360]) { // CHANGE
            win.setSize(width,600); // CHANGE
            controlChecks.push(await win.webContents.executeJavaScript(` // CHANGE
                (async()=>{ // CHANGE
                    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))); // CHANGE
                    const state=defaultControlsState,links=[...state.hudRefs.defaultsBox.querySelectorAll('[data-allocation-missing-default]')];state.hud.scrollTop=state.hud.scrollHeight; // CHANGE
                    const rect=state.hudRefs.create.getBoundingClientRect(); // CHANGE
                    return {width:innerWidth,missing:links.map(link=>link.textContent),createDisabled:state.hudRefs.create.disabled,label:state.hudRefs.create.textContent,createReachable:rect.left>=0&&rect.right<=innerWidth+1&&rect.top>=0&&rect.bottom<=innerHeight+1,linksFit:links.every(link=>link.scrollWidth<=link.clientWidth+1)}; // CHANGE
                })(); // CHANGE
            `)); // CHANGE
        } // CHANGE
        for(const check of controlChecks){assert.deepEqual(check.missing,['Planting method','Task recipe','Grown-for stage']);assert.ok(check.createDisabled&&check.createReachable&&check.linksFit&&check.label==='Create planting',JSON.stringify(check));} // CHANGE
        result.controlChecks=controlChecks; // CHANGE
        await win.webContents.executeJavaScript('USL.allocate.close();'); // CHANGE
        for (const name of ['Garden_Roadmap_Core.js', 'Garden_Roadmap_Manager.js', 'Modules_Standalone.js']) { // CHANGE: exercise display geometry from the actual personal projection plugin.
            await win.webContents.executeJavaScript(fs.readFileSync(path.join(webapp, 'plugins/garden_planner_plugins', name), 'utf8')); // CHANGE
        } // CHANGE
        const regularSpacing = await win.webContents.executeJavaScript(` // CHANGE
            (async()=>{ // CHANGE
                const fixture=await (${createRegularSpacingFixture.toString()})(window,graph),checks=[]; window.regularSpacingFixture=fixture; // CHANGE
                const entry=await fixture.open(),before=fixture.serialize(),field=fixture.edit(entry); // CHANGE
                const context=await fixture.tools.buildSpacingLayoutRows(graph,fixture.groups[0]); // CHANGE
                const bedScoped=context.scope==='bed'&&context.rows.some(row=>row.bedId); // CHANGE
                const draft=context.rows.map(row=>{const changed=row.cellId===fixture.groups[0].id;return {...row,spacingXCm:changed?33:row.spacingXCm,enabled:changed,previewOnly:bedScoped&&!changed,previewUnrotated:bedScoped};}); // CHANGE
                const preview=fixture.tools.buildSpacingPreviewModel(graph,draft); // CHANGE: the actual navigator may include unchanged neighboring plantings as bed context.
                const savedOuter=fixture.outer.getGeometry(),projectedOuter=graph.getCellGeometry(fixture.outer); // CHANGE
                const displaced=savedOuter.x!==projectedOuter.x||savedOuter.y!==projectedOuter.y; // CHANGE
                async function capture(name){ // CHANGE
                    await fixture.settle(); // CHANGE
                    const host=document.querySelector('.manual-link-spacing-preview'); // CHANGE
                    const frame=host.querySelector('[data-spacing-preview-cell="'+fixture.groups[0].id+'"]'),rect=frame.getBoundingClientRect(); // CHANGE
                    const state=graph.view.getState(fixture.groups[0]),target=state.shape.node.getBoundingClientRect(); // CHANGE
                    const dots=[...host.querySelectorAll('.manual-link-spacing-preview-plant')]; // CHANGE
                    let dotIndex=0,maxCircleDelta=0; // CHANGE
                    for(const row of preview.rows){ // CHANGE
                        const frameRect=host.querySelector('[data-spacing-preview-cell="'+row.cellId+'"]').getBoundingClientRect(); // CHANGE
                        for(const dot of row.groupPreview.circles){ // CHANGE
                            const bounds=dots[dotIndex++]?.getBoundingClientRect();if(!bounds){maxCircleDelta=Infinity;continue;} // CHANGE
                            maxCircleDelta=Math.max(maxCircleDelta,Math.abs(bounds.x+bounds.width/2-frameRect.x-(dot.x-row.rect.x)*graph.view.scale),Math.abs(bounds.y+bounds.height/2-frameRect.y-(dot.y-row.rect.y)*graph.view.scale)); // CHANGE
                        } // CHANGE
                    } // CHANGE
                    const circlesAligned=dots.length===dotIndex&&maxCircleDelta<=2; // CHANGE
                    checks.push({name,deltaX:rect.x-target.x,deltaY:rect.y-target.y,circlesAligned,maxCircleDelta,actualCircles:dots.length,expectedCircles:dotIndex,focusRetained:document.activeElement===field&&entry.panel.querySelector('input[type=number]')===field,rawValue:field.value,hidden:state.shape.node.style.opacity==='0'}); // CHANGE
                } // CHANGE
                for(const scale of [1.35,1.75]){ // CHANGE
                    graph.view.scaleAndTranslate(scale,5,10); // CHANGE
                    const state=graph.view.getState(fixture.groups[0]);graph.container.scrollLeft=Math.max(0,state.x-400);graph.container.scrollTop=Math.max(0,state.y-200); // CHANGE
                    await capture(scale*100+'% nested and scrolled'); // CHANGE
                    graph.container.scrollLeft+=40;graph.container.scrollTop+=30;await capture(scale*100+'% forward scroll'); // CHANGE
                    graph.container.scrollLeft-=80;graph.container.scrollTop-=60;await capture(scale*100+'% reverse scroll'); // CHANGE
                } // CHANGE
                fixture.roadmap.setViewState(fixture.board,{today:{multiplier:3}});await capture('changed Roadmap projection'); // CHANGE
                graph.view.setCurrentRoot(fixture.garden);await capture('entered garden root'); // CHANGE
                graph.view.setCurrentRoot(null);await capture('returned to diagram root'); // CHANGE
                const unchanged=fixture.serialize()===before; // CHANGE
                graph.__trellisPlantingSpacingEditor.clear(); // CHANGE
                const restored=graph.view.getState(fixture.groups[0]).shape.node.style.opacity!=='0'&&!document.querySelector('.manual-link-spacing-preview'); // CHANGE
                return {checks,displaced,unchanged,restored}; // CHANGE
            })(); // CHANGE
        `); // CHANGE
        for (const check of regularSpacing.checks) { // CHANGE
            assert.ok(Math.abs(check.deltaX) <= 2 && Math.abs(check.deltaY) <= 2 && check.circlesAligned && check.focusRetained && check.rawValue === '33' && check.hidden, JSON.stringify(check)); // CHANGE
        } // CHANGE
        assert.ok(regularSpacing.displaced && regularSpacing.unchanged && regularSpacing.restored, JSON.stringify(regularSpacing)); // CHANGE
        result.regularSpacing = regularSpacing; // CHANGE
        win.setSize(1000,750); // CHANGE
        result.overhangControls = await win.webContents.executeJavaScript(` // CHANGE
            (async()=>{ // CHANGE
                const fixture=regularSpacingFixture,context=await fixture.tools.buildSpacingLayoutRows(graph,fixture.groups[0]); // CHANGE
                graph.__trellisPlantingGroup.overlay.clear(); // CHANGE
                const checks=[]; // CHANGE
                for(const [index,live]of [false,true].entries()){ // CHANGE
                    const host=document.createElement('div');host.style.cssText='position:fixed;top:24px;left:'+(index?530:24)+'px;width:'+(live?300:420)+'px;padding:12px;background:white;border:1px solid #777;z-index:10040;'; // CHANGE
                    const title=document.createElement('h3');title.textContent=live?'Allocate · Spacing':'Planting · Spacing';host.appendChild(title);document.body.appendChild(host); // CHANGE
                    graph.__trellisPlantingSpacingEditor.render(host,context,{live,fitToDemand:live,onChange:()=>{}}); // CHANGE
                    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))); // CHANGE
                    const controls=[...host.querySelectorAll('input[aria-label$="Allowed overhang (%)"]')],bounds=host.getBoundingClientRect(); // CHANGE
                    checks.push({live,count:controls.length,allFit:controls.every(input=>{const rect=input.getBoundingClientRect();return rect.left>=bounds.left&&rect.right<=bounds.right;}),labels:controls.every(input=>input.title.includes('Percentage')),hint:host.textContent.includes('Committed edits update the crop default')}); // CHANGE
                } // CHANGE
                return checks; // CHANGE
            })(); // CHANGE
        `); // CHANGE
        for(const check of result.overhangControls) assert.ok(check.count>0&&check.allFit&&check.labels&&check.hint,JSON.stringify(check)); // CHANGE
        if(process.env.TRELLIS_OVERHANG_SCREENSHOT)fs.writeFileSync(process.env.TRELLIS_OVERHANG_SCREENSHOT,(await win.webContents.capturePage()).toPNG()); // CHANGE
        process.stdout.write('PREVIEW_RESULT:' + JSON.stringify(result) + '\n'); // CHANGE
    } finally { win.destroy(); } // CHANGE
    app.quit(); // CHANGE
}).catch(error => { process.stderr.write(error.stack + '\n'); app.exit(1); }); // CHANGE
