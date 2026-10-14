/** Exercise the bundled Android web UI with a throwaway identity and the desktop's public sample PNG. */ // NEW
const assert = require('node:assert/strict'); // NEW
const fs = require('node:fs'); // NEW
const http = require('node:http'); // NEW
const os = require('node:os'); // NEW
const path = require('node:path'); // NEW
const { app, BrowserWindow } = require('electron'); // NEW
const project = path.resolve(__dirname, '../..'); // NEW
const output = path.join(project, '.test-artifacts', 'field-garden-preview'); // NEW
const fixture = path.resolve(process.argv[2] || path.join(project, '.test-artifacts/android-physical/whole-garden-work.json')); // NEW
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'trellis-field-preview-')); // NEW
app.setPath('userData', profile); app.disableHardwareAcceleration(); // NEW
let window, server; // NEW
const timeout = setTimeout(() => { console.error('Field preview smoke timed out.'); app.exit(1); }, 90000); // NEW
/** Serve only the bundled web files; the mock replaces Android transport, not drawing or authentication. */ // NEW
function serveWeb() { // NEW
    const files = new Map(['index.html', 'field.css', 'field-app.js', 'field-store.js'].map(name => ['/' + name, path.join(project, 'android-companion/www', name)])); // NEW
    for (const name of ['trellis-field-protocol.js', 'trellis-identity-protocol.js']) files.set('/shared/' + name, path.join(project, 'drawio/src/main/webapp/js', name)); // NEW
    server = http.createServer((request, response) => { // NEW
        if (request.url === '/test-native.js') { // NEW
            response.writeHead(200, { 'Content-Type': 'text/javascript' }).end("globalThis.fieldTestRecords=[];globalThis.fieldTestWrites=[];globalThis.fieldTestNetwork={networkAvailable:false,waitingForWifi:false};globalThis.Capacitor={Plugins:{TrellisSync:{readRecords:async()=>({records:fieldTestRecords,...fieldTestNetwork}),configureIdentity:async()=>({ok:true,waitingForWifi:fieldTestNetwork.waitingForWifi}),setWifiOnly:async({enabled})=>{fieldTestNetwork.waitingForWifi=enabled;return{ok:true};},writeRecord:async(record)=>{fieldTestWrites.push(record);return{ok:true};}}}};"); return; // CHANGE: blocked transport still exposes cached records and accepts signed local outbox writes.
        } // NEW
        const filename = files.get(request.url); // NEW
        if (!filename) { response.writeHead(404).end(); return; } // NEW
        let content = fs.readFileSync(filename); // NEW
        if (request.url === '/index.html') content = content.toString().replace('<script src="shared/', '<script src="test-native.js"></script><script src="shared/'); // NEW
        response.writeHead(200, { 'Content-Type': filename.endsWith('.js') ? 'text/javascript' : filename.endsWith('.css') ? 'text/css' : 'text/html' }).end(content); // NEW
    }); // NEW
    return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve('http://127.0.0.1:' + server.address().port + '/index.html'))); // NEW
} // NEW
/** Bound UI waits and report a useful failure instead of retaining a hidden browser. */ // NEW
async function until(expression, label) { // NEW
    const deadline = Date.now() + 20000; // NEW
    while (!await window.webContents.executeJavaScript(expression)) { // NEW
        if (Date.now() > deadline) throw new Error('Timed out waiting for ' + label); // NEW
        await new Promise(resolve => setTimeout(resolve, 100)); // NEW
    } // NEW
} // NEW
/** Compare actual DOM frames with the PNG coordinate system after native scrolling and zoom. */ // NEW
async function measure() { // NEW
    return window.webContents.executeJavaScript(`(()=>{ // NEW
        const image=document.querySelector('.map-layer img'),hit=document.querySelector('.map-region.selected'),viewport=document.querySelector('.map-viewport'); // NEW
        const picture=image.getBoundingClientRect(),frame=hit.getBoundingClientRect(),region=fieldTestWork.gardens[0].regions.find(r=>r.id===fieldTestWork.tasks[0].locations[0]),garden=fieldTestWork.gardens[0]; // NEW
        return {selected:document.querySelectorAll('.map-region.selected').length,group:hit.getAttribute('aria-label'),imageLoaded:image.complete&&image.naturalWidth===garden.width,width:picture.width,viewportWidth:viewport.clientWidth,scrollX:viewport.scrollLeft,scrollY:viewport.scrollTop,deltaX:Math.abs(frame.left-picture.left-region.x/garden.width*picture.width),deltaY:Math.abs(frame.top-picture.top-region.y/garden.height*picture.height),deltaWidth:Math.abs(frame.width-region.width/garden.width*picture.width),deltaHeight:Math.abs(frame.height-region.height/garden.height*picture.height)}; // CHANGE
    })()`); // NEW
} // NEW
async function run() { // NEW
    const work = JSON.parse(fs.readFileSync(fixture, 'utf8')); // NEW
    assert.ok(work.gardens.some(garden => garden.regions.some(region => region.kind === 'planting-group')), 'Sample must contain a linked planting group.'); // NEW
    await app.whenReady(); const url = await serveWeb(); // NEW
    window = new BrowserWindow({ show: false, width: 412, height: 780, webPreferences: { backgroundThrottling: false } }); // NEW
    await window.loadURL(url); // NEW
    await until("!!globalThis.TrellisIdentityProtocol && document.querySelector('input[type=password]')", 'bundled app login'); // NEW
    await window.webContents.executeJavaScript(`(async()=>{ // NEW
        const p=TrellisIdentityProtocol,{openStore}=await import('/field-store.js'),db=await openStore(),signer=await p.keyPair(),identityId=crypto.randomUUID(),deviceId=crypto.randomUUID(),eventId=crypto.randomUUID(),key=crypto.getRandomValues(new Uint8Array(32)); // NEW
        const credential=await p.protectPassword(key,'preview-test-password',identityId+':'+eventId),event=await p.sign({schema:1,id:eventId,identityId,kind:'genesis',author:deviceId,parents:[],username:'Preview test',device:{id:deviceId,publicKey:signer.publicKey,name:'UI test',kind:'android'},credential,time:Date.now()},signer.privateKey); // NEW
        const account={identityId,deviceId,username:'Preview test',events:[event],genesisHash:await p.fingerprint(event),vault:await p.seal(signer.privateKey,key,identityId+':'+deviceId)};key.fill(0); // NEW
        const work=${JSON.stringify(work)},today=new Date(),day=today.getFullYear()+'-'+String(today.getMonth()+1).padStart(2,'0')+'-'+String(today.getDate()).padStart(2,'0'); // NEW
        work.tasks=work.tasks.slice(0,1).map(task=>({...task,progress:{state:'TODO',completedDay:null},plannedDay:day})); // NEW
        const workKey='work:'+identityId+':'+work.diagramId+':'+work.workerId; // NEW
        await db.put('account:'+identityId,account);await db.put('accounts',[identityId]);await db.put('selected-account',identityId);await db.put('work-index:'+identityId,[workKey]); // NEW
        await db.put(workKey,{work,display:work,pending:{schema:1,kind:'task-updates',diagramId:work.diagramId,workerId:work.workerId,operations:[]},queued:[]}); // NEW
    })()`); // NEW
    await window.reload(); // NEW
    await until("[...document.querySelectorAll('button')].some(b=>b.textContent==='Log in')", 'installed test identity'); // NEW
    await window.webContents.executeJavaScript("document.querySelector('input[type=password]').value='preview-test-password';[...document.querySelectorAll('button')].find(b=>b.textContent==='Log in').click();"); // NEW
    await until("[...document.querySelectorAll('button')].some(b=>b.textContent==='Show planting groups')", 'linked task'); // NEW
    await window.webContents.executeJavaScript(`(async()=>{const {openStore}=await import('/field-store.js'),db=await openStore(),id=await db.get('selected-account'),keys=await db.get('work-index:'+id);window.fieldTestWork=(await db.get(keys[0])).work;[...document.querySelectorAll('button')].find(b=>b.textContent==='Show planting groups').click();})()`); // NEW
    await until("document.querySelector('.map-layer img')?.complete && !!document.querySelector('.map-region.selected')", 'whole-garden image'); // NEW
    const checks = [await measure()]; fs.mkdirSync(output, { recursive: true }); fs.writeFileSync(path.join(output, 'whole-garden.png'), (await window.webContents.capturePage()).toPNG()); // CHANGE: retain the initial whole-garden view as well as the zoomed alignment evidence.
    assert.ok(checks[0].width <= checks[0].viewportWidth + 1, 'The initial view must fit the whole garden.'); // NEW
    await window.webContents.executeJavaScript("for(let i=0;i<5;i++)[...document.querySelectorAll('button')].find(b=>b.textContent==='Zoom in').click();const viewport=document.querySelector('.map-viewport');viewport.scrollLeft=120;viewport.scrollTop=80;"); // NEW
    checks.push(await measure()); // NEW
    for (const check of checks) { assert.equal(check.selected, 1); assert.ok(check.imageLoaded); assert.ok(Math.max(check.deltaX, check.deltaY, check.deltaWidth, check.deltaHeight) < 1, JSON.stringify(check)); } // NEW
    assert.ok(checks[1].width > checks[0].width && checks[1].scrollX > 0 && checks[1].scrollY > 0); // NEW
    await window.webContents.executeJavaScript('window.fieldTestMap=document.querySelector(".map-layer");'); // NEW
    await until("document.getElementById('status').textContent.startsWith('Offline.')", 'successful transport poll'); // NEW
    await new Promise(resolve => setTimeout(resolve, 11000)); // NEW
    assert.equal(await window.webContents.executeJavaScript('window.fieldTestMap===document.querySelector(".map-layer")'), true, 'An unchanged package poll must preserve pan and zoom.'); // NEW
    const retained = await measure(); assert.equal(retained.scrollX, checks[1].scrollX); assert.equal(retained.width, checks[1].width); // NEW
    fs.mkdirSync(output, { recursive: true }); fs.writeFileSync(path.join(output, 'garden.png'), (await window.webContents.capturePage()).toPNG()); // NEW
    await window.webContents.executeJavaScript(`document.getElementById('settings-tab').click();const wifi=document.querySelector('input[type=checkbox]');wifi.checked=true;wifi.dispatchEvent(new Event('change'));`); // NEW
    await until('fieldTestNetwork.waitingForWifi', 'Wi-Fi-only setting'); // NEW
    await window.webContents.executeJavaScript("[...document.querySelectorAll('button')].find(b=>b.textContent==='Sync now').click();"); // NEW
    await until("document.getElementById('status').textContent.startsWith('Waiting for Wi-Fi.')", 'blocked transport status'); // NEW
    await window.webContents.executeJavaScript(`document.getElementById('work-tab').click();const annotation=document.querySelector('article input');annotation.value='Wi-Fi queue test 🌱';annotation.dispatchEvent(new Event('change'));`); // NEW
    await until('fieldTestWrites.length===1', 'signed local outbox while waiting for Wi-Fi'); // NEW
    const queued = await window.webContents.executeJavaScript(`(async()=>{const {openStore}=await import('/field-store.js'),db=await openStore(),id=await db.get('selected-account'),key=(await db.get('work-index:'+id))[0],record=await db.get(key),signed=JSON.parse(fieldTestWrites[0].text);return{pending:record.pending.operations.length,queued:record.queued.length,note:record.display.tasks[0].annotation,signed:await TrellisIdentityProtocol.verify(signed,(await db.get('account:'+id)).events[0].payload.device.publicKey),path:fieldTestWrites[0].relative};})()`); // NEW
    assert.equal(queued.pending, 1); assert.equal(queued.queued, 1); assert.equal(queued.note, 'Wi-Fi queue test 🌱'); assert.equal(queued.signed, true); assert.match(queued.path, /\/updates\//); // NEW
    await window.webContents.executeJavaScript(`fieldTestNetwork.waitingForWifi=false;fieldTestNetwork.networkAvailable=true;document.getElementById('settings-tab').click();[...document.querySelectorAll('button')].find(b=>b.textContent==='Sync now').click();`); // NEW
    await until("document.getElementById('status').textContent.startsWith('Sync available.')", 'network recovery'); // NEW
    assert.equal(await window.webContents.executeJavaScript('fieldTestWrites.length'), 1, 'A queued operation cannot be signed repeatedly after network recovery.'); // NEW
    const pendingAfterRecovery = await window.webContents.executeJavaScript(`(async()=>{const {openStore}=await import('/field-store.js'),db=await openStore(),id=await db.get('selected-account'),key=(await db.get('work-index:'+id))[0];return(await db.get(key)).pending.operations.length;})()`); assert.equal(pendingAfterRecovery, 1, 'Network availability cannot acknowledge an operation.'); // NEW
    const result = { ok: true, bundledFieldUi: true, wholeGarden: true, onlyLinkedPlantingGroupSelected: true, checks, pollPreservedView: true, wifiBlockedCachedEditing: true, signedOutboxPreserved: true, networkRecoveryIsNotAcknowledgment: true }; // CHANGE
    fs.writeFileSync(path.join(output, 'checks.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result)); // NEW
} // NEW
run().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { clearTimeout(timeout); server?.close(); window?.destroy(); app.quit(); }); // NEW
