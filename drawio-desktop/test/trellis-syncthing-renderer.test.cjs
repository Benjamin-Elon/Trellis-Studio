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
    if (options.trustedInputListeners) { const listen = window.document.addEventListener.bind(window.document); window.document.addEventListener = (type, handler, settings) => { if (type === 'input') options.trustedInputListeners.push(handler); return listen(type, handler, settings); }; } // CHANGE: exercise legacy trusted-input bookkeeping without altering production code.
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../drawio/src/main/webapp/js/trellis-sync-contract.js'), 'utf8'), { globalThis: window }); // NEW: load the production wire contract.
    Object.defineProperty(window, 'crypto', { value: webcrypto });
    const calls = [];
    const actions = new Map();
    const editorListeners = new Map();
    let xml = '<mxGraphModel><root/></mxGraphModel>';
    let read = async () => ({ data: 'remote XML' });
    let statusListener, activityListener; // CHANGE
    let originalSaves = 0;
    const current = {
        data: 'old XML', fileObject: options.unsaved ? null : { path: 'C:/shared/Canvas.drawio', name: 'Canvas.drawio' }, modified: false, stat: { mtimeMs: 1 },
        getTitle: () => 'Canvas.drawio', getData() { return this.data; }, isModified() { return this.modified; }, setModified(value) { this.modified = value; }, clearAutosave() { calls.push({ clearAutosave: true }); },
        fileSaved(saved, descriptor, success) { success(); },
        save(revision, success, error) { originalSaves++; this.data = xml; this.modified = false; this.fileSaved(xml, null, success, error); }
    };
    const info = { protocolVersion: options.localOnly ? 2 : 4, ok: true, managed: !options.localOnly, localOnly: !!options.localOnly, reason: options.localOnly ? 'Sharing is disabled for this old project.' : '', shareId: 'share', diagramId: 'diagram', diagramPath: 'C:/shared/Canvas.drawio', filename: 'Canvas.drawio', folderPath: 'C:/shared', assetBaseUrl: 'file:///C:/shared/' }; // CHANGE
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
    if (options.background) { graph.getModel = () => ({ getRoot: () => null }); current.fileChanged = function () { this.modified = true; }; } // NEW: status tests retain the real controller and file-change hook.
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
    if (options.activity) { bridge.activityAction = async input => { calls.push({ activity: input }); return options.activity(input); }; bridge.onActivity = listener => { activityListener = listener; return () => {}; }; } // CHANGE
    if (options.recovery) bridge.recoveryAction = async input => { calls.push({ privateRecovery: input }); return options.recovery(input); }; // CHANGE
    window.__trellisLiveUpdatesForBenchmark = !options.explicitRefresh; // NEW: existing tests remain the controlled pre-change comparison fixture.
    if (options.explicitRefresh) vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../drawio/src/main/webapp/js/trellis-incoming-changes.js'), 'utf8'), { window, globalThis: window }); // NEW
    window.confirm = () => true;
    window.electron = { request(args, resolve) { resolve({ mtimeMs: 2 }); } };
    window.fsBridge = { readText: filename => read(filename) };
    if (options.timers) window.setInterval = (callback, interval) => { options.timers.push({ callback, interval }); return options.timers.length; }; // CHANGE: exercise real timer callbacks with controlled ticks.
    if (options.editingHolds) vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../drawio/src/main/webapp/js/trellis-editing-holds.js'), 'utf8'), { window }); // NEW
    if (options.model) vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../drawio/src/main/webapp/js/trellis-edit-context.js'), 'utf8'), { window }); // NEW: claims observe real per-change operation classification.
    if (options.background) { // NEW
        vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../drawio/src/main/webapp/js/trellis-background-saving.js'), 'utf8'), { window }); // NEW
        const create = window.TrellisBackgroundSaving.create; options.background.controllers = []; options.background.observers = []; // NEW
        window.TrellisBackgroundSaving = { ...window.TrellisBackgroundSaving, create(settings) { options.background.observers.push(settings.onStatusChange); const controller = create({ ...settings, ...options.background.options }); options.background.controllers.push(controller); return controller; } }; // NEW
    } // NEW
    options.configure?.({ users, bridge, history, graph, ui, info }); // NEW: readiness checks control real asynchronous classification boundaries.
    vm.runInNewContext(fs.readFileSync(plugin, 'utf8'), { window, document: window.document, Draw: { loadPlugin: callback => callback(ui) }, mxEventObject: function (name) { this.name = name; }, URL, TextEncoder, setTimeout, clearTimeout, console, Promise, Set, Map }, { filename: plugin }); // CHANGE
    return { window, calls, current, graph, ui, bridge, users, history, actions, state, editorListeners, sharing: window.Trellis.sharing, setXml(value) { xml = value; }, setRead(callback) { read = callback; }, originalSaves: () => originalSaves, fireStatus: () => statusListener([state]), fireActivity: collaboration => activityListener({ diagramPath: info.diagramPath, shareId: info.shareId, collaboration }) }; // CHANGE
}

test('managed starter saves require confirmation and normal autosave returns after completion', async t => { // CHANGE
    const h = harness(t, { configure: ({ info }) => { info.protocolVersion = 5; } }); // CHANGE
    h.window.TrellisObjectTransactions = { create: () => ({ transaction: () => null }) }; // CHANGE: this fixture exercises save authorization with the full-XML transport fallback.
    await settle(); // CHANGE
    assert.equal(h.current.isAutosave(), true); // CHANGE
    const setup = h.current.__trellisStarterSetup = { isCurrent: () => true }; // CHANGE
    h.current.setModified(true); // CHANGE
    assert.equal(h.current.isAutosave(), false); // CHANGE
    await assert.rejects(new Promise((resolve, reject) => h.current.save(false, resolve, reject)), { message: /Finish Garden Settings/ }); // CHANGE
    assert.equal(h.calls.filter(call => call.collaboration?.kind === 'save').length, 0); // CHANGE
    await new Promise((resolve, reject) => h.current.save(false, resolve, reject, undefined, undefined, undefined, undefined, setup)); // CHANGE
    assert.equal(h.calls.filter(call => call.collaboration?.kind === 'save').length, 1); // CHANGE
    assert.equal(h.originalSaves(), 0); // CHANGE
    delete h.current.__trellisStarterSetup; // CHANGE
    assert.equal(h.current.isAutosave(), true); // CHANGE
}); // CHANGE

