/** Execute the actual renderer close preparation rather than reproducing its decisions. */ // NEW
const test = require('node:test'); // NEW
const assert = require('node:assert/strict'); // NEW
const fs = require('node:fs'); // NEW
const path = require('node:path'); // NEW
const vm = require('node:vm'); // NEW
const parser = require('@babel/parser'); // NEW
const traverse = require('@babel/traverse').default; // NEW
const root = path.resolve(__dirname, '..'); // NEW

function productionFunction(filename, name, context) { // NEW
    const source = fs.readFileSync(path.join(root, filename), 'utf8'); // NEW
    const ast = parser.parse(source, { sourceType: 'unambiguous' }); let selected; // NEW
    traverse(ast, { noScope: true, FunctionDeclaration(entry) { if (entry.node.id?.name === name) selected = entry.node; } }); // NEW
    assert.ok(selected, name); return vm.runInNewContext('(' + source.slice(selected.start, selected.end) + ')', context); // NEW
} // NEW
function fixture() { // NEW
    const listeners = new Map(), replies = [], deletes = [], inputs = new Map(); // NEW
    let xml = '<graph/>', current, failure = null, fileExists = true, retainDraft = false; // CHANGE
    const win = { addEventListener: (type, callback) => inputs.set(type, callback), removeEventListener: type => inputs.delete(type) }; // NEW
    const file = { fileObject: { draftFileName: '/isolated/draft.drawio' }, modified: true, isModified() { return this.modified; }, saveDraft() {}, removeDraft: async () => {} }; current = file; // NEW
    const ui = { getCurrentFile: () => current, getXmlFileData: () => xml, editor: { graph: { isEditing: () => false } }, removeDatabaseItem: (_key, resolve, reject) => failure ? reject(failure) : resolve(), handleFileChange() {} }; // NEW
    const install = productionFunction('drawio/src/main/webapp/js/diagramly/ElectronApp.js', 'installTrellisClosePreparation', { // NEW
        window: win, document: { createElement: () => ({ style: {}, remove() {} }), body: { appendChild() {} } }, // NEW
        electron: { registerMsgListener: (name, callback) => listeners.set(name, callback), sendMessage: (_name, reply) => replies.push(reply) }, // NEW
        mxUtils: { getXml: node => node }, EditorUi: { enableDrafts: true }, requestSync: async input => { if (failure) throw failure; if (input.action === 'checkFileExists') return fileExists; deletes.push(input.file); if (!retainDraft) fileExists = false; } // CHANGE
    }); install(ui); // NEW
    return { file, win, inputs, deletes, ui, replies, setXml: value => { xml = value; }, setFile: value => { current = value; }, fail: value => { failure = value; }, retainDraft: () => { retainDraft = true; }, // CHANGE
        async request(phase, snapshotId) { await listeners.get('isModified')({ phase, snapshotId, uniqueId: String(replies.length) }); return replies.at(-1); } }; // NEW
} // NEW
/** Run the desktop save methods themselves so native cancellation cannot leave navigation pending. */ // NEW
function desktopSaveFixture(editable = true) { // NEW
    const source = fs.readFileSync(path.join(root, 'drawio/src/main/webapp/js/diagramly/ElectronApp.js'), 'utf8'), methods = new Map(); // NEW
    traverse(parser.parse(source), { noScope: true, AssignmentExpression(entry) { if (/^LocalFile\.prototype\.(save|saveFile|saveAs)$/.test(source.slice(entry.node.left.start, entry.node.left.end))) methods.set(entry.node.left.property.name, source.slice(entry.node.right.start, entry.node.right.end)); } }); // NEW
    const events = [], writes = [], storage = new Map(), pendingWrites = []; let destination = null, failure = null, deferWrites = false; // CHANGE
    function LocalFile() {} // NEW
    const context = { LocalFile, LocalLibrary: function() {}, DrawioFile: { prototype: { save(_revision, success) { this.data = '<mxfile><diagram>one</diagram><diagram>two</diagram></mxfile>'; success(); } } }, autoSaveEnabled: false, EditorUi: { enableDrafts: true }, // NEW
        mxUtils: { bind: (scope, callback) => callback.bind(scope) }, localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) }, // NEW
        requestSync: async input => input === 'getDocumentsFolder' ? '/documents' : input.action === 'showSaveDialog' ? destination : '/documents', // NEW
        electron: { request(input, success, error) { writes.push(input); const complete = () => failure ? error('permission', failure) : success({ mtimeMs: writes.length }); if (deferWrites) pendingWrites.push(complete); else complete(); } } }; // CHANGE
    for (const [name, method] of methods) LocalFile.prototype[name] = vm.runInNewContext('(' + method + ')', context); // NEW
    const file = new LocalFile(); Object.assign(file, { title: 'Untitled.drawio', modified: true, editable, draft: 'recovery', isEditable() { return this.editable; }, setEditable(value) { this.editable = value; }, getTitle() { return this.title; }, getData() { return this.data; }, // NEW
        setShadowModified() {}, getShadowModified: () => false, setModified(value) { this.modified = value; }, fileSaved(_data, _stat, success) { success(); }, contentChanged() {}, addToRecent() {}, removeDraft() { this.draft = null; }, // NEW
        ui: { normalizeFilename: value => value, createFileSystemFilters: () => [], spinner: { stop() { events.push('stop'); } }, editor: { setAutosave() {} }, watchFile() {} } }); // NEW
    return { file, events, writes, deferWrites: () => { deferWrites = true; }, completeWrite: () => pendingWrites.shift()(), destination: value => { destination = value; }, fail: value => { failure = value; }, save: () => { file.save(false, () => events.push('saved'), error => events.push(error), null, null, () => events.push('canceled')); return new Promise(resolve => setImmediate(resolve)); } }; // CHANGE
} // NEW
test('native first-save and read-only Save As cancellation complete quietly and retain recovery', async () => { // NEW
    for (const editable of [true, false]) { // NEW
        const f = desktopSaveFixture(editable); await f.save(); // NEW
        assert.equal(f.events.includes('canceled'), true); assert.equal(f.events.includes('saved'), false); assert.equal(f.writes.length, 0); assert.equal(f.file.modified, true); assert.equal(f.file.draft, 'recovery'); // NEW
        f.destination('/documents/Garden.drawio'); await f.save(); // NEW
        assert.equal(f.events.filter(event => event === 'saved').length, 1); assert.equal(f.writes.length, 1); assert.match(f.writes[0].data, /<diagram>one<\/diagram><diagram>two<\/diagram>/); assert.equal(f.file.modified, false); // NEW
    } // NEW
}); // NEW

