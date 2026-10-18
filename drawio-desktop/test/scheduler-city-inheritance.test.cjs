const assert = require('node:assert/strict'); // CHANGE
const test = require('node:test'); // CHANGE
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
