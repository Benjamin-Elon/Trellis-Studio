const assert = require('node:assert/strict'); // CHANGE
const fs = require('node:fs'); // CHANGE
const path = require('node:path'); // CHANGE
const test = require('node:test'); // CHANGE
const { loadPlantTilerMxGraph } = require('./helpers/plant-tiler-mxgraph-harness.cjs'); // CHANGE
const { loadSchedulerHooks, makeInputs, makePlant } = require('./helpers/garden-scheduler-harness.cjs'); // CHANGE

/** Exercise scheduler save orchestration against the production proposal factory and module callbacks. */ // CHANGE
function fixture() { // CHANGE
    const h = loadPlantTilerMxGraph(); // CHANGE
    h.window.eval(fs.readFileSync(path.join(__dirname, '../drawio/src/main/webapp/plugins/garden_planner_plugins/Modules_Standalone.js'), 'utf8')); // CHANGE
    const api = loadSchedulerHooks({ graph: h.graph, globals: { mxCellAttributeChange: h.window.mxCellAttributeChange, mxGeometry: h.window.mxGeometry } }); // CHANGE
    api.__testWindow.USL.tiler = h.tiler; // CHANGE
    let failTasks = false, taskCalls = 0; // CHANGE
    api.__testWindow.USL.tasks = { applySchedulerTaskReplacement() { taskCalls++; if (failTasks) throw new Error('Injected task failure'); } }; // CHANGE
    const inputs = makeInputs(api, { plant: makePlant(api, { plant_name: 'Basil', abbr: 'BAS', spacing_cm: 30 }) }); // CHANGE
    const result = api.computeScheduleResult(inputs); // CHANGE
    const bed = h.bed(150, 300); // CHANGE
    h.prepare = () => api.prepareBedScheduleCreation(h.ui, bed, inputs, result); // CHANGE
    h.save = async (options = {}) => { const creation = await h.prepare(); return api.applyScheduleToGraph(h.ui, bed, inputs, { result, taskTemplate: { version: 2, rules: [] }, createTargetCell: creation.createTargetCell, applyCompanionSetDefaults: true, ...options }); }; // CHANGE
    h.groups = () => Object.values(h.graph.model.cells).filter(cell => cell.getAttribute?.('tiler_group') === '1'); // CHANGE
    h.flush = () => new Promise(resolve => h.window.setTimeout(resolve, 40)); // CHANGE
    return Object.assign(h, { api, bed, setTaskFailure(value) { failTasks = value; }, taskCalls: () => taskCalls }); // CHANGE
} // CHANGE

test('bed scheduler creates final crop circles once and selects only after successful save', async () => { // CHANGE
    const h = fixture(); // CHANGE
    try { // CHANGE
        h.graph.setSelectionCell(h.bed); h.undoManager.clear(); // CHANGE
        const added = []; h.graph.addListener(h.window.mxEvent.CELLS_ADDED, (_sender, event) => added.push(...event.getProperty('cells').filter(cell => cell.getAttribute?.('plant_tiler') === '1'))); // CHANGE
        await h.save(); await h.flush(); const [group] = h.groups(); // CHANGE
        assert.ok(group); assert.equal(h.groups().length, 1); assert.equal(h.graph.getSelectionCell(), group); assert.equal(h.taskCalls(), 1); // CHANGE
        assert.equal(added.length, Number(group.getAttribute('plant_count_actual'))); assert.ok(added.every(cell => cell.getAttribute('label') === 'BAS' && cell.parent === group)); // CHANGE
        h.undoManager.undo(); await h.flush(); assert.equal(h.groups().length, 0); // CHANGE
        h.undoManager.redo(); await h.flush(); assert.equal(h.groups().length, 1); // CHANGE
    } finally { h.close(); } // CHANGE
}); // CHANGE

