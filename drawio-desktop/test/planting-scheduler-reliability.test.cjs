const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const schedulerPath = path.join(
    __dirname,
    '..',
    'drawio',
    'src',
    'main',
    'webapp',
    'plugins',
    'garden_planner_plugins',
    'Planting_Scheduler.js'
);
const taskManagerPath = path.join(
    __dirname,
    '..',
    'drawio',
    'src',
    'main',
    'webapp',
    'plugins',
    'garden_planner_plugins',
    'Garden_Task_Manager.js'
);

function loadSchedulerHooks() {
    const context = vm.createContext({
        console,
        Date,
        Math,
        Promise,
        setTimeout,
        clearTimeout,
        window: {
            __TRELLIS_PLANTING_SCHEDULER_TEST__: true
        },
        Draw: {
            loadPlugin(register) {
                register({ editor: { graph: {} } });
            }
        }
    });
    vm.runInContext(fs.readFileSync(schedulerPath, 'utf8'), context, {
        filename: schedulerPath
    });
    return context.window.__TRELLIS_PLANTING_SCHEDULER_TEST_HOOKS__;
}

function loadTaskManagerHooks() {
    const context = vm.createContext({
        console,
        globalThis: {
            __TRELLIS_TASK_MANAGER_TEST__: true
        },
        Draw: {
            loadPlugin() {}
        }
    });
    vm.runInContext(fs.readFileSync(taskManagerPath, 'utf8'), context, {
        filename: taskManagerPath
    });
    return context.globalThis.__TRELLIS_TASK_MANAGER_TEST_HOOKS__;
}

const hooks = loadSchedulerHooks();
const taskHooks = loadTaskManagerHooks();

function makeCity(meanC = 20) {
    const row = {
        city_name: 'Test City',
        last_spring_frost_doy: 1
    };
    for (let month = 1; month <= 12; month += 1) {
        row[`avg_monthly_high_c${month}`] = meanC + 2;
        row[`avg_monthly_low_c${month}`] = meanC - 2;
    }
    return new hooks.CityClimate(row);
}

function makeSeasonalCity(monthlyMeans) {
    const row = {
        city_name: 'Seasonal Test City',
        last_spring_frost_doy: 1
    };
    for (let month = 1; month <= 12; month += 1) {
        const mean = Number(monthlyMeans[month]);
        row[`avg_monthly_high_c${month}`] = mean + 2;
        row[`avg_monthly_low_c${month}`] = mean - 2;
    }
    return new hooks.CityClimate(row);
}

function makePlant(overrides = {}) {
    return new hooks.PlantModel({
        plant_id: 1,
        plant_name: 'Test Plant',
        annual: 1,
        biennial: 0,
        perennial: 0,
        lifespan_years: 1,
        overwinter_ok: 0,
        days_maturity: 30,
        gdd_to_maturity: null,
        days_transplant: 0,
        days_germ: 5,
        harvest_window_days: 7,
        tbase_c: 5,
        tmin_c: 0,
        topt_low_c: 15,
        topt_high_c: 25,
        tmax_c: 40,
        soil_temp_min_plant_c: null,
        start_cooling_threshold_c: null,
        yield_per_plant_kg: 1,
        ...overrides
    });
}

function makeInputs({
    plant = makePlant(),
    city = makeCity(),
    planningMode = 'direct_sow',
    methodCategoryId = 'direct_sow',
    methodId = 'direct_sow.field',
    startISO = '2026-04-01',
    seasonEndISO = '2026-12-31',
    seasonStartYear = 2026,
    harvestWindowDays = 7
} = {}) {
    return new hooks.ScheduleInputs({
        plant,
        city,
        planningMode,
        methodCategoryId,
        methodId,
        startISO,
        seasonEndISO,
        policy: new hooks.PolicyFlags({
            useSpringFrostGate: false,
            useSoilTempGate: false,
            overwinterAllowed: plant.isBiennial() || plant.isPerennial() || plant.overwinter_ok === 1
        }),
        seasonStartYear,
        harvestWindowDays
    });
}

