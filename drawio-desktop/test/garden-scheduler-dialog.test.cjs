const assert = require('node:assert/strict');
const test = require('node:test');

const {
    loadSchedulerHooks,
    makeInputs,
    makePlant
} = require('./helpers/garden-scheduler-harness.cjs');

const hooks = loadSchedulerHooks();

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