/** Exercise the independent IPC lane, rather than only the older content-action fixture. */ // CHANGE
const observation = (revision, holds = [], extra = {}) => ({ observationRevision: revision, actorUserId: 'alice', sessionId: 'local', holds, presence: [], reservations: [], ...extra }); // CHANGE
const activeHold = () => ({ key: '["","a"]', sessionId: 'local', claimId: 'claim-a', expiresAt: null }); // CHANGE: ordinary ownership has no presence-based deadline.
/** Drive a real registered editor through confirmed heartbeat expiry and its action controls. */ // CHANGE
async function releasedEditorHarness(t, options = {}) { // CHANGE
    let revision = 0, holds = [activeHold()], losses = []; // CHANGE
    const snapshot = () => observation(++revision, holds, { losses }); // CHANGE
    const model = { addListener() {}, getRoot: () => null, getCell: () => null, getParent: () => null }; // CHANGE
    const h = harness(t, { explicitRefresh: true, editingHolds: true, model, activity: async () => ({ ok: true, collaboration: snapshot() }), recovery: async input => { if (options.failPreservation && input.kind === 'retain' || options.failRead && input.kind === 'restore') throw new Error('Disk full'); return { ok: true, drafts: [] }; } }); await settle(); // CHANGE
    const form = h.window.document.createElement('section'); form.innerHTML = '<input value="unfinished entry"><button>Save</button>'; h.window.document.body.append(form); let resumed = 0, saved = 0, reopened = 0; // CHANGE
    const editor = h.sharing.registerEditor({ kind: options.kind || 'year-planner', title: 'Year plan', targets: [activeHold().key], element: form, capture: () => ({ pageId: '', objectId: 'a', plan: { text: form.querySelector('input').value } }), resume() { resumed++; }, reopen() { reopened++; }, save() { saved++; return true; }, discard() { form.remove(); } }); // CHANGE
    await editor.acquire(); // CHANGE
    h.bridge.collaborationAction = async input => { // CHANGE
        h.calls.push({ collaboration: input }); // CHANGE
        if (input.kind === 'resume-holds') { // CHANGE
            if (options.resume) return options.resume(input, snapshot); // CHANGE
            holds = [{ ...activeHold(), claimId: 'replacement-claim' }]; losses = []; return { ok: true, collaboration: snapshot() }; // CHANGE
        } // CHANGE
        if (input.kind === 'discard-holds') return { ok: true, xml: options.discardXml || h.ui.getFileData(), discardedKeys: options.discardedKeys || [activeHold().key], collaboration: snapshot() }; // CHANGE
        if (input.kind === 'recover-holds') return { ok: true, xml: h.ui.getFileData(), discardedKeys: [], recoveryPath: 'private.drawio', collaboration: snapshot() }; // CHANGE
        if (input.kind === 'changes') return { ok: true, groups: [], collaboration: snapshot() }; // CHANGE
        if (input.kind === 'review') return { ok: true, groups: [], details: [], token: 'reviewed', collaboration: snapshot() }; // CHANGE
        return { ok: true, xml: h.ui.getFileData(), collaboration: snapshot() }; // CHANGE
    }; // CHANGE
    holds = []; losses = [{ key: activeHold().key, claimId: 'claim-a', code: options.lossCode || 'SESSION_OFFLINE', reason: 'Editing hold released after 30 seconds offline.' }]; h.fireActivity(snapshot()); await settle(); // CHANGE
    return { ...h, form, editor, model, control: id => form.querySelector('[data-trellis-recovery-action="' + id + '"]'), resumed: () => resumed, saved: () => saved, reopened: () => reopened, snapshot }; // CHANGE
} // CHANGE
test('released Year Planner resumes unchanged entries with a new hold and an actionable status link', async t => { // CHANGE
    const h = await releasedEditorHarness(t); assert.equal(h.editor.frozen(), true); assert.equal(h.control('resume').disabled, false); // CHANGE
    const status = h.calls.filter(call => call.callback).at(-1); assert.ok(status); status.callback(); assert.equal(h.window.document.activeElement, h.control('resume')); // CHANGE
    h.control('resume').click(); h.control('resume').click(); await settle(); // CHANGE
    assert.equal(h.resumed(), 1); assert.equal(h.saved(), 0); assert.equal(h.editor.frozen(), false); assert.equal(h.form.querySelector('input').value, 'unfinished entry'); assert.equal(h.form.querySelector('input').readOnly, false); // CHANGE
    const request = h.calls.find(call => call.collaboration?.kind === 'resume-holds').collaboration; assert.equal(request.baseXml, '<mxGraphModel><root/></mxGraphModel>'); assert.deepEqual(Array.from(request.claimIds), ['claim-a']); // CHANGE
    assert.equal(h.calls.filter(call => call.collaboration?.kind === 'resume-holds').length, 1); // CHANGE
}); // CHANGE
test('changed inputs or another hold refuse resume without losing entries and retain review actions', async t => { // CHANGE
    for (const code of ['EDITING_INPUTS_CHANGED', 'EDITING_BUSY']) await t.test(code, async t => { // CHANGE
        const h = await releasedEditorHarness(t, { resume: async (_input, snapshot) => ({ ok: false, code, reason: 'Review the current object before continuing.', blocked: code === 'EDITING_BUSY' ? [{ key: activeHold().key, sessionId: 'peer' }] : [], collaboration: snapshot() }) }); // CHANGE
        h.control('resume').click(); await settle(); assert.equal(h.editor.frozen(), true); assert.equal(h.form.querySelector('input').value, 'unfinished entry'); assert.equal(h.form.querySelector('input').readOnly, true); assert.match(h.form.textContent, /Review the current object/); assert.ok(h.control('review')); // CHANGE
        if (code === 'EDITING_BUSY') assert.ok(h.control('blocker')); // CHANGE
    }); // CHANGE
}); // CHANGE
test('handoff and access losses do not offer a resume shortcut', async t => { // CHANGE
    for (const lossCode of ['HANDOFF_EXPIRED', 'ACCESS_CHANGED', 'CONCURRENT_EDITOR']) await t.test(lossCode, async t => { const h = await releasedEditorHarness(t, { lossCode }); assert.equal(h.control('resume').disabled, true); assert.equal(h.control('review').disabled, false); }); // CHANGE
}); // CHANGE
test('review without incoming changes offers a fresh editor rather than silently applying the retained draft', async t => { // CHANGE
    const h = await releasedEditorHarness(t); h.model.getCell = () => ({ id: 'a' }); // CHANGE
    h.control('review').click(); await settle(); const next = [...h.window.document.querySelectorAll('button')].find(button => button.textContent === 'Open fresh editor'); assert.ok(next); assert.equal(next.disabled, false); // CHANGE
    next.click(); await settle(); assert.equal(h.reopened(), 1); assert.equal(h.saved(), 0); assert.equal(h.form.isConnected, false); // CHANGE
}); // CHANGE
test('failed preservation can discard only listed work with no new preservation attempt or confirmation', async t => { // CHANGE
    const h = await releasedEditorHarness(t, { failPreservation: true }); assert.equal(h.control('resume').disabled, true); assert.equal(h.control('discard').disabled, false); assert.match(h.form.textContent, /Discard affects these objects and related changes/); // CHANGE
    const writes = h.calls.filter(call => call.privateRecovery?.kind === 'retain').length; h.control('discard').click(); await settle(); // CHANGE
    assert.equal(h.form.isConnected, false); assert.equal(h.calls.filter(call => call.privateRecovery?.kind === 'retain').length, writes); assert.equal(h.calls.some(call => call.collaboration?.kind === 'recover-holds'), false); assert.equal(h.calls.some(call => call.confirmation), false); // CHANGE
}); // CHANGE
test('stored draft read failures cannot hide in-memory retained entries', async t => { // CHANGE
    const h = await releasedEditorHarness(t, { failPreservation: true, failRead: true }); await h.sharing.showSharingDialog(); const drafts = [...h.window.document.querySelectorAll('button')].find(button => button.textContent === 'Private recovery drafts'); drafts.click(); await settle(); // CHANGE
    const panel = h.window.document.querySelector('[aria-label="Private recovery drafts"]'); assert.ok(panel); assert.match(panel.textContent, /Stored drafts could not be read/); assert.match(panel.querySelector('textarea').value, /unfinished entry/); // CHANGE
}); // CHANGE
test('a delayed resume reply cannot enable an editor after its author changes', async t => { // CHANGE
    let reply; const h = await releasedEditorHarness(t, { resume: (_input, snapshot) => new Promise(resolve => { reply = () => resolve({ ok: true, collaboration: snapshot() }); }) }); // CHANGE
    h.control('resume').click(); await settle(); h.users.getCurrentUser = () => ({ id: 'bob' }); reply(); await settle(); assert.equal(h.resumed(), 0); assert.equal(h.editor.frozen(), true); // CHANGE
}); // CHANGE
test('latest-saved recovery uses normal file loading and preserves the saving block after a failed load', async t => { // CHANGE
    const h = harness(t, { explicitRefresh: true, model: { addListener() {}, getRoot: () => null, getCell: () => null } }); await settle(); const saved = h.ui.getFileData(), current = h.current; let loaded = null, failed = true; // CHANGE
    h.window.LocalFile = class { constructor(_ui, xml, title) { this.data = xml; this.title = title; } setModified(value) { this.modified = value; } }; // CHANGE
    h.ui.fileLoaded = async replacement => { if (failed) throw new Error('Renderer still unavailable'); loaded = replacement; }; // CHANGE
    h.sharing.retainFailedCommit('Editor rollback failed. Saving is blocked.'); // CHANGE
    const context = h.graph.__trellisEditContext; await assert.rejects(h.sharing.openLatestSavedVersion(), /Renderer still unavailable/); assert.equal(h.ui.getCurrentFile(), current); assert.equal(h.ui.getFileData(), saved); // CHANGE
    failed = false; await h.sharing.openLatestSavedVersion(); assert.ok(loaded); assert.equal(loaded.fileObject, current.fileObject); assert.equal(loaded.data, saved); assert.equal(loaded.modified, false); // CHANGE
    assert.ok(context); // CHANGE
}); // CHANGE

test('automation hold activity is boolean for absent, connected and disconnected legacy forms', async t => { // CHANGE
    let revision = 10; const trustedInputListeners = [], h = harness(t, { trustedInputListeners, activity: async () => ({ ok: true, collaboration: observation(++revision, [activeHold()]) }) }); await settle(); // CHANGE
    h.fireActivity(observation(++revision, [activeHold(), { ...activeHold(), key: '["","peer"]', sessionId: 'other-window', userId: 'alice' }])); // CHANGE
    assert.deepEqual(Array.from(h.sharing.automationHolds(), hold => hold.active), [false, false]); // CHANGE
    const form = h.window.document.createElement('section'); form.setAttribute('role', 'dialog'); form.innerHTML = '<input>'; h.window.document.body.append(form); // CHANGE
    h.graph.getSelectionCells = () => [{ id: 'a' }]; // CHANGE
    for (const handler of trustedInputListeners) handler({ target: form.firstChild, isTrusted: true }); // CHANGE
    assert.equal(h.sharing.automationHolds()[0].active, true); // CHANGE
    form.remove(); assert.equal(h.sharing.automationHolds()[0].active, false); // CHANGE
    assert.ok(h.sharing.automationHolds().every(hold => typeof hold.active === 'boolean')); // CHANGE
}); // CHANGE

test('registered editor completion leaves pending local holds inactive before persistence', async t => { // CHANGE
    let revision = 10; const h = harness(t, { editingHolds: true, activity: async () => ({ ok: true, collaboration: observation(++revision, [activeHold()]) }) }); await settle(); // CHANGE
    const form = h.window.document.createElement('section'); h.window.document.body.append(form); // CHANGE
    const editor = h.sharing.registerEditor({ kind: 'planting', element: form, targets: [activeHold().key], capture: () => ({}), save: async () => true, discard() {} }); // CHANGE
    await editor.acquire(); assert.equal(h.sharing.automationHolds()[0].active, true); // CHANGE
    const completing = editor.complete(); assert.equal(h.sharing.automationHolds()[0].active, false); // CHANGE
    assert.equal(h.sharing.automationHolds()[0].local, true); await completing; editor.dispose(); // CHANGE
}); // CHANGE

test('an initialized empty pending index avoids reading planting dependencies during hover checks', async t => { // NEW
    let ancestryReads = 0; const model = { getRoot: () => null, getCell: () => null, getParent() { ancestryReads++; return null; } }; // NEW
    const h = harness(t, { explicitRefresh: true, model }); await settle(); // NEW
    const cell = { id: 'idle-circle', getAttribute() { assert.fail('No pending targets require dependency attributes.'); }, get style() { assert.fail('No pending targets require planting-style parsing.'); } }; // NEW
    for (let i = 0; i < 100; i++) assert.equal(h.sharing.isPendingCell(cell), false); // NEW
    assert.equal(ancestryReads, 0); // NEW: occupied-bed permission checks share this path for every generated circle.
}); // NEW