test('native autosave without an optional success callback completes without throwing', async () => { // CHANGE
    const f = desktopSaveFixture(); f.file.fileObject = { path: '/documents/Autosave.drawio', name: 'Autosave.drawio' }; // CHANGE
    f.file.save(false, null, error => assert.fail(error.stack)); await new Promise(resolve => setImmediate(resolve)); // CHANGE
    assert.equal(f.writes.length, 1); assert.equal(f.file.modified, false); // CHANGE
}); // CHANGE

test('overlapping local saves both complete in order instead of dropping the second callback', async () => { // CHANGE
    const f = desktopSaveFixture(), completed = []; f.file.fileObject = { path: '/documents/Autosave.drawio', name: 'Autosave.drawio' }; f.deferWrites(); // CHANGE
    f.file.save(false, () => completed.push('autosave'), error => assert.fail(error.stack)); // CHANGE
    f.file.save(false, () => completed.push('explicit'), error => assert.fail(error.stack)); assert.equal(f.writes.length, 1); // CHANGE
    f.completeWrite(); await new Promise(resolve => setImmediate(resolve)); assert.deepEqual(completed, ['autosave']); assert.equal(f.writes.length, 2); // CHANGE
    f.completeWrite(); await new Promise(resolve => setImmediate(resolve)); assert.deepEqual(completed, ['autosave', 'explicit']); assert.equal(f.file.__trellisLocalSavePending, null); // CHANGE
}); // CHANGE

