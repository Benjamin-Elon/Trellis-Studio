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

test('annual direct sow computes maturity and harvest window', () => {
    const result = hooks.computeScheduleResult(makeInputs());
    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0].sow, '2026-04-01');
    assert.equal(result.rows[0].harvStart, '2026-05-01');
    assert.equal(result.rows[0].harvEnd, '2026-05-08');
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
    assert.equal(result.lifespanEndISO, '2029-12-31');
    assert.equal(result.timelines[0].maturity, null);
    assert.equal(result.timelines[0].harvestStart, null);
    assert.equal(result.rows[0].harvEnd, '');
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

test('save path passes the in-memory task template and stops after anchor failure', () => {
    const source = fs.readFileSync(schedulerPath, 'utf8');
    assert.match(source, /taskTemplate:\s*options\.taskTemplate\s*\?\?\s*null/);
    assert.match(source, /taskTemplate,\s*\/\/ FIX: generate tasks from the in-memory template/);
    assert.match(source, /if\s*\(!await recomputeAnchors\(true,\s*true\)\)\s*return false/);
    assert.match(source, /clearComputedHarvestResult\(\);\s*\/\/ FIX: anchor failure/);
});
