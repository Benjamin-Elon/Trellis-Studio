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
    const hooks = context.window.__TRELLIS_PLANTING_SCHEDULER_TEST_HOOKS__;
    hooks.__testWindow = context.window; // ADDED
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

function makeVancouverCity(overrides = {}) { // ADDED
    const means = { 1: 4, 2: 5.5, 3: 8, 4: 10, 5: 13, 6: 16, 7: 18.5, 8: 18.5, 9: 14.5, 10: 8.5, 11: 4.5, 12: 4 }; // ADDED
    const row = { // ADDED
        city_name: 'Vancouver, BC', // ADDED
        gdd_annual: 1550, // ADDED
        gdd_base_c: 5, // ADDED
        last_spring_frost_doy: 1, // ADDED
        ...overrides // ADDED
    }; // ADDED
    for (let month = 1; month <= 12; month += 1) { // ADDED
        row[`avg_monthly_high_c${month}`] = means[month] + 2; // ADDED
        row[`avg_monthly_low_c${month}`] = means[month] - 2; // ADDED
    } // ADDED
    return new hooks.CityClimate(row); // ADDED
} // ADDED

function makeLangleyColdCity(overrides = {}) { // ADDED
    const lowsHighs = [[-10, 11], [-9, 11], [-3, 16], [0, 21], [4, 26], [7, 30], [10, 31], [10, 33], [7, 28], [1, 21], [-3, 14], [-9, 10]]; // ADDED
    const row = { city_name: 'Langley, BC', gdd_annual: 1969, gdd_base_c: 5, last_spring_frost_doy: 1, ...overrides }; // ADDED
    lowsHighs.forEach(function ([lo, hi], index) { // ADDED
        row[`avg_monthly_low_c${index + 1}`] = lo; // ADDED
        row[`avg_monthly_high_c${index + 1}`] = hi; // ADDED
    }); // ADDED
    return new hooks.CityClimate(row); // ADDED
} // ADDED

function makeDailyClimateRange(startISO, endISO, defaultRecord, overrides = {}) { // ADDED
    const days = {}; // ADDED
    for (let cur = new Date(`${startISO}T00:00:00Z`), end = new Date(`${endISO}T00:00:00Z`); cur <= end; cur.setUTCDate(cur.getUTCDate() + 1)) { // ADDED
        const iso = cur.toISOString().slice(0, 10); // ADDED
        days[iso] = { ...defaultRecord, ...(overrides[iso] || {}) }; // ADDED
    } // ADDED
    return { days, diagnostics: {} }; // ADDED
} // ADDED

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
    minYieldMultiplier = 0, // ADDED
    policy = null,
    bedProfile = null, // ADDED
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
        minYieldMultiplier, // ADDED
        bedProfile, // ADDED
        dailyClimate
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
        scanEndHard: new Date(`${year + hooks.getPlantScanYears(plant) - 1}-12-31T00:00:00Z`), // CHANGED
        soilGateThresholdC: Number.isFinite(Number(plant.soil_temp_min_plant_c)) ? Number(plant.soil_temp_min_plant_c) : null, // CHANGED
        soilGateConsecutiveDays: 3,
        startCoolingThresholdC: Number.isFinite(Number(plant.start_cooling_threshold_c)) ? Number(plant.start_cooling_threshold_c) : null, // CHANGED
        useSpringFrostGate: false,
        lastSpringFrostDOY: city.last_spring_frost_p50_doy || city.last_spring_frost_doy || 1, // CHANGED
        daysTransplant: Number(plant.days_transplant || 0),
        overwinterAllowed: plant.overwinter_ok === 1,
        plantMetadata: plant, // ADDED
        cityLatitudeDeg: Number.isFinite(Number(city.latitude)) ? Number(city.latitude) : null, // ADDED
        bedProfile,
        dailyClimate,
        windowOptions
    };
}

function makeDailyClimate(year, defaultMeanC, overrides = {}) { // ADDED
    const days = {}; // ADDED
    for (let d = new Date(`${year}-01-01T00:00:00Z`); d <= new Date(`${year}-12-31T00:00:00Z`); d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1))) { // ADDED
        const iso = d.toISOString().slice(0, 10); // ADDED
        const mean = Number(overrides[iso] ?? defaultMeanC); // ADDED
        days[iso] = Object.freeze({ min: mean - 1, max: mean + 1, mean }); // ADDED
    } // ADDED
    return Object.freeze({ days: Object.freeze(days), diagnostics: Object.freeze({ source: 'test daily climate', forecastBlendDays: 0, missingNormalDays: 0 }) }); // ADDED
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

test('annual latest harvest display date does not cap feasibility', async () => { // ADDED
    const plant = makePlant({ days_maturity: 30, gdd_to_maturity: null, harvest_window_days: 7 }); // ADDED
    const inputs = makeInputs({ plant, city: makeCity(20), startISO: '2026-05-01', seasonEndISO: '2026-05-15' }); // ADDED
    const result = hooks.computeScheduleResult(inputs); // ADDED
    assert.equal(result.rows[0].harvEnd, '2026-06-07'); // ADDED
    const rows = await hooks.explainFeasibilityOverSeason(inputs, 1, false); // ADDED
    const diagnostics = hooks.buildFeasibilityDiagnostics(inputs, rows); // ADDED
    assert.match(diagnostics, /Effective hard end: 2027-12-31 \(lifecycle scan end\)/); // CHANGED
}); // ADDED

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

test('indoor transplant primary date derives sow date for scheduler core', () => { // ADDED
    const sowISO = hooks.sowDateFromPrimaryDate('2026-04-10', 'transplant.indoor', 21); // ADDED
    assert.equal(sowISO, '2026-03-20'); // ADDED
    const plant = makePlant({ days_transplant: 21 }); // ADDED
    const result = hooks.computeScheduleResult(makeInputs({ // ADDED
        plant, // ADDED
        planningMode: 'transplant_indoor', // ADDED
        methodCategoryId: 'transplant', // ADDED
        methodId: 'transplant.indoor', // ADDED
        startISO: sowISO // ADDED
    })); // ADDED
    assert.equal(result.rows[0].sow, '2026-03-20'); // ADDED
    assert.equal(result.rows[0].trans, '2026-04-10'); // ADDED
}); // ADDED

test('cutting transplant primary date uses transplant-date conversion', () => { // ADDED
    const sowISO = hooks.sowDateFromPrimaryDate('2026-04-10', 'transplant.cutting', 21); // ADDED
    assert.equal(sowISO, '2026-03-20'); // ADDED
    assert.equal(hooks.primaryDateFromSowDate(sowISO, 'transplant.cutting', 21), '2026-04-10'); // ADDED
}); // ADDED

test('cell transplant-days override beats plant default for derived sow date', () => { // ADDED
    const cell = makeAttributeCell({ days_transplant: '35' }); // ADDED
    const overrideDays = hooks.readCellTransplantDaysOverride(cell); // ADDED
    const plant = makePlant({ days_transplant: 21 }); // ADDED
    const config = hooks.resolveTransplantDaysConfig(plant, { // ADDED
        methodId: 'transplant.indoor', // ADDED
        overrideEnabled: overrideDays != null, // ADDED
        overrideValue: overrideDays // ADDED
    }); // ADDED
    assert.equal(config.effectiveDays, 35); // ADDED
    assert.equal(hooks.sowDateFromPrimaryDate('2026-04-24', 'transplant.indoor', config.effectiveDays), '2026-03-20'); // ADDED
}); // ADDED

test('schedule patch persists transplant-days only for explicit cell override', () => { // ADDED
    const plant = makePlant({ days_transplant: 21 }); // ADDED
    const inputs = makeInputs({ // ADDED
        plant, // ADDED
        planningMode: 'transplant_indoor', // ADDED
        methodCategoryId: 'transplant', // ADDED
        methodId: 'transplant.indoor', // ADDED
        startISO: '2026-03-20' // ADDED
    }); // ADDED
    const result = hooks.computeScheduleResult(inputs); // ADDED
    const inheritPatch = hooks.buildScheduleAttributePatch(inputs, result, { transplantDaysOverrideEnabled: false }); // ADDED
    assert.equal(inheritPatch.sow_date, '2026-03-20'); // ADDED
    assert.equal(inheritPatch.transplant_date, '2026-04-10'); // ADDED
    assert.equal(inheritPatch.days_transplant, null); // ADDED
    const overridePatch = hooks.buildScheduleAttributePatch(inputs, result, { transplantDaysOverrideEnabled: true, effectiveTransplantDays: 21 }); // ADDED
    assert.equal(overridePatch.days_transplant, '21'); // ADDED
}); // ADDED

test('transplant-date display windows project sowing windows by lead days', () => { // ADDED
    const projected = hooks.projectSowingSeasonForPrimaryDate({ // ADDED
        id: 'spring', // ADDED
        label: 'Spring (Mar 20-Apr 20)', // ADDED
        startISO: '2026-03-20', // ADDED
        endISO: '2026-04-20' // ADDED
    }, 'transplant.indoor', 21); // ADDED
    assert.equal(projected.startISO, '2026-04-10'); // ADDED
    assert.equal(projected.endISO, '2026-05-11'); // ADDED
    assert.match(projected.label, /^Spring \(Apr 10-May 11\)$/); // ADDED
}); // ADDED

test('lifecycle timeline shows annual direct sow and harvest milestones', () => { // ADDED
    const plant = makePlant(); // ADDED
    const result = hooks.computeScheduleResult(makeInputs({ plant })); // ADDED
    const model = hooks.buildLifecycleTimelineViewModel({ // ADDED
        plant, // ADDED
        seasonStartYear: 2026, // ADDED
        startISO: '2026-04-01', // ADDED
        scheduleResult: result, // ADDED
        sowingSeasons: [{ id: 'spring', label: 'Spring', startISO: '2026-03-01', endISO: '2026-05-15' }], // ADDED
        todayISO: '2026-04-15' // ADDED
    }); // ADDED
    assert.equal(model.hidden, false); // ADDED
    assert.deepEqual(Array.from(model.visibleMilestones, m => m.stage), ['SOW', 'HARVEST_START', 'HARVEST_END']); // ADDED
    assert.deepEqual(Array.from(model.visibleMilestones, m => m.abbr), ['S', 'HS', 'HE']); // ADDED
    assert.equal(model.visibleMilestones.find(m => m.stage === 'SOW').iso, '2026-04-01'); // ADDED
    assert.equal(model.visibleMilestones.find(m => m.stage === 'HARVEST_START').iso, '2026-05-01'); // ADDED
    assert.equal(model.visibleMilestones.find(m => m.stage === 'HARVEST_END').iso, '2026-05-08'); // ADDED
    assert.equal(model.visibleMilestones.find(m => m.stage === 'HARVEST_START').tooltip, 'HS - First harvest: 2026-05-01'); // ADDED
}); // ADDED

test('lifecycle timeline includes transplant milestone for transplant schedules', () => { // ADDED
    const plant = makePlant({ days_transplant: 21 }); // ADDED
    const result = hooks.computeScheduleResult(makeInputs({ // ADDED
        plant, // ADDED
        planningMode: 'transplant_indoor', // ADDED
        methodCategoryId: 'transplant', // ADDED
        methodId: 'transplant.indoor' // ADDED
    })); // ADDED
    const model = hooks.buildLifecycleTimelineViewModel({ plant, seasonStartYear: 2026, startISO: '2026-04-01', scheduleResult: result }); // ADDED
    const transplant = model.visibleMilestones.find(m => m.stage === 'TRANSPLANT'); // ADDED
    assert.ok(transplant); // ADDED
    assert.equal(transplant.iso, '2026-04-22'); // ADDED
    assert.equal(transplant.abbr, 'T'); // ADDED
}); // ADDED

test('lifecycle timeline renders all feasible sowing seasons as bands', () => { // ADDED
    const plant = makePlant(); // ADDED
    const model = hooks.buildLifecycleTimelineViewModel({ // ADDED
        plant, // ADDED
        seasonStartYear: 2026, // ADDED
        startISO: '2026-04-01', // ADDED
        scheduleResult: hooks.computeScheduleResult(makeInputs({ plant })), // ADDED
        sowingSeasons: [ // ADDED
            { id: 'spring', label: 'Spring', startISO: '2026-03-01', endISO: '2026-05-15' }, // ADDED
            { id: 'fall', label: 'Fall', startISO: '2026-08-01', endISO: '2026-09-15' } // ADDED
        ] // ADDED
    }); // ADDED
    assert.equal(model.bands.length, 2); // ADDED
    assert.deepEqual(model.bands.map(b => b.id), ['spring', 'fall']); // ADDED
    assert.ok(model.bands.every(b => b.widthPercent > 0)); // ADDED
}); // ADDED

test('lifecycle timeline axis renders quarterly months and year marker for annual range', () => { // ADDED
    const plant = makePlant(); // ADDED
    const model = hooks.buildLifecycleTimelineViewModel({ plant, seasonStartYear: 2026, startISO: '2026-04-01' }); // ADDED
    assert.equal(JSON.stringify(model.axis.months.map(marker => marker.label)), JSON.stringify(['Jan', 'Apr', 'Jul', 'Oct'])); // ADDED
    assert.equal(JSON.stringify(model.axis.years.map(marker => marker.label)), JSON.stringify(['2026'])); // ADDED
    assert.ok(model.axis.months.concat(model.axis.years).every(marker => marker.percent >= 0 && marker.percent <= 100)); // ADDED
}); // ADDED

test('lifecycle timeline axis repeats quarterly months and year markers for multi-year range', () => { // ADDED
    const plant = makePlant({ annual: 0, biennial: 1, lifespan_years: 2 }); // ADDED
    const model = hooks.buildLifecycleTimelineViewModel({ plant, seasonStartYear: 2026, startISO: '2026-04-01' }); // ADDED
    assert.equal(JSON.stringify(model.axis.months.map(marker => marker.label)), JSON.stringify(['Jan', 'Apr', 'Jul', 'Oct', 'Jan', 'Apr', 'Jul', 'Oct'])); // ADDED
    assert.equal(JSON.stringify(model.axis.years.map(marker => marker.label)), JSON.stringify(['2026', '2027'])); // ADDED
    assert.ok(model.axis.months.concat(model.axis.years).every(marker => marker.percent >= 0 && marker.percent <= 100)); // ADDED
}); // ADDED

test('lifecycle timeline axis clips markers to custom bounds', () => { // ADDED
    const bounds = { // ADDED
        start: new Date('2026-03-15T00:00:00Z'), // ADDED
        end: new Date('2026-10-15T00:00:00Z') // ADDED
    }; // ADDED
    const axis = hooks.buildLifecycleTimelineAxisMarkers(bounds, 214); // ADDED
    assert.equal(JSON.stringify(axis.months.map(marker => marker.label)), JSON.stringify(['Apr', 'Jul', 'Oct'])); // ADDED
    assert.equal(JSON.stringify(axis.years.map(marker => marker.label)), JSON.stringify([])); // ADDED
    assert.ok(axis.months.every(marker => marker.percent >= 0 && marker.percent <= 100)); // ADDED
}); // ADDED

test('lifecycle timeline uses full multi-year scan bounds', () => { // ADDED
    const plant = makePlant({ annual: 0, biennial: 1, lifespan_years: 2 }); // ADDED
    const model = hooks.buildLifecycleTimelineViewModel({ plant, seasonStartYear: 2026, startISO: '2026-04-01' }); // ADDED
    assert.equal(model.bounds.startISO, '2026-01-01'); // ADDED
    assert.equal(model.bounds.endISO, '2027-12-31'); // ADDED
    assert.equal(model.bounds.multiYear, true); // ADDED
}); // ADDED

test('lifecycle timeline today marker appears only inside range', () => { // ADDED
    const plant = makePlant(); // ADDED
    const inside = hooks.buildLifecycleTimelineViewModel({ plant, seasonStartYear: 2026, startISO: '2026-04-01', todayISO: '2026-06-01' }); // ADDED
    const outside = hooks.buildLifecycleTimelineViewModel({ plant, seasonStartYear: 2026, startISO: '2026-04-01', todayISO: '2027-01-01' }); // ADDED
    assert.equal(inside.todayISO, '2026-06-01'); // ADDED
    assert.ok(inside.todayPercent > 0); // ADDED
    assert.equal(outside.todayISO, null); // ADDED
    assert.equal(outside.todayPercent, null); // ADDED
}); // ADDED

test('lifecycle timeline hides germination and maturity while retaining marker tooltip text', () => { // CHANGED
    const plant = makePlant(); // ADDED
    const scheduleResult = { // ADDED
        kind: 'annual', // ADDED
        schedule: [new Date('2026-04-01T00:00:00Z')], // ADDED
        timelines: [{ // ADDED
            germ: new Date('2026-04-02T00:00:00Z'), // ADDED
            transplant: new Date('2026-04-03T00:00:00Z'), // ADDED
            maturity: new Date('2026-04-04T00:00:00Z'), // ADDED
            harvestStart: new Date('2026-04-05T00:00:00Z'), // ADDED
            harvestEnd: new Date('2026-04-06T00:00:00Z') // ADDED
        }] // ADDED
    }; // ADDED
    const model = hooks.buildLifecycleTimelineViewModel({ plant, seasonStartYear: 2026, startISO: '2026-04-01', scheduleResult }); // ADDED
    assert.deepEqual(Array.from(model.visibleMilestones, m => m.stage), ['SOW', 'TRANSPLANT', 'HARVEST_START', 'HARVEST_END']); // CHANGED
    assert.deepEqual(Array.from(model.visibleMilestones, m => m.abbr), ['S', 'T', 'HS', 'HE']); // ADDED
    assert.equal(model.milestones.find(m => m.stage === 'GERM').visible, false); // ADDED
    assert.equal(model.milestones.find(m => m.stage === 'MATURITY').visible, false); // ADDED
    assert.equal(Object.prototype.hasOwnProperty.call(model, 'labelRows'), false); // ADDED
    assert.equal(Object.prototype.hasOwnProperty.call(model, 'details'), false); // ADDED
    assert.equal(model.visibleMilestones.find(m => m.stage === 'SOW').tooltip, 'S - Sow: 2026-04-01\nClick to focus sow date.'); // ADDED
}); // CHANGED

test('lifecycle timeline marker layout leaves separated markers unshifted', () => { // ADDED
    const offsets = hooks.layoutLifecycleTimelineMarkerOffsets([{ percent: 10 }, { percent: 30 }], 200, 24); // ADDED
    assert.deepEqual(Array.from(offsets), [0, 0]); // CHANGED
}); // ADDED

test('lifecycle timeline marker layout spaces dense markers deterministically', () => { // ADDED
    const offsets = hooks.layoutLifecycleTimelineMarkerOffsets([{ percent: 50 }, { percent: 55 }], 400, 24); // ADDED
    assert.deepEqual(Array.from(offsets), [-12, 12]); // CHANGED
}); // ADDED

test('lifecycle timeline marker layout falls back to zero offsets without width', () => { // ADDED
    const offsets = hooks.layoutLifecycleTimelineMarkerOffsets([{ percent: 50 }, { percent: 55 }], 0, 24); // ADDED
    assert.deepEqual(Array.from(offsets), [0, 0]); // CHANGED
}); // ADDED

test('lifecycle timeline task association uses start anchors only', () => { // ADDED
    const rules = [ // ADDED
        makeRepeatRule({ id: 'range', startAnchorStage: 'SOW', endMode: 'anchor_range', endAnchorStage: 'HARVEST_START' }), // ADDED
        makeRepeatRule({ id: 'harvest', startAnchorStage: 'HARVEST_START' }) // ADDED
    ]; // ADDED
    const match = hooks.findFirstLifecycleTimelineTaskRule(rules, 'HARVEST_START'); // ADDED
    assert.equal(match.originalIndex, 1); // ADDED
}); // ADDED

test('lifecycle timeline opens first matching task rule by display order', () => { // ADDED
    const rules = [ // ADDED
        makeRepeatRule({ id: 'late', startAnchorStage: 'HARVEST_START' }), // ADDED
        makeRepeatRule({ id: 'early', startAnchorStage: 'HARVEST_START' }) // ADDED
    ]; // ADDED
    const generatedTasks = [ // ADDED
        { previewRuleKey: hooks.getTaskPreviewRuleKey(rules[0], 0), startISO: '2026-05-10' }, // ADDED
        { previewRuleKey: hooks.getTaskPreviewRuleKey(rules[1], 1), startISO: '2026-05-01' } // ADDED
    ]; // ADDED
    const match = hooks.findFirstLifecycleTimelineTaskRule(rules, 'HARVEST_START', generatedTasks); // ADDED
    assert.equal(match.originalIndex, 1); // ADDED
}); // ADDED