/** Real status controls with injectable session observations and a visible graph object. */ // CHANGE
async function activityStatusHarness(t, options = {}) { // CHANGE
    let revision = 0, reported = { holds: [], presence: [], pendingChanges: [] }; // CHANGE
    const snapshot = () => observation(++revision, reported.holds, reported); // CHANGE
    const cell = { id: 'a', getAttribute: name => name === 'label' ? 'Emitter 30.5 cm' : null }; // CHANGE
    const model = { getRoot: () => null, getCell: id => id === 'a' ? cell : null }; // CHANGE
    const h = harness(t, { ...options, model, activity: async input => options.activity ? options.activity(input, snapshot) : { ok: true, collaboration: snapshot() } }); // CHANGE
    h.graph.view = { getState: () => ({ x: 10, y: 10, width: 80, height: 120 }) }; await settle(); // CHANGE
    return { ...h, report(next) { reported = { ...reported, ...next }; h.fireActivity(snapshot()); }, snapshot, dialog: () => h.window.document.querySelector('[aria-label="Activity for Emitter 30.5 cm"]'), open() { h.window.document.querySelector('[data-object-key]').click(); }, control(label) { return [...h.window.document.querySelectorAll('button')].find(button => !button.hidden && button.textContent === label); } }; // CHANGE
} // CHANGE
const pendingActivity = (extra = {}) => ({ userId: 'alice', name: 'Alice', sessionId: 'local', online: true, saveState: 'pending', targets: ['["","a"]'], ...extra }); // CHANGE

test('activity badges keep full opaque labels over a translucent fill and open only on activation', async t => { // CHANGE
    const h = await activityStatusHarness(t); h.report({ pendingChanges: [pendingActivity()] }); // CHANGE
    const badge = h.window.document.querySelector('[data-object-key]'); // CHANGE
    assert.equal(badge.textContent, 'Alice · changed · pending project save'); assert.equal(badge.hasAttribute('title'), false); // CHANGE
    assert.match(badge.getAttribute('aria-label'), /Emitter 30.5 cm: Alice/); assert.equal(badge.getAttribute('aria-haspopup'), 'dialog'); // CHANGE
    const style = h.window.getComputedStyle(badge); assert.equal(style.backgroundColor, 'rgba(255, 255, 255, 0.5)'); assert.equal(style.opacity, ''); // CHANGE
    assert.equal(style.color, 'rgb(37, 99, 235)'); assert.equal(style.borderTopColor, 'rgb(37, 99, 235)'); // CHANGE
    badge.dispatchEvent(new h.window.MouseEvent('mouseenter')); badge.focus(); assert.equal(h.dialog(), null); // CHANGE
    badge.click(); await settle(); const panel = h.dialog(); assert.ok(panel); assert.equal(badge.getAttribute('aria-expanded'), 'true'); // CHANGE
    assert.equal(panel.parentNode, h.window.document.body); assert.equal(h.window.getComputedStyle(panel).position, 'fixed'); // CHANGE
    assert.equal(h.window.getComputedStyle(panel).zIndex, '10030'); // CHANGE: activity details use the nonmodal top-control layer.
    assert.equal(h.window.getComputedStyle(panel).backgroundColor, 'rgb(255, 255, 255)'); // CHANGE
    badge.dispatchEvent(new h.window.MouseEvent('mouseleave')); panel.dispatchEvent(new h.window.MouseEvent('mouseleave')); // CHANGE
    await new Promise(resolve => setTimeout(resolve, 120)); assert.equal(h.dialog(), panel); // CHANGE
    badge.click(); await settle(); assert.equal(h.dialog(), null); assert.equal(badge.getAttribute('aria-expanded'), 'false'); // CHANGE
    badge.click(); await settle(); assert.ok(h.dialog()); assert.equal(badge.getAttribute('aria-expanded'), 'true'); // CHANGE: the third click reopens details.
    assert.equal(h.window.getComputedStyle(h.dialog()).zIndex, '10030'); // CHANGE
}); // CHANGE

test('activity details restore the current badge on Close or Escape and let outside clicks proceed', async t => { // CHANGE
    const h = await activityStatusHarness(t); h.report({ pendingChanges: [pendingActivity()] }); h.open(); await settle(); // CHANGE
    const original = h.window.document.querySelector('[data-object-key]'), panel = h.dialog(); // CHANGE
    h.report({ pendingChanges: [pendingActivity({ saveState: 'failed' })] }); // CHANGE
    const badge = h.window.document.querySelector('[data-object-key]'); assert.notEqual(badge, original); assert.equal(h.dialog(), panel); // CHANGE
    assert.equal(h.window.getComputedStyle(panel).zIndex, '10030'); // CHANGE: live updates retain the correct layer.
    assert.equal(badge.getAttribute('aria-expanded'), 'true'); h.control('Close').click(); await settle(); // CHANGE
    assert.equal(h.dialog(), null); assert.equal(h.window.document.activeElement, badge); // CHANGE
    h.open(); await settle(); const escape = new h.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }); // CHANGE
    h.window.document.activeElement.dispatchEvent(escape); assert.equal(escape.defaultPrevented, true); // CHANGE
    assert.equal(h.dialog(), null); assert.equal(h.window.document.activeElement, badge); // CHANGE
    const outside = h.window.document.createElement('button'); h.window.document.body.append(outside); let clicks = 0, pointerEvents = 0; // CHANGE
    outside.addEventListener('click', () => { clicks++; }); outside.addEventListener('pointerdown', () => { pointerEvents++; }); // CHANGE
    h.open(); await settle(); const down = new h.window.Event('pointerdown', { bubbles: true, cancelable: true }); // CHANGE
    outside.dispatchEvent(down); outside.focus(); outside.click(); assert.equal(h.dialog(), null); // CHANGE
    assert.equal(down.defaultPrevented, false); assert.equal(pointerEvents, 1); assert.equal(clicks, 1); assert.equal(h.window.document.activeElement, outside); // CHANGE
    h.open(); await settle(); outside.focus(); outside.dispatchEvent(new h.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); // CHANGE
    assert.equal(h.dialog(), null); assert.equal(h.window.document.activeElement, badge); // CHANGE
}); // CHANGE

test('clicking another activity badge switches directly without outside dismissal or graph input', async t => { // CHANGE
    const h = await activityStatusHarness(t), model = h.graph.getModel(); // CHANGE
    h.graph.getModel = () => ({ ...model, getCell: id => id === 'b' ? { id, getAttribute: name => name === 'label' ? 'Other planting' : null } : model.getCell(id) }); // CHANGE
    h.report({ presence: [{ userId: 'bob', name: 'Bob', sessionId: 'remote', targets: ['["","a"]', '["","b"]'] }] }); // CHANGE
    const [first, second] = h.window.document.querySelectorAll('[data-object-key]'); let graphEvents = 0; // CHANGE
    for (const type of ['pointerdown', 'mousedown', 'click', 'keydown', 'keyup']) h.graph.container.addEventListener(type, () => { graphEvents++; }); // CHANGE
    first.click(); await settle(); const panel = h.dialog(); // CHANGE
    second.dispatchEvent(new h.window.Event('pointerdown', { bubbles: true })); assert.equal(h.dialog(), panel); // CHANGE
    second.click(); await settle(); assert.equal(h.dialog(), null); // CHANGE
    assert.ok(h.window.document.querySelector('[aria-label="Activity for Other planting"]')); // CHANGE
    assert.equal(first.getAttribute('aria-expanded'), 'false'); assert.equal(second.getAttribute('aria-expanded'), 'true'); // CHANGE
    second.dispatchEvent(new h.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); // CHANGE
    assert.equal(h.window.document.querySelector('[aria-label="Activity for Other planting"]'), null); assert.equal(graphEvents, 0); // CHANGE
}); // CHANGE

