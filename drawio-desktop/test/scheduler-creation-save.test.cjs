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

test('cancellation while deferred persistence resolves prevents bed-target creation', async () => { // CHANGE
    const h = fixture(); // CHANGE
    try { // CHANGE
        let active = true, release, started; // CHANGE
        const reachedPersistence = new Promise(resolve => { started = resolve; }); // CHANGE
        const pending = h.save({ isCurrent: () => active, afterGraphUpdate: () => { started(); return new Promise(resolve => { release = resolve; }); } }); // CHANGE
        await reachedPersistence; active = false; release(); // CHANGE
        await assert.rejects(pending, /Scheduler closed/); await h.flush(); // CHANGE
        assert.equal(h.groups().length, 0); assert.equal(h.taskCalls(), 0); // CHANGE
        await h.save(); await h.flush(); assert.equal(h.groups().length, 1); // CHANGE
    } finally { h.close(); } // CHANGE
}); // CHANGE

test('default persistence and post-commit rendering failures leave no new planting or delayed circles', async () => { // CHANGE
    const h = fixture(); // CHANGE
    try { // CHANGE
        await assert.rejects(h.save({ afterGraphUpdate: async () => { throw new Error('Injected persistence failure'); } }), /Injected persistence failure/); // CHANGE
        assert.equal(h.groups().length, 0); assert.equal(h.taskCalls(), 0); // CHANGE
        const refresh = h.graph.refresh; let failRefresh = true; // CHANGE
        h.graph.refresh = function (cell) { if (failRefresh && !this.model.updateLevel && cell?.getAttribute('tiler_group') === '1') { failRefresh = false; throw new Error('Injected final rendering failure'); } return refresh.apply(this, arguments); }; // CHANGE
        await assert.rejects(h.save(), /Injected final rendering failure/); h.graph.refresh = refresh; await h.flush(); // CHANGE
        assert.equal(h.groups().length, 0); assert.equal(Object.values(h.graph.model.cells).filter(cell => cell.getAttribute?.('plant_tiler') === '1').length, 0); // CHANGE
        await h.save(); await h.flush(); assert.equal(h.groups().length, 1); // CHANGE
    } finally { h.close(); } // CHANGE
}); // CHANGE