function makeAutoWindowParams({
    plant = makePlant(),
    city = makeCity(),
    methodCategoryId = 'direct_sow',
    methodId = 'direct_sow.field',
    year = 2026,
    harvestWindowDays = 7
} = {}) {
    const env = plant.cropTempEnvelope();
    return {
        methodCategoryId,
        methodId,
        budget: plant.firstHarvestBudget(),
        HW_DAYS: harvestWindowDays,
        dailyRatesMap: city.dailyRates(env.Tbase, year),
        monthlyAvgTemp: city.monthlyMeans(),
        Tbase: env.Tbase,
        cropTemp: env,
        scanStart: new Date(`${year}-01-01T00:00:00Z`),
        scanEndHard: new Date(`${year}-12-31T00:00:00Z`),
        soilGateThresholdC: null,
        soilGateConsecutiveDays: 3,
        startCoolingThresholdC: null,
        useSpringFrostGate: false,
        lastSpringFrostDOY: 1,
        daysTransplant: Number(plant.days_transplant || 0),
        overwinterAllowed: plant.overwinter_ok === 1
    };
}

function makeAttributeCell(initial = {}) {
    const attrs = new Map(Object.entries(initial).map(([key, value]) => [key, String(value)]));
    const value = {
        hasAttribute: key => attrs.has(key),
        getAttribute: key => attrs.has(key) ? attrs.get(key) : null,
        setAttribute: (key, nextValue) => attrs.set(key, String(nextValue)),
        removeAttribute: key => attrs.delete(key)
    };
    return {
        value,
        getAttribute: value.getAttribute,
        attrs
    };
}

test('annual direct sow computes maturity and harvest window', () => {
    const result = hooks.computeScheduleResult(makeInputs());
    assert.equal(result.kind, 'annual');
    assert.equal(result.harvestEndSemantics, 'exclusive');
    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0].sow, '2026-04-01');
    assert.equal(result.rows[0].harvStart, '2026-05-01');
    assert.equal(result.rows[0].harvEnd, '2026-05-08');
});

test('no feasible annual window returns null derived dates', () => {
    const plant = makePlant({
        tmin_c: 50,
        topt_low_c: 52,
        topt_high_c: 55,
        tmax_c: 60
    });
    const result = hooks.computeAutoStartEndWindowForward(makeAutoWindowParams({ plant }));
    assert.equal(result.feasible, false);
    assert.equal(result.harvestEndSemantics, 'exclusive');
    assert.equal(result.earliestFeasibleSowDate, null);
    assert.equal(result.earliestHarvestStartDate, null);
    assert.equal(result.earliestHarvestEndDate, null);
    assert.equal(result.lastFeasibleSowDate, null);
    assert.equal(result.climateEndDate, null);
});

test('indoor transplant applies transplant lead time', () => {
    const plant = makePlant({ days_transplant: 21 });
    const result = hooks.computeScheduleResult(makeInputs({
        plant,
        planningMode: 'transplant_indoor',
        methodCategoryId: 'transplant',
        methodId: 'transplant.indoor'
    }));
    assert.equal(result.rows[0].trans, '2026-04-22');
    assert.equal(result.timelines[0].transplant.toISOString().slice(0, 10), '2026-04-22');
});

test('indoor transplant gate outside scan end is rejected', () => {
    const plant = makePlant({ days_transplant: 20 });
    const planner = new hooks.Planner(makeInputs({
        plant,
        planningMode: 'transplant_indoor',
        methodCategoryId: 'transplant',
        methodId: 'transplant.indoor',
        startISO: '2026-12-20',
        seasonEndISO: '2026-12-31'
    }));
    const feasibility = planner.isSowFeasible(new Date('2026-12-20T00:00:00Z'));
    assert.equal(feasibility.ok, false);
    assert.equal(feasibility.reason, 'gate_outside_scan_window');
});

test('cooling trigger ignores January cold and finds autumn crossing', () => {
    const monthlyAvgTemp = {
        1: 2, 2: 3, 3: 8, 4: 12, 5: 18, 6: 22,
        7: 24, 8: 22, 9: 16, 10: 10, 11: 5, 12: 2
    };
    const crossing = hooks.firstCoolingCrossingDate({
        thresholdC: 12,
        monthlyAvgTemp,
        scanStart: new Date('2026-01-01T00:00:00Z'),
        scanEndHard: new Date('2026-12-31T00:00:00Z')
    });
    assert.ok(crossing);
    assert.equal(crossing.getUTCMonth(), 9);
    assert.notEqual(crossing.toISOString().slice(0, 10), '2026-01-01');
});

