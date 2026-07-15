const assert = require('node:assert/strict');
const fs = require('node:fs'); // ADDED
const path = require('node:path'); // ADDED
const test = require('node:test');

const {
    loadSchedulerHooks,
    makeInputs,
    makePlant
} = require('./helpers/garden-scheduler-harness.cjs');

const hooks = loadSchedulerHooks();
const schedulerSource = fs.readFileSync(path.join(__dirname, '..', 'drawio', 'src', 'main', 'webapp', 'plugins', 'garden_planner_plugins', 'Garden_Scheduler_Dialog.js'), 'utf8'); // ADDED

function makeCrop(overrides = {}) { // ADDED
    return makePlant(hooks, { // ADDED
        plant_id: overrides.plant_id ?? 1, // ADDED
        plant_name: overrides.plant_name || 'Crop', // ADDED
        abbr: overrides.abbr || '', // ADDED
        ...overrides // ADDED
    }); // ADDED
} // ADDED

test('crop lifecycle classification requires exactly one lifecycle flag', () => { // ADDED
    assert.equal(hooks.getCropLifecycle(makeCrop({ annual: 1, biennial: 0, perennial: 0 })), 'annual'); // ADDED
    assert.equal(hooks.getCropLifecycle(makeCrop({ annual: 0, biennial: 1, perennial: 0 })), 'biennial'); // ADDED
    assert.equal(hooks.getCropLifecycle(makeCrop({ annual: 0, biennial: 0, perennial: 1 })), 'perennial'); // ADDED
    assert.equal(hooks.getCropLifecycle(makeCrop({ annual: 1, biennial: 1, perennial: 0 })), 'uncategorized'); // ADDED
    assert.equal(hooks.getCropLifecycle(makeCrop({ annual: 0, biennial: 0, perennial: 0 })), 'uncategorized'); // ADDED
}); // ADDED

test('lifecycle filter control reads and persists the shared crop filter preference', () => { // ADDED
    const store = new Map([['trellis.scheduler.cropLifecycleFilter', 'perennial']]); // ADDED
    hooks.__testWindow.localStorage = { // ADDED
        getItem: key => store.has(key) ? store.get(key) : null, // ADDED
        setItem: (key, value) => { store.set(key, value); } // ADDED
    }; // ADDED
    const control = hooks.buildLifecycleFilterControl(); // ADDED
    assert.equal(control.value, 'perennial'); // ADDED
    control.value = 'annual'; // ADDED
    control.dispatchEvent(new hooks.__testWindow.document.defaultView.Event('change')); // ADDED
    assert.equal(store.get('trellis.scheduler.cropLifecycleFilter'), 'annual'); // ADDED
}); // ADDED

test('grouped crop options filter by lifecycle and auto-show hidden current selection', () => { // ADDED
    const crops = [ // ADDED
        makeCrop({ plant_id: 1, plant_name: 'Tomato', annual: 1, biennial: 0, perennial: 0 }), // ADDED
        makeCrop({ plant_id: 2, plant_name: 'Rhubarb', annual: 0, biennial: 0, perennial: 1 }) // ADDED
    ]; // ADDED
    const groups = hooks.buildGroupedCropOptions(hooks.makeCropPickerOptions(crops), { // ADDED
        filter: 'perennial', // ADDED
        selectedValue: '1', // ADDED
        includeSelectedWhenFiltered: true // ADDED
    }); // ADDED
    assert.deepEqual(Array.from(groups, group => group.label), ['Current selection', 'Perennial crops']); // ADDED
    assert.deepEqual(Array.from(groups, group => Array.from(group.options, option => option.label)), [['Tomato'], ['Rhubarb']]); // ADDED
}); // ADDED

test('empty lifecycle filter renders an explicit disabled placeholder', () => { // ADDED
    const document = hooks.__testWindow.document; // ADDED
    const select = document.createElement('select'); // ADDED
    hooks.renderGroupedCropOptions(select, [], ''); // ADDED
    assert.equal(select.options.length, 1); // ADDED
    assert.equal(select.options[0].textContent, 'No crops match this filter'); // ADDED
    assert.equal(select.options[0].disabled, true); // ADDED
}); // ADDED

test('sowing-window scoring ranks inside windows before nearest outside windows', () => { // ADDED
    const windows = [ // ADDED
        { id: 'spring', label: 'Spring', startISO: '2026-03-01', endISO: '2026-05-31' }, // ADDED
        { id: 'fall', label: 'Fall', startISO: '2026-08-15', endISO: '2026-09-15' } // ADDED
    ]; // ADDED
    const inside = hooks.scoreSowingWindowsForDate(windows, '2026-04-01'); // ADDED
    const before = hooks.scoreSowingWindowsForDate(windows, '2026-08-01'); // ADDED
    const after = hooks.scoreSowingWindowsForDate(windows, '2026-09-29'); // ADDED
    assert.equal(inside.rankClass, 0); // ADDED
    assert.equal(inside.hint, '66% window left'); // ADDED
    assert.equal(before.rankClass, 1); // ADDED
    assert.equal(before.hint, 'Starts in 14d'); // CHANGED
    assert.equal(after.rankClass, 1); // ADDED
    assert.equal(after.hint, '14d late'); // ADDED
}); // ADDED

