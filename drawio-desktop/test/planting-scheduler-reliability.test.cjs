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
    'Garden_Scheduler_Dialog.js'
);
const schedulerCorePaths = [ // ADDED
    'Garden_Scheduler_Shared_Core.js', // ADDED
    'Garden_Scheduler_Annual_Core.js', // ADDED
    'Garden_Scheduler_Perennial_Core.js' // ADDED
].map(fileName => path.join( // ADDED
    __dirname, // ADDED
    '..', // ADDED
    'drawio', // ADDED
    'src', // ADDED
    'main', // ADDED
    'webapp', // ADDED
    'plugins', // ADDED
    'garden_planner_plugins', // ADDED
    fileName // ADDED
)); // ADDED
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
    for (const corePath of schedulerCorePaths) { // ADDED
        vm.runInContext(fs.readFileSync(corePath, 'utf8'), context, { // ADDED
            filename: corePath // ADDED
        }); // ADDED
    } // ADDED
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

function makeRepeatRule(overrides = {}) { // ADDED
    return { // ADDED
        id: 'water', // ADDED
        title: 'Water {plant}', // ADDED
        startAnchorStage: 'SOW', // ADDED
        startOffsetDays: 0, // ADDED
        startOffsetDirection: 'after', // ADDED
        endMode: 'fixed_days', // ADDED
        durationDays: 0, // ADDED
        repeatMode: 'interval', // ADDED
        repeatEveryDays: 7, // ADDED
        repeatUntilMode: 'x_times', // ADDED
        repeatTimes: 5, // ADDED
        repeatUntilAnchorStage: 'HARVEST_END', // ADDED
        repeatCutoffOffsetDays: 0, // ADDED
        repeatCutoffOffsetDirection: 'after', // ADDED
        ...overrides // ADDED
    }; // ADDED
} // ADDED

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

test('combined method selection round-trips delimiter-like identifiers', () => { // ADDED
    const encoded = hooks.encodeMethodSelection(' Direct|Sow ', ' Direct|Sow.Field::One '); // ADDED
    const decoded = hooks.decodeMethodSelection(encoded); // ADDED
    assert.equal(decoded.methodCategoryId, 'direct|sow'); // ADDED
    assert.equal(decoded.methodId, 'direct|sow.field::one'); // ADDED
    assert.equal(hooks.decodeMethodSelection('not-json'), null); // ADDED
}); // ADDED

test('feasibility helpers classify schedule dates and humanize planner reasons', () => { // ADDED
    assert.equal(hooks.humanFeasibilityReason('insufficient_gdd'), 'There is not enough growing-degree accumulation to reach maturity.'); // ADDED
    assert.equal(hooks.classifySelectedSowDate({ perennial: true }).status, 'not_applicable'); // ADDED
    assert.equal(hooks.classifySelectedSowDate({ windowFeasible: false }).status, 'no_window'); // ADDED
    assert.equal(hooks.classifySelectedSowDate({ windowFeasible: true }).status, 'missing'); // ADDED
    assert.equal(hooks.classifySelectedSowDate({ // ADDED
        windowFeasible: true, // ADDED
        startISO: '2026-03-01', // ADDED
        earliestISO: '2026-04-01', // ADDED
        latestISO: '2026-05-01' // ADDED
    }).status, 'early'); // ADDED
    assert.equal(hooks.classifySelectedSowDate({ // ADDED
        windowFeasible: true, // ADDED
        startISO: '2026-06-01', // ADDED
        earliestISO: '2026-04-01', // ADDED
        latestISO: '2026-05-01' // ADDED
    }).status, 'late'); // ADDED
    assert.equal(hooks.classifySelectedSowDate({ // ADDED
        windowFeasible: true, // ADDED
        startISO: '2026-04-15', // ADDED
        earliestISO: '2026-04-01', // ADDED
        latestISO: '2026-05-01' // ADDED
    }).status, 'feasible'); // ADDED
}); // ADDED

test('schedule summary state uses perennial and annual harvest semantics', () => { // ADDED
    const annual = hooks.buildScheduleViewState({ // ADDED
        plantName: 'Tomato', // ADDED
        varietyName: 'Roma', // ADDED
        cityName: 'Test City', // ADDED
        seasonStartYear: 2026, // ADDED
        methodName: 'Field direct sow', // ADDED
        windowFeasible: true, // ADDED
        startISO: '2026-04-01', // ADDED
        earliestISO: '2026-03-20', // ADDED
        latestISO: '2026-05-01', // ADDED
        firstHarvestISO: '2026-05-01', // ADDED
        lastHarvestISO: '2026-05-08' // ADDED
    }); // ADDED
    assert.equal(annual.crop, 'Tomato / Roma'); // ADDED
    assert.equal(annual.feasibility.status, 'feasible'); // ADDED
    assert.equal(annual.harvestEnd, '2026-05-08'); // ADDED

    const perennial = hooks.buildScheduleViewState({ perennial: true, plantName: 'Asparagus' }); // ADDED
    assert.equal(perennial.feasibility.status, 'not_applicable'); // ADDED
    assert.match(perennial.firstHarvest, /Not calculated/); // ADDED
}); // ADDED