test('cooling trigger returns null without an observed warm-to-cool transition', () => {
    const constantCold = Object.fromEntries(
        Array.from({ length: 12 }, (_, index) => [index + 1, 5])
    );
    const crossing = hooks.firstCoolingCrossingDate({
        thresholdC: 12,
        monthlyAvgTemp: constantCold,
        scanStart: new Date('2026-01-01T00:00:00Z'),
        scanEndHard: new Date('2026-12-31T00:00:00Z')
    });
    assert.equal(crossing, null);
});

test('overwinter crop can mature in the following year', () => {
    const plant = makePlant({
        plant_name: 'Garlic',
        days_maturity: 240,
        overwinter_ok: 1,
        start_cooling_threshold_c: 12
    });
    const city = makeSeasonalCity({
        1: 2, 2: 3, 3: 8, 4: 12, 5: 18, 6: 22,
        7: 24, 8: 22, 9: 16, 10: 10, 11: 5, 12: 2
    });
    const result = hooks.computeScheduleResult(makeInputs({
        plant,
        city,
        startISO: '2026-10-25',
        seasonEndISO: '2027-12-31'
    }));
    assert.equal(result.rows[0].harvStart, '2027-06-22');
});

test('biennial scan window uses its configured lifespan', () => {
    const plant = makePlant({
        annual: 0,
        biennial: 1,
        lifespan_years: 2
    });
    assert.equal(hooks.getPlantScanYears(plant), 2);
});

test('lifespan-only perennial saves without maturity dates', () => {
    const plant = makePlant({
        plant_name: 'Asparagus',
        annual: 0,
        perennial: 1,
        lifespan_years: 3,
        days_maturity: null,
        gdd_to_maturity: null
    });
    const result = hooks.computeScheduleResult(makeInputs({
        plant,
        startISO: '2026-04-15',
        seasonEndISO: '2029-12-31'
    }));
    assert.equal(result.kind, 'perennial');
    assert.equal(result.lifespanStartISO, '2026-04-15');
    assert.equal(result.lifespanEndISO, '2029-12-31');
    assert.equal(result.timelines[0].germ, null);
    assert.equal(result.timelines[0].transplant, null);
    assert.equal(result.timelines[0].maturity, null);
    assert.equal(result.timelines[0].harvestStart, null);
    assert.equal(result.rows[0].harvEnd, '');
});

test('perennial save patch contains lifespan dates and clears annual stages', () => {
    const plant = makePlant({
        plant_name: 'Asparagus',
        annual: 0,
        perennial: 1,
        lifespan_years: 3,
        days_maturity: null,
        gdd_to_maturity: null
    });
    const inputs = makeInputs({
        plant,
        startISO: '2026-04-15',
        seasonEndISO: '2029-12-31'
    });
    const result = hooks.computeScheduleResult(inputs);
    const patch = hooks.buildScheduleAttributePatch(inputs, result);
    assert.equal(patch.sow_date, '2026-04-15');
    assert.equal(patch.lifespan_start, '2026-04-15');
    assert.equal(patch.lifespan_end, '2029-12-31');
    assert.equal(patch.germ_date, '');
    assert.equal(patch.transplant_date, '');
    assert.equal(patch.maturity_date, '');
    assert.equal(patch.harvest_start, '');
    assert.equal(patch.harvest_end, '');
    assert.equal(patch.days_maturity, '');
    assert.equal(patch.gdd_to_maturity, '');
});

