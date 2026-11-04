const assert = require('node:assert/strict'); // CHANGE
const test = require('node:test'); // CHANGE
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'); // CHANGE: exercise scheduler navigation with the production editing guard.
const { loadPlantTilerMxGraph } = require('./helpers/plant-tiler-mxgraph-harness.cjs'); // CHANGE
const { loadSchedulerHooks, makeCity, makePlant } = require('./helpers/garden-scheduler-harness.cjs'); // CHANGE

/** Open the production scheduler against two cities and a real mxGraph model/undo history. */ // CHANGE
function cityFixture(t, { gardenAttrs = {}, cropAttrs = {}, duplicateName = false, frostDOY = 1, derived = false } = {}) { // CHANGE
    const h = loadPlantTilerMxGraph(); // CHANGE
    t.after(() => h.close()); // CHANGE
    let plant, candidate, cities, dialog, onClose; // CHANGE
    const climateCities = []; // CHANGE
    const method = { method_id: 'direct_sow.field', method_category_id: 'direct_sow', method_name: 'Field direct sow', tasks_required_json: '{}' }; // CHANGE
    const bridge = { resolvePath: async () => ({ dbPath: 'city-fixture' }), open: async () => ({ dbId: 'city-fixture' }), close: async () => ({}), exec: async () => ({}), // CHANGE
        query: async (_id, sql, params = []) => { // CHANGE
            let rows = []; // CHANGE
            if (/FROM\s+Plants\b/i.test(sql)) { // CHANGE
                rows = candidate ? [plant, candidate] : [plant]; // CHANGE
                if (/WHERE plant_id =/i.test(sql)) rows = rows.filter(row => Number(row.plant_id) === Number(params[0])); // CHANGE
            } // CHANGE
            else if (/FROM\s+Cities\b/i.test(sql)) { // CHANGE
                rows = cities; // CHANGE
                if (/WHERE city_id =/i.test(sql)) rows = rows.filter(city => Number(city.city_id) === Number(params[0])); // CHANGE
                else if (/WHERE city_name =/i.test(sql)) rows = rows.filter(city => city.city_name === params[0]); // CHANGE
            } else if (/FROM\s+PlantAllowedMethodCategories\b/i.test(sql)) rows = [{ plant_id: 1, method_category_id: 'direct_sow', method_category_name: 'Direct sow' }]; // CHANGE
            else if (/FROM\s+PlantingMethods\b/i.test(sql)) rows = [method]; // CHANGE
            return { rows }; // CHANGE
        } }; // CHANGE
    const api = loadSchedulerHooks({ graph: h.graph, dbBridge: bridge, globals: { mxCellAttributeChange: h.window.mxCellAttributeChange, mxGeometry: h.window.mxGeometry } }); // CHANGE
    t.after(() => api.__testWindow.document.defaultView.close()); // CHANGE
    plant = makePlant(api, { plant_name: 'Lettuce', spacing_cm: 30, default_planting_method: method.method_id, default_planting_method_category: method.method_category_id }); // CHANGE
    if (derived) candidate = makePlant(api, { ...plant, plant_id: 2, plant_name: 'Basil' }); // CHANGE: turnover excludes the source crop from its candidates.
    cities = [Object.assign(makeCity(api, 10), { city_id: 1, city_name: 'Old City', latitude: 45 }), Object.assign(makeCity(api, 20), { city_id: 2, city_name: 'Current City', latitude: 45, last_spring_frost_doy: frostDOY })]; // CHANGE
    if (duplicateName) cities.push(Object.assign({}, cities[1], { city_id: 3 })); // CHANGE
    const loadClimate = api.CityClimate.prototype.loadDailyClimateModel; // CHANGE
    api.CityClimate.prototype.loadDailyClimateModel = function (options) { climateCities.push(this.city_id); return loadClimate.call(this, options); }; // CHANGE: observe the actual climate requests, not just the picker label.
    const value = attrs => { const node = h.window.mxUtils.createXmlDocument().createElement('object'); Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, value)); return node; }; // CHANGE
    Object.entries({ city_id: '2', city_name: 'Current City', ...gardenAttrs }).forEach(([key, value]) => h.moduleCell.setAttribute(key, value)); // CHANGE
    const bed = h.bed(300, 300); // CHANGE
    const crop = h.graph.insertVertex(bed, 'crop', value({ tiler_group: '1', plant_id: '1', plant_name: 'Lettuce', city_id: '1', city_name: 'Old City', method_id: method.method_id, method_category_id: method.method_category_id, sow_date: '2026-04-01', germ_date: '2026-04-06', maturity_date: '2026-06-01', harvest_start: '2026-06-01', harvest_end: '2026-06-08', season_start_year: '2026', ...cropAttrs }), 0, 0, 50, 50); // CHANGE
    api.__testWindow.USL.tiler = h.tiler; // CHANGE
    api.__testWindow.USL.tasks = { applySchedulerTaskReplacement() {} }; // CHANGE
    h.ui.showDialog = (node, _width, _height, _modal, _closable, close) => { dialog = node; onClose = close; api.__testWindow.document.body.appendChild(node); }; // CHANGE
    h.ui.hideDialog = () => { dialog?.remove(); onClose?.(); }; // CHANGE
    const snapshot = () => crop.value.outerHTML; // CHANGE
    h.undoManager.clear(); // CHANGE
    const scheduler = api.__testWindow.USL.scheduler; // CHANGE
    return { ...h, api, scheduler, bed, crop, cities, climateCities, snapshot, getDialog: () => dialog, open: () => scheduler.openScheduleDialog(h.ui, crop) }; // CHANGE
} // CHANGE