test('pending-only object status updates automatically without a refresh control or content changes', async t => { // CHANGE
    const h = await activityStatusHarness(t); h.report({ pendingChanges: [pendingActivity({ userId: 'bob', name: 'Bob', sessionId: 'old', online: false })] }); h.open(); // CHANGE
    const panel = h.dialog(); assert.match(panel.textContent, /Bob last reported changed.*current save status is unknown/); assert.match(panel.textContent, /this notice does not block editing/); assert.match(panel.textContent, /only be checked by its author/); // CHANGE
    assert.equal(h.control('Request release'), undefined); assert.equal(h.control('Save now'), undefined); // CHANGE
    h.state.connectedCollaborators = 0; h.fireStatus(); assert.match(panel.textContent, /Working locally\. No other computers are connected/); assert.doesNotMatch(panel.textContent, /holds are unconfirmed/); // CHANGE
    assert.equal(h.control('Refresh status'), undefined); const start = h.calls.length; // CHANGE
    h.report({ pendingChanges: [] }); await settle(); assert.equal(h.dialog(), panel); assert.equal(panel.querySelector('[data-editing-status]').textContent, 'No viewing activity, pending changes, or editing holds are currently reported for this object.'); assert.ok(h.control('Close')); // CHANGE
    assert.equal(h.calls.slice(start).some(call => call.apply || call.collaboration || call.activity), false); // CHANGE
}); // CHANGE
test('live object rows preserve focused actions while independent sessions and ownership change', async t => { // CHANGE
    const h = await activityStatusHarness(t, { recovery: async () => ({ ok: true, drafts: [] }) }); // CHANGE
    h.report({ pendingChanges: [pendingActivity(), pendingActivity({ sessionId: 'older', deviceId: 'peer', online: false, saveState: 'failed' })], holds: [{ ...activeHold(), userId: 'bob', name: 'Bob', sessionId: 'remote', deviceId: 'peer', online: false }] }); h.open(); // CHANGE
    const save = h.control('Save now'); save.focus(); const panel = h.dialog(); // CHANGE
    assert.match(panel.textContent, /your other session.*last reported save failed/); assert.match(panel.textContent, /disconnected or presence unconfirmed/); assert.ok(h.control('Request release')); assert.ok(h.control('Check private recovery drafts')); // CHANGE
    h.report({ pendingChanges: [pendingActivity({ saveState: 'failed' }), pendingActivity({ sessionId: 'older', deviceId: 'peer', online: false, saveState: 'failed' })] }); // CHANGE
    assert.equal(h.control('Retry save'), save); assert.equal(h.window.document.activeElement, save); // CHANGE
    h.report({ pendingChanges: [pendingActivity({ saveState: 'conflict' })] }); assert.equal(h.control('Review changes'), save); assert.equal(h.window.document.activeElement, save); // CHANGE
    h.report({ pendingChanges: [], holds: [] }); assert.equal(h.dialog(), panel); assert.equal(h.window.document.activeElement, h.control('Close')); // CHANGE
}); // CHANGE
test('same-user different-device activity cannot save this window even if its session ID matches', async t => { // CHANGE
    const h = await activityStatusHarness(t, { recovery: async () => ({ ok: true, drafts: [] }) }); h.sharing.getInfo().deviceId = 'this-device'; // CHANGE
    h.report({ pendingChanges: [pendingActivity({ deviceId: 'another-device' })] }); h.open(); // CHANGE
    assert.equal(h.control('Save now'), undefined); assert.ok(h.control('Check private recovery drafts')); assert.match(h.dialog().textContent, /your other session/); // CHANGE
    h.control('Check private recovery drafts').click(); await settle(); assert.ok(h.calls.some(call => call.privateRecovery?.kind === 'restore')); assert.match(h.window.document.body.textContent, /No pending private drafts/); // CHANGE
}); // CHANGE
test('status save actions retain failures, coalesce clicks and reuse project-wide persistence for retry', async t => { // CHANGE
    const h = await activityStatusHarness(t); h.current.modified = true; h.report({ pendingChanges: [pendingActivity()] }); h.open(); // CHANGE
    let fail; h.bridge.collaborationAction = async input => { h.calls.push({ collaboration: input }); return new Promise((_resolve, reject) => { fail = reject; }); }; // CHANGE
    assert.match(h.dialog().textContent, /Saves all committed pending changes in this window/); // CHANGE
    const save = h.control('Save now'); save.click(); save.click(); await settle(); assert.equal(h.calls.filter(call => call.collaboration?.kind === 'save').length, 1); assert.equal(save.disabled, true); assert.equal(h.control('Refresh status'), undefined); // CHANGE
    fail(new Error('Disk unavailable')); await settle(); assert.match(h.dialog().querySelector('[data-status]').textContent, /Disk unavailable/); assert.equal(h.current.modified, true); // CHANGE
    h.report({ pendingChanges: [pendingActivity({ saveState: 'failed' })] }); assert.match(h.dialog().textContent, /Disk unavailable/); // CHANGE
    h.bridge.collaborationAction = async input => { h.calls.push({ collaboration: input }); return { ok: true, xml: input.xml, collaboration: h.snapshot() }; }; // CHANGE
    h.control('Retry save').click(); await settle(); assert.equal(h.current.modified, false); assert.equal(h.calls.filter(call => call.collaboration?.kind === 'save').length, 2); // CHANGE
    h.report({ pendingChanges: [] }); assert.match(h.dialog().textContent, /No viewing activity, pending changes, or editing holds/); // CHANGE
}); // CHANGE
test('status actions use existing conflict review and uncertain-ownership handoff workflows', async t => { // CHANGE
    const h = await activityStatusHarness(t); h.report({ pendingChanges: [pendingActivity({ saveState: 'conflict' })] }); h.open(); // CHANGE
    h.bridge.collaborationAction = async input => { h.calls.push({ collaboration: input }); return { ok: true, review: { groups: [], token: 'review' } }; }; // CHANGE
    h.control('Review changes').click(); await settle(); assert.ok(h.calls.some(call => call.collaboration?.kind === 'draft-review')); assert.equal(h.dialog(), null); // CHANGE
    h.report({ pendingChanges: [], holds: [{ ...activeHold(), userId: 'bob', name: 'Bob', sessionId: 'remote', online: false }] }); h.open(); // CHANGE
    h.control('Request release').click(); await settle(); assert.ok(h.calls.some(call => call.activity?.kind === 'request')); // CHANGE
    h.report({ holds: [{ ...activeHold(), userId: 'alice', name: 'Alice' }] }); h.control('Release now').click(); await settle(); assert.ok(h.calls.some(call => call.activity?.kind === 'release')); // CHANGE
}); // CHANGE
test('overview and object dialog share pending descriptions and retain focused controls on updates', async t => { // CHANGE
    const h = await activityStatusHarness(t); h.report({ pendingChanges: [pendingActivity({ userId: 'bob', name: 'Bob', sessionId: 'old', online: false })] }); h.open(); // CHANGE
    const description = h.dialog().querySelector('[data-activity-description]').textContent; await h.sharing.showSharingDialog(); assert.ok(h.window.document.body.textContent.includes(description)); // CHANGE
    h.report({ pendingChanges: [pendingActivity()] }); const save = h.control('Save now'); save.focus(); h.report({ pendingChanges: [pendingActivity({ saveState: 'failed' })] }); assert.equal(h.control('Retry save'), save); assert.equal(h.window.document.activeElement, save); // CHANGE
}); // CHANGE
test('failed hold requests and stale observations retain notices; author changes invalidate pending actions', async t => { // CHANGE
    const h = await activityStatusHarness(t, { explicitRefresh: true }); h.report({ pendingChanges: [pendingActivity()], holds: [{ ...activeHold(), sessionId: 'peer', userId: 'bob', name: 'Bob' }] }); h.open(); const panel = h.dialog(); // CHANGE
    let rejectStatus; h.bridge.activityAction = () => new Promise((_resolve, reject) => { rejectStatus = reject; }); h.control('Request release').click(); await settle(); // CHANGE
    rejectStatus(new Error('Activity unavailable')); await settle(); assert.match(panel.querySelector('[data-status]').textContent, /Activity unavailable/); assert.ok(h.control('Save now')); // CHANGE
    h.fireActivity(observation(0)); assert.ok(h.control('Save now')); // CHANGE
    let complete; h.bridge.activityAction = () => new Promise(resolve => { complete = resolve; }); h.control('Request release').click(); await settle(); // CHANGE
    h.users.getCurrentUser = () => ({ id: 'bob' }); h.window.dispatchEvent(new h.window.Event('trellisUsersSessionChanged')); assert.equal(h.dialog(), null); // CHANGE
    const count = h.calls.length; complete({ ok: true, collaboration: h.snapshot() }); await settle(); assert.equal(panel.isConnected, false); assert.equal(h.calls.slice(count).some(call => call.status?.includes('context changed')), false); // CHANGE
}); // CHANGE
test('hidden or detached status controls cannot submit after saving begins or the document changes', async t => { // CHANGE
    const h = await activityStatusHarness(t); h.report({ pendingChanges: [pendingActivity()] }); h.open(); const save = h.control('Save now'); // CHANGE
    h.report({ pendingChanges: [pendingActivity({ saveState: 'saving' })] }); assert.equal(save.hidden, true); const before = h.calls.length; save.click(); await settle(); // CHANGE
    assert.equal(h.calls.slice(before).some(call => call.collaboration || call.activity?.kind === 'release'), false); // CHANGE
    h.report({ pendingChanges: [pendingActivity()] }); h.editorListeners.get('fileLoaded')(); await settle(); assert.equal(h.dialog(), null); // CHANGE
    const afterLoad = h.calls.length; save.click(); await settle(); assert.equal(h.calls.slice(afterLoad).some(call => call.collaboration || call.activity), false); // CHANGE
}); // CHANGE
test('viewing and next-turn reports remain independent from pending work and actual holds', async t => { // CHANGE
    const h = await activityStatusHarness(t), viewer = { userId: 'bob', name: 'Bob', sessionId: 'viewer', online: true, targets: ['["","a"]'] }; // CHANGE
    h.report({ presence: [viewer] }); h.open(); assert.match(h.dialog().textContent, /Bob is viewing/); assert.equal(h.control('Request release'), undefined); assert.equal(h.control('Save now'), undefined); // CHANGE
    h.report({ presence: [], pendingChanges: [pendingActivity()], reservations: [{ userId: 'bob', name: 'Bob', sessionId: 'viewer', key: '["","a"]', until: Date.now() + 30000 }] }); // CHANGE: the service removes expired viewers while retaining independent activity.
    assert.doesNotMatch(h.dialog().textContent, /viewing|presence is unconfirmed/); assert.match(h.dialog().textContent, /has the next editing turn/); assert.ok(h.control('Save now')); assert.equal(h.control('Request release'), undefined); // CHANGE
}); // CHANGE

