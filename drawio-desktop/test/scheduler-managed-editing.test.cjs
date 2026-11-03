/** The scheduler must survive native rejection with Users, sharing, tiling and tasks installed. */ // CHANGE
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'); // CHANGE
const { fixture } = require('./helpers/managed-editing-harness.cjs'); // CHANGE
const { loadSchedulerHooks, makeInputs, makePlant } = require('./helpers/garden-scheduler-harness.cjs'); // CHANGE

async function schedulerFixture(t, plantOverrides = {}) { // CHANGE: reproductions can use distinct crop names without changing production activity.
    const h = await fixture(t), w = h.w, graph = h.graph; // CHANGE
    const garden = h.create('garden'); await h.settle(); await h.save(); graph.clearSelection(); await h.settle(); // CHANGE
    w.eval(fs.readFileSync(path.join(__dirname, '../drawio/src/main/webapp/plugins/garden_planner_plugins/Planting_Group.js'), 'utf8')); // CHANGE
    const value = w.mxUtils.createXmlDocument().createElement('object'); value.setAttribute('garden_bed', '1'); value.setAttribute('label', 'Scheduler bed'); // CHANGE
    const bed = graph.insertVertex(garden, null, value, 200, 200, 150, 300, 'dashed=1;'); await h.settle(); await h.save(); graph.clearSelection(); await h.settle(); // CHANGE
    const api = loadSchedulerHooks({ graph, globals: { mxCellAttributeChange: w.mxCellAttributeChange, mxGeometry: w.mxGeometry } }); // CHANGE
    Object.assign(api.__testWindow, { Trellis: w.Trellis, TrellisEditContext: w.TrellisEditContext }); Object.assign(api.__testWindow.USL, { tiler: w.USL.tiler, tasks: w.USL.tasks }); // CHANGE
    const inputs = makeInputs(api, { plant: makePlant(api, { plant_name: 'Basil', abbr: 'BAS', spacing_cm: 30, ...plantOverrides }) }); // CHANGE
    const save = async (saveOptions = {}, nextInputs = inputs) => { const result = api.computeScheduleResult(nextInputs), creation = await api.prepareBedScheduleCreation(h.ui, bed, nextInputs, result); return api.applyScheduleToGraph(h.ui, bed, nextInputs, { result, taskTemplate: { version: 2, rules: [{ id: 'water', title: 'Water', startAnchorStage: 'SOW', endMode: 'fixed_days', durationDays: 0 }] }, createTargetCell: creation.createTargetCell, ...saveOptions }); }; // CHANGE
    return { ...h, api, bed, garden, inputs, saveSchedule: save, groups: () => Object.values(graph.model.cells).filter(cell => cell.getAttribute?.('tiler_group') === '1') }; // CHANGE
} // CHANGE

test('rejected bed creation reports its reason and retry does not defer on its own pending holds', async t => { // CHANGE
    const h = await schedulerFixture(t); let rejected = false; // CHANGE
    h.graph.model.addListener(h.w.mxEvent.CHANGE, (_sender, event) => { // CHANGE
        const edit = event.getProperty('edit'); // CHANGE
        if (!rejected && h.groups().length && !edit.undone && !edit.__trellisUsersRejected) { rejected = true; edit.__trellisUsersRejected = true; edit.__trellisUsersRejectedReason = 'Injected native planting rejection'; edit.undo(); } // CHANGE
    }); // CHANGE
    await assert.rejects(h.saveSchedule(), /Injected native planting rejection/); await h.settle(); // CHANGE
    assert.equal(h.groups().length, 0); assert.equal([...h.held.keys()].some(key => !h.graph.model.getCell(JSON.parse(key)[1])), false, 'a rejected creation cannot leave an orphan editing hold'); // CHANGE
    await h.saveSchedule(); await h.settle(); assert.equal(h.groups().length, 1); assert.ok(Object.values(h.graph.model.cells).some(cell => String(cell.getAttribute?.('linkedTo') || '').split(',').includes(h.groups()[0].id)), 'the real task generator created a linked task'); // CHANGE
}); // CHANGE

module.exports = { schedulerFixture }; // CHANGE

