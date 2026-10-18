const assert = require('node:assert/strict'); // CHANGE
const test = require('node:test'); // CHANGE
const { createSchedulerOverlapFixture, waitFor } = require('./helpers/scheduler-overlap-fixture.cjs'); // CHANGE
const { loadSchedulerHooks } = require('./helpers/garden-scheduler-harness.cjs'); // CHANGE

test('Basil identity survives the navigator and rendered Edit schedule; current ratings override snapshots', async t => { // CHANGE
    const f = createSchedulerOverlapFixture(t); // CHANGE
    const source = f.graph.__trellisBedSuccessionNavigator.getSelectedClusterOccupancy(f.crop).items.find(item => item.cellId === 'basil'); // CHANGE
    assert.equal(source.plantId, '2'); assert.equal(source.relationship.rating, '-1'); // CHANGE
    const before = f.snapshot(); // CHANGE
    await f.open(); // CHANGE
    const dialog = f.getDialog(); // CHANGE
    assert.equal(dialog.querySelector('[data-scheduler-timing]').textContent, 'Starts 16d after Basil'); // CHANGE
    assert.equal(dialog.querySelector('[data-scheduler-compatibility]').textContent, 'Companion overlap with Basil'); // CHANGE
    const lane = dialog.querySelector('[data-scheduler-context-date="basil"]'); // CHANGE
    assert.match(lane.textContent, /Basil — Harvest end: 2027-03-01/); // CHANGE
    assert.equal(lane.querySelector('[data-scheduler-context-marker]'), null); // CHANGE
    assert.match(dialog.textContent, /Nearby planting timing/); assert.equal(f.snapshot(), before); // CHANGE
}); // CHANGE

test('Save refreshes ratings and blocks an incompatible third overlap before mutations', async t => { // CHANGE
    const f = createSchedulerOverlapFixture(t); // CHANGE
    f.basil.setAttribute('sow_date', '2026-10-17'); // CHANGE
    f.planting('lettuce', { plant_id: '3', plant_name: 'Lettuce', sow_date: '2026-10-18', harvest_end: '2026-11-15' }); // CHANGE
    f.planting('fennel', { plant_id: '4', plant_name: 'Fennel', sow_date: '2026-01-01', harvest_end: '2027-01-01' }); // CHANGE
    await f.open(); // CHANGE
    assert.doesNotMatch(f.getDialog().querySelector('[data-scheduler-timing]').textContent, /Fennel/); // CHANGE
    f.state.relationships.push({ relation_id: 14, source_plant_id: 4, companion_plant_id: 1, rating: -1 }); // CHANGE: inverse pair and an update after opening must be respected at Save.
    const before = f.snapshot(), writes = f.state.writes.length, lookups = f.state.lookups.length; // CHANGE
    f.undoManager.clear(); f.button('Save').click(); // CHANGE
    await waitFor(() => !f.button('Save').disabled && f.getDialog().textContent.includes('Scheduling error:')); // CHANGE
    assert.match(f.getDialog().querySelector('[data-scheduler-compatibility]').textContent, /Incompatible overlap with Fennel/); // CHANGE
    assert.match(f.getDialog().textContent, /Scheduling error: Incompatible overlap with Fennel/); // CHANGE
    assert.ok(f.state.lookups.length > lookups); assert.equal(f.snapshot(), before); // CHANGE
    assert.equal(f.state.writes.length, writes); assert.equal(f.state.taskCalls, 0); assert.equal(f.undoManager.history.length, 0); // CHANGE
}); // CHANGE

test('Allocate shares timing lanes and preserves labels outside the axis and allocation recommendations', async t => { // CHANGE
    const f = createSchedulerOverlapFixture(t); // CHANGE
    f.planting('previous', { plant_id: '3', plant_name: 'Lettuce', sow_date: '2026-09-01', harvest_end: '2026-10-10' }); // CHANGE
    f.planting('following', { plant_id: '5', plant_name: 'Carrot', sow_date: '2026-12-01', harvest_end: '2027-01-01' }); // CHANGE
    const { pending } = await f.openAllocation(); // CHANGE
    const dialog = f.getDialog(); // CHANGE
    assert.equal(dialog.querySelector('[data-scheduler-timing]').textContent, 'Starts 16d after Basil'); // CHANGE
    assert.match(dialog.querySelector('[data-scheduler-compatibility]').textContent, /Companion overlap with Basil/); // CHANGE
    const lanes = Array.from(dialog.querySelectorAll('[data-scheduler-context-date]')); // CHANGE
    assert.deepEqual(lanes.map(lane => lane.getAttribute('data-scheduler-context-date')), ['previous', 'following', 'basil']); // CHANGE
    assert.match(lanes[0].textContent, /Harvest end: 2026-10-10/); assert.match(lanes[1].textContent, /Occupancy start: 2026-12-01/); // CHANGE
    assert.equal(lanes[2].querySelector('[data-scheduler-context-marker]'), null); // CHANGE
    assert.match(dialog.querySelector('[data-allocation-timing-comparisons]').textContent, /No recommended offset/); // CHANGE
    f.button('Cancel').click(); assert.equal((await pending).action, 'cancel'); // CHANGE
}); // CHANGE