/** Wait for async save/validation work to settle without depending on a fixed timeout. */ // CHANGE
async function waitFor(predicate) { // CHANGE
    const deadline = Date.now() + 10000; // CHANGE
    while (!predicate() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10)); // CHANGE
    assert.ok(predicate(), 'scheduler action should settle'); // CHANGE
} // CHANGE

function action(f, label) { return Array.from(f.getDialog().querySelectorAll('button')).find(button => button.textContent === label); } // CHANGE

/** Real editing holds expose accidental commits, baseline resets and releases during navigation. */ // CHANGE
function trackSchedulerDraft(t, f) { // CHANGE
    const window = f.api.__testWindow, view = window.document.defaultView, calls = { decisions: 0, checkpoints: 0, releases: 0 }; // CHANGE
    window.setInterval = view.setInterval.bind(view); window.clearInterval = view.clearInterval.bind(view); // CHANGE
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../drawio/src/main/webapp/js/trellis-editing-holds.js'), 'utf8'), { window, Date }); // CHANGE
    let editor; // CHANGE
    const holds = window.TrellisEditingHolds.create(f.ui, { // CHANGE
        isCollaborative: () => true, status() {}, decide() { calls.decisions++; return 'stay'; }, // CHANGE
        async claim(targets) { holds.update(targets.map(key => ({ key, sessionId: 'local', claimId: 'draft' })), 'local'); return { ok: true }; }, // CHANGE
        async release() { calls.releases++; holds.update([], 'local'); } // CHANGE
    }); // CHANGE
    window.Trellis = { sharing: { registerEditor(config) { // CHANGE
        editor = holds.register(config); const checkpoint = editor.checkpoint; // CHANGE
        editor.checkpoint = () => { calls.checkpoints++; checkpoint(); }; return editor; // CHANGE
    } } }; // CHANGE
    t.after(() => { holds.reset(); view.dispatchEvent(new view.Event('beforeunload')); }); // CHANGE
    return { calls, holds, editor: () => editor }; // CHANGE
} // CHANGE