test('automatic viewing expiry removes the badge and leaves open details and focus intact until reconnection', async t => { // CHANGE
    const h = await activityStatusHarness(t), viewer = { userId: 'bob', name: 'Bob', sessionId: 'viewer', online: true, targets: ['["","a"]'] }; // CHANGE
    h.report({ presence: [viewer] }); h.open(); const panel = h.dialog(), close = h.control('Close'), start = h.calls.length; // CHANGE
    assert.equal(h.window.document.activeElement, close); assert.equal(h.control('Refresh status'), undefined); // CHANGE
    h.report({ presence: [] }); await settle(); // CHANGE: simulate the service's existing timed activity notification, without user interaction.
    assert.equal(h.window.document.querySelector('[data-object-key]'), null); assert.equal(h.dialog(), panel); assert.equal(h.window.document.activeElement, close); // CHANGE
    assert.equal(panel.querySelector('[data-editing-status]').textContent, 'No viewing activity, pending changes, or editing holds are currently reported for this object.'); assert.doesNotMatch(panel.textContent, /Bob/); // CHANGE
    assert.equal(h.calls.slice(start).some(call => call.activity || call.collaboration || call.apply), false); // CHANGE
    h.report({ presence: [viewer] }); assert.equal(h.dialog(), panel); assert.match(panel.textContent, /Bob is viewing/); // CHANGE
    const badge = h.window.document.querySelector('[data-object-key]'); assert.equal(badge.getAttribute('aria-expanded'), 'true'); // CHANGE
    close.click(); assert.equal(h.dialog(), null); assert.equal(h.window.document.activeElement, badge); // CHANGE
}); // CHANGE

test('automatic viewing expiry updates the Sharing overview while preserving pending-work rows and focused actions', async t => { // CHANGE
    const h = await activityStatusHarness(t, { recovery: async () => ({ ok: true, drafts: [] }) }), viewer = { userId: 'bob', name: 'Bob', sessionId: 'viewer', online: true, targets: ['["","a"]'] }; // CHANGE
    h.report({ presence: [viewer], pendingChanges: [pendingActivity(), pendingActivity({ sessionId: 'old', deviceId: 'peer', online: false, saveState: 'failed' })] }); // CHANGE
    await h.sharing.showSharingDialog(); const overview = h.window.document.querySelector('[aria-label="Canvas collaboration"]'); // CHANGE
    const save = [...overview.querySelectorAll('button')].find(button => button.textContent === 'Save now'); save.focus(); // CHANGE
    assert.match(overview.textContent, /Bob is viewing/); h.report({ presence: [] }); // CHANGE
    assert.doesNotMatch(overview.textContent, /Bob is viewing|last reported viewing/); assert.equal(h.window.document.activeElement, save); // CHANGE
    assert.ok([...overview.querySelectorAll('button')].some(button => button.textContent === 'Check private recovery drafts')); assert.match(overview.textContent, /last reported save failed/); // CHANGE
    const badge = h.window.document.querySelector('[data-object-key]'); assert.ok(badge); assert.doesNotMatch(badge.textContent, /viewing/); assert.match(badge.textContent, /pending project save|save failed/); // CHANGE
}); // CHANGE

/** Drive the real countdown and quiet waits without waiting twenty wall-clock seconds. */ // NEW
async function countdownHarness(t) { // NEW
    let time = 0, sequence = 0, composing = false, revision = 0; const timers = new Map(); // NEW
    const background = { options: { now: () => time, busy: () => composing, setInterval(fn, delay) { timers.set(++sequence, { fn, delay }); return sequence; }, clearInterval(id) { timers.delete(id); }, setTimeout(fn, delay) { timers.set(++sequence, { fn, at: time + delay }); return sequence; }, clearTimeout(id) { timers.delete(id); } } }; // NEW
    const h = harness(t, { background, explicitRefresh: true, activity: async () => ({ ok: true, collaboration: observation(++revision) }), recovery: async () => ({ ok: true, drafts: [] }) }); await settle(); // NEW
    const controller = background.controllers.at(-1), heartbeat = [...timers.values()].find(timer => timer.delay === 5000).fn; // NEW
    t.after(() => { for (const value of background.controllers) value.dispose(); }); // NEW
    return { ...h, background, controller, timers, heartbeat, status: () => h.ui.statusContainer.textContent, edit() { h.current.fileChanged(); controller.changed(); }, compose(value) { composing = value; controller.activity(); }, async advance(duration) { time += duration; for (const [id, timer] of [...timers]) if (timer.at <= time) { timers.delete(id); timer.fn(); } heartbeat(); await settle(); } }; // NEW
} // NEW

test('save countdown refreshes at five seconds, rounds up, and restarts on edits and typing', async t => { // NEW
    const h = await countdownHarness(t); h.edit(); assert.equal(h.status(), 'Changes waiting to save · 20 seconds remaining'); // NEW
    assert.deepEqual([...h.timers.values()].map(timer => timer.delay), [5000, 10000]); await h.advance(5000); assert.equal(h.status(), 'Changes waiting to save · 15 seconds remaining'); // NEW
    await h.advance(5321); assert.equal(h.status(), 'Changes waiting to save · 10 seconds remaining'); h.controller.activity(); assert.match(h.status(), /20 seconds remaining$/); // NEW
    await h.advance(19001); assert.equal(h.status(), 'Changes waiting to save · 1 second remaining'); await h.advance(999); assert.equal(h.status(), 'Preparing to save…'); // NEW
    h.edit(); assert.match(h.status(), /20 seconds remaining$/); h.compose(true); await h.advance(30000); assert.equal(h.status(), 'Waiting for editing to finish…'); h.compose(false); assert.match(h.status(), /20 seconds remaining$/); // NEW
}); // NEW

test('countdown refreshes and edits preserve warning text and actionable status controls', async t => { // NEW
    const h = await countdownHarness(t); h.edit(); h.ui.editor.setStatus('Recovery checkpoint failed: Disk full'); await h.advance(5000); h.controller.activity(); h.current.fileChanged(); assert.equal(h.status(), 'Recovery checkpoint failed: Disk full'); // NEW
    let clicked = false; h.ui.editor.setStatus('Review conflicting changes', () => { clicked = true; }); await h.advance(30000); const control = h.ui.statusContainer.querySelector('button'); assert.ok(control); control.click(); assert.equal(clicked, true); assert.equal(h.status(), 'Review conflicting changes'); // NEW
    h.controller.state('conflict'); h.heartbeat(); assert.equal(h.status(), 'Review conflicting changes'); // NEW
}); // NEW

test('native saved status yields to the next countdown and failed saves retain their error through ticks', async t => { // NEW
    const h = await countdownHarness(t); h.current.allChangesSavedKey = 'allChangesSaved'; h.window.mxResources = { get: key => key === 'allChangesSaved' ? 'All changes saved' : null }; // NEW
    h.ui.editor.setStatus('All changes saved'); h.edit(); assert.match(h.status(), /20 seconds remaining$/); // NEW
    h.bridge.collaborationAction = async () => { throw new Error('Disk unavailable'); }; // NEW
    await new Promise(resolve => h.current.save(false, () => assert.fail('Save must fail'), error => { h.ui.editor.setStatus(error.message); resolve(); })); // NEW
    assert.equal(h.status(), 'Disk unavailable'); await h.advance(5000); assert.equal(h.status(), 'Disk unavailable'); assert.equal(h.current.modified, true); // NEW
}); // NEW

test('retained conflict state cannot freeze owned save progress for subsequent edits', async t => { // NEW
    const h = await countdownHarness(t); h.edit(); let release; const gate = new Promise(resolve => { release = resolve; }); // NEW
    h.bridge.collaborationAction = async input => { await gate; return { ok: true, xml: input.xml, collaboration: observation(100) }; }; // NEW
    const saving = new Promise((resolve, reject) => h.current.save(false, resolve, reject)); await settle(); h.setXml('new changes'); h.edit(); release(); await saving; // NEW
    h.current.__trellisConflict = true; h.controller.state('conflict'); h.edit(); await h.advance(5000); assert.match(h.status(), /15 seconds remaining$/); // NEW
    h.ui.editor.setStatus('Conflicting changes are preserved. Use Sharing → Review local changes.'); h.edit(); await h.advance(5000); assert.match(h.status(), /^Conflicting changes are preserved/); // NEW
}); // NEW

test('manual save skips the countdown and an active save retains progress while newer edits wait', async t => { // NEW
    const h = await countdownHarness(t); h.edit(); let release; const gate = new Promise(resolve => { release = resolve; }); // NEW
    h.bridge.collaborationAction = async input => { await gate; return { ok: true, xml: input.xml, collaboration: observation(100) }; }; // NEW
    const saving = new Promise((resolve, reject) => h.current.save(false, resolve, reject)); await settle(); assert.equal(h.status(), 'Saving…'); // NEW
    h.setXml('newer edits during capture'); h.edit(); await h.advance(5000); assert.equal(h.status(), 'Saving…'); release(); await saving; await settle(); assert.match(h.status(), /15 seconds remaining$/); // NEW
    await new Promise((resolve, reject) => h.current.save(false, resolve, reject)); assert.equal(h.status(), ''); assert.equal(h.current.modified, false); await h.advance(5000); assert.equal(h.status(), ''); // NEW
}); // NEW

test('quiet expiry shows editing access until the automatic save can submit', async t => { // NEW
    const h = await countdownHarness(t); h.edit(); let release; const gate = new Promise(resolve => { release = resolve; }); // NEW
    h.current.__trellisNamingSync = gate; h.current.isAutosaveNow(); const saving = new Promise((resolve, reject) => h.current.save(false, resolve, reject)); await settle(); assert.match(h.status(), /20 seconds remaining$/); // NEW
    await h.advance(20000); assert.equal(h.status(), 'Waiting for editing access…'); assert.equal(h.calls.some(call => call.collaboration?.kind === 'save'), false); release(); await saving; assert.equal(h.status(), ''); // NEW
}); // NEW

