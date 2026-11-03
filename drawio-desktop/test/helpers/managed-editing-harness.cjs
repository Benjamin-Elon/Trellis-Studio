/** Shared real-model permissions/collaboration fixture for editor and creation regressions. */ // CHANGE
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'); // CHANGE
const { webcrypto } = require('node:crypto'); // CHANGE
const webapp = path.resolve(__dirname, '../../drawio/src/main/webapp'); // CHANGE
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)); }; // CHANGE
async function fixture(t, quietClock) { // CHANGE
    const h = require('./object-details-harness.cjs')(t), w = h.w, { graph, ui } = h, load = name => w.eval(fs.readFileSync(path.join(webapp, name), 'utf8')); // CHANGE
    ui.actions.addAction = () => ({}); ui.editor.setStatus = () => {}; ui.hideDialog = () => {}; ui.alert = () => {}; ui.watchFile = async () => {}; // CHANGE
    Object.defineProperty(w, 'crypto', { value: webcrypto }); // CHANGE
    for (const name of ['js/trellis-edit-context.js', 'js/trellis-sync-contract.js', 'js/trellis-incoming-changes.js', 'js/trellis-background-saving.js', 'js/trellis-editing-holds.js', 'plugins/garden_planner_plugins/Trellis_Users.js']) load(name); // CHANGE
    if (quietClock) { const create = w.TrellisBackgroundSaving.create; w.TrellisBackgroundSaving = { ...w.TrellisBackgroundSaving, create(options) { const controller = create({ ...options, ...quietClock.options }); quietClock.activity = () => controller.activity(); return controller; } }; } // CHANGE: control only quiet waits; native model/selection/permission events remain real.
    const users = w.Trellis.users; assert.equal(users.enableUsers('Admin', '1111').ok, true); const diagramId = users.getDiagramKey({ create: true }); // CHANGE: persist the document identity before taking the accepted fixture snapshot.
    const { inspectDiagram } = await import('../../src/main/trellis-share-protocol.js'), { permissionSnapshot } = await import('../../src/main/trellis-permission-policy.js'); // CHANGE
    let acceptedXml = ui.getFileData(), revision = 1, activityRevision = 0, onActivity, onStatus, gate = null, pendingSave = null, failure = false, published = [], saveState = 'saved'; const held = new Map(), errors = [], replies = [], activityCalls = [], recoveryCalls = []; // CHANGE: observe the real factory's activity and complete recovery snapshots.
    w.addEventListener('error', event => errors.push(event.error?.stack || event.message)); // CHANGE
    const file = { data: acceptedXml, fileObject: { path: 'C:/test/private.drawio' }, modified: false, isModified() { return this.modified; }, setModified(value) { this.modified = value; }, clearAutosave() {}, contentChanged() {}, saveDraft() {}, fileSaved(_data, _descriptor, done) { done(); }, save() { throw new Error('Managed creation must not use a native fallback save.'); } }; // CHANGE
    ui.getCurrentFile = () => file; ui.setFileData = xml => { const document = w.mxUtils.parseXml(xml); graph.model.setRoot(new w.mxCodec(document).decode(document.documentElement).getRoot()); }; // CHANGE
    w.electron = { request(_input, done) { done({ mtimeMs: 1 }); } }; // CHANGE
    const info = { managed: true, protocolVersion: 4, shareId: 'private', diagramId, diagramPath: file.fileObject.path }; // CHANGE
    const activity = extra => ({ sessionId: 'local', actorUserId: users.getCurrentUser()?.id, observationRevision: ++activityRevision, holds: [...held.values()], presence: [], reservations: [], pendingChanges: published.length ? [{ sessionId: 'local', userId: users.getCurrentUser()?.id, online: true, saveState, targets: published }] : [], ...extra }); // CHANGE
    const policy = () => { const snapshot = permissionSnapshot(inspectDiagram(acceptedXml)); return { store: snapshot.store, cells: Object.values(snapshot.cells), teams: {} }; }; // CHANGE
    const contentState = () => ({ ...activity(), policyRevision: revision, policy: policy(), hash: 'accepted-' + revision }); // CHANGE
    const bridge = w.trellisShare = { // CHANGE
        async setContext() {}, async getStatus() { return { canvases: [{ ...info, state: 'upToDate' }] }; }, async getSyncthingShareInfo() { return info; }, onStatus(fn) { onStatus = fn; }, onActivity(fn) { onActivity = fn; }, // CHANGE
        async importHistory() { return { entries: [] }; }, async recoveryAction(input) { recoveryCalls.push(input); return { ok: true, drafts: [] }; }, async saveRecoveryCopy() { return { recoveryPath: 'private recovery' }; }, // CHANGE
        async activityAction(input) { activityCalls.push(input); if (input.kind === 'claim') for (const key of input.targets || []) held.set(key, { key, claimId: key, sessionId: 'local', expiresAt: Date.now() + 30000 }); if (input.kind === 'release') for (const key of input.targets || [...held.keys()]) { const hold = held.get(key); if (hold?.sessionId === 'local' && (!input.claimIds || input.claimIds.includes(hold.claimId))) held.delete(key); } if (input.kind === 'publish') { published = input.pending; saveState = input.saveState; } return { ok: true, collaboration: activity() }; }, // CHANGE: match production's owner/generation checks; an empty old release cannot remove another session's hold.
        async collaborationAction(input) { // CHANGE
            if (input.kind === 'save') { // CHANGE
                if (failure) throw new Error('Temporary save failure'); acceptedXml = input.xml; revision++; const response = { ok: true, xml: acceptedXml, collaboration: contentState() }; replies.push(response); // CHANGE
                if (gate) { pendingSave = response; await gate.promise; } return response; // CHANGE
            } // CHANGE
            return { ok: true, xml: acceptedXml, groups: [], collaboration: contentState() }; // CHANGE
        } // CHANGE
    }; // CHANGE
    load('plugins/garden_planner_plugins/Trellis_Syncthing.js'); await settle(); // CHANGE
    for (const name of ['Garden_Roadmap_Core.js', 'Garden_Roadmap_Manager.js', 'Garden_Task_Manager.js', 'Modules_Standalone.js']) load('plugins/garden_planner_plugins/' + name); // CHANGE
    assert.equal(users.login('Admin', '1111').ok, true); await settle(); assert.equal(users.isAdmin(), true); // CHANGE: authenticate against the opened file, rather than the fixture's pre-file bootstrap context.
    graph.model.addListener(w.mxEvent.CHANGE, (_sender, event) => { const edit = event.getProperty('edit'); if (!edit?.__trellisUsersRejected && !graph.__trellisSharingApplying) file.modified = true; }); // CHANGE
    const save = () => new Promise((resolve, reject) => file.save(false, resolve, error => reject(new Error(error?.message || String(error))))); // CHANGE
    return { ...h, users, file, bridge, errors, replies, activityCalls, recoveryCalls, held, save, settle, key: cell => JSON.stringify([ui.currentPage?.getId?.() || '', String(cell.id)]), badges: () => [...w.document.querySelectorAll('[data-object-key]')].map(node => ({ key: node.dataset.objectKey, text: node.textContent })), observe(extra) { onActivity({ ...info, collaboration: activity(extra) }); }, create: (type, point = { x: 1000, y: 1000 }) => graph.__trellisModules.createModuleAtPoint(point, type), heartbeat() { onActivity({ ...info, collaboration: activity() }); }, status(state) { onStatus([{ ...info, state: 'upToDate', collaboration: state }]); }, blockSave() { let release; gate = { promise: new Promise(resolve => { release = resolve; }) }; return () => { release(); gate = null; }; }, getPendingSave: () => pendingSave, failSave(value) { failure = value; }, policy }; // CHANGE
} // CHANGE
module.exports = { fixture, settle }; // CHANGE