for (const bedFirst of [false, true]) test(`${bedFirst ? 'bed-first' : 'existing'} scheduler tabs preserve incomplete tasks and retain the dirty editing hold`, async t => { // CHANGE
    const f = cityFixture(t), tracking = trackSchedulerDraft(t, f), before = f.snapshot(); // CHANGE
    await (bedFirst ? f.scheduler.openBedScheduleDialog(f.ui, f.bed) : f.open()); // CHANGE
    const schedule = f.getDialog().querySelector('.usl-scheduler-body').firstChild; // CHANGE
    const start = Array.from(schedule.querySelectorAll('input[type="date"]')).find(input => !input.disabled && !input.readOnly); // CHANGE
    start.value = '2026-04-09'; start.dispatchEvent(new f.api.__testWindow.document.defaultView.Event('input', { bubbles: true })); // CHANGE
    action(f, 'Tasks').click(); await waitFor(() => action(f, 'Add Task')); // CHANGE
    const tasks = f.getDialog().querySelector('.usl-scheduler-body').firstChild; // CHANGE
    action(f, 'Add Task').click(); await waitFor(() => tasks.querySelector('[aria-label="Task instructions"]')); // CHANGE
    const instructions = tasks.querySelector('[aria-label="Task instructions"]'); instructions.value = 'Unfinished task notes'; // CHANGE
    instructions.dispatchEvent(new f.api.__testWindow.document.defaultView.Event('input', { bubbles: true })); // CHANGE
    const recipeSave = Array.from(tasks.querySelectorAll('.usl-scheduler-row')).find(row => row.textContent === 'Save task recipe').querySelector('input'); // CHANGE
    recipeSave.checked = true; recipeSave.dispatchEvent(new f.api.__testWindow.document.defaultView.Event('change', { bubbles: true })); // CHANGE
    const recipeName = tasks.querySelector('input[placeholder="Recipe name"]'); recipeName.value = 'Draft recipe'; // CHANGE
    recipeName.dispatchEvent(new f.api.__testWindow.document.defaultView.Event('input', { bubbles: true })); // CHANGE
    const taskEditor = instructions.closest('[data-trellis-surface="inset"]').parentElement; // CHANGE
    const recipeFields = recipeName.closest('.usl-scheduler-row').parentElement; // CHANGE
    const controls = [...taskEditor.querySelectorAll('input,textarea,select'), ...recipeFields.querySelectorAll('input,textarea,select'), recipeSave]; // CHANGE
    for (let index = 0; index < 3; index++) { // CHANGE
        action(f, 'Schedule').click(); assert.equal(f.getDialog().querySelector('.usl-scheduler-body').firstChild, schedule); // CHANGE
        action(f, 'Tasks').click(); assert.equal(f.getDialog().querySelector('.usl-scheduler-body').firstChild, tasks); // CHANGE
    } // CHANGE
    await waitFor(() => tracking.holds.pinnedTargets().length === 1); // CHANGE
    assert.equal(instructions.isConnected, true); assert.equal(instructions.value, 'Unfinished task notes'); // CHANGE
    assert.equal(recipeSave.checked, true); assert.equal(recipeName.value, 'Draft recipe'); // CHANGE
    assert.ok(controls.every(control => tasks.contains(control)), 'editable task and recipe controls retain identity'); // CHANGE
    assert.equal(start.value, '2026-04-09'); assert.equal(tracking.editor().dirty(), true); // CHANGE
    assert.deepEqual(tracking.calls, { decisions: 0, checkpoints: 0, releases: 0 }); // CHANGE
    assert.equal(f.snapshot(), before); assert.equal(f.undoManager.history.length, 0); // CHANGE
    assert.equal(await tracking.holds.transition(() => assert.fail('leaving the dirty editor must still be guarded')), false); // CHANGE
    assert.equal(tracking.calls.decisions, 1); // CHANGE
    f.getDialog().querySelector('.usl-scheduler-footer-actions button:last-child').click(); // CHANGE
    assert.equal(f.snapshot(), before); assert.equal(f.undoManager.history.length, 0); // CHANGE
}); // CHANGE

test('clean scheduler navigation does not create an unsaved planting edit', async t => { // CHANGE
    const f = cityFixture(t), tracking = trackSchedulerDraft(t, f); await f.open(); // CHANGE
    assert.equal(tracking.editor().dirty(), false); action(f, 'Tasks').click(); // CHANGE
    await waitFor(() => f.getDialog().textContent.includes('task occurrence')); // CHANGE
    action(f, 'Schedule').click(); assert.equal(tracking.editor().dirty(), false); // CHANGE
    assert.deepEqual(tracking.calls, { decisions: 0, checkpoints: 0, releases: 0 }); // CHANGE
}); // CHANGE

