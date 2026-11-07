const assert = require('node:assert/strict'); // CHANGE
const test = require('node:test'); // CHANGE
const { loadSchedulerHooks, makeCity, makePlant } = require('./helpers/garden-scheduler-harness.cjs'); // CHANGE
const { loadPlantTilerMxGraph } = require('./helpers/plant-tiler-mxgraph-harness.cjs'); // CHANGE

const hooks = loadSchedulerHooks(); // CHANGE

for (const scenario of [ // CHANGE
    { name: 'open windows take priority and names break ties', today: '2026-04-01', rows: [ // CHANGE
        ['Zulu', '2026-03-01', '2026-05-01'], ['Alpha', '2026-04-01', '2026-04-01'], ['Earlier', '2026-01-01', '2026-02-01'] // CHANGE
    ], expected: 'Alpha' }, // CHANGE
    { name: 'upcoming windows beat a closer ended window', today: '2026-06-01', rows: [ // CHANGE
        ['Alpha', '2026-05-01', '2026-05-31'], ['Zulu', '2026-08-01', '2026-09-01'] // CHANGE
    ], expected: 'Zulu' }, // CHANGE
    { name: 'future years use the earliest start and then the crop name', today: '2025-06-01', rows: [ // CHANGE
        ['Aardvark', '2026-04-01', '2026-05-01'], ['Zulu', '2026-02-01', '2026-04-01'], ['Alpha', '2026-02-01', '2026-03-01'] // CHANGE
    ], expected: 'Alpha' }, // CHANGE
    { name: 'past years use the latest end and then the crop name', today: '2027-06-01', rows: [ // CHANGE
        ['Aardvark', '2026-10-01', '2026-11-01'], ['Zulu', '2026-08-01', '2026-12-01'], ['Alpha', '2026-09-01', '2026-12-01'] // CHANGE
    ], expected: 'Alpha' }, // CHANGE
    { name: 'the last day of a window is still open', today: '2026-04-30', rows: [ // CHANGE
        ['Zulu', '2026-03-01', '2026-04-30'], ['Alpha', '2026-05-01', '2026-06-01'] // CHANGE
    ], expected: 'Zulu' } // CHANGE
]) test(`default crop: ${scenario.name}`, () => { // CHANGE
    const crops = scenario.rows.map(([plant_name], index) => makePlant(hooks, { plant_id: index + 1, plant_name })); // CHANGE
    const scores = new Map(scenario.rows.map(([, startISO, endISO], index) => [String(index + 1), { sowingSeasons: [{ id: `season-${index}`, startISO, endISO }] }])); // CHANGE
    const selected = hooks.pickDefaultCropSowingWindow(hooks.makeCropPickerOptions(crops, scores), scenario.today); // CHANGE
    assert.equal(selected.plant.plant_name, scenario.expected); // CHANGE
}); // CHANGE

test('default crop compares every season using the displayed transplant date', () => { // CHANGE
    const crops = [ // CHANGE
        makePlant(hooks, { plant_id: 1, plant_name: 'Alpha' }), // CHANGE
        makePlant(hooks, { plant_id: 2, plant_name: 'Zulu', default_planting_method: 'transplant.indoor', default_planting_method_category: 'transplant', days_transplant: 21 }) // CHANGE
    ]; // CHANGE
    const scores = new Map([ // CHANGE
        ['1', { sowingSeasons: [{ id: 'direct', startISO: '2026-06-01', endISO: '2026-07-01' }] }], // CHANGE
        ['2', { sowingSeasons: [ // CHANGE
            { id: 'spring', startISO: '2026-02-01', endISO: '2026-03-01' }, // CHANGE
            { id: 'fall', startISO: '2026-05-01', endISO: '2026-05-15' } // CHANGE
        ] }] // CHANGE
    ]); // CHANGE
    const selected = hooks.pickDefaultCropSowingWindow(hooks.makeCropPickerOptions(crops, scores), '2026-05-25'); // CHANGE
    assert.equal(selected.plant.plant_id, 2); // CHANGE
    assert.equal(selected.window.id, 'fall'); // CHANGE
    assert.equal(selected.window.startISO, '2026-05-22'); // CHANGE
    assert.equal(selected.window.endISO, '2026-06-05'); // CHANGE
}); // CHANGE