test('crop option sorting prefers suitability then name within lifecycle groups', () => { // ADDED
    const crops = [ // ADDED
        makeCrop({ plant_id: 1, plant_name: 'Late Crop', annual: 1, biennial: 0, perennial: 0 }), // ADDED
        makeCrop({ plant_id: 2, plant_name: 'Best Crop', annual: 1, biennial: 0, perennial: 0 }), // ADDED
        makeCrop({ plant_id: 3, plant_name: 'Near Crop', annual: 1, biennial: 0, perennial: 0 }) // ADDED
    ]; // ADDED
    const scores = new Map([ // ADDED
        ['1', { rankClass: 0, percentRemaining: 25, distanceDays: 0, hint: '25% window left' }], // ADDED
        ['2', { rankClass: 0, percentRemaining: 80, distanceDays: 0, hint: '80% window left' }], // ADDED
        ['3', { rankClass: 1, percentRemaining: -1, distanceDays: 2, hint: 'Starts in 2d' }] // CHANGED
    ]); // ADDED
    const groups = hooks.buildGroupedCropOptions(hooks.makeCropPickerOptions(crops, scores), { filter: 'annual' }); // ADDED
    assert.deepEqual(Array.from(groups[0].options, option => option.label), ['Best Crop', 'Late Crop', 'Near Crop']); // ADDED
    assert.equal(groups[0].options[0].displayLabel, 'Best Crop - 80% window left'); // ADDED
}); // ADDED

test('perennial crop suitability is alphabetic and date-flexible', async () => { // ADDED
    const perennial = makeCrop({ plant_id: 1, plant_name: 'Rhubarb', annual: 0, biennial: 0, perennial: 1, lifespan_years: 3 }); // ADDED
    const score = await hooks.scoreCropSuitability(perennial, {}); // ADDED
    assert.equal(score.hint, 'date-flexible'); // ADDED
    const groups = hooks.buildGroupedCropOptions(hooks.makeCropPickerOptions([ // ADDED
        makeCrop({ plant_id: 2, plant_name: 'Z Perennial', annual: 0, biennial: 0, perennial: 1, lifespan_years: 3 }), // ADDED
        makeCrop({ plant_id: 3, plant_name: 'A Perennial', annual: 0, biennial: 0, perennial: 1, lifespan_years: 3 }) // ADDED
    ]), { filter: 'perennial' }); // ADDED
    assert.deepEqual(Array.from(groups[0].options, option => option.label), ['A Perennial', 'Z Perennial']); // ADDED
}); // ADDED

test('missing city fallback keeps Set Plant style options grouped alphabetically', () => { // ADDED
    const crops = [ // ADDED
        makeCrop({ plant_id: 1, plant_name: 'Zucchini', annual: 1, biennial: 0, perennial: 0 }), // ADDED
        makeCrop({ plant_id: 2, plant_name: 'Arugula', annual: 1, biennial: 0, perennial: 0 }) // ADDED
    ]; // ADDED
    const groups = hooks.buildGroupedCropOptions(hooks.makeCropPickerOptions(crops), { filter: 'all' }); // ADDED
    assert.equal(groups[0].label, 'Annual crops'); // ADDED
    assert.deepEqual(Array.from(groups[0].options, option => option.label), ['Arugula', 'Zucchini']); // ADDED
    assert.equal(groups[0].options.some(option => /window/.test(option.displayLabel)), false); // ADDED
}); // ADDED