test('Cilantro persistence holds allow another planting while the project save is still in flight', async t => { // CHANGE
    const h = await schedulerFixture(t, { plant_name: 'Cilantro', abbr: 'CIL' }); const first = await h.saveSchedule(); await h.settle(); // CHANGE
    const tasks = Object.values(h.graph.model.cells).filter(cell => cell.getAttribute?.('kanban_card') === '1' && String(cell.getAttribute('linkedTo')).split(',').includes(first.id)); // CHANGE
    assert.ok(tasks.length); assert.equal(h.graph.__trellisSharing.activeEditorTargets().length, 0); // CHANGE
    assert.ok(h.graph.__trellisSharing.automationHolds().some(hold => tasks.some(task => h.key(task) === hold.key) && hold.local && hold.active === false)); // CHANGE
    const release = h.blockSave(), saving = h.save(); // CHANGE
    try { // CHANGE
        await h.settle(); assert.ok(h.getPendingSave()); // CHANGE
        const nextInputs = makeInputs(h.api, { plant: makePlant(h.api, { plant_name: 'Cauliflower', spacing_cm: 30 }), startISO: '2026-08-01' }); // CHANGE
        const second = await h.saveSchedule({}, nextInputs); await h.settle(); // CHANGE
        assert.equal(second.getAttribute('plant_name'), 'Cauliflower'); assert.equal(h.groups().length, 2); // CHANGE
    } finally { release(); await saving; } // CHANGE
    assert.deepEqual(h.errors, []); // CHANGE
}); // CHANGE

test('another session editing Cilantro cannot block creating Pea in a different bed with real Users and generated tasks', async t => { // CHANGE
    const h = await schedulerFixture(t, { plant_name: 'Cilantro', abbr: 'CIL' }), cilantro = await h.saveSchedule(); await h.settle(); await h.save(); // CHANGE
    const otherBed = h.graph.insertVertex(h.garden, null, h.bed.value.cloneNode(true), 650, 200, 150, 300, h.bed.style); await h.settle(); await h.save(); await h.settle(); // CHANGE
    const key = h.key(cilantro); h.held.set(key, { key, claimId: 'other-session-cilantro', sessionId: 'other-window', userId: h.users.getCurrentUser().id, online: true }); h.heartbeat(); await h.settle(); // CHANGE
    const pea = makePlant(h.api, { plant_id: 2, plant_name: 'Pea', spacing_cm: 30 }), inputs = makeInputs(h.api, { plant: pea }); // CHANGE
    h.api.__testWindow.dbBridge.query = async (_id, sql, params = []) => ({ rows: /FROM Companions c/i.test(sql) ? [{ relation_id: 21, source_plant_id: 2, companion_plant_id: 1, rating: 1 }] : /FROM\s+Plants\b/i.test(sql) ? [Number(params[0]) === 2 ? pea : h.inputs.plant] : [] }); // CHANGE
    const result = h.api.computeScheduleResult(inputs), creation = await h.api.prepareBedScheduleCreation(h.ui, otherBed, inputs, result); // CHANGE
    const saved = await h.api.applyScheduleToGraph(h.ui, otherBed, inputs, { result, createTargetCell: creation.createTargetCell, applyCompanionSetDefaults: true, taskTemplate: { version: 2, rules: [{ id: 'water', title: 'Water', startAnchorStage: 'SOW', endMode: 'fixed_days', durationDays: 0 }] } }); // CHANGE
    await h.settle(); assert.equal(saved.getAttribute('plant_name'), 'Pea'); assert.equal(h.groups().length, 2); // CHANGE
    assert.equal(h.held.get(key)?.claimId, 'other-session-cilantro'); assert.ok(Object.values(h.graph.model.cells).some(cell => cell.getAttribute?.('kanban_card') === '1' && String(cell.getAttribute('linkedTo')).split(',').includes(saved.id))); // CHANGE
    assert.deepEqual(h.errors, []); // CHANGE
}); // CHANGE