test('default crop ignores pending, failed, empty, and date-flexible results', async () => { // CHANGE
    const crops = [1, 2, 3, 4].map(plant_id => makePlant(hooks, { plant_id })); // CHANGE
    const scores = new Map([['1', { pending: true }], ['2', { error: 'Climate unavailable' }], ['3', { sowingSeasons: [] }], ['4', { rankClass: 2, hint: 'date-flexible' }]]); // CHANGE
    assert.equal(hooks.pickDefaultCropSowingWindow(hooks.makeCropPickerOptions(crops, scores), '2026-04-01'), null); // CHANGE
    const city = makeCity(hooks); city.loadDailyClimateModel = async () => { throw new Error('Injected climate failure'); }; // CHANGE
    hooks.clearCropSuitabilityCache(); // CHANGE
    const options = await hooks.scoreCropPickerOptions(crops.slice(0, 1), { city, primaryDateISO: '2026-04-01', seasonStartYear: 2026 }); // CHANGE
    assert.match(options[0].score.error, /Injected climate failure/); // CHANGE
    assert.equal(hooks.pickDefaultCropSowingWindow(options, '2026-04-01'), null); // CHANGE
}); // CHANGE

/** Run the production opening flow with real climate calculations and two sowing seasons. */ // CHANGE
function defaultCropFixture(t, { today = '2026-06-15', year = 2026, allInvalid = false } = {}) { // CHANGE
    const h = loadPlantTilerMxGraph(); // CHANGE
    t.after(() => h.close()); // CHANGE
    let crops, city, dialog; // CHANGE
    const method = { method_id: 'direct_sow.field', method_category_id: 'direct_sow', method_name: 'Field direct sow', tasks_required_json: '{}' }; // CHANGE
    const bridge = { resolvePath: async () => ({ dbPath: 'default-crop-fixture' }), open: async () => ({ dbId: 'default-crop-fixture' }), close: async () => ({}), exec: async () => ({}), // CHANGE
        async query(_id, sql, params = []) { // CHANGE
            let rows = []; // CHANGE
            if (/FROM\s+Plants\b/i.test(sql)) rows = /WHERE plant_id =/i.test(sql) ? crops.filter(crop => Number(crop.plant_id) === Number(params[0])) : crops; // CHANGE
            else if (/FROM\s+Cities\b/i.test(sql)) rows = [city]; // CHANGE
            else if (/FROM\s+PlantAllowedMethodCategories\b/i.test(sql)) rows = [{ method_category_id: 'direct_sow', method_category_name: 'Direct sow' }]; // CHANGE
            else if (/FROM\s+PlantingMethods\b/i.test(sql)) rows = [method]; // CHANGE
            return { rows }; // CHANGE
        } }; // CHANGE
    class FixtureDate extends Date { constructor(...args) { super(...(args.length ? args : [`${today}T12:00:00Z`])); } } // CHANGE: freeze only the scheduler's clock, leaving test deadlines real.
    const api = loadSchedulerHooks({ graph: h.graph, dbBridge: bridge, globals: { Date: FixtureDate, mxCellAttributeChange: h.window.mxCellAttributeChange, mxGeometry: h.window.mxGeometry } }); // CHANGE
    t.after(() => { h.ui.hideDialog(); api.__testWindow.document.defaultView.close(); }); // CHANGE
    crops = ['Unavailable', 'Zulu', 'Alpha'].map((plant_name, index) => makePlant(api, { plant_id: index + 1, plant_name, abbr: plant_name, spacing_cm: 30, tmin_c: !index || allInvalid ? 50 : 0, tmax_c: 23, topt_low_c: 10, topt_high_c: 20, default_planting_method: method.method_id, default_planting_method_category: method.method_category_id })); // CHANGE
    city = Object.assign(makeCity(api), { city_id: 1, city_name: 'Seasonal City', latitude: 45 }); // CHANGE
    [4, 6, 10, 15, 20, 26, 30, 28, 22, 16, 10, 6].forEach((mean, index) => { city[`avg_monthly_high_c${index + 1}`] = mean + 2; city[`avg_monthly_low_c${index + 1}`] = mean - 2; }); // CHANGE
    h.moduleCell.setAttribute('city_id', '1'); h.moduleCell.setAttribute('city_name', city.city_name); // CHANGE
    const bed = h.bed(300, 300); bed.setAttribute('season_start_year', String(year)); // CHANGE
    api.__testWindow.USL.tiler = h.tiler; // CHANGE
    h.ui.showDialog = node => { dialog = node; api.__testWindow.document.body.appendChild(node); }; // CHANGE
    h.ui.hideDialog = () => dialog?.remove(); // CHANGE
    h.undoManager.clear(); // CHANGE
    return { ...h, api, bed, getDialog: () => dialog, scheduler: api.__testWindow.USL.scheduler }; // CHANGE
} // CHANGE