test('task rule normalization defaults repeat cutoff fields', () => { // ADDED
    const rule = hooks.normalizeTaskRule({ title: 'Water', repeat: true }); // ADDED
    assert.equal(rule.repeatMode, 'interval'); // ADDED
    assert.equal(rule.repeatUntilMode, 'x_times'); // ADDED
    assert.equal(rule.repeatUntilAnchorStage, 'HARVEST_END'); // ADDED
    assert.equal(rule.repeatCutoffOffsetDays, 0); // ADDED
    assert.equal(rule.repeatCutoffOffsetDirection, 'after'); // ADDED
}); // ADDED

test('task rule task type metadata is custom-only and canonical mappings are generated', () => { // NEW
    const custom = hooks.normalizeTaskRule({ id: 'water_weekly', title: 'Water', taskTypeId: 'Watering' }); // NEW
    assert.equal(custom.taskTypeId, 'watering'); // NEW
    const canonical = hooks.normalizeTaskRule({ id: 'sow', title: 'Sow', taskTypeId: 'watering' }); // NEW
    assert.equal(Object.hasOwn(canonical, 'taskTypeId'), false); // NEW
    assert.equal(hooks.resolveTaskRuleTaskTypeId({ id: 'prep', title: 'Prep' }), 'bed_preparation'); // NEW
    assert.equal(hooks.resolveTaskRuleTaskTypeId({ id: 'start', title: 'Start' }), 'seedling_starting'); // NEW
    assert.equal(hooks.resolveTaskRuleTaskTypeId({ id: 'harden', title: 'Harden' }), 'hardening_off'); // NEW
    assert.equal(hooks.resolveTaskRuleTaskTypeId({ id: 'thin', title: 'Thin' }), 'thinning_check'); // NEW
    assert.equal(hooks.resolveTaskRuleTaskTypeId({ id: 'custom', title: 'Custom' }), 'general'); // NEW
}); // NEW

test('custom task type validation is opt-in for editor saves', () => { // NEW
    assert.doesNotThrow(() => hooks.validateTaskRule({ id: 'custom', title: 'Custom', startAnchorStage: 'SOW' })); // NEW
    assert.throws( // NEW
        () => hooks.validateTaskRule({ id: 'custom', title: 'Custom', startAnchorStage: 'SOW' }, { requireTaskType: true }), // NEW
        /Task type is required/ // NEW
    ); // NEW
    assert.doesNotThrow(() => hooks.validateTaskRule({ id: 'custom', title: 'Custom', startAnchorStage: 'SOW', taskTypeId: 'watering' }, { requireTaskType: true })); // NEW
}); // NEW

test('task rule validation requires valid repeat cutoff configuration', () => { // ADDED
    const allowedStages = ['SOW', 'GERM', 'TRANSPLANT', 'HARVEST_START', 'HARVEST_END']; // ADDED
    assert.throws(() => hooks.validateTaskRule(makeRepeatRule({ repeatEveryDays: 0 }), { allowedStages }), /Repeat every days/); // ADDED
    assert.throws(() => hooks.validateTaskRule(makeRepeatRule({ repeatUntilMode: 'forever' }), { allowedStages }), /Invalid repeat-until mode/); // ADDED
    assert.throws(() => hooks.validateTaskRule(makeRepeatRule({ repeatUntilAnchorStage: 'BAD_STAGE' }), { allowedStages }), /Cutoff anchor is not available/); // ADDED
    assert.throws(() => hooks.validateTaskRule(makeRepeatRule({ repeatCutoffOffsetDays: -1 }), { allowedStages }), /Cutoff offset/); // ADDED
    assert.throws(() => hooks.validateTaskRule(makeRepeatRule({ repeatTimes: 0 }), { allowedStages }), /Repeat times/); // ADDED
    assert.doesNotThrow(() => hooks.validateTaskRule(makeRepeatRule({ repeatUntilMode: 'until_anchor', repeatTimes: 0 }), { allowedStages })); // ADDED
}); // ADDED

test('task rule anchor order rejects starts after end or cutoff anchors', async () => { // ADDED
    const plant = makePlant(); // ADDED
    const result = hooks.computeScheduleResult(makeInputs({ plant })); // ADDED
    const startAfterEnd = { // ADDED
        ...makeRepeatRule({ repeatMode: 'none' }), // ADDED
        startAnchorStage: 'HARVEST_END', // ADDED
        endMode: 'anchor_range', // ADDED
        endAnchorStage: 'HARVEST_START' // ADDED
    }; // ADDED
    const startAfterCutoff = makeRepeatRule({ // ADDED
        startAnchorStage: 'HARVEST_END', // ADDED
        repeatUntilAnchorStage: 'HARVEST_START' // ADDED
    }); // ADDED

    assert.throws(() => hooks.validateTaskRuleAnchorOrder(startAfterEnd, { schedule: result.schedule, timelines: result.timelines }), /Start must be on or before the end anchor/); // ADDED
    await assert.rejects(() => hooks.buildTasksForPlan({ // ADDED
        plant, // ADDED
        schedule: result.schedule, // ADDED
        timelines: result.timelines, // ADDED
        taskTemplate: { version: 2, rules: [startAfterCutoff] } // ADDED
    }), /Start must be on or before the cutoff anchor/); // ADDED
}); // ADDED