test('task additions, edits and deletions survive navigation, failed Save and successful retry with schedule edits', async t => { // CHANGE
    const rule = (id, title) => ({ id, title, taskTypeId: 'general', startAnchorStage: 'SOW', endMode: 'fixed_days', durationDays: 0 }); // CHANGE
    const f = cityFixture(t, { cropAttrs: { task_template_json: JSON.stringify({ version: 2, rules: [rule('water', 'Water'), rule('weed', 'Weed')] }) } }); // CHANGE
    const tracking = trackSchedulerDraft(t, f), before = f.snapshot(); await f.open(); // CHANGE
    const schedule = f.getDialog().querySelector('.usl-scheduler-body').firstChild; action(f, 'Tasks').click(); // CHANGE
    const tasks = f.getDialog().querySelector('.usl-scheduler-body').firstChild; action(f, 'Edit').click(); // CHANGE
    await waitFor(() => tasks.querySelector('[aria-label="Task instructions"]')); // CHANGE
    const editor = tasks.querySelector('[aria-label="Task instructions"]').closest('[data-trellis-surface="inset"]').parentElement; // CHANGE
    const title = Array.from(editor.querySelectorAll('.usl-scheduler-row')).find(row => row.textContent === 'Title').querySelector('input'); // CHANGE
    title.value = 'Edited water'; title.dispatchEvent(new f.api.__testWindow.document.defaultView.Event('input', { bubbles: true })); // CHANGE
    Array.from(editor.querySelectorAll('button')).find(button => button.textContent === 'Save').click(); // CHANGE
    await waitFor(() => Array.from(tasks.querySelectorAll('button')).some(button => button.textContent === 'Delete' && button.parentElement.parentElement.textContent.includes('Edited water'))); // CHANGE
    Array.from(tasks.querySelectorAll('button')).find(button => button.textContent === 'Delete' && button.parentElement.parentElement.textContent.includes('Weed')).click(); // CHANGE
    await waitFor(() => !Array.from(tasks.querySelectorAll('button')).some(button => button.textContent === 'Delete' && button.parentElement.parentElement.textContent.includes('Weed'))); // CHANGE
    action(f, 'Add Task').click(); await waitFor(() => tasks.querySelector('[aria-label="Task instructions"]')); // CHANGE
    const adding = tasks.querySelector('[aria-label="Task instructions"]').closest('[data-trellis-surface="inset"]').parentElement; // CHANGE
    Array.from(adding.querySelectorAll('.usl-scheduler-row')).find(row => row.textContent === 'Title').querySelector('input').value = 'New feed'; // CHANGE
    Array.from(adding.querySelectorAll('button')).find(button => button.textContent === 'Save').click(); // CHANGE
    await waitFor(() => Array.from(tasks.querySelectorAll('button')).some(button => button.textContent === 'Delete' && button.parentElement.parentElement.textContent.includes('New feed'))); // CHANGE
    action(f, 'Schedule').click(); // CHANGE
    const start = Array.from(schedule.querySelectorAll('input[type="date"]')).find(input => !input.disabled && !input.readOnly); // CHANGE
    start.value = '2026-04-09'; start.dispatchEvent(new f.api.__testWindow.document.defaultView.Event('input', { bubbles: true })); // CHANGE
    action(f, 'Tasks').click(); await waitFor(() => tasks.querySelector('[title^="Edited water"][title*="2026-04-09"]')); // CHANGE
    assert.equal(f.snapshot(), before); assert.equal(f.undoManager.history.length, 0); // CHANGE
    let rejectSave = true; f.api.__testWindow.USL.tasks.applySchedulerTaskReplacement = () => { if (rejectSave) throw new Error('Injected tab-draft save failure'); }; // CHANGE
    f.getDialog().querySelector('.usl-scheduler-footer button[title="Save this planting schedule and apply its task rules."]').click(); // CHANGE
    await waitFor(() => schedule.textContent.includes('Injected tab-draft save failure')); // CHANGE
    assert.equal(f.snapshot(), before); assert.equal(tracking.editor().dirty(), true); // CHANGE
    action(f, 'Schedule').click(); action(f, 'Tasks').click(); // CHANGE
    assert.match(tasks.textContent, /Edited water/); assert.match(tasks.textContent, /New feed/); // CHANGE
    rejectSave = false; f.getDialog().querySelector('.usl-scheduler-footer button[title="Save this planting schedule and apply its task rules."]').click(); // CHANGE
    await waitFor(() => !f.getDialog().isConnected); // CHANGE
    assert.equal(f.crop.getAttribute('sow_date'), '2026-04-09'); // CHANGE
    assert.deepEqual(JSON.parse(f.crop.getAttribute('task_template_json')).rules.map(rule => rule.title), ['Edited water', 'New feed']); // CHANGE
    assert.equal(tracking.calls.decisions, 0); // CHANGE
}); // CHANGE

