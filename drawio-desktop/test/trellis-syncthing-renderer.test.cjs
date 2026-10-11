// NEW: Exercise the production renderer orchestration with realistic asynchronous boundaries.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const { JSDOM } = require('jsdom');

const plugin = path.join(__dirname, '../drawio/src/main/webapp/plugins/garden_planner_plugins/Trellis_Syncthing.js');
const settle = async () => { for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve)); };

function harness(t, options = {}) {
    const dom = new JSDOM('<!doctype html><body><div id="graph"></div></body>', { url: 'https://trellis.test' });
    t.after(() => dom.window.close());
    const { window } = dom;
    Object.defineProperty(window, 'crypto', { value: webcrypto });
    const calls = [];
    const actions = new Map();
    const editorListeners = new Map();
    let xml = '<mxGraphModel><root/></mxGraphModel>';
    let read = async () => ({ data: 'remote XML' });
    let statusListener;
    let originalSaves = 0;
    const current = {
        data: 'old XML', fileObject: options.unsaved ? null : { path: 'C:/shared/Canvas.drawio', name: 'Canvas.drawio' }, modified: false, stat: { mtimeMs: 1 },
        getTitle: () => 'Canvas.drawio', getData() { return this.data; }, isModified() { return this.modified; }, setModified(value) { this.modified = value; }, clearAutosave() { calls.push({ clearAutosave: true }); },
        fileSaved(saved, descriptor, success) { success(); },
        save(revision, success, error) { originalSaves++; this.data = xml; this.modified = false; this.fileSaved(xml, null, success, error); }
    };
    const info = { ok: true, managed: true, shareId: 'share', diagramId: 'diagram', diagramPath: 'C:/shared/Canvas.drawio', filename: 'Canvas.drawio', folderPath: 'C:/shared', assetBaseUrl: 'file:///C:/shared/' };
    const state = { ...info, state: 'upToDate', connectedCollaborators: 2, conflicts: [] };
    const users = { getCurrentUser: () => ({ id: 'alice' }), isAdmin: () => false, revalidateCurrentSession: () => calls.push({ revalidate: true }), listUsers: () => [] };
    const history = { getDiagramId: () => 'diagram', applyRemoteBaseline: () => calls.push({ baseline: true }), flushForSharing: async () => ({ revision: { id: 'saved-head', diagramHistoryId: 'diagram', actorUserId: 'alice' }, snapshot: { snapshotId: 'saved-snapshot' } }), importShared: async entry => calls.push({ imported: entry }) };
    const bridge = {
        async setContext(context) { calls.push({ context }); },
        async getStatus() { return { canvases: options.unsaved ? [] : [state] }; },
        async getSyncthingShareInfo() { return options.unsaved ? { ok: true, managed: false } : info; },
        async setupCanvas(input) { calls.push({ setup: input }); return { ...info, xml: input.xml }; },
        async importHistory() { return { entries: [], errors: [] }; },
        async exportHistory(input) { calls.push({ export: input }); },
        async setConflictState(input) { calls.push({ conflict: input }); },
        async saveRecoveryCopy(input) { calls.push({ recovery: input }); return { filename: 'local-123.drawio', recoveryPath: 'C:/local/recovery.drawio' }; },
        onStatus(listener) { statusListener = listener; return () => {}; },
        async joinCanvas() { return { reply: 'approval reply', diagramPath: 'C:/shared/Pending.drawio', startup: { ok: true } }; }
    };
    const graph = { container: window.document.getElementById('graph'), getDefaultParent: () => ({ getAttribute: () => 'diagram' }), getImage: state => state.image, getLabel: cell => cell.label, refresh() {} };
    const ui = {
        editor: { graph, setStatus(message) { calls.push({ status: message }); }, addListener(name, callback) { editorListeners.set(name, callback); } },
        getCurrentFile: () => current, getFileData: () => xml, watchFile: async () => {}, handleFileChange() { calls.push({ nativeReload: true }); },
        setFileData(data) { calls.push({ apply: data, internal: graph.__trellisUsersInternalChange, remote: graph.__trellisSharingApplying }); xml = data; },
        actions: { addAction(name, callback) { const action = { funct: callback }; actions.set(name, action); return action; } },
        confirm(message, approve) { calls.push({ confirmation: message }); approve(); }, // NEW: sharing uses the asynchronous editor confirmation contract.
        menus: { get: () => null }, loadArgs(args) { calls.push({ open: args }); }
    };
    window.Trellis = { users, history };
    window.trellisShare = bridge;
    window.confirm = () => true;
    window.electron = { request(args, resolve) { resolve({ mtimeMs: 2 }); } };
    window.fsBridge = { readText: filename => read(filename) };
    vm.runInNewContext(fs.readFileSync(plugin, 'utf8'), { window, document: window.document, Draw: { loadPlugin: callback => callback(ui) }, URL, TextEncoder, setTimeout, clearTimeout, console, Promise, Set, Map }, { filename: plugin });
    return { window, calls, current, graph, ui, bridge, history, actions, sharing: window.Trellis.sharing, setXml(value) { xml = value; }, setRead(callback) { read = callback; }, originalSaves: () => originalSaves, fireStatus: () => statusListener([state]) }; // CHANGE: expose injected history for asynchronous arrival tests.
}