test('task editor placement and visibility rules stay wired', () => { // ADDED
    const source = fs.readFileSync(schedulerPath, 'utf8'); // ADDED
    assert.match(source, /const editBtn = mxUtils\.button\("Edit",\s*\(\) => openTaskEditor\(rule,\s*originalIndex,\s*wrap\)\)/); // ADDED
    assert.match(source, /function placeTaskEditorAfter\(anchorEl\)[\s\S]*anchorEl\.parentNode\.insertBefore\(taskEditorDiv,\s*anchorEl\.nextSibling\)/); // ADDED
    assert.match(source, /function setTaskEditorRowVisible\(rowEl,\s*visible\)[\s\S]*rowEl\.style\.setProperty\("display",\s*visible \? "flex" : "none",\s*"important"\)/); // CHANGED
    assert.match(source, /setTaskEditorRowVisible\(durationRow,\s*endMode === "fixed_days"\)/); // CHANGED
    assert.match(source, /setTaskEditorRowVisible\(repeatTimesRow,\s*repeating && untilMode === "x_times"\)/); // CHANGED
}); // ADDED

test('x-times repeat generation is capped by the exclusive cutoff anchor', async () => { // ADDED
    const plant = makePlant(); // ADDED
    const result = hooks.computeScheduleResult(makeInputs({ plant })); // ADDED
    const tasks = await hooks.buildTasksForPlan({ // ADDED
        plant, // ADDED
        schedule: result.schedule, // ADDED
        timelines: result.timelines, // ADDED
        taskTemplate: { version: 2, rules: [makeRepeatRule({ repeatEveryDays: 3, repeatTimes: 10, repeatUntilAnchorStage: 'SOW', repeatCutoffOffsetDays: 10 })] } // ADDED
    }); // ADDED
    assert.deepEqual(Array.from(tasks, task => task.startISO), ['2026-04-01', '2026-04-04', '2026-04-07', '2026-04-10']); // CHANGED
}); // ADDED

test('until-anchor repeat generation uses the exclusive cutoff anchor', async () => { // ADDED
    const plant = makePlant(); // ADDED
    const result = hooks.computeScheduleResult(makeInputs({ plant })); // ADDED
    const tasks = await hooks.buildTasksForPlan({ // ADDED
        plant, // ADDED
        schedule: result.schedule, // ADDED
        timelines: result.timelines, // ADDED
        taskTemplate: { version: 2, rules: [makeRepeatRule({ repeatEveryDays: 10, repeatUntilMode: 'until_anchor', repeatUntilAnchorStage: 'HARVEST_START' })] } // ADDED
    }); // ADDED
    assert.deepEqual(Array.from(tasks, task => task.startISO), ['2026-04-01', '2026-04-11', '2026-04-21']); // CHANGED
}); // ADDED

test('repeat cutoff offset shifts the exclusive cap before and after the anchor', async () => { // ADDED
    const plant = makePlant(); // ADDED
    const result = hooks.computeScheduleResult(makeInputs({ plant })); // ADDED
    const beforeTasks = await hooks.buildTasksForPlan({ // ADDED
        plant, // ADDED
        schedule: result.schedule, // ADDED
        timelines: result.timelines, // ADDED
        taskTemplate: { version: 2, rules: [makeRepeatRule({ repeatEveryDays: 10, repeatTimes: 10, repeatUntilAnchorStage: 'HARVEST_START', repeatCutoffOffsetDays: 7, repeatCutoffOffsetDirection: 'before' })] } // ADDED
    }); // ADDED
    const afterTasks = await hooks.buildTasksForPlan({ // ADDED
        plant, // ADDED
        schedule: result.schedule, // ADDED
        timelines: result.timelines, // ADDED
        taskTemplate: { version: 2, rules: [makeRepeatRule({ repeatEveryDays: 10, repeatTimes: 10, repeatUntilAnchorStage: 'HARVEST_START', repeatCutoffOffsetDays: 7, repeatCutoffOffsetDirection: 'after' })] } // ADDED
    }); // ADDED
    assert.deepEqual(Array.from(beforeTasks, task => task.startISO), ['2026-04-01', '2026-04-11', '2026-04-21']); // CHANGED
    assert.deepEqual(Array.from(afterTasks, task => task.startISO), ['2026-04-01', '2026-04-11', '2026-04-21', '2026-05-01']); // CHANGED
}); // ADDED