test('lifecycle task links locate retained rows even when the preview sorts rules differently', async t => { // CHANGE
    const template = { version: 2, rules: [ // CHANGE
        { id: 'harvest', title: 'Harvest', startAnchorStage: 'HARVEST_START', endMode: 'fixed_days', durationDays: 1 }, // CHANGE
        { id: 'sow', title: 'Sow', startAnchorStage: 'SOW', endMode: 'fixed_days', durationDays: 1 } // CHANGE
    ] }; // CHANGE
    const f = cityFixture(t, { cropAttrs: { task_template_json: JSON.stringify(template) } }), tracking = trackSchedulerDraft(t, f); await f.open(); // CHANGE
    action(f, 'Tasks').click(); await waitFor(() => f.getDialog().querySelector('[title^="Harvest"][title*="2026-05-01"]')); action(f, 'Schedule').click(); // CHANGE
    Array.from(f.getDialog().querySelectorAll('[data-usl-lifecycle-marker]')).find(marker => marker.textContent === 'HS').click(); // CHANGE
    await waitFor(() => f.getDialog().querySelector('[aria-label="Task instructions"]')); // CHANGE
    const editor = f.getDialog().querySelector('[aria-label="Task instructions"]').closest('[data-trellis-surface="inset"]').parentElement; // CHANGE
    assert.match(editor.previousElementSibling.textContent, /^Harvest/); // CHANGE
    assert.equal(tracking.calls.decisions, 0); assert.equal(tracking.calls.checkpoints, 0); // CHANGE
}); // CHANGE

for (const returnToTasks of [false, true]) test(`a delayed lifecycle-link preview cannot replace newer navigation ${returnToTasks ? 'back to Tasks' : 'to Schedule'}`, async t => { // CHANGE
    const template = { version: 2, rules: [{ id: 'harvest', title: 'Harvest', startAnchorStage: 'HARVEST_START', endMode: 'fixed_days', durationDays: 1 }] }; // CHANGE
    const f = cityFixture(t, { cropAttrs: { task_template_json: JSON.stringify(template) } }), tracking = trackSchedulerDraft(t, f); await f.open(); // CHANGE
    action(f, 'Tasks').click(); await waitFor(() => f.getDialog().querySelector('[title^="Harvest"][title*="2026-05-01"]')); action(f, 'Schedule').click(); // CHANGE
    const marker = Array.from(f.getDialog().querySelectorAll('[data-usl-lifecycle-marker]')).find(marker => marker.textContent === 'HS'); // CHANGE
    assert.ok(marker, 'harvest milestone provides a task link'); // CHANGE
    const query = f.api.__testWindow.dbBridge.query; let release; // CHANGE
    f.api.__testWindow.dbBridge.query = async (...args) => { // CHANGE
        if (!release && /FROM\s+Plants\b/i.test(args[1])) await new Promise(resolve => { release = resolve; }); // CHANGE
        return query(...args); // CHANGE
    }; // CHANGE
    marker.click(); await waitFor(() => release); // CHANGE
    assert.equal(f.getDialog().querySelector('.usl-scheduler-tab[data-active="true"]').textContent, 'Tasks'); // CHANGE
    const tasks = f.getDialog().querySelector('.usl-scheduler-body').firstChild; action(f, 'Schedule').click(); // CHANGE
    let instructions = null; // CHANGE
    if (returnToTasks) { // CHANGE
        action(f, 'Tasks').click(); action(f, 'Add Task').click(); // CHANGE
        await waitFor(() => tasks.querySelector('[aria-label="Task instructions"]')); // CHANGE
        instructions = tasks.querySelector('[aria-label="Task instructions"]'); instructions.value = 'Keep the newer task editor'; // CHANGE
    } // CHANGE
    release(); await new Promise(resolve => setImmediate(resolve)); // CHANGE: complete the older promise chain before inspecting the retained editor.
    assert.equal(f.getDialog().querySelector('.usl-scheduler-tab[data-active="true"]').textContent, returnToTasks ? 'Tasks' : 'Schedule'); // CHANGE
    assert.equal(tasks.querySelector('[aria-label="Task instructions"]'), instructions); // CHANGE
    if (instructions) assert.equal(instructions.value, 'Keep the newer task editor'); // CHANGE
    assert.deepEqual(tracking.calls, { decisions: 0, checkpoints: 0, releases: 0 }); // CHANGE
}); // CHANGE

