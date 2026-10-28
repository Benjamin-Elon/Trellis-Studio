/** Native graph guards and signed publication share the same policy; the browser/profile are test-owned. */ // NEW
const { app, BrowserWindow, ipcMain } = require('electron'); // NEW
const fs = require('node:fs/promises'), sync = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto'); // NEW
const { pathToFileURL } = require('node:url'), assert = require('node:assert/strict'); // NEW
const project = path.resolve(__dirname, '../..'), webapp = path.join(project, 'drawio/src/main/webapp'), directory = sync.mkdtempSync(path.join(os.tmpdir(), 'trellis-permissions-native-')); // NEW
app.setPath('userData', path.join(directory, 'browser')); app.disableHardwareAcceleration(); app.commandLine.appendSwitch('in-process-gpu'); // NEW
let window; // NEW
const evaluate = source => window.webContents.executeJavaScript(source, true); // NEW
app.whenReady().then(async () => { // NEW
    try { // NEW
        window = new BrowserWindow({ show: false, width: 1000, height: 750, webPreferences: { nodeIntegration: true, contextIsolation: false, sandbox: false } }); // NEW
        await window.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<!doctype html><body><div id="graph" style="width:950px;height:700px"></div></body>')); // NEW
        await evaluate('window.mxLoadResources=false;window.mxLoadStylesheets=false;window.urlParams={grid:"0"};window.DOM_PURIFY_CONFIG={};window.Editor=function(){};window.EditorUi=function(){};void 0;'); // NEW
        for (const filename of ['mxgraph/mxClient.js', 'js/sanitizer/purify.min.js', 'js/grapheditor/Graph.js', 'js/trellis-permission-core.js']) await evaluate(await fs.readFile(path.join(webapp, filename), 'utf8') + '\n;void 0;'); // NEW
        await evaluate(` // NEW
            window.graph=new Graph(document.getElementById('graph'));graph.isSpecialColor=()=>-1;
            window.undo=new mxUndoManager();graph.model.addListener(mxEvent.UNDO,(_s,e)=>undo.undoableEditHappened(e.getProperty('edit')));
            window.ui={editor:{graph,undoManager:undo,addListener(){},setStatus(){}},actions:{get:()=>null,addAction:()=>({})},hideDialog(){}};
            window.Draw={loadPlugin:fn=>fn(ui)};
            function make(id,parent,attrs){const value=mxUtils.createXmlDocument().createElement('object');Object.entries(attrs).forEach(([key,val])=>value.setAttribute(key,val));return graph.insertVertex(parent,id,value,10,10,100,80,'');}
            window.garden=make('garden',graph.getDefaultParent(),{garden_module:'1',label:'Garden'});
            window.own=make('own',garden,{tiler_group:'1',label:'Own'});window.foreign=make('foreign',garden,{tiler_group:'1',label:'Foreign'});
            window.xml=()=>mxUtils.getXml(new mxCodec().encode(graph.model));
            void 0;
        `); // NEW
        await evaluate(await fs.readFile(path.join(webapp, 'plugins/garden_planner_plugins/Trellis_Users.js'), 'utf8') + '\n;void 0;'); // NEW
        const identity = await evaluate(`(()=>{window.users=Trellis.users;const owner=users.enableUsers('Alice','1111').user,bob=users.createUser('Bob','2222',false).user;users.setOwner(garden,owner.id);users.setOwner(own,bob.id);users.setOwner(foreign,owner.id);users.setScopeGrant(garden,{userId:bob.id,preset:'gardener'});const diagramId=users.getDiagramKey({create:true});users.logout();users.login('Bob','2222');return {owner:owner.id,bob:bob.id,diagramId,xml:xml()};})()`); // NEW
        const { createCollaborationStore } = await import(pathToFileURL(path.join(project, 'src/main/trellis-collaboration-store.js'))); // NEW
        const { inspectDiagram } = await import(pathToFileURL(path.join(project, 'src/main/trellis-share-protocol.js'))); // NEW
        const pair = crypto.generateKeyPairSync('ed25519'), keys = { publicKey: pair.publicKey.export({ type: 'spki', format: 'pem' }), privateKey: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }) }; // NEW
        const canvas = { shareId: 'permissions', diagramId: identity.diagramId, folderPath: path.join(directory, 'project'), diagramPath: path.join(directory, 'project/Garden.drawio'), coordinatorDeviceId: 'device', coordinatorPublicKey: keys.publicKey, members: [{ deviceId: 'device', userId: identity.bob, publicKey: keys.publicKey }] }; // NEW
        const writeAtomic = async (filename, text) => { await fs.mkdir(path.dirname(filename), { recursive: true }); await fs.writeFile(filename, text); }; // NEW
        const journal = createCollaborationStore({ canvas, deviceId: 'device', keys, profile: path.join(directory, 'profile'), writeAtomic, writeImmutable: async (filename, value) => writeAtomic(filename, JSON.stringify(value)) }); // NEW
        await journal.initialize(identity.xml); // NEW
        ipcMain.handle('permissions-test-proposal', (_event, input) => journal.action(1, identity.bob, input)); // NEW
        const guarded = await evaluate(`(()=>{const before=xml(),value=foreign.value.cloneNode(true);value.setAttribute('label','Forbidden native edit');graph.model.setValue(foreign,value);return {same:xml()===before,label:foreign.getAttribute('label')};})()`); // NEW
        assert.deepEqual(guarded, { same: true, label: 'Foreign' }); // NEW
        const internal = await evaluate(`(()=>{const before=xml(),value=foreign.value.cloneNode(true);value.setAttribute('trellis_owner_user_id',users.getCurrentUser().id);value.setAttribute('label','Forged internal edit');graph.__trellisUsersInternalChange=true;try{graph.model.setValue(foreign,value);}finally{graph.__trellisUsersInternalChange=false;}return xml()===before;})()`); // NEW
        assert.equal(internal, true, 'An internal-change flag cannot grant authority.'); // NEW
        const nested = await evaluate(`(()=>{const before=xml(),value=foreign.value.cloneNode(true),note=value.ownerDocument.createElement('note');note.appendChild(value.ownerDocument.createTextNode('Forged nested value'));value.appendChild(note);graph.__trellisUsersInternalChange=true;try{graph.model.setValue(foreign,value);}finally{graph.__trellisUsersInternalChange=false;}return xml()===before;})()`); // NEW
        assert.equal(nested, true, 'XML children cannot bypass authorization with unchanged attributes.'); // NEW
        await evaluate(`const value=own.value.cloneNode(true);value.setAttribute('label','Allowed native edit');graph.model.setValue(own,value);void 0;`); // NEW
        const draft = await evaluate('xml()'), saved = await journal.action(1, identity.bob, { kind: 'save', baseXml: identity.xml, xml: draft }); assert.equal(saved.ok, true, saved.reason); // NEW
        const accepted = (await journal.read()).xml, forged = accepted.replace('label="Foreign"', 'label="Forged publication"'); // NEW
        await evaluate('window.proposal=' + JSON.stringify({ kind: 'save', baseXml: accepted, xml: forged }) + ';void 0;'); // NEW
        const denied = await evaluate('require("electron").ipcRenderer.invoke("permissions-test-proposal",proposal)'); // NEW
        assert.equal(denied.code, 'PERMISSION_DENIED'); assert.equal(await fs.readFile(denied.recoveryPath, 'utf8'), forged); assert.equal((await journal.read()).xml, accepted); // NEW
        const review = await journal.action(1, identity.bob, { kind: 'draft-review', baseXml: accepted, xml: forged }); // NEW
        const resolution = await journal.action(1, identity.bob, { kind: 'draft-resolve', baseXml: accepted, xml: forged, token: review.review.token, mode: 'mine' }); // NEW
        assert.equal(resolution.code, 'PERMISSION_DENIED'); assert.equal((await journal.read()).xml, accepted); // NEW
        const state = inspectDiagram(accepted), garden = state.cells.find(cell => cell.id === 'garden'); garden.node.setAttribute('trellis_access_grants_json', JSON.stringify([{ userId: identity.bob, preset: 'visitor', capabilities: [] }])); // NEW
        const revoked = await journal.action(2, identity.owner, { kind: 'save', baseXml: accepted, xml: state.document.serialize() }); assert.equal(revoked.ok, true, revoked.reason); // NEW
        const policy = revoked.collaboration.policy; // NEW
        await evaluate('graph.__trellisSharedPolicy={...'+JSON.stringify(policy)+',diagramId:'+JSON.stringify(identity.diagramId)+',cells:new Map('+JSON.stringify(policy.cells)+'.map(cell=>[cell.key,cell]))};void 0;'); // NEW
        assert.equal(await evaluate('users.canCreatePlanting(garden)'), false); // NEW
        assert.match(await evaluate('garden.getAttribute("trellis_access_grants_json")'), /gardener/, 'The displayed object remains stale while authority advances.'); // NEW
        const beforeCreation = await evaluate('xml()'); await evaluate("make('revoked-new',garden,{tiler_group:'1',label:'Revoked creation'});void 0;"); assert.equal(await evaluate('xml()'), beforeCreation); // NEW
        console.log(JSON.stringify({ ok: true, nativeGuards: true, internalFlagRejected: true, signedPublicationRejected: true, draftRetained: true, resolutionRejected: true, staleViewRevocation: true })); // NEW
        ipcMain.removeHandler('permissions-test-proposal'); window.destroy(); await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => {}); app.exit(0); // NEW
    } catch (error) { console.error(error.stack || error); window?.destroy(); app.exit(1); } // NEW
}); // NEW