test('repeat cutoff can omit all occurrences and is preview-warning eligible', async () => { // ADDED
    const plant = makePlant(); // ADDED
    const result = hooks.computeScheduleResult(makeInputs({ plant })); // ADDED
    const template = { version: 2, rules: [makeRepeatRule({ repeatUntilAnchorStage: 'SOW' })] }; // ADDED
    const tasks = await hooks.buildTasksForPlan({ // ADDED
        plant, // ADDED
        schedule: result.schedule, // ADDED
        timelines: result.timelines, // ADDED
        taskTemplate: template, // ADDED
        includePreviewMetadata: true // ADDED
    }); // ADDED
    const omitted = hooks.findRepeatCutoffOmittedRuleKeys({ taskTemplate: template, schedule: result.schedule, timelines: result.timelines }); // ADDED
    assert.equal(tasks.length, 0); // ADDED
    assert.equal(omitted.has('water::0'), true); // ADDED
}); // ADDED

test('task rule descriptions include repeat cutoff wording', () => { // ADDED
    assert.match(hooks.describeTaskRule(makeRepeatRule({ repeatEveryDays: 7, repeatTimes: 5 })), /repeat every 7 days, up to 5 times, until Harvest end/); // ADDED
    assert.match(hooks.describeTaskRule(makeRepeatRule({ repeatEveryDays: 7, repeatUntilMode: 'until_anchor' })), /repeat every 7 days until Harvest end/); // ADDED
    assert.match(hooks.describeTaskRule(makeRepeatRule({ repeatCutoffOffsetDays: 7, repeatCutoffOffsetDirection: 'before' })), /until 7 days before Harvest end/); // ADDED
}); // ADDED

test('task preview and save share generated dates before display filtering', async () => { // ADDED
    const plant = makePlant({ plant_name: 'Carrot' }); // ADDED
    const result = hooks.computeScheduleResult(makeInputs({ plant })); // ADDED
    const template = { // ADDED
        version: 2, // ADDED
        rules: [{ // ADDED
            id: 'water', // ADDED
            title: 'Water {plant}', // ADDED
            startAnchorStage: 'SOW', // ADDED
            startOffsetDays: 0, // ADDED
            startOffsetDirection: 'after', // ADDED
            endMode: 'fixed_days', // ADDED
            durationDays: 1, // ADDED
            repeatMode: 'interval', // ADDED
            repeatEveryDays: 3, // ADDED
            repeatUntilMode: 'x_times', // ADDED
            repeatTimes: 3 // ADDED
        }] // ADDED
    }; // ADDED
    const savedTasks = await hooks.buildTasksForPlan({ // ADDED
        plant, // ADDED
        schedule: result.schedule, // ADDED
        timelines: result.timelines, // ADDED
        taskTemplate: template // ADDED
    }); // ADDED
    const previewTasks = await hooks.buildTasksForPlan({ // ADDED
        plant, // ADDED
        schedule: result.schedule, // ADDED
        timelines: result.timelines, // ADDED
        taskTemplate: template, // ADDED
        includePreviewMetadata: true // ADDED
    }); // ADDED
    assert.deepEqual( // ADDED
        previewTasks.map(task => [task.startISO, task.endISO]), // ADDED
        savedTasks.map(task => [task.startISO, task.endISO]) // ADDED
    ); // ADDED
    assert.equal(Object.keys(savedTasks[0]).includes('previewRuleKey'), false); // ADDED
    assert.equal(Object.keys(previewTasks[0]).includes('previewRuleKey'), false); // ADDED
    assert.equal(previewTasks[0].previewRuleKey, 'water::0'); // ADDED
}); // ADDED

test('task titles use plant and variety for built-in and custom task rules', async () => { // ADDED
    const plant = makePlant({ plant_name: 'Tomato' }); // ADDED
    const result = hooks.computeScheduleResult(makeInputs({ plant })); // ADDED
    const template = { // ADDED
        version: 2, // ADDED
        rules: [ // ADDED
            { id: 'water', title: 'Water {plant}', startAnchorStage: 'SOW', endMode: 'fixed_days', durationDays: 0 }, // ADDED
            { id: 'fertilize', title: 'Fertilize', startAnchorStage: 'SOW', endMode: 'fixed_days', durationDays: 0 }, // ADDED
            { id: 'check_crop', title: 'Check Tomato (Roma)', startAnchorStage: 'SOW', endMode: 'fixed_days', durationDays: 0 }, // ADDED
            { id: 'mulch_plant', title: 'Mulch Tomato', startAnchorStage: 'SOW', endMode: 'fixed_days', durationDays: 0 } // ADDED
        ] // ADDED
    }; // ADDED
    const tasks = await hooks.buildTasksForPlan({ // ADDED
        plant, // ADDED
        schedule: result.schedule, // ADDED
        timelines: result.timelines, // ADDED
        taskTemplate: template, // ADDED
        varietyName: 'Roma' // ADDED
    }); // ADDED
    assert.equal(tasks.map(task => task.title).join('|'), 'Water – Tomato (Roma)|Fertilize – Tomato (Roma)|Check – Tomato (Roma)|Mulch – Tomato (Roma)'); // CHANGED
    assert.equal(tasks.every(task => task.plant_name === 'Tomato'), true); // ADDED
    assert.equal(tasks.every(task => task.variety_name === 'Roma'), true); // ADDED
}); // ADDED