test('undo and author or document invalidation clear countdown ownership and reject stale callbacks', async t => { // NEW
    const h = await countdownHarness(t); h.edit(); h.current.modified = false; h.controller.changed(); assert.equal(h.status(), ''); await h.advance(5000); assert.equal(h.status(), ''); // NEW
    h.edit(); const oldObserver = h.background.observers.at(-1); h.users.getCurrentUser = () => ({ id: 'bob' }); h.window.dispatchEvent(new h.window.Event('trellisUsersSessionChanged')); await settle(); assert.equal(h.status().includes('seconds remaining'), false); // NEW
    h.ui.editor.setStatus('New author notice'); oldObserver(); h.controller.activity(); assert.equal(h.status(), 'New author notice'); // NEW
    h.ui.editor.setStatus(''); h.current.modified = true; h.background.controllers.at(-1).changed(); assert.match(h.status(), /20 seconds remaining$/); // NEW
    const previousDocumentObserver = h.background.observers.at(-1); h.editorListeners.get('fileLoaded')(); h.ui.editor.setStatus('New document notice'); previousDocumentObserver(); await settle(); assert.equal(h.status(), 'New document notice'); // NEW
}); // NEW
test('a save adopts its newer permission policy even when its activity observation is older than a heartbeat', async t => { // CHANGE
    const h = harness(t, { explicitRefresh: true, activity: async () => ({ ok: true, collaboration: observation(100) }) }); await settle(); h.fireActivity(observation(40)); h.setXml('created module'); h.current.modified = true; // CHANGE
    const policy = { store: { usersEnabled: false, users: [] }, cells: [{ key: '["","new-module"]', attributes: { label: 'Created' } }] }; // CHANGE
    h.bridge.collaborationAction = async input => ({ ok: true, xml: input.xml, collaboration: observation(30, [], { policyRevision: 2, policy }) }); // CHANGE
    await new Promise((resolve, reject) => h.current.save(false, resolve, reject)); assert.equal(h.graph.__trellisSharedPolicy.policyRevision, 2); assert.ok(h.graph.__trellisSharedPolicy.cells.has('["","new-module"]')); // CHANGE
    h.state.collaboration = observation(50, [], { policyRevision: 1, policy: { ...policy, cells: [] } }); h.fireStatus(); await settle(); assert.equal(h.graph.__trellisSharedPolicy.policyRevision, 2); // CHANGE
    h.state.collaboration = observation(51, [], { actorUserId: 'bob', policyRevision: 3, policy: { ...policy, cells: [] } }); h.fireStatus(); await settle(); assert.equal(h.graph.__trellisSharedPolicy.policyRevision, 2); // CHANGE
}); // CHANGE
test('unversioned durable claims cannot become native activity holds during startup', async t => { // CHANGE
    const h = harness(t, { explicitRefresh: true, editingHolds: true, activity: async () => ({ ok: true, collaboration: observation(30) }) }); await settle(); // CHANGE
    h.state.collaboration = { sessionId: 'local', holds: [activeHold()], presence: [], reservations: [] }; h.fireStatus(); h.fireActivity(observation(20)); await settle(); // CHANGE
    assert.equal(h.calls.some(call => call.activity?.kind === 'snapshot' || call.collaboration?.kind === 'recover-holds'), false); // CHANGE
}); // CHANGE
test('older empty transport status cannot lose a freshly observed activity hold', async t => { // CHANGE
    const h = harness(t, { explicitRefresh: true, editingHolds: true, activity: async () => ({ ok: true, collaboration: observation(30, [activeHold()]) }) }); await settle(); // CHANGE
    h.fireActivity(observation(20, [activeHold()])); h.state.collaboration = observation(19); h.fireStatus(); await settle(); // CHANGE
    assert.equal(h.calls.some(call => call.activity?.kind === 'snapshot' || call.collaboration?.kind === 'recover-holds'), false); assert.equal(h.window.document.querySelector('[data-trellis-frozen]'), null); // CHANGE
}); // CHANGE
test('fresh confirmation cancels suspected loss when a heartbeat already restored ownership', async t => { // CHANGE
    const h = harness(t, { explicitRefresh: true, editingHolds: true, activity: async () => ({ ok: true, collaboration: observation(30, [activeHold()]) }) }); await settle(); // CHANGE
    h.fireActivity(observation(20, [activeHold()])); h.fireActivity(observation(21)); await settle(); // CHANGE
    assert.equal(h.calls.filter(call => call.activity?.kind === 'snapshot').length, 1); assert.equal(h.calls.some(call => call.collaboration?.kind === 'recover-holds'), false); // CHANGE
}); // CHANGE
test('disconnected presence keeps an unrequested editor writable without recovery or a countdown', async t => { // CHANGE
    let revision = 30; const timers = [], hold = { ...activeHold(), online: false }; // CHANGE
    const h = harness(t, { explicitRefresh: true, editingHolds: true, timers, activity: async () => ({ ok: true, collaboration: observation(++revision, [hold]) }) }); await settle(); // CHANGE
    const form = h.window.document.createElement('section'); form.innerHTML = '<textarea>unfinished schedule</textarea>'; h.window.document.body.append(form); // CHANGE
    const editor = h.sharing.registerEditor({ kind: 'planting', element: form, targets: [hold.key], capture: () => ({ notes: form.firstChild.value }), save: async () => true, discard() { assert.fail('A disconnected editor must remain open'); } }); // CHANGE
    await editor.acquire(); h.fireActivity(observation(++revision, [hold], { sessions: [{ sessionId: 'local', online: false }] })); // CHANGE
    for (let tick = 0; tick < 400; tick++) for (const timer of timers.filter(timer => timer.interval === 1000)) timer.callback(); // CHANGE
    await editor.acquire(); await settle(); // CHANGE
    assert.equal(editor.frozen(), false); assert.equal(form.firstChild.readOnly, false); assert.equal(form.firstChild.value, 'unfinished schedule'); // CHANGE
    assert.equal(h.window.document.querySelector('[data-trellis-hold-countdown]'), null); // CHANGE
    assert.equal(h.calls.some(call => call.privateRecovery?.kind === 'retain' || call.collaboration?.kind === 'recover-holds'), false); // CHANGE
}); // CHANGE
test('sharing shows disconnected ownership separately from the requested release deadline', async t => { // CHANGE
    const hold = { ...activeHold(), sessionId: 'peer', name: 'Bob', online: false, requested: true, requestDeadline: Date.now() + 300000, expiresAt: Date.now() + 300000 }; // CHANGE
    const h = harness(t, { activity: async () => ({ ok: true, collaboration: observation(30, [hold]) }) }); await settle(); // CHANGE
    h.fireActivity(observation(40, [hold])); await h.sharing.showSharingDialog(); // CHANGE
    const text = h.window.document.body.textContent; assert.match(text, /disconnected or presence unconfirmed/); assert.match(text, /Release requested\. Editing ends in/); assert.match(text, /automatically releases after thirty seconds without a fresh session heartbeat/); // CHANGE
}); // CHANGE
test('failed confirmation leaves the graph and editors unchanged and reports unconfirmed status', async t => { // CHANGE
    const h = harness(t, { explicitRefresh: true, activity: async () => { throw new Error('Status offline'); } }); await settle(); // CHANGE
    h.setXml('unchanged local draft'); h.current.modified = true; h.fireActivity(observation(20, [activeHold()])); h.fireActivity(observation(21)); await settle(); // CHANGE
    assert.equal(h.ui.getFileData(), 'unchanged local draft'); assert.equal(h.calls.some(call => call.collaboration?.kind === 'recover-holds'), false); assert.ok(h.calls.some(call => call.status?.includes('Editing status unconfirmed'))); // CHANGE
}); // CHANGE
test('confirmed offline loss retains and freezes original fields before graph rollback; repeated reports do not discard them', async t => { // CHANGE
    const loss = { key: activeHold().key, claimId: activeHold().claimId, code: 'SESSION_OFFLINE', reason: 'Editing hold released after 30 seconds offline.' }; // CHANGE
    const h = harness(t, { explicitRefresh: true, editingHolds: true, activity: async () => ({ ok: true, collaboration: observation(30, [], { losses: [loss] }) }), recovery: async () => ({ ok: true }) }); await settle(); // CHANGE
    const form = h.window.document.createElement('section'); form.dataset.collaborationObjectId = 'a'; form.innerHTML = '<input name="notes" value="unfinished entry"><input type="password" value="never retain">'; h.window.document.body.append(form); // CHANGE
    h.setXml('rejected graph draft'); h.current.modified = true; h.bridge.collaborationAction = async input => { h.calls.push({ collaboration: input }); return { ok: true, xml: 'accepted graph', discardedKeys: ['["","a"]'], recoveryPath: 'private.drawio', collaboration: observation(31) }; }; // CHANGE
    h.fireActivity(observation(20, [activeHold()])); h.fireActivity(observation(21)); await settle(); // CHANGE
    const retained = h.calls.find(call => call.privateRecovery?.kind === 'retain').privateRecovery; assert.equal(retained.editorDrafts[0].fields.length, 1); assert.equal(retained.editorDrafts[0].fields[0].value, 'unfinished entry'); // CHANGE
    assert.equal(retained.reason, 'Editing hold released after 30 seconds offline.'); assert.match(form.textContent, /30 seconds offline/); // CHANGE
    assert.equal(h.ui.getFileData(), 'accepted graph'); assert.equal(form.querySelector('input').value, 'unfinished entry'); assert.equal(form.querySelector('input').readOnly, true); assert.match(form.textContent, /Private recovery draft saved/); // CHANGE
    h.fireActivity(observation(32)); await settle(); assert.equal(h.calls.filter(call => call.privateRecovery?.kind === 'retain').length, 1); assert.ok(form.isConnected); // CHANGE
}); // CHANGE
test('offline loss retention failure defers rollback and retry uses the same immutable loss identity', async t => { // CHANGE
    const losses = [{ key: activeHold().key, claimId: activeHold().claimId, code: 'SESSION_OFFLINE', reason: 'The session heartbeat expired. Reopen the editor after reviewing the preserved draft.' }]; // CHANGE
    let failing = true; const h = harness(t, { explicitRefresh: true, editingHolds: true, activity: async () => ({ ok: true, collaboration: observation(30, [], { losses }) }), recovery: async () => { if (failing) throw new Error('Disk full'); return { ok: true }; } }); await settle(); // CHANGE
    const form = h.window.document.createElement('section'); form.dataset.collaborationObjectId = 'a'; form.innerHTML = '<textarea>keep this</textarea>'; h.window.document.body.append(form); h.setXml('local graph'); h.current.modified = true; // CHANGE
    h.fireActivity(observation(20, [activeHold()])); h.fireActivity(observation(21)); await settle(); assert.equal(h.ui.getFileData(), 'local graph'); assert.equal(h.calls.some(call => call.collaboration?.kind === 'recover-holds'), false); assert.match(form.textContent, /Disk full/); // CHANGE
    failing = false; form.querySelector('[data-trellis-recovery-action=retry]').click(); await settle(); const attempts = h.calls.filter(call => call.privateRecovery?.kind === 'retain'); assert.equal(attempts.length, 2); assert.equal(attempts[0].privateRecovery.lossId, attempts[1].privateRecovery.lossId); // CHANGE
}); // CHANGE
test('activity for a previous author and out-of-order action replies cannot replace current ownership', async t => { // CHANGE
    const h = harness(t, { explicitRefresh: true, activity: async () => ({ ok: true, collaboration: observation(30) }) }); await settle(); h.fireActivity(observation(20, [activeHold()])); // CHANGE
    h.fireActivity(observation(25, [], { actorUserId: 'bob', sessionId: 'other-session' })); h.state.collaboration = observation(19); h.fireStatus(); await settle(); assert.equal(h.calls.some(call => call.activity?.kind === 'snapshot'), false); // CHANGE
}); // CHANGE
test('native label loss keeps the original text node available for review and closing it unblocks the object', async t => { // CHANGE
    const cell = { id: 'a' }, model = { addListener() {}, getCell: () => cell, getParent: () => null }; // CHANGE
    const h = harness(t, { explicitRefresh: true, editingHolds: true, model, activity: async () => ({ ok: true, collaboration: observation(30) }), recovery: async () => ({ ok: true }) }); await settle(); // CHANGE
    const field = h.window.document.createElement('div'); field.setAttribute('contenteditable', 'true'); field.innerHTML = '<p>Unsubmitted label</p>'; h.window.document.body.append(field); h.graph.cellEditor = { editingCell: cell, textarea: field }; h.graph.stopEditing = cancel => { assert.equal(cancel, true); field.remove(); h.graph.cellEditor.editingCell = null; }; // CHANGE
    h.fireActivity(observation(20, [activeHold()])); h.fireActivity(observation(21)); await settle(); // CHANGE
    const panel = h.window.document.querySelector('[aria-label="Retained label draft"]'); assert.ok(panel); assert.equal(panel.querySelector('[contenteditable]'), field); assert.equal(field.textContent, 'Unsubmitted label'); assert.equal(field.contentEditable, 'false'); // CHANGE
    const retained = h.calls.find(call => call.privateRecovery?.kind === 'retain').privateRecovery; assert.equal(retained.editorDrafts[0].kind, 'label'); assert.equal(retained.editorDrafts[0].text, 'Unsubmitted label'); // CHANGE
    [...panel.querySelectorAll('button')].find(button => button.textContent === 'Close').click(); assert.equal(panel.isConnected, false); assert.equal(h.sharing.isPendingCell(cell), false); // CHANGE
}); // CHANGE
test('an older claim refusal cannot replace a newer confirmed activity hold', async t => { // CHANGE
    let finish; const h = harness(t, { explicitRefresh: true, editingHolds: true, activity: input => input.kind === 'claim' ? new Promise(resolve => { finish = resolve; }) : Promise.resolve({ ok: true, collaboration: observation(50, [activeHold()]) }) }); await settle(); // CHANGE
    const editor = h.sharing.registerEditor({ kind: 'inventory', targets: ['["","a"]'], capture: () => ({ notes: 'draft' }), save: async () => true, discard: () => assert.fail('A delayed claim cannot discard the draft') }); // CHANGE
    const acquired = editor.acquire(); await settle(); h.fireActivity(observation(40, [activeHold()])); finish({ ok: false, reason: 'Stale competing hold', collaboration: observation(30) }); await acquired; await settle(); // CHANGE
    assert.equal(editor.active(), true); assert.equal(editor.frozen(), false); assert.equal(h.calls.some(call => call.activity?.kind === 'snapshot' || call.collaboration?.kind === 'recover-holds'), false); // CHANGE
}); // CHANGE
test('a confirmation older than an intervening heartbeat cannot freeze the restored editor', async t => { // CHANGE
    let finish; const h = harness(t, { explicitRefresh: true, editingHolds: true, activity: () => new Promise(resolve => { finish = resolve; }) }); await settle(); // CHANGE
    h.fireActivity(observation(20, [activeHold()])); h.fireActivity(observation(21)); await settle(); h.fireActivity(observation(30, [activeHold()])); finish({ ok: true, collaboration: observation(25) }); await settle(); // CHANGE
    assert.equal(h.calls.some(call => call.collaboration?.kind === 'recover-holds'), false); assert.equal(h.window.document.querySelector('[data-trellis-frozen]'), null); // CHANGE
}); // CHANGE
test('verified access loss captures private fields before author teardown and ignores the old confirmation', async t => { // CHANGE
    const h = harness(t, { explicitRefresh: true, editingHolds: true, activity: async () => ({ ok: true, collaboration: observation(30) }), recovery: async () => ({ ok: true }) }); await settle(); // CHANGE
    const panel = h.window.document.createElement('section'); panel.dataset.collaborationObjectId = 'a'; panel.innerHTML = '<textarea>private to Alice</textarea>'; h.window.document.body.append(panel); // CHANGE
    h.fireActivity(observation(20, [activeHold()])); h.fireActivity(observation(21, [], { losses: [{ key: '["","a"]', code: 'ACCESS_CHANGED', reason: 'Your access changed.' }] })); // CHANGE
    const retained = h.calls.find(call => call.privateRecovery?.kind === 'retain').privateRecovery; assert.equal(retained.expectedUserId, 'alice'); assert.equal(retained.editorDrafts[0].fields[0].value, 'private to Alice'); // CHANGE
    h.users.getCurrentUser = () => ({ id: 'bob' }); h.window.dispatchEvent(new h.window.CustomEvent('trellisUsersSessionChanged')); await settle(); // CHANGE
    assert.equal(panel.isConnected, false); assert.equal(h.calls.some(call => call.collaboration?.kind === 'recover-holds'), false); // CHANGE
}); // CHANGE
test('private loss preservation starts while an in-flight save is still settling and never rolls back its acceptance', async t => { // CHANGE
    let finish; const h = harness(t, { explicitRefresh: true, editingHolds: true, activity: async () => ({ ok: true, collaboration: observation(30) }), recovery: async () => ({ ok: true }) }); await settle(); // CHANGE
    h.fireActivity(observation(20, [activeHold()])); h.setXml('accepted pending save'); h.current.modified = true; h.bridge.collaborationAction = input => input.kind === 'save' ? new Promise(resolve => { finish = resolve; }) : Promise.resolve({ ok: true, xml: h.ui.getFileData(), collaboration: observation(31) }); // CHANGE
    const saved = new Promise((resolve, reject) => h.current.save(false, resolve, reject)); await settle(); h.fireActivity(observation(21)); await settle(); // CHANGE
    assert.ok(h.calls.some(call => call.privateRecovery?.kind === 'retain')); assert.ok(h.calls.some(call => call.activity?.kind === 'release')); assert.equal(h.current.modified, true); // CHANGE
    finish({ ok: true, xml: 'accepted pending save', collaboration: observation(32) }); await saved; await settle(); assert.equal(h.current.modified, false); assert.equal(h.ui.getFileData(), 'accepted pending save'); // CHANGE
}); // CHANGE
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