test('comparison normalization retains metadata, rejects bad dates, and keeps complete overlaps separate from the text cap', () => { // CHANGE
    const h = loadSchedulerHooks(); // CHANGE
    const relationship = { mode: 'turnover', gapDays: '7' }; // CHANGE
    const items = [ // CHANGE
        { cellId: 'earlier', plantId: '2', label: 'Basil', startISO: '2026-10-01', endISO: '2027-03-01', relationship }, // CHANGE
        { cellId: 'same', plant_id: '3', label: 'Lettuce', startISO: '2026-10-17', endISO: '2026-10-17' }, // CHANGE
        { cellId: 'later', plantId: '4', label: 'Fennel', startISO: '2026-11-20', endISO: '2026-12-01' }, // CHANGE
        { cellId: 'bad-calendar', label: 'Invalid', startISO: '2026-02-30', endISO: '2026-11-20' }, // CHANGE
        { cellId: 'reversed', startISO: '2026-12-01', endISO: '2026-10-01' }, // CHANGE
        { cellId: 'self', startISO: '2026-10-17', endISO: '2026-11-20' }, // CHANGE
        { cellId: 'same', plantId: '3', startISO: '2026-10-17', endISO: '2026-10-17' } // CHANGE
    ]; // CHANGE
    const hints = h.computeSchedulerAdjacentGapHints(items, { startISO: '2026-10-17', endISO: '2026-11-20' }, { excludeCellIds: ['self'] }); // CHANGE
    assert.equal(hints.allOverlaps.length, 3); assert.equal(hints.overlaps.length, 2); assert.match(hints.text, /\+1 more/); // CHANGE
    assert.equal(hints.allOverlaps[0].plantId, '2'); assert.equal(hints.allOverlaps[0].relationship, relationship); // CHANGE
    assert.deepEqual(Array.from(hints.nearby, item => [item.cellId, item.dateLabel, item.markerISO]), [['same', 'Occupancy start', '2026-10-17'], ['later', 'Occupancy start', '2026-11-20'], ['earlier', 'Harvest end', '2027-03-01']]); // CHANGE
    const model = h.buildLifecycleTimelineViewModel({ seasonStartYear: 2026, nearbyPlantings: hints.nearby }); // CHANGE
    assert.equal(model.contextualDates.length, 3); assert.equal(model.contextualDates[2].percent, null); // CHANGE
    assert.equal(model.bounds.startISO, '2026-01-01'); assert.equal(model.bounds.endISO, '2026-12-31'); // CHANGE
    assert.equal(h.computeSchedulerAdjacentGapHints(items, { startISO: '2026-02-30', endISO: '2026-11-20' }).nearby.length, 0); // CHANGE
    h.__testWindow.document.defaultView.close(); // CHANGE
}); // CHANGE

test('compatibility needs a current finite rating and never infers one from saved metadata', () => { // CHANGE
    const h = loadSchedulerHooks(); // CHANGE
    for (const rating of [null, undefined, '', ' ', 'invalid', Infinity, NaN]) assert.equal(h.schedulerConflictKindFromRelationship({ rating }), 'unknown'); // CHANGE
    for (const rating of [0, 1, '0', '2']) assert.equal(h.schedulerConflictKindFromRelationship({ rating }), 'companion'); // CHANGE
    assert.equal(h.schedulerConflictKindFromRelationship({ rating: -1 }), 'incompatible'); // CHANGE
    const item = { plantId: '2', label: 'Basil', relationship: { rating: 1 } }; // CHANGE
    assert.equal(h.classifySchedulerOccupancyConflict(item, new Map()).message, 'Compatibility unknown with Basil'); // CHANGE
    assert.equal(h.classifySchedulerOccupancyConflict(item, new Map([['2', { rating: -1 }]])).kind, 'incompatible'); // CHANGE
    h.__testWindow.document.defaultView.close(); // CHANGE
}); // CHANGE