test('a queued local save cannot capture a replacement diagram into the previous file', async () => { // CHANGE
    const f = desktopSaveFixture(); f.file.fileObject = { path: '/documents/Autosave.drawio', name: 'Autosave.drawio' }; f.deferWrites(); let rejected; // CHANGE
    f.file.save(false, () => {}, error => assert.fail(error.stack)); f.file.save(false, () => assert.fail('Replaced diagram was saved'), error => { rejected = error; }); // CHANGE
    f.file.ui.getCurrentFile = () => ({}); f.completeWrite(); await new Promise(resolve => setImmediate(resolve)); // CHANGE
    assert.match(rejected.message, /diagram changed/); assert.equal(f.writes.length, 1); // CHANGE
}); // CHANGE
test('desktop save failure retains the draft and existing callers need no cancellation callback', async () => { // NEW
    const f = desktopSaveFixture(), denied = new Error('Permission denied'); f.destination('/documents/Garden.drawio'); f.fail(denied); await f.save(); // NEW
    assert.equal(f.events.includes(denied), true); assert.equal(f.events.includes('saved'), false); assert.equal(f.file.draft, 'recovery'); assert.equal(f.file.modified, true); // NEW
    const legacy = desktopSaveFixture(); legacy.file.save(false, () => assert.fail('Canceled save succeeded'), () => assert.fail('Canceled save failed')); // NEW
    await new Promise(resolve => setImmediate(resolve)); assert.equal(legacy.writes.length, 0); // NEW
}); // NEW
test('source and packaged file closure release every page, tab, graph, and undo reference', () => { // NEW
    for (const filename of ['diagramly/EditorUi.js', 'app.min.js', 'integrate.min.js']) { // NEW
        const source = fs.readFileSync(path.join(root, 'drawio/src/main/webapp/js', filename), 'utf8'), bundled = filename.endsWith('.min.js'); // NEW
        const start = source.indexOf(bundled ? 'EditorUi.prototype.fileLoaded=function(' : 'EditorUi.prototype.fileLoaded = function('), end = source.indexOf('EditorUi.prototype.getHashValueForPages', start); // NEW
        assert.ok(start >= 0 && end > start); const events = []; let current = { removeListener() {}, close() { events.push('close'); } }; // NEW
        function EditorUi() {} EditorUi.debug = () => {}; // NEW
        vm.runInNewContext(source.slice(start, end), { EditorUi, mxUtils: { bind: (scope, callback) => callback.bind(scope) } }); // NEW
        const ui = new EditorUi(); Object.assign(ui, { currentPage: {}, pages: [{}, {}], fileNode: {}, tabContainer: { textContent: 'Old page tabs' }, // NEW
            getCurrentFile: () => current, setCurrentFile: value => { current = value; }, hideDialog() {}, logIfModified() {}, setGraphEnabled() {}, updateDocumentTitle() {}, setBackgroundImage() {}, clearStatus() {}, updateUi() {}, // NEW
            editor: { graph: { model: { clear() { events.push('graph'); } } }, undoManager: { clear() { events.push('undo'); } } } }); // NEW
        ui.fileLoaded(null, true); assert.equal(current, null); assert.equal(ui.currentPage, null); assert.equal(ui.pages, null); assert.equal(ui.fileNode, null); assert.equal(ui.tabContainer.textContent, ''); assert.equal(events[0], 'close'); assert.ok(events.includes('graph')); assert.ok(events.includes('undo')); // NEW
    } // NEW
}); // NEW
test('approved snapshot stays local, seals input, and defers draft removal until discard', async () => { // NEW
    const f = fixture(), originalWriter = f.file.saveDraft; // NEW
    const approval = await f.request('prepare'); assert.equal(approval.isModified, true); assert.ok(approval.snapshotId); // NEW
    assert.equal(Object.hasOwn(approval, 'xml'), false); assert.equal(f.deletes.length, 0); // NEW
    assert.equal((await f.request('seal', approval.snapshotId)).snapshotValid, true); // NEW
    assert.equal(f.win.__trellisClosing, true); assert.equal(f.inputs.size, 5); assert.notEqual(f.file.saveDraft, originalWriter); // NEW
    await f.request('discard', approval.snapshotId); assert.deepEqual(f.deletes, ['/isolated/draft.drawio']); // NEW
}); // NEW
test('Cancel restores input and the draft writer without deleting a draft', async () => { // NEW
    const f = fixture(), writer = f.file.saveDraft, approval = await f.request('prepare'); // NEW
    await f.request('seal', approval.snapshotId); await f.request('cancel'); // NEW
    assert.equal(f.win.__trellisClosing, false); assert.equal(f.inputs.size, 0); assert.equal(f.file.saveDraft, writer); assert.equal(f.deletes.length, 0); // NEW
}); // NEW
test('edits, replacement documents, and saves invalidate an approved snapshot', async () => { // NEW
    for (const mutation of [f => f.setXml('<changed/>'), f => f.setFile({ ...f.file }), f => { f.file.savingFile = true; }, f => { f.file.modified = false; }]) { // NEW
        const f = fixture(), approval = await f.request('prepare'); mutation(f); // NEW
        assert.equal((await f.request('seal', approval.snapshotId)).snapshotValid, false); // NEW
        await f.request('discard', approval.snapshotId); assert.equal(f.deletes.length, 0); // NEW
    } // NEW
}); // NEW
test('discard failure is returned with correlation rather than claiming success', async () => { // NEW
    const f = fixture(), approval = await f.request('prepare'); f.fail(new Error('Disk unavailable')); // NEW
    const reply = await f.request('discard', approval.snapshotId); assert.equal(reply.error, 'Disk unavailable'); assert.ok(reply.uniqueId); // NEW
}); // NEW
test('a deletion safety guard that retains the draft is reported as failed removal', async () => { // NEW
    const f = fixture(), approval = await f.request('prepare'); f.retainDraft(); // NEW
    assert.match((await f.request('discard', approval.snapshotId)).error, /filesystem safety check/); assert.equal(f.file.modified, true); // NEW
}); // NEW
test('IndexedDB draft removal waits for transaction completion and preserves IDs on failure', async () => { // NEW
    const f = fixture(); f.file.fileObject = null; f.file.draftId = 'sample'; // NEW
    const approval = await f.request('prepare'); f.fail(new Error('Transaction aborted')); // NEW
    assert.match((await f.request('discard', approval.snapshotId)).error, /aborted/); assert.equal(f.file.draftId, 'sample'); // NEW
    f.fail(null); await f.request('discard', approval.snapshotId); assert.equal(f.file.draftId, null); assert.equal(f.file.usedDraftId, 'sample'); // NEW
}); // NEW
test('clean and empty startup documents complete without draft deletion', async () => { // NEW
    for (const empty of [false, true]) { // NEW
        const f = fixture(); f.file.modified = false; if (empty) f.setFile(null); // NEW
        const approval = await f.request('prepare'); assert.equal(approval.isModified, false); // NEW
        assert.equal((await f.request('seal', approval.snapshotId)).snapshotValid, true); // NEW
        await f.request('discard', approval.snapshotId); assert.equal(f.deletes.length, 0); // NEW
    } // NEW
}); // NEW
test('preload fallback correlates startup preparation and stops matching once editor listeners exist', () => { // NEW
    const callbacks = new Map(), replies = [], msgListeners = {}; // NEW
    const ensure = productionFunction('src/main/electron-preload.js', 'ensureMsgListener', { msgListeners, ipcRenderer: { on: (name, callback) => callbacks.set(name, callback), send: (_name, value) => replies.push(value) } }); // NEW
    ensure('isModified'); const receive = callbacks.get('isModified'); // NEW
    receive({}, { phase: 'prepare', uniqueId: 'p' }); assert.equal(replies[0].uniqueId, 'p'); // NEW
    receive({}, { phase: 'seal', uniqueId: 's', snapshotId: replies[0].snapshotId }); assert.equal(replies[1].snapshotValid, true); // NEW
    receive({}, { phase: 'cancel' }); assert.equal(replies.length, 2); // NEW
    let delivered; msgListeners.isModified.push(payload => { delivered = payload; }); // NEW
    receive({}, { phase: 'seal', uniqueId: 'next' }); assert.equal(delivered.uniqueId, 'next'); assert.equal(replies.length, 2); // NEW
}); // NEW