test('generated scheduler tasks include canonical and custom task type ids', async () => { // NEW
    const plant = makePlant({ plant_name: 'Tomato' }); // NEW
    const result = hooks.computeScheduleResult(makeInputs({ plant, startISO: '2026-04-01' })); // NEW
    const tasks = await hooks.buildTasksForPlan({ // NEW
        plant, // NEW
        schedule: result.schedule, // NEW
        timelines: result.timelines, // NEW
        taskTemplate: { // NEW
            rules: [ // NEW
                { id: 'prep', title: 'Prep bed', startAnchorStage: 'SOW', startOffsetDays: 1, startOffsetDirection: 'before', endMode: 'fixed_days', durationDays: 1 }, // NEW
                { id: 'harden', title: 'Harden off', startAnchorStage: 'SOW', endMode: 'fixed_days', durationDays: 1 }, // NEW
                { id: 'custom_water', title: 'Water', startAnchorStage: 'SOW', endMode: 'fixed_days', durationDays: 1, taskTypeId: 'watering' } // NEW
            ] // NEW
        } // NEW
    }); // NEW
    assert.deepEqual(Array.from(tasks.map(task => task.task_type_id)), ['bed_preparation', 'hardening_off', 'watering']); // CHANGE
}); // NEW

test('task titles fall back to plant-only names when no variety is selected', async () => { // ADDED
    const plant = makePlant({ plant_name: 'Tomato' }); // ADDED
    const result = hooks.computeScheduleResult(makeInputs({ plant })); // ADDED
    const template = { // ADDED
        version: 2, // ADDED
        rules: [ // ADDED
            { id: 'water', title: 'Water {plant}', startAnchorStage: 'SOW', endMode: 'fixed_days', durationDays: 0 }, // ADDED
            { id: 'fertilize', title: 'Fertilize', startAnchorStage: 'SOW', endMode: 'fixed_days', durationDays: 0 } // ADDED
        ] // ADDED
    }; // ADDED
    const tasks = await hooks.buildTasksForPlan({ // ADDED
        plant, // ADDED
        schedule: result.schedule, // ADDED
        timelines: result.timelines, // ADDED
        taskTemplate: template // ADDED
    }); // ADDED
    assert.equal(tasks.map(task => task.title).join('|'), 'Water – Tomato|Fertilize – Tomato'); // CHANGED
    assert.equal(tasks.every(task => task.variety_name === ''), true); // ADDED
}); // ADDED

test('built-in task titles separate action and crop with an en dash', async () => { // ADDED
    const plant = makePlant({ plant_name: 'Lettuce' }); // ADDED
    const result = hooks.computeScheduleResult(makeInputs({ plant })); // ADDED
    const library = hooks.taskRuleLibraryForPlanningMode('direct_sow'); // ADDED
    assert.equal([ // ADDED
        library.prep.title, // ADDED
        library.sow.title, // ADDED
        library.start.title, // ADDED
        library.harden.title, // ADDED
        library.transplant.title, // ADDED
        library.thin.title, // ADDED
        library.harvest.title // ADDED
    ].join('|'), 'Prep bed – {plant}|Sow – {plant}|Start indoors – {plant}|Harden off – {plant}|Transplant – {plant}|Thin / check – {plant}|Harvest – {plant}'); // ADDED
    const tasks = await hooks.buildTasksForPlan({ // ADDED
        plant, // ADDED
        schedule: result.schedule, // ADDED
        timelines: result.timelines, // ADDED
        taskTemplate: { version: 2, rules: [library.thin, library.harvest] }, // ADDED
        varietyName: 'butthead' // ADDED
    }); // ADDED
    assert.equal(tasks.map(task => task.title).join('|'), 'Thin / check – Lettuce (butthead)|Harvest – Lettuce (butthead)'); // ADDED
}); // ADDED

test('task preview range uses the complete annual schedule instead of selected task dates', () => { // ADDED
    const result = hooks.computeScheduleResult(makeInputs({ startISO: '2026-04-01' })); // ADDED
    const range = hooks.resolveTaskPreviewScheduleRange(result); // ADDED
    assert.deepEqual({ ...range }, { // ADDED
        startISO: '2026-04-01', // ADDED
        endISO: result.lastScheduledHarvestEndISO // ADDED
    }); // ADDED
    assert.notEqual(range.endISO, '2026-04-01'); // ADDED
}); // ADDED