test('persisted start is distinct from a session edit and is not auto-overwritten', () => {
    const persisted = hooks.resolveStartAfterWindow({
        currentStartISO: '2026-05-10',
        autoStartISO: '2026-04-01',
        feasible: true,
        forceWriteStart: false,
        hasPersistedSchedule: true,
        userEditedStartThisSession: false
    });
    assert.equal(persisted, '2026-05-10');

    const replacedForYearChange = hooks.resolveStartAfterWindow({
        currentStartISO: persisted,
        autoStartISO: '2027-04-03',
        feasible: true,
        forceWriteStart: true,
        hasPersistedSchedule: true,
        userEditedStartThisSession: false
    });
    assert.equal(replacedForYearChange, '2027-04-03');

    const preservedWithoutWindow = hooks.resolveStartAfterWindow({
        currentStartISO: '2026-05-10',
        autoStartISO: null,
        feasible: false,
        forceWriteStart: true,
        hasPersistedSchedule: true,
        userEditedStartThisSession: false
    });
    assert.equal(preservedWithoutWindow, '2026-05-10');
});

test('perennial lifecycle is detected before requesting a maturity budget', () => {
    const plant = makePlant({
        annual: 0,
        perennial: 1,
        lifespan_years: 4,
        days_maturity: null,
        gdd_to_maturity: null
    });
    let budgetRequested = false;
    plant.firstHarvestBudget = () => {
        budgetRequested = true;
        throw new Error('budget should not be requested');
    };
    assert.throws(
        () => new hooks.Planner(makeInputs({ plant })),
        /Perennial schedules use lifespan dates/
    );
    assert.equal(budgetRequested, false);
});

test('perennial result does not initialize GDD rates', () => {
    const plant = makePlant({
        annual: 0,
        perennial: 1,
        lifespan_years: 4,
        days_maturity: null,
        gdd_to_maturity: null
    });
    const city = makeCity();
    city.dailyRates = () => {
        throw new Error('daily GDD rates should not be requested');
    };
    const result = hooks.computeScheduleResult(makeInputs({
        plant,
        city,
        startISO: '2026-03-20',
        seasonEndISO: '2030-12-31'
    }));
    assert.equal(result.kind, 'perennial');
    assert.equal(result.lifespanEndISO, '2030-12-31');
});

test('variety overrides change maturity and harvest window', () => {
    const base = makePlant();
    const overriddenRow = hooks.applyPlantOverrides(base, {
        days_maturity: 45,
        harvest_window_days: 10
    });
    const variety = new hooks.PlantModel(overriddenRow);
    const baseResult = hooks.computeScheduleResult(makeInputs({ plant: base }));
    const varietyResult = hooks.computeScheduleResult(makeInputs({
        plant: variety,
        harvestWindowDays: variety.harvest_window_days
    }));
    assert.equal(baseResult.rows[0].harvStart, '2026-05-01');
    assert.equal(varietyResult.rows[0].harvStart, '2026-05-16');
    assert.equal(varietyResult.rows[0].harvEnd, '2026-05-26');
});

test('zero-day harvest window has equal exclusive start and end', () => {
    const inputs = makeInputs({ harvestWindowDays: 0 });
    const result = hooks.computeScheduleResult(inputs);
    const patch = hooks.buildScheduleAttributePatch(inputs, result);
    assert.equal(result.harvestEndSemantics, 'exclusive');
    assert.equal(result.rows[0].harvStart, result.rows[0].harvEnd);
    assert.equal(patch.lifespan_start, '');
    assert.equal(patch.lifespan_end, '');
});

test('invalid saved and default methods fall through to a valid allowed method', async () => {
    const originalGet = hooks.PlantModel.getMethodById;
    const originalCategories = hooks.PlantModel.listAllowedMethodCategoriesForPlant;
    const originalMethods = hooks.PlantModel.listMethodsForMethodCategory;
    hooks.PlantModel.getMethodById = async () => ({
        method_category_id: 'broken',
        method_id: 'broken.unsupported'
    });
    hooks.PlantModel.listAllowedMethodCategoriesForPlant = async () => [
        { method_category_id: 'direct_sow' }
    ];
    hooks.PlantModel.listMethodsForMethodCategory = async () => [
        { method_category_id: 'direct_sow', method_id: 'direct_sow.invalid' },
        { method_category_id: 'direct_sow', method_id: 'direct_sow.field' }
    ];

    try {
        const cell = {
            getAttribute(name) {
                if (name === 'method_category_id') return 'broken';
                if (name === 'method_id') return 'broken.saved';
                return '';
            }
        };
        const selected = await hooks.resolveInitialMethodSelection(
            cell,
            makePlant({ default_planting_method: 'broken.default' })
        );
        assert.equal(selected.methodCategoryId, 'direct_sow');
        assert.equal(selected.methodId, 'direct_sow.field');
    } finally {
        hooks.PlantModel.getMethodById = originalGet;
        hooks.PlantModel.listAllowedMethodCategoriesForPlant = originalCategories;
        hooks.PlantModel.listMethodsForMethodCategory = originalMethods;
    }
});

