/** Real mxGraph factories, user guards and sharing orchestration; only IPC timing is controlled. */ // CHANGE
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'); // CHANGE
const { webcrypto } = require('node:crypto'); // CHANGE
const webapp = path.resolve(__dirname, '../drawio/src/main/webapp'); // CHANGE
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)); }; // CHANGE
async function fixture(t, quietClock) { // CHANGE
    const h = require('./helpers/object-details-harness.cjs')(t), w = h.w, { graph, ui } = h, load = name => w.eval(fs.readFileSync(path.join(webapp, name), 'utf8')); // CHANGE
    ui.actions.addAction = () => ({}); ui.editor.setStatus = () => {}; ui.hideDialog = () => {}; ui.alert = () => {}; ui.watchFile = async () => {}; // CHANGE
    Object.defineProperty(w, 'crypto', { value: webcrypto }); // CHANGE
    for (const name of ['js/trellis-edit-context.js', 'js/trellis-sync-contract.js', 'js/trellis-incoming-changes.js', 'js/trellis-background-saving.js', 'js/trellis-editing-holds.js', 'plugins/garden_planner_plugins/Trellis_Users.js']) load(name); // CHANGE
    if (quietClock) { const create = w.TrellisBackgroundSaving.create; w.TrellisBackgroundSaving = { ...w.TrellisBackgroundSaving, create(options) { const controller = create({ ...options, ...quietClock.options }); quietClock.activity = () => controller.activity(); return controller; } }; } // CHANGE: control only quiet waits; native model/selection/permission events remain real.
    const users = w.Trellis.users; assert.equal(users.enableUsers('Admin', '1111').ok, true); const diagramId = users.getDiagramKey({ create: true }); // CHANGE: persist the document identity before taking the accepted fixture snapshot.
    const { inspectDiagram } = await import('../src/main/trellis-share-protocol.js'), { permissionSnapshot } = await import('../src/main/trellis-permission-policy.js'); // CHANGE
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
        async activityAction(input) { activityCalls.push(input); if (input.kind === 'claim') for (const key of input.targets || []) held.set(key, { key, claimId: key, sessionId: 'local', expiresAt: Date.now() + 30000 }); if (input.kind === 'release') for (const key of input.targets || [...held.keys()]) held.delete(key); if (input.kind === 'publish') { published = input.pending; saveState = input.saveState; } return { ok: true, collaboration: activity() }; }, // CHANGE
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
test('all module factories retain admin authorization across pending edits and an older save response', async t => { // CHANGE
    const h = await fixture(t), existing = []; // CHANGE
    for (const type of ['regular', 'team', 'task', 'roadmap', 'garden']) { // CHANGE
        const bounds = new Map(existing.map(cell => [cell.id, JSON.stringify(cell.geometry)])), cell = h.create(type); assert.ok(cell && h.graph.model.getCell(cell.id) === cell, type); await settle(); // CHANGE
        for (const peer of existing) assert.equal(JSON.stringify(peer.geometry), bounds.get(peer.id), 'creation cannot rearrange existing modules'); existing.push(...h.graph.getModel().getChildren(h.graph.getDefaultParent()).filter(item => !existing.includes(item))); // CHANGE
        assert.equal(h.users.canEditCell(cell), true, 'an unsaved module remains editable'); // CHANGE
    } // CHANGE
    const release = h.blockSave(), saved = h.save(); await settle(); assert.ok(h.getPendingSave()); h.heartbeat(); // CHANGE
    const newer = h.create('regular', { x: 1000, y: 1000 }); await settle(); assert.ok(newer); assert.ok(h.w.Trellis.sharing.permissionChanges().some(change => (change.cell || change.child) === newer), 'the pending save must retain later creation proof'); release(); await saved; await settle(); // CHANGE
    assert.ok(h.graph.__trellisSharedPolicy.cells.has(JSON.stringify(['', existing[0].id]))); assert.equal(h.users.canEditCell(existing[0]), true); assert.equal(h.users.canEditCell(newer), true); // CHANGE
    assert.ok(h.graph.__trellisSharedPolicy.cells.has(JSON.stringify(['', newer.id])) || h.w.Trellis.sharing.permissionChanges().some(change => (change.cell || change.child) === newer), 'later creation is either covered by a follow-up save policy or still has pending proof'); // CHANGE
    await h.save(); assert.equal(h.users.canEditCell(newer), true); assert.equal(h.w.Trellis.sharing.permissionChanges().length, 0); assert.deepEqual(h.errors, []); // CHANGE
}); // CHANGE
test('selection and label completion keep automatic saves behind the shared quiet period, and manual Save bypasses it', async t => { // CHANGE
    let now = 0, sequence = 0; const waits = new Map(), clock = { options: { now: () => now, setTimeout(fn, delay) { waits.set(++sequence, { fn, at: now + delay }); return sequence; }, clearTimeout(id) { waits.delete(id); } } }; // CHANGE
    const advance = async duration => { now += duration; for (const [id, timer] of [...waits]) if (timer.at <= now) { waits.delete(id); timer.fn(); } await settle(); }; // CHANGE
    const h = await fixture(t, clock), first = h.create('regular'); await settle(); h.graph.fireEvent(new h.w.mxEventObject('editingStarted')); h.graph.fireEvent(new h.w.mxEventObject('editingStopped')); h.graph.clearSelection(); await settle(); // CHANGE
    assert.equal(h.replies.length, 0, 'selection handoff must not save immediately'); await advance(19999); assert.equal(h.replies.length, 0); clock.activity(); await advance(19999); assert.equal(h.replies.length, 0, 'typing postpones a queued selection save'); // CHANGE
    h.graph.setSelectionCell(first); await advance(1); assert.equal(h.replies.length, 1, 'save begins at twenty seconds after activity'); // CHANGE
    const second = h.create('team'); await settle(); h.graph.clearSelection(); await settle(); assert.equal(h.replies.length, 1); await h.save(); assert.equal(h.replies.length, 2, 'manual Save flushes the automatic batch'); assert.equal(h.users.canEditCell(second), true); assert.deepEqual(h.errors, []); // CHANGE
}); // CHANGE
test('failed saves retain creation proof and successful retries install accepted policy', async t => { // CHANGE
    const h = await fixture(t), cell = h.create('team'); await settle(); h.failSave(true); await assert.rejects(h.save(), /Temporary save failure/); assert.equal(h.users.canEditCell(cell), true); assert.ok(h.w.Trellis.sharing.permissionChanges().length); // CHANGE
    h.failSave(false); await h.save(); assert.equal(h.users.canEditCell(cell), true); assert.equal(h.w.Trellis.sharing.permissionChanges().length, 0); // CHANGE
}); // CHANGE
test('disposing a text-only editor against a clean graph releases its hold without saving', async t => { // CHANGE
    const h = await fixture(t), cell = h.create('regular'); await settle(); await h.save(); h.graph.clearSelection(); await settle(); const saved = h.replies.length; // CHANGE
    const editor = h.w.Trellis.sharing.registerEditor({ kind: 'planting', targets: [JSON.stringify(['', cell.id])], capture: () => ({ text: 'Unapplied private text' }), save: () => false, discard() {} }); await editor.acquire(); editor.dispose(true); await settle(); // CHANGE
    assert.equal(h.file.isModified(), false); assert.equal(h.replies.length, saved, 'private draft disposal must not schedule a graph save'); assert.deepEqual(h.errors, []); // CHANGE
}); // CHANGE
test('Undo removes pending creations and Redo restores their authorization before publication', async t => { // CHANGE
    const h = await fixture(t), cell = h.create('regular'); await settle(); const id = cell.id; assert.equal(h.users.canEditCell(cell), true); // CHANGE
    h.undo.undo(); await settle(); assert.equal(h.graph.model.getCell(id), undefined); assert.equal(h.w.Trellis.sharing.permissionChanges().some(change => change.child === cell), false); // CHANGE
    h.undo.redo(); await settle(); assert.equal(h.graph.model.getCell(id), cell); assert.equal(h.users.canEditCell(cell), true); await h.save(); assert.equal(h.users.canEditCell(cell), true); // CHANGE
}); // CHANGE
test('non-admin creation uses prior parent authority and cannot acquire a protected existing module', async t => { // CHANGE
    const h = await fixture(t), old = h.create('team', { x: 0, y: 0 }); await settle(); await h.save(); const editor = h.users.createUser('Editor', '2222', false).user; await settle(); await h.save(); // CHANGE
    h.users.logout(); assert.equal(h.users.login('Editor', '2222').ok, true); await settle(); assert.equal(h.users.canEditCell(old), false); const previous = JSON.stringify(old.geometry); // CHANGE
    const created = h.create('regular', { x: 0, y: 0 }); await settle(); assert.ok(created); assert.equal(h.users.canEditCell(created), true); assert.equal(JSON.stringify(old.geometry), previous); // CHANGE
    const value = old.value.cloneNode(true); value.setAttribute('trellis_owner_user_id', editor.id); value.setAttribute('label', 'Unauthorized takeover'); h.graph.model.setValue(old, value); await settle(); // CHANGE
    assert.notEqual(old.getAttribute('trellis_owner_user_id'), editor.id); assert.notEqual(old.getAttribute('label'), 'Unauthorized takeover'); assert.equal(h.users.canEditCell(created), true); // CHANGE
}); // CHANGE
test('rejected creation rolls back complete starter content and leaves valid native notifications', async t => { // CHANGE
    const h = await fixture(t); h.users.logout(); await settle(); const before = h.ui.getFileData(), root = h.graph.getDefaultParent(), count = h.graph.model.getChildCount(root); // CHANGE
    assert.equal(h.create('garden'), null, 'refused UI creation returns no module without a second uncaught error'); await settle(); // CHANGE
    assert.equal(h.graph.model.getChildCount(root), count); assert.equal(h.ui.getFileData(), before); assert.deepEqual(h.errors, []); // CHANGE
}); // CHANGE

test('real garden creation publishes one summary, claims only the garden, and retains every generated object in recovery', async t => { // NEW
    const h = await fixture(t); h.activityCalls.length = 0; const edits = []; // NEW
    h.graph.model.addListener(h.w.mxEvent.CHANGE, (_sender, event) => edits.push(event.getProperty('edit'))); // NEW
    const garden = h.create('garden'); // NEW
    assert.deepEqual(h.badges().map(badge => badge.key), [h.key(garden)], 'synchronous pending rendering is already grouped'); // NEW
    await settle(); // NEW
    assert.deepEqual([...new Set(h.activityCalls.filter(call => call.kind === 'claim').flatMap(call => Array.from(call.targets)))], [h.key(garden)]); // NEW
    assert.deepEqual(h.badges().map(badge => badge.key), [h.key(garden)]); // NEW
    assert.ok(h.badges().every(badge => !badge.text.includes('editing'))); // NEW
    assert.deepEqual(Array.from(h.activityCalls.filter(call => call.kind === 'publish').at(-1).pending), [h.key(garden)]); // NEW
    const creation = edits.find(edit => edit.__trellisGardenCreation), descriptor = creation.__trellisGardenCreation; // NEW
    assert.ok(descriptor.cells.some(cell => cell.getAttribute('roadmap_type') === 'board')); // NEW
    assert.ok(descriptor.cells.some(cell => /role_name=1/.test(cell.style || ''))); // NEW
    assert.equal(Object.prototype.propertyIsEnumerable.call(creation, '__trellisGardenCreation'), false); // NEW
    for (const change of creation.changes.filter(change => !change.__trellisUsersActorStamp && (change.cell || change.child)?.id !== garden.id)) assert.notEqual(h.graph.__trellisEditContext.kindOf(change), 'manual'); // NEW
    await h.file.__trellisCheckpoint(); const checkpoint = h.recoveryCalls.findLast(call => call.kind === 'checkpoint'); // NEW
    for (const cell of descriptor.cells) assert.ok(checkpoint.xml.includes('id="' + cell.id + '"'), 'recovery includes ' + cell.id); // NEW
    assert.ok(!checkpoint.xml.includes('__trellisGardenCreation')); // NEW
    assert.deepEqual(h.errors, []); // NEW
}); // NEW

test('real manual edits leave the initial summary per object, and Undo restores untouched visibility', async t => { // NEW
    const h = await fixture(t), garden = h.create('garden'); await settle(); // NEW
    const team = h.graph.model.getCell(garden.getAttribute('trellis_team_module_id')); // NEW
    const section = h.graph.model.getChildren(team).find(cell => cell.getAttribute('trellis_team_unassigned') !== '1'); // NEW
    h.undo.clear(); h.graph.labelChanged(section, 'My team'); await settle(); // NEW
    assert.ok(h.badges().some(badge => badge.key === h.key(section) && badge.text.includes('editing'))); // NEW
    assert.deepEqual(h.badges().map(badge => badge.key).sort(), [h.key(garden), h.key(section)].sort()); // NEW
    h.undo.undo(); await settle(); // NEW
    assert.deepEqual(h.badges().map(badge => badge.key), [h.key(garden)]); // NEW
    assert.ok(h.badges().every(badge => !badge.text.includes('editing'))); // NEW
    h.undo.redo(); await settle(); assert.ok(h.badges().some(badge => badge.key === h.key(section) && badge.text.includes('editing'))); // NEW
}); // NEW

test('creation failure exposes per-object errors, successful save retires aggregation, and reopening does not infer groups', async t => { // NEW
    const h = await fixture(t), garden = h.create('garden'); await settle(); // NEW
    h.failSave(true); await assert.rejects(h.save(), /Temporary save failure/); await settle(); // NEW
    assert.ok(h.badges().filter(badge => badge.text.includes('save failed')).length > 1); // NEW
    assert.ok(h.activityCalls.filter(call => call.kind === 'publish').at(-1).pending.length > 1); // NEW
    h.failSave(false); const action = h.bridge.collaborationAction; // NEW
    h.bridge.collaborationAction = input => input.kind === 'save' ? Promise.resolve({ ok: false, code: 'CONFLICT', reason: 'Test conflict', review: { groups: [] } }) : action(input); // NEW
    await assert.rejects(h.save(), /Test conflict/); await settle(); // NEW
    assert.ok(h.badges().filter(badge => badge.text.includes('conflict')).length > 1); // NEW
    h.bridge.collaborationAction = action; await h.save(); await settle(); // NEW
    assert.equal(h.badges().length, 0, 'saved startup content does not reveal an untouched initial hold'); // NEW
    const task = h.graph.model.getCell(garden.getAttribute('trellis_task_module_id')); // NEW
    h.graph.__trellisEditContext.scope('generated-content', () => { const value = task.value.cloneNode(true); value.setAttribute('label', 'Later automatic update'); h.graph.model.setValue(task, value); }); await settle(); // NEW
    assert.ok(h.badges().some(badge => badge.key === h.key(task) && badge.text.includes('changed'))); // NEW
    await h.save(); h.ui.editor.fireEvent(new h.w.mxEventObject('fileLoaded')); await settle(); // NEW
    h.observe({ holds: [{ key: h.key(garden), sessionId: 'local', name: 'Admin', claimId: 'reopened', expiresAt: Date.now() + 30000 }] }); // NEW
    assert.ok(h.badges().some(badge => badge.key === h.key(garden) && badge.text.includes('editing')), 'XML markers alone cannot reconstruct session suppression'); // NEW
}); // NEW

test('an older save cannot retire a newer garden summary or clear newer generated content', async t => { // NEW
    const h = await fixture(t), first = h.create('garden'); await settle(); // NEW
    const release = h.blockSave(), saved = h.save(); await settle(); // NEW
    const second = h.create('garden', { x: 6000, y: 6000 }); await settle(); // NEW
    const task = h.graph.model.getCell(first.getAttribute('trellis_task_module_id')); // NEW
    h.graph.__trellisEditContext.scope('generated-content', () => { const value = task.value.cloneNode(true); value.setAttribute('label', 'Generated after capture'); h.graph.model.setValue(task, value); }); await settle(); // NEW
    release(); await saved; await settle(); // NEW
    assert.equal(h.file.isModified(), true); // NEW
    assert.ok(h.badges().some(badge => badge.key === h.key(second) && badge.text.includes('pending project save'))); // NEW
    assert.ok(h.badges().some(badge => badge.key === h.key(task) && badge.text.includes('pending project save'))); // NEW
    const pending = Array.from(h.activityCalls.filter(call => call.kind === 'publish').at(-1).pending); // NEW
    assert.ok(pending.includes(h.key(second))); assert.ok(pending.includes(h.key(task))); // NEW
    const secondTeam = h.graph.model.getCell(second.getAttribute('trellis_team_module_id')); assert.ok(!pending.includes(h.key(secondTeam))); // NEW
}); // NEW

test('creation Undo/Redo, peer activity and requested handoffs preserve their distinct visibility', async t => { // NEW
    const h = await fixture(t), garden = h.create('garden'); await settle(); // NEW
    h.undo.undo(); await settle(); assert.equal(h.badges().length, 0); // NEW
    h.undo.redo(); await settle(); assert.deepEqual(h.badges().map(badge => badge.key), [h.key(garden)]); // NEW
    const team = h.graph.model.getCell(garden.getAttribute('trellis_team_module_id')); // NEW
    h.observe({ holds: [...h.held.values(), { key: h.key(team), sessionId: 'peer', name: 'Peer', claimId: 'peer-team', expiresAt: Date.now() + 30000 }] }); // NEW
    assert.ok(h.badges().some(badge => badge.key === h.key(team) && badge.text.includes('Peer · editing'))); // NEW
    h.observe({ holds: [...h.held.values()].map(hold => ({ ...hold, requested: true, name: 'Admin' })) }); // NEW
    assert.ok(h.badges().some(badge => badge.key === h.key(garden) && badge.text.includes('Admin · editing'))); // NEW
}); // NEW

test('automatically seeded garden creation has a summary without manual holds', async t => { // NEW
    const h = await fixture(t); h.activityCalls.length = 0; // NEW
    const garden = h.graph.__trellisEditContext.scope('generated-content', () => h.create('garden')); await settle(); // NEW
    assert.equal(h.activityCalls.some(call => call.kind === 'claim'), false); // NEW
    assert.deepEqual(h.badges().map(badge => badge.key), [h.key(garden)]); // NEW
}); // NEW

test('creation visibility cannot cross an author switch on the same open diagram', async t => { // NEW
    const h = await fixture(t), garden = h.create('garden'); await settle(); await h.save(); // NEW
    assert.equal(h.users.createUser('Next admin', '2222', true).ok, true); await h.save(); // NEW
    h.users.logout(); assert.equal(h.users.login('Next admin', '2222').ok, true); await settle(); // NEW
    h.observe({ holds: [{ key: h.key(garden), sessionId: 'local', name: 'Next admin', claimId: 'next-author', expiresAt: Date.now() + 30000 }] }); // NEW
    assert.ok(h.badges().some(badge => badge.key === h.key(garden) && badge.text.includes('Next admin · editing'))); // NEW
}); // NEW

test('a creation accepted while locally undone stays saved when redone after completion', async t => { // NEW
    const h = await fixture(t), garden = h.create('garden'); await settle(); // NEW
    const creation = h.undo.history.find(edit => edit.__trellisGardenCreation), task = h.graph.model.getCell(garden.getAttribute('trellis_task_module_id')); // NEW
    const release = h.blockSave(), saved = h.save(); await settle(); creation.undo(); await settle(); // NEW
    release(); await saved; await settle(); creation.redo(); await settle(); // NEW
    h.graph.__trellisEditContext.scope('generated-content', () => { const value = task.value.cloneNode(true); value.setAttribute('label', 'After accepted creation'); h.graph.model.setValue(task, value); }); await settle(); // NEW
    assert.ok(h.badges().some(badge => badge.key === h.key(task) && badge.text.includes('pending project save'))); // NEW
}); // NEW

test('completed selected objects release after persistence while clean panels remain open', async t => { // CHANGE
    const h = await fixture(t), cell = h.create('regular'); await settle(); await h.save(); // CHANGE
    const editor = h.w.Trellis.sharing.registerEditor({ kind: 'planting', targets: [h.key(cell)], capture: () => ({ text: 'view' }), save: () => true, restore() {}, discard() {} }); // CHANGE
    await editor.acquire(); h.graph.setSelectionCell(cell); const value = cell.value.cloneNode(true); value.setAttribute('label', 'Completed edit'); h.graph.model.setValue(cell, value); await settle(); // CHANGE
    void editor.complete(); await h.save(); await settle(); // CHANGE
    assert.equal(h.graph.getSelectionCell(), cell); assert.equal(editor.active(), true); assert.equal(h.held.has(h.key(cell)), false); // CHANGE
}); // CHANGE

test('newer editing during an older save retains its hold and failed persistence remains retryable', async t => { // CHANGE
    const h = await fixture(t), cell = h.create('regular'); await settle(); await h.save(); // CHANGE
    const editor = h.w.Trellis.sharing.registerEditor({ kind: 'planting', targets: [h.key(cell)], capture: () => ({ text: 'draft' }), save: () => true, restore() {}, discard() {} }); // CHANGE
    await editor.acquire(); const value = cell.value.cloneNode(true); value.setAttribute('label', 'First edit'); h.graph.model.setValue(cell, value); await settle(); // CHANGE
    void editor.complete(); const releaseSave = h.blockSave(), saving = h.save(); await settle(); await editor.acquire(); releaseSave(); await saving; await settle(); // CHANGE
    assert.equal(h.held.has(h.key(cell)), true, 'an older save cannot release the resumed editor'); // CHANGE
    const next = cell.value.cloneNode(true); next.setAttribute('label', 'Later edit'); h.graph.model.setValue(cell, next); await settle(); h.failSave(true); void editor.complete(); await assert.rejects(h.save(), /Temporary save failure/); assert.equal(h.held.has(h.key(cell)), true); // CHANGE
    h.failSave(false); await h.save(); await settle(); assert.equal(h.held.has(h.key(cell)), false, JSON.stringify({ holds: h.w.Trellis.sharing.automationHolds(), modified: h.file.isModified(), editorDirty: editor.dirty(), calls: h.activityCalls.slice(-8) })); // CHANGE
}); // CHANGE