test('nested creation blockers report their reason without provisional objects or a queued scheduler Retry', async t => { // CHANGE
    const h = await schedulerFixture(t), layer = h.graph.model.getParent(h.garden), key = h.key(layer); // CHANGE
    h.held.set(key, { key, claimId: 'earlier-session', sessionId: 'earlier-window', userId: h.users.getCurrentUser().id, objectLabel: 'Containing layer' }); h.heartbeat(); await h.settle(); // CHANGE
    const before = h.ui.getFileData(), undoCount = h.undo.history.length; // CHANGE
    await assert.rejects(h.saveSchedule(), error => error.code === 'TRELLIS_EDIT_BLOCKED' && /Containing layer.*entries remain.*click Save again/.test(error.message)); // CHANGE
    assert.equal(h.ui.getFileData(), before); assert.equal(h.undo.history.length, undoCount); assert.equal(h.groups().length, 0); // CHANGE
    assert.equal(h.graph.__trellisEditContext.deferred.size, 0); assert.equal(h.w.document.querySelector('[data-trellis-deferred-automation]'), null); // CHANGE
    h.held.delete(key); h.heartbeat(); await h.settle(); // CHANGE
    const nextInputs = makeInputs(h.api, { plant: h.inputs.plant, startISO: '2026-04-09' }); // CHANGE
    const saved = await h.saveSchedule({}, nextInputs); await h.settle(); // CHANGE
    assert.equal(h.groups().length, 1); assert.equal(saved.getAttribute('sow_date'), '2026-04-09'); // CHANGE
    assert.ok(Object.values(h.graph.model.cells).some(cell => cell.getAttribute?.('kanban_card') === '1' && String(cell.getAttribute('linkedTo')).split(',').includes(saved.id))); // CHANGE
}); // CHANGE

test('an active unrelated local task editor blocks a schedule but completed persistence does not', async t => { // CHANGE
    const h = await schedulerFixture(t), saved = await h.saveSchedule(); await h.settle(); await h.save(); await h.settle(); // CHANGE
    const task = Object.values(h.graph.model.cells).find(cell => cell.getAttribute?.('kanban_card') === '1' && String(cell.getAttribute('linkedTo')).split(',').includes(saved.id)); // CHANGE
    const panel = h.w.document.createElement('section'); h.w.document.body.append(panel); // CHANGE
    const editor = h.w.Trellis.sharing.registerEditor({ kind: 'object-form', element: panel, targets: [h.key(task)], capture: () => ({}), save: async () => true, discard() {} }); // CHANGE
    await editor.acquire(); const before = h.ui.getFileData(); // CHANGE
    const nextInputs = makeInputs(h.api, { plant: h.inputs.plant, startISO: '2026-04-09' }), options = { result: h.api.computeScheduleResult(nextInputs), taskTemplate: { version: 2, rules: [] } }; // CHANGE
    await assert.rejects(h.api.applyScheduleToGraph(h.ui, saved, nextInputs, options), error => error.code === 'TRELLIS_EDIT_BLOCKED' && /unfinished local editor/.test(error.message)); // CHANGE
    assert.equal(h.ui.getFileData(), before); assert.equal(h.graph.__trellisEditContext.deferred.size, 0); // CHANGE
    await editor.complete(); editor.dispose(); panel.remove(); // CHANGE
    await h.api.applyScheduleToGraph(h.ui, saved, nextInputs, options); assert.equal(saved.getAttribute('sow_date'), '2026-04-09'); // CHANGE
}); // CHANGE

test('malformed target factories still report invalid targets and default creation callers still defer', async t => { // CHANGE
    const h = await schedulerFixture(t); // CHANGE
    await assert.rejects(h.saveSchedule({ createTargetCell: () => h.bed }), /Scheduler save target is not a planting group/); // CHANGE
    const key = h.key(h.graph.model.getParent(h.garden)); h.held.set(key, { key, claimId: 'held-layer', sessionId: 'peer' }); h.heartbeat(); await h.settle(); // CHANGE
    const creation = await h.api.prepareBedScheduleCreation(h.ui, h.bed, h.inputs, h.api.computeScheduleResult(h.inputs)); // CHANGE
    assert.equal(creation.createTargetCell({ attributePatch: {} }), null); assert.equal(h.groups().length, 0); assert.equal(h.graph.__trellisEditContext.deferred.size, 1); // CHANGE
}); // CHANGE

test('an authorized bed schedule with generated tasks commits on its first attempt', async t => { // CHANGE
    const h = await schedulerFixture(t); await h.saveSchedule(); await h.settle(); // CHANGE
    assert.equal(h.groups().length, 1); const group = h.groups()[0]; assert.equal(h.users.canEditCell(group), true); // CHANGE
    assert.ok(Object.values(h.graph.model.cells).some(cell => String(cell.getAttribute?.('linkedTo') || '').split(',').includes(group.id))); // CHANGE
    await h.save(); await h.settle(); assert.equal(h.users.canEditCell(group), true); assert.deepEqual(h.errors, []); // CHANGE
}); // CHANGE