test('task failures remove provisional bed plantings, suppress creation selection, and permit retry', async () => { // CHANGE
    const h = fixture(); // CHANGE
    try { // CHANGE
        h.graph.setSelectionCell(h.bed); h.undoManager.clear(); h.setTaskFailure(true); // CHANGE
        await assert.rejects(h.save(), /Injected task failure/); await h.flush(); // CHANGE
        assert.equal(h.groups().length, 0); assert.equal(h.graph.getSelectionCell(), h.bed); // CHANGE
        assert.equal(h.undoManager.history.length, 0, 'Undo must not resurrect a failed planting'); // CHANGE
        assert.equal(Object.values(h.graph.model.cells).filter(cell => cell.getAttribute?.('plant_tiler') === '1').length, 0); // CHANGE
        h.setTaskFailure(false); await h.save(); await h.flush(); assert.equal(h.groups().length, 1); // CHANGE
    } finally { h.close(); } // CHANGE
}); // CHANGE

test('cancellation during read-only preparation prevents bed-target creation', async () => { // CHANGE
    const h = fixture(); // CHANGE
    try { // CHANGE
        let active = true, release, started; // CHANGE
        const reachedPersistence = new Promise(resolve => { started = resolve; }); // CHANGE
        let first = true; h.api.__testWindow.dbBridge.query = async () => { if (first) { first = false; started(); await new Promise(resolve => { release = resolve; }); } return { rows: [] }; }; // CHANGE
        const pending = h.save({ isCurrent: () => active }); // CHANGE
        await reachedPersistence; active = false; release(); // CHANGE
        await assert.rejects(pending, /changed|current/); await h.flush(); // CHANGE
        assert.equal(h.groups().length, 0); assert.equal(h.taskCalls(), 0); // CHANGE
        await h.save(); await h.flush(); assert.equal(h.groups().length, 1); // CHANGE
    } finally { h.close(); } // CHANGE
}); // CHANGE

test('post-commit rendering failures leave no new planting or delayed circles', async () => { // CHANGE
    const h = fixture(); // CHANGE
    try { // CHANGE
        const refresh = h.graph.refresh; let failRefresh = true; // CHANGE
        h.graph.refresh = function (cell) { if (failRefresh && !this.model.updateLevel && cell?.getAttribute('tiler_group') === '1') { failRefresh = false; throw new Error('Injected final rendering failure'); } return refresh.apply(this, arguments); }; // CHANGE
        await assert.rejects(h.save(), /Injected final rendering failure/); h.graph.refresh = refresh; await h.flush(); // CHANGE
        assert.equal(h.groups().length, 0); assert.equal(Object.values(h.graph.model.cells).filter(cell => cell.getAttribute?.('plant_tiler') === '1').length, 0); // CHANGE
        await h.save(); await h.flush(); assert.equal(h.groups().length, 1); // CHANGE
    } finally { h.close(); } // CHANGE
}); // CHANGE

/** Reproduce the real companion-default lookup with Cilantro already scheduled in the garden. */ // CHANGE
async function companionFixture(t) { // CHANGE
    const h = fixture(); t.after(() => { h.api.__testWindow.document.defaultView.close(); h.close(); }); // CHANGE
    await h.save(); const cilantro = h.groups()[0]; // CHANGE
    cilantro.setAttribute('plant_id', '2'); cilantro.setAttribute('plant_name', 'Cilantro'); cilantro.setAttribute('label', 'Cilantro'); // CHANGE
    const plants = [makePlant(h.api, { plant_id: 1, plant_name: 'Pea', spacing_cm: 30 }), makePlant(h.api, { plant_id: 2, plant_name: 'Cilantro', spacing_cm: 30 })]; // CHANGE
    const query = h.api.__testWindow.dbBridge.query; // CHANGE
    h.api.__testWindow.dbBridge.query = async (id, sql, params = []) => { // CHANGE
        if (/FROM Companions c/i.test(sql)) return { rows: [{ relation_id: 12, source_plant_id: 1, companion_plant_id: 2, rating: 1 }] }; // CHANGE
        if (/FROM\s+Plants\b/i.test(sql)) return { rows: plants.filter(plant => Number(plant.plant_id) === Number(params[0])) }; // CHANGE
        return query(id, sql, params); // CHANGE
    }; // CHANGE
    const otherBed = h.graph.insertVertex(h.moduleCell, null, h.bed.value.cloneNode(true), 600, 200, 150, 300, h.bed.style); // CHANGE
    const savePea = async (bed = otherBed, startISO = '2026-04-01') => { // CHANGE
        const inputs = makeInputs(h.api, { plant: plants[0], startISO }), result = h.api.computeScheduleResult(inputs); // CHANGE
        const creation = await h.api.prepareBedScheduleCreation(h.ui, bed, inputs, result); // CHANGE
        return h.api.applyScheduleToGraph(h.ui, bed, inputs, { result, createTargetCell: creation.createTargetCell, applyCompanionSetDefaults: true, taskTemplate: { version: 2, rules: [] } }); // CHANGE
    }; // CHANGE
    return { ...h, cilantro, otherBed, savePea }; // CHANGE
} // CHANGE