test('clean remote replacement is trusted synchronization and revalidates the current session', async t => {
    const h = harness(t);
    await settle();
    h.ui.handleFileChange({ mtimeMs: 2 }, { mtimeMs: 1 }, h.current);
    await settle();
    const applied = h.calls.find(call => call.apply);
    assert.equal(applied.apply, 'remote XML');
    assert.equal(applied.internal, true);
    assert.equal(applied.remote, true);
    assert.ok(h.calls.some(call => call.revalidate));
    assert.ok(h.calls.some(call => call.baseline));
    assert.equal(h.current.isModified(), false);
    assert.equal(h.calls.some(call => call.export), false);
});

test('remote reads block overlapping saves, and edits during a read retain recovery XML', async t => {
    const h = harness(t);
    await settle();
    let finish;
    h.setRead(() => new Promise(resolve => { finish = resolve; }));
    h.ui.handleFileChange({ mtimeMs: 2 }, { mtimeMs: 1 }, h.current);
    let rejected;
    h.current.save(false, () => assert.fail('Save should be blocked'), error => { rejected = error; });
    assert.match(rejected.message, /conflict/);
    assert.equal(h.originalSaves(), 0);
    h.current.modified = true;
    h.setXml('my unsaved XML');
    finish({ data: 'incoming XML' });
    await settle();
    assert.equal(h.calls.some(call => call.apply), false);
    assert.equal(h.calls.find(call => call.recovery).recovery.xml, 'my unsaved XML');
    assert.equal(h.calls.find(call => call.conflict).conflict.conflicted, true);
});

test('history remains local until save and exports only the saved checkpoint', async t => {
    const h = harness(t);
    await settle();
    h.window.dispatchEvent(new h.window.CustomEvent('trellisHistoryRevisionRecorded', { detail: { revision: { id: 'discarded', diagramHistoryId: 'diagram' }, snapshot: {} } }));
    assert.equal(h.calls.some(call => call.export), false);
    await new Promise((resolve, reject) => h.current.save(false, resolve, reject));
    for (let i = 0; i < 100 && !h.calls.some(call => call.export); i++) await new Promise(resolve => setTimeout(resolve, 10));
    const exportCall = h.calls.find(call => call.export);
    assert.ok(exportCall, JSON.stringify(h.calls));
    const exported = exportCall.export;
    assert.equal(exported.entries.length, 1);
    assert.equal(exported.entries[0].revision.id, 'saved-head');
    assert.equal(exported.entries[0].revision.actorUserId, 'alice');
});

test('unsaved canvas setup serializes current graph data rather than stale file data', async t => {
    const h = harness(t, { unsaved: true });
    await settle();
    h.setXml('current unsaved XML');
    await h.sharing.ensureManaged();
    assert.equal(h.calls.find(call => call.setup).setup.xml, 'current unsaved XML');
    assert.equal(h.originalSaves(), 0);
});

test('first share waits for editor confirmation without calling a browser prompt', async t => { // NEW
    const h = harness(t, { unsaved: true }); // NEW
    await settle(); // NEW
    let approve; // NEW
    h.window.confirm = () => assert.fail('Native browser confirmation can strand Electron focus'); // NEW
    h.ui.confirm = (message, onApprove, _onCancel, _approveLabel, _cancelLabel, closable) => { // NEW
        assert.match(message, /Selected scopes limit editing, not visibility/); // NEW
        assert.equal(closable, false, 'Setup must settle through an explicit decision'); // NEW
        approve = onApprove; // NEW
    }; // NEW
    const setup = h.sharing.ensureManaged(); // NEW
    await settle(); // NEW
    assert.equal(typeof approve, 'function'); // NEW
    assert.equal(h.calls.some(call => call.setup), false); // NEW
    approve(); // NEW
    await setup; // NEW
    assert.ok(h.calls.some(call => call.setup)); // NEW
}); // NEW

