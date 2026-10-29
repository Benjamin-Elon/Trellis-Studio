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
    const info = { protocolVersion: options.localOnly ? 2 : 3, ok: true, managed: !options.localOnly, localOnly: !!options.localOnly, reason: options.localOnly ? 'Sharing is disabled for this old project.' : '', shareId: 'share', diagramId: 'diagram', diagramPath: 'C:/shared/Canvas.drawio', filename: 'Canvas.drawio', folderPath: 'C:/shared', assetBaseUrl: 'file:///C:/shared/' }; // CHANGE
    const state = { ...info, state: options.localOnly ? 'localOnly' : 'upToDate', connectedCollaborators: options.localOnly ? 0 : 2 }; // CHANGE
    const users = { getCurrentUser: () => ({ id: 'alice' }), isAdmin: () => false, revalidateCurrentSession: () => calls.push({ revalidate: true }), listUsers: () => [] };
    const history = { getDiagramId: () => 'diagram', applyRemoteBaseline: () => calls.push({ baseline: true }), flushForSharing: async () => ({ revision: { id: 'saved-head', diagramHistoryId: 'diagram', actorUserId: 'alice' }, snapshot: { snapshotId: 'saved-snapshot' } }), importShared: async entry => calls.push({ imported: entry }) };
    const bridge = {
        async setContext(context) { calls.push({ context }); },
        async getStatus() { return { canvases: options.unsaved || options.unmanaged ? [] : [state] }; }, // CHANGE
        async getSyncthingShareInfo() { return options.unsaved ? { ok: true, managed: false } : info; },
        async setupCanvas(input) { calls.push({ setup: input }); return { ...info, xml: input.xml }; },
        async importHistory() { return { entries: [], errors: [] }; },
        async exportHistory(input) { calls.push({ export: input }); },
        async saveRecoveryCopy(input) { calls.push({ recovery: input }); return { filename: 'local-123.drawio', recoveryPath: 'C:/local/recovery.drawio' }; },
        async collaborationAction(input) { calls.push({ collaboration: input }); return { ok: true, xml: input.xml || xml, collaboration: { sessionId: 'local', holds: [], presence: [], reservations: [], recoveries: [], errors: [] } }; }, // NEW
        async listRequests() { return { members: [], requests: [] }; }, // NEW
        onStatus(listener) { statusListener = listener; return () => {}; },
        async joinCanvas() { return { reply: 'approval reply', diagramPath: 'C:/shared/Pending.drawio', startup: { ok: true } }; }
    };
    const graph = { container: window.document.getElementById('graph'), getDefaultParent: () => ({ getAttribute: () => 'diagram' }), getImage: state => state.image, getLabel: cell => cell.label, refresh() {} };
    if (options.model) graph.getModel = () => options.model; // NEW: exercise the production change listener when testing snapshot capture timing.
    const ui = {
        editor: { graph, setStatus(message, callback) { this.statusFunction = callback; calls.push({ status: message, callback }); ui.setStatusText(message); }, addListener(name, callback) { editorListeners.set(name, callback); } },
        getCurrentFile: () => current, getFileData: () => xml, watchFile: async () => {}, handleFileChange() { calls.push({ nativeReload: true }); },
        setFileData(data) { calls.push({ apply: data, internal: graph.__trellisUsersInternalChange, remote: graph.__trellisSharingApplying }); xml = data; },
        synchronizeCurrentFile() { calls.push({ nativeSynchronize: true }); }, // NEW
        actions: { addAction(name, callback) { const action = { funct: callback }; actions.set(name, action); return action; } },
        confirm(message, approve) { calls.push({ confirmation: message }); approve(); }, // NEW: sharing uses the asynchronous editor confirmation contract.
        menus: { get: () => null }, loadArgs(args) { calls.push({ open: args }); }
    };
    ui.statusContainer = window.document.createElement('a'); window.document.body.appendChild(ui.statusContainer); ui.setStatusText = message => { ui.statusContainer.textContent = message; }; // NEW: simulate sanitized status text before the application installs trusted callback controls.
    window.Trellis = { users, history };
    window.trellisShare = bridge;
    window.__trellisLiveUpdatesForBenchmark = !options.explicitRefresh; // NEW: existing tests remain the controlled pre-change comparison fixture.
    if (options.explicitRefresh) vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../drawio/src/main/webapp/js/trellis-incoming-changes.js'), 'utf8'), { window, globalThis: window }); // NEW
    window.confirm = () => true;
    window.electron = { request(args, resolve) { resolve({ mtimeMs: 2 }); } };
    window.fsBridge = { readText: filename => read(filename) };
    if (options.timers) window.setInterval = (callback, interval) => { options.timers.push({ callback, interval }); return options.timers.length; }; // CHANGE: exercise real timer callbacks with controlled ticks.
    if (options.editingHolds) vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../drawio/src/main/webapp/js/trellis-editing-holds.js'), 'utf8'), { window }); // NEW
    if (options.model) vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../drawio/src/main/webapp/js/trellis-edit-context.js'), 'utf8'), { window }); // NEW: claims observe real per-change operation classification.
    vm.runInNewContext(fs.readFileSync(plugin, 'utf8'), { window, document: window.document, Draw: { loadPlugin: callback => callback(ui) }, mxEventObject: function (name) { this.name = name; }, URL, TextEncoder, setTimeout, clearTimeout, console, Promise, Set, Map }, { filename: plugin }); // CHANGE
    return { window, calls, current, graph, ui, bridge, users, history, actions, state, editorListeners, sharing: window.Trellis.sharing, setXml(value) { xml = value; }, setRead(callback) { read = callback; }, originalSaves: () => originalSaves, fireStatus: () => statusListener([state]) }; // CHANGE: expose injected users and history for asynchronous boundary tests.
}

test('generated and presentation edits save without activity holds; mixed edits claim only manual targets', async t => { // NEW
    const listeners = new Map(), cells = new Map(['manual', 'generated', 'layout'].map(id => [id, { id, style: '' }]));
    const model = { addListener: (name, callback) => listeners.set(name, callback), getCell: () => null, getParent: () => null }; // CHANGE: headless claim test has no rendered cell fingerprints.
    const h = harness(t, { model }); await settle(); h.calls.length = 0;
    const fire = changes => listeners.get('change')(model, { getProperty: () => ({ changes }) });
    const generated = { cell: cells.get('generated'), __trellisOperation: { kind: 'generated-content' } }, layout = { cell: cells.get('layout'), __trellisOperation: { kind: 'derived-presentation' } };
    h.current.modified = true; h.setXml('generated content'); fire([generated, layout]); await settle();
    assert.equal(h.calls.some(call => call.collaboration?.kind === 'claim'), false);
    await new Promise((resolve, reject) => h.current.save(false, resolve, reject));
    assert.equal(h.calls.some(call => call.collaboration?.kind === 'save'), true);
    h.calls.length = 0; h.current.modified = true; fire([{ cell: cells.get('manual') }, generated, layout]); await settle();
    const claim = h.calls.find(call => call.collaboration?.kind === 'claim'); assert.ok(claim);
    assert.deepEqual(Array.from(claim.collaboration.targets), ['["","manual"]']);
}); // NEW

