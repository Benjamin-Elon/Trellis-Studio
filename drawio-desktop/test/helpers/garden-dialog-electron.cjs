/** Render production dialog code/styles with deterministic bridges, independently of daemon startup. */ // NEW
const { app, BrowserWindow } = require('electron'); // NEW
const fs = require('node:fs'); // NEW
const path = require('node:path'); // NEW
const assert = require('node:assert/strict'); // NEW
const project = path.resolve(__dirname, '../..'), output = path.join(project, '.test-artifacts', 'garden-dialog', String(process.pid)); // NEW
fs.mkdirSync(output, { recursive: true }); app.setPath('userData', path.join(output, 'profile')); app.disableHardwareAcceleration(); app.commandLine.appendSwitch('in-process-gpu'); // CHANGE: isolate captures from the user's running app and match the other restricted-host renderer fixtures.
const deadline = setTimeout(() => { console.error('Dialog renderer test timed out'); app.exit(1); }, 60000); // NEW
app.whenReady().then(async () => { // NEW
    const window = new BrowserWindow({ width: 1100, height: 850, show: false, webPreferences: { backgroundThrottling: false } }); // NEW
    await window.loadURL('data:text/html,<html><body></body></html>'); // NEW
    const run = code => window.webContents.executeJavaScript(code); // NEW
    await run(`document.head.append(Object.assign(document.createElement('style'),{textContent:${JSON.stringify(fs.readFileSync(path.join(project, 'drawio/src/main/webapp/styles/trellis-splash.css'), 'utf8'))}+ 'body{margin:0;background:#edf0e9;font:14px Arial}.geDialog{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);margin:0;width:920px;height:760px;box-sizing:border-box;border:1px solid #b9c2b0}.geBtn{font:14px Arial;padding:7px 12px}'})); // NEW
        window.Draw={loadPlugin(){}};void 0;`); // NEW
    await run(fs.readFileSync(path.join(project, 'drawio/src/main/webapp/plugins/garden_planner_plugins/Trellis_UI_Cleanup.js'), 'utf8') + ';void 0;'); // NEW
    await run(` // NEW
        const session={identityId:'alice',username:'Benny'}, city={cityId:'langley',name:'Langley',region:'British Columbia',country:'Canada',latitude:49,longitude:-122}; // NEW
        const people=(keys,online)=>({userCount:keys.length,memberKeys:keys,onlineMemberKeys:online,onlineCount:online.length,membershipComplete:true,presenceComplete:true}); // NEW
        const joined={diagramId:'joined',name:'Community demonstration garden',description:'Growing food together',source:'library',available:true,shared:true,userCount:2,people:people(['a','b'],['a']),distanceKm:0,moduleCities:[city],gardenModuleCount:1}; // NEW
        const shared={diagramId:'shared',name:'Orchard cooperative',source:'library',available:true,shared:true,userCount:3,people:people(['a','b','c'],['a','c']),distanceKm:25,moduleCities:[city],gardenModuleCount:1}; // NEW
        window.trellisIdentity={list:async()=>({session,identities:[]}),getSession:async()=>session,onStatus(){},onLocked(){}}; // NEW
        window.trellisGardenLibrary={list:async()=>({gardens:[joined,shared,...Array.from({length:12},(_,i)=>({diagramId:'private'+i,name:'Private garden '+(i+1),source:'library',available:true,userCount:1,moduleCities:[city]}))]}),listLocal:async()=>({gardens:[],folder:'Documents / Trellis / Local Garden Projects'}),cities:async()=>({cities:[city,{...city,cityId:'seattle',name:'Seattle',region:'Washington',country:'United States'}]}),getReferenceCity:async()=>({city}),setReferenceCity:async()=>({city})}; // NEW
        window.trellisGardenCommunities={onStatus(){},list:async()=>({communities:[{id:'community',name:'Neighborhood gardens',description:'Our shared neighborhood growing spaces.',gardens:[{...joined,joined:true},{diagramId:'discovery',name:'Riverside garden',description:'A garden you can request to join.',joined:false,people:people(['b','c'],['c']),distanceKm:12,moduleCities:[city]}],administrators:['alice']}]}),listRequests:async()=>({requests:[]})}; // NEW
        window.mxResources={get:key=>key}; const actions=new Map(); // NEW
        window.testUi={actions:{addAction(id,funct){const action={funct};actions.set(id,action);return action;},get:id=>actions.get(id)},menus:{get:()=>null},getCurrentFile:()=>null,showSplash(){},showDialog(panel){const container=document.createElement('div');container.className='geDialog';container.append(panel);document.body.append(container);this.dialog={container};},hideDialog(){this.dialog?.container.remove();},handleError(error){throw error;}}; // NEW
        void 0; // NEW
    `); // NEW
    await run(`window.dialogTimings=[];window.dialogBackendReads={};window.TrellisGardenHomeTiming=sample=>dialogTimings.push(sample);for(const [name,bridge,methods] of [['library',trellisGardenLibrary,['list','listLocal','cities','getReferenceCity']],['community',trellisGardenCommunities,['list','listRequests']]])for(const method of methods){const original=bridge[method];bridge[method]=(...args)=>{const key=name+'.'+method;dialogBackendReads[key]=(dialogBackendReads[key]||0)+1;return original(...args);};}void 0;`); // CHANGE: separate backend work counts from rendering and idle interaction.
    await run(fs.readFileSync(path.join(project, 'drawio/src/main/webapp/js/trellis-garden-home.js'), 'utf8') + ';void 0;'); // NEW
    await run(`window.dialogMeasures={};window.dialogOpenedAt=performance.now();TrellisGardenHome.showProjects(testUi);new Promise(resolve=>{const ready=()=>{const state=testUi.__trellisGardenHome;if(Object.keys(state.sectionLoads).length===5&&Object.values(state.sectionLoads).every(load=>!load.loading)){dialogMeasures.initial={milliseconds:performance.now()-dialogOpenedAt,reads:{...dialogBackendReads}};resolve();}else setTimeout(ready,5);};ready();})`); // CHANGE
    const manual = await run(`(async()=>{const state=testUi.__trellisGardenHome,before={...dialogBackendReads},started=performance.now();state.projectLoadHeaders.shared.reload.click();while(state.sectionLoads.shared.loading)await new Promise(resolve=>setTimeout(resolve,0));return dialogMeasures.manual={milliseconds:performance.now()-started,libraryReads:dialogBackendReads['library.list']-before['library.list'],localReads:dialogBackendReads['library.listLocal']-before['library.listLocal']};})()`); assert.equal(manual.libraryReads,1); assert.equal(manual.localReads,0); // CHANGE
    const idle = await run(`(async()=>{const state=testUi.__trellisGardenHome,before=JSON.stringify(dialogBackendReads),started=performance.now();for(let index=0;index<30;index++){state.searchControl.value=index%2?'garden':'';state.searchControl.dispatchEvent(new Event('input'));}state.searchControl.value='';state.searchControl.dispatchEvent(new Event('input'));const interactionMilliseconds=performance.now()-started;await new Promise(resolve=>setTimeout(resolve,1000));return dialogMeasures.idle={interactionMilliseconds,metadataUnchanged:before===JSON.stringify(dialogBackendReads)};})()`); assert.equal(idle.metadataUnchanged,true); // CHANGE
    await run(`testUi.__trellisGardenHome.communitiesRows.querySelector('summary').click()`); // NEW
    const capture = async name => { await run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))'); fs.writeFileSync(path.join(output, name), (await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG()); }; // NEW
    await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true }); // CHANGE: warm the hidden compositor before the first verified capture.
    await capture('wide.png'); // NEW
    const foldsRight = await run(`[...document.querySelectorAll('.trellis-projects-heading')].every(heading=>heading.getBoundingClientRect().right-heading.querySelector('.trellis-projects-toggle').getBoundingClientRect().right<8)`); assert.equal(foldsRight, true); // NEW
    const sticky = await run(`(()=>{const state=testUi.__trellisGardenHome,header=state.projectsRoot.querySelector('header'),top=header.getBoundingClientRect().top;state.projectsBody.scrollTop=350;return {top,after:header.getBoundingClientRect().top,scroll:state.projectsBody.scrollTop,overflow:state.projectsRoot.scrollWidth>state.projectsRoot.clientWidth+1};})()`); // NEW
    assert.equal(sticky.top, sticky.after); assert.ok(sticky.scroll > 0); assert.equal(sticky.overflow, false); // NEW
    await run(`window.dialogOriginalList=trellisGardenLibrary.list;trellisGardenLibrary.list=()=>new Promise(resolve=>window.dialogFinishList=resolve);testUi.__trellisGardenHome.projectSectionToggles.shared.click();testUi.__trellisGardenHome.projectLoadHeaders.shared.reload.click();void 0;`); // NEW
    assert.equal(await run(`testUi.__trellisGardenHome.projectLoadHeaders.shared.status.textContent==='Loading…'&&testUi.__trellisGardenHome.sharedRows.hidden&&testUi.__trellisGardenHome.privateRows.textContent.includes('Private garden')`), true); // NEW
    await run('new Promise(resolve=>setTimeout(resolve,120))'); // NEW: let the hidden compositor consume the loading/fold invalidation.
    await capture('loading.png'); // NEW
    assert.equal(await run(`testUi.__trellisGardenHome.projectLoadHeaders.shared.status.textContent==='Loading…'&&testUi.__trellisGardenHome.sharedRows.hidden`), true); // NEW
    await run(`dialogOriginalList().then(result=>dialogFinishList(result));trellisGardenLibrary.list=dialogOriginalList;testUi.__trellisGardenHome.projectSectionToggles.shared.click();new Promise(resolve=>setTimeout(resolve,50));`); // NEW
    await run(`testUi.__trellisGardenHome.projectsBody.scrollTop=0;const menu=testUi.__trellisGardenHome.communitiesRows.querySelector('.trellis-project-menu');menu.open=true;testUi.__trellisGardenHome.searchControl.click();if(menu.open)throw new Error('Outside click did not close actions');`); // NEW
    await run(`const picker=testUi.__trellisGardenHome.referenceHost.querySelector('.trellis-city-picker');picker.open=true;const search=picker.querySelector('input');search.value='Canada';search.dispatchEvent(new Event('input'));`); // NEW
    await capture('city-picker.png'); // NEW
    await run(`testUi.__trellisGardenHome.referenceHost.querySelector('.trellis-city-picker').open=false; // CHANGE
        window.accountFind=label=>[...testUi.__trellisGardenHome.accountHost.querySelectorAll('button')].find(button=>button.textContent===label); // NEW
        window.accountSummary=testUi.__trellisGardenHome.accountHost.querySelector('summary'); // NEW
        trellisIdentity.getDevices=async()=>Array.from({length:30},(_,index)=>({id:'device'+index,name:'Paired computer '+(index+1),kind:'desktop'})); // NEW
        testUi.__trellisGardenHome.projectsBody.scrollTop=120;window.accountScroll=testUi.__trellisGardenHome.projectsBody.scrollTop;accountSummary.click();void 0;`); // NEW
    await capture('account-overview.png'); // NEW
    await run(`accountFind('Change password').click();void 0;`); await capture('account-password.png'); // NEW
    assert.equal(await run(`document.activeElement===testUi.__trellisGardenHome.accountHost.querySelector('input')`), true); // NEW
    await run(`document.activeElement.value='discard this draft';document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));void 0;`); // NEW
    assert.equal(await run(`document.activeElement===accountSummary&&!accountSummary.parentNode.open&&!testUi.__trellisGardenHome.accountHost.querySelector('input')`), true); // NEW
    await run(`accountSummary.click();accountFind('Manage devices').click();new Promise(resolve=>setTimeout(resolve,20));`); // NEW
    await capture('account-devices.png'); // NEW
    const accountBounds = await run(`(()=>{const panel=document.querySelector('.trellis-account-panel'),bounds=panel.getBoundingClientRect(),root=testUi.__trellisGardenHome.projectsRoot.getBoundingClientRect();return {inside:bounds.left>=root.left&&bounds.right<=root.right&&bounds.bottom<=root.bottom,scrolls:panel.scrollHeight>panel.clientHeight,count:panel.querySelectorAll('.trellis-account-device').length,projectScroll:testUi.__trellisGardenHome.projectsBody.scrollTop===accountScroll};})()`); // NEW
    assert.deepEqual(accountBounds, { inside: true, scrolls: true, count: 30, projectScroll: true }); // NEW
    await run(`accountSummary.click();void 0;`); window.setSize(500, 750); // CHANGE
    await capture('narrow.png'); // NEW
    const narrow = await run(`(()=>{const root=testUi.__trellisGardenHome.projectsRoot,body=testUi.__trellisGardenHome.projectsBody;return {overflow:body.scrollWidth>body.clientWidth+1 || document.documentElement.scrollWidth>innerWidth+1,width:root.getBoundingClientRect().width,viewport:innerWidth};})()`); // NEW
    assert.equal(narrow.overflow, false); assert.ok(narrow.width <= narrow.viewport); // CHANGE
    window.setSize(380, 500); await run(`accountSummary.click();accountFind('Manage devices').click();new Promise(resolve=>setTimeout(resolve,20));`); // NEW
    await capture('account-narrow.png'); // NEW
    assert.equal(await run(`(()=>{const panel=document.querySelector('.trellis-account-panel'),bounds=panel.getBoundingClientRect(),root=testUi.__trellisGardenHome.projectsRoot.getBoundingClientRect();return bounds.left>=root.left&&bounds.right<=root.right&&bounds.bottom<=root.bottom&&panel.scrollWidth<=panel.clientWidth+1&&document.documentElement.scrollWidth<=innerWidth;})()`), true); // NEW
    await run(`accountSummary.click();accountSummary.click();accountFind('Change password').click();window.accountSubmissions=0;trellisIdentity.changePassword=()=>{accountSubmissions++;return new Promise(resolve=>window.finishAccountPassword=resolve);};document.activeElement.value='current';void 0;`); // NEW
    window.webContents.focus(); window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' }); window.webContents.sendInputEvent({ type: 'char', keyCode: '\r' }); window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' }); // NEW: verify Chromium's real implicit form submission rather than dispatching a submit event.
    await run('new Promise(resolve=>setTimeout(resolve,20))'); assert.equal(await run('accountSubmissions'), 1); // NEW
    assert.equal(await run(`testUi.__trellisGardenHome.accountHost.contains(document.activeElement)`), true); // NEW
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' }); window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' }); // NEW
    await run(`finishAccountPassword({});new Promise(resolve=>setTimeout(resolve,20));`); // NEW
    assert.equal(await run(`!accountSummary.parentNode.open&&testUi.__trellisGardenHome.projectsRoot.isConnected&&document.activeElement===accountSummary`), true); // NEW
    console.log('DIALOG_RENDER_OK', output); console.log('DIALOG_MEASURES',JSON.stringify(await run('dialogMeasures'))); console.log('DIALOG_TIMING', JSON.stringify(await run('dialogTimings'))); // CHANGE
    clearTimeout(deadline); window.destroy(); app.exit(0); // NEW
}).catch(error => { console.error(error); clearTimeout(deadline); app.exit(1); }); // NEW