test('existing schedule inherits the current city and cancellation leaves dates, city, and undo history untouched', async t => { // CHANGE
    const f = cityFixture(t); // CHANGE
    const before = f.snapshot(); // CHANGE
    await f.open(); // CHANGE
    const picker = f.getDialog().querySelector('.usl-city-picker'); // CHANGE
    assert.equal(picker.value, '2'); // CHANGE
    assert.equal(picker.tabIndex, -1); // CHANGE
    assert.ok(Array.from(picker.querySelectorAll('button, input')).every(control => control.disabled && control.title === 'City is inherited from Garden Settings.')); // CHANGE
    assert.match(f.getDialog().querySelector('[data-scheduler-city-changed]').textContent, /The garden’s city has changed\. This preview uses Current City\. Save to update this schedule\./); // CHANGE
    assert.ok(f.climateCities.length > 0); assert.ok(f.climateCities.every(id => id === 2)); // CHANGE
    assert.equal(f.snapshot(), before); assert.equal(f.undoManager.history.length, 0); // CHANGE
    action(f, 'Cancel').click(); // CHANGE
    assert.equal(f.snapshot(), before); assert.equal(f.undoManager.history.length, 0); // CHANGE
}); // CHANGE

test('saving adopts the garden city and calculated dates in the same undoable edit', async t => { // CHANGE
    const f = cityFixture(t); // CHANGE
    const before = f.snapshot(); // CHANGE
    await f.open(); action(f, 'Save').click(); // CHANGE
    await waitFor(() => !f.getDialog().isConnected || (!action(f, 'Save').disabled && f.getDialog().textContent.includes('Scheduling error:'))); // CHANGE
    assert.equal(f.getDialog().isConnected, false, f.getDialog().textContent); // CHANGE
    assert.equal(f.crop.getAttribute('city_id'), '2'); assert.equal(f.crop.getAttribute('city_name'), 'Current City'); // CHANGE
    assert.equal(f.crop.getAttribute('sow_date'), '2026-04-01'); // CHANGE
    assert.notEqual(f.crop.getAttribute('harvest_end'), '2026-06-08'); // CHANGE
    assert.equal(f.undoManager.history.length, 1); // CHANGE
    f.undoManager.undo(); assert.equal(f.snapshot(), before); // CHANGE
    f.undoManager.redo(); assert.equal(f.crop.getAttribute('city_id'), '2'); assert.notEqual(f.crop.getAttribute('harvest_end'), '2026-06-08'); // CHANGE
}); // CHANGE

test('a saved planting date outside the new city windows is preserved and invalid save leaves the crop unchanged', async t => { // CHANGE
    const f = cityFixture(t, { frostDOY: 200 }); // CHANGE
    const before = f.snapshot(); // CHANGE
    await f.open(); // CHANGE
    const dates = Array.from(f.getDialog().querySelectorAll('input[type="date"]')); // CHANGE
    assert.ok(dates.some(input => input.value === '2026-04-01' && !input.readOnly), 'the saved start remains an editable input'); // CHANGE
    action(f, 'Save').click(); // CHANGE
    await waitFor(() => !action(f, 'Save').disabled && f.getDialog().textContent.includes('Scheduling error:')); // CHANGE
    assert.equal(f.snapshot(), before); assert.equal(f.undoManager.history.length, 0); // CHANGE
    assert.ok(f.climateCities.every(id => id === 2)); // CHANGE
    f.ui.hideDialog(); assert.equal(f.snapshot(), before); // CHANGE
}); // CHANGE

test('a task replacement failure rolls back the adopted city and calculated dates together', async t => { // CHANGE
    const f = cityFixture(t); const before = f.snapshot(); // CHANGE
    f.api.__testWindow.USL.tasks.applySchedulerTaskReplacement = () => { throw new Error('Injected city-save failure'); }; // CHANGE
    await f.open(); action(f, 'Save').click(); // CHANGE
    await waitFor(() => !action(f, 'Save').disabled && f.getDialog().textContent.includes('Injected city-save failure')); // CHANGE
    assert.equal(f.snapshot(), before); // CHANGE
    assert.equal(f.getDialog().isConnected, true); // CHANGE
    f.ui.hideDialog(); assert.equal(f.snapshot(), before); // CHANGE
}); // CHANGE