function trayFixture(createSharingTray) { // NEW
    const context = { lifecycle: { acceptsWork: true }, sharingTray: null, sharingTrayCreation: null, backgroundFailureShown: false, // NEW
        hasConfiguredSync: () => true, createSharingTray, sharingGroup: {}, app: {}, Tray: {}, menu: {}, nativeImage: {}, store: {}, path, codeDir: root, // NEW
        createWindow: () => null, bindWindowLoad() {}, log: { error() {} }, quitWithoutTray: async () => { context.quits++; }, quits: 0 }; // NEW
    return { context, ensure: productionFunction('src/main/electron.js', 'ensureSharingTray', context) }; // NEW
} // NEW
test('failed native tray creation requests the agreed explanatory quit once per attempt', async () => { // NEW
    let attempts = 0; const f = trayFixture(async () => { attempts++; throw new Error('No tray'); }); // NEW
    await Promise.all([f.ensure(), f.ensure()]); assert.equal(attempts, 1); assert.equal(f.context.quits, 1); assert.equal(f.context.sharingTray, null); // NEW
}); // NEW
test('delayed tray creation is disposed when committed shutdown overtakes it', async () => { // NEW
    let ready, disposed = false; const f = trayFixture(() => new Promise(resolve => { ready = resolve; })); // NEW
    const pending = f.ensure(); f.context.lifecycle.acceptsWork = false; ready({ dispose() { disposed = true; } }); await pending; // NEW
    assert.equal(disposed, true); assert.equal(f.context.sharingTray, null); // NEW
}); // NEW