test('guided completion initializes the account view and claims its protected transition before saving', async t => { // NEW
    const h = harness(t, { explicitRefresh: true }); await settle(); h.calls.length = 0; // NEW
    h.users.finishIdentityJoin = async () => { h.setXml('linked account'); h.current.modified = true; return { ok: true, user: { id: 'alice' } }; }; // NEW
    assert.equal((await h.sharing.finishIdentityJoin({ identityId: 'portable' })).ok, true); // NEW
    const operations = h.calls.filter(call => call.collaboration).map(call => call.collaboration); assert.deepEqual(operations.filter(call => ['claim', 'save'].includes(call.kind)).map(call => call.kind), ['claim', 'save']); // NEW
    assert.equal(operations.find(call => call.kind === 'claim').usersPolicyAction, true); assert.equal(h.current.modified, false); // NEW
    h.bridge.collaborationAction = async input => { if (input.kind === 'claim') return { ok: false, reason: 'Account is busy', collaboration: { holds: [] } }; return { ok: true, xml: h.current.data, collaboration: { holds: [] } }; }; // NEW
    await assert.rejects(h.sharing.finishIdentityJoin({ identityId: 'portable' }), /Account is busy/); assert.equal(h.current.modified, true); // NEW
}); // NEW

test('a rejected hold generation is recovered and removed before saving the surviving local draft', async t => { // NEW
    const h = harness(t, { explicitRefresh: true, editingHolds: true }); await settle(); // NEW
    const base = h.current.data; h.setXml('expired A|valid B'); h.current.modified = true; let saves = 0; // NEW
    h.bridge.collaborationAction = async input => { // NEW
        h.calls.push({ collaboration: input }); // NEW
        const collaboration = { sessionId: 'local', holds: [], presence: [], reservations: [], recoveries: [] }; // NEW
        if (input.kind === 'save' && ++saves === 1) return { ok: false, code: 'HOLD_LOST', targets: ['["","a"]'], reason: 'Hold expired', collaboration }; // NEW
        if (input.kind === 'recover-holds') { assert.equal(input.baseXml, base); assert.equal(input.xml, 'expired A|valid B'); return { ok: true, xml: 'saved A|valid B', discardedKeys: ['["","a"]'], recoveryPath: 'C:/recovery/draft.drawio', collaboration }; } // NEW
        return { ok: true, xml: input.xml || h.ui.getFileData(), collaboration }; // NEW
    }; // NEW
    await new Promise((resolve, reject) => h.current.save(false, resolve, reject)); // NEW
    assert.equal(saves, 2); assert.equal(h.current.data, 'saved A|valid B'); assert.equal(h.current.modified, false); // NEW
    assert.equal(h.ui.getFileData(), 'saved A|valid B'); // NEW
}); // NEW

test('recovery write failure leaves the modified draft open and does not report save success', async t => { // NEW
    const h = harness(t, { explicitRefresh: true, editingHolds: true }); await settle(); h.setXml('retained draft'); h.current.modified = true; // NEW
    let storageRestored = false; // NEW
    h.bridge.collaborationAction = async input => { // NEW
        if (input.kind === 'recover-holds') { if (!storageRestored) throw new Error('Recovery disk full'); return { ok: true, xml: 'surviving draft', discardedKeys: ['["","a"]'], recoveryPath: 'C:/recovery/draft.drawio', collaboration: { sessionId: 'local', holds: [] } }; } // CHANGE
        if (storageRestored) return { ok: true, xml: input.xml, collaboration: { sessionId: 'local', holds: [] } }; // NEW
        return { ok: false, code: 'HOLD_LOST', targets: ['["","a"]'], reason: 'Hold expired', collaboration: { sessionId: 'local', holds: [] } }; // NEW
    }; // NEW
    await assert.rejects(new Promise((resolve, reject) => h.current.save(false, resolve, error => reject(new Error(error.message)))), /Recovery disk full/); // NEW
    assert.equal(h.ui.getFileData(), 'retained draft'); assert.equal(h.current.modified, true); // NEW
    storageRestored = true; await new Promise((resolve, reject) => h.current.save(false, resolve, reject)); assert.equal(h.ui.getFileData(), 'surviving draft'); assert.equal(h.current.modified, false); // NEW
}); // NEW
test('a successful in-flight save settles before a late status loss can recover its accepted actions', async t => { // NEW
    const h = harness(t, { explicitRefresh: true, editingHolds: true }); await settle(); // NEW
    h.state.collaboration = { holds: [{ key: '["","a"]', claimId: 'held', sessionId: 'local' }], presence: [], reservations: [] }; h.fireStatus(); // NEW
    h.setXml('accepted draft'); h.current.modified = true; let finish, recoveries = 0; // NEW
    h.bridge.collaborationAction = async input => { // NEW
        if (input.kind === 'save') return new Promise(resolve => { finish = resolve; }); // NEW
        if (input.kind === 'recover-holds') { recoveries++; throw new Error('Accepted actions must not be rolled back'); } // NEW
        return { ok: true, xml: h.ui.getFileData(), collaboration: { sessionId: 'local', holds: [], presence: [], reservations: [] } }; // NEW
    }; // NEW
    const saved = new Promise((resolve, reject) => h.current.save(false, resolve, reject)); await settle(); // NEW
    h.state.collaboration = { holds: [], presence: [], reservations: [] }; h.fireStatus(); // NEW
    finish({ ok: true, xml: 'accepted draft', collaboration: { sessionId: 'local', holds: [], presence: [], reservations: [] } }); await saved; await settle(); // NEW
    assert.equal(recoveries, 0); assert.equal(h.current.data, 'accepted draft'); assert.equal(h.current.modified, false); // NEW
}); // NEW

test('explicit refresh receives notifications without decoding or applying incoming canvas content', async t => { // NEW
    const timers = [], h = harness(t, { explicitRefresh: true, timers }); await settle();
    h.calls.length = 0; h.setXml('A1|B0'); let decodes = 0;
    h.ui.getPagesForXml = () => { decodes++; throw new Error('Background decoding forbidden'); };
    h.bridge.collaborationAction = async input => {
        h.calls.push({ collaboration: input });
        return { ok: true, xml: 'A1|B1', groups: input.kind === 'changes' ? [{ id: 'b', keys: ['["","b"]'], targets: ['["","b"]'], authors: ['Bob'], objects: [{ key: '["","b"]', label: 'B', operation: 'modified' }] }] : undefined, collaboration: { hash: 'changed', sessionId: 'local', holds: [], presence: [], reservations: [] } };
    };
    await timers[0].callback(); await settle();
    assert.equal(h.ui.getFileData(), 'A1|B0'); assert.equal(decodes, 0);
    assert.equal(h.calls.some(call => call.apply), false); assert.equal(h.sharing.getPendingChanges().length, 1);
    assert.match(h.window.document.querySelector('[data-incoming-toolbar]').textContent, /1 changed object/); // CHANGE
});