test('lifecycle timeline milestone task dot follows generated display order', () => { // ADDED
    const plant = makePlant(); // ADDED
    const rules = [ // ADDED
        makeRepeatRule({ id: 'late', startAnchorStage: 'HARVEST_START' }), // ADDED
        makeRepeatRule({ id: 'early', startAnchorStage: 'HARVEST_START' }) // ADDED
    ]; // ADDED
    const generatedTasks = [ // ADDED
        { previewRuleKey: hooks.getTaskPreviewRuleKey(rules[0], 0), startISO: '2026-05-10' }, // ADDED
        { previewRuleKey: hooks.getTaskPreviewRuleKey(rules[1], 1), startISO: '2026-05-01' } // ADDED
    ]; // ADDED
    const model = hooks.buildLifecycleTimelineViewModel({ // ADDED
        plant, // ADDED
        seasonStartYear: 2026, // ADDED
        startISO: '2026-04-01', // ADDED
        scheduleResult: hooks.computeScheduleResult(makeInputs({ plant })), // ADDED
        taskRules: rules, // ADDED
        generatedTasks // ADDED
    }); // ADDED
    const harvestStart = model.visibleMilestones.find(m => m.stage === 'HARVEST_START'); // ADDED
    assert.equal(harvestStart.hasTaskRule, true); // ADDED
    assert.equal(harvestStart.taskRuleIndex, 1); // ADDED
}); // ADDED

test('indoor transplant gate outside scan end is rejected when annual cross-year harvests are disabled', () => { // CHANGED
    const plant = makePlant({ days_transplant: 20 });
    const policy = new hooks.PolicyFlags({ annualCrossYearHarvestAllowed: false }); // ADDED
    const planner = new hooks.Planner(makeInputs({
        plant,
        planningMode: 'transplant_indoor',
        methodCategoryId: 'transplant',
        methodId: 'transplant.indoor',
        startISO: '2026-12-20',
        seasonEndISO: '2026-12-31',
        policy // ADDED
    }));
    const feasibility = planner.isSowFeasible(new Date('2026-12-20T00:00:00Z'));
    assert.equal(feasibility.ok, false);
    assert.equal(feasibility.reason, 'gate_outside_scan_window');
});

test('indoor transplant gate may validate into next year when annual cross-year harvests are allowed', () => { // ADDED
    const plant = makePlant({ days_transplant: 20 }); // ADDED
    const planner = new hooks.Planner(makeInputs({ // ADDED
        plant, // ADDED
        planningMode: 'transplant_indoor', // ADDED
        methodCategoryId: 'transplant', // ADDED
        methodId: 'transplant.indoor', // ADDED
        startISO: '2026-12-20', // ADDED
        seasonEndISO: '2026-12-31' // ADDED
    })); // ADDED
    const feasibility = planner.isSowFeasible(new Date('2026-12-20T00:00:00Z')); // ADDED
    assert.equal(feasibility.ok, true); // ADDED
    assert.equal(feasibility.maturity.toISOString().slice(0, 10), '2027-01-19'); // CHANGED
    assert.equal(feasibility.harvestEnd.toISOString().slice(0, 10), '2027-01-26'); // ADDED
}); // ADDED

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
}); // FIX

test('bed-aware soil model opens Vancouver sweet corn threshold by early June', () => { // ADDED
    const city = makeVancouverCity(); // ADDED
    const monthly = city.calibratedMonthlyMeans(2026); // ADDED
    const genericReady = hooks.firstSoilReadyDate({ // ADDED
        thresholdC: 16, // ADDED
        monthlyAvgTemp: monthly, // ADDED
        scanStart: new Date('2026-01-01T00:00:00Z'), // ADDED
        scanEndHard: new Date('2026-12-31T00:00:00Z'), // ADDED
        bedProfile: null, // ADDED
        consecutiveDays: 3 // ADDED
    }); // ADDED
    assert.ok(genericReady, 'expected generic garden bed to reach sweet corn soil threshold'); // ADDED
    assert.ok(genericReady >= new Date('2026-05-15T00:00:00Z')); // ADDED
    assert.ok(genericReady <= new Date('2026-06-10T00:00:00Z')); // ADDED
}); // ADDED

test('wet shaded high-frost bed delays soil readiness', () => { // ADDED
    const city = makeVancouverCity(); // ADDED
    const monthly = city.calibratedMonthlyMeans(2026); // ADDED
    const genericReady = hooks.firstSoilReadyDate({ // ADDED
        thresholdC: 16, monthlyAvgTemp: monthly, scanStart: new Date('2026-01-01T00:00:00Z'), scanEndHard: new Date('2026-12-31T00:00:00Z') // ADDED
    }); // ADDED
    const coldBedReady = hooks.firstSoilReadyDate({ // ADDED
        thresholdC: 16, // ADDED
        monthlyAvgTemp: monthly, // ADDED
        scanStart: new Date('2026-01-01T00:00:00Z'), // ADDED
        scanEndHard: new Date('2026-12-31T00:00:00Z'), // ADDED
        bedProfile: { sunExposure: 'shade', soilMoisture: 'wet', drainage: 'slow', soilTexture: 'clay', windExposure: 'exposed', frostRisk: 'high' } // ADDED
    }); // ADDED
    assert.ok(genericReady); // ADDED
    assert.ok(coldBedReady === null || coldBedReady > genericReady); // ADDED
}); // ADDED

test('annual GDD calibration matches stored city base GDD and recomputes crop-base heat', () => { // ADDED
    const city = makeVancouverCity(); // ADDED
    const calibration = city.gddCalibration(2026); // ADDED
    assert.equal(calibration.usable, true); // ADDED
    assert.ok(Math.abs(calibration.calibratedGdd - 1550) < 0.5); // ADDED
    assert.notEqual(Math.round(calibration.uncalibratedGdd), Math.round(calibration.calibratedGdd)); // ADDED
    const cropBaseGdd = hooks.annualGddFromMonthlyMeans(city.calibratedMonthlyMeans(2026), 10, 2026); // ADDED
    assert.ok(cropBaseGdd > 0); // ADDED
    assert.ok(cropBaseGdd < calibration.calibratedGdd); // ADDED
}); // ADDED

test('daily climate curves interpolate monthly normals and blend near-term forecasts', () => { // ADDED
    const shared = hooks.sharedCore; // ADDED
    const climate = shared.buildDailyTemperatureSeries({ // ADDED
        startDate: new Date('2026-01-01T00:00:00Z'), // ADDED
        endDate: new Date('2026-02-28T00:00:00Z'), // ADDED
        monthlyNormals: { // ADDED
            1: { min: 0, max: 10, mean: 5 }, // ADDED
            2: { min: 10, max: 20, mean: 15 }, // ADDED
            12: { min: -5, max: 5, mean: 0 } // ADDED
        }, // ADDED
        forecastRows: [{ forecast_date: '2026-01-02', temp_min_c: 20, temp_max_c: 30, temp_mean_c: 25, run_timestamp: '2026-01-01T00:00:00Z' }], // ADDED
        todayISO: '2026-01-01', // ADDED
        source: 'test normals' // ADDED
    }); // ADDED
    assert.ok(climate.days['2026-01-15'].mean > 4.5 && climate.days['2026-01-15'].mean < 5.5); // ADDED
    assert.ok(climate.days['2026-01-31'].mean > climate.days['2026-01-15'].mean); // ADDED
    assert.equal(climate.days['2026-01-02'].forecastWeight, 0.8); // ADDED
    assert.ok(climate.days['2026-01-02'].mean > 15); // ADDED
    assert.equal(climate.diagnostics.forecastBlendDays, 1); // ADDED
}); // ADDED

test('single-sine GDD respects crop upper cap', () => { // ADDED
    const shared = hooks.sharedCore; // ADDED
    const hotDay = { min: 20, max: 40, mean: 30 }; // ADDED
    const uncapped = shared.singleSineDailyGdd(hotDay, 10, null); // ADDED
    const capped = shared.singleSineDailyGdd(hotDay, 10, 30); // ADDED
    assert.ok(uncapped > capped); // ADDED
    assert.ok(capped > 0); // ADDED
}); // ADDED

test('daily GDD calibration scales GDD rates without changing climate temperatures', () => { // ADDED
    const shared = hooks.sharedCore; // ADDED
    const climate = shared.buildDailyTemperatureSeries({ // ADDED
        startDate: new Date('2026-01-01T00:00:00Z'), // ADDED
        endDate: new Date('2026-12-31T00:00:00Z'), // ADDED
        monthlyNormals: Object.fromEntries(Array.from({ length: 12 }, (_, i) => [i + 1, { min: 10, max: 20, mean: 15 }])), // ADDED
        source: 'constant test normals' // ADDED
    }); // ADDED
    const before = climate.days['2026-06-01'].mean; // ADDED
    const rates = shared.buildDailyGddMap({ // ADDED
        dailyClimate: climate, // ADDED
        cropTemp: { Tbase: 5, Tmax: 35 }, // ADDED
        bedProfile: null, // ADDED
        city: { gdd_annual: 1000, gdd_base_c: 5 }, // ADDED
        year: 2026 // ADDED
    }); // ADDED
    assert.equal(climate.days['2026-06-01'].mean, before); // ADDED
    assert.ok(rates.__diagnostics.gddScale > 0); // ADDED
    assert.ok(Math.abs(rates.__diagnostics.cityBaseAnnualGdd * rates.__diagnostics.gddScale - 1000) < 0.5); // ADDED
}); // ADDED

test('bed frost risk shifts frost gate independently from soil temperature', () => { // ADDED
    const shared = hooks.sharedCore; // ADDED
    assert.equal(shared.bedFrostGateShiftDays({ frostRisk: 'none' }), -3); // ADDED
    assert.equal(shared.bedFrostGateShiftDays({ frostRisk: 'low' }), 0); // ADDED
    assert.equal(shared.bedFrostGateShiftDays({ frostRisk: 'medium' }), 5); // ADDED
    assert.equal(shared.bedFrostGateShiftDays({ frostRisk: 'high' }), 10); // ADDED
}); // ADDED

test('corn-like annual December sowing is blocked when daily lows exceed cold-survival tolerance', () => { // CHANGED
    const plant = makePlant({ plant_name: 'Sweet Corn', days_maturity: 30, tmin_c: 10, killtemp_c: null, tmax_c: 40, overwinter_ok: 0 }); // CHANGED
    const city = makeSeasonalCity({ 1: -5, 2: -3, 3: 8, 4: 12, 5: 18, 6: 24, 7: 26, 8: 24, 9: 18, 10: 10, 11: 5, 12: 4 }); // ADDED
    const planner = new hooks.Planner(makeInputs({ plant, city, startISO: '2026-12-15' })); // CHANGED
    const feasibility = planner.isSowFeasible(new Date('2026-12-15T00:00:00Z')); // CHANGED
    assert.equal(feasibility.ok, false); // CHANGED
    assert.match(feasibility.reason, /^cold_survival_temp/); // CHANGED
}); // ADDED

test('explicit kill temperature can be stricter than the estimated tolerance', () => { // ADDED
    const plant = makePlant({ days_maturity: 5, tmin_c: 0, killtemp_c: 5, tmax_c: 40, overwinter_ok: 0 }); // ADDED
    const planner = new hooks.Planner(makeInputs({ plant, city: makeCity(6), startISO: '2026-04-01' })); // ADDED
    const feasibility = planner.isSowFeasible(new Date('2026-04-01T00:00:00Z')); // ADDED
    assert.equal(feasibility.ok, false); // ADDED
    assert.match(feasibility.reason, /^cold_survival_temp\(min 4\.\d<5\.0\)/); // CHANGED
}); // ADDED

test('explicit kill temperature can be hardier than the tmin estimate', () => { // ADDED
    const plant = makePlant({ days_maturity: 5, tmin_c: 5, killtemp_c: -10, tmax_c: 40, overwinter_ok: 0 }); // ADDED
    const dailyClimate = { days: { '2026-04-01': { min: 1, max: 9, mean: 5 }, '2026-04-02': { min: 1, max: 9, mean: 5 }, '2026-04-03': { min: 1, max: 9, mean: 5 }, '2026-04-04': { min: 1, max: 9, mean: 5 }, '2026-04-05': { min: 1, max: 9, mean: 5 }, '2026-04-06': { min: 1, max: 9, mean: 5 } }, diagnostics: {} }; // CHANGED
    const planner = new hooks.Planner(makeInputs({ plant, city: makeCity(5), startISO: '2026-04-01', dailyClimate })); // ADDED
    const feasibility = planner.isSowFeasible(new Date('2026-04-01T00:00:00Z')); // ADDED
    assert.equal(feasibility.ok, true); // ADDED
}); // ADDED

test('tropical open-bed annuals allow cross-year harvests when climate gates pass', () => { // ADDED
    const plant = makePlant({ days_maturity: 20, tmin_c: 12, killtemp_c: 18, tmax_c: 40, overwinter_ok: 0 }); // CHANGED
    const planner = new hooks.Planner(makeInputs({ plant, city: makeCity(26), startISO: '2026-12-20' })); // ADDED
    const feasibility = planner.isSowFeasible(new Date('2026-12-20T00:00:00Z')); // ADDED
    assert.equal(feasibility.ok, true); // ADDED
    assert.equal(feasibility.harvestEnd.toISOString().slice(0, 10), '2027-01-16'); // ADDED
}); // ADDED

test('cold open-bed annual harvests are rejected by cold-survival gates', () => { // CHANGED
    const plant = makePlant({ days_maturity: 5, tmin_c: 3, killtemp_c: null, tmax_c: 40, overwinter_ok: 0 }); // CHANGED
    const planner = new hooks.Planner(makeInputs({ plant, city: makeCity(-5), startISO: '2026-12-15' })); // ADDED
    const feasibility = planner.isSowFeasible(new Date('2026-12-15T00:00:00Z')); // ADDED
    assert.equal(feasibility.ok, false); // ADDED
    assert.match(feasibility.reason, /^cold_survival_temp/); // CHANGED
}); // ADDED

test('heated greenhouse bed effects can rescue a cold cross-year annual harvest', () => { // ADDED
    const plant = makePlant({ days_maturity: 5, tmin_c: 3, killtemp_c: null, tmax_c: 40, overwinter_ok: 0 }); // CHANGED
    const bedProfile = { seasonExtension: 'heated_greenhouse' }; // ADDED
    const planner = new hooks.Planner(makeInputs({ plant, city: makeCity(-5), startISO: '2026-12-15', bedProfile })); // ADDED
    const feasibility = planner.isSowFeasible(new Date('2026-12-15T00:00:00Z')); // ADDED
    assert.equal(feasibility.ok, true); // ADDED
    assert.equal(feasibility.harvestEnd.toISOString().slice(0, 10), '2026-12-27'); // ADDED
}); // ADDED

test('missing kill temperature uses the tmin minus three estimate', () => { // CHANGED
    const plant = makePlant({ days_maturity: 5, tmin_c: 3, killtemp_c: null, tmax_c: 40, overwinter_ok: 0 }); // CHANGED
    const planner = new hooks.Planner(makeInputs({ plant, city: makeCity(-2), startISO: '2026-12-15' })); // ADDED
    const feasibility = planner.isSowFeasible(new Date('2026-12-15T00:00:00Z')); // ADDED
    assert.equal(feasibility.ok, false); // ADDED
    assert.match(feasibility.reason, /^cold_survival_temp\(min -[0-9.]+<0\.0\)/); // CHANGED
}); // ADDED

test('missing kill temperature and tmin use zero celsius fallback', () => { // ADDED
    const plant = makePlant({ days_maturity: 5, tmin_c: null, killtemp_c: null, tmax_c: 40, overwinter_ok: 0 }); // ADDED
    const planner = new hooks.Planner(makeInputs({ plant, city: makeCity(-2), startISO: '2026-12-15' })); // ADDED
    const feasibility = planner.isSowFeasible(new Date('2026-12-15T00:00:00Z')); // ADDED
    assert.equal(feasibility.ok, false); // ADDED
    assert.match(feasibility.reason, /^cold_survival_temp\(min -[0-9.]+<0\.0\)/); // ADDED
}); // ADDED

test('cold shoulder-season daily lows block annual survival outside winter months', () => { // ADDED
    const plant = makePlant({ days_maturity: 5, tmin_c: 0, killtemp_c: 0, tmax_c: 40, overwinter_ok: 0 }); // ADDED
    const planner = new hooks.Planner(makeInputs({ plant, city: makeCity(-2), startISO: '2026-03-15' })); // ADDED
    const feasibility = planner.isSowFeasible(new Date('2026-03-15T00:00:00Z')); // ADDED
    assert.equal(feasibility.ok, false); // ADDED
    assert.match(feasibility.reason, /^cold_survival_temp/); // ADDED
}); // ADDED

