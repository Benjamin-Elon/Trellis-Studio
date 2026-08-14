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
const schedulerCorePaths = [
    'Garden_Scheduler_Shared_Core.js',
    'Garden_Scheduler_Annual_Core.js',
    'Garden_Scheduler_Perennial_Core.js'
].map(fileName => path.join(
    __dirname,
    '..',
    'drawio',
    'src',
    'main',
    'webapp',
    'plugins',
    'garden_planner_plugins',
    fileName
));
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
    for (const corePath of schedulerCorePaths) {
        vm.runInContext(fs.readFileSync(corePath, 'utf8'), context, {
            filename: corePath
        });
    }
    vm.runInContext(fs.readFileSync(schedulerPath, 'utf8'), context, {
        filename: schedulerPath
    });
    const hooks = context.window.__TRELLIS_PLANTING_SCHEDULER_TEST_HOOKS__;
    hooks.__testWindow = context.window;
    return hooks;
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

function makeVancouverCity(overrides = {}) {
    const means = { 1: 4, 2: 5.5, 3: 8, 4: 10, 5: 13, 6: 16, 7: 18.5, 8: 18.5, 9: 14.5, 10: 8.5, 11: 4.5, 12: 4 };
    const row = {
        city_name: 'Vancouver, BC',
        gdd_annual: 1550,
        gdd_base_c: 5,
        last_spring_frost_doy: 1,
        ...overrides
    };
    for (let month = 1; month <= 12; month += 1) {
        row[`avg_monthly_high_c${month}`] = means[month] + 2;
        row[`avg_monthly_low_c${month}`] = means[month] - 2;
    }
    return new hooks.CityClimate(row);
}

function makeLangleyColdCity(overrides = {}) {
    const lowsHighs = [[-10, 11], [-9, 11], [-3, 16], [0, 21], [4, 26], [7, 30], [10, 31], [10, 33], [7, 28], [1, 21], [-3, 14], [-9, 10]];
    const row = { city_name: 'Langley, BC', gdd_annual: 1969, gdd_base_c: 5, last_spring_frost_doy: 1, ...overrides };
    lowsHighs.forEach(function ([lo, hi], index) {
        row[`avg_monthly_low_c${index + 1}`] = lo;
        row[`avg_monthly_high_c${index + 1}`] = hi;
    });
    return new hooks.CityClimate(row);
}

const LANGLEY_LATE_STORED_FALL_FROST = { first_fall_frost_p50_doy: 345, first_fall_frost_doy: 345 };

function makeDailyClimateRange(startISO, endISO, defaultRecord, overrides = {}) {
    const days = {};
    for (let cur = new Date(`${startISO}T00:00:00Z`), end = new Date(`${endISO}T00:00:00Z`); cur <= end; cur.setUTCDate(cur.getUTCDate() + 1)) {
        const iso = cur.toISOString().slice(0, 10);
        days[iso] = { ...defaultRecord, ...(overrides[iso] || {}) };
    }
    return { days, diagnostics: {} };
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
        killtemp_c: null,
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
    harvestWindowDays = 7,
    minYieldMultiplier = 0,
    policy = null,
    bedProfile = null,
    dailyClimate = null
} = {}) {
    return new hooks.ScheduleInputs({
        plant,
        city,
        planningMode,
        methodCategoryId,
        methodId,
        startISO,
        seasonEndISO,
        policy: policy || new hooks.PolicyFlags({
            useSpringFrostGate: false,
            useSoilTempGate: false,
            overwinterAllowed: plant.isBiennial() || plant.isPerennial() || plant.overwinter_ok === 1
        }),
        seasonStartYear,
        harvestWindowDays,
        minYieldMultiplier,
        bedProfile,
        dailyClimate
    });
}

function makeRepeatRule(overrides = {}) {
    return {
        id: 'water',
        title: 'Water {plant}',
        startAnchorStage: 'SOW',
        startOffsetDays: 0,
        startOffsetDirection: 'after',
        endMode: 'fixed_days',
        durationDays: 0,
        repeatMode: 'interval',
        repeatEveryDays: 7,
        repeatUntilMode: 'x_times',
        repeatTimes: 5,
        repeatUntilAnchorStage: 'HARVEST_END',
        repeatCutoffOffsetDays: 0,
        repeatCutoffOffsetDirection: 'after',
        ...overrides
    };
}

function makeAutoWindowParams({
    plant = makePlant(),
    city = makeCity(),
    methodCategoryId = 'direct_sow',
    methodId = 'direct_sow.field',
    year = 2026,
    harvestWindowDays = 7,
    bedProfile = null,
    dailyClimate = null,
    windowOptions = null
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
        scanEndHard: new Date(`${year + hooks.getPlantScanYears(plant) - 1}-12-31T00:00:00Z`),
        soilGateThresholdC: Number.isFinite(Number(plant.soil_temp_min_plant_c)) ? Number(plant.soil_temp_min_plant_c) : null,
        soilGateConsecutiveDays: 3,
        startCoolingThresholdC: Number.isFinite(Number(plant.start_cooling_threshold_c)) ? Number(plant.start_cooling_threshold_c) : null,
        useSpringFrostGate: false,
        lastSpringFrostDOY: city.last_spring_frost_p50_doy || city.last_spring_frost_doy || 1,
        daysTransplant: Number(plant.days_transplant || 0),
        overwinterAllowed: plant.overwinter_ok === 1,
        plantMetadata: plant,
        cityLatitudeDeg: Number.isFinite(Number(city.latitude)) ? Number(city.latitude) : null,
        bedProfile,
        dailyClimate,
        windowOptions
    };
}

function makeDailyClimate(year, defaultMeanC, overrides = {}) {
    const days = {};
    for (let d = new Date(`${year}-01-01T00:00:00Z`); d <= new Date(`${year}-12-31T00:00:00Z`); d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1))) {
        const iso = d.toISOString().slice(0, 10);
        const mean = Number(overrides[iso] ?? defaultMeanC);
        days[iso] = Object.freeze({ min: mean - 1, max: mean + 1, mean });
    }
    return Object.freeze({ days: Object.freeze(days), diagnostics: Object.freeze({ source: 'test daily climate', forecastBlendDays: 0, missingNormalDays: 0 }) });
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