for (const scenario of [ // CHANGE
    { label: 'past year', year: 2025, expectedSeason: 'window-2', expectedStart: '2025-08-10' }, // CHANGE
    { label: 'current year between seasons', year: 2026, expectedSeason: 'window-2', expectedStart: '2026-08-10' }, // CHANGE
    { label: 'future year', year: 2027, expectedSeason: 'window-1', expectedStart: '2027-01-01' }, // CHANGE
    { label: 'current open season', year: 2026, today: '2026-09-15', expectedSeason: 'window-2', expectedStart: '2026-09-15' } // CHANGE
]) test(`scheduler opens the default crop and matching season for ${scenario.label}`, async t => { // CHANGE
    const f = defaultCropFixture(t, scenario), before = f.bed.value.outerHTML; // CHANGE
    await f.scheduler.openBedScheduleDialog(f.ui, f.bed); // CHANGE
    const dialog = f.getDialog(), crop = dialog.querySelector('.usl-crop-combobox select'); // CHANGE
    const season = Array.from(dialog.querySelectorAll('select')).find(select => Array.from(select.options).some(option => option.value === 'window-2')); // CHANGE
    const start = Array.from(dialog.querySelectorAll('input[type="date"]')).find(input => !input.disabled && !input.readOnly); // CHANGE
    assert.equal(crop.value, '3', 'alphabetical tie selects Alpha after skipping the unavailable first crop'); // CHANGE
    assert.equal(season.value, scenario.expectedSeason); // CHANGE
    assert.equal(start.value, scenario.expectedStart); // CHANGE
    assert.equal(f.bed.value.outerHTML, before); assert.equal(f.undoManager.history.length, 0); // CHANGE
    const year = Array.from(dialog.querySelectorAll('input[type="number"]')).find(input => input.value === String(scenario.year)); // CHANGE
    year.value = '2028'; year.dispatchEvent(new f.api.__testWindow.document.defaultView.Event('input', { bubbles: true })); // CHANGE
    const deadline = Date.now() + 10000; // CHANGE
    while (!start.value.startsWith('2028-') && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10)); // CHANGE
    assert.ok(start.value.startsWith('2028-')); assert.equal(crop.value, '3', 'changing the year retains the selected crop'); // CHANGE
}); // CHANGE

test('scheduler keeps the original first-crop fallback when no windows exist', async t => { // CHANGE
    const f = defaultCropFixture(t, { allInvalid: true }); // CHANGE
    await f.scheduler.openBedScheduleDialog(f.ui, f.bed); // CHANGE
    assert.equal(f.getDialog().querySelector('.usl-crop-combobox select').value, '1'); // CHANGE
    assert.match(f.getDialog().textContent, /No feasible/); // CHANGE
}); // CHANGE

test('manual crop choices survive year changes and delayed suitability refreshes', async t => { // CHANGE
    const f = defaultCropFixture(t); // CHANGE
    await f.scheduler.openBedScheduleDialog(f.ui, f.bed); // CHANGE
    const dialog = f.getDialog(), crop = dialog.querySelector('.usl-crop-combobox select'); // CHANGE
    crop.value = '2'; crop.dispatchEvent(new f.api.__testWindow.document.defaultView.Event('change', { bubbles: true })); // CHANGE
    await new Promise(resolve => setImmediate(resolve)); // CHANGE: settle the fixture's immediate reference-data promises.
    const year = Array.from(dialog.querySelectorAll('input[type="number"]')).find(input => input.value === '2026'); // CHANGE
    year.value = '2027'; year.dispatchEvent(new f.api.__testWindow.document.defaultView.Event('input', { bubbles: true })); // CHANGE
    await new Promise(resolve => setTimeout(resolve, 250)); // CHANGE: include the existing 160 ms background ranking debounce.
    assert.equal(crop.value, '2'); // CHANGE
    assert.match(dialog.querySelector('.usl-crop-combobox-button').textContent, /^Zulu/); // CHANGE
}); // CHANGE

for (const saved of [false, true]) test(`scheduler preserves a specified crop ${saved ? 'and its saved date' : 'without a saved schedule'}`, async t => { // CHANGE
    const f = defaultCropFixture(t); // CHANGE
    const node = f.window.mxUtils.createXmlDocument().createElement('object'); // CHANGE
    Object.entries({ tiler_group: '1', plant_id: '2', plant_name: 'Zulu', sow_date: saved ? '2026-03-15' : '', season_start_year: '2026', method_id: 'direct_sow.field', method_category_id: 'direct_sow' }).forEach(([key, value]) => node.setAttribute(key, value)); // CHANGE
    const crop = f.graph.insertVertex(f.bed, null, node, 0, 0, 50, 50); // CHANGE
    await f.scheduler.openScheduleDialog(f.ui, crop); // CHANGE
    assert.equal(f.getDialog().querySelector('.usl-crop-combobox select').value, '2'); // CHANGE
    if (saved) assert.ok(Array.from(f.getDialog().querySelectorAll('input[type="date"]')).some(input => input.value === '2026-03-15')); // CHANGE
}); // CHANGE