test('Langley-like sweet corn reports insufficient GDD before lethal cold instead of winter survival', () => { // ADDED
    const plant = makePlant({ plant_name: 'Sweet Corn', days_maturity: 78, gdd_to_maturity: 1250, tbase_c: 10, tmin_c: 0, killtemp_c: null, tmax_c: 38, soil_temp_min_plant_c: 16 }); // ADDED
    const policy = new hooks.PolicyFlags({ useSpringFrostGate: false, useSoilTempGate: true, soilGateThresholdC: 16, soilGateConsecutiveDays: 3 }); // ADDED
    const planner = new hooks.Planner(makeInputs({ plant, city: makeLangleyColdCity(), startISO: '2026-01-01', policy })); // ADDED
    const feasibility = planner.isSowFeasible(new Date('2026-04-29T00:00:00Z')); // ADDED
    assert.equal(feasibility.ok, false); // ADDED
    assert.match(feasibility.reason, /^insufficient_gdd_before_cold\(gdd [0-9.]+<1250\.0 deadline 2026-11-/); // ADDED
}); // ADDED

test('Langley-like before-cold diagnostics summarize usable GDD instead of annual estimate', async () => { // ADDED
    const plant = makePlant({ plant_name: 'Sweet Corn', days_maturity: 78, gdd_to_maturity: 1250, tbase_c: 10, tmin_c: 0, killtemp_c: null, tmax_c: 38, soil_temp_min_plant_c: 16 }); // ADDED
    const policy = new hooks.PolicyFlags({ useSpringFrostGate: false, useSoilTempGate: true, soilGateThresholdC: 16, soilGateConsecutiveDays: 3 }); // ADDED
    const inputs = makeInputs({ plant, city: makeLangleyColdCity(), startISO: '', policy }); // ADDED
    const rows = await hooks.explainFeasibilityOverSeason(inputs, 400, false); // ADDED
    const summary = hooks.buildFeasibilityBlockingSummary(inputs, rows); // ADDED
    assert.match(summary, /Primary blocker after frost\/soil readiness: insufficient_gdd_before_cold/); // ADDED
    assert.match(summary, /GDD check: best usable GDD [0-9.]+<1250\.0 before 2026-11-/); // ADDED
    assert.doesNotMatch(summary, /calibrated crop-base estimate/); // ADDED
}); // ADDED

test('annual GDD crop remains feasible when maturity and harvest finish before lethal cold', () => { // ADDED
    const plant = makePlant({ days_maturity: null, gdd_to_maturity: 100, tbase_c: 5, tmin_c: 0, killtemp_c: 0, tmax_c: 40, harvest_window_days: 7 }); // ADDED
    const dailyClimate = makeDailyClimateRange('2026-04-01', '2026-04-30', { min: 10, max: 30, mean: 20 }, { '2026-04-20': { min: -1, max: 9, mean: 4 } }); // CHANGED
    const planner = new hooks.Planner(makeInputs({ plant, city: makeCity(20), startISO: '2026-04-01', dailyClimate })); // ADDED
    const feasibility = planner.isSowFeasible(new Date('2026-04-01T00:00:00Z')); // ADDED
    assert.equal(feasibility.ok, true); // ADDED
    assert.equal(feasibility.harvestEnd.toISOString().slice(0, 10), '2026-04-14'); // CHANGED
}); // ADDED

test('annual crop reports cold survival when harvest window overlaps lethal cold', () => { // CHANGED
    const plant = makePlant({ days_maturity: 5, gdd_to_maturity: null, tbase_c: 5, tmin_c: 0, killtemp_c: 0, tmax_c: 40, harvest_window_days: 7 }); // CHANGED
    const dailyClimate = makeDailyClimateRange('2026-04-01', '2026-04-30', { min: 10, max: 30, mean: 20 }, { '2026-04-09': { min: -1, max: 9, mean: 4 } }); // CHANGED
    const planner = new hooks.Planner(makeInputs({ plant, city: makeCity(20), startISO: '2026-04-01', dailyClimate })); // ADDED
    const feasibility = planner.isSowFeasible(new Date('2026-04-01T00:00:00Z')); // ADDED
    assert.equal(feasibility.ok, false); // ADDED
    assert.match(feasibility.reason, /^cold_survival_temp/); // ADDED
}); // ADDED

test('explicit kill temperature changes the cold GDD deadline', () => { // ADDED
    const plant = makePlant({ days_maturity: null, gdd_to_maturity: 500, tbase_c: 5, tmin_c: 0, killtemp_c: -5, tmax_c: 40, harvest_window_days: 7 }); // ADDED
    const planner = new hooks.Planner(makeInputs({ plant, city: makeLangleyColdCity(), startISO: '2026-04-29' })); // ADDED
    const feasibility = planner.isSowFeasible(new Date('2026-04-29T00:00:00Z')); // ADDED
    assert.equal(feasibility.ok, true); // ADDED
    assert.ok(feasibility.harvestEnd <= new Date('2026-11-28T00:00:00Z'), feasibility.harvestEnd.toISOString()); // ADDED
}); // ADDED

test('heated greenhouse can push lethal cold deadline later and rescue GDD maturity', () => { // ADDED
    const plant = makePlant({ days_maturity: null, gdd_to_maturity: 1150, tbase_c: 10, tmin_c: 0, killtemp_c: 0, tmax_c: 40, harvest_window_days: 7 }); // ADDED
    const open = new hooks.Planner(makeInputs({ plant, city: makeLangleyColdCity(), startISO: '2026-04-29' })).isSowFeasible(new Date('2026-04-29T00:00:00Z')); // ADDED
    const protectedBed = { seasonExtension: 'heated_greenhouse' }; // ADDED
    const protectedResult = new hooks.Planner(makeInputs({ plant, city: makeLangleyColdCity(), startISO: '2026-04-29', bedProfile: protectedBed })).isSowFeasible(new Date('2026-04-29T00:00:00Z')); // ADDED
    assert.match(open.reason, /^insufficient_gdd_before_cold/); // ADDED
    assert.equal(protectedResult.ok, true); // ADDED
}); // ADDED

test('season extension override values take precedence over preset defaults', () => { // ADDED
    const shared = hooks.sharedCore; // ADDED
    const effects = shared.seasonExtensionEffects({ // ADDED
        seasonExtension: 'heated_greenhouse', // ADDED
        seasonExtensionAirOffsetC: 1.25, // ADDED
        seasonExtensionSoilOffsetC: 2.5, // ADDED
        seasonExtensionFrostShiftDays: -12, // ADDED
        seasonExtensionMinAirTempC: 4 // ADDED
    }); // ADDED
    assert.equal(effects.airOffsetC, 1.25); // ADDED
    assert.equal(effects.soilOffsetC, 2.5); // ADDED
    assert.equal(effects.frostShiftDays, -12); // ADDED
    assert.equal(effects.minAirTempC, 4); // ADDED
}); // ADDED

test('annual cross-year policy disables cross-year harvests even with overwinter metadata', () => { // CHANGED
    const plant = makePlant({ days_maturity: 30, overwinter_ok: 1 }); // ADDED
    const blockedPolicy = new hooks.PolicyFlags({ annualCrossYearHarvestAllowed: false, overwinterAllowed: true }); // CHANGED
    const allowedPolicy = new hooks.PolicyFlags({ annualCrossYearHarvestAllowed: true, overwinterAllowed: true }); // CHANGED
    const blocked = new hooks.Planner(makeInputs({ plant, city: makeCity(20), startISO: '2026-12-15', policy: blockedPolicy })).isSowFeasible(new Date('2026-12-15T00:00:00Z')); // ADDED
    const allowed = new hooks.Planner(makeInputs({ plant, city: makeCity(20), startISO: '2026-12-15', policy: allowedPolicy })).isSowFeasible(new Date('2026-12-15T00:00:00Z')); // ADDED
    assert.equal(blocked.ok, false); // ADDED
    assert.equal(blocked.reason, 'cross_year_disallowed'); // ADDED
    assert.equal(allowed.ok, true); // ADDED
}); // ADDED

test('strict GDD maturity remains infeasible when target exceeds calibrated cross-year scan heat', () => { // CHANGED
    const city = makeVancouverCity(); // ADDED
    const plant = makePlant({ // ADDED
        plant_name: 'Sweet Corn', // ADDED
        days_maturity: 78, // ADDED
        gdd_to_maturity: 4000, // CHANGED
        tbase_c: 10, // ADDED
        tmin_c: 8, // ADDED
        topt_low_c: 18, // ADDED
        topt_high_c: 30, // ADDED
        tmax_c: 35, // ADDED
        soil_temp_min_plant_c: null // ADDED
    }); // ADDED
    const planner = new hooks.Planner(makeInputs({ plant, city, startISO: '2026-06-01' })); // ADDED
    const result = planner.isSowFeasible(new Date('2026-06-01T00:00:00Z')); // ADDED
    assert.equal(result.ok, false); // ADDED
    assert.equal(result.reason, 'insufficient_gdd'); // ADDED
}); // ADDED

test('warning-tolerant annual schedule uses DTM when GDD is short', () => { // ADDED
    const plant = makePlant({ gdd_to_maturity: 10000, days_maturity: 42, tbase_c: 5 }); // ADDED
    const inputs = makeInputs({ plant, city: makeCity(20), startISO: '2026-04-01' }); // ADDED
    assert.throws(() => hooks.annualCore.computeAnnualScheduleResult(inputs), /growing-degree accumulation/); // ADDED
    const result = hooks.computeScheduleResult(inputs); // ADDED
    assert.equal(result.rows[0].harvStart, '2026-05-13'); // ADDED
    assert.ok(result.warnings.some(warning => warning.type === 'insufficient_gdd_dtm_fallback')); // ADDED
}); // ADDED

test('warning-tolerant annual schedule scales GDD only within cap', () => { // ADDED
    const city = makeCity(10); // ADDED
    city.first_fall_frost_doy = 300; // ADDED
    const plant = makePlant({ days_maturity: null, gdd_to_maturity: 2200, tbase_c: 5, tmin_c: 0, tmax_c: 40 }); // ADDED
    const policy = new hooks.PolicyFlags({ annualCrossYearHarvestAllowed: false }); // ADDED
    const inputs = makeInputs({ plant, city, startISO: '2026-01-01', policy }); // CHANGED
    assert.throws(() => hooks.annualCore.computeAnnualScheduleResult(inputs), /growing-degree accumulation/); // ADDED
    const result = hooks.computeScheduleResult(inputs); // ADDED
    const warning = result.warnings.find(item => item.type === 'insufficient_gdd_scaled_fallback'); // ADDED
    assert.ok(warning, JSON.stringify(result.warnings)); // ADDED
    assert.ok(warning.scaleFactor > 1 && warning.scaleFactor <= 2, JSON.stringify(warning)); // ADDED
    assert.match(warning.message, /scaled GDD/); // ADDED
}); // ADDED

test('warning-tolerant annual schedule scales GDD before lethal cold when within cap', () => { // ADDED
    const city = makeCity(20); // CHANGED
    const plant = makePlant({ days_maturity: 90, gdd_to_maturity: 640, tbase_c: 10, tmin_c: -20, killtemp_c: -10, tmax_c: 40, harvest_window_days: 7 }); // CHANGED
    const dailyClimate = makeDailyClimateRange('2026-09-01', '2026-12-15', { min: 10, max: 30, mean: 20 }, { // ADDED
        ...Object.fromEntries(Array.from({ length: 30 }, (_, index) => [`2026-11-${String(index + 1).padStart(2, '0')}`, { min: -9, max: -1, mean: -5 }])), // CHANGED
        ...Object.fromEntries(Array.from({ length: 15 }, (_, index) => [`2026-12-${String(index + 1).padStart(2, '0')}`, { min: -11, max: -1, mean: -6 }])) // CHANGED
    }); // ADDED
    const inputs = makeInputs({ plant, city, startISO: '2026-09-01', dailyClimate }); // CHANGED
    assert.throws(() => hooks.annualCore.computeAnnualScheduleResult(inputs), /before lethal cold/); // ADDED
    const result = hooks.computeScheduleResult(inputs); // ADDED
    const warning = result.warnings.find(item => item.type === 'insufficient_gdd_before_cold_scaled_fallback'); // ADDED
    assert.ok(warning, JSON.stringify(result.warnings)); // ADDED
    assert.ok(warning.scaleFactor > 1 && warning.scaleFactor <= 2, JSON.stringify(warning)); // ADDED
    assert.equal(result.rows[0].harvEnd, '2026-11-07'); // ADDED
}); // ADDED

test('warning-tolerant annual schedule blocks GDD scaling above cap or without heat', () => { // ADDED
    const scaledCity = makeCity(10); // ADDED
    scaledCity.first_fall_frost_doy = 300; // ADDED
    const tooHigh = makePlant({ days_maturity: null, gdd_to_maturity: 4000, tbase_c: 5, tmin_c: 0, tmax_c: 40 }); // ADDED
    assert.throws(() => hooks.computeScheduleResult(makeInputs({ plant: tooHigh, city: scaledCity, startISO: '2026-01-01' })), /insufficient gdd scale cap/); // CHANGED
    const noHeat = makePlant({ days_maturity: null, gdd_to_maturity: 100, tbase_c: 50, tmin_c: 0, tmax_c: 60 }); // CHANGED
    assert.throws(() => hooks.computeScheduleResult(makeInputs({ plant: noHeat, city: makeCity(4), startISO: '2026-01-01' })), /insufficient gdd no heat/); // CHANGED
}); // ADDED

test('warning-tolerant annual schedule fails when before-cold scaling exceeds cap', () => { // ADDED
    const city = makeCity(20); // CHANGED
    const plant = makePlant({ days_maturity: 90, gdd_to_maturity: 2000, tbase_c: 10, tmin_c: -20, killtemp_c: -10, tmax_c: 40, harvest_window_days: 7 }); // CHANGED
    const dailyClimate = makeDailyClimateRange('2026-09-01', '2026-12-15', { min: 10, max: 30, mean: 20 }, { // ADDED
        ...Object.fromEntries(Array.from({ length: 30 }, (_, index) => [`2026-11-${String(index + 1).padStart(2, '0')}`, { min: -9, max: -1, mean: -5 }])), // CHANGED
        ...Object.fromEntries(Array.from({ length: 15 }, (_, index) => [`2026-12-${String(index + 1).padStart(2, '0')}`, { min: -11, max: -1, mean: -6 }])) // CHANGED
    }); // ADDED
    const planner = new hooks.Planner(makeInputs({ plant, city, startISO: '2026-09-01', dailyClimate })); // ADDED
    const feasibility = hooks.annualCore.assessSowDateForSchedule(planner, new Date('2026-09-01T00:00:00Z'), { allowThermalWarnings: true }); // ADDED
    assert.match(feasibility.reason, /^insufficient_gdd_before_cold_scale_cap/); // ADDED
    assert.throws(() => hooks.computeScheduleResult(makeInputs({ plant, city, startISO: '2026-09-01', dailyClimate })), /before lethal cold/); // CHANGED
}); // ADDED

test('warning-tolerant annual schedule reports no heat before lethal cold', () => { // ADDED
    const city = makeCity(0); // ADDED
    const plant = makePlant({ days_maturity: 90, gdd_to_maturity: 100, tbase_c: 10, tmin_c: -20, killtemp_c: -10, tmax_c: 40, harvest_window_days: 7 }); // ADDED
    const dailyClimate = makeDailyClimateRange('2026-09-01', '2026-12-15', { min: -9, max: -1, mean: -5 }, { // ADDED
        ...Object.fromEntries(Array.from({ length: 15 }, (_, index) => [`2026-12-${String(index + 1).padStart(2, '0')}`, { min: -11, max: -1, mean: -6 }])) // ADDED
    }); // ADDED
    const planner = new hooks.Planner(makeInputs({ plant, city, startISO: '2026-09-01', dailyClimate })); // ADDED
    const feasibility = hooks.annualCore.assessSowDateForSchedule(planner, new Date('2026-09-01T00:00:00Z'), { allowThermalWarnings: true }); // ADDED
    assert.match(feasibility.reason, /^insufficient_gdd_before_cold_no_heat/); // ADDED
}); // ADDED

test('thermal harvest and yield issues are warnings for selected-date schedules', () => { // ADDED
    const cold = hooks.computeScheduleResult(makeInputs({ plant: makePlant({ tmin_c: 0, killtemp_c: -10, tmax_c: 40 }), city: makeCity(-5), startISO: '2026-03-01' })); // CHANGED
    assert.ok(cold.warnings.some(warning => warning.type === 'harvest_too_cold'), JSON.stringify(cold.warnings)); // ADDED
    const hot = hooks.computeScheduleResult(makeInputs({ plant: makePlant({ tmin_c: 0, tmax_c: 40 }), city: makeCity(50), startISO: '2026-01-01' })); // ADDED
    assert.ok(hot.warnings.some(warning => warning.type === 'harvest_too_hot'), JSON.stringify(hot.warnings)); // ADDED
    const lowYieldPlant = makePlant({ tmin_c: 0, topt_low_c: 15, topt_high_c: 20, tmax_c: 40 }); // ADDED
    const lowYield = hooks.computeScheduleResult(makeInputs({ plant: lowYieldPlant, city: makeCity(39), startISO: '2026-01-01', minYieldMultiplier: 0.5 })); // ADDED
    assert.ok(lowYield.warnings.some(warning => warning.type === 'yield_multiplier_below_minimum'), JSON.stringify(lowYield.warnings)); // ADDED
}); // ADDED

test('warning-tolerant annual schedule still blocks non-thermal gates', () => { // ADDED
    assert.throws(() => hooks.computeScheduleResult(makeInputs({ startISO: '2027-01-01' })), /outside the planning season/); // CHANGED
    const frostCity = makeCity(20); // ADDED
    frostCity.last_spring_frost_doy = 100; // ADDED
    const frostPolicy = new hooks.PolicyFlags({ useSpringFrostGate: true, useSoilTempGate: false }); // ADDED
    assert.throws(() => hooks.computeScheduleResult(makeInputs({ city: frostCity, startISO: '2026-01-15', policy: frostPolicy })), /frost-safety date/); // CHANGED
    const soilPlant = makePlant({ soil_temp_min_plant_c: 30 }); // ADDED
    const soilPolicy = new hooks.PolicyFlags({ useSpringFrostGate: false, useSoilTempGate: true, soilGateThresholdC: 30, soilGateConsecutiveDays: 3 }); // ADDED
    assert.throws(() => hooks.computeScheduleResult(makeInputs({ plant: soilPlant, city: makeCity(10), startISO: '2026-05-01', policy: soilPolicy })), /soil is expected to be too cold/); // CHANGED
    const seasonalCity = makeSeasonalCity({ 1: 20, 2: 20, 3: 20, 4: 20, 5: 20, 6: 20, 7: 20, 8: 20, 9: 20, 10: 10, 11: 8, 12: 6 }); // ADDED
    const coolingPlant = makePlant({ overwinter_ok: 1, start_cooling_threshold_c: 12, days_maturity: 120 }); // ADDED
    assert.throws(() => hooks.computeScheduleResult(makeInputs({ plant: coolingPlant, city: seasonalCity, startISO: '2026-04-01' })), /seasonal cooling trigger/); // CHANGED
}); // ADDED

test('feasibility diagnostics include soil, bed, calibration, and failing gate summary', async () => { // ADDED
    const city = makeVancouverCity(); // ADDED
    const plant = makePlant({ plant_name: 'Sweet Corn', gdd_to_maturity: 1250, days_maturity: 78, tbase_c: 10, soil_temp_min_plant_c: 16 }); // ADDED
    const policy = new hooks.PolicyFlags({ useSpringFrostGate: false, useSoilTempGate: true, soilGateThresholdC: 16, soilGateConsecutiveDays: 3 }); // ADDED
    const inputs = new hooks.ScheduleInputs({ // ADDED
        plant, city, planningMode: 'direct_sow', methodCategoryId: 'direct_sow', methodId: 'direct_sow.field', // ADDED
        startISO: '2026-01-01', seasonEndISO: '2026-12-31', policy, seasonStartYear: 2026, harvestWindowDays: 7, // ADDED
        bedProfile: { sunExposure: 'full_sun', soilMoisture: 'moderate', drainage: 'normal', soilTexture: 'loamy', windExposure: 'moderate', frostRisk: 'low' }, // ADDED
        bedProfileSource: 'garden bed bed1' // ADDED
    }); // ADDED
    const rows = await hooks.explainFeasibilityOverSeason(inputs, 220, false); // ADDED
    const text = hooks.buildFeasibilityDiagnostics(inputs, rows); // ADDED
    assert.match(text, /Soil threshold: 16\.0 C/); // ADDED
    assert.match(text, /Bed model: garden bed bed1/); // ADDED
    assert.match(text, /Temperature calibration offset:/); // ADDED
    assert.match(text, /Crop-base annual GDD estimate:/); // ADDED
    assert.match(text, /First failing gate:/); // ADDED
}); // ADDED

test('explain sowing range scans full scheduler span even with blank selected start', async () => { // ADDED
    const city = makeVancouverCity(); // ADDED
    const plant = makePlant({ plant_name: 'Sweet Corn', gdd_to_maturity: 1250, tbase_c: 10, soil_temp_min_plant_c: 16 }); // ADDED
    const inputs = makeInputs({ // ADDED
        plant, // ADDED
        city, // ADDED
        startISO: '', // ADDED
        seasonEndISO: '2026-12-31', // ADDED
        harvestWindowDays: 7 // ADDED
    }); // ADDED
    const rows = await hooks.explainFeasibilityOverSeason(inputs, 400, false); // ADDED
    const text = hooks.buildFeasibilityDiagnostics(inputs, rows); // ADDED
    assert.equal(rows.length, 365); // ADDED
    assert.equal(rows[0].date, '2026-01-01'); // ADDED
    assert.equal(rows[rows.length - 1].date, '2026-12-31'); // ADDED
    assert.match(text, /Scan range: 2026-01-01 to 2026-12-31, 365 days/); // ADDED
    assert.doesNotMatch(text, /scan_not_run/); // ADDED
}); // ADDED

test('feasibility scan ranges compress soil gate and insufficient GDD failures', async () => { // ADDED
    const city = makeVancouverCity(); // ADDED
    const plant = makePlant({ plant_name: 'Sweet Corn', gdd_to_maturity: 1250, tbase_c: 10, soil_temp_min_plant_c: 16 }); // ADDED
    const policy = new hooks.PolicyFlags({ useSpringFrostGate: false, useSoilTempGate: true, soilGateThresholdC: 16, soilGateConsecutiveDays: 3 }); // ADDED
    const inputs = makeInputs({ plant, city, startISO: '', policy, harvestWindowDays: 7 }); // ADDED
    const rows = await hooks.explainFeasibilityOverSeason(inputs, 400, false); // ADDED
    const ranges = hooks.compressFeasibilityScanRanges(rows); // ADDED
    const formatted = hooks.formatFeasibilityScanRanges(rows); // ADDED
    assert.ok(ranges.length < rows.length); // ADDED
    assert.equal(ranges[0].start, '2026-01-01'); // ADDED
    assert.equal(ranges[0].reason, 'soil_gate'); // ADDED
    assert.ok(ranges.some(range => range.reason === 'insufficient_gdd')); // ADDED
    assert.match(formatted, /soil_gate/); // ADDED
    assert.match(formatted, /insufficient_gdd/); // ADDED
    assert.doesNotMatch(formatted, /^\{"/m); // ADDED
}); // ADDED

test('feasibility scan ranges normalize parameterized frost reasons', async () => { // ADDED
    const city = makeVancouverCity({ last_spring_frost_p50_doy: 105, last_spring_frost_doy: 105 }); // ADDED
    const plant = makePlant({ plant_name: 'Sweet Corn', gdd_to_maturity: 1250, tbase_c: 10, soil_temp_min_plant_c: 16 }); // ADDED
    const policy = new hooks.PolicyFlags({ useSpringFrostGate: true, useSoilTempGate: true, soilGateThresholdC: 16, soilGateConsecutiveDays: 3 }); // ADDED
    const rows = await hooks.explainFeasibilityOverSeason(makeInputs({ plant, city, startISO: '', policy, harvestWindowDays: 7 }), 400, false); // ADDED
    const ranges = hooks.compressFeasibilityScanRanges(rows); // ADDED
    const formatted = hooks.formatFeasibilityScanRanges(rows); // ADDED
    assert.equal(ranges[0].reason, 'spring_frost_gate'); // ADDED
    assert.equal(ranges[0].start, '2026-01-01'); // ADDED
    assert.equal(ranges[0].end, '2026-04-14'); // ADDED
    assert.equal(ranges[0].days, 104); // ADDED
    assert.equal(ranges[0].detail, 'doy 1 < 105 -> doy 104 < 105'); // ADDED
    assert.equal(ranges.map(range => range.reason).join(','), 'spring_frost_gate,soil_gate,ok,insufficient_gdd,soil_gate'); // CHANGED
    assert.match(formatted, /2026-01-01 to 2026-04-14 \(104 days\) \| spring_frost_gate/); // ADDED
    assert.match(formatted, /2026-05-11 to 2026-06-29 .* \| ok/); // ADDED
    assert.doesNotMatch(formatted, /2026-01-02 \(1 day\) \| spring_frost_gate/); // ADDED
}); // ADDED

test('feasibility blocking summary preserves primary post-readiness GDD blocker with a narrow ok range', async () => { // CHANGED
    const city = makeVancouverCity({ last_spring_frost_p50_doy: 105, last_spring_frost_doy: 105 }); // ADDED
    const plant = makePlant({ plant_name: 'Sweet Corn', gdd_to_maturity: 1250, tbase_c: 10, soil_temp_min_plant_c: 16 }); // ADDED
    const policy = new hooks.PolicyFlags({ useSpringFrostGate: true, useSoilTempGate: true, soilGateThresholdC: 16, soilGateConsecutiveDays: 3 }); // ADDED
    const inputs = makeInputs({ plant, city, startISO: '', policy, harvestWindowDays: 7 }); // ADDED
    const rows = await hooks.explainFeasibilityOverSeason(inputs, 400, false); // ADDED
    const summary = hooks.buildFeasibilityBlockingSummary(inputs, rows); // ADDED
    const diagnostics = hooks.buildFeasibilityDiagnostics(inputs, rows); // ADDED
    assert.match(summary, /Feasible sowing range found\./); // CHANGED
    assert.match(summary, /Primary blocker after frost\/soil readiness: insufficient_gdd/); // ADDED
    assert.match(summary, /GDD check: crop needs 1250\.0 GDD; calibrated crop-base estimate is/); // ADDED
    assert.match(diagnostics, /Failure summary: .*soil_gate: \d+/); // ADDED
    assert.match(diagnostics, /Failure summary: .*insufficient_gdd: \d+/); // ADDED
    assert.match(diagnostics, /Failure summary: .*spring_frost_gate: \d+/); // ADDED
}); // ADDED

test('feasibility scan ranges normalize parameterized harvest temperature reasons', () => { // ADDED
    const rows = [ // ADDED
        { date: '2026-01-01', ok: false, reason: 'harvest_too_cold(4.0<10)' }, // ADDED
        { date: '2026-01-02', ok: false, reason: 'harvest_too_cold(4.2<10)' }, // ADDED
        { date: '2026-01-03', ok: false, reason: 'harvest_too_hot(38.1>35)' }, // ADDED
        { date: '2026-01-04', ok: false, reason: 'harvest_too_hot(38.4>35)' } // ADDED
    ]; // ADDED
    const ranges = hooks.compressFeasibilityScanRanges(rows); // ADDED
    const formatted = hooks.formatFeasibilityScanRanges(rows); // ADDED
    assert.equal(ranges.length, 2); // ADDED
    assert.equal(ranges[0].reason, 'harvest_too_cold'); // ADDED
    assert.equal(ranges[0].detail, '4.0<10 -> 4.2<10'); // ADDED
    assert.equal(ranges[1].reason, 'harvest_too_hot'); // ADDED
    assert.equal(ranges[1].detail, '38.1>35 -> 38.4>35'); // ADDED
    assert.match(formatted, /harvest_too_cold/); // ADDED
    assert.match(formatted, /harvest_too_hot/); // ADDED
}); // ADDED

test('feasible scan ranges include representative maturity and harvest dates', async () => { // ADDED
    const plant = makePlant({ plant_name: 'Fast Bean', days_maturity: 30, gdd_to_maturity: null }); // ADDED
    const rows = await hooks.explainFeasibilityOverSeason(makeInputs({ plant, city: makeCity(20), startISO: '' }), 400, false); // ADDED
    const ranges = hooks.compressFeasibilityScanRanges(rows); // ADDED
    const okRange = ranges.find(range => range.ok); // ADDED
    assert.ok(okRange); // ADDED
    assert.equal(okRange.reason, 'ok'); // ADDED
    assert.match(okRange.first_maturity, /^2026-/); // ADDED
    assert.match(okRange.last_harvest_end, /^2027-/); // CHANGED
    assert.match(hooks.formatFeasibilityScanRanges(rows), /maturity .* -> /); // ADDED
}); // ADDED

test('explain sowing range uses full multi-year scheduler scan span', async () => { // ADDED
    const plant = makePlant({ plant_name: 'Biennial Test', annual: 0, biennial: 1, perennial: 0, lifespan_years: 2, days_maturity: 60, gdd_to_maturity: null }); // ADDED
    const rows = await hooks.explainFeasibilityOverSeason(makeInputs({ plant, city: makeCity(18), startISO: '' })); // ADDED
    const text = hooks.buildFeasibilityDiagnostics(makeInputs({ plant, city: makeCity(18), startISO: '' }), rows); // ADDED
    assert.equal(rows[0].date, '2026-01-01'); // ADDED
    assert.equal(rows[rows.length - 1].date, '2027-12-31'); // ADDED
    assert.match(text, /Scan range: 2026-01-01 to 2027-12-31, 730 days/); // ADDED
}); // ADDED

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

test('annual sowing seasons derive one continuous season-bound window', () => { // ADDED
    const plant = makePlant({ plant_name: 'Fast Bean', days_maturity: 30, gdd_to_maturity: null }); // ADDED
    const result = hooks.computeAnnualSowingSeasons(makeAutoWindowParams({ plant, city: makeCity(20), year: 2026 })); // ADDED
    assert.equal(result.feasible, true); // ADDED
    assert.equal(result.seasons.length, 1); // ADDED
    assert.equal(result.seasons[0].startISO, '2026-01-01'); // ADDED
    assert.match(result.seasons[0].endISO, /^2026-/); // ADDED
}); // ADDED

test('indoor transplant sowing season shifts earlier by transplant lead time', () => { // ADDED
    const plant = makePlant({ days_transplant: 21 }); // ADDED
    const frostParams = { useSpringFrostGate: true, lastSpringFrostDOY: 100 }; // ADDED
    const direct = hooks.computeAnnualSowingSeasons({ // ADDED
        ...makeAutoWindowParams({ plant, methodCategoryId: 'direct_sow', methodId: 'direct_sow.field' }), // ADDED
        ...frostParams // ADDED
    }); // ADDED
    const outdoor = hooks.computeAnnualSowingSeasons({ // ADDED
        ...makeAutoWindowParams({ plant, methodCategoryId: 'transplant', methodId: 'transplant.outdoor' }), // ADDED
        ...frostParams // ADDED
    }); // ADDED
    const indoor = hooks.computeAnnualSowingSeasons({ // ADDED
        ...makeAutoWindowParams({ plant, methodCategoryId: 'transplant', methodId: 'transplant.indoor' }), // ADDED
        ...frostParams // ADDED
    }); // ADDED
    assert.equal(direct.seasons[0].startISO, '2026-04-10'); // ADDED
    assert.equal(outdoor.seasons[0].startISO, '2026-04-10'); // ADDED
    assert.equal(indoor.seasons[0].startISO, '2026-03-20'); // ADDED
}); // ADDED

test('hot-climate annual derives separate early and late sowing seasons', () => { // ADDED
    const plant = makePlant({ // ADDED
        plant_name: 'Heat Sensitive Lettuce', // ADDED
        days_maturity: 25, // ADDED
        gdd_to_maturity: null, // ADDED
        tmin_c: 0, // ADDED
        topt_low_c: 10, // ADDED
        topt_high_c: 18, // ADDED
        tmax_c: 24 // ADDED
    }); // ADDED
    const city = makeSeasonalCity({ // ADDED
        1: 10, 2: 12, 3: 15, 4: 18, 5: 23, 6: 31, // ADDED
        7: 33, 8: 31, 9: 23, 10: 17, 11: 12, 12: 10 // ADDED
    }); // ADDED
    const result = hooks.computeAnnualSowingSeasons(makeAutoWindowParams({ plant, city, year: 2026 })); // ADDED
    assert.equal(result.feasible, true); // ADDED
    assert.ok(result.seasons.length >= 2, `expected split windows, got ${JSON.stringify(result.seasons)}`); // ADDED
    assert.equal(result.seasons[0].startISO.slice(0, 4), '2026'); // ADDED
    assert.equal(result.seasons[result.seasons.length - 1].endISO.slice(0, 4), '2026'); // ADDED
}); // ADDED

test('overwinter annual derives spring and fall windows inside the selected season year', () => { // ADDED
    const plant = makePlant({ // ADDED
        plant_name: 'Garlic', // ADDED
        days_maturity: 240, // ADDED
        gdd_to_maturity: null, // ADDED
        overwinter_ok: 1, // ADDED
        start_cooling_threshold_c: 12 // ADDED
    }); // ADDED
    const city = makeSeasonalCity({ // ADDED
        1: 2, 2: 3, 3: 8, 4: 12, 5: 18, 6: 22, // ADDED
        7: 24, 8: 22, 9: 16, 10: 10, 11: 5, 12: 2 // ADDED
    }); // ADDED
    city.last_spring_frost_doy = 105; // ADDED
    const result = hooks.computeAnnualSowingSeasons(makeAutoWindowParams({ plant, city, year: 2026 })); // ADDED
    assert.equal(result.feasible, true); // ADDED
    assert.ok(result.seasons.length >= 2, `expected spring and fall windows, got ${JSON.stringify(result.seasons)}`); // ADDED
    assert.equal(result.seasons[0].startISO, '2026-01-01'); // ADDED
    assert.equal(result.seasons.every(window => window.startISO.startsWith('2026-') && window.endISO.startsWith('2026-')), true); // ADDED
    assert.ok(result.seasons.some(window => /Fall/.test(window.label)), `expected a fall label, got ${JSON.stringify(result.seasons)}`); // ADDED
}); // ADDED

test('overwinter spring sowing belongs to its own season year', () => { // ADDED
    const plant = makePlant({ plant_name: 'Garlic', days_maturity: 240, overwinter_ok: 1, start_cooling_threshold_c: 12 }); // ADDED
    const city = makeSeasonalCity({ 1: 2, 2: 3, 3: 8, 4: 12, 5: 18, 6: 22, 7: 24, 8: 22, 9: 16, 10: 10, 11: 5, 12: 2 }); // ADDED
    city.last_spring_frost_doy = 105; // ADDED
    const prior = hooks.computeAnnualSowingSeasons(makeAutoWindowParams({ plant, city, year: 2026 })); // ADDED
    const next = hooks.computeAnnualSowingSeasons(makeAutoWindowParams({ plant, city, year: 2027 })); // ADDED
    assert.equal(prior.seasons.some(window => window.startISO.startsWith('2027-') || window.endISO.startsWith('2027-')), false); // ADDED
    assert.equal(next.seasons[0].startISO, '2027-01-01'); // ADDED
}); // ADDED

test('cool-season heat above optimum adds diagnostics without blocking by default', () => { // ADDED
    const plant = makePlant({ // ADDED
        plant_name: 'Cool Lettuce', // ADDED
        days_maturity: 20, // ADDED
        topt_high_c: 18, // ADDED
        tmax_c: 35, // ADDED
        quality_temp_max_c: 18, // ADDED
        heat_stress_stage: 'harvest_quality', // ADDED
        quality_heat_policy: 'warn' // ADDED
    }); // ADDED
    const city = makeCity(22); // ADDED
    city.latitude = 45; // ADDED
    const result = hooks.computeAnnualSowingSeasons(makeAutoWindowParams({ plant, city, year: 2026 })); // ADDED
    assert.equal(result.feasible, true); // ADDED
    assert.ok(result.seasons.some(window => /Heat warning/.test(window.riskSummary)), JSON.stringify(result.seasons)); // CHANGED
    assert.ok(result.seasons.some(window => window.diagnostics.some(diagnostic => diagnostic.factor === 'quality_heat' && diagnostic.severity === 'warning'))); // ADDED
}); // ADDED

test('establishment heat block policy excludes otherwise feasible sow dates', () => { // ADDED
    const plant = makePlant({ // ADDED
        plant_name: 'Heat Blocked Spinach', // ADDED
        days_maturity: 20, // ADDED
        tmax_c: 40, // ADDED
        establishment_temp_max_c: 25, // ADDED
        establishment_heat_window_days: 3, // ADDED
        establishment_heat_policy: 'block' // ADDED
    }); // ADDED
    const result = hooks.computeAnnualSowingSeasons(makeAutoWindowParams({ plant, city: makeCity(30), year: 2026 })); // ADDED
    assert.equal(result.feasible, false); // ADDED
    assert.equal(result.seasons.length, 0); // ADDED
}); // ADDED

test('photoperiod diagnostics use city latitude and do not block warn-policy windows', () => { // ADDED
    const plant = makePlant({ // ADDED
        plant_name: 'Long Day Onion', // ADDED
        days_maturity: 30, // ADDED
        photoperiod_response: 'long_day', // ADDED
        critical_daylength_hours: 14.5, // ADDED
        photoperiod_stage: 'maturity', // ADDED
        photoperiod_policy: 'warn' // ADDED
    }); // ADDED
    const city = makeCity(16); // ADDED
    city.latitude = 45; // ADDED
    const result = hooks.computeAnnualSowingSeasons(makeAutoWindowParams({ plant, city, year: 2026 })); // ADDED
    assert.equal(result.feasible, true); // ADDED
    assert.ok(result.seasons.some(window => /Photoperiod warning/.test(window.riskSummary)), JSON.stringify(result.seasons)); // CHANGED
}); // ADDED

test('missing latitude skips photoperiod diagnostics without changing feasible windows', () => { // ADDED
    const plant = makePlant({ // ADDED
        photoperiod_response: 'long_day', // ADDED
        critical_daylength_hours: 14.5, // ADDED
        photoperiod_stage: 'maturity', // ADDED
        photoperiod_policy: 'warn' // ADDED
    }); // ADDED
    const baseline = hooks.computeAnnualSowingSeasons(makeAutoWindowParams({ plant: makePlant(), city: makeCity(16), year: 2026 })); // ADDED
    const result = hooks.computeAnnualSowingSeasons(makeAutoWindowParams({ plant, city: makeCity(16), year: 2026 })); // ADDED
    assert.equal(result.seasons.length, baseline.seasons.length); // ADDED
    assert.ok(result.seasons.some(window => /Photoperiod data missing/.test(window.riskSummary)), JSON.stringify(result.seasons)); // CHANGED
    assert.ok(result.seasons.some(window => window.diagnostics.some(diagnostic => /latitude is missing/.test(diagnostic.message))), JSON.stringify(result.seasons)); // ADDED
}); // ADDED

test('chilling diagnostics report insufficient vernalization without default blocking', () => { // ADDED
    const plant = makePlant({ // ADDED
        plant_name: 'Chill Garlic', // ADDED
        days_maturity: 60, // ADDED
        chilling_required_days: 20, // ADDED
        chilling_temp_min_c: -2, // ADDED
        chilling_temp_max_c: 5, // ADDED
        chilling_stage: 'maturity', // ADDED
        chilling_policy: 'warn' // ADDED
    }); // ADDED
    const result = hooks.computeAnnualSowingSeasons(makeAutoWindowParams({ plant, city: makeCity(15), year: 2026 })); // ADDED
    assert.equal(result.feasible, true); // ADDED
    assert.ok(result.seasons.some(window => /Chilling warning/.test(window.riskSummary)), JSON.stringify(result.seasons)); // CHANGED
}); // ADDED

test('variety physiology overrides affect diagnostics without mutating base plant', () => { // ADDED
    const base = makePlant({ plant_name: 'Base Lettuce', days_maturity: 20, tmax_c: 35 }); // ADDED
    const variety = new hooks.PlantModel(hooks.applyPlantOverrides(base, { // ADDED
        quality_temp_max_c: 18, // ADDED
        heat_stress_stage: 'harvest_quality', // ADDED
        quality_heat_policy: 'warn' // ADDED
    })); // ADDED
    const city = makeCity(22); // ADDED
    const baseResult = hooks.computeAnnualSowingSeasons(makeAutoWindowParams({ plant: base, city, year: 2026 })); // ADDED
    const varietyResult = hooks.computeAnnualSowingSeasons(makeAutoWindowParams({ plant: variety, city, year: 2026 })); // ADDED
    assert.equal(base.quality_temp_max_c, undefined); // ADDED
    assert.equal(baseResult.seasons.some(window => /Heat warning/.test(window.riskSummary)), false); // CHANGED
    assert.equal(varietyResult.seasons.some(window => /Heat warning/.test(window.riskSummary)), true); // CHANGED
}); // ADDED

test('spring-sown chilling does not receive pre-sowing winter credit', () => { // ADDED
    const plant = makePlant({ // ADDED
        days_maturity: 30, // ADDED
        chilling_required_days: 20, // ADDED
        chilling_temp_min_c: -2, // ADDED
        chilling_temp_max_c: 5, // ADDED
        chilling_stage: 'maturity', // ADDED
        chilling_policy: 'warn' // ADDED
    }); // ADDED
    const city = makeSeasonalCity({ 1: 3, 2: 3, 3: 12, 4: 16, 5: 17, 6: 18, 7: 18, 8: 18, 9: 16, 10: 12, 11: 8, 12: 4 }); // ADDED
    const result = hooks.evaluateSowDateDiagnostics(makeInputs({ plant, city, startISO: '2026-04-01' })); // ADDED
    const chilling = result.diagnostics.find(diagnostic => diagnostic.factor === 'chilling'); // ADDED
    assert.ok(chilling, JSON.stringify(result.diagnostics)); // ADDED
    assert.equal(chilling.startISO, '2026-04-01'); // ADDED
    assert.equal(chilling.observed, 0); // ADDED
}); // ADDED

test('fall-sown overwinter crop accumulates chilling after sowing', () => { // ADDED
    const plant = makePlant({ // ADDED
        overwinter_ok: 1, // ADDED
        days_maturity: 80, // ADDED
        chilling_required_days: 20, // ADDED
        chilling_temp_min_c: -2, // ADDED
        chilling_temp_max_c: 6, // ADDED
        chilling_stage: 'maturity', // ADDED
        chilling_policy: 'warn' // ADDED
    }); // ADDED
    const city = makeSeasonalCity({ 1: 3, 2: 3, 3: 6, 4: 10, 5: 14, 6: 18, 7: 20, 8: 19, 9: 12, 10: 4, 11: 4, 12: 4 }); // ADDED
    const result = hooks.evaluateSowDateDiagnostics(makeInputs({ plant, city, startISO: '2026-10-01', seasonEndISO: '2026-12-31' })); // ADDED
    assert.equal(result.diagnostics.some(diagnostic => diagnostic.factor === 'chilling'), false, JSON.stringify(result.diagnostics)); // ADDED
}); // ADDED

test('chilling required hours use daily-equivalent accumulation', () => { // ADDED
    const plant = makePlant({ // ADDED
        days_maturity: 3, // ADDED
        chilling_required_hours: 96, // ADDED
        chilling_temp_min_c: -2, // ADDED
        chilling_temp_max_c: 6, // ADDED
        chilling_stage: 'maturity', // ADDED
        chilling_policy: 'warn' // ADDED
    }); // ADDED
    const result = hooks.evaluateSowDateDiagnostics(makeInputs({ plant, city: makeCity(4), startISO: '2026-01-01' })); // ADDED
    const chilling = result.diagnostics.find(diagnostic => diagnostic.factor === 'chilling'); // ADDED
    assert.ok(chilling, JSON.stringify(result.diagnostics)); // ADDED
    assert.equal(chilling.threshold, 4); // ADDED
    assert.equal(chilling.observed, 3); // ADDED
}); // ADDED

test('smoothed diagnostic block gap remains blocked for the exact selected date', () => { // ADDED
    const plant = makePlant({ // ADDED
        days_maturity: 1, // ADDED
        establishment_temp_max_c: 25, // ADDED
        establishment_heat_window_days: 1, // ADDED
        establishment_heat_policy: 'block' // ADDED
    }); // ADDED
    const overrides = { // ADDED
        '2026-03-15': 30, // ADDED
        '2026-03-16': 30, // ADDED
        '2026-03-17': 30 // ADDED
    }; // ADDED
    const dailyClimate = makeDailyClimate(2026, 20, overrides); // ADDED
    const windows = hooks.computeAnnualSowingSeasons(makeAutoWindowParams({ plant, city: makeCity(20), year: 2026, dailyClimate })).seasons; // ADDED
    assert.equal(windows.length, 1, JSON.stringify(windows)); // ADDED
    assert.equal(windows[0].startISO, '2026-01-01'); // ADDED
    assert.ok(windows[0].endISO > '2026-03-17', JSON.stringify(windows)); // CHANGED
    assert.match(windows[0].riskSummary, /Establishment heat block \(3 dates\)/); // CHANGED
    const inputs = makeInputs({ plant, city: makeCity(20), startISO: '2026-03-15', dailyClimate }); // ADDED
    const exact = hooks.evaluateSowDateDiagnostics(inputs); // ADDED
    assert.ok(exact.blockingDiagnostics.some(diagnostic => diagnostic.factor === 'establishment_heat'), JSON.stringify(exact)); // ADDED
    assert.throws(() => hooks.requireNoBlockingScheduleQualityDiagnostics(inputs), /Establishment heat block/); // ADDED
}); // ADDED

test('photoperiod block excludes dates when latitude is present and daylength fails', () => { // ADDED
    const plant = makePlant({ // ADDED
        photoperiod_response: 'long_day', // ADDED
        critical_daylength_hours: 14.5, // ADDED
        photoperiod_stage: 'maturity', // ADDED
        photoperiod_policy: 'block' // ADDED
    }); // ADDED
    const city = makeCity(16); // ADDED
    city.latitude = 45; // ADDED
    const exact = hooks.evaluateSowDateDiagnostics(makeInputs({ plant, city, startISO: '2026-01-01' })); // ADDED
    assert.ok(exact.blockingDiagnostics.some(diagnostic => diagnostic.factor === 'photoperiod'), JSON.stringify(exact)); // ADDED
    const result = hooks.computeAnnualSowingSeasons(makeAutoWindowParams({ plant, city, year: 2026 })); // ADDED
    assert.equal(result.seasons.some(window => window.startISO === '2026-01-01'), false, JSON.stringify(result.seasons)); // ADDED
}); // ADDED

test('missing latitude does not block photoperiod block policy and shows data badge', () => { // ADDED
    const plant = makePlant({ // ADDED
        photoperiod_response: 'long_day', // ADDED
        critical_daylength_hours: 14.5, // ADDED
        photoperiod_stage: 'maturity', // ADDED
        photoperiod_policy: 'block' // ADDED
    }); // ADDED
    const city = makeCity(16); // ADDED
    const exact = hooks.evaluateSowDateDiagnostics(makeInputs({ plant, city, startISO: '2026-01-01' })); // ADDED
    assert.equal(exact.blockingDiagnostics.length, 0, JSON.stringify(exact)); // ADDED
    const result = hooks.computeAnnualSowingSeasons(makeAutoWindowParams({ plant, city, year: 2026 })); // ADDED
    assert.equal(result.feasible, true); // ADDED
    assert.ok(result.seasons.some(window => /Photoperiod data missing/.test(window.riskSummary)), JSON.stringify(result.seasons)); // ADDED
}); // ADDED

test('unsupported stored latitude does not silently clamp or block photoperiod policy', () => { // ADDED
    const plant = makePlant({ // ADDED
        photoperiod_response: 'long_day', // ADDED
        critical_daylength_hours: 14.5, // ADDED
        photoperiod_stage: 'maturity', // ADDED
        photoperiod_policy: 'block' // ADDED
    }); // ADDED
    const city = makeCity(16); // ADDED
    city.latitude = 70; // ADDED
    const exact = hooks.evaluateSowDateDiagnostics(makeInputs({ plant, city, startISO: '2026-01-01' })); // ADDED
    assert.equal(exact.blockingDiagnostics.length, 0, JSON.stringify(exact)); // ADDED
    assert.ok(exact.diagnostics.some(diagnostic => diagnostic.factor === 'photoperiod' && diagnostic.severity === 'info' && /supported -66\.5 to 66\.5/.test(diagnostic.message)), JSON.stringify(exact)); // ADDED
    const result = hooks.computeAnnualSowingSeasons(makeAutoWindowParams({ plant, city, year: 2026 })); // ADDED
    assert.equal(result.feasible, true); // ADDED
    assert.ok(result.seasons.some(window => /Photoperiod data missing/.test(window.riskSummary)), JSON.stringify(result.seasons)); // ADDED
}); // ADDED

test('diagnostic ranges format the same human risk labels as selector summaries', () => { // ADDED
    const plant = makePlant({ // ADDED
        days_maturity: 20, // ADDED
        quality_temp_max_c: 18, // ADDED
        heat_stress_stage: 'harvest_quality', // ADDED
        quality_heat_policy: 'warn' // ADDED
    }); // ADDED
    const city = makeCity(22); // ADDED
    const params = makeAutoWindowParams({ plant, city, year: 2026 }); // ADDED
    const windows = hooks.computeAnnualSowingSeasons(params).seasons; // ADDED
    const ranges = hooks.computeScheduleQualityDiagnosticRanges(params); // ADDED
    const selector = hooks.buildSowingSeasonSelectorState({ sowingSeasons: windows, activeSowingSeasonId: windows[0]?.id || '', startISO: windows[0]?.startISO || '' }); // ADDED
    const text = hooks.formatScheduleQualityDiagnosticRanges(ranges); // ADDED
    assert.ok(selector.options.some(option => /Heat warning \(\d+ dates?\)/.test(option.label)), JSON.stringify(selector)); // CHANGED
    assert.match(text, /Heat warning/); // ADDED
}); // ADDED

test('city latitude validation accepts clearing and rejects out-of-range values', () => { // ADDED
    assert.equal(hooks.normalizeLatitudeDeg(''), null); // ADDED
    assert.equal(hooks.normalizeLatitudeDeg('45.5'), 45.5); // ADDED
    assert.equal(hooks.normalizeLatitudeDeg('66.5'), 66.5); // ADDED
    assert.equal(hooks.normalizeLatitudeDeg('-66.5'), -66.5); // ADDED
    assert.throws(() => hooks.normalizeLatitudeDeg('66.6'), /between -66\.5 and 66\.5/); // CHANGED
    assert.throws(() => hooks.normalizeLatitudeDeg('-66.6'), /between -66\.5 and 66\.5/); // CHANGED
}); // ADDED

test('city latitude update persists to Cities.latitude', async () => { // ADDED
    const testWindow = hooks.__testWindow; // ADDED
    const previousBridge = testWindow.dbBridge; // ADDED
    const updates = []; // ADDED
    let changes = 0; // ADDED
    testWindow.dbBridge = { // ADDED
        async resolvePath() { return { dbPath: 'mock.sqlite' }; }, // ADDED
        async open() { return { dbId: 'mock-db' }; }, // ADDED
        async close() {}, // ADDED
        async query(_dbId, sql) { // ADDED
            if (/PRAGMA table_info/i.test(sql)) return { rows: [] }; // ADDED
            if (/SELECT changes\(\)/i.test(sql)) return { rows: [{ changes }] }; // ADDED
            return { rows: [] }; // ADDED
        }, // ADDED
        async exec(_dbId, sql, params) { // ADDED
            if (/UPDATE Cities SET latitude/i.test(sql)) { // CHANGED
                updates.push(params); // ADDED
                changes = params[1] === 'Test City' ? 1 : 0; // ADDED
            } // ADDED
            return {}; // ADDED
        } // ADDED
    }; // ADDED
    try { // ADDED
        const saved = await hooks.CityClimate.updateLatitude('Test City', '49.25'); // ADDED
        assert.equal(saved, 49.25); // ADDED
        assert.deepEqual(Array.from(updates.at(-1)), [49.25, 'Test City']); // CHANGED
        const cleared = await hooks.CityClimate.updateLatitude('Test City', ''); // ADDED
        assert.equal(cleared, null); // ADDED
        assert.deepEqual(Array.from(updates.at(-1)), [null, 'Test City']); // CHANGED
        const beforeInvalid = updates.length; // ADDED
        await assert.rejects(() => hooks.CityClimate.updateLatitude('Test City', '70'), /between -66\.5 and 66\.5/); // ADDED
        assert.equal(updates.length, beforeInvalid); // ADDED
    } finally { // ADDED
        testWindow.dbBridge = previousBridge; // ADDED
    } // ADDED
}); // ADDED

test('city latitude save helper persists cache and refreshes annual scheduling state', async () => { // ADDED
    const testWindow = hooks.__testWindow; // ADDED
    const previousBridge = testWindow.dbBridge; // ADDED
    const updates = []; // ADDED
    let changes = 0; // ADDED
    testWindow.dbBridge = { // ADDED
        async resolvePath() { return { dbPath: 'mock.sqlite' }; }, // ADDED
        async open() { return { dbId: 'mock-db' }; }, // ADDED
        async close() {}, // ADDED
        async query(_dbId, sql) { // ADDED
            if (/PRAGMA table_info/i.test(sql)) return { rows: [] }; // ADDED
            if (/SELECT changes\(\)/i.test(sql)) return { rows: [{ changes }] }; // ADDED
            return { rows: [] }; // ADDED
        }, // ADDED
        async exec(_dbId, sql, params) { // ADDED
            if (/UPDATE Cities SET latitude/i.test(sql)) { // CHANGED
                updates.push(params); // ADDED
                changes = params[1] === 'Test City' ? 1 : 0; // ADDED
            } // ADDED
            return {}; // ADDED
        } // ADDED
    }; // ADDED
    const cities = [{ city_name: 'Test City', latitude: null }]; // CHANGED
    const recomputeReasons = []; // ADDED
    let previewRefreshes = 0; // ADDED
    try { // ADDED
        const saved = await hooks.saveSchedulerCityLatitude({ // ADDED
            cityName: 'Test City', // ADDED
            latitudeValue: '49.25', // ADDED
            cities, // ADDED
            recomputeAll: async reason => { recomputeReasons.push(reason); }, // ADDED
            updateTaskPreview: async () => { previewRefreshes += 1; } // ADDED
        }); // ADDED
        assert.equal(saved, 49.25); // ADDED
        assert.deepEqual(Array.from(updates.at(-1)), [49.25, 'Test City']); // ADDED
        assert.equal(cities[0].latitude, 49.25); // CHANGED
        assert.deepEqual(recomputeReasons, ['cityChanged']); // ADDED
        assert.equal(previewRefreshes, 1); // ADDED
    } finally { // ADDED
        testWindow.dbBridge = previousBridge; // ADDED
    } // ADDED
}); // ADDED

test('city climate resolver prefers city_id and falls back to city_name', async () => { // ADDED
    const testWindow = hooks.__testWindow; // ADDED
    const previousBridge = testWindow.dbBridge; // ADDED
    const queries = []; // ADDED
    testWindow.dbBridge = { // ADDED
        async resolvePath() { return { dbPath: 'mock.sqlite' }; }, // ADDED
        async open() { return { dbId: 'mock-db' }; }, // ADDED
        async close() {}, // ADDED
        async query(_dbId, sql, params) { // ADDED
            queries.push({ sql, params }); // ADDED
            if (/WHERE city_id = \\?/i.test(sql) && Number(params[0]) === 7) return { rows: [{ city_id: 7, city_name: 'Renamed City', latitude: 49 }] }; // ADDED
            if (/WHERE city_id = \\?/i.test(sql)) return { rows: [] }; // ADDED
            if (/WHERE city_name = \\?/i.test(sql) && params[0] === 'Fallback City') return { rows: [{ city_id: 8, city_name: 'Fallback City', latitude: 45 }] }; // ADDED
            return { rows: [] }; // ADDED
        }, // ADDED
        async exec() { return {}; } // ADDED
    }; // ADDED
    try { // ADDED
        const byId = await hooks.CityClimate.resolve({ cityId: 7, cityName: 'Old Cached Name' }); // ADDED
        assert.equal(byId.city_name, 'Renamed City'); // ADDED
        const byName = await hooks.CityClimate.resolve({ cityId: 999, cityName: 'Fallback City' }); // ADDED
        assert.equal(byName.city_id, 8); // ADDED
        assert.ok(queries.some(item => /WHERE city_id = \\?/i.test(item.sql)), 'expected city_id lookup'); // ADDED
        assert.ok(queries.some(item => /WHERE city_name = \\?/i.test(item.sql)), 'expected name fallback lookup'); // ADDED
    } finally { // ADDED
        testWindow.dbBridge = previousBridge; // ADDED
    } // ADDED
}); // ADDED

test('city climate unique-name fallback rejects ambiguous legacy names', async () => { // ADDED
    const testWindow = hooks.__testWindow; // ADDED
    const previousBridge = testWindow.dbBridge; // ADDED
    testWindow.dbBridge = { // ADDED
        async resolvePath() { return { dbPath: 'mock.sqlite' }; }, // ADDED
        async open() { return { dbId: 'mock-db' }; }, // ADDED
        async close() {}, // ADDED
        async query(_dbId, sql, params) { // ADDED
            if (/WHERE city_id = \?/i.test(sql)) return { rows: [] }; // ADDED
            if (/WHERE city_name = \?/i.test(sql) && /LIMIT 2/i.test(sql) && params[0] === 'Duplicate City') { // ADDED
                return { rows: [ // ADDED
                    { city_id: 10, city_name: 'Duplicate City', latitude: 40 }, // ADDED
                    { city_id: 11, city_name: 'Duplicate City', latitude: 41 } // ADDED
                ] }; // ADDED
            } // ADDED
            return { rows: [] }; // ADDED
        }, // ADDED
        async exec() { return {}; } // ADDED
    }; // ADDED
    try { // ADDED
        const ambiguous = await hooks.CityClimate.resolveUniqueNameFallback({ cityName: 'Duplicate City' }); // ADDED
        assert.equal(ambiguous, null); // ADDED
    } finally { // ADDED
        testWindow.dbBridge = previousBridge; // ADDED
    } // ADDED
}); // ADDED

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

test('schedule save patch clears legacy sowing window attributes', () => { // ADDED
    const inputs = makeInputs({ startISO: '2026-04-15' }); // ADDED
    const result = hooks.computeScheduleResult(inputs); // ADDED
    const patch = hooks.buildScheduleAttributePatch(inputs, result, { sowingSeasonId: 'spring', sowingSeasonLabel: 'Spring' }); // ADDED
    assert.equal(patch.sowing_season_id, 'spring'); // ADDED
    assert.equal(patch.sowing_season_label, 'Spring'); // ADDED
    assert.equal(patch.sowing_window_id, null); // ADDED
    assert.equal(patch.sowing_window_label, null); // ADDED
}); // ADDED

test('persisted start is distinct from a session edit and is not auto-overwritten', () => {
    const persisted = hooks.resolveStartAfterWindow({
        currentStartISO: '2026-05-10',
        activeWindow: { startISO: '2026-04-01' }, // CHANGED
        feasible: true,
        forceWriteStart: false,
        hasPersistedSchedule: true,
        userEditedStartThisSession: false
    });
    assert.equal(persisted, '2026-05-10');

    const replacedForYearChange = hooks.resolveStartAfterWindow({
        currentStartISO: persisted,
        activeWindow: { startISO: '2027-04-03' }, // CHANGED
        feasible: true,
        forceWriteStart: true,
        hasPersistedSchedule: true,
        userEditedStartThisSession: false
    });
    assert.equal(replacedForYearChange, '2027-04-03');

    const preservedWithoutWindow = hooks.resolveStartAfterWindow({
        currentStartISO: '2026-05-10',
        activeWindow: null, // CHANGED
        feasible: false,
        forceWriteStart: true,
        hasPersistedSchedule: true,
        userEditedStartThisSession: false
    });
    assert.equal(preservedWithoutWindow, '2026-05-10');
});

test('new annual schedule defaults sow date to today inside the active window', () => { // ADDED
    const activeWindow = { id: 'spring', label: 'Spring (Apr 1-May 1)', startISO: '2026-04-01', endISO: '2026-05-01' }; // ADDED
    assert.equal(hooks.resolveStartAfterWindow({ // ADDED
        currentStartISO: '', // ADDED
        activeWindow, // ADDED
        feasible: true, // ADDED
        forceWriteStart: false, // ADDED
        hasPersistedSchedule: false, // ADDED
        userEditedStartThisSession: false, // ADDED
        todayISO: '2026-04-15' // ADDED
    }), '2026-04-15'); // ADDED
    assert.equal(hooks.resolveStartAfterWindow({ // ADDED
        currentStartISO: '', // ADDED
        activeWindow, // ADDED
        feasible: true, // ADDED
        forceWriteStart: false, // ADDED
        hasPersistedSchedule: false, // ADDED
        userEditedStartThisSession: false, // ADDED
        todayISO: '2026-08-15' // ADDED
    }), '2026-04-01'); // ADDED
}); // ADDED

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
    const windows = [{ id: 'spring', label: 'Spring (Apr 1-May 1)', startISO: '2026-04-01', endISO: '2026-05-01' }]; // ADDED
    const fallWindows = windows.concat([{ id: 'fall', label: 'Fall (Sep 1-Oct 1)', startISO: '2026-09-01', endISO: '2026-10-01' }]); // ADDED
    assert.equal(hooks.humanFeasibilityReason('insufficient_gdd'), 'There is not enough growing-degree accumulation to reach maturity.'); // ADDED
    assert.equal(hooks.humanFeasibilityReason('insufficient_gdd_before_cold(gdd 10.0<20.0 deadline 2026-11-01)'), 'There is not enough heat for this crop to mature before lethal cold.'); // ADDED
    assert.equal(hooks.classifySelectedSowDate({ perennial: true }).status, 'not_applicable'); // ADDED
    assert.equal(hooks.classifySelectedSowDate({ windowFeasible: false }).status, 'no_window'); // ADDED
    assert.equal(hooks.classifySelectedSowDate({ windowFeasible: true, sowingSeasons: windows, activeSowingSeasonId: 'spring' }).status, 'missing'); // CHANGED
    assert.equal(hooks.classifySelectedSowDate({ // ADDED
        windowFeasible: true, // ADDED
        startISO: '2026-03-01', // ADDED
        sowingSeasons: windows, // CHANGED
        activeSowingSeasonId: 'spring' // ADDED
    }).status, 'outside_window'); // CHANGED
    assert.equal(hooks.classifySelectedSowDate({ // ADDED
        windowFeasible: true, // ADDED
        startISO: '2026-09-15', // CHANGED
        sowingSeasons: fallWindows, // CHANGED
        activeSowingSeasonId: 'spring' // ADDED
    }).status, 'window_mismatch'); // CHANGED
    assert.equal(hooks.classifySelectedSowDate({ // ADDED
        windowFeasible: true, // ADDED
        startISO: '2026-04-15', // ADDED
        sowingSeasons: windows, // CHANGED
        activeSowingSeasonId: 'spring' // ADDED
    }).status, 'feasible'); // ADDED
    assert.equal(hooks.pickDefaultSowingSeasonId(fallWindows, { savedStartISO: '2026-09-15', todayISO: '2026-01-01' }), 'fall'); // ADDED
    assert.equal(hooks.findSowingSeasonForDate(fallWindows, '2026-04-15').id, 'spring'); // ADDED
}); // ADDED

test('orphan saved sow date is visible as guidance without blocking validation', () => { // CHANGED
    const windows = [{ id: 'spring', label: 'Spring (Apr 1-May 1)', startISO: '2026-04-01', endISO: '2026-05-01' }]; // ADDED
    const selector = hooks.buildSowingSeasonSelectorState({ // ADDED
        sowingSeasons: windows, // ADDED
        activeSowingSeasonId: hooks.ORPHAN_SOWING_SEASON_ID, // ADDED
        startISO: '2026-06-15' // ADDED
    }); // ADDED
    assert.equal(selector.value, hooks.ORPHAN_SOWING_SEASON_ID); // ADDED
    assert.equal(selector.options[0].label, 'Saved date outside seasons (2026-06-15)'); // ADDED
    assert.equal(selector.options[0].disabled, true); // ADDED
    assert.equal(selector.boundsText, ''); // ADDED
    assert.equal(hooks.classifySelectedSowDate({ // ADDED
        windowFeasible: true, // ADDED
        startISO: '2026-06-15', // ADDED
        sowingSeasons: windows, // ADDED
        activeSowingSeasonId: hooks.ORPHAN_SOWING_SEASON_ID // ADDED
    }).status, 'outside_window'); // ADDED
    assert.equal(hooks.requireFeasibleSowingSeasonSelection({ // CHANGED
        windowFeasible: true, // ADDED
        startISO: '2026-06-15', // ADDED
        sowingSeasons: windows, // ADDED
        activeSowingSeasonId: hooks.ORPHAN_SOWING_SEASON_ID // ADDED
    }).status, 'outside_window'); // CHANGED
}); // ADDED

test('switching sowing seasons preserves an in-window sow date and otherwise defaults to the selected window start', () => { // CHANGED
    const windows = [ // ADDED
        { id: 'spring', label: 'Spring (Apr 1-May 1)', startISO: '2026-04-01', endISO: '2026-05-01' }, // ADDED
        { id: 'fall', label: 'Fall (Sep 1-Oct 1)', startISO: '2026-09-01', endISO: '2026-10-01' } // ADDED
    ]; // ADDED
    assert.equal(hooks.resolveStartForSowingSeasonSwitch(windows, 'fall', '2026-09-15'), '2026-09-15'); // ADDED
    assert.equal(hooks.resolveStartForSowingSeasonSwitch(windows, 'fall', '2026-04-15'), '2026-09-01'); // CHANGED
    assert.equal(hooks.resolveStartForSowingSeasonSwitch(windows, hooks.ORPHAN_SOWING_SEASON_ID), ''); // ADDED
}); // ADDED

test('sowing season change refreshes derived UI after harvest recomputation', () => { // ADDED
    const source = fs.readFileSync(schedulerPath, 'utf8'); // ADDED
    const handlerStart = source.indexOf("sowingSeasonSel.addEventListener('change'"); // ADDED
    const handlerEnd = source.indexOf("seasonYearInput.addEventListener", handlerStart); // ADDED
    assert.ok(handlerStart >= 0 && handlerEnd > handlerStart, 'expected to find sowing season change handler'); // ADDED
    const handlerBody = source.slice(handlerStart, handlerEnd); // ADDED
    const harvestIndex = handlerBody.indexOf('await recomputeLastHarvestFromSchedule()'); // ADDED
    const refreshIndex = handlerBody.indexOf('await refreshTasksTabUI()'); // ADDED
    assert.ok(harvestIndex >= 0, 'season change should recompute harvest before refreshing dependent UI'); // ADDED
    assert.ok(refreshIndex > harvestIndex, 'task/timeline refresh should run after harvest recomputation'); // ADDED
    assert.equal(handlerBody.includes('await updateTaskPreview()'), false, 'season change should use shared task/timeline refresh orchestration'); // ADDED
    assert.equal(handlerBody.includes('updateTimeline()'), false, 'season change should not render timeline before latestScheduleResult is refreshed'); // ADDED
    assert.match(handlerBody, /userEditedStartThisSession\s*=\s*true/, 'season selection should be treated as a user-selected schedule anchor'); // ADDED
}); // ADDED

test('derived sowing season summary matches selector labels', () => { // ADDED
    const windows = [ // ADDED
        { id: 'spring', label: 'Spring (Apr 1-May 1)', startISO: '2026-04-01', endISO: '2026-05-01' }, // ADDED
        { id: 'fall', label: 'Fall (Sep 1-Oct 1)', startISO: '2026-09-01', endISO: '2026-10-01' } // ADDED
    ]; // ADDED
    const selectorLabels = hooks.buildSowingSeasonSelectorState({ // ADDED
        sowingSeasons: windows, // ADDED
        activeSowingSeasonId: 'spring', // ADDED
        startISO: '2026-04-15' // ADDED
    }).options.map(option => option.label); // ADDED
    const summary = hooks.formatSowingSeasonsSummary(windows); // ADDED
    assert.equal(JSON.stringify(selectorLabels), JSON.stringify(windows.map(window => window.label))); // CHANGED
    selectorLabels.forEach(label => assert.match(summary, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))); // ADDED
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
        sowingSeasons: [{ id: 'spring', label: 'Spring (Mar 20-May 1)', startISO: '2026-03-20', endISO: '2026-05-01' }], // CHANGED
        activeSowingSeasonId: 'spring', // ADDED
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

test('schedule summary state renders thermal warnings as warning status', () => { // ADDED
    const annual = hooks.buildScheduleViewState({ // ADDED
        plantName: 'Tomato', // ADDED
        cityName: 'Test City', // ADDED
        seasonStartYear: 2026, // ADDED
        methodName: 'Field direct sow', // ADDED
        windowFeasible: false, // ADDED
        startISO: '2026-06-15', // ADDED
        scheduleWarnings: [{ type: 'harvest_too_hot', message: 'Expected harvest temperature is above the crop maximum.' }] // ADDED
    }); // ADDED
    assert.equal(annual.feasibility.status, 'warning'); // ADDED
    assert.match(annual.feasibility.label, /above the crop maximum/); // ADDED
}); // ADDED

test('task rule normalization defaults repeat cutoff fields', () => { // ADDED
    const rule = hooks.normalizeTaskRule({ title: 'Water', repeat: true }); // ADDED
    assert.equal(rule.repeatMode, 'interval'); // ADDED
    assert.equal(rule.repeatUntilMode, 'x_times'); // ADDED
    assert.equal(rule.repeatUntilAnchorStage, 'HARVEST_END'); // ADDED
    assert.equal(rule.repeatCutoffOffsetDays, 0); // ADDED
    assert.equal(rule.repeatCutoffOffsetDirection, 'after'); // ADDED
}); // ADDED

test('task template resolution uses cell, variety, plant, method, none precedence', async () => { // ADDED
    const model = hooks.TaskTemplateModel; // ADDED
    const originalVariety = model.loadVarietyTemplate; // ADDED
    const originalPlant = model.loadPlantTemplate; // ADDED
    const originalMethod = model.loadMethodBuiltinTemplate; // ADDED
    const cellTemplate = { version: 2, rules: [{ id: 'cell' }] }; // ADDED
    const varietyTemplate = { version: 2, rules: [{ id: 'variety' }] }; // ADDED
    const plantTemplate = { version: 2, rules: [{ id: 'plant' }] }; // ADDED
    const methodTemplate = { version: 2, rules: [{ id: 'method' }] }; // ADDED
    const emptyCell = { getAttribute: () => '' }; // ADDED
    try { // ADDED
        model.loadVarietyTemplate = async () => { throw new Error('variety should not load for cell templates'); }; // ADDED
        model.loadPlantTemplate = async () => { throw new Error('plant should not load for cell templates'); }; // ADDED
        model.loadMethodBuiltinTemplate = async () => { throw new Error('method should not load for cell templates'); }; // ADDED
        let resolved = await hooks.resolveTaskTemplate({ // ADDED
            cell: { getAttribute: key => key === 'task_template_json' ? JSON.stringify(cellTemplate) : '' }, // ADDED
            plantId: 1, // ADDED
            varietyId: 10, // ADDED
            methodId: 'direct_sow.field' // ADDED
        }); // ADDED
        assert.equal(resolved.source, 'cell'); // ADDED
        assert.equal(JSON.stringify(resolved.template), JSON.stringify(cellTemplate)); // ADDED

        model.loadVarietyTemplate = async () => varietyTemplate; // ADDED
        model.loadPlantTemplate = async () => plantTemplate; // ADDED
        model.loadMethodBuiltinTemplate = async () => methodTemplate; // ADDED
        resolved = await hooks.resolveTaskTemplate({ cell: emptyCell, plantId: 1, varietyId: 10, methodId: 'direct_sow.field' }); // ADDED
        assert.equal(resolved.source, 'variety'); // ADDED
        assert.equal(JSON.stringify(resolved.template), JSON.stringify(varietyTemplate)); // ADDED

        model.loadVarietyTemplate = async () => null; // ADDED
        model.loadPlantTemplate = async () => plantTemplate; // ADDED
        model.loadMethodBuiltinTemplate = async () => methodTemplate; // ADDED
        resolved = await hooks.resolveTaskTemplate({ cell: emptyCell, plantId: 1, varietyId: 10, methodId: 'direct_sow.field' }); // ADDED
        assert.equal(resolved.source, 'plant'); // ADDED
        assert.equal(JSON.stringify(resolved.template), JSON.stringify(plantTemplate)); // ADDED

        model.loadVarietyTemplate = async () => null; // ADDED
        model.loadPlantTemplate = async () => null; // ADDED
        model.loadMethodBuiltinTemplate = async () => methodTemplate; // ADDED
        resolved = await hooks.resolveTaskTemplate({ cell: emptyCell, plantId: 1, varietyId: 10, methodId: 'direct_sow.field' }); // ADDED
        assert.equal(resolved.source, 'method_builtin'); // ADDED
        assert.equal(JSON.stringify(resolved.template), JSON.stringify(methodTemplate)); // ADDED

        model.loadMethodBuiltinTemplate = async () => null; // ADDED
        resolved = await hooks.resolveTaskTemplate({ cell: emptyCell, plantId: 1, varietyId: 10, methodId: 'direct_sow.field' }); // ADDED
        assert.equal(resolved.source, 'none'); // ADDED
        assert.equal(resolved.template, null); // ADDED
    } finally { // ADDED
        model.loadVarietyTemplate = originalVariety; // ADDED
        model.loadPlantTemplate = originalPlant; // ADDED
        model.loadMethodBuiltinTemplate = originalMethod; // ADDED
    } // ADDED
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
        taskTemplate: template, // ADDED
        methodCategoryId: 'direct_sow', // ADDED
        methodId: 'direct_sow.field' // ADDED
    }); // ADDED
    const previewTasks = await hooks.buildTasksForPlan({ // ADDED
        plant, // ADDED
        schedule: result.schedule, // ADDED
        timelines: result.timelines, // ADDED
        taskTemplate: template, // ADDED
        methodCategoryId: 'direct_sow', // ADDED
        methodId: 'direct_sow.field', // ADDED
        includePreviewMetadata: true // ADDED
    }); // ADDED
    assert.deepEqual( // ADDED
        previewTasks.map(task => [task.startISO, task.endISO]), // ADDED
        savedTasks.map(task => [task.startISO, task.endISO]) // ADDED
    ); // ADDED
    assert.equal(Object.keys(savedTasks[0]).includes('previewRuleKey'), false); // ADDED
    assert.equal(Object.keys(previewTasks[0]).includes('previewRuleKey'), false); // ADDED
    assert.equal(previewTasks[0].previewRuleKey, 'water::0'); // ADDED
    assert.deepEqual( // ADDED
        previewTasks.map(task => [task.scheduler_method_category_id, task.scheduler_method_id, task.scheduler_task_key, task.scheduler_occurrence_index]), // ADDED
        savedTasks.map(task => [task.scheduler_method_category_id, task.scheduler_method_id, task.scheduler_task_key, task.scheduler_occurrence_index]) // ADDED
    ); // ADDED
    assert.deepEqual(Array.from(savedTasks, task => task.scheduler_task_key), ['water::0::0', 'water::0::1', 'water::0::2']); // ADDED
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

test('generated tasks include stable scheduler anchor and method metadata', async () => { // ADDED
    const plant = makePlant({ days_transplant: 21 }); // ADDED
    const result = hooks.computeScheduleResult(makeInputs({ // ADDED
        plant, // ADDED
        planningMode: 'transplant_indoor', // ADDED
        methodCategoryId: 'transplant', // ADDED
        methodId: 'transplant.indoor' // ADDED
    })); // ADDED
    const tasks = await hooks.buildTasksForPlan({ // ADDED
        plant, // ADDED
        schedule: result.schedule, // ADDED
        timelines: result.timelines, // ADDED
        methodCategoryId: 'transplant', // ADDED
        methodId: 'transplant.indoor', // ADDED
        taskTemplate: { // ADDED
            rules: [{ id: 'start', title: 'Start indoors {plant}', startAnchorStage: 'SOW', endMode: 'fixed_days', durationDays: 0 }] // ADDED
        } // ADDED
    }); // ADDED
    assert.equal(tasks[0].scheduler_rule_id, 'start'); // ADDED
    assert.equal(tasks[0].scheduler_anchor_stage, 'SOW'); // ADDED
    assert.equal(tasks[0].scheduler_method_category_id, 'transplant'); // ADDED
    assert.equal(tasks[0].scheduler_method_id, 'transplant.indoor'); // ADDED
    assert.equal(tasks[0].scheduler_task_key, 'start::0::0'); // ADDED
    assert.equal(tasks[0].scheduler_occurrence_index, 0); // ADDED
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

function makeGeneratedSyncTask(key, attrs = {}) { // ADDED
    return { // ADDED
        title: 'Water', // ADDED
        startISO: '2026-04-01', // ADDED
        endISO: '2026-04-01', // ADDED
        scheduler_task_key: key, // ADDED
        scheduler_occurrence_index: Number(String(key).split('::').pop() || 0), // ADDED
        ...attrs // ADDED
    }; // ADDED
} // ADDED

function makeGeneratedSyncRecord(key, attrs = {}) { // ADDED
    return { // ADDED
        schedulerTaskKey: key, // ADDED
        source: { // ADDED
            title: 'Water', // ADDED
            start: '2026-04-01', // ADDED
            end: '2026-04-01', // ADDED
            base_start: '2026-04-01', // ADDED
            base_end: '2026-04-01', // ADDED
            scheduler_task_key: key, // ADDED
            scheduler_occurrence_index: String(Number(String(key).split('::').pop() || 0)), // ADDED
            ...attrs // ADDED
        } // ADDED
    }; // ADDED
} // ADDED

test('differential task sync planner leaves unchanged generated tasks alone', () => { // ADDED
    const plan = taskHooks.planDifferentialTaskSync( // ADDED
        [makeGeneratedSyncRecord('water::0::0')], // ADDED
        [makeGeneratedSyncTask('water::0::0')] // ADDED
    ); // ADDED
    assert.equal(plan.legacyReplace, false); // ADDED
    assert.equal(plan.creates.length, 0); // ADDED
    assert.equal(plan.updates.length, 0); // ADDED
    assert.equal(plan.removes.length, 0); // ADDED
    assert.equal(plan.unchanged.length, 1); // ADDED
}); // ADDED

test('differential task sync planner updates changed dates and clears date overrides', () => { // ADDED
    const task = makeGeneratedSyncTask('water::0::0', { startISO: '2026-04-03', endISO: '2026-04-04' }); // ADDED
    const plan = taskHooks.planDifferentialTaskSync( // ADDED
        [makeGeneratedSyncRecord('water::0::0', { date_override: '1', card_note: 'Keep this' })], // ADDED
        [task] // ADDED
    ); // ADDED
    assert.equal(plan.legacyReplace, false); // ADDED
    assert.equal(plan.updates.length, 1); // ADDED
    assert.equal(plan.updates[0].record.source.card_note, 'Keep this'); // ADDED
    const attrs = taskHooks.buildGeneratedTaskSyncAttributes(task); // ADDED
    assert.equal(attrs.start, '2026-04-03'); // ADDED
    assert.equal(attrs.base_start, '2026-04-03'); // ADDED
    assert.equal(attrs.end, '2026-04-04'); // ADDED
    assert.equal(attrs.date_override, null); // ADDED
    assert.equal(Object.hasOwn(attrs, 'card_note'), false); // ADDED
}); // ADDED

test('differential task sync planner creates new tasks and removes missing tasks', () => { // ADDED
    const plan = taskHooks.planDifferentialTaskSync( // ADDED
        [makeGeneratedSyncRecord('water::0::0'), makeGeneratedSyncRecord('water::0::1')], // ADDED
        [makeGeneratedSyncTask('water::0::1'), makeGeneratedSyncTask('water::0::2')] // ADDED
    ); // ADDED
    assert.equal(plan.legacyReplace, false); // ADDED
    assert.deepEqual(Array.from(plan.creates, item => item.key), ['water::0::2']); // ADDED
    assert.deepEqual(Array.from(plan.removes, item => item.key), ['water::0::0']); // ADDED
    assert.deepEqual(Array.from(plan.unchanged, item => item.key), ['water::0::1']); // ADDED
}); // ADDED

test('differential task sync planner matches repeated occurrences by scheduler task key', () => { // ADDED
    const plan = taskHooks.planDifferentialTaskSync( // ADDED
        [makeGeneratedSyncRecord('water::0::1'), makeGeneratedSyncRecord('water::0::0')], // ADDED
        [makeGeneratedSyncTask('water::0::0'), makeGeneratedSyncTask('water::0::1')] // ADDED
    ); // ADDED
    assert.equal(plan.legacyReplace, false); // ADDED
    assert.deepEqual(Array.from(plan.unchanged, item => item.key), ['water::0::0', 'water::0::1']); // ADDED
}); // ADDED

test('differential task sync planner falls back to replacement for unsafe legacy identities', () => { // ADDED
    assert.equal(taskHooks.planDifferentialTaskSync([makeGeneratedSyncRecord('water::0::0')], [{ title: 'Legacy' }]).legacyReplace, true); // ADDED
    assert.equal(taskHooks.planDifferentialTaskSync([{ source: { title: 'Legacy card' } }], [makeGeneratedSyncTask('water::0::0')]).legacyReplace, true); // ADDED
    assert.equal(taskHooks.planDifferentialTaskSync([makeGeneratedSyncRecord('water::0::0')], [makeGeneratedSyncTask('water::0::0'), makeGeneratedSyncTask('water::0::0')]).legacyReplace, true); // ADDED
}); // ADDED

test('task planning date helpers use Sunday weeks and bounded day navigation', () => { // NEW
    assert.equal(taskHooks.getTaskWeekStartISO('2026-07-15'), '2026-07-12'); // NEW
    assert.equal(taskHooks.getTaskWeekEndISO('2026-07-12'), '2026-07-18'); // NEW
    assert.equal(taskHooks.isTaskDateInWeek('2026-07-18', '2026-07-12'), true); // NEW
    assert.equal(taskHooks.isTaskDateInWeek('2026-07-19', '2026-07-12'), false); // NEW
    assert.equal(taskHooks.getWeekLaneKeyForDate('2026-07-16', '2026-07-12'), 'WEEK_THU'); // NEW
    assert.equal(taskHooks.getDateForWeekLaneKey('WEEK_FRI', '2026-07-12'), '2026-07-17'); // NEW
    assert.equal(taskHooks.shiftTaskDayWithinWeek('2026-07-12', '2026-07-12', -1), '2026-07-12'); // NEW
    assert.equal(taskHooks.shiftTaskDayWithinWeek('2026-07-18', '2026-07-12', 1), '2026-07-18'); // NEW
    assert.equal(taskHooks.clampTaskStartToVisibleWeek({ start: '2026-07-01' }, '2026-07-12'), '2026-07-12'); // NEW
    assert.equal(taskHooks.clampTaskStartToVisibleWeek({ start: '2026-07-25' }, '2026-07-12'), '2026-07-18'); // NEW
    assert.equal(taskHooks.clampTaskStartToVisibleWeek({ start: '2026-07-15' }, '2026-07-12'), '2026-07-15'); // NEW
    assert.equal(taskHooks.clampTaskStartToVisibleWeek({ start: 'bad-date' }, '2026-07-12'), null); // NEW
}); // NEW

test('task planning view lanes and legacy workflow state are deterministic', () => { // NEW
    assert.deepEqual(Array.from(taskHooks.getTaskViewLaneKeys('WEEK')), ['TODO_STAGED', 'WEEK_SUN', 'WEEK_MON', 'WEEK_TUE', 'WEEK_WED', 'WEEK_THU', 'WEEK_FRI', 'WEEK_SAT']); // CHANGE
    assert.deepEqual(Array.from(taskHooks.getTaskViewLaneKeys('DAY')), ['TODO_STAGED', 'WEEK_SUN', 'WEEK_MON', 'WEEK_TUE', 'WEEK_WED', 'WEEK_THU', 'WEEK_FRI', 'WEEK_SAT']); // CHANGE
    assert.equal(taskHooks.normalizeTaskViewMode('DAY'), 'WEEK'); // NEW
    assert.equal(taskHooks.deriveWorkflowStateFromLaneKey('UPCOMING_MONTH'), 'STAGED'); // NEW
    assert.equal(taskHooks.deriveWorkflowStateFromLaneKey('TODO'), 'TODO'); // NEW
    assert.equal(taskHooks.deriveWorkflowStateFromLaneKey('DOING'), 'DOING'); // NEW
    assert.equal(taskHooks.deriveWorkflowStateFromLaneKey('DONE_WEEK'), 'DONE'); // NEW
    assert.equal(taskHooks.getEffectiveWorkflowState({ workflow_state: 'doing' }, 'TODO'), 'DOING'); // NEW
}); // NEW

test('task planning workflow patches assign and complete from view context', () => { // NEW
    const fullTodo = taskHooks.buildWorkflowPatch({}, 'TODO', { mode: 'FULL', today: '2026-07-15' }); // NEW
    assert.deepEqual({ ...fullTodo.attributes }, { workflow_state: 'TODO', assigned_day: '2026-07-15', scheduler_dates_locked: '1', incomplete_day: null, manual_staged: null, completed: null }); // NEW

    const weekDone = taskHooks.buildWorkflowPatch({}, 'DONE', { mode: 'WEEK', selectedWeekStart: '2026-07-12', today: '2026-07-15' }); // NEW
    assert.equal(weekDone.attributes.assigned_day, '2026-07-12'); // NEW
    assert.equal(weekDone.attributes.completed, '2026-07-12'); // NEW
    assert.equal(weekDone.attributes.manual_staged, null); // NEW

    const dayDone = taskHooks.buildWorkflowPatch({}, 'DONE', { mode: 'DAY', selectedDay: '2026-07-16', selectedWeekStart: '2026-07-12' }); // NEW
    assert.equal(dayDone.attributes.assigned_day, '2026-07-16'); // NEW
    assert.equal(dayDone.attributes.completed, '2026-07-16'); // NEW
    assert.equal(dayDone.attributes.manual_staged, null); // NEW

    const staged = taskHooks.buildWorkflowPatch({ workflow_state: 'TODO', assigned_day: '2026-07-16' }, 'STAGED', { manualStaged: true }); // NEW
    assert.equal(staged.attributes.manual_staged, '1'); // NEW

    const incomplete = taskHooks.buildIncompletePatch({ workflow_state: 'DOING', assigned_day: '2026-07-16' }, '2026-07-16'); // NEW
    assert.deepEqual({ ...incomplete.attributes }, { workflow_state: 'STAGED', assigned_day: null, scheduler_dates_locked: null, incomplete_day: '2026-07-16', manual_staged: '1', completed: null }); // NEW

    const allocation = taskHooks.buildStagedStartDateAllocationPatch({ start: '2026-07-25', manual_staged: '1' }, { selectedWeekStart: '2026-07-12' }); // NEW
    assert.deepEqual({ ...allocation.attributes }, { workflow_state: 'TODO', assigned_day: '2026-07-18', scheduler_dates_locked: '1', incomplete_day: null, manual_staged: null, completed: null }); // NEW
    assert.equal(taskHooks.buildStagedStartDateAllocationPatch({ start: '' }, { selectedWeekStart: '2026-07-12' }), null); // NEW
}); // NEW

test('task planning mode lane decisions reflow from card attributes', () => { // NEW
    assert.equal(taskHooks.decideTaskViewLaneKey({ workflow_state: 'STAGED' }, { mode: 'WEEK', laneKey: 'TODO_STAGED', selectedWeekStart: '2026-07-12' }), 'TODO_STAGED'); // NEW
    assert.equal(taskHooks.decideTaskViewLaneKey({ workflow_state: 'STAGED', manual_staged: '1' }, { mode: 'DAY', laneKey: 'UPCOMING_MONTH', selectedDay: '2026-07-15' }), 'TODO_STAGED'); // NEW
    assert.equal(taskHooks.decideTaskViewLaneKey({ workflow_state: 'STAGED' }, { mode: 'WEEK', laneKey: 'UPCOMING_MONTH', selectedWeekStart: '2026-07-12' }), 'TODO_STAGED'); // CHANGE
    assert.equal(taskHooks.decideTaskViewLaneKey({ workflow_state: 'STAGED' }, { mode: 'DAY', laneKey: 'UPCOMING_YEAR', selectedDay: '2026-07-15' }), 'TODO_STAGED'); // NEW
    assert.equal(taskHooks.decideTaskViewLaneKey({ workflow_state: 'STAGED', manual_staged: '1' }, { mode: 'FULL', laneKey: 'UPCOMING_MONTH' }), 'TODO_STAGED'); // NEW
    assert.equal(taskHooks.decideTaskViewLaneKey({ workflow_state: 'STAGED' }, { mode: 'FULL', laneKey: 'UPCOMING_MONTH' }), ''); // NEW
    assert.equal(taskHooks.decideTaskViewLaneKey({ workflow_state: 'TODO', assigned_day: '2026-07-14' }, { mode: 'WEEK', selectedWeekStart: '2026-07-12' }), 'WEEK_TUE'); // NEW
    assert.equal(taskHooks.decideTaskViewLaneKey({ workflow_state: 'DONE', assigned_day: '2026-07-14', completed: '2026-07-14' }, { mode: 'WEEK', selectedWeekStart: '2026-07-12' }), 'WEEK_TUE'); // CHANGE
    assert.equal(taskHooks.decideTaskViewLaneKey({ workflow_state: 'DONE', assigned_day: '2026-07-14', completed: '2026-07-14' }, { mode: 'WEEK', selectedWeekStart: '2026-07-19' }), 'DONE_WEEK'); // CHANGE
    assert.equal(taskHooks.decideTaskViewLaneKey({ workflow_state: 'DOING', assigned_day: '2026-07-15' }, { mode: 'DAY', selectedWeekStart: '2026-07-12', selectedDay: '2026-07-15' }), 'WEEK_WED'); // CHANGE
    assert.equal(taskHooks.decideTaskViewLaneKey({ workflow_state: 'DOING', assigned_day: '2026-07-16' }, { mode: 'DAY', selectedWeekStart: '2026-07-12', selectedDay: '2026-07-15' }), 'WEEK_THU'); // CHANGE
}); // NEW

test('stack scheduler time helpers snap, normalize hours, and pack cumulatively', () => { // NEW
    assert.equal(taskHooks.scheduleMinutesToPx(60), 80); // NEW
    assert.equal(taskHooks.schedulePxToMinutes(20), 15); // NEW
    assert.equal(taskHooks.schedulePxToMinutes(39), 30); // NEW
    assert.equal(taskHooks.defaultScheduleDurationFromHours('1.25'), 75); // NEW
    assert.equal(taskHooks.defaultScheduleDurationFromHours(''), 60); // NEW
    assert.equal(taskHooks.formatScheduleTimeRange(360, 75), '6:00 AM-7:15 AM'); // NEW
    assert.equal(taskHooks.formatScheduleTimeRange('', 75), ''); // NEW
    const laneWidths = taskHooks.normalizeWeekDayLaneWidths(JSON.stringify({ widths: { WEEK_WED: 95, WEEK_THU: 333 } }), 220); // NEW
    assert.deepEqual({ ...laneWidths }, { // CHANGE
        WEEK_SUN: 220, // NEW
        WEEK_MON: 220, // NEW
        WEEK_TUE: 220, // NEW
        WEEK_WED: 140, // NEW
        WEEK_THU: 333, // NEW
        WEEK_FRI: 220, // NEW
        WEEK_SAT: 220 // NEW
    }); // NEW
    const defaults = taskHooks.defaultWeekWorkHours(); // NEW
    assert.deepEqual(JSON.parse(JSON.stringify(defaults.map(day => [day.startMinute, day.endMinute, day.closed]))), [ // CHANGE
        [480, 720, false], // NEW
        [1020, 1140, false], // NEW
        [1020, 1140, false], // NEW
        [1020, 1140, false], // NEW
        [1020, 1140, false], // NEW
        [1020, 1140, false], // NEW
        [480, 720, false] // NEW
    ]); // NEW

    const closed = taskHooks.normalizeWorkHourWindow({ closed: true, startMinute: 500, endMinute: 700 }); // NEW
    assert.deepEqual(JSON.parse(JSON.stringify(closed)), { closed: true, startMinute: 495, endMinute: 705 }); // CHANGE
    const week = taskHooks.resolveWeekWorkHours( // NEW
        taskHooks.serializeWeekWorkHours([{ startMinute: 360, endMinute: 720 }]), // NEW
        JSON.stringify({ weeks: { '2026-07-12': { days: [{ closed: true }] } } }), // NEW
        '2026-07-12' // NEW
    ); // NEW
    assert.deepEqual(JSON.parse(JSON.stringify(week[0])), { closed: true, startMinute: 360, endMinute: 720 }); // CHANGE
    assert.equal(week[1].startMinute, 360); // NEW
    const scale = taskHooks.buildWeekTimeScale(defaults); // NEW
    assert.deepEqual({ active: scale.active, startMinute: scale.startMinute, endMinute: scale.endMinute, durationMinutes: scale.durationMinutes }, { active: true, startMinute: 480, endMinute: 1140, durationMinutes: 660 }); // NEW
    assert.equal(taskHooks.getWeekTimeScaleOffsetPx(defaults[1], scale), 720); // NEW
    const quarterScale = taskHooks.buildWeekTimeScale([{ startMinute: 510, endMinute: 1035 }]); // NEW
    assert.deepEqual({ startMinute: quarterScale.startMinute, endMinute: quarterScale.endMinute }, { startMinute: 480, endMinute: 1080 }); // NEW
    assert.equal(taskHooks.getWeekTimeScaleOffsetPx({ startMinute: 510, endMinute: 1035 }, quarterScale), 40); // NEW
    const closedScale = taskHooks.buildWeekTimeScale([{ closed: true }, { closed: true }, { closed: true }, { closed: true }, { closed: true }, { closed: true }, { closed: true }]); // NEW
    assert.equal(closedScale.active, false); // NEW

    const plan = taskHooks.buildStackSchedulePlan([ // NEW
        { id: 'a', source: { task_estimated_hours: '1.5' }, height: 80 }, // NEW
        { id: 'b', source: { schedule_duration_minutes: '30' }, height: 40 } // NEW
    ], { startMinute: 360, endMinute: 450 }); // NEW
    assert.deepEqual(Array.from(plan.items, item => [item.startMinute, item.durationMinutes, item.height, item.overflow]), [[360, 90, 120, false], [450, 30, 40, true]]); // CHANGE
    assert.equal(plan.overflowMinutes, 30); // NEW
    const breakPlan = taskHooks.buildStackSchedulePlan([{ id: 'break', source: { schedule_break: '1' } }], { startMinute: 360, endMinute: 720 }); // NEW
    assert.deepEqual(Array.from(breakPlan.items, item => [item.startMinute, item.durationMinutes, item.height, item.overflow]), [[360, 30, 40, false]]); // NEW
    const shiftedPlan = taskHooks.buildStackSchedulePlan([ // NEW
        { id: 'task', source: { schedule_duration_minutes: '60' }, height: 80 }, // NEW
        { id: 'break', source: { schedule_break: '1', schedule_duration_minutes: '30' }, height: 40 } // NEW
    ], { startMinute: 480, endMinute: 540 }); // NEW
    assert.deepEqual(Array.from(shiftedPlan.items, item => [item.startMinute, item.durationMinutes, item.height, item.overflow]), [[480, 60, 80, false], [540, 30, 40, true]]); // NEW
    assert.equal(shiftedPlan.overflowMinutes, 30); // NEW

    const scheduleRecords = [ // NEW
        { id: 'break', source: { schedule_order: '1', schedule_order_day: '2026-07-15' }, fallbackIndex: 0 }, // NEW
        { id: 'task', source: { schedule_order: '0', schedule_order_day: '2026-07-15' }, fallbackIndex: 1 }, // NEW
        { id: 'new', source: {}, fallbackIndex: 2 }, // NEW
        { id: 'stale', source: { schedule_order: '0', schedule_order_day: '2026-07-22' }, fallbackIndex: 3 } // NEW
    ].sort((left, right) => taskHooks.compareDateScopedScheduleOrderRecords(left, right, '2026-07-15')); // NEW
    assert.deepEqual(scheduleRecords.map(record => record.id), ['task', 'break', 'new', 'stale']); // NEW
    assert.equal(taskHooks.getDateScopedScheduleOrder(scheduleRecords[0].source, '2026-07-15'), 0); // NEW
    assert.equal(taskHooks.getDateScopedScheduleOrder(scheduleRecords[3].source, '2026-07-15'), null); // NEW
}); // NEW

test('selected period staged sort is date relative and sinks missing starts', () => { // NEW
    const records = [ // NEW
        { title: 'Future tie', start: '2026-07-16' }, // NEW
        { title: 'Missing start' }, // NEW
        { title: 'Past tie', start: '2026-07-14' }, // NEW
        { title: 'Selected day', start: '2026-07-15' }, // NEW
        { title: 'Invalid start', start: '2026-02-31' } // NEW
    ]; // NEW
    const daySorted = records.slice().sort((left, right) => taskHooks.compareSelectedPeriodStagedRecords(left, right, { mode: 'WEEK', selectedWeekStart: '2026-07-12', selectedDay: '2026-07-15' })); // CHANGE
    assert.deepEqual(daySorted.map(record => record.title), ['Selected day', 'Past tie', 'Future tie', 'Invalid start', 'Missing start']); // NEW

    const weekRecords = [ // NEW
        { title: 'Next Sunday', start: '2026-07-19' }, // NEW
        { title: 'Prior Saturday', start: '2026-07-11' }, // NEW
        { title: 'Inside future', start: '2026-07-17' }, // NEW
        { title: 'Inside past', start: '2026-07-13' }, // NEW
        { title: 'Inside selected', start: '2026-07-15' }, // NEW
        { title: 'No date' } // NEW
    ]; // NEW
    const weekSorted = weekRecords.slice().sort((left, right) => taskHooks.compareSelectedPeriodStagedRecords(left, right, { mode: 'WEEK', selectedWeekStart: '2026-07-12', selectedDay: '2026-07-15' })); // NEW
    assert.deepEqual(weekSorted.map(record => record.title), ['Inside selected', 'Inside past', 'Inside future', 'Prior Saturday', 'Next Sunday', 'No date']); // NEW
}); // NEW

test('selected period staged start badge text uses visible-week wording', () => { // CHANGE
    assert.equal(taskHooks.buildSelectedPeriodStagedStartText({ start: '2026-07-12' }, { mode: 'WEEK', selectedWeekStart: '2026-07-12' }), 'Start Sun'); // CHANGE
    assert.equal(taskHooks.buildSelectedPeriodStagedStartText({ start: '2026-07-14' }, { mode: 'WEEK', selectedWeekStart: '2026-07-12', selectedDay: '2026-07-15', weekBadgeAnchor: 'DAY' }), 'Start Tue'); // CHANGE
    assert.equal(taskHooks.buildSelectedPeriodStagedStartText({ start: '2026-07-17' }, { mode: 'WEEK', selectedWeekStart: '2026-07-12' }), 'Start Fri'); // CHANGE
    assert.equal(taskHooks.buildSelectedPeriodStagedStartText({ start: '2026-07-15' }, { mode: 'WEEK', selectedWeekStart: '2026-07-12', today: '2026-07-15' }), 'Start today'); // NEW
    assert.equal(taskHooks.buildSelectedPeriodStagedStartText({ start: '2026-07-16' }, { mode: 'WEEK', selectedWeekStart: '2026-07-12', today: '2026-07-15' }), 'Start tomorrow'); // NEW
    assert.equal(taskHooks.buildSelectedPeriodStagedStartText({ start: '2026-07-11' }, { mode: 'WEEK', selectedWeekStart: '2026-07-12' }), '1d late'); // CHANGE
    assert.equal(taskHooks.buildSelectedPeriodStagedStartText({ start: '2026-07-19' }, { mode: 'WEEK', selectedWeekStart: '2026-07-12' }), 'Starts in 1d'); // CHANGE
    assert.equal(taskHooks.buildSelectedPeriodStagedStartText({ start: '2026-07-25' }, { mode: 'WEEK', selectedWeekStart: '2026-07-12' }), 'Starts in 7d'); // NEW
    assert.equal(taskHooks.buildSelectedPeriodStagedStartText({ start: '2026-02-31' }, { mode: 'WEEK', selectedDay: '2026-07-15', weekBadgeAnchor: 'DAY' }), ''); // CHANGE
    assert.equal(taskHooks.buildSelectedPeriodStagedStartText({}, { mode: 'WEEK', selectedWeekStart: '2026-07-12' }), ''); // CHANGE
    assert.equal(taskHooks.buildSelectedPeriodStagedDueText({ start: '2026-07-14' }, { mode: 'WEEK', selectedWeekStart: '2026-07-12' }), 'Start Tue'); // CHANGE
}); // NEW

test('selected period staged mode applies only to staged planning views', () => { // CHANGE
    assert.equal(taskHooks.selectedPeriodStagedSortEnabled('TODO_STAGED', { mode: 'WEEK' }), true); // CHANGE
    assert.equal(taskHooks.selectedPeriodStagedSortEnabled('TODO_STAGED', { mode: 'DAY' }), true); // CHANGE: legacy DAY normalizes to WEEK
    assert.equal(taskHooks.selectedPeriodStagedSortEnabled('TODO_STAGED', { mode: 'FULL' }), false); // CHANGE
    assert.equal(taskHooks.selectedPeriodStagedSortEnabled('TODO', { mode: 'DAY' }), false); // CHANGE
}); // NEW

test('scheduler sync respects date locks and preserves touched missing cards', () => { // NEW
    const lockedAttrs = taskHooks.buildGeneratedTaskSyncAttributesForExisting({ scheduler_dates_locked: '1', start: '2026-07-10' }, makeGeneratedSyncTask('water::0::0', { startISO: '2026-08-01', endISO: '2026-08-02' })); // NEW
    assert.equal(Object.hasOwn(lockedAttrs, 'start'), false); // NEW
    assert.equal(lockedAttrs.scheduler_missing, null); // NEW

    const plan = taskHooks.planDifferentialTaskSync( // NEW
        [makeGeneratedSyncRecord('water::0::0', { workflow_state: 'TODO', assigned_day: '2026-07-15' }), makeGeneratedSyncRecord('water::0::1'), { ...makeGeneratedSyncRecord('water::0::2'), laneKey: 'DOING' }], // NEW
        [] // NEW
    ); // NEW
    assert.deepEqual(Array.from(plan.missing, item => item.key), ['water::0::0', 'water::0::2']); // NEW
    assert.deepEqual(Array.from(plan.removes, item => item.key), ['water::0::1']); // NEW

    const manuallyStagedPlan = taskHooks.planDifferentialTaskSync([makeGeneratedSyncRecord('water::0::3', { manual_staged: '1' })], []); // NEW
    assert.deepEqual(Array.from(manuallyStagedPlan.missing, item => item.key), ['water::0::3']); // NEW
}); // NEW

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
    assert.deepEqual({ ...taskHooks.buildSchedulerTaskMetadataAttributes({ // ADDED
        rule_id: 'start', // ADDED
        startAnchorStage: 'SOW', // ADDED
        methodCategoryId: 'transplant', // ADDED
        methodId: 'transplant.indoor', // ADDED
        scheduler_task_key: 'start::0::0', // ADDED
        scheduler_occurrence_index: 0 // ADDED
    }) }, { // ADDED
        scheduler_rule_id: 'start', // ADDED
        scheduler_anchor_stage: 'SOW', // ADDED
        scheduler_method_category_id: 'transplant', // ADDED
        scheduler_method_id: 'transplant.indoor', // ADDED
        scheduler_task_key: 'start::0::0', // ADDED
        scheduler_occurrence_index: '0' // ADDED
    }); // ADDED
    assert.deepEqual({ ...taskHooks.buildSchedulerTaskMetadataAttributes({}) }, {}); // CHANGE
}); // NEW

test('task replacement event bridge retains differential sync without scheduler task-edit callback', () => { // CHANGED
    const schedulerSource = fs.readFileSync(schedulerPath, 'utf8'); // ADDED
    const taskManagerSource = fs.readFileSync(taskManagerPath, 'utf8'); // ADDED
    assert.match(schedulerSource, /mode:\s*options\.taskDispatchMode \|\| "replace"/); // ADDED
    assert.match(taskManagerSource, /replacement\.mode !== 'replace' && replacement\.mode !== 'sync'/); // ADDED
    assert.match(taskManagerSource, /if \(replacement\.mode === 'sync'\)/); // ADDED
    assert.match(taskManagerSource, /applyDifferentialTaskSync\(\{\s*targetGroupId,\s*tasks\s*\}\)/); // ADDED
    assert.doesNotMatch(schedulerSource, /applyTaskAnchorDateEdit/); // CHANGED
    assert.doesNotMatch(taskManagerSource, /tryApplySchedulerAnchorDateEdit/); // CHANGED
}); // CHANGED

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
    assert.equal(reset.manual_staged, null); // NEW
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

test('kanban parenting policy allows only canonical board lane and lane card structure', () => { // NEW
    const board = { id: 'board', board_key: 'KANBAN_BOARD' }; // NEW
    const legacyBoard = { id: 'legacy-board', board_key: 'MAIN_KANBAN_BOARD' }; // NEW
    const todoLane = { id: 'todo-lane', lane_key: 'TODO' }; // NEW
    const stagedLane = { id: 'staged-lane', lane_key: 'TODO_STAGED' }; // NEW
    const weekLane = { id: 'week-lane', lane_key: 'WEEK_SUN' }; // NEW
    const otherTodoLane = { id: 'other-todo-lane', lane_key: 'TODO' }; // NEW
    const doingLane = { id: 'doing-lane', lane_key: 'DOING' }; // NEW
    const unknownLane = { id: 'unknown-lane', lane_key: 'CUSTOM' }; // NEW
    const card = { id: 'card', kanban_card: '1' }; // NEW
    const breakCard = { id: 'break-card', kanban_card: '1', schedule_break: '1' }; // NEW
    const generic = { id: 'shape' }; // NEW

    assert.equal(taskHooks.getKanbanCellType(board), 'board'); // NEW
    assert.equal(taskHooks.getKanbanCellType(legacyBoard), 'board'); // NEW
    assert.equal(taskHooks.getKanbanCellType(todoLane), 'lane'); // NEW
    assert.equal(taskHooks.getKanbanCellType(stagedLane), 'lane'); // NEW
    assert.equal(taskHooks.getKanbanCellType(weekLane), 'lane'); // NEW
    assert.equal(taskHooks.getKanbanCellType(card), 'card'); // NEW
    assert.equal(taskHooks.getKanbanCellType(unknownLane), 'other'); // NEW

    assert.equal(taskHooks.canParentKanbanCell(board, todoLane, { siblings: [] }), true); // NEW
    assert.equal(taskHooks.canParentKanbanCell(board, weekLane, { siblings: [todoLane] }), true); // NEW
    assert.equal(taskHooks.canParentKanbanCell(board, doingLane, { siblings: [todoLane] }), true); // NEW
    assert.equal(taskHooks.canParentKanbanCell(board, todoLane, { siblings: [todoLane] }), true); // NEW
    assert.equal(taskHooks.canParentKanbanCell(board, otherTodoLane, { siblings: [todoLane] }), false); // NEW
    assert.equal(taskHooks.canParentKanbanCell(board, card, { siblings: [] }), false); // NEW
    assert.equal(taskHooks.canParentKanbanCell(board, generic, { siblings: [] }), false); // NEW
    assert.equal(taskHooks.canParentKanbanCell(todoLane, card, { siblings: [] }), true); // NEW
    assert.equal(taskHooks.canParentKanbanCell(stagedLane, card, { siblings: [] }), true); // NEW
    assert.equal(taskHooks.canParentKanbanCell(stagedLane, breakCard, { siblings: [] }), false); // NEW
    assert.equal(taskHooks.canParentKanbanCell(weekLane, breakCard, { siblings: [] }), true); // NEW
    assert.equal(taskHooks.canParentKanbanCell(todoLane, generic, { siblings: [] }), false); // NEW
    assert.equal(taskHooks.canParentKanbanCell(todoLane, doingLane, { siblings: [] }), false); // NEW
    assert.equal(taskHooks.canParentKanbanCell(generic, card, { siblings: [] }), false); // NEW
    assert.equal(taskHooks.canParentKanbanCell(generic, todoLane, { siblings: [] }), false); // NEW
    assert.equal(taskHooks.canParentKanbanCell(generic, board, { siblings: [] }), true); // NEW
}); // NEW

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
    assert.match(source, /scheduleTimeBadge \+ badgesHtml \+ stateBadge \+ missingBadge \+ incompleteBadge \+ repeatBadge \+ noteBadge \+ editedDateBadge \+ linkBadge/); // CHANGE
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
    const commitStart = source.indexOf('function commitCardPatch(card, attributes, opts)'); // CHANGED
    const commitEnd = source.indexOf('function fmtSigned', commitStart); // CHANGED
    const commitSource = source.slice(commitStart, commitEnd); // CHANGED
    const valueWrites = commitSource.match(/model\.setValue\(card,\s*cloneCardValueWithAttributes\(card,\s*attributes\)\)/g) || []; // CHANGED
    assert.equal(valueWrites.length, 1);
    assert.match(source, /function commitCardPatch\(card,\s*attributes,\s*opts\)/);
    assert.match(source, /if \(shouldReflow\) \{\s*scanAndReflowBoard\(board,\s*\{\s*insideUpdate:\s*true,\s*scope:\s*getTaskReflowScopeForCommand\('dateEdit'\)\s*\}\)/); // CHANGE
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

test('task manager installs kanban parenting drop and move guards', () => { // NEW
    const source = fs.readFileSync(taskManagerPath, 'utf8'); // NEW
    assert.match(source, /function installKanbanParentingGuards\(\)/); // NEW
    assert.match(source, /graph\.isValidDropTarget = function \(target,\s*cells,\s*evt\)/); // NEW
    assert.match(source, /graph\.moveCells = function \(cells,\s*dx,\s*dy,\s*clone,\s*target,\s*evt,\s*mapping\)/); // NEW
    assert.match(source, /buildLaneDropWorkflowPatch\(card,\s*targetBoard,\s*targetLaneKey\)/); // NEW
    assert.match(source, /installKanbanParentingGuards\(\);/); // NEW
}); // NEW

test('task manager installs planning mode header controls and selected-card DOM overlay', () => { // NEW
    const source = fs.readFileSync(taskManagerPath, 'utf8'); // NEW
    assert.match(source, /function installBoardHeaderControls\(\)/); // NEW
    assert.match(source, /function ensureTaskControlOverlayHost\(\)/); // NEW
    assert.match(source, /const paneIsSvg = !!\(pane && pane\.namespaceURI === 'http:\/\/www\.w3\.org\/2000\/svg'\)/); // CHANGE
    assert.match(source, /const baseHost = pane && !paneIsSvg \? pane : \(graph\.container \|\| pane \|\| null\)/); // CHANGE
    assert.match(source, /trellis-task-control-layer/); // NEW
    assert.match(source, /if \(style && style\.position === 'static'\) baseHost\.style\.position = 'relative'/); // CHANGE
    assert.match(source, /trellis-task-board-header-controls/); // NEW
    assert.match(source, /bar\.style\.zIndex = String\(GRAPH_OVERLAY_Z\.CONTROL\)/); // CHANGE
    assert.match(source, /dateInput\.type = 'date'/); // NEW
    assert.match(source, /if \(!value\) \{\s*taskCommands\.setBoardPlanningView\(b,\s*'FULL'\)/); // CHANGE
    assert.match(source, /taskCommands\.setBoardPlanningView\(b,\s*'WEEK',\s*\{\s*\[TASK_SELECTED_WEEK_START_ATTR\]: weekStart,\s*\[TASK_SELECTED_DAY_ATTR\]: value\s*\}\)/); // CHANGE
    assert.match(source, /positionDomOverlayFromCellState\(bar,\s*board,\s*false,\s*true\)/); // NEW
    assert.match(source, /const left = bounds\.x/); // CHANGE
    assert.match(source, /const topBase = bounds\.y/); // CHANGE
    assert.match(source, /function getSelectionCellsList\(\)/); // NEW
    assert.match(source, /if \(isBoardCell\(cell\)\).*return cell/); // CHANGE
    assert.match(source, /const board = findBoardAncestor\(cell\)/); // NEW
    assert.match(source, /function restoreBoardSelectionIfNeeded\(board\)/); // CHANGE
    assert.match(source, /function toggleBoardPlanningView\(\)/); // NEW
    assert.match(source, /modeLabel\.textContent = mode === 'WEEK' \? 'Mode: Week' : 'Mode: Full'/); // CHANGE
    assert.match(source, /modeToggle\.textContent = mode === 'WEEK' \? 'Switch to Full view' : 'Switch to Week view'/); // CHANGE
    assert.match(source, /prev\.style\.display = mode === 'WEEK' \? '' : 'none'/); // NEW
    assert.match(source, /End Day \('/); // NEW
    assert.match(source, /End Week \('/); // NEW
    assert.match(source, /function installSelectedCardActionOverlay\(\)/); // NEW
    assert.match(source, /trellis-task-selected-card-actions/); // NEW
    assert.match(source, /overlay\.style\.zIndex = String\(GRAPH_OVERLAY_Z\.CONTROL\)/); // CHANGE
    assert.match(source, /function selectedKanbanCards\(\)/); // CHANGE: placement and workflow visibility are covered behaviorally in task-manager-overlays.test.cjs
    assert.match(source, /graph\.view\.getState\(cell\)/); // NEW
    assert.match(source, /graph\.view\.addListener\(mxEvent\.REPAINT,\s*refresh\)/); // CHANGE
    assert.match(source, /model\.addListener\(mxEvent\.CHANGE,\s*refresh\)/); // CHANGE
    assert.match(source, /graph\.container\.addEventListener\('scroll',\s*refresh,\s*\{\s*passive:\s*true\s*\}\)/); // CHANGE
    assert.match(source, /function createDeferredTaskOverlayRefresh\(refresh\)/); // CHANGE
    assert.match(source, /taskCommands\.applyCardWorkflowActions\(cards,\s*'DONE'\)/); // CHANGE
    assert.match(source, /Allocate to Start Dates/); // NEW
    assert.match(source, /buildStagedStartDateAllocationPatch\(card\.value,\s*buildCardWorkflowContext\(board\)\)/); // NEW
    assert.match(source, /menu\.addItem\('Edit Card\.\.\.'/); // NEW
}); // NEW

test('task manager day-owned breaks use assigned day ownership', () => { // NEW
    const source = fs.readFileSync(taskManagerPath, 'utf8'); // NEW
    assert.match(source, /setAttrNoUndo\(card,\s*TASK_ASSIGNED_DAY_ATTR,\s*assignedDay,\s*true\)/); // NEW
    assert.match(source, /reconcileScheduleBreakOwnership\(board,\s*sourceLaneKey,\s*c\)/); // NEW
    assert.match(source, /getAttr\(card,\s*TASK_ASSIGNED_DAY_ATTR\) === getVisibleDateForWeekLane\(board,\s*laneKey\)/); // NEW
    const inactiveBranch = source.slice(source.indexOf('function reconcileScheduleBreakOwnership'), source.indexOf('function isActiveScheduleCardForLane')); // NEW
    assert.match(inactiveBranch, /setDerivedCardAttribute\(card,\s*TASK_SCHEDULE_START_MINUTE_ATTR,\s*null\)/); // NEW
    assert.doesNotMatch(inactiveBranch, /setDerivedCardAttribute\(card,\s*TASK_SCHEDULE_DURATION_MINUTES_ATTR,\s*null\)/); // NEW
}); // NEW

test('task manager schedule order is date scoped for tasks and breaks', () => { // NEW
    const source = fs.readFileSync(taskManagerPath, 'utf8'); // NEW
    assert.match(source, /const TASK_SCHEDULE_ORDER_ATTR = 'schedule_order';/); // NEW
    assert.match(source, /const TASK_SCHEDULE_ORDER_DAY_ATTR = 'schedule_order_day';/); // NEW
    assert.match(source, /compareDateScopedScheduleOrderRecords\(left,\s*right,\s*visibleDay\)/); // NEW
    assert.match(source, /setDerivedCardAttribute\(record\.cell,\s*TASK_SCHEDULE_ORDER_ATTR,\s*index\)/); // NEW
    assert.match(source, /syncScheduleLanePhysicalOrder\(lane,\s*records\)/); // NEW
}); // NEW

test('task manager edit hours dialog uses a readable table layout and preserves save reflow', () => { // CHANGE
    const source = fs.readFileSync(taskManagerPath, 'utf8'); // NEW
    const saveBlock = source.slice(source.indexOf("const save = mxUtils.button('Save'"), source.indexOf("buttons.appendChild(cancel)", source.indexOf("const save = mxUtils.button('Save'"))); // NEW
    const hoursBlock = source.slice(source.indexOf('function showEditHoursDialogImpl'), source.indexOf('function saveBoardWeekWorkHours')); // NEW
    assert.match(hoursBlock, /taskDialogs\.showTaskManagerDialog\(div,\s*660,\s*600,\s*true,\s*true\)/); // NEW
    assert.match(hoursBlock, /grid-template-columns:110px 78px minmax\(136px,1fr\) minmax\(136px,1fr\)/); // NEW
    assert.match(hoursBlock, /width:100%;min-width:136px;box-sizing:border-box/); // NEW
    assert.match(hoursBlock, /\['Day',\s*'Closed',\s*'Start',\s*'End'\]/); // NEW
    assert.match(hoursBlock, /function updateClosedRowState\(row,\s*closed,\s*start,\s*end\)/); // NEW
    assert.match(hoursBlock, /start\.disabled = isClosed/); // NEW
    assert.match(hoursBlock, /end\.disabled = isClosed/); // NEW
    assert.match(hoursBlock, /closed\.addEventListener\('change',\s*function \(\) \{ updateClosedRowState\(row,\s*closed,\s*start,\s*end\); \}\)/); // NEW
    assert.match(saveBlock, /taskCommands\.saveBoardWeekWorkHours\(board,\s*weekStart,\s*weeks,\s*nextDefaults,\s*nextWeek\)/); // CHANGE
    assert.match(source, /function saveBoardWeekWorkHours\(board,\s*weekStart,\s*weeks,\s*nextDefaults,\s*nextWeek\)/); // CHANGE
    assert.match(source, /setAttrNoUndo\(board,\s*TASK_WORK_HOURS_DEFAULTS_ATTR,\s*serializeWeekWorkHours\(nextDefaults\),\s*true\)/); // CHANGE
    assert.match(source, /setAttrNoUndo\(board,\s*TASK_WORK_HOURS_WEEK_OVERRIDES_ATTR,\s*JSON\.stringify\(\{\s*schemaVersion:\s*1,\s*weeks:\s*nextWeeks\s*\}\),\s*true\)/); // CHANGE
    assert.match(source, /scanAndReflowBoard\(board,\s*\{\s*insideUpdate:\s*true,\s*scope:\s*getTaskReflowScopeForCommand\('editHours'\)\s*\}\)/); // CHANGE
}); // NEW

test('task manager dialog calls use Trellis dialog elevation', () => { // NEW
    const source = fs.readFileSync(taskManagerPath, 'utf8'); // NEW
    assert.match(source, /const TRELLIS_DIALOG_Z = 2000000000;/); // NEW
    assert.match(source, /function createTaskDialogRuntime\(\{\s*ui,\s*document,\s*commands,\s*adapters\s*\}\)/); // CHANGE
    assert.match(source, /const taskDialogs = createTaskDialogRuntime\(\{/); // CHANGE
    assert.match(source, /function showEditCardDialog\(card\) \{ return taskDialogs\.showEditCardDialog\(card\); \}/); // CHANGE
    assert.match(source, /taskDialogs\.showEditHoursDialog\(b\)/); // CHANGE
    assert.match(source, /taskDialogs\.showBulkEditCardsDialog\(cards\)/); // CHANGE
    assert.match(source, /function elevateTaskManagerDialog\(\)/); // NEW
    assert.match(source, /dlg\.container\.style\.zIndex = String\(TRELLIS_DIALOG_Z\)/); // NEW
    assert.match(source, /dlg\.bg\.style\.zIndex = String\(TRELLIS_DIALOG_Z - 1\)/); // NEW
    const directCalls = (source.match(/ui\.showDialog\(/g) || []).length; // NEW
    const wrapperCalls = (source.match(/taskDialogs\.showTaskManagerDialog\(/g) || []).length; // CHANGE
    assert.equal(directCalls, 1); // NEW
    assert.ok(wrapperCalls >= 3); // CHANGE
}); // NEW

test('task manager isolates no-undo planning view reflow', () => { // NEW
    const source = fs.readFileSync(taskManagerPath, 'utf8'); // NEW
    assert.match(source, /function runKanbanViewNoUndo\(fn\)/); // NEW
    assert.match(source, /kanbanViewReflowDepth/); // NEW
    assert.match(source, /isKanbanViewReflowing\(\)/); // NEW
    assert.match(source, /undoManager\.history\.splice\(beforeLength\)/); // NEW
    assert.match(source, /runKanbanViewNoUndo\(function \(\) \{/); // NEW
}); // NEW

test('save path passes the in-memory task template to graph application', () => { // CHANGED
    const source = fs.readFileSync(schedulerPath, 'utf8');
    assert.match(source, /taskTemplate:\s*options\.taskTemplate\s*\?\?\s*null/);
    assert.match(source, /taskTemplate,\s*\/\/ FIX: generate tasks from the in-memory template/);
});

test('scheduler clears stale no-window warning after feasible crop recovery', () => {
    const source = fs.readFileSync(schedulerPath, 'utf8');
    const anchorStart = source.indexOf('async function recomputeAnchors');
    const anchorEnd = source.indexOf('// --- mode switcher', anchorStart);
    const anchorBody = source.slice(anchorStart, anchorEnd);
    const noWindowIndex = anchorBody.indexOf("showErrorInline('No feasible window.'); // FIX");
    const clearRecoveryIndex = anchorBody.indexOf('clearErrorInline(); // FIX: clear stale no-window warning after feasibility recovers');
    const successReturnIndex = anchorBody.indexOf('return true; // FIX: allow dependent recomputation only after valid anchors');

    assert.ok(noWindowIndex >= 0, 'infeasible anchors should still show the no-window warning');
    assert.ok(clearRecoveryIndex > noWindowIndex, 'feasible recovery should clear the prior no-window warning');
    assert.ok(successReturnIndex > clearRecoveryIndex, 'the warning should clear immediately before anchor success');
    assert.match(source, /plantSel\.addEventListener\('change',\s*\(\)\s*=>\s*\{[\s\S]*currentCropPickerSelectedValue = String\(plantSel\.value \|\| ''\);[\s\S]*schedulerCropPickerRefreshVersion \+= 1;[\s\S]*renderSchedulerCropPicker\(currentCropPickerOptions, currentCropPickerSelectedValue\);[\s\S]*void runUiAsync\('Plant change error',\s*async \(\)\s*=>\s*\{\s*\/\/ FIX: clear stale inline warnings before crop recompute\s*await handleSchedulePlantChange\(\);/s); // CHANGED
    assert.match(source, /varietySel\.addEventListener\('change',\s*\(\)\s*=>\s*\{\s*void runUiAsync\('Variety change error',\s*async \(\)\s*=>\s*\{\s*\/\/ FIX: clear stale inline warnings before variety recompute\s*await handleScheduleVarietyChange\(\);\s*\}\);\s*\}\);/s);
});