function makeSchedulerGuardCell(attrs = {}) {
    return {
        getAttribute(key) { return Object.prototype.hasOwnProperty.call(attrs, key) ? attrs[key] : null; }
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

test('annual latest harvest display date does not cap feasibility', async () => {
    const plant = makePlant({ days_maturity: 30, gdd_to_maturity: null, harvest_window_days: 7 });
    const inputs = makeInputs({ plant, city: makeCity(20), startISO: '2026-05-01', seasonEndISO: '2026-05-15' });
    const result = hooks.computeScheduleResult(inputs);
    assert.equal(result.rows[0].harvEnd, '2026-06-07');
    const rows = await hooks.explainFeasibilityOverSeason(inputs, 1, false);
    const diagnostics = hooks.buildFeasibilityDiagnostics(inputs, rows);
    assert.match(diagnostics, /Effective hard end: 2027-12-31 \(lifecycle scan end\)/);
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

test('indoor transplant primary date derives sow date for scheduler core', () => {
    const sowISO = hooks.sowDateFromPrimaryDate('2026-04-10', 'transplant.indoor', 21);
    assert.equal(sowISO, '2026-03-20');
    const plant = makePlant({ days_transplant: 21 });
    const result = hooks.computeScheduleResult(makeInputs({
        plant,
        planningMode: 'transplant_indoor',
        methodCategoryId: 'transplant',
        methodId: 'transplant.indoor',
        startISO: sowISO
    }));
    assert.equal(result.rows[0].sow, '2026-03-20');
    assert.equal(result.rows[0].trans, '2026-04-10');
});

test('cutting transplant primary date uses transplant-date conversion', () => {
    const sowISO = hooks.sowDateFromPrimaryDate('2026-04-10', 'transplant.cutting', 21);
    assert.equal(sowISO, '2026-03-20');
    assert.equal(hooks.primaryDateFromSowDate(sowISO, 'transplant.cutting', 21), '2026-04-10');
});

test('transplant lead override availability follows lead-day transplant methods', () => {
    assert.equal(hooks.methodUsesTransplantDateInput('transplant.indoor'), true);
    assert.equal(hooks.methodUsesTransplantDateInput('transplant.cutting'), true);
    assert.equal(hooks.methodUsesTransplantDateInput('transplant.outdoor'), false);
    assert.equal(hooks.methodUsesTransplantDateInput('transplant.purchased'), false);
    assert.equal(hooks.methodUsesTransplantDateInput('direct_sow.field'), false);
    const schedulerSource = fs.readFileSync(schedulerPath, 'utf8');
    assert.match(schedulerSource, /function updateTransplantDaysControls\(\)[\s\S]*const visible = currentMethodUsesTransplantDateInput\(\);/);
    assert.match(schedulerSource, /formState\.transplantDaysOverrideEnabled = usesTransplantDate && !!transplantDaysOverrideChk\.checked;/);
});

test('cell transplant-days override beats plant default for derived sow date', () => {
    const cell = makeAttributeCell({ days_transplant: '35' });
    const overrideDays = hooks.readCellTransplantDaysOverride(cell);
    const plant = makePlant({ days_transplant: 21 });
    const config = hooks.resolveTransplantDaysConfig(plant, {
        methodId: 'transplant.indoor',
        overrideEnabled: overrideDays != null,
        overrideValue: overrideDays
    });
    assert.equal(config.effectiveDays, 35);
    assert.equal(hooks.sowDateFromPrimaryDate('2026-04-24', 'transplant.indoor', config.effectiveDays), '2026-03-20');
});

test('schedule patch persists transplant-days only for explicit cell override', () => {
    const plant = makePlant({ days_transplant: 21 });
    const inputs = makeInputs({
        plant,
        planningMode: 'transplant_indoor',
        methodCategoryId: 'transplant',
        methodId: 'transplant.indoor',
        startISO: '2026-03-20'
    });
    const result = hooks.computeScheduleResult(inputs);
    const inheritPatch = hooks.buildScheduleAttributePatch(inputs, result, { transplantDaysOverrideEnabled: false });
    assert.equal(inheritPatch.sow_date, '2026-03-20');
    assert.equal(inheritPatch.transplant_date, '2026-04-10');
    assert.equal(inheritPatch.days_transplant, null);
    const overridePatch = hooks.buildScheduleAttributePatch(inputs, result, { transplantDaysOverrideEnabled: true, effectiveTransplantDays: 21 });
    assert.equal(overridePatch.days_transplant, '21');
});

test('schedule patch persists growth stage metadata and stage-adjusted layout', () => {
    const basePlant = makePlant({
        plant_name: 'Lettuce',
        days_maturity: 40,
        spacing_cm: 30,
        spacing_x_cm: 30,
        spacing_y_cm: 40,
        veg_diameter_cm: 20,
        veg_height_cm: 10
    });
    const plant = hooks.applyGrowthStageToPlant(basePlant, hooks.normalizeGrowthStage({
        stage_key: 'microgreens',
        stage_label: 'Microgreens',
        gdd_ratio: 0.25
    }));
    const inputs = makeInputs({ plant });
    const result = hooks.computeScheduleResult(inputs);
    const patch = hooks.buildScheduleAttributePatch(inputs, result);

    assert.equal(patch.label, 'Lettuce - Microgreens group');
    assert.equal(patch.days_maturity, '10');
    assert.equal(patch.growth_stage_key, 'microgreens');
    assert.equal(patch.growth_stage_label, 'Microgreens');
    assert.equal(patch.growth_stage_gdd_ratio, '0.25');
    assert.equal(patch.growth_stage_spacing_ratio, '0.5');
    assert.equal(patch.growth_stage_diameter_ratio, '0.5');
    assert.equal(patch.growth_stage_height_ratio, '0.5');
    assert.equal(patch.spacing_cm, '15');
    assert.equal(patch.spacing_x_cm, '15');
    assert.equal(patch.spacing_y_cm, '20');
    assert.equal(patch.veg_diameter_cm, '10');
    assert.equal(patch.veg_height_cm, '5');
});

test('growth stage maturity scaling changes computed harvest dates', () => {
    const basePlant = makePlant({
        days_maturity: 40,
        days_germ: 0,
        harvest_window_days: 7
    });
    const stagePlant = hooks.applyGrowthStageToPlant(basePlant, hooks.normalizeGrowthStage({
        stage_key: 'microgreens',
        stage_label: 'Microgreens',
        gdd_ratio: 0.25
    }));

    const baseResult = hooks.computeScheduleResult(makeInputs({ plant: basePlant, startISO: '2026-04-01', harvestWindowDays: 7 }));
    const stageResult = hooks.computeScheduleResult(makeInputs({ plant: stagePlant, startISO: '2026-04-01', harvestWindowDays: 7 }));

    assert.equal(baseResult.rows[0].harvStart, '2026-05-11');
    assert.equal(stageResult.rows[0].harvStart, '2026-04-11');
    assert.equal(stageResult.lastScheduledHarvestEndISO, '2026-04-18');
});

test('schedule patch ignores transplant-days override for methods without lead days', () => {
    const plant = makePlant({ days_transplant: 21 });
    const cases = [
        { planningMode: 'transplant_outdoor', methodCategoryId: 'transplant', methodId: 'transplant.outdoor' },
        { planningMode: 'transplant_outdoor', methodCategoryId: 'transplant', methodId: 'transplant.purchased' },
        { planningMode: 'direct_sow', methodCategoryId: 'direct_sow', methodId: 'direct_sow.field' }
    ];
    for (const method of cases) {
        const inputs = makeInputs({ plant, ...method });
        const result = hooks.computeScheduleResult(inputs);
        const patch = hooks.buildScheduleAttributePatch(inputs, result, { transplantDaysOverrideEnabled: true, effectiveTransplantDays: 21 });
        assert.equal(patch.days_transplant, null, method.methodId);
    }
});

test('transplant-date display windows project sowing windows by lead days', () => {
    const projected = hooks.projectSowingSeasonForPrimaryDate({
        id: 'spring',
        label: 'Spring (Mar 20-Apr 20)',
        startISO: '2026-03-20',
        endISO: '2026-04-20'
    }, 'transplant.indoor', 21);
    assert.equal(projected.startISO, '2026-04-10');
    assert.equal(projected.endISO, '2026-05-11');
    assert.match(projected.label, /^Spring \(Apr 10-May 11\)$/);
});

test('lifecycle timeline shows annual direct sow and harvest milestones', () => {
    const plant = makePlant();
    const result = hooks.computeScheduleResult(makeInputs({ plant }));
    const model = hooks.buildLifecycleTimelineViewModel({
        plant,
        seasonStartYear: 2026,
        startISO: '2026-04-01',
        scheduleResult: result,
        sowingSeasons: [{ id: 'spring', label: 'Spring', startISO: '2026-03-01', endISO: '2026-05-15' }],
        todayISO: '2026-04-15'
    });
    assert.equal(model.hidden, false);
    assert.deepEqual(Array.from(model.visibleMilestones, m => m.stage), ['SOW', 'HARVEST_START', 'HARVEST_END']);
    assert.deepEqual(Array.from(model.visibleMilestones, m => m.abbr), ['S', 'HS', 'HE']);
    assert.equal(model.visibleMilestones.find(m => m.stage === 'SOW').iso, '2026-04-01');
    assert.equal(model.visibleMilestones.find(m => m.stage === 'HARVEST_START').iso, '2026-05-01');
    assert.equal(model.visibleMilestones.find(m => m.stage === 'HARVEST_END').iso, '2026-05-08');
    assert.equal(model.visibleMilestones.find(m => m.stage === 'HARVEST_START').tooltip, 'HS - First harvest: 2026-05-01');
});

test('lifecycle timeline exposes latest harvest as a separate non-task boundary', () => {
    const plant = makePlant();
    const model = hooks.buildLifecycleTimelineViewModel({
        plant,
        seasonStartYear: 2026,
        startISO: '2026-04-01',
        latestHarvestEndISO: '2026-11-30',
        scheduleResult: hooks.computeScheduleResult(makeInputs({ plant }))
    });
    assert.equal(model.latestHarvestBoundary.iso, '2026-11-30');
    assert.equal(model.latestHarvestBoundary.label, 'Latest harvest');
    assert.equal(model.latestHarvestBoundary.abbr, 'LH');
    assert.equal(model.latestHarvestBoundary.tooltip, 'Latest harvest: 2026-11-30');
    assert.equal(model.visibleMilestones.some(milestone => milestone.stage === 'LATEST_HARVEST_END'), false);
});

test('lifecycle timeline includes transplant milestone for transplant schedules', () => {
    const plant = makePlant({ days_transplant: 21 });
    const result = hooks.computeScheduleResult(makeInputs({
        plant,
        planningMode: 'transplant_indoor',
        methodCategoryId: 'transplant',
        methodId: 'transplant.indoor'
    }));
    const model = hooks.buildLifecycleTimelineViewModel({ plant, seasonStartYear: 2026, startISO: '2026-04-01', scheduleResult: result });
    const transplant = model.visibleMilestones.find(m => m.stage === 'TRANSPLANT');
    assert.ok(transplant);
    assert.equal(transplant.iso, '2026-04-22');
    assert.equal(transplant.abbr, 'T');
});

test('lifecycle timeline renders all feasible sowing seasons as bands', () => {
    const plant = makePlant();
    const model = hooks.buildLifecycleTimelineViewModel({
        plant,
        seasonStartYear: 2026,
        startISO: '2026-04-01',
        scheduleResult: hooks.computeScheduleResult(makeInputs({ plant })),
        sowingSeasons: [
            { id: 'spring', label: 'Spring', startISO: '2026-03-01', endISO: '2026-05-15' },
            { id: 'fall', label: 'Fall', startISO: '2026-08-01', endISO: '2026-09-15' }
        ]
    });
    assert.equal(model.bands.length, 2);
    assert.deepEqual(model.bands.map(b => b.id), ['spring', 'fall']);
    assert.ok(model.bands.every(b => b.widthPercent > 0));
});

test('lifecycle timeline axis renders quarterly months and year marker for annual range', () => {
    const plant = makePlant();
    const model = hooks.buildLifecycleTimelineViewModel({ plant, seasonStartYear: 2026, startISO: '2026-04-01' });
    assert.equal(JSON.stringify(model.axis.months.map(marker => marker.label)), JSON.stringify(['Jan', 'Apr', 'Jul', 'Oct']));
    assert.equal(JSON.stringify(model.axis.years.map(marker => marker.label)), JSON.stringify(['2026']));
    assert.ok(model.axis.months.concat(model.axis.years).every(marker => marker.percent >= 0 && marker.percent <= 100));
});

test('lifecycle timeline axis repeats quarterly months and year markers for multi-year range', () => {
    const plant = makePlant({ annual: 0, biennial: 1, lifespan_years: 2 });
    const model = hooks.buildLifecycleTimelineViewModel({ plant, seasonStartYear: 2026, startISO: '2026-04-01' });
    assert.equal(JSON.stringify(model.axis.months.map(marker => marker.label)), JSON.stringify(['Jan', 'Apr', 'Jul', 'Oct', 'Jan', 'Apr', 'Jul', 'Oct']));
    assert.equal(JSON.stringify(model.axis.years.map(marker => marker.label)), JSON.stringify(['2026', '2027']));
    assert.ok(model.axis.months.concat(model.axis.years).every(marker => marker.percent >= 0 && marker.percent <= 100));
});

test('lifecycle timeline axis clips markers to custom bounds', () => {
    const bounds = {
        start: new Date('2026-03-15T00:00:00Z'),
        end: new Date('2026-10-15T00:00:00Z')
    };
    const axis = hooks.buildLifecycleTimelineAxisMarkers(bounds, 214);
    assert.equal(JSON.stringify(axis.months.map(marker => marker.label)), JSON.stringify(['Apr', 'Jul', 'Oct']));
    assert.equal(JSON.stringify(axis.years.map(marker => marker.label)), JSON.stringify([]));
    assert.ok(axis.months.every(marker => marker.percent >= 0 && marker.percent <= 100));
});

test('lifecycle timeline uses full multi-year scan bounds', () => {
    const plant = makePlant({ annual: 0, biennial: 1, lifespan_years: 2 });
    const model = hooks.buildLifecycleTimelineViewModel({ plant, seasonStartYear: 2026, startISO: '2026-04-01' });
    assert.equal(model.bounds.startISO, '2026-01-01');
    assert.equal(model.bounds.endISO, '2027-12-31');
    assert.equal(model.bounds.multiYear, true);
});

test('lifecycle timeline today marker appears only inside range', () => {
    const plant = makePlant();
    const inside = hooks.buildLifecycleTimelineViewModel({ plant, seasonStartYear: 2026, startISO: '2026-04-01', todayISO: '2026-06-01' });
    const outside = hooks.buildLifecycleTimelineViewModel({ plant, seasonStartYear: 2026, startISO: '2026-04-01', todayISO: '2027-01-01' });
    assert.equal(inside.todayISO, '2026-06-01');
    assert.ok(inside.todayPercent > 0);
    assert.equal(outside.todayISO, null);
    assert.equal(outside.todayPercent, null);
});

test('lifecycle timeline hides germination and maturity while retaining marker tooltip text', () => {
    const plant = makePlant();
    const scheduleResult = {
        kind: 'annual',
        schedule: [new Date('2026-04-01T00:00:00Z')],
        timelines: [{
            germ: new Date('2026-04-02T00:00:00Z'),
            transplant: new Date('2026-04-03T00:00:00Z'),
            maturity: new Date('2026-04-04T00:00:00Z'),
            harvestStart: new Date('2026-04-05T00:00:00Z'),
            harvestEnd: new Date('2026-04-06T00:00:00Z')
        }]
    };
    const model = hooks.buildLifecycleTimelineViewModel({ plant, seasonStartYear: 2026, startISO: '2026-04-01', scheduleResult });
    assert.deepEqual(Array.from(model.visibleMilestones, m => m.stage), ['SOW', 'TRANSPLANT', 'HARVEST_START', 'HARVEST_END']);
    assert.deepEqual(Array.from(model.visibleMilestones, m => m.abbr), ['S', 'T', 'HS', 'HE']);
    assert.equal(model.milestones.find(m => m.stage === 'GERM').visible, false);
    assert.equal(model.milestones.find(m => m.stage === 'MATURITY').visible, false);
    assert.equal(Object.prototype.hasOwnProperty.call(model, 'labelRows'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(model, 'details'), false);
    assert.equal(model.visibleMilestones.find(m => m.stage === 'SOW').tooltip, 'S - Sow: 2026-04-01\nClick to focus sow date.');
});

test('lifecycle timeline marker layout leaves separated markers unshifted', () => {
    const offsets = hooks.layoutLifecycleTimelineMarkerOffsets([{ percent: 10 }, { percent: 30 }], 200, 24);
    assert.deepEqual(Array.from(offsets), [0, 0]);
});

test('lifecycle timeline marker layout spaces dense markers deterministically', () => {
    const offsets = hooks.layoutLifecycleTimelineMarkerOffsets([{ percent: 50 }, { percent: 55 }], 400, 24);
    assert.deepEqual(Array.from(offsets), [-12, 12]);
});

test('lifecycle timeline marker layout falls back to zero offsets without width', () => {
    const offsets = hooks.layoutLifecycleTimelineMarkerOffsets([{ percent: 50 }, { percent: 55 }], 0, 24);
    assert.deepEqual(Array.from(offsets), [0, 0]);
});

test('lifecycle timeline task association uses start anchors only', () => {
    const rules = [
        makeRepeatRule({ id: 'range', startAnchorStage: 'SOW', endMode: 'anchor_range', endAnchorStage: 'HARVEST_START' }),
        makeRepeatRule({ id: 'harvest', startAnchorStage: 'HARVEST_START' })
    ];
    const match = hooks.findFirstLifecycleTimelineTaskRule(rules, 'HARVEST_START');
    assert.equal(match.originalIndex, 1);
});

test('lifecycle timeline opens first matching task rule by display order', () => {
    const rules = [
        makeRepeatRule({ id: 'late', startAnchorStage: 'HARVEST_START' }),
        makeRepeatRule({ id: 'early', startAnchorStage: 'HARVEST_START' })
    ];
    const generatedTasks = [
        { previewRuleKey: hooks.getTaskPreviewRuleKey(rules[0], 0), startISO: '2026-05-10' },
        { previewRuleKey: hooks.getTaskPreviewRuleKey(rules[1], 1), startISO: '2026-05-01' }
    ];
    const match = hooks.findFirstLifecycleTimelineTaskRule(rules, 'HARVEST_START', generatedTasks);
    assert.equal(match.originalIndex, 1);
});

test('lifecycle timeline milestone task dot follows generated display order', () => {
    const plant = makePlant();
    const rules = [
        makeRepeatRule({ id: 'late', startAnchorStage: 'HARVEST_START' }),
        makeRepeatRule({ id: 'early', startAnchorStage: 'HARVEST_START' })
    ];
    const generatedTasks = [
        { previewRuleKey: hooks.getTaskPreviewRuleKey(rules[0], 0), startISO: '2026-05-10' },
        { previewRuleKey: hooks.getTaskPreviewRuleKey(rules[1], 1), startISO: '2026-05-01' }
    ];
    const model = hooks.buildLifecycleTimelineViewModel({
        plant,
        seasonStartYear: 2026,
        startISO: '2026-04-01',
        scheduleResult: hooks.computeScheduleResult(makeInputs({ plant })),
        taskRules: rules,
        generatedTasks
    });
    const harvestStart = model.visibleMilestones.find(m => m.stage === 'HARVEST_START');
    assert.equal(harvestStart.hasTaskRule, true);
    assert.equal(harvestStart.taskRuleIndex, 1);
});

test('indoor transplant gate outside scan end is rejected when annual cross-year harvests are disabled', () => {
    const plant = makePlant({ days_transplant: 20 });
    const policy = new hooks.PolicyFlags({ annualCrossYearHarvestAllowed: false });
    const planner = new hooks.Planner(makeInputs({
        plant,
        planningMode: 'transplant_indoor',
        methodCategoryId: 'transplant',
        methodId: 'transplant.indoor',
        startISO: '2026-12-20',
        seasonEndISO: '2026-12-31',
        policy
    }));
    const feasibility = planner.isSowFeasible(new Date('2026-12-20T00:00:00Z'));
    assert.equal(feasibility.ok, false);
    assert.equal(feasibility.reason, 'gate_outside_scan_window');
});

test('indoor transplant gate may validate into next year when annual cross-year harvests are allowed', () => {
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
    assert.equal(feasibility.ok, true);
    assert.equal(feasibility.maturity.toISOString().slice(0, 10), '2027-01-19');
    assert.equal(feasibility.harvestEnd.toISOString().slice(0, 10), '2027-01-26');
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

test('spring frost resolver prefers stored p50 before monthly inference', () => {
    const city = makeLangleyColdCity({ last_spring_frost_doy: null, last_spring_frost_p50_doy: 80 });
    const resolved = hooks.resolveSpringFrostByRisk(city, 'p50');
    assert.equal(resolved.source, 'stored');
    assert.equal(resolved.field, 'last_spring_frost_p50_doy');
    assert.equal(resolved.doy, 80);
});

test('spring frost resolver infers missing frost dates from monthly lows', () => {
    const city = makeLangleyColdCity({ last_spring_frost_doy: null });
    const resolved = hooks.resolveSpringFrostByRisk(city, 'p50');
    const tip = hooks.resolveFrostRiskTip(city, 'p50', 2026);
    assert.equal(resolved.source, 'inferred_monthly_normals');
    assert.equal(resolved.bufferDays, 14);
    assert.ok(resolved.doy >= 105 && resolved.doy <= 130, JSON.stringify(resolved));
    assert.match(tip.text, /^Inferred /);
    assert.match(tip.tooltip, /monthly low normals/);
});

test('spring frost resolver handles warm and unusable monthly normals', () => {
    const warm = new hooks.CityClimate(Object.fromEntries(
        Array.from({ length: 12 }, (_, index) => [`avg_monthly_low_c${index + 1}`, 3])
    ));
    const missing = new hooks.CityClimate({ city_name: 'Missing Frost City' });
    assert.deepEqual(
        (({ source, doy }) => ({ source, doy }))(hooks.resolveSpringFrostByRisk(warm, 'p50')),
        { source: 'inferred_monthly_normals', doy: 1 }
    );
    assert.deepEqual(
        (({ source, doy }) => ({ source, doy }))(hooks.resolveSpringFrostByRisk(missing, 'p50')),
        { source: 'fallback', doy: 105 }
    );
});

test('fall frost resolver prefers stored p50 before monthly inference', () => {
    const city = makeLangleyColdCity({ first_fall_frost_p50_doy: 300 });
    const resolved = hooks.resolveFallFrostByRisk(city, 'p50');
    assert.equal(resolved.source, 'stored');
    assert.equal(resolved.field, 'first_fall_frost_p50_doy');
    assert.equal(resolved.doy, 300);
});

test('fall frost resolver infers missing frost dates from monthly lows', () => {
    const city = makeLangleyColdCity();
    const resolved = hooks.resolveFallFrostByRisk(city, 'p50');
    assert.equal(resolved.source, 'inferred_monthly_normals');
    assert.equal(resolved.bufferDays, 14);
    assert.ok(resolved.doy >= 275 && resolved.doy <= 290, JSON.stringify(resolved));
});

test('fall frost resolver returns null without stored dates or a monthly crossing', () => {
    const warm = new hooks.CityClimate(Object.fromEntries(
        Array.from({ length: 12 }, (_, index) => [`avg_monthly_low_c${index + 1}`, 3])
    ));
    const missing = new hooks.CityClimate({ city_name: 'Missing Fall Frost City' });
    assert.deepEqual(
        (({ source, doy }) => ({ source, doy }))(hooks.resolveFallFrostByRisk(warm, 'p50')),
        { source: 'none', doy: null }
    );
    assert.deepEqual(
        (({ source, doy }) => ({ source, doy }))(hooks.resolveFallFrostByRisk(missing, 'p50')),
        { source: 'none', doy: null }
    );
});

test('annual crop cooling threshold does not force a fall-only sowing season', () => {
    const plant = makePlant({
        plant_name: 'Beet',
        days_maturity: 55,
        gdd_to_maturity: null,
        start_cooling_threshold_c: 24,
        overwinter_ok: 0
    });
    const result = hooks.computeScheduleResult(makeInputs({
        plant,
        city: makeCity(18),
        startISO: '2026-04-15'
    }));
    assert.equal(result.rows[0].sow, '2026-04-15');
    assert.equal(result.rows[0].harvStart, '2026-06-09');
});

test('bed-aware soil model opens Vancouver sweet corn threshold by early June', () => {
    const city = makeVancouverCity();
    const monthly = city.calibratedMonthlyMeans(2026);
    const genericReady = hooks.firstSoilReadyDate({
        thresholdC: 16,
        monthlyAvgTemp: monthly,
        scanStart: new Date('2026-01-01T00:00:00Z'),
        scanEndHard: new Date('2026-12-31T00:00:00Z'),
        bedProfile: null,
        consecutiveDays: 3
    });
    assert.ok(genericReady, 'expected generic garden bed to reach sweet corn soil threshold');
    assert.ok(genericReady >= new Date('2026-05-15T00:00:00Z'));
    assert.ok(genericReady <= new Date('2026-06-10T00:00:00Z'));
});

test('wet shaded high-frost bed delays soil readiness', () => {
    const city = makeVancouverCity();
    const monthly = city.calibratedMonthlyMeans(2026);
    const genericReady = hooks.firstSoilReadyDate({
        thresholdC: 16, monthlyAvgTemp: monthly, scanStart: new Date('2026-01-01T00:00:00Z'), scanEndHard: new Date('2026-12-31T00:00:00Z')
    });
    const coldBedReady = hooks.firstSoilReadyDate({
        thresholdC: 16,
        monthlyAvgTemp: monthly,
        scanStart: new Date('2026-01-01T00:00:00Z'),
        scanEndHard: new Date('2026-12-31T00:00:00Z'),
        bedProfile: { sunExposure: 'shade', soilMoisture: 'wet', drainage: 'slow', soilTexture: 'clay', windExposure: 'exposed', frostRisk: 'high' }
    });
    assert.ok(genericReady);
    assert.ok(coldBedReady === null || coldBedReady > genericReady);
});

test('annual GDD calibration matches stored city base GDD and recomputes crop-base heat', () => {
    const city = makeVancouverCity();
    const calibration = city.gddCalibration(2026);
    assert.equal(calibration.usable, true);
    assert.ok(Math.abs(calibration.calibratedGdd - 1550) < 0.5);
    assert.notEqual(Math.round(calibration.uncalibratedGdd), Math.round(calibration.calibratedGdd));
    const cropBaseGdd = hooks.annualGddFromMonthlyMeans(city.calibratedMonthlyMeans(2026), 10, 2026);
    assert.ok(cropBaseGdd > 0);
    assert.ok(cropBaseGdd < calibration.calibratedGdd);
});

test('daily climate curves interpolate monthly normals and blend near-term forecasts', () => {
    const shared = hooks.sharedCore;
    const climate = shared.buildDailyTemperatureSeries({
        startDate: new Date('2026-01-01T00:00:00Z'),
        endDate: new Date('2026-02-28T00:00:00Z'),
        monthlyNormals: {
            1: { min: 0, max: 10, mean: 5 },
            2: { min: 10, max: 20, mean: 15 },
            12: { min: -5, max: 5, mean: 0 }
        },
        forecastRows: [{ forecast_date: '2026-01-02', temp_min_c: 20, temp_max_c: 30, temp_mean_c: 25, run_timestamp: '2026-01-01T00:00:00Z' }],
        todayISO: '2026-01-01',
        source: 'test normals'
    });
    assert.ok(climate.days['2026-01-15'].mean > 4.5 && climate.days['2026-01-15'].mean < 5.5);
    assert.ok(climate.days['2026-01-31'].mean > climate.days['2026-01-15'].mean);
    assert.equal(climate.days['2026-01-02'].forecastWeight, 0.8);
    assert.ok(climate.days['2026-01-02'].mean > 15);
    assert.equal(climate.diagnostics.forecastBlendDays, 1);
});

test('single-sine GDD respects crop upper cap', () => {
    const shared = hooks.sharedCore;
    const hotDay = { min: 20, max: 40, mean: 30 };
    const uncapped = shared.singleSineDailyGdd(hotDay, 10, null);
    const capped = shared.singleSineDailyGdd(hotDay, 10, 30);
    assert.ok(uncapped > capped);
    assert.ok(capped > 0);
});

test('daily GDD calibration scales GDD rates without changing climate temperatures', () => {
    const shared = hooks.sharedCore;
    const climate = shared.buildDailyTemperatureSeries({
        startDate: new Date('2026-01-01T00:00:00Z'),
        endDate: new Date('2026-12-31T00:00:00Z'),
        monthlyNormals: Object.fromEntries(Array.from({ length: 12 }, (_, i) => [i + 1, { min: 10, max: 20, mean: 15 }])),
        source: 'constant test normals'
    });
    const before = climate.days['2026-06-01'].mean;
    const rates = shared.buildDailyGddMap({
        dailyClimate: climate,
        cropTemp: { Tbase: 5, Tmax: 35 },
        bedProfile: null,
        city: { gdd_annual: 1000, gdd_base_c: 5 },
        year: 2026
    });
    assert.equal(climate.days['2026-06-01'].mean, before);
    assert.ok(rates.__diagnostics.gddScale > 0);
    assert.ok(Math.abs(rates.__diagnostics.cityBaseAnnualGdd * rates.__diagnostics.gddScale - 1000) < 0.5);
});

test('bed frost risk shifts frost gate independently from soil temperature', () => {
    const shared = hooks.sharedCore;
    assert.equal(shared.bedFrostGateShiftDays({ frostRisk: 'none' }), -3);
    assert.equal(shared.bedFrostGateShiftDays({ frostRisk: 'low' }), 0);
    assert.equal(shared.bedFrostGateShiftDays({ frostRisk: 'medium' }), 5);
    assert.equal(shared.bedFrostGateShiftDays({ frostRisk: 'high' }), 10);
});

test('corn-like annual December sowing is blocked when daily lows exceed cold-survival tolerance', () => {
    const plant = makePlant({ plant_name: 'Sweet Corn', days_maturity: 30, tmin_c: 10, killtemp_c: null, tmax_c: 40, overwinter_ok: 0 });
    const city = makeSeasonalCity({ 1: -5, 2: -3, 3: 8, 4: 12, 5: 18, 6: 24, 7: 26, 8: 24, 9: 18, 10: 10, 11: 5, 12: 4 });
    const planner = new hooks.Planner(makeInputs({ plant, city, startISO: '2026-12-15' }));
    const feasibility = planner.isSowFeasible(new Date('2026-12-15T00:00:00Z'));
    assert.equal(feasibility.ok, false);
    assert.match(feasibility.reason, /^cold_survival_temp/);
});

test('explicit kill temperature can be stricter than the estimated tolerance', () => {
    const plant = makePlant({ days_maturity: 5, tmin_c: 0, killtemp_c: 5, tmax_c: 40, overwinter_ok: 0 });
    const planner = new hooks.Planner(makeInputs({ plant, city: makeCity(6), startISO: '2026-04-01' }));
    const feasibility = planner.isSowFeasible(new Date('2026-04-01T00:00:00Z'));
    assert.equal(feasibility.ok, false);
    assert.match(feasibility.reason, /^cold_survival_temp\(min 4\.\d<5\.0\)/);
});

test('explicit kill temperature can be hardier than the tmin estimate', () => {
    const plant = makePlant({ days_maturity: 5, tmin_c: 5, killtemp_c: -10, tmax_c: 40, overwinter_ok: 0 });
    const dailyClimate = { days: { '2026-04-01': { min: 1, max: 9, mean: 5 }, '2026-04-02': { min: 1, max: 9, mean: 5 }, '2026-04-03': { min: 1, max: 9, mean: 5 }, '2026-04-04': { min: 1, max: 9, mean: 5 }, '2026-04-05': { min: 1, max: 9, mean: 5 }, '2026-04-06': { min: 1, max: 9, mean: 5 } }, diagnostics: {} };
    const planner = new hooks.Planner(makeInputs({ plant, city: makeCity(5), startISO: '2026-04-01', dailyClimate }));
    const feasibility = planner.isSowFeasible(new Date('2026-04-01T00:00:00Z'));
    assert.equal(feasibility.ok, true);
});

test('tropical open-bed annuals allow cross-year harvests when climate gates pass', () => {
    const plant = makePlant({ days_maturity: 20, tmin_c: 12, killtemp_c: 18, tmax_c: 40, overwinter_ok: 0 });
    const planner = new hooks.Planner(makeInputs({ plant, city: makeCity(26), startISO: '2026-12-20' }));
    const feasibility = planner.isSowFeasible(new Date('2026-12-20T00:00:00Z'));
    assert.equal(feasibility.ok, true);
    assert.equal(feasibility.harvestEnd.toISOString().slice(0, 10), '2027-01-16');
});

test('cold open-bed annual harvests are rejected by cold-survival gates', () => {
    const plant = makePlant({ days_maturity: 5, tmin_c: 3, killtemp_c: null, tmax_c: 40, overwinter_ok: 0 });
    const planner = new hooks.Planner(makeInputs({ plant, city: makeCity(-5), startISO: '2026-12-15' }));
    const feasibility = planner.isSowFeasible(new Date('2026-12-15T00:00:00Z'));
    assert.equal(feasibility.ok, false);
    assert.match(feasibility.reason, /^cold_survival_temp/);
});

test('heated greenhouse bed effects can rescue a cold cross-year annual harvest', () => {
    const plant = makePlant({ days_maturity: 5, tmin_c: 3, killtemp_c: null, tmax_c: 40, overwinter_ok: 0 });
    const bedProfile = { seasonExtension: 'heated_greenhouse' };
    const planner = new hooks.Planner(makeInputs({ plant, city: makeCity(-5), startISO: '2026-12-15', bedProfile }));
    const feasibility = planner.isSowFeasible(new Date('2026-12-15T00:00:00Z'));
    assert.equal(feasibility.ok, true);
    assert.equal(feasibility.harvestEnd.toISOString().slice(0, 10), '2026-12-27');
});

test('missing kill temperature uses the tmin minus three estimate', () => {
    const plant = makePlant({ days_maturity: 5, tmin_c: 3, killtemp_c: null, tmax_c: 40, overwinter_ok: 0 });
    const planner = new hooks.Planner(makeInputs({ plant, city: makeCity(-2), startISO: '2026-12-15' }));
    const feasibility = planner.isSowFeasible(new Date('2026-12-15T00:00:00Z'));
    assert.equal(feasibility.ok, false);
    assert.match(feasibility.reason, /^cold_survival_temp\(min -[0-9.]+<0\.0\)/);
});

test('missing kill temperature and tmin use zero celsius fallback', () => {
    const plant = makePlant({ days_maturity: 5, tmin_c: null, killtemp_c: null, tmax_c: 40, overwinter_ok: 0 });
    const planner = new hooks.Planner(makeInputs({ plant, city: makeCity(-2), startISO: '2026-12-15' }));
    const feasibility = planner.isSowFeasible(new Date('2026-12-15T00:00:00Z'));
    assert.equal(feasibility.ok, false);
    assert.match(feasibility.reason, /^cold_survival_temp\(min -[0-9.]+<0\.0\)/);
});

test('cold shoulder-season daily lows block annual survival outside winter months', () => {
    const plant = makePlant({ days_maturity: 5, tmin_c: 0, killtemp_c: 0, tmax_c: 40, overwinter_ok: 0 });
    const planner = new hooks.Planner(makeInputs({ plant, city: makeCity(-2), startISO: '2026-03-15' }));
    const feasibility = planner.isSowFeasible(new Date('2026-03-15T00:00:00Z'));
    assert.equal(feasibility.ok, false);
    assert.match(feasibility.reason, /^cold_survival_temp/);
});

test('Langley-like sweet corn reports insufficient GDD before lethal cold instead of winter survival', () => {
    const plant = makePlant({ plant_name: 'Sweet Corn', days_maturity: 78, gdd_to_maturity: 1250, tbase_c: 10, tmin_c: 0, killtemp_c: null, tmax_c: 38, soil_temp_min_plant_c: 16 });
    const policy = new hooks.PolicyFlags({ useSpringFrostGate: false, useSoilTempGate: true, soilGateThresholdC: 16, soilGateConsecutiveDays: 3 });
    const planner = new hooks.Planner(makeInputs({ plant, city: makeLangleyColdCity(LANGLEY_LATE_STORED_FALL_FROST), startISO: '2026-01-01', policy }));
    const feasibility = planner.isSowFeasible(new Date('2026-04-29T00:00:00Z'));
    assert.equal(feasibility.ok, false);
    assert.match(feasibility.reason, /^insufficient_gdd_before_cold\(gdd [0-9.]+<1250\.0 deadline 2026-11-/);
});

test('Langley-like before-cold diagnostics summarize usable GDD instead of annual estimate', async () => {
    const plant = makePlant({ plant_name: 'Sweet Corn', days_maturity: 78, gdd_to_maturity: 1250, tbase_c: 10, tmin_c: 0, killtemp_c: null, tmax_c: 38, soil_temp_min_plant_c: 16 });
    const policy = new hooks.PolicyFlags({ useSpringFrostGate: false, useSoilTempGate: true, soilGateThresholdC: 16, soilGateConsecutiveDays: 3 });
    const inputs = makeInputs({ plant, city: makeLangleyColdCity(LANGLEY_LATE_STORED_FALL_FROST), startISO: '', policy });
    const rows = await hooks.explainFeasibilityOverSeason(inputs, 400, false);
    const summary = hooks.buildFeasibilityBlockingSummary(inputs, rows);
    assert.match(summary, /Primary blocker after frost\/soil readiness: insufficient_gdd_before_cold/);
    assert.match(summary, /GDD check: best usable GDD [0-9.]+<1250\.0 before 2026-11-/);
    assert.doesNotMatch(summary, /calibrated crop-base estimate/);
});

test('annual GDD crop remains feasible when maturity and harvest finish before lethal cold', () => {
    const plant = makePlant({ days_maturity: null, gdd_to_maturity: 100, tbase_c: 5, tmin_c: 0, killtemp_c: 0, tmax_c: 40, harvest_window_days: 7 });
    const dailyClimate = makeDailyClimateRange('2026-04-01', '2026-04-30', { min: 10, max: 30, mean: 20 }, { '2026-04-20': { min: -1, max: 9, mean: 4 } });
    const planner = new hooks.Planner(makeInputs({ plant, city: makeCity(20), startISO: '2026-04-01', dailyClimate }));
    const feasibility = planner.isSowFeasible(new Date('2026-04-01T00:00:00Z'));
    assert.equal(feasibility.ok, true);
    assert.equal(feasibility.harvestEnd.toISOString().slice(0, 10), '2026-04-14');
});

test('annual crop reports cold survival when harvest window overlaps lethal cold', () => {
    const plant = makePlant({ days_maturity: 5, gdd_to_maturity: null, tbase_c: 5, tmin_c: 0, killtemp_c: 0, tmax_c: 40, harvest_window_days: 7 });
    const dailyClimate = makeDailyClimateRange('2026-04-01', '2026-04-30', { min: 10, max: 30, mean: 20 }, { '2026-04-09': { min: -1, max: 9, mean: 4 } });
    const planner = new hooks.Planner(makeInputs({ plant, city: makeCity(20), startISO: '2026-04-01', dailyClimate }));
    const feasibility = planner.isSowFeasible(new Date('2026-04-01T00:00:00Z'));
    assert.equal(feasibility.ok, false);
    assert.match(feasibility.reason, /^cold_survival_temp/);
});

test('explicit kill temperature changes the cold GDD deadline', () => {
    const plant = makePlant({ days_maturity: null, gdd_to_maturity: 500, tbase_c: 5, tmin_c: 0, killtemp_c: -5, tmax_c: 40, harvest_window_days: 7 });
    const planner = new hooks.Planner(makeInputs({ plant, city: makeLangleyColdCity(), startISO: '2026-04-29' }));
    const feasibility = planner.isSowFeasible(new Date('2026-04-29T00:00:00Z'));
    assert.equal(feasibility.ok, true);
    assert.ok(feasibility.harvestEnd <= new Date('2026-11-28T00:00:00Z'), feasibility.harvestEnd.toISOString());
});

test('heated greenhouse can push lethal cold deadline later and rescue GDD maturity', () => {
    const plant = makePlant({ days_maturity: null, gdd_to_maturity: 1150, tbase_c: 10, tmin_c: 0, killtemp_c: 0, tmax_c: 40, harvest_window_days: 7 });
    const open = new hooks.Planner(makeInputs({ plant, city: makeLangleyColdCity(LANGLEY_LATE_STORED_FALL_FROST), startISO: '2026-04-29' })).isSowFeasible(new Date('2026-04-29T00:00:00Z'));
    const protectedBed = { seasonExtension: 'heated_greenhouse' };
    const protectedResult = new hooks.Planner(makeInputs({ plant, city: makeLangleyColdCity(LANGLEY_LATE_STORED_FALL_FROST), startISO: '2026-04-29', bedProfile: protectedBed })).isSowFeasible(new Date('2026-04-29T00:00:00Z'));
    assert.match(open.reason, /^insufficient_gdd_before_cold/);
    assert.equal(protectedResult.ok, true);
});

test('season extension override values take precedence over preset defaults', () => {
    const shared = hooks.sharedCore;
    const effects = shared.seasonExtensionEffects({
        seasonExtension: 'heated_greenhouse',
        seasonExtensionAirOffsetC: 1.25,
        seasonExtensionSoilOffsetC: 2.5,
        seasonExtensionFrostShiftDays: -12,
        seasonExtensionMinAirTempC: 4
    });
    assert.equal(effects.airOffsetC, 1.25);
    assert.equal(effects.soilOffsetC, 2.5);
    assert.equal(effects.frostShiftDays, -12);
    assert.equal(effects.minAirTempC, 4);
});

test('annual cross-year policy disables cross-year harvests even with overwinter metadata', () => {
    const plant = makePlant({ days_maturity: 30, overwinter_ok: 1 });
    const blockedPolicy = new hooks.PolicyFlags({ annualCrossYearHarvestAllowed: false, overwinterAllowed: true });
    const allowedPolicy = new hooks.PolicyFlags({ annualCrossYearHarvestAllowed: true, overwinterAllowed: true });
    const blocked = new hooks.Planner(makeInputs({ plant, city: makeCity(20), startISO: '2026-12-15', policy: blockedPolicy })).isSowFeasible(new Date('2026-12-15T00:00:00Z'));
    const allowed = new hooks.Planner(makeInputs({ plant, city: makeCity(20), startISO: '2026-12-15', policy: allowedPolicy })).isSowFeasible(new Date('2026-12-15T00:00:00Z'));
    assert.equal(blocked.ok, false);
    assert.equal(blocked.reason, 'cross_year_disallowed');
    assert.equal(allowed.ok, true);
});

test('strict GDD maturity remains infeasible when target exceeds calibrated cross-year scan heat', () => {
    const city = makeVancouverCity();
    const plant = makePlant({
        plant_name: 'Sweet Corn',
        days_maturity: 78,
        gdd_to_maturity: 4000,
        tbase_c: 10,
        tmin_c: 8,
        topt_low_c: 18,
        topt_high_c: 30,
        tmax_c: 35,
        soil_temp_min_plant_c: null
    });
    const planner = new hooks.Planner(makeInputs({ plant, city, startISO: '2026-06-01' }));
    const result = planner.isSowFeasible(new Date('2026-06-01T00:00:00Z'));
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'insufficient_gdd');
});

test('warning-tolerant annual schedule uses DTM when GDD is short', () => {
    const plant = makePlant({ gdd_to_maturity: 10000, days_maturity: 42, tbase_c: 5 });
    const inputs = makeInputs({ plant, city: makeCity(20), startISO: '2026-04-01' });
    assert.throws(() => hooks.annualCore.computeAnnualScheduleResult(inputs), /growing-degree accumulation/);
    const result = hooks.computeScheduleResult(inputs);
    assert.equal(result.rows[0].harvStart, '2026-05-13');
    assert.ok(result.warnings.some(warning => warning.type === 'insufficient_gdd_dtm_fallback'));
});

test('warning-tolerant annual schedule scales GDD only within cap', () => {
    const city = makeCity(10);
    city.first_fall_frost_doy = 300;
    const plant = makePlant({ days_maturity: null, gdd_to_maturity: 2200, tbase_c: 5, tmin_c: 0, tmax_c: 40 });
    const policy = new hooks.PolicyFlags({ annualCrossYearHarvestAllowed: false });
    const inputs = makeInputs({ plant, city, startISO: '2026-01-01', policy });
    assert.throws(() => hooks.annualCore.computeAnnualScheduleResult(inputs), /growing-degree accumulation/);
    const result = hooks.computeScheduleResult(inputs);
    const warning = result.warnings.find(item => item.type === 'insufficient_gdd_scaled_fallback');
    assert.ok(warning, JSON.stringify(result.warnings));
    assert.ok(warning.scaleFactor > 1 && warning.scaleFactor <= 2, JSON.stringify(warning));
    assert.match(warning.message, /scaled GDD/);
});

test('warning-tolerant annual schedule uses inferred fall frost as thermal deadline', () => {
    const city = makeLangleyColdCity();
    const inferred = hooks.resolveFallFrostByRisk(city, 'p50');
    const plant = makePlant({ days_maturity: null, gdd_to_maturity: 3000, tbase_c: 5, tmin_c: -30, tmax_c: 45 });
    const policy = new hooks.PolicyFlags({ annualCrossYearHarvestAllowed: true });
    const result = hooks.computeScheduleResult(makeInputs({ plant, city, startISO: '2026-01-01', policy }));
    const warning = result.warnings.find(item => item.type === 'insufficient_gdd_scaled_fallback');
    assert.equal(inferred.source, 'inferred_monthly_normals');
    assert.ok(warning, JSON.stringify(result.warnings));
    assert.equal(warning.deadlineSource, 'fall frost');
    assert.equal(warning.deadlineISO, `2026-${String(new Date(Date.UTC(2026, 0, inferred.doy)).getUTCMonth() + 1).padStart(2, '0')}-${String(new Date(Date.UTC(2026, 0, inferred.doy)).getUTCDate()).padStart(2, '0')}`);
});

test('warning-tolerant annual schedule does not invent fall frost without a crossing', () => {
    const city = makeCity(20);
    city.first_fall_frost_doy = null;
    const inferred = hooks.resolveFallFrostByRisk(city, 'p50');
    const plant = makePlant({ days_maturity: null, gdd_to_maturity: 15000, tbase_c: 5, tmin_c: -30, tmax_c: 45 });
    const policy = new hooks.PolicyFlags({ annualCrossYearHarvestAllowed: true });
    const result = hooks.computeScheduleResult(makeInputs({ plant, city, startISO: '2026-01-01', policy, harvestWindowDays: 0 }));
    const warning = result.warnings.find(item => item.type === 'insufficient_gdd_scaled_fallback');
    assert.equal(inferred.source, 'none');
    assert.ok(warning, JSON.stringify(result.warnings));
    assert.equal(warning.deadlineSource, 'scan hard end');
});

test('warning-tolerant annual schedule scales GDD before lethal cold when within cap', () => {
    const city = makeCity(20);
    const plant = makePlant({ days_maturity: 90, gdd_to_maturity: 640, tbase_c: 10, tmin_c: -20, killtemp_c: -10, tmax_c: 40, harvest_window_days: 7 });
    const dailyClimate = makeDailyClimateRange('2026-09-01', '2026-12-15', { min: 10, max: 30, mean: 20 }, {
        ...Object.fromEntries(Array.from({ length: 30 }, (_, index) => [`2026-11-${String(index + 1).padStart(2, '0')}`, { min: -9, max: -1, mean: -5 }])),
        ...Object.fromEntries(Array.from({ length: 15 }, (_, index) => [`2026-12-${String(index + 1).padStart(2, '0')}`, { min: -11, max: -1, mean: -6 }]))
    });
    const inputs = makeInputs({ plant, city, startISO: '2026-09-01', dailyClimate });
    assert.throws(() => hooks.annualCore.computeAnnualScheduleResult(inputs), /before lethal cold/);
    const result = hooks.computeScheduleResult(inputs);
    const warning = result.warnings.find(item => item.type === 'insufficient_gdd_before_cold_scaled_fallback');
    assert.ok(warning, JSON.stringify(result.warnings));
    assert.ok(warning.scaleFactor > 1 && warning.scaleFactor <= 2, JSON.stringify(warning));
    assert.equal(result.rows[0].harvEnd, '2026-11-07');
});

test('warning-tolerant annual schedule blocks GDD scaling above cap or without heat', () => {
    const scaledCity = makeCity(10);
    scaledCity.first_fall_frost_doy = 300;
    const tooHigh = makePlant({ days_maturity: null, gdd_to_maturity: 4000, tbase_c: 5, tmin_c: 0, tmax_c: 40 });
    assert.throws(() => hooks.computeScheduleResult(makeInputs({ plant: tooHigh, city: scaledCity, startISO: '2026-01-01' })), /insufficient gdd scale cap/);
    const noHeat = makePlant({ days_maturity: null, gdd_to_maturity: 100, tbase_c: 50, tmin_c: 0, tmax_c: 60 });
    assert.throws(() => hooks.computeScheduleResult(makeInputs({ plant: noHeat, city: makeCity(4), startISO: '2026-01-01' })), /insufficient gdd no heat/);
});

test('warning-tolerant annual schedule fails when before-cold scaling exceeds cap', () => {
    const city = makeCity(20);
    const plant = makePlant({ days_maturity: 90, gdd_to_maturity: 2000, tbase_c: 10, tmin_c: -20, killtemp_c: -10, tmax_c: 40, harvest_window_days: 7 });
    const dailyClimate = makeDailyClimateRange('2026-09-01', '2026-12-15', { min: 10, max: 30, mean: 20 }, {
        ...Object.fromEntries(Array.from({ length: 30 }, (_, index) => [`2026-11-${String(index + 1).padStart(2, '0')}`, { min: -9, max: -1, mean: -5 }])),
        ...Object.fromEntries(Array.from({ length: 15 }, (_, index) => [`2026-12-${String(index + 1).padStart(2, '0')}`, { min: -11, max: -1, mean: -6 }]))
    });
    const planner = new hooks.Planner(makeInputs({ plant, city, startISO: '2026-09-01', dailyClimate }));
    const feasibility = hooks.annualCore.assessSowDateForSchedule(planner, new Date('2026-09-01T00:00:00Z'), { allowThermalWarnings: true });
    assert.match(feasibility.reason, /^insufficient_gdd_before_cold_scale_cap/);
    assert.throws(() => hooks.computeScheduleResult(makeInputs({ plant, city, startISO: '2026-09-01', dailyClimate })), /before lethal cold/);
});

test('warning-tolerant annual schedule reports no heat before lethal cold', () => {
    const city = makeCity(0);
    const plant = makePlant({ days_maturity: 90, gdd_to_maturity: 100, tbase_c: 10, tmin_c: -20, killtemp_c: -10, tmax_c: 40, harvest_window_days: 7 });
    const dailyClimate = makeDailyClimateRange('2026-09-01', '2026-12-15', { min: -9, max: -1, mean: -5 }, {
        ...Object.fromEntries(Array.from({ length: 15 }, (_, index) => [`2026-12-${String(index + 1).padStart(2, '0')}`, { min: -11, max: -1, mean: -6 }]))
    });
    const planner = new hooks.Planner(makeInputs({ plant, city, startISO: '2026-09-01', dailyClimate }));
    const feasibility = hooks.annualCore.assessSowDateForSchedule(planner, new Date('2026-09-01T00:00:00Z'), { allowThermalWarnings: true });
    assert.match(feasibility.reason, /^insufficient_gdd_before_cold_no_heat/);
});

test('thermal harvest and yield issues are warnings for selected-date schedules', () => {
    const cold = hooks.computeScheduleResult(makeInputs({ plant: makePlant({ tmin_c: 0, killtemp_c: -10, tmax_c: 40 }), city: makeCity(-5), startISO: '2026-03-01' }));
    assert.ok(cold.warnings.some(warning => warning.type === 'harvest_too_cold'), JSON.stringify(cold.warnings));
    const hot = hooks.computeScheduleResult(makeInputs({ plant: makePlant({ tmin_c: 0, tmax_c: 40 }), city: makeCity(50), startISO: '2026-01-01' }));
    assert.ok(hot.warnings.some(warning => warning.type === 'harvest_too_hot'), JSON.stringify(hot.warnings));
    const lowYieldPlant = makePlant({ tmin_c: 0, topt_low_c: 15, topt_high_c: 20, tmax_c: 40 });
    const lowYield = hooks.computeScheduleResult(makeInputs({ plant: lowYieldPlant, city: makeCity(39), startISO: '2026-01-01', minYieldMultiplier: 0.5 }));
    assert.ok(lowYield.warnings.some(warning => warning.type === 'yield_multiplier_below_minimum'), JSON.stringify(lowYield.warnings));
});

test('warning-tolerant annual schedule still blocks non-thermal gates', () => {
    assert.throws(() => hooks.computeScheduleResult(makeInputs({ startISO: '2027-01-01' })), /outside the planning season/);
    const frostCity = makeCity(20);
    frostCity.last_spring_frost_doy = 100;
    const frostPolicy = new hooks.PolicyFlags({ useSpringFrostGate: true, useSoilTempGate: false });
    assert.throws(() => hooks.computeScheduleResult(makeInputs({ city: frostCity, startISO: '2026-01-15', policy: frostPolicy })), /frost-safety date/);
    const soilPlant = makePlant({ soil_temp_min_plant_c: 30 });
    const soilPolicy = new hooks.PolicyFlags({ useSpringFrostGate: false, useSoilTempGate: true, soilGateThresholdC: 30, soilGateConsecutiveDays: 3 });
    assert.throws(() => hooks.computeScheduleResult(makeInputs({ plant: soilPlant, city: makeCity(10), startISO: '2026-05-01', policy: soilPolicy })), /soil is expected to be too cold/);
    const seasonalCity = makeSeasonalCity({ 1: 20, 2: 20, 3: 20, 4: 20, 5: 20, 6: 20, 7: 20, 8: 20, 9: 20, 10: 10, 11: 8, 12: 6 });
    const coolingPlant = makePlant({ overwinter_ok: 1, start_cooling_threshold_c: 12, days_maturity: 120 });
    assert.throws(() => hooks.computeScheduleResult(makeInputs({ plant: coolingPlant, city: seasonalCity, startISO: '2026-04-01' })), /seasonal cooling trigger/);
});

test('feasibility diagnostics include soil, bed, calibration, and failing gate summary', async () => {
    const city = makeVancouverCity();
    const plant = makePlant({ plant_name: 'Sweet Corn', gdd_to_maturity: 1250, days_maturity: 78, tbase_c: 10, soil_temp_min_plant_c: 16 });
    const policy = new hooks.PolicyFlags({ useSpringFrostGate: false, useSoilTempGate: true, soilGateThresholdC: 16, soilGateConsecutiveDays: 3 });
    const inputs = new hooks.ScheduleInputs({
        plant, city, planningMode: 'direct_sow', methodCategoryId: 'direct_sow', methodId: 'direct_sow.field',
        startISO: '2026-01-01', seasonEndISO: '2026-12-31', policy, seasonStartYear: 2026, harvestWindowDays: 7,
        bedProfile: { sunExposure: 'full_sun', soilMoisture: 'moderate', drainage: 'normal', soilTexture: 'loamy', windExposure: 'moderate', frostRisk: 'low' },
        bedProfileSource: 'garden bed bed1'
    });
    const rows = await hooks.explainFeasibilityOverSeason(inputs, 220, false);
    const text = hooks.buildFeasibilityDiagnostics(inputs, rows);
    assert.match(text, /Soil threshold: 16\.0 C/);
    assert.match(text, /Bed model: garden bed bed1/);
    assert.match(text, /Temperature calibration offset:/);
    assert.match(text, /Crop-base annual GDD estimate:/);
    assert.match(text, /First failing gate:/);
});

test('explain sowing range scans full scheduler span even with blank selected start', async () => {
    const city = makeVancouverCity();
    const plant = makePlant({ plant_name: 'Sweet Corn', gdd_to_maturity: 1250, tbase_c: 10, soil_temp_min_plant_c: 16 });
    const inputs = makeInputs({
        plant,
        city,
        startISO: '',
        seasonEndISO: '2026-12-31',
        harvestWindowDays: 7
    });
    const rows = await hooks.explainFeasibilityOverSeason(inputs, 400, false);
    const text = hooks.buildFeasibilityDiagnostics(inputs, rows);
    assert.equal(rows.length, 365);
    assert.equal(rows[0].date, '2026-01-01');
    assert.equal(rows[rows.length - 1].date, '2026-12-31');
    assert.match(text, /Scan range: 2026-01-01 to 2026-12-31, 365 days/);
    assert.doesNotMatch(text, /scan_not_run/);
});

test('feasibility scan ranges compress soil gate and insufficient GDD failures', async () => {
    const city = makeVancouverCity();
    const plant = makePlant({ plant_name: 'Sweet Corn', gdd_to_maturity: 1250, tbase_c: 10, soil_temp_min_plant_c: 16 });
    const policy = new hooks.PolicyFlags({ useSpringFrostGate: false, useSoilTempGate: true, soilGateThresholdC: 16, soilGateConsecutiveDays: 3 });
    const inputs = makeInputs({ plant, city, startISO: '', policy, harvestWindowDays: 7 });
    const rows = await hooks.explainFeasibilityOverSeason(inputs, 400, false);
    const ranges = hooks.compressFeasibilityScanRanges(rows);
    const formatted = hooks.formatFeasibilityScanRanges(rows);
    assert.ok(ranges.length < rows.length);
    assert.equal(ranges[0].start, '2026-01-01');
    assert.equal(ranges[0].reason, 'soil_gate');
    assert.ok(ranges.some(range => range.reason === 'insufficient_gdd'));
    assert.match(formatted, /soil_gate/);
    assert.match(formatted, /insufficient_gdd/);
    assert.doesNotMatch(formatted, /^\{"/m);
});

test('feasibility scan ranges normalize parameterized frost reasons', async () => {
    const city = makeVancouverCity({ last_spring_frost_p50_doy: 105, last_spring_frost_doy: 105 });
    const plant = makePlant({ plant_name: 'Sweet Corn', gdd_to_maturity: 1250, tbase_c: 10, soil_temp_min_plant_c: 16 });
    const policy = new hooks.PolicyFlags({ useSpringFrostGate: true, useSoilTempGate: true, soilGateThresholdC: 16, soilGateConsecutiveDays: 3 });
    const rows = await hooks.explainFeasibilityOverSeason(makeInputs({ plant, city, startISO: '', policy, harvestWindowDays: 7 }), 400, false);
    const ranges = hooks.compressFeasibilityScanRanges(rows);
    const formatted = hooks.formatFeasibilityScanRanges(rows);
    assert.equal(ranges[0].reason, 'spring_frost_gate');
    assert.equal(ranges[0].start, '2026-01-01');
    assert.equal(ranges[0].end, '2026-04-14');
    assert.equal(ranges[0].days, 104);
    assert.equal(ranges[0].detail, 'doy 1 < 105 -> doy 104 < 105');
    assert.equal(ranges.map(range => range.reason).join(','), 'spring_frost_gate,soil_gate,ok,insufficient_gdd,soil_gate');
    assert.match(formatted, /2026-01-01 to 2026-04-14 \(104 days\) \| spring_frost_gate/);
    assert.match(formatted, /2026-05-11 to 2026-06-29 .* \| ok/);
    assert.doesNotMatch(formatted, /2026-01-02 \(1 day\) \| spring_frost_gate/);
});

test('feasibility blocking summary preserves primary post-readiness GDD blocker with a narrow ok range', async () => {
    const city = makeVancouverCity({ last_spring_frost_p50_doy: 105, last_spring_frost_doy: 105 });
    const plant = makePlant({ plant_name: 'Sweet Corn', gdd_to_maturity: 1250, tbase_c: 10, soil_temp_min_plant_c: 16 });
    const policy = new hooks.PolicyFlags({ useSpringFrostGate: true, useSoilTempGate: true, soilGateThresholdC: 16, soilGateConsecutiveDays: 3 });
    const inputs = makeInputs({ plant, city, startISO: '', policy, harvestWindowDays: 7 });
    const rows = await hooks.explainFeasibilityOverSeason(inputs, 400, false);
    const summary = hooks.buildFeasibilityBlockingSummary(inputs, rows);
    const diagnostics = hooks.buildFeasibilityDiagnostics(inputs, rows);
    assert.match(summary, /Feasible sowing range found\./);
    assert.match(summary, /Primary blocker after frost\/soil readiness: insufficient_gdd/);
    assert.match(summary, /GDD check: crop needs 1250\.0 GDD; calibrated crop-base estimate is/);
    assert.match(diagnostics, /Failure summary: .*soil_gate: \d+/);
    assert.match(diagnostics, /Failure summary: .*insufficient_gdd: \d+/);
    assert.match(diagnostics, /Failure summary: .*spring_frost_gate: \d+/);
});

test('feasibility scan ranges normalize parameterized harvest temperature reasons', () => {
    const rows = [
        { date: '2026-01-01', ok: false, reason: 'harvest_too_cold(4.0<10)' },
        { date: '2026-01-02', ok: false, reason: 'harvest_too_cold(4.2<10)' },
        { date: '2026-01-03', ok: false, reason: 'harvest_too_hot(38.1>35)' },
        { date: '2026-01-04', ok: false, reason: 'harvest_too_hot(38.4>35)' }
    ];
    const ranges = hooks.compressFeasibilityScanRanges(rows);
    const formatted = hooks.formatFeasibilityScanRanges(rows);
    assert.equal(ranges.length, 2);
    assert.equal(ranges[0].reason, 'harvest_too_cold');
    assert.equal(ranges[0].detail, '4.0<10 -> 4.2<10');
    assert.equal(ranges[1].reason, 'harvest_too_hot');
    assert.equal(ranges[1].detail, '38.1>35 -> 38.4>35');
    assert.match(formatted, /harvest_too_cold/);
    assert.match(formatted, /harvest_too_hot/);
});

test('feasible scan ranges include representative maturity and harvest dates', async () => {
    const plant = makePlant({ plant_name: 'Fast Bean', days_maturity: 30, gdd_to_maturity: null });
    const rows = await hooks.explainFeasibilityOverSeason(makeInputs({ plant, city: makeCity(20), startISO: '' }), 400, false);
    const ranges = hooks.compressFeasibilityScanRanges(rows);
    const okRange = ranges.find(range => range.ok);
    assert.ok(okRange);
    assert.equal(okRange.reason, 'ok');
    assert.match(okRange.first_maturity, /^2026-/);
    assert.match(okRange.last_harvest_end, /^2027-/);
    assert.match(hooks.formatFeasibilityScanRanges(rows), /maturity .* -> /);
});

test('explain sowing range uses full multi-year scheduler scan span', async () => {
    const plant = makePlant({ plant_name: 'Biennial Test', annual: 0, biennial: 1, perennial: 0, lifespan_years: 2, days_maturity: 60, gdd_to_maturity: null });
    const rows = await hooks.explainFeasibilityOverSeason(makeInputs({ plant, city: makeCity(18), startISO: '' }));
    const text = hooks.buildFeasibilityDiagnostics(makeInputs({ plant, city: makeCity(18), startISO: '' }), rows);
    assert.equal(rows[0].date, '2026-01-01');
    assert.equal(rows[rows.length - 1].date, '2027-12-31');
    assert.match(text, /Scan range: 2026-01-01 to 2027-12-31, 730 days/);
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

test('Langley garlic uses inferred spring frost date for cooling-gate exemption', () => {
    const plant = makePlant({
        plant_name: 'Garlic',
        days_maturity: 120,
        gdd_to_maturity: null,
        tmin_c: -15,
        overwinter_ok: 1,
        start_cooling_threshold_c: 7
    });
    const city = makeLangleyColdCity({ last_spring_frost_doy: null });
    const frost = hooks.resolveSpringFrostByRisk(city, 'p50');
    assert.equal(frost.source, 'inferred_monthly_normals');
    assert.doesNotThrow(() => hooks.computeScheduleResult(makeInputs({
        plant,
        city,
        startISO: '2026-02-01',
        seasonEndISO: '2027-12-31',
        policy: new hooks.PolicyFlags({
            useSpringFrostGate: true,
            useSoilTempGate: false,
            overwinterAllowed: true
        })
    })));
    const seasons = hooks.computeAnnualSowingSeasons({
        ...makeAutoWindowParams({ plant, city, year: 2026 }),
        useSpringFrostGate: true,
        lastSpringFrostDOY: frost.doy
    }).seasons;
    assert.ok(seasons.some(window => window.startISO <= '2026-02-01' && window.endISO >= '2026-02-01'), JSON.stringify(seasons));
});

test('annual sowing seasons derive one continuous season-bound window', () => {
    const plant = makePlant({ plant_name: 'Fast Bean', days_maturity: 30, gdd_to_maturity: null });
    const result = hooks.computeAnnualSowingSeasons(makeAutoWindowParams({ plant, city: makeCity(20), year: 2026 }));
    assert.equal(result.feasible, true);
    assert.equal(result.seasons.length, 1);
    assert.equal(result.seasons[0].startISO, '2026-01-01');
    assert.match(result.seasons[0].endISO, /^2026-/);
});

test('indoor transplant sowing season shifts earlier by transplant lead time', () => {
    const plant = makePlant({ days_transplant: 21 });
    const frostParams = { useSpringFrostGate: true, lastSpringFrostDOY: 100 };
    const direct = hooks.computeAnnualSowingSeasons({
        ...makeAutoWindowParams({ plant, methodCategoryId: 'direct_sow', methodId: 'direct_sow.field' }),
        ...frostParams
    });
    const outdoor = hooks.computeAnnualSowingSeasons({
        ...makeAutoWindowParams({ plant, methodCategoryId: 'transplant', methodId: 'transplant.outdoor' }),
        ...frostParams
    });
    const indoor = hooks.computeAnnualSowingSeasons({
        ...makeAutoWindowParams({ plant, methodCategoryId: 'transplant', methodId: 'transplant.indoor' }),
        ...frostParams
    });
    assert.equal(direct.seasons[0].startISO, '2026-04-10');
    assert.equal(outdoor.seasons[0].startISO, '2026-04-10');
    assert.equal(indoor.seasons[0].startISO, '2026-03-20');
});

test('hot-climate annual derives separate early and late sowing seasons', () => {
    const plant = makePlant({
        plant_name: 'Heat Sensitive Lettuce',
        days_maturity: 25,
        gdd_to_maturity: null,
        tmin_c: 0,
        topt_low_c: 10,
        topt_high_c: 18,
        tmax_c: 24
    });
    const city = makeSeasonalCity({
        1: 10, 2: 12, 3: 15, 4: 18, 5: 23, 6: 31,
        7: 33, 8: 31, 9: 23, 10: 17, 11: 12, 12: 10
    });
    const result = hooks.computeAnnualSowingSeasons(makeAutoWindowParams({ plant, city, year: 2026 }));
    assert.equal(result.feasible, true);
    assert.ok(result.seasons.length >= 2, `expected split windows, got ${JSON.stringify(result.seasons)}`);
    assert.equal(result.seasons[0].startISO.slice(0, 4), '2026');
    assert.equal(result.seasons[result.seasons.length - 1].endISO.slice(0, 4), '2026');
});

test('overwinter annual derives spring and fall windows inside the selected season year', () => {
    const plant = makePlant({
        plant_name: 'Garlic',
        days_maturity: 240,
        gdd_to_maturity: null,
        overwinter_ok: 1,
        start_cooling_threshold_c: 12
    });
    const city = makeSeasonalCity({
        1: 2, 2: 3, 3: 8, 4: 12, 5: 18, 6: 22,
        7: 24, 8: 22, 9: 16, 10: 10, 11: 5, 12: 2
    });
    city.last_spring_frost_doy = 105;
    const result = hooks.computeAnnualSowingSeasons(makeAutoWindowParams({ plant, city, year: 2026 }));
    assert.equal(result.feasible, true);
    assert.ok(result.seasons.length >= 2, `expected spring and fall windows, got ${JSON.stringify(result.seasons)}`);
    assert.equal(result.seasons[0].startISO, '2026-01-01');
    assert.equal(result.seasons.every(window => window.startISO.startsWith('2026-') && window.endISO.startsWith('2026-')), true);
    assert.ok(result.seasons.some(window => /Fall/.test(window.label)), `expected a fall label, got ${JSON.stringify(result.seasons)}`);
});

test('overwinter spring sowing belongs to its own season year', () => {
    const plant = makePlant({ plant_name: 'Garlic', days_maturity: 240, overwinter_ok: 1, start_cooling_threshold_c: 12 });
    const city = makeSeasonalCity({ 1: 2, 2: 3, 3: 8, 4: 12, 5: 18, 6: 22, 7: 24, 8: 22, 9: 16, 10: 10, 11: 5, 12: 2 });
    city.last_spring_frost_doy = 105;
    const prior = hooks.computeAnnualSowingSeasons(makeAutoWindowParams({ plant, city, year: 2026 }));
    const next = hooks.computeAnnualSowingSeasons(makeAutoWindowParams({ plant, city, year: 2027 }));
    assert.equal(prior.seasons.some(window => window.startISO.startsWith('2027-') || window.endISO.startsWith('2027-')), false);
    assert.equal(next.seasons[0].startISO, '2027-01-01');
});

test('cool-season heat above optimum adds diagnostics without blocking by default', () => {
    const plant = makePlant({
        plant_name: 'Cool Lettuce',
        days_maturity: 20,
        topt_high_c: 18,
        tmax_c: 35,
        quality_temp_max_c: 18,
        heat_stress_stage: 'harvest_quality',
        quality_heat_policy: 'warn'
    });
    const city = makeCity(22);
    city.latitude = 45;
    const result = hooks.computeAnnualSowingSeasons(makeAutoWindowParams({ plant, city, year: 2026 }));
    assert.equal(result.feasible, true);
    assert.ok(result.seasons.some(window => /Heat warning/.test(window.riskSummary)), JSON.stringify(result.seasons));
    assert.ok(result.seasons.some(window => window.diagnostics.some(diagnostic => diagnostic.factor === 'quality_heat' && diagnostic.severity === 'warning')));
});

test('establishment heat block policy excludes otherwise feasible sow dates', () => {
    const plant = makePlant({
        plant_name: 'Heat Blocked Spinach',
        days_maturity: 20,
        tmax_c: 40,
        establishment_temp_max_c: 25,
        establishment_heat_window_days: 3,
        establishment_heat_policy: 'block'
    });
    const result = hooks.computeAnnualSowingSeasons(makeAutoWindowParams({ plant, city: makeCity(30), year: 2026 }));
    assert.equal(result.feasible, false);
    assert.equal(result.seasons.length, 0);
});

test('photoperiod diagnostics use city latitude and do not block warn-policy windows', () => {
    const plant = makePlant({
        plant_name: 'Long Day Onion',
        days_maturity: 30,
        photoperiod_response: 'long_day',
        critical_daylength_hours: 14.5,
        photoperiod_stage: 'maturity',
        photoperiod_policy: 'warn'
    });
    const city = makeCity(16);
    city.latitude = 45;
    const result = hooks.computeAnnualSowingSeasons(makeAutoWindowParams({ plant, city, year: 2026 }));
    assert.equal(result.feasible, true);
    assert.ok(result.seasons.some(window => /Photoperiod warning/.test(window.riskSummary)), JSON.stringify(result.seasons));
});

test('missing latitude skips photoperiod diagnostics without changing feasible windows', () => {
    const plant = makePlant({
        photoperiod_response: 'long_day',
        critical_daylength_hours: 14.5,
        photoperiod_stage: 'maturity',
        photoperiod_policy: 'warn'
    });
    const baseline = hooks.computeAnnualSowingSeasons(makeAutoWindowParams({ plant: makePlant(), city: makeCity(16), year: 2026 }));
    const result = hooks.computeAnnualSowingSeasons(makeAutoWindowParams({ plant, city: makeCity(16), year: 2026 }));
    assert.equal(result.seasons.length, baseline.seasons.length);
    assert.ok(result.seasons.some(window => /Photoperiod data missing/.test(window.riskSummary)), JSON.stringify(result.seasons));
    assert.ok(result.seasons.some(window => window.diagnostics.some(diagnostic => /latitude is missing/.test(diagnostic.message))), JSON.stringify(result.seasons));
});

test('chilling diagnostics report insufficient vernalization without default blocking', () => {
    const plant = makePlant({
        plant_name: 'Chill Garlic',
        days_maturity: 60,
        chilling_required_days: 20,
        chilling_temp_min_c: -2,
        chilling_temp_max_c: 5,
        chilling_stage: 'maturity',
        chilling_policy: 'warn'
    });
    const result = hooks.computeAnnualSowingSeasons(makeAutoWindowParams({ plant, city: makeCity(15), year: 2026 }));
    assert.equal(result.feasible, true);
    assert.ok(result.seasons.some(window => /Chilling warning/.test(window.riskSummary)), JSON.stringify(result.seasons));
});

test('variety physiology overrides affect diagnostics without mutating base plant', () => {
    const base = makePlant({ plant_name: 'Base Lettuce', days_maturity: 20, tmax_c: 35 });
    const variety = new hooks.PlantModel(hooks.applyPlantOverrides(base, {
        quality_temp_max_c: 18,
        heat_stress_stage: 'harvest_quality',
        quality_heat_policy: 'warn'
    }));
    const city = makeCity(22);
    const baseResult = hooks.computeAnnualSowingSeasons(makeAutoWindowParams({ plant: base, city, year: 2026 }));
    const varietyResult = hooks.computeAnnualSowingSeasons(makeAutoWindowParams({ plant: variety, city, year: 2026 }));
    assert.equal(base.quality_temp_max_c, undefined);
    assert.equal(baseResult.seasons.some(window => /Heat warning/.test(window.riskSummary)), false);
    assert.equal(varietyResult.seasons.some(window => /Heat warning/.test(window.riskSummary)), true);
});

test('spring-sown chilling does not receive pre-sowing winter credit', () => {
    const plant = makePlant({
        days_maturity: 30,
        chilling_required_days: 20,
        chilling_temp_min_c: -2,
        chilling_temp_max_c: 5,
        chilling_stage: 'maturity',
        chilling_policy: 'warn'
    });
    const city = makeSeasonalCity({ 1: 3, 2: 3, 3: 12, 4: 16, 5: 17, 6: 18, 7: 18, 8: 18, 9: 16, 10: 12, 11: 8, 12: 4 });
    const result = hooks.evaluateSowDateDiagnostics(makeInputs({ plant, city, startISO: '2026-04-01' }));
    const chilling = result.diagnostics.find(diagnostic => diagnostic.factor === 'chilling');
    assert.ok(chilling, JSON.stringify(result.diagnostics));
    assert.equal(chilling.startISO, '2026-04-01');
    assert.equal(chilling.observed, 0);
});

test('fall-sown overwinter crop accumulates chilling after sowing', () => {
    const plant = makePlant({
        overwinter_ok: 1,
        days_maturity: 80,
        chilling_required_days: 20,
        chilling_temp_min_c: -2,
        chilling_temp_max_c: 6,
        chilling_stage: 'maturity',
        chilling_policy: 'warn'
    });
    const city = makeSeasonalCity({ 1: 3, 2: 3, 3: 6, 4: 10, 5: 14, 6: 18, 7: 20, 8: 19, 9: 12, 10: 4, 11: 4, 12: 4 });
    const result = hooks.evaluateSowDateDiagnostics(makeInputs({ plant, city, startISO: '2026-10-01', seasonEndISO: '2026-12-31' }));
    assert.equal(result.diagnostics.some(diagnostic => diagnostic.factor === 'chilling'), false, JSON.stringify(result.diagnostics));
});

test('chilling required hours use daily-equivalent accumulation', () => {
    const plant = makePlant({
        days_maturity: 3,
        chilling_required_hours: 96,
        chilling_temp_min_c: -2,
        chilling_temp_max_c: 6,
        chilling_stage: 'maturity',
        chilling_policy: 'warn'
    });
    const result = hooks.evaluateSowDateDiagnostics(makeInputs({ plant, city: makeCity(4), startISO: '2026-01-01' }));
    const chilling = result.diagnostics.find(diagnostic => diagnostic.factor === 'chilling');
    assert.ok(chilling, JSON.stringify(result.diagnostics));
    assert.equal(chilling.threshold, 4);
    assert.equal(chilling.observed, 3);
});

test('smoothed diagnostic block gap remains blocked for the exact selected date', () => {
    const plant = makePlant({
        days_maturity: 1,
        establishment_temp_max_c: 25,
        establishment_heat_window_days: 1,
        establishment_heat_policy: 'block'
    });
    const overrides = {
        '2026-03-15': 30,
        '2026-03-16': 30,
        '2026-03-17': 30
    };
    const dailyClimate = makeDailyClimate(2026, 20, overrides);
    const windows = hooks.computeAnnualSowingSeasons(makeAutoWindowParams({ plant, city: makeCity(20), year: 2026, dailyClimate })).seasons;
    assert.equal(windows.length, 1, JSON.stringify(windows));
    assert.equal(windows[0].startISO, '2026-01-01');
    assert.ok(windows[0].endISO > '2026-03-17', JSON.stringify(windows));
    assert.match(windows[0].riskSummary, /Establishment heat block \(3 dates\)/);
    const inputs = makeInputs({ plant, city: makeCity(20), startISO: '2026-03-15', dailyClimate });
    const exact = hooks.evaluateSowDateDiagnostics(inputs);
    assert.ok(exact.blockingDiagnostics.some(diagnostic => diagnostic.factor === 'establishment_heat'), JSON.stringify(exact));
    assert.throws(() => hooks.requireNoBlockingScheduleQualityDiagnostics(inputs), /Establishment heat block/);
});

test('photoperiod block excludes dates when latitude is present and daylength fails', () => {
    const plant = makePlant({
        photoperiod_response: 'long_day',
        critical_daylength_hours: 14.5,
        photoperiod_stage: 'maturity',
        photoperiod_policy: 'block'
    });
    const city = makeCity(16);
    city.latitude = 45;
    const exact = hooks.evaluateSowDateDiagnostics(makeInputs({ plant, city, startISO: '2026-01-01' }));
    assert.ok(exact.blockingDiagnostics.some(diagnostic => diagnostic.factor === 'photoperiod'), JSON.stringify(exact));
    const result = hooks.computeAnnualSowingSeasons(makeAutoWindowParams({ plant, city, year: 2026 }));
    assert.equal(result.seasons.some(window => window.startISO === '2026-01-01'), false, JSON.stringify(result.seasons));
});

test('missing latitude does not block photoperiod block policy and shows data badge', () => {
    const plant = makePlant({
        photoperiod_response: 'long_day',
        critical_daylength_hours: 14.5,
        photoperiod_stage: 'maturity',
        photoperiod_policy: 'block'
    });
    const city = makeCity(16);
    const exact = hooks.evaluateSowDateDiagnostics(makeInputs({ plant, city, startISO: '2026-01-01' }));
    assert.equal(exact.blockingDiagnostics.length, 0, JSON.stringify(exact));
    const result = hooks.computeAnnualSowingSeasons(makeAutoWindowParams({ plant, city, year: 2026 }));
    assert.equal(result.feasible, true);
    assert.ok(result.seasons.some(window => /Photoperiod data missing/.test(window.riskSummary)), JSON.stringify(result.seasons));
});

test('unsupported stored latitude does not silently clamp or block photoperiod policy', () => {
    const plant = makePlant({
        photoperiod_response: 'long_day',
        critical_daylength_hours: 14.5,
        photoperiod_stage: 'maturity',
        photoperiod_policy: 'block'
    });
    const city = makeCity(16);
    city.latitude = 70;
    const exact = hooks.evaluateSowDateDiagnostics(makeInputs({ plant, city, startISO: '2026-01-01' }));
    assert.equal(exact.blockingDiagnostics.length, 0, JSON.stringify(exact));
    assert.ok(exact.diagnostics.some(diagnostic => diagnostic.factor === 'photoperiod' && diagnostic.severity === 'info' && /supported -66\.5 to 66\.5/.test(diagnostic.message)), JSON.stringify(exact));
    const result = hooks.computeAnnualSowingSeasons(makeAutoWindowParams({ plant, city, year: 2026 }));
    assert.equal(result.feasible, true);
    assert.ok(result.seasons.some(window => /Photoperiod data missing/.test(window.riskSummary)), JSON.stringify(result.seasons));
});

test('diagnostic ranges format the same human risk labels as selector summaries', () => {
    const plant = makePlant({
        days_maturity: 20,
        quality_temp_max_c: 18,
        heat_stress_stage: 'harvest_quality',
        quality_heat_policy: 'warn'
    });
    const city = makeCity(22);
    const params = makeAutoWindowParams({ plant, city, year: 2026 });
    const windows = hooks.computeAnnualSowingSeasons(params).seasons;
    const ranges = hooks.computeScheduleQualityDiagnosticRanges(params);
    const selector = hooks.buildSowingSeasonSelectorState({ sowingSeasons: windows, activeSowingSeasonId: windows[0]?.id || '', startISO: windows[0]?.startISO || '' });
    const text = hooks.formatScheduleQualityDiagnosticRanges(ranges);
    assert.ok(selector.options.some(option => /Heat warning \(\d+ dates?\)/.test(option.label)), JSON.stringify(selector));
    assert.match(text, /Heat warning/);
});

test('city latitude validation accepts clearing and rejects out-of-range values', () => {
    assert.equal(hooks.normalizeLatitudeDeg(''), null);
    assert.equal(hooks.normalizeLatitudeDeg('45.5'), 45.5);
    assert.equal(hooks.normalizeLatitudeDeg('66.5'), 66.5);
    assert.equal(hooks.normalizeLatitudeDeg('-66.5'), -66.5);
    assert.throws(() => hooks.normalizeLatitudeDeg('66.6'), /between -66\.5 and 66\.5/);
    assert.throws(() => hooks.normalizeLatitudeDeg('-66.6'), /between -66\.5 and 66\.5/);
});

test('city latitude update persists to Cities.latitude', async () => {
    const testWindow = hooks.__testWindow;
    const previousBridge = testWindow.dbBridge;
    const updates = [];
    let changes = 0;
    testWindow.dbBridge = {
        async resolvePath() { return { dbPath: 'mock.sqlite' }; },
        async open() { return { dbId: 'mock-db' }; },
        async close() {},
        async query(_dbId, sql) {
            if (/PRAGMA table_info/i.test(sql)) return { rows: [] };
            if (/SELECT changes\(\)/i.test(sql)) return { rows: [{ changes }] };
            return { rows: [] };
        },
        async exec(_dbId, sql, params) {
            if (/UPDATE Cities SET latitude/i.test(sql)) {
                updates.push(params);
                changes = params[1] === 'Test City' ? 1 : 0;
            }
            return {};
        }
    };
    try {
        const saved = await hooks.CityClimate.updateLatitude('Test City', '49.25');
        assert.equal(saved, 49.25);
        assert.deepEqual(Array.from(updates.at(-1)), [49.25, 'Test City']);
        const cleared = await hooks.CityClimate.updateLatitude('Test City', '');
        assert.equal(cleared, null);
        assert.deepEqual(Array.from(updates.at(-1)), [null, 'Test City']);
        const beforeInvalid = updates.length;
        await assert.rejects(() => hooks.CityClimate.updateLatitude('Test City', '70'), /between -66\.5 and 66\.5/);
        assert.equal(updates.length, beforeInvalid);
    } finally {
        testWindow.dbBridge = previousBridge;
    }
});

test('city latitude save helper persists cache and refreshes annual scheduling state', async () => {
    const testWindow = hooks.__testWindow;
    const previousBridge = testWindow.dbBridge;
    const updates = [];
    let changes = 0;
    testWindow.dbBridge = {
        async resolvePath() { return { dbPath: 'mock.sqlite' }; },
        async open() { return { dbId: 'mock-db' }; },
        async close() {},
        async query(_dbId, sql) {
            if (/PRAGMA table_info/i.test(sql)) return { rows: [] };
            if (/SELECT changes\(\)/i.test(sql)) return { rows: [{ changes }] };
            return { rows: [] };
        },
        async exec(_dbId, sql, params) {
            if (/UPDATE Cities SET latitude/i.test(sql)) {
                updates.push(params);
                changes = params[1] === 'Test City' ? 1 : 0;
            }
            return {};
        }
    };
    const cities = [{ city_name: 'Test City', latitude: null }];
    const recomputeReasons = [];
    let previewRefreshes = 0;
    try {
        const saved = await hooks.saveSchedulerCityLatitude({
            cityName: 'Test City',
            latitudeValue: '49.25',
            cities,
            recomputeAll: async reason => { recomputeReasons.push(reason); },
            updateTaskPreview: async () => { previewRefreshes += 1; }
        });
        assert.equal(saved, 49.25);
        assert.deepEqual(Array.from(updates.at(-1)), [49.25, 'Test City']);
        assert.equal(cities[0].latitude, 49.25);
        assert.deepEqual(recomputeReasons, ['cityChanged']);
        assert.equal(previewRefreshes, 1);
    } finally {
        testWindow.dbBridge = previousBridge;
    }
});

test('city climate resolver prefers city_id and falls back to city_name', async () => {
    const testWindow = hooks.__testWindow;
    const previousBridge = testWindow.dbBridge;
    const queries = [];
    testWindow.dbBridge = {
        async resolvePath() { return { dbPath: 'mock.sqlite' }; },
        async open() { return { dbId: 'mock-db' }; },
        async close() {},
        async query(_dbId, sql, params) {
            queries.push({ sql, params });
            if (/WHERE city_id = \\?/i.test(sql) && Number(params[0]) === 7) return { rows: [{ city_id: 7, city_name: 'Renamed City', latitude: 49 }] };
            if (/WHERE city_id = \\?/i.test(sql)) return { rows: [] };
            if (/WHERE city_name = \\?/i.test(sql) && params[0] === 'Fallback City') return { rows: [{ city_id: 8, city_name: 'Fallback City', latitude: 45 }] };
            return { rows: [] };
        },
        async exec() { return {}; }
    };
    try {
        const byId = await hooks.CityClimate.resolve({ cityId: 7, cityName: 'Old Cached Name' });
        assert.equal(byId.city_name, 'Renamed City');
        const byName = await hooks.CityClimate.resolve({ cityId: 999, cityName: 'Fallback City' });
        assert.equal(byName.city_id, 8);
        assert.ok(queries.some(item => /WHERE city_id = \\?/i.test(item.sql)), 'expected city_id lookup');
        assert.ok(queries.some(item => /WHERE city_name = \\?/i.test(item.sql)), 'expected name fallback lookup');
    } finally {
        testWindow.dbBridge = previousBridge;
    }
});

test('city climate unique-name fallback rejects ambiguous legacy names', async () => {
    const testWindow = hooks.__testWindow;
    const previousBridge = testWindow.dbBridge;
    testWindow.dbBridge = {
        async resolvePath() { return { dbPath: 'mock.sqlite' }; },
        async open() { return { dbId: 'mock-db' }; },
        async close() {},
        async query(_dbId, sql, params) {
            if (/WHERE city_id = \?/i.test(sql)) return { rows: [] };
            if (/WHERE city_name = \?/i.test(sql) && /LIMIT 2/i.test(sql) && params[0] === 'Duplicate City') {
                return { rows: [
                    { city_id: 10, city_name: 'Duplicate City', latitude: 40 },
                    { city_id: 11, city_name: 'Duplicate City', latitude: 41 }
                ] };
            }
            return { rows: [] };
        },
        async exec() { return {}; }
    };
    try {
        const ambiguous = await hooks.CityClimate.resolveUniqueNameFallback({ cityName: 'Duplicate City' });
        assert.equal(ambiguous, null);
    } finally {
        testWindow.dbBridge = previousBridge;
    }
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

test('schedule save patch clears legacy sowing window attributes', () => {
    const inputs = makeInputs({ startISO: '2026-04-15' });
    const result = hooks.computeScheduleResult(inputs);
    const patch = hooks.buildScheduleAttributePatch(inputs, result, { sowingSeasonId: 'spring', sowingSeasonLabel: 'Spring' });
    assert.equal(patch.sowing_season_id, 'spring');
    assert.equal(patch.sowing_season_label, 'Spring');
    assert.equal(patch.sowing_window_id, null);
    assert.equal(patch.sowing_window_label, null);
});

test('persisted start is distinct from a session edit and is not auto-overwritten', () => {
    const persisted = hooks.resolveStartAfterWindow({
        currentStartISO: '2026-05-10',
        activeWindow: { startISO: '2026-04-01' },
        feasible: true,
        forceWriteStart: false,
        hasPersistedSchedule: true,
        userEditedStartThisSession: false
    });
    assert.equal(persisted, '2026-05-10');

    const replacedForYearChange = hooks.resolveStartAfterWindow({
        currentStartISO: persisted,
        activeWindow: { startISO: '2027-04-03' },
        feasible: true,
        forceWriteStart: true,
        hasPersistedSchedule: true,
        userEditedStartThisSession: false
    });
    assert.equal(replacedForYearChange, '2027-04-03');

    const preservedWithoutWindow = hooks.resolveStartAfterWindow({
        currentStartISO: '2026-05-10',
        activeWindow: null,
        feasible: false,
        forceWriteStart: true,
        hasPersistedSchedule: true,
        userEditedStartThisSession: false
    });
    assert.equal(preservedWithoutWindow, '2026-05-10');
});

test('generated start can replace stale unscheduled date while persisted and edited dates stay fixed', () => {
    const activeWindow = { id: 'spring', label: 'Spring (Apr 1-May 1)', startISO: '2026-04-01', endISO: '2026-05-01' };
    assert.equal(hooks.resolveStartAfterWindow({
        currentStartISO: '2026-03-01',
        activeWindow,
        feasible: true,
        forceWriteStart: false,
        hasPersistedSchedule: false,
        userEditedStartThisSession: false,
        todayISO: '2026-04-15',
        generatedStartISO: '2026-04-15'
    }), '2026-04-15');
    assert.equal(hooks.resolveStartAfterWindow({
        currentStartISO: '2026-03-01',
        activeWindow,
        feasible: true,
        forceWriteStart: false,
        hasPersistedSchedule: true,
        userEditedStartThisSession: false,
        generatedStartISO: '2026-04-15'
    }), '2026-03-01');
    assert.equal(hooks.resolveStartAfterWindow({
        currentStartISO: '2026-03-02',
        activeWindow,
        feasible: true,
        forceWriteStart: false,
        hasPersistedSchedule: false,
        userEditedStartThisSession: true,
        generatedStartISO: '2026-04-15'
    }), '2026-03-02');
});

test('new annual schedule defaults sow date to today inside the active window', () => {
    const activeWindow = { id: 'spring', label: 'Spring (Apr 1-May 1)', startISO: '2026-04-01', endISO: '2026-05-01' };
    assert.equal(hooks.resolveStartAfterWindow({
        currentStartISO: '',
        activeWindow,
        feasible: true,
        forceWriteStart: false,
        hasPersistedSchedule: false,
        userEditedStartThisSession: false,
        todayISO: '2026-04-15'
    }), '2026-04-15');
    assert.equal(hooks.resolveStartAfterWindow({
        currentStartISO: '',
        activeWindow,
        feasible: true,
        forceWriteStart: false,
        hasPersistedSchedule: false,
        userEditedStartThisSession: false,
        todayISO: '2026-08-15'
    }), '2026-04-01');
});

test('new annual schedule startup preview uses today only inside the active sowing season', () => {
    const spring = { id: 'spring', label: 'Spring (Apr 1-May 1)', startISO: '2026-04-01', endISO: '2026-05-01' };
    const fall = { id: 'fall', label: 'Fall (Sep 1-Oct 1)', startISO: '2026-09-01', endISO: '2026-10-01' };
    const earliest = new Date(Date.UTC(2026, 3, 1));
    const persisted = new Date(Date.UTC(2026, 4, 10));
    assert.equal(hooks.resolveInitialPreviewStartForScheduleDialog({
        earliestFeasibleSowDate: earliest,
        initialWindowFeasible: true,
        sowingSeasons: [spring, fall],
        todayISO: '2026-04-15'
    }).toISOString().slice(0, 10), '2026-04-15');
    assert.equal(hooks.resolveInitialPreviewStartForScheduleDialog({
        earliestFeasibleSowDate: earliest,
        initialWindowFeasible: true,
        sowingSeasons: [spring, fall],
        todayISO: '2026-08-15'
    }).toISOString().slice(0, 10), '2026-09-01');
    assert.equal(hooks.resolveInitialPreviewStartForScheduleDialog({
        earliestFeasibleSowDate: earliest,
        initialWindowFeasible: true,
        sowingSeasons: [spring, fall],
        todayISO: '2026-11-15'
    }).toISOString().slice(0, 10), '2026-04-01');
    assert.equal(hooks.resolveInitialPreviewStartForScheduleDialog({
        storedSowDate: persisted,
        earliestFeasibleSowDate: earliest,
        initialWindowFeasible: true,
        sowingSeasons: [spring, fall],
        todayISO: '2026-04-15'
    }).toISOString().slice(0, 10), '2026-05-10');
    assert.equal(hooks.resolveInitialPreviewStartForScheduleDialog({
        earliestFeasibleSowDate: null,
        initialWindowFeasible: false,
        sowingSeasons: [],
        todayISO: '2026-07-19'
    }).toISOString().slice(0, 10), '2026-07-19');
});

test('new transplant schedule startup preview defaults from projected visible windows', () => {
    const spring = { id: 'spring', label: 'Spring (Apr 1-May 1)', startISO: '2026-04-01', endISO: '2026-05-01' };
    const fall = { id: 'fall', label: 'Fall (Sep 1-Oct 1)', startISO: '2026-09-01', endISO: '2026-10-01' };
    const earliest = new Date(Date.UTC(2026, 3, 1));
    const methodId = 'transplant.indoor';
    const effectiveTransplantDays = 21;
    const previewISO = todayISO => hooks.resolveInitialPreviewStartForScheduleDialog({
        earliestFeasibleSowDate: earliest,
        initialWindowFeasible: true,
        sowingSeasons: [spring, fall],
        todayISO,
        methodId,
        effectiveTransplantDays
    }).toISOString().slice(0, 10);
    const visibleISO = sowISO => hooks.primaryDateFromSowDate(sowISO, methodId, effectiveTransplantDays);

    assert.equal(previewISO('2026-04-30'), '2026-04-09');
    assert.equal(visibleISO(previewISO('2026-04-30')), '2026-04-30');
    assert.equal(previewISO('2026-08-15'), '2026-09-01');
    assert.equal(visibleISO(previewISO('2026-08-15')), '2026-09-22');
    assert.equal(previewISO('2026-11-15'), '2026-04-01');
    assert.equal(visibleISO(previewISO('2026-11-15')), '2026-04-22');
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

test('combined method selection round-trips delimiter-like identifiers', () => {
    const encoded = hooks.encodeMethodSelection(' Direct|Sow ', ' Direct|Sow.Field::One ');
    const decoded = hooks.decodeMethodSelection(encoded);
    assert.equal(decoded.methodCategoryId, 'direct|sow');
    assert.equal(decoded.methodId, 'direct|sow.field::one');
    assert.equal(hooks.decodeMethodSelection('not-json'), null);
});

test('feasibility helpers classify schedule dates and humanize planner reasons', () => {
    const windows = [{ id: 'spring', label: 'Spring (Apr 1-May 1)', startISO: '2026-04-01', endISO: '2026-05-01' }];
    const fallWindows = windows.concat([{ id: 'fall', label: 'Fall (Sep 1-Oct 1)', startISO: '2026-09-01', endISO: '2026-10-01' }]);
    assert.equal(hooks.humanFeasibilityReason('insufficient_gdd'), 'There is not enough growing-degree accumulation to reach maturity.');
    assert.equal(hooks.humanFeasibilityReason('insufficient_gdd_before_cold(gdd 10.0<20.0 deadline 2026-11-01)'), 'There is not enough heat for this crop to mature before lethal cold.');
    assert.equal(hooks.classifySelectedSowDate({ perennial: true }).status, 'not_applicable');
    assert.equal(hooks.classifySelectedSowDate({ windowFeasible: false }).status, 'no_window');
    assert.equal(hooks.classifySelectedSowDate({ windowFeasible: true, sowingSeasons: windows, activeSowingSeasonId: 'spring' }).status, 'missing');
    assert.equal(hooks.classifySelectedSowDate({
        windowFeasible: true,
        startISO: '2026-03-01',
        sowingSeasons: windows,
        activeSowingSeasonId: 'spring'
    }).status, 'outside_window');
    assert.equal(hooks.classifySelectedSowDate({
        windowFeasible: true,
        startISO: '2026-09-15',
        sowingSeasons: fallWindows,
        activeSowingSeasonId: 'spring'
    }).status, 'window_mismatch');
    assert.equal(hooks.classifySelectedSowDate({
        windowFeasible: true,
        startISO: '2026-04-15',
        sowingSeasons: windows,
        activeSowingSeasonId: 'spring'
    }).status, 'feasible');
    assert.equal(hooks.pickDefaultSowingSeasonId(fallWindows, { savedStartISO: '2026-09-15', todayISO: '2026-01-01' }), 'fall');
    assert.equal(hooks.findSowingSeasonForDate(fallWindows, '2026-04-15').id, 'spring');
});

test('orphan saved sow date is visible as guidance without blocking validation', () => {
    const windows = [{ id: 'spring', label: 'Spring (Apr 1-May 1)', startISO: '2026-04-01', endISO: '2026-05-01' }];
    const selector = hooks.buildSowingSeasonSelectorState({
        sowingSeasons: windows,
        activeSowingSeasonId: hooks.ORPHAN_SOWING_SEASON_ID,
        startISO: '2026-06-15'
    });
    assert.equal(selector.value, hooks.ORPHAN_SOWING_SEASON_ID);
    assert.equal(selector.options[0].label, 'Saved date outside seasons (2026-06-15)');
    assert.equal(selector.options[0].disabled, true);
    assert.equal(selector.boundsText, '');
    assert.equal(hooks.classifySelectedSowDate({
        windowFeasible: true,
        startISO: '2026-06-15',
        sowingSeasons: windows,
        activeSowingSeasonId: hooks.ORPHAN_SOWING_SEASON_ID
    }).status, 'outside_window');
    assert.equal(hooks.requireFeasibleSowingSeasonSelection({
        windowFeasible: true,
        startISO: '2026-06-15',
        sowingSeasons: windows,
        activeSowingSeasonId: hooks.ORPHAN_SOWING_SEASON_ID
    }).status, 'outside_window');
});

test('switching sowing seasons preserves an in-window sow date and otherwise defaults to the selected window start', () => {
    const windows = [
        { id: 'spring', label: 'Spring (Apr 1-May 1)', startISO: '2026-04-01', endISO: '2026-05-01' },
        { id: 'fall', label: 'Fall (Sep 1-Oct 1)', startISO: '2026-09-01', endISO: '2026-10-01' }
    ];
    assert.equal(hooks.resolveStartForSowingSeasonSwitch(windows, 'fall', '2026-09-15'), '2026-09-15');
    assert.equal(hooks.resolveStartForSowingSeasonSwitch(windows, 'fall', '2026-04-15'), '2026-09-01');
    assert.equal(hooks.resolveStartForSowingSeasonSwitch(windows, hooks.ORPHAN_SOWING_SEASON_ID), '');
});

test('sowing season change refreshes derived UI after harvest recomputation', () => {
    const source = fs.readFileSync(schedulerPath, 'utf8');
    const handlerStart = source.indexOf("sowingSeasonSel.addEventListener('change'");
    const handlerEnd = source.indexOf("seasonYearInput.addEventListener", handlerStart);
    assert.ok(handlerStart >= 0 && handlerEnd > handlerStart, 'expected to find sowing season change handler');
    const handlerBody = source.slice(handlerStart, handlerEnd);
    const harvestIndex = handlerBody.indexOf('await recomputeLastHarvestFromSchedule()');
    const refreshIndex = handlerBody.indexOf('await refreshTasksTabUI()');
    assert.doesNotMatch(handlerBody, /syncSeasonStartYearFromPrimaryDate/, 'season selection should not mutate the selected year from the visible date');
    assert.match(handlerBody, /clampPrimaryDateToSelectedYear\(\);[\s\S]*formState\.startISO = internalSowDateISO\(startInput\.value\)/, 'season selection should clamp the visible date to the selected year');
    assert.ok(harvestIndex >= 0, 'season change should recompute harvest before refreshing dependent UI');
    assert.ok(refreshIndex > harvestIndex, 'task/timeline refresh should run after harvest recomputation');
    assert.equal(handlerBody.includes('await updateTaskPreview()'), false, 'season change should use shared task/timeline refresh orchestration');
    assert.equal(handlerBody.includes('updateTimeline()'), false, 'season change should not render timeline before latestScheduleResult is refreshed');
    assert.match(handlerBody, /userEditedStartThisSession\s*=\s*false/, 'season selection should remain a generated schedule anchor');
    assert.match(handlerBody, /generatedStartThisSession\s*=\s*!hasPersistedSchedule && !mode\.perennial && !!formState\.startISO/, 'season selection should keep unscheduled annual dates replaceable on plant change');
});

test('derived sowing season summary matches selector labels', () => {
    const windows = [
        { id: 'spring', label: 'Spring (Apr 1-May 1)', startISO: '2026-04-01', endISO: '2026-05-01' },
        { id: 'fall', label: 'Fall (Sep 1-Oct 1)', startISO: '2026-09-01', endISO: '2026-10-01' }
    ];
    const selectorLabels = hooks.buildSowingSeasonSelectorState({
        sowingSeasons: windows,
        activeSowingSeasonId: 'spring',
        startISO: '2026-04-15'
    }).options.map(option => option.label);
    const summary = hooks.formatSowingSeasonsSummary(windows);
    assert.equal(JSON.stringify(selectorLabels), JSON.stringify(windows.map(window => window.label)));
    selectorLabels.forEach(label => assert.match(summary, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))));
});

test('schedule summary state uses perennial and annual harvest semantics', () => {
    const annual = hooks.buildScheduleViewState({
        plantName: 'Tomato',
        varietyName: 'Roma',
        cityName: 'Test City',
        seasonStartYear: 2026,
        methodName: 'Field direct sow',
        windowFeasible: true,
        startISO: '2026-04-01',
        sowingSeasons: [{ id: 'spring', label: 'Spring (Mar 20-May 1)', startISO: '2026-03-20', endISO: '2026-05-01' }],
        activeSowingSeasonId: 'spring',
        firstHarvestISO: '2026-05-01',
        lastHarvestISO: '2026-05-08'
    });
    assert.equal(annual.crop, 'Tomato / Roma');
    assert.equal(annual.context, 'Test City / 2026');
    assert.equal(annual.feasibility.status, 'feasible');
    assert.equal(Object.prototype.hasOwnProperty.call(annual, 'harvestEnd'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(annual, 'firstHarvest'), false);

    const perennial = hooks.buildScheduleViewState({ perennial: true, plantName: 'Asparagus' });
    assert.equal(perennial.feasibility.status, 'not_applicable');
    assert.equal(Object.prototype.hasOwnProperty.call(perennial, 'firstHarvest'), false);
});

test('schedule summary state renders thermal warnings as warning status', () => {
    const annual = hooks.buildScheduleViewState({
        plantName: 'Tomato',
        cityName: 'Test City',
        seasonStartYear: 2026,
        methodName: 'Field direct sow',
        windowFeasible: false,
        startISO: '2026-06-15',
        scheduleWarnings: [{ type: 'harvest_too_hot', message: 'Expected harvest temperature is above the crop maximum.' }]
    });
    assert.equal(annual.feasibility.status, 'warning');
    assert.match(annual.feasibility.label, /above the crop maximum/);
});

test('task rule normalization defaults repeat cutoff fields', () => {
    const rule = hooks.normalizeTaskRule({ title: 'Water', repeat: true });
    assert.equal(rule.repeatMode, 'interval');
    assert.equal(rule.repeatUntilMode, 'x_times');
    assert.equal(rule.repeatUntilAnchorStage, 'HARVEST_END');
    assert.equal(rule.repeatCutoffOffsetDays, 0);
    assert.equal(rule.repeatCutoffOffsetDirection, 'after');
});

test('task template resolution uses cell, variety, plant, method, none precedence', async () => {
    const model = hooks.TaskTemplateModel;
    const originalVariety = model.loadVarietyTemplate;
    const originalPlant = model.loadPlantTemplate;
    const originalMethod = model.loadMethodBuiltinTemplate;
    const cellTemplate = { version: 2, rules: [{ id: 'cell' }] };
    const varietyTemplate = { version: 2, rules: [{ id: 'variety' }] };
    const plantTemplate = { version: 2, rules: [{ id: 'plant' }] };
    const methodTemplate = { version: 2, rules: [{ id: 'method' }] };
    const emptyCell = { getAttribute: () => '' };
    try {
        model.loadVarietyTemplate = async () => { throw new Error('variety should not load for cell templates'); };
        model.loadPlantTemplate = async () => { throw new Error('plant should not load for cell templates'); };
        model.loadMethodBuiltinTemplate = async () => { throw new Error('method should not load for cell templates'); };
        let resolved = await hooks.resolveTaskTemplate({
            cell: { getAttribute: key => key === 'task_template_json' ? JSON.stringify(cellTemplate) : '' },
            plantId: 1,
            varietyId: 10,
            methodId: 'direct_sow.field'
        });
        assert.equal(resolved.source, 'cell');
        assert.equal(JSON.stringify(resolved.template), JSON.stringify(cellTemplate));

        model.loadVarietyTemplate = async () => varietyTemplate;
        model.loadPlantTemplate = async () => plantTemplate;
        model.loadMethodBuiltinTemplate = async () => methodTemplate;
        resolved = await hooks.resolveTaskTemplate({ cell: emptyCell, plantId: 1, varietyId: 10, methodId: 'direct_sow.field' });
        assert.equal(resolved.source, 'variety');
        assert.equal(JSON.stringify(resolved.template), JSON.stringify(varietyTemplate));

        model.loadVarietyTemplate = async () => null;
        model.loadPlantTemplate = async () => plantTemplate;
        model.loadMethodBuiltinTemplate = async () => methodTemplate;
        resolved = await hooks.resolveTaskTemplate({ cell: emptyCell, plantId: 1, varietyId: 10, methodId: 'direct_sow.field' });
        assert.equal(resolved.source, 'plant');
        assert.equal(JSON.stringify(resolved.template), JSON.stringify(plantTemplate));

        model.loadVarietyTemplate = async () => null;
        model.loadPlantTemplate = async () => null;
        model.loadMethodBuiltinTemplate = async () => methodTemplate;
        resolved = await hooks.resolveTaskTemplate({ cell: emptyCell, plantId: 1, varietyId: 10, methodId: 'direct_sow.field' });
        assert.equal(resolved.source, 'method_builtin');
        assert.equal(JSON.stringify(resolved.template), JSON.stringify(methodTemplate));

        model.loadMethodBuiltinTemplate = async () => null;
        resolved = await hooks.resolveTaskTemplate({ cell: emptyCell, plantId: 1, varietyId: 10, methodId: 'direct_sow.field' });
        assert.equal(resolved.source, 'none');
        assert.equal(resolved.template, null);
    } finally {
        model.loadVarietyTemplate = originalVariety;
        model.loadPlantTemplate = originalPlant;
        model.loadMethodBuiltinTemplate = originalMethod;
    }
});

test('purchased transplant built-in template backfills hardening off before transplant', async () => {
    const testWindow = hooks.__testWindow;
    const previousBridge = testWindow.dbBridge;
    const purchasedMethod = {
        method_id: 'transplant.purchased',
        method_category_id: 'transplant',
        method_name: 'Purchased transplant',
        tasks_required_json: JSON.stringify({
            prep: { offsetDays: 3, offsetDirection: 'before' },
            transplant: { offsetDays: 0 },
            harvest: true
        })
    };
    testWindow.dbBridge = {
        async resolvePath() { return { dbPath: 'mock.sqlite' }; },
        async open() { return { dbId: 'mock-db' }; },
        async close() {},
        async query(_dbId, sql, params) {
            if (/FROM PlantingMethods/i.test(sql) && params[0] === 'transplant.purchased') return { rows: [purchasedMethod] };
            return { rows: [] };
        }
    };
    try {
        const template = await hooks.TaskTemplateModel.loadMethodBuiltinTemplate('transplant.purchased');
        assert.deepEqual(Array.from(template.rules, rule => rule.id), ['prep', 'harden', 'transplant', 'harvest']);

        const plant = makePlant({ plant_name: 'Tomato', days_transplant: 3 });
        const result = hooks.computeScheduleResult(makeInputs({
            plant,
            planningMode: 'transplant_outdoor',
            methodCategoryId: 'transplant',
            methodId: 'transplant.purchased',
            startISO: '2026-04-10'
        }));
        const tasks = await hooks.buildTasksForPlan({
            plant,
            schedule: result.schedule,
            timelines: result.timelines,
            methodCategoryId: 'transplant',
            methodId: 'transplant.purchased',
            taskTemplate: template
        });
        const harden = tasks.find(task => task.rule_id === 'harden');
        assert.equal(harden.task_type_id, 'hardening_off');
        assert.equal(harden.scheduler_anchor_stage, 'TRANSPLANT');
        assert.equal(harden.startISO, '2026-04-03');
        assert.equal(harden.endISO, '2026-04-10');
        assert.equal(result.rows[0].sow, '2026-04-10');
        assert.equal(result.rows[0].trans, '2026-04-10');
    } finally {
        testWindow.dbBridge = previousBridge;
    }
});

test('task rule task type metadata is custom-only and canonical mappings are generated', () => {
    const custom = hooks.normalizeTaskRule({ id: 'water_weekly', title: 'Water', taskTypeId: 'Watering' });
    assert.equal(custom.taskTypeId, 'watering');
    const canonical = hooks.normalizeTaskRule({ id: 'sow', title: 'Sow', taskTypeId: 'watering' });
    assert.equal(Object.hasOwn(canonical, 'taskTypeId'), false);
    assert.equal(hooks.resolveTaskRuleTaskTypeId({ id: 'prep', title: 'Prep' }), 'bed_preparation');
    assert.equal(hooks.resolveTaskRuleTaskTypeId({ id: 'start', title: 'Start' }), 'seedling_starting');
    assert.equal(hooks.resolveTaskRuleTaskTypeId({ id: 'harden', title: 'Harden' }), 'hardening_off');
    assert.equal(hooks.resolveTaskRuleTaskTypeId({ id: 'thin', title: 'Thin' }), 'thinning_check');
    assert.equal(hooks.resolveTaskRuleTaskTypeId({ id: 'custom', title: 'Custom' }), 'general');
});

test('custom task type validation is opt-in for editor saves', () => {
    assert.doesNotThrow(() => hooks.validateTaskRule({ id: 'custom', title: 'Custom', startAnchorStage: 'SOW' }));
    assert.throws(
        () => hooks.validateTaskRule({ id: 'custom', title: 'Custom', startAnchorStage: 'SOW' }, { requireTaskType: true }),
        /Task type is required/
    );
    assert.doesNotThrow(() => hooks.validateTaskRule({ id: 'custom', title: 'Custom', startAnchorStage: 'SOW', taskTypeId: 'watering' }, { requireTaskType: true }));
});

test('task rule validation requires valid repeat cutoff configuration', () => {
    const allowedStages = ['SOW', 'GERM', 'TRANSPLANT', 'HARVEST_START', 'HARVEST_END'];
    assert.throws(() => hooks.validateTaskRule(makeRepeatRule({ repeatEveryDays: 0 }), { allowedStages }), /Repeat every days/);
    assert.throws(() => hooks.validateTaskRule(makeRepeatRule({ repeatUntilMode: 'forever' }), { allowedStages }), /Invalid repeat-until mode/);
    assert.throws(() => hooks.validateTaskRule(makeRepeatRule({ repeatUntilAnchorStage: 'BAD_STAGE' }), { allowedStages }), /Cutoff anchor is not available/);
    assert.throws(() => hooks.validateTaskRule(makeRepeatRule({ repeatCutoffOffsetDays: -1 }), { allowedStages }), /Cutoff offset/);
    assert.throws(() => hooks.validateTaskRule(makeRepeatRule({ repeatTimes: 0 }), { allowedStages }), /Repeat times/);
    assert.doesNotThrow(() => hooks.validateTaskRule(makeRepeatRule({ repeatUntilMode: 'until_anchor', repeatTimes: 0 }), { allowedStages }));
});

test('task rule anchor order rejects starts after end or cutoff anchors', async () => {
    const plant = makePlant();
    const result = hooks.computeScheduleResult(makeInputs({ plant }));
    const startAfterEnd = {
        ...makeRepeatRule({ repeatMode: 'none' }),
        startAnchorStage: 'HARVEST_END',
        endMode: 'anchor_range',
        endAnchorStage: 'HARVEST_START'
    };
    const startAfterCutoff = makeRepeatRule({
        startAnchorStage: 'HARVEST_END',
        repeatUntilAnchorStage: 'HARVEST_START'
    });

    assert.throws(() => hooks.validateTaskRuleAnchorOrder(startAfterEnd, { schedule: result.schedule, timelines: result.timelines }), /Start must be on or before the end anchor/);
    await assert.rejects(() => hooks.buildTasksForPlan({
        plant,
        schedule: result.schedule,
        timelines: result.timelines,
        taskTemplate: { version: 2, rules: [startAfterCutoff] }
    }), /Start must be on or before the cutoff anchor/);
});

test('task editor placement and visibility rules stay wired', () => {
    const source = fs.readFileSync(schedulerPath, 'utf8');
    assert.match(source, /const editBtn = mxUtils\.button\("Edit",\s*\(\) => openTaskEditor\(rule,\s*originalIndex,\s*wrap\)\)/);
    assert.match(source, /function placeTaskEditorAfter\(anchorEl\)[\s\S]*anchorEl\.parentNode\.insertBefore\(taskEditorDiv,\s*anchorEl\.nextSibling\)/);
    assert.match(source, /function setTaskEditorRowVisible\(rowEl,\s*visible\)[\s\S]*rowEl\.style\.setProperty\("display",\s*visible \? "flex" : "none",\s*"important"\)/);
    assert.match(source, /setTaskEditorRowVisible\(durationRow,\s*endMode === "fixed_days"\)/);
    assert.match(source, /setTaskEditorRowVisible\(repeatTimesRow,\s*repeating && untilMode === "x_times"\)/);
});

test('x-times repeat generation is capped by the exclusive cutoff anchor', async () => {
    const plant = makePlant();
    const result = hooks.computeScheduleResult(makeInputs({ plant }));
    const tasks = await hooks.buildTasksForPlan({
        plant,
        schedule: result.schedule,
        timelines: result.timelines,
        taskTemplate: { version: 2, rules: [makeRepeatRule({ repeatEveryDays: 3, repeatTimes: 10, repeatUntilAnchorStage: 'SOW', repeatCutoffOffsetDays: 10 })] }
    });
    assert.deepEqual(Array.from(tasks, task => task.startISO), ['2026-04-01', '2026-04-04', '2026-04-07', '2026-04-10']);
});

test('until-anchor repeat generation uses the exclusive cutoff anchor', async () => {
    const plant = makePlant();
    const result = hooks.computeScheduleResult(makeInputs({ plant }));
    const tasks = await hooks.buildTasksForPlan({
        plant,
        schedule: result.schedule,
        timelines: result.timelines,
        taskTemplate: { version: 2, rules: [makeRepeatRule({ repeatEveryDays: 10, repeatUntilMode: 'until_anchor', repeatUntilAnchorStage: 'HARVEST_START' })] }
    });
    assert.deepEqual(Array.from(tasks, task => task.startISO), ['2026-04-01', '2026-04-11', '2026-04-21']);
});

test('repeat cutoff offset shifts the exclusive cap before and after the anchor', async () => {
    const plant = makePlant();
    const result = hooks.computeScheduleResult(makeInputs({ plant }));
    const beforeTasks = await hooks.buildTasksForPlan({
        plant,
        schedule: result.schedule,
        timelines: result.timelines,
        taskTemplate: { version: 2, rules: [makeRepeatRule({ repeatEveryDays: 10, repeatTimes: 10, repeatUntilAnchorStage: 'HARVEST_START', repeatCutoffOffsetDays: 7, repeatCutoffOffsetDirection: 'before' })] }
    });
    const afterTasks = await hooks.buildTasksForPlan({
        plant,
        schedule: result.schedule,
        timelines: result.timelines,
        taskTemplate: { version: 2, rules: [makeRepeatRule({ repeatEveryDays: 10, repeatTimes: 10, repeatUntilAnchorStage: 'HARVEST_START', repeatCutoffOffsetDays: 7, repeatCutoffOffsetDirection: 'after' })] }
    });
    assert.deepEqual(Array.from(beforeTasks, task => task.startISO), ['2026-04-01', '2026-04-11', '2026-04-21']);
    assert.deepEqual(Array.from(afterTasks, task => task.startISO), ['2026-04-01', '2026-04-11', '2026-04-21', '2026-05-01']);
});

test('repeat cutoff can omit all occurrences and is preview-warning eligible', async () => {
    const plant = makePlant();
    const result = hooks.computeScheduleResult(makeInputs({ plant }));
    const template = { version: 2, rules: [makeRepeatRule({ repeatUntilAnchorStage: 'SOW' })] };
    const tasks = await hooks.buildTasksForPlan({
        plant,
        schedule: result.schedule,
        timelines: result.timelines,
        taskTemplate: template,
        includePreviewMetadata: true
    });
    const omitted = hooks.findRepeatCutoffOmittedRuleKeys({ taskTemplate: template, schedule: result.schedule, timelines: result.timelines });
    assert.equal(tasks.length, 0);
    assert.equal(omitted.has('water::0'), true);
});

test('task rule descriptions include repeat cutoff wording', () => {
    assert.match(hooks.describeTaskRule(makeRepeatRule({ repeatEveryDays: 7, repeatTimes: 5 })), /repeat every 7 days, up to 5 times, until Harvest end/);
    assert.match(hooks.describeTaskRule(makeRepeatRule({ repeatEveryDays: 7, repeatUntilMode: 'until_anchor' })), /repeat every 7 days until Harvest end/);
    assert.match(hooks.describeTaskRule(makeRepeatRule({ repeatCutoffOffsetDays: 7, repeatCutoffOffsetDirection: 'before' })), /until 7 days before Harvest end/);
});

test('task preview and save share generated dates before display filtering', async () => {
    const plant = makePlant({ plant_name: 'Carrot' });
    const result = hooks.computeScheduleResult(makeInputs({ plant }));
    const template = {
        version: 2,
        rules: [{
            id: 'water',
            title: 'Water {plant}',
            startAnchorStage: 'SOW',
            startOffsetDays: 0,
            startOffsetDirection: 'after',
            endMode: 'fixed_days',
            durationDays: 1,
            repeatMode: 'interval',
            repeatEveryDays: 3,
            repeatUntilMode: 'x_times',
            repeatTimes: 3
        }]
    };
    const savedTasks = await hooks.buildTasksForPlan({
        plant,
        schedule: result.schedule,
        timelines: result.timelines,
        taskTemplate: template,
        methodCategoryId: 'direct_sow',
        methodId: 'direct_sow.field'
    });
    const previewTasks = await hooks.buildTasksForPlan({
        plant,
        schedule: result.schedule,
        timelines: result.timelines,
        taskTemplate: template,
        methodCategoryId: 'direct_sow',
        methodId: 'direct_sow.field',
        includePreviewMetadata: true
    });
    assert.deepEqual(
        previewTasks.map(task => [task.startISO, task.endISO]),
        savedTasks.map(task => [task.startISO, task.endISO])
    );
    assert.equal(Object.keys(savedTasks[0]).includes('previewRuleKey'), false);
    assert.equal(Object.keys(previewTasks[0]).includes('previewRuleKey'), false);
    assert.equal(previewTasks[0].previewRuleKey, 'water::0');
    assert.deepEqual(
        previewTasks.map(task => [task.scheduler_method_category_id, task.scheduler_method_id, task.scheduler_task_key, task.scheduler_occurrence_index]),
        savedTasks.map(task => [task.scheduler_method_category_id, task.scheduler_method_id, task.scheduler_task_key, task.scheduler_occurrence_index])
    );
    assert.deepEqual(Array.from(savedTasks, task => task.scheduler_task_key), ['water::0::0', 'water::0::1', 'water::0::2']);
});

test('task titles use plant and variety for built-in and custom task rules', async () => {
    const plant = makePlant({ plant_name: 'Tomato' });
    const result = hooks.computeScheduleResult(makeInputs({ plant }));
    const template = {
        version: 2,
        rules: [
            { id: 'water', title: 'Water {plant}', startAnchorStage: 'SOW', endMode: 'fixed_days', durationDays: 0 },
            { id: 'fertilize', title: 'Fertilize', startAnchorStage: 'SOW', endMode: 'fixed_days', durationDays: 0 },
            { id: 'check_crop', title: 'Check Tomato (Roma)', startAnchorStage: 'SOW', endMode: 'fixed_days', durationDays: 0 },
            { id: 'mulch_plant', title: 'Mulch Tomato', startAnchorStage: 'SOW', endMode: 'fixed_days', durationDays: 0 }
        ]
    };
    const tasks = await hooks.buildTasksForPlan({
        plant,
        schedule: result.schedule,
        timelines: result.timelines,
        taskTemplate: template,
        varietyName: 'Roma'
    });
    assert.equal(tasks.map(task => task.title).join('|'), 'Water – Tomato (Roma)|Fertilize – Tomato (Roma)|Check – Tomato (Roma)|Mulch – Tomato (Roma)');
    assert.equal(tasks.every(task => task.plant_name === 'Tomato'), true);
    assert.equal(tasks.every(task => task.variety_name === 'Roma'), true);
});

test('generated scheduler tasks include canonical and custom task type ids', async () => {
    const plant = makePlant({ plant_name: 'Tomato' });
    const result = hooks.computeScheduleResult(makeInputs({ plant, startISO: '2026-04-01' }));
    const tasks = await hooks.buildTasksForPlan({
        plant,
        schedule: result.schedule,
        timelines: result.timelines,
        taskTemplate: {
            rules: [
                { id: 'prep', title: 'Prep bed', startAnchorStage: 'SOW', startOffsetDays: 1, startOffsetDirection: 'before', endMode: 'fixed_days', durationDays: 1 },
                { id: 'harden', title: 'Harden off', startAnchorStage: 'SOW', endMode: 'fixed_days', durationDays: 1 },
                { id: 'custom_water', title: 'Water', startAnchorStage: 'SOW', endMode: 'fixed_days', durationDays: 1, taskTypeId: 'watering' }
            ]
        }
    });
    assert.deepEqual(Array.from(tasks.map(task => task.task_type_id)), ['bed_preparation', 'hardening_off', 'watering']);
});

test('task titles fall back to plant-only names when no variety is selected', async () => {
    const plant = makePlant({ plant_name: 'Tomato' });
    const result = hooks.computeScheduleResult(makeInputs({ plant }));
    const template = {
        version: 2,
        rules: [
            { id: 'water', title: 'Water {plant}', startAnchorStage: 'SOW', endMode: 'fixed_days', durationDays: 0 },
            { id: 'fertilize', title: 'Fertilize', startAnchorStage: 'SOW', endMode: 'fixed_days', durationDays: 0 }
        ]
    };
    const tasks = await hooks.buildTasksForPlan({
        plant,
        schedule: result.schedule,
        timelines: result.timelines,
        taskTemplate: template
    });
    assert.equal(tasks.map(task => task.title).join('|'), 'Water – Tomato|Fertilize – Tomato');
    assert.equal(tasks.every(task => task.variety_name === ''), true);
});

test('built-in task titles separate action and crop with an en dash', async () => {
    const plant = makePlant({ plant_name: 'Lettuce' });
    const result = hooks.computeScheduleResult(makeInputs({ plant }));
    const library = hooks.taskRuleLibraryForPlanningMode('direct_sow');
    assert.equal([
        library.prep.title,
        library.sow.title,
        library.start.title,
        library.harden.title,
        library.transplant.title,
        library.thin.title,
        library.harvest.title
    ].join('|'), 'Prep bed – {plant}|Sow – {plant}|Start indoors – {plant}|Harden off – {plant}|Transplant – {plant}|Thin / check – {plant}|Harvest – {plant}');
    const tasks = await hooks.buildTasksForPlan({
        plant,
        schedule: result.schedule,
        timelines: result.timelines,
        taskTemplate: { version: 2, rules: [library.thin, library.harvest] },
        varietyName: 'butthead'
    });
    assert.equal(tasks.map(task => task.title).join('|'), 'Thin / check – Lettuce (butthead)|Harvest – Lettuce (butthead)');
});

test('hardening off is clamped to short transplant lead window', async () => {
    const plant = makePlant({ plant_name: 'Tomato', days_transplant: 3 });
    const result = hooks.computeScheduleResult(makeInputs({
        plant,
        planningMode: 'transplant_indoor',
        methodCategoryId: 'transplant',
        methodId: 'transplant.indoor',
        startISO: '2026-04-01'
    }));
    const tasks = await hooks.buildTasksForPlan({
        plant,
        schedule: result.schedule,
        timelines: result.timelines,
        methodCategoryId: 'transplant',
        methodId: 'transplant.indoor',
        taskTemplate: { version: 2, rules: [hooks.taskRuleLibraryForPlanningMode('transplant_indoor').harden] }
    });
    assert.equal(tasks[0].startISO, '2026-04-01');
    assert.equal(tasks[0].endISO, '2026-04-04');
});

test('hardening off keeps default timing when transplant lead is long enough', async () => {
    const plant = makePlant({ plant_name: 'Tomato', days_transplant: 21 });
    const result = hooks.computeScheduleResult(makeInputs({
        plant,
        planningMode: 'transplant_indoor',
        methodCategoryId: 'transplant',
        methodId: 'transplant.indoor',
        startISO: '2026-04-01'
    }));
    const tasks = await hooks.buildTasksForPlan({
        plant,
        schedule: result.schedule,
        timelines: result.timelines,
        methodCategoryId: 'transplant',
        methodId: 'transplant.indoor',
        taskTemplate: { version: 2, rules: [hooks.taskRuleLibraryForPlanningMode('transplant_indoor').harden] }
    });
    assert.equal(tasks[0].startISO, '2026-04-15');
    assert.equal(tasks[0].endISO, '2026-04-22');
});

test('task preview range uses the complete annual schedule instead of selected task dates', () => {
    const result = hooks.computeScheduleResult(makeInputs({ startISO: '2026-04-01' }));
    const range = hooks.resolveTaskPreviewScheduleRange(result);
    assert.deepEqual({ ...range }, {
        startISO: '2026-04-01',
        endISO: result.lastScheduledHarvestEndISO
    });
    assert.notEqual(range.endISO, '2026-04-01');
});

test('task preview range uses the complete perennial lifespan', () => {
    const plant = makePlant({ annual: 0, perennial: 1, lifespan_years: 3 });
    const result = hooks.computeScheduleResult(makeInputs({ plant, startISO: '2026-04-15' }));
    assert.deepEqual({ ...hooks.resolveTaskPreviewScheduleRange(result) }, {
        startISO: result.lifespanStartISO,
        endISO: result.lifespanEndISO
    });
});

test('task preview filtering is display-only and includes all occurrences for selected rules', async () => {
    const plant = makePlant();
    const result = hooks.computeScheduleResult(makeInputs({ plant }));
    const rules = [
        { id: 'duplicate', title: 'First', startAnchorStage: 'SOW', endMode: 'fixed_days', durationDays: 0, repeatMode: 'interval', repeatEveryDays: 1, repeatUntilMode: 'x_times', repeatTimes: 3 },
        { id: 'duplicate', title: 'Second', startAnchorStage: 'SOW', endMode: 'fixed_days', durationDays: 0, repeatMode: 'interval', repeatEveryDays: 2, repeatUntilMode: 'x_times', repeatTimes: 2 }
    ];
    const originalRules = JSON.stringify(rules);
    const generated = await hooks.buildTasksForPlan({
        plant,
        schedule: result.schedule,
        timelines: result.timelines,
        taskTemplate: { version: 2, rules },
        includePreviewMetadata: true
    });
    const filtered = hooks.filterPreviewTasks(generated, new Set(['duplicate::1']));
    assert.equal(filtered.length, 2);
    assert.equal(filtered.every(task => task.title === 'Second – Test Plant'), true);
    assert.equal(filtered.map(task => task.previewOccurrenceIndex).join(','), '0,1');
    assert.equal(JSON.stringify(rules), originalRules);
    assert.equal(generated.length, 5);
});

test('task rule display order follows first generated occurrence and keeps original indexes', () => {
    const rules = [
        { id: 'late', title: 'Late task' },
        { id: 'missing', title: 'Missing anchor task' },
        { id: 'early', title: 'Early task' },
        { id: 'same_day', title: 'Same-day task' }
    ];
    const generated = [
        { previewRuleKey: 'late::0', startISO: '2026-06-10' },
        { previewRuleKey: 'early::2', startISO: '2026-04-01' },
        { previewRuleKey: 'early::2', startISO: '2026-04-05' },
        { previewRuleKey: 'same_day::3', startISO: '2026-04-01' }
    ];
    const ordered = hooks.buildTaskRuleDisplayOrder(rules, generated);
    assert.equal(ordered.map(entry => entry.rule.id).join(','), 'early,same_day,late,missing');
    assert.equal(ordered.map(entry => entry.originalIndex).join(','), '2,3,0,1');
});

test('task preview groups repeats on one row ordered by first occurrence', () => {
    const tasks = [
        { title: 'Later', startISO: '2026-05-10', endISO: '2026-05-11', previewRuleKey: 'later::0', previewRuleIndex: 0, previewOccurrenceIndex: 0 },
        { title: 'Repeat', startISO: '2026-04-08', endISO: '2026-04-09', previewRuleKey: 'repeat::1', previewRuleIndex: 1, previewOccurrenceIndex: 1 },
        { title: 'Repeat', startISO: '2026-04-01', endISO: '2026-04-02', previewRuleKey: 'repeat::1', previewRuleIndex: 1, previewOccurrenceIndex: 0 },
        { title: 'Repeat', startISO: '2026-04-15', endISO: '2026-04-16', previewRuleKey: 'repeat::1', previewRuleIndex: 1, previewOccurrenceIndex: 2 }
    ];
    const groups = hooks.groupPreviewTasksByRule(tasks);
    assert.equal(groups.length, 2);
    assert.equal(groups[0].title, 'Repeat');
    assert.equal(groups[0].occurrences.length, 3);
    assert.equal(groups[0].occurrences.map(task => task.startISO).join(','), '2026-04-01,2026-04-08,2026-04-15');
    assert.equal(groups[1].title, 'Later');
});

test('perennial task generation omits rules whose annual anchors are missing', async () => {
    const plant = makePlant({
        annual: 0,
        perennial: 1,
        lifespan_years: 3,
        days_maturity: null,
        gdd_to_maturity: null
    });
    const result = hooks.computeScheduleResult(makeInputs({ plant, startISO: '2026-04-15' }));
    const tasks = await hooks.buildTasksForPlan({
        plant,
        schedule: result.schedule,
        timelines: result.timelines,
        taskTemplate: {
            rules: [
                { id: 'plant', title: 'Plant', startAnchorStage: 'SOW', endMode: 'fixed_days', durationDays: 0 },
                { id: 'harvest', title: 'Harvest', startAnchorStage: 'HARVEST_START', endMode: 'fixed_days', durationDays: 0 }
            ]
        },
        includePreviewMetadata: true
    });
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].rule_id, 'plant');
});

test('generated tasks include stable scheduler anchor and method metadata', async () => {
    const plant = makePlant({ days_transplant: 21 });
    const result = hooks.computeScheduleResult(makeInputs({
        plant,
        planningMode: 'transplant_indoor',
        methodCategoryId: 'transplant',
        methodId: 'transplant.indoor'
    }));
    const tasks = await hooks.buildTasksForPlan({
        plant,
        schedule: result.schedule,
        timelines: result.timelines,
        methodCategoryId: 'transplant',
        methodId: 'transplant.indoor',
        taskTemplate: {
            rules: [{ id: 'start', title: 'Start indoors {plant}', startAnchorStage: 'SOW', endMode: 'fixed_days', durationDays: 0 }]
        }
    });
    assert.equal(tasks[0].scheduler_rule_id, 'start');
    assert.equal(tasks[0].scheduler_anchor_stage, 'SOW');
    assert.equal(tasks[0].scheduler_method_category_id, 'transplant');
    assert.equal(tasks[0].scheduler_method_id, 'transplant.indoor');
    assert.equal(tasks[0].scheduler_task_key, 'start::0::0');
    assert.equal(tasks[0].scheduler_occurrence_index, 0);
});

test('database persistence failure prevents graph mutation', async () => {
    const cell = makeAttributeCell({ sow_date: '2026-04-01', method_id: 'direct_sow.field' });
    const patch = { sow_date: '2026-05-01', method_id: 'transplant.indoor', lifespan_end: '2029-12-31' };
    const snapshot = hooks.snapshotCellAttributes(cell, Object.keys(patch));
    let graphPatchCount = 0;
    await assert.rejects(
        hooks.runCompensatedSaveSteps({
            applyGraphPatch: () => { graphPatchCount += 1; hooks.applyCellAttributePatch(cell, patch); },
            persist: async () => { throw new Error('db failed'); },
            restoreGraphPatch: () => hooks.restoreCellAttributeSnapshot(cell, snapshot)
        }),
        /db failed/
    );
    assert.equal(graphPatchCount, 0);
    assert.equal(cell.getAttribute('sow_date'), '2026-04-01');
    assert.equal(cell.getAttribute('method_id'), 'direct_sow.field');
    assert.equal(cell.value.hasAttribute('lifespan_end'), false);
});

test('graph patch failure restores snapshotted graph attributes', async () => {
    const cell = makeAttributeCell({ harvest_end: '2026-06-01' });
    const patch = { harvest_end: '2026-07-01', lifespan_start: '' };
    const snapshot = hooks.snapshotCellAttributes(cell, Object.keys(patch));
    await assert.rejects(
        hooks.runCompensatedSaveSteps({
            applyGraphPatch: () => { hooks.applyCellAttributePatch(cell, patch); throw new Error('graph patch failed'); },
            persist: async () => {},
            restoreGraphPatch: () => hooks.restoreCellAttributeSnapshot(cell, snapshot)
        }),
        /graph patch failed/
    );
    assert.equal(cell.getAttribute('harvest_end'), '2026-06-01');
    assert.equal(cell.value.hasAttribute('lifespan_start'), false);
});

test('scheduler permission guard blocks unauthorized planting groups', () => {
    const tiler = makeSchedulerGuardCell({ tiler_group: '1' });
    assert.doesNotThrow(() => hooks.requireCanSchedulePlantingGroup(tiler));
    hooks.__testWindow.Trellis = { users: { isEnabled: () => true, canManagePlanting: () => false } };
    try {
        assert.throws(() => hooks.requireCanSchedulePlantingGroup(tiler), /permission to schedule this planting group/);
        assert.throws(() => hooks.requireCanSchedulePlantingGroup(makeSchedulerGuardCell()), /Scheduler requires a planting group/);
        hooks.__testWindow.Trellis.users.canManagePlanting = () => true;
        assert.doesNotThrow(() => hooks.requireCanSchedulePlantingGroup(tiler));
    } finally {
        delete hooks.__testWindow.Trellis;
    }
});

test('scheduler open and save preflight permissions before side effects', () => {
    const schedulerSource = fs.readFileSync(schedulerPath, 'utf8');
    const openStart = schedulerSource.indexOf('async function openScheduleDialog(ui, cell');
    const openLoad = schedulerSource.indexOf('const plants = await PlantModel.listBasic();', openStart);
    const openGuard = schedulerSource.indexOf('requireCanSchedulePlantingGroup(cell);', openStart);
    assert.ok(openStart >= 0 && openGuard > openStart && openGuard < openLoad);
    const saveStart = schedulerSource.indexOf('async function applyScheduleToGraph(ui, cell, inputs, options = {})');
    const savePatch = schedulerSource.indexOf('const attributePatch = buildScheduleAttributePatch(inputs, result, options);', saveStart);
    const saveGuard = schedulerSource.indexOf('requireCanSchedulePlantingGroup(cell);', saveStart);
    assert.ok(saveStart >= 0 && saveGuard > saveStart && saveGuard < savePatch);
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

function makeGeneratedSyncTask(key, attrs = {}) {
    return {
        title: 'Water',
        startISO: '2026-04-01',
        endISO: '2026-04-01',
        scheduler_task_key: key,
        scheduler_occurrence_index: Number(String(key).split('::').pop() || 0),
        ...attrs
    };
}

function makeGeneratedSyncRecord(key, attrs = {}) {
    return {
        schedulerTaskKey: key,
        source: {
            title: 'Water',
            start: '2026-04-01',
            end: '2026-04-01',
            base_start: '2026-04-01',
            base_end: '2026-04-01',
            scheduler_task_key: key,
            scheduler_occurrence_index: String(Number(String(key).split('::').pop() || 0)),
            ...attrs
        }
    };
}

test('differential task sync planner leaves unchanged generated tasks alone', () => {
    const plan = taskHooks.planDifferentialTaskSync(
        [makeGeneratedSyncRecord('water::0::0')],
        [makeGeneratedSyncTask('water::0::0')]
    );
    assert.equal(plan.legacyReplace, false);
    assert.equal(plan.creates.length, 0);
    assert.equal(plan.updates.length, 0);
    assert.equal(plan.removes.length, 0);
    assert.equal(plan.unchanged.length, 1);
});

test('differential task sync planner updates changed dates and clears date overrides', () => {
    const task = makeGeneratedSyncTask('water::0::0', { startISO: '2026-04-03', endISO: '2026-04-04' });
    const plan = taskHooks.planDifferentialTaskSync(
        [makeGeneratedSyncRecord('water::0::0', { date_override: '1', card_note: 'Keep this' })],
        [task]
    );
    assert.equal(plan.legacyReplace, false);
    assert.equal(plan.updates.length, 1);
    assert.equal(plan.updates[0].record.source.card_note, 'Keep this');
    const attrs = taskHooks.buildGeneratedTaskSyncAttributes(task);
    assert.equal(attrs.start, '2026-04-03');
    assert.equal(attrs.base_start, '2026-04-03');
    assert.equal(attrs.end, '2026-04-04');
    assert.equal(attrs.date_override, null);
    assert.equal(Object.hasOwn(attrs, 'card_note'), false);
});

test('differential task sync planner creates new tasks and removes missing tasks', () => {
    const plan = taskHooks.planDifferentialTaskSync(
        [makeGeneratedSyncRecord('water::0::0'), makeGeneratedSyncRecord('water::0::1')],
        [makeGeneratedSyncTask('water::0::1'), makeGeneratedSyncTask('water::0::2')]
    );
    assert.equal(plan.legacyReplace, false);
    assert.deepEqual(Array.from(plan.creates, item => item.key), ['water::0::2']);
    assert.deepEqual(Array.from(plan.removes, item => item.key), ['water::0::0']);
    assert.deepEqual(Array.from(plan.unchanged, item => item.key), ['water::0::1']);
});

test('differential task sync planner matches repeated occurrences by scheduler task key', () => {
    const plan = taskHooks.planDifferentialTaskSync(
        [makeGeneratedSyncRecord('water::0::1'), makeGeneratedSyncRecord('water::0::0')],
        [makeGeneratedSyncTask('water::0::0'), makeGeneratedSyncTask('water::0::1')]
    );
    assert.equal(plan.legacyReplace, false);
    assert.deepEqual(Array.from(plan.unchanged, item => item.key), ['water::0::0', 'water::0::1']);
});

test('differential task sync planner falls back to replacement for unsafe legacy identities', () => {
    assert.equal(taskHooks.planDifferentialTaskSync([makeGeneratedSyncRecord('water::0::0')], [{ title: 'Legacy' }]).legacyReplace, true);
    assert.equal(taskHooks.planDifferentialTaskSync([{ source: { title: 'Legacy card' } }], [makeGeneratedSyncTask('water::0::0')]).legacyReplace, true);
    assert.equal(taskHooks.planDifferentialTaskSync([makeGeneratedSyncRecord('water::0::0')], [makeGeneratedSyncTask('water::0::0'), makeGeneratedSyncTask('water::0::0')]).legacyReplace, true);
});

test('task planning date helpers use Sunday weeks and bounded day navigation', () => {
    assert.equal(taskHooks.getTaskWeekStartISO('2026-07-15'), '2026-07-12');
    assert.equal(taskHooks.getTaskWeekEndISO('2026-07-12'), '2026-07-18');
    assert.equal(taskHooks.isTaskDateInWeek('2026-07-18', '2026-07-12'), true);
    assert.equal(taskHooks.isTaskDateInWeek('2026-07-19', '2026-07-12'), false);
    assert.equal(taskHooks.getWeekLaneKeyForDate('2026-07-16', '2026-07-12'), 'WEEK_THU');
    assert.equal(taskHooks.getDateForWeekLaneKey('WEEK_FRI', '2026-07-12'), '2026-07-17');
    assert.equal(taskHooks.shiftTaskDayWithinWeek('2026-07-12', '2026-07-12', -1), '2026-07-12');
    assert.equal(taskHooks.shiftTaskDayWithinWeek('2026-07-18', '2026-07-12', 1), '2026-07-18');
    assert.equal(taskHooks.clampTaskStartToVisibleWeek({ start: '2026-07-01' }, '2026-07-12'), '2026-07-12');
    assert.equal(taskHooks.clampTaskStartToVisibleWeek({ start: '2026-07-25' }, '2026-07-12'), '2026-07-18');
    assert.equal(taskHooks.clampTaskStartToVisibleWeek({ start: '2026-07-15' }, '2026-07-12'), '2026-07-15');
    assert.equal(taskHooks.clampTaskStartToVisibleWeek({ start: 'bad-date' }, '2026-07-12'), null);
});

test('task planning view lanes and legacy workflow state are deterministic', () => {
    assert.deepEqual(Array.from(taskHooks.getTaskViewLaneKeys('WEEK')), ['TODO_STAGED', 'WEEK_SUN', 'WEEK_MON', 'WEEK_TUE', 'WEEK_WED', 'WEEK_THU', 'WEEK_FRI', 'WEEK_SAT']);
    assert.deepEqual(Array.from(taskHooks.getTaskViewLaneKeys('DAY')), ['TODO_STAGED', 'WEEK_SUN', 'WEEK_MON', 'WEEK_TUE', 'WEEK_WED', 'WEEK_THU', 'WEEK_FRI', 'WEEK_SAT']);
    assert.equal(taskHooks.normalizeTaskViewMode('DAY'), 'WEEK');
    assert.equal(taskHooks.deriveWorkflowStateFromLaneKey('UPCOMING_MONTH'), 'STAGED');
    assert.equal(taskHooks.deriveWorkflowStateFromLaneKey('TODO'), 'TODO');
    assert.equal(taskHooks.deriveWorkflowStateFromLaneKey('DOING'), 'DOING');
    assert.equal(taskHooks.deriveWorkflowStateFromLaneKey('DONE_WEEK'), 'DONE');
    assert.equal(taskHooks.getEffectiveWorkflowState({ workflow_state: 'doing' }, 'TODO'), 'DOING');
});

test('task planning workflow patches assign and complete from view context', () => {
    const fullTodo = taskHooks.buildWorkflowPatch({}, 'TODO', { mode: 'FULL', today: '2026-07-15' });
    assert.deepEqual({ ...fullTodo.attributes }, { workflow_state: 'TODO', assigned_day: '2026-07-15', scheduler_dates_locked: '1', incomplete_day: null, manual_staged: null, completed: null });

    const weekDone = taskHooks.buildWorkflowPatch({}, 'DONE', { mode: 'WEEK', selectedWeekStart: '2026-07-12', today: '2026-07-15' });
    assert.equal(weekDone.attributes.assigned_day, '2026-07-12');
    assert.equal(weekDone.attributes.completed, '2026-07-12');
    assert.equal(weekDone.attributes.manual_staged, null);

    const dayDone = taskHooks.buildWorkflowPatch({}, 'DONE', { mode: 'DAY', selectedDay: '2026-07-16', selectedWeekStart: '2026-07-12' });
    assert.equal(dayDone.attributes.assigned_day, '2026-07-16');
    assert.equal(dayDone.attributes.completed, '2026-07-16');
    assert.equal(dayDone.attributes.manual_staged, null);

    const staged = taskHooks.buildWorkflowPatch({ workflow_state: 'TODO', assigned_day: '2026-07-16' }, 'STAGED', { manualStaged: true });
    assert.equal(staged.attributes.manual_staged, '1');

    const incomplete = taskHooks.buildIncompletePatch({ workflow_state: 'DOING', assigned_day: '2026-07-16' }, '2026-07-16');
    assert.deepEqual({ ...incomplete.attributes }, { workflow_state: 'STAGED', assigned_day: null, scheduler_dates_locked: null, incomplete_day: '2026-07-16', manual_staged: '1', completed: null });

    const allocation = taskHooks.buildStagedStartDateAllocationPatch({ start: '2026-07-25', manual_staged: '1' }, { selectedWeekStart: '2026-07-12' });
    assert.deepEqual({ ...allocation.attributes }, { workflow_state: 'TODO', assigned_day: '2026-07-18', scheduler_dates_locked: '1', incomplete_day: null, manual_staged: null, completed: null });
    assert.equal(taskHooks.buildStagedStartDateAllocationPatch({ start: '' }, { selectedWeekStart: '2026-07-12' }), null);
});

test('task planning mode lane decisions reflow from card attributes', () => {
    assert.equal(taskHooks.decideTaskViewLaneKey({ workflow_state: 'STAGED' }, { mode: 'WEEK', laneKey: 'TODO_STAGED', selectedWeekStart: '2026-07-12' }), 'TODO_STAGED');
    assert.equal(taskHooks.decideTaskViewLaneKey({ workflow_state: 'STAGED', manual_staged: '1' }, { mode: 'DAY', laneKey: 'UPCOMING_MONTH', selectedDay: '2026-07-15' }), 'TODO_STAGED');
    assert.equal(taskHooks.decideTaskViewLaneKey({ workflow_state: 'STAGED' }, { mode: 'WEEK', laneKey: 'UPCOMING_MONTH', selectedWeekStart: '2026-07-12' }), 'TODO_STAGED');
    assert.equal(taskHooks.decideTaskViewLaneKey({ workflow_state: 'STAGED' }, { mode: 'DAY', laneKey: 'UPCOMING_YEAR', selectedDay: '2026-07-15' }), 'TODO_STAGED');
    assert.equal(taskHooks.decideTaskViewLaneKey({ workflow_state: 'STAGED', manual_staged: '1' }, { mode: 'FULL', laneKey: 'UPCOMING_MONTH' }), 'TODO_STAGED');
    assert.equal(taskHooks.decideTaskViewLaneKey({ workflow_state: 'STAGED' }, { mode: 'FULL', laneKey: 'UPCOMING_MONTH' }), '');
    assert.equal(taskHooks.decideTaskViewLaneKey({ workflow_state: 'TODO', assigned_day: '2026-07-14' }, { mode: 'WEEK', selectedWeekStart: '2026-07-12' }), 'WEEK_TUE');
    assert.equal(taskHooks.decideTaskViewLaneKey({ workflow_state: 'DONE', assigned_day: '2026-07-14', completed: '2026-07-14' }, { mode: 'WEEK', selectedWeekStart: '2026-07-12' }), 'WEEK_TUE');
    assert.equal(taskHooks.decideTaskViewLaneKey({ workflow_state: 'DONE', assigned_day: '2026-07-14', completed: '2026-07-14' }, { mode: 'WEEK', selectedWeekStart: '2026-07-19' }), 'DONE_WEEK');
    assert.equal(taskHooks.decideTaskViewLaneKey({ workflow_state: 'DOING', assigned_day: '2026-07-15' }, { mode: 'DAY', selectedWeekStart: '2026-07-12', selectedDay: '2026-07-15' }), 'WEEK_WED');
    assert.equal(taskHooks.decideTaskViewLaneKey({ workflow_state: 'DOING', assigned_day: '2026-07-16' }, { mode: 'DAY', selectedWeekStart: '2026-07-12', selectedDay: '2026-07-15' }), 'WEEK_THU');
});

test('stack scheduler time helpers snap, normalize hours, and pack cumulatively', () => {
    assert.equal(taskHooks.scheduleMinutesToPx(60), 80);
    assert.equal(taskHooks.schedulePxToMinutes(20), 15);
    assert.equal(taskHooks.schedulePxToMinutes(39), 30);
    assert.equal(taskHooks.defaultScheduleDurationFromHours('1.25'), 75);
    assert.equal(taskHooks.defaultScheduleDurationFromHours(''), 60);
    assert.equal(taskHooks.formatScheduleTimeRange(360, 75), '6:00 AM-7:15 AM');
    assert.equal(taskHooks.formatScheduleTimeRange('', 75), '');
    const laneWidths = taskHooks.normalizeWeekDayLaneWidths(JSON.stringify({ widths: { WEEK_WED: 95, WEEK_THU: 333 } }), 220);
    assert.deepEqual({ ...laneWidths }, {
        WEEK_SUN: 220,
        WEEK_MON: 220,
        WEEK_TUE: 220,
        WEEK_WED: 140,
        WEEK_THU: 333,
        WEEK_FRI: 220,
        WEEK_SAT: 220
    });
    const defaults = taskHooks.defaultWeekWorkHours();
    assert.deepEqual(JSON.parse(JSON.stringify(defaults.map(day => [day.startMinute, day.endMinute, day.closed]))), [
        [480, 720, false],
        [1020, 1140, false],
        [1020, 1140, false],
        [1020, 1140, false],
        [1020, 1140, false],
        [1020, 1140, false],
        [480, 720, false]
    ]);

    const closed = taskHooks.normalizeWorkHourWindow({ closed: true, startMinute: 500, endMinute: 700 });
    assert.deepEqual(JSON.parse(JSON.stringify(closed)), { closed: true, startMinute: 495, endMinute: 705 });
    const week = taskHooks.resolveWeekWorkHours(
        taskHooks.serializeWeekWorkHours([{ startMinute: 360, endMinute: 720 }]),
        JSON.stringify({ weeks: { '2026-07-12': { days: [{ closed: true }] } } }),
        '2026-07-12'
    );
    assert.deepEqual(JSON.parse(JSON.stringify(week[0])), { closed: true, startMinute: 360, endMinute: 720 });
    assert.equal(week[1].startMinute, 360);
    const scale = taskHooks.buildWeekTimeScale(defaults);
    assert.deepEqual({ active: scale.active, startMinute: scale.startMinute, endMinute: scale.endMinute, durationMinutes: scale.durationMinutes }, { active: true, startMinute: 480, endMinute: 1140, durationMinutes: 660 });
    assert.equal(taskHooks.getWeekTimeScaleOffsetPx(defaults[1], scale), 720);
    const quarterScale = taskHooks.buildWeekTimeScale([{ startMinute: 510, endMinute: 1035 }]);
    assert.deepEqual({ startMinute: quarterScale.startMinute, endMinute: quarterScale.endMinute }, { startMinute: 480, endMinute: 1080 });
    assert.equal(taskHooks.getWeekTimeScaleOffsetPx({ startMinute: 510, endMinute: 1035 }, quarterScale), 40);
    const closedScale = taskHooks.buildWeekTimeScale([{ closed: true }, { closed: true }, { closed: true }, { closed: true }, { closed: true }, { closed: true }, { closed: true }]);
    assert.equal(closedScale.active, false);

    const plan = taskHooks.buildStackSchedulePlan([
        { id: 'a', source: { task_estimated_hours: '1.5' }, height: 80 },
        { id: 'b', source: { schedule_duration_minutes: '30' }, height: 40 }
    ], { startMinute: 360, endMinute: 450 });
    assert.deepEqual(Array.from(plan.items, item => [item.startMinute, item.durationMinutes, item.height, item.overflow]), [[360, 90, 120, false], [450, 30, 40, true]]);
    assert.equal(plan.overflowMinutes, 30);
    const breakPlan = taskHooks.buildStackSchedulePlan([{ id: 'break', source: { schedule_break: '1' } }], { startMinute: 360, endMinute: 720 });
    assert.deepEqual(Array.from(breakPlan.items, item => [item.startMinute, item.durationMinutes, item.height, item.overflow]), [[360, 30, 40, false]]);
    const shiftedPlan = taskHooks.buildStackSchedulePlan([
        { id: 'task', source: { schedule_duration_minutes: '60' }, height: 80 },
        { id: 'break', source: { schedule_break: '1', schedule_duration_minutes: '30' }, height: 40 }
    ], { startMinute: 480, endMinute: 540 });
    assert.deepEqual(Array.from(shiftedPlan.items, item => [item.startMinute, item.durationMinutes, item.height, item.overflow]), [[480, 60, 80, false], [540, 30, 40, true]]);
    assert.equal(shiftedPlan.overflowMinutes, 30);

    const scheduleRecords = [
        { id: 'break', source: { schedule_order: '1', schedule_order_day: '2026-07-15' }, fallbackIndex: 0 },
        { id: 'task', source: { schedule_order: '0', schedule_order_day: '2026-07-15' }, fallbackIndex: 1 },
        { id: 'new', source: {}, fallbackIndex: 2 },
        { id: 'stale', source: { schedule_order: '0', schedule_order_day: '2026-07-22' }, fallbackIndex: 3 }
    ].sort((left, right) => taskHooks.compareDateScopedScheduleOrderRecords(left, right, '2026-07-15'));
    assert.deepEqual(scheduleRecords.map(record => record.id), ['task', 'break', 'new', 'stale']);
    assert.equal(taskHooks.getDateScopedScheduleOrder(scheduleRecords[0].source, '2026-07-15'), 0);
    assert.equal(taskHooks.getDateScopedScheduleOrder(scheduleRecords[3].source, '2026-07-15'), null);
});

test('selected period staged sort is date relative and sinks missing starts', () => {
    const records = [
        { title: 'Future tie', start: '2026-07-16' },
        { title: 'Missing start' },
        { title: 'Past tie', start: '2026-07-14' },
        { title: 'Selected day', start: '2026-07-15' },
        { title: 'Invalid start', start: '2026-02-31' }
    ];
    const daySorted = records.slice().sort((left, right) => taskHooks.compareSelectedPeriodStagedRecords(left, right, { mode: 'WEEK', selectedWeekStart: '2026-07-12', selectedDay: '2026-07-15' }));
    assert.deepEqual(daySorted.map(record => record.title), ['Selected day', 'Past tie', 'Future tie', 'Invalid start', 'Missing start']);

    const weekRecords = [
        { title: 'Next Sunday', start: '2026-07-19' },
        { title: 'Prior Saturday', start: '2026-07-11' },
        { title: 'Inside future', start: '2026-07-17' },
        { title: 'Inside past', start: '2026-07-13' },
        { title: 'Inside selected', start: '2026-07-15' },
        { title: 'No date' }
    ];
    const weekSorted = weekRecords.slice().sort((left, right) => taskHooks.compareSelectedPeriodStagedRecords(left, right, { mode: 'WEEK', selectedWeekStart: '2026-07-12', selectedDay: '2026-07-15' }));
    assert.deepEqual(weekSorted.map(record => record.title), ['Inside selected', 'Inside past', 'Inside future', 'Prior Saturday', 'Next Sunday', 'No date']);
});

test('selected period staged start badge text uses visible-week wording', () => {
    assert.equal(taskHooks.buildSelectedPeriodStagedStartText({ start: '2026-07-12' }, { mode: 'WEEK', selectedWeekStart: '2026-07-12' }), 'Start Sun');
    assert.equal(taskHooks.buildSelectedPeriodStagedStartText({ start: '2026-07-14' }, { mode: 'WEEK', selectedWeekStart: '2026-07-12', selectedDay: '2026-07-15', weekBadgeAnchor: 'DAY' }), 'Start Tue');
    assert.equal(taskHooks.buildSelectedPeriodStagedStartText({ start: '2026-07-17' }, { mode: 'WEEK', selectedWeekStart: '2026-07-12' }), 'Start Fri');
    assert.equal(taskHooks.buildSelectedPeriodStagedStartText({ start: '2026-07-15' }, { mode: 'WEEK', selectedWeekStart: '2026-07-12', today: '2026-07-15' }), 'Start today');
    assert.equal(taskHooks.buildSelectedPeriodStagedStartText({ start: '2026-07-16' }, { mode: 'WEEK', selectedWeekStart: '2026-07-12', today: '2026-07-15' }), 'Start tomorrow');
    assert.equal(taskHooks.buildSelectedPeriodStagedStartText({ start: '2026-07-11' }, { mode: 'WEEK', selectedWeekStart: '2026-07-12' }), '1d late');
    assert.equal(taskHooks.buildSelectedPeriodStagedStartText({ start: '2026-07-19' }, { mode: 'WEEK', selectedWeekStart: '2026-07-12' }), 'Starts in 1d');
    assert.equal(taskHooks.buildSelectedPeriodStagedStartText({ start: '2026-07-25' }, { mode: 'WEEK', selectedWeekStart: '2026-07-12' }), 'Starts in 7d');
    assert.equal(taskHooks.buildSelectedPeriodStagedStartText({ start: '2026-02-31' }, { mode: 'WEEK', selectedDay: '2026-07-15', weekBadgeAnchor: 'DAY' }), '');
    assert.equal(taskHooks.buildSelectedPeriodStagedStartText({}, { mode: 'WEEK', selectedWeekStart: '2026-07-12' }), '');
    assert.equal(taskHooks.buildSelectedPeriodStagedDueText({ start: '2026-07-14' }, { mode: 'WEEK', selectedWeekStart: '2026-07-12' }), 'Start Tue');
});

test('selected period staged mode applies only to staged planning views', () => {
    assert.equal(taskHooks.selectedPeriodStagedSortEnabled('TODO_STAGED', { mode: 'WEEK' }), true);
    assert.equal(taskHooks.selectedPeriodStagedSortEnabled('TODO_STAGED', { mode: 'DAY' }), true); // CHANGE: legacy DAY normalizes to WEEK
    assert.equal(taskHooks.selectedPeriodStagedSortEnabled('TODO_STAGED', { mode: 'FULL' }), false);
    assert.equal(taskHooks.selectedPeriodStagedSortEnabled('TODO', { mode: 'DAY' }), false);
});

test('scheduler sync respects date locks and preserves touched missing cards', () => {
    const lockedAttrs = taskHooks.buildGeneratedTaskSyncAttributesForExisting({ scheduler_dates_locked: '1', start: '2026-07-10' }, makeGeneratedSyncTask('water::0::0', { startISO: '2026-08-01', endISO: '2026-08-02' }));
    assert.equal(Object.hasOwn(lockedAttrs, 'start'), false);
    assert.equal(lockedAttrs.scheduler_missing, null);

    const plan = taskHooks.planDifferentialTaskSync(
        [makeGeneratedSyncRecord('water::0::0', { workflow_state: 'TODO', assigned_day: '2026-07-15' }), makeGeneratedSyncRecord('water::0::1'), { ...makeGeneratedSyncRecord('water::0::2'), laneKey: 'DOING' }],
        []
    );
    assert.deepEqual(Array.from(plan.missing, item => item.key), ['water::0::0', 'water::0::2']);
    assert.deepEqual(Array.from(plan.removes, item => item.key), ['water::0::1']);

    const manuallyStagedPlan = taskHooks.planDifferentialTaskSync([makeGeneratedSyncRecord('water::0::3', { manual_staged: '1' })], []);
    assert.deepEqual(Array.from(manuallyStagedPlan.missing, item => item.key), ['water::0::3']);
});

test('repeat series identity normalizes links and text without using dates', () => {
    const first = {
        linkedTo: ' group-b, group-a,group-b ',
        plant_name: '  Tomato ',
        method: ' FIELD ',
        title: ' Water Plants ',
        start: '2026-04-01'
    };
    const second = { ...first, linkedTo: 'group-a,group-b', start: '2026-08-01' };
    const parsed = JSON.parse(taskHooks.buildRepeatSeriesKey(first));

    assert.equal(taskHooks.buildRepeatSeriesKey(first), taskHooks.buildRepeatSeriesKey(second));
    assert.equal(parsed[0].join(','), 'group-a,group-b');
    assert.equal(parsed.slice(1).join('|'), 'tomato|field|water plants');
    assert.equal(taskHooks.buildRepeatSeriesKey({ ...first, linkedTo: ' ' }), null);
});

test('collapsed repeat planning keeps one representative per lane and excludes hidden years', () => {
    const key = 'series';
    const plan = taskHooks.planRepeatSeriesVisibility([
        { id: 'a', seriesKey: key, laneKey: 'TODO', startISO: '2026-04-01', endISO: '2026-04-01' },
        { id: 'b', seriesKey: key, laneKey: 'TODO', startISO: '2026-04-08', endISO: '2026-04-08' },
        { id: 'c', seriesKey: key, laneKey: 'DOING', startISO: '2026-04-15', endISO: '2026-04-15' },
        { id: 'hidden-year', seriesKey: key, laneKey: 'TODO', startISO: '2025-01-01', yearHidden: true }
    ]);
    const byId = new Map(plan.map(item => [item.id, item]));

    assert.equal(byId.get('a').repeatHidden, false);
    assert.equal(byId.get('a').repeatBadge, '1/3 +1');
    assert.equal(byId.get('b').repeatHidden, true);
    assert.equal(byId.get('b').repeatBadge, '');
    assert.equal(byId.get('c').repeatHidden, false);
    assert.equal(byId.get('c').repeatBadge, '3/3');
    assert.equal(byId.get('hidden-year').repeating, false);
});

test('expanded repeat planning shows every eligible occurrence when any series card is expanded', () => {
    const plan = taskHooks.planRepeatSeriesVisibility([
        { id: 'a', seriesKey: 'series', laneKey: 'TODO', startISO: '2026-04-01' },
        { id: 'b', seriesKey: 'series', laneKey: 'TODO', startISO: '2026-04-08' },
        { id: 'hidden-year', seriesKey: 'series', laneKey: 'TODO', startISO: '2025-01-01', yearHidden: true, expanded: true }
    ]);
    const byId = new Map(plan.map(item => [item.id, item]));

    assert.equal(byId.get('a').repeatHidden, false);
    assert.equal(byId.get('a').repeatBadge, '1/2');
    assert.equal(byId.get('b').repeatHidden, false);
    assert.equal(byId.get('b').repeatBadge, '2/2');
    assert.equal(byId.get('hidden-year').repeatBadge, '');
});

test('repeat planning clears stale state and uses deterministic malformed-date fallbacks', () => {
    const single = taskHooks.planRepeatSeriesVisibility([
        { id: 'only', seriesKey: 'single', laneKey: 'DONE', startISO: 'bad-date', expanded: true }
    ])[0];
    assert.equal(single.repeatHidden, false);
    assert.equal(single.repeatBadge, '');

    const ordered = [
        { id: 'z-invalid', startISO: 'invalid', endISO: '2026-04-02' },
        { id: 'b', startISO: '2026-04-01', endISO: '2026-04-03' },
        { id: 'a', startISO: '2026-04-01', endISO: '2026-04-02' }
    ].sort(taskHooks.compareRepeatOccurrenceRecords);
    assert.equal(ordered.map(item => item.id).join(','), 'a,b,z-invalid');
});

test('repeat planning reveals the next source-lane card after a representative moves', () => {
    const key = 'move-series';
    const before = taskHooks.planRepeatSeriesVisibility([
        { id: 'a', seriesKey: key, laneKey: 'TODO', startISO: '2026-04-01' },
        { id: 'b', seriesKey: key, laneKey: 'TODO', startISO: '2026-04-08' },
        { id: 'c', seriesKey: key, laneKey: 'DOING', startISO: '2026-04-15' }
    ]);
    assert.equal(before.find(item => item.id === 'b').repeatHidden, true);

    const after = taskHooks.planRepeatSeriesVisibility([
        { id: 'a', seriesKey: key, laneKey: 'DOING', startISO: '2026-04-01' },
        { id: 'b', seriesKey: key, laneKey: 'TODO', startISO: '2026-04-08' },
        { id: 'c', seriesKey: key, laneKey: 'DOING', startISO: '2026-04-15' }
    ]);
    const byId = new Map(after.map(item => [item.id, item]));
    assert.equal(byId.get('b').repeatHidden, false);
    assert.equal(byId.get('b').repeatBadge, '2/3');
    assert.equal(byId.get('c').repeatHidden, true);
});

test('done-lane repeats collapse and both hidden flags are excluded from rendering', () => {
    const donePlan = taskHooks.planRepeatSeriesVisibility([
        { id: 'done-a', seriesKey: 'done-series', laneKey: 'DONE', startISO: '2026-04-01' },
        { id: 'done-b', seriesKey: 'done-series', laneKey: 'DONE', startISO: '2026-04-02' }
    ]);
    assert.equal(donePlan.find(item => item.id === 'done-a').repeatBadge, '1/2 +1');
    assert.equal(donePlan.find(item => item.id === 'done-b').repeatHidden, true);
    assert.equal(taskHooks.isCardVisibilityEligible({}), true);
    assert.equal(taskHooks.isCardVisibilityEligible({ repeat_hidden: '1' }), false);
    assert.equal(taskHooks.isCardVisibilityEligible({ year_hidden: '1' }), false);
});

test('completion logic remains independent from renderability', () => {
    const source = fs.readFileSync(taskManagerPath, 'utf8');
    const start = source.indexOf('function allLinkedCardsDone');
    const end = source.indexOf('function updateGroupRenderState', start);
    const completionSource = source.slice(start, end);

    assert.match(completionSource, /\.filter\(isKanbanCard\)/);
    assert.doesNotMatch(completionSource, /isRenderableKanbanCard|isCardVisibilityEligible/);
});

test('new task cards store scheduler dates as active and baseline dates', () => {
    const attrs = taskHooks.buildInitialCardDateAttributes('2026-04-10', '2026-04-13');
    assert.equal(attrs.start, '2026-04-10');
    assert.equal(attrs.end, '2026-04-13');
    assert.equal(attrs.base_start, '2026-04-10');
    assert.equal(attrs.base_end, '2026-04-13');
    assert.equal(Object.hasOwn(attrs, 'date_override'), false);
});

test('new task cards copy scheduler task type metadata', () => {
    assert.deepEqual({ ...taskHooks.buildSchedulerTaskMetadataAttributes({ task_type_id: 'watering' }) }, { task_type_id: 'watering' });
    assert.deepEqual({ ...taskHooks.buildSchedulerTaskMetadataAttributes({ taskTypeId: 'general' }) }, { task_type_id: 'general' });
    assert.deepEqual({ ...taskHooks.buildSchedulerTaskMetadataAttributes({
        rule_id: 'start',
        startAnchorStage: 'SOW',
        methodCategoryId: 'transplant',
        methodId: 'transplant.indoor',
        scheduler_task_key: 'start::0::0',
        scheduler_occurrence_index: 0
    }) }, {
        scheduler_rule_id: 'start',
        scheduler_anchor_stage: 'SOW',
        scheduler_method_category_id: 'transplant',
        scheduler_method_id: 'transplant.indoor',
        scheduler_task_key: 'start::0::0',
        scheduler_occurrence_index: '0'
    });
    assert.deepEqual({ ...taskHooks.buildSchedulerTaskMetadataAttributes({}) }, {});
});

test('task replacement bridge retains differential sync without scheduler task-edit callback', () => {
    const schedulerSource = fs.readFileSync(schedulerPath, 'utf8');
    const taskManagerSource = fs.readFileSync(taskManagerPath, 'utf8');
    assert.match(schedulerSource, /mode:\s*options\.taskDispatchMode \|\| "replace"/);
    assert.match(taskManagerSource, /replacement\.mode !== 'replace' && replacement\.mode !== 'sync'/);
    assert.match(taskManagerSource, /applySchedulerTaskReplacement\(detail,\s*opts\)/);
    assert.match(taskManagerSource, /replacement\.mode === 'sync'[\s\S]*applyDifferentialTaskSync/);
    assert.match(taskManagerSource, /taskCommands\.applySchedulerTaskReplacement\(replacement\)/);
    assert.doesNotMatch(schedulerSource, /applyTaskAnchorDateEdit/);
    assert.doesNotMatch(taskManagerSource, /tryApplySchedulerAnchorDateEdit/);
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
    assert.equal(reset.manual_staged, null);
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

test('kanban parenting policy allows only canonical board lane and lane card structure', () => {
    const board = { id: 'board', board_key: 'KANBAN_BOARD' };
    const legacyBoard = { id: 'legacy-board', board_key: 'MAIN_KANBAN_BOARD' };
    const todoLane = { id: 'todo-lane', lane_key: 'TODO' };
    const stagedLane = { id: 'staged-lane', lane_key: 'TODO_STAGED' };
    const weekLane = { id: 'week-lane', lane_key: 'WEEK_SUN' };
    const otherTodoLane = { id: 'other-todo-lane', lane_key: 'TODO' };
    const doingLane = { id: 'doing-lane', lane_key: 'DOING' };
    const unknownLane = { id: 'unknown-lane', lane_key: 'CUSTOM' };
    const card = { id: 'card', kanban_card: '1' };
    const breakCard = { id: 'break-card', kanban_card: '1', schedule_break: '1' };
    const generic = { id: 'shape' };

    assert.equal(taskHooks.getKanbanCellType(board), 'board');
    assert.equal(taskHooks.getKanbanCellType(legacyBoard), 'board');
    assert.equal(taskHooks.getKanbanCellType(todoLane), 'lane');
    assert.equal(taskHooks.getKanbanCellType(stagedLane), 'lane');
    assert.equal(taskHooks.getKanbanCellType(weekLane), 'lane');
    assert.equal(taskHooks.getKanbanCellType(card), 'card');
    assert.equal(taskHooks.getKanbanCellType(unknownLane), 'other');

    assert.equal(taskHooks.canParentKanbanCell(board, todoLane, { siblings: [] }), true);
    assert.equal(taskHooks.canParentKanbanCell(board, weekLane, { siblings: [todoLane] }), true);
    assert.equal(taskHooks.canParentKanbanCell(board, doingLane, { siblings: [todoLane] }), true);
    assert.equal(taskHooks.canParentKanbanCell(board, todoLane, { siblings: [todoLane] }), true);
    assert.equal(taskHooks.canParentKanbanCell(board, otherTodoLane, { siblings: [todoLane] }), false);
    assert.equal(taskHooks.canParentKanbanCell(board, card, { siblings: [] }), false);
    assert.equal(taskHooks.canParentKanbanCell(board, generic, { siblings: [] }), false);
    assert.equal(taskHooks.canParentKanbanCell(todoLane, card, { siblings: [] }), true);
    assert.equal(taskHooks.canParentKanbanCell(stagedLane, card, { siblings: [] }), true);
    assert.equal(taskHooks.canParentKanbanCell(stagedLane, breakCard, { siblings: [] }), false);
    assert.equal(taskHooks.canParentKanbanCell(weekLane, breakCard, { siblings: [] }), true);
    assert.equal(taskHooks.canParentKanbanCell(todoLane, generic, { siblings: [] }), false);
    assert.equal(taskHooks.canParentKanbanCell(todoLane, doingLane, { siblings: [] }), false);
    assert.equal(taskHooks.canParentKanbanCell(generic, card, { siblings: [] }), false);
    assert.equal(taskHooks.canParentKanbanCell(generic, todoLane, { siblings: [] }), false);
    assert.equal(taskHooks.canParentKanbanCell(generic, board, { siblings: [] }), true);
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
    assert.match(source, /scheduleTimeBadge \+ badgesHtml \+ stateBadge \+ missingBadge \+ incompleteBadge \+ repeatBadge \+ noteBadge \+ editedDateBadge \+ linkBadge/);
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
    const commitStart = source.indexOf('function commitCardPatch(card, attributes, opts)');
    const commitEnd = source.indexOf('function fmtSigned', commitStart);
    const commitSource = source.slice(commitStart, commitEnd);
    const valueWrites = commitSource.match(/model\.setValue\(card,\s*cloneCardValueWithAttributes\(card,\s*attributes\)\)/g) || [];
    assert.equal(valueWrites.length, 1);
    assert.match(source, /function commitCardPatch\(card,\s*attributes,\s*opts\)/);
    assert.match(source, /if \(shouldReflow\) \{\s*scanAndReflowBoard\(board,\s*\{\s*insideUpdate:\s*true,\s*scope:\s*getTaskReflowScopeForCommand\('dateEdit'\)\s*\}\)/);
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

test('task manager installs kanban parenting drop and move guards', () => {
    const source = fs.readFileSync(taskManagerPath, 'utf8');
    assert.match(source, /function installKanbanParentingGuards\(\)/);
    assert.match(source, /graph\.isValidDropTarget = function \(target,\s*cells,\s*evt\)/);
    assert.match(source, /graph\.moveCells = function \(cells,\s*dx,\s*dy,\s*clone,\s*target,\s*evt,\s*mapping\)/);
    assert.match(source, /buildLaneDropWorkflowPatch\(card,\s*targetBoard,\s*targetLaneKey\)/);
    assert.match(source, /installKanbanParentingGuards\(\);/);
});

test('task manager installs planning mode header controls and selected-card DOM overlay', () => {
    const source = fs.readFileSync(taskManagerPath, 'utf8');
    assert.match(source, /function installBoardHeaderControls\(\)/);
    assert.match(source, /function ensureTaskControlOverlayHost\(\)/);
    assert.match(source, /const paneIsSvg = !!\(pane && pane\.namespaceURI === 'http:\/\/www\.w3\.org\/2000\/svg'\)/);
    assert.match(source, /const baseHost = pane && !paneIsSvg \? pane : \(graph\.container \|\| pane \|\| null\)/);
    assert.match(source, /trellis-task-control-layer/);
    assert.match(source, /if \(style && style\.position === 'static'\) baseHost\.style\.position = 'relative'/);
    assert.match(source, /trellis-task-board-header-controls/);
    assert.match(source, /bar\.style\.zIndex = String\(GRAPH_OVERLAY_Z\.CONTROL\)/);
    assert.match(source, /dateInput\.type = 'date'/);
    assert.match(source, /if \(!value\) \{\s*taskCommands\.setBoardPlanningView\(b,\s*'FULL'\)/);
    assert.match(source, /taskCommands\.setBoardPlanningView\(b,\s*'WEEK',\s*\{\s*\[TASK_SELECTED_WEEK_START_ATTR\]: weekStart,\s*\[TASK_SELECTED_DAY_ATTR\]: value\s*\}\)/);
    assert.match(source, /positionDomOverlayFromCellState\(bar,\s*board,\s*false,\s*true,\s*0,\s*TASK_BOARD_HEADER_OVERLAY_EXTRA_X\)/);
    assert.match(source, /const left = bounds\.x/);
    assert.match(source, /const topBase = bounds\.y/);
    assert.match(source, /function getSelectionCellsList\(\)/);
    assert.match(source, /if \(isBoardCell\(cell\)\).*return cell/);
    assert.match(source, /const board = findBoardAncestor\(cell\)/);
    assert.match(source, /function restoreBoardSelectionIfNeeded\(board\)/);
    assert.match(source, /function toggleBoardPlanningView\(\)/);
    assert.match(source, /modeLabel\.textContent = mode === 'WEEK' \? 'Mode: Week' : 'Mode: Full'/);
    assert.match(source, /modeToggle\.textContent = mode === 'WEEK' \? 'Switch to Full view' : 'Switch to Week view'/);
    assert.match(source, /prev\.style\.display = mode === 'WEEK' \? '' : 'none'/);
    assert.match(source, /End Day \('/);
    assert.match(source, /End Week \('/);
    assert.match(source, /function installSelectedCardActionOverlay\(\)/);
    assert.match(source, /trellis-task-selected-card-actions/);
    assert.match(source, /overlay\.style\.zIndex = String\(GRAPH_OVERLAY_Z\.CONTROL\)/);
    assert.match(source, /function selectedKanbanCards\(\)/); // CHANGE: placement and workflow visibility are covered behaviorally in task-manager-overlays.test.cjs
    assert.match(source, /graph\.view\.getState\(cell\)/);
    assert.match(source, /graph\.view\.addListener\(mxEvent\.REPAINT,\s*refresh\)/);
    assert.match(source, /model\.addListener\(mxEvent\.CHANGE,\s*refresh\)/);
    assert.match(source, /graph\.container\.addEventListener\('scroll',\s*refresh,\s*\{\s*passive:\s*true\s*\}\)/);
    assert.match(source, /function createDeferredTaskOverlayRefresh\(refresh\)/);
    assert.match(source, /taskCommands\.applyCardWorkflowActions\(cards,\s*'DONE'\)/);
    assert.match(source, /Allocate to Start Dates/);
    assert.match(source, /buildStagedStartDateAllocationPatch\(card\.value,\s*buildCardWorkflowContext\(board\)\)/);
    assert.match(source, /menu\.addItem\('Edit Card\.\.\.'/);
});

test('task manager day-owned breaks use assigned day ownership', () => {
    const source = fs.readFileSync(taskManagerPath, 'utf8');
    assert.match(source, /setAttrNoUndo\(card,\s*TASK_ASSIGNED_DAY_ATTR,\s*assignedDay,\s*true\)/);
    assert.match(source, /reconcileScheduleBreakOwnership\(board,\s*sourceLaneKey,\s*c\)/);
    assert.match(source, /getAttr\(card,\s*TASK_ASSIGNED_DAY_ATTR\) === getVisibleDateForWeekLane\(board,\s*laneKey\)/);
    const inactiveBranch = source.slice(source.indexOf('function reconcileScheduleBreakOwnership'), source.indexOf('function isActiveScheduleCardForLane'));
    assert.match(inactiveBranch, /setDerivedCardAttribute\(card,\s*TASK_SCHEDULE_START_MINUTE_ATTR,\s*null\)/);
    assert.doesNotMatch(inactiveBranch, /setDerivedCardAttribute\(card,\s*TASK_SCHEDULE_DURATION_MINUTES_ATTR,\s*null\)/);
});

test('task manager schedule order is date scoped for tasks and breaks', () => {
    const source = fs.readFileSync(taskManagerPath, 'utf8');
    assert.match(source, /const TASK_SCHEDULE_ORDER_ATTR = 'schedule_order';/);
    assert.match(source, /const TASK_SCHEDULE_ORDER_DAY_ATTR = 'schedule_order_day';/);
    assert.match(source, /compareDateScopedScheduleOrderRecords\(left,\s*right,\s*visibleDay\)/);
    assert.match(source, /setDerivedCardAttribute\(record\.cell,\s*TASK_SCHEDULE_ORDER_ATTR,\s*index\)/);
    assert.match(source, /syncScheduleLanePhysicalOrder\(lane,\s*records\)/);
});

test('task manager edit hours dialog uses a readable table layout and preserves save reflow', () => {
    const source = fs.readFileSync(taskManagerPath, 'utf8');
    const saveBlock = source.slice(source.indexOf("const save = mxUtils.button('Save'"), source.indexOf("buttons.appendChild(cancel)", source.indexOf("const save = mxUtils.button('Save'")));
    const hoursBlock = source.slice(source.indexOf('function showEditHoursDialogImpl'), source.indexOf('function saveBoardWeekWorkHours'));
    assert.match(hoursBlock, /taskDialogs\.showTaskManagerDialog\(div,\s*660,\s*600,\s*true,\s*true\)/);
    assert.match(hoursBlock, /grid-template-columns:110px 78px minmax\(136px,1fr\) minmax\(136px,1fr\)/);
    assert.match(hoursBlock, /width:100%;min-width:136px;box-sizing:border-box/);
    assert.match(hoursBlock, /\['Day',\s*'Closed',\s*'Start',\s*'End'\]/);
    assert.match(hoursBlock, /function updateClosedRowState\(row,\s*closed,\s*start,\s*end\)/);
    assert.match(hoursBlock, /start\.disabled = isClosed/);
    assert.match(hoursBlock, /end\.disabled = isClosed/);
    assert.match(hoursBlock, /closed\.addEventListener\('change',\s*function \(\) \{ updateClosedRowState\(row,\s*closed,\s*start,\s*end\); \}\)/);
    assert.match(saveBlock, /taskCommands\.saveBoardWeekWorkHours\(board,\s*weekStart,\s*weeks,\s*nextDefaults,\s*nextWeek\)/);
    assert.match(source, /function saveBoardWeekWorkHours\(board,\s*weekStart,\s*weeks,\s*nextDefaults,\s*nextWeek\)/);
    assert.match(source, /setAttrNoUndo\(board,\s*TASK_WORK_HOURS_DEFAULTS_ATTR,\s*serializeWeekWorkHours\(nextDefaults\),\s*true\)/);
    assert.match(source, /setAttrNoUndo\(board,\s*TASK_WORK_HOURS_WEEK_OVERRIDES_ATTR,\s*JSON\.stringify\(\{\s*schemaVersion:\s*1,\s*weeks:\s*nextWeeks\s*\}\),\s*true\)/);
    assert.match(source, /scanAndReflowBoard\(board,\s*\{\s*insideUpdate:\s*true,\s*scope:\s*getTaskReflowScopeForCommand\('editHours'\)\s*\}\)/);
});

test('task manager dialog calls use Trellis dialog elevation', () => {
    const source = fs.readFileSync(taskManagerPath, 'utf8');
    assert.match(source, /const TRELLIS_DIALOG_Z = 2000000000;/);
    assert.match(source, /function createTaskDialogRuntime\(\{\s*ui,\s*document,\s*commands,\s*adapters\s*\}\)/);
    assert.match(source, /const taskDialogs = createTaskDialogRuntime\(\{/);
    assert.match(source, /function showEditCardDialog\(card\) \{ return taskDialogs\.showEditCardDialog\(card\); \}/);
    assert.match(source, /taskDialogs\.showEditHoursDialog\(b\)/);
    assert.match(source, /taskDialogs\.showBulkEditCardsDialog\(cards\)/);
    assert.match(source, /function elevateTaskManagerDialog\(\)/);
    assert.match(source, /dlg\.container\.style\.zIndex = String\(TRELLIS_DIALOG_Z\)/);
    assert.match(source, /dlg\.bg\.style\.zIndex = String\(TRELLIS_DIALOG_Z - 1\)/);
    const directCalls = (source.match(/ui\.showDialog\(/g) || []).length;
    const wrapperCalls = (source.match(/taskDialogs\.showTaskManagerDialog\(/g) || []).length;
    assert.equal(directCalls, 1);
    assert.ok(wrapperCalls >= 3);
});

test('task manager isolates no-undo planning view reflow', () => {
    const source = fs.readFileSync(taskManagerPath, 'utf8');
    assert.match(source, /function runKanbanViewNoUndo\(fn\)/);
    assert.match(source, /kanbanViewReflowDepth/);
    assert.match(source, /isKanbanViewReflowing\(\)/);
    assert.match(source, /undoManager\.history\.splice\(beforeLength\)/);
    assert.match(source, /runKanbanViewNoUndo\(function \(\) \{/);
});

test('save path passes the in-memory task template to graph application', () => {
    const source = fs.readFileSync(schedulerPath, 'utf8');
    assert.match(source, /taskTemplate:\s*options\.taskTemplate\s*\?\?\s*null/);
    assert.match(source, /taskTemplate,\s*\/\/ FIX: generate tasks from the in-memory template/);
});

test('scheduler tab buttons do not style an out-of-scope save button', () => { // FIX: guard against copied button styling references that break dialog open
    const source = fs.readFileSync(schedulerPath, 'utf8'); // FIX
    const tabsStart = source.indexOf('const scheduleTabBtn = makeTabButton("Schedule", div);'); // FIX
    const tabsEnd = source.indexOf('tabsHeader.appendChild(scheduleTabBtn);', tabsStart); // FIX
    const tabsBlock = source.slice(tabsStart, tabsEnd); // FIX
    assert.ok(tabsStart >= 0 && tabsEnd > tabsStart, 'expected scheduler tab button block'); // FIX
    assert.doesNotMatch(tabsBlock, /applySharedButtonStyle\(saveBtn,\s*'add'\)/); // FIX
    assert.match(source, /const okBtn = mxUtils\.button\('Save'[\s\S]*applySharedButtonStyle\(okBtn,\s*'add'\);/); // FIX
});

test('schedule save requests selection overlay refresh after final graph refresh', () => {
    const source = fs.readFileSync(schedulerPath, 'utf8');
    assert.match(source, /function requestSelectionVisualsRefresh\(graph, cell\)/);
    assert.match(source, /new mxEventObject\('trellisSelectionVisualsRefresh', 'cell', cell\)/);
    assert.match(source, /finalizeGraph:\s*async \(\) => \{[\s\S]*graph\.refresh\(cell\);[\s\S]*requestSelectionVisualsRefresh\(graph, cell\);/);
});

test('scheduler clears stale no-window warning after feasible crop recovery', () => {
    const source = fs.readFileSync(schedulerPath, 'utf8');
    const anchorStart = source.indexOf('async function recomputeAnchors');
    const anchorEnd = source.indexOf('// --- mode switcher', anchorStart);
    const anchorBody = source.slice(anchorStart, anchorEnd);
    const noWindowIndex = anchorBody.indexOf("showErrorInline('No feasible window.');");
    const clearRecoveryIndex = anchorBody.indexOf('clearErrorInline(); // FIX: clear stale no-window warning after feasibility recovers');
    const successReturnIndex = anchorBody.indexOf('return true; // FIX: allow dependent recomputation only after valid anchors');

    assert.ok(noWindowIndex >= 0, 'infeasible anchors should still show the no-window warning');
    assert.ok(clearRecoveryIndex > noWindowIndex, 'feasible recovery should clear the prior no-window warning');
    assert.ok(successReturnIndex > clearRecoveryIndex, 'the warning should clear immediately before anchor success');
    assert.match(source, /plantSel\.addEventListener\('change',\s*\(\)\s*=>\s*\{[\s\S]*currentCropPickerSelectedValue = String\(plantSel\.value \|\| ''\);[\s\S]*schedulerCropPickerRefreshVersion \+= 1;[\s\S]*renderSchedulerCropPicker\(currentCropPickerOptions, currentCropPickerSelectedValue\);[\s\S]*void runUiAsync\('Plant change error',\s*async \(\)\s*=>\s*\{\s*\/\/ FIX: clear stale inline warnings before crop recompute\s*await handleSchedulePlantChange\(\);/s);
    assert.match(source, /varietySel\.addEventListener\('change',\s*\(\)\s*=>\s*\{\s*void runUiAsync\('Variety change error',\s*async \(\)\s*=>\s*\{\s*\/\/ FIX: clear stale inline warnings before variety recompute\s*await handleScheduleVarietyChange\(\);\s*\}\);\s*\}\);/s);
});