for (const scenario of [ // CHANGE
    { name: 'neutral', rating: 0, expected: 'Companion overlap with Basil' }, // CHANGE
    { name: 'unrated', rating: null, expected: 'Compatibility unknown with Basil' }, // CHANGE
    { name: 'missing', missing: true, expected: 'Compatibility unknown with Basil' }, // CHANGE
    { name: 'failed query', fail: true, expected: 'Compatibility unknown with Basil' } // CHANGE
]) test(`${scenario.name} crop relationships preserve timing and permit Save`, async t => { // CHANGE
    const f = createSchedulerOverlapFixture(t); // CHANGE
    if (scenario.missing) f.state.relationships = []; // CHANGE
    else f.state.relationships[0].rating = scenario.rating; // CHANGE
    if (scenario.fail) f.state.lookup = async () => { throw new Error('Injected relationship read failure'); }; // CHANGE
    await f.open(); // CHANGE
    assert.equal(f.getDialog().querySelector('[data-scheduler-timing]').textContent, 'Starts 16d after Basil'); // CHANGE
    assert.equal(f.getDialog().querySelector('[data-scheduler-compatibility]').textContent, scenario.expected); // CHANGE
    f.button('Save').click(); // CHANGE
    await waitFor(() => !f.getDialog().isConnected || (!f.button('Save').disabled && f.getDialog().textContent.includes('Scheduling error:'))); // CHANGE
    assert.equal(f.getDialog().isConnected, false, f.getDialog().textContent); assert.equal(f.state.taskCalls, 1); // CHANGE
}); // CHANGE

test('date edits recompute earlier/later context and clear stale compatibility when overlap ends', async t => { // CHANGE
    const f = createSchedulerOverlapFixture(t); // CHANGE
    await f.open(); // CHANGE
    const input = Array.from(f.getDialog().querySelectorAll('input[type="date"]')).find(element => element.value === '2026-10-17' && !element.disabled); // CHANGE
    input.value = '2026-08-31'; f.dispatch(input, 'input'); // CHANGE
    await waitFor(() => f.getDialog().querySelector('[data-scheduler-timing]').textContent === 'Starts 31d before Basil'); // CHANGE: touching harvest/start boundaries still overlap.
    input.value = '2026-08-24'; f.dispatch(input, 'input'); // CHANGE
    await waitFor(() => f.getDialog().querySelector('[data-scheduler-timing]').textContent === '7d gap before Basil'); // CHANGE
    assert.equal(f.getDialog().querySelector('[data-scheduler-compatibility]').textContent, ''); // CHANGE
    const lane = f.getDialog().querySelector('[data-scheduler-context-date="basil"]'); // CHANGE
    assert.match(lane.textContent, /Occupancy start: 2026-10-01/); assert.ok(lane.querySelector('[data-scheduler-context-marker]')); // CHANGE
}); // CHANGE

test('late relationship responses cannot overwrite ratings for the current crop', async t => { // CHANGE
    const f = createSchedulerOverlapFixture(t); // CHANGE
    await f.open(); // CHANGE
    let release; // CHANGE
    f.state.lookup = plantId => plantId === 3 ? new Promise(resolve => { release = () => resolve([{ relation_id: 32, source_plant_id: 3, companion_plant_id: 2, rating: -1 }]); }) : Promise.resolve([{ relation_id: 42, source_plant_id: 4, companion_plant_id: 2, rating: 1 }]); // CHANGE
    const select = f.getDialog().querySelector('.usl-scheduler-crop-combobox-wrap select'); // CHANGE
    select.value = '3'; f.dispatch(select, 'change'); await waitFor(() => !!release); // CHANGE
    select.value = '4'; f.dispatch(select, 'change'); // CHANGE
    await waitFor(() => f.state.lookups.includes(4) && f.getDialog().querySelector('[data-scheduler-compatibility]').textContent === 'Companion overlap with Basil'); // CHANGE
    release(); await new Promise(resolve => setImmediate(resolve)); // CHANGE
    const input = Array.from(f.getDialog().querySelectorAll('input[type="date"]')).find(element => element.value === '2026-10-17' && !element.disabled); // CHANGE
    input.value = '2026-10-18'; f.dispatch(input, 'input'); // CHANGE
    await waitFor(() => f.getDialog().querySelector('[data-scheduler-timing]').textContent === 'Starts 17d after Basil'); // CHANGE: force a fresh classification after the obsolete response has settled.
    assert.equal(select.value, '4'); assert.equal(f.getDialog().querySelector('[data-scheduler-compatibility]').textContent, 'Companion overlap with Basil'); // CHANGE
}); // CHANGE