for (const scenario of [ // CHANGE
    { label: 'missing', gardenAttrs: { city_id: '', city_name: '' } }, // CHANGE
    { label: 'unknown', gardenAttrs: { city_id: '999', city_name: 'Unknown City' } }, // CHANGE
    { label: 'ambiguous', gardenAttrs: { city_id: '', city_name: 'Current City' }, duplicateName: true } // CHANGE
]) test(`${scenario.label} garden city blocks editing despite a valid saved crop city`, async t => { // CHANGE
    const f = cityFixture(t, scenario); const before = f.snapshot(); // CHANGE
    await assert.rejects(f.open(), /Garden Settings/); // CHANGE
    assert.equal(f.getDialog(), undefined); assert.equal(f.snapshot(), before); assert.equal(f.undoManager.history.length, 0); // CHANGE
}); // CHANGE

test('unique legacy garden name resolves without backfilling the garden or crop on close', async t => { // CHANGE
    const f = cityFixture(t, { gardenAttrs: { city_id: '', city_name: 'Current City' } }); const before = f.snapshot(); // CHANGE
    await f.open(); // CHANGE
    assert.equal(f.getDialog().querySelector('.usl-city-picker').value, '2'); // CHANGE
    f.ui.hideDialog(); // CHANGE
    assert.equal(f.moduleCell.getAttribute('city_id'), ''); assert.equal(f.snapshot(), before); assert.equal(f.undoManager.history.length, 0); // CHANGE
}); // CHANGE

test('same city ID after a rename does not show a location-change notice', async t => { // CHANGE
    const f = cityFixture(t, { cropAttrs: { city_id: '2', city_name: 'Previous name' } }); // CHANGE
    await f.open(); // CHANGE
    assert.equal(f.getDialog().querySelector('[data-scheduler-city-changed]'), null); // CHANGE
    assert.equal(f.getDialog().querySelector('.usl-city-picker').value, '2'); // CHANGE
    f.ui.hideDialog(); // CHANGE
}); // CHANGE

for (const cropAttrs of [{ city_id: '1', city_name: 'Current City' }, { city_id: '', city_name: 'Old City' }]) // CHANGE
test(`city-change notice identifies ${cropAttrs.city_id ? 'different IDs with matching names' : 'legacy name-only snapshots'}`, async t => { // CHANGE
    const f = cityFixture(t, { cropAttrs }); // CHANGE
    await f.open(); // CHANGE
    assert.ok(f.getDialog().querySelector('[data-scheduler-city-changed]')); // CHANGE
    f.ui.hideDialog(); // CHANGE
}); // CHANGE

test('new bed schedules inherit the garden city without writing to the bed or source crop', async t => { // CHANGE
    const f = cityFixture(t); const before = f.snapshot(); const bedBefore = f.bed.value.outerHTML; // CHANGE
    await f.scheduler.openBedScheduleDialog(f.ui, f.bed); // CHANGE
    assert.equal(f.getDialog().querySelector('.usl-city-picker').value, '2'); // CHANGE
    assert.equal(f.getDialog().querySelector('[data-scheduler-city-changed]'), null); // CHANGE
    f.ui.hideDialog(); // CHANGE
    assert.equal(f.snapshot(), before); assert.equal(f.bed.value.outerHTML, bedBefore); assert.equal(f.undoManager.history.length, 0); // CHANGE
}); // CHANGE

test('derived turnover opens with the current garden city without modifying the source schedule', async t => { // CHANGE
    const f = cityFixture(t, { derived: true }); const before = f.snapshot(); // CHANGE
    await f.scheduler.openDerivedScheduleDialog(f.ui, f.crop, { mode: 'turnover' }); // CHANGE
    assert.equal(f.getDialog().querySelector('.usl-city-picker').value, '2'); // CHANGE
    assert.ok(f.climateCities.length > 0); assert.ok(f.climateCities.every(id => id === 2)); // CHANGE
    f.ui.hideDialog(); // CHANGE
    assert.equal(f.snapshot(), before); assert.equal(f.undoManager.history.length, 0); // CHANGE
}); // CHANGE