test('task preview range uses the complete perennial lifespan', () => { // ADDED
    const plant = makePlant({ annual: 0, perennial: 1, lifespan_years: 3 }); // ADDED
    const result = hooks.computeScheduleResult(makeInputs({ plant, startISO: '2026-04-15' })); // ADDED
    assert.deepEqual({ ...hooks.resolveTaskPreviewScheduleRange(result) }, { // ADDED
        startISO: result.lifespanStartISO, // ADDED
        endISO: result.lifespanEndISO // ADDED
    }); // ADDED
}); // ADDED

test('task preview filtering is display-only and includes all occurrences for selected rules', async () => { // CHANGED
    const plant = makePlant(); // ADDED
    const result = hooks.computeScheduleResult(makeInputs({ plant })); // ADDED
    const rules = [ // ADDED
        { id: 'duplicate', title: 'First', startAnchorStage: 'SOW', endMode: 'fixed_days', durationDays: 0, repeatMode: 'interval', repeatEveryDays: 1, repeatUntilMode: 'x_times', repeatTimes: 3 }, // ADDED
        { id: 'duplicate', title: 'Second', startAnchorStage: 'SOW', endMode: 'fixed_days', durationDays: 0, repeatMode: 'interval', repeatEveryDays: 2, repeatUntilMode: 'x_times', repeatTimes: 2 } // ADDED
    ]; // ADDED
    const originalRules = JSON.stringify(rules); // ADDED
    const generated = await hooks.buildTasksForPlan({ // ADDED
        plant, // ADDED
        schedule: result.schedule, // ADDED
        timelines: result.timelines, // ADDED
        taskTemplate: { version: 2, rules }, // ADDED
        includePreviewMetadata: true // ADDED
    }); // ADDED
    const filtered = hooks.filterPreviewTasks(generated, new Set(['duplicate::1'])); // CHANGED
    assert.equal(filtered.length, 2); // CHANGED
    assert.equal(filtered.every(task => task.title === 'Second – Test Plant'), true); // CHANGED
    assert.equal(filtered.map(task => task.previewOccurrenceIndex).join(','), '0,1'); // ADDED
    assert.equal(JSON.stringify(rules), originalRules); // ADDED
    assert.equal(generated.length, 5); // ADDED
}); // ADDED

test('task rule display order follows first generated occurrence and keeps original indexes', () => { // ADDED
    const rules = [ // ADDED
        { id: 'late', title: 'Late task' }, // ADDED
        { id: 'missing', title: 'Missing anchor task' }, // ADDED
        { id: 'early', title: 'Early task' }, // ADDED
        { id: 'same_day', title: 'Same-day task' } // ADDED
    ]; // ADDED
    const generated = [ // ADDED
        { previewRuleKey: 'late::0', startISO: '2026-06-10' }, // ADDED
        { previewRuleKey: 'early::2', startISO: '2026-04-01' }, // ADDED
        { previewRuleKey: 'early::2', startISO: '2026-04-05' }, // ADDED
        { previewRuleKey: 'same_day::3', startISO: '2026-04-01' } // ADDED
    ]; // ADDED
    const ordered = hooks.buildTaskRuleDisplayOrder(rules, generated); // ADDED
    assert.equal(ordered.map(entry => entry.rule.id).join(','), 'early,same_day,late,missing'); // ADDED
    assert.equal(ordered.map(entry => entry.originalIndex).join(','), '2,3,0,1'); // ADDED
}); // ADDED

test('task preview groups repeats on one row ordered by first occurrence', () => { // ADDED
    const tasks = [ // ADDED
        { title: 'Later', startISO: '2026-05-10', endISO: '2026-05-11', previewRuleKey: 'later::0', previewRuleIndex: 0, previewOccurrenceIndex: 0 }, // ADDED
        { title: 'Repeat', startISO: '2026-04-08', endISO: '2026-04-09', previewRuleKey: 'repeat::1', previewRuleIndex: 1, previewOccurrenceIndex: 1 }, // ADDED
        { title: 'Repeat', startISO: '2026-04-01', endISO: '2026-04-02', previewRuleKey: 'repeat::1', previewRuleIndex: 1, previewOccurrenceIndex: 0 }, // ADDED
        { title: 'Repeat', startISO: '2026-04-15', endISO: '2026-04-16', previewRuleKey: 'repeat::1', previewRuleIndex: 1, previewOccurrenceIndex: 2 } // ADDED
    ]; // ADDED
    const groups = hooks.groupPreviewTasksByRule(tasks); // ADDED
    assert.equal(groups.length, 2); // ADDED
    assert.equal(groups[0].title, 'Repeat'); // ADDED
    assert.equal(groups[0].occurrences.length, 3); // ADDED
    assert.equal(groups[0].occurrences.map(task => task.startISO).join(','), '2026-04-01,2026-04-08,2026-04-15'); // ADDED
    assert.equal(groups[1].title, 'Later'); // ADDED
}); // ADDED