test('transplant comparisons use bed entry rather than sow date', async t => { // CHANGE
    const f = createSchedulerOverlapFixture(t, { cropAttrs: { method_id: 'transplant.indoor', method_category_id: 'transplant', sow_date: '2026-10-03', transplant_date: '2026-10-17', days_transplant: '14' } }); // CHANGE: saved sow and transplant dates must describe a consistent lifecycle.
    f.plants[0].days_transplant = 14; // CHANGE
    await f.open(); // CHANGE
    assert.match(f.getDialog().querySelector('[data-scheduler-timing]').textContent, /Starts 16d after Basil/); // CHANGE
    assert.match(f.getDialog().textContent, /Transplant date:/); // CHANGE
}); // CHANGE

for (const mode of ['companion', 'turnover']) test(`${mode} creation retains source context; companion editing excludes the target`, async t => { // CHANGE
    const f = createSchedulerOverlapFixture(t); // CHANGE
    if (mode === 'turnover') { f.basil.setAttribute('harvest_end', '2026-11-15'); f.crop.setAttribute('harvest_end', '2026-11-20'); } // CHANGE
    await f.scheduler.openDerivedScheduleDialog(f.ui, f.crop, { mode }); // CHANGE
    const dialog = f.getDialog(); // CHANGE
    assert.ok(dialog.querySelector('[data-scheduler-context-date="radish"]'), dialog.textContent); // CHANGE
    assert.match(dialog.querySelector('[data-scheduler-timing]').textContent, /Radish/); // CHANGE
    f.ui.hideDialog(); // CHANGE
    if (mode === 'companion') { // CHANGE
        await f.scheduler.openScheduleDialog(f.ui, f.basil); // CHANGE
        assert.ok(f.getDialog().querySelector('[data-scheduler-context-date="radish"]')); // CHANGE
        assert.equal(f.getDialog().querySelector('[data-scheduler-context-date="basil"]'), null); // CHANGE
    } // CHANGE
}); // CHANGE

test('nearby lanes disambiguate crop varieties, retain perennials, and select only nearest gap neighbors', () => { // CHANGE
    const h = loadSchedulerHooks(); // CHANGE
    const context = h.computeSchedulerAdjacentGapHints([ // CHANGE
        { cellId: 'old', label: 'Lettuce', startISO: '2026-01-01', endISO: '2026-02-01' }, // CHANGE
        { cellId: 'previous', label: 'Lettuce', startISO: '2026-08-01', endISO: '2026-10-01' }, // CHANGE
        { cellId: 'a', cropName: 'Basil', varietyName: 'Genovese', startISO: '2026-10-10', endISO: '2026-11-01' }, // CHANGE
        { cellId: 'b', cropName: 'Basil', varietyName: 'Thai', startISO: '2026-10-20', endISO: '2026-11-21' }, // CHANGE
        { cellId: 'perennial', label: 'Apple', perennial: true, startISO: '2020-01-01', endISO: '2030-12-31' }, // CHANGE
        { cellId: 'next', label: 'Carrot', startISO: '2026-12-01', endISO: '2027-01-01' }, // CHANGE
        { cellId: 'far', label: 'Onion', startISO: '2027-03-01', endISO: '2027-06-01' } // CHANGE
    ], { startISO: '2026-10-17', endISO: '2026-11-20' }); // CHANGE
    assert.equal(context.nearby.length, 5); // CHANGE
    assert.deepEqual(Array.from(context.nearby.filter(item => item.cropName === 'Basil'), item => item.displayLabel), ['Basil - Thai', 'Basil - Genovese']); // CHANGE: selected marker dates, rather than crop start dates, determine lane order.
    assert.equal(context.nearby.find(item => item.cellId === 'perennial').dateLabel, 'Occupancy/lifespan end'); // CHANGE
    assert.equal(h.buildLifecycleTimelineViewModel({ perennial: true, nearbyPlantings: context.nearby }).hidden, true); // CHANGE
    h.__testWindow.document.defaultView.close(); // CHANGE
}); // CHANGE