test('lost parent holds cancel their nested native dialog without closing an unrelated top dialog', async t => { // NEW
    const a = { id: 'a' }, child = { id: 'child-a', parent: a }, b = { id: 'b' }, cells = new Map([a, child, b].map(cell => [cell.id, cell]));
    const model = { addListener() {}, getCell: id => cells.get(id), getParent: cell => cell.parent || null }, h = harness(t, { explicitRefresh: true, model }); await settle();
    const make = id => { const container = h.window.document.createElement('div'); container.className = 'geDialog'; const input = h.window.document.createElement('input'); input.dataset.collaborationObjectId = id; container.appendChild(input); h.window.document.body.appendChild(container); return { container, close(cancel) { assert.equal(cancel, true); container.remove(); return true; } }; };
    const affected = make('child-a'), unrelated = make('b'); h.ui.dialogs = [affected, unrelated]; h.ui.dialog = unrelated;
    h.ui.editor.fireEvent = event => h.calls.push({ event: event.name }); h.ui.hideDialog = () => assert.fail('The unrelated top dialog must stay open');
    h.state.collaboration = { holds: [{ key: '["","a"]', claimId: 'held-a', sessionId: 'local' }], presence: [], reservations: [] }; h.fireStatus();
    h.state.collaboration = { holds: [], presence: [], reservations: [] }; h.fireStatus();
    assert.equal(affected.container.isConnected, false); assert.equal(unrelated.container.isConnected, true); assert.equal(h.ui.dialog, unrelated);
    assert.equal(h.ui.dialogs.length, 1); assert.match(h.calls.find(call => call.status?.includes('unapplied entries discarded')).status, /Submitted diagram edits remain/);
});

test('same-user permission revalidation leaves unsaved content and its view untouched', async t => { // NEW
    const h = harness(t, { explicitRefresh: true }); await settle(); h.calls.length = 0;
    h.setXml('Unrelated local draft / stale B0'); h.current.modified = true;
    h.window.dispatchEvent(new h.window.CustomEvent('trellisUsersSessionChanged')); await settle();
    assert.equal(h.ui.getFileData(), 'Unrelated local draft / stale B0'); assert.equal(h.current.modified, true);
    assert.equal(h.calls.some(call => call.apply || call.collaboration?.kind === 'open-view'), false);
});

test('native Synchronize and force Reload enter review without merging incoming content or clearing local edits', async t => { // NEW
    const h = harness(t, { explicitRefresh: true }); await settle(); h.setXml('A2/B0'); h.current.modified = true; h.calls.length = 0;
    h.bridge.collaborationAction = async () => ({ ok: true, xml: 'A2/B1', groups: [], details: [], token: 'review', collaboration: { sessionId: 'local', holds: [], presence: [], reservations: [] } });
    await h.ui.synchronizeCurrentFile(false); await h.ui.synchronizeCurrentFile(true);
    assert.equal(h.ui.getFileData(), 'A2/B0'); assert.equal(h.current.modified, true);
    assert.equal(h.calls.some(call => call.nativeSynchronize || call.apply), false); assert.ok(h.window.document.querySelector('.trellis-incoming-review'));
});

test('switching users preserves the previous draft and rejects a queued save under the next user', async t => { // NEW
    const h = harness(t, { explicitRefresh: true }); await settle(); h.calls.length = 0;
    h.setXml('Alice unsaved draft / B0'); h.current.modified = true; let releaseNaming, releaseRecovery, saveError;
    h.current.__trellisNamingSync = new Promise(resolve => { releaseNaming = resolve; });
    const oldSave = h.current.save(false, () => assert.fail('A delayed old-user save must not succeed'), error => { saveError = error; }); await settle();
    h.bridge.saveRecoveryCopy = input => { h.calls.push({ preservedDraft: input.xml }); return new Promise(resolve => { releaseRecovery = resolve; }); };
    h.bridge.collaborationAction = async input => { h.calls.push({ collaboration: input }); return { ok: true, xml: 'Bob remembered objects', groups: [], collaboration: { sessionId: 'bob-window', holds: [], presence: [], reservations: [] } }; };
    h.users.getCurrentUser = () => ({ id: 'bob' }); h.window.dispatchEvent(new h.window.CustomEvent('trellisUsersSessionChanged')); await settle();
    assert.equal(h.calls.some(call => call.apply), false); assert.equal(h.calls.find(call => call.preservedDraft).preservedDraft, 'Alice unsaved draft / B0');
    releaseRecovery({ recoveryPath: 'C:/private/alice-draft.drawio' }); await settle(); releaseNaming(); await settle(); await oldSave;
    assert.equal(h.ui.getFileData(), 'Bob remembered objects'); assert.equal(h.calls.some(call => call.collaboration?.kind === 'save'), false); assert.match(saveError.message, /user changed/);
});

test('explicit autosave keeps A2/B0 displayed while the accepted history source contains A2/B1', async t => { // NEW
    const h = harness(t, { explicitRefresh: true }); await settle();
    h.setXml('A2|B0'); h.current.modified = true;
    h.bridge.collaborationAction = async input => {
        if (input.kind === 'save') { assert.equal(input.xml, 'A2|B0'); return { ok: true, xml: 'A2|B1', collaboration: { sessionId: 'local', holds: [] } }; }
        return { ok: true, xml: 'A2|B1', collaboration: { sessionId: 'local', holds: [] } };
    };
    await new Promise((resolve, reject) => h.current.save(false, resolve, reject)); await settle();
    assert.equal(h.ui.getFileData(), 'A2|B0'); assert.equal(h.current.data, 'A2|B0'); assert.equal(h.current.modified, false);
    assert.equal(await h.sharing.historyXml(), 'A2|B1');
});

test('explicit naming notifications do not patch accepted content into the stale view', async t => { // NEW
    const h = harness(t, { explicitRefresh: true }); await settle(); h.setXml('Displayed view'); h.calls.length = 0;
    h.bridge.collaborationAction = async () => ({ ok: true, xml: 'Unseen named project', groups: [], collaboration: { hash: 'new', sessionId: 'local', holds: [] } });
    h.window.dispatchEvent(new h.window.CustomEvent('trellisProjectNamed', { detail: { diagramId: 'diagram', projectName: 'Renamed', path: 'C:/shared/Canvas.drawio' } })); await settle();
    assert.equal(h.ui.getFileData(), 'Displayed view'); assert.equal(h.calls.some(call => call.apply), false);
});

