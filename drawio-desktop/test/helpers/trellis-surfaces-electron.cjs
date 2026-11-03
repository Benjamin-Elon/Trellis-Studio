/** Render production DOM and floating panels in hidden Chromium; screenshots are review artifacts. */ // NEW
const assert = require('node:assert/strict'); // NEW
const fs = require('node:fs'); // NEW
const os = require('node:os'); // NEW
const path = require('node:path'); // NEW
const { app, BrowserWindow } = require('electron'); // NEW
const project = path.resolve(__dirname, '../..'), webapp = path.join(project, 'drawio/src/main/webapp'); // NEW
const output = path.join(project, '.test-artifacts/layered-surfaces'); // NEW
const plugins = path.join(webapp, 'plugins/garden_planner_plugins'); // NEW
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'trellis-surfaces-'))); // NEW
app.disableHardwareAcceleration(); app.commandLine.appendSwitch('disable-gpu'); app.commandLine.appendSwitch('in-process-gpu'); // NEW

app.whenReady().then(async () => { // NEW
    const win = new BrowserWindow({ show: false, width: 1440, height: 1000, webPreferences: { sandbox: false, backgroundThrottling: false } }); // NEW
    const run = code => win.webContents.executeJavaScript(code); // NEW
    async function capture(name) { // NEW
        await run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))'); // NEW
        await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true }); // NEW
        fs.writeFileSync(path.join(output, name + '.png'), (await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG()); // NEW
    } // NEW
    async function loadYear(name, dark = false) { // NEW
        await win.loadFile(path.join(output, name + '.html')); // NEW
        await run(`const nativeStyle=document.createElement('style');nativeStyle.textContent=${JSON.stringify(fs.readFileSync(path.join(webapp, 'styles/grapheditor.css'), 'utf8'))};document.head.prepend(nativeStyle);document.body.className='geEditor${dark ? ' geDarkMode' : ''}';document.documentElement.style.colorScheme=document.body.style.colorScheme='${dark ? 'dark' : 'light'}';const scroll=document.querySelector('.yp-scroll-body'),demand=document.querySelector('[data-year-plan-strip="demand"]');scroll.scrollTop+=demand.getBoundingClientRect().top-scroll.getBoundingClientRect().top-12;`); // NEW
    } // NEW
    try { // NEW
        if (fs.existsSync(path.join(output, 'year-plan-before.html'))) { await loadYear('year-plan-before'); await capture('year-plan-before'); } // NEW
        await loadYear('year-plan-expanded'); // NEW
        const hierarchy = await run(`(()=>{const style=selector=>getComputedStyle(document.querySelector(selector));return {canvas:style('.yp-scroll-body').backgroundColor,section:style('[data-year-plan-strip="demand"]').backgroundColor,header:style('[data-year-plan-strip="demand"] > .yp-strip-header').backgroundColor,inset:style('.yp-demand-channel').backgroundColor,entry:style('.yp-demand-line-shell').backgroundColor,shadow:style('[data-year-plan-strip="demand"]').boxShadow,nestedShadow:style('.yp-demand-channel').boxShadow};})()`); // NEW
        assert.notEqual(hierarchy.canvas, hierarchy.section); assert.notEqual(hierarchy.header, hierarchy.section); // NEW
        assert.notEqual(hierarchy.inset, hierarchy.entry); assert.notEqual(hierarchy.shadow, 'none'); assert.equal(hierarchy.nestedShadow, 'none'); // NEW
        await capture('year-plan-after'); // NEW
        await loadYear('year-plan-picker'); await capture('year-plan-picker'); await loadYear('year-plan-expanded'); // NEW
        await run(`const target=document.querySelector('.yp-demand-line-shell');target.classList.add('yp-target-highlight');if(getComputedStyle(target).outlineStyle!=='solid')throw new Error('Target highlight lost');target.classList.remove('yp-target-highlight');const probe=document.createElement('div');probe.className='geDialog';probe.style.background='rgb(19, 37, 51)';document.body.append(probe);if(getComputedStyle(probe).backgroundColor!=='rgb(19, 37, 51)')throw new Error('Native dialog styling leaked');probe.remove();`); // NEW
        await loadYear('year-plan-collapsed'); await capture('year-plan-collapsed'); // NEW
        await loadYear('year-plan-disabled'); // NEW
        assert.equal(await run(`getComputedStyle(document.querySelector('[data-demand-channel-id="farm_store"]')).opacity`), '0.62'); // NEW
        await capture('year-plan-disabled'); // NEW
        await loadYear('year-plan-expanded', true); // NEW
        assert.equal(await run(`getComputedStyle(document.querySelector('[data-year-plan-strip="demand"]')).backgroundColor`), hierarchy.section); // NEW
        assert.notEqual(await run(`(()=>{const editor=document.createElement('div');editor.className='trellis-surfaces';editor.dataset.trellisSurfaceTheme='editor';editor.dataset.trellisSurface='section';document.body.append(editor);const color=getComputedStyle(editor).backgroundColor;editor.remove();return color;})()`), hierarchy.section); // NEW: editor-native forms keep their existing dark behavior.
        await capture('year-plan-dark-editor'); // NEW
        win.setSize(800, 1000); await loadYear('year-plan-expanded'); // NEW
        assert.equal(await run(`(()=>{const channel=document.querySelector('.yp-demand-channel'),box=channel.getBoundingClientRect(),body=document.querySelector('.yp-scroll-body').getBoundingClientRect();return box.left>=body.left&&box.right<=body.right;})()`), true); // NEW
        assert.equal(await run(`(()=>{const channel=document.querySelector('.yp-demand-channel');channel.querySelector('input[type="text"]').value='Restaurant with a very long name serving the entire local community';return channel.scrollWidth<=channel.clientWidth+1;})()`), true); // NEW
        await capture('year-plan-narrow'); win.setSize(1440, 1000); // NEW
        await win.webContents.setZoomFactor(1.25); await loadYear('year-plan-expanded'); await capture('year-plan-zoom'); win.webContents.setZoomFactor(1); // NEW
        await win.loadFile(path.join(output, 'allocate-panel.html')); // NEW
        assert.equal(await run(`document.querySelector('.trellis-allocate-hud').dataset.trellisSurface`), 'canvas'); // NEW
        assert.notEqual(await run(`getComputedStyle(document.querySelector('.trellis-allocate-hud')).backgroundColor`), await run(`getComputedStyle(document.querySelector('[data-trellis-quickstart="allocation-preview"]')).backgroundColor`)); // NEW
        await capture('allocate-after'); // NEW

        // Start a real graph for the production floating-panel builders. // NEW
        await win.loadURL('data:text/html,' + encodeURIComponent('<!doctype html><body style="margin:0;background:#eef0f3"><div id="graph" style="width:100vw;height:100vh"></div></body>')); // NEW
        await run('window.mxLoadResources=false;window.mxLoadStylesheets=false;'); // NEW
        await run(fs.readFileSync(path.join(webapp, 'mxgraph/mxClient.js'), 'utf8')); // NEW
        await run('window.Draw={loadPlugin(){}};' + fs.readFileSync(path.join(plugins, 'Trellis_UI_Cleanup.js'), 'utf8')); // NEW
        await run(`window.graph=new mxGraph(document.getElementById('graph'));graph.isSpecialColor=()=>false;const actions=new Map();window.ui=Object.assign(new mxEventSource(),{editor:Object.assign(new mxEventSource(),{graph}),actions:{addAction(id,fn){const action={funct:fn};actions.set(id,action);return action;},get:id=>actions.get(id)},menus:{get(){return null;}},getCurrentFile:()=>({getTitle:()=> 'Layered surfaces'}),handleError(error){throw error;}});window.Draw={loadPlugin:fn=>fn(ui)};window.Editor={moveImage:''};window.TrellisContextMenu={install(){},register(){}};const value=mxUtils.createXmlDocument().createElement('object');for(const [key,val]of Object.entries({garden_module:'1',label:'Market garden',garden_name:'Market garden',city_id:'1',unit_system:'metric',default_bed_width_cm:'80',default_bed_length_cm:'300'}))value.setAttribute(key,val);window.garden=graph.insertVertex(graph.getDefaultParent(),'garden',value,300,100,600,550);graph.setSelectionCell(garden);void 0;`); // NEW
        for (const name of ['trellis-narration-catalog.js', 'trellis-narration.js']) await run(fs.readFileSync(path.join(webapp, 'js', name), 'utf8')); // NEW
        await run(fs.readFileSync(path.join(plugins, 'Garden_Quickstart.js'), 'utf8')); // NEW
        await run('graph.__trellisQuickstart.show();void 0;'); // NEW
        await run('new Promise(resolve=>setTimeout(resolve,100))'); // NEW
        const quickstart = await run(`(()=>{const card=document.querySelector('.trellis-quickstart-card');return {body:getComputedStyle(card).backgroundColor,header:getComputedStyle(card.querySelector('header')).backgroundColor};})()`); // NEW
        assert.equal(quickstart.body, 'rgb(245, 240, 230)'); assert.notEqual(quickstart.body, quickstart.header); // NEW
        await run(`document.getElementById('trellis-shared-surface-styles').sheet.disabled=true`); await capture('quickstart-before'); // NEW
        await run(`document.getElementById('trellis-shared-surface-styles').sheet.disabled=false`); await capture('quickstart-after'); // NEW
        await run('graph.__trellisQuickstart.close();void 0;'); // NEW
        await run(fs.readFileSync(path.join(plugins, 'Garden_Irrigation_Planner.js'), 'utf8')); // NEW
        await run('graph.__trellisIrrigationPlanner.openIrrigationMode(garden,{preserveViewport:true});void 0;'); // NEW
        assert.ok(await run(`document.querySelector('.trellis-irrigation-mode-hud [data-trellis-surface="section"]')!==null`)); // NEW
        await run(`document.getElementById('trellis-shared-surface-styles').sheet.disabled=true`); await capture('irrigation-before'); // NEW
        await run(`document.getElementById('trellis-shared-surface-styles').sheet.disabled=false`); // NEW
        await capture('irrigation-after'); // NEW
        await run('graph.__trellisIrrigationPlanner.closeIrrigationMode();void 0;'); // NEW
        await run(fs.readFileSync(path.join(plugins, 'Garden_Equipment.js'), 'utf8')); // NEW
        await run('graph.__trellisEquipment.openDialog(garden);void 0;'); // NEW
        await run(`document.getElementById('trellis-shared-surface-styles').sheet.disabled=true`); await capture('equipment-before'); // NEW
        await run(`document.getElementById('trellis-shared-surface-styles').sheet.disabled=false`); // NEW
        await capture('equipment-after'); // NEW
        console.log('SURFACE_RENDER_OK ' + JSON.stringify({ hierarchy, quickstart, screenshots: output })); // NEW
        win.destroy(); app.exit(0); // NEW
    } catch (error) { console.error(error.stack || error); try { await capture('failure'); } catch (_) {} win.destroy(); app.exit(1); } // NEW
}).catch(error => { console.error(error.stack || error); app.exit(1); }); // NEW
