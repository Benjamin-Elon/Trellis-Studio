/** Verify actual Chromium styling, native activation, and viewport positioning on both production entry surfaces. */ // NEW
const assert = require('node:assert/strict'); // NEW
const fs = require('node:fs'); // NEW
const path = require('node:path'); // NEW
const { app, BrowserWindow } = require('electron'); // NEW
const { exchangeDashboardSource } = require('./exchange-dashboard-harness.cjs'); // NEW
const project = path.resolve(__dirname, '../..'), webapp = path.join(project, 'drawio/src/main/webapp'), output = path.join(project, '.test-artifacts/exchange-buttons'); // NEW
app.disableHardwareAcceleration(); app.commandLine.appendSwitch('disable-gpu'); app.commandLine.appendSwitch('in-process-gpu'); // NEW
const profile = path.join(app.getPath('temp'), 'trellis-exchange-buttons-' + process.pid); fs.mkdirSync(profile, { recursive: true }); app.setPath('userData', profile); // NEW
app.whenReady().then(async () => { // NEW
    const win = new BrowserWindow({ show: false, width: 1100, height: 900, webPreferences: { sandbox: false, backgroundThrottling: false } }); // NEW
    win.webContents.on('console-message', event => { if (event.level === 'error') console.error('Renderer: ' + event.message); }); // NEW
    const run = code => win.webContents.executeJavaScript(code), settle = () => new Promise(resolve => setTimeout(resolve, 150)); // NEW
    function key(keyCode) { win.webContents.focus(); win.webContents.sendInputEvent({ type: 'keyDown', keyCode }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode }); } // NEW
    async function capture(name) { // NEW
        await settle(); await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true }); // NEW
        await run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))'); fs.mkdirSync(output, { recursive: true }); // NEW
        fs.writeFileSync(path.join(output, name + '.png'), (await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG()); // NEW
    } // NEW
    try { // NEW
        await win.loadURL('data:text/html,' + encodeURIComponent('<!doctype html><meta charset="utf-8"><body style="margin:0;background:#edf3ed;font:14px Arial"><div id="dashboard-host"></div></body>')); // NEW
        await run(String.raw` // NEW
            window.Draw = { loadPlugin() {} }; window.qualified = false; window.identitySubscribers = new Set(); window.actions = new Map(); // NEW
            window.trellisIdentity = { list:async()=>({identities:[],session:{identityId:'alice',username:'Alice'}}),getSession:async()=>({identityId:'alice',username:'Alice'}),onStatus(fn){identitySubscribers.add(fn);return()=>identitySubscribers.delete(fn);},onLocked(){return()=>{};} }; // NEW
            window.trellisExchange = { status:async()=>({qualified,currency:'',reason:'The Grand Exchange is awaiting qualified coordinator peer and community synchronization, garden authorization, and durable inventory reservation receipts.'}) }; // NEW
            window.trellisGardenLibrary = { list:async()=>({gardens:[]}),listLocal:async()=>({gardens:[],folder:'/gardens'}),cities:async()=>({cities:[]}),getReferenceCity:async()=>({city:null}) }; // NEW
            window.mxResources = {get:key=>key};window.mxEvent={addListener:(node,name,fn)=>node.addEventListener(name,fn),consume(event){event.preventDefault();event.stopPropagation();}}; // NEW
            window.ui={editor:{graph:{destroy(){},removeListener(){}},removeListener(){},addListener(){}},actions:{get:id=>actions.get(id),addAction(id,funct){const action={funct};actions.set(id,action);return action;}},menus:{get:()=>null},getCurrentFile:()=>null,showSplash(){},handleError(error){throw error;},fileLoaded(){}}; // NEW
            ui.showDialog=(panel,width,height,_modal,_closable,onClose)=>{const container=document.createElement('div');container.className='geDialog';container.style.cssText='position:fixed;left:50%;top:30px;transform:translateX(-50%);width:'+width+'px;height:'+height+'px;z-index:2000000000;background:#fff;box-shadow:0 4px 24px #0003';container.append(panel);document.body.append(container);ui.dialog={container,onClose};}; // NEW
            ui.hideDialog=()=>{const dialog=ui.dialog;if(!dialog)return;dialog.onClose?.(false);dialog.container.remove();ui.dialog=null;}; // NEW
            void 0; // NEW: executeJavaScript must return a value that Electron can serialize.
        `); // NEW
        await run('const style=document.createElement("style");style.textContent=' + JSON.stringify(fs.readFileSync(path.join(webapp, 'styles/trellis-splash.css'), 'utf8')) + ';document.head.append(style);void 0;'); // NEW
        for (const filename of ['plugins/garden_planner_plugins/Trellis_UI_Cleanup.js', 'plugins/garden_planner_plugins/Trellis_Inventories.js', 'js/trellis-garden-home.js']) await run(fs.readFileSync(path.join(webapp, filename), 'utf8')); // NEW
        await run('TrellisGardenHome.showProjects(ui);void 0;'); await settle(); // NEW
        await run('window.entry=document.querySelector(".trellis-projects-top .trellis-exchange-button");entry.previousElementSibling.focus();void 0;'); key('Tab'); await settle(); // NEW
        assert.equal(await run('document.activeElement===entry'), true); assert.equal(await run('entry.getAttribute("aria-disabled")'), 'true'); // NEW
        assert.equal(await run('getComputedStyle(entry).backgroundColor'), 'rgb(229, 231, 235)'); assert.match(await run('document.querySelector("[role=tooltip]").textContent'), /app update/); // NEW
        key('Return'); await settle(); assert.equal(await run('!!document.querySelector("[role=dialog]")'), false); await capture('home-unavailable'); // NEW
        key('Escape'); assert.equal(await run('!!document.querySelector("[role=tooltip]")'), false); assert.equal(await run('document.activeElement===entry'), true); // NEW
        await run('qualified=true;window.dispatchEvent(new Event("focus"));void 0;'); await settle(); assert.equal(await run('getComputedStyle(entry).backgroundColor'), 'rgb(245, 220, 137)'); // NEW
        // Hidden windows have no reliable OS hover target; ask Chromium to evaluate its real hover rule. // NEW
        await run('entry.style.transition="none";void 0;'); // NEW: measure the target color independently of hidden compositor animation timing.
        win.webContents.debugger.attach('1.3'); await win.webContents.debugger.sendCommand('DOM.enable'); await win.webContents.debugger.sendCommand('CSS.enable'); const tree = await win.webContents.debugger.sendCommand('DOM.getDocument'); // NEW
        const hover = await win.webContents.debugger.sendCommand('DOM.querySelector', { nodeId: tree.root.nodeId, selector: '.trellis-projects-top .trellis-exchange-button' }); // NEW
        await win.webContents.debugger.sendCommand('CSS.forcePseudoState', { nodeId: hover.nodeId, forcedPseudoClasses: ['hover'] }); await settle(); // NEW
        assert.equal(await run('getComputedStyle(entry).backgroundColor'), 'rgb(239, 208, 114)'); win.webContents.debugger.detach(); await capture('home-gold'); // NEW
        key('Space'); await settle(); assert.equal(await run('document.querySelectorAll("[role=dialog]").length'), 1); // NEW
        await run('[...document.querySelectorAll("[role=dialog] button")].find(button=>button.textContent==="Close").click();ui.hideDialog();void 0;'); // NEW
        await run(exchangeDashboardSource()); await run('window.toolbar=exchangeDashboard.mount();window.entry=toolbar.wrap.querySelector(".trellis-exchange-button");void 0;'); await settle(); // NEW
        assert.equal(await run('getComputedStyle(entry).backgroundColor'), 'rgb(245, 220, 137)'); await capture('dashboard-gold'); // NEW
        await run('qualified=false;window.dispatchEvent(new Event("focus"));void 0;'); await settle(); // NEW
        const click = await run('(()=>{const r=entry.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};})()'); // NEW
        for (const type of ['mouseMove', 'mouseDown', 'mouseUp']) win.webContents.sendInputEvent({ type, ...click, ...(type === 'mouseMove' ? {} : { button: 'left', clickCount: 1 }) }); await settle(); // NEW
        assert.equal(await run('document.activeElement===entry'), true, 'Dashboard mouse presses preserve native button focus'); assert.equal(await run('!!document.querySelector("[role=dialog]")'), false); await capture('dashboard-unavailable'); // NEW
        await run('exchangeDashboard.hide();void 0;'); assert.equal(await run('!!document.querySelector("[role=tooltip]")'), false); // NEW
        win.setSize(420, 340); await settle(); // NEW
        await run('exchangeDashboard.mount();entry.style.position="fixed";entry.style.right="4px";entry.style.bottom="4px";entry.focus();entry.click();void 0;'); await settle(); // NEW
        const bounds = await run('(()=>{const r=document.querySelector("[role=tooltip]").getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:innerWidth,height:innerHeight};})()'); // NEW
        assert.ok(bounds.left >= 8 && bounds.top >= 8 && bounds.right <= bounds.width - 8 && bounds.bottom <= bounds.height - 8, JSON.stringify(bounds)); await capture('compact-unavailable'); // NEW
        await run('exchangeDashboard.destroy();void 0;'); assert.equal(await run('!!document.querySelector("[role=tooltip]")'), false); // NEW
        console.log('EXCHANGE_BUTTON_RESULT:' + JSON.stringify({ bounds, screenshots: output })); win.destroy(); app.exit(0); // NEW
    } catch (error) { console.error(error.stack || error); try { await capture('failure'); } catch (_) {} win.destroy(); app.exit(1); } // NEW
}); // NEW