test('old diagrams retain native local editing, watching and assets while sharing commands stay disabled', async t => { // CHANGE
    const timers = [], h = harness(t, { localOnly: true, timers }); await settle(); // CHANGE
    assert.equal(h.sharing.getInfo().managed, false); assert.equal(h.sharing.describeStatus(), 'Local only · Sharing off'); // CHANGE
    h.setXml('edited local diagram'); h.current.modified = true; await new Promise((resolve, reject) => h.current.save(false, resolve, reject)); // CHANGE
    assert.equal(h.originalSaves(), 1); assert.equal(h.current.data, 'edited local diagram'); // CHANGE
    h.ui.handleFileChange({ mtimeMs: 2 }, { mtimeMs: 1 }, h.current); await timers[0].callback(); await settle(); // CHANGE
    assert.ok(h.calls.some(call => call.nativeReload)); assert.equal(h.calls.some(call => call.collaboration || call.export || call.imported || call.setup), false); // CHANGE
    assert.equal(h.graph.getImage({ image: 'assets/0123456789abcdef.png' }), 'file:///C:/shared/assets/0123456789abcdef.png'); // CHANGE
    await assert.rejects(h.sharing.ensureManaged(), /Sharing is disabled/); await assert.rejects(h.sharing.prepareInvite({}), /Sharing is disabled/); // CHANGE
    await h.sharing.showSharingDialog(); assert.match(h.window.document.body.textContent, /Sharing is disabled/); // CHANGE
    assert.equal([...h.window.document.querySelectorAll('button')].some(button => /Pause syncing|Resume syncing|Add another computer|Approve a computer/.test(button.textContent)), false); // CHANGE
}); // CHANGE

test('an initial collaboration claim defers its XML snapshot until the queued capture', async t => { // NEW
    const listeners = new Map(), model = { addListener: (name, callback) => listeners.set(name, callback), getParent: () => null }; // NEW
    const h = harness(t, { collaboration: true, model }); await settle(); // NEW
    const original = h.ui.getFileData; let snapshots = 0; // NEW
    h.ui.getFileData = () => { snapshots++; return original(); }; // NEW
    h.setXml('changed object'); // NEW
    listeners.get('change')(model, { getProperty: () => ({ changes: [{ cell: { id: 'bed', style: '' } }] }) }); // NEW
    assert.equal(snapshots, 0, 'routine model notification must not encode the document synchronously'); // NEW
    await settle(); // NEW
    const claim = h.calls.find(call => call.collaboration?.kind === 'claim').collaboration; // NEW
    assert.equal(claim.xml, 'changed object'); assert.ok(snapshots > 0); // NEW
}); // NEW

