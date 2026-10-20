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
    const info = { protocolVersion: options.collaboration ? 2 : 1, ok: true, managed: true, shareId: 'share', diagramId: 'diagram', diagramPath: 'C:/shared/Canvas.drawio', filename: 'Canvas.drawio', folderPath: 'C:/shared', assetBaseUrl: 'file:///C:/shared/' };
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
        async collaborationAction(input) { calls.push({ collaboration: input }); return { ok: true, xml: input.xml || xml, collaboration: { sessionId: 'local', holds: [], presence: [], reservations: [], recoveries: [], errors: [] } }; }, // NEW
        async listRequests() { return { members: [], requests: [] }; }, // NEW
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
    return { window, calls, current, graph, ui, bridge, history, actions, state, editorListeners, sharing: window.Trellis.sharing, setXml(value) { xml = value; }, setRead(callback) { read = callback; }, originalSaves: () => originalSaves, fireStatus: () => statusListener([state]) }; // CHANGE: expose injected history for asynchronous arrival tests.
}

test('v2 first save uses the signed snapshot rather than an editor-normalized initial document', async t => { // NEW
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

// NEW: Shared projects save durably through the journal, including when the editor preference is off.
test('v2 always autosaves through the journal and never invokes a competing raw file save', async t => { // NEW
    const h = harness(t, { collaboration: true }); await settle(); h.ui.editor.autosave = false; // NEW
    assert.equal(h.current.isAutosave(), true); assert.equal(h.current.isAutosaveOptional(), false); // NEW
    h.setXml('local edits'); h.current.modified = true; // NEW
    await new Promise((resolve, reject) => h.current.save(false, resolve, reject)); // NEW
    assert.equal(h.originalSaves(), 0); assert.equal(h.calls.filter(c => c.collaboration?.kind === 'save').length, 1); assert.equal(h.current.modified, false); // NEW
}); // NEW
test('v2 failed durability leaves the draft modified and reports failure once', async t => { // NEW
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