test('method lookup failures retain the canonical hard fallback', async () => {
    const originalGet = hooks.PlantModel.getMethodById;
    const originalCategories = hooks.PlantModel.listAllowedMethodCategoriesForPlant;
    hooks.PlantModel.getMethodById = async () => {
        throw new Error('invalid default record');
    };
    hooks.PlantModel.listAllowedMethodCategoriesForPlant = async () => {
        throw new Error('invalid allowed records');
    };

    try {
        const selected = await hooks.resolveInitialMethodSelection(
            { getAttribute: () => '' },
            makePlant({ default_planting_method: 'broken.default' })
        );
        assert.equal(selected.methodCategoryId, 'direct_sow');
        assert.equal(selected.methodId, 'direct_sow.field');
    } finally {
        hooks.PlantModel.getMethodById = originalGet;
        hooks.PlantModel.listAllowedMethodCategoriesForPlant = originalCategories;
    }
});

test('mixed-case method records and attributes normalize to canonical IDs', async () => {
    const originalGet = hooks.PlantModel.getMethodById;
    hooks.PlantModel.getMethodById = async () => ({
        method_category_id: 'DiReCt_SoW',
        method_id: 'DiReCt_SoW.FiElD'
    });
    try {
        const cell = {
            getAttribute(name) {
                if (name === 'method_category_id') return ' DIRECT_SOW ';
                if (name === 'method_id') return ' Direct_Sow.Field ';
                return '';
            }
        };
        const selected = await hooks.resolveInitialMethodSelection(
            cell,
            makePlant({ default_planting_method: ' DIRECT_SOW.FIELD ' })
        );
        assert.equal(selected.methodCategoryId, 'direct_sow');
        assert.equal(selected.methodId, 'direct_sow.field');
        assert.equal(hooks.normId(' TrAnSpLaNt.InDoOr '), 'transplant.indoor');
    } finally {
        hooks.PlantModel.getMethodById = originalGet;
    }
});

test('database persistence failure restores snapshotted graph attributes', async () => {
    const cell = makeAttributeCell({ sow_date: '2026-04-01', method_id: 'direct_sow.field' });
    const patch = { sow_date: '2026-05-01', method_id: 'transplant.indoor', lifespan_end: '2029-12-31' };
    const snapshot = hooks.snapshotCellAttributes(cell, Object.keys(patch));
    await assert.rejects(
        hooks.runCompensatedSaveSteps({
            applyGraphPatch: () => hooks.applyCellAttributePatch(cell, patch),
            persist: async () => { throw new Error('db failed'); },
            emitTasks: async () => {},
            restoreGraphPatch: () => hooks.restoreCellAttributeSnapshot(cell, snapshot)
        }),
        /db failed/
    );
    assert.equal(cell.getAttribute('sow_date'), '2026-04-01');
    assert.equal(cell.getAttribute('method_id'), 'direct_sow.field');
    assert.equal(cell.value.hasAttribute('lifespan_end'), false);
});

test('task dispatch failure restores snapshotted graph attributes', async () => {
    const cell = makeAttributeCell({ harvest_end: '2026-06-01' });
    const patch = { harvest_end: '2026-07-01', lifespan_start: '' };
    const snapshot = hooks.snapshotCellAttributes(cell, Object.keys(patch));
    await assert.rejects(
        hooks.runCompensatedSaveSteps({
            applyGraphPatch: () => hooks.applyCellAttributePatch(cell, patch),
            persist: async () => {},
            emitTasks: async () => { throw new Error('task dispatch failed'); },
            restoreGraphPatch: () => hooks.restoreCellAttributeSnapshot(cell, snapshot)
        }),
        /task dispatch failed/
    );
    assert.equal(cell.getAttribute('harvest_end'), '2026-06-01');
    assert.equal(cell.value.hasAttribute('lifespan_start'), false);
});