test('perennial task generation omits rules whose annual anchors are missing', async () => { // ADDED
    const plant = makePlant({ // ADDED
        annual: 0, // ADDED
        perennial: 1, // ADDED
        lifespan_years: 3, // ADDED
        days_maturity: null, // ADDED
        gdd_to_maturity: null // ADDED
    }); // ADDED
    const result = hooks.computeScheduleResult(makeInputs({ plant, startISO: '2026-04-15' })); // ADDED
    const tasks = await hooks.buildTasksForPlan({ // ADDED
        plant, // ADDED
        schedule: result.schedule, // ADDED
        timelines: result.timelines, // ADDED
        taskTemplate: { // ADDED
            rules: [ // ADDED
                { id: 'plant', title: 'Plant', startAnchorStage: 'SOW', endMode: 'fixed_days', durationDays: 0 }, // ADDED
                { id: 'harvest', title: 'Harvest', startAnchorStage: 'HARVEST_START', endMode: 'fixed_days', durationDays: 0 } // ADDED
            ] // ADDED
        }, // ADDED
        includePreviewMetadata: true // ADDED
    }); // ADDED
    assert.equal(tasks.length, 1); // ADDED
    assert.equal(tasks[0].rule_id, 'plant'); // ADDED
}); // ADDED

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

test('repeat series identity normalizes links and text without using dates', () => { // NEW
    const first = { // NEW
        linkedTo: ' group-b, group-a,group-b ', // NEW
        plant_name: '  Tomato ', // NEW
        method: ' FIELD ', // NEW
        title: ' Water Plants ', // NEW
        start: '2026-04-01' // NEW
    }; // NEW
    const second = { ...first, linkedTo: 'group-a,group-b', start: '2026-08-01' }; // NEW
    const parsed = JSON.parse(taskHooks.buildRepeatSeriesKey(first)); // NEW

    assert.equal(taskHooks.buildRepeatSeriesKey(first), taskHooks.buildRepeatSeriesKey(second)); // NEW
    assert.equal(parsed[0].join(','), 'group-a,group-b'); // NEW
    assert.equal(parsed.slice(1).join('|'), 'tomato|field|water plants'); // NEW
    assert.equal(taskHooks.buildRepeatSeriesKey({ ...first, linkedTo: ' ' }), null); // NEW
}); // NEW

test('collapsed repeat planning keeps one representative per lane and excludes hidden years', () => { // NEW
    const key = 'series'; // NEW
    const plan = taskHooks.planRepeatSeriesVisibility([ // NEW
        { id: 'a', seriesKey: key, laneKey: 'TODO', startISO: '2026-04-01', endISO: '2026-04-01' }, // NEW
        { id: 'b', seriesKey: key, laneKey: 'TODO', startISO: '2026-04-08', endISO: '2026-04-08' }, // NEW
        { id: 'c', seriesKey: key, laneKey: 'DOING', startISO: '2026-04-15', endISO: '2026-04-15' }, // NEW
        { id: 'hidden-year', seriesKey: key, laneKey: 'TODO', startISO: '2025-01-01', yearHidden: true } // NEW
    ]); // NEW
    const byId = new Map(plan.map(item => [item.id, item])); // NEW

    assert.equal(byId.get('a').repeatHidden, false); // NEW
    assert.equal(byId.get('a').repeatBadge, '1/3 +1'); // NEW
    assert.equal(byId.get('b').repeatHidden, true); // NEW
    assert.equal(byId.get('b').repeatBadge, ''); // NEW
    assert.equal(byId.get('c').repeatHidden, false); // NEW
    assert.equal(byId.get('c').repeatBadge, '3/3'); // NEW
    assert.equal(byId.get('hidden-year').repeating, false); // NEW
}); // NEW

test('expanded repeat planning shows every eligible occurrence when any series card is expanded', () => { // NEW
    const plan = taskHooks.planRepeatSeriesVisibility([ // NEW
        { id: 'a', seriesKey: 'series', laneKey: 'TODO', startISO: '2026-04-01' }, // NEW
        { id: 'b', seriesKey: 'series', laneKey: 'TODO', startISO: '2026-04-08' }, // NEW
        { id: 'hidden-year', seriesKey: 'series', laneKey: 'TODO', startISO: '2025-01-01', yearHidden: true, expanded: true } // NEW
    ]); // NEW
    const byId = new Map(plan.map(item => [item.id, item])); // NEW

    assert.equal(byId.get('a').repeatHidden, false); // NEW
    assert.equal(byId.get('a').repeatBadge, '1/2'); // NEW
    assert.equal(byId.get('b').repeatHidden, false); // NEW
    assert.equal(byId.get('b').repeatBadge, '2/2'); // NEW
    assert.equal(byId.get('hidden-year').repeatBadge, ''); // NEW
}); // NEW