test('cancelling first-share confirmation leaves the canvas untouched', async t => { // NEW
    const h = harness(t, { unsaved: true }); // NEW
    await settle(); // NEW
    h.ui.confirm = (_message, _approve, cancel) => cancel(); // NEW
    await assert.rejects(h.sharing.ensureManaged(), /Sharing setup cancelled/); // NEW
    assert.equal(h.calls.some(call => call.setup), false); // NEW
    assert.equal(h.originalSaves(), 0); // NEW
    assert.equal(h.current.fileObject, null); // NEW
}); // NEW

test('Join is available outside the gate and never opens a missing canvas as a blank file', async t => {
    const h = harness(t);
    await settle();
    h.sharing.showJoinDialog();
    const findButton = label => [...h.window.document.querySelectorAll('button')].find(button => button.textContent === label);
    findButton('Join Canvas').click();
    await settle();
    h.setRead(async () => { throw new Error('ENOENT'); });
    findButton('Open Canvas').click();
    await settle();
    assert.match(h.window.document.body.textContent, /has not arrived/);
    assert.equal(h.calls.some(call => call.open), false);
});

test('shared image rendering resolves assets without changing stored relative paths', async t => {
    const h = harness(t);
    await settle();
    const relative = 'assets/0123456789abcdef.png';
    assert.equal(h.graph.getImage({ image: relative }), 'file:///C:/shared/' + relative);
    const cell = { label: '<img src="' + relative + '">' };
    assert.match(h.graph.getLabel(cell), /file:\/\/\/C:\/shared\/assets/);
    assert.equal(cell.label, '<img src="' + relative + '">');
});

test('moving an existing canvas updates recent files without removing other providers', async t => { // NEW
    const h = harness(t);
    await settle();
    const oldPath = h.current.fileObject.path;
    h.window.localStorage.setItem('.recent', JSON.stringify([{ id: oldPath }, { id: oldPath, mode: 'google' }, { id: 'other.drawio' }]));
    h.ui.getRecent = () => JSON.parse(h.window.localStorage.getItem('.recent'));
    h.current.addToRecent = () => h.calls.push({ recentAdded: h.current.fileObject.path });
    h.bridge.getSyncthingShareInfo = async () => ({ ok: true, managed: false });
    h.bridge.setupCanvas = async input => ({ ok: true, managed: true, shareId: 'moved', diagramPath: 'C:/new/Canvas.drawio', filename: 'Canvas.drawio', xml: input.xml });
    await h.sharing.ensureManaged();
    const recent = JSON.parse(h.window.localStorage.getItem('.recent'));
    assert.equal(recent.some(entry => entry.id === oldPath && entry.mode == null), false);
    assert.ok(recent.some(entry => entry.mode === 'google'));
    assert.ok(recent.some(entry => entry.id === 'other.drawio'));
    assert.equal(h.calls.find(call => call.recentAdded).recentAdded, 'C:/new/Canvas.drawio');
});

test('history arriving after remote XML refreshes the clean baseline but not newer local work', async t => { // NEW
    const h = harness(t);
    await settle();
    h.ui.handleFileChange({ mtimeMs: 2 }, { mtimeMs: 1 }, h.current);
    await settle();
    const baselines = () => h.calls.filter(call => call.baseline).length;
    const before = baselines();
    h.bridge.importHistory = async () => ({ entries: [{ revision: { id: 'remote-head' } }] });
    h.fireStatus();
    await settle();
    assert.equal(baselines(), before + 1);
    h.ui.handleFileChange({ mtimeMs: 3 }, { mtimeMs: 2 }, h.current);
    await settle();
    h.current.modified = true;
    const withLocalWork = baselines();
    h.fireStatus();
    await settle();
    assert.equal(baselines(), withLocalWork);
});

test('saved history bypasses private intermediate parents and links to an imported ancestor', async t => { // NEW
    const h = harness(t);
    await settle();
    h.bridge.importHistory = async () => ({ entries: [{ revision: { id: 'published' } }] });
    h.fireStatus();
    await settle();
    h.history.list = () => [{ id: 'private', parentRevisionId: 'published' }];
    h.history.flushForSharing = async () => ({ revision: { id: 'saved', diagramHistoryId: 'diagram', parentRevisionId: 'private' }, snapshot: {} });
    await new Promise((resolve, reject) => h.current.save(false, resolve, reject));
    for (let i = 0; i < 100 && !h.calls.some(call => call.export); i++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(h.calls.find(call => call.export).export.entries[0].revision.parentRevisionId, 'published');
});