test('async UI boundary reports labeled rejection', async () => {
    let reported = '';
    const value = await hooks.runUiAsyncOperation(
        'City change error',
        async () => {
            throw new Error('offline');
        },
        message => {
            reported = message;
        }
    );
    assert.equal(value, null);
    assert.equal(reported, 'City change error: offline');
});

test('task replacement is backward-compatible and clears on empty tasks', () => {
    const normalized = taskHooks.normalizeTaskReplacementDetail({
        targetGroupId: 'group-1',
        tasks: []
    });
    assert.equal(normalized.mode, 'replace');

    const calls = [];
    taskHooks.applyImmediateTaskReplacement({
        targetGroupId: normalized.targetGroupId,
        tasks: normalized.tasks,
        removeTasks: id => calls.push(['remove', id]),
        createTasks: tasks => calls.push(['create', tasks])
    });
    assert.deepEqual(calls, [['remove', 'group-1']]);
});

test('task replacement creates only the latest supplied task set', () => {
    const calls = [];
    const latestTasks = [{ title: 'Latest task' }];
    taskHooks.applyImmediateTaskReplacement({
        targetGroupId: 'group-2',
        tasks: latestTasks,
        removeTasks: id => calls.push(['remove', id]),
        createTasks: tasks => calls.push(['create', tasks])
    });
    assert.deepEqual(calls, [
        ['remove', 'group-2'],
        ['create', latestTasks]
    ]);
});

test('new task cards store scheduler dates as active and baseline dates', () => {
    const attrs = taskHooks.buildInitialCardDateAttributes('2026-04-10', '2026-04-13');
    assert.equal(attrs.start, '2026-04-10');
    assert.equal(attrs.end, '2026-04-13');
    assert.equal(attrs.base_start, '2026-04-10');
    assert.equal(attrs.base_end, '2026-04-13');
    assert.equal(Object.hasOwn(attrs, 'date_override'), false);
});

test('manual card date shifts preserve calendar duration across edge cases', () => {
    const cases = [
        {
            name: 'same-day',
            source: { start: '2026-04-10', end: '2026-04-10' },
            nextStart: '2026-05-01',
            expectedEnd: '2026-05-01'
        },
        {
            name: 'multi-day month boundary',
            source: { start: '2026-01-29', end: '2026-02-03' },
            nextStart: '2026-02-26',
            expectedEnd: '2026-03-03'
        },
        {
            name: 'year boundary',
            source: { start: '2026-12-29', end: '2027-01-03' },
            nextStart: '2027-12-29',
            expectedEnd: '2028-01-03'
        },
        {
            name: 'leap day',
            source: { start: '2028-02-27', end: '2028-03-01' },
            nextStart: '2028-02-28',
            expectedEnd: '2028-03-02'
        },
        {
            name: 'backward shift',
            source: { start: '2026-06-10', end: '2026-06-17' },
            nextStart: '2026-05-20',
            expectedEnd: '2026-05-27'
        },
        {
            name: 'DST-adjacent',
            source: { start: '2026-03-07', end: '2026-03-09' },
            nextStart: '2026-10-31',
            expectedEnd: '2026-11-02'
        }
    ];

    for (const entry of cases) {
        const patch = taskHooks.buildCardDateOverridePatch(entry.source, entry.nextStart);
        assert.ok(patch && patch.changed, entry.name);
        assert.equal(patch.attributes.start, entry.nextStart, entry.name);
        assert.equal(patch.attributes.end, entry.expectedEnd, entry.name);
        assert.equal(patch.attributes.date_override, '1', entry.name);
    }
});

test('legacy card edit captures a reset baseline and reset removes only the override', () => {
    const legacy = { start: '2026-04-10', end: '2026-04-13' };
    const override = taskHooks.buildCardDateOverridePatch(legacy, '2026-05-20');

    assert.equal(override.attributes.base_start, '2026-04-10');
    assert.equal(override.attributes.base_end, '2026-04-13');
    assert.equal(override.attributes.start, '2026-05-20');
    assert.equal(override.attributes.end, '2026-05-23');

    const reset = taskHooks.buildCardDateResetPatch(override.attributes);
    assert.equal(reset.start, '2026-04-10');
    assert.equal(reset.end, '2026-04-13');
    assert.equal(reset.date_override, null);
    assert.equal(Object.hasOwn(reset, 'base_start'), false);
    assert.equal(Object.hasOwn(reset, 'base_end'), false);
});