test('repeat planning clears stale state and uses deterministic malformed-date fallbacks', () => { // NEW
    const single = taskHooks.planRepeatSeriesVisibility([ // NEW
        { id: 'only', seriesKey: 'single', laneKey: 'DONE', startISO: 'bad-date', expanded: true } // NEW
    ])[0]; // NEW
    assert.equal(single.repeatHidden, false); // NEW
    assert.equal(single.repeatBadge, ''); // NEW

    const ordered = [ // NEW
        { id: 'z-invalid', startISO: 'invalid', endISO: '2026-04-02' }, // NEW
        { id: 'b', startISO: '2026-04-01', endISO: '2026-04-03' }, // NEW
        { id: 'a', startISO: '2026-04-01', endISO: '2026-04-02' } // NEW
    ].sort(taskHooks.compareRepeatOccurrenceRecords); // NEW
    assert.equal(ordered.map(item => item.id).join(','), 'a,b,z-invalid'); // NEW
}); // NEW

test('repeat planning reveals the next source-lane card after a representative moves', () => { // NEW
    const key = 'move-series'; // NEW
    const before = taskHooks.planRepeatSeriesVisibility([ // NEW
        { id: 'a', seriesKey: key, laneKey: 'TODO', startISO: '2026-04-01' }, // NEW
        { id: 'b', seriesKey: key, laneKey: 'TODO', startISO: '2026-04-08' }, // NEW
        { id: 'c', seriesKey: key, laneKey: 'DOING', startISO: '2026-04-15' } // NEW
    ]); // NEW
    assert.equal(before.find(item => item.id === 'b').repeatHidden, true); // NEW

    const after = taskHooks.planRepeatSeriesVisibility([ // NEW
        { id: 'a', seriesKey: key, laneKey: 'DOING', startISO: '2026-04-01' }, // NEW
        { id: 'b', seriesKey: key, laneKey: 'TODO', startISO: '2026-04-08' }, // NEW
        { id: 'c', seriesKey: key, laneKey: 'DOING', startISO: '2026-04-15' } // NEW
    ]); // NEW
    const byId = new Map(after.map(item => [item.id, item])); // NEW
    assert.equal(byId.get('b').repeatHidden, false); // NEW
    assert.equal(byId.get('b').repeatBadge, '2/3'); // NEW
    assert.equal(byId.get('c').repeatHidden, true); // NEW
}); // NEW

test('done-lane repeats collapse and both hidden flags are excluded from rendering', () => { // NEW
    const donePlan = taskHooks.planRepeatSeriesVisibility([ // NEW
        { id: 'done-a', seriesKey: 'done-series', laneKey: 'DONE', startISO: '2026-04-01' }, // NEW
        { id: 'done-b', seriesKey: 'done-series', laneKey: 'DONE', startISO: '2026-04-02' } // NEW
    ]); // NEW
    assert.equal(donePlan.find(item => item.id === 'done-a').repeatBadge, '1/2 +1'); // NEW
    assert.equal(donePlan.find(item => item.id === 'done-b').repeatHidden, true); // NEW
    assert.equal(taskHooks.isCardVisibilityEligible({}), true); // NEW
    assert.equal(taskHooks.isCardVisibilityEligible({ repeat_hidden: '1' }), false); // NEW
    assert.equal(taskHooks.isCardVisibilityEligible({ year_hidden: '1' }), false); // NEW
}); // NEW

test('completion logic remains independent from renderability', () => { // NEW
    const source = fs.readFileSync(taskManagerPath, 'utf8'); // NEW
    const start = source.indexOf('function allLinkedCardsDone'); // NEW
    const end = source.indexOf('function updateGroupRenderState', start); // NEW
    const completionSource = source.slice(start, end); // NEW

    assert.match(completionSource, /\.filter\(isKanbanCard\)/); // NEW
    assert.doesNotMatch(completionSource, /isRenderableKanbanCard|isCardVisibilityEligible/); // NEW
}); // NEW

test('new task cards store scheduler dates as active and baseline dates', () => {
    const attrs = taskHooks.buildInitialCardDateAttributes('2026-04-10', '2026-04-13');
    assert.equal(attrs.start, '2026-04-10');
    assert.equal(attrs.end, '2026-04-13');
    assert.equal(attrs.base_start, '2026-04-10');
    assert.equal(attrs.base_end, '2026-04-13');
    assert.equal(Object.hasOwn(attrs, 'date_override'), false);
});

test('new task cards copy scheduler task type metadata', () => { // NEW
    assert.deepEqual({ ...taskHooks.buildSchedulerTaskMetadataAttributes({ task_type_id: 'watering' }) }, { task_type_id: 'watering' }); // CHANGE
    assert.deepEqual({ ...taskHooks.buildSchedulerTaskMetadataAttributes({ taskTypeId: 'general' }) }, { task_type_id: 'general' }); // CHANGE
    assert.deepEqual({ ...taskHooks.buildSchedulerTaskMetadataAttributes({}) }, {}); // CHANGE
}); // NEW

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
    assert.match(source, /badgesHtml \+ repeatBadge \+ noteBadge \+ editedDateBadge \+ linkBadge/); // CHANGE
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