test('identical crop varieties retain stable planting labels across provider ordering', () => { // CHANGE
    const h = loadSchedulerHooks(); // CHANGE
    const items = ['b', 'a'].map(cellId => ({ cellId, cropName: 'Basil', varietyName: 'Thai', startISO: '2026-10-01', endISO: '2026-11-20' })); // CHANGE
    const window = { startISO: '2026-10-17', endISO: '2026-11-20' }; // CHANGE
    const rows = h.computeSchedulerAdjacentGapHints(items, window).nearby; // CHANGE
    assert.deepEqual(Array.from(rows, item => item.displayLabel), ['Basil - Thai (planting 1)', 'Basil - Thai (planting 2)']); // CHANGE
    assert.equal(h.classifySchedulerOccupancyConflict(rows[0], new Map()).message, 'Compatibility unknown with Basil - Thai (planting 1)'); // CHANGE
    assert.deepEqual(Array.from(h.computeSchedulerAdjacentGapHints(items.reverse(), window).nearby, item => item.displayLabel), Array.from(rows, item => item.displayLabel)); // CHANGE
    h.__testWindow.document.defaultView.close(); // CHANGE
}); // CHANGE

test('Allocate blocks an incompatible bed occupant before returning a preview or writing defaults', async t => { // CHANGE
    const f = createSchedulerOverlapFixture(t); // CHANGE
    f.state.relationships[0].rating = -1; // CHANGE
    f.graph.__trellisBedSuccessionNavigator.getSelectedClusterOccupancy = () => ({ items: [] }); // CHANGE: allocation must not rely on the selected cluster.
    const { pending } = await f.openAllocation(); // CHANGE
    const before = f.snapshot(), writes = f.state.writes.length; // CHANGE
    f.button('Preview Planting').click(); // CHANGE
    await waitFor(() => !f.button('Preview Planting').disabled && f.getDialog().textContent.includes('Scheduling error:')); // CHANGE
    assert.match(f.getDialog().textContent, /Scheduling error: Incompatible overlap with Basil/); // CHANGE
    assert.equal(f.snapshot(), before); assert.equal(f.state.writes.length, writes); assert.equal(f.state.taskCalls, 0); // CHANGE
    f.button('Cancel').click(); assert.equal((await pending).action, 'cancel'); // CHANGE
}); // CHANGE

test('cancelling during the Save relationship refresh cannot mutate the graph or database', async t => { // CHANGE
    const f = createSchedulerOverlapFixture(t); // CHANGE
    await f.open(); // CHANGE
    const before = f.snapshot(), writes = f.state.writes.length; // CHANGE
    let release, completed = false; // CHANGE
    f.state.lookup = async () => { const rows = await new Promise(resolve => { release = resolve; }); completed = true; return rows; }; // CHANGE
    f.button('Save').click(); await waitFor(() => !!release); // CHANGE
    f.button('Cancel').click(); release(f.state.relationships); // CHANGE
    await waitFor(() => completed); await new Promise(resolve => setImmediate(resolve)); // CHANGE
    assert.equal(f.snapshot(), before); assert.equal(f.state.writes.length, writes); assert.equal(f.state.taskCalls, 0); // CHANGE
}); // CHANGE

test('ordinary editing retains cluster scope while Allocate includes separate same-bed crops and perennial end labels', async t => { // CHANGE
    const f = createSchedulerOverlapFixture(t); // CHANGE
    f.basil.setAttribute('perennial', '1'); f.basil.setAttribute('lifespan_start', '2020-01-01'); f.basil.setAttribute('lifespan_end', '2030-12-31'); // CHANGE
    f.planting('separate', { plant_id: '5', plant_name: 'Carrot', sow_date: '2026-10-20', harvest_end: '2026-12-01' }, 400, 400); // CHANGE
    await f.open(); // CHANGE
    assert.equal(f.getDialog().querySelector('[data-scheduler-context-date="separate"]'), null); // CHANGE
    assert.match(f.getDialog().querySelector('[data-scheduler-context-date="basil"]').textContent, /Occupancy\/lifespan end: 2030-12-31/); // CHANGE
    f.ui.hideDialog(); const { pending } = await f.openAllocation(); // CHANGE
    assert.ok(f.getDialog().querySelector('[data-scheduler-context-date="separate"]')); // CHANGE
    const perennial = f.getDialog().querySelector('[data-scheduler-context-date="basil"]'); // CHANGE
    assert.match(perennial.textContent, /Occupancy\/lifespan end: 2030-12-31/); assert.equal(perennial.querySelector('[data-scheduler-context-marker]'), null); // CHANGE
    f.button('Cancel').click(); await pending; // CHANGE
}); // CHANGE