test('v3 first save uses the signed snapshot rather than an editor-normalized initial document', async t => { // NEW
    const h = harness(t, { collaboration: true }); // NEW
    h.bridge.collaborationAction = async input => { h.calls.push({ collaboration: input }); return { ok: true, xml: input.kind === 'get' ? 'signed initial snapshot' : input.xml, collaboration: { sessionId: 'local', holds: [], presence: [], reservations: [] } }; }; // NEW
    await settle(); h.setXml('normalized editor draft'); h.current.modified = true; // NEW
    await new Promise((resolve, reject) => h.current.save(false, resolve, reject)); // NEW
    assert.equal(h.calls.find(call => call.collaboration?.kind === 'save').collaboration.baseXml, 'signed initial snapshot'); // NEW
}); // NEW
test('collaborative save completion emits the native notification after the filename save gate opens', async t => { // NEW
    const h = harness(t, { collaboration: true }); await settle(); // NEW
    let notified = 0; h.current.contentChanged = () => { assert.equal(h.current.__trellisCollaborativeSaving, false); assert.equal(h.current.data, 'saved draft'); notified++; }; // NEW
    h.setXml('saved draft'); h.current.modified = true; await new Promise((resolve, reject) => h.current.save(false, resolve, reject)); // NEW
    assert.equal(notified, 1); // NEW
}); // NEW
test('a delayed previous-project refresh cannot initialize the newly opened project with old sharing context', async t => { // NEW
    const h = harness(t, { collaboration: true }); await settle(); // NEW
    let completeOld; const oldInfo = h.sharing.getInfo(); h.bridge.getSyncthingShareInfo = () => new Promise(resolve => { completeOld = resolve; }); // NEW
    const pending = h.sharing.refresh(); await settle(); assert.equal(typeof completeOld, 'function'); // NEW
    const next = { ...h.current, data: 'next saved XML', fileObject: { path: 'C:/shared/Next.drawio', name: 'Next.drawio' } }; delete next.__trellisSharingHooks; // NEW
    h.ui.getCurrentFile = () => next; h.history.getDiagramId = () => 'next-diagram'; // NEW
    const nextInfo = { ...oldInfo, diagramId: 'next-diagram', shareId: 'next-share', diagramPath: next.fileObject.path }; // NEW
    h.bridge.getStatus = async () => ({ canvases: [{ ...h.state, ...nextInfo }] }); h.bridge.getSyncthingShareInfo = async () => nextInfo; // NEW
    h.editorListeners.get('fileLoaded')(); completeOld(oldInfo); await pending; await settle(); await h.sharing.refresh(); // NEW
    assert.equal(h.sharing.getInfo().diagramId, 'next-diagram'); assert.equal(h.sharing.getInfo().diagramPath, next.fileObject.path); // NEW
}); // NEW
test('clean remote replacement is trusted synchronization and revalidates the current session', async t => {
    const h = harness(t);
    await settle();
    h.bridge.collaborationAction = async input => ({ ok: true, xml: 'remote XML', collaboration: { sessionId: 'local', holds: [], presence: [], reservations: [] } }); // CHANGE
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
    const invitation = h.window.document.querySelector('textarea'); invitation.value = 'complete invitation'; invitation.dispatchEvent(new h.window.Event('input', { bubbles: true })); // CHANGE: empty invitations cannot be submitted.
    findButton('Join Canvas').click();
    await settle();
    assert.equal(findButton('Open Canvas').disabled, true); // NEW: pending approval cannot open a downloaded or blank canvas.
    h.bridge.getStatus = async () => ({ canvases: [{ diagramPath: 'C:/shared/Pending.drawio', pending: false, state: 'syncing' }] }); // NEW
    h.setRead(async () => { throw new Error('ENOENT'); });
    h.fireStatus(); await settle(); // NEW
    findButton('Open Canvas').click();
    await settle();
    assert.match(h.window.document.body.textContent, /has not arrived/);
    assert.equal(h.calls.some(call => call.open), false);
    assert.equal(findButton('Open Canvas').disabled, true); // NEW
    h.setRead(async () => ({ data: 'downloaded XML' })); h.fireStatus(); await settle(); // NEW
    assert.equal(findButton('Open Canvas').disabled, false); findButton('Open Canvas').click(); await settle(); // NEW
    assert.ok(h.calls.some(call => call.open?.args[0] === 'C:/shared/Pending.drawio')); // NEW
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

test('history arriving after remote XML refreshes the clean baseline but not newer local work', async t => { // CHANGE
    const h = harness(t);
    await settle();
    h.bridge.collaborationAction = async input => ({ ok: true, xml: 'remote XML', collaboration: { sessionId: 'local', holds: [], presence: [], reservations: [] } }); // CHANGE
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

// NEW: Shared projects save durably through the journal, including when the editor preference is off.
test('v3 always autosaves through the journal and never invokes a competing raw file save', async t => { // NEW
    const h = harness(t, { collaboration: true }); await settle(); h.ui.editor.autosave = false; // NEW
    assert.equal(h.current.isAutosave(), true); assert.equal(h.current.isAutosaveOptional(), false); // NEW
    h.setXml('local edits'); h.current.modified = true; // NEW
    await new Promise((resolve, reject) => h.current.save(false, resolve, reject)); // NEW
    assert.equal(h.originalSaves(), 0); assert.equal(h.calls.filter(c => c.collaboration?.kind === 'save').length, 1); assert.equal(h.current.modified, false); // NEW
}); // NEW
test('v3 failed durability leaves the draft modified and reports failure once', async t => { // NEW
    const h = harness(t, { collaboration: true }); await settle(); h.bridge.collaborationAction = async () => { throw new Error('Disk is full'); }; // NEW
    h.setXml('unsaved work'); h.current.modified = true; let errors = 0; // NEW
    await new Promise(resolve => h.current.save(false, () => assert.fail('No durable save'), error => { errors++; assert.match(error.message, /Disk is full/); resolve(); })); // NEW
    assert.equal(errors, 1); assert.equal(h.current.modified, true); // NEW
}); // NEW

test('explicit object forms wait for collaborative durability and receive save rejection before discarding their private drafts', async t => { // CHANGE
    const h = harness(t, { collaboration: true }); await settle(); h.setXml('posted comment'); h.current.modified = true; // CHANGE
    let complete; h.bridge.collaborationAction = async input => { // CHANGE
        if (input.kind !== 'save') return { ok: true, xml: 'posted comment' }; // CHANGE
        return new Promise(resolve => { complete = () => resolve({ ok: true, xml: 'posted comment', collaboration: { sessionId: 'local', holds: [], presence: [] } }); }); // CHANGE
    }; // CHANGE
    let accepted = false; const acceptance = h.sharing.settleObjectEdits().then(() => { accepted = true; }); await settle(); // CHANGE
    assert.equal(accepted, false); complete(); await acceptance; assert.equal(accepted, true); // CHANGE
    h.bridge.collaborationAction = async () => { throw new Error('Comment save rejected'); }; // CHANGE
    await assert.rejects(h.sharing.settleObjectEdits(), /Comment save rejected/); // CHANGE
}); // CHANGE
test('guided approval forms retain typing and focus during live status updates', async t => { // NEW
    const h = harness(t); await settle(); h.window.Trellis.users.isAdmin = () => true; await h.sharing.showSharingDialog(); // NEW
    const buttons = () => [...h.window.document.querySelectorAll('button')]; buttons().find(b => b.textContent === 'Approve a computer').click(); await settle(); // NEW
    const input = h.window.document.querySelector('textarea'); input.value = 'unfinished reply'; input.focus(); // NEW
    h.state.state = 'paused'; h.fireStatus(); await settle(); // NEW
    assert.equal(h.window.document.querySelector('textarea'), input); assert.equal(input.value, 'unfinished reply'); assert.equal(h.window.document.activeElement, input); // NEW
    let leaked = 0; h.window.document.addEventListener('keydown', () => leaked++); input.dispatchEvent(new h.window.KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true })); assert.equal(leaked, 0); // NEW
}); // NEW
test('add-computer empty state explains missing users and disables invitation creation', async t => { // NEW
    const h = harness(t); await settle(); h.window.Trellis.users.isAdmin = () => true; await h.sharing.showSharingDialog(); // NEW
    [...h.window.document.querySelectorAll('button')].find(b => b.textContent === 'Add another computer').click(); await settle(); // NEW
    assert.match(h.window.document.body.textContent, /No active users have an email/); assert.equal([...h.window.document.querySelectorAll('button')].find(b => b.textContent === 'Create invitation').disabled, true); // NEW
}); // NEW
test('peer updates returned during a save preserve newer typing and do not become local reversions', async t => { // NEW
    const h = harness(t, { collaboration: true }); await settle(); // NEW
    h.ui.getPagesForXml = xml => [xml]; h.ui.pages = ['A1|B0']; // NEW
    h.ui.diffPages = (before, after) => ({ before: before[0], after: after[0] }); // NEW
    h.current.patch = patches => { // NEW: represent independent cells while checking the actual production orchestration.
        const patch = patches[0], before = patch.before.split('|'), after = patch.after.split('|'), live = h.ui.getFileData().split('|'); // NEW
        h.setXml(live.map((value, i) => before[i] === after[i] ? value : after[i]).join('|')); // NEW
    }; // NEW
    let finish, saved = false; // NEW
    h.bridge.collaborationAction = async input => input.kind === 'save' ? new Promise(resolve => { finish = resolve; }) : ({ ok: true, xml: h.ui.getFileData(), collaboration: { sessionId: 'local', holds: [], presence: [], reservations: [] } }); // NEW
    h.setXml('A1|B0'); h.current.modified = true; h.current.save(false, () => { saved = true; }); await settle(); // NEW
    h.setXml('A2|B0'); h.current.modified = true; // NEW
    finish({ ok: true, xml: 'A1|B1', collaboration: { sessionId: 'local', holds: [], presence: [], reservations: [] } }); await settle(); // NEW
    assert.equal(saved, true); assert.equal(h.ui.getFileData(), 'A2|B1'); assert.equal(h.current.modified, true); // NEW
    h.bridge.collaborationAction = async input => { if (input.kind === 'save') { assert.equal(input.baseXml, 'A1|B1'); assert.equal(input.xml, 'A2|B1'); } return { ok: true, xml: input.xml || h.ui.getFileData(), collaboration: { sessionId: 'local', holds: [], presence: [], reservations: [] } }; }; // NEW
    h.current.save(false, () => {}); await settle(); assert.equal(h.current.modified, false); // NEW
}); // NEW
test('unavailable clipboard selects the handoff text and explains how to copy it', async t => { // NEW
    const h = harness(t); await settle(); h.sharing.showJoinDialog(); // NEW
    const invitation = h.window.document.querySelector('textarea'); invitation.value = 'complete invitation'; invitation.dispatchEvent(new h.window.Event('input', { bubbles: true })); // NEW
    [...h.window.document.querySelectorAll('button')].find(button => button.textContent === 'Join Canvas').click(); await settle(); // NEW
    [...h.window.document.querySelectorAll('button')].find(button => button.textContent === 'Copy').click(); await settle(); // NEW
    const reply = [...h.window.document.querySelectorAll('textarea')].find(input => input.readOnly && input.value === 'approval reply'); // NEW
    assert.equal(h.window.document.activeElement, reply); assert.equal(reply.selectionStart, 0); assert.equal(reply.selectionEnd, reply.value.length); // NEW
    assert.match(h.window.document.body.textContent, /complete text is selected/); // NEW
}); // NEW
test('zero peers cannot conceal pause or revocation, and unsaved drafts are not reported as saved', async t => { // NEW
    const h = harness(t, { collaboration: true }); await settle(); h.state.connectedPeers = 0; // NEW
    h.state.state = 'paused'; h.fireStatus(); assert.equal(h.sharing.describeStatus(), 'Paused'); // NEW
    h.state.state = 'revoked'; h.fireStatus(); assert.equal(h.sharing.describeStatus(), 'Access removed'); assert.equal(h.current.isAutosave(), false); // NEW
    h.state.state = 'unavailable'; h.state.pending = true; h.fireStatus(); assert.equal(h.sharing.describeStatus(), 'Awaiting approval'); // NEW
    h.state.pending = false; h.state.state = 'upToDate'; h.current.modified = true; await h.sharing.showSharingDialog(); // NEW
    const text = h.window.document.body.textContent; assert.match(text, /waiting to be saved locally/); assert.doesNotMatch(text, /Local changes are saved/); // NEW
}); // NEW

test('plain local saves retain native saving without sharing checkpoints, exports, or collaboration ticks', async t => { // CHANGE
    const timers = [], h = harness(t, { unmanaged: true, timers }); await settle(); // CHANGE
    h.history.flushForSharing = () => assert.fail('Local history must not be flushed for sharing'); // CHANGE
    await new Promise((resolve, reject) => h.current.save(false, resolve, reject)); await settle(); // CHANGE
    assert.equal(h.originalSaves(), 1); assert.equal(timers[0].interval, 5000); // CHANGE
    await timers[0].callback(); await timers[0].callback(); // CHANGE
    assert.equal(h.calls.some(call => call.export || call.collaboration), false); // CHANGE
}); // CHANGE

test('unchanged managed context and presence ticks never refresh or patch the graph', async t => { // CHANGE
    const timers = [], h = harness(t, { collaboration: true, timers }); await settle(); let refreshes = 0; // CHANGE
    h.graph.refresh = () => refreshes++; h.current.patch = () => assert.fail('Unchanged content must not patch'); // CHANGE
    await h.sharing.refresh(); h.fireStatus(); await timers[0].callback(); // CHANGE
    assert.equal(refreshes, 0); assert.equal(timers[0].interval, 5000); // CHANGE
    assert.ok(h.calls.some(call => call.collaboration?.kind === 'view')); // CHANGE
}); // CHANGE

test('clean incoming content decodes once, diffs native pages, and keeps shadow pages independent', async t => { // CHANGE
    const timers = [], h = harness(t, { collaboration: true, timers }); await settle(); const decoded = []; let patches = 0; // CHANGE
    h.ui.pages = [{ content: 'live' }]; // CHANGE
    h.ui.getPagesForXml = xml => { const pages = [{ content: xml }]; decoded.push(pages); return pages; }; // CHANGE
    h.ui.diffPages = (before, after) => { assert.equal(before, h.ui.pages); return { u: { content: after[0].content } }; }; // CHANGE
    h.current.patch = () => { patches++; h.ui.pages[0].content = 'incoming'; }; // CHANGE
    h.current.setShadowPages = pages => { assert.equal(pages, decoded[0]); assert.notEqual(pages[0], h.ui.pages[0]); }; // CHANGE
    h.ui.getFileData = () => assert.fail('Clean incoming patches must not encode live XML'); // CHANGE
    h.bridge.collaborationAction = async () => ({ ok: true, xml: 'incoming', collaboration: { sessionId: 'local', holds: [], presence: [], reservations: [] } }); // CHANGE
    await timers[0].callback(); assert.equal(patches, 1); assert.equal(decoded.length, 1); // CHANGE
}); // CHANGE

test('semantically empty native patches update the baseline without model, session, or history work', async t => { // CHANGE
    const timers = [], h = harness(t, { collaboration: true, timers }); await settle(); let parsed = 0; // CHANGE
    h.ui.pages = [{}]; h.ui.getPagesForXml = () => { parsed++; return [{}]; }; h.ui.diffPages = () => ({}); // CHANGE
    h.current.ignorePatches = patches => Object.keys(patches[0]).length === 0; // CHANGE
    h.current.patch = () => assert.fail('An empty diff must never reach native patch'); // CHANGE
    h.current.setShadowPages = () => {}; h.history.applyRemoteBaseline = () => assert.fail('Empty diff must not recapture history'); // CHANGE
    h.window.Trellis.users.revalidateCurrentSession = () => assert.fail('Empty diff must not revalidate Users'); // CHANGE
    h.bridge.collaborationAction = async () => ({ ok: true, xml: 'equivalent serialization', collaboration: { sessionId: 'local', holds: [], presence: [], reservations: [] } }); // CHANGE
    await timers[0].callback(); await timers[0].callback(); assert.equal(parsed, 1); assert.equal(h.current.data, 'equivalent serialization'); // CHANGE
}); // CHANGE

test('overlapping file notifications and timer ticks serialize reads and reject old-document replies', async t => { // CHANGE
    const timers = [], h = harness(t, { collaboration: true, timers }); await settle(); let complete, gets = 0; // CHANGE
    h.bridge.collaborationAction = async () => { gets++; return new Promise(resolve => { complete = resolve; }); }; // CHANGE
    const tick = timers[0].callback(); await settle(); // CHANGE
    h.ui.handleFileChange({ mtimeMs: 3 }, { mtimeMs: 2 }, h.current); await settle(); assert.equal(gets, 1); // CHANGE
    h.ui.getCurrentFile = () => null; h.editorListeners.get('fileLoaded')(); // CHANGE
    complete({ ok: true, xml: 'old document', collaboration: { sessionId: 'stale', holds: [], presence: [], reservations: [] } }); // CHANGE
    await tick; await settle(); assert.equal(h.calls.some(call => call.apply === 'old document'), false); assert.equal(h.sharing.getInfo(), null); // CHANGE
}); // CHANGE

test('a synchronous batch captures XML once and save completion reuses the native model revision', async t => { // CHANGE
    const listeners = new Map(), model = { addListener: (name, callback) => listeners.set(name, callback), getParent: () => null }; // CHANGE
    const h = harness(t, { collaboration: true, model }); await settle(); let captures = 0; const original = h.ui.getFileData; // CHANGE
    h.ui.getFileData = () => { captures++; return original(); }; h.setXml('batch draft'); // CHANGE
    const event = { getProperty: () => ({ changes: [{ cell: { id: 'bed', style: '' } }] }) }; // CHANGE
    listeners.get('change')(model, event); listeners.get('change')(model, event); assert.equal(captures, 0); // CHANGE
    await settle(); assert.equal(captures, 1); // CHANGE
    captures = 0; await new Promise((resolve, reject) => h.current.save(false, resolve, reject)); assert.equal(captures, 1); // CHANGE
}); // CHANGE

test('asset availability invalidates rendered images without a whole-graph refresh', async t => { // CHANGE
    const h = harness(t); await settle(); const image = { id: 'image' }, ordinary = { id: 'ordinary' }, invalidated = []; let validates = 0; // CHANGE
    h.graph.view = { states: { getValues: () => [{ cell: image, style: { image: 'assets/0123456789abcdef.png' } }, { cell: ordinary, style: {} }] }, invalidate: cell => invalidated.push(cell), validate: () => validates++ }; // CHANGE
    h.graph.refresh = () => assert.fail('Image availability must not refresh the graph'); // CHANGE
    h.state.state = 'syncing'; h.fireStatus(); h.state.state = 'upToDate'; h.fireStatus(); h.fireStatus(); // CHANGE
    assert.deepEqual(invalidated, [image]); assert.equal(validates, 1); // CHANGE
    h.state.folderSequence = 1; h.fireStatus(); h.state.folderSequence = 2; h.fireStatus(); h.fireStatus(); // CHANGE
    assert.deepEqual(invalidated, [image, image]); assert.equal(validates, 2, 'A transfer between idle ticks still refreshes rendered assets exactly once'); // CHANGE
}); // CHANGE

// Save callers observe durability of their requested revision, not merely an earlier queued write. // NEW
test('requests without model revision tracking retain one active and one latest pending capture', async t => { // NEW
    const h = harness(t); await settle(); const captures = [], releases = []; // NEW
    h.bridge.collaborationAction = async input => { if (input.kind === 'save') { captures.push(input.xml); await new Promise(resolve => releases.push(resolve)); } return { ok: true, xml: input.xml, collaboration: { sessionId: 'local', holds: [] } }; }; // NEW
    let completed = 0; h.setXml('first'); h.current.save(false, () => completed++, assert.fail); await settle(); // NEW
    for (const xml of ['second', 'third', 'latest']) { h.setXml(xml); h.current.modified = true; h.current.save(false, () => completed++, assert.fail); } // NEW
    assert.deepEqual(captures, ['first']); releases.shift()(); await settle(); assert.deepEqual(captures, ['first', 'latest']); assert.equal(completed, 1); // NEW
    releases.shift()(); await settle(); assert.equal(completed, 4); assert.equal(h.current.data, 'latest'); // NEW
}); // NEW
test('overlapping collaborative saves share a covered revision and complete every caller once', async t => { // NEW
    const listeners = new Map(), model = { addListener: (name, fn) => listeners.set(name, fn) }; // NEW
    const h = harness(t, { model }); await settle(); h.calls.length = 0; // NEW
    let release, writes = 0; h.bridge.collaborationAction = async input => { // NEW
        if (input.kind === 'save') { writes++; await new Promise(resolve => { release = resolve; }); } // NEW
        return { ok: true, xml: input.xml, collaboration: { sessionId: 'local', holds: [] } }; // NEW
    }; // NEW
    let done = 0; h.current.save(false, () => done++, assert.fail); await settle(); // NEW
    h.current.save(false, () => done++, assert.fail); h.current.save(false, () => done++, assert.fail); // NEW
    assert.equal(writes, 1); assert.equal(done, 0); release(); await settle(); // NEW
    assert.equal(done, 3); assert.equal(writes, 1); assert.equal(h.current.__trellisSaveBatch, null); // NEW
}); // NEW

test('typing after capture receives a later save and does not clear the newer modified draft', async t => { // NEW
    const listeners = new Map(), model = { addListener: (name, fn) => listeners.set(name, fn) }; // NEW
    const h = harness(t, { model }); await settle(); const releases = [], captures = []; // NEW
    h.bridge.collaborationAction = async input => { // NEW
        if (input.kind === 'save') { captures.push(input.xml); await new Promise(resolve => releases.push(resolve)); } // NEW
        return { ok: true, xml: input.xml, collaboration: { sessionId: 'local', holds: [] } }; // NEW
    }; // NEW
    let first = 0, second = 0; h.setXml('first revision'); h.current.save(false, () => first++, assert.fail); await settle(); // NEW
    h.setXml('newer typing'); h.current.modified = true; // NEW
    h.graph.__trellisSharingApplying = true; listeners.get('change')(); h.graph.__trellisSharingApplying = false; // NEW
    h.current.save(false, () => second++, assert.fail); releases.shift()(); await settle(); // NEW
    assert.equal(first, 1); assert.equal(second, 0); assert.equal(h.current.modified, true); // NEW
    assert.deepEqual(captures, ['first revision', 'newer typing']); releases.shift()(); await settle(); // NEW
    assert.equal(second, 1); assert.equal(h.current.modified, false); assert.equal(h.current.data, 'newer typing'); // NEW
}); // NEW

test('a failed coalesced write fails each subscriber once and permits a fresh retry', async t => { // NEW
    const model = { addListener() {} }, h = harness(t, { model }); await settle(); let rejectWrite, failures = 0; // NEW
    h.bridge.collaborationAction = input => input.kind === 'save' ? new Promise((_resolve, reject) => { rejectWrite = reject; }) : Promise.resolve({ ok: true }); // NEW
    h.current.modified = true; h.current.save(false, assert.fail, () => failures++); await settle(); // NEW
    h.current.save(false, assert.fail, () => failures++); rejectWrite(new Error('Disk full')); await settle(); // NEW
    assert.equal(failures, 2); assert.equal(h.current.modified, true); // NEW
    h.bridge.collaborationAction = async input => ({ ok: true, xml: input.xml, collaboration: { holds: [] } }); // NEW
    await new Promise((resolve, reject) => h.current.save(false, resolve, reject)); assert.equal(h.current.modified, false); // NEW
}); // NEW

test('invitation preparation shares the covering save, reports stages, and rejects a document switch', async t => { // NEW
    const model = { addListener() {} }, h = harness(t, { model }); await settle(); let release, blocks = 0, writes = 0; // NEW
    h.bridge.collaborationAction = async input => { writes++; await new Promise(resolve => { release = resolve; }); return { ok: true, xml: input.xml, collaboration: { holds: [] } }; }; // NEW
    h.bridge.createInviteBlock = async () => { blocks++; return { ok: true, block: 'COMPLETE' }; }; // NEW
    const invite = { invite: { id: 'invite' }, code: 'code', emailDraft: { body: 'Hello' } }, stages = []; // NEW
    h.current.save(false, () => {}, assert.fail); await settle(); // NEW
    const preparation = h.sharing.prepareInvite(invite, { onProgress: stage => stages.push(stage) }); await settle(); // NEW
    assert.equal(blocks, 0); release(); assert.equal((await preparation).body, 'Hello\n\nCOMPLETE'); // NEW
    assert.equal(writes, 1); assert.equal(blocks, 1); assert.ok(stages.includes('saving garden')); assert.ok(stages.includes('preparing invitation')); // NEW
    h.current.save = (_revision, success) => { h.ui.getCurrentFile = () => ({}); success(); }; // NEW
    await assert.rejects(h.sharing.prepareInvite(invite), /project changed/i); assert.equal(blocks, 1); // NEW
}); // NEW

test('a prepared invitation releases completed sender holds without another save', async t => { // NEW
    const h = harness(t); await settle(); h.calls.length = 0; // NEW
    const holds = [{ key: '["","1"]', claimId: 'account', sessionId: 'local' }, { key: '["","other"]', claimId: 'foreign', sessionId: 'remote' }]; // NEW
    h.bridge.createInviteBlock = async () => ({ ok: true, block: 'COMPLETE' }); // NEW
    h.bridge.collaborationAction = async input => { h.calls.push({ collaboration: input }); return { ok: true, xml: input.xml, collaboration: { sessionId: 'local', holds: input.kind === 'release' ? [] : holds, presence: [], reservations: [] } }; }; // NEW
    await h.sharing.prepareInvite({ invite: { id: 'invitation' }, code: 'code', emailDraft: { body: 'Hello' } }); // NEW
    assert.equal(h.calls.filter(call => call.collaboration?.kind === 'save').length, 1); assert.deepEqual(Array.from(h.calls.find(call => call.collaboration?.kind === 'release').collaboration.targets), ['["","1"]']); // NEW
}); // NEW

test('native save cancellation rejects invitation preparation without generating its block', async t => { // NEW
    const h = harness(t); await settle(); let blocks = 0; // NEW
    h.current.save = (_revision, _success, _error, _unloading, _overwrite, cancel) => cancel(); // NEW
    h.bridge.createInviteBlock = async () => { blocks++; return { ok: true, block: 'unexpected' }; }; // NEW
    await assert.rejects(h.sharing.prepareInvite({ invite: { id: 'i' }, emailDraft: {} }), /Save cancelled/); assert.equal(blocks, 0); // NEW
}); // NEW

/** The watcher must classify a newly opened managed file before dispatching its first self-write notification. */ // NEW
test('early watcher events await coalesced readiness and Windows paths match the managed project', async t => { // NEW
    const h = harness(t, { explicitRefresh: true }); let release; const gate = new Promise(resolve => { release = resolve; }); // NEW
    h.bridge.getStatus = async () => { await gate; return { canvases: [h.state] }; }; // NEW
    h.current.fileObject.path = 'c:\\SHARED\\canvas.drawio'; // NEW
    const action = h.bridge.collaborationAction; h.bridge.collaborationAction = async input => { const result = await action(input); result.collaboration.policy = { store: { usersEnabled: true, users: [{ id: 'alice', admin: true }] }, cells: [], teams: {} }; return result; }; // NEW
    const ready = h.sharing.whenDocumentReady(), again = h.sharing.whenDocumentReady(); assert.equal(ready, again); // NEW
    const event = h.ui.handleFileChange({ mtimeMs: 2 }, { mtimeMs: 1 }, h.current); await settle(); // NEW
    assert.equal(h.calls.some(call => call.nativeReload), false); release(); await ready; await event; // NEW
    assert.equal(h.calls.some(call => call.nativeReload), false); assert.equal(h.calls.filter(call => call.collaboration?.kind === 'open-view').length, 1); // NEW
}); // NEW

/** External file recovery remains visible and actionable instead of being silently classified as an own write. */ // NEW
test('external projection recovery offers a keyboard-accessible status action bound to the current file', async t => { // NEW
    const h = harness(t); await settle(); const action = h.bridge.collaborationAction; // NEW
    h.bridge.collaborationAction = async input => ({ ...await action(input), projection: { hash: 'verified', externalRecoveryPath: 'private/recovery.drawio' } }); // NEW
    await h.ui.handleFileChange({ mtimeMs: 2 }, { mtimeMs: 1 }, h.current); // NEW
    const notice = h.calls.findLast(call => call.status?.includes('External file changes')); assert.ok(notice); // NEW
    const control = h.ui.statusContainer.querySelector('button'); assert.ok(control); assert.equal(control.type, 'button'); // CHANGE
    control.click(); await settle(); assert.match(h.window.document.body.textContent, /Canvas collaboration/); // NEW
}); // NEW

/** Context invalidation must cancel old waiters even before the initial status request answers. */ // NEW
test('a document switch cancels readiness and drops its delayed watcher event', async t => { // NEW
    const h = harness(t, { explicitRefresh: true }); let release; const gate = new Promise(resolve => { release = resolve; }); // NEW
    h.bridge.getStatus = async () => { await gate; return { canvases: [] }; }; // NEW
    const ready = h.sharing.whenDocumentReady(), rejected = assert.rejects(ready, /document changed/); // NEW
    const watched = h.ui.handleFileChange({ mtimeMs: 2 }, { mtimeMs: 1 }, h.current); await settle(); // NEW
    const next = { ...h.current, fileObject: { path: 'C:/next.drawio' } }; h.ui.getCurrentFile = () => next; h.editorListeners.get('fileLoaded')(); // NEW
    await rejected; await watched; release(); await settle(); // NEW
    assert.equal(h.calls.some(call => call.nativeReload), false); assert.equal(h.calls.some(call => call.status?.includes('document changed')), false); // NEW
    await h.sharing.whenDocumentReady(); // NEW: the replacement ordinary local document can still initialize.
}); // NEW

/** Own-write reconciliation must clear only the obsolete native conflict, retaining private content conflicts. */ // NEW
test('verified watcher reconciliation clears obsolete warnings but preserves unresolved drafts', async t => { // NEW
    const h = harness(t); await settle(); const action = h.bridge.collaborationAction; let status = 'The file has been modified. Click here to synchronize.'; // NEW
    h.window.mxResources = { get: () => status }; h.ui.editor.getStatus = () => status; h.current.inConflictState = true; // NEW
    h.bridge.collaborationAction = async input => ({ ...await action(input), projection: { hash: 'verified' } }); // NEW
    await h.ui.handleFileChange({ mtimeMs: 2 }, { mtimeMs: 1 }, h.current); assert.equal(h.current.inConflictState, false); assert.equal(h.calls.at(-1).status, ''); // NEW
    h.current.inConflictState = true; h.current.__trellisConflict = { draft: true }; h.current.modified = true; h.calls.length = 0; // NEW
    await h.ui.handleFileChange({ mtimeMs: 3 }, { mtimeMs: 2 }, h.current); assert.equal(h.current.inConflictState, true); assert.equal(h.current.modified, true); assert.equal(h.calls.some(call => call.status === ''), false); // NEW
}); // NEW

/** Recorder events can arrive while the native save's export awaits context setup. */ // NEW
test('history export retains its captured saved checkpoint when a newer recorder event arrives', { timeout: 5000 }, async t => { // NEW
    const h = harness(t); await settle(); h.setXml('Saved snapshot'); const saved = { revision: { id: 'saved-only', diagramHistoryId: 'diagram' }, snapshot: {}, xml: 'Saved snapshot' }; // NEW
    h.history.flushForSharing = async () => saved; // NEW
    h.bridge.setContext = async () => h.window.dispatchEvent(new h.window.CustomEvent('trellisHistoryRevisionRecorded', { detail: { revision: { id: 'different-version', diagramHistoryId: 'diagram' }, snapshot: {} } })); // NEW
    let captured, done; const exported = new Promise(resolve => { done = resolve; }); h.bridge.exportHistory = async input => { captured = input; done(); return {}; }; // NEW
    await new Promise((resolve, reject) => h.current.save(false, resolve, reject)); await exported; // NEW
    assert.deepEqual(Array.from(captured.entries, entry => entry.revision.id), ['saved-only']); // NEW
}); // NEW

/** Local native warnings also need an accessible action without admitting controls into document HTML. */ // NEW
test('native synchronization text gets a keyboard control whose callback expires with its file', async t => { // NEW
    const h = harness(t, { localOnly: true }); await settle(); const warning = 'The file has been modified. Click here to synchronize.'; h.window.mxResources = { get: () => warning }; // NEW
    h.ui.editor.setStatus(warning); const control = h.ui.statusContainer.querySelector('button'); assert.ok(control); control.dispatchEvent(new h.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); // NEW
    assert.equal(h.calls.filter(call => call.nativeSynchronize).length, 1); h.ui.getCurrentFile = () => ({}); control.click(); assert.equal(h.calls.filter(call => call.nativeSynchronize).length, 1); // NEW
}); // NEW