test('Cilantro in another bed cannot block Pea scheduling whether its holder is connected or disconnected', async t => { // CHANGE
    for (const online of [true, false]) await t.test(String(online), async t => { // CHANGE
        const h = await companionFixture(t), key = JSON.stringify(['', String(h.cilantro.id)]); // CHANGE
        h.graph.__trellisSharing = { automationHolds: () => [{ key, sessionId: 'other-window', name: 'Benny', online }] }; // CHANGE
        const before = h.window.mxUtils.getXml(h.cilantro.value), geometry = JSON.stringify(h.cilantro.geometry); // CHANGE
        const pea = await h.savePea(); // CHANGE
        assert.equal(pea.getAttribute('plant_name'), 'Pea'); assert.equal(h.groups().length, 2); // CHANGE
        assert.equal(h.window.mxUtils.getXml(h.cilantro.value), before); assert.equal(JSON.stringify(h.cilantro.geometry), geometry); // CHANGE
    }); // CHANGE
}); // CHANGE

test('non-overlapping companions do not block, while an overlapping companion hold blocks before any mutation', async t => { // CHANGE
    const h = await companionFixture(t), key = JSON.stringify(['', String(h.cilantro.id)]); // CHANGE
    h.graph.__trellisSharing = { automationHolds: () => [{ key, sessionId: 'peer', name: 'Benny' }] }; // CHANGE
    const snapshot = () => h.window.mxUtils.getXml(new h.window.mxCodec().encode(h.graph.model)); // CHANGE
    const before = snapshot(), taskCalls = h.taskCalls(), undoCount = h.undoManager.history.length; // CHANGE
    await assert.rejects(h.savePea(h.bed), error => error.code === 'TRELLIS_EDIT_BLOCKED' && /Benny on Cilantro/.test(error.message)); // CHANGE
    assert.equal(snapshot(), before); assert.equal(h.taskCalls(), taskCalls); assert.equal(h.undoManager.history.length, undoCount); // CHANGE
    const pea = await h.savePea(h.bed, '2026-08-01'); assert.equal(pea.getAttribute('plant_name'), 'Pea'); // CHANGE
}); // CHANGE

test('only relevant companion changes invalidate asynchronous schedule preparation', async t => { // CHANGE
    for (const sameBed of [false, true]) await t.test(String(sameBed), async t => { // CHANGE
        const h = await companionFixture(t), query = h.api.__testWindow.dbBridge.query; let changed = false; // CHANGE
        h.api.__testWindow.dbBridge.query = async (id, sql, params) => { // CHANGE
            if (!changed && /FROM CompanionSetLayoutDefaults/i.test(sql)) { changed = true; h.cilantro.setAttribute('spacing_x_cm', '31'); } // CHANGE
            return query(id, sql, params); // CHANGE
        }; // CHANGE
        if (sameBed) { await assert.rejects(h.savePea(h.bed), error => error.code === 'TRELLIS_EDIT_STALE'); assert.equal(h.groups().length, 1); } // CHANGE
        else { const pea = await h.savePea(); assert.equal(pea.getAttribute('plant_name'), 'Pea'); } // CHANGE
        assert.equal(changed, true); // CHANGE
    }); // CHANGE
}); // CHANGE