test('unchanged and invalid card dates do not produce override patches', () => {
    assert.deepEqual(
        { ...taskHooks.buildCardDateOverridePatch({ start: '2026-04-10', end: '2026-04-13' }, '2026-04-10') },
        { changed: false }
    );
    assert.equal(taskHooks.buildCardDateOverridePatch({ start: '', end: '2026-04-13' }, '2026-05-01'), null);
    assert.equal(taskHooks.buildCardDateOverridePatch({ start: '2026-04-10', end: '' }, '2026-05-01'), null);
    assert.equal(taskHooks.buildCardDateOverridePatch({ start: '2026-04-13', end: '2026-04-10' }, '2026-05-01'), null);
    assert.equal(taskHooks.buildCardDateOverridePatch({ start: '2026-02-31', end: '2026-03-02' }, '2026-05-01'), null);
    assert.equal(taskHooks.buildCardDateOverridePatch({ start: '2026-04-10', end: '2026-04-13' }, 'invalid'), null);
    assert.equal(taskHooks.buildCardDateResetPatch({ base_start: '2026-05-02', base_end: '2026-05-01' }), null);
});

test('card date menu eligibility includes work lanes and excludes completed lanes', () => {
    const editable = [
        'UPCOMING_FUTURE',
        'UPCOMING_YEAR',
        'UPCOMING_MONTH',
        'UPCOMING_WEEK',
        'TODO_STAGED',
        'TODO',
        'DOING'
    ];
    const immutable = ['DONE', 'DONE_WEEK', 'DONE_MONTH', 'DONE_YEAR', 'ARCHIVED', '', null];

    editable.forEach(lane => assert.equal(taskHooks.isEditableCardDateLane(lane), true, lane));
    immutable.forEach(lane => assert.equal(taskHooks.isEditableCardDateLane(lane), false, String(lane)));
});

test('scheduler regeneration creates a fresh baseline without preserving an override', () => {
    const overridden = taskHooks.buildCardDateOverridePatch(
        {
            base_start: '2026-04-10',
            base_end: '2026-04-13',
            start: '2026-05-20',
            end: '2026-05-23',
            date_override: '1'
        },
        '2026-06-01'
    );
    assert.equal(overridden.attributes.date_override, '1');

    const regenerated = taskHooks.buildInitialCardDateAttributes('2027-04-08', '2027-04-11');
    assert.equal(regenerated.start, '2027-04-08');
    assert.equal(regenerated.end, '2027-04-11');
    assert.equal(regenerated.base_start, '2027-04-08');
    assert.equal(regenerated.base_end, '2027-04-11');
    assert.equal(Object.hasOwn(regenerated, 'date_override'), false);
});

test('card note normalization trims, collapses whitespace, and enforces 40 Unicode code points', () => {
    assert.equal(taskHooks.normalizeCardNote('  Water   deeply \n tomorrow  '), 'Water deeply tomorrow');
    assert.equal(taskHooks.normalizeCardNote('\n\t  '), '');

    const exact = '1234567890'.repeat(4);
    assert.equal(Array.from(exact).length, 40);
    assert.equal(taskHooks.normalizeCardNote(exact), exact);
    assert.equal(taskHooks.normalizeCardNote(exact + 'extra'), exact);

    const unicode = '🌱'.repeat(40);
    assert.equal(Array.from(unicode).length, 40);
    assert.equal(taskHooks.normalizeCardNote(unicode + 'x'), unicode);
});