test('sender validation rejects absent and destroyed frames without reading invalid URLs', () => { // NEW
    const validate = productionFunction('src/main/electron.js', 'validateSender', { codeUrl: 'file:///C:/application' }); // NEW
    assert.equal(validate(null), false); assert.equal(validate({ isDestroyed: () => true, get url() { throw new Error('disposed'); } }), false); // NEW
    assert.equal(validate({ get url() { throw new Error('disposed'); } }), false); // NEW
    assert.equal(validate({ url: 'file:///C:/application/index.html' }), true); assert.equal(validate({ url: 'https://untrusted.test' }), false); // NEW
}); // NEW
test('late IPC results never reply to destroyed or replaced renderer frames', () => { // NEW
    const sent = [], warnings = []; // NEW
    const reply = productionFunction('src/main/electron.js', 'replyToLiveFrame', { validateSender: frame => frame?.trusted === true, log: { warn: (_message, reason) => warnings.push(reason) } }); // NEW
    const event = { sender: { isDestroyed: () => false }, senderFrame: { trusted: true }, reply: (...value) => sent.push(value) }; // NEW
    reply(event, 'mainResp', { ok: true }); assert.equal(sent.length, 1); // NEW
    event.senderFrame = null; reply(event, 'mainResp', {}); assert.equal(sent.length, 1); // NEW
    event.senderFrame = { trusted: true }; event.sender.isDestroyed = () => true; reply(event, 'mainResp', {}); assert.equal(sent.length, 1); // NEW
    event.sender.isDestroyed = () => false; event.reply = () => { throw new Error('Disposed while replying'); }; reply(event, 'mainResp', {}); assert.equal(warnings.length, 1); // NEW
    assert.throws(() => reply({ reply() { throw new Error('CLI export failure'); } }, 'export-error', {}), /CLI export failure/); // NEW: custom main-owned export events preserve their existing failure handling.
}); // NEW

test('Resume All skips retired shares while resuming active shares and the identity catalog', async () => { // NEW
    const configured = [], registry = [{ shareId: 'live', paused: true }, { shareId: 'retired', revoked: true, paused: true }, { shareId: 'removed', localRemoved: true, paused: true }]; // NEW
    const identitySync = { paused: true }; // NEW
    const pause = productionFunction('src/main/trellis-syncthing-service.js', 'setPaused', { // NEW
        registry, identitySync, initialize: async () => {}, start: async () => {}, configureCanvas: async canvas => configured.push(canvas.shareId), // CHANGE: production pause now initializes its registry before validating a target.
        persist: async () => {}, emit() {}, writeAtomic: async () => {}, configureMetadataFolder: async () => configured.push('metadata'), // NEW
        metadataChannels: { pause: async paused => { assert.equal(paused, false); configured.push('community metadata'); } }, // NEW
        canvasById: id => registry.find(canvas => canvas.shareId === id), path, profile: '/isolated' // NEW
    }); // NEW
    await pause({ paused: false }); assert.deepEqual(configured, ['live', 'metadata', 'community metadata']); assert.equal(identitySync.paused, false); // CHANGE
    await assert.rejects(pause({ shareId: 'retired', paused: false }), /removed/); // NEW
}); // NEW

test('window actions use their live sender even when no native window has focus', () => { // NEW
    const calls = []; const action = productionFunction('src/main/electron.js', 'windowAction', { BrowserWindow: { getFocusedWindow: () => null } }); // NEW
    const sender = { isDestroyed: () => false, minimize: () => calls.push('sender'), isMaximized: () => true }; // NEW
    action('minimize', sender); assert.deepEqual(calls, ['sender']); assert.equal(action('isMaximized', sender), true); // NEW
    sender.isDestroyed = () => true; action('minimize', sender); action('minimize'); assert.equal(calls.length, 1); // NEW
}); // NEW
