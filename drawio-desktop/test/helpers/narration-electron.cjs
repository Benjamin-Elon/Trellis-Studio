/** Exercise actual local scripts/audio and oath completion with all HTTP(S) requests blocked. */ // NEW
const assert = require('node:assert/strict'); // NEW
const fs = require('node:fs'); // NEW
const os = require('node:os'); // NEW
const path = require('node:path'); // NEW
const { pathToFileURL } = require('node:url'); // NEW
const asar = require('@electron/asar'); // NEW
const { app, BrowserWindow, session } = require('electron'); // NEW
const project = path.resolve(__dirname, '../..'), webapp = path.join(project, 'drawio/src/main/webapp'); // NEW
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'trellis-narration-native-'))); // NEW
app.disableHardwareAcceleration(); app.commandLine.appendSwitch('in-process-gpu'); // NEW
app.whenReady().then(async () => { // NEW
    const remote = []; // NEW
    session.defaultSession.webRequest.onBeforeRequest((details, respond) => { const blocked = /^https?:/i.test(details.url); if (blocked) remote.push(details.url); respond({ cancel: blocked }); }); // NEW
    const win = new BrowserWindow({ show: false, webPreferences: { sandbox: false, backgroundThrottling: false } }); // NEW
    const run = code => win.webContents.executeJavaScript(code, true); // NEW
    try { // NEW
        const output = path.join(project, '.test-artifacts'); fs.mkdirSync(output, { recursive: true }); // NEW
        const host = path.join(output, 'narration-native-host.html'); // NEW
        const scripts = ['js/trellis-narration-catalog.js', 'audio/narration/manifest.js', 'js/trellis-narration.js'].map(name => '<script src="' + pathToFileURL(path.join(webapp, name)).href + '"></script>').join(''); // NEW
        fs.writeFileSync(host, '<!doctype html><body><section id="owner"></section>' + scripts + '</body>'); // NEW
        await win.loadFile(host); // NEW
        await run("window.mediaEvents=[];window.fallbacks=0;window.NativeAudio=window.Audio;window.Audio=function(src){const a=new NativeAudio(src);a.addEventListener('playing',()=>mediaEvents.push({event:'playing',src,duration:a.duration}));a.addEventListener('ended',()=>mediaEvents.push({event:'ended',src}));return a;};speechSynthesis.speak=()=>{fallbacks++;throw new Error('Unexpected system fallback')};void 0"); // NEW
        const played = []; // NEW
        for (const id of ['settings-name', 'confirmThePlanningYearThenUseAdd', 'oath']) { // NEW
            const result = await run("new Promise(resolve=>{const started=performance.now(),timer=setTimeout(()=>resolve({ok:false,error:'Native playback timed out'}),45000);TrellisNarration.play({owner:document.getElementById('owner'),text:TrellisNarrationCatalog.text(" + JSON.stringify(id) + "),onEnd:()=>{clearTimeout(timer);resolve({ok:true,elapsed:performance.now()-started})},onError:error=>{clearTimeout(timer);resolve({ok:false,error:error.message})}})})"); // NEW
            assert.equal(result.ok, true, id + ': ' + JSON.stringify(result)); played.push({ id, ...result }); // NEW
        } // NEW
        const events = await run('({events:mediaEvents,fallbacks})'); // NEW
        assert.equal(events.fallbacks, 0); assert.equal(events.events.filter(event => event.event === 'ended').length, 3); assert.deepEqual(remote, []); // NEW
        const shortFile = await run("TrellisNarrationRecordings.clips.find(clip=>clip.text===TrellisNarrationCatalog.text('settings-name')).file"); // NEW
        const staging = fs.mkdtempSync(path.join(output, 'narration-asar-')); // NEW
        for (const name of ['js/trellis-narration-catalog.js', 'js/trellis-narration.js', 'audio/narration/manifest.js', 'audio/narration/' + shortFile]) { // NEW
            const destination = path.join(staging, name); fs.mkdirSync(path.dirname(destination), { recursive: true }); fs.copyFileSync(path.join(webapp, name), destination); // NEW
        } // NEW
        fs.writeFileSync(path.join(staging, 'index.html'), '<!doctype html><body><section id="owner"></section><script src="js/trellis-narration-catalog.js"></script><script src="audio/narration/manifest.js"></script><script src="js/trellis-narration.js"></script></body>'); // NEW
        const archive = path.join(output, 'narration-fixture.asar'); await asar.createPackage(staging, archive); // NEW
        await win.loadFile(path.join(archive, 'index.html')); // NEW
        const packaged = await run("new Promise(resolve=>{const timer=setTimeout(()=>resolve(false),15000);speechSynthesis.speak=()=>resolve(false);TrellisNarration.play({owner:document.getElementById('owner'),text:TrellisNarrationCatalog.text('settings-name'),onEnd:()=>{clearTimeout(timer);resolve(true)},onError:()=>{clearTimeout(timer);resolve(false)}})})"); // NEW
        assert.equal(packaged, true, 'ASAR-local narration must play without speech fallback'); assert.deepEqual(remote, []); // NEW
        fs.writeFileSync(path.join(output, 'narration-electron.json'), JSON.stringify({ played, ...events, packaged, blockedNetworkRequests: remote }, null, 2)); // NEW
        console.log('Offline narration checks passed: ' + JSON.stringify(played)); // NEW
    } finally { win.destroy(); } // NEW
    app.quit(); // NEW
}).catch(error => { console.error(error.stack || error); app.exit(1); }); // NEW