test('card note patches set or clear only card_note and leave scheduler notes untouched', () => {
    const source = {
        card_note: 'Old note',
        notes: 'Scheduler-generated task detail'
    };
    const setPatch = taskHooks.buildCardNotePatch(source, '  New\n note  ');
    assert.equal(setPatch.changed, true);
    assert.equal(setPatch.normalized, 'New note');
    assert.deepEqual({ ...setPatch.attributes }, { card_note: 'New note' });
    assert.equal(Object.hasOwn(setPatch.attributes, 'notes'), false);
    assert.equal(source.notes, 'Scheduler-generated task detail');

    const clearPatch = taskHooks.buildCardNotePatch(source, ' \n ');
    assert.equal(clearPatch.changed, true);
    assert.deepEqual({ ...clearPatch.attributes }, { card_note: null });

    const unchanged = taskHooks.buildCardNotePatch({ card_note: 'Same note' }, ' Same   note ');
    assert.equal(unchanged.changed, false);
    assert.equal(unchanged.normalized, 'Same note');

    const cleanup = taskHooks.buildCardNotePatch({ card_note: ' Same   note ' }, 'Same note');
    assert.equal(cleanup.changed, true);
    assert.deepEqual({ ...cleanup.attributes }, { card_note: 'Same note' });
});

test('card note badge is escaped and ordered between timing and edited-date badges', () => {
    const source = fs.readFileSync(taskManagerPath, 'utf8');
    assert.match(source, /const noteBadge = renderBadge\('Note',\s*getCardNote\(card\)\)/);
    assert.match(source, /badgesHtml \+ noteBadge \+ editedDateBadge \+ linkBadge/);
    assert.match(source, /mxUtils\.htmlEntities\(String\(text\)\)/);
});

test('unified card editor exposes notes on all cards and dates only when eligible', () => {
    const source = fs.readFileSync(taskManagerPath, 'utf8');
    assert.match(source, /function showEditCardDialog\(card\)/);
    assert.match(source, /const datesEditableAtOpen = canEditCardDates\(card\)/);
    assert.match(source, /if \(datesEditableAtOpen && currentRange\)/);
    assert.match(source, /if \(card\) \{\s*\/\/ CHANGE: note actions are available in every Kanban lane/);
    assert.match(source, /menu\.addItem\('Edit Card\.\.\.'/);
    assert.match(source, /menu\.addItem\('Clear Card Note'/);
    assert.match(source, /if \(canEditCardDates\(card\) && hasCardDateOverride\(card\)\)/);
    assert.match(source, /menu\.addItem\('Reset Card Dates'/);
    assert.doesNotMatch(source, /Edit Card Dates\.\.\./);
});

test('combined card saves use one value replacement and reflow only for date changes', () => {
    const source = fs.readFileSync(taskManagerPath, 'utf8');
    const valueWrites = source.match(/model\.setValue\(card,\s*cloneCardValueWithAttributes\(card,\s*attributes\)\)/g) || [];
    assert.equal(valueWrites.length, 1);
    assert.match(source, /function commitCardPatch\(card,\s*attributes,\s*opts\)/);
    assert.match(source, /if \(shouldReflow\) \{\s*scanAndReflowBoard\(board,\s*\{\s*insideUpdate:\s*true\s*\}\)/);
    assert.match(source, /commitCardPatch\(card,\s*attributes,\s*\{\s*reflow:\s*dateChanged\s*\}\)/);
    assert.match(source, /if \(!canEditCardDates\(card\)\).*reject the entire combined save/s);
    assert.match(source, /if \(Object\.keys\(attributes\)\.length === 0\)/);
});

test('manual date actions still use reflow and edited badge rendering', () => {
    const source = fs.readFileSync(taskManagerPath, 'utf8');
    assert.match(source, /commitCardPatch\(card,\s*patch\.attributes,\s*\{\s*reflow:\s*true\s*\}\)/);
    assert.match(source, /renderBadge\('Dates',\s*'Edited'\)/);
    assert.match(source, /const PROTECTED_WORK_LANES = new Set\(\['TODO',\s*'DOING'\]\)/);
});

test('save path passes the in-memory task template and stops after anchor failure', () => {
    const source = fs.readFileSync(schedulerPath, 'utf8');
    assert.match(source, /taskTemplate:\s*options\.taskTemplate\s*\?\?\s*null/);
    assert.match(source, /taskTemplate,\s*\/\/ FIX: generate tasks from the in-memory template/);
    assert.match(source, /if\s*\(!await recomputeAnchors\(true,\s*true\)\)\s*return false/);
    assert.match(source, /clearComputedHarvestResult\(\);\s*\/\/ FIX: anchor failure/);
});