test('crop changes preserve the visible selected date before recomputing windows', () => { // ADDED
    assert.match(schedulerSource, /const preservedPrimaryDateISO = String\(startInput\.value \|\| ''\)\.trim\(\);/); // ADDED
    assert.match(schedulerSource, /startInput\.value = preservedPrimaryDateISO;[\s\S]*userEditedStartThisSession = true;/); // ADDED
    assert.match(schedulerSource, /case 'plantChanged': \{[\s\S]*await recomputeAnchors\(false, true\);/); // ADDED
}); // ADDED

function makeSummaryViewState(overrides = {}) { // ADDED
    return hooks.buildScheduleViewState({ // ADDED
        windowFeasible: true, // ADDED
        plantName: 'Tomato', // ADDED
        cityName: 'Test City', // ADDED
        seasonStartYear: 2026, // ADDED
        methodName: 'Direct sow', // ADDED
        startISO: '2026-04-01', // ADDED
        sowingSeasons: [{ id: 'spring', label: 'Spring', startISO: '2026-03-01', endISO: '2026-05-31' }], // ADDED
        activeSowingSeasonId: 'spring', // ADDED
        firstHarvestISO: '2026-06-01', // ADDED
        lastHarvestISO: '2026-06-08', // ADDED
        ...overrides // ADDED
    }); // ADDED
} // ADDED

test('schedule summary view state de-duplicates warning bullet messages', () => { // ADDED
    const viewState = makeSummaryViewState({ // ADDED
        scheduleWarnings: [ // ADDED
            { message: 'There is not enough growing-degree accumulation to reach maturity.' }, // ADDED
            { message: 'Selected sow date yield multiplier 0.49 is below the minimum 0.50.' }, // ADDED
            { message: 'There is not enough growing-degree accumulation to reach maturity.' }, // ADDED
            { message: '   ' }, // ADDED
            { type: 'missing_message' } // ADDED
        ] // ADDED
    }); // ADDED

    assert.equal(viewState.feasibility.status, 'warning'); // ADDED
    assert.deepEqual(Array.from(viewState.feasibility.warningMessages), [ // CHANGED
        'There is not enough growing-degree accumulation to reach maturity.', // ADDED
        'Selected sow date yield multiplier 0.49 is below the minimum 0.50.' // ADDED
    ]); // ADDED
}); // ADDED

test('schedule summary renders warnings as bullet list in double-wide feasibility item', () => { // ADDED
    const summaryView = hooks.renderScheduleSummary(); // ADDED
    const viewState = makeSummaryViewState({ // ADDED
        scheduleWarnings: [ // ADDED
            { message: 'There is not enough growing-degree accumulation to reach maturity.' }, // ADDED
            { message: 'Selected sow date yield multiplier 0.49 is below the minimum 0.50.' } // ADDED
        ] // ADDED
    }); // ADDED

    hooks.updateScheduleSummary(summaryView, viewState); // ADDED

    const feasibilityItem = summaryView.fields.feasibility.parentElement; // ADDED
    const warningItems = Array.from(summaryView.fields.feasibility.querySelectorAll('ul.usl-scheduler-summary-warning-list > li'), item => item.textContent); // ADDED
    assert.equal(feasibilityItem.classList.contains('usl-scheduler-summary-item--wide'), true); // ADDED
    assert.deepEqual(warningItems, Array.from(viewState.feasibility.warningMessages)); // CHANGED
}); // ADDED

test('schedule summary keeps non-warning feasibility as plain text', () => { // ADDED
    const summaryView = hooks.renderScheduleSummary(); // ADDED
    const viewState = makeSummaryViewState(); // ADDED

    hooks.updateScheduleSummary(summaryView, viewState); // ADDED

    assert.equal(summaryView.fields.feasibility.querySelector('ul'), null); // ADDED
    assert.equal(summaryView.fields.feasibility.textContent, 'The selected sow date is in Spring.'); // ADDED
}); // ADDED

test('lifecycle marker tooltip shows immediately and avoids native title', () => { // ADDED
    const document = hooks.__testWindow.document; // ADDED
    const win = document.defaultView; // ADDED
    const track = document.createElement('div'); // ADDED
    const marker = document.createElement('button'); // ADDED
    const text = 'HS - First harvest: 2026-05-01\nClick to edit the first task rule starting here.'; // ADDED
    track.style.position = 'relative'; // ADDED
    marker.setAttribute('data-timeline-percent', '50'); // ADDED
    marker.setAttribute('data-timeline-offset-px', '0'); // ADDED
    marker.title = 'Native title should be removed'; // ADDED
    track.appendChild(marker); // ADDED
    document.body.appendChild(track); // ADDED
    hooks.attachLifecycleTimelineMarkerTooltip(marker, track, text); // ADDED

    assert.equal(marker.hasAttribute('title'), false); // ADDED
    assert.equal(marker.getAttribute('aria-label'), text); // ADDED

    marker.dispatchEvent(new win.MouseEvent('mouseenter')); // ADDED
    const tooltip = track.querySelector('.usl-lifecycle-marker-tooltip'); // ADDED
    assert.ok(tooltip); // ADDED
    assert.equal(tooltip.style.display, 'block'); // ADDED
    assert.equal(tooltip.textContent, text); // ADDED

    marker.dispatchEvent(new win.MouseEvent('mouseleave')); // ADDED
    assert.equal(tooltip.style.display, 'none'); // ADDED
    marker.dispatchEvent(new win.FocusEvent('focus')); // ADDED
    assert.equal(tooltip.style.display, 'block'); // ADDED
    marker.dispatchEvent(new win.FocusEvent('blur')); // ADDED
    assert.equal(tooltip.style.display, 'none'); // ADDED
    marker.dispatchEvent(new win.FocusEvent('focus')); // ADDED
    marker.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape' })); // ADDED
    assert.equal(tooltip.style.display, 'none'); // ADDED

    let clickCount = 0; // ADDED
    marker.addEventListener('click', () => { clickCount += 1; }); // ADDED
    marker.dispatchEvent(new win.MouseEvent('click')); // ADDED
    assert.equal(clickCount, 1); // ADDED
    track.remove(); // ADDED
}); // ADDED

test('annual task preview fallback range remains sow through harvest', () => {
    const result = hooks.computeScheduleResult(makeInputs(hooks, { startISO: '2026-04-01' }));
    const range = hooks.resolveTaskPreviewScheduleRange(result);

    assert.deepEqual({ ...range }, {
        startISO: '2026-04-01',
        endISO: result.lastScheduledHarvestEndISO
    });
    assert.deepEqual({ ...hooks.resolveTaskPreviewDisplayRange(range, []) }, { ...range });
});

test('perennial task preview fallback range remains lifespan start through end', () => {
    const plant = makePlant(hooks, { annual: 0, perennial: 1, lifespan_years: 3 });
    const result = hooks.computeScheduleResult(makeInputs(hooks, { plant, startISO: '2026-04-15' }));
    const range = hooks.resolveTaskPreviewScheduleRange(result);

    assert.deepEqual({ ...range }, {
        startISO: result.lifespanStartISO,
        endISO: result.lifespanEndISO
    });
    assert.deepEqual({ ...hooks.resolveTaskPreviewDisplayRange(range, []) }, { ...range });
});

test('visible pre-sow task expands generated task timeline start', async () => {
    const plant = makePlant(hooks);
    const result = hooks.computeScheduleResult(makeInputs(hooks, { plant, startISO: '2026-04-01' }));
    const scheduleRange = hooks.resolveTaskPreviewScheduleRange(result);
    const tasks = await hooks.buildTasksForPlan({
        plant,
        schedule: result.schedule,
        timelines: result.timelines,
        includePreviewMetadata: true,
        taskTemplate: {
            version: 2,
            rules: [{
                id: 'prep',
                title: 'Prep bed',
                startAnchorStage: 'SOW',
                startOffsetDays: 7,
                startOffsetDirection: 'before',
                endMode: 'fixed_days',
                durationDays: 0
            }]
        }
    });
    const displayRange = hooks.resolveTaskPreviewDisplayRange(scheduleRange, tasks);

    assert.equal(tasks[0].startISO, '2026-03-25');
    assert.deepEqual({ ...displayRange }, {
        startISO: '2026-03-25',
        endISO: scheduleRange.endISO
    });
});

test('unchecked pre-sow task does not expand generated task timeline start', async () => {
    const plant = makePlant(hooks);
    const result = hooks.computeScheduleResult(makeInputs(hooks, { plant, startISO: '2026-04-01' }));
    const scheduleRange = hooks.resolveTaskPreviewScheduleRange(result);
    const rules = [
        {
            id: 'prep',
            title: 'Prep bed',
            startAnchorStage: 'SOW',
            startOffsetDays: 7,
            startOffsetDirection: 'before',
            endMode: 'fixed_days',
            durationDays: 0
        },
        {
            id: 'water',
            title: 'Water {plant}',
            startAnchorStage: 'SOW',
            startOffsetDays: 0,
            startOffsetDirection: 'after',
            endMode: 'fixed_days',
            durationDays: 0
        }
    ];
    const tasks = await hooks.buildTasksForPlan({
        plant,
        schedule: result.schedule,
        timelines: result.timelines,
        includePreviewMetadata: true,
        taskTemplate: { version: 2, rules }
    });
    const visibleTasks = hooks.filterPreviewTasks(tasks, new Set(['water::1']));
    const displayRange = hooks.resolveTaskPreviewDisplayRange(scheduleRange, visibleTasks);

    assert.deepEqual(Array.from(visibleTasks, task => task.startISO), ['2026-04-01']);
    assert.deepEqual({ ...displayRange }, { ...scheduleRange });
});

test('visible task after harvest extends generated task timeline end', () => {
    const result = hooks.computeScheduleResult(makeInputs(hooks, { startISO: '2026-04-01' }));
    const scheduleRange = hooks.resolveTaskPreviewScheduleRange(result);
    const displayRange = hooks.resolveTaskPreviewDisplayRange(scheduleRange, [
        { title: 'Late cleanup', startISO: scheduleRange.endISO, endISO: '2026-06-01' },
        { title: 'Invalid task', startISO: 'not-a-date', endISO: 'also-bad' }
    ]);

    assert.deepEqual({ ...displayRange }, {
        startISO: scheduleRange.startISO,
        endISO: '2026-06-01'
    });
});