test('reordering an existing ancestor cannot resurrect a generated task in the permission before-state', async t => { // CHANGE
    const h = await schedulerFixture(t), tasks = h.w.USL.tasks, replace = tasks.applySchedulerTaskReplacement; // CHANGE
    tasks.applySchedulerTaskReplacement = function (...args) { // CHANGE
        const result = replace.apply(this, args), parent = h.graph.model.getParent(h.garden); // CHANGE
        h.graph.model.add(parent, h.garden, h.graph.model.getChildCount(parent) - 1); return result; // CHANGE: production layout may reorder ancestors after adding the new task.
    }; // CHANGE
    await h.saveSchedule(); await h.settle(); assert.equal(h.groups().length, 1); await h.save(); assert.deepEqual(h.errors, []); // CHANGE
}); // CHANGE

test('a post-application failure compensates the planting, generated tasks, board layout and Undo entry', async t => { // CHANGE
    const h = await schedulerFixture(t), before = h.ui.getFileData(), refresh = h.graph.refresh; let fail = true; // CHANGE
    h.graph.refresh = function (cell) { if (fail && !this.model.updateLevel && cell?.getAttribute('tiler_group') === '1' && !new Error().stack.includes('inspectModelChange')) { fail = false; throw new Error('Injected post-application rendering failure'); } return refresh.apply(this, arguments); }; // CHANGE
    await assert.rejects(h.saveSchedule(), /post-application rendering failure/); await h.settle(); h.graph.refresh = refresh; // CHANGE
    assert.equal(h.groups().length, 0); assert.deepEqual(canonicalDiagram(h.w, h.ui.getFileData()), canonicalDiagram(h.w, before)); assert.equal(h.undo.history.some(edit => edit.__trellisUsersRejected), false); // CHANGE
    await h.saveSchedule(); await h.settle(); assert.equal(h.groups().length, 1); // CHANGE
}); // CHANGE

/** Compare persisted content/geometry while allowing equivalent style ordering and runtime-only layout hints. */ // CHANGE
function canonicalDiagram(window, xml) { // CHANGE
    const document = window.mxUtils.parseXml(xml); // CHANGE
    function normalize(node) { // CHANGE
        if (node.nodeType !== 1) return node.nodeValue?.trim() || ''; // CHANGE
        const attributes = Object.fromEntries([...node.attributes].filter(attribute => !attribute.name.startsWith('__')).map(attribute => [attribute.name, attribute.name === 'style' ? attribute.value.split(';').filter(Boolean).sort().join(';') : attribute.value]).sort(([a], [b]) => a.localeCompare(b))); // CHANGE
        const children = [...node.childNodes].filter(child => child.nodeType === 1 || child.nodeValue?.trim()); // CHANGE
        if (node.nodeName === 'root') children.sort((a, b) => (a.getAttribute('id') || '').localeCompare(b.getAttribute('id') || '')); // CHANGE
        return { name: node.nodeName, attributes, children: children.map(normalize) }; // CHANGE
    } // CHANGE
    return normalize(document.documentElement); // CHANGE
} // CHANGE
test('the shared task editor command restores its value and Undo history when final rendering fails', async t => { // CHANGE
    const h = await schedulerFixture(t), group = await h.saveSchedule(); await h.settle(); await h.save(); // CHANGE
    const card = Object.values(h.graph.model.cells).find(cell => cell.getAttribute?.('kanban_card') === '1' && String(cell.getAttribute('linkedTo')).split(',').includes(group.id)); // CHANGE
    const before = h.ui.getFileData(), history = h.undo.history.slice(), refresh = h.graph.refresh; let fail = true; // CHANGE
    h.graph.refresh = function (cell) { if (fail && cell === card && !this.model.updateLevel) { fail = false; throw new Error('Task editor rendering failed'); } return refresh.apply(this, arguments); }; // CHANGE
    assert.throws(() => h.w.Trellis.taskCommands.commitCardPatch(card, { task_note: 'failed edit' }, { reflow: false }), /Task editor rendering failed/); // CHANGE
    h.graph.refresh = refresh; await h.settle(); assert.deepEqual(canonicalDiagram(h.w, h.ui.getFileData()), canonicalDiagram(h.w, before)); assert.deepEqual(h.undo.history, history); // CHANGE
    assert.equal(h.w.Trellis.taskCommands.commitCardPatch(card, { task_note: 'retry succeeded' }, { reflow: false }), true); assert.equal(card.getAttribute('task_note'), 'retry succeeded'); // CHANGE
}); // CHANGE