test('lost parent holds freeze their nested native dialog without changing an unrelated top dialog', async t => { // CHANGE
    const a = { id: 'a' }, child = { id: 'child-a', parent: a }, b = { id: 'b' }, cells = new Map([a, child, b].map(cell => [cell.id, cell]));
    const model = { addListener() {}, getCell: id => cells.get(id), getParent: cell => cell.parent || null }, h = harness(t, { explicitRefresh: true, model, editingHolds: true }); await settle(); // CHANGE
    const make = id => { const container = h.window.document.createElement('div'); container.className = 'geDialog'; const input = h.window.document.createElement('input'); input.dataset.collaborationObjectId = id; container.appendChild(input); h.window.document.body.appendChild(container); return { container, close(cancel) { assert.equal(cancel, true); container.remove(); return true; } }; };
    const affected = make('child-a'), unrelated = make('b'); h.ui.dialogs = [affected, unrelated]; h.ui.dialog = unrelated;
    h.ui.editor.fireEvent = event => h.calls.push({ event: event.name }); h.ui.hideDialog = () => assert.fail('The unrelated top dialog must stay open');
    h.state.collaboration = { holds: [{ key: '["","a"]', claimId: 'held-a', sessionId: 'local' }], presence: [], reservations: [] }; h.fireStatus();
    h.state.collaboration = { holds: [], presence: [], reservations: [] }; h.fireStatus();
    await settle(); assert.equal(affected.container.isConnected, true); assert.equal(unrelated.container.isConnected, true); assert.equal(h.ui.dialog, unrelated); // CHANGE
    assert.equal(h.ui.dialogs.length, 2); assert.equal(affected.container.querySelector('input').readOnly, true); assert.equal(unrelated.container.querySelector('input').readOnly, false); assert.match(affected.container.textContent, /Read-only; you can copy your entries/); // CHANGE
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

test('saved history delegates published ancestry to transport without scanning private history', async t => { // CHANGE
    const h = harness(t);
    await settle();
    h.bridge.importHistory = async () => ({ entries: [{ revision: { id: 'published' } }] });
    h.fireStatus();
    await settle();
    h.history.list = () => { throw new Error('Saving must not scan private revision ancestry.'); }; // CHANGE
    h.history.flushForSharing = async () => ({ revision: { id: 'saved', diagramHistoryId: 'diagram', parentRevisionId: 'private' }, snapshot: {} });
    await new Promise((resolve, reject) => h.current.save(false, resolve, reject));
    for (let i = 0; i < 100 && !h.calls.some(call => call.export); i++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(h.calls.find(call => call.export).export.entries[0].revision.parentRevisionId, 'private'); // CHANGE: the transport assigns its indexed published parent before signing.
});

test('saving with storage details open does not request recursive archive accounting', async t => { // NEW
    const h = harness(t); await settle(); let inspections = 0; // NEW
    const details = h.window.document.createElement('details'); details.className = 'trellis-history-storage-details'; details.open = true; h.window.document.body.appendChild(details); // NEW
    h.bridge.historyStorage = async () => { inspections++; throw new Error('Unexpected archive inspection during save'); }; // NEW
    const lastInspection = {historyBytes:1234}; h.graph.__ccSharedHistoryStorage = lastInspection; // NEW
    await new Promise((resolve,reject) => h.current.save(false,resolve,reject)); await h.sharing.whenHistoryPublished(); // NEW
    assert.equal(inspections,0); assert.equal(h.graph.__ccSharedHistoryStorage,lastInspection); // NEW
}); // NEW

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

test('managed comment settlement promotes a waiting autosave and exposes discussion from the completed save', async t => { // NEW
    const completed = [], background = {}; let revision = 0; // NEW
    const h = harness(t, { background, explicitRefresh: true, activity: async () => ({ ok: true, collaboration: observation(++revision) }), recovery: async () => ({ ok: true }), configure({ graph, info }) { // NEW
        const window = graph.container.ownerDocument.defaultView; // NEW
        info.protocolVersion = window.TrellisSyncContract.garden; // NEW
        window.mxUtils = { parseXml: xml => new window.DOMParser().parseFromString(xml, 'text/xml') }; // NEW
        window.Editor = { parseDiagramNode: node => node.firstElementChild }; // NEW
        window.TrellisObjectTransactions = { create: () => ({ transaction: () => null }) }; // NEW: structural saves use the same completion path with full XML.
        graph.fireEvent = event => completed.push(event.name); // NEW
    } }); // NEW
    t.after(() => { for (const controller of background.controllers) controller.dispose(); }); // NEW
    await settle(); assert.notEqual(h.sharing.commentSaveContext(), null); // NEW
    const raw = '{"version":2,"comments":[]}'; // NEW
    const xml = '<mxfile><diagram id="page-a"><mxGraphModel><root><object id="shape" label="Committed" trellis_comments_json=\'' + raw + '\'><mxCell/></object></root></mxGraphModel></diagram><diagram id="page-b"><mxGraphModel><root><mxCell id="shape"/></root></mxGraphModel></diagram></mxfile>'; // NEW
    h.setXml(xml); h.current.fileChanged(); background.controllers.at(-1).changed(); // NEW
    h.current.__trellisAutomaticRequest = true; // NEW
    const automatic = new Promise((resolve, reject) => h.current.save(false, resolve, reject)); // NEW
    await settle(); assert.equal(h.calls.filter(call => call.collaboration?.kind === 'save').length, 0); // NEW
    await h.sharing.settleObjectEdits(); await automatic; // NEW
    const saves = h.calls.filter(call => call.collaboration?.kind === 'save'); // NEW
    assert.equal(saves.length, 1); assert.equal(saves[0].collaboration.xml, xml); // NEW
    assert.equal(h.sharing.savedDiscussion('page-a', 'shape'), raw); // NEW
    assert.equal(h.sharing.savedDiscussion('page-b', 'shape'), ''); // NEW
    assert.equal(h.sharing.savedDiscussion('page-a', 'missing'), null); // NEW
    assert.deepEqual(completed, ['trellisManagedSaveCompleted']); // NEW

    const requests = []; // NEW
    h.bridge.collaborationAction = input => new Promise(resolve => requests.push({ input, resolve })); // NEW
    const previousSave = h.sharing.settleObjectEdits(); await settle(); assert.equal(requests.length, 1); // NEW
    const nextRaw = raw.replace('"version":2', '"version":1'), nextXml = xml.replace(raw, nextRaw); // NEW
    h.setXml(nextXml); h.current.fileChanged(); // NEW
    const commentSave = h.sharing.settleObjectEdits(); await settle(); assert.equal(requests.length, 1); // NEW
    requests[0].resolve({ ok: true, xml, collaboration: observation(++revision) }); await previousSave; await settle(); // NEW
    assert.equal(requests.length, 2); assert.equal(requests[1].input.xml, nextXml); // NEW
    requests[1].resolve({ ok: true, resolution: { baseXml: xml, remainingXml: nextXml, remaining: ['["page-a","shape"]'], review: { groups: [] } }, collaboration: observation(++revision) }); // NEW
    await commentSave; // NEW
    assert.equal(h.ui.getFileData(), nextXml); assert.equal(h.sharing.savedDiscussion('page-a', 'shape'), raw); // NEW: partial acceptance leaves the staged discussion outside the saved baseline.
}); // NEW
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
/** Exercise both a rejected edit and real newer content across the same accepted partial-save boundary. */ // NEW
for (const newerContent of [false, true]) test('partial acceptance advances its baseline across ' + (newerContent ? 'newer typing' : 'a rejected edit'), async t => { // NEW
    const listeners = new Map(), model = { addListener: (name, fn) => listeners.set(name, fn) }, h = harness(t, { model }); await settle(); // NEW
    let release; const submissions = []; // NEW
    h.bridge.collaborationAction = async input => { // NEW
        if (input.kind === 'save') { // NEW
            submissions.push({ baseXml: input.baseXml, xml: input.xml }); // NEW
            if (submissions.length === 1) { await new Promise(resolve => { release = resolve; }); return { ok: true, resolution: { baseXml: 'accepted partial baseline', remainingXml: 'submitted draft', remaining: ['*'], review: { groups: [] } }, collaboration: { sessionId: 'local', holds: [] } }; } // NEW
            return { ok: false, reason: 'Diagnostic retry retained', collaboration: { sessionId: 'local', holds: [] } }; // NEW
        } // NEW
        return { ok: true, xml: input.xml, collaboration: { sessionId: 'local', holds: [] } }; // NEW
    }; // NEW
    h.setXml('submitted draft'); h.current.modified = true; const saving = new Promise((resolve, reject) => h.current.save(false, resolve, reject)); await settle(); // NEW
    if (newerContent) { h.setXml('newer typing'); h.graph.__trellisSharingApplying = true; listeners.get('change')(); h.graph.__trellisSharingApplying = false; } // NEW
    else listeners.get('change')(null, { getProperty: () => ({ __trellisUsersRejected: true, changes: [{ cell: { id: 'a' } }] }) }); // NEW
    release(); await saving; await settle(); await new Promise(resolve => h.current.save(false, resolve, resolve)); // NEW
    assert.equal(submissions[1].baseXml, 'accepted partial baseline'); assert.equal(submissions[1].xml, newerContent ? 'newer typing' : 'submitted draft'); // NEW
    assert.equal(h.current.modified, true); // NEW
}); // NEW
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

test('opening readiness waits for login restoration but permits an unauthenticated managed garden', async t => { // NEW
    let classify, restore; // NEW
    const h = harness(t, { configure({ users, bridge, info }) { // NEW
        info.protocolVersion = 5; users.getCurrentUser = () => null; // NEW
        users.whenLoginRestored = () => new Promise(resolve => { restore = resolve; }); // NEW
        bridge.getStatus = () => new Promise(resolve => { classify = resolve; }); // NEW
    } }); // NEW
    await settle(); let finished = false; const opening = h.sharing.whenOpenReady().then(() => { finished = true; }); // NEW
    await settle(); assert.equal(finished, false); restore(); await settle(); assert.equal(finished, false); // NEW
    classify({ canvases: [h.state] }); await opening; assert.equal(finished, true); // NEW
    assert.equal(h.calls.some(call => call.collaboration), false); // NEW
}); // NEW
test('opening readiness reports classification errors and cancels obsolete document waiters', async t => { // NEW
    const h = harness(t, { configure({ bridge }) { bridge.getStatus = async () => { throw new Error('Access setup failed'); }; } }); // NEW
    await settle(); await assert.rejects(h.sharing.whenOpenReady(), /Access setup failed/); // NEW
    let classify; h.bridge.getStatus = () => new Promise(resolve => { classify = resolve; }); // NEW
    const opening = h.sharing.whenOpenReady(); const rejected = assert.rejects(opening, /changed during opening/); // NEW
    await settle(); h.editorListeners.get('fileLoaded')(); await rejected; classify({ canvases: [] }); await settle(); // NEW
}); // NEW
